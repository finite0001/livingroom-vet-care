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

insert into fx select k,gen_random_uuid() from unnest(array['migration','scope','excluded','binding','replacement']) k;
insert into data select 'manifest-scopes',jsonb_build_array(
 jsonb_build_object('id',(select id from fx where k='scope'),'mapping_id',m.id,'resource','attachment','parent_type','animal','parent_snapshot_id',m.snapshot_id,'parent_head_version',m.head_version,'disposition','required','reason','Synthetic attachment scope'),
 jsonb_build_object('id',(select id from fx where k='excluded'),'mapping_id',m.id,'resource','history','parent_type','animal','parent_snapshot_id',m.snapshot_id,'parent_head_version',m.head_version,'disposition','excluded','reason','Explicit pilot exclusion')) from ezyvet_record_links m where m.id=(select id from fx where k='mapping');
-- Deliberately mismatched synthetic children test identity validation independently
-- of source currentness. Existing real fixture children remain untouched.
insert into fx select k,gen_random_uuid() from unnest(array['wrong-site','wrong-owner','wrong-parent','wrong-patient','unscoped']) k;
insert into ezyvet_import_runs(id,source_origin,source_site_uid,resource,requested_by)
 select id,'https://api.trial.ezyvet.com',case when k='wrong-site' then 'different-site' else 'attachment-test-site' end,'attachment',
 case when k='wrong-owner' then 'db700000-0000-4000-8000-000000000002'::uuid else 'db700000-0000-4000-8000-000000000001'::uuid end
 from fx where k in ('wrong-site','wrong-owner','wrong-parent','wrong-patient','unscoped');
insert into ezyvet_attachment_runs(run_id,actor_id,animal_link_id,pet_id,parent_context)
 select f.id,c.actor_id,c.animal_link_id,c.pet_id,c.parent_context||case when f.k='wrong-parent' then '{"parent_observed_head_version":2}'::jsonb else jsonb_build_object('pet_id',gen_random_uuid()) end
 from fx f cross join ezyvet_attachment_runs c where f.k in ('wrong-parent','wrong-patient') and c.run_id=(select id from fx where k='run');
insert into data select 'children-before',jsonb_agg(to_jsonb(r) order by r.id) from ezyvet_import_runs r;
set local role authenticated;select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select prepare_ezyvet_migration_run((select id from fx where k='migration'),'https://api.trial.ezyvet.com','attachment-test-site',(select v from data where k='manifest-scopes'));
insert into data select 'binding',bind_ezyvet_migration_child((select id from fx where k='binding'),(select id from fx where k='scope'),(select id from fx where k='run'),'Synthetic first attempt');
select is((select v->>'actor_id' from data where k='binding'),auth.uid()::text,'Binding owner is server derived');
select is((select v#>>'{child_context,parent_evidence}' from data where k='binding'),'exact_parent_version','Attachment binding retains exact parent fidelity');
select ok(not ((select v->'child_context' from data where k='binding') ?| array['lease_id','lease_until','retry_after']),'Binding contains no service lease data');
select is(bind_ezyvet_migration_child((select id from fx where k='binding'),(select id from fx where k='scope'),(select id from fx where k='run'),'Synthetic first attempt'),(select v from data where k='binding'),'Exact lost-reply retry recovers binding');
select is(read_ezyvet_migration_binding((select id from fx where k='binding')),(select v from data where k='binding'),'Read recovery preserves original binding');
select is(jsonb_array_length(list_ezyvet_migration_bindings((select id from fx where k='scope'))->'bindings'),1,'Owner can discover binding without local pointer');
select throws_ok($$select bind_ezyvet_migration_child((select id from fx where k='binding'),(select id from fx where k='scope'),(select id from fx where k='run'),'Changed reason')$$,'42501',null,'Changed request identity rejected');
select throws_ok($$select bind_ezyvet_migration_child(gen_random_uuid(),(select id from fx where k='scope'),(select id from fx where k='run'),'Duplicate first attempt')$$,'40001',null,'Replacement must name predecessor');
select throws_ok($$select bind_ezyvet_migration_child(gen_random_uuid(),(select id from fx where k='scope'),(select id from fx where k='run'),'Duplicate child',(select id from fx where k='binding'))$$,'23514',null,'Same child cannot be counted as a new attempt');
select throws_ok($$select bind_ezyvet_migration_child(gen_random_uuid(),(select id from fx where k='excluded'),(select id from fx where k='run'),'Excluded work')$$,'23514',null,'Excluded scope cannot acquire work');
select throws_ok($$select bind_ezyvet_migration_child(gen_random_uuid(),(select id from fx where k='scope'),(select id from fx where k='animal-run'),'Wrong resource',(select id from fx where k='binding'))$$,'42501',null,'Different resource cannot be bound');
select throws_ok($$select bind_ezyvet_migration_child(gen_random_uuid(),(select id from fx where k='scope'),(select id from fx where k='wrong-site'),'Wrong site',(select id from fx where k='binding'))$$,'42501',null,'Cross-site child rejected');
select throws_ok($$select bind_ezyvet_migration_child(gen_random_uuid(),(select id from fx where k='scope'),(select id from fx where k='wrong-owner'),'Wrong owner',(select id from fx where k='binding'))$$,'42501',null,'Other owner child rejected');
select throws_ok($$select bind_ezyvet_migration_child(gen_random_uuid(),(select id from fx where k='scope'),(select id from fx where k='wrong-parent'),'Wrong parent',(select id from fx where k='binding'))$$,'42501',null,'Different observed parent version rejected');
select throws_ok($$select bind_ezyvet_migration_child(gen_random_uuid(),(select id from fx where k='scope'),(select id from fx where k='wrong-patient'),'Wrong patient',(select id from fx where k='binding'))$$,'42501',null,'Different patient context rejected');
select throws_ok($$select bind_ezyvet_migration_child(gen_random_uuid(),(select id from fx where k='scope'),(select id from fx where k='unscoped'),'Missing context',(select id from fx where k='binding'))$$,'42501',null,'Unscoped legacy child rejected');
select throws_ok($$select list_ezyvet_migration_bindings((select id from fx where k='scope'),now(),null)$$,'23514',null,'Partial binding cursor rejected');
select throws_ok($$select * from ezyvet_migration_bindings$$,'42501',null,'Raw bindings hidden from staff');
select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(read_ezyvet_migration_binding((select id from fx where k='binding')),null::jsonb,'Other owner cannot read binding');
select throws_ok($$select list_ezyvet_migration_bindings((select id from fx where k='scope'))$$,'42501',null,'Other owner cannot discover bindings');
select throws_ok($$select bind_ezyvet_migration_child((select id from fx where k='binding'),(select id from fx where k='scope'),(select id from fx where k='run'),'Synthetic first attempt')$$,'42501',null,'Another administrator cannot claim retry');
reset role;
select is((select jsonb_agg(to_jsonb(r) order by r.id) from ezyvet_import_runs r),(select v from data where k='children-before'),'Binding never changes child cursor, lease, owner or cooldown');
select is((select count(*)::integer from ezyvet_migration_bindings),1,'Invalid requests leave no partial binding');
select throws_ok($$update ezyvet_migration_bindings set reason='changed'$$,'23514',null,'Privileged mutation cannot rewrite binding');
select throws_ok($$delete from ezyvet_migration_bindings$$,'23514',null,'Privileged delete cannot erase binding');
select ok(not has_table_privilege('service_role','ezyvet_migration_bindings','INSERT'),'Service direct insert denied');
select ok(not has_function_privilege('anon','read_ezyvet_migration_binding(uuid)','EXECUTE'),'Anonymous recovery denied');
-- A second real child has the same immutable parent, then the current source drifts.
select claim_ezyvet_attachment_import((select id from fx where k='run2'),'db700000-0000-4000-8000-000000000001','attachment-test-site','https://api.trial.ezyvet.com',(select id from fx where k='mapping'));
update ezyvet_identity_heads set version=version+1 where resource='animal' and source_site_uid='attachment-test-site';
insert into data select 'children-after-drift',jsonb_agg(to_jsonb(r) order by r.id) from ezyvet_import_runs r;
set local role authenticated;select set_config('request.jwt.claims','{"sub":"db700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into data select 'replacement',bind_ezyvet_migration_child((select id from fx where k='replacement'),(select id from fx where k='scope'),(select id from fx where k='run2'),'Explicit replacement after source drift',(select id from fx where k='binding'));
select is((select v->>'replaces_id' from data where k='replacement'),(select id::text from fx where k='binding'),'Stale historical child can bind with exact predecessor');
select is(read_ezyvet_migration_binding((select id from fx where k='binding')),(select v from data where k='binding'),'Replacement preserves first attempt');
insert into data select 'page-one',list_ezyvet_migration_bindings((select id from fx where k='scope'),null,null,1);
select is((select v->>'has_more' from data where k='page-one'),'true','Binding history uses sentinel');
select is((select v#>>'{bindings,0,id}' from data where k='page-one'),(select id::text from fx where k='replacement'),'Newest attempt first');
insert into data select 'page-two',list_ezyvet_migration_bindings((select id from fx where k='scope'),(v#>>'{bindings,0,created_at}')::timestamptz,(v#>>'{bindings,0,id}')::uuid,1) from data where k='page-one';
select is((select v#>>'{bindings,0,id}' from data where k='page-two'),(select id::text from fx where k='binding'),'Cursor restores earlier attempt');
select is((select v->>'has_more' from data where k='page-two'),'false','Last attempt clears sentinel');
reset role;
select is((select jsonb_agg(to_jsonb(r) order by r.id) from ezyvet_import_runs r),(select v from data where k='children-after-drift'),'Historical binding does not renew stale child lease');
update profiles set is_active=false where id='db700000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select read_ezyvet_migration_binding((select id from fx where k='binding'))$$,'42501',null,'Inactive owner cannot recover');
select throws_ok($$select bind_ezyvet_migration_child((select id from fx where k='binding'),(select id from fx where k='scope'),(select id from fx where k='run'),'Synthetic first attempt')$$,'42501',null,'Inactive owner cannot replay');
reset role;
select is((select count(*)::integer from communication_outbox),0,'Bindings send no messages');
select * from finish();rollback;
