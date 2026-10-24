-- A5: prove a staff member cannot place themselves on duty by writing
-- profiles.is_on_duty directly, while every sanctioned path still works.
--
-- The risk this closes is not the column itself but the desync: appearing
-- available for work without an open shift, or clearing duty while one is still
-- open. The guard therefore checks consistency with the caller's own
-- time_entries, not the caller's role - see the migration's comment for why a
-- role check would have broken clock_in() for every non-admin.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Fixtures are written as the migration owner, where auth.uid() is null and the
-- trigger deliberately steps aside.
insert into auth.users(id,email,raw_user_meta_data) values
  ('a5000000-0000-4000-8000-000000000001','a5-admin@example.test','{}'),
  ('a5000000-0000-4000-8000-000000000002','a5-staff@example.test','{}');

update public.profiles set is_active = true
  where id in ('a5000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000002');

insert into public.user_roles(user_id,role) values
  ('a5000000-0000-4000-8000-000000000001','STAFF'),
  ('a5000000-0000-4000-8000-000000000001','ADMIN'),
  ('a5000000-0000-4000-8000-000000000002','STAFF');

-- A plain staff member.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a5000000-0000-4000-8000-000000000002"}',true);

select throws_ok(
  $$update public.profiles set is_on_duty = true where id = 'a5000000-0000-4000-8000-000000000002'$$,
  'P0001','Only clocking in can mark staff on duty',
  'A staff member cannot put themselves on duty directly');

select throws_ok(
  $$update public.profiles set is_active = false where id = 'a5000000-0000-4000-8000-000000000002'$$,
  'P0001','Only admins can change profile active status',
  'The existing active-status guard is unchanged');

select throws_ok(
  $$update public.profiles set role = 'ADMIN' where id = 'a5000000-0000-4000-8000-000000000002'$$,
  'P0001','Only admins can change profile role',
  'The existing role guard is unchanged');

select lives_ok(
  $$select public.clock_in()$$,
  'Clocking in still works for a non-admin');

select is(
  (select is_on_duty from public.profiles where id = 'a5000000-0000-4000-8000-000000000002'),
  true,
  'Clocking in is what puts staff on duty');

select throws_ok(
  $$update public.profiles set is_on_duty = false where id = 'a5000000-0000-4000-8000-000000000002'$$,
  'P0001','An open shift keeps staff on duty',
  'Duty cannot be cleared while a shift is still open');

select lives_ok(
  $$select public.clock_out()$$,
  'Clocking out still works for a non-admin');

select is(
  (select is_on_duty from public.profiles where id = 'a5000000-0000-4000-8000-000000000002'),
  false,
  'Clocking out is what takes staff off duty');

select lives_ok(
  $$update public.profiles set full_name = 'Synthetic A5 staff' where id = 'a5000000-0000-4000-8000-000000000002'$$,
  'An unrelated profile edit is still allowed');

-- The admin path: closing a shift from the time-clock screen clears duty after
-- the entry is closed, which the guard permits; an admin setting duty directly
-- passes because admins return early.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a5000000-0000-4000-8000-000000000001"}',true);

select lives_ok(
  $$update public.profiles set is_on_duty = true where id = 'a5000000-0000-4000-8000-000000000002'$$,
  'An admin can set duty directly');

select lives_ok(
  $$update public.profiles set is_on_duty = false where id = 'a5000000-0000-4000-8000-000000000002'$$,
  'An admin can clear duty directly');

select * from finish();
rollback;
