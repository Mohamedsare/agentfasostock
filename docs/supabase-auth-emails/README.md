# Emails AgentFS — configuration

Deux familles d'emails. Ne pas les confondre.

| Email | Émis par | Où le configurer |
|---|---|---|
| Confirmation d'inscription | **Supabase Auth** | Templates ci-dessous + SMTP Resend |
| Réinitialisation mot de passe | **Supabase Auth** | Templates ci-dessous + SMTP Resend |
| Lien magique (optionnel) | **Supabase Auth** | Template ci-dessous |
| 🎉 Bienvenue (espace prêt) | **Notre code (Resend SDK)** | déjà codé — `lib/email.ts` |
| 🚀 Alerte nouvel inscrit → super-admin | **Notre code (Resend SDK)** | déjà codé — envoyé à `SUPER_ADMIN_EMAIL` |

---

## 1. Faire passer les emails Supabase Auth par Resend (SMTP)

Par défaut Supabase envoie via son SMTP partagé (3-4 emails/heure, non fiable en prod).
Pour utiliser **Resend** :

1. **Vérifie un domaine** dans Resend (Resend → Domains → Add domain) et ajoute les
   enregistrements DNS. ⚠️ Indispensable : le domaine de test `onboarding@resend.dev`
   n'envoie qu'à ta propre adresse — inutilisable pour de vrais utilisateurs.
2. Supabase → **Project Settings → Authentication → SMTP Settings → Enable Custom SMTP** :
   - **Host** : `smtp.resend.com`
   - **Port** : `465` (SSL) ou `587` (TLS)
   - **Username** : `resend`
   - **Password** : ta clé `RESEND_API_KEY`
   - **Sender email** : une adresse de ton domaine vérifié, ex. `no-reply@tondomaine.com`
   - **Sender name** : `AgentFS`
3. Enregistre. Les emails d'auth partiront désormais via Resend.

## 2. Coller les templates

Supabase → **Authentication → Email Templates**. Pour chaque type, colle le HTML du fichier
correspondant et règle le **Subject** :

| Template Supabase | Fichier | Subject suggéré |
|---|---|---|
| Confirm signup | `confirm-signup.html` | `Confirmez votre email — AgentFS` |
| Reset Password | `reset-password.html` | `Réinitialisez votre mot de passe — AgentFS` |
| Magic Link | `magic-link.html` | `Votre lien de connexion — AgentFS` |

Variables Supabase utilisées : `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .SiteURL }}`,
`{{ .Token }}`. Ne les renomme pas.

## 3. URLs de redirection (sinon les liens cassent)

Supabase → **Authentication → URL Configuration** :
- **Site URL** : `https://fasostock-agent.vercel.app`
- **Redirect URLs** : ajoute `https://fasostock-agent.vercel.app/**`

Sans ça, le lien de confirmation/reset pointe vers `localhost` et échoue en production.

## 4. Activer la confirmation d'email

Supabase → **Authentication → Providers → Email** → active **Confirm email**.
L'utilisateur devra confirmer avant de pouvoir se connecter. (Le code redirige déjà
vers `/onboarding` après confirmation, qui crée l'organisation puis envoie l'email de bienvenue.)

## 5. Côté code (déjà fait)

- `SUPER_ADMIN_EMAIL` (défaut `mohamedsare078@gmail.com`) reçoit une alerte à chaque inscription.
- L'email de **bienvenue** part automatiquement quand l'utilisateur termine l'onboarding.
- Les deux utilisent `RESEND_FROM_EMAIL` — mets-y une adresse de ton domaine vérifié en prod.
