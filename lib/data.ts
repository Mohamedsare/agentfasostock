import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getActiveAgent, getActiveAgentId } from "@/lib/agents";
import { DEFAULT_AGENT_SETTINGS, SCORE_THRESHOLDS } from "@/lib/constants";
import { buildSystemPrompt } from "@/lib/prompt";
import {
  mockConversations,
  mockFollowUps,
  mockKnowledge,
  mockMessages,
  mockNotes,
} from "@/lib/mock-data";
import type {
  AgentSettings,
  Contact,
  ConversationWithContact,
  DashboardAlert,
  DashboardStats,
  FollowUp,
  KnowledgeBaseEntry,
  KnowledgeFile,
  Message,
  Note,
  Product,
} from "@/lib/types";

/** Default agent settings (used until a row exists in Supabase). */
function defaultAgentSettings(): AgentSettings {
  return {
    id: "default",
    agent_name: DEFAULT_AGENT_SETTINGS.agent_name,
    tone: DEFAULT_AGENT_SETTINGS.tone,
    language: DEFAULT_AGENT_SETTINGS.language,
    welcome_message: DEFAULT_AGENT_SETTINGS.welcome_message,
    system_prompt: buildSystemPrompt({}).split("\n\n")[0],
    qualification_rules:
      "Activité, ville, type de commerce, problème de gestion, intérêt pour une démo, budget.",
    human_handoff_rules:
      "Transférer si la demande est complexe, sensible, ou si le client demande explicitement un humain.",
    qualified_threshold: DEFAULT_AGENT_SETTINGS.qualified_threshold,
    hot_threshold: DEFAULT_AGENT_SETTINGS.hot_threshold,
    ai_enabled: true,
    operating_mode: DEFAULT_AGENT_SETTINGS.operating_mode,
    updated_at: new Date().toISOString(),
  };
}

export async function getAgentSettings(): Promise<AgentSettings> {
  if (usingMockData) return defaultAgentSettings();
  // The active agent row carries the full persona/config (supersedes the old
  // single agent_settings row).
  const agent = await getActiveAgent();
  return (agent as unknown as AgentSettings) ?? defaultAgentSettings();
}

/**
 * Server-side data access. Each function reads from Supabase when it is
 * configured, and otherwise returns clean mock data so the UI is fully
 * functional during development (CLAUDE.md §30).
 */

export const usingMockData = !isSupabaseConfigured;

export async function getConversations(): Promise<ConversationWithContact[]> {
  if (usingMockData) return mockConversations;
  const agentId = await getActiveAgentId();
  if (!agentId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("*, contact:contacts(*)")
    .eq("agent_id", agentId)
    .order("last_message_at", { ascending: false });
  if (error || !data) return [];
  return data as unknown as ConversationWithContact[];
}

export async function getConversationById(
  id: string,
): Promise<ConversationWithContact | null> {
  if (usingMockData) return mockConversations.find((c) => c.id === id) ?? null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("conversations")
    .select("*, contact:contacts(*)")
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as ConversationWithContact) ?? null;
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  if (usingMockData) return mockMessages[conversationId] ?? [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  return (data as unknown as Message[]) ?? [];
}

export async function getNotes(conversationId: string): Promise<Note[]> {
  if (usingMockData) return mockNotes.filter((n) => n.conversation_id === conversationId);
  const supabase = await createClient();
  const { data } = await supabase
    .from("notes")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false });
  return (data as unknown as Note[]) ?? [];
}

export async function getKnowledge(): Promise<KnowledgeBaseEntry[]> {
  if (usingMockData) return mockKnowledge;
  const agentId = await getActiveAgentId();
  if (!agentId) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("knowledge_base")
    .select("*")
    .eq("agent_id", agentId)
    .order("category", { ascending: true });
  return (data as unknown as KnowledgeBaseEntry[]) ?? [];
}

export async function getKnowledgeFiles(): Promise<KnowledgeFile[]> {
  if (usingMockData) return [];
  const agentId = await getActiveAgentId();
  if (!agentId) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("knowledge_files")
    .select("*")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false });
  return (data as unknown as KnowledgeFile[]) ?? [];
}

export async function getProducts(): Promise<Product[]> {
  if (usingMockData) return [];
  const agentId = await getActiveAgentId();
  if (!agentId) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("*")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false });
  return (data as unknown as Product[]) ?? [];
}

export async function getFollowUps(): Promise<FollowUp[]> {
  if (usingMockData) return mockFollowUps;
  const agentId = await getActiveAgentId();
  if (!agentId) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("follow_ups")
    .select("*")
    .eq("agent_id", agentId)
    .order("scheduled_at", { ascending: true });
  return (data as unknown as FollowUp[]) ?? [];
}

export async function getContacts(): Promise<Contact[]> {
  const conversations = await getConversations();
  // Deduplicate contacts from conversations (sufficient for the prospects view).
  const map = new Map<string, Contact>();
  for (const c of conversations) map.set(c.contact.id, c.contact);
  return [...map.values()];
}

/** Raw audit log row for the activity journal. */
export interface AuditLogRow {
  id: string;
  actor: string;
  action: string;
  entity: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** Recent audit-log entries for the active agent (newest first). */
export async function getAuditLogs(limit = 60): Promise<AuditLogRow[]> {
  if (usingMockData) return [];
  const agentId = await getActiveAgentId();
  if (!agentId) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("audit_logs")
    .select("id, actor, action, entity, entity_id, metadata, created_at")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as AuditLogRow[]) ?? [];
}

/** Recent lead/alert notifications (WhatsApp + email trail) for the active agent. */
export async function getLeadNotifications(limit = 40) {
  if (usingMockData) return [];
  const agentId = await getActiveAgentId();
  if (!agentId) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("email_notifications")
    .select("id, trigger, to_email, subject, status, error, created_at, sent_at")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as {
    id: string;
    trigger: string;
    to_email: string;
    subject: string;
    status: string;
    error: string | null;
    created_at: string;
    sent_at: string | null;
  }[]) ?? [];
}

/** Compute the dashboard metrics from the conversation set. */
export async function getDashboardStats(): Promise<DashboardStats> {
  const conversations = await getConversations();
  const messagesByConv = usingMockData ? mockMessages : {};

  const total = conversations.length;
  const newProspects = conversations.filter((c) => c.status === "nouveau").length;
  const hot = conversations.filter((c) => c.status === "prospect_chaud").length;
  const qualified = conversations.filter((c) => c.status === "prospect_qualifie").length;
  const converted = conversations.filter((c) => c.status === "client_converti").length;
  const pending = conversations.filter(
    (c) => c.mode === "human" || c.status === "humain_requis" || c.unread_count > 0,
  ).length;

  const conversionRate = total > 0 ? converted / total : 0;

  // Count AI-handled messages: from mock data in dev, otherwise a real DB count
  // scoped to the active agent (so the dashboard shows live numbers, not 0).
  let aiHandledMessages: number;
  if (usingMockData) {
    aiHandledMessages = Object.values(messagesByConv)
      .flat()
      .filter((m) => m.sender === "ai").length;
  } else {
    const agentId = await getActiveAgentId();
    if (agentId) {
      const supabase = await createClient();
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", agentId)
        .eq("sender", "ai");
      aiHandledMessages = count ?? 0;
    } else {
      aiHandledMessages = 0;
    }
  }

  return {
    totalConversations: total,
    newProspects,
    hotProspects: hot,
    qualifiedProspects: qualified,
    convertedClients: converted,
    pendingConversations: pending,
    conversionRate,
    aiHandledMessages,
  };
}

/** Build the list of dashboard alerts from notable conversations. */
export async function getDashboardAlerts(): Promise<DashboardAlert[]> {
  const conversations = await getConversations();
  const alerts: DashboardAlert[] = [];
  for (const c of conversations) {
    if (c.status === "humain_requis") {
      alerts.push(alert(c, "human", "Reprise humaine requise", c.summary ?? ""));
    } else if (c.status === "prospect_chaud" || c.score >= SCORE_THRESHOLDS.hot) {
      alerts.push(alert(c, "hot", "Prospect chaud à appeler", c.next_action ?? ""));
    } else if (c.status === "prospect_qualifie") {
      alerts.push(alert(c, "qualified", "Prospect qualifié", c.next_action ?? ""));
    } else if (c.status === "support_client" && c.unread_count > 0) {
      alerts.push(alert(c, "support", "Support en attente", c.summary ?? ""));
    }
  }
  return alerts.slice(0, 6);
}

function alert(
  c: ConversationWithContact,
  type: DashboardAlert["type"],
  title: string,
  description: string,
): DashboardAlert {
  return {
    id: `${type}-${c.id}`,
    type,
    title: `${title} — ${c.contact.name ?? c.contact.phone}`,
    description,
    conversationId: c.id,
    createdAt: c.last_message_at,
  };
}
