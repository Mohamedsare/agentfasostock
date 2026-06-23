import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateAgentResult } from "@/lib/ai";
import {
  sendWhatsAppText,
  sendWhatsAppAudio,
  sendWhatsAppImage,
  sendWhatsAppDocument,
  sendWhatsAppVideo,
  sendLeadWhatsApp,
  uploadMediaToWasender,
  decryptMediaFile,
  type InboundMessage,
  type SendResult,
  type WasenderCreds,
} from "@/lib/wasender";
import { transcribeAudio, describeImage, synthesizeSpeech } from "@/lib/media";
import { isPersonalMessage, scoreConversation, shouldNotifyAdmin } from "@/lib/scoring";
import { classifyProspect } from "@/lib/classifier";
import { scheduleFollowUp, stopFollowUps, isTerminalForFollowUp } from "@/lib/follow-ups";
import type {
  AgentContext,
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

  // Turn whatever the client sent (text, voice, image, document…) into text the
  // agent can reason about, and decide whether to answer with a voice note.
  const resolved = await resolveInboundContent(inbound, ctx);
  if (!resolved.text) return { status: "ignored", reason: "unsupported_or_empty" };

  const contact = await upsertContact(db, inbound, agentId);
  const conversation = await getOrCreateConversation(db, contact.id, agentId);

  // If this contact is marked as personal/excluded, never respond and stay silent.
  if (conversation.status === "exclu") {
    return { status: "ignored", reason: "contact_exclu", conversationId: conversation.id };
  }

  // Save the inbound message + bump conversation metadata.
  await db.from("messages").insert({
    agent_id: agentId,
    conversation_id: conversation.id,
    direction: "inbound",
    sender: "contact",
    content: resolved.text,
    wasender_id: inbound.messageId,
  });
  await db
    .from("conversations")
    .update({
      last_message_at: new Date(inbound.timestamp).toISOString(),
      last_message_preview: resolved.text.slice(0, 160),
      unread_count: conversation.unread_count + 1,
    })
    .eq("id", conversation.id);

  // The prospect just replied — stop any pending follow-up chain (§16).
  await stopFollowUps(db, conversation.id, "responded");

  await logAudit(db, agentId, "contact", "inbound_message", conversation.id, {
    phone: contact.phone,
  });

  // Decide whether the AI should reply (this agent's own config).
  const aiShouldReply =
    ctx.agent.ai_enabled && conversation.ai_enabled && conversation.mode === "ai";

  if (!aiShouldReply) {
    return {
      status: "processed",
      conversationId: conversation.id,
      reason: "ai_disabled_or_human_mode",
    };
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
  const [knowledge, files, products] = await Promise.all([
    getActiveKnowledge(db, agentId),
    getActiveKnowledgeFiles(db, agentId),
    getActiveProducts(db, agentId),
  ]);

  const result = await generateAgentResult({
    messages: history,
    settings: ctx.agent,
    knowledge,
    files,
    products,
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
  });

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
  if (result.reply && result.status !== "spam" && !isHandoff) {
    const delivery = await deliverReply(ctx, contact.phone, result.reply, resolved.replyAsVoice);
    sent = delivery.sent;
    repliedByVoice = delivery.byVoice;
    if (!sent.ok) {
      console.error(`[engine] WhatsApp send failed for ${contact.phone}: ${sent.error}`);
    }
    await db.from("messages").insert({
      agent_id: agentId,
      conversation_id: conversation.id,
      direction: "outbound",
      sender: "ai",
      content: repliedByVoice ? `🎤 ${result.reply}` : result.reply,
      intent: result.intent,
      wasender_id: sent.id ?? null,
    });

    // Send media attachments decided by the AI (images, documents, videos…).
    // Each is sent sequentially with a short gap so WhatsApp orders them correctly.
    if (result.media?.length) {
      const creds = credsOf(ctx);
      for (const attachment of result.media.slice(0, 3)) {
        await new Promise((r) => setTimeout(r, 300));
        let mediaSent: SendResult = { ok: false, error: "unknown_type" };
        if (attachment.type === "image") {
          mediaSent = await sendWhatsAppImage(contact.phone, attachment.url, creds, attachment.caption);
        } else if (attachment.type === "document") {
          mediaSent = await sendWhatsAppDocument(contact.phone, attachment.url, creds, attachment.caption, attachment.caption);
        } else if (attachment.type === "video") {
          mediaSent = await sendWhatsAppVideo(contact.phone, attachment.url, creds, attachment.caption);
        } else if (attachment.type === "audio") {
          mediaSent = await sendWhatsAppAudio(contact.phone, attachment.url, creds);
        }
        if (mediaSent.ok) {
          await db.from("messages").insert({
            agent_id: agentId,
            conversation_id: conversation.id,
            direction: "outbound",
            sender: "ai",
            content: `[${attachment.type}] ${attachment.caption ?? attachment.url}`,
            intent: result.intent,
            wasender_id: mediaSent.id ?? null,
          });
        } else {
          console.error(`[engine] media send failed (${attachment.type}): ${mediaSent.error}`);
        }
      }
    }
  }

  // Schedule the next relance (24h) when the conversation is still in play.
  // Terminal/handoff statuses get no auto follow-up: a human takes over, or the
  // lead is converted/lost. Only schedule when we actually replied.
  if (sent.ok && !isHandoff && !isTerminalForFollowUp(result.status)) {
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

  await db
    .from("conversations")
    .update({
      status: result.status,
      score: result.score,
      intent: result.intent,
      summary: result.summary,
      next_action: result.next_action,
      last_message_at: new Date().toISOString(),
      last_message_preview: result.reply.slice(0, 160),
      // Silence the AI on handoffs and excluded (personal) contacts.
      ...(isHandoff ? { mode: "human", ai_enabled: false } : {}),
    })
    .eq("id", conversation.id);

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
}

/**
 * Normalise any inbound message kind into agent-usable text. Voice notes are
 * transcribed, images are described; other media are acknowledged with a clear
 * marker so the agent and Mohamed both know what the client sent.
 */
async function resolveInboundContent(inbound: InboundMessage, ctx: Ctx): Promise<ResolvedInbound> {
  const caption = inbound.media?.caption?.trim() || inbound.text.trim();

  switch (inbound.kind) {
    case "text":
      return { text: inbound.text.trim(), replyAsVoice: false };

    case "audio": {
      const url = await getDecryptedMediaUrl(inbound, ctx);
      const transcript = url
        ? await transcribeAudio(url, ctx.openaiKey, inbound.media?.mimetype)
        : null;
      if (transcript) return { text: `🎤 ${transcript}`, replyAsVoice: true };
      // Couldn't understand the voice note — answer in text and ask to repeat.
      return {
        text: "🎤 (message vocal reçu — transcription indisponible)",
        replyAsVoice: false,
      };
    }

    case "image": {
      const url = await getDecryptedMediaUrl(inbound, ctx);
      const description = url ? await describeImage(url, ctx.openaiKey, caption) : null;
      const parts = ["🖼️ Image reçue."];
      if (caption) parts.push(`Légende : ${caption}.`);
      if (description) parts.push(`Contenu : ${description}`);
      return { text: parts.join(" "), replyAsVoice: false };
    }

    case "video":
      return {
        text: `🎬 Vidéo reçue.${caption ? ` Légende : ${caption}` : ""}`,
        replyAsVoice: false,
      };

    case "document":
      return {
        text: `📎 Document reçu${inbound.media?.fileName ? ` : ${inbound.media.fileName}` : ""}.${
          caption ? ` ${caption}` : ""
        }`,
        replyAsVoice: false,
      };

    case "location":
      return { text: "📍 Localisation partagée par le client.", replyAsVoice: false };

    case "contact":
      return { text: "👤 Carte de contact partagée par le client.", replyAsVoice: false };

    case "sticker":
      return { text: caption || "😄 (sticker reçu)", replyAsVoice: false };

    default:
      return { text: caption || "", replyAsVoice: false };
  }
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
): Promise<{ sent: SendResult; byVoice: boolean }> {
  const creds = credsOf(ctx);
  if (asVoice) {
    const speech = await synthesizeSpeech(reply, ctx.openaiKey);
    if (speech) {
      const uploaded = await uploadMediaToWasender(speech.bytes, speech.mimetype, creds);
      if (uploaded.ok && uploaded.url) {
        const sent = await sendWhatsAppAudio(phone, uploaded.url, creds);
        if (sent.ok) return { sent, byVoice: true };
        console.error(`[engine] voice send failed, falling back to text: ${sent.error}`);
      } else {
        console.error(`[engine] voice upload failed, falling back to text: ${uploaded.error}`);
      }
    }
  }
  return { sent: await sendWhatsAppText(phone, reply, creds), byVoice: false };
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
    .limit(20);

  const rows = ((data as Pick<Message, "sender" | "content">[]) ?? []).reverse();
  return rows
    .filter((m) => m.sender !== "system")
    .map((m) => ({
      role: m.sender === "contact" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));
}

async function getActiveKnowledge(db: Db, agentId: string): Promise<KnowledgeBaseEntry[]> {
  const { data } = await db
    .from("knowledge_base")
    .select("*")
    .eq("agent_id", agentId)
    .eq("is_active", true);
  return (data as KnowledgeBaseEntry[]) ?? [];
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
  const { data } = await db
    .from("products")
    .select("*")
    .eq("agent_id", agentId)
    .eq("is_active", true);
  return (data as Product[]) ?? [];
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
