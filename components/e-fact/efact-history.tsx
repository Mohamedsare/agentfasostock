"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  FileText,
  Receipt,
  ReceiptText,
  Download,
  Pencil,
  Trash2,
  Loader2,
  Archive,
  Wallet,
  TrendingUp,
  CalendarClock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/dashboard/empty-state";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { EFactPreview } from "./invoice-document";
import {
  type DocKind,
  type EFactDocument,
  type EfactListItem,
  STORAGE_KEY,
  formatDate,
  formatMoney,
} from "./types";
import { downloadDocumentPdf } from "./pdf";
import {
  deleteEfactDocument,
  getEfactDocumentPayload,
} from "@/lib/actions/efact";

const KIND_META: Record<
  DocKind,
  { label: string; icon: typeof FileText; tone: "primary" | "info" | "success" }
> = {
  facture: { label: "Facture", icon: Receipt, tone: "primary" },
  devis: { label: "Devis", icon: FileText, tone: "info" },
  recu: { label: "Reçu", icon: ReceiptText, tone: "success" },
};

type Filter = "all" | DocKind;

export function EfactHistory({ documents }: { documents: EfactListItem[] }) {
  const router = useRouter();
  // Optimistically hide deleted rows without re-fetching; the list itself stays
  // derived from the server prop (no state-sync effect needed).
  const [removed, setRemoved] = React.useState<Set<string>>(new Set());
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = React.useState<EFactDocument | null>(null);

  const docs = React.useMemo(
    () => documents.filter((d) => !removed.has(d.id)),
    [documents, removed],
  );
  const stats = React.useMemo(() => computeStats(docs), [docs]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter((d) => {
      if (filter !== "all" && d.kind !== filter) return false;
      if (!q) return true;
      return (
        d.number.toLowerCase().includes(q) ||
        (d.client_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [docs, query, filter]);

  const reopen = async (id: string) => {
    setBusyId(id);
    try {
      const payload = await getEfactDocumentPayload(id);
      if (!payload) {
        toast.error("Document introuvable.");
        return;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      router.push("/dashboard/e-fact");
    } catch {
      toast.error("Impossible d'ouvrir le document.");
    } finally {
      setBusyId(null);
    }
  };

  const download = async (item: EfactListItem) => {
    setBusyId(item.id);
    const toastId = toast.loading("Génération du PDF…");
    try {
      const payload = await getEfactDocumentPayload(item.id);
      if (!payload) {
        toast.error("Document introuvable.", { id: toastId });
        return;
      }
      setPreviewDoc(payload);
      // Wait two frames so the off-screen document is painted before capture.
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r(null))),
      );
      await downloadDocumentPdf(`${KIND_META[item.kind].label}-${item.number}`);
      toast.success("PDF téléchargé.", { id: toastId });
    } catch (err) {
      console.error(err);
      toast.error("Échec de la génération du PDF.", { id: toastId });
    } finally {
      setPreviewDoc(null);
      setBusyId(null);
    }
  };

  const remove = async (item: EfactListItem) => {
    if (!confirm(`Supprimer définitivement ${item.number} ?`)) return;
    setBusyId(item.id);
    const res = await deleteEfactDocument(item.id);
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.error ?? "Échec de la suppression.");
      return;
    }
    setRemoved((s) => new Set(s).add(item.id));
    toast.success("Document supprimé.");
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={Wallet}
          tone="text-success"
          label="Encaissé (reçus)"
          value={formatMoney(stats.received, stats.currency)}
          hint={`${stats.count.recu} reçu(s)`}
        />
        <StatCard
          icon={TrendingUp}
          tone="text-primary"
          label="Facturé"
          value={formatMoney(stats.invoiced, stats.currency)}
          hint={`${stats.count.facture} facture(s)`}
        />
        <StatCard
          icon={FileText}
          tone="text-info"
          label="Devis émis"
          value={formatMoney(stats.quoted, stats.currency)}
          hint={`${stats.count.devis} devis`}
        />
        <StatCard
          icon={CalendarClock}
          tone="text-accent"
          label="Encaissé ce mois-ci"
          value={formatMoney(stats.receivedThisMonth, stats.currency)}
          hint={new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
        />
      </div>
      {stats.multiCurrency && (
        <p className="-mt-3 text-xs text-muted-foreground">
          Montants affichés en {stats.currency}. D'autres devises existent dans l'historique.
        </p>
      )}

      {/* Search + filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher (numéro, client)…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["all", "facture", "devis", "recu"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                filter === f
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {f === "all" ? "Tous" : KIND_META[f].label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Archive}
          title={docs.length === 0 ? "Aucun document archivé" : "Aucun résultat"}
          description={
            docs.length === 0
              ? "Vos factures, devis et reçus téléchargés apparaîtront ici automatiquement."
              : "Essayez un autre terme de recherche ou un autre filtre."
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {filtered.map((item) => {
                const meta = KIND_META[item.kind];
                const busy = busyId === item.id;
                return (
                  <li
                    key={item.id}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={cn(
                          "grid size-10 shrink-0 place-items-center rounded-lg",
                          meta.tone === "primary" && "bg-primary/10 text-primary",
                          meta.tone === "info" && "bg-info/10 text-info",
                          meta.tone === "success" && "bg-success/10 text-success",
                        )}
                      >
                        <meta.icon className="size-5" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-mono text-sm font-semibold">
                            {item.number}
                          </span>
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                          {item.kind === "recu" && item.status === "acompte" && (
                            <Badge tone="warning">Acompte</Badge>
                          )}
                        </div>
                        <p className="truncate text-sm text-muted-foreground">
                          {item.client_name || "Client non renseigné"} ·{" "}
                          {formatDate(item.issue_date ?? item.created_at.slice(0, 10))}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 sm:gap-4">
                      <span className="text-sm font-bold tabular-nums">
                        {formatMoney(item.total, item.currency)}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label="Rouvrir"
                          title="Rouvrir dans l'éditeur"
                          disabled={busy}
                          onClick={() => reopen(item.id)}
                        >
                          {busy ? <Loader2 className="animate-spin" /> : <Pencil />}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label="Télécharger le PDF"
                          title="Télécharger le PDF"
                          disabled={busy}
                          onClick={() => download(item)}
                        >
                          <Download />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          aria-label="Supprimer"
                          title="Supprimer"
                          disabled={busy}
                          onClick={() => remove(item)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Off-screen render target for downloading a past document as PDF. */}
      {previewDoc && (
        <div
          aria-hidden
          style={{ position: "fixed", left: -99999, top: 0, width: 820 }}
        >
          <EFactPreview doc={previewDoc} />
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: typeof FileText;
  tone: string;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <Icon className={cn("size-4", tone)} />
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
        </div>
        <p className="mt-2 truncate text-xl font-bold tabular-nums">{value}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

interface Stats {
  currency: string;
  multiCurrency: boolean;
  received: number;
  invoiced: number;
  quoted: number;
  receivedThisMonth: number;
  count: Record<DocKind, number>;
}

/**
 * Money totals are computed only for the dominant currency (summing different
 * currencies would be meaningless); counts are currency-agnostic.
 */
function computeStats(docs: EfactListItem[]): Stats {
  const count: Record<DocKind, number> = { facture: 0, devis: 0, recu: 0 };
  const currencyFreq = new Map<string, number>();
  for (const d of docs) {
    count[d.kind] += 1;
    currencyFreq.set(d.currency, (currencyFreq.get(d.currency) ?? 0) + 1);
  }
  let currency = "XOF";
  let max = -1;
  for (const [c, n] of currencyFreq) {
    if (n > max) {
      max = n;
      currency = c;
    }
  }

  const now = new Date();
  const inThisMonth = (iso: string | null) => {
    if (!iso) return false;
    const d = new Date(iso);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  };

  let received = 0;
  let invoiced = 0;
  let quoted = 0;
  let receivedThisMonth = 0;
  for (const d of docs) {
    if (d.currency !== currency) continue;
    const total = Number(d.total) || 0;
    if (d.kind === "recu") {
      received += total;
      if (inThisMonth(d.issue_date ?? d.created_at)) receivedThisMonth += total;
    } else if (d.kind === "facture") {
      invoiced += total;
    } else {
      quoted += total;
    }
  }

  return {
    currency,
    multiCurrency: currencyFreq.size > 1,
    received,
    invoiced,
    quoted,
    receivedThisMonth,
    count,
  };
}
