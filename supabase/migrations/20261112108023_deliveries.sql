-- =============================================================================
-- Migration 23 — Livraisons et réceptions (LIV)
-- =============================================================================
-- Objectif :
--   Tracer chaque mouvement physique : livraison client (rattachée à une
--   commande client) ou réception fournisseur (rattachée à une commande
--   fournisseur). Numéro officiel LIV-AAAA-NNNNNN via
--   next_official_number('liv') à la création (RPC, Phase 3).
-- Tables concernées :
--   public.deliveries, public.delivery_lines (nouvelles).
-- Dépendances :
--   Migrations 1-22 (orders, purchase_orders, purchase_order_lines, profiles,
--   helpers, next_official_number).
-- Risques :
--   - L'exclusivité client/fournisseur est garantie par contrainte CHECK sur
--     (kind, order_id, purchase_order_id) : impossible de créer une livraison
--     ambiguë, même depuis une RPC défaillante.
--   - La ligne de réception peut pointer vers la ligne d'achat correspondante
--     (purchase_line_id) pour permettre le suivi partiel ; la cohérence entre
--     la ligne et la commande réceptionnée est contrôlée par la RPC.
--   - Aucune écriture directe : planification, transit, réception passent par
--     RPC ; les quantités reçues restent des lignes, jamais une somme d'en-tête.
-- Retour arrière :
--   Sur base vide : db reset. Sur base utilisée : drop des 2 tables (aucune
--   FK descendante avant migration 24).
-- =============================================================================

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_number text not null unique,
  kind text not null check (kind in ('client_delivery','supplier_reception')),
  order_id uuid references public.orders(id),
  purchase_order_id uuid references public.purchase_orders(id),
  status text not null default 'planned'
    check (status in ('planned','in_transit','delivered','cancelled','partial')),
  planned_at timestamptz,
  delivered_at timestamptz,
  received_by_name text,
  received_by uuid references public.profiles(id),
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'client_delivery' and order_id is not null and purchase_order_id is null)
    or (kind = 'supplier_reception' and purchase_order_id is not null and order_id is null)
  ),
  check (status <> 'delivered' or delivered_at is not null)
);
create index deliveries_order_idx on public.deliveries(order_id);
create index deliveries_po_status_idx on public.deliveries(purchase_order_id, status);
create trigger deliveries_set_updated_at before update on public.deliveries
for each row execute function public.set_updated_at();
create trigger crm_audit_deliveries after insert or update on public.deliveries
for each row execute function public.crm_audit_row();

create table public.delivery_lines (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  position integer not null check (position > 0),
  designation text not null,
  quantity numeric not null check (quantity > 0),
  unit text,
  purchase_line_id uuid references public.purchase_order_lines(id),
  received_ok boolean not null default true,
  notes text,
  unique (delivery_id, position)
);
create index delivery_lines_delivery_idx on public.delivery_lines(delivery_id, position);
create index delivery_lines_purchase_line_idx on public.delivery_lines(purchase_line_id);

-- RLS : lecture pour le module livraisons ; une livraison client est aussi
-- visible de qui peut consulter les commandes.
alter table public.deliveries enable row level security;
alter table public.delivery_lines enable row level security;
revoke all on public.deliveries, public.delivery_lines from anon;
revoke insert, update, delete on public.deliveries, public.delivery_lines from authenticated;
grant select on public.deliveries, public.delivery_lines to authenticated;

create policy deliveries_select on public.deliveries for select to authenticated
using (
  (select private.permits('livraisons','select'))
  or (kind = 'client_delivery' and (select private.permits('commandes','select')))
);
create policy delivery_lines_select on public.delivery_lines for select to authenticated
using (exists (select 1 from public.deliveries d where d.id = delivery_id));

create policy active_profile_gate on public.deliveries
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
create policy active_profile_gate on public.delivery_lines
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
