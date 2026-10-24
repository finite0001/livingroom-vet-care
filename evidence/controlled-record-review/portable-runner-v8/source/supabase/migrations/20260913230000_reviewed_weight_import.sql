-- Historical weight promotion is explicit; no signed records or existing weights change.
alter table public.ezyvet_import_runs drop constraint ezyvet_import_runs_resource_check;
alter table public.ezyvet_import_runs add constraint ezyvet_import_runs_resource_check check(resource in ('contact','contactdetail','address','animal','species','breed','sex','animalcolour','appointment','consult','history','vaccination','diagnostic','healthstatus'));
create table public.ezyvet_weight_runs (
 run_id uuid primary key references public.ezyvet_import_runs(id),animal_link_id uuid not null references public.ezyvet_record_links(id),created_at timestamptz not null default now()
);
create table public.ezyvet_weight_requests (
 request_id uuid primary key,actor_id uuid not null references public.profiles(id),snapshot_id uuid not null references public.ezyvet_import_snapshots(id),
 payload jsonb,status text not null check(status in ('prepared','completed','abandoned')),created_at timestamptz not null default now(),check(status='abandoned' or payload is not null)
);
alter table public.ezyvet_weight_requests enable row level security;
revoke all on public.ezyvet_weight_requests from public,anon,authenticated,service_role;
grant select on public.ezyvet_weight_requests to authenticated;
create policy "Own weight request recovery" on public.ezyvet_weight_requests for select to authenticated using(actor_id=auth.uid() and public.ezyvet_is_active_admin(auth.uid()));
create unique index one_weight_preparation on public.ezyvet_weight_requests(actor_id,snapshot_id) where status='prepared';
create function public.prepare_ezyvet_weight_request(p_request_id uuid,p_snapshot_id uuid,p_payload jsonb) returns public.ezyvet_weight_requests language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_weight_requests;begin
 if public.ezyvet_is_active_admin(auth.uid()) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload->>'snapshot_id' is distinct from p_snapshot_id::text or octet_length(p_payload::text)>10000 then raise exception 'Invalid weight preparation' using errcode='23514';end if;
 perform 1 from ezyvet_import_snapshots where id=p_snapshot_id and resource='healthstatus';if not found then raise exception 'Weight source required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('weight-approval:'||p_request_id::text,0));
 select * into r from ezyvet_weight_requests where request_id=p_request_id;
 if found then if r.actor_id<>auth.uid() or r.snapshot_id<>p_snapshot_id or r.payload is distinct from p_payload or r.status='abandoned' then raise exception 'Prepared request cannot change or revive' using errcode='42501';end if;return r;end if;
 insert into ezyvet_weight_requests(request_id,actor_id,snapshot_id,payload,status) values(p_request_id,auth.uid(),p_snapshot_id,p_payload,'prepared') returning * into r;return r;
end $$;
create table public.ezyvet_weight_approvals (
 request_id uuid primary key,request_hash text not null,source_origin text not null,source_site_uid text not null,external_id text not null,
 snapshot_id uuid not null references public.ezyvet_import_snapshots(id),head_version integer not null,animal_link_id uuid not null references public.ezyvet_record_links(id),
 pet_id uuid not null references public.pets(id),patient_version integer not null,weight_id uuid not null references public.patient_weights(id),
 action text not null check(action in ('create','link')),reviewed_values jsonb not null,reason text not null,approved_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(source_origin,source_site_uid,external_id)
);
create table public.ezyvet_weight_source_reviews (
 request_id uuid primary key,approval_id uuid not null references public.ezyvet_weight_approvals(request_id),snapshot_id uuid not null references public.ezyvet_import_snapshots(id),head_version integer not null,
 reason text not null check(length(trim(reason)) between 5 and 2000),reviewed_by uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
do $$declare t text;begin foreach t in array array['ezyvet_weight_runs','ezyvet_weight_approvals','ezyvet_weight_source_reviews'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);execute format('grant select on public.%I to authenticated,service_role',t);
 execute format('create policy "Administrator weight import read" on public.%I for select to authenticated using(public.ezyvet_is_active_admin(auth.uid()))',t);
 execute format('create trigger immutable_weight_import before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);
end loop;end $$;
-- Generic endpoints cannot bypass the patient scope required for healthstatus.
alter function public.claim_ezyvet_import(uuid,uuid,text,text,text) rename to claim_ezyvet_import_core;
revoke all on function public.claim_ezyvet_import_core(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
create function public.claim_ezyvet_import(p_id uuid,p_actor uuid,p_site_uid text,p_resource text,p_source_origin text) returns public.ezyvet_import_runs language plpgsql security definer set search_path=public as $$
begin if p_resource in ('healthstatus','diagnostic') then raise exception 'Resource requires a supported patient-scoped contract' using errcode='23514';end if;return public.claim_ezyvet_import_core(p_id,p_actor,p_site_uid,p_resource,p_source_origin);end $$;
create function public.claim_ezyvet_weight_import(p_id uuid,p_actor uuid,p_site_uid text,p_source_origin text,p_animal_link_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare link public.ezyvet_record_links;r public.ezyvet_import_runs;context public.ezyvet_weight_runs;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into link from public.ezyvet_record_links where id=p_animal_link_id and resource='animal' and source_origin=p_source_origin and source_site_uid=p_site_uid for share;
 if not found or link.external_id !~ '^[0-9]+$' or not exists(select 1 from public.pets where id=link.pet_id and client_id=link.client_id) then raise exception 'Reviewed patient mapping required for this source site' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('weight-run:'||p_id::text,0));
 select * into context from public.ezyvet_weight_runs where run_id=p_id;
 if found and context.animal_link_id<>p_animal_link_id then raise exception 'Import mapping cannot change' using errcode='42501';end if;
 r:=public.claim_ezyvet_import_core(p_id,p_actor,p_site_uid,'healthstatus',p_source_origin);
 insert into public.ezyvet_weight_runs(run_id,animal_link_id) values(p_id,p_animal_link_id) on conflict(run_id) do nothing;
 return to_jsonb(r)||jsonb_build_object('animal_external_id',link.external_id,'animal_link_id',link.id);
end $$;
alter function public.stage_ezyvet_import_page(uuid,uuid,uuid,integer,boolean,jsonb) rename to stage_ezyvet_import_page_core;
revoke all on function public.stage_ezyvet_import_page_core(uuid,uuid,uuid,integer,boolean,jsonb) from public,anon,authenticated,service_role;
create function public.stage_ezyvet_import_page(p_id uuid,p_actor uuid,p_lease_id uuid,p_page integer,p_complete boolean,p_items jsonb) returns public.ezyvet_import_runs language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_import_runs;link public.ezyvet_record_links;
begin
 select * into strict r from public.ezyvet_import_runs where id=p_id;
 if r.resource='healthstatus' then
  select l.* into link from public.ezyvet_weight_runs w join public.ezyvet_record_links l on l.id=w.animal_link_id where w.run_id=p_id;
  if not found or p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'Patient-scoped page required' using errcode='23514';end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where x#>>'{payload,animal_id}' is distinct from link.external_id) then raise exception 'Source patient mismatch' using errcode='23514';end if;
 end if;
 return public.stage_ezyvet_import_page_core(p_id,p_actor,p_lease_id,p_page,p_complete,p_items);
end $$;
create function public.search_ezyvet_weight_patients(p_search text,p_limit integer default 20) returns table(link_id uuid,pet_id uuid,patient_name text,household_name text,source_origin text,source_site_uid text,external_id text,patient_version integer) language plpgsql stable security definer set search_path=public as $$
begin
 if public.ezyvet_is_active_admin(auth.uid()) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_search is null or length(trim(p_search))<2 or length(p_search)>200 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Enter a bounded patient search' using errcode='23514';end if;
 return query select l.id,p.id,p.name,c.full_name,l.source_origin,l.source_site_uid,l.external_id,p.version from ezyvet_record_links l join pets p on p.id=l.pet_id and p.client_id=l.client_id join clients c on c.id=p.client_id where l.resource='animal' and (p.name ilike '%'||trim(p_search)||'%' or c.full_name ilike '%'||trim(p_search)||'%') order by p.name,l.id limit p_limit;
end $$;
create function public.list_ezyvet_weight_candidates(p_animal_link_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns setof jsonb language plpgsql stable security definer set search_path=public as $$
declare link public.ezyvet_record_links;
begin
 if public.ezyvet_is_active_admin(auth.uid()) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 50 or (p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid cursor' using errcode='23514';end if;
 select * into strict link from ezyvet_record_links where id=p_animal_link_id and resource='animal';
 return query select to_jsonb(s)||jsonb_build_object('head_version',h.version,'current_snapshot_id',h.snapshot_id,'approval_id',a.request_id,'weight_id',a.weight_id,'approved_snapshot_id',a.snapshot_id,'patient_version',p.version)
 from ezyvet_import_snapshots s join ezyvet_identity_heads h on h.source_origin=s.source_origin and h.source_site_uid=s.source_site_uid and h.resource=s.resource and h.external_id=s.external_id
 join pets p on p.id=link.pet_id and p.client_id=link.client_id
 left join ezyvet_weight_approvals a on a.source_origin=s.source_origin and a.source_site_uid=s.source_site_uid and a.external_id=s.external_id
 where s.source_origin=link.source_origin and s.source_site_uid=link.source_site_uid and s.resource='healthstatus' and s.payload->>'animal_id'=link.external_id and (p_before_at is null or (s.created_at,s.id)<(p_before_at,p_before_id)) order by s.created_at desc,s.id desc limit p_limit;
end $$;
create function public.resolve_ezyvet_weight_request(p_request_id uuid,p_snapshot_id uuid,p_discard boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_weight_requests;a public.ezyvet_weight_approvals;begin
 if public.ezyvet_is_active_admin(auth.uid()) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('weight-approval:'||p_request_id::text,0));
 select * into r from ezyvet_weight_requests where request_id=p_request_id;
 if found and (r.actor_id<>auth.uid() or r.snapshot_id<>p_snapshot_id) then raise exception 'Request owner mismatch' using errcode='42501';end if;
 select * into a from ezyvet_weight_approvals where request_id=p_request_id and approved_by=auth.uid();
 if found then update ezyvet_weight_requests set status='completed' where request_id=p_request_id;return jsonb_build_object('approved',true,'weight_id',a.weight_id);end if;
 if p_discard is distinct from true then raise exception 'Unconfirmed approval needs explicit discard or recovery' using errcode='23514';end if;
 insert into ezyvet_weight_requests(request_id,actor_id,snapshot_id,payload,status) values(p_request_id,auth.uid(),p_snapshot_id,null,'abandoned') on conflict(request_id) do update set status='abandoned';
 return jsonb_build_object('approved',false,'abandoned',true);
end $$;
create function public.approve_ezyvet_weight(p_request_id uuid,p_actor_id uuid,p_snapshot_id uuid,p_expected_hash text,p_head_version integer,p_animal_link_id uuid,p_patient_version integer,p_action text,p_weight_id uuid,p_weight numeric,p_unit text,p_measured_at date,p_confirmed boolean,p_reason text) returns public.ezyvet_weight_approvals language plpgsql security definer set search_path=public,extensions as $$
declare actor uuid:=auth.uid();fingerprint text;s public.ezyvet_import_snapshots;h public.ezyvet_identity_heads;link public.ezyvet_record_links;w public.patient_weights;r public.ezyvet_weight_approvals;
begin
 if actor is distinct from p_actor_id or public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator actor required' using errcode='42501';end if;
 if p_request_id is null or p_confirmed is distinct from true or p_action is null or p_action not in ('create','link') or p_reason is null or length(trim(p_reason)) not between 5 and 2000 or p_weight is null or p_weight::text in ('NaN','Infinity','-Infinity') or p_weight<=0 or p_weight>10000 or p_unit is null or p_unit not in ('kg','lb') or p_measured_at is null or not isfinite(p_measured_at) or p_measured_at>(now() at time zone 'America/Denver')::date then raise exception 'Review finite weight, unit, date, identity and reason' using errcode='23514';end if;
 fingerprint:=encode(digest(jsonb_build_array(p_snapshot_id,p_expected_hash,p_head_version,p_animal_link_id,p_patient_version,p_action,p_weight_id,p_weight,p_unit,p_measured_at,p_reason)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('weight-approval:'||p_request_id::text,0));
 select * into r from ezyvet_weight_approvals where request_id=p_request_id;
 if found then if r.approved_by<>actor or r.request_hash<>fingerprint then raise exception 'Approval ID belongs to a different request' using errcode='42501';end if;return r;end if;
 if not exists(select 1 from ezyvet_weight_requests where request_id=p_request_id and actor_id=actor and snapshot_id=p_snapshot_id and status='prepared' and payload=jsonb_build_object('snapshot_id',p_snapshot_id,'expected_hash',p_expected_hash,'head_version',p_head_version,'animal_link_id',p_animal_link_id,'patient_version',p_patient_version,'action',p_action,'weight_id',p_weight_id,'weight',p_weight,'unit',p_unit,'measured_at',p_measured_at,'reason',p_reason)) then raise exception 'Exact prepared weight request required' using errcode='42501';end if;
 select * into strict s from ezyvet_import_snapshots where id=p_snapshot_id and resource='healthstatus';
 if coalesce(s.payload->>'active','') not in ('true','1') then raise exception 'Only an active source observation can create or link a weight' using errcode='23514';end if;
 select * into h from ezyvet_identity_heads where source_origin=s.source_origin and source_site_uid=s.source_site_uid and resource=s.resource and external_id=s.external_id for update;
 if h.snapshot_id is distinct from s.id or h.version is distinct from p_head_version or s.payload_hash is distinct from p_expected_hash then raise exception 'Source changed; review current observation' using errcode='40001';end if;
 select * into link from ezyvet_record_links where id=p_animal_link_id and resource='animal' and source_origin=s.source_origin and source_site_uid=s.source_site_uid and external_id=s.payload->>'animal_id' for share;
 if not found then raise exception 'Source patient mapping mismatch' using errcode='42501';end if;
 perform 1 from pets where id=link.pet_id and client_id=link.client_id and version=p_patient_version for share;
 if not found then raise exception 'Patient changed; review mapping again' using errcode='40001';end if;
 if exists(select 1 from ezyvet_weight_approvals where source_origin=s.source_origin and source_site_uid=s.source_site_uid and external_id=s.external_id) then raise exception 'Source already approved; review changes without replacing local history' using errcode='23505';end if;
 if p_action='create' then
  if p_weight_id is not null then raise exception 'New weight cannot specify existing target' using errcode='23514';end if;
  w:=public.record_patient_weight(link.pet_id,p_weight,p_unit,p_measured_at);
 else
  select * into w from patient_weights where id=p_weight_id and pet_id=link.pet_id and weight=p_weight and unit=p_unit and measured_at=p_measured_at for share;
  if not found then raise exception 'Existing weight must match reviewed patient and values exactly' using errcode='23514';end if;
 end if;
 insert into ezyvet_weight_approvals(request_id,request_hash,source_origin,source_site_uid,external_id,snapshot_id,head_version,animal_link_id,pet_id,patient_version,weight_id,action,reviewed_values,reason,approved_by)
 values(p_request_id,fingerprint,s.source_origin,s.source_site_uid,s.external_id,s.id,h.version,link.id,link.pet_id,p_patient_version,w.id,p_action,jsonb_build_object('weight',p_weight,'unit',p_unit,'measured_at',p_measured_at),trim(p_reason),actor) returning * into r;
 update ezyvet_weight_requests set status='completed' where request_id=p_request_id;
 return r;
end $$;
create function public.review_ezyvet_weight_change(p_request_id uuid,p_approval_id uuid,p_snapshot_id uuid,p_head_version integer,p_reason text) returns public.ezyvet_weight_source_reviews language plpgsql security definer set search_path=public as $$
declare a public.ezyvet_weight_approvals;s public.ezyvet_import_snapshots;h public.ezyvet_identity_heads;r public.ezyvet_weight_source_reviews;
begin
 if public.ezyvet_is_active_admin(auth.uid()) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('weight-change:'||p_request_id::text,0));
 select * into r from ezyvet_weight_source_reviews where request_id=p_request_id;
 if found then if row(r.approval_id,r.snapshot_id,r.head_version,r.reason,r.reviewed_by) is distinct from row(p_approval_id,p_snapshot_id,p_head_version,trim(p_reason),auth.uid()) then raise exception 'Review ID mismatch' using errcode='42501';end if;return r;end if;
 select * into strict a from ezyvet_weight_approvals where request_id=p_approval_id;
 select * into strict s from ezyvet_import_snapshots where id=p_snapshot_id and resource='healthstatus' and source_origin=a.source_origin and source_site_uid=a.source_site_uid and external_id=a.external_id;
 select * into h from ezyvet_identity_heads where source_origin=s.source_origin and source_site_uid=s.source_site_uid and resource=s.resource and external_id=s.external_id for share;
 if h.snapshot_id is distinct from s.id or h.version is distinct from p_head_version then raise exception 'Source changed; review current observation' using errcode='40001';end if;
 insert into ezyvet_weight_source_reviews(request_id,approval_id,snapshot_id,head_version,reason,reviewed_by) values(p_request_id,a.request_id,s.id,h.version,trim(p_reason),auth.uid()) returning * into r;return r;
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('claim_ezyvet_import','claim_ezyvet_weight_import','stage_ezyvet_import_page','search_ezyvet_weight_patients','list_ezyvet_weight_candidates','approve_ezyvet_weight','review_ezyvet_weight_change','prepare_ezyvet_weight_request','resolve_ezyvet_weight_request') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 execute format('grant execute on function %s to %I',f.signature,case when f.proname in ('claim_ezyvet_import','claim_ezyvet_weight_import','stage_ezyvet_import_page') then 'service_role' else 'authenticated' end);
 end loop;
end $$;

create function public.read_weight_import_provenance(p_pet_id uuid,p_weight_ids uuid[]) returns table(weight_id uuid,source_record_id text,source_weight text,source_unit text,source_timestamp text,reviewed_at timestamptz,reviewer_name text,reviewed_measurement_date text) language plpgsql stable security definer set search_path=public as $$
begin
 perform public.clinical_require_staff();
 if p_pet_id is null or p_weight_ids is null or cardinality(p_weight_ids)>50 then raise exception 'Bounded patient weight list required' using errcode='23514';end if;
 return query select a.weight_id,a.external_id,s.payload->>'weight',s.payload->>'weight_unit',s.payload->>'timestamp',a.created_at,p.full_name,a.reviewed_values->>'measured_at'
 from ezyvet_weight_approvals a join ezyvet_import_snapshots s on s.id=a.snapshot_id join profiles p on p.id=a.approved_by
 where a.pet_id=p_pet_id and a.weight_id=any(p_weight_ids);
end $$;
revoke all on function public.read_weight_import_provenance(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.read_weight_import_provenance(uuid,uuid[]) to authenticated;
