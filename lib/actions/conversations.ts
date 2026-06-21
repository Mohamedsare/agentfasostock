"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendWhatsAppText } from "@/lib/wasender";
import { resolveAgentContextForConversation, wasenderCredsOf } from "@/lib/agents";
import { isSupabaseConfigured, serverEnv } from "@/lib/env";
import type { LeadStatus } from "@/lib/types";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function revalidateConversation(id?: string) {
  revalidatePath("/dashboard/conversations");
  if (id) revalidatePath(`/dashboard/conversations/${id}`);
  revalidatePath("/dashboard");
}

/** Take a conversation over manually (pause the AI). */
export async function takeOverConversation(id: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("conversations")
    .update({ mode: "human", ai_enabled: false })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateConversation(id);
  return { ok: true };
}

/** Hand the conversation back to the AI. */
export async function reactivateAi(id: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("conversations")
    .update({ mode: "ai", ai_enabled: true })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateConversation(id);
  return { ok: true };
}

/** Update a conversation's lead status (qualified, converted, lost, …). */
export async function updateConversationStatus(
  id: string,
  status: LeadStatus,
): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const { error } = await supabase.from("conversations").update({ status }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateConversation(id);
  return { ok: true };
}

/** Mark a conversation as read (clear unread badge). */
export async function markConversationRead(id: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: true };
  const supabase = await createClient();
  await supabase.from("conversations").update({ unread_count: 0 }).eq("id", id);
  revalidateConversation(id);
  return { ok: true };
}

/** Send a manual WhatsApp message as the admin; records it and pauses the AI. */
export async function sendManualMessage(
  conversationId: string,
  to: string,
  text: string,
): Promise<ActionResult> {
  const content = text.trim();
  if (!content) return { ok: false, error: "Message vide." };
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };

  const ctx = await resolveAgentContextForConversation(conversationId);
  const creds = ctx
    ? wasenderCredsOf(ctx)
    : { apiKey: null, baseUrl: serverEnv.wasenderBaseUrl };
  const sent = await sendWhatsAppText(to, content, creds);

  const supabase = await createClient();
  await supabase.from("messages").insert({
    agent_id: ctx?.agent.id ?? null,
    conversation_id: conversationId,
    direction: "outbound",
    sender: "admin",
    content,
    wasender_id: sent.id ?? null,
  });
  await supabase
    .from("conversations")
    .update({
      mode: "human",
      ai_enabled: false,
      last_message_at: new Date().toISOString(),
      last_message_preview: content.slice(0, 160),
    })
    .eq("id", conversationId);

  revalidateConversation(conversationId);
  if (!sent.ok) {
    return { ok: false, error: `Message enregistré mais non envoyé : ${sent.error}` };
  }
  return { ok: true };
}

/** Re-include a previously excluded contact and reactivate the AI. */
export async function unexcludeContact(conversationId: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("conversations")
    .update({ status: "nouveau", mode: "ai", ai_enabled: true })
    .eq("id", conversationId);
  if (error) return { ok: false, error: error.message };
  revalidateConversation(conversationId);
  return { ok: true };
}

/**
 * Exclude a contact permanently: marks the conversation as "exclu" and silences
 * the AI. Subsequent inbound messages from this contact are ignored by the engine.
 */
export async function excludeContact(conversationId: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("conversations")
    .update({ status: "exclu", mode: "human", ai_enabled: false })
    .eq("id", conversationId);
  if (error) return { ok: false, error: error.message };
  revalidateConversation(conversationId);
  return { ok: true };
}

/** Add a note to a conversation. */
export async function addNote(
  conversationId: string,
  contactId: string,
  content: string,
): Promise<ActionResult> {
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, error: "Note vide." };
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("notes").insert({
    conversation_id: conversationId,
    contact_id: contactId,
    author_id: user?.id ?? null,
    content: trimmed,
  });
  if (error) return { ok: false, error: error.message };
  revalidateConversation(conversationId);
  return { ok: true };
}
