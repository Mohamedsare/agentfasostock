"use server";

import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { sendNewUserAdminAlert } from "@/lib/email";

export interface AuthState {
  error?: string;
}

/** Sign in with email + password (Supabase Auth). */
export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirect") ?? "/dashboard");

  if (!isSupabaseConfigured) {
    // Dev mode without Supabase: let the user into the mock dashboard.
    redirect(redirectTo || "/dashboard");
  }

  if (!email || !password) {
    return { error: "Email et mot de passe requis." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: "Identifiants invalides. Vérifiez votre email et mot de passe." };
  }

  redirect(redirectTo || "/dashboard");
}

/** Self-service signup with email + password, then go to onboarding. */
export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();

  if (!isSupabaseConfigured) redirect("/dashboard");
  if (!email || !password) return { error: "Email et mot de passe requis." };
  if (password.length < 8) return { error: "Mot de passe trop court (8 caractères minimum)." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName || email.split("@")[0] } },
  });
  if (error) return { error: error.message };

  // Notify the platform super-admin of the new signup (best-effort, never blocks).
  try {
    await sendNewUserAdminAlert(email, fullName || email.split("@")[0]);
  } catch (err) {
    console.error("[auth] new-user admin alert failed:", err);
  }

  // If email confirmation is disabled, the user is signed in immediately.
  redirect("/onboarding");
}

/** Sign out and return to the login page. */
export async function signOut(): Promise<void> {
  if (isSupabaseConfigured) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
