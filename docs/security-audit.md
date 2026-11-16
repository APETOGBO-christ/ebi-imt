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
