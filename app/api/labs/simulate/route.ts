import type { NextRequest } from "next/server";
import { respondSchema } from "@/lib/validations";

// Waits on an LLM call; allow more than the 10s default on Vercel.
export const maxDuration = 30;
import { generateAgentResult } from "@/lib/ai";
import { getAgentSettings, getKnowledge } from "@/lib/data";

/**
 * POST /api/labs/simulate
 * Runs the agent against a simulated transcript and returns the structured
 * AgentResult (reply, intent, status, score, summary, next_action, notify).
 * Used by the Labs page — does not persist anything.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON invalide." }, { status: 400 });
  }

  const parsed = respondSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Requête invalide.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [settings, knowledge] = await Promise.all([getAgentSettings(), getKnowledge()]);

  try {
    const result = await generateAgentResult({
      messages: parsed.data.messages,
      settings,
      knowledge: knowledge.filter((k) => k.is_active),
      toneOverride: parsed.data.toneOverride,
      promptOverride: parsed.data.systemPromptOverride,
      previousScore: parsed.data.previousScore,
    });
    return Response.json(result);
  } catch (error) {
    console.error("[labs/simulate]", error);
    return Response.json({ error: "Échec de génération de la réponse." }, { status: 500 });
  }
}
