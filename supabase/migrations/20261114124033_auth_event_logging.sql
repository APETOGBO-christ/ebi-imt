-- 33. Journalisation des connexions et déconnexions (EBI-IMT)
-- Objectif : compléter la exigence « le journal enregistre les connexions » de la
--   revue de cybersécurité. Une RPC SECURITY DEFINER insère une ligne audit_logs
--   (actor_id = session authentifiée, action login/logout, ressource = profil,
--   contexte horodaté). Les échecs d'authentification restent dans les journaux
--   GoTrue du tableau de bord (aucune identité exploitable côté base ; une RPC
--   publique de journalisation d'échecs serait un vecteur de spam).
-- Tables/objets touchés : nouvelle fonction `log_auth_event(text)` ; aucune table.
-- Dépendances : audit_logs (M1, écriture via SECURITY DEFINER seulement depuis M32).
-- Risques : seul un utilisateur authentifié peut appeler (revoke anon) ; action en
--   liste blanche ('login'|'logout') ; un journal unique par événement.
-- Retour arrière : drop function.
-- Application : projet `xxilfzpkdwggfilwyrjw` (supabase db push, 2026-11-16).

create or replace function public.log_auth_event(p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_action text := nullif(pg_catalog.btrim(coalesce(p_action, '')), '');
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if v_action not in ('login', 'logout') then
    raise exception 'Action inconnue.';
  end if;
  insert into public.audit_logs (actor_id, action, entity_table, entity_id, changes, context)
  values (v_uid, 'auth_' || v_action, 'auth', v_uid,
          pg_catalog.jsonb_build_object('event', v_action),
          pg_catalog.jsonb_build_object('at', pg_catalog.now(), 'source', 'app'));
end $$;

revoke all on function public.log_auth_event(text) from public, anon;
grant execute on function public.log_auth_event(text) to authenticated;

notify pgrst_ddl_watch, 'reload schema';
