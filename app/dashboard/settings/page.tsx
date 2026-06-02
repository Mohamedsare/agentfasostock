import { Settings } from "lucide-react";
import { ModulePlaceholder } from "@/components/dashboard/module-placeholder";

export const metadata = { title: "Paramètres" };

export default function SettingsPage() {
  return (
    <ModulePlaceholder
      title="Paramètres"
      description="Configuration générale de l'application et des intégrations."
      icon={Settings}
      points={[
        "Profil admin et préférences",
        "Connexion WhatsApp (Wasender)",
        "Email (Resend) et destinataire des alertes",
        "Fournisseur LLM et clés d'API",
      ]}
    />
  );
}
