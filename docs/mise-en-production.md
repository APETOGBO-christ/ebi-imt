# Mise en production — EBI-IMT Business Manager

Guide de déploiement vérifié le 16 novembre 2026 sur le projet Supabase `xxilfzpkdwggfilwyrjw` (migrations **34/34** appliquées). Chaque étape porte son état : ✅ = fait et testé, ⬜ = action opérateur au déploiement.

## 1. Projet Supabase ✅
- Projet neuf créé et lié : `xxilfzpkdwggfilwyrjw` (région conseillée : la plus proche du Togo, ex. `eu-west-3`).
- Plan : gratuit au départ ; pour un usage quotidien réel, prévoir le plan Pro (mises en veille de base gratuite après 7 jours d'inactivité, quotas emailing).
- Base : 70 tables, 194 clés étrangères, 703 contraintes CHECK, 67 triggers, 169 politiques RLS. **RLS activée sur 100 % des tables**, journal d'audit FORCE RLS, TRUNCATE révoqué partout.
- Migrations : `npx supabase db push` (34/34, horodatées `202611…`). Numérotation automatique des documents vérifiée (ex. `DAO-2026-000001`).

## 2. Authentification ⬜ (console Supabase — réglages, pas de commande CLI)
- **Désactiver les inscriptions publiques** (Auth > Sign In/Up : « Disable new user signups ») : les comptes sont créés uniquement par un administrateur via la fonction `invite-user`.
- Exiger **MFA obligatoire** pour l'administration : Auth > MFA (les mutations de rôles/matrices exigent déjà `has_aal2()` côté serveur ; activer l'inscription MFA depuis la page `/securite` de l'application).
- Limiter les tentatives : Auth > Rate Limits (emails et SMS par défaut) + protéger le domaine e-mail (`Restrict email domains` si souhaité).
- Session : conserver le temps de vie par défaut ; la déconnexion journalise une entrée d'audit (`auth_logout`) via `log_auth_event`.
- Personnaliser les e-mails d'invitation (Auth > Emails) : gabarit en français avec le lien du site.

## 3. Variables d'environnement (Cloudflare Pages) ⬜
Déclarer dans Pages > Settings > Environment variables (Production **et** Preview) :
- `VITE_SUPABASE_URL` = `https://xxilfzpkdwggfilwyrjw.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY` = clé publishable (anon) — seule clé exposée au navigateur ; **jamais** la clé service_role.
- Optionnel : `VITE_APP_NAME` si le build le prévoit. Aucun secret de fonction n'est exposé au front (vérifié : la dist ne contient que la clé publishable).

## 4. Secrets des fonctions serveur ✅
Set via `npx supabase secrets set` sur le projet lié (vérifié avec `supabase secrets list`) :
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (Cloudflare R2).
- `SUPABASE_ANON_KEY` (purge/écho des JWT), `SUPABASE_DB_URL` (réconciliation R2), `SUPABASE_JWKS`.
À renouveler : tourner `R2_SECRET_ACCESS_KEY` tous les 12 mois (rotation R2 + `npx supabase secrets set`).

## 5. Fonctions Edge ✅
Déployées à chaque mise à jour via `npx supabase functions deploy <nom> --project-ref xxilfzpkdwggfilwyrjw` (ou `--use-api --use-oidc` selon l'accès). Liste : `document-upload-init`, `document-upload-confirm`, `document-download-url`, `document-delete`, `document-restore`, `r2-reconcile`, `invite-user`, `issue-proposal`. Toutes valident la session puis la permission côté base (jamais le seul token d'URL).

## 6. Bucket Cloudflare R2 ✅ (à confirmer en console) ⬜
- Bucket unique privé : `ebi-library` (nom réel dans le secret `R2_BUCKET`). **Aucun accès public** (Public access off).
- CORS appliqué au bucket (cf. `docs/security-audit.md` § S5) :
  ```json
  [{ "AllowedOrigins": ["https://ebi-imt.pages.dev", "https://<domaine-final>"],
     "AllowedMethods": ["GET", "PUT"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 }]
  ```
- Règle de cycle de vie conseillée : supprimer les objets de plus de 30 jours dans aucun état référencé (la réconciliation `r2-reconcile` fait le ménage applicatif).
- Test type MIME + taille : le flux accepte tout type déclaré par le navigateur (PDF, DOCX, XLSX, PPTX, JPEG, PNG, ZIP…) avec validation de format MIME, nom ≤ 200 caractères, taille 1 octet → 1 To, empreinte SHA-256 vérifiée à la confirmation. Limite pratique : objet unique ≤ 5 Go (PUT simple R2).

## 7. Déploiement Cloudflare Pages ⬜
1. Connecter le dépôt GitHub `APETOGBO-christ/ebi-imt` à Cloudflare Pages.
2. Build : framework `Vite`, commande `npm run build`, répertoire `dist`, Node 20+.
3. Variables d'environnement (§ 3) en Production et Preview.
4. Premier déploiement → vérifier la connexion, la 3D (CommandScene) et son repli 2D, la bibliothèque.
5. Protection : activer « Access » si l'application doit rester interne (sinon l'app est protégée par authentification Supabase et les politiques RLS).

## 8. Nom de domaine ⬜
- Ajouter le domaine dans Pages > Custom domains (ex. `gestion.ebi-imt.tg`) ; suivre les DNS (CNAME vers `ebi-imt.pages.dev`).
- Mettre à jour : CORS R2 (§ 6), gabarits d'e-mails Supabase (Site URL + redirect URLs), éventuellement `Content-Security-Policy` et HSTS au niveau Pages (cf. S7 du rapport de sécurité).
- Ajouter le domaine exact dans Auth > URL Configuration (Site URL + Redirect URLs) avant de l'utiliser.

## 9. Vérification post-déploiement (checklist d'exploitation)
1. Connexion administrateur + inscription MFA (`/securite`).
2. Inviter le premier utilisateur (`Utilisateurs`) : e-mail reçu, compte créé avec rôle.
3. Créer un appel d'offres : numéro `DAO-2026-000001` auto, transition de statut, lignes + devis, dépôt puis verrouillage des lignes, analyse par année.
4. Déposer un fichier (PDF) dans la bibliothèque : staging, publication, téléchargement, corbeille, version.
5. Créer un devis commercial → proposition → commande → paiement → PDF généré et versionné.
6. Journal d'activité : connexions (`auth_login`), modifications, téléchargements de documents.
7. Simulation de panne : bouton « Réconcilier le stock » (`r2-reconcile`, admin) et contrôle du rapport.

Références : procédures courantes dans [procedures-exploitation.md](procedures-exploitation.md) ; bilan et risques dans [rapport-final-production.md](rapport-final-production.md) ; modèle de données dans [database-schema.md](database-schema.md) ; sécurité dans [security-audit.md](security-audit.md).
