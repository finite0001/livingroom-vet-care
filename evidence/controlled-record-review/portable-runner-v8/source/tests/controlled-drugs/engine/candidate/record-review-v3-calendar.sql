-- UNUSED Gate B calendar source: no grants, installation or runtime acceptance.
-- Owner postgres; VOLATILE SECURITY INVOKER; non-strict; PARALLEL UNSAFE;
-- search_path=pg_catalog,public,pg_temp; timezone=UTC; private EXECUTE only.
-- calendar_candidates(p_request jsonb) returns jsonb, exact {zone,local_values}.
-- resolve_calendar(p_calendar jsonb) returns jsonb, exact {calendar,observation}.
-- Observation is {zone,postgres_version,local_values}; each local value is
-- {local_timestamp,candidates:[{utc,offset_seconds}]}. Candidate count is length.
-- No authoritative configuration-record integration until the new observation
-- field and this source have independently cleared review/reference.
-- BEGIN FUNCTION calendar_candidates|jsonb|plpgsql
declare zone_name text;v jsonb;t text;local_value timestamp;previous text;result jsonb;
begin
 if jsonb_typeof(p_request)is distinct from 'object' or octet_length(p_request::text)>131072 then
  raise exception 'calendar_invalid_request' using errcode='23514';end if;
 if (select array_agg(k order by k)from jsonb_object_keys(p_request)k)is distinct from array['local_values','zone'] then
  raise exception 'calendar_invalid_request' using errcode='23514';
 end if;
 if jsonb_typeof(p_request->'zone')is distinct from 'string' then
  raise exception 'calendar_invalid_zone' using errcode='23514';end if;
 zone_name:=p_request->>'zone';
 if octet_length(zone_name)not between 1 and 100 or
 (zone_name<>'UTC' and(zone_name!~'^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)+$'
 or zone_name like 'posix/%' or zone_name like 'right/%'))
 or not exists(select 1 from pg_timezone_names where name=zone_name)then
  raise exception 'calendar_invalid_zone' using errcode='23514';end if;
 if jsonb_typeof(p_request->'local_values')is distinct from 'array' then
  raise exception 'calendar_invalid_local_values' using errcode='23514';end if;
 if jsonb_array_length(p_request->'local_values')not between 1 and 63 then
  raise exception 'calendar_local_value_limit' using errcode='23514';end if;
 for v in select value from jsonb_array_elements(p_request->'local_values')loop
  if jsonb_typeof(v)is distinct from 'string' then
   raise exception 'calendar_invalid_local_value' using errcode='23514';end if;
  t:=v#>>'{}';
  if t!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$'
  or(previous is not null and t collate "C"<=previous collate "C")then
   raise exception 'calendar_invalid_local_value' using errcode='23514';end if;
  begin local_value:=t::timestamp;
  exception when invalid_datetime_format or datetime_field_overflow then
   raise exception 'calendar_invalid_local_value' using errcode='23514';end;
  if not isfinite(local_value)or local_value<timestamp '2026-01-01 00:00:00'
  or local_value>timestamp '2101-01-01 00:00:00'
  or to_char(local_value,'YYYY-MM-DD"T"HH24:MI:SS')<>t then
   raise exception 'calendar_invalid_local_value' using errcode='23514';end if;
  previous:=t;
 end loop;
 -- Exactly100801 integral-second offsets per distinct local value, at most
 -- 6,350,463 round-trips. No sampling and no contemporary utc_offset fallback.
 with local_inputs as materialized(
  select value as label,value::timestamp as local_value
  from jsonb_array_elements_text(p_request->'local_values')
 ), matches as materialized(
  select l.label,o.offset_seconds,
   (l.local_value-o.offset_seconds*interval '1 second')at time zone 'UTC' as candidate
  from local_inputs l cross join generate_series(-50400,50400)as o(offset_seconds)
  where (((l.local_value-o.offset_seconds*interval '1 second')at time zone 'UTC')at time zone zone_name)=l.local_value
 ), grouped as(
  select l.label,coalesce((select jsonb_agg(jsonb_build_object(
   'utc',to_char(m.candidate at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'offset_seconds',m.offset_seconds)order by m.candidate)
   from matches m where m.label=l.label),'[]'::jsonb)as candidates from local_inputs l
 )select jsonb_agg(jsonb_build_object('local_timestamp',label,'candidates',candidates)order by label collate "C")
 into result from grouped;
 -- Bound every retained candidate, including an unselected side of a fold.
 if exists(select 1 from jsonb_array_elements(result)r cross join lateral jsonb_array_elements(r->'candidates')c
  where(c->>'utc')::timestamptz<timestamptz '2026-01-01 00:00:00Z'
   or(c->>'utc')::timestamptz>=timestamptz '2101-01-01 00:00:00Z')then
  raise exception 'calendar_observation_range' using errcode='23514';end if;
 return result;
end
-- END FUNCTION
-- BEGIN FUNCTION resolve_calendar|jsonb|plpgsql
declare first_day date;last_day date;day_row jsonb;day_date date;idx integer:=0;
 local_values text[]:=array[]::text[];local_text text;wire jsonb;instant timestamptz;
 resolution jsonb;boundaries jsonb;closes jsonb;fold integer;candidate_count integer;server_version text;
 start_time timestamptz;end_time timestamptz;close_instant timestamptz;previous_end timestamptz;
begin
 if jsonb_typeof(p_calendar)is distinct from 'object' or octet_length(p_calendar::text)>131072 then
  raise exception 'calendar_invalid_request' using errcode='23514';end if;
 if (select array_agg(k order by k)from jsonb_object_keys(p_calendar)k)is distinct from array['days','first_date','last_date','zone']then
  raise exception 'calendar_invalid_request' using errcode='23514';end if;
 if jsonb_typeof(p_calendar->'first_date')is distinct from 'string'
 or jsonb_typeof(p_calendar->'last_date')is distinct from 'string'
 or(p_calendar->>'first_date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 or(p_calendar->>'last_date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'then
  raise exception 'calendar_invalid_date_range' using errcode='23514';end if;
 begin first_day:=(p_calendar->>'first_date')::date;last_day:=(p_calendar->>'last_date')::date;
 exception when invalid_datetime_format or datetime_field_overflow then
  raise exception 'calendar_invalid_date_range' using errcode='23514';end;
 if first_day<date '2026-01-01' or last_day>=date '2101-01-01'
 or last_day-first_day not between 0 and 30
 or to_char(first_day,'YYYY-MM-DD')<>p_calendar->>'first_date'
 or to_char(last_day,'YYYY-MM-DD')<>p_calendar->>'last_date'then
  raise exception 'calendar_invalid_date_range' using errcode='23514';end if;
 if jsonb_typeof(p_calendar->'days')is distinct from 'array'then
  raise exception 'calendar_invalid_days' using errcode='23514';end if;
 if jsonb_array_length(p_calendar->'days')<>last_day-first_day+1 then
  raise exception 'calendar_incomplete_days' using errcode='23514';end if;
 for day_row in select value from jsonb_array_elements(p_calendar->'days')loop
  if jsonb_typeof(day_row)is distinct from 'object'then
   raise exception 'calendar_invalid_day' using errcode='23514';end if;
  if(select array_agg(k order by k)from jsonb_object_keys(day_row)k)is distinct from
   array['close_fold','close_local','close_utc','date','end_utc','staffed','start_utc']then
   raise exception 'calendar_invalid_day' using errcode='23514';end if;
  day_date:=first_day+idx;
  if day_row->'date'is distinct from to_jsonb(to_char(day_date,'YYYY-MM-DD'))
  or jsonb_typeof(day_row->'staffed')is distinct from 'boolean'then
   raise exception 'calendar_invalid_day' using errcode='23514';end if;
  local_values:=array_append(local_values,to_char(day_date,'YYYY-MM-DD')||'T00:00:00');
  local_values:=array_append(local_values,to_char(day_date+1,'YYYY-MM-DD')||'T00:00:00');
  if(day_row->>'staffed')::boolean then
   if jsonb_typeof(day_row->'close_local')is distinct from 'string'
   or(day_row->>'close_local')!~'^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'
   or jsonb_typeof(day_row->'close_fold')is distinct from 'number'
   or(day_row->>'close_fold')!~'^[01]$'then
    raise exception 'calendar_invalid_close' using errcode='23514';end if;
   local_values:=array_append(local_values,to_char(day_date,'YYYY-MM-DD')||'T'||(day_row->>'close_local'));
  elsif day_row->'close_local'is distinct from 'null'::jsonb
   or day_row->'close_fold'is distinct from 'null'::jsonb
   or day_row->'close_utc'is distinct from 'null'::jsonb then
   raise exception 'calendar_closed_day_has_close' using errcode='23514';end if;
  for wire in select value from jsonb_array_elements(jsonb_build_array(day_row->'start_utc',day_row->'end_utc')||
   case when(day_row->>'staffed')::boolean then jsonb_build_array(day_row->'close_utc')else'[]'::jsonb end)loop
   if jsonb_typeof(wire)is distinct from 'string'or(wire#>>'{}')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'then
    raise exception 'calendar_invalid_utc' using errcode='23514';end if;
   begin instant:=(wire#>>'{}')::timestamptz;
   exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'calendar_invalid_utc' using errcode='23514';end;
   if not isfinite(instant)or instant<timestamptz '2026-01-01 00:00:00Z'
   or instant>=timestamptz '2101-01-01 00:00:00Z'
   or to_char(instant at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>wire#>>'{}'then
    raise exception 'calendar_invalid_utc' using errcode='23514';end if;
  end loop;
  idx:=idx+1;
 end loop;
 select array_agg(value order by value collate "C")into local_values from(select distinct unnest(local_values)as value)q;
 resolution:=controlled_review_v3.calendar_candidates(jsonb_build_object('zone',p_calendar->'zone','local_values',to_jsonb(local_values)));
 server_version:=public.controlled_stock_text(to_jsonb(current_setting('server_version')),200,false);
 idx:=0;
 for day_row in select value from jsonb_array_elements(p_calendar->'days')loop
  day_date:=first_day+idx;
  select value->'candidates'into strict boundaries from jsonb_array_elements(resolution)
   where value->>'local_timestamp'=to_char(day_date,'YYYY-MM-DD')||'T00:00:00';
  if jsonb_array_length(boundaries)not between 1 and 2 then
   raise exception 'calendar_unsupported_midnight' using errcode='23514';end if;
  start_time:=(boundaries#>>'{0,utc}')::timestamptz;
  select value->'candidates'into strict boundaries from jsonb_array_elements(resolution)
   where value->>'local_timestamp'=to_char(day_date+1,'YYYY-MM-DD')||'T00:00:00';
  if jsonb_array_length(boundaries)not between 1 and 2 then
   raise exception 'calendar_unsupported_midnight' using errcode='23514';end if;
  end_time:=(boundaries#>>'{0,utc}')::timestamptz;
  if start_time is distinct from(day_row->>'start_utc')::timestamptz
  or end_time is distinct from(day_row->>'end_utc')::timestamptz
  or end_time<=start_time or(previous_end is not null and previous_end<>start_time)then
   raise exception 'calendar_boundary_mismatch' using errcode='23514';end if;
  if(day_row->>'staffed')::boolean then
   local_text:=to_char(day_date,'YYYY-MM-DD')||'T'||(day_row->>'close_local');
   select value->'candidates'into strict closes from jsonb_array_elements(resolution)
    where value->>'local_timestamp'=local_text;
   candidate_count:=jsonb_array_length(closes);fold:=(day_row->>'close_fold')::integer;
   if candidate_count not between 1 and 2 or fold>=candidate_count then
    raise exception 'calendar_unsupported_close' using errcode='23514';end if;
   close_instant:=(closes->fold->>'utc')::timestamptz;
   if close_instant is distinct from(day_row->>'close_utc')::timestamptz
   or close_instant<=start_time or close_instant>=end_time then
    raise exception 'calendar_close_mismatch' using errcode='23514';end if;
  end if;
  previous_end:=end_time;idx:=idx+1;
 end loop;
 return jsonb_build_object('calendar',p_calendar,'observation',jsonb_build_object(
  'zone',p_calendar->'zone','postgres_version',server_version,'local_values',resolution));
end
-- END FUNCTION
