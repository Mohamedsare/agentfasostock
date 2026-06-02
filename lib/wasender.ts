import "server-only";
import { serverEnv, features } from "@/lib/env";

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
  const body = JSON.stringify({ to: normalizePhone(to), text });

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
        const id =
          (data?.data as { msgId?: string; id?: string })?.msgId ??
          (data?.data as { id?: string })?.id ??
          (data as { id?: string })?.id;
        return { ok: true, id: id ? String(id) : undefined };
      }

      lastError = `HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`;
      // Retry only on 429 / 5xx.
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "network error";
    }
    if (attempt < MAX_RETRIES) await delay(400 * (attempt + 1));
  }

  console.error("[wasender] send failed:", lastError);
  return { ok: false, error: lastError };
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

  const remoteJid: string =
    key.remoteJid ?? msg.remoteJid ?? msg.from ?? p.from ?? "";
  const from = normalizePhone(remoteJid);
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
