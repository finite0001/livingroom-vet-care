begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(has_function_privilege('authenticated','public.read_invoice_reminder_practice(uuid)','EXECUTE')
 and not has_function_privilege('anon','public.read_invoice_reminder_practice(uuid)','EXECUTE')
 and not has_function_privilege('service_role','public.read_invoice_reminder_practice(uuid)','EXECUTE'),
 'Practice reminder read is granted only to authenticated callers; ADMIN checked inside');
select ok(not has_function_privilege('anon','public.invoice_reminder_lock()','EXECUTE')
 and not has_function_privilege('authenticated','public.invoice_reminder_lock()','EXECUTE')
 and not has_function_privilege('service_role','public.invoice_reminder_lock()','EXECUTE'),
 'Reminder lock remains owner-only after additive correction');
select ok(not prosecdef and proconfig=array['search_path=public'],
 'Reminder lock preserves invoker rights and pinned search path')
 from pg_proc where oid='public.invoice_reminder_lock()'::regprocedure;
select ok(position('public.care_eligibility_lock()' in prosrc)>0
 and position('public.care_eligibility_lock()' in prosrc)<position('pg_advisory_xact_lock(80261015)' in prosrc)
 and position('transaction_isolation' in prosrc)<position('public.care_eligibility_lock()' in prosrc),
 'READ COMMITTED check precedes care gate, then reminder gate')
 from pg_proc where oid='public.invoice_reminder_lock()'::regprocedure;
select ok(position('public.invoice_reminder_lock()' in prosrc)<position('from billing_invoices' in prosrc)
 and position('from billing_invoices' in prosrc)<position('from communication_outbox' in prosrc)
 and position('from communication_outbox' in prosrc)<position('public.start_communication_attempt_before_invoice_reminders' in prosrc),
 'Final attempt retains reminder gate, invoice, outbox, predecessor ordering')
 from pg_proc where oid='public.start_communication_attempt(uuid,uuid,jsonb)'::regprocedure;
create temp table ir_fx(k text primary key,id uuid,v jsonb);
grant all on ir_fx to authenticated,service_role;
insert into ir_fx(k,id)select k,gen_random_uuid()from unnest(array['admin','staff','admin_session','staff_session','policy','invoice','invoice2','invoice3','invoice4','terms','run'])k;
create function pg_temp.ir_id(key text)returns uuid language sql as $$select id from ir_fx where k=$1$$;
insert into auth.users(id,email,raw_user_meta_data)select id,'invoice-reminder-'||id||'@example.test','{}'from ir_fx where k in('admin','staff');
update profiles set is_active=true where id in(pg_temp.ir_id('admin'),pg_temp.ir_id('staff'));
insert into user_roles(user_id,role)values(pg_temp.ir_id('admin'),'ADMIN'),(pg_temp.ir_id('staff'),'STAFF')on conflict do nothing;
insert into auth.sessions(id,user_id,created_at,updated_at)values(pg_temp.ir_id('admin_session'),pg_temp.ir_id('admin'),now(),now()),(pg_temp.ir_id('staff_session'),pg_temp.ir_id('staff'),now(),now());
insert into ir_fx(k,v)values('definition','{"enabled":true,"default_due_days":0,"offset_days":[7,14,30],"email_subject":"Invoice {{invoice_reference}} reminder","email_body":"Unpaid ${{amount_due}} due {{due_date}}. Contact {{practice_contact}}.","sms_body":"Unpaid ${{amount_due}}. Contact {{practice_contact}}.","practice_contact":"admin@thelivingroom.vet"}');
select ok(relrowsecurity and not has_table_privilege('authenticated',oid,'SELECT')and not has_table_privilege('service_role',oid,'INSERT'),relname||' remains private')from pg_class where relnamespace='public'::regnamespace and relname in('invoice_reminder_policies','invoice_reminder_terms','invoice_reminder_jobs','invoice_reminder_actions','invoice_reminder_runs');
select ok(not has_function_privilege('anon',oid,'EXECUTE')and not has_function_privilege('authenticated',oid,'EXECUTE')and not has_function_privilege('service_role',oid,'EXECUTE'),proname||' owner only')from pg_proc where pronamespace='public'::regnamespace and proname in('invoice_reminder_actor','invoice_reminder_validate_policy','invoice_reminder_render','invoice_reminder_context','scheduler_dispatch_invoice_reminders','start_communication_attempt_before_invoice_reminders','daily_communication_rows_before_invoice_reminders');
select throws_ok($$select invoice_reminder_validate_policy((select v from ir_fx where k='definition')||'{"offset_days":[7,7]}')$$,'23514',null,'Duplicate cadence denied');
select throws_ok($$select invoice_reminder_validate_policy((select v from ir_fx where k='definition')||'{"email_body":"{{unknown}}"}')$$,'23514',null,'Unknown template token denied');
select is(invoice_reminder_render('Contact {{practice_contact}} / {{amount_due}}',pg_temp.ir_id('invoice'),101,current_date,'x{{amount_due}}'),'Contact x{{amount_due}} / 1.01','Single-pass rendering cannot interpret replacement text');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ir_id('staff'),'session_id',pg_temp.ir_id('staff_session'))::text,true);
set local role authenticated;
select throws_ok($$select read_invoice_reminder_practice(pg_temp.ir_id('staff'))$$,'42501',null,'Ordinary staff cannot read practice reminder configuration');
select throws_ok($$select save_invoice_reminder_policy(pg_temp.ir_id('staff'),gen_random_uuid(),0,(select v from ir_fx where k='definition'))$$,'42501',null,'Ordinary staff cannot set practice policy');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ir_id('admin'),'session_id',pg_temp.ir_id('admin_session'))::text,true);
select is(read_invoice_reminder_practice(pg_temp.ir_id('admin'))->'policy','null'::jsonb,'ADMIN can load defaults before a policy or invoice exists');
select is((select count(*)from billing_invoices),0::bigint,'Practice settings require no manufactured invoice');
select throws_ok($$select read_invoice_reminder_practice(pg_temp.ir_id('staff'))$$,'42501',null,'Practice settings reject mismatched actor');
insert into ir_fx(k,v)select 'saved_policy',save_invoice_reminder_policy(pg_temp.ir_id('admin'),pg_temp.ir_id('policy'),0,(select v from ir_fx where k='definition'));
select is(read_invoice_reminder_practice(pg_temp.ir_id('admin'))#>>'{policy,id}',pg_temp.ir_id('policy')::text,'Practice settings and invoice workflow use the same saved policy');
select is(save_invoice_reminder_policy(pg_temp.ir_id('admin'),pg_temp.ir_id('policy'),0,(select v from ir_fx where k='definition')),(select v from ir_fx where k='saved_policy'),'Policy same UUID returns original receipt');
select throws_ok($$select save_invoice_reminder_policy(pg_temp.ir_id('admin'),pg_temp.ir_id('policy'),0,(select v from ir_fx where k='definition')||'{"enabled":false}')$$,'23505',null,'Changed immutable policy intent denied');
select throws_ok($$select save_invoice_reminder_policy(pg_temp.ir_id('admin'),gen_random_uuid(),0,(select v from ir_fx where k='definition'))$$,'PT409',null,'Stale policy version denied');
insert into ir_fx(k,id)select 'client',id from save_client(auth.uid(),null,null,'Synthetic','Invoice Reminder','+13035555901','invoice-reminder-household@example.test','EMAIL',null,null);
insert into ir_fx(k,id)select 'other_client',id from save_client(auth.uid(),null,null,'Synthetic','Other Reminder','+13035555902','invoice-reminder-other@example.test','EMAIL',null,null);
insert into ir_fx(k,id)select 'product',id from save_catalog_product(null,null,'Synthetic reminder visit','service','','visit',10000,true);
select create_billing_invoice(id,pg_temp.ir_id('client'))from ir_fx where k in('invoice','invoice2','invoice3','invoice4');
select add_invoice_service(gen_random_uuid(),id,null,pg_temp.ir_id('product'),1)from ir_fx where k in('invoice','invoice2','invoice3','invoice4');
select issue_billing_invoice(id,(select version from billing_invoices where billing_invoices.id=ir_fx.id))from ir_fx where k in('invoice','invoice2','invoice3','invoice4');
select is(read_invoice_reminders(pg_temp.ir_id('admin'),pg_temp.ir_id('invoice'),pg_temp.ir_id('client'))#>>'{context,reason}','not_enrolled','No invoice silently enrolled');
select throws_ok($$select read_invoice_reminders(pg_temp.ir_id('admin'),pg_temp.ir_id('invoice'),pg_temp.ir_id('other_client'))$$,'42501',null,'Wrong household denied');
insert into ir_fx(k,v)values('terms_values',jsonb_build_object('due_on',((statement_timestamp()at time zone 'America/Denver')::date-8)::text,'enabled',true,'channel','EMAIL','hold_kind','none','hold_reason',''));
insert into ir_fx(k,v)select 'saved_terms',save_invoice_reminder_terms(pg_temp.ir_id('admin'),pg_temp.ir_id('terms'),pg_temp.ir_id('invoice'),pg_temp.ir_id('client'),0,(select v from ir_fx where k='terms_values'));
select is(save_invoice_reminder_terms(pg_temp.ir_id('admin'),pg_temp.ir_id('terms'),pg_temp.ir_id('invoice'),pg_temp.ir_id('client'),0,(select v from ir_fx where k='terms_values')),(select v from ir_fx where k='saved_terms'),'Terms exact retry recovers original');
select throws_ok($$select save_invoice_reminder_terms(pg_temp.ir_id('admin'),gen_random_uuid(),pg_temp.ir_id('invoice'),pg_temp.ir_id('client'),0,(select v from ir_fx where k='terms_values'))$$,'PT409',null,'Stale invoice terms rejected');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ir_id('admin'))::text,true);
select throws_ok($$select save_invoice_reminder_terms(pg_temp.ir_id('admin'),gen_random_uuid(),pg_temp.ir_id('invoice'),pg_temp.ir_id('client'),1,(select v from ir_fx where k='terms_values'))$$,'42501',null,'Missing live session denied');
select throws_ok($$select read_invoice_reminder_practice(pg_temp.ir_id('admin'))$$,'42501',null,'Practice settings require a live session');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
insert into ir_fx(k,v)select 'run_receipt',execute_invoice_reminder_run(pg_temp.ir_id('run'),25);
select is((select v->>'queued'from ir_fx where k='run_receipt'),'1','Only eligible reached stage queues');
select is(execute_invoice_reminder_run(pg_temp.ir_id('run'),25),(select v from ir_fx where k='run_receipt'),'Scheduler receipt replays without another queue');
select throws_ok($$select execute_invoice_reminder_run(pg_temp.ir_id('run'),24)$$,'23505',null,'Run UUID cannot change limit');
select is(execute_invoice_reminder_run(gen_random_uuid(),25)->>'queued','0','New scheduler run does not duplicate same stage');
insert into ir_fx(k,v)select 'claim',to_jsonb(claim_communication());
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ir_id('admin'),'session_id',pg_temp.ir_id('admin_session'))::text,true);
set local role authenticated;
select save_invoice_reminder_terms(pg_temp.ir_id('admin'),gen_random_uuid(),pg_temp.ir_id('invoice'),pg_temp.ir_id('client'),1,(select v from ir_fx where k='terms_values')||'{"hold_kind":"disputed","hold_reason":"Client disputes this charge"}');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is((start_communication_attempt((select(v->>'id')::uuid from ir_fx where k='claim'),(select(v->>'lease_token')::uuid from ir_fx where k='claim'),'{"from":"The Living Room Vet <care@thelivingroom.vet>","reply_to":"admin@thelivingroom.vet"}')).state,'failed','Dispute after claim blocks provider attempt');
select is((select attempt_count from communication_outbox where id=(select(v->>'id')::uuid from ir_fx where k='claim')),0,'Suppression creates no provider attempt');
select is(execute_invoice_reminder_run(gen_random_uuid(),25)->>'queued','0','Held invoice does not queue');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ir_id('admin'),'session_id',pg_temp.ir_id('admin_session'))::text,true);
set local role authenticated;
select save_invoice_reminder_terms(pg_temp.ir_id('admin'),gen_random_uuid(),pg_temp.ir_id('invoice'),pg_temp.ir_id('client'),2,(select v from ir_fx where k='terms_values'));
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(execute_invoice_reminder_run(gen_random_uuid(),25)->>'queued','1','Resume recreates only an unattempted stage');
update ir_fx set v=to_jsonb(claim_communication())where k='claim';
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ir_id('admin'),'session_id',pg_temp.ir_id('admin_session'))::text,true);
set local role authenticated;
select credit_billing_invoice(gen_random_uuid(),pg_temp.ir_id('invoice'),5000,'Synthetic partial adjustment');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is((start_communication_attempt((select(v->>'id')::uuid from ir_fx where k='claim'),(select(v->>'lease_token')::uuid from ir_fx where k='claim'),'{"from":"The Living Room Vet <care@thelivingroom.vet>","reply_to":"admin@thelivingroom.vet"}')).state,'failed','Balance change suppresses stale amount');
select is(execute_invoice_reminder_run(gen_random_uuid(),25)->>'queued','1','New snapshot reflects remaining balance');
reset role;
select is((select frozen_context->>'amount_cents'from invoice_reminder_jobs where invoice_id=pg_temp.ir_id('invoice') order by created_at desc limit 1),'5000','Updated reminder has exact remaining cents');
select is((select count(*)from invoice_reminder_jobs where invoice_id=pg_temp.ir_id('invoice')),3::bigint,'Suppressed snapshots retained, never overwritten');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ir_id('admin'),'session_id',pg_temp.ir_id('admin_session'))::text,true);
set local role authenticated;
select credit_billing_invoice(gen_random_uuid(),pg_temp.ir_id('invoice'),5000,'Synthetic full adjustment');
select is(read_invoice_reminders(pg_temp.ir_id('admin'),pg_temp.ir_id('invoice'),pg_temp.ir_id('client'))#>>'{context,reason}','paid_or_credited','Fully credited invoice stops reminders');
select save_invoice_reminder_terms(pg_temp.ir_id('admin'),gen_random_uuid(),pg_temp.ir_id('invoice2'),pg_temp.ir_id('client'),0,(select v from ir_fx where k='terms_values')||jsonb_build_object('due_on',((statement_timestamp()at time zone 'America/Denver')::date-40)::text));
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
select is(execute_invoice_reminder_run(gen_random_uuid(),25)->>'queued','1','Old invoice queues only most recent stage, not three catch-up emails');
reset role;
select is((select offset_days from invoice_reminder_jobs where invoice_id=pg_temp.ir_id('invoice2')),30,'Most recent cadence is thirty-day stage');
select ok(not exists(select 1 from cron.job where jobname='queue-invoice-reminders'and active),'New scheduler starts inactive');
select throws_ok($$update invoice_reminder_jobs set context_hash=repeat('a',64)$$,'23514',null,'Queued snapshot history immutable');
select is((select count(*)from invoice_reminder_policies),1::bigint,'Policy retries do not add versions');
select is((select count(*)from invoice_reminder_terms where invoice_id=pg_temp.ir_id('invoice')),3::bigint,'Hold and resume preserve prior terms');

-- Actual canonical payment evidence, void and policy changes after queueing.
create function pg_temp.ir_claim(invoice uuid)returns jsonb language plpgsql as $$declare o communication_outbox;begin
 update communication_outbox set state='claimed',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '2 minutes'
 where id=(select outbox_id from invoice_reminder_jobs where invoice_id=invoice order by created_at desc limit 1) and state='pending' returning * into o;return to_jsonb(o);end $$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
select configure_payment_provider('acct_remindersynthetic',false,'https://thelivingroom.vet');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ir_id('admin'),'session_id',pg_temp.ir_id('admin_session'))::text,true);set local role authenticated;
select save_invoice_reminder_terms(pg_temp.ir_id('admin'),gen_random_uuid(),pg_temp.ir_id('invoice3'),pg_temp.ir_id('client'),0,(select v from ir_fx where k='terms_values'));
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
select is(execute_invoice_reminder_run(gen_random_uuid(),25)->>'queued','1','Another invoice can independently queue');
reset role;
update ir_fx set v=pg_temp.ir_claim(pg_temp.ir_id('invoice3'))where k='claim';
insert into ir_fx(k,id)values('checkout',gen_random_uuid());
insert into ir_fx(k,v)select 'payment_before',jsonb_build_object('hash',payment_source_hash_internal(pg_temp.ir_id('invoice3'),pg_temp.ir_id('client')));
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ir_id('admin'),'session_id',pg_temp.ir_id('admin_session'))::text,true);set local role authenticated;
select prepare_invoice_checkout(pg_temp.ir_id('checkout'),pg_temp.ir_id('invoice3'),pg_temp.ir_id('client'),(select v->>'hash'from ir_fx where k='payment_before'),10000,'acct_remindersynthetic',false,'https://thelivingroom.vet/payment/return','https://thelivingroom.vet/payment/cancel');
select is(read_invoice_reminders(pg_temp.ir_id('admin'),pg_temp.ir_id('invoice3'),pg_temp.ir_id('client'))#>>'{context,reason}','payment_pending','Pending checkout pauses collection messages');
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
select apply_checkout_evidence('evt_invoice_reminder_paid',pg_temp.ir_id('checkout'),'acct_remindersynthetic',false,'payment_succeeded','cs_reminder_synthetic','pi_remindersynthetic',10000,'usd',(select v->>'hash'from ir_fx where k='payment_before'));
select is((start_communication_attempt((select(v->>'id')::uuid from ir_fx where k='claim'),(select(v->>'lease_token')::uuid from ir_fx where k='claim'),'{"from":"The Living Room Vet <care@thelivingroom.vet>","reply_to":"admin@thelivingroom.vet"}')).state,'failed','Confirmed payment after queue suppresses message');
select is(execute_invoice_reminder_run(gen_random_uuid(),25)->>'queued','0','Paid invoice cannot regenerate a reminder');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ir_id('admin'),'session_id',pg_temp.ir_id('admin_session'))::text,true);set local role authenticated;
select save_invoice_reminder_terms(pg_temp.ir_id('admin'),gen_random_uuid(),pg_temp.ir_id('invoice4'),pg_temp.ir_id('client'),0,(select v from ir_fx where k='terms_values'));
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
select is(execute_invoice_reminder_run(gen_random_uuid(),25)->>'queued','1','Fourth invoice queues independently');
reset role;update ir_fx set v=pg_temp.ir_claim(pg_temp.ir_id('invoice4'))where k='claim';
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ir_id('admin'),'session_id',pg_temp.ir_id('admin_session'))::text,true);set local role authenticated;
select void_billing_invoice(pg_temp.ir_id('invoice4'),(select version from billing_invoices where id=pg_temp.ir_id('invoice4')),'Synthetic duplicate invoice');
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
select is((start_communication_attempt((select(v->>'id')::uuid from ir_fx where k='claim'),(select(v->>'lease_token')::uuid from ir_fx where k='claim'),'{"from":"The Living Room Vet <care@thelivingroom.vet>","reply_to":"admin@thelivingroom.vet"}')).state,'failed','Void after queue suppresses message');
reset role;update ir_fx set v=pg_temp.ir_claim(pg_temp.ir_id('invoice2'))where k='claim';
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ir_id('admin'),'session_id',pg_temp.ir_id('admin_session'))::text,true);set local role authenticated;
select save_invoice_reminder_policy(pg_temp.ir_id('admin'),gen_random_uuid(),1,(select v from ir_fx where k='definition')||'{"enabled":false}');
select is(read_invoice_reminder_practice(pg_temp.ir_id('admin'))#>>'{policy,definition,enabled}','false','Practice settings read the current policy revision');
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
select is((start_communication_attempt((select(v->>'id')::uuid from ir_fx where k='claim'),(select(v->>'lease_token')::uuid from ir_fx where k='claim'),'{"from":"The Living Room Vet <care@thelivingroom.vet>","reply_to":"admin@thelivingroom.vet"}')).state,'failed','Practice disable after queue suppresses message');
select is(execute_invoice_reminder_run(gen_random_uuid(),25)->>'queued','0','Disabled practice does not queue');
reset role;
select is((select count(*)from invoice_payments where invoice_id=pg_temp.ir_id('invoice3')),1::bigint,'Canonical payment ledger remains the one money source');
select is((select count(*)from communication_attempts),0::bigint,'All stale messages blocked before any provider attempt');
set constraints all immediate;
select * from finish();
rollback;
