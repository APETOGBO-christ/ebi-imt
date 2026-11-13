-- =============================================================================
-- Migration 18 — Rôles commerciaux des sociétés (clients / fournisseurs / etc.)
-- =============================================================================
-- Objectif :
--   Rendre explicite le rôle d'une société dans le référentiel : une même
--   société peut être à la fois cliente, fournisseur et partenaire. La table
--   associe company × role_code sans dupliquer la fiche société.
-- Tables concernées :
--   public.company_roles (nouvelle).
-- Dépendances :
--   Migrations 1-17 (public.companies, helpers private.permits / current_role_code).
-- Risques :
--   - Les codes sont en français ('client','fournisseur','partenaire','agence')
--     pour rester cohérents avec les modules de role_permissions ; toute
--     évolution passe par un check à élargir dans une migration additive.
--   - Aucune écriture directe via l'API : la création/modification passera par
--     des RPC dédiées (Phase 3), les politiques ici sont en lecture seule.
-- Retour arrière :
--   Sur base vide : db reset. Sur base utilisée : drop table (aucune autre
--   table ne référence company_roles).
-- =============================================================================

create table public.company_roles (
  company_id uuid not null references public.companies(id) on delete cascade,
  role_code text not null check (role_code in ('client','fournisseur','partenaire','agence')),
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (company_id, role_code)
);
create index company_roles_role_idx on public.company_roles(role_code);

-- Lecture : visible par tout profil actif ayant accès à l'un des modules
-- sociétés concernés. Écriture : réservée aux RPC futures.
alter table public.company_roles enable row level security;
revoke all on public.company_roles from anon;
revoke insert, update, delete on public.company_roles from authenticated;
grant select on public.company_roles to authenticated;

create policy company_roles_select on public.company_roles for select to authenticated
using (
  (select private.permits('clients','select'))
  or (select private.permits('fournisseurs','select'))
  or (select private.permits('partenaires','select'))
);
create policy active_profile_gate on public.company_roles
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
