import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAgentContextById, wasenderCredsOf } from "@/lib/agents";
import { sendWhatsAppText } from "@/lib/wasender";
import { FOLLOW_UP_DELAYS_HOURS, MAX_FOLLOW_UPS } from "@/lib/constants";
import type { Contact, Conversation, LeadStatus } from "@/lib/types";

/**
 * Automatic follow-up engine (CLAUDE.md §16).
 *
 * Cadence (hours from the last inbound message): 24h → 3j → 7j, max 3 relances.
 * The chain stops as soon as the prospect replies, refuses, or converts. All
 * functions here run with the service-role client so they work from webhooks
 * and the cron runner without a user session.
 */

type Db = ReturnType<typeof createAdminClient>;

const HOUR_MS = 3_600_000;

/** Statuses that permanently end the follow-up chain — never relaunch these. */
const TERMINAL_STATUSES: ReadonlySet<LeadStatus> = new Set<LeadStatus>([
  "client_converti",
  "perdu",
  "spam",
  // Qualified/hot leads are handed to a human; the bot must not keep nudging.
  "prospect_qualifie",
  "prospect_chaud",
  "humain_requis",
]);

/** True when a conversation status should stop (not schedule) follow-ups. */
export function isTerminalForFollowUp(status: LeadStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

interface ScheduleArgs {
  agentId: string;
  conversation: Pick<Conversation, "id" | "status">;
  contact: Pick<Contact, "id" | "name" | "phone">;
  /** Which relance to schedule (1-based). Defaults to 1. */
  step?: 1 | 2 | 3;
  /** Anchor time the delay is measured from. Defaults to now. */
  from?: Date;
}

/**
 * Schedule the next follow-up for a conversation. Cancels any other pending
 * follow-up first so a conversation never has two scheduled at once. No-op when
 * the conversation is in a terminal status or the step exceeds the max.
 */
export async function scheduleFollowUp(db: Db, args: ScheduleArgs): Promise<void> {
  const step = args.step ?? 1;
  if (step > MAX_FOLLOW_UPS) return;
  if (isTerminalForFollowUp(args.conversation.status)) return;

  // Only one pending follow-up per conversation.
  await db
    .from("follow_ups")
    .update({ status: "cancelled" })
    .eq("conversation_id", args.conversation.id)
    .eq("status", "scheduled");

  const delayHours = FOLLOW_UP_DELAYS_HOURS[step - 1];
  const base = args.from ?? new Date();
  const scheduledAt = new Date(base.getTime() + delayHours * HOUR_MS).toISOString();

  await db.from("follow_ups").insert({
    agent_id: args.agentId,
    conversation_id: args.conversation.id,
    contact_id: args.contact.id,
    step,
    scheduled_at: scheduledAt,
    status: "scheduled",
    message: buildFollowUpMessage(step, args.contact.name),
  });
}

/**
 * Stop the follow-up chain for a conversation. `responded` is used when the
 * prospect replied (so the history reads correctly); otherwise `cancelled`.
 */
export async function stopFollowUps(
  db: Db,
  conversationId: string,
  reason: "responded" | "cancelled" = "cancelled",
): Promise<void> {
  await db
    .from("follow_ups")
    .update({ status: reason })
    .eq("conversation_id", conversationId)
    .eq("status", "scheduled");
}

export interface RunResult {
  due: number;
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Send every follow-up whose scheduled time has passed, then schedule the next
 * step (up to the max). Skips conversations that turned terminal since the
 * follow-up was scheduled. Intended for a cron job (and the "run now" action).
 *
 * @param agentId  Restrict to a single agent (UI trigger). Omit for all (cron).
 */
export async function runDueFollowUps(agentId?: string): Promise<RunResult> {
  const db = createAdminClient();
  const result: RunResult = { due: 0, sent: 0, failed: 0, skipped: 0 };

  let query = db
    .from("follow_ups")
    .select("*")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(200);
  if (agentId) query = query.eq("agent_id", agentId);

  const { data: due } = await query;
  const rows = (due as DueRow[]) ?? [];
  result.due = rows.length;

  for (const fu of rows) {
    // Re-check the conversation: the prospect may have replied or converted
    // between scheduling and now.
    const { data: convo } = await db
      .from("conversations")
      .select("id, status")
      .eq("id", fu.conversation_id)
      .maybeSingle();
    const status = (convo as Pick<Conversation, "status"> | null)?.status;

    if (!status || isTerminalForFollowUp(status)) {
      await db.from("follow_ups").update({ status: "cancelled" }).eq("id", fu.id);
      result.skipped++;
      continue;
    }

    const { data: contact } = await db
      .from("contacts")
      .select("id, name, phone")
      .eq("id", fu.contact_id)
      .maybeSingle();
    const phone = (contact as Pick<Contact, "phone"> | null)?.phone;
    const message = fu.message ?? buildFollowUpMessage(fu.step, (contact as Contact | null)?.name);

    if (!phone) {
      await db.from("follow_ups").update({ status: "cancelled" }).eq("id", fu.id);
      result.skipped++;
      continue;
    }

    const ctx = fu.agent_id ? await resolveAgentContextById(fu.agent_id) : null;
    if (!ctx) {
      result.failed++;
      continue;
    }

    const sent = await sendWhatsAppText(phone, message, wasenderCredsOf(ctx));
    await db
      .from("follow_ups")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", fu.id);

    // Mirror the outbound nudge on the conversation timeline.
    await db.from("messages").insert({
      agent_id: fu.agent_id,
      conversation_id: fu.conversation_id,
      direction: "outbound",
      sender: "ai",
      content: message,
      wasender_id: sent.id ?? null,
    });
    await db
      .from("conversations")
      .update({ last_message_at: new Date().toISOString(), last_message_preview: message.slice(0, 160) })
      .eq("id", fu.conversation_id);

    if (!sent.ok) {
      console.error(`[follow-ups] WhatsApp send failed (fu ${fu.id}): ${sent.error}`);
      result.failed++;
    } else {
      result.sent++;
    }

    // Schedule the next relance, anchored so the cadence stays 24h / 72h / 168h
    // from the original inbound regardless of when the cron actually fires.
    const nextStep = (fu.step + 1) as 1 | 2 | 3;
    if (nextStep <= MAX_FOLLOW_UPS) {
      const gapHours = FOLLOW_UP_DELAYS_HOURS[nextStep - 1] - FOLLOW_UP_DELAYS_HOURS[fu.step - 1];
      await db.from("follow_ups").insert({
        agent_id: fu.agent_id,
        conversation_id: fu.conversation_id,
        contact_id: fu.contact_id,
        step: nextStep,
        scheduled_at: new Date(Date.now() + gapHours * HOUR_MS).toISOString(),
        status: "scheduled",
        message: buildFollowUpMessage(nextStep, (contact as Contact | null)?.name ?? null),
      });
    }
  }

  return result;
}

interface DueRow {
  id: string;
  agent_id: string | null;
  conversation_id: string;
  contact_id: string;
  step: 1 | 2 | 3;
  message: string | null;
}

/**
 * Default copy for each relance. Warm, short, WhatsApp-style — escalating from
 * a gentle nudge to a soft last touch, never pushy.
 */
export function buildFollowUpMessage(step: number, contactName?: string | null): string {
  const first = (contactName ?? "").trim().split(/\s+/)[0];
  const hi = first ? `Bonjour ${first} 👋` : "Bonjour 👋";
  switch (step) {
    case 1:
      return `${hi} Je reviens vers vous suite à notre échange. Avez-vous eu le temps d'y réfléchir ? Je reste dispo pour répondre à vos questions sur FasoStock 🙂`;
    case 2:
      return `${hi} Petit rappel concernant FasoStock pour mieux gérer votre stock et vos ventes. Souhaitez-vous que je vous montre comment ça marche en quelques minutes ?`;
    case 3:
      return `${hi} Je ne veux pas vous déranger davantage 🙏 Si vous le souhaitez encore, je peux vous organiser une démonstration quand vous voulez. Sinon, je vous laisse revenir vers moi quand le moment sera bon !`;
    default:
      return hi;
  }
}
