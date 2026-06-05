"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, ChevronDown, Loader2 } from "lucide-react";
import { setActiveAgent } from "@/lib/actions/agents";

export interface SwitcherAgent {
  id: string;
  name: string;
}

/** Compact dropdown to switch the dashboard's active agent (tenant scope). */
export function AgentSwitcher({
  agents,
  activeId,
}: {
  agents: SwitcherAgent[];
  activeId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (agents.length === 0) return null;

  return (
    <div className="relative inline-flex items-center">
      <Bot className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
      {pending ? (
        <Loader2 className="pointer-events-none absolute right-2.5 size-3.5 animate-spin text-muted-foreground" />
      ) : (
        <ChevronDown className="pointer-events-none absolute right-2.5 size-3.5 text-muted-foreground" />
      )}
      <select
        aria-label="Agent actif"
        value={activeId ?? ""}
        disabled={pending}
        onChange={(e) => {
          const id = e.target.value;
          start(async () => {
            await setActiveAgent(id);
            router.refresh();
          });
        }}
        className="h-9 max-w-34 appearance-none truncate rounded-lg border border-border bg-card pl-8 pr-8 text-sm font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring sm:max-w-none"
      >
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}
