-- CloudTalk activity is provider evidence, separate from delivery claims. A
-- message.sent event is carrier submission, not handset delivery.
create table public.cloudtalk_events (
  event_id text primary key,
  event_type text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);

create table public.cloudtalk_calls (
  call_uuid text primary key,
  call_id text,
  direction text,
  external_number text,
  internal_number text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  is_voicemail boolean not null default false,
  recording_ready boolean not null default false,
  transcript_ready boolean not null default false,
  ai_summary text,
  ai_language text,
  last_event_at timestamptz not null
);
create index cloudtalk_calls_recent_idx on public.cloudtalk_calls(last_event_at desc);

create table public.cloudtalk_messages (
  message_id text primary key,
  direction text not null check(direction in ('inbound', 'outbound')),
  channel text not null check(channel in ('sms', 'mms', 'whatsapp')),
  external_number text not null,
  internal_number text not null,
  body text not null default '',
  occurred_at timestamptz not null
);
create index cloudtalk_messages_recent_idx on public.cloudtalk_messages(occurred_at desc);

alter table public.cloudtalk_events enable row level security;
alter table public.cloudtalk_calls enable row level security;
alter table public.cloudtalk_messages enable row level security;
revoke all on public.cloudtalk_events, public.cloudtalk_calls, public.cloudtalk_messages from public, anon, authenticated, service_role;
grant select on public.cloudtalk_calls, public.cloudtalk_messages to authenticated;
create policy "Active staff read CloudTalk calls" on public.cloudtalk_calls
  for select to authenticated using (public.is_active_staff(auth.uid()));
create policy "Active staff read CloudTalk messages" on public.cloudtalk_messages
  for select to authenticated using (public.is_active_staff(auth.uid()));

create function public.ingest_cloudtalk_event(
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
      started_at, ended_at, duration_seconds, is_voicemail, recording_ready,
      transcript_ready, ai_summary, ai_language, last_event_at
    ) values (
      call_key, p_data->>'call_id', p_data->>'direction', number_external, number_internal,
      nullif(p_data->>'started_at', '')::timestamptz,
      nullif(p_data->>'ended_at', '')::timestamptz,
      case when (p_data->>'duration') ~ '^[0-9]{1,8}$' then (p_data->>'duration')::integer end,
      coalesce((p_data->>'is_voicemail')::boolean, false),
      p_event_type = 'call.recording_ready',
      p_event_type = 'transcript.ready',
      case when p_event_type = 'cidata.ready' then left(p_data#>>'{summary,summary}', 10000) end,
      case when p_event_type in ('transcript.ready', 'cidata.ready') then left(p_data->>'language', 20) end,
      p_occurred_at
    ) on conflict(call_uuid) do update set
      call_id = coalesce(excluded.call_id, cloudtalk_calls.call_id),
      direction = coalesce(excluded.direction, cloudtalk_calls.direction),
      external_number = coalesce(excluded.external_number, cloudtalk_calls.external_number),
      internal_number = coalesce(excluded.internal_number, cloudtalk_calls.internal_number),
      started_at = coalesce(excluded.started_at, cloudtalk_calls.started_at),
      ended_at = coalesce(excluded.ended_at, cloudtalk_calls.ended_at),
      duration_seconds = coalesce(excluded.duration_seconds, cloudtalk_calls.duration_seconds),
      is_voicemail = excluded.is_voicemail or cloudtalk_calls.is_voicemail,
      recording_ready = excluded.recording_ready or cloudtalk_calls.recording_ready,
      transcript_ready = excluded.transcript_ready or cloudtalk_calls.transcript_ready,
      ai_summary = coalesce(excluded.ai_summary, cloudtalk_calls.ai_summary),
      ai_language = coalesce(excluded.ai_language, cloudtalk_calls.ai_language),
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
