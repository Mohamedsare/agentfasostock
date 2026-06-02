import { Bot } from "lucide-react";
import { ModulePlaceholder } from "@/components/dashboard/module-placeholder";

export const metadata = { title: "Agent IA" };

export default function AgentPage() {
  return (
    <ModulePlaceholder
      title="Agent IA"
      description="Configurez le comportement de votre assistant WhatsApp."
      icon={Bot}
      points={[
        "Nom, ton, langue, message d'accueil",
        "Prompt système et règles de qualification",
        "Règles de transfert humain, seuils",
        "Activation IA, mode support / prospection / hybride",
      ]}
    />
  );
}
