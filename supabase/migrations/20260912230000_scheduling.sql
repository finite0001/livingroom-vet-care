-- Serialized scheduling writes protect concurrent bookings and reminder revisions.
alter table public.appointments
 add column visit_type text not null default 'clinic' check (visit_type in ('clinic','housecall')),
 add column address_snapshot text not null default '2619 Spruce Street, Boulder, CO',
 add column travel_before_minutes integer not null default 0 check (travel_before_minutes between 0 and 240),
 add column travel_after_minutes integer not null default 0 check (travel_after_minutes between 0 and 240),
 add column resource_name text,
 add column reminder_offsets integer[] not null default array[48,24],
 add column version integer not null default 1,
 add column updated_by uuid references auth.users(id);
alter table public.appointment_reminders add column appointment_version integer not null default 1;
alter table public.appointment_reminders drop constraint appointment_reminders_unique;
alter table public.appointment_reminders add constraint appointment_reminders_revision_unique unique (appointment_id,appointment_version,remind_at,channel);
drop trigger if exists trg_create_appointment_reminders on public.appointments;
drop trigger if exists trg_appointment_reminders on public.appointments;
revoke insert,update,delete on public.appointments,public.appointment_reminders from authenticated,anon,service_role;
-- Only the future dispatcher may consume due jobs; staff cannot claim delivery.
revoke execute on function public.process_due_reminders() from authenticated;

create function public.save_appointment(p_actor_id uuid,p_id uuid,p_expected_version integer,p_client_id uuid,p_pet_id uuid,p_scheduled_at timestamptz,p_duration_minutes integer,p_appointment_type text,p_status public.appointment_status,p_assigned_dvm_id uuid,p_visit_type text,p_address_snapshot text,p_travel_before_minutes integer,p_travel_after_minutes integer,p_resource_name text,p_notes text,p_reminder_offsets integer[])
returns public.appointments language plpgsql security definer set search_path=public as $$
declare actor uuid; result public.appointments; previous public.appointments; offset_hours integer; busy_start timestamptz; busy_end timestamptz;
begin
 actor := public.clinical_require_staff();
 if p_actor_id is distinct from actor then raise exception 'Actor mismatch' using errcode='42501'; end if;
 -- A transaction-scoped schedule lock also covers clinician reassignment and shared rooms.
 perform pg_advisory_xact_lock(73260123);
 if p_id is not null then
  select * into previous from public.appointments where id=p_id for update;
  if not found or previous.version is distinct from p_expected_version then raise exception 'Appointment changed; reload before saving' using errcode='40001'; end if;
 end if;
 if p_client_id is null or p_pet_id is null or not exists(select 1 from public.pets where id=p_pet_id and client_id=p_client_id and ((archived_at is null and deceased_at is null) or (p_status='CANCELLED' and previous.pet_id=p_pet_id and previous.client_id=p_client_id))) then raise exception 'Select an active patient belonging to this household' using errcode='23514'; end if;
 if p_assigned_dvm_id is null or (not public.is_active_staff(p_assigned_dvm_id) and not coalesce(p_status='CANCELLED' and previous.assigned_dvm_id=p_assigned_dvm_id,false)) then raise exception 'Select an active staff clinician' using errcode='23514'; end if;
 if p_scheduled_at is null or not isfinite(p_scheduled_at) or p_duration_minutes is null or p_duration_minutes not between 5 and 480 or p_visit_type is null or p_visit_type not in ('clinic','housecall') or p_status is null or p_travel_before_minutes is null or p_travel_before_minutes not between 0 and 240 or p_travel_after_minutes is null or p_travel_after_minutes not between 0 and 240 then raise exception 'Invalid appointment time or duration' using errcode='23514'; end if;
 if p_appointment_type is null or length(trim(p_appointment_type)) not between 1 and 150 or p_address_snapshot is null or length(trim(p_address_snapshot)) not between 1 and 1000 or length(p_notes)>10000 or length(p_resource_name)>150 then raise exception 'Appointment fields are missing or too long' using errcode='23514'; end if;
 if p_reminder_offsets is null or cardinality(p_reminder_offsets)>5 or exists(select 1 from unnest(p_reminder_offsets) h where h is null or h not between 1 and 720) or cardinality(p_reminder_offsets)<>(select count(distinct h) from unnest(p_reminder_offsets) h) then raise exception 'Use up to five distinct reminder offsets between 1 and 720 hours' using errcode='23514'; end if;
 busy_start := p_scheduled_at - make_interval(mins=>p_travel_before_minutes);
 busy_end := p_scheduled_at + make_interval(mins=>p_duration_minutes+p_travel_after_minutes);
 if p_status in ('SCHEDULED','CONFIRMED') and exists (
  select 1 from public.appointments a where a.id is distinct from p_id and a.status in ('SCHEDULED','CONFIRMED')
  and (a.assigned_dvm_id=p_assigned_dvm_id or (nullif(trim(p_resource_name),'') is not null and lower(a.resource_name)=lower(trim(p_resource_name))))
  and a.scheduled_at-make_interval(mins=>a.travel_before_minutes)<busy_end
  and a.scheduled_at+make_interval(mins=>a.duration_minutes+a.travel_after_minutes)>busy_start
 ) then raise exception 'Clinician or room is already booked, including travel buffers' using errcode='23P01'; end if;
 if p_id is null then
  insert into public.appointments(client_id,pet_id,scheduled_at,duration_minutes,appointment_type,status,assigned_dvm_id,visit_type,address_snapshot,travel_before_minutes,travel_after_minutes,resource_name,notes,reminder_offsets,updated_by)
  values(p_client_id,p_pet_id,p_scheduled_at,p_duration_minutes,trim(p_appointment_type),p_status,p_assigned_dvm_id,p_visit_type,case when p_visit_type='clinic' then '2619 Spruce Street, Boulder, CO' else trim(p_address_snapshot) end,p_travel_before_minutes,p_travel_after_minutes,nullif(trim(p_resource_name),''),p_notes,p_reminder_offsets,actor) returning * into result;
 else
  update public.appointments set client_id=p_client_id,pet_id=p_pet_id,scheduled_at=p_scheduled_at,duration_minutes=p_duration_minutes,appointment_type=trim(p_appointment_type),status=p_status,assigned_dvm_id=p_assigned_dvm_id,visit_type=p_visit_type,address_snapshot=case when p_visit_type='clinic' then '2619 Spruce Street, Boulder, CO' else trim(p_address_snapshot) end,travel_before_minutes=p_travel_before_minutes,travel_after_minutes=p_travel_after_minutes,resource_name=nullif(trim(p_resource_name),''),notes=p_notes,reminder_offsets=p_reminder_offsets,updated_by=actor,version=version+1 where id=p_id returning * into result;
 end if;
 update public.appointment_reminders set status='SKIPPED',error_message='Appointment revised' where appointment_id=result.id and status='PENDING';
 if result.status in ('SCHEDULED','CONFIRMED') then
  foreach offset_hours in array result.reminder_offsets loop
   insert into public.appointment_reminders(appointment_id,appointment_version,remind_at,channel,status)
   values(result.id,result.version,result.scheduled_at-make_interval(hours=>offset_hours),'SMS',case when result.scheduled_at-make_interval(hours=>offset_hours)>now() then 'PENDING'::public.reminder_status else 'SKIPPED'::public.reminder_status end);
  end loop;
 end if;
 return result;
end $$;
revoke all on function public.save_appointment(uuid,uuid,integer,uuid,uuid,timestamptz,integer,text,public.appointment_status,uuid,text,text,integer,integer,text,text,integer[]) from public,anon,service_role;
grant execute on function public.save_appointment(uuid,uuid,integer,uuid,uuid,timestamptz,integer,text,public.appointment_status,uuid,text,text,integer,integer,text,text,integer[]) to authenticated;
create trigger audit_appointments after insert or update on public.appointments for each row execute function public.audit_trigger_fn();

-- Role rows remain private; expose only eligible clinician names to active staff.
create function public.schedule_clinicians() returns table(id uuid,full_name text) language plpgsql security definer set search_path=public as $$
begin
 perform public.clinical_require_staff();
 return query select p.id,p.full_name from public.profiles p where public.is_active_staff(p.id) order by p.full_name;
end $$;
revoke all on function public.schedule_clinicians() from public,anon,service_role;
grant execute on function public.schedule_clinicians() to authenticated;

create function public.invalidate_inactive_patient_reminders() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if NEW.archived_at is not null or NEW.deceased_at is not null then
  update public.appointment_reminders r set status='SKIPPED',error_message='Patient inactive'
  from public.appointments a where a.id=r.appointment_id and a.pet_id=NEW.id and r.status='PENDING';
 end if;
 return NEW;
end $$;
create trigger invalidate_inactive_patient_reminders after update of archived_at,deceased_at on public.pets for each row execute function public.invalidate_inactive_patient_reminders();
revoke all on function public.invalidate_inactive_patient_reminders() from public,anon,authenticated,service_role;
