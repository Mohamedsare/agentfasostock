"use server";

import { redirect } from "next/navigation";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { sendNewUserAdminAlert } from "@/lib/email";

export interface AuthState {
  error?: string;
  /** Set after signup when a confirmation email was sent (no session yet). */
  emailSent?: boolean;
  /** Email the confirmation was sent to, for display. */
  email?: string;
}

/**
 * Translate raw Supabase Auth error messages (English) into clear French
 * messages for the UI. Falls back to a generic message for anything unknown.
 */
function frenchAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("sending confirmation email") || m.includes("sending email"))
    return "Impossible d'envoyer l'email de confirmation pour le moment. Réessayez dans quelques instants.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "Un compte existe déjà avec cet email. Connectez-vous plutôt.";
  if (m.includes("invalid login credentials"))
    return "Identifiants invalides. Vérifiez votre email et mot de passe.";
  if (m.includes("email not confirmed"))
    return "Email non confirmé. Vérifiez votre boîte de réception (et les spams).";
  if (m.includes("invalid format") || m.includes("validate email"))
    return "Adresse email invalide.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "Trop de tentatives. Patientez quelques minutes avant de réessayer.";
  if (m.includes("for security purposes"))
    return "Trop de tentatives rapprochées. Patientez quelques secondes avant de réessayer.";
  if (m.includes("password") && m.includes("at least"))
    return "Mot de passe trop court (8 caractères minimum).";
  if (m.includes("weak password"))
    return "Mot de passe trop faible. Choisissez un mot de passe plus robuste.";
  return "Une erreur est survenue. Réessayez ou contactez le support.";
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
    return { error: frenchAuthError(error.message) };
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
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName || email.split("@")[0] },
      // Where Supabase sends the user after they click the confirmation link.
      emailRedirectTo: `${publicEnv.appUrl.replace(/\/$/, "")}/auth/confirm?next=/onboarding`,
    },
  });
  if (error) return { error: frenchAuthError(error.message) };

  // Supabase returns a user with an empty `identities` array (and no error) when
  // the email is already registered — surface a clear message instead of a
  // misleading "check your email".
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    return {
      error: "Un compte existe déjà avec cet email. Connectez-vous plutôt.",
    };
  }

  // Notify the platform super-admin of the new signup (best-effort, never blocks).
  try {
    await sendNewUserAdminAlert(email, fullName || email.split("@")[0]);
  } catch (err) {
    console.error("[auth] new-user admin alert failed:", err);
  }

  // If email confirmation is enabled, there's no session yet — tell the user to
  // check their inbox. If it's disabled, the user is signed in immediately and
  // we send them straight to onboarding.
  if (!data.session) {
    return { emailSent: true, email };
  }
  redirect("/onboarding");
}

/** Sign in with Google via Supabase OAuth. */
export async function signInWithGoogle(): Promise<void> {
  if (!isSupabaseConfigured) redirect("/dashboard");

  const supabase = await createClient();
  const callbackUrl = `${publicEnv.appUrl.replace(/\/$/, "")}/auth/confirm?next=/dashboard`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl },
  });

  if (error || !data.url) {
    redirect("/login?error=oauth");
  }

  redirect(data.url);
}

/** Sign out and return to the login page. */
export async function signOut(): Promise<void> {
  if (isSupabaseConfigured) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
