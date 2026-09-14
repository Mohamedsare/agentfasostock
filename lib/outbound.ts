import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAgentContextById, wasenderCredsOf } from "@/lib/agents";
import {
  sendWhatsAppAudio,
  sendWhatsAppDocument,
  sendWhatsAppImage,
  sendWhatsAppVideo,
  type SendResult,
  type WasenderCreds,
} from "@/lib/wasender";
import type { AgentMediaAttachment } from "@/lib/types";

/**
 * Outbound media queue — product photos must reach the client, however many.
 *
 * Sending 4 photos in a row runs into Wasender's account protection (1 message
 * every 5 s), transient API errors and the serverless time limit. So every
 * attachment is first persisted in `outbound_media`, then delivered in order:
 * - right after the webhook answers (`after()`, lib/../webhooks route),
 * - leftovers and retries by the cron (`/api/outbound/run`),
 * with a conditional claim so two runs never send the same photo, stale claims
 * taken back after a crash/timeout, backoff retries, and an image WhatsApp
 * refuses re-sent as a file. Only after MAX_SEND_ATTEMPTS is an item marked
 * failed (and logged as `media_send_failed`).
 */

type Db = ReturnType<typeof createAdminClient>;

export const MAX_SEND_ATTEMPTS = 6;
/** Wait before the next try after failed attempt N (always ≥ Wasender's own retry_after). */
const RETRY_DELAYS_MS = [10_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
/** A retry due this soon is waited out inline instead of being left to the cron. */
const MAX_INLINE_WAIT_MS = 20_000;
/** A "sending" row older than this belongs to a run that crashed or timed out. */
const STALE_SENDING_MS = 3 * 60_000;
/** WhatsApp images: JPEG/PNG up to 5 MB (Wasender docs). */
const MAX_WHATSAPP_IMAGE_BYTES = 5 * 1024 * 1024;

export type OutboundStatus = "pending" | "sending" | "sent" | "failed";

export interface OutboundItem {
  id: string;
  agent_id: string;
  conversation_id: string;
  to_phone: string;
  type: AgentMediaAttachment["type"];
  url: string;
  caption: string | null;
  position: number;
  status: OutboundStatus;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  updated_at?: string;
}

export type NewOutboundItem = Pick<
  OutboundItem,
  "agent_id" | "conversation_id" | "to_phone" | "type" | "url" | "caption" | "position"
>;

export type OutboundPatch = Partial<Pick<OutboundItem, "status" | "attempts" | "next_attempt_at" | "last_error">> & {
  wasender_id?: string | null;
  sent_at?: string;
};

/** Queue persistence — Supabase in production, swappable (in-memory) for tests. */
export interface OutboundStore {
  /** Returns false when the queue can't be used (e.g. table not migrated yet). */
  enqueue(items: NewOutboundItem[]): Promise<boolean>;
  /** Unfinished items of a conversation, in send order (stale claims released first). */
  listOpen(conversationId: string): Promise<OutboundItem[]>;
  /** Conversations with an item ready to send now. */
  conversationsWithDue(opts: { agentId?: string; limit: number }): Promise<string[]>;
  /** Atomically take a pending item. False when another run already took it. */
  claim(item: OutboundItem): Promise<boolean>;
  update(id: string, patch: OutboundPatch): Promise<void>;
  /** Mirror a delivered attachment on the conversation timeline. */
  recordDelivered(item: OutboundItem, wasenderId: string | undefined): Promise<void>;
  /** Final failure: visible in the activity journal. */
  recordFailure(item: OutboundItem, error: string): Promise<void>;
}

export function supabaseOutboundStore(db: Db = createAdminClient()): OutboundStore {
  const staleBefore = () => new Date(Date.now() - STALE_SENDING_MS).toISOString();
  return {
    async enqueue(items) {
      if (items.length === 0) return true;
      const { error } = await db.from("outbound_media").insert(items);
      if (error) console.error("[outbound] enqueue failed:", error.message);
      return !error;
    },
    async listOpen(conversationId) {
      await db
        .from("outbound_media")
        .update({ status: "pending" })
        .eq("conversation_id", conversationId)
        .eq("status", "sending")
        .lt("updated_at", staleBefore());
      const { data } = await db
        .from("outbound_media")
        .select("*")
        .eq("conversation_id", conversationId)
        .in("status", ["pending", "sending"])
        .order("created_at", { ascending: true })
        .order("position", { ascending: true });
      return (data as OutboundItem[]) ?? [];
    },
    async conversationsWithDue({ agentId, limit }) {
      let due = db
        .from("outbound_media")
        .select("conversation_id")
        .eq("status", "pending")
        .lte("next_attempt_at", new Date().toISOString())
        .order("next_attempt_at", { ascending: true })
        .limit(limit * 4);
      let stale = db
        .from("outbound_media")
        .select("conversation_id")
        .eq("status", "sending")
        .lt("updated_at", staleBefore())
        .limit(limit);
      if (agentId) {
        due = due.eq("agent_id", agentId);
        stale = stale.eq("agent_id", agentId);
      }
      const [a, b] = await Promise.all([due, stale]);
      const rows = [...((a.data as { conversation_id: string }[]) ?? []), ...((b.data as { conversation_id: string }[]) ?? [])];
      return [...new Set(rows.map((r) => r.conversation_id))].slice(0, limit);
    },
    async claim(item) {
      const { data } = await db
        .from("outbound_media")
        .update({ status: "sending" })
        .eq("id", item.id)
        .eq("status", "pending")
        .select("id");
      return (data?.length ?? 0) === 1;
    },
    async update(id, patch) {
      await db.from("outbound_media").update(patch).eq("id", id);
    },
    async recordDelivered(item, wasenderId) {
      await db.from("messages").insert({
        agent_id: item.agent_id,
        conversation_id: item.conversation_id,
        direction: "outbound",
        sender: "ai",
        // URL first so the dashboard renders the photo (components/ui/media-attachments.tsx).
        content: `[${item.type}] ${item.url}${item.caption ? `\n${item.caption}` : ""}`,
        wasender_id: wasenderId ?? null,
      });
    },
    async recordFailure(item, error) {
      await db.from("audit_logs").insert({
        agent_id: item.agent_id,
        actor: "wasender",
        action: "media_send_failed",
        entity: "conversation",
        entity_id: item.conversation_id,
        metadata: { type: item.type, url: item.url, attempts: item.attempts, error },
      });
    },
  };
}

// ─────────────────────────── Sending ───────────────────────────

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Check a photo WhatsApp will actually accept. "unsupported" = reachable but
 * wrong format/too big (e.g. WebP catalog images); "unknown" = couldn't tell
 * (HEAD not allowed, timeout) — then we just try.
 */
export async function probeImage(url: string): Promise<"ok" | "unsupported" | "unknown"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { method: "HEAD", signal: controller.signal, redirect: "follow" });
    if (!res.ok) return "unknown";
    const type = res.headers.get("content-type")?.toLowerCase() ?? "";
    const size = Number(res.headers.get("content-length"));
    if (type && !/image\/(jpe?g|png)/.test(type)) return "unsupported";
    if (Number.isFinite(size) && size > MAX_WHATSAPP_IMAGE_BYTES) return "unsupported";
    return "ok";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}

function fileNameOf(url: string): string {
  try {
    return decodeURIComponent(url.split("?")[0].split("/").pop() || "photo");
  } catch {
    return "photo";
  }
}

export async function sendAttachment(
  phone: string,
  attachment: AgentMediaAttachment,
  creds: WasenderCreds,
): Promise<SendResult> {
  switch (attachment.type) {
    case "image": {
      // A photo WhatsApp refuses as an image still reaches the client as a file.
      if ((await probeImage(attachment.url)) === "unsupported") {
        return sendWhatsAppDocument(phone, attachment.url, creds, fileNameOf(attachment.url), attachment.caption);
      }
      const res = await sendWhatsAppImage(phone, attachment.url, creds, attachment.caption);
      if (!res.ok && res.retryable === false) {
        const asFile = await sendWhatsAppDocument(phone, attachment.url, creds, fileNameOf(attachment.url), attachment.caption);
        if (asFile.ok) return asFile;
      }
      return res;
    }
    case "document":
      return sendWhatsAppDocument(phone, attachment.url, creds, attachment.caption, attachment.caption);
    case "video":
      return sendWhatsAppVideo(phone, attachment.url, creds, attachment.caption);
    case "audio":
      return sendWhatsAppAudio(phone, attachment.url, creds);
    default:
      return { ok: false, error: "unknown_type", retryable: false };
  }
}

// ─────────────────────────── Queue API ───────────────────────────

type CredsResolver = (agentId: string) => Promise<WasenderCreds | null>;

async function defaultCredsFor(agentId: string): Promise<WasenderCreds | null> {
  const ctx = await resolveAgentContextById(agentId);
  return ctx ? wasenderCredsOf(ctx) : null;
}

/** Persist a reply's attachments for ordered, retried delivery. False = queue unavailable. */
export async function queueOutboundMedia(
  args: { agentId: string; conversationId: string; phone: string; media: AgentMediaAttachment[] },
  store: OutboundStore = supabaseOutboundStore(),
): Promise<boolean> {
  return store.enqueue(
    args.media.map((m, position) => ({
      agent_id: args.agentId,
      conversation_id: args.conversationId,
      to_phone: args.phone,
      type: m.type,
      url: m.url,
      caption: m.caption ?? null,
      position,
    })),
  );
}

export interface FlushStats {
  sent: number;
  retried: number;
  failed: number;
}

/**
 * Deliver one conversation's queued attachments, strictly in order, until done
 * or the deadline. An item waiting for its retry time blocks the ones after it
 * (the client never gets photo 3 before photo 2).
 */
export async function flushConversation(
  conversationId: string,
  opts: { deadline: number; store?: OutboundStore; credsFor?: CredsResolver },
): Promise<FlushStats> {
  const store = opts.store ?? supabaseOutboundStore();
  const credsFor = opts.credsFor ?? defaultCredsFor;
  const credsCache = new Map<string, Promise<WasenderCreds | null>>();
  const stats: FlushStats = { sent: 0, retried: 0, failed: 0 };

  while (Date.now() < opts.deadline) {
    const [next] = await store.listOpen(conversationId);
    if (!next) break;
    if (next.status === "sending") break; // another run is delivering this conversation

    const waitMs = new Date(next.next_attempt_at).getTime() - Date.now();
    if (waitMs > 0) {
      if (waitMs <= MAX_INLINE_WAIT_MS && Date.now() + waitMs < opts.deadline) {
        await delay(waitMs);
        continue;
      }
      break; // the cron resumes when it's due
    }
    if (!(await store.claim(next))) break;

    const attempt = next.attempts + 1;
    if (!credsCache.has(next.agent_id)) credsCache.set(next.agent_id, credsFor(next.agent_id));
    const creds = await credsCache.get(next.agent_id);
    const res: SendResult = creds?.apiKey
      ? await sendAttachment(next.to_phone, { type: next.type, url: next.url, caption: next.caption ?? undefined }, creds)
      : { ok: false, error: "wasender_not_connected", retryable: true };

    if (res.ok) {
      await store.update(next.id, {
        status: "sent",
        attempts: attempt,
        sent_at: new Date().toISOString(),
        wasender_id: res.id ?? null,
        last_error: null,
      });
      await store.recordDelivered(next, res.id);
      stats.sent++;
      continue;
    }

    const error = res.error ?? "unknown_error";
    // A permanent refusal (bad URL…) gets one more chance, a transient one the full schedule.
    const exhausted = attempt >= MAX_SEND_ATTEMPTS || (res.retryable === false && attempt >= 2);
    if (exhausted) {
      await store.update(next.id, { status: "failed", attempts: attempt, last_error: error });
      await store.recordFailure({ ...next, attempts: attempt }, error);
      console.error(`[outbound] ${next.type} ${next.url} failed after ${attempt} attempts: ${error}`);
      stats.failed++;
      continue;
    }
    const retryIn = Math.max(res.retryAfterMs ?? 0, RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]);
    await store.update(next.id, {
      status: "pending",
      attempts: attempt,
      last_error: error,
      next_attempt_at: new Date(Date.now() + retryIn).toISOString(),
    });
    stats.retried++;
  }
  return stats;
}

/** Deliver everything that is due (one agent from the webhook, or all agents from the cron). */
export async function flushOutbound(opts: {
  budgetMs: number;
  agentId?: string;
  store?: OutboundStore;
  credsFor?: CredsResolver;
}): Promise<FlushStats & { conversations: number }> {
  const deadline = Date.now() + opts.budgetMs;
  const store = opts.store ?? supabaseOutboundStore();
  const totals = { conversations: 0, sent: 0, retried: 0, failed: 0 };
  const conversations = await store.conversationsWithDue({ agentId: opts.agentId, limit: 50 });
  for (const conversationId of conversations) {
    if (Date.now() >= deadline) break;
    const r = await flushConversation(conversationId, { deadline, store, credsFor: opts.credsFor });
    totals.conversations++;
    totals.sent += r.sent;
    totals.retried += r.retried;
    totals.failed += r.failed;
  }
  return totals;
}

/**
 * Fallback when the queue table isn't migrated yet: send right away, in order
 * (the Wasender layer still paces and retries).
 */
export async function sendMediaDirect(
  db: Db,
  args: { agentId: string; conversationId: string; phone: string; media: AgentMediaAttachment[]; creds: WasenderCreds },
): Promise<void> {
  const store = supabaseOutboundStore(db);
  for (const [position, m] of args.media.entries()) {
    const item: OutboundItem = {
      id: "direct",
      agent_id: args.agentId,
      conversation_id: args.conversationId,
      to_phone: args.phone,
      type: m.type,
      url: m.url,
      caption: m.caption ?? null,
      position,
      status: "sending",
      attempts: 1,
      next_attempt_at: new Date().toISOString(),
      last_error: null,
      created_at: new Date().toISOString(),
    };
    const res = await sendAttachment(args.phone, m, args.creds);
    if (res.ok) await store.recordDelivered(item, res.id);
    else await store.recordFailure(item, res.error ?? "unknown_error");
  }
}
