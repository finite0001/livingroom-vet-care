-- Owned-local SQL fixture only. Entire policy/opening/action graph rolls back.
begin;set local timezone='UTC';
create temp table engine_fx(k text primary key,id uuid not null default gen_random_uuid());
insert into engine_fx(k)select unnest(array['actor','session','product','draft_entry','draft_action','site','location','policy','opening','frozen','active','receive','lot','bottle_a','bottle_b','adjust']);
create function pg_temp.engine_id(key text)returns uuid language sql stable as $$select id from engine_fx where k=key$$;
insert into auth.users(id,email,raw_user_meta_data)values(pg_temp.engine_id('actor'),'synthetic-engine-'||pg_temp.engine_id('actor')||'@example.test','{"full_name":"Synthetic engine recorder"}');
update profiles set is_active=true,full_name='Synthetic engine recorder'where id=pg_temp.engine_id('actor');
insert into user_roles(user_id,role)values(pg_temp.engine_id('actor'),'DVM'),(pg_temp.engine_id('actor'),'ADMIN')on conflict do nothing;
insert into auth.sessions(id,user_id,created_at,updated_at)values(pg_temp.engine_id('session'),pg_temp.engine_id('actor'),clock_timestamp(),clock_timestamp());
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.engine_id('actor'),'session_id',pg_temp.engine_id('session'))::text,true);
insert into catalog_products(id,name,kind,manufacturer,unit,unit_price_cents,created_by)values(pg_temp.engine_id('product'),'SYNTHETIC ENGINE PRODUCT','medication','Synthetic','ml',100,pg_temp.engine_id('actor'));
select prepare_controlled_draft_review(pg_temp.engine_id('actor'),pg_temp.engine_id('draft_action'),'draft_configuration',jsonb_build_object(
 'id',pg_temp.engine_id('draft_entry'),'expected_version',null,'review_note','Synthetic SQL engineering fixture only','attest_review',true,
 'definition',jsonb_build_object('product_id',pg_temp.engine_id('product'),'product_version',1,'stock_unit','ml','generic_name','SYNTHETIC ENGINE PRODUCT',
  'brand_name',null,'schedule','II','concentration','Synthetic only; not a clinical dose','concentration_source','Synthetic engineering fixture only',
  'classification_source','Synthetic engineering fixture only','configuration_note','Never real practice configuration')));
select execute_controlled_draft_review(pg_temp.engine_id('actor'),pg_temp.engine_id('draft_action'));
select controlled_stock_exclusive();
insert into controlled_stock_sites(id,label,registration_evidence,actor_id,session_id)values(pg_temp.engine_id('site'),'SYNTHETIC SITE','{"synthetic":true}',pg_temp.engine_id('actor'),pg_temp.engine_id('session'));
insert into controlled_stock_locations(id,site_id,kind,label,initial_custodian_id,actor_id,session_id)values(pg_temp.engine_id('location'),pg_temp.engine_id('site'),'clinic','SYNTHETIC LOCATION',pg_temp.engine_id('actor'),pg_temp.engine_id('actor'),pg_temp.engine_id('session'));
insert into controlled_stock_policy_versions(id,product_id,version,draft_version_id,engine_revision,stock_unit,identity_snapshot,permissions,
 clinic_retained_return_permitted,review_reference,actor_id,session_id)
 select pg_temp.engine_id('policy'),pg_temp.engine_id('product'),1,head_id,1,'ml',controlled_stock_identity(pg_temp.engine_id('product')),
 jsonb_build_object('receive_inventory',jsonb_build_object('enabled',true,'roles',jsonb_build_array('DVM'),'basis','physical_record','witness','none','secondary_review',true,'location_kinds',jsonb_build_array('clinic')),
  'adjust_inventory',jsonb_build_object('enabled',true,'roles',jsonb_build_array('DVM'),'basis','physical_record','witness','none','secondary_review',true,'location_kinds',jsonb_build_array('clinic'))),
 false,'Synthetic engineering fixture, not approved practice rules',pg_temp.engine_id('actor'),pg_temp.engine_id('session')from controlled_draft_entries where id=pg_temp.engine_id('draft_entry');
insert into controlled_stock_policy_sites values(pg_temp.engine_id('policy'),pg_temp.engine_id('site'));
insert into controlled_stock_state_events(id,product_id,version,state,policy_version_id,actor_id,session_id,reason)
 values(pg_temp.engine_id('frozen'),pg_temp.engine_id('product'),1,'opening_frozen',pg_temp.engine_id('policy'),pg_temp.engine_id('actor'),pg_temp.engine_id('session'),'Synthetic empty initial freeze');
insert into controlled_stock_states(product_id,head_id)values(pg_temp.engine_id('product'),pg_temp.engine_id('frozen'));
insert into controlled_stock_openings(id,product_id,policy_version_id,observed_at,count_evidence,native_custody_boundary,actor_id,session_id)
 values(pg_temp.engine_id('opening'),pg_temp.engine_id('product'),pg_temp.engine_id('policy'),clock_timestamp()-interval '1 minute',
 '{"synthetic":true,"available":"0.000"}','[]',pg_temp.engine_id('actor'),pg_temp.engine_id('session'));
insert into controlled_stock_state_events(id,product_id,version,prior_event_id,state,policy_version_id,opening_id,actor_id,session_id,reason)
 values(pg_temp.engine_id('active'),pg_temp.engine_id('product'),2,pg_temp.engine_id('frozen'),'active',pg_temp.engine_id('policy'),pg_temp.engine_id('opening'),
 pg_temp.engine_id('actor'),pg_temp.engine_id('session'),'Synthetic local-only engine fixture');
update controlled_stock_states set head_id=pg_temp.engine_id('active')where product_id=pg_temp.engine_id('product');
create temp table engine_values(k text primary key,value jsonb);
insert into engine_values values('args',jsonb_build_object('lot_id',pg_temp.engine_id('lot'),'product_id',pg_temp.engine_id('product'),
 'lot_number','SYNTHETIC-ENGINE','expires_on',(current_date+365)::text,'location','Synthetic native lot label','quantity','2.500','reason','Synthetic local source receipt'));
insert into engine_values values('context',jsonb_build_object('version',1,'product_id',pg_temp.engine_id('product'),'policy_version_id',pg_temp.engine_id('policy'),
 'state_head_id',pg_temp.engine_id('active'),'opening_id',pg_temp.engine_id('opening'),
 'basis',jsonb_build_object('kind','physical_record','observed_at',to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'note','Synthetic physical count only'),
 'containers',(select jsonb_agg(jsonb_build_object('id',id,'expected_version',null,
  'create',jsonb_build_object('kind','stock','label','Synthetic bottle '||k,'stock_lot_id',pg_temp.engine_id('lot'),'site_id',pg_temp.engine_id('site'),
   'location_id',pg_temp.engine_id('location'),'custodian_id',pg_temp.engine_id('actor')),
  'after',jsonb_build_object('status','onsite','location_id',pg_temp.engine_id('location'),'custodian_id',pg_temp.engine_id('actor')),
  'lines',jsonb_build_array(jsonb_build_object('lot_id',pg_temp.engine_id('lot'),'channel','available','dispense_id',null,'intake_id',null,'quantity_delta','1.250'))
 )order by id)from engine_fx where k in('bottle_a','bottle_b'))));
insert into engine_values select 'prepare',prepare_controlled_stock_action(pg_temp.engine_id('actor'),pg_temp.engine_id('receive'),'receive_inventory',
 (select value from engine_values where k='args'),(select value from engine_values where k='context'));
insert into engine_values select 'receipt',execute_controlled_stock_action(pg_temp.engine_id('actor'),pg_temp.engine_id('receive'));
do $$declare receipt jsonb:=(select value from engine_values where k='receipt');begin
 if receipt#>>'{canonical_result,id}'<>pg_temp.engine_id('receive')::text then raise exception 'Original receive result missing';end if;
 if(select sum(quantity)from controlled_stock_positions)<>2.500 or(select count(*)from inventory_movements)<>1
  or(select count(*)from controlled_stock_event_lines)<>2 or(select count(*)from controlled_stock_container_transitions)<>2 then
  raise exception 'Exact fractional source/container posting failed';end if;
 if execute_controlled_stock_action(pg_temp.engine_id('actor'),pg_temp.engine_id('receive'))is distinct from receipt
  or read_controlled_stock_action(pg_temp.engine_id('actor'),pg_temp.engine_id('receive'))->'receipt'is distinct from receipt then
  raise exception 'Exact original owned receipt recovery failed';end if;
 if exists(select 1 from controlled_stock_execution_contexts)then raise exception 'Executing context leaked after return';end if;
end $$;
insert into engine_fx(k)select unnest(array['stale','cancelled','generic','raw','other_actor','other_session']);
create function pg_temp.engine_adjust_context(bottle uuid,q text)returns jsonb language sql volatile as $$
 select jsonb_build_object('version',1,'product_id',pg_temp.engine_id('product'),'policy_version_id',pg_temp.engine_id('policy'),
 'state_head_id',pg_temp.engine_id('active'),'opening_id',pg_temp.engine_id('opening'),
 'basis',jsonb_build_object('kind','physical_record','observed_at',to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'note','Synthetic physical recount'),
 'containers',jsonb_build_array(jsonb_build_object('id',h.container_id,'expected_version',h.version,'create',null,
  'after',jsonb_build_object('status',h.status,'location_id',h.location_id,'custodian_id',h.custodian_id),
  'lines',jsonb_build_array(jsonb_build_object('lot_id',pg_temp.engine_id('lot'),'channel','available','dispense_id',null,'intake_id',null,'quantity_delta',q)))))
 from controlled_stock_container_heads h where h.container_id=bottle
$$;
insert into engine_values values('adjust_args',jsonb_build_object('lot_id',pg_temp.engine_id('lot'),'quantity','-0.500','reason','Synthetic local recount')),
 ('adjust_context',pg_temp.engine_adjust_context(pg_temp.engine_id('bottle_a'),'-0.500')),
 ('stale_args',jsonb_build_object('lot_id',pg_temp.engine_id('lot'),'quantity','-0.250','reason','Synthetic stale recount')),
 ('stale_context',pg_temp.engine_adjust_context(pg_temp.engine_id('bottle_a'),'-0.250'));
select prepare_controlled_stock_action(pg_temp.engine_id('actor'),pg_temp.engine_id('adjust'),'adjust_inventory',
 (select value from engine_values where k='adjust_args'),(select value from engine_values where k='adjust_context'));
select prepare_controlled_stock_action(pg_temp.engine_id('actor'),pg_temp.engine_id('stale'),'adjust_inventory',
 (select value from engine_values where k='stale_args'),(select value from engine_values where k='stale_context'));
insert into engine_values select 'adjust_receipt',execute_controlled_stock_action(pg_temp.engine_id('actor'),pg_temp.engine_id('adjust'));
do $$begin
 if(select sum(quantity)from controlled_stock_positions)<>2.000 or(select count(*)from inventory_movements)<>2
  or(select quantity from controlled_stock_positions p join controlled_stock_cells c on c.id=p.cell_id where c.container_id=pg_temp.engine_id('bottle_a'))<>0.750 then
  raise exception 'Adjustment did not preserve exact per-container and canonical quantities';end if;
 begin
  perform execute_controlled_stock_action(pg_temp.engine_id('actor'),pg_temp.engine_id('stale'));
  raise exception 'Stale physical review was accepted';
 exception when sqlstate 'PT409'then null;end;
 if read_controlled_stock_action(pg_temp.engine_id('actor'),pg_temp.engine_id('stale'))->>'state'<>'prepared'
  or exists(select 1 from inventory_movements where id=pg_temp.engine_id('stale'))then
  raise exception 'Stale review changed the original action or posted a canonical movement';end if;
 perform cancel_controlled_stock_action(pg_temp.engine_id('actor'),pg_temp.engine_id('stale'));
 begin
  perform prepare_controlled_stock_action(pg_temp.engine_id('actor'),pg_temp.engine_id('adjust'),'adjust_inventory',
   (select value||'{"quantity":"-0.499"}'from engine_values where k='adjust_args'),(select value from engine_values where k='adjust_context'));
  raise exception 'Changed owned payload was accepted';
 exception when unique_violation then null;end;
 -- Same simple-query packet, old C1a admission and arbitrary caller GUCs.
 perform set_config('controlled_stock.operation',pg_temp.engine_id('receive')::text,true);
 begin
  perform adjust_inventory(pg_temp.engine_id('generic'),pg_temp.engine_id('lot'),-0.125,'Synthetic generic bypass');
  raise exception 'Generic managed adjustment borrowed completed authority';
 exception when check_violation then null;end;
 begin
  insert into inventory_movements(id,lot_id,quantity,kind,reason,created_by)values(pg_temp.engine_id('raw'),pg_temp.engine_id('lot'),0.125,'adjust','Synthetic raw bypass',pg_temp.engine_id('actor'));
  raise exception 'Raw managed source borrowed completed authority';
 exception when check_violation then null;end;
 begin
  perform controlled_stock_exclusive();raise exception 'Shared-to-exclusive freeze upgrade was accepted';
 exception when check_violation then null;end;
 if exists(select 1 from controlled_stock_execution_contexts)or(select count(*)from inventory_movements)<>2 then
  raise exception 'Rejected bypass created state or left executing authority';end if;
end $$;
select prepare_controlled_stock_action(pg_temp.engine_id('actor'),pg_temp.engine_id('cancelled'),'adjust_inventory',
 jsonb_build_object('lot_id',pg_temp.engine_id('lot'),'quantity','-0.125','reason','Synthetic cancellation'),
 pg_temp.engine_adjust_context(pg_temp.engine_id('bottle_b'),'-0.125'));
select cancel_controlled_stock_action(pg_temp.engine_id('actor'),pg_temp.engine_id('cancelled'));
do $$begin
 if cancel_controlled_stock_action(pg_temp.engine_id('actor'),pg_temp.engine_id('cancelled'))->>'state'<>'cancelled'then raise exception 'Cancellation was not stable';end if;
 begin
  perform execute_controlled_stock_action(pg_temp.engine_id('actor'),pg_temp.engine_id('cancelled'));
  raise exception 'Cancelled action executed';
 exception when sqlstate 'PT409'then null;end;
 begin
  perform adjust_inventory(pg_temp.engine_id('cancelled'),pg_temp.engine_id('lot'),-0.125,'Synthetic cancellation');
  raise exception 'Cancelled UUID was reused by canonical API';
 exception when check_violation then null;end;
end $$;
insert into auth.users(id,email,raw_user_meta_data)values(pg_temp.engine_id('other_actor'),'synthetic-engine-other-'||pg_temp.engine_id('other_actor')||'@example.test','{}');
update profiles set is_active=true where id=pg_temp.engine_id('other_actor');
insert into auth.sessions(id,user_id,created_at,updated_at)values(pg_temp.engine_id('other_session'),pg_temp.engine_id('other_actor'),clock_timestamp(),clock_timestamp());
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.engine_id('other_actor'),'session_id',pg_temp.engine_id('other_session'))::text,true);
do $$begin
 begin perform read_controlled_stock_action(pg_temp.engine_id('other_actor'),pg_temp.engine_id('receive'));raise exception 'Foreign owned receipt was disclosed';exception when insufficient_privilege then null;end;
 begin perform cancel_controlled_stock_action(pg_temp.engine_id('other_actor'),pg_temp.engine_id('cancelled'));raise exception 'Foreign action was cancelled';exception when insufficient_privilege then null;end;
 begin perform execute_controlled_stock_action(pg_temp.engine_id('actor'),pg_temp.engine_id('receive'));raise exception 'Actor argument impersonation accepted';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.engine_id('actor'),'session_id',pg_temp.engine_id('session'))::text,true);
select save_catalog_product(pg_temp.engine_id('product'),1,'SYNTHETIC ENGINE PRODUCT','medication','Synthetic','ml',200,true);
do $$declare receipt jsonb:=(select value from engine_values where k='receipt');begin
 if execute_controlled_stock_action(pg_temp.engine_id('actor'),pg_temp.engine_id('receive'))is distinct from receipt
  or read_controlled_stock_action(pg_temp.engine_id('actor'),pg_temp.engine_id('receive'))->'receipt'is distinct from receipt then
  raise exception 'Catalog changes or later heads changed original owned recovery';end if;
 if(select count(*)from controlled_stock_events)<>2 or(select count(*)from inventory_movements)<>2 or(select sum(quantity)from controlled_stock_positions)<>2.000 then
  raise exception 'Negative probes or recovery added physical effects';end if;
end $$;
set constraints all immediate;
select jsonb_build_object('sql_only',true,'synthetic_only',true,'managed_receive',true,'fractional_containers',2,
 'one_original_movement_per_action',true,'managed_adjust',true,'exact_owned_receipt_recovery',true,'private_context_cleared',true,
 'stale_review_denied',true,'cancellation_permanent',true,'changed_payload_denied',true,'same_packet_generic_and_raw_bypasses_denied',true,
 'shared_exclusive_upgrade_denied',true,'foreign_owner_and_actor_denied',true,'old_receipts_survive_later_heads_and_prices',true,'provider_requests',0);
rollback;
