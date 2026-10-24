-- Preparation stores intent only. Dispatch still requires the outbox and its environment policy.
create table public.communication_prepared_requests (
 request_id uuid primary key, actor_id uuid not null references auth.users(id), scope text not null,
 payload jsonb, state text not null check(state in ('prepared','acknowledged','abandoned')),
 created_at timestamptz not null default now(), resolved_at timestamptz,
 check(scope ~ '^[A-Za-z0-9:_-]{1,200}$'),
 check(payload is not null or state='abandoned')
);
create unique index communication_one_prepared_scope on public.communication_prepared_requests(actor_id,scope) where state='prepared';
alter table public.communication_prepared_requests enable row level security;
revoke all on public.communication_prepared_requests from public,anon,authenticated,service_role;
create policy "Own prepared request" on public.communication_prepared_requests for select to authenticated using(actor_id=auth.uid() and public.is_active_staff(auth.uid()));
grant select on public.communication_prepared_requests to authenticated;
create function public.guard_prepared_request() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP='DELETE' or NEW.request_id is distinct from OLD.request_id or NEW.actor_id is distinct from OLD.actor_id or NEW.scope is distinct from OLD.scope or NEW.payload is distinct from OLD.payload or NEW.created_at is distinct from OLD.created_at or OLD.state<>'prepared' then raise exception 'Prepared request history is immutable' using errcode='23514';end if;
 return NEW;
end $$;
create trigger guard_prepared_request before update or delete on public.communication_prepared_requests for each row execute function public.guard_prepared_request();

create function public.recover_message_request(p_actor_id uuid,p_scope text,p_request_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid;prepared public.communication_prepared_requests;queued public.communication_outbox;
begin
 actor:=public.clinical_require_staff();if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501';end if;
 if p_scope is null or p_scope !~ '^[A-Za-z0-9:_-]{1,200}$' then raise exception 'Invalid composer scope' using errcode='23514';end if;
 select * into prepared from public.communication_prepared_requests where actor_id=actor and scope=p_scope and ((p_request_id is not null and request_id=p_request_id) or (p_request_id is null and state='prepared'));
 if not found then return null;end if;
 select * into queued from public.communication_outbox where request_id=prepared.request_id and created_by=actor;
 return jsonb_build_object('request_id',prepared.request_id,'payload',prepared.payload,'status',prepared.state,
 'receipt',case when queued.id is null then null else jsonb_build_object('success',true,'queued',true,'outbox_id',queued.id,'message_id',queued.message_id,'state',queued.state) end);
end $$;

create function public.prepare_message_request(p_actor_id uuid,p_request_id uuid,p_scope text,p_conversation_id uuid,p_channel text,p_recipient text,p_subject text,p_body text,p_attachment_ids uuid[] default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid;prepared public.communication_prepared_requests;payload jsonb;
begin
 actor:=public.clinical_require_staff();if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501';end if;
 if p_request_id is null or p_scope is null or p_scope !~ '^[A-Za-z0-9:_-]{1,200}$' or public.communication_recipient(p_channel,p_recipient) is null or p_body is null or length(trim(p_body))<1 or (p_channel='EMAIL' and (p_subject is null or length(trim(p_subject)) not between 1 and 500 or length(p_body)>100000)) or (p_channel='SMS' and (coalesce(p_subject,'')<>'' or length(p_body)>1600)) or p_attachment_ids is null or cardinality(p_attachment_ids)<>0 then raise exception 'Invalid prepared message' using errcode='23514';end if;
 if not exists(select 1 from public.conversations where id=p_conversation_id) then raise exception 'Conversation not found' using errcode='23503';end if;
 payload:=jsonb_build_object('conversation_id',p_conversation_id,'channel',p_channel,'to',p_recipient,'subject',coalesce(p_subject,''),'body',p_body,'attachment_ids',to_jsonb(p_attachment_ids));
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,914));
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_scope,1200));
 select * into prepared from public.communication_prepared_requests where request_id=p_request_id;
 if found then
  if prepared.actor_id is distinct from actor or prepared.scope is distinct from p_scope or prepared.payload is distinct from payload or prepared.state='abandoned' then raise exception 'Request already used or abandoned' using errcode='23505';end if;
 else
  if exists(select 1 from public.communication_prepared_requests where actor_id=actor and scope=p_scope and state='prepared') then raise exception 'Composer has an unresolved prepared request' using errcode='23505';end if;
  insert into public.communication_prepared_requests(request_id,actor_id,scope,payload,state) values(p_request_id,actor,p_scope,payload,'prepared');
 end if;
 return public.recover_message_request(actor,p_scope,p_request_id);
end $$;

-- Keep the existing queue validation implementation private. No caller may bypass preparation.
alter function public.enqueue_communication(uuid,uuid,uuid,text,text,text,text,uuid[]) rename to enqueue_prepared_communication_internal;
revoke all on function public.enqueue_prepared_communication_internal(uuid,uuid,uuid,text,text,text,text,uuid[]) from public,anon,authenticated,service_role;
create function public.enqueue_communication(p_actor_id uuid,p_request_id uuid,p_conversation_id uuid,p_channel text,p_recipient text,p_subject text,p_body text,p_attachment_ids uuid[] default '{}') returns public.communication_outbox language plpgsql security definer set search_path=public as $$
declare actor uuid;prepared public.communication_prepared_requests;payload jsonb;
begin
 actor:=public.clinical_require_staff();if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,914));
 select * into prepared from public.communication_prepared_requests where request_id=p_request_id;
 if not found or prepared.actor_id is distinct from actor or prepared.state='abandoned' then raise exception 'Prepare this request before enqueueing' using errcode='42501';end if;
 payload:=jsonb_build_object('conversation_id',p_conversation_id,'channel',p_channel,'to',p_recipient,'subject',coalesce(p_subject,''),'body',p_body,'attachment_ids',to_jsonb(p_attachment_ids));
 if prepared.payload is distinct from payload then raise exception 'Prepared content cannot change' using errcode='23505';end if;
 return public.enqueue_prepared_communication_internal(actor,p_request_id,p_conversation_id,p_channel,p_recipient,p_subject,p_body,p_attachment_ids);
end $$;

create function public.resolve_message_request(p_actor_id uuid,p_request_id uuid,p_scope text,p_abandon boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid;prepared public.communication_prepared_requests;queued boolean;
begin
 actor:=public.clinical_require_staff();if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501';end if;
 if p_request_id is null or p_scope is null or p_scope !~ '^[A-Za-z0-9:_-]{1,200}$' or p_abandon is null then raise exception 'Invalid recovery request' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,914));
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_scope,1200));
 select * into prepared from public.communication_prepared_requests where request_id=p_request_id;
 if found and (prepared.actor_id is distinct from actor or prepared.scope is distinct from p_scope) then raise exception 'Request ownership mismatch' using errcode='42501';end if;
 select exists(select 1 from public.communication_outbox where request_id=p_request_id and created_by=actor) into queued;
 if prepared.request_id is null then
  if not p_abandon then raise exception 'No queued request to acknowledge' using errcode='23514';end if;
  insert into public.communication_prepared_requests(request_id,actor_id,scope,state,resolved_at) values(p_request_id,actor,p_scope,'abandoned',now());
 elsif prepared.state='prepared' then
  if not queued and not p_abandon then raise exception 'No queued request to acknowledge' using errcode='23514';end if;
  update public.communication_prepared_requests set state=case when queued then 'acknowledged' else 'abandoned' end,resolved_at=now() where request_id=p_request_id;
 end if;
 return public.recover_message_request(actor,p_scope,p_request_id);
end $$;

do $$ declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('guard_prepared_request','recover_message_request','prepare_message_request','enqueue_communication','resolve_message_request') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname<>'guard_prepared_request' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
