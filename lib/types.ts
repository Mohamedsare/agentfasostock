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
  | "perdu"
  | "exclu";

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
  /** Owning agent (tenant scoping). Optional in mock data. */
  agent_id?: string | null;
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
  agent_id?: string | null;
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
  /** Who switched the AI off: "ai" (handoff, may auto-resume) or "admin" (human takeover). */
  silenced_by?: "ai" | "admin" | null;
  silenced_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  agent_id?: string | null;
  conversation_id: string;
  direction: MessageDirection;
  sender: MessageSender;
  content: string;
  /** Stored copy of a received file (migration 0018); `content` holds its text. */
  media_url?: string | null;
  media_type?: "image" | "video" | "audio" | "document" | null;
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
  agent_id?: string | null;
  title: string;
  content: string;
  category: KnowledgeCategory;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type KnowledgeFileType = "pdf" | "image" | "audio" | "word" | "excel" | "video" | "other";

export interface KnowledgeFile {
  id: string;
  agent_id: string;
  name: string;
  description: string | null;
  file_type: KnowledgeFileType;
  mime_type: string;
  storage_path: string;
  public_url: string;
  file_size_bytes: number | null;
  is_active: boolean;
  created_at: string;
}

export interface Product {
  id: string;
  agent_id: string;
  name: string;
  description: string | null;
  price: number | null;
  currency: string;
  images: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** "manual" (entered in the dashboard) or "api" (synced from a ProductSource). */
  source?: "manual" | "api";
  source_id?: string | null;
  external_id?: string | null;
  sku?: string | null;
  category?: string | null;
  brand?: string | null;
  stock_quantity?: number | null;
  in_stock?: boolean | null;
  product_url?: string | null;
  /** Extra details from the API (compatibility, dimensions…) kept as flat key/values. */
  attributes?: Record<string, string | number | boolean>;
  synced_at?: string | null;
  /** Supplier price before the selling markup (API products) — dashboard only, never shown to the agent. */
  cost_price?: number | null;
}

export type LearningKind =
  | "info_entreprise"
  | "reponse_type"
  | "objection"
  | "correction"
  | "a_eviter"
  | "bonne_pratique";
export type LearningStatus = "active" | "pending" | "rejected";
/** auto = confident lessons apply immediately; review = all need approval; off = no analysis. */
export type LearningMode = "auto" | "review" | "off";

/** A lesson the agent learned from its own conversations. */
export interface AgentLearning {
  id: string;
  agent_id: string;
  kind: LearningKind;
  title: string;
  content: string;
  evidence: string | null;
  confidence: number;
  status: LearningStatus;
  source_conversation_ids: string[];
  occurrences: number;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export type ProductSourceAuthType = "none" | "bearer" | "header" | "query";

/** Selling markup: prices up to `upTo` (null = no ceiling) get `add` on top. */
export interface PriceMarkupTier {
  upTo: number | null;
  add: number;
}

/** auto = detected from the first response (next_offset/offset → offset, else page). */
export type ProductPaginationStyle = "auto" | "page" | "offset";

/** JSON paths (dot notation) mapping the API payload to product fields. Empty = auto-detect. */
export interface ProductFieldMapping {
  items?: string;
  id?: string;
  name?: string;
  description?: string;
  price?: string;
  currency?: string;
  images?: string;
  sku?: string;
  category?: string;
  brand?: string;
  stock?: string;
  in_stock?: string;
  url?: string;
}

export interface ProductSource {
  id: string;
  agent_id: string;
  name: string;
  base_url: string;
  auth_type: ProductSourceAuthType;
  auth_key_name: string | null;
  /** Never sent to the client — see ProductSourceView. */
  api_key_encrypted: string | null;
  default_query: string | null;
  per_page: number;
  pagination_style: ProductPaginationStyle;
  /** "Changed since" query param (e.g. updated_since). Null = always full sync. */
  incremental_param: string | null;
  /** Selling markup tiers applied to synced prices (lib/pricing.ts). Null = sell at the API price. */
  price_markup: PriceMarkupTier[] | null;
  field_mapping: ProductFieldMapping;
  sync_interval_minutes: number;
  is_active: boolean;
  last_sync_at: string | null;
  last_full_sync_at: string | null;
  last_sync_status: "success" | "error" | "running" | null;
  last_sync_error: string | null;
  last_sync_count: number | null;
  created_at: string;
  updated_at: string;
}

/** Client-safe view of a source: the encrypted key is replaced by a flag. */
export type ProductSourceView = Omit<ProductSource, "api_key_encrypted"> & { has_api_key: boolean };

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
  /** Automatic follow-ups (relances) on/off for this agent. */
  follow_ups_enabled: boolean;
  /** Self-learning from past conversations (see lib/learning.ts). */
  learning_mode: LearningMode;
  operating_mode: AgentOperatingMode;
  updated_at: string;
}

/** A tenant company. Owns the OpenAI key shared by its agents. */
export interface Organization {
  id: string;
  name: string;
  owner_id: string | null;
  /** Encrypted OpenAI key (see lib/crypto.ts). Never sent to the client. */
  openai_api_key_enc: string | null;
  created_at: string;
  updated_at: string;
}

/** A member of an organization (a profile linked to the org). */
export interface OrgMember {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  /** True when this member is the org's owner (organizations.owner_id). */
  is_owner: boolean;
  created_at: string;
}

export type InvitationStatus = "pending" | "accepted" | "revoked";

/** A pending/accepted invitation to join an organization (migration 0006). */
export interface Invitation {
  id: string;
  org_id: string;
  email: string;
  role: string;
  token: string;
  status: InvitationStatus;
  invited_by: string | null;
  created_at: string;
  accepted_at: string | null;
  expires_at: string;
}

export type AgentConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/**
 * A configured WhatsApp agent (one number + persona) belonging to an org.
 * Supersedes the single global agent_settings row: it carries the full agent
 * persona/config plus tenant routing + per-session Wasender credentials.
 */
export interface Agent extends AgentSettings {
  org_id: string;
  /** Internal label for the agent (distinct from the persona `agent_name`). */
  name: string;
  /**
   * Wasender per-session api_key. Doubles as the inbound webhook `sessionId`
   * (routing) AND the bearer key to send messages.
   */
  wasender_session_id: string | null;
  /** Wasender numeric session id, used in session-management API URLs (QR/status). */
  wasender_session_ref: string | null;
  /** Encrypted copy of the per-session key (optional; plaintext id is the source). */
  wasender_session_key_enc: string | null;
  phone_number: string | null;
  connection_status: AgentConnectionStatus;
  /** Where this agent's lead alerts go (WhatsApp E.164). */
  admin_whatsapp: string | null;
  created_at: string;
}

/**
 * Resolved per-request tenant context: an agent plus decrypted credentials.
 * Built by lib/agents.ts and threaded through the engine / wasender / ai layers
 * so every outbound action uses the right tenant's keys.
 */
export interface AgentContext {
  agent: Agent;
  /** Decrypted per-session Wasender key (send). Null until connected. */
  wasenderKey: string | null;
  wasenderBaseUrl: string;
  /** Decrypted org OpenAI key, or the platform fallback. */
  openaiKey: string;
  adminWhatsapp: string;
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
  agent_id?: string | null;
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
  agent_id?: string | null;
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

/** A media attachment the agent decides to send alongside its text reply. */
export interface AgentMediaAttachment {
  /** Type of media — drives which Wasender send function is called. */
  type: "image" | "document" | "audio" | "video";
  /** Publicly accessible URL (Supabase Storage CDN or any public URL). */
  url: string;
  /** Optional caption shown under the media, or file name for documents. */
  caption?: string;
}

/** Contact facts the AI extracts from the conversation to persist immediately. */
export interface ExtractedContact {
  name?: string;
  city?: string;
  need?: string;
  business_type?: string;
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
  /** Media the agent has decided to send alongside the text reply. Max 3. */
  media?: AgentMediaAttachment[];
  /** Facts learned in this turn — saved to the contacts table immediately. */
  extracted_contact?: ExtractedContact;
  /** Set only when the LLM call failed and a canned fallback reply was used — why. */
  fallback_reason?: string;
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
