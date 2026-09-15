-- Selling price markup for API-synced catalogs.
-- The supplier API gives the store price; the agent must quote the SELLING price:
-- supplier price + a fixed markup per price tier. The supplier price is kept in
-- products.cost_price for the dashboard and never shown to the agent.
--
-- Requires: 0010_product_api_sources. Apply in the Supabase SQL editor. Safe to re-run.

-- Tiers, e.g. [{"upTo": 4000, "add": 1000}, {"upTo": null, "add": 3000}]
alter table product_sources add column if not exists price_markup jsonb;
alter table products add column if not exists cost_price numeric(12,2);

-- FasoStock sources: up to 4 000 FCFA → +1 000, above 4 000 FCFA → +3 000.
update product_sources
set price_markup = '[{"upTo": 4000, "add": 1000}, {"upTo": null, "add": 3000}]'::jsonb
where price_markup is null
  and base_url ilike '%fasostock.com%';

-- Apply it right away to already-synced prices (once: rows without cost_price).
-- Packaging prices in `attributes` are refreshed by the next synchronisation.
update products p
set cost_price = p.price,
    price = p.price + case when p.price <= 4000 then 1000 else 3000 end
from product_sources s
where p.source_id = s.id
  and s.base_url ilike '%fasostock.com%'
  and p.cost_price is null
  and p.price is not null
  and p.price > 0;
