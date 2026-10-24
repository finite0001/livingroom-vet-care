-- Preserve the current source validators (including later hardening) as private cores.
-- Public entry points retain active-staff checks. Only lease-bound service functions use the cores.
alter function public.preview_record_release(uuid,uuid,text,text,jsonb) rename to release_preview_internal;
alter function public.read_record_release(uuid) rename to release_read_internal;
do $$ declare name text;definition text;begin
 foreach name in array array['preview_record_release_v1','preview_record_release_v2','release_preview_internal','release_read_internal'] loop
  select pg_get_functiondef(p.oid) into definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=name;
  if definition is null or position('perform public.clinical_require_staff();' in definition)=0 then raise exception 'Expected release staff wrapper not found: %',name;end if;
  definition:=replace(definition,'perform public.clinical_require_staff();','');
  if name='release_read_internal' then definition:=replace(definition,'public.preview_record_release(','public.release_preview_internal(');end if;
  execute definition;
 end loop;
end $$;
create function public.preview_record_release(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
begin perform public.clinical_require_staff();return public.release_preview_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);end $$;
create function public.read_record_release(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
begin perform public.clinical_require_staff();return public.release_read_internal(p_id);end $$;
revoke all on function public.preview_record_release_v1(uuid,uuid,text,text,jsonb),public.preview_record_release_v2(uuid,uuid,text,text,jsonb),public.release_preview_internal(uuid,uuid,text,text,jsonb),public.release_read_internal(uuid) from public,anon,authenticated,service_role;
revoke all on function public.preview_record_release(uuid,uuid,text,text,jsonb),public.read_record_release(uuid) from public,anon,authenticated,service_role;
grant execute on function public.preview_record_release(uuid,uuid,text,text,jsonb),public.read_record_release(uuid) to authenticated;

create table public.release_email_requests (
 id uuid primary key,release_id uuid not null references public.record_releases(id) on delete restrict,
 actor_id uuid not null references auth.users(id),conversation_id uuid not null references public.conversations(id) on delete restrict,
 client_id uuid not null references public.clients(id) on delete restrict,recipient text not null,
 subject text not null check(length(trim(subject)) between 1 and 500),body text not null check(length(trim(body)) between 1 and 100000),
 release_hash text not null check(release_hash ~ '^[a-f0-9]{64}$'),
 state text not null default 'preparing' check(state in ('preparing','ready','queued','abandoned')),
 created_at timestamptz not null default now()
);
create unique index release_email_unresolved on public.release_email_requests(actor_id,release_id) where state in ('preparing','ready');
create table public.release_email_payloads (
 request_id uuid primary key references public.release_email_requests(id) on delete restrict,
 payload_text text check(payload_text is null or octet_length(payload_text) between 1 and 33554432),purged_at timestamptz,
 check((payload_text is null)=(purged_at is not null)),
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),manifest jsonb not null,
 captured_at timestamptz not null default now()
);
create table public.release_email_outbox_links (
 outbox_id uuid primary key references public.communication_outbox(id) on delete restrict,
 request_id uuid not null unique references public.release_email_requests(id) on delete restrict,
 reviewed_payload_hash text not null,queued_by uuid not null references auth.users(id),queued_at timestamptz not null default now()
);
create function public.guard_release_email_history() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP='UPDATE' and TG_TABLE_NAME='release_email_payloads' then
 if current_user='postgres' and OLD.payload_text is not null and NEW.payload_text is null and NEW.purged_at=now() and (to_jsonb(NEW)-array['payload_text','purged_at'])=(to_jsonb(OLD)-array['payload_text','purged_at']) and OLD.captured_at<now()-interval '90 days' then return NEW;end if;
 end if;
 if TG_OP='UPDATE' and TG_TABLE_NAME='release_email_requests' then
 if (to_jsonb(NEW)-'state')=(to_jsonb(OLD)-'state') and ((OLD.state='preparing' and NEW.state in ('ready','abandoned')) or (OLD.state='ready' and NEW.state in ('queued','abandoned'))) then return NEW;end if;
 end if;
 raise exception 'Release email history is immutable' using errcode='23514';
end $$;
do $$ declare t text;begin
 foreach t in array array['release_email_requests','release_email_payloads','release_email_outbox_links'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger release_email_immutable before update or delete on public.%I for each row execute function public.guard_release_email_history()',t);
 end loop;
end $$;
-- No direct reads of payload bytes, even with a staff or service PostgREST client.
create function public.audit_release_email() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.audit_logs(user_id,action,table_name,record_id,new_data) values(auth.uid(),TG_OP,TG_TABLE_NAME,case when TG_TABLE_NAME='release_email_requests' then (to_jsonb(NEW)->>'id')::uuid else (to_jsonb(NEW)->>'request_id')::uuid end,case when TG_TABLE_NAME='release_email_payloads' then to_jsonb(NEW)-'payload_text' else to_jsonb(NEW)-array['body','subject'] end);return NEW;
end $$;
create trigger audit_release_email_request after insert or update on public.release_email_requests for each row execute function public.audit_release_email();
create trigger audit_release_email_payload after insert on public.release_email_payloads for each row execute function public.audit_release_email();
create trigger audit_release_email_link after insert on public.release_email_outbox_links for each row execute function public.audit_release_email();

-- Private core: every service call supplies an immutable request, never an arbitrary recipient.
create function public.release_email_context(p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.release_email_requests;b jsonb;
begin
 select * into r from public.release_email_requests where id=p_request_id for share;
 if not found or r.state='abandoned' or not public.is_active_staff(r.actor_id) then raise exception 'Release email actor or request is unavailable' using errcode='42501';end if;
 perform 1 from public.record_release_policy where id and enabled and accepted_at<=now() and accepted_schema_version>=(select (snapshot->>'schema_version')::integer from public.record_releases where id=r.release_id) for share;
 if not found then raise exception 'Clinical release acceptance is not active' using errcode='42501';end if;
 b:=public.release_read_internal(r.release_id);
 if (b->>'eligible')::boolean is distinct from true or b#>>'{release,source_hash}' is distinct from r.release_hash or b#>>'{release,client_id}' is distinct from r.client_id::text or b#>>'{release,channel}' is distinct from 'EMAIL' or b#>>'{release,recipient}' is distinct from r.recipient
 or not exists(select 1 from public.conversations where id=r.conversation_id and client_id=r.client_id)
 or public.communication_is_suppressed('EMAIL',r.recipient,r.client_id) then raise exception 'Release, household or recipient is no longer eligible' using errcode='42501';end if;
 return b;
end $$;
create function public.recover_release_email(p_release_id uuid,p_request_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.release_email_requests;p public.release_email_payloads;o public.communication_outbox;
begin
 select * into r from public.release_email_requests where actor_id=actor and release_id=p_release_id and ((p_request_id is null and state<>'abandoned') or id=p_request_id) order by created_at desc,id limit 1;
 if not found then return null;end if;
 select * into p from public.release_email_payloads where request_id=r.id;
 select box.* into o from public.communication_outbox box join public.release_email_outbox_links l on l.outbox_id=box.id where l.request_id=r.id;
 return jsonb_build_object('request',to_jsonb(r),'payload_hash',p.payload_hash,'manifest',p.manifest,
 'purged_at',p.purged_at,'report_html',case when p.payload_text is not null then convert_from(decode((p.payload_text::jsonb)#>>'{attachments,0,content}','base64'),'UTF8') end,
 'receipt',case when o.id is not null then jsonb_build_object('outbox_id',o.id,'message_id',o.message_id,'state',o.state,'queued',true,'delivered',o.state='delivered') end);
end $$;
create function public.prepare_release_email(p_request_id uuid,p_release_id uuid,p_conversation_id uuid,p_subject text,p_body text,p_release_hash text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.release_email_requests;b jsonb;client uuid;recipient text;
begin
 if p_request_id is null or p_release_hash is null or p_release_hash !~ '^[a-f0-9]{64}$' or p_subject is null or length(trim(p_subject)) not between 1 and 500 or p_body is null or length(trim(p_body)) not between 1 and 100000 then raise exception 'Stable request ID and complete email intent are required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,2200));
 select * into r from public.release_email_requests where id=p_request_id;
 if found then
  if r.actor_id<>actor or row(r.release_id,r.conversation_id,r.subject,r.body,r.release_hash) is distinct from row(p_release_id,p_conversation_id,p_subject,p_body,p_release_hash) or r.state='abandoned' then raise exception 'Release email request already used or abandoned' using errcode='23505';end if;
  return public.recover_release_email(p_release_id,p_request_id);
 end if;
 select client_id into client from public.conversations where id=p_conversation_id;
 select record.recipient into recipient from public.record_releases record where id=p_release_id and channel='EMAIL';
 b:=public.authorize_record_release(p_release_id,client,'EMAIL',recipient);
 if b#>>'{release,source_hash}' is distinct from p_release_hash or public.communication_is_suppressed('EMAIL',recipient,client) then raise exception 'Reviewed release or recipient is no longer eligible' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_release_id::text,2200));
 if exists(select 1 from public.release_email_requests where actor_id=actor and release_id=p_release_id and state in ('preparing','ready')) then raise exception 'Recover or abandon the unresolved release email first' using errcode='23505';end if;
 insert into public.release_email_requests(id,release_id,actor_id,conversation_id,client_id,recipient,subject,body,release_hash) values(p_request_id,p_release_id,actor,p_conversation_id,client,recipient,p_subject,p_body,p_release_hash);
 return public.recover_release_email(p_release_id,p_request_id);
end $$;
create function public.release_email_capture_context(p_request_id uuid,p_actor_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.release_email_requests;
begin perform public.communication_require_service();select * into r from public.release_email_requests where id=p_request_id;
 if not found or r.actor_id is distinct from p_actor_id then raise exception 'Request ownership mismatch' using errcode='42501';end if;
 return jsonb_build_object('request',to_jsonb(r),'bundle',public.release_email_context(p_request_id),'captured',exists(select 1 from public.release_email_payloads where request_id=p_request_id));end $$;
create function public.capture_release_email_payload(p_request_id uuid,p_actor_id uuid,p_payload_text text) returns void language plpgsql security definer set search_path=public as $$
declare r public.release_email_requests;existing public.release_email_payloads;b jsonb;payload jsonb;a jsonb;doc jsonb;decoded bytea;manifest jsonb:='[]';i integer:=0;hash text;filename text;
begin
 perform public.communication_require_service();
 if p_payload_text is null or octet_length(p_payload_text) not between 1 and 33554432 then raise exception 'Encoded email exceeds application limits' using errcode='23514';end if;
 select * into r from public.release_email_requests where id=p_request_id for update;
 if not found or r.actor_id is distinct from p_actor_id or r.state='abandoned' or not public.is_active_staff(r.actor_id) then raise exception 'Request ownership mismatch or abandoned' using errcode='42501';end if;
 b:=public.release_email_context(p_request_id);
 hash:=encode(sha256(convert_to(p_payload_text,'UTF8')),'hex');
 select * into existing from public.release_email_payloads where request_id=p_request_id;
 if found then if existing.payload_text is distinct from p_payload_text then raise exception 'Captured provider payload is immutable' using errcode='23505';end if;return;end if;
 b:=public.release_email_context(p_request_id);payload:=p_payload_text::jsonb;
 if jsonb_typeof(payload)<>'object' or payload-array['from','reply_to','to','subject','text','attachments']<>'{}' or payload->'to' is distinct from jsonb_build_array(r.recipient) or payload->>'subject' is distinct from r.subject or payload->>'text' is distinct from r.body or public.communication_recipient('EMAIL',payload->>'reply_to') is null or jsonb_typeof(payload->'from') is distinct from 'string' or length(payload->>'from') not between 1 and 500 or public.communication_recipient('EMAIL',coalesce(substring(payload->>'from' from '<([^<>]+)>$'),payload->>'from')) is null then raise exception 'Provider payload differs from reviewed email intent' using errcode='23514';end if;
 if jsonb_typeof(payload->'attachments') is distinct from 'array' then raise exception 'Frozen attachments are required' using errcode='23514';end if;
 if jsonb_array_length(payload->'attachments')<>jsonb_array_length(b#>'{release,snapshot,attachments}')+1 or jsonb_array_length(payload->'attachments')>25 then raise exception 'Attachment manifest must exactly match the release and report within 25 files' using errcode='23514';end if;
 for a in select value from jsonb_array_elements(payload->'attachments') loop
  if jsonb_typeof(a)<>'object' or a-array['filename','content_type','content']<>'{}' or jsonb_typeof(a->'filename') is distinct from 'string' or jsonb_typeof(a->'content') is distinct from 'string' or a->>'filename' ~ '[[:cntrl:]/\\]' or length(a->>'filename') not between 1 and 180 or a->>'content' !~ '^[A-Za-z0-9+/]*={0,2}$' then raise exception 'Attachment metadata is invalid' using errcode='23514';end if;
  decoded:=decode(a->>'content','base64');
  if octet_length(decoded)<1 then raise exception 'Empty attachment rejected' using errcode='23514';end if;
  if i=0 then
   if a->>'filename' is distinct from 'medical-records-'||r.release_id::text||'.html' or a->>'content_type' is distinct from 'text/html' then raise exception 'Rendered report must be a truthful HTML attachment' using errcode='23514';end if;
   perform convert_from(decoded,'UTF8');
  else
   doc:=(b#>'{release,snapshot,attachments}')->(i-1);
   filename:=i::text||'-'||coalesce(nullif(left(trim(both ' .' from regexp_replace(regexp_replace(doc->>'file_name','\.[^.]*$',''),'[^A-Za-z0-9 _.-]','_','g')),100),''),'record')||case doc->>'mime_type' when 'application/pdf' then '.pdf' when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else null end;
   if a->>'filename' is distinct from filename or a->>'content_type' is distinct from doc->>'mime_type' or octet_length(decoded)::bigint is distinct from (doc->>'file_size')::bigint then raise exception 'Original attachment metadata differs from release' using errcode='23514';end if;
  end if;
  manifest:=manifest||jsonb_build_array(jsonb_build_object('filename',a->>'filename','mime_type',a->>'content_type','file_size',octet_length(decoded),'sha256',encode(sha256(decoded),'hex'),'document_id',case when i>0 then doc->'id' else null end));i:=i+1;
 end loop;
 insert into public.release_email_payloads(request_id,payload_text,payload_hash,manifest) values(p_request_id,p_payload_text,hash,manifest);
 update public.release_email_requests set state='ready' where id=p_request_id;
exception when invalid_text_representation or character_not_in_repertoire then raise exception 'Malformed frozen email payload' using errcode='23514';
end $$;
create function public.enqueue_release_email(p_request_id uuid,p_reviewed_payload_hash text,p_attest boolean) returns public.communication_outbox language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.release_email_requests;p public.release_email_payloads;l public.release_email_outbox_links;o public.communication_outbox;
begin
 if p_attest is distinct from true then raise exception 'Review the exact report, originals and message before queueing' using errcode='23514';end if;
 select * into r from public.release_email_requests where id=p_request_id for update;
 select * into p from public.release_email_payloads where request_id=p_request_id;
 if r.id is null or r.actor_id<>actor or r.state='abandoned' or p.request_id is null or p.payload_hash is distinct from p_reviewed_payload_hash then raise exception 'Prepared release email or reviewed payload does not match' using errcode='42501';end if;
 select * into l from public.release_email_outbox_links where request_id=p_request_id;
 if found then select * into o from public.communication_outbox where id=l.outbox_id;return o;end if;
 perform public.release_email_context(p_request_id);
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,914));
 if exists(select 1 from public.communication_outbox where request_id=p_request_id) then raise exception 'Request ID already belongs to another queue workflow' using errcode='23505';end if;
 o:=public.enqueue_prepared_communication_internal(actor,r.id,r.conversation_id,'EMAIL',r.recipient,r.subject,r.body,'{}');
 insert into public.release_email_outbox_links(outbox_id,request_id,reviewed_payload_hash,queued_by) values(o.id,r.id,p.payload_hash,actor);
 update public.release_email_requests set state='queued' where id=r.id;
 return o;
end $$;
create function public.abandon_release_email(p_request_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.release_email_requests;
begin select * into r from public.release_email_requests where id=p_request_id for update;
 if not found or r.actor_id<>actor or r.state='queued' then raise exception 'Only own unqueued preparation can be abandoned' using errcode='42501';end if;
 if r.state<>'abandoned' then update public.release_email_requests set state='abandoned' where id=p_request_id;end if;end $$;

create function public.read_release_email_payload(p_outbox_id uuid,p_lease_token uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.communication_outbox;l public.release_email_outbox_links;p public.release_email_payloads;
begin perform public.communication_require_service();select * into o from public.communication_outbox where id=p_outbox_id;
 if not found or o.state<>'claimed' or o.lease_token is distinct from p_lease_token or o.lease_expires_at<=now() or o.attempt_started_at is not null then raise exception 'Outbox lease unavailable' using errcode='40001';end if;
 select * into l from public.release_email_outbox_links where outbox_id=o.id;
 if not found then return null;end if;
 perform public.release_email_context(l.request_id);
 select * into p from public.release_email_payloads where request_id=l.request_id;
 if not found or p.payload_text is null or l.reviewed_payload_hash<>p.payload_hash then raise exception 'Frozen release payload unavailable' using errcode='23514';end if;
 return jsonb_build_object('payload_text',p.payload_text,'payload_hash',p.payload_hash);
end $$;
alter function public.start_communication_attempt(uuid,uuid,jsonb) rename to start_communication_attempt_without_release_guard;
revoke all on function public.start_communication_attempt_without_release_guard(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.start_communication_attempt(p_id uuid,p_lease_token uuid,p_provider_config jsonb) returns public.communication_outbox language plpgsql security definer set search_path=public as $$
declare o public.communication_outbox;l public.release_email_outbox_links;p public.release_email_payloads;payload jsonb;valid boolean:=true;
begin perform public.communication_require_service();select * into o from public.communication_outbox where id=p_id for update;
 if not found or o.state<>'claimed' or o.lease_token is distinct from p_lease_token or o.lease_expires_at<=now() or o.attempt_started_at is not null then raise exception 'Outbox lease unavailable' using errcode='40001';end if;
 select * into l from public.release_email_outbox_links where outbox_id=o.id;
 if found then
  begin
   perform public.release_email_context(l.request_id);
   select * into p from public.release_email_payloads where request_id=l.request_id;
   payload:=p.payload_text::jsonb;
   valid:=p.request_id is not null and p.payload_hash=l.reviewed_payload_hash and p.payload_hash=encode(sha256(convert_to(p.payload_text,'UTF8')),'hex') and payload->>'from'=p_provider_config->>'from' and payload->>'reply_to'=p_provider_config->>'reply_to';
  exception when sqlstate '23514' or sqlstate '42501' then valid:=false;end;
  if valid is distinct from true then update public.communication_outbox set state='failed',last_error='release_source_or_payload_ineligible',lease_token=null,lease_expires_at=null,updated_at=now() where id=o.id returning * into o;return o;end if;
 end if;
 return public.start_communication_attempt_without_release_guard(p_id,p_lease_token,p_provider_config);
end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('guard_release_email_history','audit_release_email','release_email_context','recover_release_email','prepare_release_email','release_email_capture_context','capture_release_email_payload','enqueue_release_email','abandon_release_email','read_release_email_payload','start_communication_attempt') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('recover_release_email','prepare_release_email','enqueue_release_email','abandon_release_email') then execute format('grant execute on function %s to authenticated',f.signature);
  elsif f.proname in ('release_email_capture_context','capture_release_email_payload','read_release_email_payload','start_communication_attempt') then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;

create function public.read_release_email_attachment(p_request_id uuid,p_index integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();p public.release_email_payloads;
begin
 if p_index is null or p_index not between 0 and 24 or not exists(select 1 from public.release_email_requests where id=p_request_id and actor_id=actor) then raise exception 'Attachment request unavailable' using errcode='42501';end if;
 select * into p from public.release_email_payloads where request_id=p_request_id;
 if p.payload_text is null or p_index>=jsonb_array_length(p.manifest) then raise exception 'Frozen attachment unavailable or expired' using errcode='23514';end if;
 return (p.payload_text::jsonb->'attachments')->p_index;
end $$;
-- Retain hash/manifest/review/receipt evidence. Never purge pending or uncertain delivery bytes.
create function public.purge_expired_release_email_payloads(p_limit integer default 100) returns integer language plpgsql security definer set search_path=public as $$
declare count_purged integer;
begin perform public.communication_require_service();
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Purge limit must be 1 to 100' using errcode='23514';end if;
 with expired as(select p.request_id from public.release_email_payloads p join public.release_email_requests r on r.id=p.request_id where p.payload_text is not null and p.captured_at<now()-interval '90 days' and (r.state='abandoned' or exists(select 1 from public.release_email_outbox_links l join public.communication_outbox o on o.id=l.outbox_id where l.request_id=r.id and o.state in ('accepted','delivered') and o.provider_message_id is not null)) order by p.captured_at limit p_limit for update of p skip locked)
 update public.release_email_payloads set payload_text=null,purged_at=now() where request_id in(select request_id from expired);
 get diagnostics count_purged=row_count;return count_purged;
end $$;
create trigger audit_release_email_purge after update on public.release_email_payloads for each row execute function public.audit_release_email();
revoke all on function public.read_release_email_attachment(uuid,integer),public.purge_expired_release_email_payloads(integer) from public,anon,authenticated,service_role;
grant execute on function public.read_release_email_attachment(uuid,integer) to authenticated;
grant execute on function public.purge_expired_release_email_payloads(integer) to service_role;
