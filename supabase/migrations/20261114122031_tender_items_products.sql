-- 31. Lignes d'appels d'offres reliées au catalogue produits (EBI-IMT)
-- Objectif : permettre à chaque ligne d'un DAO de référencer un produit/service du
--   catalogue commercial (`offer_templates`), conformément au cahier des charges
--   « relations appels d'offres ↔ produits ». La désignation libre reste possible
--   (produit du catalogue = suggestion préremplie, non bloquante).
-- Tables/objets touchés :
--   - `tender_items` + colonne additive `offer_template_id` (FK set null) + index ;
--   - RPC `tender_item_add` : passe de 6 à 7 arguments (l'ancienne surcharge est
--     supprimée pour n'en garder qu'une ; l'ancien corps est conservé dans M30).
-- Dépendances : M20 (tender_items), M7 (offer_templates), M16 (permits).
-- Risques : uniquement additif côté schéma ; le RPC est recréé à l'identique avec
--   un argument optionnel de plus (aucun appel existant n'est cassé : l'argument
--   est `default null`).
-- Retour arrière : `drop column` + recréer `tender_item_add` à 6 arguments (corps
--   conservé dans `20261114121630_tenders_expansion.sql` § 7.d).
-- Application : projet neuf `xxilfzpkdwggfilwyrjw` (supabase db push, 2026-11-13).

-- 1. Colonne additive sur les lignes de DAO ----------------------------------
alter table public.tender_items
  add column offer_template_id uuid references public.offer_templates (id)
  on delete set null;

create index tender_items_offer_template_idx
  on public.tender_items (offer_template_id);

comment on column public.tender_items.offer_template_id is
  'Produit/service du catalogue (offer_templates) associé à la ligne, optionnel ; null si libre ou si le produit disparaît.';

-- 2. tender_item_add étendu (6 -> 7 arguments, une seule signature) -----------
drop function public.tender_item_add(uuid, text, numeric, text, bigint, text);

create or replace function public.tender_item_add(
  p_tender_id uuid, p_designation text, p_quantity numeric, p_unit text,
  p_unit_price_xof bigint, p_notes text default null,
  p_offer_template_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_item uuid;
  v_position integer;
  v_status text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('appels_offres','update')) then
    raise exception 'permission de modification requise (appels d''offres)';
  end if;
  select t.status into v_status from public.tenders t where t.id = p_tender_id for update;
  if not found then raise exception 'Appel d''offres introuvable.'; end if;
  if v_status not in ('identifie','a_analyser','en_preparation','attente_documents','pret_deposer') then
    raise exception 'Les lignes ne sont plus modifiables à ce stade.';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_designation, '')), '') is null then
    raise exception 'Désignation requise.';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantité requise (> 0).'; end if;
  if p_unit_price_xof is null or p_unit_price_xof < 0 then raise exception 'Prix unitaire invalide.'; end if;
  if p_offer_template_id is not null and not exists (
    select 1 from public.offer_templates o
      where o.id = p_offer_template_id and o.status = 'active'
  ) then
    raise exception 'Produit du catalogue introuvable ou inactif.';
  end if;
  select coalesce(max(position), 0) + 1 into v_position
    from public.tender_items where tender_id = p_tender_id;
  insert into public.tender_items (tender_id, position, designation, quantity, unit,
    unit_price_xof, amount_xof, notes, offer_template_id)
  values (p_tender_id, v_position, pg_catalog.btrim(p_designation), p_quantity,
    nullif(pg_catalog.btrim(p_unit), ''), p_unit_price_xof,
    round(p_quantity * p_unit_price_xof)::bigint,
    nullif(pg_catalog.btrim(p_notes), ''), p_offer_template_id)
  returning id into v_item;
  insert into public.tender_events (tender_id, actor_id, event_type, details)
  values (p_tender_id, v_uid, 'item_added',
    pg_catalog.jsonb_build_object('item_id', v_item, 'position', v_position,
      'offer_template_id', p_offer_template_id));
  return v_item;
end $$;

revoke all on function public.tender_item_add(uuid, text, numeric, text, bigint, text, uuid)
  from public, anon;
grant execute on function public.tender_item_add(uuid, text, numeric, text, bigint, text, uuid)
  to authenticated;

notify pgrst_ddl_watch, 'reload schema';
