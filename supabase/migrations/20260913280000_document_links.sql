-- Reviewed, expiring capabilities. Usable tokens and materialized URLs are never persisted.
create function public.document_link_source(p_family text,p_source_id uuid,p_client_id uuid) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare c public.clients;i public.billing_invoices;b jsonb;doc jsonb;phone text;hash text;
begin
 select * into c from public.clients where id=p_client_id for share;
 if not found then raise exception 'Source unavailable' using errcode='42501';end if;
 phone:=public.communication_recipient('SMS',c.primary_phone);
 if phone is null or public.communication_is_suppressed('SMS',phone,c.id) then raise exception 'SMS recipient unavailable' using errcode='42501';end if;
 if p_family='invoice' then
  select * into i from public.billing_invoices where id=p_source_id and client_id=c.id for share;
  if not found or i.status<>'issued' then raise exception 'Issued invoice unavailable' using errcode='42501';end if;
  doc:=public.invoice_document_internal(i.id,c.id);
  hash:=encode(digest(jsonb_build_object('document',doc-'rendered_at','client_version',c.version,'recipient',phone)::text,'sha256'),'hex');
  b:=jsonb_build_object('document',doc);
 elsif p_family='record_release' then
  b:=public.release_read_internal(p_source_id);
  if (b->>'eligible')::boolean is distinct from true or b#>>'{release,client_id}' is distinct from c.id::text or b#>>'{release,channel}' is distinct from 'SMS' or b#>>'{release,recipient}' is distinct from phone then raise exception 'SMS release unavailable' using errcode='42501';end if;
  perform 1 from public.record_release_policy where id and enabled and accepted_at<=now() and accepted_schema_version>=(b#>>'{release,snapshot,schema_version}')::integer for share;
  if not found then raise exception 'Clinical release acceptance unavailable' using errcode='42501';end if;
  hash:=b#>>'{release,source_hash}';
 else raise exception 'Unsupported source family' using errcode='23514';end if;
 return jsonb_build_object('family',p_family,'source_id',p_source_id,'client_id',c.id,'recipient',phone,'source_hash',hash,'bundle',b,'summary',jsonb_build_object('family',p_family,'household_name',c.full_name));
end $$;
create function public.preview_document_link(p_family text,p_source_id uuid,p_client_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
begin perform public.clinical_require_staff();return public.document_link_source(p_family,p_source_id,p_client_id)-'bundle';end $$;
create table public.document_link_grants (
 id uuid primary key,family text not null check(family in ('invoice','record_release')),source_id uuid not null,
 client_id uuid not null references public.clients(id) on delete restrict,actor_id uuid not null references auth.users(id),
 conversation_id uuid not null references public.conversations(id) on delete restrict,recipient text not null,
 source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),source_bundle jsonb not null,
 message_template text not null check(length(message_template) between 1 and 1200 and (length(message_template)-length(replace(message_template,'{{document_link}}','')))=17),
 origin text not null check(origin ~ '^https://[a-z0-9.-]+(:[0-9]+)?$' or origin ~ '^http://(127\.0\.0\.1|localhost):[0-9]+$'),
 key_version text not null check(key_version ~ '^[A-Za-z0-9_-]{1,40}$'),capability_context text not null,
 expires_at timestamptz not null check(isfinite(expires_at)),created_at timestamptz not null default now(),
 state text not null default 'preparing' check(state in ('preparing','captured','reviewed','revoked'))
);
create unique index document_link_unresolved on public.document_link_grants(actor_id,family,source_id) where state in ('preparing','captured');
create table public.document_link_payloads (
 grant_id uuid primary key references public.document_link_grants(id) on delete restrict,
 payload_text text not null check(octet_length(payload_text) between 1 and 33554432),
 artifact_hash text not null check(artifact_hash ~ '^[a-f0-9]{64}$'),token_hash text not null check(token_hash ~ '^[a-f0-9]{64}$'),
 message_hash text not null check(message_hash ~ '^[a-f0-9]{64}$'),manifest jsonb not null,captured_at timestamptz not null default now()
);
create table public.document_link_events (
 id uuid primary key default gen_random_uuid(),grant_id uuid not null references public.document_link_grants(id) on delete restrict,
 actor_id uuid not null references auth.users(id),kind text not null check(kind in ('reviewed','revoked')),reason text,
 artifact_hash text,message_hash text,created_at timestamptz not null default now()
);
create table public.document_link_access_budget (
 grant_id uuid primary key references public.document_link_grants(id) on delete restrict,used integer not null default 0 check(used between 0 and 200)
);
create function public.guard_document_link_history() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP='UPDATE' and TG_TABLE_NAME='document_link_grants' and (to_jsonb(NEW)-'state')=(to_jsonb(OLD)-'state') and (((to_jsonb(OLD)->>'state')='preparing' and (to_jsonb(NEW)->>'state') in ('captured','revoked')) or ((to_jsonb(OLD)->>'state')='captured' and (to_jsonb(NEW)->>'state') in ('reviewed','revoked')) or ((to_jsonb(OLD)->>'state')='reviewed' and (to_jsonb(NEW)->>'state')='revoked')) then return NEW;end if;
 raise exception 'Document link history is immutable' using errcode='23514';
end $$;
create function public.audit_document_link() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.audit_logs(user_id,action,table_name,record_id,new_data) values(auth.uid(),TG_OP,TG_TABLE_NAME,coalesce((to_jsonb(NEW)->>'grant_id')::uuid,(to_jsonb(NEW)->>'id')::uuid),to_jsonb(NEW)-array['payload_text','source_bundle','message_template','capability_context']);return NEW;
end $$;
do $$declare t text;begin
 foreach t in array array['document_link_grants','document_link_payloads','document_link_events','document_link_access_budget'] loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  if t<>'document_link_access_budget' then
   execute format('create trigger document_link_immutable before update or delete on public.%I for each row execute function public.guard_document_link_history()',t);
   execute format('create trigger document_link_audit after insert or update on public.%I for each row execute function public.audit_document_link()',t);
  end if;
 end loop;
end $$;
create function public.document_link_current(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare g public.document_link_grants;s jsonb;
begin
 select * into g from public.document_link_grants where id=p_id for share;
 if not found or g.state='revoked' or g.expires_at<=clock_timestamp() or not public.is_active_staff(g.actor_id) then raise exception 'Document link unavailable' using errcode='42501';end if;
 s:=public.document_link_source(g.family,g.source_id,g.client_id);
 if s->>'source_hash' is distinct from g.source_hash or s->>'recipient' is distinct from g.recipient or not exists(select 1 from public.conversations where id=g.conversation_id and client_id=g.client_id) then raise exception 'Document link source changed' using errcode='42501';end if;
 return s;
end $$;
create function public.recover_document_link(p_family text,p_source_id uuid,p_request_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();g public.document_link_grants;p public.document_link_payloads;events jsonb;
begin
 select * into g from public.document_link_grants where actor_id=actor and family=p_family and source_id=p_source_id and (p_request_id is null or id=p_request_id) order by created_at desc,id limit 1;
 if not found then return null;end if;
 select * into p from public.document_link_payloads where grant_id=g.id;
 select coalesce(jsonb_agg(to_jsonb(e) order by created_at,id),'[]') into events from public.document_link_events e where grant_id=g.id;
 return jsonb_build_object('grant',to_jsonb(g)-'source_bundle','artifact_hash',p.artifact_hash,'message_hash',p.message_hash,'manifest',p.manifest,'report_html',case when p.payload_text is not null then convert_from(decode((p.payload_text::jsonb)#>>'{artifacts,0,content}','base64'),'UTF8') end,'events',events,'receipt',null);
end $$;
create function public.prepare_document_link(p_request_id uuid,p_family text,p_source_id uuid,p_client_id uuid,p_conversation_id uuid,p_recipient text,p_source_hash text,p_expires_at timestamptz,p_message_template text,p_origin text,p_key_version text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();g public.document_link_grants;s jsonb;context text;
begin
 perform pg_advisory_xact_lock(hashtextextended('document-link:'||p_request_id::text,0));
 select * into g from public.document_link_grants where id=p_request_id for update;
 if found then
  if g.actor_id<>actor or g.family<>p_family or g.source_id<>p_source_id or g.client_id<>p_client_id or g.conversation_id<>p_conversation_id or g.recipient<>p_recipient or g.source_hash<>p_source_hash or g.expires_at<>p_expires_at or g.message_template<>p_message_template or g.origin<>p_origin or g.key_version<>p_key_version then raise exception 'Immutable document link intent differs' using errcode='23505';end if;
  return public.recover_document_link(g.family,g.source_id,g.id);
 end if;
 if p_expires_at is null or not isfinite(p_expires_at) or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '7 days' then raise exception 'Expiry must be within seven days' using errcode='23514';end if;
 s:=public.document_link_source(p_family,p_source_id,p_client_id);
 if s->>'source_hash' is distinct from p_source_hash or s->>'recipient' is distinct from p_recipient or not exists(select 1 from public.conversations where id=p_conversation_id and client_id=p_client_id) then raise exception 'Source or recipient differs' using errcode='42501';end if;
 context:=jsonb_build_object('domain','lrv-document-link/v1','id',p_request_id,'family',p_family,'source_id',p_source_id,'client_id',p_client_id,'actor_id',actor,'recipient',p_recipient,'source_hash',p_source_hash,'message_template',p_message_template,'origin',p_origin,'key_version',p_key_version,'expires_at',to_char(p_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_at',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text;
 insert into public.document_link_grants(id,family,source_id,client_id,actor_id,conversation_id,recipient,source_hash,source_bundle,message_template,origin,key_version,capability_context,expires_at) values(p_request_id,p_family,p_source_id,p_client_id,actor,p_conversation_id,p_recipient,p_source_hash,s->'bundle',p_message_template,p_origin,p_key_version,context,p_expires_at);
 insert into public.document_link_access_budget(grant_id) values(p_request_id);
 return public.recover_document_link(p_family,p_source_id,p_request_id);
end $$;
create function public.document_link_capture_context(p_id uuid,p_actor_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare g public.document_link_grants;
begin select * into g from public.document_link_grants where id=p_id for share;if not found or g.actor_id<>p_actor_id then raise exception 'Unavailable' using errcode='42501';end if;
 if not exists(select 1 from public.document_link_payloads where grant_id=g.id) then perform public.document_link_current(g.id);end if;
 return jsonb_build_object('grant',to_jsonb(g),'captured',exists(select 1 from public.document_link_payloads where grant_id=g.id));end $$;
create function public.capture_document_link(p_id uuid,p_actor_id uuid,p_payload_text text,p_token_hash text,p_message_hash text) returns void language plpgsql security definer set search_path=public,extensions as $$
declare g public.document_link_grants;old public.document_link_payloads;payload jsonb;a jsonb;d jsonb;bytes bytea;manifest jsonb:='[]';n integer:=0;expected_count integer;
begin
 select * into g from public.document_link_grants where id=p_id for update;
 if not found or g.actor_id<>p_actor_id then raise exception 'Unavailable' using errcode='42501';end if;
 select * into old from public.document_link_payloads where grant_id=p_id;
 if found then
  if old.payload_text<>p_payload_text or old.token_hash<>p_token_hash or old.message_hash<>p_message_hash then raise exception 'Captured bytes differ' using errcode='23505';end if;return;
 end if;
 perform public.document_link_current(p_id);
 if g.state<>'preparing' or p_payload_text is null or octet_length(p_payload_text)>33554432 or p_token_hash !~ '^[a-f0-9]{64}$' or p_message_hash !~ '^[a-f0-9]{64}$' then raise exception 'Capture invalid' using errcode='23514';end if;
 payload:=p_payload_text::jsonb;
 expected_count:=case when g.family='invoice' then 1 else 1+jsonb_array_length(g.source_bundle#>'{release,snapshot,attachments}') end;
 if jsonb_typeof(payload) is distinct from 'object' or (select count(*) from jsonb_object_keys(payload))<>1 or jsonb_typeof(payload->'artifacts') is distinct from 'array' or jsonb_array_length(payload->'artifacts')<>expected_count or expected_count>25 then raise exception 'Artifact count invalid' using errcode='23514';end if;
 for a in select value from jsonb_array_elements(payload->'artifacts') loop
  if jsonb_typeof(a) is distinct from 'object' or (select count(*) from jsonb_object_keys(a))<>4 or jsonb_typeof(a->'content') is distinct from 'string' or jsonb_typeof(a->'mime_type') is distinct from 'string' or jsonb_typeof(a->'filename') is distinct from 'string' or a->>'filename' !~ '^[A-Za-z0-9 _.-]{1,180}$' then raise exception 'Artifact invalid' using errcode='23514';end if;
  bytes:=decode(a->>'content','base64');
  if octet_length(bytes)<1 then raise exception 'Empty artifact' using errcode='23514';end if;
  if n=0 then
   if a->>'mime_type'<>'text/html' or a->>'document_id' is not null or octet_length(bytes)>20971520 then raise exception 'Report invalid' using errcode='23514';end if;
  else
   d:=g.source_bundle#>array['release','snapshot','attachments',(n-1)::text];
   if a->>'document_id' is distinct from d->>'id' or a->>'mime_type' is distinct from d->>'mime_type' or octet_length(bytes)<>(d->>'file_size')::bigint or octet_length(bytes)>20971520 then raise exception 'Original differs' using errcode='23514';end if;
   if (a->>'mime_type'='application/pdf' and substring(bytes from 1 for 5)<>convert_to('%PDF-','UTF8')) or (a->>'mime_type'='image/png' and substring(bytes from 1 for 8)<>decode('89504e470d0a1a0a','hex')) or (a->>'mime_type'='image/jpeg' and substring(bytes from 1 for 3)<>decode('ffd8ff','hex')) or a->>'mime_type' not in ('application/pdf','image/png','image/jpeg') then raise exception 'Original signature differs' using errcode='23514';end if;
  end if;
  manifest:=manifest||jsonb_build_array(jsonb_build_object('index',n,'filename',a->>'filename','mime_type',a->>'mime_type','file_size',octet_length(bytes),'sha256',encode(digest(bytes,'sha256'),'hex')));n:=n+1;
 end loop;
 insert into public.document_link_payloads(grant_id,payload_text,artifact_hash,token_hash,message_hash,manifest) values(g.id,p_payload_text,encode(digest(p_payload_text,'sha256'),'hex'),p_token_hash,p_message_hash,manifest);
 update public.document_link_grants set state='captured' where id=g.id;
end $$;
create function public.attest_document_link(p_request_id uuid,p_reviewed_artifact_hash text,p_reviewed_message_hash text,p_attest boolean) returns void language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();g public.document_link_grants;p public.document_link_payloads;
begin
 select * into g from public.document_link_grants where id=p_request_id for update;select * into p from public.document_link_payloads where grant_id=p_request_id;
 if g.actor_id is distinct from actor or g.state not in ('captured','reviewed') or p_attest is distinct from true or p.artifact_hash is distinct from p_reviewed_artifact_hash or p.message_hash is distinct from p_reviewed_message_hash then raise exception 'Exact review required' using errcode='42501';end if;
 if g.state='reviewed' then return;end if;perform public.document_link_current(g.id);
 insert into public.document_link_events(grant_id,actor_id,kind,artifact_hash,message_hash) values(g.id,actor,'reviewed',p.artifact_hash,p.message_hash);update public.document_link_grants set state='reviewed' where id=g.id;
end $$;
create function public.revoke_document_link(p_request_id uuid,p_reason text) returns void language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();g public.document_link_grants;
begin select * into g from public.document_link_grants where id=p_request_id for update;
 if not found or g.actor_id<>actor then raise exception 'Unavailable' using errcode='42501';end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Reason required' using errcode='23514';end if;
 if g.state='revoked' then return;end if;
 insert into public.document_link_events(grant_id,actor_id,kind,reason) values(g.id,actor,'revoked',trim(p_reason));update public.document_link_grants set state='revoked' where id=g.id;end $$;
create function public.document_link_access_context(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare g public.document_link_grants;p public.document_link_payloads;
begin select * into g from public.document_link_grants where id=p_id;select * into p from public.document_link_payloads where grant_id=p_id;
 if g.id is null or p.grant_id is null then raise exception 'Unavailable' using errcode='42501';end if;
 return jsonb_build_object('id',g.id,'key_version',g.key_version,'origin',g.origin,'capability_context',g.capability_context,'token_hash',p.token_hash);end $$;
create function public.retrieve_document_link(p_id uuid,p_token_hash text,p_artifact_index integer default null) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare g public.document_link_grants;p public.document_link_payloads;a jsonb;m jsonb;bytes bytea;used integer;
begin
 select * into g from public.document_link_grants where id=p_id for update;select * into p from public.document_link_payloads where grant_id=p_id;
 if g.id is null or g.state<>'reviewed' or p.token_hash is distinct from p_token_hash then raise exception 'Unavailable' using errcode='42501';end if;
 perform public.document_link_current(g.id);
 if encode(digest(p.payload_text,'sha256'),'hex')<>p.artifact_hash then raise exception 'Unavailable' using errcode='42501';end if;
 if p_artifact_index is not null then
  if p_artifact_index<0 or p_artifact_index>=jsonb_array_length(p.manifest) then raise exception 'Unavailable' using errcode='42501';end if;
  a:=(p.payload_text::jsonb)->'artifacts'->p_artifact_index;m:=p.manifest->p_artifact_index;bytes:=decode(a->>'content','base64');
  if octet_length(bytes)<>(m->>'file_size')::bigint or encode(digest(bytes,'sha256'),'hex')<>m->>'sha256' then raise exception 'Unavailable' using errcode='42501';end if;
 end if;
 update public.document_link_access_budget set used=document_link_access_budget.used+1 where grant_id=g.id and document_link_access_budget.used<200 returning document_link_access_budget.used into used;
 if used is null then raise exception 'Unavailable' using errcode='42501';end if;
 if p_artifact_index is null then return jsonb_build_object('grant_id',g.id,'expires_at',g.expires_at,'manifest',p.manifest);end if;
 return jsonb_build_object('filename',m->>'filename','mime_type',m->>'mime_type','file_size',m->'file_size','sha256',m->>'sha256','content',a->>'content');
end $$;
create function public.read_document_link_artifact(p_request_id uuid,p_index integer) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare actor uuid:=public.clinical_require_staff();g public.document_link_grants;p public.document_link_payloads;a jsonb;m jsonb;bytes bytea;
begin
 select * into g from public.document_link_grants where id=p_request_id;
 select * into p from public.document_link_payloads where grant_id=p_request_id;
 if g.actor_id is distinct from actor or p.grant_id is null or p_index is null or p_index<0 or p_index>=jsonb_array_length(p.manifest) then raise exception 'Unavailable' using errcode='42501';end if;
 if encode(digest(p.payload_text,'sha256'),'hex')<>p.artifact_hash then raise exception 'Unavailable' using errcode='42501';end if;
 a:=(p.payload_text::jsonb)->'artifacts'->p_index;m:=p.manifest->p_index;bytes:=decode(a->>'content','base64');
 if octet_length(bytes)<>(m->>'file_size')::bigint or encode(digest(bytes,'sha256'),'hex')<>m->>'sha256' then raise exception 'Unavailable' using errcode='42501';end if;
 return jsonb_build_object('filename',m->>'filename','mime_type',m->>'mime_type','file_size',m->'file_size','sha256',m->>'sha256','content',a->>'content');
end $$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('read_document_link_artifact','document_link_source','preview_document_link','guard_document_link_history','audit_document_link','document_link_current','recover_document_link','prepare_document_link','document_link_capture_context','capture_document_link','attest_document_link','revoke_document_link','document_link_access_context','retrieve_document_link') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('read_document_link_artifact','preview_document_link','recover_document_link','prepare_document_link','attest_document_link','revoke_document_link') then execute format('grant execute on function %s to authenticated',f.signature);
  elsif f.proname in ('document_link_capture_context','capture_document_link','document_link_access_context','retrieve_document_link') then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
