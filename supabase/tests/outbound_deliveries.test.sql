begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('34000000-0000-4000-8000-000000000001', 'outbound-active@example.test', '{}'),
  ('34000000-0000-4000-8000-000000000002', 'outbound-inactive@example.test', '{}');
update public.profiles set is_active = true where id = '34000000-0000-4000-8000-000000000001';
update public.profiles set is_active = false where id = '34000000-0000-4000-8000-000000000002';
insert into public.user_roles (user_id, role)
values ('34000000-0000-4000-8000-000000000001', 'STAFF')
on conflict do nothing;

insert into public.outbound_deliveries (
  id,
  idempotency_key,
  channel,
  recipient,
  payload,
  requested_by
) values (
  '35000000-0000-4000-8000-000000000001',
  'client-message:35000000-0000-4000-8000-000000000001',
  'SMS',
  '+13035550100',
  '{"body":"Reminder text"}',
  '34000000-0000-4000-8000-000000000001'
);

select is(
  (select status::text from public.outbound_deliveries where id = '35000000-0000-4000-8000-000000000001'),
  'QUEUED',
  'Outbound deliveries default to queued'
);

select throws_ok(
  $$insert into public.outbound_deliveries (idempotency_key, channel, recipient) values ('client-message:35000000-0000-4000-8000-000000000001', 'SMS', '+13035550101')$$,
  '23505',
  null,
  'Channel and idempotency key prevent duplicate queued sends'
);

select throws_ok(
  $$insert into public.outbound_deliveries (idempotency_key, channel, recipient) values ('voice:not-supported', 'VOICE', '+13035550100')$$,
  '23514',
  null,
  'Only SMS and email are queueable in this first slice'
);

select throws_ok(
  $$insert into public.outbound_deliveries (idempotency_key, channel, recipient, payload) values ('bad-payload', 'EMAIL', 'client@example.test', '[]'::jsonb)$$,
  '23514',
  null,
  'Payload must be a JSON object'
);

select throws_ok(
  $$insert into public.outbound_deliveries (idempotency_key, channel, recipient, status) values ('bad-terminal', 'EMAIL', 'client@example.test', 'ACCEPTED')$$,
  '23514',
  null,
  'Accepted deliveries require an accepted timestamp'
);

select ok(not has_table_privilege('anon', 'public.outbound_deliveries', 'SELECT'), 'Anonymous callers have no outbound delivery read grant');
select ok(has_table_privilege('authenticated', 'public.outbound_deliveries', 'SELECT'), 'Authenticated staff have explicit outbound delivery read grant');
select ok(not has_table_privilege('authenticated', 'public.outbound_deliveries', 'INSERT'), 'Staff cannot enqueue outbound deliveries directly');
select ok(not has_table_privilege('authenticated', 'public.outbound_deliveries', 'UPDATE'), 'Staff cannot forge outbound delivery state');
select ok(not has_table_privilege('authenticated', 'public.outbound_deliveries', 'DELETE'), 'Staff cannot delete outbound delivery records');
select ok(has_table_privilege('service_role', 'public.outbound_deliveries', 'INSERT'), 'Service role can enqueue outbound deliveries');
select ok(has_table_privilege('service_role', 'public.outbound_deliveries', 'UPDATE'), 'Service role can advance outbound delivery state');
select ok(not has_table_privilege('service_role', 'public.outbound_deliveries', 'DELETE'), 'Service role cannot erase durable outbound delivery records');
select ok(
  has_function_privilege(
    'service_role',
    to_regprocedure('public.claim_due_outbound_deliveries(text,integer,interval,timestamptz)'),
    'EXECUTE'
  ),
  'Service role can claim outbound delivery work'
);
select ok(
  not has_function_privilege(
    'authenticated',
    to_regprocedure('public.claim_due_outbound_deliveries(text,integer,interval,timestamptz)'),
    'EXECUTE'
  ),
  'Staff cannot execute the outbound delivery worker claim RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    to_regprocedure('public.record_outbound_delivery_result(uuid,text,outbound_delivery_status,text,text,text,text,timestamp with time zone,timestamp with time zone)'),
    'EXECUTE'
  ),
  'Service role can record outbound delivery worker results'
);
select ok(
  not has_function_privilege(
    'authenticated',
    to_regprocedure('public.record_outbound_delivery_result(uuid,text,outbound_delivery_status,text,text,text,text,timestamp with time zone,timestamp with time zone)'),
    'EXECUTE'
  ),
  'Staff cannot execute outbound delivery result recording'
);
select ok(
  has_function_privilege(
    'service_role',
    to_regprocedure('public.record_outbound_delivery_callback(text,text,outbound_delivery_status,text,text,timestamp with time zone)'),
    'EXECUTE'
  ),
  'Service role can record authenticated provider callbacks'
);
select ok(
  not has_function_privilege(
    'authenticated',
    to_regprocedure('public.record_outbound_delivery_callback(text,text,outbound_delivery_status,text,text,timestamp with time zone)'),
    'EXECUTE'
  ),
  'Staff cannot execute provider callback settlement'
);

update public.outbound_deliveries
set scheduled_at = now() + interval '1 day',
  next_attempt_at = now() + interval '1 day'
where id = '35000000-0000-4000-8000-000000000001';

insert into public.outbound_deliveries (
  id,
  idempotency_key,
  channel,
  recipient,
  payload,
  status,
  attempt_count,
  max_attempts,
  scheduled_at,
  next_attempt_at,
  leased_at,
  leased_until,
  lease_owner,
  created_at
) values
  (
    '35000000-0000-4000-8000-000000000002',
    'worker:due-queued-a',
    'SMS',
    '+13035550102',
    '{"body":"Due A"}',
    'QUEUED',
    0,
    3,
    now() - interval '40 minutes',
    now() - interval '40 minutes',
    null,
    null,
    null,
    now() - interval '40 minutes'
  ),
  (
    '35000000-0000-4000-8000-000000000003',
    'worker:due-queued-b',
    'EMAIL',
    'client-b@example.test',
    '{"subject":"Due B"}',
    'QUEUED',
    0,
    3,
    now() - interval '30 minutes',
    now() - interval '30 minutes',
    null,
    null,
    null,
    now() - interval '30 minutes'
  ),
  (
    '35000000-0000-4000-8000-000000000004',
    'worker:future-scheduled',
    'SMS',
    '+13035550104',
    '{"body":"Future schedule"}',
    'QUEUED',
    0,
    3,
    now() + interval '1 hour',
    now() - interval '10 minutes',
    null,
    null,
    null,
    now() - interval '10 minutes'
  ),
  (
    '35000000-0000-4000-8000-000000000005',
    'worker:future-attempt',
    'EMAIL',
    'future-attempt@example.test',
    '{"subject":"Future attempt"}',
    'QUEUED',
    0,
    3,
    now() - interval '10 minutes',
    now() + interval '1 hour',
    null,
    null,
    null,
    now() - interval '10 minutes'
  ),
  (
    '35000000-0000-4000-8000-000000000006',
    'worker:active-lease',
    'SMS',
    '+13035550106',
    '{"body":"Already leased"}',
    'LEASED',
    1,
    3,
    now() - interval '20 minutes',
    now() - interval '20 minutes',
    now() - interval '1 minute',
    now() + interval '30 minutes',
    'active-worker',
    now() - interval '20 minutes'
  ),
  (
    '35000000-0000-4000-8000-000000000007',
    'worker:expired-lease',
    'EMAIL',
    'expired@example.test',
    '{"subject":"Expired lease"}',
    'LEASED',
    1,
    2,
    now() - interval '35 minutes',
    now() - interval '35 minutes',
    now() - interval '20 minutes',
    now() - interval '10 minutes',
    'previous-worker',
    now() - interval '35 minutes'
  ),
  (
    '35000000-0000-4000-8000-000000000008',
    'worker:max-attempts',
    'SMS',
    '+13035550108',
    '{"body":"Exhausted"}',
    'QUEUED',
    3,
    3,
    now() - interval '50 minutes',
    now() - interval '50 minutes',
    null,
    null,
    null,
    now() - interval '50 minutes'
  );

set local role service_role;
select is(
  (select count(*) from public.claim_due_outbound_deliveries('worker-a', 2, interval '10 minutes', now())),
  2::bigint,
  'Worker claims a bounded batch of due queued or expired-lease deliveries'
);
reset role;
select is(
  (select lease_owner from public.outbound_deliveries where id = '35000000-0000-4000-8000-000000000002'),
  'worker-a',
  'First due queued delivery is leased to the claiming worker'
);
select is(
  (select attempt_count from public.outbound_deliveries where id = '35000000-0000-4000-8000-000000000002'),
  1,
  'Claiming a queued delivery records an attempt'
);
select is(
  (select lease_owner from public.outbound_deliveries where id = '35000000-0000-4000-8000-000000000007'),
  'worker-a',
  'Expired leases can be reclaimed'
);
select is(
  (select attempt_count from public.outbound_deliveries where id = '35000000-0000-4000-8000-000000000007'),
  2,
  'Reclaiming an expired lease consumes the final allowed attempt'
);

set local role service_role;
select is(
  (select count(*) from public.claim_due_outbound_deliveries('worker-b', 10, interval '10 minutes', now())),
  1::bigint,
  'Overlapping claims skip actively leased rows and only pick remaining due work'
);
reset role;
select is(
  (select lease_owner from public.outbound_deliveries where id = '35000000-0000-4000-8000-000000000003'),
  'worker-b',
  'Second worker claims only the remaining due queued delivery'
);
select is(
  (select lease_owner from public.outbound_deliveries where id = '35000000-0000-4000-8000-000000000002'),
  'worker-a',
  'Active leases are not stolen by overlapping workers'
);
select is(
  (select lease_owner from public.outbound_deliveries where id = '35000000-0000-4000-8000-000000000006'),
  'active-worker',
  'Pre-existing active leases remain with their current owner'
);

set local role service_role;
select is(
  (select count(*) from public.claim_due_outbound_deliveries('worker-c', 10, interval '10 minutes', now() + interval '11 minutes')),
  2::bigint,
  'Expired worker leases become claimable again but exhausted deliveries stay out of the batch'
);
reset role;
select is(
  (select lease_owner from public.outbound_deliveries where id = '35000000-0000-4000-8000-000000000002'),
  'worker-c',
  'A delivery whose lease expired can be claimed by a later worker'
);
select is(
  (select attempt_count from public.outbound_deliveries where id = '35000000-0000-4000-8000-000000000002'),
  2,
  'Reclaiming after lease expiry records another attempt'
);
select is(
  (select lease_owner from public.outbound_deliveries where id = '35000000-0000-4000-8000-000000000007'),
  'worker-a',
  'Deliveries at max attempts are not reclaimed after their lease expires'
);
select is(
  (select status::text from public.outbound_deliveries where id = '35000000-0000-4000-8000-000000000008'),
  'QUEUED',
  'Queued deliveries at max attempts are not leased'
);
select is(
  (select count(*) from public.outbound_deliveries where id in (
    '35000000-0000-4000-8000-000000000004',
    '35000000-0000-4000-8000-000000000005'
  ) and lease_owner is null),
  2::bigint,
  'Future scheduled or future retry deliveries are not claimed early'
);

set local role service_role;
select throws_ok(
  $$select public.record_outbound_delivery_result(
      '35000000-0000-4000-8000-000000000003',
      'wrong-worker',
      'ACCEPTED',
      'resend',
      'provider-wrong',
      'Wrong worker',
      null,
      null,
      now()
    )$$,
  '40001',
  'Outbound delivery is not actively leased to this worker',
  'Workers cannot complete another worker lease'
);
select lives_ok(
  $$select public.record_outbound_delivery_result(
      '35000000-0000-4000-8000-000000000003',
      'worker-c',
      'ACCEPTED',
      'resend',
      'provider-accepted-003',
      'Provider accepted email request',
      null,
      null,
      now()
    )$$,
  'Worker can record provider acceptance and clear the lease'
);
select lives_ok(
  $$select public.record_outbound_delivery_result(
      '35000000-0000-4000-8000-000000000002',
      'worker-c',
      'QUEUED',
      'twilio',
      null,
      'Transient provider error; retry later',
      'Twilio HTTP 503',
      now() + interval '15 minutes',
      now()
    )$$,
  'Worker can release a leased delivery for retry'
);
select throws_ok(
  $$select public.record_outbound_delivery_result(
      '35000000-0000-4000-8000-000000000006',
      'active-worker',
      'QUEUED',
      'twilio',
      null,
      'Bad retry timestamp',
      'network',
      now() - interval '1 minute',
      now()
    )$$,
  '23514',
  'Retry results require a future next attempt timestamp',
  'Retry results require a future next-attempt timestamp'
);
select lives_ok(
  $$select public.record_outbound_delivery_result(
      '35000000-0000-4000-8000-000000000006',
      'active-worker',
      'FAILED',
      'twilio',
      null,
      'Provider rejected SMS request',
      'Twilio HTTP 400',
      null,
      now()
    )$$,
  'Worker can record terminal provider failure'
);
select throws_ok(
  $$select public.record_outbound_delivery_callback(
      'resend',
      'provider-missing',
      'DELIVERED',
      'Unknown callback',
      null,
      now()
    )$$,
  '40001',
  'Outbound delivery is not callback-eligible',
  'Provider callbacks must match an accepted provider message id'
);
select throws_ok(
  $$select public.record_outbound_delivery_callback(
      'resend',
      'provider-accepted-003',
      'ACCEPTED',
      'Unsupported callback status',
      null,
      now()
    )$$,
  '23514',
  'Unsupported outbound delivery callback status',
  'Provider callbacks cannot re-record worker acceptance'
);
select lives_ok(
  $$select public.record_outbound_delivery_callback(
      'resend',
      'provider-accepted-003',
      'DELIVERED',
      'Resend delivery callback confirmed delivery',
      null,
      timestamptz '2026-09-22 20:00:00+00'
    )$$,
  'Provider callback can mark an accepted delivery as delivered'
);
select lives_ok(
  $$select public.record_outbound_delivery_callback(
      'resend',
      'provider-accepted-003',
      'DELIVERED',
      'Duplicate Resend delivery callback',
      null,
      timestamptz '2026-09-22 20:05:00+00'
    )$$,
  'Duplicate same-status provider callbacks are idempotent'
);
select throws_ok(
  $$select public.record_outbound_delivery_callback(
      'resend',
      'provider-accepted-003',
      'FAILED',
      'Conflicting failure callback',
      'late provider failure',
      timestamptz '2026-09-22 20:10:00+00'
    )$$,
  '40001',
  'Outbound delivery is not callback-eligible',
  'Provider callbacks cannot overwrite a conflicting terminal status'
);
reset role;

select is(
  (select status::text from public.outbound_deliveries where id = '35000000-0000-4000-8000-000000000003'),
  'DELIVERED',
  'Provider callback advances accepted outbound delivery to delivered'
);
select is(
  (select provider_message_id from public.outbound_deliveries where id = '35000000-0000-4000-8000-000000000003'),
  'provider-accepted-003',
  'Accepted worker result stores provider message id'
);
select is(
  (select delivered_at from public.outbound_deliveries where id = '35000000-0000-4000-8000-000000000003'),
  timestamptz '2026-09-22 20:00:00+00',
  'Duplicate delivery callback keeps the original delivered timestamp'
);
select is(
  (select lease_owner from public.outbound_deliveries where id = '35000000-0000-4000-8000-000000000003'),
  null,
  'Accepted worker result clears the lease owner'
);
select is(
  (select status::text from public.outbound_deliveries where id = '35000000-0000-4000-8000-000000000002'),
  'QUEUED',
  'Retry worker result returns the delivery to queued'
);
select is(
  (select last_error_text from public.outbound_deliveries where id = '35000000-0000-4000-8000-000000000002'),
  'Twilio HTTP 503',
  'Retry worker result stores last error text'
);
select is(
  (select status::text from public.outbound_deliveries where id = '35000000-0000-4000-8000-000000000006'),
  'FAILED',
  'Terminal worker failure marks the delivery failed'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"34000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select count(*) from public.outbound_deliveries where id = '35000000-0000-4000-8000-000000000001'),
  1::bigint,
  'Active staff can read outbound delivery queue records'
);
select throws_ok(
  $$insert into public.outbound_deliveries (idempotency_key, channel, recipient) values ('staff-forge', 'SMS', '+13035550100')$$,
  '42501',
  null,
  'Active staff cannot enqueue directly'
);
select throws_ok(
  $$update public.outbound_deliveries set status = 'ACCEPTED', accepted_at = now() where id = '35000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'Active staff cannot update delivery state'
);
select throws_ok(
  $$select * from public.claim_due_outbound_deliveries('staff-worker')$$,
  '42501',
  null,
  'Active staff cannot execute worker-only delivery claiming'
);

select set_config('request.jwt.claims', '{"sub":"34000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  (select count(*) from public.outbound_deliveries where id = '35000000-0000-4000-8000-000000000001'),
  0::bigint,
  'Inactive staff cannot read outbound delivery queue records'
);

reset role;
select set_config('request.jwt.claims', '{}', true);

select ok(
  has_function_privilege(
    'service_role',
    to_regprocedure('public.enqueue_due_appointment_reminders(integer,timestamp with time zone)'),
    'EXECUTE'
  ),
  'Service role can execute the appointment reminder enqueue RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    to_regprocedure('public.enqueue_due_appointment_reminders(integer,timestamp with time zone)'),
    'EXECUTE'
  ),
  'Staff cannot execute the appointment reminder enqueue RPC'
);
select ok(has_table_privilege('authenticated', 'public.appointment_reminders', 'SELECT'), 'Staff have read access to appointment reminders');
select ok(not has_table_privilege('authenticated', 'public.appointment_reminders', 'INSERT'), 'Staff cannot directly create appointment reminder jobs');
select ok(not has_table_privilege('authenticated', 'public.appointment_reminders', 'UPDATE'), 'Staff cannot directly mark appointment reminders');
select ok(has_table_privilege('service_role', 'public.appointment_reminders', 'INSERT'), 'Service role can create appointment reminder jobs');
select ok(has_table_privilege('service_role', 'public.appointment_reminders', 'UPDATE'), 'Service role can mark appointment reminders');
select ok(not has_table_privilege('service_role', 'public.appointment_reminders', 'DELETE'), 'Service role cannot erase appointment reminder jobs');

insert into public.clients (
  id,
  first_name,
  last_name,
  full_name,
  primary_phone,
  primary_email,
  preferred_channel
) values
  (
    '37000000-0000-4000-8000-000000000001',
    'Reminder',
    'Ready',
    'Reminder Ready',
    '+13035552001',
    'ready@example.test',
    'SMS'
  ),
  (
    '37000000-0000-4000-8000-000000000002',
    'Reminder',
    'NoConsent',
    'Reminder NoConsent',
    '+13035552002',
    'noconsent@example.test',
    'SMS'
  ),
  (
    '37000000-0000-4000-8000-000000000003',
    'Reminder',
    'Email',
    'Reminder Email',
    null,
    'email-reminder@example.test',
    'EMAIL'
  );

insert into public.sms_consent (
  client_id,
  phone_number,
  opted_in,
  opted_in_at,
  consent_method
) values (
  '37000000-0000-4000-8000-000000000001',
  '+13035552001',
  true,
  timestamptz '2026-09-20 18:00:00+00',
  'WRITTEN'
);

insert into public.pets (
  id,
  client_id,
  name,
  species
) values
  ('37100000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000001', 'Queue', 'Dog'),
  ('37100000-0000-4000-8000-000000000002', '37000000-0000-4000-8000-000000000002', 'Skip', 'Cat'),
  ('37100000-0000-4000-8000-000000000003', '37000000-0000-4000-8000-000000000003', 'Email', 'Dog'),
  ('37100000-0000-4000-8000-000000000004', '37000000-0000-4000-8000-000000000001', 'Gone', 'Dog');

update public.pets
set deceased_at = date '2026-09-21'
where id = '37100000-0000-4000-8000-000000000004';

insert into public.appointments (
  id,
  client_id,
  pet_id,
  scheduled_at,
  appointment_type,
  status
) values
  ('37200000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000001', '37100000-0000-4000-8000-000000000001', timestamptz '2026-09-23 18:00:00+00', 'Housecall', 'CONFIRMED'),
  ('37200000-0000-4000-8000-000000000002', '37000000-0000-4000-8000-000000000002', '37100000-0000-4000-8000-000000000002', timestamptz '2026-09-23 18:00:00+00', 'Housecall', 'CONFIRMED'),
  ('37200000-0000-4000-8000-000000000003', '37000000-0000-4000-8000-000000000003', '37100000-0000-4000-8000-000000000003', timestamptz '2026-09-23 18:00:00+00', 'Housecall', 'CONFIRMED'),
  ('37200000-0000-4000-8000-000000000004', '37000000-0000-4000-8000-000000000001', '37100000-0000-4000-8000-000000000001', timestamptz '2026-09-23 18:00:00+00', 'Housecall', 'CANCELLED'),
  ('37200000-0000-4000-8000-000000000005', '37000000-0000-4000-8000-000000000001', '37100000-0000-4000-8000-000000000004', timestamptz '2026-09-23 18:00:00+00', 'Housecall', 'CONFIRMED'),
  ('37200000-0000-4000-8000-000000000006', '37000000-0000-4000-8000-000000000001', '37100000-0000-4000-8000-000000000001', timestamptz '2026-09-23 18:00:00+00', 'Housecall', 'CONFIRMED'),
  ('37200000-0000-4000-8000-000000000007', '37000000-0000-4000-8000-000000000001', '37100000-0000-4000-8000-000000000001', timestamptz '2026-09-23 18:00:00+00', 'Housecall', 'CONFIRMED');

delete from public.appointment_reminders
where appointment_id in (
  '37200000-0000-4000-8000-000000000001',
  '37200000-0000-4000-8000-000000000002',
  '37200000-0000-4000-8000-000000000003',
  '37200000-0000-4000-8000-000000000004',
  '37200000-0000-4000-8000-000000000005',
  '37200000-0000-4000-8000-000000000006',
  '37200000-0000-4000-8000-000000000007'
);

insert into public.appointment_reminders (
  id,
  appointment_id,
  remind_at,
  channel
) values
  ('37300000-0000-4000-8000-000000000001', '37200000-0000-4000-8000-000000000001', timestamptz '2026-09-22 17:00:00+00', 'SMS'),
  ('37300000-0000-4000-8000-000000000002', '37200000-0000-4000-8000-000000000002', timestamptz '2026-09-22 17:00:00+00', 'SMS'),
  ('37300000-0000-4000-8000-000000000003', '37200000-0000-4000-8000-000000000003', timestamptz '2026-09-22 17:00:00+00', 'EMAIL'),
  ('37300000-0000-4000-8000-000000000004', '37200000-0000-4000-8000-000000000004', timestamptz '2026-09-22 17:00:00+00', 'SMS'),
  ('37300000-0000-4000-8000-000000000005', '37200000-0000-4000-8000-000000000001', timestamptz '2026-09-22 17:00:00+00', 'VOICE'),
  ('37300000-0000-4000-8000-000000000006', '37200000-0000-4000-8000-000000000005', timestamptz '2026-09-22 17:00:00+00', 'SMS'),
  ('37300000-0000-4000-8000-000000000007', '37200000-0000-4000-8000-000000000006', timestamptz '2026-09-22 17:00:00+00', 'SMS'),
  ('37300000-0000-4000-8000-000000000008', '37200000-0000-4000-8000-000000000007', timestamptz '2026-09-23 17:00:00+00', 'SMS');

insert into public.outbound_deliveries (
  id,
  idempotency_key,
  channel,
  recipient,
  payload,
  client_id,
  appointment_reminder_id
) values (
  '37400000-0000-4000-8000-000000000007',
  'appointment-reminder:37300000-0000-4000-8000-000000000007',
  'SMS',
  '+13035552001',
  '{"kind":"appointment_reminder","recovered":true}',
  '37000000-0000-4000-8000-000000000001',
  '37300000-0000-4000-8000-000000000007'
);

create temp table appointment_enqueue_results (
  reminder_id uuid,
  outbound_delivery_id uuid,
  action text,
  reminder_status public.reminder_status,
  status_note text
);
grant all on appointment_enqueue_results to service_role;

set local role service_role;
insert into appointment_enqueue_results
select *
from public.enqueue_due_appointment_reminders(20, timestamptz '2026-09-22 18:00:00+00');
reset role;

select is((select count(*) from appointment_enqueue_results), 7::bigint, 'Due appointment reminder enqueue worker processes only due pending reminders');
select is(
  (select action from appointment_enqueue_results where reminder_id = '37300000-0000-4000-8000-000000000001'),
  'ENQUEUED',
  'Eligible SMS reminder is enqueued'
);
select is(
  (select status::text from public.appointment_reminders where id = '37300000-0000-4000-8000-000000000001'),
  'QUEUED',
  'Eligible reminder is marked queued, not sent'
);
select is(
  (select status::text from public.outbound_deliveries where appointment_reminder_id = '37300000-0000-4000-8000-000000000001'),
  'QUEUED',
  'Appointment reminder enqueue creates a queued outbound delivery only'
);
select is(
  (select count(*) from public.outbound_deliveries where appointment_reminder_id = '37300000-0000-4000-8000-000000000001' and provider is null and provider_message_id is null),
  1::bigint,
  'Appointment reminder enqueue does not record a provider send'
);
select is(
  (select payload->>'template_key' from public.outbound_deliveries where appointment_reminder_id = '37300000-0000-4000-8000-000000000001'),
  'appointment_reminder',
  'Queued reminder carries durable appointment reminder payload metadata'
);
select is(
  (select status::text from public.appointment_reminders where id = '37300000-0000-4000-8000-000000000003'),
  'QUEUED',
  'Email reminder with an address can be queued'
);
select is(
  (select recipient from public.outbound_deliveries where appointment_reminder_id = '37300000-0000-4000-8000-000000000003'),
  'email-reminder@example.test',
  'Email reminder uses the primary email recipient'
);
select is(
  (select status::text from public.appointment_reminders where id = '37300000-0000-4000-8000-000000000002'),
  'SKIPPED',
  'SMS reminder without exact opt-in consent is skipped'
);
select is(
  (select error_message from public.appointment_reminders where id = '37300000-0000-4000-8000-000000000002'),
  'SMS consent is unavailable for the primary phone',
  'Skipped SMS reminder records the consent reason'
);
select is(
  (select status::text from public.appointment_reminders where id = '37300000-0000-4000-8000-000000000004'),
  'SKIPPED',
  'Canceled appointment reminder is skipped'
);
select is(
  (select status::text from public.appointment_reminders where id = '37300000-0000-4000-8000-000000000005'),
  'FAILED',
  'Unsupported reminder channel is marked failed without creating an outbound delivery'
);
select is(
  (select count(*) from public.outbound_deliveries where appointment_reminder_id = '37300000-0000-4000-8000-000000000005'),
  0::bigint,
  'Unsupported reminder channel does not create outbound delivery work'
);
select is(
  (select status::text from public.appointment_reminders where id = '37300000-0000-4000-8000-000000000006'),
  'SKIPPED',
  'Deceased patient reminder is skipped'
);
select is(
  (select action from appointment_enqueue_results where reminder_id = '37300000-0000-4000-8000-000000000007'),
  'ALREADY_QUEUED',
  'Existing outbound delivery idempotency key is reused after a partial prior enqueue'
);
select is(
  (select outbound_delivery_id from public.appointment_reminders where id = '37300000-0000-4000-8000-000000000007'),
  '37400000-0000-4000-8000-000000000007'::uuid,
  'Idempotent recovery links the reminder to the existing outbound delivery'
);
select is(
  (select count(*) from public.outbound_deliveries where idempotency_key = 'appointment-reminder:37300000-0000-4000-8000-000000000007'),
  1::bigint,
  'Idempotent recovery does not duplicate outbound delivery rows'
);
select is(
  (select status::text from public.appointment_reminders where id = '37300000-0000-4000-8000-000000000008'),
  'PENDING',
  'Future reminders are left pending'
);

set local role service_role;
select is(
  (select count(*) from public.enqueue_due_appointment_reminders(20, timestamptz '2026-09-22 18:00:00+00')),
  0::bigint,
  'Second enqueue run is idempotent after reminders are marked'
);
update public.outbound_deliveries
set status = 'ACCEPTED',
  provider = 'twilio',
  provider_message_id = 'SM-reminder-001',
  accepted_at = timestamptz '2026-09-22 18:05:00+00',
  status_note = 'Twilio accepted reminder'
where appointment_reminder_id = '37300000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.record_outbound_delivery_callback(
      'twilio',
      'SM-reminder-001',
      'DELIVERED',
      'Twilio delivery callback confirmed reminder',
      null,
      timestamptz '2026-09-22 18:10:00+00'
    )$$,
  'Provider callback settles appointment reminder delivery'
);
reset role;

select is(
  (select status::text from public.outbound_deliveries where appointment_reminder_id = '37300000-0000-4000-8000-000000000001'),
  'DELIVERED',
  'Provider callback marks the reminder outbound delivery delivered'
);
select is(
  (select status::text from public.appointment_reminders where id = '37300000-0000-4000-8000-000000000001'),
  'SENT',
  'Provider delivery callback marks the appointment reminder sent'
);
select is(
  (select sent_at from public.appointment_reminders where id = '37300000-0000-4000-8000-000000000001'),
  timestamptz '2026-09-22 18:10:00+00',
  'Provider delivery callback stamps appointment reminder sent_at'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"34000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select count(*) from public.appointment_reminders where id = '37300000-0000-4000-8000-000000000001'),
  1::bigint,
  'Active staff can read appointment reminder state'
);
select throws_ok(
  $$insert into public.appointment_reminders (appointment_id, remind_at, channel) values ('37200000-0000-4000-8000-000000000001', now(), 'SMS')$$,
  '42501',
  null,
  'Active staff cannot directly create reminder jobs'
);
select throws_ok(
  $$update public.appointment_reminders set status = 'SENT', sent_at = now() where id = '37300000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'Active staff cannot forge reminder delivery state'
);
create temp table reminder_trigger_fixture(id uuid);
grant all on reminder_trigger_fixture to authenticated;
insert into reminder_trigger_fixture
select id
from public.save_appointment(
  null,
  null,
  '37000000-0000-4000-8000-000000000001',
  '37100000-0000-4000-8000-000000000001',
  timestamptz '2026-09-30 18:00:00+00',
  30,
  'Housecall',
  'SCHEDULED',
  '34000000-0000-4000-8000-000000000001',
  null
);
select is(
  (
    select count(*)
    from public.appointment_reminders
    where appointment_id = (select id from reminder_trigger_fixture)
  ),
  2::bigint,
  'Appointment RPC still creates reminders while direct staff reminder writes stay closed'
);
select set_config('request.jwt.claims', '{"sub":"34000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  (select count(*) from public.appointment_reminders where id = '37300000-0000-4000-8000-000000000001'),
  0::bigint,
  'Inactive staff cannot read appointment reminder state'
);
select throws_ok(
  $$select * from public.enqueue_due_appointment_reminders(1, now())$$,
  '42501',
  null,
  'Inactive staff cannot execute service-only reminder enqueue RPC'
);

reset role;
select ok(
  exists (
    select 1
    from public.audit_logs
    where table_name = 'outbound_deliveries'
      and record_id = '35000000-0000-4000-8000-000000000001'
      and action = 'INSERT'
  ),
  'Outbound delivery queue inserts are audited'
);
select ok(
  exists (
    select 1
    from public.audit_logs
    where table_name = 'outbound_deliveries'
      and record_id = '35000000-0000-4000-8000-000000000002'
      and action = 'UPDATE'
  ),
  'Outbound delivery worker claims are audited'
);
select ok(
  exists (
    select 1
    from public.audit_logs
    where table_name = 'appointment_reminders'
      and record_id = '37300000-0000-4000-8000-000000000001'
      and action = 'UPDATE'
  ),
  'Appointment reminder enqueue state changes are audited'
);

select * from finish();
rollback;
