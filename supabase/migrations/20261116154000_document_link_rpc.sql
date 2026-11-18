-- PROMPT 7 : rattachement de documents de bibliothèque aux entités métier.
-- document_links est en lecture seule pour authenticated ; cette RPC encadre
-- l'insertion (permission bibliothèque + entité existante + document non supprimé).

create or replace function public.document_link_entity(
  p_document_id uuid, p_entity_table text, p_entity_id uuid,
  p_link_role text default 'attachment'
) returns uuid
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_exists boolean;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('bibliotheque','insert')) then
    raise exception 'permission de dépôt requise (bibliothèque)';
  end if;
  if p_entity_table not in (
    'orders','payments','commercial_proposals','expenses','field_expenses',
    'import_batches','tenders','projects','purchase_orders','supplier_invoices',
    'deliveries','invoices','companies','contacts') then
    raise exception 'Entité inconnue pour le rattachement.';
  end if;
  if p_link_role not in ('source','attachment','output') then
    raise exception 'Rôle de lien inconnu.';
  end if;
  if not exists (select 1 from public.documents d where d.id = p_document_id and d.deleted_at is null) then
    raise exception 'Document introuvable ou supprimé.';
  end if;
  case p_entity_table
    when 'orders' then select exists(select 1 from public.orders where id = p_entity_id) into v_exists;
    when 'payments' then select exists(select 1 from public.payments where id = p_entity_id) into v_exists;
    when 'commercial_proposals' then select exists(select 1 from public.commercial_proposals where id = p_entity_id) into v_exists;
    when 'expenses' then select exists(select 1 from public.expenses where id = p_entity_id) into v_exists;
    when 'field_expenses' then select exists(select 1 from public.field_expenses where id = p_entity_id) into v_exists;
    when 'import_batches' then select exists(select 1 from public.import_batches where id = p_entity_id) into v_exists;
    when 'tenders' then select exists(select 1 from public.tenders where id = p_entity_id) into v_exists;
    when 'projects' then select exists(select 1 from public.projects where id = p_entity_id) into v_exists;
    when 'purchase_orders' then select exists(select 1 from public.purchase_orders where id = p_entity_id) into v_exists;
    when 'supplier_invoices' then select exists(select 1 from public.supplier_invoices where id = p_entity_id) into v_exists;
    when 'deliveries' then select exists(select 1 from public.deliveries where id = p_entity_id) into v_exists;
    when 'invoices' then select exists(select 1 from public.invoices where id = p_entity_id) into v_exists;
    when 'companies' then select exists(select 1 from public.companies where id = p_entity_id) into v_exists;
    when 'contacts' then select exists(select 1 from public.contacts where id = p_entity_id) into v_exists;
    else v_exists := false;
  end case;
  if not coalesce(v_exists, false) then
    raise exception 'Entité introuvable pour le rattachement.';
  end if;
  insert into public.document_links (document_id, entity_table, entity_id, link_role, created_by)
  values (p_document_id, p_entity_table, p_entity_id, p_link_role, v_uid)
  on conflict (document_id, entity_table, entity_id, link_role) do nothing;
  select id into v_id from public.document_links
  where document_id = p_document_id and entity_table = p_entity_table
    and entity_id = p_entity_id and link_role = p_link_role;
  return v_id;
end $function$;

create or replace function public.document_unlink_entity(p_link_id uuid) returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not (select private.permits('bibliotheque','insert')) then
    raise exception 'permission de gestion documentaire requise (bibliothèque)';
  end if;
  delete from public.document_links where id = p_link_id;
  if not found then raise exception 'Lien documentaire introuvable.'; end if;
end $function$;

revoke execute on function public.document_link_entity(uuid, text, uuid, text) from anon, public;
revoke execute on function public.document_unlink_entity(uuid) from anon, public;
grant execute on function public.document_link_entity(uuid, text, uuid, text) to authenticated;
grant execute on function public.document_unlink_entity(uuid) to authenticated;
