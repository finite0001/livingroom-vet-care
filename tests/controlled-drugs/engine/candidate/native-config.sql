-- SYNTHETIC OWNED LOCAL ONLY. Setup commits so later RPCs have real transaction
-- boundaries. The enclosing owned Docker runtime is destroyed after proof.
begin;set local timezone='UTC';
insert into fx select key,gen_random_uuid()from unnest(array[
 'engine_session','engine_draft','engine_review','engine_site','engine_location','engine_policy','engine_opening','engine_frozen','engine_active',
 'engine_stock1','engine_stock2','engine_box1','engine_box2','engine_pickup','engine_treatment','engine_anesthesia','engine_record','engine_adjust',
 'engine_annotation','engine_operational','engine_amendment','engine_intake1','engine_dispose1','engine_restock1','engine_retract_dispose1',
 'engine_retract_restock1','engine_retract_intake1','engine_intake2','engine_dispose2','engine_restock2','engine_report1','engine_note1',
 'engine_resolve1','engine_report2','engine_case_retract','engine_resolve2'])key;
create function pg_temp.eid(key text)returns uuid language sql stable as $$select id from fx where k=key$$;
insert into auth.sessions(id,user_id,created_at,updated_at)values(pg_temp.eid('engine_session'),'a5510000-0000-4000-8000-000000000001',clock_timestamp(),clock_timestamp());
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','a5510000-0000-4000-8000-000000000001','session_id',pg_temp.eid('engine_session'))::text,true);
select prepare_controlled_draft_review(auth.uid(),pg_temp.eid('engine_review'),'draft_configuration',jsonb_build_object(
 'id',pg_temp.eid('engine_draft'),'expected_version',null,'review_note','SYNTHETIC ENGINE FIXTURE ONLY','attest_review',true,
 'definition',jsonb_build_object('product_id',pg_temp.eid('product'),'product_version',1,'stock_unit','tablet','generic_name','Synthetic medication',
  'brand_name',null,'schedule','II','concentration','Synthetic only; no clinical dose','concentration_source','Synthetic engineering fixture',
  'classification_source','Synthetic engineering fixture','configuration_note','Not real practice configuration')));
select execute_controlled_draft_review(auth.uid(),pg_temp.eid('engine_review'));
select controlled_stock_exclusive();
insert into controlled_stock_sites(id,label,registration_evidence,actor_id,session_id)
 values(pg_temp.eid('engine_site'),'SYNTHETIC SITE','{"synthetic":true}',auth.uid(),pg_temp.eid('engine_session'));
insert into controlled_stock_locations(id,site_id,kind,label,initial_custodian_id,actor_id,session_id)
 values(pg_temp.eid('engine_location'),pg_temp.eid('engine_site'),'clinic','SYNTHETIC LOCATION',auth.uid(),auth.uid(),pg_temp.eid('engine_session'));
create function pg_temp.fixture_permission(basis text)returns jsonb language sql immutable as $$
 select jsonb_build_object('enabled',true,'roles',jsonb_build_array('DVM'),'basis',basis,'witness','none',
  'secondary_review',true,'location_kinds',jsonb_build_array('clinic'))
$$;
insert into controlled_stock_policy_versions(id,product_id,version,draft_version_id,engine_revision,stock_unit,identity_snapshot,permissions,
 clinic_retained_return_permitted,review_reference,actor_id,session_id)
 select pg_temp.eid('engine_policy'),pg_temp.eid('product'),1,head_id,1,'tablet',controlled_stock_identity(pg_temp.eid('product')),
 (select jsonb_object_agg(key,pg_temp.fixture_permission(basis))from(
  select key,'physical_record'text_basis from unnest(array['receive_inventory','adjust_inventory','record_patient_treatment','record_anesthesia_drug_administration','record_native_dispense','record_native_pickup'])key
 )physical(key,basis))||
 (select jsonb_object_agg(writer||':'||action,pg_temp.fixture_permission('physical_record'))from
  unnest(array['record_native_dispense_return','record_native_dispense_return_v2'])writer cross join unnest(array['intake','dispose','restock'])action)||
 (select jsonb_object_agg('record_native_dispense_return_v2:'||action,pg_temp.fixture_permission('correction_assertion'))from unnest(array['retract_intake','retract_disposal','retract_restock'])action)||
 (select jsonb_object_agg('append_native_dispense_correction:'||action,pg_temp.fixture_permission('annotation'))from unnest(array['clinical_annotation','operational_annotation','pickup_amendment'])action)||
 (select jsonb_object_agg('record_native_return_discrepancy:'||action,pg_temp.fixture_permission('discrepancy_assertion'))from unnest(array['report','note','resolve_confirmed_original','resolve_corrected'])action),
 true,'SYNTHETIC LOCAL ONLY; no practice permission or witness default',auth.uid(),pg_temp.eid('engine_session')from controlled_draft_entries where id=pg_temp.eid('engine_draft');
insert into controlled_stock_policy_sites values(pg_temp.eid('engine_policy'),pg_temp.eid('engine_site'));
insert into controlled_stock_state_events(id,product_id,version,state,policy_version_id,actor_id,session_id,reason)
 values(pg_temp.eid('engine_frozen'),pg_temp.eid('product'),1,'opening_frozen',pg_temp.eid('engine_policy'),auth.uid(),pg_temp.eid('engine_session'),'Synthetic freeze');
insert into controlled_stock_states(product_id,head_id)values(pg_temp.eid('product'),pg_temp.eid('engine_frozen'));
insert into controlled_stock_openings(id,product_id,policy_version_id,observed_at,count_evidence,native_custody_boundary,actor_id,session_id)
 values(pg_temp.eid('engine_opening'),pg_temp.eid('product'),pg_temp.eid('engine_policy'),clock_timestamp(),
  '{"synthetic":true,"explicit_lot1_count":"20.000","explicit_lot2_count":"100.000"}','[]',auth.uid(),pg_temp.eid('engine_session'));
insert into controlled_stock_opening_movements(opening_id,movement_id,lot_id,quantity,source_snapshot)
 select pg_temp.eid('engine_opening'),m.id,m.lot_id,m.quantity,to_jsonb(m)from inventory_movements m join inventory_lots l on l.id=m.lot_id where l.product_id=pg_temp.eid('product');
insert into controlled_stock_containers(id,product_id,stock_unit,label,kind,stock_lot_id,controlling_site_id,initial_location_id,initial_custodian_id,
 opening_id,actor_id,session_id)
 select pg_temp.eid('engine_stock'||n),pg_temp.eid('product'),'tablet','Synthetic stock bottle '||n,'stock',pg_temp.eid('lot'||n),pg_temp.eid('engine_site'),
  pg_temp.eid('engine_location'),auth.uid(),pg_temp.eid('engine_opening'),auth.uid(),pg_temp.eid('engine_session')from generate_series(1,2)n;
insert into controlled_stock_container_heads(container_id,version,location_id,custodian_id,status)
 select c.id,0,c.initial_location_id,c.initial_custodian_id,'onsite'from controlled_stock_containers c where c.product_id=pg_temp.eid('product');
insert into controlled_stock_cells(id,container_id,lot_id,channel,opening_id,opening_quantity)
 select gen_random_uuid(),pg_temp.eid('engine_stock'||n),pg_temp.eid('lot'||n),'available',pg_temp.eid('engine_opening'),case n when 1 then 20.000 else 100.000 end from generate_series(1,2)n;
insert into controlled_stock_positions select c.id,c.opening_quantity from controlled_stock_cells c where c.opening_id=pg_temp.eid('engine_opening');
insert into controlled_stock_state_events(id,product_id,version,prior_event_id,state,policy_version_id,opening_id,actor_id,session_id,reason)
 values(pg_temp.eid('engine_active'),pg_temp.eid('product'),2,pg_temp.eid('engine_frozen'),'active',pg_temp.eid('engine_policy'),pg_temp.eid('engine_opening'),
 auth.uid(),pg_temp.eid('engine_session'),'Synthetic fixture activation; not real practice commissioning');
update controlled_stock_states set head_id=pg_temp.eid('engine_active')where product_id=pg_temp.eid('product');
commit;
begin;set local timezone='UTC';
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','a5510000-0000-4000-8000-000000000001','session_id',pg_temp.eid('engine_session'))::text,true);
create temp table engine_packages(dispense_id uuid primary key,container_id uuid not null unique);
insert into engine_packages values(pg_temp.eid('dispense'),pg_temp.eid('engine_box1')),(pg_temp.eid('dispense2'),pg_temp.eid('engine_box2'));
create temp table engine_native_results(k text primary key,writer text not null,root uuid not null,result jsonb not null);
create function pg_temp.engine_native_context(root uuid,writer text,args jsonb)returns jsonb language plpgsql volatile as $$
declare effects jsonb:=controlled_stock_expected(root,writer,args);plan jsonb;containers jsonb;basis text;observed jsonb;
begin
 if writer='append_native_dispense_correction'then basis:='annotation';
 elsif writer='record_native_return_discrepancy'then basis:='discrepancy_assertion';
 elsif writer='record_native_dispense_return_v2'and args#>>'{request,intent,action}'like 'retract_%'then basis:='correction_assertion';
 else basis:='physical_record';end if;
 if basis<>'physical_record'then observed:='null';
 elsif writer in('record_patient_treatment','record_anesthesia_drug_administration')then observed:=args#>'{request,administered_at}';
 else observed:=to_jsonb(to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));end if;
 select coalesce(jsonb_agg(jsonb_build_object('cid',case when e->>'channel'='available'then case when(e->>'lot_id')::uuid=pg_temp.eid('lot1')then pg_temp.eid('engine_stock1')else pg_temp.eid('engine_stock2')end
  else(select container_id from engine_packages where dispense_id=(e->>'dispense_id')::uuid)end,'line',e)),'[]')into plan from jsonb_array_elements(effects)e;
 select coalesce(jsonb_agg(jsonb_build_object('id',ids.cid,'expected_version',h.version,
  'create',case when h.container_id is null then jsonb_build_object('kind','prepared','label','Synthetic patient package','stock_lot_id',null,
   'site_id',pg_temp.eid('engine_site'),'location_id',pg_temp.eid('engine_location'),'custodian_id',auth.uid())else null end,
  'after',case when writer='record_native_pickup'then jsonb_build_object('status','handed_off','location_id',null,'custodian_id',null)
   else jsonb_build_object('status',coalesce(h.status,'onsite'),'location_id',coalesce(h.location_id,pg_temp.eid('engine_location')),'custodian_id',coalesce(h.custodian_id,auth.uid()))end,
  'lines',(select jsonb_agg(p->'line'order by p#>>'{line,lot_id}',p#>>'{line,channel}',p#>>'{line,intake_id}')from jsonb_array_elements(plan)p where(p->>'cid')::uuid=ids.cid)
 )order by ids.cid),'[]')into containers from(select distinct(p->>'cid')::uuid cid from jsonb_array_elements(plan)p)ids
 left join controlled_stock_container_heads h on h.container_id=ids.cid;
 return jsonb_build_object('version',1,'product_id',pg_temp.eid('product'),'policy_version_id',pg_temp.eid('engine_policy'),'state_head_id',pg_temp.eid('engine_active'),
  'opening_id',pg_temp.eid('engine_opening'),'basis',jsonb_build_object('kind',basis,'observed_at',observed,'note','Synthetic engineering source record only'),'containers',containers);
end $$;
create function pg_temp.engine_native_call(key text,writer text,root uuid,args jsonb)returns jsonb language plpgsql volatile as $$declare receipt jsonb;begin
 perform prepare_controlled_stock_action(auth.uid(),root,writer,args,pg_temp.engine_native_context(root,writer,args));
 receipt:=execute_controlled_stock_action(auth.uid(),root);
 insert into engine_native_results values(key,writer,root,receipt);
 return receipt;
end $$;
