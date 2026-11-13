# Audit final — EBI-IMT Business Manager

Audit technique final avant Phase 0, réalisé le 12 novembre 2026 à la demande de la direction. Méthode : lecture intégrale du code et de la configuration (15 migrations, 2 Edge Functions, tests, frontend, README, rapports historiques), balayages automatisés, exécution des vérifications avec preuve. **Aucune migration distante appliquée, aucune ressource supprimée, aucune donnée métier fictive créée, aucune fonctionnalité retirée.**

Documents dérivés : `docs/database-schema.md` (schéma complet), `docs/security-review.md` (sécurité), `docs/migration-plan.md` (procédure projet neuf), `docs/phase-0-checklist.md` (exécution Phase 0).

## 1. Cohérence entre l'architecture v2 et le code existant

| Exigence de l'architecture v2 | État du code | Verdict |
| --- | --- | --- |
| Design/frontend conservés, aucun framework ajouté | React 19 + TS strict + Vite 8 + Tailwind 4 inchangés | **Conforme** |
| 6 rôles + permissions granulaires | 3 rôles (enum), permissions codées dans les politiques RLS | **Écart planifié** — Phase 1 (tables `roles`/`role_permissions`) |
| Inscriptions publiques désactivées | `enable_signup = true` en config locale, route `/inscription` active, trigger de profil inactif en place | **Écart à corriger** (S1, décision D2) |
| MFA admin/direction + contrôle `aal2` | MFA désactivé en config locale, aucun contrôle `aal` dans RLS/RPC | **Écart** (S3, D4) |
| Cycle de vie documentaire complet (staging, hash, versions, suppression logique, traçabilité, réconciliation) | Précurseurs réels : hash SHA-256 stocké, chemins immuables, idempotence Edge, reprise des jobs ; mais pas de staging, pas de versions multiples, pas de journal d'accès | **Base saine, compléments Phase 1** |
| Stockage documentaire sur R2 | Encore Supabase Storage (4 buckets privés bien policés) ; Edge Functions prêtes à être adaptées | **Planifié Phase 1** (choix acté, aucune migration à faire — projet neuf) |
| Sauvegardes (2 copies, 1 hors bureau, restauration testée) | Aucun script de sauvegarde dans le dépôt | **À créer en Phase 0** (V7) |
| Journal d'activité + chronologie générique | `audit_logs` complet, alimenté par triggers + RPC ; écran de consultation non encore créé | **Base saine, écran Phase 1** |
| Modules à venir (DAO, projets, achats, livraisons, facturation, bibliothèque, utilisateurs, paramètres) | 6 zones du Command Center dont 2 espaces réservés (`production`, `settings`) | **Planifié, conforme** |

Verdict global : l'architecture v2 décrit fidèlement le socle ; les écarts sont tous **planifiés ou localisés**, aucun ne remet en cause le socle.

## 2. Fonctionnalités héritées réellement réutilisables

| Domaine | Contenu réutilisable | Preuve |
| --- | --- | --- |
| CRM complet | Sociétés, contacts, prospects (pipeline 11 états), activités enrichies, RDV, relances, attributions historisées, imports Excel tracés avec détection de doublons | 9 RPC + politiques RLS opérationnelles |
| Commerciaux | Catalogue versionné immuable, propositions avec approbation/PDF/envoi/acceptation vérifiée, commandes avec échéanciers et snapshots | Chaîne complète testée par le design des RPC |
| Finance de recouvrement | Comptes officiels, déclarations avec preuves privées, délégation de vérification, confirmation avec verrous et plafond contractuel, ledger append-only, corrections en 3 étapes auditées, reçus PDF durables | Migration 9+10 ; `confirm_payment` hérité proprement révoqué |
| Finance de terrain | Politiques versionnées, budgets autorisés, avances avec preuve de remise, dépenses justifiées avec plafonds, restitutions, réconciliation stricte avant clôture | Migrations 11+12 |
| Commissions | Politiques versionnées (3 bases), positions recalculées automatiquement depuis le ledger, approbation, versements avec référence unique | Migration 13 |
| Documents PDF | 2 Edge Functions structurées (auth utilisateur → contrôle d'accès via RPC → service_role → chemin immuable + hash → idempotence) | `issue-proposal`, `issue-finance-document` |
| Journal d'audit | Triggers automatiques sur CRM + journalisation systématique dans chaque RPC | 6 triggers + ~20 écritures dans les RPC |
| Tableau de bord | Scène 3D 6 zones + repli 2D + panneau d'inspection alimenté par requêtes RLS | `CommandScene` lazy 1,05 Mo |
| Frontend | 14 modules déclarés, 25 routes protégées, KPI temps réel, import/export Excel, garde de session | `App.tsx`, `modules.ts` |

**Rien n'est à jeter** ; les adaptations portent sur les rôles, le stockage R2, la numérotation (D3) et les modules à venir.

## 3. Tables : conservées, adaptées, nouvelles

Vérifié : **42 tables** au total, conforme à l'Annexe A de l'architecture v2 — 40 conservées à l'identique (dont 6 gelées en lecture seule : `expenses`, `commissions`, `commission_policies`, `expense_policies` + historiques), 2 adaptées (`commercial_settings` déjà rebaptisée EBI-IMT ; `documents` à découpler en Phase 1), 0 supprimée. Les nouvelles (Phase 1+) sont définies dans `docs/architecture-ebi-imt.md` § 4 et le critère V1.3.

## 4. Dépendances tables ↔ modules

Cartographie complète dans `docs/database-schema.md` § 8. Chaîne critique à préserver : `leads → commercial_proposals → orders → payments → financial_ledger → sales_commission_positions` et `field_policy_versions → field_budgets → field_advances → field_expenses/field_restitutions`. Aucune dépendance circulaire détectée ; les append-only (ledger, audit, événements) sont terminaux (rien ne les référence par écriture). Risque d'évolution noté : `orders.sales_rep_id NOT NULL` et le modèle mono-offre devront s'élargir sans casser les snapshots.

## 5. Incohérences, risques de sécurité et contradictions — anomalies classées

### 5.1 Bloquantes (avant toute création de compte réel / mise en service)

| ID | Anomalie | Réf. | Traitement |
| --- | --- | --- | --- |
| B1 | Inscriptions publiques activées + politique de mots de passe faible + MFA désactivé en config locale — à recouper **avant la première invitation** sur le projet neuf | S1-S3 | Configuration tableau de bord (V0.2/V3) + D2/D4 |
| B2 | Aucun test RLS jamais exécuté (pgTAP 31 assertions structurelles seulement) | S4 | V3/V4 avec Docker obligatoire |
| B3 | Edge Functions jamais déployées ni exécutées à distance (Deno absent en local) | KNOWN_ISSUES | V6 sur préproduction |
| B4 | Procédure de premier administrateur non exécutée/testée (SQL de bootstrap défini dans `docs/migration-plan.md` § 3) | README § 54 | Étape 11 du plan de migration |

### 5.2 Élevées

| ID | Anomalie | Réf. | Traitement |
| --- | --- | --- | --- |
| E1 | Préfixes `CTX-REC`/`CTX-PAY-` (héritage Cortexia) dans le SQL de numérotation | S5, D3 | Correction avant premier push (§ 4 du plan de migration) |
| E2 | Aucune garde de route par rôle (navigation admin ouverte à tous les rôles ; backend protégé) | S6 | Phase 1 avec la matrice |
| E3 | Périmètre `sales_manager` = équipe entière, non formalisé | S7, D5 | Arbitrage direction |
| E4 | Dépôt Git : remote vers l'ancien compte, ~40 fichiers de refonte **non commités** | S9, D9 | Nouveau dépôt + commit avant V8.4 |
| E5 | Aucun ESLint, aucune CI (typecheck/tests/build manuels uniquement) | — | GitHub Actions en Phase 0 (recommandation) |
| E6 | Sauvegardes inexistantes tant que V7 n'est pas exécuté | — | Phase 0 |

### 5.3 Moyennes

| ID | Anomalie | Réf. |
| --- | --- | --- |
| M1 | Porte restrictive `active_profile_gate` non automatique pour les tables futures | S10 |
| M2 | Vérification email désactivée (activation métier compense) | S11 |
| M3 | Upload du logo impossible via l'UI (INSERT Storage bloqué par sécurité, aucun flux prévu) | S12 |
| M4 | Dashboard : agrégations côté client paginées (500 lignes) — coût croissant avec le volume | Inventaire frontend |
| M5 | `gross_margin` (base de commission) non implémenté — lève une erreur explicite « données insuffisantes » | Migration 13:113 |
| M6 | Imports concurrents peuvent créer des doublons sur décision `create` d'un conflit obsolète | KNOWN_ISSUES |
| M7 | CORS Edge `*` (resserrer sur Pages) ; rate-limit email 2/h ; pas de procédure écrite de rotation du secret | S8, S14 |
| M8 | Base `gross_margin` dépend de coûts directs — non modélisés avant la Phase 4 (achats) | Migration 13 |

### 5.4 Faibles

- `docs/data-model.md` ne couvre que les 17 tables fondatrices (document historique) — remplacé par `docs/database-schema.md`.
- Redirections Auth locales incohérentes (`https://127.0.0.1:3000`) ; `site_url` à remplacer par l'URL Pages.
- `ebi_signup_ready` accordé à `anon` (à supprimer si D2 = désactivation totale).
- Rapports racine historiques (`AUDIT_REPORT.md`, etc.) datés du 13/10/2026 décrivent l'état Cortexia — à archiver ou marquer « historique » (décision D9).
- Garble d'encodage à l'affichage console des rapports (cosmétique).

## 6. Traces Cortexia

| Zone | Résultat |
| --- | --- |
| Code actif (ts/tsx/sql/toml/json) | **0 occurrence** — conforme à la revendication de l'architecture v2 |
| Documentation (.md) | 18 occurrences historiques/justificatives (architecture v2, validation, README, 3 rapports racine) — volontairement conservées (règle d'abandon + traçabilité) |
| Nom du commit Git | `Initial Cortexia Base` (historique du socle) — nouveau dépôt = historique frais (D9) |
| Remote Git | `cortexiagroup/base_cortexia.git` — à remplacer (D9) |
| **SQL (découverte de cet audit)** | Préfixes de documents `CTX-REC` / `CTX-PAY-` = abréviations « Cortexia » non détectées par la recherche littérale — E1/D3 |
| Artefacts binaires | 7 PDF/PNG de contrôle nommés `cortexia-*` dans `output/` et `tmp/` (gitignorés, hors Git) — supprimables librement |

## 7. Preuves des vérifications exécutées (12/11/2026, 18:17-18:19)

| Vérification | Commande | Résultat |
| --- | --- | --- |
| Typecheck | `node node_modules\typescript\bin\tsc -b --pretty false` | **EXIT=0** |
| Tests | `node node_modules\vitest\vitest.mjs run` | **5 fichiers, 29/29 réussis** (1,06 s) |
| Build | `node node_modules\vite\bin\vite.js build` | **OK** 2 852 modules ; `index` 540,21 Ko, `proposal-pdf` 426,76 Ko, `CommandScene` 1 050,61 Ko (différé), avertissement > 500 Ko |
| Balayage Cortexia/secrets/URLs | rg/Select-String sur tout le dépôt | 0 / 0 / 0 dans le code actif (détail § 6) |
| État CLI/projet | `Test-Path supabase\.temp` = False ; `.env.local` = 50 caractères (2 clés vides) | Aucun lien projet actif |
| Migrations distantes | Aucune exécutée | Ancien projet inchangé |

## 8. Ancien projet Supabase : impossibilité d'usage accidentel

`.env.local` vide, aucun `project_ref` dans le dépôt, lien CLI purgé, aucune URL de projet en dur : le dépôt ne contient **aucun moyen technique** de contacter l'ancien projet. Les seules portes restantes sont procédurales (`supabase link` manuel) — garde-fous codifiés dans `docs/security-review.md` § 4 et rappelés dans la checklist V3. Recommandation additionnelle : archiver le ref de l'ancien projet dans un document interne hors dépôt.

## 9. Scripts, dépendances et variables d'environnement

- **Scripts npm** (`package.json`) : `dev`, `build` (`tsc -b && vite build`), `typecheck`, `test`, `preview` — tous fonctionnels ; **les shims `npm run` sont inopérants sur cette machine** (`&` dans le chemin) → binaires appelés directement (procédure notée dans README à confirmer, checklist rappel).
- **Dépendances** : épinglées exactement (supabase-js 2.117.3, react 19.3.0, three 0.186.1, vite 8.3.4, vitest 5.0.4, typescript 7.0.2, tailwind 4.3.3…) ; `package-lock.json` présent ; aucune dépendance obsolète critique détectée.
- **Variables** : frontend `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` uniquement (garde anti-placeholder) ; Edge `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` via `Deno.env` ; futures R2 (`R2_*`) listées dans la checklist V5.2. `.env.example` à jour ; `.gitignore` couvre `.env*`, `dist/`, `output/`, `tmp/`, `node_modules/`.
- **Config locale** (`config.toml`) : PG 17, port 54321, buckets 50 Mo/10 Mo, `api.max_rows = 1000` — profil de développement ; les valeurs Auth **ne doivent pas être reprises telles quelles** sur le cloud (S1-S3).

## 10. Décisions restant à valider par la direction

| ID | Décision | Recommandation de l'audit |
| --- | --- | --- |
| D1 | **Validation du schéma définitif** (Annexe A + `docs/database-schema.md`) et de la définition SQL des tables nouvelles Phase 1 | Valider après revue ; condition d'entrée des migrations Phase 1 |
| D2 | **Inscriptions publiques** : désactiver immédiatement sur le nouveau projet ; sort du trigger de profil inactif, de `/inscription` et de `ebi_signup_ready` | Désactivation totale + suppression du pré-check ; conservation de la porte RLS (utile) |
| D3 | **Préfixes de numérotation officiels** (reçus, instructions, futurs DAO-/PRO-/CMD-/ACH-/LIV-/FAC-) en remplacement de `CTX-*` | Proposer `EBI-REC`/`EBI-PAY` + série à définir avec le domaine e-mail réel |
| D4 | **MFA** : vérifier la disponibilité sur plan Supabase gratuit ; sinon contrôles compensatoires (IP restreintes pour admin, sessions courtes, revue hebdomadaire des accès) | Tester dès la création du projet ; trancher avant V0.7 |
| D5 | **Périmètre du rôle commercial supervisant** (équipe entière vs territoire) et correspondance avec `commercial`/`direction` | Formaliser le périmètre réel avant d'écrire la matrice |
| D6 | **Valeurs des politiques terrain** (dotation 5 000 / communication 500/3 j) confrontées aux processus réels | Revue avec la direction (Annexe A, note finale) |
| D7 | **Premier administrateur** : personne désignée + exécutant du SQL de bootstrap | Désigner avant l'étape 11 du plan de migration |
| D8 | **Tables legacy gelées** (`expenses`, `commissions`, `commission_policies`, `expense_policies`) : conservation en lecture seule (recommandé, historique) ou retrait du schéma neuf | Conservation recommandée |
| D9 | **Dépôt GitHub** : compte + nom ; commit des ~40 fichiers de refonte ; destination des rapports racine historiques | Créer le dépôt EBI-IMT, committer, archiver les rapports datés |
| D10 | **Priorisation Phase 1** : société (rôles cumulables) vs documents vs permissions d'abord | Recommandé : permissions → documents → sociétés (dépendances § 4) |

## 11. Verdict

**GO conditionnel pour la Phase 0.** Le socle est sain, auditable et largement réutilisable ; rien ne s'oppose à la préparation du projet neuf. Les conditions sont : validation D1-D10, corrections E1/D3 avant premier push, exécution effective des tests RLS et de la première sauvegarde-restauration (V3-V7), configuration Auth du nouveau projet conforme à l'architecture v2. La mise en service réelle reste subordonnée à la Phase 0 complète.
