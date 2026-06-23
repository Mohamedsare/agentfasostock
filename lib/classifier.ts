import "server-only";
import OpenAI from "openai";

export interface ClassificationResult {
  isProspect: boolean;
  reason: string;
}

/**
 * Prospect classifier system prompt.
 *
 * The WhatsApp agent receives messages from two sources:
 *   - Real prospects (leads from ads, referrals, or direct interest)
 *   - Personal contacts (family / friends) of the business owner
 *
 * The agent must ONLY reply to prospects.
 *
 * Decision rule: when in doubt → prospect (fail open, never miss a real lead).
 */
const SYSTEM = `Tu es un filtre de premier niveau pour un agent WhatsApp commercial.

CONTEXTE :
- Cet agent WhatsApp répond aux prospects commerciaux (personnes intéressées par un produit ou service).
- Les vrais prospects peuvent venir d'une publicité, d'un site web, d'une recommandation ou d'un intérêt direct.
- Des contacts personnels (famille, amis) écrivent parfois sur ce même numéro : l'agent doit les ignorer totalement.

TA MISSION : décider si ce message vient d'un prospect commercial potentiel ou d'un contact personnel.

RÈGLES :
- PROSPECT (isProspect: true) :
  • Toute demande d'info sur un produit, logiciel, service ou prix
  • Salutation générique d'inconnu ("Bonjour", "Bonsoir", "Allô", "Salut")
  • Mention d'une activité commerciale (boutique, stock, vente, clients…)
  • Message où on ne peut pas savoir si c'est personnel ou commercial → PROSPECT par défaut

- CONTACT PERSONNEL (isProspect: false) :
  • Invitation à manger, sortir, se retrouver ("tu viens manger ?", "on se voit ce soir ?")
  • Nouvelles de famille ou d'amis proches ("maman dit que…", "les enfants vont bien ?")
  • Message intime ou affectif évident ("je t'aime", "tu me manques", "mon chéri")
  • Question personnelle sur la localisation ou activité du propriétaire ("t'es où là ?", "tu rentres quand ?")
  • Message qui appelle le propriétaire par son prénom + contexte clairement personnel

EN CAS DE DOUTE : toujours répondre isProspect: true. Il vaut mieux répondre à un ami par erreur que rater un vrai prospect.

Réponds UNIQUEMENT avec ce JSON valide, sans aucun texte autour :
{"isProspect": true, "reason": "raison courte en français"}`;

/**
 * Classify a first-contact WhatsApp message as prospect or personal.
 *
 * Uses gpt-4o-mini (cheap, fast ~0.3s) regardless of the main model setting.
 * Fails open: if the API call errors, returns isProspect=true so real leads
 * are never silently dropped.
 */
export async function classifyProspect(
  text: string,
  openaiKey: string,
): Promise<ClassificationResult> {
  try {
    const client = new OpenAI({ apiKey: openaiKey });

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 80,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Message WhatsApp reçu :\n"${text}"` },
      ],
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    const parsed = JSON.parse(raw) as { isProspect: boolean; reason?: string };

    return {
      isProspect: Boolean(parsed.isProspect),
      reason: parsed.reason ?? "",
    };
  } catch (err) {
    // Fail open: never silently drop a message due to a classifier error.
    console.error("[classifier] error — defaulting to prospect=true:", err);
    return { isProspect: true, reason: "classifier_error_fail_open" };
  }
}
