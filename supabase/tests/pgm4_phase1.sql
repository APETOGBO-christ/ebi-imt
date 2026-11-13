-- =============================================================================
-- Tests pgTAP — PROMPT 4, Phase 1 : référentiel sociétés + bibliothèque (pgm4)
-- =============================================================================
-- Prérequis : base migrée (migrations 1-27) + extension pgtap.
--   supabase start && supabase db reset
--   psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -c 'create extension if not exists pgtap with schema extensions'
--   psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/pgm4_phase1.sql
-- Exécution dans une transaction unique : tout est annulé à la fin (rollback).
-- Sessions simulées comme en production via PostgREST :
--   set_config('request.jwt.claims', …) + set local role authenticated.
-- Fixtures indépendantes de pgm3 (les deux fichiers sont autonomes).
-- =============================================================================
begin;
select plan(39);

-- ===== Fixtures ================================================================
-- Utilisateurs Auth (le trigger M15 crée des profils inactifs sales_rep).
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111101', 'admin1@ebi-imt.test',
    jsonb_build_object('full_name', 'Admin Un')),
  ('11111111-1111-1111-1111-111111111102', 'achats@ebi-imt.test',
    jsonb_build_object('full_name', 'Achats Deux')),
  ('11111111-1111-1111-1111-111111111103', 'lect@ebi-imt.test',
    jsonb_build_object('full_name', 'Lecture Trois')),
  ('11111111-1111-1111-1111-111111111104', 'fin@ebi-imt.test',
    jsonb_build_object('full_name', 'Finance Quatre')),
  ('11111111-1111-1111-1111-111111111105', 'off@ebi-imt.test',
    jsonb_build_object('full_name', 'Désactivé Cinq'));
update public.profiles set role = 'admin', is_active = true
  where id = '11111111-1111-1111-1111-111111111101';
update public.profiles set role = 'achats', is_active = true
  where id = '11111111-1111-1111-1111-111111111102';
update public.profiles set role = 'lecture_seule', is_active = true
  where id = '11111111-1111-1111-1111-111111111103';
update public.profiles set role = 'finance', is_active = true
  where id = '11111111-1111-1111-1111-111111111104';
-- Profil 05 : laissé inactif (état produit par le trigger M15).
insert into public.companies (legal_name) values ('Société Test SARL');

-- Document de bibliothèque inséré hors RLS (état service, comme une Edge).
insert into public.documents (id, document_type, storage_path, content_hash,
    metadata, created_by, family_key, document_version)
values ('22222222-2222-2222-2222-222222222201', 'library_document',
  'library/2026/11/test/contrat-cadre.pdf', repeat('a', 64),
  jsonb_build_object('title', 'Contrat cadre', 'size_bytes', 10),
  '11111111-1111-1111-1111-111111111101',
  'lib-00000000-0000-0000-0000-00000000f001', 1);

-- ===== 1. Structure ajoutée en phase 1 ========================================
select has_column('public.companies', 'trade_name',
  '[1] companies.trade_name');
select has_column('public.companies', 'registration_number',
  '[2] companies.registration_number');
select has_column('public.companies', 'tax_number', '[3] companies.tax_number');
select has_column('public.companies', 'is_active', '[4] companies.is_active');
select has_column('public.contacts', 'is_active', '[5] contacts.is_active');
select has_table('public.company_activities', '[6] table company_activities');
select is((select count(*) from unnest(enum_range(null::public.document_type)) e
    where e = 'library_document'), 1,
  '[7] document_type accepte library_document');
select is(count(*), 1::bigint, '[8] RLS active sur company_activities')
from pg_class
where relnamespace = 'public'::regnamespace and relname = 'company_activities'
  and relkind = 'r' and relrowsecurity;
select is(count(*), 1::bigint,
  '[9] porte active_profile_gate sur company_activities')
from pg_policy p
join pg_class c on c.oid = p.polrelid
where c.relnamespace = 'public'::regnamespace and c.relname = 'company_activities'
  and p.polname = 'active_profile_gate';

-- ===== 2. Privileges et RPC de la phase 1 ======================================
select ok(has_function_privilege('authenticated',
    'public.document_download_allowed(uuid)', 'EXECUTE'),
  '[10] authenticated appelle document_download_allowed');
select ok(has_function_privilege('authenticated',
    'public.user_permits(text,text)', 'EXECUTE'),
  '[11] authenticated consulte user_permits');
select ok(has_function_privilege('authenticated',
    'public.company_create(text,text,text[],text,text,text,text,text,text,text,text,text)',
    'EXECUTE'),
  '[12] authenticated appelle company_create');
select ok(has_function_privilege('authenticated',
    'public.company_activity_add(uuid,uuid,text,text,text)', 'EXECUTE'),
  '[13] authenticated appelle company_activity_add');
select ok(has_function_privilege('authenticated',
    'public.document_request_delete(uuid,text)', 'EXECUTE'),
  '[14] authenticated appelle document_request_delete');
select ok(has_function_privilege('authenticated',
    'public.document_request_restore(uuid)', 'EXECUTE'),
  '[15] authenticated appelle document_request_restore');
select ok(not has_function_privilege('anon',
    'public.user_permits(text,text)', 'EXECUTE'),
  '[16] anon n''appelle pas user_permits');
select ok(not has_function_privilege('anon',
    'public.document_download_allowed(uuid)', 'EXECUTE'),
  '[17] anon n''appelle pas document_download_allowed');

-- ===== 3. Sociétés : création RPC, rôles, historique, contacts =================
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111102"}', false);
set local role authenticated;
select lives_ok($$ select public.company_create(
    'Filiale Fournisseur SARL', 'Fournisseur Filiale', array['fournisseur'],
    'Logistique', null, 'Abidjan', '+225 27 00 00 00 00',
    'contact@filiale.test', null, 'CI-ABJ-2026-B-001', null, null) $$,
  '[18] achats crée une société (RPC)');
select is((select count(*) from public.companies
    where legal_name = 'Filiale Fournisseur SARL'), 1,
  '[19] la société créée est visible par achats (permits fournisseurs)');
select is((select count(*) from public.company_roles cr
    join public.companies c on c.id = cr.company_id
    where c.legal_name = 'Filiale Fournisseur SARL'
      and cr.role_code = 'fournisseur'), 1,
  '[20] le rôle fournisseur est posé dans company_roles');
select ok((select count(*) from public.audit_logs
    where action = 'company_created'
      and entity_table = 'companies') >= 1,
  '[21] la création est journalisée (company_created)');
select lives_ok($$ select public.company_activity_add(
    (select id from public.companies where legal_name = 'Filiale Fournisseur SARL'),
    null, 'call', 'Premier contact', null) $$,
  '[22] achats ajoute un échange au niveau société');
select is((select count(*) from public.company_activities
    where subject = 'Premier contact'), 1,
  '[23] l''échange est enregistré');
select lives_ok($$ insert into public.contacts (company_id, full_name)
    select id, 'Alice Gbagbo' from public.companies
    where legal_name = 'Filiale Fournisseur SARL' $$,
  '[24] achats insère un contact directement (politique élargie)');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111103"}', false);
set local role authenticated;
select throws_ok($$ select public.company_create(
    'Société Non Autorisée', null, null) $$, 'P0001',
  'permission de création requise',
  '[25] lecture_seule ne crée pas de société');
reset role;
select set_config('request.jwt.claims', '', false);

-- ===== 4. Bibliothèque : lecture, corbeille, journalisation ====================
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111103"}', false);
set local role authenticated;
select is((select count(*) from public.documents
    where document_type = 'library_document'), 1,
  '[26] lecture_seule voit les documents de bibliothèque (permits)');
select is((select public.document_download_allowed(
    '22222222-2222-2222-2222-222222222201')), true,
  '[27] lecture_seule peut télécharger un document actif');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111104"}', false);
set local role authenticated;
select is((select count(*) from public.documents
    where document_type = 'library_document'), 1,
  '[28] finance voit aussi la bibliothèque');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111105"}', false);
set local role authenticated;
select is((select count(*) from public.documents
    where document_type = 'library_document'), 0,
  '[29] un profil inactif ne voit aucun document');
select is((select public.document_download_allowed(
    '22222222-2222-2222-2222-222222222201')), false,
  '[30] un profil inactif ne télécharge pas');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111103"}', false);
set local role authenticated;
select throws_ok($$ insert into public.documents (document_type, storage_path,
    created_by) values ('library_document', 'library/x/y.pdf',
    '11111111-1111-1111-1111-111111111103') $$, '42501',
  'permission denied',
  '[31] écriture directe sur documents interdite (privilege revoked)');
select throws_ok($$ select public.document_request_delete(
    '22222222-2222-2222-2222-222222222201', 'test') $$, 'P0001',
  'permission de suppression requise',
  '[32] lecture_seule ne supprime pas (bibliothèque)');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111101","aal":"aal2"}', false);
set local role authenticated;
select lives_ok($$ select public.document_request_delete(
    '22222222-2222-2222-2222-222222222201', 'document obsolète') $$,
  '[33] admin+MFA supprime un document (corbeille logique)');
select is((select deleted_at is not null from public.documents
    where id = '22222222-2222-2222-2222-222222222201'), true,
  '[34] le document est marqué supprimé');
select ok((select count(*) from public.audit_logs
    where action = 'document_deleted'
      and entity_id = '22222222-2222-2222-2222-222222222201') >= 1,
  '[35] la suppression est journalisée dans audit_logs');
select ok((select count(*) from public.document_access_logs
    where document_id = '22222222-2222-2222-2222-222222222201'
      and action = 'delete') >= 1,
  '[36] la suppression est journalisée dans document_access_logs');
select lives_ok($$ select public.document_request_restore(
    '22222222-2222-2222-2222-222222222201') $$,
  '[37] admin+MFA restaure le document');
select is((select deleted_at is null from public.documents
    where id = '22222222-2222-2222-2222-222222222201'), true,
  '[38] le document restauré redevient actif');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111103"}', false);
set local role authenticated;
select is((select public.document_download_allowed(
    '22222222-2222-2222-2222-222222222201')), true,
  '[39] le document restauré est de nouveau téléchargeable');
reset role;
select set_config('request.jwt.claims', '', false);

select * from finish();
rollback;
