-- Private pure retained record draft. Never repairs supplied record_hash.
-- BEGIN FUNCTION validate_configuration_record|jsonb|plpgsql
declare stored_document jsonb;published_text text;published_value timestamp;effective_value timestamp;
 mode_text text;kind_text text;version_value integer;
begin
 if jsonb_typeof(p_request)is distinct from 'object'or octet_length(p_request::text)>262144 then
  raise exception 'configuration_record_invalid'using errcode='23514';end if;
 perform public.controlled_stock_keys(p_request,array['schema_version','kind','scope','version','predecessor_id','predecessor_hash','enabled','body','approval_reference','id','publication_operation_id','published_at','publisher_actor_id','publisher_session_id','publisher_name','authorization_id','calendar_observation','publication_mode','record_hash']);
 stored_document:=p_request-array['id','publication_operation_id','published_at','publisher_actor_id','publisher_session_id','publisher_name','authorization_id','publication_mode','record_hash'];
 if octet_length(stored_document::text)>131072 then raise exception 'configuration_record_invalid'using errcode='23514';end if;
 perform controlled_review_v3.validate_stored_configuration(stored_document);
 perform public.controlled_stock_uuid(p_request->'id');
 perform public.controlled_stock_uuid(p_request->'publication_operation_id');
 if p_request->'id'=p_request->'predecessor_id'then raise exception 'configuration_record_invalid'using errcode='23514';end if;
 perform public.controlled_stock_text(p_request->'publisher_name',200,false);
 if jsonb_typeof(p_request->'published_at')is distinct from 'string'
  or jsonb_typeof(p_request->'publication_mode')is distinct from 'string'
  or jsonb_typeof(p_request->'record_hash')is distinct from 'string'
  or(p_request->>'record_hash')!~'^[0-9a-f]{64}$'then
  raise exception 'configuration_record_invalid'using errcode='23514';end if;
 published_text:=p_request->>'published_at';
 if published_text!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'then
  raise exception 'configuration_record_invalid'using errcode='23514';end if;
 published_value:=left(published_text,26)::timestamp;
 if not isfinite(published_value)or published_value<timestamp '2026-01-01 00:00:00'
  or published_value>=timestamp '2101-01-01 00:00:00'
  or to_char(published_value,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>published_text then
  raise exception 'configuration_record_invalid'using errcode='23514';end if;
 mode_text:=p_request->>'publication_mode';kind_text:=p_request->>'kind';version_value:=(p_request->>'version')::integer;
 if mode_text='staff'then
  if kind_text='administration'then raise exception 'configuration_record_invalid'using errcode='23514';end if;
  perform public.controlled_stock_uuid(p_request->'publisher_actor_id');
  perform public.controlled_stock_uuid(p_request->'publisher_session_id');
  perform public.controlled_stock_uuid(p_request->'authorization_id');
 elsif mode_text in('owner_bootstrap','owner_recovery')then
  if kind_text<>'administration'or p_request->'publisher_actor_id'is distinct from 'null'::jsonb
   or p_request->'publisher_session_id'is distinct from 'null'::jsonb
   or p_request->'authorization_id'is distinct from 'null'::jsonb
   or p_request->'publisher_name'is distinct from '"Database owner (postgres)"'::jsonb
   or(mode_text='owner_bootstrap'and version_value<>1)
   or(mode_text='owner_recovery'and version_value<=1)then
   raise exception 'configuration_record_invalid'using errcode='23514';end if;
 else raise exception 'configuration_record_invalid'using errcode='23514';end if;
 if kind_text='policy'then
  -- Stored helper already established exact UTC civil spelling and range.
  effective_value:=left(p_request#>>'{body,effective_from}',26)::timestamp;
  if effective_value<published_value then raise exception 'configuration_record_invalid'using errcode='23514';end if;
 end if;
 if p_request->>'record_hash'is distinct from public.controlled_stock_hash(p_request-'record_hash')then
  raise exception 'configuration_record_invalid'using errcode='23514';end if;
 return p_request;
exception when check_violation or invalid_text_representation or invalid_datetime_format
 or datetime_field_overflow or numeric_value_out_of_range then
 raise exception 'configuration_record_invalid'using errcode='23514';
end
-- END FUNCTION
