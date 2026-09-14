-- Self-learning: lessons the agent extracts from its own past conversations
-- (admin replies, AI failures, what worked) and applies to future replies.
--
-- Requires: 0003_multitenant (current_org_id, agents, set_updated_at).
-- Apply in the Supabase SQL editor. Safe to re-run.

create table if not exists agent_learnings (
  id                      uuid        primary key default gen_random_uuid(),
  agent_id                uuid        not null references agents(id) on delete cascade,
  kind                    text        not null default 'bonne_pratique', -- info_entreprise | reponse_type | objection | correction | a_eviter | bonne_pratique
  title                   text        not null,
  content                 text        not null,
  evidence                text,                                          -- short anonymised excerpt proving the lesson
  confidence              integer     not null default 50,               -- 0-100
  status                  text        not null default 'pending',        -- active | pending | rejected
  source_conversation_ids uuid[]      not null default '{}',
  occurrences             integer     not null default 1,                -- how many conversations showed it
  last_seen_at            timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists idx_agent_learnings_agent_status on agent_learnings(agent_id, status);

alter table agent_learnings enable row level security;

drop policy if exists "org_scoped" on agent_learnings;
create policy "org_scoped" on agent_learnings for all to authenticated
  using      (agent_id in (select id from agents where org_id = current_org_id()))
  with check (agent_id in (select id from agents where org_id = current_org_id()));

drop trigger if exists trg_agent_learnings_updated on agent_learnings;
create trigger trg_agent_learnings_updated
  before update on agent_learnings
  for each row execute function set_updated_at();

-- When a conversation was last analysed (re-analysed only after new messages).
alter table conversations add column if not exists learned_at timestamptz;

-- auto (confident lessons apply immediately) | review (all wait for approval) | off
alter table agents add column if not exists learning_mode text not null default 'auto';
