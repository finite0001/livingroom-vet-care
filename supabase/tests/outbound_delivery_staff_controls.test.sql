begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('3b000000-0000-4000-8000-000000000001', 'delivery-active@example.test', '{}'),
  ('3b000000-0000-4000-8000-000000000002', 'delivery-inactive@example.test', '{}');

update public.profiles
set is_active = true
where id = '3b000000-0000-4000-8000-000000000001';
update public.profiles
set is_active = false
where id = '3b000000-0000-4000-8000-000000000002';
insert into public.user_roles (user_id, role)
values ('3b000000-0000-4000-8000-000000000001', 'STAFF')
on conflict do nothing;

insert into public.outbound_deliveries (
  id,
  idempotency_key,
  channel,
  recipient,
  payload,
  status,
  attempt_count,
  max_attempts,
  provider,
  provider_message_id,
  last_error_text,
  failed_at
) values (
  '3b100000-0000-4000-8000-000000000001',
  'manual-control:failed',
  'EMAIL',
  'retry@example.test',
  '{"subject":"Retry me"}',
  'FAILED',
  3,
  3,
  'resend',
  'old-provider-id',
  'Provider rejected message',
  timestamptz '2026-09-22 20:00:00+00'
);

insert into public.outbound_deliveries (
  id,
  idempotency_key,
  channel,
  recipient,
  payload,
  status,
  attempt_count,
  max_attempts,
  unknown_at
) values (
  '3b100000-0000-4000-8000-000000000002',
  'manual-control:unknown',
  'SMS',
  '+13035550100',
  '{"body":"Unknown"}',
  'UNKNOWN',
  1,
  3,
  timestamptz '2026-09-22 20:05:00+00'
);

insert into public.outbound_deliveries (
  id,
  idempotency_key,
  channel,
  recipient,
  payload,
  status,
  attempt_count,
  max_attempts,
  accepted_at
) values (
  '3b100000-0000-4000-8000-000000000003',
  'manual-control:accepted',
  'EMAIL',
  'accepted@example.test',
  '{"subject":"Accepted"}',
  'ACCEPTED',
  1,
  3,
  timestamptz '2026-09-22 20:10:00+00'
);

insert into public.outbound_deliveries (
  id,
  idempotency_key,
  channel,
  recipient,
  payload,
  status,
  attempt_count,
  max_attempts,
  leased_at,
  leased_until,
  lease_owner
) values (
  '3b100000-0000-4000-8000-000000000004',
  'manual-control:leased',
  'SMS',
  '+13035550101',
  '{"body":"Leased"}',
  'LEASED',
  1,
  3,
  timestamptz '2026-09-22 20:10:00+00',
  timestamptz '2026-09-22 20:20:00+00',
  'worker-a'
);

insert into public.outbound_deliveries (
  id,
  idempotency_key,
  channel,
  recipient,
  payload,
  status,
  attempt_count,
  max_attempts
) values (
  '3b100000-0000-4000-8000-000000000005',
  'manual-control:queued',
  'SMS',
  '+13035550102',
  '{"body":"Queued"}',
  'QUEUED',
  0,
  3
);

select ok(
  has_function_privilege('authenticated', to_regprocedure('public.retry_outbound_delivery(uuid,timestamp with time zone,timestamp with time zone)'), 'EXECUTE'),
  'Authenticated staff can execute retry RPC'
);
select ok(
  has_function_privilege('authenticated', to_regprocedure('public.cancel_outbound_delivery(uuid,timestamp with time zone,timestamp with time zone)'), 'EXECUTE'),
  'Authenticated staff can execute cancel RPC'
);
select ok(
  not has_table_privilege('authenticated', 'public.outbound_deliveries', 'UPDATE'),
  'Staff still cannot update outbound deliveries directly'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3b000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$select public.retry_outbound_delivery(
      '3b100000-0000-4000-8000-000000000001',
      (select updated_at from public.outbound_deliveries where id = '3b100000-0000-4000-8000-000000000001'),
      timestamptz '2026-09-22 21:00:00+00'
    )$$,
  'Active staff can retry a failed delivery'
);

reset role;
select is(
  (select status::text from public.outbound_deliveries where id = '3b100000-0000-4000-8000-000000000001'),
  'QUEUED',
  'Retry moves failed delivery back to queued'
);
select is(
  (select max_attempts from public.outbound_deliveries where id = '3b100000-0000-4000-8000-000000000001'),
  4,
  'Retry adds one available worker attempt when attempts were exhausted'
);
select is(
  (select provider_message_id from public.outbound_deliveries where id = '3b100000-0000-4000-8000-000000000001'),
  null,
  'Retry clears stale provider message id'
);
select is(
  (select failed_at from public.outbound_deliveries where id = '3b100000-0000-4000-8000-000000000001'),
  null,
  'Retry clears terminal failure timestamp'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3b000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$select public.retry_outbound_delivery('3b100000-0000-4000-8000-000000000003', null, timestamptz '2026-09-22 21:00:00+00')$$,
  '40001',
  'Outbound delivery is not retryable',
  'Accepted deliveries cannot be manually retried'
);
select throws_ok(
  $$select public.cancel_outbound_delivery('3b100000-0000-4000-8000-000000000004', null, timestamptz '2026-09-22 21:00:00+00')$$,
  '40001',
  'Outbound delivery is not cancelable',
  'Actively leased deliveries cannot be manually canceled'
);
select lives_ok(
  $$select public.cancel_outbound_delivery(
      '3b100000-0000-4000-8000-000000000005',
      (select updated_at from public.outbound_deliveries where id = '3b100000-0000-4000-8000-000000000005'),
      timestamptz '2026-09-22 21:05:00+00'
    )$$,
  'Active staff can cancel a queued delivery'
);

reset role;
select is(
  (select status::text from public.outbound_deliveries where id = '3b100000-0000-4000-8000-000000000005'),
  'CANCELED',
  'Cancel moves queued delivery to canceled'
);
select is(
  (select canceled_at from public.outbound_deliveries where id = '3b100000-0000-4000-8000-000000000005'),
  timestamptz '2026-09-22 21:05:00+00',
  'Cancel records staff cancellation time'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3b000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$select public.retry_outbound_delivery('3b100000-0000-4000-8000-000000000002', null, timestamptz '2026-09-22 21:00:00+00')$$,
  '42501',
  'Active staff access required',
  'Inactive staff cannot retry deliveries'
);

select * from finish();
rollback;
