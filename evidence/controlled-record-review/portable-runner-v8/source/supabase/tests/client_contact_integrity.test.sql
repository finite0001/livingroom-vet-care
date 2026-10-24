begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
 ('fa400000-0000-4000-8000-000000000001','contact-rule-staff@example.test','{}'),
 ('fa400000-0000-4000-8000-000000000002','contact-rule-admin@example.test','{}');
update public.profiles set is_active=true where id in ('fa400000-0000-4000-8000-000000000001','fa400000-0000-4000-8000-000000000002');
insert into public.user_roles(user_id,role) values
 ('fa400000-0000-4000-8000-000000000001','STAFF'),
 ('fa400000-0000-4000-8000-000000000002','ADMIN') on conflict do nothing;
create temp table contact_ids(kind text primary key,id uuid);
grant all on contact_ids to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa400000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select save_client(auth.uid(),null,null,'Missing','Phone',null,'contact@example.test','EMAIL',null,null)$$,'23514','A valid phone number and email are both required for a client','RPC requires phone');
select throws_ok($$select save_client(auth.uid(),null,null,'Missing','Email','+13035558801',null,'SMS',null,null)$$,'23514','A valid phone number and email are both required for a client','RPC requires email regardless of preferred channel');
select throws_ok($$select save_client(auth.uid(),null,null,'Invalid','Phone','unknown','contact@example.test','VOICE',null,null)$$,'23514','A valid phone number and email are both required for a client','VOICE preference has no override');
select throws_ok($$select save_client(auth.uid(),null,null,'Invalid','Email','+13035558801','.contact@example.test','EMAIL',null,null)$$,'23514','A valid phone number and email are both required for a client','Malformed email is rejected');
select throws_ok($$insert into clients(first_name,last_name,full_name,primary_phone) values('Direct','Incomplete','Direct Incomplete','+13035558802')$$,'23514','A valid phone number and email are both required for a client','Direct staff insert cannot bypass contacts');
insert into contact_ids select 'client',id from save_client(auth.uid(),null,null,'Valid','Client',' +1 (303) 555-8801 ',' CONTACT@example.test ','EMAIL','1 Synthetic Street',null);
select is((select primary_phone from clients where id=(select id from contact_ids where kind='client')),'+13035558801','Phone is normalized with explicit country code');
select is((select primary_email from clients where id=(select id from contact_ids where kind='client')),'contact@example.test','Email is normalized');
select is((select count(*) from sms_consent where client_id=(select id from contact_ids where kind='client')),0::bigint,'Contact presence does not record SMS consent');
select throws_ok($$update clients set primary_email=null where id=(select id from contact_ids where kind='client')$$,'23514','A valid phone number and email are both required for a client','Direct update cannot remove required email');
select throws_ok($$update clients set primary_phone='  ' where id=(select id from contact_ids where kind='client')$$,'23514','A valid phone number and email are both required for a client','Whitespace cannot satisfy phone requirement');
select throws_ok($$insert into pets(client_id,name,species) values('fa999999-0000-4000-8000-000000000001','Orphan','Dog')$$,'23514','Save an existing client with a valid phone number and email before adding a patient','Direct patient insert requires an existing complete client');
select throws_ok($$select save_patient(null,null,null,'Orphan','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null)$$,'23514','Save an existing client with a valid phone number and email before adding a patient','Patient RPC requires an existing client');
insert into contact_ids select 'first-pet',id from save_patient(null,(select id from contact_ids where kind='client'),null,'First','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
insert into contact_ids select 'second-pet',id from save_patient(null,(select id from contact_ids where kind='client'),null,'Second','Cat',null,null,'unknown',null,'unknown','unknown',null,null,null);
select is((select count(*) from pets where client_id=(select id from contact_ids where kind='client')),2::bigint,'One complete client can have two patients');
select throws_ok($$select save_client(auth.uid(),(select id from contact_ids where kind='client'),0,'Stale','Client','+13035558801','contact@example.test','EMAIL',null,null)$$,'PT409','Record changed or no longer exists; reload before saving','Version conflicts remain nonretryable');
select set_config('request.jwt.claims','{"sub":"fa400000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select save_client(auth.uid(),null,null,'Admin','Incomplete',null,null,'EMAIL',null,null)$$,'23514','A valid phone number and email are both required for a client','Administrator has no contact override');
reset role;
select is((select convalidated from pg_constraint where conrelid='public.clients'::regclass and conname='clients_required_contacts_check'),false,'Constraint does not silently scan or rewrite legacy contacts');
select throws_ok($$insert into clients(first_name,last_name,full_name,primary_email) values('Privileged','Incomplete','Privileged Incomplete','privileged@example.test')$$,'23514','A valid phone number and email are both required for a client','Privileged writes still require contacts');
set local role anon;
select throws_ok($$select client_contacts_complete(null,null)$$,'42501',null,'Anonymous helper execution is not exposed');
reset role;
select * from finish();
rollback;
