-- =============================================================================
-- Tests pgTAP — PROMPT 3 : sécurité, rôles, permissions, MFA (pgm3_security.sql)
-- =============================================================================
-- Prérequis : base migrée (migrations 1-25) + extension pgtap.
--   supabase start && supabase db reset
--   psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -c 'create extension if not exists pgtap with schema extensions'
--   psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/pgm3_security.sql
-- Exécution dans une transaction unique : tout est annulé à la fin (rollback).
-- Les sessions simulées utilisent set_config('request.jwt.claims', …) et
-- set local role authenticated, comme en production via PostgREST.
-- Les 6 scénarios imposés par PROMPT 3 sont étiquetés [SCÉNARIO n].
-- =============================================================================
begin;
select plan(94);

-- ===== 1. Structure : 23 tables des extensions M16-M24 =========================
select has_table('public.roles', '[1] table roles');
select has_table('public.role_permissions', '[2] table role_permissions');
select has_table('public.official_sequences', '[3] table official_sequences');
select has_table('public.company_roles', '[4] table company_roles');
select has_table('public.document_uploads', '[5] table document_uploads');
select has_table('public.document_access_logs', '[6] table document_access_logs');
select has_table('public.document_links', '[7] table document_links');
select has_table('public.document_reconciliation', '[8] table document_reconciliation');
select has_table('public.tenders', '[9] table tenders');
select has_table('public.tender_items', '[10] table tender_items');
select has_table('public.tender_quotes', '[11] table tender_quotes');
select has_table('public.tender_events', '[12] table tender_events');
select has_table('public.projects', '[13] table projects');
select has_table('public.purchase_orders', '[14] table purchase_orders');
select has_table('public.purchase_order_lines', '[15] table purchase_order_lines');
select has_table('public.supplier_invoices', '[16] table supplier_invoices');
select has_table('public.supplier_payments', '[17] table supplier_payments');
select has_table('public.supplier_payment_events', '[18] table supplier_payment_events');
select has_table('public.deliveries', '[19] table deliveries');
select has_table('public.delivery_lines', '[20] table delivery_lines');
select has_table('public.invoices', '[21] table invoices');
select has_table('public.invoice_lines', '[22] table invoice_lines');
select has_table('public.invoice_events', '[23] table invoice_events');

-- ===== 2. RLS active + porte restrictive sur les 23 tables =====================
select is(count(*), 23::bigint, '[24] RLS active sur les 23 tables des extensions')
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity
  and relname in ('roles','role_permissions','official_sequences','company_roles',
    'document_uploads','document_access_logs','document_links','document_reconciliation',
    'tenders','tender_items','tender_quotes','tender_events','projects',
    'purchase_orders','purchase_order_lines','supplier_invoices','supplier_payments',
    'supplier_payment_events','deliveries','delivery_lines','invoices','invoice_lines',
    'invoice_events');
select is(count(*), 23::bigint, '[25] porte active_profile_gate sur les 23 tables')
from pg_policy p
join pg_class c on c.oid = p.polrelid
where c.relnamespace = 'public'::regnamespace and p.polname = 'active_profile_gate'
  and c.relname in ('roles','role_permissions','official_sequences','company_roles',
    'document_uploads','document_access_logs','document_links','document_reconciliation',
    'tenders','tender_items','tender_quotes','tender_events','projects',
    'purchase_orders','purchase_order_lines','supplier_invoices','supplier_payments',
    'supplier_payment_events','deliveries','delivery_lines','invoices','invoice_lines',
    'invoice_events');

-- ===== 3. Privilèges (leastes, révoques et intentions) =========================
select ok(has_table_privilege('authenticated', 'public.roles', 'SELECT'),
  '[26] authenticated lit roles (écran de connexion)');
select ok(has_table_privilege('authenticated', 'public.role_permissions', 'SELECT'),
  '[27] authenticated lit role_permissions (résolution des permissions)');
select ok(not has_table_privilege('authenticated', 'public.roles', 'INSERT'),
  '[28] authenticated ne crée pas de rôle');
select ok(not has_table_privilege('authenticated', 'public.roles', 'UPDATE'),
  '[29] authenticated ne modifie pas les rôles');
select ok(not has_table_privilege('authenticated', 'public.roles', 'DELETE'),
  '[30] authenticated ne supprime pas de rôle');
select ok(has_table_privilege('authenticated', 'public.role_permissions', 'UPDATE'),
  '[31] UPDATE role_permissions accordé (voulu : encadré par politique admin+MFA)');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
  '[32] régression : authenticated ne modifie toujours pas profiles (M14)');
select ok(not has_function_privilege('authenticated', 'public.next_official_number(text)', 'EXECUTE'),
  '[33] authenticated n''appelle pas directement la numérotation officielle');
select ok(has_function_privilege('authenticated', 'private.permits(text,text)', 'EXECUTE'),
  '[34] authenticated résolve ses permissions via permits()');
select ok(has_function_privilege('authenticated', 'public.admin_caller_gate()', 'EXECUTE'),
  '[35] authenticated interroge la porte admin_caller_gate');
select ok(has_function_privilege('authenticated', 'public.admin_set_profile_active(uuid,boolean)', 'EXECUTE'),
  '[36] authenticated appelle admin_set_profile_active (garde interne)');
select ok(has_function_privilege('authenticated', 'public.admin_bootstrap_profile(uuid,text)', 'EXECUTE'),
  '[37] authenticated appelle admin_bootstrap_profile (garde interne)');

-- ===== 4. Schéma private et flux d'invitation ==================================
select ok(has_schema_privilege('authenticated', 'private', 'USAGE'),
  '[38] authenticated a USAGE sur private (politiques RLS fonctionnelles)');
select ok(has_schema_privilege('supabase_auth_admin', 'private', 'USAGE'),
  '[39] supabase_auth_admin a USAGE sur private (trigger auth.users)');
select ok(has_function_privilege('supabase_auth_admin',
    'private.create_pending_profile_for_auth_user()', 'EXECUTE'),
  '[40] supabase_auth_admin exécute le trigger d''invitation');

-- ===== 5. Décision D2 : inscriptions publiques désactivées =====================
select is((select public.ebi_signup_ready()), false,
  '[41] ebi_signup_ready renvoie FALSE (invitation uniquement)');

-- ===== Fixtures ================================================================
-- Utilisateurs Auth (le trigger M15 crée des profils inactifs sales_rep).
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111101', 'admin1@ebi-imt.test',
    jsonb_build_object('full_name', 'Admin Un')),
  ('11111111-1111-1111-1111-111111111102', 'comm@ebi-imt.test',
    jsonb_build_object('full_name', 'Commercial Deux')),
  ('11111111-1111-1111-1111-111111111103', 'lect@ebi-imt.test',
    jsonb_build_object('full_name', 'Lecture Trois')),
  ('11111111-1111-1111-1111-111111111104', 'fin@ebi-imt.test',
    jsonb_build_object('full_name', 'Finance Quatre')),
  ('11111111-1111-1111-1111-111111111105', 'off@ebi-imt.test',
    jsonb_build_object('full_name', 'Désactivé Cinq')),
  ('11111111-1111-1111-1111-111111111106', 'admin2@ebi-imt.test',
    jsonb_build_object('full_name', 'Admin Six'));
update public.profiles set role = 'admin', is_active = true
  where id in ('11111111-1111-1111-1111-111111111101','11111111-1111-1111-1111-111111111106');
update public.profiles set role = 'commercial', is_active = true
  where id = '11111111-1111-1111-1111-111111111102';
update public.profiles set role = 'lecture_seule', is_active = true
  where id = '11111111-1111-1111-1111-111111111103';
update public.profiles set role = 'finance', is_active = true
  where id = '11111111-1111-1111-1111-111111111104';
insert into public.companies (legal_name) values ('Société Test SARL');

-- ===== 6. Porte admin_caller_gate ==============================================
select is((select public.admin_caller_gate()), false,
  '[42] sans session, admin_caller_gate est false');
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111101","aal":"aal2"}', false);
set local role authenticated;
select is((select public.admin_caller_gate()), true,
  '[43] admin actif avec aal2 passe la porte');
reset role;
select set_config('request.jwt.claims', '', false);

-- ===== 7. Administration des rôles et MFA ======================================
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111101"}', false);
set local role authenticated;
select throws_ok($$ select public.set_profile_role(
    '11111111-1111-1111-1111-111111111102', 'achats') $$, 'P0001',
  'second facteur \(MFA\) requis',
  '[SCÉNARIO 4][44] admin sans MFA : changement de rôle refusé');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111102"}', false);
set local role authenticated;
select throws_ok($$ select public.set_profile_role(
    '11111111-1111-1111-1111-111111111102', 'admin') $$, 'P0001',
  'only an admin may change application roles',
  '[45] auto-élévation : un non-admin ne se promeut pas admin');
select throws_ok($$ update public.profiles set role = 'admin'
    where id = '11111111-1111-1111-1111-111111111102' $$, '42501',
  '[46] écriture directe sur profiles interdite (privilège révoqué)');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111101","aal":"aal2"}', false);
set local role authenticated;
select lives_ok($$ select public.set_profile_role(
    '11111111-1111-1111-1111-111111111102', 'achats') $$,
  '[47] admin avec MFA : changement de rôle accepté');
select ok((select count(*) from public.audit_logs
    where action = 'role_change'
      and entity_id = '11111111-1111-1111-1111-111111111102') >= 1,
  '[48] changement de rôle journalisé dans audit_logs');
select lives_ok($$ select public.set_profile_role(
    '11111111-1111-1111-1111-111111111102', 'commercial') $$,
  '[49] retour au rôle commercial pour la suite des tests');
select lives_ok($$ select public.admin_set_profile_active(
    '11111111-1111-1111-1111-111111111103', false) $$,
  '[50] admin désactive lecture_seule');
select throws_ok($$ select public.admin_set_profile_active(
    '11111111-1111-1111-1111-111111111101', false) $$, 'P0001',
  'se désactiver lui-même',
  '[51] auto-désactivation refusée');
reset role;
select lives_ok($$ update public.profiles set role = 'lecture_seule'
    where id = '11111111-1111-1111-1111-111111111106' $$,
  '[52] rétrograder un admin parmi deux est permis');
select throws_ok($$ update public.profiles set role = 'commercial'
    where id = '11111111-1111-1111-1111-111111111101' $$, 'P0001',
  'protection du dernier administrateur actif',
  '[53] le dernier admin ne peut pas être rétrogradé');
select throws_ok($$ update public.profiles set is_active = false
    where id = '11111111-1111-1111-1111-111111111101' $$, 'P0001',
  'protection du dernier administrateur actif',
  '[54] le dernier admin ne peut pas être désactivé');
select throws_ok($$ delete from public.profiles
    where id = '11111111-1111-1111-1111-111111111101' $$, 'P0001',
  'protection du dernier administrateur actif',
  '[55] le dernier admin ne peut pas être supprimé');
select lives_ok($$ update public.profiles set is_active = false
    where id = '11111111-1111-1111-1111-111111111106' $$,
  '[56] l''ex-admin rétrogradé reste désactivable');

-- ===== 8. Matrice des permissions ==============================================
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111101","aal":"aal2"}', false);
set local role authenticated;
select lives_ok($$ update public.role_permissions set p_update = true
    where role = 'commercial' and module = 'facturation' $$,
  '[57] admin+MFA modifie la matrice');
select is((select p_update from public.role_permissions
    where role = 'commercial' and module = 'facturation'), true,
  '[58] la modification admin est effective');
select lives_ok($$ update public.role_permissions set p_update = false
    where role = 'commercial' and module = 'facturation' $$,
  '[59] restauration de la matrice');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111102"}', false);
set local role authenticated;
select lives_ok($$ update public.role_permissions set p_update = true
    where role = 'commercial' and module = 'facturation' $$,
  '[SCÉNARIO 5][60] non-admin « modifie » la matrice (0 ligne, filtrée)');
select is((select p_update from public.role_permissions
    where role = 'commercial' and module = 'facturation'), false,
  '[61] la matrice est inchangée pour un non-admin');
select throws_ok($$ insert into public.role_permissions (role, module)
    values ('commercial', 'facturation') $$, '42501',
  '[62] non-admin ne crée pas de permission');
select is((select private.permits('paiements','insert')), true,
  '[63] commercial : encaissements en insertion autorisés');
select is((select private.permits('facturation','insert')), false,
  '[64] commercial : facturation en insertion refusée');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111103"}', false);
set local role authenticated;
select is((select private.permits('clients','delete')), false,
  '[65] lecture_seule : suppression clients refusée');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111104"}', false);
set local role authenticated;
select is((select private.permits('achats','validate')), true,
  '[66] finance : validation des achats autorisée');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111101","aal":"aal2"}', false);
set local role authenticated;
select is((select private.permits('utilisateurs','delete')), true,
  '[67] admin : bypass matrice sur utilisateurs');
reset role;
select set_config('request.jwt.claims', '', false);

-- ===== 9. Refus d'écriture sur les tables des extensions =======================
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111102"}', false);
set local role authenticated;
select throws_ok($$ update public.invoices set notes = 'x' $$, '42501',
  '[SCÉNARIO 1][68] commercial ne modifie pas les factures');
select throws_ok($$ delete from public.invoices $$, '42501',
  '[SCÉNARIO 1][69] commercial ne supprime pas les factures');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111103"}', false);
set local role authenticated;
select throws_ok($$ delete from public.company_roles $$, '42501',
  '[SCÉNARIO 2][70] lecture_seule ne supprime pas company_roles');
select throws_ok($$ delete from public.deliveries $$, '42501',
  '[SCÉNARIO 2][71] lecture_seule ne supprime pas les livraisons');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111102"}', false);
set local role authenticated;
select throws_ok($$ update public.payments set notes = 'x' $$, '42501',
  '[72] encaissements immuables (append-only)');
select throws_ok($$ insert into public.payments (order_id, amount_xof, method)
    values (null, 1000, 'cash') $$, '42501',
  '[73] encaissements : insertion directe interdite');
select throws_ok($$ update public.supplier_payments set notes = 'x' $$, '42501',
  '[74] factures fournisseurs immuables');
select throws_ok($$ select public.next_official_number('fac') $$, '42501',
  '[75] numérotation officielle inaccessible en direct');
reset role;
select set_config('request.jwt.claims', '', false);

-- ===== 10. Profil désactivé : zéro accès ======================================
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111105"}', false);
set local role authenticated;
select is((select count(*) from public.orders), 0::bigint,
  '[SCÉNARIO 3][76] désactivé : aucune commande visible');
select is((select count(*) from public.roles), 0::bigint,
  '[SCÉNARIO 3][77] désactivé : aucun rôle visible');
select is((select count(*) from public.leads), 0::bigint,
  '[SCÉNARIO 3][78] désactivé : aucun lead visible');
select is((select private.permits('clients','select')), false,
  '[SCÉNARIO 3][79] désactivé : aucune permission');
reset role;
select set_config('request.jwt.claims', '', false);

-- ===== 11. Cloisonnement des données (scoping) ================================
select lives_ok($$ insert into public.leads (company_id, assigned_to, created_by)
    select c.id, '11111111-1111-1111-1111-111111111101',
      '11111111-1111-1111-1111-111111111102'
    from public.companies c where c.legal_name = 'Société Test SARL' $$,
  '[80] lead assigné à l''admin créé');
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111102"}', false);
set local role authenticated;
select is((select count(*) from public.leads), 0::bigint,
  '[SCÉNARIO 6][81] commercial ne voit pas le lead d''un autre');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111101","aal":"aal2"}', false);
set local role authenticated;
select is((select count(*) from public.leads), 1::bigint,
  '[SCÉNARIO 6][82] admin voit tous les leads');
reset role;
select set_config('request.jwt.claims', '', false);

-- ===== 12. Intégrité financière et métier =====================================
select lives_ok($$ insert into public.orders (order_number, company_id,
    sales_rep_id, offer_snapshot, amount_xof, created_by)
    select 'CMD-2026-999999', c.id, '11111111-1111-1111-1111-111111111102',
      '{}'::jsonb, 10000, '11111111-1111-1111-1111-111111111102'
    from public.companies c where c.legal_name = 'Société Test SARL' $$,
  '[83] commande de test créée');
select throws_ok($$ insert into public.invoices (invoice_number, order_id,
    company_id, amount_ht_xof, vat_rate_bps, amount_tva_xof, amount_ttc_xof,
    status, created_by)
    select 'FAC-2026-000001', o.id, o.company_id, 10000, 1800, 1800, 11000,
      'draft', '11111111-1111-1111-1111-111111111102'
    from public.orders o where o.order_number = 'CMD-2026-999999' $$, '23514',
  '[84] TTC incohérent rejeté (HT+TVA≠TTC)');
select throws_ok($$ insert into public.invoices (invoice_number, order_id,
    company_id, amount_ht_xof, vat_rate_bps, amount_tva_xof, amount_ttc_xof,
    status, created_by)
    select 'FAC-2026-000002', o.id, o.company_id, 10000, 1800, 1900, 11900,
      'draft', '11111111-1111-1111-1111-111111111102'
    from public.orders o where o.order_number = 'CMD-2026-999999' $$, '23514',
  '[85] TVA incohérente rejetée (TVA≠HT×taux)');
select lives_ok($$ insert into public.invoices (invoice_number, order_id,
    company_id, amount_ht_xof, vat_rate_bps, amount_tva_xof, amount_ttc_xof,
    status, created_by)
    select 'FAC-2026-000003', o.id, o.company_id, 10000, 1800, 1800, 11800,
      'draft', '11111111-1111-1111-1111-111111111102'
    from public.orders o where o.order_number = 'CMD-2026-999999' $$,
  '[86] facture cohérente acceptée');
select throws_ok($$ insert into public.deliveries (delivery_number, kind,
    created_by) values ('LIV-2026-000001', 'client_delivery',
    '11111111-1111-1111-1111-111111111102') $$, '23514',
  '[87] livraison client sans commande rejetée (exclusivité)');
select throws_ok($$ insert into public.projects (project_number, title,
    client_company_id, status, created_by)
    select 'PRO-2026-000001', 'Projet test', c.id, 'completed',
      '11111111-1111-1111-1111-111111111102'
    from public.companies c where c.legal_name = 'Société Test SARL' $$, '23514',
  '[88] projet achevé sans date de fin rejeté');
select lives_ok($$ insert into public.tenders (tender_number, title,
    organism_company_id, submission_deadline, created_by)
    select 'DAO-2026-900001', 'Appel d''offres test', c.id,
      now() + interval '30 days', '11111111-1111-1111-1111-111111111102'
    from public.companies c where c.legal_name = 'Société Test SARL' $$,
  '[89] appel d''offres de test créé');
select throws_ok($$ insert into public.tender_items (tender_id, position,
    designation, quantity, unit_price_xof, amount_xof)
    select t.id, 1, 'Prestation', 2, 1000, 3000 from public.tenders t
    where t.tender_number = 'DAO-2026-900001' $$, '23514',
  '[90] ligne DAO incohérente rejetée (qté×PU≠montant)');
select lives_ok($$ insert into public.tender_items (tender_id, position,
    designation, quantity, unit_price_xof, amount_xof)
    select t.id, 1, 'Prestation', 2, 1000, 2000 from public.tenders t
    where t.tender_number = 'DAO-2026-900001' $$,
  '[91] ligne DAO cohérente acceptée');
select is((select public.next_official_number('dao')),
  'DAO-' || to_char(now(), 'YYYY') || '-000001',
  '[92] numérotation DAO commence à 1');
select is((select public.next_official_number('dao')),
  'DAO-' || to_char(now(), 'YYYY') || '-000002',
  '[93] numérotation DAO s''incrémente');
select is((select public.next_official_number('cmd')),
  'CMD-' || to_char(now(), 'YYYY') || '-000001',
  '[94] numérotation CMD (séquence socle) commence à 1');

rollback;
