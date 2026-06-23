import "server-only";
import OpenAI from "openai";
import { serverEnv } from "@/lib/env";
import { buildSystemPrompt, type ConversationMemory } from "@/lib/prompt";
import { clamp, scoreConversation, statusForScore, shouldNotifyAdmin } from "@/lib/scoring";
import { agentResultSchema } from "@/lib/validations";
import type {
  AgentMediaAttachment,
  AgentResult,
  AgentSettings,
  AgentTone,
  KnowledgeBaseEntry,
  KnowledgeFile,
  Product,
} from "@/lib/types";

export interface GenerateOptions {
  messages: { role: "user" | "assistant"; content: string }[];
  settings?: Partial<AgentSettings>;
  knowledge?: KnowledgeBaseEntry[];
  files?: KnowledgeFile[];
  products?: Product[];
  toneOverride?: AgentTone;
  promptOverride?: string;
  previousScore?: number;
  /** Long-term memory of the prospect (known facts + rolling summary). */
  memory?: ConversationMemory;
  /** Tenant OpenAI key; falls back to the platform key when omitted. */
  openaiKey?: string;
}

/**
 * Generate a structured agent response. Uses the configured LLM when a key is
 * present, otherwise falls back to a deterministic stub so development never
 * blocks on missing credentials (CLAUDE.md §30).
 *
 * The deterministic scorer always runs and is blended with the model's own
 * estimate so the score stays explainable and bounded.
 */
export async function generateAgentResult(options: GenerateOptions): Promise<AgentResult> {
  const contactText = options.messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");

  const heuristic = scoreConversation(contactText, options.previousScore ?? 0);

  const apiKey = options.openaiKey || serverEnv.platformOpenaiApiKey;
  if (!apiKey) {
    return fallbackResult(options, heuristic.score);
  }
  const client = new OpenAI({ apiKey, baseURL: serverEnv.openaiBaseUrl });

  try {
    const systemPrompt = buildSystemPrompt({
      settings: options.settings,
      knowledge: options.knowledge,
      files: options.files,
      products: options.products,
      toneOverride: options.toneOverride,
      promptOverride: options.promptOverride,
      memory: options.memory,
    });

    const completion = await client.chat.completions.create({
      model: serverEnv.openaiModel,
      temperature: 0.5,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        ...options.messages,
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = agentResultSchema.safeParse(JSON.parse(raw));

    if (!parsed.success) {
      console.error("[ai] schema validation failed — using fallback. Issues:", JSON.stringify(parsed.error.issues));
      console.error("[ai] raw LLM output was:", raw.slice(0, 500));
      return fallbackResult(options, heuristic.score);
    }

    // Extract any markdown images the model accidentally put in `reply`
    // (e.g. "![alt](https://...)" or bare URLs) and move them to `media`.
    const sanitized = extractMarkdownImages(parsed.data);

    // Blend model score with deterministic score, then re-derive status so the
    // configured thresholds (§9) are always respected.
    const blended = clamp(Math.round((sanitized.score + heuristic.score) / 2));
    const PRESERVE_STATUS = new Set(["humain_requis", "support_client", "exclu", "spam", "perdu", "client_converti"]);
    const status = PRESERVE_STATUS.has(sanitized.status)
      ? sanitized.status
      : statusForScore(blended, heuristic.criteria);

    return {
      ...sanitized,
      score: blended,
      status,
      should_notify_admin: sanitized.should_notify_admin || shouldNotifyAdmin(status),
    };
  } catch (error) {
    console.error("[ai] generation failed, using fallback:", error);
    return fallbackResult(options, heuristic.score);
  }
}

/**
 * Scan `reply` for markdown image syntax ![alt](url) and bare https URLs that
 * point to known media extensions. Extract them into `media[]` and return a
 * clean reply string with those tokens removed.
 *
 * This guards against models that put image links in the text field instead of
 * using the dedicated `media` array.
 */
function extractMarkdownImages(data: AgentResult): AgentResult {
  const IMAGE_EXTS = /\.(jpe?g|png|gif|webp|svg|avif)(\?[^\s)]*)?$/i;
  const VIDEO_EXTS = /\.(mp4|mov|webm|avi|mkv)(\?[^\s)]*)?$/i;
  const DOC_EXTS = /\.(pdf|docx?|xlsx?|pptx?|csv|txt)(\?[^\s)]*)?$/i;

  const extracted: AgentResult["media"] = [];

  // Match ![alt text](url) or ![](url)
  const MARKDOWN_IMG = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
  // Match bare https URLs pointing to a media file
  const BARE_URL = /https?:\/\/\S+\.(?:jpe?g|png|gif|webp|svg|avif|mp4|mov|webm|pdf|docx?|xlsx?)(?:\?[^\s]*)?\b/gi;

  let reply = data.reply;

  reply = reply.replace(MARKDOWN_IMG, (_match, alt: string, url: string) => {
    const type: AgentMediaAttachment["type"] = VIDEO_EXTS.test(url)
      ? "video"
      : DOC_EXTS.test(url)
        ? "document"
        : "image";
    extracted.push({ type, url, caption: alt.trim() || undefined });
    return "";
  });

  reply = reply.replace(BARE_URL, (url: string) => {
    if (extracted.some((m) => m.url === url)) return "";
    const type: AgentMediaAttachment["type"] = VIDEO_EXTS.test(url)
      ? "video"
      : DOC_EXTS.test(url)
        ? "document"
        : IMAGE_EXTS.test(url)
          ? "image"
          : "image";
    extracted.push({ type, url });
    return "";
  });

  // Clean up leftover whitespace / double newlines
  reply = reply.replace(/\n{3,}/g, "\n\n").trim();

  if (extracted.length === 0) return data;

  const existingMedia = data.media ?? [];
  const allMedia = [...existingMedia, ...extracted].slice(0, 3);

  if (extracted.length > 0) {
    console.info(`[ai] extracted ${extracted.length} media item(s) from reply text → media[]`);
  }

  return { ...data, reply, media: allMedia };
}

/** Deterministic response used when the LLM is unavailable. */
function fallbackResult(options: GenerateOptions, score: number): AgentResult {
  const result = scoreConversation(
    options.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n"),
    score,
  );
  const lastUser = [...options.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const reply = craftFallbackReply(lastUser, result.status);
  return {
    reply,
    intent: /prix|tarif|combien/i.test(lastUser)
      ? "pricing"
      : /démo|demo|essай|tester/i.test(lastUser)
        ? "demo"
        : "prospection",
    status: result.status,
    score: result.score,
    summary: "Réponse générée en mode local (LLM non configuré).",
    next_action:
      result.status === "prospect_qualifie" || result.status === "prospect_chaud"
        ? "Planifier un appel / une démonstration."
        : "Continuer la qualification.",
    should_notify_admin: shouldNotifyAdmin(result.status),
  };
}

function craftFallbackReply(lastUser: string, status: string): string {
  if (status === "spam" || status === "exclu") return "";
  const t = lastUser.toLowerCase();
  if (/photo|image|produit|article|catalogue|montre|envoi.*(photo|image)/i.test(t)) {
    return "Je vérifie ça pour vous et je reviens dans un instant avec les informations ! 🙏";
  }
  if (/livraison|adresse|commander|commande|acheter|prix|tarif|combien/i.test(t)) {
    return "Bien reçu ! Je transmets votre demande à l'équipe et je reviens vers vous rapidement. 🙏";
  }
  if (/démo|demo|tester|essayer/i.test(t)) {
    return "Avec plaisir ! Je peux organiser une démonstration. Quel jour seriez-vous disponible ?";
  }
  return "Merci pour votre message 🙏 Comment puis-je vous aider ?";
}
