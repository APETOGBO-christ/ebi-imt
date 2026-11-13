-- =============================================================================
-- Migration 29 — Workflows d'écriture des extensions (Phase 3, PROMPT UI)
-- =============================================================================
-- Objectif :
--   Donner aux interfaces Appels d'offres, Projets et Production leurs
--   chemins d'écriture RPC (les tables existent depuis les migrations 20-23
--   mais aucune écriture n'était possible : Phase 3 jamais construite).
--   Numérotation officielle via next_official_number('dao'/'pro'), audit et
--   événements écrits, erreurs explicites en français, permissions via la
--   matrice role_permissions (admin bypass).
-- Tables concernées :
--   Aucune table nouvelle (66 conservées) ; écritures RPC sur tenders,
--   tender_items, tender_quotes, tender_events, projects, production_projects.
-- Dépendances :
--   M16 (private.permits, matrice), M17 (next_official_number), M20 (DAO),
--   M21 (projects), M26 (style RPC + audit), socle (crm_audit_row,
--   set_updated_at, profiles, companies, orders).
-- Risques :
--   - Transitions d'état encadrées : preparing → submitted → won/lost/cancelled
--     ; « gagné » exige permits('appels_offres','validate') (direction/admin)
--     et un montant de marché > 0 ; « perdu » exige un motif.
--   - Lignes et devis du DAO modifiables uniquement en préparation.
--   - production_projects : horodatages automatiques (début/fin réelle),
--     journalisation manuelle (aucun trigger audit sur cette table socle).
-- Retour arrière :
--   Aucun objet destructif : drop des 9 fonctions.
-- =============================================================================

-- 1. Création d'un appel d'offres ----------------------------------------------
create or replace function public.tender_create(
  p_title text, p_organism_company_id uuid, p_submission_deadline timestamptz,
  p_sector text default null, p_source text default null, p_opening_at timestamptz default null,
  p_preparation_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_tender uuid;
  v_number text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('appels_offres','insert')) then
    raise exception 'permission de création requise (appels d''offres)';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_title, '')), '') is null or length(pg_catalog.btrim(p_title)) > 200 then
    raise exception 'Intitulé requis (200 caractères maximum).';
  end if;
  if p_submission_deadline is null then raise exception 'Date limite de remise requise.'; end if;
  if not exists (select 1 from public.companies c where c.id = p_organism_company_id) then
    raise exception 'Organisme (société) inconnu.';
  end if;
  v_number := public.next_official_number('dao');
  insert into public.tenders (tender_number, title, organism_company_id, sector, source,
    submission_deadline, opening_at, preparation_notes, created_by)
  values (v_number, pg_catalog.btrim(p_title), p_organism_company_id,
    nullif(pg_catalog.btrim(p_sector), ''), nullif(pg_catalog.btrim(p_source), ''),
    p_submission_deadline, p_opening_at,
    nullif(pg_catalog.btrim(p_preparation_notes), ''), v_uid)
  returning id into v_tender;
  insert into public.tender_events (tender_id, actor_id, event_type, details)
  values (v_tender, v_uid, 'created', pg_catalog.jsonb_build_object('tender_number', v_number));
  return v_tender;
end $$;
revoke all on function public.tender_create(text, uuid, timestamptz, text, text, timestamptz, text) from public, anon;
grant execute on function public.tender_create(text, uuid, timestamptz, text, text, timestamptz, text) to authenticated;

-- 2. Mise à jour d'un appel d'offres (préparation uniquement) -------------------
create or replace function public.tender_update(
  p_id uuid, p_title text, p_organism_company_id uuid, p_submission_deadline timestamptz,
  p_sector text, p_source text, p_opening_at timestamptz, p_preparation_notes text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('appels_offres','update')) then
    raise exception 'permission de modification requise (appels d''offres)';
  end if;
  perform 1 from public.tenders t
    where t.id = p_id and t.status = 'preparing'
    for update;
  if not found then raise exception 'Seul un appel d''offres en préparation peut être modifié.'; end if;
  if nullif(pg_catalog.btrim(coalesce(p_title, '')), '') is null or length(pg_catalog.btrim(p_title)) > 200 then
    raise exception 'Intitulé requis (200 caractères maximum).';
  end if;
  if p_submission_deadline is null then raise exception 'Date limite de remise requise.'; end if;
  if p_organism_company_id is not null and not exists (
    select 1 from public.companies c where c.id = p_organism_company_id
  ) then raise exception 'Organisme (société) inconnu.'; end if;
  update public.tenders set
    title = pg_catalog.btrim(p_title),
    organism_company_id = coalesce(p_organism_company_id, organism_company_id),
    sector = nullif(pg_catalog.btrim(p_sector), ''),
    source = nullif(pg_catalog.btrim(p_source), ''),
    submission_deadline = p_submission_deadline,
    opening_at = p_opening_at,
    preparation_notes = nullif(pg_catalog.btrim(p_preparation_notes), '')
  where id = p_id;
  insert into public.tender_events (tender_id, actor_id, event_type, details)
  values (p_id, v_uid, 'updated', pg_catalog.jsonb_build_object('via', 'tender_update'));
end $$;
revoke all on function public.tender_update(uuid, text, uuid, timestamptz, text, text, timestamptz, text) from public, anon;
grant execute on function public.tender_update(uuid, text, uuid, timestamptz, text, text, timestamptz, text) to authenticated;

-- 3. Transitions d'état (soumission, issue, annulation) --------------------------
create or replace function public.tender_set_status(
  p_id uuid, p_status text, p_awarded_amount_xof bigint default null, p_lost_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_current text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if p_status not in ('submitted','won','lost','cancelled') then
    raise exception 'État cible inconnu.';
  end if;
  select t.status into v_current from public.tenders t where t.id = p_id for update;
  if not found then raise exception 'Appel d''offres introuvable.'; end if;
  if v_current = 'won' or v_current = 'lost' then
    raise exception 'Cet appel d''offres est déjà clos.';
  end if;
  if not (
    (v_current = 'preparing' and p_status in ('submitted','cancelled'))
    or (v_current = 'submitted' and p_status in ('won','lost','cancelled'))
  ) then
    raise exception 'Transition impossible depuis « % » vers « % ».', v_current, p_status;
  end if;
  if p_status = 'won' then
    if not (select private.permits('appels_offres','validate')) then
      raise exception 'Validation de l''engagement requise (direction).';
    end if;
    if p_awarded_amount_xof is null or p_awarded_amount_xof <= 0 then
      raise exception 'Montant du marché requis (> 0) pour un appel d''offres gagné.';
    end if;
    update public.tenders set status = 'won',
      awarded_amount_xof = p_awarded_amount_xof, awarded_at = now()
    where id = p_id;
  elsif p_status = 'lost' then
    if nullif(pg_catalog.btrim(coalesce(p_lost_reason, '')), '') is null then
      raise exception 'Motif de l''échec requis.';
    end if;
    if not (select private.permits('appels_offres','update')) then
      raise exception 'permission de modification requise (appels d''offres)';
    end if;
    update public.tenders set status = 'lost',
      lost_reason = pg_catalog.btrim(p_lost_reason)
    where id = p_id;
  else
    if not (select private.permits('appels_offres','update')) then
      raise exception 'permission de modification requise (appels d''offres)';
    end if;
    update public.tenders set status = p_status where id = p_id;
  end if;
  insert into public.tender_events (tender_id, actor_id, event_type, details)
  values (p_id, v_uid, 'status_' || p_status,
    pg_catalog.jsonb_build_object('from', v_current, 'to', p_status,
      'awarded_amount_xof', p_awarded_amount_xof));
end $$;
revoke all on function public.tender_set_status(uuid, text, bigint, text) from public, anon;
grant execute on function public.tender_set_status(uuid, text, bigint, text) to authenticated;

-- 4. Lignes du dossier (préparation uniquement) ----------------------------------
create or replace function public.tender_item_add(
  p_tender_id uuid, p_designation text, p_quantity numeric, p_unit text, p_unit_price_xof bigint,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_item uuid;
  v_position integer;
  v_status text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('appels_offres','update')) then
    raise exception 'permission de modification requise (appels d''offres)';
  end if;
  select t.status into v_status from public.tenders t where t.id = p_tender_id for update;
  if not found then raise exception 'Appel d''offres introuvable.'; end if;
  if v_status <> 'preparing' then raise exception 'Le dossier n''est plus en préparation.'; end if;
  if nullif(pg_catalog.btrim(coalesce(p_designation, '')), '') is null then
    raise exception 'Désignation requise.';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantité requise (> 0).'; end if;
  if p_unit_price_xof is null or p_unit_price_xof < 0 then raise exception 'Prix unitaire invalide.'; end if;
  select coalesce(max(position), 0) + 1 into v_position
    from public.tender_items where tender_id = p_tender_id;
  insert into public.tender_items (tender_id, position, designation, quantity, unit,
    unit_price_xof, amount_xof, notes)
  values (p_tender_id, v_position, pg_catalog.btrim(p_designation), p_quantity,
    nullif(pg_catalog.btrim(p_unit), ''), p_unit_price_xof,
    round(p_quantity * p_unit_price_xof)::bigint,
    nullif(pg_catalog.btrim(p_notes), ''))
  returning id into v_item;
  insert into public.tender_events (tender_id, actor_id, event_type, details)
  values (p_tender_id, v_uid, 'item_added',
    pg_catalog.jsonb_build_object('item_id', v_item, 'position', v_position));
  return v_item;
end $$;
revoke all on function public.tender_item_add(uuid, text, numeric, text, bigint, text) from public, anon;
grant execute on function public.tender_item_add(uuid, text, numeric, text, bigint, text) to authenticated;

create or replace function public.tender_item_remove(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_tender uuid;
  v_status text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('appels_offres','update')) then
    raise exception 'permission de modification requise (appels d''offres)';
  end if;
  select i.tender_id, t.status into v_tender, v_status
    from public.tender_items i join public.tenders t on t.id = i.tender_id
    where i.id = p_item_id for update of t;
  if not found then raise exception 'Ligne introuvable.'; end if;
  if v_status <> 'preparing' then raise exception 'Le dossier n''est plus en préparation.'; end if;
  delete from public.tender_items where id = p_item_id;
  insert into public.tender_events (tender_id, actor_id, event_type, details)
  values (v_tender, v_uid, 'item_removed', pg_catalog.jsonb_build_object('item_id', p_item_id));
end $$;
revoke all on function public.tender_item_remove(uuid) from public, anon;
grant execute on function public.tender_item_remove(uuid) to authenticated;

-- 5. Devis fournisseur par ligne (préparation uniquement) -------------------------
create or replace function public.tender_quote_set(
  p_tender_item_id uuid, p_supplier_company_id uuid, p_quote_xof bigint,
  p_source text default null, p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_tender uuid;
  v_status text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('appels_offres','update')) then
    raise exception 'permission de modification requise (appels d''offres)';
  end if;
  select i.tender_id, t.status into v_tender, v_status
    from public.tender_items i join public.tenders t on t.id = i.tender_id
    where i.id = p_tender_item_id for update of t;
  if not found then raise exception 'Ligne introuvable.'; end if;
  if v_status <> 'preparing' then raise exception 'Le dossier n''est plus en préparation.'; end if;
  if p_quote_xof is null or p_quote_xof < 0 then raise exception 'Montant du devis invalide.'; end if;
  if not exists (select 1 from public.companies c where c.id = p_supplier_company_id) then
    raise exception 'Fournisseur (société) inconnu.';
  end if;
  insert into public.tender_quotes (tender_id, tender_item_id, supplier_company_id, quote_xof, source, notes, created_by)
  values (v_tender, p_tender_item_id, p_supplier_company_id, p_quote_xof,
    nullif(pg_catalog.btrim(p_source), ''), nullif(pg_catalog.btrim(p_notes), ''), v_uid)
  on conflict (tender_item_id, supplier_company_id) do update
    set quote_xof = excluded.quote_xof, source = excluded.source, notes = excluded.notes;
  insert into public.tender_events (tender_id, actor_id, event_type, details)
  values (v_tender, v_uid, 'quote_set',
    pg_catalog.jsonb_build_object('item_id', p_tender_item_id, 'supplier', p_supplier_company_id, 'quote_xof', p_quote_xof));
end $$;
revoke all on function public.tender_quote_set(uuid, uuid, bigint, text, text) from public, anon;
grant execute on function public.tender_quote_set(uuid, uuid, bigint, text, text) to authenticated;

-- 6. Création d'un projet d'exécution (typiquement après un DAO gagné) ------------
create or replace function public.project_create(
  p_title text, p_client_company_id uuid, p_tender_id uuid default null,
  p_manager_id uuid default null, p_budget_xof bigint default null,
  p_start_date date default null, p_planned_end_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_project uuid;
  v_number text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('projets','insert')) then
    raise exception 'permission de création requise (projets)';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_title, '')), '') is null or length(pg_catalog.btrim(p_title)) > 200 then
    raise exception 'Intitulé requis (200 caractères maximum).';
  end if;
  if not exists (select 1 from public.companies c where c.id = p_client_company_id) then
    raise exception 'Client (société) inconnu.';
  end if;
  if p_tender_id is not null and not exists (
    select 1 from public.tenders t where t.id = p_tender_id and t.status = 'won'
  ) then raise exception 'Seul un appel d''offres gagné peut donner un projet.'; end if;
  v_number := public.next_official_number('pro');
  insert into public.projects (project_number, title, client_company_id, tender_id, manager_id,
    budget_xof, start_date, planned_end_date, created_by)
  values (v_number, pg_catalog.btrim(p_title), p_client_company_id, p_tender_id, p_manager_id,
    p_budget_xof, p_start_date, p_planned_end_date, v_uid)
  returning id into v_project;
  return v_project;
end $$;
revoke all on function public.project_create(text, uuid, uuid, uuid, bigint, date, date) from public, anon;
grant execute on function public.project_create(text, uuid, uuid, uuid, bigint, date, date) to authenticated;

-- 7. Transition d'état d'un projet ------------------------------------------------
create or replace function public.project_set_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_current text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if p_status not in ('planned','in_progress','suspended','completed','cancelled') then
    raise exception 'État cible inconnu.';
  end if;
  select p.status into v_current from public.projects p where p.id = p_id for update;
  if not found then raise exception 'Projet introuvable.'; end if;
  if v_current = 'completed' or v_current = 'cancelled' then
    raise exception 'Ce projet est déjà clos.';
  end if;
  if not (select private.permits('projets','update')) then
    raise exception 'permission de modification requise (projets)';
  end if;
  if p_status = 'completed' then
    update public.projects set status = 'completed', actual_end_date = current_date where id = p_id;
  else
    update public.projects set status = p_status where id = p_id;
  end if;
end $$;
revoke all on function public.project_set_status(uuid, text) from public, anon;
grant execute on function public.project_set_status(uuid, text) to authenticated;

-- 8. Mise à jour de la production d'une commande ----------------------------------
create or replace function public.production_update(
  p_production_id uuid, p_status text default null, p_responsible_id uuid default null,
  p_notes text default null, p_planned_delivery_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_order uuid;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('commandes','update')) then
    raise exception 'permission de modification requise (commandes)';
  end if;
  if p_status is not null and p_status::text not in
    ('not_started','in_progress','blocked','ready_for_delivery','delivered','cancelled') then
    raise exception 'État de production inconnu.';
  end if;
  select o.order_id into v_order from public.production_projects o where o.id = p_production_id for update;
  if not found then raise exception 'Suivi de production introuvable.'; end if;
  update public.production_projects set
    status = coalesce(p_status, status),
    responsible_id = coalesce(p_responsible_id, responsible_id),
    notes = coalesce(p_notes, notes),
    planned_delivery_at = coalesce(p_planned_delivery_at, planned_delivery_at),
    actual_start_at = case when p_status = 'in_progress' and actual_start_at is null then now() else actual_start_at end,
    actual_delivery_at = case when p_status = 'delivered' and actual_delivery_at is null then now() else actual_delivery_at end
  where id = p_production_id;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values (v_uid, 'production_updated', 'production_projects', p_production_id,
    pg_catalog.jsonb_build_object('status', p_status));
end $$;
revoke all on function public.production_update(uuid, text, uuid, text, timestamptz) from public, anon;
grant execute on function public.production_update(uuid, text, uuid, text, timestamptz) to authenticated;
