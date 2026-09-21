begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
 ('74400000-0000-4000-8000-000000000001','stripe-inbox-staff@example.test','{}'),
 ('74400000-0000-4000-8000-000000000002','stripe-inbox-other@example.test','{}'),
 ('74400000-0000-4000-8000-000000000003','stripe-inbox-inactive@example.test','{}');
update public.profiles set is_active = true where id in ('74400000-0000-4000-8000-000000000001','74400000-0000-4000-8000-000000000002','74400000-0000-4000-8000-000000000003');
insert into public.user_roles (user_id, role) values ('74400000-0000-4000-8000-000000000001','STAFF'),('74400000-0000-4000-8000-000000000002','STAFF'),('74400000-0000-4000-8000-000000000003','STAFF');

update public.profiles set is_active=false where id='74400000-0000-4000-8000-000000000003';
insert into public.user_roles(user_id,role) values('74400000-0000-4000-8000-000000000001','ADMIN');
create temp table fx(k text primary key,id uuid);grant all on fx to authenticated,service_role;
create temp table snapshots(k text primary key,v jsonb);grant all on snapshots to authenticated,service_role;
set local role service_role;
select public.configure_payment_provider('acct_test',false,'https://thelivingroom.vet');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"74400000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fx select 'client',id from public.save_client(auth.uid(),null,null,'Payment','Family',null,null,'EMAIL',null,null);
insert into fx select 'other-client',id from public.save_client(auth.uid(),null,null,'Different','Family',null,null,'EMAIL',null,null);
insert into fx select 'product',id from public.save_catalog_product(null,null,'Visit','service','','visit',10000,true);
insert into fx values('invoice','74400000-0000-4000-8000-000000000010'),('attempt','74400000-0000-4000-8000-000000000020'),('refund','74400000-0000-4000-8000-000000000030');
select public.create_billing_invoice((select id from fx where k='invoice'),(select id from fx where k='client'));
select public.add_invoice_service(gen_random_uuid(),(select id from fx where k='invoice'),null,(select id from fx where k='product'),1);
select public.issue_billing_invoice((select id from fx where k='invoice'),(select version from public.billing_invoices where id=(select id from fx where k='invoice')));
insert into snapshots select 'before',public.read_invoice_payment_state((select id from fx where k='invoice'),(select id from fx where k='client'));
select public.prepare_invoice_checkout((select id from fx where k='attempt'),(select id from fx where k='invoice'),(select id from fx where k='client'),(select v->>'source_hash' from snapshots where k='before'),10000,'acct_test',false,'https://thelivingroom.vet/payment/return','https://thelivingroom.vet/payment/cancel');
insert into snapshots values('receipt',jsonb_build_object('event_id','evt_inbox','event_type','checkout.session.completed','provider_created_at',1790000000,'account_id','acct_test','livemode',false,'object_id','cs_test_inbox','request_id',(select id from fx where k='attempt'),'raw_sha256',repeat('a',64),'disposition','queued','reason',''));
insert into snapshots values('evidence',jsonb_build_object('family','checkout','account_id','acct_test','livemode',false,'kind','payment_succeeded','session_id','cs_test_inbox','payment_id','pi_inbox','amount_cents','10000','currency','usd','source_hash',(select v->>'source_hash' from snapshots where k='before')));

set local role service_role;
select public.apply_checkout_evidence('evt_knownretry',(select id from fx where k='attempt'),'acct_test',false,'session_open','cs_test_inbox',null,10000,'usd',(select v->>'source_hash' from snapshots where k='before'));
insert into fx select 'receipt',public.receive_stripe_event((select v from snapshots where k='receipt'));
reset role;
create function pg_temp.exhaust(p_id uuid) returns uuid language plpgsql as $$declare c jsonb;t uuid;begin
 for i in 1..5 loop
 update public.stripe_event_work set available_at=clock_timestamp()-interval '1 second' where receipt_id=p_id;
 c:=public.claim_stripe_event();t:=(c->>'lease_token')::uuid;
 perform public.retry_stripe_event(p_id,t,'provider_unavailable');
 end loop;return t;end $$;
insert into fx select 'old-lease',pg_temp.exhaust((select id from fx where k='receipt'));
select is((select attempt_count from public.stripe_event_work where receipt_id=(select id from fx where k='receipt')),5,'Initial lifetime count preserved');
select public.record_payment_reconciliation('checkout',(select id from fx where k='attempt'),'provider_object_unavailable');
do $$declare t jsonb;c uuid:=gen_random_uuid();p jsonb;begin
 t:=public.preview_payment_reconciliation((select id from fx where k='invoice'),'checkout',(select id from fx where k='attempt'),'cs_test_inbox');
 perform public.prepare_payment_reconciliation(c,(select id from fx where k='invoice'),'checkout',(select id from fx where k='attempt'),'cs_test_inbox',t->'blocker_refs',t->>'snapshot_hash');
 p:=public.capture_payment_reconciliation(c,'74400000-0000-4000-8000-000000000001',jsonb_build_object('family','checkout','request_id',(select id from fx where k='attempt'),'object_id','cs_test_inbox','account_id','acct_test','livemode',false,'amount_cents','10000','currency','usd','provider_observed_at',clock_timestamp()::text,'status','session_open','payment_id',null,'source_hash',(select v->>'source_hash' from snapshots where k='before')));
 perform public.complete_payment_reconciliation(c,p->>'proof_hash',t->>'snapshot_hash',true);
end $$;
select ok(not public.payment_invoice_has_observations((select id from fx where k='invoice')),'Separate prior reconciliation has already resolved its observation');

set local role authenticated;
select is(public.preview_stripe_event_retry((select id from fx where k='receipt'))->>'eligible','true','Known exact object with recoverable exhaustion eligible');
insert into snapshots select 'preview',public.preview_stripe_event_retry((select id from fx where k='receipt'));
insert into fx values('cycle',gen_random_uuid());
select throws_ok($$select public.requeue_stripe_event((select id from fx where k='cycle'),(select id from fx where k='receipt'),(select v->>'expected_work_hash' from snapshots where k='preview'),'provider_recovered',false)$$,'23514',null,'Administrator must explicitly attest');
select throws_ok($$select public.requeue_stripe_event((select id from fx where k='cycle'),(select id from fx where k='receipt'),repeat('a',64),'provider_recovered',true)$$,'40001',null,'Stale reviewed work hash denied');
select lives_ok($$select public.requeue_stripe_event((select id from fx where k='cycle'),(select id from fx where k='receipt'),(select v->>'expected_work_hash' from snapshots where k='preview'),'provider_recovered',true)$$,'Audited administrator cycle appended');
select lives_ok($$select public.requeue_stripe_event((select id from fx where k='cycle'),(select id from fx where k='receipt'),(select v->>'expected_work_hash' from snapshots where k='preview'),'provider_recovered',true)$$,'Lost acknowledgement retry returns same cycle');
select throws_ok($$select public.requeue_stripe_event((select id from fx where k='cycle'),(select id from fx where k='receipt'),(select v->>'expected_work_hash' from snapshots where k='preview'),'processor_repaired',true)$$,'23505',null,'UUID cannot change reviewed reason');
select throws_ok($$select lease_token from public.stripe_event_work_history$$,'42501',null,'Worker lease identities remain private');
set local role service_role;
select throws_ok($$select public.finish_stripe_event((select id from fx where k='receipt'),(select id from fx where k='old-lease'),(select v from snapshots where k='evidence'))$$,'42501',null,'Prior cycle worker cannot apply evidence');
insert into snapshots select 'new-claim',public.claim_stripe_event();
select is((select v->>'attempt_count' from snapshots where k='new-claim'),'6','Lifetime counter never resets');
select is((select v->>'cycle_attempt_count' from snapshots where k='new-claim'),'1','Explicit new cycle has separate bounded allowance');
select is((select v->>'cycle_no' from snapshots where k='new-claim'),'1','Claim exposes audited cycle number');
select throws_ok($$select public.retry_stripe_event((select id from fx where k='receipt'),(select id from fx where k='old-lease'),'transport_unknown')$$,'42501',null,'Prior cycle retry lease rejected');
select is(public.retry_stripe_event((select id from fx where k='receipt'),(select (v->>'lease_token')::uuid from snapshots where k='new-claim'),'provider_unavailable'),'queued','Current cycle can retry');
reset role;
do $$declare c jsonb;begin for i in 1..4 loop update public.stripe_event_work set available_at=clock_timestamp()-interval '1 second' where receipt_id=(select id from fx where k='receipt');c:=public.claim_stripe_event();perform public.retry_stripe_event((select id from fx where k='receipt'),(c->>'lease_token')::uuid,'provider_unavailable');end loop;end $$;
select is((select attempt_count from public.stripe_event_work where receipt_id=(select id from fx where k='receipt')),10,'Two complete cycles retain ten total attempts');
select is((select cycle_attempt_count from public.stripe_event_work where receipt_id=(select id from fx where k='receipt')),5,'Second cycle bounded at five');
select is((select state from public.stripe_event_work where receipt_id=(select id from fx where k='receipt')),'quarantined','Exhausted cycle returns to quarantine');
select is(public.claim_stripe_event(),null::jsonb,'No automatic sixth claim within a cycle');
select is((select count(*) from public.stripe_event_work_history where receipt_id=(select id from fx where k='receipt')),20::bigint,'Every claim and retry survives both cycles');
select is((select count(*) from public.invoice_payments where invoice_id=(select id from fx where k='invoice')),0::bigint,'Retry cycles never apply financial evidence');
select throws_ok($$update public.stripe_event_retry_cycles set reason='processor_repaired'$$,'23514',null,'Audited cycle history immutable');
insert into fx select 'unknown-object',public.receive_stripe_event((select v||'{"event_id":"evt_unknownretry","object_id":"cs_test_other"}' from snapshots where k='receipt'));
select pg_temp.exhaust((select id from fx where k='unknown-object'));
select is(public.preview_stripe_event_retry((select id from fx where k='unknown-object'))->>'eligible','false','Retry exhaustion cannot attribute an unknown provider object');
insert into fx select 'crash',public.receive_stripe_event((select v||'{"event_id":"evt_crashretry"}' from snapshots where k='receipt'));
update public.stripe_event_work set attempt_count=5,cycle_attempt_count=5,state='processing',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()-interval '1 second' where receipt_id=(select id from fx where k='crash');
select public.claim_stripe_event();
select is(public.preview_stripe_event_retry((select id from fx where k='crash'))->>'eligible','false','Crash-only exhaustion lacks reviewed recoverable failure evidence');
insert into fx select 'unsupported',public.receive_stripe_event((select v||'{"event_id":"evt_unsupportedretry","event_type":"charge.dispute.created"}' from snapshots where k='receipt'));
select is(public.preview_stripe_event_retry((select id from fx where k='unsupported'))->>'eligible','false','Unsupported event cannot be requeued');
select ok(not exists(select 1 from jsonb_array_elements(public.preview_stripe_event_retry((select id from fx where k='receipt'))->'history') h where h ? 'lease_token'),'Safe preview history excludes all worker leases');
select public.record_payment_reconciliation('checkout',(select id from fx where k='attempt'),'provider_context_mismatch');
set local role authenticated;
select is(public.preview_stripe_event_retry((select id from fx where k='receipt'))->>'eligible','false','Unresolved provider mismatch excludes further retry');
select set_config('request.jwt.claims','{"sub":"74400000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.preview_stripe_event_retry((select id from fx where k='receipt'))$$,'42501',null,'Non-admin staff denied');
select set_config('request.jwt.claims','{"sub":"74400000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok($$select public.preview_stripe_event_retry((select id from fx where k='receipt'))$$,'42501',null,'Inactive staff denied');
set local role service_role;
select throws_ok($$select public.preview_stripe_event_retry((select id from fx where k='receipt'))$$,'42501',null,'Service cannot impersonate administrator review');
select * from finish();rollback;
