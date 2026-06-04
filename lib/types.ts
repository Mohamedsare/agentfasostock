/**
 * Domain types for the FasoStock WhatsApp AI Agent.
 * These mirror the Supabase schema (see supabase/migrations).
 */

export type LeadStatus =
  | "nouveau"
  | "prospect_froid"
  | "prospect_tiede"
  | "prospect_chaud"
  | "prospect_qualifie"
  | "client_converti"
  | "support_client"
  | "humain_requis"
  | "spam"
  | "perdu";

export type Intent = "support" | "prospection" | "pricing" | "demo" | "other";

export type ConversationMode = "ai" | "human";

export type MessageDirection = "inbound" | "outbound";

/** Who authored a message. */
export type MessageSender = "contact" | "ai" | "admin" | "system";

export type LeadSource = "whatsapp" | "manual" | "import" | "labs";

export type SupportCategory =
  | "connexion"
  | "stock"
  | "vente"
  | "formation"
  | "prix"
  | "demonstration"
  | "autre";

export type KnowledgeCategory =
  | "presentation"
  | "fonctionnalites"
  | "prix"
  | "demonstration"
  | "support"
  | "objections"
  | "faq"
  | "conditions";

export type AgentTone = "professionnel" | "amical" | "direct" | "chaleureux";

export type AgentOperatingMode = "support" | "prospection" | "hybride";

export type EmailTrigger =
  | "prospect_qualifie"
  | "prospect_chaud"
  | "client_converti"
  | "humain_requis"
  | "support_important";

export type EmailStatus = "pending" | "sent" | "failed";

export type FollowUpStatus = "scheduled" | "sent" | "cancelled" | "responded";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: "admin" | "agent";
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  phone: string;
  /** WhatsApp opaque "@lid" identifier, when the phone isn't always sent. */
  lid: string | null;
  name: string | null;
  business_type: string | null;
  city: string | null;
  need: string | null;
  source: LeadSource;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  contact_id: string;
  status: LeadStatus;
  score: number;
  mode: ConversationMode;
  intent: Intent | null;
  summary: string | null;
  next_action: string | null;
  support_category: SupportCategory | null;
  last_message_at: string;
  last_message_preview: string | null;
  unread_count: number;
  ai_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  sender: MessageSender;
  content: string;
  intent: Intent | null;
  score_delta: number | null;
  wasender_id: string | null;
  created_at: string;
}

export interface LeadQualification {
  id: string;
  conversation_id: string;
  contact_id: string;
  score: number;
  status: LeadStatus;
  intent: Intent | null;
  summary: string | null;
  next_action: string | null;
  criteria: ScoreCriterion[];
  created_at: string;
}

export interface KnowledgeBaseEntry {
  id: string;
  title: string;
  content: string;
  category: KnowledgeCategory;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentSettings {
  id: string;
  agent_name: string;
  tone: AgentTone;
  language: string;
  welcome_message: string;
  system_prompt: string;
  qualification_rules: string;
  human_handoff_rules: string;
  qualified_threshold: number;
  hot_threshold: number;
  ai_enabled: boolean;
  operating_mode: AgentOperatingMode;
  updated_at: string;
}

export interface EmailNotification {
  id: string;
  trigger: EmailTrigger;
  to_email: string;
  subject: string;
  conversation_id: string | null;
  contact_id: string | null;
  status: EmailStatus;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface FollowUp {
  id: string;
  conversation_id: string;
  contact_id: string;
  step: 1 | 2 | 3;
  scheduled_at: string;
  status: FollowUpStatus;
  message: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface LabTest {
  id: string;
  name: string;
  system_prompt: string;
  tone: AgentTone;
  scenario: string;
  transcript: LabMessage[];
  result: AgentResult | null;
  is_saved: boolean;
  created_at: string;
}

export interface LabMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Note {
  id: string;
  conversation_id: string | null;
  contact_id: string | null;
  author_id: string | null;
  content: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  actor: string;
  action: string;
  entity: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** A single scoring criterion that was matched for a message/conversation. */
export interface ScoreCriterion {
  key: string;
  label: string;
  points: number;
}

/** Structured response the AI must always return (see CLAUDE.md §25). */
export interface AgentResult {
  reply: string;
  intent: Intent;
  status: LeadStatus;
  score: number;
  summary: string;
  next_action: string;
  should_notify_admin: boolean;
}

/** Conversation joined with its contact — convenient for list/detail views. */
export interface ConversationWithContact extends Conversation {
  contact: Contact;
}

/** Aggregated metrics for the dashboard home. */
export interface DashboardStats {
  totalConversations: number;
  newProspects: number;
  hotProspects: number;
  qualifiedProspects: number;
  convertedClients: number;
  pendingConversations: number;
  conversionRate: number;
  aiHandledMessages: number;
}

export interface DashboardAlert {
  id: string;
  type: "qualified" | "hot" | "human" | "support";
  title: string;
  description: string;
  conversationId: string;
  createdAt: string;
}
