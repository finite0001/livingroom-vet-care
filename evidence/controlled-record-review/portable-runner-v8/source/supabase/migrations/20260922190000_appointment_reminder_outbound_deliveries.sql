alter type public.reminder_status add value if not exists 'QUEUED';

alter table public.appointment_reminders
  add column if not exists outbound_delivery_id uuid references public.outbound_deliveries(id) on delete set null,
  add column if not exists enqueued_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists appointment_reminders_outbound_delivery_unique
  on public.appointment_reminders (outbound_delivery_id)
  where outbound_delivery_id is not null;

drop trigger if exists update_appointment_reminders_updated_at on public.appointment_reminders;
create trigger update_appointment_reminders_updated_at
  before update on public.appointment_reminders
  for each row execute function public.update_updated_at_column();

drop trigger if exists audit_appointment_reminders on public.appointment_reminders;
create trigger audit_appointment_reminders
  after insert or update on public.appointment_reminders
  for each row execute function public.audit_trigger_fn();

create or replace function public.create_appointment_reminders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.appointment_reminders (appointment_id, remind_at, channel)
  values
    (new.id, new.scheduled_at - interval '48 hours', 'SMS'),
    (new.id, new.scheduled_at - interval '24 hours', 'SMS')
  on conflict (appointment_id, remind_at, channel) do nothing;

  return new;
end
$$;

revoke all on function public.create_appointment_reminders() from public, anon, authenticated, service_role;

drop policy if exists "Auth manage reminders" on public.appointment_reminders;
drop policy if exists "Active staff read appointment_reminders" on public.appointment_reminders;

revoke all privileges on public.appointment_reminders from public, anon, authenticated, service_role;
grant select on public.appointment_reminders to authenticated, service_role;
grant insert, update on public.appointment_reminders to service_role;
grant usage on type public.reminder_status to authenticated, service_role;

create policy "Active staff read appointment_reminders"
  on public.appointment_reminders for select to authenticated
  using (public.is_active_staff(auth.uid()));

create or replace function public.enqueue_due_appointment_reminders(
  p_batch_size integer default 25,
  p_enqueued_at timestamptz default now()
)
returns table (
  reminder_id uuid,
  outbound_delivery_id uuid,
  action text,
  reminder_status public.reminder_status,
  status_note text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  due_reminder record;
  normalized_channel text;
  selected_recipient text;
  selected_delivery_id uuid;
  inserted_delivery_id uuid;
  selected_action text;
  selected_status public.reminder_status;
  selected_note text;
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 100 then
    raise exception 'Batch size must be between 1 and 100' using errcode = '23514';
  end if;

  if p_enqueued_at is null then
    raise exception 'Enqueue timestamp is required' using errcode = '23514';
  end if;

  for due_reminder in
    with due_ids as (
      select ar.id
      from public.appointment_reminders ar
      where ar.status = 'PENDING'::public.reminder_status
        and ar.remind_at <= p_enqueued_at
      order by ar.remind_at, ar.created_at, ar.id
      for update of ar skip locked
      limit p_batch_size
    )
    select
      ar.id as reminder_id,
      ar.appointment_id,
      ar.remind_at,
      ar.channel,
      a.client_id,
      a.pet_id,
      a.scheduled_at,
      a.appointment_type,
      a.status as appointment_status,
      a.assigned_dvm_id,
      c.full_name as client_name,
      c.primary_phone,
      c.primary_email,
      c.preferred_channel,
      p.name as pet_name,
      p.archived_at as pet_archived_at,
      p.deceased_at as pet_deceased_at
    from due_ids due
    join public.appointment_reminders ar on ar.id = due.id
    join public.appointments a on a.id = ar.appointment_id
    join public.clients c on c.id = a.client_id
    left join public.pets p on p.id = a.pet_id
  loop
    normalized_channel := upper(btrim(coalesce(due_reminder.channel, '')));
    selected_delivery_id := null;
    inserted_delivery_id := null;
    selected_action := null;
    selected_status := null;
    selected_note := null;

    if normalized_channel not in ('SMS', 'EMAIL') then
      selected_action := 'FAILED';
      selected_status := 'FAILED'::public.reminder_status;
      selected_note := 'Appointment reminder channel is not queueable';
    elsif due_reminder.appointment_status not in ('SCHEDULED'::public.appointment_status, 'CONFIRMED'::public.appointment_status) then
      selected_action := 'SKIPPED';
      selected_status := 'SKIPPED'::public.reminder_status;
      selected_note := 'Appointment status is no longer reminder-eligible';
    elsif due_reminder.scheduled_at <= p_enqueued_at then
      selected_action := 'SKIPPED';
      selected_status := 'SKIPPED'::public.reminder_status;
      selected_note := 'Appointment is not in the future';
    elsif due_reminder.pet_archived_at is not null then
      selected_action := 'SKIPPED';
      selected_status := 'SKIPPED'::public.reminder_status;
      selected_note := 'Patient is archived';
    elsif due_reminder.pet_deceased_at is not null then
      selected_action := 'SKIPPED';
      selected_status := 'SKIPPED'::public.reminder_status;
      selected_note := 'Patient is deceased';
    elsif normalized_channel = 'SMS' then
      selected_recipient := nullif(btrim(coalesce(due_reminder.primary_phone, '')), '');

      if selected_recipient is null then
        selected_action := 'SKIPPED';
        selected_status := 'SKIPPED'::public.reminder_status;
        selected_note := 'Client has no primary phone for SMS reminder';
      elsif not exists (
        select 1
        from public.sms_consent sc
        where sc.client_id = due_reminder.client_id
          and sc.phone_number = selected_recipient
          and sc.opted_in = true
          and sc.opted_out_at is null
      ) then
        selected_action := 'SKIPPED';
        selected_status := 'SKIPPED'::public.reminder_status;
        selected_note := 'SMS consent is unavailable for the primary phone';
      end if;
    elsif normalized_channel = 'EMAIL' then
      selected_recipient := nullif(btrim(coalesce(due_reminder.primary_email, '')), '');

      if selected_recipient is null then
        selected_action := 'SKIPPED';
        selected_status := 'SKIPPED'::public.reminder_status;
        selected_note := 'Client has no primary email for email reminder';
      end if;
    end if;

    if selected_status is null then
      with inserted_delivery as (
        insert into public.outbound_deliveries (
          idempotency_key,
          channel,
          recipient,
          payload,
          client_id,
          appointment_reminder_id,
          scheduled_at,
          next_attempt_at,
          status_note
        )
        values (
          'appointment-reminder:' || due_reminder.reminder_id::text,
          normalized_channel::public.channel_type,
          selected_recipient,
          jsonb_strip_nulls(jsonb_build_object(
            'kind', 'appointment_reminder',
            'template_key', 'appointment_reminder',
            'reminder_id', due_reminder.reminder_id,
            'appointment_id', due_reminder.appointment_id,
            'client_id', due_reminder.client_id,
            'pet_id', due_reminder.pet_id,
            'client_name', due_reminder.client_name,
            'pet_name', due_reminder.pet_name,
            'appointment_type', due_reminder.appointment_type,
            'appointment_scheduled_at', due_reminder.scheduled_at,
            'remind_at', due_reminder.remind_at,
            'assigned_dvm_id', due_reminder.assigned_dvm_id,
            'source', 'enqueue_due_appointment_reminders'
          )),
          due_reminder.client_id,
          due_reminder.reminder_id,
          p_enqueued_at,
          p_enqueued_at,
          'Queued from due appointment reminder'
        )
        on conflict (channel, idempotency_key) do nothing
        returning id
      )
      select id into inserted_delivery_id from inserted_delivery;

      if inserted_delivery_id is null then
        select od.id
        into selected_delivery_id
        from public.outbound_deliveries od
        where od.channel = normalized_channel::public.channel_type
          and od.idempotency_key = 'appointment-reminder:' || due_reminder.reminder_id::text;

        selected_action := 'ALREADY_QUEUED';
      else
        selected_delivery_id := inserted_delivery_id;
        selected_action := 'ENQUEUED';
      end if;

      selected_status := 'QUEUED'::public.reminder_status;
      selected_note := 'Queued durable outbound delivery';
    end if;

    update public.appointment_reminders ar
    set status = selected_status,
      outbound_delivery_id = selected_delivery_id,
      enqueued_at = case when selected_status::text = 'QUEUED' then p_enqueued_at else ar.enqueued_at end,
      sent_at = null,
      error_message = case when selected_status::text = 'QUEUED' then null else selected_note end
    where ar.id = due_reminder.reminder_id;

    reminder_id := due_reminder.reminder_id;
    outbound_delivery_id := selected_delivery_id;
    action := selected_action;
    reminder_status := selected_status;
    status_note := selected_note;
    return next;
  end loop;
end
$$;

comment on function public.enqueue_due_appointment_reminders(integer, timestamptz) is
  'Service-role worker RPC. Enqueues only; it does not send provider messages. SMS consent uses exact sms_consent.phone_number because normalized phone matching is not modeled. Email consent and reschedule invalidation are not modeled, so this function only checks email availability plus current appointment/patient state.';

revoke all on function public.enqueue_due_appointment_reminders(integer, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.enqueue_due_appointment_reminders(integer, timestamptz)
  to service_role;

revoke all on function public.process_due_reminders() from public, anon, authenticated, service_role;
grant execute on function public.process_due_reminders() to service_role;
