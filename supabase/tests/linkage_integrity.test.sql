begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,raw_user_meta_data) values ('98000000-0000-4000-8000-000000000001','linkage-staff@example.test','{"first_name":"Synthetic","last_name":"Linkage"}');
update public.profiles set is_active=true,full_name='Synthetic Linkage' where id='98000000-0000-4000-8000-000000000001';
insert into public.user_roles(user_id,role) values ('98000000-0000-4000-8000-000000000001','ADMIN'),('98000000-0000-4000-8000-000000000001','STAFF');

create temp table fx(kind text primary key,id uuid);
grant all on fx to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fx select 'client',id from public.save_client(auth.uid(),null,null,'Linkage','Household',null,null,'EMAIL','1 Synthetic Street',null);
insert into fx select 'other',id from public.save_client(auth.uid(),null,null,'Other','Household',null,null,'EMAIL','2 Synthetic Street',null);
insert into fx select 'pet',id from public.save_patient(null,(select id from fx where kind='client'),null,'Linkage Patient','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
insert into fx select 'bare',id from public.save_patient(null,(select id from fx where kind='client'),null,'No History','Cat',null,null,'unknown',null,'unknown','unknown',null,null,null);
reset role;

-- Legacy history rows (written as the table owner; app roles can no longer write them).
insert into public.pet_vaccinations(pet_id,vaccine_name,administered_at) values ((select id from fx where kind='pet'),'Rabies',now());
with t as (insert into public.consent_form_templates(name) values ('Synthetic consent') returning id) insert into fx select 'template',id from t;
insert into public.consent_submissions(template_id,client_id,pet_id,signed_at) values ((select id from fx where kind='template'),(select id from fx where kind='client'),(select id from fx where kind='pet'),now());

-- A1: patients are archived, never deleted -- even by an admin, even with no history.
select throws_ok($$delete from public.pets where id=(select id from fx where kind='pet')$$,'23503',null,'Deleting a patient with vaccination history fails');
select throws_ok($$delete from public.pets where id=(select id from fx where kind='bare')$$,'23503',null,'Deleting a patient with no history also fails (archive instead)');
select is((select count(*)::int from public.pet_vaccinations where pet_id=(select id from fx where kind='pet')),1,'Vaccination history intact');
select is((select confdeltype::text from pg_constraint where conname='pet_vaccinations_pet_id_fkey'),'r','pet_vaccinations.pet_id is RESTRICT beneath the guard');
select ok(not has_table_privilege('authenticated','public.pets','DELETE'),'Browser role has no patient delete grant');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$delete from public.pets where id=(select id from fx where kind='bare')$$,'42501',null,'Admin cannot delete a patient through the API');
reset role;

-- A3/A4: signed consent outlives its template and household.
select throws_ok($$delete from public.consent_form_templates where id=(select id from fx where kind='template')$$,'23503',null,'Deleting a consent template with submissions fails');
select is((select count(*)::int from public.consent_submissions where template_id=(select id from fx where kind='template')),1,'Signed consent intact');
select throws_ok($$delete from public.clients where id=(select id from fx where kind='client')$$,'23503',null,'Deleting a household with history fails');

-- A11: a legacy row's patient must belong to its household.
select throws_ok($$insert into public.lab_results(client_id,pet_id,lab_provider,result_type) values ((select id from fx where kind='other'),(select id from fx where kind='pet'),'Synthetic','CBC')$$,'23503',null,'Mismatched patient/household lab result is refused');
select lives_ok($$insert into public.lab_results(client_id,pet_id,lab_provider,result_type) values ((select id from fx where kind='client'),(select id from fx where kind='pet'),'Synthetic','CBC')$$,'Matching patient/household lab result is accepted');
select lives_ok($$insert into public.lab_results(client_id,pet_id,lab_provider,result_type) values ((select id from fx where kind='other'),null,'Synthetic','Household panel')$$,'Household-only row (null patient) is not checked');
select throws_ok($$insert into public.consent_submissions(template_id,client_id,pet_id) values ((select id from fx where kind='template'),(select id from fx where kind='other'),(select id from fx where kind='pet'))$$,'23503',null,'Mismatched patient/household consent is refused');
select is((select count(*)::int from pg_constraint where conname like '%\_pet_household_fkey' and not convalidated),5,'Five composite household FKs, NOT VALID until the owner validates');

-- A18: vocabulary checks apply to new rows.
select throws_ok($$insert into public.lab_results(client_id,lab_provider,result_type,status) values ((select id from fx where kind='client'),'Synthetic','CBC','pending')$$,'23514',null,'Unknown lab status casing is refused');

-- A17: legacy clinical tables are read-only for app roles.
select ok(not has_table_privilege('authenticated','public.pet_vaccinations','INSERT'),'No browser vaccination insert');
select ok(not has_table_privilege('authenticated','public.pet_vaccinations','UPDATE'),'No browser vaccination update');
select ok(not has_table_privilege('authenticated','public.lab_results','INSERT'),'No browser lab insert');
select ok(not has_table_privilege('authenticated','public.lab_results','DELETE'),'No browser lab delete');
select ok(has_table_privilege('authenticated','public.lab_results','SELECT'),'Staff can still read legacy labs');

-- A5: staff are deactivated, not deleted.
select throws_ok($$delete from auth.users where id='98000000-0000-4000-8000-000000000001'$$,'23503',null,'Deleting an auth user with a staff profile fails');
select ok(not has_table_privilege('authenticated','public.profiles','DELETE'),'Browser role has no profile delete grant');

-- A8 / B10.
select ok(to_regprocedure('public.delete_conversation_cascade(uuid)') is null,'Dead cascade delete function removed');
select ok(not has_function_privilege('authenticated',to_regprocedure('public.enqueue_staff_outbound_message(uuid,uuid,channel_type,text,text,text,timestamp with time zone,text)'),'EXECUTE'),'enqueue_staff_outbound_message not executable by authenticated');
select ok(not has_function_privilege('anon',to_regprocedure('public.enqueue_staff_outbound_message(uuid,uuid,channel_type,text,text,text,timestamp with time zone,text)'),'EXECUTE'),'enqueue_staff_outbound_message not executable by anon');

-- A10.
select is((select confdeltype::text from pg_constraint where conname='appointments_updated_by_fkey'),'n','appointments.updated_by is ON DELETE SET NULL');

select * from finish();
rollback;
