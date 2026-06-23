"use server";

import { revalidatePath } from "next/cache";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export interface ProfileState {
  success?: boolean;
  error?: string;
}

export async function updateProfile(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  if (!isSupabaseConfigured) return { success: true };

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();

  if (!name || !email) return { error: "Nom et email requis." };

  const supabase = await createClient();
  const appUrl = publicEnv.appUrl.replace(/\/$/, "");
  const { error: metaError } = await supabase.auth.updateUser(
    { email, data: { full_name: name } },
    { emailRedirectTo: `${appUrl}/auth/confirm?next=/dashboard/profile` },
  );

  if (metaError) return { error: metaError.message };

  revalidatePath("/dashboard/profile");
  return { success: true };
}

export async function updatePassword(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  if (!isSupabaseConfigured) return { success: true };

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!current || !next) return { error: "Tous les champs sont requis." };
  if (next.length < 8) return { error: "Mot de passe trop court (8 caractères minimum)." };
  if (next !== confirm) return { error: "Les mots de passe ne correspondent pas." };

  const supabase = await createClient();

  // Verify current password by re-authenticating
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Session expirée, reconnectez-vous." };

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: current,
  });
  if (signInError) return { error: "Mot de passe actuel incorrect." };

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { error: error.message };

  return { success: true };
}
