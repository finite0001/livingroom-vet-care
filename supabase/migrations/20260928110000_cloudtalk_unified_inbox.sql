-- CloudTalk unified inbox. CloudTalk texts and completed calls are projected
-- into the household conversation thread (/hub/chats) the same way inbound
-- email and SMS are: an exact, unambiguous primary_phone match threads the
-- entry; anything else waits in the existing unmatched review queue.
--
-- The CloudTalk rows remain the provider originals. The projection is an
-- immutable communication_inbound row (provider 'cloudtalk', no Resend/Twilio
-- receipt, so it never enters the provider processing queue) plus, once
-- matched, an immutable messages row keyed by (provider, provider_message_id).
-- Recording and transcript access stays on cloudtalk-call-media (administrators
-- only); the thread only references the call.

-- CloudTalk sends talking_time on call.ended; zero means nobody answered.
alter table public.cloudtalk_calls
  add column talking_seconds integer check (talking_seconds is null or talking_seconds >= 0);

-- CloudTalk originals never change or disappear once accepted. Calls merge
-- lifecycle events by design, but are never deleted.
create function public.guard_cloudtalk_original() returns trigger language plpgsql set search_path = public as $$
begin
  if TG_OP = 'DELETE' then raise exception 'CloudTalk history cannot be deleted' using errcode = '23514'; end if;
  if TG_TABLE_NAME in ('cloudtalk_messages', 'cloudtalk_events') then
    raise exception 'CloudTalk originals are immutable' using errcode = '23514';
  end if;
  if NEW.call_uuid is distinct from OLD.call_uuid then raise exception 'CloudTalk call identity is immutable' using errcode = '23514'; end if;
  return NEW;
end $$;
create trigger guard_cloudtalk_original before update or delete on public.cloudtalk_messages for each row execute function public.guard_cloudtalk_original();
create trigger guard_cloudtalk_original before update or delete on public.cloudtalk_events for each row execute function public.guard_cloudtalk_original();
create trigger guard_cloudtalk_original before update or delete on public.cloudtalk_calls for each row execute function public.guard_cloudtalk_original();
revoke all on function public.guard_cloudtalk_original() from public, anon, authenticated, service_role;

-- The review queue now also holds CloudTalk texts and calls, including activity
-- staff started in CloudTalk Phone (direction 'outbound').
alter table public.communication_inbound alter column event_id drop not null;
alter table public.communication_inbound add column direction text not null default 'inbound' check (direction in ('inbound', 'outbound'));
alter table public.communication_inbound drop constraint communication_inbound_channel_check;
alter table public.communication_inbound add constraint communication_inbound_channel_check
  check (channel in ('EMAIL', 'SMS', 'CALL_INBOUND', 'CALL_OUTBOUND', 'VOICEMAIL'));
alter table public.communication_inbound add constraint communication_inbound_source_check check (
  case when provider = 'cloudtalk'
    then event_id is null and resource_id ~ '^(message|call):.{1,200}$' and channel <> 'EMAIL'
    else event_id is not null and direction = 'inbound' and channel in ('EMAIL', 'SMS')
  end
);

create function public.guard_cloudtalk_inbound() returns trigger language plpgsql set search_path = public as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.provider = 'cloudtalk' then raise exception 'Received communication history cannot be deleted' using errcode = '23514'; end if;
    return OLD;
  end if;
  if (OLD.provider = 'cloudtalk' or NEW.provider = 'cloudtalk') and
    row(NEW.id, NEW.provider, NEW.resource_id, NEW.event_id, NEW.channel, NEW.direction, NEW.sender, NEW.recipient, NEW.subject, NEW.body, NEW.occurred_at, NEW.received_at)
    is distinct from row(OLD.id, OLD.provider, OLD.resource_id, OLD.event_id, OLD.channel, OLD.direction, OLD.sender, OLD.recipient, OLD.subject, OLD.body, OLD.occurred_at, OLD.received_at) then
    raise exception 'Received CloudTalk communication is immutable' using errcode = '23514';
  end if;
  return NEW;
end $$;
create trigger guard_cloudtalk_inbound before update or delete on public.communication_inbound for each row execute function public.guard_cloudtalk_inbound();
revoke all on function public.guard_cloudtalk_inbound() from public, anon, authenticated, service_role;

-- A projection that cannot be written (for example text that trips the
-- document-capability guard) must not make CloudTalk retry the webhook
-- forever. The original is kept; the failure is recorded without content.
create table public.cloudtalk_projection_failures (
  resource_id text primary key check (resource_id ~ '^(message|call):.{1,200}$'),
  sqlstate text not null check (sqlstate ~ '^[0-9A-Z]{5}$'),
  attempts integer not null default 1 check (attempts > 0),
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now()
);
alter table public.cloudtalk_projection_failures enable row level security;
revoke all on public.cloudtalk_projection_failures from public, anon, authenticated, service_role;
grant select on public.cloudtalk_projection_failures to authenticated;
create policy "Active staff read CloudTalk projection failures" on public.cloudtalk_projection_failures
  for select to authenticated using (public.is_active_staff(auth.uid()));

create function public.cloudtalk_duration_text(p_seconds integer) returns text language sql immutable set search_path = public as $$
  select case when p_seconds is null or p_seconds < 0 then null
    when p_seconds < 60 then p_seconds || 's'
    else (p_seconds / 60) || 'm ' || lpad((p_seconds % 60)::text, 2, '0') || 's' end
$$;

-- Activity started in CloudTalk Phone has no app staff identity to attribute a
-- response time to. Response metrics stay limited to attributable replies.
create or replace function public.track_response_metric() returns trigger
language plpgsql security definer set search_path = public as $$
declare _client_msg record;
begin
  if NEW.sender_type = 'STAFF' and NEW.is_internal = false and NEW.sender_id is not null then
    select id, created_at, type into _client_msg
    from public.messages
    where conversation_id = NEW.conversation_id and sender_type = 'CLIENT' and created_at < NEW.created_at
    order by created_at desc limit 1;
    if _client_msg.id is not null then
      insert into public.response_metrics(conversation_id, message_id, staff_id, client_message_at, staff_reply_at, channel)
      values (NEW.conversation_id, NEW.id, NEW.sender_id, _client_msg.created_at, NEW.created_at, NEW.type);
    end if;
  end if;
  return NEW;
end $$;

-- Projects one CloudTalk original ('message:<id>' or 'call:<uuid>'). Idempotent:
-- a second call for the same source returns the existing projection. Returns
-- null when the source is not projectable (unknown, unfinished, internal call).
create function public.project_cloudtalk_source(p_resource_id text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_msg public.cloudtalk_messages;
  v_call public.cloudtalk_calls;
  result public.communication_inbound;
  v_direction text;
  v_channel text;
  v_external text;
  v_internal text;
  v_body text;
  v_at timestamptz;
  v_client uuid;
  v_conversation uuid;
  v_message uuid;
  matches integer;
  answered_seconds integer;
begin
  if p_resource_id is null or p_resource_id !~ '^(message|call):.{1,200}$' then return null; end if;
  if p_resource_id like 'message:%' then
    select * into v_msg from public.cloudtalk_messages where message_id = substr(p_resource_id, 9);
    if not found then return null; end if;
    v_direction := v_msg.direction;
    v_channel := 'SMS';
    v_external := public.communication_recipient('SMS', v_msg.external_number);
    v_internal := public.communication_recipient('SMS', v_msg.internal_number);
    v_body := case when btrim(v_msg.body) = '' then '[' || upper(v_msg.channel) || ' with no text. Open CloudTalk to view attachments.]' else v_msg.body end;
    v_at := v_msg.occurred_at;
  else
    select * into v_call from public.cloudtalk_calls where call_uuid = substr(p_resource_id, 6);
    -- Partial AI/recording rows and unowned numbers are never shown alone.
    if not found or v_call.ended_at is null or not v_call.trusted_number then return null; end if;
    v_direction := case lower(coalesce(v_call.direction, '')) when 'incoming' then 'inbound' when 'inbound' then 'inbound'
      when 'outgoing' then 'outbound' when 'outbound' then 'outbound' end;
    if v_direction is null then return null; end if; -- internal and monitor legs are not client contact
    v_channel := case when v_call.is_voicemail then 'VOICEMAIL' when v_direction = 'inbound' then 'CALL_INBOUND' else 'CALL_OUTBOUND' end;
    v_external := public.communication_recipient('SMS', v_call.external_number);
    v_internal := public.communication_recipient('SMS', v_call.internal_number);
    answered_seconds := coalesce(v_call.talking_seconds, v_call.duration_seconds);
    v_body := case
      when v_call.is_voicemail then 'Voicemail'
      when v_call.talking_seconds = 0 and v_direction = 'inbound' then 'Missed incoming call'
      when v_call.talking_seconds = 0 then 'Outgoing call, not answered'
      when v_direction = 'inbound' then 'Incoming call'
      else 'Outgoing call' end
      || coalesce(' · ' || public.cloudtalk_duration_text(case when v_call.is_voicemail then v_call.duration_seconds when v_call.talking_seconds = 0 then null else answered_seconds end), '');
    v_at := coalesce(v_call.started_at, v_call.ended_at);
  end if;

  -- Same per-number lock as email/SMS ingestion so matching is serialized.
  perform pg_advisory_xact_lock(hashtextextended('SMS:' || coalesce(v_external, 'withheld'), 936));
  select * into result from public.communication_inbound where provider = 'cloudtalk' and resource_id = p_resource_id;
  if found then return result.id; end if;

  -- Exact normalized household match only; shared or unknown numbers stay in review.
  if v_external is not null then
    select count(*), (array_agg(c.id))[1] into matches, v_client
    from public.clients c where public.communication_recipient('SMS', c.primary_phone) = v_external;
    if matches <> 1 then v_client := null; end if;
  end if;
  if v_client is not null then
    perform pg_advisory_xact_lock(hashtextextended('conversation:' || v_client::text, 950));
    select count(*), (array_agg(c.id))[1] into matches, v_conversation
    from public.conversations c where c.client_id = v_client and c.status = 'ACTIVE';
    if matches > 1 then v_conversation := null;
    elsif matches = 0 then insert into public.conversations(client_id) values (v_client) returning id into v_conversation;
    end if;
  end if;

  if v_conversation is not null then
    insert into public.messages(conversation_id, type, sender_type, content, is_internal, provider, provider_message_id, created_at)
    values (v_conversation, v_channel::public.message_type, case when v_direction = 'inbound' then 'CLIENT' else 'STAFF' end::public.sender_type,
      v_body, false, 'cloudtalk', p_resource_id, v_at)
    returning id into v_message;
    update public.conversations set
      last_message_at = greatest(coalesce(last_message_at, v_at), v_at),
      is_read = case when v_direction = 'inbound' then false else is_read end
    where id = v_conversation;
  end if;

  insert into public.communication_inbound(provider, resource_id, event_id, channel, direction, sender, recipient, subject, body, occurred_at,
    client_id, conversation_id, message_id, review_reason)
  values ('cloudtalk', p_resource_id, null, v_channel, v_direction,
    coalesce(case when v_direction = 'inbound' then v_external else v_internal end, 'withheld'),
    coalesce(case when v_direction = 'inbound' then v_internal else v_external end, 'withheld'),
    '', v_body, v_at, v_client, v_conversation, v_message,
    case when v_external is null then 'Caller number withheld' when v_client is null then 'Unknown or shared sender'
      when v_conversation is null then 'Multiple possible conversation threads' end)
  returning * into result;
  delete from public.cloudtalk_projection_failures where resource_id = p_resource_id;
  return result.id;
end $$;

create function public.project_cloudtalk_source_safely(p_resource_id text) returns uuid
language plpgsql security definer set search_path = public as $$
declare state text;
begin
  return public.project_cloudtalk_source(p_resource_id);
exception when others then
  get stacked diagnostics state = returned_sqlstate;
  insert into public.cloudtalk_projection_failures(resource_id, sqlstate) values (p_resource_id, state)
  on conflict (resource_id) do update set sqlstate = excluded.sqlstate, attempts = cloudtalk_projection_failures.attempts + 1, last_failed_at = now();
  return null;
end $$;

create function public.project_cloudtalk_message_trigger() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.project_cloudtalk_source_safely('message:' || NEW.message_id);
  return null;
end $$;
create function public.project_cloudtalk_call_trigger() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.project_cloudtalk_source_safely('call:' || NEW.call_uuid);
  return null;
end $$;
create trigger project_cloudtalk_message after insert on public.cloudtalk_messages
  for each row execute function public.project_cloudtalk_message_trigger();
create trigger project_cloudtalk_call after insert or update on public.cloudtalk_calls
  for each row when (NEW.ended_at is not null and NEW.trusted_number) execute function public.project_cloudtalk_call_trigger();

-- Administrators can re-run projection after a recorded failure is fixed.
create function public.retry_cloudtalk_projections(p_limit integer default 100)
returns table(projected integer, still_failing integer)
language plpgsql security definer set search_path = public as $$
declare actor uuid; source text; ok_count integer := 0; fail_count integer := 0;
begin
  actor := public.clinical_require_staff();
  if not public.has_role(actor, 'ADMIN') then raise exception 'Administrator access required' using errcode = '42501'; end if;
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'Invalid retry limit' using errcode = '23514'; end if;
  for source in
    select s.resource_id from (
      select 'message:' || m.message_id resource_id, m.occurred_at occurred from public.cloudtalk_messages m
      union all
      select 'call:' || c.call_uuid, c.last_event_at occurred from public.cloudtalk_calls c where c.ended_at is not null and c.trusted_number
    ) s
    where not exists (select 1 from public.communication_inbound i where i.provider = 'cloudtalk' and i.resource_id = s.resource_id)
    order by s.occurred limit p_limit
  loop
    -- Null without a recorded failure means not client contact (for example an internal leg).
    if public.project_cloudtalk_source_safely(source) is not null then ok_count := ok_count + 1;
    elsif exists (select 1 from public.cloudtalk_projection_failures f where f.resource_id = source) then fail_count := fail_count + 1;
    end if;
  end loop;
  projected := ok_count; still_failing := fail_count;
  return next;
end $$;

-- Review assignment now covers CloudTalk directions and keeps the thread
-- chronological and idempotency-keyed for CloudTalk entries.
create or replace function public.assign_inbound_communication(p_actor_id uuid,p_id uuid,p_expected_version integer,p_client_id uuid,p_conversation_id uuid,p_reason text) returns public.communication_inbound language plpgsql security definer set search_path=public as $$
declare actor uuid;result public.communication_inbound;message uuid;
begin
 actor:=public.clinical_require_staff();if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501';end if;
 select * into result from public.communication_inbound where id=p_id for update;
 if not found or result.version is distinct from p_expected_version or result.message_id is not null then raise exception 'Inbound review changed; reload' using errcode='40001';end if;
 if p_reason is null or length(trim(p_reason)) not between 5 and 1000 or not exists(select 1 from public.conversations where id=p_conversation_id and client_id=p_client_id) then raise exception 'Choose a conversation belonging to the selected household and provide a reason' using errcode='23514';end if;
 if result.provider='cloudtalk' then
  insert into public.messages(conversation_id,type,sender_type,content,is_internal,provider,provider_message_id,created_at)
  values(p_conversation_id,result.channel::public.message_type,case when result.direction='inbound' then 'CLIENT' else 'STAFF' end::public.sender_type,result.body,false,'cloudtalk',result.resource_id,result.occurred_at) returning id into message;
 else
  insert into public.messages(conversation_id,type,sender_type,content,is_internal) values(p_conversation_id,result.channel::public.message_type,'CLIENT',result.body,false) returning id into message;
 end if;
 update public.communication_inbound set client_id=p_client_id,conversation_id=p_conversation_id,message_id=message,review_reason=null,version=version+1 where id=p_id returning * into result;
 insert into public.communication_inbound_assignments(inbound_id,client_id,conversation_id,assigned_by,reason) values(p_id,p_client_id,p_conversation_id,actor,p_reason);
 update public.conversations set last_message_at=now(),is_read=false where id=p_conversation_id;
 return result;
end $$;

-- Same contract as 20260926090000, plus talking_seconds so missed calls are known.
create or replace function public.ingest_cloudtalk_event(
  p_event_id text, p_event_type text, p_occurred_at timestamptz, p_data jsonb
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  call_key text;
  number_internal text;
  number_external text;
  message_key text;
begin
  perform public.communication_require_service();
  if p_event_id is null or length(p_event_id) not between 1 and 200
    or p_event_type not in ('call.ended', 'call.recording_ready', 'transcript.ready', 'cidata.ready', 'message.sent', 'message.received')
    or p_occurred_at is null or p_occurred_at > now() + interval '5 minutes'
    or p_data is null or jsonb_typeof(p_data) <> 'object'
    or octet_length(p_data::text) > 262144 then
    raise exception 'Invalid CloudTalk event' using errcode = '23514';
  end if;
  insert into public.cloudtalk_events(event_id, event_type, occurred_at)
  values(p_event_id, p_event_type, p_occurred_at) on conflict do nothing;
  if not found then return false; end if;

  if p_event_type like 'call.%' or p_event_type in ('transcript.ready', 'cidata.ready') then
    call_key := p_data->>'call_uuid';
    if call_key is null or length(call_key) not between 1 and 200 then
      raise exception 'Invalid CloudTalk call' using errcode = '23514';
    end if;
    number_external := p_data->>'external_number';
    number_internal := p_data#>>'{internal_number,number_e164}';
    insert into public.cloudtalk_calls(
      call_uuid, call_id, direction, external_number, internal_number,
      started_at, ended_at, duration_seconds, talking_seconds, is_voicemail, recording_ready,
      transcript_ready, ai_summary, ai_language, trusted_number, last_event_at
    ) values (
      call_key, p_data->>'call_id', p_data->>'direction', number_external, number_internal,
      nullif(p_data->>'started_at', '')::timestamptz,
      nullif(p_data->>'ended_at', '')::timestamptz,
      case when (p_data->>'duration') ~ '^[0-9]{1,8}$' then (p_data->>'duration')::integer end,
      case when p_event_type = 'call.ended' and (p_data->>'talking_time') ~ '^[0-9]{1,8}$' then (p_data->>'talking_time')::integer end,
      coalesce((p_data->>'is_voicemail')::boolean, false),
      p_event_type = 'call.recording_ready',
      p_event_type = 'transcript.ready',
      case when p_event_type = 'cidata.ready' then left(p_data#>>'{summary,summary}', 10000) end,
      case when p_event_type in ('transcript.ready', 'cidata.ready') then left(p_data->>'language', 20) end,
      p_event_type = 'call.ended',
      p_occurred_at
    ) on conflict(call_uuid) do update set
      call_id = coalesce(excluded.call_id, cloudtalk_calls.call_id),
      direction = coalesce(excluded.direction, cloudtalk_calls.direction),
      external_number = coalesce(excluded.external_number, cloudtalk_calls.external_number),
      internal_number = coalesce(excluded.internal_number, cloudtalk_calls.internal_number),
      started_at = coalesce(excluded.started_at, cloudtalk_calls.started_at),
      ended_at = coalesce(excluded.ended_at, cloudtalk_calls.ended_at),
      duration_seconds = coalesce(excluded.duration_seconds, cloudtalk_calls.duration_seconds),
      talking_seconds = coalesce(excluded.talking_seconds, cloudtalk_calls.talking_seconds),
      is_voicemail = excluded.is_voicemail or cloudtalk_calls.is_voicemail,
      recording_ready = excluded.recording_ready or cloudtalk_calls.recording_ready,
      transcript_ready = excluded.transcript_ready or cloudtalk_calls.transcript_ready,
      ai_summary = coalesce(excluded.ai_summary, cloudtalk_calls.ai_summary),
      ai_language = coalesce(excluded.ai_language, cloudtalk_calls.ai_language),
      trusted_number = excluded.trusted_number or cloudtalk_calls.trusted_number,
      last_event_at = greatest(excluded.last_event_at, cloudtalk_calls.last_event_at);
  else
    message_key := p_data->>'id';
    number_external := p_data->>'external_number';
    number_internal := p_data#>>'{internal_number,number_e164}';
    if message_key is null or length(message_key) not between 1 and 200
      or public.communication_recipient('SMS', number_external) is null
      or public.communication_recipient('SMS', number_internal) is null
      or p_data->>'channel' not in ('sms', 'mms', 'whatsapp')
      or length(coalesce(p_data->>'body', '')) > 100000 then
      raise exception 'Invalid CloudTalk message' using errcode = '23514';
    end if;
    insert into public.cloudtalk_messages(
      message_id, direction, channel, external_number, internal_number, body, occurred_at
    ) values (
      message_key, case when p_event_type = 'message.received' then 'inbound' else 'outbound' end,
      p_data->>'channel', number_external, number_internal, coalesce(p_data->>'body', ''), p_occurred_at
    ) on conflict(message_id) do nothing;
    -- A signed inbound STOP blocks any future SMS request, including one
    -- queued before the message arrived. Re-enabling requires staff review.
    if p_event_type = 'message.received' and p_data->>'channel' = 'sms' and upper(btrim(coalesce(p_data->>'body', ''))) in ('STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT') then
      insert into public.communication_suppressions(channel, recipient, reason)
      values ('SMS', public.communication_recipient('SMS', number_external), 'cloudtalk_sms_stop')
      on conflict (channel, recipient) do nothing;
      update public.sms_consent set opted_in = false, opted_out_at = greatest(coalesce(opted_out_at, p_occurred_at), p_occurred_at)
      where public.communication_recipient('SMS', phone_number) = public.communication_recipient('SMS', number_external);
      update public.communication_outbox set state = 'failed', last_error = 'recipient_suppressed', updated_at = now()
      where channel = 'SMS' and recipient = public.communication_recipient('SMS', number_external) and state = 'pending';
      update public.outbound_deliveries set status = 'CANCELED', canceled_at = now(), updated_at = now(), status_note = 'Recipient sent STOP to CloudTalk'
      where channel = 'SMS' and recipient = public.communication_recipient('SMS', number_external) and status = 'QUEUED';
    end if;
  end if;
  return true;
end $$;
revoke all on function public.ingest_cloudtalk_event(text,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.ingest_cloudtalk_event(text,text,timestamptz,jsonb) to service_role;

do $$ declare f record; begin
  for f in select p.oid::regprocedure signature, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('cloudtalk_duration_text', 'project_cloudtalk_source', 'project_cloudtalk_source_safely',
      'project_cloudtalk_message_trigger', 'project_cloudtalk_call_trigger', 'retry_cloudtalk_projections', 'assign_inbound_communication') loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.signature);
    if f.proname in ('retry_cloudtalk_projections', 'assign_inbound_communication') then
      execute format('grant execute on function %s to authenticated', f.signature);
    end if;
  end loop;
end $$;

-- Backfill activity recorded since CloudTalk went live on 2026-09-26.
do $$ declare source text; begin
  for source in
    select 'message:' || message_id from public.cloudtalk_messages order by occurred_at
  loop perform public.project_cloudtalk_source_safely(source); end loop;
  for source in
    select 'call:' || call_uuid from public.cloudtalk_calls where ended_at is not null and trusted_number order by coalesce(started_at, ended_at)
  loop perform public.project_cloudtalk_source_safely(source); end loop;
end $$;
