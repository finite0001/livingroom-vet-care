begin;create extension if not exists pgtap with schema extensions;set local search_path=public,extensions;select no_plan();


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

-- Metadata/receipt SQL fixture only: physical byte packages have separate acceptance.
create temp table boundary_records(n integer primary key,id uuid,request_id uuid);
grant all on boundary_records to authenticated;
do $seed$ declare page_no integer;i integer;idx integer;observations jsonb;page jsonb;claim jsonb;o record;
 rid uuid;prepared jsonb;reserved jsonb;ready jsonb;review public.ezyvet_attachment_record_versions;
 actor uuid:='db700000-0000-4000-8000-000000000001';mapping uuid:=(select id from fx where k='mapping');metadata_run uuid:=(select id from fx where k='run2');pet uuid:=(select id from fx where k='pet');
begin
 for page_no in 1..11 loop
  observations:='[]';
  for idx in ((page_no-1)*10+1)..least(page_no*10,101) loop
   observations:=observations||jsonb_build_array(jsonb_build_object('external_id',(1000+idx)::text,'file_id',(2000+idx)::text,
    'metadata',jsonb_build_object('id',(1000+idx)::text,'file_id',(2000+idx)::text,'record_type','Animal','record_id','77','name','Boundary original '||idx),
    'raw_record_sha256',encode(sha256(convert_to('raw'||idx,'UTF8')),'hex'),'stable_metadata_sha256',encode(sha256(convert_to('stable'||idx,'UTF8')),'hex'),'file_sha256',null));
  end loop;
  page:=jsonb_build_object('contract_version','ezyvet_animal_attachment_metadata_v1','parent',jsonb_build_object('record_type','Animal','record_id','77'),
   'page',page_no,'complete',page_no=11,'pagination',jsonb_build_object('items_page',page_no,'items_page_total',11,'items_page_size',10,'items_total',101),
   'observations',observations,'page_sha256',encode(sha256(convert_to(observations::text,'UTF8')),'hex'));
  update ezyvet_import_runs set retry_after=null where resource='attachment';
  claim:=claim_ezyvet_attachment_import(metadata_run,actor,'attachment-test-site','https://api.trial.ezyvet.com',mapping);
  perform stage_ezyvet_attachment_page(metadata_run,actor,(claim->>'lease_id')::uuid,page);
 end loop;
 -- No upstream is contacted in this SQL fixture; release metadata scan cooldown.
 update ezyvet_import_runs set retry_after=null where resource='attachment';
 i:=0;
 for o in select * from ezyvet_attachment_page_observations where ezyvet_attachment_page_observations.run_id=metadata_run order by ezyvet_attachment_page_observations.page,ezyvet_attachment_page_observations.ordinal loop
  i:=i+1;rid:=gen_random_uuid();
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  prepared:=prepare_ezyvet_attachment_capture(rid,mapping,metadata_run,o.page,o.ordinal,o.snapshot_id,o.head_version,o.stable_metadata_sha256);
  claim:=claim_ezyvet_attachment_capture(rid,actor);
  reserved:=reserve_ezyvet_attachment_original(rid,actor,(claim->>'lease_id')::uuid,repeat('e',64),'application/pdf',12,o.raw_record_sha256,o.raw_record_sha256);
  insert into storage.objects(bucket_id,name,metadata) values(reserved#>>'{intent,bucket_id}',reserved#>>'{intent,object_path}','{"size":12,"mimetype":"application/pdf"}');
  ready:=complete_ezyvet_attachment_capture(rid,actor,(claim->>'lease_id')::uuid,(reserved#>>'{intent,id}')::uuid,repeat('e',64),'application/pdf',12);
  review:=approve_ezyvet_attachment_record(gen_random_uuid(),rid,pet,ready#>>'{request,capture,capture_hash}',null,'Boundary original '||i,'Synthetic boundary fixture inspection',true);
  insert into boundary_records values(i,review.id,rid);
  if i=20 then insert into data values('select-all-20',select_all_record_release_sources_v9(pet));end if;
 end loop;
end $seed$;
select is((select count(*) from boundary_records),101::bigint,'101 distinct originals traverse canonical capture and approval');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into data select 'first-100',list_record_release_sources_v9((select id from fx where k='pet'),0);
insert into data select 'last-one',list_record_release_sources_v9((select id from fx where k='pet'),100);
select is(jsonb_array_length((select v->'api_attachment_ids' from data where k='first-100')),100,'First discovery page contains exactly100 originals');
select is((select v#>>'{has_more,api_attachment_ids}' from data where k='first-100'),'true','Sentinel advertises remaining original');
select is(jsonb_array_length((select v->'api_attachment_ids' from data where k='last-one')),1,'Second page returns the101st original');
select is((select v#>>'{has_more,api_attachment_ids}' from data where k='last-one'),'false','Final page terminates');
select is((select count(distinct item->>'id') from data cross join lateral jsonb_array_elements(v->'api_attachment_ids') item where k in('first-100','last-one')),101::bigint,'Pages contain no duplicates or silent omissions');
select is((select jsonb_agg(item->>'id' order by item->>'id') from data cross join lateral jsonb_array_elements(v->'api_attachment_ids') item where k in('first-100','last-one')),(select jsonb_agg(id::text order by id::text) from boundary_records),'Discovery covers exactly the approved original set');
select is(jsonb_array_length(list_record_release_sources_v9((select id from fx where k='pet'),101)->'api_attachment_ids'),0,'Offset beyond last record is empty');
select is((select v-'api_attachment_ids'-'policy_v9_accepted'-'has_more' from data where k='first-100'),list_record_release_sources_v8((select id from fx where k='pet'),0)-'has_more','Pagination preserves every existing family field');
select is(jsonb_array_length((select v#>'{selection,api_attachment_ids}' from data where k='select-all-20')),20,'Select all includes exactly20 when within its limit');
select is((select jsonb_agg(x order by x) from data cross join lateral jsonb_array_elements(v#>'{selection,api_attachment_ids}') x where k='select-all-20'),(select jsonb_agg(to_jsonb(id) order by to_jsonb(id)) from boundary_records where n<=20),'Select all retains every allowed source without truncation');
select throws_ok($$select select_all_record_release_sources_v9((select id from fx where k='pet'))$$,'23514',null,'Select all refuses101 instead of selecting first20');
create function pg_temp.boundary_preview(amount integer) returns jsonb language sql as $$
 select preview_record_release_v9((select id from fx where k='pet'),(select id from fx where k='client'),'EMAIL','attachment@example.test',jsonb_build_object('api_attachment_ids',(select jsonb_agg(id order by n) from boundary_records where n<=$1)));
$$;
insert into data select 'max-preview',pg_temp.boundary_preview(20);
select is(jsonb_array_length((select v#>'{snapshot,api_attachments}' from data where k='max-preview')),20,'Explicit maximum preview includes20 reviewed originals');
select is(jsonb_array_length((select v#>'{snapshot,attachments}' from data where k='max-preview')),20,'Maximum preview has exactly20 distinct file descriptors');
select throws_ok($$select pg_temp.boundary_preview(21)$$,'23514',null,'Twenty-first original rejected by authoritative preview');
reset role;
insert into record_release_policy(id,enabled,accepted_by,accepted_at,acceptance_reference,accepted_schema_version) values(true,true,'Synthetic SQL boundary fixture',now(),'LOCAL TEST ONLY',9);
set local role authenticated;
insert into fx select 'boundary-release',gen_random_uuid();
insert into data select 'boundary-confirmed',to_jsonb(confirm_record_release((select id from fx where k='boundary-release'),(select id from fx where k='pet'),(select id from fx where k='client'),'EMAIL','attachment@example.test',v#>'{snapshot,selection}',v->'snapshot',v->>'source_hash',true)) from data where k='max-preview';
select is(read_record_release((select id from fx where k='boundary-release'))->>'eligible','true','Maximum explicit release confirms and remains current');
insert into fx select 'other-client',id from save_client(auth.uid(),null,null,'Mapping','Other',null,'mapping-other@example.test','EMAIL',null,null);
insert into fx select 'other-pet',id from save_patient(null,(select id from fx where k='client'),null,'Other mapped patient','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
reset role;
-- Each mapping mutation is rolled back independently; no stale result carries over.

savepoint mapping_probe;
update ezyvet_record_links set pet_id=(select id from fx where k='other-pet') where id=(select id from fx where k='mapping');
set local role authenticated;
select is(jsonb_array_length(list_record_release_sources_v9((select id from fx where k='pet'))->'api_attachment_ids'),0,'Changed mapping omits all stale originals: pet_id');
select is(read_record_release((select id from fx where k='boundary-release'))->>'eligible','false','Changed mapping invalidates maximum release: pet_id');
select ok(jsonb_array_length(read_record_release((select id from fx where k='boundary-release'))->'events')>0,'Mapping change records durable invalidation event');
select is((read_record_release((select id from fx where k='boundary-release'))->'release')->>'source_hash',(select v->>'source_hash' from data where k='boundary-confirmed'),'Historical reviewed hash remains recoverable');
rollback to mapping_probe;

savepoint mapping_probe;
update ezyvet_record_links set client_id=(select id from fx where k='other-client') where id=(select id from fx where k='mapping');
set local role authenticated;
select is(jsonb_array_length(list_record_release_sources_v9((select id from fx where k='pet'))->'api_attachment_ids'),0,'Changed mapping omits all stale originals: client_id');
select is(read_record_release((select id from fx where k='boundary-release'))->>'eligible','false','Changed mapping invalidates maximum release: client_id');
select ok(jsonb_array_length(read_record_release((select id from fx where k='boundary-release'))->'events')>0,'Mapping change records durable invalidation event');
select is((read_record_release((select id from fx where k='boundary-release'))->'release')->>'source_hash',(select v->>'source_hash' from data where k='boundary-confirmed'),'Historical reviewed hash remains recoverable');
rollback to mapping_probe;

savepoint mapping_probe;
update ezyvet_record_links set external_id='88' where id=(select id from fx where k='mapping');
set local role authenticated;
select is(jsonb_array_length(list_record_release_sources_v9((select id from fx where k='pet'))->'api_attachment_ids'),0,'Changed mapping omits all stale originals: external_id');
select is(read_record_release((select id from fx where k='boundary-release'))->>'eligible','false','Changed mapping invalidates maximum release: external_id');
select ok(jsonb_array_length(read_record_release((select id from fx where k='boundary-release'))->'events')>0,'Mapping change records durable invalidation event');
select is((read_record_release((select id from fx where k='boundary-release'))->'release')->>'source_hash',(select v->>'source_hash' from data where k='boundary-confirmed'),'Historical reviewed hash remains recoverable');
rollback to mapping_probe;

savepoint mapping_probe;
update ezyvet_record_links set source_site_uid='changed-site' where id=(select id from fx where k='mapping');
set local role authenticated;
select is(jsonb_array_length(list_record_release_sources_v9((select id from fx where k='pet'))->'api_attachment_ids'),0,'Changed mapping omits all stale originals: source_site_uid');
select is(read_record_release((select id from fx where k='boundary-release'))->>'eligible','false','Changed mapping invalidates maximum release: source_site_uid');
select ok(jsonb_array_length(read_record_release((select id from fx where k='boundary-release'))->'events')>0,'Mapping change records durable invalidation event');
select is((read_record_release((select id from fx where k='boundary-release'))->'release')->>'source_hash',(select v->>'source_hash' from data where k='boundary-confirmed'),'Historical reviewed hash remains recoverable');
rollback to mapping_probe;
set local role authenticated;select is(read_record_release((select id from fx where k='boundary-release'))->>'eligible','true','Independent mapping probes leave original release current after rollback');select * from finish();rollback;
