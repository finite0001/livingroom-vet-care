-- CloudTalk capability redaction.
--
-- Since 20260928100000 every app SMS, including reviewed document-link and
-- payment-link texts, is sent through CloudTalk. CloudTalk then posts a
-- message.sent webhook whose body is the materialized text, for example
-- "https://<origin>/shared/<grant id>#v1.<43 chars>". Before this migration that
-- live bearer capability was stored verbatim in cloudtalk_messages.body, where any
-- active staff session could read it, and the unified-inbox projection (correctly)
-- refused it via reject_persisted_document_capability, leaving a projection
-- failure that Retry could never clear.
--
-- Capabilities are now redacted before they are persisted:
--   1. cloudtalk-webhook redacts every string in the verified event (edge, first).
--   2. A BEFORE INSERT trigger redacts cloudtalk_messages.body, and a BEFORE
--      INSERT OR UPDATE trigger redacts cloudtalk_calls.ai_summary, so any other
--      write path is covered too (SQL, defensive).
--   3. reject_persisted_document_capability now also guards both tables, so a
--      token that somehow escaped redaction fails closed instead of being stored.
--
-- Recognition reuses the guard's token shape, (v1|p1|s1)\.[A-Za-z0-9_-]{43}, plus
-- the estimate-decision shape e1 from estimate-decision-capability.ts. When the
-- token is the fragment of a URL (the /shared/:grantId, /pay/:grantId,
-- /payment/return|cancel/:grantId and /estimate/:grantId links the capability
-- modules build), the whole URL is replaced so the grant id is not kept either.
-- A grant id without its fragment token grants nothing and is left as written.

create function public.redact_private_capabilities(p_text text) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(regexp_replace(regexp_replace(p_text,
    '(https?://[^[:space:]#]*#)?v1\.[A-Za-z0-9_-]{43}', '[secure document link]', 'g'),
    '(https?://[^[:space:]#]*#)?[ps]1\.[A-Za-z0-9_-]{43}', '[secure payment link]', 'g'),
    '(https?://[^[:space:]#]*#)?e1\.[A-Za-z0-9_-]{43}', '[secure estimate link]', 'g')
$$;

-- What CloudTalk's message.sent echo of an app send looks like once redacted.
-- The outbox and thread keep the reviewed template ("{{document_link}}",
-- "{{payment_link}}"); the link was only materialized in worker memory.
create function public.cloudtalk_app_send_text(p_body text) returns text
language sql immutable set search_path = public as $$
  select public.redact_private_capabilities(
    replace(replace(p_body, '{{document_link}}', '[secure document link]'), '{{payment_link}}', '[secure payment link]'))
$$;

create function public.redact_cloudtalk_capabilities() returns trigger language plpgsql set search_path = public as $$
begin
  if TG_TABLE_NAME = 'cloudtalk_messages' then
    NEW.body := public.redact_private_capabilities(NEW.body);
  else
    NEW.ai_summary := public.redact_private_capabilities(NEW.ai_summary);
  end if;
  return NEW;
end $$;
-- Trigger names sort before reject_document_capability, so redaction runs first.
create trigger redact_cloudtalk_capabilities before insert on public.cloudtalk_messages
  for each row execute function public.redact_cloudtalk_capabilities();
create trigger redact_cloudtalk_capabilities before insert or update on public.cloudtalk_calls
  for each row execute function public.redact_cloudtalk_capabilities();

-- Every redaction of an already-stored original is recorded, without content.
create table public.cloudtalk_capability_redactions (
  id bigint generated always as identity primary key,
  source text not null check (source ~ '^(message|call):.{1,200}$'),
  field text not null check (field in ('body', 'ai_summary')),
  redacted_at timestamptz not null default now(),
  redacted_by text not null default current_user
);
alter table public.cloudtalk_capability_redactions enable row level security;
revoke all on public.cloudtalk_capability_redactions from public, anon, authenticated, service_role;
grant select on public.cloudtalk_capability_redactions to authenticated;
create policy "Active staff read CloudTalk capability redactions" on public.cloudtalk_capability_redactions
  for select to authenticated using (public.is_active_staff(auth.uid()));
create function public.guard_cloudtalk_capability_redaction_audit() returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'CloudTalk redaction audit is append-only' using errcode = '23514';
end $$;
create trigger guard_cloudtalk_capability_redaction_audit before update or delete on public.cloudtalk_capability_redactions
  for each row execute function public.guard_cloudtalk_capability_redaction_audit();

-- CloudTalk message originals stay immutable with exactly one exception: the
-- body may be replaced by its own redaction, with every other column unchanged.
-- That change can only remove a capability, never add or alter content, and it
-- is audited here. The guards are not disabled, not even for this migration.
create or replace function public.guard_cloudtalk_original() returns trigger language plpgsql set search_path = public as $$
begin
  if TG_OP = 'DELETE' then raise exception 'CloudTalk history cannot be deleted' using errcode = '23514'; end if;
  if TG_TABLE_NAME = 'cloudtalk_messages' then
    if row(NEW.message_id, NEW.direction, NEW.channel, NEW.external_number, NEW.internal_number, NEW.occurred_at)
        is not distinct from row(OLD.message_id, OLD.direction, OLD.channel, OLD.external_number, OLD.internal_number, OLD.occurred_at)
      and NEW.body is distinct from OLD.body
      and NEW.body = public.redact_private_capabilities(OLD.body) then
      insert into public.cloudtalk_capability_redactions(source, field) values ('message:' || OLD.message_id, 'body');
      return NEW;
    end if;
  end if;
  if TG_TABLE_NAME in ('cloudtalk_messages', 'cloudtalk_events') then
    raise exception 'CloudTalk originals are immutable' using errcode = '23514';
  end if;
  if NEW.call_uuid is distinct from OLD.call_uuid then raise exception 'CloudTalk call identity is immutable' using errcode = '23514'; end if;
  return NEW;
end $$;

-- Same as 20260928110000 except that app-send echoes are compared after
-- template-to-placeholder mapping (so a document-link or payment-link text the
-- app sent is absorbed like any other app send), and the thread text is passed
-- through redaction once more.
create or replace function public.project_cloudtalk_source(p_resource_id text) returns uuid
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
  app_sends integer;
  echo_rank integer;
begin
  if p_resource_id is null or p_resource_id !~ '^(message|call):.{1,200}$' then return null; end if;
  if p_resource_id like 'message:%' then
    select * into v_msg from public.cloudtalk_messages where message_id = substr(p_resource_id, 9);
    if not found then return null; end if;
    v_direction := v_msg.direction;
    v_channel := 'SMS';
    v_external := public.communication_recipient('SMS', v_msg.external_number);
    v_internal := public.communication_recipient('SMS', v_msg.internal_number);
    -- Texts the app itself sent through CloudTalk already have their staff
    -- message (with outbox delivery state) in the thread; CloudTalk's
    -- message.sent echo of them must not add a second copy. There is no shared
    -- identifier, so an echo is matched on recipient, exact (redacted) body and
    -- a send window, and at most one echo is absorbed per app send (so an
    -- identical text typed in CloudTalk Phone within the window still appears).
    if v_direction = 'outbound' and v_external is not null then
      select count(*) into app_sends from (
        select 1 from public.communication_outbox o
        where o.channel = 'SMS' and o.message_id is not null and o.recipient = v_external
          and public.cloudtalk_app_send_text(o.body) = v_msg.body
          and coalesce(o.first_attempt_at, o.created_at) between v_msg.occurred_at - interval '1 hour' and v_msg.occurred_at + interval '10 minutes'
        union all
        select 1 from public.outbound_deliveries d
        where d.channel = 'SMS'::public.channel_type and d.message_id is not null
          and public.communication_recipient('SMS', d.recipient) = v_external
          and public.cloudtalk_app_send_text(d.payload->>'body') = v_msg.body
          and coalesce(d.leased_at, d.accepted_at, d.created_at) between v_msg.occurred_at - interval '1 hour' and v_msg.occurred_at + interval '10 minutes'
      ) app;
      if app_sends > 0 then
        select count(*) into echo_rank from public.cloudtalk_messages m
        where m.direction = 'outbound' and m.body = v_msg.body
          and public.communication_recipient('SMS', m.external_number) = v_external
          and m.occurred_at between v_msg.occurred_at - interval '70 minutes' and v_msg.occurred_at
          and (m.occurred_at, m.message_id) <= (v_msg.occurred_at, v_msg.message_id);
        if echo_rank <= app_sends then return null; end if;
      end if;
    end if;
    v_body := case when btrim(v_msg.body) = '' then '[' || upper(v_msg.channel) || ' with no text. Open CloudTalk to view attachments.]'
      else public.redact_private_capabilities(v_msg.body) end;
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

-- Redacts capabilities already stored in CloudTalk originals and re-projects the
-- affected texts, clearing the failures their tokens caused. Idempotent: a
-- second run finds nothing to change and returns 0. Owner-only; the migration
-- runs it once. communication_inbound, messages and cloudtalk_projection_failures
-- need no redaction: the first two refused tokens via
-- reject_persisted_document_capability and the third never stores content.
create function public.redact_stored_cloudtalk_capabilities() returns integer
language plpgsql security definer set search_path = public as $$
declare message_ids text[]; call_count integer; source text;
begin
  with changed as (
    update public.cloudtalk_messages set body = public.redact_private_capabilities(body)
    where body is distinct from public.redact_private_capabilities(body)
    returning message_id, occurred_at
  ) select coalesce(array_agg(message_id order by occurred_at, message_id), '{}') into message_ids from changed;
  with changed as (
    update public.cloudtalk_calls set ai_summary = public.redact_private_capabilities(ai_summary)
    where ai_summary is distinct from public.redact_private_capabilities(ai_summary)
    returning call_uuid
  ), audited as (
    insert into public.cloudtalk_capability_redactions(source, field) select 'call:' || call_uuid, 'ai_summary' from changed returning 1
  ) select count(*) into call_count from audited;
  foreach source in array message_ids loop
    perform public.project_cloudtalk_source_safely('message:' || source);
  end loop;
  return cardinality(message_ids) + call_count;
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('redact_private_capabilities', 'cloudtalk_app_send_text', 'redact_cloudtalk_capabilities',
      'guard_cloudtalk_capability_redaction_audit', 'guard_cloudtalk_original', 'project_cloudtalk_source', 'redact_stored_cloudtalk_capabilities') loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.signature);
  end loop;
end $$;

select public.redact_stored_cloudtalk_capabilities();

-- Fail closed if a capability ever reaches a CloudTalk original unredacted.
create trigger reject_document_capability before insert or update on public.cloudtalk_messages
  for each row execute function public.reject_persisted_document_capability();
create trigger reject_document_capability before insert or update on public.cloudtalk_calls
  for each row execute function public.reject_persisted_document_capability();
