-- Explicit appointment identity for clinician dictation. No policy activation or provider calls.
create table public.appointment_clinical_links (
 appointment_id uuid primary key references public.appointments(id) on delete restrict,
 encounter_id uuid not null unique references public.clinical_encounters(id) on delete restrict,
 pet_id uuid not null references public.pets(id) on delete restrict,
 client_id uuid not null references public.clients(id) on delete restrict,
 appointment_version integer not null,
 context jsonb not null check(jsonb_typeof(context)='object'),
 actor_id uuid not null references auth.users(id) on delete restrict,
 session_id uuid not null,
 created_at timestamptz not null default now()
);
alter table public.appointment_clinical_links enable row level security;
revoke all on public.appointment_clinical_links from public,anon,authenticated,service_role;
create function public.appointment_clinical_context(a public.appointments) returns jsonb
language sql immutable set search_path=public,pg_temp as $$
 select jsonb_build_object('pet_id',a.pet_id,'client_id',a.client_id,'scheduled_at_epoch',extract(epoch from a.scheduled_at),
 'visit_type',a.visit_type,'address_snapshot',a.address_snapshot)
$$;
create function public.guard_appointment_clinical_link() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'Appointment clinical links are immutable' using errcode='23514';end $$;
create trigger appointment_clinical_link_immutable before update or delete on public.appointment_clinical_links
for each row execute function public.guard_appointment_clinical_link();

create function public.read_appointment_dictation(p_actor_id uuid,p_pet_id uuid,p_appointment_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.appointments;p public.pets;c public.clients;l public.appointment_clinical_links;e public.clinical_encounters;
begin
 perform public.clinical_dictation_actor(p_actor_id);
 select * into a from public.appointments where id=p_appointment_id;
 if not found or a.pet_id is distinct from p_pet_id then raise exception 'Appointment does not belong to this patient' using errcode='23514';end if;
 select * into p from public.pets where id=p_pet_id;
 select * into c from public.clients where id=a.client_id;
 select * into l from public.appointment_clinical_links where appointment_id=a.id;
 if found then select * into e from public.clinical_encounters where id=l.encounter_id;end if;
 return jsonb_build_object('actor_id',p_actor_id,'pet_id',p_pet_id,'appointment_id',a.id,
 'version',a.version,'patient_name',p.name,'species',p.species,'household_name',c.full_name,
 'scheduled_at',a.scheduled_at,'visit_type',a.visit_type,'location',a.address_snapshot,
 'appointment_type',a.appointment_type,'status',a.status,'assigned_dvm_id',a.assigned_dvm_id,
 'assigned_dvm_name',(select full_name from public.profiles where id=a.assigned_dvm_id),
 'eligible',p.archived_at is null and p.deceased_at is null and p.client_id=a.client_id
   and a.status in('SCHEDULED','CONFIRMED','COMPLETED') and (a.status<>'COMPLETED' or l.encounter_id is not null),
 'context_changed',l.encounter_id is not null and l.context is distinct from public.appointment_clinical_context(a),
 'encounter_id',l.encounter_id,'encounter_status',e.status);
end $$;

create function public.prepare_appointment_dictation(p_actor_id uuid,p_pet_id uuid,p_appointment_id uuid,
 p_expected_version integer,p_existing_encounter_id uuid default null) returns public.clinical_encounters
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_dictation_actor(p_actor_id);sid uuid;
 a public.appointments;p public.pets;l public.appointment_clinical_links;e public.clinical_encounters;
begin
 perform pg_advisory_xact_lock(73260123);perform public.care_eligibility_lock();
 select * into a from public.appointments where id=p_appointment_id for update;
 if not found or a.pet_id is distinct from p_pet_id then raise exception 'Appointment does not belong to this patient' using errcode='23514';end if;
 if a.version is distinct from p_expected_version then raise exception 'Appointment changed; refresh and confirm again' using errcode='PT409';end if;
 select * into p from public.pets where id=p_pet_id for share;
 if not found or p.client_id is distinct from a.client_id or p.archived_at is not null or p.deceased_at is not null then
  raise exception 'An active patient and matching household are required' using errcode='23514';end if;
 if a.status in('CANCELLED','NO_SHOW') then raise exception 'Cancelled or no-show appointments cannot start dictation' using errcode='23514';end if;
 select * into l from public.appointment_clinical_links where appointment_id=a.id;
 if found then
  if l.pet_id<>p_pet_id or l.client_id<>a.client_id or l.context is distinct from public.appointment_clinical_context(a) then
   raise exception 'Linked appointment context changed; review the original encounter from Medical' using errcode='23514';end if;
  if p_existing_encounter_id is not null and p_existing_encounter_id<>l.encounter_id then
   raise exception 'This appointment already has a different encounter' using errcode='23514';end if;
  select * into e from public.clinical_encounters where id=l.encounter_id for share;
 else
  if a.status not in('SCHEDULED','CONFIRMED') then raise exception 'Only booked or confirmed appointments can link a new encounter' using errcode='23514';end if;
  if p_existing_encounter_id is not null then
   select * into e from public.clinical_encounters where id=p_existing_encounter_id for update;
   if not found or e.pet_id<>p_pet_id or e.status<>'draft' then raise exception 'Choose an unsigned encounter for this patient' using errcode='23514';end if;
   if exists(select 1 from public.appointment_clinical_links where encounter_id=e.id) then
    raise exception 'This encounter belongs to another appointment' using errcode='23514';end if;
  else
   e:=public.save_clinical_encounter(null,p_pet_id,null,now(),a.visit_type,coalesce(a.address_snapshot,''),'','','','');
  end if;
  sid:=public.next_visit_review_session();
  insert into public.appointment_clinical_links(appointment_id,encounter_id,pet_id,client_id,appointment_version,context,actor_id,session_id)
   values(a.id,e.id,p_pet_id,a.client_id,a.version,public.appointment_clinical_context(a),actor,sid);
 end if;
 perform public.clinical_dictation_actor(p_actor_id);
 return e;
end $$;

revoke all on function public.appointment_clinical_context(public.appointments),public.guard_appointment_clinical_link(),
 public.read_appointment_dictation(uuid,uuid,uuid),public.prepare_appointment_dictation(uuid,uuid,uuid,integer,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.read_appointment_dictation(uuid,uuid,uuid),public.prepare_appointment_dictation(uuid,uuid,uuid,integer,uuid) to authenticated;
