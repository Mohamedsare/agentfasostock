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
            Gérez vos agents WhatsApp : créez-en, connectez un numéro, configurez leur comportement.
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
            // identity + connection
            id: a.id,
            name: a.name,
            phone_number: a.phone_number,
            connection_status: a.connection_status,
            wasender_session_id: a.wasender_session_id,
            admin_whatsapp: a.admin_whatsapp,
            // per-agent config (AgentSettings)
            agent_name: a.agent_name,
            tone: a.tone,
            language: a.language,
            welcome_message: a.welcome_message,
            system_prompt: a.system_prompt,
            qualification_rules: a.qualification_rules,
            human_handoff_rules: a.human_handoff_rules,
            qualified_threshold: a.qualified_threshold,
            hot_threshold: a.hot_threshold,
            ai_enabled: a.ai_enabled,
            follow_ups_enabled: a.follow_ups_enabled !== false,
            learning_mode: a.learning_mode ?? "auto",
            operating_mode: a.operating_mode,
            updated_at: a.updated_at,
          }))}
          activeId={activeId}
        />
      )}
    </div>
  );
}
