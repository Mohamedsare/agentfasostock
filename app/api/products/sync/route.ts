import type { NextRequest } from "next/server";
import { syncDueProductSources } from "@/lib/product-sync";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * Cron runner for product API sources: syncs every active source whose
 * interval has elapsed (incremental, with a full resync once a day).
 *
 * Auth: Authorization: Bearer <CRON_SECRET>  — or  ?secret=<CRON_SECRET>
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[products-sync] CRON_SECRET not set — /api/products/sync is unprotected.");
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
    const result = await syncDueProductSources();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "sync_failed";
    console.error("[products-sync] run failed:", message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export const POST = run;
export const GET = run;
