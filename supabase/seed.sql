-- Optional demo data for FasoStock. Run after 0001_init.sql.
-- Safe to run multiple times (uses fixed UUIDs + upserts where relevant).

insert into knowledge_base (title, content, category, is_active) values
  ('Qu''est-ce que FasoStock ?', 'Application simple de gestion de stock et de ventes pour les commerçants en Afrique de l''Ouest.', 'presentation', true),
  ('Fonctionnalités principales', 'Suivi du stock en temps réel, alertes de rupture, enregistrement des ventes, rapports, multi-boutiques.', 'fonctionnalites', true),
  ('Démonstration gratuite', 'Démonstration personnalisée de 20 minutes offerte, par appel WhatsApp.', 'demonstration', true),
  ('Objection : c''est trop cher', 'Rappeler que FasoStock évite les pertes liées aux ruptures et au vol, et se rembourse vite.', 'objections', true)
on conflict do nothing;

with c as (
  insert into contacts (phone, name, business_type, city, need, source) values
    ('22670112233','Awa Ouédraogo','Boutique de cosmétiques','Ouagadougou','Suivre son stock','whatsapp'),
    ('22675445566','Issouf Traoré','Quincaillerie','Bobo-Dioulasso','Gérer plusieurs références','whatsapp'),
    ('22678990011','Fatim Sawadogo','Grossiste alimentaire','Ouagadougou','Voir une démo','whatsapp')
  on conflict (phone) do update set name = excluded.name
  returning id, phone
)
insert into conversations (contact_id, status, score, mode, intent, summary, next_action, last_message_preview)
select
  c.id,
  case c.phone when '22670112233' then 'prospect_chaud'::lead_status
               when '22675445566' then 'prospect_qualifie'::lead_status
               else 'prospect_qualifie'::lead_status end,
  case c.phone when '22670112233' then 88 when '22675445566' then 74 else 71 end,
  'ai'::conversation_mode,
  'demo'::intent_type,
  'Prospect intéressé par FasoStock.',
  'Planifier une démonstration.',
  'Super, je suis dispo cette semaine 👍'
from c
where not exists (select 1 from conversations cv where cv.contact_id = c.id);
