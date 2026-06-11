"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Send, X, Loader2, Clock, CheckCircle2, MessageSquare, PlayCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/dashboard/empty-state";
import { toast } from "sonner";
import { cn, getInitials, formatDateTime } from "@/lib/utils";
import { cancelFollowUp, sendFollowUpNow, runFollowUpsNow } from "@/lib/actions/follow-ups";
import type { BadgeTone } from "@/lib/constants";
import type { FollowUpStatus } from "@/lib/types";

export interface EnrichedFollowUp {
  id: string;
  conversation_id: string;
  step: number;
  scheduled_at: string;
  status: FollowUpStatus;
  message: string | null;
  contactName: string;
}

const STATUS_META: Record<FollowUpStatus, { label: string; tone: BadgeTone }> = {
  scheduled: { label: "Planifiée", tone: "warning" },
  sent: { label: "Envoyée", tone: "success" },
  cancelled: { label: "Annulée", tone: "neutral" },
  responded: { label: "Répondu", tone: "primary" },
};

export function FollowUpsView({ followUps }: { followUps: EnrichedFollowUp[] }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [activeId, setActiveId] = React.useState<string | null>(null);

  function act(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) {
    setActiveId(id);
    startTransition(async () => {
      const res = await fn();
      setActiveId(null);
      if (res.ok) {
        toast.success(msg);
        router.refresh();
      } else {
        toast.error(res.error ?? "Échec.");
      }
    });
  }

  function runNow() {
    setActiveId("__run__");
    startTransition(async () => {
      const res = await runFollowUpsNow();
      setActiveId(null);
      if (res.ok) {
        const r = res.result;
        toast.success(
          r && r.due > 0
            ? `${r.sent} relance(s) envoyée(s)${r.failed ? `, ${r.failed} échec(s)` : ""}.`
            : "Aucune relance due pour le moment.",
        );
        router.refresh();
      } else {
        toast.error(res.error ?? "Échec.");
      }
    });
  }

  const scheduled = followUps.filter((f) => f.status === "scheduled");
  const done = followUps.filter((f) => f.status !== "scheduled");

  const runningNow = pending && activeId === "__run__";

  if (followUps.length === 0) {
    return (
      <EmptyState
        icon={Send}
        title="Aucune relance"
        description="Les relances planifiées (24h, 3j, 7j sans réponse) apparaîtront ici."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={runNow} disabled={pending}>
          {runningNow ? <Loader2 className="size-4 animate-spin" /> : <PlayCircle className="size-4" />}
          Lancer les relances dues
        </Button>
      </div>

      <Section title="À venir" icon={Clock} count={scheduled.length}>
        {scheduled.map((f) => (
          <FollowUpCard key={f.id} f={f} busy={pending && activeId === f.id}
            onSend={() => act(f.id, () => sendFollowUpNow(f.id), "Relance envoyée.")}
            onCancel={() => act(f.id, () => cancelFollowUp(f.id), "Relance annulée.")}
          />
        ))}
        {scheduled.length === 0 && <p className="text-sm text-muted-foreground">Aucune relance planifiée.</p>}
      </Section>

      {done.length > 0 && (
        <Section title="Historique" icon={CheckCircle2} count={done.length}>
          {done.map((f) => (
            <FollowUpCard key={f.id} f={f} busy={false} />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, icon: Icon, count, children }: { title: string; icon: typeof Clock; count: number; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <h2 className="font-semibold text-foreground">{title}</h2>
        <Badge tone="neutral">{count}</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function FollowUpCard({
  f,
  busy,
  onSend,
  onCancel,
}: {
  f: EnrichedFollowUp;
  busy: boolean;
  onSend?: () => void;
  onCancel?: () => void;
}) {
  const meta = STATUS_META[f.status];
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Avatar className="size-9">
          <AvatarFallback>{getInitials(f.contactName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-semibold text-foreground">{f.contactName}</p>
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Relance #{f.step} · {formatDateTime(f.scheduled_at)}
          </p>
        </div>
      </div>
      {f.message && (
        <p className="mt-3 rounded-lg bg-muted/50 p-2.5 text-sm text-foreground">{f.message}</p>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button asChild size="sm" variant="ghost">
          <Link href={`/dashboard/conversations/${f.conversation_id}`}>
            <MessageSquare className="size-4" /> Conversation
          </Link>
        </Button>
        {f.status === "scheduled" && onSend && onCancel && (
          <div className={cn("flex gap-1")}>
            <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
              <X className="size-4" /> Annuler
            </Button>
            <Button size="sm" onClick={onSend} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Envoyer
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
