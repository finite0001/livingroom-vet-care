-- A5: a staff member must not be able to place themselves on duty by writing
-- profiles.is_on_duty directly. The sanctioned path is clock_in() / clock_out(),
-- which also write a time_entries row.
--
-- The obvious fix - adding is_on_duty to the fields protect_profile_privileges
-- already guards - would break clocking in for every non-admin. clock_in() and
-- clock_out() are SECURITY DEFINER, but auth.uid() inside them is still the
-- caller, so the trigger sees a non-admin and would raise. The rule below is
-- therefore consistency with the caller's own time entries, not a role check:
--
--   * going on duty requires an open shift  (what clock_in() creates first)
--   * leaving duty requires that no shift is open (what clock_out() closes first)
--
-- Every sanctioned writer already does it in that order, so all of them keep
-- working untouched:
--   clock_in()                - inserts the open entry, then sets on duty
--   clock_out()               - closes the entry, then clears duty
--   useAdminUpdateTimeEntry    - closes the entry, then clears duty
--   useAdminDeleteTimeEntry    - deletes the entry, then clears duty
-- Admins return early above and are unaffected, as are system and service
-- contexts where auth.uid() is null.

create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- definer/system contexts
  end if;
  if public.has_role(auth.uid(), 'ADMIN') then
    return new;
  end if;
  if new.is_active is distinct from old.is_active then
    raise exception 'Only admins can change profile active status';
  end if;
  if new.role is distinct from old.role then
    raise exception 'Only admins can change profile role';
  end if;
  if new.is_on_duty is distinct from old.is_on_duty then
    if new.is_on_duty and not exists (
      select 1
      from public.time_entries
      where staff_id = auth.uid()
        and clock_out_at is null
    ) then
      raise exception 'Only clocking in can mark staff on duty';
    end if;
    if not new.is_on_duty and exists (
      select 1
      from public.time_entries
      where staff_id = auth.uid()
        and clock_out_at is null
    ) then
      raise exception 'An open shift keeps staff on duty';
    end if;
  end if;
  return new;
end;
$$;
