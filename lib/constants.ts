import type {
  Intent,
  KnowledgeCategory,
  LeadStatus,
  SupportCategory,
} from "@/lib/types";

/** Visual style buckets for status badges (mapped to Tailwind classes in the badge). */
export type BadgeTone =
  | "neutral"
  | "info"
  | "warning"
  | "success"
  | "danger"
  | "accent"
  | "primary";

interface StatusMeta {
  label: string;
  tone: BadgeTone;
  description: string;
}

export const LEAD_STATUS_META: Record<LeadStatus, StatusMeta> = {
  nouveau: { label: "Nouveau", tone: "neutral", description: "Premier contact, non qualifié." },
  prospect_froid: { label: "Froid", tone: "info", description: "Peu d'intérêt manifesté." },
  prospect_tiede: { label: "Tiède", tone: "warning", description: "Intérêt naissant." },
  prospect_chaud: { label: "Chaud", tone: "accent", description: "Fort intérêt, à appeler vite." },
  prospect_qualifie: { label: "Qualifié", tone: "success", description: "Prêt pour une démonstration." },
  client_converti: { label: "Converti", tone: "primary", description: "Client FasoStock actif." },
  support_client: { label: "Support", tone: "info", description: "Client existant à assister." },
  humain_requis: { label: "Humain requis", tone: "danger", description: "Reprise manuelle nécessaire." },
  spam: { label: "Spam", tone: "danger", description: "Message indésirable." },
  perdu: { label: "Perdu", tone: "neutral", description: "Opportunité abandonnée." },
  exclu: { label: "Exclu", tone: "neutral", description: "Contact personnel, l'agent ne répond pas." },
};

export const LEAD_STATUSES = Object.keys(LEAD_STATUS_META) as LeadStatus[];

export const INTENT_META: Record<Intent, { label: string; tone: BadgeTone }> = {
  support: { label: "Support", tone: "info" },
  prospection: { label: "Prospection", tone: "primary" },
  pricing: { label: "Tarifs", tone: "warning" },
  demo: { label: "Démonstration", tone: "accent" },
  other: { label: "Autre", tone: "neutral" },
};

export const SUPPORT_CATEGORY_META: Record<SupportCategory, string> = {
  connexion: "Problème de connexion",
  stock: "Problème de stock",
  vente: "Problème de vente",
  formation: "Demande de formation",
  prix: "Demande de prix",
  demonstration: "Demande de démonstration",
  autre: "Autre",
};

export const KNOWLEDGE_CATEGORY_META: Record<KnowledgeCategory, string> = {
  presentation: "Présentation FasoStock",
  fonctionnalites: "Fonctionnalités",
  prix: "Prix",
  demonstration: "Démonstration",
  support: "Support",
  objections: "Objections commerciales",
  faq: "FAQ",
  conditions: "Conditions",
};

/** Scoring thresholds (CLAUDE.md §9). */
export const SCORE_THRESHOLDS = {
  qualified: 70,
  hot: 85,
} as const;

/** Follow-up cadence in hours from the last inbound message (CLAUDE.md §16). */
export const FOLLOW_UP_DELAYS_HOURS = [24, 72, 168] as const;
export const MAX_FOLLOW_UPS = 3;

/** Default agent configuration used until Supabase has a row. */
export const DEFAULT_AGENT_SETTINGS = {
  agent_name: "Awa — Assistante FasoStock",
  tone: "professionnel" as const,
  language: "fr",
  welcome_message:
    "Bonjour 👋 Je suis l'assistante FasoStock. Je peux vous aider à mieux gérer votre stock et vos ventes. Quel type de commerce gérez-vous ?",
  qualified_threshold: SCORE_THRESHOLDS.qualified,
  hot_threshold: SCORE_THRESHOLDS.hot,
  operating_mode: "hybride" as const,
};
