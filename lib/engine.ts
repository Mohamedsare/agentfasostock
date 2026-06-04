import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateAgentResult } from "@/lib/ai";
import { sendWhatsAppText, sendLeadWhatsApp, type InboundMessage } from "@/lib/wasender";
import { scoreConversation, shouldNotifyAdmin } from "@/lib/scoring";
import { DEFAULT_AGENT_SETTINGS } from "@/lib/constants";
import type {
  AgentResult,
  AgentSettings,
  Contact,
  Conversation,
  EmailTrigger,
  KnowledgeBaseEntry,
  LeadStatus,
  Message,
} from "@/lib/types";

type Db = ReturnType<typeof createAdminClient>;

export interface InboundResult {
  status: "processed" | "ignored" | "duplicate";
  conversationId?: string;
  reply?: string;
  leadStatus?: LeadStatus;
  score?: number;
  reason?: string;
  sent?: boolean;
  sendError?: string;
}

/**
 * Core conversation pipeline (CLAUDE.md §20). Runs with the service-role client
 * so it works from webhooks without a user session. Idempotent on the inbound
 * Wasender message id.
 */
export async function handleInboundMessage(inbound: InboundMessage): Promise<InboundResult> {
  if (inbound.fromMe) return { status: "ignored", reason: "outgoing_echo" };
  if (!inbound.text) return { status: "ignored", reason: "empty" };

  const db = createAdminClient();

  // Dedupe on the provider message id.
  if (inbound.messageId) {
    const { data: existing } = await db
      .from("messages")
      .select("id")
      .eq("wasender_id", inbound.messageId)
      .maybeSingle();
    if (existing) return { status: "duplicate" };
  }

  const contact = await upsertContact(db, inbound);
  const conversation = await getOrCreateConversation(db, contact.id);

  // Save the inbound message + bump conversation metadata.
  await db.from("messages").insert({
    conversation_id: conversation.id,
    direction: "inbound",
    sender: "contact",
    content: inbound.text,
    wasender_id: inbound.messageId,
  });
  await db
    .from("conversations")
    .update({
      last_message_at: new Date(inbound.timestamp).toISOString(),
      last_message_preview: inbound.text.slice(0, 160),
      unread_count: conversation.unread_count + 1,
    })
    .eq("id", conversation.id);

  await logAudit(db, "contact", "inbound_message", conversation.id, { phone: contact.phone });

  // Decide whether the AI should reply.
  const settings = await getAgentSettings(db);
  const aiShouldReply =
    settings.ai_enabled && conversation.ai_enabled && conversation.mode === "ai";

  if (!aiShouldReply) {
    return {
      status: "processed",
      conversationId: conversation.id,
      reason: "ai_disabled_or_human_mode",
    };
  }

  // Build context from recent history (oldest → newest).
  const history = await getRecentHistory(db, conversation.id);
  const knowledge = await getActiveKnowledge(db);

  const result = await generateAgentResult({
    messages: history,
    settings,
    knowledge,
    previousScore: conversation.score,
  });

  await applyAgentResult(db, { conversation, contact, result, history });

  // On a human handoff we deliberately stay silent with the prospect: never
  // tell them the agent can't help or that we're passing them to someone else.
  // The admin email (in applyAgentResult) fires immediately so Mohamed can pick
  // up the conversation in person without the prospect noticing the switch.
  const isHandoff = result.status === "humain_requis";

  // Send the reply over WhatsApp (skip for spam / empty / human handoff).
  let sent: { ok: boolean; id?: string; error?: string } = { ok: false, error: "no_reply" };
  if (result.reply && result.status !== "spam" && !isHandoff) {
    sent = await sendWhatsAppText(contact.phone, result.reply);
    if (!sent.ok) {
      console.error(`[engine] WhatsApp send failed for ${contact.phone}: ${sent.error}`);
    }
    await db.from("messages").insert({
      conversation_id: conversation.id,
      direction: "outbound",
      sender: "ai",
      content: result.reply,
      intent: result.intent,
      wasender_id: sent.id ?? null,
    });
  }

  return {
    status: "processed",
    conversationId: conversation.id,
    reply: result.reply,
    leadStatus: result.status,
    score: result.score,
    sent: sent.ok,
    sendError: sent.ok ? undefined : sent.error,
  };
}

/** Persist scoring/status/summary, a qualification record, and notify if needed. */
async function applyAgentResult(
  db: Db,
  args: {
    conversation: Conversation;
    contact: Contact;
    result: AgentResult;
    history: { role: "user" | "assistant"; content: string }[];
  },
) {
  const { conversation, contact, result } = args;
  const isHandoff = result.status === "humain_requis";

  await db
    .from("conversations")
    .update({
      status: result.status,
      score: result.score,
      intent: result.intent,
      summary: result.summary,
      next_action: result.next_action,
      last_message_at: new Date().toISOString(),
      last_message_preview: result.reply.slice(0, 160),
      // Hand the conversation over to Mohamed and silence the AI so it stops
      // replying — the prospect keeps talking to "the same person".
      ...(isHandoff ? { mode: "human", ai_enabled: false } : {}),
    })
    .eq("id", conversation.id);

  // Store a qualification snapshot with the matched criteria.
  const contactText = args.history.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  const { criteria } = scoreConversation(contactText, conversation.score);
  await db.from("lead_qualifications").insert({
    conversation_id: conversation.id,
    contact_id: contact.id,
    score: result.score,
    status: result.status,
    intent: result.intent,
    summary: result.summary,
    next_action: result.next_action,
    criteria,
  });

  // Email the admin on notable transitions (avoid spamming on every message).
  // A human handoff always alerts immediately — that's the whole point of the
  // silent handoff: Mohamed must know straight away to take over.
  const trigger = emailTriggerFor(result.status);
  const becameNotable = result.status !== conversation.status && shouldNotifyAdmin(result.status);
  if (trigger && (isHandoff || becameNotable)) {
    await notifyAdmin(db, { trigger, contact, conversation: { ...conversation, ...result } });
  }
}

async function notifyAdmin(
  db: Db,
  args: { trigger: EmailTrigger; contact: Contact; conversation: Conversation & AgentResult },
) {
  const { trigger, contact, conversation } = args;
  // Mohamed is alerted over WhatsApp (not email) when a lead becomes notable.
  const sent = await sendLeadWhatsApp({
    trigger,
    contact,
    conversation: {
      ...conversation,
      status: conversation.status,
      score: conversation.score,
      summary: conversation.summary,
      next_action: conversation.next_action,
    } as Conversation,
  });

  if (!sent.ok) {
    console.error(`[engine] admin WhatsApp alert failed (${trigger}): ${sent.error}`);
  }

  // Keep a notification trail even though the channel is now WhatsApp.
  await db.from("email_notifications").insert({
    trigger,
    to_email: process.env.ADMIN_WHATSAPP ?? "+212771668079",
    subject: `WhatsApp · ${trigger}`,
    conversation_id: conversation.id,
    contact_id: contact.id,
    status: sent.ok ? "sent" : "failed",
    error: sent.error ?? null,
    sent_at: sent.ok ? new Date().toISOString() : null,
  });
}

// ─────────────────────────── helpers ───────────────────────────

async function upsertContact(db: Db, inbound: InboundMessage): Promise<Contact> {
  const { data: existing } = await db
    .from("contacts")
    .select("*")
    .eq("phone", inbound.from)
    .maybeSingle();

  if (existing) {
    // Fill in the name from the WhatsApp profile if we didn't have one.
    if (!existing.name && inbound.name) {
      await db.from("contacts").update({ name: inbound.name }).eq("id", existing.id);
      existing.name = inbound.name;
    }
    return existing as Contact;
  }

  const { data: created, error } = await db
    .from("contacts")
    .insert({ phone: inbound.from, name: inbound.name, source: "whatsapp" })
    .select("*")
    .single();
  if (error || !created) throw new Error(`contact upsert failed: ${error?.message}`);
  return created as Contact;
}

async function getOrCreateConversation(db: Db, contactId: string): Promise<Conversation> {
  const { data: existing } = await db
    .from("conversations")
    .select("*")
    .eq("contact_id", contactId)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing as Conversation;

  const { data: created, error } = await db
    .from("conversations")
    .insert({ contact_id: contactId, status: "nouveau", mode: "ai", ai_enabled: true })
    .select("*")
    .single();
  if (error || !created) throw new Error(`conversation create failed: ${error?.message}`);
  return created as Conversation;
}

async function getRecentHistory(
  db: Db,
  conversationId: string,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const { data } = await db
    .from("messages")
    .select("sender, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(20);

  const rows = ((data as Pick<Message, "sender" | "content">[]) ?? []).reverse();
  return rows
    .filter((m) => m.sender !== "system")
    .map((m) => ({
      role: m.sender === "contact" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));
}

async function getAgentSettings(db: Db): Promise<AgentSettings> {
  const { data } = await db.from("agent_settings").select("*").limit(1).maybeSingle();
  if (data) return data as AgentSettings;
  return {
    id: "default",
    agent_name: DEFAULT_AGENT_SETTINGS.agent_name,
    tone: DEFAULT_AGENT_SETTINGS.tone,
    language: DEFAULT_AGENT_SETTINGS.language,
    welcome_message: DEFAULT_AGENT_SETTINGS.welcome_message,
    system_prompt: "",
    qualification_rules: "",
    human_handoff_rules: "",
    qualified_threshold: DEFAULT_AGENT_SETTINGS.qualified_threshold,
    hot_threshold: DEFAULT_AGENT_SETTINGS.hot_threshold,
    ai_enabled: true,
    operating_mode: DEFAULT_AGENT_SETTINGS.operating_mode,
    updated_at: new Date().toISOString(),
  };
}

async function getActiveKnowledge(db: Db): Promise<KnowledgeBaseEntry[]> {
  const { data } = await db.from("knowledge_base").select("*").eq("is_active", true);
  return (data as KnowledgeBaseEntry[]) ?? [];
}

function emailTriggerFor(status: LeadStatus): EmailTrigger | null {
  switch (status) {
    case "prospect_qualifie":
      return "prospect_qualifie";
    case "prospect_chaud":
      return "prospect_chaud";
    case "client_converti":
      return "client_converti";
    case "humain_requis":
      return "humain_requis";
    default:
      return null;
  }
}

async function logAudit(
  db: Db,
  actor: string,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await db.from("audit_logs").insert({ actor, action, entity: "conversation", entity_id: entityId, metadata });
  } catch {
    // auditing is best-effort
  }
}
