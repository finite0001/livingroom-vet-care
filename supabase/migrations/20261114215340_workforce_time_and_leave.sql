-- Native single-practice staff operations. Private records are reachable only through scoped RPCs.
begin;
create schema workforce;
revoke all on schema workforce from public,anon,authenticated,service_role;
create table workforce.mutation_receipts(area text not null,action text not null,id uuid not null,actor uuid not null,payload_hash text not null,primary key(area,action,id));
create table workforce.access (
 staff_id uuid primary key references public.profiles(id), time_manager boolean not null default false,
 pay_manager boolean not null default false, changed_by uuid not null, changed_at timestamptz not null default now()
);
create table workforce.settings (
 singleton boolean primary key default true check(singleton), version integer not null default 1,
 workweek_start integer check(workweek_start between 0 and 6), weekly_hours numeric check(weekly_hours>0 and weekly_hours<=168),
 daily_hours numeric check(daily_hours>0 and daily_hours<=24), auto_close_hours numeric check(auto_close_hours>0 and auto_close_hours<=48),
 late_grace_minutes integer check(late_grace_minutes between 0 and 120), payroll_provider text check(length(payroll_provider)<=150),
 updated_by uuid, updated_at timestamptz not null default now()
);
insert into workforce.settings(singleton) values(true);
create table workforce.audit (
 id bigint generated always as identity primary key, actor uuid, action text not null,
 subject uuid, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create table workforce.leave_policies (
 kind text primary key check(kind in('PTO','SICK')), monthly_hours numeric not null check(monthly_hours between 0 and 1000),
 cap_hours numeric check(cap_hours between 0 and 10000), allow_negative boolean not null default false,
 effective_from date not null, version integer not null default 1, updated_by uuid not null
);
create table workforce.leave_policy_history (kind text not null,monthly_hours numeric not null,cap_hours numeric,allow_negative boolean not null,effective_from date not null,version integer not null,updated_by uuid not null,primary key(kind,effective_from));
create table workforce.leave_accounts (
 staff_id uuid not null references public.profiles(id), kind text not null references workforce.leave_policies(kind),
 enrolled_on date not null, primary key(staff_id,kind)
);
create table workforce.leave_requests (
 id uuid primary key, staff_id uuid not null references public.profiles(id), kind text not null check(kind in('PTO','SICK')),
 starts_on date not null, ends_on date not null, hours numeric not null check(hours>0 and hours<=1000),
 reason text not null default '' check(length(reason)<=2000), status text not null default 'PENDING' check(status in('PENDING','APPROVED','DENIED','CANCELLED')),
 version integer not null default 1, decided_by uuid, created_at timestamptz not null default now(),
 check(ends_on>=starts_on and ends_on-starts_on<=366)
);
create index leave_requests_staff_dates on workforce.leave_requests(staff_id,starts_on);
create table workforce.leave_ledger (
 id uuid primary key default gen_random_uuid(), staff_id uuid not null references public.profiles(id), kind text not null,
 hours numeric not null check(hours<>0 and abs(hours)<=10000), source_key text not null unique,
 note text not null check(length(note) between 1 and 1000), actor uuid, created_at timestamptz not null default now()
);
create index leave_ledger_staff_kind on workforce.leave_ledger(staff_id,kind);
create table workforce.shifts (
 id uuid primary key, staff_id uuid not null references public.profiles(id), starts_at timestamptz not null,
 ends_at timestamptz not null, note text not null default '' check(length(note)<=1000),
 cancelled boolean not null default false, version integer not null default 1, created_by uuid not null,
 check(ends_at>starts_at and ends_at-starts_at<=interval '48 hours')
);
create index shifts_staff_start on workforce.shifts(staff_id,starts_at);
create table workforce.holidays (
 day date primary key, label text not null check(length(label) between 1 and 150), closed boolean not null default true,
 paid_hours numeric not null default 0 check(paid_hours between 0 and 24), updated_by uuid not null
);
create table workforce.periods (
 id uuid primary key, starts_on date not null, ends_on date not null, state text not null default 'OPEN' check(state in('OPEN','CLOSED')),
 version integer not null default 1, created_by uuid not null, closed_by uuid, closed_at timestamptz,
 check(ends_on>=starts_on and ends_on-starts_on<=31), unique(starts_on,ends_on)
);
create table workforce.time_approvals (
 period_id uuid not null references workforce.periods(id), staff_id uuid not null references public.profiles(id),
 submitted_at timestamptz not null default now(), approved_by uuid, approved_at timestamptz,
 fingerprint text not null, primary key(period_id,staff_id)
);
create table workforce.clock_flags (
 entry_id uuid primary key references public.time_entries(id) on delete restrict,
 estimated_at timestamptz not null, reviewed_by uuid, reviewed_at timestamptz
);
create table workforce.corrections (
 id uuid primary key, staff_id uuid not null references public.profiles(id), entry_id uuid references public.time_entries(id) on delete restrict,
 starts_at timestamptz not null, ends_at timestamptz not null, reason text not null check(length(reason) between 1 and 1000),
 status text not null default 'PENDING' check(status in('PENDING','APPROVED','DENIED')),
 decided_by uuid, expected_entry jsonb, created_at timestamptz not null default now(), check(ends_at>starts_at and ends_at-starts_at<=interval '48 hours')
);
-- Explicitly closed by default. No guessed payroll or leave policy is installed.
do $$declare t record; begin for t in select tablename from pg_tables where schemaname='workforce' loop
 execute format('alter table workforce.%I enable row level security',t.tablename);
 execute format('revoke all on workforce.%I from public,anon,authenticated,service_role',t.tablename);
end loop; end$$;

create function workforce.actor() returns uuid language plpgsql stable security definer set search_path=pg_catalog as $$
declare a uuid:=auth.uid(); begin
 if a is null or not public.is_active_staff(a) then raise exception 'Active staff access required' using errcode='42501'; end if; return a;
end$$;
create function workforce.can_manage(a uuid, pay boolean default false) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select public.is_active_staff(a) and exists(select 1 from workforce.access x where x.staff_id=a and case when pay then x.pay_manager else x.time_manager end)
$$;
create function workforce.require_manager(pay boolean default false) returns uuid language plpgsql stable security definer set search_path=pg_catalog as $$
declare a uuid:=workforce.actor(); begin if not workforce.can_manage(a,pay) then raise exception 'Assigned manager access required' using errcode='42501';end if;return a;end$$;
create function workforce.time_fingerprint(a uuid,f date,t date) returns text language sql stable security definer set search_path=pg_catalog as $$
 select md5(coalesce(string_agg(e.id::text||e.clock_in_at::text||coalesce(e.clock_out_at::text,'OPEN')||coalesce(e.note,''),'|' order by e.id),''))
 from public.time_entries e where e.staff_id=a and e.clock_in_at<((t+1)::timestamp at time zone 'America/Denver')
 and coalesce(e.clock_out_at,'infinity')>(f::timestamp at time zone 'America/Denver')
$$;
-- Finalized time is captured in private immutable snapshots. Do not alter existing clock
-- tables/routines: controlled-drug workflows bind their exact metadata.
create function workforce.require_open_interval(f timestamptz,t timestamptz)returns void language plpgsql stable security definer set search_path=pg_catalog as $$begin
 if exists(select 1 from workforce.periods p where p.state='CLOSED' and f<((p.ends_on+1)::timestamp at time zone 'America/Denver')and t>(p.starts_on::timestamp at time zone 'America/Denver'))then raise exception 'Finalized time requires a payroll adjustment, not a new correction'using errcode='PT409';end if;
end$$;

create function workforce.job_state()returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$declare enabled boolean;begin
 if not exists(select 1 from pg_extension where extname='pg_cron')then return null;end if;
 select active into enabled from cron.job where jobname='workforce-hourly'and command='select workforce.run_jobs();';return enabled;
end$$;
create function public.workforce_toggle_jobs(p_enabled boolean)returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare a uuid:=workforce.require_manager();j bigint;begin
 if p_enabled is null then raise exception 'Choose enabled or paused';end if;
 if p_enabled and not exists(select 1 from workforce.leave_policies)and(select auto_close_hours from workforce.settings)is null then raise exception 'Configure a leave or clock-out rule before enabling automation';end if;
 if not exists(select 1 from pg_extension where extname='pg_cron')then raise exception 'The scheduler needs setup on this backend';end if;
 select jobid into j from cron.job where jobname='workforce-hourly'and command='select workforce.run_jobs();';
 if j is null then raise exception 'Expected workforce schedule not found';end if;
 perform cron.alter_job(j,active:=p_enabled);
 insert into workforce.audit(actor,action,details)values(a,'job_schedule',jsonb_build_object('active',p_enabled));return p_enabled;
end$$;
create function public.workforce_read(p_from date,p_until date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare a uuid:=workforce.actor(); m boolean:=workforce.can_manage(a); result jsonb;
begin
 if p_from is null or p_until is null or p_until<p_from or p_until-p_from>366 then raise exception 'Use a date range of at most one year';end if;
 select jsonb_build_object(
 'can_manage',m,'job_active',workforce.job_state(),'can_pay',workforce.can_manage(a,true),'can_assign',public.has_role(a,'ADMIN'),
 'settings',(select to_jsonb(s)-'updated_by' from workforce.settings s),
 'staff',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name) order by p.full_name),'[]') from public.profiles p where p.is_active),
 'access',case when public.has_role(a,'ADMIN') then(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from workforce.access x)else '[]'::jsonb end,
 'policies',(select coalesce(jsonb_agg(to_jsonb(p)),'[]')from workforce.leave_policies p),
 'balances',(select coalesce(jsonb_agg(to_jsonb(b)),'[]')from(select x.staff_id,x.kind,coalesce(sum(l.hours),0) hours from workforce.leave_accounts x left join workforce.leave_ledger l on l.staff_id=x.staff_id and l.kind=x.kind where m or x.staff_id=a group by x.staff_id,x.kind)b),
 'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]')from workforce.leave_requests r where (m or r.staff_id=a) and r.starts_on<=p_until and r.ends_on>=p_from),
 'off',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'staff_id',r.staff_id,'starts_on',r.starts_on,'ends_on',r.ends_on)),'[]')from workforce.leave_requests r where r.status='APPROVED' and r.starts_on<=p_until and r.ends_on>=p_from),
 'shifts',(select coalesce(jsonb_agg(to_jsonb(s) order by s.starts_at),'[]')from workforce.shifts s where s.starts_at<((p_until+1)::timestamp at time zone 'America/Denver') and s.ends_at>(p_from::timestamp at time zone 'America/Denver')),
 'holidays',(select coalesce(jsonb_agg(to_jsonb(h) order by h.day),'[]')from workforce.holidays h where h.day between p_from and p_until),
 'periods',(select coalesce(jsonb_agg((to_jsonb(p)-'time_snapshot')||jsonb_build_object('time_changed',p.state='CLOSED'and exists(select 1 from workforce.time_approvals ta where ta.period_id=p.id and ta.fingerprint<>workforce.time_fingerprint(ta.staff_id,p.starts_on,p.ends_on))) order by p.starts_on desc),'[]')from workforce.periods p where p.starts_on<=p_until and p.ends_on>=p_from),
 'approvals',(select coalesce(jsonb_agg(to_jsonb(t)),'[]')from workforce.time_approvals t join workforce.periods p on p.id=t.period_id where (m or t.staff_id=a)and p.starts_on<=p_until and p.ends_on>=p_from),
 'corrections',(select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc),'[]')from workforce.corrections c where (m or c.staff_id=a)and c.starts_at<((p_until+1)::timestamp at time zone 'America/Denver')and c.ends_at>(p_from::timestamp at time zone 'America/Denver')),
 'flags',(select coalesce(jsonb_agg(to_jsonb(f)),'[]')from workforce.clock_flags f join public.time_entries e on e.id=f.entry_id where (m or e.staff_id=a)and e.clock_in_at<((p_until+1)::timestamp at time zone 'America/Denver')and e.clock_out_at>(p_from::timestamp at time zone 'America/Denver')),
 'entries',(select coalesce(jsonb_agg(to_jsonb(e) order by e.clock_in_at),'[]')from public.time_entries e where(m or e.staff_id=a)and e.clock_in_at<((p_until+1)::timestamp at time zone 'America/Denver')and coalesce(e.clock_out_at,'infinity')>(p_from::timestamp at time zone 'America/Denver'))
 )into result;return result;
end$$;

create function public.workforce_command(p_action text,p_id uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a uuid:=workforce.actor(); s uuid; k text; r workforce.leave_requests; pol workforce.leave_policies; per workforce.periods;
 c workforce.corrections; saved_entry public.time_entries; bal numeric; h numeric; v integer; f date; t date; st timestamptz; en timestamptz; fp text;prior workforce.mutation_receipts;created_action boolean:=p_action=any(array['request_leave','adjust_balance','enroll','shift','period','correction','policy','settings','holiday']);
begin
 if p_id is null or jsonb_typeof(p_data)<>'object' or length(p_data::text)>10000 then raise exception 'Invalid request';end if;
 -- Keep lock order consistent with existing clock writers. Clinic workforce commands are small, serialized batches.
 perform 1 from public.profiles order by id for update;
 -- Existing clock writers take profile lock before the time lock.
 if p_action in('resolve_correction','review_clock') then
  select staff_id into s from workforce.corrections where id=p_id;
  if p_action='review_clock' then select staff_id into s from public.time_entries where id=p_id;end if;
  perform 1 from public.profiles where id=s for update;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('workforce-time',0));
 if created_action then
  if p_action not in('request_leave','correction')then perform workforce.require_manager();end if;
  select * into prior from workforce.mutation_receipts where area='workforce'and action=p_action and id=p_id;
  if found then
   if prior.actor<>a or prior.payload_hash<>md5(p_data::text)then raise exception 'Request was already used; refresh saved records before starting a new request'using errcode='PT409';end if;
   return jsonb_build_object('id',p_id,'action',p_action);
  end if;
 end if;
 case p_action
 when 'access' then
  if not public.has_role(a,'ADMIN')then raise exception 'Administrator required' using errcode='42501';end if;
  insert into workforce.access(staff_id,time_manager,pay_manager,changed_by)values(p_id,(p_data->>'time_manager')::boolean,(p_data->>'pay_manager')::boolean,a)
  on conflict(staff_id)do update set time_manager=excluded.time_manager,pay_manager=excluded.pay_manager,changed_by=a,changed_at=now();
 when 'settings' then
  perform workforce.require_manager();
  update workforce.settings set workweek_start=(p_data->>'workweek_start')::integer,weekly_hours=(p_data->>'weekly_hours')::numeric,
   daily_hours=(p_data->>'daily_hours')::numeric,auto_close_hours=(p_data->>'auto_close_hours')::numeric,
   late_grace_minutes=(p_data->>'late_grace_minutes')::integer,payroll_provider=nullif(p_data->>'payroll_provider',''),
   version=version+1,updated_by=a,updated_at=now()where version=(p_data->>'version')::integer;
  if not found then raise exception 'Settings changed; refresh before saving' using errcode='PT409';end if;
 when 'policy' then
  perform workforce.require_manager();k:=p_data->>'kind';
  -- Never rewrite accrual history: policy changes start in an unposted month.
  f:=(p_data->>'effective_from')::date;
  if extract(day from f)<>1 then raise exception 'Accrual policies start on the first day of a month';end if;
  if exists(select 1 from workforce.leave_ledger where kind=k and source_key like 'accrual:%' and substring(source_key from 46 for 10)::date>=f)then raise exception 'Policy affects posted accruals; choose a future month';end if;
  insert into workforce.leave_policies(kind,monthly_hours,cap_hours,allow_negative,effective_from,updated_by)
   values(k,(p_data->>'monthly_hours')::numeric,(p_data->>'cap_hours')::numeric,(p_data->>'allow_negative')::boolean,f,a)
  on conflict(kind)do update set monthly_hours=excluded.monthly_hours,cap_hours=excluded.cap_hours,allow_negative=excluded.allow_negative,effective_from=excluded.effective_from,updated_by=a,version=workforce.leave_policies.version+1;
  insert into workforce.leave_policy_history select * from workforce.leave_policies where kind=k on conflict(kind,effective_from)do update set monthly_hours=excluded.monthly_hours,cap_hours=excluded.cap_hours,allow_negative=excluded.allow_negative,version=excluded.version,updated_by=excluded.updated_by;
 when 'enroll' then
  perform workforce.require_manager();s:=(p_data->>'staff_id')::uuid;k:=p_data->>'kind';h:=(p_data->>'hours')::numeric;
  insert into workforce.leave_accounts(staff_id,kind,enrolled_on)values(s,k,(p_data->>'enrolled_on')::date);
  if h<>0 then insert into workforce.leave_ledger(staff_id,kind,hours,source_key,note,actor)values(s,k,h,'opening:'||s||':'||k,'Opening balance',a);end if;
 when 'adjust_balance' then
  perform workforce.require_manager();s:=(p_data->>'staff_id')::uuid;k:=p_data->>'kind';h:=(p_data->>'hours')::numeric;
  if not exists(select 1 from workforce.leave_accounts where staff_id=s and kind=k)then raise exception 'Enroll this employee first';end if;
  insert into workforce.leave_ledger(staff_id,kind,hours,source_key,note,actor) values(s,k,h,'adjust:'||p_id,p_data->>'reason',a);
 when 'request_leave' then
  k:=p_data->>'kind';
  if not exists(select 1 from workforce.leave_accounts where staff_id=a and kind=k)then raise exception 'Your leave account needs setup';end if;
  insert into workforce.leave_requests(id,staff_id,kind,starts_on,ends_on,hours,reason)values(p_id,a,k,(p_data->>'starts_on')::date,(p_data->>'ends_on')::date,(p_data->>'hours')::numeric,coalesce(p_data->>'reason',''));
 when 'decide_leave' then
  select * into r from workforce.leave_requests where id=p_id for update;
  if r.id is null then raise exception 'Request not found';end if;
  if r.version<>(p_data->>'version')::integer then raise exception 'Request changed; refresh' using errcode='PT409';end if;
  k:=p_data->>'decision';
  if k='CANCELLED' then
   if a<>r.staff_id then perform workforce.require_manager();end if;
   if r.status not in('PENDING','APPROVED')then raise exception 'Request cannot be cancelled';end if;
  else
   perform workforce.require_manager();
   if r.status<>'PENDING' or k not in('APPROVED','DENIED')then raise exception 'Request has already been decided';end if;
  end if;
  select * into pol from workforce.leave_policy_history where kind=r.kind and effective_from<=r.starts_on order by effective_from desc limit 1;
  if pol.kind is null then raise exception 'No leave policy applies to those dates';end if;
  if k='APPROVED' then
   select coalesce(sum(hours),0) into bal from workforce.leave_ledger where staff_id=r.staff_id and kind=r.kind;
   if not pol.allow_negative and bal<r.hours then raise exception 'Insufficient leave balance';end if;
   if exists(select 1 from workforce.leave_requests x where x.staff_id=r.staff_id and x.status='APPROVED' and x.starts_on<=r.ends_on and x.ends_on>=r.starts_on)then raise exception 'Overlapping approved leave; review the dates';end if;
   insert into workforce.leave_ledger(staff_id,kind,hours,source_key,note,actor)values(r.staff_id,r.kind,-r.hours,'leave:'||r.id,'Approved leave',a);
  elsif k='CANCELLED' and r.status='APPROVED' then
   insert into workforce.leave_ledger(staff_id,kind,hours,source_key,note,actor)values(r.staff_id,r.kind,r.hours,'cancel:'||r.id,'Cancelled leave',a);
  end if;
  if exists(select 1 from workforce.periods where state='CLOSED' and starts_on<=r.ends_on and ends_on>=r.starts_on)then raise exception 'Leave belongs to a finalized period; record an adjustment';end if;
  update workforce.leave_requests set status=k,version=version+1,decided_by=a where id=r.id;
 when 'shift' then
  perform workforce.require_manager();s:=(p_data->>'staff_id')::uuid;st:=(p_data->>'starts_at')::timestamptz;en:=(p_data->>'ends_at')::timestamptz;
  if exists(select 1 from workforce.shifts where staff_id=s and not cancelled and starts_at<en and ends_at>st)then raise exception 'Overlapping staff shift';end if;
  insert into workforce.shifts(id,staff_id,starts_at,ends_at,note,created_by)values(p_id,s,st,en,coalesce(p_data->>'note',''),a);
 when 'cancel_shift' then
  perform workforce.require_manager();update workforce.shifts set cancelled=true,version=version+1 where id=p_id and version=(p_data->>'version')::integer and not cancelled;
  if not found then raise exception 'Shift changed; refresh' using errcode='PT409';end if;
 when 'holiday' then
  perform workforce.require_manager();insert into workforce.holidays(day,label,closed,paid_hours,updated_by)values((p_data->>'day')::date,p_data->>'label',(p_data->>'closed')::boolean,(p_data->>'paid_hours')::numeric,a)
  on conflict(day)do update set label=excluded.label,closed=excluded.closed,paid_hours=excluded.paid_hours,updated_by=a;
 when 'period' then
  perform workforce.require_manager();f:=(p_data->>'starts_on')::date;t:=(p_data->>'ends_on')::date;
  if exists(select 1 from workforce.periods where starts_on<=t and ends_on>=f)then raise exception 'Pay periods cannot overlap';end if;
  insert into workforce.periods(id,starts_on,ends_on,created_by)values(p_id,f,t,a);
 when 'submit_time' then
  select * into per from workforce.periods where id=p_id;
  if per.id is null or per.state<>'OPEN' then raise exception 'Open pay period required';end if;
  if exists(select 1 from public.time_entries where staff_id=a and clock_out_at is null and clock_in_at<((per.ends_on+1)::timestamp at time zone 'America/Denver'))then raise exception 'Clock out before submitting';end if;
  fp:=workforce.time_fingerprint(a,per.starts_on,per.ends_on);
  insert into workforce.time_approvals(period_id,staff_id,fingerprint)values(p_id,a,fp)
  on conflict(period_id,staff_id)do update set submitted_at=now(),fingerprint=fp,approved_by=null,approved_at=null;
 when 'approve_time' then
  perform workforce.require_manager();s:=(p_data->>'staff_id')::uuid;select * into per from workforce.periods where id=p_id;
  if per.state<>'OPEN' then raise exception 'Open pay period required';end if;
  update workforce.time_approvals set approved_by=a,approved_at=now()where period_id=p_id and staff_id=s and fingerprint=workforce.time_fingerprint(s,per.starts_on,per.ends_on);
  if not found then raise exception 'Time changed or was not submitted; ask employee to resubmit' using errcode='PT409';end if;
 when 'close_period' then
  perform workforce.require_manager();select * into per from workforce.periods where id=p_id for update;
  if per.id is null or per.state<>'OPEN' or per.ends_on>=(now()at time zone'America/Denver')::date then raise exception 'Only ended open periods can close';end if;
  if exists(select 1 from public.time_entries e where e.clock_in_at<((per.ends_on+1)::timestamp at time zone 'America/Denver')and coalesce(e.clock_out_at,'infinity')>(per.starts_on::timestamp at time zone 'America/Denver')and(e.clock_out_at is null or not exists(select 1 from workforce.time_approvals x where x.period_id=p_id and x.staff_id=e.staff_id and x.approved_at is not null and x.fingerprint=workforce.time_fingerprint(e.staff_id,per.starts_on,per.ends_on))))then raise exception 'All worked time must be current and approved';end if;
  if exists(select 1 from workforce.clock_flags f join public.time_entries e on e.id=f.entry_id where f.reviewed_at is null and e.clock_in_at<((per.ends_on+1)::timestamp at time zone 'America/Denver')and e.clock_out_at>(per.starts_on::timestamp at time zone 'America/Denver'))then raise exception 'Review estimated clock-outs before closing';end if;
  if exists(select 1 from workforce.corrections where status='PENDING'and starts_at<((per.ends_on+1)::timestamp at time zone'America/Denver')and ends_at>(per.starts_on::timestamp at time zone'America/Denver'))then raise exception 'Review pending time corrections before finalizing';end if;
  if exists(select 1 from workforce.leave_requests where status='PENDING'and starts_on<=per.ends_on and ends_on>=per.starts_on)then raise exception 'Review pending leave before finalizing';end if;
  if exists(select 1 from workforce.leave_requests where status='APPROVED'and starts_on<=per.ends_on and ends_on>=per.starts_on and not(starts_on>=per.starts_on and ends_on<=per.ends_on))then raise exception 'Split leave across pay periods before finalizing';end if;
  update workforce.periods set state='CLOSED',version=version+1,closed_by=a,closed_at=now()where id=p_id;
 when 'correction' then
  insert into workforce.corrections(id,staff_id,entry_id,starts_at,ends_at,reason)values(p_id,a,(p_data->>'entry_id')::uuid,(p_data->>'starts_at')::timestamptz,(p_data->>'ends_at')::timestamptz,p_data->>'reason');
  update workforce.corrections set expected_entry=(select to_jsonb(e)from public.time_entries e where e.id=(p_data->>'entry_id')::uuid)where id=p_id;
  if (p_data->>'entry_id')is not null and not exists(select 1 from public.time_entries where id=(p_data->>'entry_id')::uuid and staff_id=a)then raise exception 'Entry does not belong to you' using errcode='42501';end if;
 when 'resolve_correction' then
  perform workforce.require_manager();select * into c from workforce.corrections where id=p_id for update;
  if c.id is null or c.status<>'PENDING'then raise exception 'Pending correction required';end if;
  k:=p_data->>'decision';if k not in('APPROVED','DENIED')then raise exception 'Invalid decision';end if;
  if k='APPROVED'then
   perform workforce.require_open_interval(c.starts_at,c.ends_at);
   if c.ends_at>now()then raise exception 'Worked time cannot be in the future';end if;
   if exists(select 1 from public.time_entries where staff_id=c.staff_id and id is distinct from c.entry_id and clock_in_at<c.ends_at and coalesce(clock_out_at,'infinity')>c.starts_at)then raise exception 'Correction overlaps another time entry';end if;
   if c.entry_id is null then
    insert into public.time_entries(staff_id,clock_in_at,clock_out_at,note)values(c.staff_id,c.starts_at,c.ends_at,c.reason);
   else
    select * into saved_entry from public.time_entries where id=c.entry_id for update;
    perform workforce.require_open_interval(saved_entry.clock_in_at,saved_entry.clock_out_at);
    if to_jsonb(saved_entry)is distinct from c.expected_entry then raise exception 'Original time changed; resubmit the correction' using errcode='PT409';end if;
    if saved_entry.clock_out_at is null then raise exception 'Clock out before correcting this shift';end if;
    -- Staff resubmits time after any correction; the period fingerprint invalidates old approval.
    update public.time_entries set clock_in_at=c.starts_at,clock_out_at=c.ends_at,note=c.reason where id=c.entry_id;
   end if;
  end if;
  update workforce.corrections set status=k,decided_by=a where id=p_id;
 when 'review_clock' then
  perform workforce.require_manager();update workforce.clock_flags set reviewed_by=a,reviewed_at=now()where entry_id=p_id and reviewed_at is null;
  if not found then raise exception 'Unreviewed clock flag required';end if;
 else raise exception 'Unknown workforce action';end case;
 if created_action then insert into workforce.mutation_receipts values('workforce',p_action,p_id,a,md5(p_data::text));end if;
 insert into workforce.audit(actor,action,subject)values(a,p_action,p_id);
 return jsonb_build_object('id',p_id,'action',p_action);
end$$;

-- Cron calls private SQL jobs; no public unauthenticated worker endpoint.
create function workforce.run_jobs(p_through date default(current_timestamp at time zone 'America/Denver')::date)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r record; month date; amount numeric; balance numeric; n integer:=0; closed integer:=0; cfg workforce.settings;monthly_policy workforce.leave_policies;
begin
 -- Lock profiles first, matching manual clock writers, before the common workforce lock.
 perform 1 from public.profiles p order by p.id for update;
 perform pg_advisory_xact_lock(hashtextextended('workforce-time',0));
 if p_through is null or p_through>(now()at time zone'America/Denver')::date then raise exception 'Accrual cannot run ahead of today';end if;
 select * into cfg from workforce.settings;
 for r in select x.* from workforce.leave_accounts x join public.profiles s on s.id=x.staff_id and s.is_active loop
  -- Full-month accrual only; opening balance handles any earlier/prorated entitlement.
  for month in select d::date from generate_series(date_trunc('month',r.enrolled_on)::date,date_trunc('month',p_through)::date,interval'1 month')d loop
   if month<r.enrolled_on or month+interval'1 month'>p_through+1 then continue;end if;
   select * into monthly_policy from workforce.leave_policy_history where kind=r.kind and effective_from<=month order by effective_from desc limit 1;
   if monthly_policy.kind is null then continue;end if;
   if exists(select 1 from workforce.leave_ledger where source_key='accrual:'||r.staff_id||':'||month||':'||r.kind)or exists(select 1 from workforce.job_receipts where source_key='accrual:'||r.staff_id||':'||month||':'||r.kind)then continue;end if;
   select coalesce(sum(hours),0)into balance from workforce.leave_ledger where staff_id=r.staff_id and kind=r.kind;
   amount:=greatest(0,least(monthly_policy.monthly_hours,coalesce(monthly_policy.cap_hours-balance,monthly_policy.monthly_hours)));
   -- Receipt even when capped: avoids later backfilling a previously capped month after leave use.
   insert into workforce.audit(action,subject,details)values('accrual',r.staff_id,jsonb_build_object('kind',r.kind,'month',month,'hours',amount));
   if amount>0 then insert into workforce.leave_ledger(staff_id,kind,hours,source_key,note)values(r.staff_id,r.kind,amount,'accrual:'||r.staff_id||':'||month||':'||r.kind,'Monthly accrual');n:=n+1;
   else insert into workforce.job_receipts(source_key)values('accrual:'||r.staff_id||':'||month||':'||r.kind)on conflict do nothing;end if;
  end loop;
 end loop;
 if cfg.auto_close_hours is not null then
  for r in select e.* from public.time_entries e where e.clock_out_at is null and e.clock_in_at+cfg.auto_close_hours*interval'1 hour'<=now() for update loop
   update public.time_entries set clock_out_at=r.clock_in_at+cfg.auto_close_hours*interval'1 hour',note=concat_ws(E'\n',note,'Estimated automatic clock-out; employee/manager review required')where id=r.id;
   insert into workforce.clock_flags(entry_id,estimated_at)values(r.id,now());
   update public.profiles set is_on_duty=false where id=r.staff_id;closed:=closed+1;
  end loop;
 end if;
 insert into workforce.job_receipts(source_key)values('heartbeat:'||p_through)on conflict(source_key)do update set ran_at=now();
 return jsonb_build_object('accruals',n,'clock_outs',closed);
end$$;
create table workforce.job_receipts(source_key text primary key,ran_at timestamptz not null default now());
alter table workforce.job_receipts enable row level security;
revoke all on workforce.job_receipts from public,anon,authenticated,service_role;
-- Fix cap receipt lookup without exposing private job state.
create function public.workforce_run_jobs()returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin perform workforce.require_manager();return workforce.run_jobs();end$$;
revoke all on all functions in schema workforce from public,anon,authenticated,service_role;
revoke all on function public.workforce_read(date,date),public.workforce_command(text,uuid,jsonb),public.workforce_run_jobs(),public.workforce_toggle_jobs(boolean)from public,anon,service_role;
grant execute on function public.workforce_read(date,date),public.workforce_command(text,uuid,jsonb),public.workforce_run_jobs(),public.workforce_toggle_jobs(boolean)to authenticated;
-- Jobs remain unconfigured until a manager installs a policy. Invoking daily is harmless with no policies.
do $$begin if exists(select 1 from pg_extension where extname='pg_cron')then
 perform cron.alter_job(cron.schedule('workforce-hourly','7 * * * *','select workforce.run_jobs();'),active:=false);end if;end$$;
commit;
