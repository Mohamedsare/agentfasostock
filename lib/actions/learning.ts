"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveAgentId } from "@/lib/agents";
import { isSupabaseConfigured } from "@/lib/env";
import { runLearning, type LearningRunResult } from "@/lib/learning";
import { LEARNING_KINDS } from "@/lib/learning-meta";
import type { ActionResult } from "@/lib/actions/conversations";
import type { LearningKind, LearningMode, LearningStatus } from "@/lib/types";

function revalidate() {
  revalidatePath("/dashboard/learning");
}

/** Switch the active agent's learning mode (auto / review / off). */
export async function setLearningMode(mode: LearningMode): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  if (!["auto", "review", "off"].includes(mode)) return { ok: false, error: "Mode invalide." };
  const agentId = await getActiveAgentId();
  if (!agentId) return { ok: false, error: "Aucun agent actif." };
  const supabase = await createClient();
  const { error } = await supabase.from("agents").update({ learning_mode: mode }).eq("id", agentId);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

/** Analyse the active agent's recent conversations now (manual trigger). */
export async function runLearningNow(): Promise<ActionResult & { result?: LearningRunResult }> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const agentId = await getActiveAgentId();
  if (!agentId) return { ok: false, error: "Aucun agent actif." };
  try {
    // Manual runs don't wait 30 min — a conversation quiet for 5 min is fair game.
    const result = await runLearning({ agentId, idleMinutes: 5 });
    revalidate();
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Échec de l'analyse." };
  }
}

export async function setLearningStatus(id: string, status: LearningStatus): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  if (!["active", "pending", "rejected"].includes(status)) return { ok: false, error: "Statut invalide." };
  const supabase = await createClient();
  const { error } = await supabase.from("agent_learnings").update({ status }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

const learningEditSchema = z.object({
  kind: z.enum(LEARNING_KINDS as [LearningKind, ...LearningKind[]]),
  title: z.string().trim().min(3, "Titre trop court.").max(140),
  content: z.string().trim().min(10, "Contenu trop court.").max(700),
});

export async function updateLearning(
  id: string,
  input: { kind: LearningKind; title: string; content: string },
): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const parsed = learningEditSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
  const supabase = await createClient();
  // An edit by the team is a confirmation: full confidence.
  const { error } = await supabase
    .from("agent_learnings")
    .update({ ...parsed.data, confidence: 100 })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function deleteLearning(id: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const { error } = await supabase.from("agent_learnings").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}
