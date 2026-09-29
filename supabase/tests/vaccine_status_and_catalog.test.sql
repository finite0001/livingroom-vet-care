begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- FIXTURE_BEGIN: synthetic vet (ADMIN+DVM), plain staff, one household with two patients.
insert into auth.users(id,email,raw_user_meta_data) values('a9280000-0000-4000-8000-000000000001','vaccine-status-vet@example.test','{}'),('a9280000-0000-4000-8000-000000000002','vaccine-status-staff@example.test','{}');
update public.profiles set is_active=true where id in ('a9280000-0000-4000-8000-000000000001','a9280000-0000-4000-8000-000000000002');
insert into public.user_roles(user_id,role) values('a9280000-0000-4000-8000-000000000001','STAFF'),('a9280000-0000-4000-8000-000000000001','DVM'),('a9280000-0000-4000-8000-000000000001','ADMIN'),('a9280000-0000-4000-8000-000000000002','STAFF') on conflict do nothing;
create temp table fx(k text primary key,id uuid); grant all on fx to authenticated;
create temp table data(k text primary key,v jsonb); grant all on data to authenticated;
select is((select count(*)::integer from public.catalog_vaccine_profiles),0,'No vaccine catalog metadata is seeded');
select is((select count(*)::integer from public.app_settings where key='vaccine_due_soon_days'),0,'No due-soon window is seeded');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a9280000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fx select 'client',id from public.save_client(auth.uid(),null,null,'Vaccine','Status','3035550111',null,'EMAIL','1 Test St, Boulder CO',null);
insert into fx select 'pet',id from public.save_patient(null,(select id from fx where k='client'),null,'Status dog','Dog','Mixed','2020-01-01','exact','Brown','female','neutered',null,null,null);
insert into fx select 'other',id from public.save_patient(null,(select id from fx where k='client'),null,'Other dog','Dog','Mixed','2020-01-01','exact','Brown','female','neutered',null,null,null);
insert into fx select 'rabies',id from public.save_catalog_product(null,null,'Synthetic rabies product','vaccine','Synthetic maker','dose',100,true);
insert into fx select 'combo',id from public.save_catalog_product(null,null,'Synthetic combination product','vaccine','Synthetic maker','dose',100,true);
insert into fx select 'profiled',id from public.save_catalog_product(null,null,'Synthetic profiled product','vaccine','Synthetic maker','dose',100,true);
insert into fx select 'plain',id from public.save_catalog_product(null,null,'Synthetic ungrouped product','vaccine','Synthetic maker','dose',100,true);
insert into fx select 'med',id from public.save_catalog_product(null,null,'Synthetic medication','medication','Synthetic maker','tablet',100,true);

-- Catalog vaccine metadata: authority, validation, normalization, idempotency and concurrency.
select throws_ok($$select public.save_catalog_vaccine_profile((select id from fx where k='med'),null,null,'{}',null,null,null,'Label review')$$,'23514','Vaccine metadata applies only to vaccine products','Medication cannot carry vaccine metadata');
select throws_ok($$select public.save_catalog_vaccine_profile((select id from fx where k='profiled'),null,'Bad Key!','{}',null,null,null,'Label review')$$,'23514',null,'Group key format enforced');
select throws_ok($$select public.save_catalog_vaccine_profile((select id from fx where k='profiled'),null,null,'{}',null,'2 years',null,'Label review')$$,'23514','Labeled duration must match the product label choices','Duration limited to label choices');
select throws_ok($$select public.save_catalog_vaccine_profile((select id from fx where k='profiled'),null,null,'{}',null,null,0,'Label review')$$,'23514',null,'Booster interval must be positive');
select throws_ok($$select public.save_catalog_vaccine_profile((select id from fx where k='profiled'),null,null,'{}',null,null,null,'  ')$$,'23514','Record the label source or reviewer for this metadata','Review note required');
select throws_ok($$select public.save_catalog_vaccine_profile((select id from fx where k='profiled'),null,null,array[null]::text[],null,null,null,'Label review')$$,'23514',null,'Null species rejected');
insert into data select 'profile',to_jsonb(public.save_catalog_vaccine_profile((select id from fx where k='profiled'),null,' Bordetella ',array['Dog',' dog ','Cat'],' Synthetic type ','1 year',365,' Synthetic label review '));
select is((select v->>'group_key' from data where k='profile'),'bordetella','Group key normalized');
select is((select v->'species' from data where k='profile'),'["cat", "dog"]'::jsonb,'Species normalized, deduplicated and sorted');
select is((select v->>'vaccine_type' from data where k='profile'),'Synthetic type','Vaccine type trimmed');
select is((select (v->>'version')::integer from data where k='profile'),1,'First save is version 1');
select is((select (to_jsonb(public.save_catalog_vaccine_profile((select id from fx where k='profiled'),null,'bordetella',array['cat','dog'],'Synthetic type','1 year',365,'Synthetic label review'))->>'version')::integer),1,'Lost-response retry returns the saved row');
select throws_ok($$select public.save_catalog_vaccine_profile((select id from fx where k='profiled'),null,'bordetella','{}',null,null,null,'Different review')$$,'PT409',null,'Different content without the current version conflicts');
select is((select (to_jsonb(public.save_catalog_vaccine_profile((select id from fx where k='profiled'),1,'bordetella','{dog}',null,null,null,'Cleared by review'))->>'default_booster_interval_days')),null,'Reviewer can clear optional values');
select public.save_catalog_vaccine_profile((select id from fx where k='plain'),null,null,'{}',null,'3 years',1095,'Synthetic label review');
select throws_ok($$insert into public.catalog_vaccine_profiles(product_id,review_note,updated_by) values((select id from fx where k='rabies'),'x',auth.uid())$$,'42501',null,'Browser cannot write profiles directly');
select throws_ok($$update public.catalog_vaccine_profiles set default_booster_interval_days=1$$,'42501',null,'Browser cannot update profiles directly');
select is((select count(*)::integer from public.catalog_vaccine_profiles),2,'Active staff can read profiles');
select set_config('request.jwt.claims','{"sub":"a9280000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.save_catalog_vaccine_profile((select id from fx where k='rabies'),null,null,'{}',null,null,null,'Label review')$$,'42501','Veterinarian or administrator required for vaccine catalog metadata','Plain staff cannot edit vaccine metadata');
select set_config('request.jwt.claims','{"sub":"a9280000-0000-4000-8000-000000000001","role":"authenticated"}',true);
reset role;
select throws_ok($$delete from public.catalog_vaccine_profiles$$,'23514',null,'Profiles cannot be deleted');
select throws_ok($$update public.catalog_vaccine_profiles set product_id=(select id from fx where k='rabies') where product_id=(select id from fx where k='profiled')$$,'23514',null,'Profile product is immutable');

-- Status summary fixtures: reviewed templates, stock, invoice and administrations.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a9280000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.save_vaccine_due_template('a9280000-0000-4000-8000-000000000101',null,'rabies','Rabies group',array[(select id from fx where k='rabies')],30,true,'Synthetic template review');
select public.save_vaccine_due_template('a9280000-0000-4000-8000-000000000102',null,'dapp','Combination group A',array[(select id from fx where k='combo')],30,true,'Synthetic template review');
select public.save_vaccine_due_template('a9280000-0000-4000-8000-000000000103',null,'lepto','Combination group B',array[(select id from fx where k='combo')],30,true,'Synthetic template review');
select public.save_vaccine_due_template('a9280000-0000-4000-8000-000000000104',null,'plan-only','Plan-only group',array[(select id from fx where k='plain')],30,true,'Synthetic template review');
select public.save_vaccine_due_template('a9280000-0000-4000-8000-000000000105',null,'inactive-group','Inactive group',array[(select id from fx where k='plain')],30,false,'Synthetic template review');
select public.receive_inventory(gen_random_uuid(),'a9280000-0000-4000-8000-000000000201',(select id from fx where k='rabies'),'LOT-R',current_date+3650,'Clinic',20,'Synthetic stock');
select public.receive_inventory(gen_random_uuid(),'a9280000-0000-4000-8000-000000000202',(select id from fx where k='combo'),'LOT-C',current_date+3650,'Clinic',20,'Synthetic stock');
select public.receive_inventory(gen_random_uuid(),'a9280000-0000-4000-8000-000000000203',(select id from fx where k='profiled'),'LOT-P',current_date+3650,'Clinic',20,'Synthetic stock');
select public.create_billing_invoice('a9280000-0000-4000-8000-000000000301',(select id from fx where k='client'));
create function pg_temp.give(p_id uuid,p_pet uuid,p_lot uuid,p_days_ago integer,p_due date) returns uuid language sql as $$
 select (public.record_patient_treatment(p_id,jsonb_build_object('pet_id',p_pet,'lot_id',p_lot,'invoice_id','a9280000-0000-4000-8000-000000000301','quantity',1,'dose','1 mL','route','SC','site','Synthetic site','veterinarian','Dr Synthetic','veterinarian_license','TEST-ONLY','administered_at',now()-make_interval(days=>p_days_ago),'next_due_on',p_due,'alert_review',jsonb_build_object('source_hash',public.read_patient_treatment_alerts(p_pet)->>'source_hash','acknowledged',true)))).id
$$;
select pg_temp.give('a9280000-0000-4000-8000-000000000401',(select id from fx where k='pet'),'a9280000-0000-4000-8000-000000000201',400,current_date-35);
select pg_temp.give('a9280000-0000-4000-8000-000000000402',(select id from fx where k='pet'),'a9280000-0000-4000-8000-000000000201',10,current_date+355);
select pg_temp.give('a9280000-0000-4000-8000-000000000403',(select id from fx where k='pet'),'a9280000-0000-4000-8000-000000000202',20,current_date+10);
select pg_temp.give('a9280000-0000-4000-8000-000000000404',(select id from fx where k='pet'),'a9280000-0000-4000-8000-000000000203',5,current_date+200);
select pg_temp.give('a9280000-0000-4000-8000-000000000405',(select id from fx where k='other'),'a9280000-0000-4000-8000-000000000201',1,current_date+364);
select public.record_patient_treatment('a9280000-0000-4000-8000-000000000406',jsonb_build_object('pet_id',(select id from fx where k='pet'),'historical',true,'kind','vaccine','product_name','Paper Record Vaccine','quantity',1,'dose','1 mL','route','SC','veterinarian','Outside Vet','administered_at',now()-interval '100 days','next_due_on',current_date-3,'source','Paper chart'));
select public.record_patient_treatment('a9280000-0000-4000-8000-000000000407',jsonb_build_object('pet_id',(select id from fx where k='pet'),'historical',true,'kind','medication','product_name','Not a vaccine','quantity',1,'dose','1 tab','route','PO','veterinarian','Outside Vet','administered_at',now()-interval '1 day','source','Paper chart'));

insert into data select 'initial',public.patient_vaccine_status_summary((select id from fx where k='pet'));
create function pg_temp.grp(p_k text,p_group text) returns jsonb language sql as $$select g from data,jsonb_array_elements(v->'groups') g where k=p_k and g->>'group_key'=p_group$$;
select is((select v->>'as_of' from data where k='initial'),((now() at time zone 'America/Denver')::date)::text,'Summary reports the practice-local date it was computed for');
select is((select jsonb_array_length(v->'groups') from data where k='initial'),5,'One row per group: rabies, two combination groups, profiled group and historical record');
select is(pg_temp.grp('initial','rabies')->>'due_on',(current_date+355)::text,'Without a reviewed plan, the latest administration supplies the due date');
select is(pg_temp.grp('initial','rabies')->>'due_source','practice_administration','Due date source is explicit');
select is(pg_temp.grp('initial','rabies')->>'last_record_id','a9280000-0000-4000-8000-000000000402','Latest administration wins over older records');
select is((pg_temp.grp('initial','rabies')->>'record_count')::integer,2,'Both uncorrected administrations counted');
select is(pg_temp.grp('initial','rabies')->>'group_name','Rabies group','Reviewed template names the group');
select is(pg_temp.grp('initial','dapp')->>'last_record_id','a9280000-0000-4000-8000-000000000403','Combination product counts toward first group');
select is(pg_temp.grp('initial','lepto')->>'last_record_id','a9280000-0000-4000-8000-000000000403','Combination product counts toward every listing group');
select is(pg_temp.grp('initial','bordetella')->>'group_source','catalog_profile','Catalog profile groups a product with no reviewed template');
select is(pg_temp.grp('initial','record:paper record vaccine')->>'due_source','historical_record','Historical entries keep their provenance');
select ok(pg_temp.grp('initial','inactive-group') is null,'Inactive templates do not group records');
select ok((select v::text not like '%Not a vaccine%' from data where k='initial'),'Medication records excluded');
select ok((select v::text not like '%a9280000-0000-4000-8000-000000000405%' from data where k='initial'),'Other patient records excluded');

-- A corrected record is excluded; the earlier administration becomes current.
select public.correct_patient_treatment(gen_random_uuid(),'a9280000-0000-4000-8000-000000000402','Synthetic entered in error',null);
select is(public.patient_vaccine_status_summary((select id from fx where k='pet'))#>>'{groups}' is not null,true,'Summary still returns after correction');
insert into data select 'corrected',public.patient_vaccine_status_summary((select id from fx where k='pet'));
select is(pg_temp.grp('corrected','rabies')->>'last_record_id','a9280000-0000-4000-8000-000000000401','Corrected administration excluded');
select is(pg_temp.grp('corrected','rabies')->>'due_on',(current_date-35)::text,'Earlier recorded due date shown after correction');

-- Reviewed plans: current plan wins, proposed plan never supplies a date, plan-only groups appear.
select public.save_patient_vaccine_due_plan('a9280000-0000-4000-8000-000000000501',(select id from fx where k='pet'),null,'a9280000-0000-4000-8000-000000000101',1,(select id from fx where k='rabies'),null,current_date-500,'Synthetic anchor',30,current_date+40,'current',false,'Synthetic reviewed override','Synthetic review');
select public.save_patient_vaccine_due_plan('a9280000-0000-4000-8000-000000000502',(select id from fx where k='pet'),null,'a9280000-0000-4000-8000-000000000102',1,(select id from fx where k='combo'),null,current_date-20,'Synthetic anchor',30,current_date+10,'proposed',false,null,'Synthetic review');
select public.save_patient_vaccine_due_plan('a9280000-0000-4000-8000-000000000503',(select id from fx where k='pet'),null,'a9280000-0000-4000-8000-000000000104',1,(select id from fx where k='plain'),null,current_date-3,'Synthetic outside anchor',30,current_date+27,'current',false,null,'Synthetic review');
insert into data select 'planned',public.patient_vaccine_status_summary((select id from fx where k='pet'));
select is(pg_temp.grp('planned','rabies')->>'due_on',(current_date+40)::text,'Current reviewed plan wins over recorded next due date');
select is(pg_temp.grp('planned','rabies')->>'due_source','reviewed_due_plan','Plan source shown');
select is(pg_temp.grp('planned','rabies')->'flags','["administration_after_plan_anchor"]'::jsonb,'Administration newer than plan anchor is flagged for review');
select is(pg_temp.grp('planned','rabies')->>'last_given_on',((now()-interval '400 days') at time zone 'America/Denver')::date::text,'Last given reflects the newest administration, not an older plan anchor');
select is(pg_temp.grp('planned','dapp')->>'due_on',(current_date+10)::text,'Proposed plan falls back to recorded next due date');
select is(pg_temp.grp('planned','dapp')->>'due_source','practice_administration','Fallback source shown for proposed plan');
select is(pg_temp.grp('planned','dapp')->'flags','["plan_awaiting_review"]'::jsonb,'Proposed plan flagged as awaiting review');
select is(pg_temp.grp('planned','plan-only')->>'last_given_source','due_plan_anchor','Plan-only group anchored on the reviewed plan');
select is(pg_temp.grp('planned','plan-only')->>'group_name','Plan-only group','Plan-only group named from reviewed template snapshot');
select is((pg_temp.grp('planned','plan-only')->>'record_count')::integer,0,'Plan-only group has no records');
select public.save_patient_vaccine_due_plan('a9280000-0000-4000-8000-000000000503',(select id from fx where k='pet'),1,'a9280000-0000-4000-8000-000000000104',1,(select id from fx where k='plain'),null,current_date-3,'Synthetic outside anchor',30,current_date+27,'retired',false,null,'Synthetic review');
select ok(pg_temp.grp('planned','plan-only') is not null and public.patient_vaccine_status_summary((select id from fx where k='pet'))::text not like '%plan-only%','Retired plans are omitted');
reset role;

-- Outside ezyVet reviewed history. The review workflow is covered by ezyvet_vaccination_review tests;
-- this synthetic row bypasses its provenance foreign keys only inside this rolled-back transaction.
set local session_replication_role=replica;
insert into public.ezyvet_imported_vaccinations(id,pet_id,client_id,animal_link_id,source_origin,source_site_uid,animal_external_id,vaccination_external_id,version,version_hash,interpretation_hash,snapshot_id,payload_hash,observed_head_version,original,consult,reviewed,product,reason,replaces_id,expected_predecessor_hash,approved_by)
select x.id,(select id from fx where k='pet'),(select id from fx where k='client'),gen_random_uuid(),'https://synthetic.invalid','site','77',x.ext,x.ver,repeat(x.h,64),repeat('0',64),gen_random_uuid(),repeat('0',64),1,'{}','{"external_id":"9"}',x.reviewed,x.product,'Synthetic review',x.replaces,case when x.replaces is null then null else repeat('a',64) end,'a9280000-0000-4000-8000-000000000001'
from (values
 ('a9280000-0000-4000-8000-000000000601'::uuid,'501',1,'a',jsonb_build_object('status','administered','administered_on',current_date-2,'administration_date_status','date','source_next_due_on',current_date+20,'next_date_status','date','outside_author',null),jsonb_build_object('id',(select id from fx where k='plain'),'version',1,'name','Synthetic ungrouped product','kind','vaccine'),null::uuid),
 ('a9280000-0000-4000-8000-000000000602'::uuid,'502',1,'b',jsonb_build_object('status','administered','administered_on',current_date-1,'administration_date_status','date','source_next_due_on',null,'next_date_status','unknown','outside_author',null),null::jsonb,null::uuid),
 ('a9280000-0000-4000-8000-000000000603'::uuid,'502',2,'c',jsonb_build_object('status','not_administered','administered_on',current_date-1,'administration_date_status','date','source_next_due_on',null,'next_date_status','unknown','outside_author',null),null::jsonb,'a9280000-0000-4000-8000-000000000602'::uuid),
 ('a9280000-0000-4000-8000-000000000604'::uuid,'503',1,'d',jsonb_build_object('status','administered','administered_on',null,'administration_date_status','unknown','source_next_due_on',null,'next_date_status','unknown','outside_author',null),null::jsonb,null::uuid)
) x(id,ext,ver,h,reviewed,product,replaces);
set local session_replication_role=origin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a9280000-0000-4000-8000-000000000002","role":"authenticated"}',true);
insert into data select 'outside',public.patient_vaccine_status_summary((select id from fx where k='pet'));
select is(pg_temp.grp('outside','plan-only')->>'due_source','outside_record','Reviewed outside record mapped to a grouped product supplies a due date with outside provenance');
select is(pg_temp.grp('outside','plan-only')->>'due_on',(current_date+20)::text,'Outside reviewed next date shown once the plan is retired');
select is(pg_temp.grp('outside','plan-only')->>'last_given_source','outside_record','Outside administration is the last given source');
select ok(pg_temp.grp('outside','plan-only')->'plan'='null'::jsonb,'Retired plan not attached');
select ok((select v::text not like '%Outside vaccination #502%' from data where k='outside'),'Superseded or not-administered outside versions excluded');
select ok((select v::text not like '%Outside vaccination #503%' from data where k='outside'),'Outside records without a reviewed date excluded');
select throws_ok($$select public.patient_vaccine_status_summary(gen_random_uuid())$$,'23514','Patient not found','Unknown patient rejected');
select set_config('request.jwt.claims','{"sub":"a9280000-0000-4000-8000-000000000009","role":"authenticated"}',true);
select throws_ok($$select public.patient_vaccine_status_summary((select id from fx where k='pet'))$$,'42501',null,'Non-staff cannot read vaccine status');
reset role;
set local role anon;
select throws_ok($$select public.patient_vaccine_status_summary(gen_random_uuid())$$,'42501',null,'Anonymous callers have no execute grant');
reset role;

-- Due-soon display window setting is validated when an administrator stores it.
select throws_ok($$insert into public.app_settings(key,value) values('vaccine_due_soon_days','0')$$,'23514',null,'Zero-day window rejected');
select throws_ok($$insert into public.app_settings(key,value) values('vaccine_due_soon_days','366')$$,'23514',null,'Window above one year rejected');
select throws_ok($$insert into public.app_settings(key,value) values('vaccine_due_soon_days','thirty')$$,'23514',null,'Non-numeric window rejected');
select lives_ok($$insert into public.app_settings(key,value) values('vaccine_due_soon_days','45')$$,'Valid window accepted');
select lives_ok($$insert into public.app_settings(key,value) values('vaccine_due_soon_unrelated','anything') on conflict do nothing$$,'Other settings unaffected');
select * from finish();
rollback;
