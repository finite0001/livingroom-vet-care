-- SMS re-subscribe after STOP (CTIA-aligned).
--
-- 2026-09-30 production finding: a household that replied STOP through CloudTalk stayed
-- "SMS blocked" forever. The STOP wrote a `cloudtalk_sms_stop` suppression, but nothing
-- could ever remove it: the CloudTalk ingest ignored START, and staff re-consent
-- (record_sms_consent) only removed `staff_sms_opt_out`.
--
-- Contract after this migration:
--   * An inbound CloudTalk SMS whose whole trimmed body is START / UNSTOP / YES (any case)
--     lifts a STOP-keyword suppression for that same number, but only when the keyword
--     occurred AFTER the STOP and after any later staff-recorded withdrawal. The lift is
--     recorded once per provider message (webhook replays are no-ops) together with the
--     consent it restores (consent_method SMS_KEYWORD) for an unambiguous household.
--   * Staff recording explicit agreement (record_sms_consent, opted in, with evidence) lifts
--     STOP-keyword and staff opt-out suppressions, never carrier/complaint/manual ones.
--   * Staff withdrawal and inbound STOP re-suppress. Every suppress/lift of an opt-out is
--     appended to sms_suppression_events (who, when, which message).
--   * current_sms_consent explains the effective block and the latest resumption.
--   * Existing STOP suppressions followed by a START keyword or later staff consent are
--     reconciled (lifted and audited) at the end of this migration.
-- HELP handling is unchanged. No new grants to anon/authenticated/service_role other than
-- staff read of the new audit table (same policy as communication_suppressions).
-- Permanent conditions never raise 40001/40P01 (see docs/postgrest-retryable-sqlstates.md).

-- ---------------------------------------------------------------------------
-- Keyword classification: one source of truth for STOP / START / HELP.

create function public.sms_keyword(p_body text) returns text
language sql immutable set search_path = public as $$
  select case upper(regexp_replace(coalesce(p_body, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'))
    when 'STOP' then 'STOP' when 'STOPALL' then 'STOP' when 'UNSUBSCRIBE' then 'STOP'
    when 'CANCEL' then 'STOP' when 'END' then 'STOP' when 'QUIT' then 'STOP'
    when 'START' then 'START' when 'UNSTOP' then 'START' when 'YES' then 'START'
    when 'HELP' then 'HELP' when 'INFO' then 'HELP'
  end
$$;
revoke all on function public.sms_keyword(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- When and by which provider message an opt-out began ("latest STOP").

alter table public.communication_suppressions
  add column occurred_at timestamptz,
  add column provider text check (provider is null or provider in ('cloudtalk', 'twilio')),
  add column provider_message_id text check (provider_message_id is null or length(provider_message_id) between 1 and 200);

-- ---------------------------------------------------------------------------
-- Append-only audit of SMS opt-out suppressions and their lifting.

create table public.sms_suppression_events (
  id uuid primary key default gen_random_uuid(),
  recipient text not null check (recipient ~ '^\+[1-9][0-9]{7,14}$'),
  action text not null check (action in ('suppressed', 'lifted')),
  source text not null check (source in ('sms_keyword', 'staff_consent', 'staff_withdrawal')),
  keyword text check (keyword is null or keyword in ('STOP', 'START')),
  -- The suppression reason that was written (suppressed) or removed (lifted).
  suppression_reason text not null check (length(suppression_reason) between 1 and 500),
  -- For a lift: when the lifted opt-out began.
  suppressed_at timestamptz,
  -- Snapshot only (no FK): audit rows must outlive household edits.
  client_id uuid,
  provider text check (provider is null or provider in ('cloudtalk', 'twilio')),
  provider_message_id text check (provider_message_id is null or length(provider_message_id) between 1 and 200),
  actor_id uuid references auth.users(id),
  note text check (note is null or length(note) between 1 and 500),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  check ((source = 'sms_keyword') = (keyword is not null)),
  check (source <> 'sms_keyword' or provider_message_id is not null),
  check (source = 'sms_keyword' or actor_id is not null or note is not null)
);
-- One event per provider message: CloudTalk replays (new event id, same message) are no-ops.
create unique index sms_suppression_events_message_idx on public.sms_suppression_events(provider, provider_message_id)
  where provider_message_id is not null;
create index sms_suppression_events_recipient_idx on public.sms_suppression_events(recipient, occurred_at desc, created_at desc);

alter table public.sms_suppression_events enable row level security;
revoke all on public.sms_suppression_events from public, anon, authenticated, service_role;
grant select on public.sms_suppression_events to authenticated;
create policy "Active staff read" on public.sms_suppression_events for select to authenticated using (public.is_active_staff(auth.uid()));

create function public.guard_sms_suppression_events() returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'SMS suppression audit is append-only' using errcode = '23514';
end $$;
create trigger guard_sms_suppression_events before update or delete on public.sms_suppression_events
  for each row execute function public.guard_sms_suppression_events();
revoke all on function public.guard_sms_suppression_events() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Internal helpers. Callers hold pg_advisory_xact_lock(hashtextextended('SMS:'||phone,936)),
-- the lock record_sms_consent and the Twilio inbound path already use for a number.

-- Write (or refresh) an opt-out suppression and audit it. Only opt-out kinds are replaced;
-- carrier, complaint and manual suppressions are kept as they are.
create function public.sms_record_opt_out_internal(
  p_recipient text, p_reason text, p_source text, p_occurred_at timestamptz, p_client_id uuid,
  p_provider text, p_provider_message_id text, p_actor_id uuid
) returns boolean language plpgsql set search_path = public as $$
declare written boolean;
begin
  insert into public.communication_suppressions(channel, recipient, reason, created_by, occurred_at, provider, provider_message_id)
  values ('SMS', p_recipient, p_reason, p_actor_id, p_occurred_at, p_provider, p_provider_message_id)
  on conflict (channel, recipient) do update set
    reason = excluded.reason, created_by = excluded.created_by, created_at = now(),
    occurred_at = excluded.occurred_at, provider = excluded.provider, provider_message_id = excluded.provider_message_id
  where communication_suppressions.reason in ('cloudtalk_sms_stop', 'provider_sms_stop', 'staff_sms_opt_out')
    and excluded.occurred_at >= coalesce(communication_suppressions.occurred_at, communication_suppressions.created_at);
  written := found;
  if written then
    insert into public.sms_suppression_events(recipient, action, source, keyword, suppression_reason, client_id, provider, provider_message_id, actor_id, occurred_at)
    values (p_recipient, 'suppressed', p_source, case when p_source = 'sms_keyword' then 'STOP' end, p_reason, p_client_id, p_provider, p_provider_message_id, p_actor_id, p_occurred_at)
    on conflict (provider, provider_message_id) where provider_message_id is not null do nothing;
  end if;
  return written;
end $$;
revoke all on function public.sms_record_opt_out_internal(text,text,text,timestamptz,uuid,text,text,uuid) from public, anon, authenticated, service_role;

-- Lift an opt-out suppression that began before p_occurred_at. A START keyword lifts only a
-- STOP-keyword suppression; explicit staff consent also lifts a staff opt-out. Anything else
-- (bounce, complaint, manual do-not-text) keeps blocking.
create function public.sms_lift_opt_out_internal(
  p_recipient text, p_source text, p_occurred_at timestamptz, p_client_id uuid,
  p_provider text, p_provider_message_id text, p_actor_id uuid, p_note text default null
) returns boolean language plpgsql set search_path = public as $$
declare s public.communication_suppressions; since timestamptz;
begin
  select * into s from public.communication_suppressions where channel = 'SMS' and recipient = p_recipient for update;
  if not found then return false; end if;
  if not (s.reason in ('cloudtalk_sms_stop', 'provider_sms_stop') or (p_source = 'staff_consent' and s.reason = 'staff_sms_opt_out')) then
    return false;
  end if;
  since := coalesce(s.occurred_at, s.created_at);
  -- Only a keyword that arrived after the STOP counts. Staff consent is recorded now and so
  -- always follows the suppression it reviews.
  if p_occurred_at < since or (p_source = 'sms_keyword' and p_occurred_at = since) then return false; end if;
  insert into public.sms_suppression_events(recipient, action, source, keyword, suppression_reason, suppressed_at, client_id, provider, provider_message_id, actor_id, note, occurred_at)
  values (p_recipient, 'lifted', p_source, case when p_source = 'sms_keyword' then 'START' end, s.reason, since, p_client_id, p_provider, p_provider_message_id, p_actor_id, p_note, p_occurred_at)
  on conflict (provider, provider_message_id) where provider_message_id is not null do nothing;
  if not found then return false; end if;
  delete from public.communication_suppressions where channel = 'SMS' and recipient = p_recipient;
  return true;
end $$;
revoke all on function public.sms_lift_opt_out_internal(text,text,timestamptz,uuid,text,text,uuid,text) from public, anon, authenticated, service_role;

-- START keyword: lift, then restore consent for an unambiguous household unless a newer
-- consent decision already exists. Shared numbers stay blocked for staff review.
create function public.sms_apply_start_keyword_internal(
  p_recipient text, p_occurred_at timestamptz, p_provider text, p_provider_message_id text, p_note text default null
) returns boolean language plpgsql set search_path = public as $$
declare matches integer; household uuid; withdrawn_at timestamptz; details text;
begin
  select count(*), (array_agg(c.id))[1] into matches, household from public.clients c
  where public.communication_recipient('SMS', c.primary_phone) = p_recipient;
  -- A staff withdrawal recorded after this START occurred wins.
  select max(opted_out_at) into withdrawn_at from public.sms_consent where public.communication_recipient('SMS', phone_number) = p_recipient;
  if withdrawn_at is not null and p_occurred_at <= withdrawn_at then return false; end if;
  if not public.sms_lift_opt_out_internal(p_recipient, 'sms_keyword', p_occurred_at, case when matches = 1 then household end,
      p_provider, p_provider_message_id, null, p_note) then
    return false;
  end if;
  if matches = 1 then
    details := 'Client replied START by SMS (' || p_provider || ' message ' || p_provider_message_id || ')';
    update public.sms_consent set opted_in = true, opted_in_at = p_occurred_at, opted_out_at = null,
      consent_method = 'SMS_KEYWORD', consent_details = details
    where client_id = household and public.communication_recipient('SMS', phone_number) = p_recipient
      and not opted_in and coalesce(opted_out_at, '-infinity'::timestamptz) < p_occurred_at;
    if not exists (select 1 from public.sms_consent where client_id = household and public.communication_recipient('SMS', phone_number) = p_recipient) then
      insert into public.sms_consent(client_id, phone_number, opted_in, opted_in_at, consent_method, consent_details)
      values (household, p_recipient, true, p_occurred_at, 'SMS_KEYWORD', details);
    end if;
  end if;
  return true;
end $$;
revoke all on function public.sms_apply_start_keyword_internal(text,timestamptz,text,text,text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- CloudTalk ingest: same contract as 20260928110000, with STOP audited and START honored.

create or replace function public.ingest_cloudtalk_event(
  p_event_id text, p_event_type text, p_occurred_at timestamptz, p_data jsonb
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  call_key text;
  number_internal text;
  number_external text;
  message_key text;
  keyword text;
  sender text;
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
    keyword := case when p_event_type = 'message.received' and p_data->>'channel' = 'sms' then public.sms_keyword(p_data->>'body') end;
    if keyword in ('STOP', 'START') then
      sender := public.communication_recipient('SMS', number_external);
      perform pg_advisory_xact_lock(hashtextextended('SMS:' || sender, 936));
    end if;
    -- A signed inbound STOP blocks any future SMS request, including one queued before the
    -- message arrived, unless the client already resumed texting after it (a delayed STOP
    -- webhook must not undo a later START or staff re-consent).
    if keyword = 'STOP' and not exists (
        select 1 from public.sms_suppression_events e
        where e.recipient = sender and e.action = 'lifted' and e.occurred_at > p_occurred_at) then
      perform public.sms_record_opt_out_internal(sender, 'cloudtalk_sms_stop', 'sms_keyword', p_occurred_at, null, 'cloudtalk', message_key, null);
      update public.sms_consent set opted_in = false, opted_out_at = greatest(coalesce(opted_out_at, p_occurred_at), p_occurred_at)
      where public.communication_recipient('SMS', phone_number) = sender;
      update public.communication_outbox set state = 'failed', last_error = 'recipient_suppressed', updated_at = now()
      where channel = 'SMS' and recipient = sender and state = 'pending';
      update public.outbound_deliveries set status = 'CANCELED', canceled_at = now(), updated_at = now(), status_note = 'Recipient sent STOP to CloudTalk'
      where channel = 'SMS' and recipient = sender and status = 'QUEUED';
    elsif keyword = 'START' then
      -- START / UNSTOP / YES after a STOP from this number resumes texting (CTIA).
      perform public.sms_apply_start_keyword_internal(sender, p_occurred_at, 'cloudtalk', message_key);
    end if;
  end if;
  return true;
end $$;
revoke all on function public.ingest_cloudtalk_event(text,text,timestamptz,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.ingest_cloudtalk_event(text,text,timestamptz,jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Staff consent: same contract as 20260928190000, plus audited lifting of STOP-type
-- suppressions on explicit agreement and audited re-suppression on withdrawal.

create or replace function public.record_sms_consent(p_actor_id uuid, p_client_id uuid, p_phone text, p_opted_in boolean, p_method public.consent_method, p_details text, p_expected_updated_at timestamptz default null)
returns public.sms_consent language plpgsql security definer set search_path = public as $$
declare actor uuid;normalized_phone text;latest timestamptz;result public.sms_consent;
begin
 actor:=public.clinical_require_staff();if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501';end if;
 normalized_phone:=public.communication_recipient('SMS',p_phone);
 if normalized_phone is null or p_opted_in is null or p_method is null or p_method not in ('VERBAL','WRITTEN','WEB_FORM') or p_details is null or length(trim(p_details)) not between 5 and 1000 or not exists(select 1 from public.clients where id=p_client_id and public.communication_recipient('SMS',primary_phone)=normalized_phone) then raise exception 'Matching household number and documented consent method required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('SMS:'||normalized_phone,936));
 if p_opted_in and (select count(*) from public.clients where public.communication_recipient('SMS',primary_phone)=normalized_phone)<>1 then raise exception 'Shared phone numbers require separate consent review' using errcode='23514';end if;
 select max(updated_at) into latest from public.sms_consent where client_id=p_client_id and public.communication_recipient('SMS',phone_number)=normalized_phone;
 if latest is distinct from p_expected_updated_at then raise exception 'Consent changed; reload before saving' using errcode='PT409';end if;
 insert into public.sms_consent(client_id,phone_number,opted_in,opted_in_at,opted_out_at,consent_method,consent_details)
 values(p_client_id,normalized_phone,p_opted_in,case when p_opted_in then now() else null end,case when not p_opted_in then now() else null end,p_method,trim(p_details))
 on conflict(client_id,phone_number) do update set opted_in=excluded.opted_in,opted_in_at=excluded.opted_in_at,opted_out_at=excluded.opted_out_at,consent_method=excluded.consent_method,consent_details=excluded.consent_details;
 update public.sms_consent set opted_in=p_opted_in,opted_in_at=case when p_opted_in then now() else null end,opted_out_at=case when not p_opted_in then now() else null end,consent_method=p_method,consent_details=trim(p_details)
 where client_id=p_client_id and public.communication_recipient('SMS',phone_number)=normalized_phone;
 if p_opted_in then
  -- Explicit, evidenced agreement lifts a STOP reply or staff opt-out; never carrier,
  -- complaint or manual suppressions.
  perform public.sms_lift_opt_out_internal(normalized_phone,'staff_consent',now(),p_client_id,null,null,actor,null);
 else
  perform public.sms_record_opt_out_internal(normalized_phone,'staff_sms_opt_out','staff_withdrawal',now(),p_client_id,null,null,actor);
  update public.communication_outbox set state='failed',last_error='recipient_suppressed' where channel='SMS' and communication_outbox.recipient=normalized_phone and state='pending';
 end if;
 select * into result from public.sms_consent where client_id=p_client_id and phone_number=normalized_phone;
 return result;
end $$;
revoke all on function public.record_sms_consent(uuid,uuid,text,boolean,public.consent_method,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.record_sms_consent(uuid,uuid,text,boolean,public.consent_method,text,timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Consent display: why texting is blocked and how it last resumed.

create or replace function public.current_sms_consent(p_client_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare phone text; selected public.sms_consent; result jsonb; s public.communication_suppressions; lift public.sms_suppression_events;
 lifted_by text; can boolean; block text; since timestamptz;
begin
 perform public.clinical_require_staff();
 select public.communication_recipient('SMS',primary_phone) into phone from public.clients where id=p_client_id;
 if not found then raise exception 'Household not found' using errcode='P0002'; end if;
 select * into selected from public.sms_consent where client_id=p_client_id and public.communication_recipient('SMS',phone_number)=phone order by updated_at desc,id desc limit 1;
 result:=case when selected.id is null then jsonb_build_object('id',null,'client_id',p_client_id,'phone_number',phone,'opted_in',false,'updated_at',null) else to_jsonb(selected) end;
 can:=phone is not null and not public.communication_is_suppressed('SMS',phone,p_client_id);
 if phone is not null then
  select * into s from public.communication_suppressions where channel='SMS' and recipient=phone;
  select * into lift from public.sms_suppression_events where recipient=phone and action='lifted' order by occurred_at desc,created_at desc,id desc limit 1;
  if lift.actor_id is not null then
   select coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.first_name||' '||p.last_name),'')) into lifted_by from public.profiles p where p.id=lift.actor_id;
  end if;
 end if;
 if not can then
  if phone is null then block:='no_phone';
  elsif s.recipient is not null then
   since:=coalesce(s.occurred_at,s.created_at);
   block:=case when s.reason in ('cloudtalk_sms_stop','provider_sms_stop') then 'sms_stop'
    when s.reason='staff_sms_opt_out' then 'staff_opt_out'
    when s.reason in ('provider_bounced','provider_failed','provider_undelivered') then 'undeliverable'
    when s.reason='provider_complained' then 'complaint'
    else 'suppressed' end;
  elsif exists(select 1 from public.communication_provider_events where provider='twilio' and event_type='inbound' and state in ('pending','claimed','review') and metadata->>'opt_action'='STOP' and metadata->>'from'=phone) then
   block:='sms_stop';
  elsif (select count(*) from public.clients where public.communication_recipient('SMS',primary_phone)=phone)>1 then block:='shared_phone';
  elsif selected.id is not null and not selected.opted_in and selected.opted_out_at is not null then block:='consent_withdrawn';since:=selected.opted_out_at;
  else block:='consent_missing';
  end if;
 end if;
 return result || jsonb_build_object('can_message',can,'block_reason',block,'blocked_since',since,
  'last_resumed',case when lift.id is null then null else jsonb_build_object('source',lift.source,'keyword',lift.keyword,'at',lift.occurred_at,
   'by',case when lift.source='staff_consent' then lifted_by end,'after_reason',lift.suppression_reason,'after_since',lift.suppressed_at) end);
end $$;
revoke all on function public.current_sms_consent(uuid) from public,anon,authenticated,service_role;
grant execute on function public.current_sms_consent(uuid) to authenticated;

-- Patient 360 header: same contract as 20260928170000, plus the consent explanation.
create or replace function public.patient_360_header_internal(p_client_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.clients;
  consent jsonb;
begin
  select * into c from public.clients where id = p_client_id;
  consent := public.current_sms_consent(p_client_id);
  return jsonb_build_object(
    'household', jsonb_build_object('id', c.id, 'full_name', c.full_name, 'first_name', c.first_name, 'last_name', c.last_name,
      'primary_phone', c.primary_phone, 'primary_email', c.primary_email, 'preferred_channel', c.preferred_channel,
      'housecall_address', c.housecall_address, 'mailing_address', c.mailing_address),
    'pets', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'species', p.species, 'breed', p.breed,
        'archived_at', p.archived_at, 'deceased_at', p.deceased_at, 'allergies', nullif(trim(p.allergies), '')) order by (p.archived_at is not null or p.deceased_at is not null), p.name, p.id)
      from public.pets p where p.client_id = p_client_id), '[]'),
    'sms_consent', jsonb_build_object('opted_in', coalesce((consent->>'opted_in')::boolean, false), 'can_message', coalesce((consent->>'can_message')::boolean, false),
      'phone_number', consent->>'phone_number', 'updated_at', consent->>'updated_at',
      'block_reason', consent->'block_reason', 'blocked_since', consent->'blocked_since', 'last_resumed', consent->'last_resumed'),
    'balance', (select jsonb_build_object('outstanding_cents', coalesce(sum(b.outstanding), 0)::text, 'open_invoice_count', count(*) filter (where b.outstanding > 0))
      from (select (public.payment_balance_internal(i.id)->>'outstanding_cents')::bigint outstanding
            from public.billing_invoices i where i.client_id = p_client_id and i.status = 'issued') b),
    'high_priority_problems', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'pet_id', pr.pet_id, 'pet_name', p.name, 'title', pr.title) order by p.name, pr.title, pr.id)
      from public.patient_problems pr join public.pets p on p.id = pr.pet_id
      where p.client_id = p_client_id and pr.status = 'active' and pr.importance = 'high'), '[]')
  );
end $$;
revoke all on function public.patient_360_header_internal(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reconcile existing STOP suppressions (production had STOP -> START -> staff consent).

create function public.sms_reconcile_opt_outs_internal() returns integer
language plpgsql set search_path = public as $$
declare lifted integer := 0; s record; stop_at timestamptz; stop_id text; start_at timestamptz; start_id text;
  consent_id uuid; consent_client uuid; consent_at timestamptz; actor uuid;
begin
  for s in select * from public.communication_suppressions
    where channel = 'SMS' and reason in ('cloudtalk_sms_stop', 'provider_sms_stop') order by recipient
  loop
    perform pg_advisory_xact_lock(hashtextextended('SMS:' || s.recipient, 936));
    stop_at := null; stop_id := null; start_at := null; start_id := null;
    consent_id := null; consent_client := null; consent_at := null; actor := null;
    if s.occurred_at is not null then
      stop_at := s.occurred_at;
    else
      -- Legacy row: date the opt-out by the latest inbound STOP message from that number.
      select m.occurred_at, m.message_id into stop_at, stop_id from public.cloudtalk_messages m
      where m.direction = 'inbound' and m.channel = 'sms' and public.communication_recipient('SMS', m.external_number) = s.recipient
        and public.sms_keyword(m.body) = 'STOP' and m.occurred_at <= s.created_at + interval '5 minutes'
      order by m.occurred_at desc, m.message_id desc limit 1;
      stop_at := coalesce(stop_at, s.created_at);
      update public.communication_suppressions set occurred_at = stop_at,
        provider = case when stop_id is not null then 'cloudtalk' end, provider_message_id = stop_id
      where channel = 'SMS' and recipient = s.recipient;
    end if;

    -- 1. A START / UNSTOP / YES keyword after the STOP.
    select m.occurred_at, m.message_id into start_at, start_id from public.cloudtalk_messages m
    where m.direction = 'inbound' and m.channel = 'sms' and public.communication_recipient('SMS', m.external_number) = s.recipient
      and public.sms_keyword(m.body) = 'START' and m.occurred_at > stop_at
    order by m.occurred_at desc, m.message_id desc limit 1;
    if start_id is not null and public.sms_apply_start_keyword_internal(s.recipient, start_at, 'cloudtalk', start_id,
        'Reconciled by migration 20260930100000') then
      lifted := lifted + 1;
      continue;
    end if;

    -- 2. Explicit staff consent recorded after the STOP (the consent saved but the STOP kept blocking).
    select c.id, c.client_id, c.opted_in_at into consent_id, consent_client, consent_at from public.sms_consent c
    where public.communication_recipient('SMS', c.phone_number) = s.recipient and c.opted_in
      and c.consent_method in ('VERBAL', 'WRITTEN', 'WEB_FORM') and c.opted_in_at > stop_at
      and (select count(*) from public.clients k where public.communication_recipient('SMS', k.primary_phone) = s.recipient) = 1
    order by c.opted_in_at desc limit 1;
    if consent_id is not null then
      select a.user_id into actor from public.audit_logs a
      where a.table_name = 'sms_consent' and a.record_id = consent_id and a.user_id is not null
        and exists (select 1 from auth.users u where u.id = a.user_id)
      order by a.created_at desc limit 1;
      if public.sms_lift_opt_out_internal(s.recipient, 'staff_consent', consent_at, consent_client, null, null, actor,
          'Reconciled by migration 20260930100000') then
        lifted := lifted + 1;
      end if;
    end if;
  end loop;
  return lifted;
end $$;
revoke all on function public.sms_reconcile_opt_outs_internal() from public, anon, authenticated, service_role;

select public.sms_reconcile_opt_outs_internal();
