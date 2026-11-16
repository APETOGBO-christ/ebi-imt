-- 32. Durcissement issu de la revue de cybersécurité (2026-11-16)
-- Objectif : corriger les 3 constats de la revue de sécurité complète —
--   (A) audit_logs : la porte « active_profile_gate » (FOR ALL) + les privilèges
--       par défaut laissaient théoriquement INSERT/UPDATE/DELETE à tout
--       utilisateur authentifié actif, et TRUNCATE (hors périmètre RLS) est
--       réellement exécutable → le journal pouvait être vidé ;
--   (B) TRUNCATE était accordé à « authenticated » sur toutes les tables publiques
--       (privilèges par défaut Supabase) — non gouverné par RLS ;
--   (C) Storage : la porte « ebi_storage_active_profile_gate » était permissive et
--       rendait (pour tout bucket autre que ebi-documents/ebi-imports) un FOR ALL
--       inconditionnel aux utilisateurs actifs, neutralisant les politiques
--       ciblées des preuves de paiement / terrain ; + EXECUTE à « anon » sur
--       16 fonctions publiques (dont set_profile_role).
-- Tables/objets touchés : audit_logs (politique + grants), toutes tables publiques
--   (grants TRUNCATE), storage.objects (politique), 16 fonctions (revoke anon).
-- Dépendances : M1-M4 (audit_logs, crm_audit_row SECURITY DEFINER, crm_active),
--   M15 (porte storage), M25 (helpers aal2).
-- Risques : aucun — le SELECT admin du journal (audit_select + grant SELECT) est
--   conservé ; l'audit continue d'être écrit par les déclencheurs SECURITY DEFINER
--   (contournent RLS, aucun INSERT policy requis) ; la porte storage est recréée
--   AS RESTRICTIVE (exigence de profil actif sur TOUT bucket, tous les verbes),
--   ce qui préserve l'intention M15 sans ouvrir de CRUD large ; les fichiers de
--   bibliothèque ne transitent jamais par Storage REST (Edge → R2 présigné).
-- Retour arrière : recréer la politique permissive et les grants (cités dans le
--   présent fichier) — déconseillé, c'est la faille.

-- (A) Journal d'audit : lecture admin uniquement, écriture par déclencheurs ------
drop policy if exists active_profile_gate on public.audit_logs;

revoke insert, update, delete, truncate, references, trigger
  on public.audit_logs from authenticated;
-- grant SELECT conservé (politique audit_select : can_manage_all uniquement).

-- (B) TRUNCATE : aucun rôle API ne doit jamais pouvoir vider une table métier ---
revoke truncate on all tables in schema public from authenticated;
revoke truncate on all tables in schema public from anon;

-- (C1) Storage : porte recréée en RESTRICTIVE (profil actif exigé partout) ------
drop policy if exists ebi_storage_active_profile_gate on storage.objects;

create policy ebi_storage_active_profile_gate on storage.objects
  as restrictive for all to authenticated
  using ((select private.crm_active()) or (select private.can_manage_all()))
  with check ((select private.crm_active()) or (select private.can_manage_all()));

comment on policy ebi_storage_active_profile_gate on storage.objects is
  'Porte restrictive (M32) : une session sans profil actif ne peut rien faire sur aucun bucket. Les politiques permissives par bucket (documents/imports/preuves) restent les seules autorisations réelles.';

-- (C2) EXECUTE à anon : retrait sur 16 fonctions (ebi_signup_ready conservé) ----
revoke execute on function
  public.set_updated_at(),
  public.prevent_profile_role_change(),
  public.prevent_financial_mutation(),
  public.crm_guard_lead_insert(),
  public.crm_guard_lead_update(),
  public.crm_guard_activity_insert(),
  public.crm_guard_profile_active(),
  public.commercial_guard_offer_terms(),
  public.finance_guard_ledger(),
  public.admin_guard_profile_mutation(),
  public.guard_payment_insert(),
  public.guard_order_update(),
  public.guard_receipt_insert(),
  public.set_normalized_phone(),
  public.normalize_togo_phone(text),
  public.set_profile_role(uuid, app_role)
  from public, anon;

notify pgrst_ddl_watch, 'reload schema';
