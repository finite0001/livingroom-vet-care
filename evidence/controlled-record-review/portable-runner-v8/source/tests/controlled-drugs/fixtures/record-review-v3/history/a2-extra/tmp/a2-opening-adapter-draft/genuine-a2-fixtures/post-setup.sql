-- Fresh206 connection; source IDs were admitted from the closed188 backend.
create temp table a2_products(label text primary key,correction_version integer not null,correction_kind text);
insert into a2_products values('plain',0,null),('clinical_prefix',1,'clinical_annotation'),('operational_prefix',1,'operational_annotation'),('split',0,null),('pickup',0,null);
create temp table a2_expected_cells(k text primary key,product_label text not null,container_key text not null,lot_number integer not null,
 allocation_number integer,channel text not null,quantity numeric not null);
insert into a2_expected_cells values __CELL_VALUES__;
create temp table a2_cases(label text primary key,product_label text not null,correction_kind text not null,site_basis text not null,
 family_key text,predecessor_key text,event_sequence integer not null,ordinal integer not null unique);
insert into a2_cases values __TARGET_VALUES__;
create temp table a2_expected_boundaries(label text primary key,boundary jsonb not null);
create temp table a2_before_append(label text primary key,collected jsonb not null,adapted jsonb not null,expected jsonb not null);
create temp table a2_native_receipts(label text primary key,receipt jsonb not null);
create function pg_temp.a2_expected_boundary(p_label text) returns jsonb language plpgsql stable as $$
declare d public.native_dispenses;op public.native_fulfillment_operations;c public.native_dispense_correction_events;
 version integer;ch jsonb;allocs jsonb;begin
 select correction_version into strict version from a2_products where label=p_label;
 select * into strict d from public.native_dispenses where id=pg_temp.a2_id(p_label||'.dispense');
 select * into strict op from public.native_fulfillment_operations where id=d.id;
 if d.quantity<>2.000 or d.authorization_id<>pg_temp.a2_id(p_label||'.sign') or d.pet_id<>pg_temp.a2_id('pet')
 or d.invoice_id<>pg_temp.a2_id(p_label||'.invoice') or d.actor_id<>pg_temp.a2_id('actor')
 or op.operation<>'dispense' or op.actor_id<>d.actor_id or op.result->'dispense' is distinct from d.document then
 raise exception 'A2 independent opening original dispense differs' using errcode='23514';end if;
 ch:=jsonb_build_object('event_id',null,'version',0,'record_hash',null);
 if version=1 then
  select * into strict c from public.native_dispense_correction_events where id=pg_temp.a2_id(p_label||'.old_correction');
  if c.dispense_id<>d.id or c.sequence<>1 or c.prior_event_id is not null
  or c.kind is distinct from(select correction_kind from a2_products where label=p_label) then
  raise exception 'A2 exact retained correction selector differs' using errcode='23514';end if;
  ch:=jsonb_build_object('event_id',c.id,'version',1,'record_hash',c.record_hash);
 end if;
 if (select count(*)from public.native_dispense_allocations where dispense_id=d.id)<>2
 or exists(select 1 from public.native_dispense_allocations a where a.dispense_id=d.id and not exists(select 1 from generate_series(1,2)n
 where a.id=pg_temp.a2_id(p_label||'.allocation'||n) and a.lot_id=pg_temp.a2_id(p_label||'.lot'||n) and a.quantity=1.000
 and a.movement_id=pg_temp.a2_id(p_label||'.movement'||n))) then raise exception 'A2 complete original allocations differ' using errcode='23514';end if;
 select jsonb_agg(jsonb_build_object('allocation_id',pg_temp.a2_id(p_label||'.allocation'||n),'lot_id',pg_temp.a2_id(p_label||'.lot'||n),
 'dispensed_quantity','1.000','prepared_quantity','1.000','held','[]'::jsonb)order by pg_temp.a2_id(p_label||'.allocation'||n))into allocs from generate_series(1,2)n;
 return jsonb_build_object('version',1,'dispense_id',d.id,'dispense_document_hash',public.native_fulfillment_hash(d.document),
 'dispense_operation_hash',public.native_fulfillment_hash(public.native_fulfillment_receipt(op)),
 'return_head',jsonb_build_object('event_id',null,'version',0,'record_hash',null),'correction_head',ch,
 'discrepancy_head',jsonb_build_object('event_id',null,'version',0,'record_hash',null),'pickup',null,'allocations',allocs);
end $$;
create function pg_temp.a2_permission(p_basis text)returns jsonb language sql immutable as $$
 select jsonb_build_object('enabled',true,'roles',jsonb_build_array('DVM'),'basis',p_basis,'witness','none','secondary_review',true,'location_kinds',jsonb_build_array('clinic'))
$$;
create function pg_temp.a2_controlled_annotation(p_product text,p_target text,p_request jsonb)returns jsonb language plpgsql as $$
declare args jsonb:=jsonb_build_object('request',p_request);context jsonb;receipt jsonb;begin
 perform pg_temp.a2_identity('controlled_owner');
 if not exists(select 1 from a2_cases where label=p_target and product_label=p_product and correction_kind<>'pickup')
 and not(p_target='O_plain_later_clinical_witness' and p_product='plain') then raise exception 'A2 undeclared annotation' using errcode='23514';end if;
 context:=jsonb_build_object('version',1,'product_id',pg_temp.a2_id(p_product||'.product'),'policy_version_id',pg_temp.a2_id(p_product||'.policy'),
 'state_head_id',pg_temp.a2_id(p_product||'.active'),'opening_id',pg_temp.a2_id(p_product||'.opening'),
 'basis',jsonb_build_object('kind','annotation','observed_at',null,'note','Synthetic A2 annotation fixture'),'containers','[]'::jsonb);
 perform public.prepare_controlled_stock_action(auth.uid(),pg_temp.a2_id(p_target),'append_native_dispense_correction',args,context);
 receipt:=public.execute_controlled_stock_action(auth.uid(),pg_temp.a2_id(p_target));
 insert into a2_native_receipts values(p_target,receipt);
 return receipt;
end $$;
