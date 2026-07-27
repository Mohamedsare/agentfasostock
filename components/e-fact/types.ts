/**
 * E_Fact — types & pure helpers for the electronic invoice / quote / receipt
 * builder.
 *
 * Everything the document needs to render lives in a single `EFactDocument`
 * object so the builder can persist it (localStorage) and hand it straight to
 * the print template. Money is kept as plain numbers and only formatted at the
 * edge (display / PDF) so totals stay exact. No VAT: African freelance receipts
 * and quotes are issued without a normalized tax line.
 */

export type DocKind = "facture" | "devis" | "recu";

export type PaymentStatus = "integral" | "acompte";

/** localStorage key for the in-progress document (shared builder ↔ history). */
export const STORAGE_KEY = "efact:document:v1";

/** Lightweight row for the archive list/search/stats (no heavy `payload`). */
export interface EfactListItem {
  id: string;
  kind: DocKind;
  number: string;
  client_name: string | null;
  currency: string;
  total: number;
  issue_date: string | null;
  status: string | null;
  created_at: string;
}

export interface EFactParty {
  name: string;
  /** Legal/company name if different from `name` (e.g. contact vs société). */
  company: string;
  /** Emitter only: line of business shown on receipts ("Développeur…"). */
  activity: string;
  address: string;
  phone: string;
  email: string;
  /** Emitter only: website + tax identifiers (IFU / RCCM…). */
  website: string;
  taxId: string;
}

export interface EFactLine {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface EFactDocument {
  kind: DocKind;
  number: string;
  /** ISO date strings (yyyy-mm-dd) from <input type="date">. */
  issueDate: string;
  /** Due date (facture) or validity limit (devis). Unused on receipts. */
  dueDate: string;
  currency: string;
  /** Optional brand accent so each user can theme their document. */
  accent: string;
  /** Data-URL of the uploaded logo, or "" when none. */
  logo: string;
  emitter: EFactParty;
  client: EFactParty;
  lines: EFactLine[];
  /** Percentage, 0–100. Facture/devis only. */
  discountRate: number;
  /** Free-text payment instructions (bank, Mobile Money, Wave…). */
  paymentInfo: string;
  notes: string;

  /* ── Receipt-specific fields ──────────────────────────────────── */
  /** "Fait à" — city where the receipt is issued. */
  city: string;
  /** Objet du paiement (formation, abonnement SaaS, dev site…). */
  object: string;
  /** Mode de paiement (Espèces, Orange Money, Moov Money, virement…). */
  paymentMode: string;
  /** Référence de transaction, if any. */
  transactionRef: string;
  /** Somme reçue ("La somme de …"). */
  amountReceived: number;
  paymentStatus: PaymentStatus;
  /** Reste à payer, when the payment is an acompte. */
  remaining: number;

  /** Data-URL (PNG) of the issuer's hand-drawn / uploaded signature, or "". */
  signature: string;
}

export interface EFactTotals {
  subtotal: number;
  discount: number;
  total: number;
}

export const CURRENCIES: { code: string; label: string; symbol: string }[] = [
  { code: "XOF", label: "Franc CFA (FCFA)", symbol: "FCFA" },
  { code: "EUR", label: "Euro (€)", symbol: "€" },
  { code: "USD", label: "Dollar US ($)", symbol: "$" },
  { code: "MAD", label: "Dirham (MAD)", symbol: "MAD" },
  { code: "XAF", label: "Franc CFA CEMAC (FCFA)", symbol: "FCFA" },
  { code: "GHS", label: "Cedi (₵)", symbol: "₵" },
  { code: "NGN", label: "Naira (₦)", symbol: "₦" },
];

export const PAYMENT_MODES = [
  "Espèces",
  "Orange Money",
  "Moov Money",
  "Wave",
  "Virement bancaire",
  "Carte bancaire",
  "Autre",
];

export function currencySymbol(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
}

/** Zero-decimal currencies (XOF/XAF) are formatted without cents. */
const ZERO_DECIMAL = new Set(["XOF", "XAF"]);

/** Grouped number only, no currency symbol — e.g. "350 000". */
export function formatNumber(amount: number, code: string): string {
  const fractionDigits = ZERO_DECIMAL.has(code) ? 0 : 2;
  const n = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(n);
}

export function formatMoney(amount: number, code: string): string {
  return `${formatNumber(amount, code)} ${currencySymbol(code)}`;
}

export function computeTotals(doc: EFactDocument): EFactTotals {
  const subtotal = doc.lines.reduce(
    (sum, l) => sum + safeNum(l.quantity) * safeNum(l.unitPrice),
    0,
  );
  const discount = subtotal * (safeNum(doc.discountRate) / 100);
  const total = subtotal - discount;
  return { subtotal, discount, total };
}

function safeNum(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

export function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
}

let lineCounter = 0;
export function newLine(): EFactLine {
  lineCounter += 1;
  return {
    id: `line-${Date.now()}-${lineCounter}`,
    description: "",
    quantity: 1,
    unitPrice: 0,
  };
}

/** Suggested next document number, e.g. FAC-2026-0001 / DEV-… / RP-…. */
export function suggestNumber(kind: DocKind): string {
  const prefix = kind === "facture" ? "FAC" : kind === "devis" ? "DEV" : "RP";
  const year = new Date().getFullYear();
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  return `${prefix}-${year}-${seq}`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ─────────────────────  Amount → French words  ───────────────────── */

const UNITS = [
  "zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit",
  "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize",
  "dix-sept", "dix-huit", "dix-neuf",
];
const TENS = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante", "", "quatre-vingt", ""];

function below100(n: number): string {
  if (n < 20) return UNITS[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  if (t === 7 || t === 9) {
    const base = t === 7 ? "soixante" : "quatre-vingt";
    if (t === 7 && u === 1) return "soixante et onze";
    return `${base}-${UNITS[10 + u]}`;
  }
  const tens = TENS[t];
  if (u === 0) return t === 8 ? "quatre-vingts" : tens;
  if (u === 1 && t !== 8) return `${tens} et un`;
  return `${tens}-${UNITS[u]}`;
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h === 0) return below100(r);
  if (r === 0) return h === 1 ? "cent" : `${UNITS[h]} cents`;
  const hundred = h === 1 ? "cent" : `${UNITS[h]} cent`;
  return `${hundred} ${below100(r)}`;
}

/** Integer (0 … < 1 000 milliards) to French words. */
export function intToWords(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "zéro";
  n = Math.floor(n);
  const scales: { value: number; label: string }[] = [
    { value: 1_000_000_000, label: "milliard" },
    { value: 1_000_000, label: "million" },
    { value: 1_000, label: "mille" },
    { value: 1, label: "" },
  ];
  const parts: string[] = [];
  let rest = n;
  for (const { value, label } of scales) {
    const count = Math.floor(rest / value);
    rest %= value;
    if (count === 0) continue;
    if (label === "mille") {
      parts.push(count === 1 ? "mille" : `${below1000(count)} mille`);
    } else if (label === "") {
      parts.push(below1000(count));
    } else {
      parts.push(`${below1000(count)} ${label}${count > 1 ? "s" : ""}`);
    }
  }
  // "cent"/"vingt" only take a plural -s at the very end of the number:
  // "cinq cents" but "cinq cent mille", "quatre-vingts" but "quatre-vingt mille".
  return parts
    .join(" ")
    .replace(/(cent|vingt)s (mille|millions?|milliards?)/g, "$1 $2")
    .trim();
}

function currencyWords(code: string): {
  sing: string;
  plur: string;
  centSing: string;
  centPlur: string;
} {
  switch (code) {
    case "EUR":
      return { sing: "euro", plur: "euros", centSing: "centime", centPlur: "centimes" };
    case "USD":
      return { sing: "dollar", plur: "dollars", centSing: "cent", centPlur: "cents" };
    case "MAD":
      return { sing: "dirham", plur: "dirhams", centSing: "centime", centPlur: "centimes" };
    case "GHS":
      return { sing: "cedi", plur: "cedis", centSing: "pesewa", centPlur: "pesewas" };
    case "NGN":
      return { sing: "naira", plur: "nairas", centSing: "kobo", centPlur: "kobo" };
    default: // XOF / XAF
      return { sing: "franc CFA", plur: "francs CFA", centSing: "centime", centPlur: "centimes" };
  }
}

/** Human-readable amount, e.g. "Cent cinquante mille francs CFA". */
export function amountToWords(amount: number, code: string): string {
  const { sing, plur, centSing, centPlur } = currencyWords(code);
  const value = Math.max(0, Number.isFinite(amount) ? amount : 0);
  const intPart = Math.floor(value);
  const frac = ZERO_DECIMAL.has(code) ? 0 : Math.round((value - intPart) * 100);

  const unit = intPart >= 2 ? plur : sing;
  // Exact millions/milliards take "de" before the currency: "un million de francs".
  const de = intPart >= 1_000_000 && intPart % 1_000_000 === 0 ? "de " : "";
  let out = `${intToWords(intPart)} ${de}${unit}`;
  if (frac > 0) {
    out += ` et ${intToWords(frac)} ${frac >= 2 ? centPlur : centSing}`;
  }
  return out.charAt(0).toUpperCase() + out.slice(1);
}

function emptyParty(): EFactParty {
  return {
    name: "",
    company: "",
    activity: "",
    address: "",
    phone: "",
    email: "",
    website: "",
    taxId: "",
  };
}

export function createEmptyDocument(): EFactDocument {
  return {
    kind: "facture",
    // Left empty for a deterministic first render (SSR === client). The builder
    // fills a suggested number in a mount effect — Math.random() during render
    // would break hydration.
    number: "",
    issueDate: todayISO(),
    dueDate: plusDaysISO(30),
    currency: "XOF",
    accent: "#16A34A",
    logo: "",
    emitter: emptyParty(),
    client: emptyParty(),
    lines: [newLine()],
    discountRate: 0,
    paymentInfo: "",
    notes: "Merci pour votre confiance.",
    city: "",
    object: "",
    paymentMode: "",
    transactionRef: "",
    amountReceived: 0,
    paymentStatus: "integral",
    remaining: 0,
    signature: "",
  };
}
