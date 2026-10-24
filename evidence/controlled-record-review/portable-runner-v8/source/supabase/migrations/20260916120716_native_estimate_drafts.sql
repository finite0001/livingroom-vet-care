-- Draft estimates are operational proposals. They create no clinical or financial effects.
create table public.native_estimate_drafts (
 id uuid primary key,client_id uuid not null references public.clients(id),pet_id uuid not null references public.pets(id),created_by uuid not null references public.profiles(id),created_at timestamptz not null
);
create table public.native_estimate_draft_operations (
 id uuid primary key,actor_id uuid not null references public.profiles(id),request jsonb not null,request_hash text not null,estimate_id uuid not null references public.native_estimate_drafts(id),version integer not null check(version>0),created_at timestamptz not null,unique(estimate_id,version)
);
create table public.native_estimate_draft_revisions (
 estimate_id uuid not null references public.native_estimate_drafts(id),version integer not null check(version>0),operation_id uuid not null unique references public.native_estimate_draft_operations(id) deferrable initially deferred,document jsonb not null,catalog jsonb not null,previous_hash text,record_hash text not null,primary key(estimate_id,version)
);
create table public.native_estimate_draft_closures (
 id uuid primary key,actor_id uuid not null references public.profiles(id),request jsonb not null,request_hash text not null,closed_at timestamptz not null,record_hash text not null
);
create index native_estimate_draft_household on public.native_estimate_drafts(client_id,created_at desc,id desc);
do $$declare tab text;begin
 foreach tab in array array['native_estimate_drafts','native_estimate_draft_operations','native_estimate_draft_revisions','native_estimate_draft_closures'] loop
 execute format('alter table public.%I enable row level security',tab);execute format('revoke all on public.%I from public,anon,authenticated,service_role',tab);
 execute format('create trigger native_estimate_immutable before update or delete on public.%I for each row execute function public.native_correction_immutable()',tab);
 execute format('create trigger native_estimate_no_truncate before truncate on public.%I for each statement execute function public.native_correction_immutable()',tab);
 execute format('create trigger native_estimate_audit after insert on public.%I for each row execute function public.native_rx_audit()',tab);
 end loop;
end $$;
create function public.native_estimate_positive_int(v jsonb) returns integer language plpgsql immutable security definer set search_path=public as $$begin
 if jsonb_typeof(v) is distinct from 'number' or v::text !~ '^[1-9][0-9]{0,9}$' or (v::text)::numeric>2147483647 then raise exception 'Positive integer version required' using errcode='23514';end if;return(v::text)::integer;
end $$;
-- p_catalog null validates syntax/totals only. Frozen evidence validates historical prices.
create function public.native_estimate_fields_total(p_fields jsonb,p_catalog jsonb default null) returns text language plpgsql immutable security definer set search_path=public as $$
declare line jsonb;entry jsonb;ids text[]:='{}';products text[]:='{}';quantity numeric;amount numeric;total numeric:=0;price numeric;reason text;begin
 perform public.native_rx_keys(p_fields,array['title','notes','terms','accept_by','lines']);perform public.native_rx_text(p_fields->'title',200);perform public.native_rx_text(p_fields->'terms',8000);
 if p_fields->'notes' is distinct from '""'::jsonb then perform public.native_rx_text(p_fields->'notes',4000);end if;perform public.native_rx_day(p_fields->'accept_by');
 if jsonb_typeof(p_fields->'lines') is distinct from 'array' or jsonb_array_length(p_fields->'lines') not between 1 and 100 then raise exception 'One to 100 estimate lines required' using errcode='23514';end if;
 if p_catalog is not null and jsonb_typeof(p_catalog) is distinct from 'object' then raise exception 'Exact historical catalog evidence required' using errcode='23514';end if;
 for line in select value from jsonb_array_elements(p_fields->'lines') loop
  perform public.native_rx_keys(line,array['id','product_id','product_version','description','kind','unit','quantity','pricing','pricing_reason']);perform public.native_correction_uuid(line->'id',false);perform public.native_correction_uuid(line->'product_id',false);perform public.native_estimate_positive_int(line->'product_version');
  if line->>'id'=any(ids) then raise exception 'Duplicate estimate line identity' using errcode='23514';end if;ids:=array_append(ids,line->>'id');
  if not(line->>'product_id'=any(products)) then products:=array_append(products,line->>'product_id');end if;
  perform public.native_rx_text(line->'description',300);perform public.native_rx_text(line->'unit',50);
  if jsonb_typeof(line->'kind') is distinct from 'string' or line->>'kind' not in('service','medication','vaccine') or jsonb_typeof(line->'quantity') is distinct from 'string' or line->>'quantity' !~ '^(0|[1-9][0-9]{0,10})(\.[0-9]{0,2}[1-9])?$' then raise exception 'Invalid estimate kind or canonical quantity' using errcode='23514';end if;
  quantity:=(line->>'quantity')::numeric;if quantity<=0 then raise exception 'Positive estimate quantity required' using errcode='23514';end if;
  reason:=null;if line->'pricing_reason' is distinct from 'null'::jsonb then reason:=public.native_rx_text(line->'pricing_reason',2000);end if;
  if line#>>'{pricing,kind}'='unit' then
   perform public.native_rx_keys(line->'pricing',array['kind','unit_price_cents']);price:=public.native_finance_money(line#>'{pricing,unit_price_cents}');amount:=round(quantity*price);
  elsif line#>>'{pricing,kind}'='allocated' then
   perform public.native_rx_keys(line->'pricing',array['kind','amount_cents']);amount:=public.native_finance_money(line#>'{pricing,amount_cents}');if reason is null then raise exception 'Allocated pricing requires reason' using errcode='23514';end if;
  else raise exception 'Exact estimate pricing required' using errcode='23514';end if;
  if amount=0 and reason is null then raise exception 'Zero pricing requires reason' using errcode='23514';end if;
  perform public.native_finance_cents(amount);total:=total+amount;perform public.native_finance_cents(total);
  if p_catalog is not null then
   entry:=p_catalog->(line->>'product_id');perform public.native_rx_keys(entry,array['id','version','kind','unit','unit_price_cents','active']);perform public.native_correction_uuid(entry->'id',false);perform public.native_estimate_positive_int(entry->'version');perform public.native_finance_money(entry->'unit_price_cents');
   if entry->'id' is distinct from line->'product_id' or entry->'version' is distinct from line->'product_version' or entry->'kind' is distinct from line->'kind' or entry->'unit' is distinct from line->'unit' or entry->'active' is distinct from 'true'::jsonb then raise exception 'Estimate catalog evidence mismatch' using errcode='23514';end if;
   if line#>>'{pricing,kind}'='unit' and line#>'{pricing,unit_price_cents}' is distinct from entry->'unit_price_cents' and reason is null then raise exception 'Price override requires reason' using errcode='23514';end if;
  end if;
 end loop;
 if p_catalog is not null and (select count(*) from jsonb_object_keys(p_catalog))<>cardinality(products) then raise exception 'Extraneous estimate catalog evidence' using errcode='23514';end if;
 return public.native_finance_cents(total);
end $$;
create function public.native_estimate_validate_request(p_request jsonb) returns void language plpgsql immutable security definer set search_path=public as $$declare key_name text;begin
 perform public.native_rx_keys(p_request,array['estimate_id','client_id','pet_id','expected_version','fields']);foreach key_name in array array['estimate_id','client_id','pet_id'] loop perform public.native_correction_uuid(p_request->key_name,false);end loop;
 if p_request->'expected_version' is distinct from 'null'::jsonb then perform public.native_estimate_positive_int(p_request->'expected_version');end if;perform public.native_estimate_fields_total(p_request->'fields');
end $$;
-- Verify the entire requested prefix without consulting today's catalog or patient household.
create function public.native_estimate_verified_revision(p_id uuid,p_version integer) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare root public.native_estimate_drafts;rev public.native_estimate_draft_revisions;op public.native_estimate_draft_operations;prior_hash text;previous_stamp timestamptz;next_version bigint:=1;doc jsonb;begin
 select * into root from public.native_estimate_drafts d where d.id=p_id;if not found then return null;end if;
 if p_version is null or p_version<1 then raise exception 'Exact estimate revision required' using errcode='23514';end if;
 for rev in select r.* from public.native_estimate_draft_revisions r where r.estimate_id=p_id and r.version<=p_version order by r.version loop
  select * into op from public.native_estimate_draft_operations o where o.id=rev.operation_id;
  if op.id is null or op.estimate_id<>p_id or op.version<>rev.version or rev.version<>next_version or rev.previous_hash is distinct from prior_hash or exists(select 1 from public.native_estimate_draft_closures c where c.id=op.id) then raise exception 'Estimate revision chain or operation invalid' using errcode='23514';end if;
  perform public.native_estimate_validate_request(op.request);doc:=rev.document;perform public.native_rx_keys(doc,array['id','client_id','pet_id','version','fields','total_cents','created_by','created_at','updated_by','updated_at']);
  if doc->'id' is distinct from to_jsonb(root.id) or doc->'client_id' is distinct from to_jsonb(root.client_id) or doc->'pet_id' is distinct from to_jsonb(root.pet_id) or doc->'version' is distinct from to_jsonb(rev.version) or doc->'created_by' is distinct from to_jsonb(root.created_by) or doc->'created_at' is distinct from to_jsonb(root.created_at) or doc->'updated_by' is distinct from to_jsonb(op.actor_id) or doc->'updated_at' is distinct from to_jsonb(op.created_at)
   or op.request->'estimate_id' is distinct from doc->'id' or op.request->'client_id' is distinct from doc->'client_id' or op.request->'pet_id' is distinct from doc->'pet_id' or op.request->'fields' is distinct from doc->'fields' or op.request->'expected_version' is distinct from(case when rev.version=1 then 'null'::jsonb else to_jsonb(rev.version-1) end)
   or doc->'total_cents' is distinct from to_jsonb(public.native_estimate_fields_total(doc->'fields',rev.catalog)) or not isfinite(root.created_at) or not isfinite(op.created_at) or op.created_at<root.created_at or op.created_at<previous_stamp or (rev.version=1 and (op.actor_id<>root.created_by or op.created_at<>root.created_at)) then raise exception 'Estimate revision document mismatch' using errcode='23514';end if;
  if op.request_hash is distinct from public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',op.actor_id,'operation','save_estimate_draft','request',op.request)) or rev.record_hash is distinct from public.native_fulfillment_hash(jsonb_build_object('document',doc,'catalog',rev.catalog,'previous_hash',rev.previous_hash,'operation_id',rev.operation_id,'request_hash',op.request_hash)) then raise exception 'Estimate revision hash mismatch' using errcode='23514';end if;
  prior_hash:=rev.record_hash;previous_stamp:=op.created_at;next_version:=next_version+1;
 end loop;
 if next_version-1<>p_version then raise exception 'Estimate revision missing' using errcode='23514';end if;return doc;
end $$;
create function public.native_estimate_verified_operation(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$declare op public.native_estimate_draft_operations;doc jsonb;begin
 select * into op from public.native_estimate_draft_operations o where o.id=p_id;if not found then return null;end if;doc:=public.native_estimate_verified_revision(op.estimate_id,op.version);
 if doc is null or not exists(select 1 from public.native_estimate_draft_revisions r where r.estimate_id=op.estimate_id and r.version=op.version and r.operation_id=op.id) then raise exception 'Estimate operation revision missing' using errcode='23514';end if;
 return jsonb_build_object('version',1,'id',op.id,'actor_id',op.actor_id,'request',op.request,'request_hash',op.request_hash,'result',doc,'created_at',op.created_at);
end $$;
create function public.native_estimate_verified_closure(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$declare c public.native_estimate_draft_closures;doc jsonb;begin
 select * into c from public.native_estimate_draft_closures closed where closed.id=p_id;if not found then return null;end if;perform public.native_estimate_validate_request(c.request);
 if exists(select 1 from public.native_estimate_draft_operations o where o.id=p_id) or exists(select 1 from public.native_estimate_draft_revisions r where r.operation_id=p_id) or not isfinite(c.closed_at) or c.request_hash is distinct from public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',c.actor_id,'operation','save_estimate_draft','request',c.request)) then raise exception 'Estimate closure identity invalid' using errcode='23514';end if;
 doc:=jsonb_build_object('version',1,'id',c.id,'actor_id',c.actor_id,'request',c.request,'request_hash',c.request_hash,'closed_at',c.closed_at);if c.record_hash is distinct from public.native_fulfillment_hash(doc) then raise exception 'Estimate closure hash invalid' using errcode='23514';end if;return doc||jsonb_build_object('record_hash',c.record_hash);
end $$;
create function public.native_estimate_integrity() returns trigger language plpgsql security definer set search_path=public as $$declare v integer;begin
 if TG_TABLE_NAME='native_estimate_draft_closures' then perform public.native_estimate_verified_closure(NEW.id);
 elsif TG_TABLE_NAME='native_estimate_draft_operations' then perform public.native_estimate_verified_operation(NEW.id);
 elsif TG_TABLE_NAME='native_estimate_draft_revisions' then perform public.native_estimate_verified_revision(NEW.estimate_id,NEW.version);
 else select max(r.version) into v from public.native_estimate_draft_revisions r where r.estimate_id=NEW.id;perform public.native_estimate_verified_revision(NEW.id,v);end if;return NEW;
end $$;
do $$declare tab text;begin foreach tab in array array['native_estimate_drafts','native_estimate_draft_operations','native_estimate_draft_revisions','native_estimate_draft_closures'] loop execute format('create constraint trigger native_estimate_valid after insert on public.%I deferrable initially deferred for each row execute function public.native_estimate_integrity()',tab);end loop;end $$;
create function public.save_native_estimate_draft(p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();root public.native_estimate_drafts;product public.catalog_products;doc jsonb;receipt jsonb;catalog jsonb:='{}';line jsonb;root_id uuid;target_client_id uuid;target_pet_id uuid;version_now integer;version_next integer;stamp timestamptz;total text;prior_hash text;request_digest text;begin
 if p_id is null then raise exception 'Stable estimate operation id required' using errcode='23514';end if;perform public.native_estimate_validate_request(p_request);
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));perform public.clinical_require_staff();receipt:=public.native_estimate_verified_operation(p_id);
 if receipt is not null then if receipt->>'actor_id'<>actor::text then raise exception 'Estimate receipt unavailable' using errcode='42501';end if;if receipt->'request' is distinct from p_request then raise exception 'Estimate operation identifier already used' using errcode='23514';end if;return receipt;end if;
 doc:=public.native_estimate_verified_closure(p_id);if doc is not null then if doc->>'actor_id'<>actor::text then raise exception 'Estimate closure unavailable' using errcode='42501';end if;raise exception 'Estimate operation permanently closed' using errcode='23514';end if;
 root_id:=(p_request->>'estimate_id')::uuid;target_client_id:=(p_request->>'client_id')::uuid;target_pet_id:=(p_request->>'pet_id')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('native-estimate:'||root_id::text,0));perform public.clinical_require_staff();
 select * into root from public.native_estimate_drafts d where d.id=root_id;select max(r.version) into version_now from public.native_estimate_draft_revisions r where r.estimate_id=root_id;
 if root.id is not null then
  perform public.native_estimate_verified_revision(root_id,version_now);if root.client_id<>target_client_id or root.pet_id<>target_pet_id then raise exception 'Estimate household and patient cannot change' using errcode='23514';end if;
 end if;
 if p_request->'expected_version' is distinct from coalesce(to_jsonb(version_now),'null'::jsonb) then raise exception 'Estimate draft changed; compare current version' using errcode='40001';end if;
 perform 1 from public.clients c where c.id=target_client_id for share;if not found then raise exception 'Estimate household not found' using errcode='23514';end if;
 perform 1 from public.pets p where p.id=target_pet_id and p.client_id=target_client_id for share;if not found then raise exception 'Estimate patient must belong to household' using errcode='23514';end if;
 for product in select p.* from public.catalog_products p where p.id in(select(value->>'product_id')::uuid from jsonb_array_elements(p_request#>'{fields,lines}')) order by p.id for share loop
  if not product.active then raise exception 'Estimate catalog changed' using errcode='40001';end if;
  catalog:=catalog||jsonb_build_object(product.id::text,jsonb_build_object('id',product.id,'version',product.version,'kind',product.kind,'unit',product.unit,'unit_price_cents',product.unit_price_cents::text,'active',product.active));
 end loop;
 perform public.clinical_require_staff();
 for line in select value from jsonb_array_elements(p_request#>'{fields,lines}') loop
  if catalog->(line->>'product_id') is null or catalog#>array[line->>'product_id','version'] is distinct from line->'product_version' then raise exception 'Estimate catalog changed; review current product' using errcode='40001';end if;
 end loop;
 total:=public.native_estimate_fields_total(p_request->'fields',catalog);
 if version_now=2147483647 then raise exception 'Estimate revision limit reached' using errcode='23514';end if;
 stamp:=greatest(clock_timestamp(),(select o.created_at from public.native_estimate_draft_operations o where o.estimate_id=root_id and o.version=version_now));version_next:=coalesce(version_now,0)+1;
 if root.id is null then insert into public.native_estimate_drafts values(root_id,target_client_id,target_pet_id,actor,stamp) returning * into root;end if;
 select r.record_hash into prior_hash from public.native_estimate_draft_revisions r where r.estimate_id=root_id and r.version=version_now;
 doc:=jsonb_build_object('id',root_id,'client_id',target_client_id,'pet_id',target_pet_id,'version',version_next,'fields',p_request->'fields','total_cents',total,'created_by',root.created_by,'created_at',root.created_at,'updated_by',actor,'updated_at',stamp);
 request_digest:=public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',actor,'operation','save_estimate_draft','request',p_request));
 insert into public.native_estimate_draft_operations values(p_id,actor,p_request,request_digest,root_id,version_next,stamp);
 insert into public.native_estimate_draft_revisions values(root_id,version_next,p_id,doc,catalog,prior_hash,public.native_fulfillment_hash(jsonb_build_object('document',doc,'catalog',catalog,'previous_hash',prior_hash,'operation_id',p_id,'request_hash',request_digest)));
 perform public.clinical_require_staff();return public.native_estimate_verified_operation(p_id);
end $$;
create function public.recover_native_estimate_draft(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$declare actor uuid:=public.clinical_require_staff();receipt jsonb;begin
 receipt:=public.native_estimate_verified_operation(p_id);if receipt is not null and receipt->>'actor_id'<>actor::text then raise exception 'Estimate receipt unavailable' using errcode='42501';end if;return receipt;
end $$;
create function public.close_native_estimate_draft(p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$declare actor uuid:=public.clinical_require_staff();doc jsonb;receipt jsonb;stamp timestamptz;digest text;begin
 if p_id is null then raise exception 'Stable estimate operation id required' using errcode='23514';end if;perform public.native_estimate_validate_request(p_request);perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));perform public.clinical_require_staff();receipt:=public.native_estimate_verified_operation(p_id);
 if receipt is not null then if receipt->>'actor_id'<>actor::text then raise exception 'Estimate receipt unavailable' using errcode='42501';end if;if receipt->'request' is distinct from p_request then raise exception 'Estimate operation identifier already used' using errcode='23514';end if;return jsonb_build_object('version',1,'status','recorded','receipt',receipt);end if;
 doc:=public.native_estimate_verified_closure(p_id);
 if doc is not null then if doc->>'actor_id'<>actor::text then raise exception 'Estimate closure unavailable' using errcode='42501';end if;if doc->'request' is distinct from p_request then raise exception 'Estimate operation identifier already closed' using errcode='23514';end if;
 else stamp:=clock_timestamp();digest:=public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',actor,'operation','save_estimate_draft','request',p_request));doc:=jsonb_build_object('version',1,'id',p_id,'actor_id',actor,'request',p_request,'request_hash',digest,'closed_at',stamp);
 insert into public.native_estimate_draft_closures values(p_id,actor,p_request,digest,stamp,public.native_fulfillment_hash(doc));doc:=public.native_estimate_verified_closure(p_id);end if;
 perform public.clinical_require_staff();return jsonb_build_object('version',1,'status','closed_unrecorded','closure',doc);
end $$;
create function public.read_native_estimate_draft(p_id uuid,p_client_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$declare actor uuid:=public.clinical_require_staff();root public.native_estimate_drafts;v integer;doc jsonb;begin
 if p_id is null or p_client_id is null then raise exception 'Exact household estimate identity required' using errcode='23514';end if;select * into root from public.native_estimate_drafts d where d.id=p_id;
 if root.id is not null then if root.client_id<>p_client_id then raise exception 'Estimate household mismatch' using errcode='23514';end if;select max(r.version) into v from public.native_estimate_draft_revisions r where r.estimate_id=p_id;doc:=public.native_estimate_verified_revision(p_id,v);end if;
 return jsonb_build_object('version',1,'actor_id',actor,'draft',doc);
end $$;
create function public.list_native_estimate_drafts(p_client_id uuid,p_before_at timestamptz,p_before_id uuid,p_limit integer) returns jsonb language plpgsql stable security definer set search_path=public as $$declare actor uuid:=public.clinical_require_staff();root public.native_estimate_drafts;drafts jsonb:='[]';has_more boolean:=false;cursor_value jsonb;v integer;n integer:=0;begin
 if p_client_id is null or p_limit is null or p_limit not between 1 and 100 or(p_before_at is null)<>(p_before_id is null) or(p_before_at is not null and not isfinite(p_before_at)) then raise exception 'Valid estimate page required' using errcode='23514';end if;
 for root in select d.* from public.native_estimate_drafts d where d.client_id=p_client_id and(p_before_at is null or(d.created_at,d.id)<(p_before_at,p_before_id)) order by d.created_at desc,d.id desc limit p_limit+1 loop
  n:=n+1;if n>p_limit then has_more:=true;exit;end if;select max(r.version) into v from public.native_estimate_draft_revisions r where r.estimate_id=root.id;drafts:=drafts||jsonb_build_array(public.native_estimate_verified_revision(root.id,v));cursor_value:=jsonb_build_object('before_at',root.created_at,'before_id',root.id);
 end loop;
 return jsonb_build_object('version',1,'actor_id',actor,'client_id',p_client_id,'drafts',drafts,'has_more',has_more,'next_cursor',case when has_more then cursor_value else null end);
end $$;
create function public.read_native_estimate_draft_history(p_id uuid,p_client_id uuid,p_before_version integer,p_limit integer) returns jsonb language plpgsql stable security definer set search_path=public as $$declare actor uuid:=public.clinical_require_staff();root public.native_estimate_drafts;rev_version integer;revisions jsonb:='[]';n integer:=0;has_more boolean:=false;cursor_version integer;begin
 if p_id is null or p_client_id is null or p_limit is null or p_limit not between 1 and 100 or(p_before_version is not null and p_before_version<1) then raise exception 'Valid estimate history page required' using errcode='23514';end if;select * into root from public.native_estimate_drafts d where d.id=p_id;
 if root.id is not null and root.client_id<>p_client_id then raise exception 'Estimate household mismatch' using errcode='23514';end if;
 for rev_version in select r.version from public.native_estimate_draft_revisions r where r.estimate_id=p_id and(p_before_version is null or r.version<p_before_version) order by r.version desc limit p_limit+1 loop
  n:=n+1;if n>p_limit then has_more:=true;exit;end if;revisions:=revisions||jsonb_build_array(public.native_estimate_verified_revision(p_id,rev_version));cursor_version:=rev_version;
 end loop;
 return jsonb_build_object('version',1,'actor_id',actor,'estimate_id',p_id,'client_id',p_client_id,'revisions',revisions,'has_more',has_more,'next_before_version',case when has_more then cursor_version else null end);
end $$;
do $$declare fn record;begin
 for fn in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and(proname like 'native_estimate_%' or proname in('save_native_estimate_draft','recover_native_estimate_draft','close_native_estimate_draft','read_native_estimate_draft','list_native_estimate_drafts','read_native_estimate_draft_history')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.signature);if fn.proname not like 'native_estimate_%' then execute format('grant execute on function %s to authenticated',fn.signature);end if;
 end loop;
end $$;
