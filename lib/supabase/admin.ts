import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/**
 * Service-role Supabase client — SERVER ONLY. Bypasses RLS.
 * Used by webhooks and background jobs that act without a user session.
 * Never import this from client code.
 */
export function createAdminClient() {
  return createSupabaseClient(serverEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
