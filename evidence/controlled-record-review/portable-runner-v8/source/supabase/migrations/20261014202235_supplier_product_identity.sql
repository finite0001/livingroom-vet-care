-- Reviewed supplier/package metadata never receives stock or changes billing.
create table public.inventory_identity_entries (
 id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
 kind text not null check(kind in('namespace','package')),
 product_id uuid references public.catalog_products(id) on delete restrict,
 head_id uuid not null,
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(),
 check((kind='namespace' and product_id is null)or(kind='package' and product_id is not null))
);
create table public.inventory_identity_reviews (
 id uuid primary key,actor_id uuid not null references auth.users(id) on delete restrict,
 session_id uuid not null,operation text not null check(operation in('namespace','package')),
 request jsonb not null check(jsonb_typeof(request)='object' and octet_length(request::text)<=32768),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default(clock_timestamp()+interval '15 minutes'),
 unique(id,actor_id,operation),check(expires_at>created_at)
);
create index inventory_identity_reviews_actor_idx on public.inventory_identity_reviews(actor_id,expires_at);
create table public.inventory_identity_versions (
 id uuid primary key,entry_id uuid not null references public.inventory_identity_entries(id) on delete restrict,
 version integer not null check(version>0),definition jsonb not null check(jsonb_typeof(definition)='object'),
 product_snapshot jsonb,action_id uuid not null unique,
 actor_id uuid not null references auth.users(id) on delete restrict,session_id uuid not null,
 created_at timestamptz not null default clock_timestamp(),unique(entry_id,version),unique(id,entry_id)
);
alter table public.inventory_identity_entries add constraint inventory_identity_head_fk
 foreign key(head_id,id) references public.inventory_identity_versions(id,entry_id) deferrable initially deferred;
create table public.inventory_identity_bindings (
 kind text not null check(kind in('supplier_sku','supplier_barcode','gtin')),
 namespace_key uuid not null,namespace_version_id uuid,
 value text not null check(length(value)between 1 and 200),
 package_id uuid not null,package_version_id uuid not null,
 primary key(kind,namespace_key,value),
 foreign key(package_version_id,package_id) references public.inventory_identity_versions(id,entry_id) on delete restrict,
 foreign key(namespace_version_id,namespace_key) references public.inventory_identity_versions(id,entry_id) on delete restrict,
 check((kind='gtin'and namespace_key='00000000-0000-0000-0000-000000000000'::uuid and namespace_version_id is null)
 or(kind<>'gtin'and namespace_key<>'00000000-0000-0000-0000-000000000000'::uuid and namespace_version_id is not null))
);
create index inventory_identity_bindings_package_idx on public.inventory_identity_bindings(package_id);
create table public.inventory_identity_actions (
 id uuid primary key,actor_id uuid not null,session_id uuid not null,operation text not null,
 request jsonb not null,version_id uuid not null unique references public.inventory_identity_versions(id) on delete restrict,
 receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(id,actor_id,operation) references public.inventory_identity_reviews(id,actor_id,operation) on delete restrict
);
alter table public.inventory_identity_versions add constraint inventory_identity_version_action_fk
 foreign key(action_id) references public.inventory_identity_actions(id) deferrable initially deferred;
create table public.inventory_identity_cancellations (
 id uuid primary key,actor_id uuid not null references auth.users(id) on delete restrict,
 session_id uuid not null,created_at timestamptz not null default clock_timestamp()
);
create function public.inventory_identity_actor(p_actor uuid default null,p_reviewer boolean default false)
 returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid;begin
 if auth.jwt()->>'role' is distinct from 'authenticated' then raise exception 'Authenticated staff required' using errcode='42501';end if;
 actor:=public.clinical_require_staff();perform public.next_visit_review_session();
 if p_actor is not null and actor is distinct from p_actor then raise exception 'Matched inventory reviewer required' using errcode='42501';end if;
 if p_reviewer and not exists(select 1 from public.user_roles where user_id=actor and role in('ADMIN','DVM'))then raise exception 'Active veterinarian or administrator required' using errcode='42501';end if;
 return actor;
end $$;
create function public.inventory_identity_text(value jsonb,maximum integer) returns text
 language plpgsql immutable set search_path=public as $$
declare result text;begin
 if jsonb_typeof(value)is distinct from 'string'then raise exception 'Reviewed identity text required' using errcode='23514';end if;
 result:=value#>>'{}';
 if length(result)not between 1 and maximum or result<>btrim(result)or result~E'[\\x01-\\x1f\\x7f]'then raise exception 'Clean bounded identity text required' using errcode='23514';end if;
 return result;
end $$;
create function public.inventory_identity_gtin(value text) returns text language plpgsql immutable set search_path=public as $$
declare total integer:=0;i integer;weight integer:=3;begin
 if value is null or value!~'^(?:[0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$'or value!~'[1-9]'then raise exception 'Valid GTIN digits required' using errcode='23514';end if;
 for i in reverse length(value)-1..1 loop total:=total+substr(value,i,1)::integer*weight;weight:=4-weight;end loop;
 if(10-total%10)%10<>right(value,1)::integer then raise exception 'GTIN check digit invalid' using errcode='23514';end if;
 return lpad(value,14,'0');
end $$;
create function public.inventory_identity_conversion(value jsonb) returns void language plpgsql immutable set search_path=public as $$
declare k text;t text;begin
 perform public.native_rx_keys(value,array['stock_units_numerator','purchase_units_denominator']);
 foreach k in array array['stock_units_numerator','purchase_units_denominator']loop
  if jsonb_typeof(value->k)is distinct from 'string'then raise exception 'Exact conversion integer strings required' using errcode='23514';end if;
  t:=value->>k;if t!~'^[1-9][0-9]{0,12}$'then raise exception 'Positive bounded conversion terms required' using errcode='23514';end if;
  if t::numeric>1000000000000 then raise exception 'Positive bounded conversion terms required' using errcode='23514';end if;
 end loop;
end $$;
create function public.inventory_identity_uuid(value jsonb)returns uuid language plpgsql immutable set search_path=public as $$
declare result uuid:=public.native_rx_uuid(value);begin
 if result='00000000-0000-0000-0000-000000000000'::uuid or(value#>>'{}')is distinct from result::text then raise exception 'Canonical nonzero inventory identity required' using errcode='23514';end if;return result;
end $$;
create function public.inventory_identity_validate(p_operation text,p_request jsonb,p_current boolean default true)
 returns void language plpgsql security definer set search_path=public as $$
declare d jsonb;x jsonb;identity_id uuid;ns uuid;nsv uuid;e inventory_identity_entries;v inventory_identity_versions;p catalog_products;seen text[]:='{}';key text;begin
 perform public.native_rx_keys(p_request,array['id','expected_version','definition','review_note','attest_review']);
 if octet_length(p_request::text)>32768 then raise exception 'Bounded identity request required' using errcode='23514';end if;
 identity_id:=public.inventory_identity_uuid(p_request->'id');if identity_id='00000000-0000-0000-0000-000000000000'::uuid then raise exception 'Nonzero identity required' using errcode='23514';end if;
 if p_request->'expected_version'is distinct from 'null'::jsonb then perform public.appointment_catalog_integer(p_request->'expected_version',1,2147483647);end if;
 perform public.native_rx_text(p_request->'review_note',2000);
 if p_request->'attest_review'is distinct from 'true'::jsonb then raise exception 'Explicit package review attestation required' using errcode='23514';end if;
 select * into e from inventory_identity_entries where inventory_identity_entries.id=identity_id;
 if found then
  select * into v from inventory_identity_versions where inventory_identity_versions.id=e.head_id;
  if e.kind is distinct from p_operation then raise exception 'Inventory identity kind immutable' using errcode='23505';end if;
  if p_current and p_request->'expected_version'is distinct from to_jsonb(v.version)then raise exception 'Inventory mapping changed; review current version' using errcode='PT409';end if;
 elsif p_current and p_request->'expected_version'is distinct from 'null'::jsonb then raise exception 'New identity requires null expected version' using errcode='PT409';end if;
 d:=p_request->'definition';
 if p_operation='namespace'then
  perform public.native_rx_keys(d,array['supplier','account_label','catalog_scope','active']);
  if d->>'supplier'is null or d->>'supplier'not in('mwi','midwest')then raise exception 'Known supplier namespace required' using errcode='23514';end if;
  perform public.inventory_identity_text(d->'account_label',200);perform public.inventory_identity_text(d->'catalog_scope',200);
  if v.id is not null and(d-'active')is distinct from(v.definition-'active')then raise exception 'New namespace required for a different supplier account/catalog' using errcode='23514';end if;
 elsif p_operation='package'then
  perform public.native_rx_keys(d,array['product_id','product_version','stock_unit','label','manufacturer','strength','form','purchase_unit','conversion','identifiers','active']);
  identity_id:=public.inventory_identity_uuid(d->'product_id');perform public.appointment_catalog_integer(d->'product_version',1,2147483647);
  perform public.inventory_identity_text(d->'stock_unit',50);perform public.inventory_identity_text(d->'label',200);perform public.inventory_identity_text(d->'manufacturer',200);
  perform public.inventory_identity_text(d->'strength',200);perform public.inventory_identity_text(d->'form',100);perform public.inventory_identity_text(d->'purchase_unit',50);
  perform public.inventory_identity_conversion(d->'conversion');
  if e.id is not null and e.product_id is distinct from identity_id then raise exception 'Package product identity immutable' using errcode='23514';end if;
  select * into p from catalog_products where catalog_products.id=identity_id;
  if not found or p.kind='service'or d->>'stock_unit'is distinct from p.unit or(p_current and d->'product_version'is distinct from to_jsonb(p.version))or(p_current and d->'active'='true'::jsonb and not p.active)then raise exception 'Current reviewed stock product/version/unit required' using errcode='PT409';end if;
  if jsonb_typeof(d->'identifiers')is distinct from 'array'or jsonb_array_length(d->'identifiers')>50 then raise exception 'At most50 explicit identifiers required' using errcode='23514';end if;
  for x in select value from jsonb_array_elements(d->'identifiers')loop
   perform public.native_rx_keys(x,array['kind','namespace_id','namespace_version_id','value','raw_source']);
   perform public.inventory_identity_text(x->'value',200);perform public.inventory_identity_text(x->'raw_source',1000);
   if x->>'kind'='gtin'then
    if x->'namespace_id'is distinct from 'null'::jsonb or x->'namespace_version_id'is distinct from 'null'::jsonb or public.inventory_identity_gtin(x->>'value')is distinct from x->>'value'or public.inventory_identity_gtin(x->>'raw_source')is distinct from x->>'value'then raise exception 'Global normalized GTIN and matching original code required' using errcode='23514';end if;
    ns:='00000000-0000-0000-0000-000000000000';
   elsif x->>'kind'in('supplier_sku','supplier_barcode')then
    ns:=public.inventory_identity_uuid(x->'namespace_id');nsv:=public.inventory_identity_uuid(x->'namespace_version_id');
    if not exists(select 1 from inventory_identity_entries ne join inventory_identity_versions nv on nv.entry_id=ne.id where ne.id=ns and ne.kind='namespace'and nv.id=nsv and(not p_current or d->'active'='false'::jsonb or(ne.head_id=nv.id and nv.definition->'active'='true'::jsonb)))then raise exception 'Current active reviewed supplier namespace/version required' using errcode='PT409';end if;
   else raise exception 'Explicit supplier or GTIN identifier kind required' using errcode='23514';end if;
   key:=jsonb_build_array(x->>'kind',ns::text,x->>'value')::text;
   if key=any(seen)then raise exception 'Distinct package identifiers required' using errcode='23514';end if;seen:=array_append(seen,key);
  end loop;
 else raise exception 'Known inventory identity operation required' using errcode='23514';end if;
 if jsonb_typeof(d->'active')is distinct from 'boolean'then raise exception 'Explicit identity active state required' using errcode='23514';end if;
end $$;
create function public.inventory_identity_immutable() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Inventory identity evidence is immutable' using errcode='23514';end $$;
do $$declare name text;begin
 foreach name in array array['inventory_identity_reviews','inventory_identity_versions','inventory_identity_actions','inventory_identity_cancellations']loop
  execute format('create trigger %I_immutable before update or delete on public.%I for each row execute function public.inventory_identity_immutable()',name,name);
  execute format('create trigger %I_no_truncate before truncate on public.%I for each statement execute function public.inventory_identity_immutable()',name,name);
 end loop;
 foreach name in array array['inventory_identity_entries','inventory_identity_reviews','inventory_identity_versions','inventory_identity_bindings','inventory_identity_actions','inventory_identity_cancellations']loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
 end loop;
end $$;
-- Remaining guarded review/materialization/projection functions are added below.
-- Helpers are never public APIs, including while this local draft is assembled.
do $$declare f regprocedure;begin
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname like 'inventory_identity_%'loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 end loop;
end $$;
alter table public.inventory_identity_versions add column actor_name text not null check(length(actor_name)between 1 and 200);
create function public.inventory_identity_instant(p_time timestamptz)returns text language sql immutable set search_path=public as $$
 select to_char(p_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
create function public.inventory_identity_view(p_id uuid,p_version_id uuid default null) returns jsonb
 language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',e.id,'kind',e.kind,'product_id',e.product_id,'version_id',v.id,'version',v.version,
 'definition',v.definition,'product_snapshot',v.product_snapshot,'actor_id',v.actor_id,'actor_name',v.actor_name,'created_at',public.inventory_identity_instant(v.created_at))
 from inventory_identity_entries e join inventory_identity_versions v on v.entry_id=e.id and v.id=coalesce(p_version_id,e.head_id)where e.id=p_id
$$;
create function public.inventory_identity_entry_guard() returns trigger language plpgsql set search_path=public as $$
begin
 if tg_op<>'UPDATE'then raise exception 'Inventory identity cannot be deleted/truncated' using errcode='23514';end if;
 if(row(new.id,new.kind,new.product_id,new.created_by,new.created_at))is distinct from(row(old.id,old.kind,old.product_id,old.created_by,old.created_at))then raise exception 'Inventory identity is immutable; revise its reviewed version' using errcode='23514';end if;
 return new;
end $$;
create trigger inventory_identity_entry_guard before update or delete on public.inventory_identity_entries for each row execute function public.inventory_identity_entry_guard();
create trigger inventory_identity_entry_no_truncate before truncate on public.inventory_identity_entries for each statement execute function public.inventory_identity_entry_guard();
create trigger inventory_identity_binding_no_update before update on public.inventory_identity_bindings for each row execute function public.inventory_identity_immutable();
create trigger inventory_identity_binding_no_truncate before truncate on public.inventory_identity_bindings for each statement execute function public.inventory_identity_immutable();
create function public.inventory_identity_consistency() returns trigger language plpgsql security definer set search_path=public as $$
declare target uuid;e inventory_identity_entries;v inventory_identity_versions;a inventory_identity_actions;r inventory_identity_reviews;expected integer;begin
 if tg_table_name='inventory_identity_entries'then target:=coalesce(new.id,old.id);
 elsif tg_table_name='inventory_identity_versions'then target:=coalesce(new.entry_id,old.entry_id);
 elsif tg_table_name='inventory_identity_bindings'then target:=coalesce(new.package_id,old.package_id);
 else select entry_id into target from inventory_identity_versions where id=coalesce(new.version_id,old.version_id);end if;
 select * into e from inventory_identity_entries where id=target;
 select * into v from inventory_identity_versions where id=e.head_id and entry_id=e.id;
 if e.id is null or v.id is null or v.version is distinct from(select max(version)from inventory_identity_versions where entry_id=e.id)
 or v.version is distinct from(select count(*)::integer from inventory_identity_versions where entry_id=e.id)then raise exception 'Exact contiguous identity head/history required' using errcode='23514';end if;
 select * into a from inventory_identity_actions where id=v.action_id;select * into r from inventory_identity_reviews where id=v.action_id;
 if a.id is null or r.id is null then raise exception 'Identity version requires reviewed action' using errcode='23514';end if;
 perform public.inventory_identity_validate(e.kind,r.request,false);
 if(r.request->'expected_version'='null'::jsonb and v.version<>1)or(r.request->'expected_version'<>'null'::jsonb and(r.request->>'expected_version')::integer<>v.version-1)then raise exception 'Identity version must advance exact reviewed predecessor' using errcode='23514';end if;
 if a.version_id<>v.id or a.actor_id<>v.actor_id or a.session_id<>v.session_id
 or a.operation<>e.kind or a.request is distinct from r.request or r.request->'definition'is distinct from v.definition
 or a.receipt is distinct from jsonb_build_object('id',a.id,'actor_id',a.actor_id,'operation',a.operation,'entry',public.inventory_identity_view(e.id,v.id))then raise exception 'Identity version requires exact immutable reviewed receipt' using errcode='23514';end if;
 if e.kind='package'then
  expected:=case when v.definition->'active'='true'::jsonb then jsonb_array_length(v.definition->'identifiers')else 0 end;
  if expected<>(select count(*)from inventory_identity_bindings where package_id=e.id)or exists(
   select 1 from inventory_identity_bindings b where b.package_id=e.id and(b.package_version_id<>v.id or not exists(
    select 1 from jsonb_array_elements(v.definition->'identifiers')x where x->>'kind'=b.kind and x->>'value'=b.value
     and coalesce((x->>'namespace_id')::uuid,'00000000-0000-0000-0000-000000000000'::uuid)=b.namespace_key
     and(x->>'namespace_version_id')::uuid is not distinct from b.namespace_version_id)))then raise exception 'Exact active package identifier projection required' using errcode='23514';end if;
 elsif exists(select 1 from inventory_identity_bindings where package_id=e.id)then raise exception 'Namespace cannot own package bindings' using errcode='23514';end if;
 return null;
end $$;
do $$declare name text;begin
 foreach name in array array['inventory_identity_entries','inventory_identity_versions','inventory_identity_bindings','inventory_identity_actions']loop
  execute format('create constraint trigger %I_consistency after insert or update or delete on public.%I deferrable initially deferred for each row execute function public.inventory_identity_consistency()',name,name);
 end loop;
end $$;
create function public.read_inventory_identity_review(p_actor_id uuid,p_action_id uuid)returns jsonb
 language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.inventory_identity_actor(p_actor_id);r inventory_identity_reviews;a inventory_identity_actions;c inventory_identity_cancellations;begin
 if p_actor_id is null or p_action_id is null then raise exception 'Matched reviewer/action required' using errcode='42501';end if;
 select * into r from inventory_identity_reviews where id=p_action_id;select * into a from inventory_identity_actions where id=p_action_id;select * into c from inventory_identity_cancellations where id=p_action_id;
 if(r.id is not null and r.actor_id<>actor)or(a.id is not null and a.actor_id<>actor)or(c.id is not null and c.actor_id<>actor)then raise exception 'Inventory review belongs to another account' using errcode='42501';end if;
 if r.id is null then return case when c.id is null then null else jsonb_build_object('id',c.id,'actor_id',c.actor_id,'state','cancelled','operation',null,'request',null,'expires_at',null,'receipt',null)end;end if;
 if a.id is not null and(a.request is distinct from r.request or a.operation<>r.operation)then raise exception 'Inventory action receipt collision' using errcode='23505';end if;
 return jsonb_build_object('id',r.id,'actor_id',r.actor_id,'operation',r.operation,'request',r.request,'expires_at',public.inventory_identity_instant(r.expires_at),'receipt',a.receipt,
 'state',case when a.id is not null then 'saved'when c.id is not null then 'cancelled'when r.expires_at<=clock_timestamp()then 'expired'else 'prepared'end);
end $$;
create function public.prepare_inventory_identity_review(p_actor_id uuid,p_action_id uuid,p_operation text,p_request jsonb)returns jsonb
 language plpgsql security definer set search_path=public set lock_timeout='2s' set statement_timeout='5s' as $$
declare actor uuid:=public.inventory_identity_actor(p_actor_id,true);r inventory_identity_reviews;begin
 if p_actor_id is null or p_action_id is null then raise exception 'Matched reviewer/action required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(90271010,hashtext(actor::text));perform pg_advisory_xact_lock(90271011,hashtext(p_action_id::text));perform public.inventory_identity_actor(p_actor_id,true);
 select * into r from inventory_identity_reviews where id=p_action_id;
 if found then if r.actor_id<>actor or r.operation is distinct from p_operation or r.request is distinct from p_request then raise exception 'Inventory review UUID is immutable' using errcode='23505';end if;return public.read_inventory_identity_review(actor,p_action_id);end if;
 if exists(select 1 from inventory_identity_cancellations where id=p_action_id)then raise exception 'Inventory action cancelled;check saved work' using errcode='PT409';end if;
 perform public.inventory_identity_validate(p_operation,p_request);
 if(select count(*)from inventory_identity_reviews rv where actor_id=actor and expires_at>clock_timestamp()and not exists(select 1 from inventory_identity_actions a where a.id=rv.id)and not exists(select 1 from inventory_identity_cancellations c where c.id=rv.id))>=32 then raise exception 'Check pending inventory reviews first' using errcode='23514';end if;
 insert into inventory_identity_reviews(id,actor_id,session_id,operation,request)values(p_action_id,actor,public.next_visit_review_session(),p_operation,p_request);
 return public.read_inventory_identity_review(actor,p_action_id);
end $$;
create function public.execute_inventory_identity_review(p_actor_id uuid,p_action_id uuid)returns jsonb
 language plpgsql security definer set search_path=public set lock_timeout='2s' set statement_timeout='5s' as $$
declare actor uuid:=public.inventory_identity_actor(p_actor_id,true);r inventory_identity_reviews;a inventory_identity_actions;e inventory_identity_entries;v inventory_identity_versions;
 entry uuid;new_version uuid:=gen_random_uuid();sequence integer;d jsonb;x jsonb;ns uuid;p catalog_products;snapshot jsonb;receipt jsonb;begin
 if p_actor_id is null or p_action_id is null then raise exception 'Matched reviewer/action required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(90271010,hashtext(actor::text));perform pg_advisory_xact_lock(90271011,hashtext(p_action_id::text));perform public.inventory_identity_actor(p_actor_id,true);
 select * into r from inventory_identity_reviews where id=p_action_id;if not found or r.actor_id<>actor then raise exception 'Own prepared inventory review required' using errcode='42501';end if;
 select * into a from inventory_identity_actions where id=p_action_id;
 if found then if a.request is distinct from r.request or a.operation<>r.operation then raise exception 'Inventory receipt identity collision' using errcode='23505';end if;return a.receipt;end if;
 if r.expires_at<=clock_timestamp()or exists(select 1 from inventory_identity_cancellations where id=p_action_id)then raise exception 'Inventory review expired/cancelled;recover saved work' using errcode='PT409';end if;
 entry:=public.native_rx_uuid(r.request->'id');d:=r.request->'definition';
 perform pg_advisory_xact_lock(90271012,hashtext(entry::text));
 if r.operation='package'then
  for ns in select distinct(element.value->>'namespace_id')::uuid from jsonb_array_elements(d->'identifiers')as element(value)where element.value->>'namespace_id'is not null order by 1 loop perform pg_advisory_xact_lock(90271012,hashtext(ns::text));end loop;
  select * into p from catalog_products where id=(d->>'product_id')::uuid for share;
  snapshot:=jsonb_build_object('id',p.id,'version',p.version,'name',p.name,'kind',p.kind,'manufacturer',p.manufacturer,'unit',p.unit,'active',p.active);
 end if;
 perform public.inventory_identity_actor(p_actor_id,true);perform public.inventory_identity_validate(r.operation,r.request);
 select * into e from inventory_identity_entries where id=entry for update;
 if found then select * into v from inventory_identity_versions where id=e.head_id;sequence:=v.version+1;update inventory_identity_entries set head_id=new_version where id=entry;
 else sequence:=1;insert into inventory_identity_entries(id,kind,product_id,head_id,created_by)values(entry,r.operation,case when r.operation='package'then p.id end,new_version,actor);end if;
 insert into inventory_identity_versions(id,entry_id,version,definition,product_snapshot,action_id,actor_id,session_id,actor_name)
 values(new_version,entry,sequence,d,snapshot,p_action_id,actor,public.next_visit_review_session(),(select left(coalesce(nullif(btrim(full_name),''),'Staff member'),200)from profiles where id=actor));
 if r.operation='package'then
  delete from inventory_identity_bindings where package_id=entry;
  if d->'active'='true'::jsonb then
   for x in select value from jsonb_array_elements(d->'identifiers')order by value->>'kind',coalesce((value->>'namespace_id')::uuid,'00000000-0000-0000-0000-000000000000'::uuid),value->>'value'loop
    insert into inventory_identity_bindings(kind,namespace_key,namespace_version_id,value,package_id,package_version_id)
    values(x->>'kind',coalesce((x->>'namespace_id')::uuid,'00000000-0000-0000-0000-000000000000'::uuid),(x->>'namespace_version_id')::uuid,x->>'value',entry,new_version);
   end loop;
  end if;
 end if;
 perform public.inventory_identity_actor(p_actor_id,true);
 receipt:=jsonb_build_object('id',p_action_id,'actor_id',actor,'operation',r.operation,'entry',public.inventory_identity_view(entry,new_version));
 insert into inventory_identity_actions(id,actor_id,session_id,operation,request,version_id,receipt)values(p_action_id,actor,public.next_visit_review_session(),r.operation,r.request,new_version,receipt);
 return receipt;
end $$;
create function public.cancel_inventory_identity_review(p_actor_id uuid,p_action_id uuid)returns jsonb
 language plpgsql security definer set search_path=public set lock_timeout='2s' set statement_timeout='5s' as $$
declare actor uuid:=public.inventory_identity_actor(p_actor_id);r inventory_identity_reviews;a inventory_identity_actions;c inventory_identity_cancellations;begin
 if p_actor_id is null or p_action_id is null then raise exception 'Matched reviewer/action required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(90271010,hashtext(actor::text));perform pg_advisory_xact_lock(90271011,hashtext(p_action_id::text));perform public.inventory_identity_actor(p_actor_id);
 select * into r from inventory_identity_reviews where id=p_action_id;select * into a from inventory_identity_actions where id=p_action_id;select * into c from inventory_identity_cancellations where id=p_action_id;
 if(r.id is not null and r.actor_id<>actor)or(a.id is not null and a.actor_id<>actor)or(c.id is not null and c.actor_id<>actor)then raise exception 'Inventory review belongs to another account' using errcode='42501';end if;
 if a.id is not null then return jsonb_build_object('cancelled',false,'receipt',a.receipt);end if;
 insert into inventory_identity_cancellations(id,actor_id,session_id)values(p_action_id,actor,public.next_visit_review_session())on conflict(id)do nothing;
 return jsonb_build_object('cancelled',true,'receipt',null);
end $$;
create function public.list_inventory_identities(p_kind text,p_search text default '',p_after uuid default null,p_limit integer default 50)returns jsonb
 language plpgsql stable security definer set search_path=public as $$
declare result jsonb;begin
 perform public.inventory_identity_actor();
 if p_kind is null or p_kind not in('namespace','package')or p_search is null or length(p_search)>200 or p_limit is null or p_limit not between 1 and 100 then raise exception 'Bounded inventory identity search required' using errcode='23514';end if;
 with candidates as materialized(select e.id from inventory_identity_entries e join inventory_identity_versions v on v.id=e.head_id where e.kind=p_kind and(p_after is null or e.id>p_after)and(p_search=''or position(lower(p_search)in lower(case when e.kind='namespace'then v.definition->>'account_label'else v.definition->>'label'end))>0)order by e.id limit p_limit+1),page as materialized(select id from candidates order by id limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(public.inventory_identity_view(id)order by id)from page),'[]'),'next',case when(select count(*)from candidates)>p_limit then(select id from page order by id desc limit 1)end)into result;
 return result;
end $$;
create function public.read_inventory_identity(p_id uuid,p_before_version integer default null,p_limit integer default 20)returns jsonb
 language plpgsql stable security definer set search_path=public as $$
declare result jsonb;begin
 perform public.inventory_identity_actor();if p_id is null or p_limit is null or p_limit not between 1 and 100 or(p_before_version is not null and p_before_version<1)then raise exception 'Bounded identity/history required' using errcode='23514';end if;
 if not exists(select 1 from inventory_identity_entries where id=p_id)then return null;end if;
 with candidates as materialized(select id,version from inventory_identity_versions where entry_id=p_id and(p_before_version is null or version<p_before_version)order by version desc limit p_limit+1),page as materialized(select id,version from candidates order by version desc limit p_limit)
 select jsonb_build_object('entry',public.inventory_identity_view(p_id),'current_product',(select jsonb_build_object('id',p.id,'version',p.version,'name',p.name,'kind',p.kind,'manufacturer',p.manufacturer,'unit',p.unit,'active',p.active)from catalog_products p join inventory_identity_entries e on e.product_id=p.id where e.id=p_id),'history',coalesce((select jsonb_agg(public.inventory_identity_view(p_id,id)order by version desc)from page),'[]'),'next',case when(select count(*)from candidates)>p_limit then(select min(version)from page)end)into result;return result;
end $$;
create function public.lookup_inventory_identifier(p_kind text,p_value text,p_namespace_id uuid default null,p_limit integer default 50)returns jsonb
 language plpgsql stable security definer set search_path=public as $$
declare result jsonb;begin
 perform public.inventory_identity_actor();perform public.inventory_identity_text(to_jsonb(p_value),200);
 if p_kind is null or p_kind not in('supplier_sku','supplier_barcode','gtin')or p_limit is null or p_limit not between 1 and 100 or(p_kind='gtin'and(p_namespace_id is not null or public.inventory_identity_gtin(p_value)is distinct from p_value))then raise exception 'Explicit bounded identifier lookup required' using errcode='23514';end if;
 with candidates as materialized(
  select distinct e.id from inventory_identity_bindings b join inventory_identity_entries e on e.id=b.package_id join inventory_identity_versions v on v.id=e.head_id
  join catalog_products p on p.id=e.product_id left join inventory_identity_entries ne on ne.id=b.namespace_key left join inventory_identity_versions nv on nv.id=ne.head_id
  where b.kind=p_kind and b.value=p_value and(p_namespace_id is null or b.namespace_key=p_namespace_id)
   and b.package_version_id=e.head_id and v.definition->'active'='true'::jsonb and p.active
   and p.name=v.product_snapshot->>'name'and p.kind=v.product_snapshot->>'kind'and p.manufacturer=v.product_snapshot->>'manufacturer'and p.unit=v.product_snapshot->>'unit'
   and(b.kind='gtin'or(ne.kind='namespace'and ne.head_id=b.namespace_version_id and nv.definition->'active'='true'::jsonb))order by e.id limit p_limit+1),page as materialized(select id from candidates order by id limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(public.inventory_identity_view(id)order by id)from page),'[]'),'more',(select count(*)from candidates)>p_limit)into result;return result;
end $$;
-- No staff/worker can invoke validators, projections, triggers or raw tables.
do $$declare f regprocedure;name text;begin
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and(proname like 'inventory_identity_%'or proname in('read_inventory_identity_review','prepare_inventory_identity_review','execute_inventory_identity_review','cancel_inventory_identity_review','list_inventory_identities','read_inventory_identity','lookup_inventory_identifier'))loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 end loop;
 foreach name in array array['read_inventory_identity_review','prepare_inventory_identity_review','execute_inventory_identity_review','cancel_inventory_identity_review','list_inventory_identities','read_inventory_identity','lookup_inventory_identifier']loop
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname=name loop execute format('grant execute on function %s to authenticated',f);end loop;
 end loop;
end $$;
