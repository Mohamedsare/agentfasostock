-- Per-agent switch for automatic follow-ups (relances).
-- false = no follow-up is scheduled or sent for this agent.
--
-- Requires: 0003_multitenant. Safe to re-run.

alter table agents add column if not exists follow_ups_enabled boolean not null default true;
