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

create temp table adapters(resource text primary key,child uuid,mapping uuid,parent_type text,parent uuid,head integer,scope uuid default gen_random_uuid(),binding uuid default gen_random_uuid());
grant all on adapters to authenticated;
insert into adapters(resource,child,mapping,parent_type,parent,head)
 select q.resource,q.child,m.id,'animal',m.snapshot_id,m.head_version from ezyvet_record_links m cross join
 (values('animal',(select id from fx where k='animal-run')),('attachment',(select id from fx where k='run'))) q(resource,child) where m.id=(select id from fx where k='mapping');
do $$declare a uuid:='db700000-0000-4000-8000-000000000001';m uuid:=(select id from fx where k='mapping');
 c uuid;claimed jsonb;s public.ezyvet_import_snapshots;cm uuid:=gen_random_uuid();resource_name text;
begin
 c:=gen_random_uuid();claimed:=to_jsonb(claim_ezyvet_import(c,a,'attachment-test-site','contact','https://api.trial.ezyvet.com'));
 perform stage_ezyvet_import_page(c,a,(claimed->>'lease_id')::uuid,1,true,'[{"external_id":"8","payload":{"id":8}},{"external_id":"999","payload":{"id":999}}]');
 select * into strict s from ezyvet_import_snapshots where source_site_uid='attachment-test-site' and resource='contact' and external_id='8';
 insert into ezyvet_record_links(id,request_id,request_hash,source_origin,source_site_uid,resource,external_id,snapshot_id,head_version,client_id,pet_id,local_version,action,reason,approved_by)
 values(cm,cm,'synthetic-contact-mapping',s.source_origin,s.source_site_uid,s.resource,s.external_id,s.id,1,(select id from fx where k='client'),null,1,'link','Synthetic reviewed contact',a);
 insert into adapters(resource,child,mapping,parent_type,parent,head) values('contact',c,cm,'contact',s.id,1);
 foreach resource_name in array array['healthstatus','consult','history','prescription'] loop
  c:=gen_random_uuid();
  if resource_name='healthstatus' then claimed:=claim_ezyvet_weight_import(c,a,'attachment-test-site','https://api.trial.ezyvet.com',m);
  elsif resource_name='prescription' then claimed:=claim_ezyvet_prescription_import(c,a,'attachment-test-site',resource_name,'https://api.trial.ezyvet.com',m);
  else claimed:=claim_ezyvet_clinical_import(c,a,'attachment-test-site',resource_name,'https://api.trial.ezyvet.com',m);end if;
  insert into adapters(resource,child,mapping,parent_type,parent,head) select resource_name,c,m,'animal',snapshot_id,head_version from ezyvet_record_links where id=m;
  if resource_name='consult' then
   perform stage_ezyvet_import_page(c,a,(claimed->>'lease_id')::uuid,1,true,'[{"external_id":"1","payload":{"id":1,"animal_id":77}}]');
  elsif resource_name='prescription' then
   perform stage_ezyvet_import_page(c,a,(claimed->>'lease_id')::uuid,1,true,'[{"external_id":"3","payload":{"id":"3","animal_id":"77","consult_id":"1","prescription_item_list":[4]}}]');
  end if;
 end loop;
 select * into strict s from ezyvet_import_snapshots where source_site_uid='attachment-test-site' and resource='consult';
 c:=gen_random_uuid();perform claim_ezyvet_vaccination_import(c,a,'attachment-test-site','vaccination','https://api.trial.ezyvet.com',m,s.id,s.payload_hash,1);
 insert into adapters(resource,child,mapping,parent_type,parent,head) values('vaccination',c,m,'consult',s.id,1);
 select * into strict s from ezyvet_import_snapshots where source_site_uid='attachment-test-site' and resource='prescription';
 c:=gen_random_uuid();perform claim_ezyvet_prescriptionitem_import(c,a,'attachment-test-site','prescriptionitem','https://api.trial.ezyvet.com',m,s.id,s.payload_hash,1);
 insert into adapters(resource,child,mapping,parent_type,parent,head) values('prescriptionitem',c,m,'prescription',s.id,1);
end $$;
insert into data select 'adapter-children',jsonb_agg(to_jsonb(r) order by id) from ezyvet_import_runs r;
set local role authenticated;select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select prepare_ezyvet_migration_run(gen_random_uuid(),'https://api.trial.ezyvet.com','attachment-test-site',
 (select jsonb_agg(jsonb_build_object('id',scope,'mapping_id',mapping,'resource',resource,'parent_type',parent_type,'parent_snapshot_id',parent,'parent_head_version',head,'disposition','required','reason','Synthetic adapter acceptance')) from adapters));
select is(bind_ezyvet_migration_child(binding,scope,child,'Explicit resource attempt')->>'child_run_id',child::text,'Real '||resource||' child binds') from adapters;
select is(read_ezyvet_migration_binding(binding)#>>'{child_context,parent_evidence}',
 case when resource in ('contact','animal') then 'selected_identity_filter' when resource in ('attachment','vaccination','prescriptionitem') then 'exact_parent_version' else 'mapping_identity_only' end,
 resource||' declares its actual source fidelity') from adapters;
select is(read_ezyvet_migration_binding_progress(binding)#>>'{observations,occurrences}',
 case when resource='attachment' then '2' when resource in ('animal','contact','consult','prescription') then '1' else '0' end,
 resource||' reports observed records from its canonical ledger') from adapters;
select is(read_ezyvet_migration_binding_progress(binding)#>>'{observations,currentness_available}',
 case when resource in ('animal','contact','healthstatus') then 'false' else 'true' end,
 resource||' does not invent missing observed head versions') from adapters;
reset role;
select is((select count(*)::integer from ezyvet_migration_bindings),9,'All supported resource families have a binding');
select is((select jsonb_agg(to_jsonb(r) order by id) from ezyvet_import_runs r),(select v from data where k='adapter-children'),'All resource bindings leave child state unchanged');
select is((select count(*)::integer from communication_outbox),0,'Adapter acceptance sends nothing');

-- Populate the remaining child families through their actual stage contract.
do $$declare x record;r public.ezyvet_import_runs;payload jsonb;begin
 for x in select * from adapters where resource in ('healthstatus','history','vaccination','prescriptionitem') loop
  select * into r from ezyvet_import_runs where id=x.child;
  payload:=jsonb_build_object('id','9',case when x.resource='vaccination' then 'consult_id' when x.resource='prescriptionitem' then 'prescription_id' else 'animal_id' end,
   case when x.resource='vaccination' then '1' when x.resource='prescriptionitem' then '3' else '77' end);
  perform stage_ezyvet_import_page(x.child,'db700000-0000-4000-8000-000000000001',r.lease_id,1,true,jsonb_build_array(jsonb_build_object('external_id','9','payload',payload)));
 end loop;
end $$;
set local role authenticated;
select is(jsonb_array_length(list_ezyvet_migration_items(binding)->'items'),case when resource='attachment' then 2 else 1 end,resource||' item adapter reads its populated canonical ledger') from adapters;
select is(list_ezyvet_migration_items(binding)#>>'{items,0,exact_source_current}',case when resource in ('animal','contact','healthstatus') then null else 'true' end,resource||' item preserves observed head fidelity') from adapters;
select is(list_ezyvet_migration_items(binding)#>>'{items,0,ordinal}',case when resource='attachment' then '1' else '0' end,resource||' has a stable occurrence cursor') from adapters;
select * from finish();rollback;
