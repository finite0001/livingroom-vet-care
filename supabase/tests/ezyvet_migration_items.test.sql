begin;create extension if not exists pgtap with schema extensions;set local search_path=public,extensions;select no_plan();


insert into auth.users(id,email,raw_user_meta_data) values('db700000-0000-4000-8000-000000000001','attachment-admin@example.test','{}'),('db700000-0000-4000-8000-000000000002','attachment-other@example.test','{}');
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

insert into fx select k,gen_random_uuid() from unnest(array['migration','scope','binding','replacement']) k;
insert into data select 'scope-input',jsonb_build_array(jsonb_build_object('id',(select id from fx where k='scope'),'mapping_id',m.id,'resource','attachment','parent_type','animal','parent_snapshot_id',m.snapshot_id,'parent_head_version',m.head_version,'disposition','required','reason','Explicit synthetic coverage')) from ezyvet_record_links m where m.id=(select id from fx where k='mapping');
set local role authenticated;select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into data select 'manifest',prepare_ezyvet_migration_run((select id from fx where k='migration'),'https://api.trial.ezyvet.com','attachment-test-site',(select v from data where k='scope-input'));
select is((select v->>'scope_manifest_version' from data where k='manifest'),'1','Resolved scope digest has explicit version');
select ok((select v->>'scope_manifest_hash' ~ '^[a-f0-9]{64}$' from data where k='manifest'),'Resolved scope digest is SHA256');
select bind_ezyvet_migration_child((select id from fx where k='binding'),(select id from fx where k='scope'),(select id from fx where k='run'),'Existing synthetic run');
select is(read_ezyvet_migration_run((select id from fx where k='migration')),(select v from data where k='manifest'),'Binding does not change frozen scope digest');

insert into data select 'first-items',list_ezyvet_migration_items((select id from fx where k='binding'),null,null,null,1);
select is((select v#>>'{items,0,ordinal}' from data where k='first-items'),'1','First item retains attachment occurrence ordinal');
select is((select v->>'has_more' from data where k='first-items'),'true','Bounded item page reports sentinel');
select is((select v->>'mapping_source_current' from data where k='first-items'),'true','Reviewed mapping source is current');
select is((select v->>'mapping_matches_manifest' from data where k='first-items'),'true','Mapping still matches immutable manifest');
select is((select v#>>'{items,0,exact_source_current}' from data where k='first-items'),'true','Exact observed head is current');
insert into data select 'second-items',list_ezyvet_migration_items((select id from fx where k='binding'),1,1,(v#>>'{items,0,snapshot_id}')::uuid,1) from data where k='first-items';
select is((select v#>>'{items,0,ordinal}' from data where k='second-items'),'2','Cursor preserves duplicate snapshot second occurrence');
select is((select v#>>'{items,0,snapshot_id}' from data where k='first-items'),(select v#>>'{items,0,snapshot_id}' from data where k='second-items'),'Duplicate source snapshot remains one identity');
select isnt((select v#>>'{items,0,evidence_hash}' from data where k='first-items'),(select v#>>'{items,0,evidence_hash}' from data where k='second-items'),'Occurrence evidence hashes distinguish raw-record ordinals');
select is((select v->>'has_more' from data where k='second-items'),'false','Last page has no continuation');
select is((select v->'next_cursor' from data where k='second-items'),'null'::jsonb,'Terminal cursor is null');
select is((select v->>'review_reconciled' from data where k='first-items'),'false','Source view is not clinical approval');
select is((select v->>'complete_coverage_verified' from data where k='first-items'),'false','Source view is not complete coverage');
select ok(not exists(select 1 from jsonb_array_elements((select v->'items' from data where k='first-items')) x where x ?| array['payload','metadata','lease_id','object_path']),'Item view omits payloads, storage locations and capabilities');
select throws_ok($$select list_ezyvet_migration_items((select id from fx where k='binding'),1,null,null,20)$$,'23514','Invalid migration item cursor','Partial cursor is rejected');
select throws_ok($$select list_ezyvet_migration_items((select id from fx where k='binding'),null,null,null,101)$$,'23514','Invalid migration item cursor','Unbounded page is rejected');
reset role;
-- A→B→A has the same snapshot but a different observed head version.
update ezyvet_identity_heads set version=version+2 where resource='attachment' and source_site_uid='attachment-test-site';
set local role authenticated;
insert into data select 'drifted-items',list_ezyvet_migration_items((select id from fx where k='binding'),null,null,null,1);
select is((select v#>>'{items,0,payload_current}' from data where k='drifted-items'),'true','Same payload can recur at a later head');
select is((select v#>>'{items,0,exact_source_current}' from data where k='drifted-items'),'false','Same payload at later head is not exact observed version');
select is((select v#>>'{items,0,evidence_hash}' from data where k='drifted-items'),(select v#>>'{items,0,evidence_hash}' from data where k='first-items'),'Current source drift does not rewrite historical evidence hash');
reset role;
update ezyvet_identity_heads set version=version+1 where resource='animal' and source_site_uid='attachment-test-site';
set local role authenticated;
select is(list_ezyvet_migration_items((select id from fx where k='binding'))->>'mapping_source_current','false','Mapping source drift is explicit');
select is(list_ezyvet_migration_items((select id from fx where k='binding'))->>'parent_current','false','Parent drift is explicit');
select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select list_ezyvet_migration_items((select id from fx where k='binding'))$$,'42501','Owned migration binding required','Other administrator cannot read items');
reset role;
select ok(not has_function_privilege('anon','public.list_ezyvet_migration_items(uuid,integer,integer,uuid,integer)','execute'),'Anonymous item read denied');
select ok(not has_function_privilege('service_role','public.list_ezyvet_migration_items(uuid,integer,integer,uuid,integer)','execute'),'Worker item read denied');
select * from finish();rollback;
