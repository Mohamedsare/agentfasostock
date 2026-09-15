"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendWhatsAppAudio,
  sendWhatsAppDocument,
  sendWhatsAppImage,
  sendWhatsAppText,
  sendWhatsAppVideo,
  type SendResult,
} from "@/lib/wasender";
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

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** A human silenced the AI: the engine must never auto-resume it (lib/handoff.ts). */
const ADMIN_SILENCE = () => ({ silenced_by: "admin", silenced_at: new Date().toISOString() });
const NO_SILENCE = { silenced_by: null, silenced_at: null };

/**
 * Update a conversation together with its silence marker; still works before
 * migration 0015 (retries without the marker columns).
 */
async function updateConversation(
  supabase: Supabase,
  id: string,
  patch: Record<string, unknown>,
  marker: Record<string, unknown>,
) {
  const { error } = await supabase.from("conversations").update({ ...patch, ...marker }).eq("id", id);
  if (error && /silenced_/.test(error.message)) {
    return (await supabase.from("conversations").update(patch).eq("id", id)).error;
  }
  return error;
}

/** Take a conversation over manually (pause the AI). */
export async function takeOverConversation(id: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const error = await updateConversation(supabase, id, { mode: "human", ai_enabled: false }, ADMIN_SILENCE());
  if (error) return { ok: false, error: error.message };
  revalidateConversation(id);
  return { ok: true };
}

/** Hand the conversation back to the AI. */
export async function reactivateAi(id: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const error = await updateConversation(supabase, id, { mode: "ai", ai_enabled: true }, NO_SILENCE);
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

async function credsForConversation(conversationId: string) {
  const ctx = await resolveAgentContextForConversation(conversationId);
  const creds = ctx ? wasenderCredsOf(ctx) : { apiKey: null, baseUrl: serverEnv.wasenderBaseUrl };
  return { agentId: ctx?.agent.id ?? null, creds };
}

/** Record an admin message on the timeline and pause the AI. */
async function recordAdminMessage(
  conversationId: string,
  agentId: string | null,
  content: string,
  preview: string,
  sent: SendResult,
): Promise<ActionResult> {
  const supabase = await createClient();
  await supabase.from("messages").insert({
    agent_id: agentId,
    conversation_id: conversationId,
    direction: "outbound",
    sender: "admin",
    content,
    wasender_id: sent.id ?? null,
  });
  await updateConversation(
    supabase,
    conversationId,
    {
      mode: "human",
      ai_enabled: false,
      last_message_at: new Date().toISOString(),
      last_message_preview: preview.slice(0, 160),
    },
    ADMIN_SILENCE(),
  );

  revalidateConversation(conversationId);
  if (!sent.ok) {
    return { ok: false, error: `Message enregistré mais non envoyé : ${sent.error}` };
  }
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

  const { agentId, creds } = await credsForConversation(conversationId);
  const sent = await sendWhatsAppText(to, content, creds);
  return recordAdminMessage(conversationId, agentId, content, content, sent);
}

/** Public bucket holding media sent manually from the conversation view. */
const CHAT_MEDIA_BUCKET = "chat-media";

export interface ChatMediaUpload extends ActionResult {
  path?: string;
  token?: string;
  publicUrl?: string;
}

/**
 * Prepare a direct browser → Storage upload for a manual attachment. The signed
 * URL is issued with the service role (no storage policy needed) only after the
 * user's own session proves access to the conversation. Creates the bucket on
 * first use.
 */
export async function createChatMediaUpload(
  conversationId: string,
  fileName: string,
): Promise<ChatMediaUpload> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const { data: conv } = await supabase.from("conversations").select("id").eq("id", conversationId).maybeSingle();
  if (!conv) return { ok: false, error: "Conversation introuvable." };

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "fichier";
  const path = `${conversationId}/${Date.now()}_${safeName}`;
  const admin = createAdminClient();
  const bucket = () => admin.storage.from(CHAT_MEDIA_BUCKET);

  let signed = await bucket().createSignedUploadUrl(path);
  if (signed.error) {
    // Missing bucket ("The related resource does not exist"): create it and retry once.
    await admin.storage.createBucket(CHAT_MEDIA_BUCKET, { public: true });
    signed = await bucket().createSignedUploadUrl(path);
  }
  if (signed.error || !signed.data) {
    return { ok: false, error: `Upload impossible : ${signed.error?.message ?? "erreur inconnue"}` };
  }
  return {
    ok: true,
    path,
    token: signed.data.token,
    publicUrl: bucket().getPublicUrl(path).data.publicUrl,
  };
}

const manualMediaSchema = z.object({
  type: z.enum(["image", "video", "audio", "document"]),
  url: z.string().url(),
  fileName: z.string().max(200).optional(),
  caption: z.string().max(1000).optional(),
});

export type ManualMedia = z.infer<typeof manualMediaSchema>;

const MEDIA_PREVIEW: Record<ManualMedia["type"], string> = {
  image: "📷 Photo",
  video: "🎬 Vidéo",
  audio: "🎵 Audio",
  document: "📄 Document",
};

/** Send a media (uploaded via createChatMediaUpload) as the admin; pauses the AI. */
export async function sendManualMedia(
  conversationId: string,
  to: string,
  input: ManualMedia,
): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const parsed = manualMediaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Média invalide." };
  const { type, url, fileName } = parsed.data;
  const caption = parsed.data.caption?.trim() || undefined;

  // Only files uploaded to our own bucket for this conversation can be sent.
  const allowedPrefix = `${serverEnv.supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${CHAT_MEDIA_BUCKET}/${conversationId}/`;
  if (!url.startsWith(allowedPrefix)) return { ok: false, error: "Média non autorisé." };

  const { agentId, creds } = await credsForConversation(conversationId);
  let sent: SendResult;
  switch (type) {
    case "image":
      sent = await sendWhatsAppImage(to, url, creds, caption);
      // WhatsApp refuses some image formats (webp, heic…): deliver the file anyway.
      if (!sent.ok && sent.retryable === false) {
        sent = await sendWhatsAppDocument(to, url, creds, fileName, caption);
      }
      break;
    case "video":
      sent = await sendWhatsAppVideo(to, url, creds, caption);
      break;
    case "audio":
      sent = await sendWhatsAppAudio(to, url, creds);
      if (sent.ok && caption) sent = await sendWhatsAppText(to, caption, creds);
      break;
    default:
      sent = await sendWhatsAppDocument(to, url, creds, fileName, caption);
  }

  // Same "[type] URL\ncaption" format as the engine, so the thread renders it.
  const label = caption ?? (type === "document" ? fileName : undefined);
  const content = `[${type}] ${url}${label ? `\n${label}` : ""}`;
  const preview = caption ? `${MEDIA_PREVIEW[type]} · ${caption}` : MEDIA_PREVIEW[type];
  return recordAdminMessage(conversationId, agentId, content, preview, sent);
}

/** Re-include a previously excluded contact and reactivate the AI. */
export async function unexcludeContact(conversationId: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const error = await updateConversation(
    supabase,
    conversationId,
    { status: "nouveau", mode: "ai", ai_enabled: true },
    NO_SILENCE,
  );
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
  const error = await updateConversation(
    supabase,
    conversationId,
    { status: "exclu", mode: "human", ai_enabled: false },
    ADMIN_SILENCE(),
  );
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
