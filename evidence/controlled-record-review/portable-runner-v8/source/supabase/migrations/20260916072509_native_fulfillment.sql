-- Native fulfillment is independent of administration and provider delivery.
create table public.native_fill_slots (
 id uuid primary key,authorization_id uuid not null references public.native_prescription_authorizations(id),slot_index integer not null check(slot_index between 0 and 1000),version integer not null check(version>0),
 maximum_quantity numeric(14,3) not null check(maximum_quantity>0),dispensed_quantity numeric(14,3) not null check(dispensed_quantity>0 and dispensed_quantity<=maximum_quantity),remaining_quantity numeric(14,3) not null check(remaining_quantity>=0),
 state text not null check(state in ('open','closed')),closure_kind text check(closure_kind in ('filled','forfeited')),
 opened_by uuid not null references public.profiles(id),opened_at timestamptz not null,closed_by uuid references public.profiles(id),closed_at timestamptz,close_reason text,
 unique(authorization_id,slot_index),check((state='open' and closure_kind is null and closed_by is null and closed_at is null and close_reason is null and remaining_quantity=maximum_quantity-dispensed_quantity and remaining_quantity>0) or (state='closed' and closed_by is not null and closed_at>=opened_at and remaining_quantity=0 and ((closure_kind='filled' and dispensed_quantity=maximum_quantity and close_reason is null) or (closure_kind='forfeited' and dispensed_quantity<maximum_quantity and close_reason is not null))))
);
create unique index native_one_open_fill_slot on public.native_fill_slots(authorization_id) where state='open';
create table public.native_dispenses (
 id uuid primary key,authorization_id uuid not null references public.native_prescription_authorizations(id),pet_id uuid not null references public.pets(id),slot_id uuid not null references public.native_fill_slots(id),
 invoice_id uuid not null references public.billing_invoices(id),invoice_item_id uuid not null unique references public.billing_invoice_items(id),quantity numeric(14,3) not null check(quantity>0),actor_id uuid not null references public.profiles(id),dispensed_at timestamptz not null,document jsonb not null
);
create table public.native_dispense_allocations (
 id uuid primary key,dispense_id uuid not null references public.native_dispenses(id),lot_id uuid not null references public.inventory_lots(id),movement_id uuid not null unique references public.inventory_movements(id),quantity numeric(14,3) not null check(quantity>0),unique(dispense_id,lot_id)
);
create table public.native_slot_closures (
 id uuid primary key,authorization_id uuid not null references public.native_prescription_authorizations(id),pet_id uuid not null references public.pets(id),slot_id uuid not null unique references public.native_fill_slots(id),actor_id uuid not null references public.profiles(id),created_at timestamptz not null,document jsonb not null
);
create table public.native_pickups (
 id uuid primary key,authorization_id uuid not null references public.native_prescription_authorizations(id),pet_id uuid not null references public.pets(id),dispense_id uuid not null unique references public.native_dispenses(id),actor_id uuid not null references public.profiles(id),picked_up_at timestamptz not null,document jsonb not null
);
create table public.native_fulfillment_events (
 id uuid primary key,authorization_id uuid not null references public.native_prescription_authorizations(id),version integer not null check(version>0),kind text not null check(kind in ('dispense','close_slot')),document jsonb not null,unique(authorization_id,version)
);
create table public.native_fulfillment_operations (
 id uuid primary key,actor_id uuid not null references public.profiles(id),operation text not null check(operation in ('dispense','close_slot','pickup')),request jsonb not null,request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),result jsonb not null,created_at timestamptz not null
);
create index native_dispense_history on public.native_dispenses(authorization_id,dispensed_at desc,id desc);
create index native_closure_history on public.native_slot_closures(authorization_id,created_at desc,id desc);
create index native_pickup_history on public.native_pickups(authorization_id,picked_up_at desc,id desc);
do $$declare t text;begin
 foreach t in array array['native_fill_slots','native_dispenses','native_dispense_allocations','native_slot_closures','native_pickups','native_fulfillment_events','native_fulfillment_operations'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger native_fulfillment_audit after insert or update on public.%I for each row execute function public.native_rx_audit()',t);
 if t<>'native_fill_slots' then execute format('create trigger native_fulfillment_immutable before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);end if;
 end loop;end $$;
-- Preserve slot identity and monotonic consumption even for privileged SQL callers.
create function public.native_fulfillment_guard_slot() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP='DELETE' then raise exception 'Native fill slots cannot be deleted' using errcode='23514';end if;
 if row(NEW.id,NEW.authorization_id,NEW.slot_index,NEW.maximum_quantity,NEW.opened_by,NEW.opened_at) is distinct from row(OLD.id,OLD.authorization_id,OLD.slot_index,OLD.maximum_quantity,OLD.opened_by,OLD.opened_at) then raise exception 'Native fill slot identity is immutable' using errcode='23514';end if;
 if OLD.state<>'open' or NEW.version<>OLD.version+1 or NEW.dispensed_quantity<OLD.dispensed_quantity then raise exception 'Native fill slot progression is invalid' using errcode='23514';end if;
 if NEW.dispensed_quantity=OLD.dispensed_quantity then
  if NEW.state<>'closed' or NEW.closure_kind is distinct from 'forfeited' then raise exception 'Unchanged consumption requires explicit forfeiture' using errcode='23514';end if;
 elsif ((NEW.dispensed_quantity<NEW.maximum_quantity and NEW.state='open' and NEW.closure_kind is null) or (NEW.dispensed_quantity=NEW.maximum_quantity and NEW.state='closed' and NEW.closure_kind='filled')) is not true then raise exception 'Dispensing cannot combine with forfeiture' using errcode='23514';
 end if;
 return NEW;
end $$;
create trigger native_fill_slot_progression before update or delete on public.native_fill_slots for each row execute function public.native_fulfillment_guard_slot();
revoke all on function public.native_fulfillment_guard_slot() from public,anon,authenticated,service_role;
-- Only fulfillment events gain the additive V2 projection; legacy snapshots stay exact V1.
alter table public.native_refill_events add column fulfillment_reference jsonb;
alter table public.native_refill_events drop constraint native_refill_events_action_check;
alter table public.native_refill_events add constraint native_refill_events_action_check check(action in ('create','assign','link','close','deny','dispense','pickup'));
alter table public.native_refill_events add constraint native_refill_fulfillment_reference check((action in ('dispense','pickup'))=(fulfillment_reference is not null));
create or replace function public.native_refill_event(e public.native_refill_events) returns jsonb language sql immutable set search_path=public as $$
 select jsonb_build_object('version',case when e.fulfillment_reference is null then 1 else 2 end,'id',e.id,'refill_id',e.refill_id,'revision',e.revision,'action',e.action,'actor_id',e.actor_id,'reason',e.reason,'prior_event_id',e.prior_event_id,'before',e.before_snapshot,'after',e.after_snapshot,'link_context',e.link_context,'created_at',e.created_at)||case when e.fulfillment_reference is null then '{}'::jsonb else jsonb_build_object('fulfillment_reference',e.fulfillment_reference) end;
$$;
do $$declare d text;old text:='insert into public.native_refill_events values(';begin
 select pg_get_functiondef('public.native_refill_finish(uuid,text,jsonb,jsonb,public.native_refills,text,jsonb)'::regprocedure) into d;
 if position(old in d)=0 then raise exception 'Refill finish drifted; explicit column patch requires review';end if;
 d:=replace(d,old,'insert into public.native_refill_events(id,refill_id,revision,action,actor_id,reason,prior_event_id,before_snapshot,after_snapshot,link_context,created_at) values(');execute d;
end $$;
create function public.native_fulfillment_quantity(v jsonb) returns numeric language plpgsql immutable set search_path=public as $$declare n numeric;begin
 if jsonb_typeof(v) is distinct from 'string' or v#>>'{}' !~ '^(0|[1-9][0-9]{0,10})(\.[0-9]{1,3})?$' then raise exception 'Invalid fulfillment quantity' using errcode='23514';end if;
 n:=(v#>>'{}')::numeric;if n<=0 or n>99999999999.999 then raise exception 'Invalid fulfillment quantity' using errcode='23514';end if;return n;
end $$;
create function public.native_fulfillment_index(v jsonb) returns integer language plpgsql immutable set search_path=public as $$begin
 if jsonb_typeof(v) is distinct from 'number' or v#>>'{}' !~ '^(0|[1-9][0-9]{0,3})$' or (v#>>'{}')::numeric>1000 then raise exception 'Invalid fill slot index' using errcode='23514';end if;return (v#>>'{}')::integer;end $$;
create function public.native_fulfillment_hash(v jsonb) returns text language sql immutable set search_path=public as $$select encode(sha256(convert_to(v::text,'UTF8')),'hex')$$;
create function public.native_fulfillment_decimal(n numeric) returns text language sql immutable set search_path=public as $$select to_char(n,'FM999999999999999999999999999999990.000')$$;
create function public.native_fulfillment_slot(s public.native_fill_slots) returns jsonb language sql immutable set search_path=public as $$
 select case when s.id is null then null else jsonb_build_object('id',s.id,'authorization_id',s.authorization_id,'index',s.slot_index,'version',s.version,'maximum_quantity',public.native_fulfillment_decimal(s.maximum_quantity),'dispensed_quantity',public.native_fulfillment_decimal(s.dispensed_quantity),'remaining_quantity',public.native_fulfillment_decimal(s.remaining_quantity),'state',s.state,'closure_kind',s.closure_kind,'opened_by',s.opened_by,'opened_at',s.opened_at,'closed_by',s.closed_by,'closed_at',s.closed_at,'close_reason',s.close_reason) end;
$$;
create or replace function public.native_rx_usage_context(p_authorization_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare d jsonb;s public.native_fill_slots;h public.native_fulfillment_events;used integer;disp numeric;forfeit numeric;unopened integer;stock boolean;remaining numeric;
begin
 select document into d from public.native_prescription_authorizations where id=p_authorization_id;if not found then return null;end if;
 select count(*)::integer,coalesce(sum(dispensed_quantity),0),coalesce(sum(case when closure_kind='forfeited' then maximum_quantity-dispensed_quantity else 0 end),0) into used,disp,forfeit from public.native_fill_slots where authorization_id=p_authorization_id;
 select * into s from public.native_fill_slots where authorization_id=p_authorization_id and state='open';
 select * into h from public.native_fulfillment_events where authorization_id=p_authorization_id order by version desc limit 1;
 stock:=d#>>'{artifact,fulfillment_mode}'='practice_stock';
 if stock then unopened:=(d#>>'{artifact,refills_authorized}')::integer+1-used;remaining:=unopened*(d#>>'{artifact,quantity_per_fill}')::numeric+coalesce(s.remaining_quantity,0);end if;
 return jsonb_build_object('version',2,'native_fill_accounting','implemented','dispensed_quantity',public.native_fulfillment_decimal(disp),'used_fill_slots',used,'remaining_quantity',case when stock then public.native_fulfillment_decimal(remaining) else null end,'forfeited_quantity',public.native_fulfillment_decimal(forfeit),'unopened_fill_slots',unopened,'allowance_basis',case when stock then 'native_practice_stock' else 'external_unknown' end,
 'open_slot',case when s.id is null then null else jsonb_build_object('id',s.id,'index',s.slot_index,'version',s.version,'remaining_quantity',public.native_fulfillment_decimal(s.remaining_quantity)) end,'fulfillment_head',jsonb_build_object('event_id',h.id,'version',coalesce(h.version,0)),'external_fulfillment','unknown');
end $$;
-- Stable read head never accumulates write gates across queue/history items.
create function public.native_fulfillment_head(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',a.id,'hash',a.document->>'authorization_hash','head_id',e.id,'head_version',coalesce(e.event_version,0),'state',case when e.action='cancel' then 'cancelled' when e.action='replace' then 'replaced' when (a.document#>>'{artifact,expires_on}')::date<(clock_timestamp() at time zone 'America/Denver')::date then 'expired' else 'active' end)
 from public.native_prescription_authorizations a left join lateral(select * from public.native_prescription_authorization_events where authorization_id=a.id order by event_version desc limit 1)e on true where a.id=p_id;
$$;
create function public.native_fulfillment_receipt(r public.native_fulfillment_operations) returns jsonb language sql immutable set search_path=public as $$select jsonb_build_object('version',1,'id',r.id,'actor_id',r.actor_id,'operation',r.operation,'request',r.request,'request_hash',r.request_hash,'result',r.result,'created_at',r.created_at)$$;
create function public.native_fulfillment_begin(p_id uuid,p_kind text,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$declare a uuid:=public.clinical_require_staff();r public.native_fulfillment_operations;begin
 if p_id is null or jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>65536 then raise exception 'Bounded exact fulfillment operation required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-fulfillment-operation:'||p_id::text,0));perform public.clinical_require_staff();
 select * into r from public.native_fulfillment_operations where id=p_id;if found then if r.actor_id<>a or r.operation<>p_kind or r.request is distinct from p_request then raise exception 'Fulfillment operation identity cannot change' using errcode='23514';end if;return public.native_fulfillment_receipt(r);end if;return null;
end $$;
create function public.native_fulfillment_finish(p_id uuid,p_kind text,p_request jsonb,p_result jsonb) returns jsonb language plpgsql security definer set search_path=public as $$declare a uuid:=public.clinical_require_staff();r public.native_fulfillment_operations;begin
 insert into public.native_fulfillment_operations values(p_id,a,p_kind,p_request,public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',a,'operation',p_kind,'request',p_request)),p_result,clock_timestamp()) returning * into r;return public.native_fulfillment_receipt(r);end $$;
create function public.recover_native_fulfillment_operation(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$declare a uuid:=public.clinical_require_staff();r public.native_fulfillment_operations;begin select * into r from public.native_fulfillment_operations where id=p_id and actor_id=a;if not found then return null;end if;return public.native_fulfillment_receipt(r);end $$;
create function public.native_fulfillment_review_hash(p_expected jsonb,p_actual text) returns void language plpgsql immutable set search_path=public as $$begin
 if jsonb_typeof(p_expected) is distinct from 'string' or p_expected#>>'{}' !~ '^[a-f0-9]{64}$' then raise exception 'Exact fulfillment review hash required' using errcode='23514';end if;
 if p_expected#>>'{}' is distinct from p_actual then raise exception 'Fulfillment review context changed' using errcode='40001';end if;
end $$;
create function public.native_fulfillment_refill(p_target jsonb,p_document jsonb) returns jsonb language plpgsql security definer set search_path=public as $$declare f public.native_refills;rid uuid;ev integer;head uuid;begin
 if p_target='null'::jsonb then return null;end if;
 perform public.native_rx_keys(p_target,array['id','expected_version']);rid:=public.native_rx_uuid(p_target->'id');ev:=public.native_rx_revision(p_target->'expected_version');
 select * into f from public.native_refills where id=rid for update;
 if not found or ev is null or f.version<>ev then raise exception 'Linked refill changed' using errcode='40001';end if;
 if f.state<>'open' or f.pet_id::text<>p_document->>'pet_id' or f.client_id::text<>p_document->>'client_id' or f.authorization_id::text is distinct from p_document->>'id' or f.authorization_hash is distinct from p_document->>'authorization_hash' then raise exception 'Exact current open refill authorization required' using errcode='23514';end if;
 select id into head from public.native_refill_events where refill_id=f.id and revision=f.version;
 return jsonb_build_object('refill',to_jsonb(f),'head_id',head);
end $$;
create function public.native_fulfillment_refill_event(p_context jsonb,p_operation_id uuid,p_kind text,p_dispense_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();f public.native_refills;e public.native_refill_events;begin
 if p_context is null then return null;end if;
 update public.native_refills set version=version+1,state=case when p_kind='pickup' then 'closed' else 'open' end,updated_by=a,updated_at=clock_timestamp() where id=(p_context#>>'{refill,id}')::uuid and version=(p_context#>>'{refill,version}')::integer returning * into f;
 if not found then raise exception 'Linked refill changed' using errcode='40001';end if;
 insert into public.native_refill_events(id,refill_id,revision,action,actor_id,reason,prior_event_id,before_snapshot,after_snapshot,link_context,created_at,fulfillment_reference)
 values(gen_random_uuid(),f.id,f.version,p_kind,a,p_reason,(p_context->>'head_id')::uuid,p_context->'refill',to_jsonb(f),null,clock_timestamp(),jsonb_build_object('kind',p_kind,'id',p_operation_id,'dispense_id',p_dispense_id,'authorization_id',f.authorization_id)) returning * into e;
 return public.native_refill_event(e);
end $$;
create function public.preview_native_dispense(p_target jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();aid uuid;petid uuid;iid uuid;rid uuid;idx integer;ev integer;quantity numeric;total numeric:=0;entry jsonb;last_lot uuid;lid uuid;allocation_quantity numeric;d jsonb;head jsonb;alerts jsonb;usage jsonb;refill jsonb;context jsonb;s public.native_fill_slots;previous public.native_fill_slots;p public.pets;house public.clients;inv public.billing_invoices;product public.catalog_products;lot public.inventory_lots;lots jsonb:='[]';balance numeric;items jsonb;item_total numeric;amount numeric;today date;stamp timestamptz;
begin
 perform public.native_rx_keys(p_target,array['authorization_id','pet_id','slot_index','expected_slot_version','invoice_id','quantity','allocations','refill']);
 aid:=public.native_rx_uuid(p_target->'authorization_id');petid:=public.native_rx_uuid(p_target->'pet_id');iid:=public.native_rx_uuid(p_target->'invoice_id');idx:=public.native_fulfillment_index(p_target->'slot_index');ev:=public.native_rx_revision(p_target->'expected_slot_version');quantity:=public.native_fulfillment_quantity(p_target->'quantity');
 if jsonb_typeof(p_target->'allocations') is distinct from 'array' or jsonb_array_length(p_target->'allocations') not between 1 and 100 then raise exception 'Bounded lot allocations required' using errcode='23514';end if;
 for entry in select value from jsonb_array_elements(p_target->'allocations') loop
 perform public.native_rx_keys(entry,array['lot_id','quantity']);lid:=public.native_rx_uuid(entry->'lot_id');allocation_quantity:=public.native_fulfillment_quantity(entry->'quantity');
 if last_lot is not null and lid<=last_lot then raise exception 'Sorted unique lot allocations required' using errcode='23514';end if;last_lot:=lid;total:=total+allocation_quantity;
 end loop;
 if total<>quantity then raise exception 'Lot allocations must exactly equal dispense quantity' using errcode='23514';end if;
 if p_target->'refill' is distinct from 'null'::jsonb then
 perform public.native_rx_keys(p_target->'refill',array['id','expected_version']);rid:=public.native_rx_uuid(p_target#>'{refill,id}');perform public.native_rx_revision(p_target#>'{refill,expected_version}');
 perform pg_advisory_xact_lock(hashtextextended('native-refill:'||rid::text,0));end if;
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||aid::text,0));perform public.clinical_require_staff();
 d:=public.native_rx_verified_authorization(aid);
 if d is null or d->>'pet_id'<>petid::text then raise exception 'Exact native authorization patient required' using errcode='23514';end if;
 head:=public.native_fulfillment_head(aid);
 if head->>'state'<>'active' or d#>>'{artifact,fulfillment_mode}'<>'practice_stock' then raise exception 'Active practice-stock authorization required' using errcode='23514';end if;
 select * into s from public.native_fill_slots where authorization_id=aid and slot_index=idx for update;
 usage:=public.native_rx_usage_context(aid);
 if idx>(d#>>'{artifact,refills_authorized}')::integer then raise exception 'Authorized fill slot limit exceeded' using errcode='23514';end if;
 if s.id is not null then
 if ev is null or ev<>s.version then raise exception 'Fill slot changed' using errcode='40001';end if;
 if s.state<>'open' or quantity>s.remaining_quantity then raise exception 'Open slot quantity allowance exceeded' using errcode='23514';end if;
 else
 if ev is not null or idx<>(usage->>'used_fill_slots')::integer then raise exception 'Fill slot changed' using errcode='40001';end if;
 if usage->'open_slot'<>'null'::jsonb or quantity>(d#>>'{artifact,quantity_per_fill}')::numeric then raise exception 'Previous slot must close and quantity must fit signed allowance' using errcode='23514';end if;
 if idx>0 then select * into previous from public.native_fill_slots where authorization_id=aid and slot_index=idx-1;if previous.id is null or previous.state<>'closed' then raise exception 'Closed preceding fill slot required' using errcode='23514';end if;end if;
 end if;
 alerts:=public.read_patient_treatment_alerts(petid);select * into p from public.pets where id=petid for share;
 if p.client_id::text<>d->>'client_id' or p.archived_at is not null or p.deceased_at is not null then raise exception 'Current active prescription patient and household required' using errcode='23514';end if;
 select * into house from public.clients where id=p.client_id for share;
 select * into inv from public.billing_invoices where id=iid for update;
 if not found or inv.status<>'draft' or inv.client_id<>p.client_id then raise exception 'Same-household draft invoice required' using errcode='23514';end if;
 select * into product from public.catalog_products where id=(d#>>'{context,draft,fields,product_id}')::uuid for share;
 if not found or not product.active or product.kind<>'medication' or product.unit<>d#>>'{artifact,unit}' then raise exception 'Exact active signed medication product and unit required' using errcode='23514';end if;
 perform public.native_rx_text(to_jsonb(product.name),200);
 for entry in select value from jsonb_array_elements(p_target->'allocations') loop
 lid:=(entry->>'lot_id')::uuid;allocation_quantity:=public.native_fulfillment_quantity(entry->'quantity');select * into lot from public.inventory_lots where id=lid for update;
 if not found or lot.product_id<>product.id then raise exception 'Exact signed product lot required' using errcode='23514';end if;
 select coalesce(sum(m.quantity),0) into balance from public.inventory_movements m where m.lot_id=lid;
 if balance<allocation_quantity or balance>99999999999.999 then raise exception 'Insufficient or unsupported lot balance' using errcode='23514';end if;
 perform public.native_rx_text(to_jsonb(lot.lot_number),200);perform public.native_rx_text(to_jsonb(lot.location),200);
 lots:=lots||jsonb_build_array(jsonb_build_object('id',lot.id,'product_id',lot.product_id,'lot_number',lot.lot_number,'expires_on',lot.expires_on,'location',lot.location,'balance',public.native_fulfillment_decimal(balance),'quantity',public.native_fulfillment_decimal(allocation_quantity)));
 end loop;
 -- Date is observed after every potentially blocking ledger lock.
 stamp:=clock_timestamp();today:=(stamp at time zone 'America/Denver')::date;
 if today<(d#>>'{artifact,starts_on}')::date or today>(d#>>'{artifact,expires_on}')::date or exists(select 1 from jsonb_array_elements(lots) x where (x->>'expires_on')::date<today) then raise exception 'Prescription or allocated lot is not valid on dispensing date' using errcode='23514';end if;
 select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'),coalesce(sum(i.amount_cents),0) into items,item_total from public.billing_invoice_items i where i.invoice_id=iid;
 amount:=round(quantity*product.unit_price_cents);
 if amount<0 or amount>9223372036854775807 or item_total+amount>9223372036854775807 or item_total<0 then raise exception 'Invoice money bound exceeded' using errcode='23514';end if;
 refill:=public.native_fulfillment_refill(p_target->'refill',d);perform public.clinical_require_staff();
 context:=jsonb_build_object('version',1,'target',p_target,'denver_date',today,'authorization',head,'signed_artifact',d->'artifact',
 'patient',jsonb_build_object('id',p.id,'version',p.version,'client_id',p.client_id,'archived_at',p.archived_at,'deceased_at',p.deceased_at),'household',jsonb_build_object('id',house.id,'version',house.version),'alerts',alerts,'slot',public.native_fulfillment_slot(s),'previous_slot',public.native_fulfillment_slot(previous),'usage',usage,
 'invoice',jsonb_build_object('id',inv.id,'client_id',inv.client_id,'version',inv.version,'status',inv.status,'currency',inv.currency,'existing_items_hash',public.native_fulfillment_hash(items),'existing_items_total_cents',item_total::text),
 'product',jsonb_build_object('id',product.id,'version',product.version,'active',product.active,'kind',product.kind,'name',product.name,'unit',product.unit,'unit_price_cents',product.unit_price_cents::text),'lots',lots,'refill',refill,
 'charge',jsonb_build_object('quantity',public.native_fulfillment_decimal(quantity),'unit_price_cents',product.unit_price_cents::text,'amount_cents',amount::text,'projected_invoice_total_cents',(item_total+amount)::text));
 return jsonb_build_object('version',1,'actor_id',actor,'context',context,'context_hash',public.native_fulfillment_hash(context),'observed_at',clock_timestamp());
end $$;
create function public.record_native_dispense(p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r jsonb;preview jsonb;c jsonb;target jsonb;aid uuid;petid uuid;sid uuid;iid uuid;itemid uuid:=gen_random_uuid();mid uuid;stamp timestamptz;quantity numeric;maximum numeric;next_quantity numeric;s public.native_fill_slots;entry jsonb;allocations jsonb:='[]';artifact_lots jsonb:='[]';artifact jsonb;document jsonb;refill_event jsonb;head_version integer;invoice_version integer;actor_name text;
begin
 r:=public.native_fulfillment_begin(p_id,'dispense',p_request);if r is not null then return r;end if;
 perform public.native_rx_keys(p_request,array['authorization_id','pet_id','slot_index','expected_slot_version','invoice_id','quantity','allocations','refill','expected_context_hash','reason','attest_alert_review','attest_dispense_review']);perform public.native_rx_text(p_request->'reason',2000);
 if p_request->'attest_alert_review' is distinct from 'true'::jsonb or p_request->'attest_dispense_review' is distinct from 'true'::jsonb then raise exception 'Explicit alert and dispense review required' using errcode='23514';end if;
 target:=p_request-array['expected_context_hash','reason','attest_alert_review','attest_dispense_review'];preview:=public.preview_native_dispense(target);c:=preview->'context';perform public.native_fulfillment_review_hash(p_request->'expected_context_hash',preview->>'context_hash');
 aid:=(target->>'authorization_id')::uuid;petid:=(target->>'pet_id')::uuid;iid:=(target->>'invoice_id')::uuid;quantity:=public.native_fulfillment_quantity(target->'quantity');maximum:=(c#>>'{signed_artifact,quantity_per_fill}')::numeric;
 select full_name into actor_name from public.profiles where id=actor;perform public.native_rx_text(to_jsonb(actor_name),200);
 stamp:=clock_timestamp();if (stamp at time zone 'America/Denver')::date<>(c->>'denver_date')::date then raise exception 'Dispensing date changed; review again' using errcode='40001';end if;
 if c->'slot'='null'::jsonb then
 sid:=gen_random_uuid();insert into public.native_fill_slots values(sid,aid,(target->>'slot_index')::integer,1,maximum,quantity,maximum-quantity,case when quantity=maximum then 'closed' else 'open' end,case when quantity=maximum then 'filled' else null end,actor,stamp,case when quantity=maximum then actor else null end,case when quantity=maximum then stamp else null end,null) returning * into s;
 else
 sid:=(c#>>'{slot,id}')::uuid;next_quantity:=(c#>>'{slot,dispensed_quantity}')::numeric+quantity;
 update public.native_fill_slots set version=version+1,dispensed_quantity=next_quantity,remaining_quantity=maximum-next_quantity,state=case when next_quantity=maximum then 'closed' else 'open' end,closure_kind=case when next_quantity=maximum then 'filled' else null end,closed_by=case when next_quantity=maximum then actor else null end,closed_at=case when next_quantity=maximum then stamp else null end where id=sid returning * into s;
 end if;
 for entry in select value from jsonb_array_elements(c->'lots') loop
 mid:=gen_random_uuid();insert into public.inventory_movements(id,lot_id,quantity,kind,reason,created_by) values(mid,(entry->>'id')::uuid,-(entry->>'quantity')::numeric,'dispense','Native prescription dispense '||p_id::text,actor);
 allocations:=allocations||jsonb_build_array(jsonb_build_object('lot_id',entry->'id','quantity',entry->'quantity','movement_id',mid));artifact_lots:=artifact_lots||jsonb_build_array(jsonb_build_object('id',entry->'id','number',entry->'lot_number','expires_on',entry->'expires_on','quantity',entry->'quantity'));
 end loop;
 insert into public.billing_invoice_items(id,invoice_id,pet_id,product_id,description,quantity,unit_price_cents,created_by) values(itemid,iid,petid,(c#>>'{product,id}')::uuid,c#>>'{product,name}',quantity,(c#>>'{product,unit_price_cents}')::bigint,actor);
 update public.billing_invoices set version=version+1 where id=iid returning version into invoice_version;
 refill_event:=public.native_fulfillment_refill_event(nullif(c->'refill','null'::jsonb),p_id,'dispense',p_id,p_request->>'reason');
 artifact:=jsonb_build_object('id',p_id,'authorization_id',aid,'authorization_hash',c#>'{authorization,hash}','fill_index',s.slot_index,'quantity',public.native_fulfillment_decimal(quantity),'unit',c#>'{signed_artifact,unit}','dispensed_at',stamp,'recorded_by',jsonb_build_object('user_id',actor,'name',actor_name),'invoice_id',iid,'lots',artifact_lots);
 document:=jsonb_build_object('version',1,'id',p_id,'authorization_id',aid,'authorization_hash',c#>'{authorization,hash}','pet_id',petid,'client_id',c#>'{household,id}','slot_id',sid,'slot_index',s.slot_index,'slot_version_before',target->'expected_slot_version','slot_version_after',s.version,'actor_id',actor,'quantity',public.native_fulfillment_decimal(quantity),'unit',c#>'{signed_artifact,unit}','reason',p_request->>'reason','dispensed_at',stamp,'reviewed_context',c,'reviewed_context_hash',preview->>'context_hash','allocations',allocations,'invoice_id',iid,'invoice_item_id',itemid,'invoice_version_before',c#>'{invoice,version}','invoice_version_after',invoice_version,'amount_cents',c#>'{charge,amount_cents}','refill_id',target#>'{refill,id}','refill_event_id',refill_event->'id','artifact',artifact,'artifact_hash',public.native_fulfillment_hash(artifact));
 insert into public.native_dispenses values(p_id,aid,petid,sid,iid,itemid,quantity,actor,stamp,document);
 for entry in select value from jsonb_array_elements(allocations) loop insert into public.native_dispense_allocations values(gen_random_uuid(),p_id,(entry->>'lot_id')::uuid,(entry->>'movement_id')::uuid,(entry->>'quantity')::numeric);end loop;
 head_version:=coalesce((c#>>'{usage,fulfillment_head,version}')::integer,0)+1;insert into public.native_fulfillment_events values(p_id,aid,head_version,'dispense',document);
 return public.native_fulfillment_finish(p_id,'dispense',p_request,jsonb_build_object('dispense',document,'slot',public.native_fulfillment_slot(s),'refill_event',refill_event));
end $$;
create function public.preview_native_slot_close(p_authorization_id uuid,p_pet_id uuid,p_slot_index integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();d jsonb;s public.native_fill_slots;c jsonb;begin
 if p_authorization_id is null or p_pet_id is null or p_slot_index is null or p_slot_index not between 0 and 1000 then raise exception 'Exact fill slot required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||p_authorization_id::text,0));perform public.clinical_require_staff();
 d:=public.native_rx_verified_authorization(p_authorization_id);if d is null or d->>'pet_id'<>p_pet_id::text then raise exception 'Exact native authorization patient required' using errcode='23514';end if;
 select * into s from public.native_fill_slots where authorization_id=p_authorization_id and slot_index=p_slot_index for update;
 if not found or s.state<>'open' then raise exception 'Open native fill slot required' using errcode='23514';end if;
 c:=jsonb_build_object('version',1,'authorization',public.native_fulfillment_head(p_authorization_id),'slot',public.native_fulfillment_slot(s),'usage',public.native_rx_usage_context(p_authorization_id));
 return jsonb_build_object('version',1,'actor_id',actor,'context',c,'context_hash',public.native_fulfillment_hash(c),'observed_at',clock_timestamp());
end $$;
create function public.close_native_fill_slot(p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r jsonb;preview jsonb;c jsonb;d jsonb;aid uuid;petid uuid;idx integer;ev integer;s public.native_fill_slots;stamp timestamptz;
begin
 r:=public.native_fulfillment_begin(p_id,'close_slot',p_request);if r is not null then return r;end if;
 perform public.native_rx_keys(p_request,array['authorization_id','pet_id','slot_index','expected_slot_version','expected_context_hash','reason','attest_forfeit']);
 aid:=public.native_rx_uuid(p_request->'authorization_id');petid:=public.native_rx_uuid(p_request->'pet_id');idx:=public.native_fulfillment_index(p_request->'slot_index');ev:=public.native_rx_revision(p_request->'expected_slot_version');perform public.native_rx_text(p_request->'reason',2000);
 if ev is null or p_request->'attest_forfeit' is distinct from 'true'::jsonb then raise exception 'Explicit slot forfeiture review required' using errcode='23514';end if;
 preview:=public.preview_native_slot_close(aid,petid,idx);c:=preview->'context';if ev<>(c#>>'{slot,version}')::integer then raise exception 'Fill slot changed' using errcode='40001';end if;
 perform public.native_fulfillment_review_hash(p_request->'expected_context_hash',preview->>'context_hash');stamp:=clock_timestamp();
 update public.native_fill_slots set version=version+1,remaining_quantity=0,state='closed',closure_kind='forfeited',closed_by=actor,closed_at=stamp,close_reason=p_request->>'reason' where id=(c#>>'{slot,id}')::uuid returning * into s;
 d:=jsonb_build_object('version',1,'id',p_id,'authorization_id',aid,'pet_id',petid,'slot_id',s.id,'actor_id',actor,'reason',p_request->>'reason','forfeited_quantity',c#>'{slot,remaining_quantity}','before',c->'slot','after',public.native_fulfillment_slot(s),'reviewed_context',c,'reviewed_context_hash',preview->>'context_hash','created_at',stamp);
 insert into public.native_slot_closures values(p_id,aid,petid,s.id,actor,stamp,d);
 insert into public.native_fulfillment_events values(p_id,aid,(c#>>'{usage,fulfillment_head,version}')::integer+1,'close_slot',d);
 return public.native_fulfillment_finish(p_id,'close_slot',p_request,d);
end $$;
create function public.native_fulfillment_verified_dispense(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare stored public.native_dispenses;d jsonb;a jsonb;c jsonb;actual jsonb;artifact jsonb;item public.billing_invoice_items;begin
 select * into stored from public.native_dispenses where id=p_id;if not found then return null;end if;d:=stored.document;c:=d->'reviewed_context';a:=public.native_rx_verified_authorization(stored.authorization_id);
 if a is null or d->>'id'<>stored.id::text or d->>'authorization_id'<>stored.authorization_id::text or d->>'pet_id'<>stored.pet_id::text or d->>'slot_id'<>stored.slot_id::text or d->>'invoice_id'<>stored.invoice_id::text or d->>'invoice_item_id'<>stored.invoice_item_id::text or d->>'actor_id'<>stored.actor_id::text or (d->>'dispensed_at')::timestamptz<>stored.dispensed_at or (d->>'quantity')::numeric<>stored.quantity or d->>'authorization_hash' is distinct from a->>'authorization_hash' or d->>'client_id' is distinct from a->>'client_id' or d->>'unit' is distinct from a#>>'{artifact,unit}' or d->>'reviewed_context_hash' is distinct from public.native_fulfillment_hash(c) then raise exception 'Stored native dispense identity mismatch' using errcode='23514';end if;
 select coalesce(jsonb_agg(jsonb_build_object('lot_id',x.lot_id,'quantity',public.native_fulfillment_decimal(x.quantity),'movement_id',x.movement_id) order by x.lot_id),'[]') into actual from public.native_dispense_allocations x where x.dispense_id=p_id;
 if actual is distinct from d->'allocations' or exists(select 1 from public.native_dispense_allocations x join public.inventory_movements m on m.id=x.movement_id where x.dispense_id=p_id and (m.lot_id<>x.lot_id or m.quantity<>-x.quantity or m.kind<>'dispense' or m.created_by<>stored.actor_id)) then raise exception 'Stored dispense movement linkage mismatch' using errcode='23514';end if;
 select * into item from public.billing_invoice_items where id=stored.invoice_item_id;
 if item.invoice_id<>stored.invoice_id or item.pet_id<>stored.pet_id or item.product_id::text<>c#>>'{product,id}' or item.quantity<>stored.quantity or item.amount_cents::text<>d->>'amount_cents' or item.unit_price_cents::text<>c#>>'{product,unit_price_cents}' then raise exception 'Stored dispense invoice linkage mismatch' using errcode='23514';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x->'id','number',x->'lot_number','expires_on',x->'expires_on','quantity',x->'quantity') order by x->>'id'),'[]') into actual from jsonb_array_elements(c->'lots')x;
 artifact:=jsonb_build_object('id',d->'id','authorization_id',d->'authorization_id','authorization_hash',d->'authorization_hash','fill_index',d->'slot_index','quantity',d->'quantity','unit',d->'unit','dispensed_at',d->'dispensed_at','recorded_by',jsonb_build_object('user_id',d->'actor_id','name',d#>'{artifact,recorded_by,name}'),'invoice_id',d->'invoice_id','lots',actual);
 if artifact is distinct from d->'artifact' or d->>'artifact_hash' is distinct from public.native_fulfillment_hash(artifact) then raise exception 'Stored native dispense artifact mismatch' using errcode='23514';end if;return d;
end $$;
create function public.preview_native_pickup(p_dispense_id uuid,p_pet_id uuid,p_refill_close jsonb default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();d jsonb;a jsonb;c jsonb;refill jsonb;rid uuid;existing uuid;
begin
 if p_dispense_id is null or p_pet_id is null then raise exception 'Exact dispensed patient required' using errcode='23514';end if;
 if p_refill_close is not null and p_refill_close<>'null'::jsonb then perform public.native_rx_keys(p_refill_close,array['id','expected_version','reason']);rid:=public.native_rx_uuid(p_refill_close->'id');perform public.native_rx_text(p_refill_close->'reason',2000);perform public.native_rx_revision(p_refill_close->'expected_version');perform pg_advisory_xact_lock(hashtextextended('native-refill:'||rid::text,0));end if;
 d:=public.native_fulfillment_verified_dispense(p_dispense_id);
 if d is null or d->>'pet_id'<>p_pet_id::text then raise exception 'Exact dispensed patient required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||(d->>'authorization_id'),0));perform public.clinical_require_staff();
 a:=public.native_rx_verified_authorization((d->>'authorization_id')::uuid);select id into existing from public.native_pickups where dispense_id=p_dispense_id;
 if existing is not null then raise exception 'Dispense pickup already acknowledged' using errcode='23514';end if;
 if rid is not null then
 if d->>'refill_id' is distinct from rid::text then raise exception 'Pickup can close only original linked refill' using errcode='23514';end if;
 refill:=public.native_fulfillment_refill(p_refill_close-'reason',a);
 end if;
 c:=jsonb_build_object('version',1,'authorization',public.native_fulfillment_head((d->>'authorization_id')::uuid),'dispense',d,'existing_pickup_id',existing,'refill',refill);
 return jsonb_build_object('version',1,'actor_id',actor,'context',c,'context_hash',public.native_fulfillment_hash(c),'observed_at',clock_timestamp());
end $$;
create function public.record_native_pickup(p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r jsonb;preview jsonb;c jsonb;d jsonb;aid uuid;petid uuid;did uuid;stamp timestamptz;refill_event jsonb;
begin
 r:=public.native_fulfillment_begin(p_id,'pickup',p_request);if r is not null then return r;end if;
 perform public.native_rx_keys(p_request,array['authorization_id','pet_id','dispense_id','expected_context_hash','recipient_name','recipient_relationship','reason','attest_handoff','refill_close']);
 aid:=public.native_rx_uuid(p_request->'authorization_id');petid:=public.native_rx_uuid(p_request->'pet_id');did:=public.native_rx_uuid(p_request->'dispense_id');perform public.native_rx_text(p_request->'recipient_name',200);perform public.native_rx_text(p_request->'recipient_relationship',200);perform public.native_rx_text(p_request->'reason',2000);
 if p_request->'attest_handoff' is distinct from 'true'::jsonb then raise exception 'Explicit handoff acknowledgement required' using errcode='23514';end if;
 preview:=public.preview_native_pickup(did,petid,p_request->'refill_close');c:=preview->'context';
 if c#>>'{authorization,id}'<>aid::text then raise exception 'Exact pickup authorization required' using errcode='23514';end if;
 perform public.native_fulfillment_review_hash(p_request->'expected_context_hash',preview->>'context_hash');stamp:=clock_timestamp();
 refill_event:=public.native_fulfillment_refill_event(nullif(c->'refill','null'::jsonb),p_id,'pickup',did,p_request#>>'{refill_close,reason}');
 d:=jsonb_build_object('version',1,'id',p_id,'authorization_id',aid,'pet_id',petid,'dispense_id',did,'actor_id',actor,'recipient_name',p_request->>'recipient_name','recipient_relationship',p_request->>'recipient_relationship','reason',p_request->>'reason','reviewed_context',c,'reviewed_context_hash',preview->>'context_hash','refill_id',p_request#>'{refill_close,id}','refill_event_id',refill_event->'id','picked_up_at',stamp);
 insert into public.native_pickups values(p_id,aid,petid,did,actor,stamp,d);
 return public.native_fulfillment_finish(p_id,'pickup',p_request,d);
end $$;
create function public.read_native_fulfillment(p_authorization_id uuid,p_pet_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare d jsonb;s public.native_fill_slots;begin perform public.clinical_require_staff();d:=public.native_rx_verified_authorization(p_authorization_id);if d is null or p_pet_id is null or d->>'pet_id'<>p_pet_id::text then return null;end if;
 select * into s from public.native_fill_slots where authorization_id=p_authorization_id and state='open';return jsonb_build_object('version',1,'authorization',public.native_fulfillment_head(p_authorization_id),'usage',public.native_rx_usage_context(p_authorization_id),'open_slot',public.native_fulfillment_slot(s));
end $$;
create function public.list_native_fill_slots(p_authorization_id uuid,p_pet_id uuid,p_after_index integer default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r jsonb;begin perform public.clinical_require_staff();
 if not exists(select 1 from public.native_prescription_authorizations where id=p_authorization_id and pet_id=p_pet_id) then raise exception 'Exact native authorization patient required' using errcode='23514';end if;
 if (p_after_index is not null and p_after_index not between 0 and 1000) or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid fill slot cursor' using errcode='23514';end if;
 with bounded as materialized(select * from public.native_fill_slots where authorization_id=p_authorization_id and (p_after_index is null or slot_index>p_after_index) order by slot_index limit p_limit+1),selected as(select * from bounded order by slot_index limit p_limit)
 select jsonb_build_object('version',1,'authorization_id',p_authorization_id,'pet_id',p_pet_id,'slots',(select coalesce(jsonb_agg(public.native_fulfillment_slot(s) order by slot_index),'[]') from selected s),'has_more',(select count(*)>p_limit from bounded),'next_index',case when (select count(*)>p_limit from bounded) then(select max(slot_index) from selected) else null end) into r;return r;
end $$;
create function public.native_fulfillment_history(p_kind text,p_authorization_id uuid,p_pet_id uuid,p_before_at timestamptz,p_before_id uuid,p_limit integer) returns jsonb language plpgsql stable security definer set search_path=public as $$declare r jsonb;begin
 perform public.clinical_require_staff();perform public.native_refill_cursor(p_before_at,p_before_id,p_limit);
 if p_kind not in ('dispenses','closures','pickups') or not exists(select 1 from public.native_prescription_authorizations where id=p_authorization_id and pet_id=p_pet_id) then raise exception 'Exact native fulfillment history required' using errcode='23514';end if;
 with source as(select id,dispensed_at stamp,document from public.native_dispenses where p_kind='dispenses' and authorization_id=p_authorization_id union all select id,created_at,document from public.native_slot_closures where p_kind='closures' and authorization_id=p_authorization_id union all select id,picked_up_at,document from public.native_pickups where p_kind='pickups' and authorization_id=p_authorization_id),
 bounded as materialized(select * from source where p_before_at is null or (stamp,id)<(p_before_at,p_before_id) order by stamp desc,id desc limit p_limit+1),selected as(select * from bounded order by stamp desc,id desc limit p_limit)
 select jsonb_build_object('version',1,'authorization_id',p_authorization_id,'pet_id',p_pet_id,p_kind,(select coalesce(jsonb_agg(case when p_kind='dispenses' then public.native_fulfillment_verified_dispense(id) else document end order by stamp desc,id desc),'[]') from selected),'has_more',(select count(*)>p_limit from bounded),'next_cursor',case when(select count(*)>p_limit from bounded) then(select jsonb_build_object('before_at',stamp,'before_id',id) from selected order by stamp,id limit 1) else null end) into r;return r;
end $$;
create function public.list_native_dispenses(p_authorization_id uuid,p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language sql stable security definer set search_path=public as $$select public.native_fulfillment_history('dispenses',p_authorization_id,p_pet_id,p_before_at,p_before_id,p_limit)$$;
create function public.list_native_slot_closures(p_authorization_id uuid,p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language sql stable security definer set search_path=public as $$select public.native_fulfillment_history('closures',p_authorization_id,p_pet_id,p_before_at,p_before_id,p_limit)$$;
create function public.list_native_pickups(p_authorization_id uuid,p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language sql stable security definer set search_path=public as $$select public.native_fulfillment_history('pickups',p_authorization_id,p_pet_id,p_before_at,p_before_id,p_limit)$$;
create or replace function public.read_native_prescription_print(p_authorization_id uuid,p_dispense_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare d jsonb;s jsonb;fill jsonb;begin perform public.clinical_require_staff();
 d:=public.native_rx_verified_authorization(p_authorization_id);if d is null then raise exception 'Exact native authorization required' using errcode='23514';end if;
 s:=public.read_native_prescription_status(p_authorization_id,(d->>'pet_id')::uuid);
 if p_dispense_id is not null then fill:=public.native_fulfillment_verified_dispense(p_dispense_id);if fill is null or fill->>'authorization_id'<>p_authorization_id::text or fill->>'authorization_hash' is distinct from d->>'authorization_hash' or fill->>'pet_id' is distinct from d->>'pet_id' then raise exception 'Exact native authorization dispense required' using errcode='23514';end if;end if;
 return jsonb_build_object('prescription',d->'artifact','status',s->'status','dispense',fill->'artifact');
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and (proname like 'native_fulfillment_%' or proname in ('native_rx_usage_context','native_refill_event','native_refill_finish','preview_native_dispense','record_native_dispense','preview_native_slot_close','close_native_fill_slot','preview_native_pickup','record_native_pickup','recover_native_fulfillment_operation','read_native_fulfillment','list_native_fill_slots','list_native_dispenses','list_native_slot_closures','list_native_pickups','read_native_prescription_print')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.proname not like 'native_fulfillment_%' and f.proname not in ('native_rx_usage_context','native_refill_event','native_refill_finish') then execute format('grant execute on function %s to authenticated',f.signature);end if;end loop;
end $$;
