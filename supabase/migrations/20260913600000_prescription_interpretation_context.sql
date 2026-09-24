-- Strict interpretation of outside evidence, shared by preparation and future approval.
create function public.ezyvet_prescription_review_date(p_date jsonb,p_status jsonb) returns void
language plpgsql immutable set search_path=pg_catalog as $$declare d text:=p_date#>>'{}';st text:=p_status#>>'{}';begin
 if p_date is null or jsonb_typeof(p_status) is distinct from 'string' or st not in ('date','unknown','uninterpreted')
  or (st='date')<>(p_date<>'null'::jsonb) then raise exception 'Explicit prescription date precision required' using errcode='23514';end if;
 if st='date' then
  if jsonb_typeof(p_date)<>'string' or d !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Date-only value required' using errcode='23514';end if;
  begin
   if d<>(d::date)::text or not isfinite(d::date) then raise exception 'Invalid prescription date' using errcode='23514';end if;
  exception when datetime_field_overflow or invalid_datetime_format then raise exception 'Invalid prescription date' using errcode='23514';end;
 end if;
end $$;
create function public.ezyvet_prescription_interpretation_context(p_source jsonb,p_review jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare keys text[]:=array['prescribed_on','prescription_date_status','status','outside_author','reason','completeness','partial_reason','items','replaces_id','expected_predecessor_hash'];
 item_keys text[]:=array['snapshot_id','start_on','start_date_status','product_id','product_version','note'];
 x jsonb;s jsonb;product public.catalog_products;products jsonb:='{}';selected jsonb:='[]';omitted jsonb;
 selected_ids uuid[]:='{}';product_ref record;
begin
 if p_review is null or jsonb_typeof(p_review)<>'object' then raise exception 'Exact prescription interpretation required' using errcode='23514';end if;
 if not(p_review ?& keys) or (p_review-keys)<>'{}'::jsonb then raise exception 'Exact prescription interpretation required' using errcode='23514';end if;
 if jsonb_typeof(p_review->'reason') is distinct from 'string' or length(btrim(p_review->>'reason')) not between 5 and 2000
  or p_review->>'reason'<>btrim(p_review->>'reason') then raise exception 'Prescription review rationale required' using errcode='23514';end if;
 if jsonb_typeof(p_review->'status') is distinct from 'string' or p_review->>'status' not in ('active','inactive','unknown') then
  raise exception 'Explicit historical prescription status required' using errcode='23514';end if;
 if p_review->'outside_author'<>'null'::jsonb and (jsonb_typeof(p_review->'outside_author')<>'string'
  or length(btrim(p_review->>'outside_author')) not between 1 and 500 or p_review->>'outside_author'<>btrim(p_review->>'outside_author')) then
  raise exception 'Invalid outside prescriber interpretation' using errcode='23514';end if;
 perform public.ezyvet_prescription_review_date(p_review->'prescribed_on',p_review->'prescription_date_status');
 if jsonb_typeof(p_review->'completeness') is distinct from 'string' or p_review->>'completeness' not in ('complete','partial') then
  raise exception 'Explicit historical completeness required' using errcode='23514';end if;
 if p_review->>'completeness'='partial' then
  if jsonb_typeof(p_review->'partial_reason') is distinct from 'string' or length(btrim(p_review->>'partial_reason')) not between 5 and 2000
   or p_review->>'partial_reason'<>btrim(p_review->>'partial_reason') then raise exception 'Partial prescription disclosure required' using errcode='23514';end if;
 elsif p_review->'partial_reason'<>'null'::jsonb then raise exception 'Complete prescription cannot carry partial disclosure' using errcode='23514';end if;
 if (p_review->'replaces_id'='null'::jsonb)<>(p_review->'expected_predecessor_hash'='null'::jsonb) then raise exception 'Complete prescription predecessor pair required' using errcode='23514';end if;
 if p_review->'replaces_id'<>'null'::jsonb and (jsonb_typeof(p_review->'replaces_id')<>'string'
  or p_review->>'replaces_id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  or jsonb_typeof(p_review->'expected_predecessor_hash')<>'string' or p_review->>'expected_predecessor_hash' !~ '^[a-f0-9]{64}$') then
  raise exception 'Valid prescription predecessor required' using errcode='23514';end if;
 if p_source#>>'{consult,status}' is null or p_source#>>'{consult,status}' not in ('resolved','not_supplied') then
  raise exception 'Resolve supplied source consultation before review' using errcode='40001';end if;
 if jsonb_typeof(p_review->'items') is distinct from 'array' then raise exception 'Selected prescription items required' using errcode='23514';end if;
 if jsonb_array_length(p_review->'items')>200 then raise exception 'Review at most 200 prescription items' using errcode='23514';end if;
 -- Validate identities before casts or catalog locks. Every selection must come
 -- from this exact scoped run; browser-supplied originals are never accepted.
 for x in select value from jsonb_array_elements(p_review->'items') loop
  if jsonb_typeof(x)<>'object' then raise exception 'Exact prescription item interpretation required' using errcode='23514';end if;
  if not(x ?& item_keys) or (x-item_keys)<>'{}'::jsonb or jsonb_typeof(x->'snapshot_id')<>'string'
   or x->>'snapshot_id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
   raise exception 'Exact prescription item interpretation required' using errcode='23514';end if;
  if (x->>'snapshot_id')::uuid=any(selected_ids) then raise exception 'Select each prescription item once' using errcode='23514';end if;
  selected_ids:=array_append(selected_ids,(x->>'snapshot_id')::uuid);
  select value into s from jsonb_array_elements(p_source->'items') where (value->>'snapshot_id')::uuid=(x->>'snapshot_id')::uuid limit 1;
  if not found then raise exception 'Selected item is outside scoped prescription evidence' using errcode='42501';end if;
  perform public.ezyvet_prescription_review_date(x->'start_on',x->'start_date_status');
  if x->'note'<>'null'::jsonb and (jsonb_typeof(x->'note')<>'string' or length(btrim(x->>'note')) not between 1 and 2000 or x->>'note'<>btrim(x->>'note')) then
   raise exception 'Invalid separate item interpretation' using errcode='23514';end if;
  if (x->'product_id'='null'::jsonb)<>(x->'product_version'='null'::jsonb) then raise exception 'Complete catalog match pair required' using errcode='23514';end if;
  if x->'product_id'<>'null'::jsonb then
   if jsonb_typeof(x->'product_id')<>'string' or x->>'product_id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or jsonb_typeof(x->'product_version')<>'number' or x->>'product_version' !~ '^[1-9][0-9]{0,9}$' then raise exception 'Valid catalog match required' using errcode='23514';end if;
  end if;
 end loop;
 -- All source heads are already held by the collector; product UUIDs lock in
 -- canonical order even when clinicians select medications in opposite orders.
 for product_ref in select distinct (value->>'product_id')::uuid id from jsonb_array_elements(p_review->'items') where value->>'product_id' is not null order by id loop
  select * into product from public.catalog_products where id=product_ref.id for share;
  if not found or not product.active or product.kind<>'medication' or exists(select 1 from jsonb_array_elements(p_review->'items') candidate(value)
   where (candidate.value->>'product_id')::uuid=product_ref.id and (candidate.value->>'product_version')::numeric<>product.version::numeric) then
   raise exception 'Catalog medication changed; review again' using errcode='40001';end if;
  products:=products||jsonb_build_object(product.id::text,jsonb_build_object('id',product.id,'version',product.version,'name',product.name,'kind',product.kind,'unit',product.unit));
 end loop;
 for x in select value from jsonb_array_elements(p_review->'items') loop
  select value into s from jsonb_array_elements(p_source->'items') where (value->>'snapshot_id')::uuid=(x->>'snapshot_id')::uuid limit 1;
  selected:=selected||jsonb_build_array(jsonb_build_object('source',s,'reviewed',x-array['snapshot_id','product_id','product_version'],
   'product',products->((x->>'product_id')::uuid)::text));
 end loop;
 select coalesce(jsonb_agg(value order by value->>'external_id',value->>'snapshot_id'),'[]') into omitted
  from jsonb_array_elements(p_source->'items') where not((value->>'snapshot_id')::uuid=any(selected_ids));
 if p_review->>'completeness'='complete' and (p_source#>>'{reconciliation,status}' is distinct from 'matched' or jsonb_array_length(omitted)>0) then
  raise exception 'Complete account requires matched source list and every observed item' using errcode='23514';end if;
 return p_source||jsonb_build_object('reviewed',p_review-array['items','replaces_id','expected_predecessor_hash'],
  'selected_items',selected,'omitted_items',omitted);
end $$;
revoke all on function public.ezyvet_prescription_review_date(jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.ezyvet_prescription_interpretation_context(jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.prepare_ezyvet_prescription_review(p_id uuid,p_pet_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare actor uuid:=public.ezyvet_prescription_require_dvm();r public.ezyvet_prescription_review_requests;context jsonb;begin
 if p_id is null or p_pet_id is null then raise exception 'Durable operation and patient required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,5900));
 select * into r from public.ezyvet_prescription_review_requests where id=p_id;
 if found then
  if row(r.actor_id,r.pet_id,r.payload) is distinct from row(actor,p_pet_id,p_payload) or r.status='abandoned' then
   raise exception 'Review request identity cannot change or revive' using errcode='42501';end if;
  return public.ezyvet_prescription_review_projection(p_id);
 end if;
 -- Preparation validates interpretation; explicit approval still remains separate.
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>262144
  or not(p_payload ?& array['item_run_id','patient_version','interpretation'])
  or (p_payload-array['item_run_id','patient_version','interpretation'])<>'{}'::jsonb
  or jsonb_typeof(p_payload->'interpretation') is distinct from 'object'
  or jsonb_typeof(p_payload->'item_run_id') is distinct from 'string'
  or coalesce(p_payload->>'item_run_id','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  or jsonb_typeof(p_payload->'patient_version') is distinct from 'number'
  or coalesce(p_payload->>'patient_version','') !~ '^[1-9][0-9]{0,9}$'
  then raise exception 'Patient version, item run and draft interpretation required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 -- Collector locks run, then mapping/patient and source heads. Do not acquire
 -- a patient row lock before the run: intake uses run-before-patient order.
 context:=public.ezyvet_prescription_source_context(p_pet_id,(p_payload->>'item_run_id')::uuid);
 if not exists(select 1 from public.pets where id=p_pet_id and version::numeric=(p_payload->>'patient_version')::numeric) then
  raise exception 'Patient version changed' using errcode='40001';end if;
 context:=public.ezyvet_prescription_interpretation_context(context,p_payload->'interpretation');
 context:=context||jsonb_build_object('patient_version',p_payload->'patient_version');
 insert into public.ezyvet_prescription_review_requests(id,actor_id,pet_id,status,payload,request_hash,review_context)
 values(p_id,actor,p_pet_id,'prepared',p_payload,encode(digest(jsonb_build_array(p_payload,context)::text,'sha256'),'hex'),context);
 return public.ezyvet_prescription_review_projection(p_id);
end $$;
