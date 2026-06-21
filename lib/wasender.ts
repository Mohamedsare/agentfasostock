import "server-only";
import { serverEnv } from "@/lib/env";
import { LEAD_STATUS_META } from "@/lib/constants";
import type { AgentConnectionStatus, Contact, Conversation, EmailTrigger } from "@/lib/types";

/**
 * Wasender API service (CLAUDE.md §18).
 * Handles outbound text messages with a simple retry, and normalises the
 * inbound webhook payload. Never hardcodes credentials.
 */

/**
 * Normalise a raw Wasender session status string into our connection enum.
 * Order matters: "disconnected" *contains* "connected", so the negative cases
 * must be tested first.
 */
export function mapSessionStatus(raw: string | null | undefined): AgentConnectionStatus {
  const s = (raw ?? "").toLowerCase();
  if (!s) return "disconnected";
  if (/(disconnect|logout|logged_out|expired|offline|unpaired|closed)/.test(s)) return "disconnected";
  if (/(fail|error)/.test(s)) return "error";
  if (s.includes("connected")) return "connected";
  if (/(connecting|scan|qr|pending|require|init|starting)/.test(s)) return "connecting";
  return "disconnected";
}

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/**
 * Per-tenant Wasender credentials used to SEND from a specific agent's session.
 * `apiKey` is the per-session key (null until the agent's number is connected).
 */
export interface WasenderCreds {
  apiKey: string | null;
  baseUrl: string;
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
  /** WhatsApp opaque "@lid" id (full jid, e.g. "1234@lid"), when present. */
  lid: string | null;
  name: string | null;
  text: string; // text body or media caption ("" for bare media)
  kind: InboundKind;
  media?: InboundMedia;
  /** Raw `data.messages` object, needed to decrypt media via Wasender. */
  rawMessage?: Record<string, unknown>;
  /** Wasender session id (top-level payload field) — routes to the agent. */
  sessionId: string | null;
  messageId: string | null;
  timestamp: number; // epoch ms
  fromMe: boolean;
}

const MAX_RETRIES = 2;

/** Send a WhatsApp text message, retrying transient failures. */
export async function sendWhatsAppText(
  to: string,
  text: string,
  creds: WasenderCreds,
): Promise<SendResult> {
  if (!creds.apiKey) {
    console.warn("[wasender] agent has no session key — message not sent.");
    return { ok: false, error: "wasender_not_connected" };
  }

  const url = `${creds.baseUrl.replace(/\/$/, "")}/send-message`;
  // Wasender requires E.164 (with leading "+"). normalizePhone yields digits.
  const body = JSON.stringify({ to: toE164(to), text });

  let lastError = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${creds.apiKey}`,
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
async function postSendMessage(
  payload: Record<string, unknown>,
  creds: WasenderCreds,
): Promise<SendResult> {
  if (!creds.apiKey) return { ok: false, error: "wasender_not_connected" };
  const url = `${creds.baseUrl.replace(/\/$/, "")}/send-message`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${creds.apiKey}`,
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
export async function sendWhatsAppAudio(
  to: string,
  audioUrl: string,
  creds: WasenderCreds,
): Promise<SendResult> {
  return postSendMessage({ to: toE164(to), audioUrl }, creds);
}

/** Send a WhatsApp image from a public URL, with an optional caption. */
export async function sendWhatsAppImage(
  to: string,
  imageUrl: string,
  creds: WasenderCreds,
  caption?: string,
): Promise<SendResult> {
  return postSendMessage({ to: toE164(to), imageUrl, ...(caption ? { text: caption } : {}) }, creds);
}

/** Send a WhatsApp document (PDF, Word, Excel…) from a public URL. */
export async function sendWhatsAppDocument(
  to: string,
  documentUrl: string,
  creds: WasenderCreds,
  fileName?: string,
  caption?: string,
): Promise<SendResult> {
  return postSendMessage({
    to: toE164(to),
    documentUrl,
    ...(fileName ? { fileName } : {}),
    ...(caption ? { text: caption } : {}),
  }, creds);
}

/** Send a WhatsApp video from a public URL, with an optional caption. */
export async function sendWhatsAppVideo(
  to: string,
  videoUrl: string,
  creds: WasenderCreds,
  caption?: string,
): Promise<SendResult> {
  return postSendMessage({ to: toE164(to), videoUrl, ...(caption ? { text: caption } : {}) }, creds);
}

/**
 * Upload raw media bytes to Wasender and get back a public URL (valid ~24h)
 * usable as audioUrl/imageUrl on a subsequent send. Body is the raw binary.
 */
export async function uploadMediaToWasender(
  bytes: Uint8Array,
  mimetype: string,
  creds: WasenderCreds,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!creds.apiKey) return { ok: false, error: "wasender_not_connected" };
  const url = `${creds.baseUrl.replace(/\/$/, "")}/upload`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": mimetype,
        Authorization: `Bearer ${creds.apiKey}`,
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
  creds: WasenderCreds,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!creds.apiKey) return { ok: false, error: "wasender_not_connected" };
  const url = `${creds.baseUrl.replace(/\/$/, "")}/decrypt-media`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${creds.apiKey}`,
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

// ───────────────── Session management (account PAT) ─────────────────
// These manage WhatsApp sessions for every tenant under the platform's single
// Wasender account, authenticated with the account-level Personal Access Token.
// Per-session keys returned here are used to SEND (see WasenderCreds).

interface SessionApiResult<T = Record<string, unknown>> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function accountFetch<T = Record<string, unknown>>(
  path: string,
  init: RequestInit = {},
): Promise<SessionApiResult<T>> {
  const base = serverEnv.wasenderBaseUrl.replace(/\/$/, "");
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serverEnv.wasenderAccountToken}`,
        ...(init.headers ?? {}),
      },
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || (data as { success?: boolean }).success === false) {
      return { ok: false, error: `Wasender: ${(data as { message?: string }).message ?? `HTTP ${res.status}`}` };
    }
    return { ok: true, data: (data.data ?? data) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }
}

/**
 * Create a new WhatsApp session and point its webhook at our endpoint.
 * Wasender requires name + phone_number + account_protection.
 */
export function createSession(
  name: string,
  phoneNumber: string,
  webhookUrl: string,
): Promise<SessionApiResult<{ id?: number | string; api_key?: string }>> {
  return accountFetch("/whatsapp-sessions", {
    method: "POST",
    body: JSON.stringify({
      name,
      phone_number: phoneNumber,
      account_protection: true,
      log_messages: true,
      webhook_url: webhookUrl,
      webhook_enabled: true,
      webhook_events: ["messages.received"],
    }),
  });
}

/** Begin connecting a session (prepares the QR). */
export function connectSession(sessionId: string): Promise<SessionApiResult> {
  return accountFetch(`/whatsapp-sessions/${encodeURIComponent(sessionId)}/connect`, { method: "POST" });
}

/** Fetch the QR pairing string to scan (Wasender returns `data.qrCode`). */
export function getSessionQr(
  sessionId: string,
): Promise<SessionApiResult<{ qr?: string; qrcode?: string; qrCode?: string; status?: string }>> {
  return accountFetch(`/whatsapp-sessions/${encodeURIComponent(sessionId)}/qrcode`);
}


/**
 * Update a session. Wasender only syncs webhook settings to the live WhatsApp
 * connection on PUT (when connected) — call this after the QR scan so inbound
 * events actually fire. Requires name + phone_number + account_protection.
 */
export function updateSessionWebhook(
  sessionId: string,
  args: { name: string; phoneNumber: string; webhookUrl: string },
): Promise<SessionApiResult> {
  return accountFetch(`/whatsapp-sessions/${encodeURIComponent(sessionId)}`, {
    method: "PUT",
    body: JSON.stringify({
      name: args.name,
      phone_number: args.phoneNumber,
      account_protection: true,
      log_messages: true,
      webhook_url: args.webhookUrl,
      webhook_enabled: true,
      webhook_events: ["messages.received"],
    }),
  });
}

/** Read a session (includes connection status + per-session api key). */
export function getSession(
  sessionId: string,
): Promise<SessionApiResult<{ status?: string; api_key?: string; phone_number?: string }>> {
  return accountFetch(`/whatsapp-sessions/${encodeURIComponent(sessionId)}`);
}

/** Delete a session. */
export function deleteSession(sessionId: string): Promise<SessionApiResult> {
  return accountFetch(`/whatsapp-sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
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
  /** Per-tenant credentials + where the alert goes (this agent's admin). */
  creds: WasenderCreds;
  adminWhatsapp: string;
}

/**
 * Send a lead alert to the agent's owner over WhatsApp (replaces admin email).
 * Returns a SendResult so callers can log success.
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

  return sendWhatsAppText(input.adminWhatsapp, lines.join("\n"), input.creds);
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
    key.cleanedSenderPn,
    key.remoteJidAlt,
    msg.senderPn,
    msg.cleanedSenderPn,
    msg.remoteJidAlt,
    p.senderPn,
    key.remoteJid,
    msg.remoteJid,
    msg.from,
    p.from,
  ].filter((v): v is string => typeof v === "string" && v.length > 0);

  // Prefer a genuine phone JID; a plain digit string (cleanedSenderPn) is also
  // a real phone. Only fall back to a "@lid" id when no phone form is present.
  const phoneJid =
    candidates.find((c) => c.includes("@s.whatsapp.net")) ??
    candidates.find((c) => !c.includes("@lid") && /\d/.test(c));
  const from = normalizePhone(phoneJid ?? candidates[0] ?? "");
  if (!from) return null;

  // Capture the opaque "@lid" id so the same person resolves to one contact
  // even on webhooks that omit the phone (see migration 0002).
  const lidJid = [key.senderLid, msg.senderLid, key.remoteJid, msg.remoteJid].find(
    (v): v is string => typeof v === "string" && v.includes("@lid"),
  );
  const lid = lidJid ?? null;

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

  const sessionId =
    typeof p.sessionId === "string"
      ? p.sessionId
      : typeof p.session_id === "string"
        ? p.session_id
        : null;

  return {
    from,
    lid,
    name: msg.pushName ?? msg.notifyName ?? p.pushName ?? null,
    text: text || media?.caption?.trim() || "",
    kind,
    media,
    rawMessage: msg as Record<string, unknown>,
    sessionId,
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
