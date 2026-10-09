begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Keyword parsing: exact whole message, trimmed, case-insensitive.
select is(public.sms_keyword('START'),'START','START resumes');
select is(public.sms_keyword('  unstop  '),'START','UNSTOP is trimmed and case-insensitive');
select is(public.sms_keyword(E'\nYes\t'),'START','YES with surrounding whitespace resumes');
select is(public.sms_keyword('Start please'),null,'A sentence containing START is not a keyword');
select is(public.sms_keyword('yes.'),null,'Punctuation makes it an ordinary reply');
select is(public.sms_keyword(' stop '),'STOP','STOP is trimmed and case-insensitive');
select is(public.sms_keyword('Unsubscribe'),'STOP','UNSUBSCRIBE opts out');
select is(public.sms_keyword('help'),'HELP','HELP is classified but not acted on');
select is(public.sms_keyword(null),null,'An empty body is not a keyword');

insert into auth.users(id,email,raw_user_meta_data) values ('97000000-0000-4000-8000-000000000001','resubscribe-staff@example.test','{"first_name":"Synthetic","last_name":"Resubscribe"}');
update public.profiles set is_active=true,full_name='Synthetic Resubscribe' where id='97000000-0000-4000-8000-000000000001';
insert into public.user_roles(user_id,role) values ('97000000-0000-4000-8000-000000000001','STAFF');

create temp table fx(kind text primary key,id uuid);
grant all on fx to authenticated;
create function pg_temp.consent(k text) returns jsonb language sql as $$ select public.current_sms_consent((select id from fx where kind=k)) $$;
create function pg_temp.ct(p_event text,p_msg text,p_from text,p_body text,p_at timestamptz) returns boolean language sql as $$
 select public.ingest_cloudtalk_event(p_event,'message.received',p_at,jsonb_build_object('id',p_msg,'channel','sms','external_number',p_from,'internal_number',jsonb_build_object('number_e164','+17207646677'),'body',p_body))
$$;
grant execute on function pg_temp.consent(text), pg_temp.ct(text,text,text,text,timestamptz) to authenticated, service_role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fx select 'a',id from public.save_client(auth.uid(),null,null,'Stop','Start','+13035550201','fixture-3298@example.test','SMS',null,null);
insert into fx select 'b',id from public.save_client(auth.uid(),null,null,'Out','OfOrder','+13035550202','fixture-8835@example.test','SMS',null,null);
insert into fx select 'c',id from public.save_client(auth.uid(),null,null,'Carrier','Bounce','+13035550203','fixture-3996@example.test','SMS',null,null);
select lives_ok($$select public.record_sms_consent(auth.uid(),(select id from fx where kind='a'),'+13035550201',true,'WRITTEN','Synthetic signed form A',null)$$,'Household A consents');
select lives_ok($$select public.record_sms_consent(auth.uid(),(select id from fx where kind='b'),'+13035550202',true,'WRITTEN','Synthetic signed form B',null)$$,'Household B consents');
select lives_ok($$select public.record_sms_consent(auth.uid(),(select id from fx where kind='c'),'+13035550203',true,'WRITTEN','Synthetic signed form C',null)$$,'Household C consents');
select is(pg_temp.consent('a')->>'can_message','true','Consented household can be texted');
select is(pg_temp.consent('a')->'block_reason','null'::jsonb,'No block reason while permitted');

-- STOP blocks and is audited with its provider message.
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select ok(pg_temp.ct('ev-a-stop','msg-a-stop','+13035550201',' Stop ',now()-interval '10 minutes'),'STOP ingested');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(pg_temp.consent('a')->>'can_message','false','STOP blocks texting');
select is(pg_temp.consent('a')->>'block_reason','sms_stop','Block reason is the STOP reply');
select is((pg_temp.consent('a')->>'blocked_since')::timestamptz,now()-interval '10 minutes','Block is dated by the STOP message, not by receipt');
select is((select count(*)::int from public.sms_suppression_events where recipient='+13035550201' and action='suppressed' and source='sms_keyword' and keyword='STOP' and provider_message_id='msg-a-stop'),1,'STOP is audited once with its message id');

-- HELP is unchanged: no lift, no audit.
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select ok(pg_temp.ct('ev-a-help','msg-a-help','+13035550201','HELP',now()-interval '9 minutes'),'HELP ingested');
select ok(pg_temp.ct('ev-a-sentence','msg-a-sentence','+13035550201','Start sending me reminders again?',now()-interval '8 minutes'),'A sentence mentioning start is ingested');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(pg_temp.consent('a')->>'block_reason','sms_stop','HELP and non-keyword replies do not lift STOP');
select is((select count(*)::int from public.sms_suppression_events where recipient='+13035550201'),1,'HELP and ordinary replies are not audited');

-- START after STOP lifts, restores consent from the keyword and is audited.
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select ok(pg_temp.ct('ev-a-start','msg-a-start','+13035550201','start',now()-interval '5 minutes'),'START ingested');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(pg_temp.consent('a')->>'can_message','true','START after STOP resumes texting');
select is(pg_temp.consent('a')->>'consent_method','SMS_KEYWORD','Consent source is the SMS keyword');
select is((pg_temp.consent('a')->>'opted_in_at')::timestamptz,now()-interval '5 minutes','Consent is dated by the START message');
select is(pg_temp.consent('a')#>>'{last_resumed,source}','sms_keyword','Resumption source is the keyword');
select is(pg_temp.consent('a')#>>'{last_resumed,keyword}','START','Resumption keyword');
select is((pg_temp.consent('a')#>>'{last_resumed,after_since}')::timestamptz,now()-interval '10 minutes','Resumption records which STOP it followed');
select is((select count(*)::int from public.sms_suppression_events where recipient='+13035550201' and action='lifted' and source='sms_keyword' and provider='cloudtalk' and provider_message_id='msg-a-start' and suppression_reason='cloudtalk_sms_stop'),1,'Lift is audited with the START message id');

-- Replays: same event id is ignored; a new event id for the same message records nothing new.
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(pg_temp.ct('ev-a-start','msg-a-start','+13035550201','start',now()-interval '5 minutes'),false,'Same webhook event replay is a no-op');
select ok(pg_temp.ct('ev-a-start-redelivery','msg-a-start','+13035550201','start',now()-interval '5 minutes'),'Redelivery under a new event id is accepted');
reset role;
select is((select count(*)::int from public.sms_suppression_events where provider_message_id='msg-a-start'),1,'Replay does not double-record the lift');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);

-- A new STOP re-blocks; replaying the earlier START cannot lift the newer STOP.
select ok(pg_temp.ct('ev-a-stop2','msg-a-stop2','+13035550201','STOP',now()-interval '3 minutes'),'Second STOP ingested');
select ok(pg_temp.ct('ev-a-start-late-replay','msg-a-start','+13035550201','start',now()-interval '5 minutes'),'Old START replayed after new STOP');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(pg_temp.consent('a')->>'block_reason','sms_stop','A replayed earlier START does not lift a later STOP');
select is((pg_temp.consent('a')->>'blocked_since')::timestamptz,now()-interval '3 minutes','Block is dated by the latest STOP');

-- Staff explicit agreement lifts the STOP and records who did it.
select lives_ok($$select public.record_sms_consent(auth.uid(),(select id from fx where kind='a'),'+13035550201',true,'WRITTEN','Client re-signed SMS consent at front desk',(pg_temp.consent('a')->>'updated_at')::timestamptz)$$,'Staff records renewed consent');
select is(pg_temp.consent('a')->>'can_message','true','Staff re-consent after STOP resumes texting');
select is(pg_temp.consent('a')#>>'{last_resumed,source}','staff_consent','Resumption source is staff consent');
select is(pg_temp.consent('a')#>>'{last_resumed,by}','Synthetic Resubscribe','Resumption names the staff member');
select is((select count(*)::int from public.sms_suppression_events where recipient='+13035550201' and action='lifted' and source='staff_consent' and actor_id='97000000-0000-4000-8000-000000000001' and suppression_reason='cloudtalk_sms_stop'),1,'Staff lift is audited with the actor');

-- Withdrawal re-blocks, and a later START keyword does not override a staff opt-out.
select lives_ok($$select public.record_sms_consent(auth.uid(),(select id from fx where kind='a'),'+13035550201',false,'VERBAL','Client asked staff to stop texting',(pg_temp.consent('a')->>'updated_at')::timestamptz)$$,'Staff records withdrawal');
select is(pg_temp.consent('a')->>'can_message','false','Withdrawal re-blocks texting');
select is(pg_temp.consent('a')->>'block_reason','staff_opt_out','Block reason is the staff-recorded withdrawal');
select is((select count(*)::int from public.sms_suppression_events where recipient='+13035550201' and action='suppressed' and source='staff_withdrawal' and actor_id='97000000-0000-4000-8000-000000000001'),1,'Withdrawal is audited with the actor');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select ok(pg_temp.ct('ev-a-start3','msg-a-start3','+13035550201','START',now()+interval '1 minute'),'START after staff withdrawal ingested');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(pg_temp.consent('a')->>'block_reason','staff_opt_out','A START keyword does not lift a staff-recorded withdrawal');
select lives_ok($$select public.record_sms_consent(auth.uid(),(select id from fx where kind='a'),'+13035550201',true,'VERBAL','Client called back and agreed again',(pg_temp.consent('a')->>'updated_at')::timestamptz)$$,'Staff records consent again');
select is(pg_temp.consent('a')->>'can_message','true','Staff consent lifts a staff opt-out');

-- START before STOP (out-of-order webhooks) does not count.
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select ok(pg_temp.ct('ev-b-stop','msg-b-stop','+13035550202','STOP',now()-interval '10 minutes'),'B STOP ingested');
select ok(pg_temp.ct('ev-b-start-early','msg-b-start-early','+13035550202','START',now()-interval '20 minutes'),'B START that predates the STOP arrives late');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(pg_temp.consent('b')->>'block_reason','sms_stop','A START sent before the STOP does not lift it');
select is((select count(*)::int from public.sms_suppression_events where recipient='+13035550202' and action='lifted'),0,'No lift recorded for an earlier START');
-- A delayed STOP that predates a later START does not re-block.
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select ok(pg_temp.ct('ev-b-start','msg-b-start','+13035550202','Unstop',now()-interval '4 minutes'),'B UNSTOP ingested');
select ok(pg_temp.ct('ev-b-stop-delayed','msg-b-stop-delayed','+13035550202','STOP',now()-interval '6 minutes'),'B older STOP arrives after the UNSTOP');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(pg_temp.consent('b')->>'can_message','true','A delayed STOP older than the START does not re-block');

-- Carrier / other suppressions stay blocking for both staff consent and START.
reset role;
insert into public.communication_suppressions(channel,recipient,reason) values ('SMS','+13035550203','provider_bounced');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select ok(pg_temp.ct('ev-c-start','msg-c-start','+13035550203','START',now()),'C START ingested');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(pg_temp.consent('c')->>'block_reason','undeliverable','START does not lift a carrier suppression');
select lives_ok($$select public.record_sms_consent(auth.uid(),(select id from fx where kind='c'),'+13035550203',true,'WRITTEN','Synthetic renewed consent C',(pg_temp.consent('c')->>'updated_at')::timestamptz)$$,'Staff records consent on a bounced number');
select is(pg_temp.consent('c')->>'block_reason','undeliverable','Staff consent does not lift a carrier suppression');
select is((select count(*)::int from public.sms_suppression_events where recipient='+13035550203'),0,'Nothing is lifted or audited for carrier suppressions');
select is((select reason from public.communication_suppressions where recipient='+13035550203'),'provider_bounced','Carrier suppression unchanged');

-- Audit is staff-readable and append-only; anonymous callers cannot read it.
select ok((select count(*) from public.sms_suppression_events)>0,'Active staff can read the SMS suppression audit');
select throws_ok($$update public.sms_suppression_events set note='x'$$,'42501',null,'Staff cannot modify the audit');
reset role;
select throws_ok($$update public.sms_suppression_events set note='tamper'$$,'23514',null,'Audit rows are append-only even for the owner');
select throws_ok($$delete from public.sms_suppression_events$$,'23514',null,'Audit rows cannot be deleted');
set local role anon;
select throws_ok($$select count(*) from public.sms_suppression_events$$,'42501',null,'Anonymous cannot read the audit');
reset role;

-- Internal helpers are not callable by API roles.
set local role authenticated;
select throws_ok($$select public.sms_lift_opt_out_internal('+13035550203','staff_consent',now(),null,null,null,auth.uid(),null)$$,'42501',null,'Staff cannot call the lift helper directly');
select throws_ok($$select public.sms_reconcile_opt_outs_internal()$$,'42501',null,'Staff cannot call reconciliation');
reset role;
set local role service_role;
select throws_ok($$select public.sms_apply_start_keyword_internal('+13035550203',now(),'cloudtalk','forged')$$,'42501',null,'Service role cannot call the START helper directly');
reset role;

-- Reconciliation of legacy STOP rows (no occurred_at) written before this migration.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fx select 'd',id from public.save_client(auth.uid(),null,null,'Legacy','Keyword','+13035550204','fixture-8310@example.test','SMS',null,null);
insert into fx select 'e',id from public.save_client(auth.uid(),null,null,'Legacy','Staff','+13035550205','fixture-9144@example.test','SMS',null,null);
insert into fx select 'f',id from public.save_client(auth.uid(),null,null,'Legacy','Stopped','+13035550206','fixture-3107@example.test','SMS',null,null);
reset role;
-- D: STOP -> START -> staff consent (the production case).
insert into public.cloudtalk_messages(message_id,direction,channel,external_number,internal_number,body,occurred_at) values
 ('legacy-d-stop','inbound','sms','+13035550204','+17207646677','STOP',now()-interval '3 hours'),
 ('legacy-d-start','inbound','sms','+13035550204','+17207646677','START',now()-interval '2 hours'),
 ('legacy-e-stop','inbound','sms','+13035550205','+17207646677','stop',now()-interval '3 hours'),
 ('legacy-f-start-early','inbound','sms','+13035550206','+17207646677','START',now()-interval '4 hours'),
 ('legacy-f-stop','inbound','sms','+13035550206','+17207646677','STOP',now()-interval '3 hours');
insert into public.communication_suppressions(channel,recipient,reason,created_at) values
 ('SMS','+13035550204','cloudtalk_sms_stop',now()-interval '3 hours'),
 ('SMS','+13035550205','cloudtalk_sms_stop',now()-interval '3 hours'),
 ('SMS','+13035550206','cloudtalk_sms_stop',now()-interval '3 hours');
insert into public.sms_consent(client_id,phone_number,opted_in,opted_in_at,consent_method,consent_details) values
 ((select id from fx where kind='d'),'+13035550204',true,now()-interval '1 hour','WRITTEN','Synthetic staff consent after START'),
 ((select id from fx where kind='e'),'+13035550205',true,now()-interval '1 hour','VERBAL','Synthetic staff consent after STOP'),
 ((select id from fx where kind='f'),'+13035550206',false,now()-interval '5 hours','WRITTEN','Synthetic consent before STOP');
update public.sms_consent set opted_out_at=now()-interval '3 hours' where client_id=(select id from fx where kind='f');
insert into public.audit_logs(user_id,action,table_name,record_id) select '97000000-0000-4000-8000-000000000001','UPDATE','sms_consent',id from public.sms_consent where client_id=(select id from fx where kind='e');
select is(public.sms_reconcile_opt_outs_internal(),2,'Reconciliation lifts the two STOPs that were followed by START or staff consent');
select is((select count(*)::int from public.communication_suppressions where recipient in ('+13035550204','+13035550205')),0,'Reconciled suppressions are removed');
select is((select source||':'||provider_message_id||':'||note from public.sms_suppression_events where recipient='+13035550204' and action='lifted'),'sms_keyword:legacy-d-start:Reconciled by migration 20260930100000','Keyword reconciliation is audited with the START message');
select is((select consent_method::text from public.sms_consent where client_id=(select id from fx where kind='d')),'WRITTEN','Newer staff consent is not overwritten by the older START');
select is((select source||':'||actor_id from public.sms_suppression_events where recipient='+13035550205' and action='lifted'),'staff_consent:97000000-0000-4000-8000-000000000001','Staff-consent reconciliation is audited with the recorded actor');
select is((select occurred_at from public.communication_suppressions where recipient='+13035550206'),now()-interval '3 hours','Remaining legacy STOP is dated by its message');
select is((select provider_message_id from public.communication_suppressions where recipient='+13035550206'),'legacy-f-stop','Remaining legacy STOP records its message');
select is(public.sms_reconcile_opt_outs_internal(),0,'Reconciliation is idempotent; a START before the STOP does not count');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(pg_temp.consent('d')->>'can_message','true','Production-shaped household can be texted after reconciliation');
select is(pg_temp.consent('e')->>'can_message','true','Staff-consented legacy household can be texted after reconciliation');
select is(pg_temp.consent('f')->>'block_reason','sms_stop','Legacy STOP without a later START stays blocked');
reset role;

select * from finish();
rollback;
