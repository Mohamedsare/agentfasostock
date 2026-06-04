import "server-only";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";
import { serverEnv } from "@/lib/env";
import type { WasenderCreds } from "@/lib/wasender";
import type { Agent, AgentContext, Organization } from "@/lib/types";

/**
 * Tenant resolution. Turns an agent row (+ its org) into an AgentContext with
 * decrypted credentials, threaded through the engine / wasender / ai layers so
 * every outbound action uses the right tenant's keys.
 */

export const ACTIVE_AGENT_COOKIE = "active_agent_id";

/** Build a per-request context (decrypted keys + fallbacks) from an agent row. */
export function buildAgentContext(agent: Agent, org: Organization | null): AgentContext {
  const orgKey = org?.openai_api_key_enc ? decryptSecret(org.openai_api_key_enc) : null;
  // The per-session api_key (stored plaintext in wasender_session_id for webhook
  // routing) is also the bearer key used to send; prefer the encrypted copy.
  const wasenderKey = decryptSecret(agent.wasender_session_key_enc) ?? agent.wasender_session_id;
  return {
    agent,
    wasenderKey,
    wasenderBaseUrl: serverEnv.wasenderBaseUrl,
    openaiKey: orgKey || serverEnv.platformOpenaiApiKey,
    adminWhatsapp: agent.admin_whatsapp || serverEnv.adminWhatsapp,
  };
}

/**
 * Resolve the agent that owns an inbound Wasender session (webhook routing).
 * Uses the service-role client (no user session). Returns null if unknown.
 */
export async function resolveAgentBySession(sessionId: string): Promise<AgentContext | null> {
  if (!sessionId) return null;
  const db = createAdminClient();
  const { data: agent } = await db
    .from("agents")
    .select("*")
    .eq("wasender_session_id", sessionId)
    .maybeSingle();
  if (!agent) return null;

  const { data: org } = await db
    .from("organizations")
    .select("*")
    .eq("id", (agent as Agent).org_id)
    .maybeSingle();

  return buildAgentContext(agent as Agent, (org as Organization) ?? null);
}

/** Build send credentials from a resolved context. */
export function wasenderCredsOf(ctx: AgentContext): WasenderCreds {
  return { apiKey: ctx.wasenderKey, baseUrl: ctx.wasenderBaseUrl };
}

/** Resolve the tenant context that owns a conversation (service role). */
export async function resolveAgentContextForConversation(
  conversationId: string,
): Promise<AgentContext | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("conversations")
    .select("agent_id")
    .eq("id", conversationId)
    .maybeSingle();
  const agentId = (data as { agent_id?: string } | null)?.agent_id;
  if (!agentId) return null;
  return resolveAgentContextById(agentId);
}

/** Resolve a context by agent id, via service role (e.g. manual admin send). */
export async function resolveAgentContextById(agentId: string): Promise<AgentContext | null> {
  if (!agentId) return null;
  const db = createAdminClient();
  const { data: agent } = await db.from("agents").select("*").eq("id", agentId).maybeSingle();
  if (!agent) return null;
  const { data: org } = await db
    .from("organizations")
    .select("*")
    .eq("id", (agent as Agent).org_id)
    .maybeSingle();
  return buildAgentContext(agent as Agent, (org as Organization) ?? null);
}

// ───────────────────────── Dashboard helpers ─────────────────────────

/** The current user's organization id (from their profile), or null. */
export async function getCurrentOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("org_id").eq("id", user.id).maybeSingle();
  return (data as { org_id?: string } | null)?.org_id ?? null;
}

/** The current user's organization row, or null. */
export async function getCurrentOrg(): Promise<Organization | null> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("organizations").select("*").eq("id", orgId).maybeSingle();
  return (data as Organization) ?? null;
}

/** All agents in the current user's org (RLS-scoped), newest first. */
export async function getOrgAgents(): Promise<Agent[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("agents")
    .select("*")
    .order("created_at", { ascending: true });
  return (data as Agent[]) ?? [];
}

/**
 * The agent the dashboard is currently viewing: the cookie-selected agent if it
 * belongs to the user's org, otherwise the first agent. Null if the org has none.
 */
export async function getActiveAgent(): Promise<Agent | null> {
  const agents = await getOrgAgents();
  if (agents.length === 0) return null;
  const store = await cookies();
  const selected = store.get(ACTIVE_AGENT_COOKIE)?.value;
  return agents.find((a) => a.id === selected) ?? agents[0];
}

/** Convenience: the active agent's id (or null). */
export async function getActiveAgentId(): Promise<string | null> {
  return (await getActiveAgent())?.id ?? null;
}
