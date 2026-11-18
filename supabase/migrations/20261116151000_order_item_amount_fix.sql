-- Correctif PROMPT 7 : order_item_add doit renseigner amount_xof (NOT NULL).

create or replace function public.order_item_add(
  p_order_id uuid, p_designation text, p_quantity numeric, p_unit text,
  p_unit_price_xof bigint, p_discount_pct numeric default 0, p_notes text default null
) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_status public.order_status;
  v_pos int;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('commandes','update')) then
    raise exception 'permission de modification requise (commandes)';
  end if;
  select o.order_status into v_status from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'Commande introuvable.'; end if;
  if v_status not in ('draft') then
    raise exception 'Les articles ne sont modifiables que sur une commande en brouillon (données validées conservées à l''état).';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_designation, '')), '') is null then
    raise exception 'Désignation requise.';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantité invalide.'; end if;
  if p_unit_price_xof is null or p_unit_price_xof < 0 then raise exception 'Prix unitaire invalide.'; end if;
  if p_discount_pct is null or p_discount_pct < 0 or p_discount_pct > 100 then
    raise exception 'Remise invalide (0 à 100 %%).';
  end if;
  select coalesce(max(position), 0) + 1 into v_pos from public.order_items where order_id = p_order_id;
  insert into public.order_items (order_id, position, designation, quantity, unit, unit_price_xof, discount_pct, amount_xof, notes, created_by)
  values (p_order_id, v_pos, pg_catalog.btrim(p_designation), p_quantity, nullif(pg_catalog.btrim(p_unit), ''),
    p_unit_price_xof, p_discount_pct, round(p_quantity * p_unit_price_xof * (1 - p_discount_pct / 100))::bigint,
    nullif(pg_catalog.btrim(p_notes), ''), v_uid);
  perform private.order_recompute_amounts(p_order_id);
end $function$;
