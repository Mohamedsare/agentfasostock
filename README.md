# FasoStock — Agent WhatsApp IA

CRM intelligent et agent WhatsApp IA pour FasoStock : support client, prospection,
qualification et conversion. Construit avec **Next.js 16 (App Router)**, **TypeScript**,
**Tailwind CSS v4**, **Supabase**, **Wasender**, **OpenAI** et **Resend**.

## Stack

- Next.js 16 (App Router, Route Handlers, Proxy)
- TypeScript strict · Tailwind v4 · shadcn-style UI · Framer Motion · Lucide
- Supabase (PostgreSQL, Auth, RLS, Realtime)
- Wasender (WhatsApp) · OpenAI (LLM configurable) · Resend (emails)

## Démarrage rapide

```bash
npm install
cp .env.example .env.local   # puis renseignez vos clés
npm run dev
```

Ouvrir http://localhost:3000.

> **Mode démo** : tant que `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
> ne sont pas renseignés, l'application tourne avec des **données fictives** et l'accès
> au dashboard n'est pas protégé — pratique pour explorer l'UI immédiatement.

## Configuration Supabase

1. Créez un projet Supabase.
2. Dans le **SQL Editor**, exécutez `supabase/migrations/0001_init.sql`
   (puis `supabase/seed.sql` pour des données de démonstration).
3. Renseignez dans `.env.local` :
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` ⚠️ la **vraie** clé `service_role`
     (Project Settings → API → `service_role`), **pas** la clé anon. Côté serveur uniquement.
4. Créez un utilisateur admin : **Authentication → Users → Add user**
   (email + mot de passe). C'est avec lui que vous vous connecterez sur `/login`.

Une fois Supabase configuré, le middleware (`proxy.ts`) protège `/dashboard` et
redirige vers `/login` si non authentifié.

## Variables d'environnement

Voir `.env.example`. Résumé :

| Variable | Rôle |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client Supabase (navigateur) |
| `SUPABASE_SERVICE_ROLE_KEY` | Client admin (webhooks/jobs) — **serveur uniquement** |
| `WASENDER_API_KEY` / `WASENDER_BASE_URL` / `WASENDER_WEBHOOK_SECRET` | WhatsApp |
| `OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_BASE_URL` | LLM (compatible OpenAI) |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` / `ADMIN_EMAIL` | Emails d'alerte |
| `APP_URL` | URL publique de l'app (liens dans les emails) |

Chaque intégration **dégrade proprement** si sa clé est absente : l'IA répond en mode
local, les messages WhatsApp/emails sont seulement journalisés.

## Structure

```
app/                     Pages (landing, login, dashboard + modules)
  dashboard/             Layout protégé + 13 modules
components/
  ui/                    Primitives (button, card, dialog, …)
  dashboard/             Sidebar, header, cartes stat, …
lib/
  supabase/              Clients browser / server / admin
  ai.ts                  Génération de réponse structurée (AgentResult)
  prompt.ts              Construction du prompt système
  scoring.ts             Scoring déterministe (0–100) + statuts
  wasender.ts            Envoi + parsing webhook WhatsApp
  email.ts               Emails Resend
  data.ts                Accès données (Supabase ou mock)
  mock-data.ts           Données de démonstration
supabase/migrations/     Schéma SQL (12 tables, RLS, triggers)
proxy.ts                 Protection des routes (ex-middleware)
```

## État d'avancement

✅ Fondations : design system, thème clair/sombre, primitives UI, types, scoring,
clients Supabase, IA, Wasender, Resend, schéma SQL.
✅ Shell : sidebar, header, auth, landing, login, **Tableau de bord** complet.
🚧 Modules métier (Conversations, Prospects, Agent, Labs, …) : emplacements prêts,
implémentation en cours.
