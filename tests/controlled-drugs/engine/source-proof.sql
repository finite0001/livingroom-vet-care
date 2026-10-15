-- SQL-only source proof. No clinical policy, opening or execution is created.
create temp table controlled_source_results(writer text,root uuid,bundle jsonb,effects jsonb);
create temp table controlled_source_proof(value jsonb);
do $$declare r record;receipt jsonb;b jsonb;e jsonb;seen text[]:='{}';actions text[]:='{}';
 n integer:=0;actual_available jsonb;actual_total numeric;expected_total numeric;
 quantity numeric;delta numeric;action text;allocation jsonb;line_count integer;
 checks integer:=0;compensations integer:=0;role_name text;annotation_kinds integer;
 replay jsonb;replay_query text;stock_before bigint;billing_before bigint;anesthesia_replays integer:=0;other_actor uuid;
begin
 for r in
  select distinct writer,source_id as id,actor_id from stock_movement_sources
  union select writer,event_id,actor_id from stock_custody_sources
  union select 'record_native_return_discrepancy',event_id,actor_id from stock_discrepancy_sources
  union select 'record_native_pickup',event_id,actor_id from stock_pickup_sources
  union select 'append_native_dispense_correction',event_id,actor_id from stock_correction_sources
 loop
  -- Privileged synthetic SQL fixture claims are not cryptographic Auth proof.
  update profiles set is_active=true where id=r.actor_id;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',r.actor_id,'role','authenticated')::text,true);
  case r.writer
   when 'receive_inventory','adjust_inventory'then select to_jsonb(m)into receipt from inventory_movements m where m.id=r.id;
   when 'record_patient_treatment'then select to_jsonb(t)into receipt from patient_treatments t where t.id=r.id;
   when 'record_anesthesia_drug_administration'then select to_jsonb(t)into receipt from patient_treatments t where t.id=r.id;
   when 'record_native_dispense','record_native_pickup'then select native_fulfillment_receipt(o)into receipt from native_fulfillment_operations o where o.id=r.id;
   when 'record_native_dispense_return'then select native_return_receipt(o)into receipt from native_return_operations o where o.id=r.id;
   when 'record_native_dispense_return_v2'then receipt:=recover_native_dispense_return_v2(r.id);
   when 'record_native_return_discrepancy'then receipt:=recover_native_return_discrepancy(r.id);
   when 'append_native_dispense_correction'then select native_correction_receipt(o)into receipt from native_dispense_correction_operations o where o.id=r.id;
   else raise exception 'Unexpected source fixture';
  end case;
  case r.writer
   when 'receive_inventory'then
    select format('select to_jsonb(receive_inventory(%L::uuid,%L::uuid,%L::uuid,%L,%L::date,%L,%L::numeric,%L))',
     m.id,m.lot_id,l.product_id,l.lot_number,l.expires_on,l.location,m.quantity,m.reason)into replay_query
    from inventory_movements m join inventory_lots l on l.id=m.lot_id where m.id=r.id;
   when 'adjust_inventory'then
    select format('select to_jsonb(adjust_inventory(%L::uuid,%L::uuid,%L::numeric,%L))',m.id,m.lot_id,m.quantity,m.reason)
    into replay_query from inventory_movements m where m.id=r.id;
   when 'record_patient_treatment'then
    select format('select to_jsonb(record_patient_treatment(%L::uuid,%L::jsonb))',t.id,t.request::text)
    into replay_query from patient_treatments t where t.id=r.id;
   when 'record_anesthesia_drug_administration'then
    select format('select to_jsonb(record_anesthesia_drug_administration(%L::uuid,%L::uuid,%L::uuid,%L::jsonb))',
     a.id,a.record_id,a.pet_id,(a.request-'pet_id'-'source')::text)into replay_query from anesthesia_drug_administrations a where a.id=r.id;
   when 'record_native_dispense','record_native_pickup'then
    select format('select %I(%L::uuid,%L::jsonb)',r.writer,o.id,o.request::text)into replay_query
    from native_fulfillment_operations o where o.id=r.id;
   when 'record_native_dispense_return','record_native_dispense_return_v2'then
    select format('select %I(%L::uuid,%L::jsonb)',r.writer,o.id,o.request::text)into replay_query
    from native_return_operations o where o.id=r.id;
   when 'record_native_return_discrepancy'then
    select format('select record_native_return_discrepancy(%L::uuid,%L::jsonb)',o.id,o.request::text)
    into replay_query from native_return_discrepancy_operations o where o.id=r.id;
   when 'append_native_dispense_correction'then
    select format('select append_native_dispense_correction(%L::uuid,%L::jsonb)',o.id,o.request::text)
    into replay_query from native_dispense_correction_operations o where o.id=r.id;
  end case;
  select count(*)into stock_before from inventory_movements;
  select count(*)into billing_before from billing_invoice_items;
  execute replay_query into replay;
  if replay is distinct from receipt then raise exception 'Canonical producer returned a different receipt: %',r.writer;end if;
  checks:=checks+1;
  if(select count(*)from inventory_movements)<>stock_before or(select count(*)from billing_invoice_items)<>billing_before then
   raise exception 'Canonical receipt replay added stock or billing: %',r.writer;end if;
  checks:=checks+1;
  if r.writer='record_anesthesia_drug_administration'then
   begin
    perform pg_temp.controlled_stock_source_bundle(r.writer,r.id,r.actor_id,
     (select to_jsonb(a)from anesthesia_drug_administrations a where a.id=r.id));
    raise exception 'Anesthesia audit link accepted as the treatment receipt';
   exception when check_violation then null;end;
   anesthesia_replays:=anesthesia_replays+1;checks:=checks+1;
  end if;
  b:=pg_temp.controlled_stock_source_bundle(r.writer,r.id,r.actor_id,receipt);
  e:=pg_temp.controlled_stock_source_effects(r.writer,r.id,r.actor_id,receipt);
  if e->>'root'<>r.id::text or e->>'writer'<>r.writer or e->>'actor_id'<>r.actor_id::text
   or e->'product_id'is distinct from b->'product_id'or e->'authorizes_execution'is distinct from 'false'::jsonb then
   raise exception 'Incorrect source/effect identity or authorization claim';end if;
  if e?'observed_at'or e?'witnessed_at'then raise exception 'Source oracle fabricated physical observation';end if;
  checks:=checks+1;
  select coalesce(jsonb_agg(jsonb_build_object('kind','movement','id',m.id,'lot_id',m.lot_id,
   'product_id',l.product_id,'quantity_delta',m.quantity::text,'native_kind',m.kind)order by m.id),'[]'::jsonb)
  into actual_available from stock_movement_sources s join inventory_movements m on m.id=s.movement_id
  join inventory_lots l on l.id=m.lot_id where s.writer=r.writer and s.source_id=r.id;
  if e->'available'is distinct from actual_available then raise exception 'Available source membership changed or netted';end if;
  checks:=checks+1;
  select coalesce(sum((x->>'quantity_delta')::numeric),0)into actual_total from(
   select value x from jsonb_array_elements(e->'available')union all
   select value from jsonb_array_elements(e->'custody'))q;
  if b#>>'{native,kind}'='return'then
   action:=b#>>'{native,document,action}';actions:=array_append(actions,action);
   select coalesce(sum((a->>'quantity')::numeric),0)into quantity
    from jsonb_array_elements(b#>'{native,document,allocations}')a;
   expected_total:=case action when 'dispose'then -quantity when 'retract_disposal'then quantity else 0 end;
   if e#>>'{requirements,original_intake_id}'is distinct from b#>>'{native,return_source,intake_id}'
    or e#>'{requirements,original_intake_custody}'is distinct from b#>'{native,return_source,intake_document,custody}'
    or e#>'{requirements,clinic_retained_before_handoff_required}'is distinct from 'true'::jsonb
    or e#>'{requirements,actual_original_pickup_must_be_checked}'is distinct from 'true'::jsonb then
    raise exception 'Controlled custody requirements were inferred or lost';end if;
   for allocation in select value from jsonb_array_elements(b#>'{native,document,allocations}')loop
    quantity:=(allocation->>'quantity')::numeric;
    select count(*)into line_count from jsonb_array_elements(e->'custody')c where
     c->>'allocation_id'=allocation->>'allocation_id'and c->>'lot_id'=allocation->>'lot_id'
     and c->>'channel'='return_held'and c->>'intake_id'=b#>>'{native,return_source,intake_id}'
     and(c->>'quantity_delta')::numeric=quantity*case when action in('intake','retract_disposal','retract_restock')then 1 else -1 end;
    if line_count<>1 then raise exception 'Exact original held allocation was lost';end if;
   end loop;
   if action like 'retract_%'and e->>'basis'<>'correction_assertion'then
    raise exception 'Correction mislabeled as a new physical observation';end if;
   if action='retract_restock'then compensations:=compensations+jsonb_array_length(e->'available');end if;
  elsif b#>>'{native,kind}'='dispense'then
   expected_total:=0;
  elsif b#>>'{native,kind}'='pickup'then
   select -sum((a->>'quantity')::numeric)into expected_total from jsonb_array_elements(b#>'{native,original_allocations}')a;
   if jsonb_array_length(e->'available')<>0 or e#>'{requirements,complete_original_prepared_package}'is distinct from 'true'::jsonb then
    raise exception 'Pickup invented a debit or partial-handoff quantity';end if;
  elsif b#>>'{native,kind}'in('discrepancy','correction')then
   expected_total:=0;
   if e->'available'<>'[]'::jsonb or e->'custody'<>'[]'::jsonb then
    raise exception 'Annotation or discrepancy invented a stock effect';end if;
  else
   select sum((a->>'quantity_delta')::numeric)into expected_total from jsonb_array_elements(actual_available)a;
  end if;
  if actual_total is distinct from expected_total then raise exception 'Recorded-source quantity conservation failed: %',r.writer;end if;
  checks:=checks+1;
  begin
   perform pg_temp.controlled_stock_source_effects(r.writer,r.id,gen_random_uuid(),receipt);
   raise exception 'Foreign source actor accepted';
  exception when check_violation then null;end;
  begin
   perform pg_temp.controlled_stock_source_effects(r.writer,r.id,r.actor_id,receipt||'{"unexpected":true}');
   raise exception 'Changed canonical receipt accepted';
  exception when check_violation then null;end;
  checks:=checks+2;seen:=array_append(seen,r.writer);n:=n+1;
  insert into controlled_source_results values(r.writer,r.id,b,e);
 end loop;
 if(select count(distinct v)from unnest(seen)v)<>10
  or(select count(distinct v)from unnest(actions)v)<>6 or compensations<4 then
  raise exception 'All ten producers, six return actions and signed split compensations required';end if;
 select count(distinct bundle#>>'{native,document,kind}')into annotation_kinds
 from controlled_source_results where writer='append_native_dispense_correction';
 if annotation_kinds<>3 or not exists(select 1 from controlled_source_results where
  bundle#>>'{native,document,kind}'='pickup_amendment'and effects->'custody'='[]'::jsonb)then
  raise exception 'All annotation types, including pickup assertions, must preserve physical balances';end if;
 checks:=checks+1;

 -- Immutable provenance can be verified by private tooling after a recorder
 -- retires. This is not a grant to another user to recover or execute the action.
 select writer,root,bundle,effects into r from controlled_source_results where writer='record_native_dispense_return_v2'limit 1;
 select p.id into other_actor from profiles p where p.id<>(r.bundle->>'actor_id')::uuid and public.is_active_staff(p.id)
  and exists(select 1 from user_roles roles where roles.user_id=p.id and roles.role='ADMIN')limit 1;
 if other_actor is null then raise exception 'Different active synthetic verifier required';end if;
 select jsonb_build_object('version',2,'id',o.id,'actor_id',o.actor_id,'request',o.request,
  'request_hash',o.request_hash,'result',o.result,'created_at',o.created_at)into receipt from native_return_operations o where o.id=r.root;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',other_actor,'role','authenticated')::text,true);
 update profiles set is_active=false where id=(r.bundle->>'actor_id')::uuid;
 if pg_temp.controlled_stock_source_effects(r.writer,r.root,(r.bundle->>'actor_id')::uuid,receipt)is distinct from r.effects then
  raise exception 'Retired recorder erased immutable source verification';end if;
 update profiles set is_active=true where id=(r.bundle->>'actor_id')::uuid;
 checks:=checks+1;

 -- Current catalog price/availability is not rewritten into an old source.
 -- Recovery of that source is still not authorization for a fresh operation.
 select o.*,d.document->>'quantity'as quantity into r from native_fulfillment_operations o
 join native_dispenses d on d.id=o.id where o.operation='dispense'limit 1;
 update profiles set is_active=true where id=r.actor_id;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',r.actor_id,'role','authenticated')::text,true);
 select native_fulfillment_receipt(o)into receipt from native_fulfillment_operations o where o.id=r.id;
 select effects into e from controlled_source_results where writer='record_native_dispense'and root=r.id;
 update catalog_products set active=false,unit_price_cents=unit_price_cents+1
 where id=(e->>'product_id')::uuid;
 if pg_temp.controlled_stock_source_effects('record_native_dispense',r.id,r.actor_id,receipt)is distinct from e then
  raise exception 'Catalog edits changed historical source effects';end if;
 checks:=checks+1;

 -- Exact reverse membership is necessary even when an original receipt exists.
 select p.*into r from native_pickups p join stock_pickup_sources s on s.event_id=p.id limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',r.actor_id,'role','authenticated')::text,true);
 update profiles set is_active=true where id=r.actor_id;
 select native_fulfillment_receipt(o)into receipt from native_fulfillment_operations o where o.id=r.id;
 begin
  alter table stock_pickup_sources disable trigger immutable;
  delete from stock_pickup_sources where event_id=r.id;
  perform pg_temp.controlled_stock_source_effects('record_native_pickup',r.id,r.actor_id,receipt);
  raise exception 'Missing pickup reverse source accepted';
 exception when check_violation then null;end;
 checks:=checks+1;
 select s.*,e.actor_id as event_actor into r from stock_movement_sources s join native_return_events e
  on s.source_id=e.id where e.action='restock'limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',r.actor_id,'role','authenticated')::text,true);
 update profiles set is_active=true where id=r.actor_id;
 if r.writer='record_native_dispense_return_v2'then receipt:=recover_native_dispense_return_v2(r.source_id);
 else select native_return_receipt(o)into receipt from native_return_operations o where o.id=r.source_id;end if;
 begin
  alter table stock_movement_sources disable trigger immutable;
  delete from stock_movement_sources where movement_id=r.movement_id;
  perform pg_temp.controlled_stock_source_effects(r.writer,r.source_id,r.actor_id,receipt);
  raise exception 'Missing restock reverse movement accepted';
 exception when check_violation then null;end;
 checks:=checks+1;
 if exists(select 1 from pg_trigger where tgrelid in('stock_pickup_sources'::regclass,'stock_movement_sources'::regclass)
  and tgname='immutable'and tgenabled<>'O')then raise exception 'Corruption proof did not restore guards';end if;
 foreach role_name in array array['anon','authenticated','service_role']loop
  if has_function_privilege(role_name,'pg_temp.controlled_stock_source_bundle(text,uuid,uuid,jsonb)','EXECUTE')
   or has_function_privilege(role_name,'pg_temp.controlled_stock_source_effects(text,uuid,uuid,jsonb)','EXECUTE')then
   raise exception 'Owner-only source oracle exposed';end if;
 end loop;
 checks:=checks+3;
 insert into controlled_source_proof values(jsonb_build_object('source_producers',10,'canonical_operations',n,
  'checks',checks,'return_actions',6,'distinct_negative_compensation_movements',compensations,
  'annotation_kinds',annotation_kinds,'catalog_edits_preserve_original_sources',true,
  'actual_canonical_replays',n,'anesthesia_treatment_receipts',anesthesia_replays,
  'canonical_replay_preserves_stock_and_billing',true,
  'retired_recorder_provenance_preserved',true,
  'missing_reverse_sources_denied',2,'private_acl',true,'authorizes_execution',false,
  'controlled_policy_or_opening',false,'provider_requests',0));
end $$;
select value from controlled_source_proof;
