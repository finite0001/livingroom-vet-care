begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temp table rpc_matrix(signature text primary key,anonymous boolean);
insert into rpc_matrix values
 ('public.admin_set_staff_active(uuid,boolean)',false),
 ('public.admin_update_staff_role(uuid,public.user_role)',false),
 ('public.clock_in()',false),('public.clock_out()',false),
 ('public.get_consent_submission(text)',true),
 ('public.review_ezyvet_snapshot(uuid,text,uuid,uuid,text)',false);
select is(has_function_privilege('anon',signature,'execute'),anonymous,signature||' has exact anonymous grant') from rpc_matrix order by signature;
select ok(has_function_privilege('authenticated',signature,'execute'),signature||' retains authenticated execution') from rpc_matrix order by signature;
select ok(not has_function_privilege('service_role',signature,'execute'),signature||' denies service execution') from rpc_matrix order by signature;
select ok(not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'),m.signature||' denies PUBLIC execution') from rpc_matrix m join pg_proc p on p.oid=m.signature::regprocedure order by signature;

insert into auth.users(id,email,raw_user_meta_data) values
 ('b6000000-0000-4000-8000-000000000001','grant-admin@example.test','{}'),
 ('b6000000-0000-4000-8000-000000000002','grant-staff@example.test','{}'),
 ('b6000000-0000-4000-8000-000000000003','grant-inactive@example.test','{}');
update public.profiles set is_active = true where id in ('b6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000003');
insert into public.user_roles (user_id, role) values ('b6000000-0000-4000-8000-000000000001','STAFF'),('b6000000-0000-4000-8000-000000000002','STAFF'),('b6000000-0000-4000-8000-000000000003','STAFF');

insert into user_roles(user_id,role) values('b6000000-0000-4000-8000-000000000001','ADMIN');
update profiles set is_active=false where id='b6000000-0000-4000-8000-000000000003';
insert into clients(id,first_name,last_name,full_name) values('b6000000-0000-4000-8000-000000000004','Synthetic','Grant','Synthetic Grant');
insert into consent_form_templates(id,name) values('b6000000-0000-4000-8000-000000000005','Synthetic grant fixture');
insert into consent_submissions(id,template_id,client_id,access_token,expires_at) values
 ('b6000000-0000-4000-8000-000000000006','b6000000-0000-4000-8000-000000000005','b6000000-0000-4000-8000-000000000004','synthetic-grant-valid',now()+interval '1 day'),
 ('b6000000-0000-4000-8000-000000000007','b6000000-0000-4000-8000-000000000005','b6000000-0000-4000-8000-000000000004','synthetic-grant-expired',now()-interval '1 day');
insert into ezyvet_import_snapshots(id,source_origin,source_site_uid,resource,external_id,payload,payload_hash,first_seen_by) values
 ('b6000000-0000-4000-8000-000000000008','https://api.trial.ezyvet.com','synthetic-grant-site','contact','synthetic-grant','{}',repeat('a',64),'b6000000-0000-4000-8000-000000000001');

set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select is((get_consent_submission('synthetic-grant-valid')).id,'b6000000-0000-4000-8000-000000000006'::uuid,'Valid anonymous consent token still works');
select is((get_consent_submission('synthetic-grant-expired')).id,null::uuid,'Expired anonymous token returns no record');
select is((get_consent_submission('synthetic-grant-missing')).id,null::uuid,'Unknown token returns no record');
select throws_ok($$select admin_set_staff_active('b6000000-0000-4000-8000-000000000002',false)$$,'42501',null,'Anonymous administrator RPC rejected at ACL');
select throws_ok($$select admin_update_staff_role('b6000000-0000-4000-8000-000000000002','ADMIN')$$,'42501',null,'Anonymous role escalation RPC rejected at ACL');

set local role service_role;
-- Even an administrator subject cannot bypass the explicit service-role boundary.
select set_config('request.jwt.claims','{"role":"service_role","sub":"b6000000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select admin_set_staff_active('b6000000-0000-4000-8000-000000000002',false)$$,'42501',null,'Service cannot change staff state');
select throws_ok($$select admin_update_staff_role('b6000000-0000-4000-8000-000000000002','ADMIN')$$,'42501',null,'Service cannot change staff role');
select throws_ok($$select clock_in()$$,'42501',null,'Service cannot clock in');
select throws_ok($$select clock_out()$$,'42501',null,'Service cannot clock out');
select throws_ok($$select get_consent_submission('synthetic-grant-valid')$$,'42501',null,'Service cannot call public consent RPC');
select throws_ok($$select review_ezyvet_snapshot('b6000000-0000-4000-8000-000000000008','ignored',null,null,'Synthetic review')$$,'42501',null,'Service cannot author an ezyVet review');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b6000000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select admin_update_staff_role('b6000000-0000-4000-8000-000000000002','ADMIN')$$,'P0001','Only admins can change staff roles','Ordinary staff cannot self-promote');
select throws_ok($$select admin_set_staff_active('b6000000-0000-4000-8000-000000000003',true)$$,'P0001','Only admins can change staff active status','Ordinary staff cannot reactivate staff');
select throws_ok($$select review_ezyvet_snapshot('b6000000-0000-4000-8000-000000000008','ignored',null,null,'Synthetic review')$$,'42501','Active administrator required','Ordinary staff cannot review imports');
select is((clock_in()).staff_id,auth.uid(),'Active staff clock-in remains self-scoped');
select is((clock_out()).staff_id,auth.uid(),'Active staff clock-out remains self-scoped');
select is((get_consent_submission('synthetic-grant-valid')).id,'b6000000-0000-4000-8000-000000000006'::uuid,'Authenticated consent lookup retained');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b6000000-0000-4000-8000-000000000003"}',true);
select throws_ok($$select clock_in()$$,'P0001','Only active staff can clock in','Inactive staff cannot clock in');
select throws_ok($$select clock_out()$$,'P0001','Only active staff can clock out','Inactive staff cannot clock out');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b6000000-0000-4000-8000-000000000001"}',true);
select lives_ok($$select admin_update_staff_role('b6000000-0000-4000-8000-000000000002','DVM')$$,'Active administrator can still assign roles');
select lives_ok($$select admin_set_staff_active('b6000000-0000-4000-8000-000000000003',true)$$,'Active administrator can still reactivate staff');
select is((review_ezyvet_snapshot('b6000000-0000-4000-8000-000000000008','ignored',null,null,'Synthetic review')).reviewed_by,auth.uid(),'Active administrator authors the review');
select * from finish();rollback;
