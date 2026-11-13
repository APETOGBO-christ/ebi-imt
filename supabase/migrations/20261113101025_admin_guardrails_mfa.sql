-- =============================================================================
-- Migration 25 — Garde-fous d'administration, MFA et inscription (PROMPT 3)
-- =============================================================================
-- Objectif :
--   Compléter le modèle de sécurité EBI-IMT :
--   1. Helper d'exigence MFA (aal2) et porte d'appel admin pour l'Edge function.
--   2. Protection du dernier administrateur actif (triggers sur profiles +
--      contrôles dans les RPC d'administration).
--   3. RPC d'administration des profils : activation/désactivation
--      (tous rôles), assignation de rôle à l'invitation (contexte
--      service_role ou admin+MFA), contrôle d'appel admin.
--   4. Matrice role_permissions : INSERT encadré (admin+MFA), UPDATE exigé
--      avec MFA, audit de chaque changement de permission.
--   5. MFA aal2 exigé pour les opérations financières sensibles
--      (confirmation d'encaissement, exécution d'ajustement) et pour
--      set_profile_role.
--   6. Décision D2 : ebi_signup_ready renvoie désormais FALSE (inscriptions
--      publiques désactivées ; l'invitation par administrateur est le seul
--      chemin d'accès ; le trigger de profil en attente reste le filet du
--      flux d'invitation).
-- Tables concernées :
--   public.profiles (triggers), public.role_permissions (politiques + audit),
--   fonctions : has_aal2, admin_caller_ok/gate, admin_set_profile_active,
--   admin_bootstrap_profile, set_profile_role, finance_confirm_payment,
--   finance_approve_adjustment, finance_execute_adjustment, ebi_signup_ready.
--   Aucune nouvelle table (le total reste 65).
-- Dépendances :
--   Migrations 1-24 (matrice M16, porte restrictive M15, RPC finance M10).
-- Risques :
--   - Les vérifications MFA lisent le claim `aal` du JWT : une session
--     classique (aal1) échoue sur les opérations sensibles — c'est voulu ;
--     admin et direction doivent enrôler le TOTP (voir docs/security-model.md).
--   - Le trigger « dernier administrateur » s'applique aussi au contexte
--     postgres : sa levée délibérée exige une manipulation SQL explicite.
--   - ebi_signup_ready : le formulaire d'inscription du frontend affichera le
--     refus propre déjà prévu (src/App.tsx).
-- Retour arrière :
--   Sur base vide : db reset. Sur base utilisée : supprimer triggers/RPC
--   ajoutés et recréer les versions précédentes des fonctions redéfinies
--   (corps conservés dans les migrations 10 et 16).
-- =============================================================================

-- 1. Helpers ---------------------------------------------------------------------
-- aal2 : le claim `aal` du JWT vaut 'aal2' (second facteur actif).
create or replace function private.has_aal2()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (case
      when pg_catalog.btrim(coalesce(pg_catalog.current_setting('request.jwt.claims', true), ''::text)) = ''::text
        then null
      else coalesce(pg_catalog.current_setting('request.jwt.claims', true), ''::text)::jsonb
    end) ->> 'aal'
  , ''::text) = 'aal2'::text
$$;
revoke all on function private.has_aal2() from public, anon;
grant execute on function private.has_aal2() to authenticated;

-- Usage du schéma private : les fonctions appelées par les politiques RLS
-- (current_app_role, can_manage_all, crm_active, permits, has_aal2…) vivent
-- dans private ; sans USAGE sur le schéma, toute requête utilisateur échoue.
-- Les fonctions explicitement retirées (crm_actor, finance_can_verify,
-- confirm_payment, field_can_manage, commercial_lead_access,
-- admin_caller_ok…) restent inaccessibles : le USAGE n'expose que les
-- fonctions dont l'EXECUTE est accordé nommément.
grant usage on schema private to authenticated;

-- Flux d'invitation : le trigger sur auth.users s'exécute avec les
-- privilèges de supabase_auth_admin ; il a perdu l'EXECUTE avec le
-- « revoke … from public » de la migration 15. Sans ces deux lignes,
-- chaque invitation échouerait côté GoTrue.
grant usage on schema private to supabase_auth_admin;
grant execute on function private.create_pending_profile_for_auth_user() to supabase_auth_admin;

-- Appelant = administrateur actif avec second facteur (contexte utilisateur).
create or replace function private.admin_caller_ok()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
begin
  if v_uid is null then return false; end if;
  select role into v_role from public.profiles where id = v_uid and is_active;
  return v_role = 'admin' and private.has_aal2();
end $$;
revoke all on function private.admin_caller_ok() from public, anon, authenticated;

-- Porte consultable par l'Edge function (contrôle admin + MFA côté serveur).
create or replace function public.admin_caller_gate()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and private.admin_caller_ok()
$$;
revoke all on function public.admin_caller_gate() from public, anon;
grant execute on function public.admin_caller_gate() to authenticated, service_role;

-- 2. Protection du dernier administrateur actif (triggers sur profiles) -----------
create or replace function public.admin_guard_profile_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_other_active integer;
begin
  if tg_op = 'DELETE' then
    if old.role = 'admin' and old.is_active then
      select count(*) into v_other_active from public.profiles
        where role = 'admin' and is_active and id <> old.id;
      if v_other_active = 0 then
        raise exception 'protection du dernier administrateur actif';
      end if;
    end if;
    return old;
  end if;
  if old.role = 'admin' and old.is_active
    and (new.role <> 'admin' or new.is_active = false) then
    select count(*) into v_other_active from public.profiles
      where role = 'admin' and is_active and id <> old.id;
    if v_other_active = 0 then
      raise exception 'protection du dernier administrateur actif';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_last_admin_guard before update or delete on public.profiles
for each row execute function public.admin_guard_profile_mutation();

-- 3. RPC d'administration des profils ---------------------------------------------
-- Activation / désactivation de tout profil (tous rôles).
-- Contexte : service_role (Edge, auth.uid() null) ou admin+MFA.
create or replace function public.admin_set_profile_active(p_user_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_active boolean;
begin
  if v_uid is not null and not private.admin_caller_ok() then
    raise exception 'administrateur avec second facteur requis';
  end if;
  if p_active is null then raise exception 'activation requise'; end if;
  if v_uid = p_user_id and p_active = false then
    raise exception 'un administrateur ne peut pas se désactiver lui-même';
  end if;
  select role, is_active into v_role, v_active from public.profiles where id = p_user_id;
  if v_role is null then raise exception 'profil introuvable'; end if;
  if p_active = false and v_role = 'admin' and v_active and not exists (
    select 1 from public.profiles where role = 'admin' and is_active and id <> p_user_id
  ) then raise exception 'protection du dernier administrateur actif'; end if;
  if v_active = p_active then return; end if;
  update public.profiles set is_active = p_active where id = p_user_id;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values(v_uid, case when p_active then 'profile_activated' else 'profile_deactivated' end,
    'profiles', p_user_id,
    pg_catalog.jsonb_build_object('previous_is_active', v_active, 'via_service', v_uid is null));
end $$;
revoke all on function public.admin_set_profile_active(uuid, boolean) from public, anon;
grant execute on function public.admin_set_profile_active(uuid, boolean) to authenticated, service_role;

-- Assignation du rôle à l'invitation (Edge, contexte service) ou par un admin+MFA.
create or replace function public.admin_bootstrap_profile(p_user_id uuid, p_role text, p_full_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
begin
  if v_uid is not null and not private.admin_caller_ok() then
    raise exception 'administrateur avec second facteur requis';
  end if;
  if p_role is null or not exists (
    select 1 from public.roles r where r.code = p_role and not r.is_deprecated
  ) then raise exception 'rôle inconnu ou déprécié'; end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'utilisateur Auth inconnu'; end if;
  v_name := nullif(pg_catalog.btrim(coalesce(p_full_name, '')), '');
  if v_name is not null then
    update public.profiles set role = p_role, full_name = v_name where id = p_user_id;
  else
    update public.profiles set role = p_role where id = p_user_id;
  end if;
  if not found then raise exception 'profil introuvable (trigger d''invitation manquant ?)'; end if;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values(v_uid, 'profile_role_assigned', 'profiles', p_user_id,
    pg_catalog.jsonb_build_object('role', p_role, 'via_service', v_uid is null));
end $$;
revoke all on function public.admin_bootstrap_profile(uuid, text, text) from public, anon;
grant execute on function public.admin_bootstrap_profile(uuid, text, text) to authenticated, service_role;

-- 4. Matrice role_permissions : MFA, INSERT encadré, audit -------------------------
drop policy role_permissions_update on public.role_permissions;
create policy role_permissions_update on public.role_permissions for update to authenticated
using ((select private.current_role_code()) = 'admin' and (select private.has_aal2()))
with check ((select private.current_role_code()) = 'admin' and (select private.has_aal2()));
grant insert on public.role_permissions to authenticated;
create policy role_permissions_insert on public.role_permissions for insert to authenticated
with check ((select private.current_role_code()) = 'admin' and (select private.has_aal2()));
create trigger crm_audit_role_permissions after insert or update on public.role_permissions
for each row execute function public.crm_audit_row();

-- 5. MFA aal2 sur les opérations sensibles ------------------------------------------
create or replace function public.set_profile_role(p_user_id uuid, p_role public.app_role)
returns public.profiles
language plpgsql
security definer
set search_path = public, private
as $$
declare v_profile public.profiles;
begin
  if private.current_app_role() <> 'admin'::public.app_role then
    raise exception 'only an admin may change application roles';
  end if;
  if not private.has_aal2() then
    raise exception 'second facteur (MFA) requis';
  end if;
  if p_role::text <> 'admin' and not exists (
    select 1 from public.profiles where role = 'admin' and is_active and id <> p_user_id
  ) and exists (
    select 1 from public.profiles where id = p_user_id and role = 'admin' and is_active
  ) then raise exception 'protection du dernier administrateur actif'; end if;
  update public.profiles set role = p_role::text where id = p_user_id returning * into v_profile;
  if v_profile.id is null then raise exception 'profile not found'; end if;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values (auth.uid(), 'role_change', 'profiles', p_user_id, jsonb_build_object('new_role', p_role));
  return v_profile;
end $$;

create or replace function public.finance_confirm_payment(
  p_payment_id uuid, p_source text, p_verified_reference text,
  p_note text default null, p_cash_handed_over_at timestamptz default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_payment public.payments%rowtype;
  v_order public.orders%rowtype; v_account public.payment_accounts%rowtype;
  v_total bigint; v_job uuid; v_number text; v_prefix text; v_settings public.commercial_settings%rowtype;
begin
  if not private.finance_can_verify() then raise exception 'financial verifier required'; end if;
  if not private.has_aal2() then raise exception 'second facteur (MFA) requis'; end if;
  -- All confirmations and adjustments lock the order first, then the payment.
  select order_id into v_payment.order_id from public.payments where id = p_payment_id;
  if v_payment.order_id is null then raise exception 'payment not found'; end if;
  select * into v_order from public.orders where id = v_payment.order_id for update;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment.status <> 'pending' or v_order.order_status = 'cancelled' then
    raise exception 'pending payment on active order required'; end if;
  select * into v_account from public.payment_accounts where id = v_payment.payment_account_id;
  if v_account.id is null or v_account.method <> v_payment.method then raise exception 'official account missing'; end if;
  if nullif(pg_catalog.btrim(p_verified_reference), '') is null then raise exception 'official reference required'; end if;
  if p_source is null or (v_payment.method = 'merchant_account' and p_source <> 'merchant_portal') or
     (v_payment.method = 'bank_transfer' and p_source <> 'bank_statement') or
     (v_payment.method = 'cash' and p_source <> 'cash_register') then
    raise exception 'verification source does not match payment method'; end if;
  if v_payment.method = 'cash' and (v_payment.cash_received_by is null or
      p_cash_handed_over_at is null or p_cash_handed_over_at > pg_catalog.now()) then
    raise exception 'cash handover and register check required'; end if;
  if exists (select 1 from public.payments p where p.id <> p_payment_id and
    p.status = 'confirmed' and p.method = v_payment.method and
    p.payment_account_id = v_payment.payment_account_id and
    pg_catalog.lower(pg_catalog.btrim(p.verification_reference)) = pg_catalog.lower(pg_catalog.btrim(p_verified_reference)))
    then raise exception 'official reference already confirmed'; end if;
  select coalesce(pg_catalog.sum(amount_xof), 0)::bigint into v_total from public.financial_ledger
    where order_id = v_order.id;
  if v_total + v_payment.amount_xof > v_order.amount_xof then
    raise exception 'confirmed amount would exceed contract'; end if;
  update public.payments set status = 'confirmed', review_state = 'resolved',
    verified_by = v_actor, verified_at = pg_catalog.now(), verification_source = p_source,
    verification_reference = pg_catalog.btrim(p_verified_reference),
    verification_note = nullif(pg_catalog.btrim(p_note), ''),
    cash_handed_over_at = p_cash_handed_over_at where id = p_payment_id
  returning * into v_payment;
  insert into public.financial_ledger(order_id, payment_id, entry_kind, amount_xof, recorded_by)
  values(v_order.id, p_payment_id, 'collection', v_payment.amount_xof, v_actor);
  select * into v_settings from public.commercial_settings where id = true;
  select receipt_prefix into v_prefix from public.finance_settings where id = true;
  v_number := v_prefix || '-' || pg_catalog.to_char(pg_catalog.now(), 'YYYY') || '-' ||
    pg_catalog.lpad(pg_catalog.nextval('public.finance_receipt_number_seq'::regclass)::text, 6, '0');
  insert into public.finance_document_jobs(kind, payment_id, order_id, document_number, snapshot, created_by)
  values('receipt', p_payment_id, v_order.id, v_number,
    pg_catalog.jsonb_build_object('payment', pg_catalog.to_jsonb(v_payment),
      'order', pg_catalog.to_jsonb(v_order), 'company', pg_catalog.to_jsonb(v_settings),
      'account', pg_catalog.jsonb_build_object('method', v_account.method,
        'provider_name', v_account.provider_name, 'holder_name', v_account.holder_name),
      'collected_after_xof', v_total + v_payment.amount_xof,
      'balance_after_xof', v_order.amount_xof - v_total - v_payment.amount_xof),
    v_actor) returning id into v_job;
  insert into public.payment_events(payment_id, actor_id, event_type, details)
  values(p_payment_id, v_actor, 'confirmed', pg_catalog.jsonb_build_object(
    'source', p_source, 'reference', p_verified_reference, 'receipt_job_id', v_job));
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values(v_actor, 'payment_confirmed', 'payments', p_payment_id,
    pg_catalog.jsonb_build_object('amount_xof', v_payment.amount_xof, 'order_id', v_order.id));
  return v_job;
end $$;

create or replace function public.finance_approve_adjustment(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_adjustment public.financial_adjustments%rowtype;
begin
  if private.current_app_role() <> 'admin' then raise exception 'administrator required'; end if;
  if not private.has_aal2() then raise exception 'second facteur (MFA) requis'; end if;
  select * into v_adjustment from public.financial_adjustments where id = p_id for update;
  if v_adjustment.id is null or v_adjustment.status <> 'requested' then raise exception 'requested adjustment required'; end if;
  update public.financial_adjustments set status = case when p_approve then 'approved' else 'rejected' end,
    approved_by = v_actor, approved_at = pg_catalog.now() where id = p_id;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values(v_actor, 'adjustment_reviewed', 'financial_adjustments', p_id,
    pg_catalog.jsonb_build_object('approved', p_approve));
end $$;

create or replace function public.finance_execute_adjustment(
  p_id uuid, p_source text, p_external_reference text
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_adjustment public.financial_adjustments%rowtype;
  v_order public.orders%rowtype; v_payment public.payments%rowtype; v_prior bigint; v_total bigint;
begin
  if private.current_app_role() <> 'admin' then raise exception 'administrator required'; end if;
  if not private.has_aal2() then raise exception 'second facteur (MFA) requis'; end if;
  select order_id into v_adjustment.order_id from public.financial_adjustments where id = p_id;
  if v_adjustment.order_id is null then raise exception 'adjustment unavailable'; end if;
  select * into v_order from public.orders where id = v_adjustment.order_id for update;
  select * into v_adjustment from public.financial_adjustments where id = p_id for update;
  if v_adjustment.status <> 'approved' or nullif(pg_catalog.btrim(p_source), '') is null or
    nullif(pg_catalog.btrim(p_external_reference), '') is null then
    raise exception 'approved adjustment with external verification required'; end if;
  select * into v_payment from public.payments where id = v_adjustment.payment_id for update;
  select coalesce(pg_catalog.sum(amount_xof), 0)::bigint into v_prior from public.financial_ledger
    where adjustment_id in (select id from public.financial_adjustments where payment_id = v_payment.id);
  if v_payment.status <> 'confirmed' or v_payment.amount_xof + v_prior < v_adjustment.amount_xof then
    raise exception 'adjustment exceeds net payment'; end if;
  select coalesce(pg_catalog.sum(amount_xof), 0)::bigint into v_total from public.financial_ledger
    where order_id = v_order.id;
  if v_total < v_adjustment.amount_xof then raise exception 'adjustment exceeds collected balance'; end if;
  update public.financial_adjustments set status = 'executed',
    verification_source = pg_catalog.btrim(p_source),
    external_reference = pg_catalog.btrim(p_external_reference),
    executed_by = v_actor, executed_at = pg_catalog.now() where id = p_id;
  insert into public.financial_ledger(order_id, adjustment_id, entry_kind, amount_xof, recorded_by)
  values(v_order.id, p_id, v_adjustment.kind, -v_adjustment.amount_xof, v_actor);
  insert into public.payment_events(payment_id, actor_id, event_type, details)
  values(v_payment.id, v_actor, v_adjustment.kind || '_executed',
    pg_catalog.jsonb_build_object('adjustment_id', p_id, 'amount_xof', v_adjustment.amount_xof));
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values(v_actor, 'adjustment_executed', 'financial_adjustments', p_id,
    pg_catalog.jsonb_build_object('source', p_source, 'reference', p_external_reference));
end $$;

-- 6. Décision D2 — inscriptions publiques désactivées -------------------------------
-- Le pré-check d'inscription renvoie désormais FALSE : le formulaire du
-- frontend affiche un refus propre ; l'invitation par administrateur (Edge
-- invite-user) est le seul chemin d'accès. Le trigger de profil en attente
-- (migration 15) reste actif pour le flux d'invitation.
create or replace function public.ebi_signup_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false
$$;
