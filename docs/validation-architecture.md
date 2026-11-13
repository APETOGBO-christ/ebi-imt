# Validation architecturale — EBI-IMT Business Manager

Document préparé pour la validation définitive de l'architecture avant la Phase 1. Version : 12 novembre 2026. Aucune migration n'a été appliquée sur un projet Supabase et aucune ressource n'a été supprimée.

Note : les précisions validées ensuite par la direction (permissions granulaires, cycle de vie documentaire, sauvegardes, sécurité des comptes, héritage détaillé, performances, critères de sortie de la Phase 0) sont intégrées dans la **version 2** de `docs/architecture-ebi-imt.md` (avec Annexe A : inventaire complet des 42 tables héritées). Ce document reste la photographie de l'état de référence.

---

## 1. Architecture générale

### 1.1 Vue d'ensemble

```text
                          NAVIGATEUR (React)
   Cloudflare Pages ← build Vite (React 19 + TypeScript strict + Tailwind 4)
         │  clés publiques uniquement (URL + clé publishable)
         ▼
   Supabase Auth ──► JWT de session
         ▼
   API PostgreSQL (PostgREST) ──► lecture/écriture directe filtrée par RLS
         ▼
   Fonctions RPC (security definer) ──► workflows transactionnels (ventes,
                                        encaissements, terrain, imports)
         ▼
   Edge Functions (Deno) ──► génération PDF officielle, futur : URL pré-signées R2
         ▼
   Stockage : Supabase Storage aujourd'hui ──► Cloudflare R2 (phase 1)
         ▼
   Sauvegardes physiques : pg_dump + fichiers → deux disques externes indépendants
```

Principe directeur : **le navigateur ne fait confiance à rien**. Chaque lecture et chaque écriture est arbitrée par PostgreSQL (RLS) ; les opérations qui exigent une transaction ou un privilège passent par des fonctions SQL contrôlées ; les opérations qui exigent un secret passent par des Edge Functions.

### 1.2 Architecture du frontend React

| Élément | Implémentation |
| --- | --- |
| Squelette | `src/main.tsx` → `src/App.tsx` : routes React Router 7, garde `Protected` (session + profil actif requis), enveloppe `Shell` (topbar, sidebar, fil d'ariane) |
| Authentification | `src/lib/auth.tsx` : contexte React, session Supabase, profil lié à `auth.users`, étiquettes de rôles, déconnexion |
| Registre des modules | `src/lib/modules.ts` : 14 modules déclarés (icône, chemin, description) ; la navigation et les pages provisoires en dérivent automatiquement |
| Tableau de bord | `src/components/CommandScene.tsx` : scène 3D isométrique (six zones), chargement différé, repli 2D sur mobile/absence WebGL, panneau d'inspection alimenté par `src/lib/dashboard.ts` (comptages soumis à RLS) |
| Modules métier | `src/crm` (Prospects, Commerciaux, Activités, Imports), `src/commercial` (Offres, Propositions, Commandes), `src/payments` (Paiements, Détail, Comptes officiels, Paiements de commande), `src/field` (Dépenses terrain, Commissions, Rapports) |
| Accès aux données | Un `api.ts` par module : requêtes PostgREST filtrées par RLS + appels RPC pour les workflows ; aucun framework d'état additionnel ; rafraîchissement du tableau de bord par événement `ebi:crm-changed` |
| Design | `src/styles.css` (tokens visuels, composants) + Tailwind 4 + `src/components/ui/button.tsx` (Radix) — conservé tel quel, décision validée |
| Types | `src/types/domain.ts` : sous-ensemble métier maintenu à la main ; les types générés Supabase attendent une base connectée |

### 1.3 Rôle précis de Supabase

| Service | Rôle dans EBI-IMT Business Manager |
| --- | --- |
| **Supabase Auth** | Identité (email + mot de passe), JWT de session, confirmation d'email, inscriptions en libre-service créant un profil **inactif** qui attend l'activation d'un administrateur. MFA TOTP prévu pour les administrateurs (phase 0). |
| **API PostgreSQL (PostgREST)** | C'est l'API. Exposée à `authenticated` uniquement (`anon` révoqué) ; chaque table est filtrée par RLS. Les écritures directes sensibles sont révoquées et remplacées par des RPC. |
| **Fonctions RPC (security definer)** | Workflows transactionnels : attribution/imports CRM, soumission→approbation→commande commerciale, déclaration/vérification d'encaissement, émission de documents, dotations/avances/restitutions, commissions. Vérification de rôle **dans** la fonction, pas seulement côté interface. |
| **Edge Functions (Deno)** | `issue-proposal` (PDF de proposition officiel), `issue-finance-document` (reçus et fiches d'instructions). `service_role` disponible uniquement dans ce contexte. Futures : signature d'URL R2, notifications. |
| **Storage Supabase** | Quatre buckets privés actuels (voir § 3). |

### 1.4 Rôle de PostgreSQL

- **Source unique de vérité** : toutes les données métier, y compris les instantanés immuables (`offer_snapshot` dans les propositions et commandes) qui survivent à l'évolution du catalogue.
- **Application de la sécurité** : RLS activé sur les 42 tables, fonctions de rôle privées (`private.current_app_role`, `private.can_manage_all`, `private.crm_actor`, `private.field_can_manage`) invisibles de l'API, schéma `private` non exposé.
- **Intégrité métier** : montants FCFA en `bigint` entiers, contraintes d'état (ex. un paiement `confirmed` exige un vérificateur), triggers `updated_at`, normalisation des téléphones togolais (+228), protection des écritures financières (append-only, corrections traçables), journal `audit_logs` append-only indexé par entité, numérotation unique (`order_number`, `document_number`).
- **Transactions atomiques** : les imports et les confirmations d'encaissement s'exécutent en une seule transaction (tout ou rien).

### 1.5 Authentification et permissions

- Un compte Auth seul ne donne **aucun** accès : une politique restrictive (`active_profile_gate`) verrouille toutes les tables publiques et `storage.objects` tant que le profil n'est pas actif.
- L'inscription en libre-service crée un profil inactif de rôle `sales_rep` ; le rôle ne peut jamais être choisi par le navigateur.
- Le changement de rôle passe exclusivement par `private.set_profile_role` (admin uniquement, audité) ; l'UPDATE direct de `profiles` est révoqué (migration 13, corrige une élévation de privilège).
- Matrice actuelle : `admin` (gouvernance complète, validation financière), `sales_manager` (supervision commerciale ; droits financiers terrain uniquement après délégation nominative), `sales_rep` (son périmètre attribué uniquement).
- Matrice cible EBI-IMT (phase 1, à confirmer) : `admin`, `direction`, `commercial`, `achats`, `finance`, `lecture_seule`.

### 1.6 Architecture de stockage documentaire

État actuel et cible sont détaillés en § 3 (question posée). Synthèse : métadonnées dans PostgreSQL (table `documents` : chemin, numéro, empreinte SHA-256, liens), fichiers dans des buckets privés — Supabase Storage aujourd'hui, Cloudflare R2 à partir de la phase 1 avec URL pré-signées émises par Edge Functions après contrôle d'autorisation.

### 1.7 Architecture de déploiement

| Composant | Choix | État |
| --- | --- | --- |
| Frontend | Cloudflare Pages, déploiement automatique depuis GitHub, `_redirects` SPA, variables d'environnement = URL + clé publishable | À configurer (décision validée ; compte Cloudflare à créer) |
| Base + Auth + RPC | Projet Supabase neuf, migrations CLI, environnement local Docker pour les tests | Projet à créer |
| Edge Functions | Déployées sur le projet Supabase après recette locale | Code prêt, non déployé |
| Stockage | Cloudflare R2 + Edge presigner | Phase 1 |
| Sauvegardes | Script `pg_dump` planifié + copies des fichiers + deux disques externes | Phase 5 (exercice de restauration testé) |

---

## 2. Base de données

### 2.1 Schéma actuel : 42 tables, 14 migrations

Toutes les tables sont en schéma `public` (RLS activé), avec des fonctions auxiliaires dans `private` et les buckets dans `storage`.

| # | Migration | Contenu (tables) |
| --- | --- | --- |
| 1 | `20261012203448_foundation_schema.sql` | `profiles`, `companies`, `contacts`, `leads`, `activities`, `offer_templates`, `orders`, `payments`, `documents`, `expense_policies`, `expenses`, `commission_policies`, `commissions`, `production_projects`, `audit_logs`, `import_batches`, `import_rows` (17) + enums + triggers |
| 2 | `20261012203450_security_policies.sql` | (aucune table) helpers privés, RLS initiale, RPC `confirm_payment` et `set_profile_role` |
| 3 | `20261012203451_storage_and_seed_helpers.sql` | (buckets) `cortexia-documents`→`ebi-documents`, `cortexia-imports`→`ebi-imports` + normalisation téléphone + RLS forcée sur `audit_logs` |
| 4 | `20261012210902_crm_operations.sql` | `appointments`, `follow_ups`, `lead_assignments` (3) + RPC CRM + révoquations |
| 5 | `20261012210915_crm_rpc_and_import.sql` | (aucune table) RPC `crm_search_leads`, `crm_save_lead`, `crm_prepare_import`, `crm_commit_import`… |
| 6 | `20261012212909_commercial_offers_proposals.sql` | `commercial_settings`, `commercial_proposals`, `commercial_proposal_events`, `order_installments`, `commercial_order_events` (5) |
| 7 | `20261012212910_commercial_workflows_security.sql` | (aucune table) workflows soumission→commande + garde-fous |
| 8 | `20261012215952_finance_accounts_ledger_documents.sql` | `payment_accounts`, `finance_verifiers`, `payment_events`, `financial_adjustments`, `financial_ledger`, `finance_settings`, `finance_document_jobs` (7) + bucket `ebi-payment-proofs` |
| 9 | `20261012220048_finance_secure_workflows.sql` | (aucune table) déclaration/vérification/encaissement, reçus, corrections |
| 10 | `20261013091308_field_finance_schema.sql` | `field_policy_versions`, `field_budget_permissions`, `field_budgets`, `field_advances`, `field_expenses`, `field_restitutions`, `field_finance_events` (7) + bucket `ebi-field-proofs` |
| 11 | `20261013091309_field_finance_workflows.sql` | (aucune table) RPC terrain (budgets, avances, dépenses, restitutions) |
| 12 | `20261013091311_commission_workflows.sql` | `sales_commission_policies`, `sales_commission_positions`, `sales_commission_payouts` (3) |
| 13 | `20261013095021_prompt7_profile_privilege_guard.sql` | (aucune table) révoque l'UPDATE direct de `profiles` ; RPC `crm_update_sales_profile` contrôlé |
| 14 | `20261013102446_self_service_signup_pending_profiles.sql` | (aucune table) inscription libre → profil inactif ; RPC `ebi_signup_ready` ; politique restrictive `ebi_storage_active_profile_gate` |

### 2.2 Relations principales

```text
auth.users 1──1 profiles (rôle, activation)
profiles 1──N (tout ce qui a un auteur : leads, activities, orders, payments,
                documents, expenses, commissions, imports, audit_logs…)

companies 1──N contacts
companies 1──N leads 1──N activities
                    ├──N appointments / follow_ups / lead_assignments
                    └──N commercial_proposals ──1 orders (idempotent, unique)
offer_templates (versionné) 1──N orders ; snapshot congelé dans la commande
orders 1──N order_installments / payments / payment_events
orders 1──1 production_projects
payments 1──N documents (reçus) ; 1──N finance_document_jobs
financial_ledger ← écritures signées ← confirmations, corrections, remboursements
import_batches 1──N import_rows
audit_logs : (entity_table, entity_id) — chronologie générique de toute entité
field: field_policy_versions 1──N budgets 1──N advances 1──N expenses/restitutions
commissions: policies 1──N positions 1──N payouts (basées sur financial_ledger)
```

### 2.3 Classification Cortexia → EBI-IMT

| Catégorie | Tables | Détail |
| --- | --- | --- |
| **Conservées à l'identique** (39) | profiles, companies, contacts, leads, activities, appointments, follow_ups, lead_assignments, offer_templates, orders, commercial_proposals, commercial_proposal_events, order_installments, commercial_order_events, payments, payment_accounts, finance_verifiers, payment_events, financial_adjustments, financial_ledger, finance_settings, finance_document_jobs, expenses, expense_policies, field_policy_versions, field_budget_permissions, field_budgets, field_advances, field_expenses, field_restitutions, field_finance_events, commission_policies, commissions, sales_commission_policies, sales_commission_positions, sales_commission_payouts, production_projects, audit_logs, import_batches, import_rows | Structure inchangée ; les modules restent dans le périmètre (décision validée) |
| **Adaptées** (2) | `commercial_settings` | Nom de société par défaut `Cortexia` → `EBI-IMT` (structure inchangée) ; et `documents` — le changement prévu (découplage des liens directs vers une table polymorphe `document_links`) est **planifié en phase 1**, pas encore appliqué |
| **Créées pour EBI-IMT** (0 à ce jour) | — | Aucune table nouvelle n'a encore été créée. Les tables du nouveau périmètre (appels d'offres, projets, achats, livraisons, factures) sont spécifiées dans `docs/architecture-ebi-imt.md` § 4 et seront créées en phases 1 à 4 par migrations additives, testées en pgTAP |

Précision importante : à ce stade, la refonte a porté sur le renommage (marque, buckets, RPC) et la préparation de l'architecture cible. Les extensions de schéma EBI-IMT n'ont pas encore commencé — c'est exactement le rôle de la validation demandée.

---

## 3. Stockage documentaire

### 3.1 Les quatre buckets actuels

Les quatre buckets existent parce que le socle hérité est bâti sur Supabase Storage. Ils ont été **renommés** lors de la refonte, pas remplacés :

| Bucket | Contenu | Qui écrit | Qui lit |
| --- | --- | --- | --- |
| `ebi-documents` | PDF officiels générés côté Edge (propositions, reçus, instructions) | Edge Functions (`service_role`) | liens signés 60 s après RLS |
| `ebi-imports` | fichiers d'import XLSX/CSV (transitoire) | navigateur (politique propriétaire) | propriétaire + managers |
| `ebi-payment-proofs` | justificatifs de paiement déclarés (≤ 5 Mo) | client, chemin imposé par RPC | vérificateurs |
| `ebi-field-proofs` | preuves terrain (avances, dépenses, versements) | commercial (chemin imposé) | manager habilité + admin |

### 3.2 Intégration à l'architecture cible (PostgreSQL + Auth + R2 + disques)

La décision validée fait de **Cloudflare R2 le stockage documentaire autoritaire**. Les quatre buckets s'intègrent ainsi :

1. **`ebi-documents` → R2 (documents officiels).** Les Edge Functions écrivent directement dans R2 avec la clé d'accès (secret côté Edge uniquement) et enregistrent la métadonnée dans `documents` (chemin, hash SHA-256, liens). La lecture passe par une URL pré-signée GET émise par Edge après vérification du JWT et des règles d'autorisation. Comme le projet EBI-IMT démarre **vide**, aucune copie de fichier existant n'est nécessaire.
2. **`ebi-payment-proofs` et `ebi-field-proofs` → R2 (justificatifs).** Upload direct navigateur → R2 via URL pré-signée PUT émise par Edge (TTL court, chemin scoping imposé, type/taile vérifiés) ; les RPC existants (`finance_attach_proof`, `field_attach_proof`) voient leur vérification d'existence dans `storage.objects` remplacée par une vérification d'un manifeste de métadonnées écrit par Edge. Ceci est le **travail réel de la phase 1**.
3. **`ebi-imports` → conservé comme zone de transit sur Supabase Storage.** Justification : le pipeline d'import vérifie la propriété du fichier via `storage.objects.owner_id` et les politiques RLS de Storage — un modèle de sécurité natif et déjà testé. Les fichiers sont transitoires et purgés après validation ; leur volume est faible. Migrer cette zone exigerait de réécrire la vérification d'identité du fichier côté RPC pour un bénéfice faible. Elle restera évaluable plus tard sans bloquer quoi que ce soit.

### 3.3 Pourquoi cette approche en deux temps

- **Ne pas tout casser d'un coup** : chaque flux migré vers R2 apporte son lot de vérifications (autorisations d'upload, reprise après erreur, URL de lecture). Un séquençage documents officiels → justificatifs → bilan permet de valider chaque étape avec une recette.
- **Aucune dépendance technique bloquante** : R2 est compatible S3 ; si R2 doit être remplacé plus tard, c'est une copie d'objets, pas une reconstruction.
- **Le rôle des quatre composants validés reste intact** : PostgreSQL garde les métadonnées et les droits (RLS sur `documents`), Auth reste la seule porte d'identité, R2 ne stocke que des octets, les deux disques externes reçoivent les sauvegardes (pg_dump + synchronisation R2 via `rclone`).

### 3.4 Adaptations nécessaires (phase 1)

1. Créer le bucket R2 + clés d'accès, secrets dans les Edge Functions (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`).
2. Nouvelle Edge Function `r2-url` : vérification JWT + autorisation RLS + émission d'URL pré-signée (PUT/GET), journal d'accès.
3. Adapter les deux fonctions `issue-*` : écriture dans R2 au lieu de Supabase Storage.
4. Adapter les garde-fous RPC mentionnés ci-dessus (manifeste de métadonnées).
5. Limiter les MIME et tailles côté Edge ; conserver le rejet des doublons par empreinte.

---

## 4. Sécurité

### 4.1 Rôles et permissions

- **Aujourd'hui** : `admin`, `sales_manager`, `sales_rep` (§ 1.5). Le responsable commercial lit globalement les données de son équipe (limitation documentée : pas de hiérarchie d'équipes).
- **Cible EBI-IMT** : extension de l'enum `app_role` par migration testée ; les politiques RLS existantes s'appuient sur `private.current_app_role()` — l'ajout de rôles exige une revue de chaque politique (travail de phase 1, avec pgTAP).

### 4.2 Politiques RLS

- RLS activé sur les 42 tables ; `anon` révoqué de tout le schéma public.
- Modèle de portée : le commercial ne voit que ce qui lui est attribué (`assigned_to`, `sales_rep_id`, `claimant_id`, `responsible_id`) ; managers/admin voient tout (ou selon délégation pour le terrain).
- Politique restrictive `active_profile_gate` sur toutes les tables publiques + `storage.objects` : un compte Auth sans profil actif ne lit ni n'écrit rien.
- Écritures directes révoquées et remplacées par RPC pour : `leads`, `import_batches/rows`, tables terrain, paiements (insert direct refusé, y compris testé en pgTAP).
- Changements de rôle impossibles par UPDATE direct (révocation + trigger) ; passant par RPC audité.
- Toute nouvelle table de phase 1 suivra le même gabarit : RLS + politique restrictive + révoquation des droits d'écriture sensibles + RPC de rôle.

### 4.3 Protection des documents

- Buckets privés, aucune URL publique ; lecture exclusivement par liens signés de 60 secondes après RLS.
- Écritures sans écrasement : si un fichier existe déjà au chemin officiel, l'émission échoue avec demande de vérification ; empreinte SHA-256 contrôlée et enregistrée.
- Instantanés immuables (offre/client) figés dans les propositions et commandes ; journal financier append-only avec corrections traçables ; un reçu exige un encaissement `confirmed`.
- À l'arrivée de R2 : TTL courts, chemins scoping, contrôle d'autorisation avant toute émission d'URL, journal des accès.

### 4.4 Clés et secrets

- Frontend : uniquement `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY`. Aucune clé `service_role` dans `VITE_*` (règle vérifiée par revue).
- Edge Functions : `SUPABASE_URL`, clés injectées par la plateforme Supabase ; les clés R2 y vivront exclusivement.
- `.env.local` est ignoré par Git ; les anciennes clés du projet abandonné ont été retirées ; l'état de liaison CLI (`supabase/.temp`) a été purgé pour interdire tout push accidentel.
- `dist/` et l'historique Git seront vérifiés avant toute publication.

### 4.5 Journal d'activité

- `audit_logs` : table append-only (aucune politique d'INSERT/UPDATE/DELETE pour `authenticated` — les écritures passent par les fonctions security definer), RLS forcée, lecture réservée aux managers/admin, indexé par `(entity_table, entity_id, created_at)` et par auteur.
- Chaque opération sensible écrit une entrée : confirmations de paiement, changements de rôle, imports, décisions de validation, versements de commission.
- Le module « Journal d'activité » demandé (écran de consultation + chronologie par entité) sera construit **sur cette table existante** en phase 1.

### 4.6 Sauvegarde et restauration

- Plan Supabase Free : **aucune sauvegarde automatique** (limite assumée).
- Procédure prévue (phase 5) : `pg_dump` planifié (schéma + données + utilisateurs nécessaires) + copie des fichiers de stockage (rclone R2 + buckets Supabase) → **deux disques externes indépendants** (copie redondante, rotation documentée) ; exercice de restauration **testé sur un projet jetable** (schéma, données, buckets, séquences, liens documentaires) — une sauvegarde non restaurée ne prouve rien.
- RPO cible : 24 heures maximum tant que le plan gratuit est actif ; aucune garantie de disponibilité tant que l'offre gratuite est en vigueur (documenté à la direction).

---

## 5. État réel du projet

### 5.1 Fonctionnalités réellement opérationnelles

Code complet, testé localement (typecheck, 29 tests Vitest, build) ; la recette sur base connectée reste à faire :

- Connexion, inscription avec validation administrateur, garde de session, rôles.
- CRM complet : prospects (recherche serveur, filtres, pagination, Kanban, fiche, attribution simple/lot), commerciaux, activités/relances/rendez-vous, imports Excel guidés (simulation, conflits, validation transactionnelle).
- Commercial : catalogue d'offres versionné, propositions (brouillon → soumission → approbation → PDF → acceptation vérifiée → commande idempotente), commandes avec échéancier contractuel.
- Finance : déclaration et vérification manuelle d'encaissement, journal financier, reçus et fiches d'instructions (PDF A4 testé en local), corrections traçables, comptes officiels.
- Terrain : dotations, budgets de transport, avances, dépenses, restitutions ; commissions (politiques, positions, versements) ; rapports de performance.
- Command Center : KPI réels soumis à RLS, scène 3D + repli 2D, panneau d'inspection.

### 5.2 Fonctionnalités préparées mais pas déployées

- Edge Functions PDF (code + rendu A4 validé localement ; jamais exécutées sur un projet).
- Déploiement Cloudflare Pages, R2, MFA admin, numérotation séquentielle étendue, sauvegardes planifiées.

### 5.3 Fonctionnalités à développer (phases 1 à 5)

Appels d'offres ; projets ; fournisseurs/partenaires (rôles de sociétés) ; commandes fournisseurs (achats) ; livraisons/réceptions ; facturation clients et fournisseurs ; bibliothèque documentaire centralisée ; écran utilisateurs et permissions ; écran journal d'activité ; paramètres unifiés ; KPI appels d'offres/projets ; imports d'archives ; sauvegardes et recette finale.

### 5.4 Tests effectivement réalisés

| Test | État |
| --- | --- |
| `npm run typecheck` | Réussi (12/11/2026) |
| `npm test` — 29 assertions Vitest (calculs financiers, échéanciers, mapping Excel, protection anti-formules, PDF A4/pagination/reproductibilité) | Réussi (29/29) |
| `npm run build` | Réussi |
| pgTAP `supabase/tests/database.sql` (31 assertions RLS/schéma) | **Écrit, jamais exécuté** (Docker indisponible sur la machine du travail précédent) |
| Tests RLS multi-rôles, Edge de bout en bout, recette intégrale | **Non réalisés** |

### 5.5 Dépendances avec l'ancien système

- Le projet Supabase lié historiquement (Cortexia) est **abandonné** : aucune migration n'y sera poussée, aucune ressource n'a été supprimée. Il reste en l'état, hors périmètre.
- Les anciennes clés ont été retirées de `.env.local` ; la liaison CLI a été purgée.
- Aucune donnée opérationnelle n'est à migrer : le projet EBI-IMT démarre vide ; le socle de tables, lui, est réutilisé tel quel (cf. § 2.3).
- `seed.sql` ne contient que des données de référence fictives (politique de dépense, offre de démonstration) pour le développement local.

### 5.6 Revue des migrations avant application

Les 14 fichiers sont dans `supabase/migrations/` (liste et contenu au § 2.1) — vous pouvez les relire en l'état. **Aucun `db push` ne sera lancé sans votre validation explicite** ; la séquence prévue reste : création du projet → liaison CLI → revue + `supabase test db` local (Docker) → recette multi-rôles sur base isolée → push. Les migrations déjà adaptées EBI-IMT (buckets `ebi-*`, RPC `ebi_signup_ready`, nom de société) seront re-revues en même temps.

---

## 6. Documentation

Le document de cadrage `docs/architecture-ebi-imt.md` contient : état du dépôt (§ 1), décisions actées (§ 2), architecture cible (§ 3), modèle de données cible conservé/adapté/nouveau (§ 4), flux documentaire R2 (§ 3), sécurité (§ 5), limites des offres gratuites (§ 6), risques (§ 7), plan par phases (§ 8), conventions (§ 9).

### Section 10 — Décisions validées (12 novembre 2026)

1. **Projet Supabase** : projet neuf et propre. Le projet Cortexia lié est abandonné (aucun push).
2. **Dépôt GitHub** : nouveau dépôt sur un nouveau compte GitHub. Nom du compte et du dépôt à communiquer avant le branchement Cloudflare Pages.
3. **Rôles applicatifs** : adaptation à la structure EBI-IMT. Matrice proposée (à affiner en phase 1, avec tests RLS) : `admin` (gouvernance et validation financière), `direction` (supervision et validation des appels d'offres), `commercial` (prospects, DAO, propositions, commandes clients), `achats` (fournisseurs, commandes fournisseurs, livraisons), `finance` (factures, encaissements, décaissements), `lecture_seule` (consultation). Les valeurs de l'enum existant restent en anglais en base ; les nouveaux rôles sont ajoutés par migration testée.
4. **Modules terrain** : conservés (dotations, transports, avances, commissions restent des modules EBI-IMT).
5. **Partenaires** : le module gère les deux catégories — fournisseur technologique privilégié et repreneur/sous-traitant ; une société peut cumuler.
6. **Cloudflare** : compte à créer (R2 + Pages). Procédure de création fournie par l'assistant en phase 0.

### Section 11 — Actions externes restant à la charge de la direction

- Créer le compte GitHub (nom à communiquer) et le dépôt du projet.
- Créer le projet Supabase neuf (région proche, ex. Europe de l'Ouest) et transmettre l'URL + la clé publishable pour remplacer `.env.local`.
- Créer le compte Cloudflare et activer R2 ; transmettre l'identifiant de compte (la clé d'accès R2 restera côté Edge uniquement).
- Prévoir les deux disques externes de sauvegarde.

---

## 7. Points soumis à votre arbitrage pour la validation finale

1. **Matrice de rôles cible** : confirmer la liste admin / direction / commercial / achats / finance / lecture_seule (ou l'ajuster) — elle conditionne la migration de phase 1.
2. **Stockage en deux temps** (§ 3.2-3.3) : R2 pour les documents officiels et les justificatifs dès la phase 1 ; `ebi-imports` reste zone de transit Supabase Storage. Confirmer ou demander une migration intégrale immédiate (coût : réécriture du pipeline d'import).
3. **Domaine e-mail** : le placeholder de connexion est actuellement `nom@ebi-imt.com` — communiquer le domaine réel.
4. **Périmètre de la recette** : valider que la recette se fera d'abord en local (Docker) puis en préproduction isolée avant toute ouverture aux utilisateurs.

Une fois ces points arbitrés et les accès fournis, la Phase 1 peut démarrer sans autre dépendance.
