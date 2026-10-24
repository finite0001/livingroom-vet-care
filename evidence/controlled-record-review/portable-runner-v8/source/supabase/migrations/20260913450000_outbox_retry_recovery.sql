-- Reviewed retries only before any provider execution. No provider reconciliation.
alter table public.communication_outbox add column revision bigint not null default 1 check(revision>0);
create function public.outbox_retry_revision() returns trigger language plpgsql set search_path=public as $$
begin
 if (to_jsonb(new)-'revision') is distinct from (to_jsonb(old)-'revision') then new.revision:=old.revision+1;else new.revision:=old.revision;end if;return new;
end $$;
create trigger outbox_retry_revision before update on public.communication_outbox for each row execute function public.outbox_retry_revision();
create table public.outbox_retry_actions (
 id uuid primary key,actor_id uuid not null references auth.users(id),outbox_id uuid not null references public.communication_outbox(id),
 expected_work_hash text not null check(expected_work_hash ~ '^[a-f0-9]{64}$'),
 reason text not null check(reason in ('configuration_repaired','recipient_reverified','source_reverified')),
 previous_revision bigint not null check(previous_revision>0),queued_revision bigint not null check(queued_revision=previous_revision+1),created_at timestamptz not null default now()
);
alter table public.outbox_retry_actions enable row level security;
revoke all on public.outbox_retry_actions from public,anon,authenticated,service_role;
create index outbox_retry_actions_actor_cursor on public.outbox_retry_actions(actor_id,created_at desc,id desc);
create trigger outbox_retry_actions_immutable before update or delete on public.outbox_retry_actions for each row execute function public.payment_immutable();
revoke all on function public.retry_communication(uuid,uuid) from public,anon,authenticated,service_role;

-- Private, non-materializing source validation. It deliberately does not call worker mutations.
create function public.outbox_retry_source_internal(p_outbox_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.communication_outbox;links integer;family text:='message';source_uuid uuid;context jsonb:='{}';eligible boolean:=true;
 l record;p record;r record;payload jsonb;frozen jsonb;
begin
 select * into o from public.communication_outbox where id=p_outbox_id;
 select count(*) into links from (
 select outbox_id from public.reminder_outbox_links where outbox_id=o.id union all select outbox_id from public.release_email_outbox_links where outbox_id=o.id
 union all select outbox_id from public.invoice_email_outbox_links where outbox_id=o.id union all select outbox_id from public.document_link_outbox_links where outbox_id=o.id
 union all select outbox_id from public.payment_delivery_outbox_links where outbox_id=o.id) x;
 if links>1 then return jsonb_build_object('family',family,'source_id',null,'eligible',false,'ambiguous',true,'fingerprint',links);end if;
 begin
 if exists(select 1 from public.reminder_outbox_links where outbox_id=o.id) then
  family:='reminder';select * into l from public.reminder_outbox_links where outbox_id=o.id;source_uuid:=l.job_id;
  context:=public.reminder_delivery_context(l.job_kind,l.job_id,l.policy_id);
  eligible:=l.invalidated_at is null and context is not null and context=l.frozen_context;
 elsif exists(select 1 from public.invoice_email_outbox_links where outbox_id=o.id) or exists(select 1 from public.release_email_outbox_links where outbox_id=o.id) then
  family:=case when exists(select 1 from public.invoice_email_outbox_links where outbox_id=o.id) then 'invoice_email' else 'release_email' end;
  execute format('select * from public.%I where outbox_id=$1',family||'_outbox_links') into l using o.id;source_uuid:=l.request_id;
  execute format('select public.%I($1)',family||'_context') into context using source_uuid;
  execute format('select * from public.%I where request_id=$1',family||'_payloads') into p using source_uuid;
  execute format('select * from public.%I where id=$1 for share',family||'_requests') into r using source_uuid;
  eligible:=p.request_id is not null and p.payload_text is not null and p.payload_hash=l.reviewed_payload_hash and p.payload_hash=encode(sha256(convert_to(p.payload_text,'UTF8')),'hex')
   and row(o.created_by,o.client_id,o.conversation_id,o.channel,o.recipient,o.subject,o.body) is not distinct from row(r.actor_id,r.client_id,r.conversation_id,'EMAIL'::text,r.recipient,r.subject,r.body);
  payload:=p.payload_text::jsonb;
  if o.provider_config is not null then eligible:=eligible and o.provider_config=jsonb_build_object('from',payload->>'from','reply_to',payload->>'reply_to');end if;
  context:=jsonb_build_object('current',context,'payload_hash',p.payload_hash,'request',to_jsonb(r));
 elsif exists(select 1 from public.document_link_outbox_links where outbox_id=o.id) then
  family:='document_link';select * into l from public.document_link_outbox_links where outbox_id=o.id;source_uuid:=l.grant_id;
  context:=public.document_link_current(source_uuid);
  select * into r from public.document_link_grants where id=source_uuid for share;select * into p from public.document_link_payloads where grant_id=source_uuid;
  eligible:=r.state='reviewed' and p.grant_id is not null and p.payload_text is not null and p.artifact_hash=l.reviewed_artifact_hash and p.message_hash=l.reviewed_message_hash and p.artifact_hash=encode(sha256(convert_to(p.payload_text,'UTF8')),'hex')
   and exists(select 1 from public.document_link_access_budget where grant_id=source_uuid and used<200)
   and row(o.channel,o.recipient,o.body,o.created_by,o.client_id,o.conversation_id) is not distinct from row('SMS'::text,r.recipient,r.message_template,r.actor_id,r.client_id,r.conversation_id);
  context:=jsonb_build_object('current',context,'grant',to_jsonb(r),'artifact_hash',p.artifact_hash,'message_hash',p.message_hash);
 elsif exists(select 1 from public.payment_delivery_outbox_links where outbox_id=o.id) then
  family:='payment_delivery';select * into l from public.payment_delivery_outbox_links where outbox_id=o.id;source_uuid:=l.request_id;
  context:=public.payment_delivery_current(source_uuid);
  select * into r from public.payment_delivery_requests where id=source_uuid;select * into p from public.payment_delivery_captures where request_id=source_uuid;
  eligible:=p.request_id is not null and row(p.message_hash,p.payload_hash) is not distinct from row(l.reviewed_message_hash,l.reviewed_payload_hash)
   and row(o.channel,o.recipient,o.subject,o.body,o.created_by,o.client_id,o.conversation_id) is not distinct from row(r.channel,r.recipient,r.subject,r.body_template,r.actor_id,r.client_id,r.conversation_id)
   and(o.provider_config is null or o.provider_config=p.sender_config);
  context:=jsonb_build_object('current',context,'capture',to_jsonb(p));
 end if;
 exception when sqlstate '23514' or sqlstate '42501' or invalid_text_representation then eligible:=false;context:='{"source_unavailable":true}';end;
 return jsonb_build_object('family',family,'source_id',source_uuid,'eligible',coalesce(eligible,false),'ambiguous',false,'fingerprint',encode(sha256(convert_to(context::text,'UTF8')),'hex'));
end $$;

create function public.outbox_retry_preview_internal(p_outbox_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.communication_outbox;c public.clients;source jsonb;reason text:='eligible_for_requeue';suppressed boolean;active boolean;matching boolean;evidence boolean;work_hash text;
begin
 select * into o from public.communication_outbox where id=p_outbox_id for update;if not found then return null;end if;
 select * into c from public.clients where id=o.client_id for share;
 perform 1 from public.profiles where id=o.created_by for share;
 active:=public.is_active_staff(o.created_by);
 perform 1 from public.conversations where id=o.conversation_id and client_id=o.client_id for share;
 matching:=found and public.communication_recipient(o.channel,case when o.channel='EMAIL' then c.primary_email else c.primary_phone end)=o.recipient;
 suppressed:=public.communication_is_suppressed(o.channel,o.recipient,o.client_id);
 evidence:=o.provider_message_id is not null or o.attempt_count<>0 or o.first_attempt_at is not null or o.attempt_started_at is not null or o.accepted_at is not null or o.delivered_at is not null or o.delivery_failure_kind is not null
  or exists(select 1 from public.communication_attempts where outbox_id=o.id) or exists(select 1 from public.communication_delivery_events where outbox_id=o.id) or exists(select 1 from public.communication_reconciliations where outbox_id=o.id);
 source:=public.outbox_retry_source_internal(o.id);
 if o.state<>'failed' then reason:='not_failed';elsif evidence or o.lease_token is not null or o.lease_expires_at is not null then reason:='provider_evidence_requires_reconciliation';
 elsif not active then reason:='original_actor_unavailable';elsif matching is distinct from true then reason:='recipient_or_conversation_changed';elsif suppressed then reason:='recipient_suppressed';
 elsif (source->>'ambiguous')::boolean then reason:='source_association_ambiguous';elsif (source->>'eligible')::boolean is distinct from true then reason:='source_ineligible';end if;
 work_hash:=encode(sha256(convert_to(jsonb_build_object('outbox',to_jsonb(o),'active',active,'matching',matching,'suppressed',suppressed,'evidence',evidence,'source',source)::text,'UTF8')),'hex');
 return jsonb_build_object('outbox',jsonb_build_object('id',o.id,'conversation_id',o.conversation_id,'client_id',o.client_id,'message_id',o.message_id,'created_by',o.created_by,'channel',o.channel,'state',o.state,'provider',o.provider,'created_at',o.created_at,'updated_at',o.updated_at,'revision',o.revision,'attempt_count',o.attempt_count,'reason',case when o.last_error is null then null when o.last_error in ('worker_lease_expired','idempotency_window_expired','recipient_suppressed','recipient_or_actor_ineligible') then o.last_error else 'processing_review_required' end),
 'eligible',reason='eligible_for_requeue','reason',reason,'expected_work_hash',work_hash,'source',source-array['fingerprint','ambiguous']);
end $$;
create function public.preview_outbox_retry(p_outbox_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.operations_require_admin();result jsonb;history jsonb;more boolean;
begin
 result:=public.outbox_retry_preview_internal(p_outbox_id);if result is null then return null;end if;
 select coalesce(jsonb_agg(to_jsonb(a) order by created_at desc,id desc),'[]') into history from(select * from public.outbox_retry_actions where actor_id=actor and outbox_id=p_outbox_id order by created_at desc,id desc limit 50) a;
 select count(*)>50 into more from(select 1 from public.outbox_retry_actions where actor_id=actor and outbox_id=p_outbox_id limit 51) a;
 return result||jsonb_build_object('history',history,'history_has_more',more);
end $$;
create function public.recover_outbox_retry(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.operations_require_admin();result jsonb;
begin select to_jsonb(a) into result from public.outbox_retry_actions a where id=p_id and actor_id=actor;return result;end $$;
create function public.list_outbox_retry_actions(p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 50) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.operations_require_admin();items jsonb;more boolean;
begin
 if p_limit is null or p_limit not between 1 and 100 or (p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid retry cursor' using errcode='23514';end if;
 with rows as(select * from public.outbox_retry_actions where actor_id=actor and(p_before_at is null or(created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit p_limit+1),page as(select * from rows order by created_at desc,id desc limit p_limit)
 select coalesce((select jsonb_agg(to_jsonb(p) order by created_at desc,id desc) from page p),'[]'),(select count(*)>p_limit from rows) into items,more;
 return jsonb_build_object('items',items,'has_more',more);
end $$;
create function public.requeue_outbox_retry(p_id uuid,p_outbox_id uuid,p_expected_work_hash text,p_reason text,p_attest boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.operations_require_admin();a public.outbox_retry_actions;preview jsonb;o public.communication_outbox;
begin
 if p_id is null or p_outbox_id is null or p_expected_work_hash is null or p_expected_work_hash !~ '^[a-f0-9]{64}$' or p_reason is null or p_reason not in ('configuration_repaired','recipient_reverified','source_reverified') or p_attest is distinct from true then raise exception 'Exact reviewed retry and attestation required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,945));
 select * into a from public.outbox_retry_actions where id=p_id;
 if found then
  if row(a.actor_id,a.outbox_id,a.expected_work_hash,a.reason) is distinct from row(actor,p_outbox_id,p_expected_work_hash,p_reason) then raise exception 'Retry request ID is already bound' using errcode='23505';end if;
  return to_jsonb(a);
 end if;
 preview:=public.outbox_retry_preview_internal(p_outbox_id);
 if preview is null or preview->>'expected_work_hash' is distinct from p_expected_work_hash then raise exception 'Retry work changed; review again' using errcode='40001';end if;
 if (preview->>'eligible')::boolean is distinct from true then raise exception 'Outbox is not eligible for reviewed retry' using errcode='42501';end if;
 select * into o from public.communication_outbox where id=p_outbox_id;
 insert into public.outbox_retry_actions(id,actor_id,outbox_id,expected_work_hash,reason,previous_revision,queued_revision) values(p_id,actor,p_outbox_id,p_expected_work_hash,p_reason,o.revision,o.revision+1) returning * into a;
 insert into public.communication_retry_audit(outbox_id,requested_by,previous_state) values(o.id,actor,o.state);
 update public.communication_outbox set state='pending',updated_at=now() where id=o.id;
 return to_jsonb(a);
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('outbox_retry_revision','outbox_retry_source_internal','outbox_retry_preview_internal','preview_outbox_retry','recover_outbox_retry','list_outbox_retry_actions','requeue_outbox_retry') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.proname in ('preview_outbox_retry','recover_outbox_retry','list_outbox_retry_actions','requeue_outbox_retry') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
