import type { NextRequest } from "next/server";
import { parseWasenderWebhook } from "@/lib/wasender";
import { handleInboundMessage } from "@/lib/engine";
import { resolveAgentBySession } from "@/lib/agents";
import { serverEnv, features, isSupabaseConfigured } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/** Store the raw webhook body in audit_logs for debugging (best-effort). */
async function captureRawPayload(payload: unknown) {
  if (!isSupabaseConfigured) return;
  try {
    const db = createAdminClient();
    await db.from("audit_logs").insert({
      actor: "wasender",
      action: "webhook_raw",
      entity: "webhook",
      metadata: payload as Record<string, unknown>,
    });
  } catch {
    // never block the webhook on logging
  }
}

export const dynamic = "force-dynamic";
// The handler may chain media decrypt + transcription + LLM + TTS + upload +
// WhatsApp send, so allow well beyond the 10s default.
export const maxDuration = 60;

/**
 * GET handshake + diagnostic. Reports which integrations are configured on the
 * running server (booleans only — never secrets), so misconfigured deployments
 * are easy to spot.
 */
export async function GET() {
  return Response.json({
    ok: true,
    service: "wasender-webhook",
    configured: {
      supabase: isSupabaseConfigured,
      wasender: features.wasender,
      openai: features.openai,
      resend: features.resend,
      webhookSecret: Boolean(serverEnv.wasenderWebhookSecret),
    },
  });
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
    // Wasender presents two credentials and we accept EITHER:
    //  1. the ?secret= we appended to the registered webhook URL — we control
    //     this, so it always matches WASENDER_WEBHOOK_SECRET; and
    //  2. an X-Webhook-Signature header carrying the session's OWN webhook_secret
    //     — Wasender auto-generates that per session and won't let us set it, so
    //     it only matches when it happens to equal our global secret.
    // Authorize if our expected secret equals ANY presented credential. Crucially,
    // a present-but-different header must NOT override a correct ?secret= query
    // param (the previous `header ?? query` logic 401'd every session whose
    // auto-generated webhook_secret differed from ours).
    const candidates = [
      req.headers.get("x-webhook-signature"),
      req.headers.get("x-wasender-signature"),
      req.headers.get("x-webhook-secret"),
      req.nextUrl.searchParams.get("secret"),
    ];
    if (!candidates.includes(expected)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  // Best-effort capture of the raw payload for debugging webhook shape issues
  // (e.g. @lid vs phone JID). Stored in audit_logs; safe to disable later.
  await captureRawPayload(payload);

  const inbound = parseWasenderWebhook(payload);
  if (!inbound) {
    // Not a usable inbound text message (status update, receipt, etc.).
    return Response.json({ ok: true, ignored: true });
  }

  // Route the message to the agent that owns this Wasender session (tenant).
  if (!inbound.sessionId) {
    return Response.json({ ok: true, ignored: true, reason: "no_session" });
  }
  const agentCtx = await resolveAgentBySession(inbound.sessionId);
  if (!agentCtx) {
    return Response.json({ ok: true, ignored: true, reason: "unknown_session" });
  }

  try {
    const result = await handleInboundMessage(inbound, agentCtx);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("[webhooks/wasender] processing failed:", error);
    // Acknowledge to avoid retries; the error is logged for inspection.
    return Response.json({ ok: false, error: "processing_failed" }, { status: 200 });
  }
}
