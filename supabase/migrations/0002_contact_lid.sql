-- WhatsApp LID support.
--
-- WhatsApp sometimes addresses a contact only by an opaque "@lid" identifier
-- instead of their real phone (@s.whatsapp.net). When that happened, the same
-- person was created as a second contact (keyed by the lid digits) — splitting
-- their conversation and making the agent "lose memory". We now store the lid
-- on the contact so a lid-only webhook resolves to the same person.

alter table contacts add column if not exists lid text;
create index if not exists contacts_lid_idx on contacts (lid);
