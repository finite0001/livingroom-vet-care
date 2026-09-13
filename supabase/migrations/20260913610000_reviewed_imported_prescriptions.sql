-- Attributed outside history only; no local prescribing or dispensing effects.
create table public.ezyvet_imported_prescriptions (
 id uuid primary key references public.ezyvet_prescription_review_requests(id),
 pet_id uuid not null references public.pets(id),client_id uuid not null references public.clients(id),animal_link_id uuid not null references public.ezyvet_record_links(id),
 source_origin text not null,source_site_uid text not null,prescription_external_id text not null,
 version integer not null check(version>0),version_hash text not null check(version_hash ~ '^[a-f0-9]{64}$'),
 interpretation_hash text not null check(interpretation_hash ~ '^[a-f0-9]{64}$'),context jsonb not null,
 reason text not null,replaces_id uuid unique references public.ezyvet_imported_prescriptions(id),expected_predecessor_hash text,
 approved_by uuid not null references public.profiles(id),approved_at timestamptz not null default clock_timestamp(),
 unique(source_origin,source_site_uid,animal_link_id,prescription_external_id,version),
 check((replaces_id is null)=(expected_predecessor_hash is null))
);
create table public.ezyvet_imported_prescription_items (
 prescription_id uuid not null references public.ezyvet_imported_prescriptions(id),ordinal integer not null check(ordinal>=0),
 snapshot_id uuid not null references public.ezyvet_import_snapshots(id),evidence jsonb not null,
 primary key(prescription_id,ordinal),unique(prescription_id,snapshot_id)
);
create index ezyvet_imported_prescription_patient on public.ezyvet_imported_prescriptions(pet_id,approved_at desc,id desc);
alter table public.ezyvet_prescription_review_requests add column approved_record_id uuid references public.ezyvet_imported_prescriptions(id);
alter table public.ezyvet_prescription_review_requests drop constraint ezyvet_prescription_review_requests_status_check,
 drop constraint ezyvet_prescription_review_requests_check,drop constraint ezyvet_prescription_review_requests_check1;
alter table public.ezyvet_prescription_review_requests
 add constraint prescription_review_status check(status in ('prepared','approved','abandoned')),
 add constraint prescription_review_evidence check(status='abandoned' or(payload is not null and request_hash is not null and review_context is not null)),
 add constraint prescription_review_terminal check((status<>'prepared')=(resolved_at is not null)),
 add constraint prescription_review_receipt check((status='approved')=(approved_record_id is not null));
create or replace function public.ezyvet_prescription_review_guard() returns trigger language plpgsql set search_path=public as $$begin
 if TG_OP='DELETE' or OLD.status<>'prepared' or NEW.status not in ('approved','abandoned')
  or (to_jsonb(NEW)-array['status','resolved_at','approved_record_id']) is distinct from (to_jsonb(OLD)-array['status','resolved_at','approved_record_id']) then
  raise exception 'Prescription review evidence is immutable' using errcode='23514';end if;return NEW;
end $$;
do $$declare t text;begin foreach t in array array['ezyvet_imported_prescriptions','ezyvet_imported_prescription_items'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger immutable_imported_prescription before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);
end loop;end $$;
create function public.ezyvet_prescription_interpretation_hash(p_context jsonb) returns text language sql immutable set search_path=public,extensions as $$
 -- Run UUID and current patient edit version are eligibility, not new history.
 select encode(digest((p_context-array['item_run','patient_version'])::text,'sha256'),'hex');
$$;
create function public.ezyvet_prescription_review_predecessor(p_context jsonb,p_review jsonb)
returns public.ezyvet_imported_prescriptions language plpgsql security definer set search_path=public as $$
declare latest public.ezyvet_imported_prescriptions;ih text:=public.ezyvet_prescription_interpretation_hash(p_context);begin
 select * into latest from public.ezyvet_imported_prescriptions where animal_link_id=(p_context->>'animal_link_id')::uuid
  and source_origin=p_context#>>'{source,origin}' and source_site_uid=p_context#>>'{source,site_uid}'
  and prescription_external_id=p_context#>>'{parent,external_id}' order by version desc limit 1;
 if latest.id is not null and latest.interpretation_hash=ih then
  if p_review->>'replaces_id' is not null and row((p_review->>'replaces_id')::uuid,p_review->>'expected_predecessor_hash') is distinct from row(latest.id,latest.version_hash)
   and row((p_review->>'replaces_id')::uuid,p_review->>'expected_predecessor_hash') is distinct from row(latest.replaces_id,latest.expected_predecessor_hash) then
   raise exception 'Prescription predecessor identity mismatch' using errcode='40001';end if;
  return latest;
 end if;
 if latest.id is null then
  if p_review->>'replaces_id' is not null then raise exception 'No predecessor for this prescription identity' using errcode='40001';end if;
 elsif row(latest.id,latest.version_hash) is distinct from row((p_review->>'replaces_id')::uuid,p_review->>'expected_predecessor_hash') then
  raise exception 'Latest prescription predecessor and rationale required' using errcode='40001';end if;
 return latest;
end $$;
create function public.ezyvet_prescription_current(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('is_latest',not exists(select 1 from public.ezyvet_imported_prescriptions n where n.replaces_id=v.id),
  'identity_valid',coalesce(m.pet_id=v.pet_id and m.client_id=v.client_id and p.client_id=v.client_id and m.resource='animal'
   and row(m.source_origin,m.source_site_uid,m.external_id)=row(v.source_origin,v.source_site_uid,v.context#>>'{source,animal_id}'),false),
  'is_current',coalesce(m.pet_id=v.pet_id and m.client_id=v.client_id and p.client_id=v.client_id and m.resource='animal'
   and row(m.source_origin,m.source_site_uid,m.external_id)=row(v.source_origin,v.source_site_uid,v.context#>>'{source,animal_id}')
   and h.snapshot_id=(v.context#>>'{parent,snapshot_id}')::uuid and h.version=(v.context#>>'{parent,observed_head_version}')::integer
   and (v.context#>>'{consult,status}'='not_supplied' or exists(select 1 from public.ezyvet_identity_heads ch
    where ch.source_origin=v.source_origin and ch.source_site_uid=v.source_site_uid and ch.resource='consult'
     and ch.external_id=v.context#>>'{consult,reference}' and ch.snapshot_id=(v.context#>>'{consult,snapshot_id}')::uuid
     and ch.version=(v.context#>>'{consult,observed_head_version}')::integer))
   and not exists(select 1 from jsonb_array_elements(v.context->'items') item where not exists(select 1 from public.ezyvet_identity_heads ih
    where ih.source_origin=v.source_origin and ih.source_site_uid=v.source_site_uid and ih.resource='prescriptionitem'
     and ih.external_id=item->>'external_id' and ih.snapshot_id=(item->>'snapshot_id')::uuid and ih.version=(item->>'observed_head_version')::integer)),false))
 from public.ezyvet_imported_prescriptions v left join public.ezyvet_record_links m on m.id=v.animal_link_id
 left join public.pets p on p.id=v.pet_id left join public.ezyvet_identity_heads h on h.source_origin=v.source_origin
 and h.source_site_uid=v.source_site_uid and h.resource='prescription' and h.external_id=v.prescription_external_id where v.id=p_id;
$$;
create function public.ezyvet_imported_prescription_projection(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select (to_jsonb(v)-array['interpretation_hash'])||jsonb_build_object('current',public.ezyvet_prescription_current(v.id),
  'items',(select coalesce(jsonb_agg(i.evidence order by i.ordinal),'[]') from public.ezyvet_imported_prescription_items i where i.prescription_id=v.id),
  'correction_history',(select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'version',n.version,'version_hash',n.version_hash,'replaces_id',n.replaces_id,'reason',n.reason,'approved_by',n.approved_by,'approved_at',n.approved_at) order by n.version),'[]')
   from public.ezyvet_imported_prescriptions n where row(n.source_origin,n.source_site_uid,n.animal_link_id,n.prescription_external_id)=row(v.source_origin,v.source_site_uid,v.animal_link_id,v.prescription_external_id)))
 from public.ezyvet_imported_prescriptions v where v.id=p_id;
$$;
create or replace function public.ezyvet_prescription_review_projection(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('request',to_jsonb(r),'receipt',public.ezyvet_imported_prescription_projection(r.approved_record_id),'clinical_approval_available',true)
 from public.ezyvet_prescription_review_requests r where id=p_id;
$$;
create function public.approve_ezyvet_prescription_review(p_id uuid,p_pet_id uuid,p_expected_hash text,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare actor uuid:=public.ezyvet_prescription_require_dvm();r public.ezyvet_prescription_review_requests;
 context jsonb;old public.ezyvet_imported_prescriptions;record_id uuid;ih text;moment timestamptz:=clock_timestamp();begin
 if p_confirmed is distinct from true then raise exception 'Explicit veterinarian confirmation required' using errcode='23514';end if;
 if p_id is null or p_pet_id is null or p_expected_hash is null then raise exception 'Exact owned prepared review required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,5900));
 select * into r from public.ezyvet_prescription_review_requests where id=p_id for update;
 if not found or row(r.actor_id,r.pet_id,r.request_hash) is distinct from row(actor,p_pet_id,p_expected_hash) then
  raise exception 'Exact owned prepared review required' using errcode='42501';end if;
 if r.status='approved' then return public.ezyvet_prescription_review_projection(p_id);end if;
 if r.status<>'prepared' then raise exception 'Abandoned review cannot approve' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 context:=public.ezyvet_prescription_source_context(p_pet_id,(r.payload->>'item_run_id')::uuid);
 if not exists(select 1 from public.pets where id=p_pet_id and version::numeric=(r.payload->>'patient_version')::numeric) then
  raise exception 'Patient version changed' using errcode='40001';end if;
 context:=public.ezyvet_prescription_interpretation_context(context,r.payload->'interpretation');
 context:=context||jsonb_build_object('patient_version',r.payload->'patient_version');
 if context is distinct from r.review_context then raise exception 'Prepared prescription context changed' using errcode='40001';end if;
 old:=public.ezyvet_prescription_review_predecessor(context,r.payload->'interpretation');
 ih:=public.ezyvet_prescription_interpretation_hash(context);
 if old.id is not null and old.interpretation_hash=ih then record_id:=old.id;
 else
  record_id:=p_id;
  insert into public.ezyvet_imported_prescriptions(id,pet_id,client_id,animal_link_id,source_origin,source_site_uid,prescription_external_id,
   version,version_hash,interpretation_hash,context,reason,replaces_id,expected_predecessor_hash,approved_by,approved_at)
  values(p_id,p_pet_id,(context->>'client_id')::uuid,(context->>'animal_link_id')::uuid,context#>>'{source,origin}',context#>>'{source,site_uid}',context#>>'{parent,external_id}',
   coalesce(old.version,0)+1,encode(digest(jsonb_build_array(p_id,context,r.payload,actor,moment,old.id)::text,'sha256'),'hex'),ih,context,
   r.payload#>>'{interpretation,reason}',old.id,old.version_hash,actor,moment);
  insert into public.ezyvet_imported_prescription_items(prescription_id,ordinal,snapshot_id,evidence)
   select p_id,(ordinality-1)::integer,(value#>>'{source,snapshot_id}')::uuid,value from jsonb_array_elements(context->'selected_items') with ordinality;
 end if;
 update public.ezyvet_prescription_review_requests set status='approved',resolved_at=clock_timestamp(),approved_record_id=record_id where id=p_id;
 return public.ezyvet_prescription_review_projection(p_id);
end $$;
create function public.list_patient_imported_prescriptions(p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows jsonb;more boolean;lastrow jsonb;begin
 perform public.clinical_require_staff();
 if p_pet_id is null or p_limit is null or p_limit not between 1 and 50 or(p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid prescription chart cursor' using errcode='23514';end if;
 select coalesce(jsonb_agg(public.ezyvet_imported_prescription_projection(id) order by approved_at desc,id desc),'[]') into rows
  from(select id,approved_at from public.ezyvet_imported_prescriptions where pet_id=p_pet_id and(p_before_at is null or(approved_at,id)<(p_before_at,p_before_id)) order by approved_at desc,id desc limit p_limit+1) s;
 more:=jsonb_array_length(rows)>p_limit;if more then rows:=rows-p_limit;end if;lastrow:=rows->(jsonb_array_length(rows)-1);
 return jsonb_build_object('prescriptions',rows,'has_more',more,'next_cursor',case when more then jsonb_build_object('before_at',lastrow->'approved_at','before_id',lastrow->'id') end);
end $$;

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
 perform public.ezyvet_prescription_review_predecessor(context,p_payload->'interpretation');
 insert into public.ezyvet_prescription_review_requests(id,actor_id,pet_id,status,payload,request_hash,review_context)
 values(p_id,actor,p_pet_id,'prepared',p_payload,encode(digest(jsonb_build_array(p_payload,context)::text,'sha256'),'hex'),context);
 return public.ezyvet_prescription_review_projection(p_id);
end $$;

do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in
 ('ezyvet_prescription_interpretation_hash','ezyvet_prescription_review_predecessor','ezyvet_prescription_current','ezyvet_imported_prescription_projection','approve_ezyvet_prescription_review','list_patient_imported_prescriptions') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('approve_ezyvet_prescription_review','list_patient_imported_prescriptions') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
