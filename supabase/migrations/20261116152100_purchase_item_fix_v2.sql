-- Correctif PROMPT 7 (v2) : amount_xof calculé sur la ligne d'achat.

create or replace function public.purchase_item_add(
  p_purchase_order_id uuid, p_designation text, p_quantity numeric, p_unit text,
  p_unit_price_xof bigint, p_notes text default null
) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
  v_pos int;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('achats','update')) then
    raise exception 'permission de modification requise (achats)';
  end if;
  select po.status into v_status from public.purchase_orders po where po.id = p_purchase_order_id for update;
  if not found then raise exception 'Commande fournisseur introuvable.'; end if;
  if v_status <> 'draft' then
    raise exception 'Les lignes ne sont modifiables qu''en brouillon.';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_designation, '')), '') is null then
    raise exception 'Désignation requise.';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantité invalide.'; end if;
  if p_unit_price_xof is null or p_unit_price_xof < 0 then raise exception 'Prix unitaire invalide.'; end if;
  select coalesce(max(position), 0) + 1 into v_pos from public.purchase_order_lines where purchase_order_id = p_purchase_order_id;
  insert into public.purchase_order_lines (purchase_order_id, position, designation, quantity, unit, unit_price_xof, amount_xof)
  values (p_purchase_order_id, v_pos, pg_catalog.btrim(p_designation), p_quantity, nullif(pg_catalog.btrim(p_unit), ''),
    p_unit_price_xof, round(p_quantity * p_unit_price_xof)::bigint);
  update public.purchase_orders set
    total_xof = (select coalesce(sum(amount_xof), 0) from public.purchase_order_lines where purchase_order_id = p_purchase_order_id)
  where id = p_purchase_order_id;
end $function$;
