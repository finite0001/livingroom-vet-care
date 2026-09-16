-- Operational intake is not clinical approval or dispensing authority.
revoke insert,update,delete,truncate,references,trigger on public.refill_requests from authenticated,service_role,anon;
do $$declare p record;begin for p in select policyname from pg_policies where schemaname='public' and tablename='refill_requests' and cmd<>'SELECT' loop execute format('drop policy %I on public.refill_requests',p.policyname);end loop;end $$;
create function public.guard_legacy_refill_history() returns trigger language plpgsql set search_path=public as $$begin raise exception 'Legacy refill history is read-only and unverified' using errcode='23514';end $$;
create trigger legacy_refill_read_only before insert or update or delete on public.refill_requests for each row execute function public.guard_legacy_refill_history();
create trigger legacy_refill_no_truncate before truncate on public.refill_requests for each statement execute function public.guard_legacy_refill_history();
create table public.native_refills (
 id uuid primary key,pet_id uuid not null references public.pets(id),client_id uuid not null references public.clients(id),version integer not null check(version>0),
 state text not null check(state in ('open','closed','denied')),medication_requested text not null,requester_note text,channel text not null check(channel in ('phone','email','text','in_person','other')),
 assigned_to uuid references public.profiles(id),authorization_id uuid references public.native_prescription_authorizations(id),authorization_hash text,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null,updated_by uuid not null references public.profiles(id),updated_at timestamptz not null,
 check((authorization_id is null)=(authorization_hash is null)),check(authorization_hash is null or authorization_hash ~ '^[a-f0-9]{64}$')
);
create table public.native_refill_events (
 id uuid primary key,refill_id uuid not null references public.native_refills(id),revision integer not null check(revision>0),action text not null check(action in ('create','assign','link','close','deny')),
 actor_id uuid not null references public.profiles(id),reason text not null,prior_event_id uuid unique references public.native_refill_events(id),before_snapshot jsonb,after_snapshot jsonb not null,link_context jsonb,created_at timestamptz not null,
 unique(refill_id,revision),check((prior_event_id is null)=(revision=1)),check((action='create')=(before_snapshot is null)),check((action='link')=(link_context is not null))
);
create table public.native_refill_operations (
 id uuid primary key,actor_id uuid not null references public.profiles(id),operation text not null check(operation in ('create','transition')),request jsonb not null,request_hash text not null,result jsonb not null,created_at timestamptz not null
);
create index native_refill_queue on public.native_refills(created_at desc,id desc);
create index native_refill_patient_queue on public.native_refills(pet_id,created_at desc,id desc);
create index native_refill_history on public.native_refill_events(refill_id,created_at desc,id desc);
alter table public.native_refills enable row level security;alter table public.native_refill_events enable row level security;alter table public.native_refill_operations enable row level security;
revoke all on public.native_refills,public.native_refill_events,public.native_refill_operations from public,anon,authenticated,service_role;
create trigger native_refill_event_immutable before update or delete on public.native_refill_events for each row execute function public.guard_inquiry_history();
create trigger native_refill_operation_immutable before update or delete on public.native_refill_operations for each row execute function public.guard_inquiry_history();
create trigger native_refill_audit after insert or update on public.native_refills for each row execute function public.native_rx_audit();
create trigger native_refill_event_audit after insert on public.native_refill_events for each row execute function public.native_rx_audit();
create function public.native_refill_receipt(r public.native_refill_operations) returns jsonb language sql immutable set search_path=public as $$select jsonb_build_object('version',1,'id',r.id,'actor_id',r.actor_id,'request',r.request,'request_hash',r.request_hash,'result',r.result,'created_at',r.created_at)$$;
create function public.native_refill_event(e public.native_refill_events) returns jsonb language sql immutable set search_path=public as $$select jsonb_build_object('version',1,'id',e.id,'refill_id',e.refill_id,'revision',e.revision,'action',e.action,'actor_id',e.actor_id,'reason',e.reason,'prior_event_id',e.prior_event_id,'before',e.before_snapshot,'after',e.after_snapshot,'link_context',e.link_context,'created_at',e.created_at)$$;
create function public.native_refill_begin(p_id uuid,p_operation text,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();r public.native_refill_operations;
begin
 if p_id is null or jsonb_typeof(p_request) is distinct from 'object' then raise exception 'Exact refill operation required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-refill-operation:'||p_id::text,0));perform public.clinical_require_staff();
 select * into r from public.native_refill_operations where id=p_id;
 if found then if r.actor_id<>a or r.operation<>p_operation or r.request is distinct from p_request then raise exception 'Refill operation identity cannot change' using errcode='23514';end if;return public.native_refill_receipt(r);end if;
 return null;
end $$;
create function public.native_refill_finish(p_id uuid,p_operation text,p_request jsonb,p_before jsonb,p_after public.native_refills,p_action text,p_link jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();e public.native_refill_events;r public.native_refill_operations;prior uuid;
begin
 select id into prior from public.native_refill_events where refill_id=p_after.id order by revision desc limit 1;
 insert into public.native_refill_events values(p_id,p_after.id,p_after.version,p_action,a,p_request->>'reason',prior,p_before,to_jsonb(p_after),p_link,clock_timestamp()) returning * into e;
 insert into public.native_refill_operations values(p_id,a,p_operation,p_request,encode(sha256(convert_to(p_request::text,'UTF8')),'hex'),public.native_refill_event(e),clock_timestamp()) returning * into r;
 return public.native_refill_receipt(r);
end $$;
create function public.recover_native_refill_operation(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$declare a uuid:=public.clinical_require_staff();r public.native_refill_operations;begin select * into r from public.native_refill_operations where id=p_id and actor_id=a;if not found then return null;end if;return public.native_refill_receipt(r);end $$;
create function public.create_native_refill(p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();r jsonb;ri uuid;pet uuid;client uuid;p public.pets;f public.native_refills;stamp timestamptz;
begin
 r:=public.native_refill_begin(p_id,'create',p_request);if r is not null then return r;end if;
 perform public.native_rx_keys(p_request,array['refill_id','pet_id','client_id','medication_requested','requester_note','channel','reason']);
 ri:=public.native_rx_uuid(p_request->'refill_id');pet:=public.native_rx_uuid(p_request->'pet_id');client:=public.native_rx_uuid(p_request->'client_id');
 perform public.native_rx_text(p_request->'medication_requested',500);if p_request->'requester_note' is distinct from 'null'::jsonb then perform public.native_rx_text(p_request->'requester_note',4000);end if;perform public.native_rx_text(p_request->'reason',2000);
 if p_request->>'channel' is null or p_request->>'channel' not in ('phone','email','text','in_person','other') then raise exception 'Invalid refill intake channel' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-refill:'||ri::text,0));perform public.clinical_require_staff();
 if exists(select 1 from public.native_refills where id=ri) then raise exception 'Refill changed' using errcode='40001';end if;
 select * into p from public.pets where id=pet for share;
 if not found or p.client_id<>client or p.archived_at is not null or p.deceased_at is not null then raise exception 'Current active refill patient and household required' using errcode='23514';end if;
 stamp:=clock_timestamp();insert into public.native_refills values(ri,pet,client,1,'open',p_request->>'medication_requested',p_request->>'requester_note',p_request->>'channel',null,null,null,a,stamp,a,stamp) returning * into f;
 return public.native_refill_finish(p_id,'create',p_request,null,f,'create',null);
end $$;
create function public.preview_native_refill_link(p_refill_id uuid,p_pet_id uuid,p_authorization_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();f public.native_refills;p public.pets;d jsonb;s jsonb;c jsonb;
begin
 if p_refill_id is null or p_authorization_id is null then raise exception 'Exact refill and authorization required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-refill:'||p_refill_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||p_authorization_id::text,0));perform public.clinical_require_staff();
 select * into f from public.native_refills where id=p_refill_id and pet_id=p_pet_id;
 if not found then raise exception 'Exact refill patient required' using errcode='23514';end if;
 select * into p from public.pets where id=f.pet_id for share;
 d:=public.native_rx_verified_authorization(p_authorization_id);
 if f.state<>'open' or p.client_id<>f.client_id or p.archived_at is not null or p.deceased_at is not null then raise exception 'Current open refill patient and household required' using errcode='23514';end if;
 if d is null or d->>'pet_id'<>f.pet_id::text or d->>'client_id'<>f.client_id::text then raise exception 'Exact authorization patient and household required' using errcode='23514';end if;
 s:=public.read_native_prescription_status(p_authorization_id,f.pet_id);
 c:=jsonb_build_object('version',1,'refill_id',f.id,'refill_version',f.version,'pet_id',f.pet_id,'client_id',f.client_id,'patient_version',p.version,'authorization_id',p_authorization_id,'authorization_hash',d->>'authorization_hash','authorization_head_id',s->'head_id','authorization_head_version',s->'head_version','authorization_state',s#>'{status,state}');
 return jsonb_build_object('version',1,'actor_id',a,'context',c,'context_hash',encode(sha256(convert_to(c::text,'UTF8')),'hex'),'observed_at',clock_timestamp());
end $$;
create function public.transition_native_refill(p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();r jsonb;ri uuid;pet uuid;ev integer;assignee uuid;linked_auth uuid;f public.native_refills;p public.pets;before_doc jsonb;action text;preview jsonb;link jsonb;
begin
 r:=public.native_refill_begin(p_id,'transition',p_request);if r is not null then return r;end if;
 perform public.native_rx_keys(p_request,array['refill_id','pet_id','expected_version','action','reason','assigned_to','authorization_id','expected_link_context_hash']);
 ri:=public.native_rx_uuid(p_request->'refill_id');pet:=public.native_rx_uuid(p_request->'pet_id');ev:=public.native_rx_revision(p_request->'expected_version');assignee:=public.native_rx_uuid(p_request->'assigned_to',true);linked_auth:=public.native_rx_uuid(p_request->'authorization_id',true);perform public.native_rx_text(p_request->'reason',2000);action:=p_request->>'action';
 if ev is null or action is null or action not in ('assign','link','close','deny') or (action<>'assign' and assignee is not null) or (action='link' and (linked_auth is null or jsonb_typeof(p_request->'expected_link_context_hash') is distinct from 'string' or p_request->>'expected_link_context_hash' !~ '^[a-f0-9]{64}$')) or (action<>'link' and (linked_auth is not null or p_request->'expected_link_context_hash' is distinct from 'null'::jsonb)) then raise exception 'Exact operational refill transition required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-refill:'||ri::text,0));perform public.clinical_require_staff();
 select * into f from public.native_refills where id=ri and pet_id=pet for update;
 if not found or f.version<>ev then raise exception 'Refill changed' using errcode='40001';end if;
 if f.state<>'open' then raise exception 'Refill is already terminal' using errcode='23514';end if;
 before_doc:=to_jsonb(f);
 if action='link' then
 preview:=public.preview_native_refill_link(ri,pet,linked_auth);link:=preview->'context';
 if preview->>'context_hash' is distinct from p_request->>'expected_link_context_hash' then raise exception 'Refill authorization context changed' using errcode='40001';end if;
 if link->>'authorization_state'<>'active' then raise exception 'Active authorization required for new refill link' using errcode='23514';end if;
 f.authorization_id:=linked_auth;f.authorization_hash:=link->>'authorization_hash';
 elsif action='assign' then
 select * into p from public.pets where id=pet for share;
 if p.client_id<>f.client_id or p.archived_at is not null or p.deceased_at is not null then raise exception 'Current open refill patient and household required' using errcode='23514';end if;
 if assignee is not null and not public.is_active_staff(assignee) then raise exception 'Active staff assignee required' using errcode='23514';end if;
 f.assigned_to:=assignee;
 else f.state:=case action when 'close' then 'closed' else 'denied' end;
 end if;
 perform public.clinical_require_staff();
 if action='assign' and assignee is not null and not public.is_active_staff(assignee) then raise exception 'Active staff assignee required' using errcode='23514';end if;
 update public.native_refills set version=version+1,state=f.state,assigned_to=f.assigned_to,authorization_id=f.authorization_id,authorization_hash=f.authorization_hash,updated_by=a,updated_at=clock_timestamp() where id=ri returning * into f;
 return public.native_refill_finish(p_id,'transition',p_request,before_doc,f,action,link);
end $$;
create function public.native_refill_read_projection(f public.native_refills) returns jsonb language plpgsql security definer set search_path=public as $$
declare household uuid;head uuid;s jsonb;
begin
 select client_id into household from public.pets where id=f.pet_id;select id into head from public.native_refill_events where refill_id=f.id and revision=f.version;
 if f.authorization_id is not null then s:=public.read_native_prescription_status(f.authorization_id,f.pet_id);end if;
 return jsonb_build_object('version',1,'refill',to_jsonb(f),'head_id',head,'current_household_id',household,'household_matches',household=f.client_id,'authorization_status',s->'status','authorization_usage',s->'usage','operational_only',true);
end $$;
create function public.read_native_refill(p_refill_id uuid,p_pet_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$declare f public.native_refills;begin perform public.clinical_require_staff();select * into f from public.native_refills where id=p_refill_id and pet_id=p_pet_id;if not found then return null;end if;return public.native_refill_read_projection(f);end $$;
create function public.native_refill_cursor(p_before_at timestamptz,p_before_id uuid,p_limit integer) returns void language plpgsql immutable set search_path=public as $$begin if (p_before_at is null)<>(p_before_id is null) or (p_before_at is not null and not isfinite(p_before_at)) or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid refill cursor' using errcode='23514';end if;end $$;
create function public.list_native_refills(p_pet_id uuid default null,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language plpgsql security definer set search_path=public as $$
declare f public.native_refills;entries jsonb:='[]';counted integer:=0;cursor jsonb;more boolean:=false;
begin
 perform public.clinical_require_staff();perform public.native_refill_cursor(p_before_at,p_before_id,p_limit);
 -- Preserve deterministic immutable queue order while projecting exact revision heads.
 for f in select * from public.native_refills where (p_pet_id is null or pet_id=p_pet_id) and (p_before_at is null or (created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit p_limit+1 loop
 counted:=counted+1;if counted>p_limit then more:=true;exit;end if;
 entries:=entries||jsonb_build_array(public.native_refill_read_projection(f));cursor:=jsonb_build_object('before_at',f.created_at,'before_id',f.id);
 end loop;
 return jsonb_build_object('version',1,'refills',entries,'has_more',more,'next_cursor',case when more then cursor else null end);
end $$;
create function public.list_native_refill_events(p_refill_id uuid,p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language plpgsql security definer set search_path=public as $$declare result jsonb;begin
 perform public.clinical_require_staff();perform public.native_refill_cursor(p_before_at,p_before_id,p_limit);
 if not exists(select 1 from public.native_refills where id=p_refill_id and pet_id=p_pet_id) then raise exception 'Exact refill patient required' using errcode='23514';end if;
 with bounded as materialized(select * from public.native_refill_events where refill_id=p_refill_id and (p_before_at is null or (created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit p_limit+1),selected as materialized(select * from bounded order by created_at desc,id desc limit p_limit)
 select jsonb_build_object('version',1,'refill_id',p_refill_id,'pet_id',p_pet_id,'events',(select coalesce(jsonb_agg(public.native_refill_event(e) order by created_at desc,id desc),'[]') from selected e),'has_more',(select count(*)>p_limit from bounded),'next_cursor',case when(select count(*)>p_limit from bounded) then(select jsonb_build_object('before_at',created_at,'before_id',id) from selected order by created_at,id limit 1) else null end) into result;return result;
end $$;
create function public.list_legacy_refills(p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language plpgsql security definer set search_path=public as $$declare result jsonb;begin
 perform public.clinical_require_staff();perform public.native_refill_cursor(p_before_at,p_before_id,p_limit);
 with bounded as materialized(select * from public.refill_requests where p_before_at is null or (created_at,id)<(p_before_at,p_before_id) order by created_at desc,id desc limit p_limit+1),selected as materialized(select * from bounded order by created_at desc,id desc limit p_limit)
 select jsonb_build_object('version',1,'records',(select coalesce(jsonb_agg(jsonb_build_object('record',to_jsonb(r),'client_name',concat_ws(' ',c.first_name,c.last_name),'pet_name',p.name,'assigned_to_name',a.full_name,'read_only',true,'clinical_authority','unverified') order by r.created_at desc,r.id desc),'[]') from selected r join public.clients c on c.id=r.client_id left join public.pets p on p.id=r.pet_id left join public.profiles a on a.id=r.assigned_to_id),'has_more',(select count(*)>p_limit from bounded),'next_cursor',case when(select count(*)>p_limit from bounded) then(select jsonb_build_object('before_at',created_at,'before_id',id) from selected order by created_at,id limit 1) else null end) into result;return result;
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and (proname like 'native_refill_%' or proname in ('guard_legacy_refill_history','create_native_refill','transition_native_refill','recover_native_refill_operation','preview_native_refill_link','read_native_refill','list_native_refills','list_native_refill_events','list_legacy_refills')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.proname not like 'native_refill_%' and f.proname<>'guard_legacy_refill_history' then execute format('grant execute on function %s to authenticated',f.signature);end if;end loop;
end $$;
