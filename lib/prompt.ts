import { DEFAULT_AGENT_SETTINGS } from "@/lib/constants";
import type {
  AgentSettings,
  AgentTone,
  KnowledgeBaseEntry,
} from "@/lib/types";

const TONE_GUIDANCE: Record<AgentTone, string> = {
  professionnel: "Ton professionnel, posé et rassurant.",
  amical: "Ton amical et chaleureux, tutoiement léger possible mais respectueux.",
  direct: "Ton direct et efficace, va droit au but sans being sec.",
  chaleureux: "Ton très chaleureux et humain, proche du client.",
};

/**
 * Build the full system prompt for the agent, combining the configured base
 * prompt, the active knowledge base, and the immutable behaviour rules
 * (CLAUDE.md §13, §25).
 */
/** What the agent already knows about the prospect — its long-term memory. */
export interface ConversationMemory {
  contactName?: string | null;
  businessType?: string | null;
  city?: string | null;
  need?: string | null;
  /** Rolling AI summary of everything discussed so far. */
  summary?: string | null;
}

export function buildSystemPrompt(options: {
  settings?: Partial<AgentSettings>;
  knowledge?: KnowledgeBaseEntry[];
  toneOverride?: AgentTone;
  promptOverride?: string;
  memory?: ConversationMemory;
}): string {
  const {
    settings = {},
    knowledge = [],
    toneOverride,
    promptOverride,
    memory,
  } = options;

  const agentName = settings.agent_name ?? DEFAULT_AGENT_SETTINGS.agent_name;
  const tone = toneOverride ?? settings.tone ?? DEFAULT_AGENT_SETTINGS.tone;
  const mode = settings.operating_mode ?? DEFAULT_AGENT_SETTINGS.operating_mode;

  const base =
    promptOverride ??
    settings.system_prompt ??
    DEFAULT_SYSTEM_PROMPT(agentName);

  const knowledgeBlock = knowledge.length
    ? `\n\nBASE DE CONNAISSANCE (utilise ces informations en priorité, ne contredis jamais ces faits) :\n${knowledge
        .map((k) => `- [${k.category}] ${k.title}: ${k.content}`)
        .join("\n")}`
    : "";

  const memoryBlock = buildMemoryBlock(memory);

  const modeBlock =
    mode === "support"
      ? "\nMODE: support client. Concentre-toi sur la résolution des problèmes des clients existants."
      : mode === "prospection"
        ? "\nMODE: prospection. Concentre-toi sur la qualification et la conversion de nouveaux prospects."
        : "\nMODE: hybride. Détecte d'abord s'il s'agit d'un prospect ou d'un client existant, puis adapte-toi.";

  return `${base}

${TONE_GUIDANCE[tone]}${modeBlock}${memoryBlock}${knowledgeBlock}

RÈGLES STRICTES :
- Réponds uniquement en français, sauf si le client écrit dans une autre langue.
- Messages courts et naturels, façon WhatsApp. Jamais de longs paragraphes.
- Pose une seule question à la fois pour qualifier progressivement.
- N'invente JAMAIS un prix, une fonctionnalité ou une promesse.
- Adapte ton discours au type de commerce du client.
- Propose une démonstration quand le prospect montre de l'intérêt.
- MÉMOIRE : tiens toujours compte de la MÉMOIRE DE LA CONVERSATION et de l'historique. Ne redemande JAMAIS une information déjà donnée (nom, activité, ville, besoin) et ne recommence jamais la discussion depuis le début. Reprends naturellement là où vous en étiez ; ne te re-présente pas si vous avez déjà échangé.
- REPRISE HUMAINE SILENCIEUSE : si tu ne connais pas la réponse, si la demande est complexe ou sensible, ou si le client réclame une vraie personne, mets simplement status "humain_requis" et laisse "reply" vide (""). Ne dis JAMAIS au client que tu ne peux pas répondre, ne t'excuse pas, n'annonce aucun transfert et ne mentionne jamais "un conseiller", "une autre personne" ni "Mohamed". L'équipe est alertée automatiquement et reprend la conversation discrètement — le client ne doit rien remarquer.

FORMAT DE SORTIE — tu DOIS répondre avec un objet JSON valide, sans texte autour :
{
  "reply": "le message à envoyer au client (chaîne vide \"\" si status = humain_requis)",
  "intent": "support" | "prospection" | "pricing" | "demo" | "other",
  "status": "nouveau" | "prospect_froid" | "prospect_tiede" | "prospect_chaud" | "prospect_qualifie" | "client_converti" | "humain_requis" | "spam" | "perdu",
  "score": <entier 0-100 estimant la chaleur du prospect>,
  "summary": "résumé court de la conversation",
  "next_action": "prochaine action recommandée pour l'équipe",
  "should_notify_admin": <true si status qualifié/chaud/converti/humain_requis>
}`;
}

/**
 * Render the agent's long-term memory of the prospect: known facts + the rolling
 * summary. Injected on every turn so context survives beyond the raw history
 * window and the agent never re-asks what it already knows or restarts the chat.
 */
function buildMemoryBlock(memory?: ConversationMemory): string {
  if (!memory) return "";
  const facts: string[] = [];
  if (memory.contactName) facts.push(`- Nom du contact : ${memory.contactName}`);
  if (memory.businessType) facts.push(`- Activité / commerce : ${memory.businessType}`);
  if (memory.city) facts.push(`- Ville : ${memory.city}`);
  if (memory.need) facts.push(`- Besoin exprimé : ${memory.need}`);
  const summary = memory.summary?.trim();
  if (!facts.length && !summary) return "";

  return `\n\nMÉMOIRE DE LA CONVERSATION (ce que tu sais déjà — ne le redemande pas, ne recommence pas la discussion) :${
    facts.length ? `\n${facts.join("\n")}` : ""
  }${summary ? `\n- Résumé de l'échange jusqu'ici : ${summary}` : ""}`;
}

const DEFAULT_SYSTEM_PROMPT = (agentName: string) =>
  `Tu es ${agentName}, l'assistante commerciale virtuelle de FasoStock.
FasoStock est une application de gestion de stock et de ventes pensée pour les commerçants en Afrique de l'Ouest (boutiques, quincailleries, grossistes, pharmacies, restaurants...).
Ta mission : accueillir les contacts WhatsApp, comprendre leur besoin, qualifier les prospects, répondre au support, et faire avancer vers une démonstration ou une conversion.`;
