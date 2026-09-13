-- Capabilities are materialized in worker memory, never stored in message history.
create table public.document_link_outbox_links (
 outbox_id uuid primary key references public.communication_outbox(id) on delete restrict,
 grant_id uuid not null unique references public.document_link_grants(id) on delete restrict,
 reviewed_artifact_hash text not null,reviewed_message_hash text not null,
 queued_by uuid not null references auth.users(id),queued_at timestamptz not null default now()
);
alter table public.document_link_outbox_links enable row level security;
revoke all on public.document_link_outbox_links from public,anon,authenticated,service_role;
create trigger document_link_immutable before update or delete on public.document_link_outbox_links for each row execute function public.guard_document_link_history();
create trigger document_link_audit after insert on public.document_link_outbox_links for each row execute function public.audit_document_link();

create function public.enqueue_document_link_sms(p_request_id uuid,p_reviewed_artifact_hash text,p_reviewed_message_hash text,p_attest boolean) returns public.communication_outbox language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();g public.document_link_grants;p public.document_link_payloads;l public.document_link_outbox_links;o public.communication_outbox;
begin
 select * into g from public.document_link_grants where id=p_request_id for update;
 select * into p from public.document_link_payloads where grant_id=p_request_id;
 if g.actor_id is distinct from actor or p.grant_id is null or p_attest is distinct from true or p.artifact_hash is distinct from p_reviewed_artifact_hash or p.message_hash is distinct from p_reviewed_message_hash then raise exception 'Exact reviewed document and message are required' using errcode='42501';end if;
 select * into l from public.document_link_outbox_links where grant_id=g.id;
 if found then select * into o from public.communication_outbox where id=l.outbox_id;return o;end if;
 if g.state<>'reviewed' or not exists(select 1 from public.document_link_events where grant_id=g.id and kind='reviewed' and actor_id=actor and artifact_hash=p.artifact_hash and message_hash=p.message_hash) then raise exception 'Review document link before queueing' using errcode='42501';end if;
 perform public.document_link_current(g.id);
 if not exists(select 1 from public.document_link_access_budget where grant_id=g.id and used<200) then raise exception 'Document retrieval budget exhausted' using errcode='42501';end if;
 if p.artifact_hash<>encode(sha256(convert_to(p.payload_text,'UTF8')),'hex') then raise exception 'Frozen document integrity failed' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(g.id::text,914));
 if exists(select 1 from public.communication_outbox where request_id=g.id) then raise exception 'Request ID belongs to another queue workflow' using errcode='23505';end if;
 o:=public.enqueue_prepared_communication_internal(actor,g.id,g.conversation_id,'SMS',g.recipient,'',g.message_template,'{}');
 insert into public.document_link_outbox_links(outbox_id,grant_id,reviewed_artifact_hash,reviewed_message_hash,queued_by) values(o.id,g.id,p.artifact_hash,p.message_hash,actor);
 return o;
end $$;

alter function public.recover_document_link(text,uuid,uuid) rename to recover_document_link_without_receipt;
revoke all on function public.recover_document_link_without_receipt(text,uuid,uuid) from public,anon,authenticated,service_role;
create function public.recover_document_link(p_family text,p_source_id uuid,p_request_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;o public.communication_outbox;
begin
 result:=public.recover_document_link_without_receipt(p_family,p_source_id,p_request_id);
 if result is null then return null;end if;
 select box.* into o from public.communication_outbox box join public.document_link_outbox_links l on l.outbox_id=box.id where l.grant_id=(result#>>'{grant,id}')::uuid;
 if found then result:=result||jsonb_build_object('receipt',jsonb_build_object('outbox_id',o.id,'message_id',o.message_id,'state',o.state,'queued',true,'delivered',o.state='delivered'));end if;
 return result;
end $$;

create function public.document_link_delivery_context(p_outbox_id uuid,p_lease_token uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.communication_outbox;l public.document_link_outbox_links;g public.document_link_grants;p public.document_link_payloads;
begin
 perform public.communication_require_service();
 select * into o from public.communication_outbox where id=p_outbox_id for update;
 if not found or o.state<>'claimed' or o.lease_token is distinct from p_lease_token or o.lease_expires_at<=now() or o.attempt_started_at is not null then raise exception 'Outbox lease unavailable' using errcode='40001';end if;
 select * into l from public.document_link_outbox_links where outbox_id=o.id;
 if not found then return null;end if;
 select * into g from public.document_link_grants where id=l.grant_id for share;
 select * into p from public.document_link_payloads where grant_id=g.id;
 perform public.document_link_current(g.id);
 if not exists(select 1 from public.document_link_access_budget where grant_id=g.id and used<200) then raise exception 'Document retrieval budget exhausted' using errcode='42501';end if;
 if g.state<>'reviewed' or p.grant_id is null or p.artifact_hash is distinct from l.reviewed_artifact_hash or p.message_hash is distinct from l.reviewed_message_hash or p.artifact_hash<>encode(sha256(convert_to(p.payload_text,'UTF8')),'hex') or row(o.channel,o.recipient,o.body,o.created_by,o.client_id,o.conversation_id) is distinct from row('SMS'::text,g.recipient,g.message_template,g.actor_id,g.client_id,g.conversation_id) then raise exception 'Document link delivery unavailable' using errcode='42501';end if;
 return jsonb_build_object('grant',jsonb_build_object('id',g.id,'origin',g.origin,'key_version',g.key_version,'capability_context',g.capability_context,'message_template',g.message_template),'token_hash',p.token_hash,'message_hash',p.message_hash,'artifact_hash',p.artifact_hash);
end $$;

alter function public.start_communication_attempt(uuid,uuid,jsonb) rename to start_communication_attempt_without_document_link_guard;
revoke all on function public.start_communication_attempt_without_document_link_guard(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.start_communication_attempt(p_id uuid,p_lease_token uuid,p_provider_config jsonb) returns public.communication_outbox language plpgsql security definer set search_path=public as $$
declare o public.communication_outbox;context jsonb;valid boolean:=true;
begin
 perform public.communication_require_service();
 select * into o from public.communication_outbox where id=p_id for update;
 if not found or o.state<>'claimed' or o.lease_token is distinct from p_lease_token or o.lease_expires_at<=now() or o.attempt_started_at is not null then raise exception 'Outbox lease unavailable' using errcode='40001';end if;
 if exists(select 1 from public.document_link_outbox_links where outbox_id=o.id) then
  begin
   context:=public.document_link_delivery_context(p_id,p_lease_token);
   valid:=context is not null and p_provider_config->>'document_link_message_hash'=context->>'message_hash' and p_provider_config->>'document_link_token_hash'=context->>'token_hash' and p_provider_config->>'document_link_artifact_hash'=context->>'artifact_hash';
  exception when sqlstate '42501' or sqlstate '23514' then valid:=false;end;
  if valid is distinct from true then update public.communication_outbox set state='failed',last_error='document_link_source_or_materialization_ineligible',lease_token=null,lease_expires_at=null,updated_at=now() where id=o.id returning * into o;return o;end if;
  return public.start_communication_attempt_without_document_link_guard(p_id,p_lease_token,p_provider_config-array['document_link_message_hash','document_link_token_hash','document_link_artifact_hash']);
 end if;
 return public.start_communication_attempt_without_document_link_guard(p_id,p_lease_token,p_provider_config);
end $$;

-- Block accidental pasting of usable capabilities into generic outbound persistence.
create function public.reject_persisted_document_capability() returns trigger language plpgsql set search_path=public as $$
begin
 if to_jsonb(NEW)::text ~ 'v1\.[A-Za-z0-9_-]{43}' then raise exception 'Use the reviewed document-link workflow; private capabilities cannot be stored in message history' using errcode='23514';end if;
 return NEW;
end $$;
create trigger reject_document_capability before insert or update on public.communication_outbox for each row execute function public.reject_persisted_document_capability();
create trigger reject_document_capability before insert or update on public.communication_prepared_requests for each row execute function public.reject_persisted_document_capability();
create trigger reject_document_capability before insert or update on public.document_link_grants for each row execute function public.reject_persisted_document_capability();
create trigger reject_document_capability before insert or update on public.messages for each row when (NEW.sender_type='STAFF') execute function public.reject_persisted_document_capability();

do $$declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('enqueue_document_link_sms','recover_document_link','document_link_delivery_context','start_communication_attempt','reject_persisted_document_capability') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('enqueue_document_link_sms','recover_document_link') then execute format('grant execute on function %s to authenticated',f.signature);
  elsif f.proname in ('document_link_delivery_context','start_communication_attempt') then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
