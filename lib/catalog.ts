import type { KnowledgeBaseEntry, Product } from "@/lib/types";

/**
 * Deterministic retrieval layer for the agent's knowledge base and product
 * catalog.
 *
 * The naive approach dumps every active product and knowledge entry into the
 * system prompt on every turn. That scales badly: token cost and latency grow
 * with the catalog, and long flat lists make the model "lose" the right item
 * (the classic lost-in-the-middle failure — a client asks for "amortisseur 115"
 * and gets the wrong reference or a hallucinated one).
 *
 * Instead we rank items against what the client is actually asking about (the
 * recent conversation text) and inject only the relevant ones in full detail.
 * Small catalogs also get a name-only index; large ones (API-synced, hundreds
 * of references) get a category overview instead, and the model can query the
 * full catalog itself through the `search_products` tool (lib/ai.ts), which
 * uses the same ranking via searchProducts().
 *
 * Ranking: normalized token overlap weighted by IDF (a word present in half the
 * catalog, like "original", barely counts; a rare word or a reference number is
 * decisive), with typo tolerance ("albracam" → "albracame", "amortiseur" →
 * "amortisseur") and alphanumeric splitting ("F150" matches "F 150"). No
 * embeddings / pgvector: cheap, no infra dependency, and well suited to a parts
 * catalog where exact references and numbers are the decisive signal.
 */

/** Below this many active items, ranking adds no value — inject everything. */
export const FULL_DUMP_MAX_PRODUCTS = 25;
export const FULL_DUMP_MAX_KNOWLEDGE = 20;

/** Max items shown in full detail when the catalog is large enough to filter. */
export const TOP_PRODUCTS = 10;
export const TOP_KNOWLEDGE = 8;

/** Above this many active products, the name-only index becomes a category overview. */
export const NAME_INDEX_MAX = 120;

/** Products scoring below this share of the best match are noise, not alternatives. */
const RELATIVE_SCORE_FLOOR = 0.35;

/** French stopwords + filler that carry no retrieval signal. */
const STOPWORDS = new Set([
  "le", "la", "les", "un", "une", "des", "du", "de", "d", "l", "et", "ou", "a",
  "au", "aux", "en", "dans", "sur", "pour", "par", "avec", "sans", "ce", "cet",
  "cette", "ces", "que", "qui", "quoi", "est", "sont", "avez", "vous", "je",
  "tu", "il", "elle", "on", "nous", "ils", "elles", "me", "te", "se", "mon",
  "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "bonjour", "salut",
  "svp", "stp", "merci", "prix", "combien", "photo", "photos", "image",
  "images", "produit", "produits", "article", "articles", "voir", "envoie",
  "envoyer", "envoi", "montre", "montrer", "the", "of", "to", "is",
  "bonsoir", "ca", "cest", "ya", "veux", "voudrais", "cherche", "besoin",
  "faut", "avoir", "as", "quel", "quelle", "quels", "quelles", "coute",
  "cout", "tarif", "dispo", "disponible", "vend", "vendez", "reste", "aussi",
  "encore", "ok", "oui", "non", "bien", "peux", "pouvez", "moi", "votre",
  "vos", "notre", "nos", "leur", "leurs", "comme", "tout", "tous", "fait",
  "piece", "pieces", "autre", "autres", "dautre", "dautres", "model", "modele", "modeles",
]);

/** Abbreviations used in parts catalogs, matched as the full word too. */
const ABBREVIATIONS: Record<string, string> = {
  av: "avant",
  ar: "arriere",
  arr: "arriere",
};

/**
 * French phonetic key, so words that SOUND the same match even when spelled
 * differently — on the client side ("bouji", "plakette", "compteur") and on the
 * catalog side, which is itself often misspelled ("CONTEUR", "DISQUAIR",
 * "ESSANCE"). "bougie" and "bouji" → "buji"; "compteur" and "conteur" → "konteur".
 * Input: a normalized alphabetic token (lowercase, no accents).
 */
export function phoneticKey(word: string): string {
  let w = word
    .replace(/ph/g, "f")
    .replace(/x/g, "ks")
    .replace(/s?[cs]h/g, "X") // ch/sh/sch sound (placeholder)
    .replace(/qu/g, "k")
    .replace(/ck/g, "k")
    .replace(/gu(?=[eiy])/g, "g")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/g(?=[eiy])/g, "j")
    .replace(/[cq]/g, "k")
    .replace(/eau|au/g, "o")
    .replace(/oo|ou/g, "u")
    .replace(/[ae]i[nm](?![aeiou])/g, "in")
    .replace(/y/g, "i")
    .replace(/[ae][nm](?![aeiou])/g, "an")
    .replace(/om(?![aeiou])/g, "on")
    .replace(/ai|ei/g, "e")
    .replace(/(?:er|ez|et)$/, "e")
    .replace(/h/g, "")
    .replace(/z/g, "s")
    .replace(/w/g, "v")
    .replace(/(.)\1+/g, "$1");
  // Silent endings: "pose" ≈ "pos", "pieds" ≈ "pied", "arriere" ≈ "arrier".
  if (w.length > 3) w = w.replace(/e$/, "");
  if (w.length > 3) w = w.replace(/[stdx]$/, "");
  return w;
}

/**
 * Normalize French text for matching: lowercase, strip diacritics, and replace
 * any non-alphanumeric run with a single space. "Amortisseur N°115 (avant)"
 * → "amortisseur n 115 avant".
 */
export function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Split normalized text into significant tokens. Numeric tokens are always
 * kept (part references like "115" are decisive); short/stopword alpha tokens
 * are dropped. Mixed tokens are also split ("f150" → "f150", "150") so "F150"
 * and "F 150" match. A crude singular fold ("amortisseurs" → "amortisseur")
 * lets plural queries match singular catalog names.
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  for (const raw of normalizeText(input).split(" ")) {
    if (!raw) continue;
    const parts = /[a-z]/.test(raw) && /\d/.test(raw) ? [raw, ...(raw.match(/[a-z]+|\d+/g) ?? [])] : [raw];
    for (const part of parts) {
      if (/^\d+$/.test(part)) {
        tokens.push(part);
        continue;
      }
      if (part.length < 2 || STOPWORDS.has(part)) continue;
      tokens.push(foldSingular(part));
      const expansion = ABBREVIATIONS[part];
      if (expansion) tokens.push(expansion);
    }
  }
  return tokens;
}

/** Drop a trailing plural "s"/"x" on longer words so plural queries match. */
function foldSingular(word: string): string {
  if (word.length > 3 && (word.endsWith("s") || word.endsWith("x"))) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * Build the retrieval query from the recent conversation. The client's own
 * messages matter most (the latest one is weighted double — it's the current
 * request). The agent's last message is included once: it often names the
 * product under discussion, so a follow-up like "ok je prends 2" or "et en
 * carton ?" keeps that product in view.
 */
export function buildQueryTokens(
  messages: { role: "user" | "assistant"; content: string }[],
): string[] {
  const userMessages = messages.filter((m) => m.role === "user");
  const recent = userMessages.slice(-3);
  const tokens: string[] = [];
  recent.forEach((m, idx) => {
    const isLatest = idx === recent.length - 1;
    const t = tokenize(m.content);
    tokens.push(...t, ...(isLatest ? t : []));
  });
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  if (lastAssistant) tokens.push(...tokenize(lastAssistant.content));
  return tokens;
}

// ─────────────────────────── Product index ───────────────────────────

interface IndexedProduct {
  product: Product;
  /** Name + SKU tokens — the decisive fields. */
  primary: Set<string>;
  /** Category + brand tokens. */
  meta: Set<string>;
  /** Description + attribute tokens — weak signal. */
  body: Set<string>;
}

interface ProductIndex {
  items: IndexedProduct[];
  df: Map<string, number>;
  vocab: string[];
  /** Phonetic key of each vocabulary token. */
  phonetic: Map<string, string>;
  byId: Map<string, IndexedProduct>;
  /** Per query token: matching vocabulary tokens with a similarity in (0, 1]. */
  expansions: Map<string, Map<string, number>>;
  /** Per query token: IDF of all its spellings together. */
  conceptIdf: Map<string, number>;
}

const indexCache = new WeakMap<Product[], ProductIndex>();

/** Index active products once per catalog array (reused by prompt + tool calls). */
function getIndex(products: Product[]): ProductIndex {
  const cached = indexCache.get(products);
  if (cached) return cached;

  const df = new Map<string, number>();
  const items: IndexedProduct[] = [];
  for (const product of products) {
    if (!product.is_active) continue;
    const primary = new Set(tokenize(`${product.name} ${product.sku ?? ""}`));
    const meta = new Set(tokenize(`${product.category ?? ""} ${product.brand ?? ""}`));
    const body = new Set(
      tokenize(`${product.description ?? ""} ${Object.values(product.attributes ?? {}).join(" ")}`),
    );
    for (const t of new Set([...primary, ...meta, ...body])) df.set(t, (df.get(t) ?? 0) + 1);
    items.push({ product, primary, meta, body });
  }
  const vocab = [...df.keys()];
  const index: ProductIndex = {
    items,
    df,
    vocab,
    phonetic: new Map(vocab.map((t) => [t, phoneticKey(t)])),
    byId: new Map(items.map((i) => [i.product.id, i])),
    expansions: new Map(),
    conceptIdf: new Map(),
  };
  indexCache.set(products, index);
  return index;
}

/**
 * Inverse document frequency of what the client MEANT by a query token: all its
 * spellings count together. Otherwise a rare misspelling in the catalog
 * ("NANO SIRUS", 1 product) would outweigh the common correct word ("SIRIUS",
 * 50 products) and win the ranking on a typo alone.
 */
function conceptIdf(index: ProductIndex, q: string): number {
  const cached = index.conceptIdf.get(q);
  if (cached !== undefined) return cached;
  let df = 0;
  for (const v of expand(index, q).keys()) df += index.df.get(v) ?? 0;
  const value = Math.log(1 + index.items.length / (1 + Math.min(df, index.items.length)));
  index.conceptIdf.set(q, value);
  return value;
}

/**
 * Edit distance counting an adjacent swap as ONE typo ("siruis" → "sirius",
 * "frien" → "frein"), with an early exit once `max` is exceeded.
 */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let prevMin = 0;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      rowMin = Math.min(rowMin, v);
    }
    // A swap can reach back two rows, so only stop when both rows are out of range.
    if (rowMin > max && prevMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
    prevMin = rowMin;
  }
  return prev[b.length];
}

/**
 * Catalog tokens a query token should match. Numbers and references match
 * exactly only (a "115" is not a "110"). Words also match — on either side —
 * the same sound ("bouji" ≈ "bougie"), a prefix ("amort" ≈ "amortisseur"), a
 * close typo or swap ("frien" ≈ "frein"), or a close sound ("siruis" ≈ "sirius").
 */
function expand(index: ProductIndex, q: string): Map<string, number> {
  const cached = index.expansions.get(q);
  if (cached) return cached;
  const out = new Map<string, number>();
  if (index.df.has(q)) out.set(q, 1);
  if (!/\d/.test(q) && q.length >= 3) {
    const qKey = phoneticKey(q);
    const maxEdits = q.length >= 7 ? 2 : q.length >= 4 ? 1 : 0;
    const maxKeyEdits = qKey.length >= 6 ? 2 : qKey.length >= 4 ? 1 : 0;
    for (const v of index.vocab) {
      if (v === q || /\d/.test(v) || v.length < 3) continue;
      const vKey = index.phonetic.get(v) ?? phoneticKey(v);
      let similarity = 0;
      if (qKey.length >= 2 && vKey === qKey) {
        similarity = 0.85; // same sound
      } else if (q.length >= 4 && v.length >= 4 && (v.startsWith(q) || q.startsWith(v)) && Math.abs(v.length - q.length) <= 3) {
        similarity = 0.8; // prefix / truncated word
      } else if (maxEdits > 0 && v.length >= 4 && editDistance(q, v, maxEdits) <= maxEdits) {
        similarity = 0.75; // typo or swapped letters
      } else if (maxKeyEdits > 0 && v.length >= 4 && editDistance(qKey, vKey, maxKeyEdits) <= maxKeyEdits) {
        similarity = 0.7; // close sound
      }
      if (similarity > (out.get(v) ?? 0)) out.set(v, similarity);
    }
  }
  index.expansions.set(q, out);
  return out;
}

function weightsOf(tokens: string[]): Map<string, number> {
  const weights = new Map<string, number>();
  for (const t of tokens) weights.set(t, Math.min((weights.get(t) ?? 0) + 1, 3));
  return weights;
}

function scoreIndexed(index: ProductIndex, item: IndexedProduct, weights: Map<string, number>): number {
  let score = 0;
  let matched = 0;
  for (const [q, weight] of weights) {
    const numeric = /^\d+$/.test(q);
    let best = 0;
    const qIdf = conceptIdf(index, q);
    for (const [v, similarity] of expand(index, q)) {
      const w = qIdf * similarity;
      const s = item.primary.has(v) ? (numeric ? 5 : 3) * w : item.meta.has(v) ? 2 * w : item.body.has(v) ? w : 0;
      if (s > best) best = s;
    }
    if (best > 0) {
      matched++;
      score += best * weight;
    }
  }
  if (score === 0) return 0;
  // Reward products matching more of the request ("albracame 115 finn" beats "albracame").
  score *= 0.5 + matched / weights.size;
  // Keep in-stock items ahead of an equivalent out-of-stock one.
  if (item.product.in_stock === false) score *= 0.85;
  return score;
}

function rank(index: ProductIndex, pool: IndexedProduct[], weights: Map<string, number>, limit: number): Product[] {
  const scored = pool
    .map((item) => ({ item, score: scoreIndexed(index, item, weights) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  const top = scored[0]?.score ?? 0;
  return scored
    .filter((s) => s.score >= top * RELATIVE_SCORE_FLOOR)
    .slice(0, limit)
    .map((s) => s.item.product);
}

/**
 * Fuzzy relevance of some catalog products to a free-text request, with the
 * same scoring as retrieval (typos, sounds, references). Used to pick which
 * product photos match what the client asked for.
 */
export function scoreProductsForQuery(products: Product[], query: string, pool: Product[]): Map<string, number> {
  const index = getIndex(products);
  const weights = weightsOf(tokenize(query));
  const scores = new Map<string, number>();
  if (weights.size === 0) return scores;
  for (const p of pool) {
    const item = index.byId.get(p.id);
    if (item) scores.set(p.id, scoreIndexed(index, item, weights));
  }
  return scores;
}

export interface CategorySummary {
  name: string;
  count: number;
  examples: string[];
}

/** Compact overview of a large catalog: categories with counts and a few example names. */
export function summarizeCategories(products: Product[], maxCategories = 60): CategorySummary[] {
  const groups = new Map<string, Product[]>();
  for (const p of products) {
    if (!p.is_active) continue;
    const key = p.category?.trim() || "Autres";
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, maxCategories)
    .map(([name, items]) => ({ name, count: items.length, examples: items.slice(0, 3).map((p) => p.name) }));
}

export interface ProductSelection {
  /** Products to render in full detail. */
  shown: Product[];
  /** Names of the remaining active products (small catalogs only). */
  otherNames: string[];
  /** Category overview replacing the name index on large catalogs. */
  categories: CategorySummary[];
  /** True when ranking was applied (vs. a full dump of a small catalog). */
  filtered: boolean;
  totalActive: number;
}

/**
 * Pick which products to inject. Small catalogs are returned whole. Large ones
 * are ranked against the query and only real matches are shown in full — on an
 * opening "bonjour" nothing is forced in (the agent must not push random items;
 * it has the category overview and the search tool).
 */
export function selectRelevantProducts(
  products: Product[],
  queryTokens: string[],
  opts: { topN?: number; fullDumpMax?: number } = {},
): ProductSelection {
  const active = products.filter((p) => p.is_active);
  const topN = opts.topN ?? TOP_PRODUCTS;
  const fullDumpMax = opts.fullDumpMax ?? FULL_DUMP_MAX_PRODUCTS;

  if (active.length <= fullDumpMax) {
    return { shown: active, otherNames: [], categories: [], filtered: false, totalActive: active.length };
  }

  const index = getIndex(products);
  const shown = rank(index, index.items, weightsOf(queryTokens), topN);
  const shownIds = new Set(shown.map((p) => p.id));
  const large = active.length > NAME_INDEX_MAX;

  return {
    shown,
    otherNames: large ? [] : active.filter((p) => !shownIds.has(p.id)).map((p) => p.name),
    categories: large ? summarizeCategories(active) : [],
    filtered: true,
    totalActive: active.length,
  };
}

export interface ProductSearchFilters {
  category?: string;
  brand?: string;
  inStockOnly?: boolean;
  maxPrice?: number;
}

function looselyMatches(value: string | null | undefined, wanted: string): boolean {
  const v = normalizeText(value ?? "");
  const w = normalizeText(wanted);
  return Boolean(v) && (v.includes(w) || w.includes(v));
}

/** Full-catalog search used by the agent's `search_products` tool. */
export function searchProducts(
  products: Product[],
  query: string,
  filters: ProductSearchFilters = {},
  limit = 8,
): Product[] {
  const index = getIndex(products);
  const pool = index.items.filter(({ product: p }) => {
    if (filters.category && !looselyMatches(p.category, filters.category)) return false;
    if (filters.brand && !looselyMatches(p.brand, filters.brand)) return false;
    if (filters.inStockOnly && p.in_stock === false) return false;
    if (filters.maxPrice != null && (p.price == null || p.price > filters.maxPrice)) return false;
    return true;
  });
  const weights = weightsOf(tokenize(query));
  if (weights.size === 0) {
    return pool.slice(0, limit).map((i) => i.product);
  }
  return rank(index, pool, weights, limit);
}

// ─────────────────────────── Rendering ───────────────────────────

/** "55000, XOF" → "55 000 FCFA" (plain spaces: WhatsApp-safe). */
export function formatMoney(amount: number, currency: string): string {
  const code = currency.toUpperCase();
  const label = code === "XOF" || code === "XAF" ? "FCFA" : code;
  const rounded = Math.round(amount * 100) / 100;
  const [int, dec] = String(rounded).split(".");
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${dec ? `,${dec}` : ""} ${label}`;
}

/** Full product sheet as injected in the prompt and returned by the search tool. */
export function renderProductDetail(p: Product): string {
  const lines = [`• ${p.name}`];
  const meta = [p.category && `Catégorie : ${p.category}`, p.brand && `Marque : ${p.brand}`].filter(Boolean).join(" · ");
  if (meta) lines.push(`  ${meta}`);
  if (p.sku) lines.push(`  Référence : ${p.sku} (à citer uniquement si le client la demande)`);
  lines.push(
    p.price != null
      ? `  Prix : ${formatMoney(p.price, p.currency)}`
      : "  Prix : non renseigné (ne donne aucun prix — propose de vérifier)",
  );
  if (p.in_stock === false) {
    lines.push("  Stock : RUPTURE (ne le présente pas comme disponible)");
  } else if (p.stock_quantity != null) {
    lines.push(`  Stock : disponible — ${p.stock_quantity} en stock (cite la quantité seulement si on te la demande)`);
  } else if (p.in_stock) {
    lines.push("  Stock : disponible");
  }
  if (p.description) lines.push(`  Description : ${p.description}`);
  const attrs = Object.entries(p.attributes ?? {});
  if (attrs.length) {
    const details = attrs.map(([k, v]) =>
      `${k} : ${typeof v === "number" && /prix/i.test(k) ? formatMoney(v, p.currency) : v}`,
    );
    lines.push(`  Détails : ${details.join(" ; ")}`);
  }
  if (p.product_url) lines.push(`  Lien : ${p.product_url}`);
  lines.push(
    p.images.length
      ? `  URL photos (uniquement pour media[], jamais dans reply) : ${p.images.slice(0, 3).join(" | ")}`
      : "  (pas de photo disponible pour ce produit)",
  );
  return lines.join("\n");
}

// ─────────────────────────── Knowledge ───────────────────────────

/** Score a knowledge entry: title matches weigh more than body matches. */
function scoreKnowledge(entry: KnowledgeBaseEntry, queryTokens: string[]): number {
  if (!queryTokens.length) return 0;
  const titleTokens = new Set(tokenize(entry.title));
  const bodyTokens = new Set(tokenize(entry.content));
  const categoryTokens = new Set(tokenize(entry.category));

  let score = 0;
  for (const q of queryTokens) {
    if (titleTokens.has(q)) score += 3;
    else if (categoryTokens.has(q)) score += 2;
    else if (bodyTokens.has(q)) score += 1;
  }
  return score;
}

export interface KnowledgeSelection {
  shown: KnowledgeBaseEntry[];
  filtered: boolean;
}

/**
 * Pick which knowledge entries to inject. Small bases are returned whole; large
 * ones are ranked, but entries with no query match still fall back to a bounded
 * slice so core facts (presentation, pricing…) remain available.
 */
export function selectRelevantKnowledge(
  knowledge: KnowledgeBaseEntry[],
  queryTokens: string[],
  opts: { topN?: number; fullDumpMax?: number } = {},
): KnowledgeSelection {
  const active = knowledge.filter((k) => k.is_active);
  const topN = opts.topN ?? TOP_KNOWLEDGE;
  const fullDumpMax = opts.fullDumpMax ?? FULL_DUMP_MAX_KNOWLEDGE;

  if (active.length <= fullDumpMax) {
    return { shown: active, filtered: false };
  }

  const scored = active
    .map((item) => ({ item, score: scoreKnowledge(item, queryTokens) }))
    .sort((a, b) => b.score - a.score);

  const matched = scored.filter((s) => s.score > 0);
  const chosen = (matched.length ? matched : scored).slice(0, topN);
  return { shown: chosen.map((s) => s.item), filtered: true };
}
