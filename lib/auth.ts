import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/**
 * Resolve the current dashboard user. In dev without Supabase, returns a
 * placeholder admin so the mock UI is usable (CLAUDE.md §30).
 */
export async function getSessionUser(): Promise<SessionUser> {
  if (!isSupabaseConfigured) {
    return { id: "dev", email: "admin@fasostock.local", name: "Mohamed (démo)" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { id: "anon", email: "—", name: "Invité" };
  }

  const name =
    (user.user_metadata?.full_name as string | undefined) ??
    user.email?.split("@")[0] ??
    "Admin";

  return { id: user.id, email: user.email ?? "—", name };
}
