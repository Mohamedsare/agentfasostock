import { type NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Email confirmation / magic-link callback. Supabase redirects here after the
 * user clicks the link in their confirmation (or password-reset / magic-link)
 * email. We establish the session, then send them on to `next` (onboarding by
 * default). Supports both auth flows:
 *   - token_hash + type  → verifyOtp   (recommended SSR template)
 *   - code               → exchangeCodeForSession (PKCE)
 *
 * Without this route the email link verifies the account server-side but leaves
 * the browser logged out, so the user can't actually get in.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = sanitizeNext(searchParams.get("next"));

  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, origin));
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }

  // Verification failed or the link is malformed/expired.
  const failUrl = new URL("/login", origin);
  failUrl.searchParams.set("error", "confirmation");
  return NextResponse.redirect(failUrl);
}

/** Only allow same-origin relative paths to avoid open-redirects. */
function sanitizeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/onboarding";
  return next;
}
