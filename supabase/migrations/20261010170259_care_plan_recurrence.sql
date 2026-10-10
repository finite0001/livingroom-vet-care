-- Package 2B. Reviewed calendar recurrence feeds the existing canonical reminder pipeline.
-- No clinical intervals, delivery policy or provider credentials are seeded.
create function public.care_eligibility_lock() returns boolean
language plpgsql security definer set search_path=public as $$
begin perform pg_advisory_xact_lock(1869440354,1128354373);return true;end $$;
revoke all on function public.care_eligibility_lock() from public,anon,authenticated,service_role;
create function public.care_eligibility_statement_guard() returns trigger
language plpgsql security definer set search_path=public as $$
begin perform public.care_eligibility_lock();return null;end $$;
revoke all on function public.care_eligibility_statement_guard() from public,anon,authenticated,service_role;

create function public.care_require_clinician() returns uuid
language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();
begin
 if not exists(select 1 from public.user_roles r join public.profiles p on p.id=r.user_id
  where r.user_id=actor and r.role='DVM' and nullif(trim(p.full_name),'') is not null)
 then raise exception 'Active named veterinarian required for clinical review' using errcode='42501';end if;
 return actor;
end $$;
revoke all on function public.care_require_clinician() from public,anon,authenticated,service_role;

create function public.care_date(p_value jsonb) returns date language plpgsql immutable set search_path=public as $$
declare value text;result date;
begin
 if jsonb_typeof(p_value) is distinct from 'string' then raise exception 'Calendar date required' using errcode='23514';end if;
 value:=p_value#>>'{}';
 if value!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(value,4)='0000' then raise exception 'Complete valid calendar date required' using errcode='23514';end if;
 result:=value::date;
 if result::text<>value or not isfinite(result) then raise exception 'Valid calendar date required' using errcode='23514';end if;
 return result;
exception when datetime_field_overflow or invalid_datetime_format then raise exception 'Valid calendar date required' using errcode='23514';
end $$;
revoke all on function public.care_date(jsonb) from public,anon,authenticated,service_role;

create function public.care_calendar_due(p_anchor date,p_amount integer,p_unit text,p_month_end text,p_cycle integer default 1)
returns date language plpgsql immutable set search_path=public as $$
declare target date;months integer;
begin
 if p_anchor is null or not isfinite(p_anchor) or p_anchor<'0001-01-01' or p_anchor>'9999-12-31'
 or p_amount is null or p_cycle is null or p_cycle not between 1 and 1000000 or p_amount<1
 or p_unit is null or p_unit not in ('days','weeks','months','years') or p_month_end is null or p_month_end not in ('clamp','preserve_end')
 or p_amount>(case p_unit when 'days' then 36500 when 'weeks' then 5200 when 'months' then 1200 else 100 end)
 then raise exception 'Bounded calendar interval, anchor and month-end rule required' using errcode='23514';end if;
 if p_unit in ('days','weeks') then target:=p_anchor+(p_amount::bigint*p_cycle*case when p_unit='weeks' then 7 else 1 end)::integer;
 else
  months:=(p_amount::bigint*p_cycle*case when p_unit='years' then 12 else 1 end)::integer;
  target:=(p_anchor+make_interval(months=>months))::date;
  if p_month_end='preserve_end' and p_anchor=(date_trunc('month',p_anchor)+interval '1 month - 1 day')::date
  then target:=(date_trunc('month',target)+interval '1 month - 1 day')::date;end if;
 end if;
 if target>'9999-12-31' or target<p_anchor then raise exception 'Calendar due date exceeds supported range' using errcode='23514';end if;
 return target;
exception when datetime_field_overflow or numeric_value_out_of_range then
 raise exception 'Calendar due date exceeds supported range' using errcode='23514';
end $$;
revoke all on function public.care_calendar_due(date,integer,text,text,integer) from public,anon,authenticated,service_role;

create table public.recurring_care_templates(
 id uuid primary key,care_key text not null unique check(care_key~'^[a-z0-9][a-z0-9_-]{0,79}$'),
 name text not null check(length(trim(name)) between 1 and 160),
 care_kind text not null check(care_kind in ('wellness','bloodwork','vaccine','custom')),
 interval_amount integer not null,interval_unit text not null check(interval_unit in ('days','weeks','months','years')),
 anchor_mode text not null check(anchor_mode in ('completed_care','fixed_schedule')),
 month_end text not null check(month_end in ('clamp','preserve_end')),
 active boolean not null default true,review_note text not null check(length(trim(review_note)) between 1 and 2000),
 version integer not null default 1 check(version>0),approved_by uuid not null references public.profiles(id),
 approved_at timestamptz not null default clock_timestamp(),
 check(interval_amount between 1 and case interval_unit when 'days' then 36500 when 'weeks' then 5200 when 'months' then 1200 else 100 end)
);
create table public.patient_care_plans(
 id uuid primary key,pet_id uuid not null references public.pets(id) on delete restrict,
 template_id uuid not null references public.recurring_care_templates(id) on delete restrict,
 template_version integer not null,template_snapshot jsonb not null,care_key text not null,
 name text not null check(length(trim(name)) between 1 and 160),care_kind text not null check(care_kind in ('wellness','bloodwork','vaccine','custom')),
 interval_amount integer not null,interval_unit text not null check(interval_unit in ('days','weeks','months','years')),
 anchor_mode text not null check(anchor_mode in ('completed_care','fixed_schedule')),month_end text not null check(month_end in ('clamp','preserve_end')),
 anchor_on date not null check(isfinite(anchor_on) and anchor_on between '0001-01-01' and '9999-12-31'),
 cycle_index integer not null default 1 check(cycle_index between 1 and 1000000),
 due_on date not null check(isfinite(due_on) and due_on>anchor_on and due_on<='9999-12-31'),
 status text not null check(status in ('proposed','current','paused','retired')),
 reminders_enabled boolean not null default false,override_reason text not null default '' check(length(override_reason)<=2000),
 review_note text not null check(length(trim(review_note)) between 1 and 2000),
 approved_by uuid references public.profiles(id),approved_at timestamptz,last_completion_id uuid,
 occurrence_id uuid not null default gen_random_uuid(),
 version integer not null default 1 check(version>0),created_by uuid not null references public.profiles(id),updated_by uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check(interval_amount between 1 and case interval_unit when 'days' then 36500 when 'weeks' then 5200 when 'months' then 1200 else 100 end),
 check(status<>'current' or (approved_by is not null and approved_at is not null)),
 check(status='current' or not reminders_enabled)
);
create unique index patient_care_plan_one_key on public.patient_care_plans(pet_id,care_key) where status<>'retired';
create index patient_care_plan_due on public.patient_care_plans(due_on,pet_id,id) where status='current';
create table public.care_plan_completions(
 id uuid primary key,plan_id uuid not null references public.patient_care_plans(id) on delete restrict,
 pet_id uuid not null references public.pets(id) on delete restrict,plan_version integer not null,
 source_kind text not null check(source_kind in ('service','vaccine','lab')),source_id uuid not null,source_version integer not null,
 source_snapshot jsonb not null,completed_on date not null check(isfinite(completed_on)),next_due_on date not null check(isfinite(next_due_on)),
 review_note text not null check(length(trim(review_note)) between 1 and 2000),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp(),
 unique(plan_id,source_kind,source_id)
);
alter table public.patient_care_plans add constraint patient_care_plan_completion_fk foreign key(last_completion_id) references public.care_plan_completions(id) on delete restrict;
create table public.care_workflow_actions(
 id uuid primary key,kind text not null,entity_id uuid not null,pet_id uuid references public.pets(id) on delete restrict,
 request jsonb not null,receipt jsonb not null,actor_id uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp()
);
create table public.care_workflow_revisions(
 entity text not null check(entity in ('template','plan')),entity_id uuid not null,version integer not null,
 snapshot jsonb not null,actor_id uuid references public.profiles(id),recorded_at timestamptz not null default clock_timestamp(),
 primary key(entity,entity_id,version)
);
create table public.care_plan_delivery_windows(
 policy_id uuid primary key references public.reminder_automation_policies(id) on delete restrict,
 start_minute integer not null check(start_minute between 0 and 1439),
 end_minute integer not null check(end_minute between 1 and 1440 and end_minute>start_minute)
);
create table public.care_delivery_deferrals(
 outbox_id uuid primary key references public.communication_outbox(id) on delete restrict,
 eligible_at timestamptz not null check(isfinite(eligible_at)),recorded_at timestamptz not null default clock_timestamp()
);
create function public.care_workflow_immutable() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Care workflow evidence is immutable' using errcode='23514';end $$;
revoke all on function public.care_workflow_immutable() from public,anon,authenticated,service_role;
create trigger care_actions_immutable before update or delete on public.care_workflow_actions for each row execute function public.care_workflow_immutable();
create trigger care_completions_immutable before update or delete on public.care_plan_completions for each row execute function public.care_workflow_immutable();
create trigger care_revisions_immutable before update or delete on public.care_workflow_revisions for each row execute function public.care_workflow_immutable();

-- Separate branches avoid referencing a missing record field in a trigger's other table.
create function public.care_workflow_revision() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_argv[0]='template' then
  insert into public.care_workflow_revisions values('template',new.id,new.version,to_jsonb(new),new.approved_by,clock_timestamp());
 else insert into public.care_workflow_revisions values('plan',new.id,new.version,to_jsonb(new),auth.uid(),clock_timestamp());end if;
 return new;
end $$;
revoke all on function public.care_workflow_revision() from public,anon,authenticated,service_role;
create trigger recurring_template_history after insert or update on public.recurring_care_templates for each row execute function public.care_workflow_revision('template');
create trigger patient_care_plan_history after insert or update on public.patient_care_plans for each row execute function public.care_workflow_revision('plan');

do $$declare t text;begin
 foreach t in array array['recurring_care_templates','patient_care_plans','care_plan_completions','care_workflow_actions','care_workflow_revisions','care_plan_delivery_windows','care_delivery_deferrals'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

create function public.care_recover_action(p_action_id uuid,p_kind text,p_entity_id uuid,p_pet_id uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.care_workflow_actions;
begin
 if p_action_id is null or p_entity_id is null then raise exception 'Stable action and entity identity required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('care-action:'||p_action_id::text,0));
 select * into r from public.care_workflow_actions where id=p_action_id;
 if not found then return null;end if;
 if row(r.kind,r.entity_id,r.pet_id,r.actor_id,r.request) is distinct from row(p_kind,p_entity_id,p_pet_id,auth.uid(),p_request)
 then raise exception 'Care action identity reused with changed request' using errcode='23505';end if;
 return r.receipt;
end $$;
revoke all on function public.care_recover_action(uuid,text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.care_completion_source(p_pet_id uuid,p_source_kind text,p_source_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s public.patient_service_events;v public.patient_treatments;l public.patient_lab_orders;day date;label text;ver integer;instant timestamptz;
begin
 if p_source_kind='service' then
  select * into s from public.patient_service_events where id=p_source_id and pet_id=p_pet_id for share;
  if s.id is null or s.performed_at>clock_timestamp() or exists(select 1 from public.patient_service_corrections where service_event_id=s.id) then return null;end if;
  day:=(s.performed_at at time zone 'America/Denver')::date;label:=s.product_name;ver:=1;instant:=s.performed_at;
 elsif p_source_kind='vaccine' then
  select * into v from public.patient_treatments where id=p_source_id and pet_id=p_pet_id and kind='vaccine' and not historical for share;
  if v.id is null or v.administered_at>clock_timestamp() or exists(select 1 from public.patient_treatment_corrections where treatment_id=v.id) then return null;end if;
  day:=(v.administered_at at time zone 'America/Denver')::date;label:=v.product_name;ver:=1;instant:=v.administered_at;
 elsif p_source_kind='lab' then
  select * into l from public.patient_lab_orders where id=p_source_id and pet_id=p_pet_id for share;
  if l.id is null or l.status not in ('collected','resulted') or l.collected_date is null then return null;end if;
  day:=l.collected_date;label:=l.test_name;ver:=l.version;instant:=day::timestamp at time zone 'America/Denver';
 else return null;end if;
 if day is null or not isfinite(day) or day>(clock_timestamp() at time zone 'America/Denver')::date then return null;end if;
 return jsonb_build_object('source_kind',p_source_kind,'id',p_source_id,'pet_id',p_pet_id,'completed_on',day,'source_version',ver,'label',label,'at',instant);
end $$;
revoke all on function public.care_completion_source(uuid,text,uuid) from public,anon,authenticated,service_role;

create function public.care_plan_source_is_current(p_plan_id uuid) returns boolean
language plpgsql security definer set search_path=public as $$
declare p public.patient_care_plans;c public.care_plan_completions;source jsonb;
begin
 select * into p from public.patient_care_plans where id=p_plan_id;
 if p.id is null or p.status<>'current' or not public.is_active_staff(p.approved_by)
 or not exists(select 1 from public.user_roles where user_id=p.approved_by and role='DVM') then return false;end if;
 if p.last_completion_id is not null then
  select * into c from public.care_plan_completions where id=p.last_completion_id;
  source:=public.care_completion_source(p.pet_id,c.source_kind,c.source_id);
  if source is null or source is distinct from c.source_snapshot then return false;end if;
 end if;
 return true;
end $$;
revoke all on function public.care_plan_source_is_current(uuid) from public,anon,authenticated,service_role;

-- A wording, preference or patient-name change is not permission to send a new
-- intent after an attempt already started for the same clinical due occurrence.
-- Retries of the same original outbox remain subject to its existing reviewed path.
create function public.care_occurrence_has_handoff(p_occurrence_id uuid,p_except_outbox uuid default null) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(
  select 1 from public.care_reminder_jobs j join public.reminder_outbox_links link on link.job_kind='care' and link.job_id=j.id
  join public.communication_outbox o on o.id=link.outbox_id
  where j.source_kind='care_plan' and j.source_snapshot->>'occurrence_id'=p_occurrence_id::text
  and (p_except_outbox is null or o.id<>p_except_outbox)
  and (o.first_attempt_at is not null or o.state in ('accepted','delivered','uncertain')
   or link.invalidated_at is null and o.state in ('pending','claimed'))
 )
$$;
revoke all on function public.care_occurrence_has_handoff(uuid,uuid) from public,anon,authenticated,service_role;

create function public.save_recurring_care_template(p_action_id uuid,p_id uuid,p_expected_version integer,p_request jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid;receipt jsonb;r public.recurring_care_templates;request jsonb;
begin
 perform public.care_eligibility_lock();actor:=public.care_require_clinician();
 perform public.native_rx_keys(p_request,array['care_key','name','care_kind','interval_amount','interval_unit','anchor_mode','month_end','active','review_note']);
 request:=jsonb_build_object('expected_version',p_expected_version,'values',p_request);
 receipt:=public.care_recover_action(p_action_id,'template',p_id,null,request);if receipt is not null then return receipt;end if;
 perform public.native_rx_text(p_request->'name',160);perform public.native_rx_text(p_request->'review_note',2000);
 perform public.care_calendar_due('2000-01-31',public.native_rx_revision(p_request->'interval_amount'),p_request->>'interval_unit',p_request->>'month_end');
 if p_request->>'care_key' is null or p_request->>'care_key'!~'^[a-z0-9][a-z0-9_-]{0,79}$'
 or p_request->>'care_kind' is null or p_request->>'care_kind' not in ('wellness','bloodwork','vaccine','custom')
 or p_request->>'anchor_mode' is null or p_request->>'anchor_mode' not in ('completed_care','fixed_schedule')
 or jsonb_typeof(p_request->'active') is distinct from 'boolean' then raise exception 'Reviewed care default fields required' using errcode='23514';end if;
 select * into r from public.recurring_care_templates where id=p_id for update;
 if r.id is null and p_expected_version is not null or r.id is not null and r.version is distinct from p_expected_version
 then raise exception 'Care default changed; review latest saved version' using errcode='PT409';end if;
 if r.id is not null and row(r.care_key,r.care_kind) is distinct from row(p_request->>'care_key',p_request->>'care_kind')
 then raise exception 'Care key and category are immutable; create a different default' using errcode='23514';end if;
 if r.id is null then
  insert into public.recurring_care_templates(id,care_key,name,care_kind,interval_amount,interval_unit,anchor_mode,month_end,active,review_note,approved_by)
  values(p_id,p_request->>'care_key',trim(p_request->>'name'),p_request->>'care_kind',(p_request->>'interval_amount')::integer,p_request->>'interval_unit',
   p_request->>'anchor_mode',p_request->>'month_end',(p_request->>'active')::boolean,trim(p_request->>'review_note'),actor) returning * into r;
 else update public.recurring_care_templates set name=trim(p_request->>'name'),interval_amount=(p_request->>'interval_amount')::integer,
  interval_unit=p_request->>'interval_unit',anchor_mode=p_request->>'anchor_mode',month_end=p_request->>'month_end',
  active=(p_request->>'active')::boolean,review_note=trim(p_request->>'review_note'),version=version+1,approved_by=actor,approved_at=clock_timestamp()
  where id=p_id returning * into r;end if;
 receipt:=to_jsonb(r);
 insert into public.care_workflow_actions(id,kind,entity_id,request,receipt,actor_id) values(p_action_id,'template',p_id,request,receipt,actor);
 return receipt;
end $$;

create function public.save_patient_care_plan(p_action_id uuid,p_id uuid,p_pet_id uuid,p_expected_version integer,p_request jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid;receipt jsonb;r public.patient_care_plans;t public.recurring_care_templates;snapshot jsonb;request jsonb;
 v_template_id uuid;v_template_version integer;anchor date;due date;cycle integer:=1;calculated date;approved uuid;approval_at timestamptz;v_status text;completion public.care_plan_completions;
begin
 perform public.care_eligibility_lock();actor:=public.clinical_require_staff();
 perform public.native_rx_keys(p_request,array['template_id','template_version','name','interval_amount','interval_unit','anchor_mode','month_end','anchor_on','due_on','status','reminders_enabled','override_reason','review_note','replace_anchor_evidence']);
 request:=jsonb_build_object('expected_version',p_expected_version,'values',p_request);
 receipt:=public.care_recover_action(p_action_id,'plan',p_id,p_pet_id,request);if receipt is not null then return receipt;end if;
 if p_pet_id is null then raise exception 'Patient required' using errcode='23514';end if;
 perform 1 from public.pets where id=p_pet_id and archived_at is null and deceased_at is null for update;
 if not found then raise exception 'Active patient required for care planning' using errcode='23514';end if;
 v_template_id:=public.native_rx_uuid(p_request->'template_id');v_template_version:=public.native_rx_revision(p_request->'template_version');
 anchor:=public.care_date(p_request->'anchor_on');due:=public.care_date(p_request->'due_on');v_status:=p_request->>'status';
 perform public.native_rx_text(p_request->'name',160);perform public.native_rx_text(p_request->'review_note',2000);
 if anchor is null or anchor>(clock_timestamp() at time zone 'America/Denver')::date or due is null
 or v_status is null or v_status not in ('proposed','current','paused','retired') or jsonb_typeof(p_request->'reminders_enabled') is distinct from 'boolean'
 or jsonb_typeof(p_request->'replace_anchor_evidence') is distinct from 'boolean'
 or jsonb_typeof(p_request->'override_reason') is distinct from 'string' or length(p_request->>'override_reason')>2000
 then raise exception 'Reviewed finite care dates, state and rationale required' using errcode='23514';end if;
 select * into r from public.patient_care_plans where id=p_id for update;
 if r.id is not null and r.pet_id<>p_pet_id then raise exception 'Care plan belongs to another patient' using errcode='42501';end if;
 if r.id is null and p_expected_version is not null or r.id is not null and r.version is distinct from p_expected_version
 then raise exception 'Care plan changed; review latest saved version' using errcode='PT409';end if;
 if r.status='retired' then raise exception 'Retired care plan is immutable; create a new plan' using errcode='23514';end if;
 select * into t from public.recurring_care_templates where id=v_template_id for share;
 if r.id is not null and row(r.template_id,r.template_version) is not distinct from row(v_template_id,v_template_version)
 then snapshot:=r.template_snapshot;
 else
  if t.id is null or not t.active or t.version is distinct from v_template_version then raise exception 'Care default changed or retired; review latest version' using errcode='PT409';end if;
  snapshot:=to_jsonb(t);
 end if;
 if r.id is not null and r.care_key is distinct from snapshot->>'care_key' then raise exception 'Plan cannot change care key' using errcode='23514';end if;
 if r.id is not null and row(r.anchor_on,r.interval_amount,r.interval_unit,r.anchor_mode,r.month_end)
 is not distinct from row(anchor,public.native_rx_revision(p_request->'interval_amount'),p_request->>'interval_unit',p_request->>'anchor_mode',p_request->>'month_end')
 then cycle:=r.cycle_index;end if;
 calculated:=public.care_calendar_due(anchor,public.native_rx_revision(p_request->'interval_amount'),p_request->>'interval_unit',p_request->>'month_end',cycle);
 if p_request->>'anchor_mode' is null or p_request->>'anchor_mode' not in ('completed_care','fixed_schedule') then raise exception 'Calendar anchor rule required' using errcode='23514';end if;
 if (row(trim(p_request->>'name'),p_request->'interval_amount',p_request->>'interval_unit',p_request->>'anchor_mode',p_request->>'month_end')
  is distinct from row(snapshot->>'name',snapshot->'interval_amount',snapshot->>'interval_unit',snapshot->>'anchor_mode',snapshot->>'month_end') or due<>calculated)
 and nullif(trim(p_request->>'override_reason'),'') is null then raise exception 'Patient-specific interval, date or name override requires rationale' using errcode='23514';end if;
 if (p_request->>'replace_anchor_evidence')::boolean and nullif(trim(p_request->>'override_reason'),'') is null
 then raise exception 'Replacing completion evidence with a reviewed baseline requires rationale' using errcode='23514';end if;
 if v_status='current' then
  approved:=public.care_require_clinician();approval_at:=clock_timestamp();
  -- A corrected prior anchor cannot be restored by acknowledging unchanged stale evidence.
  if r.last_completion_id is not null then
   select * into completion from public.care_plan_completions where id=r.last_completion_id;
   if public.care_completion_source(p_pet_id,completion.source_kind,completion.source_id) is distinct from completion.source_snapshot
   and not (p_request->>'replace_anchor_evidence')::boolean then raise exception 'Completion evidence changed; explicitly review the calendar anchor' using errcode='PT409';end if;
  end if;
 elsif v_status in ('paused','retired') then approved:=r.approved_by;approval_at:=r.approved_at;end if;
 if r.id is null then
  if v_status not in ('proposed','current') then raise exception 'New plan must be proposed or clinically reviewed' using errcode='23514';end if;
  insert into public.patient_care_plans(id,pet_id,template_id,template_version,template_snapshot,care_key,name,care_kind,interval_amount,interval_unit,anchor_mode,month_end,anchor_on,cycle_index,due_on,status,reminders_enabled,override_reason,review_note,approved_by,approved_at,created_by,updated_by)
  values(p_id,p_pet_id,v_template_id,v_template_version,snapshot,snapshot->>'care_key',trim(p_request->>'name'),snapshot->>'care_kind',
   (p_request->>'interval_amount')::integer,p_request->>'interval_unit',p_request->>'anchor_mode',p_request->>'month_end',anchor,cycle,due,v_status,
   v_status='current' and (p_request->>'reminders_enabled')::boolean,trim(p_request->>'override_reason'),trim(p_request->>'review_note'),approved,approval_at,actor,actor)
  returning * into r;
 else update public.patient_care_plans set template_id=v_template_id,template_version=v_template_version,template_snapshot=snapshot,
  name=trim(p_request->>'name'),interval_amount=(p_request->>'interval_amount')::integer,interval_unit=p_request->>'interval_unit',
  anchor_mode=p_request->>'anchor_mode',month_end=p_request->>'month_end',anchor_on=anchor,cycle_index=cycle,due_on=due,status=v_status,
  reminders_enabled=v_status='current' and (p_request->>'reminders_enabled')::boolean,override_reason=trim(p_request->>'override_reason'),
  review_note=trim(p_request->>'review_note'),approved_by=approved,approved_at=approval_at,
  last_completion_id=case when v_status='current' and ((p_request->>'replace_anchor_evidence')::boolean or anchor<>r.anchor_on) then null else r.last_completion_id end,
  occurrence_id=case when due<>r.due_on then gen_random_uuid() else r.occurrence_id end,
  version=version+1,updated_by=actor,updated_at=clock_timestamp() where id=p_id returning * into r;end if;
 receipt:=to_jsonb(r);
 insert into public.care_workflow_actions(id,kind,entity_id,pet_id,request,receipt,actor_id) values(p_action_id,'plan',p_id,p_pet_id,request,receipt,actor);
 return receipt;
end $$;

create function public.care_completion_next(p_plan_id uuid,p_pet_id uuid,p_source_kind text,p_source_id uuid,p_source_version integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p public.patient_care_plans;source jsonb;day date;next_due date;anchor date;cycle integer;months integer;c public.care_plan_completions;
begin
 select * into p from public.patient_care_plans where id=p_plan_id and pet_id=p_pet_id for share;
 if p.id is null or not public.care_plan_source_is_current(p.id) then raise exception 'Current clinically reviewed care plan required' using errcode='23514';end if;
 source:=public.care_completion_source(p_pet_id,p_source_kind,p_source_id);
 if source is null or (source->>'source_version')::integer is distinct from p_source_version then raise exception 'Completed care source changed or is ineligible for this patient' using errcode='PT409';end if;
 if p.care_kind='wellness' and p_source_kind<>'service' or p.care_kind='bloodwork' and p_source_kind<>'lab' or p.care_kind='vaccine' and p_source_kind<>'vaccine'
 then raise exception 'Choose completed evidence for this care category' using errcode='23514';end if;
 if exists(select 1 from public.care_plan_completions where plan_id=p.id and source_kind=p_source_kind and source_id=p_source_id)
 then raise exception 'This completed care already advanced this plan' using errcode='23514';end if;
 day:=(source->>'completed_on')::date;
 if p.last_completion_id is not null then select * into c from public.care_plan_completions where id=p.last_completion_id;end if;
 if day<=p.anchor_on or c.id is not null and day<=c.completed_on then raise exception 'Completed care date must advance the prior anchor/completion' using errcode='23514';end if;
 if p.anchor_mode='completed_care' then anchor:=day;cycle:=1;
 else
  anchor:=p.anchor_on;
  if p.interval_unit in ('days','weeks') then cycle:=greatest(p.cycle_index+1,(day-anchor)/(p.interval_amount*case when p.interval_unit='weeks' then 7 else 1 end)+1);
  else
   months:=(extract(year from day)::integer-extract(year from anchor)::integer)*12+extract(month from day)::integer-extract(month from anchor)::integer;
   cycle:=greatest(p.cycle_index+1,months/(p.interval_amount*case when p.interval_unit='years' then 12 else 1 end));
  end if;
 end if;
 next_due:=public.care_calendar_due(anchor,p.interval_amount,p.interval_unit,p.month_end,cycle);
 if next_due<=day then cycle:=cycle+1;next_due:=public.care_calendar_due(anchor,p.interval_amount,p.interval_unit,p.month_end,cycle);end if;
 return jsonb_build_object('source',source,'completed_on',day,'next_due_on',next_due,'next_anchor_on',anchor,'next_cycle_index',cycle);
end $$;
revoke all on function public.care_completion_next(uuid,uuid,text,uuid,integer) from public,anon,authenticated,service_role;

create function public.preview_care_plan_completion(p_plan_id uuid,p_pet_id uuid,p_expected_version integer,p_source_kind text,p_source_id uuid,p_source_version integer)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform public.care_eligibility_lock();perform public.care_require_clinician();
 perform 1 from public.pets where id=p_pet_id and archived_at is null and deceased_at is null for share;
 if not found then raise exception 'Active patient required' using errcode='23514';end if;
 perform 1 from public.patient_care_plans where id=p_plan_id and pet_id=p_pet_id and version=p_expected_version for share;
 if not found then raise exception 'Care plan changed; review latest version' using errcode='PT409';end if;
 return public.care_completion_next(p_plan_id,p_pet_id,p_source_kind,p_source_id,p_source_version);
end $$;

create function public.complete_patient_care_plan(p_action_id uuid,p_plan_id uuid,p_pet_id uuid,p_expected_version integer,p_request jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid;receipt jsonb;r public.patient_care_plans;c public.care_plan_completions;request jsonb;preview jsonb;
begin
 perform public.care_eligibility_lock();actor:=public.care_require_clinician();
 perform public.native_rx_keys(p_request,array['source_kind','source_id','source_version','review_note']);
 request:=jsonb_build_object('expected_version',p_expected_version,'values',p_request);
 receipt:=public.care_recover_action(p_action_id,'completion',p_plan_id,p_pet_id,request);if receipt is not null then return receipt;end if;
 perform public.native_rx_text(p_request->'review_note',2000);
 perform 1 from public.pets where id=p_pet_id and archived_at is null and deceased_at is null for update;
 if not found then raise exception 'Active patient required' using errcode='23514';end if;
 select * into r from public.patient_care_plans where id=p_plan_id and pet_id=p_pet_id for update;
 if r.id is null or r.version is distinct from p_expected_version then raise exception 'Care plan changed; review latest version' using errcode='PT409';end if;
 preview:=public.care_completion_next(p_plan_id,p_pet_id,p_request->>'source_kind',public.native_rx_uuid(p_request->'source_id'),public.native_rx_revision(p_request->'source_version'));
 insert into public.care_plan_completions(id,plan_id,pet_id,plan_version,source_kind,source_id,source_version,source_snapshot,completed_on,next_due_on,review_note,created_by)
 values(p_action_id,p_plan_id,p_pet_id,r.version,p_request->>'source_kind',(p_request->>'source_id')::uuid,(p_request->>'source_version')::integer,
  preview->'source',(preview->>'completed_on')::date,(preview->>'next_due_on')::date,trim(p_request->>'review_note'),actor) returning * into c;
 update public.patient_care_plans set anchor_on=(preview->>'next_anchor_on')::date,cycle_index=(preview->>'next_cycle_index')::integer,
  due_on=c.next_due_on,last_completion_id=c.id,occurrence_id=gen_random_uuid(),version=version+1,updated_by=actor,updated_at=clock_timestamp(),approved_by=actor,approved_at=clock_timestamp()
  where id=p_plan_id returning * into r;
 receipt:=jsonb_build_object('plan',to_jsonb(r),'completion',to_jsonb(c));
 insert into public.care_workflow_actions(id,kind,entity_id,pet_id,request,receipt,actor_id) values(p_action_id,'completion',p_plan_id,p_pet_id,request,receipt,actor);
 return receipt;
end $$;

create function public.care_window_next_open(p_start integer,p_end integer,p_at timestamptz)
returns timestamptz language plpgsql stable set search_path=public as $$
declare local_at timestamp;minutes integer;day date;
begin
 if p_start is null or p_end is null or p_start not between 0 and 1439 or p_end not between 1 and 1440 or p_end<=p_start
 or p_at is null or not isfinite(p_at) then raise exception 'Finite Denver daytime send window required' using errcode='23514';end if;
 local_at:=p_at at time zone 'America/Denver';minutes:=extract(hour from local_at)::integer*60+extract(minute from local_at)::integer;day:=local_at::date;
 if minutes>=p_start and minutes<p_end then return p_at;end if;
 if minutes>=p_end then day:=day+1;end if;
 return (day::timestamp+make_interval(mins=>p_start)) at time zone 'America/Denver';
end $$;
revoke all on function public.care_window_next_open(integer,integer,timestamptz) from public,anon,authenticated,service_role;

create function public.save_care_plan_delivery_policy(p_action_id uuid,p_id uuid,p_expected_version integer,p_request jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid;r public.reminder_automation_policies;t public.care_message_templates;w public.care_plan_delivery_windows;
 receipt jsonb;request jsonb;channel text;start_at integer;end_at integer;
begin
 perform public.care_eligibility_lock();actor:=public.care_require_admin();
 perform public.native_rx_keys(p_request,array['channel','message_template_id','message_template_version','subject','enabled','review_note','start_minute','end_minute']);
 request:=jsonb_build_object('expected_version',p_expected_version,'values',p_request);
 receipt:=public.care_recover_action(p_action_id,'delivery_policy',p_id,null,request);if receipt is not null then return receipt;end if;
 channel:=p_request->>'channel';perform public.native_rx_text(p_request->'review_note',2000);
 if channel is null or channel not in ('EMAIL','SMS') or jsonb_typeof(p_request->'enabled') is distinct from 'boolean'
 or jsonb_typeof(p_request->'subject') is distinct from 'string' or length(p_request->>'subject')>300
 or jsonb_typeof(p_request->'start_minute') is distinct from 'number' or (p_request->>'start_minute')!~'^[0-9]+$'
 or jsonb_typeof(p_request->'end_minute') is distinct from 'number' or (p_request->>'end_minute')!~'^[0-9]+$'
 then raise exception 'Reviewed channel, wording and send window required' using errcode='23514';end if;
 start_at:=(p_request->>'start_minute')::integer;end_at:=(p_request->>'end_minute')::integer;
 perform public.care_window_next_open(start_at,end_at,clock_timestamp());
 select * into r from public.reminder_automation_policies where id=p_id for update;
 if r.id is null and p_expected_version is not null or r.id is not null and r.version is distinct from p_expected_version
 then raise exception 'Recurring care delivery policy changed' using errcode='PT409';end if;
 if r.id is not null and (r.source_kind<>'care_plan' or r.channel<>channel) then raise exception 'Policy source and channel are immutable' using errcode='23514';end if;
 if r.id is not null and not (p_request->>'enabled')::boolean then
  if public.native_rx_uuid(p_request->'message_template_id') is distinct from r.message_template_id
  or public.native_rx_revision(p_request->'message_template_version') is distinct from r.message_template_version
  then raise exception 'Disabling retains previously reviewed wording' using errcode='23514';end if;
  t.id:=r.message_template_id;t.version:=r.message_template_version;
 else
  select * into t from public.care_message_templates where id=public.native_rx_uuid(p_request->'message_template_id') for share;
  if t.id is null or not t.active or t.version is distinct from public.native_rx_revision(p_request->'message_template_version') or upper(t.channel)<>channel
  then raise exception 'Current reviewed message wording for this channel required' using errcode='23514';end if;
 end if;
 if r.id is null then
  insert into public.reminder_automation_policies(id,source_kind,channel,message_template_id,message_template_version,subject,enabled,review_note,approved_by)
  values(p_id,'care_plan',channel,t.id,t.version,p_request->>'subject',(p_request->>'enabled')::boolean,trim(p_request->>'review_note'),actor) returning * into r;
 else update public.reminder_automation_policies set message_template_id=t.id,message_template_version=t.version,
  subject=p_request->>'subject',enabled=(p_request->>'enabled')::boolean,review_note=trim(p_request->>'review_note'),
  version=version+1,approved_by=actor,approved_at=clock_timestamp() where id=p_id returning * into r;end if;
 insert into public.care_plan_delivery_windows(policy_id,start_minute,end_minute) values(r.id,start_at,end_at)
 on conflict(policy_id) do update set start_minute=excluded.start_minute,end_minute=excluded.end_minute returning * into w;
 receipt:=jsonb_build_object('policy',to_jsonb(r),'window',to_jsonb(w));
 insert into public.reminder_automation_policy_history(policy_id,version,snapshot) values(r.id,r.version,receipt);
 insert into public.care_workflow_actions(id,kind,entity_id,request,receipt,actor_id) values(p_action_id,'delivery_policy',p_id,request,receipt,actor);
 return receipt;
end $$;

create function public.care_defer_attempt(p_id uuid,p_lease_token uuid) returns public.communication_outbox
language plpgsql security definer set search_path=public as $$
declare r public.communication_outbox;w public.care_plan_delivery_windows;next_open timestamptz;instant timestamptz:=clock_timestamp();
begin
 perform public.care_eligibility_lock();perform public.communication_require_service();
 select * into r from public.communication_outbox where id=p_id for update;
 if r.id is null or r.state<>'claimed' or r.lease_token is distinct from p_lease_token or r.attempt_started_at is not null
 or r.lease_expires_at<=clock_timestamp() then raise exception 'Outbox lease is unavailable' using errcode='PT409';end if;
 select windows.* into w from public.reminder_outbox_links link
 join public.reminder_automation_policies policy on policy.id=link.policy_id and policy.source_kind='care_plan'
 join public.care_plan_delivery_windows windows on windows.policy_id=policy.id where link.outbox_id=r.id;
 if w.policy_id is null then return null;end if;
 instant:=clock_timestamp();next_open:=public.care_window_next_open(w.start_minute,w.end_minute,instant);
 if next_open<=instant then return null;end if;
 insert into public.care_delivery_deferrals(outbox_id,eligible_at) values(p_id,next_open)
 on conflict(outbox_id) do update set eligible_at=excluded.eligible_at,recorded_at=clock_timestamp();
 update public.communication_outbox set state='pending',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp()
 where id=p_id returning * into r;
 return r;
end $$;
revoke all on function public.care_defer_attempt(uuid,uuid) from public,anon,authenticated,service_role;

create function public.care_plan_invalidate_jobs() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update public.care_reminder_jobs set status='invalidated',invalidated_at=clock_timestamp(),invalidation_reason='Recurring care plan revised, completed, paused or retired'
 where source_kind='care_plan' and source_id=new.id and status='pending';
 return new;
end $$;
revoke all on function public.care_plan_invalidate_jobs() from public,anon,authenticated,service_role;
create trigger care_plan_jobs_invalidated after update on public.patient_care_plans for each row execute function public.care_plan_invalidate_jobs();

create function public.care_plan_patient_changed() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if (new.archived_at is not null or new.deceased_at is not null) or new.client_id is distinct from old.client_id then
  update public.patient_care_plans set status='proposed',reminders_enabled=false,approved_by=null,approved_at=null,
   review_note='Patient status/household changed; veterinarian must review before reminders resume',
   version=version+1,updated_at=clock_timestamp(),updated_by=coalesce(auth.uid(),updated_by)
  where pet_id=new.id and status in ('current','paused');
 elsif new.name is distinct from old.name then
  update public.patient_care_plans set version=version+1,updated_at=clock_timestamp(),updated_by=coalesce(auth.uid(),updated_by)
  where pet_id=new.id and status='current';
 end if;
 return new;
end $$;
revoke all on function public.care_plan_patient_changed() from public,anon,authenticated,service_role;
create trigger recurring_patient_status_changed after update on public.pets for each row execute function public.care_plan_patient_changed();

create function public.care_plan_completion_source_changed() returns trigger language plpgsql security definer set search_path=public as $$
declare v_kind text;v_source_id uuid;actor uuid;
begin
 if tg_table_name='patient_service_corrections' then v_kind:='service';v_source_id:=new.service_event_id;actor:=new.created_by;
 elsif tg_table_name='patient_treatment_corrections' then v_kind:='vaccine';v_source_id:=new.treatment_id;actor:=new.created_by;
 else
  if row(new.version,new.collected_date,new.status,new.test_name) is not distinct from row(old.version,old.collected_date,old.status,old.test_name) then return new;end if;
  v_kind:='lab';v_source_id:=new.id;actor:=new.updated_by;
 end if;
 update public.patient_care_plans p set status='proposed',reminders_enabled=false,approved_by=null,approved_at=null,
  review_note='Completed care evidence corrected or revised; veterinarian must review the schedule',
  version=p.version+1,updated_at=clock_timestamp(),updated_by=actor
 where p.status in ('current','paused') and exists(select 1 from public.care_plan_completions c where c.plan_id=p.id and c.source_kind=v_kind and c.source_id=v_source_id);
 return new;
end $$;
revoke all on function public.care_plan_completion_source_changed() from public,anon,authenticated,service_role;
create trigger recurring_service_source_corrected after insert on public.patient_service_corrections for each row execute function public.care_plan_completion_source_changed();
create trigger recurring_vaccine_source_corrected after insert on public.patient_treatment_corrections for each row execute function public.care_plan_completion_source_changed();
create trigger recurring_lab_source_revised after update on public.patient_lab_orders for each row execute function public.care_plan_completion_source_changed();

create function public.list_recurring_care_templates(p_after uuid default null,p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 perform public.clinical_require_staff();
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Bounded default page required' using errcode='23514';end if;
 with page as (select t.* from public.recurring_care_templates t where p_after is null or t.id>p_after order by t.id limit p_limit+1),
 rows as(select * from page order by id limit p_limit)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(rows) order by id) from rows),'[]'),
  'next',case when (select count(*) from page)>p_limit then (select id from rows order by id desc limit 1) else null end) into result;
 return result;
end $$;

create function public.read_recurring_care_template(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform public.clinical_require_staff();
 if p_id is null then raise exception 'Default identity required' using errcode='23514';end if;
 return (select to_jsonb(t) from public.recurring_care_templates t where id=p_id);
end $$;

create function public.care_plan_display(p_plan_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.patient_care_plans;pet public.pets;reason text;deferred timestamptz;
begin
 select * into p from public.patient_care_plans where id=p_plan_id;
 if p.id is null then return null;end if;
 select * into pet from public.pets where id=p.pet_id;
 reason:=case when pet.archived_at is not null or pet.deceased_at is not null then 'Patient inactive; routine reminders stopped'
 when p.status='proposed' then 'Awaiting veterinarian review' when p.status='paused' then 'Paused' when p.status='retired' then 'Retired'
 when not p.reminders_enabled then 'Reminders off' when not public.care_plan_source_is_current(p.id) then 'Clinical approval or completion evidence requires review'
 else 'Uses reviewed delivery policies, channel preference and final eligibility checks' end;
 select min(d.eligible_at) into deferred from public.care_reminder_jobs j
 join public.reminder_outbox_links link on link.job_kind='care' and link.job_id=j.id and link.invalidated_at is null
 join public.communication_outbox o on o.id=link.outbox_id and o.state='pending'
 join public.care_delivery_deferrals d on d.outbox_id=o.id and d.eligible_at>clock_timestamp()
 where j.source_kind='care_plan' and j.source_id=p.id and j.source_version=p.version;
 return jsonb_build_object('plan',to_jsonb(p),'patient_name',pet.name,'patient_inactive',pet.archived_at is not null or pet.deceased_at is not null,
  'reminder_reason',reason,'next_send_at',deferred);
end $$;
revoke all on function public.care_plan_display(uuid) from public,anon,authenticated,service_role;

create function public.list_patient_care_plans(p_pet_id uuid,p_after uuid default null,p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 perform public.clinical_require_staff();
 if p_pet_id is null or p_limit is null or p_limit not between 1 and 100 then raise exception 'Patient and bounded plan page required' using errcode='23514';end if;
 with page as (select id from public.patient_care_plans where pet_id=p_pet_id and (p_after is null or id>p_after) order by id limit p_limit+1),
 rows as(select * from page order by id limit p_limit)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(public.care_plan_display(id) order by id) from rows),'[]'),
  'next',case when (select count(*) from page)>p_limit then (select id from rows order by id desc limit 1) else null end) into result;
 return result;
end $$;
create function public.read_patient_care_plan(p_plan_id uuid,p_pet_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 perform public.clinical_require_staff();
 if p_plan_id is null or p_pet_id is null then raise exception 'Patient plan identity required' using errcode='23514';end if;
 if not exists(select 1 from public.patient_care_plans where id=p_plan_id and pet_id=p_pet_id) then return null;end if;
 return public.care_plan_display(p_plan_id);
end $$;

create function public.list_care_plan_history(p_plan_id uuid,p_pet_id uuid,p_before_version integer default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 perform public.clinical_require_staff();
 if not exists(select 1 from public.patient_care_plans where id=p_plan_id and pet_id=p_pet_id) then raise exception 'Patient plan unavailable' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 100 or p_before_version<1 then raise exception 'Bounded history page required' using errcode='23514';end if;
 with page as(select r.version,r.snapshot,r.actor_id,r.recorded_at,
   (select to_jsonb(c) from public.care_plan_completions c where c.plan_id=p_plan_id and c.plan_version+1=r.version) completion
  from public.care_workflow_revisions r where r.entity='plan' and r.entity_id=p_plan_id and (p_before_version is null or r.version<p_before_version)
  order by r.version desc limit p_limit+1),rows as(select * from page order by version desc limit p_limit)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(rows) order by version desc) from rows),'[]'),
  'next',case when (select count(*) from page)>p_limit then (select min(version) from rows) else null end) into result;
 return result;
end $$;

create function public.list_care_completion_sources(p_pet_id uuid,p_source_kind text default null,p_before jsonb default null,p_limit integer default 50,p_plan_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;before_at timestamptz;before_kind text;before_id uuid;after_day date;
begin
 perform public.clinical_require_staff();
 if p_pet_id is null or p_limit is null or p_limit not between 1 and 100 or p_source_kind is not null and p_source_kind not in ('service','vaccine','lab')
 then raise exception 'Patient and bounded completion-source page required' using errcode='23514';end if;
 if p_plan_id is not null then
  select greatest(p.anchor_on,c.completed_on) into after_day from public.patient_care_plans p
  left join public.care_plan_completions c on c.id=p.last_completion_id where p.id=p_plan_id and p.pet_id=p_pet_id;
  if not found then raise exception 'Patient plan unavailable' using errcode='42501';end if;
 end if;
 if p_before is not null then
  perform public.native_rx_keys(p_before,array['at','source_kind','id']);
  before_at:=public.native_correction_instant(p_before->'at');before_kind:=p_before->>'source_kind';before_id:=public.native_rx_uuid(p_before->'id');
  if before_kind is null or before_kind not in ('service','vaccine','lab') then raise exception 'Invalid source cursor' using errcode='23514';end if;
 end if;
 with candidates as(
  select 'service'::text kind,s.id,s.performed_at at_instant from public.patient_service_events s where s.pet_id=p_pet_id and s.performed_at<=clock_timestamp()
   and not exists(select 1 from public.patient_service_corrections c where c.service_event_id=s.id)
  union all select 'vaccine',v.id,v.administered_at from public.patient_treatments v where v.pet_id=p_pet_id and v.kind='vaccine' and not v.historical
   and v.administered_at<=clock_timestamp() and not exists(select 1 from public.patient_treatment_corrections c where c.treatment_id=v.id)
  union all select 'lab',l.id,l.collected_date::timestamp at time zone 'America/Denver' from public.patient_lab_orders l where l.pet_id=p_pet_id
   and l.status in ('collected','resulted') and l.collected_date is not null and l.collected_date<=(clock_timestamp() at time zone 'America/Denver')::date
 ),page as(select * from candidates where (p_source_kind is null or kind=p_source_kind)
  and (after_day is null or (at_instant at time zone 'America/Denver')::date>after_day)
  and (p_plan_id is null or not exists(select 1 from public.care_plan_completions c where c.plan_id=p_plan_id and c.source_kind=candidates.kind and c.source_id=candidates.id))
  and (p_before is null or (at_instant,kind,id)<(before_at,before_kind,before_id)) order by at_instant desc,kind desc,id desc limit p_limit+1),
 rows as(select *,public.care_completion_source(p_pet_id,kind,id) source from page order by at_instant desc,kind desc,id desc limit p_limit)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(source order by at_instant desc,kind desc,id desc) from rows where source is not null),'[]'),
  'next',case when (select count(*) from page)>p_limit then (select jsonb_build_object('at',at_instant,'source_kind',kind,'id',id) from rows order by at_instant,kind,id limit 1) else null end) into result;
 return result;
end $$;

create function public.list_recurring_care_due(p_filter text default 'upcoming',p_before jsonb default null,p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;today date:=(clock_timestamp() at time zone 'America/Denver')::date;before_due date;before_id uuid;
begin
 perform public.clinical_require_staff();
 if p_filter is null or p_filter not in ('upcoming','overdue','all','review') or p_limit is null or p_limit not between 1 and 100
 then raise exception 'Due filter and bounded page required' using errcode='23514';end if;
 if p_before is not null then
  perform public.native_rx_keys(p_before,array['due_on','id']);before_due:=public.care_date(p_before->'due_on');before_id:=public.native_rx_uuid(p_before->'id');
 end if;
 with page as(select p.* from public.patient_care_plans p join public.pets pet on pet.id=p.pet_id
  where pet.archived_at is null and pet.deceased_at is null and p.status=case when p_filter='review' then 'proposed' else 'current' end
   and (p_filter in ('all','review') or p_filter='overdue' and p.due_on<today or p_filter='upcoming' and p.due_on between today and today+30)
   and (p_before is null or (p.due_on,p.id)>(before_due,before_id)) order by p.due_on,p.id limit p_limit+1),
 rows as(select * from page order by due_on,id limit p_limit)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(public.care_plan_display(id) order by due_on,id) from rows),'[]'),
  'next',case when (select count(*) from page)>p_limit then (select jsonb_build_object('due_on',due_on,'id',id) from rows order by due_on desc,id desc limit 1) else null end) into result;
 return result;
end $$;

create function public.list_care_plan_delivery_windows() returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform public.care_require_admin();
 return coalesce((select jsonb_agg(to_jsonb(w) order by policy_id) from public.care_plan_delivery_windows w),'[]');
end $$;

create function public.read_care_workflow_action(p_action_id uuid,p_kind text,p_entity_id uuid,p_pet_id uuid,p_request jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid;r public.care_workflow_actions;
begin
 actor:=public.clinical_require_staff();
 if p_action_id is null or p_entity_id is null or p_kind is null or p_kind not in ('template','plan','completion','delivery_policy')
 or jsonb_typeof(p_request) is distinct from 'object' then raise exception 'Exact action identity and request required' using errcode='23514';end if;
 select * into r from public.care_workflow_actions where id=p_action_id;
 if not found then return null;end if;
 if row(r.kind,r.entity_id,r.pet_id,r.actor_id,r.request) is distinct from row(p_kind,p_entity_id,p_pet_id,actor,p_request)
 then raise exception 'Care action identity reused with changed request' using errcode='23505';end if;
 return r.receipt;
end $$;

-- Public reads/writes require actual staff authorization; helpers and physical tables stay private.
do $$declare p record;begin
 for p in select oid from pg_proc where pronamespace='public'::regnamespace and proname=any(array[
  'save_recurring_care_template','save_patient_care_plan','preview_care_plan_completion','complete_patient_care_plan','save_care_plan_delivery_policy',
  'list_recurring_care_templates','read_recurring_care_template','list_patient_care_plans','read_patient_care_plan','list_care_plan_history','list_care_completion_sources',
  'list_recurring_care_due','list_care_plan_delivery_windows','read_care_workflow_action']) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',p.oid::regprocedure);
  execute format('grant execute on function %s to authenticated',p.oid::regprocedure);
 end loop;
end $$;

-- Extend sources without changing existing policy row shapes or frozen delivery contexts.
alter table public.care_reminder_jobs drop constraint care_reminder_jobs_source_kind_check;
alter table public.care_reminder_jobs add constraint care_reminder_jobs_source_kind_check check(source_kind in ('vaccine','lab','care_plan'));
alter table public.reminder_automation_policies drop constraint reminder_automation_policies_source_kind_check;
alter table public.reminder_automation_policies add constraint reminder_automation_policies_source_kind_check check(source_kind in ('appointment','vaccine','lab','care_plan'));


-- Extend list_care_reminder_candidates; preserve the existing signature and grants.
CREATE OR REPLACE FUNCTION public.list_care_reminder_candidates(p_through date, p_after_kind text DEFAULT ''::text, p_after_id uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid, p_limit integer DEFAULT 100)
 RETURNS TABLE(source_kind text, source_id uuid, source_version integer, pet_id uuid, due_on date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service discovery only' using errcode='42501';end if;
 if p_through is null or not isfinite(p_through) or p_limit is null or p_limit not between 1 and 500 or p_after_kind is null or p_after_id is null then raise exception 'Finite discovery horizon and bounded page required' using errcode='23514';end if;
 return query select x.kind,x.id,x.version,x.patient,x.due from (
 select 'vaccine'::text kind,v.id,v.version,v.pet_id patient,v.current_due_on due from public.patient_vaccine_due_plans v where v.status='current' and v.reminders_enabled
 union all select 'lab'::text,l.id,l.version,l.pet_id,l.due_date from public.patient_lab_orders l where l.status in ('planned','ordered') and l.reminders_enabled and l.due_date is not null
 union all select 'care_plan',cp.id,cp.version,cp.pet_id,cp.due_on from public.patient_care_plans cp where cp.status='current' and cp.reminders_enabled and public.care_plan_source_is_current(cp.id)
 ) x join public.pets p on p.id=x.patient where p.archived_at is null and p.deceased_at is null and x.due<=p_through and row(x.kind,x.id)>row(p_after_kind,p_after_id) order by x.kind,x.id limit p_limit;
end $function$
;




-- Extend enqueue_care_reminder; preserve the existing signature and grants.
CREATE OR REPLACE FUNCTION public.enqueue_care_reminder(p_id uuid, p_source_kind text, p_source_id uuid, p_expected_source_version integer, p_message_template_id uuid, p_expected_template_version integer)
 RETURNS care_reminder_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.care_reminder_jobs;t public.care_message_templates;p public.pets;v public.patient_vaccine_due_plans;l public.patient_lab_orders;cp public.patient_care_plans;patient_id uuid;due date;care_name text;snapshot jsonb;body text;part record;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service enqueue only' using errcode='42501';end if;
 if p_id is null then raise exception 'Stable job ID required' using errcode='23514';end if;
 if p_source_kind='vaccine' then select pet_id into patient_id from public.patient_vaccine_due_plans where id=p_source_id;
 elsif p_source_kind='lab' then select pet_id into patient_id from public.patient_lab_orders where id=p_source_id;
 elsif p_source_kind='care_plan' then select pet_id into patient_id from public.patient_care_plans where id=p_source_id;
 else raise exception 'Unsupported reminder source' using errcode='23514';end if;
 select * into p from public.pets where id=patient_id and archived_at is null and deceased_at is null for share;if not found then raise exception 'Reminder requires an active patient' using errcode='23514';end if;
 if p_source_kind='vaccine' then
  select * into v from public.patient_vaccine_due_plans where id=p_source_id for share;
  if v.version is distinct from p_expected_source_version or v.status<>'current' or not v.reminders_enabled or exists(select 1 from public.patient_treatment_corrections where treatment_id=v.treatment_id) then raise exception 'Vaccine due source is not current or enabled' using errcode='PT409';end if;
  due=v.current_due_on;care_name=v.template_snapshot->>'name';snapshot=to_jsonb(v);
 elsif p_source_kind='care_plan' then
  select * into cp from public.patient_care_plans where id=p_source_id for share;
  if cp.id is null or cp.version is distinct from p_expected_source_version or not cp.reminders_enabled or not public.care_plan_source_is_current(cp.id) then raise exception 'Reviewed recurring care source is not current or enabled' using errcode='PT409';end if;
  due=cp.due_on;care_name=cp.name;snapshot=to_jsonb(cp);
 else
  select * into l from public.patient_lab_orders where id=p_source_id for share;
  if l.version is distinct from p_expected_source_version or l.status not in ('planned','ordered') or not l.reminders_enabled or l.due_date is null then raise exception 'Lab due source is not current or enabled' using errcode='PT409';end if;
  due=l.due_date;care_name=l.test_name;snapshot=to_jsonb(l);
 end if;
 select * into t from public.care_message_templates where id=p_message_template_id for share;
 if t.id is null or not t.active or t.version is distinct from p_expected_template_version then raise exception 'Message template changed or retired' using errcode='PT409';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,16));
 select * into r from public.care_reminder_jobs where id=p_id;
 if found then if row(r.source_kind,r.source_id,r.source_version,r.message_template_id,r.message_template_version) is distinct from row(p_source_kind,p_source_id,p_expected_source_version,p_message_template_id,p_expected_template_version) then raise exception 'Job ID reused with changed request' using errcode='42501';end if;return r;end if;
 -- A separate stable request ID for the same source/template version still returns the one canonical job.
 perform pg_advisory_xact_lock(hashtextextended(p_source_kind||p_source_id::text||p_expected_source_version::text||p_message_template_id::text||p_expected_template_version::text,17));
 select * into r from public.care_reminder_jobs where source_kind=p_source_kind and source_id=p_source_id and source_version=p_expected_source_version and message_template_id=p_message_template_id and message_template_version=p_expected_template_version;if found then return r;end if;
 body='';for part in select m[1] as token from regexp_matches(t.body,'(\{\{patient_name\}\}|\{\{care_name\}\}|\{\{due_date\}\}|[^{}]+)','g') m loop body=body||case part.token when '{{patient_name}}' then p.name when '{{care_name}}' then care_name when '{{due_date}}' then due::text else part.token end;end loop;
 insert into public.care_reminder_jobs(id,source_kind,source_id,source_version,pet_id,client_id,message_template_id,message_template_version,channel,scheduled_on,due_on,rendered_body,source_snapshot,template_snapshot) values(p_id,p_source_kind,p_source_id,p_expected_source_version,p.id,p.client_id,t.id,t.version,t.channel,due-t.days_before,due,body,snapshot,to_jsonb(t)) returning * into r;return r;
end $function$
;


-- Extend reminder_delivery_context; preserve the existing signature and grants.
CREATE OR REPLACE FUNCTION public.reminder_delivery_context(p_job_kind text, p_job_id uuid, p_policy_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare policy public.reminder_automation_policies;t public.care_message_templates;j public.care_reminder_jobs;ar public.appointment_reminders;a public.appointments;v public.patient_vaccine_due_plans;l public.patient_lab_orders;p public.pets;c public.clients;actor uuid;source jsonb;body text;care_name text;due date;part record;recipient text;cp public.patient_care_plans;w public.care_plan_delivery_windows;result jsonb;own_outbox uuid;
begin
 select * into policy from public.reminder_automation_policies where id=p_policy_id for share;
 if policy.id is null or not policy.enabled or not public.is_active_staff(policy.approved_by) then return null;end if;
 select * into t from public.care_message_templates where id=policy.message_template_id for share;
 if t.id is null or not t.active or t.version<>policy.message_template_version or upper(t.channel)<>policy.channel or not public.is_active_staff(t.updated_by) then return null;end if;
 if p_job_kind='care' then
  select * into j from public.care_reminder_jobs where id=p_job_id for update;
  if j.id is null or j.status<>'pending' or j.source_kind<>policy.source_kind or upper(j.channel)<>policy.channel or j.message_template_id<>t.id or j.message_template_version<>t.version or j.scheduled_on>(clock_timestamp() at time zone 'America/Denver')::date then return null;end if;
  if j.source_kind='vaccine' then select * into v from public.patient_vaccine_due_plans where id=j.source_id for share;
   if v.id is null or v.version<>j.source_version or v.status<>'current' or not v.reminders_enabled or v.pet_id<>j.pet_id or v.current_due_on<>j.due_on or exists(select 1 from public.patient_treatment_corrections where treatment_id=v.treatment_id) then return null;end if;
   source=to_jsonb(v);actor=v.updated_by;
  elsif j.source_kind='care_plan' then
   select * into cp from public.patient_care_plans where id=j.source_id for share;
   if cp.id is null or cp.version<>j.source_version or not cp.reminders_enabled or cp.pet_id<>j.pet_id or cp.due_on<>j.due_on or not public.care_plan_source_is_current(cp.id) then return null;end if;
   select outbox_id into own_outbox from public.reminder_outbox_links where job_kind='care' and job_id=j.id;
   if public.care_occurrence_has_handoff(cp.occurrence_id,own_outbox) then return null;end if;
   source=to_jsonb(cp);actor=cp.updated_by;
  else select * into l from public.patient_lab_orders where id=j.source_id for share;
   if l.id is null or l.version<>j.source_version or l.status not in ('planned','ordered') or not l.reminders_enabled or l.pet_id<>j.pet_id or l.due_date is distinct from j.due_on then return null;end if;
   source=to_jsonb(l);actor=l.updated_by;
  end if;
  if source is distinct from j.source_snapshot or actor is distinct from (j.source_snapshot->>'updated_by')::uuid then return null;end if;
  select * into p from public.pets where id=j.pet_id for share;
  if p.client_id is distinct from j.client_id then return null;end if;body=j.rendered_body;due=j.due_on;
 elsif p_job_kind='appointment' then
  select * into ar from public.appointment_reminders where id=p_job_id for update;
  if ar.id is null or ar.status<>'PENDING' or ar.remind_at>clock_timestamp() or ar.channel<>policy.channel or policy.source_kind<>'appointment' then return null;end if;
  select * into a from public.appointments where id=ar.appointment_id for share;
  if a.id is null or a.version<>ar.appointment_version or a.status not in ('SCHEDULED','CONFIRMED') or a.scheduled_at<=clock_timestamp() or a.pet_id is null then return null;end if;
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
 if policy.source_kind='care_plan' then
  select * into w from public.care_plan_delivery_windows where policy_id=policy.id for share;
  if w.policy_id is null or public.appointment_reminder_channel(c.id) is distinct from policy.channel then return null;end if;
 end if;
 result:=jsonb_build_object('job_kind',p_job_kind,'job_id',p_job_id,'policy',to_jsonb(policy),'template',to_jsonb(t),'source',source,'actor_id',actor,'pet_id',p.id,'patient_name',p.name,'client_id',c.id,'recipient',recipient,'channel',policy.channel,'subject',policy.subject,'body',body,'due_on',due);
 if policy.source_kind='care_plan' then result:=result||jsonb_build_object('send_window',to_jsonb(w));end if;
 return result;
end $function$
;


-- Extend reminder_scheduler_candidates_internal; preserve the existing signature and grants.
CREATE OR REPLACE FUNCTION public.reminder_scheduler_candidates_internal()
 RETURNS TABLE(job_kind text, job_id uuid, policy_id uuid, source_id uuid, source_kind text, source_version integer, template_id uuid, template_version integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  union all
  select 'care',j.id,policy.id,cp.id,'care_plan',cp.version,t.id,t.version
  from public.reminder_automation_policies policy join public.care_plan_delivery_windows w on w.policy_id=policy.id
  join public.care_message_templates t on t.id=policy.message_template_id and t.version=policy.message_template_version and t.active
  join public.patient_care_plans cp on policy.source_kind='care_plan' and cp.status='current' and cp.reminders_enabled
   and cp.due_on<=(clock_timestamp() at time zone 'America/Denver')::date+t.days_before
  join public.pets patient on patient.id=cp.pet_id and patient.archived_at is null and patient.deceased_at is null
  join public.clients client on client.id=patient.client_id and public.appointment_reminder_channel(client.id)=policy.channel
  left join public.care_reminder_jobs j on j.source_kind='care_plan' and j.source_id=cp.id and j.source_version=cp.version and j.message_template_id=t.id and j.message_template_version=t.version
  where policy.enabled and public.care_plan_source_is_current(cp.id) and (j.id is null or j.status='pending')
   and not public.care_occurrence_has_handoff(cp.occurrence_id)
   and public.care_window_next_open(w.start_minute,w.end_minute,statement_timestamp())<=statement_timestamp()
   and not exists(select 1 from public.reminder_outbox_links h where h.job_kind='care' and h.job_id=j.id)
 ) x order by x.job_kind,x.source_kind,x.source_id
$function$
;


-- Extend operations_candidate_projection_internal; preserve the existing signature and grants.
CREATE OR REPLACE FUNCTION public.operations_candidate_projection_internal()
 RETURNS TABLE(cursor_key text, job_kind text, job_id uuid, policy_id uuid, source_id uuid, source_kind text, source_version integer, template_id uuid, template_version integer, pet_id uuid, channel text, eligible_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 select c.job_kind||':'||c.source_kind||':'||c.source_id::text||':'||c.policy_id::text||':'||coalesce(c.job_id::text,'00000000-0000-0000-0000-000000000000'),c.job_kind,c.job_id,c.policy_id,c.source_id,c.source_kind,c.source_version,c.template_id,c.template_version,
 coalesce(v.pet_id,l.pet_id,a.pet_id,cp.pet_id),p.channel,
 case when c.source_kind='appointment' then ar.remind_at else ((case when c.source_kind='vaccine' then v.current_due_on when c.source_kind='care_plan' then cp.due_on else l.due_date end)-t.days_before)::timestamp at time zone 'America/Denver' end
 from public.reminder_scheduler_candidates_internal() c join public.reminder_automation_policies p on p.id=c.policy_id join public.care_message_templates t on t.id=c.template_id
 left join public.patient_vaccine_due_plans v on c.source_kind='vaccine' and v.id=c.source_id
 left join public.patient_lab_orders l on c.source_kind='lab' and l.id=c.source_id
 left join public.patient_care_plans cp on c.source_kind='care_plan' and cp.id=c.source_id
 left join public.appointments a on c.source_kind='appointment' and a.id=c.source_id
 left join public.appointment_reminders ar on c.job_kind='appointment' and ar.id=c.job_id
$function$
;


-- Extend save_reminder_automation_policy; preserve the existing signature and grants.
CREATE OR REPLACE FUNCTION public.save_reminder_automation_policy(p_id uuid, p_expected_version integer, p_source_kind text, p_channel text, p_message_template_id uuid, p_message_template_version integer, p_subject text, p_enabled boolean, p_review_note text)
 RETURNS reminder_automation_policies
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid;r public.reminder_automation_policies;t public.care_message_templates;
begin if p_source_kind='care_plan' then raise exception 'Use reviewed recurring care delivery policy with its send window' using errcode='23514';end if;actor=public.care_require_admin();if p_id is null then raise exception 'Stable policy ID required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,18));select * into r from public.reminder_automation_policies where id=p_id for update;
 if found then
  if r.approved_by=actor and r.version=coalesce(p_expected_version,0)+1 and row(r.source_kind,r.channel,r.message_template_id,r.message_template_version,r.subject,r.enabled,r.review_note) is not distinct from row(p_source_kind,p_channel,p_message_template_id,p_message_template_version,coalesce(p_subject,''),p_enabled,trim(p_review_note)) then return r;end if;
  if r.version is distinct from p_expected_version then raise exception 'Automation policy version conflict' using errcode='PT409';end if;
  if row(r.source_kind,r.channel) is distinct from row(p_source_kind,p_channel) then raise exception 'Policy source and channel are immutable' using errcode='23514';end if;
 elsif p_expected_version is not null then raise exception 'Automation policy version conflict' using errcode='PT409';end if;
 select * into t from public.care_message_templates where id=p_message_template_id for share;
 if t.id is null or not t.active or t.version is distinct from p_message_template_version or upper(t.channel) is distinct from p_channel then raise exception 'Select current reviewed wording for the policy channel' using errcode='23514';end if;
 if r.id is null then insert into public.reminder_automation_policies(id,source_kind,channel,message_template_id,message_template_version,subject,enabled,review_note,approved_by) values(p_id,p_source_kind,p_channel,t.id,t.version,coalesce(p_subject,''),p_enabled,trim(p_review_note),actor) returning * into r;
 else update public.reminder_automation_policies set message_template_id=t.id,message_template_version=t.version,subject=coalesce(p_subject,''),enabled=p_enabled,review_note=trim(p_review_note),version=version+1,approved_by=actor,approved_at=now() where id=p_id returning * into r;end if;
 insert into public.reminder_automation_policy_history(policy_id,version,snapshot) values(r.id,r.version,to_jsonb(r));return r;
end $function$
;


-- Extend claim_communication; preserve the existing signature and grants.
CREATE OR REPLACE FUNCTION public.claim_communication()
 RETURNS communication_outbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result public.communication_outbox;
begin
 perform public.communication_require_service();
 -- A dead worker with an in-flight request is ambiguous, including after provider acceptance.
 update public.communication_attempts a set outcome='uncertain',finished_at=now(),error_code='worker_lease_expired'
 from public.communication_outbox o where o.state='claimed' and o.lease_expires_at<now() and o.attempt_started_at is not null and a.lease_token=o.lease_token and a.finished_at is null;
 update public.communication_outbox set state=case when attempt_started_at is null then 'pending' else 'uncertain' end,last_error='worker_lease_expired',lease_token=null,lease_expires_at=null,updated_at=now() where state='claimed' and lease_expires_at<now();
 select * into result from public.communication_outbox where state='pending' and not exists(select 1 from public.care_delivery_deferrals d where d.outbox_id=communication_outbox.id and d.eligible_at>clock_timestamp()) order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.communication_outbox set state='claimed',lease_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes',attempt_started_at=null,updated_at=now() where id=result.id returning * into result;
 return result;
end $function$
;


-- Extend start_communication_attempt_without_reminder_guard; preserve the existing signature and grants.
CREATE OR REPLACE FUNCTION public.start_communication_attempt_without_reminder_guard(p_id uuid, p_lease_token uuid, p_provider_config jsonb)
 RETURNS communication_outbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result public.communication_outbox;deferred public.communication_outbox;
begin
 perform public.communication_require_service();
 select * into result from public.communication_outbox where id=p_id for update;
 if not found or result.state<>'claimed' or result.lease_token is distinct from p_lease_token or result.lease_expires_at<=clock_timestamp() or result.attempt_started_at is not null then raise exception 'Outbox lease is unavailable' using errcode='PT409'; end if;
 -- Re-check immediately before the external request, including actor revocation and contact changes.
 if not public.is_active_staff(result.created_by) or public.communication_is_suppressed(result.channel,result.recipient,result.client_id)
 or not exists(select 1 from public.clients c where c.id=result.client_id and public.communication_recipient(result.channel,case when result.channel='EMAIL' then c.primary_email else c.primary_phone end)=result.recipient) then
  update public.communication_outbox set state='failed',last_error='recipient_or_actor_ineligible',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=p_id returning * into result;
  return result;
 end if;
 if result.channel='SMS' and result.provider is distinct from public.communication_sms_provider() then
  update public.communication_outbox set state='failed',last_error='sms_provider_mismatch',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=p_id returning * into result;
  return result;
 end if;
 if p_provider_config is null or jsonb_typeof(p_provider_config)<>'object' or (result.provider='resend' and (not(p_provider_config ?& array['from','reply_to']) or p_provider_config-array['from','reply_to']<>'{}'::jsonb)) or (result.provider='twilio' and (not(p_provider_config ?& array['from','account_sid']) or p_provider_config-array['from','account_sid']<>'{}'::jsonb))
 or (result.provider='cloudtalk' and (not(p_provider_config ?& array['from','provider']) or p_provider_config-array['from','provider']<>'{}'::jsonb or p_provider_config->>'provider'<>'cloudtalk' or jsonb_typeof(p_provider_config->'from')<>'string' or public.communication_recipient('SMS',p_provider_config->>'from') is distinct from p_provider_config->>'from')) then raise exception 'Invalid provider metadata' using errcode='23514'; end if;
 if result.provider_config is not null and result.provider_config<>p_provider_config then raise exception 'Provider sender metadata changed; reconcile before sending' using errcode='23514'; end if;
 if result.first_attempt_at is not null and result.provider='resend' and result.first_attempt_at<=clock_timestamp()-interval '23 hours' then
  update public.communication_outbox set state='uncertain',last_error='idempotency_window_expired',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=p_id returning * into result; return result;
 end if;
 deferred:=public.care_defer_attempt(p_id,p_lease_token);if deferred.id is not null then return deferred;end if;
 update public.communication_outbox set provider_config=coalesce(provider_config,p_provider_config),first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),attempt_started_at=clock_timestamp(),attempt_count=attempt_count+1,updated_at=clock_timestamp() where id=p_id returning * into result;
 insert into public.communication_attempts(outbox_id,lease_token,attempt_number) values(result.id,p_lease_token,result.attempt_count);
 return result;
end $function$
;


-- Extend daily_communication_rows_internal; preserve the existing signature and grants.
CREATE OR REPLACE FUNCTION public.daily_communication_rows_internal()
 RETURNS TABLE(source text, id uuid, activity_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone, channel text, status text, summary text, client_id uuid, client_name text, pet_id uuid, patient_name text, conversation_id uuid, recipient text, attempt_count integer, accepted_at timestamp with time zone, delivered_at timestamp with time zone, reason text, source_href text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 with canonical as (
  select 'outbox'::text source,o.id,coalesce(last_attempt.started_at,o.first_attempt_at,o.created_at) activity_at,
   o.created_at,o.updated_at,o.channel,
   case when (rl.invalidated_at is not null or cj.status='invalidated' or ar.status='SKIPPED') and o.attempt_started_at is null and o.state in ('pending','claimed') then 'suppressed'
    when o.state='pending' and deferred.eligible_at>statement_timestamp() then 'scheduled'
    when o.state='failed' and o.first_attempt_at is null and (rl.invalidated_at is not null or o.last_error='recipient_or_actor_ineligible') then 'suppressed'
    when o.state='pending' then 'queued' when o.state='claimed' then 'processing' else o.state end status,
   case when rl.job_kind='appointment' then 'Appointment reminder'
    when rl.job_kind='care' and cj.source_kind='vaccine' then 'Vaccine reminder'
    when rl.job_kind='care' and cj.source_kind='care_plan' then case cj.source_snapshot->>'care_kind' when 'wellness' then 'Wellness reminder' when 'bloodwork' then 'Bloodwork reminder' when 'vaccine' then 'Vaccine reminder' else 'Custom care reminder' end
    when rl.job_kind='care' then 'Lab reminder'
    when dl.outbox_id is not null then 'Protected document link'
    when pay.outbox_id is not null then 'Invoice payment link'
    when rel.outbox_id is not null then 'Records email'
    when inv.outbox_id is not null then 'Invoice email' else 'Staff message' end summary,
   o.client_id,c.full_name client_name,coalesce(cj.pet_id,ap.pet_id,release.pet_id,linked_release.pet_id) pet_id,
   p.name patient_name,o.conversation_id,o.recipient,o.attempt_count,o.accepted_at,o.delivered_at,
   case when (rl.invalidated_at is not null or cj.status='invalidated' or ar.status='SKIPPED') and o.attempt_started_at is null and o.state in ('pending','claimed') then 'Eligibility change stopped this routine send'
    when o.state='pending' and deferred.eligible_at>statement_timestamp() then 'Deferred until '||to_char(deferred.eligible_at at time zone 'America/Denver','YYYY-MM-DD HH24:MI')||' (Denver)'
    when o.state='failed' and o.first_attempt_at is null and (rl.invalidated_at is not null or o.last_error='recipient_or_actor_ineligible') then 'Eligibility check blocked this send'
    when o.state='uncertain' then 'Delivery is unconfirmed; do not resend without reconciliation'
    when o.state='failed' then 'Recorded failure; review the source before retrying' else null end reason,
   '/hub/conversation/'||o.conversation_id::text source_href
  from public.communication_outbox o join public.clients c on c.id=o.client_id
  left join lateral(select a.started_at from public.communication_attempts a where a.outbox_id=o.id order by a.attempt_number desc limit 1) last_attempt on true
  left join public.care_delivery_deferrals deferred on deferred.outbox_id=o.id
  left join public.reminder_outbox_links rl on rl.outbox_id=o.id
  left join public.care_reminder_jobs cj on rl.job_kind='care' and cj.id=rl.job_id
  left join public.appointment_reminders ar on rl.job_kind='appointment' and ar.id=rl.job_id
  left join public.appointments ap on ap.id=ar.appointment_id
  left join public.document_link_outbox_links dl on dl.outbox_id=o.id
  left join public.document_link_grants dg on dg.id=dl.grant_id
  left join public.record_releases linked_release on dg.family='record_release' and linked_release.id=dg.source_id and linked_release.client_id=o.client_id
  left join public.payment_delivery_outbox_links pay on pay.outbox_id=o.id
  left join public.release_email_outbox_links rel on rel.outbox_id=o.id
  left join public.release_email_requests rr on rr.id=rel.request_id
  left join public.record_releases release on release.id=rr.release_id
  left join public.invoice_email_outbox_links inv on inv.outbox_id=o.id
  left join public.pets p on p.id=coalesce(cj.pet_id,ap.pet_id,release.pet_id,linked_release.pet_id)
 ), retained as (
  select 'legacy'::text,d.id,coalesce(d.leased_at,d.scheduled_at,d.created_at),d.created_at,d.updated_at,d.channel::text,
   case d.status when 'QUEUED' then case when d.scheduled_at>statement_timestamp() then 'scheduled' else 'queued' end
    when 'LEASED' then 'processing' when 'ACCEPTED' then 'accepted' when 'DELIVERED' then 'delivered'
    when 'FAILED' then 'failed' when 'CANCELED' then 'cancelled' else 'uncertain' end,
   case when d.appointment_reminder_id is not null then 'Retained appointment reminder' else 'Retained staff delivery' end,
   d.client_id,c.full_name,a.pet_id,p.name,coalesce(d.conversation_id,m.conversation_id),d.recipient,d.attempt_count,d.accepted_at,d.delivered_at,
   case when d.status='UNKNOWN' then 'Delivery is unconfirmed; do not resend without reconciliation'
    when d.status='FAILED' then 'Recorded failure; review the source before retrying'
    when coalesce(d.conversation_id,m.conversation_id) is null and ar.id is null then 'No linked source remains; review the retained delivery metadata' else null end,
   case when coalesce(d.conversation_id,m.conversation_id) is not null then '/hub/conversation/'||coalesce(d.conversation_id,m.conversation_id)::text when ar.id is not null then '/hub/schedule' else null end
  from public.outbound_deliveries d left join public.clients c on c.id=d.client_id
  left join public.messages m on m.id=d.message_id
  left join public.appointment_reminders ar on ar.id=d.appointment_reminder_id
  left join public.appointments a on a.id=ar.appointment_id left join public.pets p on p.id=a.pet_id
  where not exists(select 1 from public.communication_outbox o where (o.message_id=d.message_id and o.channel=d.channel::text)
   or (o.provider=d.provider and o.provider_message_id=d.provider_message_id and o.channel=d.channel::text))
   and not exists(select 1 from public.reminder_outbox_links r where r.job_kind='appointment' and r.job_id=d.appointment_reminder_id and r.outbox_id is not null)
 ), care as (
  select 'care'::text,j.id,j.scheduled_on::timestamp at time zone 'America/Denver',j.created_at,
   coalesce(j.invalidated_at,j.created_at),upper(j.channel),
   case when j.status='invalidated' or r.state='blocked' then 'suppressed' else 'scheduled' end,
   case when j.source_kind='vaccine' then 'Vaccine reminder' when j.source_kind='care_plan' then case j.source_snapshot->>'care_kind' when 'wellness' then 'Wellness reminder' when 'bloodwork' then 'Bloodwork reminder' when 'vaccine' then 'Vaccine reminder' else 'Custom care reminder' end else 'Lab reminder' end,
   j.client_id,c.full_name,j.pet_id,p.name,null::uuid,
   case when upper(j.channel)='EMAIL' then c.primary_email else c.primary_phone end,0,null::timestamptz,null::timestamptz,
   case when j.status='invalidated' or r.state='blocked' then 'Reminder blocked or invalidated; review the care plan'
    else 'Scheduled reminder job; delivery depends on current automation policy and final eligibility' end,
   '/hub/tools/care-reminders'
  from public.care_reminder_jobs j join public.clients c on c.id=j.client_id join public.pets p on p.id=j.pet_id
  left join public.reminder_outbox_links r on r.job_kind='care' and r.job_id=j.id
  where r.outbox_id is null
 ), appointments as (
  select 'appointment'::text,r.id,r.remind_at,r.created_at,r.updated_at,r.channel,
   case when link.state='blocked' or r.status='SKIPPED' then 'suppressed'
    when r.status='FAILED' then 'failed' when r.status='SENT' then 'uncertain'
    when r.status='QUEUED' then 'queued' else 'scheduled' end,
   'Appointment reminder',a.client_id,c.full_name,a.pet_id,p.name,null::uuid,
   case when r.channel='EMAIL' then c.primary_email else c.primary_phone end,0,null::timestamptz,null::timestamptz,
   case when link.state='blocked' or r.status='SKIPPED' then 'Reminder blocked or skipped; review the appointment'
    when r.status='SENT' then 'Historical sent status has no linked delivery evidence'
    else 'Reminder job; delivery depends on current automation policy and final eligibility' end,
   '/hub/schedule'
  from public.appointment_reminders r join public.appointments a on a.id=r.appointment_id
  join public.clients c on c.id=a.client_id left join public.pets p on p.id=a.pet_id
  left join public.reminder_outbox_links link on link.job_kind='appointment' and link.job_id=r.id
  where link.outbox_id is null and not exists(select 1 from public.outbound_deliveries d where d.appointment_reminder_id=r.id or d.id=r.outbound_delivery_id)
 ) select * from canonical union all select * from retained union all select * from care union all select * from appointments
$function$
;

-- This statement guard precedes row locks even for direct privileged SQL updates.
-- Downstream job/link/outbox tables deliberately do not acquire this semaphore in triggers.
do $$declare t text;begin
 foreach t in array array['pets','appointments','patient_vaccine_due_plans','patient_lab_orders','care_message_templates',
  'reminder_automation_policies','patient_treatment_corrections','patient_service_corrections',
  'recurring_care_templates','patient_care_plans','care_plan_delivery_windows'] loop
  execute format('create trigger aaa_care_eligibility_before_write before insert or update or delete on public.%I for each statement execute function public.care_eligibility_statement_guard()',t);
 end loop;
end $$;

-- Acquire eligibility serialization at the OUTER entry point, before any pre-existing
-- action/advisory/patient/source/outbox locks. Preserve signatures, owners, ACLs and PT409.
-- Discover mutation participants and their PL/pgSQL callers transitively so retained
-- clinical/import wrappers cannot introduce a row-lock -> eligibility-lock inversion.
-- Extend the existing Patient 360 signals without changing its version-1 contract.
alter function public.patient_360_signals_internal(uuid,uuid) rename to patient_360_signals_before_care_plans;
create function public.patient_360_signals_internal(p_client_id uuid,p_pet_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;today date:=(now() at time zone 'America/Denver')::date;
begin
 result:=public.patient_360_signals_before_care_plans(p_client_id,p_pet_id);
 return result||jsonb_build_object(
  'care_plans_overdue',coalesce((select jsonb_agg(jsonb_build_object('pet_id',pet.id,'pet_name',pet.name,'id',plan.id,'name',plan.name,'due_on',plan.due_on) order by plan.due_on,plan.id)
    from public.patient_care_plans plan join public.pets pet on pet.id=plan.pet_id
    where pet.client_id=p_client_id and (p_pet_id is null or pet.id=p_pet_id) and pet.archived_at is null and pet.deceased_at is null
      and plan.status='current' and plan.due_on<today),'[]'::jsonb),
  'care_plans_awaiting_review',coalesce((select jsonb_agg(jsonb_build_object('pet_id',pet.id,'pet_name',pet.name,'id',plan.id,'name',plan.name,'due_on',plan.due_on) order by plan.due_on,plan.id)
    from public.patient_care_plans plan join public.pets pet on pet.id=plan.pet_id
    where pet.client_id=p_client_id and (p_pet_id is null or pet.id=p_pet_id) and pet.archived_at is null and pet.deceased_at is null
      and plan.status='proposed'),'[]'::jsonb));
end $$;
revoke all on function public.patient_360_signals_internal(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.patient_360_signals_before_care_plans(uuid,uuid) from public,anon,authenticated,service_role;

do $guard$
declare ids oid[];prior_count integer;p record;body text;definition text;passes integer:=0;
begin
 select coalesce(array_agg(f.oid),'{}'::oid[]) into ids from pg_proc f join pg_language l on l.oid=f.prolang
 where f.pronamespace='public'::regnamespace and l.lanname='plpgsql'
 and (f.proname ~ '^start_communication_attempt' or f.proname=any(array[
  'enqueue_care_reminder','queue_reminder_outbox','queue_due_reminders','preview_outbox_retry',
  'requeue_outbox_retry','outbox_retry_preview_internal','reminder_delivery_context'])
 or f.prosrc ~* '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+(public\.)?(pets|appointments|patient_vaccine_due_plans|patient_lab_orders|care_message_templates|reminder_automation_policies|patient_treatment_corrections|patient_service_corrections)\M');
 loop
  prior_count:=cardinality(ids);
  select coalesce(array_agg(f.oid),'{}'::oid[]) into ids from pg_proc f join pg_language l on l.oid=f.prolang
  where f.pronamespace='public'::regnamespace and l.lanname='plpgsql'
  and (f.oid=any(ids) or exists(select 1 from pg_proc guarded where guarded.oid=any(ids)
   and f.prosrc ~* ('\m'||guarded.proname||'[[:space:]]*\(')));
  passes:=passes+1;
  exit when cardinality(ids)=prior_count;
  if passes>30 then raise exception 'Eligibility entry-point discovery did not converge';end if;
 end loop;
 for p in select oid,proname,prosrc from pg_proc where oid=any(ids) order by oid loop
  body:=p.prosrc;
  if position('public.care_eligibility_lock()' in body)=0 then
   if body ~* '(?m)^[[:space:]]*declare\M' then
    body:=regexp_replace(body,'(?im)^([[:space:]]*declare)\M','\1 _lrv_care_gate boolean:=public.care_eligibility_lock();',1,1);
   elsif body ~* '(?m)^[[:space:]]*begin\M' then
    body:=regexp_replace(body,'(?im)^([[:space:]]*begin)\M','\1 perform public.care_eligibility_lock();',1,1);
   else raise exception 'Cannot safely guard eligibility entry point %',p.oid::regprocedure;end if;
  end if;
  if p.proname ~ '^start_communication_attempt' then body:=replace(body,'now()','clock_timestamp()');end if;
  definition:=replace(pg_get_functiondef(p.oid),p.prosrc,body);
  execute definition;
 end loop;
end $guard$;
