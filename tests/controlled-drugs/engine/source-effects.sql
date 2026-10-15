-- Read-only reference obligations, not posting or permission to handle a drug.
-- Future engine posting must independently reconcile these to reviewed heads,
-- actual containers, approved policy and a live owned execution context.
create function pg_temp.controlled_stock_source_effects(
 p_writer text,p_root uuid,p_actor uuid,p_result jsonb
)returns jsonb language plpgsql volatile security invoker
set search_path=public,pg_temp set timezone='UTC' as $$
declare b jsonb:=pg_temp.controlled_stock_source_bundle(p_writer,p_root,p_actor,p_result);
 n jsonb:=b->'native';a jsonb;original jsonb;available jsonb:=b->'available';
 custody jsonb:='[]';kind text:=n->>'kind';action text;delta numeric;
 lot uuid;allocation uuid;movement uuid;intake uuid;dispense uuid;quantity numeric;
 prepared_factor integer;held_factor integer;basis text:='stock_record';requirements jsonb:='{}';
begin
 if n<>'null'::jsonb then dispense:=(n->>'dispense_id')::uuid;end if;
 if kind in('dispense','pickup')then
  basis:=case kind when 'dispense'then 'preparation_record'else 'handoff_record'end;
  requirements:=case kind when 'pickup'then
   '{"complete_original_prepared_package":true,"expected_container_heads_required":true}'::jsonb
   else '{"exact_available_container_allocations_required":true}'::jsonb end;
  for a in select value from jsonb_array_elements(n->'original_allocations')loop
   quantity:=(a->>'quantity')::numeric;allocation:=(a->>'allocation_id')::uuid;lot:=(a->>'lot_id')::uuid;
   if quantity<=0 then raise exception 'Positive original custody allocation required'using errcode='23514';end if;
   if kind='dispense'then
    if(select count(*)from jsonb_array_elements(available)m where m->>'id'=a->>'movement_id'
     and m->>'lot_id'=lot::text and(m->>'quantity_delta')::numeric=-quantity)<>1 then
     raise exception 'Exact original available debit required'using errcode='23514';end if;
   end if;
   custody:=custody||jsonb_build_array(jsonb_build_object('source_kind',kind,'source_id',p_root,
    'allocation_id',allocation,'lot_id',lot,'dispense_id',dispense,'intake_id',null,
    'channel','prepared','quantity_delta',(case kind when 'dispense'then quantity else -quantity end)::text));
  end loop;
 elsif kind='return'then
  action:=n#>>'{return_source,action}';intake:=(n#>>'{return_source,intake_id}')::uuid;
  if action is distinct from n#>>'{document,action}'or intake is null then
   raise exception 'Exact return action and intake identity required'using errcode='23514';end if;
  basis:=case when action like 'retract_%'then 'correction_assertion'else 'custody_record'end;
  -- These are explicit eligibility requirements, not an authorization result.
  -- A recorded-in-error pickup amendment never proves clinic-retained custody.
  requirements:=jsonb_build_object('original_intake_id',intake,
   'original_intake_custody',n#>'{return_source,intake_document,custody}',
   'clinic_retained_before_handoff_required',true,
   'actual_original_pickup_must_be_checked',true,'expected_container_heads_required',true,
   'explicit_restock_destination_required',action in('restock','retract_restock'));
  case action
   when 'intake'then prepared_factor:=-1;held_factor:=1;
   when 'dispose'then prepared_factor:=0;held_factor:=-1;
   when 'restock'then prepared_factor:=0;held_factor:=-1;
   when 'retract_intake'then prepared_factor:=1;held_factor:=-1;
   when 'retract_disposal'then prepared_factor:=0;held_factor:=1;
   when 'retract_restock'then prepared_factor:=0;held_factor:=1;
   else raise exception 'Reviewed return source action required'using errcode='23514';
  end case;
  if jsonb_array_length(n#>'{document,allocations}')not between 1 and 100 then
   raise exception 'Bounded exact return allocation membership required'using errcode='23514';end if;
  if(select count(*)<>count(distinct value->>'allocation_id')from jsonb_array_elements(n#>'{document,allocations}'))then
   raise exception 'Unique return source allocation required'using errcode='23514';end if;
  for a in select value from jsonb_array_elements(n#>'{document,allocations}')loop
   allocation:=(a->>'allocation_id')::uuid;lot:=(a->>'lot_id')::uuid;quantity:=(a->>'quantity')::numeric;
   select value into original from jsonb_array_elements(n->'original_allocations')
    where value->>'allocation_id'=allocation::text and value->>'lot_id'=lot::text;
   if original is null or quantity<=0 or quantity>(original->>'quantity')::numeric then
    raise exception 'Exact positive original return allocation required'using errcode='23514';end if;
   if action in('restock','retract_restock')then
    movement:=(a->>'movement_id')::uuid;delta:=case action when 'restock'then quantity else -quantity end;
    if movement is null or(select count(*)from jsonb_array_elements(available)m where
     m->>'id'=movement::text and m->>'lot_id'=lot::text and(m->>'quantity_delta')::numeric=delta)<>1 then
     raise exception 'Exact signed available return movement required'using errcode='23514';end if;
   elsif a->'movement_id'is distinct from 'null'::jsonb then
    raise exception 'Custody-only source cannot invent available stock'using errcode='23514';
   end if;
   if prepared_factor<>0 then
    custody:=custody||jsonb_build_array(jsonb_build_object('source_kind','return','source_id',p_root,
     'allocation_id',allocation,'lot_id',lot,'dispense_id',dispense,'intake_id',null,
     'channel','prepared','quantity_delta',(quantity*prepared_factor)::text));
   end if;
   custody:=custody||jsonb_build_array(jsonb_build_object('source_kind','return','source_id',p_root,
    'allocation_id',allocation,'lot_id',lot,'dispense_id',dispense,'intake_id',intake,
    'channel','return_held','quantity_delta',(quantity*held_factor)::text));
  end loop;
  if jsonb_array_length(available)<>(case when action in('restock','retract_restock')then
   jsonb_array_length(n#>'{document,allocations}')else 0 end)then
   raise exception 'Every available return movement must have one exact allocation'using errcode='23514';end if;
 elsif kind='discrepancy'then
  basis:='discrepancy_assertion';
  requirements:='{"native_and_controlled_holds_must_compose":true}'::jsonb;
 elsif kind='correction'then
  basis:='annotation';
  requirements:='{"annotation_cannot_restore_stock_or_prove_physical_return":true}'::jsonb;
 end if;
 return jsonb_build_object('version',1,'writer',p_writer,'root',p_root,'actor_id',p_actor,
  'product_id',b->'product_id','basis',basis,'available',available,'custody',custody,
  'requirements',requirements,'authorizes_execution',false);
end $$;
revoke all on function pg_temp.controlled_stock_source_effects(text,uuid,uuid,jsonb)from public,anon,authenticated,service_role;
