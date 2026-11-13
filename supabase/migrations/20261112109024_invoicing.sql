-- =============================================================================
-- Migration 24 — Facturation client (FAC)
-- =============================================================================
-- Objectif :
--   Émettre des factures client conformes (FAC-AAAA-NNNNNN via
--   next_official_number('fac')) : HT / TVA / TTC avec contrôles
--   d'intégrité en base, lignes détaillées, journal d'événements, et
--   rattachement optionnel des encaissements (payments.invoice_id) pour
--   suivre l'apurement facture par facture.
-- Tables concernées :
--   public.invoices, public.invoice_lines, public.invoice_events (nouvelles),
--   public.payments (colonne additive invoice_id).
-- Dépendances :
--   Migrations 1-23 (orders, companies, payments, helpers,
--   next_official_number). Aucune modification des politiques existantes.
-- Risques :
--   - Les contrôles HT/TVA/TTC sont en base (check) : une facture incohérente
--     est impossible, même depuis une RPC ; la cohérence lignes ↔ en-tête et
--     company_id = orders.company_id reste sous la responsabilité des RPC.
--   - La colonne payments.invoice_id est additive ; la table reste append-only
--     (trigger prevent_financial_mutation inchangé) : une encaissement ne peut
--     pas être réaffecté, l'apurement se décide à la déclaration.
--   - Le statut 'draft' permet la préparation, seule l'émission (RPC +
--     Edge function) gèle le snapshot et le numéro.
-- Retour arrière :
--   Sur base vide : db reset. Sur base utilisée : drop column
--   payments.invoice_id puis drop des 3 tables (factures non encore émises en
--   production à ce stade).
-- =============================================================================

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  order_id uuid not null references public.orders(id),
  company_id uuid not null references public.companies(id),
  amount_ht_xof bigint not null check (amount_ht_xof >= 0),
  vat_rate_bps integer not null check (vat_rate_bps between 0 and 10000),
  amount_tva_xof bigint not null check (amount_tva_xof >= 0),
  amount_ttc_xof bigint not null check (amount_ttc_xof >= 0),
  status text not null default 'draft'
    check (status in ('draft','issued','partially_paid','paid','cancelled')),
  issued_at timestamptz,
  due_at date,
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_ttc_xof = amount_ht_xof + amount_tva_xof),
  check (amount_tva_xof = round(amount_ht_xof * vat_rate_bps / 10000.0)::bigint),
  check (status <> 'issued' or issued_at is not null)
);
create index invoices_order_idx on public.invoices(order_id);
create index invoices_company_status_idx on public.invoices(company_id, status);
create trigger invoices_set_updated_at before update on public.invoices
for each row execute function public.set_updated_at();
create trigger crm_audit_invoices after insert or update on public.invoices
for each row execute function public.crm_audit_row();

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  position integer not null check (position > 0),
  designation text not null,
  quantity numeric not null check (quantity > 0),
  unit text,
  unit_price_xof bigint not null check (unit_price_xof >= 0),
  amount_xof bigint not null check (amount_xof >= 0),
  unique (invoice_id, position),
  check (amount_xof = round(quantity * unit_price_xof)::bigint)
);
create index invoice_lines_invoice_idx on public.invoice_lines(invoice_id, position);

create table public.invoice_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index invoice_events_invoice_idx on public.invoice_events(invoice_id, created_at desc);

-- Rattachement des encaissements à une facture (additif, table append-only
-- inchangée).
alter table public.payments add column invoice_id uuid references public.invoices(id);
create index payments_invoice_idx on public.payments(invoice_id);

-- RLS : lecture pour toute personne ayant la permission facturation.
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.invoice_events enable row level security;
revoke all on public.invoices, public.invoice_lines, public.invoice_events from anon;
revoke insert, update, delete on public.invoices, public.invoice_lines,
  public.invoice_events from authenticated;
grant select on public.invoices, public.invoice_lines, public.invoice_events to authenticated;

create policy invoices_select on public.invoices for select to authenticated
using ((select private.permits('facturation','select')));
create policy invoice_lines_select on public.invoice_lines for select to authenticated
using ((select private.permits('facturation','select')));
create policy invoice_events_select on public.invoice_events for select to authenticated
using ((select private.permits('facturation','select')));

create policy active_profile_gate on public.invoices
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
create policy active_profile_gate on public.invoice_lines
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
create policy active_profile_gate on public.invoice_events
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
