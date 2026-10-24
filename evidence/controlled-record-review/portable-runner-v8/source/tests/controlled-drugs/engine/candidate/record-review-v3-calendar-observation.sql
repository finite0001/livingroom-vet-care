-- UNUSED retained-observation validator; no installation, grants or DB proof.
-- validate_calendar_observation(p_request jsonb) returns jsonb.
-- Owner postgres; VOLATILE SECURITY INVOKER; non-strict; PARALLEL UNSAFE;
-- search_path=pg_catalog,public,pg_temp; timezone=UTC; private EXECUTE only.
-- Exact input/output {calendar,observation}; returns the unchanged validated pair.
-- This proves retained structural/arithmetic correspondence, not historical
-- timezone-rule exhaustiveness. Original publication and authoritative record
-- hash bind that provenance. Never resolve current tzdata during restoration.
-- All malformed-input refusals are23514/calendar_observation_invalid.
-- BEGIN FUNCTION validate_calendar_observation|jsonb|plpgsql
declare body jsonb;observation jsonb;day_row jsonb;item jsonb;candidate jsonb;
 first_day date;last_day date;day_date date;idx integer:=0;zone_name text;version_text text;
 requested text[]:=array[]::text[];observed text[]:=array[]::text[];label text;previous_label text;
 local_value timestamp;utc_value timestamp;offset_seconds integer;utc_text text;previous_utc text;
 candidates jsonb;start_candidate jsonb;end_candidate jsonb;close_candidate jsonb;fold integer;
 start_value timestamp;end_value timestamp;close_value timestamp;previous_end timestamp;
begin
 if jsonb_typeof(p_request)is distinct from 'object'or octet_length(p_request::text)>131072 then
  raise exception 'calendar_observation_invalid'using errcode='23514';end if;
 if(select array_agg(k order by k)from jsonb_object_keys(p_request)k)is distinct from array['calendar','observation']then
  raise exception 'calendar_observation_invalid'using errcode='23514';end if;
 body:=p_request->'calendar';observation:=p_request->'observation';
 if jsonb_typeof(body)is distinct from 'object'or jsonb_typeof(observation)is distinct from 'object'then
  raise exception 'calendar_observation_invalid'using errcode='23514';end if;
 if(select array_agg(k order by k)from jsonb_object_keys(body)k)is distinct from array['days','first_date','last_date','zone']
 or(select array_agg(k order by k)from jsonb_object_keys(observation)k)is distinct from array['local_values','postgres_version','zone']then
  raise exception 'calendar_observation_invalid'using errcode='23514';end if;
 if jsonb_typeof(body->'zone')is distinct from 'string'or observation->'zone'is distinct from body->'zone'then
  raise exception 'calendar_observation_invalid'using errcode='23514';end if;
 zone_name:=body->>'zone';
 -- Retained names satisfy the supported lexical predicate; existence today is
 -- neither needed nor evidence of what the publishing environment observed.
 if octet_length(zone_name)not between 1 and 100 or(zone_name<>'UTC'and(
  zone_name!~'^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)+$'
  or zone_name like 'posix/%'or zone_name like 'right/%'))then
  raise exception 'calendar_observation_invalid'using errcode='23514';end if;
 version_text:=public.controlled_stock_text(observation->'postgres_version',200,false);
 if jsonb_typeof(body->'first_date')is distinct from 'string'or jsonb_typeof(body->'last_date')is distinct from 'string'
 or(body->>'first_date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'or(body->>'last_date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'then
  raise exception 'calendar_observation_invalid'using errcode='23514';end if;
 first_day:=(body->>'first_date')::date;last_day:=(body->>'last_date')::date;
 if first_day<date '2026-01-01'or last_day>=date '2101-01-01'or last_day-first_day not between 0 and 30
 or to_char(first_day,'YYYY-MM-DD')<>body->>'first_date'or to_char(last_day,'YYYY-MM-DD')<>body->>'last_date'then
  raise exception 'calendar_observation_invalid'using errcode='23514';end if;
 if jsonb_typeof(body->'days')is distinct from 'array'then
  raise exception 'calendar_observation_invalid'using errcode='23514';end if;
 if jsonb_array_length(body->'days')<>last_day-first_day+1 then
  raise exception 'calendar_observation_invalid'using errcode='23514';end if;
 for day_row in select value from jsonb_array_elements(body->'days')loop
  if jsonb_typeof(day_row)is distinct from 'object'then
   raise exception 'calendar_observation_invalid'using errcode='23514';end if;
  if(select array_agg(k order by k)from jsonb_object_keys(day_row)k)is distinct from
   array['close_fold','close_local','close_utc','date','end_utc','staffed','start_utc']then
   raise exception 'calendar_observation_invalid'using errcode='23514';end if;
  day_date:=first_day+idx;
  if day_row->'date'is distinct from to_jsonb(to_char(day_date,'YYYY-MM-DD'))
  or jsonb_typeof(day_row->'staffed')is distinct from 'boolean'then
   raise exception 'calendar_observation_invalid'using errcode='23514';end if;
  requested:=array_append(requested,to_char(day_date,'YYYY-MM-DD')||'T00:00:00');
  requested:=array_append(requested,to_char(day_date+1,'YYYY-MM-DD')||'T00:00:00');
  if(day_row->>'staffed')::boolean then
   if jsonb_typeof(day_row->'close_local')is distinct from 'string'
   or(day_row->>'close_local')!~'^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'
   or jsonb_typeof(day_row->'close_fold')is distinct from 'number'or(day_row->>'close_fold')!~'^[01]$'then
    raise exception 'calendar_observation_invalid'using errcode='23514';end if;
   requested:=array_append(requested,to_char(day_date,'YYYY-MM-DD')||'T'||(day_row->>'close_local'));
  elsif day_row->'close_local'is distinct from 'null'::jsonb or day_row->'close_fold'is distinct from 'null'::jsonb
  or day_row->'close_utc'is distinct from 'null'::jsonb then
   raise exception 'calendar_observation_invalid'using errcode='23514';end if;
  idx:=idx+1;
 end loop;
 select array_agg(value order by value collate "C")into requested from(select distinct unnest(requested)as value)q;
 if jsonb_typeof(observation->'local_values')is distinct from 'array'then
  raise exception 'calendar_observation_invalid'using errcode='23514';end if;
 if jsonb_array_length(observation->'local_values')not between 1 and 63 then
  raise exception 'calendar_observation_invalid'using errcode='23514';end if;
 for item in select value from jsonb_array_elements(observation->'local_values')loop
  if jsonb_typeof(item)is distinct from 'object'then
   raise exception 'calendar_observation_invalid'using errcode='23514';end if;
  if(select array_agg(k order by k)from jsonb_object_keys(item)k)is distinct from array['candidates','local_timestamp']
  or jsonb_typeof(item->'local_timestamp')is distinct from 'string'or jsonb_typeof(item->'candidates')is distinct from 'array'then
   raise exception 'calendar_observation_invalid'using errcode='23514';end if;
  label:=item->>'local_timestamp';
  if label!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$'
  or(previous_label is not null and label collate "C"<=previous_label collate "C")then
   raise exception 'calendar_observation_invalid'using errcode='23514';end if;
  local_value:=label::timestamp;
  if not isfinite(local_value)or local_value<timestamp '2026-01-01 00:00:00'or local_value>timestamp '2101-01-01 00:00:00'
  or to_char(local_value,'YYYY-MM-DD"T"HH24:MI:SS')<>label or jsonb_array_length(item->'candidates')not between 1 and 2 then
   raise exception 'calendar_observation_invalid'using errcode='23514';end if;
  observed:=array_append(observed,label);previous_label:=label;previous_utc:=null;
  for candidate in select value from jsonb_array_elements(item->'candidates')loop
   if jsonb_typeof(candidate)is distinct from 'object'then
    raise exception 'calendar_observation_invalid'using errcode='23514';end if;
   if(select array_agg(k order by k)from jsonb_object_keys(candidate)k)is distinct from array['offset_seconds','utc']
   or jsonb_typeof(candidate->'utc')is distinct from 'string'or jsonb_typeof(candidate->'offset_seconds')is distinct from 'number'
   or(candidate->>'offset_seconds')!~'^-?(0|[1-9][0-9]*)$'then
    raise exception 'calendar_observation_invalid'using errcode='23514';end if;
   utc_text:=candidate->>'utc';offset_seconds:=(candidate->>'offset_seconds')::integer;
   if utc_text!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
   or offset_seconds not between -50400 and 50400
   or(previous_utc is not null and utc_text collate "C"<=previous_utc collate "C")then
    raise exception 'calendar_observation_invalid'using errcode='23514';end if;
   -- Explicit UTC civil fields as timestamp WITHOUT time zone. No timezone
   -- lookup/conversion or current catalog can influence retained arithmetic.
   utc_value:=left(utc_text,26)::timestamp;
   if not isfinite(utc_value)or utc_value<timestamp '2026-01-01 00:00:00'or utc_value>=timestamp '2101-01-01 00:00:00'
   or to_char(utc_value,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>utc_text
   or utc_value+offset_seconds*interval '1 second'<>local_value then
    raise exception 'calendar_observation_invalid'using errcode='23514';end if;
   previous_utc:=utc_text;
  end loop;
 end loop;
 if observed is distinct from requested then
  raise exception 'calendar_observation_invalid'using errcode='23514';end if;
 idx:=0;
 for day_row in select value from jsonb_array_elements(body->'days')loop
  day_date:=first_day+idx;
  select value#>'{candidates,0}'into strict start_candidate from jsonb_array_elements(observation->'local_values')
   where value->>'local_timestamp'=to_char(day_date,'YYYY-MM-DD')||'T00:00:00';
  select value#>'{candidates,0}'into strict end_candidate from jsonb_array_elements(observation->'local_values')
   where value->>'local_timestamp'=to_char(day_date+1,'YYYY-MM-DD')||'T00:00:00';
  if day_row->'start_utc'is distinct from start_candidate->'utc'or day_row->'end_utc'is distinct from end_candidate->'utc'then
   raise exception 'calendar_observation_invalid'using errcode='23514';end if;
  start_value:=left(start_candidate->>'utc',26)::timestamp;end_value:=left(end_candidate->>'utc',26)::timestamp;
  if end_value<=start_value or(previous_end is not null and previous_end<>start_value)then
   raise exception 'calendar_observation_invalid'using errcode='23514';end if;
  if(day_row->>'staffed')::boolean then
   select value->'candidates'into strict candidates from jsonb_array_elements(observation->'local_values')
    where value->>'local_timestamp'=to_char(day_date,'YYYY-MM-DD')||'T'||(day_row->>'close_local');
   fold:=(day_row->>'close_fold')::integer;
   if fold>=jsonb_array_length(candidates)then
    raise exception 'calendar_observation_invalid'using errcode='23514';end if;
   close_candidate:=candidates->fold;
   if day_row->'close_utc'is distinct from close_candidate->'utc'then
    raise exception 'calendar_observation_invalid'using errcode='23514';end if;
   close_value:=left(close_candidate->>'utc',26)::timestamp;
   if close_value<=start_value or close_value>=end_value then
    raise exception 'calendar_observation_invalid'using errcode='23514';end if;
  end if;
  previous_end:=end_value;idx:=idx+1;
 end loop;
 return p_request;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
 or numeric_value_out_of_range or check_violation then
 raise exception 'calendar_observation_invalid'using errcode='23514';
end
-- END FUNCTION
