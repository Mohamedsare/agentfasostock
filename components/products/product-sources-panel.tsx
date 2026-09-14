"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import {
  Plug, Plus, RefreshCw, Loader2, Pencil, Trash2, CheckCircle2, AlertTriangle, FlaskConical, ChevronDown, Store,
} from "lucide-react";
import { toast } from "sonner";
import {
  saveProductSource, deleteProductSource, testProductSource, runProductSourceSync, listFasostockStores,
  type ProductSourceInput,
} from "@/lib/actions/product-sources";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  ProductFieldMapping, ProductPaginationStyle, ProductSourceAuthType, ProductSourceView,
} from "@/lib/types";

interface AgentOption { id: string; name: string }

type Draft = Omit<ProductSourceInput, "apiKey"> & { apiKey: string; clearKey: boolean };

type TestResult = Awaited<ReturnType<typeof testProductSource>>;
type StoresResult = Awaited<ReturnType<typeof listFasostockStores>>;

const MAPPING_FIELDS: { key: keyof ProductFieldMapping; label: string; hint: string }[] = [
  { key: "items", label: "Liste des produits", hint: "products" },
  { key: "id", label: "Identifiant", hint: "id" },
  { key: "name", label: "Nom", hint: "name" },
  { key: "description", label: "Description", hint: "description" },
  { key: "price", label: "Prix", hint: "price" },
  { key: "currency", label: "Devise", hint: "currency" },
  { key: "images", label: "Images", hint: "images" },
  { key: "sku", label: "Référence / SKU", hint: "sku" },
  { key: "category", label: "Catégorie", hint: "category.name" },
  { key: "brand", label: "Marque", hint: "brand.name" },
  { key: "stock", label: "Quantité en stock", hint: "stock" },
  { key: "in_stock", label: "En stock (oui/non)", hint: "in_stock" },
  { key: "url", label: "Lien produit", hint: "url" },
];

const INTERVALS = [
  { value: 10, label: "Toutes les 10 min" },
  { value: 30, label: "Toutes les 30 min" },
  { value: 60, label: "Toutes les heures" },
  { value: 360, label: "Toutes les 6 h" },
  { value: 1440, label: "Une fois par jour" },
];

function emptyDraft(agentId: string): Draft {
  return {
    agentId,
    name: "Catalogue API",
    baseUrl: "",
    authType: "none",
    authKeyName: "",
    apiKey: "",
    clearKey: false,
    defaultQuery: "",
    perPage: 100,
    paginationStyle: "auto",
    incrementalParam: "",
    syncIntervalMinutes: 30,
    fieldMapping: {},
    isActive: true,
  };
}

function toInput(d: Draft): ProductSourceInput {
  const { clearKey, apiKey, ...rest } = d;
  return { ...rest, apiKey: clearKey ? null : apiKey };
}

function relative(date: string | null) {
  return date ? formatDistanceToNow(new Date(date), { addSuffix: true, locale: fr }) : "jamais";
}

export function ProductSourcesPanel({
  sources,
  agents,
  activeAgentId,
}: {
  sources: ProductSourceView[];
  agents: AgentOption[];
  activeAgentId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [syncingId, setSyncingId] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ProductSourceView | null>(null);
  const [draft, setDraft] = React.useState<Draft>(emptyDraft(activeAgentId ?? agents[0]?.id ?? ""));
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [test, setTest] = React.useState<TestResult | null>(null);
  // FasoStock quick connect
  const [fsKey, setFsKey] = React.useState("");
  const [loadingStores, setLoadingStores] = React.useState(false);
  const [stores, setStores] = React.useState<StoresResult | null>(null);
  const [storeId, setStoreId] = React.useState("");

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  function resetQuickConnect() {
    setFsKey("");
    setStores(null);
    setStoreId("");
  }

  function openCreate() {
    setEditing(null);
    setDraft(emptyDraft(activeAgentId ?? agents[0]?.id ?? ""));
    setTest(null);
    setShowAdvanced(false);
    resetQuickConnect();
    setOpen(true);
  }

  function openEdit(s: ProductSourceView) {
    setEditing(s);
    setDraft({
      agentId: s.agent_id,
      name: s.name,
      baseUrl: s.base_url,
      authType: s.auth_type,
      authKeyName: s.auth_key_name ?? "",
      apiKey: "",
      clearKey: false,
      defaultQuery: s.default_query ?? "",
      perPage: s.per_page,
      paginationStyle: s.pagination_style ?? "auto",
      incrementalParam: s.incremental_param ?? "",
      syncIntervalMinutes: s.sync_interval_minutes,
      fieldMapping: s.field_mapping ?? {},
      isActive: s.is_active,
    });
    setTest(null);
    setShowAdvanced(Object.keys(s.field_mapping ?? {}).length > 0 || Boolean(s.incremental_param));
    resetQuickConnect();
    setOpen(true);
  }

  async function loadStores() {
    setLoadingStores(true);
    setStores(null);
    setStoreId("");
    try {
      const res = await listFasostockStores(fsKey);
      setStores(res);
      if (!res.ok) toast.error(res.error ?? "Échec.");
      else if (res.stores?.length === 1) pickStore(res.stores[0].id, res);
    } finally {
      setLoadingStores(false);
    }
  }

  function pickStore(id: string, from: StoresResult | null = stores) {
    const store = from?.stores?.find((s) => s.id === id);
    if (!store) return;
    setStoreId(id);
    setTest(null);
    setDraft((d) => ({
      ...d,
      name: `FasoStock — ${store.name}`,
      baseUrl: store.products_url,
      authType: "bearer",
      authKeyName: "",
      apiKey: fsKey.trim(),
      clearKey: false,
      perPage: 500,
      paginationStyle: "offset",
      incrementalParam: "",
    }));
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const res = await testProductSource(editing?.id ?? null, toInput(draft));
      setTest(res);
      if (!res.ok) toast.error(res.error ?? "Échec du test.");
    } finally {
      setTesting(false);
    }
  }

  function save() {
    startTransition(async () => {
      const res = await saveProductSource(editing?.id ?? null, toInput(draft));
      if (!res.ok || !res.id) {
        toast.error(res.error ?? "Échec de l'enregistrement.");
        return;
      }
      setOpen(false);
      toast.success(editing ? "Source mise à jour." : "Source ajoutée — synchronisation en cours…");
      if (!editing) await sync(res.id, "full");
      else router.refresh();
    });
  }

  async function sync(id: string, mode: "full" | "incremental") {
    setSyncingId(id);
    try {
      const res = await runProductSourceSync(id, mode);
      if (res.ok && res.result) {
        const r = res.result;
        toast.success(
          `${r.upserted} produit${r.upserted > 1 ? "s" : ""} synchronisé${r.upserted > 1 ? "s" : ""}` +
            (r.deactivated ? ` · ${r.deactivated} retiré${r.deactivated > 1 ? "s" : ""}` : ""),
        );
      } else {
        toast.error(res.error ?? "Échec de la synchronisation.");
      }
    } finally {
      setSyncingId(null);
      router.refresh();
    }
  }

  function remove(s: ProductSourceView) {
    if (!confirm(`Supprimer la source « ${s.name} » et tous ses produits synchronisés ?`)) return;
    startTransition(async () => {
      const res = await deleteProductSource(s.id);
      if (res.ok) { toast.success("Source supprimée."); router.refresh(); }
      else toast.error(res.error ?? "Échec.");
    });
  }

  const needsKey = draft.authType !== "none";

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Plug className="size-4" />
          </div>
          <div>
            <p className="font-semibold leading-tight">Connexion API produits</p>
            <p className="text-sm text-muted-foreground">
              Branchez FasoStock ou l&apos;API de votre boutique : l&apos;agent accède automatiquement à tout le catalogue (prix, stock, conditionnements, photos).
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={openCreate} disabled={agents.length === 0}>
          <Plus className="size-4" /> Connecter une API
        </Button>
      </div>

      {sources.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
          {sources.map((s) => {
            const busy = syncingId === s.id || s.last_sync_status === "running";
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{s.name}</p>
                    {!s.is_active ? (
                      <Badge tone="neutral">En pause</Badge>
                    ) : s.last_sync_status === "error" ? (
                      <Badge tone="danger"><AlertTriangle className="size-3" /> Erreur</Badge>
                    ) : s.last_sync_status === "success" ? (
                      <Badge tone="success"><CheckCircle2 className="size-3" /> Connectée</Badge>
                    ) : null}
                    {s.last_sync_count != null && (
                      <Badge tone="primary">{s.last_sync_count} produits</Badge>
                    )}
                  </div>
                  <p className="truncate font-mono text-xs text-muted-foreground">{s.base_url}</p>
                  <p className="text-xs text-muted-foreground">
                    Dernière synchro {relative(s.last_sync_at)}
                    {s.last_sync_status === "error" && s.last_sync_error && (
                      <span className="text-destructive"> — {s.last_sync_error}</span>
                    )}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => sync(s.id, "full")} disabled={busy || pending}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                    Synchroniser
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => openEdit(s)} disabled={pending} aria-label="Modifier">
                    <Pencil className="size-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="text-destructive" onClick={() => remove(s)} disabled={pending} aria-label="Supprimer">
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false); }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier la source API" : "Connecter une API produits"}</DialogTitle>
            <DialogDescription>
              Les produits sont synchronisés automatiquement et consultés par l&apos;agent à chaque message.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {!editing && (
              <div className="space-y-2.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Store className="size-4 text-primary" /> Connexion rapide FasoStock
                </p>
                <p className="text-xs text-muted-foreground">
                  Collez la clé créée dans FasoStock → Intégrations API, puis choisissez la boutique.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    type="password"
                    autoComplete="off"
                    className="font-mono text-sm"
                    placeholder="fs_…"
                    value={fsKey}
                    onChange={(e) => setFsKey(e.target.value)}
                    aria-label="Clé API FasoStock"
                  />
                  <Button variant="outline" onClick={loadStores} disabled={!fsKey.trim() || loadingStores}>
                    {loadingStores && <Loader2 className="size-4 animate-spin" />}
                    Charger mes boutiques
                  </Button>
                </div>
                {stores?.ok && (
                  stores.stores && stores.stores.length > 0 ? (
                    <div className="space-y-1.5">
                      <Label>Boutique{stores.company ? ` — ${stores.company}` : ""}</Label>
                      <Select value={storeId} onValueChange={(v) => pickStore(v)}>
                        <SelectTrigger><SelectValue placeholder="Choisir une boutique" /></SelectTrigger>
                        <SelectContent>
                          {stores.stores.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}{s.code ? ` (${s.code})` : ""}{s.is_primary ? " · principale" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <p className="text-xs text-destructive">Aucune boutique accessible avec cette clé.</p>
                  )
                )}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {!editing && agents.length > 1 && (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Agent</Label>
                  <Select value={draft.agentId} onValueChange={(v) => set("agentId", v)}>
                    <SelectTrigger><SelectValue placeholder="Choisir un agent" /></SelectTrigger>
                    <SelectContent>
                      {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="src-name">Nom</Label>
                <Input id="src-name" value={draft.name} onChange={(e) => set("name", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Fréquence de synchro</Label>
                <Select
                  value={String(draft.syncIntervalMinutes)}
                  onValueChange={(v) => set("syncIntervalMinutes", Number(v))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INTERVALS.map((i) => <SelectItem key={i.value} value={String(i.value)}>{i.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="src-url">URL de l&apos;endpoint produits <span className="text-destructive">*</span></Label>
              <Input
                id="src-url"
                className="font-mono text-sm"
                placeholder="https://www.fasostock.com/api/v1/stores/{storeId}/products"
                value={draft.baseUrl}
                onChange={(e) => set("baseUrl", e.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
              <div className="space-y-1.5">
                <Label htmlFor="src-query">Filtres par défaut (optionnel)</Label>
                <Input
                  id="src-query"
                  className="font-mono text-sm"
                  placeholder="in_stock=true"
                  value={draft.defaultQuery}
                  onChange={(e) => set("defaultQuery", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="src-per-page">Par page</Label>
                <Input
                  id="src-per-page"
                  type="number"
                  min={1}
                  max={500}
                  value={draft.perPage}
                  onChange={(e) => set("perPage", Number(e.target.value) || 100)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Authentification</Label>
                <Select value={draft.authType} onValueChange={(v) => set("authType", v as ProductSourceAuthType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucune (API publique)</SelectItem>
                    <SelectItem value="bearer">Bearer token</SelectItem>
                    <SelectItem value="header">Clé dans un en-tête</SelectItem>
                    <SelectItem value="query">Clé dans l&apos;URL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(draft.authType === "header" || draft.authType === "query") && (
                <div className="space-y-1.5">
                  <Label htmlFor="src-key-name">
                    {draft.authType === "header" ? "Nom de l'en-tête" : "Nom du paramètre"}
                  </Label>
                  <Input
                    id="src-key-name"
                    className="font-mono text-sm"
                    placeholder={draft.authType === "header" ? "X-API-Key" : "api_key"}
                    value={draft.authKeyName}
                    onChange={(e) => set("authKeyName", e.target.value)}
                  />
                </div>
              )}
              {needsKey && (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="src-key">Clé / token API</Label>
                  <Input
                    id="src-key"
                    type="password"
                    autoComplete="off"
                    placeholder={editing?.has_api_key ? "•••••••• (inchangée — laissez vide pour conserver)" : "Collez la clé"}
                    value={draft.apiKey}
                    onChange={(e) => setDraft((d) => ({ ...d, apiKey: e.target.value, clearKey: false }))}
                  />
                  <p className="text-xs text-muted-foreground">Chiffrée côté serveur, jamais renvoyée au navigateur.</p>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium"
                aria-expanded={showAdvanced}
              >
                Options avancées
                <ChevronDown className={cn("size-4 transition-transform", showAdvanced && "rotate-180")} />
              </button>
              {showAdvanced && (
                <div className="space-y-4 border-t border-border p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Pagination</Label>
                      <Select
                        value={draft.paginationStyle}
                        onValueChange={(v) => set("paginationStyle", v as ProductPaginationStyle)}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Détection automatique</SelectItem>
                          <SelectItem value="offset">limit / offset</SelectItem>
                          <SelectItem value="page">page / per_page</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="src-incremental">Paramètre « modifié depuis »</Label>
                      <Input
                        id="src-incremental"
                        className="font-mono text-sm"
                        placeholder="updated_since (vide = synchro complète)"
                        value={draft.incrementalParam}
                        onChange={(e) => set("incrementalParam", e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Correspondance des champs — laissez vide pour la détection automatique. Chemins pointés acceptés, ex.{" "}
                      <span className="font-mono">category.name</span>.
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {MAPPING_FIELDS.map((f) => (
                        <div key={f.key} className="flex items-center gap-2">
                          <Label htmlFor={`map-${f.key}`} className="w-32 shrink-0 text-xs font-normal">{f.label}</Label>
                          <Input
                            id={`map-${f.key}`}
                            className="h-8 font-mono text-xs"
                            placeholder={f.hint}
                            value={draft.fieldMapping[f.key] ?? ""}
                            onChange={(e) => set("fieldMapping", { ...draft.fieldMapping, [f.key]: e.target.value })}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {test && (
              <div
                className={cn(
                  "rounded-lg border p-3 text-sm",
                  test.ok ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5",
                )}
                role="status"
              >
                {test.ok ? (
                  <>
                    <p className="flex items-center gap-2 font-medium text-success">
                      <CheckCircle2 className="size-4" /> Connexion réussie — {test.total} produit(s) dans le catalogue
                    </p>
                    {test.rawKeys && test.rawKeys.length > 0 && (
                      <p className="mt-1 font-mono text-xs text-muted-foreground">Champs reçus : {test.rawKeys.join(", ")}</p>
                    )}
                    <ul className="mt-2 space-y-1.5">
                      {test.samples?.map((p) => (
                        <li key={p.external_id} className="flex items-center gap-2 text-xs">
                          {p.images[0] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.images[0]} alt="" className="size-8 rounded object-cover" />
                          ) : (
                            <span className="size-8 shrink-0 rounded bg-muted" />
                          )}
                          <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                          <span className="text-muted-foreground">
                            {p.price != null ? `${p.price} ${p.currency}` : "sans prix"}
                            {p.category ? ` · ${p.category}` : ""}
                            {p.in_stock === false ? " · rupture" : p.stock_quantity != null ? ` · stock ${p.stock_quantity}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="flex items-start gap-2 text-destructive">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {test.error}
                  </p>
                )}
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <Switch checked={draft.isActive} onCheckedChange={(v) => set("isActive", v)} />
              Synchronisation automatique active
            </label>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={runTest} disabled={testing || !draft.baseUrl}>
              {testing ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
              Tester la connexion
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
              <Button onClick={save} disabled={pending || !draft.baseUrl}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                {editing ? "Enregistrer" : "Connecter et synchroniser"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
