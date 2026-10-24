create or replace function public.retry_outbound_delivery(
  p_delivery_id uuid,
  p_expected_updated_at timestamptz default null,
  p_requested_at timestamptz default now()
)
returns public.outbound_deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  result public.outbound_deliveries;
begin
  if actor_id is null or not public.is_active_staff(actor_id) then
    raise exception 'Active staff access required' using errcode = '42501';
  end if;

  if p_delivery_id is null then
    raise exception 'Delivery id is required' using errcode = '23514';
  end if;

  if p_requested_at is null then
    raise exception 'Retry timestamp is required' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.outbound_deliveries od
    where od.id = p_delivery_id
      and od.status in (
        'FAILED'::public.outbound_delivery_status,
        'UNKNOWN'::public.outbound_delivery_status
      )
      and od.attempt_count >= 25
  ) then
    raise exception 'Outbound delivery has reached the manual retry limit' using errcode = '23514';
  end if;

  update public.outbound_deliveries od
  set status = 'QUEUED'::public.outbound_delivery_status,
    status_note = 'Manually requeued by staff',
    last_error_text = null,
    provider = null,
    provider_message_id = null,
    next_attempt_at = p_requested_at,
    leased_at = null,
    leased_until = null,
    lease_owner = null,
    max_attempts = greatest(od.max_attempts, od.attempt_count + 1),
    accepted_at = null,
    delivered_at = null,
    failed_at = null,
    canceled_at = null,
    unknown_at = null
  where od.id = p_delivery_id
    and od.status in (
      'FAILED'::public.outbound_delivery_status,
      'UNKNOWN'::public.outbound_delivery_status
    )
    and (
      p_expected_updated_at is null
      or od.updated_at = p_expected_updated_at
    )
  returning od.* into result;

  if not found then
    raise exception 'Outbound delivery is not retryable' using errcode = '40001';
  end if;

  if result.appointment_reminder_id is not null then
    update public.appointment_reminders ar
    set status = 'QUEUED'::public.reminder_status,
      error_message = null,
      sent_at = null
    where ar.id = result.appointment_reminder_id;
  end if;

  return result;
end
$$;

comment on function public.retry_outbound_delivery(uuid, timestamptz, timestamptz) is
  'Authenticated active-staff RPC. Requeues failed or unknown outbound deliveries for one more worker attempt without allowing direct table updates.';

revoke all on function public.retry_outbound_delivery(uuid, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.retry_outbound_delivery(uuid, timestamptz, timestamptz)
  to authenticated, service_role;

create or replace function public.cancel_outbound_delivery(
  p_delivery_id uuid,
  p_expected_updated_at timestamptz default null,
  p_requested_at timestamptz default now()
)
returns public.outbound_deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  result public.outbound_deliveries;
begin
  if actor_id is null or not public.is_active_staff(actor_id) then
    raise exception 'Active staff access required' using errcode = '42501';
  end if;

  if p_delivery_id is null then
    raise exception 'Delivery id is required' using errcode = '23514';
  end if;

  if p_requested_at is null then
    raise exception 'Cancel timestamp is required' using errcode = '23514';
  end if;

  update public.outbound_deliveries od
  set status = 'CANCELED'::public.outbound_delivery_status,
    status_note = 'Manually canceled by staff',
    last_error_text = null,
    next_attempt_at = greatest(od.next_attempt_at, p_requested_at),
    leased_at = null,
    leased_until = null,
    lease_owner = null,
    canceled_at = p_requested_at
  where od.id = p_delivery_id
    and od.status in (
      'QUEUED'::public.outbound_delivery_status
    )
    and (
      p_expected_updated_at is null
      or od.updated_at = p_expected_updated_at
    )
  returning od.* into result;

  if not found then
    raise exception 'Outbound delivery is not cancelable' using errcode = '40001';
  end if;

  if result.appointment_reminder_id is not null then
    update public.appointment_reminders ar
    set status = 'SKIPPED'::public.reminder_status,
      error_message = 'Outbound delivery manually canceled by staff'
    where ar.id = result.appointment_reminder_id;
  end if;

  return result;
end
$$;

comment on function public.cancel_outbound_delivery(uuid, timestamptz, timestamptz) is
  'Authenticated active-staff RPC. Cancels queued, failed, or unknown outbound deliveries without allowing cancellation of leased, accepted, or delivered work.';

revoke all on function public.cancel_outbound_delivery(uuid, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_outbound_delivery(uuid, timestamptz, timestamptz)
  to authenticated, service_role;
