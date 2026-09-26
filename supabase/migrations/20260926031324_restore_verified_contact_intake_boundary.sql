-- The triage migration restored a column-level Data API write path. Website
-- inquiries must enter through the challenge-verified service RPC instead.
drop policy if exists "Anon insert contact_submissions" on public.contact_submissions;
revoke insert on public.contact_submissions from public, anon, authenticated, service_role;
revoke insert (name, email, phone, subject, message)
  on public.contact_submissions from public, anon, authenticated, service_role;

-- The verified RPC has replay handling and a claimed-email hourly budget.
-- The later trigger's duplicate and three-per-day checks reject accepted RPC
-- requests, so retain field/immutability validation without those checks.
create or replace function public.guard_contact_submission()
returns trigger
language plpgsql
security invoker
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
