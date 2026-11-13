-- =============================================================================
-- Migration 20 — Appels d'offres (DAO) : suivi, lignes et devis fournisseurs
-- =============================================================================
-- Objectif :
--   Suivre chaque appel d'offres de bout en bout : préparation du dossier
--   technique et financier, consultation ponctuelle des fournisseurs,
--   soumission, puis issue (gagné / perdu / annulé). Le numéro officiel
--   DAO-AAAA-NNNNNN est attribué par next_official_number('dao') au moment de
--   la création (RPC, Phase 3).
-- Tables concernées :
--   public.tenders, public.tender_items, public.tender_quotes,
--   public.tender_events (nouvelles).
-- Dépendances :
--   Migrations 1-19 (public.companies, public.profiles, helpers,
--   public.next_official_number, trigger public.crm_audit_row).
-- Risques :
--   - tender_quotes : la cohérence « la ligne de devis appartient au DAO » est
--     appliquée par la RPC d'écriture (pas de FK croisée tender_item → tender).
--   - Aucune écriture directe : préparation et transitions d'état passent par
--     RPC ; la validation de l'engagement (direction) reste une étape RPC.
--   - awarded_amount_xof est le montant du marché si gagné ; le projet
--     exécution est créé en migration 21 (projects.tender_id).
-- Retour arrière :
--   Sur base vide : db reset. Sur base utilisée : drop des 4 tables (aucune
--   FK descendante avant migration 21).
-- =============================================================================

create table public.tenders (
  id uuid primary key default gen_random_uuid(),
  tender_number text not null unique,
  title text not null,
  organism_company_id uuid not null references public.companies(id),
  sector text,
  source text,
  submission_deadline timestamptz not null,
  opening_at timestamptz,
  status text not null default 'preparing'
    check (status in ('preparing','submitted','won','lost','cancelled')),
  preparation_notes text,
  awarded_amount_xof bigint check (awarded_amount_xof is null or awarded_amount_xof >= 0),
  awarded_at timestamptz,
  lost_reason text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'won' or (awarded_amount_xof is not null and awarded_at is not null)),
  check (status <> 'lost' or lost_reason is not null)
);
create index tenders_status_deadline_idx on public.tenders(status, submission_deadline);
create index tenders_organism_idx on public.tenders(organism_company_id);
create trigger tenders_set_updated_at before update on public.tenders
for each row execute function public.set_updated_at();
create trigger crm_audit_tenders after insert or update on public.tenders
for each row execute function public.crm_audit_row();

create table public.tender_items (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.tenders(id) on delete cascade,
  position integer not null check (position > 0),
  designation text not null,
  quantity numeric not null check (quantity > 0),
  unit text,
  unit_price_xof bigint not null check (unit_price_xof >= 0),
  amount_xof bigint not null check (amount_xof >= 0),
  notes text,
  unique (tender_id, position),
  check (amount_xof = round(quantity * unit_price_xof)::bigint)
);
create index tender_items_tender_idx on public.tender_items(tender_id, position);

create table public.tender_quotes (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.tenders(id) on delete cascade,
  tender_item_id uuid not null references public.tender_items(id) on delete cascade,
  supplier_company_id uuid not null references public.companies(id),
  quote_xof bigint not null check (quote_xof >= 0),
  source text,
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (tender_item_id, supplier_company_id)
);
create index tender_quotes_tender_idx on public.tender_quotes(tender_id);
create index tender_quotes_supplier_idx on public.tender_quotes(supplier_company_id);

create table public.tender_events (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.tenders(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index tender_events_tender_idx on public.tender_events(tender_id, created_at desc);

-- RLS : lecture pour toute personne ayant la permission appels_offres ;
-- écritures réservées aux RPC.
alter table public.tenders enable row level security;
alter table public.tender_items enable row level security;
alter table public.tender_quotes enable row level security;
alter table public.tender_events enable row level security;
revoke all on public.tenders, public.tender_items, public.tender_quotes,
  public.tender_events from anon;
revoke insert, update, delete on public.tenders, public.tender_items,
  public.tender_quotes, public.tender_events from authenticated;
grant select on public.tenders, public.tender_items, public.tender_quotes,
  public.tender_events to authenticated;

create policy tenders_select on public.tenders for select to authenticated
using ((select private.permits('appels_offres','select')));
create policy tender_items_select on public.tender_items for select to authenticated
using ((select private.permits('appels_offres','select')));
create policy tender_quotes_select on public.tender_quotes for select to authenticated
using ((select private.permits('appels_offres','select')));
create policy tender_events_select on public.tender_events for select to authenticated
using ((select private.permits('appels_offres','select')));

create policy active_profile_gate on public.tenders
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
create policy active_profile_gate on public.tender_items
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
create policy active_profile_gate on public.tender_quotes
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
create policy active_profile_gate on public.tender_events
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
