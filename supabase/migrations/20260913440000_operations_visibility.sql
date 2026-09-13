-- Local operational evidence only. No provider requests, cron activation or recovery mutations.
create function public.operations_require_admin() returns uuid language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();begin if not public.has_role(actor,'ADMIN') then raise exception 'Active administrator required' using errcode='42501';end if;return actor;end $$;
revoke all on function public.operations_require_admin() from public,anon,authenticated,service_role;
create function public.reminder_scheduler_candidates_internal() returns table(job_kind text,job_id uuid,policy_id uuid,source_id uuid,source_kind text,source_version integer,template_id uuid,template_version integer) language sql stable security definer set search_path=public as $$
select x.* from (
  select 'care'::text job_kind,j.id job_id,p.id policy_id,v.id source_id,'vaccine'::text source_kind,v.version source_version,t.id template_id,t.version template_version
  from public.reminder_automation_policies p join public.care_message_templates t on t.id=p.message_template_id and t.version=p.message_template_version and t.active
  join public.patient_vaccine_due_plans v on p.source_kind='vaccine' and v.status='current' and v.reminders_enabled and v.current_due_on<=(now() at time zone 'America/Denver')::date+t.days_before
  left join public.care_reminder_jobs j on j.source_kind='vaccine' and j.source_id=v.id and j.source_version=v.version and j.message_template_id=t.id and j.message_template_version=t.version
  where p.enabled and exists(select 1 from public.pets patient where patient.id=v.pet_id and patient.archived_at is null and patient.deceased_at is null) and (j.id is null or j.status='pending') and not exists(select 1 from public.reminder_outbox_links h where h.job_kind='care' and h.job_id=j.id)
  union all
  select 'care',j.id,p.id,l.id,'lab',l.version,t.id,t.version
  from public.reminder_automation_policies p join public.care_message_templates t on t.id=p.message_template_id and t.version=p.message_template_version and t.active
  join public.patient_lab_orders l on p.source_kind='lab' and l.status in ('planned','ordered') and l.due_date<=(now() at time zone 'America/Denver')::date+t.days_before
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
revoke all on function public.reminder_scheduler_candidates_internal() from public,anon,authenticated,service_role;
-- Extract only the canonical query; leave per-source validation and handoff transactions intact.
do $$declare definition text;expected text:=$candidate$ select x.* from (
  select 'care'::text job_kind,j.id job_id,p.id policy_id,v.id source_id,'vaccine'::text source_kind,v.version source_version,t.id template_id,t.version template_version
  from public.reminder_automation_policies p join public.care_message_templates t on t.id=p.message_template_id and t.version=p.message_template_version and t.active
  join public.patient_vaccine_due_plans v on p.source_kind='vaccine' and v.status='current' and v.reminders_enabled and v.current_due_on<=(now() at time zone 'America/Denver')::date+t.days_before
  left join public.care_reminder_jobs j on j.source_kind='vaccine' and j.source_id=v.id and j.source_version=v.version and j.message_template_id=t.id and j.message_template_version=t.version
  where p.enabled and exists(select 1 from public.pets patient where patient.id=v.pet_id and patient.archived_at is null and patient.deceased_at is null) and (j.id is null or j.status='pending') and not exists(select 1 from public.reminder_outbox_links h where h.job_kind='care' and h.job_id=j.id)
  union all
  select 'care',j.id,p.id,l.id,'lab',l.version,t.id,t.version
  from public.reminder_automation_policies p join public.care_message_templates t on t.id=p.message_template_id and t.version=p.message_template_version and t.active
  join public.patient_lab_orders l on p.source_kind='lab' and l.status in ('planned','ordered') and l.due_date<=(now() at time zone 'America/Denver')::date+t.days_before
  left join public.care_reminder_jobs j on j.source_kind='lab' and j.source_id=l.id and j.source_version=l.version and j.message_template_id=t.id and j.message_template_version=t.version
  where p.enabled and exists(select 1 from public.pets patient where patient.id=l.pet_id and patient.archived_at is null and patient.deceased_at is null) and (j.id is null or j.status='pending') and not exists(select 1 from public.reminder_outbox_links h where h.job_kind='care' and h.job_id=j.id)
  union all
  select 'appointment',ar.id,p.id,a.id,'appointment',a.version,t.id,t.version
  from public.reminder_automation_policies p join public.care_message_templates t on t.id=p.message_template_id and t.version=p.message_template_version and t.active
  join public.appointment_reminders ar on p.source_kind='appointment' and ar.channel=p.channel and ar.status='PENDING' and ar.remind_at<=now()
  join public.appointments a on a.id=ar.appointment_id and a.version=ar.appointment_version and a.status in ('SCHEDULED','CONFIRMED') and a.scheduled_at>now()
  where p.enabled and not exists(select 1 from public.reminder_outbox_links h where h.job_kind='appointment' and h.job_id=ar.id)
 ) x order by x.job_kind,x.source_kind,x.source_id limit p_limit
$candidate$;begin
 definition:=pg_get_functiondef('public.queue_due_reminders(integer)'::regprocedure);
 if position(expected in definition)=0 then raise exception 'Canonical reminder candidate query changed; review extraction';end if;
 execute replace(definition,expected,' select * from public.reminder_scheduler_candidates_internal() order by job_kind,source_kind,source_id limit p_limit'||E'\n');
end $$;
create table public.reminder_scheduler_runs (
 run_id uuid primary key,requested_limit integer not null check(requested_limit between 1 and 100),started_at timestamptz not null default clock_timestamp()
);
create table public.reminder_scheduler_results (
 run_id uuid primary key references public.reminder_scheduler_runs(run_id),outcome text not null check(outcome in ('completed','failed')),
 queued integer,blocked integer,skipped integer,failure_code text,finished_at timestamptz not null default clock_timestamp(),
 check((outcome='completed' and queued is not null and blocked is not null and skipped is not null and queued>=0 and blocked>=0 and skipped>=0 and failure_code is null) or(outcome='failed' and queued is null and blocked is null and skipped is null and failure_code is not null and failure_code='queue_transaction_rolled_back'))
);
create function public.operations_run_immutable() returns trigger language plpgsql set search_path=public as $$begin raise exception 'Scheduler run evidence is append-only' using errcode='23514';end $$;
revoke all on function public.operations_run_immutable() from public,anon,authenticated,service_role;
do $$declare t text;begin foreach t in array array['reminder_scheduler_runs','reminder_scheduler_results'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger immutable_scheduler_evidence before update or delete on public.%I for each row execute function public.operations_run_immutable()',t);
end loop;end $$;
create index reminder_scheduler_runs_cursor on public.reminder_scheduler_runs(started_at desc,run_id desc);
create index operations_outbox_cursor on public.communication_outbox(created_at desc,id desc) where state in ('pending','claimed','uncertain','failed','accepted');
create index operations_stripe_receipt_cursor on public.stripe_event_receipts(created_at desc,id desc);
create index operations_reminder_block_cursor on public.reminder_outbox_links(created_at desc,job_kind desc,job_id desc) where state='blocked' or invalidated_at is not null;
create function public.scheduler_run_projection_internal(p_run_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('run_id',r.run_id,'requested_limit',r.requested_limit,'started_at',r.started_at,'outcome',coalesce(t.outcome,'started'),'finished_at',t.finished_at,'counts',case when t.outcome='completed' then jsonb_build_object('queued',t.queued,'blocked',t.blocked,'skipped',t.skipped,'dispatched',false) else null end,'failure_code',t.failure_code)
 from public.reminder_scheduler_runs r left join public.reminder_scheduler_results t using(run_id) where r.run_id=p_run_id
$$;
revoke all on function public.scheduler_run_projection_internal(uuid) from public,anon,authenticated,service_role;
create function public.start_reminder_scheduler_run(p_run_id uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.reminder_scheduler_runs;
begin perform public.communication_require_service();
 if p_run_id is null or p_limit is null or p_limit not between 1 and 100 then raise exception 'Stable run UUID and bounded limit required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_run_id::text,4400));
 select * into r from public.reminder_scheduler_runs where run_id=p_run_id;
 if found then if r.requested_limit<>p_limit then raise exception 'Run UUID already bound to another limit' using errcode='23505';end if;return public.scheduler_run_projection_internal(r.run_id);end if;
 insert into public.reminder_scheduler_runs(run_id,requested_limit) values(p_run_id,p_limit);return public.scheduler_run_projection_internal(p_run_id);
end $$;
create function public.recover_reminder_scheduler_run(p_run_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin perform public.communication_require_service();return public.scheduler_run_projection_internal(p_run_id);end $$;
create function public.execute_reminder_scheduler_run(p_run_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.reminder_scheduler_runs;counts jsonb;q integer;b integer;s integer;
begin perform public.communication_require_service();
 select * into r from public.reminder_scheduler_runs where run_id=p_run_id for update;
 if not found then raise exception 'Confirmed scheduler start required' using errcode='42501';end if;
 if exists(select 1 from public.reminder_scheduler_results where run_id=r.run_id) then return public.scheduler_run_projection_internal(r.run_id);end if;
 -- If queueing or validation raises, this subtransaction rolls back every queue write.
 begin
  counts:=public.queue_due_reminders(r.requested_limit);
  if counts is null or jsonb_typeof(counts)<>'object' or (counts->>'queued')!~'^[0-9]+$' or (counts->>'blocked')!~'^[0-9]+$' or (counts->>'skipped')!~'^[0-9]+$' or counts->'dispatched' is distinct from 'false'::jsonb then raise exception 'Invalid canonical queue result';end if;
  q:=(counts->>'queued')::integer;b:=(counts->>'blocked')::integer;s:=(counts->>'skipped')::integer;
  if q is null or b is null or s is null or q+b+s>r.requested_limit then raise exception 'Canonical queue result exceeds requested bound';end if;
  insert into public.reminder_scheduler_results(run_id,outcome,queued,blocked,skipped) values(r.run_id,'completed',q,b,s);
 exception when others then
  insert into public.reminder_scheduler_results(run_id,outcome,failure_code) values(r.run_id,'failed','queue_transaction_rolled_back');
 end;
 return public.scheduler_run_projection_internal(r.run_id);
end $$;
revoke all on function public.start_reminder_scheduler_run(uuid,integer),public.recover_reminder_scheduler_run(uuid),public.execute_reminder_scheduler_run(uuid) from public,anon,authenticated,service_role;
grant execute on function public.start_reminder_scheduler_run(uuid,integer),public.recover_reminder_scheduler_run(uuid),public.execute_reminder_scheduler_run(uuid) to service_role;
create function public.operations_candidate_projection_internal() returns table(cursor_key text,job_kind text,job_id uuid,policy_id uuid,source_id uuid,source_kind text,source_version integer,template_id uuid,template_version integer,pet_id uuid,channel text,eligible_at timestamptz) language sql stable security definer set search_path=public as $$
 select c.job_kind||':'||c.source_kind||':'||c.source_id::text||':'||c.policy_id::text||':'||coalesce(c.job_id::text,'00000000-0000-0000-0000-000000000000'),c.job_kind,c.job_id,c.policy_id,c.source_id,c.source_kind,c.source_version,c.template_id,c.template_version,
 coalesce(v.pet_id,l.pet_id,a.pet_id),p.channel,
 case when c.source_kind='appointment' then ar.remind_at else ((case when c.source_kind='vaccine' then v.current_due_on else l.due_date end)-t.days_before)::timestamp at time zone 'America/Denver' end
 from public.reminder_scheduler_candidates_internal() c join public.reminder_automation_policies p on p.id=c.policy_id join public.care_message_templates t on t.id=c.template_id
 left join public.patient_vaccine_due_plans v on c.source_kind='vaccine' and v.id=c.source_id
 left join public.patient_lab_orders l on c.source_kind='lab' and l.id=c.source_id
 left join public.appointments a on c.source_kind='appointment' and a.id=c.source_id
 left join public.appointment_reminders ar on c.job_kind='appointment' and ar.id=c.job_id
$$;
revoke all on function public.operations_candidate_projection_internal() from public,anon,authenticated,service_role;
create function public.operations_reminder_candidates(p_after_key text default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare items jsonb;more boolean;
begin perform public.operations_require_admin();if p_limit is null or p_limit not between 1 and 100 or length(p_after_key)>250 then raise exception 'Invalid candidate cursor' using errcode='23514';end if;
 with rows as (select * from public.operations_candidate_projection_internal() where p_after_key is null or cursor_key>p_after_key order by cursor_key limit p_limit+1),page as(select * from rows order by cursor_key limit p_limit)
 select coalesce((select jsonb_agg(to_jsonb(p) order by cursor_key) from page p),'[]'::jsonb),(select count(*)>p_limit from rows) into items,more;
 return jsonb_build_object('observed_at',statement_timestamp(),'items',items,'has_more',more);
end $$;
create function public.operations_reminder_blocks(p_before_at timestamptz default null,p_before_kind text default null,p_before_id uuid default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare items jsonb;more boolean;
begin perform public.operations_require_admin();
 if p_limit is null or p_limit not between 1 and 100 or (p_before_at is null)<>(p_before_id is null) or (p_before_at is null)<>(p_before_kind is null) or (p_before_kind is not null and p_before_kind not in ('care','appointment')) then raise exception 'Invalid blocked handoff cursor' using errcode='23514';end if;
 with rows as(select h.job_kind,h.job_id,h.policy_id,h.outbox_id,h.state,case when h.reason in ('final_preflight_source_or_recipient_ineligible','final_preflight_recipient_or_actor_ineligible') then h.reason else 'reminder_handoff_blocked' end reason,h.created_at,h.invalidated_at,
 case when h.job_kind='care' then j.source_kind when ar.id is not null then 'appointment' end source_kind,case when h.job_kind='care' then j.source_id else ar.appointment_id end source_id,coalesce(j.pet_id,a.pet_id) pet_id,ar.appointment_id
 from public.reminder_outbox_links h left join public.care_reminder_jobs j on h.job_kind='care' and j.id=h.job_id left join public.appointment_reminders ar on h.job_kind='appointment' and ar.id=h.job_id left join public.appointments a on a.id=ar.appointment_id
 where (h.state='blocked' or h.invalidated_at is not null) and (p_before_at is null or(h.created_at,h.job_kind,h.job_id)<(p_before_at,p_before_kind,p_before_id)) order by h.created_at desc,h.job_kind desc,h.job_id desc limit p_limit+1),page as(select * from rows order by created_at desc,job_kind desc,job_id desc limit p_limit)
 select coalesce((select jsonb_agg(to_jsonb(p) order by created_at desc,job_kind desc,job_id desc) from page p),'[]'::jsonb),(select count(*)>p_limit from rows) into items,more;
 return jsonb_build_object('observed_at',statement_timestamp(),'items',items,'has_more',more);
end $$;
create function public.operations_outbox(p_filter text default 'attention',p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare items jsonb;more boolean;
begin perform public.operations_require_admin();
 if p_filter is null or p_filter not in ('attention','pending','expired_claim','uncertain','failed','accepted') or p_limit is null or p_limit not between 1 and 100 or (p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid outbox cursor' using errcode='23514';end if;
 with rows as(select id,conversation_id,client_id,message_id,channel,state,case when last_error is null then null when last_error in ('worker_lease_expired','idempotency_window_expired','recipient_suppressed','recipient_or_actor_ineligible') then last_error else 'processing_review_required' end reason,created_at,updated_at,attempt_count,(state='claimed' and lease_expires_at<=statement_timestamp()) lease_expired,first_attempt_at,accepted_at,delivered_at,case when delivery_failure_kind in ('bounced','complained') then delivery_failure_kind end delivery_failure_kind from public.communication_outbox
 where (case when p_filter='attention' then state in ('pending','uncertain','failed') or(state='claimed' and lease_expires_at<=statement_timestamp()) when p_filter='expired_claim' then state='claimed' and lease_expires_at<=statement_timestamp() else state=p_filter end)
 and (p_before_at is null or(created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit p_limit+1),page as(select * from rows order by created_at desc,id desc limit p_limit)
 select coalesce((select jsonb_agg(to_jsonb(p) order by created_at desc,id desc) from page p),'[]'::jsonb),(select count(*)>p_limit from rows) into items,more;
 return jsonb_build_object('observed_at',statement_timestamp(),'items',items,'has_more',more);
end $$;
create function public.read_stripe_event_queue_page(p_state text default null,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare items jsonb;more boolean;
begin perform public.operations_require_admin();
 if (p_state is not null and p_state not in ('queued','processing','quarantined','completed','ignored')) or p_limit is null or p_limit not between 1 and 100 or (p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid Stripe queue cursor' using errcode='23514';end if;
 with rows as(select r.id,r.created_at,to_jsonb(r)||jsonb_build_object('work_state',w.state,'attempt_count',w.attempt_count,'cycle_no',w.cycle_no,'cycle_attempt_count',w.cycle_attempt_count,'work_reason',w.reason,'available_at',w.available_at) item from public.stripe_event_receipts r join public.stripe_event_work w on w.receipt_id=r.id where(case when p_state is null then w.state in ('queued','processing','quarantined') else w.state=p_state end) and (p_before_at is null or(r.created_at,r.id)<(p_before_at,p_before_id)) order by r.created_at desc,r.id desc limit p_limit+1),page as(select * from rows order by created_at desc,id desc limit p_limit)
 select coalesce((select jsonb_agg(item order by created_at desc,id desc) from page),'[]'::jsonb),(select count(*)>p_limit from rows) into items,more;
 return jsonb_build_object('items',items,'has_more',more);
end $$;
create function public.operations_scheduler_runs(p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare items jsonb;more boolean;
begin perform public.operations_require_admin();if p_limit is null or p_limit not between 1 and 100 or (p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid scheduler run cursor' using errcode='23514';end if;
 with rows as(select * from public.reminder_scheduler_runs where p_before_at is null or(started_at,run_id)<(p_before_at,p_before_id) order by started_at desc,run_id desc limit p_limit+1),page as(select * from rows order by started_at desc,run_id desc limit p_limit)
 select coalesce((select jsonb_agg(public.scheduler_run_projection_internal(run_id) order by started_at desc,run_id desc) from page),'[]'::jsonb),(select count(*)>p_limit from rows) into items,more;
 return jsonb_build_object('items',items,'has_more',more);
end $$;
create function public.operations_overview() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin perform public.operations_require_admin();
 return jsonb_build_object('observed_at',statement_timestamp(),
 'outbox',(select jsonb_build_object('pending',count(*) filter(where state='pending'),'expired_claims',count(*) filter(where state='claimed' and lease_expires_at<=statement_timestamp()),'uncertain',count(*) filter(where state='uncertain'),'failed',count(*) filter(where state='failed'),'oldest_pending_at',min(created_at) filter(where state='pending')) from public.communication_outbox),
 'inbound',jsonb_build_object('processing_review',(select count(*) from public.communication_provider_events where state='review'),'unassigned',(select count(*) from public.communication_inbound where message_id is null)),
 'stripe',(select jsonb_build_object('queued',count(*) filter(where w.state='queued'),'processing',count(*) filter(where w.state='processing'),'quarantined',count(*) filter(where w.state='quarantined'),'oldest_unfinished_at',min(r.created_at) filter(where w.state in ('queued','processing','quarantined'))) from public.stripe_event_work w join public.stripe_event_receipts r on r.id=w.receipt_id),
 'reminders',jsonb_build_object('candidate_count',(select count(*) from public.reminder_scheduler_candidates_internal()),'blocked_handoffs',(select count(*) from public.reminder_outbox_links where state='blocked' or invalidated_at is not null),'oldest_candidate_at',(select min(eligible_at) from public.operations_candidate_projection_internal()),'last_run',(select public.scheduler_run_projection_internal(run_id) from public.reminder_scheduler_runs order by started_at desc,run_id desc limit 1),'last_completed_at',(select max(finished_at) from public.reminder_scheduler_results where outcome='completed'),'unresolved_runs',(select count(*) from public.reminder_scheduler_runs r where not exists(select 1 from public.reminder_scheduler_results t where t.run_id=r.run_id))));
end $$;
do $$declare f record;begin for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('operations_overview','operations_outbox','operations_reminder_candidates','operations_reminder_blocks','operations_scheduler_runs','read_stripe_event_queue_page') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);execute format('grant execute on function %s to authenticated',f.signature);end loop;end $$;
