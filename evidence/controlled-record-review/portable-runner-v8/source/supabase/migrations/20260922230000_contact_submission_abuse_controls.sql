create index if not exists idx_contact_submissions_email_created_at
  on public.contact_submissions (lower(btrim(email)), created_at desc);

create or replace function public.guard_contact_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text;
  matching_recent_count integer;
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

  normalized_email := lower(btrim(new.email));

  select count(*)
  into matching_recent_count
  from public.contact_submissions cs
  where lower(btrim(cs.email)) = normalized_email
    and cs.created_at >= now() - interval '24 hours';

  if matching_recent_count >= 3 then
    raise exception 'Too many contact submissions from this email address; please try again later'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.contact_submissions cs
    where lower(btrim(cs.email)) = normalized_email
      and lower(btrim(cs.subject)) = lower(btrim(new.subject))
      and lower(btrim(cs.message)) = lower(btrim(new.message))
      and cs.created_at >= now() - interval '15 minutes'
  ) then
    raise exception 'Duplicate contact submission received too recently; please try again later'
      using errcode = '23514';
  end if;

  return new;
end
$$;

revoke all on function public.guard_contact_submission() from public, anon, authenticated, service_role;
