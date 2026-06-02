import type { NextRequest } from "next/server";
import { parseWasenderWebhook } from "@/lib/wasender";
import { handleInboundMessage } from "@/lib/engine";
import { serverEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
// The handler waits on an LLM call + WhatsApp send; allow more than the 10s default.
export const maxDuration = 30;

/** Simple GET handshake so the endpoint is reachable/verifiable. */
export async function GET() {
  return Response.json({ ok: true, service: "wasender-webhook" });
}

/**
 * POST /api/webhooks/wasender — inbound WhatsApp messages (CLAUDE.md §20).
 * Always returns 200 for handled events so the provider doesn't retry storms;
 * returns 401 only when a configured secret doesn't match.
 */
export async function POST(req: NextRequest) {
  // Optional shared-secret check. Configure it as a header or ?secret= on the
  // webhook URL in Wasender, matching WASENDER_WEBHOOK_SECRET.
  const expected = serverEnv.wasenderWebhookSecret;
  if (expected) {
    const provided =
      req.headers.get("x-webhook-signature") ??
      req.headers.get("x-wasender-signature") ??
      req.headers.get("x-webhook-secret") ??
      req.nextUrl.searchParams.get("secret") ??
      "";
    if (provided !== expected) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const inbound = parseWasenderWebhook(payload);
  if (!inbound) {
    // Not a usable inbound text message (status update, receipt, etc.).
    return Response.json({ ok: true, ignored: true });
  }

  try {
    const result = await handleInboundMessage(inbound);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("[webhooks/wasender] processing failed:", error);
    // Acknowledge to avoid retries; the error is logged for inspection.
    return Response.json({ ok: false, error: "processing_failed" }, { status: 200 });
  }
}
