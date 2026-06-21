"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, ACTIVE_AGENT_COOKIE } from "@/lib/agents";
import { encryptSecret } from "@/lib/crypto";
import { isSupabaseConfigured, serverEnv } from "@/lib/env";
import {
  createSession,
  connectSession,
  getSessionQr,
  getSession,
  updateSessionWebhook,
  mapSessionStatus,
} from "@/lib/wasender";
import { DEFAULT_AGENT_SETTINGS } from "@/lib/constants";
import { agentSettingsSchema } from "@/lib/validations";
import type { ActionResult } from "@/lib/actions/conversations";

/** Save config (persona + rules + thresholds) for a specific agent. */
export async function saveAgentConfig(agentId: string, input: unknown): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const parsed = agentSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Champs invalides : " + JSON.stringify(parsed.error.flatten().fieldErrors) };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("agents").update(parsed.data).eq("id", agentId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/agents");
  revalidatePath("/dashboard");
  return { ok: true };
}

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

export interface CreateAgentInput {
  name: string;
  tone: string;
  operating_mode: string;
  system_prompt: string;
  welcome_message: string;
  qualification_rules: string;
  human_handoff_rules: string;
}

/** Create a new agent in the current org with a full initial config. */
export async function createAgent(input: CreateAgentInput): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const label = input.name.trim() || "Nouvel agent";
  const orgId = await getCurrentOrgId();
  if (!orgId) return { ok: false, error: "Aucune organisation." };

  const supabase = await createClient();
  const { error } = await supabase.from("agents").insert({
    org_id: orgId,
    name: label,
    agent_name: label,
    tone: input.tone,
    language: DEFAULT_AGENT_SETTINGS.language,
    welcome_message: input.welcome_message,
    system_prompt: input.system_prompt,
    qualification_rules: input.qualification_rules,
    human_handoff_rules: input.human_handoff_rules,
    qualified_threshold: DEFAULT_AGENT_SETTINGS.qualified_threshold,
    hot_threshold: DEFAULT_AGENT_SETTINGS.hot_threshold,
    operating_mode: input.operating_mode,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/agents");
  return { ok: true };
}

/** Delete an agent (cascades its data) and removes its Wasender session. */
export async function deleteAgent(agentId: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();

  // Fetch the session ref before deleting so we can clean up Wasender.
  const { data: agent } = await supabase
    .from("agents")
    .select("wasender_session_ref")
    .eq("id", agentId)
    .maybeSingle();

  const { error } = await supabase.from("agents").delete().eq("id", agentId);
  if (error) return { ok: false, error: error.message };

  // Best-effort: delete the Wasender session (don't block on failure).
  const ref = (agent as { wasender_session_ref?: string | null } | null)?.wasender_session_ref;
  if (ref) {
    deleteSession(ref).catch((e) =>
      console.error("[deleteAgent] Wasender session cleanup failed:", e),
    );
  }

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

/** Wasender returns the QR as a raw pairing string; render it to a PNG data URL. */
async function qrToDataUrl(qrString: string | undefined): Promise<string | undefined> {
  if (!qrString) return undefined;
  try {
    return await QRCode.toDataURL(qrString, { width: 320, margin: 1 });
  } catch {
    return undefined;
  }
}

/**
 * Provision a Wasender session for an agent and return a QR code to scan.
 * Creates the session under the platform account, points its webhook at us,
 * stores the session id + per-session key, and marks the agent "connecting".
 */
export async function connectAgentWhatsApp(
  agentId: string,
  phoneNumber: string,
): Promise<ConnectResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const phone = phoneNumber.trim();
  if (!/^\+?\d{8,15}$/.test(phone)) {
    return { ok: false, error: "Numéro invalide. Format attendu : +226XXXXXXXX." };
  }
  const e164 = phone.startsWith("+") ? phone : `+${phone}`;

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
    const created = await createSession((agent as { name: string }).name, e164, webhookUrl);
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

  // Wasender takes 2-4 s to initialise the session and generate the QR.
  // Poll up to 3 times with 2 s gaps before giving up and asking the user
  // to click "Vérifier" manually.
  let qr: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    const qrRes = await getSessionQr(ref);
    const qrData = (qrRes.data ?? {}) as { qr?: string; qrcode?: string; qrCode?: string };
    const raw = qrData.qr ?? qrData.qrcode ?? qrData.qrCode;
    if (raw) {
      qr = await qrToDataUrl(raw);
      break;
    }
  }

  const { error } = await supabase
    .from("agents")
    .update({
      wasender_session_ref: ref,
      phone_number: e164,
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



export async function refreshAgentConnection(
  agentId: string,
): Promise<ActionResult & { status?: string; qr?: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const { data: agent } = await supabase
    .from("agents")
    .select("id, name, phone_number, wasender_session_id, wasender_session_ref, wasender_session_key_enc")
    .eq("id", agentId)
    .maybeSingle();
  const ref = (agent as { wasender_session_ref?: string | null } | null)?.wasender_session_ref;
  if (!ref) return { ok: false, error: "Aucune session à vérifier." };

  const res = await getSession(ref);
  const data = (res.data ?? {}) as { status?: string; api_key?: string; phone_number?: string };
  // "disconnected" contains "connected" — use the central mapper, not a substring.
  const connected = mapSessionStatus(data.status) === "connected";

  // Once connected, PUT the session so Wasender syncs the webhook to the live
  // WhatsApp connection (otherwise inbound events never fire).
  if (connected) {
    const a = agent as { name?: string; phone_number?: string };
    const secret = serverEnv.wasenderWebhookSecret;
    const webhookUrl =
      `${serverEnv.appUrl.replace(/\/$/, "")}/api/webhooks/wasender` +
      (secret ? `?secret=${encodeURIComponent(secret)}` : "");
    await updateSessionWebhook(ref, {
      name: a.name ?? "Agent",
      phoneNumber: data.phone_number ?? a.phone_number ?? "",
      webhookUrl,
    });
  }

  // Still scanning → return a fresh QR (WhatsApp rotates it every ~20s).
  let freshQr: string | undefined;
  if (!connected) {
    const qrRes = await getSessionQr(ref);
    const qd = (qrRes.data ?? {}) as { qr?: string; qrcode?: string; qrCode?: string };
    freshQr = await qrToDataUrl(qd.qr ?? qd.qrcode ?? qd.qrCode);
  }

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
  return { ok: true, status: connected ? "connected" : "connecting", qr: freshQr };
}
