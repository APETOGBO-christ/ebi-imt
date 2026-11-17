-- PROMPT 6 : lien vers l'annonce + lieu/plateforme de dÃ©pÃ´t dans create/update.
-- Les deux fonctions gagnent deux arguments optionnels (rÃ©trocompatibles).

create or replace function public.tender_create(
  p_title text, p_organism_company_id uuid, p_submission_deadline timestamptz,
  p_sector text default null, p_source text default null, p_opening_at timestamptz default null,
  p_observations text default null, p_description text default null,
  p_publication_date date default null, p_estimated_amount_xof bigint default null,
  p_our_amount_xof bigint default null, p_responsible_id uuid default null,
  p_announcement_url text default null, p_submission_location text default null
) returns uuid
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_tender uuid;
  v_number text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('appels_offres','insert')) then
    raise exception 'permission de crÃ©ation requise (appels d''offres)';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_title, '')), '') is null or length(pg_catalog.btrim(p_title)) > 200 then
    raise exception 'IntitulÃ© requis (200 caractÃ¨res maximum).';
  end if;
  if p_submission_deadline is null then raise exception 'Date limite de remise requise.'; end if;
  if not exists (select 1 from public.companies c where c.id = p_organism_company_id) then
    raise exception 'Organisme (sociÃ©tÃ©) inconnu.';
  end if;
  if p_estimated_amount_xof is not null and p_estimated_amount_xof < 0 then
    raise exception 'Montant estimatif invalide.';
  end if;
  if p_our_amount_xof is not null and p_our_amount_xof < 0 then
    raise exception 'Montant de notre offre invalide.';
  end if;
  if p_responsible_id is not null and not exists (
    select 1 from public.profiles pr where pr.id = p_responsible_id and pr.is_active
  ) then raise exception 'Responsable interne inconnu ou inactif.'; end if;
  if p_announcement_url is not null and p_announcement_url not like 'https://%' then
    raise exception 'Lien d''annonce invalide (https requis).';
  end if;
  v_number := public.next_official_number('dao');
  insert into public.tenders (tender_number, title, organism_company_id, sector, source,
    submission_deadline, opening_at, observations, description, publication_date,
    estimated_amount_xof, our_amount_xof, responsible_id, created_by,
    announcement_url, submission_location)
  values (v_number, pg_catalog.btrim(p_title), p_organism_company_id,
    nullif(pg_catalog.btrim(p_sector), ''), nullif(pg_catalog.btrim(p_source), ''),
    p_submission_deadline, p_opening_at,
    nullif(pg_catalog.btrim(p_observations), ''), nullif(pg_catalog.btrim(p_description), ''),
    p_publication_date, p_estimated_amount_xof, p_our_amount_xof, p_responsible_id, v_uid,
    nullif(pg_catalog.btrim(p_announcement_url), ''),
    nullif(pg_catalog.btrim(p_submission_location), ''))
  returning id into v_tender;
  insert into public.tender_events (tender_id, actor_id, event_type, details)
  values (v_tender, v_uid, 'created', pg_catalog.jsonb_build_object('tender_number', v_number));
  return v_tender;
end $function$;

create or replace function public.tender_update(
  p_id uuid, p_title text, p_organism_company_id uuid, p_submission_deadline timestamptz,
  p_sector text, p_source text, p_opening_at timestamptz, p_observations text,
  p_description text, p_publication_date date, p_estimated_amount_xof bigint,
  p_our_amount_xof bigint, p_responsible_id uuid,
  p_announcement_url text default null, p_submission_location text default null
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
  if not (select private.permits('appels_offres','update')) then
    raise exception 'permission de modification requise (appels d''offres)';
  end if;
  select t.status into v_status from public.tenders t where t.id = p_id for update;
  if not found then raise exception 'Appel d''offres introuvable.'; end if;
  if v_status in ('gagne','perdu','annule','abandonne') then
    raise exception 'Cet appel d''offres est clos : ses informations ne sont plus modifiables.';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_title, '')), '') is null or length(pg_catalog.btrim(p_title)) > 200 then
    raise exception 'IntitulÃ© requis (200 caractÃ¨res maximum).';
  end if;
  if p_submission_deadline is null then raise exception 'Date limite de remise requise.'; end if;
  if p_organism_company_id is not null and not exists (
    select 1 from public.companies c where c.id = p_organism_company_id
  ) then raise exception 'Organisme (sociÃ©tÃ©) inconnu.'; end if;
  if p_estimated_amount_xof is not null and p_estimated_amount_xof < 0 then
    raise exception 'Montant estimatif invalide.';
  end if;
  if p_our_amount_xof is not null and p_our_amount_xof < 0 then
    raise exception 'Montant de notre offre invalide.';
  end if;
  if p_responsible_id is not null and not exists (
    select 1 from public.profiles pr where pr.id = p_responsible_id and pr.is_active
  ) then raise exception 'Responsable interne inconnu ou inactif.'; end if;
  if p_announcement_url is not null and p_announcement_url not like 'https://%' then
    raise exception 'Lien d''annonce invalide (https requis).';
  end if;
  update public.tenders set
    title = pg_catalog.btrim(p_title),
    organism_company_id = coalesce(p_organism_company_id, organism_company_id),
    sector = nullif(pg_catalog.btrim(p_sector), ''),
    source = nullif(pg_catalog.btrim(p_source), ''),
    submission_deadline = p_submission_deadline,
    opening_at = p_opening_at,
    observations = nullif(pg_catalog.btrim(p_observations), ''),
    description = nullif(pg_catalog.btrim(p_description), ''),
    publication_date = p_publication_date,
    estimated_amount_xof = p_estimated_amount_xof,
    our_amount_xof = p_our_amount_xof,
    responsible_id = p_responsible_id,
    announcement_url = nullif(pg_catalog.btrim(p_announcement_url), ''),
    submission_location = nullif(pg_catalog.btrim(p_submission_location), '')
  where id = p_id;
  insert into public.tender_events (tender_id, actor_id, event_type, details)
  values (p_id, v_uid, 'updated', pg_catalog.jsonb_build_object('via', 'tender_update'));
end $function$;
