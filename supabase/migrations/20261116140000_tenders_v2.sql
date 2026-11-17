-- PROMPT 6 : statuts complÃ©mentaires (En analyse, DÃ©cision de soumission, En validation, AbandonnÃ©),
-- lien annonce + lieu de dÃ©pÃ´t, caractÃ©ristiques d'articles, comparaison fournisseurs enrichie,
-- fournisseur retenu justifiÃ©. Toutes les transitions restent historisÃ©es (tender_events).

alter table public.tenders add column announcement_url text;
alter table public.tenders add column submission_location text;
alter table public.tenders add constraint tenders_announcement_url_check
  check (announcement_url is null or announcement_url = '' or announcement_url ilike 'https://%');
alter table public.tenders add constraint tenders_submission_location_check
  check (submission_location is null or length(btrim(submission_location)) <= 200);

alter table public.tenders drop constraint if exists tenders_status_check;
alter table public.tenders add constraint tenders_status_check
  check (status = any (array['identifie'::text, 'a_analyser'::text, 'en_analyse'::text,
    'decision_soumission'::text, 'en_preparation'::text, 'en_validation'::text,
    'attente_documents'::text, 'pret_deposer'::text, 'depose'::text, 'en_evaluation'::text,
    'gagne'::text, 'perdu'::text, 'annule'::text, 'abandonne'::text]));

alter table public.tender_items add column item_category text default 'equipement';
alter table public.tender_items add constraint tender_items_category_check
  check (item_category in ('equipement'::text, 'prestation'::text));
alter table public.tender_items add column specs text;
alter table public.tender_items add column selected_supplier_company_id uuid
  references public.companies (id) on delete set null;
alter table public.tender_items add column selected_reason text;

alter table public.tender_quotes add column brand_model text;
alter table public.tender_quotes add column transport_cost_xof bigint not null default 0;
alter table public.tender_quotes add column lead_time_days integer;
alter table public.tender_quotes add column warranty_months integer;
alter table public.tender_quotes add column availability text;
alter table public.tender_quotes add constraint tender_quotes_availability_check
  check (availability is null or availability in ('en_stock'::text, 'a_commander'::text, 'sur_devis'::text));
alter table public.tender_quotes add column quote_document_id uuid
  references public.documents (id) on delete set null;
alter table public.tender_quotes add constraint tender_quotes_transport_check
  check (transport_cost_xof >= 0);
alter table public.tender_quotes add constraint tender_quotes_lead_time_check
  check (lead_time_days is null or lead_time_days >= 0);
alter table public.tender_quotes add constraint tender_quotes_warranty_check
  check (warranty_months is null or warranty_months >= 0);

-- Item/quote : les nouveaux statuts prÃ©-dÃ©pÃ´t acceptent l'Ã©dition (miroir de tender_set_status).
create or replace function public.tender_item_add(
  p_tender_id uuid, p_designation text, p_quantity numeric, p_unit text,
  p_unit_price_xof bigint, p_notes text default null, p_offer_template_id uuid default null,
  p_item_category text default 'equipement', p_specs text default null
) returns uuid
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
  v_max int;
  v_id uuid;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('appels_offres', 'update')) then
    raise exception 'permission de modification requise (appels d''offres)';
  end if;
  select t.status into v_status from public.tenders t where t.id = p_tender_id;
  if v_status not in ('identifie','a_analyser','en_analyse','decision_soumission',
    'en_preparation','en_validation','attente_documents','pret_deposer') then
    raise exception 'Lignes modifiables uniquement avant le dÃ©pÃ´t (statut : %).', v_status;
  end if;
  if p_item_category not in ('equipement','prestation') then
    raise exception 'CatÃ©gorie de ligne inconnue (Ã©quipement ou prestation).';
  end if;
  select coalesce(max(position), 0) + 1 into v_max
    from public.tender_items where tender_id = p_tender_id;
  insert into public.tender_items (tender_id, position, offer_template_id, designation,
    quantity, unit, unit_price_xof, amount_xof, notes, item_category, specs)
  values (p_tender_id, v_max, p_offer_template_id, p_designation,
    p_quantity, p_unit, p_unit_price_xof, round(p_quantity * p_unit_price_xof)::bigint, p_notes,
    p_item_category, p_specs)
  returning id into v_id;
  insert into public.tender_events (tender_id, actor_id, event_type, details)
  values (p_tender_id, v_uid, 'item_added',
    pg_catalog.jsonb_build_object('item', v_id, 'designation', p_designation));
  return v_id;
end $function$;

create or replace function public.tender_quote_set(
  p_tender_item_id uuid, p_supplier_company_id uuid, p_quote_xof bigint,
  p_source text, p_notes text,
  p_brand_model text default null, p_transport_cost_xof bigint default 0,
  p_lead_time_days integer default null, p_warranty_months integer default null,
  p_availability text default null, p_quote_document_id uuid default null
) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_tender uuid;
  v_status text;
  v_old bigint;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('appels_offres', 'update')) then
    raise exception 'permission de modification requise (appels d''offres)';
  end if;
  select i.tender_id, t.status into v_tender, v_status
    from public.tender_items i join public.tenders t on t.id = i.tender_id
    where i.id = p_tender_item_id;
  if v_tender is null then raise exception 'Ligne introuvable.'; end if;
  if v_status not in ('identifie','a_analyser','en_analyse','decision_soumission',
    'en_preparation','en_validation','attente_documents','pret_deposer') then
    raise exception 'Devis modifiables uniquement avant le dÃ©pÃ´t (statut : %).', v_status;
  end if;
  if p_quote_xof is null or p_quote_xof <= 0 then
    raise exception 'Montant du devis requis (> 0).';
  end if;
  if p_availability is not null and p_availability not in ('en_stock','a_commander','sur_devis') then
    raise exception 'DisponibilitÃ© inconnue.';
  end if;
  select quote_xof into v_old from public.tender_quotes
    where tender_item_id = p_tender_item_id and supplier_company_id = p_supplier_company_id;
  if v_old is not null then
    update public.tender_quotes set quote_xof = p_quote_xof, source = p_source, notes = p_notes,
      brand_model = p_brand_model, transport_cost_xof = coalesce(p_transport_cost_xof, 0),
      lead_time_days = p_lead_time_days, warranty_months = p_warranty_months,
      availability = p_availability, quote_document_id = p_quote_document_id
    where tender_item_id = p_tender_item_id and supplier_company_id = p_supplier_company_id;
  else
    insert into public.tender_quotes (tender_item_id, supplier_company_id, quote_xof, source,
      notes, brand_model, transport_cost_xof, lead_time_days, warranty_months, availability,
      quote_document_id, created_by)
    values (p_tender_item_id, p_supplier_company_id, p_quote_xof, p_source, p_notes,
      p_brand_model, coalesce(p_transport_cost_xof, 0), p_lead_time_days, p_warranty_months,
      p_availability, p_quote_document_id, v_uid);
  end if;
  insert into public.tender_events (tender_id, actor_id, event_type, details)
  values (v_tender, v_uid, 'quote_set',
    pg_catalog.jsonb_build_object('item', p_tender_item_id, 'supplier', p_supplier_company_id,
      'quote_xof', p_quote_xof, 'previous', v_old));
end $function$;

create or replace function public.tender_item_select_supplier(
  p_tender_item_id uuid, p_supplier_company_id uuid, p_reason text
) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_tender uuid;
  v_status text;
  v_has_quote boolean;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('appels_offres', 'update')) then
    raise exception 'permission de modification requise (appels d''offres)';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Justification du fournisseur retenu requise.';
  end if;
  select i.tender_id, t.status into v_tender, v_status
    from public.tender_items i join public.tenders t on t.id = i.tender_id
    where i.id = p_tender_item_id;
  if v_tender is null then raise exception 'Ligne introuvable.'; end if;
  if v_status not in ('identifie','a_analyser','en_analyse','decision_soumission',
    'en_preparation','en_validation','attente_documents','pret_deposer') then
    raise exception 'SÃ©lection possible uniquement avant le dÃ©pÃ´t (statut : %).', v_status;
  end if;
  select true into v_has_quote from public.tender_quotes
    where tender_item_id = p_tender_item_id and supplier_company_id = p_supplier_company_id;
  if not coalesce(v_has_quote, false) then
    raise exception 'Aucun devis de ce fournisseur pour cette ligne.';
  end if;
  update public.tender_items set selected_supplier_company_id = p_supplier_company_id,
    selected_reason = pg_catalog.btrim(p_reason)
  where id = p_tender_item_id;
  insert into public.tender_events (tender_id, actor_id, event_type, details)
  values (v_tender, v_uid, 'supplier_selected',
    pg_catalog.jsonb_build_object('item', p_tender_item_id, 'supplier', p_supplier_company_id,
      'reason', pg_catalog.btrim(p_reason)));
end $function$;

-- Transitions : 12 statuts du cycle DAO, historisation inchangÃ©e.
create or replace function public.tender_set_status(p_id uuid, p_status text,
  p_awarded_amount_xof bigint default null, p_lost_reason text default null
) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_current text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if p_status not in ('identifie','a_analyser','en_analyse','decision_soumission',
    'en_preparation','en_validation','attente_documents','pret_deposer',
    'depose','en_evaluation','gagne','perdu','annule','abandonne') then
    raise exception 'Ã‰tat cible inconnu.';
  end if;
  select t.status into v_current from public.tenders t where t.id = p_id for update;
  if not found then raise exception 'Appel d''offres introuvable.'; end if;
  if v_current in ('gagne','perdu','annule','abandonne') then
    raise exception 'Cet appel d''offres est dÃ©jÃ  clos.';
  end if;
  if not (
    (v_current in ('identifie','a_analyser')
      and (p_status in ('en_analyse','en_preparation','attente_documents','pret_deposer','depose','annule','abandonne')))
    or (v_current = 'en_analyse'
      and (p_status in ('decision_soumission','en_preparation','attente_documents','pret_deposer','depose','annule','abandonne')))
    or (v_current = 'decision_soumission'
      and (p_status in ('en_preparation','en_validation','attente_documents','pret_deposer','depose','annule','abandonne')))
    or (v_current = 'en_preparation'
      and (p_status in ('en_validation','attente_documents','pret_deposer','depose','annule','abandonne')))
    or (v_current = 'en_validation'
      and (p_status in ('attente_documents','pret_deposer','depose','annule','abandonne')))
    or (v_current = 'attente_documents'
      and (p_status in ('en_preparation','en_validation','pret_deposer','depose','annule','abandonne')))
    or (v_current = 'pret_deposer'
      and (p_status in ('depose','annule','abandonne')))
    or (v_current = 'depose'
      and (p_status in ('en_evaluation','gagne','perdu','annule')))
    or (v_current = 'en_evaluation'
      and (p_status in ('gagne','perdu','annule')))
  ) then
    raise exception 'Transition impossible depuis Â« % Â» vers Â« % Â».', v_current, p_status;
  end if;
  if p_status = 'gagne' then
    if not (select private.permits('appels_offres','validate')) then
      raise exception 'Validation de l''engagement requise (direction).';
    end if;
    if coalesce(p_awarded_amount_xof, (select t2.our_amount_xof from public.tenders t2 where t2.id = p_id)) is null
      or coalesce(p_awarded_amount_xof, (select t2.our_amount_xof from public.tenders t2 where t2.id = p_id)) <= 0 then
      raise exception 'Montant du marchÃ© requis (> 0) pour un appel d''offres gagnÃ©.';
    end if;
    update public.tenders set status = 'gagne',
      awarded_amount_xof = coalesce(p_awarded_amount_xof, our_amount_xof), awarded_at = now()
    where id = p_id;
  elsif p_status = 'perdu' then
    if nullif(pg_catalog.btrim(coalesce(p_lost_reason, '')), '') is null then
      raise exception 'Motif de l''Ã©chec requis.';
    end if;
    if not (select private.permits('appels_offres','update')) then
      raise exception 'permission de modification requise (appels d''offres)';
    end if;
    update public.tenders set status = 'perdu',
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
      'awarded_amount_xof', coalesce(p_awarded_amount_xof, (select t2.our_amount_xof from public.tenders t2 where t2.id = p_id))));
end $function$;
