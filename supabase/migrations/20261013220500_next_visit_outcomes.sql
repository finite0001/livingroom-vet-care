-- Durable completion capture and atomic follow-up outcomes. No backfill or sends.
-- The compatibility wrapper must not take an appointment row before care:
-- reminder preparation already takes care before sharing that same row.
do $$declare body text;needle text:='perform pg_advisory_xact_lock(73260123);';begin
 body:=pg_get_functiondef('public.save_appointment(uuid,integer,uuid,uuid,timestamptz,integer,text,appointment_status,uuid,text)'::regprocedure);
 if position('public.care_eligibility_lock()' in body)>0 or position(needle in body)=0 then raise exception 'Unexpected compatibility save lock contract';end if;
 execute replace(body,needle,needle||'perform public.care_eligibility_lock();');
end $$;
create table public.appointment_completion_occurrences(
 id uuid primary key default gen_random_uuid(),appointment_id uuid not null references public.appointments(id) on delete restrict,
 appointment_version integer not null check(appointment_version>0),client_id uuid not null references public.clients(id),
 pet_id uuid not null references public.pets(id),snapshot jsonb not null,binding jsonb,
 actor_id uuid references auth.users(id),recorded_at timestamptz not null default clock_timestamp(),
 unique(appointment_id,appointment_version)
);
create table public.appointment_next_visit_heads(
 occurrence_id uuid primary key references public.appointment_completion_occurrences(id),version integer not null default 0 check(version>=0),
 current_decision_id uuid,check((version=0)=(current_decision_id is null))
);
create table public.appointment_next_visit_decisions(
 id uuid primary key default gen_random_uuid(),occurrence_id uuid not null references public.appointment_completion_occurrences(id),
 version integer not null check(version>0),kind text not null check(kind in('later','declined','booked')),
 note text not null check(length(note)<=2000),followup_on date check(isfinite(followup_on)),
 appointment_id uuid references public.appointments(id),booking_receipt jsonb,
 actor_id uuid not null references auth.users(id),recorded_at timestamptz not null default clock_timestamp(),
 unique(occurrence_id,version),unique(id,occurrence_id),
 check((kind='booked')=(appointment_id is not null)),check((kind='booked')=(booking_receipt is not null)),
 check(kind='later' or followup_on is null)
);
alter table public.appointment_next_visit_heads add foreign key(current_decision_id,occurrence_id) references public.appointment_next_visit_decisions(id,occurrence_id) deferrable initially deferred;
create table public.appointment_next_visit_actions(
 id uuid primary key,actor_id uuid not null references auth.users(id),operation text not null check(operation in('complete','decide')),
 request jsonb not null,receipt jsonb not null,recorded_at timestamptz not null default clock_timestamp()
);
create index appointment_completion_queue on public.appointment_completion_occurrences(recorded_at,id);
create index appointment_future_patient_cursor on public.appointments(pet_id,scheduled_at,id) where status in('SCHEDULED','CONFIRMED');
do $$declare t text;begin
 foreach t in array array['appointment_completion_occurrences','appointment_next_visit_heads','appointment_next_visit_decisions','appointment_next_visit_actions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  if t<>'appointment_next_visit_heads' then
   execute format('create trigger next_visit_immutable before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);
  end if;
 end loop;
end $$;
create function public.capture_appointment_completion() returns trigger language plpgsql security definer set search_path=public as $$
declare occurrence uuid;binding jsonb;begin
 -- Trusted historical/operator rows without a patient are not inferred visits.
 if new.pet_id is null then return new;end if;
 if new.status<>'COMPLETED' or (tg_op='UPDATE' and old.status='COMPLETED') then return new;end if;
 select b.snapshot into binding from appointment_catalog_bindings b where b.appointment_id=new.id and b.appointment_version<=new.version order by b.appointment_version desc limit 1;
 insert into appointment_completion_occurrences(appointment_id,appointment_version,client_id,pet_id,snapshot,binding,actor_id)
 values(new.id,new.version,new.client_id,new.pet_id,to_jsonb(new),binding,auth.uid()) returning id into occurrence;
 insert into appointment_next_visit_heads(occurrence_id) values(occurrence);
 return new;
end $$;
create trigger capture_appointment_completion after insert or update on public.appointments for each row execute function public.capture_appointment_completion();

create function public.next_visit_occurrence_current(p_occurrence uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from appointment_completion_occurrences o join appointments a on a.id=o.appointment_id
 join pets p on p.id=o.pet_id and p.client_id=o.client_id join clients c on c.id=o.client_id
 where o.id=p_occurrence and a.status='COMPLETED' and a.pet_id=o.pet_id and a.client_id=o.client_id
 and p.archived_at is null and p.deceased_at is null
 and not exists(select 1 from appointment_completion_occurrences newer where newer.appointment_id=o.appointment_id and newer.appointment_version>o.appointment_version));
$$;
create function public.read_next_visit_context(p_occurrence_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();result jsonb;begin
 select jsonb_build_object('occurrence',to_jsonb(o),'version',h.version,'decision',to_jsonb(d),
 'current',public.next_visit_occurrence_current(o.id),'source_status',a.status,'patient_name',p.name,'client_name',c.full_name)
 into result from appointment_completion_occurrences o join appointment_next_visit_heads h on h.occurrence_id=o.id
 join appointments a on a.id=o.appointment_id join pets p on p.id=o.pet_id join clients c on c.id=o.client_id
 left join appointment_next_visit_decisions d on d.id=h.current_decision_id where o.id=p_occurrence_id;
 if result is null then raise exception 'Completion occurrence unavailable' using errcode='PT409';end if;
 return result;
end $$;
create function public.list_pending_next_visits(p_after_at timestamptz default null,p_after_id uuid default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();result jsonb;begin
 if p_limit is null or p_limit not between 1 and 100 or (p_after_at is null)<>(p_after_id is null) or (p_after_at is not null and not isfinite(p_after_at)) then raise exception 'Bounded queue cursor required' using errcode='23514';end if;
 with bounded as materialized(select o.id,o.recorded_at from appointment_completion_occurrences o
 join appointment_next_visit_heads h on h.occurrence_id=o.id left join appointment_next_visit_decisions d on d.id=h.current_decision_id
 where public.next_visit_occurrence_current(o.id) and (d.id is null or d.kind='later')
 and (p_after_at is null or (o.recorded_at,o.id)>(p_after_at,p_after_id)) order by o.recorded_at,o.id limit p_limit+1),
 selected as materialized(select * from bounded order by recorded_at,id limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(public.read_next_visit_context(s.id) order by s.recorded_at,s.id) from selected s),'[]'),
 'next',case when (select count(*) from bounded)>p_limit then (select jsonb_build_object('at',recorded_at,'id',id) from selected order by recorded_at desc,id desc limit 1) end) into result;
 return result;
end $$;
create function public.recover_next_visit_action(p_actor_id uuid,p_action_id uuid,p_operation text,p_request jsonb) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();saved appointment_next_visit_actions;begin
 if actor is distinct from p_actor_id or p_action_id is null or p_operation is null or p_operation not in('complete','decide') then raise exception 'Matched actor/action/operation required' using errcode='42501';end if;
 select * into saved from appointment_next_visit_actions where id=p_action_id;if not found then return null;end if;
 if saved.actor_id<>actor or saved.operation is distinct from p_operation or saved.request is distinct from p_request then raise exception 'Action belongs to different work' using errcode='23505';end if;
 return saved.receipt;
end $$;
create function public.complete_appointment(p_actor_id uuid,p_action_id uuid,p_id uuid,p_expected_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();req jsonb:=jsonb_build_object('id',p_id,'expected_version',p_expected_version);receipt jsonb;row appointments;occurrence uuid;begin
 if actor is distinct from p_actor_id or p_action_id is null then raise exception 'Matched actor/action required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(73260123);perform public.care_eligibility_lock();perform public.clinical_require_staff();
 receipt:=public.recover_next_visit_action(actor,p_action_id,'complete',req);if receipt is not null then return receipt;end if;
 select * into row from appointments where id=p_id for update;
 if not found or row.version is distinct from p_expected_version then raise exception 'Appointment changed; reload before completing' using errcode='PT409';end if;
 if row.status<>'COMPLETED' then
  row:=public.save_appointment(actor,row.id,row.version,row.client_id,row.pet_id,row.scheduled_at,row.duration_minutes,row.appointment_type,'COMPLETED',row.assigned_dvm_id,row.visit_type,row.address_snapshot,row.travel_before_minutes,row.travel_after_minutes,row.resource_name,row.notes,row.reminder_offsets);
 end if;
 select id into occurrence from appointment_completion_occurrences where appointment_id=row.id order by appointment_version desc limit 1;
 if occurrence is null or not public.next_visit_occurrence_current(occurrence) then raise exception 'Historical or changed completion needs explicit workflow review; no inferred occurrence' using errcode='23514';end if;
 receipt:=jsonb_build_object('appointment',to_jsonb(row),'context',public.read_next_visit_context(occurrence));
 insert into appointment_next_visit_actions(id,actor_id,operation,request,receipt) values(p_action_id,actor,'complete',req,receipt);
 return receipt;
end $$;
create function public.save_next_visit_outcome(p_actor_id uuid,p_action_id uuid,p_occurrence_id uuid,p_expected_version integer,p_values jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();req jsonb:=jsonb_build_object('occurrence_id',p_occurrence_id,'expected_version',p_expected_version,'values',p_values);
 receipt jsonb;booking jsonb;head appointment_next_visit_heads;previous appointment_next_visit_decisions;occurrence appointment_completion_occurrences;
 target appointments;decision uuid;kind text;note text;followup date;v jsonb;offsets integer[];element jsonb;begin
 if actor is distinct from p_actor_id or p_action_id is null then raise exception 'Matched actor/action required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(73260123);perform public.care_eligibility_lock();perform public.clinical_require_staff();
 receipt:=public.recover_next_visit_action(actor,p_action_id,'decide',req);if receipt is not null then return receipt;end if;
 perform public.native_rx_keys(p_values,array['action','note','followup_on','booking','appointment_id','appointment_version']);
 kind:=p_values->>'action';note:=p_values->>'note';
 if jsonb_typeof(p_values->'action') is distinct from 'string' or kind not in('later','declined','book','existing') or jsonb_typeof(p_values->'note') is distinct from 'string' or length(note)>2000 then raise exception 'Typed next-visit decision required' using errcode='23514';end if;
 select * into head from appointment_next_visit_heads where occurrence_id=p_occurrence_id for update;
 if not found or head.version is distinct from p_expected_version then raise exception 'Next-visit outcome changed; reload' using errcode='PT409';end if;
 select * into previous from appointment_next_visit_decisions where id=head.current_decision_id;
 if previous.kind in('booked','declined') or not public.next_visit_occurrence_current(p_occurrence_id) then raise exception 'Completion is historical or already resolved' using errcode='PT409';end if;
 select * into occurrence from appointment_completion_occurrences where id=p_occurrence_id;
 if kind='later' then
  if p_values->'booking'<>'null'::jsonb or p_values->'appointment_id'<>'null'::jsonb or p_values->'appointment_version'<>'null'::jsonb then raise exception 'Later cannot contain a booking' using errcode='23514';end if;
  if p_values->'followup_on'<>'null'::jsonb then followup:=public.care_date(p_values->'followup_on');
   if followup<(clock_timestamp() at time zone 'America/Denver')::date then raise exception 'Choose today or a future follow-up date' using errcode='23514';end if;
  end if;
 elsif kind='declined' then
  if p_values->'followup_on'<>'null'::jsonb or p_values->'booking'<>'null'::jsonb or p_values->'appointment_id'<>'null'::jsonb or p_values->'appointment_version'<>'null'::jsonb then raise exception 'Declined cannot contain booking work' using errcode='23514';end if;
 else
  if p_values->'followup_on'<>'null'::jsonb then raise exception 'Booking cannot contain a later-review date' using errcode='23514';end if;
  if kind='existing' then
   if p_values->'booking'<>'null'::jsonb then raise exception 'Select an existing appointment without new booking work' using errcode='23514';end if;
   select * into target from appointments where id=public.native_rx_uuid(p_values->'appointment_id') for update;
   if not found or target.version is distinct from public.appointment_catalog_integer(p_values->'appointment_version',1,2147483647) then raise exception 'Future appointment changed; reload' using errcode='PT409';end if;
   booking:=jsonb_build_object('appointment',to_jsonb(target),'binding',public.read_appointment_catalog_binding(target.id),'existing',true);
  else
   if p_values->'appointment_id'<>'null'::jsonb or p_values->'appointment_version'<>'null'::jsonb then raise exception 'New booking cannot select an existing appointment' using errcode='23514';end if;
   perform public.native_rx_keys(p_values->'booking',array['mode','values']);v:=p_values#>'{booking,values}';
   if p_values#>>'{booking,mode}'='catalog' then
    if exists(select 1 from appointment_booking_actions where id=p_action_id) then raise exception 'Booking action already belongs to other work' using errcode='23505';end if;
    booking:=public.save_catalog_appointment(actor,p_action_id,null,null,v);
    select * into target from appointments where id=(booking#>>'{appointment,id}')::uuid;
   elsif p_values#>>'{booking,mode}'='custom' then
    perform public.native_rx_keys(v,array['client_id','pet_id','scheduled_at','duration_minutes','appointment_type','assigned_dvm_id','visit_type','address_snapshot','travel_before_minutes','travel_after_minutes','resource_name','notes','reminder_offsets']);
    if jsonb_typeof(v->'reminder_offsets') is distinct from 'array' or jsonb_array_length(v->'reminder_offsets')>5 then raise exception 'Bounded reminders required' using errcode='23514';end if;
    for element in select value from jsonb_array_elements(v->'reminder_offsets') loop perform public.appointment_catalog_integer(element,1,720);end loop;
    select coalesce(array_agg(value::integer),'{}') into offsets from jsonb_array_elements_text(v->'reminder_offsets');
    if jsonb_typeof(v->'visit_type') is distinct from 'string' or v->>'visit_type' not in('clinic','housecall') or jsonb_typeof(v->'notes') not in('string','null') or jsonb_typeof(v->'resource_name') not in('string','null') then raise exception 'Typed custom booking required' using errcode='23514';end if;
    perform public.native_rx_text(v->'appointment_type',150);perform public.native_rx_text(v->'address_snapshot',1000);
    target:=public.save_appointment(actor,null,null,public.native_rx_uuid(v->'client_id'),public.native_rx_uuid(v->'pet_id'),public.appointment_catalog_instant(v->'scheduled_at'),public.appointment_catalog_integer(v->'duration_minutes',15,480),v->>'appointment_type','SCHEDULED',public.native_rx_uuid(v->'assigned_dvm_id'),v->>'visit_type',v->>'address_snapshot',public.appointment_catalog_integer(v->'travel_before_minutes',0,240),public.appointment_catalog_integer(v->'travel_after_minutes',0,240),v->>'resource_name',v->>'notes',offsets);
    booking:=jsonb_build_object('appointment',to_jsonb(target),'binding',null);
   else raise exception 'Explicit catalog or custom booking required' using errcode='23514';end if;
  end if;
  if target.pet_id is distinct from occurrence.pet_id or target.client_id is distinct from occurrence.client_id or target.id=occurrence.appointment_id or target.status not in('SCHEDULED','CONFIRMED') or target.scheduled_at<=clock_timestamp() then raise exception 'Active future booking for this completed patient required' using errcode='23514';end if;
  kind:='booked';
 end if;
 insert into appointment_next_visit_decisions(occurrence_id,version,kind,note,followup_on,appointment_id,booking_receipt,actor_id)
 values(p_occurrence_id,head.version+1,kind,note,followup,target.id,booking,actor) returning id into decision;
 update appointment_next_visit_heads set version=head.version+1,current_decision_id=decision where occurrence_id=p_occurrence_id;
 receipt:=public.read_next_visit_context(p_occurrence_id);
 insert into appointment_next_visit_actions(id,actor_id,operation,request,receipt) values(p_action_id,actor,'decide',req,receipt);
 return receipt;
end $$;
create function public.list_next_visit_future_appointments(p_occurrence_id uuid,p_as_of timestamptz default null,p_after_at timestamptz default null,p_after_id uuid default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();occurrence appointment_completion_occurrences;asof timestamptz:=coalesce(p_as_of,statement_timestamp());result jsonb;begin
 if p_limit is null or p_limit not between 1 and 100 or not isfinite(asof) or asof>statement_timestamp() or (p_after_at is null)<>(p_after_id is null) or (p_after_at is not null and (p_as_of is null or not isfinite(p_after_at))) then raise exception 'Bounded future cursor and fixed as-of required' using errcode='23514';end if;
 select * into occurrence from appointment_completion_occurrences where id=p_occurrence_id;if not found then raise exception 'Completion occurrence unavailable' using errcode='PT409';end if;
 with bounded as materialized(select a.* from appointments a where a.pet_id=occurrence.pet_id and a.client_id=occurrence.client_id and a.id<>occurrence.appointment_id and a.status in('SCHEDULED','CONFIRMED') and a.scheduled_at>asof
 and (p_after_at is null or (a.scheduled_at,a.id)>(p_after_at,p_after_id)) order by a.scheduled_at,a.id limit p_limit+1),
 selected as materialized(select * from bounded order by scheduled_at,id limit p_limit)
 select jsonb_build_object('as_of',asof,'items',coalesce((select jsonb_agg(to_jsonb(s) order by s.scheduled_at,s.id) from selected s),'[]'),
 'next',case when (select count(*) from bounded)>p_limit then (select jsonb_build_object('at',scheduled_at,'id',id) from selected order by scheduled_at desc,id desc limit 1) end) into result;
 return result;
end $$;
create function public.list_next_visit_due_care(p_occurrence_id uuid,p_after jsonb default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();occurrence appointment_completion_occurrences;due date;cursor_kind text;cursor_id uuid;result jsonb;begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Bounded due care required' using errcode='23514';end if;
 if p_after is not null then
  perform public.native_rx_keys(p_after,array['due_on','kind','id']);due:=public.care_date(p_after->'due_on');cursor_id:=public.native_rx_uuid(p_after->'id');cursor_kind:=p_after->>'kind';
  if cursor_kind not in('care_plan','vaccine_plan','lab') then raise exception 'Valid due-care cursor required' using errcode='23514';end if;
 end if;
 select * into occurrence from appointment_completion_occurrences where id=p_occurrence_id;if not found then raise exception 'Completion occurrence unavailable' using errcode='PT409';end if;
 with sources as materialized(
 select 'care_plan' kind,p.id,p.version,p.name label,p.due_on,'reviewed' review_state from patient_care_plans p where p.pet_id=occurrence.pet_id and p.status='current' and public.care_plan_source_is_current(p.id)
 union all select 'vaccine_plan',(g#>>'{plan,id}')::uuid,(g#>>'{plan,version}')::integer,g->>'group_name',(g->>'due_on')::date,'reviewed'
 from jsonb_array_elements(public.patient_vaccine_status_summary(occurrence.pet_id)->'groups')g where g->>'due_source'='reviewed_due_plan' and g->'flags'='[]'::jsonb
 union all select 'lab',p.id,p.version,p.test_name,p.due_date,p.status from patient_lab_orders p where p.pet_id=occurrence.pet_id and p.status in('planned','ordered') and p.due_date is not null),
 bounded as materialized(select s.* from sources s where p_after is null or (s.due_on,s.kind,s.id)>(due,cursor_kind,cursor_id) order by s.due_on,s.kind,s.id limit p_limit+1),
 selected as materialized(select * from bounded order by due_on,kind,id limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(s) order by s.due_on,s.kind,s.id) from selected s),'[]'),
 'next',case when (select count(*) from bounded)>p_limit then (select jsonb_build_object('due_on',s.due_on,'kind',s.kind,'id',s.id) from selected s order by s.due_on desc,s.kind desc,s.id desc limit 1) end) into result;
 return result;
end $$;
do $$declare f record;begin
 for f in select p.oid::regprocedure::text signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('capture_appointment_completion','next_visit_occurrence_current','read_next_visit_context','list_pending_next_visits','recover_next_visit_action','complete_appointment','save_next_visit_outcome','list_next_visit_future_appointments','list_next_visit_due_care') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname not in('capture_appointment_completion','next_visit_occurrence_current') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
