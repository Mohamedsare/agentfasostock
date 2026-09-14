import type { BadgeTone } from "@/lib/constants";
import type { LearningKind, LearningStatus } from "@/lib/types";

/** Labels shared by the dashboard and the agent prompt. */
export const LEARNING_KIND_META: Record<LearningKind, { label: string; tone: BadgeTone; hint: string }> = {
  info_entreprise: { label: "Info entreprise", tone: "info", hint: "Fait donné par l'équipe (livraison, paiement, horaires…)" },
  reponse_type: { label: "Réponse type", tone: "primary", hint: "Comment répondre à une question fréquente" },
  objection: { label: "Objection", tone: "accent", hint: "Objection client et réponse qui a marché" },
  correction: { label: "Correction", tone: "danger", hint: "Erreur de l'IA à ne plus refaire" },
  a_eviter: { label: "À éviter", tone: "warning", hint: "Comportement qui a gêné un client" },
  bonne_pratique: { label: "Bonne pratique", tone: "success", hint: "Ce qui a fait avancer la vente" },
};

export const LEARNING_KINDS = Object.keys(LEARNING_KIND_META) as LearningKind[];

export const LEARNING_STATUS_META: Record<LearningStatus, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "success" },
  pending: { label: "En attente", tone: "warning" },
  rejected: { label: "Rejetée", tone: "neutral" },
};

/** "auto" mode: a new lesson applies immediately only if an admin took part and confidence ≥ this. */
export const AUTO_ACTIVATE_CONFIDENCE = 85;

/** "auto" mode: a pending lesson also activates once seen in this many separate conversations. */
export const REINFORCE_ACTIVATE_OCCURRENCES = 3;

/** Without admin messages, a lesson is capped at this confidence (hypothesis until reinforced). */
export const NO_ADMIN_MAX_CONFIDENCE = 70;
