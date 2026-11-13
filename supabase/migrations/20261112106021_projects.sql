-- =============================================================================
-- Migration 21 — Projets d'exécution EBI-IMT
-- =============================================================================
-- Objectif :
--   Piloter l'exécution des travaux gagnés : un projet peut naître d'un appel
--   d'offres gagné (tender_id) ou directement d'une commande client
--   (orders.project_id). Chaque projet porte un numéro officiel
--   PRO-AAAA-NNNNNN attribué par next_official_number('pro') à la création
--   (RPC, Phase 3).
-- Tables concernées :
--   public.projects (nouvelle), public.orders (colonne additive project_id).
-- Dépendances :
--   Migrations 1-20 (public.tenders, public.orders, public.companies,
--   public.profiles, helpers, public.next_official_number).
-- Risques :
--   - La colonne orders.project_id est unique : une commande client ne peut
--     être rattachée qu'à un seul projet (le lien inverse 1-N reste possible
--     via projects). Strictement additif, aucune politique RLS existante
--     n'est modifiée.
--   - production_projects (socle) reste inchangée : elle suit la PRODUCTION
--     d'une commande, projects suit l'EXÉCUTION du chantier/marché. Les deux
--     vivent côte à côte sans fusion à ce stade (décision documentée).
-- Retour arrière :
--   Sur base vide : db reset. Sur base utilisée : drop column orders.project_id
--   puis drop table projects (aucune FK descendante avant migration 22).
-- =============================================================================

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  project_number text not null unique,
  title text not null,
  client_company_id uuid not null references public.companies(id),
  tender_id uuid references public.tenders(id),
  manager_id uuid references public.profiles(id),
  status text not null default 'planned'
    check (status in ('planned','in_progress','suspended','completed','cancelled')),
  start_date date,
  planned_end_date date,
  actual_end_date date,
  budget_xof bigint check (budget_xof is null or budget_xof >= 0),
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'completed' or actual_end_date is not null)
);
create index projects_status_idx on public.projects(status, created_at desc);
create index projects_client_idx on public.projects(client_company_id);
create index projects_manager_idx on public.projects(manager_id);
create trigger projects_set_updated_at before update on public.projects
for each row execute function public.set_updated_at();
create trigger crm_audit_projects after insert or update on public.projects
for each row execute function public.crm_audit_row();

-- Rattachement commande → projet (unique : une commande n'appartient qu'à un projet).
alter table public.orders add column project_id uuid unique references public.projects(id);
create index orders_project_idx on public.orders(project_id);

-- RLS : lecture pour toute personne ayant la permission projets.
alter table public.projects enable row level security;
revoke all on public.projects from anon;
revoke insert, update, delete on public.projects from authenticated;
grant select on public.projects to authenticated;

create policy projects_select on public.projects for select to authenticated
using ((select private.permits('projets','select')));
create policy active_profile_gate on public.projects
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
