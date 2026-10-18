-- OWNED RESTORE CLONE ONLY. Privileged seeding below simulates technical rows
-- from an older server/transaction. It never grants application raw access.
begin;set local timezone='UTC';
create temp table restored_context_checks(n integer);
do $$declare r public.controlled_stock_preparations;old_receipt jsonb;receipt jsonb;ctx jsonb;args jsonb;
 c record;head public.controlled_stock_state_events;action uuid:=gen_random_uuid();movement_count bigint;event_count bigint;begin
 select p.*into r from public.controlled_stock_preparations p join public.controlled_stock_actions a on a.id=p.id
 where p.writer='adjust_inventory'order by p.created_at limit 1;
 if r.id is null then raise exception 'Exact original managed action required';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',r.actor_id,'session_id',r.session_id)::text,true);
 select a.receipt into old_receipt from public.controlled_stock_actions a where a.id=r.id;
 alter table public.controlled_stock_execution_contexts disable trigger controlled_guard;
 insert into public.controlled_stock_execution_contexts values(pg_backend_pid(),pg_postmaster_start_time()-interval '1 day',txid_current()-1,
  transaction_timestamp()-interval '1 day',statement_timestamp()-interval '1 day',gen_random_uuid(),r.id,r.writer,r.actor_id,r.session_id,'executing');
 -- Validate/drain the seeded obsolete row before restoring the row guard.
 set constraints all immediate;
 alter table public.controlled_stock_execution_contexts enable trigger controlled_guard;
 set constraints all deferred;
 perform set_config('controlled_stock.operation',r.id::text,true);
 perform controlled_stock_manifest_required();
 if(controlled_stock_current()).operation_id is not null then raise exception 'Restored technical context borrowed authority';end if;
 if execute_controlled_stock_action(r.actor_id,r.id)is distinct from old_receipt then raise exception 'Stale technical context changed saved recovery';end if;
 select ct.id,ct.product_id,ct.stock_lot_id,h.version,h.location_id,h.custodian_id,h.status into c
 from public.controlled_stock_containers ct join public.controlled_stock_container_heads h on h.container_id=ct.id
 where ct.product_id=r.product_id and ct.kind='stock'and exists(select 1 from public.controlled_stock_cells cell join public.controlled_stock_positions p on p.cell_id=cell.id
  where cell.container_id=ct.id and cell.channel='available'and p.quantity>0.125)order by ct.id limit 1;
 if c.id is null then raise exception 'Current actual stock container required';end if;
 select e.*into head from public.controlled_stock_states h join public.controlled_stock_state_events e on e.id=h.head_id where h.product_id=r.product_id;
 select count(*)into movement_count from public.inventory_movements;
 select count(*)into event_count from public.controlled_stock_events;
 begin
  perform adjust_inventory(gen_random_uuid(),c.stock_lot_id,-0.125,'Synthetic restored-context bypass');
  raise exception 'Restored context authorized a generic managed write'using errcode='P0002';
 exception when check_violation then
  if sqlerrm<>'Managed stock requires its actual owned executing context'then raise;end if;
 end;
 if(select count(*)from public.inventory_movements)<>movement_count then raise exception 'Rejected restored context added stock';end if;
 args:=jsonb_build_object('lot_id',c.stock_lot_id,'quantity','-0.125','reason','Synthetic restored owned adjustment');
 ctx:=jsonb_build_object('version',1,'product_id',r.product_id,'policy_version_id',head.policy_version_id,'state_head_id',head.id,'opening_id',head.opening_id,
  'basis',jsonb_build_object('kind','physical_record','observed_at',to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'note','Synthetic restored owned action only'),
  'containers',jsonb_build_array(jsonb_build_object('id',c.id,'expected_version',c.version,'create',null,
   'after',jsonb_build_object('status',c.status,'location_id',c.location_id,'custodian_id',c.custodian_id),
   'lines',jsonb_build_array(jsonb_build_object('lot_id',c.stock_lot_id,'channel','available','dispense_id',null,'intake_id',null,'quantity_delta','-0.125')))));
 perform prepare_controlled_stock_action(r.actor_id,action,'adjust_inventory',args,ctx);
 receipt:=execute_controlled_stock_action(r.actor_id,action);
 if receipt#>>'{canonical_result,id}'<>action::text or execute_controlled_stock_action(r.actor_id,action)is distinct from receipt
  or(select count(*)from public.inventory_movements)<>movement_count+1 or(select count(*)from public.controlled_stock_events)<>event_count+1
  or exists(select 1 from public.controlled_stock_execution_contexts where backend_pid=pg_backend_pid())then
  raise exception 'Genuine new owned execution failed to replace and clear stale technical context exactly once';end if;
 perform controlled_stock_validate_event(action);perform controlled_stock_validate_product(r.product_id);
 insert into restored_context_checks values(4);
end $$;
set constraints all immediate;
select jsonb_build_object('kind','controlled-restored-context','checks',n,'stale_context_not_authority',true,
 'saved_recovery_exact',true,'generic_bypass_denied',true,'new_owned_action_replaces_stale_context_once',true)from restored_context_checks;
rollback;
