-- Explicit DVM interpretation of outside evidence; never native administration.
create table public.ezyvet_vaccination_review_requests (
 id uuid primary key,actor_id uuid not null references public.profiles(id),pet_id uuid not null references public.pets(id),
 status text not null check(status in ('prepared','approved','abandoned')),payload jsonb,request_hash text,review_context jsonb,
 approved_record_id uuid,created_at timestamptz not null default clock_timestamp(),resolved_at timestamptz,
 check(status='abandoned' or(payload is not null and request_hash is not null and review_context is not null)),
 check((status='approved')=(approved_record_id is not null))
);
create table public.ezyvet_imported_vaccinations (
 id uuid primary key references public.ezyvet_vaccination_review_requests(id),pet_id uuid not null references public.pets(id),client_id uuid not null references public.clients(id),animal_link_id uuid not null references public.ezyvet_record_links(id),
 source_origin text not null,source_site_uid text not null,animal_external_id text not null,vaccination_external_id text not null,
 version integer not null check(version>0),version_hash text not null check(version_hash ~ '^[a-f0-9]{64}$'),interpretation_hash text not null,
 snapshot_id uuid not null references public.ezyvet_import_snapshots(id),payload_hash text not null,observed_head_version integer not null check(observed_head_version>0),
 original jsonb not null,consult jsonb not null,reviewed jsonb not null,product jsonb,
 reason text not null,replaces_id uuid unique references public.ezyvet_imported_vaccinations(id),expected_predecessor_hash text,
 approved_by uuid not null references public.profiles(id),approved_at timestamptz not null default clock_timestamp(),
 unique(source_origin,source_site_uid,animal_link_id,vaccination_external_id,version),check((replaces_id is null)=(expected_predecessor_hash is null))
);
alter table public.ezyvet_vaccination_review_requests add foreign key(approved_record_id) references public.ezyvet_imported_vaccinations(id);
create index ezyvet_vaccination_review_actor on public.ezyvet_vaccination_review_requests(actor_id,pet_id,created_at desc,id desc);
create index ezyvet_imported_vaccination_patient on public.ezyvet_imported_vaccinations(pet_id,approved_at desc,id desc);
create function public.ezyvet_vaccination_review_guard() returns trigger language plpgsql set search_path=public as $$begin
 if TG_OP='DELETE' or (to_jsonb(NEW)-array['status','resolved_at','approved_record_id']) is distinct from(to_jsonb(OLD)-array['status','resolved_at','approved_record_id']) or OLD.status<>'prepared' or NEW.status not in ('approved','abandoned') then raise exception 'Vaccination review evidence is immutable' using errcode='23514';end if;return NEW;
end $$;
do $$declare t text;begin foreach t in array array['ezyvet_vaccination_review_requests','ezyvet_imported_vaccinations'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger immutable_vaccination_review before update or delete on public.%I for each row execute function public.%I()',t,case when t='ezyvet_vaccination_review_requests' then 'ezyvet_vaccination_review_guard' else 'guard_inquiry_history' end);
end loop;end $$;
create function public.ezyvet_vaccination_require_dvm() returns uuid language plpgsql stable security definer set search_path=public as $$declare actor uuid:=public.clinical_require_staff();begin
 if public.has_role(actor,'DVM') is not true then raise exception 'Active veterinarian required' using errcode='42501';end if;return actor;end $$;

create function public.ezyvet_vaccination_current(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('is_latest',not exists(select 1 from public.ezyvet_imported_vaccinations n where n.replaces_id=v.id),
 'identity_valid',coalesce(m.pet_id=v.pet_id and m.client_id=v.client_id and p.client_id=v.client_id and m.resource='animal' and row(m.source_origin,m.source_site_uid,m.external_id)=row(v.source_origin,v.source_site_uid,v.animal_external_id),false),
 'snapshot_id',h.snapshot_id,'head_version',h.version,'consult_snapshot_id',ch.snapshot_id,'consult_head_version',ch.version,
 'is_current',coalesce(m.pet_id=v.pet_id and m.client_id=v.client_id and p.client_id=v.client_id and m.resource='animal' and row(m.source_origin,m.source_site_uid,m.external_id)=row(v.source_origin,v.source_site_uid,v.animal_external_id) and h.snapshot_id=v.snapshot_id and h.version=v.observed_head_version and ch.snapshot_id=(v.consult->>'snapshot_id')::uuid and ch.version=(v.consult->>'observed_head_version')::integer,false))
 from public.ezyvet_imported_vaccinations v left join public.ezyvet_record_links m on m.id=v.animal_link_id left join public.pets p on p.id=v.pet_id
 left join public.ezyvet_identity_heads h on h.source_origin=v.source_origin and h.source_site_uid=v.source_site_uid and h.resource='vaccination' and h.external_id=v.vaccination_external_id
 left join public.ezyvet_identity_heads ch on ch.source_origin=v.source_origin and ch.source_site_uid=v.source_site_uid and ch.resource='consult' and ch.external_id=v.consult->>'external_id' where v.id=p_id;
$$;
create function public.ezyvet_imported_vaccination_projection(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select (to_jsonb(v)-array['source_origin','source_site_uid','animal_external_id','vaccination_external_id','interpretation_hash'])||jsonb_build_object('source',jsonb_build_object('origin',v.source_origin,'site_uid',v.source_site_uid,'animal_id',v.animal_external_id,'vaccination_id',v.vaccination_external_id),'current',public.ezyvet_vaccination_current(v.id),'correction_history',(select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'version',n.version,'version_hash',n.version_hash,'replaces_id',n.replaces_id,'reason',n.reason,'approved_by',n.approved_by,'approved_at',n.approved_at) order by n.version),'[]') from public.ezyvet_imported_vaccinations n where row(n.source_origin,n.source_site_uid,n.animal_link_id,n.vaccination_external_id)=row(v.source_origin,v.source_site_uid,v.animal_link_id,v.vaccination_external_id))) from public.ezyvet_imported_vaccinations v where id=p_id;
$$;
create function public.ezyvet_vaccination_review_projection(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('request',to_jsonb(r),'receipt',public.ezyvet_imported_vaccination_projection(r.approved_record_id)) from public.ezyvet_vaccination_review_requests r where id=p_id;
$$;
create function public.ezyvet_vaccination_review_context(p_pet_id uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.ezyvet_record_links;s public.ezyvet_import_snapshots;cs public.ezyvet_import_snapshots;h public.ezyvet_identity_heads;product public.catalog_products; k text;d text;st text;expected text[]:=array['animal_link_id','patient_version','snapshot_id','payload_hash','observed_head_version','consult_snapshot_id','consult_payload_hash','consult_observed_head_version','product_id','product_version','administered_on','administration_date_status','source_next_due_on','next_date_status','status','outside_author','reason','replaces_id','expected_predecessor_hash'];begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or (select count(*) from jsonb_object_keys(p_payload))<>cardinality(expected) or exists(select 1 from jsonb_object_keys(p_payload) x where not x=any(expected)) then raise exception 'Exact vaccination review fields required' using errcode='23514';end if;
 foreach k in array array['animal_link_id','snapshot_id','consult_snapshot_id'] loop
  if jsonb_typeof(p_payload->k) is distinct from 'string' or p_payload->>k !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' then raise exception 'Valid source UUID required' using errcode='23514';end if;
 end loop;
 foreach k in array array['payload_hash','consult_payload_hash'] loop
  if jsonb_typeof(p_payload->k) is distinct from 'string' or p_payload->>k !~ '^[a-f0-9]{64}$' then raise exception 'Valid source hash required' using errcode='23514';end if;
 end loop;
 foreach k in array array['patient_version','observed_head_version','consult_observed_head_version'] loop
  if jsonb_typeof(p_payload->k) is distinct from 'number' or p_payload->>k !~ '^[1-9][0-9]{0,9}$' or (p_payload->>k)::numeric>2147483647 then raise exception 'Positive source revision required' using errcode='23514';end if;
 end loop;
 if jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(trim(p_payload->>'reason')) not between 5 and 2000 or p_payload->>'reason'<>trim(p_payload->>'reason') or p_payload->>'status' is null or p_payload->>'status' not in ('administered','not_administered','unknown') or jsonb_typeof(p_payload->'status')<>'string' then raise exception 'Explicit clinical interpretation and rationale required' using errcode='23514';end if;
 if p_payload->'outside_author'<>'null'::jsonb and (jsonb_typeof(p_payload->'outside_author')<>'string' or length(trim(p_payload->>'outside_author')) not between 1 and 500 or p_payload->>'outside_author'<>trim(p_payload->>'outside_author')) then raise exception 'Invalid outside author' using errcode='23514';end if;
 foreach k in array array['administered_on','source_next_due_on'] loop
  d:=p_payload->>k;st:=p_payload->>case when k='administered_on' then 'administration_date_status' else 'next_date_status' end;
  if st is null or st not in ('date','unknown','uninterpreted') or (st='date')<>(d is not null) then raise exception 'Explicit date precision required' using errcode='23514';end if;
  if d is not null then
   if jsonb_typeof(p_payload->k)<>'string' or d !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Date-only value required' using errcode='23514';end if;
   begin if d<>(d::date)::text or not isfinite(d::date) then raise exception 'Invalid date' using errcode='23514';end if;exception when datetime_field_overflow or invalid_datetime_format then raise exception 'Invalid date' using errcode='23514';end;
  end if;
 end loop;
 if (p_payload->>'product_id' is null)<>(p_payload->>'product_version' is null) or (p_payload->>'replaces_id' is null)<>(p_payload->>'expected_predecessor_hash' is null) then raise exception 'Complete product or predecessor pair required' using errcode='23514';end if;
 if p_payload->>'product_id' is not null then
  if jsonb_typeof(p_payload->'product_id')<>'string' or p_payload->>'product_id' !~ '^[a-fA-F0-9-]{36}$' or jsonb_typeof(p_payload->'product_version')<>'number' or p_payload->>'product_version' !~ '^[1-9][0-9]{0,9}$' or (p_payload->>'product_version')::numeric>2147483647 then raise exception 'Valid product version required' using errcode='23514';end if;
 end if;
 if p_payload->>'replaces_id' is not null and(jsonb_typeof(p_payload->'replaces_id')<>'string' or p_payload->>'replaces_id' !~ '^[a-fA-F0-9-]{36}$' or jsonb_typeof(p_payload->'expected_predecessor_hash')<>'string' or p_payload->>'expected_predecessor_hash' !~ '^[a-f0-9]{64}$') then raise exception 'Valid predecessor required' using errcode='23514';end if;
 select * into m from public.ezyvet_record_links where id=(p_payload->>'animal_link_id')::uuid and resource='animal' for share;
 if not found or m.pet_id is distinct from p_pet_id then raise exception 'Same-patient mapping required' using errcode='42501';end if;
 perform 1 from public.pets where id=p_pet_id and client_id=m.client_id and version=(p_payload->>'patient_version')::integer for share;
 if not found then raise exception 'Patient changed; review again' using errcode='40001';end if;
 cs:=public.ezyvet_validate_vaccination_consult(m.id,m.source_origin,m.source_site_uid,(p_payload->>'consult_snapshot_id')::uuid,p_payload->>'consult_payload_hash',(p_payload->>'consult_observed_head_version')::integer);
 select * into s from public.ezyvet_import_snapshots where id=(p_payload->>'snapshot_id')::uuid;
 if s.id is null or row(s.resource,s.source_origin,s.source_site_uid,s.payload_hash,s.payload->>'consult_id') is distinct from row('vaccination'::text,m.source_origin,m.source_site_uid,p_payload->>'payload_hash',cs.external_id) then raise exception 'Vaccination source identity mismatch' using errcode='42501';end if;
 select * into h from public.ezyvet_identity_heads where source_origin=s.source_origin and source_site_uid=s.source_site_uid and resource='vaccination' and external_id=s.external_id for share;
 if h.snapshot_id is distinct from s.id or h.version is distinct from(p_payload->>'observed_head_version')::integer or not exists(select 1 from public.ezyvet_vaccination_page_observations o join public.ezyvet_vaccination_runs r on r.run_id=o.run_id where o.snapshot_id=s.id and o.head_version=h.version and row(r.animal_link_id,r.pet_id,r.client_id,r.source_origin,r.source_site_uid,r.animal_external_id,r.consult_snapshot_id,r.consult_payload_hash,r.consult_observed_head_version)=row(m.id,p_pet_id,m.client_id,m.source_origin,m.source_site_uid,m.external_id,cs.id,cs.payload_hash,(p_payload->>'consult_observed_head_version')::integer)) then raise exception 'Current scoped vaccination receipt required' using errcode='40001';end if;
 if p_payload->>'product_id' is not null then select * into product from public.catalog_products where id=(p_payload->>'product_id')::uuid for share;
  if not found or product.version is distinct from(p_payload->>'product_version')::integer or product.kind<>'vaccine' or not product.active then raise exception 'Catalog product changed; review again' using errcode='40001';end if;
 end if;
 return jsonb_build_object('pet_id',p_pet_id,'client_id',m.client_id,'animal_link_id',m.id,'source',jsonb_build_object('origin',m.source_origin,'site_uid',m.source_site_uid,'animal_id',m.external_id,'vaccination_id',s.external_id),'snapshot_id',s.id,'payload_hash',s.payload_hash,'observed_head_version',h.version,'original',s.payload,'consult',jsonb_build_object('snapshot_id',cs.id,'payload_hash',cs.payload_hash,'observed_head_version',(p_payload->>'consult_observed_head_version')::integer,'external_id',cs.external_id),'reviewed',jsonb_build_object('administered_on',p_payload->'administered_on','administration_date_status',p_payload->'administration_date_status','source_next_due_on',p_payload->'source_next_due_on','next_date_status',p_payload->'next_date_status','status',p_payload->'status','outside_author',p_payload->'outside_author'),'product',case when product.id is not null then jsonb_build_object('id',product.id,'version',product.version,'name',product.name,'kind',product.kind) end);
end $$;
create function public.ezyvet_vaccination_review_predecessor(p_context jsonb,p_payload jsonb) returns public.ezyvet_imported_vaccinations language plpgsql security definer set search_path=public,extensions as $$
declare latest public.ezyvet_imported_vaccinations;interpretation text:=encode(digest(p_context::text,'sha256'),'hex');begin
 select * into latest from public.ezyvet_imported_vaccinations where animal_link_id=(p_context->>'animal_link_id')::uuid and source_origin=p_context#>>'{source,origin}' and source_site_uid=p_context#>>'{source,site_uid}' and vaccination_external_id=p_context#>>'{source,vaccination_id}' order by version desc limit 1;
 if latest.id is not null and latest.interpretation_hash=interpretation then
  if p_payload->>'replaces_id' is not null and row((p_payload->>'replaces_id')::uuid,p_payload->>'expected_predecessor_hash') is distinct from row(latest.id,latest.version_hash) and row((p_payload->>'replaces_id')::uuid,p_payload->>'expected_predecessor_hash') is distinct from row(latest.replaces_id,latest.expected_predecessor_hash) then raise exception 'Vaccination predecessor identity mismatch' using errcode='40001';end if;
  return latest;end if;
 if latest.id is null then
  if p_payload->>'replaces_id' is not null then raise exception 'No predecessor for this vaccination identity' using errcode='40001';end if;
 elsif row(latest.id,latest.version_hash) is distinct from row((p_payload->>'replaces_id')::uuid,p_payload->>'expected_predecessor_hash') then raise exception 'Latest vaccination predecessor and rationale required' using errcode='40001';end if;
 return latest;
end $$;
create function public.prepare_ezyvet_vaccination_review(p_id uuid,p_pet_id uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare actor uuid:=public.ezyvet_vaccination_require_dvm();r public.ezyvet_vaccination_review_requests;context jsonb;begin
 if p_id is null or p_pet_id is null then raise exception 'Durable operation and patient required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,5300));select * into r from public.ezyvet_vaccination_review_requests where id=p_id;
 if found then
  if row(r.actor_id,r.pet_id,r.payload) is distinct from row(actor,p_pet_id,p_payload) or r.status='abandoned' then raise exception 'Review request identity cannot change or revive' using errcode='42501';end if;return public.ezyvet_vaccination_review_projection(p_id);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 -- Patient serializes all valid approvals of this mapping, including competing clinician UUIDs.
 context:=public.ezyvet_vaccination_review_context(p_pet_id,p_payload);
 perform public.ezyvet_vaccination_review_predecessor(context,p_payload);
 insert into public.ezyvet_vaccination_review_requests(id,actor_id,pet_id,status,payload,request_hash,review_context) values(p_id,actor,p_pet_id,'prepared',p_payload,encode(digest(p_payload::text,'sha256'),'hex'),context);
 return public.ezyvet_vaccination_review_projection(p_id);
end $$;
create function public.approve_ezyvet_vaccination_review(p_id uuid,p_pet_id uuid,p_expected_hash text,p_confirmed boolean) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare actor uuid:=public.ezyvet_vaccination_require_dvm();r public.ezyvet_vaccination_review_requests;context jsonb;old public.ezyvet_imported_vaccinations;record_id uuid;moment timestamptz:=clock_timestamp();ih text;begin
 if p_confirmed is distinct from true then raise exception 'Explicit veterinarian confirmation required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,5300));select * into r from public.ezyvet_vaccination_review_requests where id=p_id for update;
 if not found or row(r.actor_id,r.pet_id,r.request_hash) is distinct from row(actor,p_pet_id,p_expected_hash) then raise exception 'Exact owned prepared review required' using errcode='42501';end if;
 if r.status='approved' then return public.ezyvet_vaccination_review_projection(p_id);end if;
 if r.status<>'prepared' then raise exception 'Abandoned review cannot approve' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 context:=public.ezyvet_vaccination_review_context(p_pet_id,r.payload);
 if context is distinct from r.review_context then raise exception 'Prepared review context changed' using errcode='40001';end if;
 old:=public.ezyvet_vaccination_review_predecessor(context,r.payload);ih:=encode(digest(context::text,'sha256'),'hex');
 if old.id is not null and old.interpretation_hash=ih then record_id:=old.id;
 else
  record_id:=p_id;
  insert into public.ezyvet_imported_vaccinations(id,pet_id,client_id,animal_link_id,source_origin,source_site_uid,animal_external_id,vaccination_external_id,version,version_hash,interpretation_hash,snapshot_id,payload_hash,observed_head_version,original,consult,reviewed,product,reason,replaces_id,expected_predecessor_hash,approved_by,approved_at)
  values(p_id,p_pet_id,(context->>'client_id')::uuid,(context->>'animal_link_id')::uuid,context#>>'{source,origin}',context#>>'{source,site_uid}',context#>>'{source,animal_id}',context#>>'{source,vaccination_id}',coalesce(old.version,0)+1,encode(digest(jsonb_build_array(p_id,context,r.payload,actor,moment,old.id)::text,'sha256'),'hex'),ih,(context->>'snapshot_id')::uuid,context->>'payload_hash',(context->>'observed_head_version')::integer,context->'original',context->'consult',context->'reviewed',nullif(context->'product','null'::jsonb),r.payload->>'reason',old.id,old.version_hash,actor,moment);
 end if;
 update public.ezyvet_vaccination_review_requests set status='approved',resolved_at=clock_timestamp(),approved_record_id=record_id where id=p_id;
 return public.ezyvet_vaccination_review_projection(p_id);
end $$;
create function public.recover_ezyvet_vaccination_review(p_id uuid,p_pet_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.ezyvet_vaccination_require_dvm();r public.ezyvet_vaccination_review_requests;begin
 select * into r from public.ezyvet_vaccination_review_requests where id=p_id;if not found then return null;end if;
 if row(r.actor_id,r.pet_id) is distinct from row(actor,p_pet_id) then raise exception 'Review identity mismatch' using errcode='42501';end if;return public.ezyvet_vaccination_review_projection(p_id);end $$;
create function public.abandon_ezyvet_vaccination_review(p_id uuid,p_pet_id uuid,p_confirmed boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.ezyvet_vaccination_require_dvm();r public.ezyvet_vaccination_review_requests;begin
 if p_id is null or p_pet_id is null or p_confirmed is distinct from true then raise exception 'Explicit durable abandonment required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,5300));select * into r from public.ezyvet_vaccination_review_requests where id=p_id for update;
 if found then
  if row(r.actor_id,r.pet_id) is distinct from row(actor,p_pet_id) then raise exception 'Review identity mismatch' using errcode='42501';end if;
  if r.status='prepared' then update public.ezyvet_vaccination_review_requests set status='abandoned',resolved_at=clock_timestamp() where id=p_id;end if;
 else insert into public.ezyvet_vaccination_review_requests(id,actor_id,pet_id,status,resolved_at) values(p_id,actor,p_pet_id,'abandoned',clock_timestamp());end if;
 return public.ezyvet_vaccination_review_projection(p_id);end $$;
create function public.list_ezyvet_vaccination_review_requests(p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.ezyvet_vaccination_require_dvm();rows jsonb;more boolean;lastrow jsonb;begin
 if p_pet_id is null or p_limit is null or p_limit not between 1 and 50 or(p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid request cursor' using errcode='23514';end if;
 select coalesce(jsonb_agg(public.ezyvet_vaccination_review_projection(id) order by created_at desc,id desc),'[]') into rows from(select id,created_at from public.ezyvet_vaccination_review_requests where actor_id=actor and pet_id=p_pet_id and(p_before_at is null or(created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit p_limit+1) s;
 more:=jsonb_array_length(rows)>p_limit;if more then rows:=rows-p_limit;end if;lastrow:=rows->(jsonb_array_length(rows)-1)->'request';return jsonb_build_object('requests',rows,'has_more',more,'next_cursor',case when more then jsonb_build_object('before_at',lastrow->'created_at','before_id',lastrow->'id') end);end $$;
create function public.list_patient_imported_vaccinations(p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows jsonb;more boolean;lastrow jsonb;begin
 perform public.clinical_require_staff();if p_pet_id is null or p_limit is null or p_limit not between 1 and 50 or(p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid vaccination chart cursor' using errcode='23514';end if;
 select coalesce(jsonb_agg(public.ezyvet_imported_vaccination_projection(id) order by approved_at desc,id desc),'[]') into rows from(select id,approved_at from public.ezyvet_imported_vaccinations where pet_id=p_pet_id and(p_before_at is null or(approved_at,id)<(p_before_at,p_before_id)) order by approved_at desc,id desc limit p_limit+1) s;
 more:=jsonb_array_length(rows)>p_limit;if more then rows:=rows-p_limit;end if;lastrow:=rows->(jsonb_array_length(rows)-1);return jsonb_build_object('vaccinations',rows,'has_more',more,'next_cursor',case when more then jsonb_build_object('before_at',lastrow->'approved_at','before_id',lastrow->'id') end);end $$;
create function public.list_ezyvet_vaccination_review_mappings(p_pet_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$begin
 perform public.ezyvet_vaccination_require_dvm();if p_pet_id is null then raise exception 'Patient required' using errcode='23514';end if;
 if(select count(*) from public.ezyvet_record_links where resource='animal' and pet_id=p_pet_id)>50 then raise exception 'Too many patient mappings' using errcode='23514';end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('link_id',m.id,'pet_id',m.pet_id,'source_origin',m.source_origin,'source_site_uid',m.source_site_uid,'external_id',m.external_id,'patient_version',p.version) order by m.id),'[]') from public.ezyvet_record_links m join public.pets p on p.id=m.pet_id and p.client_id=m.client_id where m.resource='animal' and m.pet_id=p_pet_id);end $$;
create function public.ezyvet_validate_reviewed_vaccinations(p_pet_id uuid,p_sources jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare rowrecord record;x jsonb;selected_vaccination public.ezyvet_imported_vaccinations;result jsonb:='[]';begin
 if p_sources is null or jsonb_typeof(p_sources)<>'array' or jsonb_array_length(p_sources) not between 1 and 20 or(select count(*)<>count(distinct(value->>'id')::uuid) from jsonb_array_elements(p_sources)) then raise exception 'Choose distinct reviewed vaccinations' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_sources) ref where jsonb_typeof(ref)<>'object' or not(ref ?& array['id','version_hash']) or (ref-'id'-'version_hash')<>'{}'::jsonb or jsonb_typeof(ref->'id') is distinct from 'string' or ref->>'id' !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' or jsonb_typeof(ref->'version_hash') is distinct from 'string' or ref->>'version_hash' !~ '^[a-f0-9]{64}$') then raise exception 'Exact vaccination version references required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 for rowrecord in select distinct m.id from public.ezyvet_imported_vaccinations v join public.ezyvet_record_links m on m.id=v.animal_link_id where v.id in(select(value->>'id')::uuid from jsonb_array_elements(p_sources)) order by m.id loop perform 1 from public.ezyvet_record_links where id=rowrecord.id for share;end loop;
 perform 1 from public.pets where id=p_pet_id for share;
 for rowrecord in select distinct h.source_origin,h.source_site_uid,h.resource,h.external_id from public.ezyvet_imported_vaccinations v join public.ezyvet_identity_heads h on h.source_origin=v.source_origin and h.source_site_uid=v.source_site_uid and((h.resource='consult' and h.external_id=v.consult->>'external_id') or(h.resource='vaccination' and h.external_id=v.vaccination_external_id)) where v.id in(select(value->>'id')::uuid from jsonb_array_elements(p_sources)) order by 1,2,3,4 loop
  perform 1 from public.ezyvet_identity_heads where source_origin=rowrecord.source_origin and source_site_uid=rowrecord.source_site_uid and resource=rowrecord.resource and external_id=rowrecord.external_id for share;
 end loop;
 for x in select value from jsonb_array_elements(p_sources) order by value->>'id' loop
  select * into selected_vaccination from public.ezyvet_imported_vaccinations where id=(x->>'id')::uuid;
  if not found or selected_vaccination.pet_id is distinct from p_pet_id or selected_vaccination.version_hash is distinct from x->>'version_hash' or public.ezyvet_vaccination_current(selected_vaccination.id)->>'is_current' is distinct from 'true' or public.ezyvet_vaccination_current(selected_vaccination.id)->>'is_latest' is distinct from 'true' then raise exception 'Current latest same-patient reviewed vaccination required' using errcode='40001';end if;
  result:=result||jsonb_build_array(public.ezyvet_imported_vaccination_projection(selected_vaccination.id));
 end loop;return result;end $$;
create function public.list_ezyvet_vaccination_review_candidates(p_pet_id uuid,p_animal_link_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare m public.ezyvet_record_links;items jsonb;more boolean;lastrow jsonb;
begin
 perform public.ezyvet_vaccination_require_dvm();
 if p_limit is null or p_limit not between 1 and 50 or (p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid vaccination candidate query' using errcode='23514';end if;
 select * into strict m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal' and pet_id=p_pet_id;
 select coalesce(jsonb_agg(item order by created_at desc,id desc),'[]') into items from (
  select s.id,s.created_at,jsonb_build_object('id',s.id,'payload',s.payload,'payload_hash',s.payload_hash,'external_id',s.external_id,'resource',s.resource,'source_origin',s.source_origin,'source_site_uid',s.source_site_uid,'created_at',s.created_at,'head_version',h.version,'current_snapshot_id',h.snapshot_id,
   'is_current',h.snapshot_id=s.id and h.version=observed.head_version,'is_current_snapshot',h.snapshot_id=s.id,'observed_head_version',observed.head_version,'current_head_scoped',h.snapshot_id=s.id and h.version=observed.head_version,
   'animal_link_id',m.id,'pet_id',observed.pet_id,'client_id',observed.client_id,
   'consult_snapshot_id',observed.consult_snapshot_id,'consult_payload_hash',observed.consult_payload_hash,'consult_observed_head_version',observed.consult_observed_head_version,'consult_external_id',observed.consult_external_id,
   'consult_head_version',ch.version,'consult_current_snapshot_id',ch.snapshot_id,'consult_is_current',coalesce(ch.snapshot_id=observed.consult_snapshot_id and ch.version=observed.consult_observed_head_version,false),
   'eligible_for_review',coalesce(h.snapshot_id=s.id and h.version=observed.head_version and ch.snapshot_id=observed.consult_snapshot_id and ch.version=observed.consult_observed_head_version and exists(select 1 from public.pets p where p.id=observed.pet_id and p.client_id=observed.client_id),false)) item
  from public.ezyvet_import_snapshots s join public.ezyvet_identity_heads h using(source_origin,source_site_uid,resource,external_id)
  join lateral (
   select o.head_version,c.* from public.ezyvet_vaccination_page_observations o join public.ezyvet_vaccination_runs c on c.run_id=o.run_id join public.ezyvet_vaccination_pages vp on vp.run_id=o.run_id and vp.page=o.page
   where o.snapshot_id=s.id and c.animal_link_id=m.id and row(c.resource,c.source_origin,c.source_site_uid,c.animal_external_id)=row(s.resource,s.source_origin,s.source_site_uid,m.external_id)
   order by o.head_version desc,c.consult_observed_head_version desc,vp.created_at desc,o.run_id desc,o.page desc limit 1
  ) observed on true
  left join public.ezyvet_identity_heads ch on ch.source_origin=s.source_origin and ch.source_site_uid=s.source_site_uid and ch.resource='consult' and ch.external_id=observed.consult_external_id
  where s.resource='vaccination' and s.source_origin=m.source_origin and s.source_site_uid=m.source_site_uid
  and (p_before_at is null or (s.created_at,s.id)<(p_before_at,p_before_id)) order by s.created_at desc,s.id desc limit p_limit+1
 ) selected;
 more:=jsonb_array_length(items)>p_limit;items:=case when more then items-p_limit else items end;lastrow:=items->(jsonb_array_length(items)-1);
 return jsonb_build_object('animal_link_id',m.id,'resource','vaccination','candidates',items,'has_more',more,'next_cursor',case when more then jsonb_build_object('before_at',lastrow->'created_at','before_id',lastrow->'id') else null end);
end $$;
-- Default ACLs never expose private validation or table access.
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('ezyvet_vaccination_review_guard','ezyvet_vaccination_require_dvm','ezyvet_vaccination_current','ezyvet_imported_vaccination_projection','ezyvet_vaccination_review_projection','ezyvet_vaccination_review_context','ezyvet_vaccination_review_predecessor','prepare_ezyvet_vaccination_review','approve_ezyvet_vaccination_review','recover_ezyvet_vaccination_review','abandon_ezyvet_vaccination_review','list_ezyvet_vaccination_review_requests','list_patient_imported_vaccinations','list_ezyvet_vaccination_review_candidates','list_ezyvet_vaccination_review_mappings','ezyvet_validate_reviewed_vaccinations') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.proname in ('prepare_ezyvet_vaccination_review','approve_ezyvet_vaccination_review','recover_ezyvet_vaccination_review','abandon_ezyvet_vaccination_review','list_ezyvet_vaccination_review_requests','list_patient_imported_vaccinations','list_ezyvet_vaccination_review_candidates','list_ezyvet_vaccination_review_mappings') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;end $$;
