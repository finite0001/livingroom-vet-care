-- Private pure reciprocal Q/P check. Original saved request is never rewritten.
-- BEGIN FUNCTION validate_configuration_pair|jsonb|plpgsql
declare configuration_dto jsonb;publication_dto jsonb;complete_record jsonb;original_request jsonb;
 caller_document jsonb;stored_comparison jsonb;expected_stored jsonb;receipt_value jsonb;expected_receipt jsonb;mode_text text;
begin
 if jsonb_typeof(p_request)is distinct from 'object'or octet_length(p_request::text)>524288 then
  raise exception 'configuration_pair_invalid'using errcode='23514';end if;
 perform public.controlled_stock_keys(p_request,array['configuration','publication']);
 configuration_dto:=p_request->'configuration';publication_dto:=p_request->'publication';
 if jsonb_typeof(configuration_dto)is distinct from 'object'or octet_length(configuration_dto::text)>262144
  or jsonb_typeof(publication_dto)is distinct from 'object'or octet_length(publication_dto::text)>393216 then
  raise exception 'configuration_pair_invalid'using errcode='23514';end if;
 perform public.controlled_stock_keys(publication_dto,array['operation_id','actor_id','request','request_hash','record_id','receipt','recorded_at','mode']);
 original_request:=publication_dto->'request';receipt_value:=publication_dto->'receipt';
 if jsonb_typeof(original_request)is distinct from 'object'or octet_length(original_request::text)>131072
  or jsonb_typeof(receipt_value)is distinct from 'object'or octet_length(receipt_value::text)>131072 then
  raise exception 'configuration_pair_invalid'using errcode='23514';end if;
 complete_record:=controlled_review_v3.configuration_record(configuration_dto);
 perform public.controlled_stock_uuid(publication_dto->'operation_id');
 perform public.controlled_stock_uuid(publication_dto->'record_id');
 if jsonb_typeof(publication_dto->'request_hash')is distinct from 'string'
  or(publication_dto->>'request_hash')!~'^[0-9a-f]{64}$'
  or jsonb_typeof(publication_dto->'mode')is distinct from 'string'
  or jsonb_typeof(publication_dto->'recorded_at')is distinct from 'string'then
  raise exception 'configuration_pair_invalid'using errcode='23514';end if;
 -- Equality to validated canonical metadata also validates exact UTC6/null form.
 if publication_dto->'operation_id'is distinct from complete_record->'publication_operation_id'
  or publication_dto->'record_id'is distinct from complete_record->'id'
  or publication_dto->'actor_id'is distinct from complete_record->'publisher_actor_id'
  or publication_dto->'mode'is distinct from complete_record->'publication_mode'
  or publication_dto->'recorded_at'is distinct from complete_record->'published_at'then
  raise exception 'configuration_pair_invalid'using errcode='23514';end if;
 mode_text:=complete_record->>'publication_mode';
 if mode_text='staff'then
  perform public.controlled_stock_keys(original_request,array['actor_id','operation_id','record_id','document']);
  perform public.controlled_stock_uuid(original_request->'actor_id');
  if original_request->'actor_id'is distinct from complete_record->'publisher_actor_id'then
   raise exception 'configuration_pair_invalid'using errcode='23514';end if;
 else
  perform public.controlled_stock_keys(original_request,array['operation_id','record_id','document','reason']);
  perform public.controlled_stock_text(original_request->'reason',4000,true);
 end if;
 perform public.controlled_stock_uuid(original_request->'operation_id');
 perform public.controlled_stock_uuid(original_request->'record_id');
 if original_request->'operation_id'is distinct from publication_dto->'operation_id'
  or original_request->'record_id'is distinct from publication_dto->'record_id'then
  raise exception 'configuration_pair_invalid'using errcode='23514';end if;
 caller_document:=original_request->'document';
 perform controlled_review_v3.validate_configuration(caller_document);
 stored_comparison:=(configuration_dto->'document')-'calendar_observation';
 expected_stored:=caller_document;
 if complete_record->'kind'='"policy"'::jsonb then
  if caller_document#>>'{body,effective_from,mode}'='now'then
   expected_stored:=jsonb_set(caller_document,'{body,effective_from}',complete_record->'published_at',false);
  elsif caller_document#>>'{body,effective_from,mode}'='at'then
   expected_stored:=jsonb_set(caller_document,'{body,effective_from}',caller_document#>'{body,effective_from,at}',false);
  else raise exception 'configuration_pair_invalid'using errcode='23514';end if;
 end if;
 if stored_comparison is distinct from expected_stored then raise exception 'configuration_pair_invalid'using errcode='23514';end if;
 if publication_dto->>'request_hash'is distinct from public.controlled_stock_hash(original_request)then
  raise exception 'configuration_pair_invalid'using errcode='23514';end if;
 perform public.controlled_stock_keys(receipt_value,array['version','operation_id','request_hash','record_id','record_hash','publisher_actor_id','publisher_session_id','publisher_name','authorization_id','publication_mode','published_at']);
 if jsonb_typeof(receipt_value->'version')is distinct from 'number'or receipt_value->>'version'<>'3'then
  raise exception 'configuration_pair_invalid'using errcode='23514';end if;
 expected_receipt:=jsonb_build_object('version',3,'operation_id',publication_dto->'operation_id','request_hash',publication_dto->'request_hash',
  'record_id',complete_record->'id','record_hash',complete_record->'record_hash','publisher_actor_id',complete_record->'publisher_actor_id',
  'publisher_session_id',complete_record->'publisher_session_id','publisher_name',complete_record->'publisher_name',
  'authorization_id',complete_record->'authorization_id','publication_mode',complete_record->'publication_mode','published_at',complete_record->'published_at');
 if receipt_value is distinct from expected_receipt then raise exception 'configuration_pair_invalid'using errcode='23514';end if;
 return p_request;
exception when check_violation or invalid_text_representation or invalid_datetime_format
 or datetime_field_overflow or numeric_value_out_of_range then
 raise exception 'configuration_pair_invalid'using errcode='23514';
end
-- END FUNCTION
