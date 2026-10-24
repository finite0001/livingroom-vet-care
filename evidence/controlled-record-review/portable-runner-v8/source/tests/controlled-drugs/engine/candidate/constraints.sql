create function public.controlled_stock_validate_event(p_id uuid)returns void
language plpgsql volatile set search_path=public,pg_temp set timezone='UTC' as $$
declare e public.controlled_stock_events;a public.controlled_stock_actions;r public.controlled_stock_preparations;
 b jsonb;effects jsonb;value jsonb;heads jsonb;frozen_container jsonb;actual numeric;expected numeric;v record;source uuid;expected_links integer;
begin
 select * into e from public.controlled_stock_events where id=p_id;
 select * into a from public.controlled_stock_actions where id=p_id;
 select * into r from public.controlled_stock_preparations where id=p_id;
 if e.id is null or a.id is null or r.id is null or e.actor_id<>r.actor_id or a.actor_id<>r.actor_id
  or e.writer<>r.writer or a.writer<>r.writer or a.request_hash<>r.request_hash
  or e.product_id<>r.product_id or e.policy_version_id<>r.policy_version_id or e.opening_id<>r.opening_id
  or e.session_id<>a.session_id or e.recorded_at<>a.recorded_at or e.recorded_at<r.created_at
  or e.event_kind is distinct from public.controlled_stock_event_kind(r.writer,r.canonical_arguments)
  or e.basis is distinct from r.context#>>'{basis,kind}'or e.note is distinct from r.context#>>'{basis,note}'
  or e.observed_at is distinct from(case when e.basis='physical_record'then public.appointment_catalog_instant(r.context#>'{basis,observed_at}')else null end)
  or(e.observed_at is not null and(e.observed_at>e.recorded_at or e.observed_at<(select observed_at from public.controlled_stock_openings where id=e.opening_id)))
  or e.engine_revision is distinct from(select engine_revision from public.controlled_stock_policy_versions where id=e.policy_version_id)
  or e.secondary_review_required is distinct from(r.frozen#>>'{permission,secondary_review}')::boolean
  or e.clinical_snapshot is distinct from jsonb_build_object('catalog',r.frozen->'catalog','original_result',e.canonical_result)
  or e.context_hash<>public.controlled_stock_hash(r.context)
  or e.record_hash<>public.controlled_stock_hash(to_jsonb(e)-'record_hash')
  or exists(select 1 from public.controlled_stock_cancellations where id=p_id)then
  raise exception 'Exact immutable owned controlled event/action evidence required'using errcode='23514';end if;
 if e.sequence>1 and not exists(select 1 from public.controlled_stock_events prior where prior.id=e.prior_event_id
  and prior.product_id=e.product_id and prior.sequence=e.sequence-1 and prior.record_hash=e.prior_record_hash)then
  raise exception 'Controlled product event predecessor mismatch'using errcode='23514';end if;
 b:=public.controlled_stock_source_bundle(e.writer,e.id,e.actor_id,e.canonical_result);
 effects:=public.controlled_stock_source_effects(e.writer,e.id,e.actor_id,e.canonical_result);
 if e.source_bundle is distinct from b or e.source_effects is distinct from effects
  or public.controlled_stock_source_totals(effects)is distinct from public.controlled_stock_effect_totals(r.frozen->'expected_effects')then
  raise exception 'Controlled event must preserve every exact original canonical source'using errcode='23514';end if;
 expected_links:=jsonb_array_length(effects->'available')+case when b#>>'{native,kind}'in('return','pickup','discrepancy','correction')then 1 else 0 end;
 if(select count(*)from public.controlled_stock_source_links where event_id=e.id)<>expected_links then
  raise exception 'Exact controlled source-link membership required'using errcode='23514';end if;
 if b#>>'{native,kind}'in('return','pickup','discrepancy','correction')and not exists(
  select 1 from public.controlled_stock_source_links k where k.event_id=e.id and
   case b#>>'{native,kind}'when 'return'then k.return_event_id=e.id when 'pickup'then k.pickup_id=e.id
    when 'discrepancy'then k.discrepancy_event_id=e.id when 'correction'then k.correction_event_id=e.id else false end)then
  raise exception 'Exact original native source family and root required'using errcode='23514';end if;
 for value in select element.value from jsonb_array_elements(effects->'available')element(value)loop
  source:=null;
  select id into source from public.controlled_stock_source_links where event_id=e.id and movement_id=(value->>'id')::uuid;
  if source is null then raise exception 'Available stock movement missing its exact controlled source link'using errcode='23514';end if;
  select coalesce(sum(l.quantity_delta),0)into actual from public.controlled_stock_event_lines l
   join public.controlled_stock_cells c on c.id=l.cell_id
   where l.event_id=e.id and l.source_link_id=source and c.channel='available'and c.lot_id=(value->>'lot_id')::uuid;
  if actual is distinct from(value->>'quantity_delta')::numeric then
   raise exception 'Controlled available allocations must total their actual signed movement'using errcode='23514';end if;
 end loop;
 for value in select element.value from jsonb_array_elements(effects->'custody')element(value)loop
  select coalesce(sum(l.quantity_delta),0)into actual from public.controlled_stock_event_lines l
   join public.controlled_stock_cells c on c.id=l.cell_id join public.controlled_stock_source_links s on s.id=l.source_link_id
   where l.event_id=e.id and c.channel=value->>'channel'and c.lot_id=(value->>'lot_id')::uuid
    and c.allocation_id=(value->>'allocation_id')::uuid and c.dispense_id=(value->>'dispense_id')::uuid
    and c.intake_id is not distinct from(value->>'intake_id')::uuid
    and(case when b#>>'{native,kind}'='dispense'then s.movement_id=(select movement_id from public.native_dispense_allocations where id=c.allocation_id)
     else coalesce(s.return_event_id,s.pickup_id)=e.id end);
  if actual is distinct from(value->>'quantity_delta')::numeric then
   raise exception 'Controlled custody allocation must preserve its exact native source'using errcode='23514';end if;
 end loop;
 for v in select l.*,c.channel,c.lot_id,c.dispense_id,c.allocation_id,c.intake_id,c.container_id,s.event_id as source_event_id,
  s.movement_id,s.return_event_id,s.pickup_id,s.discrepancy_event_id,s.correction_event_id,t.product_id
  from public.controlled_stock_event_lines l join public.controlled_stock_cells c on c.id=l.cell_id
  join public.controlled_stock_source_links s on s.id=l.source_link_id
  join public.controlled_stock_containers t on t.id=c.container_id where l.event_id=e.id loop
  if v.source_event_id<>e.id or v.product_id<>e.product_id
   or not exists(select 1 from public.controlled_stock_container_transitions t where t.event_id=e.id and t.container_id=v.container_id
    and t.version_before=v.container_version_before and t.version_after=v.container_version_after)then
   raise exception 'Controlled line source, product and container transition must agree'using errcode='23514';end if;
  if v.channel='available'then
   if not exists(select 1 from jsonb_array_elements(effects->'available')x where(x->>'id')::uuid=v.movement_id
    and(x->>'lot_id')::uuid=v.lot_id and((x->>'quantity_delta')::numeric>0)=(v.quantity_delta>0))then
    raise exception 'Available line cannot borrow another source or hide an opposing movement'using errcode='23514';end if;
  else
   if not exists(select 1 from jsonb_array_elements(effects->'custody')x where x->>'channel'=v.channel
    and(x->>'lot_id')::uuid=v.lot_id and(x->>'allocation_id')::uuid=v.allocation_id
    and(x->>'dispense_id')::uuid=v.dispense_id and(x->>'intake_id')::uuid is not distinct from v.intake_id
    and((x->>'quantity_delta')::numeric>0)=(v.quantity_delta>0))then
    raise exception 'Custody line cannot borrow another native allocation or source meaning'using errcode='23514';end if;
  end if;
 end loop;
 if(select count(*)from public.controlled_stock_container_transitions where event_id=e.id)<>jsonb_array_length(r.context->'containers')then
  raise exception 'Every reviewed container must have one exact immutable transition'using errcode='23514';end if;
 for value in select element.value from jsonb_array_elements(r.context->'containers')element(value)loop
  select x.item into frozen_container from jsonb_array_elements(r.frozen->'containers')x(item)where x.item->>'id'=value->>'id';
  if frozen_container is null then raise exception 'Original frozen container frame required'using errcode='23514';end if;
  if value->'expected_version'='null'::jsonb then
   if not exists(select 1 from public.controlled_stock_containers c where c.id=(value->>'id')::uuid
    and c.created_event_id=e.id and c.opening_id is null and c.product_id=e.product_id
    and c.stock_unit=(select stock_unit from public.controlled_stock_policy_versions where id=e.policy_version_id)
    and c.kind=value#>>'{create,kind}'and c.label=value#>>'{create,label}'
    and c.stock_lot_id is not distinct from(value#>>'{create,stock_lot_id}')::uuid
    and c.controlling_site_id=(value#>>'{create,site_id}')::uuid and c.initial_location_id=(value#>>'{create,location_id}')::uuid
    and c.initial_custodian_id is not distinct from(value#>>'{create,custodian_id}')::uuid
    and c.actor_id=e.actor_id and c.session_id=e.session_id)then
    raise exception 'New physical container must preserve its exact reviewed identity and provenance'using errcode='23514';end if;
  elsif frozen_container->'container'is distinct from(select to_jsonb(c)from public.controlled_stock_containers c where c.id=(value->>'id')::uuid)then
   raise exception 'Existing immutable container differs from its original review'using errcode='23514';end if;
  if not exists(select 1 from public.controlled_stock_container_transitions t where t.event_id=e.id and t.container_id=(value->>'id')::uuid
   and t.before_location_id is not distinct from coalesce(frozen_container#>>'{head,location_id}',value#>>'{create,location_id}')::uuid
   and t.before_custodian_id is not distinct from coalesce(frozen_container#>>'{head,custodian_id}',value#>>'{create,custodian_id}')::uuid
   and t.before_status=coalesce(frozen_container#>>'{head,status}','onsite'))then
   raise exception 'Container transition must begin at its exact frozen reviewed state'using errcode='23514';end if;
  if not exists(select 1 from public.controlled_stock_container_transitions t where t.event_id=e.id and t.container_id=(value->>'id')::uuid
   and t.version_before=coalesce((value->>'expected_version')::bigint,0)
   and jsonb_build_object('status',t.after_status,'location_id',t.after_location_id,'custodian_id',t.after_custodian_id)=value->'after')then
   raise exception 'Immutable container transition differs from its reviewed after-state'using errcode='23514';end if;
  for v in select l as line_value from jsonb_array_elements(value->'lines')l loop
   select coalesce(sum(line.quantity_delta),0)into actual from public.controlled_stock_event_lines line
    join public.controlled_stock_cells c on c.id=line.cell_id
    where line.event_id=e.id and c.container_id=(value->>'id')::uuid and c.lot_id=(v.line_value->>'lot_id')::uuid
     and c.channel=v.line_value->>'channel'and c.dispense_id is not distinct from(v.line_value->>'dispense_id')::uuid
     and c.intake_id is not distinct from(v.line_value->>'intake_id')::uuid;
   if actual is distinct from(v.line_value->>'quantity_delta')::numeric then
    raise exception 'Posted container split differs from its immutable reviewed allocation'using errcode='23514';end if;
  end loop;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('container_id',t.container_id,'version',t.version_after,
  'location_id',t.after_location_id,'custodian_id',t.after_custodian_id,'status',t.after_status,'last_event_id',t.event_id)order by t.container_id),'[]'::jsonb)
 into heads from public.controlled_stock_container_transitions t where t.event_id=e.id;
 if a.receipt is distinct from jsonb_build_object('version',1,'id',e.id,'writer',e.writer,'actor_id',e.actor_id,
  'canonical_result',e.canonical_result,'event',to_jsonb(e),'containers',heads)then
  raise exception 'Owned controlled receipt must preserve the original event and head transitions'using errcode='23514';end if;
end $$;

create function public.controlled_stock_validate_product(p_product uuid)returns void
language plpgsql volatile set search_path=public,pg_temp set timezone='UTC' as $$
declare head public.controlled_stock_states;s public.controlled_stock_state_events;opening public.controlled_stock_openings;
 v record;expected numeric;counted bigint;latest bigint;
begin
 select * into head from public.controlled_stock_states where product_id=p_product;
 if head.product_id is null then raise exception 'Ever-managed product must retain its controlled state'using errcode='23514';end if;
 select * into s from public.controlled_stock_state_events where id=head.head_id;
 if s.product_id is distinct from p_product then raise exception 'Controlled state head product mismatch'using errcode='23514';end if;
 select count(*),max(version)into counted,latest from public.controlled_stock_state_events where product_id=p_product;
 if counted<>latest or s.version<>latest or exists(
  select 1 from public.controlled_stock_state_events n left join public.controlled_stock_state_events prior on prior.id=n.prior_event_id
  where n.product_id=p_product and((n.version=1 and(n.state<>'opening_frozen'or n.opening_id is not null))
   or(n.version>1 and(prior.product_id is distinct from p_product or prior.version<>n.version-1 or prior.state='retired'
    or(prior.opening_id is not null and n.opening_id is distinct from prior.opening_id)))))then
  raise exception 'Controlled state must retain its exact initial freeze, ordered history and terminal retirement'using errcode='23514';end if;
 if exists(select 1 from public.controlled_stock_policy_versions policy
  join public.controlled_draft_versions d on d.id=policy.draft_version_id
  join public.controlled_draft_entries entry on entry.id=d.entry_id
  where policy.product_id=p_product and(entry.product_id<>p_product or d.definition->>'product_id'is distinct from p_product::text
   or policy.stock_unit is distinct from d.definition->>'stock_unit'
   or policy.stock_unit is distinct from policy.identity_snapshot->>'unit'))then
  raise exception 'Controlled policy must preserve its exact product classification and stock unit'using errcode='23514';end if;
 select count(*),coalesce(max(sequence),0)into counted,latest from public.controlled_stock_events where product_id=p_product;
 if counted<>latest or latest<>head.event_version
  or(head.last_event_id is not null and not exists(select 1 from public.controlled_stock_events where id=head.last_event_id and product_id=p_product and sequence=latest))then
  raise exception 'Controlled product event sequence projection mismatch'using errcode='23514';end if;
 select * into opening from public.controlled_stock_openings where product_id=p_product;
 if s.opening_id is null then
  if s.state='active'or head.event_version<>0 then raise exception 'An actual opening is required before managed posting'using errcode='23514';end if;
  if opening.id is null then return;end if;
 elsif opening.id is distinct from s.opening_id then
  raise exception 'Exact controlled opening required'using errcode='23514';
 end if;
 -- Persisted openings and current projections are validated even before active
 -- attachment; the immutable boundary uses opening quantities, never latest ones.
 perform public.controlled_stock_validate_opening(opening.id);
 if exists(select 1 from public.controlled_stock_policy_versions policy where policy.product_id=p_product
  and policy.stock_unit is distinct from(select stock_unit from public.controlled_stock_policy_versions where id=opening.policy_version_id))
  or exists(select 1 from public.controlled_stock_containers c where c.product_id=p_product
   and(c.stock_unit is distinct from(select stock_unit from public.controlled_stock_policy_versions where id=opening.policy_version_id)
    or(c.opening_id is not null and c.opening_id<>opening.id)
    or(c.created_event_id is not null and not exists(select 1 from public.controlled_stock_events e where e.id=c.created_event_id and e.product_id=p_product))))then
  raise exception 'Opened controlled stock cannot silently change units or container provenance'using errcode='23514';end if;
 if exists(select 1 from public.inventory_movements m join public.inventory_lots l on l.id=m.lot_id where l.product_id=p_product
  and((select count(*)from public.controlled_stock_opening_movements o where o.movement_id=m.id and o.opening_id=opening.id)
   +(select count(*)from public.controlled_stock_source_links k join public.controlled_stock_events e on e.id=k.event_id
    where k.movement_id=m.id and e.product_id=p_product))<>1)then
  raise exception 'Every movement must belong once to the opening or an exact controlled event'using errcode='23514';end if;
 if exists(select 1 from public.controlled_stock_opening_movements o join public.inventory_movements m on m.id=o.movement_id
  join public.inventory_lots l on l.id=m.lot_id where o.opening_id=opening.id and(o.lot_id<>m.lot_id or o.quantity<>m.quantity
   or l.product_id<>p_product or o.source_snapshot is distinct from to_jsonb(m)))then
  raise exception 'Exact original opening movement membership required'using errcode='23514';end if;
 for v in select c.*,pos.quantity,t.kind,t.stock_lot_id,t.stock_unit,t.product_id from public.controlled_stock_cells c
  join public.controlled_stock_containers t on t.id=c.container_id left join public.controlled_stock_positions pos on pos.cell_id=c.id
  where t.product_id=p_product loop
  select v.opening_quantity+coalesce(sum(l.quantity_delta),0)into expected from public.controlled_stock_event_lines l where l.cell_id=v.id;
  if v.quantity is null or v.quantity<>expected or v.quantity<0
   or not exists(select 1 from public.inventory_lots where id=v.lot_id and product_id=p_product)
   or(v.opening_id is not null and(v.opening_id<>opening.id or not exists(select 1 from public.controlled_stock_containers ct where ct.id=v.container_id and ct.opening_id=v.opening_id)))
   or(v.created_event_id is not null and not exists(select 1 from public.controlled_stock_events e where e.id=v.created_event_id and e.product_id=p_product
    and exists(select 1 from public.controlled_stock_event_lines line where line.cell_id=v.id and line.event_id=e.id)))
   or(v.kind='stock'and(v.channel<>'available'or v.stock_lot_id<>v.lot_id))
   or(v.kind='prepared'and v.channel='available')then
   raise exception 'Exact reconstructible controlled container quantity required'using errcode='23514';end if;
  if v.channel<>'available'and not exists(select 1 from public.native_dispense_allocations a where a.id=v.allocation_id and a.dispense_id=v.dispense_id and a.lot_id=v.lot_id)then
   raise exception 'Physical custody cell requires its actual immutable native allocation'using errcode='23514';end if;
  if v.channel='return_held'and not exists(select 1 from public.native_return_events e where e.id=v.intake_id and e.action='intake'
   and e.dispense_id=v.dispense_id and e.document->>'custody'='clinic_retained')then
   raise exception 'Held controlled cell requires original clinic-retained intake evidence'using errcode='23514';end if;
 end loop;
 for v in select l.id,coalesce(sum(m.quantity),0)balance from public.inventory_lots l left join public.inventory_movements m on m.lot_id=l.id
  where l.product_id=p_product group by l.id loop
  select coalesce(sum(p.quantity),0)into expected from public.controlled_stock_cells c join public.controlled_stock_positions p on p.cell_id=c.id
   join public.controlled_stock_containers t on t.id=c.container_id where t.product_id=p_product and c.lot_id=v.id and c.channel='available';
  if v.balance<>expected then raise exception 'Physical available positions must exactly reconcile to the canonical lot ledger'using errcode='23514';end if;
 end loop;
 if exists(select 1 from public.controlled_stock_container_transitions t
  join public.controlled_stock_containers c on c.id=t.container_id
  left join public.controlled_stock_container_transitions prior on prior.container_id=t.container_id and prior.version_after=t.version_before
  join public.controlled_stock_events e on e.id=t.event_id
  where c.product_id=p_product and(e.product_id<>p_product
   or(t.version_before=0 and(t.before_location_id is distinct from c.initial_location_id
    or t.before_custodian_id is distinct from c.initial_custodian_id or t.before_status<>'onsite'
    or(c.created_event_id is not null and c.created_event_id<>e.id)))
   or(t.version_before>0 and(prior.id is null or t.before_location_id is distinct from prior.after_location_id
    or t.before_custodian_id is distinct from prior.after_custodian_id or t.before_status<>prior.after_status
    or not exists(select 1 from public.controlled_stock_events pe where pe.id=prior.event_id and pe.product_id=p_product and pe.sequence<e.sequence)))))then
  raise exception 'Container transition must preserve its exact predecessor custody and source event'using errcode='23514';end if;
 for v in select c.id,c.initial_location_id,c.initial_custodian_id,c.opening_id,h.version,h.last_event_id,h.location_id,h.custodian_id,h.status
  from public.controlled_stock_containers c left join public.controlled_stock_container_heads h on h.container_id=c.id where c.product_id=p_product loop
  select count(*),coalesce(max(version_after),0)into counted,latest from public.controlled_stock_container_transitions where container_id=v.id;
  if v.version is null or counted<>latest or latest<>v.version then raise exception 'Controlled container transition sequence mismatch'using errcode='23514';end if;
  if latest=0 then
   if v.opening_id is null or v.last_event_id is not null or v.location_id is distinct from v.initial_location_id
    or v.custodian_id is distinct from v.initial_custodian_id or v.status<>'onsite'then
    raise exception 'Opening container head mismatch'using errcode='23514';end if;
  elsif not exists(select 1 from public.controlled_stock_container_transitions t where t.container_id=v.id and t.version_after=latest
   and t.event_id=v.last_event_id and t.after_location_id is not distinct from v.location_id
   and t.after_custodian_id is not distinct from v.custodian_id and t.after_status=v.status)then
   raise exception 'Controlled container head differs from its immutable last transition'using errcode='23514';end if;
  if v.status<>'onsite'and exists(select 1 from public.controlled_stock_cells c join public.controlled_stock_positions p on p.cell_id=c.id where c.container_id=v.id and p.quantity<>0)then
   raise exception 'Released or disposed container cannot retain physical quantity'using errcode='23514';end if;
 end loop;
end $$;
