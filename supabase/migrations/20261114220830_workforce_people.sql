begin;
alter table workforce.periods add column policy_snapshot jsonb,add column time_snapshot jsonb;
create function workforce.capture_period_policy()returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
 if new.state='CLOSED'and old.state='OPEN'then
 new.policy_snapshot:=(select to_jsonb(s)from workforce.settings s);
 new.time_snapshot:=(select coalesce(jsonb_agg(to_jsonb(e)order by e.id),'[]')from public.time_entries e where e.clock_in_at<((new.ends_on+1)::timestamp at time zone'America/Denver')and e.clock_out_at>((new.starts_on-7)::timestamp at time zone'America/Denver'));
 end if;return new;end$$;
create trigger workforce_period_policy before update on workforce.periods for each row execute function workforce.capture_period_policy();
create table workforce.pay_rates(id uuid primary key,staff_id uuid not null references public.profiles(id),effective_on date not null,amount_cents integer not null check(amount_cents>0),basis text not null check(basis in('HOURLY','ANNUAL_SALARY')),reason text not null check(length(reason)between 1 and 1000),created_by uuid not null,created_at timestamptz not null default now(),unique(staff_id,effective_on));
create table workforce.bonuses(id uuid primary key,staff_id uuid not null references public.profiles(id),period_id uuid not null references workforce.periods(id),amount_cents integer not null check(amount_cents>0),reason text not null check(length(reason)between 1 and 1000),created_by uuid not null);
create table workforce.payroll_snapshots(period_id uuid primary key references workforce.periods(id),snapshot jsonb not null,created_by uuid not null,created_at timestamptz not null default now());
create table workforce.benefits(id uuid primary key,staff_id uuid not null references public.profiles(id),title text not null check(length(title)between 1 and 200),provider text not null check(length(provider)between 1 and 150),form_version text not null check(length(form_version)between 1 and 150),form_url text not null check(form_url~'^https://[^[:space:]]+$'and length(form_url)<=2000),due_on date not null,object_path text not null unique,completed_at timestamptz,created_by uuid not null);
create table workforce.review_cycles(id uuid primary key,target_id uuid not null references public.profiles(id),title text not null check(length(title)between 1 and 200),ends_at timestamptz not null,min_responses integer not null check(min_responses between 3 and 100),closed boolean not null default false,created_by uuid not null);
create table workforce.review_eligibility(cycle_id uuid references workforce.review_cycles(id),staff_id uuid references public.profiles(id),submitted boolean not null default false,primary key(cycle_id,staff_id));
-- No author IDs, submission timestamps, ordered sequence or client-provided response identifiers.
create table workforce.review_responses(id uuid primary key default gen_random_uuid(),cycle_id uuid not null references workforce.review_cycles(id),score integer not null check(score between 1 and 5),comment text not null check(length(comment)<=2000));
do $$declare n text;begin foreach n in array array['pay_rates','bonuses','payroll_snapshots','benefits','review_cycles','review_eligibility','review_responses']loop execute format('alter table workforce.%I enable row level security',n);execute format('revoke all on workforce.%I from public,anon,authenticated,service_role',n);end loop;end$$;
create function public.people_read()returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare a uuid:=workforce.actor();m boolean:=workforce.can_manage(a,true);
begin return jsonb_build_object('can_pay',m,
 'staff',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name)order by full_name),'[]')from public.profiles where is_active),
 'rates',(select coalesce(jsonb_agg(to_jsonb(r)order by effective_on desc),'[]')from workforce.pay_rates r where m or r.staff_id=a),
 'bonuses',(select coalesce(jsonb_agg(to_jsonb(b)),'[]')from workforce.bonuses b where m or b.staff_id=a),
 'benefits',(select coalesce(jsonb_agg(to_jsonb(b)order by due_on),'[]')from workforce.benefits b where m or b.staff_id=a),
 'periods',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'starts_on',p.starts_on,'ends_on',p.ends_on,'state',p.state,'exported',exists(select 1 from workforce.payroll_snapshots x where x.period_id=p.id))order by p.starts_on desc),'[]')from workforce.periods p),
 'cycles',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'target_id',c.target_id,'title',c.title,'ends_at',c.ends_at,'closed',c.closed,'min_responses',c.min_responses,'submitted',exists(select 1 from workforce.review_eligibility e where e.cycle_id=c.id and e.staff_id=a and e.submitted),'eligible',exists(select 1 from workforce.review_eligibility e where e.cycle_id=c.id and e.staff_id=a))),'[]')from workforce.review_cycles c where m or exists(select 1 from workforce.review_eligibility e where e.cycle_id=c.id and e.staff_id=a)),
 'results',case when m then(select coalesce(jsonb_agg(jsonb_build_object('cycle_id',c.id,'count',q.n,'average',case when q.n>=c.min_responses then q.average end,'comments',case when q.n>=c.min_responses then q.comments else '[]'::jsonb end)),'[]')from workforce.review_cycles c cross join lateral(select count(*)n,round(avg(score),2)average,coalesce(jsonb_agg(comment order by id),'[]')comments from workforce.review_responses r where r.cycle_id=c.id)q where c.closed)else '[]'::jsonb end
 );end$$;
create function workforce.payroll_detail(p_id uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare p workforce.periods;week_start date;cfg jsonb;result jsonb;
begin
 select * into p from workforce.periods where id=p_id;
 if p.id is null or p.state<>'CLOSED'then raise exception 'Finalize approved time before creating payroll summary';end if;
 cfg:=p.policy_snapshot;
 if cfg->>'workweek_start'is null or cfg->>'weekly_hours'is null then raise exception 'Attendance rules were not configured when this period closed';end if;
 week_start:=p.starts_on-((extract(dow from p.starts_on)::integer-(cfg->>'workweek_start')::integer+7)%7);
 with daily as(
 select e.staff_id,d::date as work_day,sum(extract(epoch from least(e.clock_out_at,(d::date+1)::timestamp at time zone'America/Denver')-greatest(e.clock_in_at,d::date::timestamp at time zone'America/Denver'))/3600)hours
 from jsonb_to_recordset(p.time_snapshot)as e(id uuid,staff_id uuid,clock_in_at timestamptz,clock_out_at timestamptz,note text) cross join lateral generate_series((greatest(e.clock_in_at,week_start::timestamp at time zone'America/Denver')at time zone'America/Denver')::date,(least(e.clock_out_at,((p.ends_on+1)::timestamp at time zone'America/Denver')-interval'1 microsecond')at time zone'America/Denver')::date,interval'1 day')d
 where e.clock_out_at is not null and e.clock_in_at<((p.ends_on+1)::timestamp at time zone'America/Denver')and e.clock_out_at>(week_start::timestamp at time zone'America/Denver')group by e.staff_id,d::date
 ),split as(select *,greatest(0,hours-coalesce((cfg->>'daily_hours')::numeric,hours))daily_ot,work_day-((extract(dow from work_day)::integer-(cfg->>'workweek_start')::integer+7)%7)week from daily),running as(
 select *,coalesce(sum(hours-daily_ot)over(partition by staff_id,week order by work_day rows between unbounded preceding and 1 preceding),0)prior from split
 ),lines as(select staff_id,work_day as "day",hours,least(hours-daily_ot,greatest(0,(cfg->>'weekly_hours')::numeric-prior))regular_hours,daily_ot+greatest(0,hours-daily_ot-greatest(0,(cfg->>'weekly_hours')::numeric-prior))overtime_hours from running where work_day between p.starts_on and p.ends_on)
 select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('rate',(select to_jsonb(r)-'created_by'from workforce.pay_rates r where r.staff_id=l.staff_id and r.effective_on<=l.day order by r.effective_on desc limit 1))order by l.staff_id,l.day),'[]')into result from lines l;
 return jsonb_build_object('period',to_jsonb(p)-'time_snapshot','staff',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name)),'[]')from public.profiles),'time',result,'leave',(select coalesce(jsonb_agg(jsonb_build_object('staff_id',staff_id,'kind',kind,'hours',hours,'starts_on',starts_on,'ends_on',ends_on)),'[]')from workforce.leave_requests where status='APPROVED'and starts_on>=p.starts_on and ends_on<=p.ends_on),
 'bonuses',(select coalesce(jsonb_agg(to_jsonb(b)-'created_by'),'[]')from workforce.bonuses b where b.period_id=p_id),'generated_at',now());
end$$;
create function public.people_command(p_action text,p_id uuid,p_data jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a uuid:=workforce.actor();c workforce.review_cycles;s uuid;b workforce.benefits;snapshot jsonb;ids uuid[];prior workforce.mutation_receipts;created_action boolean:=p_action=any(array['rate','bonus','benefit','review_cycle']);
begin
 if p_id is null or jsonb_typeof(p_data)<>'object'or length(p_data::text)>15000 then raise exception 'Invalid request';end if;
 perform 1 from public.profiles order by id for update;
 perform pg_advisory_xact_lock(hashtextextended('workforce-time',0));
 if created_action then
  perform workforce.require_manager(true);
  select * into prior from workforce.mutation_receipts where area='people'and action=p_action and id=p_id;
  if found then
   if prior.actor<>a or prior.payload_hash<>md5(p_data::text)then raise exception 'Request was already used; refresh saved records before starting a new request'using errcode='PT409';end if;
   return jsonb_build_object('id',p_id,'action',p_action);
  end if;
 end if;
 case p_action
 when 'rate' then
  perform workforce.require_manager(true);
  insert into workforce.pay_rates(id,staff_id,effective_on,amount_cents,basis,reason,created_by)values(p_id,(p_data->>'staff_id')::uuid,(p_data->>'effective_on')::date,(p_data->>'amount_cents')::integer,p_data->>'basis',p_data->>'reason',a);
 when 'bonus' then
  perform workforce.require_manager(true);
  if exists(select 1 from workforce.payroll_snapshots where period_id=(p_data->>'period_id')::uuid)then raise exception 'Payroll export is frozen; record bonus in a new period';end if;
  insert into workforce.bonuses(id,staff_id,period_id,amount_cents,reason,created_by)values(p_id,(p_data->>'staff_id')::uuid,(p_data->>'period_id')::uuid,(p_data->>'amount_cents')::integer,p_data->>'reason',a);
 when 'payroll' then
  perform workforce.require_manager(true);select p.snapshot into snapshot from workforce.payroll_snapshots p where p.period_id=p_id;
  if snapshot is null then
   snapshot:=workforce.payroll_detail(p_id);
   if exists(select 1 from jsonb_array_elements(snapshot->'time')l where l->'rate'='null'::jsonb)then raise exception 'Add effective pay rates for every worked day before exporting';end if;
   if exists(select 1 from workforce.leave_requests r join workforce.periods p on p.id=p_id where r.status='APPROVED'and r.starts_on<=p.ends_on and r.ends_on>=p.starts_on and not(r.starts_on>=p.starts_on and r.ends_on<=p.ends_on))then raise exception 'Split leave crossing pay periods before exporting';end if;
   insert into workforce.payroll_snapshots(period_id,snapshot,created_by)values(p_id,snapshot,a);
  end if;
  return jsonb_build_object('id',p_id,'action',p_action,'snapshot',snapshot);
 when 'benefit' then
  perform workforce.require_manager(true);s:=(p_data->>'staff_id')::uuid;
  insert into workforce.benefits(id,staff_id,title,provider,form_version,form_url,due_on,object_path,created_by)values(p_id,s,p_data->>'title',p_data->>'provider',p_data->>'form_version',p_data->>'form_url',(p_data->>'due_on')::date,s||'/'||p_id||'.pdf',a);
 when 'complete_benefit' then
  select * into b from workforce.benefits where id=p_id for update;
  if b.staff_id is distinct from a then perform workforce.require_manager(true);end if;
  if not exists(select 1 from storage.objects where bucket_id='staff-benefits'and name=b.object_path)then raise exception 'Upload the completed PDF first';end if;
  update workforce.benefits set completed_at=now()where id=p_id;
 when 'review_cycle' then
  perform workforce.require_manager(true);select array_agg(value::uuid)into ids from jsonb_array_elements_text(p_data->'reviewers');
  s:=(p_data->>'target_id')::uuid;
  if ids is null or cardinality(ids)<(p_data->>'min_responses')::integer or s=any(ids)or cardinality(ids)<>(select count(distinct x)from unnest(ids)x)then raise exception 'Choose enough distinct reviewers excluding the subject';end if;
  if exists(select 1 from unnest(ids)x where not public.is_active_staff(x))then raise exception 'Only active staff may review';end if;
  insert into workforce.review_cycles(id,target_id,title,ends_at,min_responses,created_by)values(p_id,s,p_data->>'title',(p_data->>'ends_at')::timestamptz,(p_data->>'min_responses')::integer,a);
  insert into workforce.review_eligibility(cycle_id,staff_id)select p_id,x from unnest(ids)x;
 when 'submit_review' then
  select * into c from workforce.review_cycles where id=p_id for update;
  if c.id is null or c.closed or c.ends_at<now()then raise exception 'Review cycle is closed';end if;
  update workforce.review_eligibility set submitted=true where cycle_id=p_id and staff_id=a and not submitted;
  if not found then raise exception 'Already submitted or not eligible';end if;
  insert into workforce.review_responses(cycle_id,score,comment)values(p_id,(p_data->>'score')::integer,coalesce(p_data->>'comment',''));
  -- Intentionally no actor/response audit link. Eligibility and response content remain separate.
  return jsonb_build_object('id',p_id,'action',p_action);
 when 'close_review' then
  perform workforce.require_manager(true);update workforce.review_cycles set closed=true where id=p_id and ends_at<=now()and not closed;
  if not found then raise exception 'Only ended open review cycles can close';end if;
 else raise exception 'Unknown people action';end case;
 if created_action then insert into workforce.mutation_receipts values('people',p_action,p_id,a,md5(p_data::text));end if;
 insert into workforce.audit(actor,action,subject)values(a,'people:'||p_action,p_id);
 return jsonb_build_object('id',p_id,'action',p_action);
end$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)values('staff-benefits','staff-benefits',false,10485760,array['application/pdf']);
create function public.workforce_document_access(p_path text,p_write boolean default false)returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select auth.uid()is not null and public.is_active_staff(auth.uid())and exists(select 1 from workforce.benefits b where b.object_path=p_path and(b.staff_id=auth.uid()or workforce.can_manage(auth.uid(),true))and(not p_write or b.completed_at is null))
$$;
create policy workforce_benefit_read on storage.objects for select to authenticated using(bucket_id='staff-benefits'and public.workforce_document_access(name));
create policy workforce_benefit_upload on storage.objects for insert to authenticated with check(bucket_id='staff-benefits'and public.workforce_document_access(name,true));
-- Restrictive boundaries preserve HR privacy even if another feature later adds a broad policy.
create policy workforce_benefit_read_boundary on storage.objects as restrictive for select to authenticated using(bucket_id<>'staff-benefits'or public.workforce_document_access(name));
create policy workforce_benefit_insert_boundary on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'staff-benefits'or public.workforce_document_access(name,true));
create policy workforce_benefit_update_boundary on storage.objects as restrictive for update to authenticated using(bucket_id<>'staff-benefits')with check(bucket_id<>'staff-benefits');
create policy workforce_benefit_delete_boundary on storage.objects as restrictive for delete to authenticated using(bucket_id<>'staff-benefits');
create policy workforce_benefit_anon_boundary on storage.objects as restrictive for all to anon using(bucket_id<>'staff-benefits')with check(bucket_id<>'staff-benefits');
-- No update/delete policy: uploaded benefits documents are immutable.
revoke all on function workforce.capture_period_policy(),workforce.payroll_detail(uuid)from public,anon,authenticated,service_role;
revoke all on function public.people_read(),public.people_command(text,uuid,jsonb),public.workforce_document_access(text,boolean)from public,anon,service_role;
grant execute on function public.people_read(),public.people_command(text,uuid,jsonb),public.workforce_document_access(text,boolean)to authenticated;
commit;
