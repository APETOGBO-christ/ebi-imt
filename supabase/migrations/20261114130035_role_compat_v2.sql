-- 35. Compatibilite des six roles (architecture v2) avec le socle v1
-- Objectif : les roles "direction", "achats", "finance", "lecture_seule" (matrice v2,
--   table role_permissions) doivent fonctionner sur TOUTES les politiques et fonctions
--   heritees du socle (enum app_role limite a admin/sales_manager/sales_rep).
-- Corrections : extension de l'enum app_role (4 valeurs) ; lecture transversale
--   can_read_all() (direction, sans ecriture - la matrice v2 est la source de verite) ;
--   19 politiques SELECT passent de can_manage_all() a can_read_all() ; paiements :
--   finance via permits('paiements') ; fonctions v1 : direction ajoutee aux controles
--   superviseur, finance acceptee pour la verification financiere, profils cibles
--   elargis (commercial, finance) ; confirm_payment delegue a finance_can_verify().
-- Dependances : migrations 17-33 (socle, matrice, durcissement).
-- Risques : politiques recreees (DROP/CREATE) - contenu identique sauf lecture ; enum
--   etendu sans retrocompatibilite brisee (roles v1 conserves).
-- Retour arriere : recreer les fonctions/politiques depuis les migrations 17-33 et
--   retirer les valeurs enum (deconseille).
-- Application : projet xxilfzpkdwggfilwyrjw (supabase db push, 2026-11-16).

alter type public.app_role add value if not exists 'direction' after 'sales_rep';
alter type public.app_role add value if not exists 'achats' after 'direction';
alter type public.app_role add value if not exists 'finance' after 'achats';
alter type public.app_role add value if not exists 'lecture_seule' after 'finance';

create or replace function private.can_read_all()
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select private.current_role_code() in ('admin', 'direction', 'sales_manager')
$$;

CREATE OR REPLACE FUNCTION private.confirm_payment(p_payment_id uuid)
 RETURNS payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare v_payment public.payments;
begin
  if not private.finance_can_verify() then
    raise exception 'verification financiere non autorisee';
  end if;
  update public.payments set status = 'confirmed', verified_by = auth.uid(), verified_at = now()
  where id = p_payment_id and status = 'pending'
  returning * into v_payment;
  if v_payment.id is null then raise exception 'payment not found or not pending'; end if;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values (auth.uid(), 'confirm', 'payments', p_payment_id, jsonb_build_object('status', 'confirmed'));
  return v_payment;
end $function$
;

CREATE OR REPLACE FUNCTION private.crm_actor(p_manager_only boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := auth.uid(); v_role public.app_role;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select role::public.app_role into v_role from public.profiles where id = v_actor and is_active;
  if v_role is null then raise exception 'active profile required'; end if;
  if p_manager_only and v_role not in ('admin', 'sales_manager', 'direction') then
    raise exception 'manager permission required';
  end if;
  return v_actor;
end $function$
;

CREATE OR REPLACE FUNCTION private.finance_can_verify()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.current_role_code() = 'admin'
    or private.permits('paiements', 'validate')
    or (private.current_role_code() in ('sales_manager', 'direction') and exists (
      select 1 from public.finance_verifiers v where v.user_id = (select auth.uid()) and v.enabled
    ))
$function$
;

CREATE OR REPLACE FUNCTION private.field_can_manage()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.current_role_code() = 'admin'
    or (private.current_role_code() in ('sales_manager', 'direction') and exists (
      select 1 from public.field_budget_permissions p
      where p.user_id = (select auth.uid()) and p.enabled))
$function$
;

CREATE OR REPLACE FUNCTION public.field_submit_expense(p_budget uuid, p_category text, p_source text, p_amount bigint, p_incurred_at timestamp with time zone, p_description text, p_advance uuid DEFAULT NULL::uuid, p_period_start date DEFAULT NULL::date, p_period_end date DEFAULT NULL::date, p_zone text DEFAULT NULL::text, p_transport_mode text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_reference text DEFAULT NULL::text, p_lead uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(false); v_budget public.field_budgets%rowtype;
  v_advance public.field_advances%rowtype; v_policy public.field_policy_versions%rowtype; v_id uuid;
begin
  select * into v_budget from public.field_budgets where id=p_budget;
  if v_budget.id is null or v_budget.sales_rep_id<>v_actor or v_budget.status not in ('approved','active')
    then raise exception 'own authorized budget required'; end if;
  select * into v_policy from public.field_policy_versions where id=v_budget.policy_id;
  if p_category not in ('communication','transport','other') or
    p_category <> all(v_budget.allowed_categories) or p_amount is null or p_amount<=0 or
    p_incurred_at is null or p_incurred_at>now()+interval '1 day' or
    p_incurred_at::date not between v_budget.period_start and v_budget.period_end or
    nullif(btrim(p_description),'') is null then raise exception 'invalid expense'; end if;
  if p_source='advance' then
    select * into v_advance from public.field_advances where id=p_advance;
    if v_advance.id is null or v_advance.budget_id<>p_budget or v_advance.status<>'disbursed'
      then raise exception 'disbursed advance required'; end if;
  elsif p_source not in ('personal','company') or p_advance is not null then
    raise exception 'invalid funding source';
  end if;
  if p_category='communication' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text,61220603));
    if p_period_start is null or p_period_end is null or
      p_period_end<>p_period_start+v_policy.communication_interval_days-1 or
      p_incurred_at::date not between p_period_start and p_period_end or
      p_amount>v_policy.communication_amount_xof then
      raise exception 'communication period or amount exceeds policy'; end if;
    if exists(select 1 from public.field_expenses e where e.sales_rep_id=v_actor and
      e.category='communication' and e.status<>'rejected' and
      e.period_start<=p_period_end and e.period_end>=p_period_start) then
      raise exception 'communication period already covered'; end if;
  end if;
  if p_category='transport' and (nullif(btrim(p_zone),'') is null or
    nullif(btrim(p_transport_mode),'') is null) then raise exception 'transport zone and mode required'; end if;
  if p_lead is not null and not exists(select 1 from public.leads where id=p_lead and assigned_to=v_actor)
    then raise exception 'prospect unavailable'; end if;
  insert into public.field_expenses(sales_rep_id,budget_id,advance_id,category,funding_source,
    amount_xof,incurred_at,period_start,period_end,description,prospecting_zone,
    transport_mode,beneficiary_phone,payment_reference,lead_id,submitted_by)
  values(v_actor,p_budget,p_advance,p_category,p_source,p_amount,p_incurred_at,
    p_period_start,p_period_end,btrim(p_description),nullif(btrim(p_zone),''),
    nullif(btrim(p_transport_mode),''),nullif(btrim(p_phone),''),nullif(btrim(p_reference),''),p_lead,v_actor)
  returning id into v_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('expense',v_id,'submitted',v_actor,pg_catalog.jsonb_build_object('amount_xof',p_amount,'source',p_source));
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_save_lead(p_id uuid, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := private.crm_actor(false);
  v_role public.app_role := private.current_app_role();
  v_lead public.leads%rowtype;
  v_company uuid;
  v_contact uuid;
  v_name text := nullif(pg_catalog.btrim(p_data->>'company_name'), '');
  v_phone text := public.normalize_togo_phone(p_data->>'phone');
  v_assignee uuid;
begin
  if p_data is null or pg_catalog.jsonb_typeof(p_data) <> 'object' then raise exception 'invalid lead data'; end if;
  if p_id is null then
    if v_name is null then raise exception 'company name required'; end if;
    v_assignee := coalesce(nullif(p_data->>'assigned_to', '')::uuid, v_actor);
    if v_assignee <> v_actor and v_role not in ('admin', 'sales_manager', 'direction') then
      raise exception 'assignment permission required';
    end if;
    if not exists (select 1 from public.profiles where id = v_assignee and is_active and role = 'sales_rep')
      and v_assignee <> v_actor then raise exception 'active sales rep required'; end if;
    if v_phone is not null and nullif(p_data->>'company_id', '') is null and
      exists (select 1 from public.companies where normalized_phone = v_phone) then
      raise exception 'an enterprise with this phone already exists; review the match';
    end if;
    if nullif(p_data->>'company_id', '') is not null then
      v_company := (p_data->>'company_id')::uuid;
      if v_role not in ('admin', 'sales_manager', 'direction') or not exists (select 1 from public.companies where id = v_company) then
        raise exception 'existing company unavailable';
      end if;
    else
      insert into public.companies
        (legal_name, industry, city, neighborhood, address, email, phone, website, has_website, created_by)
      values (v_name, nullif(pg_catalog.btrim(p_data->>'industry'), ''),
        nullif(pg_catalog.btrim(p_data->>'city'), ''),
        nullif(pg_catalog.btrim(p_data->>'neighborhood'), ''),
        nullif(pg_catalog.btrim(p_data->>'address'), ''),
        nullif(pg_catalog.lower(pg_catalog.btrim(p_data->>'company_email')), ''),
        nullif(pg_catalog.btrim(p_data->>'phone'), ''),
        case when p_data->>'has_website' = 'false' then null else nullif(pg_catalog.btrim(p_data->>'website'), '') end,
        case when p_data ? 'has_website' then (p_data->>'has_website')::boolean
             when nullif(pg_catalog.btrim(p_data->>'website'), '') is not null then true else null end,
        v_actor)
      returning id into v_company;
    end if;
    insert into public.leads
      (company_id, assigned_to, created_by, source, identified_need, interested_offer,
       priority, notes, next_follow_up_at)
    values (v_company, v_assignee, v_actor,
      nullif(pg_catalog.btrim(p_data->>'source'), ''),
      nullif(pg_catalog.btrim(p_data->>'identified_need'), ''),
      nullif(pg_catalog.btrim(p_data->>'interested_offer'), ''),
      coalesce(nullif(p_data->>'priority', ''), 'normal'),
      nullif(pg_catalog.btrim(p_data->>'notes'), ''),
      nullif(p_data->>'next_follow_up_at', '')::timestamptz)
    returning * into v_lead;
  else
    select * into v_lead from public.leads where id = p_id for update;
    if v_lead.id is null then raise exception 'lead not found'; end if;
    if v_role not in ('admin', 'sales_manager', 'direction') and v_lead.assigned_to <> v_actor then
      raise exception 'lead is outside your scope';
    end if;
    v_company := v_lead.company_id;
    update public.companies set
      legal_name = coalesce(v_name, legal_name),
      industry = coalesce(nullif(pg_catalog.btrim(p_data->>'industry'), ''), industry),
      city = coalesce(nullif(pg_catalog.btrim(p_data->>'city'), ''), city),
      neighborhood = coalesce(nullif(pg_catalog.btrim(p_data->>'neighborhood'), ''), neighborhood),
      address = coalesce(nullif(pg_catalog.btrim(p_data->>'address'), ''), address),
      email = coalesce(nullif(pg_catalog.lower(pg_catalog.btrim(p_data->>'company_email')), ''), email),
      phone = coalesce(nullif(pg_catalog.btrim(p_data->>'phone'), ''), phone),
      website = case when p_data->>'has_website' = 'false' then null
                     else coalesce(nullif(pg_catalog.btrim(p_data->>'website'), ''), website) end,
      has_website = coalesce(case when p_data ? 'has_website' then (p_data->>'has_website')::boolean
                             when nullif(pg_catalog.btrim(p_data->>'website'), '') is not null then true else null end, has_website)
    where id = v_company;
    update public.leads set
      source = coalesce(nullif(pg_catalog.btrim(p_data->>'source'), ''), source),
      identified_need = coalesce(nullif(pg_catalog.btrim(p_data->>'identified_need'), ''), identified_need),
      interested_offer = coalesce(nullif(pg_catalog.btrim(p_data->>'interested_offer'), ''), interested_offer),
      priority = coalesce(nullif(p_data->>'priority', ''), priority),
      notes = coalesce(nullif(pg_catalog.btrim(p_data->>'notes'), ''), notes),
      next_follow_up_at = coalesce(nullif(p_data->>'next_follow_up_at', '')::timestamptz, next_follow_up_at)
    where id = p_id;
  end if;

  if nullif(pg_catalog.btrim(p_data->>'contact_name'), '') is not null then
    v_contact := nullif(p_data->>'contact_id', '')::uuid;
    if v_contact is not null then
      if not exists (select 1 from public.contacts where id = v_contact and company_id = v_company) then
        raise exception 'contact does not belong to this company';
      end if;
      update public.contacts set
        full_name = coalesce(nullif(pg_catalog.btrim(p_data->>'contact_name'), ''), full_name),
        job_title = coalesce(nullif(pg_catalog.btrim(p_data->>'contact_title'), ''), job_title),
        phone = coalesce(nullif(pg_catalog.btrim(p_data->>'contact_phone'), ''), phone),
        whatsapp = coalesce(nullif(pg_catalog.btrim(p_data->>'whatsapp'), ''), whatsapp),
        email = coalesce(nullif(pg_catalog.lower(pg_catalog.btrim(p_data->>'email')), ''), email)
      where id = v_contact;
    else
      select id into v_contact from public.contacts
      where company_id = v_company and pg_catalog.lower(full_name) = pg_catalog.lower(pg_catalog.btrim(p_data->>'contact_name'))
        and (nullif(p_data->>'email', '') is null or pg_catalog.lower(email) = pg_catalog.lower(p_data->>'email'))
      limit 1;
      if v_contact is null then
        insert into public.contacts
          (company_id, full_name, job_title, phone, whatsapp, email, is_primary)
        values (v_company, pg_catalog.btrim(p_data->>'contact_name'),
          nullif(pg_catalog.btrim(p_data->>'contact_title'), ''),
          nullif(pg_catalog.btrim(p_data->>'contact_phone'), ''),
          nullif(pg_catalog.btrim(p_data->>'whatsapp'), ''),
          nullif(pg_catalog.lower(pg_catalog.btrim(p_data->>'email')), ''),
          not exists (select 1 from public.contacts where company_id = v_company));
      end if;
    end if;
  end if;
  return v_lead.id;
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_set_sales_active(p_user_id uuid, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(true);
begin
  if private.current_app_role() <> 'admin' then raise exception 'admin permission required'; end if;
  if p_user_id = v_actor and not p_active then raise exception 'cannot deactivate yourself'; end if;
  update public.profiles set is_active = p_active where id = p_user_id and role in ('sales_rep', 'commercial');
  if not found then raise exception 'profil commercial introuvable'; end if;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values (v_actor, 'set_active', 'profiles', p_user_id,
    pg_catalog.jsonb_build_object('is_active', p_active));
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_assign_leads(p_lead_ids uuid[], p_assignee uuid, p_reason text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(true); v_lead public.leads%rowtype; v_count integer := 0;
begin
  if p_lead_ids is null or pg_catalog.array_length(p_lead_ids, 1) is null
    or pg_catalog.array_length(p_lead_ids, 1) > 100 then raise exception 'select 1 to 100 leads'; end if;
  if p_assignee is not null and not exists (
    select 1 from public.profiles where id = p_assignee and is_active and role = 'sales_rep'
  ) then raise exception 'active sales rep required'; end if;
  for v_lead in select * from public.leads where id = any(p_lead_ids) order by id for update loop
    if v_lead.assigned_to is distinct from p_assignee then
      update public.leads set assigned_to = p_assignee where id = v_lead.id;
      insert into public.lead_assignments (lead_id, old_assignee_id, new_assignee_id, actor_id, reason)
      values (v_lead.id, v_lead.assigned_to, p_assignee, v_actor, nullif(pg_catalog.btrim(p_reason), ''));
      v_count := v_count + 1;
    end if;
  end loop;
  if (select pg_catalog.count(distinct x) from pg_catalog.unnest(p_lead_ids) as x) <>
     (select pg_catalog.count(*) from public.leads where id = any(p_lead_ids)) then
    raise exception 'one or more leads were not found';
  end if;
  return v_count;
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_set_lead_status(p_lead_id uuid, p_status lead_status, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(false); v_role public.app_role := private.current_app_role();
  v_lead public.leads%rowtype;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if v_lead.id is null then raise exception 'lead not found'; end if;
  if v_role not in ('admin', 'sales_manager', 'direction') and v_lead.assigned_to <> v_actor then
    raise exception 'lead is outside your scope';
  end if;
  if v_lead.status = p_status then return; end if;
  if p_status = 'archived' or (v_lead.status in ('won','lost','unqualified','archived') and v_role not in ('admin','sales_manager','direction')) then
    raise exception 'this transition requires management review';
  end if;
  if not (
    (v_lead.status in ('new','qualified') and p_status in ('contacted','meeting','unqualified','lost')) or
    (v_lead.status = 'contacted' and p_status in ('meeting','demo','proposal','unqualified','lost')) or
    (v_lead.status = 'meeting' and p_status in ('contacted','demo','proposal','lost')) or
    (v_lead.status = 'demo' and p_status in ('proposal','negotiation','lost')) or
    (v_lead.status = 'proposal' and p_status in ('negotiation','won','lost')) or
    (v_lead.status = 'negotiation' and p_status in ('proposal','won','lost')) or
    (v_role in ('admin','sales_manager','direction') and v_lead.status in ('won','lost','unqualified','archived') and p_status = 'contacted')
  ) then raise exception 'invalid pipeline transition'; end if;
  update public.leads set status = p_status,
    converted_at = case when p_status = 'won' then now() else converted_at end
  where id = p_lead_id;
  insert into public.activities (lead_id, author_id, activity_type, occurred_at, subject, body, metadata)
  values (p_lead_id, v_actor, 'status_change', now(), 'Changement de statut',
    nullif(pg_catalog.btrim(p_reason), ''),
    pg_catalog.jsonb_build_object('from', v_lead.status, 'to', p_status));
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_search_leads(p_search text DEFAULT NULL::text, p_status lead_status DEFAULT NULL::lead_status, p_assignee uuid DEFAULT NULL::uuid, p_priority text DEFAULT NULL::text, p_unassigned boolean DEFAULT false, p_sort text DEFAULT 'recent'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := private.crm_actor(false);
  v_manager boolean := private.current_app_role() in ('admin', 'sales_manager', 'direction');
  v_result jsonb;
begin
  if p_page < 1 or p_page_size < 1 or p_page_size > 100 or p_sort not in ('recent','oldest','name','follow_up') then
    raise exception 'invalid pagination or sorting';
  end if;
  with scoped as materialized (
    select l.id, l.company_id, l.assigned_to, l.created_by, l.source,
      l.identified_need, l.interested_offer, l.status, l.priority, l.notes,
      l.next_follow_up_at, l.created_at, l.updated_at, l.converted_at,
      c.legal_name as company_name, c.industry, c.city, c.neighborhood,
      c.address, c.phone, c.normalized_phone, c.website, c.has_website, c.email as company_email,
      (select max(a.occurred_at) from public.activities a where a.lead_id = l.id) as last_activity_at,
      p.full_name as assigned_name,
      (select pg_catalog.to_jsonb(ct) from public.contacts ct
        where ct.company_id = c.id order by ct.is_primary desc, ct.created_at limit 1) as contact
    from public.leads l
    join public.companies c on c.id = l.company_id
    left join public.profiles p on p.id = l.assigned_to
    where (v_manager or l.assigned_to = v_actor)
      and (p_status is null or l.status = p_status)
      and (p_assignee is null or l.assigned_to = p_assignee)
      and (p_priority is null or l.priority = p_priority)
      and (not p_unassigned or l.assigned_to is null)
      and (nullif(pg_catalog.btrim(p_search), '') is null or
        c.legal_name ilike '%' || pg_catalog.btrim(p_search) || '%' or
        c.normalized_phone ilike '%' || pg_catalog.btrim(p_search) || '%' or
        exists (select 1 from public.contacts ct where ct.company_id = c.id and
          (ct.full_name ilike '%' || pg_catalog.btrim(p_search) || '%' or
           ct.email ilike '%' || pg_catalog.btrim(p_search) || '%')))
  )
  select pg_catalog.jsonb_build_object(
    'total', (select pg_catalog.count(*) from scoped),
    'rows', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page_rows)) from (
      select * from scoped
      order by
        case when p_sort = 'name' then pg_catalog.lower(company_name) end asc nulls last,
        case when p_sort = 'oldest' then created_at end asc nulls last,
        case when p_sort = 'follow_up' then next_follow_up_at end asc nulls last,
        case when p_sort = 'recent' then created_at end desc nulls last,
        id desc
      limit p_page_size offset (p_page - 1) * p_page_size
    ) page_rows), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $function$
;

CREATE OR REPLACE FUNCTION public.commercial_save_proposal(p_id uuid, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(false); v_lead public.leads%rowtype;
  v_company public.companies%rowtype; v_contact public.contacts%rowtype;
  v_offer public.offer_templates%rowtype; v_old public.commercial_proposals%rowtype;
  v_discount bigint; v_base bigint; v_terms text; v_expiry timestamptz;
  v_snapshot jsonb; v_client jsonb; v_description text; v_plan public.commercial_payment_plan;
begin
  if p_data is null or pg_catalog.jsonb_typeof(p_data) <> 'object' then raise exception 'invalid proposal'; end if;
  select * into v_lead from public.leads where id = nullif(p_data->>'lead_id', '')::uuid;
  if v_lead.id is null or not private.commercial_lead_access(v_lead.id) then raise exception 'lead unavailable'; end if;
  select * into v_company from public.companies where id = v_lead.company_id;
  if nullif(p_data->>'contact_id', '') is not null then
    select * into v_contact from public.contacts where id = (p_data->>'contact_id')::uuid
      and company_id = v_company.id;
    if v_contact.id is null then raise exception 'contact does not belong to this company'; end if;
  end if;
  select * into v_offer from public.offer_templates where id = nullif(p_data->>'offer_id', '')::uuid;
  if v_offer.id is null or v_offer.status <> 'active' then raise exception 'active offer required'; end if;
  v_discount := coalesce(nullif(p_data->>'discount_xof', '')::bigint, 0);
  v_base := coalesce(nullif(p_data->>'quoted_price_xof', '')::bigint, v_offer.price_xof);
  if v_base < v_offer.price_xof or (not v_offer.price_is_starting and v_base <> v_offer.price_xof) then
    raise exception 'quoted price must respect the published offer'; end if;
  if v_discount < 0 or v_discount > v_base then raise exception 'invalid discount'; end if;
  v_terms := nullif(pg_catalog.btrim(p_data->>'special_terms'), '');
  v_description := nullif(pg_catalog.btrim(p_data->>'service_description'), '');
  if v_description is null then raise exception 'service description required'; end if;
  v_expiry := nullif(p_data->>'expires_at', '')::timestamptz;
  if v_expiry is null or v_expiry <= now() or v_expiry > now() + interval '365 days' then
    raise exception 'valid expiry date within 365 days required'; end if;
  v_plan := (p_data->>'payment_plan')::public.commercial_payment_plan;
  if v_plan is null then raise exception 'payment plan required'; end if;
  v_snapshot := pg_catalog.jsonb_build_object('name', v_offer.name, 'category', v_offer.category,
    'description', v_offer.description, 'price_xof', v_offer.price_xof,
    'price_is_starting', v_offer.price_is_starting, 'currency', v_offer.currency,
    'benefits', v_offer.benefits, 'included_services', v_offer.included_services,
    'exclusions', v_offer.exclusions, 'delivery_days', v_offer.delivery_days,
    'payment_terms', v_offer.payment_terms, 'version', v_offer.version);
  v_client := pg_catalog.jsonb_build_object('company_name', v_company.legal_name,
    'address', v_company.address, 'city', v_company.city,
    'email', v_company.email, 'phone', v_company.phone,
    'contact_name', v_contact.full_name, 'contact_title', v_contact.job_title,
    'contact_email', v_contact.email, 'contact_phone', v_contact.phone);
  if p_id is null then
    insert into public.commercial_proposals(proposal_number, lead_id, company_id, contact_id,
      sales_rep_id, offer_template_id, offer_version, offer_snapshot, client_snapshot,
      service_description, base_price_xof, discount_xof, amount_xof, payment_plan,
      special_terms, delivery_days, expires_at, requires_approval, created_by)
    values ('PROP-' || pg_catalog.to_char(now(), 'YYYY') || '-' ||
      pg_catalog.lpad(pg_catalog.nextval('public.proposal_number_seq'::regclass)::text, 6, '0'),
      v_lead.id, v_company.id, v_contact.id, coalesce(v_lead.assigned_to, v_actor),
      v_offer.id, v_offer.version, v_snapshot, v_client, v_description, v_base,
      v_discount, v_base - v_discount, v_plan, v_terms, v_offer.delivery_days,
      v_expiry, v_discount > 0 or v_terms is not null, v_actor)
    returning id into p_id;
  else
    select * into v_old from public.commercial_proposals where id = p_id for update;
    if v_old.id is null or v_old.status <> 'draft' or
       not private.commercial_lead_access(v_old.lead_id) then
      raise exception 'only accessible draft proposals can be edited'; end if;
    if v_old.lead_id <> v_lead.id then raise exception 'proposal lead cannot change'; end if;
    update public.commercial_proposals set contact_id = v_contact.id,
      offer_template_id = v_offer.id, offer_version = v_offer.version,
      offer_snapshot = v_snapshot, client_snapshot = v_client,
      service_description = v_description, base_price_xof = v_base,
      discount_xof = v_discount, amount_xof = v_base - v_discount,
      payment_plan = v_plan, special_terms = v_terms, delivery_days = v_offer.delivery_days,
      expires_at = v_expiry, requires_approval = v_discount > 0 or v_terms is not null
    where id = p_id;
  end if;
  insert into public.commercial_proposal_events(proposal_id, actor_id, event_type)
  values(p_id, v_actor, 'saved_draft');
  return p_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.commercial_finalize_document(p_proposal_id uuid, p_storage_path text, p_sha256 text, p_actor_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_proposal public.commercial_proposals%rowtype;
  v_existing uuid; v_document uuid; v_role public.app_role;
begin
  select role::public.app_role into v_role from public.profiles where id = p_actor_id and is_active;
  if v_role is null then raise exception 'active document author required'; end if;
  select * into v_proposal from public.commercial_proposals where id = p_proposal_id for update;
  if v_proposal.id is null or not (v_role in ('admin','sales_manager','direction') or
    exists (select 1 from public.leads where id = v_proposal.lead_id and assigned_to = p_actor_id)) then
    raise exception 'proposal unavailable'; end if;
  if v_proposal.status not in ('approved','sent','accepted') then raise exception 'approval required'; end if;
  select id into v_existing from public.documents where proposal_id = p_proposal_id
    and document_version = 1 and document_type = 'offer_sheet';
  if v_existing is not null then return v_existing; end if;
  if p_storage_path <> 'proposals/' || p_proposal_id::text || '/v1.pdf' or
     p_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'invalid official document path or hash'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'ebi-documents'
    and name = p_storage_path and metadata->>'mimetype' = 'application/pdf') then
    raise exception 'official PDF not uploaded'; end if;
  insert into public.documents(document_type, proposal_id, offer_template_id,
    storage_path, document_number, document_version, content_hash, created_by, metadata)
  values ('offer_sheet', p_proposal_id, v_proposal.offer_template_id,
    p_storage_path, v_proposal.proposal_number || '-V1', 1, p_sha256, p_actor_id,
    jsonb_build_object('offer_version', v_proposal.offer_version,
      'amount_xof', v_proposal.amount_xof, 'issued_from_snapshot', true))
  returning id into v_document;
  insert into public.commercial_proposal_events(proposal_id, actor_id, event_type, details)
  values(p_proposal_id, p_actor_id, 'pdf_issued', jsonb_build_object('document_id', v_document));
  return v_document;
end $function$
;

CREATE OR REPLACE FUNCTION public.commercial_create_order(p_proposal_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(false); v_proposal public.commercial_proposals%rowtype;
  v_order uuid; v_deposit bigint; v_snapshot jsonb;
begin
  select * into v_proposal from public.commercial_proposals where id = p_proposal_id for update;
  if v_proposal.id is null or not private.commercial_lead_access(v_proposal.lead_id) then
    raise exception 'proposal unavailable'; end if;
  if v_proposal.status <> 'accepted' or not v_proposal.acceptance_verified then
    raise exception 'verified acceptance required'; end if;
  if not exists (select 1 from public.documents where proposal_id = p_proposal_id
    and document_type = 'offer_sheet' and document_status = 'issued') then
    raise exception 'official proposal document required'; end if;
  select id into v_order from public.orders where proposal_id = p_proposal_id;
  if v_order is not null then return v_order; end if;
  v_snapshot := v_proposal.offer_snapshot || pg_catalog.jsonb_build_object(
    'proposal_number', v_proposal.proposal_number,
    'service_description', v_proposal.service_description,
    'client', v_proposal.client_snapshot,
    'base_price_xof', v_proposal.base_price_xof,
    'discount_xof', v_proposal.discount_xof,
    'amount_xof', v_proposal.amount_xof,
    'special_terms', v_proposal.special_terms,
    'delivery_days', v_proposal.delivery_days,
    'payment_plan', v_proposal.payment_plan,
    'acceptance_reference', v_proposal.acceptance_reference,
    'accepted_at', v_proposal.accepted_at,
    'acceptance_verified_by', v_proposal.acceptance_verified_by);
  insert into public.orders(order_number, company_id, lead_id, sales_rep_id,
    offer_template_id, offer_version, offer_snapshot, amount_xof, contractual_terms,
    order_status, created_by, proposal_id, payment_plan, payment_terms_snapshot)
  values ('CMD-' || pg_catalog.to_char(now(), 'YYYY') || '-' ||
      pg_catalog.lpad(pg_catalog.nextval('public.commercial_order_number_seq'::regclass)::text, 6, '0'),
    v_proposal.company_id, v_proposal.lead_id, v_proposal.sales_rep_id,
    v_proposal.offer_template_id, v_proposal.offer_version, v_snapshot,
    v_proposal.amount_xof, v_proposal.special_terms, 'draft', v_actor,
    v_proposal.id, v_proposal.payment_plan,
    pg_catalog.jsonb_build_object('plan', v_proposal.payment_plan,
      'offer_terms', v_proposal.offer_snapshot->>'payment_terms',
      'special_terms', v_proposal.special_terms))
  returning id into v_order;
  v_deposit := case when v_proposal.payment_plan = 'full_upfront' then v_proposal.amount_xof
    else v_proposal.amount_xof / 2 end;
  insert into public.order_installments(order_id, installment_number, trigger_event,
    percentage_bps, amount_xof, terms)
  values(v_order, 1, 'at_order',
    case when v_proposal.payment_plan = 'full_upfront' then 10000 else 5000 end,
    v_deposit, 'Exigible à la commande selon les conditions acceptées');
  if v_proposal.payment_plan = 'half_on_delivery' then
    insert into public.order_installments(order_id, installment_number, trigger_event,
      percentage_bps, amount_xof, terms)
    values(v_order, 2, 'at_delivery', 5000, v_proposal.amount_xof - v_deposit,
      'Exigible à l’étape contractuelle de livraison acceptée');
  end if;
  insert into public.commercial_order_events(order_id, actor_id, event_type, details)
  values(v_order, v_actor, 'created_from_verified_proposal',
    pg_catalog.jsonb_build_object('proposal_id', p_proposal_id,
      'amount_xof', v_proposal.amount_xof, 'plan', v_proposal.payment_plan));
  return v_order;
end $function$
;

CREATE OR REPLACE FUNCTION public.finance_set_verifier(p_user_id uuid, p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(true);
begin
  if private.current_app_role() <> 'admin' then raise exception 'administrator required'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id and role in ('sales_manager', 'direction', 'finance') and is_active)
    then raise exception 'profil finance/direction/responsable commercial actif requis'; end if;
  insert into public.finance_verifiers(user_id, enabled, granted_by)
  values(p_user_id, p_enabled, v_actor)
  on conflict(user_id) do update set enabled = excluded.enabled, granted_by = v_actor, granted_at = now();
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values(v_actor, 'finance_verifier_changed', 'finance_verifiers', p_user_id,
    pg_catalog.jsonb_build_object('enabled', p_enabled));
end $function$
;

CREATE OR REPLACE FUNCTION public.finance_declare_payment(p_order_id uuid, p_account_id uuid, p_amount_xof bigint, p_reference text, p_paid_at timestamp with time zone, p_installment_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_cash_received_by uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(false); v_order public.orders%rowtype;
  v_account public.payment_accounts%rowtype; v_id uuid; v_reference text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null or v_order.order_status = 'cancelled' or
    not (private.current_app_role() in ('admin','sales_manager','direction') or
      (v_order.sales_rep_id = v_actor and private.commercial_lead_access(v_order.lead_id))) then
    raise exception 'order unavailable'; end if;
  select * into v_account from public.payment_accounts where id = p_account_id and is_active;
  if v_account.id is null then raise exception 'active official payment account required'; end if;
  if p_amount_xof is null or p_amount_xof <= 0 or p_amount_xof > v_order.amount_xof then
    raise exception 'invalid declared amount'; end if;
  if p_paid_at is null or p_paid_at > now() + interval '1 day' then
    raise exception 'invalid declared payment date'; end if;
  if p_installment_id is not null and not exists (
    select 1 from public.order_installments where id = p_installment_id and order_id = p_order_id
  ) then raise exception 'installment does not belong to order'; end if;
  v_reference := nullif(pg_catalog.btrim(p_reference), '');
  if v_account.method <> 'cash' and v_reference is null then raise exception 'transaction reference required'; end if;
  if v_account.method = 'cash' and (
    p_cash_received_by is null or p_cash_received_by <> v_account.cash_responsible_id
  ) then raise exception 'authorized cash receiver required'; end if;
  if v_reference is not null and exists (select 1 from public.payments
    where payment_account_id = p_account_id and method = v_account.method
      and pg_catalog.lower(pg_catalog.btrim(transaction_reference)) = pg_catalog.lower(v_reference)
      and status in ('pending','confirmed')) then raise exception 'reference already declared'; end if;
  insert into public.payments(order_id, amount_xof, method, transaction_reference, paid_at,
    status, notes, created_by, payment_account_id, installment_id, declared_at, review_state,
    cash_received_by)
  values(p_order_id, p_amount_xof, v_account.method, v_reference, p_paid_at,
    'pending', nullif(pg_catalog.btrim(p_notes), ''), v_actor, p_account_id,
    p_installment_id, now(), 'declared', p_cash_received_by)
  returning id into v_id;
  insert into public.payment_events(payment_id, actor_id, event_type, details)
  values(v_id, v_actor, 'declared', pg_catalog.jsonb_build_object('amount_xof', p_amount_xof,
    'method', v_account.method, 'account_id', p_account_id));
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values(v_actor, 'payment_declared', 'payments', v_id,
    pg_catalog.jsonb_build_object('amount_xof', p_amount_xof, 'order_id', p_order_id));
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.finance_request_instructions(p_order_id uuid, p_installment_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(false); v_order public.orders%rowtype;
  v_installment public.order_installments%rowtype; v_amount bigint;
  v_accounts jsonb; v_settings public.commercial_settings%rowtype; v_job uuid; v_number text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null or v_order.order_status = 'cancelled' or
    not (private.current_app_role() in ('admin','sales_manager','direction') or
      (v_order.sales_rep_id = v_actor and private.commercial_lead_access(v_order.lead_id))) then
    raise exception 'order unavailable'; end if;
  if p_installment_id is not null then
    select * into v_installment from public.order_installments where id = p_installment_id and order_id = p_order_id;
    if v_installment.id is null then raise exception 'installment unavailable'; end if;
    v_amount := v_installment.amount_xof;
  else
    v_amount := v_order.amount_xof;
  end if;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('method', a.method,
    'provider_name', a.provider_name, 'holder_name', a.holder_name,
    'account_identifier', a.account_identifier, 'client_instructions', a.client_instructions)
    order by a.method, a.provider_name) into v_accounts
  from public.payment_accounts a where a.is_active;
  if v_accounts is null then raise exception 'configure an official active account first'; end if;
  select * into v_settings from public.commercial_settings where id = true;
  v_number := 'EBI-PAY-' || pg_catalog.to_char(now(), 'YYYY') || '-' ||
    pg_catalog.lpad(pg_catalog.nextval('public.finance_instruction_number_seq'::regclass)::text, 6, '0');
  insert into public.finance_document_jobs(kind, order_id, installment_id, document_number,
    snapshot, created_by)
  values('instructions', p_order_id, p_installment_id, v_number,
    pg_catalog.jsonb_build_object('order', pg_catalog.to_jsonb(v_order),
      'installment', case when v_installment.id is null then null else pg_catalog.to_jsonb(v_installment) end,
      'amount_due_xof', v_amount, 'accounts', v_accounts, 'company', pg_catalog.to_jsonb(v_settings),
      'prepared_at', now()), v_actor)
  returning id into v_job;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values(v_actor, 'payment_instructions_requested', 'finance_document_jobs', v_job,
    pg_catalog.jsonb_build_object('order_id', p_order_id, 'amount_due_xof', v_amount));
  return v_job;
end $function$
;

CREATE OR REPLACE FUNCTION public.finance_job_payload(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(false); v_job public.finance_document_jobs%rowtype;
  v_order public.orders%rowtype;
begin
  select * into v_job from public.finance_document_jobs where id = p_id;
  if v_job.id is null then raise exception 'document request unavailable'; end if;
  select * into v_order from public.orders where id = v_job.order_id;
  if not (private.current_app_role() in ('admin','sales_manager','direction') or
    (v_order.sales_rep_id = v_actor and private.commercial_lead_access(v_order.lead_id))) then
    raise exception 'document request unavailable'; end if;
  return pg_catalog.jsonb_build_object('id', v_job.id, 'kind', v_job.kind,
    'status', v_job.status, 'document_number', v_job.document_number,
    'document_id', v_job.document_id, 'snapshot', v_job.snapshot,
    'created_at', v_job.created_at);
end $function$
;

CREATE OR REPLACE FUNCTION public.field_set_budget_permission(p_user_id uuid, p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(true);
begin
  if private.current_app_role() <> 'admin' then raise exception 'administrator required'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id and role in ('sales_manager', 'direction') and is_active)
    then raise exception 'profil responsable commercial/direction actif requis'; end if;
  insert into public.field_budget_permissions(user_id,enabled,granted_by)
  values(p_user_id,p_enabled,v_actor)
  on conflict(user_id) do update set enabled=excluded.enabled,granted_by=v_actor,granted_at=now();
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('permission',p_user_id,'changed',v_actor,pg_catalog.jsonb_build_object('enabled',p_enabled));
end $function$
;

CREATE OR REPLACE FUNCTION public.field_create_budget(p_rep uuid, p_kind text, p_amount bigint, p_start date, p_end date, p_purpose text, p_zone text DEFAULT NULL::text, p_exception_of uuid DEFAULT NULL::uuid, p_exception_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(true); v_policy public.field_policy_versions%rowtype;
  v_id uuid; v_amount bigint;
begin
  if not private.field_can_manage() then raise exception 'budget authority required'; end if;
  if p_rep=v_actor or not exists(select 1 from public.profiles where id=p_rep and role='sales_rep' and is_active)
    then raise exception 'active commercial other than approver required'; end if;
  if p_kind not in ('startup','transport','other') or p_start is null or p_end<p_start or
    nullif(btrim(p_purpose),'') is null then raise exception 'invalid budget'; end if;
  if p_kind='transport' and nullif(btrim(p_zone),'') is null then
    raise exception 'prospecting zone required for transport'; end if;
  select * into v_policy from public.field_policy_versions where effective_from<=p_start
    order by effective_from desc limit 1;
  if v_policy.id is null then raise exception 'applicable policy unavailable'; end if;
  if p_kind='startup' then
    if private.current_app_role()<>'admin' then raise exception 'startup authority restricted to administrator'; end if;
    if p_exception_of is not null and (nullif(btrim(p_exception_reason),'') is null or
      not exists(select 1 from public.field_budgets where id=p_exception_of and sales_rep_id=p_rep and kind='startup'))
      then raise exception 'documented startup exception required'; end if;
    v_amount:=coalesce(p_amount,v_policy.startup_amount_xof);
  else
    if p_exception_of is not null then raise exception 'exception only for startup'; end if;
    v_amount:=p_amount;
  end if;
  if v_amount is null or v_amount<=0 then raise exception 'explicit positive amount required'; end if;
  insert into public.field_budgets(sales_rep_id,kind,policy_id,period_start,period_end,
    authorized_xof,purpose,prospecting_zone,allowed_categories,exception_of,exception_reason,authorized_by)
  values(p_rep,p_kind,v_policy.id,p_start,p_end,v_amount,btrim(p_purpose),nullif(btrim(p_zone),''),
    v_policy.allowed_categories,p_exception_of,nullif(btrim(p_exception_reason),''),v_actor)
  returning id into v_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('budget',v_id,'authorized',v_actor,pg_catalog.jsonb_build_object('kind',p_kind,'amount_xof',v_amount));
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.field_request_advance(p_budget uuid, p_amount bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(false); v_budget public.field_budgets%rowtype; v_id uuid;
begin
  select * into v_budget from public.field_budgets where id=p_budget for update;
  if v_budget.id is null or v_budget.status not in ('approved','active') or
    not (v_budget.sales_rep_id=v_actor or private.field_can_manage()) then raise exception 'budget unavailable'; end if;
  if p_amount is null or p_amount<=0 or p_amount>v_budget.authorized_xof then raise exception 'invalid advance amount'; end if;
  insert into public.field_advances(budget_id,sales_rep_id,requested_xof,requested_by)
    values(p_budget,v_budget.sales_rep_id,p_amount,v_actor) returning id into v_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('advance',v_id,'requested',v_actor,pg_catalog.jsonb_build_object('amount_xof',p_amount));
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.field_approve_advance(p_id uuid, p_approve boolean, p_amount bigint DEFAULT NULL::bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(true); v_advance public.field_advances%rowtype;
  v_budget public.field_budgets%rowtype; v_amount bigint;
begin
  if not private.field_can_manage() then raise exception 'budget authority required'; end if;
  select * into v_advance from public.field_advances where id=p_id for update;
  if v_advance.id is null or v_advance.status<>'requested' or v_advance.sales_rep_id=v_actor
    then raise exception 'request unavailable'; end if;
  select * into v_budget from public.field_budgets where id=v_advance.budget_id;
  v_amount:=coalesce(p_amount,v_advance.requested_xof);
  if p_approve and (v_amount<=0 or v_amount>v_advance.requested_xof or v_amount>v_budget.authorized_xof)
    then raise exception 'approved amount exceeds budget'; end if;
  update public.field_advances set status=case when p_approve then 'approved' else 'rejected' end,
    approved_xof=case when p_approve then v_amount else null end,approved_by=v_actor,approved_at=now()
    where id=p_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('advance',p_id,case when p_approve then 'approved' else 'rejected' end,v_actor,
      pg_catalog.jsonb_build_object('amount_xof',case when p_approve then v_amount else null end));
end $function$
;

CREATE OR REPLACE FUNCTION public.field_attach_proof(p_kind text, p_id uuid, p_path text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(false); v_owner uuid;
begin
  if p_path not like 'field/'||v_actor::text||'/%' or not exists
    (select 1 from storage.objects where bucket_id='ebi-field-proofs' and name=p_path)
    then raise exception 'private proof uploaded by actor required'; end if;
  if p_kind='advance' then
    if not private.field_can_manage() then raise exception 'budget authority required'; end if;
    update public.field_advances set handover_proof_path=p_path where id=p_id and status='approved';
  elsif p_kind='expense' then
    update public.field_expenses set proof_path=p_path where id=p_id and sales_rep_id=v_actor
      and status in ('submitted','needs_info');
  elsif p_kind='restitution' then
    select a.sales_rep_id into v_owner from public.field_restitutions r
      join public.field_advances a on a.id=r.advance_id where r.id=p_id;
    if v_owner<>v_actor and not private.field_can_manage() then raise exception 'owner required'; end if;
    update public.field_restitutions set proof_path=p_path where id=p_id and status='declared';
  else raise exception 'invalid proof relation'; end if;
  if not found then raise exception 'record not attachable'; end if;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values(p_kind,p_id,'proof_attached',v_actor,pg_catalog.jsonb_build_object('path',p_path));
end $function$
;

CREATE OR REPLACE FUNCTION public.field_disburse_advance(p_id uuid, p_amount bigint, p_method text, p_reference text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(true); v_advance public.field_advances%rowtype;
  v_budget_id uuid;
begin
  if not private.field_can_manage() then raise exception 'budget authority required'; end if;
  select budget_id into v_budget_id from public.field_advances where id=p_id;
  if v_budget_id is null then raise exception 'advance not found'; end if;
  perform 1 from public.field_budgets where id=v_budget_id for update;
  select * into v_advance from public.field_advances where id=p_id for update;
  if v_advance.id is null or v_advance.status<>'approved' or v_advance.sales_rep_id=v_actor or
    v_advance.handover_proof_path is null then raise exception 'approved advance and handover proof required'; end if;
  if p_amount is null or p_amount<=0 or p_amount>v_advance.approved_xof or
    nullif(btrim(p_method),'') is null or nullif(btrim(p_reference),'') is null
    then raise exception 'verified transfer details required'; end if;
  update public.field_advances set status='disbursed',disbursed_xof=p_amount,disbursed_by=v_actor,
    disbursed_at=now(),transfer_method=btrim(p_method),transfer_reference=btrim(p_reference)
    where id=p_id;
  update public.field_budgets set status='active' where id=v_advance.budget_id and status='approved';
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('advance',p_id,'disbursed',v_actor,pg_catalog.jsonb_build_object('amount_xof',p_amount,'reference',p_reference));
end $function$
;

CREATE OR REPLACE FUNCTION public.field_review_expense(p_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(true); v_expense public.field_expenses%rowtype;
  v_budget public.field_budgets%rowtype; v_policy public.field_policy_versions%rowtype;
  v_advance public.field_advances%rowtype; v_total bigint; v_returned bigint;
begin
  if not private.field_can_manage() then raise exception 'budget authority required'; end if;
  select budget_id into v_expense.budget_id from public.field_expenses where id=p_id;
  if v_expense.budget_id is null then raise exception 'expense unavailable'; end if;
  select * into v_budget from public.field_budgets where id=v_expense.budget_id for update;
  select * into v_expense from public.field_expenses where id=p_id for update;
  if v_expense.status not in ('submitted','needs_info') or v_expense.sales_rep_id=v_actor or
    p_action not in ('approve','reject','request_info') then raise exception 'review unavailable'; end if;
  if p_action<>'approve' and nullif(btrim(p_reason),'') is null then raise exception 'reason required'; end if;
  if p_action='approve' then
    select * into v_policy from public.field_policy_versions where id=v_budget.policy_id;
    if v_expense.category=any(v_policy.receipt_required_categories) and v_expense.proof_path is null
      then raise exception 'supporting document required'; end if;
    select coalesce(sum(amount_xof),0) into v_total from public.field_expenses
      where budget_id=v_budget.id and status in ('approved','regularized');
    if v_total+v_expense.amount_xof>v_budget.authorized_xof then raise exception 'budget exceeded'; end if;
    if v_policy.period_cap_xof is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        v_expense.sales_rep_id::text||pg_catalog.to_char(v_expense.incurred_at,'YYYY-MM'),61220604));
      select coalesce(sum(amount_xof),0) into v_total from public.field_expenses
        where sales_rep_id=v_expense.sales_rep_id and status in ('approved','regularized')
          and pg_catalog.date_trunc('month',incurred_at)=pg_catalog.date_trunc('month',v_expense.incurred_at);
      if v_total+v_expense.amount_xof>v_policy.period_cap_xof then
        raise exception 'monthly policy cap exceeded'; end if;
    end if;
    if v_expense.funding_source='advance' then
      select * into v_advance from public.field_advances where id=v_expense.advance_id for update;
      if v_advance.status<>'disbursed' then raise exception 'advance not open'; end if;
      select coalesce(sum(amount_xof),0) into v_total from public.field_expenses
        where advance_id=v_advance.id and status in ('approved','regularized');
      select coalesce(sum(amount_xof),0) into v_returned from public.field_restitutions
        where advance_id=v_advance.id and status='verified';
      if v_total+v_returned+v_expense.amount_xof>v_advance.disbursed_xof
        then raise exception 'advance balance exceeded'; end if;
    end if;
  end if;
  update public.field_expenses set status=case p_action when 'approve' then 'approved'
    when 'reject' then 'rejected' else 'needs_info' end,
    reimbursement_status=case when p_action='approve' and funding_source='personal' then 'due'
      else reimbursement_status end,
    approved_by=case when p_action='approve' then v_actor else approved_by end,
    approved_at=case when p_action='approve' then now() else approved_at end
    where id=p_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('expense',p_id,p_action,v_actor,pg_catalog.jsonb_build_object('reason',p_reason));
end $function$
;

CREATE OR REPLACE FUNCTION public.field_pay_reimbursement(p_id uuid, p_reference text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(true); v_expense public.field_expenses%rowtype;
begin
  if not private.field_can_manage() then raise exception 'budget authority required'; end if;
  select * into v_expense from public.field_expenses where id=p_id for update;
  if v_expense.id is null or v_expense.sales_rep_id=v_actor or v_expense.status<>'approved' or
    v_expense.funding_source<>'personal' or v_expense.reimbursement_status<>'due' or
    nullif(btrim(p_reference),'') is null then raise exception 'approved personal expense required'; end if;
  update public.field_expenses set reimbursement_status='paid',reimbursement_reference=btrim(p_reference),
    reimbursed_at=now() where id=p_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('expense',p_id,'reimbursed',v_actor,pg_catalog.jsonb_build_object('reference',p_reference));
end $function$
;

CREATE OR REPLACE FUNCTION public.field_declare_restitution(p_advance uuid, p_amount bigint, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(false); v_advance public.field_advances%rowtype; v_id uuid;
begin
  select * into v_advance from public.field_advances where id=p_advance;
  if v_advance.id is null or v_advance.status<>'disbursed' or
    not (v_actor=v_advance.sales_rep_id or private.field_can_manage()) or
    p_amount is null or p_amount<=0 then raise exception 'open advance required'; end if;
  insert into public.field_restitutions(advance_id,amount_xof,declared_by,reason)
    values(p_advance,p_amount,v_actor,nullif(btrim(p_reason),'')) returning id into v_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('restitution',v_id,'declared',v_actor,pg_catalog.jsonb_build_object('amount_xof',p_amount));
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.field_verify_restitution(p_id uuid, p_reference text, p_accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(true); v_advance public.field_advances%rowtype;
  v_return public.field_restitutions%rowtype; v_spent bigint; v_returned bigint;
begin
  if not private.field_can_manage() then raise exception 'budget authority required'; end if;
  select advance_id into v_return.advance_id from public.field_restitutions where id=p_id;
  if v_return.advance_id is null then raise exception 'restitution unavailable'; end if;
  select * into v_advance from public.field_advances where id=v_return.advance_id for update;
  select * into v_return from public.field_restitutions where id=p_id for update;
  if v_return.status<>'declared' or v_actor=v_advance.sales_rep_id then raise exception 'pending return required'; end if;
  if p_accept then
    if v_return.proof_path is null or nullif(btrim(p_reference),'') is null
      then raise exception 'verified receipt and proof required'; end if;
    select coalesce(sum(amount_xof),0) into v_spent from public.field_expenses
      where advance_id=v_advance.id and status in ('approved','regularized');
    select coalesce(sum(amount_xof),0) into v_returned from public.field_restitutions
      where advance_id=v_advance.id and status='verified';
    if v_returned+v_return.amount_xof>v_advance.disbursed_xof-v_spent
      then raise exception 'return exceeds unspent advance'; end if;
  end if;
  update public.field_restitutions set status=case when p_accept then 'verified' else 'rejected' end,
    verified_by=v_actor,verified_at=now(),received_reference=case when p_accept then btrim(p_reference) else null end
    where id=p_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('restitution',p_id,case when p_accept then 'verified' else 'rejected' end,v_actor,
      pg_catalog.jsonb_build_object('reference',p_reference));
end $function$
;

CREATE OR REPLACE FUNCTION public.sales_publish_commission_policy(p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(true); v_id uuid; v_version integer;
begin
  if private.current_app_role()<>'admin' then raise exception 'administrator required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(61220602);
  select coalesce(max(version_no),0)+1 into v_version from public.sales_commission_policies;
  if p_data->>'basis' not in ('confirmed_collected_amount','fixed_per_sale','gross_margin') or
    p_data->>'vesting' not in ('progressive','full_collection') or
    (p_data->>'effective_from')::date is null or nullif(btrim(p_data->>'name'),'') is null or
    (p_data->>'basis'='fixed_per_sale' and p_data->>'vesting'<>'full_collection')
    then raise exception 'invalid policy'; end if;
  insert into public.sales_commission_policies(version_no,name,effective_from,basis,vesting,rate_bps,
    fixed_amount_xof,offer_template_id,sales_rep_id,refund_rule,eligibility,published_by)
  values(v_version,btrim(p_data->>'name'),(p_data->>'effective_from')::date,p_data->>'basis',
    p_data->>'vesting',nullif(p_data->>'rate_bps','')::integer,
    nullif(p_data->>'fixed_amount_xof','')::bigint,
    nullif(p_data->>'offer_template_id','')::uuid,nullif(p_data->>'sales_rep_id','')::uuid,
    coalesce(p_data->>'refund_rule','recalculate'),coalesce(p_data->'eligibility','{}'::jsonb),v_actor)
  returning id into v_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('commission_policy',v_id,'published',v_actor,pg_catalog.jsonb_build_object('version',v_version));
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.sales_recalculate_commission(p_order uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(true); v_order public.orders%rowtype;
  v_policy public.sales_commission_policies%rowtype; v_position public.sales_commission_positions%rowtype;
  v_net bigint; v_basis bigint; v_amount bigint; v_id uuid;
begin
  if private.current_app_role()<>'admin' then raise exception 'administrator required'; end if;
  select * into v_order from public.orders where id=p_order for update;
  if v_order.id is null or v_order.order_status not in ('confirmed','in_progress','completed')
    then raise exception 'confirmed order required'; end if;
  select * into v_position from public.sales_commission_positions where order_id=p_order for update;
  if v_position.id is null then
    select * into v_policy from public.sales_commission_policies
    where effective_from<=v_order.ordered_at::date and
      (offer_template_id is null or offer_template_id=v_order.offer_template_id) and
      (sales_rep_id is null or sales_rep_id=v_order.sales_rep_id)
    order by effective_from desc,
      (case when sales_rep_id is not null then 1 else 0 end)+
      (case when offer_template_id is not null then 1 else 0 end) desc,version_no desc limit 1;
    if v_policy.id is null then raise exception 'no configured commission policy'; end if;
  else
    select * into v_policy from public.sales_commission_policies where id=v_position.policy_id;
  end if;
  if v_policy.basis='gross_margin' then raise exception 'Données insuffisantes : coûts directs et revenu reconnu requis'; end if;
  select coalesce(sum(amount_xof),0)::bigint into v_net from public.financial_ledger where order_id=p_order;
  v_net:=greatest(v_net,0);
  v_basis:=case when v_policy.vesting='full_collection' and v_net<v_order.amount_xof then 0
    else least(v_net,v_order.amount_xof) end;
  if v_policy.basis='fixed_per_sale' then
    v_amount:=case when v_net>=v_order.amount_xof then v_policy.fixed_amount_xof else 0 end;
  else
    -- Round half up in integer FCFA. Recalculate cumulatively to avoid per-installment drift.
    v_amount:=pg_catalog.floor((v_basis::numeric*v_policy.rate_bps+5000)/10000)::bigint;
  end if;
  if v_position.id is null then
    insert into public.sales_commission_positions(order_id,sales_rep_id,policy_id,policy_snapshot,
      eligible_base_xof,acquired_xof)
    values(p_order,v_order.sales_rep_id,v_policy.id,pg_catalog.to_jsonb(v_policy),v_basis,v_amount)
    returning id into v_id;
  else
    v_id:=v_position.id;
    if v_position.eligible_base_xof<>v_basis or v_position.acquired_xof<>v_amount then
      update public.sales_commission_positions set eligible_base_xof=v_basis,acquired_xof=v_amount,
        calculated_at=now() where id=v_id;
    end if;
  end if;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('commission',v_id,'recalculated',v_actor,pg_catalog.jsonb_build_object(
      'net_collected_xof',v_net,'base_xof',v_basis,'acquired_xof',v_amount));
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.sales_approve_commission(p_position uuid, p_amount bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(true); v_position public.sales_commission_positions%rowtype;
  v_paid bigint;
begin
  if private.current_app_role()<>'admin' then raise exception 'administrator required'; end if;
  select * into v_position from public.sales_commission_positions where id=p_position for update;
  if v_position.id is null or v_position.sales_rep_id=v_actor or p_amount is null or
    p_amount<0 or p_amount>v_position.acquired_xof then raise exception 'eligible commission required'; end if;
  select coalesce(sum(amount_xof),0) into v_paid from public.sales_commission_payouts where position_id=p_position;
  if p_amount<v_paid then raise exception 'approval cannot fall below already paid'; end if;
  update public.sales_commission_positions set approved_xof=p_amount,approved_by=v_actor,
    approved_at=now() where id=p_position;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('commission',p_position,'approved',v_actor,pg_catalog.jsonb_build_object('amount_xof',p_amount));
end $function$
;

CREATE OR REPLACE FUNCTION public.sales_record_commission_payout(p_position uuid, p_amount bigint, p_paid_at timestamp with time zone, p_method text, p_reference text, p_proof text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(true); v_position public.sales_commission_positions%rowtype;
  v_paid bigint; v_id uuid;
begin
  if private.current_app_role()<>'admin' then raise exception 'administrator required'; end if;
  select * into v_position from public.sales_commission_positions where id=p_position for update;
  if v_position.id is null or v_position.sales_rep_id=v_actor or p_amount is null or p_amount<=0 or
    p_paid_at is null or p_paid_at>now()+interval '1 day' or nullif(btrim(p_method),'') is null or
    nullif(btrim(p_reference),'') is null then raise exception 'verified payout details required'; end if;
  select coalesce(sum(amount_xof),0) into v_paid from public.sales_commission_payouts where position_id=p_position;
  if p_amount>least(v_position.approved_xof,v_position.acquired_xof)-v_paid then
    raise exception 'payout exceeds currently payable commission'; end if;
  if p_proof is not null and (p_proof not like 'field/'||v_actor::text||'/%' or
    not exists(select 1 from storage.objects where bucket_id='ebi-field-proofs' and name=p_proof))
    then raise exception 'private payout proof required'; end if;
  insert into public.sales_commission_payouts(position_id,amount_xof,paid_at,method,external_reference,
    proof_path,recorded_by)
  values(p_position,p_amount,p_paid_at,btrim(p_method),btrim(p_reference),p_proof,v_actor)
  returning id into v_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('commission_payout',v_id,'recorded',v_actor,
      pg_catalog.jsonb_build_object('amount_xof',p_amount,'reference',p_reference));
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_update_sales_profile(p_user_id uuid, p_territory text, p_joined_at date, p_phone text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := private.crm_actor(true);
begin
  if p_user_id is null or not exists (
    select 1 from public.profiles where id = p_user_id and role in ('sales_rep', 'commercial')
  ) then raise exception 'commercial profile required'; end if;
  if pg_catalog.length(p_territory) > 255 or pg_catalog.length(p_phone) > 100 or
    p_joined_at > current_date + interval '1 year' then
    raise exception 'invalid professional profile fields'; end if;
  update public.profiles set
    territory = nullif(pg_catalog.btrim(p_territory), ''),
    joined_at = p_joined_at,
    phone = nullif(pg_catalog.btrim(p_phone), '')
  where id = p_user_id;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values (v_actor, 'sales_profile_updated', 'profiles', p_user_id,
    pg_catalog.jsonb_build_object('territory', p_territory, 'joined_at', p_joined_at));
end $function$
;

CREATE OR REPLACE FUNCTION public.guard_order_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if current_user not in ('postgres', 'supabase_admin') and old.order_status <> 'draft' and
    (old.company_id, old.sales_rep_id, old.offer_template_id, old.offer_version, old.offer_snapshot, old.amount_xof, old.contractual_terms)
    is distinct from
    (new.company_id, new.sales_rep_id, new.offer_template_id, new.offer_version, new.offer_snapshot, new.amount_xof, new.contractual_terms) then
    raise exception 'confirmed order terms are immutable';
  end if;
  return new;
end $function$
;

drop policy if exists "activities_select" on public.activities;
create policy "activities_select" on public.activities
  for select using (
(( SELECT private.crm_active() AS crm_active) AND (( SELECT private.can_read_all() AS can_read_all) OR (EXISTS ( SELECT 1
   FROM leads l
  WHERE ((l.id = activities.lead_id) AND (l.assigned_to = ( SELECT auth.uid() AS uid)))))))
);
drop policy if exists "appointments_select" on public.appointments;
create policy "appointments_select" on public.appointments
  for select using (
(( SELECT private.crm_active() AS crm_active) AND (( SELECT private.can_read_all() AS can_read_all) OR ((sales_rep_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM leads l
  WHERE ((l.id = appointments.lead_id) AND (l.assigned_to = ( SELECT auth.uid() AS uid))))))))
);
drop policy if exists "audit_select" on public.audit_logs;
create policy "audit_select" on public.audit_logs
  for select using (
( SELECT private.can_read_all() AS can_read_all)
);
drop policy if exists "commercial_proposals_select" on public.commercial_proposals;
create policy "commercial_proposals_select" on public.commercial_proposals
  for select using (
(( SELECT private.crm_active() AS crm_active) AND (( SELECT private.can_read_all() AS can_read_all) OR ((sales_rep_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM leads l
  WHERE ((l.id = commercial_proposals.lead_id) AND (l.assigned_to = ( SELECT auth.uid() AS uid))))))))
);
drop policy if exists "commissions_select" on public.commissions;
create policy "commissions_select" on public.commissions
  for select using (
(( SELECT private.can_read_all() AS can_read_all) OR (sales_rep_id = ( SELECT auth.uid() AS uid)))
);
drop policy if exists "companies_select" on public.companies;
create policy "companies_select" on public.companies
  for select using (
(( SELECT private.crm_active() AS crm_active) AND (( SELECT private.can_read_all() AS can_read_all) OR (created_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM leads l
  WHERE ((l.company_id = companies.id) AND (l.assigned_to = ( SELECT auth.uid() AS uid))))) OR ( SELECT private.permits('clients'::text, 'select'::text) AS permits) OR ( SELECT private.permits('fournisseurs'::text, 'select'::text) AS permits) OR ( SELECT private.permits('partenaires'::text, 'select'::text) AS permits)))
);
drop policy if exists "contacts_select" on public.contacts;
create policy "contacts_select" on public.contacts
  for select using (
(( SELECT private.crm_active() AS crm_active) AND (( SELECT private.can_read_all() AS can_read_all) OR (EXISTS ( SELECT 1
   FROM leads l
  WHERE ((l.company_id = contacts.company_id) AND (l.assigned_to = ( SELECT auth.uid() AS uid))))) OR ( SELECT private.permits('clients'::text, 'select'::text) AS permits) OR ( SELECT private.permits('fournisseurs'::text, 'select'::text) AS permits) OR ( SELECT private.permits('partenaires'::text, 'select'::text) AS permits)))
);
drop policy if exists "documents_select" on public.documents;
create policy "documents_select" on public.documents
  for select using (
(( SELECT private.crm_active() AS crm_active) AND (( SELECT private.can_read_all() AS can_read_all) OR ((proposal_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM commercial_proposals p
  WHERE (p.id = documents.proposal_id)))) OR ((order_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM orders o
  WHERE (o.id = documents.order_id)))) OR ( SELECT private.permits('bibliotheque'::text, 'select'::text) AS permits)))
);
drop policy if exists "expenses_select" on public.expenses;
create policy "expenses_select" on public.expenses
  for select using (
(( SELECT private.can_read_all() AS can_read_all) OR (claimant_id = ( SELECT auth.uid() AS uid)))
);
drop policy if exists "follow_ups_select" on public.follow_ups;
create policy "follow_ups_select" on public.follow_ups
  for select using (
(( SELECT private.crm_active() AS crm_active) AND (( SELECT private.can_read_all() AS can_read_all) OR ((responsible_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM leads l
  WHERE ((l.id = follow_ups.lead_id) AND (l.assigned_to = ( SELECT auth.uid() AS uid))))))))
);
drop policy if exists "import_batches_select" on public.import_batches;
create policy "import_batches_select" on public.import_batches
  for select using (
(( SELECT private.can_read_all() AS can_read_all) OR (uploaded_by = ( SELECT auth.uid() AS uid)))
);
drop policy if exists "import_rows_select" on public.import_rows;
create policy "import_rows_select" on public.import_rows
  for select using (
(EXISTS ( SELECT 1
   FROM import_batches b
  WHERE ((b.id = import_rows.batch_id) AND (( SELECT private.can_read_all() AS can_read_all) OR (b.uploaded_by = ( SELECT auth.uid() AS uid))))))
);
drop policy if exists "lead_assignments_select" on public.lead_assignments;
create policy "lead_assignments_select" on public.lead_assignments
  for select using (
(( SELECT private.crm_active() AS crm_active) AND (( SELECT private.can_read_all() AS can_read_all) OR (EXISTS ( SELECT 1
   FROM leads l
  WHERE ((l.id = lead_assignments.lead_id) AND (l.assigned_to = ( SELECT auth.uid() AS uid)))))))
);
drop policy if exists "leads_select" on public.leads;
create policy "leads_select" on public.leads
  for select using (
(( SELECT private.crm_active() AS crm_active) AND (( SELECT private.can_read_all() AS can_read_all) OR (assigned_to = ( SELECT auth.uid() AS uid))))
);
drop policy if exists "offers_select" on public.offer_templates;
create policy "offers_select" on public.offer_templates
  for select using (
(( SELECT private.crm_active() AS crm_active) AND ((status = 'active'::commercial_offer_status) OR ( SELECT private.can_read_all() AS can_read_all)))
);
drop policy if exists "orders_select" on public.orders;
create policy "orders_select" on public.orders
  for select using (
(( SELECT private.crm_active() AS crm_active) AND (( SELECT private.can_read_all() AS can_read_all) OR ((sales_rep_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM leads l
  WHERE ((l.id = orders.lead_id) AND (l.assigned_to = ( SELECT auth.uid() AS uid))))))) OR ( SELECT private.permits('achats', 'select') AS permits))
);
drop policy if exists "payments_select" on public.payments;
create policy "payments_select" on public.payments
  for select using (
(( SELECT private.can_read_all() AS can_read_all) OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = payments.order_id) AND (o.sales_rep_id = ( SELECT auth.uid() AS uid)))))) OR ( SELECT private.permits('paiements', 'select') AS permits)
);
drop policy if exists "production_select" on public.production_projects;
create policy "production_select" on public.production_projects
  for select using (
(( SELECT private.can_read_all() AS can_read_all) OR (responsible_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = production_projects.order_id) AND (o.sales_rep_id = ( SELECT auth.uid() AS uid))))))
);
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (
((( SELECT auth.uid() AS uid) = id) OR ( SELECT private.can_read_all() AS can_read_all))
);
notify pgrst_ddl_watch, 'reload schema';
