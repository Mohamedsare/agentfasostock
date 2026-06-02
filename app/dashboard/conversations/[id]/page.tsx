import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ModulePlaceholder } from "@/components/dashboard/module-placeholder";
import { Button } from "@/components/ui/button";
import { MessagesSquare } from "lucide-react";
import { getConversationById } from "@/lib/data";
import { contactLabel } from "@/lib/utils";

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const conversation = await getConversationById(id);
  if (!conversation) notFound();

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/dashboard/conversations">
          <ArrowLeft className="size-4" /> Retour aux conversations
        </Link>
      </Button>
      <ModulePlaceholder
        title={contactLabel(conversation.contact.name, conversation.contact.phone)}
        description="Vue détaillée de la conversation."
        icon={MessagesSquare}
        points={[
          "Historique complet (client, IA, admin)",
          "Résumé IA et score du prospect",
          "Champ d'envoi de message manuel",
          "Boutons reprendre / réactiver l'IA",
          "Marquer qualifié ou converti",
          "Notes et prochaine action",
        ]}
      />
    </div>
  );
}
