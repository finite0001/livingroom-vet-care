begin;create extension if not exists pgtap with schema extensions;set local search_path=public,extensions;select no_plan();
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
insert into fx values('prescription-run',gen_random_uuid());
insert into data select 'prescription-run',claim_ezyvet_prescription_import((select id from fx where k='prescription-run'),'db560000-0000-4000-8000-000000000001','prescriptionitem-test-site','prescription','https://api.trial.ezyvet.com',(select id from fx where k='mapping'));
select stage_ezyvet_import_page((select id from fx where k='prescription-run'),'db560000-0000-4000-8000-000000000001',(select (v->>'lease_id')::uuid from data where k='prescription-run'),1,true,'[{"external_id":"101","payload":{"id":101,"animal_id":77,"instructions":"Source prescriptionation"}},{"external_id":"102","payload":{"id":102,"animal_id":77}}]');
insert into data select 'prescription',list_ezyvet_prescription_candidates((select id from fx where k='mapping'),'prescription')->'candidates'->0;
-- Choose external prescription 101 independent of creation-order ties.
update data set v=(select c from jsonb_array_elements(list_ezyvet_prescription_candidates((select id from fx where k='mapping'),'prescription')->'candidates') c where c->>'external_id'='101') where k='prescription';
insert into data values('items','[{"external_id":"501","payload":{"id":501,"prescription_id":101,"product_id":null,"date_start":null,"remaining":"unknown","qty":"outside units","serial_number":"outside author","instructions":"<script>outside prose</script>"}},{"external_id":"502","payload":{"id":502,"prescription_id":101,"qty":"unreviewed source amount","instructions":"Omitted original evidence"}}]');
insert into data select 'legacy',to_jsonb(claim_ezyvet_import_core((select id from fx where k='legacy'),'db560000-0000-4000-8000-000000000001','prescriptionitem-test-site','prescriptionitem','https://api.trial.ezyvet.com'));
select stage_ezyvet_import_page_core((select id from fx where k='legacy'),'db560000-0000-4000-8000-000000000001',(select (v->>'lease_id')::uuid from data where k='legacy'),1,false,(select v from data where k='items'));
update ezyvet_import_runs set retry_after=null,lease_until=null;
insert into data select 'terminal',to_jsonb(claim_ezyvet_import_core((select id from fx where k='terminal'),'db560000-0000-4000-8000-000000000001','prescriptionitem-test-site','prescriptionitem','https://api.trial.ezyvet.com'));
select stage_ezyvet_import_page_core((select id from fx where k='terminal'),'db560000-0000-4000-8000-000000000001',(select (v->>'lease_id')::uuid from data where k='terminal'),1,true,'[]');
update ezyvet_import_runs set retry_after=null,lease_until=null;
reset role;
insert into data select 'review-run',claim_ezyvet_prescriptionitem_import((select id from fx where k='run'),'db560000-0000-4000-8000-000000000001','prescriptionitem-test-site','prescriptionitem','https://api.trial.ezyvet.com',(select id from fx where k='mapping'),(select (v->>'id')::uuid from data where k='prescription'),(select v->>'payload_hash' from data where k='prescription'),(select (v->>'observed_head_version')::integer from data where k='prescription'));
select stage_ezyvet_import_page((select id from fx where k='run'),'db560000-0000-4000-8000-000000000001',(select (v->>'lease_id')::uuid from data where k='review-run'),1,true,(select v from data where k='items'));
insert into data select 'context',ezyvet_prescription_source_context((select id from fx where k='pet'),(select id from fx where k='run'));

insert into fx values('product',gen_random_uuid());
insert into catalog_products(id,name,kind,unit,unit_price_cents,created_by) select id,'Synthetic medication','medication','tablet',1000,'db560000-0000-4000-8000-000000000001' from fx where k='product';
insert into data select 'review',jsonb_build_object('reason','Historical interpretation only','outside_author',null,'prescribed_on',null,'prescription_date_status','uninterpreted','status','unknown','completeness','partial','partial_reason','Parent source list not supplied','replaces_id',null,'expected_predecessor_hash',null,'items',jsonb_build_array(jsonb_build_object('snapshot_id',v#>'{items,0,snapshot_id}','start_on',null,'start_date_status','unknown','product_id',(select id from fx where k='product'),'product_version',1,'note','No dose or refill inferred'))) from data where k='context';

insert into user_roles(user_id,role) values('db560000-0000-4000-8000-000000000001','DVM'),('db560000-0000-4000-8000-000000000002','DVM');
insert into fx select k,gen_random_uuid() from unnest(array['approval','duplicate','correction','competing','stale','abandon']) k;
insert into data select 'payload',jsonb_build_object('item_run_id',(select id from fx where k='run'),'patient_version',(select version from pets where id=(select id from fx where k='pet')),'interpretation',v) from data where k='review';
insert into data values('side-effects',jsonb_build_object('treatments',(select count(*) from patient_treatments),'invoices',(select count(*) from billing_invoices),'stock',(select count(*) from inventory_movements),'certificates',(select count(*) from vaccine_certificates),'reminders',(select count(*) from care_reminder_jobs),'outbox',(select count(*) from communication_outbox)));
-- FIXTURE_END

set local role authenticated;
insert into data select 'prepared',prepare_ezyvet_prescription_review((select id from fx where k='approval'),(select id from fx where k='pet'),(select v from data where k='payload'));
insert into data select 'approved',approve_ezyvet_prescription_review((select id from fx where k='approval'),(select id from fx where k='pet'),(select v#>>'{request,request_hash}' from data where k='prepared'),true);
reset role;

insert into fx values('release',gen_random_uuid());
set local role authenticated;

insert into fx select k,gen_random_uuid() from unnest(array['vconsult-run','vaccine-run','vaccine-review','vaccine-correction','vaccine-release','mixed-release']) k;
set local role service_role;
insert into data select 'vconsult-run',claim_ezyvet_clinical_import((select id from fx where k='vconsult-run'),'db560000-0000-4000-8000-000000000001','prescriptionitem-test-site','consult','https://api.trial.ezyvet.com',(select id from fx where k='mapping'));
select stage_ezyvet_import_page((select id from fx where k='vconsult-run'),'db560000-0000-4000-8000-000000000001',(select(v->>'lease_id')::uuid from data where k='vconsult-run'),1,true,'[{"external_id":"901","payload":{"id":901,"animal_id":77}}]');
set local role authenticated;select set_config('request.jwt.claims','{"sub":"db560000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into data select 'vconsult',list_ezyvet_clinical_candidates((select id from fx where k='mapping'),'consult')#>'{candidates,0}';
set local role service_role;
insert into data select 'vaccine-run',claim_ezyvet_vaccination_import((select id from fx where k='vaccine-run'),'db560000-0000-4000-8000-000000000001','prescriptionitem-test-site','vaccination','https://api.trial.ezyvet.com',(select id from fx where k='mapping'),(v->>'id')::uuid,v->>'payload_hash',(v->>'head_version')::integer) from data where k='vconsult';
select stage_ezyvet_import_page((select id from fx where k='vaccine-run'),'db560000-0000-4000-8000-000000000001',(select(v->>'lease_id')::uuid from data where k='vaccine-run'),1,true,'[{"external_id":"902","payload":{"id":"902","consult_id":"901","description":"Synthetic outside vaccine","date_of_administration":"ambiguous","date_of_next_administration":null,"active":"unknown"}}]');
set local role authenticated;select set_config('request.jwt.claims','{"sub":"db560000-0000-4000-8000-000000000002","role":"authenticated"}',true);
insert into data select 'vaccine-candidate',list_ezyvet_vaccination_review_candidates((select id from fx where k='pet'),(select id from fx where k='mapping'))#>'{candidates,0}';
insert into data select 'vaccine-payload',jsonb_build_object('animal_link_id',(select id from fx where k='mapping'),'patient_version',1,'snapshot_id',v->'id','payload_hash',v->'payload_hash','observed_head_version',v->'head_version','consult_snapshot_id',v->'consult_snapshot_id','consult_payload_hash',v->'consult_payload_hash','consult_observed_head_version',v->'consult_observed_head_version','product_id',null,'product_version',null,'administered_on',null,'administration_date_status','uninterpreted','source_next_due_on',null,'next_date_status','unknown','status','unknown','outside_author',null,'reason','Preserve unknown clinical source meanings','replaces_id',null,'expected_predecessor_hash',null) from data where k='vaccine-candidate';
insert into data select 'vaccine-prepared',prepare_ezyvet_vaccination_review((select id from fx where k='vaccine-review'),(select id from fx where k='pet'),(select v from data where k='vaccine-payload'));
insert into data select 'vaccine-approved',approve_ezyvet_vaccination_review((select id from fx where k='vaccine-review'),(select id from fx where k='pet'),(select v#>>'{request,request_hash}' from data where k='vaccine-prepared'),true);

insert into data select 'selection',jsonb_build_object('imported_prescription_ids',jsonb_build_array(v#>'{receipt,id}')) from data where k='approved';
insert into data select 'preview',preview_record_release_v8((select id from fx where k='pet'),(select id from fx where k='client'),'EMAIL','clinical-import@example.test',(select v from data where k='selection'));
select is((select v#>>'{snapshot,schema_version}' from data where k='preview'),'8','Prescription-only schema8 preview');
select is((select v#>'{snapshot,imported_prescriptions,0}' from data where k='preview'),(select v->'receipt' from data where k='approved'),'Preview preserves exact approved interpretation and source evidence');
select is((select v#>'{snapshot,selection,imported_vaccination_ids}' from data where k='preview'),'[]'::jsonb,'Prescription-only snapshot explicitly accounts for unselected vaccinations');
select is((select v#>'{snapshot,imported_vaccinations}' from data where k='preview'),'[]'::jsonb,'Prescription-only package includes no implicit vaccination');
select throws_ok($$select preview_record_release_v8((select id from fx where k='pet'),(select id from fx where k='client'),'EMAIL','clinical-import@example.test','{}')$$,'23514',null,'Empty package rejected');
select throws_ok($$select confirm_record_release((select id from fx where k='release'),(select id from fx where k='pet'),(select id from fx where k='client'),'EMAIL','clinical-import@example.test',(select v from data where k='selection'),(select v->'snapshot' from data where k='preview'),(select v->>'source_hash' from data where k='preview'),true)$$,'42501',null,'Schema8 requires explicit policy acceptance');
reset role;
insert into record_release_policy(id,enabled,accepted_by,accepted_at,acceptance_reference,accepted_schema_version) values(true,true,'Synthetic rollback reviewer',now(),'TEST ONLY',8);
set local role authenticated;
select confirm_record_release((select id from fx where k='release'),(select id from fx where k='pet'),(select id from fx where k='client'),'EMAIL','clinical-import@example.test',(select v from data where k='selection'),(select v->'snapshot' from data where k='preview'),(select v->>'source_hash' from data where k='preview'),true);
select is(read_record_release((select id from fx where k='release'))->>'eligible','true','Current prescription release eligible');
select is(jsonb_array_length(list_record_release_sources_v8((select id from fx where k='pet'))->'imported_prescription_ids'),1,'Discovery lists current reviewed prescription');
select is((select count(*)::integer from jsonb_each(select_all_record_release_sources_v8((select id from fx where k='pet'))->'selection') where jsonb_typeof(value)='array'),17,'Select-all retains all seventeen source families');
reset role;
select is((select source_kind from record_release_sources where release_id=(select id from fx where k='release')),'imported_prescription','Confirmed package registers prescription provenance');

set local role authenticated;
insert into data select 'mixed-selection',v||jsonb_build_object('imported_vaccination_ids',jsonb_build_array((select v#>'{receipt,id}' from data where k='vaccine-approved'))) from data where k='selection';
insert into data select 'mixed-preview',preview_record_release_v8((select id from fx where k='pet'),(select id from fx where k='client'),'EMAIL','clinical-import@example.test',(select v from data where k='mixed-selection'));
select is((select v#>'{snapshot,imported_prescriptions,0}' from data where k='mixed-preview'),(select v->'receipt' from data where k='approved'),'Mixed package retains exact prescription review');
select is((select v#>'{snapshot,imported_vaccinations,0}' from data where k='mixed-preview'),(select v->'receipt' from data where k='vaccine-approved'),'Mixed package retains exact vaccination review');
select confirm_record_release((select id from fx where k='mixed-release'),(select id from fx where k='pet'),(select id from fx where k='client'),'EMAIL','clinical-import@example.test',(select v from data where k='mixed-selection'),(select v->'snapshot' from data where k='mixed-preview'),(select v->>'source_hash' from data where k='mixed-preview'),true);
select is(read_record_release((select id from fx where k='mixed-release'))->>'eligible','true','Current mixed schema8 package is eligible');
reset role;
select is((select count(*)::integer from record_release_sources where release_id=(select id from fx where k='mixed-release')),2,'Mixed release registers both independent source families');
update ezyvet_identity_heads set version=version+1 where resource='vaccination' and external_id='902';
set local role authenticated;
select is(read_record_release((select id from fx where k='mixed-release'))->>'eligible','false','Vaccination change invalidates mixed schema8 package');
select is(read_record_release((select id from fx where k='release'))->>'eligible','true','Unselected vaccination change leaves prescription-only package eligible');
reset role;
-- Omitted source revision changes append an invalidation event; saved data stay fixed.
update ezyvet_identity_heads set version=version+1 where resource='prescriptionitem' and external_id='502';
set local role authenticated;
select is(read_record_release((select id from fx where k='release'))->>'eligible','false','Omitted source revision invalidates pending package');
select is(read_record_release((select id from fx where k='release'))#>'{release,snapshot}',(select v->'snapshot' from data where k='preview'),'Source event preserves immutable approved package');
select is((confirm_record_release((select id from fx where k='release'),(select id from fx where k='pet'),(select id from fx where k='client'),'EMAIL','clinical-import@example.test',(select v from data where k='selection'),(select v->'snapshot' from data where k='preview'),(select v->>'source_hash' from data where k='preview'),true)).snapshot,(select v->'snapshot' from data where k='preview'),'Exact committed confirmation retry survives source changes');
reset role;
-- Synthetic restoration only: the event must remain effective even if values revert.
update ezyvet_identity_heads set version=version-1 where resource='prescriptionitem' and external_id='502';
set local role authenticated;
select is(read_record_release((select id from fx where k='release'))->>'eligible','false','Restored values never revive an invalidated package');
insert into fx values('correctable-release',gen_random_uuid());
select confirm_record_release((select id from fx where k='correctable-release'),(select id from fx where k='pet'),(select id from fx where k='client'),'EMAIL','clinical-import@example.test',(select v from data where k='selection'),(select v->'snapshot' from data where k='preview'),(select v->>'source_hash' from data where k='preview'),true);
select set_config('request.jwt.claims','{"sub":"db560000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into data select 'correction-payload',jsonb_set(v,'{interpretation}',(v->'interpretation')||jsonb_build_object('reason','Corrected outside author after review','outside_author','Outside clinician','replaces_id',(select v#>>'{receipt,id}' from data where k='approved'),'expected_predecessor_hash',(select v#>>'{receipt,version_hash}' from data where k='approved'))) from data where k='payload';
insert into data select 'correction-prepared',prepare_ezyvet_prescription_review((select id from fx where k='correction'),(select id from fx where k='pet'),(select v from data where k='correction-payload'));
insert into data select 'corrected',approve_ezyvet_prescription_review((select id from fx where k='correction'),(select id from fx where k='pet'),(select v#>>'{request,request_hash}' from data where k='correction-prepared'),true);
select is(read_record_release((select id from fx where k='correctable-release'))->>'eligible','false','Clinical correction invalidates prior selected version');
select throws_ok($$select preview_record_release_v8((select id from fx where k='pet'),(select id from fx where k='client'),'EMAIL','clinical-import@example.test',(select v from data where k='selection'))$$,'40001',null,'Superseded version cannot enter fresh preview');
select is(list_record_release_sources_v8((select id from fx where k='pet'))#>>'{imported_prescription_ids,0,id}',(select v#>>'{receipt,id}' from data where k='corrected'),'Discovery offers latest correction');
reset role;
select ok(not has_function_privilege('anon','public.preview_record_release_v8(uuid,uuid,text,text,jsonb)','execute'),'Anonymous preview denied');
select ok(not has_function_privilege('service_role','public.preview_record_release_v8(uuid,uuid,text,text,jsonb)','execute'),'Service preview bypass denied');
select * from finish();rollback;
