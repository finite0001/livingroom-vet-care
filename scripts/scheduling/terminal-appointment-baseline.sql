-- Exact hosted production/staging function snapshot, November6 2026. Test fixture only.
CREATE OR REPLACE FUNCTION public.guard_appointment_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := auth.uid();
  patient record;
begin
  if tg_op = 'DELETE' then
    raise exception 'Appointments cannot be deleted; cancel them instead' using errcode = '23514';
  end if;

  if actor is not null and not public.is_active_staff(actor) then
    raise exception 'Active staff access required' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.created_at is distinct from old.created_at
      or new.created_by is distinct from old.created_by
    then
      raise exception 'Appointment identity and creation metadata are immutable' using errcode = '23514';
    end if;

    if old.status in ('CANCELLED'::public.appointment_status, 'COMPLETED'::public.appointment_status, 'NO_SHOW'::public.appointment_status)
      and new.status in ('SCHEDULED'::public.appointment_status, 'CONFIRMED'::public.appointment_status)
    then
      raise exception 'Closed appointments cannot be reactivated; create a new appointment' using errcode = '23514';
    end if;
  end if;

  if new.duration_minutes is null or new.duration_minutes < 15 or new.duration_minutes > 480 then
    raise exception 'Appointment duration must be between 15 and 480 minutes' using errcode = '23514';
  end if;

  if nullif(btrim(coalesce(new.appointment_type, '')), '') is null
    or length(btrim(new.appointment_type)) > 160
  then
    raise exception 'Appointment type is required' using errcode = '23514';
  end if;

  new.appointment_type := btrim(new.appointment_type);
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');

  if new.notes is not null and length(new.notes) > 10000 then
    raise exception 'Appointment notes are too long' using errcode = '23514';
  end if;

  if new.pet_id is not null then
    select p.client_id, p.archived_at, p.deceased_at
    into patient
    from public.pets p
    where p.id = new.pet_id;

    if not found then
      raise exception 'Appointment patient does not exist' using errcode = '23503';
    end if;

    if patient.client_id is distinct from new.client_id then
      raise exception 'Appointment patient must belong to the selected client' using errcode = '23514';
    end if;

    if actor is not null
      and new.status in ('SCHEDULED'::public.appointment_status, 'CONFIRMED'::public.appointment_status)
      and patient.archived_at is not null
    then
      raise exception 'Archived patients cannot be scheduled' using errcode = '23514';
    end if;

    if actor is not null
      and new.status in ('SCHEDULED'::public.appointment_status, 'CONFIRMED'::public.appointment_status)
      and patient.deceased_at is not null
    then
      raise exception 'Deceased patients cannot be scheduled' using errcode = '23514';
    end if;
  end if;

  if actor is not null and new.assigned_dvm_id is not null and not public.is_active_staff(new.assigned_dvm_id) then
    raise exception 'Assigned clinician must be active staff' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    new.version := 1;
    if actor is not null then
      new.created_by := actor;
      new.updated_by := actor;
    end if;
  else
    if new.version is null or new.version <= old.version then
      new.version := old.version + 1;
    elsif new.version <> old.version + 1 then
      raise exception 'Appointment version increments must be sequential' using errcode = '23514';
    end if;

    if actor is not null then
      new.updated_by := actor;
    end if;
  end if;

  perform public.guard_appointment_catalog(new,case when tg_op='UPDATE' then old else null::public.appointments end); return new;
end
$function$

;
CREATE OR REPLACE FUNCTION public.cancel_appointment_before_catalog(p_id uuid, p_expected_version integer)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _lrv_care_gate boolean:=public.care_eligibility_lock();
  result public.appointments;
  actor uuid;
begin
  actor := public.appointment_require_staff();

  if p_expected_version is null then
    raise exception 'Expected appointment version is required' using errcode = '23514';
  end if;

  update public.appointments
  set status = 'CANCELLED'::public.appointment_status,
    updated_by = actor
  where id = p_id
    and version = p_expected_version
  returning * into result;

  if not found then
    raise exception 'Appointment changed or no longer exists; reload before cancelling' using errcode = 'PT409';
  end if;

  return result;
end
$function$

;
CREATE OR REPLACE FUNCTION public.cancel_appointment(p_id uuid, p_expected_version integer)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin perform public.clinical_require_staff();perform pg_advisory_xact_lock(73260123);return public.cancel_appointment_before_catalog(p_id,p_expected_version);end $function$

;
