# Relations du modèle de données — EBI-IMT Business Manager

Cartographie complète des relations, transitions d'état, règles de suppression/conservation et numérotation officielle, établie pour l'ensemble **migrations 1-24** (42 tables socle + 23 extensions EBI-IMT = **65 tables**). À valider avec le schéma (`docs/database-schema.md`) et le plan d'application (`docs/migration-plan.md`).

Convention : `A (1)──< B (N)` = relation un-à-plusieurs via FK `B.a_id` ; `A (0..1)──(0..1) B` = lien optionnel unique.

## 1. Identité et CRM (socle)

```
auth.users (1)──(1) profiles            [profiles.id = auth.users.id, ON DELETE CASCADE]
companies (1)──< contacts               [contacts.company_id, CASCADE]
companies (1)──< leads                  [leads.company_id, NO ACTION]
companies (1)──< company_roles          [M18, CASCADE — rôle(s) client/fournisseur/partenaire/agence]
leads (1)──< activities                 [CASCADE]
leads (1)──< appointments               [NO ACTION]
leads (1)──< follow_ups                 [NO ACTION]
leads (1)──< lead_assignments           [journal d'attribution]
import_rows (0..1)──(0..1) leads        [leads.source_import_row_id, UNIQUE]
```

- Références humaines (`created_by`, `assigned_to`, `actor_id`, `sales_rep_id`…) : FK simples vers `profiles`, **NO ACTION** — un profil ne se supprime jamais (désactivation `is_active=false`).
- `company_roles` (M18) rend explicite le cumul de rôles d'une société (ex. client ET fournisseur).

## 2. Offres, propositions, commandes (socle commercial)

```
offer_templates (1)──< commercial_proposals    [FK composite (offer_template_id, offer_version)]
commercial_proposals (1)──< commercial_proposal_events
commercial_proposals (0..1)──(0..1) orders     [orders.proposal_id UNIQUE — 1 proposition = 1 commande max]
orders (1)──< order_installments               [UK (order_id, installment_number) : 1-2 échéances]
orders (1)──< commercial_order_events
orders (0..1)──(0..1) production_projects      [production_projects.order_id UNIQUE]
```

## 3. Chaîne DAO → projets → achats (extensions EBI-IMT)

```
companies (1)──< tenders                       [organism_company_id — l'organisme qui publie le DAO]
tenders (1)──< tender_items                    [CASCADE, UK (tender_id, position)]
tender_items (1)──< tender_quotes              [UK (tender_item_id, supplier_company_id)]
tenders (1)──< tender_quotes                   [CASCADE — 2e chemin, même deletion]
tenders (1)──< tender_events                   [CASCADE]
tenders (0..1)──< projects                     [projects.tender_id — un DAO gagné devient un projet]
projects (0..1)──(0..1) orders                 [orders.project_id UNIQUE — une commande client = 1 projet max]
companies (1)──< projects                      [client_company_id]
```

## 4. Achats et décaissements fournisseurs (M22)

```
companies (1)──< purchase_orders               [supplier_company_id]
orders (0..1)──< purchase_orders               [order_id — réappro d'une commande client]
projects (0..1)──< purchase_orders             [project_id — appro d'un chantier]
purchase_orders (1)──< purchase_order_lines    [CASCADE, UK (purchase_order_id, position)]
purchase_orders (1)──< supplier_invoices
supplier_invoices (1)──< supplier_payments     [APPEND-ONLY : trigger prevent_financial_mutation]
supplier_payments (1)──< supplier_payment_events
purchase_order_lines (0..1)──< delivery_lines  [purchase_line_id — suivi de réception par ligne]
```

- `supplier_payments` : immuable au niveau API (UPDATE/DELETE bloqués par trigger, identique à `payments`). Corrections futures = contre-écritures, jamais modification.

## 5. Livraisons et réceptions (M23)

```
orders (1)──< deliveries                       [kind='client_delivery' — CHECK d'exclusivité]
purchase_orders (1)──< deliveries              [kind='supplier_reception' — CHECK d'exclusivité]
deliveries (1)──< delivery_lines               [CASCADE, UK (delivery_id, position)]
```

- CHECK structurel : une livraison est **soit** client (order_id non nul, purchase_order_id nul) **soit** fournisseur (l'inverse). Jamais les deux, jamais aucune.

## 6. Facturation client et encaissements (M24 + socle finance)

```
orders (1)──< invoices                         [order_id NOT NULL]
companies (1)──< invoices                      [company_id — RPC : doit égaler orders.company_id]
invoices (1)──< invoice_lines                  [CASCADE, UK (invoice_id, position)]
invoices (1)──< invoice_events                 [CASCADE]
invoices (0..1)──< payments                    [payments.invoice_id — apurement facture par facture]
orders (1)──< payments                         [socle]
payments (0..1)──(1) financial_ledger          [UK partielle — 1 écriture 'collection' par paiement]
payments (1)──< financial_adjustments          [correction|refund, 3 étapes]
financial_adjustments (0..1)──(1) financial_ledger [UK partielle, signe négatif]
```

## 7. Bibliothèque documentaire (socle documents + M19)

```
payments (0..1)──< documents                   [reçus]
orders (0..1)──< documents                     [confirmations]
offer_templates (0..1)──< documents
commercial_proposals (0..1)──< documents       [UK partielle (proposal_id, document_version)]
documents (0..1)──(0..1) documents             [supersedes_id — chaînage des versions]
documents (1)──< document_links                [CASCADE — lien polymorphe (entity_table, entity_id)]
documents (1)──< document_access_logs          [journal append-only des accès]
documents (0..1)──< document_uploads           [staging : uploaded → document_id puis status='attached']
document_reconciliation                        [sans FK : réconciliation stock R2 ↔ base par chemin]
```

- `family_key` (M19) groupe les versions d'une même famille documentaire ; `deleted_at/by/reason` = corbeille logique (CHECK : suppression ⇒ auteur + motif).

## 8. Finance terrain et commissions (socle, inchangé)

```
field_policy_versions (1)──< field_budgets
field_budgets (1)──(0..1) field_advances       [field_advances.budget_id UNIQUE]
field_advances (1)──< field_expenses / field_restitutions
field_finance_events                           [journal polymorphe immuable]
sales_commission_policies (1)──< sales_commission_positions   [positions.order_id UNIQUE]
sales_commission_positions (1)──< sales_commission_payouts
```

Chaîne de recalcul : toute écriture dans `financial_ledger` recalcule `sales_commission_positions` par trigger.

## 9. Chaîne critique de bout en bout

```
companies → leads → commercial_proposals → orders → {payments → financial_ledger → sales_commission_positions}
                                                  → invoices ← payments
                              orders → deliveries(client)
                              orders → purchase_orders → supplier_invoices → supplier_payments
                                                     → deliveries(fournisseur)
tenders → (gagné) → projects → purchase_orders / orders.project_id
```

Toute évolution de schéma doit préserver ces liens et l'append-only des journaux financiers.

## 10. Statuts et transitions autorisées

| Table | États | Transitions autorisées (via RPC, Phase 3) |
| --- | --- | --- |
| tenders | preparing → submitted → won \| lost \| cancelled | won ⇒ awarded_amount_xof + awarded_at (CHECK) ; lost ⇒ lost_reason (CHECK) |
| projects | planned → in_progress ⇄ suspended → completed \| cancelled | completed ⇒ actual_end_date (CHECK) |
| purchase_orders | draft → submitted → confirmed → partially_received → received ; cancelled | cancelled depuis draft/submitted/confirmed ; confirmed ⇒ confirmed_at (CHECK) |
| supplier_invoices | received → verified → approved → partially_paid → paid ; rejected \| disputed | rejet/dispute depuis received/verified |
| supplier_payments | pending → confirmed \| rejected | append-only : pas de retour arrière, correction = contre-écriture |
| deliveries | planned → in_transit → delivered \| partial ; cancelled | delivered ⇒ delivered_at (CHECK) |
| invoices | draft → issued → partially_paid → paid ; cancelled | issued ⇒ issued_at (CHECK) ; cancelled seulement avant paiement |
| payments (socle) | pending → confirmed \| rejected \| cancelled ; refunded \| corrected | confirmé ⇒ verified_by/at ; corrections via financial_adjustments |
| commercial_proposals (socle) | draft → pending_approval → approved → sent → accepted \| rejected \| expired \| cancelled | inchangé |
| documents | issued → superseded \| void ; deleted_at (corbeille) | nouvelle version = supersedes_id + family_key |

## 11. Règles de suppression et de conservation

1. **Aucune politique DELETE** dans toute la base (65 tables) : aucune suppression directe via l'API, aujourd'hui comme après les extensions.
2. **CASCADE limités à la construction** : lignes filles (items/lignes/événements) suivent leur parent ; or les parents métier (DAO, projets, commandes, factures…) n'ont pas d'UPDATE/DELETE accordés — une cascade ne peut donc se déclencher que par action administrative directe en SQL (réservée à `postgres`).
3. **Corbeille logique (documents)** : `deleted_at + deleted_by + deleted_reason` (CHECK `documents_deletion_complete`). Jamais de suppression physique d'un document référencé par `financial_ledger`/`finance_document_jobs`/`document_access_logs`.
4. **Annulation d'un document émis** : `document_status='void'` + événement, conservation intégrale (traçabilité comptable).
5. **Immutabilité financière** : `payments`, `supplier_payments`, `financial_ledger`, positions de commission (delete bloqué), tables terrain — append-only par triggers `prevent_financial_mutation` + privilèges révoqués. Correction/remboursement = `financial_adjustments` en 3 étapes (demande → approbation → exécution), jamais d'édition.
6. **Journaux conservés sans limite** : `audit_logs` (FORCE RLS), `*_events` (8 tables), `document_access_logs`, `field_finance_events`. Politique de rétention des données personnelles (anonymisation des profils inactifs) : décision Phase 4, voir audit M8.
7. **Imports** : `import_batches`/`import_rows` en cascade théorique, écritures RPC uniquement — conservation recommandée (source d'audit des doublons).
8. **Profiles** : désactivation (`is_active=false`, via RPC nommée), jamais de suppression — l'historique (`created_by`, `actor_id`…) doit rester résoluble.

## 12. Numérotation officielle

| Kind | Prefixe | Table/porteur | Mécanisme |
| --- | --- | --- | --- |
| `dao` | DAO- | `tenders.tender_number` (UK) | `next_official_number('dao')` — compteur annuel `official_sequences` |
| `pro` | PRO- | `projects.project_number` (UK) | `next_official_number('pro')` |
| `cmd` | CMD- | `orders.order_number` (UK) | séquence socle `commercial_order_number_seq` (branche `cmd` — format strictement identique au socle) |
| `ach` | ACH- | `purchase_orders.purchase_number` (UK) | `next_official_number('ach')` |
| `liv` | LIV- | `deliveries.delivery_number` (UK) | `next_official_number('liv')` |
| `fac` | FAC- | `invoices.invoice_number` (UK) | `next_official_number('fac')` |

- Format unique : `PREFIXE-AAAA-NNNNNN` (6 chiffres, remise à zéro au 1er janvier, verrou `FOR UPDATE` anti-concurrence).
- Hors périmètre `official_sequences` (socle) : `PROP-` (`proposal_number_seq`), reçus (`finance_settings.receipt_prefix` + `finance_receipt_number_seq`, défaut à corriger **CTX-REC → EBI-REC**, décision D3), instructions (`finance_instruction_number_seq`, préfixe en dur à corriger, D3).
- **Factures fournisseurs** : numérotation différée Phase 4 (D3) — identification par `id` + numéro fournisseur saisi si disponible.

## 13. Contraintes d'intégrité financière (en base, non négociables)

- Montants : `bigint` FCFA entiers ; `>= 0` (ou `> 0` pour paiements/décaissements).
- `invoices` : `ttc = ht + tva` **et** `tva = round(ht × vat_rate_bps / 10000)`.
- `supplier_invoices` : `ttc = ht + tva`.
- Lignes (`tender_items`, `purchase_order_lines`, `invoice_lines`) : `amount = round(quantity × unit_price)`.
- `financial_ledger` : cohérence kind/signe (collection > 0, correction/refund < 0) + une seule écriture par paiement et par ajustement (UK partielles).
- Transactions atomiques exigées dans les RPC sensibles (confirmation d'encaissement avec verrous d'ordre, exécution d'ajustement, apurement facture).
- Rattachements contrôlés par RPC (pas en CHECK cross-lignes) : `invoices.company_id = orders.company_id`, ligne de devis/réception ∈ son parent, apurement `payments.invoice_id` ∈ commande de la facture.
