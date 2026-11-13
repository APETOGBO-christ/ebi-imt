-- =============================================================================
-- Migration 26 — Sociétés et contacts : référentiel unifié (PROMPT 4, Phase 1)
-- =============================================================================
-- Objectif :
--   Faire du référentiel sociétés le point d'entrée unique : une même société
--   peut être cliente, fournisseur, partenaire et organisme d'appel d'offres
--   (les rôles cumulables restent dans public.company_roles, M18). Chaque
--   fiche gagne le nom commercial, les identifiants légaux et un statut
--   actif/inactif ; chaque contact gagne un statut. L'historique des échanges
--   au niveau société est porté par la nouvelle table company_activities
--   (le socle activities reste lié aux leads).
-- Tables concernées :
--   public.companies (4 colonnes + index + audit), public.contacts (1 colonne),
--   public.company_activities (nouvelle), enum document_type (valeur
--   library_document pour la bibliothèque), politiques RLS élargies aux
--   rôles achats/finance/partenaires via la matrice (permits).
-- Dépendances :
--   Migrations 1-25 (companies, contacts, company_roles, helpers permits,
--   crm_audit_row, set_updated_at, set_normalized_phone).
-- Risques :
--   - Élargissement contrôlé de la visibilité du référentiel : toute personne
--     active disposant de la permission « consulter » sur clients,
--     fournisseurs ou partenaires voit les fiches. Le scoping propriétaire
--     du socle (leads assignés, créateur) reste valable pour les prospects.
--   - La création de société reste RPC (INSERT révoqué depuis M6) : les
--     politiques d'écriture directe couvrent la modification ; la création
--     passe par company_create pour poser created_by et les rôles.
--   - ALTER TYPE … ADD VALUE : la valeur library_document est utilisable
--     dès la transaction suivante (convention PostgreSQL).
-- Retour arrière :
--   Sur base vide : db reset. Sur base utilisée : drop table
--   company_activities, drop columns additives, recréer les politiques
--   précédentes (corps conservés ci-dessous en commentaire).
-- =============================================================================

-- 1. Extension de la fiche société ----------------------------------------------
alter table public.companies
  add column trade_name text,
  add column registration_number text,
  add column tax_number text,
  add column is_active boolean not null default true;
create index companies_is_active_idx on public.companies(is_active);
create index companies_trade_name_idx on public.companies(lower(trade_name))
  where trade_name is not null;

-- Audit : le trigger crm_audit_companies du socle (migration 7) couvre déjà
-- insert/update sur companies — pas de recréation ici.

-- 2. Statut du contact -----------------------------------------------------------
alter table public.contacts add column is_active boolean not null default true;

-- 3. Valeur de type pour les documents de bibliothèque ---------------------------
alter type public.document_type add value if not exists 'library_document';

-- 4. Historique des échanges par société -----------------------------------------
create table public.company_activities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  author_id uuid not null references public.profiles(id),
  activity_type text not null check (activity_type in ('call','meeting','email','visit','note','other')),
  occurred_at timestamptz not null default now(),
  subject text,
  body text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index company_activities_company_idx on public.company_activities(company_id, occurred_at desc);
create index company_activities_contact_idx on public.company_activities(contact_id)
  where contact_id is not null;

alter table public.company_activities enable row level security;
revoke all on public.company_activities from anon;
revoke insert, update, delete on public.company_activities from authenticated;
grant select on public.company_activities to authenticated;

create policy company_activities_select on public.company_activities for select to authenticated
using (
  (select private.permits('clients','select'))
  or (select private.permits('fournisseurs','select'))
  or (select private.permits('partenaires','select'))
);
create policy active_profile_gate on public.company_activities
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
create trigger crm_audit_company_activities after insert or update on public.company_activities
for each row execute function public.crm_audit_row();

-- 5. Politiques du référentiel élargies aux rôles du référentiel ------------------
-- Visibilité : socle (créateur, leads assignés, can_manage_all) + matrice
-- référentiel (clients / fournisseurs / partenaires). L'écriture directe
-- (modification) suit la même logique ; la création reste RPC.

drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated
using (
  (select private.crm_active())
  and (
    (select private.can_manage_all())
    or created_by = (select auth.uid())
    or exists (select 1 from public.leads l where l.company_id = companies.id and l.assigned_to = (select auth.uid()))
    or (select private.permits('clients','select'))
    or (select private.permits('fournisseurs','select'))
    or (select private.permits('partenaires','select'))
  )
);

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies for update to authenticated
using (
  (select private.crm_active())
  and (
    (select private.can_manage_all())
    or created_by = (select auth.uid())
    or (select private.permits('clients','update'))
    or (select private.permits('fournisseurs','update'))
    or (select private.permits('partenaires','update'))
  )
)
with check (
  (select private.crm_active())
  and (
    (select private.can_manage_all())
    or created_by = (select auth.uid())
    or (select private.permits('clients','update'))
    or (select private.permits('fournisseurs','update'))
    or (select private.permits('partenaires','update'))
  )
);

drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts for select to authenticated
using (
  (select private.crm_active())
  and (
    (select private.can_manage_all())
    or exists (select 1 from public.leads l where l.company_id = contacts.company_id and l.assigned_to = (select auth.uid()))
    or (select private.permits('clients','select'))
    or (select private.permits('fournisseurs','select'))
    or (select private.permits('partenaires','select'))
  )
);

drop policy if exists contacts_insert on public.contacts;
create policy contacts_insert on public.contacts for insert to authenticated
with check (
  (select private.crm_active())
  and (
    (select private.can_manage_all())
    or exists (select 1 from public.leads l where l.company_id = contacts.company_id and l.assigned_to = (select auth.uid()))
    or (select private.permits('clients','insert'))
    or (select private.permits('fournisseurs','insert'))
    or (select private.permits('partenaires','insert'))
  )
);

drop policy if exists contacts_update on public.contacts;
create policy contacts_update on public.contacts for update to authenticated
using (
  (select private.crm_active())
  and (
    (select private.can_manage_all())
    or exists (select 1 from public.leads l where l.company_id = contacts.company_id and l.assigned_to = (select auth.uid()))
    or (select private.permits('clients','update'))
    or (select private.permits('fournisseurs','update'))
    or (select private.permits('partenaires','update'))
  )
)
with check (
  (select private.crm_active())
  and (
    (select private.can_manage_all())
    or exists (select 1 from public.leads l where l.company_id = contacts.company_id and l.assigned_to = (select auth.uid()))
    or (select private.permits('clients','update'))
    or (select private.permits('fournisseurs','update'))
    or (select private.permits('partenaires','update'))
  )
);

-- 6. RPC de création de société (INSERT direct révoqué depuis M6) -----------------
-- Contexte utilisateur : un profil actif disposant de la permission
-- « créer » sur l'un des modules du référentiel. created_by = l'appelant ;
-- les rôles cumulables sont posés dans la même transaction.
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
revoke all on function public.company_create(text, text, text[], text, text, text,
  text, text, text, text, text, text) from public, anon;
grant execute on function public.company_create(text, text, text[], text, text, text,
  text, text, text, text, text, text) to authenticated;

-- 7. RPC d'ajout d'échange au niveau société ---------------------------------------
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
revoke all on function public.company_activity_add(uuid, uuid, text, text, text)
  from public, anon;
grant execute on function public.company_activity_add(uuid, uuid, text, text, text)
  to authenticated;
