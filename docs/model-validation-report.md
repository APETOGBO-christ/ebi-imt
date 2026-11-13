# Rapport de validation — PROMPT 2 (base de données)

Relecture complète des 9 migrations d'extension (M16-M24) et des documents
associés, exécutée sur demande (« valider et me donner le compte rendu »),
**sans application** : aucun `db push`, aucune migration distante, aucune
modification du socle Cortexia.

## 1. Méthode

1. Inventaire exhaustif : fichiers de migration, `create table`, séquences,
   politiques RLS, triggers, privilèges.
2. Relecture technique ligne à ligne de M16-M24 (contraintes, FK, CHECK,
   RLS, port restrictive, audit, transitions).
3. Revue de sécurité (privilèges effectifs, défauts Supabase, chemins
   d'exécution RLS et triggers).
4. Cohérence documentaire (comptes, tableaux, formulations).

## 2. Ce qui est validé (conforme)

- **Comptes exacts** : 24 fichiers de migration (15 socle + 9 extensions),
  **65 tables** `create table public.*` (42 socle + 23 extensions M16-M24),
  16 enums du socle inchangés, extensions en `text + check`.
- **Numérotation officielle (M17)** : `official_sequences` (6 codes :
  `dao`,`pro`,`fac`,`liv`,`rec`…) + `next_official_number(text)` ;
  `CMD-AAAA-NNNNNN` conserve la séquence socle
  `commercial_order_number_seq` — cohérent avec le format existant
  (`'CMD-' || to_char(now(),'YYYY') || '-' || lpad(nextval(...), 6, '0')`,
  migration socle du 12/10, lignes 158 et 395-396).
- **Rôles et matrice (M16)** : 6 rôles actifs + 2 codes dépréciés, 23
  modules × 5 actions, FK `profiles.role`, fonctions socle redéfinies à
  l'identique avec casts. Voir `docs/roles-permissions-matrix.md`.
- **Documents (M18)** : cycle de vie complet — suppression logique
  (`deleted_at/by/reason`, CHECK de cohérence, index partiels), versions
  (`supersedes_id`, `family_key`), rapprochement, RLS `bibliotheque` +
  propriétaire des envois.
- **Appels d'offres (M19)** : CHECK « gagné ⇒ montant+date », « perdu ⇒
  motif » ; lignes montant = `round(qté × PU)` ; lecture par module
  `appels_offres`.
- **Projets (M20/21)** : `orders.project_id` UNIQUE ; CHECK « achevé ⇒
  date de fin » ; séparation assumée avec `production_projects` (socle).
- **Achats (M22)** : `supplier_payments` append-only (trigger
  `prevent_financial_mutation`), référence unique partielle (non annulées),
  ttc = ht + tva, événements ; RLS `achats` (factures) / `facturation`
  (paiements).
- **Livraisons (M23)** : CHECK d'exclusivité client/fournisseur ; lignes
  reliées aux lignes d'achat ; RLS `livraisons` + `commandes` pour les
  livraisons clients.
- **Facturation (M24)** : ttc = ht + tva, tva = `round(ht × taux/10000)`,
  « émise ⇒ date d'émission » ; `payments.invoice_id` additive sur table
  append-only inchangée.
- **RLS systématique** : enable RLS + revoke `anon` + SELECT conditionnel
  via `permits()` + porte restrictive `active_profile_gate` + audit
  `crm_audit_row` + `set_updated_at` sur chaque table (vérifié table par
  table).

## 3. Ce qui a été corrigé lors de la relecture

| # | Constat | Correction |
|---|---|---|
| 1 | Les privilèges par défaut de Supabase accordent ALL aux rôles de service sur chaque nouvelle table : la RLS seule ne suffit pas comme barrière d'écriture. | Révokes de défense en profondeur ajoutés dans M16-M24 (`revoke insert[,update[,delete]] … from authenticated`), table par table. |
| 2 | `next_official_number(text)` était accordé à `authenticated` : tout utilisateur pouvait épuiser les compteurs officiels. | Grant retiré (M17) ; seules les RPC SECURITY DEFINER l'appellent. |
| 3 | Préfixes `CTX-` résiduels (décision D3 validée) : défaut `CTX-REC` — **en réalité migration 9** (`20261012215952_finance_accounts_ledger_documents.sql:102`, et non la migration 10 comme annoncé en séance), `CTX-PAY-` migration 10 (`20261012220048_finance_secure_workflows.sql:291`), fallbacks frontend `src/payments/api.ts:32` et `src/payments/PaymentSettings.tsx:19`. | `EBI-REC` / `EBI-PAY-` appliqués aux 4 emplacements. |
| 4 | Schéma `private` : aucun USAGE accordé à `authenticated`, alors que les politiques RLS et les RPC appellent ses fonctions → toute requête utilisateur aurait échoué. | `grant usage on schema private to authenticated` (M25). |
| 5 | Le `revoke … from public` de M15 privait `supabase_auth_admin` d'EXECUTE sur le trigger `auth.users` → chaque invitation aurait échoué côté GoTrue. | USAGE + EXECUTE accordés à `supabase_auth_admin` (M25). |
| 6 | Typo `lecture_seole` dans les livrables PROMPT 3 (tests, Edge) vs code réel `lecture_seule` (M16). | Corrigé dans `supabase/tests/pgm3_security.sql` et `supabase/functions/invite-user/index.ts`. |
| 7 | Faute de l'administrateur actif possible : personne ne pouvait rétrograder/désactiver/supprimer le dernier admin, mais aucune protection ne l'**empêchait** non plus (le système restait pilotable depuis une seule session admin sans filet). | Protection du dernier administrateur actif ajoutée (M25, triggers + RPC). |

## 4. Décisions actées

- **D2 — inscriptions publiques désactivées.** `ebi_signup_ready` renvoie
  désormais `false` (M25) ; le frontend abandonne proprement le formulaire
  (`src/App.tsx:95-96`, refus prévu, aucun code à changer) ; le trigger de
  profil en attente reste le filet du flux d'invitation ; l'accès se fait
  exclusivement sur invitation admin (Edge `invite-user`).
- **D3 — préfixes EBI-IMT** : appliqués (voir § 3.3).
- **MFA aal2** obligatoire pour `admin`/`direction` sur les opérations
  sensibles (M25) — voir `docs/security-model.md`.

## 5. Décisions restantes

1. **Confirmation V2.1 de la matrice** (`docs/roles-permissions-matrix.md`)
   par la direction avant le premier démarrage — modifiable ensuite à chaud
   par l'admin, mais le défaut de référence engage les premiers comptes.
2. Libellés définitifs des modules (codes actuels : `commerciaux`,
   `depenses_terrain`, `appels_offres`…) — lisibles dans la matrice.
3. `INVITE_REDIRECT_URL` à fixer au déploiement.

## 6. Reste à faire

1. **Exécuter les tests** : `supabase/tests/pgm3_security.sql` (94
   assertions, 6 scénarios imposés) nécessite Docker Desktop — bloqué sur
   les ressources de la machine, les tests sont écrits mais non exécutés.
2. Vérification TypeScript/build des livrables Edge (faite sur le dépôt,
  voir `docs/migration-plan.md` § vérifications).
3. Phases suivantes (3-8 du plan) après validation de cette base.

## 7. Note documentaire

L'écart « 8 migrations / 23 tables » signalé dans le compte rendu de séance
était une erreur du **compte rendu lui-même** : aucun document du dépôt ne
contient ce chiffre (grep vérifié) ; les documents disaient déjà
« 9 migrations d'extension (16-24), 23 nouvelles tables ». Le présent
rapport fixe la vérité : **25 migrations au total** avec M25 (aucune
nouvelle table, total 65 inchangé).
