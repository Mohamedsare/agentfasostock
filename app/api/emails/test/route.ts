import { sendTestEmail } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * POST /api/emails/test — send a diagnostic email to the admin to verify the
 * Resend configuration end-to-end. Requires an authenticated admin session
 * (unless Supabase auth isn't configured in dev).
 */
export async function POST() {
  if (isSupabaseConfigured) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await sendTestEmail();
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
