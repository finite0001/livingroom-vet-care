begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(19);

-- Synthetic identities only; the whole test rolls back.
insert into auth.users (id, email, raw_user_meta_data) values
 ('10000000-0000-4000-8000-000000000001', 'owner@example.test', '{"first_name":"Test","last_name":"Owner"}'),
 ('10000000-0000-4000-8000-000000000002', 'staff@example.test', '{"first_name":"Test","last_name":"Staff","role":"ADMIN"}'),
 ('10000000-0000-4000-8000-000000000003', 'inactive@example.test', '{"first_name":"Test","last_name":"Inactive"}');
update public.profiles set role = 'ADMIN' where id = '10000000-0000-4000-8000-000000000001';
update public.user_roles set role = 'ADMIN' where user_id = '10000000-0000-4000-8000-000000000001';
update public.profiles set is_active = false where id = '10000000-0000-4000-8000-000000000003';
insert into public.clients (id, first_name, last_name, full_name)
values ('20000000-0000-4000-8000-000000000001', 'Synthetic', 'Client', 'Synthetic Client');

select is((select role::text from public.profiles where id = '10000000-0000-4000-8000-000000000002'), 'STAFF', 'User metadata cannot grant ADMIN');
select is((select role::text from public.user_roles where user_id = '10000000-0000-4000-8000-000000000002'), 'STAFF', 'Role mapping ignores user metadata');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.clients where id = '20000000-0000-4000-8000-000000000001'), 1::bigint, 'Active staff can access clients');
select throws_ok($$update public.profiles set role = 'ADMIN' where id = '10000000-0000-4000-8000-000000000002'$$, 'P0001', 'Only admins can change profile role', 'Staff cannot promote own profile');
select throws_ok($$select public.admin_update_staff_role('10000000-0000-4000-8000-000000000002', 'ADMIN')$$, 'P0001', 'Only admins can change staff roles', 'Staff cannot call admin role RPC');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*) from public.clients where id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'Inactive staff cannot access clients');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*) from public.clients where id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'Authenticated identity without staff profile has no client access');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.admin_set_staff_active('10000000-0000-4000-8000-000000000001', false)$$, 'P0001', 'Cannot deactivate the last active admin', 'Last active admin cannot be disabled');
select throws_ok($$select public.admin_update_staff_role('10000000-0000-4000-8000-000000000001', 'STAFF')$$, 'P0001', 'Cannot remove the last active admin', 'Last active admin cannot be demoted');
select lives_ok($$select public.admin_update_staff_role('10000000-0000-4000-8000-000000000002', 'DVM')$$, 'Active admin can assign staff role');

reset role;
select ok(not has_table_privilege('anon', 'public.clients', 'SELECT'), 'Anonymous callers have no client table read grant');
select ok(not has_table_privilege('authenticated', 'public.clients', 'TRUNCATE'), 'Authenticated callers cannot bypass RLS with TRUNCATE');
select ok(not has_table_privilege('anon', 'public.contact_submissions', 'SELECT'), 'Anonymous callers cannot read contact submissions');
select ok(not has_table_privilege('authenticated', 'public.audit_logs', 'INSERT'), 'Staff cannot forge system audit rows');
select ok(not has_table_privilege('authenticated', 'public.outbound_message_attempts', 'UPDATE'), 'Staff cannot forge delivery attempts');
select ok(has_table_privilege('service_role', 'public.messages', 'INSERT'), 'Provider ingestion has an explicit message insert grant');
select is((select count(*) from pg_tables where schemaname = 'public' and (
  has_table_privilege('anon', format('%I.%I', schemaname, tablename), 'TRUNCATE') or
  has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'TRUNCATE') or
  has_table_privilege('service_role', format('%I.%I', schemaname, tablename), 'TRUNCATE')
)), 0::bigint, 'No application role has TRUNCATE on any public table');
set local role anon;
select lives_ok($$insert into public.contact_submissions(name,email,subject,message) values ('Synthetic','contact@example.test','Test','Rollback only')$$, 'Public contact form can insert');
select throws_ok($$select * from public.clients$$, '42501', 'permission denied for table clients', 'Anonymous direct client reads fail');
reset role;
select * from finish();
rollback;
