-- =============================================================================
-- Migration 28 — Correction runtime des fonctions concernées (PROMPT 4, Phase 1)
-- =============================================================================
-- Objectif : remplacer les corps déjà appliqués (migrations 25-27) dont les
-- expressions `pg_catalog.nullif(...)` échouent à l'exécution. NULLIF (comme
-- COALESCE) est un mot-clé du parser PostgreSQL et non une fonction du
-- catalogue : une qualification de schéma provoque
-- « function pg_catalog.nullif(text, unknown) does not exist ».
-- Les sources des migrations 25-27 sont corrigées au même endroit ; cette
-- migration additive aligne la base déjà appliquée.
-- Objets redéfinis (CREATE OR REPLACE conserve les privilèges) :
--   admin_bootstrap_profile, finance_confirm_payment, finance_execute_adjustment,
--   company_create, company_activity_add, document_request_delete.
-- Dépendances : migrations 25-27 appliquées.
-- Retour arrière : recréer les corps antérieurs (corps conservés dans 25-27).
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


create or replace function public.company_create(
  p_legal_name text, p_trade_name text default null, p_role_codes text[] default null,
  p_industry text default null, p_address text default null, p_city text default null,
  p_phone text default null, p_email text default null, p_website text default null,
  p_registration_number text default null, p_tax_number text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_allowed boolean;
  v_company uuid;
  v_role text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  select (
    (select private.permits('clients','insert'))
    or (select private.permits('fournisseurs','insert'))
    or (select private.permits('partenaires','insert'))
  ) into v_allowed;
  if not coalesce(v_allowed, false) then
    raise exception 'permission de création requise (référentiel sociétés)';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_legal_name, '')), '') is null then
    raise exception 'raison sociale requise';
  end if;
  insert into public.companies (legal_name, trade_name, industry, address, city,
    phone, email, website, registration_number, tax_number, notes, created_by)
  values (
    pg_catalog.btrim(p_legal_name),
    nullif(pg_catalog.btrim(coalesce(p_trade_name, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_industry, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_address, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_city, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_phone, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_email, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_website, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_registration_number, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_tax_number, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_notes, '')), ''),
    v_uid
  ) returning id into v_company;
  if p_role_codes is not null then
    foreach v_role in array p_role_codes loop
      if v_role in ('client','fournisseur','partenaire','agence') then
        insert into public.company_roles (company_id, role_code, created_by)
        values (v_company, v_role, v_uid)
        on conflict (company_id, role_code) do nothing;
      end if;
    end loop;
  end if;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values (v_uid, 'company_created', 'companies', v_company,
    pg_catalog.jsonb_build_object('legal_name', pg_catalog.btrim(p_legal_name),
      'role_codes', coalesce(p_role_codes, '{}'::text[])));
  return v_company;
end $$;


create or replace function public.company_activity_add(
  p_company_id uuid, p_contact_id uuid default null, p_activity_type text default 'note',
  p_subject text default null, p_body text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_allowed boolean;
  v_activity uuid;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  select (
    (select private.permits('clients','insert'))
    or (select private.permits('fournisseurs','insert'))
    or (select private.permits('partenaires','insert'))
  ) into v_allowed;
  if not coalesce(v_allowed, false) then
    raise exception 'permission d''écriture requise (référentiel sociétés)';
  end if;
  if p_contact_id is not null and not exists (
    select 1 from public.contacts c where c.id = p_contact_id and c.company_id = p_company_id
  ) then raise exception 'contact étranger à cette société'; end if;
  if p_activity_type not in ('call','meeting','email','visit','note','other') then
    raise exception 'type d''échange inconnu';
  end if;
  insert into public.company_activities (company_id, contact_id, author_id,
    activity_type, subject, body)
  values (p_company_id, p_contact_id, v_uid, p_activity_type,
    nullif(pg_catalog.btrim(coalesce(p_subject, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_body, '')), ''))
  returning id into v_activity;
  return v_activity;
end $$;


create or replace function public.document_request_delete(p_document_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not coalesce((select private.permits('bibliotheque','delete')), false) then
    raise exception 'permission de suppression requise (bibliothèque)';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'motif de suppression requis';
  end if;
  update public.documents
    set deleted_at = pg_catalog.now(), deleted_by = v_uid,
      deleted_reason = pg_catalog.btrim(p_reason)
    where id = p_document_id and deleted_at is null;
  if not found then raise exception 'document introuvable ou déjà supprimé'; end if;
  insert into public.document_access_logs(document_id, actor_id, action, metadata)
    values (p_document_id, v_uid, 'delete',
      pg_catalog.jsonb_build_object('reason', pg_catalog.btrim(p_reason)));
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
    values (v_uid, 'document_deleted', 'documents', p_document_id,
      pg_catalog.jsonb_build_object('reason', pg_catalog.btrim(p_reason)));
end $$;
