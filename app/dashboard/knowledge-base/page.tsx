import { BookOpen } from "lucide-react";
import { ModulePlaceholder } from "@/components/dashboard/module-placeholder";

export const metadata = { title: "Base de connaissance" };

export default function KnowledgeBasePage() {
  return (
    <ModulePlaceholder
      title="Base de connaissance"
      description="Les informations que l'IA utilise pour répondre."
      icon={BookOpen}
      points={[
        "Ajouter, modifier, supprimer une information",
        "Activer / désactiver une entrée",
        "Classement par catégorie",
        "Utilisée par l'agent avant chaque réponse",
      ]}
    />
  );
}
