"use client";

import * as React from "react";
import {
  FileText,
  Receipt,
  ReceiptText,
  Plus,
  Trash2,
  Download,
  Printer,
  Upload,
  X,
  RotateCcw,
  Palette,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { EFactPreview } from "./invoice-document";
import { SignaturePad } from "./signature-pad";
import { downloadDocumentPdf } from "./pdf";
import {
  type DocKind,
  type EFactDocument,
  type EFactLine,
  type EFactParty,
  CURRENCIES,
  PAYMENT_MODES,
  STORAGE_KEY,
  amountToWords,
  computeTotals,
  createEmptyDocument,
  formatMoney,
  newLine,
  suggestNumber,
} from "./types";
import { saveEfactDocument } from "@/lib/actions/efact";

const ACCENTS = ["#16A34A", "#0EA5E9", "#6366F1", "#F97316", "#DC2626", "#0F172A"];

const KIND_TITLE: Record<DocKind, string> = {
  facture: "Facture",
  devis: "Devis",
  recu: "Reçu",
};

export function InvoiceBuilder() {
  const [doc, setDoc] = React.useState<EFactDocument>(createEmptyDocument);
  const [hydrated, setHydrated] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);

  // Restore the last document (incl. the seller's saved identity) on mount.
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // Syncing from an external store (localStorage) + assigning the random
      // document number happens here, on mount — doing it during render would
      // break hydration (server and client would disagree).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDoc((d) => {
        if (raw) {
          const parsed = JSON.parse(raw) as EFactDocument;
          return { ...createEmptyDocument(), ...parsed };
        }
        return { ...d, number: suggestNumber(d.kind) };
      });
    } catch {
      /* corrupt storage — fall back to the empty document */
    }
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    } catch {
      /* quota / private mode — non-fatal */
    }
  }, [doc, hydrated]);

  const totals = computeTotals(doc);
  const isReceipt = doc.kind === "recu";

  const set = <K extends keyof EFactDocument>(key: K, value: EFactDocument[K]) =>
    setDoc((d) => ({ ...d, [key]: value }));

  const setParty = (
    who: "emitter" | "client",
    key: keyof EFactParty,
    value: string,
  ) => setDoc((d) => ({ ...d, [who]: { ...d[who], [key]: value } }));

  const setLine = (id: string, key: keyof EFactLine, value: string | number) =>
    setDoc((d) => ({
      ...d,
      lines: d.lines.map((l) => (l.id === id ? { ...l, [key]: value } : l)),
    }));

  const addLine = () => setDoc((d) => ({ ...d, lines: [...d.lines, newLine()] }));

  const removeLine = (id: string) =>
    setDoc((d) => ({
      ...d,
      lines: d.lines.length > 1 ? d.lines.filter((l) => l.id !== id) : d.lines,
    }));

  const changeKind = (kind: DocKind) =>
    setDoc((d) => ({ ...d, kind, number: suggestNumber(kind) }));

  const onLogoUpload = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Veuillez choisir une image (PNG, JPG, SVG…).");
      return;
    }
    if (file.size > 1_500_000) {
      toast.error("Logo trop lourd (max 1,5 Mo).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set("logo", String(reader.result));
    reader.readAsDataURL(file);
  };

  const missingEmitter = () => {
    if (!doc.emitter.company && !doc.emitter.name) {
      toast.error("Renseignez votre nom / entreprise avant d'exporter.");
      return true;
    }
    return false;
  };

  const fileName = () => `${KIND_TITLE[doc.kind]}-${doc.number || "document"}`;

  // Auto-download a real PDF file — no browser print dialog.
  const handleDownload = async () => {
    if (missingEmitter() || generating) return;
    setGenerating(true);
    const toastId = toast.loading("Génération du PDF…");
    try {
      await downloadDocumentPdf(fileName());
      toast.success("PDF téléchargé.", { id: toastId });
    } catch (err) {
      console.error(err);
      toast.error("Échec de la génération du PDF.", { id: toastId });
      setGenerating(false);
      return;
    }
    // Archive to the cloud so it's findable later (non-blocking for the user).
    try {
      const res = await saveEfactDocument(doc);
      if (!res.ok) toast.warning(`Non archivé : ${res.error}`);
    } catch {
      toast.warning("Document non archivé (hors ligne ?).");
    } finally {
      setGenerating(false);
    }
  };

  // Kept as a secondary option (physical print / print-to-PDF via the dialog).
  const handlePrint = () => {
    if (missingEmitter()) return;
    document.title = fileName();
    setTimeout(() => window.print(), 60);
  };

  const resetAll = () => {
    if (!confirm("Réinitialiser tout le document ? Cette action est définitive.")) return;
    const fresh = createEmptyDocument();
    setDoc({ ...fresh, number: suggestNumber(fresh.kind) });
    toast.success("Document réinitialisé.");
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      {/* ─────────────────────────  FORM  ───────────────────────── */}
      <div className="no-print space-y-4">
        {/* Doc type + meta */}
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="grid grid-cols-3 gap-2">
              <KindButton
                active={doc.kind === "facture"}
                onClick={() => changeKind("facture")}
                icon={Receipt}
                label="Facture"
              />
              <KindButton
                active={doc.kind === "devis"}
                onClick={() => changeKind("devis")}
                icon={FileText}
                label="Devis"
              />
              <KindButton
                active={doc.kind === "recu"}
                onClick={() => changeKind("recu")}
                icon={ReceiptText}
                label="Reçu"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Numéro">
                <Input
                  value={doc.number}
                  onChange={(e) => set("number", e.target.value)}
                  className="font-mono"
                />
              </Field>
              <Field label="Devise">
                <Select value={doc.currency} onValueChange={(v) => set("currency", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label={isReceipt ? "Date du reçu" : "Date d'émission"}>
                <Input
                  type="date"
                  value={doc.issueDate}
                  onChange={(e) => set("issueDate", e.target.value)}
                />
              </Field>
              {isReceipt ? (
                <Field label="Fait à (ville)">
                  <Input
                    value={doc.city}
                    onChange={(e) => set("city", e.target.value)}
                    placeholder="Ouagadougou"
                  />
                </Field>
              ) : (
                <Field label={doc.kind === "facture" ? "Échéance" : "Valable jusqu'au"}>
                  <Input
                    type="date"
                    value={doc.dueDate}
                    onChange={(e) => set("dueDate", e.target.value)}
                  />
                </Field>
              )}
            </div>

            {/* Accent + logo */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Palette className="size-4 text-muted-foreground" />
                <div className="flex gap-1.5">
                  {ACCENTS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => set("accent", c)}
                      aria-label={`Couleur ${c}`}
                      className={cn(
                        "size-6 rounded-full ring-2 ring-offset-2 ring-offset-background transition",
                        doc.accent === c ? "ring-foreground" : "ring-transparent",
                      )}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
              <LogoControl
                logo={doc.logo}
                onUpload={onLogoUpload}
                onClear={() => set("logo", "")}
              />
            </div>
          </CardContent>
        </Card>

        {/* Emitter */}
        <PartyCard
          title={isReceipt ? "Vos informations (prestataire)" : "Vos informations (émetteur)"}
          party={doc.emitter}
          onChange={(k, v) => setParty("emitter", k, v)}
          role="emitter"
          receipt={isReceipt}
        />

        {/* Client */}
        <PartyCard
          title="Client"
          party={doc.client}
          onChange={(k, v) => setParty("client", k, v)}
          role="client"
          receipt={isReceipt}
        />

        {isReceipt ? (
          /* ── Receipt details ─────────────────────────────────── */
          <Card>
            <CardContent className="space-y-3 p-4">
              <h3 className="text-sm font-semibold">Détails du paiement</h3>

              <Field label="Objet du paiement">
                <Textarea
                  rows={2}
                  value={doc.object}
                  onChange={(e) => set("object", e.target.value)}
                  placeholder="Paiement formation React · abonnement SaaS · développement site web · acompte prestation…"
                />
              </Field>

              <Field label="Montant reçu">
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={doc.amountReceived}
                  onChange={(e) => set("amountReceived", num(e.target.value))}
                />
              </Field>
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                En lettres : {amountToWords(doc.amountReceived, doc.currency)}
              </p>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Mode de paiement">
                  <Select
                    value={doc.paymentMode || undefined}
                    onValueChange={(v) => set("paymentMode", v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choisir…" />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_MODES.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Référence de transaction">
                  <Input
                    value={doc.transactionRef}
                    onChange={(e) => set("transactionRef", e.target.value)}
                    placeholder="Si disponible"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Situation du paiement">
                  <Select
                    value={doc.paymentStatus}
                    onValueChange={(v) =>
                      set("paymentStatus", v as EFactDocument["paymentStatus"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="integral">Payé intégralement</SelectItem>
                      <SelectItem value="acompte">Acompte</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {doc.paymentStatus === "acompte" && (
                  <Field label="Reste à payer">
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={doc.remaining}
                      onChange={(e) => set("remaining", num(e.target.value))}
                    />
                  </Field>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* ── Line items (facture / devis) ──────────────────── */}
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Prestations / produits</h3>
                  <Button size="sm" variant="outline" onClick={addLine}>
                    <Plus /> Ligne
                  </Button>
                </div>

                <div className="space-y-2">
                  {doc.lines.map((line) => (
                    <div
                      key={line.id}
                      className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-border p-2.5"
                    >
                      <Input
                        placeholder="Description (formation, abonnement SaaS, service…)"
                        value={line.description}
                        onChange={(e) => setLine(line.id, "description", e.target.value)}
                        className="col-span-2"
                      />
                      <div className="col-span-2 grid grid-cols-[70px_1fr_1fr_auto] items-center gap-2">
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          aria-label="Quantité"
                          value={line.quantity}
                          onChange={(e) => setLine(line.id, "quantity", num(e.target.value))}
                        />
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          aria-label="Prix unitaire"
                          placeholder="Prix U."
                          value={line.unitPrice}
                          onChange={(e) => setLine(line.id, "unitPrice", num(e.target.value))}
                        />
                        <div className="truncate text-right text-sm font-medium tabular-nums text-muted-foreground">
                          {formatMoney(line.quantity * line.unitPrice, doc.currency)}
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Supprimer la ligne"
                          onClick={() => removeLine(line.id)}
                          className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-1">
                  <Field label="Remise (%)">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="any"
                      value={doc.discountRate}
                      onChange={(e) => set("discountRate", num(e.target.value))}
                      className="max-w-40"
                    />
                  </Field>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
                  <span className="font-medium text-muted-foreground">Total</span>
                  <span className="text-base font-bold tabular-nums">
                    {formatMoney(totals.total, doc.currency)}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Payment + notes */}
            <Card>
              <CardContent className="space-y-3 p-4">
                <Field label="Modalités de paiement">
                  <Textarea
                    rows={3}
                    placeholder="Ex : Orange Money · Wave · Virement bancaire (IBAN)…"
                    value={doc.paymentInfo}
                    onChange={(e) => set("paymentInfo", e.target.value)}
                  />
                </Field>
                <Field label="Notes / conditions">
                  <Textarea
                    rows={2}
                    value={doc.notes}
                    onChange={(e) => set("notes", e.target.value)}
                  />
                </Field>
              </CardContent>
            </Card>
          </>
        )}

        {/* Signature */}
        <Card>
          <CardContent className="p-4">
            <SignaturePad
              value={doc.signature}
              onChange={(v) => set("signature", v)}
            />
          </CardContent>
        </Card>

        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={resetAll} className="text-muted-foreground">
            <RotateCcw /> Réinitialiser
          </Button>
        </div>
      </div>

      {/* ────────────────────────  PREVIEW  ──────────────────────── */}
      <div className="space-y-3">
        <div className="no-print flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Aperçu en temps réel</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handlePrint} disabled={generating}>
              <Printer /> Imprimer
            </Button>
            <Button onClick={handleDownload} disabled={generating}>
              {generating ? <Loader2 className="animate-spin" /> : <Download />}
              {generating ? "Génération…" : "Télécharger le PDF"}
            </Button>
          </div>
        </div>

        <div className="no-print rounded-xl bg-slate-100 p-4 dark:bg-slate-900/40 sm:p-6">
          <EFactPreview doc={doc} />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────  sub-components  ───────────────────────── */

function num(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function KindButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof FileText;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      <Icon className="size-4" /> {label}
    </button>
  );
}

function LogoControl({
  logo,
  onUpload,
  onClear,
}: {
  logo: string;
  onUpload: (f: File | undefined) => void;
  onClear: () => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2">
      {logo ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} alt="Logo" className="size-9 rounded object-contain" />
          <Button
            size="icon"
            variant="ghost"
            aria-label="Retirer le logo"
            onClick={onClear}
            className="size-8"
          >
            <X />
          </Button>
        </>
      ) : (
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
          <Upload /> Logo
        </Button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onUpload(e.target.files?.[0])}
      />
    </div>
  );
}

function PartyCard({
  title,
  party,
  onChange,
  role,
  receipt = false,
}: {
  title: string;
  party: EFactParty;
  onChange: (key: keyof EFactParty, value: string) => void;
  role: "emitter" | "client";
  receipt?: boolean;
}) {
  const isEmitter = role === "emitter";

  // Receipts follow the "Je soussigné / Reconnais avoir reçu de" wording and a
  // trimmed field set (no company/IFU) to match a plain payment receipt.
  if (receipt) {
    return (
      <Card>
        <CardContent className="space-y-3 p-4">
          <h3 className="text-sm font-semibold">{title}</h3>
          <Field label={isEmitter ? "Nom et prénom" : "Nom du client / organisation"}>
            <Input
              value={party.name}
              onChange={(e) => onChange("name", e.target.value)}
              placeholder={isEmitter ? "Mohamed SARE" : "Nom du client"}
            />
          </Field>
          {isEmitter && (
            <Field label="Activité">
              <Input
                value={party.activity}
                onChange={(e) => onChange("activity", e.target.value)}
                placeholder="Développeur Full Stack / Formateur"
              />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Téléphone">
              <Input value={party.phone} onChange={(e) => onChange("phone", e.target.value)} />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={party.email}
                onChange={(e) => onChange("email", e.target.value)}
              />
            </Field>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label={isEmitter ? "Entreprise" : "Société"}>
            <Input
              value={party.company}
              onChange={(e) => onChange("company", e.target.value)}
              placeholder={isEmitter ? "FasoStock SARL" : "Société du client"}
            />
          </Field>
          <Field label="Nom du contact">
            <Input value={party.name} onChange={(e) => onChange("name", e.target.value)} />
          </Field>
        </div>
        <Field label="Adresse">
          <Textarea
            rows={2}
            value={party.address}
            onChange={(e) => onChange("address", e.target.value)}
            placeholder="Ouagadougou, Burkina Faso"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Téléphone">
            <Input value={party.phone} onChange={(e) => onChange("phone", e.target.value)} />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={party.email}
              onChange={(e) => onChange("email", e.target.value)}
            />
          </Field>
        </div>
        {isEmitter && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Site web">
              <Input
                value={party.website}
                onChange={(e) => onChange("website", e.target.value)}
                placeholder="fasostock.com"
              />
            </Field>
            <Field label="IFU / RCCM (optionnel)">
              <Input
                value={party.taxId}
                onChange={(e) => onChange("taxId", e.target.value)}
                placeholder="Votre n° réel — laisser vide sinon"
              />
            </Field>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
