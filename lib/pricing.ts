import type { PriceMarkupTier } from "@/lib/types";

/**
 * Selling price rules for API-synced catalogs. The supplier API (FasoStock)
 * gives the store's price; the agent must quote the price to SELL at:
 * supplier price + a fixed markup that depends on the price tier.
 */

/** FasoStock default: up to 4 000 FCFA → +1 000; above 4 000 FCFA → +3 000. */
export const DEFAULT_FASOSTOCK_MARKUP: PriceMarkupTier[] = [
  { upTo: 4000, add: 1000 },
  { upTo: null, add: 3000 },
];

/** Bounded tiers sorted by ceiling, the open-ended tier (upTo = null) last. */
export function normalizeMarkup(tiers: PriceMarkupTier[] | null | undefined): PriceMarkupTier[] {
  if (!tiers?.length) return [];
  const bounded = tiers
    .filter((t): t is { upTo: number; add: number } => t.upTo != null)
    .sort((a, b) => a.upTo - b.upTo);
  const open = tiers.find((t) => t.upTo == null);
  return open ? [...bounded, open] : bounded;
}

/**
 * Selling price = supplier price + the markup of its tier (first tier whose
 * ceiling is ≥ the price). An unpriced product (null or 0) stays unpriced, and a
 * price above every ceiling with no open-ended tier is left unchanged.
 */
export function applyMarkup(price: number | null, tiers: PriceMarkupTier[] | null | undefined): number | null {
  if (price == null || !(price > 0)) return price;
  const rules = normalizeMarkup(tiers);
  const tier = rules.find((t) => t.upTo == null || price <= t.upTo);
  return tier ? Math.round((price + tier.add) * 100) / 100 : price;
}
