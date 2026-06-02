import { FlaskConical } from "lucide-react";
import { ModulePlaceholder } from "@/components/dashboard/module-placeholder";

export const metadata = { title: "Labs IA" };

export default function LabsPage() {
  return (
    <ModulePlaceholder
      title="Labs IA"
      description="Testez et améliorez votre agent en toute sécurité."
      icon={FlaskConical}
      points={[
        "Simuler une conversation WhatsApp",
        "Tester un prompt, un ton, une objection",
        "Voir le score, le statut prédit et l'email généré",
        "Comparer plusieurs réponses, sauvegarder un prompt performant",
      ]}
    />
  );
}
