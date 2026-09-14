import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAgentContextById } from "@/lib/agents";
import { serverEnv } from "@/lib/env";
import { normalizeText, tokenize } from "@/lib/catalog";
import {
  AUTO_ACTIVATE_CONFIDENCE,
  LEARNING_KINDS,
  NO_ADMIN_MAX_CONFIDENCE,
  REINFORCE_ACTIVATE_OCCURRENCES,
} from "@/lib/learning-meta";
import type { AgentLearning, LearningKind, LearningMode } from "@/lib/types";

/**
 * Self-learning engine.
 *
 * The agent re-reads its settled conversations and extracts reusable lessons:
 * how the team (ADMIN) answers and the business facts it gives, questions the
 * AI failed on or got corrected about, objections handled well. Lessons are
 * stored in `agent_learnings`, deduplicated and reinforced when seen again, and
 * the active ones are injected into the prompt (lib/prompt.ts).
 *
 * No fine-tuning: lessons are explicit, reviewable and reversible. Guardrails:
 * never learn catalog prices/stock (the catalog is the source of truth), never
 * keep personal data, "info_entreprise" only when an admin said it.
 */

type Db = ReturnType<typeof createAdminClient>;

/** A conversation must have been quiet this long before it is analysed. */
const DEFAULT_IDLE_MINUTES = 30;
const MIN_MESSAGES = 4;
const MAX_CONVERSATIONS_PER_AGENT = 20;
const MAX_TRANSCRIPT_MESSAGES = 60;
/** Title+content token overlap above which two lessons are the same lesson. */
const DUPLICATE_SIMILARITY = 0.45;

const SYSTEM = `Tu analyses une conversation WhatsApp entre un CLIENT et l'ASSISTANT IA d'une entreprise (parfois un humain de l'équipe intervient : ADMIN). Ton rôle : en tirer des LEÇONS réutilisables pour que l'assistant réponde mieux aux PROCHAINS clients.

Sources de leçons, par ordre de valeur :
1. Les réponses de l'ADMIN (humain) : c'est la référence. Capte les informations d'entreprise qu'il donne (livraison, paiement, horaires, adresse, garantie, délais, conditions) et sa façon de répondre.
2. Les échecs de l'IA : question du client restée sans réponse, réponse corrigée par le client ou l'admin, client agacé, reprise par un humain.
3. Les réussites : objection bien traitée, conversation qui avance vers l'achat.

Types ("kind") :
- "info_entreprise" : fait sur l'entreprise donné par l'ADMIN (ex. "Livraison à Ouagadougou sous 24h").
- "reponse_type" : comment répondre à une question fréquente.
- "objection" : objection du client + réponse qui a fonctionné.
- "correction" : erreur de l'IA à ne plus refaire, avec la bonne façon de faire.
- "a_eviter" : comportement de l'IA qui a gêné le client.
- "bonne_pratique" : façon de faire qui a fait avancer la vente.

RÈGLES STRICTES :
- JAMAIS de prix, de stock ou de disponibilité d'un produit du catalogue : le catalogue est la seule source à jour.
- JAMAIS de donnée personnelle (nom, numéro, adresse d'un client).
- Une leçon = une consigne CONCRÈTE et SPÉCIFIQUE à cette entreprise, applicable à d'autres clients ("Quand un client demande la duplication de clés, …").
- INTERDIT : les conseils génériques de service client que tout assistant connaît déjà (être clair, poser des questions de précision, être à l'écoute, remercier, être réactif, encourager le client à poser des questions…). Si la leçon pourrait s'appliquer à n'importe quelle entreprise, ne la propose pas.
- Ne tire JAMAIS une règle ou un fait d'une phrase de l'ASSISTANT IA : il peut se tromper ou inventer. Seuls font foi les messages ADMIN, les réactions explicites du CLIENT (satisfait, agacé, corrige) et l'issue de la conversation.
- JAMAIS de leçon qui pousse l'assistant à promettre de "vérifier", de "revenir plus tard" ou de "tenir informé" : l'assistant doit répondre avec les données disponibles.
- Les messages marqués [RÉPONSE DE SECOURS — PANNE TECHNIQUE] ne sont pas des choix de l'assistant : n'en tire aucune leçon.
- N'invente rien : chaque leçon doit être prouvée par la conversation. "evidence" = court extrait anonymisé.
- "info_entreprise" UNIQUEMENT si l'information vient d'un message ADMIN (jamais d'une supposition de l'IA ou d'une affirmation du client).
- Ne repropose pas une leçon déjà connue ni une leçon rejetée (liste fournie).
- 3 leçons maximum. Si rien de nouveau, de spécifique et d'utile : liste vide. La plupart des conversations ne produisent AUCUNE leçon — c'est normal.
- "confidence" (0-100), sois sévère : 90+ = confirmé explicitement par l'ADMIN ; 75-89 = démontré par une réaction claire du client ; 50-74 = probable ; moins de 50 = ne la propose pas.

Réponds UNIQUEMENT avec ce JSON :
{"learnings":[{"kind":"reponse_type","title":"titre court","content":"consigne claire pour l'assistant, 1 à 3 phrases","evidence":"extrait anonymisé","confidence":80}]}`;

const learningItemSchema = z.object({
  kind: z.enum(LEARNING_KINDS as [LearningKind, ...LearningKind[]]).catch("bonne_pratique"),
  title: z.string().trim().min(3).max(140),
  content: z.string().trim().min(10).max(700),
  evidence: z.string().trim().max(400).nullish().catch(null),
  confidence: z.number().catch(50).transform((n) => Math.max(0, Math.min(100, Math.round(n)))),
});
type ExtractedLearning = z.infer<typeof learningItemSchema>;

const PRICE = /\d[\d\s.,]*\s*(?:f\s?cfa|xof|francs?\b)/i;
const PHONE = /\+?\d(?:[\s.-]?\d){7,}/g;
/** Generic customer-service advice every assistant already follows — no value as a lesson. */
const GENERIC_ADVICE =
  /(poser des questions|demander des pr[ée]cisions|être (clair|à l'écoute|réactif|poli)|à l'écoute|remercier|rester (poli|courtois|professionnel)|encourage[rz]? (le client )?à poser|montrer (votre|sa) disponibilit|réponses? (vagues?|claires?|non informatives?))/i;
/** Lessons teaching the assistant to stall instead of answering. */
const STALLING = /(vérifier (le|les|l')|revenir vers|tenir (le client )?informé|je (vous )?reviens|faire vérifier)/i;
/** Canned replies from lib/ai.ts fallbackResult — technical failures, not the agent's choices. */
const FALLBACK_REPLIES = [
  "Je vérifie ça pour vous et je reviens dans un instant",
  "Bien reçu ! Je transmets votre demande à l'équipe",
  "Merci pour votre message 🙏 Comment puis-je vous aider ?",
];

export interface LearningRunResult {
  agents: number;
  analyzed: number;
  created: number;
  reinforced: number;
  skipped: number;
  errors: number;
}

interface ConversationRow {
  id: string;
  status: string;
  summary: string | null;
  last_message_at: string;
  learned_at: string | null;
}

interface MessageRow {
  sender: "contact" | "ai" | "admin";
  content: string;
}

const SPEAKER: Record<MessageRow["sender"], string> = { contact: "CLIENT", ai: "ASSISTANT IA", admin: "ADMIN" };

function buildTranscript(conversation: ConversationRow, messages: MessageRow[]): string {
  const lines = messages.map((m) => {
    const media = /^\[(image|video|document|audio)\] \S+(?:\n([\s\S]*))?$/.exec(m.content.trim());
    const isFallback = m.sender === "ai" && FALLBACK_REPLIES.some((f) => m.content.startsWith(f));
    const text = media
      ? `[${media[1]} envoyé${media[2] ? ` : ${media[2].trim()}` : ""}]`
      : isFallback
        ? "[RÉPONSE DE SECOURS — PANNE TECHNIQUE]"
        : m.content;
    return `${SPEAKER[m.sender] ?? m.sender}: ${text.replace(/\s+/g, " ").slice(0, 700)}`;
  });
  return `Statut final de la conversation : ${conversation.status}${
    conversation.summary ? `\nRésumé : ${conversation.summary}` : ""
  }\n\n${lines.join("\n")}`;
}

function similarity(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function findDuplicate(existing: AgentLearning[], l: ExtractedLearning): AgentLearning | undefined {
  const title = normalizeText(l.title);
  return existing.find(
    (e) =>
      normalizeText(e.title) === title ||
      (e.kind === l.kind && similarity(`${e.title} ${e.content}`, `${l.title} ${l.content}`) >= DUPLICATE_SIMILARITY),
  );
}

/** Apply guardrails; returns null when the lesson must not be kept. */
function sanitize(l: ExtractedLearning, hasAdminMessages: boolean): ExtractedLearning | null {
  const text = `${l.title} ${l.content}`;
  if (l.kind === "info_entreprise" && !hasAdminMessages) return null;
  // Catalog prices change and live in the catalog — never freeze one in a lesson.
  if (l.kind !== "info_entreprise" && PRICE.test(text)) return null;
  if (l.confidence < 50) return null;
  if (GENERIC_ADVICE.test(text)) return null;

  // "À éviter" / "Correction" lessons describe the assistant's mistakes: its own
  // words are legitimate evidence there, and "don't promise to check" is welcome.
  const isMistakeLesson = l.kind === "a_eviter" || l.kind === "correction";
  if (!isMistakeLesson) {
    if (STALLING.test(text)) return null;
    const evidence = l.evidence ?? "";
    if (/RÉPONSE DE SECOURS/i.test(evidence)) return null;
    // A positive rule resting only on what the assistant said proves nothing (it may have invented it).
    if (/ASSISTANT IA\s*:/i.test(evidence) && !/(CLIENT|ADMIN)\s*:/.test(evidence)) return null;
  }
  return {
    ...l,
    // Without a human in the conversation, a lesson is only a hypothesis until
    // other conversations confirm it (see REINFORCE_ACTIVATE_OCCURRENCES).
    confidence: hasAdminMessages ? l.confidence : Math.min(l.confidence, NO_ADMIN_MAX_CONFIDENCE),
    title: l.title.replace(PHONE, "[numéro]"),
    content: l.content.replace(PHONE, "[numéro]"),
    evidence: l.evidence?.replace(PHONE, "[numéro]") ?? null,
  };
}

async function extractLearnings(
  apiKey: string,
  transcript: string,
  existing: AgentLearning[],
): Promise<ExtractedLearning[]> {
  const client = new OpenAI({ apiKey, baseURL: serverEnv.openaiBaseUrl });
  const known =
    existing
      .slice(0, 80)
      .map((e) => `- [${e.kind}] ${e.title}${e.status === "rejected" ? " (REJETÉE par l'équipe — ne pas reproposer)" : ""}`)
      .join("\n") || "(aucune)";

  const completion = await client.chat.completions.create({
    model: serverEnv.openaiModel,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `LEÇONS DÉJÀ CONNUES :\n${known}\n\nCONVERSATION À ANALYSER :\n${transcript}` },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { learnings?: unknown };
  const items = Array.isArray(parsed.learnings) ? parsed.learnings : [];
  return items
    .map((item) => learningItemSchema.safeParse(item))
    .flatMap((r) => (r.success ? [r.data] : []))
    .slice(0, 3);
}

async function loadLearnings(db: Db, agentId: string): Promise<AgentLearning[]> {
  const { data } = await db
    .from("agent_learnings")
    .select("*")
    .eq("agent_id", agentId)
    .order("confidence", { ascending: false })
    .limit(300);
  return (data as AgentLearning[]) ?? [];
}

/**
 * Analyse settled conversations and record lessons.
 *
 * @param opts.agentId      Restrict to one agent (dashboard trigger). Omit for all (cron).
 * @param opts.idleMinutes  How long a conversation must have been quiet (manual runs use less).
 */
export async function runLearning(
  opts: { agentId?: string; idleMinutes?: number } = {},
): Promise<LearningRunResult> {
  const db = createAdminClient();
  const result: LearningRunResult = { agents: 0, analyzed: 0, created: 0, reinforced: 0, skipped: 0, errors: 0 };

  let agentsQuery = db.from("agents").select("id, learning_mode");
  if (opts.agentId) agentsQuery = agentsQuery.eq("id", opts.agentId);
  const { data: agents } = await agentsQuery;

  for (const agent of (agents as { id: string; learning_mode: LearningMode | null }[]) ?? []) {
    const mode: LearningMode = agent.learning_mode ?? "auto";
    if (mode === "off") continue;
    const ctx = await resolveAgentContextById(agent.id);
    if (!ctx?.openaiKey) continue;
    result.agents++;

    const idleBefore = new Date(Date.now() - (opts.idleMinutes ?? DEFAULT_IDLE_MINUTES) * 60_000).toISOString();
    const { data: conversations } = await db
      .from("conversations")
      .select("id, status, summary, last_message_at, learned_at")
      .eq("agent_id", agent.id)
      .lte("last_message_at", idleBefore)
      .not("status", "in", "(spam,exclu)")
      .order("last_message_at", { ascending: false })
      .limit(300);
    const due = ((conversations as ConversationRow[]) ?? [])
      .filter((c) => !c.learned_at || new Date(c.learned_at) < new Date(c.last_message_at))
      .slice(0, MAX_CONVERSATIONS_PER_AGENT);
    if (due.length === 0) continue;

    const existing = await loadLearnings(db, agent.id);
    const before = { created: result.created, reinforced: result.reinforced, analyzed: result.analyzed };

    for (const conversation of due) {
      const markLearned = () =>
        db.from("conversations").update({ learned_at: new Date().toISOString() }).eq("id", conversation.id);
      try {
        const { data: rows } = await db
          .from("messages")
          .select("sender, content")
          .eq("conversation_id", conversation.id)
          .order("created_at", { ascending: false })
          .limit(MAX_TRANSCRIPT_MESSAGES);
        const messages = ((rows as MessageRow[]) ?? []).reverse();

        // Nothing to learn from a monologue or a two-line exchange.
        if (
          messages.length < MIN_MESSAGES ||
          !messages.some((m) => m.sender === "contact") ||
          !messages.some((m) => m.sender !== "contact")
        ) {
          await markLearned();
          result.skipped++;
          continue;
        }

        const hasAdmin = messages.some((m) => m.sender === "admin");
        const extracted = await extractLearnings(ctx.openaiKey, buildTranscript(conversation, messages), existing);
        const now = new Date().toISOString();

        for (const candidate of extracted) {
          const lesson = sanitize(candidate, hasAdmin);
          if (!lesson) continue;

          const duplicate = findDuplicate(existing, lesson);
          if (duplicate) {
            if (duplicate.status === "rejected") continue; // the team said no — don't insist
            if (duplicate.source_conversation_ids.includes(conversation.id)) continue;
            const occurrences = duplicate.occurrences + 1;
            const confidence = Math.min(100, Math.max(duplicate.confidence, lesson.confidence) + 5);
            // Confirmed by an admin, or observed in enough separate conversations:
            // a pending lesson becomes trustworthy (auto mode only).
            const status =
              duplicate.status === "pending" &&
              mode === "auto" &&
              ((hasAdmin && confidence >= AUTO_ACTIVATE_CONFIDENCE) || occurrences >= REINFORCE_ACTIVATE_OCCURRENCES)
                ? "active"
                : duplicate.status;
            const source_conversation_ids = [...duplicate.source_conversation_ids, conversation.id].slice(-20);
            await db
              .from("agent_learnings")
              .update({ occurrences, confidence, status, source_conversation_ids, last_seen_at: now })
              .eq("id", duplicate.id);
            Object.assign(duplicate, { occurrences, confidence, status, source_conversation_ids, last_seen_at: now });
            result.reinforced++;
          } else {
            const { data: inserted } = await db
              .from("agent_learnings")
              .insert({
                agent_id: agent.id,
                kind: lesson.kind,
                title: lesson.title,
                content: lesson.content,
                evidence: lesson.evidence,
                confidence: lesson.confidence,
                // New lessons apply immediately only when backed by an admin's own words.
                status:
                  mode === "auto" && hasAdmin && lesson.confidence >= AUTO_ACTIVATE_CONFIDENCE ? "active" : "pending",
                source_conversation_ids: [conversation.id],
              })
              .select("*")
              .single();
            if (inserted) existing.push(inserted as AgentLearning);
            result.created++;
          }
        }

        await markLearned();
        result.analyzed++;
      } catch (err) {
        console.error(`[learning] conversation ${conversation.id} failed:`, err);
        result.errors++;
      }
    }

    await db.from("audit_logs").insert({
      agent_id: agent.id,
      actor: "ai",
      action: "learning_run",
      entity: "agent",
      entity_id: agent.id,
      metadata: {
        analyzed: result.analyzed - before.analyzed,
        created: result.created - before.created,
        reinforced: result.reinforced - before.reinforced,
      },
    });
  }

  return result;
}
