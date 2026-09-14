import { isPersonalMessage } from "@/lib/scoring";
import type { Conversation, LeadStatus } from "@/lib/types";

/**
 * When may the agent go silent with a client?
 *
 * Production audit (14 days): 82% of unanswered client messages came from the
 * model setting "humain_requis" on ordinary requests ("Prix", "vous dupliquez
 * les clés ?", a photo it couldn't identify) — the AI was then switched off for
 * that client forever and nobody took over. The model also set "exclu" in the
 * middle of real sales conversations (a badly transcribed voice note looked
 * off-topic). These rules make silence the exception it was meant to be.
 */

/** The client explicitly asks for a person, a call back, or complains. */
export const HUMAN_REQUEST =
  /((parler|discuter|joindre|avoir|voir)\b.{0,25}\b(humain|quelqu'?un|une personne|responsable|patron|g[ée]rant|vendeur|commercial|conseiller|propri[ée]taire|directeur))|\b(appel(le|ez)|rappel(le|ez))[- ]?(moi|nous)\b|\bnum[ée]ro\b.{0,20}\b(responsable|patron|g[ée]rant|boutique)\b|r[ée]clamation|rembours|arnaque|escroc|plainte|inadmissible|pas (du tout )?content/i;

type ChatTurn = { role: "user" | "assistant"; content: string };

/**
 * A silent handoff is accepted only when:
 * - humain_requis: one of the client's last two messages asks for a human or complains;
 * - exclu: no commercial exchange yet (first contact) or the message is clearly personal.
 */
export function handoffJustified(status: LeadStatus, history: ChatTurn[]): boolean {
  const recentClient = history
    .filter((m) => m.role === "user")
    .slice(-2)
    .map((m) => m.content)
    .join(" ");
  if (status === "humain_requis") return HUMAN_REQUEST.test(recentClient);
  if (status === "exclu") {
    const agentReplies = history.filter((m) => m.role === "assistant").length;
    return agentReplies === 0 || isPersonalMessage(recentClient);
  }
  return true;
}

/** Appended to the system prompt when an unjustified handoff is regenerated. */
export const NO_HANDOFF_INSTRUCTION = `CONSIGNE PRIORITAIRE POUR CE MESSAGE : ne mets PAS status "humain_requis" ni "exclu". Le client n'a pas demandé à parler à un humain et c'est une conversation commerciale. Réponds-lui toi-même avec les informations disponibles (utilise search_products pour un produit). Si tu n'as pas l'information (service, prix, disponibilité), dis-le simplement sans rien inventer, puis pose UNE question utile ou propose une alternative. "reply" ne doit jamais être vide.`;

/** Last resort when even the regenerated reply is empty. */
export const NEUTRAL_FOLLOW_UP_REPLY = "Bien noté 👍 Pouvez-vous me donner un peu plus de détails pour que je vous aide au mieux ?";

/** An AI handoff nobody answered within this delay is taken back by the AI. */
export const AUTO_RESUME_AFTER_MS = 15 * 60_000;

/** Several client messages within this window get one reply (to the whole burst). */
export const BURST_WINDOW_MS = 3_500;

/**
 * Resume the AI on the client's next message when the AI itself handed the
 * conversation off and no human has taken it over since (a human takeover sets
 * silenced_by = "admin" and is never overridden).
 */
export function canAutoResume(
  conversation: Pick<Conversation, "status" | "silenced_by" | "silenced_at">,
  now = Date.now(),
): boolean {
  if (conversation.silenced_by !== "ai" || conversation.status !== "humain_requis") return false;
  const since = conversation.silenced_at ? Date.parse(conversation.silenced_at) : NaN;
  return Number.isFinite(since) && now - since >= AUTO_RESUME_AFTER_MS;
}
