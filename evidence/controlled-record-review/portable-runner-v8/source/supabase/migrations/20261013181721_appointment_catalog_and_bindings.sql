-- Reviewed scheduling configuration. No template, alias, policy or booking seeds.
create table public.appointment_catalog_entries(
 id uuid primary key,kind text not null check(kind in('type','resource')),version integer not null check(version>0),
 current_version_id uuid not null,published_version_id uuid,created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now()
);
create table public.appointment_catalog_versions(
 id uuid primary key,entry_id uuid not null references public.appointment_catalog_entries(id) on delete restrict deferrable initially deferred,
 version integer not null check(version>0),state text not null check(state in('draft','published','retired')),
 definition jsonb not null check(jsonb_typeof(definition)='object'),review_note text not null check(length(review_note) between 1 and 2000),
 actor_id uuid not null references auth.users(id) on delete restrict,recorded_at timestamptz not null default now(),
 unique(entry_id,version),unique(id,entry_id)
);
alter table public.appointment_catalog_entries add foreign key(current_version_id,id) references public.appointment_catalog_versions(id,entry_id) deferrable initially deferred;
alter table public.appointment_catalog_entries add foreign key(published_version_id,id) references public.appointment_catalog_versions(id,entry_id) deferrable initially deferred;
create table public.appointment_resource_aliases(
 alias text primary key check(alias=lower(btrim(alias)) and length(alias) between 1 and 150),
 resource_id uuid not null references public.appointment_catalog_entries(id) on delete restrict,
 reviewed_version_id uuid not null references public.appointment_catalog_versions(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,recorded_at timestamptz not null default now()
);
create table public.appointment_catalog_actions(
 id uuid primary key,actor_id uuid not null references auth.users(id) on delete restrict,
 request jsonb not null,receipt jsonb not null,recorded_at timestamptz not null default now()
);
create table public.appointment_catalog_bindings(
 appointment_id uuid not null references public.appointments(id) on delete restrict deferrable initially deferred,
 appointment_version integer not null check(appointment_version>0),
 type_version_id uuid not null references public.appointment_catalog_versions(id) on delete restrict,
 resource_version_id uuid references public.appointment_catalog_versions(id) on delete restrict,
 snapshot jsonb not null,actor_id uuid not null references auth.users(id) on delete restrict,
 recorded_at timestamptz not null default now(),primary key(appointment_id,appointment_version)
);
create table public.appointment_booking_actions(
 id uuid primary key,actor_id uuid not null references auth.users(id) on delete restrict,
 request jsonb not null,receipt jsonb not null,recorded_at timestamptz not null default now()
);
create function public.appointment_catalog_audit() returns trigger language plpgsql security definer set search_path=public as $$
declare j jsonb:=to_jsonb(new);begin
 insert into public.audit_logs(user_id,action,table_name,record_id,new_data)
 values(auth.uid(),tg_op,tg_table_name,coalesce(j->>'id',j->>'appointment_id',j->>'resource_id')::uuid,j-array['request','receipt','snapshot']);
 return new;
end $$;
do $$declare t text;begin
 foreach t in array array['appointment_catalog_entries','appointment_catalog_versions','appointment_resource_aliases','appointment_catalog_actions','appointment_catalog_bindings','appointment_booking_actions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger appointment_catalog_audit after insert or update on public.%I for each row execute function public.appointment_catalog_audit()',t);
  if t<>'appointment_catalog_entries' then execute format('create trigger appointment_catalog_immutable before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);end if;
 end loop;
end $$;

create function public.appointment_catalog_reviewer() returns uuid language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();begin
 if not exists(select 1 from public.user_roles where user_id=a and role in('DVM','ADMIN')) then raise exception 'Active veterinarian or administrator required' using errcode='42501';end if;
 return a;
end $$;
create function public.appointment_catalog_integer(v jsonb,lo integer,hi integer) returns integer language plpgsql immutable set search_path=public as $$
begin
 if jsonb_typeof(v) is distinct from 'number' or v::text !~ '^[0-9]+$' or v::text::numeric not between lo and hi then raise exception 'Invalid scheduling number' using errcode='23514';end if;
 return v::text::integer;
end $$;
create function public.appointment_catalog_strings(v jsonb,lo integer,hi integer,maxlength integer) returns text[] language plpgsql immutable set search_path=public as $$
declare a text[];x jsonb;begin
 if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v) not between lo and hi then raise exception 'Bounded scheduling choices required' using errcode='23514';end if;
 for x in select value from jsonb_array_elements(v) loop perform public.native_rx_text(x,maxlength);end loop;
 select coalesce(array_agg(value),'{}') into a from jsonb_array_elements_text(v);
 if cardinality(a)<>(select count(distinct lower(btrim(s))) from unnest(a)s) then raise exception 'Distinct scheduling choices required' using errcode='23514';end if;
 return a;
end $$;
create function public.appointment_catalog_instant(v jsonb) returns timestamptz language plpgsql immutable set search_path=public as $$
declare t text;result timestamptz;begin
 t:=public.native_rx_text(v,80);
 if t !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then raise exception 'Explicit scheduling instant required' using errcode='23514';end if;
 result:=t::timestamptz;if not isfinite(result) then raise exception 'Finite scheduling instant required' using errcode='23514';end if;return result;
exception when datetime_field_overflow or invalid_datetime_format then raise exception 'Invalid scheduling instant' using errcode='23514';end $$;
create function public.validate_appointment_catalog_definition(k text,v jsonb) returns void language plpgsql immutable set search_path=public as $$
declare a text[];n integer;begin
 if k='type' then
  perform public.native_rx_keys(v,array['name','category','species','visit_types','duration_minutes','travel_before_minutes','travel_after_minutes','resource_kind','staffing','allow_override']);
  if v->>'category' not in('well','sick','procedure') or jsonb_typeof(v->'category') is distinct from 'string' or v->>'staffing' not in('dvm','staff') or jsonb_typeof(v->'staffing') is distinct from 'string' or jsonb_typeof(v->'allow_override') is distinct from 'boolean' then raise exception 'Invalid appointment category or staffing' using errcode='23514';end if;
  perform public.appointment_catalog_strings(v->'species',1,50,100);
  if v->'duration_minutes'<>'null'::jsonb then perform public.appointment_catalog_integer(v->'duration_minutes',15,480);end if;
  perform public.appointment_catalog_integer(v->'travel_before_minutes',0,240);perform public.appointment_catalog_integer(v->'travel_after_minutes',0,240);
  if v->'resource_kind'<>'null'::jsonb and v->>'resource_kind' not in('exam','procedure','vehicle','equipment','other') then raise exception 'Invalid resource kind' using errcode='23514';end if;
 elsif k='resource' then
  perform public.native_rx_keys(v,array['name','resource_kind','visit_types','aliases']);
  if v->>'resource_kind' not in('exam','procedure','vehicle','equipment','other') or jsonb_typeof(v->'resource_kind') is distinct from 'string' then raise exception 'Invalid resource kind' using errcode='23514';end if;
  perform public.appointment_catalog_strings(v->'aliases',0,50,150);
 else raise exception 'Invalid catalog kind' using errcode='23514';end if;
 perform public.native_rx_text(v->'name',150);
 a:=public.appointment_catalog_strings(v->'visit_types',1,2,20);
 if exists(select 1 from unnest(a)x where x not in('clinic','housecall')) then raise exception 'Invalid visit mode' using errcode='23514';end if;
end $$;
create function public.appointment_catalog_entry_view(p_id uuid,p_drafts boolean) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',e.id,'kind',e.kind,'version',e.version,
  'current',case when p_drafts then to_jsonb(c) else to_jsonb(p) end,'published',to_jsonb(p))
 from public.appointment_catalog_entries e join public.appointment_catalog_versions c on c.id=e.current_version_id
 left join public.appointment_catalog_versions p on p.id=e.published_version_id where e.id=p_id
$$;
create function public.list_appointment_catalog(p_kind text,p_after uuid default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();reviewer boolean;items jsonb;nextid uuid;begin
 if p_kind not in('type','resource') or p_kind is null or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid catalog page' using errcode='23514';end if;
 reviewer:=exists(select 1 from user_roles where user_id=a and role in('DVM','ADMIN'));
 select coalesce(jsonb_agg(public.appointment_catalog_entry_view(id,reviewer) order by id),'[]') into items from
 (select id from appointment_catalog_entries where kind=p_kind and (p_after is null or id>p_after) and (reviewer or published_version_id is not null) order by id limit p_limit) q;
 if jsonb_array_length(items)=p_limit then nextid:=(items->(p_limit-1)->>'id')::uuid;end if;
 return jsonb_build_object('items',items,'next',nextid);
end $$;

-- Frozen stable identity wins over spelling. Unmapped free text retains legacy semantics.
create function public.appointment_resource_key(p_appointment uuid,p_name text) returns text language plpgsql stable security definer set search_path=public as $$
declare r uuid;begin
 if nullif(btrim(p_name),'') is null then return null;end if;
 select (snapshot#>>'{resource,entry_id}')::uuid into r from appointment_catalog_bindings
 where appointment_id=p_appointment order by appointment_version desc limit 1;
 if r is null then select resource_id into r from appointment_resource_aliases where alias=lower(btrim(p_name));end if;
 return case when r is not null then 'resource:'||r::text else 'text:'||lower(btrim(p_name)) end;
end $$;
create function public.save_appointment_catalog(p_actor_id uuid,p_action_id uuid,p_id uuid,p_expected_version integer,p_kind text,p_action text,p_values jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.appointment_catalog_reviewer();e appointment_catalog_entries;c appointment_catalog_versions;
 req jsonb;old appointment_catalog_actions;vid uuid:=gen_random_uuid();receipt jsonb;aliases text[];s text;state text;begin
 if a is distinct from p_actor_id or p_id is null or p_action_id is null then raise exception 'Matched actor and stable IDs required' using errcode='42501';end if;
 req:=jsonb_build_object('id',p_id,'expected_version',p_expected_version,'kind',p_kind,'action',p_action,'values',p_values);
 perform pg_advisory_xact_lock(73260123);perform public.appointment_catalog_reviewer();
 select * into old from appointment_catalog_actions where id=p_action_id;
 if found then if old.actor_id<>a or old.request is distinct from req then raise exception 'Catalog action already belongs to different work' using errcode='23505';end if;return old.receipt;end if;
 perform public.native_rx_keys(p_values,array['definition','review_note','attest_review']);
 perform public.validate_appointment_catalog_definition(p_kind,p_values->'definition');perform public.native_rx_text(p_values->'review_note',2000);
 if jsonb_typeof(p_values->'attest_review') is distinct from 'boolean' or p_action is null or p_action not in('draft','publish','retire') then raise exception 'Invalid catalog action' using errcode='23514';end if;
 select * into e from appointment_catalog_entries where id=p_id for update;
 if found then
  if e.version is distinct from p_expected_version or e.kind<>p_kind then raise exception 'Catalog changed; reload its current revision' using errcode='PT409';end if;
  select * into c from appointment_catalog_versions where id=e.current_version_id;
 else
  if p_expected_version is not null or p_action<>'draft' then raise exception 'Save a new draft first' using errcode='PT409';end if;
 end if;
 if p_action='publish' and (c.state is distinct from 'draft' or c.definition is distinct from p_values->'definition' or (p_values->>'attest_review')::boolean is not true) then raise exception 'Review the exact saved draft before publication' using errcode='23514';end if;
 if p_action='retire' and (c.definition is distinct from p_values->'definition' or (p_values->>'attest_review')::boolean is not true) then raise exception 'Review the exact catalog entry before retirement' using errcode='23514';end if;
 if p_action='publish' and p_kind='resource' then
  aliases:=array[p_values#>>'{definition,name}']||public.appointment_catalog_strings(p_values#>'{definition,aliases}',0,50,150);
  if exists(select 1 from appointment_resource_aliases where alias=any(select lower(btrim(x)) from unnest(aliases)x) and resource_id<>p_id) then raise exception 'Resource alias already has a different stable identity' using errcode='23505';end if;
  if exists(select 1 from appointments x join appointments y on x.id<y.id
   where x.status in('SCHEDULED','CONFIRMED') and y.status in('SCHEDULED','CONFIRMED')
   and (case when lower(btrim(x.resource_name))=any(select lower(btrim(z)) from unnest(aliases)z) then 'resource:'||p_id::text else public.appointment_resource_key(x.id,x.resource_name) end)='resource:'||p_id::text
   and (case when lower(btrim(y.resource_name))=any(select lower(btrim(z)) from unnest(aliases)z) then 'resource:'||p_id::text else public.appointment_resource_key(y.id,y.resource_name) end)='resource:'||p_id::text
   and x.scheduled_at-make_interval(mins=>x.travel_before_minutes)<y.scheduled_at+make_interval(mins=>y.duration_minutes+y.travel_after_minutes)
   and y.scheduled_at-make_interval(mins=>y.travel_before_minutes)<x.scheduled_at+make_interval(mins=>x.duration_minutes+x.travel_after_minutes)) then raise exception 'Alias mapping would merge overlapping active bookings' using errcode='23P01';end if;
 end if;
 state:=case p_action when 'draft' then 'draft' when 'publish' then 'published' else 'retired' end;
 insert into appointment_catalog_versions(id,entry_id,version,state,definition,review_note,actor_id)
 values(vid,p_id,coalesce(e.version,0)+1,state,p_values->'definition',p_values->>'review_note',a);
 if e.id is null then
  insert into appointment_catalog_entries(id,kind,version,current_version_id,created_by) values(p_id,p_kind,1,vid,a);
 else update appointment_catalog_entries set version=version+1,current_version_id=vid,
  published_version_id=case p_action when 'publish' then vid when 'retire' then null else published_version_id end where id=p_id;end if;
 if p_action='publish' and p_kind='resource' then
  foreach s in array aliases loop insert into appointment_resource_aliases(alias,resource_id,reviewed_version_id,actor_id) values(lower(btrim(s)),p_id,vid,a) on conflict(alias) do nothing;end loop;
 end if;
 receipt:=public.appointment_catalog_entry_view(p_id,true);
 insert into appointment_catalog_actions(id,actor_id,request,receipt) values(p_action_id,a,req,receipt);
 return receipt;
end $$;
create function public.recover_appointment_catalog_action(p_actor_id uuid,p_action_id uuid,p_id uuid,p_expected_version integer,p_kind text,p_action text,p_values jsonb) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a uuid:=public.appointment_catalog_reviewer();r appointment_catalog_actions;begin
 if a is distinct from p_actor_id then raise exception 'Matched actor required' using errcode='42501';end if;
 select * into r from appointment_catalog_actions where id=p_action_id;if not found then return null;end if;
 if r.actor_id<>a or r.request is distinct from jsonb_build_object('id',p_id,'expected_version',p_expected_version,'kind',p_kind,'action',p_action,'values',p_values) then raise exception 'Catalog action context changed' using errcode='23505';end if;
 return r.receipt;
end $$;

-- One core owns scheduling/reminders. Only the private managed path can insert a preassigned ID.
alter function public.save_appointment(uuid,uuid,integer,uuid,uuid,timestamptz,integer,text,public.appointment_status,uuid,text,text,integer,integer,text,text,integer[]) rename to save_appointment_before_catalog;
do $$declare d text;begin
 d:=pg_get_functiondef('public.save_appointment_before_catalog(uuid,uuid,integer,uuid,uuid,timestamptz,integer,text,public.appointment_status,uuid,text,text,integer,integer,text,text,integer[])'::regprocedure);
 if position('if not found or previous.version is distinct from p_expected_version then' in d)=0 or position('lower(a.resource_name)=lower(trim(p_resource_name))' in d)=0 then raise exception 'Canonical appointment core source changed';end if;
 d:=replace(d,'if not found or previous.version is distinct from p_expected_version then','if (not found and p_expected_version is not null) or (found and previous.version is distinct from p_expected_version) then');
 d:=replace(d,'if p_id is null then','if previous.id is null then');
 d:=replace(d,'insert into public.appointments(client_id,','insert into public.appointments(id,client_id,');
 d:=replace(d,'values(p_client_id,p_pet_id,scheduled_at,','values(coalesce(p_id,gen_random_uuid()),p_client_id,p_pet_id,scheduled_at,');
 -- The current core uses p_scheduled_at; fail if the ID insertion did not match.
 d:=replace(d,'values(p_client_id,p_pet_id,p_scheduled_at,','values(coalesce(p_id,gen_random_uuid()),p_client_id,p_pet_id,p_scheduled_at,');
 d:=replace(d,'lower(a.resource_name)=lower(trim(p_resource_name))','public.appointment_resource_key(a.id,a.resource_name)=public.appointment_resource_key(p_id,p_resource_name)');
 if position('values(coalesce(p_id,gen_random_uuid()),' in d)=0 then raise exception 'Canonical booking insertion changed';end if;
 execute d;
end $$;
create function public.save_appointment(p_actor_id uuid,p_id uuid,p_expected_version integer,p_client_id uuid,p_pet_id uuid,p_scheduled_at timestamptz,p_duration_minutes integer,p_appointment_type text,p_status public.appointment_status,p_assigned_dvm_id uuid,p_visit_type text,p_address_snapshot text,p_travel_before_minutes integer,p_travel_after_minutes integer,p_resource_name text,p_notes text,p_reminder_offsets integer[]) returns public.appointments language plpgsql security definer set search_path=public as $$
begin
 if public.clinical_require_staff() is distinct from p_actor_id then raise exception 'Matched actor required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(73260123);perform public.clinical_require_staff();
 if p_id is not null and not exists(select 1 from appointments where id=p_id and version=p_expected_version) then raise exception 'Appointment changed; reload before saving' using errcode='PT409';end if;
 return public.save_appointment_before_catalog(p_actor_id,p_id,p_expected_version,p_client_id,p_pet_id,p_scheduled_at,p_duration_minutes,p_appointment_type,p_status,p_assigned_dvm_id,p_visit_type,p_address_snapshot,p_travel_before_minutes,p_travel_after_minutes,p_resource_name,p_notes,p_reminder_offsets);
end $$;
create or replace function public.save_appointment(p_id uuid,p_expected_version integer,p_client_id uuid,p_pet_id uuid,p_scheduled_at timestamptz,p_duration_minutes integer,p_appointment_type text,p_status public.appointment_status,p_assigned_dvm_id uuid,p_notes text) returns public.appointments language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();r appointments;begin
 perform pg_advisory_xact_lock(73260123);
 if p_id is not null then select * into r from appointments where id=p_id for update;if not found or r.version is distinct from p_expected_version then raise exception 'Appointment changed; reload before saving' using errcode='PT409';end if;end if;
 return public.save_appointment(a,p_id,p_expected_version,p_client_id,p_pet_id,p_scheduled_at,p_duration_minutes,p_appointment_type,coalesce(p_status,'SCHEDULED'::public.appointment_status),p_assigned_dvm_id,coalesce(r.visit_type,'clinic'),coalesce(r.address_snapshot,'2619 Spruce Street, Boulder, CO'),coalesce(r.travel_before_minutes,0),coalesce(r.travel_after_minutes,0),r.resource_name,p_notes,coalesce(r.reminder_offsets,array[48,24]));
end $$;
alter function public.cancel_appointment(uuid,integer) rename to cancel_appointment_before_catalog;
create function public.cancel_appointment(p_id uuid,p_expected_version integer) returns public.appointments language plpgsql security definer set search_path=public as $$
begin perform public.clinical_require_staff();perform pg_advisory_xact_lock(73260123);return public.cancel_appointment_before_catalog(p_id,p_expected_version);end $$;

create function public.guard_appointment_catalog(p_new public.appointments,p_old public.appointments) returns void language plpgsql security definer set search_path=public as $$
declare b appointment_catalog_bindings;s jsonb;begin
 select * into b from appointment_catalog_bindings where appointment_id=p_new.id and appointment_version<=p_new.version order by appointment_version desc limit 1;
 if found then
  s:=b.snapshot->'fields';
  if row(p_new.client_id,p_new.pet_id,p_new.appointment_type,p_new.visit_type,p_new.duration_minutes,p_new.travel_before_minutes,p_new.travel_after_minutes,p_new.resource_name) is distinct from
    row((s->>'client_id')::uuid,(s->>'pet_id')::uuid,s->>'appointment_type',s->>'visit_type',(s->>'duration_minutes')::integer,(s->>'travel_before_minutes')::integer,(s->>'travel_after_minutes')::integer,nullif(s->>'resource_name','')) then raise exception 'Reviewed booking fields require a new catalog booking review' using errcode='23514';end if;
  if b.snapshot#>>'{type,definition,staffing}'='dvm' and not exists(select 1 from user_roles where user_id=p_new.assigned_dvm_id and role='DVM') and not coalesce(p_new.status='CANCELLED' and p_new.assigned_dvm_id=p_old.assigned_dvm_id,false) then raise exception 'Reviewed type requires a veterinarian' using errcode='23514';end if;
 elsif ((p_old.id is null or p_new.appointment_type is distinct from p_old.appointment_type) and exists(select 1 from appointment_catalog_entries e join appointment_catalog_versions v on v.id=e.published_version_id where e.kind='type' and lower(v.definition->>'name')=lower(btrim(p_new.appointment_type)))) or ((p_old.id is null or p_new.resource_name is distinct from p_old.resource_name) and exists(select 1 from appointment_resource_aliases where alias=lower(btrim(p_new.resource_name)))) then
  raise exception 'Use the reviewed booking workflow for a known type or resource' using errcode='23514';
 end if;
end $$;
do $$declare d text;begin
 d:=pg_get_functiondef('public.guard_appointment_write()'::regprocedure);
 if position('return new;' in d)=0 then raise exception 'Appointment guard source changed';end if;
 d:=replace(d,'return new;','perform public.guard_appointment_catalog(new,case when tg_op=''UPDATE'' then old else null::public.appointments end); return new;');
 execute d;
end $$;
-- RPCs hold the schedule lock before row locks. A direct service UPDATE would reverse this order.
revoke insert,update on public.appointments from service_role;

create function public.save_catalog_appointment(p_actor_id uuid,p_action_id uuid,p_id uuid,p_expected_version integer,p_values jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();req jsonb;old appointment_booking_actions;t appointment_catalog_versions;r appointment_catalog_versions;
 patient pets;target uuid:=coalesce(p_id,gen_random_uuid());av integer:=coalesce(p_expected_version,0)+1;previous appointments;result appointments;
 def jsonb;fields jsonb;snapshot jsonb;receipt jsonb;note text;duration integer;beforemin integer;aftermin integer;mode text;staffid uuid;offsets integer[];reminder_element jsonb;begin
 if a is distinct from p_actor_id or p_action_id is null then raise exception 'Matched actor and action required' using errcode='42501';end if;
 req:=jsonb_build_object('id',p_id,'expected_version',p_expected_version,'values',p_values);
 perform pg_advisory_xact_lock(73260123);perform public.clinical_require_staff();
 select * into old from appointment_booking_actions where id=p_action_id;
 if found then if old.actor_id<>a or old.request is distinct from req then raise exception 'Booking action belongs to different work' using errcode='23505';end if;return old.receipt;end if;
 perform public.native_rx_keys(p_values,array['type_version_id','resource_version_id','client_id','pet_id','scheduled_at','duration_minutes','status','assigned_dvm_id','visit_type','address_snapshot','travel_before_minutes','travel_after_minutes','notes','reminder_offsets','override_note']);
 if jsonb_typeof(p_values->'scheduled_at') is distinct from 'string' or jsonb_typeof(p_values->'status') is distinct from 'string' or p_values->>'status' not in('SCHEDULED','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW') or jsonb_typeof(p_values->'visit_type') is distinct from 'string' or jsonb_typeof(p_values->'notes') not in('string','null') then raise exception 'Typed booking fields required' using errcode='23514';end if;
 perform public.native_rx_text(p_values->'address_snapshot',1000);
 select * into t from appointment_catalog_versions where id=public.native_rx_uuid(p_values->'type_version_id');
 if not found or t.state<>'published' or not exists(select 1 from appointment_catalog_entries where id=t.entry_id and kind='type' and published_version_id=t.id) then raise exception 'Selected appointment type changed; review its current publication' using errcode='PT409';end if;
 def:=t.definition;mode:=p_values->>'visit_type';
 select * into patient from pets where id=public.native_rx_uuid(p_values->'pet_id');
 if not found or patient.client_id is distinct from public.native_rx_uuid(p_values->'client_id') or not exists(select 1 from jsonb_array_elements_text(def->'species')x where lower(x)=lower(btrim(patient.species))) or not def->'visit_types' @> to_jsonb(array[mode]) then raise exception 'Reviewed type does not match patient species or visit mode' using errcode='23514';end if;
 duration:=public.appointment_catalog_integer(p_values->'duration_minutes',15,480);beforemin:=public.appointment_catalog_integer(p_values->'travel_before_minutes',0,240);aftermin:=public.appointment_catalog_integer(p_values->'travel_after_minutes',0,240);
 note:=p_values->>'override_note';if jsonb_typeof(p_values->'override_note') is distinct from 'string' or length(note)>2000 then raise exception 'Booking review note required' using errcode='23514';end if;
 if def->'duration_minutes'='null'::jsonb or duration is distinct from (def->>'duration_minutes')::integer or beforemin<>(def->>'travel_before_minutes')::integer or aftermin<>(def->>'travel_after_minutes')::integer then
  perform public.native_rx_text(p_values->'override_note',2000);
  if (def->'duration_minutes'<>'null'::jsonb and duration is distinct from (def->>'duration_minutes')::integer or beforemin<>(def->>'travel_before_minutes')::integer or aftermin<>(def->>'travel_after_minutes')::integer) and (def->>'allow_override')::boolean is not true then raise exception 'Reviewed type does not permit a time override' using errcode='23514';end if;
 end if;
 if p_values->'resource_version_id'<>'null'::jsonb then
  select * into r from appointment_catalog_versions where id=public.native_rx_uuid(p_values->'resource_version_id');
  if not found or r.state<>'published' or not exists(select 1 from appointment_catalog_entries where id=r.entry_id and kind='resource' and published_version_id=r.id) then raise exception 'Selected resource changed; review its current publication' using errcode='PT409';end if;
  if not r.definition->'visit_types' @> to_jsonb(array[mode]) or (def->'resource_kind'<>'null'::jsonb and r.definition->>'resource_kind'<>def->>'resource_kind') then raise exception 'Resource does not match the reviewed type or mode' using errcode='23514';end if;
 elsif def->'resource_kind'<>'null'::jsonb then raise exception 'Reviewed type requires a resource' using errcode='23514';end if;
 staffid:=public.native_rx_uuid(p_values->'assigned_dvm_id');
 if def->>'staffing'='dvm' and not exists(select 1 from user_roles where user_id=staffid and role='DVM') then raise exception 'Reviewed type requires a veterinarian' using errcode='23514';end if;
 if jsonb_typeof(p_values->'reminder_offsets') is distinct from 'array' or jsonb_array_length(p_values->'reminder_offsets')>5 then raise exception 'Bounded reminders required' using errcode='23514';end if;
 for reminder_element in select value from jsonb_array_elements(p_values->'reminder_offsets') loop perform public.appointment_catalog_integer(reminder_element,1,720);end loop;
 select coalesce(array_agg(value::integer),'{}') into offsets from jsonb_array_elements_text(p_values->'reminder_offsets');
 if p_id is not null then select * into previous from appointments where id=p_id for update;if not found or previous.version is distinct from p_expected_version then raise exception 'Appointment changed; reload before review' using errcode='PT409';end if;
 elsif p_expected_version is not null then raise exception 'New appointment has no previous version' using errcode='PT409';end if;
 fields:=jsonb_build_object('client_id',patient.client_id,'pet_id',patient.id,'appointment_type',def->>'name','visit_type',mode,'duration_minutes',duration,'travel_before_minutes',beforemin,'travel_after_minutes',aftermin,'resource_name',r.definition->>'name');
 snapshot:=jsonb_build_object('type',to_jsonb(t),'resource',case when r.id is null then null else to_jsonb(r) end,'fields',fields,'override_note',note);
 insert into appointment_catalog_bindings(appointment_id,appointment_version,type_version_id,resource_version_id,snapshot,actor_id) values(target,av,t.id,r.id,snapshot,a);
 result:=public.save_appointment_before_catalog(a,target,p_expected_version,patient.client_id,patient.id,public.appointment_catalog_instant(p_values->'scheduled_at'),duration,def->>'name',(p_values->>'status')::public.appointment_status,staffid,mode,p_values->>'address_snapshot',beforemin,aftermin,r.definition->>'name',p_values->>'notes',offsets);
 receipt:=jsonb_build_object('appointment',to_jsonb(result),'binding',snapshot);
 insert into appointment_booking_actions(id,actor_id,request,receipt) values(p_action_id,a,req,receipt);
 return receipt;
end $$;
create function public.recover_catalog_appointment(p_actor_id uuid,p_action_id uuid,p_id uuid,p_expected_version integer,p_values jsonb) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();r appointment_booking_actions;begin
 if a is distinct from p_actor_id then raise exception 'Matched actor required' using errcode='42501';end if;
 select * into r from appointment_booking_actions where id=p_action_id;if not found then return null;end if;
 if r.actor_id<>a or r.request is distinct from jsonb_build_object('id',p_id,'expected_version',p_expected_version,'values',p_values) then raise exception 'Booking action context changed' using errcode='23505';end if;return r.receipt;
end $$;
create function public.read_appointment_catalog_binding(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();v integer;result jsonb;begin
 select version into v from appointments where id=p_id;if not found then return null;end if;
 select snapshot into result from appointment_catalog_bindings where appointment_id=p_id and appointment_version<=v order by appointment_version desc limit 1;
 return result;
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and
 (proname like 'appointment_catalog_%' or proname in('validate_appointment_catalog_definition','list_appointment_catalog','appointment_resource_key','save_appointment_catalog','recover_appointment_catalog_action','save_appointment_before_catalog','cancel_appointment_before_catalog','guard_appointment_catalog','save_catalog_appointment','recover_catalog_appointment','read_appointment_catalog_binding','save_appointment','cancel_appointment')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in('list_appointment_catalog','save_appointment_catalog','recover_appointment_catalog_action','save_catalog_appointment','recover_catalog_appointment','read_appointment_catalog_binding','save_appointment','cancel_appointment') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
