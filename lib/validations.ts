import { z } from "zod";

/** Lead status enum shared across API payloads. */
export const leadStatusSchema = z.enum([
  "nouveau",
  "prospect_froid",
  "prospect_tiede",
  "prospect_chaud",
  "prospect_qualifie",
  "client_converti",
  "support_client",
  "humain_requis",
  "spam",
  "perdu",
  "exclu",
]);

export const intentSchema = z.enum(["support", "prospection", "pricing", "demo", "other"]);

const mediaAttachmentSchema = z.object({
  type: z.enum(["image", "document", "audio", "video"]),
  url: z.string().url(),
  caption: z.string().optional(),
});

const extractedContactSchema = z.object({
  name: z.string().optional(),
  city: z.string().optional(),
  need: z.string().optional(),
  business_type: z.string().optional(),
}).optional();

/** Structured AI output (CLAUDE.md §25). */
export const agentResultSchema = z.object({
  reply: z.string().min(1),
  intent: intentSchema,
  status: leadStatusSchema,
  score: z.number().min(0).max(100),
  summary: z.string().default(""),
  next_action: z.string().default(""),
  should_notify_admin: z.boolean().default(false),
  media: z.array(mediaAttachmentSchema).max(3).optional(),
  extracted_contact: extractedContactSchema,
});

/** Body for POST /api/agent/respond and /api/labs/simulate. */
export const respondSchema = z.object({
  conversationId: z.string().uuid().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
      }),
    )
    .min(1),
  systemPromptOverride: z.string().optional(),
  toneOverride: z
    .enum(["professionnel", "amical", "direct", "chaleureux"])
    .optional(),
  previousScore: z.number().min(0).max(100).optional(),
});

/** Body for POST /api/wasender/send. */
export const sendMessageSchema = z.object({
  to: z.string().min(6, "Numéro invalide"),
  text: z.string().min(1, "Message vide"),
});

/**
 * Wasender webhook payload. Wasender posts an event envelope; we accept a
 * permissive shape and normalise it in `parseWasenderWebhook`.
 */
export const wasenderWebhookSchema = z.object({
  event: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  // Some plans post flat fields — keep them optional.
  from: z.string().optional(),
  message: z.unknown().optional(),
  timestamp: z.union([z.number(), z.string()]).optional(),
});

/** Knowledge base entry create/update. */
export const knowledgeEntrySchema = z.object({
  title: z.string().min(2),
  content: z.string().min(2),
  category: z.enum([
    "presentation",
    "fonctionnalites",
    "prix",
    "demonstration",
    "support",
    "objections",
    "faq",
    "conditions",
  ]),
  is_active: z.boolean().default(true),
});

/** Agent settings update. */
export const agentSettingsSchema = z.object({
  agent_name: z.string().min(2),
  tone: z.enum(["professionnel", "amical", "direct", "chaleureux"]),
  language: z.string().min(2),
  welcome_message: z.string().max(1000).default(""),
  system_prompt: z.string().min(10),
  qualification_rules: z.string().default(""),
  human_handoff_rules: z.string().default(""),
  qualified_threshold: z.number().min(0).max(100),
  hot_threshold: z.number().min(0).max(100),
  ai_enabled: z.boolean(),
  operating_mode: z.enum(["support", "prospection", "hybride"]),
});

/** Note creation. */
export const noteSchema = z.object({
  conversationId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  content: z.string().min(1),
});

export type RespondInput = z.infer<typeof respondSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type AgentResultInput = z.infer<typeof agentResultSchema>;
