-- PRIVATE OWNED LOCAL CANDIDATE ONLY. Capture the actual canonical204
-- definitions BEFORE installing the overlay, changing only their names/schema:
-- pg_temp.controlled_original_hash(jsonb)
-- pg_temp.controlled_original_decimal(numeric)
-- pg_temp.controlled_original_receipt(public.native_fulfillment_operations)
-- Those independent SQL oracles and this file must run on the SAME connection.
-- This test creates only temporary objects and rolls back its own transaction.
begin;set local timezone='UTC';
do $$begin perform set_config('request.jwt.claims','{}',true);end$$;
create temp table scalar_overlay_checks(family text not null,label text primary key,detail jsonb not null);
create temp table scalar_overlay_memory(value jsonb not null);
create function pg_temp.scalar_overlay_assert(value boolean,family text,label text,detail jsonb default '{}')returns void
language plpgsql as $$begin
 if value is distinct from true then raise exception 'Scalar overlay differential failed: %',label;end if;
 insert into scalar_overlay_checks values(family,label,detail);
end$$;

-- The expected paths must still be SQL-language captured originals, while the
-- actual helpers must be the deliberate candidate-local PL/pgSQL overlays.
do $$declare item record;original_language text;actual_language text;begin
 for item in select *from(values
  ('hash','pg_temp.controlled_original_hash(jsonb)','public.native_fulfillment_hash(jsonb)'),
  ('decimal','pg_temp.controlled_original_decimal(numeric)','public.native_fulfillment_decimal(numeric)'),
  ('receipt','pg_temp.controlled_original_receipt(public.native_fulfillment_operations)','public.native_fulfillment_receipt(public.native_fulfillment_operations)'))x(label,original_signature,actual_signature)loop
  select l.lanname into original_language from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(item.original_signature);
  select l.lanname into actual_language from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(item.actual_signature);
  perform pg_temp.scalar_overlay_assert(original_language='sql','contract','independent_original_sql_'||item.label);
  perform pg_temp.scalar_overlay_assert(actual_language='plpgsql','contract','actual_overlay_plpgsql_'||item.label);
 end loop;
end$$;

do $$declare item record;payload jsonb;expected text;actual text;begin
 for item in select *from(values
  ('sql_null',null::jsonb),('json_null','null'::jsonb),('string_null','"null"'::jsonb),
  ('numeric_zero','0'::jsonb),('numeric_scaled','1.2300'::jsonb),('boolean','true'::jsonb),
  ('unicode','{"text":"München — 猫","escaped":"a\\nb"}'::jsonb),
  ('empty_object','{}'::jsonb),('array','[null,1.000,"2026-10-18T18:45:00-06:00"]'::jsonb),
  ('nested_null','{"b":null,"a":{"z":false,"x":"2026-10-19T06:30:00+05:45"}}'::jsonb))x(label,payload)loop
  payload:=item.payload;
  select pg_temp.controlled_original_hash(payload)into expected;
  actual:=public.native_fulfillment_hash(payload);
  perform pg_temp.scalar_overlay_assert(actual is not distinct from expected
   and convert_to(actual,'UTF8')is not distinct from convert_to(expected,'UTF8'),
   'hash','hash_'||item.label,jsonb_build_object('actual_sql_null',actual is null,'original_sql_null',expected is null));
 end loop;
end$$;

-- Exceptional numeric inputs must preserve the original outcome and SQLSTATE;
-- successful values preserve exact text, including canonical scale/rounding.
do $$declare item record;quantity numeric;expected text;actual text;expected_state text;actual_state text;expected_message text;actual_message text;begin
 for item in select *from(values
  ('sql_null',null::numeric),('zero',0::numeric),('negative_zero','-0.000'::numeric),
  ('fraction','0.125'::numeric),('extra_scale_down','0.1234'::numeric),('extra_scale_up','0.1235'::numeric),
  ('negative_half','-0.1235'::numeric),('trailing_scale','1.00000'::numeric),
  ('large_positive','99999999999.999'::numeric),('large_negative','-99999999999.999'::numeric),
  ('format_overflow',repeat('9',80)::numeric),('nan','NaN'::numeric),
  ('positive_infinity','Infinity'::numeric),('negative_infinity','-Infinity'::numeric))x(label,quantity)loop
  quantity:=item.quantity;expected:=null;actual:=null;expected_state:=null;actual_state:=null;expected_message:=null;actual_message:=null;
  begin
   select pg_temp.controlled_original_decimal(quantity)into expected;
  exception when others then get stacked diagnostics expected_state=RETURNED_SQLSTATE,expected_message=MESSAGE_TEXT;
  end;
  begin
   actual:=public.native_fulfillment_decimal(quantity);
  exception when others then get stacked diagnostics actual_state=RETURNED_SQLSTATE,actual_message=MESSAGE_TEXT;
  end;
  perform pg_temp.scalar_overlay_assert(actual_state is not distinct from expected_state
   and actual_message is not distinct from expected_message
   and(actual_state is not null or(actual is not distinct from expected
    and convert_to(actual,'UTF8')is not distinct from convert_to(expected,'UTF8'))),
   'decimal','decimal_'||item.label,jsonb_build_object('original_sqlstate',expected_state,'actual_sqlstate',actual_state,
    'original_message',expected_message,'actual_message',actual_message,
    'actual_sql_null',actual is null,'original_sql_null',expected is null));
 end loop;
end$$;

-- Do not force UTC inside the actual receipt. Its original ambient caller zone
-- must remain observable in the typed created_at field. Nested JSON strings keep
-- their original offset spelling. No existing stock/native operation is needed.
do $$declare zone text;label text;row_value public.native_fulfillment_operations;expected jsonb;actual jsonb;
 expected_bytes bytea;actual_bytes bytea;expected_hash text;actual_hash text;begin
 foreach zone in array array['UTC','America/Denver','Asia/Kathmandu']loop
  perform set_config('TimeZone',zone,true);
  foreach label in array array['sql_null','all_null_fields','typed_timestamp','populated_nested']loop
   if label='sql_null'then row_value:=null::public.native_fulfillment_operations;
   elsif label='all_null_fields'then row_value:=jsonb_populate_record(null::public.native_fulfillment_operations,'{}'::jsonb);
   elsif label='typed_timestamp'then row_value:=jsonb_populate_record(null::public.native_fulfillment_operations,
    '{"created_at":"2026-10-18T18:45:00-06:00"}'::jsonb);
   else row_value:=jsonb_populate_record(null::public.native_fulfillment_operations,jsonb_build_object(
    'id','e7110000-0000-4000-8000-000000000001','actor_id','e7110000-0000-4000-8000-000000000002',
    'operation','dispense','request',jsonb_build_object('offset_spelling','2026-10-18T18:45:00-06:00','null_value',null,'quantity',1.2300),
    'request_hash',repeat('a',64),'result',jsonb_build_object('untouched_offset','2026-10-19T06:30:00+05:45','mixed_array',jsonb_build_array(null,true,0.125)),
    'created_at','2026-10-18T18:45:00-06:00'));
   end if;
   select pg_temp.controlled_original_receipt(row_value)into expected;
   actual:=public.native_fulfillment_receipt(row_value);
   expected_bytes:=convert_to(expected::text,'UTF8');actual_bytes:=convert_to(actual::text,'UTF8');
   expected_hash:=encode(sha256(expected_bytes),'hex');actual_hash:=encode(sha256(actual_bytes),'hex');
   perform pg_temp.scalar_overlay_assert(actual is not distinct from expected
    and actual::text is not distinct from expected::text and actual_bytes is not distinct from expected_bytes
    and actual_hash is not distinct from expected_hash,
    'receipt','receipt_'||label||'_'||zone,jsonb_build_object('caller_timezone',zone,
     'jsonb_text_exact',actual::text is not distinct from expected::text,'utf8_bytes_exact',actual_bytes is not distinct from expected_bytes,
     'utf8_sha256_exact',actual_hash is not distinct from expected_hash));
  end loop;
 end loop;
end$$;
set local timezone='UTC';

-- Parent-prime the actual canonical name, then repeatedly call that exact name
-- using the same invocation style that previously retained SQL-function state.
-- Zero native SQL contexts is valid: the actual helper is now PL/pgSQL, asserted
-- above. Original-oracle contexts have a different ident and are not included.
do $$declare payload jsonb;expected text;actual text;before_bytes bigint;after_bytes bigint;
 before_contexts integer;after_contexts integer;iteration integer;begin
 payload:=jsonb_build_object('payload',repeat('x',16384),'iteration',0);
 select pg_temp.controlled_original_hash(payload)into expected;
 actual:=public.native_fulfillment_hash(payload);
 if actual is distinct from expected then raise exception 'Parent-primed scalar hash differs';end if;
 select coalesce(sum(total_bytes),0),count(*)into before_bytes,before_contexts from pg_backend_memory_contexts
 where name='SQL function'and ident='native_fulfillment_hash';
 for iteration in 1..128 loop
  payload:=jsonb_build_object('payload',repeat('x',16384),'iteration',iteration);
  select pg_temp.controlled_original_hash(payload)into expected;
  actual:=public.native_fulfillment_hash(payload);
  if actual is distinct from expected then raise exception 'Repeated overlaid hash differs at iteration %',iteration;end if;
 end loop;
 select coalesce(sum(total_bytes),0),count(*)into after_bytes,after_contexts from pg_backend_memory_contexts
 where name='SQL function'and ident='native_fulfillment_hash';
 perform pg_temp.scalar_overlay_assert(after_bytes-before_bytes<262144,'memory','parent_primed_canonical_hash_growth_under256KiB');
 insert into scalar_overlay_memory values(jsonb_build_object('calls',128,'payload_characters',16384,
  'canonical_context_name','SQL function','canonical_context_ident','native_fulfillment_hash',
  'before_contexts',before_contexts,'after_contexts',after_contexts,
  'before_total_bytes',before_bytes,'after_total_bytes',after_bytes,'growth_bytes',after_bytes-before_bytes,
  'maximum_growth_bytes_exclusive',262144,'parent_actual_helper_primed',true,
  'all_repeated_outputs_match_independent_original',true,'pinned_environment_regression_only',true));
end$$;
select jsonb_build_object('kind','controlled-scalar-overlay-differential-v1','passed',true,
 'semantic_cases',(select count(*)from scalar_overlay_checks where family in('hash','decimal','receipt')),
 'contract_checks',(select count(*)from scalar_overlay_checks where family='contract'),
 'case_counts_by_family',(select jsonb_object_agg(family,n)from(select family,count(*)n from scalar_overlay_checks group by family)x),
 'case_details',(select jsonb_object_agg(label,detail)from scalar_overlay_checks),
 'memory_regression',(select value from scalar_overlay_memory),
 'independent_original_204_sql_oracles',true,'sql_only',true,'genuine_auth_api',false,
 'source_data_writes',0,'clinical_or_register_activation',false,'transaction_rolled_back',true);
rollback;
