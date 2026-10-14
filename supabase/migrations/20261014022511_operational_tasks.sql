-- Reviewed operational work. Empty/off by default; no cron, clinical defaults or stock writes.
create table public.operational_task_templates(
 id uuid primary key,version integer not null check(version>0),current_version_id uuid not null,published_version_id uuid,
 created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default clock_timestamp()
);
create table public.operational_task_template_versions(
 id uuid primary key,template_id uuid not null references public.operational_task_templates(id) deferrable initially deferred,
 version integer not null check(version>0),state text not null check(state in('draft','published','retired')),
 definition jsonb not null check(jsonb_typeof(definition)='object'),review_note text not null check(length(review_note) between 1 and 2000),
 actor_id uuid not null references auth.users(id),recorded_at timestamptz not null default clock_timestamp(),unique(template_id,version),unique(id,template_id)
);
alter table public.operational_task_templates add foreign key(current_version_id,id) references public.operational_task_template_versions(id,template_id) deferrable initially deferred;
alter table public.operational_task_templates add foreign key(published_version_id,id) references public.operational_task_template_versions(id,template_id) deferrable initially deferred;
create table public.operational_resource_uses(
 id uuid primary key,appointment_id uuid not null references public.appointments(id),resource_id uuid not null references public.appointment_catalog_entries(id),
 version integer not null check(version>0),head_id uuid not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp()
);
create table public.operational_resource_use_events(
 id uuid primary key,use_id uuid not null references public.operational_resource_uses(id) deferrable initially deferred,version integer not null check(version>0),
 action text not null check(action in('start','end','correct')),facts jsonb not null check(jsonb_typeof(facts)='object'),
 actor_id uuid not null references auth.users(id),recorded_at timestamptz not null default clock_timestamp(),unique(use_id,version),unique(id,use_id)
);
alter table public.operational_resource_uses add foreign key(head_id,id) references public.operational_resource_use_events(id,use_id) deferrable initially deferred;
create index operational_use_appointment on public.operational_resource_uses(appointment_id,id);
create index operational_use_resource on public.operational_resource_uses(resource_id,id);
create table public.operational_task_enrollments(
 id uuid primary key,template_id uuid not null references public.operational_task_templates(id),template_version_id uuid not null references public.operational_task_template_versions(id),
 definition jsonb not null,source_snapshot jsonb not null,recorded_at timestamptz not null default clock_timestamp()
);
create table public.operational_tasks(
 id uuid primary key,enrollment_id uuid not null references public.operational_task_enrollments(id),template_id uuid not null references public.operational_task_templates(id),
 resource_id uuid not null references public.appointment_catalog_entries(id),source_key text not null check(length(source_key) between 1 and 200),
 appointment_id uuid references public.appointments(id),use_id uuid references public.operational_resource_uses(id),day_key date,batch integer,
 version integer not null check(version>0),head_id uuid not null,created_at timestamptz not null default clock_timestamp(),
 unique(template_id,resource_id,source_key),check((day_key is null)=(batch is null)),check(batch is null or batch>=0)
);
create table public.operational_task_revisions(
 id uuid primary key,task_id uuid not null references public.operational_tasks(id) deferrable initially deferred,enrollment_id uuid not null references public.operational_task_enrollments(id),version integer not null check(version>0),
 event text not null,state text not null check(state in('pending','started','blocked','needs_review','completed','superseded')),
 due_at timestamptz,assignee_id uuid references public.profiles(id),checked_ids uuid[] not null default '{}',note text not null,
 source_snapshot jsonb not null,actor_id uuid references auth.users(id),recorded_at timestamptz not null default clock_timestamp(),
 unique(task_id,version),unique(id,task_id,enrollment_id),check(due_at is not null or state in('needs_review','superseded'))
);
alter table public.operational_tasks add foreign key(head_id,id,enrollment_id) references public.operational_task_revisions(id,task_id,enrollment_id) deferrable initially deferred;
create index operational_tasks_appointment on public.operational_tasks(appointment_id,id);
create index operational_tasks_use on public.operational_tasks(use_id,id);
create index operational_tasks_day on public.operational_tasks(day_key,resource_id,batch);
create table public.operational_task_use_coverage(
 template_id uuid not null references public.operational_task_templates(id),use_id uuid not null references public.operational_resource_uses(id),
 use_version integer not null check(use_version>0),task_id uuid not null references public.operational_tasks(id),recorded_at timestamptz not null default clock_timestamp(),
 primary key(template_id,use_id,use_version)
);
create table public.operational_task_generation_policy(
 version integer primary key check(version>0),enabled boolean not null,effective_from timestamptz,effective_until timestamptz,
 review_note text not null,actor_id uuid not null references auth.users(id),recorded_at timestamptz not null default clock_timestamp(),
 check(not enabled or (effective_from is not null and effective_until>effective_from and effective_until<=effective_from+interval '366 days'))
);
create table public.operational_task_actions(
 id uuid primary key,actor_id uuid not null references auth.users(id),session_id uuid not null,operation text not null check(operation in('template','use','task','policy')),
 request jsonb not null,receipt jsonb not null,recorded_at timestamptz not null default clock_timestamp()
);
create table public.operational_task_reviews(
 id uuid primary key,actor_id uuid not null references auth.users(id),session_id uuid not null,operation text not null check(operation in('template','use','task','policy')),
 request jsonb not null check(jsonb_typeof(request)='object' and octet_length(request::text)<=65536),
 prepared_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default(clock_timestamp()+interval '24 hours'),check(expires_at>prepared_at)
);
create index operational_task_reviews_actor on public.operational_task_reviews(actor_id,expires_at);
create table public.operational_task_review_cancellations(
 id uuid primary key,actor_id uuid not null references auth.users(id),recorded_at timestamptz not null default clock_timestamp()
);
do $$declare t text;begin
 foreach t in array array['operational_task_templates','operational_task_template_versions','operational_resource_uses','operational_resource_use_events','operational_task_enrollments','operational_tasks','operational_task_revisions','operational_task_use_coverage','operational_task_generation_policy','operational_task_actions','operational_task_reviews','operational_task_review_cancellations'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger operational_audit after insert or update on public.%I for each row execute function public.appointment_catalog_audit()',t);
  if t not in('operational_task_templates','operational_resource_uses','operational_tasks') then execute format('create trigger operational_immutable before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);end if;
 end loop;
end $$;

create function public.operational_actor(p_actor uuid default null,p_reviewer boolean default false) returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();begin
 perform public.next_visit_review_session();
 if p_actor is not null and actor is distinct from p_actor then raise exception 'Matched current operational actor required' using errcode='42501';end if;
 if p_reviewer and not exists(select 1 from user_roles where user_id=actor and role in('DVM','ADMIN')) then raise exception 'Active veterinarian or administrator required' using errcode='42501';end if;return actor;
end $$;
create function public.operational_eligible(p_actor uuid,p_definition jsonb) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from profiles where id=p_actor and is_active) and exists(select 1 from user_roles where user_id=p_actor and p_definition->'eligible_roles' @> to_jsonb(array[role::text]))
$$;
create function public.operational_validate_definition(d jsonb,p_current boolean default false) returns void language plpgsql security definer set search_path=public as $$
declare x jsonb;k text;roles text[];ids uuid[];entry uuid;v uuid;begin
 perform public.native_rx_keys(d,array['name','category','trigger','selectors','due','eligible_roles','assignment','assignee_id','checklist','sop_reference']);
 perform public.native_rx_text(d->'name',150);perform public.native_rx_text(d->'sop_reference',2000);
 if d->>'category' is null or d->>'trigger' is null or (d->>'category',d->>'trigger') not in(('turnover','after_use'),('preparation','before_visit'),('restock','resource_day'),('housecall','before_departure')) then raise exception 'Explicit operational category/trigger required' using errcode='23514';end if;
 perform public.native_rx_keys(d->'selectors',array['types','resources']);
 foreach k in array array['types','resources'] loop
  if jsonb_typeof(d#>array['selectors',k]) is distinct from 'array' or jsonb_array_length(d#>array['selectors',k])>100 or (k='resources' and jsonb_array_length(d#>array['selectors',k])=0) or (k='types' and d->>'trigger' in('before_visit','before_departure') and jsonb_array_length(d#>array['selectors',k])=0) then raise exception 'Bounded explicit type/resource selections required' using errcode='23514';end if;
  ids:='{}';for x in select value from jsonb_array_elements(d#>array['selectors',k]) loop
   perform public.native_rx_keys(x,array['entry_id','version_id']);entry:=public.native_rx_uuid(x->'entry_id');v:=public.native_rx_uuid(x->'version_id');
   if entry=any(ids) or not exists(select 1 from appointment_catalog_versions cv join appointment_catalog_entries ce on ce.id=cv.entry_id where cv.id=v and cv.entry_id=entry and cv.state='published' and ce.kind=case k when 'types' then 'type' else 'resource' end and (not p_current or ce.published_version_id=cv.id)) then raise exception 'Distinct reviewed catalog selection required' using errcode='23514';end if;ids:=array_append(ids,entry);
  end loop;
 end loop;
 perform public.native_rx_keys(d->'due',array['offset_minutes','local_time','dst_resolution']);perform public.appointment_catalog_integer(d#>'{due,offset_minutes}',0,1440);
 if d#>>'{due,dst_resolution}' is null or d#>>'{due,dst_resolution}' not in('reject','earlier','later') then raise exception 'Reviewed daylight-saving resolution required' using errcode='23514';end if;
 if d->>'trigger'='resource_day' then
  if jsonb_typeof(d#>'{due,local_time}') is distinct from 'string' or d#>>'{due,local_time}' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or d#>'{due,offset_minutes}'<>'0'::jsonb then raise exception 'Explicit local restock time required' using errcode='23514';end if;
 elsif d#>'{due,local_time}' is distinct from 'null'::jsonb then raise exception 'Relative tasks use an explicit minute offset' using errcode='23514';end if;
 roles:=public.appointment_catalog_strings(d->'eligible_roles',1,4,10);if not roles<@array['STAFF','TECH','DVM','ADMIN'] then raise exception 'Eligible practice roles required' using errcode='23514';end if;
 if d->>'assignment' is null or d->>'assignment' not in('unassigned','named') or (d->>'assignment'='unassigned' and d->'assignee_id' is distinct from 'null'::jsonb) then raise exception 'Exact assignment rule required' using errcode='23514';end if;
 if p_current and d->>'assignment'='named' and not public.operational_eligible(public.native_rx_uuid(d->'assignee_id'),d) then raise exception 'Active eligible assignee required' using errcode='23514';end if;
 if jsonb_typeof(d->'checklist') is distinct from 'array' or jsonb_array_length(d->'checklist') not between 1 and 50 then raise exception 'Bounded approved checklist required' using errcode='23514';end if;
 ids:='{}';for x in select value from jsonb_array_elements(d->'checklist') loop
  perform public.native_rx_keys(x,array['id','label','required']);entry:=public.native_rx_uuid(x->'id');perform public.native_rx_text(x->'label',1000);
  if entry=any(ids) or jsonb_typeof(x->'required') is distinct from 'boolean' then raise exception 'Distinct checklist IDs and required flags required' using errcode='23514';end if;ids:=array_append(ids,entry);
 end loop;
end $$;
create function public.operational_template_view(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',t.id,'version',t.version,'current',to_jsonb(v),'published',to_jsonb(p),'reviewer_name',(select full_name from profiles where id=v.actor_id),'published_reviewer_name',(select full_name from profiles where id=p.actor_id)) from operational_task_templates t join operational_task_template_versions v on v.id=t.current_version_id left join operational_task_template_versions p on p.id=t.published_version_id where t.id=p_id
$$;
create function public.list_operational_templates(p_after uuid default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;begin perform public.operational_actor();if p_limit is null or p_limit not between 1 and 100 then raise exception 'Bounded page required' using errcode='23514';end if;
 with candidates as materialized(select id from operational_task_templates where p_after is null or id>p_after order by id limit p_limit+1),page as materialized(select id from candidates order by id limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(public.operational_template_view(id) order by id) from page),'[]'),'next',case when(select count(*) from candidates)>p_limit then(select id from page order by id desc limit 1) end) into result;return result;
end $$;
create function public.operational_use_view(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',u.id,'appointment_id',u.appointment_id,'resource_id',u.resource_id,'version',u.version,'current',to_jsonb(e),'actor_name',(select full_name from profiles where id=e.actor_id),'resource_name',(select definition->>'name' from appointment_catalog_versions where id=(e.facts->>'resource_version_id')::uuid)) from operational_resource_uses u join operational_resource_use_events e on e.id=u.head_id where u.id=p_id
$$;
create function public.operational_task_context(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('appointment',case when a.id is null then null else jsonb_build_object('id',a.id,'version',a.version,'status',a.status,'scheduled_at',a.scheduled_at,'visit_type',a.visit_type,'travel_before_minutes',a.travel_before_minutes,'binding',(select snapshot from appointment_catalog_bindings where appointment_id=a.id and appointment_version<=a.version order by appointment_version desc limit 1)) end,'appointment_uses',coalesce((select jsonb_agg(public.operational_use_view(recorded.id) order by recorded.id) from operational_resource_uses recorded where recorded.appointment_id=a.id),'[]'),'use',public.operational_use_view(t.use_id),'coverage',coalesce((select jsonb_agg(jsonb_build_object('use_id',c.use_id,'covered_version',c.use_version,'current',public.operational_use_view(c.use_id)) order by c.use_id,c.use_version) from operational_task_use_coverage c where c.task_id=t.id),'[]'))
 from operational_tasks t left join operational_resource_uses used_source on used_source.id=t.use_id left join appointments a on a.id=coalesce(t.appointment_id,used_source.appointment_id) where t.id=p_id
$$;
create function public.operational_task_view(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',t.id,'version',t.version,'template_id',t.template_id,'resource_id',t.resource_id,'source_key',t.source_key,'appointment_id',t.appointment_id,'use_id',t.use_id,'day_key',t.day_key,'batch',t.batch,'enrollment',to_jsonb(e),'current',to_jsonb(r),'actor_name',(select full_name from profiles where id=r.actor_id),'assignee_name',(select full_name from profiles where id=r.assignee_id),'assignee_eligible',case when r.assignee_id is null then null else public.operational_eligible(r.assignee_id,e.definition) end,'resource_name',(select definition->>'name' from appointment_catalog_versions where entry_id=t.resource_id and state='published' order by version desc limit 1),'context',public.operational_task_context(t.id),'context_hash',md5(public.operational_task_context(t.id)::text))
 from operational_tasks t join operational_task_enrollments e on e.id=t.enrollment_id join operational_task_revisions r on r.id=t.head_id where t.id=p_id
$$;
create function public.operational_due(d jsonb,anchor timestamptz) returns timestamptz language plpgsql stable set search_path=public as $$
declare local_at timestamp;base timestamptz;candidates timestamptz[];begin
 if d->>'trigger'<>'resource_day' then return anchor+make_interval(mins=>case when d->>'trigger' in('before_visit','before_departure') then -(d#>>'{due,offset_minutes}')::integer else (d#>>'{due,offset_minutes}')::integer end);end if;
 local_at:=((anchor at time zone 'America/Denver')::date::text||'T'||(d#>>'{due,local_time}'))::timestamp;base:=local_at at time zone 'America/Denver';
 select array_agg(candidate order by candidate) into candidates from (select distinct base+make_interval(mins=>n) candidate from unnest(array[-120,-60,0,60,120])n) c where candidate at time zone 'America/Denver'=local_at;
 if coalesce(cardinality(candidates),0)=0 or (cardinality(candidates)>1 and d#>>'{due,dst_resolution}'='reject') then raise exception 'Local due time needs daylight-saving review' using errcode='23514';end if;
 return case when d#>>'{due,dst_resolution}'='later' then candidates[cardinality(candidates)] else candidates[1] end;
end $$;
create function public.operational_revision(p_task uuid,p_event text,p_state text,p_due timestamptz,p_assignee uuid,p_checked uuid[],p_note text,p_source jsonb) returns void language plpgsql security definer set search_path=public as $$
declare t operational_tasks;r operational_task_revisions;rid uuid:=gen_random_uuid();begin
 select * into t from operational_tasks where id=p_task for update;select * into r from operational_task_revisions where id=t.head_id;
 if r.state='completed' then return;end if;
 if p_event='source_changed' and (r.enrollment_id,r.state,r.due_at,r.assignee_id,r.checked_ids,r.note,r.source_snapshot) is not distinct from (t.enrollment_id,p_state,p_due,p_assignee,p_checked,p_note,p_source) then return;end if;
 insert into operational_task_revisions(id,task_id,enrollment_id,version,event,state,due_at,assignee_id,checked_ids,note,source_snapshot,actor_id) values(rid,t.id,t.enrollment_id,t.version+1,p_event,p_state,p_due,p_assignee,coalesce(p_checked,'{}'),p_note,p_source,auth.uid());
 update operational_tasks set version=version+1,head_id=rid where id=t.id;
end $$;
create function public.operational_ensure_task(p_template uuid,p_version uuid,p_resource uuid,p_key text,p_appointment uuid,p_use uuid,p_day date,p_batch integer,p_anchor timestamptz,p_source jsonb,p_review boolean default false) returns uuid language plpgsql security definer set search_path=public as $$
declare t operational_tasks;v operational_task_template_versions;eid uuid:=gen_random_uuid();tid uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();due timestamptz;state text:='pending';note text:='Generated from reviewed operational rule';assignee uuid;begin
 select * into t from operational_tasks where template_id=p_template and resource_id=p_resource and source_key=p_key;
 if found then return t.id;end if;
 select version_row.* into v from operational_task_template_versions version_row where version_row.id=p_version and version_row.template_id=p_template and version_row.state='published';if not found then raise exception 'Published frozen operational version required' using errcode='23514';end if;
 begin due:=public.operational_due(v.definition,p_anchor);exception when check_violation then state:='needs_review';note:='Local due time needs daylight-saving review';end;
 assignee:=public.native_rx_uuid(v.definition->'assignee_id',true);
 if assignee is not null and not public.operational_eligible(assignee,v.definition) then assignee:=null;state:='needs_review';note:='Reviewed assignee is no longer eligible';end if;
 if p_review then state:='needs_review';note:='Source or checklist requires explicit reviewer confirmation';end if;
 insert into operational_task_enrollments values(eid,p_template,p_version,v.definition,p_source,clock_timestamp());
 insert into operational_task_revisions(id,task_id,enrollment_id,version,event,state,due_at,assignee_id,note,source_snapshot,actor_id) values(rid,tid,eid,1,'generated',state,due,assignee,note,p_source,auth.uid());
 insert into operational_tasks(id,enrollment_id,template_id,resource_id,source_key,appointment_id,use_id,day_key,batch,version,head_id) values(tid,eid,p_template,p_resource,p_key,p_appointment,p_use,p_day,p_batch,1,rid);return tid;
end $$;
create function public.operational_identity_matches(d jsonb,p_type uuid,p_resource uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from appointment_catalog_versions actual join jsonb_array_elements(d#>'{selectors,resources}')choice on choice->>'entry_id'=actual.entry_id::text where actual.id=p_resource) and (jsonb_array_length(d#>'{selectors,types}')=0 or exists(select 1 from appointment_catalog_versions actual join jsonb_array_elements(d#>'{selectors,types}')choice on choice->>'entry_id'=actual.entry_id::text where actual.id=p_type))
$$;
-- Label/alias changes preserve resource identity. Unreviewed semantic changes require task review.
create function public.operational_matches(d jsonb,p_type uuid,p_resource uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from appointment_catalog_versions actual join jsonb_array_elements(d#>'{selectors,resources}')choice on choice->>'entry_id'=actual.entry_id::text join appointment_catalog_versions reviewed on reviewed.id=(choice->>'version_id')::uuid where actual.id=p_resource and actual.definition-array['name','aliases']=reviewed.definition-array['name','aliases']) and (jsonb_array_length(d#>'{selectors,types}')=0 or exists(select 1 from appointment_catalog_versions actual join jsonb_array_elements(d#>'{selectors,types}')choice on choice->>'entry_id'=actual.entry_id::text join appointment_catalog_versions reviewed on reviewed.id=(choice->>'version_id')::uuid where actual.id=p_type and actual.definition-array['duration_minutes','travel_before_minutes','travel_after_minutes','allow_override']=reviewed.definition-array['duration_minutes','travel_before_minutes','travel_after_minutes','allow_override']))
$$;
create function public.operational_generation_allows(at_time timestamptz) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select enabled and at_time>=effective_from and at_time<effective_until from operational_task_generation_policy order by version desc limit 1),false)
$$;
create function public.operational_materialize_appointment(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare a appointments;b appointment_catalog_bindings;tv operational_task_template_versions;t operational_tasks;r operational_task_revisions;e operational_task_enrollments;source jsonb;state text;due timestamptz;anchor timestamptz;rid uuid;has_use boolean;begin
 perform pg_advisory_xact_lock(73260123);select * into a from appointments where id=p_id;if not found then return;end if;
 select * into b from appointment_catalog_bindings where appointment_id=a.id and appointment_version<=a.version order by appointment_version desc limit 1;
 source:=jsonb_build_object('appointment_id',a.id,'appointment_version',a.version,'scheduled_at',a.scheduled_at,'status',a.status,'type_version_id',b.type_version_id,'resource_version_id',b.resource_version_id,'visit_type',a.visit_type,'travel_before_minutes',a.travel_before_minutes);
 for t in select * from operational_tasks where appointment_id=a.id and use_id is null and day_key is null order by id loop
  select * into r from operational_task_revisions where id=t.head_id;select * into e from operational_task_enrollments where id=t.enrollment_id;if r.state='completed' then continue;end if;
  select exists(select 1 from operational_resource_uses where appointment_id=a.id and resource_id=t.resource_id) into has_use;
  if r.state='superseded' and not has_use then continue;end if;
  state:=r.state;due:=r.due_at;
  if a.status in('CANCELLED','NO_SHOW') or not public.operational_identity_matches(e.definition,b.type_version_id,b.resource_version_id) then
   state:=case when r.state='pending' and not has_use then 'superseded' else 'needs_review' end;
  elsif a.status='COMPLETED' or not public.operational_matches(e.definition,b.type_version_id,b.resource_version_id) then state:='needs_review';
  else anchor:=a.scheduled_at-case when e.definition->>'trigger'='before_departure' then make_interval(mins=>a.travel_before_minutes) else interval '0' end;
   begin due:=public.operational_due(e.definition,anchor);exception when check_violation then due:=null;state:='needs_review';end;
  end if;
  perform public.operational_revision(t.id,'source_changed',state,due,r.assignee_id,r.checked_ids,case when state='superseded' then 'Source cancelled or no longer applicable before work/use' when state='needs_review' then 'Source changed; review operational work' else r.note end,source);
 end loop;
 if a.status not in('SCHEDULED','CONFIRMED') or b.resource_version_id is null or not public.operational_generation_allows(a.scheduled_at) then return;end if;
 select entry_id into rid from appointment_catalog_versions where id=b.resource_version_id;
 for tv in select v.* from operational_task_templates root join operational_task_template_versions v on v.id=root.published_version_id where v.definition->>'trigger' in('before_visit','before_departure') order by root.id loop
  if public.operational_identity_matches(tv.definition,b.type_version_id,b.resource_version_id) and (tv.definition->>'trigger'<>'before_departure' or a.visit_type='housecall') then
   anchor:=a.scheduled_at-case when tv.definition->>'trigger'='before_departure' then make_interval(mins=>a.travel_before_minutes) else interval '0' end;
   perform public.operational_ensure_task(tv.template_id,tv.id,rid,'visit:'||a.id::text,a.id,null,null,null,anchor,source,not public.operational_matches(tv.definition,b.type_version_id,b.resource_version_id));
  end if;
 end loop;
end $$;
create function public.operational_materialize_use(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare u operational_resource_uses;ev operational_resource_use_events;tv operational_task_template_versions;t operational_tasks;r operational_task_revisions;e operational_task_enrollments;source jsonb;anchor timestamptz;due timestamptz;state text;day date;batch_no integer;tid uuid;begin
 perform pg_advisory_xact_lock(73260123);select * into u from operational_resource_uses where id=p_id;select * into ev from operational_resource_use_events where id=u.head_id;
 source:=jsonb_build_object('use_id',u.id,'use_version',u.version,'resource_id',u.resource_id,'facts',ev.facts);anchor:=coalesce((ev.facts->>'ended_at')::timestamptz,(ev.facts->>'started_at')::timestamptz);
 for t in select * from operational_tasks where use_id=u.id order by id loop
  select * into r from operational_task_revisions where id=t.head_id;select * into e from operational_task_enrollments where id=t.enrollment_id;
  if r.state='completed' then
   if r.source_snapshot->>'use_version' is distinct from u.version::text then perform public.operational_ensure_task(t.template_id,e.template_version_id,t.resource_id,'review:'||u.id::text||':'||u.version::text,null,u.id,null,null,anchor,source,true);end if;
   continue;
  end if;
  state:=case when ev.facts->>'state'='open' or not public.operational_matches(e.definition,public.native_rx_uuid(ev.facts->'type_version_id',true),public.native_rx_uuid(ev.facts->'resource_version_id')) then 'needs_review' else r.state end;
  begin due:=public.operational_due(e.definition,anchor);exception when check_violation then due:=null;state:='needs_review';end;
  perform public.operational_revision(t.id,'source_changed',state,due,r.assignee_id,r.checked_ids,case when state='needs_review' then 'Actual use needs review' else r.note end,source);
 end loop;
 -- Correcting previously covered use is a safety obligation even while new generation is off.
 for t in select distinct covered.* from operational_tasks covered join operational_task_use_coverage c on c.task_id=covered.id where c.use_id=u.id and c.use_version<u.version and not exists(select 1 from operational_task_use_coverage current_coverage where current_coverage.template_id=c.template_id and current_coverage.use_id=u.id and current_coverage.use_version=u.version) order by covered.id loop
  select * into r from operational_task_revisions where id=t.head_id;select * into e from operational_task_enrollments where id=t.enrollment_id;
  day:=(anchor at time zone 'America/Denver')::date;
  if r.state not in('completed','superseded') and t.day_key=day then tid:=t.id;
  else
   if r.state not in('completed','superseded') then perform public.operational_revision(t.id,'source_changed','needs_review',r.due_at,r.assignee_id,r.checked_ids,'Covered actual use moved to another local day',r.source_snapshot||jsonb_build_object('corrected_use',source));end if;
   select latest.* into t from operational_tasks latest where latest.template_id=e.template_id and latest.resource_id=u.resource_id and latest.day_key=day order by latest.batch desc limit 1;
   batch_no:=0;if found then select * into r from operational_task_revisions where id=t.head_id;batch_no:=t.batch+case when r.state in('completed','superseded') then 1 else 0 end;end if;
   tid:=public.operational_ensure_task(e.template_id,e.template_version_id,u.resource_id,'day:'||day::text||':'||batch_no::text,null,null,day,batch_no,anchor,jsonb_build_object('day',day,'resource_id',u.resource_id),true);
  end if;
  select * into r from operational_task_revisions where task_id=tid order by version desc limit 1;
  perform public.operational_revision(tid,'source_changed','needs_review',r.due_at,r.assignee_id,r.checked_ids,'Covered actual use corrected; review restock obligation',r.source_snapshot||jsonb_build_object('corrected_use',source));
  insert into operational_task_use_coverage values(e.template_id,u.id,u.version,tid,clock_timestamp());
 end loop;
 if ev.facts->>'state'='open' or not public.operational_generation_allows((ev.facts->>'started_at')::timestamptz) then return;end if;
 for tv in select v.* from operational_task_templates root join operational_task_template_versions v on v.id=root.published_version_id where v.definition->>'trigger' in('after_use','resource_day') order by root.id loop
  if not public.operational_identity_matches(tv.definition,public.native_rx_uuid(ev.facts->'type_version_id',true),public.native_rx_uuid(ev.facts->'resource_version_id')) then continue;end if;
  if tv.definition->>'trigger'='after_use' then perform public.operational_ensure_task(tv.template_id,tv.id,u.resource_id,'use:'||u.id::text,null,u.id,null,null,anchor,source,not public.operational_matches(tv.definition,public.native_rx_uuid(ev.facts->'type_version_id',true),public.native_rx_uuid(ev.facts->'resource_version_id')));
  elsif not exists(select 1 from operational_task_use_coverage where template_id=tv.template_id and use_id=u.id and use_version=u.version) then
   day:=(anchor at time zone 'America/Denver')::date;
   select * into t from operational_tasks where template_id=tv.template_id and resource_id=u.resource_id and day_key=day order by batch desc limit 1;
   batch_no:=0;if found then select * into r from operational_task_revisions where id=t.head_id;batch_no:=t.batch+case when r.state in('completed','superseded') then 1 else 0 end;end if;
   tid:=public.operational_ensure_task(tv.template_id,tv.id,u.resource_id,'day:'||day::text||':'||batch_no::text,null,null,day,batch_no,anchor,jsonb_build_object('day',day,'resource_id',u.resource_id),not public.operational_matches(tv.definition,public.native_rx_uuid(ev.facts->'type_version_id',true),public.native_rx_uuid(ev.facts->'resource_version_id')));
   insert into operational_task_use_coverage values(tv.template_id,u.id,u.version,tid,clock_timestamp());
  end if;
 end loop;
end $$;
-- This statement guard precedes the care guard even for privileged direct writes.
create function public.operational_schedule_guard() returns trigger language plpgsql security definer set search_path=public as $$begin perform pg_advisory_xact_lock(73260123);return null;end $$;
create trigger aaa_0_operational_schedule_before_write before insert or update or delete on public.appointments for each statement execute function public.operational_schedule_guard();
create function public.operational_appointment_changed() returns trigger language plpgsql security definer set search_path=public as $$begin
 if tg_op='INSERT' or (new.scheduled_at,new.status,new.appointment_type,new.resource_name,new.visit_type,new.travel_before_minutes,new.travel_after_minutes,new.duration_minutes) is distinct from (old.scheduled_at,old.status,old.appointment_type,old.resource_name,old.visit_type,old.travel_before_minutes,old.travel_after_minutes,old.duration_minutes) then perform public.operational_materialize_appointment(new.id);end if;return new;
end $$;
create trigger operational_appointment_changed after insert or update on public.appointments for each row execute function public.operational_appointment_changed();

create function public.operational_execute_template(q jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.operational_actor(null,true);t operational_task_templates;v operational_task_template_versions;target_id uuid;expected integer;vid uuid:=gen_random_uuid();action text;begin
 perform public.native_rx_keys(q,array['id','expected_version','action','definition','review_note','attest_review']);target_id:=public.native_rx_uuid(q->'id');action:=q->>'action';
 if q->'expected_version'<>'null'::jsonb then expected:=public.appointment_catalog_integer(q->'expected_version',1,2147483647);end if;
 if action is null or action not in('draft','publish','retire') or jsonb_typeof(q->'attest_review') is distinct from 'boolean' then raise exception 'Exact template action required' using errcode='23514';end if;
 perform public.native_rx_text(q->'review_note',2000);perform public.operational_validate_definition(q->'definition',action='publish');
 select * into t from operational_task_templates where operational_task_templates.id=target_id for update;
 if found then if t.version is distinct from expected then raise exception 'Template changed; reload before review' using errcode='PT409';end if;select * into v from operational_task_template_versions where operational_task_template_versions.id=t.current_version_id;
 elsif expected is not null or action<>'draft' then raise exception 'Save new exact draft first' using errcode='PT409';end if;
 if action in('publish','retire') and (v.definition is distinct from q->'definition' or q->'attest_review'<>'true'::jsonb or (action='publish' and v.state<>'draft')) then raise exception 'Review exact saved draft before publication' using errcode='23514';end if;
 insert into operational_task_template_versions(id,template_id,version,state,definition,review_note,actor_id) values(vid,target_id,coalesce(t.version,0)+1,case action when 'draft' then 'draft' when 'publish' then 'published' else 'retired' end,q->'definition',q->>'review_note',actor);
 if t.id is null then insert into operational_task_templates(id,version,current_version_id,created_by) values(target_id,1,vid,actor);
 else update operational_task_templates set version=version+1,current_version_id=vid,published_version_id=case action when 'publish' then vid when 'retire' then null else published_version_id end where operational_task_templates.id=target_id;end if;
 return public.operational_template_view(target_id);
end $$;
create function public.operational_execute_use(q jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.operational_actor();u operational_resource_uses;e operational_resource_use_events;a appointments;b appointment_catalog_bindings;rv appointment_catalog_versions;target_use uuid;expected integer;aid uuid;av integer;rid uuid;start_at timestamptz;end_at timestamptz;action text;facts jsonb;eid uuid:=gen_random_uuid();allow_overlap boolean;begin
 perform public.native_rx_keys(q,array['id','expected_version','action','appointment_id','appointment_version','resource_version_id','started_at','ended_at','reason','allow_overlap','attest_closed_source']);
 target_use:=public.native_rx_uuid(q->'id');aid:=public.native_rx_uuid(q->'appointment_id');av:=public.appointment_catalog_integer(q->'appointment_version',1,2147483647);rid:=public.native_rx_uuid(q->'resource_version_id');start_at:=public.appointment_catalog_instant(q->'started_at');action:=q->>'action';
 perform public.native_rx_text(q->'reason',2000);if jsonb_typeof(q->'allow_overlap') is distinct from 'boolean' then raise exception 'Explicit overlap review flag required' using errcode='23514';end if;allow_overlap:=(q->>'allow_overlap')::boolean;
 if q->'ended_at'<>'null'::jsonb then end_at:=public.appointment_catalog_instant(q->'ended_at');end if;
 if q->'expected_version'<>'null'::jsonb then expected:=public.appointment_catalog_integer(q->'expected_version',1,2147483647);end if;
 if action is null or action not in('start','end','correct') or start_at>clock_timestamp() or (end_at is not null and (end_at<start_at or end_at>clock_timestamp())) or (action='start' and end_at is not null) or (action='end' and end_at is null) then raise exception 'Actual recorded use interval required' using errcode='23514';end if;
 select * into a from appointments where appointments.id=aid;if not found or a.version is distinct from av then raise exception 'Appointment changed; review actual use' using errcode='PT409';end if;
 select * into rv from appointment_catalog_versions where appointment_catalog_versions.id=rid;if not found or rv.state<>'published' or not exists(select 1 from appointment_catalog_entries where appointment_catalog_entries.id=rv.entry_id and kind='resource') then raise exception 'Reviewed resource identity required' using errcode='23514';end if;
 select * into u from operational_resource_uses where operational_resource_uses.id=target_use for update;
 if action='start' then
  if u.id is not null or expected is not null then raise exception 'New use identity required' using errcode='PT409';end if;
  if jsonb_typeof(q->'attest_closed_source') is distinct from 'boolean' then raise exception 'Explicit closed-source attestation flag required' using errcode='23514';end if;
  if a.status in('CANCELLED','NO_SHOW') then if q->'attest_closed_source'<>'true'::jsonb then raise exception 'Actual use of a closed visit requires reviewer attestation' using errcode='23514';end if;perform public.operational_actor(null,true);elsif q->'attest_closed_source'<>'false'::jsonb then raise exception 'Closed-source override only applies to a closed source' using errcode='23514';end if;
  if not exists(select 1 from appointment_catalog_entries where appointment_catalog_entries.id=rv.entry_id and published_version_id=rv.id) or not rv.definition->'visit_types' @> to_jsonb(array[a.visit_type]) then raise exception 'Current eligible resource and visit required for new use' using errcode='23514';end if;
  select * into b from appointment_catalog_bindings where appointment_id=aid and appointment_version<=a.version order by appointment_version desc limit 1;
  facts:=jsonb_build_object('state','open','started_at',start_at,'ended_at',null,'resource_version_id',rv.id,'type_version_id',b.type_version_id,'appointment_version',av,'reason',q->>'reason','overlap_reviewed',allow_overlap,'closed_source_attested',(q->>'attest_closed_source')::boolean);
 else
  if q->'attest_closed_source' is distinct from 'false'::jsonb then raise exception 'Closed-source attestation only accompanies new use' using errcode='23514';end if;
  if u.version is distinct from expected or u.appointment_id<>aid or u.resource_id<>rv.entry_id then raise exception 'Use identity/version changed' using errcode='PT409';end if;select * into e from operational_resource_use_events where operational_resource_use_events.id=u.head_id;
  if e.facts->>'resource_version_id'<>rid::text or (action='end' and (e.facts->>'state'<>'open' or start_at<>(e.facts->>'started_at')::timestamptz)) then raise exception 'End the exact open physical-use occurrence' using errcode='23514';end if;
  if action='correct' then perform public.operational_actor(null,true);end if;
  facts:=e.facts||jsonb_build_object('state',case when end_at is null then 'open' else 'ended' end,'started_at',start_at,'ended_at',end_at,'appointment_version',av,'reason',q->>'reason','overlap_reviewed',case when action='end' then (e.facts->>'overlap_reviewed')::boolean else allow_overlap end);
 end if;
 if exists(select 1 from operational_resource_uses other join operational_resource_use_events oe on oe.id=other.head_id where other.resource_id=rv.entry_id and other.id<>target_use and (oe.facts->>'started_at')::timestamptz<coalesce(end_at,'infinity'::timestamptz) and coalesce((oe.facts->>'ended_at')::timestamptz,'infinity'::timestamptz)>start_at) then
  if action='end' and (e.facts->>'overlap_reviewed')::boolean then null;else if not allow_overlap then raise exception 'Overlapping physical use requires explicit reviewer attestation' using errcode='23P01';end if;perform public.operational_actor(null,true);end if;
 end if;
 insert into operational_resource_use_events values(eid,target_use,coalesce(u.version,0)+1,action,facts,actor,clock_timestamp());
 if u.id is null then insert into operational_resource_uses values(target_use,aid,rv.entry_id,1,eid,actor,clock_timestamp());else update operational_resource_uses set version=version+1,head_id=eid where operational_resource_uses.id=target_use;end if;
 perform public.operational_materialize_use(target_use);perform public.operational_materialize_appointment(a.id);return public.operational_use_view(target_use);
end $$;
create function public.operational_execute_task(q jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.operational_actor();t operational_tasks;r operational_task_revisions;e operational_task_enrollments;v operational_task_template_versions;state text;action text;assignee uuid;checked uuid[]:='{}';x jsonb;context jsonb;due timestamptz;eid uuid;anchor timestamptz;begin
 perform public.native_rx_keys(q,array['id','expected_version','context_hash','action','assignee_id','checked_ids','note','due_at','template_version_id']);perform public.native_rx_text(q->'note',2000);
 select * into t from operational_tasks where id=public.native_rx_uuid(q->'id') for update;
 if not found or t.version is distinct from public.appointment_catalog_integer(q->'expected_version',1,2147483647) then raise exception 'Task changed; reload operational work' using errcode='PT409';end if;
 context:=public.operational_task_context(t.id);if q->>'context_hash' is distinct from md5(context::text) then raise exception 'Source or use evidence changed; review task again' using errcode='PT409';end if;
 select * into r from operational_task_revisions where id=t.head_id;select * into e from operational_task_enrollments where id=t.enrollment_id;
 action:=q->>'action';if action is null or action not in('claim','assign','start','block','complete','resolve','replace') or r.state in('completed','superseded') then raise exception 'Open exact task transition required' using errcode='23514';end if;
 if action in('resolve','replace') or (action='assign' and exists(select 1 from user_roles where user_id=actor and role in('DVM','ADMIN'))) then perform public.operational_actor(null,true);
 elsif not public.operational_eligible(actor,e.definition) then raise exception 'Current eligible task role required' using errcode='42501';end if;
 assignee:=public.native_rx_uuid(q->'assignee_id',true);due:=r.due_at;
 if jsonb_typeof(q->'checked_ids') is distinct from 'array' or jsonb_array_length(q->'checked_ids')>50 then raise exception 'Typed checklist evidence required' using errcode='23514';end if;
 for x in select value from jsonb_array_elements(q->'checked_ids') loop
  if public.native_rx_uuid(x)=any(checked) or not exists(select 1 from jsonb_array_elements(e.definition->'checklist')item where item->>'id'=x#>>'{}') then raise exception 'Distinct frozen checklist item IDs required' using errcode='23514';end if;checked:=array_append(checked,public.native_rx_uuid(x));
 end loop;
 if action<>'complete' and cardinality(checked)<>0 then raise exception 'Checklist evidence only accompanies completion' using errcode='23514';end if;
 if action<>'resolve' and q->'due_at' is distinct from 'null'::jsonb then raise exception 'Due override requires explicit reviewer resolution' using errcode='23514';end if;
 if action<>'replace' and q->'template_version_id' is distinct from 'null'::jsonb then raise exception 'Template replacement requires explicit review' using errcode='23514';end if;
 if action not in('claim','assign') and assignee is not null then raise exception 'Assignment identity only accompanies assignment' using errcode='23514';end if;
 state:=r.state;
 if action='claim' then
  if assignee is distinct from actor or (r.assignee_id is not null and r.assignee_id<>actor) then raise exception 'Claim only your unassigned task' using errcode='23514';end if;
 elsif action='assign' then
  if assignee is not null and not public.operational_eligible(assignee,e.definition) then raise exception 'Active eligible assignee required' using errcode='23514';end if;
 else assignee:=r.assignee_id;end if;
 if action='start' then if state not in('pending','blocked') then raise exception 'Resolve source review before starting work' using errcode='23514';end if;state:='started';
 elsif action='block' then state:=case when r.state='needs_review' then 'needs_review' else 'blocked' end;
 elsif action='complete' then
  if state='needs_review' or r.due_at is null or exists(select 1 from jsonb_array_elements(e.definition->'checklist')item where (item->>'required')::boolean and not (item->>'id')::uuid=any(checked)) then raise exception 'Resolve source review and attest every required checklist item' using errcode='23514';end if;state:='completed';
 elsif action='resolve' then
  if state<>'needs_review' or q->'due_at'='null'::jsonb then raise exception 'Explicit reviewed due time and unresolved task required' using errcode='23514';end if;due:=public.appointment_catalog_instant(q->'due_at');state:='pending';
 elsif action='replace' then
  select cv.* into v from operational_task_template_versions cv join operational_task_templates root on root.published_version_id=cv.id where cv.id=public.native_rx_uuid(q->'template_version_id') and cv.template_id=t.template_id;
  if not found or v.id=e.template_version_id or not exists(select 1 from jsonb_array_elements(v.definition#>'{selectors,resources}')s where s->>'entry_id'=t.resource_id::text) then raise exception 'Different current published version for this task resource required' using errcode='23514';end if;
  if v.definition->>'trigger'<>e.definition->>'trigger' then raise exception 'Task source trigger cannot change during replacement' using errcode='23514';end if;
  perform public.operational_validate_definition(v.definition,true);
  if t.appointment_id is not null and not public.operational_identity_matches(v.definition,(context#>>'{appointment,binding,type,id}')::uuid,(context#>>'{appointment,binding,resource,id}')::uuid) then raise exception 'Replacement must apply to the actual reviewed booking' using errcode='23514';end if;
  if t.use_id is not null and not public.operational_identity_matches(v.definition,(context#>>'{use,current,facts,type_version_id}')::uuid,(context#>>'{use,current,facts,resource_version_id}')::uuid) then raise exception 'Replacement must apply to the actual used resource/type' using errcode='23514';end if;
  if t.day_key is not null and exists(select 1 from jsonb_array_elements(context->'coverage')c where not public.operational_identity_matches(v.definition,(c#>>'{current,current,facts,type_version_id}')::uuid,(c#>>'{current,current,facts,resource_version_id}')::uuid)) then raise exception 'Replacement must preserve every covered physical-use obligation' using errcode='23514';end if;

  eid:=gen_random_uuid();insert into operational_task_enrollments values(eid,t.template_id,v.id,v.definition,context,clock_timestamp());update operational_tasks set enrollment_id=eid where id=t.id;
  anchor:=case when t.use_id is not null then coalesce((context#>>'{use,current,facts,ended_at}')::timestamptz,(context#>>'{use,current,facts,started_at}')::timestamptz) when t.day_key is not null then (t.day_key::timestamp+interval '12 hours') at time zone 'America/Denver' else (context#>>'{appointment,scheduled_at}')::timestamptz-case when v.definition->>'trigger'='before_departure' then make_interval(mins=>(context#>>'{appointment,travel_before_minutes}')::integer) else interval '0' end end;
  state:='pending';begin due:=public.operational_due(v.definition,anchor);exception when check_violation then due:=null;state:='needs_review';end;assignee:=public.native_rx_uuid(v.definition->'assignee_id',true);
 end if;
 perform public.operational_revision(t.id,action,state,due,assignee,checked,q->>'note',r.source_snapshot||jsonb_build_object('review_context',context));return public.operational_task_view(t.id);
end $$;
create function public.operational_execute_policy(q jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.operational_actor(null,true);p operational_task_generation_policy;lo timestamptz;hi timestamptz;expected integer;begin
 perform public.native_rx_keys(q,array['expected_version','enabled','effective_from','effective_until','review_note','attest_review']);perform public.native_rx_text(q->'review_note',2000);
 if jsonb_typeof(q->'enabled') is distinct from 'boolean' or q->'attest_review' is distinct from 'true'::jsonb then raise exception 'Explicit generation review required' using errcode='23514';end if;
 if q->'expected_version'<>'null'::jsonb then expected:=public.appointment_catalog_integer(q->'expected_version',1,2147483647);end if;
 select * into p from operational_task_generation_policy order by version desc limit 1;if p.version is distinct from expected then raise exception 'Generation policy changed' using errcode='PT409';end if;
 if q->'enabled'='true'::jsonb then if not exists(select 1 from operational_task_templates where published_version_id is not null) then raise exception 'Publish reviewed checklists before activation' using errcode='23514';end if;lo:=public.appointment_catalog_instant(q->'effective_from');hi:=public.appointment_catalog_instant(q->'effective_until');if hi<=lo or hi>lo+interval '366 days' then raise exception 'Bounded reviewed generation interval required' using errcode='23514';end if;
 elsif q->'effective_from' is distinct from 'null'::jsonb or q->'effective_until' is distinct from 'null'::jsonb then raise exception 'Disabled policy has no generation interval' using errcode='23514';end if;
 insert into operational_task_generation_policy values(coalesce(p.version,0)+1,(q->>'enabled')::boolean,lo,hi,q->>'review_note',actor,clock_timestamp());return(select to_jsonb(s) from operational_task_generation_policy s order by version desc limit 1);
end $$;
create function public.operational_validate_request(op text,q jsonb) returns void language plpgsql security definer set search_path=public as $$begin
 if jsonb_typeof(q) is distinct from 'object' or octet_length(q::text)>65536 then raise exception 'Bounded exact operational request required' using errcode='23514';end if;
 if op='template' then perform public.native_rx_keys(q,array['id','expected_version','action','definition','review_note','attest_review']);perform public.native_rx_uuid(q->'id');perform public.operational_validate_definition(q->'definition');
 elsif op='use' then perform public.native_rx_keys(q,array['id','expected_version','action','appointment_id','appointment_version','resource_version_id','started_at','ended_at','reason','allow_overlap','attest_closed_source']);perform public.native_rx_uuid(q->'id');perform public.native_rx_uuid(q->'appointment_id');perform public.native_rx_uuid(q->'resource_version_id');perform public.appointment_catalog_instant(q->'started_at');
 elsif op='task' then perform public.native_rx_keys(q,array['id','expected_version','context_hash','action','assignee_id','checked_ids','note','due_at','template_version_id']);perform public.native_rx_uuid(q->'id');perform public.appointment_catalog_integer(q->'expected_version',1,2147483647);if jsonb_typeof(q->'context_hash') is distinct from 'string' or q->>'context_hash' !~ '^[a-f0-9]{32}$' then raise exception 'Exact task source context required' using errcode='23514';end if;
 elsif op='policy' then perform public.native_rx_keys(q,array['expected_version','enabled','effective_from','effective_until','review_note','attest_review']);
 else raise exception 'Operational action required' using errcode='23514';end if;
end $$;
create function public.read_operational_review(p_actor_id uuid,p_action_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.operational_actor(p_actor_id);r operational_task_reviews;a operational_task_actions;begin
 if p_actor_id is null or p_action_id is null then raise exception 'Matched actor/action required' using errcode='42501';end if;
 select * into r from operational_task_reviews where id=p_action_id;if not found then return null;end if;if r.actor_id<>actor then raise exception 'Operational review belongs to another account' using errcode='42501';end if;
 select * into a from operational_task_actions where id=r.id;if found and (a.actor_id<>actor or a.operation<>r.operation or a.request is distinct from r.request) then raise exception 'Operational action identity collision' using errcode='23505';end if;
 return jsonb_build_object('id',r.id,'actor_id',r.actor_id,'operation',r.operation,'request',r.request,'expires_at',r.expires_at,'receipt',a.receipt,'state',case when a.id is not null then 'saved' when exists(select 1 from operational_task_review_cancellations where id=r.id) then 'cancelled' when r.expires_at<=clock_timestamp() then 'expired' else 'prepared' end);
end $$;
create function public.prepare_operational_review(p_actor_id uuid,p_action_id uuid,p_operation text,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.operational_actor(p_actor_id);r operational_task_reviews;begin
 if p_actor_id is null or p_action_id is null then raise exception 'Matched actor/action required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(73260123);perform public.care_eligibility_lock();perform public.operational_actor(p_actor_id);
 select * into r from operational_task_reviews where id=p_action_id;
 if found then if r.actor_id<>actor or r.operation is distinct from p_operation or r.request is distinct from p_request then raise exception 'Operational review UUID is immutable' using errcode='23505';end if;return public.read_operational_review(actor,p_action_id);end if;
 if exists(select 1 from operational_task_review_cancellations where id=p_action_id) then raise exception 'Operational action cancelled' using errcode='PT409';end if;
 perform public.operational_validate_request(p_operation,p_request);
 if (select count(*) from operational_task_reviews review where actor_id=actor and expires_at>clock_timestamp() and not exists(select 1 from operational_task_actions a where a.id=review.id) and not exists(select 1 from operational_task_review_cancellations c where c.id=review.id))>=32 then raise exception 'Check pending operational reviews first' using errcode='23514';end if;
 insert into operational_task_reviews(id,actor_id,session_id,operation,request) values(p_action_id,actor,public.next_visit_review_session(),p_operation,p_request);return public.read_operational_review(actor,p_action_id);
end $$;
create function public.execute_operational_review(p_actor_id uuid,p_action_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.operational_actor(p_actor_id);r operational_task_reviews;a operational_task_actions;receipt jsonb;begin
 if p_actor_id is null or p_action_id is null then raise exception 'Matched actor/action required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(73260123);perform public.care_eligibility_lock();perform public.operational_actor(p_actor_id);
 select * into r from operational_task_reviews where id=p_action_id;if not found or r.actor_id<>actor then raise exception 'Own prepared operational review required' using errcode='42501';end if;
 select * into a from operational_task_actions where id=p_action_id;if found then if a.actor_id<>actor or a.operation<>r.operation or a.request is distinct from r.request then raise exception 'Operational receipt identity collision' using errcode='23505';end if;return a.receipt;end if;
 if r.expires_at<=clock_timestamp() or exists(select 1 from operational_task_review_cancellations where id=r.id) then raise exception 'Operational review expired/cancelled; check saved work' using errcode='PT409';end if;
 receipt:=case r.operation when 'template' then public.operational_execute_template(r.request) when 'use' then public.operational_execute_use(r.request) when 'task' then public.operational_execute_task(r.request) when 'policy' then public.operational_execute_policy(r.request) end;
 perform public.operational_actor(p_actor_id);insert into operational_task_actions values(r.id,actor,public.next_visit_review_session(),r.operation,r.request,receipt,clock_timestamp());return receipt;
end $$;
create function public.cancel_operational_review(p_actor_id uuid,p_action_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.operational_actor(p_actor_id);r operational_task_reviews;a operational_task_actions;c operational_task_review_cancellations;begin
 if p_actor_id is null or p_action_id is null then raise exception 'Matched actor/action required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(73260123);perform public.care_eligibility_lock();perform public.operational_actor(p_actor_id);
 select * into r from operational_task_reviews where id=p_action_id;select * into a from operational_task_actions where id=p_action_id;select * into c from operational_task_review_cancellations where id=p_action_id;
 if (r.id is not null and r.actor_id<>actor) or (a.id is not null and a.actor_id<>actor) or (c.id is not null and c.actor_id<>actor) then raise exception 'Operational review belongs to another account' using errcode='42501';end if;
 if a.id is not null then return jsonb_build_object('cancelled',false,'operation',a.operation,'receipt',a.receipt);end if;
 insert into operational_task_review_cancellations(id,actor_id) values(p_action_id,actor) on conflict(id) do nothing;return jsonb_build_object('cancelled',true,'operation',r.operation,'receipt',null);
end $$;
create function public.read_operational_generation_policy() returns jsonb language plpgsql stable security definer set search_path=public as $$begin perform public.operational_actor();return(select to_jsonb(p) from operational_task_generation_policy p order by version desc limit 1);end $$;
create function public.list_operational_assignees(p_roles text[]) returns jsonb language plpgsql stable security definer set search_path=public as $$begin
 perform public.operational_actor();if p_roles is null or cardinality(p_roles) not between 1 and 4 or not p_roles<@array['STAFF','TECH','DVM','ADMIN'] or cardinality(p_roles)<>(select count(distinct r) from unnest(p_roles)r) then raise exception 'Distinct eligible roles required' using errcode='23514';end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'roles',(select jsonb_agg(role::text order by role::text) from user_roles where user_id=p.id)) order by p.full_name,p.id),'[]') from profiles p where p.is_active and exists(select 1 from user_roles where user_id=p.id and role::text=any(p_roles)));
end $$;
create function public.list_operational_uses(p_appointment_id uuid,p_after uuid default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;begin perform public.operational_actor();if p_appointment_id is null or p_limit is null or p_limit not between 1 and 100 then raise exception 'Bounded appointment uses required' using errcode='23514';end if;
 with candidates as materialized(select id from operational_resource_uses where appointment_id=p_appointment_id and (p_after is null or id>p_after) order by id limit p_limit+1),page as materialized(select id from candidates order by id limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(public.operational_use_view(id) order by id) from page),'[]'),'next',case when(select count(*) from candidates)>p_limit then(select id from page order by id desc limit 1) end) into result;return result;
end $$;
create function public.list_operational_tasks(p_from timestamptz,p_until timestamptz,p_resource_id uuid default null,p_after uuid default null,p_limit integer default 50,p_include_backlog boolean default false) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;begin perform public.operational_actor();if p_include_backlog is null or p_from is null or p_until is null or p_until<=p_from or p_until>p_from+interval '31 days' or p_limit is null or p_limit not between 1 and 100 then raise exception 'Bounded operational date range required' using errcode='23514';end if;
 with candidates as materialized(select t.id from operational_tasks t join operational_task_revisions r on r.id=t.head_id where (p_resource_id is null or t.resource_id=p_resource_id) and (p_after is null or t.id>p_after) and ((r.due_at>=p_from and r.due_at<p_until) or (r.state='needs_review' and r.due_at is null and t.created_at>=p_from and t.created_at<p_until) or (p_include_backlog and r.state in('pending','started','blocked','needs_review') and (r.due_at<p_from or r.due_at is null))) order by t.id limit p_limit+1),page as materialized(select id from candidates order by id limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(public.operational_task_view(id) order by id) from page),'[]'),'next',case when(select count(*) from candidates)>p_limit then(select id from page order by id desc limit 1) end) into result;return result;
end $$;
create function public.read_operational_task(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$begin perform public.operational_actor();if p_id is null then raise exception 'Task identity required' using errcode='23514';end if;return public.operational_task_view(p_id);end $$;
create index operational_task_open_due on public.operational_task_revisions(due_at,task_id) where state in('pending','started','blocked','needs_review');
create function public.read_operational_appointment(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$begin
 perform public.operational_actor();if p_id is null then raise exception 'Appointment identity required' using errcode='23514';end if;
 return(select jsonb_build_object('id',a.id,'version',a.version,'status',a.status,'scheduled_at',a.scheduled_at,'appointment_type',a.appointment_type,'visit_type',a.visit_type,'patient_name',p.name) from appointments a left join pets p on p.id=a.pet_id where a.id=p_id);
end $$;
create function public.list_operational_task_history(p_id uuid,p_before_version integer default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;begin perform public.operational_actor();if p_id is null or p_limit is null or p_limit not between 1 and 100 or (p_before_version is not null and p_before_version<1) then raise exception 'Bounded task history required' using errcode='23514';end if;
 with candidates as materialized(select * from operational_task_revisions where task_id=p_id and (p_before_version is null or version<p_before_version) order by version desc limit p_limit+1),page as materialized(select * from candidates order by version desc limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('revision',to_jsonb(r),'enrollment',to_jsonb(e),'actor_name',(select full_name from profiles where id=r.actor_id)) order by r.version desc) from page r join operational_task_enrollments e on e.id=r.enrollment_id),'[]'),'next',case when(select count(*) from candidates)>p_limit then(select min(version) from page) end) into result;return result;
end $$;
create function public.reconcile_operational_tasks(p_from timestamptz,p_until timestamptz,p_after uuid default null,p_limit integer default 50) returns jsonb language plpgsql security definer set search_path=public as $$
declare ids uuid[];candidate_id uuid;next_id uuid;actor uuid:=public.operational_actor(null,true);begin
 if p_from is null or p_until is null or p_until<=p_from or p_until>p_from+interval '31 days' or p_limit is null or p_limit not between 1 and 100 then raise exception 'Bounded explicit reconciliation required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(73260123);perform public.care_eligibility_lock();perform public.operational_actor(actor,true);
 select array_agg(a.id order by a.id) into ids from (select candidate.id from appointments candidate where scheduled_at>=p_from and scheduled_at<p_until and (p_after is null or candidate.id>p_after) order by candidate.id limit p_limit+1)a;
 if cardinality(ids)>p_limit then next_id:=ids[p_limit];ids:=ids[:p_limit];end if;
 foreach candidate_id in array coalesce(ids,'{}'::uuid[]) loop perform public.operational_materialize_appointment(candidate_id);perform public.operational_materialize_use(u.id) from operational_resource_uses u where u.appointment_id=candidate_id order by u.id;end loop;
 return jsonb_build_object('examined',coalesce(cardinality(ids),0),'next',next_id,'generation_enabled',coalesce((select enabled from operational_task_generation_policy order by version desc limit 1),false));
end $$;
do $$declare f record;begin
 for f in select p.oid::regprocedure::text signature,p.proname from pg_proc p where p.pronamespace='public'::regnamespace and (p.proname like 'operational_%' or p.proname in('read_operational_appointment','list_operational_task_history','read_operational_task','list_operational_templates','list_operational_uses','list_operational_tasks','list_operational_assignees','read_operational_generation_policy','reconcile_operational_tasks','read_operational_review','prepare_operational_review','execute_operational_review','cancel_operational_review')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname not like 'operational_%' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
