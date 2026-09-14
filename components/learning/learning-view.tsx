"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Brain,
  Check,
  X,
  Pause,
  Pencil,
  Trash2,
  Loader2,
  PlayCircle,
  MessageSquare,
  Zap,
  ShieldCheck,
  PowerOff,
  Sparkles,
  Clock,
  Ban,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/dashboard/empty-state";
import { cn } from "@/lib/utils";
import {
  AUTO_ACTIVATE_CONFIDENCE,
  REINFORCE_ACTIVATE_OCCURRENCES,
  LEARNING_KINDS,
  LEARNING_KIND_META,
  LEARNING_STATUS_META,
} from "@/lib/learning-meta";
import {
  deleteLearning,
  runLearningNow,
  setLearningMode,
  setLearningStatus,
  updateLearning,
} from "@/lib/actions/learning";
import type { AgentLearning, LearningKind, LearningMode, LearningStatus } from "@/lib/types";

const MODES: { value: LearningMode; label: string; description: string; icon: LucideIcon }[] = [
  {
    value: "auto",
    label: "Automatique",
    description: `S'appliquent tout de suite : les leçons prouvées par vos réponses (confiance ≥ ${AUTO_ACTIVATE_CONFIDENCE} %) et celles observées dans ${REINFORCE_ACTIVATE_OCCURRENCES} conversations. Les autres attendent votre accord.`,
    icon: Zap,
  },
  {
    value: "review",
    label: "Validation manuelle",
    description: "Chaque leçon attend votre accord avant d'être utilisée par l'agent.",
    icon: ShieldCheck,
  },
  {
    value: "off",
    label: "Désactivé",
    description: "L'agent n'analyse plus ses conversations. Les leçons actives restent utilisées.",
    icon: PowerOff,
  },
];

type Filter = LearningStatus | "all";

export function LearningView({ learnings, mode }: { learnings: AgentLearning[]; mode: LearningMode }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const counts = {
    active: learnings.filter((l) => l.status === "active").length,
    pending: learnings.filter((l) => l.status === "pending").length,
    rejected: learnings.filter((l) => l.status === "rejected").length,
  };
  const [filter, setFilter] = React.useState<Filter>(counts.pending > 0 ? "pending" : "active");
  const [editing, setEditing] = React.useState<AgentLearning | null>(null);

  const visible = filter === "all" ? learnings : learnings.filter((l) => l.status === filter);

  function act(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setBusyId(id);
    startTransition(async () => {
      const res = await fn();
      setBusyId(null);
      if (res.ok) {
        toast.success(success);
        router.refresh();
      } else {
        toast.error(res.error ?? "Échec.");
      }
    });
  }

  function runNow() {
    setBusyId("__run__");
    startTransition(async () => {
      const res = await runLearningNow();
      setBusyId(null);
      if (!res.ok || !res.result) {
        toast.error(res.error ?? "Échec de l'analyse.");
        return;
      }
      const r = res.result;
      toast.success(
        r.analyzed === 0
          ? "Aucune nouvelle conversation à analyser pour le moment."
          : `${r.analyzed} conversation(s) analysée(s) · ${r.created} nouvelle(s) leçon(s)${
              r.reinforced ? ` · ${r.reinforced} confirmée(s)` : ""
            }`,
      );
      if (r.created > 0) setFilter(mode === "auto" ? "all" : "pending");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <ModeCard mode={mode} key={mode} running={pending && busyId === "__run__"} onRun={runNow} disabled={pending} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={Sparkles} label="Leçons actives" value={counts.active} tone="bg-success/10 text-success" />
        <Stat icon={Clock} label="En attente de validation" value={counts.pending} tone="bg-warning/15 text-warning" />
        <Stat icon={Ban} label="Rejetées" value={counts.rejected} tone="bg-muted text-muted-foreground" />
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Filtrer les leçons">
        {(
          [
            ["pending", "En attente", counts.pending],
            ["active", "Actives", counts.active],
            ["rejected", "Rejetées", counts.rejected],
            ["all", "Toutes", learnings.length],
          ] as [Filter, string, number][]
        ).map(([key, label, n]) => (
          <button
            key={key}
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
              filter === key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {label} <span className="opacity-70">{n}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={Brain}
          title={learnings.length === 0 ? "Aucune leçon pour l'instant" : "Rien dans ce filtre"}
          description={
            learnings.length === 0
              ? "L'agent analyse automatiquement les conversations restées calmes 30 minutes (toutes les 3 heures). Lancez une analyse pour commencer tout de suite."
              : "Changez de filtre pour voir les autres leçons."
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visible.map((l) => (
            <LearningCard
              key={l.id}
              learning={l}
              busy={pending && busyId === l.id}
              onStatus={(status, message) => act(l.id, () => setLearningStatus(l.id, status), message)}
              onEdit={() => setEditing(l)}
              onDelete={() => {
                if (confirm(`Supprimer la leçon « ${l.title} » ?`)) act(l.id, () => deleteLearning(l.id), "Leçon supprimée.");
              }}
            />
          ))}
        </div>
      )}

      <EditDialog
        learning={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function ModeCard({
  mode,
  running,
  disabled,
  onRun,
}: {
  mode: LearningMode;
  running: boolean;
  disabled: boolean;
  onRun: () => void;
}) {
  const router = useRouter();
  const [current, setCurrent] = React.useState<LearningMode>(mode);
  const [saving, startSaving] = React.useTransition();

  function choose(next: LearningMode) {
    if (next === current) return;
    const previous = current;
    setCurrent(next);
    startSaving(async () => {
      const res = await setLearningMode(next);
      if (res.ok) {
        toast.success(`Auto-apprentissage : ${MODES.find((m) => m.value === next)?.label.toLowerCase()}.`);
        router.refresh();
      } else {
        setCurrent(previous);
        toast.error(res.error ?? "Échec.");
      }
    });
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Brain className="size-5" />
          </span>
          <div>
            <p className="font-semibold text-foreground">Mode d&apos;apprentissage</p>
            <p className="text-sm text-muted-foreground">
              Sources : vos réponses manuelles, les questions où l&apos;IA a échoué, les objections et les ventes réussies.
              Jamais de prix produit ni de donnée personnelle.
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={onRun} disabled={disabled || current === "off"}>
          {running ? <Loader2 className="size-4 animate-spin" /> : <PlayCircle className="size-4" />}
          Analyser maintenant
        </Button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Mode d'apprentissage">
        {MODES.map((m) => {
          const selected = current === m.value;
          return (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={saving}
              onClick={() => choose(m.value)}
              className={cn(
                "flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors",
                selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/40",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <m.icon className={cn("size-4", selected ? "text-primary" : "text-muted-foreground")} />
                {m.label}
              </span>
              <span className="text-xs text-muted-foreground">{m.description}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: number; tone: string }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={cn("grid size-10 place-items-center rounded-xl", tone)}>
        <Icon className="size-5" />
      </span>
      <div>
        <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
}

function LearningCard({
  learning: l,
  busy,
  onStatus,
  onEdit,
  onDelete,
}: {
  learning: AgentLearning;
  busy: boolean;
  onStatus: (status: LearningStatus, message: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const kind = LEARNING_KIND_META[l.kind] ?? LEARNING_KIND_META.bonne_pratique;
  const status = LEARNING_STATUS_META[l.status];
  const sourceId = l.source_conversation_ids[l.source_conversation_ids.length - 1];

  return (
    <Card className={cn("flex flex-col p-4", l.status === "rejected" && "opacity-60")}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={kind.tone} title={kind.hint}>{kind.label}</Badge>
        <Badge tone={status.tone}>{status.label}</Badge>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          Confiance {l.confidence} %{l.occurrences > 1 ? ` · vu dans ${l.occurrences} conversations` : ""}
        </span>
      </div>
      <p className="font-semibold text-foreground">{l.title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{l.content}</p>
      {l.evidence && (
        <blockquote className="mt-2 border-l-2 border-primary/40 pl-2.5 text-xs italic text-muted-foreground">
          « {l.evidence} »
        </blockquote>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
        {sourceId ? (
          <Button asChild size="sm" variant="ghost">
            <Link href={`/dashboard/conversations/${sourceId}`}>
              <MessageSquare className="size-4" /> Conversation
            </Link>
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap gap-1">
          {busy && <Loader2 className="size-4 animate-spin self-center text-muted-foreground" />}
          {l.status !== "active" && (
            <Button size="sm" onClick={() => onStatus("active", "Leçon activée : l'agent l'applique désormais.")} disabled={busy}>
              <Check className="size-4" /> {l.status === "pending" ? "Approuver" : "Réactiver"}
            </Button>
          )}
          {l.status === "active" && (
            <Button size="sm" variant="outline" onClick={() => onStatus("pending", "Leçon mise en pause.")} disabled={busy}>
              <Pause className="size-4" /> Pause
            </Button>
          )}
          {l.status !== "rejected" && (
            <Button size="sm" variant="outline" onClick={() => onStatus("rejected", "Leçon rejetée : elle ne sera plus proposée.")} disabled={busy}>
              <X className="size-4" /> Rejeter
            </Button>
          )}
          <Button size="icon" variant="ghost" onClick={onEdit} disabled={busy} aria-label="Modifier la leçon">
            <Pencil className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" className="text-destructive" onClick={onDelete} disabled={busy} aria-label="Supprimer la leçon">
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function EditDialog({
  learning,
  onClose,
  onSaved,
}: {
  learning: AgentLearning | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = React.useState({ kind: "bonne_pratique" as LearningKind, title: "", content: "" });
  const [saving, startSaving] = React.useTransition();
  const [lastId, setLastId] = React.useState<string | null>(null);

  // Load the lesson into the form when a different one is opened.
  if (learning && learning.id !== lastId) {
    setLastId(learning.id);
    setDraft({ kind: learning.kind, title: learning.title, content: learning.content });
  }

  function save() {
    if (!learning) return;
    startSaving(async () => {
      const res = await updateLearning(learning.id, draft);
      if (res.ok) {
        toast.success("Leçon mise à jour.");
        setLastId(null);
        onSaved();
      } else {
        toast.error(res.error ?? "Échec.");
      }
    });
  }

  return (
    <Dialog
      open={Boolean(learning)}
      onOpenChange={(open) => {
        if (!open) {
          setLastId(null);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier la leçon</DialogTitle>
          <DialogDescription>Une leçon corrigée par l&apos;équipe passe à 100 % de confiance.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="learning-kind">Type</Label>
            <Select value={draft.kind} onValueChange={(v) => setDraft((d) => ({ ...d, kind: v as LearningKind }))}>
              <SelectTrigger id="learning-kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEARNING_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>{LEARNING_KIND_META[k].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="learning-title">Titre</Label>
            <Input id="learning-title" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="learning-content">Consigne pour l&apos;agent</Label>
            <Textarea
              id="learning-content"
              rows={5}
              value={draft.content}
              onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />} Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
