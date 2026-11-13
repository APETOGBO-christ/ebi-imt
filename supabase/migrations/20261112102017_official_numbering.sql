-- =============================================================================
-- Migration 17 — Numérotation officielle centralisée EBI-IMT
-- =============================================================================
-- Objectif :
--   Centraliser la numérotation officielle de tous les documents métier
--   (DAO/PRO/CMD/ACH/LIV/FAC) dans une table de compteurs annuels avec remise
--   à zéro automatique au 1er janvier. Format unique : PREFIXE-AAAA-NNNNNN
--   (6 chiffres). Les commandes (kind 'cmd') restent portées par la séquence
--   historique commercial_order_number_seq (format CMD-AAAA-NNNNNN identique
--   au socle) ; la ligne 'cmd' de la table ne sert que de documentation et de
--   contrôle d'intégrité du kind.
-- Tables concernées :
--   public.official_sequences (nouvelle),
--   fonction public.next_official_number(p_kind text).
-- Dépendances :
--   Migrations 1-16 ; séquence public.commercial_order_number_seq (migration 4) ;
--   helpers private.current_role_code / private.permits (migration 16).
-- Risques :
--   - Le compteur est pris sous verrou FOR UPDATE : deux RPC concurrentes ne
--     peuvent pas produire le même numéro.
--   - Aucun client ne doit appeler next_official_number directement hors RPC ;
--     le numéro est réservé au moment de l'émission du document officiel.
--   - La numérotation des factures fournisseurs reste hors périmètre (décision
--     D3 en attente, Phase 4) : supplier_invoices n'utilise pas ce mécanisme.
-- Retour arrière :
--   Sur base vide : db reset. Sur base utilisée : supprimer la fonction puis la
--   table ; les numéros déjà émis restent valides (unicité garantie côté tables
--   métier), seuls les prochains compteurs repartiraient de zéro.
-- =============================================================================

-- 0. Rend le helper de permissions exécutable par les utilisateurs connectés.
-- (La matrice reste lue via le SECURITY DEFINER : aucun privilège direct sur
-- role_permissions n'est accordé par ce grant.)
grant execute on function private.permits(text, text) to authenticated;

-- 1. Compteurs annuels ----------------------------------------------------------
create table public.official_sequences (
  kind text primary key check (kind in ('dao','pro','cmd','ach','liv','fac')),
  prefix text not null unique check (prefix ~ '^[A-Z0-9-]{2,10}$'),
  current_year integer not null default (extract(year from now()))::int,
  next_number integer not null default 1 check (next_number >= 1),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create trigger official_sequences_set_updated_at before update on public.official_sequences
for each row execute function public.set_updated_at();

insert into public.official_sequences (kind, prefix) values
  ('dao', 'DAO'),
  ('pro', 'PRO'),
  ('cmd', 'CMD'),
  ('ach', 'ACH'),
  ('liv', 'LIV'),
  ('fac', 'FAC');

-- 2. Émission d'un numéro officiel ------------------------------------------------
-- SECURITY DEFINER, search_path vide : tout est qualifié explicitement.
create or replace function public.next_official_number(p_kind text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.official_sequences%rowtype;
  v_year integer;
  v_number integer;
begin
  if p_kind is null or p_kind not in ('dao','pro','cmd','ach','liv','fac') then
    raise exception 'unknown official sequence kind';
  end if;
  v_year := extract(year from now())::int;
  if p_kind = 'cmd' then
    -- Les commandes gardent la séquence historique du socle : le format
    -- CMD-AAAA-NNNNNN reste strictement identique aux migrations 1-15.
    return 'CMD-' || v_year::text || '-' ||
      lpad(nextval('public.commercial_order_number_seq'::regclass)::text, 6, '0');
  end if;
  select * into v_row from public.official_sequences
    where kind = p_kind for update;
  if not found then
    raise exception 'official sequence % is not configured', p_kind;
  end if;
  if v_row.current_year <> v_year then
    -- Remise à zéro annuelle : le 1er janvier, compteur reparti à 1.
    v_row.current_year := v_year;
    v_row.next_number := 1;
  end if;
  v_number := v_row.next_number;
  update public.official_sequences
    set next_number = v_number + 1, current_year = v_year
    where kind = p_kind;
  return v_row.prefix || '-' || v_year::text || '-' || lpad(v_number::text, 6, '0');
end $$;
revoke all on function public.next_official_number(text) from public, anon, authenticated;
-- Pas de grant direct : seules les RPC security definer (Phase 3) l'appellent,
-- et un SECURITY DEFINER s'exécute avec les droits du propriétaire.
-- Un utilisateur connecté ne doit pas pouvoir épuiser les compteurs.

-- 3. RLS : consultation réservée (admin/direction via module parametres),
-- aucune écriture directe possible (la fonction est le seul chemin d'écriture).
alter table public.official_sequences enable row level security;
revoke all on public.official_sequences from anon;
revoke insert, update, delete on public.official_sequences from authenticated;
grant select on public.official_sequences to authenticated;

create policy official_sequences_select on public.official_sequences for select to authenticated
using ((select private.permits('parametres','select')));
create policy active_profile_gate on public.official_sequences
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
