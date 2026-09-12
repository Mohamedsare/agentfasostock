-- Product API sources: connect an external catalog API (e.g. srfaso.com/api/v1/products)
-- to an agent. Products are synced into the `products` table (source = 'api') so the
-- agent's retrieval layer works on local rows — fast, and resilient to API downtime.
--
-- Requires: 0007_knowledge_files_products.
-- Apply in the Supabase SQL editor. Safe to re-run (idempotent guards).

-- ─────────────────────── product_sources ────────────────────────
create table if not exists product_sources (
  id                    uuid        primary key default gen_random_uuid(),
  agent_id              uuid        not null references agents(id) on delete cascade,
  name                  text        not null default 'Catalogue API',
  base_url              text        not null,                 -- https://srfaso.com/api/v1/products
  auth_type             text        not null default 'none',  -- none | bearer | header | query
  auth_key_name         text,                                 -- header name (header) or query param (query)
  api_key_encrypted     text,                                 -- AES-GCM, see lib/crypto.ts
  default_query         text,                                 -- e.g. "in_stock=true&category=moteur"
  per_page              integer     not null default 50,
  field_mapping         jsonb       not null default '{}'::jsonb,
  sync_interval_minutes integer     not null default 60,
  is_active             boolean     not null default true,
  last_sync_at          timestamptz,
  last_full_sync_at     timestamptz,
  last_sync_status      text,                                 -- success | error | running
  last_sync_error       text,
  last_sync_count       integer,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_product_sources_agent on product_sources(agent_id);

alter table product_sources enable row level security;

drop policy if exists "org_scoped" on product_sources;
create policy "org_scoped" on product_sources for all to authenticated
  using      (agent_id in (select id from agents where org_id = current_org_id()))
  with check (agent_id in (select id from agents where org_id = current_org_id()));

drop trigger if exists trg_product_sources_updated on product_sources;
create trigger trg_product_sources_updated
  before update on product_sources
  for each row execute function set_updated_at();

-- ─────────────── products: API-synced columns ───────────────
alter table products add column if not exists source         text    not null default 'manual'; -- manual | api
alter table products add column if not exists source_id      uuid    references product_sources(id) on delete cascade;
alter table products add column if not exists external_id    text;
alter table products add column if not exists sku            text;
alter table products add column if not exists category       text;
alter table products add column if not exists brand          text;
alter table products add column if not exists stock_quantity integer;
alter table products add column if not exists in_stock       boolean;
alter table products add column if not exists product_url    text;
alter table products add column if not exists attributes     jsonb   not null default '{}'::jsonb;
alter table products add column if not exists synced_at      timestamptz;

create unique index if not exists uq_products_source_external
  on products(source_id, external_id);
create index if not exists idx_products_agent_active on products(agent_id, is_active);
