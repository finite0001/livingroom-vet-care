-- Issued invoice email snapshots are independent of clinical record-release acceptance.
alter function public.read_invoice_document(uuid,uuid) rename to invoice_document_internal;
do $$declare definition text;begin
 select pg_get_functiondef('public.invoice_document_internal(uuid,uuid)'::regprocedure) into definition;
 if position('perform public.clinical_require_staff();' in definition)=0 then raise exception 'Invoice document definition drifted';end if;
 execute replace(definition,'perform public.clinical_require_staff();','');
end $$;
create function public.read_invoice_document(p_invoice_id uuid,p_client_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin perform public.clinical_require_staff();return public.invoice_document_internal(p_invoice_id,p_client_id);end $$;
revoke all on function public.invoice_document_internal(uuid,uuid),public.read_invoice_document(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_invoice_document(uuid,uuid) to authenticated;

create function public.invoice_email_preview_internal(p_invoice_id uuid,p_client_id uuid) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare i public.billing_invoices;c public.clients;doc jsonb;recipient text;hash text;
begin
 select * into i from public.billing_invoices where id=p_invoice_id and client_id=p_client_id for share;
 if not found or i.status<>'issued' then raise exception 'Only an issued invoice for this household can be emailed' using errcode='42501';end if;
 select * into strict c from public.clients where id=p_client_id for share;
 recipient:=public.communication_recipient('EMAIL',c.primary_email);
 if recipient is null or public.communication_is_suppressed('EMAIL',recipient,c.id) then raise exception 'Current household email is unavailable or suppressed' using errcode='42501';end if;
 doc:=public.invoice_document_internal(i.id,c.id);
 hash:=encode(digest(jsonb_build_object('document',doc-'rendered_at','client_version',c.version,'recipient',recipient)::text,'sha256'),'hex');
 return jsonb_build_object('document',doc,'source_hash',hash,'client_id',c.id,'recipient',recipient);
end $$;
create function public.read_invoice_email_preview(p_invoice_id uuid,p_client_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
begin perform public.clinical_require_staff();return public.invoice_email_preview_internal(p_invoice_id,p_client_id);end $$;
revoke all on function public.invoice_email_preview_internal(uuid,uuid),public.read_invoice_email_preview(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_invoice_email_preview(uuid,uuid) to authenticated;

create table public.invoice_email_requests (
 id uuid primary key,invoice_id uuid not null references public.billing_invoices(id) on delete restrict,
 actor_id uuid not null references auth.users(id),conversation_id uuid not null references public.conversations(id) on delete restrict,
 client_id uuid not null references public.clients(id) on delete restrict,recipient text not null,
 subject text not null check(length(trim(subject)) between 1 and 500),body text not null check(length(trim(body)) between 1 and 100000),
 invoice_hash text not null check(invoice_hash ~ '^[a-f0-9]{64}$'),
 invoice_snapshot jsonb not null,
 state text not null default 'preparing' check(state in ('preparing','ready','queued','abandoned')),
 created_at timestamptz not null default now()
);
create unique index invoice_email_unresolved on public.invoice_email_requests(actor_id,invoice_id) where state in ('preparing','ready');
create table public.invoice_email_payloads (
 request_id uuid primary key references public.invoice_email_requests(id) on delete restrict,
 payload_text text check(payload_text is null or octet_length(payload_text) between 1 and 33554432),purged_at timestamptz,
 check((payload_text is null)=(purged_at is not null)),
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),manifest jsonb not null,
 captured_at timestamptz not null default now()
);
create table public.invoice_email_outbox_links (
 outbox_id uuid primary key references public.communication_outbox(id) on delete restrict,
 request_id uuid not null unique references public.invoice_email_requests(id) on delete restrict,
 reviewed_payload_hash text not null,queued_by uuid not null references auth.users(id),queued_at timestamptz not null default now()
);
create function public.guard_invoice_email_history() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP='UPDATE' and TG_TABLE_NAME='invoice_email_payloads' then
 if current_user='postgres' and OLD.payload_text is not null and NEW.payload_text is null and NEW.purged_at=now() and (to_jsonb(NEW)-array['payload_text','purged_at'])=(to_jsonb(OLD)-array['payload_text','purged_at']) and OLD.captured_at<now()-interval '90 days' then return NEW;end if;
 end if;
 if TG_OP='UPDATE' and TG_TABLE_NAME='invoice_email_requests' then
 if (to_jsonb(NEW)-'state')=(to_jsonb(OLD)-'state') and ((OLD.state='preparing' and NEW.state in ('ready','abandoned')) or (OLD.state='ready' and NEW.state in ('queued','abandoned'))) then return NEW;end if;
 end if;
 raise exception 'Invoice email history is immutable' using errcode='23514';
end $$;
do $$ declare t text;begin
 foreach t in array array['invoice_email_requests','invoice_email_payloads','invoice_email_outbox_links'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger invoice_email_immutable before update or delete on public.%I for each row execute function public.guard_invoice_email_history()',t);
 end loop;
end $$;
-- No direct reads of payload bytes, even with a staff or service PostgREST client.
create function public.audit_invoice_email() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.audit_logs(user_id,action,table_name,record_id,new_data) values(auth.uid(),TG_OP,TG_TABLE_NAME,case when TG_TABLE_NAME='invoice_email_requests' then (to_jsonb(NEW)->>'id')::uuid else (to_jsonb(NEW)->>'request_id')::uuid end,case when TG_TABLE_NAME='invoice_email_payloads' then to_jsonb(NEW)-'payload_text' else to_jsonb(NEW)-array['body','subject','invoice_snapshot'] end);return NEW;
end $$;
create trigger audit_invoice_email_request after insert or update on public.invoice_email_requests for each row execute function public.audit_invoice_email();
create trigger audit_invoice_email_payload after insert on public.invoice_email_payloads for each row execute function public.audit_invoice_email();
create trigger audit_invoice_email_link after insert on public.invoice_email_outbox_links for each row execute function public.audit_invoice_email();

create function public.invoice_email_context(p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.invoice_email_requests;current_doc jsonb;
begin
 select * into r from public.invoice_email_requests where id=p_request_id for share;
 if not found or r.state='abandoned' or not public.is_active_staff(r.actor_id) then raise exception 'Invoice email actor or request is unavailable' using errcode='42501';end if;
 perform 1 from public.conversations where id=r.conversation_id and client_id=r.client_id for share;
 if not found then raise exception 'Invoice email conversation no longer belongs to household' using errcode='42501';end if;
 current_doc:=public.invoice_email_preview_internal(r.invoice_id,r.client_id);
 if current_doc->>'source_hash' is distinct from r.invoice_hash or current_doc->>'recipient' is distinct from r.recipient then raise exception 'Invoice or household changed; prepare and review a fresh invoice email' using errcode='42501';end if;
 return jsonb_build_object('document',r.invoice_snapshot,'source_hash',r.invoice_hash,'client_id',r.client_id,'recipient',r.recipient);
end $$;
create function public.recover_invoice_email(p_invoice_id uuid,p_request_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.invoice_email_requests;p public.invoice_email_payloads;o public.communication_outbox;
begin
 select * into r from public.invoice_email_requests where actor_id=actor and invoice_id=p_invoice_id and ((p_request_id is null and state<>'abandoned') or id=p_request_id) order by created_at desc,id limit 1;
 if not found then return null;end if;
 select * into p from public.invoice_email_payloads where request_id=r.id;
 select box.* into o from public.communication_outbox box join public.invoice_email_outbox_links l on l.outbox_id=box.id where l.request_id=r.id;
 return jsonb_build_object('request',to_jsonb(r),'payload_hash',p.payload_hash,'manifest',p.manifest,
 'purged_at',p.purged_at,'report_html',case when p.payload_text is not null then convert_from(decode((p.payload_text::jsonb)#>>'{attachments,0,content}','base64'),'UTF8') end,
 'receipt',case when o.id is not null then jsonb_build_object('outbox_id',o.id,'message_id',o.message_id,'state',o.state,'queued',true,'delivered',o.state='delivered') end);
end $$;
create function public.prepare_invoice_email(p_request_id uuid,p_invoice_id uuid,p_client_id uuid,p_conversation_id uuid,p_recipient text,p_subject text,p_body text,p_invoice_hash text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.invoice_email_requests;preview jsonb;
begin
 if p_request_id is null or p_invoice_hash is null or p_invoice_hash !~ '^[a-f0-9]{64}$' or p_recipient is null or p_subject is null or length(trim(p_subject)) not between 1 and 500 or p_body is null or length(trim(p_body)) not between 1 and 100000 then raise exception 'Stable request ID and complete reviewed invoice email intent are required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,2700));
 select * into r from public.invoice_email_requests where id=p_request_id;
 if found then
  if r.actor_id<>actor or row(r.invoice_id,r.client_id,r.conversation_id,r.recipient,r.subject,r.body,r.invoice_hash) is distinct from row(p_invoice_id,p_client_id,p_conversation_id,p_recipient,p_subject,p_body,p_invoice_hash) or r.state='abandoned' then raise exception 'Invoice email request already used or abandoned' using errcode='23505';end if;
  return public.recover_invoice_email(p_invoice_id,p_request_id);
 end if;
 perform 1 from public.conversations where id=p_conversation_id and client_id=p_client_id for share;
 if not found then raise exception 'Invoice conversation does not belong to the reviewed household' using errcode='42501';end if;
 preview:=public.invoice_email_preview_internal(p_invoice_id,p_client_id);
 if preview->>'source_hash' is distinct from p_invoice_hash or preview->>'recipient' is distinct from p_recipient then raise exception 'Invoice or recipient changed; review the current invoice' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_invoice_id::text,2700));
 if exists(select 1 from public.invoice_email_requests where actor_id=actor and invoice_id=p_invoice_id and state in ('preparing','ready')) then raise exception 'Recover or abandon the unresolved invoice email first' using errcode='23505';end if;
 insert into public.invoice_email_requests(id,invoice_id,actor_id,conversation_id,client_id,recipient,subject,body,invoice_hash,invoice_snapshot) values(p_request_id,p_invoice_id,actor,p_conversation_id,p_client_id,p_recipient,p_subject,p_body,p_invoice_hash,preview->'document');
 return public.recover_invoice_email(p_invoice_id,p_request_id);
end $$;
create function public.invoice_email_capture_context(p_request_id uuid,p_actor_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.invoice_email_requests;
begin perform public.communication_require_service();select * into r from public.invoice_email_requests where id=p_request_id;
 if not found or r.actor_id is distinct from p_actor_id then raise exception 'Request ownership mismatch' using errcode='42501';end if;
 return jsonb_build_object('request',to_jsonb(r),'bundle',public.invoice_email_context(p_request_id),'captured',exists(select 1 from public.invoice_email_payloads where request_id=p_request_id));end $$;
create function public.capture_invoice_email_payload(p_request_id uuid,p_actor_id uuid,p_payload_text text) returns void language plpgsql security definer set search_path=public as $$
declare r public.invoice_email_requests;existing public.invoice_email_payloads;payload jsonb;a jsonb;decoded bytea;hash text;manifest jsonb;
begin
 perform public.communication_require_service();
 if p_payload_text is null or octet_length(p_payload_text) not between 1 and 33554432 then raise exception 'Encoded invoice email exceeds application limits' using errcode='23514';end if;
 select * into r from public.invoice_email_requests where id=p_request_id for update;
 if not found or r.actor_id is distinct from p_actor_id or r.state='abandoned' or not public.is_active_staff(r.actor_id) then raise exception 'Request ownership mismatch or abandoned' using errcode='42501';end if;
 perform public.invoice_email_context(p_request_id);
 hash:=encode(sha256(convert_to(p_payload_text,'UTF8')),'hex');
 select * into existing from public.invoice_email_payloads where request_id=p_request_id;
 if found then if existing.payload_text is distinct from p_payload_text then raise exception 'Captured provider payload is immutable' using errcode='23505';end if;return;end if;
 payload:=p_payload_text::jsonb;
 if jsonb_typeof(payload)<>'object' or payload-array['from','reply_to','to','subject','text','attachments']<>'{}' or payload->'to' is distinct from jsonb_build_array(r.recipient) or payload->>'subject' is distinct from r.subject or payload->>'text' is distinct from r.body or public.communication_recipient('EMAIL',payload->>'reply_to') is null or jsonb_typeof(payload->'from') is distinct from 'string' or length(payload->>'from') not between 1 and 500 or public.communication_recipient('EMAIL',coalesce(substring(payload->>'from' from '<([^<>]+)>$'),payload->>'from')) is null then raise exception 'Provider payload differs from reviewed invoice intent' using errcode='23514';end if;
 if jsonb_typeof(payload->'attachments') is distinct from 'array' or jsonb_array_length(payload->'attachments')<>1 then raise exception 'Exactly one reviewed invoice HTML attachment is required' using errcode='23514';end if;
 a:=payload#>'{attachments,0}';
 if jsonb_typeof(a)<>'object' or a-array['filename','content_type','content']<>'{}' or a->>'filename' is distinct from 'invoice-'||r.invoice_id::text||'.html' or a->>'content_type' is distinct from 'text/html' or jsonb_typeof(a->'content') is distinct from 'string' or a->>'content' !~ '^[A-Za-z0-9+/]*={0,2}$' then raise exception 'Reviewed invoice attachment metadata is invalid' using errcode='23514';end if;
 decoded:=decode(a->>'content','base64');if octet_length(decoded)<1 then raise exception 'Empty invoice attachment rejected' using errcode='23514';end if;perform convert_from(decoded,'UTF8');
 manifest:=jsonb_build_array(jsonb_build_object('filename',a->>'filename','mime_type','text/html','file_size',octet_length(decoded),'sha256',encode(sha256(decoded),'hex'),'document_id',null));
 insert into public.invoice_email_payloads(request_id,payload_text,payload_hash,manifest) values(r.id,p_payload_text,hash,manifest);
 update public.invoice_email_requests set state='ready' where id=r.id;
exception when invalid_text_representation or character_not_in_repertoire then raise exception 'Malformed frozen invoice payload' using errcode='23514';
end $$;
create function public.enqueue_invoice_email(p_request_id uuid,p_reviewed_payload_hash text,p_attest boolean) returns public.communication_outbox language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.invoice_email_requests;p public.invoice_email_payloads;l public.invoice_email_outbox_links;o public.communication_outbox;
begin
 if p_attest is distinct from true then raise exception 'Review the exact invoice attachment and message before queueing' using errcode='23514';end if;
 select * into r from public.invoice_email_requests where id=p_request_id for update;
 select * into p from public.invoice_email_payloads where request_id=p_request_id;
 if r.id is null or r.actor_id<>actor or r.state='abandoned' or p.request_id is null or p.payload_hash is distinct from p_reviewed_payload_hash then raise exception 'Prepared invoice email or reviewed payload does not match' using errcode='42501';end if;
 select * into l from public.invoice_email_outbox_links where request_id=p_request_id;
 if found then select * into o from public.communication_outbox where id=l.outbox_id;return o;end if;
 perform public.invoice_email_context(p_request_id);
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,914));
 if exists(select 1 from public.communication_outbox where request_id=p_request_id) then raise exception 'Request ID already belongs to another queue workflow' using errcode='23505';end if;
 o:=public.enqueue_prepared_communication_internal(actor,r.id,r.conversation_id,'EMAIL',r.recipient,r.subject,r.body,'{}');
 insert into public.invoice_email_outbox_links(outbox_id,request_id,reviewed_payload_hash,queued_by) values(o.id,r.id,p.payload_hash,actor);
 update public.invoice_email_requests set state='queued' where id=r.id;
 return o;
end $$;
create function public.abandon_invoice_email(p_request_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.invoice_email_requests;
begin select * into r from public.invoice_email_requests where id=p_request_id for update;
 if not found or r.actor_id<>actor or r.state='queued' then raise exception 'Only own unqueued preparation can be abandoned' using errcode='42501';end if;
 if r.state<>'abandoned' then update public.invoice_email_requests set state='abandoned' where id=p_request_id;end if;end $$;

create function public.read_invoice_email_payload(p_outbox_id uuid,p_lease_token uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.communication_outbox;l public.invoice_email_outbox_links;p public.invoice_email_payloads;
begin perform public.communication_require_service();select * into o from public.communication_outbox where id=p_outbox_id;
 if not found or o.state<>'claimed' or o.lease_token is distinct from p_lease_token or o.lease_expires_at<=now() or o.attempt_started_at is not null then raise exception 'Outbox lease unavailable' using errcode='40001';end if;
 select * into l from public.invoice_email_outbox_links where outbox_id=o.id;
 if not found then return null;end if;
 perform public.invoice_email_context(l.request_id);
 select * into p from public.invoice_email_payloads where request_id=l.request_id;
 if not found or p.payload_text is null or l.reviewed_payload_hash<>p.payload_hash then raise exception 'Frozen invoice payload unavailable' using errcode='23514';end if;
 return jsonb_build_object('payload_text',p.payload_text,'payload_hash',p.payload_hash);
end $$;
create function public.read_frozen_email_payload(p_outbox_id uuid,p_lease_token uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare payload jsonb;
begin
 perform public.communication_require_service();
 if exists(select 1 from public.invoice_email_outbox_links where outbox_id=p_outbox_id) and exists(select 1 from public.release_email_outbox_links where outbox_id=p_outbox_id) then raise exception 'Ambiguous frozen email association' using errcode='23514';end if;
 payload:=public.read_invoice_email_payload(p_outbox_id,p_lease_token);
 if payload is not null then return payload||jsonb_build_object('artifact_kind','invoice');end if;
 payload:=public.read_release_email_payload(p_outbox_id,p_lease_token);
 if payload is not null then return payload||jsonb_build_object('artifact_kind','record_release');end if;
 return null;
end $$;
alter function public.start_communication_attempt(uuid,uuid,jsonb) rename to start_communication_attempt_without_invoice_guard;
revoke all on function public.start_communication_attempt_without_invoice_guard(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.start_communication_attempt(p_id uuid,p_lease_token uuid,p_provider_config jsonb) returns public.communication_outbox language plpgsql security definer set search_path=public as $$
declare o public.communication_outbox;l public.invoice_email_outbox_links;p public.invoice_email_payloads;payload jsonb;valid boolean:=true;
begin perform public.communication_require_service();select * into o from public.communication_outbox where id=p_id for update;
 if not found or o.state<>'claimed' or o.lease_token is distinct from p_lease_token or o.lease_expires_at<=now() or o.attempt_started_at is not null then raise exception 'Outbox lease unavailable' using errcode='40001';end if;
 select * into l from public.invoice_email_outbox_links where outbox_id=o.id;
 if found then
  begin
   perform public.invoice_email_context(l.request_id);
   select * into p from public.invoice_email_payloads where request_id=l.request_id;
   payload:=p.payload_text::jsonb;
   valid:=p.request_id is not null and p.payload_hash=l.reviewed_payload_hash and p.payload_hash=encode(sha256(convert_to(p.payload_text,'UTF8')),'hex') and p_provider_config->>'invoice_payload_hash'=p.payload_hash and payload->>'from'=p_provider_config->>'from' and payload->>'reply_to'=p_provider_config->>'reply_to';
  exception when sqlstate '23514' or sqlstate '42501' then valid:=false;end;
  if valid is distinct from true then update public.communication_outbox set state='failed',last_error='invoice_source_or_payload_ineligible',lease_token=null,lease_expires_at=null,updated_at=now() where id=o.id returning * into o;return o;end if;
  return public.start_communication_attempt_without_invoice_guard(p_id,p_lease_token,p_provider_config-'invoice_payload_hash');
 end if;
 return public.start_communication_attempt_without_invoice_guard(p_id,p_lease_token,p_provider_config);
end $$;
create function public.read_invoice_email_attachment(p_request_id uuid,p_index integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();p public.invoice_email_payloads;
begin
 if p_index is null or p_index <>0 or not exists(select 1 from public.invoice_email_requests where id=p_request_id and actor_id=actor) then raise exception 'Attachment request unavailable' using errcode='42501';end if;
 select * into p from public.invoice_email_payloads where request_id=p_request_id;
 if p.payload_text is null or p_index>=jsonb_array_length(p.manifest) then raise exception 'Frozen attachment unavailable or expired' using errcode='23514';end if;
 return (p.payload_text::jsonb->'attachments')->p_index;
end $$;
-- Retain hash/manifest/review/receipt evidence. Never purge pending or uncertain delivery bytes.
create function public.purge_expired_invoice_email_payloads(p_limit integer default 100) returns integer language plpgsql security definer set search_path=public as $$
declare count_purged integer;
begin perform public.communication_require_service();
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Purge limit must be 1 to 100' using errcode='23514';end if;
 with expired as(select p.request_id from public.invoice_email_payloads p join public.invoice_email_requests r on r.id=p.request_id where p.payload_text is not null and p.captured_at<now()-interval '90 days' and (r.state='abandoned' or exists(select 1 from public.invoice_email_outbox_links l join public.communication_outbox o on o.id=l.outbox_id where l.request_id=r.id and o.state in ('accepted','delivered') and o.provider_message_id is not null)) order by p.captured_at limit p_limit for update of p skip locked)
 update public.invoice_email_payloads set payload_text=null,purged_at=now() where request_id in(select request_id from expired);
 get diagnostics count_purged=row_count;return count_purged;
end $$;
create trigger audit_invoice_email_purge after update on public.invoice_email_payloads for each row execute function public.audit_invoice_email();
revoke all on function public.read_invoice_email_attachment(uuid,integer),public.purge_expired_invoice_email_payloads(integer) from public,anon,authenticated,service_role;
grant execute on function public.read_invoice_email_attachment(uuid,integer) to authenticated;
grant execute on function public.purge_expired_invoice_email_payloads(integer) to service_role;

do $$declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('guard_invoice_email_history','audit_invoice_email','invoice_email_context','recover_invoice_email','prepare_invoice_email','invoice_email_capture_context','capture_invoice_email_payload','enqueue_invoice_email','abandon_invoice_email','read_invoice_email_payload','read_frozen_email_payload','start_communication_attempt') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('recover_invoice_email','prepare_invoice_email','enqueue_invoice_email','abandon_invoice_email') then execute format('grant execute on function %s to authenticated',f.signature);
  elsif f.proname in ('invoice_email_capture_context','capture_invoice_email_payload','read_invoice_email_payload','read_frozen_email_payload','start_communication_attempt') then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
-- One bounded maintenance entry point covers both artifact families without purging uncertain sends.
create function public.purge_expired_frozen_email_payloads(p_limit integer default 100) returns jsonb language plpgsql security definer set search_path=public as $$
declare releases integer;invoices integer;
begin perform public.communication_require_service();
 releases:=public.purge_expired_release_email_payloads(p_limit);
 invoices:=public.purge_expired_invoice_email_payloads(p_limit);
 return jsonb_build_object('record_release_payloads',releases,'invoice_payloads',invoices);
end $$;
revoke all on function public.purge_expired_frozen_email_payloads(integer) from public,anon,authenticated,service_role;
grant execute on function public.purge_expired_frozen_email_payloads(integer) to service_role;
