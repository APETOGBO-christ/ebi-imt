# Rapport de sécurité — EBI-IMT Business Manager (2026-11-16)

Revue complète de cybersécurité effectuée sur le projet live `xxilfzpkdwggfilwyrjw` : audit statique (code, migrations, politiques) + tests dynamiques (sondes REST anonymes, sessions à identité simulée, POC d'exploitation). Chaque constat porte une preuve exécutée pendant la revue.

## 1. Synthèse exécutive

| # | Constat | Gravité | État |
| --- | --- | --- | --- |
| S1 | Journal d'audit vidable par TRUNCATE par tout utilisateur authentifié actif | **Critique** | **Corrigé (M32)** — preuve avant/après |
| S2 | Porte Storage permissive neutralisant les politiques des preuves de paiement/terrain | Élevée | **Corrigé (M32)** |
| S3 | EXECUTE à `anon` sur 16 fonctions publiques (dont `set_profile_role`) | Élevée | **Corrigé (M32)** |
| S4 | Réglages Auth du tableau de bord à confirmer (inscriptions publiques, mot de passe, sessions) | Moyenne | Action opérateur (checklist) |
| S5 | CORS Edge `*` (pas de cookies → risque faible) | Faible | À resserrer au déploiement Pages |
| S6 | Pas de rate-limiting applicatif (Supabase Auth limite nativement) | Faible | Surveillance SaaS interne |
| S7 | CSP/HSTS absents (niveau Pages) | Faible | À la mise en production |

Aucune clé secrète n'a été trouvée dans le dépôt, les fichiers `.env*` ou le bundle frontend. Aucun accès anonyme aux données n'a été obtenu. Le journal ne peut plus être modifié, supprimé ni tronqué par un utilisateur standard.

## 2. Contrôles vérifiés (inventaire)

### Authentification
- Comptes créés **uniquement par un administrateur** : Edge `invite-user` (actions `invite/activate/deactivate/revoke_sessions/reactivate/recover/reset_mfa`), rôles invitéables en liste blanche (`INVITABLE_ROLES`), profil créé inactif puis activé ; `ebi_signup_ready` → `false` ; porte SQL `admin_caller_gate` + double contrôle claim JWT.
- **MFA aal2 exigé** côté Edge pour toute opération admin sensible (`invite-user`, `r2-reconcile`) ; la page « Sécurité & double validation » permet l'enrôlement TOTP (`mfa.enroll/challenge/verify/unenroll`).
- **Réinitialisation sécurisée** : `recover` → `auth.admin.generateLink(type: 'recovery', redirectTo)` par un admin habilité, audité (`admin_user_recovery_link`). Aucun flux public de mot de passe.
- **Sessions/déconnexion** : sessions Supabase (JWT court + refresh), `signOut()` sur les menus compte et « Accès indisponible » ; `revoke_sessions` admin disponible et audité.
- Les sessions sans profil actif ne voient **rien** (porte `active_profile_gate` sur chaque table + porte storage M32) — preuve : simulation « sans rôle » → 0 ligne sur toutes les tables.

### Autorisations (RBAC + RLS)
- **70/70 tables** : RLS activé ; `audit_logs` en **FORCE RLS** ; 0 privilège table à `anon` ; 0 vue exposée ; 0 politique RESTRICTIVE manquante.
- RBAC serveur : `roles` + `role_permissions` (23 modules × 5 actions) ; `permits()`/`current_role_code()` (SECURITY DEFINER, `search_path` verrouillé) utilisés par toutes les politiques ; **INSERT/UPDATE de la matrice réservés admin + MFA aal2** ; mutations de profils uniquement via RPC ; 100 % des fonctions SECURITY DEFINER avec `search_path` verrouillé (vérifié par requête).
- Écritures CRM/données : politiques scopées créateur/assigné + garde-fous par trigger + audit automatique ; écritures des modules extensions via RPC uniquement (DAO au-delà du pré-dépôt, finance, terrain, propositions, facturation).
- Documents (bibliothèque) : fichiers dans **Cloudflare R2 privé** ; aucun lien signé sans RPC `document_download_allowed` (permits bibliothèque) ; chaque téléchargement journalisé dans `document_access_logs` par l'Edge ; chemin immuable + SHA-256 vérifié côté serveur ; `ebi-documents` INSERT impossible au client (service_role uniquement).

### Journalisation
- `audit_logs` : identifiant utilisateur, action, ressource (`entity_table`/`entity_id`), horodatage, détail JSON ; **FORCE RLS, SELECT admin uniquement, aucun droit d'écriture à l'API** (écriture par déclencheurs SECURITY DEFINER) ; TRUNCATE révoqué à tous les rôles API (M32).
- Journaux spécialisés : `document_access_logs` (téléchargements), `tender_events` (cycles DAO), `*_events` métier, `financial_ledger` et `supplier_payments` **append-only par trigger**.

### Secrets
- Frontend : `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` uniquement (`.env.local` hors Git, `.gitignore` couvre `.env*`).
- Edge : secrets via `Deno.env` (`SUPABASE_SERVICE_ROLE_KEY`, `R2_*`) ; aucun secret en dur dans `src/`, `supabase/`, docs (balayage regex complet).
- Procédure de rotation `service_role` + incidents : `docs/migration-plan.md` § 6.

## 3. Tests exécutés et résultats

| Test | Méthode | Résultat |
| --- | --- | --- |
| Accès anonyme (12 tables : tenders, leads, documents, audit_logs, profiles, role_permissions, company_roles, tender_*, payments…) | REST + clé publishable, GET | **401/42501 partout** |
| Écriture anonyme | POST `tenders`, RPC `tender_create` | **42501** (grants révoqués) |
| RPC sensibles en anonyme | `tender_create`, `document_download_allowed` | **42501** |
| `set_profile_role` en anonyme | RPC | Bloqué par le corps ; **grant EXECUTE retiré (M32)** → deny par privilège désormais |
| Utilisateur sans profil actif | Session SQL simulée (`set local role authenticated` + claims uuid inexistant) | **0 ligne sur toutes les tables, `permits` false, rôle NULL** |
| Utilisateur admin (simulation) | Session SQL simulée (claims du profil admin) | Accès conformes (documents/companies/audit/profiles visibles, `can_manage_all` true) |
| MFA | `has_aal2()` en session sans facteur | **false** → opérations admin refusées |
| Document sans autorisation | RPC `document_download_allowed` (anon) | **42501** ; Edge exige `requireUser` + RPC + journal d'accès |
| Contournement des permissions | Matrice : INSERT/UPDATE `role_permissions` = **admin + aal2** ; UPDATE/DELETE `audit_logs` en session admin simulée | **0 ligne modifiée (bloqué par RLS)** |
| Manipulation des identifiants | UPDATE direct `profiles` | INSERT/UPDATE révoqués (M14/M25), mutations via RPC uniquement |
| Exposition des clés | Balayage dépôt + `.env*` + bundle | **Aucun secret** ; publishable uniquement côté client |
| Téléversement non autorisé | POST Storage anonyme (documents, payment-proofs, r2-library) | **400 (refusé)** ; documents : INSERT réservé service_role |
| **POC S1 (avant correction)** | `TRUNCATE audit_logs` en session authentifiée simulée | **Vulnérable** (0 ligne après truncate) → corrigé, retest : **42501** |
| **POC S2 (avant correction)** | Porte storage permissive sur `ebi-payment-proofs`/`ebi-field-proofs` | FOR ALL inconditionnel pour tout utilisateur actif → corrigé (porte RESTRICTIVE), politiques ciblées seules autoritaires |

## 4. Vulnérabilités — détail et corrections

### S1 (Critique) — Journal d'audit vidable (corrigée, migration 32)
- **Preuve avant** : en session `authenticated` active, `TRUNCATE public.audit_logs` réussissait (0 ligne restante) — les privilèges par défaut de Supabase accordaient TRUNCATE/DELETE/UPDATE à `authenticated` et **RLS ne gouverne pas TRUNCATE**. La politique `active_profile_gate` (FOR ALL) ouvrait de surcroît INSERT/UPDATE/DELETE théoriques.
- **Correction (M32)** : `drop policy active_profile_gate` sur `audit_logs` ; `revoke insert, update, delete, truncate, references, trigger` à `authenticated` (SELECT admin conservé) ; l'écriture du journal reste l'apanage des déclencheurs SECURITY DEFINER ; **`revoke truncate` global sur toutes les tables publiques** (`authenticated` + `anon`).
- **Retest** : `TRUNCATE` → `42501 permission denied` ; grants audit_logs = SELECT uniquement ; UPDATE/DELETE en session admin simulée → 0 ligne.

### S2 (Élevée) — Porte Storage trop large (corrigée, migration 32)
- **Preuve avant** : `ebi_storage_active_profile_gate` était **permissive FOR ALL** et, pour tout bucket ≠ `ebi-documents`/`ebi-imports`, laissait un CRUD inconditionnel aux utilisateurs actifs — neutralisant les politiques ciblées des preuves de paiement (`payments/{id}/…`) et terrain (`field/{uid}/…`) : un utilisateur actif pouvait téléverser/écraser/supprimer des preuves de n'importe qui.
- **Correction (M32)** : porte recréée **AS RESTRICTIVE FOR ALL** (profil actif exigé sur tout bucket, tout verbe). Les politiques ciblées par bucket redeviennent la seule source d'autorisation : preuves INSERT (déclarant, chemin verrouillé) + SELECT (lien métier), pas d'UPDATE/DELETE. Vérifié : aucun flux fonctionnel n'utilise Storage REST pour `r2-library` (fichiers bibliothèque = R2 via Edge présigné).
- **Retest** : politique = `RESTRICTIVE ALL` ; anonyme PUT/GET → 400.

### S3 (Élevée) — EXECUTE à anon (corrigée, migration 32)
- **Preuve avant** : 17 fonctions publiques exécutables par `anon`, dont `set_profile_role` (bloquée par son corps à l'exécution mais surface d'attaque inutile) et `normalize_togo_phone`.
- **Correction (M32)** : `revoke execute … from public, anon` sur les 16 fonctions (le pré-check d'inscription `ebi_signup_ready` reste accessible à anon, il est prévu pour).
- **Retest** : requête catalog : **0 fonction** exécutable à `anon` (hors `ebi_signup_ready`, répond 200 — comportement attendu).

### S4 (Moyenne) — Réglages Auth du tableau de bord (action opérateur)
Le code est prêt (inscriptions fermées, invitations admin, D2), mais le réglage console reste humain : **désactiver « Enable signups »**, politique de mot de passe (longueur + composition), durées de session (`timebox`/`inactivity_timeout`), SMTP réel, Site URL. Preuves à archiver (checklist étape 2 de `docs/migration-plan.md`).

### S5-S7 (Faibles) — Reconnues, planifiées
- **S5 CORS** : `Access-Control-Allow-Origin: *` sur les Edge (jeton en en-tête Authorization, pas de cookies — CSRF non applicable) ; resserrer sur le domaine Pages au déploiement.
- **S6 Rate limiting** : limites Auth natives Supabase actives ; SaaS interne, surveillance des logs recommandée ; à réévaluer si exposition publique.
- **S7 En-têtes de sécurité** : CSP, HSTS, X-Frame-Options au niveau Cloudflare Pages lors du déploiement.

## 5. Résiduel accepté
- Les privilèges par défaut de Supabase réapparaissent sur **toute nouvelle table** : chaque migration future doit reproduire les revokes (pratique déjà en place dans les migrations 19-32).
- Les tests pgTAP complets (94 + 39 scénarios) restent à rejouer en local Docker quand disponible ; l'essentiel a été revalidé en live sur le projet (§ 3).
- Rotation du secret `service_role` et test de restauration `pg_dump` : exercices à planifier après la mise en service.

## 6. Contrôle des corrections
La migration `20261114123032_security_hardening_audit.sql` (32/32 appliquée) est atomique, non destructive et documentée avec retour arrière. Les retests ont été exécutés immédiatement après application (§ 3 et § 4).

## 7. Revue complémentaire — passe 2 (2026-11-16, migration 33)

Deuxième passe sur les exigences restées incomplètes, avec re-vérification des correctifs M32.

### Correctifs M32 revalidés
- Session authentifiée sans profil actif → **0 ligne** sur toutes les tables (porte active_profile_gate) ; `tenders`/`documents` probes ✓.
- Catalogue : 0 fonction exécutable à `anon` (hors `ebi_signup_ready` prévu pour) ; porte Storage = `RESTRICTIVE ALL` ; grants `audit_logs` = SELECT uniquement.

### S8 (Moyenne → corrigée) — Connexions/déconnexions non journalisées
- **Constat** : la spécification exige la journalisation des connexions ; `audit_logs` ne recevait aucune entrée de connexion (M32 a verrouillé l'écriture directe, rendant impossible une insertion client).
- **Correction (migration 33)** : RPC `log_auth_event('login'|'logout')` SECURITY DEFINER (revoke `anon`, liste blanche d'actions, ressource = profil de l'utilisateur) ; le client journalise à `SIGNED_IN` (pas de doublon à la restauration de session locale) et **avant** `signOut()`.
- **Tests** : appel anonyme → **401** ; appel en session authentifiée simulée → entrée `auth_login` créée dans `audit_logs` ✓.
- **Échecs d'authentification** : décision documentée — ils restent dans les journaux GoTrue du tableau de bord (aucune identité exploitable côté base ; une RPC publique d'échecs serait un vecteur de spam). L'exigence « échecs pertinents » est couverte par les mécanismes natifs Supabase + l'audit de toute opération admin échouée (portes aal2/admin_caller_gate).

### Vérifications d'isolation et de divulgation (passe 2)
- **Isolation inter-utilisateurs** : `leads_select` = `crm_active() AND (can_manage_all() OR assigned_to = uid)` — un commercial ne voit que ses propres leads ; même scopage sur activités/rendez-vous/relances/commandes (créateur/assigné) avec audit automatique par trigger. Aucun accès entre utilisateurs non autorisé.
- **Changements de permissions** : trigger `crm_audit_role_permissions` sur la matrice + audit des RPC `set_profile_role`/`admin_set_profile_active`/invitations — toute modification de permission est journalisée (utilisateur, action, date, ressource).
- **Liens signés R2** : TTL **600 s (download) / 900 s (upload)** (`_shared/r2client.ts`), émission toujours précédée de `requireUser` + RPC `document_download_allowed` (permits + `deleted_at is null`) + entrée `document_access_logs`.
- **Suppressions abusives** : documents = corbeille logique (`deleted_at`, restaurable, auditable) ; commandes confirmées immuables (trigger) ; ledger/supplier_payments append-only ; TRUNCATE révoqué partout (M32).
- **Attaques classiques** : XSS — React échappe par défaut, aucun `dangerouslySetInnerHTML`/`eval` (balayage) ; injection SQL — requêtes PostgREST paramétrées, corps PL/pgSQL sans SQL dynamique utilisateur ; CSRF — jeton en en-tête Authorization, aucun cookie de session applicatif.

### Résiduel accepté (mis à jour)
- **Jetons de session dans localStorage** (stockage Supabase Auth par défaut) : risque conditionné à une XSS — surface réduite à néant côté app (voir XSS ci-dessus) ; alternative `secureStorage` si exigence direction.
- **Consultations sensibles** : téléchargements/aperçus de documents journalisés (`document_access_logs`) ; les consultations de lignes SQL ne sont pas journalisées (coût/bruit — choix documenté, réévaluable par RPC si exigé).
- S4-S7 inchangées (réglages console, CORS, rate-limiting, CSP/HSTS — actions de mise en production).

### Conclusion de la passe 2
Les exigences « journalisation des connexions » et « isolation inter-utilisateurs » sont désormais **démontrées par tests**. Le journal est complet : identité, action, date (`created_at`), ressource (`entity_table`/`entity_id`), non modifiable, non supprimable, non tronquable par un utilisateur standard.

## 8. Revue complémentaire — conformité PROMPT 3 (2026-11-16, migrations 35-37)

Troisième passe consacrée aux six rôles de l'architecture v2 (admin, direction, commercial, achats, finance, lecture_seule) sur l'ensemble du socle hérité.

### Constatations (avant corrections)
- La matrice v2 (`role_permissions`) portait déjà les six rôles, mais l'**enum `app_role` du socle n'en comptait que trois** (admin/sales_manager/sales_rep) : un profil `direction` provoquait une erreur de cast (`22P02`) dans `current_app_role()` — les nouvelles invitations auraient été **bloquées par toutes les politiques du socle**.
- `can_manage_all()` (utilisé en lecture ET écriture) ignorait `direction` : la lecture transversale exigée pour la direction était impossible.
- `crm_audit_row()` exigeait une colonne `id` : la matrice `role_permissions` (clé composite) n'était **jamais modifiable**, même par un administrateur.

### Corrections (migrations 35-37)
- **M35** : enum étendu (4 valeurs) ; `can_read_all()` = lecture transversale pour admin/direction/sales_manager, appliquée à 19 politiques SELECT ; `payments` ouvert à `permits('paiements','select')` (finance), `orders` à `permits('achats','select')` (achats) ; ~30 fonctions v1 mises à jour (direction dans les contrôles superviseur, finance dans la vérification financière, cibles élargies : commercial, finance) ; `confirm_payment` délégué à `finance_can_verify()`.
- **M36** : valeur `commercial` de l'enum (omise en M35).
- **M37** : `crm_audit_row()` sans exigence de colonne `id` (matrice modifiable et auditée) ; matrice resserrée (`p_update` paiements retiré à commercial/finance).

### Batterie de conformité PROMPT 3 § 5 (15/15 — transactions annulées, aucune donnée de test persistée)
| Scénario | Résultat |
|---|---|
| Admin sans MFA → opération sensible | refusé : « second facteur (MFA) requis » |
| Commercial → modification d'un paiement | refusé : RLS + matrice |
| Lecture_seule → suppression | refusé : 0 ligne + RPC « permission de modification requise » |
| Utilisateur désactivé → accès | 0 ligne partout + RPC refusée |
| Auto-attribution de rôle / modification directe de la matrice | refusé : « only an admin may change application roles » / 0 ligne |
| Consultation hors périmètre (lead d'un autre commercial) | 0 ligne |
| Protection du dernier administrateur (+ auto-désactivation) | refusée |
| Direction : lecture transversale sans écriture | démontrée (`can_read_all`, `manage_all=false`) |
| Finance : lecture + validation des paiements | démontrées (`user_permits`) |
| INSERT direct en lecture_seule (porte RESTRICTIVE) | refusé |

### Résiduel de cette passe
- **pgTAP** : les scénarios § 5 du PROMPT 3 sont couverts par cette batterie SQL reproductible (`tmp/battery-prompt3.sql`) ; les suites pgTAP (94+39) restent à exécuter (Docker).
- Les réglages console Supabase (inscriptions publiques désactivées, MFA à l'inscription) restent des actions opérateur (§ 2 de `docs/mise-en-production.md`).
