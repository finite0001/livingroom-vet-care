begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- The compatibility fixtures use the same mandatory prepare path as the browser.
create function pg_temp.queue_prepared(p_actor_id uuid,p_request_id uuid,p_conversation_id uuid,p_channel text,p_recipient text,p_subject text,p_body text,p_attachment_ids uuid[] default '{}') returns public.communication_outbox language plpgsql as $$
begin
 if not exists(select 1 from public.communication_prepared_requests where request_id=p_request_id) then
  perform public.prepare_message_request(p_actor_id,p_request_id,'fixture:'||p_request_id,p_conversation_id,p_channel,p_recipient,p_subject,p_body,p_attachment_ids);
 end if;
 return public.enqueue_communication(p_actor_id,p_request_id,p_conversation_id,p_channel,p_recipient,p_subject,p_body,p_attachment_ids);
end $$;

insert into auth.users(id,email,raw_user_meta_data) values
('b5000000-0000-4000-8000-000000000001','outbox-staff@example.test','{"first_name":"Outbox","last_name":"Staff"}');
update public.profiles set is_active = true where id in ('b5000000-0000-4000-8000-000000000001');
insert into public.user_roles (user_id, role) values ('b5000000-0000-4000-8000-000000000001','STAFF');

insert into public.user_roles(user_id,role) values('b5000000-0000-4000-8000-000000000001','ADMIN');
create temp table fixture_ids(kind text primary key,id uuid);
grant all on fixture_ids to authenticated,service_role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b5000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fixture_ids select 'client',id from public.save_client(auth.uid(),null,null,'Outbox','Family','+13035550100','outbox@example.test','EMAIL',null,null);
reset role;
insert into public.conversations(id,client_id) values('b5000000-0000-4000-8000-000000000002',(select id from fixture_ids where kind='client'));
set local role authenticated;
insert into fixture_ids select 'email',id from pg_temp.queue_prepared(auth.uid(),'b5000000-0000-4000-8000-000000000003','b5000000-0000-4000-8000-000000000002','EMAIL','outbox@example.test','Visit','Synthetic email');
reset role;
update public.communication_outbox set state='failed',last_error='delivery_policy_or_configuration_blocked' where id=(select id from fixture_ids where kind='email');
set local role authenticated;
select is(public.preview_outbox_retry((select id from fixture_ids where kind='email'))->>'reason','eligible_for_requeue','Unattempted configuration failure can be reviewed');
create temp table retry_data(k text primary key,v jsonb);grant all on retry_data to authenticated,service_role;
insert into retry_data values('review',preview_outbox_retry((select id from fixture_ids where kind='email')));
select ok(not (select v::text from retry_data where k='review') ~ 'outbox@example|Synthetic email|reply_to|lease_token','Preview excludes payload, recipient and lease');
select throws_ok($$select retry_communication(auth.uid(),(select id from fixture_ids where kind='email'))$$,'42501',null,'Legacy public retry is revoked');
select ok(not has_function_privilege('service_role','retry_communication(uuid,uuid)','execute'),'Service cannot call unreviewed legacy path');
select ok(not has_function_privilege('authenticated','outbox_retry_source_internal(uuid)','execute'),'Private source context inaccessible');
select ok(not has_function_privilege('service_role','outbox_retry_preview_internal(uuid)','execute'),'Private hash context inaccessible');
select throws_ok($$select * from outbox_retry_actions$$,'42501',null,'Raw action table inaccessible');
select throws_ok($$select requeue_outbox_retry(gen_random_uuid(),(select id from fixture_ids where kind='email'),(select v->>'expected_work_hash' from retry_data where k='review'),'configuration_repaired',false)$$,'23514',null,'Explicit repair attestation required');
select throws_ok($$select requeue_outbox_retry(gen_random_uuid(),(select id from fixture_ids where kind='email'),repeat('0',64),'configuration_repaired',true)$$,'40001',null,'Wrong hash rejected');
insert into retry_data values('action',requeue_outbox_retry('b5000000-0000-4000-8000-000000000005',(select id from fixture_ids where kind='email'),(select v->>'expected_work_hash' from retry_data where k='review'),'configuration_repaired',true));
select is((select state from communication_outbox where id=(select id from fixture_ids where kind='email')),'pending','Retry queues but never claims sent');
select is((select count(*) from communication_attempts where outbox_id=(select id from fixture_ids where kind='email')),0::bigint,'Retry performs no provider attempt');
select is((select (v->>'queued_revision')::bigint-(v->>'previous_revision')::bigint from retry_data where k='action'),1::bigint,'Receipt binds exact next revision');
select is(recover_outbox_retry('b5000000-0000-4000-8000-000000000005'),(select v from retry_data where k='action'),'Lost response recovers exact receipt');
select is(requeue_outbox_retry('b5000000-0000-4000-8000-000000000005',(select id from fixture_ids where kind='email'),(select v->>'expected_work_hash' from retry_data where k='review'),'configuration_repaired',true),(select v from retry_data where k='action'),'Exact replay succeeds after state changed');
select throws_ok($$select requeue_outbox_retry('b5000000-0000-4000-8000-000000000005',(select id from fixture_ids where kind='email'),(select v->>'expected_work_hash' from retry_data where k='review'),'recipient_reverified',true)$$,'23505',null,'UUID cannot change reason');
select is(jsonb_array_length(list_outbox_retry_actions()->'items'),1,'Own history survives pointer loss');
select throws_ok($$select list_outbox_retry_actions(now(),null,50)$$,'23514',null,'Partial cursor rejected');
reset role;
insert into retry_data values('intent',(select to_jsonb(o)-array['state','revision','updated_at'] from communication_outbox o where id=(select id from fixture_ids where kind='email')));
update communication_outbox set state='failed' where id=(select id from fixture_ids where kind='email');
set local role authenticated;
select is(requeue_outbox_retry('b5000000-0000-4000-8000-000000000005',(select id from fixture_ids where kind='email'),(select v->>'expected_work_hash' from retry_data where k='review'),'configuration_repaired',true),(select v from retry_data where k='action'),'Late exact reply cannot requeue a later failure');
select is((select state from communication_outbox where id=(select id from fixture_ids where kind='email')),'failed','Second failure remains failed after replay');
select throws_ok($$select requeue_outbox_retry(gen_random_uuid(),(select id from fixture_ids where kind='email'),(select v->>'expected_work_hash' from retry_data where k='review'),'configuration_repaired',true)$$,'40001',null,'Same-clock second failure invalidates prior review');
select is((select to_jsonb(o)-array['state','revision','updated_at'] from communication_outbox o where id=(select id from fixture_ids where kind='email')),(select v from retry_data where k='intent'),'Payload, attachments, sender and evidence unchanged');
reset role;
insert into retry_data values('revision',(select to_jsonb(revision) from communication_outbox where id=(select id from fixture_ids where kind='email')));
update communication_outbox set revision=1 where id=(select id from fixture_ids where kind='email');
select is((select to_jsonb(revision) from communication_outbox where id=(select id from fixture_ids where kind='email')),(select v from retry_data where k='revision'),'Even owner cannot override monotonic revision through update');
select throws_ok($$update outbox_retry_actions set reason='source_reverified'$$,'23514',null,'Action history append only');
insert into auth.users(id,email,raw_user_meta_data) values('b5000000-0000-4000-8000-000000000006','other-retry@example.test','{}');
update public.profiles set is_active = true where id in ('b5000000-0000-4000-8000-000000000006');
insert into public.user_roles (user_id, role) values ('b5000000-0000-4000-8000-000000000006','STAFF');

insert into user_roles(user_id,role) values('b5000000-0000-4000-8000-000000000006','ADMIN');
set local role authenticated;select set_config('request.jwt.claims','{"sub":"b5000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select is(recover_outbox_retry('b5000000-0000-4000-8000-000000000005'),null::jsonb,'Other administrator cannot recover original action');
select is(jsonb_array_length(list_outbox_retry_actions()->'items'),0,'History actor scoped');
select throws_ok($$select requeue_outbox_retry('b5000000-0000-4000-8000-000000000005',(select id from fixture_ids where kind='email'),(select v->>'expected_work_hash' from retry_data where k='review'),'configuration_repaired',true)$$,'23505',null,'Cross-actor UUID replay rejected');
reset role;delete from user_roles where user_id='b5000000-0000-4000-8000-000000000006' and role='ADMIN';
set local role authenticated;
select throws_ok($$select preview_outbox_retry((select id from fixture_ids where kind='email'))$$,'42501',null,'Active staff without ADMIN cannot review retry');
select set_config('request.jwt.claims','{"sub":"b5000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
reset role;
update clients set primary_email='changed@example.test' where id=(select id from fixture_ids where kind='client');
set local role authenticated;
select is(preview_outbox_retry((select id from fixture_ids where kind='email'))->>'reason','recipient_or_conversation_changed','Current contact mismatch blocks retry');
reset role;update clients set primary_email='outbox@example.test' where id=(select id from fixture_ids where kind='client');
insert into communication_suppressions(channel,recipient,reason) values('EMAIL','outbox@example.test','Synthetic suppression');
set local role authenticated;
select is(preview_outbox_retry((select id from fixture_ids where kind='email'))->>'reason','recipient_suppressed','Suppression blocks retry');
reset role;delete from communication_suppressions where recipient='outbox@example.test';
set local session_replication_role=replica;
update profiles set is_active=false where id='b5000000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
set local role authenticated;
select throws_ok($$select recover_outbox_retry('b5000000-0000-4000-8000-000000000005')$$,'42501',null,'Revoked actor cannot recover history');
reset role;set local session_replication_role=replica;update profiles set is_active=true where id='b5000000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
create function pg_temp.check_evidence(p_change text) returns boolean language plpgsql as $$
declare result boolean;begin
 execute 'update communication_outbox set '||p_change||' where id=(select id from fixture_ids where kind=''email'')';
 result:=outbox_retry_preview_internal((select id from fixture_ids where kind='email'))->>'reason'='provider_evidence_requires_reconciliation';
 update communication_outbox set attempt_count=0,first_attempt_at=null,attempt_started_at=null,provider_message_id=null,accepted_at=null,delivered_at=null,delivery_failure_kind=null where id=(select id from fixture_ids where kind='email');return result;
end $$;
select ok(pg_temp.check_evidence('attempt_count=1'),'Attempt count blocks');
select ok(pg_temp.check_evidence('first_attempt_at=now()'),'First attempt blocks');
select ok(pg_temp.check_evidence('attempt_started_at=now()'),'Attempt start blocks');
select ok(pg_temp.check_evidence('provider_message_id=''synthetic-provider-id'''),'Provider identity blocks');
select ok(pg_temp.check_evidence('accepted_at=now()'),'Accepted evidence blocks');
select ok(pg_temp.check_evidence('delivered_at=now()'),'Delivered evidence blocks');
select ok(pg_temp.check_evidence('delivery_failure_kind=''bounced'''),'Delivery failure evidence blocks');
-- Rollback subtransactions prove each retained evidence table independently.
create function pg_temp.retained_evidence(p_kind text) returns boolean language plpgsql as $$
declare result boolean;begin
 begin
  if p_kind='delivery' then insert into communication_delivery_events(provider,event_id,outbox_id,outcome) values('resend','synthetic-delivery',(select id from fixture_ids where kind='email'),'failed');
  else insert into communication_reconciliations(outbox_id,previous_state,outcome,evidence_reference) values((select id from fixture_ids where kind='email'),'uncertain','failed','Synthetic verified non-acceptance');end if;
  result:=outbox_retry_preview_internal((select id from fixture_ids where kind='email'))->>'reason'='provider_evidence_requires_reconciliation';
  raise exception 'rollback evidence probe';
 exception when raise_exception then return result;end;
end $$;
select ok(pg_temp.retained_evidence('delivery'),'Retained delivery event blocks even without provider ID');
select ok(pg_temp.retained_evidence('reconciliation'),'Service-reconciled failure is outside this pre-provider workflow');
insert into communication_attempts(outbox_id,lease_token,attempt_number) values((select id from fixture_ids where kind='email'),gen_random_uuid(),1);
select is(outbox_retry_preview_internal((select id from fixture_ids where kind='email'))->>'reason','provider_evidence_requires_reconciliation','Attempt row remains authoritative even if counters unavailable');
update communication_outbox set state='uncertain' where id=(select id from fixture_ids where kind='email');
select is(outbox_retry_preview_internal((select id from fixture_ids where kind='email'))->>'eligible','false','Uncertain never eligible');
select * from finish();rollback;
