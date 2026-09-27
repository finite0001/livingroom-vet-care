begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id, email, raw_user_meta_data) values
('62000000-0000-4000-8000-000000000001', 'cloudtalk-staff@example.test', '{"first_name":"Phone","last_name":"Staff"}'),
('62000000-0000-4000-8000-000000000002', 'cloudtalk-admin@example.test', '{"first_name":"Phone","last_name":"Admin"}');
update public.profiles set is_active = true where id in ('62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000002');
insert into public.user_roles(user_id, role) values
('62000000-0000-4000-8000-000000000001', 'STAFF'), ('62000000-0000-4000-8000-000000000002', 'ADMIN');

insert into public.clients(id, first_name, last_name, full_name, primary_phone, preferred_channel) values
('62100000-0000-4000-8000-000000000001', 'Matched', 'Family', 'Matched Family', '+1 (720) 555-0101', 'SMS'),
('62100000-0000-4000-8000-000000000002', 'Shared', 'One', 'Shared One', '+17205550102', 'SMS'),
('62100000-0000-4000-8000-000000000003', 'Shared', 'Two', 'Shared Two', '+17205550102', 'SMS');

create function pg_temp.ingest(p_event text, p_type text, p_at timestamptz, p_data jsonb) returns boolean language plpgsql as $$
declare result boolean;
begin
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  result := public.ingest_cloudtalk_event(p_event, p_type, p_at, p_data);
  reset role;
  return result;
end $$;

-- Privileges: projection is internal; only the admin retry is callable by staff.
select ok(not has_function_privilege('authenticated', 'public.project_cloudtalk_source(text)', 'EXECUTE'), 'Staff cannot project CloudTalk sources directly');
select ok(not has_function_privilege('service_role', 'public.project_cloudtalk_source(text)', 'EXECUTE'), 'Service role cannot bypass ingestion to project');
select ok(not has_function_privilege('anon', 'public.retry_cloudtalk_projections(integer)', 'EXECUTE'), 'Anonymous callers cannot retry projections');
select ok(has_function_privilege('authenticated', 'public.retry_cloudtalk_projections(integer)', 'EXECUTE'), 'Staff sessions reach the admin-gated retry');
select ok(not has_table_privilege('anon', 'public.cloudtalk_projection_failures', 'SELECT'), 'Anonymous callers cannot read projection failures');
select ok(not has_table_privilege('authenticated', 'public.communication_inbound', 'INSERT'), 'Staff cannot forge inbound CloudTalk entries');

-- Matched inbound SMS threads into the household conversation.
select ok(pg_temp.ingest('evt-sms-1', 'message.received', '2026-09-27 15:00:00+00',
  '{"id":"ct-msg-1","channel":"sms","body":"Is Luna due for her visit?","external_number":"+17205550101","internal_number":{"number_e164":"+17207646677"}}'),
  'Inbound CloudTalk SMS accepted');
select is((select count(*) from public.messages where provider = 'cloudtalk' and provider_message_id = 'message:ct-msg-1'), 1::bigint, 'Inbound SMS projected once');
select results_eq(
  $$select m.type::text, m.sender_type::text, m.content, m.created_at, c.client_id from public.messages m join public.conversations c on c.id = m.conversation_id where m.provider_message_id = 'message:ct-msg-1'$$,
  $$values ('SMS', 'CLIENT', 'Is Luna due for her visit?', timestamptz '2026-09-27 15:00:00+00', '62100000-0000-4000-8000-000000000001'::uuid)$$,
  'Inbound SMS lands in the matched household thread at its CloudTalk time');
select results_eq(
  $$select direction, channel, sender, recipient, review_reason, event_id is null, message_id is not null from public.communication_inbound where provider = 'cloudtalk' and resource_id = 'message:ct-msg-1'$$,
  $$values ('inbound', 'SMS', '+17205550101', '+17207646677', null::text, true, true)$$,
  'Projection is recorded as a matched CloudTalk inbound entry');
select is((select is_read from public.conversations where client_id = '62100000-0000-4000-8000-000000000001'), false, 'Inbound CloudTalk text marks the thread unread');

-- Webhook replays and re-deliveries under a new event id never duplicate.
select is(pg_temp.ingest('evt-sms-1', 'message.received', '2026-09-27 15:00:00+00',
  '{"id":"ct-msg-1","channel":"sms","body":"Is Luna due for her visit?","external_number":"+17205550101","internal_number":{"number_e164":"+17207646677"}}'),
  false, 'Replay of the same event is ignored');
select ok(pg_temp.ingest('evt-sms-1-redelivered', 'message.received', '2026-09-27 15:00:00+00',
  '{"id":"ct-msg-1","channel":"sms","body":"Is Luna due for her visit?","external_number":"+17205550101","internal_number":{"number_e164":"+17207646677"}}'),
  'Re-delivery under a new event id is accepted');
select is((select count(*) from public.messages where provider_message_id = 'message:ct-msg-1'), 1::bigint, 'Re-delivery does not duplicate the thread entry');
select is((select count(*) from public.communication_inbound where resource_id = 'message:ct-msg-1'), 1::bigint, 'Re-delivery does not duplicate the projection');

-- Outbound text sent from CloudTalk Phone appears as staff activity.
select ok(pg_temp.ingest('evt-sms-2', 'message.sent', '2026-09-27 15:05:00+00',
  '{"id":"ct-msg-2","channel":"sms","body":"Yes, see you Tuesday.","external_number":"+17205550101","internal_number":{"number_e164":"+17207646677"}}'), 'Outbound CloudTalk SMS accepted');
select results_eq($$select type::text, sender_type::text from public.messages where provider_message_id = 'message:ct-msg-2'$$,
  $$values ('SMS', 'STAFF')$$, 'Outbound CloudTalk text is staff activity in the same thread');
select is((select count(distinct conversation_id) from public.messages where provider = 'cloudtalk'), 1::bigint, 'Inbound and outbound texts share the household thread');

-- Unknown and shared numbers wait in the review queue.
select ok(pg_temp.ingest('evt-sms-3', 'message.received', '2026-09-27 15:10:00+00',
  '{"id":"ct-msg-3","channel":"sms","body":"New client question","external_number":"+17205550199","internal_number":{"number_e164":"+17207646677"}}'), 'Unknown sender accepted');
select results_eq($$select message_id is null, client_id is null, review_reason from public.communication_inbound where resource_id = 'message:ct-msg-3'$$,
  $$values (true, true, 'Unknown or shared sender')$$, 'Unknown sender waits for review');
select ok(pg_temp.ingest('evt-sms-4', 'message.received', '2026-09-27 15:11:00+00',
  '{"id":"ct-msg-4","channel":"sms","body":"Shared phone","external_number":"+17205550102","internal_number":{"number_e164":"+17207646677"}}'), 'Shared sender accepted');
select is((select review_reason from public.communication_inbound where resource_id = 'message:ct-msg-4'), 'Unknown or shared sender', 'Shared household number is never guessed');
select is((select count(*) from public.messages where provider_message_id in ('message:ct-msg-3', 'message:ct-msg-4')), 0::bigint, 'Unmatched texts create no thread entries');

-- Calls: AI data before call.ended is not shown alone; call.ended projects once.
select ok(pg_temp.ingest('evt-call-1-ai', 'cidata.ready', '2026-09-27 16:00:00+00',
  '{"call_uuid":"call-1","summary":{"summary":"Caller asked about hours."},"language":"en"}'), 'AI event before call.ended accepted');
select is((select count(*) from public.communication_inbound where resource_id = 'call:call-1'), 0::bigint, 'Partial call data is not projected');
select ok(pg_temp.ingest('evt-call-1-end', 'call.ended', '2026-09-27 16:01:00+00',
  '{"call_uuid":"call-1","call_id":"101","direction":"incoming","external_number":"+17205550101","internal_number":{"number_e164":"+17207646677"},"started_at":"2026-09-27T15:59:00Z","ended_at":"2026-09-27T16:00:30Z","duration":44,"talking_time":0,"waiting_time":44,"is_voicemail":false}'),
  'Missed call accepted');
select is((select talking_seconds from public.cloudtalk_calls where call_uuid = 'call-1'), 0, 'Talking time is captured from call.ended');
select results_eq($$select type::text, sender_type::text, content, created_at from public.messages where provider_message_id = 'call:call-1'$$,
  $$values ('CALL_INBOUND', 'CLIENT', 'Missed incoming call', timestamptz '2026-09-27 15:59:00+00')$$, 'Missed call threads as a client call entry');
select ok(pg_temp.ingest('evt-call-1-rec', 'call.recording_ready', '2026-09-27 16:02:00+00', '{"call_uuid":"call-1"}'), 'Recording event accepted');
select is((select count(*) from public.messages where provider_message_id = 'call:call-1'), 1::bigint, 'Later call lifecycle events do not duplicate the entry');

select ok(pg_temp.ingest('evt-call-2-end', 'call.ended', '2026-09-27 17:05:00+00',
  '{"call_uuid":"call-2","call_id":"102","direction":"outgoing","external_number":"+17205550101","internal_number":{"number_e164":"+17207646677"},"started_at":"2026-09-27T17:00:00Z","ended_at":"2026-09-27T17:02:10Z","duration":130,"talking_time":125,"is_voicemail":false}'), 'Outgoing call accepted');
select results_eq($$select type::text, sender_type::text, content from public.messages where provider_message_id = 'call:call-2'$$,
  $$values ('CALL_OUTBOUND', 'STAFF', 'Outgoing call · 2m 05s')$$, 'Answered outgoing call shows talk time');

select ok(pg_temp.ingest('evt-call-3-end', 'call.ended', '2026-09-27 18:05:00+00',
  '{"call_uuid":"call-3","call_id":"103","direction":"incoming","external_number":"+17205550101","internal_number":{"number_e164":"+17207646677"},"started_at":"2026-09-27T18:00:00Z","ended_at":"2026-09-27T18:01:00Z","duration":58,"talking_time":0,"is_voicemail":true}'), 'Voicemail accepted');
select results_eq($$select type::text, content from public.messages where provider_message_id = 'call:call-3'$$,
  $$values ('VOICEMAIL', 'Voicemail · 58s')$$, 'Voicemail threads with its length');

select ok(pg_temp.ingest('evt-call-4-end', 'call.ended', '2026-09-27 18:10:00+00',
  '{"call_uuid":"call-4","call_id":"104","direction":"internal","external_number":"+17205550101","internal_number":{"number_e164":"+17207646677"},"started_at":"2026-09-27T18:08:00Z","ended_at":"2026-09-27T18:09:00Z","duration":60,"is_voicemail":false}'), 'Internal call accepted');
select is((select count(*) from public.communication_inbound where resource_id = 'call:call-4'), 0::bigint, 'Internal staff legs are not client contact');

select ok(pg_temp.ingest('evt-call-5-end', 'call.ended', '2026-09-27 18:20:00+00',
  '{"call_uuid":"call-5","call_id":"105","direction":"incoming","caller_id_status":"withheld","internal_number":{"number_e164":"+17207646677"},"started_at":"2026-09-27T18:18:00Z","ended_at":"2026-09-27T18:19:00Z","duration":20,"talking_time":10,"is_voicemail":false}'), 'Withheld call accepted');
select results_eq($$select sender, review_reason, message_id is null from public.communication_inbound where resource_id = 'call:call-5'$$,
  $$values ('withheld', 'Caller number withheld', true)$$, 'Withheld caller waits for review');

-- Originals and projections are immutable.
select throws_ok($$update public.cloudtalk_messages set body = 'changed' where message_id = 'ct-msg-1'$$, '23514', null, 'CloudTalk message originals are immutable');
select throws_ok($$delete from public.cloudtalk_events where event_id = 'evt-sms-1'$$, '23514', null, 'CloudTalk event receipts cannot be deleted');
select throws_ok($$delete from public.cloudtalk_calls where call_uuid = 'call-1'$$, '23514', null, 'CloudTalk calls cannot be deleted');
select throws_ok($$update public.communication_inbound set body = 'changed' where resource_id = 'message:ct-msg-3'$$, '23514', null, 'CloudTalk review entries are immutable');
select throws_ok($$delete from public.communication_inbound where resource_id = 'message:ct-msg-3'$$, '23514', null, 'CloudTalk review entries cannot be deleted');
select throws_ok($$update public.messages set content = 'changed' where provider_message_id = 'message:ct-msg-1'$$, '23514', null, 'Threaded CloudTalk entries are immutable');

-- Staff read the projection; recording access policy is unchanged.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"62000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*) from public.communication_inbound where provider = 'cloudtalk'), 8::bigint, 'Active staff read CloudTalk inbox entries');
select is((select count(*) from public.cloudtalk_calls where call_uuid = 'call-1'), 1::bigint, 'Active staff read trusted call details for the thread');
select throws_ok($$select * from public.retry_cloudtalk_projections(10)$$, '42501', null, 'Non-admin staff cannot retry projections');
reset role;
select ok((select qual from pg_policies where tablename = 'cloudtalk_calls' and policyname = 'Active staff read CloudTalk calls') like '%trusted_number%', 'Call read policy still requires a trusted number');

-- Review assignment keeps CloudTalk identity, time and direction.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"62000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$select public.assign_inbound_communication(auth.uid(), (select id from public.communication_inbound where resource_id = 'message:ct-msg-4'), 1,
  '62100000-0000-4000-8000-000000000002', (select public.ensure_active_conversation('62100000-0000-4000-8000-000000000002')).id, 'Confirmed by phone callback')$$, 'Staff assign a shared-number CloudTalk text');
reset role;
select results_eq($$select type::text, sender_type::text, provider, created_at from public.messages where provider_message_id = 'message:ct-msg-4'$$,
  $$values ('SMS', 'CLIENT', 'cloudtalk', timestamptz '2026-09-27 15:11:00+00')$$, 'Assigned CloudTalk text keeps its provider key and time');

-- A projection that cannot be written does not reject the webhook. Capability
-- text no longer blocks projection (20260928160000 redacts it at ingest), so a
-- test-only thread guard forces the failure here; it is rolled back with the test.
create function public.test_block_cloudtalk_projection() returns trigger language plpgsql as $$
begin raise exception 'Blocked for test' using errcode = '23514'; end $$;
create trigger test_block_cloudtalk_projection before insert on public.messages
  for each row when (NEW.content = 'Projection blocked for test') execute function public.test_block_cloudtalk_projection();
select ok(pg_temp.ingest('evt-sms-5', 'message.received', '2026-09-27 19:00:00+00',
  jsonb_build_object('id', 'ct-msg-5', 'channel', 'sms', 'body', 'Projection blocked for test', 'external_number', '+17205550101', 'internal_number', jsonb_build_object('number_e164', '+17207646677'))),
  'Webhook still succeeds when projection is blocked');
select is((select count(*) from public.cloudtalk_messages where message_id = 'ct-msg-5'), 1::bigint, 'Original is preserved when projection fails');
select results_eq($$select sqlstate, attempts from public.cloudtalk_projection_failures where resource_id = 'message:ct-msg-5'$$,
  $$values ('23514', 1)$$, 'Projection failure is recorded without content');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"62000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select results_eq($$select projected, still_failing from public.retry_cloudtalk_projections(10)$$, $$values (0, 1)$$, 'Admin retry reports the still-blocked source');
reset role;

-- Retry covers recorded failures only; non-contact sources (internal call-4,
-- recorded earlier than ct-msg-5) never use up the retry batch.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"62000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select results_eq($$select projected, still_failing from public.retry_cloudtalk_projections(1)$$, $$values (0, 1)$$, 'Retry batch reaches the failure past earlier internal legs');
reset role;

-- Texts the app sent through CloudTalk are not duplicated by their message.sent echo.
insert into public.messages(id, conversation_id, type, sender_type, sender_id, content, is_internal, created_at) values
('62200000-0000-4000-8000-000000000001', (select conversation_id from public.messages where provider_message_id = 'message:ct-msg-1'), 'SMS', 'STAFF',
 '62000000-0000-4000-8000-000000000001', 'Your visit is confirmed for Tuesday.', false, '2026-09-26 20:00:00+00'),
('62200000-0000-4000-8000-000000000002', (select conversation_id from public.messages where provider_message_id = 'message:ct-msg-1'), 'SMS', 'STAFF',
 '62000000-0000-4000-8000-000000000001', 'Queued reminder text.', false, '2026-09-26 21:00:00+00');
insert into public.communication_outbox(request_id, conversation_id, client_id, message_id, created_by, channel, recipient, body, provider, state, first_attempt_at, created_at)
select gen_random_uuid(), m.conversation_id, '62100000-0000-4000-8000-000000000001', m.id, '62000000-0000-4000-8000-000000000001', 'SMS', '+17205550101', m.content, 'twilio', 'accepted', '2026-09-26 20:00:05+00', '2026-09-26 20:00:00+00'
from public.messages m where m.id = '62200000-0000-4000-8000-000000000001';
insert into public.outbound_deliveries(idempotency_key, channel, recipient, payload, client_id, conversation_id, message_id, status, accepted_at, created_at)
select 'staff:sms:test-echo', 'SMS', '+1 720 555 0101', jsonb_build_object('kind', 'staff_message', 'body', m.content), '62100000-0000-4000-8000-000000000001', m.conversation_id, m.id, 'ACCEPTED', '2026-09-26 21:00:03+00', '2026-09-26 21:00:00+00'
from public.messages m where m.id = '62200000-0000-4000-8000-000000000002';
select ok(pg_temp.ingest('evt-echo-1', 'message.sent', '2026-09-26 20:00:09+00',
  '{"id":"ct-echo-1","channel":"sms","body":"Your visit is confirmed for Tuesday.","external_number":"+17205550101","internal_number":{"number_e164":"+17207646677"}}'), 'Echo of an app outbox send accepted');
select is((select count(*) from public.communication_inbound where resource_id = 'message:ct-echo-1'), 0::bigint, 'Outbox send echo is not projected');
select is((select count(*) from public.messages where content = 'Your visit is confirmed for Tuesday.'), 1::bigint, 'Outbox send appears once in the thread');
select is((select count(*) from public.cloudtalk_projection_failures where resource_id = 'message:ct-echo-1'), 0::bigint, 'Absorbed echo is not a failure');
select ok(pg_temp.ingest('evt-echo-2', 'message.sent', '2026-09-26 21:00:07+00',
  '{"id":"ct-echo-2","channel":"sms","body":"Queued reminder text.","external_number":"+17205550101","internal_number":{"number_e164":"+17207646677"}}'), 'Echo of an outbound delivery accepted');
select is((select count(*) from public.messages where content = 'Queued reminder text.'), 1::bigint, 'Outbound delivery echo is not duplicated');
select ok(pg_temp.ingest('evt-echo-3', 'message.sent', '2026-09-26 20:10:00+00',
  '{"id":"ct-echo-3","channel":"sms","body":"Your visit is confirmed for Tuesday.","external_number":"+17205550101","internal_number":{"number_e164":"+17207646677"}}'), 'Identical text typed in CloudTalk Phone accepted');
select is((select count(*) from public.messages where provider_message_id = 'message:ct-echo-3'), 1::bigint, 'A second identical CloudTalk Phone text is still shown');
select ok(pg_temp.ingest('evt-echo-4', 'message.sent', '2026-09-26 23:30:00+00',
  '{"id":"ct-echo-4","channel":"sms","body":"Your visit is confirmed for Tuesday.","external_number":"+17205550101","internal_number":{"number_e164":"+17207646677"}}'), 'Same text hours later accepted');
select is((select count(*) from public.messages where provider_message_id = 'message:ct-echo-4'), 1::bigint, 'Text outside the send window is shown');

-- Staff sessions cannot forge or squat CloudTalk thread entries.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"62000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$insert into public.messages(conversation_id, type, sender_type, content, is_internal, provider, provider_message_id)
  values ((select conversation_id from public.messages where provider_message_id = 'message:ct-msg-1'), 'SMS', 'CLIENT', 'forged', false, 'cloudtalk', 'message:ct-future')$$,
  '42501', null, 'Staff cannot insert a CloudTalk-keyed thread entry');
reset role;

select * from finish();
rollback;
