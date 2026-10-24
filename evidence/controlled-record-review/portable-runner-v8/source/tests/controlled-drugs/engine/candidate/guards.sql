create function public.controlled_stock_lock_held(p_namespace text,p_id uuid)returns boolean
language sql volatile set search_path=public,pg_temp as $$
 select exists(select 1 from pg_locks l where l.pid=pg_backend_pid()and l.locktype='advisory'and l.granted and l.mode='ExclusiveLock'and l.objsubid=1
  and l.classid::bigint=((hashtextextended(p_namespace||p_id::text,0)>>32)&4294967295)
  and l.objid::bigint=(hashtextextended(p_namespace||p_id::text,0)&4294967295))
$$;
create function public.controlled_stock_configuration_required()returns uuid
language plpgsql volatile set search_path=public,pg_temp as $$declare actor uuid:=public.controlled_stock_actor();begin
 if not exists(select 1 from pg_locks where pid=pg_backend_pid()and locktype='advisory'and granted
  and classid=90271040 and objid=0 and objsubid=2 and mode='ExclusiveLock')
  or exists(select 1 from pg_locks where pid=pg_backend_pid()and locktype='advisory'and granted
   and classid=90271040 and objid=0 and objsubid=2 and mode='ShareLock')
  or not exists(select 1 from public.user_roles where user_id=actor and role in('DVM','ADMIN'))then
  raise exception 'Private reviewed exclusive configuration context required'using errcode='23514';end if;
 return actor;
end $$;
create function public.controlled_stock_execution_required(p_id uuid)returns public.controlled_stock_execution_contexts
language plpgsql volatile set search_path=public,pg_temp as $$
declare context public.controlled_stock_execution_contexts:=public.controlled_stock_current();r public.controlled_stock_preparations;begin
 perform public.controlled_stock_actor();
 select * into r from public.controlled_stock_preparations where id=p_id;
 if context.operation_id is distinct from p_id or r.id is null or context.actor_id is distinct from r.actor_id
  or context.writer is distinct from r.writer
  or not public.controlled_stock_lock_held('controlled-stock-operation:',p_id)
  or not public.controlled_stock_lock_held('controlled-stock-product:',r.product_id)then
  raise exception 'Exact private owned executing context and ordered gates required'using errcode='23514';end if;
 return context;
end $$;
create function public.controlled_stock_insert_guard()returns trigger
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare j jsonb:=to_jsonb(NEW);context public.controlled_stock_execution_contexts;r public.controlled_stock_preparations;
 actor uuid;root uuid;container public.controlled_stock_containers;cell public.controlled_stock_cells;
begin
 if TG_TABLE_NAME in('controlled_stock_sites','controlled_stock_locations','controlled_stock_policy_versions','controlled_stock_policy_sites',
  'controlled_stock_openings','controlled_stock_opening_movements','controlled_stock_state_events')then
  actor:=public.controlled_stock_configuration_required();
  if j?'actor_id'and(j->>'actor_id')::uuid is distinct from actor then raise exception 'Actual configuration recorder required'using errcode='23514';end if;
  if j?'session_id'and(j->>'session_id')::uuid is distinct from public.next_visit_review_session()then raise exception 'Actual configuration session required'using errcode='23514';end if;
  if TG_TABLE_NAME='controlled_stock_policy_sites'and exists(select 1 from public.controlled_stock_state_events where policy_version_id=(j->>'policy_version_id')::uuid)then
   raise exception 'Published policy site membership requires a new reviewed policy version'using errcode='23514';end if;
  if TG_TABLE_NAME='controlled_stock_opening_movements'and exists(select 1 from public.controlled_stock_state_events where opening_id=(j->>'opening_id')::uuid and state='active')then
   raise exception 'An active opening cannot acquire additional historical movements'using errcode='23514';end if;
  return NEW;
 end if;
 if TG_TABLE_NAME in('controlled_stock_preparations','controlled_stock_cancellations')then
  actor:=public.controlled_stock_actor();root:=(j->>'id')::uuid;
  if(j->>'actor_id')::uuid is distinct from actor or(j->>'session_id')::uuid is distinct from public.next_visit_review_session()
   or not public.controlled_stock_lock_held('controlled-stock-operation:',root)then
   raise exception 'Actual owned reviewed action recorder and gate required'using errcode='23514';end if;
  if TG_TABLE_NAME='controlled_stock_cancellations'and(public.controlled_stock_root_exists(root)
   or exists(select 1 from public.controlled_stock_actions where id=root))then
   raise exception 'Committed or uncertain canonical work cannot be cancelled'using errcode='23514';end if;
  return NEW;
 end if;
 if TG_TABLE_NAME='controlled_stock_cells'then
  select * into container from public.controlled_stock_containers where id=NEW.container_id;
  if NEW.created_event_id is null then
   perform public.controlled_stock_configuration_required();
   if exists(select 1 from public.controlled_stock_state_events where opening_id=NEW.opening_id and state='active')then
    raise exception 'An active opening cannot acquire additional physical cells'using errcode='23514';end if;
   if NEW.opening_id is distinct from container.opening_id then raise exception 'Exact container opening cell required'using errcode='23514';end if;
   return NEW;
  end if;
  root:=NEW.created_event_id;
 elsif TG_TABLE_NAME='controlled_stock_containers'then
  if NEW.created_event_id is null then
   perform public.controlled_stock_configuration_required();
   if exists(select 1 from public.controlled_stock_state_events where opening_id=NEW.opening_id and state='active')then
    raise exception 'An active opening cannot acquire additional containers'using errcode='23514';end if;
   return NEW;
  end if;
  root:=NEW.created_event_id;
 elsif TG_TABLE_NAME in('controlled_stock_events','controlled_stock_actions')then root:=(j->>'id')::uuid;
 else root:=(j->>'event_id')::uuid;end if;
 context:=public.controlled_stock_execution_required(root);
 select * into r from public.controlled_stock_preparations where id=root;
 if j?'actor_id'and(j->>'actor_id')::uuid is distinct from context.actor_id then raise exception 'Actual event recorder required'using errcode='23514';end if;
 if j?'session_id'and(j->>'session_id')::uuid is distinct from context.session_id then raise exception 'Actual executing session required'using errcode='23514';end if;
 if j?'writer'and j->>'writer'is distinct from context.writer then raise exception 'Actual canonical event writer required'using errcode='23514';end if;
 if TG_TABLE_NAME='controlled_stock_actions'and(j->>'request_hash'<>r.request_hash or exists(select 1 from public.controlled_stock_cancellations where id=root))then
  raise exception 'Exact uncancelled owned action receipt required'using errcode='23514';end if;
 return NEW;
end $$;
create function public.controlled_stock_projection_guard()returns trigger
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare context public.controlled_stock_execution_contexts;c public.controlled_stock_cells;t public.controlled_stock_containers;
 product uuid;root uuid;expected numeric;
begin
 if TG_OP in('DELETE','TRUNCATE')then raise exception 'Controlled projections cannot erase evidence'using errcode='23514';end if;
 if TG_TABLE_NAME='controlled_stock_states'then
  if TG_OP='INSERT'then
   perform public.controlled_stock_configuration_required();
   if NEW.event_version<>0 or NEW.last_event_id is not null then raise exception 'New controlled state starts before physical events'using errcode='23514';end if;
   return NEW;
  end if;
  if NEW.product_id<>OLD.product_id then raise exception 'Controlled product identity is immutable'using errcode='23514';end if;
  if NEW.head_id<>OLD.head_id then
   perform public.controlled_stock_configuration_required();
   if NEW.event_version<>OLD.event_version or NEW.last_event_id is distinct from OLD.last_event_id then
    raise exception 'Configuration cannot rewrite physical event heads'using errcode='23514';end if;
   return NEW;
  end if;
  context:=public.controlled_stock_execution_required(NEW.last_event_id);
  if NEW.event_version<>OLD.event_version+1 or not exists(select 1 from public.controlled_stock_events where id=NEW.last_event_id
   and product_id=NEW.product_id and sequence=NEW.event_version and prior_event_id is not distinct from OLD.last_event_id)then
   raise exception 'Guarded next controlled product event required'using errcode='23514';end if;
 elsif TG_TABLE_NAME='controlled_stock_container_heads'then
  select * into t from public.controlled_stock_containers where id=NEW.container_id;
  if TG_OP='INSERT'and NEW.version=0 then
   perform public.controlled_stock_configuration_required();
   if t.opening_id is null then raise exception 'Version-zero head requires its real opening'using errcode='23514';end if;
   return NEW;
  end if;
  context:=public.controlled_stock_execution_required(NEW.last_event_id);
  if TG_OP='UPDATE'and(NEW.container_id<>OLD.container_id or NEW.version<>OLD.version+1)then
   raise exception 'Guarded next immutable container transition required'using errcode='23514';end if;
  if not exists(select 1 from public.controlled_stock_container_transitions where container_id=NEW.container_id and event_id=NEW.last_event_id
   and version_after=NEW.version and after_location_id is not distinct from NEW.location_id
   and after_custodian_id is not distinct from NEW.custodian_id and after_status=NEW.status)then
   raise exception 'Container head must match its actual recorded transition'using errcode='23514';end if;
 elsif TG_TABLE_NAME='controlled_stock_positions'then
  select * into c from public.controlled_stock_cells where id=NEW.cell_id;
  if TG_OP='INSERT'then
   if c.opening_id is not null then
    perform public.controlled_stock_configuration_required();
    if NEW.quantity<>c.opening_quantity then raise exception 'Exact opening position required'using errcode='23514';end if;
   else
    perform public.controlled_stock_execution_required(c.created_event_id);
    if NEW.quantity<>0 then raise exception 'New event cell starts at zero before its exact signed line'using errcode='23514';end if;
   end if;
   return NEW;
  end if;
  if NEW.cell_id<>OLD.cell_id then raise exception 'Physical cell identity is immutable'using errcode='23514';end if;
  context:=public.controlled_stock_current();perform public.controlled_stock_execution_required(context.operation_id);
  select OLD.quantity+coalesce(sum(quantity_delta),0)into expected from public.controlled_stock_event_lines where cell_id=NEW.cell_id and event_id=context.operation_id;
  if NEW.quantity<>expected or NEW.quantity<0 then raise exception 'Position must advance only by its actual signed event lines'using errcode='23514';end if;
 else raise exception 'Unsupported controlled projection'using errcode='23514';end if;
 return NEW;
end $$;
create function public.controlled_stock_execution_guard()returns trigger
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.controlled_stock_actor();r public.controlled_stock_preparations;begin
 if TG_OP='TRUNCATE'then raise exception 'Cannot truncate controlled technical context through an application operation'using errcode='23514';end if;
 if TG_OP='DELETE'then
  if OLD.operation_id is distinct from(public.controlled_stock_current()).operation_id
   or not exists(select 1 from public.controlled_stock_actions where id=OLD.operation_id and actor_id=actor)then
   raise exception 'Only a completely saved owned execution may clear its current context'using errcode='23514';end if;
  return OLD;
 end if;
 select * into r from public.controlled_stock_preparations where id=NEW.operation_id;
 if r.id is null or NEW.actor_id<>actor or NEW.actor_id<>r.actor_id or NEW.writer<>r.writer
  or NEW.session_id<>public.next_visit_review_session()or NEW.backend_pid<>pg_backend_pid()
  or NEW.server_started_at<>pg_postmaster_start_time()or NEW.transaction_id<>txid_current()
  or NEW.transaction_started_at<>transaction_timestamp()or NEW.statement_started_at<>statement_timestamp()
  or NEW.phase<>'executing'or not public.controlled_stock_lock_held('controlled-stock-operation:',r.id)
  or not public.controlled_stock_lock_held('controlled-stock-product:',r.product_id)then
  raise exception 'Actual live owned execution identity and ordered gates required'using errcode='23514';end if;
 if TG_OP='UPDATE'and OLD.backend_pid=pg_backend_pid()and OLD.server_started_at=pg_postmaster_start_time()
  and OLD.transaction_id=txid_current()and OLD.transaction_started_at=transaction_timestamp()then
  raise exception 'A current active execution cannot be overwritten'using errcode='23514';end if;
 return NEW;
end $$;
create function public.controlled_stock_deferred()returns trigger
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare j jsonb:=to_jsonb(NEW);root uuid;product uuid;v uuid;begin
 if TG_TABLE_NAME='controlled_stock_execution_contexts'then
  if exists(select 1 from public.controlled_stock_execution_contexts where backend_pid=pg_backend_pid()and server_started_at=pg_postmaster_start_time()
   and transaction_id=txid_current()and transaction_started_at=transaction_timestamp())then
   raise exception 'Owned execution context must be cleared before transaction completion'using errcode='23514';end if;
  return null;
 end if;
 if TG_TABLE_NAME in('inventory_movements','native_return_events','native_return_discrepancy_events','native_pickups','native_dispense_correction_events')then
  if TG_TABLE_NAME='inventory_movements'then
   select product_id into product from public.inventory_lots where id=NEW.lot_id;
   select event_id into root from public.controlled_stock_source_links where movement_id=NEW.id;
  else
   select l.product_id into product from public.native_dispense_allocations a join public.inventory_lots l on l.id=a.lot_id where a.dispense_id=NEW.dispense_id limit 1;
   select event_id into root from public.controlled_stock_source_links where coalesce(return_event_id,discrepancy_event_id,pickup_id,correction_event_id)=NEW.id;
  end if;
  if not exists(select 1 from public.controlled_stock_policy_versions where product_id=product)then return null;end if;
  if root is null then raise exception 'Every new managed canonical source requires its exact controlled event'using errcode='23514';end if;
 elsif TG_TABLE_NAME in('controlled_stock_events','controlled_stock_actions')then root:=NEW.id;product:=(select product_id from public.controlled_stock_preparations where id=root);
 elsif TG_TABLE_NAME in('controlled_stock_event_lines','controlled_stock_source_links','controlled_stock_container_transitions')then root:=NEW.event_id;product:=(select product_id from public.controlled_stock_events where id=root);
 elsif TG_TABLE_NAME='controlled_stock_container_heads'then root:=NEW.last_event_id;product:=(select product_id from public.controlled_stock_containers where id=NEW.container_id);
 elsif TG_TABLE_NAME='controlled_stock_positions'then
  select t.product_id into product from public.controlled_stock_cells c join public.controlled_stock_containers t on t.id=c.container_id where c.id=NEW.cell_id;
 elsif TG_TABLE_NAME='controlled_stock_cells'then product:=(select product_id from public.controlled_stock_containers where id=NEW.container_id);
 elsif TG_TABLE_NAME='controlled_stock_containers'then product:=NEW.product_id;
 elsif TG_TABLE_NAME='controlled_stock_cancellations'then
  if exists(select 1 from public.controlled_stock_actions where id=NEW.id)or public.controlled_stock_root_exists(NEW.id)then
   raise exception 'Cancelled controlled UUID cannot also have a canonical commit'using errcode='23514';end if;
 elsif TG_TABLE_NAME='controlled_stock_preparations'then
  if NEW.request_hash<>public.controlled_stock_hash(jsonb_build_object('version',1,'actor_id',NEW.actor_id,'id',NEW.id,
   'writer',NEW.writer,'canonical_arguments',NEW.canonical_arguments,'context',NEW.context))then
   raise exception 'Immutable prepared controlled request hash mismatch'using errcode='23514';end if;
 elsif j?'product_id'then product:=(j->>'product_id')::uuid;
 elsif TG_TABLE_NAME='controlled_stock_policy_sites'then product:=(select product_id from public.controlled_stock_policy_versions where id=NEW.policy_version_id);
 elsif TG_TABLE_NAME='controlled_stock_opening_movements'then product:=(select product_id from public.controlled_stock_openings where id=NEW.opening_id);
 end if;
 if root is not null then perform public.controlled_stock_validate_event(root);end if;
 if product is not null then perform public.controlled_stock_validate_product(product);end if;
 return null;
end $$;
