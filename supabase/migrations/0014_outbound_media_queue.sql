-- Outbound media queue: product photos (and other attachments) are persisted
-- before sending, delivered in order, and retried until they reach the client —
-- never lost to a rate limit, a Wasender hiccup or a function timeout.
--
-- Requires: 0003_multitenant (agents, conversations, current_org_id, set_updated_at).
-- Apply in the Supabase SQL editor. Safe to re-run.

create table if not exists outbound_media (
  id              uuid        primary key default gen_random_uuid(),
  agent_id        uuid        not null references agents(id) on delete cascade,
  conversation_id uuid        not null references conversations(id) on delete cascade,
  to_phone        text        not null,
  type            text        not null,                 -- image | document | video | audio
  url             text        not null,
  caption         text,
  position        integer     not null default 0,       -- order inside one reply
  status          text        not null default 'pending', -- pending | sending | sent | failed
  attempts        integer     not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  wasender_id     text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_outbound_media_open
  on outbound_media(conversation_id, created_at, position)
  where status in ('pending', 'sending');
create index if not exists idx_outbound_media_due on outbound_media(status, next_attempt_at);

alter table outbound_media enable row level security;

drop policy if exists "org_scoped" on outbound_media;
create policy "org_scoped" on outbound_media for all to authenticated
  using      (agent_id in (select id from agents where org_id = current_org_id()))
  with check (agent_id in (select id from agents where org_id = current_org_id()));

drop trigger if exists trg_outbound_media_updated on outbound_media;
create trigger trg_outbound_media_updated
  before update on outbound_media
  for each row execute function set_updated_at();
