create function public.controlled_stock_container_snapshot(p_context jsonb)returns jsonb
language sql volatile set search_path=public,pg_temp set timezone='UTC' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',c.value->'id','container',to_jsonb(t),'head',to_jsonb(h),
  'cells',(select coalesce(jsonb_agg(jsonb_build_object('cell',to_jsonb(cell),'position',to_jsonb(pos))order by cell.id),'[]'::jsonb)
   from public.controlled_stock_cells cell join public.controlled_stock_positions pos on pos.cell_id=cell.id where cell.container_id=t.id)
 )order by c.value->>'id'),'[]'::jsonb)from jsonb_array_elements(p_context->'containers')c
 left join public.controlled_stock_containers t on t.id=(c.value->>'id')::uuid
 left join public.controlled_stock_container_heads h on h.container_id=t.id
$$;
create function public.controlled_stock_source_totals(p_effects jsonb)returns jsonb
language sql immutable set search_path=public,pg_temp as $$
 select public.controlled_stock_effect_totals(coalesce((select jsonb_agg(jsonb_build_object('lot_id',v->'lot_id',
  'channel','available','dispense_id',null,'intake_id',null,'quantity_delta',v->'quantity_delta'))from jsonb_array_elements(p_effects->'available')v),'[]'::jsonb)
  ||coalesce(p_effects->'custody','[]'::jsonb))
$$;
create function public.controlled_stock_transition_allowed(p_writer text,p_arguments jsonb,p_container uuid,p_after jsonb)returns void
language plpgsql volatile set search_path=public,pg_temp as $$
declare h public.controlled_stock_container_heads;c public.controlled_stock_containers;action text;begin
 select * into c from public.controlled_stock_containers where id=p_container;
 select * into h from public.controlled_stock_container_heads where container_id=p_container;
 if not found then return;end if;
 action:=p_arguments#>>'{request,intent,action}';
 if p_writer='record_native_pickup'then
  if c.kind<>'prepared'or p_after is distinct from jsonb_build_object('status','handed_off','location_id',null,'custodian_id',null)then
   raise exception 'Complete pickup must release its actual prepared containers'using errcode='23514';end if;
 elsif p_writer in('record_native_dispense_return','record_native_dispense_return_v2')and action='dispose'and c.kind='prepared'
  and p_after->>'status'='disposed'and p_after->'location_id'='null'::jsonb and p_after->'custodian_id'='null'::jsonb then null;
 elsif p_writer='record_native_dispense_return_v2'and action='retract_disposal'and h.status='disposed'
  and c.kind='prepared'and p_after->>'status'='onsite'then null;
 elsif p_after is distinct from jsonb_build_object('status',h.status,'location_id',h.location_id,'custodian_id',h.custodian_id)then
  raise exception 'This source cannot imply a physical transfer or change of custodian'using errcode='23514';end if;
end $$;
create function public.controlled_stock_return_requirements(p_writer text,p_bundle jsonb,p_context jsonb)returns void
language plpgsql volatile set search_path=public,pg_temp as $$
declare native jsonb:=p_bundle->'native';did uuid;action text;target uuid;c jsonb;lot uuid;prepared numeric;held numeric;begin
 if native='null'::jsonb then return;end if;did:=(native->>'dispense_id')::uuid;
 if native->>'kind'='pickup'then
  if exists(select 1 from public.native_return_events where dispense_id=did)then
   raise exception 'Prior custody history requires a separately reviewed complete-package exception'using errcode='23514';end if;
  if exists(select 1 from public.controlled_stock_cells cell join public.controlled_stock_positions pos on pos.cell_id=cell.id
   where cell.dispense_id=did and cell.channel='return_held'and pos.quantity<>0)then
   raise exception 'Held medication cannot be handed off as the complete prepared package'using errcode='23514';end if;
  for c in select value from jsonb_array_elements(native->'original_allocations')loop
   select coalesce(sum(pos.quantity),0)into prepared from public.controlled_stock_cells cell join public.controlled_stock_positions pos on pos.cell_id=cell.id
    where cell.channel='prepared'and cell.allocation_id=(c->>'allocation_id')::uuid and cell.dispense_id=did;
   if prepared is distinct from(c->>'quantity')::numeric then raise exception 'Pickup requires every exact original prepared allocation'using errcode='23514';end if;
  end loop;
 elsif native->>'kind'='return'then
  if native#>>'{return_source,intake_document,custody}'is distinct from 'clinic_retained'
   or exists(select 1 from public.native_pickups where dispense_id=did)then
   raise exception 'Routine client-returned, unknown or handed-off controlled custody is unavailable'using errcode='23514';end if;
  action:=native#>>'{document,action}';
  if action like 'retract_%'then
   target:=(native#>>'{document,correction_target,event_id}')::uuid;
   if target is null or not exists(select 1 from public.controlled_stock_events e where e.id=target and e.product_id=(p_bundle->>'product_id')::uuid
    and e.source_bundle#>>'{native,kind}'='return')then
    raise exception 'Pre-opening or unlinked custody corrections require a reviewed exception workflow'using errcode='23514';end if;
  end if;
  if action in('intake','retract_intake')then
   for c in select value from jsonb_array_elements(p_context->'containers')loop
    for lot in select distinct(line->>'lot_id')::uuid from jsonb_array_elements(c->'lines')line loop
     select coalesce(sum((line->>'quantity_delta')::numeric)filter(where line->>'channel'='prepared'),0),
      coalesce(sum((line->>'quantity_delta')::numeric)filter(where line->>'channel'='return_held'),0)
     into prepared,held from jsonb_array_elements(c->'lines')line where(line->>'lot_id')::uuid=lot;
     if prepared<>-held then raise exception 'Intake classification must preserve each actual container quantity'using errcode='23514';end if;
    end loop;
   end loop;
  end if;
 end if;
end $$;
create function public.controlled_stock_finish(p_id uuid,p_result jsonb)returns jsonb
language plpgsql volatile set search_path=public,pg_temp set timezone='UTC' as $$
declare context public.controlled_stock_execution_contexts:=public.controlled_stock_current();r public.controlled_stock_preparations;
 admission public.stock_writer_admissions:=public.stock_writer_current();policy public.controlled_stock_policy_versions;
 product_head public.controlled_stock_states;event public.controlled_stock_events;container public.controlled_stock_containers;
 head public.controlled_stock_container_heads;bundle jsonb;effects jsonb;permission jsonb;value jsonb;line jsonb;created jsonb;after_value jsonb;
 canonical_catalog jsonb;receipt jsonb;available_link uuid;native_link uuid;cell uuid;allocation uuid;lot uuid;did uuid;iid uuid;
 cid uuid;source uuid;delta numeric;position numeric;before_version bigint;after_version bigint;stamp timestamptz:=clock_timestamp();
begin
 if context.operation_id is distinct from p_id or admission.source_id is distinct from p_id
  or context.writer is distinct from admission.writer or context.actor_id is distinct from admission.actor_id then
  raise exception 'Exact outer owned source admission required to finish controlled posting'using errcode='23514';end if;
 select * into r from public.controlled_stock_preparations where id=p_id and actor_id=context.actor_id and writer=context.writer;
 if not found then raise exception 'Original owned controlled preparation required'using errcode='23514';end if;
 perform public.controlled_stock_actor(r.actor_id);
 bundle:=public.controlled_stock_source_bundle(r.writer,r.id,r.actor_id,p_result);
 effects:=public.controlled_stock_source_effects(r.writer,r.id,r.actor_id,p_result);
 if public.controlled_stock_source_totals(effects)is distinct from public.controlled_stock_effect_totals(r.frozen->'expected_effects')then
  raise exception 'Actual canonical sources do not match the reviewed physical effects'using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(effects->'available')a group by a->>'lot_id'having count(*)<>1)then
  raise exception 'Available source slots must be unambiguous; never net movements'using errcode='23514';end if;
 -- Canonical resource locks are already held. This product SHARE tail fixes
 -- the reviewed catalog until commit before acquiring sorted container gates.
 select to_jsonb(p)into canonical_catalog from public.catalog_products p where p.id=r.product_id for share;
 perform public.controlled_stock_actor(r.actor_id);
 if canonical_catalog is distinct from r.frozen->'catalog'then raise exception 'Reviewed controlled catalog changed'using errcode='PT409';end if;
 for value in select v from jsonb_array_elements(r.context->'containers')v order by v->>'id'loop
  perform pg_advisory_xact_lock(hashtextextended('controlled-stock-container:'||(value->>'id'),0));
  perform public.controlled_stock_actor(r.actor_id);
 end loop;
 permission:=public.controlled_stock_permission(r.actor_id,r.writer,r.canonical_arguments,r.context);
 perform public.controlled_stock_manifest_required();perform public.controlled_stock_actor(r.actor_id);
 if public.controlled_stock_container_snapshot(r.context)is distinct from r.frozen->'containers'then
  raise exception 'Controlled container heads or positions changed after review'using errcode='PT409';end if;
 perform public.controlled_stock_return_requirements(r.writer,bundle,r.context);
 select * into policy from public.controlled_stock_policy_versions where id=r.policy_version_id;
 select * into product_head from public.controlled_stock_states where product_id=r.product_id;
 event.id:=r.id;event.product_id:=r.product_id;event.sequence:=product_head.event_version+1;event.prior_event_id:=product_head.last_event_id;
 event.policy_version_id:=policy.id;event.opening_id:=r.opening_id;event.engine_revision:=policy.engine_revision;
 event.writer:=r.writer;event.event_kind:=public.controlled_stock_event_kind(r.writer,r.canonical_arguments);
 event.actor_id:=r.actor_id;event.session_id:=public.next_visit_review_session();
 select full_name into event.actor_name from public.profiles where id=r.actor_id;
 event.basis:=r.context#>>'{basis,kind}';
 if event.basis='physical_record'then event.observed_at:=public.appointment_catalog_instant(r.context#>'{basis,observed_at}');end if;
 event.recorded_at:=stamp;event.note:=r.context#>>'{basis,note}';event.context_hash:=public.controlled_stock_hash(r.context);
 event.canonical_result:=p_result;event.source_bundle:=bundle;event.source_effects:=effects;
 event.clinical_snapshot:=jsonb_build_object('catalog',canonical_catalog,'original_result',p_result);
 event.secondary_review_required:=(permission->>'secondary_review')::boolean;
 select record_hash into event.prior_record_hash from public.controlled_stock_events where id=event.prior_event_id;
 event.record_hash:=public.controlled_stock_hash(to_jsonb(event)-'record_hash');
 insert into public.controlled_stock_events select(event).*;
 for value in select v from jsonb_array_elements(effects->'available')v loop
  insert into public.controlled_stock_source_links(id,event_id,movement_id)values(gen_random_uuid(),r.id,(value->>'id')::uuid);
 end loop;
 native_link:=gen_random_uuid();
 case bundle#>>'{native,kind}'
  when 'return'then insert into public.controlled_stock_source_links(id,event_id,return_event_id)values(native_link,r.id,r.id);
  when 'pickup'then insert into public.controlled_stock_source_links(id,event_id,pickup_id)values(native_link,r.id,r.id);
  when 'discrepancy'then insert into public.controlled_stock_source_links(id,event_id,discrepancy_event_id)values(native_link,r.id,r.id);
  when 'correction'then insert into public.controlled_stock_source_links(id,event_id,correction_event_id)values(native_link,r.id,r.id);
  else native_link:=null;end case;
 for value in select v from jsonb_array_elements(r.context->'containers')v order by v->>'id'loop
  cid:=(value->>'id')::uuid;created:=value->'create';after_value:=value->'after';
  if value->'expected_version'='null'::jsonb then
   insert into public.controlled_stock_containers(id,product_id,stock_unit,label,kind,stock_lot_id,controlling_site_id,initial_location_id,
    initial_custodian_id,created_event_id,actor_id,session_id)values(cid,r.product_id,policy.stock_unit,created->>'label',created->>'kind',
    (created->>'stock_lot_id')::uuid,(created->>'site_id')::uuid,(created->>'location_id')::uuid,(created->>'custodian_id')::uuid,r.id,r.actor_id,event.session_id)
   returning * into container;
   head.container_id:=cid;head.version:=0;head.location_id:=container.initial_location_id;head.custodian_id:=container.initial_custodian_id;
   head.status:='onsite';head.last_event_id:=null;
  else
   select * into container from public.controlled_stock_containers where id=cid;
   select * into head from public.controlled_stock_container_heads where container_id=cid;
   if head.version is distinct from(value->>'expected_version')::bigint then raise exception 'Reviewed container version changed'using errcode='PT409';end if;
  end if;
  before_version:=head.version;after_version:=before_version+1;
  perform public.controlled_stock_transition_allowed(r.writer,r.canonical_arguments,cid,after_value);
  for line in select v from jsonb_array_elements(value->'lines')v loop
   lot:=(line->>'lot_id')::uuid;did:=(line->>'dispense_id')::uuid;iid:=(line->>'intake_id')::uuid;delta:=(line->>'quantity_delta')::numeric;
   allocation:=null;
   if did is not null then select id into allocation from public.native_dispense_allocations where dispense_id=did and lot_id=lot;
    if allocation is null then raise exception 'Actual original native allocation identity required'using errcode='23514';end if;
   end if;
   select c.id into cell from public.controlled_stock_cells c where c.container_id=cid and c.lot_id=lot and c.channel=line->>'channel'
    and c.dispense_id is not distinct from did and c.allocation_id is not distinct from allocation and c.intake_id is not distinct from iid;
   if not found then
    if delta<0 then raise exception 'An unknown physical cell cannot supply quantity'using errcode='23514';end if;
    cell:=gen_random_uuid();
    insert into public.controlled_stock_cells(id,container_id,lot_id,channel,dispense_id,allocation_id,intake_id,created_event_id,opening_quantity)
     values(cell,cid,lot,line->>'channel',did,allocation,iid,r.id,0);
    insert into public.controlled_stock_positions values(cell,0);
   end if;
   select p.quantity into position from public.controlled_stock_positions p where p.cell_id=cell for update;
   perform public.controlled_stock_actor(r.actor_id);
   if position+delta<0 then raise exception 'Insufficient exact physical container quantity'using errcode='PT409';end if;
   if line->>'channel'='available'then
    select l.id into source from public.controlled_stock_source_links l join public.inventory_movements m on m.id=l.movement_id
     where l.event_id=r.id and m.lot_id=lot;
   elsif bundle#>>'{native,kind}'='dispense'then
    select l.id into source from public.controlled_stock_source_links l join public.native_dispense_allocations a on a.movement_id=l.movement_id
     where l.event_id=r.id and a.id=allocation;
   else source:=native_link;end if;
   if source is null then raise exception 'Exact original source link required for each physical allocation'using errcode='23514';end if;
   insert into public.controlled_stock_event_lines values(gen_random_uuid(),r.id,cell,source,delta,before_version,after_version);
   update public.controlled_stock_positions set quantity=position+delta where cell_id=cell;
  end loop;
  if after_value->>'status'<>'onsite'and exists(select 1 from public.controlled_stock_cells c join public.controlled_stock_positions p on p.cell_id=c.id
   where c.container_id=cid and p.quantity<>0)then raise exception 'Released or disposed container still contains medication'using errcode='23514';end if;
  insert into public.controlled_stock_container_transitions values(gen_random_uuid(),r.id,cid,before_version,after_version,
   head.location_id,head.custodian_id,head.status,(after_value->>'location_id')::uuid,(after_value->>'custodian_id')::uuid,after_value->>'status');
  insert into public.controlled_stock_container_heads values(cid,after_version,(after_value->>'location_id')::uuid,(after_value->>'custodian_id')::uuid,after_value->>'status',r.id)
  on conflict(container_id)do update set version=excluded.version,location_id=excluded.location_id,custodian_id=excluded.custodian_id,status=excluded.status,last_event_id=excluded.last_event_id;
 end loop;
 update public.controlled_stock_states set event_version=event.sequence,last_event_id=event.id where product_id=r.product_id;
 receipt:=jsonb_build_object('version',1,'id',r.id,'writer',r.writer,'actor_id',r.actor_id,'canonical_result',p_result,
  'event',to_jsonb(event),'containers',(select coalesce(jsonb_agg(to_jsonb(h)order by h.container_id),'[]'::jsonb)
   from public.controlled_stock_container_heads h where h.last_event_id=r.id));
 insert into public.controlled_stock_actions(id,actor_id,writer,session_id,request_hash,receipt,recorded_at)
  values(r.id,r.actor_id,r.writer,event.session_id,r.request_hash,receipt,stamp);
 perform public.controlled_stock_validate_event(r.id);
 perform public.controlled_stock_validate_product(r.product_id);
 perform public.controlled_stock_actor(r.actor_id);
 return receipt;
end $$;
