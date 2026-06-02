import { BarChart3 } from "lucide-react";
import { ModulePlaceholder } from "@/components/dashboard/module-placeholder";

export const metadata = { title: "Statistiques" };

export default function StatsPage() {
  return (
    <ModulePlaceholder
      title="Statistiques"
      description="Analysez la performance de votre agent et de votre prospection."
      icon={BarChart3}
      points={[
        "Évolution des conversations dans le temps",
        "Taux de conversion et de qualification",
        "Performance de l'IA vs reprises humaines",
        "Répartition par statut, ville et activité",
      ]}
    />
  );
}
