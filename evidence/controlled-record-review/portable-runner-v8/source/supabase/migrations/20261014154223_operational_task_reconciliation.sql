-- Empty/off by default. Reconciliation never attests room use, completes a
-- checklist, changes stock, or sends a communication.
create table public.operational_reconciliation_policy (
 version integer primary key check(version>0), enabled boolean not null,
 window_from timestamptz, window_until timestamptz,
 review_note text not null check(length(review_note) between 1 and 2000),
 actor_id uuid not null references auth.users(id), recorded_at timestamptz not null default clock_timestamp(),
 check((enabled and window_from is not null and window_until>window_from and window_until-window_from<=interval '31 days') or
       (not enabled and window_from is null and window_until is null))
);
create table public.operational_reconciliation_runs (
 run_id uuid primary key, requested_limit integer not null check(requested_limit between 1 and 25),
 policy_version integer not null references public.operational_reconciliation_policy(version),
 window_from timestamptz not null, window_until timestamptz not null,
 fan_out_limit integer not null check(fan_out_limit between 1 and 256), budget_ms integer not null check(budget_ms between 100 and 5000),
 sweep_id uuid not null, sweep_started_at timestamptz not null,
 checkpoint_version integer not null check(checkpoint_version>=0),
 before_lane text not null check(before_lane in('appointment','use')), before_after_id uuid,
 started_at timestamptz not null default clock_timestamp(),
 check(window_until>window_from and window_until-window_from<=interval '31 days'),check(started_at>=sweep_started_at)
);
create table public.operational_reconciliation_results (
 run_id uuid primary key references public.operational_reconciliation_runs(run_id),
 outcome text not null check(outcome in('completed','failed','paused')),
 finished_at timestamptz not null default clock_timestamp(), counts jsonb, checkpoint jsonb, sweep_complete boolean, failure_code text,
 check((outcome='completed' and counts is not null and checkpoint is not null and sweep_complete is not null and failure_code is null) or
       (outcome in('failed','paused') and counts is null and checkpoint is null and sweep_complete is null and failure_code is not null and failure_code in('batch_transaction_rolled_back','fan_out_limit','deadline','lock_timeout','policy_changed'))),
 check((outcome='paused')=(failure_code='policy_changed') or failure_code is null)
);
create table public.operational_reconciliation_cursor (
 singleton boolean primary key default true check(singleton), checkpoint_version integer not null check(checkpoint_version>=0),
 checkpoint_run_id uuid references public.operational_reconciliation_results(run_id),
 policy_version integer not null references public.operational_reconciliation_policy(version),
 sweep_id uuid not null, sweep_started_at timestamptz not null,
 lane text not null check(lane in('appointment','use','complete')), after_id uuid,
 pending_run_id uuid references public.operational_reconciliation_runs(run_id), check(lane<>'complete' or after_id is null)
);
create index operational_reconciliation_runs_page on public.operational_reconciliation_runs(started_at desc,run_id desc);
create index operational_use_coverage_source on public.operational_task_use_coverage(use_id,use_version,task_id);
create index operational_task_day_latest on public.operational_tasks(template_id,resource_id,day_key,batch desc);
do $$declare t text;begin
 foreach t in array array['operational_reconciliation_policy','operational_reconciliation_runs','operational_reconciliation_results','operational_reconciliation_cursor'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger operational_audit after insert or update on public.%I for each row execute function public.appointment_catalog_audit()',t);
  if t<>'operational_reconciliation_cursor' then execute format('create trigger operational_immutable before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);end if;
 end loop;
end $$;

-- Scheduler integration is below the service run functions at the end of this
-- unpublished migration. No job or practice activation is implied by installation.

-- Reuse the exact prepared-action/session protocol, with a separate policy.
alter table public.operational_task_actions drop constraint operational_task_actions_operation_check;
alter table public.operational_task_actions add check(operation in('template','use','task','policy','reconciliation_policy'));
alter table public.operational_task_reviews drop constraint operational_task_reviews_operation_check;
alter table public.operational_task_reviews add check(operation in('template','use','task','policy','reconciliation_policy'));
create function public.operational_execute_reconciliation_policy(q jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.operational_actor(null,true);p operational_reconciliation_policy;lo timestamptz;hi timestamptz;expected integer;begin
 perform public.native_rx_keys(q,array['expected_version','enabled','window_from','window_until','review_note','attest_review']);
 perform public.native_rx_text(q->'review_note',2000);
 if jsonb_typeof(q->'enabled') is distinct from 'boolean' or q->'attest_review' is distinct from 'true'::jsonb then raise exception 'Explicit reconciliation review required' using errcode='23514';end if;
 if q->'expected_version'<>'null'::jsonb then expected:=public.appointment_catalog_integer(q->'expected_version',1,2147483647);end if;
 select * into p from operational_reconciliation_policy order by version desc limit 1;
 if p.version is distinct from expected then raise exception 'Reconciliation policy changed' using errcode='PT409';end if;
 if q->'enabled'='true'::jsonb then
  if q->>'window_from' ~ '\.[0-9]{7}' or q->>'window_until' ~ '\.[0-9]{7}' then raise exception 'Supported microsecond precision required' using errcode='23514';end if;
  lo:=public.appointment_catalog_instant(q->'window_from');hi:=public.appointment_catalog_instant(q->'window_until');
  if hi<=lo or hi-lo>interval '31 days' then raise exception 'Reviewed appointment window of at most31 days required' using errcode='23514';end if;
 elsif q->'window_from' is distinct from 'null'::jsonb or q->'window_until' is distinct from 'null'::jsonb then raise exception 'Paused reconciliation has no window' using errcode='23514';end if;
 insert into operational_reconciliation_policy values(coalesce(p.version,0)+1,(q->>'enabled')::boolean,lo,hi,q->>'review_note',actor,clock_timestamp());
 return(select to_jsonb(s) from operational_reconciliation_policy s order by version desc limit 1);
end $$;
do $$declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.operational_validate_request(text,jsonb)'::regprocedure);
 needle:='else raise exception ''Operational action required''';
 if position(needle in definition)=0 then raise exception 'Review canonical operational validator before extending';end if;
 execute replace(definition,needle,'elsif op=''reconciliation_policy'' then perform public.native_rx_keys(q,array[''expected_version'',''enabled'',''window_from'',''window_until'',''review_note'',''attest_review'']);'||E'\n '||needle);
 definition:=pg_get_functiondef('public.execute_operational_review(uuid,uuid)'::regprocedure);
 needle:='when ''policy'' then public.operational_execute_policy(r.request) end';
 if position(needle in definition)=0 then raise exception 'Review canonical prepared execution before extending';end if;
 execute replace(definition,needle,'when ''policy'' then public.operational_execute_policy(r.request) when ''reconciliation_policy'' then public.operational_execute_reconciliation_policy(r.request) end');
 definition:=pg_get_functiondef('public.prepare_operational_review(uuid,uuid,text,jsonb)'::regprocedure);
 needle:='perform public.operational_validate_request(p_operation,p_request);';
 if position(needle in definition)=0 then raise exception 'Review canonical preparation role check before extending';end if;
 execute replace(definition,needle,'if p_operation=''reconciliation_policy'' then perform public.operational_actor(p_actor_id,true);end if; '||needle);
end $$;
create function public.read_operational_reconciliation_policy() returns jsonb language plpgsql stable security definer set search_path=public as $$begin
 perform public.operational_actor(null,true);return(select to_jsonb(p) from operational_reconciliation_policy p order by version desc limit 1);
end $$;
create function public.operational_reconciliation_projection(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('run_id',r.run_id,'requested_limit',r.requested_limit,'policy_version',r.policy_version,
 'window_from',r.window_from,'window_until',r.window_until,'fan_out_limit',r.fan_out_limit,'budget_ms',r.budget_ms,
 'sweep_id',r.sweep_id,'sweep_started_at',r.sweep_started_at,'checkpoint_version',r.checkpoint_version,
 'before',jsonb_build_object('lane',r.before_lane,'after_id',r.before_after_id),'started_at',r.started_at,
 'outcome',coalesce(s.outcome,'started'),'finished_at',s.finished_at,'counts',s.counts,'checkpoint',s.checkpoint,'sweep_complete',s.sweep_complete,'failure_code',s.failure_code)
 from operational_reconciliation_runs r left join operational_reconciliation_results s using(run_id) where r.run_id=p_id
$$;
create function public.recover_operational_reconciliation_run(p_run_id uuid,p_limit integer) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r operational_reconciliation_runs;begin
 perform public.communication_require_service();
 if p_run_id is null or p_limit is null or p_limit not between 1 and 25 then raise exception 'Exact bounded run request required' using errcode='23514';end if;
 select * into r from operational_reconciliation_runs where run_id=p_run_id;
 if not found then return null;end if;
 if r.requested_limit<>p_limit then raise exception 'Run request identity collision' using errcode='23505';end if;
 return public.operational_reconciliation_projection(r.run_id);
end $$;
create function public.start_operational_reconciliation_run(p_run_id uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path=public set lock_timeout='2s' as $$
declare r operational_reconciliation_runs;p operational_reconciliation_policy;c operational_reconciliation_cursor;stamp timestamptz;begin
 perform public.communication_require_service();
 if p_run_id is null or p_limit is null or p_limit not between 1 and 25 then raise exception 'Exact bounded run request required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(73260123);perform public.care_eligibility_lock();
 select * into r from operational_reconciliation_runs where run_id=p_run_id;
 if found then
  if r.requested_limit<>p_limit then raise exception 'Run request identity collision' using errcode='23505';end if;
  return public.operational_reconciliation_projection(r.run_id);
 end if;
 select * into p from operational_reconciliation_policy order by version desc limit 1;
 if p.version is null or not p.enabled then return jsonb_build_object('disabled',true);end if;
 select * into c from operational_reconciliation_cursor where singleton for update;
 if c.pending_run_id is not null then raise exception 'Recover the original unresolved reconciliation run first' using errcode='PT409';end if;
 stamp:=clock_timestamp();
 if c.singleton is null then
  insert into operational_reconciliation_cursor(singleton,checkpoint_version,policy_version,sweep_id,sweep_started_at,lane) values(true,0,p.version,gen_random_uuid(),stamp,'appointment') returning * into c;
 elsif c.lane='complete' or c.policy_version<>p.version then
  update operational_reconciliation_cursor set policy_version=p.version,sweep_id=gen_random_uuid(),sweep_started_at=stamp,lane='appointment',after_id=null where singleton returning * into c;
 end if;
 insert into operational_reconciliation_runs values(p_run_id,p_limit,p.version,p.window_from,p.window_until,256,5000,c.sweep_id,c.sweep_started_at,c.checkpoint_version,c.lane,c.after_id,clock_timestamp());
 update operational_reconciliation_cursor set pending_run_id=p_run_id where singleton;
 return public.operational_reconciliation_projection(p_run_id);
end $$;

-- A private trigger tallies actual immutable revision inserts in the executing
-- transaction. LOCAL counters roll back with the batch and cannot confer access.
create function public.operational_reconciliation_tally() returns trigger language plpgsql set search_path=public as $$
declare totals jsonb;kind text;deadline timestamptz;begin
 if coalesce(auth.role(),'')<>'service_role' or nullif(current_setting('lrv.operational_run',true),'') is null then return new;end if;
 deadline:=current_setting('lrv.operational_deadline')::timestamptz;
 if clock_timestamp()>=deadline then raise exception 'Reconciliation deadline reached' using errcode='P7502';end if;
 totals:=current_setting('lrv.operational_counts')::jsonb;
 kind:=case when new.event='generated' and new.version=1 then 'generated' else 'revised' end;
 totals:=jsonb_set(totals,array[kind],to_jsonb((totals->>kind)::integer+1));
 if (totals->>'generated')::integer+(totals->>'revised')::integer>256 then raise exception 'Reconciliation fan-out exceeded' using errcode='P7501';end if;
 perform set_config('lrv.operational_counts',totals::text,true);return new;
end $$;
create trigger operational_reconciliation_tally after insert on public.operational_task_revisions for each row execute function public.operational_reconciliation_tally();

create function public.operational_reconciliation_next(r public.operational_reconciliation_runs,p_lane text,p_after uuid)
returns uuid language plpgsql stable security definer set search_path=public as $$
declare source uuid;begin
 if p_lane='appointment' then
  select a.id into source from appointments a where (p_after is null or a.id>p_after) and a.created_at<=r.sweep_started_at and
   ((a.scheduled_at>=r.window_from and a.scheduled_at<r.window_until) or exists(select 1 from operational_tasks t join operational_task_revisions v on v.id=t.head_id where t.appointment_id=a.id and t.use_id is null and t.day_key is null and v.state not in('completed','superseded')))
   order by a.id limit 1;
 elsif p_lane='use' then
  -- Independent actual-use paging includes old appointments and corrections.
  select u.id into source from operational_resource_uses u where (p_after is null or u.id>p_after) and u.created_at<=r.sweep_started_at order by u.id limit 1;
 else raise exception 'Source lane required' using errcode='23514';end if;
 return source;
end $$;
create function public.operational_reconciliation_source(p_lane text,p_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare templates integer;tasks integer;coverage integer;t operational_tasks;r operational_task_revisions;e operational_task_enrollments;unresolved boolean;begin
 -- Bound input loops before materialization. The conservative formula covers
 -- correction reviews, day batches and a second pass for assignee eligibility.
 select count(*) into templates from(select id from operational_task_templates where published_version_id is not null limit 257)s;
 select count(*) into tasks from(select id from operational_tasks where
  (p_lane='appointment' and appointment_id=p_id and use_id is null and day_key is null) or (p_lane='use' and use_id=p_id) limit 257)s;
 coverage:=0;
 if p_lane='use' then select count(*) into coverage from(select task_id from operational_task_use_coverage where use_id=p_id limit 257)s;end if;
 if 2*tasks+4*coverage+4*templates>256 then raise exception 'Source fan-out needs review' using errcode='P7501';end if;
 if p_lane='appointment' then perform public.operational_materialize_appointment(p_id);else perform public.operational_materialize_use(p_id);end if;
 for t in select candidate.* from operational_tasks candidate where
   (p_lane='appointment' and candidate.appointment_id=p_id and candidate.use_id is null and candidate.day_key is null) or
   (p_lane='use' and (candidate.use_id=p_id or exists(select 1 from operational_task_use_coverage c where c.use_id=p_id and c.task_id=candidate.id))) order by candidate.id loop
  select * into r from operational_task_revisions where id=t.head_id;select * into e from operational_task_enrollments where id=t.enrollment_id;
  if r.state not in('completed','superseded') and r.assignee_id is not null and not public.operational_eligible(r.assignee_id,e.definition) then
   perform public.operational_revision(t.id,'source_changed','needs_review',r.due_at,r.assignee_id,r.checked_ids,'Assigned staff is no longer eligible; review task assignment',r.source_snapshot);
  end if;
 end loop;
 select exists(select 1 from operational_tasks taskrow join operational_task_revisions v on v.id=taskrow.head_id where v.state='needs_review' and
  ((p_lane='appointment' and taskrow.appointment_id=p_id and taskrow.use_id is null and taskrow.day_key is null) or
   (p_lane='use' and (taskrow.use_id=p_id or exists(select 1 from operational_task_use_coverage c where c.use_id=p_id and c.task_id=taskrow.id))))) into unresolved;
 return unresolved;
end $$;
create function public.execute_operational_reconciliation_run(p_run_id uuid,p_limit integer) returns jsonb language plpgsql security definer
set search_path=public set statement_timeout='5s' set lock_timeout='2s' as $$
<<execution>>
declare r operational_reconciliation_runs;p operational_reconciliation_policy;c operational_reconciliation_cursor;
 lane text;after_id uuid;source uuid;examined integer:=0;generated integer:=0;revised integer:=0;unresolved integer:=0;
 totals jsonb;checkpoint jsonb;deadline timestamptz;failure text;begin
 perform public.communication_require_service();
 if p_run_id is null or p_limit is null or p_limit not between 1 and 25 then raise exception 'Exact bounded run request required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(73260123);perform public.care_eligibility_lock();
 select * into r from operational_reconciliation_runs where run_id=p_run_id;
 if not found then raise exception 'Original run required' using errcode='23514';end if;
 if r.requested_limit<>p_limit then raise exception 'Run request identity collision' using errcode='23505';end if;
 if exists(select 1 from operational_reconciliation_results where run_id=r.run_id) then return public.operational_reconciliation_projection(r.run_id);end if;
 select * into c from operational_reconciliation_cursor where singleton for update;
 if c.pending_run_id is distinct from r.run_id or c.checkpoint_version<>r.checkpoint_version or c.sweep_id<>r.sweep_id or (c.lane,c.after_id) is distinct from (r.before_lane,r.before_after_id) then raise exception 'Original checkpoint changed' using errcode='PT409';end if;
 select * into p from operational_reconciliation_policy order by version desc limit 1;
 if p.version is distinct from r.policy_version or not p.enabled then
  insert into operational_reconciliation_results(run_id,outcome,failure_code) values(r.run_id,'paused','policy_changed');
  update operational_reconciliation_cursor set pending_run_id=null where singleton;
  return public.operational_reconciliation_projection(r.run_id);
 end if;
 -- A failed subtransaction rolls back every task, audit and LOCAL tally before
 -- its terminal failure receipt is appended. It never advances the checkpoint.
 begin
  deadline:=clock_timestamp()+make_interval(secs=>r.budget_ms/1000.0);
  perform set_config('lrv.operational_run',r.run_id::text,true);
  perform set_config('lrv.operational_deadline',deadline::text,true);
  lane:=r.before_lane;after_id:=r.before_after_id;
  while examined<r.requested_limit loop
   if clock_timestamp()>=deadline then raise exception 'Reconciliation deadline reached' using errcode='P7502';end if;
   source:=public.operational_reconciliation_next(r,lane,after_id);
   if source is null then
    if lane='appointment' then lane:='use';after_id:=null;continue;else lane:='complete';after_id:=null;exit;end if;
   end if;
   perform set_config('lrv.operational_counts','{"generated":0,"revised":0}',true);
   if public.operational_reconciliation_source(lane,source) then unresolved:=unresolved+1;end if;
   totals:=current_setting('lrv.operational_counts')::jsonb;
   generated:=generated+(totals->>'generated')::integer;revised:=revised+(totals->>'revised')::integer;
   examined:=examined+1;after_id:=source;
  end loop;
  if lane<>'complete' and public.operational_reconciliation_next(r,lane,after_id) is null then
   if lane='appointment' then lane:='use';after_id:=null;end if;
   if public.operational_reconciliation_next(r,lane,after_id) is null then lane:='complete';after_id:=null;end if;
  end if;
  if clock_timestamp()>=deadline then raise exception 'Reconciliation deadline reached' using errcode='P7502';end if;
  checkpoint:=jsonb_build_object('version',r.checkpoint_version+1,'lane',lane,'after_id',after_id);
  insert into operational_reconciliation_results(run_id,outcome,counts,checkpoint,sweep_complete) values(r.run_id,'completed',jsonb_build_object('examined',examined,'generated',generated,'revised',revised,'unresolved',unresolved),checkpoint,lane='complete');
  update operational_reconciliation_cursor set checkpoint_version=r.checkpoint_version+1,checkpoint_run_id=r.run_id,lane=execution.lane,after_id=execution.after_id,pending_run_id=null where singleton;
 exception
  when sqlstate 'P7501' then failure:='fan_out_limit';
  when sqlstate 'P7502' or query_canceled then failure:='deadline';
  when lock_not_available then failure:='lock_timeout';
  when others then failure:='batch_transaction_rolled_back';
 end;
 perform set_config('lrv.operational_run','',true);
 if failure is not null then
  insert into operational_reconciliation_results(run_id,outcome,failure_code) values(r.run_id,'failed',failure);
  update operational_reconciliation_cursor set pending_run_id=null where singleton;
 end if;
 return public.operational_reconciliation_projection(r.run_id);
end $$;
create function public.list_operational_reconciliation_runs(p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 25) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform public.operational_actor(null,true);
 if p_limit is null or p_limit not between 1 and 100 or (p_before is null)<>(p_before_id is null) then raise exception 'Bounded exact run page required' using errcode='23514';end if;
 return(with candidates as(select run_id,started_at from operational_reconciliation_runs where p_before is null or (started_at,run_id)<(p_before,p_before_id) order by started_at desc,run_id desc limit p_limit+1),
 page as(select * from candidates order by started_at desc,run_id desc limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(public.operational_reconciliation_projection(run_id) order by started_at desc,run_id desc)from page),'[]'),
 'next',case when(select count(*)from candidates)>p_limit then(select jsonb_build_object('before',started_at,'before_id',run_id)from page order by started_at,run_id limit 1)end));
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and
  (proname like 'operational_reconciliation_%' or proname in('operational_execute_reconciliation_policy','read_operational_reconciliation_policy','recover_operational_reconciliation_run','start_operational_reconciliation_run','execute_operational_reconciliation_run','list_operational_reconciliation_runs')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in('read_operational_reconciliation_policy','list_operational_reconciliation_runs') then execute format('grant execute on function %s to authenticated',f.signature);end if;
  if f.proname in('recover_operational_reconciliation_run','start_operational_reconciliation_run','execute_operational_reconciliation_run') then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;

-- Transport evidence remains distinct from committed reconciliation evidence.
alter table public.scheduler_job_runs drop constraint scheduler_job_runs_job_check;
alter table public.scheduler_job_runs add check(job in('dispatch-outbox','process-inbound','process-stripe-events','queue-reminders','cleanup-abandoned-attachment','reconcile-operational-tasks'));
alter table public.scheduler_job_runs add column reconciliation_run_id uuid references public.operational_reconciliation_runs(run_id);
alter table public.scheduler_job_runs add check(reconciliation_run_id is null or job='reconcile-operational-tasks');

-- Preserve unrelated jobs exactly; delegate only the new job to a private wrapper.
create function public.scheduler_dispatch_operational_reconciliation() returns jsonb
language plpgsql security definer set search_path=public,extensions set lock_timeout='2s' as $$
declare project_url text;worker_key text;missing text;transport_id uuid;request_id bigint;
 run_id uuid;requested_limit integer:=5;receipt jsonb;previous_claims text:=current_setting('request.jwt.claims',true);
begin
 perform pg_advisory_xact_lock(73260123);
 -- Pause/default-off checks precede Vault access, run reservation and HTTP.
 if not coalesce((select enabled from operational_reconciliation_policy order by version desc limit 1),false) then
  return jsonb_build_object('job','reconcile-operational-tasks','outcome','disabled');
 end if;
 select decrypted_secret into project_url from vault.decrypted_secrets where name='project_url';
 select decrypted_secret into worker_key from vault.decrypted_secrets where name='scheduler_worker_key';
 missing:=nullif(concat_ws(', ',case when project_url is null then 'project_url' end,case when worker_key is null then 'scheduler_worker_key' end),'');
 if missing is not null then
  if not exists(select 1 from scheduler_job_results s join scheduler_job_runs r on r.id=s.run_id where r.job='reconcile-operational-tasks' and s.outcome='configuration_missing' and s.recorded_at>now()-interval '1 hour') then
   insert into scheduler_job_runs(job,url_path) values('reconcile-operational-tasks','/functions/v1/reconcile-operational-tasks') returning id into transport_id;
   insert into scheduler_job_results(run_id,outcome,error_message) values(transport_id,'configuration_missing','Missing Vault secret(s): '||missing);
  end if;
  return jsonb_build_object('job','reconcile-operational-tasks','outcome','configuration_missing','run_id',transport_id);
 end if;
 if project_url !~ '^(https://(mgadheotkdnrsatfivjy|kothoqicubowyhwfsrte)\.supabase\.co|http://(127\.0\.0\.1|localhost|kong)(:[0-9]{1,5})?)$' then
  raise exception 'Known practice scheduler backend required' using errcode='23514';
 end if;
 -- Reserve BEFORE async transport. If the worker never receives the call, the
 -- next cadence still resumes this same UUID and original limit.
 select r.run_id,r.requested_limit into run_id,requested_limit from operational_reconciliation_cursor c join operational_reconciliation_runs r on r.run_id=c.pending_run_id where c.singleton;
 if run_id is null then run_id:=gen_random_uuid();requested_limit:=5;end if;
 begin
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  receipt:=public.start_operational_reconciliation_run(run_id,requested_limit);
  perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 exception when others then
  perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);raise;
 end;
 if receipt->'disabled'='true'::jsonb then return jsonb_build_object('job','reconcile-operational-tasks','outcome','disabled');end if;
 request_id:=net.http_post(url:=project_url||'/functions/v1/reconcile-operational-tasks',
  headers:=jsonb_build_object('apikey',worker_key,'Content-Type','application/json'),
  body:=jsonb_build_object('run_id',run_id,'limit',requested_limit),timeout_milliseconds:=30000);
 insert into scheduler_job_runs(job,url_path,request_id,reconciliation_run_id)
 values('reconcile-operational-tasks','/functions/v1/reconcile-operational-tasks',request_id,run_id) returning id into transport_id;
 return jsonb_build_object('job','reconcile-operational-tasks','outcome','dispatched','request_id',request_id,'run_id',transport_id,'reconciliation_run_id',run_id);
end $$;
revoke all on function public.scheduler_dispatch_operational_reconciliation() from public,anon,authenticated,service_role;

do $$declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.scheduler_dispatch(text)'::regprocedure);
 needle:='if p_job is null or p_job not in (';
 if position(needle in definition)=0 then raise exception 'Review canonical scheduler dispatcher before extending';end if;
 execute replace(definition,needle,'if p_job=''reconcile-operational-tasks'' then return public.scheduler_dispatch_operational_reconciliation();end if;'||E'\n  '||needle);
 definition:=pg_get_functiondef('public.operations_scheduler_jobs()'::regprocedure);
 if position('select r.job, r.requested_at, r.id as run_id,' in definition)=0 or position('when ''cleanup-abandoned-attachment'' then interval ''30 minutes''' in definition)=0 then raise exception 'Review canonical scheduler projection before extending';end if;
 definition:=replace(definition,'select r.job, r.requested_at, r.id as run_id,','select r.job, r.requested_at, r.id as run_id, r.reconciliation_run_id,');
 definition:=replace(definition,'select l.job, l.requested_at, s.outcome,','select l.job, l.requested_at, l.reconciliation_run_id, s.outcome,');
 definition:=replace(definition,'when ''cleanup-abandoned-attachment'' then interval ''30 minutes''','when ''cleanup-abandoned-attachment'' then interval ''30 minutes'' when ''reconcile-operational-tasks'' then interval ''5 minutes''');
 definition:=replace(definition,'''status_code'', status_code,','''status_code'', status_code, ''cadence_seconds'', extract(epoch from cadence)::integer, ''reconciliation_run_id'', reconciliation_run_id,');
 execute definition;
end $$;

create function public.read_operational_reconciliation_status() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare registered boolean:=false;active boolean;begin
 perform public.operational_actor(null,true);
 if to_regclass('cron.job') is not null then
  execute 'select true,active from cron.job where jobname=$1' into registered,active using 'reconcile-operational-tasks';
 end if;
 return jsonb_build_object('cadence_seconds',300,'cron_registered',coalesce(registered,false),'cron_active',active,
  'pending_run_id',(select pending_run_id from operational_reconciliation_cursor where singleton));
end $$;
revoke all on function public.read_operational_reconciliation_status() from public,anon,authenticated,service_role;
grant execute on function public.read_operational_reconciliation_status() to authenticated;

do $$declare job_id bigint;begin
 if current_database()<>coalesce(current_setting('cron.database_name',true),'postgres') then return;end if;
 create extension if not exists pg_cron;
 job_id:=cron.schedule('reconcile-operational-tasks','*/5 * * * *',$cmd$select public.scheduler_dispatch('reconcile-operational-tasks')$cmd$);
 perform cron.alter_job(job_id,active:=false);
end $$;
