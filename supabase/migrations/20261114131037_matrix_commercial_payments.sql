-- 37. Correctifs matrice + audit générique
-- Objectif : trois défauts découverts pendant les tests PROMPT 3 :
--   1. `crm_audit_row()` suppose une colonne `id` : tout INSERT/UPDATE/DELETE sur
--      `role_permissions` (clé composite role+module, sans id) échouait avec
--      42703 — la matrice n'était donc jamais modifiable, y compris par un admin.
--   2. La matrice accordait p_update=true sur `paiements` au rôle `commercial`
--      (et à `finance`) alors que les paiements ne sont modifiés QUE via les RPC
--      finance_* : exigence « un commercial qui tente de modifier une facture
--      doit échouer » (PROMPT 3 § 5).
-- Tables/objets touchés : fonction `crm_audit_row()` (déclencheurs sur companies,
--   tenders, role_permissions) + 2 lignes de `role_permissions`.
-- Dépendances : migrations 25 (matrice + triggers), 35/36 (compatibilité rôles).
-- Risques : le champ entity_id devient NULL pour les tables sans colonne id (le
--   contenu old/new reste journalisé dans `changes`) ; resserrage matrice.
-- Retour arrière : restaurer l'ancienne fonction et les 2 lignes de matrice
--   (déconseillé : réintroduit les deux défauts).
-- Application : projet `xxilfzpkdwggfilwyrjw` (supabase db push, 2026-11-16).

create or replace function public.crm_audit_row()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_id uuid;
begin
  if tg_op = 'DELETE' then
    v_id := nullif(pg_catalog.to_jsonb(old)->>'id', '')::uuid;
  else
    v_id := nullif(pg_catalog.to_jsonb(new)->>'id', '')::uuid;
  end if;
  insert into public.audit_logs (actor_id, action, entity_table, entity_id, changes)
  values (auth.uid(), lower(tg_op), tg_table_name, v_id,
    case when tg_op = 'INSERT' then pg_catalog.jsonb_build_object('new', pg_catalog.to_jsonb(new))
         when tg_op = 'UPDATE' then pg_catalog.jsonb_build_object('old', pg_catalog.to_jsonb(old), 'new', pg_catalog.to_jsonb(new))
         else pg_catalog.jsonb_build_object('old', pg_catalog.to_jsonb(old)) end);
  return coalesce(new, old);
end $function$;

update public.role_permissions set p_update = false
  where role = 'commercial' and module = 'paiements';
update public.role_permissions set p_update = false
  where role = 'finance' and module = 'paiements';

notify pgrst_ddl_watch, 'reload schema';
