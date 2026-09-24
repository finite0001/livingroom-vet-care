create or replace function public.record_outbound_delivery_result(
  p_delivery_id uuid,
  p_lease_owner text,
  p_status public.outbound_delivery_status,
  p_provider text default null,
  p_provider_message_id text default null,
  p_status_note text default null,
  p_error_text text default null,
  p_next_attempt_at timestamptz default null,
  p_recorded_at timestamptz default now()
)
returns public.outbound_deliveries
language plpgsql
set search_path = public
as $$
declare
  normalized_lease_owner text := nullif(btrim(p_lease_owner), '');
  normalized_provider text := nullif(btrim(coalesce(p_provider, '')), '');
  normalized_provider_message_id text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
  normalized_note text := nullif(btrim(coalesce(p_status_note, '')), '');
  normalized_error text := nullif(btrim(coalesce(p_error_text, '')), '');
  result public.outbound_deliveries;
begin
  if p_delivery_id is null then
    raise exception 'Delivery id is required' using errcode = '23514';
  end if;

  if normalized_lease_owner is null or length(normalized_lease_owner) > 128 then
    raise exception 'Lease owner is required' using errcode = '23514';
  end if;

  if p_recorded_at is null then
    raise exception 'Result timestamp is required' using errcode = '23514';
  end if;

  if p_status not in (
    'QUEUED'::public.outbound_delivery_status,
    'ACCEPTED'::public.outbound_delivery_status,
    'DELIVERED'::public.outbound_delivery_status,
    'FAILED'::public.outbound_delivery_status,
    'UNKNOWN'::public.outbound_delivery_status
  ) then
    raise exception 'Unsupported outbound delivery result status' using errcode = '23514';
  end if;

  if p_status = 'QUEUED'::public.outbound_delivery_status then
    if p_next_attempt_at is null or p_next_attempt_at <= p_recorded_at then
      raise exception 'Retry results require a future next attempt timestamp' using errcode = '23514';
    end if;
  elsif p_next_attempt_at is not null then
    raise exception 'Terminal delivery results cannot set a retry timestamp' using errcode = '23514';
  end if;

  update public.outbound_deliveries od
  set status = p_status,
    provider = coalesce(normalized_provider, od.provider),
    provider_message_id = coalesce(normalized_provider_message_id, od.provider_message_id),
    status_note = normalized_note,
    last_error_text = normalized_error,
    next_attempt_at = case
      when p_status = 'QUEUED'::public.outbound_delivery_status then p_next_attempt_at
      else od.next_attempt_at
    end,
    leased_at = null,
    leased_until = null,
    lease_owner = null,
    accepted_at = case when p_status = 'ACCEPTED'::public.outbound_delivery_status then p_recorded_at else od.accepted_at end,
    delivered_at = case when p_status = 'DELIVERED'::public.outbound_delivery_status then p_recorded_at else od.delivered_at end,
    failed_at = case when p_status = 'FAILED'::public.outbound_delivery_status then p_recorded_at else od.failed_at end,
    unknown_at = case when p_status = 'UNKNOWN'::public.outbound_delivery_status then p_recorded_at else od.unknown_at end
  where od.id = p_delivery_id
    and od.status = 'LEASED'::public.outbound_delivery_status
    and od.lease_owner = normalized_lease_owner
    and od.leased_until > p_recorded_at
    and (
      p_status <> 'QUEUED'::public.outbound_delivery_status
      or od.attempt_count < od.max_attempts
    )
  returning od.* into result;

  if not found then
    raise exception 'Outbound delivery is not actively leased to this worker' using errcode = '40001';
  end if;

  if result.appointment_reminder_id is not null then
    update public.appointment_reminders ar
    set status = case
        when p_status in ('ACCEPTED'::public.outbound_delivery_status, 'DELIVERED'::public.outbound_delivery_status) then 'SENT'::public.reminder_status
        when p_status in ('FAILED'::public.outbound_delivery_status, 'UNKNOWN'::public.outbound_delivery_status) then 'FAILED'::public.reminder_status
        else ar.status
      end,
      sent_at = case
        when p_status in ('ACCEPTED'::public.outbound_delivery_status, 'DELIVERED'::public.outbound_delivery_status) then p_recorded_at
        else ar.sent_at
      end,
      error_message = case
        when p_status in ('FAILED'::public.outbound_delivery_status, 'UNKNOWN'::public.outbound_delivery_status) then coalesce(normalized_error, normalized_note, 'Outbound delivery did not complete')
        when p_status in ('ACCEPTED'::public.outbound_delivery_status, 'DELIVERED'::public.outbound_delivery_status) then null
        else ar.error_message
      end
    where ar.id = result.appointment_reminder_id;
  end if;

  return result;
end
$$;

revoke all on function public.record_outbound_delivery_result(
  uuid,
  text,
  public.outbound_delivery_status,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.record_outbound_delivery_result(
  uuid,
  text,
  public.outbound_delivery_status,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz
) to service_role;
