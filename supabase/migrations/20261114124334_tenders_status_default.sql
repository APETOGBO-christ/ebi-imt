-- 34. Correctif bloquant : défaut de statut des appels d'offres
-- Objectif : la migration 30 a migré les valeurs et la contrainte CHECK vers la
--   liste française (10 statuts) mais le DÉFAUT de la colonne `tenders.status`
--   est resté 'preparing' (valeur anglaise de la migration 17), qui ne satisfait
--   plus la contrainte : toute création d'appel d'offres échouait.
-- Tables/objets touchés : défaut de `tenders.status` -> 'identifie' (début du cycle).
-- Dépendances : M30 (20261114121630_tenders_expansion.sql).
-- Risques : aucune donnée touchée, défaut seul.
-- Retour arrière : alter column status set default 'preparing' (déconseillé).
-- Application : projet `xxilfzpkdwggfilwyrjw` (supabase db push, 2026-11-16).

alter table public.tenders
  alter column status set default 'identifie';

notify pgrst_ddl_watch, 'reload schema';
