-- Reminder pipeline readiness (2026-09-28).
--
-- 1. One canonical appointment-reminder path. save_appointment writes
--    appointment_reminders; the scheduled queue-reminders worker calls
--    queue_due_reminders(), which hands reviewed, consent-checked jobs to
--    communication_outbox for dispatch-outbox (scheduled by
--    20260922120000_b1_scheduler.sql). The parallel
--    enqueue_due_appointment_reminders() -> outbound_deliveries path from
--    20260922190000 had no caller and no schedule. It is made inert here; no
--    table, column or row is dropped, so its historical evidence remains.
-- 2. Appointment reminders may use EMAIL as well as SMS. The channel is chosen
--    at booking from the household's preferred channel, reachability and
--    consent; with no consented channel the preferred one is kept. The queue
--    step and the final provider preflight still recheck consent.
-- 3. Lab orders gain the same per-patient reminder switch vaccine due plans
--    have (patient_vaccine_due_plans.reminders_enabled). Default off, like
--    vaccines: a reminder is sent only for an order staff explicitly enabled.
--
-- No provider code, secret, schedule or delivery gate changes here.

-- 1. Canonical path: retire the unused outbound_deliveries reminder enqueue.
create or replace function public.enqueue_due_appointment_reminders(
  p_batch_size integer default 25,
  p_enqueued_at timestamptz default now()
)
returns table (
  reminder_id uuid,
  outbound_delivery_id uuid,
  action text,
  reminder_status public.reminder_status,
  status_note text
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'Deprecated: appointment reminders are queued by queue_due_reminders() into communication_outbox'
    using errcode = '0A000';
end
$$;
comment on function public.enqueue_due_appointment_reminders(integer, timestamptz) is
  'DEPRECATED 2026-09-28 and inert. Canonical path: save_appointment -> appointment_reminders -> queue_due_reminders() -> communication_outbox -> dispatch-outbox. Retained only so historical outbound_deliveries rows keep their provenance.';
revoke all on function public.enqueue_due_appointment_reminders(integer, timestamptz) from public, anon, authenticated, service_role;

-- The original Lovable reader returned contact details for every due reminder.
revoke all on function public.process_due_reminders() from public, anon, authenticated, service_role;
comment on function public.process_due_reminders() is
  'DEPRECATED and not executable by any client role. Canonical path: queue_due_reminders().';

comment on table public.appointment_reminders is
  'Appointment reminder jobs written only by save_appointment. Canonical delivery: queue_due_reminders() -> reminder_outbox_links -> communication_outbox -> dispatch-outbox. outbound_delivery_id and enqueued_at belong to the retired outbound_deliveries path.';
comment on column public.appointment_reminders.outbound_delivery_id is
  'Legacy link from the retired enqueue_due_appointment_reminders() path. New reminders never set it.';
comment on column public.appointment_reminders.channel is
  'SMS or EMAIL, chosen at booking by appointment_reminder_channel(). The provider preflight rechecks consent before any send.';

-- 2. Appointment reminder channel: preference first, then the other consented channel.
create function public.appointment_reminder_channel(p_client_id uuid) returns text
language plpgsql stable security definer set search_path=public as $$
declare c public.clients;sms text;email text;sms_ok boolean;email_ok boolean;preferred text;
begin
 select * into c from public.clients where id=p_client_id;
 if c.id is null then return null;end if;
 sms=public.communication_recipient('SMS',c.primary_phone);email=public.communication_recipient('EMAIL',c.primary_email);
 -- communication_is_suppressed covers opt-outs for both channels and requires SMS opt-in.
 sms_ok=sms is not null and not public.communication_is_suppressed('SMS',sms,c.id);
 email_ok=email is not null and not public.communication_is_suppressed('EMAIL',email,c.id);
 preferred=coalesce(c.preferred_channel::text,'SMS');
 if preferred='EMAIL' and email_ok then return 'EMAIL';end if;
 if preferred='SMS' and sms_ok then return 'SMS';end if;
 -- Preferred channel unreachable, unconsented or not automatable (VOICE): use the other consented channel.
 if sms_ok then return 'SMS';end if;
 if email_ok then return 'EMAIL';end if;
 return null;
end $$;
revoke all on function public.appointment_reminder_channel(uuid) from public,anon,authenticated,service_role;

-- Unchanged from 20260912230000_scheduling.sql except the reminder channel.
create or replace function public.save_appointment(p_actor_id uuid,p_id uuid,p_expected_version integer,p_client_id uuid,p_pet_id uuid,p_scheduled_at timestamptz,p_duration_minutes integer,p_appointment_type text,p_status public.appointment_status,p_assigned_dvm_id uuid,p_visit_type text,p_address_snapshot text,p_travel_before_minutes integer,p_travel_after_minutes integer,p_resource_name text,p_notes text,p_reminder_offsets integer[])
returns public.appointments language plpgsql security definer set search_path=public as $$
declare actor uuid; result public.appointments; previous public.appointments; offset_hours integer; busy_start timestamptz; busy_end timestamptz; reminder_channel text;
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
  -- Chosen per appointment revision; a household change takes effect on the next save.
  -- With no consented channel yet, keep the preferred one: consent given before the
  -- reminder is due still lets it send, and the queue preflight blocks it otherwise.
  select coalesce(public.appointment_reminder_channel(c.id),case when c.preferred_channel::text='EMAIL' then 'EMAIL' else 'SMS' end) into reminder_channel from public.clients c where c.id=result.client_id;
  foreach offset_hours in array result.reminder_offsets loop
   insert into public.appointment_reminders(appointment_id,appointment_version,remind_at,channel,status)
   values(result.id,result.version,result.scheduled_at-make_interval(hours=>offset_hours),reminder_channel,case when result.scheduled_at-make_interval(hours=>offset_hours)>now() then 'PENDING'::public.reminder_status else 'SKIPPED'::public.reminder_status end);
  end loop;
 end if;
 return result;
end $$;
revoke all on function public.save_appointment(uuid,uuid,integer,uuid,uuid,timestamptz,integer,text,public.appointment_status,uuid,text,text,integer,integer,text,text,integer[]) from public,anon,service_role;
grant execute on function public.save_appointment(uuid,uuid,integer,uuid,uuid,timestamptz,integer,text,public.appointment_status,uuid,text,text,integer,integer,text,text,integer[]) to authenticated;

-- 3. Per-order lab reminder switch, mirroring vaccine due plans.
alter table public.patient_lab_orders add column reminders_enabled boolean not null default false;
comment on column public.patient_lab_orders.reminders_enabled is
  'Staff opt-in for automated due reminders on this open (planned/ordered) order. Cleared when the order leaves an open status.';

-- Unchanged from 20260913100000_lab_work.sql except reminders_enabled.
create or replace function public.save_patient_lab_order(p_id uuid,p_pet_id uuid,p_expected_version integer,p_values jsonb,p_correction_reason text) returns public.patient_lab_orders language plpgsql security definer set search_path=public as $$
declare actor uuid;r public.patient_lab_orders;n public.patient_lab_orders;t public.lab_due_templates;existed boolean;
begin
 actor=public.clinical_require_staff();
 if p_id is null or p_values is null or jsonb_typeof(p_values)<>'object' or exists(select 1 from jsonb_object_keys(p_values) k where k not in ('test_name','status','due_date','collected_date','result_date','accession','notes','result_document_id','template_id','template_version','interval_days','interval_anchor','override_reason','reminders_enabled')) then raise exception 'Invalid lab order fields' using errcode='23514';end if;
 if p_values ? 'reminders_enabled' and jsonb_typeof(p_values->'reminders_enabled')<>'boolean' then raise exception 'Invalid lab order fields' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,11));
 select * into r from public.patient_lab_orders where id=p_id for update;existed=found;
 if existed and r.pet_id<>p_pet_id then raise exception 'Order belongs to another patient' using errcode='42501';end if;
 n=jsonb_populate_record(null::public.patient_lab_orders,p_values);
 n.test_name=trim(n.test_name);n.notes=coalesce(n.notes,'');n.accession=coalesce(n.accession,'');n.override_reason=coalesce(n.override_reason,'');
 -- Callers that omit the switch keep the stored choice; only open orders can remind.
 n.reminders_enabled=case when p_values ? 'reminders_enabled' then (p_values->>'reminders_enabled')::boolean else coalesce(r.reminders_enabled,false) end;
 if n.status is null or n.status not in ('planned','ordered') then n.reminders_enabled=false;end if;
 -- Exact retry after an uncertain response returns its prior version without creating history twice.
 if existed and r.updated_by=actor and r.version=coalesce(p_expected_version,0)+1 and exists(select 1 from public.lab_work_revisions where entity='order' and entity_id=r.id and version=r.version and reason=coalesce(trim(p_correction_reason),'')) and
  (to_jsonb(r)-array['id','pet_id','version','created_by','updated_by','created_at','updated_at'])=(to_jsonb(n)-array['id','pet_id','version','created_by','updated_by','created_at','updated_at']) then return r;end if;
 if existed and r.version is distinct from p_expected_version or not existed and p_expected_version is not null then raise exception 'Lab order version conflict; reload before saving' using errcode='40001';end if;
 if not exists(select 1 from public.pets where id=p_pet_id) then raise exception 'Patient not found' using errcode='23514';end if;
 if not existed and not exists(select 1 from public.pets where id=p_pet_id and archived_at is null and deceased_at is null) then raise exception 'New orders require an active patient' using errcode='23514';end if;
 if existed and (r.status in ('resulted','cancelled') or r.result_date is not null or r.result_document_id is not null) and nullif(trim(p_correction_reason),'') is null then raise exception 'Historical result changes require a correction reason' using errcode='23514';end if;
 if length(coalesce(p_correction_reason,''))>2000 then raise exception 'Correction reason too long' using errcode='23514';end if;
 if n.status in ('collected','resulted') and n.collected_date is null or n.status='resulted' and n.result_date is null then raise exception 'Record collection and result dates for this status' using errcode='23514';end if;
 if n.collected_date>(now() at time zone 'America/Denver')::date or n.result_date>(now() at time zone 'America/Denver')::date then raise exception 'Collection and result dates cannot be in the future' using errcode='23514';end if;
 if n.reminders_enabled and n.due_date is null then raise exception 'Set a lab due date before enabling reminders' using errcode='23514';end if;
 if n.result_document_id is not null then
  perform 1 from public.patient_documents where id=n.result_document_id and pet_id=p_pet_id and status='ready' for share;
  if not found then raise exception 'Choose a ready document belonging to this patient' using errcode='42501';end if;
 end if;
 if n.template_id is not null then
  select * into t from public.lab_due_templates where id=n.template_id for share;
  -- Existing provenance remains valid when a reusable template is later revised/retired.
  if not (existed and row(r.template_id,r.template_version,r.interval_days,r.interval_anchor,r.due_date,r.override_reason) is not distinct from row(n.template_id,n.template_version,n.interval_days,n.interval_anchor,n.due_date,n.override_reason)) then
   if t.id is null or not t.active or t.version is distinct from n.template_version then raise exception 'Template changed or retired; review current settings' using errcode='40001';end if;
   if n.interval_days is distinct from t.interval_days and nullif(trim(n.override_reason),'') is null then raise exception 'Patient interval override requires a reason' using errcode='23514';end if;
  end if;
 elsif n.template_version is not null then raise exception 'Template version requires a template' using errcode='23514';end if;
 if n.interval_days is not null then
  if n.interval_anchor is null or not isfinite(n.interval_anchor) or n.due_date is distinct from n.interval_anchor+n.interval_days then raise exception 'Review interval anchor and due date' using errcode='23514';end if;
 elsif n.interval_anchor is not null or n.template_id is not null then raise exception 'Interval required' using errcode='23514';end if;
 if existed then
  update public.patient_lab_orders set test_name=n.test_name,status=n.status,due_date=n.due_date,collected_date=n.collected_date,result_date=n.result_date,accession=n.accession,notes=n.notes,result_document_id=n.result_document_id,template_id=n.template_id,template_version=n.template_version,interval_days=n.interval_days,interval_anchor=n.interval_anchor,override_reason=n.override_reason,reminders_enabled=n.reminders_enabled,version=version+1,updated_by=actor,updated_at=now() where id=p_id returning * into r;
 else
  insert into public.patient_lab_orders(id,pet_id,test_name,status,due_date,collected_date,result_date,accession,notes,result_document_id,template_id,template_version,interval_days,interval_anchor,override_reason,reminders_enabled,created_by,updated_by) values(p_id,p_pet_id,n.test_name,n.status,n.due_date,n.collected_date,n.result_date,n.accession,n.notes,n.result_document_id,n.template_id,n.template_version,n.interval_days,n.interval_anchor,n.override_reason,n.reminders_enabled,actor,actor) returning * into r;
 end if;
 insert into public.lab_work_revisions(entity,entity_id,version,snapshot,reason,actor_id) values('order',r.id,r.version,to_jsonb(r),coalesce(trim(p_correction_reason),''),actor);return r;
end $$;

-- Candidate discovery, enqueue and the final provider preflight all honour the switch.
-- Each body is unchanged from its latest definition except `l.reminders_enabled`.
create or replace function public.reminder_scheduler_candidates_internal() returns table(job_kind text,job_id uuid,policy_id uuid,source_id uuid,source_kind text,source_version integer,template_id uuid,template_version integer)
language sql stable security definer set search_path=public as $$
select x.* from (
  select 'care'::text job_kind,j.id job_id,p.id policy_id,v.id source_id,'vaccine'::text source_kind,v.version source_version,t.id template_id,t.version template_version
  from public.reminder_automation_policies p join public.care_message_templates t on t.id=p.message_template_id and t.version=p.message_template_version and t.active
  join public.patient_vaccine_due_plans v on p.source_kind='vaccine' and v.status='current' and v.reminders_enabled and v.current_due_on<=(now() at time zone 'America/Denver')::date+t.days_before
  left join public.care_reminder_jobs j on j.source_kind='vaccine' and j.source_id=v.id and j.source_version=v.version and j.message_template_id=t.id and j.message_template_version=t.version
  where p.enabled and exists(select 1 from public.pets patient where patient.id=v.pet_id and patient.archived_at is null and patient.deceased_at is null) and (j.id is null or j.status='pending') and not exists(select 1 from public.reminder_outbox_links h where h.job_kind='care' and h.job_id=j.id)
  union all
  select 'care',j.id,p.id,l.id,'lab',l.version,t.id,t.version
  from public.reminder_automation_policies p join public.care_message_templates t on t.id=p.message_template_id and t.version=p.message_template_version and t.active
  join public.patient_lab_orders l on p.source_kind='lab' and l.status in ('planned','ordered') and l.reminders_enabled and l.due_date<=(now() at time zone 'America/Denver')::date+t.days_before
  left join public.care_reminder_jobs j on j.source_kind='lab' and j.source_id=l.id and j.source_version=l.version and j.message_template_id=t.id and j.message_template_version=t.version
  where p.enabled and exists(select 1 from public.pets patient where patient.id=l.pet_id and patient.archived_at is null and patient.deceased_at is null) and (j.id is null or j.status='pending') and not exists(select 1 from public.reminder_outbox_links h where h.job_kind='care' and h.job_id=j.id)
  union all
  select 'appointment',ar.id,p.id,a.id,'appointment',a.version,t.id,t.version
  from public.reminder_automation_policies p join public.care_message_templates t on t.id=p.message_template_id and t.version=p.message_template_version and t.active
  join public.appointment_reminders ar on p.source_kind='appointment' and ar.channel=p.channel and ar.status='PENDING' and ar.remind_at<=now()
  join public.appointments a on a.id=ar.appointment_id and a.version=ar.appointment_version and a.status in ('SCHEDULED','CONFIRMED') and a.scheduled_at>now()
  where p.enabled and not exists(select 1 from public.reminder_outbox_links h where h.job_kind='appointment' and h.job_id=ar.id)
 ) x order by x.job_kind,x.source_kind,x.source_id
$$;

create or replace function public.list_care_reminder_candidates(p_through date,p_after_kind text default '',p_after_id uuid default '00000000-0000-0000-0000-000000000000',p_limit integer default 100)
returns table(source_kind text,source_id uuid,source_version integer,pet_id uuid,due_on date) language plpgsql security definer set search_path=public as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service discovery only' using errcode='42501';end if;
 if p_through is null or not isfinite(p_through) or p_limit is null or p_limit not between 1 and 500 or p_after_kind is null or p_after_id is null then raise exception 'Finite discovery horizon and bounded page required' using errcode='23514';end if;
 return query select x.kind,x.id,x.version,x.patient,x.due from (
 select 'vaccine'::text kind,v.id,v.version,v.pet_id patient,v.current_due_on due from public.patient_vaccine_due_plans v where v.status='current' and v.reminders_enabled
 union all select 'lab'::text,l.id,l.version,l.pet_id,l.due_date from public.patient_lab_orders l where l.status in ('planned','ordered') and l.reminders_enabled and l.due_date is not null
 ) x join public.pets p on p.id=x.patient where p.archived_at is null and p.deceased_at is null and x.due<=p_through and row(x.kind,x.id)>row(p_after_kind,p_after_id) order by x.kind,x.id limit p_limit;
end $$;

create or replace function public.enqueue_care_reminder(p_id uuid,p_source_kind text,p_source_id uuid,p_expected_source_version integer,p_message_template_id uuid,p_expected_template_version integer) returns public.care_reminder_jobs language plpgsql security definer set search_path=public as $$
declare r public.care_reminder_jobs;t public.care_message_templates;p public.pets;v public.patient_vaccine_due_plans;l public.patient_lab_orders;patient_id uuid;due date;care_name text;snapshot jsonb;body text;part record;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service enqueue only' using errcode='42501';end if;
 if p_id is null then raise exception 'Stable job ID required' using errcode='23514';end if;
 if p_source_kind='vaccine' then select pet_id into patient_id from public.patient_vaccine_due_plans where id=p_source_id;
 elsif p_source_kind='lab' then select pet_id into patient_id from public.patient_lab_orders where id=p_source_id;
 else raise exception 'Unsupported reminder source' using errcode='23514';end if;
 select * into p from public.pets where id=patient_id and archived_at is null and deceased_at is null for share;if not found then raise exception 'Reminder requires an active patient' using errcode='23514';end if;
 if p_source_kind='vaccine' then
  select * into v from public.patient_vaccine_due_plans where id=p_source_id for share;
  if v.version is distinct from p_expected_source_version or v.status<>'current' or not v.reminders_enabled or exists(select 1 from public.patient_treatment_corrections where treatment_id=v.treatment_id) then raise exception 'Vaccine due source is not current or enabled' using errcode='40001';end if;
  due=v.current_due_on;care_name=v.template_snapshot->>'name';snapshot=to_jsonb(v);
 else
  select * into l from public.patient_lab_orders where id=p_source_id for share;
  if l.version is distinct from p_expected_source_version or l.status not in ('planned','ordered') or not l.reminders_enabled or l.due_date is null then raise exception 'Lab due source is not current or enabled' using errcode='40001';end if;
  due=l.due_date;care_name=l.test_name;snapshot=to_jsonb(l);
 end if;
 select * into t from public.care_message_templates where id=p_message_template_id for share;
 if t.id is null or not t.active or t.version is distinct from p_expected_template_version then raise exception 'Message template changed or retired' using errcode='40001';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,16));
 select * into r from public.care_reminder_jobs where id=p_id;
 if found then if row(r.source_kind,r.source_id,r.source_version,r.message_template_id,r.message_template_version) is distinct from row(p_source_kind,p_source_id,p_expected_source_version,p_message_template_id,p_expected_template_version) then raise exception 'Job ID reused with changed request' using errcode='42501';end if;return r;end if;
 -- A separate stable request ID for the same source/template version still returns the one canonical job.
 perform pg_advisory_xact_lock(hashtextextended(p_source_kind||p_source_id::text||p_expected_source_version::text||p_message_template_id::text||p_expected_template_version::text,17));
 select * into r from public.care_reminder_jobs where source_kind=p_source_kind and source_id=p_source_id and source_version=p_expected_source_version and message_template_id=p_message_template_id and message_template_version=p_expected_template_version;if found then return r;end if;
 body='';for part in select m[1] as token from regexp_matches(t.body,'(\{\{patient_name\}\}|\{\{care_name\}\}|\{\{due_date\}\}|[^{}]+)','g') m loop body=body||case part.token when '{{patient_name}}' then p.name when '{{care_name}}' then care_name when '{{due_date}}' then due::text else part.token end;end loop;
 insert into public.care_reminder_jobs(id,source_kind,source_id,source_version,pet_id,client_id,message_template_id,message_template_version,channel,scheduled_on,due_on,rendered_body,source_snapshot,template_snapshot) values(p_id,p_source_kind,p_source_id,p_expected_source_version,p.id,p.client_id,t.id,t.version,t.channel,due-t.days_before,due,body,snapshot,to_jsonb(t)) returning * into r;return r;
end $$;

create or replace function public.reminder_delivery_context(p_job_kind text,p_job_id uuid,p_policy_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare policy public.reminder_automation_policies;t public.care_message_templates;j public.care_reminder_jobs;ar public.appointment_reminders;a public.appointments;v public.patient_vaccine_due_plans;l public.patient_lab_orders;p public.pets;c public.clients;actor uuid;source jsonb;body text;care_name text;due date;part record;recipient text;
begin
 select * into policy from public.reminder_automation_policies where id=p_policy_id for share;
 if policy.id is null or not policy.enabled or not public.is_active_staff(policy.approved_by) then return null;end if;
 select * into t from public.care_message_templates where id=policy.message_template_id for share;
 if t.id is null or not t.active or t.version<>policy.message_template_version or upper(t.channel)<>policy.channel or not public.is_active_staff(t.updated_by) then return null;end if;
 if p_job_kind='care' then
  select * into j from public.care_reminder_jobs where id=p_job_id for update;
  if j.id is null or j.status<>'pending' or j.source_kind<>policy.source_kind or upper(j.channel)<>policy.channel or j.message_template_id<>t.id or j.message_template_version<>t.version or j.scheduled_on>(now() at time zone 'America/Denver')::date then return null;end if;
  if j.source_kind='vaccine' then select * into v from public.patient_vaccine_due_plans where id=j.source_id for share;
   if v.id is null or v.version<>j.source_version or v.status<>'current' or not v.reminders_enabled or v.pet_id<>j.pet_id or v.current_due_on<>j.due_on or exists(select 1 from public.patient_treatment_corrections where treatment_id=v.treatment_id) then return null;end if;
   source=to_jsonb(v);actor=v.updated_by;
  else select * into l from public.patient_lab_orders where id=j.source_id for share;
   if l.id is null or l.version<>j.source_version or l.status not in ('planned','ordered') or not l.reminders_enabled or l.pet_id<>j.pet_id or l.due_date is distinct from j.due_on then return null;end if;
   source=to_jsonb(l);actor=l.updated_by;
  end if;
  if source is distinct from j.source_snapshot or actor is distinct from (j.source_snapshot->>'updated_by')::uuid then return null;end if;
  select * into p from public.pets where id=j.pet_id for share;
  if p.client_id is distinct from j.client_id then return null;end if;body=j.rendered_body;due=j.due_on;
 elsif p_job_kind='appointment' then
  select * into ar from public.appointment_reminders where id=p_job_id for update;
  if ar.id is null or ar.status<>'PENDING' or ar.remind_at>now() or ar.channel<>policy.channel or policy.source_kind<>'appointment' then return null;end if;
  select * into a from public.appointments where id=ar.appointment_id for share;
  if a.id is null or a.version<>ar.appointment_version or a.status not in ('SCHEDULED','CONFIRMED') or a.scheduled_at<=now() or a.pet_id is null then return null;end if;
  actor=a.updated_by;source=to_jsonb(a);select * into p from public.pets where id=a.pet_id for share;
  if p.client_id is distinct from a.client_id then return null;end if;
  due=(a.scheduled_at at time zone 'America/Denver')::date;
  care_name=a.appointment_type||' · '||to_char(a.scheduled_at at time zone 'America/Denver','YYYY-MM-DD HH24:MI')||' America/Denver · '||a.address_snapshot;
  body='';for part in select m[1] token from regexp_matches(t.body,'(\{\{patient_name\}\}|\{\{care_name\}\}|\{\{due_date\}\}|[^{}]+)','g') m loop body=body||case part.token when '{{patient_name}}' then p.name when '{{care_name}}' then care_name when '{{due_date}}' then due::text else part.token end;end loop;
 else return null;end if;
 if p.id is null or p.archived_at is not null or p.deceased_at is not null or actor is null or not public.is_active_staff(actor) then return null;end if;
 select * into c from public.clients where id=p.client_id for share;
 recipient=public.communication_recipient(policy.channel,case when policy.channel='EMAIL' then c.primary_email else c.primary_phone end);
 if recipient is null or public.communication_is_suppressed(policy.channel,recipient,c.id) or length(body)<1 or (policy.channel='SMS' and length(body)>1600) then return null;end if;
 return jsonb_build_object('job_kind',p_job_kind,'job_id',p_job_id,'policy',to_jsonb(policy),'template',to_jsonb(t),'source',source,'actor_id',actor,'pet_id',p.id,'patient_name',p.name,'client_id',c.id,'recipient',recipient,'channel',policy.channel,'subject',policy.subject,'body',body,'due_on',due);
end $$;

-- create or replace keeps grants; restate the internal-only boundary explicitly.
revoke all on function public.reminder_scheduler_candidates_internal(),public.reminder_delivery_context(text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.list_care_reminder_candidates(date,text,uuid,integer),public.enqueue_care_reminder(uuid,text,uuid,integer,uuid,integer) from public,anon,authenticated;
grant execute on function public.list_care_reminder_candidates(date,text,uuid,integer),public.enqueue_care_reminder(uuid,text,uuid,integer,uuid,integer) to service_role;
