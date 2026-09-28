begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

create function pg_temp.queue_prepared(p_actor_id uuid,p_request_id uuid,p_conversation_id uuid,p_channel text,p_recipient text,p_subject text,p_body text) returns public.communication_outbox language plpgsql as $$
begin
 perform public.prepare_message_request(p_actor_id,p_request_id,'fixture:'||p_request_id,p_conversation_id,p_channel,p_recipient,p_subject,p_body,'{}');
 return public.enqueue_communication(p_actor_id,p_request_id,p_conversation_id,p_channel,p_recipient,p_subject,p_body,'{}');
end $$;

insert into auth.users(id,email,raw_user_meta_data) values
('52800000-0000-4000-8000-000000000001','cloudtalk-staff@example.test','{"first_name":"CloudTalk","last_name":"Staff"}');
update public.profiles set is_active=true where id='52800000-0000-4000-8000-000000000001';
insert into public.user_roles(user_id,role) values('52800000-0000-4000-8000-000000000001','STAFF');
create temp table fx(kind text primary key,id uuid);
grant all on fx to authenticated,service_role;

select is(public.communication_sms_provider(),'cloudtalk','Owner decision: CloudTalk is the selected SMS provider');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"52800000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select provider from public.communication_sms_provider_setting),'cloudtalk','Active staff can read the SMS provider setting');
select throws_ok($$update public.communication_sms_provider_setting set provider='twilio'$$,'42501',null,'Staff cannot change the SMS provider');
select throws_ok($$select public.communication_sms_provider()$$,'42501',null,'Provider lookup is internal');
insert into fx select 'client',id from public.save_client(auth.uid(),null,null,'CloudTalk','Family','+13035550140','cloudtalk@example.test','EMAIL',null,null);
reset role;
insert into public.conversations(id,client_id) values('52800000-0000-4000-8000-000000000002',(select id from fx where kind='client'));
insert into public.sms_consent(client_id,phone_number,opted_in) values((select id from fx where kind='client'),'+13035550140',true);
set local role authenticated;
insert into fx select 'sms',id from pg_temp.queue_prepared(auth.uid(),'52800000-0000-4000-8000-000000000003','52800000-0000-4000-8000-000000000002','SMS','+13035550140','','Synthetic CloudTalk SMS');
insert into fx select 'email',id from pg_temp.queue_prepared(auth.uid(),'52800000-0000-4000-8000-000000000004','52800000-0000-4000-8000-000000000002','EMAIL','cloudtalk@example.test','Visit','Synthetic email');
reset role;
select is((select provider from public.communication_outbox where id=(select id from fx where kind='sms')),'cloudtalk','SMS queued by an existing enqueue path is assigned to CloudTalk');
select is((select provider from public.communication_outbox where id=(select id from fx where kind='email')),'resend','Email stays on Resend');
select throws_ok($$update public.communication_outbox set provider='cloudtalk' where id=(select id from fx where kind='email')$$,'23514',null,'Email rows can never carry an SMS provider');

-- Take the email out of the queue so claims below are deterministic.
update public.communication_outbox set state='failed',last_error='fixture' where id=(select id from fx where kind='email');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into fx select 'lease',lease_token from public.claim_communication();
select throws_ok($$select public.start_communication_attempt((select id from fx where kind='sms'),(select id from fx where kind='lease'),'{"from":"+17207646677","account_sid":"ACsynthetic"}')$$,'23514',null,'Twilio sender metadata cannot start a CloudTalk attempt');
select throws_ok($$select public.start_communication_attempt((select id from fx where kind='sms'),(select id from fx where kind='lease'),'{"from":"+17207646677","provider":"cloudtalk","key":"x"}')$$,'23514',null,'CloudTalk metadata is exact');
select throws_ok($$select public.start_communication_attempt((select id from fx where kind='sms'),(select id from fx where kind='lease'),'{"from":"720-764-6677","provider":"cloudtalk"}')$$,'23514',null,'CloudTalk sender must be E.164');
select throws_ok($$select public.start_communication_attempt((select id from fx where kind='sms'),(select id from fx where kind='lease'),'{"from":"+17207646677","provider":"twilio"}')$$,'23514',null,'CloudTalk metadata names CloudTalk');
select is((public.start_communication_attempt((select id from fx where kind='sms'),(select id from fx where kind='lease'),'{"from":"+17207646677","provider":"cloudtalk"}')).state,'claimed','Exact CloudTalk sender metadata starts one audited attempt');
select is((select provider_config from public.communication_outbox where id=(select id from fx where kind='sms')),'{"from":"+17207646677","provider":"cloudtalk"}'::jsonb,'Sender is frozen before the provider request');
select lives_ok($$select public.finish_communication_attempt((select id from fx where kind='sms'),(select id from fx where kind='lease'),'accepted','local-accepted:'||(select id from fx where kind='sms'),null)$$,'CloudTalk acceptance records a unique acceptance reference');
select is((select state from public.communication_outbox where id=(select id from fx where kind='sms')),'accepted','Acceptance is not delivery');
reset role;

-- A provider switch between queueing and sending fails closed.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"52800000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fx select 'switch',id from pg_temp.queue_prepared(auth.uid(),'52800000-0000-4000-8000-000000000005','52800000-0000-4000-8000-000000000002','SMS','+13035550140','','Second synthetic SMS');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update fx set id=(public.claim_communication()).lease_token where kind='lease';
reset role;
update public.communication_sms_provider_setting set provider='twilio';
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((public.start_communication_attempt((select id from fx where kind='switch'),(select id from fx where kind='lease'),'{"from":"+17207646677","provider":"cloudtalk"}')).last_error,'sms_provider_mismatch','A CloudTalk row is never sent after the setting changes');
select is((select attempt_count from public.communication_outbox where id=(select id from fx where kind='switch')),0,'No attempt was recorded');
reset role;
update public.communication_sms_provider_setting set provider='cloudtalk';

-- A CloudTalk STOP received after claiming blocks the final pre-request check.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"52800000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fx select 'stop',id from pg_temp.queue_prepared(auth.uid(),'52800000-0000-4000-8000-000000000006','52800000-0000-4000-8000-000000000002','SMS','+13035550140','','Third synthetic SMS');
insert into fx select 'pending',id from pg_temp.queue_prepared(auth.uid(),'52800000-0000-4000-8000-000000000007','52800000-0000-4000-8000-000000000002','SMS','+13035550140','','Fourth synthetic SMS');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update fx set id=(public.claim_communication()).lease_token where kind='lease';
select ok(public.ingest_cloudtalk_event('ct-stop-1','message.received',now(),'{"id":"ct-msg-1","channel":"sms","external_number":"+13035550140","internal_number":{"number_e164":"+17207646677"},"body":" stop "}'),'Signed CloudTalk STOP is ingested');
select is((public.start_communication_attempt((select id from fx where kind='stop'),(select id from fx where kind='lease'),'{"from":"+17207646677","provider":"cloudtalk"}')).last_error,'recipient_or_actor_ineligible','A claimed CloudTalk SMS is blocked by a later STOP');
select is((select state from public.communication_outbox where id=(select id from fx where kind='pending')),'failed','Pending SMS is cancelled by STOP');
reset role;

-- outbound_deliveries final consent check.
insert into public.outbound_deliveries(id,idempotency_key,channel,recipient,payload,client_id,status,leased_at,leased_until,lease_owner,attempt_count) values
('52800000-0000-4000-8000-000000000010','ct:stopped','SMS','+13035550140','{"body":"x"}',(select id from fx where kind='client'),'LEASED',now(),now()+interval '5 minutes','worker-a',1),
('52800000-0000-4000-8000-000000000011','ct:no-client','SMS','+13035550141','{"body":"x"}',null,'LEASED',now(),now()+interval '5 minutes','worker-a',1);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"52800000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.outbound_delivery_sms_permitted('52800000-0000-4000-8000-000000000010','worker-a')$$,'42501',null,'Staff cannot call the worker consent check');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select public.outbound_delivery_sms_permitted('52800000-0000-4000-8000-000000000010','worker-b')$$,'PT409',null,'Consent check requires the active lease');
select is(public.outbound_delivery_sms_permitted('52800000-0000-4000-8000-000000000010','worker-a'),false,'STOP blocks the legacy delivery queue at send time');
select is(public.outbound_delivery_sms_permitted('52800000-0000-4000-8000-000000000011','worker-a'),false,'A delivery without a household consent record is not sent');
reset role;
delete from public.communication_suppressions where recipient='+13035550140';
update public.sms_consent set opted_in=true,opted_out_at=null where client_id=(select id from fx where kind='client');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(public.outbound_delivery_sms_permitted('52800000-0000-4000-8000-000000000010','worker-a'),true,'Consented, unsuppressed recipient is permitted');
reset role;

select * from finish();
rollback;
