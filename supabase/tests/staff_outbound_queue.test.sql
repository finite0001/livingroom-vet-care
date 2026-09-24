begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('3a000000-0000-4000-8000-000000000001', 'queue-staff@example.test', '{"first_name":"Queue","last_name":"Staff"}'),
  ('3a000000-0000-4000-8000-000000000002', 'queue-inactive@example.test', '{"first_name":"Queue","last_name":"Inactive"}');

update public.profiles
set is_active = true
where id = '3a000000-0000-4000-8000-000000000001';
update public.profiles
set is_active = false
where id = '3a000000-0000-4000-8000-000000000002';
insert into public.user_roles (user_id, role)
values ('3a000000-0000-4000-8000-000000000001', 'STAFF')
on conflict do nothing;

insert into public.clients (
  id,
  first_name,
  last_name,
  full_name,
  primary_phone,
  primary_email,
  preferred_channel
) values (
  '3a100000-0000-4000-8000-000000000001',
  'Queue',
  'Client',
  'Queue Client',
  '+1 (303) 555-0100',
  'queue-client@example.test',
  'SMS'
);

insert into public.conversations (
  id,
  client_id,
  status,
  is_read
) values (
  '3a200000-0000-4000-8000-000000000001',
  '3a100000-0000-4000-8000-000000000001',
  'ACTIVE',
  false
);

insert into public.sms_consent (
  client_id,
  phone_number,
  opted_in,
  opted_in_at,
  consent_method
) values (
  '3a100000-0000-4000-8000-000000000001',
  '+13035550100',
  true,
  timestamptz '2026-09-22 18:00:00+00',
  'WRITTEN'
);

select ok(
  has_function_privilege(
    'service_role',
    to_regprocedure('public.enqueue_staff_outbound_message(uuid,uuid,channel_type,text,text,text,timestamp with time zone,text)'),
    'EXECUTE'
  ),
  'Service role can enqueue staff outbound messages'
);
select ok(
  not has_function_privilege(
    'authenticated',
    to_regprocedure('public.enqueue_staff_outbound_message(uuid,uuid,channel_type,text,text,text,timestamp with time zone,text)'),
    'EXECUTE'
  ),
  'Browser staff cannot bypass edge-function queue checks directly'
);

create temp table staff_queue_results (
  kind text primary key,
  message_id uuid not null,
  outbound_delivery_id uuid not null,
  enqueue_status text not null
);
grant all on staff_queue_results to service_role;

set local role service_role;
insert into staff_queue_results
select 'email', message_id, outbound_delivery_id, enqueue_status
from public.enqueue_staff_outbound_message(
  '3a000000-0000-4000-8000-000000000001',
  '3a200000-0000-4000-8000-000000000001',
  'EMAIL',
  'queue-client@example.test',
  'Follow-up',
  'Email body',
  timestamptz '2026-09-22 20:00:00+00',
  'staff-email-idempotency'
);
reset role;

select is((select enqueue_status from staff_queue_results where kind = 'email'), 'QUEUED', 'Email staff send returns queued status');
select is(
  (select sender_type::text from public.messages where id = (select message_id from staff_queue_results where kind = 'email')),
  'STAFF',
  'Queued email creates a visible staff message'
);
select is(
  (select type::text from public.messages where id = (select message_id from staff_queue_results where kind = 'email')),
  'EMAIL',
  'Queued email preserves message type'
);
select is(
  (select status::text from public.outbound_deliveries where id = (select outbound_delivery_id from staff_queue_results where kind = 'email')),
  'QUEUED',
  'Queued email creates a queued outbound delivery'
);
select is(
  (select payload->>'subject' from public.outbound_deliveries where id = (select outbound_delivery_id from staff_queue_results where kind = 'email')),
  'Follow-up',
  'Queued email stores dispatcher subject payload'
);
select is(
  (select last_message_at from public.conversations where id = '3a200000-0000-4000-8000-000000000001'),
  timestamptz '2026-09-22 20:00:00+00',
  'Queued staff send advances conversation last_message_at atomically'
);

set local role service_role;
insert into staff_queue_results
select 'email-duplicate', message_id, outbound_delivery_id, enqueue_status
from public.enqueue_staff_outbound_message(
  '3a000000-0000-4000-8000-000000000001',
  '3a200000-0000-4000-8000-000000000001',
  'EMAIL',
  'queue-client@example.test',
  'Follow-up',
  'Email body',
  timestamptz '2026-09-22 20:01:00+00',
  'staff-email-idempotency'
);
reset role;

select is((select enqueue_status from staff_queue_results where kind = 'email-duplicate'), 'DUPLICATE', 'Repeated idempotency key returns duplicate status');
select is(
  (select count(*) from public.outbound_deliveries where idempotency_key = 'staff-email-idempotency'),
  1::bigint,
  'Repeated idempotency key does not create another delivery'
);

set local role service_role;
insert into staff_queue_results
select 'sms', message_id, outbound_delivery_id, enqueue_status
from public.enqueue_staff_outbound_message(
  '3a000000-0000-4000-8000-000000000001',
  '3a200000-0000-4000-8000-000000000001',
  'SMS',
  '+1 (303) 555-0100',
  null,
  'SMS body',
  timestamptz '2026-09-22 20:05:00+00',
  null
);
reset role;

select is(
  (select recipient from public.outbound_deliveries where id = (select outbound_delivery_id from staff_queue_results where kind = 'sms')),
  '+13035550100',
  'Queued SMS stores normalized explicit international phone'
);
select is(
  (select payload->>'source' from public.outbound_deliveries where id = (select outbound_delivery_id from staff_queue_results where kind = 'sms')),
  'send-sms',
  'Queued SMS stores dispatcher source payload'
);

set local role service_role;
select throws_ok(
  $$select * from public.enqueue_staff_outbound_message(
      '3a000000-0000-4000-8000-000000000002',
      '3a200000-0000-4000-8000-000000000001',
      'EMAIL',
      'queue-client@example.test',
      'Inactive',
      'Body',
      now(),
      null
    )$$,
  '42501',
  'Active staff access required',
  'Inactive staff actor cannot enqueue outbound delivery'
);
select throws_ok(
  $$select * from public.enqueue_staff_outbound_message(
      '3a000000-0000-4000-8000-000000000001',
      '3a200000-0000-4000-8000-000000000001',
      'EMAIL',
      'wrong@example.test',
      'Wrong recipient',
      'Body',
      now(),
      null
    )$$,
  '42501',
  'Recipient does not match the conversation client',
  'Email recipient must match conversation client'
);
reset role;

update public.sms_consent
set opted_in = false,
  opted_out_at = now()
where client_id = '3a100000-0000-4000-8000-000000000001'
  and phone_number = '+13035550100';

set local role service_role;
select throws_ok(
  $$select * from public.enqueue_staff_outbound_message(
      '3a000000-0000-4000-8000-000000000001',
      '3a200000-0000-4000-8000-000000000001',
      'SMS',
      '+1 (303) 555-0100',
      null,
      'No consent',
      now(),
      null
    )$$,
  '42501',
  'No SMS consent on record for this number',
  'SMS queueing requires affirmative consent'
);
reset role;

set local role authenticated;
select throws_ok(
  $$select * from public.enqueue_staff_outbound_message(
      '3a000000-0000-4000-8000-000000000001',
      '3a200000-0000-4000-8000-000000000001',
      'EMAIL',
      'queue-client@example.test',
      'Direct',
      'Body',
      now(),
      null
    )$$,
  '42501',
  null,
  'Authenticated browser role cannot execute staff outbound enqueue RPC directly'
);
reset role;

select * from finish();
rollback;
