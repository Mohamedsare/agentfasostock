import "server-only";
import OpenAI from "openai";
import { serverEnv, features } from "@/lib/env";
import { buildSystemPrompt } from "@/lib/prompt";
import { clamp, scoreConversation, statusForScore, shouldNotifyAdmin } from "@/lib/scoring";
import { agentResultSchema } from "@/lib/validations";
import type {
  AgentResult,
  AgentSettings,
  AgentTone,
  KnowledgeBaseEntry,
} from "@/lib/types";

export interface GenerateOptions {
  messages: { role: "user" | "assistant"; content: string }[];
  settings?: Partial<AgentSettings>;
  knowledge?: KnowledgeBaseEntry[];
  toneOverride?: AgentTone;
  promptOverride?: string;
  previousScore?: number;
}

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: serverEnv.openaiApiKey,
      baseURL: serverEnv.openaiBaseUrl,
    });
  }
  return client;
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

  if (!features.openai) {
    return fallbackResult(options, heuristic.score);
  }

  try {
    const systemPrompt = buildSystemPrompt({
      settings: options.settings,
      knowledge: options.knowledge,
      toneOverride: options.toneOverride,
      promptOverride: options.promptOverride,
    });

    const completion = await getClient().chat.completions.create({
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
      return fallbackResult(options, heuristic.score);
    }

    // Blend model score with deterministic score, then re-derive status so the
    // configured thresholds (§9) are always respected.
    const blended = clamp(Math.round((parsed.data.score + heuristic.score) / 2));
    const status =
      parsed.data.status === "humain_requis" || parsed.data.status === "support_client"
        ? parsed.data.status
        : statusForScore(blended, heuristic.criteria);

    return {
      ...parsed.data,
      score: blended,
      status,
      should_notify_admin: parsed.data.should_notify_admin || shouldNotifyAdmin(status),
    };
  } catch (error) {
    console.error("[ai] generation failed, using fallback:", error);
    return fallbackResult(options, heuristic.score);
  }
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
  if (status === "spam") return "";
  if (/prix|tarif|combien/i.test(lastUser)) {
    return "Bonne question ! Le tarif dépend de votre activité. Pour vous proposer la formule adaptée, pouvez-vous me dire quel type de commerce vous gérez ?";
  }
  if (/démo|demo|tester|essayer/i.test(lastUser)) {
    return "Avec plaisir ! Je peux organiser une démonstration. Quel jour seriez-vous disponible ?";
  }
  return "Merci pour votre message 🙏 Pour bien vous aider, pouvez-vous me dire quel type de commerce vous gérez et dans quelle ville ?";
}
