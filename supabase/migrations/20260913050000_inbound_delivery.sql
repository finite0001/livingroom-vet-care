create table public.communication_provider_events (
 id uuid primary key default gen_random_uuid(), provider text not null check(provider in ('resend','twilio')),
 event_id text not null, resource_id text not null, event_type text not null,
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'), metadata jsonb not null check(pg_column_size(metadata)<=131072),
 state text not null default 'pending' check(state in ('pending','claimed','processed','review')),
 lease_token uuid,lease_expires_at timestamptz, attempts integer not null default 0,
 received_at timestamptz not null default now(),available_at timestamptz not null default now(),last_error text,
 unique(provider,event_id)
);
create table public.communication_inbound (
 id uuid primary key default gen_random_uuid(), provider text not null,resource_id text not null,
 event_id uuid not null references public.communication_provider_events(id), channel text not null check(channel in ('EMAIL','SMS')),
 sender text not null,recipient text not null,subject text not null default '',body text not null,html_body text,
 rfc_message_id text,reply_ids text[] not null default '{}',attachment_metadata jsonb not null default '[]',
 occurred_at timestamptz not null, received_at timestamptz not null default now(),
 client_id uuid references public.clients(id),conversation_id uuid references public.conversations(id),message_id uuid references public.messages(id),
 review_reason text, version integer not null default 1,unique(provider,resource_id)
);
create table public.communication_inbound_assignments (
 id uuid primary key default gen_random_uuid(),inbound_id uuid not null references public.communication_inbound(id),
 client_id uuid not null references public.clients(id),conversation_id uuid not null references public.conversations(id),
 assigned_by uuid not null references auth.users(id),reason text not null check(length(trim(reason)) between 5 and 1000),created_at timestamptz not null default now()
);
create table public.communication_phone_preferences (
 phone text primary key, opted_in boolean not null,occurred_at timestamptz not null,resource_id text not null,
 event_id uuid not null references public.communication_provider_events(id),updated_at timestamptz not null default now()
);
create table public.conversation_read_cursors (
 user_id uuid not null references auth.users(id),conversation_id uuid not null references public.conversations(id),
 read_at timestamptz not null,message_id uuid not null references public.messages(id),primary key(user_id,conversation_id)
);
alter table public.communication_outbox add column delivery_failure_kind text;
create index communication_inbound_review_idx on public.communication_inbound(received_at desc,id desc) where message_id is null;
create index communication_inbound_rfc_idx on public.communication_inbound(rfc_message_id) where rfc_message_id is not null;
create index messages_inbox_cursor_idx on public.messages(conversation_id,created_at desc,id desc);

do $$ declare t text;begin
 foreach t in array array['communication_provider_events','communication_inbound','communication_inbound_assignments','communication_phone_preferences','conversation_read_cursors'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated,service_role',t);
  if t='conversation_read_cursors' then execute format('create policy "Own read cursor" on public.%I for select to authenticated using(user_id=auth.uid() and public.is_active_staff(auth.uid()))',t);
  else execute format('create policy "Active staff read" on public.%I for select to authenticated using(public.is_active_staff(auth.uid()))',t);end if;
 end loop;
end $$;

create function public.receive_communication_event(p_provider text,p_event_id text,p_resource_id text,p_event_type text,p_payload_hash text,p_metadata jsonb) returns public.communication_provider_events language plpgsql security definer set search_path=public as $$
declare result public.communication_provider_events;
begin
 perform public.communication_require_service();
 if p_provider is null or p_provider not in ('resend','twilio') or p_event_id is null or length(p_event_id) not between 1 and 200 or p_resource_id is null or length(p_resource_id) not between 1 and 200 or p_event_type is null or p_event_type not in ('inbound','sent','delivered','bounced','complained','failed','undelivered','queued','sending') or p_metadata is null or jsonb_typeof(p_metadata)<>'object' then raise exception 'Invalid provider event' using errcode='23514'; end if;
 -- Receipt callbacks can arrive before the send worker persists its provider ID. Fail for retry, never acknowledge and drop.
 if p_event_type<>'inbound' and not exists(select 1 from public.communication_outbox where provider=p_provider and provider_message_id=p_resource_id) then raise exception 'Provider receipt is not yet correlated' using errcode='23503'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_provider||':'||p_event_id,927));
 select * into result from public.communication_provider_events where provider=p_provider and event_id=p_event_id;
 if found then
  if result.payload_hash is distinct from p_payload_hash or result.resource_id is distinct from p_resource_id or result.event_type is distinct from p_event_type then raise exception 'Provider event identifier reused' using errcode='23505';end if;
  return result;
 end if;
 insert into public.communication_provider_events(provider,event_id,resource_id,event_type,payload_hash,metadata) values(p_provider,p_event_id,p_resource_id,p_event_type,p_payload_hash,p_metadata) returning * into result;
 return result;
end $$;
create function public.claim_communication_event() returns public.communication_provider_events language plpgsql security definer set search_path=public as $$
declare result public.communication_provider_events;
begin
 perform public.communication_require_service();
 update public.communication_provider_events set state='pending',lease_token=null,lease_expires_at=null where state='claimed' and lease_expires_at<now();
 select * into result from public.communication_provider_events where state='pending' and available_at<=now() order by received_at for update skip locked limit 1;
 if not found then return null;end if;
 update public.communication_provider_events set state='claimed',lease_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes',attempts=attempts+1 where id=result.id returning * into result;
 return result;
end $$;
create function public.release_communication_event(p_id uuid,p_lease_token uuid,p_error text,p_review boolean default false) returns void language plpgsql security definer set search_path=public as $$
begin
 perform public.communication_require_service();
 update public.communication_provider_events set state=case when p_review or attempts>=10 then 'review' else 'pending' end,available_at=now()+make_interval(secs=>least(3600,power(2,least(attempts,10))::integer*30)),last_error=left(p_error,200),lease_token=null,lease_expires_at=null where id=p_id and state='claimed' and lease_token=p_lease_token;
 if not found then raise exception 'Provider event lease unavailable' using errcode='40001';end if;
end $$;

create function public.complete_inbound_communication(p_event_id uuid,p_lease_token uuid,p_sender text,p_recipient text,p_subject text,p_body text,p_html text,p_rfc_message_id text,p_reply_ids text[],p_attachments jsonb,p_occurred_at timestamptz,p_opt_action text default null) returns public.communication_inbound language plpgsql security definer set search_path=public as $$
declare event public.communication_provider_events; result public.communication_inbound; channel text; sender text;recipient text;client uuid;conversation uuid;matches integer;message uuid;preference public.communication_phone_preferences;
begin
 perform public.communication_require_service();
 select * into event from public.communication_provider_events where id=p_event_id for update;
 if not found or event.state<>'claimed' or event.lease_token is distinct from p_lease_token or event.event_type<>'inbound' then raise exception 'Provider event lease unavailable' using errcode='40001';end if;
 channel:=case when event.provider='resend' then 'EMAIL' else 'SMS' end;
 sender:=public.communication_recipient(channel,p_sender);recipient:=public.communication_recipient(channel,p_recipient);
 if sender is null or recipient is null or p_body is null or length(p_body)>100000 or length(p_html)>500000 or length(p_subject)>500 or p_occurred_at is null or not isfinite(p_occurred_at) or p_occurred_at>now()+interval '5 minutes' or p_reply_ids is null or cardinality(p_reply_ids)>50 or p_attachments is null or jsonb_typeof(p_attachments)<>'array' or jsonb_array_length(p_attachments)>100 then raise exception 'Invalid inbound content' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(channel||':'||sender,936));
 select * into result from public.communication_inbound where provider=event.provider and resource_id=event.resource_id;
 if found then update public.communication_provider_events set state='processed',lease_token=null,lease_expires_at=null where id=event.id;return result;end if;
 -- Exact normalized household match only. Shared addresses stay in review; no pet is inferred.
 select count(*),(array_agg(c.id))[1] into matches,client from public.clients c where public.communication_recipient(channel,case when channel='EMAIL' then c.primary_email else c.primary_phone end)=sender;
 if matches<>1 then client:=null;end if;
 if client is not null then
  select count(distinct i.conversation_id),(array_agg(i.conversation_id))[1] into matches,conversation from public.communication_inbound i where i.rfc_message_id=any(p_reply_ids) and i.client_id=client and i.conversation_id is not null;
  if matches>1 then conversation:=null;
  elsif matches=0 then
   select count(*),(array_agg(c.id))[1] into matches,conversation from public.conversations c where c.client_id=client and c.status='ACTIVE';
   if matches>1 then conversation:=null;
   elsif matches=0 then insert into public.conversations(client_id) values(client) returning id into conversation;
   end if;
  end if;
 end if;
 if conversation is not null then
  insert into public.messages(conversation_id,type,sender_type,content,is_internal) values(conversation,channel::public.message_type,'CLIENT',p_body,false) returning id into message;
  update public.conversations set last_message_at=now(),is_read=false where id=conversation;
 end if;
 insert into public.communication_inbound(provider,resource_id,event_id,channel,sender,recipient,subject,body,html_body,rfc_message_id,reply_ids,attachment_metadata,occurred_at,client_id,conversation_id,message_id,review_reason)
 values(event.provider,event.resource_id,event.id,channel,sender,recipient,coalesce(p_subject,''),p_body,p_html,p_rfc_message_id,p_reply_ids,p_attachments,p_occurred_at,client,conversation,message,case when client is null then 'Unknown or shared sender' when conversation is null then 'Multiple possible conversation threads' end) returning * into result;
 -- Provider-fetched occurrence time makes older STOP/START deliveries unable to reverse newer consent.
 if channel='SMS' and p_opt_action in ('STOP','START') then
  select * into preference from public.communication_phone_preferences where phone=sender for update;
  if not found or p_occurred_at>preference.occurred_at or (p_occurred_at=preference.occurred_at and p_opt_action='STOP') then
   insert into public.communication_phone_preferences(phone,opted_in,occurred_at,resource_id,event_id) values(sender,p_opt_action='START',p_occurred_at,event.resource_id,event.id)
   on conflict(phone) do update set opted_in=excluded.opted_in,occurred_at=excluded.occurred_at,resource_id=excluded.resource_id,event_id=excluded.event_id,updated_at=now();
   if p_opt_action='STOP' then
    insert into public.communication_suppressions(channel,recipient,reason) values('SMS',sender,'provider_sms_stop') on conflict on constraint communication_suppressions_pkey do nothing;
    update public.sms_consent set opted_in=false,opted_out_at=p_occurred_at where public.communication_recipient('SMS',phone_number)=sender;
    update public.communication_outbox o set state='failed',last_error='recipient_suppressed' where o.channel='SMS' and o.recipient=sender and o.state='pending';
   else
    delete from public.communication_suppressions s where s.channel='SMS' and s.recipient=sender and s.reason='provider_sms_stop';
    -- START applies only to an unambiguous household, without overriding other suppression reasons.
    if client is not null then
     update public.sms_consent set opted_in=true,opted_in_at=p_occurred_at,opted_out_at=null where client_id=client and public.communication_recipient('SMS',phone_number)=sender;
     if not found then insert into public.sms_consent(client_id,phone_number,opted_in,opted_in_at,consent_details) values(client,sender,true,p_occurred_at,'Provider-verified START');end if;
    end if;
   end if;
  end if;
 end if;
 update public.communication_provider_events set state='processed',lease_token=null,lease_expires_at=null,last_error=null where id=event.id;
 return result;
end $$;

create function public.complete_communication_status(p_event_id uuid,p_lease_token uuid) returns void language plpgsql security definer set search_path=public as $$
declare event public.communication_provider_events; outbound public.communication_outbox;
begin
 perform public.communication_require_service();select * into event from public.communication_provider_events where id=p_event_id for update;
 if not found or event.state<>'claimed' or event.lease_token is distinct from p_lease_token or event.event_type='inbound' then raise exception 'Provider event lease unavailable' using errcode='40001';end if;
 select * into outbound from public.communication_outbox where provider=event.provider and provider_message_id=event.resource_id for update;
 if not found then raise exception 'Provider receipt not correlated' using errcode='23503';end if;
 if event.event_type='delivered' then perform public.record_communication_delivery(event.provider,event.event_id,event.resource_id,'delivered');
 elsif event.event_type in ('failed','undelivered','bounced','complained') then
  perform public.record_communication_delivery(event.provider,event.event_id,event.resource_id,'failed');
  if event.event_type in ('bounced','complained') then
   insert into public.communication_suppressions(channel,recipient,reason) values(outbound.channel,outbound.recipient,'provider_'||event.event_type) on conflict on constraint communication_suppressions_pkey do nothing;
   update public.communication_outbox set delivery_failure_kind=case when delivery_failure_kind='complained' then 'complained' else event.event_type end where id=outbound.id;
   update public.communication_outbox set state='failed',last_error='recipient_suppressed' where channel=outbound.channel and recipient=outbound.recipient and state='pending';
  end if;
 end if;
 update public.communication_provider_events set state='processed',lease_token=null,lease_expires_at=null where id=event.id;
end $$;

create function public.assign_inbound_communication(p_actor_id uuid,p_id uuid,p_expected_version integer,p_client_id uuid,p_conversation_id uuid,p_reason text) returns public.communication_inbound language plpgsql security definer set search_path=public as $$
declare actor uuid;result public.communication_inbound;message uuid;
begin
 actor:=public.clinical_require_staff();if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501';end if;
 select * into result from public.communication_inbound where id=p_id for update;
 if not found or result.version is distinct from p_expected_version or result.message_id is not null then raise exception 'Inbound review changed; reload' using errcode='40001';end if;
 if p_reason is null or length(trim(p_reason)) not between 5 and 1000 or not exists(select 1 from public.conversations where id=p_conversation_id and client_id=p_client_id) then raise exception 'Choose a conversation belonging to the selected household and provide a reason' using errcode='23514';end if;
 insert into public.messages(conversation_id,type,sender_type,content,is_internal) values(p_conversation_id,result.channel::public.message_type,'CLIENT',result.body,false) returning id into message;
 update public.communication_inbound set client_id=p_client_id,conversation_id=p_conversation_id,message_id=message,review_reason=null,version=version+1 where id=p_id returning * into result;
 insert into public.communication_inbound_assignments(inbound_id,client_id,conversation_id,assigned_by,reason) values(p_id,p_client_id,p_conversation_id,actor,p_reason);
 update public.conversations set last_message_at=now(),is_read=false where id=p_conversation_id;
 return result;
end $$;

create function public.mark_conversation_read(p_actor_id uuid,p_conversation_id uuid,p_message_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare actor uuid;message public.messages;
begin
 actor:=public.clinical_require_staff();if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501';end if;
 select * into message from public.messages where id=p_message_id and conversation_id=p_conversation_id;
 if not found then raise exception 'Message does not belong to conversation' using errcode='23514';end if;
 insert into public.conversation_read_cursors(user_id,conversation_id,read_at,message_id) values(actor,p_conversation_id,message.created_at,message.id)
 on conflict(user_id,conversation_id) do update set read_at=excluded.read_at,message_id=excluded.message_id where (conversation_read_cursors.read_at,conversation_read_cursors.message_id)<(excluded.read_at,excluded.message_id);
end $$;
create function public.list_communication_inbox(p_search text default '',p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 50)
returns table(conversation_id uuid,client_id uuid,client_name text,updated_at timestamptz,latest_message_id uuid,latest_content text,latest_type public.message_type,unread_count bigint)
language plpgsql security definer set search_path=public as $$
declare actor uuid;begin
 actor:=public.clinical_require_staff();
 if p_limit is null or p_limit not between 1 and 100 or length(p_search)>200 or (p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid inbox cursor' using errcode='23514';end if;
 return query select c.id,c.client_id,cl.full_name,c.last_message_at,m.id,m.content,m.type,
 (select count(*) from public.messages un where un.conversation_id=c.id and un.sender_type='CLIENT' and (r.message_id is null or (un.created_at,un.id)>(r.read_at,r.message_id)))
 from public.conversations c join public.clients cl on cl.id=c.client_id
 left join lateral(select mm.id,mm.content,mm.type from public.messages mm where mm.conversation_id=c.id order by mm.created_at desc,mm.id desc limit 1)m on true
 left join public.conversation_read_cursors r on r.user_id=actor and r.conversation_id=c.id
 where (p_before_at is null or (c.last_message_at,c.id)<(p_before_at,p_before_id)) and (coalesce(p_search,'')='' or cl.full_name ilike '%'||p_search||'%' or exists(select 1 from public.messages sm where sm.conversation_id=c.id and sm.content ilike '%'||p_search||'%'))
 order by c.last_message_at desc,c.id desc limit p_limit;
end $$;

do $$declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('receive_communication_event','claim_communication_event','release_communication_event','complete_inbound_communication','complete_communication_status','assign_inbound_communication','mark_conversation_read','list_communication_inbox') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('assign_inbound_communication','mark_conversation_read','list_communication_inbox') then execute format('grant execute on function %s to authenticated',f.signature);
  else execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;

-- A signed STOP event blocks dispatch as soon as durable receipt is acknowledged,
-- even while provider metadata is being fetched to order STOP/START chronologically.
create or replace function public.communication_is_suppressed(p_channel text,p_recipient text,p_client_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.communication_suppressions where channel=p_channel and recipient=p_recipient)
 or (p_channel='SMS' and (
 exists(select 1 from public.communication_provider_events where provider='twilio' and event_type='inbound' and state in ('pending','claimed','review') and metadata->>'opt_action'='STOP' and metadata->>'from'=p_recipient)
 or not exists(select 1 from public.sms_consent where client_id=p_client_id and public.communication_recipient('SMS',phone_number)=p_recipient and opted_in)
 or exists(select 1 from public.sms_consent where client_id=p_client_id and public.communication_recipient('SMS',phone_number)=p_recipient and not opted_in)))
$$;

create function public.guard_inbound_message() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.communication_inbound where message_id=OLD.id) then
  if TG_OP='DELETE' then raise exception 'Received communication history cannot be deleted' using errcode='23514';end if;
  if (to_jsonb(NEW)-array['triage_priority','triage_confidence','triage_reason']) is distinct from (to_jsonb(OLD)-array['triage_priority','triage_confidence','triage_reason']) then raise exception 'Received communication content is immutable' using errcode='23514';end if;
 end if;
 return case when TG_OP='DELETE' then OLD else NEW end;
end $$;
create trigger guard_inbound_message before update or delete on public.messages for each row execute function public.guard_inbound_message();
revoke all on function public.guard_inbound_message() from public,anon,authenticated,service_role;
