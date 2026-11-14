begin;
create table workforce.posts(id uuid primary key,author uuid not null references public.profiles(id),body text not null check(length(body)between 1 and 5000),pinned boolean not null default false,version integer not null default 1,created_at timestamptz not null default now());
create table workforce.post_ack(post_id uuid references workforce.posts(id),staff_id uuid references public.profiles(id),primary key(post_id,staff_id));
create table workforce.team_tasks(id uuid primary key,title text not null check(length(title)between 1 and 200),note text not null default '' check(length(note)<=2000),assignee uuid references public.profiles(id),due_at timestamptz not null,done boolean not null default false,version integer not null default 1,created_by uuid not null,completed_by uuid,rotation_id uuid,source_day date,unique(rotation_id,source_day));
create index team_tasks_due on workforce.team_tasks(due_at);
create table workforce.rotations(id uuid primary key,title text not null check(length(title)between 1 and 200),staff_ids uuid[] not null check(cardinality(staff_ids)between 1 and 100),starts_on date not null,ends_on date not null,local_time time not null,version integer not null default 1,created_by uuid not null,check(ends_on>=starts_on and ends_on-starts_on<=366));
create table workforce.events(id uuid primary key,title text not null check(length(title)between 1 and 200),description text not null default '' check(length(description)<=2000),starts_at timestamptz not null,deadline timestamptz not null,capacity integer not null check(capacity between 1 and 10000),cancelled boolean not null default false,version integer not null default 1,created_by uuid not null,check(deadline<=starts_at));
create table workforce.event_signups(event_id uuid references workforce.events(id),staff_id uuid references public.profiles(id),answer text not null check(answer in('YES','NO','MAYBE','WAITLIST')),queued_at timestamptz not null default now(),primary key(event_id,staff_id));
create table workforce.milestones(staff_id uuid primary key references public.profiles(id),birthday_month integer check(birthday_month between 1 and 12),birthday_day integer check(birthday_day between 1 and 31),anniversary date,share_birthday boolean not null default false,share_anniversary boolean not null default false,version integer not null default 1,check((birthday_month is null)=(birthday_day is null)),check(birthday_month is null or birthday_day<=extract(day from(make_date(2000,birthday_month,1)+interval'1 month' - interval'1 day'))));
create table workforce.milestone_dismissals(staff_id uuid not null references public.profiles(id),source_key text not null,until_at timestamptz not null,primary key(staff_id,source_key));
do $$declare n text;begin foreach n in array array['posts','post_ack','team_tasks','rotations','events','event_signups','milestones','milestone_dismissals']loop execute format('alter table workforce.%I enable row level security',n);execute format('revoke all on workforce.%I from public,anon,authenticated,service_role',n);end loop;end$$;
create function public.team_read()returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare a uuid:=workforce.actor();d date:=(now()at time zone'America/Denver')::date;
begin return jsonb_build_object(
 'can_manage',workforce.can_manage(a),
 'staff',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name)order by full_name),'[]')from public.profiles where is_active),
 'posts',(select coalesce(jsonb_agg(to_jsonb(q)),'[]')from(select p.*,exists(select 1 from workforce.post_ack x where x.post_id=p.id and x.staff_id=a)acknowledged,(select count(*)from workforce.post_ack x where x.post_id=p.id)acknowledgments from workforce.posts p order by p.pinned desc,p.created_at desc limit 100)q),
 'tasks',(select coalesce(jsonb_agg(to_jsonb(q)),'[]')from(select * from workforce.team_tasks where not done or due_at>now()-interval'14 days' order by done,due_at limit 300)q),
 'events',(select coalesce(jsonb_agg(to_jsonb(q)),'[]')from(select e.*,(select answer from workforce.event_signups s where s.event_id=e.id and s.staff_id=a)my_answer,(select count(*)from workforce.event_signups s where s.event_id=e.id and s.answer='YES')going,(select count(*)from workforce.event_signups s where s.event_id=e.id and s.answer='WAITLIST')waiting from workforce.events e where e.starts_at>now()-interval'7 days' order by e.starts_at limit 100)q),
 'my_milestones',(select to_jsonb(m)from workforce.milestones m where m.staff_id=a),
 'milestones',(select coalesce(jsonb_agg(jsonb_build_object('staff_id',m.staff_id,'kind',x.kind,'source_key',m.staff_id||':'||x.kind||':'||extract(year from d),'years',case when x.kind='anniversary'then extract(year from age(d,m.anniversary))::integer else null end)),'[]')from workforce.milestones m join public.profiles p on p.id=m.staff_id and p.is_active cross join lateral(values('birthday',m.share_birthday and m.birthday_month=extract(month from d)and m.birthday_day=extract(day from d)),('anniversary',m.share_anniversary and to_char(m.anniversary,'MM-DD')=to_char(d,'MM-DD')and m.anniversary<d))x(kind,show)where x.show and not exists(select 1 from workforce.milestone_dismissals z where z.staff_id=a and z.source_key=m.staff_id||':'||x.kind||':'||extract(year from d)and z.until_at>now())),
 'rotations',case when workforce.can_manage(a)then(select coalesce(jsonb_agg(to_jsonb(r)),'[]')from workforce.rotations r where r.ends_on>=d)else '[]'::jsonb end
 );end$$;
create function public.team_command(p_action text,p_id uuid,p_data jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a uuid:=workforce.actor(); t workforce.team_tasks;ev workforce.events;r workforce.rotations; rotation_day date;s uuid;ids uuid[]; offset_n integer;candidate uuid; k text;prior workforce.mutation_receipts;created_action boolean:=p_action=any(array['post','task','rotation','event']);
begin
 if p_id is null or jsonb_typeof(p_data)<>'object'or length(p_data::text)>15000 then raise exception 'Invalid request';end if;
 perform pg_advisory_xact_lock(hashtextextended('workforce-team',0));
 if created_action then
  if p_action='rotation'or(p_action='task'and(p_data->>'assignee')::uuid is not null and(p_data->>'assignee')::uuid<>a)then perform workforce.require_manager();end if;
  select * into prior from workforce.mutation_receipts where area='team'and action=p_action and id=p_id;
  if found then
   if prior.actor<>a or prior.payload_hash<>md5(p_data::text)then raise exception 'Request was already used; refresh saved records before starting a new request'using errcode='PT409';end if;
   return jsonb_build_object('id',p_id,'action',p_action);
  end if;
 end if;
 case p_action
 when 'post' then insert into workforce.posts(id,author,body)values(p_id,a,p_data->>'body');
 when 'pin' then
  perform workforce.require_manager();update workforce.posts set pinned=(p_data->>'pinned')::boolean,version=version+1 where id=p_id and version=(p_data->>'version')::integer;
  if not found then raise exception 'Post changed; refresh' using errcode='PT409';end if;
 when 'acknowledge' then insert into workforce.post_ack(post_id,staff_id)values(p_id,a)on conflict do nothing;
 when 'task' then
  s:=(p_data->>'assignee')::uuid;
  if s is not null and s<>a then perform workforce.require_manager();end if;
  if s is not null and not public.is_active_staff(s)then raise exception 'Choose active staff';end if;
  insert into workforce.team_tasks(id,title,note,assignee,due_at,created_by)values(p_id,p_data->>'title',coalesce(p_data->>'note',''),s,(p_data->>'due_at')::timestamptz,a);
 when 'task_status' then
  select * into t from workforce.team_tasks where id=p_id for update;
  if t.id is null or t.version<>(p_data->>'version')::integer then raise exception 'Task changed; refresh' using errcode='PT409';end if;
  if t.assignee is not null and t.assignee<>a then perform workforce.require_manager();end if;
  update workforce.team_tasks set done=(p_data->>'done')::boolean,completed_by=case when(p_data->>'done')::boolean then a else null end,version=version+1 where id=p_id;
 when 'assign_task' then
  perform workforce.require_manager();s:=(p_data->>'assignee')::uuid;
  if s is not null and not public.is_active_staff(s)then raise exception 'Choose active staff';end if;
  update workforce.team_tasks set assignee=s,version=version+1 where id=p_id and version=(p_data->>'version')::integer;
  if not found then raise exception 'Task changed; refresh' using errcode='PT409';end if;
 when 'rotation' then
  perform workforce.require_manager();select array_agg(value::uuid)into ids from jsonb_array_elements_text(p_data->'staff_ids');
  if ids is null or cardinality(ids)<>(select count(distinct x)from unnest(ids)x)or exists(select 1 from unnest(ids)x where not public.is_active_staff(x))then raise exception 'Choose distinct active staff';end if;
  insert into workforce.rotations(id,title,staff_ids,starts_on,ends_on,local_time,created_by)values(p_id,p_data->>'title',ids,(p_data->>'starts_on')::date,(p_data->>'ends_on')::date,(p_data->>'local_time')::time,a);
 when 'generate_rotation' then
  perform workforce.require_manager();select * into r from workforce.rotations where id=p_id;
  if r.id is null then raise exception 'Rotation not found';end if;
  -- Explicit generation is bounded to the next 31 days. Existing duties are never silently reassigned.
  for rotation_day in select d::date from generate_series(greatest(r.starts_on,(now()at time zone'America/Denver')::date),least(r.ends_on,(now()at time zone'America/Denver')::date+30),interval'1 day')d loop
   if exists(select 1 from workforce.holidays where workforce.holidays.day=rotation_day and closed)then continue;end if;
   candidate:=null;offset_n:=rotation_day-r.starts_on;
   for i in 0..cardinality(r.staff_ids)-1 loop
    s:=r.staff_ids[1+((offset_n+i)%cardinality(r.staff_ids))];
    if public.is_active_staff(s)and not exists(select 1 from workforce.leave_requests q where q.staff_id=s and q.status='APPROVED'and rotation_day between q.starts_on and q.ends_on)then candidate:=s;exit;end if;
   end loop;
   insert into workforce.team_tasks(id,title,assignee,due_at,created_by,rotation_id,source_day)values(gen_random_uuid(),r.title,candidate,(rotation_day+r.local_time)at time zone'America/Denver',a,r.id,rotation_day)on conflict(rotation_id,source_day)do nothing;
  end loop;
 when 'event' then
  insert into workforce.events(id,title,description,starts_at,deadline,capacity,created_by)values(p_id,p_data->>'title',coalesce(p_data->>'description',''),(p_data->>'starts_at')::timestamptz,(p_data->>'deadline')::timestamptz,(p_data->>'capacity')::integer,a);
 when 'cancel_event' then
  select * into ev from workforce.events where id=p_id for update;
  if ev.created_by is distinct from a then perform workforce.require_manager();end if;
  update workforce.events set cancelled=true,version=version+1 where id=p_id and version=(p_data->>'version')::integer;
  if not found then raise exception 'Event changed; refresh' using errcode='PT409';end if;
 when 'rsvp' then
  select * into ev from workforce.events where id=p_id for update;k:=p_data->>'answer';
  if ev.id is null or ev.cancelled or ev.deadline<now()then raise exception 'Signups are closed';end if;
  if k not in('YES','NO','MAYBE')then raise exception 'Choose an attendance response';end if;
  if k='YES'and exists(select 1 from workforce.event_signups where event_id=p_id and staff_id=a and answer in('YES','WAITLIST'))then return jsonb_build_object('id',p_id,'action',p_action);end if;
  if k='YES'and(select count(*)from workforce.event_signups where event_id=p_id and answer='YES')>=ev.capacity then k:='WAITLIST';end if;
  insert into workforce.event_signups(event_id,staff_id,answer)values(p_id,a,k)on conflict(event_id,staff_id)do update set answer=excluded.answer,queued_at=now();
  -- Cancel/decline promotes the oldest waitlisted attendee automatically.
  while(select count(*)from workforce.event_signups where event_id=p_id and answer='YES')<ev.capacity loop
   select staff_id into s from workforce.event_signups where event_id=p_id and answer='WAITLIST'order by queued_at,staff_id limit 1;
   exit when s is null;
   update workforce.event_signups set answer='YES'where event_id=p_id and staff_id=s;
  end loop;
 when 'milestones' then
  insert into workforce.milestones(staff_id,birthday_month,birthday_day,anniversary,share_birthday,share_anniversary)values(a,(p_data->>'birthday_month')::integer,(p_data->>'birthday_day')::integer,(p_data->>'anniversary')::date,(p_data->>'share_birthday')::boolean,(p_data->>'share_anniversary')::boolean)
  on conflict(staff_id)do update set birthday_month=excluded.birthday_month,birthday_day=excluded.birthday_day,anniversary=excluded.anniversary,share_birthday=excluded.share_birthday,share_anniversary=excluded.share_anniversary,version=workforce.milestones.version+1;
 when 'dismiss_milestone' then
  k:=p_data->>'source_key';if k!~'^[a-f0-9-]{36}:(birthday|anniversary):[0-9]{4}$'then raise exception 'Invalid milestone';end if;
  insert into workforce.milestone_dismissals(staff_id,source_key,until_at)values(a,k,case when(p_data->>'snooze')::boolean then now()+interval'1 hour'else now()+interval'366 days'end)on conflict(staff_id,source_key)do update set until_at=excluded.until_at;
 else raise exception 'Unknown team action';end case;
 if created_action then insert into workforce.mutation_receipts values('team',p_action,p_id,a,md5(p_data::text));end if;
 insert into workforce.audit(actor,action,subject)values(a,'team:'||p_action,p_id);
 return jsonb_build_object('id',p_id,'action',p_action);
end$$;
revoke all on function public.team_read(),public.team_command(text,uuid,jsonb)from public,anon,service_role;
grant execute on function public.team_read(),public.team_command(text,uuid,jsonb)to authenticated;
commit;
