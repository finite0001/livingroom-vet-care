-- Qualitative observation template, pending veterinarian review; no calculated clinical scores.
create table public.patient_qol_records (
 id uuid primary key, pet_id uuid not null references public.pets(id) on delete restrict,
 template_version text not null default 'draft-2026-09-12' check(template_version='draft-2026-09-12'),
 observed_at timestamptz not null check(isfinite(observed_at)), observer text not null check(length(trim(observer)) between 1 and 200),
 appetite text not null default '' check(length(appetite)<=5000), drinking text not null default '' check(length(drinking)<=5000),
 mobility text not null default '' check(length(mobility)<=5000), comfort text not null default '' check(length(comfort)<=5000),
 social_engagement text not null default '' check(length(social_engagement)<=5000), good_days text not null default '' check(length(good_days)<=5000),
 notes text not null default '' check(length(notes)<=20000), status text not null default 'draft' check(status in ('draft','signed')),
 version integer not null default 1, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now(), signed_by uuid references auth.users(id), signed_at timestamptz,
 check((status='draft' and signed_by is null and signed_at is null) or (status='signed' and signed_by is not null and signed_at is not null))
);
create index patient_qol_pet_idx on public.patient_qol_records(pet_id,observed_at desc);
create table public.patient_qol_addenda (
 id uuid primary key, qol_id uuid not null references public.patient_qol_records(id) on delete restrict,
 content text not null check(length(trim(content)) between 1 and 20000), created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.patient_lesions (
 id uuid primary key, pet_id uuid not null references public.pets(id) on delete restrict,
 label text not null check(length(trim(label)) between 1 and 200), body_view text not null check(body_view in ('dorsal','ventral','left','right')),
 x numeric not null check(x::text not in ('NaN','Infinity','-Infinity') and x between 0 and 1), y numeric not null check(y::text not in ('NaN','Infinity','-Infinity') and y between 0 and 1),
 version integer not null default 1, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
create index patient_lesions_pet_idx on public.patient_lesions(pet_id,created_at);
create table public.patient_lesion_observations (
 id uuid primary key, lesion_id uuid not null references public.patient_lesions(id) on delete restrict,
 observed_at timestamptz not null check(isfinite(observed_at)), label text not null check(length(trim(label)) between 1 and 200), body_view text not null check(body_view in ('dorsal','ventral','left','right')),
 x numeric not null check(x::text not in ('NaN','Infinity','-Infinity') and x between 0 and 1), y numeric not null check(y::text not in ('NaN','Infinity','-Infinity') and y between 0 and 1), length_mm numeric check(length_mm::text not in ('NaN','Infinity','-Infinity') and length_mm>=0),
 width_mm numeric check(width_mm::text not in ('NaN','Infinity','-Infinity') and width_mm>=0), depth_mm numeric check(depth_mm::text not in ('NaN','Infinity','-Infinity') and depth_mm>=0),
 notes text not null default '' check(length(notes)<=20000), photo_document_id uuid references public.patient_documents(id) on delete restrict,
 request jsonb not null, created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index patient_lesion_observations_idx on public.patient_lesion_observations(lesion_id,observed_at desc);
create table public.patient_lesion_corrections (
 id uuid primary key, observation_id uuid not null unique references public.patient_lesion_observations(id) on delete restrict,
 reason text not null check(length(trim(reason)) between 1 and 20000), created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create function public.care_chart_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();
begin
 if TG_OP='DELETE' then raise exception 'Care chart history cannot be deleted' using errcode='23514'; end if;
 if TG_OP='UPDATE' then
  if TG_TABLE_NAME not in ('patient_qol_records','patient_lesions') then raise exception 'Observations and corrections are append-only' using errcode='23514'; end if;
  NEW.created_by:=OLD.created_by; NEW.created_at:=OLD.created_at; NEW.pet_id:=OLD.pet_id; NEW.version:=OLD.version+1;
 else NEW.created_by:=actor; NEW.created_at:=now(); end if;
 if TG_TABLE_NAME in ('patient_qol_records','patient_lesions') then NEW.updated_by:=actor; NEW.updated_at:=now(); end if;
 if TG_TABLE_NAME='patient_qol_records' then
  if TG_OP='UPDATE' then if OLD.status='signed' then raise exception 'Signed quality-of-life records are immutable; add an addendum' using errcode='23514'; end if; end if;
  if NEW.status='signed' then
   if length(trim(NEW.appetite||NEW.drinking||NEW.mobility||NEW.comfort||NEW.social_engagement||NEW.good_days||NEW.notes))=0 then raise exception 'Document observations before signing' using errcode='23514'; end if;
   NEW.signed_by:=actor; NEW.signed_at:=now();
  else NEW.signed_by:=null; NEW.signed_at:=null; end if;
 end if;
 return NEW;
end $$;
do $$ declare t text; begin
 foreach t in array array['patient_qol_records','patient_qol_addenda','patient_lesions','patient_lesion_observations','patient_lesion_corrections'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated,service_role',t);
  execute format('create policy "Active staff read" on public.%I for select to authenticated using(public.is_active_staff(auth.uid()))',t);
  execute format('create trigger care_chart_guard before insert or update or delete on public.%I for each row execute function public.care_chart_guard()',t);
  execute format('create trigger care_chart_audit after insert or update on public.%I for each row execute function public.audit_trigger_fn()',t);
 end loop;
end $$;
create function public.save_patient_qol(p_id uuid,p_pet_id uuid,p_expected_version integer,p_observed_at timestamptz,p_observer text,p_appetite text,p_drinking text,p_mobility text,p_comfort text,p_social_engagement text,p_good_days text,p_notes text) returns public.patient_qol_records language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); result public.patient_qol_records;
begin
 if p_observed_at is null or not isfinite(p_observed_at) or p_observed_at>now()+interval '5 minutes' then raise exception 'Invalid observation time' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into result from public.patient_qol_records where id=p_id for update;
 if found then
  if result.pet_id<>p_pet_id then raise exception 'Patient does not match chart' using errcode='23514'; end if;
  if (case when p_expected_version is null then result.created_by else result.updated_by end)=actor and result.version=coalesce(p_expected_version+1,1) and row(result.observed_at,result.observer,result.appetite,result.drinking,result.mobility,result.comfort,result.social_engagement,result.good_days,result.notes) is not distinct from row(p_observed_at,p_observer,p_appetite,p_drinking,p_mobility,p_comfort,p_social_engagement,p_good_days,p_notes) then return result; end if;
  if result.version is distinct from p_expected_version then raise exception 'Chart changed; reload before saving' using errcode='40001'; end if;
  update public.patient_qol_records set observed_at=p_observed_at,observer=p_observer,appetite=p_appetite,drinking=p_drinking,mobility=p_mobility,comfort=p_comfort,social_engagement=p_social_engagement,good_days=p_good_days,notes=p_notes where id=p_id returning * into result;
 else
  if p_expected_version is not null then raise exception 'Chart no longer exists' using errcode='40001'; end if;
  insert into public.patient_qol_records(id,pet_id,observed_at,observer,appetite,drinking,mobility,comfort,social_engagement,good_days,notes,created_by,updated_by) values(p_id,p_pet_id,p_observed_at,p_observer,p_appetite,p_drinking,p_mobility,p_comfort,p_social_engagement,p_good_days,p_notes,actor,actor) returning * into result;
 end if;
 return result;
end $$;
create function public.sign_patient_qol(p_id uuid,p_expected_version integer) returns public.patient_qol_records language plpgsql security definer set search_path=public as $$
declare result public.patient_qol_records; actor uuid:=public.clinical_require_staff();
begin
 select * into result from public.patient_qol_records where id=p_id for update;
 if found and result.status='signed' and result.signed_by=actor and result.version=p_expected_version+1 then return result; end if;
 update public.patient_qol_records set status='signed' where id=p_id and version=p_expected_version returning * into result;
 if not found then raise exception 'Chart changed; reload before signing' using errcode='40001'; end if; return result;
end $$;
create function public.add_patient_qol_addendum(p_id uuid,p_qol_id uuid,p_content text) returns public.patient_qol_addenda language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); result public.patient_qol_addenda;
begin
 perform 1 from public.patient_qol_records where id=p_qol_id and status='signed' for share;
 if not found then raise exception 'Addenda require a signed chart' using errcode='23514'; end if;
 insert into public.patient_qol_addenda(id,qol_id,content,created_by) values(p_id,p_qol_id,p_content,actor) on conflict(id) do nothing;
 select * into result from public.patient_qol_addenda where id=p_id;
 if result.created_by<>actor or (result.qol_id,result.content) is distinct from (p_qol_id,p_content) then raise exception 'Addendum identifier already used' using errcode='23514'; end if; return result;
end $$;
create function public.record_lesion_observation(p_id uuid,p_lesion_id uuid,p_pet_id uuid,p_expected_version integer,p_observed_at timestamptz,p_label text,p_body_view text,p_x numeric,p_y numeric,p_length_mm numeric,p_width_mm numeric,p_depth_mm numeric,p_notes text,p_photo_document_id uuid) returns public.patient_lesion_observations language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); result public.patient_lesion_observations; lesion public.patient_lesions; fingerprint jsonb;
begin
 fingerprint:=jsonb_build_object('lesion_id',p_lesion_id,'pet_id',p_pet_id,'expected_version',p_expected_version,'observed_at',p_observed_at,'label',p_label,'body_view',p_body_view,'x',p_x,'y',p_y,'length_mm',p_length_mm,'width_mm',p_width_mm,'depth_mm',p_depth_mm,'notes',p_notes,'photo_document_id',p_photo_document_id);
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into result from public.patient_lesion_observations where id=p_id;
 if found then if result.created_by<>actor or result.request<>fingerprint then raise exception 'Observation identifier already used' using errcode='23514'; end if; return result; end if;
 if p_observed_at is null or not isfinite(p_observed_at) or p_observed_at>now()+interval '5 minutes' then raise exception 'Invalid observation time' using errcode='23514'; end if;
 if p_photo_document_id is not null and not exists(select 1 from public.patient_documents where id=p_photo_document_id and pet_id=p_pet_id and status='ready' and mime_type in ('image/png','image/jpeg')) then raise exception 'Photo must be a ready image belonging to this patient' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_lesion_id::text,1));
 select * into lesion from public.patient_lesions where id=p_lesion_id for update;
 if found then
  if lesion.pet_id<>p_pet_id then raise exception 'Lesion does not belong to patient' using errcode='23514'; end if;
  if lesion.version is distinct from p_expected_version then raise exception 'Body map changed; reload before saving' using errcode='40001'; end if;
  update public.patient_lesions set label=p_label,body_view=p_body_view,x=p_x,y=p_y where id=p_lesion_id;
 else
  if p_expected_version is not null then raise exception 'Lesion no longer exists' using errcode='40001'; end if;
  insert into public.patient_lesions(id,pet_id,label,body_view,x,y,created_by,updated_by) values(p_lesion_id,p_pet_id,p_label,p_body_view,p_x,p_y,actor,actor);
 end if;
 insert into public.patient_lesion_observations(id,lesion_id,observed_at,label,body_view,x,y,length_mm,width_mm,depth_mm,notes,photo_document_id,request,created_by) values(p_id,p_lesion_id,p_observed_at,p_label,p_body_view,p_x,p_y,p_length_mm,p_width_mm,p_depth_mm,p_notes,p_photo_document_id,fingerprint,actor) returning * into result;
 return result;
end $$;
create function public.correct_lesion_observation(p_id uuid,p_observation_id uuid,p_reason text) returns public.patient_lesion_corrections language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); result public.patient_lesion_corrections;
begin
 insert into public.patient_lesion_corrections(id,observation_id,reason,created_by) values(p_id,p_observation_id,p_reason,actor) on conflict(id) do nothing;
 select * into result from public.patient_lesion_corrections where id=p_id;
 if result.created_by<>actor or (result.observation_id,result.reason) is distinct from (p_observation_id,p_reason) then raise exception 'Correction identifier already used' using errcode='23514'; end if; return result;
end $$;
revoke all on function public.care_chart_guard() from public,anon,authenticated,service_role;
do $$ declare f record; begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('save_patient_qol','sign_patient_qol','add_patient_qol_addendum','record_lesion_observation','correct_lesion_observation') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
