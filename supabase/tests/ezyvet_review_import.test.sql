begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temp table review_fixture_ids(kind text primary key,id uuid);
grant all on review_fixture_ids to authenticated;
insert into auth.users(id,email,raw_user_meta_data) values ('e4000000-0000-4000-8000-000000000001','import-review-admin@example.test','{"first_name":"Review","last_name":"Admin"}'),('e4000000-0000-4000-8000-000000000002','import-review-staff@example.test','{"first_name":"Review","last_name":"Staff"}');
update public.profiles set is_active = true where id in ('e4000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000002');
insert into public.user_roles (user_id, role) values ('e4000000-0000-4000-8000-000000000001','STAFF'),('e4000000-0000-4000-8000-000000000002','STAFF');

insert into public.user_roles(user_id,role) values('e4000000-0000-4000-8000-000000000001','ADMIN');
insert into public.ezyvet_import_runs(id,source_origin,source_site_uid,resource,requested_by) values('e4100000-0000-4000-8000-000000000001','https://api.trial.ezyvet.com','review-site','contact','e4000000-0000-4000-8000-000000000001');
insert into public.ezyvet_import_snapshots(id,source_origin,source_site_uid,resource,external_id,payload,payload_hash,first_seen_by) values
('e4200000-0000-4000-8000-000000000001','https://api.trial.ezyvet.com','review-site','contact','1','{"id":1,"first_name":"Original","last_name":"Source"}','contact-one','e4000000-0000-4000-8000-000000000001'),
('e4200000-0000-4000-8000-000000000002','https://api.trial.ezyvet.com','review-site','contact','2','{"id":2}','contact-two','e4000000-0000-4000-8000-000000000001'),
('e4200000-0000-4000-8000-000000000003','https://api.trial.ezyvet.com','review-site','animal','3','{"id":3,"contact_id":1}','animal-three','e4000000-0000-4000-8000-000000000001'),
('e4200000-0000-4000-8000-000000000004','https://api.trial.ezyvet.com','review-site','animal','4','{"id":4,"contact_id":99}','animal-four','e4000000-0000-4000-8000-000000000001'),
('e4200000-0000-4000-8000-000000000005','https://api.trial.ezyvet.com','other-site','animal','5','{"id":5,"contact_id":1}','animal-five','e4000000-0000-4000-8000-000000000001'),
('e4200000-0000-4000-8000-000000000006','https://api.trial.ezyvet.com','review-site','animal','6','{"id":6,"contact_id":1}','animal-six','e4000000-0000-4000-8000-000000000001');
insert into public.ezyvet_import_pages(run_id,page,item_count) values('e4100000-0000-4000-8000-000000000001',1,6);
insert into public.ezyvet_import_page_items(run_id,page,snapshot_id) select 'e4100000-0000-4000-8000-000000000001',1,id from public.ezyvet_import_snapshots;
select is((select count(*) from public.ezyvet_identity_heads),6::bigint,'Page observations establish current source heads');
select ok(not has_table_privilege('authenticated','public.ezyvet_record_links','UPDATE'),'Approval mappings cannot be overwritten');
select ok(not has_table_privilege('authenticated','public.ezyvet_record_links','DELETE'),'Approval provenance cannot be removed');
select ok(not has_function_privilege('service_role','public.promote_ezyvet_identity(uuid,uuid,text,integer,text,uuid,uuid,integer,jsonb,text)','EXECUTE'),'Background service cannot approve clinical imports');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e4000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.promote_ezyvet_identity(gen_random_uuid(),'e4200000-0000-4000-8000-000000000001','contact-one',1,'create',null,null,null,'{"first_name":"Reviewed","last_name":"Family"}','Reviewed')$$,'42501','Active administrator required','Staff approval blocked');
select set_config('request.jwt.claims','{"sub":"e4000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.promote_ezyvet_identity(gen_random_uuid(),'e4200000-0000-4000-8000-000000000001','wrong-hash',1,'create',null,null,null,'{}','Reviewed')$$,'40001','Source changed; reload and review again','Mismatched snapshot hash blocked');
select throws_ok($$select public.promote_ezyvet_identity(gen_random_uuid(),'e4200000-0000-4000-8000-000000000001','contact-one',0,'create',null,null,null,'{}','Reviewed')$$,'40001','Source changed; reload and review again','Stale observation version blocked');
select throws_ok($$select public.promote_ezyvet_identity(gen_random_uuid(),'e4200000-0000-4000-8000-000000000001','contact-one',1,'create',null,null,null,'{"first_name":"Reviewed","last_name":"Family","role":"ADMIN"}','Reviewed')$$,'23514','Unsupported household fields','Unsupported values cannot inject roles');
select lives_ok($$select public.promote_ezyvet_identity('e4300000-0000-4000-8000-000000000001','e4200000-0000-4000-8000-000000000001','contact-one',1,'create',null,null,null,'{"first_name":"Reviewed","last_name":"Family"}','Reviewed source and duplicates')$$,'Create reviewed household');
select is((select full_name from public.clients where id=(select client_id from public.ezyvet_record_links where external_id='1')),'Reviewed Family','Staff corrected values used');
select lives_ok($$select public.promote_ezyvet_identity('e4300000-0000-4000-8000-000000000001','e4200000-0000-4000-8000-000000000001','contact-one',1,'create',null,null,null,'{"first_name":"Reviewed","last_name":"Family"}','Reviewed source and duplicates')$$,'Retry same approval is idempotent');
select is((select count(*) from public.ezyvet_record_links),1::bigint,'Retry does not duplicate mapping or household');
select throws_ok($$select public.promote_ezyvet_identity('e4300000-0000-4000-8000-000000000001','e4200000-0000-4000-8000-000000000001','contact-one',1,'create',null,null,null,'{"first_name":"Changed","last_name":"Family"}','Reviewed source and duplicates')$$,'42501','Approval request identity mismatch','Retry UUID cannot approve changed values');
select throws_ok($$select public.promote_ezyvet_identity(gen_random_uuid(),'e4200000-0000-4000-8000-000000000001','contact-one',1,'create',null,null,null,'{"first_name":"New","last_name":"Duplicate"}','Reviewed')$$,'23505','Source identity already linked; local record will not be overwritten','Second request cannot recreate mapped identity');
select throws_ok($$select public.promote_ezyvet_identity(gen_random_uuid(),'e4200000-0000-4000-8000-000000000002','contact-two',1,'link',(select client_id from public.ezyvet_record_links where external_id='1'),null,0,'{}','Same household')$$,'40001','Local record changed; reload before linking','Stale local version blocked');
select throws_ok($$select public.promote_ezyvet_identity(gen_random_uuid(),'e4200000-0000-4000-8000-000000000002','contact-two',1,'link',(select client_id from public.ezyvet_record_links where external_id='1'),null,1,'{"first_name":"Overwrite"}','Same household')$$,'23514','Linking cannot change local values','Link cannot mutate fields');
select lives_ok($$select public.promote_ezyvet_identity(gen_random_uuid(),'e4200000-0000-4000-8000-000000000002','contact-two',1,'link',(select client_id from public.ezyvet_record_links where external_id='1'),null,1,'{}','Same household')$$,'Reviewed source duplicate links existing household');
select is((select full_name from public.clients where id=(select client_id from public.ezyvet_record_links where external_id='1')),'Reviewed Family','Link preserves local fields');
select throws_ok($$select public.promote_ezyvet_identity(gen_random_uuid(),'e4200000-0000-4000-8000-000000000004','animal-four',1,'create',null,null,null,'{"name":"Patient","species":"Dog"}','Reviewed')$$,'23514','Review and link the source household first','Unresolved household prevents patient import');
select throws_ok($$select public.promote_ezyvet_identity(gen_random_uuid(),'e4200000-0000-4000-8000-000000000005','animal-five',1,'create',(select client_id from public.ezyvet_record_links where external_id='1'),null,null,'{"name":"Patient","species":"Dog"}','Reviewed')$$,'23514','Review and link the source household first','Identical contact ID from other source site cannot satisfy owner');
select throws_ok($$select public.promote_ezyvet_identity(gen_random_uuid(),'e4200000-0000-4000-8000-000000000003','animal-three',1,'create',gen_random_uuid(),null,null,'{"name":"Patient","species":"Dog"}','Reviewed')$$,'23514','Animal household does not match source household link','Arbitrary household cannot be injected');
select lives_ok($$select public.promote_ezyvet_identity('e4300000-0000-4000-8000-000000000003','e4200000-0000-4000-8000-000000000003','animal-three',1,'create',(select client_id from public.ezyvet_record_links where external_id='1'),null,null,'{"name":"Reviewed Juniper","species":"Dog","microchip_id":"0000123"}','Reviewed identity and owner')$$,'Create reviewed patient in linked household');
select is((select name from public.pets where id=(select pet_id from public.ezyvet_record_links where external_id='3')),'Reviewed Juniper','Patient corrected name saved');
select is((select microchip_id from public.pets where id=(select pet_id from public.ezyvet_record_links where external_id='3')),'0000123','Microchip leading zeros preserved');
insert into review_fixture_ids select 'other-client',id from public.save_client(auth.uid(),null,null,'Other','Family',null,null,'EMAIL',null,null);
insert into review_fixture_ids select 'other-patient',id from public.save_patient(null,(select id from review_fixture_ids where kind='other-client'),null,'Other Patient','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
select throws_ok($$select public.promote_ezyvet_identity(gen_random_uuid(),'e4200000-0000-4000-8000-000000000006','animal-six',1,'link',(select client_id from public.ezyvet_record_links where external_id='1'),(select id from review_fixture_ids where kind='other-patient'),1,'{}','Wrong owner')$$,'23514','Existing patient ownership cannot change through import','Existing patient in another household cannot be moved');
select lives_ok($$select public.promote_ezyvet_identity(gen_random_uuid(),'e4200000-0000-4000-8000-000000000006','animal-six',1,'link',(select client_id from public.ezyvet_record_links where external_id='1'),(select pet_id from public.ezyvet_record_links where external_id='3'),1,'{}','Reviewed duplicate patient')$$,'Link same-household existing patient');
select is((select count(*) from public.pets where client_id=(select client_id from public.ezyvet_record_links where external_id='1')),1::bigint,'Patient link does not duplicate existing patient');
select is((select count(*) from public.ezyvet_record_links where approved_by=auth.uid()),4::bigint,'Every approval records signed-in actor');
reset role;
-- Source re-observation changes the head but cannot alter any mapped local value.
insert into public.ezyvet_import_snapshots(id,source_origin,source_site_uid,resource,external_id,payload,payload_hash,first_seen_by) values('e4200000-0000-4000-8000-000000000007','https://api.trial.ezyvet.com','review-site','contact','1','{"id":1,"first_name":"Later"}','contact-later','e4000000-0000-4000-8000-000000000001');
insert into public.ezyvet_import_pages(run_id,page,item_count) values('e4100000-0000-4000-8000-000000000001',2,1);
insert into public.ezyvet_import_page_items values('e4100000-0000-4000-8000-000000000001',2,'e4200000-0000-4000-8000-000000000007');
select is((select version from public.ezyvet_identity_heads where source_site_uid='review-site' and resource='contact' and external_id='1'),2,'Changed observation increments head version');
select is((select full_name from public.clients where id=(select client_id from public.ezyvet_record_links where resource='contact' and external_id='1')),'Reviewed Family','Later source import does not overwrite local name');
set local role authenticated;
select throws_ok($$select public.promote_ezyvet_identity(gen_random_uuid(),'e4200000-0000-4000-8000-000000000001','contact-one',1,'create',null,null,null,'{}','Stale')$$,'40001','Source changed; reload and review again','Old snapshot rejected after newer observation');
select throws_ok($$select public.promote_ezyvet_identity(gen_random_uuid(),'e4200000-0000-4000-8000-000000000007','contact-later',2,'create',null,null,null,'{}','Fresh source')$$,'23505','Source identity already linked; local record will not be overwritten','Latest snapshot also cannot overwrite mapped record');
select * from finish();
rollback;
