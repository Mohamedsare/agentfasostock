import { Flame } from "lucide-react";
import { ModulePlaceholder } from "@/components/dashboard/module-placeholder";

export const metadata = { title: "Clients qualifiés" };

export default function QualifiedLeadsPage() {
  return (
    <ModulePlaceholder
      title="Clients qualifiés"
      description="Vos prospects qualifiés et chauds, prêts à convertir."
      icon={Flame}
      points={[
        "Liste filtrée : qualifiés et chauds uniquement",
        "Voir la conversation, envoyer un message WhatsApp",
        "Marquer comme converti ou perdu",
        "Ajouter une note, planifier une relance",
      ]}
    />
  );
}
