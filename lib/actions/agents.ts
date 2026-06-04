"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, ACTIVE_AGENT_COOKIE } from "@/lib/agents";
import { encryptSecret } from "@/lib/crypto";
import { isSupabaseConfigured, serverEnv } from "@/lib/env";
import { createSession, connectSession, getSessionQr, getSession } from "@/lib/wasender";
import { DEFAULT_AGENT_SETTINGS } from "@/lib/constants";
import type { ActionResult } from "@/lib/actions/conversations";

/** Switch the dashboard's active agent (cookie). */
export async function setActiveAgent(agentId: string): Promise<ActionResult> {
  const store = await cookies();
  store.set(ACTIVE_AGENT_COOKIE, agentId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Create a new agent in the current org. */
export async function createAgent(name: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const label = name.trim() || "Nouvel agent";
  const orgId = await getCurrentOrgId();
  if (!orgId) return { ok: false, error: "Aucune organisation." };

  const supabase = await createClient();
  const { error } = await supabase.from("agents").insert({
    org_id: orgId,
    name: label,
    agent_name: label,
    tone: DEFAULT_AGENT_SETTINGS.tone,
    language: DEFAULT_AGENT_SETTINGS.language,
    welcome_message: DEFAULT_AGENT_SETTINGS.welcome_message,
    qualified_threshold: DEFAULT_AGENT_SETTINGS.qualified_threshold,
    hot_threshold: DEFAULT_AGENT_SETTINGS.hot_threshold,
    operating_mode: DEFAULT_AGENT_SETTINGS.operating_mode,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/agents");
  return { ok: true };
}

/** Delete an agent (cascades its data). */
export async function deleteAgent(agentId: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const { error } = await supabase.from("agents").delete().eq("id", agentId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/agents");
  return { ok: true };
}

/** Update the org-wide OpenAI key (encrypted). */
export async function saveOpenAiKey(key: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const orgId = await getCurrentOrgId();
  if (!orgId) return { ok: false, error: "Aucune organisation." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ openai_api_key_enc: key.trim() ? encryptSecret(key.trim()) : null })
    .eq("id", orgId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

/** Update the agent's admin alert number (E.164). */
export async function saveAgentAdminWhatsapp(
  agentId: string,
  adminWhatsapp: string,
): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("agents")
    .update({ admin_whatsapp: adminWhatsapp.trim() || null })
    .eq("id", agentId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/agents");
  return { ok: true };
}

export interface ConnectResult extends ActionResult {
  qr?: string;
}

/**
 * Provision a Wasender session for an agent and return a QR code to scan.
 * Creates the session under the platform account, points its webhook at us,
 * stores the session id + per-session key, and marks the agent "connecting".
 */
export async function connectAgentWhatsApp(agentId: string): Promise<ConnectResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const { data: agent } = await supabase
    .from("agents")
    .select("id, name, wasender_session_id, wasender_session_ref")
    .eq("id", agentId)
    .maybeSingle();
  if (!agent) return { ok: false, error: "Agent introuvable." };

  const secret = serverEnv.wasenderWebhookSecret;
  const webhookUrl =
    `${serverEnv.appUrl.replace(/\/$/, "")}/api/webhooks/wasender` +
    (secret ? `?secret=${encodeURIComponent(secret)}` : "");

  // A Wasender session has a numeric `ref` (management URLs) and an `api_key`
  // (send + webhook routing). Reuse an existing ref or create a new session.
  let ref = (agent as { wasender_session_ref?: string | null }).wasender_session_ref ?? null;
  let apiKey = (agent as { wasender_session_id?: string | null }).wasender_session_id ?? null;
  if (!ref) {
    const created = await createSession((agent as { name: string }).name, webhookUrl);
    if (!created.ok || !created.data) {
      return { ok: false, error: created.error ?? "Création de session échouée." };
    }
    const d = created.data as Record<string, unknown>;
    ref = d.id != null ? String(d.id) : null;
    const k = d.api_key ?? d.apiKey ?? d.token;
    apiKey = typeof k === "string" ? k : apiKey;
    if (!ref) return { ok: false, error: "Réponse Wasender inattendue (pas d'id de session)." };
  }

  await connectSession(ref);
  const qrRes = await getSessionQr(ref);
  const qrData = (qrRes.data ?? {}) as { qr?: string; qrcode?: string; qrCode?: string };
  const qr = qrData.qr ?? qrData.qrcode ?? qrData.qrCode;

  const { error } = await supabase
    .from("agents")
    .update({
      wasender_session_ref: ref,
      ...(apiKey
        ? { wasender_session_id: apiKey, wasender_session_key_enc: encryptSecret(apiKey) }
        : {}),
      connection_status: "connecting",
    })
    .eq("id", agentId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/agents");
  return { ok: true, qr };
}

/**
 * Poll Wasender for the session status; when connected, store the phone number
 * and (if not already) the per-session key, and mark the agent connected.
 */
export async function refreshAgentConnection(agentId: string): Promise<ActionResult & { status?: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const { data: agent } = await supabase
    .from("agents")
    .select("id, wasender_session_id, wasender_session_ref, wasender_session_key_enc")
    .eq("id", agentId)
    .maybeSingle();
  const ref = (agent as { wasender_session_ref?: string | null } | null)?.wasender_session_ref;
  if (!ref) return { ok: false, error: "Aucune session à vérifier." };

  const res = await getSession(ref);
  const data = (res.data ?? {}) as { status?: string; api_key?: string; phone_number?: string };
  const connected = (data.status ?? "").toLowerCase().includes("connected");

  const hasKey = Boolean(
    (agent as { wasender_session_id?: string | null }).wasender_session_id,
  );
  const { error } = await supabase
    .from("agents")
    .update({
      connection_status: connected ? "connected" : "connecting",
      ...(data.phone_number ? { phone_number: data.phone_number } : {}),
      // Capture the api_key (send + routing) once Wasender exposes it.
      ...(!hasKey && data.api_key
        ? { wasender_session_id: data.api_key, wasender_session_key_enc: encryptSecret(data.api_key) }
        : {}),
    })
    .eq("id", agentId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/agents");
  return { ok: true, status: connected ? "connected" : "connecting" };
}
