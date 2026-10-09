-- Require complete contacts for every new or edited household, without rewriting legacy charts.
create function public.client_contacts_complete(p_phone text,p_email text)
returns boolean language sql immutable set search_path=public as $$
 select coalesce(length(btrim(p_phone)) between 1 and 50
   and length(btrim(p_email)) between 1 and 254
   and btrim(p_phone) ~ '^\+[0-9 ().-]+$'
   and regexp_replace(btrim(p_phone),'[ ().-]','','g') ~ '^\+[1-9][0-9]{7,14}$'
   and lower(btrim(p_email)) ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
   and btrim(p_email) not like '.%' and btrim(p_email) not like '%..%' and btrim(p_email) not like '%.@%',false);
$$;
revoke all on function public.client_contacts_complete(text,text) from public,anon,authenticated,service_role;
grant execute on function public.client_contacts_complete(text,text) to authenticated,service_role;

create function public.guard_client_required_contacts()
returns trigger language plpgsql set search_path=public as $$
begin
 if not public.client_contacts_complete(new.primary_phone,new.primary_email) then
  raise exception 'A valid phone number and email are both required for a client' using errcode='23514';
 end if;
 new.primary_phone := regexp_replace(btrim(new.primary_phone),'[ ().-]','','g');
 new.primary_email := lower(btrim(new.primary_email));
 return new;
end $$;
revoke all on function public.guard_client_required_contacts() from public,anon,authenticated,service_role;
create trigger client_required_contacts before insert or update on public.clients
 for each row execute function public.guard_client_required_contacts();
-- NOT VALID preserves existing incomplete rows; it still checks every new insert/update.
-- Validate only after staff have supplied the actual missing contact details.
alter table public.clients add constraint clients_required_contacts_check
 check(public.client_contacts_complete(primary_phone,primary_email)) not valid;

create function public.guard_patient_complete_client()
returns trigger language plpgsql set search_path=public as $$
declare household public.clients;
begin
 if tg_op='UPDATE' and new.client_id is not distinct from old.client_id then return new;end if;
 -- Serialize this precondition with contact changes/deletion for the same household.
 select * into household from public.clients where id=new.client_id for share;
 if not found or not public.client_contacts_complete(household.primary_phone,household.primary_email) then
  raise exception 'Save an existing client with a valid phone number and email before adding a patient' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function public.guard_patient_complete_client() from public,anon,authenticated,service_role;
create trigger patient_complete_client before insert or update of client_id on public.pets
 for each row execute function public.guard_patient_complete_client();

CREATE OR REPLACE FUNCTION public.save_client(p_actor_id uuid, p_client_id uuid, p_expected_version integer, p_first_name text, p_last_name text, p_primary_phone text, p_primary_email text, p_preferred_channel channel_type, p_mailing_address text, p_housecall_address text)
 RETURNS clients
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result public.clients; actor uuid;
begin
 actor := public.clinical_require_staff();
 if p_actor_id is distinct from actor then raise exception 'Actor does not match signed-in staff' using errcode='42501'; end if;
 if not public.client_contacts_complete(p_primary_phone,p_primary_email) then raise exception 'A valid phone number and email are both required for a client' using errcode='23514'; end if;
 p_primary_phone := public.communication_recipient('SMS',p_primary_phone);
 p_primary_email := public.communication_recipient('EMAIL',p_primary_email);
 if p_first_name is null or length(trim(p_first_name)) not between 1 and 150 or p_last_name is null or length(trim(p_last_name)) not between 1 and 150 or length(p_primary_phone)>50 or length(p_primary_email)>254 or length(p_mailing_address)>1000 or length(p_housecall_address)>1000 then raise exception 'Client fields are missing or too long' using errcode='23514'; end if;
 if nullif(trim(p_primary_email),'') is not null and p_primary_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Client email is invalid' using errcode='23514'; end if;
 if p_client_id is null then
  insert into public.clients(first_name,last_name,full_name,primary_phone,primary_email,preferred_channel,mailing_address,housecall_address) values(trim(p_first_name),trim(p_last_name),trim(p_first_name)||' '||trim(p_last_name),nullif(trim(p_primary_phone),''),nullif(trim(p_primary_email),''),p_preferred_channel,nullif(trim(p_mailing_address),''),nullif(trim(p_housecall_address),'')) returning * into result;
 else
  update public.clients set first_name=trim(p_first_name),last_name=trim(p_last_name),full_name=trim(p_first_name)||' '||trim(p_last_name),primary_phone=nullif(trim(p_primary_phone),''),primary_email=nullif(trim(p_primary_email),''),preferred_channel=p_preferred_channel,mailing_address=nullif(trim(p_mailing_address),''),housecall_address=nullif(trim(p_housecall_address),'') where id=p_client_id and version=p_expected_version returning * into result;
  if not found then raise exception 'Record changed or no longer exists; reload before saving' using errcode='PT409'; end if;
 end if;
 return result;
end $function$;

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
security definer
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
  event public.communication_provider_events;
  inbound public.communication_inbound;
  metadata jsonb;
  token uuid;
  matches integer;
  canonical_resource_id text;
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

  perform public.communication_require_service();
  canonical_resource_id := case when length(normalized_provider_message_id)<=200 then normalized_provider_message_id
    else 'legacy-sms/'||encode(extensions.digest(normalized_provider_message_id,'sha256'),'hex') end;
  metadata := jsonb_build_object('from',normalized_from,'to',normalized_to,
    'body',normalized_body,'opt_out_type',normalized_opt_out_type,'provider_message_id',normalized_provider_message_id);
  perform pg_advisory_xact_lock(hashtextextended('twilio:'||canonical_resource_id,927));

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

  -- A later household creation/assignment must not turn a reviewed webhook retry into a second message.
  select * into inbound from public.communication_inbound
    where provider='twilio' and resource_id=canonical_resource_id;
  if found then
    if (select payload_hash from public.communication_provider_events where id=inbound.event_id)
      is distinct from encode(extensions.digest(metadata::text,'sha256'),'hex') then
      raise exception 'Provider event identifier reused' using errcode='23505';
    end if;
    client_id := inbound.client_id;
    conversation_id := inbound.conversation_id;
    message_id := inbound.message_id;
    consent_action := 'DUPLICATE';
    return next;
    return;
  end if;

  select count(*), (array_agg(c.id))[1]
  into matches, selected_client_id
  from public.clients c
  where public.communication_recipient('SMS',c.primary_phone) = normalized_from;

  if matches <> 1 then
    -- Preserve unknown/shared senders in the canonical review queue. No placeholder household.
    event := public.receive_communication_event('twilio',canonical_resource_id,
      canonical_resource_id,'inbound',
      encode(extensions.digest(metadata::text,'sha256'),'hex'),metadata);
    if event.state = 'processed' then
      select * into inbound from public.communication_inbound
        where event_id = event.id;
      if not found then
        raise exception 'Processed provider event has no inbound record; reconcile before retrying' using errcode='PT409';
      end if;
    else
      if event.state='review' or (event.state='claimed' and event.lease_expires_at>now()) then
        raise exception 'Provider event lease unavailable' using errcode='PT409';
      end if;
      token := gen_random_uuid();
      update public.communication_provider_events
        set state='claimed',lease_token=token,lease_expires_at=now()+interval '2 minutes',attempts=attempts+1
        where id=event.id;
      inbound := public.complete_inbound_communication(event.id,token,
        normalized_from,normalized_to,'',normalized_body,null,null,'{}','[]',p_received_at,
        coalesce(normalized_opt_out_type,public.sms_keyword(normalized_body)));
    end if;
    client_id := inbound.client_id;
    conversation_id := inbound.conversation_id;
    message_id := inbound.message_id;
    consent_action := 'REVIEW_REQUIRED';
    return next;
    return;
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


comment on function public.record_inbound_sms(text,text,text,text,text,timestamptz) is
 'Service-only Twilio ingestion. Known senders retain their message/consent flow; unknown or shared senders enter canonical inbound review without creating a client.';
revoke all on function public.record_inbound_sms(text,text,text,text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.record_inbound_sms(text,text,text,text,text,timestamptz) to service_role;
