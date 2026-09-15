-- Public bucket for media sent manually from the conversation view.
-- Uploads go through signed upload URLs issued server-side (service role),
-- so no storage.objects policy is needed. The app also creates this bucket
-- on first use if the migration hasn't been applied.
insert into storage.buckets (id, name, public)
  values ('chat-media', 'chat-media', true)
  on conflict (id) do nothing;
