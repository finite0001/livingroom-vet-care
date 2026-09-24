-- Keep every appointment write on the housecall-aware contract.
-- Earlier launch-readiness migrations briefly reintroduced a slim appointment
-- RPC and a default reminder trigger. Those bypassed visit/travel/reminder
-- fields and conflicted with the revisioned reminder uniqueness contract.

create or replace function public.guard_appointment_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

  return new;
end
$$;

create or replace function public.create_appointment_reminders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and (
      new.scheduled_at is distinct from old.scheduled_at
      or new.status is distinct from old.status
      or new.client_id is distinct from old.client_id
      or new.pet_id is distinct from old.pet_id
      or new.assigned_dvm_id is distinct from old.assigned_dvm_id
    )
  then
    update public.outbound_deliveries od
    set status = 'CANCELED'::public.outbound_delivery_status,
      canceled_at = now(),
      status_note = 'Canceled because appointment scheduling details changed'
    from public.appointment_reminders ar
    where ar.appointment_id = new.id
      and od.appointment_reminder_id = ar.id
      and od.status in ('QUEUED'::public.outbound_delivery_status, 'LEASED'::public.outbound_delivery_status);

    update public.appointment_reminders ar
    set status = 'SKIPPED'::public.reminder_status,
      error_message = 'Superseded by appointment scheduling change',
      sent_at = null
    where ar.appointment_id = new.id
      and ar.status in ('PENDING'::public.reminder_status, 'QUEUED'::public.reminder_status);
  end if;

  return new;
end
$$;

revoke all on function public.create_appointment_reminders() from public, anon, authenticated, service_role;

create or replace function public.save_appointment(
  p_id uuid,
  p_expected_version integer,
  p_client_id uuid,
  p_pet_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_appointment_type text,
  p_status public.appointment_status,
  p_assigned_dvm_id uuid,
  p_notes text
)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid;
begin
  actor := public.appointment_require_staff();

  return public.save_appointment(
    actor,
    p_id,
    p_expected_version,
    p_client_id,
    p_pet_id,
    p_scheduled_at,
    p_duration_minutes,
    p_appointment_type,
    coalesce(p_status, 'SCHEDULED'::public.appointment_status),
    p_assigned_dvm_id,
    'clinic',
    '2619 Spruce Street, Boulder, CO',
    0,
    0,
    null,
    p_notes,
    array[48, 24]::integer[]
  );
end
$$;

revoke all on function public.save_appointment(uuid, integer, uuid, uuid, timestamptz, integer, text, public.appointment_status, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.save_appointment(uuid, integer, uuid, uuid, timestamptz, integer, text, public.appointment_status, uuid, text)
  to authenticated, service_role;
