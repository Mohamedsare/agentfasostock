import "server-only";
import OpenAI from "openai";
import { serverEnv } from "@/lib/env";
import { buildSystemPrompt, type ConversationMemory } from "@/lib/prompt";
import { clamp, scoreConversation, statusForScore, shouldNotifyAdmin } from "@/lib/scoring";
import { agentResultSchema } from "@/lib/validations";
import { formatWhatsAppReply } from "@/lib/whatsapp-format";
import {
  FULL_DUMP_MAX_PRODUCTS,
  renderProductDetail,
  searchProducts,
  summarizeCategories,
} from "@/lib/catalog";
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
  // Large catalogs only show the best matches in the prompt — give the model a
  // search tool so it can look up anything else instead of guessing.
  const products = options.products ?? [];
  const useCatalogTool = products.filter((p) => p.is_active).length > FULL_DUMP_MAX_PRODUCTS;

  try {
    const systemPrompt = buildSystemPrompt({
      catalogSearch: useCatalogTool,
      settings: options.settings,
      knowledge: options.knowledge,
      files: options.files,
      products: options.products,
      toneOverride: options.toneOverride,
      promptOverride: options.promptOverride,
      memory: options.memory,
      // Drives catalog/knowledge retrieval: only what's relevant to the
      // client's recent messages is injected (see lib/catalog.ts).
      conversation: options.messages,
    });

    const chatMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...options.messages,
    ];

    let raw = "{}";
    for (let round = 0; ; round++) {
      // The last round offers no tools, which forces the final JSON answer.
      const allowTools = useCatalogTool && round < MAX_TOOL_ROUNDS;
      const completion = await client.chat.completions.create({
        model: serverEnv.openaiModel,
        // Low temperature: product answers must stick to the exact catalog data.
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: chatMessages,
        ...(allowTools ? { tools: [SEARCH_PRODUCTS_TOOL], tool_choice: "auto" as const } : {}),
      });
      const message = completion.choices[0]?.message;
      const toolCalls = allowTools ? (message?.tool_calls ?? []) : [];
      if (!message || toolCalls.length === 0) {
        raw = message?.content ?? "{}";
        break;
      }
      chatMessages.push({ role: "assistant", content: message.content ?? null, tool_calls: toolCalls });
      for (const call of toolCalls) {
        const content =
          call.type === "function" && call.function.name === "search_products"
            ? runSearchTool(products, call.function.arguments)
            : "Outil inconnu.";
        chatMessages.push({ role: "tool", tool_call_id: call.id, content });
      }
    }
    const parsed = agentResultSchema.safeParse(JSON.parse(raw));

    if (!parsed.success) {
      console.error("[ai] schema validation failed — using fallback. Issues:", JSON.stringify(parsed.error.issues));
      console.error("[ai] raw LLM output was:", raw.slice(0, 500));
      return fallbackResult(options, heuristic.score);
    }

    // Normalise nullish fields from LLM (null → undefined) → clean AgentResult shape.
    const ec = parsed.data.extracted_contact;
    const normalised: AgentResult = {
      ...parsed.data,
      media: parsed.data.media
        ? parsed.data.media.map((m) => ({ ...m, caption: m.caption ?? undefined }))
        : undefined,
      extracted_contact: ec
        ? {
            name: ec.name ?? undefined,
            city: ec.city ?? undefined,
            need: ec.need ?? undefined,
            business_type: ec.business_type ?? undefined,
          }
        : undefined,
    };

    // Extract any markdown images the model accidentally put in `reply`
    // (e.g. "![alt](https://...)" or bare URLs) and move them to `media`.
    // Then drop any media URL the model invented — only real catalog/document files go out.
    const grounded = keepGroundedMedia(extractMarkdownImages(normalised), options);
    // Guarantee WhatsApp syntax (*gras*, one list item per line) whatever the model produced.
    const sanitized = { ...grounded, reply: formatWhatsAppReply(grounded.reply) };

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

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/** Max search rounds before the model must answer (each round = one LLM call). */
const MAX_TOOL_ROUNDS = 3;

const SEARCH_PRODUCTS_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "search_products",
    description:
      "Recherche dans le catalogue produits COMPLET de l'entreprise (nom, référence, marque, catégorie, description). " +
      "Utilise-la dès que le produit demandé n'a pas de fiche détaillée dans le prompt, pour une recherche par modèle de moto, " +
      "marque, catégorie ou budget, pour trouver une alternative en stock, et TOUJOURS avant d'affirmer qu'un produit n'est pas disponible.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Mots-clés : nom de la pièce, référence, modèle (ex. \"albracame 115\", \"kit piston crypton\").",
        },
        category: { type: "string", description: "Filtrer par catégorie (optionnel)." },
        brand: { type: "string", description: "Filtrer par marque (optionnel)." },
        in_stock_only: { type: "boolean", description: "Uniquement les produits en stock (optionnel)." },
        max_price: { type: "number", description: "Prix maximum (optionnel)." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

/** Execute a `search_products` call and render results exactly like the prompt's product sheets. */
function runSearchTool(products: Product[], rawArgs: string): string {
  let args: { query?: unknown; category?: unknown; brand?: unknown; in_stock_only?: unknown; max_price?: unknown };
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {
    return "Arguments invalides : fournis un objet JSON avec au moins \"query\".";
  }
  const query = typeof args.query === "string" ? args.query : "";
  const filters = {
    category: typeof args.category === "string" && args.category.trim() ? args.category : undefined,
    brand: typeof args.brand === "string" && args.brand.trim() ? args.brand : undefined,
    inStockOnly: args.in_stock_only === true,
    maxPrice: typeof args.max_price === "number" ? args.max_price : undefined,
  };
  const results = searchProducts(products, query, filters, 8);
  console.info(`[ai] search_products "${query}" → ${results.length} result(s)`);
  if (results.length === 0) {
    const categories = summarizeCategories(products, 40).map((c) => c.name).join(", ");
    return (
      `Aucun produit ne correspond à « ${query} »${filters.category ? ` (catégorie ${filters.category})` : ""}${filters.brand ? ` (marque ${filters.brand})` : ""}. ` +
      `Catégories existantes : ${categories || "aucune"}. ` +
      "Réessaie avec d'autres mots-clés (synonyme, référence, modèle, sans filtre) avant de conclure que le produit n'existe pas."
    );
  }
  return `${results.length} résultat(s) pour « ${query} » :\n${results.map(renderProductDetail).join("\n")}`;
}

/** Keep only media whose URL really exists in the catalog or the knowledge files. */
function keepGroundedMedia(data: AgentResult, options: GenerateOptions): AgentResult {
  if (!data.media?.length) return data;
  const allowed = new Set([
    ...(options.products ?? []).flatMap((p) => p.images),
    ...(options.files ?? []).map((f) => f.public_url),
  ]);
  const media = data.media.filter((m) => allowed.has(m.url));
  if (media.length !== data.media.length) {
    console.warn(`[ai] dropped ${data.media.length - media.length} media URL(s) not found in catalog/documents`);
  }
  return { ...data, media: media.length ? media : undefined };
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
