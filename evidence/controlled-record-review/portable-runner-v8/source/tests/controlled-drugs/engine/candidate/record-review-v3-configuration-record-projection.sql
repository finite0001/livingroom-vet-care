-- Private pure Q-to-R projection. DTO timestamps are already canonical UTC6.
-- BEGIN FUNCTION configuration_record|jsonb|plpgsql
declare stored_document jsonb;complete_record jsonb;expected_stream jsonb;version_value integer;
begin
 if jsonb_typeof(p_row)is distinct from 'object'or octet_length(p_row::text)>262144 then
  raise exception 'configuration_record_invalid'using errcode='23514';end if;
 perform public.controlled_stock_keys(p_row,array['id','kind','stream_key','version','predecessor_id','predecessor_hash','enabled','document','record_hash','publication_operation_id','published_at','publisher_actor_id','publisher_session_id','publisher_name','authorization_id','publication_mode','effective_from']);
 stored_document:=p_row->'document';
 if jsonb_typeof(stored_document)is distinct from 'object'or octet_length(stored_document::text)>131072
  or jsonb_typeof(p_row->'stream_key')is distinct from 'object'or octet_length((p_row->'stream_key')::text)>4096 then
  raise exception 'configuration_record_invalid'using errcode='23514';end if;
 -- JSONB equality treats1 and1.0 as equal; check this duplicated scalar first.
 if jsonb_typeof(p_row->'version')is distinct from 'number'or(p_row->>'version')!~'^[1-9][0-9]*$'then
  raise exception 'configuration_record_invalid'using errcode='23514';end if;
 version_value:=(p_row->>'version')::integer;
 if version_value<1 then raise exception 'configuration_record_invalid'using errcode='23514';end if;
 -- Validate D before repeated fields or constructing the complete record.
 perform controlled_review_v3.validate_stored_configuration(stored_document);
 if p_row->'kind'is distinct from stored_document->'kind'
  or p_row->'version'is distinct from stored_document->'version'
  or p_row->'predecessor_id'is distinct from stored_document->'predecessor_id'
  or p_row->'predecessor_hash'is distinct from stored_document->'predecessor_hash'
  or p_row->'enabled'is distinct from stored_document->'enabled'then
  raise exception 'configuration_record_invalid'using errcode='23514';end if;
 expected_stream:=jsonb_build_object('kind',stored_document->'kind','product_id',stored_document#>'{scope,product_id}',
  'site_id',stored_document#>'{scope,site_id}','event_kind',stored_document#>'{scope,event_kind}','capability',stored_document#>'{scope,capability}');
 if p_row->'stream_key'is distinct from expected_stream then raise exception 'configuration_record_invalid'using errcode='23514';end if;
 if stored_document->'kind'='"policy"'::jsonb then
  if p_row->'effective_from'is distinct from stored_document#>'{body,effective_from}'then
   raise exception 'configuration_record_invalid'using errcode='23514';end if;
 elsif p_row->'effective_from'is distinct from 'null'::jsonb then
  raise exception 'configuration_record_invalid'using errcode='23514';end if;
 complete_record:=stored_document||jsonb_build_object('id',p_row->'id','publication_operation_id',p_row->'publication_operation_id',
  'published_at',p_row->'published_at','publisher_actor_id',p_row->'publisher_actor_id','publisher_session_id',p_row->'publisher_session_id',
  'publisher_name',p_row->'publisher_name','authorization_id',p_row->'authorization_id','publication_mode',p_row->'publication_mode','record_hash',p_row->'record_hash');
 if octet_length(complete_record::text)>262144 then raise exception 'configuration_record_invalid'using errcode='23514';end if;
 perform controlled_review_v3.validate_configuration_record(complete_record);
 return complete_record;
exception when check_violation or invalid_text_representation or invalid_datetime_format
 or datetime_field_overflow or numeric_value_out_of_range then
 raise exception 'configuration_record_invalid'using errcode='23514';
end
-- END FUNCTION
