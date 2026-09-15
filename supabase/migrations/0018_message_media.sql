-- Files received from contacts (photos, voice notes, videos, documents) are
-- copied to the public `chat-media` bucket so the dashboard can show them.
-- `content` keeps the text the agent reasons about (description, transcript).
alter table messages add column if not exists media_url text;
alter table messages add column if not exists media_type text
  check (media_type in ('image', 'video', 'audio', 'document'));
