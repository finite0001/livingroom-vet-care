-- PRIVATE UNUSED DRAFT: input-only validation, no publication/admission authority.
-- Exact function metadata is declared separately in metadata.json.
-- No application grants; no tables, clock, Auth, timezone lookup or locks.
-- BEGIN FUNCTION validate_configuration|jsonb|plpgsql
declare
 v_kind text; v_scope jsonb; v_body jsonb; v_enabled boolean; v_version integer;
 v_rules jsonb; v_rule jsonb; v_event_kind text; v_rule_enabled boolean;
 v_choice text; v_expected_mode text; v_expected_anchor text; v_expected_escalation text;
 v_calendar_required boolean:=false; v_routing_required boolean:=false;
 v_members jsonb; v_member jsonb; v_values jsonb; v_item jsonb;
 v_actor text; v_previous_actor text; v_label text; v_previous_label text;
 v_field text; v_count integer; v_index integer:=0;
 v_zone text; v_first date; v_last date; v_date date; v_day jsonb;
 v_stamp jsonb; v_stamp_value timestamptz; v_stamps jsonb[];
 v_start timestamptz; v_end timestamptz; v_close timestamptz; v_previous_end timestamptz;
 v_kinds constant text[]:=array[
  'receive_inventory','adjust_inventory','record_patient_treatment',
  'record_anesthesia_drug_administration','record_native_dispense','record_native_pickup',
  'record_native_dispense_return:intake','record_native_dispense_return:dispose',
  'record_native_dispense_return:restock','record_native_dispense_return_v2:intake',
  'record_native_dispense_return_v2:dispose','record_native_dispense_return_v2:restock',
  'record_native_dispense_return_v2:retract_intake','record_native_dispense_return_v2:retract_disposal',
  'record_native_dispense_return_v2:retract_restock','record_native_return_discrepancy:report',
  'record_native_return_discrepancy:note','record_native_return_discrepancy:resolve_corrected',
  'record_native_return_discrepancy:resolve_confirmed_original',
  'append_native_dispense_correction:clinical_annotation',
  'append_native_dispense_correction:operational_annotation',
  'append_native_dispense_correction:pickup_amendment'];
begin
 -- Bound the whole decoded input before any object/array expansion.
 if pg_catalog.jsonb_typeof(p_request)is distinct from 'object'
 or pg_catalog.octet_length(p_request::text)>131072 then
  raise exception 'configuration_invalid'using errcode='23514';end if;
 perform public.controlled_stock_keys(p_request,array['schema_version','kind','scope','version',
  'predecessor_id','predecessor_hash','enabled','body','approval_reference']);
 if pg_catalog.jsonb_typeof(p_request->'schema_version')is distinct from 'number'
 or p_request->>'schema_version'<>'1'
 or pg_catalog.jsonb_typeof(p_request->'version')is distinct from 'number'
 or (p_request->>'version')!~'^[1-9][0-9]{0,9}$'
 or pg_catalog.jsonb_typeof(p_request->'enabled')is distinct from 'boolean'
 or pg_catalog.jsonb_typeof(p_request->'kind')is distinct from 'string'then
  raise exception 'configuration_invalid'using errcode='23514';end if;
 v_version:=(p_request->>'version')::integer;
 v_kind:=p_request->>'kind';v_enabled:=(p_request->>'enabled')::boolean;
 if v_version<1 or not(v_kind=any(array['administration','policy','eligibility','calendar','routing']))then
  raise exception 'configuration_invalid'using errcode='23514';end if;
 if v_version=1 then
  if p_request->'predecessor_id'is distinct from 'null'::jsonb
  or p_request->'predecessor_hash'is distinct from 'null'::jsonb then
   raise exception 'configuration_invalid'using errcode='23514';end if;
 else
  perform public.controlled_stock_uuid(p_request->'predecessor_id');
  if pg_catalog.jsonb_typeof(p_request->'predecessor_hash')is distinct from 'string'
  or (p_request->>'predecessor_hash')!~'^[0-9a-f]{64}$'then
   raise exception 'configuration_invalid'using errcode='23514';end if;
 end if;
 perform public.controlled_stock_text(p_request->'approval_reference',200,false);
 v_scope:=p_request->'scope';v_body:=p_request->'body';
 perform public.controlled_stock_keys(v_scope,array['product_id','site_id','event_kind','capability']);
 perform public.controlled_stock_uuid(v_scope->'product_id');
 if v_kind='administration'then
  if v_scope->'site_id'is distinct from 'null'::jsonb
  or v_scope->'event_kind'is distinct from 'null'::jsonb
  or v_scope->'capability'is distinct from 'null'::jsonb then
   raise exception 'configuration_invalid'using errcode='23514';end if;
 elsif v_kind='eligibility'then
  if pg_catalog.jsonb_typeof(v_scope->'capability')is distinct from 'string'then
   raise exception 'configuration_invalid'using errcode='23514';end if;
  if v_scope->>'capability'='exception_read'then
   if v_scope->'site_id'is distinct from 'null'::jsonb
   or v_scope->'event_kind'is distinct from 'null'::jsonb then
    raise exception 'configuration_invalid'using errcode='23514';end if;
  elsif v_scope->>'capability'=any(array['read','review'])then
   perform public.controlled_stock_uuid(v_scope->'site_id');
   if pg_catalog.jsonb_typeof(v_scope->'event_kind')is distinct from 'string'
   or not((v_scope->>'event_kind')=any(v_kinds))then
    raise exception 'configuration_invalid'using errcode='23514';end if;
  else raise exception 'configuration_invalid'using errcode='23514';end if;
 else
  perform public.controlled_stock_uuid(v_scope->'site_id');
  if v_scope->'event_kind'is distinct from 'null'::jsonb
  or v_scope->'capability'is distinct from 'null'::jsonb then
   raise exception 'configuration_invalid'using errcode='23514';end if;
 end if;
 if v_kind=any(array['administration','eligibility','routing'])then
  perform public.controlled_stock_keys(v_body,array['members']);v_members:=v_body->'members';
  if pg_catalog.jsonb_typeof(v_members)is distinct from 'array'then
   raise exception 'configuration_invalid'using errcode='23514';end if;
  v_count:=pg_catalog.jsonb_array_length(v_members);
  if v_count>100 or(v_enabled and v_count=0)then
   raise exception 'configuration_invalid'using errcode='23514';end if;
  for v_member in select roster_entry.value from pg_catalog.jsonb_array_elements(v_members)as roster_entry(value)loop
   if v_kind='administration'then
    perform public.controlled_stock_keys(v_member,array['actor_id','roles','capabilities']);
   else perform public.controlled_stock_keys(v_member,array['actor_id','roles']);end if;
   v_actor:=public.controlled_stock_uuid(v_member->'actor_id')::text;
   if v_previous_actor is not null and v_actor collate "C"<=v_previous_actor collate "C"then
    raise exception 'configuration_invalid'using errcode='23514';end if;
   v_previous_actor:=v_actor;
   foreach v_field in array(case when v_kind='administration'then array['roles','capabilities']else array['roles']end)loop
    v_values:=v_member->v_field;
    if pg_catalog.jsonb_typeof(v_values)is distinct from 'array'then
     raise exception 'configuration_invalid'using errcode='23514';end if;
    v_count:=pg_catalog.jsonb_array_length(v_values);
    if(v_field='roles'and v_count not between 1 and 4)
    or(v_field='capabilities'and v_count>6)then
     raise exception 'configuration_invalid'using errcode='23514';end if;
    v_previous_label:=null;
    for v_item in select member_value.value from pg_catalog.jsonb_array_elements(v_values)as member_value(value)loop
     if pg_catalog.jsonb_typeof(v_item)is distinct from 'string'then
      raise exception 'configuration_invalid'using errcode='23514';end if;
     v_label:=v_item#>>'{}';
     if(v_field='roles'and not(v_label=any(array['ADMIN','DVM','STAFF','TECH'])))
     or(v_field='capabilities'and not(v_label=any(array['audit','manage_eligibility','manage_escalation','publish_calendar','publish_policy','publish_routing'])))
     or(v_previous_label is not null and v_label collate "C"<=v_previous_label collate "C")then
      raise exception 'configuration_invalid'using errcode='23514';end if;
     v_previous_label:=v_label;
    end loop;
   end loop;
  end loop;
 elsif v_kind='policy'then
  perform public.controlled_stock_keys(v_body,array['effective_from','calendar_id','routing_id','native_deadline_kind','rules']);
  perform public.controlled_stock_keys(v_body->'effective_from',array['mode','at']);
  if pg_catalog.jsonb_typeof(v_body->'effective_from'->'mode')is distinct from 'string'then
   raise exception 'configuration_invalid'using errcode='23514';end if;
  if v_body->'effective_from'->>'mode'='now'then
   if v_body->'effective_from'->'at'is distinct from 'null'::jsonb then
    raise exception 'configuration_invalid'using errcode='23514';end if;
  elsif v_body->'effective_from'->>'mode'='at'then
   v_stamp:=v_body->'effective_from'->'at';
   if pg_catalog.jsonb_typeof(v_stamp)is distinct from 'string'
   or(v_stamp#>>'{}')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$'then
    raise exception 'configuration_invalid'using errcode='23514';end if;
   v_stamp_value:=(v_stamp#>>'{}')::timestamptz;
   if not pg_catalog.isfinite(v_stamp_value)
   or v_stamp_value<timestamptz '2026-01-01 00:00:00+00'
   or v_stamp_value>=timestamptz '2101-01-01 00:00:00+00'
   or pg_catalog.to_char(v_stamp_value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>v_stamp#>>'{}'then
    raise exception 'configuration_invalid'using errcode='23514';end if;
  else raise exception 'configuration_invalid'using errcode='23514';end if;
  foreach v_field in array array['calendar_id','routing_id']loop
   if v_body->v_field is distinct from 'null'::jsonb then perform public.controlled_stock_uuid(v_body->v_field);end if;
  end loop;
  if v_body->'native_deadline_kind'='null'::jsonb then v_choice:=null;
  elsif pg_catalog.jsonb_typeof(v_body->'native_deadline_kind')='string'
  and(v_body->>'native_deadline_kind')=any(array['record_native_dispense','record_native_pickup'])then
   v_choice:=v_body->>'native_deadline_kind';
  else raise exception 'configuration_invalid'using errcode='23514';end if;
  v_rules:=v_body->'rules';
  -- Exact fixed keyset without expanding an unadmitted rules object.
  if pg_catalog.jsonb_typeof(v_rules)is distinct from 'object'
  or not(v_rules?&v_kinds)or(v_rules-v_kinds)<>'{}'::jsonb then
   raise exception 'configuration_invalid'using errcode='23514';end if;
  foreach v_event_kind in array v_kinds loop
   v_rule:=v_rules->v_event_kind;
   perform public.controlled_stock_keys(v_rule,array['enabled','adapter_version','meaning','quorum','deadline_mode','deadline_anchor','escalation_mode']);
   if pg_catalog.jsonb_typeof(v_rule->'enabled')is distinct from 'boolean'
   or pg_catalog.jsonb_typeof(v_rule->'adapter_version')is distinct from 'number'
   or v_rule->>'adapter_version'<>'1'
   or pg_catalog.jsonb_typeof(v_rule->'quorum')is distinct from 'number'
   or v_rule->>'quorum'<>'1'
   or v_rule->'meaning'is distinct from '"independent_record_review_v1"'::jsonb then
    raise exception 'configuration_invalid'using errcode='23514';end if;
   v_rule_enabled:=(v_rule->>'enabled')::boolean;
   v_expected_mode:='not_configured';v_expected_escalation:='not_configured';
   if v_event_kind=any(array['receive_inventory','adjust_inventory','record_patient_treatment',
    'record_anesthesia_drug_administration','record_native_dispense','record_native_pickup',
    'record_native_dispense_return:intake','record_native_dispense_return:dispose','record_native_dispense_return:restock',
    'record_native_dispense_return_v2:intake','record_native_dispense_return_v2:dispose','record_native_dispense_return_v2:restock'])then
    v_expected_anchor:='observed_at';
   else v_expected_anchor:='recorded_at';end if;
   if v_rule_enabled and(v_event_kind=any(array['record_patient_treatment','record_anesthesia_drug_administration'])or v_event_kind=v_choice)then
    v_expected_mode:='next_staffed_day_close';v_expected_escalation:='overdue';
   elsif v_rule_enabled and v_event_kind='record_native_return_discrepancy:report'then
    v_expected_escalation:='immediate_on_record';end if;
   if v_event_kind=v_choice and not v_rule_enabled then
    raise exception 'configuration_invalid'using errcode='23514';end if;
   if pg_catalog.jsonb_typeof(v_rule->'deadline_mode')is distinct from 'string'
   or pg_catalog.jsonb_typeof(v_rule->'deadline_anchor')is distinct from 'string'
   or pg_catalog.jsonb_typeof(v_rule->'escalation_mode')is distinct from 'string'
   or v_rule->>'deadline_mode'<>v_expected_mode
   or v_rule->>'deadline_anchor'<>v_expected_anchor
   or v_rule->>'escalation_mode'<>v_expected_escalation then
    raise exception 'configuration_invalid'using errcode='23514';end if;
   v_calendar_required:=v_calendar_required or v_expected_mode='next_staffed_day_close';
   v_routing_required:=v_routing_required or v_expected_escalation=any(array['overdue','immediate_on_record']);
  end loop;
  if(v_calendar_required and v_body->'calendar_id'='null'::jsonb)
  or(v_routing_required and v_body->'routing_id'='null'::jsonb)then
   raise exception 'configuration_invalid'using errcode='23514';end if;
 else
  perform public.controlled_stock_keys(v_body,array['zone','first_date','last_date','days']);
  if pg_catalog.jsonb_typeof(v_body->'zone')is distinct from 'string'then
   raise exception 'configuration_invalid'using errcode='23514';end if;
  v_zone:=v_body->>'zone';
  if pg_catalog.octet_length(v_zone)not between 1 and 100
  or pg_catalog.octet_length(v_zone)<>pg_catalog.char_length(v_zone)
  or(v_zone<>'UTC'and(v_zone!~'^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)+$'
   or v_zone like 'posix/%'or v_zone like 'right/%'))then
   raise exception 'configuration_invalid'using errcode='23514';end if;
  if pg_catalog.jsonb_typeof(v_body->'first_date')is distinct from 'string'
  or pg_catalog.jsonb_typeof(v_body->'last_date')is distinct from 'string'
  or(v_body->>'first_date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or(v_body->>'last_date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'then
   raise exception 'configuration_invalid'using errcode='23514';end if;
  v_first:=(v_body->>'first_date')::date;v_last:=(v_body->>'last_date')::date;
  if v_first<date '2026-01-01'or v_last>=date '2101-01-01'or v_last-v_first not between 0 and 30
  or pg_catalog.to_char(v_first,'YYYY-MM-DD')<>v_body->>'first_date'
  or pg_catalog.to_char(v_last,'YYYY-MM-DD')<>v_body->>'last_date'then
   raise exception 'configuration_invalid'using errcode='23514';end if;
  if pg_catalog.jsonb_typeof(v_body->'days')is distinct from 'array'then
   raise exception 'configuration_invalid'using errcode='23514';end if;
  if pg_catalog.jsonb_array_length(v_body->'days')<>v_last-v_first+1 then
   raise exception 'configuration_invalid'using errcode='23514';end if;
  for v_day in select calendar_day.value from pg_catalog.jsonb_array_elements(v_body->'days')as calendar_day(value)loop
   perform public.controlled_stock_keys(v_day,array['date','staffed','start_utc','end_utc','close_local','close_fold','close_utc']);
   v_date:=v_first+v_index;v_index:=v_index+1;
   if v_day->'date'is distinct from pg_catalog.to_jsonb(pg_catalog.to_char(v_date,'YYYY-MM-DD'))
   or pg_catalog.jsonb_typeof(v_day->'staffed')is distinct from 'boolean'then
    raise exception 'configuration_invalid'using errcode='23514';end if;
   v_stamps:=array[v_day->'start_utc',v_day->'end_utc'];
   if(v_day->>'staffed')::boolean then
    if pg_catalog.jsonb_typeof(v_day->'close_local')is distinct from 'string'
    or(v_day->>'close_local')!~'^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'
    or pg_catalog.jsonb_typeof(v_day->'close_fold')is distinct from 'number'
    or(v_day->>'close_fold')not in('0','1')then
     raise exception 'configuration_invalid'using errcode='23514';end if;
    v_stamps:=pg_catalog.array_append(v_stamps,v_day->'close_utc');
   elsif v_day->'close_local'is distinct from 'null'::jsonb
   or v_day->'close_fold'is distinct from 'null'::jsonb
   or v_day->'close_utc'is distinct from 'null'::jsonb then
    raise exception 'configuration_invalid'using errcode='23514';end if;
   foreach v_stamp in array v_stamps loop
    if pg_catalog.jsonb_typeof(v_stamp)is distinct from 'string'
    or(v_stamp#>>'{}')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$'then
     raise exception 'configuration_invalid'using errcode='23514';end if;
    v_stamp_value:=(v_stamp#>>'{}')::timestamptz;
    if not pg_catalog.isfinite(v_stamp_value)
    or v_stamp_value<timestamptz '2026-01-01 00:00:00+00'
    or v_stamp_value>=timestamptz '2101-01-01 00:00:00+00'
    or pg_catalog.to_char(v_stamp_value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>v_stamp#>>'{}'then
     raise exception 'configuration_invalid'using errcode='23514';end if;
   end loop;
   v_start:=(v_day->>'start_utc')::timestamptz;v_end:=(v_day->>'end_utc')::timestamptz;
   if v_end<=v_start or(v_previous_end is not null and v_start<>v_previous_end)then
    raise exception 'configuration_invalid'using errcode='23514';end if;
   v_previous_end:=v_end;
   if(v_day->>'staffed')::boolean then
    v_close:=(v_day->>'close_utc')::timestamptz;
    if v_close<=v_start or v_close>=v_end then
     raise exception 'configuration_invalid'using errcode='23514';end if;
   end if;
  end loop;
 end if;
 return p_request;
exception
 when check_violation or invalid_text_representation or numeric_value_out_of_range
 or invalid_datetime_format or datetime_field_overflow then
  raise exception 'configuration_invalid'using errcode='23514';
end;
-- END FUNCTION validate_configuration
