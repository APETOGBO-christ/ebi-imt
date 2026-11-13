-- =============================================================================
-- Migration 30 — Expansion du module Appels d'offres (cahier des charges EBI-IMT)
-- =============================================================================
-- Objectif :
--   Porter le module Appels d'offres au cahier des charges complet :
--   champs étendus (description, publication, montant estimatif, montant de
--   notre offre, responsable interne, observations), cycle de vie en 10 états
--   (identifié → annulé), documents par catégorie (rattachés à la bibliothèque
--   via document_links + registre par catégorie), suivi (tâches, rappels,
--   commentaires), relations (commandes et propositions rattachées) et
--   historique conservé (tender_events).
-- Tables concernées :
--   tenders (colonnes nouvelles, statuts), tender_documents (nouvelle),
--   tender_tasks (nouvelle), tender_reminders (nouvelle), tender_comments
--   (nouvelle), orders (tender_id), commercial_proposals (tender_id).
-- Dépendances :
--   M16 (private.permits, private.current_role_code), M17 (next_official_number),
--   M20 (tenders/tender_items/tender_quotes/tender_events), M21 (projects),
--   M27 (documents, private.can_manage_all), M29 (RPC remplacées ici).
-- Risques :
--   - Remappage des statuts existants (preparing→en_preparation, submitted→
--     depose, won→gagne, lost→perdu, cancelled→annule) AVANT la nouvelle
--     contrainte ; aucune donnée supprimée.
--   - tender_events historiques conservés tels quels (labels UI rétrocompatibles).
--   - Les RPC remplacées conservent les mêmes contrôles (permits, audit,
--     événements) avec les nouvelles règles de transition.
-- Retour arrière :
--   - alter table tenders drop column description, publication_date,
--     estimated_amount_xof, our_amount_xof, responsible_id ;
--     rename column observations to preparation_notes ;
--   - restaurer l'ancienne contrainte de statuts ;
--   - drop tables tender_documents, tender_tasks, tender_reminders, tender_comments ;
--   - alter table orders / commercial_proposals drop column tender_id ;
--   - drop des fonctions créées/remplacées.
-- =============================================================================

-- 1. Colonnes étendues sur tenders ---------------------------------------------
alter table public.tenders rename column preparation_notes to observations;
alter table public.tenders
  add column description text,
  add column publication_date date,
  add column estimated_amount_xof bigint check (estimated_amount_xof is null or estimated_amount_xof >= 0),
  add column our_amount_xof bigint check (our_amount_xof is null or our_amount_xof >= 0),
  add column responsible_id uuid references public.profiles(id);

-- 2. Cycle de vie en 10 états ----------------------------------------------------
--     identifie → a_analyser → en_preparation → attente_documents →
--     pret_deposer → depose → en_evaluation → gagne / perdu ; annule possible
--     tant que le dossier n'est pas clos.
alter table public.tenders drop constraint tenders_status_check;
update public.tenders set status = case status
  when 'preparing' then 'en_preparation'
  when 'submitted' then 'depose'
  when 'won' then 'gagne'
  when 'lost' then 'perdu'
  else 'annule'
end;
alter table public.tenders add constraint tenders_status_check
  check (status in ('identifie','a_analyser','en_preparation','attente_documents',
    'pret_deposer','depose','en_evaluation','gagne','perdu','annule'));

-- 3. Suivi : tâches, rappels, commentaires ---------------------------------------
create table public.tender_tasks (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.tenders(id) on delete cascade,
  title text not null,
  due_date date,
  assignee_id uuid references public.profiles(id),
  is_done boolean not null default false,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.tender_reminders (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.tenders(id) on delete cascade,
  remind_at timestamptz not null,
  note text,
  is_done boolean not null default false,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.tender_comments (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.tenders(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id),
  body text not null check (length(pg_catalog.btrim(body)) > 0),
  created_at timestamptz not null default now()
);

-- 4. Documents du dossier : registre par catégorie, stocké en bibliothèque -------
--    Le fichier reste un document de la bibliothèque (versions, hachage,
--    réconciliation) ; tender_documents porte la catégorie métier du dossier.
create table public.tender_documents (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.tenders(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  category text not null check (category in ('dao','pieces_administratives','offre_technique',
    'offre_financiere','devis_fournisseurs','justificatifs','correspondances',
    'proces_verbaux','resultats')),
  title text not null,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (document_id, tender_id)
);

-- 5. Relations : commandes et propositions rattachées ----------------------------
alter table public.orders add column tender_id uuid references public.tenders(id);
alter table public.commercial_proposals add column tender_id uuid references public.tenders(id);
create index orders_tender_idx on public.orders(tender_id) where tender_id is not null;
create index commercial_proposals_tender_idx on public.commercial_proposals(tender_id) where tender_id is not null;
create index tenders_status_idx on public.tenders(status);
create index tenders_deadline_idx on public.tenders(submission_deadline);
create index tender_documents_tender_idx on public.tender_documents(tender_id);
create index tender_tasks_tender_idx on public.tender_tasks(tender_id);
create index tender_reminders_tender_idx on public.tender_reminders(tender_id);
create index tender_comments_tender_idx on public.tender_comments(tender_id);

-- 6. Sécurité des tables nouvelles (profil actif requis, modèle M27) --------------
alter table public.tender_tasks enable row level security;
alter table public.tender_reminders enable row level security;
alter table public.tender_comments enable row level security;
alter table public.tender_documents enable row level security;
create policy tender_tasks_select on public.tender_tasks for select to authenticated
  using ((select private.current_role_code()) is not null);
create policy tender_tasks_insert on public.tender_tasks for insert to authenticated
  with check ((select private.current_role_code()) is not null);
create policy tender_tasks_update on public.tender_tasks for update to authenticated
  using ((select private.current_role_code()) is not null)
  with check ((select private.current_role_code()) is not null);
create policy tender_tasks_delete on public.tender_tasks for delete to authenticated
  using ((select private.current_role_code()) is not null);
create policy tender_reminders_select on public.tender_reminders for select to authenticated
  using ((select private.current_role_code()) is not null);
create policy tender_reminders_insert on public.tender_reminders for insert to authenticated
  with check ((select private.current_role_code()) is not null);
create policy tender_reminders_update on public.tender_reminders for update to authenticated
  using ((select private.current_role_code()) is not null)
  with check ((select private.current_role_code()) is not null);
create policy tender_reminders_delete on public.tender_reminders for delete to authenticated
  using ((select private.current_role_code()) is not null);
create policy tender_comments_select on public.tender_comments for select to authenticated
  using ((select private.current_role_code()) is not null);
create policy tender_comments_insert on public.tender_comments for insert to authenticated
  with check ((select private.current_role_code()) is not null);
create policy tender_comments_delete on public.tender_comments for delete to authenticated
  using ((select private.current_role_code()) is not null);
create policy tender_documents_select on public.tender_documents for select to authenticated
  using ((select private.current_role_code()) is not null);
create policy tender_documents_insert on public.tender_documents for insert to authenticated
  with check ((select private.current_role_code()) is not null);
create policy tender_documents_delete on public.tender_documents for delete to authenticated
  using ((select private.current_role_code()) is not null);
revoke all on public.tender_tasks, public.tender_reminders, public.tender_comments,
  public.tender_documents from anon, public;
grant select, insert, update, delete on public.tender_tasks, public.tender_reminders,
  public.tender_comments, public.tender_documents to authenticated;

-- 7. RPC remises au cahier des charges -------------------------------------------

-- 7.a Création -------------------------------------------------------------------
drop function if exists public.tender_create(text, uuid, timestamptz, text, text, timestamptz, text);
create or replace function public.tender_create(
  p_title text, p_organism_company_id uuid, p_submission_deadline timestamptz,
  p_sector text default null, p_source text default null, p_opening_at timestamptz default null,
  p_observations text default null, p_description text default null,
  p_publication_date date default null, p_estimated_amount_xof bigint default null,
  p_our_amount_xof bigint default null, p_responsible_id uuid default null
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
  if p_estimated_amount_xof is not null and p_estimated_amount_xof < 0 then
    raise exception 'Montant estimatif invalide.';
  end if;
  if p_our_amount_xof is not null and p_our_amount_xof < 0 then
    raise exception 'Montant de notre offre invalide.';
  end if;
  if p_responsible_id is not null and not exists (
    select 1 from public.profiles pr where pr.id = p_responsible_id and pr.is_active
  ) then raise exception 'Responsable interne inconnu ou inactif.'; end if;
  v_number := public.next_official_number('dao');
  insert into public.tenders (tender_number, title, organism_company_id, sector, source,
    submission_deadline, opening_at, observations, description, publication_date,
    estimated_amount_xof, our_amount_xof, responsible_id, created_by)
  values (v_number, pg_catalog.btrim(p_title), p_organism_company_id,
    nullif(pg_catalog.btrim(p_sector), ''), nullif(pg_catalog.btrim(p_source), ''),
    p_submission_deadline, p_opening_at,
    nullif(pg_catalog.btrim(p_observations), ''), nullif(pg_catalog.btrim(p_description), ''),
    p_publication_date, p_estimated_amount_xof, p_our_amount_xof, p_responsible_id, v_uid)
  returning id into v_tender;
  insert into public.tender_events (tender_id, actor_id, event_type, details)
  values (v_tender, v_uid, 'created', pg_catalog.jsonb_build_object('tender_number', v_number));
  return v_tender;
end $$;
revoke all on function public.tender_create(text, uuid, timestamptz, text, text, timestamptz, text, text, date, bigint, bigint, uuid) from public, anon;
grant execute on function public.tender_create(text, uuid, timestamptz, text, text, timestamptz, text, text, date, bigint, bigint, uuid) to authenticated;

-- 7.b Mise à jour (dossier non clos) ----------------------------------------------
drop function if exists public.tender_update(uuid, text, uuid, timestamptz, text, text, timestamptz, text);
create or replace function public.tender_update(
  p_id uuid, p_title text, p_organism_company_id uuid, p_submission_deadline timestamptz,
  p_sector text, p_source text, p_opening_at timestamptz, p_observations text,
  p_description text, p_publication_date date, p_estimated_amount_xof bigint,
  p_our_amount_xof bigint, p_responsible_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
  if v_status in ('gagne','perdu','annule') then
    raise exception 'Cet appel d''offres est clos : ses informations ne sont plus modifiables.';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_title, '')), '') is null or length(pg_catalog.btrim(p_title)) > 200 then
    raise exception 'Intitulé requis (200 caractères maximum).';
  end if;
  if p_submission_deadline is null then raise exception 'Date limite de remise requise.'; end if;
  if p_organism_company_id is not null and not exists (
    select 1 from public.companies c where c.id = p_organism_company_id
  ) then raise exception 'Organisme (société) inconnu.'; end if;
  if p_estimated_amount_xof is not null and p_estimated_amount_xof < 0 then
    raise exception 'Montant estimatif invalide.';
  end if;
  if p_our_amount_xof is not null and p_our_amount_xof < 0 then
    raise exception 'Montant de notre offre invalide.';
  end if;
  if p_responsible_id is not null and not exists (
    select 1 from public.profiles pr where pr.id = p_responsible_id and pr.is_active
  ) then raise exception 'Responsable interne inconnu ou inactif.'; end if;
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
    responsible_id = p_responsible_id
  where id = p_id;
  insert into public.tender_events (tender_id, actor_id, event_type, details)
  values (p_id, v_uid, 'updated', pg_catalog.jsonb_build_object('via', 'tender_update'));
end $$;
revoke all on function public.tender_update(uuid, text, uuid, timestamptz, text, text, timestamptz, text, text, date, bigint, bigint, uuid) from public, anon;
grant execute on function public.tender_update(uuid, text, uuid, timestamptz, text, text, timestamptz, text, text, date, bigint, bigint, uuid) to authenticated;

-- 7.c Transitions d'état (10 états) -----------------------------------------------
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
  if p_status not in ('identifie','a_analyser','en_preparation','attente_documents',
    'pret_deposer','depose','en_evaluation','gagne','perdu','annule') then
    raise exception 'État cible inconnu.';
  end if;
  select t.status into v_current from public.tenders t where t.id = p_id for update;
  if not found then raise exception 'Appel d''offres introuvable.'; end if;
  if v_current in ('gagne','perdu','annule') then
    raise exception 'Cet appel d''offres est déjà clos.';
  end if;
  if not (
    (v_current in ('identifie','a_analyser','en_preparation','attente_documents','pret_deposer')
      and (p_status in ('identifie','a_analyser','en_preparation','attente_documents','pret_deposer','depose','annule')))
    or (v_current = 'depose' and p_status in ('en_evaluation','gagne','perdu','annule'))
    or (v_current = 'en_evaluation' and p_status in ('gagne','perdu','annule'))
  ) then
    raise exception 'Transition impossible depuis « % » vers « % ».', v_current, p_status;
  end if;
  if p_status = 'gagne' then
    if not (select private.permits('appels_offres','validate')) then
      raise exception 'Validation de l''engagement requise (direction).';
    end if;
    if coalesce(p_awarded_amount_xof, (select t2.our_amount_xof from public.tenders t2 where t2.id = p_id)) is null
      or coalesce(p_awarded_amount_xof, (select t2.our_amount_xof from public.tenders t2 where t2.id = p_id)) <= 0 then
      raise exception 'Montant du marché requis (> 0) pour un appel d''offres gagné.';
    end if;
    update public.tenders set status = 'gagne',
      awarded_amount_xof = coalesce(p_awarded_amount_xof, our_amount_xof), awarded_at = now()
    where id = p_id;
  elsif p_status = 'perdu' then
    if nullif(pg_catalog.btrim(coalesce(p_lost_reason, '')), '') is null then
      raise exception 'Motif de l''échec requis.';
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
end $$;
revoke all on function public.tender_set_status(uuid, text, bigint, text) from public, anon;
grant execute on function public.tender_set_status(uuid, text, bigint, text) to authenticated;

-- 7.d Lignes et devis : modifiables tant que le dossier n'est pas déposé -----------
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
  if v_status not in ('identifie','a_analyser','en_preparation','attente_documents','pret_deposer') then
    raise exception 'Les lignes ne sont plus modifiables à ce stade.';
  end if;
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
  if v_status not in ('identifie','a_analyser','en_preparation','attente_documents','pret_deposer') then
    raise exception 'Les lignes ne sont plus modifiables à ce stade.';
  end if;
  delete from public.tender_items where id = p_item_id;
  insert into public.tender_events (tender_id, actor_id, event_type, details)
  values (v_tender, v_uid, 'item_removed', pg_catalog.jsonb_build_object('item_id', p_item_id));
end $$;
revoke all on function public.tender_item_remove(uuid) from public, anon;
grant execute on function public.tender_item_remove(uuid) to authenticated;

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
  if v_status not in ('identifie','a_analyser','en_preparation','attente_documents','pret_deposer') then
    raise exception 'Les devis ne sont plus modifiables à ce stade.';
  end if;
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

-- 7.e Projet : issu d'un DAO gagné (nouvel libellé) --------------------------------
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
    select 1 from public.tenders t where t.id = p_tender_id and t.status = 'gagne'
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

-- 8. Rattachement d'une commande et d'une proposition au dossier ------------------
create or replace function public.order_set_tender(p_order_id uuid, p_tender_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('commandes','update')) then
    raise exception 'permission de modification requise (commandes)';
  end if;
  perform 1 from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'Commande introuvable.'; end if;
  if p_tender_id is not null and not exists (
    select 1 from public.tenders t where t.id = p_tender_id
  ) then raise exception 'Appel d''offres inconnu.'; end if;
  update public.orders set tender_id = p_tender_id where id = p_order_id;
end $$;
revoke all on function public.order_set_tender(uuid, uuid) from public, anon;
grant execute on function public.order_set_tender(uuid, uuid) to authenticated;

create or replace function public.proposal_set_tender(p_proposal_id uuid, p_tender_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('propositions','update')) then
    raise exception 'permission de modification requise (propositions)';
  end if;
  perform 1 from public.commercial_proposals cp where cp.id = p_proposal_id for update;
  if not found then raise exception 'Proposition introuvable.'; end if;
  if p_tender_id is not null and not exists (
    select 1 from public.tenders t where t.id = p_tender_id
  ) then raise exception 'Appel d''offres inconnu.'; end if;
  update public.commercial_proposals set tender_id = p_tender_id where id = p_proposal_id;
end $$;
revoke all on function public.proposal_set_tender(uuid, uuid) from public, anon;
grant execute on function public.proposal_set_tender(uuid, uuid) to authenticated;
