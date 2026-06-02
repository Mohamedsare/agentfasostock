import { MessagesSquare } from "lucide-react";
import { ModulePlaceholder } from "@/components/dashboard/module-placeholder";

export const metadata = { title: "Conversations" };

export default function ConversationsPage() {
  return (
    <ModulePlaceholder
      title="Conversations WhatsApp"
      description="Toutes vos conversations, filtrables par statut et recherchables."
      icon={MessagesSquare}
      points={[
        "Liste des conversations avec statut, score et dernier message",
        "Recherche par nom ou numéro, filtres par statut",
        "Vue détail avec historique complet des messages",
        "Reprise manuelle / réactivation de l'IA",
        "Envoi de message manuel à un contact",
        "Marquer comme qualifié ou converti",
      ]}
    />
  );
}
