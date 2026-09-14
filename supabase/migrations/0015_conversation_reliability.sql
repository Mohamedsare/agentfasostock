-- Reliability fixes found in production (2026-09-14):
--  1. Know who silenced a conversation (the AI or a human) and when, so an AI
--     handoff nobody picked up can resume instead of ignoring the client forever.
--  2. Make inbound messages idempotent: a webhook Wasender re-sends while the
--     first one is still being processed can no longer produce a double reply.
--
-- Requires: 0003_multitenant. Apply in the Supabase SQL editor. Safe to re-run.

alter table conversations add column if not exists silenced_by text;        -- ai | admin | null
alter table conversations add column if not exists silenced_at timestamptz;

-- Existing AI handoffs no admin ever answered: mark them as AI-silenced so the
-- engine resumes them on the client's next message.
update conversations c
set silenced_by = 'ai', silenced_at = coalesce(c.updated_at, now())
where c.status = 'humain_requis'
  and c.mode = 'human'
  and c.silenced_by is null
  and not exists (select 1 from messages m where m.conversation_id = c.id and m.sender = 'admin');

-- Remove inbound duplicates (keep the first copy) before enforcing uniqueness.
delete from messages a
using messages b
where a.direction = 'inbound'
  and b.direction = 'inbound'
  and a.wasender_id is not null
  and a.wasender_id = b.wasender_id
  and a.agent_id is not distinct from b.agent_id
  and (a.created_at, a.id) > (b.created_at, b.id);

create unique index if not exists uq_messages_inbound_wasender
  on messages(agent_id, wasender_id)
  where direction = 'inbound' and wasender_id is not null;
