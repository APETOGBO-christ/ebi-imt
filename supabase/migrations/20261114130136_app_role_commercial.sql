-- 36. Correctif : valeur enum `commercial` (architecture v2, six rôles)
-- Objectif : la migration 35 a étendu `app_role` de direction/achats/finance/
--   lecture_seule mais a omis `commercial` (rôle v2 des profils commerciaux,
--   correspondant à l'ancien `sales_rep`).
-- Tables/objets touchés : valeur enum `public.app_role` uniquement.
-- Dépendances : M35 (20261114130035_role_compat_v2.sql).
-- Risques : aucun (ajout de valeur).
-- Retour arrière : non nécessaire (les valeurs enum ne se retirent pas proprement).
-- Application : projet `xxilfzpkdwggfilwyrjw` (supabase db push, 2026-11-16).

alter type public.app_role add value if not exists 'commercial' after 'sales_rep';

notify pgrst_ddl_watch, 'reload schema';
