begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('38000000-0000-4000-8000-000000000001', 'appointment-staff@example.test', '{"first_name":"Appointment","last_name":"Staff"}'),
  ('38000000-0000-4000-8000-000000000002', 'appointment-inactive@example.test', '{"first_name":"Appointment","last_name":"Inactive"}'),
  ('38000000-0000-4000-8000-000000000003', 'appointment-dvm@example.test', '{"first_name":"Appointment","last_name":"DVM","role":"DVM"}');
update public.profiles
set is_active = true
where id in (
  '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000003'
);
update public.profiles set is_active = false where id = '38000000-0000-4000-8000-000000000002';
update public.profiles set role = 'DVM' where id = '38000000-0000-4000-8000-000000000003';
insert into public.user_roles (user_id, role)
values
  ('38000000-0000-4000-8000-000000000001', 'STAFF'),
  ('38000000-0000-4000-8000-000000000003', 'DVM')
on conflict do nothing;

insert into public.clients (
  id,
  first_name,
  last_name,
  full_name,
  primary_phone,
  primary_email,
  preferred_channel
) values
  ('38100000-0000-4000-8000-000000000001', 'Appointment', 'Client', 'Appointment Client', '+13035550100', 'appointment-client@example.test', 'SMS'),
  ('38100000-0000-4000-8000-000000000002', 'Other', 'Client', 'Other Client', '+13035550101', 'other-client@example.test', 'SMS');

insert into public.pets (
  id,
  client_id,
  name,
  species,
  breed
) values
  ('38200000-0000-4000-8000-000000000001', '38100000-0000-4000-8000-000000000001', 'River', 'Dog', 'Mixed'),
  ('38200000-0000-4000-8000-000000000002', '38100000-0000-4000-8000-000000000002', 'Wrong Home', 'Cat', 'Domestic Shorthair'),
  ('38200000-0000-4000-8000-000000000003', '38100000-0000-4000-8000-000000000001', 'Archived', 'Dog', 'Mixed'),
  ('38200000-0000-4000-8000-000000000004', '38100000-0000-4000-8000-000000000001', 'Memorial', 'Dog', 'Mixed');

update public.pets
set archived_at = now()
where id = '38200000-0000-4000-8000-000000000003';

update public.pets
set deceased_at = (now() at time zone 'America/Denver')::date
where id = '38200000-0000-4000-8000-000000000004';

select ok(has_table_privilege('authenticated', 'public.appointments', 'SELECT'), 'Authenticated staff can read appointments');
select ok(not has_table_privilege('authenticated', 'public.appointments', 'INSERT'), 'Authenticated staff cannot insert appointments directly');
select ok(not has_table_privilege('authenticated', 'public.appointments', 'UPDATE'), 'Authenticated staff cannot update appointments directly');
select ok(has_function_privilege('authenticated', to_regprocedure('public.save_appointment(uuid,integer,uuid,uuid,timestamp with time zone,integer,text,appointment_status,uuid,text)'), 'EXECUTE'), 'Authenticated staff can execute save_appointment');
select ok(has_function_privilege('authenticated', to_regprocedure('public.cancel_appointment(uuid,integer)'), 'EXECUTE'), 'Authenticated staff can execute cancel_appointment');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"38000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$insert into public.appointments (client_id, pet_id, scheduled_at, duration_minutes, appointment_type)
    values ('38100000-0000-4000-8000-000000000001', '38200000-0000-4000-8000-000000000001', now() + interval '3 days', 60, 'Direct write')$$,
  '42501',
  null,
  'Direct appointment inserts are denied to browser staff'
);

create temp table appointment_fixtures(kind text primary key, id uuid);
grant all on appointment_fixtures to authenticated;

insert into appointment_fixtures
select 'appointment', id
from public.save_appointment(
  null,
  null,
  '38100000-0000-4000-8000-000000000001',
  '38200000-0000-4000-8000-000000000001',
  now() + interval '10 days',
  60,
  'Housecall visit',
  'SCHEDULED',
  '38000000-0000-4000-8000-000000000003',
  'Gate code in notes'
);

select is(
  (select version from public.appointments where id = (select id from appointment_fixtures where kind = 'appointment')),
  1,
  'New appointment starts at version 1'
);

select is(
  (select created_by from public.appointments where id = (select id from appointment_fixtures where kind = 'appointment')),
  auth.uid(),
  'Appointment creation actor is stamped from the session'
);

select is(
  (select count(*) from public.appointment_reminders where appointment_id = (select id from appointment_fixtures where kind = 'appointment') and status = 'PENDING'),
  2::bigint,
  'New scheduled appointment creates two pending reminders'
);

select throws_ok(
  $$select public.save_appointment(
      null,
      null,
      '38100000-0000-4000-8000-000000000001',
      '38200000-0000-4000-8000-000000000002',
      now() + interval '11 days',
      60,
      'Wrong-client patient',
      'SCHEDULED',
      null,
      null
    )$$,
  '23514',
  'Select an active patient belonging to this household',
  'Appointments cannot link a patient from another client'
);

select throws_ok(
  $$select public.save_appointment(
      null,
      null,
      '38100000-0000-4000-8000-000000000001',
      '38200000-0000-4000-8000-000000000003',
      now() + interval '11 days',
      60,
      'Archived patient',
      'SCHEDULED',
      null,
      null
    )$$,
  '23514',
  'Select an active patient belonging to this household',
  'Archived patients cannot be scheduled'
);

select throws_ok(
  $$select public.save_appointment(
      null,
      null,
      '38100000-0000-4000-8000-000000000001',
      '38200000-0000-4000-8000-000000000004',
      now() + interval '11 days',
      60,
      'Deceased patient',
      'SCHEDULED',
      null,
      null
    )$$,
  '23514',
  'Select an active patient belonging to this household',
  'Deceased patients cannot be scheduled'
);

select lives_ok(
  $$select public.save_appointment(
      null,
      null,
      '38100000-0000-4000-8000-000000000001',
      '38200000-0000-4000-8000-000000000001',
      now() + interval '12 days',
      60,
      'Active staff assignment',
      'SCHEDULED',
      '38000000-0000-4000-8000-000000000001',
      null
    )$$,
  'Slim compatibility RPC permits active staff assignment'
);

select throws_ok(
  $$select public.save_appointment(
      (select id from appointment_fixtures where kind = 'appointment'),
      0,
      '38100000-0000-4000-8000-000000000001',
      '38200000-0000-4000-8000-000000000001',
      now() + interval '10 days 2 hours',
      60,
      'Stale edit',
      'SCHEDULED',
      null,
      null
    )$$,
  '40001',
  'Appointment changed; reload before saving',
  'Stale appointment versions are rejected'
);

select lives_ok(
  $$select public.save_appointment(
      (select id from appointment_fixtures where kind = 'appointment'),
      1,
      '38100000-0000-4000-8000-000000000001',
      '38200000-0000-4000-8000-000000000001',
      now() + interval '13 days',
      90,
      'Rescheduled housecall',
      'CONFIRMED',
      '38000000-0000-4000-8000-000000000003',
      'Updated notes'
    )$$,
  'Expected-version appointment update succeeds'
);

select is(
  (select version from public.appointments where id = (select id from appointment_fixtures where kind = 'appointment')),
  2,
  'Appointment update increments the version'
);

select is(
  (select count(*) from public.appointment_reminders where appointment_id = (select id from appointment_fixtures where kind = 'appointment') and status = 'SKIPPED'),
  2::bigint,
  'Reschedule supersedes old pending reminders'
);

select is(
  (select count(*) from public.appointment_reminders where appointment_id = (select id from appointment_fixtures where kind = 'appointment') and status = 'PENDING'),
  2::bigint,
  'Reschedule creates the replacement reminder set'
);

select is(
  (select count(*) from public.appointment_reminders where appointment_id = (select id from appointment_fixtures where kind = 'appointment') and status = 'PENDING' and appointment_version = 2),
  2::bigint,
  'Slim compatibility RPC creates scheduler-eligible replacement reminders'
);

select throws_ok(
  $$select public.save_appointment(
      null,
      null,
      '38100000-0000-4000-8000-000000000001',
      '38200000-0000-4000-8000-000000000001',
      now() + interval '13 days 30 minutes',
      30,
      'Slim overlap',
      'SCHEDULED',
      '38000000-0000-4000-8000-000000000003',
      null
    )$$,
  '23P01',
  null,
  'Slim compatibility RPC enforces the canonical appointment conflict guard'
);

reset role;
insert into public.outbound_deliveries (
  id,
  idempotency_key,
  channel,
  recipient,
  payload,
  appointment_reminder_id
)
select
  '38300000-0000-4000-8000-000000000001',
  'appointment-reminder-test:' || ar.id::text,
  'SMS',
  '+13035550100',
  '{"body":"Queued reminder"}'::jsonb,
  ar.id
from public.appointment_reminders ar
where ar.appointment_id = (select id from appointment_fixtures where kind = 'appointment')
  and ar.status = 'PENDING'
order by ar.remind_at
limit 1;

update public.appointment_reminders
set status = 'QUEUED',
  outbound_delivery_id = '38300000-0000-4000-8000-000000000001',
  enqueued_at = now()
where outbound_delivery_id = '38300000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"38000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$select public.save_appointment(
      (select id from appointment_fixtures where kind = 'appointment'),
      2,
      '38100000-0000-4000-8000-000000000001',
      '38200000-0000-4000-8000-000000000001',
      now() + interval '14 days',
      90,
      'Rescheduled again',
      'CONFIRMED',
      '38000000-0000-4000-8000-000000000003',
      'Updated notes'
    )$$,
  'Rescheduling an already queued reminder succeeds'
);

select is(
  (select status::text from public.outbound_deliveries where id = '38300000-0000-4000-8000-000000000001'),
  'CANCELED',
  'Rescheduling cancels queued outbound delivery for superseded reminder'
);

select lives_ok(
  $$select public.cancel_appointment((select id from appointment_fixtures where kind = 'appointment'), 3)$$,
  'Expected-version cancel succeeds'
);

select is(
  (select status::text from public.appointments where id = (select id from appointment_fixtures where kind = 'appointment')),
  'CANCELLED',
  'Cancel RPC marks the appointment cancelled'
);

select throws_ok(
  $$select public.save_appointment(
      (select id from appointment_fixtures where kind = 'appointment'),
      4,
      '38100000-0000-4000-8000-000000000001',
      '38200000-0000-4000-8000-000000000001',
      now() + interval '15 days',
      60,
      'Reactivate',
      'SCHEDULED',
      '38000000-0000-4000-8000-000000000003',
      null
    )$$,
  '23514',
  'Closed appointments cannot be reactivated; create a new appointment',
  'Closed appointments cannot be reactivated'
);

select set_config('request.jwt.claims', '{"sub":"38000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$select public.save_appointment(
      null,
      null,
      '38100000-0000-4000-8000-000000000001',
      '38200000-0000-4000-8000-000000000001',
      now() + interval '16 days',
      60,
      'Inactive staff',
      'SCHEDULED',
      null,
      null
    )$$,
  '42501',
  'Active staff access required',
  'Inactive staff cannot save appointments'
);

select * from finish();
rollback;
