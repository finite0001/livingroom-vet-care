begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(4);

-- A raw auth.users insert is the exact path a fresh sign-up or invitation
-- takes through the on_auth_user_created trigger. It must produce an inactive,
-- role-less profile, never an active staff member.
insert into auth.users (id, email, raw_user_meta_data) values
  ('7a100000-0000-4000-8000-000000000001', 'new-signup@example.test', '{"first_name":"New","last_name":"Signup"}');

select is((select is_active from public.profiles where id = '7a100000-0000-4000-8000-000000000001'), false, 'Raw auth insert yields an inactive profile');
select is((select count(*) from public.user_roles where user_id = '7a100000-0000-4000-8000-000000000001'), 0::bigint, 'Raw auth insert assigns no role');
select is(public.is_active_staff('7a100000-0000-4000-8000-000000000001'), false, 'Raw auth insert is not an active staff member');
select is(public.has_role('7a100000-0000-4000-8000-000000000001', 'STAFF'), false, 'Raw auth insert holds no STAFF role');

select * from finish();
rollback;
