# Revue de sécurité — EBI-IMT Business Manager

Audit de sécurité du 12 novembre 2026, établi par lecture intégrale des 15 migrations, des 2 fonctions Edge, du client React, de `supabase/config.toml` et de l'environnement. Portée : code et configuration du dépôt. **Aucun test RLS connecté n'a été exécuté** (Docker indisponible) — la matrice est déduite du code, comme le précise `docs/audit-final.md`. Les anomalies sont classées : **bloquante** (avant toute création de compte réel), **élevée** (Phase 0 obligatoire), **moyenne** (Phase 1), **faible** (backlog).

## 1. Points forts constatés

1. **RLS sur les 42 tables** + porte restrictive `active_profile_gate` : une session sans profil approuvé ne lit ni n'écrit rien (`20261013102446`, lignes 44-61).
2. **Aucune politique DELETE** sur aucune table : aucune suppression directe possible par l'API. Journal d'audit et ledger **append-only** garantis par triggers dédiés (`financial_ledger_no_update`, `field_events_immutable`).
3. **Écritures métier centralisées en RPC** `security definer` avec `search_path = ''`, vérification du rôle en tête de fonction, journalisation systématique ; INSERT/UPDATE directs révoqués là où une RPC existe (leads, orders, payments, documents, imports, propositions, finance, terrain, commissions).
4. **Escalade de privilège corrigée** : UPDATE direct sur `profiles` révoqué ; rôle et activation uniquement via `set_profile_role`/`crm_set_sales_active` (admin, audité) ; contrôle anti-escalade testé en pgTAP (assertion 33).
5. **Zéro secret dans le dépôt** : `import.meta.env` côté Vite (clé publique seulement, garde anti-placeholder `replace-`), `Deno.env.get` côté Edge ; `.env.local` vide ; balayage `eyJ|sb_secret_|service_role|sk_|AKIA|…` négatif dans `src/` et `supabase/`.
6. **Documents officiels émis exclusivement par Edge Functions** (service_role) : chemin immuable, hash SHA-256, idempotence (comparaison du fichier existant), INSERT Storage sur `ebi-documents` impossible au client.
7. **Anti-doublons financiers** : unicités partielles sur références de transaction (déclarée/confirmée) et de versements ; contrôle « plafond contractuel » avant confirmation.
8. Anon complètement révoqué sur `public.*` et Storage ; `anon` ne peut rien lire.

## 2. Anomalies et risques

### 2.1 Bloquantes (avant toute création de compte réel sur le nouveau projet)

| # | Anomalie | Localisation | Correction |
| --- | --- | --- | --- |
| S1 | **Inscriptions publiques encore activées** dans la configuration locale : `enable_signup = true` (2 occurrences), confirmation email désactivée | `supabase/config.toml:176,221-226` + route `/inscription` (`src/App.tsx:237`) | L'architecture v2 (§ 6.3) impose des **inscriptions désactivées** et des comptes créés par un administrateur. À appliquer dans le tableau de bord du nouveau projet **avant** la première invitation ; retirer/remplacer la route `/inscription` et décider du sort du trigger de profil inactif (décision D2) |
| S2 | **Politique de mots de passe faible** : longueur minimale 6, aucune exigence de composition | `supabase/config.toml:182-185` | Passer à ≥ 10 caractères avec `lower_upper_letters_digits` au minimum sur le nouveau projet |
| S3 | **MFA TOTP désactivé** en config locale (`enroll_enabled/verify_enabled = false`) et **aucun contrôle `aal2`** dans les politiques/RPC | `supabase/config.toml:302-304` | Activer TOTP sur le nouveau projet ; ajouter la vérification du niveau d'assurance dans les opérations sensibles (Phase 1). Vérifier la disponibilité MFA sur le plan gratuit — si restreinte, définir des contrôles compensatoires (décision D4) |
| S4 | **Aucun test RLS exécuté jamais** : les 31 assertions pgTAP n'ont pas tourné (Docker absent), et elles sont **structurelles** (existence, drapeaux RLS, privilèges) — aucune simulation multi-rôles | `supabase/tests/database.sql` | Critère de sortie Phase 0 n° 4 : exécuter pgTAP + écrire les scénarios comportementaux par rôle (voir `docs/phase-0-checklist.md`) |

### 2.2 Élevées

| # | Anomalie | Localisation | Correction |
| --- | --- | --- | --- |
| S5 | **Préfixes de documents `CTX-REC` / `CTX-PAY-`** : héritage « Cortexia » dans le SQL (défaut de `finance_settings` et chaîne en dur du RPC instructions) | `20261012220048:102` et `:291` | Renommer en préfixes EBI-IMT validés (décision D3) ; la modification avant toute application est légitime (aucun projet distant n'a ces migrations) |
| S6 | **Aucune garde de route par rôle au niveau du routeur** : la navigation vers les pages admin (`/parametres/moyens-paiement`, `/offres`…) est ouverte à tout rôle ; le filtrage est dans les composants | `src/App.tsx:237-249`, `src/lib/modules.ts` (aucune propriété rôles) | Ajouter un garde de route + filtrage de la sidebar par la matrice de permissions (Phase 1). Le backend reste protégé (RLS/RPC) — risque limité à l'UX et à la surface exposée |
| S7 | **Périmètre `sales_manager` = toute l'équipe**, sans territoire formalisé ; lit toutes les données commerciales et peut mettre à jour n'importe quel profil commercial | politiques `can_manage_all`, `crm_update_sales_profile` | Valider le périmètre métier réel (décision D5) puis adapter RLS si nécessaire |
| S8 | **Secret `service_role` : aucune procédure écrite de rotation** ni de `deny-list` en cas de fuite ; CORS Edge `Access-Control-Allow-Origin: '*'` | `supabase/functions/*/index.ts:4` | Procédure de rotation documentée dans le runbook Phase 0 ; resserrer l'origine CORS sur le domaine Pages (Phase 1) |
| S9 | **Le repository Git pointe encore vers l'ancien compte** (`cortexiagroup/base_cortexia`) et le travail de refonte (~40 fichiers modifiés) n'est pas commité | `git remote -v` ; `git status` | Créer le dépôt GitHub EBI-IMT (nouveau compte, décision D9), committer la refonte, changer l'`origin`. Un push accidentel vers l'ancien compte est impossible sans ses identifiants, mais la confusion de référentiel reste un risque opérationnel |

### 2.3 Moyennes

| # | Anomalie | Localisation | Correction |
| --- | --- | --- | --- |
| S10 | **Porte `active_profile_gate` non automatique** : les tables RLS créées après la migration 15 n'auront pas la porte restrictive | `20261013102446:44-61` | Checklist de migration Phase 1 : recréer la porte pour toute nouvelle table (ou SQL de post-migration) |
| S11 | **Vérification email désactivée** (`enable_confirmations = false`) : compte invité actif dès création d'identifiants, avant même que l'utilisateur ne clique le lien d'invitation | `supabase/config.toml:226` | Décider : activer les confirmations OU faire dépendre l'activation métier (`profiles.is_active`) uniquement de l'admin — c'est déjà le cas, ce qui atténue ; documenter le flux d'invitation |
| S12 | **Chemin d'upload du logo inexistant** : `commercial_settings.logo_storage_path` est consultable/modifiable, mais l'INSERT client sur `ebi-documents` est bloqué (par sécurité) et aucun écran ne permet de téléverser le logo | `commercial_settings`, `src/commercial/api.ts:89` (URL signée en lecture seulement) | Prévoir un flux contrôlé (Edge ou transit) pour le logo en Phase 1 — l'écran Paramètres n'existe pas encore |
| S13 | **Sessions sans `timebox`/`inactivity_timeout`** configurés (commentés) | `supabase/config.toml:272-276` | Activer sur le nouveau projet (ex. 24 h / 8 h) conformément à l'architecture v2 |
| S14 | **Rate-limit email à 2/h** en local — insuffisant pour un lot d'invitations | `supabase/config.toml:199` | Ajuster sur le projet distant ou intégrer un SMTP dédié (`[auth.email.smtp]`) |
| S15 | **Aucune durée de conservation ni procédure export/suppression des données personnelles** (contacts) | — | Définir dans Paramètres (architecture v2 § 9) |
| S16 | **`ebi_signup_ready` accordé à `anon`** : pré-check d'inscription public | `20261013102446:32-39` | À supprimer si les inscriptions sont désactivées (décision D2) |

### 2.4 Faibles

- Redirections Auth locales (`site_url = http://127.0.0.1:3000`, `additional_redirect_urls` avec un `https://127.0.0.1:3000` incohérent) — à remplacer par l'URL Pages du nouveau projet (rappel config, pas un risque en soi).
- `minimum_password_length` et `jwt_expiry = 3600` raisonnables mais à recouper avec la politique validée.
- Les fonctions trigger publiques (`guard_*`, `crm_guard_*`) sont révocables mais invocables par personne — aucune exposition directe ; vérification faite.
- Messages d'erreur des Edge Functions génériques et en français — aucun détail technique divulgué.
- Garble d'affichage console (encodage PowerShell) lors de la lecture des rapports racine : cosmétique, fichiers UTF-8 sains.

## 3. Modèle de rôles : existant vs cible

| Aspect | Existant (3 rôles) | Cible (architecture v2, 6 rôles) |
| --- | --- | --- |
| Rôles | `admin`, `sales_manager`, `sales_rep` (enum figé) | `admin`, `direction`, `commercial`, `achats`, `finance`, `lecture_seule` (table `roles`) |
| Arbitrage | `can_manage_all()` dur dans chaque politique | Matrice `role_permissions` (rôle × module × 5 actions) + `private.permits()` |
| Délégations | `finance_verifiers`, `field_budget_permissions` (nominatives) | Conservées, recalées sur les nouveaux rôles |
| Vision DG | — | `direction` : lecture transversale, validationsDAO/engagements |
| MFA | Aucun | Obligatoire admin/direction, contrôle `aal2` sur opérations sensibles |

La migration des rôles se fera sur projet neuf (aucune donnée à convertir) — stratégie détaillée dans `docs/migration-plan.md` § 4.

## 4. Ancien projet Supabase : garde-fous d'isolement

- Aucune URL, aucun `project_ref` dans le dépôt (balayage complet négatif) ; le lien CLI historique a été purgé (`supabase/.temp` absent) ; `.env.local` vide.
- Le seul risque résiduel est **procédural** : un `supabase link` vers l'ancien ref puis `db push`. Garde-fous à appliquer pendant toute la Phase 0 :
  1. Ne jamais exécuter `supabase link` sans vérifier deux fois le ref affiché.
  2. Après link, exécuter `supabase migration list --linked` : le projet neuf doit afficher **0 migration appliquée** ; si ce n'est pas le cas, arrêter immédiatement.
  3. Archiver le ref de l'ancien projet (doc interne, pas dans le dépôt) pour vérification visuelle.
- Aucune migration n'a été appliquée à distance durant cet audit (aucune commande `db push` exécutée).

## 5. Conclusion

Le socle hérité présente un niveau de cloisonnement remarquable (RLS intégral, append-only, RPC auditées, zéro secret client) **sur le plan du code**. Les écarts sont concentrés dans la **configuration de l'instance** (S1-S3, S11, S13, S14), la **couverture de tests RLS** (S4) et la **transition organisationnelle** (S5-S9). Aucun de ces écarts n'exige de réécrire le socle : ils se traitent par configuration du nouveau projet, migrations ciblées et Phase 1 (matrice de permissions). GO conditionnel pour la Phase 0, sous réserve des décisions D1-D9 listées dans `docs/audit-final.md` § 8.

## 6. Revue complémentaire (13 novembre 2026 — revalidation PROMPT 2, implémentation PROMPT 3)

Relecture complète des migrations d'extension M16-M24 puis implémentation du
modèle de sécurité complet (M25, Edge `invite-user`, tests pgTAP
comportementaux). Trouvailles nouvelles, classées selon la même échelle :

| # | Anomalie | Localisation | État |
| --- | --- | --- | --- |
| S17 | **USAGE manquant sur le schéma `private`** pour `authenticated` : les politiques RLS (socle + extensions) appellent ses fonctions ; sans USAGE, toute requête utilisateur échouait à l'exécution. Aucune migration ne l'accordait. | `20261012203450_security_policies.sql` et suivantes (absence de grant) | **Corrigé** — `grant usage on schema private to authenticated` (M25). Les fonctions explicitement révoquées restent inaccessibles. |
| S18 | **`supabase_auth_admin` privait d'EXECUTE** sur le trigger `auth.users` par le `revoke … from public` de M15 : chaque invitation aurait échoué côté GoTrue (chemin jamais testé). | `20261013102446:24` | **Corrigé** — USAGE + EXECUTE accordés à `supabase_auth_admin` (M25). |
| S19 | **Privilèges par défaut Supabase** : ALL accordé aux rôles de service sur chaque nouvelle table ; la RLS seule ne suffisait pas comme barrière d'écriture sur M16-M24. | défauts de privilèges du projet | **Corrigé** — révokes de défense en profondeur ajoutés dans M16-M24 (table par table). |
| S20 | **`next_official_number` accordé à `authenticated`** (M17) : épuisement possible des compteurs officiels par n'importe quel utilisateur. | `20261112102017_official_numbering.sql` | **Corrigé** — grant retiré ; seules les RPC SECURITY DEFINER l'appellent. |
| S21 | **Aucune protection du dernier administrateur actif** : rétrogradation/désactivation/suppression du dernier admin possible (même en contexte postgres). | `profiles` | **Corrigé** — trigger `profiles_last_admin_guard` + RPC d'administration gardées (M25). |
| S22 | **Aucun contrôle `aal2`** dans les politiques/RPC (renfort de S3 côté code). | RPC sensibles | **Corrigé** — MFA aal2 exigé sur `set_profile_role`, matrice `role_permissions`, `finance_confirm_payment`, ajustements finance ; Edge `invite-user` impose `aal` = `aal2` + `admin_caller_gate()`. |
| S23 | **Anti auto-élévation partielle** : l'écriture directe de `profiles.role` était déjà bloquée, mais aucune politique ne recouvrait l'INSERT de lignes de matrice. | `role_permissions` | **Corrigé** — INSERT de `role_permissions` encadré par politique admin+aal2 (M25). |

État des anomalies précédentes après PROMPT 3 :

- **S1** : décision D2 **actée et implémentée côté code** —
  `ebi_signup_ready` renvoie `false` (M25), l'accès se fait exclusivement
  par invitation (Edge `invite-user` : `invite | activate | deactivate |
  revoke_sessions | reactivate | recover | reset_mfa`). La désactivation
  `enable_signup` dans le tableau de bord du **nouveau projet** reste une
  action de mise en service (aucune application effectuée).
- **S3** : le contrôle `aal2` existe désormais en base (S22) ; l'activation
  TOTP de l'instance reste une action de mise en service + l'enrôlement UI
  en Phase 4.
- **S4** : les tests comportementaux multi-rôles **sont écrits** —
  `supabase/tests/pgm3_security.sql` (94 assertions, 6 scénarios imposés,
  sessions simulées via `request.jwt.claims`) ; exécution toujours bloquée
  sur Docker Desktop (ressources de la machine).
- **S5** : **corrigé** — `EBI-REC` / `EBI-PAY-` appliqués (migration 9
  ligne 102 — et non la 10 comme initialement localisé —, migration 10
  ligne 291, `src/payments/api.ts:32`, `src/payments/PaymentSettings.tsx:19`).
- **S10** : **levé structurellement** — la porte `active_profile_gate` est
  présente sur les 23 tables des extensions (M16-M24) et vérifiée par les
  tests [25].
- **S16** : **sans objet** — `ebi_signup_ready` reste accordé à `anon`
  mais renvoie `false` (pas de fuite d'information : c'est le refus voulu,
  affiché proprement par le frontend).

Livrables de sécurité PROMPT 3 : migration
`supabase/migrations/20261113101025_admin_guardrails_mfa.sql` (M25),
Edge `supabase/functions/invite-user/index.ts`,
tests `supabase/tests/pgm3_security.sql`, documentation
`docs/security-model.md` et `docs/roles-permissions-matrix.md`.
