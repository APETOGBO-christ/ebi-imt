-- Correctif : le journal de app_settings ne caste pas entity_id en uuid (id smallint).

create or replace function public.crm_audit_settings_row()
  returns trigger
  language plpgsql
  set search_path to ''
as $function$
begin
  insert into public.audit_logs (actor_id, action, entity_table, entity_id, changes)
  values (auth.uid(), lower(tg_op), tg_table_name, null,
    case when tg_op = 'UPDATE' then pg_catalog.jsonb_build_object('old', pg_catalog.to_jsonb(old), 'new', pg_catalog.to_jsonb(new))
         else pg_catalog.jsonb_build_object('new', pg_catalog.to_jsonb(new)) end);
  return coalesce(new, old);
end $function$;

drop trigger audit_app_settings on public.app_settings;
create trigger audit_app_settings
  after insert or update on public.app_settings
  for each row execute function public.crm_audit_settings_row();
