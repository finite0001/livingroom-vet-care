-- OWNED LOCAL ONLY. Genuine generic history precedes candidate configuration.
-- Normal execution rolls back the entire synthetic, unattached opening.
begin;set local timezone='UTC';
select set_config('request.jwt.claims','{}',true);
create temp table generic_history_input(payload jsonb not null);
insert into generic_history_input values(:'ids_json'::jsonb);
create temp table generic_history_ids(k text primary key,id uuid not null);
insert into generic_history_ids select key,gen_random_uuid()from unnest(array['session','draft','review','site','location','policy','opening','frozen','container','cell'])key;
create temp table generic_history_assertions(label text primary key);
create temp table generic_history_refusals(label text primary key,error text not null);
create function pg_temp.generic_history_id(key text)returns uuid language sql stable as $$select id from generic_history_ids where k=key$$;
create function pg_temp.generic_history_assert(value boolean,label text)returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'Generic historical opening assertion failed: %',label;end if;
 insert into generic_history_assertions values(label);
end$$;
create function pg_temp.generic_history_snapshot()returns jsonb language plpgsql volatile set timezone='UTC' as $$
declare r record;value jsonb;result jsonb:='{}';begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where(n.nspname='public'and c.relkind in('r','p'))or(n.nspname='auth'and c.relname='sessions'and c.relkind='r')order by n.nspname,c.relname loop
 execute format('select jsonb_build_object(''count'',count(*),''hash'',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,''|''order by to_jsonb(t)::text),''''),''UTF8'')),''hex''))from %I.%I t',r.nspname,r.relname)into value;
 result:=result||jsonb_build_object(r.nspname||'.'||r.relname,value);end loop;return result;
end$$;
do $$declare payload jsonb:=(select i.payload from generic_history_input i);g jsonb;era integer;product uuid;lot uuid;actor uuid;
receive_id uuid;adjust_id uuid;actual numeric;sources integer;begin
 g:=payload->'generic_stock';era:=(payload->>'era')::integer;
 perform pg_temp.generic_history_assert(payload->>'kind'='controlled-native-history-seed-v1'and era in(187,188),'exact genuine-era seed');
 -- The owning runner verifies the exact204 ledger before invoking this fixture.
 -- Its marked four-schema restore deliberately excludes the migration ledger.
 product:=(g->>'product_id')::uuid;lot:=(g->>'lot_id')::uuid;receive_id:=(g->>'receive_id')::uuid;adjust_id:=(g->>'adjust_id')::uuid;
 perform pg_temp.generic_history_assert(product=(payload#>>'{ids,history_generic_product}')::uuid and lot=(payload#>>'{ids,history_generic_lot}')::uuid
 and receive_id=(payload#>>'{ids,history_generic_receive}')::uuid and adjust_id=(payload#>>'{ids,history_generic_adjust}')::uuid
 and product is distinct from(payload#>>'{ids,product}')::uuid and receive_id<>adjust_id,'exact separate generic product lot and writer IDs');
 perform pg_temp.generic_history_assert(g->>'received_quantity'='3.000'and g->>'adjustment_quantity'='-0.500'
 and g->>'available_quantity'='2.500'and g->'movement_count'='2'::jsonb,'explicit independent signed quantities');
 perform pg_temp.generic_history_assert(exists(select 1 from catalog_products p join inventory_lots l on l.product_id=p.id
 where p.id=product and p.unit='tablet'and l.id=lot),'actual original product stock unit and lot');
 select created_by into actor from inventory_movements where id=receive_id;
 perform pg_temp.generic_history_assert(actor='a5510000-0000-4000-8000-000000000001'::uuid
 and exists(select 1 from inventory_movements where id=receive_id and lot_id=lot and kind='receive'and quantity=3.000 and created_by=actor)
 and exists(select 1 from inventory_movements where id=adjust_id and lot_id=lot and kind='adjust'and quantity=-0.500 and created_by=actor)
 and(select count(*)from inventory_movements m join inventory_lots l on l.id=m.lot_id where l.product_id=product)=2,'exact genuine receipt and negative adjustment');
 select sum(quantity)into actual from inventory_movements where lot_id=lot;
 perform pg_temp.generic_history_assert(actual=2.500,'independent original movement net2500');
 perform pg_temp.generic_history_assert(not exists(select 1 from native_dispense_allocations a join inventory_lots l on l.id=a.lot_id where l.product_id=product),
 'generic stock has no native allocation or custody boundary');
 select count(*)into sources from stock_movement_sources where movement_id in(receive_id,adjust_id);
 perform pg_temp.generic_history_assert(sources=case era when 187 then 0 else 2 end,'original-era provenance without backfill');
 if era=188 then
  perform pg_temp.generic_history_assert(exists(select 1 from stock_movement_sources where movement_id=receive_id and writer='receive_inventory'and source_id=receive_id and actor_id=actor)
  and exists(select 1 from stock_movement_sources where movement_id=adjust_id and writer='adjust_inventory'and source_id=adjust_id and actor_id=actor),'exact original188 generic provenance');
  perform stock_source_validate_movement(receive_id);perform stock_source_validate_movement(adjust_id);
 end if;
 insert into auth.sessions(id,user_id,created_at,updated_at)values(pg_temp.generic_history_id('session'),actor,clock_timestamp(),clock_timestamp());
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor,'session_id',pg_temp.generic_history_id('session'))::text,true);
 perform prepare_controlled_draft_review(actor,pg_temp.generic_history_id('review'),'draft_configuration',jsonb_build_object(
 'id',pg_temp.generic_history_id('draft'),'expected_version',null,'review_note','SYNTHETIC GENERIC HISTORY FIXTURE ONLY','attest_review',true,
 'definition',jsonb_build_object('product_id',product,'product_version',1,'stock_unit','tablet','generic_name','Synthetic genuine-era generic stock',
 'brand_name',null,'schedule','II','concentration','Synthetic only; no clinical dose','concentration_source','Synthetic engineering fixture',
 'classification_source','Synthetic engineering fixture','configuration_note','Not approved practice configuration')));
 perform execute_controlled_draft_review(actor,pg_temp.generic_history_id('review'));
 perform controlled_stock_exclusive();
 insert into controlled_stock_sites(id,label,registration_evidence,actor_id,session_id)
 values(pg_temp.generic_history_id('site'),'SYNTHETIC GENERIC HISTORY SITE','{"synthetic":true}',actor,pg_temp.generic_history_id('session'));
 insert into controlled_stock_locations(id,site_id,kind,label,initial_custodian_id,actor_id,session_id)
 values(pg_temp.generic_history_id('location'),pg_temp.generic_history_id('site'),'clinic','SYNTHETIC GENERIC HISTORY LOCATION',actor,actor,pg_temp.generic_history_id('session'));
 insert into controlled_stock_policy_versions(id,product_id,version,draft_version_id,engine_revision,stock_unit,identity_snapshot,permissions,
 clinic_retained_return_permitted,review_reference,actor_id,session_id)
 select pg_temp.generic_history_id('policy'),product,1,head_id,1,'tablet',controlled_stock_identity(product),'{}',false,
 'Synthetic engineering only; no approved practice permissions',actor,pg_temp.generic_history_id('session')from controlled_draft_entries where id=pg_temp.generic_history_id('draft');
 insert into controlled_stock_policy_sites values(pg_temp.generic_history_id('policy'),pg_temp.generic_history_id('site'));
 insert into controlled_stock_state_events(id,product_id,version,state,policy_version_id,actor_id,session_id,reason)
 values(pg_temp.generic_history_id('frozen'),product,1,'opening_frozen',pg_temp.generic_history_id('policy'),actor,pg_temp.generic_history_id('session'),'Synthetic initial freeze; never activation');
 insert into controlled_stock_states(product_id,head_id)values(product,pg_temp.generic_history_id('frozen'));
 insert into controlled_stock_openings(id,product_id,policy_version_id,observed_at,count_evidence,native_custody_boundary,actor_id,session_id)
 values(pg_temp.generic_history_id('opening'),product,pg_temp.generic_history_id('policy'),clock_timestamp(),
 '{"synthetic":true,"not_practice_physical_count":true,"available_quantity":"2.500"}','[]',actor,pg_temp.generic_history_id('session'));
 insert into controlled_stock_opening_movements(opening_id,movement_id,lot_id,quantity,source_snapshot)
 select pg_temp.generic_history_id('opening'),id,lot_id,quantity,to_jsonb(m)from inventory_movements m where id in(receive_id,adjust_id);
 insert into controlled_stock_containers(id,product_id,stock_unit,label,kind,stock_lot_id,controlling_site_id,initial_location_id,initial_custodian_id,opening_id,actor_id,session_id)
 values(pg_temp.generic_history_id('container'),product,'tablet','Synthetic retained generic stock','stock',lot,pg_temp.generic_history_id('site'),
 pg_temp.generic_history_id('location'),actor,pg_temp.generic_history_id('opening'),actor,pg_temp.generic_history_id('session'));
 insert into controlled_stock_container_heads(container_id,version,location_id,custodian_id,status)
 values(pg_temp.generic_history_id('container'),0,pg_temp.generic_history_id('location'),actor,'onsite');
 insert into controlled_stock_cells(id,container_id,lot_id,channel,opening_id,opening_quantity)
 values(pg_temp.generic_history_id('cell'),pg_temp.generic_history_id('container'),lot,'available',pg_temp.generic_history_id('opening'),2.500);
 insert into controlled_stock_positions values(pg_temp.generic_history_id('cell'),2.500);
 perform controlled_stock_validate_opening(pg_temp.generic_history_id('opening'));perform controlled_stock_validate_product(product);
 perform pg_temp.generic_history_assert((select count(*)from controlled_stock_opening_movements where opening_id=pg_temp.generic_history_id('opening'))=2
 and not exists(select 1 from controlled_stock_opening_movements b join inventory_movements m on m.id=b.movement_id where b.opening_id=pg_temp.generic_history_id('opening')
 and(b.lot_id is distinct from m.lot_id or b.quantity is distinct from m.quantity or b.source_snapshot is distinct from to_jsonb(m))),'both exact signed original movement snapshots');
 perform pg_temp.generic_history_assert((select count(*)from controlled_stock_cells where opening_id=pg_temp.generic_history_id('opening'))=1
 and exists(select 1 from controlled_stock_cells c join controlled_stock_positions p on p.cell_id=c.id where c.id=pg_temp.generic_history_id('cell')
 and c.channel='available'and c.opening_quantity=2.500 and p.quantity=2.500 and c.dispense_id is null and c.allocation_id is null and c.intake_id is null),'exact available cell and position without native custody');
 perform pg_temp.generic_history_assert(exists(select 1 from controlled_stock_openings where id=pg_temp.generic_history_id('opening')and native_custody_boundary='[]'::jsonb)
 and exists(select 1 from controlled_stock_states s join controlled_stock_state_events e on e.id=s.head_id where s.product_id=product and e.state='opening_frozen'
 and e.opening_id is null and e.version=1 and s.event_version=0 and s.last_event_id is null)
 and not exists(select 1 from controlled_stock_state_events where state='active')and not exists(select 1 from controlled_stock_events)
 and not exists(select 1 from controlled_stock_source_links),'unattached frozen opening without activation managed events or links');
end$$;
set constraints all immediate;
-- GENERIC_VALID_OPENING_READY --

create function pg_temp.generic_history_reject(label text,command text,expected text)returns void language plpgsql volatile as $$
declare before_value jsonb:=pg_temp.generic_history_snapshot();manifest jsonb:=controlled_stock_manifest_snapshot();armed boolean:=false;failure text;begin
 begin
  set constraints all deferred;execute command;armed:=true;
  perform controlled_stock_validate_opening(pg_temp.generic_history_id('opening'));
  perform controlled_stock_validate_product((select(payload#>>'{generic_stock,product_id}')::uuid from generic_history_input));
  set constraints all immediate;
  raise exception 'Generic historical mutation unexpectedly accepted: %',label using errcode='P0002';
 exception when check_violation then
  if not armed then raise exception 'Generic mutation blocked before independent validation: %',label using errcode='P0003';end if;
  get stacked diagnostics failure=MESSAGE_TEXT;
  if failure is distinct from expected then raise exception 'Wrong generic historical guard for %: %',label,failure using errcode='P0003';end if;
 end;
 if before_value is distinct from pg_temp.generic_history_snapshot()or manifest is distinct from controlled_stock_manifest_snapshot()then
  raise exception 'Generic historical refusal did not roll back exact relation and manifest state: %',label;end if;
 insert into generic_history_refusals values(label,failure);
end$$;
select pg_temp.generic_history_reject('missing_original_movement_snapshot',$q$alter table controlled_stock_opening_movements disable trigger immutable;delete from controlled_stock_opening_movements where movement_id=(select(payload#>>'{generic_stock,adjust_id}')::uuid from generic_history_input)$q$,'Every later source requires its exact owned opening/product event link');
select pg_temp.generic_history_reject('changed_original_movement_snapshot',$q$alter table controlled_stock_opening_movements disable trigger immutable;update controlled_stock_opening_movements set source_snapshot=jsonb_set(source_snapshot,'{reason}','"Synthetic altered retained snapshot"')where movement_id=(select(payload#>>'{generic_stock,adjust_id}')::uuid from generic_history_input)$q$,'Exact original opening movement snapshots required');
select pg_temp.generic_history_reject('wrong_available_opening_quantity',$q$alter table controlled_stock_cells disable trigger immutable;update controlled_stock_cells set opening_quantity=2.499 where id=pg_temp.generic_history_id('cell')$q$,'Opening available cells must match original opening movement net exactly');
select controlled_stock_validate_opening(pg_temp.generic_history_id('opening'));
select controlled_stock_validate_product((select(payload#>>'{generic_stock,product_id}')::uuid from generic_history_input));
set constraints all immediate;
select jsonb_build_object('kind','controlled-generic-history-opening-observation-v1','era',(payload->>'era')::integer,
 'case_name',payload->>'era'||'_generic_available_opening','outcome','accepted_opening_validation',
 'sql_checks',(select count(*)from generic_history_assertions)+(select count(*)from generic_history_refusals),
 'assertions',(select jsonb_agg(label order by label)from generic_history_assertions),
 'focused_refusals',(select jsonb_agg(jsonb_build_object('label',label,'error',error)order by label)from generic_history_refusals),
 'available_quantity','2.500','original_movement_count',2,'original_generic_provenance_count',case(payload->>'era')::integer when 187 then 0 else 2 end,
 'exact_original_movement_snapshots',true,'empty_native_custody_boundary',true,'only_available_cells',true,
 'unattached_opening_frozen_only',true,'active_state_created',false,'managed_events_or_source_links_created',false,
 'all_refusal_relations_and_manifests_rolled_back',true,'synthetic_configuration_only',true,'practice_physical_count',false,
 'clinical_or_register_activation',false,'provenance_backfilled',false,'outer_transaction_rolled_back',true)from generic_history_input;
-- GENERIC_OBSERVATION_END --
rollback;
