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

/** The kind of WhatsApp message received. */
export type InboundKind =
  | "text"
  | "audio"
  | "image"
  | "video"
  | "document"
  | "sticker"
  | "location"
  | "contact"
  | "other";

/** Media metadata pulled from a media message (encrypted until decrypted). */
export interface InboundMedia {
  url: string;
  mediaKey?: string;
  mimetype?: string;
  fileName?: string;
  caption?: string;
  ptt?: boolean; // true for voice notes (push-to-talk)
}

/** Normalised inbound message extracted from a Wasender webhook. */
export interface InboundMessage {
  from: string; // phone number / JID, normalised to digits
  name: string | null;
  text: string; // text body or media caption ("" for bare media)
  kind: InboundKind;
  media?: InboundMedia;
  /** Raw `data.messages` object, needed to decrypt media via Wasender. */
  rawMessage?: Record<string, unknown>;
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

/** Shape of the JSON Wasender returns from message/upload/decrypt endpoints. */
interface WasenderResponse {
  success?: boolean;
  message?: string;
  publicUrl?: string;
  id?: string | number;
  data?: { msgId?: string | number; id?: string | number };
}

/** Low-level POST to the Wasender /send-message endpoint with an arbitrary body. */
async function postSendMessage(payload: Record<string, unknown>): Promise<SendResult> {
  if (!features.wasender) return { ok: false, error: "wasender_not_configured" };
  const url = `${serverEnv.wasenderBaseUrl.replace(/\/$/, "")}/send-message`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serverEnv.wasenderApiKey}`,
      },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as WasenderResponse;
    if (!res.ok || data?.success === false) {
      return { ok: false, error: `Wasender: ${data?.message ?? `HTTP ${res.status}`}` };
    }
    const id = data?.data?.msgId ?? data?.data?.id ?? data?.id;
    return { ok: true, id: id ? String(id) : undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }
}

/** Send a WhatsApp voice note / audio message from a public URL. */
export async function sendWhatsAppAudio(to: string, audioUrl: string): Promise<SendResult> {
  if (!features.wasender) {
    console.warn("[wasender] WASENDER_API_KEY not set — audio not sent (dev mode).");
    return { ok: false, error: "wasender_not_configured" };
  }
  return postSendMessage({ to: toE164(to), audioUrl });
}

/** Send a WhatsApp image from a public URL, with an optional caption. */
export async function sendWhatsAppImage(
  to: string,
  imageUrl: string,
  caption?: string,
): Promise<SendResult> {
  if (!features.wasender) return { ok: false, error: "wasender_not_configured" };
  return postSendMessage({ to: toE164(to), imageUrl, ...(caption ? { text: caption } : {}) });
}

/**
 * Upload raw media bytes to Wasender and get back a public URL (valid ~24h)
 * usable as audioUrl/imageUrl on a subsequent send. Body is the raw binary.
 */
export async function uploadMediaToWasender(
  bytes: Uint8Array,
  mimetype: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!features.wasender) return { ok: false, error: "wasender_not_configured" };
  const url = `${serverEnv.wasenderBaseUrl.replace(/\/$/, "")}/upload`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": mimetype,
        Authorization: `Bearer ${serverEnv.wasenderApiKey}`,
      },
      body: bytes as BodyInit,
    });
    const data = (await res.json().catch(() => ({}))) as WasenderResponse;
    if (!res.ok || data?.success === false || !data?.publicUrl) {
      return { ok: false, error: `Wasender upload: ${data?.message ?? `HTTP ${res.status}`}` };
    }
    return { ok: true, url: String(data.publicUrl) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }
}

/**
 * Decrypt an incoming WhatsApp media message and get a temporary public URL
 * (valid ~1h). Pass the raw `data.messages` object from the webhook.
 */
export async function decryptMediaFile(
  rawMessage: Record<string, unknown>,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!features.wasender) return { ok: false, error: "wasender_not_configured" };
  const url = `${serverEnv.wasenderBaseUrl.replace(/\/$/, "")}/decrypt-media`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serverEnv.wasenderApiKey}`,
      },
      body: JSON.stringify({ data: { messages: rawMessage } }),
    });
    const data = (await res.json().catch(() => ({}))) as WasenderResponse;
    if (!res.ok || data?.success === false || !data?.publicUrl) {
      return { ok: false, error: `Wasender decrypt: ${data?.message ?? `HTTP ${res.status}`}` };
    }
    return { ok: true, url: String(data.publicUrl) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }
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

  // Plain text (or the unified messageBody Wasender flattens captions into).
  const plainText: string =
    msg.message?.conversation ??
    msg.message?.extendedTextMessage?.text ??
    msg.text ??
    msg.body ??
    (typeof p.message === "string" ? p.message : "") ??
    "";

  // Detect a media payload. WhatsApp wraps each kind in its own sub-object.
  const m = (msg.message ?? {}) as Record<string, unknown>;
  const { kind, media } = extractMedia(m);

  // Without text and without a recognised media kind, this isn't a usable
  // message (status update, receipt, reaction, etc.).
  const text = typeof plainText === "string" ? plainText.trim() : "";
  if (!text && kind === "text") return null;

  const tsRaw = msg.messageTimestamp ?? msg.timestamp ?? p.timestamp ?? Date.now();
  const ts = Number(tsRaw);
  const timestamp = ts > 1e12 ? ts : ts * 1000; // seconds → ms when needed

  return {
    from,
    name: msg.pushName ?? msg.notifyName ?? p.pushName ?? null,
    text: text || media?.caption?.trim() || "",
    kind,
    media,
    rawMessage: msg as Record<string, unknown>,
    messageId: key.id ?? msg.id ?? null,
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    fromMe,
  };
}

/** Identify the media kind in a WhatsApp `message` object and pull its fields. */
function extractMedia(m: Record<string, unknown>): { kind: InboundKind; media?: InboundMedia } {
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  const pick = (node: unknown): InboundMedia => {
    const n = (node ?? {}) as Record<string, unknown>;
    return {
      url: str(n.url) ?? "",
      mediaKey: str(n.mediaKey),
      mimetype: str(n.mimetype),
      fileName: str(n.fileName),
      caption: str(n.caption),
      ptt: Boolean(n.ptt),
    };
  };

  if (m.audioMessage) return { kind: "audio", media: pick(m.audioMessage) };
  if (m.imageMessage) return { kind: "image", media: pick(m.imageMessage) };
  if (m.videoMessage) return { kind: "video", media: pick(m.videoMessage) };
  if (m.documentMessage) return { kind: "document", media: pick(m.documentMessage) };
  if (m.documentWithCaptionMessage) {
    const inner = (m.documentWithCaptionMessage as Record<string, unknown>)?.message as
      | Record<string, unknown>
      | undefined;
    return { kind: "document", media: pick(inner?.documentMessage) };
  }
  if (m.stickerMessage) return { kind: "sticker", media: pick(m.stickerMessage) };
  if (m.locationMessage) return { kind: "location" };
  if (m.contactMessage || m.contactsArrayMessage) return { kind: "contact" };
  return { kind: "text" };
}

/** Reduce a phone/JID to digits (strips @s.whatsapp.net, +, spaces). */
export function normalizePhone(value: string): string {
  if (!value) return "";
  return value.split("@")[0].replace(/[^\d]/g, "");
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
