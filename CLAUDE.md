@AGENTS.md

# CLAUDE.md — FasoStock WhatsApp AI Agent

## 1. Mission du projet

Construire une application web complète pour FasoStock permettant de gérer un agent WhatsApp IA de support client, prospection, qualification et conversion commerciale.

L’application doit permettre de :

- Recevoir les messages WhatsApp via Wasender API.
- Répondre automatiquement aux prospects et clients avec une IA.
- Sauvegarder toutes les conversations dans Supabase.
- Qualifier les prospects automatiquement.
- Catégoriser les clients selon leur niveau d’intérêt.
- Envoyer un email automatique quand un prospect est qualifié ou converti.
- Fournir un dashboard admin ultra moderne pour tout gérer.
- Permettre à Mohamed de reprendre manuellement une conversation.
- Offrir un module Labs pour tester prompts, scénarios, agents et automatisations.

## 2. Stack obligatoire

Utiliser :

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- Framer Motion
- Lucide React
- Supabase
- Supabase Auth
- Supabase PostgreSQL
- Supabase Realtime
- Wasender API
- Resend pour les emails
- OpenAI API ou autre provider LLM configurable

Ne pas utiliser de backend séparé au début.
Utiliser les Route Handlers Next.js pour les endpoints API.

## 3. Objectif produit

L’application doit se comporter comme un mini CRM intelligent pour FasoStock.

Elle ne doit pas être un simple chatbot.
Elle doit gérer :

- Conversations
- Prospects
- Clients
- Support
- Scoring
- Qualification
- Relances
- Emails automatiques
- Statistiques
- Base de connaissance
- Configuration IA
- Tests Labs

## 4. Design UI/UX

Créer une interface premium, moderne, rapide et responsive.

Style attendu :

- SaaS professionnel africain moderne.
- Interface claire, élégante, très propre.
- Animations fluides avec Framer Motion.
- Dashboard ultra soigné.
- Cartes statistiques élégantes.
- Tableaux propres.
- Sidebar moderne.
- Header minimaliste.
- Mode clair/sombre si possible.
- Utiliser shadcn/ui proprement.
- Ne pas faire une interface basique.

Palette recommandée :

- Vert principal : #16A34A
- Noir : #111827
- Blanc : #FFFFFF
- Gris clair : #F8FAFC
- Orange accent : #F97316

## 5. Modules principaux à créer

Créer les modules suivants :

1. Dashboard général
2. Conversations WhatsApp
3. Prospects
4. Clients qualifiés
5. Support client
6. Agent IA
7. Base de connaissance
8. Relances automatiques
9. Emails automatiques
10. Labs IA
11. Statistiques
12. Paramètres
13. Authentification admin

## 6. Dashboard général

Le dashboard doit afficher :

- Nombre total de conversations.
- Nouveaux prospects.
- Prospects chauds.
- Prospects qualifiés.
- Clients convertis.
- Conversations en attente.
- Taux de conversion.
- Messages traités par l’IA.
- Derniers prospects.
- Dernières conversations.
- Alertes importantes.

Ajouter des graphiques simples si pertinent.

## 7. Module Conversations WhatsApp

Créer une page `/dashboard/conversations`.

Elle doit afficher :

- Liste des conversations.
- Nom ou numéro du contact.
- Dernier message.
- Statut.
- Score.
- Date du dernier message.
- Filtre par statut.
- Recherche par nom ou numéro.

Créer une vue détail conversation avec :

- Historique complet des messages.
- Messages envoyés par le client.
- Messages envoyés par l’IA.
- Messages envoyés par l’admin.
- Résumé IA de la conversation.
- Score du prospect.
- Bouton “Reprendre manuellement”.
- Bouton “Réactiver l’IA”.
- Champ pour envoyer un message manuel.
- Bouton pour marquer comme qualifié.
- Bouton pour marquer comme converti.

## 8. Module Prospects

Créer une page `/dashboard/prospects`.

Afficher :

- Nom
- Téléphone
- Activité
- Ville
- Besoin
- Score
- Statut
- Source
- Dernière interaction
- Prochaine action recommandée

Statuts possibles :

- nouveau
- prospect_froid
- prospect_tiede
- prospect_chaud
- prospect_qualifie
- client_converti
- support_client
- humain_requis
- spam
- perdu

## 9. Scoring des prospects

Créer une logique de scoring sur 100.

Critères :

- Donne son activité : +15
- Donne sa ville : +10
- A un vrai commerce : +20
- Exprime un problème de gestion : +25
- Demande le prix : +15
- Demande une démonstration : +25
- Donne une date de disponibilité : +20
- Dit qu’il est intéressé : +20
- Refuse clairement : -30
- Message non pertinent : -20
- Spam ou insulte : -50

À partir de 70 :

- statut = prospect_qualifie
- envoyer email automatique à Mohamed
- créer une alerte dashboard

À partir de 85 :

- statut = prospect_chaud
- recommander un appel rapide

## 10. Module Clients qualifiés

Créer une page `/dashboard/qualified-leads`.

Afficher uniquement les prospects qualifiés et chauds.

Actions :

- Voir conversation
- Envoyer message WhatsApp
- Marquer comme converti
- Marquer comme perdu
- Ajouter note
- Planifier relance

## 11. Module Support Client

Créer une page `/dashboard/support`.

Objectif :

- Gérer les clients existants.
- Répondre aux problèmes.
- Détecter les demandes urgentes.
- Transférer à un humain si nécessaire.

Types de support :

- Problème de connexion
- Problème de stock
- Problème de vente
- Demande de formation
- Demande de prix
- Demande de démonstration
- Autre

## 12. Module Agent IA

Créer une page `/dashboard/agent`.

Elle doit permettre de configurer :

- Nom de l’agent
- Ton de réponse
- Langue principale
- Message d’accueil
- Prompt système
- Règles de qualification
- Règles de transfert humain
- Seuil de prospect qualifié
- Activation/désactivation IA
- Mode support
- Mode prospection
- Mode hybride

## 13. Prompt système de l’agent

L’agent doit :

- Se présenter comme assistant FasoStock.
- Répondre naturellement en français.
- Utiliser un ton professionnel, simple et humain.
- Poser des questions courtes.
- Ne jamais inventer de prix ou de fonctionnalité.
- Qualifier le prospect progressivement.
- Ne pas envoyer de longs paragraphes.
- Adapter son discours au type de commerce.
- Toujours chercher à comprendre le besoin.
- Proposer une démonstration si le prospect est intéressé.
- Transférer à Mohamed si la demande est complexe.

## 14. Base de connaissance

Créer une page `/dashboard/knowledge-base`.

Fonctions :

- Ajouter une information
- Modifier une information
- Supprimer une information
- Activer/désactiver une information
- Classer par catégorie

Catégories :

- Présentation FasoStock
- Fonctionnalités
- Prix
- Démonstration
- Support
- Objections commerciales
- FAQ
- Conditions

L’agent IA doit utiliser cette base avant de répondre.

## 15. Module Labs IA

Créer une page `/dashboard/labs`.

Ce module sert à tester et améliorer l’agent.

Fonctions Labs :

- Simuler une conversation WhatsApp.
- Tester un prompt système.
- Tester différents tons.
- Tester une objection client.
- Tester une qualification de prospect.
- Voir le score généré.
- Voir le statut prédit.
- Voir l’email qui serait envoyé.
- Comparer plusieurs réponses IA.
- Sauvegarder un prompt performant.

Créer une interface très élégante pour les Labs.

## 16. Relances automatiques

Créer une logique de relance.

Règles :

- Relance 1 après 24h sans réponse.
- Relance 2 après 3 jours.
- Relance 3 après 7 jours.
- Ne jamais dépasser 3 relances.
- Stopper les relances si le prospect répond.
- Stopper les relances si le prospect refuse.
- Stopper les relances si statut = client_converti.

Créer une page `/dashboard/follow-ups`.

## 17. Emails automatiques

Utiliser Resend.

Envoyer un email à Mohamed quand :

- Prospect qualifié.
- Prospect chaud.
- Client converti.
- Demande humaine urgente.
- Problème support important.

Email à envoyer :

- Nom du prospect
- Téléphone
- Activité
- Ville
- Score
- Statut
- Besoin détecté
- Résumé IA
- Derniers messages importants
- Action recommandée

## 18. Wasender API

Créer un service `lib/wasender.ts`.

Il doit gérer :

- Envoi de message texte
- Réception webhook
- Validation payload
- Gestion des erreurs
- Logs
- Retry simple si échec

Ne jamais hardcoder les clés.
Utiliser les variables d’environnement.

## 19. Variables d’environnement

Prévoir :

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
WASENDER_API_KEY=
WASENDER_BASE_URL=
OPENAI_API_KEY=
RESEND_API_KEY=
ADMIN_EMAIL=
APP_URL=

## 20. Webhook WhatsApp

Créer endpoint :

`POST /api/webhooks/wasender`

Ce endpoint doit :

- Recevoir le message entrant.
- Identifier ou créer le contact.
- Créer ou récupérer la conversation.
- Sauvegarder le message.
- Générer une réponse IA si l’agent est activé.
- Mettre à jour le scoring.
- Mettre à jour le statut.
- Envoyer la réponse via Wasender.
- Envoyer un email si prospect qualifié.
- Retourner une réponse HTTP propre.

## 21. API interne

Créer les endpoints nécessaires :

- `/api/agent/respond`
- `/api/agent/classify`
- `/api/wasender/send`
- `/api/emails/qualified-lead`
- `/api/labs/simulate`
- `/api/follow-ups/run`

## 22. Base de données Supabase

Créer les tables suivantes :

- profiles
- contacts
- conversations
- messages
- lead_qualifications
- knowledge_base
- agent_settings
- email_notifications
- follow_ups
- lab_tests
- notes
- audit_logs

Ajouter les champs nécessaires pour chaque table.
Ajouter created_at et updated_at partout.
Ajouter les index utiles.
Prévoir les relations entre tables.

## 23. Authentification

Créer une authentification admin avec Supabase Auth.

Pages :

- `/login`
- `/dashboard`

Protéger toutes les pages dashboard.
Rediriger vers `/login` si non connecté.

## 24. Sécurité

Ne jamais exposer :

- SUPABASE_SERVICE_ROLE_KEY
- WASENDER_API_KEY
- OPENAI_API_KEY
- RESEND_API_KEY

Valider les payloads avec Zod.
Gérer les erreurs proprement.
Logger les actions importantes.
Ne jamais afficher de secrets côté client.

## 25. Règles IA importantes

L’IA doit toujours retourner une structure exploitable :

{
"reply": "message à envoyer",
"intent": "support|prospection|pricing|demo|other",
"status": "prospect_froid|prospect_tiede|prospect_chaud|prospect_qualifie|client_converti|humain_requis",
"score": 0,
"summary": "résumé court",
"next_action": "action recommandée",
"should_notify_admin": true
}

## 26. Qualité de code

Exigences :

- Code propre
- TypeScript strict
- Composants réutilisables
- Architecture claire
- Pas de duplication inutile
- Gestion des erreurs
- Loading states
- Empty states
- Responsive design
- Accessibilité correcte
- Nommage professionnel

## 27. Structure recommandée

Créer une structure claire :

app/
dashboard/
api/
components/
components/dashboard/
components/conversations/
components/prospects/
components/labs/
lib/
lib/supabase/
lib/wasender.ts
lib/ai.ts
lib/email.ts
lib/scoring.ts
lib/types.ts
lib/validations.ts

## 28. Pages à livrer

Livrer au minimum :

- `/`
- `/login`
- `/dashboard`
- `/dashboard/conversations`
- `/dashboard/conversations/[id]`
- `/dashboard/prospects`
- `/dashboard/qualified-leads`
- `/dashboard/support`
- `/dashboard/agent`
- `/dashboard/knowledge-base`
- `/dashboard/follow-ups`
- `/dashboard/labs`
- `/dashboard/settings`

## 29. Landing page

Créer aussi une landing page simple pour présenter le produit interne :

- Hero FasoStock WhatsApp AI Agent
- Avantages
- Fonctionnalités
- Aperçu dashboard
- CTA connexion admin

## 30. Données mock

Si Supabase n’est pas encore connecté, créer des données mock propres.
Dès que Supabase est configuré, connecter les vraies données.
Ne pas bloquer le développement à cause des clés manquantes.

## 31. Attitude attendue de Claude

Travailler de manière autonome.
Ne pas poser trop de questions.
Prendre les meilleures décisions produit.
Construire une première version complète et cohérente.
Si une information manque, utiliser une valeur par défaut propre.
Documenter les étapes importantes.
Corriger les erreurs automatiquement.
Prioriser un MVP fonctionnel, beau et extensible.

## 32. Résultat final attendu

À la fin, l’application doit permettre à Mohamed de :

- Connecter son numéro WhatsApp via Wasender.
- Recevoir les messages des prospects.
- Laisser l’IA répondre automatiquement.
- Voir toutes les conversations.
- Identifier les prospects chauds.
- Recevoir des emails pour les prospects qualifiés.
- Gérer les clients depuis un dashboard premium.
- Tester et améliorer l’agent dans Labs.
- Reprendre manuellement une conversation quand nécessaire.

Construire maintenant l’application complète avec cette vision.
