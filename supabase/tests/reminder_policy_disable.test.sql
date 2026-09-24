begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
('b4000000-0000-4000-8000-000000000001','policy-admin@example.test','{"first_name":"Policy","last_name":"Admin"}'),
('b4000000-0000-4000-8000-000000000002','policy-staff@example.test','{"first_name":"Policy","last_name":"Staff"}');
update public.profiles set is_active = true where id in ('b4000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000002');
insert into public.user_roles (user_id, role) values ('b4000000-0000-4000-8000-000000000001','STAFF'),('b4000000-0000-4000-8000-000000000002','STAFF');

insert into public.user_roles(user_id,role) values('b4000000-0000-4000-8000-000000000001','ADMIN') on conflict do nothing;
select ok(not has_function_privilege('anon','public.disable_reminder_automation_policy(uuid,integer,text)','EXECUTE'),'Anonymous cannot disable policies');
select ok(not has_function_privilege('service_role','public.disable_reminder_automation_policy(uuid,integer,text)','EXECUTE'),'Provider service cannot impersonate policy reviewer');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b4000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.save_care_message_template('b4100000-0000-4000-8000-000000000001',null,'Synthetic reviewed wording','email',0,'{{patient_name}}: {{care_name}} due {{due_date}}',true,'Synthetic clinician wording review');
select public.save_reminder_automation_policy('b4200000-0000-4000-8000-000000000001',null,'lab','EMAIL','b4100000-0000-4000-8000-000000000001',1,'Care due reminder',true,'Synthetic delivery review');
select public.save_care_message_template('b4100000-0000-4000-8000-000000000001',1,'Synthetic reviewed wording','email',0,'{{patient_name}}: {{care_name}} due {{due_date}}',false,'Retired pending revision');
select throws_ok($$select public.save_reminder_automation_policy('b4200000-0000-4000-8000-000000000001',1,'lab','EMAIL','b4100000-0000-4000-8000-000000000001',1,'Care due reminder',false,'Stop delivery')$$,'23514','Select current reviewed wording for the policy channel','Ordinary save still requires current active wording');
select lives_ok($$select public.disable_reminder_automation_policy('b4200000-0000-4000-8000-000000000001',1,'Stop delivery pending revision')$$,'Administrator can stop policy even with retired wording');
select is((select enabled from public.reminder_automation_policies where id='b4200000-0000-4000-8000-000000000001'),false,'Policy is disabled');
select is((select version from public.reminder_automation_policies where id='b4200000-0000-4000-8000-000000000001'),2,'Disabling creates one reviewed version');
select is((select message_template_version from public.reminder_automation_policies where id='b4200000-0000-4000-8000-000000000001'),1,'Previously approved wording version remains intact');
select is((select approved_by from public.reminder_automation_policies where id='b4200000-0000-4000-8000-000000000001'),'b4000000-0000-4000-8000-000000000001'::uuid,'Reviewer is the authenticated administrator');
select lives_ok($$select public.disable_reminder_automation_policy('b4200000-0000-4000-8000-000000000001',1,'Stop delivery pending revision')$$,'Lost-response retry returns same review');
select is((select count(*) from public.reminder_automation_policy_history where policy_id='b4200000-0000-4000-8000-000000000001'),2::bigint,'Retry does not duplicate history');
select throws_ok($$select public.disable_reminder_automation_policy('b4200000-0000-4000-8000-000000000001',1,'Changed stale review')$$,'40001','Automation policy version conflict','Changed stale request cannot overwrite review');
select throws_ok($$select public.disable_reminder_automation_policy('b4200000-0000-4000-8000-000000000001',2,' ')$$,'23514','Policy version and review reason are required','Review rationale cannot be blank');
select throws_ok($$select public.disable_reminder_automation_policy('b4200000-0000-4000-8000-000000000099',1,'Unavailable')$$,'23514','Policy unavailable','Unknown policy rejected');
select set_config('request.jwt.claims','{"sub":"b4000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.disable_reminder_automation_policy('b4200000-0000-4000-8000-000000000001',2,'Staff request')$$,'42501','Active administrator required for reviewed settings','Nonadministrator cannot change delivery policy');
select * from finish();
rollback;
