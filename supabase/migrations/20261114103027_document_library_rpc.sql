-- =============================================================================
-- Migration 27 — Bibliothèque documentaire : RPC utilisateur et zone R2
-- =============================================================================
-- Objectif :
--   Préparer le stockage R2 de la bibliothèque et donner aux fonctions Edge
--   les portes SQL nécessaires, exécutées dans le contexte de l'utilisateur :
--   - document_uploads accepte la zone R2 (bucket_id 'r2-library') en plus
--     des zones de transit Supabase Storage du socle ;
--   - document_links peut rattacher un document à une société ou un contact ;
--   - document_access_logs peut journaliser l'action 'upload' ;
--   - la politique de lecture de documents s'ouvre au module bibliothèque
--     (les documents officiels du socle gardent leur visibilité propre) ;
--   - RPC document_download_allowed (contrôle de téléchargement) et
--     document_request_delete / document_request_restore (corbeille).
-- Tables concernées :
--   Contraintes de public.document_uploads / document_links /
--   document_access_logs ; politique documents_select ; 3 RPC (aucune
--   nouvelle table, le total reste 66).
-- Dépendances :
--   Migrations 1-26 (documents étendu M19, helpers permits, audit).
-- Risques :
--   - Le contrôle d'intégrité SHA-256 complet (téléchargement de l'objet R2
--     et calcul côté Edge) est plafonné par R2_VERIFY_MAX_BYTES : au-delà,
--     la confirmation vérifie la taille (HEAD) et enregistre le hash déclaré
--     par le navigateur — documenté dans docs/user-societes-bibliotheque.md.
--   - Suppression et restauration exigent la permission « supprimer » du
--     module bibliothèque (défaut : admin) — cohérent avec l'architecture v2.
-- Retour arrière :
--   Sur base vide : db reset. Sur base utilisée : drop des 3 RPC, recréer la
--   politique documents_select précédente (corps dans la migration du socle
--   commercial, 20261012212909) puis les contraintes élargies (corps
--   ci-dessous en commentaire).
-- =============================================================================

-- 1. Zone R2 pour les dépôts de bibliothèque --------------------------------------
alter table public.document_uploads drop constraint document_uploads_bucket_id_check;
alter table public.document_uploads
  add constraint document_uploads_bucket_id_check
  check (bucket_id in ('ebi-documents','ebi-payment-proofs','ebi-field-proofs','r2-library'));

-- 2. Rattachement aux sociétés et contacts ----------------------------------------
alter table public.document_links drop constraint document_links_entity_table_check;
alter table public.document_links
  add constraint document_links_entity_table_check
  check (entity_table in (
    'orders','payments','commercial_proposals','expenses','field_expenses',
    'import_batches','tenders','projects','purchase_orders','supplier_invoices',
    'deliveries','invoices','companies','contacts'));

-- 3. Journalisation des dépôts -----------------------------------------------------
alter table public.document_access_logs drop constraint document_access_logs_action_check;
alter table public.document_access_logs
  add constraint document_access_logs_action_check
  check (action in ('view','download','emit','void','delete','restore','upload'));

-- 4. Lecture des documents : module bibliothèque -----------------------------------
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated
using (
  (select private.crm_active())
  and (
    (select private.can_manage_all())
    or (proposal_id is not null and exists (
      select 1 from public.commercial_proposals p where p.id = proposal_id
    ))
    or (order_id is not null and exists (
      select 1 from public.orders o where o.id = order_id
    ))
    or (select private.permits('bibliotheque','select'))
  )
);

-- 5. Contrôle de téléchargement (contexte utilisateur, RLS appliqué) ---------------
create or replace function public.document_download_allowed(p_document_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (select private.permits('bibliotheque','select')) and exists (
    select 1 from public.documents d
    where d.id = p_document_id and d.deleted_at is null
  )
$$;
revoke all on function public.document_download_allowed(uuid) from public, anon;
grant execute on function public.document_download_allowed(uuid) to authenticated;

-- 5bis. Consultation de ses propres permissions (portes Edge, côté client) --------
create or replace function public.user_permits(p_module text, p_action text)
returns boolean
language sql
stable
set search_path = ''
as $$ select (select private.permits(p_module, p_action)) $$;
revoke all on function public.user_permits(text, text) from public, anon;
grant execute on function public.user_permits(text, text) to authenticated;

-- 6. Corbeille logique (permission « supprimer » du module bibliothèque) -----------
create or replace function public.document_request_delete(p_document_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not coalesce((select private.permits('bibliotheque','delete')), false) then
    raise exception 'permission de suppression requise (bibliothèque)';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'motif de suppression requis';
  end if;
  update public.documents
    set deleted_at = pg_catalog.now(), deleted_by = v_uid,
      deleted_reason = pg_catalog.btrim(p_reason)
    where id = p_document_id and deleted_at is null;
  if not found then raise exception 'document introuvable ou déjà supprimé'; end if;
  insert into public.document_access_logs(document_id, actor_id, action, metadata)
    values (p_document_id, v_uid, 'delete',
      pg_catalog.jsonb_build_object('reason', pg_catalog.btrim(p_reason)));
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
    values (v_uid, 'document_deleted', 'documents', p_document_id,
      pg_catalog.jsonb_build_object('reason', pg_catalog.btrim(p_reason)));
end $$;
revoke all on function public.document_request_delete(uuid, text) from public, anon;
grant execute on function public.document_request_delete(uuid, text) to authenticated;

create or replace function public.document_request_restore(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not coalesce((select private.permits('bibliotheque','delete')), false) then
    raise exception 'permission de restauration requise (bibliothèque)';
  end if;
  update public.documents
    set deleted_at = null, deleted_by = null, deleted_reason = null
    where id = p_document_id and deleted_at is not null;
  if not found then raise exception 'document introuvable ou non supprimé'; end if;
  insert into public.document_access_logs(document_id, actor_id, action, metadata)
    values (p_document_id, v_uid, 'restore', '{}'::jsonb);
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
    values (v_uid, 'document_restored', 'documents', p_document_id, '{}'::jsonb);
end $$;
revoke all on function public.document_request_restore(uuid) from public, anon;
grant execute on function public.document_request_restore(uuid) to authenticated;
