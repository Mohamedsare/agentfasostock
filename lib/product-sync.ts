import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto";
import { applyMarkup } from "@/lib/pricing";
import type { PriceMarkupTier, ProductFieldMapping, ProductSource } from "@/lib/types";

/**
 * Product API connector. Pulls an external catalog (e.g.
 * https://srfaso.com/api/v1/products) into the `products` table so the agent's
 * retrieval layer (lib/catalog.ts) sees every product with full details.
 *
 * - Full sync: walks every page, upserts, then deactivates products that
 *   disappeared from the API. Runs on first sync, manually, or once a day.
 * - Incremental sync: `updated_since=<last sync>&sort=updated`, upserts only.
 *
 * The payload shape is auto-detected (common envelopes and field names) and
 * can be overridden per source with a dot-path field mapping.
 */

type Db = ReturnType<typeof createAdminClient>;
type Json = unknown;

const FETCH_TIMEOUT_MS = 20_000;
const MAX_PAGES = 200;
const UPSERT_BATCH = 200;
const FULL_SYNC_EVERY_MS = 24 * 60 * 60 * 1000;
/** Overlap on incremental syncs so clock skew never drops an update. */
const INCREMENTAL_OVERLAP_MS = 5 * 60 * 1000;
const MAX_ATTRIBUTES = 25;
const MAX_PER_PAGE = 500;

export const FASOSTOCK_API_ORIGIN = "https://www.fasostock.com";

/** Friendly French labels for common nested catalog fields. */
const ATTRIBUTE_LABELS: Record<string, string> = {
  packagings: "Conditionnements",
  unit: "Unité",
  promotion: "Promotion",
};

/** Candidate keys tried in order when a field isn't explicitly mapped. */
const AUTO_FIELDS: Record<Exclude<keyof ProductFieldMapping, "items">, string[]> = {
  id: ["id", "uuid", "product_id", "_id", "slug", "sku", "reference"],
  name: ["name", "title", "nom", "label", "designation", "libelle"],
  description: ["description", "short_description", "details", "summary", "desc"],
  price: ["price", "prix", "sale_price", "unit_price", "amount", "selling_price"],
  currency: ["currency", "devise", "currency_code"],
  images: ["images", "image_urls", "photos", "gallery", "pictures", "image", "image_url", "thumbnail", "photo", "cover"],
  // Not "barcode"/"code": internal barcodes (e.g. FasoStock "FS-…") mean nothing to a client.
  sku: ["sku", "reference", "ref"],
  category: ["category", "categorie", "category_name", "categories", "type"],
  brand: ["brand", "marque", "manufacturer"],
  stock: ["stock", "stock_quantity", "quantity", "qty", "inventory", "quantite"],
  in_stock: ["in_stock", "available", "is_available", "disponible", "instock"],
  url: ["url", "permalink", "link", "product_url", "href"],
};

const ITEM_ENVELOPES = ["data", "items", "products", "results", "records", "rows", "docs"];

/** Keys already mapped or pure noise — excluded from `attributes`. */
const ATTRIBUTE_BLACKLIST = new Set([
  ...Object.values(AUTO_FIELDS).flat(),
  "created_at", "updated_at", "deleted_at", "createdAt", "updatedAt",
  "barcode", "code", "ean", "gtin", "sale_price",
]);

export interface NormalizedProduct {
  external_id: string;
  name: string;
  description: string | null;
  /** Selling price (API price + markup) — the only price the agent sees. */
  price: number | null;
  /** Price as returned by the supplier API. */
  cost_price: number | null;
  currency: string;
  images: string[];
  sku: string | null;
  category: string | null;
  brand: string | null;
  stock_quantity: number | null;
  in_stock: boolean | null;
  product_url: string | null;
  attributes: Record<string, string | number | boolean>;
}

export interface SyncResult {
  ok: boolean;
  mode: "full" | "incremental";
  fetched: number;
  upserted: number;
  deactivated: number;
  pages: number;
  error?: string;
}

// ─────────────────────────── JSON helpers ───────────────────────────

function getPath(obj: Json, path: string): Json {
  let cur: Json = obj;
  for (const key of path.split(".").filter(Boolean)) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, Json>)[key];
  }
  return cur;
}

function pick(item: Json, mapped: string | undefined, candidates: string[]): Json {
  if (mapped?.trim()) return getPath(item, mapped.trim());
  for (const key of candidates) {
    const v = getPath(item, key);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function asText(v: Json): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const parts = v.map(asText).filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof v === "object") {
    // { name: "Moteur" } / { title: … } / { label: … }
    const o = v as Record<string, Json>;
    return asText(o.name ?? o.title ?? o.label ?? o.nom ?? null);
  }
  return null;
}

function asNumber(v: Json): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[\s ]/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, Json>;
    return asNumber(o.amount ?? o.value ?? null);
  }
  return null;
}

function asBool(v: Json): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v > 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "yes", "oui", "in_stock", "instock", "available", "disponible"].includes(s)) return true;
    if (["false", "0", "no", "non", "out_of_stock", "outofstock", "unavailable", "rupture"].includes(s)) return false;
  }
  return null;
}

function asImages(v: Json, baseUrl: string): string[] {
  const list = Array.isArray(v) ? v : v == null ? [] : [v];
  const urls: string[] = [];
  for (const entry of list) {
    const raw =
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object"
          ? asText((entry as Record<string, Json>).url ?? (entry as Record<string, Json>).src ?? (entry as Record<string, Json>).original ?? null)
          : null;
    if (!raw) continue;
    try {
      // Resolve relative paths ("/uploads/x.jpg") against the API origin.
      const abs = new URL(raw, baseUrl).toString();
      if (abs.startsWith("http")) urls.push(abs);
    } catch {
      /* skip malformed URL */
    }
  }
  return [...new Set(urls)].slice(0, 10);
}

/** Flatten remaining scalar fields (compatibility, dimensions…) into attributes. */
function extraAttributes(item: Json): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!item || typeof item !== "object" || Array.isArray(item)) return out;
  for (const [key, value] of Object.entries(item as Record<string, Json>)) {
    if (Object.keys(out).length >= MAX_ATTRIBUTES) break;
    if (ATTRIBUTE_BLACKLIST.has(key)) continue;
    const label = ATTRIBUTE_LABELS[key] ?? key;
    if (typeof value === "number" || typeof value === "boolean") out[label] = value;
    else if (typeof value === "string" && value.trim() && value.length <= 300) out[label] = value.trim();
    else if (Array.isArray(value) && value.length && value.every((x) => typeof x === "string" || typeof x === "number")) {
      const joined = value.join(", ");
      if (joined.length <= 300) out[label] = joined;
    } else if (Array.isArray(value) && value.length && value.every((x) => x && typeof x === "object" && !Array.isArray(x))) {
      // e.g. packagings: [{ label: "Carton", quantity: 10, price: 500000, unit_price: 50000 }]
      const summary = value
        .slice(0, 6)
        .map((x) => describeObject(x as Record<string, Json>))
        .filter(Boolean)
        .join(" | ");
      if (summary) out[label] = summary.slice(0, 500);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      // One level of nesting, e.g. specs: { puissance: "125cc" }
      for (const [k2, v2] of Object.entries(value as Record<string, Json>)) {
        if (Object.keys(out).length >= MAX_ATTRIBUTES) break;
        if (k2 === "id") continue;
        if (typeof v2 === "string" || typeof v2 === "number" || typeof v2 === "boolean") {
          out[`${label}.${k2}`] = typeof v2 === "string" ? v2.slice(0, 300) : v2;
        }
      }
    }
  }
  return out;
}

/** 500000 → "500 000" (plain spaces: WhatsApp-safe). */
function groupDigits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** One-line description of a nested object: "Carton de 10 : 500 000 (soit 50 000/pièce)". */
function describeObject(o: Record<string, Json>): string | null {
  const label = asText(o.label ?? o.name ?? o.title ?? null);
  const qty = asNumber(o.quantity ?? o.qty ?? null);
  const price = asNumber(o.price ?? null);
  const unitPrice = asNumber(o.unit_price ?? null);
  if (label || qty != null || price != null) {
    return [
      label,
      qty != null ? `de ${qty}` : null,
      price != null ? `: ${groupDigits(price)}` : null,
      unitPrice != null ? `(soit ${groupDigits(unitPrice)}/pièce)` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }
  const parts = Object.entries(o)
    .filter(([k, v]) => k !== "id" && (typeof v === "string" || typeof v === "number"))
    .map(([k, v]) => `${k}: ${v}`);
  return parts.length ? parts.join(", ") : null;
}

export function extractItems(payload: Json, mapping: ProductFieldMapping): Json[] {
  if (mapping.items?.trim()) {
    const v = getPath(payload, mapping.items.trim());
    return Array.isArray(v) ? v : [];
  }
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    for (const key of ITEM_ENVELOPES) {
      const v = (payload as Record<string, Json>)[key];
      if (Array.isArray(v)) return v;
      // { data: { items: [...] } }
      if (v && typeof v === "object") {
        for (const inner of ITEM_ENVELOPES) {
          const w = (v as Record<string, Json>)[inner];
          if (Array.isArray(w)) return w;
        }
      }
    }
  }
  return [];
}

/**
 * Packaging prices at selling price: the markup applies PER PIECE (a carton of
 * 10 at 15 000/piece → 18 000/piece → carton 180 000).
 */
function withMarkedUpPackagings(item: Json, markup: PriceMarkupTier[] | null | undefined): Json {
  if (!markup?.length || !item || typeof item !== "object" || Array.isArray(item)) return item;
  const packagings = (item as Record<string, Json>).packagings;
  if (!Array.isArray(packagings)) return item;
  return {
    ...(item as Record<string, Json>),
    packagings: packagings.map((p) => {
      if (!p || typeof p !== "object") return p;
      const o = p as Record<string, Json>;
      const qty = asNumber(o.quantity ?? o.qty ?? null);
      const total = asNumber(o.price ?? null);
      const unitCost = asNumber(o.unit_price ?? null) ?? (qty && total != null ? total / qty : null);
      if (unitCost == null) return o;
      const unit = applyMarkup(unitCost, markup) as number;
      return { ...o, unit_price: unit, ...(qty ? { price: Math.round(unit * qty) } : {}) };
    }),
  };
}

export function normalizeProduct(
  item: Json,
  mapping: ProductFieldMapping,
  baseUrl: string,
  /** Currency declared once on the response envelope (e.g. FasoStock `currency`). */
  defaultCurrency = "XOF",
  /** Selling markup tiers of the source (lib/pricing.ts). */
  markup: PriceMarkupTier[] | null = null,
): NormalizedProduct | null {
  const name = asText(pick(item, mapping.name, AUTO_FIELDS.name));
  const externalId = asText(pick(item, mapping.id, AUTO_FIELDS.id)) ?? name;
  if (!name || !externalId) return null;

  const stock = asNumber(pick(item, mapping.stock, AUTO_FIELDS.stock));
  const inStockRaw = asBool(pick(item, mapping.in_stock, AUTO_FIELDS.in_stock));
  const url = asText(pick(item, mapping.url, AUTO_FIELDS.url));
  const costPrice = asNumber(pick(item, mapping.price, AUTO_FIELDS.price));
  const price = applyMarkup(costPrice, markup);
  const attributes = extraAttributes(withMarkedUpPackagings(item, markup));
  // `price` is today's price (promotion applied); keep the catalog price so the agent can mention the discount.
  const catalogPrice = asNumber(getPath(item, "sale_price") ?? null);
  if (catalogPrice != null && costPrice != null && catalogPrice > costPrice) {
    attributes["Prix catalogue (avant promotion)"] = applyMarkup(catalogPrice, markup) as number;
  }

  return {
    external_id: externalId.slice(0, 200),
    name: name.slice(0, 300),
    description: asText(pick(item, mapping.description, AUTO_FIELDS.description))?.slice(0, 4000) ?? null,
    price,
    cost_price: costPrice,
    currency: (asText(pick(item, mapping.currency, AUTO_FIELDS.currency)) ?? defaultCurrency).toUpperCase().slice(0, 8),
    images: asImages(pick(item, mapping.images, AUTO_FIELDS.images), baseUrl),
    sku: asText(pick(item, mapping.sku, AUTO_FIELDS.sku)),
    category: asText(pick(item, mapping.category, AUTO_FIELDS.category)),
    brand: asText(pick(item, mapping.brand, AUTO_FIELDS.brand)),
    stock_quantity: stock != null ? Math.round(stock) : null,
    in_stock: inStockRaw ?? (stock != null ? stock > 0 : null),
    product_url: url ? safeAbsolute(url, baseUrl) : null,
    attributes,
  };
}

function safeAbsolute(url: string, base: string): string | null {
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

// ─────────────────────────── HTTP ───────────────────────────

/** Reject non-http(s) and obvious internal targets (basic SSRF guard). */
export function validateSourceUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "URL invalide.";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "L'URL doit commencer par https://";
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "[::1]"
  ) {
    return "Adresse interne non autorisée.";
  }
  return null;
}

interface FetchCtx {
  source: Pick<
    ProductSource,
    "base_url" | "auth_type" | "auth_key_name" | "default_query" | "per_page" | "pagination_style" | "price_markup"
  >;
  apiKey: string | null;
}

function buildUrl(ctx: FetchCtx, params: Record<string, string>): string {
  const url = new URL(ctx.source.base_url);
  if (ctx.source.default_query) {
    const extra = new URLSearchParams(ctx.source.default_query.replace(/^\?/, ""));
    extra.forEach((v, k) => url.searchParams.set(k, v));
  }
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (ctx.source.auth_type === "query" && ctx.apiKey) {
    url.searchParams.set(ctx.source.auth_key_name || "api_key", ctx.apiKey);
  }
  return url.toString();
}

function buildHeaders(ctx: FetchCtx): HeadersInit {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (ctx.apiKey) {
    if (ctx.source.auth_type === "bearer") headers.Authorization = `Bearer ${ctx.apiKey}`;
    if (ctx.source.auth_type === "header") headers[ctx.source.auth_key_name || "X-API-Key"] = ctx.apiKey;
  }
  return headers;
}

async function fetchJson(url: string, headers: HeadersInit, attempt = 1): Promise<Json> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal, cache: "no-store", redirect: "follow" });
    if ((res.status >= 500 || res.status === 429) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 800 * attempt));
      return fetchJson(url, headers, attempt + 1);
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    }
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("json")) {
      throw new Error(`Réponse non JSON (${type || "type inconnu"}) — vérifiez l'URL de l'API.`);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      if (attempt < 2) return fetchJson(url, headers, attempt + 1);
      throw new Error("Délai dépassé en contactant l'API.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** True when the payload says there's no next page (common pagination shapes). */
function isLastPage(payload: Json, page: number, itemCount: number, perPage: number): boolean {
  if (itemCount === 0) return true;
  const meta = (payload && typeof payload === "object" ? payload : {}) as Record<string, Json>;
  const containers = [meta, meta.meta, meta.pagination, (meta.meta as Record<string, Json> | undefined)?.pagination]
    .filter((c): c is Record<string, Json> => Boolean(c) && typeof c === "object");

  for (const c of containers) {
    const last = asNumber(c.last_page ?? c.total_pages ?? c.totalPages ?? c.pages ?? null);
    if (last != null) return page >= last;
    if ("has_more" in c || "hasMore" in c) return !asBool(c.has_more ?? c.hasMore);
    if ("next_page_url" in c) return !c.next_page_url;
    if ("next" in c && (c.next === null || typeof c.next === "string")) return !c.next;
  }
  const links = meta.links as Record<string, Json> | undefined;
  if (links && typeof links === "object" && !Array.isArray(links) && "next" in links) return !links.next;
  return itemCount < perPage;
}

/**
 * Walk the API page by page. `onPage` receives normalized products for each
 * page so large catalogs are written incrementally instead of held in memory.
 */
async function walkPages(
  ctx: FetchCtx,
  mapping: ProductFieldMapping,
  params: Record<string, string>,
  onPage: (items: NormalizedProduct[]) => Promise<void>,
): Promise<{ pages: number; fetched: number }> {
  const perPage = clampPerPage(ctx.source.per_page);
  const headers = buildHeaders(ctx);
  let style: PaginationStyle | null = ctx.source.pagination_style === "auto" ? null : ctx.source.pagination_style;
  let fetched = 0;
  let offset = 0;
  let page = 1;
  let previousFirstId: string | null = null;
  for (; page <= MAX_PAGES; page++) {
    const payload = await fetchJson(
      buildUrl(ctx, { ...params, ...paginationParams(style, page, offset, perPage) }),
      headers,
    );
    style ??= detectPagination(payload);
    const raw = extractItems(payload, mapping);
    if (page === 1 && raw.length === 0 && !Array.isArray(payload) && !mapping.items) {
      const keys = payload && typeof payload === "object" ? Object.keys(payload as object).join(", ") : typeof payload;
      // An empty first page is legitimate; only flag it when no known envelope exists.
      if (!ITEM_ENVELOPES.some((k) => k in ((payload as object) ?? {}))) {
        throw new Error(`Liste de produits introuvable dans la réponse (clés : ${keys}). Renseignez le chemin "items" dans le mapping.`);
      }
    }
    const currency = envelopeCurrency(payload);
    const normalized = raw
      .map((item) => normalizeProduct(item, mapping, ctx.source.base_url, currency, ctx.source.price_markup))
      .filter((p): p is NormalizedProduct => p !== null);
    // An API that ignores our pagination params returns the first page forever — stop instead of looping.
    const firstId = normalized[0]?.external_id ?? null;
    if (page > 1 && firstId && firstId === previousFirstId) break;
    previousFirstId = firstId;
    fetched += normalized.length;
    if (normalized.length) await onPage(normalized);
    if (isLastPage(payload, page, raw.length, perPage)) break;
    const nextOffset = asNumber(getPath(payload, "next_offset") ?? getPath(payload, "meta.next_offset") ?? null);
    offset = nextOffset != null && nextOffset > offset ? nextOffset : offset + raw.length;
  }
  return { pages: Math.min(page, MAX_PAGES), fetched };
}

type PaginationStyle = "page" | "offset";

function clampPerPage(n: number | null | undefined): number {
  return Math.min(Math.max(n || 50, 1), MAX_PER_PAGE);
}

function paginationParams(
  style: PaginationStyle | null,
  page: number,
  offset: number,
  perPage: number,
): Record<string, string> {
  const byPage = { page: String(page), per_page: String(perPage) };
  const byOffset = { limit: String(perPage), offset: String(offset) };
  if (style === "page") return byPage;
  if (style === "offset") return byOffset;
  // Auto, first request: send both until the response reveals which one the API uses.
  return { ...byPage, ...byOffset };
}

function detectPagination(payload: Json): PaginationStyle {
  const offsetKeys = ["next_offset", "offset", "meta.offset", "meta.next_offset", "pagination.offset"];
  return offsetKeys.some((p) => getPath(payload, p) !== undefined) ? "offset" : "page";
}

function envelopeCurrency(payload: Json): string | undefined {
  if (Array.isArray(payload)) return undefined;
  return asText(getPath(payload, "currency") ?? getPath(payload, "meta.currency") ?? null) ?? undefined;
}

// ─────────────────────────── FasoStock ───────────────────────────

export interface FasostockStore {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  is_primary: boolean;
  products_url: string;
}

/** List the stores a FasoStock API key can read (GET /api/v1/stores). */
export async function fetchFasostockStores(
  apiKey: string,
): Promise<{ company: string | null; stores: FasostockStore[] }> {
  const payload = await fetchJson(`${FASOSTOCK_API_ORIGIN}/api/v1/stores`, {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  });
  const stores = extractItems(payload, { items: "stores" })
    .map((s) => {
      const o = (s ?? {}) as Record<string, Json>;
      const id = asText(o.id ?? null);
      if (!id) return null;
      return {
        id,
        name: asText(o.name ?? null) ?? id,
        code: asText(o.code ?? null),
        address: asText(o.address ?? null),
        is_primary: o.is_primary === true,
        products_url: `${FASOSTOCK_API_ORIGIN}/api/v1/stores/${encodeURIComponent(id)}/products`,
      };
    })
    .filter((s): s is FasostockStore => s !== null);
  return { company: asText(getPath(payload, "company.name") ?? null), stores };
}

// ─────────────────────────── Public API ───────────────────────────

/** Fetch the first page only and return normalized samples — used by "Tester". */
export async function previewSource(
  source: FetchCtx["source"] & { field_mapping: ProductFieldMapping },
  apiKey: string | null,
): Promise<{ total: number; samples: NormalizedProduct[]; rawKeys: string[] }> {
  const invalid = validateSourceUrl(source.base_url);
  if (invalid) throw new Error(invalid);
  const ctx: FetchCtx = { source, apiKey };
  const style = source.pagination_style === "auto" ? null : source.pagination_style;
  const payload = await fetchJson(
    buildUrl(ctx, paginationParams(style, 1, 0, Math.min(clampPerPage(source.per_page), 50))),
    buildHeaders(ctx),
  );
  const raw = extractItems(payload, source.field_mapping);
  const first = raw[0];
  const currency = envelopeCurrency(payload);
  // Prefer the API's declared total (e.g. FasoStock `total`) over the first page size.
  const declaredTotal = asNumber(getPath(payload, "total") ?? getPath(payload, "meta.total") ?? null);
  return {
    total: declaredTotal ?? raw.length,
    samples: raw
      .slice(0, 5)
      .map((i) => normalizeProduct(i, source.field_mapping, source.base_url, currency, source.price_markup))
      .filter((p): p is NormalizedProduct => p !== null),
    rawKeys: first && typeof first === "object" ? Object.keys(first as object) : [],
  };
}

async function upsertBatch(db: Db, source: ProductSource, items: NormalizedProduct[], seen: Set<string>) {
  const now = new Date().toISOString();
  for (let i = 0; i < items.length; i += UPSERT_BATCH) {
    const rows = items.slice(i, i + UPSERT_BATCH).map((p) => {
      seen.add(p.external_id);
      return {
        agent_id: source.agent_id,
        source: "api",
        source_id: source.id,
        ...p,
        is_active: true,
        synced_at: now,
      };
    });
    // Deduplicate within the batch — Postgres rejects an upsert touching a row twice.
    const unique = [...new Map(rows.map((r) => [r.external_id, r])).values()];
    let { error } = await db.from("products").upsert(unique, { onConflict: "source_id,external_id" });
    if (error && /cost_price/.test(error.message)) {
      // Migration 0016 not applied yet: keep syncing without the supplier price column.
      const withoutCost = unique.map((r) => {
        const copy: Record<string, unknown> = { ...r };
        delete copy.cost_price;
        return copy;
      });
      ({ error } = await db.from("products").upsert(withoutCost, { onConflict: "source_id,external_id" }));
    }
    if (error) throw new Error(`Écriture Supabase : ${error.message}`);
  }
}

/** Deactivate API products of this source that the full sync no longer saw. */
async function deactivateMissing(db: Db, sourceId: string, seen: Set<string>): Promise<number> {
  const existing: { id: string; external_id: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("products")
      .select("id, external_id")
      .eq("source_id", sourceId)
      .eq("is_active", true)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    existing.push(...((data as { id: string; external_id: string }[]) ?? []));
    if (!data || data.length < 1000) break;
  }
  const stale = existing.filter((p) => !seen.has(p.external_id)).map((p) => p.id);
  for (let i = 0; i < stale.length; i += 200) {
    await db.from("products").update({ is_active: false }).in("id", stale.slice(i, i + 200));
  }
  return stale.length;
}

/** Sync one source. `mode` defaults to full when due (first run or > 24h), else incremental. */
export async function syncProductSource(
  sourceId: string,
  opts: { mode?: "full" | "incremental" } = {},
): Promise<SyncResult> {
  const db = createAdminClient();
  const { data: row, error } = await db.from("product_sources").select("*").eq("id", sourceId).single();
  if (error || !row) {
    return { ok: false, mode: "full", fetched: 0, upserted: 0, deactivated: 0, pages: 0, error: "Source introuvable." };
  }
  const source = row as ProductSource;

  const lastFull = source.last_full_sync_at ? new Date(source.last_full_sync_at).getTime() : 0;
  // Incremental sync needs a "changed since" filter on the API; without one every run is a full sync.
  const mode = !source.incremental_param
    ? "full"
    : opts.mode ?? (!source.last_sync_at || Date.now() - lastFull > FULL_SYNC_EVERY_MS ? "full" : "incremental");

  const startedAt = new Date();
  await db.from("product_sources").update({ last_sync_status: "running", last_sync_error: null }).eq("id", source.id);

  const result: SyncResult = { ok: true, mode, fetched: 0, upserted: 0, deactivated: 0, pages: 0 };
  try {
    const invalid = validateSourceUrl(source.base_url);
    if (invalid) throw new Error(invalid);

    const apiKey = decryptSecret(source.api_key_encrypted);
    const ctx: FetchCtx = { source, apiKey };
    const params: Record<string, string> = {};
    if (mode === "incremental" && source.incremental_param && source.last_sync_at) {
      const since = new Date(new Date(source.last_sync_at).getTime() - INCREMENTAL_OVERLAP_MS);
      params[source.incremental_param] = since.toISOString().replace(/\.\d{3}Z$/, "Z");
    }

    const seen = new Set<string>();
    const walked = await walkPages(ctx, source.field_mapping ?? {}, params, (items) =>
      upsertBatch(db, source, items, seen),
    );
    result.pages = walked.pages;
    result.fetched = walked.fetched;
    result.upserted = seen.size;

    if (mode === "full") {
      // Guard: an empty full sync is far more likely an API glitch than a
      // wiped catalog — never deactivate everything on it.
      if (seen.size > 0) result.deactivated = await deactivateMissing(db, source.id, seen);
    }

    await db
      .from("product_sources")
      .update({
        last_sync_status: "success",
        last_sync_error: null,
        last_sync_at: startedAt.toISOString(),
        ...(mode === "full" ? { last_full_sync_at: startedAt.toISOString() } : {}),
        last_sync_count: mode === "full" ? seen.size : source.last_sync_count,
      })
      .eq("id", source.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Échec de synchronisation.";
    console.error(`[product-sync] source ${source.id} failed:`, message);
    result.ok = false;
    result.error = message;
    await db
      .from("product_sources")
      .update({ last_sync_status: "error", last_sync_error: message.slice(0, 500) })
      .eq("id", source.id);
  }
  return result;
}

/** Cron entry: sync every active source whose interval has elapsed. */
export async function syncDueProductSources(
  opts: { agentId?: string } = {},
): Promise<{ checked: number; synced: number; failed: number }> {
  const db = createAdminClient();
  let query = db
    .from("product_sources")
    .select("id, last_sync_at, sync_interval_minutes, last_sync_status, updated_at")
    .eq("is_active", true);
  if (opts.agentId) query = query.eq("agent_id", opts.agentId);
  const { data } = await query;
  const rows = (data as Pick<ProductSource, "id" | "last_sync_at" | "sync_interval_minutes" | "last_sync_status" | "updated_at">[]) ?? [];

  const now = Date.now();
  const due = rows.filter((s) => {
    // Skip a sync still running unless it looks stuck (> 15 min).
    if (s.last_sync_status === "running" && now - new Date(s.updated_at).getTime() < 15 * 60 * 1000) return false;
    if (!s.last_sync_at) return true;
    return now - new Date(s.last_sync_at).getTime() >= Math.max(s.sync_interval_minutes, 10) * 60 * 1000;
  });

  let synced = 0;
  let failed = 0;
  for (const s of due) {
    const res = await syncProductSource(s.id);
    if (res.ok) synced++;
    else failed++;
  }
  return { checked: rows.length, synced, failed };
}
