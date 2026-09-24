begin;create extension if not exists pgtap with schema extensions;set local search_path=public,extensions;select no_plan();
-- FIXTURE_BEGIN

insert into auth.users(id,email,raw_user_meta_data) values('db700000-0000-4000-8000-000000000001','attachment-admin@example.test','{}'),('db700000-0000-4000-8000-000000000002','attachment-other@example.test','{}');
update public.profiles set is_active = true where id in ('db700000-0000-4000-8000-000000000001','db700000-0000-4000-8000-000000000002');
insert into public.user_roles (user_id, role) values ('db700000-0000-4000-8000-000000000001','STAFF'),('db700000-0000-4000-8000-000000000002','STAFF');

insert into user_roles(user_id,role) values('db700000-0000-4000-8000-000000000001','ADMIN'),('db700000-0000-4000-8000-000000000002','ADMIN');
create temp table fx(k text primary key,id uuid);create temp table data(k text primary key,v jsonb);grant all on fx,data to authenticated,service_role;
set local role authenticated;select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fx select 'client',id from save_client(auth.uid(),null,null,'Attachment','Owner','+13035550196','attachment@example.test','EMAIL',null,null);
insert into fx select 'pet',id from save_patient(null,(select id from fx where k='client'),null,'Metadata dog','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
insert into fx select k,gen_random_uuid() from unnest(array['mapping','animal-run','run','run2','other-run']) k;
reset role;
insert into data select 'animal',to_jsonb(claim_ezyvet_import((select id from fx where k='animal-run'),'db700000-0000-4000-8000-000000000001','attachment-test-site','animal','https://api.trial.ezyvet.com'));
select stage_ezyvet_import_page((select id from fx where k='animal-run'),'db700000-0000-4000-8000-000000000001',(select(v->>'lease_id')::uuid from data where k='animal'),1,true,'[{"external_id":"77","payload":{"id":77}}]');
insert into ezyvet_record_links(id,request_id,request_hash,source_origin,source_site_uid,resource,external_id,snapshot_id,head_version,client_id,pet_id,local_version,action,reason,approved_by)
select (select id from fx where k='mapping'),gen_random_uuid(),'synthetic-approved-mapping',s.source_origin,s.source_site_uid,s.resource,s.external_id,s.id,h.version,(select id from fx where k='client'),(select id from fx where k='pet'),1,'link','Synthetic reviewed mapping','db700000-0000-4000-8000-000000000001' from ezyvet_import_snapshots s join ezyvet_identity_heads h on h.snapshot_id=s.id where s.resource='animal' and s.source_site_uid='attachment-test-site';
insert into data values('observation',jsonb_build_object('external_id','701','file_id','42','metadata',jsonb_build_object('id','701','file_id','42','record_type','Animal','record_id','77','name','Synthetic report','mime_type','application/pdf','notes',null),'raw_record_sha256',repeat('a',64),'stable_metadata_sha256',repeat('b',64),'file_sha256',null));
insert into data select 'page',jsonb_build_object('contract_version','ezyvet_animal_attachment_metadata_v1','parent',jsonb_build_object('record_type','Animal','record_id','77'),'page',1,'complete',true,'pagination',jsonb_build_object('items_page',1,'items_page_total',1,'items_page_size',10,'items_total',2),'observations',jsonb_build_array(v,jsonb_set(v,'{raw_record_sha256}',to_jsonb(repeat('c',64)))),'page_sha256',repeat('d',64)) from data where k='observation';
insert into data values('side-effects',jsonb_build_object('treatments',(select count(*) from patient_treatments),'invoices',(select count(*) from billing_invoices),'stock',(select count(*) from inventory_movements),'outbox',(select count(*) from communication_outbox),'objects',(select count(*) from storage.objects)));

insert into data select 'run',claim_ezyvet_attachment_import((select id from fx where k='run'),'db700000-0000-4000-8000-000000000001','attachment-test-site','https://api.trial.ezyvet.com',(select id from fx where k='mapping'));
select stage_ezyvet_attachment_page((select id from fx where k='run'),'db700000-0000-4000-8000-000000000001',(select(v->>'lease_id')::uuid from data where k='run'),(select v from data where k='page'));
update ezyvet_import_runs set retry_after=null where resource='attachment';
insert into fx select k,gen_random_uuid() from unnest(array['capture','capture2','capture3','capture4']) k;
insert into fx select 'attachment-snapshot',snapshot_id from ezyvet_attachment_page_observations where run_id=(select id from fx where k='run') and ordinal=1;
-- FIXTURE_END
set local role authenticated;select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select prepare_ezyvet_attachment_capture((select id from fx where k='capture'),(select id from fx where k='mapping'),(select id from fx where k='run'),1,3,(select id from fx where k='attachment-snapshot'),1,repeat('b',64))$$,'42501',null,'Unobserved ordinal rejected');
select throws_ok($$select prepare_ezyvet_attachment_capture((select id from fx where k='capture'),(select id from fx where k='mapping'),(select id from fx where k='run'),1,1,(select id from fx where k='attachment-snapshot'),1,repeat('f',64))$$,'42501',null,'Wrong stable digest rejected');
insert into data select 'capture',prepare_ezyvet_attachment_capture((select id from fx where k='capture'),(select id from fx where k='mapping'),(select id from fx where k='run'),1,1,(select id from fx where k='attachment-snapshot'),1,repeat('b',64));
select is((select v->>'status' from data where k='capture'),'prepared','Explicit owned observation prepared');
select is((select v->>'file_id' from data where k='capture'),'42','File identity retained separately from attachment identity');
select ok(not((select v from data where k='capture') ?| array['lease_id','intent','object_path']),'Browser projection hides service data');
select is(prepare_ezyvet_attachment_capture((select id from fx where k='capture'),(select id from fx where k='mapping'),(select id from fx where k='run'),1,1,(select id from fx where k='attachment-snapshot'),1,repeat('b',64)),(select v from data where k='capture'),'Lost preparation reply recovers exact immutable request');
select throws_ok($$select prepare_ezyvet_attachment_capture((select id from fx where k='capture'),(select id from fx where k='mapping'),(select id from fx where k='run'),1,2,(select id from fx where k='attachment-snapshot'),1,repeat('b',64))$$,'42501',null,'Same UUID cannot switch duplicate ordinal');
select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select recover_ezyvet_attachment_capture((select id from fx where k='capture'),(select id from fx where k='mapping'))$$,'42501',null,'Other administrator cannot recover');
select is(jsonb_array_length(list_ezyvet_attachment_captures((select id from fx where k='mapping'))->'captures'),0,'Discovery is owner scoped');
select throws_ok($$select prepare_ezyvet_attachment_capture((select id from fx where k='capture2'),(select id from fx where k='mapping'),(select id from fx where k='run'),1,1,(select id from fx where k='attachment-snapshot'),1,repeat('b',64))$$,'42501',null,'Another admin cannot capture the owned metadata run');
reset role;set local role service_role;
insert into data select 'claimed',claim_ezyvet_attachment_capture((select id from fx where k='capture'),'db700000-0000-4000-8000-000000000001');
select ok((select v->>'lease_id' is not null from data where k='claimed'),'Service worker receives lease');
select throws_ok($$select claim_ezyvet_attachment_capture((select id from fx where k='capture'),'db700000-0000-4000-8000-000000000001')$$,'55P03',null,'Concurrent worker cannot duplicate claim');
select throws_ok($$select claim_ezyvet_attachment_import((select id from fx where k='other-run'),'db700000-0000-4000-8000-000000000001','attachment-test-site','https://api.trial.ezyvet.com',(select id from fx where k='mapping'))$$,'55P03',null,'Metadata scan respects original capture source lease');
select throws_ok($$select reserve_ezyvet_attachment_original((select id from fx where k='capture'),'db700000-0000-4000-8000-000000000001',null,repeat('e',64),'application/pdf',12,repeat('a',64),repeat('c',64))$$,'40001',null,'Reserve requires current lease');
insert into data select 'reserved',reserve_ezyvet_attachment_original((select id from fx where k='capture'),'db700000-0000-4000-8000-000000000001',(select(v->>'lease_id')::uuid from data where k='claimed'),repeat('e',64),'application/pdf',12,repeat('a',64),repeat('c',64));
select is((select v#>>'{request,status}' from data where k='reserved'),'reserved','Verified byte intent reserves private object');
select isnt((select v#>>'{intent,before_raw_sha256}' from data where k='reserved'),(select v#>>'{intent,after_raw_sha256}' from data where k='reserved'),'Raw URL renewal digests need not match');
select throws_ok($$select reserve_ezyvet_attachment_original((select id from fx where k='capture'),'db700000-0000-4000-8000-000000000001',(select(v->>'lease_id')::uuid from data where k='claimed'),repeat('f',64),'application/pdf',12,repeat('a',64),repeat('c',64))$$,'23514',null,'Intent bytes cannot change');
select throws_ok($$select complete_ezyvet_attachment_capture((select id from fx where k='capture'),'db700000-0000-4000-8000-000000000001',(select(v->>'lease_id')::uuid from data where k='claimed'),(select(v#>>'{intent,id}')::uuid from data where k='reserved'),repeat('e',64),'application/pdf',12)$$,'23514',null,'Missing object cannot complete');
reset role;set local role authenticated;select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$insert into storage.objects(bucket_id,name,metadata) select 'ezyvet-attachment-originals',v#>>'{intent,object_path}','{"size":12,"mimetype":"application/pdf"}'::jsonb from data where k='reserved'$$,'Owning JWT may insert only reserved object');
select is((select count(*)::integer from storage.objects where bucket_id='ezyvet-attachment-originals'),0,'Direct object reads denied even to uploader');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('ezyvet-attachment-originals','other/path','{}')$$,'42501',null,'Unreserved object upload denied');
reset role;set local role service_role;
insert into data select 'ready',complete_ezyvet_attachment_capture((select id from fx where k='capture'),'db700000-0000-4000-8000-000000000001',(select(v->>'lease_id')::uuid from data where k='claimed'),(select(v#>>'{intent,id}')::uuid from data where k='reserved'),repeat('e',64),'application/pdf',12);
select is((select v#>>'{request,status}' from data where k='ready'),'ready','Readback-attested original becomes ready');
select is((select v#>>'{request,capture,entry_method}' from data where k='ready'),'ezyvet_api_attachment_original_v1','Capture never claims manual export provenance');
select is(complete_ezyvet_attachment_capture((select id from fx where k='capture'),'db700000-0000-4000-8000-000000000001',null,(select(v#>>'{intent,id}')::uuid from data where k='reserved'),repeat('e',64),'application/pdf',12),(select v from data where k='ready'),'Lost completion reply recovers before lease validation');
select throws_ok($$select begin_discard_ezyvet_attachment_capture((select id from fx where k='capture'),'db700000-0000-4000-8000-000000000001')$$,'23514',null,'Captured object cannot be discarded');
reset role;
insert into fx select 'approval',gen_random_uuid();insert into fx select 'correction',gen_random_uuid();
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
create function pg_temp.approve_original(k text default 'approval',previous_id uuid default null,attest boolean default true,title text default 'Reviewed canonical original') returns public.ezyvet_attachment_record_versions language sql as $$
 select approve_ezyvet_attachment_record((select id from fx where fx.k=$1),(select id from fx where fx.k='capture'),(select id from fx where fx.k='pet'),(select v#>>'{request,capture,capture_hash}' from data where data.k='ready'),$2,$4,'Synthetic verified original inspection',$3);
$$;

insert into fx select k,gen_random_uuid() from unnest(array['migration','scope','binding','cancel']) k;
select prepare_ezyvet_migration_run((select id from fx where k='migration'),'https://api.trial.ezyvet.com','attachment-test-site',
 (select jsonb_build_array(jsonb_build_object('id',(select id from fx where k='scope'),'mapping_id',m.id,'resource','attachment','parent_type','animal','parent_snapshot_id',m.snapshot_id,'parent_head_version',m.head_version,'disposition','required','reason','Synthetic exact capture scope')) from ezyvet_record_links m where m.id=(select id from fx where k='mapping')));
select bind_ezyvet_migration_child((select id from fx where k='binding'),(select id from fx where k='scope'),(select id from fx where k='run'),'Existing metadata evidence');
insert into data select 'migration-item',list_ezyvet_migration_items((select id from fx where k='binding'))->'items'->0;
create function pg_temp.capture_evidence(n integer default 1,before_at timestamptz default null,before_id uuid default null,lim integer default 20) returns jsonb language sql as $$
 select list_ezyvet_migration_capture_evidence((select id from fx where k='binding'),1,n,(select(v->>'snapshot_id')::uuid from data where k='migration-item'),
  (select x->>'evidence_hash' from jsonb_array_elements(list_ezyvet_migration_items((select id from fx where k='binding'))->'items') x where (x->>'ordinal')::integer=n),before_at,before_id,lim);
$$;
insert into data select 'capture-evidence',pg_temp.capture_evidence();
select is((select jsonb_array_length(v->'captures') from data where k='capture-evidence'),1,'Exact observed source version finds owned capture');
select is((select v#>>'{captures,0,status}' from data where k='capture-evidence'),'ready','Completed capture is distinct from metadata-only observation');
select is((select v#>>'{captures,0,relationship}' from data where k='capture-evidence'),'exact_occurrence','Exact occurrence is identified');
select is(pg_temp.capture_evidence(2)#>>'{captures,0,relationship}','same_source_version','Duplicate occurrence can reference the same captured source version');
select is((select v#>>'{captures,0,approved_versions}' from data where k='capture-evidence'),'0','Captured bytes are not automatic clinical approval');
select is((select v->>'original_bytes_reverified' from data where k='capture-evidence'),'false','Receipt read never claims fresh byte verification');
select ok(not((select v::text from data where k='capture-evidence') ~ 'lease_id|object_path|storage_object_id|request_payload|metadata'),'Capture evidence omits worker and Storage capabilities');
select pg_temp.approve_original();
select is(pg_temp.capture_evidence()#>>'{captures,0,approved_versions}','1','Explicit approval is linked to its exact capture');
select cancel_ezyvet_attachment_approval((select id from fx where k='cancel'),(select id from fx where k='capture'),(select id from fx where k='pet'),(select v#>>'{request,capture,capture_hash}' from data where k='ready'),true);
select is(pg_temp.capture_evidence()#>>'{captures,0,canceled_unconfirmed_decisions}','1','Unconfirmed cancellation is counted separately');
select is(pg_temp.capture_evidence()#>>'{captures,0,approved_versions}','1','Canceling another decision does not revoke approved history');
select pg_temp.approve_original('correction',(select id from fx where k='approval'));
select is(pg_temp.capture_evidence()#>>'{captures,0,latest_approval,version}','2','Latest immutable correction is identified');
select is(pg_temp.capture_evidence()#>>'{captures,0,approved_versions}','2','Correction versions do not collapse into a fabricated native record');
select prepare_ezyvet_attachment_capture((select id from fx where k='capture2'),(select id from fx where k='mapping'),(select id from fx where k='run'),1,2,(select id from fx where k='attachment-snapshot'),1,repeat('b',64));
insert into data select 'capture-page',pg_temp.capture_evidence(1,null,null,1);
select is((select v->>'has_more' from data where k='capture-page'),'true','Capture history uses a bounded sentinel');
select is((select v#>>'{captures,0,status}' from data where k='capture-page'),'prepared','Newer unfinished request remains distinct from an older ready original');
select is((select v#>>'{captures,0,approved_versions}' from data where k='capture-page'),'0','Approval is not borrowed from another capture request');
select is((select pg_temp.capture_evidence(1,(v#>>'{next_cursor,before_at}')::timestamptz,(v#>>'{next_cursor,before_id}')::uuid,1)#>>'{captures,0,status}' from data where k='capture-page'),'ready','Cursor recovers older ready capture');
select throws_ok($$select list_ezyvet_migration_capture_evidence((select id from fx where k='binding'),1,1,(select id from fx where k='attachment-snapshot'),repeat('f',64))$$,'42501','Exact attachment observation required','Wrong occurrence digest is rejected');
select throws_ok($$select list_ezyvet_migration_capture_evidence((select id from fx where k='binding'),1,0,(select id from fx where k='attachment-snapshot'),repeat('f',64))$$,'23514','Invalid capture evidence identity or cursor','Invalid ordinal is rejected');
reset role;
update ezyvet_identity_heads set version=version+1 where source_site_uid='attachment-test-site' and resource='animal';
set local role authenticated;
select is(pg_temp.capture_evidence()#>>'{captures,0,source_current}','false','Parent drift is visible while historical receipts remain readable');
select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select pg_temp.capture_evidence()$$,'42501','Owned migration binding required','Other administrator cannot use an owned binding');
reset role;
select ok(not has_function_privilege('anon','public.list_ezyvet_migration_capture_evidence(uuid,integer,integer,uuid,text,timestamptz,uuid,integer)','execute'),'Anonymous capture evidence denied');
select ok(not has_function_privilege('service_role','public.list_ezyvet_migration_capture_evidence(uuid,integer,integer,uuid,text,timestamptz,uuid,integer)','execute'),'Worker cannot discover capture evidence');
select * from finish();rollback;
