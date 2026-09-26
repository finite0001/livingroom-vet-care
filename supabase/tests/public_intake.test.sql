begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(
  not has_table_privilege('anon', 'public.contact_submissions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.contact_submissions', 'INSERT')
  and not has_table_privilege('service_role', 'public.contact_submissions', 'INSERT'),
  'Direct table inserts are denied for public and service clients'
);
select ok(
  not has_any_column_privilege('anon', 'public.contact_submissions', 'INSERT')
  and not has_any_column_privilege('authenticated', 'public.contact_submissions', 'INSERT')
  and not has_any_column_privilege('service_role', 'public.contact_submissions', 'INSERT'),
  'No column-level insert grant bypasses verified intake'
);
set local role anon;
select throws_ok($$insert into contact_submissions(name,email,subject,message) values('Name','email@example.test','Subject','Message')$$,'42501',null,'Direct anonymous insert bypass closed');
select throws_ok($$select accept_contact_intake(gen_random_uuid(),repeat('a',64),repeat('b',64),'{}')$$,'42501',null,'Anonymous cannot call trusted accept RPC');
set local role authenticated;
select throws_ok($$insert into contact_submissions(name,email,subject,message) values('Name','email@example.test','Subject','Message')$$,'42501',null,'Authenticated callers cannot bypass challenge');
select throws_ok($$select * from contact_intake_requests$$,'42501',null,'Receipt capabilities not exposed to staff');
set local role service_role;
select throws_ok($$select accept_contact_intake(gen_random_uuid(),repeat('a',64),repeat('b',64),'{"name":{},"email":"visitor@example.test","phone":null,"subject":"Intake fixture","message":"Request"}')$$,'23514',null,'Database rejects non-string fields');
select is((select consume_contact_intake_budget()),true,'Global budget starts available');
select is((accept_contact_intake('98000000-0000-4000-8000-000000000001',repeat('a',64),repeat('b',64),'{"name":"Visitor","email":"visitor@example.test","phone":null,"subject":"Intake fixture","message":"Request"}')->>'received'),'true','Verified server boundary can accept');
select is((accept_contact_intake('98000000-0000-4000-8000-000000000001',repeat('a',64),repeat('b',64),'{"name":"Visitor","email":"visitor@example.test","phone":null,"subject":"Intake fixture","message":"Request"}')->>'received'),'true','Exact replay returns receipt');
select throws_ok($$select accept_contact_intake('98000000-0000-4000-8000-000000000001',repeat('a',64),repeat('b',64),'{"name":"Visitor","email":"visitor@example.test","phone":null,"subject":"Changed","message":"Request"}')$$,'23505',null,'Changed payload cannot reuse ID');
select is((contact_intake_receipt('98000000-0000-4000-8000-000000000001',repeat('a',64))->>'received'),'true','Lost response receipt recovered');
select is((contact_intake_receipt('98000000-0000-4000-8000-000000000001',repeat('c',64))->>'received'),'false','Wrong capability does not expose receipt');
select accept_contact_intake(gen_random_uuid(),repeat('a',64),repeat('b',64),'{"name":"Visitor","email":"visitor@example.test","phone":null,"subject":"Intake fixture","message":"Request"}') from generate_series(1,4);
select is((accept_contact_intake(gen_random_uuid(),repeat('a',64),repeat('b',64),'{"name":"Visitor","email":"visitor@example.test","phone":null,"subject":"Intake fixture","message":"Request"}')->>'limited'),'true','Claimed-email hourly budget enforced');
reset role;
select is((select count(*) from contact_submissions where subject='Intake fixture'),5::bigint,'Replay and limited requests never duplicate original');
select is((select count(*) from website_inquiry_triage where inquiry_id in(select id from contact_submissions where subject='Intake fixture')),5::bigint,'Verified submissions enter staff triage atomically');
update contact_intake_budgets set attempts=120 where bucket='global-minute' and window_start=date_trunc('minute',now());
set local role service_role;
select is(consume_contact_intake_budget(),false,'Global minute budget enforced');
select throws_ok($$insert into contact_submissions(name,email,subject,message) values('Name','email@example.test','Subject','Message')$$,'42501',null,'Service clients also use controlled RPC');
reset role;
select throws_ok($$update contact_intake_requests set payload='{}'$$,'23514',null,'Accepted request intent immutable');
select * from finish();
rollback;
