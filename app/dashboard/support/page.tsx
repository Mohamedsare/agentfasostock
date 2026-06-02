import { LifeBuoy } from "lucide-react";
import { ModulePlaceholder } from "@/components/dashboard/module-placeholder";

export const metadata = { title: "Support client" };

export default function SupportPage() {
  return (
    <ModulePlaceholder
      title="Support client"
      description="Gérez les demandes des clients existants et les cas urgents."
      icon={LifeBuoy}
      points={[
        "File de support par catégorie (connexion, stock, vente…)",
        "Détection des demandes urgentes",
        "Transfert vers un humain",
        "Suivi de résolution",
      ]}
    />
  );
}
