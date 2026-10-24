create type public.outbound_delivery_status as enum (
  'QUEUED',
  'LEASED',
  'ACCEPTED',
  'DELIVERED',
  'FAILED',
  'CANCELED',
  'UNKNOWN'
);

create table public.outbound_deliveries (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  channel public.channel_type not null,
  recipient text not null,
  payload jsonb not null default '{}'::jsonb,
  requested_by uuid references auth.users(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  appointment_reminder_id uuid references public.appointment_reminders(id) on delete set null,
  provider text,
  provider_message_id text,
  status public.outbound_delivery_status not null default 'QUEUED',
  status_note text,
  last_error_text text,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  scheduled_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  leased_at timestamptz,
  leased_until timestamptz,
  lease_owner text,
  accepted_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  canceled_at timestamptz,
  unknown_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_deliveries_idempotency_key_present check (
    length(btrim(idempotency_key)) between 1 and 256
  ),
  constraint outbound_deliveries_channel_supported check (
    channel = any (array['SMS'::public.channel_type, 'EMAIL'::public.channel_type])
  ),
  constraint outbound_deliveries_recipient_present check (
    length(btrim(recipient)) between 1 and 512
  ),
  constraint outbound_deliveries_payload_object check (
    jsonb_typeof(payload) = 'object'
  ),
  constraint outbound_deliveries_attempt_count_valid check (
    attempt_count >= 0 and max_attempts between 1 and 25 and attempt_count <= max_attempts
  ),
  constraint outbound_deliveries_lease_valid check (
    (leased_at is null and leased_until is null and lease_owner is null)
    or (leased_at is not null and leased_until is not null and lease_owner is not null)
  ),
  constraint outbound_deliveries_leased_status_has_lease check (
    status <> 'LEASED' or (leased_at is not null and leased_until is not null and lease_owner is not null)
  ),
  constraint outbound_deliveries_terminal_timestamps check (
    (status <> 'ACCEPTED' or accepted_at is not null)
    and (status <> 'DELIVERED' or delivered_at is not null)
    and (status <> 'FAILED' or failed_at is not null)
    and (status <> 'CANCELED' or canceled_at is not null)
    and (status <> 'UNKNOWN' or unknown_at is not null)
  ),
  constraint outbound_deliveries_idempotency_unique unique (channel, idempotency_key)
);

create index outbound_deliveries_dispatch_idx
  on public.outbound_deliveries (next_attempt_at, scheduled_at, created_at)
  where status in ('QUEUED'::public.outbound_delivery_status, 'LEASED'::public.outbound_delivery_status);

create index outbound_deliveries_conversation_idx
  on public.outbound_deliveries (conversation_id, created_at desc);

create index outbound_deliveries_message_idx
  on public.outbound_deliveries (message_id)
  where message_id is not null;

create index outbound_deliveries_appointment_reminder_idx
  on public.outbound_deliveries (appointment_reminder_id)
  where appointment_reminder_id is not null;

alter table public.outbound_deliveries enable row level security;

revoke all privileges on public.outbound_deliveries from public, anon, authenticated, service_role;
grant usage on type public.outbound_delivery_status to authenticated, service_role;
grant select on public.outbound_deliveries to authenticated;
grant select, insert, update on public.outbound_deliveries to service_role;

create policy "Active staff read outbound_deliveries"
  on public.outbound_deliveries for select to authenticated
  using (public.is_active_staff(auth.uid()));

create function public.claim_due_outbound_deliveries(
  p_lease_owner text,
  p_batch_size integer default 25,
  p_lease_duration interval default interval '5 minutes',
  p_claimed_at timestamptz default now()
)
returns setof public.outbound_deliveries
language plpgsql
set search_path = public
as $$
declare
  normalized_lease_owner text := nullif(btrim(p_lease_owner), '');
begin
  if normalized_lease_owner is null or length(normalized_lease_owner) > 128 then
    raise exception 'Lease owner is required' using errcode = '23514';
  end if;

  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 100 then
    raise exception 'Batch size must be between 1 and 100' using errcode = '23514';
  end if;

  if p_lease_duration is null
    or p_lease_duration < interval '5 seconds'
    or p_lease_duration > interval '1 hour'
  then
    raise exception 'Lease duration must be between 5 seconds and 1 hour' using errcode = '23514';
  end if;

  if p_claimed_at is null then
    raise exception 'Claim timestamp is required' using errcode = '23514';
  end if;

  return query
  with due_deliveries as (
    select od.id
    from public.outbound_deliveries od
    where od.scheduled_at <= p_claimed_at
      and od.next_attempt_at <= p_claimed_at
      and od.attempt_count < od.max_attempts
      and (
        od.status = 'QUEUED'::public.outbound_delivery_status
        or (
          od.status = 'LEASED'::public.outbound_delivery_status
          and od.leased_until <= p_claimed_at
        )
      )
    order by od.next_attempt_at, od.scheduled_at, od.created_at, od.id
    for update skip locked
    limit p_batch_size
  ),
  claimed_deliveries as (
    update public.outbound_deliveries od
    set status = 'LEASED'::public.outbound_delivery_status,
      leased_at = p_claimed_at,
      leased_until = p_claimed_at + p_lease_duration,
      lease_owner = normalized_lease_owner,
      attempt_count = od.attempt_count + 1,
      status_note = 'Claimed by outbound delivery worker'
    from due_deliveries dd
    where od.id = dd.id
    returning od.*
  )
  select *
  from claimed_deliveries
  order by next_attempt_at, scheduled_at, created_at, id;
end
$$;

revoke all on function public.claim_due_outbound_deliveries(text, integer, interval, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_due_outbound_deliveries(text, integer, interval, timestamptz)
  to service_role;

create trigger update_outbound_deliveries_updated_at
  before update on public.outbound_deliveries
  for each row execute function public.update_updated_at_column();

create trigger audit_outbound_deliveries
  after insert or update on public.outbound_deliveries
  for each row execute function public.audit_trigger_fn();
