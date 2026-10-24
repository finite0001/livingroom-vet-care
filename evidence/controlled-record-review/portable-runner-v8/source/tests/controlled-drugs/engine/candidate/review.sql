create function public.controlled_stock_event_kind(p_writer text,p_arguments jsonb)returns text
language plpgsql immutable set search_path=public,pg_temp as $$declare subtype text;begin
 perform public.controlled_stock_writer(p_writer);
 if p_writer in('record_native_dispense_return','record_native_dispense_return_v2','record_native_return_discrepancy')then
  subtype:=p_arguments#>>'{request,intent,action}';
 elsif p_writer='append_native_dispense_correction'then subtype:=p_arguments#>>'{request,kind}';
 else return p_writer;end if;
 if subtype is null or length(subtype)>80 then raise exception 'Explicit controlled source subtype required'using errcode='23514';end if;
 return p_writer||':'||subtype;
end $$;
create function public.controlled_stock_arguments(p_writer text,p_arguments jsonb)returns uuid
language plpgsql volatile set search_path=public,pg_temp as $$
declare product uuid;request jsonb;did uuid;products uuid[];n numeric;stamp date;begin
 perform public.controlled_stock_writer(p_writer);
 if jsonb_typeof(p_arguments)is distinct from 'object'or octet_length(p_arguments::text)>131072 then
  raise exception 'Bounded original controlled arguments required'using errcode='23514';end if;
 if p_writer='receive_inventory'then
  perform public.controlled_stock_keys(p_arguments,array['lot_id','product_id','lot_number','expires_on','location','quantity','reason']);
  perform public.controlled_stock_uuid(p_arguments->'lot_id');product:=public.controlled_stock_uuid(p_arguments->'product_id');
  perform public.controlled_stock_text(p_arguments->'lot_number',200);perform public.controlled_stock_text(p_arguments->'location',200);
  perform public.controlled_stock_text(p_arguments->'reason',2000,true);n:=public.controlled_stock_decimal(p_arguments->'quantity');
  if n<=0 or jsonb_typeof(p_arguments->'expires_on')is distinct from 'string'or p_arguments->>'expires_on'!~'^\d{4}-\d{2}-\d{2}$'then
   raise exception 'Positive exact receipt and finite lot date required'using errcode='23514';end if;
  stamp:=(p_arguments->>'expires_on')::date;
  if not isfinite(stamp)then raise exception 'Finite lot date required'using errcode='23514';end if;
 elsif p_writer='adjust_inventory'then
  perform public.controlled_stock_keys(p_arguments,array['lot_id','quantity','reason']);
  perform public.controlled_stock_decimal(p_arguments->'quantity');perform public.controlled_stock_text(p_arguments->'reason',2000,true);
  select l.product_id into product from public.inventory_lots l where l.id=public.controlled_stock_uuid(p_arguments->'lot_id');
 else
  if p_writer='record_anesthesia_drug_administration'then
   perform public.controlled_stock_keys(p_arguments,array['record_id','pet_id','request']);
   perform public.controlled_stock_uuid(p_arguments->'record_id');perform public.controlled_stock_uuid(p_arguments->'pet_id');
  else perform public.controlled_stock_keys(p_arguments,array['request']);end if;
  request:=p_arguments->'request';
  if jsonb_typeof(request)is distinct from 'object'or octet_length(request::text)>65536 then
   raise exception 'Bounded unchanged canonical request required'using errcode='23514';end if;
  if p_writer in('record_patient_treatment','record_anesthesia_drug_administration')then
   if request->'historical'='true'::jsonb then raise exception 'Managed treatment must identify actual stock'using errcode='23514';end if;
   select l.product_id into product from public.inventory_lots l where l.id=(request->>'lot_id')::uuid;
  elsif p_writer='record_native_dispense'then
   select(public.native_rx_verified_authorization((request->>'authorization_id')::uuid)#>>'{context,draft,fields,product_id}')::uuid into product;
  else
   if p_writer in('record_native_dispense_return','record_native_dispense_return_v2','record_native_return_discrepancy')then
    did:=(request#>>'{intent,target,dispense_id}')::uuid;
   else did:=(request->>'dispense_id')::uuid;end if;
   select array_agg(distinct l.product_id)into products from public.native_dispense_allocations a
    join public.inventory_lots l on l.id=a.lot_id where a.dispense_id=did;
   if cardinality(products)is distinct from 1 then raise exception 'Single original controlled dispense product required'using errcode='23514';end if;
   product:=products[1];
  end if;
 end if;
 if product is null then raise exception 'Exact original controlled product required'using errcode='23514';end if;
 return product;
end $$;
create function public.controlled_stock_permission(
 p_actor uuid,p_writer text,p_arguments jsonb,p_context jsonb
)returns jsonb language plpgsql volatile set search_path=public,pg_temp as $$
declare policy public.controlled_stock_policy_versions;s public.controlled_stock_state_events;opening public.controlled_stock_openings;
 product uuid;kind text;permission jsonb;role_name jsonb;location_kind jsonb;observed timestamptz;
begin
 perform public.controlled_stock_actor(p_actor);
 product:=public.controlled_stock_uuid(p_context->'product_id');
 select * into policy from public.controlled_stock_policy_versions where id=public.controlled_stock_uuid(p_context->'policy_version_id')and product_id=product;
 select e.*into s from public.controlled_stock_states h join public.controlled_stock_state_events e on e.id=h.head_id
  where h.product_id=product and h.head_id=public.controlled_stock_uuid(p_context->'state_head_id');
 select * into opening from public.controlled_stock_openings where id=public.controlled_stock_uuid(p_context->'opening_id')and product_id=product;
 if policy.id is null or s.id is null or opening.id is null or s.state<>'active'
  or s.policy_version_id<>policy.id or s.opening_id<>opening.id
  or policy.stock_unit is distinct from policy.identity_snapshot->>'unit'
  or policy.stock_unit is distinct from(select stock_unit from public.controlled_stock_policy_versions where id=opening.policy_version_id)
  or policy.engine_revision is distinct from(select max(revision)from public.controlled_stock_engine_manifests)
  or policy.identity_snapshot is distinct from public.controlled_stock_identity(product)then
  raise exception 'Current reviewed controlled policy and opening required'using errcode='PT409';end if;
 kind:=public.controlled_stock_event_kind(p_writer,p_arguments);permission:=policy.permissions->kind;
 perform public.controlled_stock_keys(permission,array['enabled','roles','basis','witness','secondary_review','location_kinds']);
 if permission->'enabled'is distinct from 'true'::jsonb or jsonb_typeof(permission->'roles')is distinct from 'array'
  or jsonb_array_length(permission->'roles')not between 1 and 3
  or permission->>'basis'not in('physical_record','correction_assertion','annotation','discrepancy_assertion')
  or permission->>'basis'is distinct from p_context#>>'{basis,kind}'
  or jsonb_typeof(permission->'witness')is distinct from 'string'or permission->>'witness'not in('none','c2_required')
  or jsonb_typeof(permission->'secondary_review')is distinct from 'boolean'
  or jsonb_typeof(permission->'location_kinds')is distinct from 'array'
  or jsonb_array_length(permission->'location_kinds')not between 1 and 2 then
  raise exception 'Explicit reviewed event permissions required'using errcode='42501';end if;
 for role_name in select value from jsonb_array_elements(permission->'roles')loop
  if jsonb_typeof(role_name)is distinct from 'string'or role_name#>>'{}'not in('DVM','ADMIN','STAFF')then
   raise exception 'Explicit staff permission roles required'using errcode='23514';end if;
 end loop;
 if not exists(select 1 from public.user_roles where user_id=p_actor and role::text in(select value from jsonb_array_elements_text(permission->'roles')))then
  raise exception 'Current staff role cannot perform this controlled event'using errcode='42501';end if;
 for location_kind in select value from jsonb_array_elements(permission->'location_kinds')loop
  if jsonb_typeof(location_kind)is distinct from 'string'or location_kind#>>'{}'not in('clinic','mobile_kit')then
   raise exception 'Explicit physical location kinds required'using errcode='23514';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_context->'containers')c
  left join public.controlled_stock_container_heads h on h.container_id=(c->>'id')::uuid
  cross join lateral(values(h.location_id),((c#>>'{after,location_id}')::uuid),((c#>>'{create,location_id}')::uuid))v(id)
  join public.controlled_stock_locations l on l.id=v.id
  where l.kind not in(select value from jsonb_array_elements_text(permission->'location_kinds')))then
  raise exception 'Reviewed event permission does not cover this actual physical location'using errcode='42501';end if;
 if permission->>'witness'<>'none'then
  raise exception 'Actual physical-witness workflow must be completed before this event is available'using errcode='23514';end if;
 if p_context#>>'{basis,kind}'='physical_record'then
  observed:=public.appointment_catalog_instant(p_context#>'{basis,observed_at}');
  if observed<opening.observed_at or observed>clock_timestamp()then
   raise exception 'Actual observation must follow the opening and cannot be in the future'using errcode='23514';end if;
 elsif p_context#>'{basis,observed_at}'is distinct from 'null'::jsonb then
  raise exception 'Annotations and correction assertions cannot invent a physical observation time'using errcode='23514';
 end if;
 if p_writer in('record_native_dispense_return','record_native_dispense_return_v2')and not policy.clinic_retained_return_permitted then
  raise exception 'Reviewed clinic-retained return permission required'using errcode='23514';end if;
 return permission;
end $$;
create function public.controlled_stock_context(p_writer text,p_id uuid,p_arguments jsonb,p_context jsonb)returns void
language plpgsql volatile set search_path=public,pg_temp as $$
declare c jsonb;line jsonb;after_value jsonb;created jsonb;container public.controlled_stock_containers;
 cid uuid;previous uuid;lot uuid;did uuid;iid uuid;location uuid;site uuid;channel text;container_kind text;stock_lot uuid;
 keys text[];seen text[];key text;total integer:=0;delta numeric;position numeric;container_total numeric;
begin
 perform public.controlled_stock_keys(p_context,array['version','product_id','policy_version_id','state_head_id','opening_id','basis','containers']);
 if p_context->'version'is distinct from '1'::jsonb or octet_length(p_context::text)>262144 then
  raise exception 'Bounded version-one controlled context required'using errcode='23514';end if;
 perform public.controlled_stock_uuid(p_context->'product_id');perform public.controlled_stock_uuid(p_context->'policy_version_id');
 perform public.controlled_stock_uuid(p_context->'state_head_id');perform public.controlled_stock_uuid(p_context->'opening_id');
 perform public.controlled_stock_keys(p_context->'basis',array['kind','observed_at','note']);
 perform public.controlled_stock_text(p_context#>'{basis,note}',4000,true);
 if p_context#>>'{basis,kind}'is null or p_context#>>'{basis,kind}'not in('physical_record','correction_assertion','annotation','discrepancy_assertion')then
  raise exception 'Explicit controlled evidence basis required'using errcode='23514';end if;
 if jsonb_typeof(p_context->'containers')is distinct from 'array'or jsonb_array_length(p_context->'containers')>32 then
  raise exception 'Bounded explicit physical container context required'using errcode='23514';end if;
 for c in select value from jsonb_array_elements(p_context->'containers')loop
  perform public.controlled_stock_keys(c,array['id','expected_version','create','after','lines']);
  cid:=public.controlled_stock_uuid(c->'id');
  if previous is not null and cid<=previous then raise exception 'Sorted unique controlled container identities required'using errcode='23514';end if;
  previous:=cid;created:=c->'create';after_value:=c->'after';
  perform public.controlled_stock_keys(after_value,array['status','location_id','custodian_id']);
  if after_value->>'status'is null or after_value->>'status'not in('onsite','handed_off','disposed')then
   raise exception 'Explicit physical custody status required'using errcode='23514';end if;
  if after_value->'custodian_id'<>'null'::jsonb then perform public.controlled_stock_uuid(after_value->'custodian_id');end if;
  if after_value->>'status'='onsite'then location:=public.controlled_stock_uuid(after_value->'location_id');
  elsif after_value->'location_id'is distinct from 'null'::jsonb or after_value->'custodian_id'is distinct from 'null'::jsonb then
   raise exception 'Released container cannot remain located or assigned in the clinic'using errcode='23514';
  else location:=null;end if;
  if c->'expected_version'='null'::jsonb then
   perform public.controlled_stock_keys(created,array['kind','label','stock_lot_id','site_id','location_id','custodian_id']);
   container_kind:=created->>'kind';perform public.controlled_stock_text(created->'label',200);
   site:=public.controlled_stock_uuid(created->'site_id');perform public.controlled_stock_uuid(created->'location_id');
   if created->'custodian_id'<>'null'::jsonb then perform public.controlled_stock_uuid(created->'custodian_id');end if;
   if container_kind='stock'then
    stock_lot:=public.controlled_stock_uuid(created->'stock_lot_id');
    if p_writer<>'receive_inventory'or stock_lot<>public.controlled_stock_uuid(p_arguments->'lot_id')then
     raise exception 'Receiving alone creates a new actual stock container'using errcode='23514';end if;
   elsif container_kind='prepared'and p_writer='record_native_dispense'and created->'stock_lot_id'='null'::jsonb then stock_lot:=null;
   else raise exception 'New prepared container requires its actual native dispense'using errcode='23514';end if;
   if after_value->>'status'<>'onsite'or after_value->'location_id'is distinct from created->'location_id'
    or after_value->'custodian_id'is distinct from created->'custodian_id'
    or exists(select 1 from public.controlled_stock_containers where id=cid)then
    raise exception 'New container identity or initial physical context changed'using errcode='PT409';end if;
  else
   if created is distinct from 'null'::jsonb then raise exception 'Existing container cannot be redefined'using errcode='23514';end if;
   perform public.appointment_catalog_integer(c->'expected_version',0,2147483647);
   select * into container from public.controlled_stock_containers where id=cid;
   if container.id is null or container.product_id<>public.controlled_stock_uuid(p_context->'product_id')then
    raise exception 'Current exact product container required'using errcode='23514';end if;
   if not exists(select 1 from public.controlled_stock_container_heads where container_id=cid and version=(c->>'expected_version')::bigint)
    or container.stock_unit is distinct from(select stock_unit from public.controlled_stock_policy_versions where id=(p_context->>'policy_version_id')::uuid)then
    raise exception 'Current exact container head and stock unit required'using errcode='PT409';end if;
   container_kind:=container.kind;stock_lot:=container.stock_lot_id;site:=container.controlling_site_id;
   if p_writer='receive_inventory'then raise exception 'Receiving must identify new actual containers'using errcode='23514';end if;
   perform public.controlled_stock_transition_allowed(p_writer,p_arguments,cid,after_value);
  end if;
  if location is not null and not exists(select 1 from public.controlled_stock_locations where id=location and site_id=site)then
   raise exception 'Physical location must belong to the actual controlling site'using errcode='23514';end if;
  if not exists(select 1 from public.controlled_stock_policy_sites where policy_version_id=public.controlled_stock_uuid(p_context->'policy_version_id')and site_id=site)then
   raise exception 'Reviewed registered-site policy membership required'using errcode='23514';end if;
  if jsonb_typeof(c->'lines')is distinct from 'array'or jsonb_array_length(c->'lines')>100 then
   raise exception 'Bounded container allocation lines required'using errcode='23514';end if;
  seen:='{}';
  for line in select value from jsonb_array_elements(c->'lines')loop
   total:=total+1;
   perform public.controlled_stock_keys(line,array['lot_id','channel','dispense_id','intake_id','quantity_delta']);
   lot:=public.controlled_stock_uuid(line->'lot_id');delta:=public.controlled_stock_decimal(line->'quantity_delta');
   did:=null;iid:=null;channel:=line->>'channel';
   if line->'dispense_id'<>'null'::jsonb then did:=public.controlled_stock_uuid(line->'dispense_id');end if;
   if line->'intake_id'<>'null'::jsonb then iid:=public.controlled_stock_uuid(line->'intake_id');end if;
   if(channel='available'and container_kind='stock'and lot=stock_lot and did is null and iid is null)
    or(channel='prepared'and container_kind='prepared'and did is not null and iid is null)
    or(channel='return_held'and container_kind='prepared'and did is not null and iid is not null)then null;
   else raise exception 'Exact container lot and custody provenance required'using errcode='23514';end if;
   if p_writer='record_native_dispense'and did is not null and did<>p_id then
    raise exception 'Prepared custody belongs to this actual dispense'using errcode='23514';end if;
   if p_writer='record_native_dispense'and container_kind='prepared'and c->'expected_version'<>'null'::jsonb then
    raise exception 'Native preparation must identify new actual patient packages'using errcode='23514';end if;
   if exists(select 1 from public.inventory_lots l where l.id=lot and l.product_id<>public.controlled_stock_uuid(p_context->'product_id'))
    or(not exists(select 1 from public.inventory_lots l where l.id=lot)
     and not(p_writer='receive_inventory'and lot=(p_arguments->>'lot_id')::uuid))then
    raise exception 'Every physical allocation must use its exact product lot'using errcode='23514';end if;
   key:=jsonb_build_array(lot,channel,did,iid)::text;
   if key=any(seen)then raise exception 'Unique container allocation identity required'using errcode='23514';end if;
   seen:=array_append(seen,key);
   if c->'expected_version'='null'::jsonb and delta<=0 then
    raise exception 'A new physical container cannot supply existing quantity'using errcode='23514';end if;
   select coalesce(sum(p.quantity),0)into position from public.controlled_stock_cells cell
    join public.controlled_stock_positions p on p.cell_id=cell.id where cell.container_id=cid and cell.lot_id=lot and cell.channel=line->>'channel'
     and cell.dispense_id is not distinct from did and cell.intake_id is not distinct from iid;
   if position+delta<0 then raise exception 'Reviewed container cannot supply this exact quantity'using errcode='PT409';end if;
  end loop;
  if after_value->>'status'<>'onsite'then
   select coalesce(sum(p.quantity),0)into container_total from public.controlled_stock_cells cell join public.controlled_stock_positions p on p.cell_id=cell.id where cell.container_id=cid;
   select container_total+coalesce(sum((l->>'quantity_delta')::numeric),0)into container_total from jsonb_array_elements(c->'lines')l;
   if container_total<>0 then raise exception 'A released container cannot retain reviewed physical quantity'using errcode='23514';end if;
  end if;
 end loop;
 if p_writer in('record_patient_treatment','record_anesthesia_drug_administration')
  and public.appointment_catalog_instant(p_context#>'{basis,observed_at}')is distinct from public.appointment_catalog_instant(p_arguments#>'{request,administered_at}')then
  raise exception 'Managed administration must preserve its actual original administration time'using errcode='23514';end if;
 if total>200 then raise exception 'Bounded total controlled allocation lines required'using errcode='23514';end if;
end $$;

create function public.controlled_stock_freeze(p_actor uuid,p_id uuid,p_writer text,p_arguments jsonb,p_context jsonb)returns jsonb
language plpgsql volatile set search_path=public,pg_temp as $$
declare product uuid:=public.controlled_stock_arguments(p_writer,p_arguments);preview jsonb:='null';
 request jsonb:=p_arguments->'request';containers jsonb;lots jsonb;native_kind text;
begin
 if product is distinct from public.controlled_stock_uuid(p_context->'product_id')then
  raise exception 'Controlled product does not match the original canonical arguments'using errcode='23514';end if;
 perform public.controlled_stock_context(p_writer,p_id,p_arguments,p_context);
 if p_writer='record_native_dispense'then
  preview:=public.preview_native_dispense(request-array['expected_context_hash','reason','attest_alert_review','attest_dispense_review']);
 elsif p_writer='record_native_pickup'then preview:=public.preview_native_pickup((request->>'dispense_id')::uuid,(request->>'pet_id')::uuid,request->'refill_close');
 elsif p_writer='append_native_dispense_correction'then preview:=public.preview_native_dispense_correction((request->>'authorization_id')::uuid,(request->>'pet_id')::uuid,(request->>'dispense_id')::uuid);
 elsif p_writer='record_native_dispense_return'then preview:=public.preview_native_dispense_return(request->'intent');
 elsif p_writer='record_native_dispense_return_v2'then preview:=public.preview_native_dispense_return_v2(request->'intent');
 elsif p_writer='record_native_return_discrepancy'then preview:=public.preview_native_return_discrepancy(request->'intent');end if;
 perform public.controlled_stock_actor(p_actor);
 if preview<>'null'::jsonb and(preview->>'context_hash'is distinct from request->>'expected_context_hash'
  or(preview?'allowed'and preview->'allowed'is distinct from 'true'::jsonb))then
  raise exception 'Original canonical review is stale or unavailable'using errcode='PT409';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.value->'id','container',to_jsonb(t),'head',to_jsonb(h),
  'cells',(select coalesce(jsonb_agg(jsonb_build_object('cell',to_jsonb(cell),'position',to_jsonb(pos))order by cell.id),'[]'::jsonb)
   from public.controlled_stock_cells cell join public.controlled_stock_positions pos on pos.cell_id=cell.id where cell.container_id=t.id)
 )order by c.value->>'id'),'[]'::jsonb)into containers from jsonb_array_elements(p_context->'containers')c
 left join public.controlled_stock_containers t on t.id=(c.value->>'id')::uuid
 left join public.controlled_stock_container_heads h on h.container_id=t.id;
 if exists(select 1 from jsonb_array_elements(containers)c where octet_length(c::text)>131072)then
  raise exception 'Bounded exact container snapshot required'using errcode='23514';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',ids.id,'lot',to_jsonb(l),
  'available',(select coalesce(sum(m.quantity),0)::text from public.inventory_movements m where m.lot_id=ids.id),
  'native_hold',public.native_reconciliation_lot_held(ids.id))order by ids.id),'[]'::jsonb)into lots
 from(select distinct(line->>'lot_id')::uuid id from jsonb_array_elements(p_context->'containers')c
  cross join lateral jsonb_array_elements(c->'lines')line)ids left join public.inventory_lots l on l.id=ids.id;
 return jsonb_build_object('catalog',(select to_jsonb(p)from public.catalog_products p where p.id=product),
  'containers',containers,'lots',lots,'native',preview->'context');
end $$;
