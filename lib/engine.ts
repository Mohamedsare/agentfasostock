import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateAgentResult } from "@/lib/ai";
import {
  sendWhatsAppText,
  sendWhatsAppAudio,
  sendWhatsAppImage,
  sendLeadWhatsApp,
  uploadMediaToWasender,
  decryptMediaFile,
  type InboundMessage,
  type SendResult,
  type WasenderCreds,
} from "@/lib/wasender";
import { transcribeAudio, describeImage, synthesizeSpeech } from "@/lib/media";
import { stripWhatsAppFormatting } from "@/lib/whatsapp-format";
import { probeImage, queueOutboundMedia, sendMediaDirect } from "@/lib/outbound";
import {
  BURST_WINDOW_MS,
  NEUTRAL_FOLLOW_UP_REPLY,
  NO_HANDOFF_INSTRUCTION,
  canAutoResume,
  handoffJustified,
} from "@/lib/handoff";
import { isPersonalMessage, scoreConversation, shouldNotifyAdmin } from "@/lib/scoring";
import { classifyProspect } from "@/lib/classifier";
import { scheduleFollowUp, stopFollowUps, isTerminalForFollowUp } from "@/lib/follow-ups";
import type {
  AgentContext,
  AgentLearning,
  AgentResult,
  Contact,
  Conversation,
  EmailTrigger,
  KnowledgeBaseEntry,
  KnowledgeFile,
  LeadStatus,
  Message,
  Product,
} from "@/lib/types";

type Ctx = AgentContext;
const credsOf = (ctx: Ctx): WasenderCreds => ({
  apiKey: ctx.wasenderKey,
  baseUrl: ctx.wasenderBaseUrl,
});

type Db = ReturnType<typeof createAdminClient>;

export interface InboundResult {
  status: "processed" | "ignored" | "duplicate";
  conversationId?: string;
  reply?: string;
  leadStatus?: LeadStatus;
  score?: number;
  reason?: string;
  sent?: boolean;
  sendError?: string;
  /** Attachments waiting in the outbound queue — the webhook flushes them after answering. */
  queuedMedia?: number;
}

/**
 * Core conversation pipeline (CLAUDE.md §20). Runs with the service-role client
 * so it works from webhooks without a user session. Idempotent on the inbound
 * Wasender message id.
 */
export async function handleInboundMessage(
  inbound: InboundMessage,
  ctx: Ctx,
): Promise<InboundResult> {
  if (inbound.fromMe) return { status: "ignored", reason: "outgoing_echo" };

  const db = createAdminClient();
  const agentId = ctx.agent.id;

  // Dedupe on the provider message id (scoped to this agent).
  if (inbound.messageId) {
    const { data: existing } = await db
      .from("messages")
      .select("id")
      .eq("agent_id", agentId)
      .eq("wasender_id", inbound.messageId)
      .maybeSingle();
    if (existing) return { status: "duplicate" };
  }

  // Events with neither text nor usable media (reactions, protocol messages…).
  if (inbound.kind === "other" && !inbound.text.trim()) {
    return { status: "ignored", reason: "unsupported_or_empty" };
  }

  const contact = await upsertContact(db, inbound, agentId);
  const conversation = await getOrCreateConversation(db, contact.id, agentId);

  // Record the inbound message FIRST, keyed on the provider id. A webhook that
  // Wasender re-sends while we're still transcribing / answering hits the
  // unique index (migration 0015) and stops here — no double reply.
  const { data: inboundRow, error: inboundError } = await db
    .from("messages")
    .insert({
      agent_id: agentId,
      conversation_id: conversation.id,
      direction: "inbound",
      sender: "contact",
      content: inbound.text.trim() || "…",
      wasender_id: inbound.messageId,
    })
    .select("id")
    .single();
  if (inboundError || !inboundRow) {
    if (inboundError?.code === "23505") return { status: "duplicate" };
    throw new Error(`inbound message insert failed: ${inboundError?.message}`);
  }
  const inboundId = (inboundRow as { id: string }).id;

  // Turn whatever the client sent (text, voice, image, document…) into text the
  // agent can reason about, and decide whether to answer with a voice note.
  const resolved = await resolveInboundContent(inbound, ctx, conversation.id);
  if (!resolved.text) {
    await db.from("messages").delete().eq("id", inboundId);
    return { status: "ignored", reason: "unsupported_or_empty" };
  }
  if (resolved.media) {
    // The dashboard shows the file itself; `content` keeps the text the agent reads.
    const { error } = await db
      .from("messages")
      .update({ content: resolved.text, media_url: resolved.media.url, media_type: resolved.media.type })
      .eq("id", inboundId);
    // Before migration 0018 the media columns don't exist: keep the text at least.
    if (error) await db.from("messages").update({ content: resolved.text }).eq("id", inboundId);
  } else if (resolved.text !== inbound.text.trim()) {
    await db.from("messages").update({ content: resolved.text }).eq("id", inboundId);
  }
  await db
    .from("conversations")
    .update({
      last_message_at: new Date(inbound.timestamp).toISOString(),
      last_message_preview: resolved.text.slice(0, 160),
      unread_count: conversation.unread_count + 1,
    })
    .eq("id", conversation.id);

  // Excluded (personal) contact: the message stays visible in the dashboard,
  // but the agent never answers it.
  if (conversation.status === "exclu") {
    return { status: "ignored", reason: "contact_exclu", conversationId: conversation.id };
  }

  // The prospect just replied — stop any pending follow-up chain (§16).
  await stopFollowUps(db, conversation.id, "responded");

  await logAudit(db, agentId, "contact", "inbound_message", conversation.id, {
    phone: contact.phone,
  });

  // Decide whether the AI should reply (this agent's own config).
  let aiShouldReply =
    ctx.agent.ai_enabled && conversation.ai_enabled && conversation.mode === "ai";

  // An AI handoff nobody picked up must not leave the client unanswered forever
  // (a human takeover is never overridden — see lib/handoff.ts).
  if (!aiShouldReply && ctx.agent.ai_enabled && canAutoResume(conversation)) {
    await safeConversationUpdate(
      db,
      conversation.id,
      { mode: "ai", ai_enabled: true, status: "prospect_tiede" },
      { silenced_by: null, silenced_at: null },
    );
    await logAudit(db, agentId, "ai", "ai_auto_resumed", conversation.id, {
      silenced_at: conversation.silenced_at ?? null,
    });
    Object.assign(conversation, { mode: "ai", ai_enabled: true, status: "prospect_tiede" });
    aiShouldReply = true;
  }

  if (!aiShouldReply) {
    return {
      status: "processed",
      conversationId: conversation.id,
      reason: "ai_disabled_or_human_mode",
    };
  }

  // Clients often send several short messages in a row ("Prix" / "L'original" /
  // "Photo"): wait a moment and answer once — from the latest message's run,
  // with the whole burst in context — instead of overlapping replies.
  await new Promise((r) => setTimeout(r, BURST_WINDOW_MS));
  const { data: latestInbound } = await db
    .from("messages")
    .select("id")
    .eq("conversation_id", conversation.id)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestInbound && (latestInbound as { id: string }).id !== inboundId) {
    return { status: "processed", conversationId: conversation.id, reason: "burst_merged_into_next_message" };
  }

  // Deterministic personal-message filter — runs before any AI call so no LLM
  // tokens are spent on family/social messages. If the text clearly matches a
  // personal pattern (eating plans, family terms, personal coordination…) AND
  // contains no commercial signal, mark the conversation exclu and stay silent.
  if (isPersonalMessage(resolved.text)) {
    await db
      .from("conversations")
      .update({ status: "exclu", mode: "human", ai_enabled: false })
      .eq("id", conversation.id);
    await stopFollowUps(db, conversation.id, "cancelled");
    return {
      status: "processed",
      conversationId: conversation.id,
      reason: "contact_personnel_detecte",
    };
  }

  // Fetch message history first (lightweight) — needed both to detect first
  // messages and later to build the AI context.
  const history = await getRecentHistory(db, conversation.id);

  // ── LLM prospect classifier ──────────────────────────────────────────────
  // Runs on the first TWO messages of a new contact (history.length <= 2).
  // Uses gpt-4o-mini (~$0.000025/call). If the classifier decides this is NOT
  // a prospect, we stay silent THIS turn only — we do NOT permanently mark the
  // conversation exclu. The next message is re-evaluated independently.
  //
  // Permanent "exclu" is only set by:
  //   • The deterministic regex filter above (very high confidence)
  //   • The admin clicking "Exclure" manually in the dashboard
  //
  // This design avoids the trap where a prospect starts with an ambiguous
  // greeting ("Bonjour", "SALUT MOHAMED") that gets mis-classified, which
  // would permanently block all their follow-up commercial messages.
  //
  // Fails open: any API error returns isProspect=true so real leads are never
  // dropped silently.
  if (history.length <= 2) {
    const classification = await classifyProspect(resolved.text, ctx.openaiKey);
    if (!classification.isProspect) {
      await logAudit(db, agentId, "classifier", "message_skipped_non_prospect", conversation.id, {
        reason: classification.reason,
        preview: resolved.text.slice(0, 100),
      });
      return {
        status: "processed",
        conversationId: conversation.id,
        reason: `non_prospect_skip: ${classification.reason}`,
      };
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Only fetch knowledge/products once we know we'll generate a response.
  const [knowledge, files, products, learnings] = await Promise.all([
    getActiveKnowledge(db, agentId),
    getActiveKnowledgeFiles(db, agentId),
    getActiveProducts(db, agentId),
    getActiveLearnings(db, agentId),
  ]);

  const generationOptions = {
    messages: history,
    settings: ctx.agent,
    knowledge,
    files,
    products,
    learnings,
    previousScore: conversation.score,
    // Long-term memory: known facts + rolling summary, so the agent never loses
    // context past the raw-history window or restarts the discussion.
    memory: {
      contactName: contact.name,
      businessType: contact.business_type,
      city: contact.city,
      need: contact.need,
      summary: conversation.summary,
    },
    openaiKey: ctx.openaiKey,
  };
  let result = await generateAgentResult(generationOptions);

  // The model may only go silent for good reasons (explicit request for a human
  // or complaint; a first contact that isn't a client). Otherwise — "Prix", an
  // unknown service, a photo it can't identify — answer the client instead of
  // switching the AI off for them forever.
  if (isSilentHandoff(result.status) && !handoffJustified(result.status, history)) {
    await logAudit(db, agentId, "ai", "handoff_blocked", conversation.id, {
      status: result.status,
      preview: resolved.text.slice(0, 100),
    });
    result = await generateAgentResult({ ...generationOptions, extraInstruction: NO_HANDOFF_INSTRUCTION });
    if (isSilentHandoff(result.status)) result = { ...result, status: "prospect_tiede" };
    if (!result.reply.trim()) result = { ...result, reply: NEUTRAL_FOLLOW_UP_REPLY };
  }

  // The LLM call failed and a canned reply is being used: keep the exact reason
  // in audit_logs so production failures are diagnosable without server logs.
  if (result.fallback_reason) {
    await logAudit(db, agentId, "ai", "ai_generation_failed", conversation.id, {
      reason: result.fallback_reason,
      preview: resolved.text.slice(0, 100),
    });
  }

  await applyAgentResult(db, { conversation, contact, result, history, ctx });

  // On a silent handoff (qualified/hot lead, or explicit human request) we
  // deliberately stay silent with the prospect: never tell them we're passing
  // them to someone else (no "je transmets vos infos à Mohamed"). The WhatsApp
  // alert (in applyAgentResult) fires immediately so Mohamed picks up in person
  // without the prospect noticing the switch.
  const isHandoff = isSilentHandoff(result.status);

  // Send the reply over WhatsApp (skip for spam / empty / human handoff).
  // When the client wrote by voice, answer by voice too (voice in → voice out).
  let sent: SendResult = { ok: false, error: "no_reply" };
  let repliedByVoice = false;
  let queuedMedia = 0;
  if (result.reply && result.status !== "spam" && !isHandoff) {
    let remainingMedia = result.media?.slice(0, 4) ?? [];

    // One product photo: send it WITH the reply as its caption — a single
    // WhatsApp message, so Wasender's account protection ("1 message / 5 s")
    // can't reject the photo, and the client sees both together.
    const solo =
      remainingMedia.length === 1 &&
      remainingMedia[0].type === "image" &&
      !resolved.replyAsVoice &&
      result.reply.length <= 1000
        ? remainingMedia[0]
        : null;
    let captionSent = false;
    if (solo && (await probeImage(solo.url)) !== "unsupported") {
      const combined = await sendWhatsAppImage(contact.phone, solo.url, credsOf(ctx), result.reply);
      if (combined.ok) {
        sent = combined;
        captionSent = true;
        remainingMedia = [];
      } else {
        console.error(`[engine] photo+caption send failed, falling back to text then photo: ${combined.error}`);
      }
    }

    let voiceUrl: string | null = null;
    if (!captionSent) {
      const delivery = await deliverReply(ctx, contact.phone, result.reply, resolved.replyAsVoice, conversation.id);
      sent = delivery.sent;
      repliedByVoice = delivery.byVoice;
      voiceUrl = delivery.voiceUrl;
    }
    if (!sent.ok) {
      console.error(`[engine] WhatsApp send failed for ${contact.phone}: ${sent.error}`);
    }
    const replyRow = {
      agent_id: agentId,
      conversation_id: conversation.id,
      direction: "outbound",
      sender: "ai",
      content: repliedByVoice ? `🎤 ${result.reply}` : result.reply,
      intent: result.intent,
      wasender_id: sent.id ?? null,
    };
    if (voiceUrl) {
      // The voice note stays playable in the dashboard; before migration 0018, text only.
      const { error } = await db.from("messages").insert({ ...replyRow, media_url: voiceUrl, media_type: "audio" });
      if (error) await db.from("messages").insert(replyRow);
    } else {
      await db.from("messages").insert(replyRow);
    }
    if (captionSent && solo) {
      // Same WhatsApp message as the text above; logged separately so the dashboard shows the photo.
      await db.from("messages").insert({
        agent_id: agentId,
        conversation_id: conversation.id,
        direction: "outbound",
        sender: "ai",
        content: `[image] ${solo.url}`,
        intent: result.intent,
        wasender_id: null,
      });
    }

    // Product photos & other attachments go through a persistent queue
    // (lib/outbound.ts): delivered in order right after the webhook answers,
    // paced to the number's sending limit, retried by the cron if WhatsApp
    // refuses or time runs out — never silently lost, whatever their number.
    if (remainingMedia.length) {
      const queued = await queueOutboundMedia({
        agentId,
        conversationId: conversation.id,
        phone: contact.phone,
        media: remainingMedia,
      });
      if (queued) {
        queuedMedia = remainingMedia.length;
      } else {
        // Queue table not migrated yet: send right away as before.
        await sendMediaDirect(db, {
          agentId,
          conversationId: conversation.id,
          phone: contact.phone,
          media: remainingMedia,
          creds: credsOf(ctx),
        });
      }
    }
  }

  // Schedule the next relance (24h) when the conversation is still in play.
  // Terminal/handoff statuses get no auto follow-up: a human takes over, or the
  // lead is converted/lost. Only schedule when we actually replied.
  // `follow_ups_enabled === false` = relances turned off for this agent.
  const followUpsEnabled = ctx.agent.follow_ups_enabled !== false;
  if (followUpsEnabled && sent.ok && !isHandoff && !isTerminalForFollowUp(result.status)) {
    await scheduleFollowUp(db, {
      agentId,
      conversation: { id: conversation.id, status: result.status },
      contact,
      step: 1,
    });
  } else if (isHandoff || isTerminalForFollowUp(result.status)) {
    await stopFollowUps(db, conversation.id, "cancelled");
  }

  return {
    status: "processed",
    conversationId: conversation.id,
    reply: result.reply,
    leadStatus: result.status,
    score: result.score,
    sent: sent.ok,
    sendError: sent.ok ? undefined : sent.error,
    queuedMedia,
  };
}

/** Persist scoring/status/summary, a qualification record, and notify if needed. */
async function applyAgentResult(
  db: Db,
  args: {
    conversation: Conversation;
    contact: Contact;
    result: AgentResult;
    history: { role: "user" | "assistant"; content: string }[];
    ctx: Ctx;
  },
) {
  const { conversation, contact, result, ctx } = args;
  // Only humain_requis and exclu stop the AI; qualified/hot prospects keep getting replies.
  const isHandoff = isSilentHandoff(result.status);

  await safeConversationUpdate(
    db,
    conversation.id,
    {
      status: result.status,
      score: result.score,
      intent: result.intent,
      summary: result.summary,
      next_action: result.next_action,
      last_message_at: new Date().toISOString(),
      last_message_preview: (result.reply ?? "").slice(0, 160),
      // Silence the AI on handoffs and excluded (personal) contacts.
      ...(isHandoff ? { mode: "human", ai_enabled: false } : {}),
    },
    // Marked as an AI decision so it can auto-resume if no human takes over.
    isHandoff ? { silenced_by: "ai", silenced_at: new Date().toISOString() } : {},
  );

  // Persist contact facts extracted by the AI (name, city, need, business_type).
  // Only overwrite a field when the AI found a non-empty value AND the field is
  // currently blank — never erase data the webhook or a human already set.
  const ec = result.extracted_contact;
  if (ec) {
    const patch: Record<string, string> = {};
    if (ec.name && !contact.name) patch.name = ec.name;
    if (ec.city && !contact.city) patch.city = ec.city;
    if (ec.need) patch.need = ec.need; // always update: need evolves as conversation progresses
    if (ec.business_type && !contact.business_type) patch.business_type = ec.business_type;
    if (Object.keys(patch).length) {
      await db.from("contacts").update(patch).eq("id", contact.id);
      Object.assign(contact, patch); // keep in-memory copy in sync
    }
  }

  // Store a qualification snapshot with the matched criteria.
  const contactText = args.history.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  const { criteria } = scoreConversation(contactText, conversation.score);
  await db.from("lead_qualifications").insert({
    agent_id: ctx.agent.id,
    conversation_id: conversation.id,
    contact_id: contact.id,
    score: result.score,
    status: result.status,
    intent: result.intent,
    summary: result.summary,
    next_action: result.next_action,
    criteria,
  });

  // Alert Mohamed over WhatsApp on notable transitions (qualified, hot,
  // converted, human-requested) — once, when the status first changes, so we
  // don't spam on every message. This is the ONLY outbound action on a silent
  // handoff: the prospect gets no reply, Mohamed gets the alert.
  const trigger = emailTriggerFor(result.status);
  const becameNotable = result.status !== conversation.status && shouldNotifyAdmin(result.status);
  if (trigger && (result.status === "humain_requis" || becameNotable)) {
    await notifyAdmin(db, { trigger, contact, conversation: { ...conversation, ...result }, ctx });
  }
}

async function notifyAdmin(
  db: Db,
  args: { trigger: EmailTrigger; contact: Contact; conversation: Conversation & AgentResult; ctx: Ctx },
) {
  const { trigger, contact, conversation, ctx } = args;
  // The agent's owner is alerted over WhatsApp when a lead becomes notable.
  const sent = await sendLeadWhatsApp({
    trigger,
    contact,
    conversation: {
      ...conversation,
      status: conversation.status,
      score: conversation.score,
      summary: conversation.summary,
      next_action: conversation.next_action,
    } as Conversation,
    creds: credsOf(ctx),
    adminWhatsapp: ctx.adminWhatsapp,
  });

  if (!sent.ok) {
    console.error(`[engine] admin WhatsApp alert failed (${trigger}): ${sent.error}`);
  }

  // Keep a notification trail even though the channel is now WhatsApp.
  await db.from("email_notifications").insert({
    agent_id: ctx.agent.id,
    trigger,
    to_email: ctx.adminWhatsapp,
    subject: `WhatsApp · ${trigger}`,
    conversation_id: conversation.id,
    contact_id: contact.id,
    status: sent.ok ? "sent" : "failed",
    error: sent.error ?? null,
    sent_at: sent.ok ? new Date().toISOString() : null,
  });
}

// ─────────────────────────── media ───────────────────────────

interface ResolvedInbound {
  /** Text the agent reasons about + stores (with a small kind marker). */
  text: string;
  /** Answer with a voice note (true only for understood voice notes). */
  replyAsVoice: boolean;
  /** Permanent copy of the received file, shown in the dashboard. */
  media?: { type: "image" | "video" | "audio" | "document"; url: string };
}

/**
 * Normalise any inbound message kind into agent-usable text. Voice notes are
 * transcribed, images are described; other media are acknowledged with a clear
 * marker so the agent and Mohamed both know what the client sent. Received
 * files are also copied to Storage (the decrypted Wasender URL expires in ~1h).
 */
async function resolveInboundContent(
  inbound: InboundMessage,
  ctx: Ctx,
  conversationId: string,
): Promise<ResolvedInbound> {
  const caption = inbound.media?.caption?.trim() || inbound.text.trim();
  const keep = async (url: string | null, type: NonNullable<ResolvedInbound["media"]>["type"]) => {
    const stored = url ? await persistInboundMedia(url, inbound, conversationId) : null;
    return stored ? { type, url: stored } : undefined;
  };

  switch (inbound.kind) {
    case "text":
      return { text: inbound.text.trim(), replyAsVoice: false };

    case "audio": {
      const url = await getDecryptedMediaUrl(inbound, ctx);
      const [transcript, media] = await Promise.all([
        url ? transcribeAudio(url, ctx.openaiKey, inbound.media?.mimetype) : null,
        keep(url, "audio"),
      ]);
      if (transcript) return { text: `🎤 ${transcript}`, replyAsVoice: true, media };
      // Couldn't understand the voice note — answer in text and ask to repeat.
      return {
        text: "🎤 (message vocal reçu — transcription indisponible)",
        replyAsVoice: false,
        media,
      };
    }

    case "image": {
      const url = await getDecryptedMediaUrl(inbound, ctx);
      const [description, media] = await Promise.all([
        url ? describeImage(url, ctx.openaiKey, caption) : null,
        keep(url, "image"),
      ]);
      const parts = ["🖼️ Image reçue."];
      if (caption) parts.push(`Légende : ${caption}.`);
      if (description) parts.push(`Contenu : ${description}`);
      return { text: parts.join(" "), replyAsVoice: false, media };
    }

    case "video":
      return {
        text: `🎬 Vidéo reçue.${caption ? ` Légende : ${caption}` : ""}`,
        replyAsVoice: false,
        media: await keep(await getDecryptedMediaUrl(inbound, ctx), "video"),
      };

    case "document":
      return {
        text: `📎 Document reçu${inbound.media?.fileName ? ` : ${inbound.media.fileName}` : ""}.${
          caption ? ` ${caption}` : ""
        }`,
        replyAsVoice: false,
        media: await keep(await getDecryptedMediaUrl(inbound, ctx), "document"),
      };

    case "location":
      return { text: "📍 Localisation partagée par le client.", replyAsVoice: false };

    case "contact":
      return { text: "👤 Carte de contact partagée par le client.", replyAsVoice: false };

    case "sticker":
      return {
        text: caption || "😄 (sticker reçu)",
        replyAsVoice: false,
        media: await keep(await getDecryptedMediaUrl(inbound, ctx), "image"),
      };

    default:
      return { text: caption || "", replyAsVoice: false };
  }
}

/** Same public bucket as manual attachments (lib/actions/conversations.ts). */
const CHAT_MEDIA_BUCKET = "chat-media";
/** Received files bigger than this are not copied (the text marker stays). */
const MAX_INBOUND_MEDIA_BYTES = 25 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "application/pdf": "pdf",
};

/**
 * Copy a decrypted inbound file to Storage and return its permanent public URL.
 * Best effort: any failure returns null and the message keeps its text only.
 */
async function persistInboundMedia(
  sourceUrl: string,
  inbound: InboundMessage,
  conversationId: string,
): Promise<string | null> {
  try {
    const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    if (Number(res.headers.get("content-length")) > MAX_INBOUND_MEDIA_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_INBOUND_MEDIA_BYTES) return null;

    const contentType = (inbound.media?.mimetype ?? res.headers.get("content-type") ?? "application/octet-stream")
      .split(";")[0]
      .trim();
    const name = inbound.media?.fileName || `${inbound.kind}.${EXTENSIONS[contentType] ?? "bin"}`;
    return await storeChatMedia(bytes, contentType, conversationId, `in_${name}`);
  } catch (err) {
    console.error(`[engine] inbound media not stored: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/** Upload bytes to the chat-media bucket; returns the public URL, or null on failure. */
async function storeChatMedia(
  bytes: Uint8Array,
  contentType: string,
  conversationId: string,
  fileName: string,
): Promise<string | null> {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const path = `${conversationId}/${Date.now()}_${safeName}`;
  const admin = createAdminClient();
  const bucket = admin.storage.from(CHAT_MEDIA_BUCKET);
  let { error } = await bucket.upload(path, bytes, { contentType, upsert: false });
  if (error) {
    // Missing bucket on a fresh project: create it and retry once.
    await admin.storage.createBucket(CHAT_MEDIA_BUCKET, { public: true });
    ({ error } = await bucket.upload(path, bytes, { contentType, upsert: false }));
  }
  if (error) {
    console.error(`[engine] media not stored: ${error.message}`);
    return null;
  }
  return bucket.getPublicUrl(path).data.publicUrl;
}

/** Decrypt an inbound media message to a temporary public URL (or null). */
async function getDecryptedMediaUrl(inbound: InboundMessage, ctx: Ctx): Promise<string | null> {
  if (!inbound.media?.url || !inbound.rawMessage) return null;
  const res = await decryptMediaFile(inbound.rawMessage, credsOf(ctx));
  if (!res.ok || !res.url) {
    console.error(`[engine] media decrypt failed: ${res.error}`);
    return null;
  }
  return res.url;
}

/**
 * Deliver the agent reply. When the client used voice we synthesize a voice
 * note (TTS → upload → send); any failure falls back to a plain text message
 * so the prospect always gets an answer.
 */
async function deliverReply(
  ctx: Ctx,
  phone: string,
  reply: string,
  asVoice: boolean,
  conversationId: string,
): Promise<{ sent: SendResult; byVoice: boolean; voiceUrl: string | null }> {
  const creds = credsOf(ctx);
  if (asVoice) {
    // Formatting marks (*gras*, "• ") would be read aloud.
    const speech = await synthesizeSpeech(stripWhatsAppFormatting(reply), ctx.openaiKey);
    if (speech) {
      const uploaded = await uploadMediaToWasender(speech.bytes, speech.mimetype, creds);
      if (uploaded.ok && uploaded.url) {
        // Keep a copy in parallel: the Wasender URL expires after ~24h.
        const [sent, voiceUrl] = await Promise.all([
          sendWhatsAppAudio(phone, uploaded.url, creds),
          storeChatMedia(speech.bytes, speech.mimetype, conversationId, "reponse-vocale.ogg"),
        ]);
        if (sent.ok) return { sent, byVoice: true, voiceUrl };
        console.error(`[engine] voice send failed, falling back to text: ${sent.error}`);
      } else {
        console.error(`[engine] voice upload failed, falling back to text: ${uploaded.error}`);
      }
    }
  }
  return { sent: await sendWhatsAppText(phone, reply, creds), byVoice: false, voiceUrl: null };
}

// ─────────────────────────── helpers ───────────────────────────

async function upsertContact(db: Db, inbound: InboundMessage, agentId: string): Promise<Contact> {
  // Match by phone first; fall back to the WhatsApp "@lid" id so the same person
  // resolves to a single contact even when a webhook omits the phone (which
  // otherwise spawns a duplicate contact and "loses" the conversation history).
  // Scoped per agent: the same phone can be a prospect of different agents.
  let existing: Contact | null = null;
  {
    const byPhone = await db
      .from("contacts")
      .select("*")
      .eq("agent_id", agentId)
      .eq("phone", inbound.from)
      .maybeSingle();
    existing = (byPhone.data as Contact) ?? null;
  }
  if (!existing && inbound.lid) {
    const byLid = await db
      .from("contacts")
      .select("*")
      .eq("agent_id", agentId)
      .eq("lid", inbound.lid)
      .maybeSingle();
    if (!byLid.error) existing = (byLid.data as Contact) ?? null;
  }

  if (existing) {
    // Backfill name, lid, and upgrade a lid-only phone to the real one.
    const patch: Partial<Contact> = {};
    if (!existing.name && inbound.name) patch.name = inbound.name;
    if (!existing.lid && inbound.lid) patch.lid = inbound.lid;
    // A contact first created from a lid-only webhook carries the lid digits as
    // its "phone"; once a real phone shows up, adopt it (guard the unique key).
    if (existing.phone !== inbound.from && isLidLike(existing.phone) && !isLidLike(inbound.from)) {
      patch.phone = inbound.from;
    }
    if (Object.keys(patch).length) {
      let { error } = await db.from("contacts").update(patch).eq("id", existing.id);
      // Retry without `lid` if the column doesn't exist yet (pre-migration).
      if (error && "lid" in patch && isMissingLidColumn(error)) {
        const { lid: _omit, ...rest } = patch;
        ({ error } = await db.from("contacts").update(rest).eq("id", existing.id));
        if (!error) Object.assign(existing, rest);
      } else if (!error) {
        // A phone collision means a real-phone contact already exists; keep the
        // existing row rather than failing the whole inbound message.
        Object.assign(existing, patch);
      }
    }
    return existing;
  }

  const base = {
    agent_id: agentId,
    phone: inbound.from,
    name: inbound.name,
    source: "whatsapp" as const,
  };
  let { data: created, error } = await db
    .from("contacts")
    .insert({ ...base, lid: inbound.lid })
    .select("*")
    .single();
  if (error && isMissingLidColumn(error)) {
    ({ data: created, error } = await db.from("contacts").insert(base).select("*").single());
  }
  if (error || !created) throw new Error(`contact upsert failed: ${error?.message}`);
  return created as Contact;
}

/** A WhatsApp "@lid" id reduces to ~15+ digits — longer than any real phone. */
function isLidLike(value: string): boolean {
  return /^\d{15,}$/.test(value);
}

/** True when an error is "contacts.lid column doesn't exist" (migration 0002 pending). */
function isMissingLidColumn(error: { message?: string; code?: string }): boolean {
  const m = (error.message ?? "").toLowerCase();
  return m.includes("lid") && (m.includes("column") || m.includes("schema cache"));
}

async function getOrCreateConversation(
  db: Db,
  contactId: string,
  agentId: string,
): Promise<Conversation> {
  const { data: existing } = await db
    .from("conversations")
    .select("*")
    .eq("contact_id", contactId)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing as Conversation;

  const { data: created, error } = await db
    .from("conversations")
    .insert({ agent_id: agentId, contact_id: contactId, status: "nouveau", mode: "ai", ai_enabled: true })
    .select("*")
    .single();
  if (error || !created) throw new Error(`conversation create failed: ${error?.message}`);
  return created as Conversation;
}

async function getRecentHistory(
  db: Db,
  conversationId: string,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const { data } = await db
    .from("messages")
    .select("sender, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(40);

  const rows = ((data as Pick<Message, "sender" | "content">[]) ?? []).reverse();
  return rows
    .filter((m) => m.sender !== "system")
    .map((m) => {
      // Sent attachments are stored as "[image] URL\ncaption". Shown raw, the
      // model imitated that syntax in its replies ("Voici la photo : [image] …").
      const media = /^\[(image|video|document|audio)\] (\S+)(?:\n([\s\S]*))?$/.exec(m.content.trim());
      const content = media
        ? `(${media[1] === "image" ? "photo" : "fichier"} déjà envoyé au client${media[3] ? ` : ${media[3].trim()}` : ""} — ${media[2]})`
        : m.content;
      return { role: m.sender === "contact" ? ("user" as const) : ("assistant" as const), content };
    });
}

async function getActiveKnowledge(db: Db, agentId: string): Promise<KnowledgeBaseEntry[]> {
  const { data } = await db
    .from("knowledge_base")
    .select("*")
    .eq("agent_id", agentId)
    .eq("is_active", true);
  return (data as KnowledgeBaseEntry[]) ?? [];
}

/** Active self-learned lessons (lib/learning.ts); tolerant if the table isn't migrated yet. */
async function getActiveLearnings(db: Db, agentId: string): Promise<AgentLearning[]> {
  const { data } = await db
    .from("agent_learnings")
    .select("*")
    .eq("agent_id", agentId)
    .eq("status", "active")
    .order("confidence", { ascending: false })
    .limit(100);
  return (data as AgentLearning[]) ?? [];
}

async function getActiveKnowledgeFiles(db: Db, agentId: string): Promise<KnowledgeFile[]> {
  const { data } = await db
    .from("knowledge_files")
    .select("*")
    .eq("agent_id", agentId)
    .eq("is_active", true);
  return (data as KnowledgeFile[]) ?? [];
}

async function getActiveProducts(db: Db, agentId: string): Promise<Product[]> {
  // Page past PostgREST's 1000-row cap: API-synced catalogs can be large.
  const products: Product[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data } = await db
      .from("products")
      .select("*")
      .eq("agent_id", agentId)
      .eq("is_active", true)
      .order("id")
      .range(from, from + 999);
    products.push(...((data as Product[]) ?? []));
    if (!data || data.length < 1000) break;
  }
  return products;
}

/**
 * Statuses where the lead is handed to Mohamed SILENTLY: the agent must not
 * reply to the prospect (never announce "je transmets vos infos à Mohamed"),
 * the conversation switches to human mode so the AI stops answering.
 * Only explicit human requests and excluded contacts stop the AI.
 * Qualified/hot prospects still get AI replies — the admin is notified separately.
 */
function isSilentHandoff(status: LeadStatus): boolean {
  return status === "humain_requis" || status === "exclu";
}

/**
 * Conversation update that also writes the silence marker (silenced_by/at)
 * when migration 0015 is applied; before that, retries without it.
 */
async function safeConversationUpdate(
  db: Db,
  id: string,
  patch: Record<string, unknown>,
  marker: Record<string, unknown>,
) {
  const { error } = await db.from("conversations").update({ ...patch, ...marker }).eq("id", id);
  if (error && /silenced_/.test(error.message)) {
    await db.from("conversations").update(patch).eq("id", id);
  } else if (error) {
    console.error(`[engine] conversation ${id} update failed: ${error.message}`);
  }
}

function emailTriggerFor(status: LeadStatus): EmailTrigger | null {
  switch (status) {
    case "prospect_qualifie":
      return "prospect_qualifie";
    case "prospect_chaud":
      return "prospect_chaud";
    case "client_converti":
      return "client_converti";
    case "humain_requis":
      return "humain_requis";
    default:
      return null;
  }
}

async function logAudit(
  db: Db,
  agentId: string,
  actor: string,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await db
      .from("audit_logs")
      .insert({ agent_id: agentId, actor, action, entity: "conversation", entity_id: entityId, metadata });
  } catch {
    // auditing is best-effort
  }
}
