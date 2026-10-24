-- Private internal accumulator guard tests only. These small JSON rows are
-- deliberately synthetic helper inputs, NOT fabricated persisted source events
-- and NOT positive production evidence for100 allocations or512 source rows.
begin;
create temp table review_v3_accumulator_proof(label text primary key);
do $$
declare state jsonb;before_value jsonb;row_value jsonb;key_value jsonb;identity text;
 relation text;counter_name text;message text;i integer;
begin
 state:='{"rows":{},"documents":[],"allocations":[]}'::jsonb;
 for i in 1..512 loop
  key_value:=jsonb_build_object('id','b0030000-0000-4000-8000-'||lpad(i::text,12,'0'));
  state:=controlled_review_v3.adapter_add(state,'public.inventory_movements',key_value,key_value,'retained_context');
 end loop;
 if(select count(*)from jsonb_object_keys(state->'rows'))<>512 then
  raise exception 'Internal accumulator512-row boundary did not retain all rows';end if;
 insert into review_v3_accumulator_proof values('512_distinct_internal_rows_retained');
 key_value:=jsonb_build_object('id','b0030000-0000-4000-8000-000000000001');
 identity:=jsonb_build_array('public.inventory_movements',key_value)::text;
 state:=controlled_review_v3.adapter_add(state,'public.inventory_movements',key_value,key_value,'reviewed_target');
 if(select count(*)from jsonb_object_keys(state->'rows'))<>512
  or state#>>array['rows',identity,'role']is distinct from 'reviewed_target'then
  raise exception 'Internal deduplication or deterministic role precedence failed';end if;
 before_value:=state;
 state:=controlled_review_v3.adapter_add(state,'public.inventory_movements',key_value,key_value,'retained_context');
 if state is distinct from before_value then raise exception 'Lower-priority duplicate changed evidence';end if;
 insert into review_v3_accumulator_proof values('duplicate_at_capacity_and_role_precedence');
 begin
  key_value:=jsonb_build_object('id','b0030000-0000-4000-8000-000000000513');
  perform controlled_review_v3.adapter_add(state,'public.inventory_movements',key_value,key_value,'retained_context');
  raise exception 'Internal513th distinct row was not refused'using errcode='P0002';
 exception when sqlstate '54000'then
  get stacked diagnostics message=MESSAGE_TEXT;
  if message<>'evidence_limit_exceeded'then raise;end if;
  insert into review_v3_accumulator_proof values('513th_distinct_row_refused');
 end;
 if state is distinct from before_value then raise exception 'Overflow changed prior accumulator';end if;
 begin
  key_value:=jsonb_build_object('id','b0030000-0000-4000-8000-000000000001');
  perform controlled_review_v3.adapter_add(state,'public.inventory_movements',key_value,key_value||'{"changed":true}'::jsonb,'reviewed_target');
  raise exception 'Conflicting same-key source row was not refused'using errcode='P0002';
 exception when check_violation then
  get stacked diagnostics message=MESSAGE_TEXT;
  if message<>'adapter_source_role_conflict'then raise;end if;
  insert into review_v3_accumulator_proof values('same_key_different_full_row_refused');
 end;
 foreach relation in array array['public.native_dispense_allocations','public.native_return_events']loop
  counter_name:=case relation when 'public.native_dispense_allocations'then 'allocations'else 'documents'end;
  state:='{"rows":{},"documents":[],"allocations":[]}'::jsonb;
  for i in 1..100 loop
   key_value:=jsonb_build_object('id','b0040000-0000-4000-8000-'||lpad(i::text,12,'0'));
   state:=controlled_review_v3.adapter_add(state,relation,key_value,key_value,'retained_context');
  end loop;
  if jsonb_array_length(state->counter_name)<>100 or(select count(*)from jsonb_object_keys(state->'rows'))<>100 then
   raise exception 'Internal100-source boundary did not retain exact membership';end if;
  before_value:=state;
  state:=controlled_review_v3.adapter_add(state,relation,key_value,key_value,'retained_context');
  if state is distinct from before_value then raise exception 'Duplicate consumed another internal source slot';end if;
  begin
   key_value:=jsonb_build_object('id','b0040000-0000-4000-8000-000000000101');
   perform controlled_review_v3.adapter_add(state,relation,key_value,key_value,'retained_context');
   raise exception 'Internal101st source was not refused'using errcode='P0002';
  exception when sqlstate '54000'then
   get stacked diagnostics message=MESSAGE_TEXT;
   if message<>'evidence_limit_exceeded'then raise;end if;
   insert into review_v3_accumulator_proof values(counter_name||'_100_duplicate_101_refusal');
  end;
 end loop;
 -- Multibyte evidence must use UTF-8 bytes, not character count. This is a
 -- deliberately oversized internal row, not an exact final-packet boundary.
 row_value:=jsonb_build_object('id','b0050000-0000-4000-8000-000000000001','payload',repeat('é',524288));
 if length(row_value::text)>=1048576 or octet_length(row_value::text)<=1048576 then
  raise exception 'Multibyte boundary fixture is not independently oversized';end if;
 begin
  perform controlled_review_v3.adapter_add('{"rows":{},"documents":[],"allocations":[]}'::jsonb,
   'public.inventory_movements',jsonb_build_object('id',row_value->'id'),row_value,'retained_context');
  raise exception 'Oversized UTF-8 source row was not refused'using errcode='P0002';
 exception when sqlstate '54000'then
  get stacked diagnostics message=MESSAGE_TEXT;
  if message<>'evidence_limit_exceeded'then raise;end if;
  insert into review_v3_accumulator_proof values('utf8_byte_overflow_refused');
 end;
end $$;
select jsonb_build_object('synthetic_internal_inputs_only',true,'production_fixture_boundary_claim',false,
 'checks',(select jsonb_agg(label order by label)from review_v3_accumulator_proof));
commit;
