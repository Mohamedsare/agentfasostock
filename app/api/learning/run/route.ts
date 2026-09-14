import type { NextRequest } from "next/server";
import { runLearning } from "@/lib/learning";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * Cron runner for agent self-learning: analyses settled conversations of every
 * agent whose learning mode isn't "off" and records lessons.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>  — or  ?secret=<CRON_SECRET>
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[learning] CRON_SECRET not set — /api/learning/run is unprotected.");
    return true;
  }
  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const query = request.nextUrl.searchParams.get("secret");
  return bearer === secret || query === secret;
}

async function run(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return Response.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  }
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runLearning();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "learning_failed";
    console.error("[learning] run failed:", message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export const POST = run;
export const GET = run;
