import { Send } from "lucide-react";
import { ModulePlaceholder } from "@/components/dashboard/module-placeholder";

export const metadata = { title: "Relances" };

export default function FollowUpsPage() {
  return (
    <ModulePlaceholder
      title="Relances automatiques"
      description="Planifiez et suivez les relances des prospects sans réponse."
      icon={Send}
      points={[
        "Relance 1 (24h), 2 (3j), 3 (7j)",
        "Maximum 3 relances par prospect",
        "Arrêt si réponse, refus ou conversion",
        "Suivi du statut de chaque relance",
      ]}
    />
  );
}
