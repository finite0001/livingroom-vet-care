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

insert into fx select k,gen_random_uuid() from unnest(array['migration','scope','binding','contact-run','contact-mapping','contact-migration','contact-scope','contact-binding','new-run','new-binding']) k;
set local role authenticated;
select prepare_ezyvet_migration_run((select id from fx where k='migration'),'https://api.trial.ezyvet.com','attachment-test-site',(select jsonb_build_array(jsonb_build_object('id',(select id from fx where k='scope'),'mapping_id',id,'resource','animal','parent_type','animal','parent_snapshot_id',snapshot_id,'parent_head_version',head_version,'disposition','required','reason','Synthetic identity evidence')) from ezyvet_record_links where id=(select id from fx where k='mapping')));
select bind_ezyvet_migration_child((select id from fx where k='binding'),(select id from fx where k='scope'),(select id from fx where k='animal-run'),'Synthetic identity observation');
insert into data select 'item',list_ezyvet_migration_items((select id from fx where k='binding'))->'items'->0;
create function pg_temp.receipt(binding text default 'binding',item text default 'item') returns jsonb language sql as $$select read_ezyvet_migration_identity_evidence((select id from fx where k=binding),(v->>'page')::integer,(v->>'snapshot_id')::uuid,v->>'evidence_hash') from data where k=item;$$;
select is(pg_temp.receipt()->>'resource','animal','Patient mapping resource preserved');
select is(pg_temp.receipt()#>>'{approval,id}',(select id::text from fx where k='mapping'),'Exact declared mapping receipt');
select is(pg_temp.receipt()#>>'{approval,action}','link','Link action preserved');
select is(pg_temp.receipt()#>>'{approval,relationship}','same_snapshot_unknown_observed_head','Snapshot agreement is not an observed-version match');
select is(pg_temp.receipt()->>'observation_head_available','false','Missing observation head stays explicit');
select is(pg_temp.receipt()->>'exact_source_version_verified','false','No inferred exact version');
select is(pg_temp.receipt()->>'complete_coverage_verified','false','No inferred complete coverage');
select is(pg_temp.receipt()#>>'{approval,source_current}','true','Approved source version is current');
select is(pg_temp.receipt()#>>'{approval,local_record_unchanged}','true','Approved local version is unchanged');
select is(pg_temp.receipt()#>>'{approval,household_current}','true','Approved household association is current');
select ok(not pg_temp.receipt()::text ~ 'Synthetic reviewed|request_hash|payload_hash|reason|Metadata dog|attachment@example','No source or review prose exposed');
select throws_ok($$select read_ezyvet_migration_identity_evidence((select id from fx where k='binding'),1,(v->>'snapshot_id')::uuid,repeat('f',64)) from data where k='item'$$,'42501','Exact owned identity observation required','Forged evidence hash denied');
select throws_ok($$select read_ezyvet_migration_identity_evidence((select id from fx where k='binding'),2,(v->>'snapshot_id')::uuid,v->>'evidence_hash') from data where k='item'$$,'42501','Exact owned identity observation required','Wrong page denied');
select throws_ok($$select read_ezyvet_migration_identity_evidence((select id from fx where k='binding'),0,(v->>'snapshot_id')::uuid,v->>'evidence_hash') from data where k='item'$$,'23514','Invalid identity evidence observation','Invalid page denied');
reset role;
update ezyvet_identity_heads set version=version+2 where resource='animal' and source_site_uid='attachment-test-site';
update pets set version=version+1 where id=(select id from fx where k='pet');
set local role authenticated;
select is(pg_temp.receipt()#>>'{approval,source_current}','false','A to B to A invalidates approved source currentness');
select is(pg_temp.receipt()#>>'{approval,relationship}','same_snapshot_unknown_observed_head','Recurring payload still cannot establish observed head');
select is(pg_temp.receipt()#>>'{approval,local_record_unchanged}','false','Local edits remain separate from source snapshot agreement');
insert into fx select 'second-client',id from save_client(auth.uid(),null,null,'Second','Household','+13035550197','second@example.test','EMAIL',null,null);
reset role;
select throws_ok($$update pets set client_id=(select id from fx where k='second-client') where id=(select id from fx where k='pet')$$,'23514','Patient ownership transfer requires a separate workflow','Normal writes retain ownership transfer guard');
-- Synthetic historical drift only: restore the trigger immediately; outer transaction rolls back.
alter table pets disable trigger pets_version;
update pets set client_id=(select id from fx where k='second-client') where id=(select id from fx where k='pet');
alter table pets enable trigger pets_version;
set local role authenticated;
select is(pg_temp.receipt()#>>'{approval,household_current}','false','Patient household reassignment remains visible without rewriting mapping');
reset role;
-- A fresh generic run observes a different payload for the manifest-selected identity.
update ezyvet_import_runs set retry_after=null where resource='animal';
insert into data select 'new-claim',to_jsonb(claim_ezyvet_import((select id from fx where k='new-run'),'db700000-0000-4000-8000-000000000001','attachment-test-site','animal','https://api.trial.ezyvet.com'));
select stage_ezyvet_import_page((select id from fx where k='new-run'),'db700000-0000-4000-8000-000000000001',(select (v->>'lease_id')::uuid from data where k='new-claim'),1,true,'[{"external_id":"77","payload":{"id":77,"name":"Changed outside name"}},{"external_id":"88","payload":{"id":88,"name":"Unrelated patient"}}]');
set local role authenticated;
select bind_ezyvet_migration_child((select id from fx where k='new-binding'),(select id from fx where k='scope'),(select id from fx where k='new-run'),'Observe changed source without changing identity approval',(select id from fx where k='binding'));
insert into data select 'new-item',list_ezyvet_migration_items((select id from fx where k='new-binding'))->'items'->0;
select is(jsonb_array_length(list_ezyvet_migration_items((select id from fx where k='new-binding'))->'items'),1,'Unrelated patient excluded from shared scan');
select is(pg_temp.receipt('new-binding','new-item')#>>'{approval,relationship}','different_snapshot','Changed source observation does not replace approved mapping');
select is(pg_temp.receipt('new-binding','new-item')#>>'{approval,id}',(select id::text from fx where k='mapping'),'Original approved mapping retained after changed scan');
reset role;
-- Contact identity has a household-only approved mapping.
insert into data select 'contact-claim',to_jsonb(claim_ezyvet_import((select id from fx where k='contact-run'),'db700000-0000-4000-8000-000000000001','attachment-test-site','contact','https://api.trial.ezyvet.com'));
select stage_ezyvet_import_page((select id from fx where k='contact-run'),'db700000-0000-4000-8000-000000000001',(select(v->>'lease_id')::uuid from data where k='contact-claim'),1,true,'[{"external_id":"55","payload":{"id":55}}]');
insert into ezyvet_record_links(id,request_id,request_hash,source_origin,source_site_uid,resource,external_id,snapshot_id,head_version,client_id,pet_id,local_version,action,reason,approved_by)
select (select id from fx where k='contact-mapping'),gen_random_uuid(),'synthetic-contact',s.source_origin,s.source_site_uid,s.resource,s.external_id,s.id,h.version,(select id from fx where k='client'),null,1,'create','Synthetic contact approval','db700000-0000-4000-8000-000000000001' from ezyvet_import_snapshots s join ezyvet_identity_heads h on h.snapshot_id=s.id where s.resource='contact' and s.source_site_uid='attachment-test-site';
set local role authenticated;
select prepare_ezyvet_migration_run((select id from fx where k='contact-migration'),'https://api.trial.ezyvet.com','attachment-test-site',(select jsonb_build_array(jsonb_build_object('id',(select id from fx where k='contact-scope'),'mapping_id',id,'resource','contact','parent_type','contact','parent_snapshot_id',snapshot_id,'parent_head_version',head_version,'disposition','required','reason','Synthetic contact evidence')) from ezyvet_record_links where id=(select id from fx where k='contact-mapping')));
select bind_ezyvet_migration_child((select id from fx where k='contact-binding'),(select id from fx where k='contact-scope'),(select id from fx where k='contact-run'),'Synthetic contact observation');
insert into data select 'contact-item',list_ezyvet_migration_items((select id from fx where k='contact-binding'))->'items'->0;
select is(pg_temp.receipt('contact-binding','contact-item')->>'resource','contact','Household mapping resource preserved');
select is(pg_temp.receipt('contact-binding','contact-item')#>>'{approval,action}','create','Create receipt remains distinct from link');
select is(pg_temp.receipt('contact-binding','contact-item')#>>'{approval,local_record_unchanged}','true','Household version comparison uses client record');
select is(pg_temp.receipt('contact-binding','contact-item')#>>'{approval,household_current}','true','Household-only mapping requires no patient');
select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select pg_temp.receipt()$$,'42501','Exact owned identity observation required','Other administrator cannot use binding evidence');
reset role;update profiles set is_active=false where id='db700000-0000-4000-8000-000000000001';
set local role authenticated;select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select pg_temp.receipt()$$,'42501','Active administrator required','Inactive administrator denied');
reset role;
select ok(not has_function_privilege('anon','public.read_ezyvet_migration_identity_evidence(uuid,integer,uuid,text)','execute'),'Anonymous execution denied');
select ok(not has_function_privilege('service_role','public.read_ezyvet_migration_identity_evidence(uuid,integer,uuid,text)','execute'),'Worker execution denied');
select * from finish();rollback;
