create unique index if not exists outbound_deliveries_provider_message_unique
  on public.outbound_deliveries (provider, provider_message_id)
  where provider is not null and provider_message_id is not null;

create or replace function public.record_outbound_delivery_callback(
  p_provider text,
  p_provider_message_id text,
  p_status public.outbound_delivery_status,
  p_status_note text default null,
  p_error_text text default null,
  p_recorded_at timestamptz default now()
)
returns public.outbound_deliveries
language plpgsql
set search_path = public
as $$
declare
  normalized_provider text := nullif(btrim(coalesce(p_provider, '')), '');
  normalized_provider_message_id text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
  normalized_note text := nullif(btrim(coalesce(p_status_note, '')), '');
  normalized_error text := nullif(btrim(coalesce(p_error_text, '')), '');
  result public.outbound_deliveries;
begin
  if normalized_provider is null or length(normalized_provider) > 128 then
    raise exception 'Provider is required' using errcode = '23514';
  end if;

  if normalized_provider_message_id is null or length(normalized_provider_message_id) > 256 then
    raise exception 'Provider message id is required' using errcode = '23514';
  end if;

  if p_recorded_at is null then
    raise exception 'Callback timestamp is required' using errcode = '23514';
  end if;

  if p_status not in (
    'DELIVERED'::public.outbound_delivery_status,
    'FAILED'::public.outbound_delivery_status,
    'UNKNOWN'::public.outbound_delivery_status
  ) then
    raise exception 'Unsupported outbound delivery callback status' using errcode = '23514';
  end if;

  update public.outbound_deliveries od
  set status = p_status,
    status_note = normalized_note,
    last_error_text = normalized_error,
    delivered_at = case
      when p_status = 'DELIVERED'::public.outbound_delivery_status then coalesce(od.delivered_at, p_recorded_at)
      else od.delivered_at
    end,
    failed_at = case
      when p_status = 'FAILED'::public.outbound_delivery_status then coalesce(od.failed_at, p_recorded_at)
      else od.failed_at
    end,
    unknown_at = case
      when p_status = 'UNKNOWN'::public.outbound_delivery_status then coalesce(od.unknown_at, p_recorded_at)
      else od.unknown_at
    end
  where od.provider = normalized_provider
    and od.provider_message_id = normalized_provider_message_id
    and (
      od.status in ('ACCEPTED'::public.outbound_delivery_status, 'UNKNOWN'::public.outbound_delivery_status)
      or od.status = p_status
    )
  returning od.* into result;

  if not found then
    raise exception 'Outbound delivery is not callback-eligible' using errcode = '40001';
  end if;

  if result.appointment_reminder_id is not null then
    update public.appointment_reminders ar
    set status = case
        when p_status = 'DELIVERED'::public.outbound_delivery_status then 'SENT'::public.reminder_status
        when p_status in ('FAILED'::public.outbound_delivery_status, 'UNKNOWN'::public.outbound_delivery_status) then 'FAILED'::public.reminder_status
        else ar.status
      end,
      sent_at = case
        when p_status = 'DELIVERED'::public.outbound_delivery_status then coalesce(ar.sent_at, p_recorded_at)
        else ar.sent_at
      end,
      error_message = case
        when p_status in ('FAILED'::public.outbound_delivery_status, 'UNKNOWN'::public.outbound_delivery_status) then coalesce(normalized_error, normalized_note, 'Outbound delivery callback did not confirm delivery')
        when p_status = 'DELIVERED'::public.outbound_delivery_status then null
        else ar.error_message
      end
    where ar.id = result.appointment_reminder_id;
  end if;

  return result;
end
$$;

comment on function public.record_outbound_delivery_callback(
  text,
  text,
  public.outbound_delivery_status,
  text,
  text,
  timestamptz
) is
  'Service-role callback RPC. Records authenticated provider delivery callbacks by provider message id after worker acceptance; duplicate same-status callbacks are idempotent, but callbacks cannot overwrite canceled or conflicting terminal delivery states.';

revoke all on function public.record_outbound_delivery_callback(
  text,
  text,
  public.outbound_delivery_status,
  text,
  text,
  timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.record_outbound_delivery_callback(
  text,
  text,
  public.outbound_delivery_status,
  text,
  text,
  timestamptz
) to service_role;
