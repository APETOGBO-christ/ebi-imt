-- Correctif : le journal de app_settings doit s'exÃ©cuter en SECURITY DEFINER
-- (les utilisateurs n'ont pas de privilÃ¨ge INSERT direct sur audit_logs).

create or replace function public.crm_audit_settings_row()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
begin
  insert into public.audit_logs (actor_id, action, entity_table, entity_id, changes)
  values (auth.uid(), lower(tg_op), tg_table_name, null,
    case when tg_op = 'UPDATE' then pg_catalog.jsonb_build_object('old', pg_catalog.to_jsonb(old), 'new', pg_catalog.to_jsonb(new))
         else pg_catalog.jsonb_build_object('new', pg_catalog.to_jsonb(new)) end);
  return coalesce(new, old);
end $function$;
