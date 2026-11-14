# Schéma de base de données — EBI-IMT Business Manager

Référence complète du schéma, établie par lecture intégrale des migrations : § 1-8 = socle (15 migrations, audit du 12 novembre 2026) ; **Partie 2 (§ 9-12) = extensions EBI-IMT (migrations 16-31, PROMPT 2/3/4 + module appels d'offres étendu)**. Tout est appliqué au projet neuf `xxilfzpkdwggfilwyrjw` (31/31) ; ce document reste la référence unique.

## 1. Organisation générale

- **Schemas** : `public` (métier), `private` (fonctions helpers security definer), `auth`, `storage` (de Supabase). Extension activée : `pgcrypto`.
- **Version PostgreSQL cible** : 17 (`supabase/config.toml:42`).
- Socle : **42 tables métier**, **16 types énumérés**, **5 séquences**, **~30 déclencheurs**, **~54 fonctions RPC publiques** + helpers privés.
- **Après la migration 30 (module appels d'offres étendu) : 70 tables** (+28). Aucune extension ne crée d'enum (contraintes `text + check` partout) ; +1 RPC de numérotation + 2 helpers privés (`current_role_code`, `permits`).
- Montants : `bigint` en FCFA entiers. Horodatages : `timestamptz`. Identifiants : `uuid`.

## 2. Migrations (ordre d'application)

| # | Fichier | Contenu synthétique |
| --- | --- | --- |
| 1 | `20261012203448_foundation_schema.sql` | Schemas, enums, 17 tables fondatrices, index, triggers `updated_at`, anti-mutation financière, anti-changement de rôle |
| 2 | `20261012203450_security_policies.sql` | Helpers `current_app_role`/`can_manage_all`, RLS sur les 17 tables, grants, premières politiques, RPC `confirm_payment`/`set_profile_role` |
| 3 | `20261012203451_storage_and_seed_helpers.sql` | Buckets `ebi-documents`/`ebi-imports`, politiques Storage, normalisation téléphone togolaise, `audit_logs FORCE RLS` |
| 4 | `20261012210902_crm_operations.sql` | Colonnes CRM (priorité, canal…), tables `appointments`/`follow_ups`/`lead_assignments`, helper `crm_active`, remplacement des politiques lectures (suppression du privilège créateur), écritures CRM via RPC uniquement, garde-fous par trigger, audit automatique des lignes |
| 5 | `20261012210915_crm_rpc_and_import.sql` | RPC CRM : `crm_save_lead`, `crm_assign_leads`, `crm_set_lead_status`, `crm_set_sales_active`, `crm_domain`, import Excel (`crm_prepare_import`, `crm_commit_import`), recherche paginée `crm_search_leads`, synchronisation relances |
| 6 | `20261012210016_payment_and_document_guards.sql` | Garde-fous paiements (insert `pending` uniquement), immutabilité des commandes confirmées, reçu exige paiement confirmé, lecture Storage subordonnée à une ligne `documents` |
| 7 | `20261012212909_commercial_offers_proposals.sql` | Catalogue versionné (`family_id`+`status`), `commercial_settings` (EBI-IMT), `commercial_proposals` + événements, échéanciers `order_installments`, colonnes `documents` (version/statut), préfixes numérotation, politiques resserrées |
| 8 | `20261012212910_commercial_workflows_security.sql` | Workflow propositions complet (brouillon→approbation→PDF→envoi→acceptation→vérifiée→commande), immutabilité catalogue publié, revocations écritures directes |
| 9 | `20261012215952_finance_accounts_ledger_documents.sql` | Comptes officiels, délégations `finance_verifiers`, colonnes de vérification des paiements, `payment_events`, corrections, `financial_ledger` append-only, `finance_settings`, jobs PDF durables, bucket `ebi-payment-proofs`, backfill ledger |
| 10 | `20261012220048_finance_secure_workflows.sql` | Révocation de l'ancien `confirm_payment`, `finance_can_verify` (délégation), RPC finance complets (déclarer, preuve, revue, confirmation avec verrous ordre, instructions, corrections en 3 étapes), garde immutabilité ledger |
| 11 | `20261013091308_field_finance_schema.sql` | Gèle les tables legacy `expenses`/`commissions`, politiques terrain versionnées, délégations budgets, budgets/avances/dépenses/restitutions, `field_finance_events`, bucket `ebi-field-proofs` |
| 12 | `20261013091309_field_finance_workflows.sql` | RPC terrain complets : publication politique, délégation, budget, avance (demande→approbation→preuve remise→décaissement), dépenses (soumission avec plafonds politiques, revue avec preuves), remboursements, restitutions, clôture avec réconciliation complète |
| 13 | `20261013091311_commission_workflows.sql` | Politiques de commission versionnées (3 bases), positions recalculées depuis le ledger (trigger), approbation, versements avec preuve, immutabilité historiques |
| 14 | `20261013095021_prompt7_profile_privilege_guard.sql` | Révocation totale d'UPDATE direct sur `profiles`, RPC nommé `crm_update_sales_profile` (profils commerciaux uniquement, audité) — corrige l'escalade de privilège |
| 15 | `20261013102446_self_service_signup_pending_profiles.sql` | Trigger création de profil inactif `sales_rep` à l'inscription publique, pré-check `ebi_signup_ready`, politique restrictive `active_profile_gate` sur toutes les tables RLS (hors profiles), porte Storage équivalente |
| 16 | `20261112100016_roles_and_permissions.sql` | **EBI-IMT** — `roles` (6 rôles + 2 codes hérités dépréciés), `role_permissions` (rôle × module × 5 actions, matrice semée = défaut de référence V2.1), bascule `profiles.role` enum→text + FK, 5 fonctions socle redéfinies avec casts explicites, helpers `current_role_code`/`permits` |
| 17 | `20261112102017_official_numbering.sql` | **EBI-IMT** — `official_sequences` (compteurs annuels DAO/PRO/CMD/ACH/LIV/FAC), RPC `next_official_number` (format PREFIXE-AAAA-NNNNNN, remise à zéro annuelle, verrou FOR UPDATE ; branche `cmd` = séquence socle inchangée), grant `permits()` à `authenticated` |
| 18 | `20261112103018_company_roles.sql` | **EBI-IMT** — `company_roles` : cumul de rôles d'une société (client/fournisseur/partenaire/agence) |
| 19 | `20261112104019_document_lifecycle.sql` | **EBI-IMT** — colonnes documents (corbeille logique `deleted_at/by/reason`, `supersedes_id`, `family_key`), `document_uploads` (staging), `document_access_logs`, `document_links` (polymorphe), `document_reconciliation` (audit R2) |
| 20 | `20261112105020_tenders.sql` | **EBI-IMT** — `tenders`, `tender_items`, `tender_quotes`, `tender_events` : suivi des appels d'offres (DAO-…), CHECK won/lost complets |
| 21 | `20261112106021_projects.sql` | **EBI-IMT** — `projects` (PRO-…) + `orders.project_id` UNIQUE (commande → projet) |
| 22 | `20261112107022_purchases.sql` | **EBI-IMT** — `purchase_orders`/`_lines` (ACH-…), `supplier_invoices` (HT/TVA/TTC, CK ttc=ht+tva), `supplier_payments` (append-only, trigger anti-mutation), `supplier_payment_events` |
| 23 | `20261112108023_deliveries.sql` | **EBI-IMT** — `deliveries` (LIV-…, CHECK exclusivité client/fournisseur), `delivery_lines` (FK optionnelle vers ligne d'achat) |
| 24 | `20261112109024_invoicing.sql` | **EBI-IMT** — `invoices` (FAC-…, CK ttc=ht+tva et tva=round(ht×bps)), `invoice_lines`, `invoice_events`, `payments.invoice_id` (additif) |
| 25 | `20261113101025_admin_guardrails_mfa.sql` | **EBI-IMT** — garde-fous admin (dernier admin actif), MFA aal2, politiques/audit `role_permissions`, `ebi_signup_ready` false, grants `private` |
| 26 | `20261114100026_companies_contacts_phase1.sql` | **EBI-IMT Phase 1** — `companies` +`trade_name/registration_number/tax_number/is_active` (+index, audit), `contacts.is_active`, `company_activities`, enum `document_type` +`library_document`, politiques référentiel élargies (permits), RPC `company_create`/`company_activity_add` |
| 27 | `20261114103027_document_library_rpc.sql` | **EBI-IMT Phase 1** — zone R2 `r2-library` (staging), `document_links` +`companies/contacts`, journal +`upload`, `documents_select` +`permits('bibliotheque','select')`, RPC `document_download_allowed`/`user_permits`/`document_request_delete`/`document_request_restore` |
| 28 | `20261114110028_runtime_keyword_fixes.sql` | **EBI-IMT Phase 1** — correction runtime : `create or replace` des 6 corps (M25-M27) invalidés par `pg_catalog.nullif` (mot-clé non qualifiable) ; sources 25-27 corrigées au même endroit |
| 29 | `20261114111529_extension_workflows_phase3.sql` | **EBI-IMT Phase 3** — 9 RPC d'écriture : `tender_create/update/set_status/item_add/item_remove/quote_set`, `project_create/set_status`, `production_update` (transitions encadrées, numérotation DAO/PRO, événements, audit) |
| 30 | `20261114121630_tenders_expansion.sql` | **EBI-IMT Appels d'offres étendu** — `tenders` +5 colonnes (`description/publication_date/estimated_amount_xof/our_amount_xof/responsible_id`), rename `observations`, CHECK 10 statuts (`identifie|a_analyser|en_preparation|attente_documents|pret_deposer|depose|en_evaluation|gagne|perdu|annule`) ; `tender_documents/tender_tasks/tender_reminder/tender_comments` (4 tables, RLS full CRUD) ; `orders.tender_id` + `commercial_proposals.tender_id` ; RPC redéfinies + `order_set_tender`/`proposal_set_tender` |
| 31 | `20261114122031_tender_items_products.sql` | **EBI-IMT DAO ↔ produits** — `tender_items.offer_template_id` FK `offer_templates` (additive, on delete set null) + index ; `tender_item_add` 6→7 arguments (produit actif vérifié), ancienne signature supprimée |

## 3. Types énumérés

`app_role` (`admin`, `sales_manager`, `sales_rep` — colonne `profiles.role` basculée en `text` + FK en migration 16 ; le type reste utilisé par les helpers du socle), `lead_status` (9 valeurs + `negotiation`, `unqualified` ajoutées en migration 4), `activity_type` (8), `order_status` (4 + `in_progress`), `payment_method` (3), `payment_status` (5 + `cancelled`), `document_type` (4 + `payment_instruction` + `library_document` en M26), `expense_type` (5), `expense_status` (5), `production_status` (6), `import_status` (5), `import_row_action` (6), `commercial_offer_status` (4), `commercial_proposal_status` (8), `commercial_payment_plan` (2). **Les extensions 16-24 n'ajoutent aucun enum** : nouveaux domaines en `text` + contraintes `check` (évolution sans `alter type`).

## 4. Tables (42) — par domaine

Légende : **PK** = clé primaire, UK = contrainte unique, FK = référence, CK = check notables, RLS = politiques en § 6.

### 4.1 Identité et CRM (8)

- **profiles** — identité métier : `id` **PK** FK→`auth.users` (cascade), `full_name`, `phone`, `role` (text + FK `roles(code)` depuis M16, défaut `sales_rep`), `is_active`, `territory`, `joined_at`, `created_at`, `updated_at`. Triggers : `updated_at`, anti-changement de rôle direct, anti-bascule `is_active` directe. UPDATE direct révoqué (migration 14).
- **companies** — sociétés (clients/fournisseurs/partenaires) : `legal_name`, `industry`, `address`, `city`, `country_code` (2 lettres, défaut `TG`), `email`, `phone`, `normalized_phone`, `website`, `notes`, `neighborhood`, `has_website`, `created_by` FK. UK partielle `normalized_phone`. Insert direct révoqué (création via RPC). **M26** : +`trade_name` (nom commercial, index fonctionnel), +`registration_number` (RCCM), +`tax_number`, +`is_active` (défaut true) + audit `crm_audit_companies`.
- **contacts** — personnes référentes : `company_id` FK (cascade), `full_name`, `job_title`, `email`, `phone`, `normalized_phone`, `whatsapp`, `is_primary`, `notes`. Index recherche email. **M26** : +`is_active` (défaut true).
- **leads** — opportunités : `company_id` FK, `assigned_to` FK, `source`, `identified_need`, `status lead_status` défaut `new` (garde : insertion hors `new` refusée), `priority` (`low|normal|high`), `interested_offer`, `notes`, `next_follow_up_at` (synchronisé depuis `follow_ups`), `converted_at`, `source_import_row_id` (UK, FK), `created_by` FK. Attributions/statuts via RPC uniquement (garde trigger).
- **activities** — historique : `lead_id` FK (cascade), `author_id` FK, `activity_type`, `occurred_at`, `subject`, `body`, `channel`, `outcome`, `interaction_status`, `next_action_at`, `metadata jsonb`. Insertion de `status_change` réservée au RPC.
- **appointments** — rendez-vous : `lead_id`, `sales_rep_id`, `kind` (`meeting|demo`), `scheduled_at`, `status` (6 valeurs), `location_or_channel`, `solution_presented`, `objections`, `next_action_at`, `completed_at`. CK : champs démo réservés aux démos.
- **follow_ups** — relances : `lead_id`, `responsible_id`, `due_at`, `reason`, `status` (4), `completed_at`. Trigger : met à jour `leads.next_follow_up_at`.
- **lead_assignments** — journal d'attribution (lecture seule) : `lead_id`, `old_assignee_id`, `new_assignee_id`, `actor_id`, `reason`. CK : changement réel.

### 4.2 Catalogue et offres (2)

- **offer_templates** — catalogue versionné : `name`, `category`, `description`, `price_xof`, `currency` (=`XOF`), `price_is_starting`, `benefits/included_services/exclusions jsonb`, `delivery_days`, `payment_terms`, `validity_days`, `valid_from/until`, `version`, `family_id` (UK famille+version), `status commercial_offer_status`, `is_active`, `published_at`, `created_by`, `updated_by/at`. Garde : termes publiés immuables (nouvelle version obligatoire).
- **commercial_settings** — réglages officiels PDF (ligne unique `id=true`) : `company_name` (défaut **EBI-IMT**), emails/téléphone/adresse/mentions légales, `logo_storage_path`. UPDATE RLS réservé admin.

### 4.3 Propositions et commandes (6)

- **commercial_proposals** — propositions : `proposal_number` UK (`PROP-YYYY-######`), `lead_id`, `company_id`, `contact_id`, `sales_rep_id`, offre (`offer_template_id`+`offer_version` FK composite, `offer_snapshot`, `client_snapshot`), `service_description`, `base_price_xof`, `discount_xof`, `amount_xof` (= base − remise, CK), `payment_plan`, `special_terms`, `delivery_days`, `expires_at` (≤ 365 j), `status` (8 états), cycle d'approbation (`requires_approval`, `approved_by/at`, `approval_reason`), envoi (`sent_by/at/channel`), acceptation (`accepted_at`, `acceptance_recorded_by`, `channel`, `reference`, `verified*`), `created_by`. Écriture 100 % RPC.
- **commercial_proposal_events** — traçabilité : `proposal_id`, `actor_id`, `event_type`, `details`.
- **orders** — commandes : `order_number` UK (`CMD-YYYY-######`), `company_id`, `lead_id`, `sales_rep_id` (NOT NULL), offre (`offer_template_id`+`version`, `offer_snapshot`), `amount_xof`, `ordered_at`, `confirmed_at` (CK : confirmé ⇒ horodaté), `contractual_terms`, `order_status`, `proposal_id` UK FK, `payment_plan`, `payment_terms_snapshot`, `production_status_note`, `project_id` UK FK (M21), `created_by`. Garde : commandes confirmées immuables sur les termes.
- **order_installments** — échéancier : `order_id`, `installment_number` (1-2), `trigger_event` (`at_order|at_delivery`), `percentage_bps`, `amount_xof`, `due_at`, `terms`. UK commande+n°.
- **commercial_order_events** — traçabilité commandes.
- **production_projects** — exécution 1-1 commande : `order_id` UK, `responsible_id`, `status production_status`, dates planifiées/réelles, `stages jsonb`, `notes`. (Reste dédié à la PRODUCTION d'une commande ; les projets d'exécution EBI-IMT sont la table `projects`, § 9.6.)

### 4.4 Paiements et finance (8)

- **payments** — déclarations d'encaissement (append-only) : `order_id`, `amount_xof` (>0), `method`, `transaction_reference`, `paid_at`, `status`, `verified_by/at`, `correction_of`, `notes`, `payment_account_id`, `installment_id`, `declared_at`, `review_state` (`declared|awaiting|needs_info|resolved`), `proof_path` UK, `verification_source/reference/note`, `cash_received_by`, `cash_handed_over_at`, `invoice_id` FK (M24), `created_by`. UPDATE/DELETE bloqués par trigger + privilèges révoqués. CK : confirmé ⇒ vérifié. UK partielles anti-doublon de référence (déclarée, puis confirmée).
- **payment_accounts** — comptes officiels : `method`, `provider_name`, `holder_name`, `account_identifier`, `client_instructions` (NOT NULL), `internal_notes` (admin), `cash_responsible_id`, `is_active`, `created_by/updated_by`. CK cohérence cash vs. bancarisé.
- **finance_verifiers** — délégation de vérification : `user_id` PK, `enabled`, `granted_by/at`. RLS : admin ou soi-même.
- **payment_events** — traçabilité des paiements.
- **financial_adjustments** — corrections/remboursements : `payment_id`, `order_id`, `kind` (`correction|refund`), `amount_xof` (>0), `status` (`requested→approved→executed|rejected`), `reason`, `verification_source`, `external_reference`, `requested_by`, `approved_by/at`, `executed_by/at`.
- **financial_ledger** — journal financier append-only : `id` identity, `order_id`, `payment_id` (UK partielle), `adjustment_id` (UK partielle), `entry_kind` (`collection|correction|refund`), `amount_xof` (≠0, signe cohérent avec kind), `recorded_by/at`. Trigger : toute UPDATE/DELETE impossible.
- **finance_settings** — ligne unique : `receipt_prefix` (regex 3-20, défaut **`CTX-REC`** ⚠ voir audit, correction D3 avant premier push) — séquences `finance_receipt_number_seq`, `finance_instruction_number_seq` (préfixe instruction en dur `CTX-PAY-` dans le RPC, migration 10, ligne 291).
- **finance_document_jobs** — tâches PDF durables : `kind` (`receipt|instructions`), `payment_id`, `order_id`, `installment_id`, `document_number` UK, `snapshot jsonb`, `status` (`pending|processing|failed|completed`), `attempts`, `last_error/at`, `storage_path` UK, `content_hash`, `document_id` UK. CK cohérence kind/statut. UK partielle : un reçu par paiement.

### 4.5 Documents (1)

- **documents** — métadonnées officielles : `document_type` (4 + `payment_instruction`), `payment_id`, `order_id`, `offer_template_id`, `proposal_id`, `storage_path` UK, `document_number` UK, `content_hash` (SHA-256), `document_version` (UK partielle par proposition), `document_status` (`issued|superseded|void`), `issued_at`, `metadata jsonb`, `created_by`, + cycle de vie M19 : `deleted_at/deleted_by/deleted_reason` (corbeille logique, CK `documents_deletion_complete`), `supersedes_id` (auto-FK), `family_key` (index versions desc). Garde : reçu ⇒ paiement confirmé. Insert/Update/Delete directs révoqués (émission via Edge + service_role uniquement).

### 4.6 Terrain (7)

- **field_policy_versions** — politiques versionnées (immuables par trigger) : `version_no` UK, `effective_from` UK, `startup_amount_xof` (défaut semé 5 000), `communication_amount_xof` (500), `communication_interval_days` (3), `allowed_categories`, `receipt_required_categories`, `period_cap_xof`, `reimbursement_rules/approval_rules jsonb`, `created_by`.
- **field_budget_permissions** — délégation de gestion des fonds : `user_id` PK (exige `sales_manager`), `enabled`, `granted_by/at`.
- **field_budgets** — budgets autorisés : `sales_rep_id`, `kind` (`startup|transport|other`), `policy_id`, `period_start/end`, `authorized_xof`, `purpose`, `prospecting_zone` (exigée pour transport), `allowed_categories`, `status` (5), `exception_of` + `exception_reason` (démarrage : une seule dotation par commercial, UK partielle), `authorized_by/at`.
- **field_advances** — avances : `budget_id` UK, `sales_rep_id`, `requested_xof`, `approved_xof`, `disbursed_xof` (≤ approuvée), `status` (6), `approved_by/at`, `disbursed_by/at`, `transfer_method/reference` (UK partielle anti-doublon), `handover_proof_path` UK, `closed_by/at`. CK : décaissée/clôturée ⇒ preuve + référence.
- **field_expenses** — dépenses justifiées : `sales_rep_id`, `budget_id`, `advance_id` (CK cohérence source de financement), `category` (3), `funding_source` (`advance|personal|company`), `amount_xof`, `incurred_at`, période (UK partielle anti-double période communication), `description`, `prospecting_zone`, `transport_mode`, `beneficiary_phone`, `payment_reference`, `lead_id`, `proof_path` UK, `status` (5), `reimbursement_status` (`not_applicable|due|paid`) + référence/horodatage (UK partielle), `submitted_by`, `approved_by/at`, `exception_reason`.
- **field_restitutions** — restitutions : `advance_id`, `amount_xof`, `declared_by/at`, `status` (`declared|verified|rejected`), `verified_by/at`, `received_reference` (UK partielle), `proof_path`, `reason`. CK : vérifiée ⇒ preuve + référence.
- **field_finance_events** — événements terrain/commissions (immuables par trigger) : `entity_kind` (9), `entity_id`, `event_type`, `actor_id`, `details`.

### 4.7 Commissions (5)

- **commission_policies** et **commissions** — socle initial, **gelés** (écritures directes révoquées, lecture conservée).
- **sales_commission_policies** — politiques versionnées (immuables) : `version_no` UK, `name`, `effective_from`, `basis` (`confirmed_collected_amount|fixed_per_sale|gross_margin`), `vesting` (`progressive|full_collection`), `rate_bps`/`fixed_amount_xof` (CK exclusif), `offer_template_id`/`sales_rep_id` (scoping), `refund_rule`, `eligibility jsonb`, `published_by/at`.
- **sales_commission_positions** — positions : `order_id` UK, `sales_rep_id`, `policy_id`, `policy_snapshot`, `eligible_base_xof`, `acquired_xof` (recalculées par trigger à chaque écriture ledger), `approved_xof/by/at`.
- **sales_commission_payouts** — versements : `position_id`, `amount_xof`, `paid_at`, `method`, `external_reference` UK, `proof_path`, `recorded_by`.

### 4.8 Socle transverse (5)

- **expenses** — dépenses legacy (gelées, lecture seule).
- **audit_logs** — journal append-only polymorphe : `id` identity, `actor_id`, `action`, `entity_table`, `entity_id`, `changes`, `context`. `FORCE ROW LEVEL SECURITY`. Alimenté par triggers CRM + RPC métier. RLS lecture : admin/manager.
- **import_batches** — lots : `uploaded_by`, `file_name`, `file_hash` (UK par utilisateur), `file_size_bytes` (≤ 10 Mo), `file_format`, `storage_path` UK, `column_mapping`, `status`, compteurs (`analyzed/created/updated/duplicate/rejected/conflict`).
- **import_rows** — lignes : `batch_id` FK (cascade), `row_number` (UK batch+n°), `raw_data`, `normalized_data`, `action`, `matched_lead_id`, `decision_action`, `reviewed_by/at`. Écritures via RPC uniquement.
- **expense_policies** — politiques legacy (lecture publique authentifiée, gelées).

## 5. Séquences

`proposal_number_seq`, `commercial_order_number_seq`, `finance_receipt_number_seq`, `finance_instruction_number_seq`, identities sur `audit_logs` et `financial_ledger`. La numérotation des extensions (DAO/PRO/ACH/LIV/FAC) est portée par la **table** `official_sequences` (§ 9.2), pas par des séquences PostgreSQL.

## 6. Sécurité au niveau des lignes (RLS)

### 6.1 Helpers (`schema private`, tous security definer, `search_path` verrouillé, exécution accordée à `authenticated` seulement)

| Fonction | Retour | Sémantique |
| --- | --- | --- |
| `current_app_role()` | `app_role` | rôle si profil **actif**, sinon NULL |
| `can_manage_all()` | boolean | `admin` ou `sales_manager` |
| `crm_active()` | boolean | profil actif existe |
| `crm_actor(bool manager_only)` | uuid | authentification + profil actif (+ rôle manager) |
| `commercial_lead_access(uuid)` | boolean | manager OU prospect attribué |
| `finance_can_verify()` | boolean | admin OU `sales_manager` habilité (`finance_verifiers`) |
| `field_can_manage()` | boolean | admin OU `sales_manager` habilité (`field_budget_permissions`) |
| `current_role_code()` | text | code de rôle depuis `profiles.role` (text, M16) — porte les politiques restrictives |
| `permits(module, action)` | boolean | permission selon la matrice `role_permissions` (admin bypass) — M16, exécution accordée à `authenticated` (M17) |
| `create_pending_profile_for_auth_user()` | trigger | profil inactif à l'inscription |

### 6.2 Principe

- RLS activé sur les 42 tables du socle **et les 23 tables des extensions** (politique SELECT recréée à chaque migration, mitige S10). **Aucune politique DELETE** : aucune suppression directe possible.
- Politique **restrictive** `active_profile_gate` (migration 15) sur toutes les tables RLS sauf `profiles` : exige un profil actif — une session sans profil approuvé ne lit rien. **Les extensions 16-24 recréent cette porte manuellement sur chacune de leurs tables.**
- `anon` : tous privilèges révoqués sur `public.*` et `storage.objects` (+ les 23 tables des extensions).
- `authenticated` : SELECT partout ; INSERT/UPDATE **uniquement là où aucune RPC ne s'y substitue** (les extensions 16-24 n'accordent AUCUNE écriture directe, hors UPDATE admin sur la matrice `role_permissions`).

### 6.3 Synthèse par domaine

| Domaine | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| profiles | soi ou manager | admin (jamais un admin) | **aucun direct** (RPC) | non |
| CRM (companies, contacts, leads, activities, appointments, follow_ups) | manager OU prospect attribué | via RPC (`crm_*`) | via RPC | non |
| Catalogue | actif (versions actives ; tout pour manager) | RPC admin | RPC admin | non |
| Propositions/commandes/échéanciers | manager OU portefeuille | RPC | RPC (transitions contrôlées) | non |
| Paiements/ledger/comptes finance | portefeuille OU manager ; comptes : admin | RPC | RPC | non (ledger immuable) |
| Documents | ligne métier accessible | **aucun direct** (Edge service_role) | non | non |
| Terrain | manager OU commercial concerné | RPC | RPC | non |
| Commissions | manager OU commercial concerné | RPC admin | RPC | non |
| Imports | ses lots OU manager | RPC | RPC | non |
| audit_logs | manager | triggers/RPC seulement | non | non |
| Extensions EBI-IMT (§ 9) | `permits(module,'select')` (+ lectures croisées § 10) | **aucun direct** (RPC Phase 3) | UPDATE admin sur `role_permissions` seulement | non |

### 6.4 Storage (4 buckets privés)

| Bucket | Limite | MIME | Écriture | Lecture |
| --- | --- | --- | --- | --- |
| `ebi-documents` | 10 Mo | PDF | **service_role uniquement** (politique INSERT retirée en migration 7) | ligne `documents` correspondante requise |
| `ebi-imports` | 10 Mo | CSV/XLSX | manager, objet possédé par soi ; **immuable** (UPDATE retiré) | possesseur ou manager |
| `ebi-payment-proofs` | 5 Mo | JPEG/PNG/PDF | déclarant du paiement pending, chemin `payments/{id}/…` | ligne `documents`/paiement correspondante |
| `ebi-field-proofs` | 5 Mo | PDF/JPEG/PNG | propriétaire du chemin `field/{uid}/…` | admin, manager habilité, ou possesseur |

Porte restrictive supplémentaire (migration 15) : sessions sans profil actif exclues des 4 buckets.

## 7. Fonctions RPC publiques (65 + 1)

Par domaine — toutes `security definer`, `search_path` verrouillé, rôle vérifié en début, audit/événements écrits :

- **CRM (9)** : `crm_save_lead`, `crm_assign_leads`, `crm_set_lead_status`, `crm_set_sales_active`, `crm_domain`, `crm_update_sales_profile`, `crm_prepare_import`, `crm_commit_import`, `crm_search_leads`.
- **Commerciaux (12)** : `commercial_save_offer`, `commercial_clone_offer`, `commercial_set_offer_status`, `commercial_save_proposal`, `commercial_submit_proposal`, `commercial_approve_proposal`, `commercial_issue_payload`, `commercial_send_proposal`, `commercial_record_acceptance`, `commercial_verify_acceptance`, `commercial_close_proposal`, `commercial_create_order`, `commercial_set_order_status` (13 avec le statut).
- **Finance (13)** : `finance_list_accounts`, `finance_save_account`, `finance_set_verifier`, `finance_set_receipt_prefix`, `finance_declare_payment`, `finance_attach_proof`, `finance_review_payment`, `finance_confirm_payment`, `finance_request_instructions`, `finance_job_payload`, `finance_request_adjustment`, `finance_approve_adjustment`, `finance_execute_adjustment`.
- **Terrain (13)** : `field_publish_policy`, `field_set_budget_permission`, `field_create_budget`, `field_request_advance`, `field_approve_advance`, `field_attach_proof`, `field_disburse_advance`, `field_submit_expense`, `field_review_expense`, `field_pay_reimbursement`, `field_declare_restitution`, `field_verify_restitution`, `field_close_advance`.
- **Commissions (4)** : `sales_publish_commission_policy`, `sales_recalculate_commission`, `sales_approve_commission`, `sales_record_commission_payout`.
- **Réservées `service_role` (Edge, 4)** : `commercial_finalize_document`, `finance_claim_document_job`, `finance_fail_document_job`, `finance_finalize_document_job`.
- **Signalement (1)** : `ebi_signup_ready` (granted à `anon`, pré-check d'inscription).
- **Numérotation (1, M17)** : `next_official_number(kind)` — émission des numéros DAO/PRO/CMD/ACH/LIV/FAC, appelée par les RPC des extensions ; jamais appelée directement par le client.
- **Appels d'offres / Projets / Production (9, M29 ; corps redéfinis en M30)** : `tender_create`, `tender_update`, `tender_set_status` (10 états : `gagne` ⇒ `validate` de la matrice + montant > 0 ; `perdu` ⇒ motif), `tender_item_add`, `tender_item_remove`, `tender_quote_set` (écritures limitées aux 5 états pré-dépôt), `project_create` (DAO gagné uniquement), `project_set_status`, `production_update` (permits `commandes`, horodatages auto, audit manuel).
- **Relations appels d'offres (2, M30)** : `order_set_tender`, `proposal_set_tender` — rattachement/détachement (par `null`) d'une commande ou d'une proposition à un dossier DAO (permits `commandes`/`propositions` update).

Les 5 fonctions socle redéfinies en M16 (`current_app_role`, `crm_actor`, `set_profile_role`, `commercial_finalize_document`, `create_pending_profile_for_auth_user`) conservent leurs privilèges et signatures.

### Garde-fous par déclencheur (extrants structurels)

Insertion paiement non-pending refusée ; commandes confirmées immuables ; reçu sans paiement confirmé refusé ; catalogue publié immuable ; statuts CRM via RPC uniquement ; mutation financière impossible (extendue à `supplier_payments`, M22) ; polices/événements terrain immuables ; profils (rôle, activation) via RPC uniquement ; exclusivité client/fournisseur des livraisons ; cohérence HT/TVA/TTC des factures.

## 8. Interdépendances modules ↔ tables

| Module frontend | Tables principales | RPC |
| --- | --- | --- |
| Prospects, Activités, Commerciaux | companies, contacts, leads, activities, appointments, follow_ups, lead_assignments | crm_* (9) |
| Imports | import_batches, import_rows, leads, companies, contacts | crm_prepare/commit_import, crm_save_lead |
| Offres | offer_templates, commercial_settings | commercial_save/clone/set_offer_status |
| Propositions | commercial_proposals, _events, documents | commercial_save/submit/approve/send/record/verify/close, commercial_issue_payload |
| Commandes | orders, order_installments, commercial_order_events, production_projects | commercial_create_order, commercial_set_order_status |
| Paiements | payments, payment_accounts, finance_verifiers, payment_events, financial_ledger, financial_adjustments, finance_settings, finance_document_jobs, documents | finance_* (12) |
| Dépenses terrain | field_policy_versions, field_budget_permissions, field_budgets, field_advances, field_expenses, field_restitutions, field_finance_events | field_* (13) |
| Commissions | sales_commission_*, financial_ledger (lecture), field_finance_events | sales_* (4) |
| Rapports/Dashboard | agrégats lecture : leads, appointments, activities, orders, payments, financial_ledger, sales_commission_* | requêtes directes RLS |
| PDF (Edge) | documents, finance_document_jobs, commercial_proposals, commercial_settings, storage ebi-documents | service_role : claim/fail/finalize, commercial_finalize_document |

Chaîne critique : `leads → commercial_proposals → orders → payments → financial_ledger → sales_commission_positions` et `field_policy_versions → field_budgets → field_advances → field_expenses/field_restitutions`. Toute évolution de schéma en Phase 1 doit préserver ces liens et l'append-only des journaux.

---

# Partie 2 — Extensions EBI-IMT (migrations 16-31, PROMPT 2/3/4 + appels d'offres étendu)

> Statut : **appliqué** (31/31 au projet `xxilfzpkdwggfilwyrjw`, 2026-11-13). Chaque migration porte en en-tête son objectif, ses tables, ses dépendances, ses risques et son retour arrière (détail opérationnel dans `docs/migration-plan.md` § 5). Relations complètes et transitions : `docs/database-relations.md`.

## 9. Tables des extensions (27)

### 9.1 Gouvernance (M16 — 2)

- **roles** — référentiel des rôles : `code` PK, `label` UK, `description`, `is_deprecated`, `created_at`. Semé : `admin`, `direction`, `commercial`, `achats`, `finance`, `lecture_seule` + codes hérités dépréciés `sales_manager`/`sales_rep` (compatibilité des littéraux du socle).
- **role_permissions** — matrice granulaire : `role` FK, `module` (CHECK 23 modules), `p_select/p_insert/p_update/p_validate/p_delete`, PK (role, module). Semée comme **défaut de référence à confirmer par la direction (V2.1)** ; modifiable par l'admin sans migration.
- Bascule : `profiles.role` enum→`text` + FK `profiles_role_fk` → `roles(code)`. Cinq fonctions du socle redéfinies à l'identique avec cast explicite (`current_app_role`, `crm_actor`, `set_profile_role`, `commercial_finalize_document`, `create_pending_profile_for_auth_user`).

### 9.2 Numérotation (M17 — 1)

- **official_sequences** — compteurs annuels : `kind` PK (`dao|pro|cmd|ach|liv|fac`), `prefix` UK, `current_year`, `next_number`, `updated_by/at`. Semée (préfixes DAO/PRO/CMD/ACH/LIV/FAC). RPC `next_official_number(kind)` : `PREFIXE-AAAA-NNNNNN`, verrou `FOR UPDATE`, remise à zéro au 1er janvier ; branche `cmd` délègue à la séquence socle (format CMD inchangé). Lecture RLS réservée `parametres`.

### 9.3 Référentiel sociétés (M18 — 1)

- **company_roles** — `company_id` FK (cascade), `role_code` CHECK (`client|fournisseur|partenaire|agence`), PK (company_id, role_code). Une société cumule les rôles sans dupliquer sa fiche.

### 9.4 Bibliothèque documentaire (M19 — 4 + documents étendu)

- **documents** (+) : `deleted_at/deleted_by/deleted_reason` (corbeille logique, CHECK `documents_deletion_complete`), `supersedes_id` (auto-FK, chaînage des versions), `family_key` (index partiel versions desc). Politiques existantes inchangées.
- **document_uploads** — staging : `bucket_id` CHECK (3 buckets socle **+ `r2-library` en M27**), `storage_path` UK, `sha256`, `mime_type`, `size_bytes`, `uploaded_by`, `status` (`staged|attached|orphan`), `document_id`.
- **document_access_logs** — journal append-only des accès : `document_id`, `actor_id`, `action` (`view|download|emit|void|delete|restore` **+ `upload` en M27**), PK identity.
- **document_links** — lien polymorphe : `document_id` (cascade), `entity_table` CHECK (12 tables **+ `companies`/`contacts` en M27**), `entity_id`, `link_role` (`source|attachment|output`), UK (document, entity, role).
- **document_reconciliation** — audit stock R2 ↔ base : `bucket_id`, `storage_path` UK, `expected/found_sha256`, `status` (`missing|orphan|hash_mismatch|resolved`), `resolved_by/at`.
- **M27** : RPC utilisateur `document_download_allowed(uuid)`, `user_permits(text,text)`, `document_request_delete(uuid,text)`, `document_request_restore(uuid)` ; lecture `documents` ouverte au module bibliothèque (`permits('bibliotheque','select')`) ; écritures directes toujours révoquées (les Edge agissent avec la clé service).

### 9.5 Appels d'offres (M20 — 4, étendus en M30)

- **tenders** — `tender_number` UK (DAO-…), `title`, `organism_company_id` FK, `sector`, `source`, `submission_deadline`, `opening_at`, `status` CHECK **10 états M30** (`identifie|a_analyser|en_preparation|attente_documents|pret_deposer|depose|en_evaluation|gagne|perdu|annule`, matrice de transitions dans les RPC), `awarded_amount_xof/at`, `lost_reason`, **M30 : `description`, `publication_date`, `estimated_amount_xof`, `our_amount_xof`, `responsible_id` FK profiles, rename `observations`**. Audit `crm_audit_row`.
- **tender_items** — lignes du DAO : UK (tender_id, position), CHECK `amount = round(qté × prix)`.
- **tender_quotes** — devis fournisseurs par ligne : UK (item, supplier), `quote_xof`.
- **tender_events** — traçabilité.
- **M30 — suivi** : **tender_documents** (document_id FK documents + category CHECK 9 catégories DAO/pièces/offre technique/offre financière/devis/justificatifs/correspondances/PV/résultats, UK (document, tender) — la bibliothèque reste le stockage maître), **tender_tasks** (tâches assignées : label, assignee FK profiles, due_date, done_at/by), **tender_reminders** (rappels : remind_at, done_at), **tender_comments** (commentaires avec event_kind optionnel) — toutes RLS full CRUD `authenticated`.
- **M30 — relations** : `orders.tender_id` et `commercial_proposals.tender_id` (FK additives, index) — une commande ou une proposition peut être rattachée à un DAO (`order_set_tender`/`proposal_set_tender`).
- **M31 — produits** : `tender_items.offer_template_id` FK `offer_templates` (optionnel, `on delete set null`) — chaque ligne du DAO peut référencer un produit/service du catalogue actif (`tender_item_add` vérifie `status = 'active'`) ; la désignation libre reste possible. Les livraisons restent reliées de façon transitive via `deliveries.order_id → orders.tender_id`.

### 9.6 Projets (M21 — 1 + orders étendu)

- **projects** — `project_number` UK (PRO-…), `title`, `client_company_id`, `tender_id` FK (DAO gagné), `manager_id`, `status` CHECK (`planned|in_progress|suspended|completed|cancelled`), dates plan/réel, `budget_xof`, CHECK completed ⇒ actual_end_date. Audit.
- **orders** (+) : `project_id` UNIQUE FK (une commande = un projet max). Strictement additif ; `production_projects` (production d'une commande) reste séparé.

### 9.7 Achats (M22 — 5)

- **purchase_orders** — `purchase_number` UK (ACH-…), `supplier_company_id`, `order_id`/`project_id` FK optionnelles, `status` CHECK (6 états), CHECK confirmed ⇒ confirmed_at, `total_xof` (maintenu par RPC).
- **purchase_order_lines** — UK (po, position), CHECK `amount = round(qté × prix)`.
- **supplier_invoices** — `supplier_invoice_number` UK partielle, `invoice_date`, `amount_ht/tva/ttc_xof` avec CHECK `ttc = ht + tva`, `status` CHECK (7 états), `received_by/at`. Numérotation fournisseur différée Phase 4 (D3).
- **supplier_payments** — append-only (trigger `prevent_financial_mutation`, identique à `payments`) : `supplier_invoice_id`, `amount_xof` > 0, `method` CHECK (4), UK partielle anti-doublon de référence confirmée, CHECK confirmé ⇒ vérifié.
- **supplier_payment_events** — traçabilité.

### 9.8 Livraisons (M23 — 2)

- **deliveries** — `delivery_number` UK (LIV-…), `kind` CHECK (`client_delivery|supplier_reception`) avec **CHECK d'exclusivité** (client ⇒ order_id seul ; fournisseur ⇒ purchase_order_id seul), `status` CHECK (5), CHECK delivered ⇒ delivered_at, `received_by_name` (signataire externe), `received_by`. Audit.
- **delivery_lines** — UK (delivery, position), `purchase_line_id` FK optionnelle (réception par ligne d'achat), `received_ok`.

### 9.9 Facturation client (M24 — 3 + payments étendu)

- **invoices** — `invoice_number` UK (FAC-…), `order_id` NOT NULL, `company_id`, `amount_ht/tva/ttc_xof`, `vat_rate_bps` (0-10000) avec **CHECK ttc = ht + tva** et **CHECK tva = round(ht × bps / 10000)**, `status` CHECK (`draft|issued|partially_paid|paid|cancelled`), CHECK issued ⇒ issued_at. Audit.
- **invoice_lines** — UK (invoice, position), CHECK amount = round(qté × prix).
- **invoice_events** — traçabilité.
- **payments** (+) : `invoice_id` FK additive (apurement facture par facture) ; table append-only inchangée.

## 10. Sécurité des extensions

- **RLS activé sur les 27 tables** (23 M16-24 + 4 M30), politique SELECT pour `authenticated` seulement, **aucun INSERT/UPDATE/DELETE accordé** : écritures via RPC (Phase 3), à l'exception de la matrice `role_permissions` (UPDATE admin) et des 4 tables de suivi DAO (full CRUD `authenticated` en M30).
- Politiques SELECT : `permits('module','select')` avec lectures croisées là où pertinent (`supplier_invoices`/`supplier_payments` : achats OU facturation ; `deliveries` client : livraisons OU commandes ; `company_roles` : clients OU fournisseurs OU partenaires ; `document_access_logs`/`document_links` : visibilité du document parent ; `document_uploads` : déposant OU bibliothèque ; `document_reconciliation`/`official_sequences` : paramètres).
- **Porte restrictive `active_profile_gate` recréée manuellement sur chaque nouvelle table** (mitigation S10) : une session sans profil actif ne lit rien.
- `anon` : tous privilèges révoqués sur les 23 tables. Grants SELECT explicites à `authenticated`.
- `permits()` (security definer, search_path verrouillé, admin bypass) : exécution accordée à `authenticated` en M17 ; utilisée exclusivement dans les politiques RLS et futures RPC.

## 11. Numérotation et règles d'intégrité nouvelles

- Table de numérotation complète et règles annuelles : `docs/database-relations.md` § 12. Contraintes financières en base (FCFA bigint, TTC = HT + TVA, lignes = quantité × prix, exclusivité livraisons, append-only `supplier_payments`) : `docs/database-relations.md` § 13.

## 12. Interdépendances étendues (modules ↔ tables)

| Module EBI-IMT | Tables principales | Écritures prévues (Phase 3) |
| --- | --- | --- |
| Appels d'offres | tenders, tender_items (+offer_template_id), tender_quotes, tender_events, tender_documents, tender_tasks, tender_reminders, tender_comments, documents, companies, profiles, offer_templates | RPC tender_* (création `next_official_number('dao')`, transitions 10 états), suivi en full CRUD, `order_set_tender`/`proposal_set_tender` |
| Projets | projects, orders (project_id), tenders | RPC project_* (création, rattachement commande) |
| Achats | purchase_orders/_lines, supplier_invoices, supplier_payments, _events, company_roles | RPC purchase_*/supplier_* (immutabilité décaissements) |
| Livraisons | deliveries, delivery_lines, orders, purchase_orders | RPC delivery_* (transitions, réception par ligne) |
| Facturation | invoices/_lines/_events, payments (invoice_id), orders | RPC invoice_* (émission Edge, apurement) |
| Bibliothèque | documents (+ lifecycle), document_uploads/_access_logs/_links/_reconciliation | RPC document_* (corbeille, rattachement), Edge service_role |
| Utilisateurs/Paramètres | roles, role_permissions, profiles, official_sequences, settings | UPDATE matrice par l'admin ; numérotation en lecture |

Chaîne critique étendue : `leads → commercial_proposals → orders → payments → financial_ledger → sales_commission_positions` **et** `tenders → (gagné) → projects → {purchase_orders → supplier_invoices → supplier_payments ; orders.project_id}` **et** `orders/purchase_orders → deliveries` **et** `orders → invoices ← payments`. Préserver l'append-only de tous les journaux.
