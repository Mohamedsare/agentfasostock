import type {
  Contact,
  Conversation,
  ConversationWithContact,
  FollowUp,
  KnowledgeBaseEntry,
  Message,
  Note,
} from "@/lib/types";

/**
 * Clean, realistic mock data used while Supabase is empty / not configured
 * (CLAUDE.md §30). The shape matches the DB schema so the UI is identical
 * whether data comes from here or from Supabase.
 */

const now = Date.now();
const ago = (mins: number) => new Date(now - mins * 60_000).toISOString();

export const mockContacts: Contact[] = ([
  { id: "c1", phone: "22670112233", name: "Awa Ouédraogo", business_type: "Boutique de cosmétiques", city: "Ouagadougou", need: "Suivre son stock et éviter les ruptures", source: "whatsapp", created_at: ago(2880), updated_at: ago(12) },
  { id: "c2", phone: "22675445566", name: "Issouf Traoré", business_type: "Quincaillerie", city: "Bobo-Dioulasso", need: "Gérer plusieurs références et fournisseurs", source: "whatsapp", created_at: ago(4320), updated_at: ago(35) },
  { id: "c3", phone: "22678990011", name: "Fatim Sawadogo", business_type: "Grossiste alimentaire", city: "Ouagadougou", need: "Démonstration avant achat", source: "whatsapp", created_at: ago(1440), updated_at: ago(90) },
  { id: "c4", phone: "22676223344", name: "Karim Zongo", business_type: "Pharmacie", city: "Koudougou", need: "Connaître les tarifs", source: "whatsapp", created_at: ago(600), updated_at: ago(180) },
  { id: "c5", phone: "22670778899", name: null, business_type: null, city: null, need: null, source: "whatsapp", created_at: ago(50), updated_at: ago(50) },
  { id: "c6", phone: "22677665544", name: "Salif Kaboré", business_type: "Restaurant", city: "Banfora", need: "Problème de connexion à l'app", source: "whatsapp", created_at: ago(10080), updated_at: ago(240) },
  { id: "c7", phone: "22675009988", name: "Mariam Compaoré", business_type: "Boutique de vêtements", city: "Ouagadougou", need: "A converti — accompagnement", source: "whatsapp", created_at: ago(20160), updated_at: ago(720) },
  { id: "c8", phone: "22678112200", name: "Yacouba Diallo", business_type: "Vente de pièces auto", city: "Ouagadougou", need: "Hésite encore", source: "whatsapp", created_at: ago(3000), updated_at: ago(2000) },
] as Omit<Contact, "lid">[]).map((c) => ({ ...c, lid: null }));

export const mockConversations: ConversationWithContact[] = [
  conv("conv1", "c1", "prospect_chaud", 88, "ai", "demo", "Awa gère une boutique de cosmétiques à Ouaga, perd des ventes par rupture de stock. Très intéressée, demande une démo.", "Planifier une démonstration cette semaine.", ago(12), "Super, je suis dispo jeudi après-midi 👍", 0, true),
  conv("conv2", "c2", "prospect_qualifie", 74, "ai", "pricing", "Issouf tient une quincaillerie à Bobo, beaucoup de références. Demande le prix et veut comparer.", "Envoyer la grille tarifaire et proposer une démo.", ago(35), "D'accord, et ça coûte combien par mois ?", 1, true),
  conv("conv3", "c3", "prospect_qualifie", 71, "human", "demo", "Fatim, grossiste alimentaire, veut voir l'app avant de décider.", "Mohamed a repris la main pour caler la démo.", ago(90), "Je préfère parler à un responsable.", 0, false),
  conv("conv4", "c4", "prospect_tiede", 50, "ai", "pricing", "Karim, pharmacie à Koudougou, curieux mais prudent sur le prix.", "Continuer la qualification, rassurer sur le prix.", ago(180), "Hmm je vais réfléchir.", 0, true),
  conv("conv5", "c5", "nouveau", 5, "ai", "other", "Nouveau contact, message vague.", "Qualifier : demander activité et ville.", ago(50), "Bonjour", 1, true),
  conv("conv6", "c6", "support_client", 60, "human", "support", "Salif, client restaurant, n'arrive pas à se connecter à l'app.", "Vérifier le compte, guider la réinitialisation.", ago(240), "Je n'arrive toujours pas à me connecter.", 2, false),
  conv("conv7", "c7", "client_converti", 100, "ai", "support", "Mariam est cliente convertie, boutique de vêtements à Ouaga.", "Suivi de satisfaction.", ago(720), "Merci, tout marche bien maintenant !", 0, true),
  conv("conv8", "c8", "prospect_froid", 28, "ai", "prospection", "Yacouba, pièces auto, peu réactif.", "Relance douce dans quelques jours.", ago(2000), "Ok je note.", 0, true),
];

function conv(
  id: string,
  contactId: string,
  status: Conversation["status"],
  score: number,
  mode: Conversation["mode"],
  intent: Conversation["intent"],
  summary: string,
  nextAction: string,
  lastAt: string,
  preview: string,
  unread: number,
  aiEnabled: boolean,
): ConversationWithContact {
  const contact = mockContacts.find((c) => c.id === contactId)!;
  return {
    id,
    contact_id: contactId,
    status,
    score,
    mode,
    intent,
    summary,
    next_action: nextAction,
    support_category: status === "support_client" ? "connexion" : null,
    last_message_at: lastAt,
    last_message_preview: preview,
    unread_count: unread,
    ai_enabled: aiEnabled,
    created_at: contact.created_at,
    updated_at: lastAt,
    contact,
  };
}

export const mockMessages: Record<string, Message[]> = {
  conv1: [
    msg("conv1", "inbound", "contact", "Bonjour, je vends des cosmétiques à Ouaga", ago(60)),
    msg("conv1", "outbound", "ai", "Bonjour Awa 👋 Ravie d'échanger ! Combien de produits gérez-vous environ ?", ago(58)),
    msg("conv1", "inbound", "contact", "Beaucoup, plus de 200 références. Je perds souvent des ventes car je suis en rupture sans le savoir", ago(50)),
    msg("conv1", "outbound", "ai", "C'est exactement ce que FasoStock résout : alertes de stock et suivi des ventes en temps réel. Souhaitez-vous voir une démonstration ?", ago(48)),
    msg("conv1", "inbound", "contact", "Oui ça m'intéresse beaucoup", ago(20)),
    msg("conv1", "outbound", "ai", "Parfait ! Quel jour seriez-vous disponible cette semaine ?", ago(18)),
    msg("conv1", "inbound", "contact", "Super, je suis dispo jeudi après-midi 👍", ago(12)),
  ],
  conv6: [
    msg("conv6", "inbound", "contact", "Bonjour, je suis client mais je n'arrive plus à me connecter", ago(300)),
    msg("conv6", "outbound", "ai", "Bonjour Salif, désolée pour la gêne. Quel message d'erreur voyez-vous ?", ago(298)),
    msg("conv6", "inbound", "contact", "Ça dit mot de passe incorrect", ago(260)),
    msg("conv6", "outbound", "admin", "Bonjour Salif, c'est Mohamed. Je réinitialise votre accès, un instant.", ago(250)),
    msg("conv6", "inbound", "contact", "Je n'arrive toujours pas à me connecter.", ago(240)),
  ],
};

function msg(
  conversationId: string,
  direction: Message["direction"],
  sender: Message["sender"],
  content: string,
  at: string,
): Message {
  return {
    id: `${conversationId}-${at}`,
    conversation_id: conversationId,
    direction,
    sender,
    content,
    intent: null,
    score_delta: null,
    wasender_id: null,
    created_at: at,
  };
}

export const mockKnowledge: KnowledgeBaseEntry[] = [
  { id: "k1", title: "Qu'est-ce que FasoStock ?", content: "FasoStock est une application simple de gestion de stock et de ventes pour les commerçants en Afrique de l'Ouest.", category: "presentation", is_active: true, created_at: ago(43200), updated_at: ago(43200) },
  { id: "k2", title: "Fonctionnalités principales", content: "Suivi du stock en temps réel, alertes de rupture, enregistrement des ventes, rapports, multi-boutiques.", category: "fonctionnalites", is_active: true, created_at: ago(43200), updated_at: ago(43200) },
  { id: "k3", title: "Démonstration gratuite", content: "Une démonstration personnalisée de 20 minutes est offerte. Elle se fait par appel WhatsApp.", category: "demonstration", is_active: true, created_at: ago(43200), updated_at: ago(43200) },
  { id: "k4", title: "Objection : c'est trop cher", content: "Rappeler que FasoStock évite les pertes liées aux ruptures et au vol, et se rembourse rapidement.", category: "objections", is_active: true, created_at: ago(43200), updated_at: ago(43200) },
  { id: "k5", title: "Support et formation", content: "Une formation de prise en main est incluse. Le support est disponible par WhatsApp.", category: "support", is_active: false, created_at: ago(43200), updated_at: ago(43200) },
];

export const mockFollowUps: FollowUp[] = [
  { id: "f1", conversation_id: "conv4", contact_id: "c4", step: 1, scheduled_at: ago(-720), status: "scheduled", message: "Bonjour Karim, avez-vous pu réfléchir à FasoStock ? Je reste disponible 🙂", sent_at: null, created_at: ago(180) },
  { id: "f2", conversation_id: "conv8", contact_id: "c8", step: 2, scheduled_at: ago(-2880), status: "scheduled", message: "Bonjour Yacouba, je vous propose une courte démo, ça vous dit ?", sent_at: null, created_at: ago(2000) },
  { id: "f3", conversation_id: "conv2", contact_id: "c2", step: 1, scheduled_at: ago(1200), status: "responded", message: null, sent_at: ago(1200), created_at: ago(1300) },
];

export const mockNotes: Note[] = [
  { id: "n1", conversation_id: "conv1", contact_id: "c1", author_id: null, content: "Très bon potentiel, rappeler jeudi 15h.", created_at: ago(15) },
  { id: "n2", conversation_id: "conv3", contact_id: "c3", author_id: null, content: "Préfère un contact humain, ne pas réactiver l'IA tout de suite.", created_at: ago(85) },
];
