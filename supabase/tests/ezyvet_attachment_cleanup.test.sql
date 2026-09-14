begin;create extension if not exists pgtap with schema extensions;set local search_path=public,extensions;select no_plan();
-- Disposable metadata-only Storage fixture. Mirror the Storage service's delete
-- transaction flag to exercise row policies; never use SQL deletion in production.
set local storage.allow_delete_query='true';
-- FIXTURE_BEGIN: owner-only synthetic source observations and reviewed mapping.
insert into auth.users(id,email,raw_user_meta_data) values('db560000-0000-4000-8000-000000000001','clinical-import-admin@example.test','{}'),('db560000-0000-4000-8000-000000000002','clinical-import-other@example.test','{}');
insert into user_roles(user_id,role) values('db560000-0000-4000-8000-000000000001','ADMIN'),('db560000-0000-4000-8000-000000000002','ADMIN');
create temp table fx(k text primary key,id uuid);create temp table data(k text primary key,v jsonb);grant all on fx,data to authenticated,service_role;
set local role authenticated;select set_config('request.jwt.claims','{"sub":"db560000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fx select 'client',id from save_client(auth.uid(),null,null,'Clinical','Import','+13035550199','clinical-import@example.test','EMAIL',null,null);
insert into fx select 'pet',id from save_patient(null,(select id from fx where k='client'),null,'Scoped dog','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
insert into fx select k,gen_random_uuid() from unnest(array['mapping','mapping2','snapshot','snapshot2','legacy','terminal','run','history','other-run']) k;
reset role;
insert into ezyvet_import_snapshots(id,source_origin,source_site_uid,resource,external_id,payload,payload_hash,first_seen_by) select id,'https://api.trial.ezyvet.com','prescriptionitem-test-site','animal',case when k='snapshot' then '77' else '88' end,jsonb_build_object('id',case when k='snapshot' then 77 else 88 end),k,'db560000-0000-4000-8000-000000000001' from fx where k in ('snapshot','snapshot2');
insert into ezyvet_record_links(id,request_id,request_hash,source_origin,source_site_uid,resource,external_id,snapshot_id,head_version,client_id,pet_id,local_version,action,reason,approved_by)
select id,gen_random_uuid(),k,'https://api.trial.ezyvet.com','prescriptionitem-test-site','animal',case when k='mapping' then '77' else '88' end,(select id from fx where k=case when m.k='mapping' then 'snapshot' else 'snapshot2' end),1,(select id from fx where k='client'),(select id from fx where k='pet'),1,'link','Synthetic approved mapping','db560000-0000-4000-8000-000000000001' from fx m where k in ('mapping','mapping2');
insert into ezyvet_identity_heads(source_origin,source_site_uid,resource,external_id,snapshot_id,version)
select source_origin,source_site_uid,resource,external_id,id,1 from ezyvet_import_snapshots where id=(select id from fx where k='snapshot');
insert into fx select k,gen_random_uuid() from unnest(array['request','request2','tombstone','consult-source','consult-run','consult-request']) k;
insert into data select 'run',claim_ezyvet_attachment_import((select id from fx where k='run'),'db560000-0000-4000-8000-000000000001','prescriptionitem-test-site','https://api.trial.ezyvet.com',(select id from fx where k='mapping'),'Animal',(select id from fx where k='snapshot'),'snapshot',1);
select stage_ezyvet_import_page((select id from fx where k='run'),'db560000-0000-4000-8000-000000000001',(select (v->>'lease_id')::uuid from data where k='run'),1,false,'[{"external_id":"701","payload":{"id":701,"record_type":"Animal","record_id":77,"mime_type":"application/pdf","file_download_url":"https://untrusted.example.test/file","name":"Source file"}}]');
insert into data select 'observation',jsonb_build_object('snapshot_id',s.id,'hash',s.payload_hash,'version',h.version) from ezyvet_import_snapshots s join ezyvet_identity_heads h on h.snapshot_id=s.id where s.resource='attachment' and s.external_id='701';
insert into data values('side-effects',jsonb_build_object('documents',(select count(*) from patient_documents),'treatments',(select count(*) from patient_treatments),'invoices',(select count(*) from billing_invoices),'stock',(select count(*) from inventory_movements),'outbox',(select count(*) from communication_outbox)));
create function pg_temp.prepare(k text default 'request') returns jsonb language sql as $$
 select prepare_ezyvet_attachment_download((select id from fx where fx.k=$1),(select id from fx where fx.k='pet'),(select id from fx where fx.k='run'),1,(v->>'snapshot_id')::uuid,v->>'hash',(v->>'version')::integer) from data where data.k='observation';
$$;
set local role authenticated;
insert into data select 'saved',pg_temp.prepare();
insert into data select 'saved2',pg_temp.prepare('request2');
reset role;
create function pg_temp.claim(k text default 'request') returns jsonb language sql as $$
 select claim_ezyvet_attachment_download((select id from fx where fx.k=$1),'db560000-0000-4000-8000-000000000001',(select id from fx where fx.k='pet'),(select v#>>'{request,request_hash}' from data where data.k='saved'));
$$;
create function pg_temp.fail(code text,seconds integer,lease_key text default 'lease') returns jsonb language sql as $$
 select fail_ezyvet_attachment_download((select id from fx where fx.k='request'),'db560000-0000-4000-8000-000000000001',(select (v->>'lease_id')::uuid from data where data.k=$3),(select v#>>'{request,request_hash}' from data where data.k='saved'),$1,$2);
$$;
create function pg_temp.reserve(lease_key text default 'lease',sha text default repeat('a',64),mime text default 'application/pdf') returns jsonb language sql as $$
 select prepare_ezyvet_attachment_capture((select id from fx where k='request'),'db560000-0000-4000-8000-000000000001',(select (v->>'lease_id')::uuid from data where k=$1),(select v#>>'{request,request_hash}' from data where k='saved'),$2,37,$3,(select v#>'{request,source_context,attachment_metadata}' from data where k='saved'),(select v#>'{request,source_context,attachment_metadata}' from data where k='saved'));
$$;
create function pg_temp.complete(lease_key text default 'lease',sha text default repeat('a',64)) returns jsonb language sql as $$
 select complete_ezyvet_attachment_capture((select id from fx where k='request'),'db560000-0000-4000-8000-000000000001',(select (v->>'lease_id')::uuid from data where k=$1),(select v#>>'{request,request_hash}' from data where k='saved'),(select v->>'intent_hash' from data where k='intent'),$2,37,'application/pdf',(select v#>'{request,source_context,attachment_metadata}' from data where k='saved'));
$$;

update ezyvet_import_runs set retry_after=null,lease_until=null where id=(select id from fx where k='run');
insert into data select 'lease',pg_temp.claim();
insert into data select 'intent',pg_temp.reserve();
insert into fx select k,gen_random_uuid() from unnest(array['cleanup','cleanup2','cleanup3','cleanup4']) k;
create function pg_temp.cleanup(k text default 'cleanup') returns jsonb language sql as $$
 select claim_ezyvet_attachment_cleanup((select id from fx where fx.k=$1),(select id from fx where fx.k='request'),'db560000-0000-4000-8000-000000000001',(select id from fx where fx.k='pet'),(select v#>>'{request,request_hash}' from data where data.k='saved'));
$$;
create function pg_temp.cleaned(k text default 'cleanup',verified boolean default true) returns jsonb language sql as $$
 select complete_ezyvet_attachment_cleanup((select id from fx where fx.k=$1),(select id from fx where fx.k='request'),'db560000-0000-4000-8000-000000000001',(select (v#>>'{attempt,lease_id}')::uuid from data where data.k=$1),(select v#>>'{request,request_hash}' from data where data.k='saved'),(select v->>'intent_hash' from data where data.k='intent'),$2);
$$;
select ok(not has_table_privilege('authenticated','ezyvet_attachment_cleanup_attempts','select'),'Cleanup lease table is private');
select ok(not has_table_privilege('service_role','ezyvet_attachment_cleanup_receipts','insert'),'Service cannot bypass completion with direct receipt writes');
select ok(not has_function_privilege('authenticated','claim_ezyvet_attachment_cleanup(uuid,uuid,uuid,uuid,text)','execute'),'Browser cannot claim deletion leases');
select ok(not has_function_privilege('authenticated','complete_ezyvet_attachment_cleanup(uuid,uuid,uuid,uuid,text,text,boolean)','execute'),'Browser cannot assert physical absence');
set local role service_role;
select throws_ok($$select pg_temp.cleanup()$$,'23514','Abandoned attachment cleanup not ready','Recoverable pending evidence is never cleanup eligible');
set local role authenticated;
insert into storage.objects(bucket_id,name,owner,metadata) select 'ezyvet-attachments',v->>'object_path',auth.uid(),jsonb_build_object('size',37,'mimetype','application/pdf') from data where k='intent';
select ok(not ezyvet_attachment_storage_delete((select v->>'object_path' from data where k='intent')),'Pending upload cannot authorize deletion');
select throws_ok($$select abandon_ezyvet_attachment_download((select id from fx where k='request'),(select id from fx where k='pet'),true)$$,'55P03','Download worker still holds a lease','An active upload cannot be abandoned for cleanup');
reset role;
-- Owner-only disposable fixture clock: no real worker or physical object exists.
alter table ezyvet_attachment_download_attempts disable trigger immutable_attachment_worker;
update ezyvet_attachment_download_attempts set created_at=clock_timestamp()-interval '10 minutes',lease_until=clock_timestamp()-interval '1 minute';
alter table ezyvet_attachment_download_attempts enable trigger immutable_attachment_worker;
set local role authenticated;
select abandon_ezyvet_attachment_download((select id from fx where k='request'),(select id from fx where k='pet'),true);
select is(recover_ezyvet_attachment_cleanup((select id from fx where k='cleanup'),(select id from fx where k='request'),(select id from fx where k='pet')),null::jsonb,'Unknown owned cleanup UUID recovers as absent');
set local role service_role;
select throws_ok($$select pg_temp.cleanup()$$,'23514','Abandoned attachment cleanup not ready','Abandonment grace period retains ambiguous bytes');
reset role;
alter table ezyvet_attachment_download_requests disable trigger immutable_attachment_download;
update ezyvet_attachment_download_requests set resolved_at=clock_timestamp()-interval '5 minutes' where status='abandoned';
alter table ezyvet_attachment_download_requests enable trigger immutable_attachment_download;
set local role service_role;
select throws_ok($$select pg_temp.cleanup()$$,'23514','Abandoned attachment cleanup not ready','Last upload lease also requires its full grace period');
reset role;
alter table ezyvet_attachment_download_attempts disable trigger immutable_attachment_worker;
update ezyvet_attachment_download_attempts set lease_until=clock_timestamp()-interval '5 minutes';
alter table ezyvet_attachment_download_attempts enable trigger immutable_attachment_worker;
set local role service_role;
insert into data select 'cleanup',pg_temp.cleanup();
select is(pg_temp.cleanup(),(select v from data where k='cleanup'),'Lost claim response recovers exact cleanup lease and reserved path');
select is((select v->>'object_path' from data where k='cleanup'),(select v->>'object_path' from data where k='intent'),'Cleanup path is server-bound to the original reservation');
select throws_ok($$select pg_temp.cleanup('cleanup2')$$,'55P03','Cleanup worker still holds a lease','Concurrent cleanup cannot acquire another active lease');
select throws_ok($$select pg_temp.cleaned('cleanup',false)$$,'23514','Storage absence verification required','Missing verification cannot assert cleanup success');
select throws_ok($$select pg_temp.cleaned()$$,'23514','Reserved object is still present','Deletion response alone cannot finalize while object metadata remains');
select throws_ok($$select complete_ezyvet_attachment_cleanup((select id from fx where k='cleanup'),(select id from fx where k='request'),'db560000-0000-4000-8000-000000000001',gen_random_uuid(),(select v#>>'{request,request_hash}' from data where k='saved'),(select v->>'intent_hash' from data where k='intent'),true)$$,'42501','Cleanup identity mismatch','A different lease cannot finalize cleanup');
select throws_ok($$select claim_ezyvet_attachment_cleanup((select id from fx where k='cleanup2'),(select id from fx where k='request'),'db560000-0000-4000-8000-000000000002',(select id from fx where k='pet'),(select v#>>'{request,request_hash}' from data where k='saved'))$$,'42501','Cleanup identity mismatch','Another administrator cannot claim the owner cleanup');
set local role authenticated;
select ok(ezyvet_attachment_storage_delete((select v->>'object_path' from data where k='intent')),'Only leased abandoned path allows owner deletion');
select ok(not ezyvet_attachment_storage_insert((select v->>'object_path' from data where k='intent')),'Abandoned tombstone permanently denies authenticated re-upload');
select ok(not ezyvet_attachment_storage_delete('arbitrary/path'),'Arbitrary Storage paths cannot be deleted');
select ok(not recover_ezyvet_attachment_cleanup((select id from fx where k='cleanup'),(select id from fx where k='request'),(select id from fx where k='pet'))::text like '%'||(select v#>>'{attempt,lease_id}' from data where k='cleanup')||'%','Browser recovery hides cleanup lease ID');
select set_config('request.jwt.claims','{"sub":"db560000-0000-4000-8000-000000000002","role":"authenticated"}',true);
with removed as(delete from storage.objects where bucket_id='ezyvet-attachments' returning id) select is(count(*)::integer,0,'Other administrator cannot delete original') from removed;
select throws_ok($$select recover_ezyvet_attachment_cleanup((select id from fx where k='cleanup'),(select id from fx where k='request'),(select id from fx where k='pet'))$$,'42501','Cleanup identity mismatch','Other administrator cannot recover cleanup');
select set_config('request.jwt.claims','{"sub":"db560000-0000-4000-8000-000000000001","role":"authenticated"}',true);
-- SQL tests exercise metadata RLS only; production must use Storage API deletion.
with removed as(delete from storage.objects where bucket_id='ezyvet-attachments' returning id) select is(count(*)::integer,1,'Owner can delete exactly the leased abandoned metadata row') from removed;
set local role service_role;
insert into data select 'cleaned',pg_temp.cleaned();
select is(pg_temp.cleaned(),(select v from data where k='cleaned'),'Lost cleanup completion acknowledgment returns exact receipt');
select is(pg_temp.cleanup()->'receipt',(select v from data where k='cleaned'),'Claim recovery includes completed cleanup receipt');
set local role authenticated;
select ok(not ezyvet_attachment_storage_delete((select v->>'object_path' from data where k='intent')),'A completed cleanup lease no longer authorizes deletion');
reset role;
-- Simulated late trusted Storage metadata: permanent tombstone remains and a
-- fresh cleanup operation can sweep again; old receipt is only point-in-time.
insert into storage.objects(bucket_id,name,owner,metadata) select 'ezyvet-attachments',v->>'object_path','db560000-0000-4000-8000-000000000001',jsonb_build_object('size',37,'mimetype','application/pdf') from data where k='intent';
set local role service_role;
insert into data select 'cleanup2',pg_temp.cleanup('cleanup2');
select isnt((select v#>>'{attempt,lease_id}' from data where k='cleanup2'),(select v#>>'{attempt,lease_id}' from data where k='cleanup'),'Later sweep has a distinct lease');
select throws_ok($$select pg_temp.cleaned('cleanup2')$$,'23514','Reserved object is still present','Later sweep must verify its own deletion');
reset role;
delete from user_roles where user_id='db560000-0000-4000-8000-000000000001' and role='ADMIN';
set local role authenticated;
select ok(not ezyvet_attachment_storage_delete((select v->>'object_path' from data where k='intent')),'Role loss revokes even an active cleanup lease');
reset role;
insert into user_roles(user_id,role) values('db560000-0000-4000-8000-000000000001','ADMIN');
alter table ezyvet_attachment_cleanup_attempts disable trigger immutable_attachment_cleanup;
update ezyvet_attachment_cleanup_attempts set created_at=clock_timestamp()-interval '10 minutes',lease_until=clock_timestamp()-interval '1 minute' where id=(select id from fx where k='cleanup2');
alter table ezyvet_attachment_cleanup_attempts enable trigger immutable_attachment_cleanup;
set local role authenticated;
select ok(not ezyvet_attachment_storage_delete((select v->>'object_path' from data where k='intent')),'Expired cleanup lease cannot authorize deletion');
set local role service_role;
select throws_ok($$select pg_temp.cleaned('cleanup2')$$,'40001','Cleanup worker lease changed','Expired cleanup cannot finalize');
insert into data select 'cleanup3',pg_temp.cleanup('cleanup3');
set local role authenticated;
with removed as(delete from storage.objects where bucket_id='ezyvet-attachments' returning id) select is(count(*)::integer,1,'Fresh cleanup lease can remove the later object') from removed;
set local role service_role;
insert into data select 'cleaned3',pg_temp.cleaned('cleanup3');
select is(pg_temp.cleaned(),(select v from data where k='cleaned'),'Later sweeps preserve original cleanup receipts');
reset role;
select is((select status from ezyvet_attachment_download_requests where id=(select id from fx where k='request')),'abandoned','Cleanup never revives the abandoned request');
select is((select count(*)::integer from ezyvet_attachment_capture_intents where request_id=(select id from fx where k='request')),1,'Cleanup retains original reservation evidence');
select is((select count(*)::integer from ezyvet_attachment_cleanup_receipts),2,'Each verified sweep has an immutable receipt');
select throws_ok($$update ezyvet_attachment_cleanup_receipts set verified_absent_at=clock_timestamp()$$,'23514',null,'Cleanup receipt cannot be rewritten');
-- Complete a second request to prove the deletion policy protects captured files.
insert into data select 'lease2',pg_temp.claim('request2');
insert into data select 'intent2',prepare_ezyvet_attachment_capture((select id from fx where k='request2'),'db560000-0000-4000-8000-000000000001',(select (v->>'lease_id')::uuid from data where k='lease2'),(select v#>>'{request,request_hash}' from data where k='saved2'),repeat('a',64),37,'application/pdf',(select v#>'{request,source_context,attachment_metadata}' from data where k='saved2'),(select v#>'{request,source_context,attachment_metadata}' from data where k='saved2'));
insert into storage.objects(bucket_id,name,owner,metadata) select 'ezyvet-attachments',v->>'object_path','db560000-0000-4000-8000-000000000001',jsonb_build_object('size',37,'mimetype','application/pdf') from data where k='intent2';
select complete_ezyvet_attachment_capture((select id from fx where k='request2'),'db560000-0000-4000-8000-000000000001',(select (v->>'lease_id')::uuid from data where k='lease2'),(select v#>>'{request,request_hash}' from data where k='saved2'),(select v->>'intent_hash' from data where k='intent2'),repeat('a',64),37,'application/pdf',(select v#>'{request,source_context,attachment_metadata}' from data where k='saved2'));
set local role service_role;
select throws_ok($$select claim_ezyvet_attachment_cleanup((select id from fx where k='cleanup4'),(select id from fx where k='request2'),'db560000-0000-4000-8000-000000000001',(select id from fx where k='pet'),(select v#>>'{request,request_hash}' from data where k='saved2'))$$,'23514','Abandoned attachment cleanup not ready','Completed captures can never be claimed for cleanup');
set local role authenticated;
with removed as(delete from storage.objects where bucket_id='ezyvet-attachments' returning id) select is(count(*)::integer,0,'Owner cannot delete a completed capture through cleanup policy') from removed;
reset role;
select is(jsonb_build_object('documents',(select count(*) from patient_documents),'treatments',(select count(*) from patient_treatments),'invoices',(select count(*) from billing_invoices),'stock',(select count(*) from inventory_movements),'outbox',(select count(*) from communication_outbox)),(select v from data where k='side-effects'),'Cleanup adds no clinical, billing, stock, delivery or manual-document effects');
select * from finish();rollback;
