-- Knowledge files: uploaded documents (PDF, images, Word, Excel, audio…) per agent.
-- Products: product catalog with up to 6 images per agent.
--
-- Requires: 0003_multitenant (current_org_id, agents table, set_updated_at trigger fn).
-- Safe to re-run (idempotent guards).

-- ─────────────────────── knowledge_files ────────────────────────
create table if not exists knowledge_files (
  id              uuid        primary key default gen_random_uuid(),
  agent_id        uuid        not null references agents(id) on delete cascade,
  name            text        not null,
  description     text,
  file_type       text        not null default 'other', -- pdf | image | audio | word | excel | video | other
  mime_type       text        not null default '',
  storage_path    text        not null,
  public_url      text        not null,
  file_size_bytes bigint,
  is_active       boolean     not null default true,
  created_at      timestamptz not null default now()
);

create index if not exists idx_knowledge_files_agent on knowledge_files(agent_id);

alter table knowledge_files enable row level security;

drop policy if exists "org_scoped" on knowledge_files;
create policy "org_scoped" on knowledge_files for all to authenticated
  using      (agent_id in (select id from agents where org_id = current_org_id()))
  with check (agent_id in (select id from agents where org_id = current_org_id()));

-- ─────────────────────────── products ───────────────────────────
create table if not exists products (
  id          uuid          primary key default gen_random_uuid(),
  agent_id    uuid          not null references agents(id) on delete cascade,
  name        text          not null,
  description text,
  price       numeric(12,2),
  currency    text          not null default 'XOF',
  images      text[]        not null default '{}',  -- up to 6 public URLs
  is_active   boolean       not null default true,
  created_at  timestamptz   not null default now(),
  updated_at  timestamptz   not null default now()
);

create index if not exists idx_products_agent on products(agent_id);

alter table products enable row level security;

drop policy if exists "org_scoped" on products;
create policy "org_scoped" on products for all to authenticated
  using      (agent_id in (select id from agents where org_id = current_org_id()))
  with check (agent_id in (select id from agents where org_id = current_org_id()));

drop trigger if exists trg_products_updated on products;
create trigger trg_products_updated
  before update on products
  for each row execute function set_updated_at();

-- ─────────────── Supabase Storage buckets (run once) ────────────
-- Create the two buckets used for uploads.  `public = true` means
-- the files are served via the CDN without authentication tokens.
insert into storage.buckets (id, name, public)
  values ('knowledge-files', 'knowledge-files', true)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('product-images', 'product-images', true)
  on conflict (id) do nothing;

-- Storage RLS: any authenticated user may upload/read/delete files
-- under their own org's agents.  Policies are keyed by bucket name.
drop policy if exists "knowledge_files_all" on storage.objects;
create policy "knowledge_files_all" on storage.objects for all to authenticated
  using      (bucket_id = 'knowledge-files')
  with check (bucket_id = 'knowledge-files');

drop policy if exists "product_images_all" on storage.objects;
create policy "product_images_all" on storage.objects for all to authenticated
  using      (bucket_id = 'product-images')
  with check (bucket_id = 'product-images');
