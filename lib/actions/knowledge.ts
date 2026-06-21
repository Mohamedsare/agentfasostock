"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveAgentId } from "@/lib/agents";
import { isSupabaseConfigured } from "@/lib/env";
import { knowledgeEntrySchema } from "@/lib/validations";
import type { ActionResult } from "@/lib/actions/conversations";
import type { KnowledgeFileType } from "@/lib/types";

function revalidate() {
  revalidatePath("/dashboard/knowledge-base");
}

export async function createKnowledge(input: unknown): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const parsed = knowledgeEntrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Champs invalides." };

  const agentId = await getActiveAgentId();
  if (!agentId) return { ok: false, error: "Aucun agent actif." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("knowledge_base")
    .insert({ ...parsed.data, agent_id: agentId });
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function updateKnowledge(id: string, input: unknown): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const parsed = knowledgeEntrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Champs invalides." };

  const supabase = await createClient();
  const { error } = await supabase.from("knowledge_base").update(parsed.data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function toggleKnowledge(id: string, isActive: boolean): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const { error } = await supabase.from("knowledge_base").update({ is_active: isActive }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function deleteKnowledge(id: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const { error } = await supabase.from("knowledge_base").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

// ─────────────────────── Knowledge Files ────────────────────────

export interface SaveFileMetaInput {
  agentId: string;
  name: string;
  description?: string;
  fileType: KnowledgeFileType;
  mimeType: string;
  storagePath: string;
  publicUrl: string;
  fileSizeBytes?: number;
}

export async function saveKnowledgeFileMeta(input: SaveFileMetaInput): Promise<ActionResult & { id?: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("knowledge_files")
    .insert({
      agent_id: input.agentId,
      name: input.name,
      description: input.description ?? null,
      file_type: input.fileType,
      mime_type: input.mimeType,
      storage_path: input.storagePath,
      public_url: input.publicUrl,
      file_size_bytes: input.fileSizeBytes ?? null,
      is_active: true,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true, id: data.id };
}

export async function toggleKnowledgeFile(id: string, isActive: boolean): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const { error } = await supabase.from("knowledge_files").update({ is_active: isActive }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function deleteKnowledgeFile(id: string, storagePath: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  // Remove from storage first (best-effort)
  await supabase.storage.from("knowledge-files").remove([storagePath]);
  const { error } = await supabase.from("knowledge_files").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function updateKnowledgeFileDescription(id: string, description: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const { error } = await supabase.from("knowledge_files").update({ description }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}
