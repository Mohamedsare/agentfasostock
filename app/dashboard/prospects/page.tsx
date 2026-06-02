import { Users } from "lucide-react";
import { ModulePlaceholder } from "@/components/dashboard/module-placeholder";

export const metadata = { title: "Prospects" };

export default function ProspectsPage() {
  return (
    <ModulePlaceholder
      title="Prospects"
      description="Tous vos prospects avec activité, ville, besoin, score et prochaine action."
      icon={Users}
      points={[
        "Tableau : nom, téléphone, activité, ville, besoin",
        "Score, statut, source, dernière interaction",
        "Prochaine action recommandée",
        "Filtres par statut et recherche",
      ]}
    />
  );
}
