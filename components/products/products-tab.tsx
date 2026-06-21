"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Loader2, ShoppingBag, PackageOpen } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { createProduct, updateProduct, deleteProduct, toggleProduct } from "@/lib/actions/products";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Product } from "@/lib/types";

const MAX_IMAGES = 6;
const CURRENCIES = ["XOF", "EUR", "USD", "MAD", "GNF", "XAF"];

interface AgentOption { id: string; name: string }

type Draft = {
  agentId: string;
  name: string;
  description: string;
  price: string;
  currency: string;
  images: string[];
  isActive: boolean;
};

function emptyDraft(agentId: string): Draft {
  return { agentId, name: "", description: "", price: "", currency: "XOF", images: [], isActive: true };
}

function formatPrice(price: number | null, currency: string) {
  if (!price) return null;
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency, minimumFractionDigits: 0 }).format(price);
}

export function ProductsTab({
  products,
  agents,
  activeAgentId,
}: {
  products: Product[];
  agents: AgentOption[];
  activeAgentId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [uploading, setUploading] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Product | null>(null);
  const [draft, setDraft] = React.useState<Draft>(emptyDraft(activeAgentId ?? agents[0]?.id ?? ""));

  function openCreate() {
    setEditing(null);
    setDraft(emptyDraft(activeAgentId ?? agents[0]?.id ?? ""));
    setDialogOpen(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setDraft({
      agentId: p.agent_id,
      name: p.name,
      description: p.description ?? "",
      price: p.price != null ? String(p.price) : "",
      currency: p.currency,
      images: p.images,
      isActive: p.is_active,
    });
    setDialogOpen(true);
  }

  async function uploadImage(file: File): Promise<string | null> {
    const supabase = createClient();
    const path = `${draft.agentId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error } = await supabase.storage
      .from("product-images")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) { toast.error(`Upload image échoué : ${error.message}`); return null; }
    return supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
  }

  async function pickImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const remaining = MAX_IMAGES - draft.images.length;
    if (files.length === 0 || remaining <= 0) return;
    const toUpload = files.slice(0, remaining);
    setUploading(true);
    try {
      const urls = (await Promise.all(toUpload.map(uploadImage))).filter(Boolean) as string[];
      setDraft((d) => ({ ...d, images: [...d.images, ...urls] }));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  function removeImage(url: string) {
    setDraft((d) => ({ ...d, images: d.images.filter((u) => u !== url) }));
  }

  function save() {
    if (!draft.name.trim()) { toast.error("Le nom est requis."); return; }
    if (!draft.agentId) { toast.error("Sélectionnez un agent."); return; }
    const parsedPrice = draft.price ? parseFloat(draft.price.replace(",", ".")) : null;
    startTransition(async () => {
      const input = {
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        price: parsedPrice,
        currency: draft.currency,
        images: draft.images,
        isActive: draft.isActive,
      };
      const res = editing
        ? await updateProduct(editing.id, input)
        : await createProduct({ ...input, agentId: draft.agentId });
      if (res.ok) {
        toast.success(editing ? "Produit mis à jour." : "Produit ajouté.");
        setDialogOpen(false);
        router.refresh();
      } else {
        toast.error(res.error ?? "Échec.");
      }
    });
  }

  function toggle(p: Product) {
    startTransition(async () => {
      const res = await toggleProduct(p.id, !p.is_active);
      if (res.ok) router.refresh();
      else toast.error(res.error ?? "Échec.");
    });
  }

  function remove(p: Product) {
    if (!confirm(`Supprimer le produit « ${p.name} » ?`)) return;
    startTransition(async () => {
      const res = await deleteProduct(p.id, p.images);
      if (res.ok) { toast.success("Produit supprimé."); router.refresh(); }
      else toast.error(res.error ?? "Échec.");
    });
  }

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? "—";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {products.length} produit{products.length !== 1 ? "s" : ""} — catalogue consultable par l&apos;agent IA
        </p>
        <Button onClick={openCreate} disabled={agents.length === 0}>
          <Plus className="size-4" /> Ajouter un produit
        </Button>
      </div>

      {products.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-14">
          <PackageOpen className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">Aucun produit. Créez votre catalogue.</p>
          <Button variant="outline" onClick={openCreate} disabled={agents.length === 0}>
            <Plus className="size-4" /> Ajouter un produit
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <Card key={p.id} className={cn("overflow-hidden", !p.is_active && "opacity-60")}>
              {/* Images */}
              {p.images.length > 0 ? (
                <div className="relative h-40 bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.images[0]}
                    alt={p.name}
                    className="h-full w-full object-cover"
                  />
                  {p.images.length > 1 && (
                    <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
                      +{p.images.length - 1}
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex h-40 items-center justify-center bg-muted">
                  <ShoppingBag className="size-10 text-muted-foreground/30" />
                </div>
              )}

              <div className="p-4">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold leading-tight">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{agentName(p.agent_id)}</p>
                  </div>
                  <Switch checked={p.is_active} onCheckedChange={() => toggle(p)} aria-label="Activer" />
                </div>
                {p.price != null && (
                  <Badge tone="success" className="mb-2">
                    {formatPrice(p.price, p.currency)}
                  </Badge>
                )}
                {p.description && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
                )}
                <div className="mt-3 flex justify-end gap-1">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(p)} disabled={pending}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="text-destructive" onClick={() => remove(p)} disabled={pending}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Product form dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setDialogOpen(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier le produit" : "Nouveau produit"}</DialogTitle>
            <DialogDescription>
              L&apos;agent IA pourra présenter ce produit aux prospects.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Agent */}
            {!editing && (
              <div className="space-y-1.5">
                <Label>Agent</Label>
                <Select value={draft.agentId} onValueChange={(v) => setDraft((d) => ({ ...d, agentId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Choisir un agent" /></SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Name */}
            <div className="space-y-1.5">
              <Label>Nom du produit <span className="text-destructive">*</span></Label>
              <Input
                placeholder="Ex. FasoStock Pro — Abonnement mensuel"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                placeholder="Fonctionnalités, avantages, conditions…"
                rows={3}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </div>

            {/* Price + Currency */}
            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5">
                <Label>Prix</Label>
                <Input
                  type="number"
                  placeholder="0"
                  min={0}
                  value={draft.price}
                  onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
                />
              </div>
              <div className="w-28 space-y-1.5">
                <Label>Devise</Label>
                <Select value={draft.currency} onValueChange={(v) => setDraft((d) => ({ ...d, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Images */}
            <div className="space-y-2">
              <Label>
                Images{" "}
                <span className="font-normal text-muted-foreground">
                  ({draft.images.length}/{MAX_IMAGES})
                </span>
              </Label>
              <div className="grid grid-cols-3 gap-2">
                {draft.images.map((url, i) => (
                  <div key={i} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="h-full w-full object-cover" />
                    <button
                      onClick={() => removeImage(url)}
                      className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 text-white text-xs font-medium"
                    >
                      Supprimer
                    </button>
                    {i === 0 && (
                      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">
                        Principale
                      </span>
                    )}
                  </div>
                ))}
                {draft.images.length < MAX_IMAGES && (
                  <label className={cn(
                    "flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50",
                    uploading && "pointer-events-none opacity-50",
                  )}>
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      className="sr-only"
                      onChange={pickImages}
                      disabled={uploading}
                    />
                    {uploading ? (
                      <Loader2 className="size-5 animate-spin" />
                    ) : (
                      <>
                        <Plus className="size-5" />
                        <span className="mt-1 text-[10px]">Ajouter</span>
                      </>
                    )}
                  </label>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Maximum {MAX_IMAGES} images. La première sera l&apos;image principale.
              </p>
            </div>

            {/* Active */}
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={draft.isActive} onCheckedChange={(v) => setDraft((d) => ({ ...d, isActive: v }))} />
              Produit actif (visible par l&apos;IA)
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={save} disabled={pending || uploading}>
              {(pending || uploading) && <Loader2 className="size-4 animate-spin" />}
              {editing ? "Mettre à jour" : "Créer le produit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
