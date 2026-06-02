import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
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
  Message,
  Note,
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
  const supabase = await createClient();
  const { data } = await supabase.from("agent_settings").select("*").limit(1).maybeSingle();
  return (data as unknown as AgentSettings) ?? defaultAgentSettings();
}

/**
 * Server-side data access. Each function reads from Supabase when it is
 * configured, and otherwise returns clean mock data so the UI is fully
 * functional during development (CLAUDE.md §30).
 */

export const usingMockData = !isSupabaseConfigured;

export async function getConversations(): Promise<ConversationWithContact[]> {
  if (usingMockData) return mockConversations;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("*, contact:contacts(*)")
    .order("last_message_at", { ascending: false });
  if (error || !data) return mockConversations;
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
  const supabase = await createClient();
  const { data } = await supabase
    .from("knowledge_base")
    .select("*")
    .order("category", { ascending: true });
  return (data as unknown as KnowledgeBaseEntry[]) ?? mockKnowledge;
}

export async function getFollowUps(): Promise<FollowUp[]> {
  if (usingMockData) return mockFollowUps;
  const supabase = await createClient();
  const { data } = await supabase
    .from("follow_ups")
    .select("*")
    .order("scheduled_at", { ascending: true });
  return (data as unknown as FollowUp[]) ?? mockFollowUps;
}

export async function getContacts(): Promise<Contact[]> {
  const conversations = await getConversations();
  // Deduplicate contacts from conversations (sufficient for the prospects view).
  const map = new Map<string, Contact>();
  for (const c of conversations) map.set(c.contact.id, c.contact);
  return [...map.values()];
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

  const aiHandled = Object.values(messagesByConv)
    .flat()
    .filter((m) => m.sender === "ai").length;

  const conversionRate = total > 0 ? converted / total : 0;

  return {
    totalConversations: total,
    newProspects,
    hotProspects: hot,
    qualifiedProspects: qualified,
    convertedClients: converted,
    pendingConversations: pending,
    conversionRate,
    aiHandledMessages: usingMockData ? aiHandled : 0,
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
