# Architecture — EBI-IMT Business Manager

Document de cadrage validé par la direction. **Version 2 — 12 novembre 2026** (intégration des précisions post-examen : permissions granulaires, cycle de vie documentaire, stratégie de sauvegarde, sécurité des comptes, héritage Cortexia, performances, critères de sortie de la Phase 0).

Historique : v1 (12/11/2026) — cadrage initial et décisions de refonte ; v2 — précisions de validation direction.

## 1. État des lieux du dépôt

Le dépôt contient un socle fonctionnel réel (ex-« Cortexia Base », un commit), vérifié par audit statique et par la validation architecturale (`docs/validation-architecture.md`) :

- Frontend React 19 + TypeScript strict + Vite + Tailwind 4, design conservé tel quel (décision actée).
- Modules raccordés à Supabase : Prospects, Commerciaux, Activités, Imports, Offres/Propositions, Commandes, Paiements, Dépenses, Commissions, Rapports.
- 42 tables, 14 migrations, RLS partout, journal d'audit append-only, paiements append-only avec corrections traçables.
- Constat d'audit : projet Supabase lié historiquement en retard de 11 migrations (abandonné — aucune migration ne lui sera jamais appliquée) ; aucun ESLint/CI ; pgTAP écrit mais jamais exécuté.

## 2. Décisions actées par la direction

1. **Refonte** : design et frontend conservés ; adaptation à EBI-IMT uniquement ; aucun framework ajouté. Application rebaptisée **EBI-IMT Business Manager** ; toute trace « Cortexia » est retirée ou renommée (effectué — vérification automatisée zéro occurrence dans le code).
2. **Six rôles validés** comme base : `admin`, `direction` (Directeur général), `commercial`, `achats`, `finance`, `lecture_seule` — avec un **système de permissions granulaires** (§ 6).
3. **Architecture documentaire validée** : PostgreSQL (métadonnées et droits) + Supabase Edge Functions (contrôle, signature, PDF) + Cloudflare R2 (fichiers), complétée par le **cycle de vie documentaire complet** (§ 5).
4. **Stratégie de sauvegarde validée** : PostgreSQL, R2, chiffrement, deux copies physiques indépendantes dont une hors du bureau, tests réguliers de restauration (§ 8).
5. **Sécurité des comptes** : inscriptions publiques désactivées ; invitation/création par un administrateur autorisé uniquement ; MFA pour les comptes administrateurs et protections proportionnées (§ 6).
6. **Modules financiers et terrain conservés**, alignés sur les processus réels (revue de paramétrage avec la direction en Phase 0/1).
7. **Tableau de bord 3D conservé**, la vue 2D doit rester pleinement fonctionnelle, performances contrôlées sur des ordinateurs modestes (§ 9).
8. **Aucune migration ne sera jamais appliquée à l'ancien projet Supabase Cortexia** (règle absolue).

## 3. Architecture technique cible

| Composant | Choix | Détail |
| --- | --- | --- |
| Frontend | React 19 + Vite (existant) | Conservé, nouvelles pages dans le même design system |
| Auth | Supabase Auth | Email/mot de passe, **inscriptions publiques désactivées**, comptes créés par administrateur, MFA TOTP pour `admin`/`direction` |
| Base de données | PostgreSQL via Supabase | Migrations CLI, RLS partout, matrice de permissions granulaire, tests pgTAP |
| Edge Functions | Supabase (Deno) | PDF officiels, signature d'URL R2, invitation de comptes, réconciliation documentaire |
| Stockage documentaire | Cloudflare R2 (compatible S3) | URL pré-signées après contrôle d'autorisation ; métadonnées et droits dans PostgreSQL |
| Hébergement frontend | Cloudflare Pages | Déploiement depuis GitHub, `VITE_SUPABASE_URL` + clé publishable uniquement |
| Sauvegardes | Scriptées, chiffrées | `pg_dump` + synchronisation R2 → deux disques externes indépendants, une copie hors bureau |
| Budget | 0 FCFA | Limites des offres gratuites respectées ; aucune garantie de disponibilité tant que le plan gratuit est actif |

Principe directeur : le navigateur ne fait confiance à rien. Chaque lecture/écriture est arbitrée par PostgreSQL (RLS + matrice de permissions) ; les transactions passent par des fonctions SQL contrôlées ; les secrets vivent uniquement dans les Edge Functions.

## 4. Modèle de données

**Conservé à l'identique** (40 tables sur 42 — inventaire détaillé et justifié en **Annexe A**) : profils, sociétés, contacts, prospects, activités, rendez-vous, relances, attributions, catalogue, propositions, commandes, échéanciers, paiements, comptes officiels, journal financier, corrections, tâches PDF, dépenses legacy, politiques legacy, modules terrain complets, commissions, journal d'audit, imports.

**Adaptées (2)** : `commercial_settings` (nom de société EBI-IMT — fait) ; `documents` (découplage polymorphe + cycle de vie complet — Phase 1, § 5).

**Nouvelles (phases 1 à 4)** — table par table lors des migrations respectives :

| Module | Tables prévues |
| --- | --- |
| Permissions | `roles` (6 rôles de base, extensible), `role_permissions` (rôle × module × 5 actions) |
| Sociétés | table de liaison des rôles de société (client / fournisseur / partenaire / organisme), cumulables |
| Appels d'offres | `tenders`, `tender_items`, `tender_quotes`, `tender_events` |
| Projets | `projects` (rattachement facultatif à un DAO) |
| Achats | `purchase_orders`, `purchase_order_lines`, factures fournisseurs, `supplier_payments` |
| Livraisons | `deliveries`, `delivery_lines` (livraisons client et réceptions fournisseur) |
| Facturation | `invoices` (numérotation officielle, HT/TVA/TTC, échéances), rapprochement avec `payments` |
| Documents | `document_links` (polymorphe), `document_uploads` (staging), `document_access_logs`, `document_reconciliation` |
| Paramètres | numérotation séquentielle centralisée (DAO-, PRO-, CMD-, ACH-, LIV-, FAC-) |

**Interconnexion** : la chaîne Appel d'offres → Projet → Commandes → Achats → Livraisons → Factures → Paiements est portée par les clés étrangères ; `audit_logs` fournit la chronologie générique ; `document_links` rattache tout document. La « vue dossier » d'une entité agrège ces trois sources depuis un seul écran — c'est la concrétisation du principe « toute la vie d'une opération depuis un seul endroit ».

## 5. Stockage documentaire — cycle de vie complet

Architecture : PostgreSQL (métadonnées, droits, RLS) + Edge Functions (autorisation, signature, PDF) + R2 (fichiers). La clé d'accès R2 ne vit que dans les secrets des Edge Functions. La zone de transit `ebi-imports` reste sur Supabase Storage (modèle de propriété natif, justification dans `docs/validation-architecture.md` § 3).

**Exigences validées par la direction et mécanismes associés :**

| Exigence | Mécanisme |
| --- | --- |
| Détection des fichiers orphelins (upload R2 réussi, enregistrement PostgreSQL échoué) | Upload en **deux phases** : l'Edge Function crée d'abord une ligne de staging `document_uploads` (id, chemin R2 attendu, hash, taille, statut `pending`), puis délivre l'URL pré-signée PUT ; la confirmation crée la ligne définitive `documents`. Un job de nettoyage clôt les stagings expirés ; un job de réconciliation signale tout objet R2 sans ligne (table `document_reconciliation`, action admin : adopter ou supprimer). |
| Intégrité par hash | SHA-256 calculé dans le navigateur avant l'envoi, stocké dans le staging puis dans `documents` ; revérifié par l'Edge au moment de la confirmation (comparaison à l'objet R2) ; contrôle au téléchargement par échantillonnage sur les documents officiels. |
| Versions documentaires | `documents.version` + `supersedes_id` ; chemins versionnés `…/v{n}` ; une seule version active par document logique ; l'historique des versions est conservé et consultable. |
| Suppression logique et restauration | `deleted_at`, `deleted_by`, `deleted_reason` ; la suppression logique conserve le fichier et la métadonnée ; la restauration est réservée aux permissions de suppression ; la purge physique n'intervient qu'après le délai de conservation paramétré. |
| Traçabilité des consultations et téléchargements sensibles | `document_access_logs` (acteur, document, action vue/téléchargement, horodatage, contexte) alimentée par l'Edge Function à chaque émission d'URL pré-signée ; consultable depuis la vue dossier et la bibliothèque ; s'applique aux documents officiels et aux justificatifs financiers. |
| Réconciliation R2 ↔ PostgreSQL | Edge Function `r2-reconcile` (déclenchable manuellement, planifiable ensuite) : inventaire R2 comparé à `documents` + `document_uploads` ; rapport des orphelins, manquants et incohérences de taille ; correction assistée administrateur. |

## 6. Sécurité, comptes et permissions granulaires

### 6.1 Rôles

Six rôles validés, **stockés en table** (`roles`) plutôt qu'en enum figé, pour évoluer sans reconstruire : `admin` (gouvernance, utilisateurs, paramètres, validation financière), `direction` (Directeur général — vision transversale de toute l'activité : lecture globale, validation des appels d'offres et des engagements), `commercial` (prospects, DAO, propositions, commandes clients), `achats` (fournisseurs, commandes fournisseurs, réceptions), `finance` (factures, encaissements, décaissements, journal), `lecture_seule` (consultation). Les valeurs de l'ancien enum sont migrées par équivalence (`sales_rep`→`commercial`, `sales_manager`→`direction`) — la base EBI-IMT démarre vide, aucune donnée à convertir.

### 6.2 Matrice de permissions granulaires

- Table `role_permissions (role, module, consult, create, update, validate, delete)` semée par migration, **modifiable par l'administrateur** depuis le module Paramètres (délégation fine sans code).
- Modules couverts : prospects, activités, imports, offres, propositions, commandes, paiements, dépenses, commissions, rapports, appels d'offres, projets, clients, partenaires, fournisseurs, achats, livraisons, facturation, bibliothèque, utilisateurs, journal, paramètres.
- Application : une fonction `private.permits(module, action)` appelée par les politiques RLS et les RPC ; chaque table nouvelle est protégée par cette matrice ; les tables existantes migrent progressivement vers elle.
- Vision transversale du Directeur général : `direction` dispose de `consult = true` sur tous les modules, sans pour autant créer/modifier partout.
- Tests pgTAP dédiés : chaque action interdite par la matrice doit être refusée par RLS ; chaque action accordée doit réussir.

### 6.3 Comptes

- **Inscriptions publiques désactivées** : réglage Supabase Auth « disable new signups » + route publique `/inscription` remplacée par un message d'orientation ; seul un administrateur autorisé crée les comptes (module Utilisateurs → invitation par email via Edge Function `invite-user` avec `service_role`, profil créé inactif puis activé par l'admin).
- **MFA TOTP obligatoire** pour `admin` et `direction` : l'enrôlement est proposé à la première connexion ; les opérations sensibles (changement de rôle, validation financière, paramétrage) vérifient le niveau d'assurance (`aal2`) **dans les politiques RLS et les RPC** — une session sans MFA est refusée sur ces actions.
- Protections proportionnées : politique de mots de passe stricte, expiration et révocation de session, verrouillage après tentatives (réglages Auth), compte désactivé = accès immédiatement coupé (garde restrictif existant conservé), journalisation de l'activation et des changements de rôle.

### 6.4 Protections structurelles conservées

RLS sur toute table, écritures sensibles révoquées au profit de RPC vérifiant le rôle, paiements et journal append-only avec corrections traçables, snapshots immuables, URL pré-signées à TTL court et chemins scoping, aucune clé secrète côté navigateur, `dist/` et historique Git vérifiés avant publication.

## 7. Budget : limites réelles des offres gratuites

- **Supabase Free** : 500 Mo de base, 1 Go de fichiers, pause après 7 jours d'inactivité (keep-alive planifié), aucune sauvegarde automatique, aucun SLA.
- **Cloudflare R2 Free** : 10 Go-stockage/mois, 1 M écritures (classe A), 10 M lectures (classe B), egress gratuit ; les sauvegardes chiffrées ne doivent pas compter contre ce quota — elles vont sur les disques physiques.
- **Cloudflare Pages Free** : 500 builds/mois, 1 build simultané, bande passante illimitée.

Ces offres permettent le démarrage réel, pas la disponibilité professionnelle garantie. Migration vers des plans payants possible sans reconstruction.

## 8. Sauvegardes et continuité

| Élément | Procédure |
| --- | --- |
| PostgreSQL | `pg_dump` personnalisé compressé, planifié quotidiennement (tâche planifiée sur la machine désignée), vérification de l'archive |
| R2 | Synchronisation complète via `rclone` (y compris zone de transit Supabase Storage) |
| Chiffrement | Chiffrement systématique des archives (`age`/`gpg` avec clé publique ; la clé privée n'est jamais stockée sur les disques de sauvegarde ni sur la machine de sauvegarde — coffre physique) |
| Copies physiques | Deux disques externes **indépendants** : disque A conservé au bureau, disque B conservé **hors du bureau** (rotation hebdomadaire : B est échangé chaque semaine) |
| Contrôle | Journal de sauvegarde (date, taille, somme de contrôle, résultat) ; alerte manuelle en cas d'échec tant qu'aucune supervision automatique n'existe |
| Tests de restauration | Mensuel : restauration locale (Docker) et vérification du schéma + données + fichiers ; trimestriel : exercice complet sur un projet jetable (une sauvegarde non restaurée ne prouve rien) |
| Continuité | RPO 24 h maximum tant que le plan gratuit est actif ; runbook documenté dans `docs/` ; aucune garantie de disponibilité tant que le plan gratuit est en vigueur |

## 9. Risques identifiés

| Gravité | Risque | Réponse |
| --- | --- | --- |
| Bloquant | Ancien projet Cortexia (retard de migrations, bug d'élévation corrigé ici mais présent à distance) | Règle absolue : aucune migration ne lui sera appliquée ; projet neuf exclusivement |
| Élevée | R2 sans RLS natif | Émission d'URL uniquement via Edge après contrôle de la matrice de permissions, TTL court, staging + réconciliation |
| Élevée | Aucune sauvegarde automatique (plan gratuit) | Stratégie § 8 avec chiffrement, deux copies physiques dont une hors bureau, restauration testée |
| Élevée | Pause des projets Supabase gratuits | Keep-alive planifié ; utilisation régulière ; mise en garde écrite à la direction |
| Moyenne | Performances 3D sur ordinateurs modestes | Critères d'acceptation mesurés (§ 10, Phase 0) ; la vue 2D doit rester pleinement fonctionnelle (zones, inspection, accès modules) ; budget de taille de bundle suivi en CI |
| Moyenne | Masse documentaire initiale dispersée | Import guidé par lots avec détection de doublons par hash |
| Moyenne | Fonctions Edge PDF jamais exécutées à distance | Test en préproduction avant toute émission de document officiel |
| Faible | Données personnelles (contacts) | Durée de conservation et procédure d'export/suppression définies dans Paramètres |

## 10. Plan de développement par phases

### Phase 0 — Validation et fondations (critères de sortie obligatoires)

La Phase 0 n'est close que lorsque les sept livrables suivants sont vérifiés :

1. **Schéma définitif de la base de données** présenté et validé (Annexe A + définition complète des tables nouvelles, écrites en migrations, non appliquées).
2. **Matrice des rôles et permissions** (6 rôles × modules × 5 actions) validée par la direction.
3. **Migrations SQL vérifiées** : revue de lecture complète, application en base locale Docker, zéro erreur.
4. **Tests RLS multi-rôles exécutés** : pgTAP (31 assertions existantes + assertions de la matrice) + scénarios manuels par rôle sur la base locale.
5. **Configuration sécurisée de R2** : bucket, clés d'accès restreintes, secrets Edge, vérification CORS, tests de refus.
6. **Test réel d'upload et de téléchargement** via l'application (URL pré-signée, hash, journal d'accès) sur le projet de préproduction.
7. **Première sauvegarde et test de restauration** (PostgreSQL + fichiers, chiffrement, copie sur les deux disques, restauration locale vérifiée).

Prérequis externes (direction) : compte GitHub + dépôt, projet Supabase neuf (URL + clé publishable), compte Cloudflare (R2 + Pages), deux disques externes. **Aucune migration sur l'ancien projet Cortexia.**

### Phases suivantes

| Phase | Contenu | Durée estimée |
| --- | --- | --- |
| 0 | Validation et fondations (critères ci-dessus) | 2–3 semaines |
| 1 — Sociétés, documents, sécurité | Table `roles` + matrice granulaire ; rôles de société ; cycle de vie documentaire complet (staging, hash, versions, suppression logique, traçabilité, réconciliation) ; bibliothèque documentaire ; journal d'activité ; écran Utilisateurs (invitation, activation, MFA) ; Paramètres | 3–4 semaines |
| 2 — Appels d'offres | CRUD complet, organisme, équipements, devis fournisseurs, offre technique/financière, montant, résultat, vue dossier interconnectée | 2 semaines |
| 3 — Projets, commandes, achats | Projets ; rattachement des commandes existantes ; commandes fournisseurs avec lignes et statuts | 2–3 semaines |
| 4 — Livraisons, facturation | Livraisons/réceptions avec documents signés ; factures clients et fournisseurs ; décaissements ; PDF via Edge testés | 3 semaines |
| 5 — Tableau de bord, rapport final | KPI DAO/projets/caisse ; imports d'archives ; stratégie de sauvegarde en régime de croisière ; recette intégrale ; décision GO/NO-GO | 2 semaines |

Total indicatif : 14 à 17 semaines.

## 11. Conventions de développement

- Interface et documents intégralement en français ; montants FCFA en entiers `bigint`.
- Migrations additives uniquement ; toute migration passe la revue et les tests locaux avant toute application distante ; **jamais sur l'ancien projet Cortexia**.
- Vérifications avant commit : `npm run typecheck`, `npm test`, `npm run build` ; ensuite `supabase test db` et lint.
- CI : typecheck + tests + build + suivi de la taille des chunks (budget de régression).
- Documentation métier mise à jour dans `docs/` à chaque module livré.

## 12. Annexe A — Inventaire des tables héritées de Cortexia

Pour chaque table conservée : utilité dans EBI-IMT, relations clés, fonctionnalités qui l'utilisent, adaptations prévues. « Aucune » signifie conservée en l'état ; toutes ces tables restent soumises à la matrice de permissions.

| Table | Utilité dans EBI-IMT | Relations clés | Utilisée par | Adaptations |
| --- | --- | --- | --- | --- |
| `profiles` | Identité métier, rôle, activation | `auth.users` 1-1 ; auteur de presque tout | Connexion, Utilisateurs, Commerciaux, attributions | Migration vers table `roles` ; MFA/AAL2 ; matrice |
| `companies` | Clients, fournisseurs, partenaires, organismes | contacts, leads, orders ; futurs DAO/achats | Prospects, Commandes, futurs modules | Rôles de société cumulables (Phase 1) |
| `contacts` | Personnes référentes d'une société | companies 1-N | Fiche prospect, imports | Aucune (RLS revue) |
| `leads` | Opportunités et prospects | companies, activities, propositions | Prospects, Kanban, Imports, KPI | Rattachement DAO facultatif (Phase 2) |
| `activities` | Historique des échanges | leads 1-N | Activités, fiche prospect, KPI | Alimente la chronologie générique |
| `appointments` | Rendez-vous et démonstrations | leads | Activités, KPI dashboard | Aucune |
| `follow_ups` | Relances planifiées | leads | Activités | Aucune |
| `lead_assignments` | Historique d'attribution | leads, profiles | Prospects (attribution en lot) | Aucune |
| `offer_templates` | Catalogue d'offres versionné | orders (snapshot immuable) | Offres, Propositions, Imports | Sert de base au catalogue d'équipements des DAO |
| `commercial_proposals` | Propositions client | leads, orders, documents | Propositions, PDF officiels | Rattachement projet/DAO facultatif |
| `commercial_proposal_events` | Traçabilité des états | proposals | Détail proposition | Aucune |
| `commercial_order_events` | Traçabilité des commandes | orders | Détail commande | Aucune |
| `order_installments` | Échéancier contractuel | orders, payments | Paiements de commande | Rapprochement factures (Phase 4) |
| `commercial_settings` | Coordonnées officielles des PDF | 1 ligne | Offres, génération PDF | **Adaptée** : nom EBI-IMT ; rejoint Paramètres |
| `orders` | Commandes clients | companies, leads, proposals, payments | Commandes, Paiements, KPI | Colonnes `project_id`/`tender_id` + lignes détaillées (Phase 3) |
| `payments` | Déclarations et encaissements vérifiés | orders, documents | Paiements, reçus, KPI | Lien facultatif à une facture (Phase 4) |
| `payment_accounts` | Comptes officiels (banque, mobile money, caisse) | payments | Comptes officiels, instructions | Aucune |
| `finance_verifiers` | Délégation nominative de vérification | profiles | Finance | Alignement sur nouveaux rôles |
| `payment_events` | Traçabilité des paiements | payments | Détail paiement | Aucune |
| `financial_adjustments` | Demandes de correction traçables | payments, ledger | Finance | Aucune |
| `financial_ledger` | Journal financier append-only | payments | Solde, reçus, KPI, commissions | Gabarit réutilisé pour les décaissements fournisseurs |
| `finance_settings` | Réglages financiers (préfixe de reçus…) | 1 ligne | Reçus | Rejoint Paramètres unifiés |
| `finance_document_jobs` | Tâches PDF durables et reprises | payments, orders | Reçus, instructions | Adaptation au stockage R2 (Phase 1) |
| `documents` | Métadonnées documentaires | orders, payments, templates | Reçus, propositions | **Adaptée** : découplage polymorphe + cycle de vie complet (Phase 1, § 5) |
| `expense_policies` | Politiques de dépense (socle initial) | expenses | Lecture | Gelé ; remplacé par les politiques terrain versionnées |
| `expenses` | Dépenses simples du socle | profiles, documents | Lecture seule | Conservé pour historique ; écritures directes déjà révoquées |
| `commission_policies` | Politiques de commission (socle initial) | commissions | Lecture | Gelé ; remplacé par `sales_commission_policies` |
| `commissions` | Commissions (socle initial) | orders, profiles | Lecture | Conservé pour historique |
| `production_projects` | Suivi d'exécution d'une commande | orders 1-1 | Production (espace réservé) | Rattaché aux modules Projets/Livraisons (Phases 3-4) |
| `audit_logs` | Journal d'activité append-only polymorphe | toute entité | Journal d'activité (à créer), chronologie | Écran de consultation + API chronologie (Phase 1) |
| `import_batches` | Lots d'import tracés | profiles | Imports Excel | Réutilisé pour les imports d'archives (Phase 5) |
| `import_rows` | Lignes d'import avec décision | batches, leads | Imports Excel | Aucune |
| `field_policy_versions` | Politiques terrain versionnées | budgets | Dépenses terrain | **Revue des valeurs avec la direction** (dotation 5 000 / communication 500/3 j) pour correspondre aux processus réels |
| `field_budget_permissions` | Délégation de gestion des fonds terrain | profiles | Dépenses, Commissions | Alignement sur nouveaux rôles (achats/finance) |
| `field_budgets` | Budgets de transport autorisés | policy, advances | Dépenses terrain | Aucune |
| `field_advances` | Avances remises aux commerciaux | budgets, expenses | Dépenses terrain | Aucune |
| `field_expenses` | Dépenses justifiées du terrain | advances | Dépenses terrain | Aucune |
| `field_restitutions` | Restitutions vérifiées | advances | Régularisations | Aucune |
| `field_finance_events` | Événements du circuit terrain | entités terrain | Historiques terrain | Aucune |
| `sales_commission_policies` | Politiques de commission (versionnées) | positions | Commissions | Activation d'une politique réelle lors de la recette métier |
| `sales_commission_positions` | Positions de commission calculées | policies, ledger | Commissions, rapports | Aucune |
| `sales_commission_payouts` | Versements de commission | positions | Commissions | Aucune |

Note sur les modules financiers et terrain : les valeurs par défaut (dotation, recharge de communication, taux de commission) sont des **paramètres de référence**, pas des règles gravées dans le code. La recette de la Phase 1 inclura une revue avec la direction pour aligner ces paramètres sur les processus réels d'EBI-IMT avant toute écriture opérationnelle.

## 13. Décisions et actions (cumul)

**Décisions validées** — v1 (§ 2, points 1 à 5 : projet Supabase neuf, dépôt GitHub dédié, six rôles, modules terrain conservés, définition des partenaires) ; v2 (§ 2, points 2 à 8 : permissions granulaires, cycle de vie documentaire, stratégie de sauvegarde, inscriptions désactivées + MFA, héritage justifié, 2D fonctionnelle + performances, règle absolue anti-migration sur l'ancien projet).

**Actions externes restant à la charge de la direction** — compte GitHub + dépôt (nom à communiquer) ; projet Supabase neuf (URL + clé publishable) ; compte Cloudflare (R2 + Pages) ; deux disques externes (dont un conservé hors bureau) ; communication du domaine e-mail réel pour les identifiants ; Docker Desktop fonctionnel sur la machine de développement pour les tests RLS.
