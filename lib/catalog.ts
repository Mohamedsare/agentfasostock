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
 * recent conversation text) and inject only the relevant ones in full detail,
 * plus a compact name-only index of everything else so the agent still knows
 * the full breadth of the catalog and never wrongly says "we don't have it".
 *
 * No embeddings / pgvector: a normalized token-overlap scorer is cheap, has no
 * infra dependency, and is well suited to a parts catalog where exact
 * references and numbers ("115", "SKU-42") are the decisive signal. When the
 * catalog is small we skip ranking entirely and keep the full dump.
 */

/** Below this many active items, ranking adds no value — inject everything. */
export const FULL_DUMP_MAX_PRODUCTS = 25;
export const FULL_DUMP_MAX_KNOWLEDGE = 20;

/** Max items shown in full detail when the catalog is large enough to filter. */
export const TOP_PRODUCTS = 12;
export const TOP_KNOWLEDGE = 8;

/** French stopwords + filler that carry no retrieval signal. */
const STOPWORDS = new Set([
  "le", "la", "les", "un", "une", "des", "du", "de", "d", "l", "et", "ou", "a",
  "au", "aux", "en", "dans", "sur", "pour", "par", "avec", "sans", "ce", "cet",
  "cette", "ces", "que", "qui", "quoi", "est", "sont", "avez", "vous", "je",
  "tu", "il", "elle", "on", "nous", "ils", "elles", "me", "te", "se", "mon",
  "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "bonjour", "salut",
  "svp", "stp", "merci", "prix", "combien", "photo", "photos", "image",
  "images", "produit", "produits", "article", "articles", "voir", "envoie",
  "envoyer", "envoi", "montre", "montrer", "avez", "the", "of", "to", "is",
]);

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
 * are dropped. A crude singular fold ("amortisseurs" → "amortisseur") lets
 * plural queries match singular catalog names.
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  for (const raw of normalizeText(input).split(" ")) {
    if (!raw) continue;
    const isNumeric = /^\d+$/.test(raw);
    if (isNumeric) {
      tokens.push(raw);
      continue;
    }
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    tokens.push(foldSingular(raw));
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
 * Build the retrieval query from the recent conversation. Only the client's own
 * messages matter (what they're asking for), and the latest message is weighted
 * more heavily since it's the current request.
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
    // Duplicate the latest message's tokens so the current ask dominates.
    tokens.push(...t, ...(isLatest ? t : []));
  });
  return tokens;
}

interface Scored<T> {
  item: T;
  score: number;
}

/**
 * Score a product against the query tokens. Name matches dominate; numeric
 * reference matches in the name are decisive (a client quoting a part number
 * means exactly that part). Description matches are a weak tie-breaker.
 */
function scoreProduct(product: Product, queryTokens: string[]): number {
  if (!queryTokens.length) return 0;
  const nameTokens = new Set(tokenize(product.name));
  const nameNorm = normalizeText(product.name);
  const descTokens = new Set(tokenize(product.description ?? ""));

  let score = 0;
  for (const q of queryTokens) {
    const numeric = /^\d+$/.test(q);
    if (nameTokens.has(q)) {
      score += numeric ? 6 : 3; // exact reference in the name is decisive
    } else if (!numeric && q.length >= 3 && nameNorm.includes(q)) {
      score += 2; // partial/substring match in the name
    } else if (descTokens.has(q)) {
      score += 1; // weak signal from the description
    }
  }
  return score;
}

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

export interface ProductSelection {
  /** Products to render in full detail (name, price, description, images). */
  shown: Product[];
  /** Names of the remaining active products, for a compact breadth index. */
  otherNames: string[];
  /** True when ranking was applied (vs. a full dump of a small catalog). */
  filtered: boolean;
}

/**
 * Pick which products to inject. Small catalogs are returned whole. Large ones
 * are ranked against the query: the top matches go in full, the rest become a
 * name-only index. If nothing matches (e.g. an opening "bonjour"), we still
 * return a bounded slice so the agent has something concrete to offer.
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
    return { shown: active, otherNames: [], filtered: false };
  }

  const scored: Scored<Product>[] = active
    .map((item) => ({ item, score: scoreProduct(item, queryTokens) }))
    .sort((a, b) => b.score - a.score);

  const matched = scored.filter((s) => s.score > 0);
  // With no relevant match, surface a small default slice rather than nothing.
  const chosen = (matched.length ? matched : scored).slice(0, topN);
  const shown = chosen.map((s) => s.item);
  const shownIds = new Set(shown.map((p) => p.id));
  const otherNames = active.filter((p) => !shownIds.has(p.id)).map((p) => p.name);

  return { shown, otherNames, filtered: true };
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

  const scored: Scored<KnowledgeBaseEntry>[] = active
    .map((item) => ({ item, score: scoreKnowledge(item, queryTokens) }))
    .sort((a, b) => b.score - a.score);

  const matched = scored.filter((s) => s.score > 0);
  const chosen = (matched.length ? matched : scored).slice(0, topN);
  return { shown: chosen.map((s) => s.item), filtered: true };
}
