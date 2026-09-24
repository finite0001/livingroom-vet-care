begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.clients (
  id,
  first_name,
  last_name,
  full_name,
  primary_phone,
  preferred_channel
) values (
  '39000000-0000-4000-8000-000000000001',
  'Inbound',
  'Client',
  'Inbound Client',
  '+1 (303) 555-0100',
  'SMS'
);

insert into public.sms_consent (
  client_id,
  phone_number,
  opted_in,
  opted_in_at,
  consent_method
) values (
  '39000000-0000-4000-8000-000000000001',
  '+13035550100',
  true,
  timestamptz '2026-09-20 18:00:00+00',
  'WRITTEN'
);

select has_column('public', 'messages', 'provider', 'Messages store provider for webhook idempotency');
select has_column('public', 'messages', 'provider_message_id', 'Messages store provider message id for webhook idempotency');
select ok(
  has_function_privilege(
    'service_role',
    to_regprocedure('public.record_inbound_sms(text,text,text,text,text,timestamp with time zone)'),
    'EXECUTE'
  ),
  'Service role can execute inbound SMS ingestion'
);
select ok(
  not has_function_privilege(
    'authenticated',
    to_regprocedure('public.record_inbound_sms(text,text,text,text,text,timestamp with time zone)'),
    'EXECUTE'
  ),
  'Staff cannot execute inbound SMS ingestion directly'
);
select ok(
  not has_function_privilege(
    'anon',
    to_regprocedure('public.record_inbound_sms(text,text,text,text,text,timestamp with time zone)'),
    'EXECUTE'
  ),
  'Anonymous callers cannot execute inbound SMS ingestion directly'
);

set local role service_role;
select lives_ok(
  $$select * from public.record_inbound_sms(
      '+1 (303) 555-0100',
      '+1 (303) 555-0199',
      'Running ten minutes late',
      'SM-inbound-001',
      null,
      timestamptz '2026-09-22 19:00:00+00'
    )$$,
  'Inbound SMS from an existing client is ingested'
);
reset role;

select is(
  (select count(*) from public.messages where provider = 'twilio' and provider_message_id = 'SM-inbound-001'),
  1::bigint,
  'Inbound SMS creates one message with provider idempotency key'
);
select is(
  (select sender_type::text from public.messages where provider_message_id = 'SM-inbound-001'),
  'CLIENT',
  'Inbound SMS is recorded as a client message'
);
select is(
  (select type::text from public.messages where provider_message_id = 'SM-inbound-001'),
  'SMS',
  'Inbound SMS preserves the SMS message type'
);
select is(
  (select is_read from public.conversations c join public.messages m on m.conversation_id = c.id where m.provider_message_id = 'SM-inbound-001'),
  false,
  'Inbound SMS marks the conversation unread'
);
select is(
  (select last_message_at from public.conversations c join public.messages m on m.conversation_id = c.id where m.provider_message_id = 'SM-inbound-001'),
  timestamptz '2026-09-22 19:00:00+00',
  'Inbound SMS advances conversation last_message_at'
);

set local role service_role;
select lives_ok(
  $$select * from public.record_inbound_sms(
      '+1 (303) 555-0100',
      '+1 (303) 555-0199',
      'Running ten minutes late',
      'SM-inbound-001',
      null,
      timestamptz '2026-09-22 19:05:00+00'
    )$$,
  'Duplicate inbound SMS webhook is idempotent'
);
reset role;
select is(
  (select count(*) from public.messages where provider = 'twilio' and provider_message_id = 'SM-inbound-001'),
  1::bigint,
  'Duplicate inbound SMS webhook does not create a second message'
);

set local role service_role;
select lives_ok(
  $$select * from public.record_inbound_sms(
      '+1 (303) 555-0100',
      '+1 (303) 555-0199',
      'STOP',
      'SM-inbound-stop',
      null,
      timestamptz '2026-09-22 19:10:00+00'
    )$$,
  'Inbound STOP keyword is ingested'
);
reset role;
select is(
  (select opted_in from public.sms_consent where client_id = '39000000-0000-4000-8000-000000000001' and phone_number = '+13035550100'),
  false,
  'Inbound STOP opts the client phone out'
);
select is(
  (select opted_out_at from public.sms_consent where client_id = '39000000-0000-4000-8000-000000000001' and phone_number = '+13035550100'),
  timestamptz '2026-09-22 19:10:00+00',
  'Inbound STOP stamps opted_out_at'
);
select is(
  (select consent_method::text from public.sms_consent where client_id = '39000000-0000-4000-8000-000000000001' and phone_number = '+13035550100'),
  'SMS_KEYWORD',
  'Inbound STOP records SMS keyword consent method'
);

set local role service_role;
select lives_ok(
  $$select * from public.record_inbound_sms(
      '+1 (303) 555-0100',
      '+1 (303) 555-0199',
      'hello',
      'SM-inbound-start',
      'START',
      timestamptz '2026-09-22 19:20:00+00'
    )$$,
  'Inbound Advanced Opt-Out START parameter is ingested'
);
reset role;
select is(
  (select opted_in from public.sms_consent where client_id = '39000000-0000-4000-8000-000000000001' and phone_number = '+13035550100'),
  true,
  'Inbound START opts the client phone in'
);
select is(
  (select opted_out_at from public.sms_consent where client_id = '39000000-0000-4000-8000-000000000001' and phone_number = '+13035550100'),
  null,
  'Inbound START clears opted_out_at'
);

set local role service_role;
select lives_ok(
  $$select * from public.record_inbound_sms(
      '+1 (303) 555-0999',
      '+1 (303) 555-0199',
      'New household here',
      'SM-inbound-unknown',
      null,
      timestamptz '2026-09-22 19:30:00+00'
    )$$,
  'Inbound SMS from an unknown number creates a placeholder client'
);
reset role;
select is(
  (select count(*) from public.clients where primary_phone = '+13035550999' and full_name = 'Unknown SMS +13035550999'),
  1::bigint,
  'Unknown inbound SMS creates a staff-visible placeholder client'
);
select is(
  (select count(*) from public.messages m join public.conversations c on c.id = m.conversation_id join public.clients cl on cl.id = c.client_id where m.provider_message_id = 'SM-inbound-unknown' and cl.primary_phone = '+13035550999'),
  1::bigint,
  'Unknown inbound SMS is attached to the placeholder client conversation'
);

set local role authenticated;
select throws_ok(
  $$select * from public.record_inbound_sms(
      '+1 (303) 555-0100',
      '+1 (303) 555-0199',
      'forged',
      'SM-forged',
      null,
      now()
    )$$,
  '42501',
  null,
  'Authenticated staff cannot invoke inbound webhook ingestion directly'
);
reset role;

select throws_ok(
  $$select * from public.record_inbound_sms(
      '3035550100',
      '+1 (303) 555-0199',
      'Missing country code',
      'SM-bad-phone',
      null,
      now()
    )$$,
  '23514',
  'Inbound SMS sender phone is invalid',
  'Inbound SMS requires explicit international sender phone'
);
select throws_ok(
  $$select * from public.record_inbound_sms(
      '+1 (303) 555-0100',
      '+1 (303) 555-0199',
      '',
      'SM-empty',
      null,
      now()
    )$$,
  '23514',
  'Inbound SMS body must be between 1 and 1600 characters',
  'Inbound SMS rejects empty bodies'
);

select * from finish();
rollback;
