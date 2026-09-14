import { PageHeader } from "@/components/dashboard/page-header";
import { FollowUpsView, type EnrichedFollowUp } from "@/components/follow-ups/follow-ups-view";
import { getAgentSettings, getConversations, getFollowUps } from "@/lib/data";
import { contactLabel } from "@/lib/utils";

export const metadata = { title: "Relances" };

export default async function FollowUpsPage() {
  const [followUps, conversations, settings] = await Promise.all([
    getFollowUps(),
    getConversations(),
    getAgentSettings(),
  ]);
  const enabled = settings.follow_ups_enabled !== false;

  const nameByContact = new Map(
    conversations.map((c) => [c.contact.id, contactLabel(c.contact.name, c.contact.phone)]),
  );

  const enriched: EnrichedFollowUp[] = followUps.map((f) => ({
    id: f.id,
    conversation_id: f.conversation_id,
    step: f.step,
    scheduled_at: f.scheduled_at,
    status: f.status,
    message: f.message,
    contactName: nameByContact.get(f.contact_id) ?? "Contact",
  }));

  const active = enriched.filter((f) => f.status === "scheduled").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relances automatiques"
        description={
          enabled
            ? `${active} relance(s) planifiée(s) · règle 24h / 3j / 7j, max 3.`
            : "Relances désactivées — aucune relance n'est planifiée ni envoyée."
        }
      />
      <FollowUpsView followUps={enriched} enabled={enabled} />
    </div>
  );
}
