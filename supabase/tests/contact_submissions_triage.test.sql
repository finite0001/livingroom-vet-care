begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('36000000-0000-4000-8000-000000000001', 'contact-active@example.test', '{}'),
  ('36000000-0000-4000-8000-000000000002', 'contact-inactive@example.test', '{}');
update public.profiles set is_active = true where id = '36000000-0000-4000-8000-000000000001';
update public.profiles set is_active = false where id = '36000000-0000-4000-8000-000000000002';
insert into public.user_roles (user_id, role)
values ('36000000-0000-4000-8000-000000000001', 'STAFF')
on conflict do nothing;

insert into public.contact_submissions (
  id,
  name,
  email,
  phone,
  subject,
  message
) values (
  '37000000-0000-4000-8000-000000000001',
  'Synthetic Client',
  'client@example.test',
  '+13035550100',
  'Question',
  'Can you help?'
);

select is(
  (select triage_status from public.contact_submissions where id = '37000000-0000-4000-8000-000000000001'),
  'NEW',
  'Contact submissions default to new triage status'
);

select ok(has_column_privilege('authenticated', 'public.contact_submissions', 'triage_status', 'UPDATE'), 'Authenticated staff have explicit triage status update grant');
select ok(has_column_privilege('authenticated', 'public.contact_submissions', 'staff_notes', 'UPDATE'), 'Authenticated staff have explicit staff notes update grant');
select ok(not has_column_privilege('authenticated', 'public.contact_submissions', 'name', 'UPDATE'), 'Authenticated staff cannot edit submitted contact names');
select ok(has_column_privilege('anon', 'public.contact_submissions', 'message', 'INSERT'), 'Anonymous callers can insert public contact form fields');
select ok(not has_column_privilege('anon', 'public.contact_submissions', 'staff_notes', 'INSERT'), 'Anonymous callers cannot insert staff notes');
select ok(not has_table_privilege('anon', 'public.contact_submissions', 'UPDATE'), 'Anonymous callers have no contact submission update grant');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"36000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$update public.contact_submissions
    set triage_status = 'CONTACTED',
      staff_notes = 'Left voicemail.',
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      contacted_at = now(),
      contacted_by = auth.uid()
    where id = '37000000-0000-4000-8000-000000000001'$$,
  'Active staff can update contact submission triage'
);
select is(
  (select triage_status from public.contact_submissions where id = '37000000-0000-4000-8000-000000000001'),
  'CONTACTED',
  'Active staff triage update persists'
);
select is(
  (select reviewed_by from public.contact_submissions where id = '37000000-0000-4000-8000-000000000001'),
  '36000000-0000-4000-8000-000000000001'::uuid,
  'Reviewed metadata stores the active staff actor'
);
select is(
  (select contacted_by from public.contact_submissions where id = '37000000-0000-4000-8000-000000000001'),
  '36000000-0000-4000-8000-000000000001'::uuid,
  'Contacted metadata stores the active staff actor'
);
select throws_ok(
  $$update public.contact_submissions
    set reviewed_by = '36000000-0000-4000-8000-000000000002'
    where id = '37000000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'Active staff cannot spoof contact triage actor metadata'
);
select throws_ok(
  $$update public.contact_submissions set name = 'Changed' where id = '37000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'Active staff cannot update original public submission fields'
);
select throws_ok(
  $$update public.contact_submissions set triage_status = 'SPAM' where id = '37000000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'Triage status is constrained'
);

select set_config('request.jwt.claims', '{"sub":"36000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
with changed as (
  update public.contact_submissions
  set staff_notes = 'Inactive staff should not write.'
  where id = '37000000-0000-4000-8000-000000000001'
  returning 1
)
select is((select count(*) from changed), 0::bigint, 'Inactive staff cannot update contact submission triage');

reset role;
select is(
  (select staff_notes from public.contact_submissions where id = '37000000-0000-4000-8000-000000000001'),
  'Left voicemail.',
  'Inactive staff update did not change staff notes'
);
select ok(
  exists (
    select 1
    from public.audit_logs
    where table_name = 'contact_submissions'
      and record_id = '37000000-0000-4000-8000-000000000001'
      and user_id = '36000000-0000-4000-8000-000000000001'
      and action = 'UPDATE'
  ),
  'Contact submission triage updates are audited'
);

set local role anon;
select lives_ok(
  $$insert into public.contact_submissions(name,email,subject,message) values ('Public', 'public@example.test', 'Hello', 'Public insert still works')$$,
  'Public contact form can still insert after triage columns were added'
);
select throws_ok(
  $$insert into public.contact_submissions(name,email,subject,message,staff_notes) values ('Public', 'public@example.test', 'Hello', 'Nope', 'Forged note')$$,
  '42501',
  null,
  'Anonymous callers cannot forge contact triage metadata on insert'
);
select throws_ok(
  $$insert into public.contact_submissions(name,email,subject,message) values ('', 'not-an-email', '', '')$$,
  '23514',
  null,
  'Public contact submission guard rejects invalid website fields'
);
select lives_ok(
  $$insert into public.contact_submissions(name,email,subject,message) values ('Rate One', 'limit@example.test', 'One', 'First allowed message')$$,
  'First contact submission from an email is accepted'
);
select lives_ok(
  $$insert into public.contact_submissions(name,email,subject,message) values ('Rate Two', 'limit@example.test', 'Two', 'Second allowed message')$$,
  'Second contact submission from an email is accepted'
);
select lives_ok(
  $$insert into public.contact_submissions(name,email,subject,message) values ('Rate Three', 'limit@example.test', 'Three', 'Third allowed message')$$,
  'Third contact submission from an email is accepted'
);
select throws_ok(
  $$insert into public.contact_submissions(name,email,subject,message) values ('Rate Four', 'limit@example.test', 'Four', 'Fourth blocked message')$$,
  '23514',
  'Too many contact submissions from this email address; please try again later',
  'Public contact submissions are rate-limited by email'
);
select lives_ok(
  $$insert into public.contact_submissions(name,email,subject,message) values ('Duplicate', 'duplicate@example.test', 'Same', 'Same message')$$,
  'Initial public contact submission for duplicate check is accepted'
);
select throws_ok(
  $$insert into public.contact_submissions(name,email,subject,message) values ('Duplicate', 'duplicate@example.test', 'Same', 'Same message')$$,
  '23514',
  'Duplicate contact submission received too recently; please try again later',
  'Duplicate public contact submissions are blocked'
);
select throws_ok(
  $$update public.contact_submissions set triage_status = 'CLOSED' where id = '37000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'Anonymous callers cannot update contact submission triage'
);

reset role;
select * from finish();
rollback;
