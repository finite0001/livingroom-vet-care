alter table public.contact_submissions
  add column if not exists triage_status text not null default 'NEW',
  add column if not exists staff_notes text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists contacted_at timestamptz,
  add column if not exists contacted_by uuid references auth.users(id),
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'contact_submissions_triage_status_check'
      and conrelid = 'public.contact_submissions'::regclass
  ) then
    alter table public.contact_submissions
      add constraint contact_submissions_triage_status_check
      check (triage_status in ('NEW', 'CONTACTED', 'CLOSED'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'contact_submissions_staff_notes_length_check'
      and conrelid = 'public.contact_submissions'::regclass
  ) then
    alter table public.contact_submissions
      add constraint contact_submissions_staff_notes_length_check
      check (staff_notes is null or char_length(staff_notes) <= 5000);
  end if;
end $$;

create or replace function public.guard_contact_submission()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Original website submissions are immutable' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.name is distinct from old.name
      or new.email is distinct from old.email
      or new.phone is distinct from old.phone
      or new.subject is distinct from old.subject
      or new.message is distinct from old.message
      or new.created_at is distinct from old.created_at
    then
      raise exception 'Original website submissions are immutable' using errcode = '23514';
    end if;

    if (new.reviewed_by is not null and new.reviewed_by is distinct from old.reviewed_by and new.reviewed_by is distinct from auth.uid())
      or (new.contacted_by is not null and new.contacted_by is distinct from old.contacted_by and new.contacted_by is distinct from auth.uid())
      or (new.closed_by is not null and new.closed_by is distinct from old.closed_by and new.closed_by is distinct from auth.uid())
    then
      raise exception 'Contact submission triage actor must match authenticated user' using errcode = '23514';
    end if;

    return new;
  end if;

  if length(trim(new.name)) not between 1 and 100
    or length(new.email) not between 3 and 255
    or new.email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or coalesce(length(new.phone), 0) > 20
    or length(trim(new.subject)) not between 1 and 200
    or length(trim(new.message)) not between 1 and 2000
  then
    raise exception 'Invalid website contact fields' using errcode = '23514';
  end if;

  return new;
end
$$;

drop trigger if exists guard_contact_submission on public.contact_submissions;
create trigger guard_contact_submission
  before insert or update or delete on public.contact_submissions
  for each row execute function public.guard_contact_submission();

create index if not exists idx_contact_submissions_triage_status
  on public.contact_submissions (triage_status, created_at desc);

drop policy if exists "Active staff update contact_submissions triage" on public.contact_submissions;
create policy "Active staff update contact_submissions triage"
  on public.contact_submissions
  for update
  to authenticated
  using (public.is_active_staff(auth.uid()))
  with check (public.is_active_staff(auth.uid()));

drop policy if exists "Anon insert contact_submissions" on public.contact_submissions;
create policy "Anon insert contact_submissions"
  on public.contact_submissions
  for insert
  to anon, authenticated
  with check (
    triage_status = 'NEW'
    and staff_notes is null
    and reviewed_at is null
    and reviewed_by is null
    and contacted_at is null
    and contacted_by is null
    and closed_at is null
    and closed_by is null
  );

revoke insert on public.contact_submissions from anon, authenticated;
grant insert (
  name,
  email,
  phone,
  subject,
  message
) on public.contact_submissions to anon, authenticated;

grant update (
  triage_status,
  staff_notes,
  reviewed_at,
  reviewed_by,
  contacted_at,
  contacted_by,
  closed_at,
  closed_by,
  updated_at
) on public.contact_submissions to authenticated;

drop trigger if exists update_contact_submissions_updated_at on public.contact_submissions;
create trigger update_contact_submissions_updated_at
  before update on public.contact_submissions
  for each row execute function public.update_updated_at_column();

drop trigger if exists audit_contact_submissions on public.contact_submissions;
create trigger audit_contact_submissions
  after update on public.contact_submissions
  for each row execute function public.audit_trigger_fn();
