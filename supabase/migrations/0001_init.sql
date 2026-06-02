-- FasoStock WhatsApp AI Agent — initial schema
-- Run in the Supabase SQL editor (or via the Supabase CLI).

create extension if not exists "pgcrypto";

-- ─────────────────────────── Enums ───────────────────────────
do $$ begin
  create type lead_status as enum (
    'nouveau','prospect_froid','prospect_tiede','prospect_chaud','prospect_qualifie',
    'client_converti','support_client','humain_requis','spam','perdu'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type intent_type as enum ('support','prospection','pricing','demo','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type conversation_mode as enum ('ai','human');
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_direction as enum ('inbound','outbound');
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_sender as enum ('contact','ai','admin','system');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lead_source as enum ('whatsapp','manual','import','labs');
exception when duplicate_object then null; end $$;

do $$ begin
  create type support_category as enum ('connexion','stock','vente','formation','prix','demonstration','autre');
exception when duplicate_object then null; end $$;

do $$ begin
  create type knowledge_category as enum ('presentation','fonctionnalites','prix','demonstration','support','objections','faq','conditions');
exception when duplicate_object then null; end $$;

do $$ begin
  create type agent_tone as enum ('professionnel','amical','direct','chaleureux');
exception when duplicate_object then null; end $$;

do $$ begin
  create type agent_mode as enum ('support','prospection','hybride');
exception when duplicate_object then null; end $$;

do $$ begin
  create type email_trigger as enum ('prospect_qualifie','prospect_chaud','client_converti','humain_requis','support_important');
exception when duplicate_object then null; end $$;

do $$ begin
  create type email_status as enum ('pending','sent','failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type follow_up_status as enum ('scheduled','sent','cancelled','responded');
exception when duplicate_object then null; end $$;

-- ───────────────────── updated_at trigger ────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ─────────────────────────── Tables ──────────────────────────
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text,
  business_type text,
  city text,
  need text,
  source lead_source not null default 'whatsapp',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  status lead_status not null default 'nouveau',
  score int not null default 0,
  mode conversation_mode not null default 'ai',
  intent intent_type,
  summary text,
  next_action text,
  support_category support_category,
  last_message_at timestamptz not null default now(),
  last_message_preview text,
  unread_count int not null default 0,
  ai_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  direction message_direction not null,
  sender message_sender not null,
  content text not null,
  intent intent_type,
  score_delta int,
  wasender_id text,
  created_at timestamptz not null default now()
);

create table if not exists lead_qualifications (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  score int not null,
  status lead_status not null,
  intent intent_type,
  summary text,
  next_action text,
  criteria jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists knowledge_base (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  category knowledge_category not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_settings (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null default 'Awa — Assistante FasoStock',
  tone agent_tone not null default 'professionnel',
  language text not null default 'fr',
  welcome_message text not null default '',
  system_prompt text not null default '',
  qualification_rules text not null default '',
  human_handoff_rules text not null default '',
  qualified_threshold int not null default 70,
  hot_threshold int not null default 85,
  ai_enabled boolean not null default true,
  operating_mode agent_mode not null default 'hybride',
  updated_at timestamptz not null default now()
);

create table if not exists email_notifications (
  id uuid primary key default gen_random_uuid(),
  trigger email_trigger not null,
  to_email text not null,
  subject text not null,
  conversation_id uuid references conversations(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  status email_status not null default 'pending',
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists follow_ups (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  step int not null check (step between 1 and 3),
  scheduled_at timestamptz not null,
  status follow_up_status not null default 'scheduled',
  message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists lab_tests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  system_prompt text not null default '',
  tone agent_tone not null default 'professionnel',
  scenario text not null default '',
  transcript jsonb not null default '[]',
  result jsonb,
  is_saved boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  contact_id uuid references contacts(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  entity text not null,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- ─────────────────────────── Indexes ─────────────────────────
create index if not exists idx_conversations_status on conversations(status);
create index if not exists idx_conversations_last_message on conversations(last_message_at desc);
create index if not exists idx_conversations_contact on conversations(contact_id);
create index if not exists idx_messages_conversation on messages(conversation_id, created_at);
create index if not exists idx_contacts_phone on contacts(phone);
create index if not exists idx_qualifications_conversation on lead_qualifications(conversation_id);
create index if not exists idx_follow_ups_scheduled on follow_ups(scheduled_at) where status = 'scheduled';
create index if not exists idx_knowledge_category on knowledge_base(category);
create index if not exists idx_notes_conversation on notes(conversation_id);

-- ───────────────────────── updated_at hooks ──────────────────
drop trigger if exists trg_profiles_updated on profiles;
create trigger trg_profiles_updated before update on profiles for each row execute function set_updated_at();
drop trigger if exists trg_contacts_updated on contacts;
create trigger trg_contacts_updated before update on contacts for each row execute function set_updated_at();
drop trigger if exists trg_conversations_updated on conversations;
create trigger trg_conversations_updated before update on conversations for each row execute function set_updated_at();
drop trigger if exists trg_knowledge_updated on knowledge_base;
create trigger trg_knowledge_updated before update on knowledge_base for each row execute function set_updated_at();
drop trigger if exists trg_agent_settings_updated on agent_settings;
create trigger trg_agent_settings_updated before update on agent_settings for each row execute function set_updated_at();

-- ─────────────── Auto-create profile on signup ───────────────
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- ─────────────────────────── RLS ─────────────────────────────
-- This is an internal admin tool: any authenticated user has full access.
-- The service role (used by webhooks/jobs) bypasses RLS entirely.
alter table profiles enable row level security;
alter table contacts enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table lead_qualifications enable row level security;
alter table knowledge_base enable row level security;
alter table agent_settings enable row level security;
alter table email_notifications enable row level security;
alter table follow_ups enable row level security;
alter table lab_tests enable row level security;
alter table notes enable row level security;
alter table audit_logs enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','contacts','conversations','messages','lead_qualifications',
    'knowledge_base','agent_settings','email_notifications','follow_ups',
    'lab_tests','notes','audit_logs'
  ] loop
    execute format('drop policy if exists "authenticated_all" on %I;', t);
    execute format(
      'create policy "authenticated_all" on %I for all to authenticated using (true) with check (true);',
      t
    );
  end loop;
end $$;

-- Seed a default agent settings row.
insert into agent_settings (agent_name, welcome_message, system_prompt)
select
  'Awa — Assistante FasoStock',
  'Bonjour 👋 Je suis l''assistante FasoStock. Quel type de commerce gérez-vous ?',
  'Tu es Awa, l''assistante commerciale virtuelle de FasoStock, application de gestion de stock et de ventes pour les commerçants en Afrique de l''Ouest.'
where not exists (select 1 from agent_settings);
