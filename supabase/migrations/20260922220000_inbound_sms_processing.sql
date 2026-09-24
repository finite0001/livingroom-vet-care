alter table public.messages
  add column if not exists provider text,
  add column if not exists provider_message_id text;

create unique index if not exists messages_provider_message_unique
  on public.messages (provider, provider_message_id)
  where provider is not null and provider_message_id is not null;

create or replace function public.normalize_sms_phone(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_value is null then null
    when btrim(p_value) ~ '^\+[0-9 ().-]+$'
      and regexp_replace(btrim(p_value), '[ ().-]', '', 'g') ~ '^\+[1-9][0-9]{7,14}$'
      then regexp_replace(btrim(p_value), '[ ().-]', '', 'g')
    else null
  end;
$$;

comment on function public.normalize_sms_phone(text) is
  'Normalizes explicitly international SMS phone numbers for webhook ingestion. It removes presentation punctuation only and never infers a country code.';

create or replace function public.record_inbound_sms(
  p_from text,
  p_to text,
  p_body text,
  p_provider_message_id text,
  p_opt_out_type text default null,
  p_received_at timestamptz default now()
)
returns table (
  client_id uuid,
  conversation_id uuid,
  message_id uuid,
  consent_action text
)
language plpgsql
set search_path = public
as $$
declare
  normalized_from text := public.normalize_sms_phone(p_from);
  normalized_to text := public.normalize_sms_phone(p_to);
  normalized_body text := nullif(btrim(coalesce(p_body, '')), '');
  normalized_provider_message_id text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
  normalized_opt_out_type text := upper(nullif(btrim(coalesce(p_opt_out_type, '')), ''));
  keyword text;
  selected_client_id uuid;
  selected_conversation_id uuid;
  selected_message_id uuid;
  selected_consent_action text := 'NONE';
begin
  if normalized_from is null then
    raise exception 'Inbound SMS sender phone is invalid' using errcode = '23514';
  end if;

  if normalized_to is null then
    raise exception 'Inbound SMS recipient phone is invalid' using errcode = '23514';
  end if;

  if normalized_body is null or length(normalized_body) > 1600 then
    raise exception 'Inbound SMS body must be between 1 and 1600 characters' using errcode = '23514';
  end if;

  if normalized_provider_message_id is null or length(normalized_provider_message_id) > 256 then
    raise exception 'Inbound SMS provider message id is required' using errcode = '23514';
  end if;

  select m.id, c.id, c.client_id
  into selected_message_id, selected_conversation_id, selected_client_id
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where m.provider = 'twilio'
    and m.provider_message_id = normalized_provider_message_id
  limit 1;

  if selected_message_id is not null then
    client_id := selected_client_id;
    conversation_id := selected_conversation_id;
    message_id := selected_message_id;
    consent_action := 'DUPLICATE';
    return next;
    return;
  end if;

  select c.id
  into selected_client_id
  from public.clients c
  where public.normalize_sms_phone(c.primary_phone) = normalized_from
  order by c.created_at, c.id
  limit 1;

  if selected_client_id is null then
    insert into public.clients (
      first_name,
      last_name,
      full_name,
      primary_phone,
      preferred_channel
    )
    values (
      'Unknown',
      right(normalized_from, 4),
      'Unknown SMS ' || normalized_from,
      normalized_from,
      'SMS'::public.channel_type
    )
    returning id into selected_client_id;
  end if;

  keyword := upper(regexp_replace(normalized_body, '\s+', ' ', 'g'));
  if normalized_opt_out_type is null then
    if keyword in ('STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE') then
      normalized_opt_out_type := 'STOP';
    elsif keyword in ('START', 'YES', 'UNSTOP') then
      normalized_opt_out_type := 'START';
    elsif keyword in ('HELP', 'INFO') then
      normalized_opt_out_type := 'HELP';
    end if;
  end if;

  if normalized_opt_out_type = 'STOP' then
    insert into public.sms_consent (
      client_id,
      phone_number,
      opted_in,
      opted_out_at,
      consent_method,
      consent_details
    )
    values (
      selected_client_id,
      normalized_from,
      false,
      p_received_at,
      'SMS_KEYWORD'::public.consent_method,
      'Twilio inbound opt-out keyword'
    )
    on conflict on constraint sms_consent_client_phone_unique do update
      set opted_in = false,
        opted_out_at = excluded.opted_out_at,
        consent_method = excluded.consent_method,
        consent_details = excluded.consent_details,
        updated_at = now();
    selected_consent_action := 'OPTED_OUT';
  elsif normalized_opt_out_type = 'START' then
    insert into public.sms_consent (
      client_id,
      phone_number,
      opted_in,
      opted_in_at,
      opted_out_at,
      consent_method,
      consent_details
    )
    values (
      selected_client_id,
      normalized_from,
      true,
      p_received_at,
      null,
      'SMS_KEYWORD'::public.consent_method,
      'Twilio inbound opt-in keyword'
    )
    on conflict on constraint sms_consent_client_phone_unique do update
      set opted_in = true,
        opted_in_at = excluded.opted_in_at,
        opted_out_at = null,
        consent_method = excluded.consent_method,
        consent_details = excluded.consent_details,
        updated_at = now();
    selected_consent_action := 'OPTED_IN';
  elsif normalized_opt_out_type = 'HELP' then
    selected_consent_action := 'HELP';
  end if;

  select c.id
  into selected_conversation_id
  from public.conversations c
  where c.client_id = selected_client_id
    and c.status = 'ACTIVE'::public.conversation_status
  order by c.last_message_at desc, c.created_at desc, c.id
  limit 1;

  if selected_conversation_id is null then
    insert into public.conversations (
      client_id,
      status,
      priority,
      first_message_at,
      last_message_at,
      is_read
    )
    values (
      selected_client_id,
      'ACTIVE'::public.conversation_status,
      'NORMAL'::public.conversation_priority,
      p_received_at,
      p_received_at,
      false
    )
    returning id into selected_conversation_id;
  end if;

  insert into public.messages (
    conversation_id,
    type,
    sender_type,
    content,
    is_internal,
    provider,
    provider_message_id,
    created_at
  )
  values (
    selected_conversation_id,
    'SMS'::public.message_type,
    'CLIENT'::public.sender_type,
    normalized_body,
    false,
    'twilio',
    normalized_provider_message_id,
    p_received_at
  )
  returning id into selected_message_id;

  update public.conversations c
  set last_message_at = p_received_at,
    first_message_at = coalesce(c.first_message_at, p_received_at),
    is_read = false,
    status = 'ACTIVE'::public.conversation_status
  where c.id = selected_conversation_id;

  client_id := selected_client_id;
  conversation_id := selected_conversation_id;
  message_id := selected_message_id;
  consent_action := selected_consent_action;
  return next;
end
$$;

comment on function public.record_inbound_sms(text, text, text, text, text, timestamptz) is
  'Service-role Twilio inbound SMS ingestion RPC. Verifies idempotency by provider message id, matches or creates a client, inserts a CLIENT SMS message, marks the conversation unread, and applies STOP/START/HELP consent semantics.';

revoke all on function public.normalize_sms_phone(text) from public, anon, authenticated, service_role;
grant execute on function public.normalize_sms_phone(text) to service_role;

revoke all on function public.record_inbound_sms(
  text,
  text,
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.record_inbound_sms(
  text,
  text,
  text,
  text,
  text,
  timestamptz
) to service_role;
