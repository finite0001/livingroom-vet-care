-- Native attributable physical custody. No allowance, financial or refill mutation.
create table public.native_return_policy_decisions (
 id uuid primary key,version integer not null unique check(version>0),actor_id uuid not null references public.profiles(id),request jsonb not null,request_hash text not null,document jsonb not null,created_at timestamptz not null
);
create table public.native_return_policy_state(id boolean primary key default true check(id),version integer not null check(version>=0),decision_id uuid references public.native_return_policy_decisions(id),check((version=0)=(decision_id is null)));
insert into public.native_return_policy_state values(true,0,null);
create table public.native_return_events (
 id uuid primary key,authorization_id uuid not null references public.native_prescription_authorizations(id),pet_id uuid not null references public.pets(id),dispense_id uuid not null references public.native_dispenses(id),sequence integer not null check(sequence>0),prior_event_id uuid unique references public.native_return_events(id),actor_id uuid not null references public.profiles(id),action text not null check(action in('intake','dispose','restock')),intake_id uuid references public.native_return_events(id),created_at timestamptz not null,record_hash text not null,reviewed_context jsonb not null,document jsonb not null,
 unique(dispense_id,sequence),check((sequence=1)=(prior_event_id is null)),check((action='intake')=(intake_id is null))
);
create unique index native_return_root on public.native_return_events(dispense_id) where prior_event_id is null;
create index native_return_authorization on public.native_return_events(authorization_id,dispense_id,sequence);
create table public.native_return_operations(id uuid primary key references public.native_return_events(id),actor_id uuid not null references public.profiles(id),request jsonb not null,request_hash text not null,result jsonb not null,created_at timestamptz not null);
create table public.native_return_stock_links(id uuid primary key,event_id uuid not null references public.native_return_events(id),allocation_id uuid not null references public.native_dispense_allocations(id),lot_id uuid not null references public.inventory_lots(id),movement_id uuid not null unique references public.inventory_movements(id),quantity numeric(14,3) not null check(quantity>0),unique(event_id,allocation_id));
do $$declare t text;begin
 foreach t in array array['native_return_policy_decisions','native_return_events','native_return_operations','native_return_stock_links'] loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger native_return_immutable before update or delete on public.%I for each row execute function public.native_correction_immutable()',t);
  execute format('create trigger native_return_no_truncate before truncate on public.%I for each statement execute function public.native_correction_immutable()',t);
  execute format('create trigger native_return_audit after insert on public.%I for each row execute function public.native_rx_audit()',t);
 end loop;
end $$;
alter table public.native_return_policy_state enable row level security;
revoke all on public.native_return_policy_state from public,anon,authenticated,service_role;
alter table public.inventory_movements drop constraint inventory_movements_kind_check;
alter table public.inventory_movements add constraint inventory_movements_kind_check check(kind in('receive','adjust','dispense','native_return'));
alter table public.inventory_movements add constraint native_return_positive check(kind<>'native_return' or quantity>0);
do $$declare d text;needle text:='else NEW.created_by:=actor; NEW.created_at:=now();';begin
 select pg_get_functiondef('public.inventory_guard()'::regprocedure) into d;
 if position(needle in d)=0 then raise exception 'Expected inventory timestamp guard missing';end if;
 execute replace(d,needle,'else NEW.created_by:=actor; if TG_TABLE_NAME=''inventory_movements'' and to_jsonb(NEW)->>''kind''=''native_return'' then if NEW.created_at is null or not isfinite(NEW.created_at) then raise exception ''Return movement time required'' using errcode=''23514'';end if; else NEW.created_at:=now();end if;');
end $$;
create function public.native_return_verify_stock_link() returns trigger language plpgsql security definer set search_path=public as $$
declare l public.native_return_stock_links;e public.native_return_events;n integer;begin
 if NEW.kind<>'native_return' then return NEW;end if;
 select count(*) into n from public.native_return_stock_links where movement_id=NEW.id;
 select * into l from public.native_return_stock_links where movement_id=NEW.id;select * into e from public.native_return_events where id=l.event_id;
 if n<>1 or e.action is distinct from 'restock' or l.lot_id<>NEW.lot_id or l.quantity<>NEW.quantity or e.actor_id<>NEW.created_by or e.created_at is distinct from NEW.created_at
 or not exists(select 1 from public.native_dispense_allocations a where a.id=l.allocation_id and a.dispense_id=e.dispense_id and a.lot_id=l.lot_id)
 or (select count(*) from jsonb_array_elements(e.document->'allocations') x where x->>'allocation_id'=l.allocation_id::text and x->>'lot_id'=l.lot_id::text and x->>'movement_id'=NEW.id::text and (x->>'quantity')::numeric=l.quantity)<>1
 then raise exception 'Native return stock linkage mismatch' using errcode='23514';end if;return NEW;
end $$;
create constraint trigger native_return_link_required after insert on public.inventory_movements deferrable initially deferred for each row execute function public.native_return_verify_stock_link();
create function public.native_return_policy_verified(p_version integer default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare d public.native_return_policy_decisions;s public.native_return_policy_state;v integer;begin
 select * into s from public.native_return_policy_state where id;v:=coalesce(p_version,s.version);
 if v=0 then return jsonb_build_object('version',0,'enabled',false,'review_reference',null,'actor_id',null,'actor_name',null,'reviewed_at',null,'record_hash',null);end if;
 select * into d from public.native_return_policy_decisions where version=v;
 if d.id is null or (p_version is null and d.id is distinct from s.decision_id) or d.document->'version' is distinct from to_jsonb(v) or d.document->>'actor_id' is distinct from d.actor_id::text or (d.document->>'reviewed_at')::timestamptz is distinct from d.created_at
 or d.document->>'record_hash' is distinct from public.native_fulfillment_hash(d.document-'record_hash')
 or d.request_hash is distinct from public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',d.actor_id,'operation','configure_native_return_policy','request',d.request))
 or d.request->'enabled' is distinct from d.document->'enabled' or d.request->'review_reference' is distinct from d.document->'review_reference' or d.request->'attest_review' is distinct from 'true'::jsonb or (d.request->>'expected_version')::integer<>v-1
 then raise exception 'Native return policy integrity mismatch' using errcode='23514';end if;
 perform public.native_rx_keys(d.document,array['version','enabled','review_reference','actor_id','actor_name','reviewed_at','record_hash']);return d.document;
end $$;
create function public.native_return_policy_receipt(d public.native_return_policy_decisions) returns jsonb language sql immutable set search_path=public as $$select jsonb_build_object('version',1,'id',d.id,'actor_id',d.actor_id,'request',d.request,'request_hash',d.request_hash,'result',d.document,'created_at',d.created_at)$$;
create function public.read_native_return_policy() returns jsonb language plpgsql stable security definer set search_path=public as $$begin perform public.clinical_require_staff();return public.native_return_policy_verified();end $$;
create function public.configure_native_return_policy(p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();actor jsonb;d public.native_return_policy_decisions;s public.native_return_policy_state;doc jsonb;stamp timestamptz;begin
 if p_id is null then raise exception 'Stable policy ID required' using errcode='23514';end if;
 perform public.native_rx_keys(p_request,array['expected_version','enabled','review_reference','attest_review']);perform public.native_rx_text(p_request->'review_reference',2000);
 if jsonb_typeof(p_request->'expected_version') is distinct from 'number' or p_request->>'expected_version' !~ '^(0|[1-9][0-9]{0,9})$' or (p_request->>'expected_version')::numeric>2147483646 or jsonb_typeof(p_request->'enabled') is distinct from 'boolean' or p_request->'attest_review' is distinct from 'true'::jsonb then raise exception 'Exact policy review required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-return-policy-operation:'||p_id::text,0));perform public.clinical_require_staff();
 select * into d from public.native_return_policy_decisions where id=p_id;if found then
  if d.actor_id<>a or d.request is distinct from p_request then raise exception 'Policy identifier already used' using errcode='23514';end if;
  perform public.native_return_policy_verified(d.version);perform public.clinical_require_staff();return public.native_return_policy_receipt(d);
 end if;
 select * into s from public.native_return_policy_state where id for update;
 perform public.native_rx_require_admin();actor:=public.native_correction_actor('clinical_annotation');
 if s.version<>(p_request->>'expected_version')::integer then raise exception 'Return policy changed' using errcode='40001';end if;
 stamp:=clock_timestamp();doc:=jsonb_build_object('version',s.version+1,'enabled',p_request->'enabled','review_reference',p_request->'review_reference','actor_id',a,'actor_name',actor->'name','reviewed_at',stamp);doc:=doc||jsonb_build_object('record_hash',public.native_fulfillment_hash(doc));
 insert into public.native_return_policy_decisions values(p_id,s.version+1,a,p_request,public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',a,'operation','configure_native_return_policy','request',p_request)),doc,stamp) returning * into d;
 update public.native_return_policy_state set version=d.version,decision_id=p_id where id;
 perform public.native_rx_require_admin();perform public.native_correction_actor('clinical_annotation');return public.native_return_policy_receipt(d);
end $$;
create function public.recover_native_return_policy(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$declare a uuid:=public.clinical_require_staff();d public.native_return_policy_decisions;begin
 select * into d from public.native_return_policy_decisions where id=p_id;if not found then return null;end if;if d.actor_id<>a then raise exception 'Return policy receipt unavailable' using errcode='42501';end if;perform public.native_return_policy_verified(d.version);return public.native_return_policy_receipt(d);end $$;
create function public.native_return_validate_intent(v jsonb) returns void language plpgsql immutable set search_path=public as $$declare x jsonb;prior uuid;u uuid;begin
 perform public.native_rx_keys(v,array['target','action','intake_id','allocations','custody','package_condition','storage_history','reason','note']);perform public.native_rx_keys(v->'target',array['authorization_id','pet_id','dispense_id']);
 perform public.native_correction_uuid(v#>'{target,authorization_id}');perform public.native_correction_uuid(v#>'{target,pet_id}');perform public.native_correction_uuid(v#>'{target,dispense_id}');perform public.native_correction_uuid(v->'intake_id',true);
 perform public.native_rx_text(v->'reason',2000);perform public.native_rx_text(v->'note',4000);
 if v->>'action' is null or v->>'action' not in('intake','dispose','restock') then raise exception 'Return action required' using errcode='23514';end if;
 if v->>'action'='intake' then
  if v->'intake_id' is distinct from 'null'::jsonb or v->>'custody' is null or v->>'custody' not in('clinic_retained','client_returned','unknown') or v->>'package_condition' is null or v->>'package_condition' not in('sealed_intact','opened','damaged','unknown') or v->>'storage_history' is null or v->>'storage_history' not in('controlled','compromised','unknown') then raise exception 'Explicit return custody condition and storage required' using errcode='23514';end if;
 else
  if v->'intake_id'='null'::jsonb or v->'custody' is distinct from 'null'::jsonb or v->'package_condition' is distinct from 'null'::jsonb or v->'storage_history' is distinct from 'null'::jsonb then raise exception 'Disposition requires immutable intake facts' using errcode='23514';end if;
 end if;
 if jsonb_typeof(v->'allocations') is distinct from 'array' or jsonb_array_length(v->'allocations') not between 1 and 100 then raise exception 'Select1 to100 original allocations' using errcode='23514';end if;
 for x in select value from jsonb_array_elements(v->'allocations') loop
  perform public.native_rx_keys(x,array['allocation_id','quantity']);u:=public.native_correction_uuid(x->'allocation_id');perform public.native_fulfillment_quantity(x->'quantity');
  if prior is not null and u<=prior then raise exception 'Sorted unique original allocations required' using errcode='23514';end if;prior:=u;
 end loop;
end $$;
create function public.native_return_balances(p_dispense_id uuid,p_before integer default null) returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('allocation_id',a.id,'lot_id',a.lot_id,'lot_number',l.lot_number,'expires_on',l.expires_on,'dispensed_quantity',public.native_fulfillment_decimal(a.quantity),'returned_quantity',public.native_fulfillment_decimal(t.received),'remaining_returnable_quantity',public.native_fulfillment_decimal(a.quantity-t.received),'held_quantity',public.native_fulfillment_decimal(t.received-t.disposed-t.restocked),'disposed_quantity',public.native_fulfillment_decimal(t.disposed),'restocked_quantity',public.native_fulfillment_decimal(t.restocked)) order by a.id),'[]')
 from public.native_dispense_allocations a join public.inventory_lots l on l.id=a.lot_id cross join lateral(
 select coalesce(sum((x->>'quantity')::numeric) filter(where e.action='intake'),0) received,coalesce(sum((x->>'quantity')::numeric) filter(where e.action='dispose'),0) disposed,coalesce(sum((x->>'quantity')::numeric) filter(where e.action='restock'),0) restocked
 from public.native_return_events e cross join lateral jsonb_array_elements(e.document->'allocations') x where e.dispense_id=a.dispense_id and x->>'allocation_id'=a.id::text and(p_before is null or e.sequence<p_before))t where a.dispense_id=p_dispense_id;
$$;
create function public.native_return_intake_balance(p_intake_id uuid,p_before integer default null) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',i.id,'sequence',i.sequence,'custody',i.document->'custody','package_condition',i.document->'package_condition','storage_history',i.document->'storage_history','allocations',
 (select jsonb_agg(jsonb_build_object('allocation_id',x->'allocation_id','lot_id',x->'lot_id','quantity',x->'quantity','held_quantity',public.native_fulfillment_decimal((x->>'quantity')::numeric-t.disposed-t.restocked),'disposed_quantity',public.native_fulfillment_decimal(t.disposed),'restocked_quantity',public.native_fulfillment_decimal(t.restocked)) order by x->>'allocation_id') from jsonb_array_elements(i.document->'allocations')x cross join lateral(
 select coalesce(sum((y->>'quantity')::numeric) filter(where e.action='dispose'),0) disposed,coalesce(sum((y->>'quantity')::numeric) filter(where e.action='restock'),0) restocked from public.native_return_events e cross join lateral jsonb_array_elements(e.document->'allocations')y where e.intake_id=i.id and y->>'allocation_id'=x->>'allocation_id' and(p_before is null or e.sequence<p_before))t))
 from public.native_return_events i where i.id=p_intake_id and i.action='intake' and(p_before is null or i.sequence<p_before);
$$;
create function public.native_return_verified(p_authorization_id uuid,p_pet_id uuid,p_dispense_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare d jsonb;target jsonb;head jsonb:=jsonb_build_object('event_id',null,'version',0,'record_hash',null);events jsonb:='[]';e public.native_return_events;o public.native_return_operations;v jsonb;c jsonb;intent jsonb;x jsonb;b jsonb;i jsonb;balances jsonb;prev timestamptz;orig public.native_dispense_allocations;m public.inventory_movements;link public.native_return_stock_links;expected jsonb;corrections jsonb;
begin
 d:=public.native_fulfillment_verified_dispense(p_dispense_id);
 if d is null or p_authorization_id is null or p_pet_id is null or d->>'authorization_id' is distinct from p_authorization_id::text or d->>'pet_id' is distinct from p_pet_id::text then return null;end if;
 target:=jsonb_build_object('authorization_id',p_authorization_id,'pet_id',p_pet_id,'dispense_id',p_dispense_id);corrections:=public.native_correction_verified(p_authorization_id,p_pet_id,p_dispense_id);
 for e in select * from public.native_return_events where dispense_id=p_dispense_id order by sequence loop
  v:=e.document;c:=e.reviewed_context;select * into o from public.native_return_operations where id=e.id;intent:=o.request->'intent';
  perform public.native_return_validate_intent(intent);
  perform public.native_rx_keys(v,array['version','id','target','authorization_hash','dispense_document_hash','sequence','prior_event_id','prior_record_hash','actor','action','intake_id','allocations','custody','package_condition','storage_history','reason','note','policy','reviewed_context_hash','created_at','record_hash']);
  balances:=public.native_return_balances(p_dispense_id,e.sequence);i:=public.native_return_intake_balance(e.intake_id,e.sequence);
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
 return jsonb_build_object('read',jsonb_build_object('version',1,'target',target,'authorization_hash',d->'authorization_hash','dispense_document_hash',public.native_fulfillment_hash(d),'dispensed_at',d->'dispensed_at','head',head,'allocations',public.native_return_balances(p_dispense_id)),'events',events);
end $$;
create function public.preview_native_dispense_return(p_intent jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();aid uuid;pet uuid;did uuid;v jsonb;r jsonb;d jsonb;i jsonb;policy jsonb;stock jsonb;lots jsonb:='[]';blockers jsonb:='[]';product public.catalog_products;lot public.inventory_lots;x jsonb;b jsonb;ctx jsonb;correction jsonb;practice date;begin
 perform public.native_return_validate_intent(p_intent);aid:=(p_intent#>>'{target,authorization_id}')::uuid;pet:=(p_intent#>>'{target,pet_id}')::uuid;did:=(p_intent#>>'{target,dispense_id}')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||aid::text,0));perform public.clinical_require_staff();
 v:=public.native_return_verified(aid,pet,did);if v is null then raise exception 'Exact native return target required' using errcode='23514';end if;r:=v->'read';d:=public.native_fulfillment_verified_dispense(did);correction:=public.native_correction_verified(aid,pet,did);
 if p_intent->>'action'<>'intake' then
  i:=public.native_return_intake_balance((p_intent->>'intake_id')::uuid);
  if i is null or not exists(select 1 from public.native_return_events where id=(p_intent->>'intake_id')::uuid and dispense_id=did and action='intake') then raise exception 'Exact prior return intake required' using errcode='23514';end if;
 end if;
 for x in select value from jsonb_array_elements(p_intent->'allocations') loop
  select value into b from jsonb_array_elements(r->'allocations') where value->>'allocation_id'=x->>'allocation_id';
  if b is null then raise exception 'Exact original dispense allocation required' using errcode='23514';end if;
  if p_intent->>'action'='intake' then
   if public.native_fulfillment_quantity(x->'quantity')>(b->>'remaining_returnable_quantity')::numeric then raise exception 'Return exceeds original allocation remainder' using errcode='23514';end if;
  elsif not exists(select 1 from jsonb_array_elements(i->'allocations') z where z->>'allocation_id'=x->>'allocation_id' and (z->>'held_quantity')::numeric>=public.native_fulfillment_quantity(x->'quantity')) then raise exception 'Disposition exceeds intake held remainder' using errcode='23514';end if;
 end loop;
 if p_intent->>'action'='restock' then
  perform 1 from public.native_return_policy_state where id for share;policy:=public.native_return_policy_verified();
  select * into product from public.catalog_products where id=(d#>>'{reviewed_context,product,id}')::uuid for share;
  if product.id is null then raise exception 'Original return product unavailable' using errcode='23514';end if;
  for lot in select l.* from public.inventory_lots l join public.native_dispense_allocations da on da.lot_id=l.id where da.dispense_id=did and da.id in(select (z->>'allocation_id')::uuid from jsonb_array_elements(p_intent->'allocations')z) order by l.id for update of l loop
   if lot.product_id<>product.id then raise exception 'Original lot product identity changed' using errcode='23514';end if;
   lots:=lots||jsonb_build_array(jsonb_build_object('lot_id',lot.id,'balance',public.native_fulfillment_decimal((select coalesce(sum(quantity),0) from public.inventory_movements where lot_id=lot.id))));
  end loop;
  practice:=(clock_timestamp() at time zone 'America/Denver')::date;
  if policy->'enabled' is distinct from 'true'::jsonb then blockers:=blockers||'"policy_disabled"'::jsonb;end if;
  if not exists(select 1 from public.user_roles where user_id=a and role='DVM') then blockers:=blockers||'"dvm_required"'::jsonb;end if;
  if i->>'custody'<>'clinic_retained' then blockers:=blockers||'"custody_not_retained"'::jsonb;end if;
  if i->>'package_condition'<>'sealed_intact' then blockers:=blockers||'"package_not_sealed"'::jsonb;end if;
  if i->>'storage_history'<>'controlled' then blockers:=blockers||'"storage_not_controlled"'::jsonb;end if;
  if correction#>'{context,original_pickup}' is distinct from 'null'::jsonb then blockers:=blockers||'"original_pickup_exists"'::jsonb;end if;
  if not product.active then blockers:=blockers||'"product_inactive"'::jsonb;end if;
  if product.unit<>d->>'unit' then blockers:=blockers||'"unit_changed"'::jsonb;end if;
  if exists(select 1 from jsonb_array_elements(r->'allocations') z where (z->>'expires_on')::date<practice and z->>'allocation_id' in(select w->>'allocation_id' from jsonb_array_elements(p_intent->'allocations')w)) then blockers:=blockers||'"lot_expired"'::jsonb;end if;
  stock:=jsonb_build_object('product',jsonb_build_object('id',product.id,'name',product.name,'unit',product.unit,'active',product.active,'version',product.version),'lots',lots,'practice_date',practice);
 end if;
 ctx:=jsonb_build_object('version',1,'target',r->'target','authorization_hash',r->'authorization_hash','dispense_document_hash',r->'dispense_document_hash','dispensed_at',r->'dispensed_at','head',r->'head','original_pickup',correction#>'{context,original_pickup}','correction_head',correction#>'{context,head}','allocations',r->'allocations','intake',i,'stock_review',stock,'policy',policy,'intent',p_intent);
 perform public.clinical_require_staff();return jsonb_build_object('version',1,'actor_id',a,'observed_at',clock_timestamp(),'context',ctx,'context_hash',public.native_fulfillment_hash(ctx),'allowed',jsonb_array_length(blockers)=0,'blockers',blockers);
end $$;
create function public.native_return_receipt(o public.native_return_operations) returns jsonb language sql immutable set search_path=public as $$select jsonb_build_object('version',1,'id',o.id,'actor_id',o.actor_id,'request',o.request,'request_hash',o.request_hash,'result',o.result,'created_at',o.created_at)$$;
create function public.record_native_dispense_return(p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();o public.native_return_operations;intent jsonb;preview jsonb;c jsonb;head jsonb;doc jsonb;actor jsonb;aid uuid;pet uuid;did uuid;action text;stamp timestamptz;x jsonb;alloc public.native_dispense_allocations;mid uuid;lines jsonb:='[]';n numeric;begin
 if p_id is null then raise exception 'Stable return ID required' using errcode='23514';end if;
 perform public.native_rx_keys(p_request,array['intent','expected_context_hash','expected_head','attest_review','attest_restock']);intent:=p_request->'intent';perform public.native_return_validate_intent(intent);action:=intent->>'action';
 perform public.native_rx_keys(p_request->'expected_head',array['event_id','version','record_hash']);perform public.native_correction_uuid(p_request#>'{expected_head,event_id}',true);
 if p_request->'attest_review' is distinct from 'true'::jsonb or p_request->'attest_restock' is distinct from to_jsonb(action='restock') or jsonb_typeof(p_request->'expected_context_hash') is distinct from 'string' or p_request->>'expected_context_hash' !~ '^[a-f0-9]{64}$' then raise exception 'Explicit reviewed return attestations required' using errcode='23514';end if;
 aid:=(intent#>>'{target,authorization_id}')::uuid;pet:=(intent#>>'{target,pet_id}')::uuid;did:=(intent#>>'{target,dispense_id}')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('native-return-operation:'||p_id::text,0));perform public.clinical_require_staff();
 select * into o from public.native_return_operations where id=p_id;if found then
  if o.actor_id<>a or o.request is distinct from p_request then raise exception 'Return identifier already used' using errcode='23514';end if;
  perform public.native_return_verified(aid,pet,did);perform public.clinical_require_staff();return public.native_return_receipt(o);
 end if;
 preview:=public.preview_native_dispense_return(intent);c:=preview->'context';head:=c->'head';
 if p_request->>'expected_context_hash' is distinct from preview->>'context_hash' or p_request->'expected_head' is distinct from head then raise exception 'Return review context changed' using errcode='40001';end if;
 if preview->'allowed' is distinct from 'true'::jsonb then raise exception 'Restock is blocked by reviewed safeguards' using errcode='42501';end if;
 actor:=public.native_correction_actor(case when action='restock' then 'clinical_annotation' else 'operational_annotation' end);
 if (head->>'version')::integer=2147483647 then raise exception 'Return history version exhausted' using errcode='23514';end if;
 stamp:=clock_timestamp();
 if stamp<(c->>'dispensed_at')::timestamptz or exists(select 1 from public.native_return_events where dispense_id=did and created_at>stamp) then raise exception 'Return observation clock moved backwards' using errcode='40001';end if;
 if action='restock' and (c#>>'{policy,reviewed_at}')::timestamptz>stamp then raise exception 'Return observation clock moved backwards' using errcode='40001';end if;
 if action='restock' and c#>>'{stock_review,practice_date}' is distinct from (stamp at time zone 'America/Denver')::date::text then raise exception 'Return practice date changed' using errcode='40001';end if;
 for x in select value from jsonb_array_elements(intent->'allocations') loop
  select * into alloc from public.native_dispense_allocations where id=(x->>'allocation_id')::uuid and dispense_id=did;n:=public.native_fulfillment_quantity(x->'quantity');mid:=null;
  if action='restock' then mid:=gen_random_uuid();insert into public.inventory_movements(id,lot_id,quantity,kind,reason,created_by,created_at) values(mid,alloc.lot_id,n,'native_return',intent->>'reason',a,stamp);end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('allocation_id',alloc.id,'lot_id',alloc.lot_id,'quantity',public.native_fulfillment_decimal(n),'movement_id',mid));
 end loop;
 doc:=jsonb_build_object('version',1,'id',p_id,'target',c->'target','authorization_hash',c->'authorization_hash','dispense_document_hash',c->'dispense_document_hash','sequence',(head->>'version')::integer+1,'prior_event_id',head->'event_id','prior_record_hash',head->'record_hash','actor',actor,'action',action,'intake_id',intent->'intake_id','allocations',lines,'custody',intent->'custody','package_condition',intent->'package_condition','storage_history',intent->'storage_history','reason',intent->'reason','note',intent->'note','policy',c->'policy','reviewed_context_hash',preview->'context_hash','created_at',stamp);
 doc:=doc||jsonb_build_object('record_hash',public.native_fulfillment_hash(doc));
 insert into public.native_return_events values(p_id,aid,pet,did,(head->>'version')::integer+1,(head->>'event_id')::uuid,a,action,(intent->>'intake_id')::uuid,stamp,doc->>'record_hash',c,doc);
 if action='restock' then insert into public.native_return_stock_links select gen_random_uuid(),p_id,(z->>'allocation_id')::uuid,(z->>'lot_id')::uuid,(z->>'movement_id')::uuid,(z->>'quantity')::numeric from jsonb_array_elements(lines)z;end if;
 insert into public.native_return_operations values(p_id,a,p_request,public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',a,'operation','record_native_dispense_return','request',p_request)),doc,stamp) returning * into o;
 perform public.native_correction_actor(case when action='restock' then 'clinical_annotation' else 'operational_annotation' end);return public.native_return_receipt(o);
end $$;
create function public.recover_native_dispense_return(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$declare a uuid:=public.clinical_require_staff();o public.native_return_operations;begin
 select * into o from public.native_return_operations where id=p_id;if not found then return null;end if;if o.actor_id<>a then raise exception 'Return receipt unavailable' using errcode='42501';end if;
 perform public.native_return_verified((o.request#>>'{intent,target,authorization_id}')::uuid,(o.request#>>'{intent,target,pet_id}')::uuid,(o.request#>>'{intent,target,dispense_id}')::uuid);return public.native_return_receipt(o);end $$;
create function public.read_native_dispense_returns(p_authorization_id uuid,p_pet_id uuid,p_dispense_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$begin perform public.clinical_require_staff();return public.native_return_verified(p_authorization_id,p_pet_id,p_dispense_id)->'read';end $$;
create function public.read_native_return_intake(p_authorization_id uuid,p_pet_id uuid,p_dispense_id uuid,p_intake_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$declare v jsonb;i jsonb;begin
 perform public.clinical_require_staff();v:=public.native_return_verified(p_authorization_id,p_pet_id,p_dispense_id);
 if v is null or not exists(select 1 from public.native_return_events where id=p_intake_id and dispense_id=p_dispense_id and action='intake') then return null;end if;i:=public.native_return_intake_balance(p_intake_id);
 return jsonb_build_object('version',1,'target',v#>'{read,target}','head',v#>'{read,head}','intake',i);end $$;
create function public.list_native_dispense_returns(p_authorization_id uuid,p_pet_id uuid,p_dispense_id uuid,p_before_version integer default null,p_limit integer default 25) returns jsonb language plpgsql stable security definer set search_path=public as $$declare v jsonb;rows jsonb;more boolean;begin
 perform public.clinical_require_staff();if p_limit is null or p_limit not between 1 and 100 or (p_before_version is not null and p_before_version<1) then raise exception 'Bounded return cursor required' using errcode='23514';end if;
 v:=public.native_return_verified(p_authorization_id,p_pet_id,p_dispense_id);if v is null then return null;end if;
 select coalesce(jsonb_agg(x order by (x->>'sequence')::integer desc),'[]') into rows from(select value x from jsonb_array_elements(v->'events') where p_before_version is null or (value->>'sequence')::integer<p_before_version order by (value->>'sequence')::integer desc limit p_limit+1)q;
 more:=jsonb_array_length(rows)>p_limit;if more then rows:=rows-p_limit;end if;
 return jsonb_build_object('version',1,'target',v#>'{read,target}','head',v#>'{read,head}','events',rows,'next_before_version',case when more then (rows->-1->>'sequence')::integer else null end);end $$;
create function public.native_return_summary(p_authorization_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$declare r record;v jsonb;heads jsonb:='[]';n bigint:=0;begin
 for r in select distinct dispense_id,pet_id from public.native_return_events where authorization_id=p_authorization_id order by dispense_id loop
  v:=public.native_return_verified(p_authorization_id,r.pet_id,r.dispense_id);if v is null then raise exception 'Native return target unavailable' using errcode='23514';end if;n:=n+(v#>>'{read,head,version}')::bigint;heads:=heads||jsonb_build_array(jsonb_build_object('dispense_id',r.dispense_id,'head',v#>'{read,head}'));
 end loop;if n>9007199254740991 then raise exception 'Return count exceeds exact bound' using errcode='23514';end if;
 return jsonb_build_object('version',1,'event_count',n,'affected_dispense_count',jsonb_array_length(heads),'heads_hash',public.native_fulfillment_hash(heads));end $$;
create function public.native_return_disclosure(p_authorization_id uuid,p_pet_id uuid,p_dispense_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$declare v jsonb;begin
 v:=public.native_return_verified(p_authorization_id,p_pet_id,p_dispense_id);if v is null then raise exception 'Exact native return target required' using errcode='23514';end if;
 if jsonb_array_length(v->'events')>100 then raise exception 'More than100 return events; use complete paginated history instead of this package' using errcode='23514';end if;
 return jsonb_build_object('version',1,'head',v#>'{read,head}','events',v->'events','allocations',v#>'{read,allocations}');end $$;
-- A return establishes separate custody. The old all-or-nothing handoff RPC must
-- not subsequently manufacture an unqualified pickup; exact old receipt replay stays first.
do $$declare d text;needle text:='a:=public.native_rx_verified_authorization((d->>''authorization_id'')::uuid);select id into existing';begin
 select pg_get_functiondef('public.preview_native_pickup(uuid,uuid,jsonb)'::regprocedure) into d;
 if position(needle in d)=0 then raise exception 'Expected post-authorization pickup boundary missing';end if;
 execute replace(d,needle,'if exists(select 1 from public.native_return_events where dispense_id=p_dispense_id) then raise exception ''Dispense has return custody; use an attributed clarification instead of new original pickup'' using errcode=''23514'';end if; '||needle);
end $$;
alter function public.read_native_prescription_print_v2(uuid,uuid) rename to native_return_print_base;
revoke all on function public.native_return_print_base(uuid,uuid) from public,anon,authenticated,service_role;
create function public.read_native_prescription_print_v2(p_authorization_id uuid,p_dispense_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$declare r jsonb;begin
 perform public.clinical_require_staff();r:=public.native_return_print_base(p_authorization_id,p_dispense_id);
 if exists(select 1 from public.native_return_events where authorization_id=p_authorization_id) then raise exception 'Prescription has return history; use version3 print disclosure' using errcode='23514';end if;perform public.clinical_require_staff();return r;end $$;
do $$declare d text;needle text:='perform public.clinical_require_staff();return r;';begin
 select pg_get_functiondef('public.read_native_prescription_print(uuid,uuid)'::regprocedure) into d;
 if position(needle in d)=0 then raise exception 'Expected legacy print return boundary missing';end if;
 execute replace(d,needle,'if exists(select 1 from public.native_return_events where authorization_id=p_authorization_id) then raise exception ''Prescription has return history; use version3 print disclosure'' using errcode=''23514'';end if;'||needle);
end $$;
create function public.read_native_prescription_print_v3(p_authorization_id uuid,p_dispense_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$declare r jsonb;summary jsonb;disclosure jsonb;begin
 perform public.clinical_require_staff();r:=public.native_return_print_base(p_authorization_id,p_dispense_id);summary:=public.native_return_summary(p_authorization_id);
 if p_dispense_id is not null then disclosure:=public.native_return_disclosure(p_authorization_id,(r#>>'{prescription,patient,id}')::uuid,p_dispense_id);end if;
 r:=jsonb_set(r,'{status,checked_at}',to_jsonb(clock_timestamp()));perform public.clinical_require_staff();return r||jsonb_build_object('version',3,'return_summary',summary,'dispense_returns',disclosure);end $$;
create function public.native_return_release_affected(s jsonb) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.native_return_events e where e.authorization_id in(select (x->>'id')::uuid from jsonb_array_elements(s->'native_prescriptions')x union select (x#>>'{prescription,id}')::uuid from jsonb_array_elements(s->'native_dispenses')x));
$$;
alter function public.release_preview_v11_internal(uuid,uuid,text,text,jsonb) rename to native_return_release_base;
revoke all on function public.native_return_release_base(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
create function public.release_preview_v11_internal(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$declare r jsonb;begin
 r:=public.native_return_release_base(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);
 if public.native_return_release_affected(r->'snapshot') then raise exception 'Native return history requires release schema12' using errcode='23514';end if;
 if auth.role() is distinct from 'service_role' then perform public.clinical_require_staff();end if;return r;end $$;
do $$declare d text;needle text:='if auth.role() is distinct from ''service_role'' then perform public.clinical_require_staff();end if;return r;';begin
 select pg_get_functiondef('public.release_preview_v10_internal(uuid,uuid,text,text,jsonb)'::regprocedure) into d;
 if position(needle in d)=0 then raise exception 'Expected schema10 return boundary missing';end if;
 execute replace(d,needle,'if public.native_return_release_affected(r->''snapshot'') then raise exception ''Native return history requires release schema12'' using errcode=''23514'';end if;'||needle);
end $$;
create function public.release_preview_v12_internal(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$declare r jsonb;s jsonb;p jsonb;d jsonb;ps jsonb:='[]';ds jsonb:='[]';begin
 r:=public.native_return_release_base(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);s:=r->'snapshot';
 for p in select value from jsonb_array_elements(s->'native_prescriptions') loop ps:=ps||jsonb_build_array(p||jsonb_build_object('returns',public.native_return_summary((p->>'id')::uuid)));end loop;
 for d in select value from jsonb_array_elements(s->'native_dispenses') loop p:=d->'prescription';p:=p||jsonb_build_object('returns',public.native_return_summary((p->>'id')::uuid));ds:=ds||jsonb_build_array(d||jsonb_build_object('prescription',p,'returns',public.native_return_disclosure((p->>'id')::uuid,p_pet_id,(d->>'id')::uuid)));end loop;
 s:=s||jsonb_build_object('schema_version',12,'native_prescriptions',ps,'native_dispenses',ds);
 if octet_length(s::text)>1048576 then raise exception 'Release exceeds maximum reviewed snapshot size' using errcode='23514';end if;
 if auth.role() is distinct from 'service_role' then perform public.clinical_require_staff();end if;return jsonb_build_object('snapshot',s,'source_hash',public.native_fulfillment_hash(s));end $$;
create function public.preview_record_release_v12(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$declare r jsonb;begin perform public.clinical_require_staff();r:=public.release_preview_v12_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);perform public.clinical_require_staff();return r;end $$;
alter table public.record_release_policy drop constraint record_release_policy_accepted_schema_version_check;
alter table public.record_release_policy add constraint record_release_policy_accepted_schema_version_check check(accepted_schema_version in(1,2,3,4,5,6,7,8,9,10,11,12));
do $$declare d text;needle text;name text;begin
 select pg_get_functiondef('public.confirm_record_release(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean)'::regprocedure) into d;
 needle:='if (p_reviewed_snapshot->>''schema_version'')::integer=11 then';if position(needle in d)=0 then raise exception 'Expected schema11 confirmation dispatch missing';end if;
 d:=replace(d,needle,'if (p_reviewed_snapshot->>''schema_version'')::integer=12 then preview:=public.release_preview_v12_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection); elsif (p_reviewed_snapshot->>''schema_version'')::integer=11 then');
 d:=replace(d,'(''5'',''6'',''7'',''8'',''9'',''10'',''11'')','(''5'',''6'',''7'',''8'',''9'',''10'',''11'',''12'')');d:=replace(d,'(''6'',''7'',''8'',''9'',''10'',''11'')','(''6'',''7'',''8'',''9'',''10'',''11'',''12'')');execute d;
 select pg_get_functiondef('public.release_read_internal(uuid)'::regprocedure) into d;
 needle:='if r.snapshot->>''schema_version''=''11'' then';if position(needle in d)=0 then raise exception 'Expected schema11 recovery dispatch missing';end if;
 d:=replace(d,needle,'if r.snapshot->>''schema_version''=''12'' then current_preview:=public.release_preview_v12_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>''schema_version''=''11'' then');
 d:=replace(d,'(''5'',''6'',''7'',''8'',''9'',''10'',''11'')','(''5'',''6'',''7'',''8'',''9'',''10'',''11'',''12'')');d:=replace(d,'(''6'',''7'',''8'',''9'',''10'',''11'')','(''6'',''7'',''8'',''9'',''10'',''11'',''12'')');execute d;
 select pg_get_functiondef('public.verify_release_source_original_v5(jsonb,jsonb,bytea)'::regprocedure) into d;needle:='p_snapshot->>''schema_version'' is distinct from ''11''';if position(needle in d)=0 then raise exception 'Expected schema11 original byte boundary missing';end if;execute replace(d,needle,needle||' and p_snapshot->>''schema_version'' is distinct from ''12''');
 foreach name in array array['invalidate_release_source_provenance','release_weight_provenance_changed','release_weight_source_head_changed'] loop select pg_get_functiondef(oid) into d from pg_proc where pronamespace='public'::regnamespace and proname=name;needle:='''10'',''11'')';if d is null or position(needle in d)=0 then raise exception 'Expected schema11 provenance guard missing: %',name;end if;execute replace(d,needle,'''10'',''11'',''12'')');end loop;
 foreach name in array array['invalidate_native_record_release','invalidate_native_correction_release'] loop select pg_get_functiondef(oid) into d from pg_proc where pronamespace='public'::regnamespace and proname=name;needle:='in(''10'',''11'')';if d is null or position(needle in d)=0 then raise exception 'Expected schema11 native invalidation missing: %',name;end if;execute replace(d,needle,'in(''10'',''11'',''12'')');end loop;
end $$;
create function public.invalidate_native_return_release() returns trigger language plpgsql security definer set search_path=public as $$begin
 insert into public.record_release_events(id,release_id,kind,reason,created_by) select gen_random_uuid(),r.id,'source_changed','Native physical return custody changed; review a fresh schema12 package',NEW.actor_id from public.record_releases r where r.snapshot->>'schema_version' in('10','11','12') and exists(select 1 from public.record_release_sources rs where rs.release_id=r.id and ((rs.source_kind='native_prescription' and rs.source_id=NEW.authorization_id) or(rs.source_kind='native_dispense' and exists(select 1 from public.native_dispenses d where d.id=rs.source_id and d.authorization_id=NEW.authorization_id))));return NEW;end $$;
create trigger native_return_release_changed after insert on public.native_return_events for each row execute function public.invalidate_native_return_release();
create function public.list_record_release_sources_v12(p_pet_id uuid,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public as $$declare r jsonb;begin perform public.clinical_require_staff();r:=public.list_record_release_sources_v11(p_pet_id,p_offset);perform public.clinical_require_staff();return r||jsonb_build_object('policy_v12_accepted',exists(select 1 from public.record_release_policy where id and enabled and accepted_at<=now() and accepted_schema_version>=12));end $$;
create function public.select_all_record_release_sources_v12(p_pet_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$declare r jsonb;begin perform public.clinical_require_staff();r:=public.select_all_record_release_sources_v11(p_pet_id);perform public.clinical_require_staff();return r||jsonb_build_object('scope',coalesce(r->>'scope','')||'; schema12 native physical return disclosure');end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and (proname like 'native_return_%' or proname in('read_native_return_policy','configure_native_return_policy','recover_native_return_policy','preview_native_dispense_return','record_native_dispense_return','recover_native_dispense_return','read_native_dispense_returns','read_native_return_intake','list_native_dispense_returns','read_native_prescription_print_v2','read_native_prescription_print_v3','release_preview_v11_internal','release_preview_v12_internal','preview_record_release_v12','invalidate_native_return_release','list_record_release_sources_v12','select_all_record_release_sources_v12')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in('read_native_return_policy','configure_native_return_policy','recover_native_return_policy','preview_native_dispense_return','record_native_dispense_return','recover_native_dispense_return','read_native_dispense_returns','read_native_return_intake','list_native_dispense_returns','read_native_prescription_print_v2','read_native_prescription_print_v3','preview_record_release_v12','list_record_release_sources_v12','select_all_record_release_sources_v12') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
