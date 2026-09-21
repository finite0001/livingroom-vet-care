begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values('ee400000-0000-4000-8000-000000000001','cleanup@example.test','{}');
update public.profiles set is_active = true where id in ('ee400000-0000-4000-8000-000000000001');
insert into public.user_roles (user_id, role) values ('ee400000-0000-4000-8000-000000000001','STAFF');

insert into user_roles(user_id,role) values('ee400000-0000-4000-8000-000000000001','ADMIN');
select set_config('request.jwt.claims','{"sub":"ee400000-0000-4000-8000-000000000001","role":"authenticated"}',true);
create temp table fx(k text primary key,id uuid);grant all on fx to authenticated,service_role;
create temp table evidence(v jsonb);grant all on evidence to authenticated,service_role;
insert into fx select 'client',id from save_client(auth.uid(),null,null,'Cleanup','Fixture',null,null,'EMAIL',null,null);
insert into fx select k,gen_random_uuid() from unnest(array['conversation','abandoned','ready','uploading']) k;
insert into conversations(id,client_id) values((select id from fx where k='conversation'),(select id from fx where k='client'));
insert into conversation_attachment_uploads(id,actor_id,conversation_id,file_name,mime_type,byte_length,storage_path,status,sha256,verified_at,created_at)
 select id,auth.uid(),(select id from fx where k='conversation'),'fixture.pdf','application/pdf',5,
 auth.uid()::text||'/'||(select id::text from fx where k='conversation')||'/'||id::text||'/original',k,
 case when k='ready' then repeat('b',64) end,case when k='ready' then now() end,now()-interval '8 days'
 from fx where k in ('abandoned','ready','uploading');
insert into storage.objects(bucket_id,name,metadata,created_at)
 select 'conversation-attachment-uploads',storage_path,'{"size":5,"mimetype":"application/pdf"}',now()-interval '8 days' from conversation_attachment_uploads where actor_id=auth.uid();
set local role authenticated;
select throws_ok($$select claim_abandoned_attachment_cleanup((select id from fx where k='abandoned'),168)$$,'42501',null,'Staff cannot claim privileged cleanup');
reset role;set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select claim_abandoned_attachment_cleanup((select id from fx where k='ready'),168)$$,'42501',null,'Verified originals are never eligible');
select throws_ok($$select claim_abandoned_attachment_cleanup((select id from fx where k='uploading'),168)$$,'42501',null,'Unfinished uploads are retained');
select throws_ok($$select claim_abandoned_attachment_cleanup((select id from fx where k='abandoned'),0)$$,'23514',null,'Grace setting must be explicit and bounded');
select is(claim_abandoned_attachment_cleanup((select id from fx where k='abandoned'),720),null::jsonb,'Younger objects wait for configured grace');
select is(list_abandoned_attachment_cleanup_candidates(168,100),jsonb_build_array(jsonb_build_object('upload_id',(select id from fx where k='abandoned'),'reason','abandoned_object')),'Discovery lists only aged abandoned object identity');
select throws_ok($$select list_abandoned_attachment_cleanup_candidates(168,101)$$,'23514',null,'Discovery rejects unbounded batches');
insert into evidence select claim_abandoned_attachment_cleanup((select id from fx where k='abandoned'),168);
select is(list_abandoned_attachment_cleanup_candidates(168,100),'[]'::jsonb,'Discovery excludes active cleanup lease');
select is((select v->>'uploadId' from evidence),(select id::text from fx where k='abandoned'),'Cleanup lease binds abandoned reservation');
select throws_ok($$select claim_abandoned_attachment_cleanup((select id from fx where k='abandoned'),168)$$,'40001',null,'Competing cleanup claim cannot steal live lease');
select throws_ok($$select revalidate_abandoned_attachment_cleanup((select (v->>'id')::uuid from evidence),gen_random_uuid())$$,'42501',null,'Wrong cleanup token cannot revalidate');
select throws_ok($$select finalize_abandoned_attachment_cleanup((select (v->>'id')::uuid from evidence),(select (v->>'token')::uuid from evidence))$$,'23514',null,'Existing object prevents completion');
reset role;
-- Synthetic metadata-only absence. Production adapter must remove through Storage API.
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='conversation-attachment-uploads' and name=(select v->>'path' from evidence);
set local storage.allow_delete_query='false';
set local role service_role;
select is(finalize_abandoned_attachment_cleanup((select (v->>'id')::uuid from evidence),(select (v->>'token')::uuid from evidence))->>'status','complete','Confirmed absence permits completion receipt');
select is(finalize_abandoned_attachment_cleanup((select (v->>'id')::uuid from evidence),(select (v->>'token')::uuid from evidence))->>'status','complete','Lost completion response recovers the same receipt');
select throws_ok($$select finalize_abandoned_attachment_cleanup((select (v->>'id')::uuid from evidence),gen_random_uuid())$$,'42501',null,'Different token cannot replay completion');
reset role;
select throws_ok($$delete from abandoned_attachment_cleanup$$,'23514',null,'Completed cleanup evidence remains immutable');
select is((select count(*) from conversation_attachment_uploads where actor_id='ee400000-0000-4000-8000-000000000001'),3::bigint,'Cleanup preserves all reservation evidence');
set local role service_role;
select is(list_abandoned_attachment_cleanup_candidates(168,100),'[]'::jsonb,'Completed absent original is not offered for cleanup again');
reset role;
select ok(not has_function_privilege('authenticated','list_abandoned_attachment_cleanup_candidates(integer,integer)','execute'),'Staff cannot enumerate cleanup candidates');
select * from finish();rollback;
