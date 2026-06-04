-- Multi-tenant SaaS migration.
--
-- Turns the single-tenant app into a platform: organizations (companies) own
-- many agents (one WhatsApp number + persona each); all prospect data is scoped
-- by agent_id; RLS isolates each org. Inbound webhooks route by Wasender
-- sessionId → agent. Existing FasoStock data is backfilled under a default org.
--
-- Apply in the Supabase SQL editor. Safe to re-run (idempotent guards).

-- ───────────────────────── New tables ─────────────────────────
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid references auth.users(id) on delete set null,
  openai_api_key_enc text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null default 'Agent',
  -- routing + per-session credentials
  -- wasender_session_id = per-session api_key (webhook routing + send bearer)
  wasender_session_id text unique,
  -- wasender_session_ref = numeric Wasender session id (management API URLs)
  wasender_session_ref text,
  wasender_session_key_enc text,
  phone_number text,
  connection_status text not null default 'disconnected',
  admin_whatsapp text,
  -- persona / behaviour (formerly agent_settings)
  agent_name text not null default 'Assistant',
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_agents_org on agents(org_id);
create index if not exists idx_agents_session on agents(wasender_session_id);

alter table profiles add column if not exists org_id uuid references organizations(id) on delete set null;

-- ─────────────── Scope data tables by agent_id ────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'contacts','conversations','messages','lead_qualifications','knowledge_base',
    'email_notifications','follow_ups','lab_tests','notes','audit_logs'
  ] loop
    execute format('alter table %I add column if not exists agent_id uuid references agents(id) on delete cascade;', t);
    execute format('create index if not exists %I on %I(agent_id);', 'idx_' || t || '_agent', t);
  end loop;
end $$;

-- Contacts are unique per agent, not globally (same phone can reach many agents).
alter table contacts drop constraint if exists contacts_phone_key;
do $$ begin
  alter table contacts add constraint contacts_agent_phone_key unique (agent_id, phone);
exception when duplicate_object then null; end $$;
create index if not exists idx_contacts_agent_lid on contacts(agent_id, lid);

-- updated_at triggers for the new tables.
drop trigger if exists trg_organizations_updated on organizations;
create trigger trg_organizations_updated before update on organizations for each row execute function set_updated_at();
drop trigger if exists trg_agents_updated on agents;
create trigger trg_agents_updated before update on agents for each row execute function set_updated_at();

-- ───────────────────── Backfill existing data ─────────────────
-- Create the default FasoStock org + agent (carrying the current global config
-- and the live Wasender session), then attach every existing row to it.
do $$
declare
  v_org_id uuid;
  ag_id uuid;
  s record;
begin
  if not exists (select 1 from organizations) then
    insert into organizations (name, owner_id)
    values ('FasoStock', (select id from auth.users order by created_at limit 1))
    returning id into v_org_id;

    select * into s from agent_settings limit 1;

    insert into agents (
      org_id, name, wasender_session_id, wasender_session_ref, connection_status,
      admin_whatsapp,
      agent_name, tone, language, welcome_message, system_prompt,
      qualification_rules, human_handoff_rules, qualified_threshold, hot_threshold,
      ai_enabled, operating_mode
    ) values (
      v_org_id, 'FasoStock',
      '729e2b638510546a77f97e82f1f52ca81fb9d694e68b59943077bf2670018858',
      '89993', 'connected',
      '+212771668079',
      coalesce(s.agent_name, 'Awa — Assistante FasoStock'),
      coalesce(s.tone, 'professionnel'::agent_tone),
      coalesce(s.language, 'fr'),
      coalesce(s.welcome_message, ''),
      coalesce(s.system_prompt, ''),
      coalesce(s.qualification_rules, ''),
      coalesce(s.human_handoff_rules, ''),
      coalesce(s.qualified_threshold, 70),
      coalesce(s.hot_threshold, 85),
      coalesce(s.ai_enabled, true),
      coalesce(s.operating_mode, 'hybride'::agent_mode)
    ) returning id into ag_id;

    update contacts set agent_id = ag_id where agent_id is null;
    update conversations set agent_id = ag_id where agent_id is null;
    update messages set agent_id = ag_id where agent_id is null;
    update lead_qualifications set agent_id = ag_id where agent_id is null;
    update knowledge_base set agent_id = ag_id where agent_id is null;
    update email_notifications set agent_id = ag_id where agent_id is null;
    update follow_ups set agent_id = ag_id where agent_id is null;
    update lab_tests set agent_id = ag_id where agent_id is null;
    update notes set agent_id = ag_id where agent_id is null;
    update audit_logs set agent_id = ag_id where agent_id is null;

    -- Attach all existing users to the FasoStock org.
    update profiles set org_id = v_org_id where org_id is null;
  end if;
end $$;

-- ───────────────────────── RLS (org-scoped) ───────────────────
-- Helper: the org of the current authenticated user.
create or replace function current_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from profiles where id = auth.uid()
$$;

alter table organizations enable row level security;
alter table agents enable row level security;

drop policy if exists "org_self" on organizations;
create policy "org_self" on organizations for all to authenticated
  using (id = current_org_id()) with check (id = current_org_id());

drop policy if exists "agents_org" on agents;
create policy "agents_org" on agents for all to authenticated
  using (org_id = current_org_id()) with check (org_id = current_org_id());

-- profiles: see your own row and org-mates; only edit your own.
drop policy if exists "authenticated_all" on profiles;
drop policy if exists "profiles_self_or_org" on profiles;
create policy "profiles_self_or_org" on profiles for select to authenticated
  using (id = auth.uid() or org_id = current_org_id());
drop policy if exists "profiles_update_self" on profiles;
create policy "profiles_update_self" on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Data tables: only rows belonging to an agent in your org.
do $$
declare t text;
begin
  foreach t in array array[
    'contacts','conversations','messages','lead_qualifications','knowledge_base',
    'email_notifications','follow_ups','lab_tests','notes','audit_logs'
  ] loop
    execute format('drop policy if exists "authenticated_all" on %I;', t);
    execute format('drop policy if exists "org_scoped" on %I;', t);
    execute format(
      'create policy "org_scoped" on %I for all to authenticated '
      || 'using (agent_id in (select id from agents where org_id = current_org_id())) '
      || 'with check (agent_id in (select id from agents where org_id = current_org_id()));',
      t
    );
  end loop;
end $$;

-- agent_settings is superseded by agents; left in place (unused) for safety.
