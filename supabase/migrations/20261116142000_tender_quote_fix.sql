-- Correctif PROMPT 6 : tender_quote_set doit renseigner tender_id (NOT NULL),
-- dÃ©rivÃ© de la ligne concernÃ©e, et vÃ©rifier l'existence de la ligne.

create or replace function public.tender_quote_set(
  p_tender_item_id uuid, p_supplier_company_id uuid, p_quote_xof bigint,
  p_source text default null, p_notes text default null,
  p_brand_model text default null, p_transport_cost_xof bigint default null,
  p_lead_time_days integer default null, p_warranty_months integer default null,
  p_availability text default null, p_quote_document_id uuid default null
) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_tender_id uuid;
  v_status text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('appels_offres','update')) then
    raise exception 'permission de modification requise (appels d''offres)';
  end if;
  if p_quote_xof is null or p_quote_xof < 0 then
    raise exception 'Montant du devis invalide.';
  end if;
  select ti.tender_id, t.status into v_tender_id, v_status
  from public.tender_items ti join public.tenders t on t.id = ti.tender_id
  where ti.id = p_tender_item_id for update of t;
  if not found then raise exception 'Ligne du dossier introuvable.'; end if;
  if v_status in ('depose','en_evaluation','gagne','perdu','annule','abandonne') then
    raise exception 'Le dossier est clos ou dÃ©jÃ  dÃ©posÃ© : les devis ne sont plus modifiables.';
  end if;
  if p_transport_cost_xof is not null and p_transport_cost_xof < 0 then
    raise exception 'CoÃ»t de transport invalide.';
  end if;
  if p_lead_time_days is not null and p_lead_time_days < 0 then
    raise exception 'DÃ©lai de livraison invalide.';
  end if;
  if p_warranty_months is not null and p_warranty_months < 0 then
    raise exception 'DurÃ©e de garantie invalide.';
  end if;
  if p_availability is not null and p_availability not in ('en_stock','a_commander','sur_devis') then
    raise exception 'DisponibilitÃ© inconnue.';
  end if;
  if p_quote_document_id is not null and not exists (
    select 1 from public.documents d where d.id = p_quote_document_id
  ) then raise exception 'Devis joint introuvable dans la bibliothÃ¨que.'; end if;
  if not exists (select 1 from public.companies c where c.id = p_supplier_company_id) then
    raise exception 'Fournisseur (sociÃ©tÃ©) inconnu.';
  end if;
  insert into public.tender_quotes (tender_id, tender_item_id, supplier_company_id, quote_xof, source,
    notes, brand_model, transport_cost_xof, lead_time_days, warranty_months, availability,
    quote_document_id, created_by)
  values (v_tender_id, p_tender_item_id, p_supplier_company_id, p_quote_xof, nullif(pg_catalog.btrim(p_source), ''),
    nullif(pg_catalog.btrim(p_notes), ''), nullif(pg_catalog.btrim(p_brand_model), ''),
    coalesce(p_transport_cost_xof, 0), p_lead_time_days, p_warranty_months, p_availability,
    p_quote_document_id, v_uid)
  on conflict (tender_item_id, supplier_company_id)
  do update set quote_xof = excluded.quote_xof, source = excluded.source, notes = excluded.notes,
    brand_model = excluded.brand_model, transport_cost_xof = excluded.transport_cost_xof,
    lead_time_days = excluded.lead_time_days, warranty_months = excluded.warranty_months,
    availability = excluded.availability, quote_document_id = excluded.quote_document_id;
  insert into public.tender_events (tender_id, actor_id, event_type, details)
  values (v_tender_id, v_uid, 'quote_set', pg_catalog.jsonb_build_object('item', p_tender_item_id, 'supplier', p_supplier_company_id, 'quote_xof', p_quote_xof));
end $function$;
