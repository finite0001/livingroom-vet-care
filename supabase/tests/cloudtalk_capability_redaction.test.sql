begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id, email, raw_user_meta_data) values
('63000000-0000-4000-8000-000000000001', 'redaction-staff@example.test', '{"first_name":"Redaction","last_name":"Staff"}');
update public.profiles set is_active = true where id = '63000000-0000-4000-8000-000000000001';
insert into public.user_roles(user_id, role) values ('63000000-0000-4000-8000-000000000001', 'STAFF');
insert into public.clients(id, first_name, last_name, full_name, primary_phone, preferred_channel,primary_email) values
('63100000-0000-4000-8000-000000000001', 'Linked', 'Family', 'Linked Family', '+17205550301', 'SMS','fixture-6018@example.test');

create function pg_temp.ingest(p_event text, p_type text, p_at timestamptz, p_data jsonb) returns boolean language plpgsql as $$
declare result boolean;
begin
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  result := public.ingest_cloudtalk_event(p_event, p_type, p_at, p_data);
  reset role;
  return result;
end $$;
create function pg_temp.text_message(p_id text, p_body text) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'channel', 'sms', 'body', p_body, 'external_number', '+17205550301', 'internal_number', jsonb_build_object('number_e164', '+17207646677'))
$$;
create function pg_temp.tail() returns text language sql as $$ select 'Ab_-' || repeat('x', 39) $$;
create function pg_temp.doc_url() returns text language sql as $$
  select 'https://app.example/shared/3f1c2a4b-5d6e-4f70-8a91-b2c3d4e5f607#v1.' || pg_temp.tail()
$$;

-- Privileges: redaction helpers and the stored-row redaction are owner-only.
select ok(not has_function_privilege('authenticated', 'public.redact_stored_cloudtalk_capabilities()', 'EXECUTE'), 'Staff cannot run stored-capability redaction');
select ok(not has_function_privilege('service_role', 'public.redact_stored_cloudtalk_capabilities()', 'EXECUTE'), 'Service role cannot run stored-capability redaction');
select ok(not has_function_privilege('anon', 'public.redact_private_capabilities(text)', 'EXECUTE'), 'Anonymous callers cannot reach the redaction helper');
select ok(not has_table_privilege('authenticated', 'public.cloudtalk_capability_redactions', 'INSERT'), 'Staff cannot write the redaction audit');
select ok(not has_table_privilege('anon', 'public.cloudtalk_capability_redactions', 'SELECT'), 'Anonymous callers cannot read the redaction audit');

-- Recognition and placeholders.
select is(public.redact_private_capabilities('Docs: ' || pg_temp.doc_url()), 'Docs: [secure document link]', 'Whole document URL becomes the placeholder');
select is(public.redact_private_capabilities('Pay https://app.example/pay/3f1c2a4b-5d6e-4f70-8a91-b2c3d4e5f607#p1.' || pg_temp.tail() || '.'), 'Pay [secure payment link].', 'Payment collection URL becomes the payment placeholder');
select is(public.redact_private_capabilities('s1.' || pg_temp.tail() || ' e1.' || pg_temp.tail()), '[secure payment link] [secure estimate link]', 'Bare status and estimate tokens are redacted');
select is(public.redact_private_capabilities('https://app.example/shared/3f1c2a4b-5d6e-4f70-8a91-b2c3d4e5f607'), 'https://app.example/shared/3f1c2a4b-5d6e-4f70-8a91-b2c3d4e5f607', 'Grant URL without a token is left as written');
select is(public.redact_private_capabilities('version v1.2.3'), 'version v1.2.3', 'Ordinary text is unchanged');
select is(public.cloudtalk_app_send_text('Your documents: {{document_link}}'), 'Your documents: [secure document link]', 'App document template maps to its echo text');
select ok(public.redact_private_capabilities('x' || 'v1.' || pg_temp.tail() || 'p1.' || pg_temp.tail() || repeat('z', 10)) !~ '(v1|p1|s1)\.[A-Za-z0-9_-]{43}', 'Redacted text never trips the persistence guard');

-- Redaction on ingest: inbound text carrying a document link.
select ok(pg_temp.ingest('evt-red-1', 'message.received', '2026-09-27 15:00:00+00', pg_temp.text_message('ct-red-1', 'Is this right? ' || pg_temp.doc_url())), 'Inbound text with a capability is accepted');
select is((select body from public.cloudtalk_messages where message_id = 'ct-red-1'), 'Is this right? [secure document link]', 'Original is stored redacted');
select is((select content from public.messages where provider_message_id = 'message:ct-red-1'), 'Is this right? [secure document link]', 'Redacted text projects into the household thread');
select is((select count(*) from public.cloudtalk_projection_failures where resource_id = 'message:ct-red-1'), 0::bigint, 'Redacted text is not a projection failure');

-- A document link sent from CloudTalk Phone (no app send) is a normal outbound entry.
select ok(pg_temp.ingest('evt-red-2', 'message.sent', '2026-09-27 15:10:00+00', pg_temp.text_message('ct-red-2', 'Here you go: ' || pg_temp.doc_url())), 'CloudTalk Phone text with a document link accepted');
select results_eq($$select type::text, sender_type::text, content from public.messages where provider_message_id = 'message:ct-red-2'$$,
  $$values ('SMS', 'STAFF', 'Here you go: [secure document link]')$$, 'Outbound document-link text shows the placeholder');

-- The echo of an app-sent document-link text is matched to its outbox row.
insert into public.messages(id, conversation_id, type, sender_type, sender_id, content, is_internal, created_at) values
('63200000-0000-4000-8000-000000000001', (select conversation_id from public.messages where provider_message_id = 'message:ct-red-1'), 'SMS', 'STAFF',
 '63000000-0000-4000-8000-000000000001', 'Your documents from The Living Room Veterinary Care: {{document_link}}', false, '2026-09-27 16:00:00+00');
insert into public.communication_outbox(request_id, conversation_id, client_id, message_id, created_by, channel, recipient, body, provider, state, first_attempt_at, created_at)
select gen_random_uuid(), m.conversation_id, '63100000-0000-4000-8000-000000000001', m.id, '63000000-0000-4000-8000-000000000001', 'SMS', '+17205550301', m.content, 'cloudtalk', 'accepted', '2026-09-27 16:00:04+00', '2026-09-27 16:00:00+00'
from public.messages m where m.id = '63200000-0000-4000-8000-000000000001';
select ok(pg_temp.ingest('evt-red-3', 'message.sent', '2026-09-27 16:00:09+00',
  pg_temp.text_message('ct-red-3', 'Your documents from The Living Room Veterinary Care: ' || pg_temp.doc_url())), 'Echo of an app document-link send accepted');
select is((select body from public.cloudtalk_messages where message_id = 'ct-red-3'), 'Your documents from The Living Room Veterinary Care: [secure document link]', 'Echo original is stored redacted');
select is((select count(*) from public.communication_inbound where resource_id = 'message:ct-red-3'), 0::bigint, 'Echo is absorbed by the app send');
select is((select count(*) from public.cloudtalk_projection_failures where resource_id = 'message:ct-red-3'), 0::bigint, 'Echo is not a permanent failure');
select is((select count(*) from public.messages where content like 'Your documents from The Living Room Veterinary Care:%'), 1::bigint, 'The app send appears once in the thread');

-- AI summaries are redacted too.
select ok(pg_temp.ingest('evt-red-call', 'cidata.ready', '2026-09-27 17:00:00+00',
  jsonb_build_object('call_uuid', 'call-red-1', 'summary', jsonb_build_object('summary', 'Client read back ' || pg_temp.doc_url()), 'language', 'en')), 'AI summary with a capability accepted');
select is((select ai_summary from public.cloudtalk_calls where call_uuid = 'call-red-1'), 'Client read back [secure document link]', 'AI summary is stored redacted');

-- The guard still blocks unredacted tokens wherever redaction is bypassed.
select throws_ok(format($$insert into public.messages(conversation_id, type, sender_type, content, is_internal) values (%L, 'SMS', 'STAFF', %L, false)$$,
  (select conversation_id from public.messages where provider_message_id = 'message:ct-red-1'), 'raw ' || pg_temp.doc_url()), '23514', null, 'Thread messages still reject a raw capability');
select throws_ok(format($$insert into public.communication_inbound(provider, resource_id, channel, direction, sender, recipient, subject, body, occurred_at) values ('cloudtalk', 'message:ct-raw', 'SMS', 'inbound', '+17205550301', '+17207646677', '', %L, now())$$,
  'raw ' || pg_temp.doc_url()), '23514', null, 'Inbound projection still rejects a raw capability');
alter table public.cloudtalk_messages disable trigger redact_cloudtalk_capabilities;
select throws_ok(format($$insert into public.cloudtalk_messages(message_id, direction, channel, external_number, internal_number, body, occurred_at) values ('ct-raw-guard', 'inbound', 'sms', '+17205550301', '+17207646677', %L, now())$$,
  'raw ' || pg_temp.doc_url()), '23514', null, 'CloudTalk originals reject a raw capability if redaction is bypassed');
alter table public.cloudtalk_messages enable trigger redact_cloudtalk_capabilities;

-- Only redaction may change a stored original.
select throws_ok($$update public.cloudtalk_messages set body = 'changed' where message_id = 'ct-red-1'$$, '23514', null, 'Originals stay immutable');
select throws_ok($$update public.cloudtalk_messages set occurred_at = occurred_at + interval '1 minute', body = public.redact_private_capabilities(body) where message_id = 'ct-red-1'$$, '23514', null, 'Redaction cannot carry another change');
select throws_ok($$update public.cloudtalk_messages set body = body where message_id = 'ct-red-1'$$, '23514', null, 'A no-op rewrite is still refused');

-- Backfill: originals stored before redaction existed. Their projection failed
-- under 20260928110000 and left a failure row, reproduced here.
alter table public.cloudtalk_messages disable trigger redact_cloudtalk_capabilities;
alter table public.cloudtalk_messages disable trigger reject_document_capability;
alter table public.cloudtalk_messages disable trigger project_cloudtalk_message;
insert into public.cloudtalk_messages(message_id, direction, channel, external_number, internal_number, body, occurred_at)
values ('ct-legacy-1', 'outbound', 'sms', '+17205550301', '+17207646677', 'Sent before the fix: ' || pg_temp.doc_url(), '2026-09-26 18:00:00+00');
insert into public.cloudtalk_projection_failures(resource_id, sqlstate) values ('message:ct-legacy-1', '23514');
alter table public.cloudtalk_messages enable trigger redact_cloudtalk_capabilities;
alter table public.cloudtalk_messages enable trigger reject_document_capability;
alter table public.cloudtalk_messages enable trigger project_cloudtalk_message;
alter table public.cloudtalk_calls disable trigger redact_cloudtalk_capabilities;
alter table public.cloudtalk_calls disable trigger reject_document_capability;
update public.cloudtalk_calls set ai_summary = 'Legacy summary ' || pg_temp.doc_url() where call_uuid = 'call-red-1';
alter table public.cloudtalk_calls enable trigger redact_cloudtalk_capabilities;
alter table public.cloudtalk_calls enable trigger reject_document_capability;
select is((select count(*) from public.messages where provider_message_id = 'message:ct-legacy-1'), 0::bigint, 'Legacy text was never threaded');

select is(public.redact_stored_cloudtalk_capabilities(), 2, 'Backfill redacts the stored message and summary');
select is((select body from public.cloudtalk_messages where message_id = 'ct-legacy-1'), 'Sent before the fix: [secure document link]', 'Stored message is redacted in place');
select is((select ai_summary from public.cloudtalk_calls where call_uuid = 'call-red-1'), 'Legacy summary [secure document link]', 'Stored summary is redacted in place');
select is((select count(*) from public.cloudtalk_projection_failures where resource_id = 'message:ct-legacy-1'), 0::bigint, 'Backfill clears the failure');
select results_eq($$select sender_type::text, content from public.messages where provider_message_id = 'message:ct-legacy-1'$$,
  $$values ('STAFF', 'Sent before the fix: [secure document link]')$$, 'Backfilled text projects with the placeholder');
select results_eq($$select source, field, redacted_by = current_user from public.cloudtalk_capability_redactions order by id$$,
  $$values ('message:ct-legacy-1', 'body', true), ('call:call-red-1', 'ai_summary', true)$$, 'Each redaction of a stored original is audited');
select is(public.redact_stored_cloudtalk_capabilities(), 0, 'Backfill is idempotent');
select is((select count(*) from public.cloudtalk_capability_redactions), 2::bigint, 'A second run adds no audit rows');
select is((select count(*) from public.cloudtalk_messages where body ~ '(v1|p1|s1|e1)\.[A-Za-z0-9_-]{43}'), 0::bigint, 'No stored CloudTalk text holds a capability');
select throws_ok($$delete from public.cloudtalk_capability_redactions$$, '23514', null, 'Redaction audit is append-only');

-- Active staff can read the audit.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"63000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*) from public.cloudtalk_capability_redactions), 2::bigint, 'Active staff read the redaction audit');
reset role;

select * from finish();
rollback;
