alter table public.appointments
  add column if not exists version integer not null default 1,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

create index if not exists idx_appointments_active_dvm_time
  on public.appointments (assigned_dvm_id, scheduled_at)
  where status in ('SCHEDULED'::public.appointment_status, 'CONFIRMED'::public.appointment_status);

create or replace function public.appointment_require_staff()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or not public.is_active_staff(actor) then
    raise exception 'Active staff access required' using errcode = '42501';
  end if;

  return actor;
end
$$;

revoke all on function public.appointment_require_staff() from public, anon, authenticated, service_role;

create or replace function public.guard_appointment_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  patient record;
  assigned_dvm_is_valid boolean;
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

  if actor is not null and new.assigned_dvm_id is not null then
    select exists (
      select 1
      from public.profiles p
      join public.user_roles ur on ur.user_id = p.id
      where p.id = new.assigned_dvm_id
        and p.is_active = true
        and ur.role = 'DVM'::public.user_role
    )
    into assigned_dvm_is_valid;

    if not assigned_dvm_is_valid then
      raise exception 'Assigned clinician must be an active DVM' using errcode = '23514';
    end if;
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

drop trigger if exists guard_appointment_write on public.appointments;
create trigger guard_appointment_write
  before insert or update or delete on public.appointments
  for each row execute function public.guard_appointment_write();

drop trigger if exists audit_appointments on public.appointments;
create trigger audit_appointments
  after insert or update on public.appointments
  for each row execute function public.audit_trigger_fn();

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

  if new.status in ('SCHEDULED'::public.appointment_status, 'CONFIRMED'::public.appointment_status)
    and new.scheduled_at > now()
  then
    insert into public.appointment_reminders (appointment_id, remind_at, channel, status, error_message, sent_at, outbound_delivery_id, enqueued_at)
    values
      (new.id, new.scheduled_at - interval '48 hours', 'SMS', 'PENDING'::public.reminder_status, null, null, null, null),
      (new.id, new.scheduled_at - interval '24 hours', 'SMS', 'PENDING'::public.reminder_status, null, null, null, null)
    on conflict (appointment_id, remind_at, channel) do update
    set status = 'PENDING'::public.reminder_status,
      error_message = null,
      sent_at = null,
      outbound_delivery_id = null,
      enqueued_at = null
    where appointment_reminders.status in ('PENDING'::public.reminder_status, 'FAILED'::public.reminder_status, 'SKIPPED'::public.reminder_status);
  end if;

  return new;
end
$$;

revoke all on function public.create_appointment_reminders() from public, anon, authenticated, service_role;

drop trigger if exists trg_create_appointment_reminders on public.appointments;
drop trigger if exists trg_appointment_reminders on public.appointments;
create trigger trg_create_appointment_reminders
  after insert or update on public.appointments
  for each row execute function public.create_appointment_reminders();

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
  result public.appointments;
  actor uuid;
begin
  actor := public.appointment_require_staff();

  if p_id is null then
    insert into public.appointments (
      client_id,
      pet_id,
      scheduled_at,
      duration_minutes,
      appointment_type,
      status,
      assigned_dvm_id,
      notes,
      created_by,
      updated_by
    ) values (
      p_client_id,
      p_pet_id,
      p_scheduled_at,
      p_duration_minutes,
      p_appointment_type,
      coalesce(p_status, 'SCHEDULED'::public.appointment_status),
      p_assigned_dvm_id,
      p_notes,
      actor,
      actor
    )
    returning * into result;
  else
    if p_expected_version is null then
      raise exception 'Expected appointment version is required' using errcode = '23514';
    end if;

    update public.appointments
    set client_id = p_client_id,
      pet_id = p_pet_id,
      scheduled_at = p_scheduled_at,
      duration_minutes = p_duration_minutes,
      appointment_type = p_appointment_type,
      status = coalesce(p_status, status),
      assigned_dvm_id = p_assigned_dvm_id,
      notes = p_notes,
      updated_by = actor
    where id = p_id
      and version = p_expected_version
    returning * into result;

    if not found then
      raise exception 'Appointment changed or no longer exists; reload before saving' using errcode = '40001';
    end if;
  end if;

  return result;
end
$$;

create or replace function public.cancel_appointment(
  p_id uuid,
  p_expected_version integer
)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
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
    raise exception 'Appointment changed or no longer exists; reload before cancelling' using errcode = '40001';
  end if;

  return result;
end
$$;

revoke all on function public.save_appointment(uuid, integer, uuid, uuid, timestamptz, integer, text, public.appointment_status, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.save_appointment(uuid, integer, uuid, uuid, timestamptz, integer, text, public.appointment_status, uuid, text)
  to authenticated, service_role;

revoke all on function public.cancel_appointment(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_appointment(uuid, integer)
  to authenticated, service_role;

drop policy if exists "Auth manage appointments" on public.appointments;
drop policy if exists "Active staff read appointments" on public.appointments;

revoke all privileges on public.appointments from public, anon, authenticated, service_role;
grant select on public.appointments to authenticated, service_role;
grant insert, update on public.appointments to service_role;

create policy "Active staff read appointments"
  on public.appointments
  for select
  to authenticated
  using (public.is_active_staff(auth.uid()));
