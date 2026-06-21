-- Add the 'exclu' value to the lead_status enum.
-- Used to permanently silence the AI for personal/family contacts who are not prospects.
-- Safe to re-run (IF NOT EXISTS guard via DO block).

do $$ begin
  alter type lead_status add value if not exists 'exclu';
exception when others then null; end $$;
