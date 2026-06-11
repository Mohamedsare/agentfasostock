import type { NextRequest } from "next/server";
import { runDueFollowUps } from "@/lib/follow-ups";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * Cron runner for automatic follow-ups (CLAUDE.md §16, §21).
 *
 * Trigger on a schedule (e.g. Vercel Cron hourly) with:
 *   Authorization: Bearer <CRON_SECRET>   — or   ?secret=<CRON_SECRET>
 *
 * Set CRON_SECRET in the environment. When it's unset the endpoint is open
 * (dev convenience, CLAUDE.md §30) but logs a warning.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[follow-ups] CRON_SECRET not set — /api/follow-ups/run is unprotected.");
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
    const result = await runDueFollowUps();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "run_failed";
    console.error("[follow-ups] run failed:", message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

// Support both POST (cron services) and GET (manual trigger / browser check).
export const POST = run;
export const GET = run;
