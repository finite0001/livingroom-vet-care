-- Durable DVM preparation only. Clinical validation/approval is added separately.
create table public.ezyvet_prescription_review_requests (
 id uuid primary key, actor_id uuid not null references public.profiles(id),
 pet_id uuid not null references public.pets(id),
 status text not null check(status in ('prepared','abandoned')),
 payload jsonb, request_hash text, review_context jsonb,
 created_at timestamptz not null default clock_timestamp(), resolved_at timestamptz,
 check(status='abandoned' or (payload is not null and request_hash is not null and review_context is not null)),
 check(request_hash is null or request_hash ~ '^[a-f0-9]{64}$'),
 check((status='abandoned')=(resolved_at is not null))
);
create index ezyvet_prescription_review_actor on public.ezyvet_prescription_review_requests(actor_id,pet_id,created_at desc,id desc);
alter table public.ezyvet_prescription_review_requests enable row level security;
revoke all on public.ezyvet_prescription_review_requests from public,anon,authenticated,service_role;
create function public.ezyvet_prescription_review_guard() returns trigger language plpgsql set search_path=public as $$begin
 if TG_OP='DELETE' or OLD.status<>'prepared' or NEW.status<>'abandoned'
  or (to_jsonb(NEW)-array['status','resolved_at']) is distinct from (to_jsonb(OLD)-array['status','resolved_at']) then
  raise exception 'Prescription review evidence is immutable' using errcode='23514';
 end if;return NEW;
end $$;
create trigger immutable_prescription_review before update or delete on public.ezyvet_prescription_review_requests for each row execute function public.ezyvet_prescription_review_guard();
create function public.ezyvet_prescription_require_dvm() returns uuid language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();begin
 if public.has_role(actor,'DVM') is not true then raise exception 'Active veterinarian required' using errcode='42501';end if;return actor;
end $$;
create function public.ezyvet_prescription_review_projection(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('request',to_jsonb(r),'receipt',null,'clinical_approval_available',false)
 from public.ezyvet_prescription_review_requests r where id=p_id;
$$;
create function public.prepare_ezyvet_prescription_review(p_id uuid,p_pet_id uuid,p_payload jsonb)
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
 -- Interpretation remains a draft: saving it is not clinical validation.
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
 context:=context||jsonb_build_object('patient_version',p_payload->'patient_version');
 insert into public.ezyvet_prescription_review_requests(id,actor_id,pet_id,status,payload,request_hash,review_context)
 values(p_id,actor,p_pet_id,'prepared',p_payload,encode(digest(jsonb_build_array(p_payload,context)::text,'sha256'),'hex'),context);
 return public.ezyvet_prescription_review_projection(p_id);
end $$;
create function public.recover_ezyvet_prescription_review(p_id uuid,p_pet_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.ezyvet_prescription_require_dvm();r public.ezyvet_prescription_review_requests;begin
 if p_id is null or p_pet_id is null then raise exception 'Durable operation and patient required' using errcode='23514';end if;
 select * into r from public.ezyvet_prescription_review_requests where id=p_id;if not found then return null;end if;
 if row(r.actor_id,r.pet_id) is distinct from row(actor,p_pet_id) then raise exception 'Review identity mismatch' using errcode='42501';end if;
 return public.ezyvet_prescription_review_projection(p_id);
end $$;
create function public.abandon_ezyvet_prescription_review(p_id uuid,p_pet_id uuid,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.ezyvet_prescription_require_dvm();r public.ezyvet_prescription_review_requests;begin
 if p_id is null or p_pet_id is null or p_confirmed is distinct from true then raise exception 'Explicit durable abandonment required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,5900));select * into r from public.ezyvet_prescription_review_requests where id=p_id for update;
 if found then
  if row(r.actor_id,r.pet_id) is distinct from row(actor,p_pet_id) then raise exception 'Review identity mismatch' using errcode='42501';end if;
  if r.status='prepared' then update public.ezyvet_prescription_review_requests set status='abandoned',resolved_at=clock_timestamp() where id=p_id;end if;
 else insert into public.ezyvet_prescription_review_requests(id,actor_id,pet_id,status,resolved_at) values(p_id,actor,p_pet_id,'abandoned',clock_timestamp());end if;
 return public.ezyvet_prescription_review_projection(p_id);
end $$;
create function public.list_ezyvet_prescription_review_requests(p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.ezyvet_prescription_require_dvm();rows jsonb;more boolean;lastrow jsonb;begin
 if p_pet_id is null or p_limit is null or p_limit not between 1 and 50 or(p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid request cursor' using errcode='23514';end if;
 select coalesce(jsonb_agg(public.ezyvet_prescription_review_projection(id) order by created_at desc,id desc),'[]') into rows
 from(select id,created_at from public.ezyvet_prescription_review_requests where actor_id=actor and pet_id=p_pet_id
  and(p_before_at is null or(created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit p_limit+1) s;
 more:=jsonb_array_length(rows)>p_limit;if more then rows:=rows-p_limit;end if;
 lastrow:=rows->(jsonb_array_length(rows)-1)->'request';
 return jsonb_build_object('requests',rows,'has_more',more,'next_cursor',case when more then jsonb_build_object('before_at',lastrow->'created_at','before_id',lastrow->'id') end);
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in
 ('ezyvet_prescription_review_guard','ezyvet_prescription_require_dvm','ezyvet_prescription_review_projection','prepare_ezyvet_prescription_review','recover_ezyvet_prescription_review','abandon_ezyvet_prescription_review','list_ezyvet_prescription_review_requests') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('prepare_ezyvet_prescription_review','recover_ezyvet_prescription_review','abandon_ezyvet_prescription_review','list_ezyvet_prescription_review_requests') then
   execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
