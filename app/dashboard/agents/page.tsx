import type { Metadata } from "next";
import { Bot } from "lucide-react";
import { AgentsManager } from "@/components/agents/agents-manager";
import { getOrgAgents, getActiveAgentId } from "@/lib/agents";
import { usingMockData } from "@/lib/data";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage() {
  const [agents, activeId] = await Promise.all([
    usingMockData ? Promise.resolve([]) : getOrgAgents(),
    usingMockData ? Promise.resolve(null) : getActiveAgentId(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Bot className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
          <p className="text-sm text-muted-foreground">
            Gérez vos agents WhatsApp : créez-en, connectez un numéro, choisissez l&apos;agent actif.
          </p>
        </div>
      </div>

      {usingMockData ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Connectez Supabase pour gérer vos agents.
        </div>
      ) : (
        <AgentsManager
          agents={agents.map((a) => ({
            id: a.id,
            name: a.name,
            phone_number: a.phone_number,
            connection_status: a.connection_status,
            wasender_session_id: a.wasender_session_id,
            admin_whatsapp: a.admin_whatsapp,
          }))}
          activeId={activeId}
        />
      )}
    </div>
  );
}
