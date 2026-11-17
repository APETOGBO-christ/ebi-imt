# Plan de migration vers le nouveau projet Supabase — EBI-IMT Business Manager

Stratégie de mise en place d'un projet Supabase **neuf** pour EBI-IMT, établie le 12 novembre 2026. Règle absolue : **l'ancien projet Cortexia ne reçoit jamais de migration** (aucune commande `db push`, `db reset` ou `db execute` ne doit le viser).

## 1. Situation de départ (vérifiée)

| Élément | État |
| --- | --- |
| Ancien projet (cortexiagroup) | Lié historiquement, 3/15 migrations appliquées, abandonné — **aucune opération** |
| Lien CLI local | Lié au projet neuf `xxilfzpkdwggfilwyrjw` (EBI Manager) — ancien ref `qyyvgmndcaroywkyefdf` jamais touché |
| `.env.local` | URL + clé publishable du projet neuf (aucune clé service côté frontend) |
| Migrations locales | **37** applicables depuis zéro (15 socle + 22 extensions EBI-IMT, 70 tables) |
| Code | typecheck OK, 46/46 tests Vitest OK, build OK (preuves dans `docs/audit-final.md` § 7) |

## 2. Ordre d'application des migrations

Les **37** fichiers s'appliquent dans l'ordre chronologique de leur horodatage (convention `supabase db push`) : migrations 1-15 = socle Cortexia audité, migrations **16-37 = extensions EBI-IMT** (PROMPT 2/3/4 + module appels d'offres étendu + durcissement sécurité + journalisation auth + compatibilité des six rôles). État attendu après push complet : **70 tables** (42 socle + 28 extensions), 16 enums (+1 valeur `library_document` en M26), 5 séquences socle + table `official_sequences`, 4 buckets Storage, ~65 RPC métier publiques, RLS intégral avec porte `active_profile_gate` sur chaque table d'extension. Le point de contrôle exact est défini dans `docs/phase-0-checklist.md` (V4-V5).

Particularités à connaître avant le push :

1. **Migration 9 (finance)** : contient un backfill `insert into financial_ledger … from payments where status='confirmed'` — sur base vide, insère **0 ligne** (sans effet, à constater lors du push).
2. **Migration 15 (inscription)** : crée un trigger sur `auth.users` et une porte restrictive sur les tables RLS — sans effet tant qu'aucun utilisateur n'existe ; **décision D2** conditionne son maintien.
3. **Migration 14** : révocation UPDATE sur `profiles` — le pgTAP n° 33 la vérifie ; indispensable au passage des tests.
4. **S2/S5 de `docs/security-review.md`** : corrections recommandées **avant** le premier push, en modification directe des fichiers de migration (légitime : aucune base n'a jamais appliqué ces fichiers) — voir § 4.
5. **Migration 16** : la matrice `role_permissions` semée est un **défaut de référence** — la direction doit la confirmer ou l'ajuster (V2.1) ; ajustable ensuite par l'admin sans migration. Les 2 codes hérités (`sales_manager`, `sales_rep`) restent valides.
6. **Migration 17** : accorde `permits()` à `authenticated` — sans elle, toutes les politiques RLS des migrations 18-24 échoueraient à l'exécution.
7. **Migration 25 (PROMPT 3)** : USAGE du schéma `private` (politiques RLS fonctionnelles), EXECUTE du trigger d'invitation pour `supabase_auth_admin`, MFA aal2 sur les opérations sensibles, protection du dernier administrateur, RPC d'administration des profils, `ebi_signup_ready` → `false` (D2). Détail : `docs/security-model.md`.

## 3. Procédure de création du projet (étapes ordonnées)

| Étape | Action | Commande / lieu | Garde-fou |
| --- | --- | --- | --- |
| 1 | Créer le projet sur le compte EBI-IMT (région proche, PostgreSQL 17) | Tableau de bord Supabase | Noter le `project_ref` et l'URL ; vérifier qu'il ne s'agit PAS de l'ancien ref |
| 2 | Configurer l'authentification **avant tout utilisateur** : inscriptions publiques désactivées, mot de passe ≥ 10 avec composition, confirmations selon D2, sessions `timebox`/`inactivity_timeout`, SMTP réel, URL de site = domaine Pages | Tableau de bord Auth | Capture d'écran / export de config comme preuve |
| 3 | Préparer `.env.local` avec `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` du nouveau projet | Local | La clé secrète/service_role ne va jamais dans un fichier `VITE_*` |
| 4 | Lier le CLI : `supabase login` puis `supabase link --project-ref <ref neuf>` | CLI | Vérifier deux fois le ref ; ensuite `supabase migration list --linked` doit afficher **0 migration** |
| 5 | Revue finale des 27 migrations (checklist V4 de Phase 0) + corrections S5/D3 **appliquées** + validation V2.1 de la matrice | Lecture + édition locale | Aucun push avant validation de la revue |
| 6 | Appliquer : `supabase db push` (ou `--dry-run` d'abord) | CLI | Vérifier la sortie : 27 migrations appliquées, 0 erreur |
| 7 | Vérifier le schéma : requêtes de contrôle (70 tables, RLS actif sur tout, grants anon vides) | Studio / SQL | Preuves archivées |
| 8 | Exécuter les tests : `supabase test db` (pgTAP) — à faire **en local Docker d'abord** (V5) | CLI | 31/31 attendu + scénarios comportementaux écrits en Phase 0 |
| 9 | Générer les types : `supabase gen types typescript --linked > src/types/database.ts` | CLI | Rebuild typecheck + tests après |
| 10 | Déployer les Edge Functions : `supabase functions deploy issue-proposal issue-finance-document invite-user document-upload-init document-upload-confirm document-download-url document-delete document-restore r2-reconcile` | CLI | Les 9 fonctions répondent 200/401 via curl |
| 11 | Créer le premier administrateur : utilisateur Auth invité par le tableau de bord, puis **SQL de bootstrap contrôlé** (ci-dessous) | SQL | Exécuté par la personne désignée (D7), journalisé |
| 12 | Configurer Cloudflare R2 (bucket + clés restreintes + secrets Edge) et Cloudflare Pages (build `npm run build`, variables `VITE_*`) | Tableaux de bord CF | Test upload/téléchargement réel (V7) |

**SQL de bootstrap du premier admin** (à exécuter une seule fois, après invitation de l'utilisateur Auth) :

```sql
update public.profiles
set full_name = '<Nom complet>', is_active = true, role = 'admin'
where id = (select id from auth.users where email = '<email admin>');
insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
values (null, 'bootstrap_admin', 'profiles',
  (select id from public.profiles where id = (select id from auth.users where email = '<email admin>')),
  '{"source":"bootstrap"}'::jsonb);
```

(Toute attribution ultérieure de rôle passe par `set_profile_role`, admin uniquement, audité.)

## 4. Corrections préalables recommandées sur les migrations (avant premier push)

Modifications **en place** dans les fichiers existants, justifiées par le fait qu'aucun projet distant n'a jamais appliqué ces fichiers :

| # | Fichier | Modification | État |
| --- | --- | --- | --- |
| 1 | `20261012215952_finance_accounts_ledger_documents.sql:102` | Défaut `receipt_prefix` : `CTX-REC` → `EBI-REC` (décision D3) — localisation corrigée : c'est la migration 9, pas la 10 | **Appliqué** |
| 2 | `20261012220048_finance_secure_workflows.sql:291` | Chaîne `'CTX-PAY-'` → `'EBI-PAY-'` (décision D3) + fallbacks frontend (`src/payments/api.ts:32`, `src/payments/PaymentSettings.tsx:19`) | **Appliqué** |
| 3 | Décision D2 | `ebi_signup_ready` renvoie `false` (M25) ; le trigger de profil en attente est conservé comme filet du flux d'invitation ; la désactivation `enable_signup` reste une action du tableau de bord du nouveau projet | **Appliqué (côté code)** |
| 4 | `supabase/config.toml` | Les réglages Auth locaux ne sont **pas** repris tels quels sur le cloud (valeurs par défaut du tableau de bord) — le fichier reste le profil de développement local | À appliquer à la mise en service |

Variante acceptée pour 1-2 : une migration additive supplémentaire (`update finance_settings set receipt_prefix=…`) si la direction préfère ne pas toucher l'historique. Recommandation : modification en place (historique de départ propre pour EBI-IMT).

## 5. Migrations 16-33 — extensions EBI-IMT (PROMPT 2/3/4 + appels d'offres + sécurité)

Fichiers appliqués au projet neuf `xxilfzpkdwggfilwyrjw` le 2026-11-13 (27/27 puis 28/28 corrective, 29/29 Phase 3, 30/30 appels d'offres étendu, 31/31 lignes-produits, 32/32 durcissement sécurité, 33/33 journalisation auth, 34/34 correctif statut et 35-37/37 compatibilité des six rôles + correctifs de test, sur autorisation du commanditaire) après quatre corrections en place : M16 (drop/recréation de `profiles_insert` dépendante de la bascule du type de colonne), M25 (`coalesce` est un mot-clé — suppression des `pg_catalog.coalesce` invalides et qualification des built-ins dans les corps `search_path = ''`), M26 (trigger `crm_audit_companies` déjà créé par le socle — redondance retirée), puis migration 28 additive (corps `pg_catalog.nullif` invalides remplacés — voir ligne 28 du § 5). Chaque en-tête SQL détaille objectif/tables/dépendances/risques/retour arrière ; synthèse opérationnelle :

| # | Fichier | Objectif | Tables / objets | Dépendances | Risques principaux | Retour arrière |
| --- | --- | --- | --- | --- | --- | --- |
| 16 | `20261112100016_roles_and_permissions.sql` | Modèle granulaire 6 rôles + matrice | `roles`, `role_permissions`, bascule `profiles.role` text+FK, 5 fonctions redéfinies, helpers `current_role_code`/`permits` | Migrations 1-15 | Bascule de type de colonne ; matrice = défaut V2.1 | db reset (base vide) ; sinon recréer enum — jamais avant validation |
| 17 | `20261112102017_official_numbering.sql` | Numérotation officielle centralisée | `official_sequences`, RPC `next_official_number`, grant `permits()` | M16 + séquence `commercial_order_number_seq` | Concurrency (verrou FOR UPDATE ok) ; `cmd` reste sur la séquence socle | Drop fonction puis table |
| 18 | `20261112103018_company_roles.sql` | Rôles des sociétés (cumulables) | `company_roles` | M17 (`permits`) | Codes français figés par CHECK | Drop table |
| 19 | `20261112104019_document_lifecycle.sql` | Cycle de vie bibliothèque | `documents` +5 colonnes, `document_uploads`, `document_access_logs`, `document_links`, `document_reconciliation` | M17 ; `entity_table` cite des tables des M20-24 (check textuel, sans FK) | Corbeille logique uniquement ; R2 réconciliation = tâche de fond | Drop 4 tables + rollback colonnes |
| 20 | `20261112105020_tenders.sql` | Suivi des DAO | `tenders`, `tender_items`, `tender_quotes`, `tender_events` | M17 (DAO-), M18 | Cohérence devis↔ligne portée par RPC | Drop 4 tables |
| 21 | `20261112106021_projects.sql` | Projets d'exécution | `projects`, `orders.project_id` UNIQUE | M20 (`tenders`) | Séparation nette avec `production_projects` (socle) documentée | Drop column puis table |
| 22 | `20261112107022_purchases.sql` | Achats et décaissements fournisseurs | `purchase_orders`/`_lines`, `supplier_invoices`, `supplier_payments` (append-only), `supplier_payment_events` | M21 (`projects`), M17 (ACH-) | `total_xof` maintenu par RPC ; immutabilité décaissements | Drop en ordre inverse — jamais après mise en service |
| 23 | `20261112108023_deliveries.sql` | Livraisons et réceptions | `deliveries`, `delivery_lines` | M22 (`purchase_order_lines`) | CHECK d'exclusivité client/fournisseur | Drop 2 tables |
| 24 | `20261112109024_invoicing.sql` | Facturation client | `invoices`/`_lines`/`_events`, `payments.invoice_id` | M23, M17 (FAC-) | CHECK HT/TVA/TTC en base ; apurement par RPC | Drop column puis 3 tables |
| 25 | `20261113101025_admin_guardrails_mfa.sql` | Garde-fous admin, MFA aal2, D2 | Aucune table nouvelle ; `has_aal2`/`admin_caller_gate`/`admin_set_profile_active`/`admin_bootstrap_profile`, trigger dernier admin, politiques+audit `role_permissions`, RPC redéfinies avec aal2, `ebi_signup_ready`→false, grants `private` | M16-M24 | Sessions sans aal2 refusées sur opérations sensibles (voulu) ; trigger dernier admin actif aussi en contexte postgres | db reset (base vide) ; sinon recréer les fonctions redéfinies (corps dans M10/M16) |
| 26 | `20261114100026_companies_contacts_phase1.sql` | Référentiel sociétés unifié (PROMPT 4, Phase 1) | `companies` +4 colonnes (trade_name, registration_number, tax_number, is_active) + 2 index + audit ; `contacts.is_active` ; `company_activities` ; enum `document_type` +`library_document` ; politiques companies/contacts élargies (permits clients/fournisseurs/partenaires) ; RPC `company_create`, `company_activity_add` | M1-25 (companies, contacts, company_roles, permits, audit) | Élargissement contrôlé de la visibilité du référentiel ; `ALTER TYPE … ADD VALUE` utilisable dès la transaction suivante | db reset (base vide) ; sinon drop table + colonnes additives, recréer les politiques (corps conservés) |
| 27 | `20261114103027_document_library_rpc.sql` | Bibliothèque documentaire : RPC utilisateur et zone R2 | 3 CHECK élargis additivement (`r2-library`, `companies`/`contacts`, `upload`) ; `documents_select` +`permits('bibliotheque','select')` ; RPC `document_download_allowed`, `user_permits`, `document_request_delete`, `document_request_restore` | M17-M19, M26 | Vérification SHA-256 serveur plafonnée par `R2_VERIFY_MAX_BYTES` (au-delà : taille + hash déclaré, documenté) ; suppression/restauration réservées au module bibliothèque | db reset (base vide) ; sinon drop des 4 RPC, recréer `documents_select` et les 3 CHECK (corps dans M19 et socle commercial) |
| 28 | `20261114110028_runtime_keyword_fixes.sql` | Correction runtime des corps déjà appliqués (migrations 25-27) | `create or replace` de 6 fonctions dont le corps appliqué portait `pg_catalog.nullif(...)` invalide : `admin_bootstrap_profile`, `finance_confirm_payment`, `finance_execute_adjustment` (M25), `company_create`, `company_activity_add` (M26), `document_request_delete` (M27) ; sources 25-27 corrigées au même endroit | M25-M27 | `nullif`/`coalesce` sont des mots-clés du parser (jamais qualifiables `pg_catalog.`) ; `count` est un vrai agrégat catalogué | Aucun objet destructif : recréer les corps antérieurs (conservés dans 25-27) |
| 29 | `20261114111529_extension_workflows_phase3.sql` | Workflows d'écriture des extensions (Phase 3, PROMPT UI) | 9 RPC : `tender_create/update/set_status/item_add/item_remove/quote_set`, `project_create/set_status`, `production_update` ; transitions encadrées (won ⇒ validate + montant > 0, lost ⇒ motif), numérotation `next_official_number('dao'/'pro')`, événements `tender_events`, horodatages production | M16 (permits), M17 (numérotation), M20-M23, M26 | Aucune table nouvelle ; `direction` valide les engagements (matrice) ; lignes/devis DAO modifiables uniquement en `preparing` | Drop des 9 fonctions (aucun objet destructif) |
| 30 | `20261114121630_tenders_expansion.sql` | Module appels d'offres étendu (cahier des charges complet) | `tenders` : +`description/publication_date/estimated_amount_xof/our_amount_xof/responsible_id`, rename `preparation_notes`→`observations`, remap statuts → CHECK 10 états (`identifie|a_analyser|en_preparation|attente_documents|pret_deposer|depose|en_evaluation|gagne|perdu|annule`) ; 4 tables nouvelles `tender_documents/tender_tasks/tender_reminders/tender_comments` (RLS full CRUD authenticated) ; `orders.tender_id` + `commercial_proposals.tender_id` ; 9 RPC M29 redéfinies (10 états : gagne ⇒ `validate` + montant > 0, perdu ⇒ motif ; écritures lignes/devis limitées aux 5 états pré-dépôt) + 2 nouvelles `order_set_tender`/`proposal_set_tender` | M16 (permits), M17 (numérotation), M19 (`document_links`), M20, M26 (sociétés) | Remap des statuts en ouverture (base alors vierge de DAO) ; transitions encadrées ; pré-dépôt = 5 états | Drop des 4 tables + colonnes additives ; recréer les RPC (corps conservés dans le fichier) |
| 31 | `20261114122031_tender_items_products.sql` | Lignes de DAO reliées au catalogue produits | `tender_items.offer_template_id` FK `offer_templates` (additive, `on delete set null`) + index ; `tender_item_add` recréée de 6 à 7 arguments (`p_offer_template_id default null`, vérifie produit actif) — l'ancienne signature 6-arg est supprimée (une seule version) | M20 (tender_items), M7 (offer_templates), M16 (permits) | Uniquement additif ; la désignation libre reste possible (produit = suggestion) | `drop column` + recréer `tender_item_add` à 6 arguments (corps conservé dans M30 § 7.d) |
| 32 | `20261114123032_security_hardening_audit.sql` | Durcissement issu de la revue de cybersécurité (`docs/security-audit.md`) | `audit_logs` : porte FOR ALL supprimée, SELECT admin uniquement, revoke INSERT/UPDATE/DELETE/REFERENCES/TRIGGER ; **revoke TRUNCATE global** (toutes tables publiques, `authenticated`+`anon`) ; porte storage recréée **AS RESTRICTIVE** (profil actif exigé partout) ; revoke EXECUTE à `anon` sur 16 fonctions | M1-M4 (audit_logs, triggers), M15 (porte storage), M17-M25 | Journal non modifiable/tronquable ; preuves de paiement/terrain re-sous politiques ciblées | Recréer les politiques/grants (cités dans le fichier) — déconseillé : c'est la faille |
| 33 | `20261114124033_auth_event_logging.sql` | Journalisation des connexions/déconnexions | RPC `log_auth_event('login'/'logout')` SECURITY DEFINER : insère `auth_login`/`auth_logout` dans `audit_logs` (actor = session, ressource = profil) ; appelée par `src/lib/auth.tsx` (SIGNED_IN, avant signOut) | M32 (audit_logs verrouillé, écriture par SECURITY DEFINER) | Revoke anon (un utilisateur authentifié seulement) ; liste blanche d'actions ; échecs d'auth = journaux GoTrue du tableau de bord (décision documentée) | Drop function |
| 34 | `20261114124334_tenders_status_default.sql` | **Correctif bloquant** (découvert en mise en production) | Défaut de `tenders.status` resté à `'preparing'` (M17, valeur anglaise) après le passage aux 10 statuts français (M30) → toute création d'appel d'offres échouait ; défaut corrigé en `'identifie'` (début du cycle), E2E complet repassé | M17 (table), M30 (liste de statuts) | Aucune donnée touchée (défaut seul) | Défaut `'preparing'` (déconseillé : valeur hors contrainte) |
| 35 | `20261114130035_role_compat_v2.sql` | **Compatibilité des six rôles v2 avec le socle v1** | Enum `app_role` étendu (+direction/achats/finance/lecture_seule) ; `can_read_all()` (lecture transversale direction, sans écriture) ; 19 politiques SELECT passées de `can_manage_all()` à `can_read_all()` ; paiements ouverts à `permits('paiements','select')`, ordres à `permits('achats','select')` ; ~30 fonctions v1 : direction ajoutée aux contrôles superviseur, finance acceptée pour la vérification, cibles élargies (commercial/finance) ; `confirm_payment` délégué à `finance_can_verify()` | M17-M25 (socle), M25 (matrice six rôles) | Rôles v1 conservés (sales_manager/sales_rep) ; écritures inchangées (matrice = source de vérité) | Recréer politiques/fonctions depuis M17-M25 (déconseillé) |
| 36 | `20261114130136_app_role_commercial.sql` | Correctif enum : valeur `commercial` manquante | M35 avait étendu l'enum sans le rôle `commercial` (profils commerciaux v2) | M35 | Aucun | — |
| 37 | `20261114131037_matrix_commercial_payments.sql` | **Correctifs matrice + audit** | `crm_audit_row()` n'exige plus de colonne `id` (role_permissions, clé composite, était intouchable) ; matrice : `p_update` sur `paiements` retiré à commercial et finance (les paiements ne se modifient que via RPC finance_*) | M25 (matrice+triggers), M35/36 | Audit plus complet (entity_id null pour tables sans id, contenu old/new conservé) | Rétablir l'ancienne fonction/matrice (déconseillé) |
| 38 | `20261116120000_app_settings.sql` | **PROMPT 5 : paramètres généraux + catégories documentaires** | Table `app_settings` (singleton : infos officielles, logo, préférences d'affichage, devise XOF verrouillée, conservation, finance, modules visibles) + `library_categories` ; RLS : lecture transversale (`can_read_all`), écriture admin ; audit complet (trigger) | — (nouveau) | Singleton seeded | Drop tables |
| 39 | `20261116120500_settings_audit_fix.sql` | **Correctif journal des paramètres** | Le trigger générique castait entity_id en uuid (app_settings.id = smallint → exception 22P02) ; fonction dédiée `crm_audit_settings_row()` sans entity_id | M38 | — | Rétablir trigger générique (déconseillé) |
| 40 | `20261116121000_settings_audit_definer.sql` | Correctif SECURITY DEFINER | `crm_audit_settings_row()` s'exécutait en invoker → INSERT refusé sur audit_logs (privilège) ; SECURITY DEFINER appliqué | M39 | — | — |
| 41 | `20261116140000_tenders_v2.sql` | **PROMPT 6 : module complet appels d'offres (v2)** | 4 statuts ajoutés (`en_analyse|decision_soumission|en_validation|abandonne` → 14 états), `tenders.announcement_url` (https) + `submission_location` ; `tender_items.item_category` (equipement/prestation) + `specs` + `selected_supplier_company_id`/`selected_reason` ; `tender_quotes.brand_model/transport_cost_xof/lead_time_days/warranty_months/availability/quote_document_id`→documents ; `tender_item_add` 9 args, `tender_quote_set` 11 args, nouvelle RPC `tender_item_select_supplier` (justification obligatoire + devis existant), `tender_set_status` 14 états (gagne → validate + montant > 0, perdu → motif, abandonne terminal) | M30-M31 (tenders v1), M26 (companies) | Statuts étendus en ouverture (base vierge de DAO v2) ; aucune donnée perdue | Recréer RPC depuis M30-M31 (corps conservés), drop colonnes additives |
| 42 | `20261116141000_tenders_announce_fields.sql` | PROMPT 6 : annonce + lieu de dépôt dans create/update | `tender_create` (14 args) et `tender_update` (15 args) réécrites avec `p_announcement_url`/`p_submission_location` optionnels (CHECK https) ; `tender_update` refuse aussi `abandonne` | M41 | Rétrocompatible (defaults null) | Recréer signatures M30 |
| 43 | `20261116142000_tender_quote_fix.sql` | **Correctif bloquant** : `tender_quote_set` n'insérait pas `tender_id` (NOT NULL → 23502) | tender_id dérivé de la ligne, validations complètes (transport/délai/garantie ≥ 0, disponibilité, devis joint, fournisseur) | M41 | - | Recréer fonction M41 |
| 44 | `20261116143000_tenders_rpc_cleanup.sql` | Nettoyage des surcharges RPC périmées (générations M29-M31) | Drop des 7 anciennes signatures (dont `tender_quote_set` 5-args ambigüe et buggée) ; grants `authenticated` + revoke `anon/public` sur les 7 signatures actuelles | M29-M31, M41-M43 | - | Recréer les surcharges (déconseillé) |

Invariant respecté par toutes : RLS activé + politique SELECT `permits()` + porte restrictive `active_profile_gate` recréée + `anon` révoqué + grants SELECT à `authenticated` + écritures directes révoquées (hors UPDATE/INSERT admin sur `role_permissions`, encadrés admin+MFA, M25). Numérotation et transitions : `docs/database-relations.md` § 10 et § 12 ; modèle de sécurité : `docs/security-model.md`.

## 6. Rollback et incidents

- Base neuve : l'« annulation » d'un push raté = `db reset` local pour reproduire, correction du fichier fautif, re-push. Aucune donnée à perdre avant la mise en service.
- Après mise en service : uniquement migrations additives ; toute erreur de migration → `pg_dump` de la veille (stratégie § 8 de l'architecture v2) + correction additive, jamais d'édition destructive.
- Incident de sécurité : rotation immédiate du secret `service_role` (tableau de bord → Settings → API) et révocation des sessions (`auth.sessions`).

## 7. Checklist express de migration distante

```powershell
# 1. Prérequis locaux validés
node node_modules\typescript\bin\tsc -b --pretty false    # EXIT 0
node node_modules\vitest\vitest.mjs run                   # 46/46
node node_modules\vite\bin\vite.js build                  # OK

# 2. Local Docker d'abord (si Docker disponible)
supabase start; supabase db reset; supabase test db       # 31/31 pgTAP
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase\tests\pgm3_security.sql
#                                                          94/94 attendu (PROMPT 3)
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase\tests\pgm4_phase1.sql
#                                                          39/39 attendu (PROMPT 4)

# 3. Projet distant NEUF uniquement
supabase link --project-ref <ref-neuf>                    # vérifier le ref !
supabase migration list --linked                          # 0 migration attendue
supabase db push --dry-run; supabase db push              # 37/37 attendu
supabase gen types typescript --linked > src\types\database.ts

# 4. Edge
supabase functions deploy issue-proposal issue-finance-document invite-user document-upload-init document-upload-confirm document-download-url document-delete document-restore r2-reconcile
```

Jamais : `db push` sans `migration list --linked` préalable ; jamais vers l'ancien ref ; jamais de mot de passe/secret sur la ligne de commande en clair dans un historique partagé.
