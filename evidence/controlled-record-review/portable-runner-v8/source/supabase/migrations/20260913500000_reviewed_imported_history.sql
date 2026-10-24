-- Outside history approval and explicit DVM-authored native findings are separate acts.
create table public.ezyvet_history_requests (
 id uuid primary key,actor_id uuid not null references public.profiles(id),pet_id uuid not null references public.pets(id),
 kind text not null check(kind in ('history_approval','problem_extraction','discrepancy_review')),
 status text not null check(status in ('prepared','approved','abandoned')),payload jsonb,request_hash text,review_context jsonb,
 created_at timestamptz not null default clock_timestamp(),resolved_at timestamptz,
 check(status='abandoned' or (payload is not null and request_hash is not null and review_context is not null))
);
create table public.ezyvet_imported_histories (
 id uuid primary key references public.ezyvet_history_requests(id),pet_id uuid not null references public.pets(id),animal_link_id uuid not null references public.ezyvet_record_links(id),
 source_origin text not null,source_site_uid text not null,animal_external_id text not null,history_external_id text not null,
 version integer not null check(version>0),version_hash text not null check(version_hash ~ '^[a-f0-9]{64}$'),
 snapshot_id uuid not null references public.ezyvet_import_snapshots(id),payload_hash text not null,observed_head_version integer not null check(observed_head_version>0),
 original jsonb not null,consult jsonb not null,approved_by uuid not null references public.profiles(id),approved_at timestamptz not null default clock_timestamp(),
 unique(animal_link_id,history_external_id,version)
);
create table public.ezyvet_problem_extractions (
 id uuid primary key references public.ezyvet_history_requests(id),pet_id uuid not null references public.pets(id),problem_id uuid not null references public.patient_problems(id),
 action text not null check(action in ('create','link')),problem_version integer not null,problem_fields jsonb not null,
 extracted_by uuid not null references public.profiles(id),extracted_at timestamptz not null default clock_timestamp()
);
create table public.ezyvet_problem_history_sources (
 extraction_id uuid not null references public.ezyvet_problem_extractions(id),history_id uuid not null references public.ezyvet_imported_histories(id),version_hash text not null,
 primary key(extraction_id,history_id)
);
create table public.ezyvet_history_discrepancy_reviews (
 id uuid primary key references public.ezyvet_history_requests(id),pet_id uuid not null references public.pets(id),extraction_id uuid not null references public.ezyvet_problem_extractions(id),
 reviewed_sources jsonb not null,reviewed_by uuid not null references public.profiles(id),reviewed_at timestamptz not null default clock_timestamp()
);
create index ezyvet_imported_history_patient on public.ezyvet_imported_histories(pet_id,approved_at desc,id desc);
create index ezyvet_history_request_actor on public.ezyvet_history_requests(actor_id,pet_id,kind,created_at desc,id desc);
create function public.ezyvet_history_request_guard() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP='DELETE' or (to_jsonb(NEW)-array['status','resolved_at']) is distinct from (to_jsonb(OLD)-array['status','resolved_at']) or OLD.status<>'prepared' or NEW.status not in ('approved','abandoned') then raise exception 'History request evidence is immutable' using errcode='23514';end if;return NEW;
end $$;
do $$declare t text;begin foreach t in array array['ezyvet_history_requests','ezyvet_imported_histories','ezyvet_problem_extractions','ezyvet_problem_history_sources','ezyvet_history_discrepancy_reviews'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger immutable_history_evidence before update or delete on public.%I for each row execute function public.%I()',t,case when t='ezyvet_history_requests' then 'ezyvet_history_request_guard' else 'guard_inquiry_history' end);
end loop;end $$;
create function public.ezyvet_history_require_actor(p_kind text) returns uuid language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();begin
 if p_kind='history_approval' then if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 elsif p_kind in ('problem_extraction','discrepancy_review') then if public.has_role(actor,'DVM') is not true then raise exception 'Veterinarian review required' using errcode='42501';end if;
 else raise exception 'Unsupported history operation' using errcode='23514';end if;return actor;
end $$;
-- Ordinary API updates must acquire the patient BEFORE PostgreSQL takes the problem tuple.
do $$declare d text;needle text:=E' actor := public.clinical_require_staff();\n';begin
 select pg_get_functiondef('public.save_patient_problem(uuid,uuid,integer,text,text,date,text,text)'::regprocedure) into d;
 if strpos(d,needle)=0 then raise exception 'Expected ordinary problem actor guard missing';end if;
 execute replace(d,needle,needle||E' perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));\n perform 1 from public.pets where id=p_pet_id for update;\n');
end $$;
create function public.ezyvet_problem_fields(p public.patient_problems) returns jsonb language sql immutable set search_path=public as $$
 select jsonb_build_object('title',p.title,'notes',p.notes,'onset_date',p.onset_date,'status',p.status,'importance',p.importance);
$$;
create function public.ezyvet_history_compact(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',h.id,'version',h.version,'version_hash',h.version_hash,'source',jsonb_build_object('origin',h.source_origin,'site_uid',h.source_site_uid,'animal_id',h.animal_external_id,'history_id',h.history_external_id),'snapshot_id',h.snapshot_id,'payload_hash',h.payload_hash,'observed_head_version',h.observed_head_version,'approved_by',h.approved_by,'approved_at',h.approved_at) from public.ezyvet_imported_histories h where id=p_id;
$$;
create function public.ezyvet_history_identity_valid(p_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.ezyvet_imported_histories h join public.ezyvet_record_links m on m.id=h.animal_link_id and m.resource='animal' and row(m.source_origin,m.source_site_uid,m.external_id,m.pet_id)=row(h.source_origin,h.source_site_uid,h.animal_external_id,h.pet_id) join public.pets p on p.id=h.pet_id and p.client_id=m.client_id join public.ezyvet_identity_heads head on head.source_origin=h.source_origin and head.source_site_uid=h.source_site_uid and head.resource='history' and head.external_id=h.history_external_id join public.ezyvet_import_snapshots s on s.id=head.snapshot_id and s.payload->>'animal_id'=h.animal_external_id where h.id=p_id and not exists(select 1 from public.ezyvet_identity_heads ch join public.ezyvet_import_snapshots cs on cs.id=ch.snapshot_id where ch.source_origin=h.source_origin and ch.source_site_uid=h.source_site_uid and ch.resource='consult' and ch.external_id=h.original->>'consult_id' and cs.payload->>'animal_id' is distinct from h.animal_external_id));
$$;
create function public.ezyvet_history_current(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('snapshot_id',head.snapshot_id,'head_version',head.version,'scoped',exists(select 1 from public.ezyvet_clinical_page_observations o join public.ezyvet_clinical_runs c on c.run_id=o.run_id where c.animal_link_id=h.animal_link_id and o.snapshot_id=head.snapshot_id and o.head_version=head.version),'is_current',public.ezyvet_history_identity_valid(h.id) and (h.consult->>'status'<>'verified' or exists(select 1 from public.ezyvet_identity_heads ch where ch.source_origin=h.source_origin and ch.source_site_uid=h.source_site_uid and ch.resource='consult' and ch.external_id=h.consult->>'external_id' and ch.snapshot_id=(h.consult->>'snapshot_id')::uuid and ch.version=(h.consult->>'observed_head_version')::integer)) and head.snapshot_id=h.snapshot_id and head.version=h.observed_head_version and exists(select 1 from public.ezyvet_clinical_page_observations o join public.ezyvet_clinical_runs c on c.run_id=o.run_id where c.animal_link_id=h.animal_link_id and o.snapshot_id=head.snapshot_id and o.head_version=head.version),'source_active',s.payload->'active')
 from public.ezyvet_imported_histories h join public.ezyvet_identity_heads head on head.source_origin=h.source_origin and head.source_site_uid=h.source_site_uid and head.resource='history' and head.external_id=h.history_external_id join public.ezyvet_import_snapshots s on s.id=head.snapshot_id where h.id=p_id;
$$;
create function public.ezyvet_imported_history_projection(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select public.ezyvet_history_compact(h.id)||jsonb_build_object('pet_id',h.pet_id,'animal_link_id',h.animal_link_id,'original',h.original,'consult',h.consult,'current',public.ezyvet_history_current(h.id)) from public.ezyvet_imported_histories h where id=p_id;
$$;
create function public.ezyvet_discrepancy_projection(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',r.id,'reviewed_by',r.reviewed_by,'reviewed_at',r.reviewed_at,'source_heads',(select jsonb_agg(jsonb_build_object('history_id',x->'original_history_id','snapshot_id',h.snapshot_id,'head_version',h.observed_head_version) order by x->>'original_history_id') from jsonb_array_elements(r.reviewed_sources) x join public.ezyvet_imported_histories h on h.id=(x->>'reviewed_history_id')::uuid),'sources',(select jsonb_agg(public.ezyvet_history_compact((x->>'reviewed_history_id')::uuid) order by x->>'reviewed_history_id') from jsonb_array_elements(r.reviewed_sources) x)) from public.ezyvet_history_discrepancy_reviews r where id=p_id;
$$;
create function public.ezyvet_extraction_projection(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare e public.ezyvet_problem_extractions;p public.patient_problems;review public.ezyvet_history_discrepancy_reviews;changed boolean;current_review boolean:=false;begin
 select * into e from public.ezyvet_problem_extractions where id=p_id;if not found then return null;end if;
 select * into strict p from public.patient_problems where id=e.problem_id;
 select exists(select 1 from public.ezyvet_problem_history_sources s where s.extraction_id=e.id and public.ezyvet_history_current(s.history_id)->>'is_current' is distinct from 'true') into changed;
 select * into review from public.ezyvet_history_discrepancy_reviews where extraction_id=e.id order by reviewed_at desc,id desc limit 1;
 if found then select not exists(select 1 from jsonb_array_elements(review.reviewed_sources) x where public.ezyvet_history_current((x->>'reviewed_history_id')::uuid)->>'is_current' is distinct from 'true') into current_review;end if;
 return jsonb_build_object('id',e.id,'problem_id',e.problem_id,'action',e.action,'problem_version',e.problem_version,'problem_fields',e.problem_fields,'extracted_by',e.extracted_by,'extracted_at',e.extracted_at,'sources',(select jsonb_agg(public.ezyvet_history_compact(history_id) order by history_id) from public.ezyvet_problem_history_sources where extraction_id=e.id),'current_problem_version',p.version,'locally_edited',p.version<>e.problem_version,'discrepancy',jsonb_build_object('required',changed and not current_review,'reviewed',current_review,'changed_from_original',changed,'review_history',(select coalesce(jsonb_agg(public.ezyvet_discrepancy_projection(id) order by reviewed_at,id),'[]') from public.ezyvet_history_discrepancy_reviews where extraction_id=e.id)));
end $$;
-- Validate and freeze source context without exposing arbitrary staging JSON to clinical staff.
create function public.ezyvet_history_source_context(p_pet_id uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.ezyvet_record_links;s public.ezyvet_import_snapshots;head public.ezyvet_identity_heads;cs public.ezyvet_import_snapshots;ch public.ezyvet_identity_heads;original jsonb;consult jsonb;ref text;mode text:=p_payload->>'consult_mode';begin
 select * into m from public.ezyvet_record_links where id=(p_payload->>'animal_link_id')::uuid and resource='animal' for share;
 if not found or m.pet_id is distinct from p_pet_id or not exists(select 1 from public.pets where id=p_pet_id and client_id=m.client_id and version=(p_payload->>'patient_version')::integer) then raise exception 'Current reviewed patient mapping required' using errcode='40001';end if;
 select * into s from public.ezyvet_import_snapshots where id=(p_payload->>'snapshot_id')::uuid and resource='history' and source_origin=m.source_origin and source_site_uid=m.source_site_uid;
 if not found or s.payload_hash is distinct from p_payload->>'payload_hash' or s.payload->>'animal_id' is distinct from m.external_id then raise exception 'History source identity mismatch' using errcode='23514';end if;
 ref:=s.payload->>'consult_id';
 -- Consult sorts before history in all source lock paths.
 select * into ch from public.ezyvet_identity_heads where source_origin=m.source_origin and source_site_uid=m.source_site_uid and resource='consult' and external_id=ref for share;
 if found then select * into cs from public.ezyvet_import_snapshots where id=ch.snapshot_id;
  if cs.payload->>'animal_id' is distinct from m.external_id then raise exception 'Known consult conflicts with patient identity' using errcode='23514';end if;
 end if;
 select * into head from public.ezyvet_identity_heads where source_origin=s.source_origin and source_site_uid=s.source_site_uid and resource='history' and external_id=s.external_id for share;
 if head.snapshot_id is distinct from s.id or head.version is distinct from (p_payload->>'observed_head_version')::integer or not exists(select 1 from public.ezyvet_clinical_page_observations o join public.ezyvet_clinical_runs c on c.run_id=o.run_id where c.animal_link_id=m.id and o.snapshot_id=s.id and o.head_version=head.version) then raise exception 'Current scoped history observation required' using errcode='40001';end if;
 if mode='verified' then
  if cs.id is distinct from (p_payload->>'consult_snapshot_id')::uuid or cs.payload_hash is distinct from p_payload->>'consult_payload_hash' or ch.version is distinct from (p_payload->>'consult_head_version')::integer or cs.id is null or not exists(select 1 from public.ezyvet_clinical_page_observations o join public.ezyvet_clinical_runs c on c.run_id=o.run_id where c.animal_link_id=m.id and o.snapshot_id=cs.id and o.head_version=ch.version) then raise exception 'Verified same-patient scoped consult required' using errcode='40001';end if;
  consult:=jsonb_build_object('status','verified','snapshot_id',cs.id,'payload_hash',cs.payload_hash,'observed_head_version',ch.version,'external_id',cs.external_id);
 elsif mode in ('not_referenced','unresolved') then
  if (mode='not_referenced')<>(ref is null) or p_payload->>'consult_snapshot_id' is not null or p_payload->>'consult_payload_hash' is not null or p_payload->>'consult_head_version' is not null then raise exception 'Preserve the actual unresolved consult reference' using errcode='23514';end if;
  consult:=jsonb_build_object('status',mode);
 else raise exception 'Explicit consult context decision required' using errcode='23514';end if;
 original:=jsonb_build_object('comments',s.payload->'comments','history_system',s.payload->'history_system','chain',s.payload->'chain','timestamp',s.payload->'timestamp','vet_id',s.payload->'vet_id','active',s.payload->'active','consult_id',s.payload->'consult_id');
 if octet_length(original::text)>200000 then raise exception 'History original exceeds bounded clinical projection' using errcode='23514';end if;
 return jsonb_build_object('source',jsonb_build_object('origin',s.source_origin,'site_uid',s.source_site_uid,'animal_id',m.external_id,'history_id',s.external_id),'snapshot_id',s.id,'payload_hash',s.payload_hash,'observed_head_version',head.version,'original',original,'consult',consult);
end $$;
create function public.ezyvet_validate_history_sources(p_pet_id uuid,p_sources jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare selected_history public.ezyvet_imported_histories;x jsonb;result jsonb:='[]';head record;begin
 if p_sources is null or jsonb_typeof(p_sources)<>'array' or jsonb_array_length(p_sources) not between 1 and 20 or (select count(*)<>count(distinct (v->>'id')::uuid) from jsonb_array_elements(p_sources) v) then raise exception 'Choose one to twenty distinct approved history versions' using errcode='23514';end if;
 if (select count(*)<>count(distinct row(h.animal_link_id,h.history_external_id)) from public.ezyvet_imported_histories h where h.id in(select (v->>'id')::uuid from jsonb_array_elements(p_sources) v)) then raise exception 'Choose one approved version per source history identity' using errcode='23514';end if;
 for head in select distinct sh.source_origin,sh.source_site_uid,sh.resource,sh.external_id from public.ezyvet_imported_histories h join public.ezyvet_identity_heads sh on sh.source_origin=h.source_origin and sh.source_site_uid=h.source_site_uid and ((sh.resource='history' and sh.external_id=h.history_external_id) or(sh.resource='consult' and sh.external_id=h.original->>'consult_id')) where h.id in(select (v->>'id')::uuid from jsonb_array_elements(p_sources) v) order by 1,2,3,4 loop
  perform 1 from public.ezyvet_identity_heads where source_origin=head.source_origin and source_site_uid=head.source_site_uid and resource=head.resource and external_id=head.external_id for share;
 end loop;
 for x in select value from jsonb_array_elements(p_sources) order by value->>'id' loop
  select * into selected_history from public.ezyvet_imported_histories where id=(x->>'id')::uuid;
  if not found or selected_history.pet_id is distinct from p_pet_id or selected_history.version_hash is distinct from x->>'version_hash' or public.ezyvet_history_current(selected_history.id)->>'is_current' is distinct from 'true' then raise exception 'Current approved same-patient history required' using errcode='40001';end if;
  result:=result||jsonb_build_array(public.ezyvet_imported_history_projection(selected_history.id));
 end loop;return result;
end $$;
create function public.ezyvet_history_review_context(p_pet_id uuid,p_kind text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb:=jsonb_build_object('history_source',null,'histories','[]'::jsonb,'problem',null,'extraction',null);sources jsonb;fields jsonb;p public.patient_problems;e public.ezyvet_problem_extractions;x jsonb;oldh public.ezyvet_imported_histories;newh public.ezyvet_imported_histories;expected text[];begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload->>'reason' is null or length(trim(p_payload->>'reason')) not between 5 and 2000 then raise exception 'An explicit review reason is required' using errcode='23514';end if;
 if p_kind='history_approval' then
  expected:=array['animal_link_id','snapshot_id','payload_hash','observed_head_version','patient_version','consult_mode','consult_snapshot_id','consult_payload_hash','consult_head_version','reason'];
 elsif p_kind='problem_extraction' then expected:=array['sources','patient_version','action','problem_id','problem_version','fields','duplicate_decision','reason'];
 else expected:=array['extraction_id','reviewed_sources','reason'];end if;
 if (select count(*) from jsonb_object_keys(p_payload))<>cardinality(expected) or exists(select 1 from jsonb_object_keys(p_payload) k where not(k=any(expected))) then raise exception 'Exact prepared operation fields required' using errcode='23514';end if;
 if p_kind='history_approval' then return result||jsonb_build_object('history_source',public.ezyvet_history_source_context(p_pet_id,p_payload));end if;
 if p_kind='problem_extraction' then
  if not exists(select 1 from public.pets where id=p_pet_id and version=(p_payload->>'patient_version')::integer) then raise exception 'Patient changed; review again' using errcode='40001';end if;
  sources:=public.ezyvet_validate_history_sources(p_pet_id,p_payload->'sources');fields:=p_payload->'fields';
  if fields is null or jsonb_typeof(fields)<>'object' or (select count(*) from jsonb_object_keys(fields))<>5 or exists(select 1 from jsonb_object_keys(fields) k where k not in ('title','notes','onset_date','status','importance')) or jsonb_typeof(fields->'title') is distinct from 'string' or length(fields->>'title') not between 1 and 250 or fields->>'title'<>trim(fields->>'title') or jsonb_typeof(fields->'notes') is distinct from 'string' or length(fields->>'notes')>10000 or fields->>'status' is null or fields->>'status' not in ('active','resolved') or fields->>'importance' is null or fields->>'importance' not in ('routine','high') or ((fields->>'onset_date') is not null and (jsonb_typeof(fields->'onset_date')<>'string' or fields->>'onset_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or fields->>'onset_date' is distinct from ((fields->>'onset_date')::date)::text or not isfinite((fields->>'onset_date')::date) or (fields->>'onset_date')::date>(now() at time zone 'America/Denver')::date)) then raise exception 'Review explicit valid native problem fields' using errcode='23514';end if;
  if p_payload->>'action'='link' then
   if p_payload->>'duplicate_decision' is distinct from 'link_existing' then raise exception 'Explicit existing-problem decision required' using errcode='23514';end if;
   select * into p from public.patient_problems where id=(p_payload->>'problem_id')::uuid and pet_id=p_pet_id for update;
   if not found or p.version is distinct from (p_payload->>'problem_version')::integer or public.ezyvet_problem_fields(p) is distinct from fields then raise exception 'Link must preserve exact current problem fields and version' using errcode='40001';end if;
   result:=result||jsonb_build_object('problem',to_jsonb(p));
  elsif p_payload->>'action'='create' then
   if p_payload->>'problem_id' is not null or p_payload->>'problem_version' is not null or p_payload->>'duplicate_decision' is distinct from 'distinct_finding' then raise exception 'Explicit distinct-finding decision required' using errcode='23514';end if;
  else raise exception 'Explicit extraction action required' using errcode='23514';end if;
  return result||jsonb_build_object('histories',sources);
 end if;
 select * into e from public.ezyvet_problem_extractions where id=(p_payload->>'extraction_id')::uuid and pet_id=p_pet_id;
 if not found or p_payload->'reviewed_sources' is null or jsonb_typeof(p_payload->'reviewed_sources')<>'array' or jsonb_array_length(p_payload->'reviewed_sources')<>(select count(*) from public.ezyvet_problem_history_sources where extraction_id=e.id) or (select count(*)<>count(distinct (v->>'original_history_id')::uuid) from jsonb_array_elements(p_payload->'reviewed_sources') v) then raise exception 'Review every original extraction source identity' using errcode='23514';end if;
 for x in select value from jsonb_array_elements(p_payload->'reviewed_sources') loop
  select h.* into oldh from public.ezyvet_imported_histories h join public.ezyvet_problem_history_sources s on s.history_id=h.id where s.extraction_id=e.id and h.id=(x->>'original_history_id')::uuid;
  select * into newh from public.ezyvet_imported_histories where id=(x->>'reviewed_history_id')::uuid;
  if oldh.id is null or newh.id is null or row(oldh.animal_link_id,oldh.history_external_id,oldh.pet_id) is distinct from row(newh.animal_link_id,newh.history_external_id,newh.pet_id) then raise exception 'Discrepancy review source identity changed' using errcode='23514';end if;
 end loop;
 select jsonb_agg(jsonb_build_object('id',v->'reviewed_history_id','version_hash',v->'version_hash')) into sources from jsonb_array_elements(p_payload->'reviewed_sources') v;
 sources:=public.ezyvet_validate_history_sources(p_pet_id,sources);
 return result||jsonb_build_object('histories',sources,'extraction',public.ezyvet_extraction_projection(e.id));
end $$;
create function public.ezyvet_history_request_projection(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('request',to_jsonb(r),'receipt',case when r.status<>'approved' then null when r.kind='history_approval' then public.ezyvet_imported_history_projection(r.id) when r.kind='problem_extraction' then public.ezyvet_extraction_projection(r.id) else public.ezyvet_discrepancy_projection(r.id) end) from public.ezyvet_history_requests r where id=p_id;
$$;
create function public.recover_ezyvet_history_request(p_id uuid,p_pet_id uuid,p_kind text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.ezyvet_history_require_actor(p_kind);r public.ezyvet_history_requests;begin
 select * into r from public.ezyvet_history_requests where id=p_id;if not found then return null;end if;
 if row(r.actor_id,r.pet_id,r.kind) is distinct from row(actor,p_pet_id,p_kind) then raise exception 'History request identity mismatch' using errcode='42501';end if;return public.ezyvet_history_request_projection(r.id);
end $$;
create function public.ezyvet_prepare_history_request(p_id uuid,p_pet_id uuid,p_kind text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare actor uuid:=public.ezyvet_history_require_actor(p_kind);r public.ezyvet_history_requests;context jsonb;begin
 if p_id is null or p_pet_id is null then raise exception 'Durable request and patient required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,5000));
 select * into r from public.ezyvet_history_requests where id=p_id;
 if found then
  if row(r.actor_id,r.pet_id,r.kind,r.payload) is distinct from row(actor,p_pet_id,p_kind,p_payload) or r.status='abandoned' then raise exception 'Prepared request cannot change or revive' using errcode='42501';end if;return public.ezyvet_history_request_projection(r.id);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));perform 1 from public.pets where id=p_pet_id for update;
 if not found then raise exception 'Patient not found' using errcode='23503';end if;
 context:=public.ezyvet_history_review_context(p_pet_id,p_kind,p_payload);
 insert into public.ezyvet_history_requests(id,actor_id,pet_id,kind,status,payload,request_hash,review_context) values(p_id,actor,p_pet_id,p_kind,'prepared',p_payload,encode(digest(p_payload::text,'sha256'),'hex'),context);
 return public.ezyvet_history_request_projection(p_id);
end $$;
create function public.ezyvet_approve_history_request(p_id uuid,p_pet_id uuid,p_kind text,p_expected_hash text,p_confirmed boolean) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare actor uuid:=public.ezyvet_history_require_actor(p_kind);r public.ezyvet_history_requests;context jsonb;h jsonb;fields jsonb;p public.patient_problems;next_version integer;moment timestamptz:=clock_timestamp();version_hash text;begin
 if p_confirmed is distinct from true then raise exception 'Explicit reviewed confirmation required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,5000));
 select * into r from public.ezyvet_history_requests where id=p_id for update;
 if not found or row(r.actor_id,r.pet_id,r.kind,r.request_hash) is distinct from row(actor,p_pet_id,p_kind,p_expected_hash) then raise exception 'Exact owned prepared history request required' using errcode='42501';end if;
 if r.status='approved' then return public.ezyvet_history_request_projection(r.id);end if;
 if r.status<>'prepared' then raise exception 'Abandoned request cannot approve' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));perform 1 from public.pets where id=p_pet_id for update;
 context:=public.ezyvet_history_review_context(p_pet_id,p_kind,r.payload);
 if p_kind='history_approval' then
  h:=context->'history_source';select coalesce(max(version),0)+1 into next_version from public.ezyvet_imported_histories where animal_link_id=(r.payload->>'animal_link_id')::uuid and history_external_id=h#>>'{source,history_id}';
  version_hash:=encode(digest(jsonb_build_array(p_id,next_version,h,actor,moment)::text,'sha256'),'hex');
  insert into public.ezyvet_imported_histories(id,pet_id,animal_link_id,source_origin,source_site_uid,animal_external_id,history_external_id,version,version_hash,snapshot_id,payload_hash,observed_head_version,original,consult,approved_by,approved_at)
  values(p_id,p_pet_id,(r.payload->>'animal_link_id')::uuid,h#>>'{source,origin}',h#>>'{source,site_uid}',h#>>'{source,animal_id}',h#>>'{source,history_id}',next_version,version_hash,(h->>'snapshot_id')::uuid,h->>'payload_hash',(h->>'observed_head_version')::integer,h->'original',h->'consult',actor,moment);
 elsif p_kind='problem_extraction' then
  fields:=r.payload->'fields';
  if r.payload->>'action'='create' then p:=public.save_patient_problem(null,p_pet_id,null,fields->>'title',fields->>'notes',(fields->>'onset_date')::date,fields->>'status',fields->>'importance');
  else select * into strict p from public.patient_problems where id=(r.payload->>'problem_id')::uuid;end if;
  insert into public.ezyvet_problem_extractions(id,pet_id,problem_id,action,problem_version,problem_fields,extracted_by) values(p_id,p_pet_id,p.id,r.payload->>'action',p.version,public.ezyvet_problem_fields(p),actor);
  insert into public.ezyvet_problem_history_sources(extraction_id,history_id,version_hash) select p_id,(v->>'id')::uuid,v->>'version_hash' from jsonb_array_elements(r.payload->'sources') v;
 else insert into public.ezyvet_history_discrepancy_reviews(id,pet_id,extraction_id,reviewed_sources,reviewed_by) values(p_id,p_pet_id,(r.payload->>'extraction_id')::uuid,r.payload->'reviewed_sources',actor);end if;
 update public.ezyvet_history_requests set status='approved',resolved_at=clock_timestamp() where id=p_id;
 return public.ezyvet_history_request_projection(p_id);
end $$;
create function public.abandon_ezyvet_history_request(p_id uuid,p_pet_id uuid,p_kind text,p_confirmed boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.ezyvet_history_require_actor(p_kind);r public.ezyvet_history_requests;begin
 if p_id is null or p_pet_id is null or p_confirmed is distinct from true then raise exception 'Explicit durable abandonment required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,5000));select * into r from public.ezyvet_history_requests where id=p_id for update;
 if found then
  if row(r.actor_id,r.pet_id,r.kind) is distinct from row(actor,p_pet_id,p_kind) then raise exception 'Request identity mismatch' using errcode='42501';end if;
  if r.status='prepared' then update public.ezyvet_history_requests set status='abandoned',resolved_at=clock_timestamp() where id=p_id;end if;
 else insert into public.ezyvet_history_requests(id,actor_id,pet_id,kind,status,resolved_at) values(p_id,actor,p_pet_id,p_kind,'abandoned',clock_timestamp());end if;
 return public.ezyvet_history_request_projection(p_id);
end $$;
do $$declare kind text;prepare_name text;approve_name text;begin
 foreach kind in array array['history_approval','problem_extraction','discrepancy_review'] loop
 prepare_name:=case kind when 'history_approval' then 'prepare_ezyvet_history_approval' when 'problem_extraction' then 'prepare_ezyvet_problem_extraction' else 'prepare_ezyvet_history_discrepancy' end;
 approve_name:=case kind when 'history_approval' then 'approve_ezyvet_history' when 'problem_extraction' then 'approve_ezyvet_problem_extraction' else 'approve_ezyvet_history_discrepancy' end;
 execute format('create function public.%I(p_id uuid,p_pet_id uuid,p_payload jsonb) returns jsonb language sql security definer set search_path=public as $f$ select public.ezyvet_prepare_history_request(p_id,p_pet_id,%L,p_payload); $f$',prepare_name,kind);
 execute format('create function public.%I(p_id uuid,p_pet_id uuid,p_expected_hash text,p_confirmed boolean) returns jsonb language sql security definer set search_path=public as $f$ select public.ezyvet_approve_history_request(p_id,p_pet_id,%L,p_expected_hash,p_confirmed); $f$',approve_name,kind);
 end loop;
end $$;
create function public.list_ezyvet_history_requests(p_pet_id uuid,p_kind text,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.ezyvet_history_require_actor(p_kind);rows jsonb;more boolean;lastrow jsonb;begin
 if p_pet_id is null or p_limit is null or p_limit not between 1 and 50 or (p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid request cursor' using errcode='23514';end if;
 select coalesce(jsonb_agg(public.ezyvet_history_request_projection(id) order by created_at desc,id desc),'[]') into rows from(select id,created_at from public.ezyvet_history_requests where actor_id=actor and pet_id=p_pet_id and kind=p_kind and (p_before_at is null or(created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit p_limit+1) selected;
 more:=jsonb_array_length(rows)>p_limit;if more then rows:=rows-p_limit;end if;lastrow:=rows->(jsonb_array_length(rows)-1)->'request';
 return jsonb_build_object('requests',rows,'has_more',more,'next_cursor',case when more then jsonb_build_object('before_at',lastrow->'created_at','before_id',lastrow->'id') end);
end $$;
create function public.list_patient_imported_histories(p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows jsonb;more boolean;lastrow jsonb;begin
 perform public.clinical_require_staff();
 if p_pet_id is null or p_limit is null or p_limit not between 1 and 50 or (p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid patient history cursor' using errcode='23514';end if;
 select coalesce(jsonb_agg(public.ezyvet_imported_history_projection(id) order by approved_at desc,id desc),'[]') into rows from(select id,approved_at from public.ezyvet_imported_histories where pet_id=p_pet_id and (p_before_at is null or(approved_at,id)<(p_before_at,p_before_id)) order by approved_at desc,id desc limit p_limit+1) selected;
 more:=jsonb_array_length(rows)>p_limit;if more then rows:=rows-p_limit;end if;lastrow:=rows->(jsonb_array_length(rows)-1);
 return jsonb_build_object('histories',rows,'has_more',more,'next_cursor',case when more then jsonb_build_object('before_at',lastrow->'approved_at','before_id',lastrow->'id') end);
end $$;
create function public.search_patient_problems(p_pet_id uuid,p_search text,p_limit integer default 20) returns setof public.patient_problems language plpgsql stable security definer set search_path=public as $$
begin perform public.clinical_require_staff();
 if p_pet_id is null or p_search is null or length(p_search)>250 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Bounded same-patient problem search required' using errcode='23514';end if;
 return query select * from public.patient_problems where pet_id=p_pet_id and title ilike '%'||trim(p_search)||'%' order by updated_at desc,id desc limit p_limit;
end $$;
create function public.read_patient_problem_import_provenance(p_pet_id uuid,p_problem_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin perform public.clinical_require_staff();
 if p_pet_id is null or p_problem_ids is null or cardinality(p_problem_ids)>50 then raise exception 'Bounded patient problem IDs required' using errcode='23514';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('problem_id',p.id,'extractions',(select coalesce(jsonb_agg(public.ezyvet_extraction_projection(e.id) order by e.extracted_at,e.id),'[]') from public.ezyvet_problem_extractions e where e.problem_id=p.id)) order by p.id),'[]') from public.patient_problems p where p.pet_id=p_pet_id and p.id=any(p_problem_ids));
end $$;
-- Only exact public entrypoints are exposed, regardless of hosted default ACLs.
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and (proname in ('ezyvet_history_request_guard','ezyvet_history_require_actor','ezyvet_problem_fields','ezyvet_history_compact','ezyvet_history_current','ezyvet_history_identity_valid','ezyvet_imported_history_projection','ezyvet_discrepancy_projection','ezyvet_extraction_projection','ezyvet_history_source_context','ezyvet_validate_history_sources','ezyvet_history_review_context','ezyvet_history_request_projection','ezyvet_prepare_history_request','ezyvet_approve_history_request','recover_ezyvet_history_request','abandon_ezyvet_history_request','prepare_ezyvet_history_approval','approve_ezyvet_history','prepare_ezyvet_problem_extraction','approve_ezyvet_problem_extraction','prepare_ezyvet_history_discrepancy','approve_ezyvet_history_discrepancy','list_ezyvet_history_requests','list_patient_imported_histories','search_patient_problems','read_patient_problem_import_provenance')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('recover_ezyvet_history_request','abandon_ezyvet_history_request','prepare_ezyvet_history_approval','approve_ezyvet_history','prepare_ezyvet_problem_extraction','approve_ezyvet_problem_extraction','prepare_ezyvet_history_discrepancy','approve_ezyvet_history_discrepancy','list_ezyvet_history_requests','list_patient_imported_histories','search_patient_problems','read_patient_problem_import_provenance') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
