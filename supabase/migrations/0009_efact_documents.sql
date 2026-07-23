-- E_Fact: cloud archive of generated invoices / quotes / receipts.
--
-- Org-scoped (a document belongs to the business, not a specific WhatsApp
-- agent). Lightweight denormalised columns (kind, number, client, total…) drive
-- fast lists/search/stats without reading the heavy `payload`; the full
-- EFactDocument JSON is kept in `payload` so any past document can be reopened
-- and re-exported exactly as it was.
--
-- Requires: 0003_multitenant (current_org_id(), organizations, set_updated_at).
-- Apply in the Supabase SQL editor. Safe to re-run (idempotent guards).

create table if not exists efact_documents (
  id          uuid          primary key default gen_random_uuid(),
  org_id      uuid          not null references organizations(id) on delete cascade,
  created_by  uuid          references auth.users(id) on delete set null,
  kind        text          not null default 'facture', -- facture | devis | recu
  number      text          not null,
  client_name text,
  currency    text          not null default 'XOF',
  total       numeric(14,2) not null default 0,
  issue_date  date,
  status      text,                                      -- recu: integral | acompte
  payload     jsonb         not null default '{}'::jsonb,
  created_at  timestamptz   not null default now(),
  updated_at  timestamptz   not null default now()
);

create index if not exists idx_efact_org on efact_documents(org_id);
create index if not exists idx_efact_created on efact_documents(org_id, created_at desc);
create index if not exists idx_efact_kind on efact_documents(org_id, kind);

-- One row per (org, number): re-saving the same document updates it in place.
do $$ begin
  alter table efact_documents add constraint efact_org_number_key unique (org_id, number);
exception when duplicate_object then null; end $$;

alter table efact_documents enable row level security;

drop policy if exists "org_scoped" on efact_documents;
create policy "org_scoped" on efact_documents for all to authenticated
  using      (org_id = current_org_id())
  with check (org_id = current_org_id());

drop trigger if exists trg_efact_updated on efact_documents;
create trigger trg_efact_updated
  before update on efact_documents
  for each row execute function set_updated_at();
