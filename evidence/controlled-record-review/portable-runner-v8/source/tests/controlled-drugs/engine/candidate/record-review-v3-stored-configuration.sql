-- Private pure value draft. Not installed or granted. Returns unchanged D.
-- BEGIN FUNCTION validate_stored_configuration|jsonb|plpgsql
declare caller_copy jsonb;effective_text text;effective_value timestamp;calendar_pair jsonb;
begin
 if jsonb_typeof(p_request)is distinct from 'object'or octet_length(p_request::text)>131072 then
  raise exception 'stored_configuration_invalid'using errcode='23514';end if;
 perform public.controlled_stock_keys(p_request,array['schema_version','kind','scope','version','predecessor_id','predecessor_hash','enabled','body','approval_reference','calendar_observation']);
 caller_copy:=p_request-'calendar_observation';
 if p_request->'kind'='"policy"'::jsonb then
  if jsonb_typeof(p_request->'body')is distinct from 'object'
   or jsonb_typeof(p_request#>'{body,effective_from}')is distinct from 'string'then
   raise exception 'stored_configuration_invalid'using errcode='23514';end if;
  effective_text:=p_request#>>'{body,effective_from}';
  if effective_text!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'then
   raise exception 'stored_configuration_invalid'using errcode='23514';end if;
  effective_value:=left(effective_text,26)::timestamp;
  if not isfinite(effective_value)or effective_value<timestamp '2026-01-01 00:00:00'
   or effective_value>=timestamp '2101-01-01 00:00:00'
   or to_char(effective_value,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>effective_text then
   raise exception 'stored_configuration_invalid'using errcode='23514';end if;
  -- Validation-only shape adapter; never the original saved publication request.
  caller_copy:=jsonb_set(caller_copy,'{body,effective_from}',jsonb_build_object('mode','at','at',effective_text),false);
 end if;
 if p_request->'kind'='"calendar"'::jsonb then
  if jsonb_typeof(p_request->'calendar_observation')is distinct from 'object'then
   raise exception 'stored_configuration_invalid'using errcode='23514';end if;
 else
  if p_request->'calendar_observation'is distinct from 'null'::jsonb then
   raise exception 'stored_configuration_invalid'using errcode='23514';end if;
 end if;
 if octet_length(caller_copy::text)>131072 then raise exception 'stored_configuration_invalid'using errcode='23514';end if;
 perform controlled_review_v3.validate_configuration(caller_copy);
 if p_request->'kind'='"calendar"'::jsonb then
  calendar_pair:=jsonb_build_object('calendar',p_request->'body','observation',p_request->'calendar_observation');
  if octet_length(calendar_pair::text)>131072 then raise exception 'stored_configuration_invalid'using errcode='23514';end if;
  perform controlled_review_v3.validate_calendar_observation(calendar_pair);
 end if;
 return p_request;
exception when check_violation or invalid_text_representation or invalid_datetime_format
 or datetime_field_overflow or numeric_value_out_of_range then
 raise exception 'stored_configuration_invalid'using errcode='23514';
end
-- END FUNCTION
