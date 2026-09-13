-- Operator retry cycles preserve signed provider facts and never resolve consent or delivery.
alter table public.communication_provider_events add column cycle_no integer not null default 0 check(cycle_no>=0),add column cycle_attempts integer not null default 0 check(cycle_attempts between 0 and 10),add column revision integer not null default 1;
update public.communication_provider_events set cycle_attempts=least(attempts,10);
create table public.communication_processing_history (
 id bigint generated always as identity primary key,event_id uuid not null references public.communication_provider_events(id),action text not null,
 state text not null,attempts integer not null,cycle_no integer not null,cycle_attempts integer not null,revision integer not null,last_error text,
 created_at timestamptz not null default clock_timestamp()
);
create table public.communication_event_retry_actions (
 id uuid primary key,actor_id uuid not null references auth.users(id),event_id uuid not null references public.communication_provider_events(id),expected_work_hash text not null,
 reason text not null check(reason in ('provider_recovered','configuration_repaired','processor_repaired')),previous_cycle_no integer not null,cycle_no integer not null,
 lifetime_attempts integer not null,created_at timestamptz not null default clock_timestamp(),unique(event_id,cycle_no)
);
create index communication_processing_history_event on public.communication_processing_history(event_id,id);
create index communication_retry_actor_cursor on public.communication_event_retry_actions(actor_id,created_at desc,id desc);
create index communication_processing_queue_cursor on public.communication_provider_events(received_at desc,id desc);
insert into public.communication_processing_history(event_id,action,state,attempts,cycle_no,cycle_attempts,revision,last_error)
select id,'legacy_snapshot',state,attempts,cycle_no,cycle_attempts,revision,case when last_error in ('provider_content_requires_review','provider_fetch_or_persistence_retry') then last_error when last_error is not null then 'legacy_review_required' end from public.communication_provider_events;
create function public.guard_communication_processing_history() returns trigger language plpgsql set search_path=public as $$begin raise exception 'Processing history is immutable' using errcode='23514';end $$;
revoke all on function public.guard_communication_processing_history() from public,anon,authenticated,service_role;
do $$declare t text;begin foreach t in array array['communication_processing_history','communication_event_retry_actions'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger immutable_processing_history before update or delete on public.%I for each row execute function public.guard_communication_processing_history()',t);
end loop;end $$;
-- No frontend consumes raw event rows. Keep service read contract; staff use bounded safe projections.
revoke select on public.communication_provider_events from authenticated;
create function public.guard_communication_provider_identity() returns trigger language plpgsql set search_path=public as $$begin
 if TG_OP='DELETE' then raise exception 'Signed receipt history cannot be deleted' using errcode='23514';end if;
 if row(NEW.id,NEW.provider,NEW.event_id,NEW.resource_id,NEW.event_type,NEW.payload_hash,NEW.metadata,NEW.received_at) is distinct from row(OLD.id,OLD.provider,OLD.event_id,OLD.resource_id,OLD.event_type,OLD.payload_hash,OLD.metadata,OLD.received_at) then raise exception 'Signed provider receipt is immutable' using errcode='23514';end if;
 NEW.revision:=OLD.revision+1;return NEW;
end $$;
create trigger immutable_communication_provider_identity before update or delete on public.communication_provider_events for each row execute function public.guard_communication_provider_identity();
create function public.record_communication_processing_history() returns trigger language plpgsql security definer set search_path=public as $$begin
 insert into public.communication_processing_history(event_id,action,state,attempts,cycle_no,cycle_attempts,revision,last_error) values(NEW.id,
 case when TG_OP='INSERT' then 'received' when NEW.cycle_no>OLD.cycle_no then 'admin_requeued' when NEW.state='claimed' then 'claimed' when NEW.state='processed' then 'processed' when NEW.last_error='worker_lease_expired' then 'lease_expired' when NEW.state='review' then 'review' else 'retry_scheduled' end,
 NEW.state,NEW.attempts,NEW.cycle_no,NEW.cycle_attempts,NEW.revision,case when NEW.last_error in ('provider_content_requires_review','provider_fetch_or_persistence_retry','worker_lease_expired') then NEW.last_error when NEW.last_error is not null then 'legacy_review_required' end);return NEW;
end $$;
create trigger record_communication_processing_history after insert or update on public.communication_provider_events for each row execute function public.record_communication_processing_history();
revoke all on function public.guard_communication_provider_identity(),public.record_communication_processing_history() from public,anon,authenticated,service_role;
create or replace function public.claim_communication_event() returns public.communication_provider_events language plpgsql security definer set search_path=public as $$
declare result public.communication_provider_events;
begin
 perform public.communication_require_service();
 -- Bounded, skip-locked recovery counts crashed claims within the same allowance.
 with expired as (select id from public.communication_provider_events where state='claimed' and lease_expires_at<=clock_timestamp() order by lease_expires_at,id for update skip locked limit 100)
 update public.communication_provider_events e set state=case when cycle_attempts>=10 then 'review' else 'pending' end,lease_token=null,lease_expires_at=null,last_error='worker_lease_expired',available_at=clock_timestamp() from expired x where e.id=x.id;
 with exhausted as (select id from public.communication_provider_events where state='pending' and cycle_attempts>=10 order by received_at,id for update skip locked limit 100)
 update public.communication_provider_events e set state='review',last_error='worker_lease_expired' from exhausted x where e.id=x.id;
 select * into result from public.communication_provider_events where state='pending' and cycle_attempts<10 and available_at<=clock_timestamp() order by received_at,id for update skip locked limit 1;
 if not found then return null;end if;
 update public.communication_provider_events set state='claimed',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '2 minutes',attempts=attempts+1,cycle_attempts=cycle_attempts+1 where id=result.id returning * into result;return result;
end $$;
create or replace function public.release_communication_event(p_id uuid,p_lease_token uuid,p_error text,p_review boolean default false) returns void language plpgsql security definer set search_path=public as $$
begin
 perform public.communication_require_service();
 if p_error is null or p_error not in ('provider_content_requires_review','provider_fetch_or_persistence_retry') or p_review is null or (p_error='provider_content_requires_review') is distinct from p_review then raise exception 'Typed processing failure required' using errcode='23514';end if;
 update public.communication_provider_events set state=case when p_review or cycle_attempts>=10 then 'review' else 'pending' end,available_at=clock_timestamp()+make_interval(secs=>least(3600,power(2,least(cycle_attempts,10))::integer*30)),last_error=p_error,lease_token=null,lease_expires_at=null where id=p_id and state='claimed' and lease_token=p_lease_token and lease_expires_at>clock_timestamp();
 if not found then raise exception 'Provider event lease unavailable' using errcode='40001';end if;
end $$;
-- Keep original function signatures and content/consent/status logic. Fail migration if baseline guard drifts.
do $$declare name text;signature regprocedure;definition text;needle text:='event.lease_token is distinct from p_lease_token or event.event_type';begin
 foreach name in array array['complete_inbound_communication','complete_communication_status'] loop
 select p.oid::regprocedure into strict signature from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=name;
 definition:=pg_get_functiondef(signature);
 if position(needle in definition)=0 then raise exception 'Expected active lease guard absent in %',name;end if;
 execute replace(definition,needle,'event.lease_token is distinct from p_lease_token or event.lease_expires_at is null or event.lease_expires_at<=clock_timestamp() or event.event_type');
 end loop;
end $$;
create function public.communication_processing_projection(p_event public.communication_provider_events) returns jsonb language sql immutable set search_path=public as $$
 select jsonb_build_object('id',p_event.id,'provider',p_event.provider,'event_id',p_event.event_id,'resource_id',p_event.resource_id,'event_type',p_event.event_type,'state',p_event.state,'attempts',p_event.attempts,'cycle_no',p_event.cycle_no,'cycle_attempts',p_event.cycle_attempts,'received_at',p_event.received_at,'available_at',p_event.available_at,'last_error',case when p_event.last_error in ('provider_content_requires_review','provider_fetch_or_persistence_retry','worker_lease_expired') then p_event.last_error when p_event.last_error is not null then 'legacy_review_required' end,'revision',p_event.revision)
$$;
revoke all on function public.communication_processing_projection(public.communication_provider_events) from public,anon,authenticated,service_role;
create function public.release_communication_event_outcome(p_id uuid,p_lease_token uuid,p_error text,p_review boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.communication_provider_events;
begin perform public.communication_require_service();perform public.release_communication_event(p_id,p_lease_token,p_error,p_review);select * into strict r from public.communication_provider_events where id=p_id;return public.communication_processing_projection(r);end $$;
revoke all on function public.release_communication_event_outcome(uuid,uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.release_communication_event_outcome(uuid,uuid,text,boolean) to service_role;
create function public.communication_retry_hash(p_event public.communication_provider_events) returns text language sql immutable set search_path=public,extensions as $$
 select encode(digest(jsonb_build_array(p_event.id,p_event.provider,p_event.event_id,p_event.resource_id,p_event.event_type,p_event.payload_hash,p_event.metadata,p_event.state,p_event.attempts,p_event.cycle_no,p_event.cycle_attempts,p_event.revision,p_event.last_error,p_event.available_at)::text,'sha256'),'hex')
$$;
create function public.communication_retry_eligible(p_event public.communication_provider_events) returns boolean language sql immutable set search_path=public as $$
 select p_event.state='review' and p_event.cycle_attempts=10 and p_event.last_error='provider_fetch_or_persistence_retry' and p_event.lease_token is null and p_event.lease_expires_at is null
$$;
revoke all on function public.communication_retry_hash(public.communication_provider_events),public.communication_retry_eligible(public.communication_provider_events) from public,anon,authenticated,service_role;
create function public.preview_communication_event_retry(p_event_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.communication_provider_events;
begin
 if not public.has_role(actor,'ADMIN') then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into r from public.communication_provider_events where id=p_event_id;
 if not found then return null;end if;
 return jsonb_build_object('event',public.communication_processing_projection(r),'eligible',coalesce(public.communication_retry_eligible(r),false),'expected_work_hash',public.communication_retry_hash(r),
 'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.id) from (select * from public.communication_processing_history where event_id=r.id order by id desc limit 100) h),'[]'::jsonb),
 'history_has_more',(select count(*)>100 from (select id from public.communication_processing_history where event_id=r.id limit 101) h),
 'retries',coalesce((select jsonb_agg(to_jsonb(a) order by a.cycle_no) from (select * from public.communication_event_retry_actions where event_id=r.id order by cycle_no desc limit 100) a),'[]'::jsonb));
end $$;
create function public.requeue_communication_event(p_id uuid,p_event_id uuid,p_expected_work_hash text,p_reason text,p_attest boolean) returns public.communication_event_retry_actions language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.communication_provider_events;a public.communication_event_retry_actions;
begin
 if not public.has_role(actor,'ADMIN') then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_attest is distinct from true or p_expected_work_hash is null or p_expected_work_hash!~'^[a-f0-9]{64}$' or p_reason is null or p_reason not in ('provider_recovered','configuration_repaired','processor_repaired') then raise exception 'Explicit reviewed processing retry required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,4300));
 select * into a from public.communication_event_retry_actions where id=p_id;
 if found then if row(a.actor_id,a.event_id,a.expected_work_hash,a.reason) is distinct from row(actor,p_event_id,p_expected_work_hash,p_reason) then raise exception 'Retry UUID already used' using errcode='23505';end if;return a;end if;
 select * into r from public.communication_provider_events where id=p_event_id for update;
 if not found then raise exception 'Processing event unavailable' using errcode='42501';end if;
 if public.communication_retry_hash(r) is distinct from p_expected_work_hash then raise exception 'Processing work changed; review again' using errcode='40001';end if;
 if public.communication_retry_eligible(r) is distinct from true then raise exception 'Processing failure requires separate review; retry unavailable' using errcode='23514';end if;
 insert into public.communication_event_retry_actions(id,actor_id,event_id,expected_work_hash,reason,previous_cycle_no,cycle_no,lifetime_attempts) values(p_id,actor,r.id,p_expected_work_hash,p_reason,r.cycle_no,r.cycle_no+1,r.attempts) returning * into a;
 update public.communication_provider_events set state='pending',cycle_no=cycle_no+1,cycle_attempts=0,available_at=clock_timestamp(),last_error=null where id=r.id;
 return a;
end $$;
create function public.recover_communication_event_retry(p_id uuid) returns public.communication_event_retry_actions language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();a public.communication_event_retry_actions;
begin if not public.has_role(actor,'ADMIN') then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into a from public.communication_event_retry_actions where id=p_id and actor_id=actor;if not found then return null;end if;return a;end $$;
create function public.list_communication_processing_queue(p_state text default null,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare items jsonb;more boolean;
begin perform public.clinical_require_staff();
 if p_limit is null or p_limit not between 1 and 100 or (p_before_at is null)<>(p_before_id is null) or (p_state is not null and p_state not in ('pending','claimed','review','processed')) then raise exception 'Invalid bounded processing queue cursor' using errcode='23514';end if;
 with rows as (select * from public.communication_provider_events where (case when p_state is null then state<>'processed' else state=p_state end) and (p_before_at is null or (received_at,id)<(p_before_at,p_before_id)) order by received_at desc,id desc limit p_limit+1),page as (select * from rows order by received_at desc,id desc limit p_limit)
 select coalesce((select jsonb_agg(public.communication_processing_projection(p) order by received_at desc,id desc) from page p),'[]'::jsonb),(select count(*)>p_limit from rows) into items,more;
 return jsonb_build_object('events',items,'has_more',more);
end $$;
create function public.list_communication_event_retries(p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();items jsonb;more boolean;
begin if not public.has_role(actor,'ADMIN') then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 100 or (p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid bounded retry cursor' using errcode='23514';end if;
 with rows as (select * from public.communication_event_retry_actions where actor_id=actor and (p_before_at is null or (created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit p_limit+1),page as (select * from rows order by created_at desc,id desc limit p_limit)
 select coalesce((select jsonb_agg(to_jsonb(p) order by created_at desc,id desc) from page p),'[]'::jsonb),(select count(*)>p_limit from rows) into items,more;
 return jsonb_build_object('retries',items,'has_more',more);
end $$;
do $$declare f record;begin for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('preview_communication_event_retry','requeue_communication_event','recover_communication_event_retry','list_communication_processing_queue','list_communication_event_retries') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);execute format('grant execute on function %s to authenticated',f.signature);end loop;end $$;
