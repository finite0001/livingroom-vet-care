create or replace function public.enqueue_staff_outbound_message(
  p_actor_id uuid,
  p_conversation_id uuid,
  p_channel public.channel_type,
  p_recipient text,
  p_subject text default null,
  p_body text default null,
  p_requested_at timestamptz default now(),
  p_idempotency_key text default null
)
returns table (
  message_id uuid,
  outbound_delivery_id uuid,
  enqueue_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_recipient text := nullif(btrim(coalesce(p_recipient, '')), '');
  normalized_subject text := nullif(btrim(coalesce(p_subject, '')), '');
  normalized_body text := nullif(btrim(coalesce(p_body, '')), '');
  normalized_idempotency_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  selected_client_id uuid;
  selected_message_id uuid;
  selected_delivery_id uuid;
  selected_status text := 'QUEUED';
begin
  if p_actor_id is null or not public.is_active_staff(p_actor_id) then
    raise exception 'Active staff access required' using errcode = '42501';
  end if;

  if p_conversation_id is null then
    raise exception 'Conversation is required' using errcode = '23514';
  end if;

  if p_requested_at is null then
    raise exception 'Request timestamp is required' using errcode = '23514';
  end if;

  if p_channel not in ('EMAIL'::public.channel_type, 'SMS'::public.channel_type) then
    raise exception 'Outbound channel must be EMAIL or SMS' using errcode = '23514';
  end if;

  if normalized_body is null
    or (p_channel = 'SMS'::public.channel_type and length(normalized_body) > 1600)
    or (p_channel = 'EMAIL'::public.channel_type and length(normalized_body) > 100000)
  then
    raise exception 'Message body is invalid for this channel' using errcode = '23514';
  end if;

  if normalized_idempotency_key is not null and length(normalized_idempotency_key) > 256 then
    raise exception 'Idempotency key is too long' using errcode = '23514';
  end if;

  if p_channel = 'EMAIL'::public.channel_type and (normalized_subject is null or length(normalized_subject) > 500) then
    raise exception 'Email subject is required' using errcode = '23514';
  end if;

  select c.client_id
  into selected_client_id
  from public.conversations c
  where c.id = p_conversation_id;

  if selected_client_id is null then
    raise exception 'Conversation not found' using errcode = '23514';
  end if;

  if normalized_idempotency_key is not null then
    select od.message_id, od.id
    into selected_message_id, selected_delivery_id
    from public.outbound_deliveries od
    where od.channel = p_channel
      and od.idempotency_key = normalized_idempotency_key
    limit 1;

    if selected_delivery_id is not null then
      if not exists (
        select 1
        from public.outbound_deliveries od
        where od.id = selected_delivery_id
          and od.requested_by = p_actor_id
          and od.conversation_id = p_conversation_id
          and od.client_id = selected_client_id
      ) then
        raise exception 'Idempotency key was already used for a different outbound message' using errcode = '23514';
      end if;

      message_id := selected_message_id;
      outbound_delivery_id := selected_delivery_id;
      enqueue_status := 'DUPLICATE';
      return next;
      return;
    end if;
  end if;

  if p_channel = 'EMAIL'::public.channel_type then
    if normalized_recipient is null
      or normalized_recipient !~* '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$'
      or exists (select 1 where lower(normalized_recipient) like '.%' or lower(normalized_recipient) like '%.@%' or lower(normalized_recipient) like '%..%')
    then
      raise exception 'Email recipient is invalid' using errcode = '23514';
    end if;

    if not exists (
      select 1
      from public.clients cl
      where cl.id = selected_client_id
        and lower(btrim(coalesce(cl.primary_email, ''))) = lower(normalized_recipient)
    ) then
      raise exception 'Recipient does not match the conversation client' using errcode = '42501';
    end if;
  else
    normalized_recipient := public.normalize_sms_phone(normalized_recipient);
    if normalized_recipient is null then
      raise exception 'SMS recipient is invalid' using errcode = '23514';
    end if;

    if not exists (
      select 1
      from public.clients cl
      where cl.id = selected_client_id
        and public.normalize_sms_phone(cl.primary_phone) = normalized_recipient
    ) then
      raise exception 'Recipient does not match the conversation client' using errcode = '42501';
    end if;

    if not exists (
      select 1
      from public.sms_consent sc
      where sc.client_id = selected_client_id
        and public.normalize_sms_phone(sc.phone_number) = normalized_recipient
    ) or exists (
      select 1
      from public.sms_consent sc
      where sc.client_id = selected_client_id
        and public.normalize_sms_phone(sc.phone_number) = normalized_recipient
        and sc.opted_in is not true
    ) then
      raise exception 'No SMS consent on record for this number' using errcode = '42501';
    end if;
  end if;

  insert into public.messages (
    conversation_id,
    type,
    sender_type,
    sender_id,
    content,
    is_internal,
    created_at
  )
  values (
    p_conversation_id,
    p_channel::text::public.message_type,
    'STAFF'::public.sender_type,
    p_actor_id,
    normalized_body,
    false,
    p_requested_at
  )
  returning id into selected_message_id;

  normalized_idempotency_key := coalesce(
    normalized_idempotency_key,
    'staff:' || lower(p_channel::text) || ':' || selected_message_id::text
  );

  insert into public.outbound_deliveries (
    idempotency_key,
    channel,
    recipient,
    payload,
    requested_by,
    client_id,
    conversation_id,
    message_id,
    status,
    status_note,
    scheduled_at,
    next_attempt_at,
    created_at
  )
  values (
    normalized_idempotency_key,
    p_channel,
    normalized_recipient,
    jsonb_strip_nulls(jsonb_build_object(
      'kind', 'staff_message',
      'source', case when p_channel = 'SMS'::public.channel_type then 'send-sms' else 'send-email' end,
      'subject', normalized_subject,
      'body', normalized_body
    )),
    p_actor_id,
    selected_client_id,
    p_conversation_id,
    selected_message_id,
    'QUEUED'::public.outbound_delivery_status,
    'Queued for outbound delivery dispatcher',
    p_requested_at,
    p_requested_at,
    p_requested_at
  )
  returning id into selected_delivery_id;

  update public.conversations c
  set last_message_at = p_requested_at,
    first_message_at = coalesce(c.first_message_at, p_requested_at),
    is_read = true,
    status = 'ACTIVE'::public.conversation_status
  where c.id = p_conversation_id;

  message_id := selected_message_id;
  outbound_delivery_id := selected_delivery_id;
  enqueue_status := selected_status;
  return next;
end
$$;

comment on function public.enqueue_staff_outbound_message(
  uuid,
  uuid,
  public.channel_type,
  text,
  text,
  text,
  timestamptz,
  text
) is
  'Service-role RPC for staff-authored email/SMS sends. It atomically inserts the STAFF message, queues an outbound_deliveries row, updates the conversation, enforces recipient ownership and SMS consent, and supports request idempotency.';

revoke all on function public.enqueue_staff_outbound_message(
  uuid,
  uuid,
  public.channel_type,
  text,
  text,
  text,
  timestamptz,
  text
) from public, anon, authenticated, service_role;

grant execute on function public.enqueue_staff_outbound_message(
  uuid,
  uuid,
  public.channel_type,
  text,
  text,
  text,
  timestamptz,
  text
) to service_role;
