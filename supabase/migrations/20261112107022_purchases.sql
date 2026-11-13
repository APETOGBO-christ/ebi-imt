-- =============================================================================
-- Migration 22 — Achats : commandes fournisseurs, factures et décaissements
-- =============================================================================
-- Objectif :
--   Gérer la partie achat : commande fournisseur (ACH-AAAA-NNNNNN via
--   next_official_number('ach')), réception des factures fournisseurs,
--   décaissements (supplier_payments) avec le même régime d'immuabilité que
--   les encaissements (payments). La numérotation des factures fournisseurs
--   reste hors périmètre à ce stade (décision D3, Phase 4) : elles sont
--   identifiées par leur référence interne (id) + numéro fournisseur si fourni.
-- Tables concernées :
--   public.purchase_orders, public.purchase_order_lines,
--   public.supplier_invoices, public.supplier_payments,
--   public.supplier_payment_events (nouvelles).
-- Dépendances :
--   Migrations 1-21 (companies, orders, projects, profiles, helpers,
--   next_official_number, trigger public.prevent_financial_mutation).
-- Risques :
--   - total_xof de l'en-tête est maintenu par la RPC d'écriture des lignes
--     (pas de trigger de sommation : cohérence contrôlée côté RPC, comme le
--     socle le fait pour amount_xof des propositions).
--   - supplier_payments : UPDATE/DELETE interdits à quiconque hors contexte
--     postgres (trigger prevent_financial_mutation, identique à payments) ;
--     la confirmation passe par une RPC SECURITY DEFINER future.
--   - La cohérence supplier_invoices ↔ purchase_order (la facture correspond à
--     la commande) et l'unicité de la référence fournisseur confirmée sont
--     contrôlées par les RPC.
-- Retour arrière :
--   Sur base vide : db reset. Sur base utilisée : drop des 5 tables dans
--   l'ordre inverse (events → payments → invoices → lines → orders) ; jamais
--   avant validation complète car supplier_payments est append-only.
-- =============================================================================

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  purchase_number text not null unique,
  supplier_company_id uuid not null references public.companies(id),
  order_id uuid references public.orders(id),
  project_id uuid references public.projects(id),
  status text not null default 'draft'
    check (status in ('draft','submitted','confirmed','partially_received','received','cancelled')),
  ordered_at timestamptz not null default now(),
  confirmed_at timestamptz,
  delivery_expected_at timestamptz,
  total_xof bigint not null default 0 check (total_xof >= 0),
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'confirmed' or confirmed_at is not null)
);
create index purchase_orders_supplier_status_idx on public.purchase_orders(supplier_company_id, status);
create index purchase_orders_order_idx on public.purchase_orders(order_id);
create index purchase_orders_project_idx on public.purchase_orders(project_id);
create trigger purchase_orders_set_updated_at before update on public.purchase_orders
for each row execute function public.set_updated_at();
create trigger crm_audit_purchase_orders after insert or update on public.purchase_orders
for each row execute function public.crm_audit_row();

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  position integer not null check (position > 0),
  designation text not null,
  quantity numeric not null check (quantity > 0),
  unit text,
  unit_price_xof bigint not null check (unit_price_xof >= 0),
  amount_xof bigint not null check (amount_xof >= 0),
  unique (purchase_order_id, position),
  check (amount_xof = round(quantity * unit_price_xof)::bigint)
);
create index purchase_order_lines_po_idx on public.purchase_order_lines(purchase_order_id, position);

create table public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id),
  supplier_invoice_number text,
  invoice_date date not null,
  amount_ht_xof bigint not null check (amount_ht_xof >= 0),
  amount_tva_xof bigint not null check (amount_tva_xof >= 0),
  amount_ttc_xof bigint not null check (amount_ttc_xof >= 0),
  status text not null default 'received'
    check (status in ('received','verified','approved','partially_paid','paid','rejected','disputed')),
  notes text,
  received_by uuid not null references public.profiles(id),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_ttc_xof = amount_ht_xof + amount_tva_xof)
);
create unique index supplier_invoices_number_idx on public.supplier_invoices(supplier_invoice_number)
  where supplier_invoice_number is not null;
create index supplier_invoices_po_status_idx on public.supplier_invoices(purchase_order_id, status);
create trigger supplier_invoices_set_updated_at before update on public.supplier_invoices
for each row execute function public.set_updated_at();

create table public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_invoice_id uuid not null references public.supplier_invoices(id),
  amount_xof bigint not null check (amount_xof > 0),
  method text not null check (method in ('cash','bank_transfer','mobile_money','cheque')),
  reference text,
  paid_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((status = 'confirmed' and verified_by is not null and verified_at is not null) or status <> 'confirmed')
);
create unique index supplier_payments_confirmed_reference_idx
  on public.supplier_payments(lower(btrim(reference)))
  where status = 'confirmed' and reference is not null;
create index supplier_payments_invoice_status_idx on public.supplier_payments(supplier_invoice_id, status);
-- Append-only au niveau API : correction ou reversement uniquement, jamais de
-- modification destructive (même régime que public.payments).
create trigger supplier_payments_no_update before update or delete on public.supplier_payments
for each row execute function public.prevent_financial_mutation();

create table public.supplier_payment_events (
  id uuid primary key default gen_random_uuid(),
  supplier_payment_id uuid not null references public.supplier_payments(id),
  actor_id uuid not null references public.profiles(id),
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index supplier_payment_events_payment_idx
  on public.supplier_payment_events(supplier_payment_id, created_at desc);

-- RLS : lecture seule partout, écritures via RPC futures.
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.supplier_invoices enable row level security;
alter table public.supplier_payments enable row level security;
alter table public.supplier_payment_events enable row level security;
revoke all on public.purchase_orders, public.purchase_order_lines,
  public.supplier_invoices, public.supplier_payments,
  public.supplier_payment_events from anon;
revoke insert, update, delete on public.purchase_orders, public.purchase_order_lines,
  public.supplier_invoices, public.supplier_payments,
  public.supplier_payment_events from authenticated;
grant select on public.purchase_orders, public.purchase_order_lines,
  public.supplier_invoices, public.supplier_payments,
  public.supplier_payment_events to authenticated;

create policy purchase_orders_select on public.purchase_orders for select to authenticated
using ((select private.permits('achats','select')));
create policy purchase_order_lines_select on public.purchase_order_lines for select to authenticated
using ((select private.permits('achats','select')));
-- Les factures et décaissements fournisseurs intéressent aussi la finance.
create policy supplier_invoices_select on public.supplier_invoices for select to authenticated
using (
  (select private.permits('achats','select'))
  or (select private.permits('facturation','select'))
);
create policy supplier_payments_select on public.supplier_payments for select to authenticated
using (
  (select private.permits('achats','select'))
  or (select private.permits('facturation','select'))
);
create policy supplier_payment_events_select on public.supplier_payment_events for select to authenticated
using (exists (select 1 from public.supplier_payments sp where sp.id = supplier_payment_id));

create policy active_profile_gate on public.purchase_orders
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
create policy active_profile_gate on public.purchase_order_lines
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
create policy active_profile_gate on public.supplier_invoices
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
create policy active_profile_gate on public.supplier_payments
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
create policy active_profile_gate on public.supplier_payment_events
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
