-- Candidate forward migration: serialize all staff-clock writers on the profile.
-- Historical migration files and ledger receipts must remain unchanged.

-- Preserve protect_profile_privileges exactly: controlled-stock manifests bind it.
-- Open time_entries are authoritative; profiles.is_on_duty is retained legacy cache.

create or replace function public.clock_in()
returns public.time_entries language plpgsql security definer set search_path = public as $$
declare entry public.time_entries;
begin
  if auth.uid() is null or not public.is_active_staff(auth.uid()) then
    raise exception 'Only active staff can clock in' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = auth.uid() for update;
  if not found or not public.is_active_staff(auth.uid()) then
    raise exception 'Staff profile unavailable or inactive' using errcode = '42501';
  end if;
  if exists (select 1 from public.time_entries where staff_id = auth.uid() and clock_out_at is null) then
    raise exception 'Already clocked in' using errcode = 'PT409';
  end if;
  insert into public.time_entries (staff_id, clock_in_at)
    values (auth.uid(), clock_timestamp()) returning * into entry;
  update public.profiles set is_on_duty = true where id = auth.uid();
  return entry;
end;
$$;

create or replace function public.clock_out()
returns public.time_entries language plpgsql security definer set search_path = public as $$
declare entry public.time_entries;
begin
  if auth.uid() is null or not public.is_active_staff(auth.uid()) then
    raise exception 'Only active staff can clock out' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = auth.uid() for update;
  if not found or not public.is_active_staff(auth.uid()) then
    raise exception 'Staff profile unavailable or inactive' using errcode = '42501';
  end if;
  update public.time_entries set clock_out_at = greatest(clock_timestamp(), clock_in_at)
    where staff_id = auth.uid() and clock_out_at is null returning * into entry;
  if entry.id is null then raise exception 'Not clocked in' using errcode = 'PT409'; end if;
  update public.profiles set is_on_duty = false where id = auth.uid();
  return entry;
end;
$$;

create or replace function public.admin_correct_time_entry(
  p_id uuid,
  p_staff_id uuid,
  p_expected_clock_in_at timestamptz,
  p_expected_clock_out_at timestamptz,
  p_expected_note text,
  p_clock_in_at timestamptz,
  p_clock_out_at timestamptz,
  p_note text,
  p_delete boolean default false
) returns public.time_entries
language plpgsql security definer set search_path = public as $$
declare entry public.time_entries;
begin
  if auth.uid() is null or not public.is_active_staff(auth.uid()) or not public.has_role(auth.uid(), 'ADMIN') then
    raise exception 'Only active administrators can correct time entries' using errcode = '42501';
  end if;
  if p_delete is null then raise exception 'Choose correction or deletion' using errcode = '22023'; end if;
  -- Same lock order as self clock-in/out: profile, then entry.
  perform 1 from public.profiles where id = p_staff_id for update;
  if not found then raise exception 'Staff profile unavailable' using errcode = 'PT409'; end if;
  if not public.is_active_staff(auth.uid()) or not public.has_role(auth.uid(), 'ADMIN') then
    raise exception 'Only active administrators can correct time entries' using errcode = '42501';
  end if;
  select * into entry from public.time_entries where id = p_id and staff_id = p_staff_id for update;
  if not found or entry.clock_in_at is distinct from p_expected_clock_in_at
    or entry.clock_out_at is distinct from p_expected_clock_out_at
    or entry.note is distinct from p_expected_note then
    raise exception 'This entry changed. Refresh the timesheet and review it again' using errcode = 'PT409';
  end if;
  if p_delete then
    delete from public.time_entries where id = entry.id;
  else
    if p_clock_in_at is null or not isfinite(p_clock_in_at) or p_clock_in_at > clock_timestamp()
      or (p_clock_out_at is not null and (not isfinite(p_clock_out_at) or p_clock_out_at <= p_clock_in_at or p_clock_out_at > clock_timestamp())) then
      raise exception 'Use valid times with clock out after clock in and no future times' using errcode = '22023';
    end if;
    if entry.clock_out_at is not null and p_clock_out_at is null then
      raise exception 'Closed entries cannot be reopened' using errcode = '22023';
    end if;
    update public.time_entries set clock_in_at = p_clock_in_at, clock_out_at = p_clock_out_at, note = p_note
      where id = entry.id returning * into entry;
  end if;
  update public.profiles set is_on_duty = exists (
    select 1 from public.time_entries where staff_id = p_staff_id and clock_out_at is null
  ) where id = p_staff_id;
  return entry;
end;
$$;

revoke insert, update, delete on public.time_entries from public, anon, authenticated;
drop policy if exists "Admins update time entries" on public.time_entries;
drop policy if exists "Admins delete time entries" on public.time_entries;
revoke all on function public.admin_correct_time_entry(uuid, uuid, timestamptz, timestamptz, text, timestamptz, timestamptz, text, boolean) from public, anon;
grant execute on function public.admin_correct_time_entry(uuid, uuid, timestamptz, timestamptz, text, timestamptz, timestamptz, text, boolean) to authenticated;
revoke all on function public.clock_in() from public, anon;
revoke all on function public.clock_out() from public, anon;
grant execute on function public.clock_in(), public.clock_out() to authenticated;

create or replace function public.read_on_duty_staff()
returns table(id uuid, full_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_active_staff(auth.uid()) or not public.has_role(auth.uid(), 'ADMIN') then
    raise exception 'Only active administrators can view on-duty staff' using errcode = '42501';
  end if;
  return query select p.id, p.full_name from public.profiles p
    where p.is_active and exists (
      select 1 from public.time_entries t where t.staff_id = p.id and t.clock_out_at is null
    ) order by p.full_name, p.id;
end;
$$;
revoke all on function public.read_on_duty_staff() from public, anon;
grant execute on function public.read_on_duty_staff() to authenticated;
