begin;create extension if not exists pgtap with schema extensions;set local search_path=public,extensions;select no_plan();
-- FIXTURE_BEGIN
insert into auth.users(id,email,raw_user_meta_data) values('db690000-0000-4000-8000-000000000001','attachment-admin@example.test','{}'),('db690000-0000-4000-8000-000000000002','attachment-other@example.test','{}');
update public.profiles set is_active = true where id in ('db690000-0000-4000-8000-000000000001','db690000-0000-4000-8000-000000000002');
insert into public.user_roles (user_id, role) values ('db690000-0000-4000-8000-000000000001','STAFF'),('db690000-0000-4000-8000-000000000002','STAFF');

insert into user_roles(user_id,role) values('db690000-0000-4000-8000-000000000001','ADMIN'),('db690000-0000-4000-8000-000000000002','ADMIN');
create temp table fx(k text primary key,id uuid);create temp table data(k text primary key,v jsonb);grant all on fx,data to authenticated,service_role;
set local role authenticated;select set_config('request.jwt.claims','{"sub":"db690000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fx select 'client',id from save_client(auth.uid(),null,null,'Attachment','Owner','+13035550196','attachment@example.test','EMAIL',null,null);
insert into fx select 'pet',id from save_patient(null,(select id from fx where k='client'),null,'Metadata dog','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
insert into fx select k,gen_random_uuid() from unnest(array['mapping','animal-run','run','run2','other-run']) k;
reset role;
insert into data select 'animal',to_jsonb(claim_ezyvet_import((select id from fx where k='animal-run'),'db690000-0000-4000-8000-000000000001','attachment-test-site','animal','https://api.trial.ezyvet.com'));
select stage_ezyvet_import_page((select id from fx where k='animal-run'),'db690000-0000-4000-8000-000000000001',(select(v->>'lease_id')::uuid from data where k='animal'),1,true,'[{"external_id":"77","payload":{"id":77}}]');
insert into ezyvet_record_links(id,request_id,request_hash,source_origin,source_site_uid,resource,external_id,snapshot_id,head_version,client_id,pet_id,local_version,action,reason,approved_by)
select (select id from fx where k='mapping'),gen_random_uuid(),'synthetic-approved-mapping',s.source_origin,s.source_site_uid,s.resource,s.external_id,s.id,h.version,(select id from fx where k='client'),(select id from fx where k='pet'),1,'link','Synthetic reviewed mapping','db690000-0000-4000-8000-000000000001' from ezyvet_import_snapshots s join ezyvet_identity_heads h on h.snapshot_id=s.id where s.resource='animal' and s.source_site_uid='attachment-test-site';
insert into data values('observation',jsonb_build_object('external_id','701','file_id','42','metadata',jsonb_build_object('id','701','file_id','42','record_type','Animal','record_id','77','name','Synthetic report','mime_type','unsupported/example','notes',null),'raw_record_sha256',repeat('a',64),'stable_metadata_sha256',repeat('b',64),'file_sha256',null));
insert into data select 'page',jsonb_build_object('contract_version','ezyvet_animal_attachment_metadata_v1','parent',jsonb_build_object('record_type','Animal','record_id','77'),'page',1,'complete',true,'pagination',jsonb_build_object('items_page',1,'items_page_total',1,'items_page_size',10,'items_total',2),'observations',jsonb_build_array(v,jsonb_set(v,'{raw_record_sha256}',to_jsonb(repeat('c',64)))),'page_sha256',repeat('d',64)) from data where k='observation';
insert into data values('side-effects',jsonb_build_object('treatments',(select count(*) from patient_treatments),'invoices',(select count(*) from billing_invoices),'stock',(select count(*) from inventory_movements),'outbox',(select count(*) from communication_outbox),'objects',(select count(*) from storage.objects)));
-- FIXTURE_END
-- Validate hostile envelopes before any stage casts or writes.
select throws_ok(format('select ezyvet_attachment_validate_page(%L::jsonb,%L)',bad,'77'),'23514',null,label)
from data cross join lateral(values
 ('null'::jsonb,'JSON null page'),
 (v-'observations','Missing observations'),
 (jsonb_set(v,'{observations}','null'),'Null observations'),
 (jsonb_set(v,'{page}','"1"'),'String page cursor'),
 (jsonb_set(v,'{page}','1.5'),'Fractional page cursor'),
 (jsonb_set(v,'{page}','1001'),'Excess page cursor'),
 (jsonb_set(v,'{pagination,items_page_size}','0'),'Zero page size'),
 (jsonb_set(v,'{pagination,items_total}','3'),'Pagination count mismatch'),
 (jsonb_set(v,'{complete}','false'),'Completion flag mismatch'),
 (jsonb_set(v,'{parent,record_type}','"Consult"'),'Consult scope rejected'),
 (jsonb_set(v,'{observations,0,metadata,record_id}','"88"'),'Foreign parent metadata'),
 (jsonb_set(v,'{observations,0,metadata,extra}','true'),'Unknown metadata key'),
 (jsonb_set(v,'{observations,0,metadata,notes}','[]'),'Structured prose rejected'),
 (jsonb_set(v,'{observations,0,metadata,created_at}','true'),'Boolean timestamp rejected'),
 (jsonb_set(v,'{observations,0,metadata,active}','1e1000'),'Nonfinite JavaScript scalar rejected'),
 (jsonb_set(v,'{observations,0,external_id}','"9007199254740992"'),'Unsafe integer identity rejected'),
 (jsonb_set(v,'{observations,0,raw_record_sha256}','null'),'Null digest rejected'),
 (jsonb_set(v,'{observations,0,metadata,name}',to_jsonb(repeat('x',1025))),'Oversized name rejected')
) cases(bad,label) where k='page';
select throws_ok($$select claim_ezyvet_import(gen_random_uuid(),'db690000-0000-4000-8000-000000000001','attachment-test-site','attachment','https://api.trial.ezyvet.com')$$,'23514',null,'Generic claim cannot bypass attachment scope');
select throws_ok($$select claim_ezyvet_attachment_import(gen_random_uuid(),'db690000-0000-4000-8000-000000000001','wrong-site','https://api.trial.ezyvet.com',(select id from fx where k='mapping'))$$,'42501',null,'Cross-site parent rejected');
insert into data select 'run',claim_ezyvet_attachment_import((select id from fx where k='run'),'db690000-0000-4000-8000-000000000001','attachment-test-site','https://api.trial.ezyvet.com',(select id from fx where k='mapping'));
select is((select v#>>'{parent_context,parent_external_id}' from data where k='run'),'77','Claim derives Animal from approved mapping');
select throws_ok($$select claim_ezyvet_attachment_import((select id from fx where k='run'),'db690000-0000-4000-8000-000000000002','attachment-test-site','https://api.trial.ezyvet.com',(select id from fx where k='mapping'))$$,'42501',null,'Another actor cannot take over run');
select throws_ok($$select claim_ezyvet_attachment_import((select id from fx where k='other-run'),'db690000-0000-4000-8000-000000000001','attachment-test-site','https://api.trial.ezyvet.com',(select id from fx where k='mapping'))$$,'55P03',null,'Competing scans share source lease');
select throws_ok($$select stage_ezyvet_import_page((select id from fx where k='run'),'db690000-0000-4000-8000-000000000001',(select(v->>'lease_id')::uuid from data where k='run'),1,true,'[]')$$,'23514',null,'Generic stage cannot bypass metadata validation');
select throws_ok($$select stage_ezyvet_attachment_page((select id from fx where k='run'),'db690000-0000-4000-8000-000000000002',(select(v->>'lease_id')::uuid from data where k='run'),(select v from data where k='page'))$$,'42501',null,'Another actor cannot stage');
select throws_ok($$select stage_ezyvet_attachment_page((select id from fx where k='run'),'db690000-0000-4000-8000-000000000001',null,(select v from data where k='page'))$$,'40001',null,'Fresh page requires lease');
select throws_ok($$select stage_ezyvet_attachment_page((select id from fx where k='run'),'db690000-0000-4000-8000-000000000001',(select(v->>'lease_id')::uuid from data where k='run'),(select jsonb_set(v,'{observations,0,metadata,file_download_url}','"https://secret.example.test/token"') from data where k='page'))$$,'23514',null,'URL cannot enter durable snapshot');
select throws_ok($$select stage_ezyvet_attachment_page((select id from fx where k='run'),'db690000-0000-4000-8000-000000000001',(select(v->>'lease_id')::uuid from data where k='run'),(select jsonb_set(v,'{observations,0,file_id}','"not-numeric"') from data where k='page'))$$,'23514',null,'Nonnumeric file identity rejected');
select throws_ok($$select stage_ezyvet_attachment_page((select id from fx where k='run'),'db690000-0000-4000-8000-000000000001',(select(v->>'lease_id')::uuid from data where k='run'),(select jsonb_set(v,'{observations,0,file_sha256}',to_jsonb(repeat('e',64))) from data where k='page'))$$,'23514',null,'Metadata cannot assert file checksum');
select throws_ok($$select stage_ezyvet_attachment_page((select id from fx where k='run'),'db690000-0000-4000-8000-000000000001',(select(v->>'lease_id')::uuid from data where k='run'),(select jsonb_set(v,'{observations,1,metadata,name}','"Different"') from data where k='page'))$$,'23514',null,'Conflicting duplicate rejects entire page');
select is((select next_page from ezyvet_import_runs where id=(select id from fx where k='run')),1,'Rejected pages leave checkpoint unchanged');
select lives_ok($$select stage_ezyvet_attachment_page((select id from fx where k='run'),'db690000-0000-4000-8000-000000000001',(select(v->>'lease_id')::uuid from data where k='run'),(select v from data where k='page'))$$,'Safe duplicates retain observations and stage once');
select is((select count(*)::integer from ezyvet_attachment_page_observations),2,'Two ordered observations retained');
select is((select count(*)::integer from ezyvet_import_snapshots where resource='attachment'),1,'One stable snapshot for identical duplicated metadata');
select is((select version from ezyvet_identity_heads where resource='attachment'),1,'Duplicates do not advance head');
select is((select payload->>'representation' from ezyvet_import_snapshots where resource='attachment'),'sanitized_attachment_metadata_v1','Snapshot explicitly identifies sanitized representation');
select ok(not exists(select 1 from ezyvet_import_snapshots where resource='attachment' and(payload ? 'raw_record_sha256' or payload ? 'file_download_url')),'No raw digest or temporary URL in stable projection');
select is((select staged_count from ezyvet_attachment_pages),1,'Staged count distinguishes distinct versions from observations');
select is((select observed_count from ezyvet_attachment_pages),2,'Observed count includes duplicates');
select lives_ok($$select stage_ezyvet_attachment_page((select id from fx where k='run'),'db690000-0000-4000-8000-000000000001',null,(select v from data where k='page'))$$,'Exact committed replay needs no active lease');
select throws_ok($$select stage_ezyvet_attachment_page((select id from fx where k='run'),'db690000-0000-4000-8000-000000000001',null,(select jsonb_set(v,'{observations,0,raw_record_sha256}',to_jsonb(repeat('f',64))) from data where k='page'))$$,'40001',null,'Changed raw evidence cannot rewrite committed page');
insert into fx select 'attachment-snapshot',id from ezyvet_import_snapshots where resource='attachment';
set local role authenticated;
select throws_ok($$select review_ezyvet_snapshot((select id from fx where k='attachment-snapshot'),'ignored',null,null,'Metadata is not reviewable')$$,'23514',null,'Generic review cannot mutate attachment metadata history');
select is(jsonb_array_length(list_ezyvet_attachment_runs((select id from fx where k='mapping'))->'runs'),1,'Browser discovers owned runs');
select is((select count(*)::integer from ezyvet_import_runs where resource='attachment'),0,'Own attachment runs and lease tokens hidden from direct SELECT');
select is((select count(*)::integer from ezyvet_import_snapshots where resource='attachment'),0,'Attachment snapshots require owned RPC');
select is((select count(*)::integer from ezyvet_identity_heads where resource='attachment'),0,'Attachment heads require owned RPC');
select is((select count(*)::integer from ezyvet_import_pages where run_id=(select id from fx where k='run')),0,'Attachment pages require owned RPC');
select is((select count(*)::integer from ezyvet_import_page_items where run_id=(select id from fx where k='run')),0,'Attachment page items require owned RPC');
select is((select count(*)::integer from ezyvet_import_runs where resource='animal'),1,'Older generic animal runs stay readable');
select is((select count(*)::integer from ezyvet_import_pages where run_id=(select id from fx where k='animal-run')),1,'Older animal page policy preserved');
select is((select count(*)::integer from ezyvet_import_page_items where run_id=(select id from fx where k='animal-run')),1,'Older animal page item policy preserved');

select ok(not(recover_ezyvet_attachment_run((select id from fx where k='run'),(select id from fx where k='mapping')) ? 'lease_id'),'Browser cannot see service lease');
select is(recover_ezyvet_attachment_run((select id from fx where k='run'),(select id from fx where k='mapping'))->>'observed_count','2','Recovered observed count explicit');
select is(recover_ezyvet_attachment_run((select id from fx where k='run'),(select id from fx where k='mapping'))->>'capture_available','false','No file capture implied');
select is(jsonb_array_length(list_ezyvet_attachment_observations((select id from fx where k='run'),(select id from fx where k='mapping'),null,null,1)->'observations'),1,'Observation limit enforced');
select is(list_ezyvet_attachment_observations((select id from fx where k='run'),(select id from fx where k='mapping'),null,null,1)#>>'{next_cursor,after_ordinal}','1','Observation cursor identifies exact ordinal');
select is(list_ezyvet_attachment_observations((select id from fx where k='run'),(select id from fx where k='mapping'),1,1,1)#>>'{observations,0,ordinal}','2','Next cursor returns second duplicate');
select throws_ok($$select list_ezyvet_attachment_observations((select id from fx where k='run'),(select id from fx where k='mapping'),1,null,20)$$,'23514',null,'Incomplete cursor rejected');
select set_config('request.jwt.claims','{"sub":"db690000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select recover_ezyvet_attachment_run((select id from fx where k='run'),(select id from fx where k='mapping'))$$,'42501',null,'Another admin cannot recover owned operation');
select is((select count(*)::integer from ezyvet_import_runs where resource='attachment'),0,'Other admin cannot directly read attachment lease tokens');
select is((select count(*)::integer from ezyvet_import_snapshots where resource='attachment'),0,'Other admin cannot bypass owned metadata RPC');
select throws_ok($$select list_ezyvet_attachment_observations((select id from fx where k='run'),(select id from fx where k='mapping'))$$,'42501',null,'Another admin cannot read observations');
select is(jsonb_array_length(list_ezyvet_attachment_runs((select id from fx where k='mapping'))->'runs'),0,'Discovery is actor scoped');
reset role;
update ezyvet_identity_heads set version=version+1 where resource='animal' and external_id='77';
select lives_ok($$select stage_ezyvet_attachment_page((select id from fx where k='run'),'db690000-0000-4000-8000-000000000001',null,(select v from data where k='page'))$$,'Exact receipt recovers after parent changes');
select is(claim_ezyvet_attachment_import((select id from fx where k='run'),'db690000-0000-4000-8000-000000000001','attachment-test-site','https://api.trial.ezyvet.com',(select id from fx where k='mapping'))->>'status','review_ready','Terminal claim preserves frozen parent');
set local role authenticated;select set_config('request.jwt.claims','{"sub":"db690000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(list_ezyvet_attachment_observations((select id from fx where k='run'),(select id from fx where k='mapping'))#>>'{observations,0,is_current}','false','Old observations remain readable and stale');
reset role;
-- Same snapshot on successive pages is two observations but one distinct staged version.
update ezyvet_import_runs set retry_after=null,lease_until=null;
insert into data select 'run2',claim_ezyvet_attachment_import((select id from fx where k='run2'),'db690000-0000-4000-8000-000000000001','attachment-test-site','https://api.trial.ezyvet.com',(select id from fx where k='mapping'));
insert into data select 'split-page',jsonb_set(jsonb_set(jsonb_set(v,'{observations}',jsonb_build_array(v#>'{observations,0}')),'{pagination}','{"items_page":1,"items_page_total":2,"items_page_size":1,"items_total":2}'),'{complete}','false') from data where k='page';
select stage_ezyvet_attachment_page((select id from fx where k='run2'),'db690000-0000-4000-8000-000000000001',(select(v->>'lease_id')::uuid from data where k='run2'),(select v from data where k='split-page'));
update ezyvet_import_runs set retry_after=null where id=(select id from fx where k='run2');
update data set v=claim_ezyvet_attachment_import((select id from fx where k='run2'),'db690000-0000-4000-8000-000000000001','attachment-test-site','https://api.trial.ezyvet.com',(select id from fx where k='mapping')) where k='run2';
select stage_ezyvet_attachment_page((select id from fx where k='run2'),'db690000-0000-4000-8000-000000000001',(select(v->>'lease_id')::uuid from data where k='run2'),(select jsonb_set(jsonb_set(jsonb_set(v,'{page}','2'),'{pagination,items_page}','2'),'{complete}','true') from data where k='split-page'));
select is(ezyvet_attachment_run_projection((select id from fx where k='run2'))->>'observed_count','2','Cross-page observations counted separately');
select is(ezyvet_attachment_run_projection((select id from fx where k='run2'))->>'staged_count','1','Run staged count is distinct stable versions across all pages');
select ok(not has_table_privilege('authenticated','public.ezyvet_attachment_runs','select'),'No direct browser run table access');
select ok(not has_table_privilege('service_role','public.ezyvet_attachment_page_observations','insert'),'Service cannot forge observations directly');
select ok(not has_function_privilege('authenticated','public.stage_ezyvet_attachment_page(uuid,uuid,uuid,jsonb)','execute'),'Browser cannot forge service actor');
select ok(not has_function_privilege('service_role','public.ezyvet_attachment_parent_context(uuid,text,text)','execute'),'Parent helper private');
select throws_ok($$update ezyvet_attachment_pages set page_sha256=repeat('a',64)$$,'23514',null,'Page receipts immutable');
select is(jsonb_build_object('treatments',(select count(*) from patient_treatments),'invoices',(select count(*) from billing_invoices),'stock',(select count(*) from inventory_movements),'outbox',(select count(*) from communication_outbox),'objects',(select count(*) from storage.objects)),(select v from data where k='side-effects'),'Metadata creates no clinical billing delivery or Storage effects');
select * from finish();rollback;
