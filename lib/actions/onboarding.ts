"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { isSupabaseConfigured } from "@/lib/env";
import { DEFAULT_AGENT_SETTINGS } from "@/lib/constants";
import { sendWelcomeEmail } from "@/lib/email";

export interface OnboardingState {
  error?: string;
}

/**
 * First-run onboarding: create the user's organization (+ optional OpenAI key)
 * and their first agent, then link the profile. Runs after signup/first login.
 */
export async function completeOnboarding(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  if (!isSupabaseConfigured) redirect("/dashboard");

  const orgName = String(formData.get("orgName") ?? "").trim();
  const agentName = String(formData.get("agentName") ?? "").trim() || "Mon agent";
  const openaiKey = String(formData.get("openaiKey") ?? "").trim();
  if (!orgName) return { error: "Le nom de l'entreprise est requis." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expirée, reconnectez-vous." };

  // Create the organization (owner = current user).
  const { data: org, error: orgErr } = await supabase
    .from("organizations")
    .insert({
      name: orgName,
      owner_id: user.id,
      openai_api_key_enc: openaiKey ? encryptSecret(openaiKey) : null,
    })
    .select("id")
    .single();
  if (orgErr || !org) return { error: orgErr?.message ?? "Création de l'organisation échouée." };

  // Link the profile to the org so RLS grants access immediately.
  await supabase.from("profiles").update({ org_id: org.id }).eq("id", user.id);

  // Create the first agent with sensible defaults.
  const { error: agentErr } = await supabase.from("agents").insert({
    org_id: org.id,
    name: agentName,
    agent_name: agentName,
    tone: DEFAULT_AGENT_SETTINGS.tone,
    language: DEFAULT_AGENT_SETTINGS.language,
    welcome_message: DEFAULT_AGENT_SETTINGS.welcome_message,
    qualified_threshold: DEFAULT_AGENT_SETTINGS.qualified_threshold,
    hot_threshold: DEFAULT_AGENT_SETTINGS.hot_threshold,
    operating_mode: DEFAULT_AGENT_SETTINGS.operating_mode,
  });
  if (agentErr) return { error: agentErr.message };

  // Welcome the new user now that their workspace is ready (best-effort).
  try {
    const displayName =
      (user.user_metadata?.full_name as string | undefined) ?? user.email?.split("@")[0] ?? "";
    if (user.email) await sendWelcomeEmail(user.email, displayName);
  } catch (err) {
    console.error("[onboarding] welcome email failed:", err);
  }

  redirect("/dashboard/agents");
}
