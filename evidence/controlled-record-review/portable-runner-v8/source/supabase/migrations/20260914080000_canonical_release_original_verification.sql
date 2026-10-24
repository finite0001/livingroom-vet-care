-- Preserve existing native-byte contracts and add exact schema9 API package binding.
do $$declare definition text;begin
 select pg_get_functiondef('public.verify_release_source_original_v5(jsonb,jsonb,bytea)'::regprocedure) into definition;
 if strpos(definition,'p_snapshot->>''schema_version'' is distinct from ''8''')=0 then raise exception 'Expected canonical schema8 byte contract missing';end if;
 execute replace(definition,'public.verify_release_source_original_v5(','public.verify_release_source_original_legacy(');
end $$;
create or replace function public.verify_release_source_original_v5(p_snapshot jsonb,p_document jsonb,p_bytes bytea)
returns void language plpgsql security definer set search_path=public as $$
declare item jsonb;expected jsonb;matches integer;selected jsonb;actual jsonb;
begin
 if p_snapshot->>'schema_version' is distinct from '9' then
  perform public.verify_release_source_original_legacy(p_snapshot,p_document,p_bytes);return;
 end if;
 if jsonb_typeof(p_snapshot->'api_attachments') is distinct from 'array'
  or jsonb_typeof(p_snapshot->'attachments') is distinct from 'array'
  or jsonb_typeof(p_snapshot#>'{selection,api_attachment_ids}') is distinct from 'array'
 then raise exception 'Missing selected API package provenance' using errcode='23514';end if;
 if jsonb_array_length(p_snapshot->'api_attachments')>20 or jsonb_array_length(p_snapshot->'attachments')>24
  or (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_snapshot->'attachments'))
  or (select count(*)<>count(distinct value#>>'{record,id}') from jsonb_array_elements(p_snapshot->'api_attachments'))
 then raise exception 'Distinct selected originals within package bounds required' using errcode='23514';end if;
 select coalesce(jsonb_agg(value order by value::text),'[]') into selected from jsonb_array_elements(p_snapshot#>'{selection,api_attachment_ids}');
 select coalesce(jsonb_agg(value#>'{record,id}' order by (value#>'{record,id}')::text),'[]') into actual from jsonb_array_elements(p_snapshot->'api_attachments');
 if actual is distinct from selected then raise exception 'API approvals differ from reviewed selection' using errcode='23514';end if;
 for item in select value from jsonb_array_elements(p_snapshot->'api_attachments') loop
  expected:=public.release_api_attachment_document(item);
  if item#>>'{record,pet_id}' is distinct from p_snapshot#>>'{patient,id}'
   or (select count(*) from jsonb_array_elements(p_snapshot->'attachments') where value=expected)<>1
  then raise exception 'Exact selected API original missing from package' using errcode='23514';end if;
 end loop;
 if (select count(*) from jsonb_array_elements(p_snapshot->'attachments') where value=p_document)<>1 then
  raise exception 'Original is not an exact selected package file' using errcode='23514';end if;
 if p_document->>'bucket'='ezyvet-attachment-originals' then
  select count(*),jsonb_agg(value)->0 into matches,item from jsonb_array_elements(p_snapshot->'api_attachments') where value#>>'{record,id}'=p_document#>>'{api_attachment_ref,record_id}';
  if matches<>1 then raise exception 'Exact selected API source required' using errcode='23514';end if;
  expected:=public.release_api_attachment_document(item);
  if p_bytes is null or expected is distinct from p_document
   or p_document->>'content_sha256' is distinct from encode(sha256(p_bytes),'hex')
   or (p_document->>'file_size')::bigint<>octet_length(p_bytes)
  then raise exception 'API original differs from reviewed capture' using errcode='23514';end if;
 else
  if p_document->>'bucket' is distinct from 'patient-documents' or p_document ? 'api_attachment_ref'
   or exists(select 1 from jsonb_array_elements(p_snapshot->'api_attachments') where value#>>'{capture,request_id}'=p_document->>'id')
  then raise exception 'API original cannot be downgraded to ordinary document' using errcode='23514';end if;
  -- Only the local native-verification view changes its dispatch tag; the saved snapshot is untouched.
  perform public.verify_release_source_original_legacy(jsonb_set(p_snapshot,'{schema_version}','8'),p_document,p_bytes);
 end if;
end $$;
revoke all on function public.verify_release_source_original_v5(jsonb,jsonb,bytea) from public,anon,authenticated,service_role;
revoke all on function public.verify_release_source_original_legacy(jsonb,jsonb,bytea) from public,anon,authenticated,service_role;
