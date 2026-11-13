-- =============================================================================
-- Migration 16 — Rôles EBI-IMT et matrice de permissions granulaires
-- =============================================================================
-- Objectif :
--   Passer du modèle 3 rôles figé (enum app_role) au modèle EBI-IMT de 6 rôles
--   stockés en table, avec une matrice role_permissions (rôle × module × 5
--   actions : consult/créer/modifier/valider/supprimer) modifiable par
--   l'administrateur. Prépare le helper private.permits() utilisé par les
--   politiques RLS des tables créées dans les migrations 18-24.
-- Tables concernées :
--   public.roles (nouvelle), public.role_permissions (nouvelle),
--   public.profiles (bascule du type de colonne role), corps de 5 fonctions
--   existantes redéfinies à l'identique avec casts explicites.
-- Dépendances :
--   Migrations 1-15 (profiles, politiques existantes, trigger d'inscription).
--   Aucune dépendance externe.
-- Risques :
--   - Bascule du type de la colonne profiles.role : les 5 fonctions sélectionnant
--     le rôle vers le type enum sont redéfinies avec un cast explicite ; les
--     littéraux 'sales_rep'/'sales_manager' du socle restent valides car ces
--     codes sont conservés comme lignes de la table roles (marquées
--     is_deprecated). Base EBI-IMT vide : aucune donnée à convertir.
--   - La matrice semée est un DÉFAUT DE RÉFÉRENCE à confirmer par la direction
--     (V2.1 de la Phase 0) ; elle est modifiable par l'admin sans migration.
-- Retour arrière :
--   Possible sur base vide (db reset). Sur base utilisée : recréer le type
--   app_role sur la colonne (update role::public.app_role) puis supprimer
--   roles/role_permissions — jamais avant validation complète.
-- =============================================================================

-- 1. Table des rôles -----------------------------------------------------------
create table public.roles (
  code text primary key,
  label text not null unique,
  description text,
  is_deprecated boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.roles (code, label, description, is_deprecated) values
  ('admin',        'Administrateur',   'Gouvernance complète, utilisateurs, paramètres, validation financière', false),
  ('direction',    'Direction générale', 'Vision transversale de toute l''activité ; validation des appels d''offres et des engagements', false),
  ('commercial',   'Commercial',       'Prospects, propositions, commandes de son portefeuille, déclarations d''encaissement, dépenses terrain', false),
  ('achats',       'Achats',           'Fournisseurs, commandes fournisseurs, réceptions', false),
  ('finance',      'Finance',          'Factures, encaissements, décaissements, journal financier', false),
  ('lecture_seule','Consultation',     'Consultation générale sans écriture', false),
  ('sales_manager','Responsable commercial (socle hérité)', 'Code de compatibilité du socle initial', true),
  ('sales_rep',    'Commercial terrain (socle hérité)',     'Code de compatibilité du socle initial', true);

-- 2. Matrice de permissions ----------------------------------------------------
create table public.role_permissions (
  role text not null references public.roles(code),
  module text not null check (module in (
    'prospects','activites','commerciaux','imports','offres','propositions',
    'commandes','paiements','depenses_terrain','commissions','rapports',
    'appels_offres','projets','clients','partenaires','fournisseurs','achats',
    'livraisons','facturation','bibliotheque','utilisateurs','journal',
    'parametres')),
  p_select   boolean not null default false,
  p_insert   boolean not null default false,
  p_update   boolean not null default false,
  p_validate boolean not null default false,
  p_delete   boolean not null default false,
  primary key (role, module)
);

-- Défaut de référence (proposition à confirmer par la direction, V2.1) :
-- consultation large, puis ouverture d'écriture par rôle.
insert into public.role_permissions (role, module, p_select)
select r.code, m.module, true
from public.roles r
cross join (values
  ('prospects'),('activites'),('commerciaux'),('imports'),('offres'),
  ('propositions'),('commandes'),('paiements'),('depenses_terrain'),
  ('commissions'),('rapports'),('appels_offres'),('projets'),('clients'),
  ('partenaires'),('fournisseurs'),('achats'),('livraisons'),('facturation'),
  ('bibliotheque')
) as m(module);

insert into public.role_permissions (role, module, p_select)
select r.code, m.module, true
from public.roles r
cross join (values ('utilisateurs'),('journal'),('parametres')) as m(module)
where r.code in ('admin','direction');

update public.role_permissions set p_select = false
where module = 'utilisateurs' and role not in ('admin','direction');
update public.role_permissions set p_select = false
where module = 'journal' and role not in ('admin','direction','sales_manager');
update public.role_permissions set p_select = false
where module = 'parametres' and role not in ('admin','direction');
update public.role_permissions set p_select = false
where module in ('prospects','activites','commerciaux','imports','offres')
  and role in ('achats','finance');

-- admin : tous droits partout.
update public.role_permissions
set p_insert = true, p_update = true, p_validate = true, p_delete = true
where role = 'admin';

-- direction : validation des engagements, lecture transversale, rien d'autre.
update public.role_permissions
set p_validate = true
where role = 'direction' and module in ('appels_offres','commandes','achats','facturation');

-- commercial (et code hérité sales_rep) : son métier, sans suppression ni validation.
update public.role_permissions
set p_insert = true, p_update = true
where role in ('commercial','sales_rep')
  and module in ('prospects','activites','propositions','commandes','clients',
                 'paiements','depenses_terrain');

update public.role_permissions
set p_insert = true, p_update = true
where role = 'sales_manager'
  and module in ('prospects','activites','propositions','commandes','clients',
                 'paiements','depenses_terrain','commissions','imports','offres');

-- sales_manager hérité : conserve ses validations d'usage (délégations
-- nominatives finance/terrain restent appliquées par les RPC existantes).
update public.role_permissions
set p_validate = true
where role = 'sales_manager' and module in ('paiements','propositions','depenses_terrain');

-- achats : fournisseurs, commandes fournisseurs (avec validation), réceptions.
update public.role_permissions
set p_insert = true, p_update = true
where role = 'achats' and module in ('fournisseurs','achats','livraisons');
update public.role_permissions
set p_validate = true
where role = 'achats' and module = 'achats';

-- finance : facturation (avec validation), encaissements, validation des
-- factures fournisseurs ; écritures de paiement restent RPC-délégation.
update public.role_permissions
set p_insert = true, p_update = true
where role = 'finance' and module in ('facturation','paiements');
update public.role_permissions
set p_validate = true
where role = 'finance' and module in ('facturation','paiements','achats');

-- 3. Bascule de la colonne profiles.role vers text + clé étrangère --------------
-- La politique profiles_insert du socle référence la colonne role : PostgreSQL
-- refuse ALTER TYPE tant qu'elle existe — on la dépose puis on la recrée à
-- l'identique (corps conservé) après la bascule.
drop policy profiles_insert on public.profiles;
alter table public.profiles alter column role type text using role::text;
alter table public.profiles
  add constraint profiles_role_fk foreign key (role) references public.roles(code);
create policy profiles_insert on public.profiles for insert to authenticated
  with check ((select private.current_app_role()) = 'admin' and role <> 'admin');

-- 4. Fonctions existantes redéfinies à l'identique (casts explicites) -----------
-- (CREATE OR REPLACE conserve les privilèges déjà accordés.)

create or replace function private.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$ select role::public.app_role from public.profiles where id = (select auth.uid()) and is_active = true $$;

create or replace function private.crm_actor(p_manager_only boolean default false)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_role public.app_role;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select role::public.app_role into v_role from public.profiles where id = v_actor and is_active;
  if v_role is null then raise exception 'active profile required'; end if;
  if p_manager_only and v_role not in ('admin', 'sales_manager') then
    raise exception 'manager permission required';
  end if;
  return v_actor;
end $$;

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
  update public.profiles set role = p_role::text where id = p_user_id returning * into v_profile;
  if v_profile.id is null then raise exception 'profile not found'; end if;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values (auth.uid(), 'role_change', 'profiles', p_user_id, jsonb_build_object('new_role', p_role));
  return v_profile;
end $$;

create or replace function public.commercial_finalize_document(
  p_proposal_id uuid, p_storage_path text, p_sha256 text, p_actor_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_proposal public.commercial_proposals%rowtype;
  v_existing uuid; v_document uuid; v_role public.app_role;
begin
  select role::public.app_role into v_role from public.profiles where id = p_actor_id and is_active;
  if v_role is null then raise exception 'active document author required'; end if;
  select * into v_proposal from public.commercial_proposals where id = p_proposal_id for update;
  if v_proposal.id is null or not (v_role in ('admin','sales_manager') or
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
end $$;

create or replace function private.create_pending_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := nullif(pg_catalog.btrim(pg_catalog.left(new.raw_user_meta_data->>'full_name', 120)), '');
  if v_name is null then
    v_name := coalesce(nullif(pg_catalog.split_part(new.email, '@', 1), ''), 'Nouvel utilisateur');
  end if;
  insert into public.profiles (id, full_name, role, is_active)
  values (new.id, v_name, 'sales_rep', false);
  return new;
end;
$$;

-- 5. Helpers du modèle granulaire ----------------------------------------------
create or replace function private.current_role_code()
returns text
language sql
stable
security definer
set search_path = ''
as $$ select role from public.profiles where id = (select auth.uid()) and is_active $$;
revoke all on function private.current_role_code() from public, anon;
grant execute on function private.current_role_code() to authenticated;

create or replace function private.permits(p_module text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select role from public.profiles where id = (select auth.uid()) and is_active
  )
  select exists (select 1 from actor where role is not null)
    and (
      exists (select 1 from actor where role = 'admin')
      or exists (
        select 1
        from public.role_permissions rp, actor a
        where rp.role = a.role
          and rp.module = p_module
          and case p_action
                when 'select' then rp.p_select
                when 'insert' then rp.p_insert
                when 'update' then rp.p_update
                when 'validate' then rp.p_validate
                when 'delete' then rp.p_delete
                else false
              end
      )
    )
$$;
revoke all on function private.permits(text, text) from public, anon, authenticated;

-- 6. RLS sur les tables de sécurité ---------------------------------------------
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
revoke all on public.roles, public.role_permissions from anon;
revoke insert, update, delete on public.roles from authenticated;
revoke insert, delete on public.role_permissions from authenticated;

create policy roles_select on public.roles for select to authenticated
using (true);
create policy role_permissions_select on public.role_permissions for select to authenticated
using (true);
create policy role_permissions_update on public.role_permissions for update to authenticated
using ((select private.current_role_code()) = 'admin')
with check ((select private.current_role_code()) = 'admin');
grant select on public.roles, public.role_permissions to authenticated;
grant update on public.role_permissions to authenticated;

create policy active_profile_gate on public.roles
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
create policy active_profile_gate on public.role_permissions
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
