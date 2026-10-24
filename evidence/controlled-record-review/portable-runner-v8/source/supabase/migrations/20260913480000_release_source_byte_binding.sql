-- Bind schema5 selected source originals to the immutable4100/4200 digest.
-- Earlier frozen schemas retain their original byte contract; no retrospective claim.
create function public.verify_release_source_original_v5(p_snapshot jsonb,p_document jsonb,p_bytes bytea) returns void
language plpgsql security definer set search_path=public as $$
declare expected jsonb:='[]';r jsonb;family text;rows jsonb;reference jsonb;actual jsonb;
begin
 if p_snapshot->>'schema_version' is distinct from '5' then return;end if;
 if jsonb_typeof(p_snapshot->'lab_reports') is distinct from 'array' or jsonb_typeof(p_snapshot->'external_records') is distinct from 'array' then raise exception 'Missing selected source provenance' using errcode='23514';end if;
 foreach family in array array['lab_report','external_record'] loop
  rows:=p_snapshot->case family when 'lab_report' then 'lab_reports' else 'external_records' end;
  for r in select value from jsonb_array_elements(rows) where value->>'document_id'=p_document->>'id' loop
   if row(r->>'document_version',r->>'mime_type',r->>'file_size',r->>'content_sha256') is distinct from row(p_document->>'version',p_document->>'mime_type',p_document->>'file_size',p_document->>'content_sha256')
    or r->>'content_sha256' is null or r->>'content_sha256' !~ '^[a-f0-9]{64}$'
    or r->>'receipt_hash' is null or r->>'receipt_hash' !~ '^[a-f0-9]{64}$' or r->>'capture_hash' is null or r->>'capture_hash' !~ '^[a-f0-9]{64}$'
    or r->>'id' is null or r->>'receipt_id' is null then raise exception 'Selected source capture differs from original' using errcode='23514';end if;
   reference:=jsonb_build_object('family',family,'version_id',r->'id','receipt_id',r->'receipt_id','receipt_hash',r->'receipt_hash','capture_hash',r->'capture_hash');
   expected:=expected||jsonb_build_array(reference);
  end loop;
 end loop;
 if jsonb_array_length(expected)=0 then
  if p_document ? 'content_sha256' or p_document ? 'provenance_captures' then raise exception 'Unselected capture provenance is not an ordinary attachment' using errcode='23514';end if;
  return;
 end if;
 if jsonb_typeof(p_document->'provenance_captures') is distinct from 'array' then raise exception 'Missing original source captures' using errcode='23514';end if;
 select jsonb_agg(value order by value::text) into actual from jsonb_array_elements(p_document->'provenance_captures');
 select jsonb_agg(value order by value::text) into expected from jsonb_array_elements(expected);
 if actual is distinct from expected or p_document->>'content_sha256' is distinct from encode(sha256(p_bytes),'hex') then raise exception 'Original bytes differ from verified source capture' using errcode='23514';end if;
end $$;
revoke all on function public.verify_release_source_original_v5(jsonb,jsonb,bytea) from public,anon,authenticated,service_role;

-- Exact captured email replay precedes fresh source inspection.
create or replace function public.capture_release_email_payload(p_request_id uuid,p_actor_id uuid,p_payload_text text) returns void language plpgsql security definer set search_path=public as $$
declare r public.release_email_requests;existing public.release_email_payloads;b jsonb;payload jsonb;a jsonb;doc jsonb;decoded bytea;manifest jsonb:='[]';i integer:=0;hash text;filename text;
begin
 perform public.communication_require_service();
 if p_payload_text is null or octet_length(p_payload_text) not between 1 and 33554432 then raise exception 'Encoded email exceeds application limits' using errcode='23514';end if;
 select * into r from public.release_email_requests where id=p_request_id for update;
 if not found or r.actor_id is distinct from p_actor_id or r.state='abandoned' or not public.is_active_staff(r.actor_id) then raise exception 'Request ownership mismatch or abandoned' using errcode='42501';end if;
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
   perform public.verify_release_source_original_v5(b#>'{release,snapshot}',doc,decoded);
  end if;
  manifest:=manifest||jsonb_build_array(jsonb_build_object('filename',a->>'filename','mime_type',a->>'content_type','file_size',octet_length(decoded),'sha256',encode(sha256(decoded),'hex'),'document_id',case when i>0 then doc->'id' else null end));i:=i+1;
 end loop;
 insert into public.release_email_payloads(request_id,payload_text,payload_hash,manifest) values(p_request_id,p_payload_text,hash,manifest);
 update public.release_email_requests set state='ready' where id=p_request_id;
exception when invalid_text_representation or character_not_in_repertoire then raise exception 'Malformed frozen email payload' using errcode='23514';
end $$;

create or replace function public.capture_document_link(p_id uuid,p_actor_id uuid,p_payload_text text,p_token_hash text,p_message_hash text) returns void language plpgsql security definer set search_path=public,extensions as $$
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
   perform public.verify_release_source_original_v5(g.source_bundle#>'{release,snapshot}',d,bytes);
   if (a->>'mime_type'='application/pdf' and substring(bytes from 1 for 5)<>convert_to('%PDF-','UTF8')) or (a->>'mime_type'='image/png' and substring(bytes from 1 for 8)<>decode('89504e470d0a1a0a','hex')) or (a->>'mime_type'='image/jpeg' and substring(bytes from 1 for 3)<>decode('ffd8ff','hex')) or a->>'mime_type' not in ('application/pdf','image/png','image/jpeg') then raise exception 'Original signature differs' using errcode='23514';end if;
  end if;
  manifest:=manifest||jsonb_build_array(jsonb_build_object('index',n,'filename',a->>'filename','mime_type',a->>'mime_type','file_size',octet_length(bytes),'sha256',encode(digest(bytes,'sha256'),'hex')));n:=n+1;
 end loop;
 insert into public.document_link_payloads(grant_id,payload_text,artifact_hash,token_hash,message_hash,manifest) values(g.id,p_payload_text,encode(digest(p_payload_text,'sha256'),'hex'),p_token_hash,p_message_hash,manifest);
 update public.document_link_grants set state='captured' where id=g.id;
end $$;
