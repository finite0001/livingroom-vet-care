-- Attributed reconciliation; original claims, stock movements and financial records remain immutable.
alter table public.native_return_events drop constraint native_return_events_action_check;
alter table public.native_return_events add constraint native_return_events_action_check check(action in('intake','dispose','restock','retract_intake','retract_disposal','retract_restock'));
create table public.native_return_compensation_links (
 id uuid primary key,event_id uuid not null references public.native_return_events(id),target_event_id uuid not null references public.native_return_events(id),allocation_id uuid not null references public.native_dispense_allocations(id),lot_id uuid not null references public.inventory_lots(id),original_movement_id uuid not null references public.inventory_movements(id),movement_id uuid not null unique references public.inventory_movements(id),quantity numeric(14,3) not null check(quantity>0),unique(event_id,allocation_id)
);
create table public.native_return_discrepancy_events (
 id uuid primary key,authorization_id uuid not null references public.native_prescription_authorizations(id),pet_id uuid not null references public.pets(id),dispense_id uuid not null references public.native_dispenses(id),sequence integer not null check(sequence>0),prior_event_id uuid unique references public.native_return_discrepancy_events(id),actor_id uuid not null references public.profiles(id),case_id uuid not null references public.native_return_discrepancy_events(id),action text not null check(action in('report','note','resolve_corrected','resolve_confirmed_original')),created_at timestamptz not null,record_hash text not null,reviewed_context jsonb not null,document jsonb not null,unique(dispense_id,sequence),check((sequence=1)=(prior_event_id is null)),check((action='report')=(id=case_id))
);
create table public.native_return_discrepancy_operations(id uuid primary key references public.native_return_discrepancy_events(id),actor_id uuid not null references public.profiles(id),request jsonb not null,request_hash text not null,result jsonb not null,created_at timestamptz not null);
create table public.native_return_discrepancy_correction_links(case_id uuid not null references public.native_return_discrepancy_events(id),correction_id uuid primary key references public.native_return_events(id),resolution_id uuid not null references public.native_return_discrepancy_events(id));
create index native_return_discrepancy_target on public.native_return_discrepancy_events(dispense_id,sequence);
do $$declare t text;begin
 foreach t in array array['native_return_compensation_links','native_return_discrepancy_events','native_return_discrepancy_operations','native_return_discrepancy_correction_links'] loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger immutable before update or delete on public.%I for each row execute function public.native_correction_immutable()',t);
  execute format('create trigger no_truncate before truncate on public.%I for each statement execute function public.native_correction_immutable()',t);
  execute format('create trigger native_return_audit after insert on public.%I for each row execute function public.native_rx_audit()',t);
 end loop;
end $$;
alter table public.inventory_movements drop constraint inventory_movements_kind_check;
alter table public.inventory_movements add constraint inventory_movements_kind_check check(kind in('receive','adjust','dispense','native_return','native_return_compensation'));
alter table public.inventory_movements add constraint native_return_compensation_negative check(kind<>'native_return_compensation' or quantity<0);

create function public.native_reconciliation_quantity_output(p_originals jsonb,sources jsonb,totals jsonb,histories jsonb,intakes jsonb,ordinary jsonb,intake_order text[],ordinary_order text[]) returns jsonb language plpgsql immutable security definer set search_path=public as $$
declare s jsonb;t jsonb;h jsonb;c jsonb;aid text;root text;eid text;rows jsonb;allocations jsonb:='[]';intake_result jsonb:='[]';correction_result jsonb:='[]';history_result jsonb:='[]';begin
 for s in select value from jsonb_array_elements(p_originals) loop
  aid:=s->>'allocation_id';t:=totals->aid;h:=histories->aid;
  allocations:=allocations||jsonb_build_array(jsonb_build_object('allocation_id',aid,'lot_id',s->'lot_id','dispensed_quantity',s->'quantity','returned_quantity',round((t->>'received')::numeric,3)::text,'remaining_returnable_quantity',round((s->>'quantity')::numeric-(t->>'received')::numeric,3)::text,'held_quantity',round((t->>'held')::numeric,3)::text,'disposed_quantity',round((t->>'disposed')::numeric,3)::text,'restocked_quantity',round((t->>'restocked')::numeric,3)::text));
  history_result:=history_result||jsonb_build_array(jsonb_build_object('allocation_id',aid,'lot_id',s->'lot_id','gross_intake_quantity',round((h->>'intake')::numeric,3)::text,'gross_disposed_quantity',round((h->>'disposed')::numeric,3)::text,'gross_restocked_quantity',round((h->>'restocked')::numeric,3)::text,'retracted_intake_quantity',round((h->>'retractIntake')::numeric,3)::text,'retracted_disposed_quantity',round((h->>'retractDisposed')::numeric,3)::text,'retracted_restocked_quantity',round((h->>'retractRestocked')::numeric,3)::text));
 end loop;
 foreach root in array intake_order loop
  rows:='[]';
  for aid,c in select entry.key,entry.value from jsonb_each(intakes->root) entry order by entry.key collate "C" loop
   rows:=rows||jsonb_build_array(jsonb_build_object('allocation_id',aid,'lot_id',sources#>array[aid,'lot_id'],'quantity',round((c->>'received')::numeric,3)::text,'held_quantity',round((c->>'held')::numeric,3)::text,'disposed_quantity',round((c->>'disposed')::numeric,3)::text,'restocked_quantity',round((c->>'restocked')::numeric,3)::text));
  end loop;
  intake_result:=intake_result||jsonb_build_array(jsonb_build_object('id',root,'allocations',rows));
 end loop;
 foreach eid in array ordinary_order loop
  select jsonb_agg(jsonb_build_object('allocation_id',entry.key,'quantity',round(entry.value::text::numeric,3)::text) order by entry.key collate "C") into rows from jsonb_each(ordinary#>array[eid,'remaining']) entry;
  correction_result:=correction_result||jsonb_build_array(jsonb_build_object('event_id',eid,'allocations',rows));
 end loop;
 return jsonb_build_object('allocations',allocations,'intakes',intake_result,'correction_remaining',correction_result,'historical',history_result);
end;$$;

create function public.native_reconciliation_quantity_prefixes(p_originals jsonb,p_events jsonb) returns jsonb
language plpgsql immutable security definer set search_path=public as $$
declare prefixes jsonb:='[]'; sources jsonb:='{}'; totals jsonb:='{}'; histories jsonb:='{}'; intakes jsonb:='{}'; ordinary jsonb:='{}';
 intake_order text[]:='{}'; ordinary_order text[]:='{}'; seen jsonb:='{}';
 e jsonb;a jsonb;s jsonb;t jsonb;c jsonb;h jsonb;target jsonb; b jsonb; n numeric; remaining numeric; seq integer:=0;
 aid text;eid text;root text;act text;expected text;key text;k text;target_id text;
 allocations jsonb:='[]'; intake_result jsonb:='[]'; correction_result jsonb:='[]'; history_result jsonb:='[]'; rows jsonb;
begin
 perform public.native_return_quantity_allocations(p_originals);
 if jsonb_typeof(p_events) is distinct from 'array' then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
 for a in select value from jsonb_array_elements(p_originals) loop
  aid:=a->>'allocation_id';sources:=sources||jsonb_build_object(aid,a);
  totals:=totals||jsonb_build_object(aid,jsonb_build_object('received',0.000,'held',0.000,'disposed',0.000,'restocked',0.000));
  histories:=histories||jsonb_build_object(aid,jsonb_build_object('intake',0.000,'disposed',0.000,'restocked',0.000,'retractIntake',0.000,'retractDisposed',0.000,'retractRestocked',0.000));
 end loop;
 for e in select value from jsonb_array_elements(p_events) loop
  prefixes:=prefixes||jsonb_build_array(public.native_reconciliation_quantity_output(p_originals,sources,totals,histories,intakes,ordinary,intake_order,ordinary_order));
  seq:=seq+1;
  if jsonb_typeof(e) is distinct from 'object' then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
  if (select array_agg(keys.k order by keys.k) from jsonb_object_keys(e) as keys(k)) is distinct from array['action','allocations','correction_target_id','id','intake_id','sequence']::text[]
   or jsonb_typeof(e->'id') is distinct from 'string' or (e->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or seen ? (e->>'id') or e->'sequence' is distinct from to_jsonb(seq)
   or jsonb_typeof(e->'action') is distinct from 'string' or (e->>'action') not in('intake','dispose','restock','retract_intake','retract_disposal','retract_restock')
  then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
  perform public.native_return_quantity_allocations(e->'allocations');
  eid:=e->>'id';act:=e->>'action';target:=null;target_id:=null;
  if act like 'retract_%' then
   if jsonb_typeof(e->'correction_target_id') is distinct from 'string' or jsonb_typeof(e->'intake_id') is distinct from 'string'
    or (e->>'correction_target_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (e->>'intake_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
   target_id:=e->>'correction_target_id';target:=ordinary->target_id;
   expected:=case act when 'retract_intake' then 'intake' when 'retract_disposal' then 'dispose' else 'restock' end;
   if target is null or target#>>'{event,action}' is distinct from expected then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
   root:=case when expected='intake' then target#>>'{event,id}' else target#>>'{event,intake_id}' end;
   if e->>'intake_id' is distinct from root then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
  else
   if e->'correction_target_id' is distinct from 'null'::jsonb then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
   if act='intake' then
    if e->'intake_id' is distinct from 'null'::jsonb then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
    root:=eid;intakes:=intakes||jsonb_build_object(root,'{}'::jsonb);intake_order:=array_append(intake_order,root);
   else
    if jsonb_typeof(e->'intake_id') is distinct from 'string' or (e->>'intake_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
    root:=e->>'intake_id';
   end if;
  end if;
  if not intakes ? root then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
  for a in select value from jsonb_array_elements(e->'allocations') loop
   aid:=a->>'allocation_id';s:=sources->aid;n:=(a->>'quantity')::numeric;t:=totals->aid;h:=histories->aid;
   if s is null or s->'lot_id' is distinct from a->'lot_id' then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
   c:=intakes#>array[root,aid];
   if act='intake' then c:=jsonb_build_object('received',0.000,'held',0.000,'disposed',0.000,'restocked',0.000);end if;
   if c is null then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
   if target is not null then
    remaining:=(target#>>array['remaining',aid])::numeric;
    if remaining is null or remaining<n then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
    target:=jsonb_set(target,array['remaining',aid],to_jsonb(remaining-n));
   end if;
   if act='intake' and (t->>'received')::numeric+n>(s->>'quantity')::numeric
    or act in('dispose','restock','retract_intake') and (c->>'held')::numeric<n
    or act='retract_disposal' and (c->>'disposed')::numeric<n
    or act='retract_restock' and (c->>'restocked')::numeric<n
   then raise exception 'Invalid native return quantity history' using errcode='23514';end if;
   -- Apply identical deltas to the allocation total and its owning intake.
   foreach k in array array['total','current'] loop
    b:=case k when 'total' then t else c end;
    if act in('intake','retract_intake') then
     remaining:=case act when 'intake' then n else -n end;
     b:=jsonb_set(jsonb_set(b,'{received}',to_jsonb((b->>'received')::numeric+remaining)),'{held}',to_jsonb((b->>'held')::numeric+remaining));
    else
     key:=case when act in('dispose','retract_disposal') then 'disposed' else 'restocked' end;
     remaining:=case when act in('dispose','restock') then n else -n end;
     b:=jsonb_set(jsonb_set(b,array[key],to_jsonb((b->>key)::numeric+remaining)),'{held}',to_jsonb((b->>'held')::numeric-remaining));
    end if;
    if k='total' then t:=b;else c:=b;end if;
   end loop;
   key:=case act when 'intake' then 'intake' when 'dispose' then 'disposed' when 'restock' then 'restocked' when 'retract_intake' then 'retractIntake' when 'retract_disposal' then 'retractDisposed' else 'retractRestocked' end;
   h:=jsonb_set(h,array[key],to_jsonb((h->>key)::numeric+n));
   totals:=jsonb_set(totals,array[aid],t);histories:=jsonb_set(histories,array[aid],h);intakes:=jsonb_set(intakes,array[root,aid],c);
  end loop;
  if target is not null then ordinary:=jsonb_set(ordinary,array[target_id],target);
  else
   select jsonb_object_agg(value->>'allocation_id',(value->>'quantity')::numeric) into b from jsonb_array_elements(e->'allocations');
   ordinary:=ordinary||jsonb_build_object(eid,jsonb_build_object('event',e,'remaining',b));ordinary_order:=array_append(ordinary_order,eid);
  end if;
  seen:=seen||jsonb_build_object(eid,true);
 end loop;
 return prefixes||jsonb_build_array(public.native_reconciliation_quantity_output(p_originals,sources,totals,histories,intakes,ordinary,intake_order,ordinary_order));
end;$$;
create function public.native_reconciliation_balances(p_replay jsonb) returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(x.value||jsonb_build_object('lot_number',l.lot_number,'expires_on',l.expires_on) order by x.value->>'allocation_id'),'[]'::jsonb) from jsonb_array_elements(p_replay->'allocations')x join public.inventory_lots l on l.id=(x.value->>'lot_id')::uuid;
$$;
create function public.native_reconciliation_intake(p_replay jsonb,p_intake_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select x.value||jsonb_build_object('sequence',e.sequence,'custody',e.document->'custody','package_condition',e.document->'package_condition','storage_history',e.document->'storage_history') from jsonb_array_elements(p_replay->'intakes')x join public.native_return_events e on e.id=(x.value->>'id')::uuid where e.id=p_intake_id;
$$;
create function public.native_reconciliation_affected(p_dispense_id uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.native_return_events where dispense_id=p_dispense_id and document->'version'='2'::jsonb) or exists(select 1 from public.native_return_discrepancy_events where dispense_id=p_dispense_id)$$;
create function public.native_reconciliation_discrepancies(p_dispense_id uuid,p_through integer default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare item jsonb;input_item jsonb;prior_allocation text; e public.native_return_discrepancy_events;o public.native_return_discrepancy_operations;d jsonb;c jsonb;cases jsonb:='{}';ordered text[]:='{}';case_row jsonb;rows jsonb:='[]';lots jsonb;open_count integer:=0;head jsonb:=jsonb_build_object('event_id',null,'version',0,'record_hash',null);previous timestamptz;key text;s public.native_return_events;
begin
 for e in select * from public.native_return_discrepancy_events where dispense_id=p_dispense_id and(p_through is null or sequence<=p_through) order by sequence loop
  d:=e.document;c:=e.reviewed_context;select * into o from public.native_return_discrepancy_operations where id=e.id;select * into s from public.native_return_events where id=(d#>>'{source,event_id}')::uuid;
  perform public.native_rx_keys(d,array['version','id','target','sequence','prior_event_id','prior_record_hash','actor','action','case_id','source','allocations','observation','correction_ids','return_head','reviewed_context_hash','created_at','record_hash']);
  perform public.native_rx_keys(c,array['version','target','return_head','discrepancy_head','source','replay','discrepancies','intent']);
  perform public.native_rx_keys(o.request,array['intent','expected_context_hash','expected_return_head','expected_discrepancy_head','attest_physical_review','attest_original_quantities_custody_and_stock_accurate']);
  perform public.native_rx_keys(d->'actor',array['id','name','authority']);perform public.native_rx_text(d#>'{actor,name}',200);
  if d->'source' is distinct from o.request#>'{intent,source}' or d->'observation' is distinct from o.request#>'{intent,observation}' or d->'action' is distinct from o.request#>'{intent,action}' or d->'correction_ids' is distinct from o.request#>'{intent,correction_ids}' or d->'target' is distinct from o.request#>'{intent,target}'
   or c->'version' is distinct from '1'::jsonb or c->'target' is distinct from d->'target' or c->'source' is distinct from s.document
   or o.request->'attest_original_quantities_custody_and_stock_accurate' is distinct from to_jsonb(e.action='resolve_confirmed_original')
   or jsonb_array_length(d->'allocations')<>jsonb_array_length(o.request#>'{intent,allocations}') then raise exception 'Discrepancy request evidence mismatch' using errcode='23514';end if;
  prior_allocation:='';
  for item in select value from jsonb_array_elements(d->'allocations') loop
   perform public.native_rx_keys(item,array['allocation_id','lot_id','quantity']);
   if (item->>'allocation_id') collate "C"<=prior_allocation collate "C" or not exists(select 1 from jsonb_array_elements(s.document->'allocations')src where src->'allocation_id'=item->'allocation_id' and src->'lot_id'=item->'lot_id' and (src->>'quantity')::numeric>=public.native_fulfillment_quantity(item->'quantity')) or not exists(select 1 from jsonb_array_elements(o.request#>'{intent,allocations}')inp where inp->'allocation_id'=item->'allocation_id' and public.native_fulfillment_quantity(inp->'quantity')=(item->>'quantity')::numeric) then raise exception 'Discrepancy allocation evidence mismatch' using errcode='23514';end if;
   prior_allocation:=item->>'allocation_id';
  end loop;
  if d->'version' is distinct from '1'::jsonb or d->>'id' is distinct from e.id::text or d->>'action' is distinct from e.action or d->>'case_id' is distinct from e.case_id::text
   or d->'target' is distinct from jsonb_build_object('authorization_id',e.authorization_id,'pet_id',e.pet_id,'dispense_id',e.dispense_id)
   or e.sequence<>(head->>'version')::integer+1 or d->'sequence' is distinct from to_jsonb(e.sequence) or d->'prior_event_id' is distinct from head->'event_id' or d->'prior_record_hash' is distinct from head->'record_hash' or e.prior_event_id::text is distinct from head->>'event_id'
   or d#>>'{actor,id}' is distinct from e.actor_id::text or d->>'record_hash' is distinct from e.record_hash or public.native_fulfillment_hash(d-'record_hash') is distinct from e.record_hash or d->>'reviewed_context_hash' is distinct from public.native_fulfillment_hash(c)
   or (d->>'created_at')::timestamptz is distinct from e.created_at or e.created_at<previous or o.id is null or o.result is distinct from d or o.actor_id<>e.actor_id or o.created_at is distinct from e.created_at
   or o.request_hash is distinct from public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',o.actor_id,'operation','record_native_return_discrepancy','request',o.request))
   or o.request->>'expected_context_hash' is distinct from d->>'reviewed_context_hash' or o.request->'expected_discrepancy_head' is distinct from head or o.request->'expected_return_head' is distinct from d->'return_head'
   or c->'discrepancy_head' is distinct from head or c->'return_head' is distinct from d->'return_head' or c->'intent' is distinct from o.request->'intent'
   or s.id is null or s.dispense_id<>p_dispense_id or s.authorization_id<>e.authorization_id or s.pet_id<>e.pet_id or s.record_hash is distinct from d#>>'{source,record_hash}' or s.action not in('intake','dispose','restock') or s.created_at>e.created_at
   or o.request->'attest_physical_review' is distinct from 'true'::jsonb
  then raise exception 'Return discrepancy evidence mismatch' using errcode='23514';end if;
  if not exists(select 1 from public.native_return_events r where r.dispense_id=p_dispense_id and r.id::text=d#>>'{return_head,event_id}' and r.sequence=(d#>>'{return_head,version}')::integer and r.record_hash=d#>>'{return_head,record_hash}' and r.created_at<=e.created_at) then raise exception 'Discrepancy return head mismatch' using errcode='23514';end if;
  if e.action='report' then
   if cases ? e.case_id::text or d#>>'{actor,authority}' not in('active_staff','active_dvm') then raise exception 'Discrepancy report identity mismatch' using errcode='23514';end if;
   case_row:=jsonb_build_object('id',e.id,'source',d->'source','allocations',d->'allocations','status','open','report',d,'decisions','[]'::jsonb);ordered:=array_append(ordered,e.id::text);
  else
   case_row:=cases->e.case_id::text;
   if case_row is null or case_row->>'status'<>'open' or case_row->'source' is distinct from d->'source' or case_row->'allocations' is distinct from d->'allocations' then raise exception 'Discrepancy case mismatch' using errcode='23514';end if;
   if e.action like 'resolve_%' then
    if d#>>'{actor,authority}'<>'active_dvm' then raise exception 'DVM discrepancy resolution required' using errcode='23514';end if;
    if e.action='resolve_confirmed_original' and(o.request->'attest_original_quantities_custody_and_stock_accurate' is distinct from 'true'::jsonb or exists(select 1 from public.native_return_events cr where cr.document->>'discrepancy_id'=e.case_id::text and cr.sequence<=(d#>>'{return_head,version}')::integer)) then raise exception 'Original facts require explicit confirmation' using errcode='23514';end if;
    if e.action='resolve_corrected' then
     if jsonb_array_length(d->'correction_ids')=0 or exists(select 1 from jsonb_array_elements_text(d->'correction_ids')ids where not exists(select 1 from public.native_return_discrepancy_correction_links l join public.native_return_events r on r.id=l.correction_id where l.case_id=e.case_id and l.resolution_id=e.id and r.id::text=ids and r.document#>'{correction_target}'=d->'source' and r.document->>'discrepancy_id'=e.case_id::text and r.dispense_id=p_dispense_id and r.created_at<=e.created_at)) then raise exception 'Discrepancy compensation links missing' using errcode='23514';end if;
     if exists(select 1 from jsonb_array_elements(d->'allocations')a where (a->>'quantity')::numeric is distinct from (select sum((x->>'quantity')::numeric) from public.native_return_discrepancy_correction_links l join public.native_return_events r on r.id=l.correction_id cross join lateral jsonb_array_elements(r.document->'allocations')x where l.resolution_id=e.id and x->>'allocation_id'=a->>'allocation_id')) then raise exception 'Discrepancy compensation quantity mismatch' using errcode='23514';end if;
    elsif d->'correction_ids' is distinct from '[]'::jsonb then raise exception 'Unexpected discrepancy compensation links' using errcode='23514';end if;
    case_row:=jsonb_set(case_row,'{status}',to_jsonb(case e.action when 'resolve_corrected' then 'resolved_corrected' else 'resolved_confirmed_original' end));
   end if;
   case_row:=jsonb_set(case_row,'{decisions}',case_row->'decisions'||jsonb_build_array(d));
  end if;
  cases:=jsonb_set(cases,array[e.case_id::text],case_row);head:=jsonb_build_object('event_id',e.id,'version',e.sequence,'record_hash',e.record_hash);previous:=e.created_at;
 end loop;
 if p_through is not null and (head->>'version')::integer<>p_through then raise exception 'Exact discrepancy prefix unavailable' using errcode='23514';end if;
 foreach key in array ordered loop rows:=rows||jsonb_build_array(cases->key);if cases#>>array[key,'status']='open' then open_count:=open_count+1;end if;end loop;
 select coalesce(jsonb_agg(lot_id order by lot_id),'[]'::jsonb) into lots from(select distinct a->>'lot_id' lot_id from jsonb_array_elements(rows)c cross join lateral jsonb_array_elements(c->'allocations')a where c->>'status'='open')q;
 return jsonb_build_object('version',1,'head',head,'open_case_count',open_count,'held_lot_ids',lots,'cases',rows);
end $$;
create function public.native_reconciliation_lot_held(p_lot_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.native_return_discrepancy_events r cross join lateral jsonb_array_elements(r.document->'allocations')a where r.action='report' and a->>'lot_id'=p_lot_id::text and not exists(select 1 from public.native_return_discrepancy_events s where s.case_id=r.id and s.action in('resolve_corrected','resolve_confirmed_original')));
$$;
-- This guard is reached after the existing stock writer owns its lot lock. Receiving
-- remains permitted, but the hold continues to cover the entire affected lot.
do $$declare d text;needle text:='return NEW;';begin
 select pg_get_functiondef('public.inventory_guard()'::regprocedure) into d;
 -- Use dollar-quoted literals so the exact saved definition is not ambiguous.
 d:=replace(d,$n$to_jsonb(NEW)->>'kind'='native_return'$n$,$n$to_jsonb(NEW)->>'kind' in('native_return','native_return_compensation')$n$);
 if position(needle in d)=0 then raise exception 'Inventory hold boundary missing';end if;
 d:=replace(d,needle,$n$if TG_TABLE_NAME='inventory_movements' and TG_OP='INSERT' and to_jsonb(NEW)->>'kind' in('dispense','adjust','native_return') and public.native_reconciliation_lot_held((to_jsonb(NEW)->>'lot_id')::uuid) then raise exception 'Lot is held for physical return discrepancy review' using errcode='23514';end if;return NEW;$n$);execute d;
end $$;
create function public.native_reconciliation_compensation_link() returns trigger language plpgsql security definer set search_path=public as $$
declare movement public.inventory_movements;l public.native_return_compensation_links;e public.native_return_events;s public.native_return_stock_links;begin
 if TG_TABLE_NAME='native_return_compensation_links' then select * into movement from public.inventory_movements where id=NEW.movement_id;else movement:=NEW;end if;
 if movement.kind is distinct from 'native_return_compensation' then if TG_TABLE_NAME='native_return_compensation_links' then raise exception 'Compensation link requires negative movement' using errcode='23514';end if;return NEW;end if;
 select * into l from public.native_return_compensation_links where movement_id=movement.id;select * into e from public.native_return_events where id=l.event_id;select * into s from public.native_return_stock_links where event_id=l.target_event_id and allocation_id=l.allocation_id;
 if l.id is null or e.action is distinct from 'retract_restock' or s.id is null or s.movement_id<>l.original_movement_id or s.lot_id<>l.lot_id or l.lot_id<>movement.lot_id or movement.quantity<>-l.quantity or movement.created_by<>e.actor_id or movement.created_at is distinct from e.created_at or e.document#>>'{correction_target,event_id}' is distinct from l.target_event_id::text
 or not exists(select 1 from jsonb_array_elements(e.document->'allocations')a where a->>'allocation_id'=l.allocation_id::text and a->>'lot_id'=l.lot_id::text and a->>'movement_id'=movement.id::text and (a->>'quantity')::numeric=l.quantity)
 then raise exception 'Return negative compensation linkage mismatch' using errcode='23514';end if;return NEW;
end $$;
create constraint trigger native_return_compensation_required after insert on public.inventory_movements deferrable initially deferred for each row execute function public.native_reconciliation_compensation_link();
create constraint trigger native_return_compensation_link_required after insert on public.native_return_compensation_links deferrable initially deferred for each row execute function public.native_reconciliation_compensation_link();
create function public.native_reconciliation_validate_intent(v jsonb) returns void language plpgsql immutable security definer set search_path=public as $$
declare base jsonb;begin
 perform public.native_rx_keys(v,array['target','action','intake_id','correction_target','discrepancy_id','allocations','custody','package_condition','storage_history','reason','note']);
 if v->>'action' in('intake','dispose','restock') then
  if v->'correction_target' is distinct from 'null'::jsonb or v->'discrepancy_id' is distinct from 'null'::jsonb then raise exception 'Ordinary returns cannot target corrections' using errcode='23514';end if;
  perform public.native_return_validate_intent(v-'correction_target'-'discrepancy_id');
 elsif v->>'action' in('retract_intake','retract_disposal','retract_restock') then
  base:=(v-'correction_target'-'discrepancy_id')||jsonb_build_object('action','dispose');perform public.native_return_validate_intent(base);
  perform public.native_rx_keys(v->'correction_target',array['event_id','record_hash']);
  if jsonb_typeof(v#>'{correction_target,event_id}') is distinct from 'string' or v#>>'{correction_target,event_id}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(v#>'{correction_target,record_hash}') is distinct from 'string' or v#>>'{correction_target,record_hash}' !~ '^[0-9a-f]{64}$'
   or (v->'discrepancy_id'<>'null'::jsonb and(jsonb_typeof(v->'discrepancy_id') is distinct from 'string' or v->>'discrepancy_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then raise exception 'Exact correction source required' using errcode='23514';end if;
 else raise exception 'Unknown reconciliation action' using errcode='23514';end if;
end $$;
create function public.native_reconciliation_attestations(p_action text) returns jsonb language sql immutable security definer set search_path=public as $$select jsonb_build_object('reviewed_physical_facts',true,'intake_claim_incorrect',p_action='retract_intake','remains_physically_held',p_action in('retract_disposal','retract_restock'),'was_not_destroyed',p_action='retract_disposal','removed_from_available_stock',p_action='retract_restock')$$;
create function public.native_reconciliation_event_verified(e public.native_return_events,p_prior jsonb,p_head jsonb,p_dispense jsonb,p_corrections jsonb) returns void language plpgsql stable security definer set search_path=public as $$
declare v jsonb:=e.document;c jsonb:=e.reviewed_context;o public.native_return_operations;intent jsonb;ds jsonb;i jsonb;x jsonb;l public.native_return_compensation_links;sl public.native_return_stock_links;m public.inventory_movements;source public.native_return_events;root uuid;expected text;begin
 select * into o from public.native_return_operations where id=e.id;intent:=o.request->'intent';perform public.native_reconciliation_validate_intent(intent);
 perform public.native_rx_keys(v,array['version','id','target','authorization_hash','dispense_document_hash','sequence','prior_event_id','prior_record_hash','actor','action','intake_id','allocations','custody','package_condition','storage_history','reason','note','policy','correction_target','discrepancy_id','physical_attestations','reviewed_context_hash','created_at','record_hash']);
 perform public.native_rx_keys(c,array['version','target','authorization_hash','dispense_document_hash','dispensed_at','head','discrepancy_head','original_pickup','correction_head','allocations','intake','replay','discrepancies','stock_review','policy','intent']);
 ds:=public.native_reconciliation_discrepancies(e.dispense_id,(c#>>'{discrepancy_head,version}')::integer);i:=public.native_reconciliation_intake(p_prior,e.intake_id);
 if o.id is null or o.actor_id<>e.actor_id or o.result is distinct from v or o.created_at is distinct from e.created_at
  or o.request_hash is distinct from public.native_fulfillment_hash(jsonb_build_object('version',2,'actor_id',e.actor_id,'operation','record_native_dispense_return_v2','request',o.request))
  or e.authorization_id::text is distinct from p_dispense->>'authorization_id' or e.pet_id::text is distinct from p_dispense->>'pet_id'
  or v->'version' is distinct from '2'::jsonb or v->>'id' is distinct from e.id::text or v->>'action' is distinct from e.action or v->>'intake_id' is distinct from e.intake_id::text or v->'sequence' is distinct from to_jsonb(e.sequence)
  or v->'target' is distinct from jsonb_build_object('authorization_id',e.authorization_id,'pet_id',e.pet_id,'dispense_id',e.dispense_id)
  or v->>'record_hash' is distinct from e.record_hash or e.record_hash is distinct from public.native_fulfillment_hash(v-'record_hash') or v->'prior_event_id' is distinct from p_head->'event_id' or v->'prior_record_hash' is distinct from p_head->'record_hash'
  or v#>>'{actor,id}' is distinct from e.actor_id::text or v#>>'{actor,authority}' is distinct from (case when e.action in('intake','dispose') then 'active_staff' else 'active_dvm' end)
  or v->>'authorization_hash' is distinct from p_dispense->>'authorization_hash' or v->>'dispense_document_hash' is distinct from public.native_fulfillment_hash(p_dispense) or (v->>'created_at')::timestamptz is distinct from e.created_at
  or v->>'reviewed_context_hash' is distinct from public.native_fulfillment_hash(c) or o.request->>'expected_context_hash' is distinct from v->>'reviewed_context_hash' or o.request->'expected_head' is distinct from p_head or o.request->'expected_discrepancy_head' is distinct from ds->'head'
  or exists(select 1 from public.native_return_discrepancy_events de where de.dispense_id=e.dispense_id and de.sequence<=(c#>>'{discrepancy_head,version}')::integer and de.created_at>e.created_at)
  or o.request->'attest_review' is distinct from 'true'::jsonb or o.request->'attest_restock' is distinct from to_jsonb(e.action='restock') or o.request->'physical_attestations' is distinct from public.native_reconciliation_attestations(e.action) or v->'physical_attestations' is distinct from o.request->'physical_attestations'
  or c->'version' is distinct from '2'::jsonb or c->'target' is distinct from v->'target' or c->'head' is distinct from p_head or c->'replay' is distinct from p_prior or c->'allocations' is distinct from public.native_reconciliation_balances(p_prior) or c->'intake' is distinct from coalesce(i,'null'::jsonb) or c->'discrepancies' is distinct from ds or c->'intent' is distinct from intent
  or c->'authorization_hash' is distinct from v->'authorization_hash' or c->'dispense_document_hash' is distinct from v->'dispense_document_hash' or c->'dispensed_at' is distinct from p_dispense->'dispensed_at'
  or c->'original_pickup' is distinct from coalesce(public.native_correction_pickup(e.dispense_id),'null'::jsonb)
  or v->'correction_target' is distinct from intent->'correction_target' or v->'discrepancy_id' is distinct from intent->'discrepancy_id' or v->'reason' is distinct from intent->'reason' or v->'note' is distinct from intent->'note' or v->'custody' is distinct from intent->'custody' or v->'package_condition' is distinct from intent->'package_condition' or v->'storage_history' is distinct from intent->'storage_history'
 then raise exception 'Reconciliation event evidence mismatch' using errcode='23514';end if;
 if c#>>'{correction_head,version}'='0' then
  if c->'correction_head' is distinct from jsonb_build_object('event_id',null,'version',0,'record_hash',null) then raise exception 'Dispense clarification head mismatch' using errcode='23514';end if;
 elsif not exists(select 1 from jsonb_array_elements(p_corrections->'events')q where q->>'id'=c#>>'{correction_head,event_id}' and q->'sequence'=c#>'{correction_head,version}' and q->>'record_hash'=c#>>'{correction_head,record_hash}') then raise exception 'Dispense clarification head missing' using errcode='23514';end if;
 if e.action like 'retract_%' then
  select * into source from public.native_return_events where id=(v#>>'{correction_target,event_id}')::uuid;
  expected:=case e.action when 'retract_intake' then 'intake' when 'retract_disposal' then 'dispose' else 'restock' end;root:=case when expected='intake' then source.id else source.intake_id end;
  if source.id is null or source.action<>expected or source.dispense_id<>e.dispense_id or source.sequence>=e.sequence or source.record_hash is distinct from v#>>'{correction_target,record_hash}' or root is distinct from e.intake_id then raise exception 'Reconciliation source mismatch' using errcode='23514';end if;
  if v->'discrepancy_id'<>'null'::jsonb and not exists(select 1 from jsonb_array_elements(ds->'cases')q where q->>'id'=v->>'discrepancy_id' and q->>'status'='open' and q->'source'=v->'correction_target') then raise exception 'Correction discrepancy mismatch' using errcode='23514';end if;
 end if;
 if jsonb_array_length(v->'allocations')<>jsonb_array_length(intent->'allocations') then raise exception 'Reconciliation allocation mismatch' using errcode='23514';end if;
 for x in select value from jsonb_array_elements(v->'allocations') loop
  perform public.native_rx_keys(x,array['allocation_id','lot_id','quantity','movement_id']);
  if not exists(select 1 from jsonb_array_elements(intent->'allocations')q where q->>'allocation_id'=x->>'allocation_id' and public.native_fulfillment_quantity(q->'quantity')=(x->>'quantity')::numeric) then raise exception 'Reconciliation quantity mismatch' using errcode='23514';end if;
  if e.action='retract_restock' then
   select * into l from public.native_return_compensation_links where event_id=e.id and allocation_id=(x->>'allocation_id')::uuid;select * into m from public.inventory_movements where id=l.movement_id;select * into sl from public.native_return_stock_links where event_id=source.id and allocation_id=l.allocation_id;
   if l.id is null or m.id is null or sl.id is null or l.target_event_id<>source.id or l.original_movement_id<>sl.movement_id or l.lot_id<>sl.lot_id or m.kind<>'native_return_compensation' or m.quantity<>-l.quantity or m.lot_id<>l.lot_id or l.quantity<>(x->>'quantity')::numeric or x->>'movement_id' is distinct from m.id::text or x->>'lot_id' is distinct from l.lot_id::text or m.created_by<>e.actor_id or m.created_at is distinct from e.created_at then raise exception 'Reconciliation stock compensation mismatch' using errcode='23514';end if;
  elsif e.action='restock' then
   select * into sl from public.native_return_stock_links where event_id=e.id and allocation_id=(x->>'allocation_id')::uuid;select * into m from public.inventory_movements where id=sl.movement_id;
   if sl.id is null or m.id is null or m.kind<>'native_return' or m.quantity<>sl.quantity or m.lot_id<>sl.lot_id or sl.quantity<>(x->>'quantity')::numeric or x->>'movement_id' is distinct from m.id::text or x->>'lot_id' is distinct from sl.lot_id::text or m.created_by<>e.actor_id or m.created_at is distinct from e.created_at then raise exception 'Reconciliation positive stock mismatch' using errcode='23514';end if;
  elsif x->'movement_id' is distinct from 'null'::jsonb then raise exception 'Nonstock reconciliation cannot move inventory' using errcode='23514';end if;
 end loop;
 if (select count(*) from public.native_return_compensation_links where event_id=e.id)<>(case when e.action='retract_restock' then jsonb_array_length(v->'allocations') else 0 end) or (select count(*) from public.native_return_stock_links where event_id=e.id)<>(case when e.action='restock' then jsonb_array_length(v->'allocations') else 0 end) then raise exception 'Unexpected reconciliation stock links' using errcode='23514';end if;
 if e.action='restock' then
  if v->'policy' is distinct from c->'policy' or v->'policy' is distinct from public.native_return_policy_verified((v#>>'{policy,version}')::integer) or v#>'{policy,enabled}' is distinct from 'true'::jsonb or (v#>>'{policy,reviewed_at}')::timestamptz>e.created_at
   or i->>'custody'<>'clinic_retained' or i->>'package_condition'<>'sealed_intact' or i->>'storage_history'<>'controlled' or c->'original_pickup'<>'null'::jsonb
   or c#>'{stock_review,product,active}' is distinct from 'true'::jsonb or c#>>'{stock_review,product,id}' is distinct from p_dispense#>>'{reviewed_context,product,id}' or c#>>'{stock_review,product,unit}' is distinct from p_dispense->>'unit' or c#>>'{stock_review,practice_date}' is distinct from (e.created_at at time zone 'America/Denver')::date::text
   or exists(select 1 from jsonb_array_elements(v->'allocations')a join public.inventory_lots lot on lot.id=(a->>'lot_id')::uuid where lot.expires_on<(c#>>'{stock_review,practice_date}')::date or ds->'held_lot_ids' ? lot.id::text)
  then raise exception 'Positive restock factual guards mismatch' using errcode='23514';end if;
 elsif v->'policy' is distinct from 'null'::jsonb or c->'policy' is distinct from 'null'::jsonb then raise exception 'Unexpected restock policy' using errcode='23514';end if;
 if e.action='retract_restock' then
  if c#>>'{stock_review,product,id}' is distinct from p_dispense#>>'{reviewed_context,product,id}' or exists(select 1 from jsonb_array_elements(v->'allocations')a where not exists(select 1 from jsonb_array_elements(c#>'{stock_review,lots}')lot where lot->>'lot_id'=a->>'lot_id' and (lot->>'balance')::numeric>=(select sum((b->>'quantity')::numeric) from jsonb_array_elements(v->'allocations')b where b->>'lot_id'=a->>'lot_id'))) then raise exception 'Available-stock compensation evidence mismatch' using errcode='23514';end if;
 elsif e.action<>'restock' and c->'stock_review' is distinct from 'null'::jsonb then raise exception 'Nonstock event cannot claim stock review' using errcode='23514';end if;

end $$;

create function public.native_reconciliation_verified(p_authorization_id uuid,p_pet_id uuid,p_dispense_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare prefixes jsonb;originals jsonb;quantity_events jsonb;prior_state jsonb;final_state jsonb;discrepancies jsonb; d jsonb;target jsonb;head jsonb:=jsonb_build_object('event_id',null,'version',0,'record_hash',null);events jsonb:='[]';e public.native_return_events;o public.native_return_operations;v jsonb;c jsonb;intent jsonb;x jsonb;b jsonb;i jsonb;balances jsonb;prev timestamptz;orig public.native_dispense_allocations;m public.inventory_movements;link public.native_return_stock_links;expected jsonb;corrections jsonb;
begin
 d:=public.native_fulfillment_verified_dispense(p_dispense_id);
 if d is null or p_authorization_id is null or p_pet_id is null or d->>'authorization_id' is distinct from p_authorization_id::text or d->>'pet_id' is distinct from p_pet_id::text then return null;end if;
 target:=jsonb_build_object('authorization_id',p_authorization_id,'pet_id',p_pet_id,'dispense_id',p_dispense_id);corrections:=public.native_correction_verified(p_authorization_id,p_pet_id,p_dispense_id);
 select jsonb_agg(jsonb_build_object('allocation_id',a.id,'lot_id',a.lot_id,'quantity',public.native_fulfillment_decimal(a.quantity)) order by a.id) into originals from public.native_dispense_allocations a where a.dispense_id=p_dispense_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'sequence',r.sequence,'action',r.action,'intake_id',r.intake_id,'correction_target_id',r.document#>'{correction_target,event_id}','allocations',(select jsonb_agg(x-'movement_id' order by x->>'allocation_id') from jsonb_array_elements(r.document->'allocations')x)) order by r.sequence),'[]'::jsonb) into quantity_events from public.native_return_events r where r.dispense_id=p_dispense_id;
 prefixes:=public.native_reconciliation_quantity_prefixes(originals,quantity_events);final_state:=prefixes->-1;
 for e in select * from public.native_return_events where dispense_id=p_dispense_id order by sequence loop
  v:=e.document;c:=e.reviewed_context;select * into o from public.native_return_operations where id=e.id;intent:=o.request->'intent';
  prior_state:=prefixes->(e.sequence-1);
  if e.sequence<>(head->>'version')::integer+1 or e.prior_event_id::text is distinct from head->>'event_id' or e.created_at<(d->>'dispensed_at')::timestamptz or e.created_at<prev then raise exception 'Reconciliation sequence or clock mismatch' using errcode='23514';end if;
  if v->'version'='2'::jsonb then
   perform public.native_reconciliation_event_verified(e,prior_state,head,d,corrections);
   head:=jsonb_build_object('event_id',e.id,'version',e.sequence,'record_hash',e.record_hash);events:=events||jsonb_build_array(v);prev:=e.created_at;continue;
  end if;
  perform public.native_return_validate_intent(intent);
  perform public.native_rx_keys(v,array['version','id','target','authorization_hash','dispense_document_hash','sequence','prior_event_id','prior_record_hash','actor','action','intake_id','allocations','custody','package_condition','storage_history','reason','note','policy','reviewed_context_hash','created_at','record_hash']);
  balances:=public.native_reconciliation_balances(prior_state);i:=public.native_reconciliation_intake(prior_state,e.intake_id);
  if o.id is null or o.actor_id<>e.actor_id or o.result is distinct from v or o.created_at is distinct from e.created_at
   or o.request_hash is distinct from public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',o.actor_id,'operation','record_native_dispense_return','request',o.request))
   or e.authorization_id<>p_authorization_id or e.pet_id<>p_pet_id or e.sequence<>(head->>'version')::integer+1 or e.prior_event_id::text is distinct from head->>'event_id'
   or v->'version' is distinct from '1'::jsonb or v->>'id' is distinct from e.id::text or v->'target' is distinct from target or v->>'sequence' is distinct from e.sequence::text
   or v->>'prior_event_id' is distinct from head->>'event_id' or v->>'prior_record_hash' is distinct from head->>'record_hash' or v#>>'{actor,id}' is distinct from e.actor_id::text
   or v->>'action' is distinct from e.action or v->>'intake_id' is distinct from e.intake_id::text or (v->>'created_at')::timestamptz is distinct from e.created_at
   or v->>'authorization_hash' is distinct from d->>'authorization_hash' or v->>'dispense_document_hash' is distinct from public.native_fulfillment_hash(d)
   or e.record_hash is distinct from v->>'record_hash' or e.record_hash is distinct from public.native_fulfillment_hash(v-'record_hash')
   or v->>'reviewed_context_hash' is distinct from public.native_fulfillment_hash(c) or o.request->>'expected_context_hash' is distinct from v->>'reviewed_context_hash' or o.request->'expected_head' is distinct from head
   or o.request->'attest_review' is distinct from 'true'::jsonb or o.request->'attest_restock' is distinct from to_jsonb(e.action='restock')
   or c->'target' is distinct from target or c->'head' is distinct from head or c->'intent' is distinct from intent or c->'allocations' is distinct from balances or c->'intake' is distinct from coalesce(i,'null'::jsonb)
   or c->>'authorization_hash' is distinct from d->>'authorization_hash' or c->>'dispense_document_hash' is distinct from public.native_fulfillment_hash(d) or c->'dispensed_at' is distinct from d->'dispensed_at'
   or intent->'target' is distinct from target or intent->>'action' is distinct from e.action or intent->>'intake_id' is distinct from e.intake_id::text
   or v->'reason' is distinct from intent->'reason' or v->'note' is distinct from intent->'note' or v->'custody' is distinct from intent->'custody' or v->'package_condition' is distinct from intent->'package_condition' or v->'storage_history' is distinct from intent->'storage_history'
   or e.created_at<(d->>'dispensed_at')::timestamptz or (prev is not null and e.created_at<prev)
  then raise exception 'Native return integrity mismatch' using errcode='23514';end if;
  perform public.native_rx_keys(c,array['version','target','authorization_hash','dispense_document_hash','dispensed_at','head','original_pickup','correction_head','allocations','intake','stock_review','policy','intent']);
  perform public.native_rx_keys(v->'actor',array['id','name','authority']);perform public.native_rx_text(v#>'{actor,name}',200);
  if v#>>'{actor,authority}' is distinct from (case when e.action='restock' then 'active_dvm' else 'active_staff' end) or c->'version' is distinct from '1'::jsonb then raise exception 'Native return authority mismatch' using errcode='23514';end if;
  if c->'original_pickup' is distinct from coalesce(public.native_correction_pickup(p_dispense_id),'null'::jsonb) then raise exception 'Native return pickup evidence mismatch' using errcode='23514';end if;
  if c#>>'{correction_head,version}'='0' then
   if c->'correction_head' is distinct from jsonb_build_object('event_id',null,'version',0,'record_hash',null) then raise exception 'Native return correction evidence mismatch' using errcode='23514';end if;
  elsif not exists(select 1 from jsonb_array_elements(corrections->'events')ce where ce->>'id'=c#>>'{correction_head,event_id}' and ce->'sequence'=c#>'{correction_head,version}' and ce->>'record_hash'=c#>>'{correction_head,record_hash}') then raise exception 'Native return correction evidence mismatch' using errcode='23514';end if;
  if e.action<>'intake' and (i is null or not exists(select 1 from public.native_return_events src where src.id=e.intake_id and src.dispense_id=p_dispense_id and src.action='intake' and src.sequence<e.sequence and src.created_at<=e.created_at)) then raise exception 'Native return intake reference mismatch' using errcode='23514';end if;
  if jsonb_array_length(v->'allocations')<>jsonb_array_length(intent->'allocations') then raise exception 'Native return allocation mismatch' using errcode='23514';end if;
  for x in select value from jsonb_array_elements(v->'allocations') loop
   perform public.native_rx_keys(x,array['allocation_id','lot_id','quantity','movement_id']);select * into orig from public.native_dispense_allocations where id=(x->>'allocation_id')::uuid and dispense_id=p_dispense_id;
   select value into b from jsonb_array_elements(balances) where value->>'allocation_id'=x->>'allocation_id';
   if orig.id is null or x->>'lot_id'<>orig.lot_id::text or x->>'quantity' is distinct from public.native_fulfillment_decimal(public.native_fulfillment_quantity(x->'quantity'))
    or not exists(select 1 from jsonb_array_elements(intent->'allocations') inp where inp->>'allocation_id'=orig.id::text and public.native_fulfillment_quantity(inp->'quantity')=(x->>'quantity')::numeric)
    or (e.action='intake' and (x->>'quantity')::numeric>(b->>'remaining_returnable_quantity')::numeric)
    or (e.action<>'intake' and not exists(select 1 from jsonb_array_elements(i->'allocations') ia where ia->>'allocation_id'=orig.id::text and (ia->>'held_quantity')::numeric>=(x->>'quantity')::numeric))
   then raise exception 'Native return allocation cap mismatch' using errcode='23514';end if;
   if e.action='restock' then
    select * into link from public.native_return_stock_links where event_id=e.id and allocation_id=orig.id;select * into m from public.inventory_movements where id=link.movement_id;
    if link.id is null or m.id is null or link.lot_id<>orig.lot_id or link.quantity<>(x->>'quantity')::numeric or x->>'movement_id' is distinct from m.id::text or m.kind<>'native_return' or m.lot_id<>orig.lot_id or m.quantity<>link.quantity or m.created_by<>e.actor_id or m.created_at is distinct from e.created_at then raise exception 'Native return stock linkage mismatch' using errcode='23514';end if;
   elsif x->'movement_id' is distinct from 'null'::jsonb then raise exception 'Held or disposed return cannot move available stock' using errcode='23514';end if;
  end loop;
  select coalesce(jsonb_agg(allocation_row.value order by allocation_row.value->>'allocation_id'),'[]') into expected from jsonb_array_elements(v->'allocations') as allocation_row(value);
  if expected is distinct from v->'allocations' or (select count(*)<>count(distinct allocation_row.value->>'allocation_id') from jsonb_array_elements(v->'allocations') as allocation_row(value)) or (select count(*) from public.native_return_stock_links where event_id=e.id)<>(case when e.action='restock' then jsonb_array_length(v->'allocations') else 0 end) then raise exception 'Native return stock allocation ordering mismatch' using errcode='23514';end if;
  if e.action='restock' then
   if v->'policy' is distinct from c->'policy' or v->'policy' is distinct from public.native_return_policy_verified((v#>>'{policy,version}')::integer) or v#>'{policy,enabled}' is distinct from 'true'::jsonb
    or (v#>>'{policy,reviewed_at}')::timestamptz>e.created_at
    or i->>'custody' is distinct from 'clinic_retained' or i->>'package_condition' is distinct from 'sealed_intact' or i->>'storage_history' is distinct from 'controlled' or c->'original_pickup' is distinct from 'null'::jsonb
    or c#>'{stock_review,product,active}' is distinct from 'true'::jsonb or c#>>'{stock_review,product,id}' is distinct from d#>>'{reviewed_context,product,id}' or c#>>'{stock_review,product,unit}' is distinct from d->>'unit'
    or c#>>'{stock_review,practice_date}' is distinct from (e.created_at at time zone 'America/Denver')::date::text
    or exists(select 1 from jsonb_array_elements(v->'allocations') a join public.inventory_lots l on l.id=(a->>'lot_id')::uuid where l.expires_on<(c#>>'{stock_review,practice_date}')::date)
   then raise exception 'Native return reviewed restock evidence mismatch' using errcode='23514';end if;
  elsif v->'policy' is distinct from 'null'::jsonb or c->'policy' is distinct from 'null'::jsonb or c->'stock_review' is distinct from 'null'::jsonb then raise exception 'Nonstock return must not assert policy approval' using errcode='23514';end if;
  head:=jsonb_build_object('event_id',e.id,'version',e.sequence,'record_hash',e.record_hash);events:=events||jsonb_build_array(v);prev:=e.created_at;
 end loop;
 return jsonb_build_object('read',jsonb_build_object('version',2,'target',target,'authorization_hash',d->'authorization_hash','dispense_document_hash',public.native_fulfillment_hash(d),'dispensed_at',d->'dispensed_at','head',head,'allocations',public.native_reconciliation_balances(final_state),'replay',final_state,'discrepancies',public.native_reconciliation_discrepancies(p_dispense_id)),'events',events);
end $$;
create function public.preview_native_dispense_return_v2(p_intent jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();aid uuid;pet uuid;did uuid;v jsonb;r jsonb;d jsonb;i jsonb;policy jsonb;stock jsonb;lots jsonb:='[]';blockers jsonb:='[]';product public.catalog_products;lot public.inventory_lots;x jsonb;b jsonb;ctx jsonb;correction jsonb;practice date;source public.native_return_events;quantity_events jsonb;originals jsonb;lines jsonb:='[]';act text;candidate jsonb;begin
 perform public.native_reconciliation_validate_intent(p_intent);aid:=(p_intent#>>'{target,authorization_id}')::uuid;pet:=(p_intent#>>'{target,pet_id}')::uuid;did:=(p_intent#>>'{target,dispense_id}')::uuid;act:=p_intent->>'action';
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||aid::text,0));perform public.clinical_require_staff();
 v:=public.native_reconciliation_verified(aid,pet,did);if v is null then raise exception 'Exact reconciliation target required' using errcode='23514';end if;r:=v->'read';d:=public.native_fulfillment_verified_dispense(did);correction:=public.native_correction_verified(aid,pet,did);
 if act<>'intake' then i:=public.native_reconciliation_intake(r->'replay',(p_intent->>'intake_id')::uuid);if i is null then raise exception 'Exact prior intake required' using errcode='23514';end if;end if;
 if act like 'retract_%' then
  select * into source from public.native_return_events where id=(p_intent#>>'{correction_target,event_id}')::uuid;
  if source.id is null or source.dispense_id<>did or source.record_hash is distinct from p_intent#>>'{correction_target,record_hash}' or source.action is distinct from (case act when 'retract_intake' then 'intake' when 'retract_disposal' then 'dispose' else 'restock' end) then raise exception 'Exact ordinary correction source required' using errcode='23514';end if;
  if p_intent->'discrepancy_id'<>'null'::jsonb and not exists(select 1 from jsonb_array_elements(r#>'{discrepancies,cases}')q where q->>'id'=p_intent->>'discrepancy_id' and q->>'status'='open' and q->'source'=p_intent->'correction_target') then raise exception 'Open matching discrepancy required' using errcode='23514';end if;
 end if;
 for x in select value from jsonb_array_elements(p_intent->'allocations') loop
  select value into b from jsonb_array_elements(r->'allocations')q where q.value->>'allocation_id'=x->>'allocation_id';if b is null then raise exception 'Exact original allocation required' using errcode='23514';end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('allocation_id',x->'allocation_id','lot_id',b->'lot_id','quantity',public.native_fulfillment_decimal(public.native_fulfillment_quantity(x->'quantity'))));
 end loop;
 if p_intent->'discrepancy_id'<>'null'::jsonb then
  if exists(select 1 from jsonb_array_elements(lines)line where not exists(select 1 from jsonb_array_elements(r#>'{discrepancies,cases}')cas cross join lateral jsonb_array_elements(cas->'allocations')ca where cas->>'id'=p_intent->>'discrepancy_id' and ca->>'allocation_id'=line->>'allocation_id' and (ca->>'quantity')::numeric >= (line->>'quantity')::numeric + coalesce((select sum((oldline->>'quantity')::numeric) from public.native_return_events old cross join lateral jsonb_array_elements(old.document->'allocations')oldline where old.dispense_id=did and old.document->>'discrepancy_id'=p_intent->>'discrepancy_id' and oldline->>'allocation_id'=line->>'allocation_id'),0))) then raise exception 'Correction exceeds remaining discrepancy quantity' using errcode='23514';end if;
 end if;
 select jsonb_agg(jsonb_build_object('allocation_id',q->'allocation_id','lot_id',q->'lot_id','quantity',q->'dispensed_quantity') order by q->>'allocation_id') into originals from jsonb_array_elements(r->'allocations')q;
 select coalesce(jsonb_agg(jsonb_build_object('id',q->'id','sequence',q->'sequence','action',q->'action','intake_id',q->'intake_id','correction_target_id',q#>'{correction_target,event_id}','allocations',(select jsonb_agg(x-'movement_id' order by x->>'allocation_id') from jsonb_array_elements(q->'allocations')x)) order by (q->>'sequence')::integer),'[]'::jsonb) into quantity_events from jsonb_array_elements(v->'events')q;
 candidate:=jsonb_build_object('id',gen_random_uuid(),'sequence',(r#>>'{head,version}')::integer+1,'action',act,'intake_id',p_intent->'intake_id','correction_target_id',p_intent#>'{correction_target,event_id}','allocations',lines);
 perform public.native_return_quantity_replay(originals,quantity_events||jsonb_build_array(candidate));
 if act in('restock','retract_restock') then
  if act='restock' then perform 1 from public.native_return_policy_state where id for share;policy:=public.native_return_policy_verified();end if;
  select * into product from public.catalog_products where id=(d#>>'{reviewed_context,product,id}')::uuid for share;
  if product.id is null then raise exception 'Original product required' using errcode='23514';end if;
  for lot in select distinct l.* from public.inventory_lots l join public.native_dispense_allocations da on da.lot_id=l.id where da.dispense_id=did and da.id in(select (q->>'allocation_id')::uuid from jsonb_array_elements(lines)q) order by l.id loop
   perform 1 from public.inventory_lots where id=lot.id for update;
   if lot.product_id<>product.id then raise exception 'Original lot product mismatch' using errcode='23514';end if;
   lots:=lots||jsonb_build_array(jsonb_build_object('lot_id',lot.id,'balance',public.native_fulfillment_decimal((select coalesce(sum(quantity),0) from public.inventory_movements where lot_id=lot.id))));
   if act='restock' and public.native_reconciliation_lot_held(lot.id) then blockers:=blockers||'"lot_review_hold"'::jsonb;end if;
   if act='retract_restock' and (select coalesce(sum(quantity),0) from public.inventory_movements where lot_id=lot.id)<(select sum((q->>'quantity')::numeric) from jsonb_array_elements(lines)q where q->>'lot_id'=lot.id::text) then blockers:=blockers||'"insufficient_available_stock"'::jsonb;end if;
  end loop;
  practice:=(clock_timestamp() at time zone 'America/Denver')::date;stock:=jsonb_build_object('product',jsonb_build_object('id',product.id,'name',product.name,'unit',product.unit,'active',product.active,'version',product.version),'lots',lots,'practice_date',practice);
 end if;
 if act not in('intake','dispose') and not exists(select 1 from public.user_roles where user_id=a and role='DVM') then blockers:=blockers||'"dvm_required"'::jsonb;end if;
 if act='restock' then
  if policy->'enabled' is distinct from 'true'::jsonb then blockers:=blockers||'"policy_disabled"'::jsonb;end if;
  if i->>'custody'<>'clinic_retained' then blockers:=blockers||'"custody_not_retained"'::jsonb;end if;
  if i->>'package_condition'<>'sealed_intact' then blockers:=blockers||'"package_not_sealed"'::jsonb;end if;
  if i->>'storage_history'<>'controlled' then blockers:=blockers||'"storage_not_controlled"'::jsonb;end if;
  if correction#>'{context,original_pickup}' is distinct from 'null'::jsonb then blockers:=blockers||'"original_pickup_exists"'::jsonb;end if;
  if not product.active then blockers:=blockers||'"product_inactive"'::jsonb;end if;
  if product.unit<>d->>'unit' then blockers:=blockers||'"unit_changed"'::jsonb;end if;
  if exists(select 1 from jsonb_array_elements(r->'allocations')q where (q->>'expires_on')::date<practice and q->>'allocation_id' in(select z->>'allocation_id' from jsonb_array_elements(lines)z)) then blockers:=blockers||'"lot_expired"'::jsonb;end if;
 end if;
 ctx:=jsonb_build_object('version',2,'target',r->'target','authorization_hash',r->'authorization_hash','dispense_document_hash',r->'dispense_document_hash','dispensed_at',r->'dispensed_at','head',r->'head','discrepancy_head',r#>'{discrepancies,head}','original_pickup',coalesce(public.native_correction_pickup(did),'null'::jsonb),'correction_head',correction#>'{context,head}','allocations',r->'allocations','intake',i,'replay',r->'replay','discrepancies',r->'discrepancies','stock_review',stock,'policy',policy,'intent',p_intent);
 perform public.clinical_require_staff();return jsonb_build_object('version',2,'actor_id',a,'observed_at',clock_timestamp(),'context',ctx,'context_hash',public.native_fulfillment_hash(ctx),'allowed',jsonb_array_length(blockers)=0,'blockers',blockers);
end $$;
create function public.record_native_dispense_return_v2(p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();o public.native_return_operations;preview jsonb;c jsonb;intent jsonb;head jsonb;actor jsonb;act text;aid uuid;pet uuid;did uuid;stamp timestamptz;x jsonb;alloc public.native_dispense_allocations;n numeric;mid uuid;lines jsonb:='[]';doc jsonb;begin
 if p_id is null then raise exception 'Stable operation id required' using errcode='23514';end if;perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into o from public.native_return_operations where id=p_id;
 if found then if o.actor_id<>a or o.request is distinct from p_request or o.result->'version' is distinct from '2'::jsonb then raise exception 'Return operation id already used' using errcode='23514';end if;return public.recover_native_dispense_return_v2(p_id);end if;
 perform public.native_rx_keys(p_request,array['intent','expected_context_hash','expected_head','expected_discrepancy_head','attest_review','attest_restock','physical_attestations']);intent:=p_request->'intent';perform public.native_reconciliation_validate_intent(intent);act:=intent->>'action';
 if p_request->'attest_review' is distinct from 'true'::jsonb or p_request->'attest_restock' is distinct from to_jsonb(act='restock') or p_request->'physical_attestations' is distinct from public.native_reconciliation_attestations(act) then raise exception 'Action-specific physical fact review required' using errcode='23514';end if;
 preview:=public.preview_native_dispense_return_v2(intent);c:=preview->'context';head:=c->'head';actor:=public.native_correction_actor(case when act in('intake','dispose') then 'operational_annotation' else 'clinical_annotation' end);
 if preview->'allowed' is distinct from 'true'::jsonb then raise exception 'Reconciliation has unresolved blockers: %',preview->'blockers' using errcode='23514';end if;
 if p_request->>'expected_context_hash' is distinct from preview->>'context_hash' or p_request->'expected_head' is distinct from head or p_request->'expected_discrepancy_head' is distinct from c->'discrepancy_head' then raise exception 'Reconciliation changed; review again' using errcode='40001';end if;
 aid:=(c#>>'{target,authorization_id}')::uuid;pet:=(c#>>'{target,pet_id}')::uuid;did:=(c#>>'{target,dispense_id}')::uuid;stamp:=clock_timestamp();
 if (head->>'version')::integer=2147483647 or stamp<(c->>'dispensed_at')::timestamptz or exists(select 1 from public.native_return_events where dispense_id=did and created_at>stamp) or exists(select 1 from public.native_return_discrepancy_events where dispense_id=did and created_at>stamp) then raise exception 'Reconciliation chronology unavailable' using errcode='40001';end if;
 if act='restock' and((c#>>'{policy,reviewed_at}')::timestamptz>stamp or c#>>'{stock_review,practice_date}' is distinct from (stamp at time zone 'America/Denver')::date::text) then raise exception 'Restock observation changed' using errcode='40001';end if;
 for x in select value from jsonb_array_elements(intent->'allocations') loop
  select * into alloc from public.native_dispense_allocations where id=(x->>'allocation_id')::uuid and dispense_id=did;n:=public.native_fulfillment_quantity(x->'quantity');mid:=null;
  if act in('restock','retract_restock') then mid:=gen_random_uuid();insert into public.inventory_movements(id,lot_id,quantity,kind,reason,created_by,created_at) values(mid,alloc.lot_id,case act when 'restock' then n else -n end,case act when 'restock' then 'native_return' else 'native_return_compensation' end,intent->>'reason',a,stamp);end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('allocation_id',alloc.id,'lot_id',alloc.lot_id,'quantity',public.native_fulfillment_decimal(n),'movement_id',mid));
 end loop;
 doc:=jsonb_build_object('version',2,'id',p_id,'target',c->'target','authorization_hash',c->'authorization_hash','dispense_document_hash',c->'dispense_document_hash','sequence',(head->>'version')::integer+1,'prior_event_id',head->'event_id','prior_record_hash',head->'record_hash','actor',actor,'action',act,'intake_id',intent->'intake_id','allocations',lines,'custody',intent->'custody','package_condition',intent->'package_condition','storage_history',intent->'storage_history','reason',intent->'reason','note',intent->'note','policy',c->'policy','correction_target',intent->'correction_target','discrepancy_id',intent->'discrepancy_id','physical_attestations',p_request->'physical_attestations','reviewed_context_hash',preview->'context_hash','created_at',stamp);doc:=doc||jsonb_build_object('record_hash',public.native_fulfillment_hash(doc));
 insert into public.native_return_events values(p_id,aid,pet,did,(head->>'version')::integer+1,(head->>'event_id')::uuid,a,act,(intent->>'intake_id')::uuid,stamp,doc->>'record_hash',c,doc);
 if act='restock' then insert into public.native_return_stock_links select gen_random_uuid(),p_id,(q->>'allocation_id')::uuid,(q->>'lot_id')::uuid,(q->>'movement_id')::uuid,(q->>'quantity')::numeric from jsonb_array_elements(lines)q;end if;
 if act='retract_restock' then insert into public.native_return_compensation_links select gen_random_uuid(),p_id,(intent#>>'{correction_target,event_id}')::uuid,(q->>'allocation_id')::uuid,(q->>'lot_id')::uuid,s.movement_id,(q->>'movement_id')::uuid,(q->>'quantity')::numeric from jsonb_array_elements(lines)q join public.native_return_stock_links s on s.event_id=(intent#>>'{correction_target,event_id}')::uuid and s.allocation_id=(q->>'allocation_id')::uuid;end if;
 insert into public.native_return_operations values(p_id,a,p_request,public.native_fulfillment_hash(jsonb_build_object('version',2,'actor_id',a,'operation','record_native_dispense_return_v2','request',p_request)),doc,stamp) returning * into o;
 perform public.native_correction_actor(case when act in('intake','dispose') then 'operational_annotation' else 'clinical_annotation' end);
 return jsonb_build_object('version',2,'id',o.id,'actor_id',o.actor_id,'request',o.request,'request_hash',o.request_hash,'result',o.result,'created_at',o.created_at);
end $$;
create function public.preview_native_return_discrepancy(p_intent jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();aid uuid;pet uuid;did uuid;act text;v jsonb;r jsonb;source public.native_return_events;case_row jsonb;x jsonb;prior text:='';u text;lines jsonb:='[]';ctx jsonb;blockers jsonb:='[]';lot record;begin
 perform public.native_rx_keys(p_intent,array['target','action','case_id','source','allocations','observation','correction_ids']);perform public.native_rx_keys(p_intent->'target',array['authorization_id','pet_id','dispense_id']);perform public.native_rx_keys(p_intent->'source',array['event_id','record_hash']);
 perform public.native_rx_text(p_intent->'observation',4000);
 if nullif(btrim(p_intent->>'observation'),'') is null or p_intent->>'action' not in('report','note','resolve_corrected','resolve_confirmed_original') or jsonb_typeof(p_intent->'action') is distinct from 'string' then raise exception 'Attributed discrepancy observation required' using errcode='23514';end if;
 foreach u in array array['authorization_id','pet_id','dispense_id'] loop if jsonb_typeof(p_intent#>array['target',u]) is distinct from 'string' or p_intent#>>array['target',u] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Exact discrepancy target required' using errcode='23514';end if;end loop;
 if jsonb_typeof(p_intent#>'{source,event_id}') is distinct from 'string' or p_intent#>>'{source,event_id}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(p_intent#>'{source,record_hash}') is distinct from 'string' or p_intent#>>'{source,record_hash}' !~ '^[0-9a-f]{64}$' then raise exception 'Exact discrepancy source required' using errcode='23514';end if;
 aid:=(p_intent#>>'{target,authorization_id}')::uuid;pet:=(p_intent#>>'{target,pet_id}')::uuid;did:=(p_intent#>>'{target,dispense_id}')::uuid;act:=p_intent->>'action';
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||aid::text,0));perform public.clinical_require_staff();v:=public.native_reconciliation_verified(aid,pet,did);r:=v->'read';
 if v is null then raise exception 'Exact discrepancy target required' using errcode='23514';end if;
 select * into source from public.native_return_events where id=(p_intent#>>'{source,event_id}')::uuid;
 if source.id is null or source.dispense_id<>did or source.action not in('intake','dispose','restock') or source.record_hash is distinct from p_intent#>>'{source,record_hash}' then raise exception 'Exact ordinary discrepancy source required' using errcode='23514';end if;
 if jsonb_typeof(p_intent->'allocations') is distinct from 'array' then raise exception 'Discrepancy quantities required' using errcode='23514';end if;
 if jsonb_array_length(p_intent->'allocations') not between 1 and 100 then raise exception 'Bounded discrepancy quantities required' using errcode='23514';end if;
 for x in select value from jsonb_array_elements(p_intent->'allocations') loop
  perform public.native_rx_keys(x,array['allocation_id','quantity']);
  if jsonb_typeof(x->'allocation_id') is distinct from 'string' or x->>'allocation_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or (x->>'allocation_id') collate "C"<=prior collate "C" then raise exception 'Sorted original discrepancy allocations required' using errcode='23514';end if;prior:=x->>'allocation_id';
  if not exists(select 1 from jsonb_array_elements(source.document->'allocations')q where q->>'allocation_id'=x->>'allocation_id' and (q->>'quantity')::numeric>=public.native_fulfillment_quantity(x->'quantity')) then raise exception 'Discrepancy exceeds source allocation' using errcode='23514';end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('allocation_id',x->'allocation_id','lot_id',(select q->'lot_id' from jsonb_array_elements(source.document->'allocations')q where q->>'allocation_id'=x->>'allocation_id'),'quantity',public.native_fulfillment_decimal(public.native_fulfillment_quantity(x->'quantity'))));
 end loop;
 if act='report' then if p_intent->'case_id' is distinct from 'null'::jsonb then raise exception 'New report creates its own case' using errcode='23514';end if;
 else
  if jsonb_typeof(p_intent->'case_id') is distinct from 'string' or p_intent->>'case_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Exact open case required' using errcode='23514';end if;
  select q into case_row from jsonb_array_elements(r#>'{discrepancies,cases}')q where q->>'id'=p_intent->>'case_id';
  if case_row is null or case_row->>'status'<>'open' or case_row->'source' is distinct from p_intent->'source' or case_row->'allocations' is distinct from lines then raise exception 'Exact open case quantities and source required' using errcode='23514';end if;
 end if;
 if jsonb_typeof(p_intent->'correction_ids') is distinct from 'array' then raise exception 'Correction ids must be array' using errcode='23514';end if;
 if act='resolve_corrected' then
  if jsonb_array_length(p_intent->'correction_ids') not between 1 and 100 then raise exception 'Actual correction links required' using errcode='23514';end if;prior:='';
  for x in select value from jsonb_array_elements(p_intent->'correction_ids') loop
   u:=x#>>'{}';if jsonb_typeof(x) is distinct from 'string' or u !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or u collate "C"<=prior collate "C" then raise exception 'Sorted unique correction ids required' using errcode='23514';end if;prior:=u;
   if not exists(select 1 from public.native_return_events e where e.id=u::uuid and e.dispense_id=did and e.document->'version'='2'::jsonb and e.document->'correction_target'=p_intent->'source' and e.document->>'discrepancy_id'=p_intent->>'case_id' and e.action like 'retract_%') or exists(select 1 from public.native_return_discrepancy_correction_links where correction_id=u::uuid) then raise exception 'Unused exact case correction required' using errcode='23514';end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(lines)q where (q->>'quantity')::numeric is distinct from(select sum((a->>'quantity')::numeric) from public.native_return_events e cross join lateral jsonb_array_elements(e.document->'allocations')a where p_intent->'correction_ids' ? e.id::text and a->>'allocation_id'=q->>'allocation_id'))
   or exists(select 1 from public.native_return_events e cross join lateral jsonb_array_elements(e.document->'allocations')a where p_intent->'correction_ids' ? e.id::text and not exists(select 1 from jsonb_array_elements(lines)q where q->>'allocation_id'=a->>'allocation_id')) then raise exception 'Correction quantities must exactly reconcile case' using errcode='23514';end if;
 elsif p_intent->'correction_ids' is distinct from '[]'::jsonb then raise exception 'This decision cannot claim compensation' using errcode='23514';end if;
 if act='resolve_confirmed_original' and exists(select 1 from public.native_return_events e where e.document->>'discrepancy_id'=p_intent->>'case_id') then raise exception 'Compensated case requires correction resolution' using errcode='23514';end if;
 -- The common authorization gate precedes product/lot locks; a competing lot writer
 -- completes before the report becomes effective or sees the committed hold.
 perform 1 from public.catalog_products where id=(select product_id from public.inventory_lots where id=(lines#>>'{0,lot_id}')::uuid) for share;
 for lot in select distinct (q->>'lot_id')::uuid id from jsonb_array_elements(lines)q order by id loop perform 1 from public.inventory_lots where id=lot.id for update;end loop;
 if act like 'resolve_%' and not exists(select 1 from public.user_roles where user_id=a and role='DVM') then blockers:=blockers||'"dvm_required"'::jsonb;end if;
 ctx:=jsonb_build_object('version',1,'target',r->'target','return_head',r->'head','discrepancy_head',r#>'{discrepancies,head}','source',source.document,'replay',r->'replay','discrepancies',r->'discrepancies','intent',p_intent);
 perform public.clinical_require_staff();return jsonb_build_object('version',1,'actor_id',a,'observed_at',clock_timestamp(),'context',ctx,'context_hash',public.native_fulfillment_hash(ctx),'allowed',jsonb_array_length(blockers)=0,'blockers',blockers);
end $$;
create function public.record_native_return_discrepancy(p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();o public.native_return_discrepancy_operations;preview jsonb;c jsonb;intent jsonb;h jsonb;actor jsonb;doc jsonb;stamp timestamptz;act text;did uuid;case_id uuid;lines jsonb;begin
 if p_id is null then raise exception 'Stable discrepancy operation required' using errcode='23514';end if;perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));select * into o from public.native_return_discrepancy_operations where id=p_id;
 if found then if o.actor_id<>a or o.request is distinct from p_request then raise exception 'Discrepancy operation already used' using errcode='23514';end if;return public.recover_native_return_discrepancy(p_id);end if;
 perform public.native_rx_keys(p_request,array['intent','expected_context_hash','expected_return_head','expected_discrepancy_head','attest_physical_review','attest_original_quantities_custody_and_stock_accurate']);intent:=p_request->'intent';act:=intent->>'action';
 if p_request->'attest_physical_review' is distinct from 'true'::jsonb or p_request->'attest_original_quantities_custody_and_stock_accurate' is distinct from to_jsonb(act='resolve_confirmed_original') then raise exception 'Explicit discrepancy factual review required' using errcode='23514';end if;
 preview:=public.preview_native_return_discrepancy(intent);c:=preview->'context';h:=c->'discrepancy_head';actor:=public.native_correction_actor(case when act like 'resolve_%' then 'clinical_annotation' else 'operational_annotation' end);
 if preview->'allowed' is distinct from 'true'::jsonb then raise exception 'Discrepancy decision has blockers' using errcode='23514';end if;
 if p_request->>'expected_context_hash' is distinct from preview->>'context_hash' or p_request->'expected_return_head' is distinct from c->'return_head' or p_request->'expected_discrepancy_head' is distinct from h then raise exception 'Discrepancy context changed; review again' using errcode='40001';end if;
 did:=(c#>>'{target,dispense_id}')::uuid;stamp:=clock_timestamp();case_id:=case act when 'report' then p_id else (intent->>'case_id')::uuid end;
 if (h->>'version')::integer=2147483647 or exists(select 1 from public.native_return_events where dispense_id=did and created_at>stamp) or exists(select 1 from public.native_return_discrepancy_events where dispense_id=did and created_at>stamp) then raise exception 'Discrepancy chronology unavailable' using errcode='40001';end if;
 select jsonb_agg(jsonb_build_object('allocation_id',q->'allocation_id','lot_id',s->'lot_id','quantity',public.native_fulfillment_decimal(public.native_fulfillment_quantity(q->'quantity'))) order by q->>'allocation_id') into lines from jsonb_array_elements(intent->'allocations')q join jsonb_array_elements(c#>'{source,allocations}')s on s->'allocation_id'=q->'allocation_id';
 doc:=jsonb_build_object('version',1,'id',p_id,'target',c->'target','sequence',(h->>'version')::integer+1,'prior_event_id',h->'event_id','prior_record_hash',h->'record_hash','actor',actor,'action',act,'case_id',case_id,'source',intent->'source','allocations',lines,'observation',intent->'observation','correction_ids',intent->'correction_ids','return_head',c->'return_head','reviewed_context_hash',preview->'context_hash','created_at',stamp);doc:=doc||jsonb_build_object('record_hash',public.native_fulfillment_hash(doc));
 insert into public.native_return_discrepancy_events values(p_id,(c#>>'{target,authorization_id}')::uuid,(c#>>'{target,pet_id}')::uuid,did,(h->>'version')::integer+1,(h->>'event_id')::uuid,a,case_id,act,stamp,doc->>'record_hash',c,doc);
 if act='resolve_corrected' then insert into public.native_return_discrepancy_correction_links select case_id,value::uuid,p_id from jsonb_array_elements_text(intent->'correction_ids');end if;
 insert into public.native_return_discrepancy_operations values(p_id,a,p_request,public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',a,'operation','record_native_return_discrepancy','request',p_request)),doc,stamp) returning * into o;
 perform public.native_correction_actor(case when act like 'resolve_%' then 'clinical_annotation' else 'operational_annotation' end);
 return jsonb_build_object('version',1,'id',o.id,'actor_id',o.actor_id,'request',o.request,'request_hash',o.request_hash,'result',o.result,'created_at',o.created_at);
end $$;
create function public.recover_native_dispense_return_v2(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$declare a uuid:=public.clinical_require_staff();o public.native_return_operations;begin
 select * into o from public.native_return_operations where id=p_id;if not found then return null;end if;if o.actor_id<>a then raise exception 'Return receipt unavailable' using errcode='42501';end if;
 if o.result->'version' is distinct from '2'::jsonb then raise exception 'Use historical version-one receipt recovery' using errcode='23514';end if;
 perform public.native_reconciliation_verified((o.request#>>'{intent,target,authorization_id}')::uuid,(o.request#>>'{intent,target,pet_id}')::uuid,(o.request#>>'{intent,target,dispense_id}')::uuid);
 return jsonb_build_object('version',2,'id',o.id,'actor_id',o.actor_id,'request',o.request,'request_hash',o.request_hash,'result',o.result,'created_at',o.created_at);
end $$;
create function public.recover_native_return_discrepancy(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$declare a uuid:=public.clinical_require_staff();o public.native_return_discrepancy_operations;begin
 select * into o from public.native_return_discrepancy_operations where id=p_id;if not found then return null;end if;if o.actor_id<>a then raise exception 'Discrepancy receipt unavailable' using errcode='42501';end if;
 perform public.native_reconciliation_verified((o.request#>>'{intent,target,authorization_id}')::uuid,(o.request#>>'{intent,target,pet_id}')::uuid,(o.request#>>'{intent,target,dispense_id}')::uuid);
 return jsonb_build_object('version',1,'id',o.id,'actor_id',o.actor_id,'request',o.request,'request_hash',o.request_hash,'result',o.result,'created_at',o.created_at);
end $$;
create function public.read_native_dispense_returns_v2(p_authorization_id uuid,p_pet_id uuid,p_dispense_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$begin perform public.clinical_require_staff();return public.native_reconciliation_verified(p_authorization_id,p_pet_id,p_dispense_id)->'read';end $$;
create function public.read_native_return_intake_v2(p_authorization_id uuid,p_pet_id uuid,p_dispense_id uuid,p_intake_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$declare v jsonb;i jsonb;begin perform public.clinical_require_staff();v:=public.native_reconciliation_verified(p_authorization_id,p_pet_id,p_dispense_id);if v is null then return null;end if;i:=public.native_reconciliation_intake(v#>'{read,replay}',p_intake_id);if i is null then return null;end if;return jsonb_build_object('version',2,'target',v#>'{read,target}','head',v#>'{read,head}','discrepancy_head',v#>'{read,discrepancies,head}','intake',i);end $$;
create function public.list_native_dispense_returns_v2(p_authorization_id uuid,p_pet_id uuid,p_dispense_id uuid,p_before_version integer default null,p_limit integer default 25) returns jsonb language plpgsql stable security definer set search_path=public as $$declare v jsonb;rows jsonb;more boolean;begin
 perform public.clinical_require_staff();if p_limit is null or p_limit not between 1 and 100 or(p_before_version is not null and p_before_version<1) then raise exception 'Bounded reconciliation cursor required' using errcode='23514';end if;v:=public.native_reconciliation_verified(p_authorization_id,p_pet_id,p_dispense_id);if v is null then return null;end if;
 select coalesce(jsonb_agg(x order by (x->>'sequence')::integer desc),'[]') into rows from(select value x from jsonb_array_elements(v->'events') where p_before_version is null or (value->>'sequence')::integer<p_before_version order by (value->>'sequence')::integer desc limit p_limit+1)q;more:=jsonb_array_length(rows)>p_limit;if more then rows:=rows-p_limit;end if;
 return jsonb_build_object('version',2,'target',v#>'{read,target}','head',v#>'{read,head}','discrepancy_head',v#>'{read,discrepancies,head}','events',rows,'next_before_version',case when more then(rows->-1->>'sequence')::integer else null end);
end $$;
create function public.native_reconciliation_summary(p_authorization_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$declare r record;v jsonb;heads jsonb:='[]';n bigint:=0;dn bigint:=0;opened bigint:=0;begin
 for r in select distinct dispense_id,pet_id from public.native_return_events where authorization_id=p_authorization_id order by dispense_id loop
  v:=public.native_reconciliation_verified(p_authorization_id,r.pet_id,r.dispense_id);if v is null then raise exception 'Reconciliation target unavailable' using errcode='23514';end if;
  n:=n+(v#>>'{read,head,version}')::bigint;dn:=dn+(v#>>'{read,discrepancies,head,version}')::bigint;opened:=opened+(v#>>'{read,discrepancies,open_case_count}')::bigint;heads:=heads||jsonb_build_array(jsonb_build_object('dispense_id',r.dispense_id,'head',v#>'{read,head}','discrepancy_head',v#>'{read,discrepancies,head}'));
 end loop;
 if greatest(n,dn,opened)>9007199254740991 then raise exception 'Reconciliation count exceeds exact bound' using errcode='23514';end if;
 return jsonb_build_object('version',2,'event_count',n,'discrepancy_event_count',dn,'open_case_count',opened,'affected_dispense_count',jsonb_array_length(heads),'heads_hash',public.native_fulfillment_hash(heads));
end $$;
create function public.native_reconciliation_disclosure(p_authorization_id uuid,p_pet_id uuid,p_dispense_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$declare v jsonb;begin
 v:=public.native_reconciliation_verified(p_authorization_id,p_pet_id,p_dispense_id);if v is null then raise exception 'Exact reconciliation target required' using errcode='23514';end if;
 if jsonb_array_length(v->'events')>100 or(v#>>'{read,discrepancies,head,version}')::integer>100 then raise exception 'More than100 reconciliation events or discrepancy decisions; use full staff history' using errcode='23514';end if;
 return jsonb_build_object('version',2,'head',v#>'{read,head}','events',v->'events','allocations',v#>'{read,allocations}','replay',v#>'{read,replay}','discrepancies',v#>'{read,discrepancies}');
end $$;
-- Preserve old receipts. Current v1 reads/writes cannot omit reconciliation facts.
alter function public.native_return_verified(uuid,uuid,uuid) rename to native_reconciliation_v1_verified;
create function public.native_return_verified(p_authorization_id uuid,p_pet_id uuid,p_dispense_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$begin
 if public.native_reconciliation_affected(p_dispense_id) then raise exception 'Return has reconciliation evidence; use version2 current APIs' using errcode='23514';end if;return public.native_reconciliation_v1_verified(p_authorization_id,p_pet_id,p_dispense_id);
end $$;
do $$declare d text;f text;begin
 foreach f in array array['record_native_dispense_return(uuid,jsonb)','recover_native_dispense_return(uuid)'] loop
  select pg_get_functiondef(('public.'||f)::regprocedure) into d;d:=replace(d,'perform public.native_return_verified(','perform public.native_reconciliation_verified(');if f='recover_native_dispense_return(uuid)' then d:=replace(d,'perform public.native_reconciliation_verified(', $guard$if o.result->'version' is distinct from '1'::jsonb then raise exception 'Use version2 receipt recovery' using errcode='23514';end if;perform public.native_reconciliation_verified($guard$);end if;execute d;
 end loop;
end $$;
create or replace function public.invalidate_native_return_release() returns trigger language plpgsql security definer set search_path=public as $$begin
 insert into public.record_release_events(id,release_id,kind,reason,created_by) select gen_random_uuid(),r.id,'source_changed','Native return reconciliation changed; review a fresh package',NEW.actor_id from public.record_releases r where r.snapshot->>'schema_version' in('10','11','12','13') and exists(select 1 from public.record_release_sources rs where rs.release_id=r.id and((rs.source_kind='native_prescription' and rs.source_id=NEW.authorization_id) or(rs.source_kind='native_dispense' and exists(select 1 from public.native_dispenses d where d.id=rs.source_id and d.authorization_id=NEW.authorization_id))));return NEW;end $$;
create trigger native_return_discrepancy_release_changed after insert on public.native_return_discrepancy_events for each row execute function public.invalidate_native_return_release();
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and(proname like 'native_reconciliation_%' or proname in('preview_native_dispense_return_v2','record_native_dispense_return_v2','recover_native_dispense_return_v2','read_native_dispense_returns_v2','read_native_return_intake_v2','list_native_dispense_returns_v2','preview_native_return_discrepancy','record_native_return_discrepancy','recover_native_return_discrepancy','native_return_verified')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in('preview_native_dispense_return_v2','record_native_dispense_return_v2','recover_native_dispense_return_v2','read_native_dispense_returns_v2','read_native_return_intake_v2','list_native_dispense_returns_v2','preview_native_return_discrepancy','record_native_return_discrepancy','recover_native_return_discrepancy') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
