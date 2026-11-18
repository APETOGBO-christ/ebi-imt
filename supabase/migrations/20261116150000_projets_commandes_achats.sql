-- PROMPT 7 : Projets, Commandes clients et Achats fournisseurs.
-- A. Projets v2 : montant contractuel, avancement %, provenance, ÃƒÂ©tapes (project_steps),
--    RPC update/ÃƒÂ©tapes/progression + crÃƒÂ©ation sans DAO (commande directe / op commerciale).
-- B. Commandes v2 : lignes d'articles (quantitÃƒÂ©s, prix, remises), HT/TVA/TTC,
--    dÃƒÂ©lai de livraison, rattachement projet, lignes immuables aprÃƒÂ¨s confirmation.
-- C. Achats v2 : statuts 8 valeurs (+sent, +closed), conditions de paiement,
--    prix nÃƒÂ©gociÃƒÂ©s/devis de rÃƒÂ©fÃƒÂ©rence, RPC complÃƒÂ¨tes (commande, lignes, statuts),
--    factures fournisseurs et dÃƒÂ©caissements avec contrÃƒÂ´les, rÃƒÂ©ceptions via RPC LIV.
-- D. ContrÃƒÂ´les : permits (achats/projets/commandes/livraisons/paiements), validation
--    d'achat rÃƒÂ©servÃƒÂ©e ÃƒÂ  p_validate, cohÃƒÂ©rence montant = ÃŽÂ£ lignes, documents via bibliothÃƒÂ¨que.

-- ============ PARTIE 1 Ã¢â‚¬â€ PROJETS ============

alter table public.projects
  add column if not exists contract_amount_xof bigint,
  add column if not exists progress_pct integer not null default 0,
  add column if not exists source text;

alter table public.projects
  add constraint projects_progress_check check (progress_pct between 0 and 100),
  add constraint projects_contract_check check (contract_amount_xof is null or contract_amount_xof >= 0),
  add constraint projects_source_check check (source in ('dao','commande_directe','operation_commerciale'));

update public.projects set source = 'dao' where tender_id is not null and source is null;

create table if not exists public.project_steps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  position integer not null check (position > 0),
  title text not null,
  status text not null default 'a_faire'
    check (status in ('a_faire','en_cours','termine','bloque')),
  due_date date,
  completed_at timestamptz,
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, position)
);
create index if not exists project_steps_project_idx on public.project_steps(project_id, position);
create trigger project_steps_set_updated_at before update on public.project_steps
  for each row execute function public.set_updated_at();
create trigger crm_audit_project_steps after insert or update or delete on public.project_steps
  for each row execute function public.crm_audit_row();

alter table public.project_steps enable row level security;
revoke all on public.project_steps from anon;
revoke insert, update, delete on public.project_steps from authenticated;
grant select on public.project_steps to authenticated;
create policy project_steps_select on public.project_steps for select to authenticated
  using ((select private.permits('projets','select')));
create policy active_profile_gate on public.project_steps
  as restrictive for all to authenticated
  using ((select private.current_role_code()) is not null)
  with check ((select private.current_role_code()) is not null);

-- CrÃƒÂ©ation sans DAO (commande directe ou opÃƒÂ©ration commerciale interne)
create or replace function public.project_create_direct(
  p_title text, p_client_company_id uuid, p_source text,
  p_contract_amount_xof bigint default null, p_budget_xof bigint default null,
  p_manager_id uuid default null, p_start_date date default null,
  p_planned_end_date date default null, p_notes text default null
) returns uuid
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_project uuid;
  v_number text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('projets','insert')) then
    raise exception 'permission de crÃƒÂ©ation requise (projets)';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_title, '')), '') is null or length(pg_catalog.btrim(p_title)) > 200 then
    raise exception 'IntitulÃƒÂ© requis (200 caractÃƒÂ¨res maximum).';
  end if;
  if p_source not in ('commande_directe','operation_commerciale') then
    raise exception 'Provenance invalide (commande directe ou opÃƒÂ©ration commerciale).';
  end if;
  if not exists (select 1 from public.companies c where c.id = p_client_company_id) then
    raise exception 'Client (sociÃƒÂ©tÃƒÂ©) inconnu.';
  end if;
  if p_contract_amount_xof is not null and p_contract_amount_xof < 0 then
    raise exception 'Montant contractuel invalide.';
  end if;
  if p_budget_xof is not null and p_budget_xof < 0 then
    raise exception 'Budget invalide.';
  end if;
  if p_manager_id is not null and not exists (
    select 1 from public.profiles pr where pr.id = p_manager_id and pr.is_active
  ) then raise exception 'Responsable interne inconnu ou inactif.'; end if;
  v_number := public.next_official_number('pro');
  insert into public.projects (project_number, title, client_company_id, source,
    contract_amount_xof, budget_xof, manager_id, start_date, planned_end_date, notes, created_by)
  values (v_number, pg_catalog.btrim(p_title), p_client_company_id, p_source,
    p_contract_amount_xof, p_budget_xof, p_manager_id, p_start_date, p_planned_end_date,
    nullif(pg_catalog.btrim(p_notes), ''), v_uid)
  returning id into v_project;
  return v_project;
end $function$;

-- Ãƒâ€°dition du projet (client, responsable, dates, budget, montant contractuel)
create or replace function public.project_update(
  p_id uuid, p_title text, p_client_company_id uuid, p_manager_id uuid,
  p_start_date date, p_planned_end_date date, p_budget_xof bigint,
  p_contract_amount_xof bigint, p_notes text
) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('projets','update')) then
    raise exception 'permission de modification requise (projets)';
  end if;
  select s.status into v_status from public.projects s where s.id = p_id for update;
  if not found then raise exception 'Projet introuvable.'; end if;
  if v_status in ('completed','cancelled') then
    raise exception 'Ce projet est clos : ses informations ne sont plus modifiables.';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_title, '')), '') is null or length(pg_catalog.btrim(p_title)) > 200 then
    raise exception 'IntitulÃƒÂ© requis (200 caractÃƒÂ¨res maximum).';
  end if;
  if not exists (select 1 from public.companies c where c.id = p_client_company_id) then
    raise exception 'Client (sociÃƒÂ©tÃƒÂ©) inconnu.';
  end if;
  if p_budget_xof is not null and p_budget_xof < 0 then
    raise exception 'Budget invalide.';
  end if;
  if p_contract_amount_xof is not null and p_contract_amount_xof < 0 then
    raise exception 'Montant contractuel invalide.';
  end if;
  if p_manager_id is not null and not exists (
    select 1 from public.profiles pr where pr.id = p_manager_id and pr.is_active
  ) then raise exception 'Responsable interne inconnu ou inactif.'; end if;
  update public.projects set
    title = pg_catalog.btrim(p_title),
    client_company_id = p_client_company_id,
    manager_id = p_manager_id,
    start_date = p_start_date,
    planned_end_date = p_planned_end_date,
    budget_xof = p_budget_xof,
    contract_amount_xof = p_contract_amount_xof,
    notes = nullif(pg_catalog.btrim(p_notes), '')
  where id = p_id;
end $function$;

-- Ãƒâ€°tapes
create or replace function public.project_step_add(
  p_project_id uuid, p_title text, p_due_date date default null, p_notes text default null
) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_pos int;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('projets','update')) then
    raise exception 'permission de modification requise (projets)';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'Projet introuvable.';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_title, '')), '') is null then
    raise exception 'IntitulÃƒÂ© de l''ÃƒÂ©tape requis.';
  end if;
  select coalesce(max(position), 0) + 1 into v_pos from public.project_steps where project_id = p_project_id;
  insert into public.project_steps (project_id, position, title, due_date, notes, created_by)
  values (p_project_id, v_pos, pg_catalog.btrim(p_title), p_due_date, nullif(pg_catalog.btrim(p_notes), ''), v_uid);
end $function$;

create or replace function public.project_step_remove(p_step_id uuid) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_project_id uuid;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('projets','update')) then
    raise exception 'permission de modification requise (projets)';
  end if;
  select project_id into v_project_id from public.project_steps where id = p_step_id;
  if not found then raise exception 'Ãƒâ€°tape introuvable.'; end if;
  delete from public.project_steps where id = p_step_id;
end $function$;

create or replace function public.project_step_set_status(
  p_step_id uuid, p_status text, p_notes text default null
) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_project_id uuid;
  v_done int; v_total int;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('projets','update')) then
    raise exception 'permission de modification requise (projets)';
  end if;
  if p_status not in ('a_faire','en_cours','termine','bloque') then
    raise exception 'Statut d''ÃƒÂ©tape inconnu.';
  end if;
  select project_id into v_project_id from public.project_steps where id = p_step_id;
  if not found then raise exception 'Ãƒâ€°tape introuvable.'; end if;
  update public.project_steps set
    status = p_status,
    completed_at = case when p_status = 'termine' then now() else null end,
    notes = coalesce(nullif(pg_catalog.btrim(p_notes), ''), notes)
  where id = p_step_id;
  -- avancement automatique : part des ÃƒÂ©tapes terminÃƒÂ©es
  select count(*) filter (where status = 'termine'), count(*)
    into v_done, v_total
  from public.project_steps where project_id = v_project_id;
  update public.projects set progress_pct = case when v_total = 0 then 0 else round(v_done * 100 / v_total) end
  where id = v_project_id;
end $function$;

-- Avancement manuel (surcharge)
create or replace function public.project_set_progress(p_id uuid, p_pct int) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('projets','update')) then
    raise exception 'permission de modification requise (projets)';
  end if;
  if p_pct is null or p_pct < 0 or p_pct > 100 then
    raise exception 'Avancement invalide (0 ÃƒÂ  100).';
  end if;
  update public.projects set progress_pct = p_pct where id = p_id;
  if not found then raise exception 'Projet introuvable.'; end if;
end $function$;

revoke execute on function public.project_create(text, uuid, uuid, uuid, bigint, date, date) from anon, public;
grant execute on function public.project_create(text, uuid, uuid, uuid, bigint, date, date) to authenticated;

-- ============ PARTIE 2 Ã¢â‚¬â€ COMMANDES CLIENTS ============

alter table public.orders
  add column if not exists amount_ht_xof bigint,
  add column if not exists amount_tva_xof bigint,
  add column if not exists amount_ttc_xof bigint,
  add column if not exists delivery_deadline date;

alter table public.orders
  add constraint orders_ttc_check check (amount_ht_xof is null or amount_tva_xof is null
    or amount_ttc_xof is null or amount_ttc_xof = amount_ht_xof + amount_tva_xof);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  position integer not null check (position > 0),
  designation text not null,
  quantity numeric not null check (quantity > 0),
  unit text,
  unit_price_xof bigint not null check (unit_price_xof >= 0),
  discount_pct numeric not null default 0 check (discount_pct between 0 and 100),
  amount_xof bigint not null check (amount_xof = round(quantity * unit_price_xof * (1 - discount_pct / 100))::bigint and amount_xof >= 0),
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (order_id, position)
);
create index if not exists order_items_order_idx on public.order_items(order_id, position);
create trigger crm_audit_order_items after insert or update or delete on public.order_items
  for each row execute function public.crm_audit_row();

alter table public.order_items enable row level security;
revoke all on public.order_items from anon;
revoke insert, update, delete on public.order_items from authenticated;
grant select on public.order_items to authenticated;
create policy order_items_select on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
create policy active_profile_gate on public.order_items
  as restrictive for all to authenticated
  using ((select private.current_role_code()) is not null)
  with check ((select private.current_role_code()) is not null);

-- Recalcul HT / TVA / TTC depuis app_settings (taux TVA configurable)
create or replace function private.order_recompute_amounts(p_order_id uuid) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_ht bigint;
  v_vat numeric;
begin
  select coalesce(sum(amount_xof), 0) into v_ht from public.order_items where order_id = p_order_id;
  select coalesce((finance->>'default_vat_pct')::numeric, 18) into v_vat
    from public.app_settings where id = 1;
  update public.orders set
    amount_ht_xof = v_ht,
    amount_tva_xof = round(v_ht * v_vat / 100)::bigint,
    amount_ttc_xof = v_ht + round(v_ht * v_vat / 100)::bigint
  where id = p_order_id;
end $function$;

create or replace function public.order_item_add(
  p_order_id uuid, p_designation text, p_quantity numeric, p_unit text,
  p_unit_price_xof bigint, p_discount_pct numeric default 0, p_notes text default null
) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_status public.order_status;
  v_pos int;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('commandes','update')) then
    raise exception 'permission de modification requise (commandes)';
  end if;
  select o.order_status into v_status from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'Commande introuvable.'; end if;
  if v_status not in ('draft') then
    raise exception 'Les articles ne sont modifiables que sur une commande en brouillon (donnÃƒÂ©es validÃƒÂ©es conservÃƒÂ©es ÃƒÂ  l''ÃƒÂ©tat).';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_designation, '')), '') is null then
    raise exception 'DÃƒÂ©signation requise.';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'QuantitÃƒÂ© invalide.'; end if;
  if p_unit_price_xof is null or p_unit_price_xof < 0 then raise exception 'Prix unitaire invalide.'; end if;
  if p_discount_pct is null or p_discount_pct < 0 or p_discount_pct > 100 then
    raise exception 'Remise invalide (0 ÃƒÂ  100 %%).';
  end if;
  select coalesce(max(position), 0) + 1 into v_pos from public.order_items where order_id = p_order_id;
  insert into public.order_items (order_id, position, designation, quantity, unit, unit_price_xof, discount_pct, amount_xof, notes, created_by)
  values (p_order_id, v_pos, pg_catalog.btrim(p_designation), p_quantity, nullif(pg_catalog.btrim(p_unit), ''),
    p_unit_price_xof, p_discount_pct, round(p_quantity * p_unit_price_xof * (1 - p_discount_pct / 100))::bigint,
    nullif(pg_catalog.btrim(p_notes), ''), v_uid);
  perform private.order_recompute_amounts(p_order_id);
end $function$;

create or replace function public.order_item_remove(p_item_id uuid) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_order_id uuid;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('commandes','update')) then
    raise exception 'permission de modification requise (commandes)';
  end if;
  select order_id into v_order_id from public.order_items oi
    join public.orders o on o.id = oi.order_id
  where oi.id = p_item_id and o.order_status = 'draft' for update of o;
  if not found then raise exception 'Article introuvable ou commande non modifiable (brouillon seulement).'; end if;
  delete from public.order_items where id = p_item_id;
  perform private.order_recompute_amounts(v_order_id);
end $function$;

create or replace function public.order_set_project(p_order_id uuid, p_project_id uuid) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('commandes','update')) then
    raise exception 'permission de modification requise (commandes)';
  end if;
  if not exists (select 1 from public.orders o where o.id = p_order_id) then
    raise exception 'Commande introuvable.';
  end if;
  if p_project_id is not null and not exists (
    select 1 from public.projects p where p.id = p_project_id
  ) then raise exception 'Projet introuvable.'; end if;
  update public.orders set project_id = p_project_id where id = p_order_id;
end $function$;

revoke execute on function public.order_set_tender(uuid, uuid) from anon, public;
grant execute on function public.order_set_tender(uuid, uuid) to authenticated;

-- ============ PARTIE 3 Ã¢â‚¬â€ ACHATS FOURNISSEURS ============

alter table public.purchase_orders
  add column if not exists payment_terms text,
  add column if not exists negotiated_ref text,
  add column if not exists submitted_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists closed_at timestamptz;

alter table public.purchase_orders drop constraint if exists purchase_orders_status_check;
alter table public.purchase_orders add constraint purchase_orders_status_check
  check (status in ('draft','submitted','confirmed','sent','partially_received','received','closed','cancelled'));

create or replace function public.purchase_create(
  p_supplier_company_id uuid, p_order_id uuid default null, p_project_id uuid default null,
  p_delivery_expected_at timestamptz default null, p_payment_terms text default null,
  p_negotiated_ref text default null, p_notes text default null
) returns uuid
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_purchase uuid;
  v_number text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('achats','insert')) then
    raise exception 'permission de crÃƒÂ©ation requise (achats)';
  end if;
  if not exists (select 1 from public.companies c where c.id = p_supplier_company_id) then
    raise exception 'Fournisseur (sociÃƒÂ©tÃƒÂ©) inconnu.';
  end if;
  if p_order_id is not null and not exists (select 1 from public.orders o where o.id = p_order_id) then
    raise exception 'Commande cliente inconnue.';
  end if;
  if p_project_id is not null and not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'Projet inconnu.';
  end if;
  if p_order_id is null and p_project_id is null then
    raise exception 'Rattachez la commande fournisseur ÃƒÂ  un projet ou ÃƒÂ  une commande cliente.';
  end if;
  v_number := public.next_official_number('ach');
  insert into public.purchase_orders (purchase_number, supplier_company_id, order_id, project_id,
    status, delivery_expected_at, payment_terms, negotiated_ref, notes, created_by)
  values (v_number, p_supplier_company_id, p_order_id, p_project_id, 'draft',
    p_delivery_expected_at, nullif(pg_catalog.btrim(p_payment_terms), ''),
    nullif(pg_catalog.btrim(p_negotiated_ref), ''), nullif(pg_catalog.btrim(p_notes), ''), v_uid)
  returning id into v_purchase;
  return v_purchase;
end $function$;

create or replace function public.purchase_set_details(
  p_id uuid, p_payment_terms text, p_delivery_expected_at timestamptz,
  p_negotiated_ref text, p_notes text
) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('achats','update')) then
    raise exception 'permission de modification requise (achats)';
  end if;
  select po.status into v_status from public.purchase_orders po where po.id = p_id for update;
  if not found then raise exception 'Commande fournisseur introuvable.'; end if;
  if v_status not in ('draft','submitted') then
    raise exception 'Les conditions ne sont plus modifiables ÃƒÂ  ce stade.';
  end if;
  update public.purchase_orders set
    payment_terms = nullif(pg_catalog.btrim(p_payment_terms), ''),
    delivery_expected_at = p_delivery_expected_at,
    negotiated_ref = nullif(pg_catalog.btrim(p_negotiated_ref), ''),
    notes = nullif(pg_catalog.btrim(p_notes), '')
  where id = p_id;
end $function$;

create or replace function public.purchase_item_add(
  p_purchase_order_id uuid, p_designation text, p_quantity numeric, p_unit text,
  p_unit_price_xof bigint, p_notes text default null
) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
  v_pos int;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('achats','update')) then
    raise exception 'permission de modification requise (achats)';
  end if;
  select po.status into v_status from public.purchase_orders po where po.id = p_purchase_order_id for update;
  if not found then raise exception 'Commande fournisseur introuvable.'; end if;
  if v_status <> 'draft' then
    raise exception 'Les lignes ne sont modifiables qu''en brouillon.';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_designation, '')), '') is null then
    raise exception 'DÃƒÂ©signation requise.';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'QuantitÃƒÂ© invalide.'; end if;
  if p_unit_price_xof is null or p_unit_price_xof < 0 then raise exception 'Prix unitaire invalide.'; end if;
  select coalesce(max(position), 0) + 1 into v_pos from public.purchase_order_lines where purchase_order_id = p_purchase_order_id;
  insert into public.purchase_order_lines (purchase_order_id, position, designation, quantity, unit, unit_price_xof, notes)
  values (p_purchase_order_id, v_pos, pg_catalog.btrim(p_designation), p_quantity, nullif(pg_catalog.btrim(p_unit), ''),
    p_unit_price_xof, nullif(pg_catalog.btrim(p_notes), ''));
  update public.purchase_orders set
    total_xof = (select coalesce(sum(amount_xof), 0) from public.purchase_order_lines where purchase_order_id = p_purchase_order_id)
  where id = p_purchase_order_id;
end $function$;

create or replace function public.purchase_item_remove(p_item_id uuid) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_order_id uuid;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('achats','update')) then
    raise exception 'permission de modification requise (achats)';
  end if;
  select purchase_order_id into v_order_id from public.purchase_order_lines l
    join public.purchase_orders po on po.id = l.purchase_order_id
  where l.id = p_item_id and po.status = 'draft' for update of po;
  if not found then raise exception 'Ligne introuvable ou commande non modifiable (brouillon seulement).'; end if;
  delete from public.purchase_order_lines where id = p_item_id;
  update public.purchase_orders set
    total_xof = (select coalesce(sum(amount_xof), 0) from public.purchase_order_lines where purchase_order_id = v_order_id)
  where id = v_order_id;
end $function$;

create or replace function public.purchase_set_status(
  p_id uuid, p_status text, p_notes text default null
) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
  v_lines int;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if p_status not in ('draft','submitted','confirmed','sent','partially_received','received','closed','cancelled') then
    raise exception 'Statut d''achat inconnu.';
  end if;
  select po.status into v_status from public.purchase_orders po where po.id = p_id for update;
  if not found then raise exception 'Commande fournisseur introuvable.'; end if;
  if v_status = p_status then raise exception 'La commande est dÃƒÂ©jÃƒÂ  dans ce statut.'; end if;
  if not (
    (v_status = 'draft' and p_status in ('submitted','cancelled'))
    or (v_status = 'submitted' and p_status in ('confirmed','cancelled'))
    or (v_status = 'confirmed' and p_status in ('sent','cancelled'))
    or (v_status = 'sent' and p_status in ('partially_received','received','cancelled'))
    or (v_status = 'partially_received' and p_status in ('received','cancelled'))
    or (v_status = 'received' and p_status in ('closed'))
  ) then
    raise exception 'Transition de statut non autorisÃƒÂ©e (% -> %).', v_status, p_status;
  end if;
  if v_status = 'draft' and p_status = 'submitted' then
    select count(*) into v_lines from public.purchase_order_lines where purchase_order_id = p_id;
    if v_lines = 0 then raise exception 'Au moins une ligne est requise avant la soumission ÃƒÂ  validation.'; end if;
    if not (select private.permits('achats','update')) then
      raise exception 'permission de modification requise (achats)';
    end if;
    update public.purchase_orders set submitted_at = now(), status = 'submitted' where id = p_id;
  elsif p_status = 'confirmed' then
    if not (select private.permits('achats','validate')) then
      raise exception 'Seuls les validateurs peuvent valider une commande fournisseur.';
    end if;
    update public.purchase_orders set confirmed_at = now(), status = 'confirmed' where id = p_id;
  elsif p_status = 'sent' then
    if not (select private.permits('achats','update')) then
      raise exception 'permission de modification requise (achats)';
    end if;
    update public.purchase_orders set sent_at = now(), status = 'sent' where id = p_id;
  elsif p_status = 'closed' then
    if not (select private.permits('achats','validate')) then
      raise exception 'Seuls les validateurs peuvent clÃƒÂ´turer une commande fournisseur.';
    end if;
    update public.purchase_orders set closed_at = now(), status = 'closed' where id = p_id;
  else
    update public.purchase_orders set status = p_status where id = p_id;
  end if;
  insert into public.tender_events (tender_id, actor_id, event_type, details)
  select p.tender_id, v_uid, 'purchase_status', pg_catalog.jsonb_build_object('purchase', p_id, 'status', p_status)
  from public.purchase_orders po
    join public.projects p on p.id = po.project_id
  where po.id = p_id and p.tender_id is not null;
end $function$;

-- Factures fournisseurs
create or replace function public.supplier_invoice_register(
  p_purchase_order_id uuid, p_supplier_invoice_number text, p_invoice_date date,
  p_amount_ht_xof bigint, p_amount_tva_xof bigint, p_amount_ttc_xof bigint, p_notes text default null
) returns uuid
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_invoice uuid;
  v_status text;
  v_already bigint;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('achats','insert')) then
    raise exception 'permission de crÃƒÂ©ation requise (achats)';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_supplier_invoice_number, '')), '') is null then
    raise exception 'NumÃƒÂ©ro de facture du fournisseur requis.';
  end if;
  if p_amount_ht_xof is null or p_amount_ht_xof < 0 then raise exception 'Montant HT invalide.'; end if;
  if p_amount_tva_xof is null or p_amount_tva_xof < 0 then raise exception 'Montant TVA invalide.'; end if;
  if p_amount_ttc_xof is null or p_amount_ttc_xof <> p_amount_ht_xof + p_amount_tva_xof then
    raise exception 'IncohÃƒÂ©rence TTC : TTC doit ÃƒÂªtre ÃƒÂ©gal ÃƒÂ  HT + TVA.';
  end if;
  select po.status into v_status from public.purchase_orders po where po.id = p_purchase_order_id;
  if not found then raise exception 'Commande fournisseur introuvable.'; end if;
  if v_status not in ('sent','partially_received','received','closed') then
    raise exception 'La facture exige une commande envoyÃƒÂ©e ou rÃƒÂ©ceptionnÃƒÂ©e.';
  end if;
  select coalesce(sum(amount_ttc_xof), 0) into v_already from public.supplier_invoices
  where purchase_order_id = p_purchase_order_id and status <> 'rejected';
  if v_already + p_amount_ttc_xof > (select total_xof from public.purchase_orders where id = p_purchase_order_id) then
    raise exception 'Le cumul des factures dÃƒÂ©passe le montant validÃƒÂ© de la commande.';
  end if;
  insert into public.supplier_invoices (purchase_order_id, supplier_invoice_number, invoice_date,
    amount_ht_xof, amount_tva_xof, amount_ttc_xof, status, notes, received_by)
  values (p_purchase_order_id, pg_catalog.btrim(p_supplier_invoice_number), p_invoice_date,
    p_amount_ht_xof, p_amount_tva_xof, p_amount_ttc_xof, 'received', nullif(pg_catalog.btrim(p_notes), ''), v_uid)
  returning id into v_invoice;
  return v_invoice;
end $function$;

-- DÃƒÂ©caissements fournisseurs
create or replace function public.supplier_payment_declare(
  p_supplier_invoice_id uuid, p_amount_xof bigint, p_method text,
  p_reference text default null, p_paid_at timestamptz default null, p_notes text default null
) returns uuid
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_invoice_id uuid;
  v_settled bigint;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('paiements','insert')) then
    raise exception 'permission de dÃƒÂ©claration requise (paiements)';
  end if;
  select si.id into v_invoice_id from public.supplier_invoices si
    join public.purchase_orders po on po.id = si.purchase_order_id
  where si.id = p_supplier_invoice_id and si.status not in ('rejected','disputed');
  if not found then raise exception 'Facture fournisseur introuvable ou contestÃƒÂ©e.'; end if;
  if p_amount_xof is null or p_amount_xof <= 0 then raise exception 'Montant invalide.'; end if;
  if p_method not in ('cash','bank_transfer','mobile_money','cheque') then
    raise exception 'Moyen de paiement inconnu.';
  end if;
  select coalesce(sum(amount_xof), 0) into v_settled from public.supplier_payments
  where supplier_invoice_id = p_supplier_invoice_id and status <> 'rejected';
  if v_settled + p_amount_xof > (select amount_ttc_xof from public.supplier_invoices where id = p_supplier_invoice_id) then
    raise exception 'Le cumul des dÃƒÂ©caissements dÃƒÂ©passe le montant TTC de la facture.';
  end if;
  insert into public.supplier_payments (supplier_invoice_id, amount_xof, method, reference, paid_at, status, notes, created_by)
  values (p_supplier_invoice_id, p_amount_xof, p_method, nullif(pg_catalog.btrim(p_reference), ''),
    coalesce(p_paid_at, now()), 'pending', nullif(pg_catalog.btrim(p_notes), ''), v_uid)
  returning id into v_invoice_id;
  return v_invoice_id;
end $function$;

create or replace function public.supplier_payment_verify(
  p_payment_id uuid, p_accept boolean, p_note text default null
) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_invoice_id uuid;
  v_confirmed bigint;
  v_ttc bigint;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('paiements','validate')) then
    raise exception 'Seuls les vÃƒÂ©rificateurs peuvent confirmer un dÃƒÂ©caissement.';
  end if;
  select supplier_invoice_id into v_invoice_id from public.supplier_payments where id = p_payment_id for update;
  if not found then raise exception 'DÃƒÂ©caissement introuvable.'; end if;
  if p_accept then
    update public.supplier_payments set status = 'confirmed', verified_by = v_uid, verified_at = now(),
      notes = coalesce(nullif(pg_catalog.btrim(p_note), ''), notes)
    where id = p_payment_id;
    select coalesce(sum(amount_xof), 0) into v_confirmed from public.supplier_payments
      where supplier_invoice_id = v_invoice_id and status = 'confirmed';
    select amount_ttc_xof into v_ttc from public.supplier_invoices where id = v_invoice_id;
    update public.supplier_invoices set status = case
      when v_confirmed >= v_ttc then 'paid'
      when v_confirmed > 0 then 'partially_paid'
      else status end
    where id = v_invoice_id;
  else
    update public.supplier_payments set status = 'rejected', verified_by = v_uid, verified_at = now(),
      notes = coalesce(nullif(pg_catalog.btrim(p_note), ''), notes)
    where id = p_payment_id;
  end if;
end $function$;

-- ============ PARTIE 4 Ã¢â‚¬â€ LIVRAISONS / RÃƒâ€°CEPTIONS (RPC LIV) ============

create or replace function public.delivery_schedule(
  p_kind text, p_order_id uuid default null, p_purchase_order_id uuid default null,
  p_planned_at timestamptz default null, p_notes text default null
) returns uuid
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_delivery uuid;
  v_number text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('livraisons','insert')) then
    raise exception 'permission de crÃƒÂ©ation requise (livraisons)';
  end if;
  if p_kind not in ('client_delivery','supplier_reception') then
    raise exception 'Type de mouvement inconnu.';
  end if;
  if p_kind = 'client_delivery' and p_order_id is null then
    raise exception 'Une livraison client exige une commande cliente.';
  end if;
  if p_kind = 'supplier_reception' and p_purchase_order_id is null then
    raise exception 'Une rÃƒÂ©ception fournisseur exige une commande fournisseur.';
  end if;
  v_number := public.next_official_number('liv');
  insert into public.deliveries (delivery_number, kind, order_id, purchase_order_id, status, planned_at, notes, created_by)
  values (v_number, p_kind, p_order_id, p_purchase_order_id, 'planned', p_planned_at,
    nullif(pg_catalog.btrim(p_notes), ''), v_uid)
  returning id into v_delivery;
  return v_delivery;
end $function$;

create or replace function public.delivery_set_status(
  p_id uuid, p_status text, p_delivered_at timestamptz default null,
  p_received_by_name text default null, p_notes text default null
) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_kind text;
  v_po_id uuid;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('livraisons','update')) then
    raise exception 'permission de modification requise (livraisons)';
  end if;
  if p_status not in ('planned','in_transit','delivered','cancelled','partial') then
    raise exception 'Statut de livraison inconnu.';
  end if;
  select kind, purchase_order_id into v_kind, v_po_id from public.deliveries where id = p_id for update;
  if not found then raise exception 'Livraison introuvable.'; end if;
  update public.deliveries set status = p_status,
    delivered_at = case when p_status = 'delivered' then coalesce(p_delivered_at, now()) else delivered_at end,
    received_by_name = coalesce(nullif(pg_catalog.btrim(p_received_by_name), ''), received_by_name),
    notes = coalesce(nullif(pg_catalog.btrim(p_notes), ''), notes)
  where id = p_id;
  -- une rÃƒÂ©ception livrÃƒÂ©e passe l'achat en partiellement reÃƒÂ§u (si encore Ã‚Â« sent Ã‚Â»)
  if v_kind = 'supplier_reception' and p_status = 'delivered' and v_po_id is not null then
    update public.purchase_orders set status = 'partially_received'
    where id = v_po_id and status = 'sent';
  end if;
end $function$;

-- Lignes de rÃƒÂ©ception (suivi partiel par article)
create or replace function public.delivery_line_add(
  p_delivery_id uuid, p_designation text, p_quantity numeric, p_unit text default null,
  p_purchase_line_id uuid default null, p_received_ok boolean default true, p_notes text default null
) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_pos int;
  v_kind text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('livraisons','update')) then
    raise exception 'permission de modification requise (livraisons)';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_designation, '')), '') is null then
    raise exception 'DÃƒÂ©signation requise.';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'QuantitÃƒÂ© invalide.'; end if;
  select kind into v_kind from public.deliveries where id = p_delivery_id;
  if not found then raise exception 'Livraison introuvable.'; end if;
  select coalesce(max(position), 0) + 1 into v_pos from public.delivery_lines where delivery_id = p_delivery_id;
  insert into public.delivery_lines (delivery_id, position, designation, quantity, unit, purchase_line_id, received_ok, notes)
  values (p_delivery_id, v_pos, pg_catalog.btrim(p_designation), p_quantity, nullif(pg_catalog.btrim(p_unit), ''),
    p_purchase_line_id, p_received_ok, nullif(pg_catalog.btrim(p_notes), ''));
end $function$;

-- ============ GRANTS ============

revoke execute on function
  public.project_create_direct(text, uuid, text, bigint, bigint, uuid, date, date, text),
  public.project_update(uuid, text, uuid, uuid, date, date, bigint, bigint, text),
  public.project_step_add(uuid, text, date, text),
  public.project_step_remove(uuid),
  public.project_step_set_status(uuid, text, text),
  public.project_set_progress(uuid, int),
  public.order_item_add(uuid, text, numeric, text, bigint, numeric, text),
  public.order_item_remove(uuid),
  public.order_set_project(uuid, uuid),
  public.purchase_create(uuid, uuid, uuid, timestamptz, text, text, text),
  public.purchase_set_details(uuid, text, timestamptz, text, text),
  public.purchase_item_add(uuid, text, numeric, text, bigint, text),
  public.purchase_item_remove(uuid),
  public.purchase_set_status(uuid, text, text),
  public.supplier_invoice_register(uuid, text, date, bigint, bigint, bigint, text),
  public.supplier_payment_declare(uuid, bigint, text, text, timestamptz, text),
  public.supplier_payment_verify(uuid, boolean, text),
  public.delivery_schedule(text, uuid, uuid, timestamptz, text),
  public.delivery_set_status(uuid, text, timestamptz, text, text),
  public.delivery_line_add(uuid, text, numeric, text, uuid, boolean, text)
from anon, public;

grant execute on function
  public.project_create_direct(text, uuid, text, bigint, bigint, uuid, date, date, text),
  public.project_update(uuid, text, uuid, uuid, date, date, bigint, bigint, text),
  public.project_step_add(uuid, text, date, text),
  public.project_step_remove(uuid),
  public.project_step_set_status(uuid, text, text),
  public.project_set_progress(uuid, int),
  public.order_item_add(uuid, text, numeric, text, bigint, numeric, text),
  public.order_item_remove(uuid),
  public.order_set_project(uuid, uuid),
  public.purchase_create(uuid, uuid, uuid, timestamptz, text, text, text),
  public.purchase_set_details(uuid, text, timestamptz, text, text),
  public.purchase_item_add(uuid, text, numeric, text, bigint, text),
  public.purchase_item_remove(uuid),
  public.purchase_set_status(uuid, text, text),
  public.supplier_invoice_register(uuid, text, date, bigint, bigint, bigint, text),
  public.supplier_payment_declare(uuid, bigint, text, text, timestamptz, text),
  public.supplier_payment_verify(uuid, boolean, text),
  public.delivery_schedule(text, uuid, uuid, timestamptz, text),
  public.delivery_set_status(uuid, text, timestamptz, text, text),
  public.delivery_line_add(uuid, text, numeric, text, uuid, boolean, text)
to authenticated;
