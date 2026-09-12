-- Immutable staff intent, leased provider attempts and explicit uncertain outcomes.
create table public.communication_suppressions (
 channel text not null check(channel in ('EMAIL','SMS')), recipient text not null,
 reason text not null check(length(trim(reason)) between 1 and 500),
 created_at timestamptz not null default now(), created_by uuid references auth.users(id),
 primary key(channel,recipient)
);
create table public.communication_outbox (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 conversation_id uuid not null references public.conversations(id) on delete restrict,
 client_id uuid not null references public.clients(id) on delete restrict,
 message_id uuid not null unique references public.messages(id) on delete restrict,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 channel text not null check(channel in ('EMAIL','SMS')), recipient text not null,
 subject text not null default '', body text not null,
 attachment_ids uuid[] not null default '{}' check(cardinality(attachment_ids)=0),
 state text not null default 'pending' check(state in ('pending','claimed','accepted','delivered','failed','uncertain')),
 provider text not null check(provider in ('resend','twilio')), provider_message_id text,
 -- Sender metadata is frozen before first external request; credentials are never stored.
 provider_config jsonb, lease_token uuid, lease_expires_at timestamptz,
 attempt_count integer not null default 0, first_attempt_at timestamptz, attempt_started_at timestamptz,
 accepted_at timestamptz, delivered_at timestamptz, updated_at timestamptz not null default now(),
 last_error text, unique(provider,provider_message_id),
 check((channel='EMAIL' and length(subject) between 1 and 500 and length(body) between 1 and 100000) or (channel='SMS' and subject='' and length(body) between 1 and 1600))
);
create index communication_outbox_pending_idx on public.communication_outbox(created_at) where state in ('pending','claimed');
create table public.communication_attempts (
 id uuid primary key default gen_random_uuid(), outbox_id uuid not null references public.communication_outbox(id) on delete restrict,
 lease_token uuid not null unique, attempt_number integer not null,
 started_at timestamptz not null default now(), finished_at timestamptz,
 outcome text check(outcome in ('accepted','failed','uncertain')), provider_message_id text, error_code text,
 unique(outbox_id,attempt_number)
);
create table public.communication_delivery_events (
 provider text not null, event_id text not null, outbox_id uuid not null references public.communication_outbox(id) on delete restrict,
 outcome text not null check(outcome in ('delivered','failed')), received_at timestamptz not null default now(),
 primary key(provider,event_id)
);
create table public.communication_retry_audit (
 id uuid primary key default gen_random_uuid(),outbox_id uuid not null references public.communication_outbox(id),
 requested_by uuid not null references auth.users(id), previous_state text not null, created_at timestamptz not null default now()
);

do $$ declare t text; begin
 foreach t in array array['communication_outbox','communication_attempts','communication_delivery_events','communication_suppressions','communication_retry_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy "Active staff read" on public.%I for select to authenticated using(public.is_active_staff(auth.uid()))',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated,service_role',t);
 end loop;
end $$;

create function public.communication_recipient(p_channel text,p_recipient text) returns text language plpgsql immutable set search_path=public as $$
declare result text;
begin
 if p_channel='EMAIL' then
  result:=lower(trim(p_recipient));
  if length(result)>254 or result !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' or result like '.%' or result like '%..%' or result like '%.@%' then result:=null; end if;
 elsif p_channel='SMS' then
  if trim(p_recipient) !~ '^\+[0-9 ().-]+$' then return null; end if;
  result:=regexp_replace(trim(p_recipient),'[ ().-]','','g');
  if result !~ '^\+[1-9][0-9]{7,14}$' then result:=null; end if;
 end if;
 return result;
end $$;
create function public.communication_require_service() returns void language plpgsql set search_path=public as $$
begin if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service authorization required' using errcode='42501'; end if; end $$;
create function public.communication_is_suppressed(p_channel text,p_recipient text,p_client_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.communication_suppressions where channel=p_channel and recipient=p_recipient)
 or (p_channel='SMS' and (not exists(select 1 from public.sms_consent where client_id=p_client_id and public.communication_recipient('SMS',phone_number)=p_recipient and opted_in)
 or exists(select 1 from public.sms_consent where client_id=p_client_id and public.communication_recipient('SMS',phone_number)=p_recipient and not opted_in)))
$$;

create function public.enqueue_communication(p_actor_id uuid,p_request_id uuid,p_conversation_id uuid,p_channel text,p_recipient text,p_subject text,p_body text,p_attachment_ids uuid[] default '{}') returns public.communication_outbox language plpgsql security definer set search_path=public as $$
declare actor uuid; recipient text; client public.clients; existing public.communication_outbox; msg_id uuid; result public.communication_outbox;
begin
 actor:=public.clinical_require_staff();
 if p_actor_id is distinct from actor then raise exception 'Actor mismatch' using errcode='42501'; end if;
 recipient:=public.communication_recipient(p_channel,p_recipient);
 if p_request_id is null or recipient is null or p_body is null or length(trim(p_body))<1 or (p_channel='EMAIL' and (p_subject is null or length(trim(p_subject)) not between 1 and 500 or length(p_body)>100000)) or (p_channel='SMS' and (coalesce(p_subject,'')<>'' or length(p_body)>1600)) or p_attachment_ids is null or cardinality(p_attachment_ids)<>0 then raise exception 'Invalid outbound request; attachments require the record-release workflow' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,914));
 select * into existing from public.communication_outbox where request_id=p_request_id;
 if found then
  if existing.created_by is distinct from actor or existing.conversation_id is distinct from p_conversation_id or existing.channel is distinct from p_channel or existing.recipient is distinct from recipient or existing.subject is distinct from coalesce(p_subject,'') or existing.body is distinct from p_body then raise exception 'Request identifier already used for different content' using errcode='23505'; end if;
  return existing;
 end if;
 select c.* into client from public.clients c join public.conversations v on v.client_id=c.id where v.id=p_conversation_id;
 if not found or recipient is distinct from public.communication_recipient(p_channel,case when p_channel='EMAIL' then client.primary_email else client.primary_phone end) then raise exception 'Recipient does not match the conversation household' using errcode='42501'; end if;
 if public.communication_is_suppressed(p_channel,recipient,client.id) then raise exception 'Recipient suppressed or SMS consent missing' using errcode='42501'; end if;
 insert into public.messages(conversation_id,content,type,sender_type,sender_id,is_internal) values(p_conversation_id,p_body,p_channel::public.message_type,'STAFF',actor,false) returning id into msg_id;
 insert into public.communication_outbox(request_id,conversation_id,client_id,message_id,created_by,channel,recipient,subject,body,provider)
 values(p_request_id,p_conversation_id,client.id,msg_id,actor,p_channel,recipient,coalesce(p_subject,''),p_body,case when p_channel='EMAIL' then 'resend' else 'twilio' end) returning * into result;
 update public.conversations set last_message_at=now(),is_read=true where id=p_conversation_id;
 return result;
end $$;

create function public.claim_communication() returns public.communication_outbox language plpgsql security definer set search_path=public as $$
declare result public.communication_outbox;
begin
 perform public.communication_require_service();
 -- A dead worker with an in-flight request is ambiguous, including after provider acceptance.
 update public.communication_attempts a set outcome='uncertain',finished_at=now(),error_code='worker_lease_expired'
 from public.communication_outbox o where o.state='claimed' and o.lease_expires_at<now() and o.attempt_started_at is not null and a.lease_token=o.lease_token and a.finished_at is null;
 update public.communication_outbox set state=case when attempt_started_at is null then 'pending' else 'uncertain' end,last_error='worker_lease_expired',lease_token=null,lease_expires_at=null,updated_at=now() where state='claimed' and lease_expires_at<now();
 select * into result from public.communication_outbox where state='pending' order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.communication_outbox set state='claimed',lease_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes',attempt_started_at=null,updated_at=now() where id=result.id returning * into result;
 return result;
end $$;

create function public.start_communication_attempt(p_id uuid,p_lease_token uuid,p_provider_config jsonb) returns public.communication_outbox language plpgsql security definer set search_path=public as $$
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
 if p_provider_config is null or jsonb_typeof(p_provider_config)<>'object' or (result.provider='resend' and (not(p_provider_config ?& array['from','reply_to']) or p_provider_config-array['from','reply_to']<>'{}'::jsonb)) or (result.provider='twilio' and (not(p_provider_config ?& array['from','account_sid']) or p_provider_config-array['from','account_sid']<>'{}'::jsonb)) then raise exception 'Invalid provider metadata' using errcode='23514'; end if;
 if result.provider_config is not null and result.provider_config<>p_provider_config then raise exception 'Provider sender metadata changed; reconcile before sending' using errcode='23514'; end if;
 if result.first_attempt_at is not null and result.provider='resend' and result.first_attempt_at<=now()-interval '23 hours' then
  update public.communication_outbox set state='uncertain',last_error='idempotency_window_expired',lease_token=null,lease_expires_at=null,updated_at=now() where id=p_id returning * into result; return result;
 end if;
 update public.communication_outbox set provider_config=coalesce(provider_config,p_provider_config),first_attempt_at=coalesce(first_attempt_at,now()),attempt_started_at=now(),attempt_count=attempt_count+1,updated_at=now() where id=p_id returning * into result;
 insert into public.communication_attempts(outbox_id,lease_token,attempt_number) values(result.id,p_lease_token,result.attempt_count);
 return result;
end $$;

create function public.finish_communication_attempt(p_id uuid,p_lease_token uuid,p_outcome text,p_provider_message_id text,p_error_code text) returns public.communication_outbox language plpgsql security definer set search_path=public as $$
declare result public.communication_outbox;
begin
 perform public.communication_require_service();
 if p_outcome is null or p_outcome not in ('accepted','failed','uncertain') or (p_outcome='accepted' and (p_provider_message_id is null or length(p_provider_message_id) not between 1 and 200)) or length(p_error_code)>200 then raise exception 'Invalid provider outcome' using errcode='23514'; end if;
 select * into result from public.communication_outbox where id=p_id for update;
 if not found or result.state<>'claimed' or result.lease_token is distinct from p_lease_token or result.attempt_started_at is null then raise exception 'Outbox attempt is unavailable; reconcile provider outcome' using errcode='40001'; end if;
 update public.communication_attempts set outcome=p_outcome,finished_at=now(),provider_message_id=p_provider_message_id,error_code=p_error_code where lease_token=p_lease_token;
 update public.communication_outbox set state=p_outcome,provider_message_id=p_provider_message_id,last_error=p_error_code,accepted_at=case when p_outcome='accepted' then now() else accepted_at end,lease_token=null,lease_expires_at=null,updated_at=now() where id=p_id returning * into result;
 return result;
end $$;

-- A configuration/allowlist rejection before start is safe to release without an attempt.
create function public.release_communication_claim(p_id uuid,p_lease_token uuid,p_error_code text) returns void language plpgsql security definer set search_path=public as $$
begin
 perform public.communication_require_service();
 update public.communication_outbox set state='failed',last_error=left(p_error_code,200),lease_token=null,lease_expires_at=null,updated_at=now() where id=p_id and state='claimed' and lease_token=p_lease_token and attempt_started_at is null;
 if not found then raise exception 'Outbox claim unavailable' using errcode='40001'; end if;
end $$;

create function public.retry_communication(p_actor_id uuid,p_id uuid) returns public.communication_outbox language plpgsql security definer set search_path=public as $$
declare actor uuid; result public.communication_outbox;
begin
 actor:=public.clinical_require_staff(); if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501'; end if;
 select * into result from public.communication_outbox where id=p_id for update;
 if not found or result.state not in ('failed','uncertain') then raise exception 'Only failed or eligible uncertain messages can be retried' using errcode='23514'; end if;
 if result.provider_message_id is not null then raise exception 'Previously accepted messages require delivery reconciliation, not resend' using errcode='23514'; end if;
 if result.state='uncertain' and (result.provider<>'resend' or result.first_attempt_at is null or result.first_attempt_at<=now()-interval '23 hours') then raise exception 'Provider reconciliation required; blind retry is unsafe' using errcode='23514'; end if;
 if public.communication_is_suppressed(result.channel,result.recipient,result.client_id) then raise exception 'Recipient suppressed or SMS consent missing' using errcode='42501'; end if;
 insert into public.communication_retry_audit(outbox_id,requested_by,previous_state) values(result.id,actor,result.state);
 update public.communication_outbox set state='pending',attempt_started_at=null,updated_at=now() where id=p_id returning * into result;
 return result;
end $$;

-- Called only after a verified provider webhook; receipt IDs deduplicate retries.
create function public.record_communication_delivery(p_provider text,p_event_id text,p_provider_message_id text,p_outcome text) returns void language plpgsql security definer set search_path=public as $$
declare target uuid; previous public.communication_delivery_events;
begin
 perform public.communication_require_service();
 if p_outcome is null or p_outcome not in ('delivered','failed') or p_event_id is null or length(p_event_id) not between 1 and 200 then raise exception 'Invalid delivery event' using errcode='23514'; end if;
 select id into target from public.communication_outbox where provider=p_provider and provider_message_id=p_provider_message_id for update;
 if not found then raise exception 'Unknown provider message' using errcode='23503'; end if;
 select * into previous from public.communication_delivery_events where provider=p_provider and event_id=p_event_id;
 if found then
  if previous.outbox_id<>target or previous.outcome<>p_outcome then raise exception 'Delivery event identifier reused' using errcode='23505'; end if;
  return;
 end if;
 insert into public.communication_delivery_events(provider,event_id,outbox_id,outcome) values(p_provider,p_event_id,target,p_outcome);
 update public.communication_outbox set state=case when state='delivered' then 'delivered' else p_outcome end,delivered_at=case when p_outcome='delivered' then coalesce(delivered_at,now()) else delivered_at end,updated_at=now() where id=target;
end $$;

create function public.suppress_communication(p_actor_id uuid,p_channel text,p_recipient text,p_reason text) returns void language plpgsql security definer set search_path=public as $$
declare actor uuid; normalized_recipient text;
begin
 actor:=public.clinical_require_staff(); if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501'; end if;
 normalized_recipient:=public.communication_recipient(p_channel,p_recipient);
 if normalized_recipient is null then raise exception 'Invalid recipient' using errcode='23514'; end if;
 insert into public.communication_suppressions(channel,recipient,reason,created_by) values(p_channel,normalized_recipient,p_reason,actor) on conflict(channel,recipient) do nothing;
 update public.communication_outbox set state='failed',last_error='recipient_suppressed',updated_at=now() where channel=p_channel and recipient=normalized_recipient and state='pending';
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname in ('communication_recipient','communication_require_service','communication_is_suppressed','enqueue_communication','claim_communication','start_communication_attempt','finish_communication_attempt','release_communication_claim','retry_communication','record_communication_delivery','suppress_communication') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('enqueue_communication','retry_communication','suppress_communication') then execute format('grant execute on function %s to authenticated',f.signature);
  elsif f.proname in ('claim_communication','start_communication_attempt','finish_communication_attempt','release_communication_claim','record_communication_delivery') then execute format('grant execute on function %s to service_role',f.signature);
  end if;
 end loop;
end $$;

-- Manual/service reconciliation requires durable evidence; it never makes a provider request.
create table public.communication_reconciliations (
 id uuid primary key default gen_random_uuid(),outbox_id uuid not null references public.communication_outbox(id),
 previous_state text not null,outcome text not null check(outcome in ('accepted','failed')),
 provider_message_id text,evidence_reference text not null check(length(trim(evidence_reference)) between 5 and 500),
 created_at timestamptz not null default now()
);
alter table public.communication_reconciliations enable row level security;
create policy "Active staff read" on public.communication_reconciliations for select to authenticated using(public.is_active_staff(auth.uid()));
revoke all on public.communication_reconciliations from public,anon,authenticated,service_role;
grant select on public.communication_reconciliations to authenticated,service_role;
create function public.reconcile_communication(p_id uuid,p_outcome text,p_provider_message_id text,p_evidence_reference text) returns public.communication_outbox language plpgsql security definer set search_path=public as $$
declare result public.communication_outbox;
begin
 perform public.communication_require_service();
 if p_outcome is null or p_outcome not in ('accepted','failed') or p_evidence_reference is null or length(trim(p_evidence_reference)) not between 5 and 500 or (p_outcome='accepted' and (p_provider_message_id is null or length(p_provider_message_id) not between 1 and 200)) or (p_outcome='failed' and p_provider_message_id is not null) then raise exception 'Provider reconciliation requires a valid outcome and evidence reference' using errcode='23514'; end if;
 select * into result from public.communication_outbox where id=p_id for update;
 if not found or result.state<>'uncertain' then raise exception 'Only uncertain requests can be reconciled' using errcode='23514'; end if;
 insert into public.communication_reconciliations(outbox_id,previous_state,outcome,provider_message_id,evidence_reference) values(p_id,result.state,p_outcome,p_provider_message_id,p_evidence_reference);
 update public.communication_outbox set state=p_outcome,provider_message_id=p_provider_message_id,first_attempt_at=case when p_outcome='failed' then null else first_attempt_at end,accepted_at=case when p_outcome='accepted' then coalesce(accepted_at,now()) else accepted_at end,last_error=case when p_outcome='failed' then 'reconciled_not_accepted' else null end,updated_at=now() where id=p_id returning * into result;
 return result;
end $$;
revoke all on function public.reconcile_communication(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.reconcile_communication(uuid,text,text,text) to service_role;

-- The conversation display must remain consistent with immutable outbound intent.
create function public.guard_outbox_message() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.communication_outbox where message_id=OLD.id) then
  if TG_OP='DELETE' then raise exception 'Queued communication history cannot be deleted' using errcode='23514'; end if;
  if (to_jsonb(NEW)-array['triage_priority','triage_confidence','triage_reason']) is distinct from (to_jsonb(OLD)-array['triage_priority','triage_confidence','triage_reason']) then raise exception 'Queued communication content is immutable' using errcode='23514'; end if;
 end if;
 return case when TG_OP='DELETE' then OLD else NEW end;
end $$;
create trigger guard_outbox_message before update or delete on public.messages for each row execute function public.guard_outbox_message();
revoke all on function public.guard_outbox_message() from public,anon,authenticated,service_role;
