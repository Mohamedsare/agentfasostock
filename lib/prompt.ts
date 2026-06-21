import { DEFAULT_AGENT_SETTINGS } from "@/lib/constants";
import type {
  AgentSettings,
  AgentTone,
  KnowledgeBaseEntry,
  KnowledgeFile,
  Product,
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
  files?: KnowledgeFile[];
  products?: Product[];
  toneOverride?: AgentTone;
  promptOverride?: string;
  memory?: ConversationMemory;
}): string {
  const {
    settings = {},
    knowledge = [],
    files = [],
    products = [],
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

  const activeFiles = files.filter((f) => f.is_active);
  const filesBlock = activeFiles.length
    ? `\n\nDOCUMENTS DE RÉFÉRENCE (fichiers importés — tu peux les envoyer si pertinent) :\n${activeFiles
        .map((f) => `- [${f.file_type.toUpperCase()}] "${f.name}"${f.description ? ` : ${f.description}` : ""} → URL: ${f.public_url}`)
        .join("\n")}`
    : "";

  const activeProducts = products.filter((p) => p.is_active);
  const productsBlock = activeProducts.length
    ? `\n\nCATALOGUE PRODUITS (présente avec précision, ne modifie jamais les prix) :\n${activeProducts
        .map((p) => {
          const price = p.price != null ? ` — Prix : ${p.price} ${p.currency}` : "";
          const desc = p.description ? ` | ${p.description}` : "";
          const imgs = p.images.length > 0
            ? ` | Images: ${p.images.slice(0, 3).join(", ")}`
            : "";
          return `- "${p.name}"${price}${desc}${imgs}`;
        })
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

${TONE_GUIDANCE[tone]}${modeBlock}${memoryBlock}${knowledgeBlock}${filesBlock}${productsBlock}

RÈGLES STRICTES :
- Réponds uniquement en français, sauf si le client écrit dans une autre langue.
- Messages courts et naturels, façon WhatsApp. Jamais de longs paragraphes.
- Pose une seule question à la fois pour qualifier progressivement.
- N'invente JAMAIS un prix, une fonctionnalité ou une promesse.
- Adapte ton discours au type de commerce du client.
- Propose une démonstration quand le prospect montre de l'intérêt.
- MÉMOIRE : tiens toujours compte de la MÉMOIRE DE LA CONVERSATION et de l'historique. Ne redemande JAMAIS une information déjà donnée (nom, activité, ville, besoin) et ne recommence jamais la discussion depuis le début. Reprends naturellement là où vous en étiez ; ne te re-présente pas si vous avez déjà échangé.
- REPRISE HUMAINE SILENCIEUSE : si tu ne connais pas la réponse, si la demande est complexe ou sensible, ou si le client réclame une vraie personne, mets simplement status "humain_requis" et laisse "reply" vide (""). Ne dis JAMAIS au client que tu ne peux pas répondre, ne t'excuse pas, n'annonce aucun transfert et ne mentionne jamais "un conseiller", "une autre personne" ni "Mohamed". L'équipe est alertée automatiquement et reprend la conversation discrètement — le client ne doit rien remarquer.
- CONTACT PERSONNEL (NON-PROSPECT) : si le message est clairement d'ordre personnel, familial ou privé — et n'a aucun rapport avec une activité commerciale, un produit ou un service (ex: salutations entre proches, nouvelles de la famille, discussions personnelles) — mets status "exclu" et laisse "reply" vide (""). Ne réponds pas, ne te présente pas. L'agent ne doit jamais répondre aux contacts personnels qui ne sont pas des prospects commerciaux.

ENVOI DE MÉDIAS — tu peux envoyer des images, documents, vidéos ou audios comme un vrai commercial :
- Envoie une image produit quand le prospect demande "vous avez des photos ?", "à quoi ça ressemble ?", ou montre un intérêt concret pour un produit.
- Envoie un document (PDF, catalogue) quand le prospect demande "envoyez-moi les détails", "vous avez une brochure ?", "c'est quoi votre catalogue ?".
- Envoie une vidéo si elle explique ou démontre un produit que le prospect veut voir.
- N'envoie JAMAIS un média par défaut ou sans que le contexte le justifie — exactement comme un humain ne spammerait pas avec des pièces jointes inutiles.
- Maximum 3 médias par réponse.
- Si tu n'as aucun média pertinent disponible dans le CATALOGUE ou les DOCUMENTS ci-dessus, laisse "media" absent du JSON.

FORMAT DE SORTIE — tu DOIS répondre avec un objet JSON valide, sans texte autour :
{
  "reply": "le message à envoyer au client (chaîne vide \"\" si status = humain_requis)",
  "intent": "support" | "prospection" | "pricing" | "demo" | "other",
  "status": "nouveau" | "prospect_froid" | "prospect_tiede" | "prospect_chaud" | "prospect_qualifie" | "client_converti" | "humain_requis" | "spam" | "perdu" | "exclu",
  "score": <entier 0-100 estimant la chaleur du prospect>,
  "summary": "résumé court de la conversation",
  "next_action": "prochaine action recommandée pour l'équipe",
  "should_notify_admin": <true si status qualifié/chaud/converti/humain_requis>,
  "media": [
    { "type": "image" | "document" | "audio" | "video", "url": "<URL exacte du CATALOGUE ou DOCUMENTS ci-dessus>", "caption": "texte court optionnel" }
  ]
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
