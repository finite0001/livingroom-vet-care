-- Owner decision 2026-09-27: all outbound SMS is sent through CloudTalk. Twilio
-- stays supported but is no longer selected. The provider is fixed on each
-- outbox row when it is queued, from one database setting, and the dispatcher's
-- SMS_PROVIDER must agree or the row fails closed without a provider request.

alter table public.communication_outbox drop constraint communication_outbox_provider_check;
alter table public.communication_outbox add constraint communication_outbox_provider_check
 check(provider in ('resend','twilio','cloudtalk') and (channel='SMS' or provider='resend') and (channel='EMAIL' or provider<>'resend'));

-- Single-row setting. Changing it is an owner decision made with SQL; no API role can write it.
create table public.communication_sms_provider_setting (
 singleton boolean primary key default true check(singleton),
 provider text not null check(provider in ('cloudtalk','twilio')),
 updated_at timestamptz not null default now()
);
insert into public.communication_sms_provider_setting(provider) values('cloudtalk');
alter table public.communication_sms_provider_setting enable row level security;
revoke all on public.communication_sms_provider_setting from public,anon,authenticated,service_role;
create policy "Active staff read" on public.communication_sms_provider_setting for select to authenticated using(public.is_active_staff(auth.uid()));
grant select on public.communication_sms_provider_setting to authenticated,service_role;

create function public.communication_sms_provider() returns text language plpgsql stable security definer set search_path=public as $$
declare result text;
begin
 select provider into result from public.communication_sms_provider_setting where singleton;
 if result is null then raise exception 'SMS provider is not configured' using errcode='55000'; end if;
 return result;
end $$;
revoke all on function public.communication_sms_provider() from public,anon,authenticated,service_role;

-- Every enqueue path (conversation, reminder, document link, payment link) inserts
-- SMS rows as 'twilio'. Assigning the provider here covers all of them, including
-- functions redefined later, without copying their bodies.
create function public.assign_communication_sms_provider() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.channel='SMS' then new.provider:=public.communication_sms_provider(); end if;
 return new;
end $$;
revoke all on function public.assign_communication_sms_provider() from public,anon,authenticated,service_role;
create trigger assign_sms_provider before insert on public.communication_outbox
 for each row execute function public.assign_communication_sms_provider();

-- Unattempted rows queued for Twilio move to the selected provider. Anything with
-- an attempt or frozen sender stays as it is and is reconciled by staff.
update public.communication_outbox set provider=public.communication_sms_provider(),updated_at=now()
where channel='SMS' and provider<>public.communication_sms_provider() and state='pending'
 and attempt_count=0 and first_attempt_at is null and provider_config is null and provider_message_id is null;

-- Final pre-request check. Unchanged from 20260913020000_communications_outbox.sql
-- except that a CloudTalk row must carry exactly {from, provider:'cloudtalk'},
-- with an E.164 practice sender, and must match the current SMS provider setting.
create or replace function public.start_communication_attempt_without_reminder_guard(p_id uuid,p_lease_token uuid,p_provider_config jsonb) returns public.communication_outbox language plpgsql security definer set search_path=public as $$
declare result public.communication_outbox;
begin
 perform public.communication_require_service();
 select * into result from public.communication_outbox where id=p_id for update;
 if not found or result.state<>'claimed' or result.lease_token is distinct from p_lease_token or result.lease_expires_at<=now() or result.attempt_started_at is not null then raise exception 'Outbox lease is unavailable' using errcode='40001'; end if;
 -- Re-check immediately before the external request, including actor revocation and contact changes.
 if not public.is_active_staff(result.created_by) or public.communication_is_suppressed(result.channel,result.recipient,result.client_id)
 or not exists(select 1 from public.clients c where c.id=result.client_id and public.communication_recipient(result.channel,case when result.channel='EMAIL' then c.primary_email else c.primary_phone end)=result.recipient) then
  update public.communication_outbox set state='failed',last_error='recipient_or_actor_ineligible',lease_token=null,lease_expires_at=null,updated_at=now() where id=p_id returning * into result;
  return result;
 end if;
 if result.channel='SMS' and result.provider is distinct from public.communication_sms_provider() then
  update public.communication_outbox set state='failed',last_error='sms_provider_mismatch',lease_token=null,lease_expires_at=null,updated_at=now() where id=p_id returning * into result;
  return result;
 end if;
 if p_provider_config is null or jsonb_typeof(p_provider_config)<>'object' or (result.provider='resend' and (not(p_provider_config ?& array['from','reply_to']) or p_provider_config-array['from','reply_to']<>'{}'::jsonb)) or (result.provider='twilio' and (not(p_provider_config ?& array['from','account_sid']) or p_provider_config-array['from','account_sid']<>'{}'::jsonb))
 or (result.provider='cloudtalk' and (not(p_provider_config ?& array['from','provider']) or p_provider_config-array['from','provider']<>'{}'::jsonb or p_provider_config->>'provider'<>'cloudtalk' or jsonb_typeof(p_provider_config->'from')<>'string' or public.communication_recipient('SMS',p_provider_config->>'from') is distinct from p_provider_config->>'from')) then raise exception 'Invalid provider metadata' using errcode='23514'; end if;
 if result.provider_config is not null and result.provider_config<>p_provider_config then raise exception 'Provider sender metadata changed; reconcile before sending' using errcode='23514'; end if;
 if result.first_attempt_at is not null and result.provider='resend' and result.first_attempt_at<=now()-interval '23 hours' then
  update public.communication_outbox set state='uncertain',last_error='idempotency_window_expired',lease_token=null,lease_expires_at=null,updated_at=now() where id=p_id returning * into result; return result;
 end if;
 update public.communication_outbox set provider_config=coalesce(provider_config,p_provider_config),first_attempt_at=coalesce(first_attempt_at,now()),attempt_started_at=now(),attempt_count=attempt_count+1,updated_at=now() where id=p_id returning * into result;
 insert into public.communication_attempts(outbox_id,lease_token,attempt_number) values(result.id,p_lease_token,result.attempt_count);
 return result;
end $$;
revoke all on function public.start_communication_attempt_without_reminder_guard(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

-- Unchanged from 20260913370000_payment_link_delivery.sql except the SMS sender
-- shape: CloudTalk {from, provider:'cloudtalk'} or Twilio {from, account_sid},
-- whichever the SMS provider setting selects.
create or replace function public.capture_payment_delivery(p_request_id uuid,p_actor_id uuid,p_sender_config jsonb,p_message_hash text,p_payload_hash text) returns void language plpgsql security definer set search_path=public as $$
declare r public.payment_delivery_requests;p public.payment_delivery_captures;context jsonb;
begin perform public.communication_require_service();
 select * into r from public.payment_delivery_requests where id=p_request_id and actor_id=p_actor_id for update;
 if not found then raise exception 'Payment delivery ownership mismatch' using errcode='42501';end if;
 select * into p from public.payment_delivery_captures where request_id=r.id;
 if found then if row(p.sender_config,p.message_hash,p.payload_hash) is distinct from row(p_sender_config,p_message_hash,p_payload_hash) then raise exception 'Captured payment delivery is immutable' using errcode='23505';end if;return;end if;
 context:=public.payment_delivery_current(r.id);
 if p_sender_config is null or jsonb_typeof(p_sender_config)<>'object' or octet_length(p_sender_config::text)>2048 or exists(select 1 from jsonb_each(p_sender_config) e where jsonb_typeof(e.value)<>'string') or (r.channel='EMAIL' and (not p_sender_config ?& array['from','reply_to'] or p_sender_config-array['from','reply_to']<>'{}' or public.communication_recipient('EMAIL',p_sender_config->>'reply_to') is null or public.communication_recipient('EMAIL',coalesce(substring(p_sender_config->>'from' from '<([^<>]+)>$'),p_sender_config->>'from')) is null))
 or (r.channel='SMS' and public.communication_sms_provider()='twilio' and (not p_sender_config ?& array['from','account_sid'] or p_sender_config-array['from','account_sid']<>'{}' or public.communication_recipient('SMS',p_sender_config->>'from') is null or coalesce(p_sender_config->>'account_sid','') !~ '^AC[A-Za-z0-9]{32}$'))
 or (r.channel='SMS' and public.communication_sms_provider()='cloudtalk' and (not p_sender_config ?& array['from','provider'] or p_sender_config-array['from','provider']<>'{}' or p_sender_config->>'provider'<>'cloudtalk' or public.communication_recipient('SMS',p_sender_config->>'from') is distinct from p_sender_config->>'from')) then raise exception 'Invalid frozen payment sender configuration' using errcode='23514';end if;
 if r.invoice_email_request_id is not null and row(context#>>'{invoice_payload,from}',context#>>'{invoice_payload,reply_to}') is distinct from row(p_sender_config->>'from',p_sender_config->>'reply_to') then raise exception 'Invoice attachment sender differs from payment message' using errcode='23514';end if;
 insert into public.payment_delivery_captures(request_id,sender_config,message_hash,payload_hash) values(r.id,p_sender_config,p_message_hash,p_payload_hash);
end $$;
revoke all on function public.capture_payment_delivery(uuid,uuid,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.capture_payment_delivery(uuid,uuid,jsonb,text,text) to service_role;

-- The outbound_deliveries worker checked consent only at enqueue. This final
-- check applies the same suppression and consent rules as the outbox (CloudTalk
-- and Twilio STOP, staff suppression, missing or withdrawn consent) to a row the
-- calling worker currently leases.
create function public.outbound_delivery_sms_permitted(p_delivery_id uuid,p_lease_owner text) returns boolean language plpgsql stable security definer set search_path=public as $$
declare d public.outbound_deliveries;recipient text;
begin
 perform public.communication_require_service();
 select * into d from public.outbound_deliveries where id=p_delivery_id;
 if not found or d.status<>'LEASED'::public.outbound_delivery_status or d.lease_owner is distinct from nullif(btrim(p_lease_owner),'') or d.leased_until<=now() then
  raise exception 'Outbound delivery is not actively leased to this worker' using errcode='40001';
 end if;
 if d.channel<>'SMS'::public.channel_type or d.client_id is null then return false; end if;
 recipient:=public.communication_recipient('SMS',d.recipient);
 return recipient is not null and not public.communication_is_suppressed('SMS',recipient,d.client_id);
end $$;
revoke all on function public.outbound_delivery_sms_permitted(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.outbound_delivery_sms_permitted(uuid,text) to service_role;
