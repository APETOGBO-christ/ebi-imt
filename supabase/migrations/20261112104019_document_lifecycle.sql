-- =============================================================================
-- Migration 19 — Cycle de vie de la bibliothèque documentaire EBI-IMT
-- =============================================================================
-- Objectif :
--   Compléter public.documents pour le cycle de vie complet (corbeille
--   logique, chaînage des versions, rattachement polymorphe) et ajouter les
--   tables de gouvernance de la bibliothèque : uploads en attente de
--   rattachement, journal d'accès, liens polymorphes document ↔ entité,
--   réconciliation stock R2 ↔ base.
-- Tables concernées :
--   public.documents (4 colonnes + contrainte + index, strictement additif),
--   public.document_uploads, public.document_access_logs,
--   public.document_links, public.document_reconciliation (nouvelles).
-- Dépendances :
--   Migrations 1-18 (documents, storage buckets, helpers private.permits /
--   current_role_code). Les kinds d'entités cités dans document_links incluent
--   des tables créées aux migrations 20-24 : la contrainte check ne valide que
--   le texte, aucune FK vers ces tables n'existe à ce stade.
-- Risques :
--   - Aucune écriture directe : émission et suppression passent par RPC
--     (Phase 3) et Edge function ; la corbeille est LOGIQUE (deleted_at), la
--     suppression physique reste réservée à l'administrateur et ne casse
--     jamais un document référencé par le journal financier.
--   - La réconciliation (document_reconciliation) est un outil d'audit interne
--     alimenté par tâche de fond : lecture réservée admin/direction.
-- Retour arrière :
--   Sur base vide : db reset. Sur base utilisée : drop des 4 tables + drop
--   columns/additive rollback (les colonnes supprimées perdent l'historique de
--   corbeille — à ne faire qu'après validation complète).
-- =============================================================================

-- 1. Colonnes de cycle de vie sur documents (strictement additives) --------------
alter table public.documents
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles(id),
  add column deleted_reason text,
  add column supersedes_id uuid references public.documents(id),
  add column family_key text;

alter table public.documents
  add constraint documents_deletion_complete
  check (deleted_at is null or (deleted_by is not null and deleted_reason is not null));

create index documents_family_idx on public.documents(family_key, document_version desc)
  where family_key is not null;
create index documents_deleted_idx on public.documents(deleted_at)
  where deleted_at is not null;

-- 2. Uploads en attente de rattachement (staging vers la bibliothèque) -----------
create table public.document_uploads (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null
    check (bucket_id in ('ebi-documents','ebi-payment-proofs','ebi-field-proofs')),
  storage_path text not null unique,
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes > 0),
  uploaded_by uuid not null references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  status text not null default 'staged' check (status in ('staged','attached','orphan')),
  document_id uuid references public.documents(id),
  created_at timestamptz not null default now()
);
create index document_uploads_status_idx on public.document_uploads(status, uploaded_at desc);

-- 3. Journal d'accès aux documents (append-only, alimenté par RPC) ---------------
create table public.document_access_logs (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.documents(id),
  actor_id uuid not null references public.profiles(id),
  action text not null check (action in ('view','download','emit','void','delete','restore')),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index document_access_logs_doc_idx on public.document_access_logs(document_id, occurred_at desc);

-- 4. Liens polymorphes document ↔ entité métier -----------------------------------
create table public.document_links (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  entity_table text not null check (entity_table in (
    'orders','payments','commercial_proposals','expenses','field_expenses',
    'import_batches','tenders','projects','purchase_orders','supplier_invoices',
    'deliveries','invoices')),
  entity_id uuid not null,
  link_role text not null default 'attachment'
    check (link_role in ('source','attachment','output')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (document_id, entity_table, entity_id, link_role)
);
create index document_links_entity_idx on public.document_links(entity_table, entity_id);

-- 5. Réconciliation stock objet ↔ base (audit R2) ---------------------------------
create table public.document_reconciliation (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  storage_path text not null unique,
  expected_sha256 text,
  found_sha256 text,
  status text not null check (status in ('missing','orphan','hash_mismatch','resolved')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  notes text
);
create index document_reconciliation_status_idx on public.document_reconciliation(status, detected_at desc);

-- 6. RLS : lecture seule partout, écritures via RPC uniquement ---------------------
alter table public.document_uploads enable row level security;
alter table public.document_access_logs enable row level security;
alter table public.document_links enable row level security;
alter table public.document_reconciliation enable row level security;
revoke all on public.document_uploads, public.document_access_logs,
  public.document_links, public.document_reconciliation from anon;
revoke insert, update, delete on public.document_uploads, public.document_access_logs,
  public.document_links, public.document_reconciliation from authenticated;
grant select on public.document_uploads, public.document_access_logs,
  public.document_links, public.document_reconciliation to authenticated;

-- Uploads : le déposant voit ses propres dépôts, la bibliothèque est visible
-- avec la permission bibliothèque.
create policy document_uploads_select on public.document_uploads for select to authenticated
using (
  (select private.permits('bibliotheque','select'))
  or uploaded_by = (select auth.uid())
);

-- Journal et liens : la visibilité suit celle du document lui-même.
create policy document_access_logs_select on public.document_access_logs for select to authenticated
using (exists (select 1 from public.documents d where d.id = document_id));
create policy document_links_select on public.document_links for select to authenticated
using (exists (select 1 from public.documents d where d.id = document_id));

-- Réconciliation : outil d'administration (module parametres).
create policy document_reconciliation_select on public.document_reconciliation for select to authenticated
using ((select private.permits('parametres','select')));

create policy active_profile_gate on public.document_uploads
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
create policy active_profile_gate on public.document_access_logs
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
create policy active_profile_gate on public.document_links
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
create policy active_profile_gate on public.document_reconciliation
as restrictive for all to authenticated
using ((select private.current_role_code()) is not null)
with check ((select private.current_role_code()) is not null);
