import { SCORE_THRESHOLDS } from "@/lib/constants";
import type { LeadStatus, ScoreCriterion } from "@/lib/types";

/**
 * Deterministic lead scoring (CLAUDE.md §9).
 *
 * Each criterion is detected from the contact's messages using simple French
 * keyword heuristics. The result is a 0–100 score plus the list of matched
 * criteria so the UI can explain *why* a lead scored the way it did.
 *
 * This runs as a reliable fallback and to enrich the LLM's own estimate.
 */

interface CriterionRule {
  key: string;
  label: string;
  points: number;
  test: (text: string) => boolean;
}

const has = (text: string, patterns: RegExp[]) => patterns.some((p) => p.test(text));

const RULES: CriterionRule[] = [
  {
    key: "activite",
    label: "Donne son activité",
    points: 15,
    test: (t) =>
      has(t, [
        /\b(je (vends|suis|gère|tiens)|mon (commerce|magasin|boutique|business)|ma boutique)\b/,
        /\b(boutique|magasin|quincaillerie|pharmacie|restaurant|grossiste|détaillant|commerçant)\b/,
      ]),
  },
  {
    key: "ville",
    label: "Donne sa ville",
    points: 10,
    test: (t) =>
      has(t, [
        /\b(ouaga(dougou)?|bobo(-?dioulasso)?|koudougou|banfora|ouahigouya|kaya|tenkodogo|dédougou|fada|abidjan|bamako|niamey|lomé|cotonou|dakar|abuja)\b/,
        /\b(je suis (à|a|de)|j'habite|basé(e)? à|ville de)\b/,
      ]),
  },
  {
    key: "vrai_commerce",
    label: "A un vrai commerce",
    points: 20,
    test: (t) =>
      has(t, [
        /\b(plusieurs (articles|produits|références)|mon stock|mes ventes|mes clients|chiffre d'affaires|employés|caisse)\b/,
        /\b(grossiste|demi-?gros|distributeur|plusieurs (boutiques|magasins))\b/,
      ]),
  },
  {
    key: "probleme_gestion",
    label: "Exprime un problème de gestion",
    points: 25,
    test: (t) =>
      has(t, [
        /\b(je (perds|n'arrive pas)|difficile de|problème de|gérer mon stock|suivre (mes|le)|rupture|cahier|perte|vol|je ne sais (pas|plus))\b/,
        /\b(désordre|pas organisé|je note (à la main|sur))\b/,
      ]),
  },
  {
    key: "demande_prix",
    label: "Demande le prix",
    points: 15,
    test: (t) =>
      has(t, [/\b(prix|coût|cout|combien (ça|ca|cela)|tarif|abonnement|payer|gratuit|cher)\b/]),
  },
  {
    key: "demande_demo",
    label: "Demande une démonstration",
    points: 25,
    test: (t) =>
      has(t, [/\b(démo|demo|démonstration|montrer|voir comment|essayer|tester|test gratuit|présentation)\b/]),
  },
  {
    key: "disponibilite",
    label: "Donne une date de disponibilité",
    points: 20,
    test: (t) =>
      has(t, [
        /\b(demain|aujourd'hui|ce (soir|matin|midi|week-?end)|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|\d{1,2}h|cette semaine|disponible)\b/,
      ]),
  },
  {
    key: "interesse",
    label: "Se dit intéressé",
    points: 20,
    test: (t) =>
      has(t, [/\b(intéressé|interesse|ça m'intéresse|je veux|d'accord|ok ça va|partant|allons-y|je suis chaud)\b/]),
  },
];

const NEGATIVE_RULES: CriterionRule[] = [
  {
    key: "refus",
    label: "Refuse clairement",
    points: -30,
    test: (t) =>
      has(t, [/\b(pas intéressé|ça ne m'intéresse pas|non merci|laissez(-| )moi|arrêtez|stop|je ne veux pas)\b/]),
  },
  {
    key: "non_pertinent",
    label: "Message non pertinent",
    points: -20,
    test: (t) => has(t, [/^\s*(\?+|\.+|test|coucou|hello)\s*$/i]),
  },
  {
    key: "spam",
    label: "Spam ou insulte",
    points: -50,
    test: (t) =>
      has(t, [/\b(connard|idiot|imbécile|arnaque|escroc|pute|merde|fdp|nique)\b/, /\b(bitcoin|loan|casino|porn|viagra)\b/]),
  },
];

// ─────────────────── Personal message detector ───────────────────

/**
 * Patterns that are unambiguously personal/social — eating plans, family terms,
 * personal greetings — with NO commercial intent.
 * Run BEFORE the AI to silence the agent without spending any LLM tokens.
 */
const PERSONAL_PATTERNS: RegExp[] = [
  // Food / social plans
  /\b(viens?\s+(manger|dîner|déjeuner|souper|boire))\b/,
  /\b(manger\s+(ce\s+soir|ce\s+midi|aujourd'hui|ensemble))\b/,
  /\b(on\s+mange|on\s+dîne|on\s+se\s+retrouve\s+(ce\s+soir|demain|à))\b/,
  // Direct family / intimate terms
  /\b(maman|papa|doudou|chéri(e)?|mon\s+amour|ma\s+chérie|bébé)\b/,
  // Personal social coordination
  /\b(tu\s+viens\s+(ce\s+soir|demain|quand\s*\?)|tu\s+rentres\s+(quand|ce\s+soir))\b/,
  /\b(on\s+se\s+voit\s+(ce\s+soir|demain|quand))\b/,
  // Personal calls
  /\b(rappelle-?\s*moi|tu\s+m['']appelles?|je\s+t['']appelle\s+(ce\s+soir|demain|plus\s+tard))\b/,
  // Clearly personal wellbeing (short message with no other content)
  /^\s*(comment\s+(tu\s+)?vas[\s?!]*|ça\s+va[\s?!]*|tu\s+vas\s+bien[\s?!]*)\s*$/,
  // Personal whereabouts
  /\b(tu\s+es\s+(où|là|à\s+la\s+maison)|t'es\s+(où|là))\b/,
];

/** Words that signal commercial intent — if present, never auto-exclude. */
const COMMERCIAL_SIGNALS: RegExp[] = [
  /\b(boutique|magasin|shop|stock|logiciel|application|appli|prix|tarif|abonnement|fasostock|vendre|acheter|commerce|gestion|inventaire|caisse|facture|client|produit|article)\b/,
];

/**
 * Returns true when the message is clearly personal/social and contains
 * no commercial signal. Used as a deterministic pre-filter in the engine,
 * before any AI call.
 */
export function isPersonalMessage(text: string): boolean {
  const t = text.toLowerCase();
  const hasCommercial = COMMERCIAL_SIGNALS.some((p) => p.test(t));
  if (hasCommercial) return false;
  return PERSONAL_PATTERNS.some((p) => p.test(t));
}

export interface ScoreResult {
  score: number;
  criteria: ScoreCriterion[];
  status: LeadStatus;
}

/**
 * Score a conversation from the full text of the contact's inbound messages.
 * `previousScore` lets scoring accumulate across turns (defaults to 0).
 */
export function scoreConversation(contactText: string, previousScore = 0): ScoreResult {
  const text = contactText.toLowerCase();
  const matched: ScoreCriterion[] = [];

  for (const rule of [...RULES, ...NEGATIVE_RULES]) {
    if (rule.test(text)) {
      matched.push({ key: rule.key, label: rule.label, points: rule.points });
    }
  }

  const delta = matched.reduce((sum, c) => sum + c.points, 0);
  const raw = Math.max(previousScore, delta); // take the strongest signal so far
  const score = clamp(raw);

  return { score, criteria: matched, status: statusForScore(score, matched) };
}

/** Clamp a score into the 0–100 range. */
export function clamp(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Derive a lead status from a score (and any hard-negative signals). */
export function statusForScore(score: number, criteria: ScoreCriterion[] = []): LeadStatus {
  if (criteria.some((c) => c.key === "spam")) return "spam";
  if (criteria.some((c) => c.key === "refus")) return "perdu";
  if (score >= SCORE_THRESHOLDS.hot) return "prospect_chaud";
  if (score >= SCORE_THRESHOLDS.qualified) return "prospect_qualifie";
  if (score >= 45) return "prospect_tiede";
  if (score >= 20) return "prospect_froid";
  return "nouveau";
}

/** Whether a status should trigger an admin notification (CLAUDE.md §17). */
export function shouldNotifyAdmin(status: LeadStatus): boolean {
  return (
    status === "prospect_qualifie" ||
    status === "prospect_chaud" ||
    status === "client_converti" ||
    status === "humain_requis"
  );
}
