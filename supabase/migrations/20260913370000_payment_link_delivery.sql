-- Templates and reviewed digests only; materialized capabilities stay in worker memory.
create table public.payment_delivery_requests (
 id uuid primary key,grant_id uuid not null references public.payment_collection_grants(id),actor_id uuid not null references auth.users(id),
 invoice_id uuid not null references public.billing_invoices(id),client_id uuid not null references public.clients(id),source_hash text not null,amount_cents bigint not null,
 conversation_id uuid not null references public.conversations(id),channel text not null check(channel in ('EMAIL','SMS')),recipient text not null,
 subject text not null,body_template text not null,
 invoice_email_request_id uuid references public.invoice_email_requests(id),invoice_payload_hash text,
 created_at timestamptz not null default now(),check((invoice_email_request_id is null)=(invoice_payload_hash is null)),check(invoice_email_request_id is null or channel='EMAIL')
);
create table public.payment_delivery_captures (
 request_id uuid primary key references public.payment_delivery_requests(id),sender_config jsonb not null,
 message_hash text not null check(message_hash ~ '^[a-f0-9]{64}$'),payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),captured_at timestamptz not null default now()
);
create table public.payment_delivery_outbox_links (
 outbox_id uuid primary key references public.communication_outbox(id),request_id uuid not null unique references public.payment_delivery_requests(id),
 reviewed_message_hash text not null,reviewed_payload_hash text not null,queued_by uuid not null references auth.users(id),queued_at timestamptz not null default now()
);
do $$declare t text;begin foreach t in array array['payment_delivery_requests','payment_delivery_captures','payment_delivery_outbox_links'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger payment_delivery_immutable before update or delete on public.%I for each row execute function public.payment_immutable()',t);
 execute format('create trigger reject_payment_capability before insert or update on public.%I for each row execute function public.reject_persisted_document_capability()',t);
 end loop;end $$;
create function public.payment_delivery_current(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.payment_delivery_requests;g public.payment_collection_grants;c public.payment_collection_captures;a public.invoice_email_requests;p public.invoice_email_payloads;attachment jsonb;
begin
 select * into r from public.payment_delivery_requests where id=p_id for share;
 if not found or not public.is_active_staff(r.actor_id) then raise exception 'Payment delivery unavailable' using errcode='42501';end if;
 select * into g from public.payment_collection_grants where id=r.grant_id for share;
 select * into c from public.payment_collection_captures where grant_id=g.id;
 perform 1 from public.billing_invoices where id=r.invoice_id for share;
 perform 1 from public.clients where id=r.client_id and public.communication_recipient(r.channel,case when r.channel='EMAIL' then primary_email else primary_phone end)=r.recipient for share;
 if not found or public.communication_is_suppressed(r.channel,r.recipient,r.client_id) then raise exception 'Payment delivery contact unavailable' using errcode='42501';end if;
 perform 1 from public.conversations where id=r.conversation_id and client_id=r.client_id for share;
 if not found then raise exception 'Payment delivery conversation unavailable' using errcode='42501';end if;
 if g.actor_id<>r.actor_id or public.payment_collection_state_internal(g.id)<>'reviewed' or g.expires_at<=clock_timestamp() or c.grant_id is null or r.source_hash is distinct from public.payment_source_hash_internal(r.invoice_id,r.client_id) or r.amount_cents::text is distinct from public.payment_balance_internal(r.invoice_id)->>'outstanding_cents' then raise exception 'Payment collection no longer eligible for delivery' using errcode='42501';end if;
 if public.inspect_payment_collection(g.id,c.collection_token_hash,c.origin,c.key_version)->>'state' in ('paid','partially_refunded','refunded','reconciliation') then raise exception 'Payment collection is not collectible' using errcode='42501';end if;
 if r.invoice_email_request_id is not null then
 select * into a from public.invoice_email_requests where id=r.invoice_email_request_id for share;
 select * into p from public.invoice_email_payloads where request_id=a.id for share;
 perform public.invoice_email_context(a.id);
 if row(a.actor_id,a.invoice_id,a.client_id,a.conversation_id,a.recipient,a.subject,a.body) is distinct from row(r.actor_id,r.invoice_id,r.client_id,r.conversation_id,r.recipient,r.subject,r.body_template) or a.state<>'ready' or p.payload_text is null or p.payload_hash is distinct from r.invoice_payload_hash or p.payload_hash<>encode(sha256(convert_to(p.payload_text,'UTF8')),'hex') then raise exception 'Reviewed invoice attachment unavailable' using errcode='42501';end if;
 attachment:=p.payload_text::jsonb;
 -- Inspect the decoded supported HTML; do not claim arbitrary attachment encodings are scrubbed.
 if convert_from(decode(attachment#>>'{attachments,0,content}','base64'),'UTF8') ~ '(v1|p1|s1)\.[A-Za-z0-9_-]{43}' then raise exception 'Private capabilities cannot enter invoice attachments' using errcode='23514';end if;
 end if;
 return jsonb_build_object('request',to_jsonb(r)||jsonb_build_object('amount_cents',r.amount_cents::text),'grant',public.payment_collection_read_internal(g.id)->'grant','capability',to_jsonb(c),'invoice_payload',attachment,'invoice_payload_text',p.payload_text);
end $$;
create function public.recover_payment_delivery(p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.payment_delivery_requests;p public.payment_delivery_captures;o public.communication_outbox;
begin
 select * into r from public.payment_delivery_requests where id=p_request_id and actor_id=actor;
 if not found then return null;end if;
 select * into p from public.payment_delivery_captures where request_id=r.id;
 select box.* into o from public.communication_outbox box join public.payment_delivery_outbox_links l on l.outbox_id=box.id where l.request_id=r.id;
 return jsonb_build_object('request',to_jsonb(r)||jsonb_build_object('amount_cents',r.amount_cents::text),'capture',case when p.request_id is not null then to_jsonb(p) end,'receipt',case when o.id is not null then jsonb_build_object('outbox_id',o.id,'message_id',o.message_id,'state',o.state,'queued',true,'delivered',o.state='delivered') end);
end $$;
create function public.prepare_payment_delivery(p_request_id uuid,p_grant_id uuid,p_conversation_id uuid,p_channel text,p_recipient text,p_subject text,p_body_template text,p_invoice_email_request_id uuid default null,p_invoice_payload_hash text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.payment_delivery_requests;g public.payment_collection_grants;
begin
 if p_request_id is null or p_channel is null or p_channel not in ('SMS','EMAIL') or p_recipient is null or public.communication_recipient(p_channel,p_recipient) is distinct from p_recipient or p_subject is null or p_body_template is null or length(p_body_template) not between 16 and 100000 or (length(p_body_template)-length(replace(p_body_template,'{{payment_link}}','')))<>16 or (p_channel='SMS' and (p_subject<>'' or length(p_body_template)>1600)) or (p_channel='EMAIL' and length(trim(p_subject)) not between 1 and 500) or p_subject like '%{{payment_link}}%' then raise exception 'Exact payment message template required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,3700));
 select * into r from public.payment_delivery_requests where id=p_request_id;
 if found then
 if r.actor_id<>actor or row(r.grant_id,r.conversation_id,r.channel,r.recipient,r.subject,r.body_template,r.invoice_email_request_id,r.invoice_payload_hash) is distinct from row(p_grant_id,p_conversation_id,p_channel,p_recipient,p_subject,p_body_template,p_invoice_email_request_id,p_invoice_payload_hash) then raise exception 'Payment delivery request already used' using errcode='23505';end if;
 return public.recover_payment_delivery(r.id);end if;
 select * into g from public.payment_collection_grants where id=p_grant_id and actor_id=actor;
 if not found then raise exception 'Own reviewed collection required' using errcode='42501';end if;
 insert into public.payment_delivery_requests(id,grant_id,actor_id,invoice_id,client_id,source_hash,amount_cents,conversation_id,channel,recipient,subject,body_template,invoice_email_request_id,invoice_payload_hash) values(p_request_id,g.id,actor,g.invoice_id,g.client_id,g.source_hash,g.amount_cents,p_conversation_id,p_channel,p_recipient,p_subject,p_body_template,p_invoice_email_request_id,p_invoice_payload_hash);
 perform public.payment_delivery_current(p_request_id);
 return public.recover_payment_delivery(p_request_id);
end $$;
create function public.payment_delivery_capture_context(p_request_id uuid,p_actor_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
begin perform public.communication_require_service();
 if not exists(select 1 from public.payment_delivery_requests where id=p_request_id and actor_id=p_actor_id) then raise exception 'Payment delivery ownership mismatch' using errcode='42501';end if;
 return public.payment_delivery_current(p_request_id)||jsonb_build_object('capture',(select to_jsonb(p) from public.payment_delivery_captures p where request_id=p_request_id));end $$;
create function public.capture_payment_delivery(p_request_id uuid,p_actor_id uuid,p_sender_config jsonb,p_message_hash text,p_payload_hash text) returns void language plpgsql security definer set search_path=public as $$
declare r public.payment_delivery_requests;p public.payment_delivery_captures;context jsonb;
begin perform public.communication_require_service();
 select * into r from public.payment_delivery_requests where id=p_request_id and actor_id=p_actor_id for update;
 if not found then raise exception 'Payment delivery ownership mismatch' using errcode='42501';end if;
 select * into p from public.payment_delivery_captures where request_id=r.id;
 if found then if row(p.sender_config,p.message_hash,p.payload_hash) is distinct from row(p_sender_config,p_message_hash,p_payload_hash) then raise exception 'Captured payment delivery is immutable' using errcode='23505';end if;return;end if;
 context:=public.payment_delivery_current(r.id);
 if p_sender_config is null or jsonb_typeof(p_sender_config)<>'object' or octet_length(p_sender_config::text)>2048 or exists(select 1 from jsonb_each(p_sender_config) e where jsonb_typeof(e.value)<>'string') or (r.channel='EMAIL' and (not p_sender_config ?& array['from','reply_to'] or p_sender_config-array['from','reply_to']<>'{}' or public.communication_recipient('EMAIL',p_sender_config->>'reply_to') is null or public.communication_recipient('EMAIL',coalesce(substring(p_sender_config->>'from' from '<([^<>]+)>$'),p_sender_config->>'from')) is null)) or (r.channel='SMS' and (not p_sender_config ?& array['from','account_sid'] or p_sender_config-array['from','account_sid']<>'{}' or public.communication_recipient('SMS',p_sender_config->>'from') is null or coalesce(p_sender_config->>'account_sid','') !~ '^AC[A-Za-z0-9]{32}$')) then raise exception 'Invalid frozen payment sender configuration' using errcode='23514';end if;
 if r.invoice_email_request_id is not null and row(context#>>'{invoice_payload,from}',context#>>'{invoice_payload,reply_to}') is distinct from row(p_sender_config->>'from',p_sender_config->>'reply_to') then raise exception 'Invoice attachment sender differs from payment message' using errcode='23514';end if;
 insert into public.payment_delivery_captures(request_id,sender_config,message_hash,payload_hash) values(r.id,p_sender_config,p_message_hash,p_payload_hash);
end $$;
create function public.enqueue_payment_delivery(p_request_id uuid,p_reviewed_message_hash text,p_reviewed_payload_hash text,p_attest boolean) returns public.communication_outbox language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.payment_delivery_requests;p public.payment_delivery_captures;o public.communication_outbox;
begin
 select * into r from public.payment_delivery_requests where id=p_request_id and actor_id=actor for update;
 select * into p from public.payment_delivery_captures where request_id=r.id;
 if r.id is null or p.request_id is null or p_attest is distinct from true or row(p.message_hash,p.payload_hash) is distinct from row(p_reviewed_message_hash,p_reviewed_payload_hash) then raise exception 'Exact payment message and attachment review required' using errcode='42501';end if;
 select box.* into o from public.communication_outbox box join public.payment_delivery_outbox_links l on l.outbox_id=box.id where l.request_id=r.id;
 if found then return o;end if;
 perform public.payment_delivery_current(r.id);
 perform pg_advisory_xact_lock(hashtextextended(r.id::text,914));
 if exists(select 1 from public.communication_outbox where request_id=r.id) then raise exception 'Request belongs to another queue workflow' using errcode='23505';end if;
 o:=public.enqueue_prepared_communication_internal(actor,r.id,r.conversation_id,r.channel,r.recipient,r.subject,r.body_template,'{}');
 insert into public.payment_delivery_outbox_links(outbox_id,request_id,reviewed_message_hash,reviewed_payload_hash,queued_by) values(o.id,r.id,p.message_hash,p.payload_hash,actor);
 return o;
end $$;
create function public.payment_delivery_context(p_outbox_id uuid,p_lease_token uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.communication_outbox;l public.payment_delivery_outbox_links;r public.payment_delivery_requests;p public.payment_delivery_captures;context jsonb;
begin perform public.communication_require_service();
 select * into o from public.communication_outbox where id=p_outbox_id for update;
 if not found or o.state<>'claimed' or o.lease_token is distinct from p_lease_token or o.lease_expires_at<=now() or o.attempt_started_at is not null then raise exception 'Outbox lease unavailable' using errcode='40001';end if;
 select * into l from public.payment_delivery_outbox_links where outbox_id=o.id;
 if not found then return null;end if;
 select * into r from public.payment_delivery_requests where id=l.request_id;
 select * into p from public.payment_delivery_captures where request_id=r.id;
 context:=public.payment_delivery_current(r.id);
 if row(o.channel,o.recipient,o.subject,o.body,o.created_by,o.client_id,o.conversation_id) is distinct from row(r.channel,r.recipient,r.subject,r.body_template,r.actor_id,r.client_id,r.conversation_id) or row(p.message_hash,p.payload_hash) is distinct from row(l.reviewed_message_hash,l.reviewed_payload_hash) then raise exception 'Payment delivery review unavailable' using errcode='42501';end if;
 return context||jsonb_build_object('capture',to_jsonb(p));
end $$;
alter function public.start_communication_attempt(uuid,uuid,jsonb) rename to start_communication_attempt_without_payment_delivery_guard;
revoke all on function public.start_communication_attempt_without_payment_delivery_guard(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.start_communication_attempt(p_id uuid,p_lease_token uuid,p_provider_config jsonb) returns public.communication_outbox language plpgsql security definer set search_path=public as $$
declare o public.communication_outbox;context jsonb;valid boolean;
begin perform public.communication_require_service();
 select * into o from public.communication_outbox where id=p_id for update;
 if not found or o.state<>'claimed' or o.lease_token is distinct from p_lease_token or o.lease_expires_at<=now() or o.attempt_started_at is not null then raise exception 'Outbox lease unavailable' using errcode='40001';end if;
 if exists(select 1 from public.payment_delivery_outbox_links where outbox_id=o.id) then
 begin
 context:=public.payment_delivery_context(p_id,p_lease_token);
 valid:=p_provider_config->>'payment_delivery_message_hash'=context#>>'{capture,message_hash}' and p_provider_config->>'payment_delivery_payload_hash'=context#>>'{capture,payload_hash}' and p_provider_config-array['payment_delivery_message_hash','payment_delivery_payload_hash']=context#>'{capture,sender_config}';
 exception when sqlstate '42501' or sqlstate '23514' then valid:=false;end;
 if valid is distinct from true then update public.communication_outbox set state='failed',last_error='payment_delivery_source_or_materialization_ineligible',lease_token=null,lease_expires_at=null,updated_at=now() where id=o.id returning * into o;return o;end if;
 return public.start_communication_attempt_without_payment_delivery_guard(p_id,p_lease_token,p_provider_config-array['payment_delivery_message_hash','payment_delivery_payload_hash']);
 end if;
 return public.start_communication_attempt_without_payment_delivery_guard(p_id,p_lease_token,p_provider_config);
end $$;
do $$declare f record;begin for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('payment_delivery_current','recover_payment_delivery','prepare_payment_delivery','payment_delivery_capture_context','capture_payment_delivery','enqueue_payment_delivery','payment_delivery_context','start_communication_attempt') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.proname in ('recover_payment_delivery','prepare_payment_delivery','enqueue_payment_delivery') then execute format('grant execute on function %s to authenticated',f.signature);
 elsif f.proname<>'payment_delivery_current' then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;end $$;
