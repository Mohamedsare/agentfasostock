import "server-only";
import { serverEnv, features } from "@/lib/env";
import { LEAD_STATUS_META } from "@/lib/constants";
import type { Contact, Conversation, EmailTrigger } from "@/lib/types";

/**
 * Wasender API service (CLAUDE.md §18).
 * Handles outbound text messages with a simple retry, and normalises the
 * inbound webhook payload. Never hardcodes credentials.
 */

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/** Normalised inbound message extracted from a Wasender webhook. */
export interface InboundMessage {
  from: string; // phone number / JID, normalised to digits
  name: string | null;
  text: string;
  messageId: string | null;
  timestamp: number; // epoch ms
  fromMe: boolean;
}

const MAX_RETRIES = 2;

/** Send a WhatsApp text message, retrying transient failures. */
export async function sendWhatsAppText(to: string, text: string): Promise<SendResult> {
  if (!features.wasender) {
    console.warn("[wasender] WASENDER_API_KEY not set — message not sent (dev mode).");
    return { ok: false, error: "wasender_not_configured" };
  }

  const url = `${serverEnv.wasenderBaseUrl.replace(/\/$/, "")}/send-message`;
  // Wasender requires E.164 (with leading "+"). normalizePhone yields digits.
  const body = JSON.stringify({ to: toE164(to), text });

  let lastError = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serverEnv.wasenderApiKey}`,
        },
        body,
      });

      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        // Wasender returns HTTP 200 even on logical failures (e.g. disconnected
        // session) with `{ success: false, message }`. Treat that as a failure.
        if (data && data.success === false) {
          lastError = `Wasender: ${(data.message as string) ?? "échec d'envoi"}`;
          break;
        }
        const id =
          (data?.data as { msgId?: string; id?: string })?.msgId ??
          (data?.data as { id?: string })?.id ??
          (data as { id?: string })?.id;
        return { ok: true, id: id ? String(id) : undefined };
      }

      lastError = `HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`;
      // Don't retry on 4xx (incl. 429 rate-limit, where retry_after is ~minutes);
      // only transient 5xx / network errors are worth retrying.
      if (res.status < 500) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "network error";
    }
    if (attempt < MAX_RETRIES) await delay(400 * (attempt + 1));
  }

  console.error("[wasender] send failed:", lastError);
  return { ok: false, error: lastError };
}

const TRIGGER_HEADER: Record<EmailTrigger, (name: string) => string> = {
  prospect_qualifie: (n) => `🟢 Prospect qualifié — ${n}`,
  prospect_chaud: (n) => `🔥 Prospect chaud — ${n} (appeler vite)`,
  client_converti: (n) => `🎉 Client converti — ${n}`,
  humain_requis: (n) => `🙋 Reprise humaine requise — ${n}`,
  support_important: (n) => `⚠️ Support important — ${n}`,
};

export interface LeadAlertInput {
  trigger: EmailTrigger;
  contact: Contact;
  conversation: Conversation;
}

/**
 * Send a lead alert to Mohamed over WhatsApp (replaces the admin email).
 * Goes to ADMIN_WHATSAPP. Returns a SendResult so callers can log success.
 */
export async function sendLeadWhatsApp(input: LeadAlertInput): Promise<SendResult> {
  const { trigger, contact, conversation } = input;
  const name = contact.name?.trim() || contact.phone;
  const statusLabel = LEAD_STATUS_META[conversation.status]?.label ?? conversation.status;
  const appUrl = serverEnv.appUrl.replace(/\/$/, "");
  const link = `${appUrl}/dashboard/conversations/${conversation.id}`;

  const lines = [
    TRIGGER_HEADER[trigger](name),
    "",
    `📞 ${contact.phone}`,
    contact.business_type ? `🏪 Activité : ${contact.business_type}` : null,
    contact.city ? `📍 Ville : ${contact.city}` : null,
    `⭐ Score : ${conversation.score}/100`,
    `📌 Statut : ${statusLabel}`,
    contact.need ? `🎯 Besoin : ${contact.need}` : null,
    conversation.summary ? `\n📝 Résumé : ${conversation.summary}` : null,
    conversation.next_action ? `➡️ Action : ${conversation.next_action}` : null,
    "",
    `🔗 ${link}`,
  ].filter((l): l is string => l !== null);

  return sendWhatsAppText(serverEnv.adminWhatsapp, lines.join("\n"));
}

/** Format a phone/JID as E.164 (digits with a leading "+"), as Wasender expects. */
export function toE164(value: string): string {
  const digits = normalizePhone(value);
  return digits ? `+${digits}` : "";
}

/**
 * Parse an incoming Wasender webhook body into a normalised inbound message.
 * Returns null when the payload is not a usable inbound text message.
 */
export function parseWasenderWebhook(payload: unknown): InboundMessage | null {
  if (!payload || typeof payload !== "object") return null;
  // Wasender payloads vary by plan and are not statically typed; we navigate
  // them defensively and validate every field we extract below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = payload as Record<string, any>;

  // Wasender posts: { event: "messages.upsert", data: { messages: {...} } }
  const msg = p.data?.messages ?? p.data?.message ?? p.message ?? p.data ?? p;
  if (!msg || typeof msg !== "object") return null;

  const key = msg.key ?? {};
  const fromMe: boolean = Boolean(key.fromMe ?? msg.fromMe);

  // Resolve the sender's real phone. WhatsApp now sometimes addresses contacts
  // with an opaque "@lid" identifier instead of their phone "@s.whatsapp.net".
  // Baileys (used by Wasender) carries the real phone in senderPn/remoteJidAlt,
  // so we collect every candidate and prefer a genuine phone JID over a LID.
  const candidates: string[] = [
    key.senderPn,
    key.remoteJidAlt,
    msg.senderPn,
    msg.remoteJidAlt,
    p.senderPn,
    key.remoteJid,
    msg.remoteJid,
    msg.from,
    p.from,
  ].filter((v): v is string => typeof v === "string" && v.length > 0);

  const phoneJid = candidates.find((c) => c.includes("@s.whatsapp.net"));
  const from = normalizePhone(phoneJid ?? candidates[0] ?? "");
  if (!from) return null;

  const text: string =
    msg.message?.conversation ??
    msg.message?.extendedTextMessage?.text ??
    msg.text ??
    msg.body ??
    (typeof p.message === "string" ? p.message : "") ??
    "";

  if (!text || typeof text !== "string") return null;

  const tsRaw = msg.messageTimestamp ?? msg.timestamp ?? p.timestamp ?? Date.now();
  const ts = Number(tsRaw);
  const timestamp = ts > 1e12 ? ts : ts * 1000; // seconds → ms when needed

  return {
    from,
    name: msg.pushName ?? msg.notifyName ?? p.pushName ?? null,
    text: text.trim(),
    messageId: key.id ?? msg.id ?? null,
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    fromMe,
  };
}

/** Reduce a phone/JID to digits (strips @s.whatsapp.net, +, spaces). */
export function normalizePhone(value: string): string {
  if (!value) return "";
  return value.split("@")[0].replace(/[^\d]/g, "");
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
