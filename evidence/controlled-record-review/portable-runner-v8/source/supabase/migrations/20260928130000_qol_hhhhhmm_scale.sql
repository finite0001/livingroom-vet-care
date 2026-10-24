-- HHHHHMM quality-of-life scale (Villalobos) as a signed, versioned patient assessment alongside the free-text QOL template.
-- Seven categories scored 0-10 (total 0-70). Records scores only; no interpretation is derived. Optional practice-configured
-- reference wording stays disabled by default and is always presented as pending Dr. Edler's clinical review.
create table public.patient_qol_scale_assessments (
 id uuid primary key, pet_id uuid not null references public.pets(id) on delete restrict,
 scale_version text not null default 'hhhhhmm-villalobos' check(scale_version='hhhhhmm-villalobos'),
 assessed_at timestamptz not null check(isfinite(assessed_at)), assessor text not null check(length(trim(assessor)) between 1 and 200),
 hurt smallint check(hurt between 0 and 10), hunger smallint check(hunger between 0 and 10), hydration smallint check(hydration between 0 and 10),
 hygiene smallint check(hygiene between 0 and 10), happiness smallint check(happiness between 0 and 10), mobility smallint check(mobility between 0 and 10),
 more_good_days smallint check(more_good_days between 0 and 10),
 hurt_note text not null default '' check(length(hurt_note)<=2000), hunger_note text not null default '' check(length(hunger_note)<=2000),
 hydration_note text not null default '' check(length(hydration_note)<=2000), hygiene_note text not null default '' check(length(hygiene_note)<=2000),
 happiness_note text not null default '' check(length(happiness_note)<=2000), mobility_note text not null default '' check(length(mobility_note)<=2000),
 more_good_days_note text not null default '' check(length(more_good_days_note)<=2000), notes text not null default '' check(length(notes)<=20000),
 total smallint generated always as (hurt+hunger+hydration+hygiene+happiness+mobility+more_good_days) stored,
 status text not null default 'draft' check(status in ('draft','signed')),
 version integer not null default 1, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now(), signed_by uuid references auth.users(id), signed_at timestamptz,
 check((status='draft' and signed_by is null and signed_at is null) or (status='signed' and signed_by is not null and signed_at is not null)),
 constraint qol_scale_signed_requires_all_categories check(status='draft' or num_nulls(hurt,hunger,hydration,hygiene,happiness,mobility,more_good_days)=0)
);
create index patient_qol_scale_pet_idx on public.patient_qol_scale_assessments(pet_id,assessed_at desc);
create table public.patient_qol_scale_addenda (
 id uuid primary key, assessment_id uuid not null references public.patient_qol_scale_assessments(id) on delete restrict,
 content text not null check(length(trim(content)) between 1 and 20000), created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index patient_qol_scale_addenda_idx on public.patient_qol_scale_addenda(assessment_id,created_at);
-- Singleton practice setting. Disabled with no threshold until an administrator enters wording Dr. Edler has reviewed.
create table public.qol_scale_reference_settings (
 id uuid primary key default '00000000-0000-4000-8000-000000000070'::uuid check(id='00000000-0000-4000-8000-000000000070'::uuid), enabled boolean not null default false,
 reference_total smallint check(reference_total between 0 and 70), reference_label text not null default '' check(length(reference_label)<=300),
 review_note text not null default '' check(length(review_note)<=2000),
 version integer not null default 1, updated_by uuid references auth.users(id), updated_at timestamptz not null default now(),
 check(not enabled or (reference_total is not null and length(trim(reference_label))>0 and length(trim(review_note))>0))
);
insert into public.qol_scale_reference_settings(id) values('00000000-0000-4000-8000-000000000070');
create function public.qol_scale_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();
begin
 if TG_OP='DELETE' then raise exception 'Quality-of-life scale history cannot be deleted' using errcode='23514'; end if;
 if TG_TABLE_NAME='patient_qol_scale_addenda' then
  if TG_OP='UPDATE' then raise exception 'Addenda are append-only' using errcode='23514'; end if;
  NEW.created_by:=actor; NEW.created_at:=now(); return NEW;
 end if;
 if TG_OP='UPDATE' then
  if OLD.status='signed' then raise exception 'Signed quality-of-life assessments are immutable; add an addendum' using errcode='23514'; end if;
  NEW.id:=OLD.id; NEW.created_by:=OLD.created_by; NEW.created_at:=OLD.created_at; NEW.pet_id:=OLD.pet_id; NEW.scale_version:=OLD.scale_version; NEW.version:=OLD.version+1;
 else NEW.created_by:=actor; NEW.created_at:=now(); NEW.version:=1; end if;
 NEW.updated_by:=actor; NEW.updated_at:=now();
 if NEW.status='signed' then
  if num_nulls(NEW.hurt,NEW.hunger,NEW.hydration,NEW.hygiene,NEW.happiness,NEW.mobility,NEW.more_good_days)>0 then raise exception 'Score all seven categories before signing' using errcode='23514'; end if;
  NEW.signed_by:=actor; NEW.signed_at:=now();
 else NEW.signed_by:=null; NEW.signed_at:=null; end if;
 return NEW;
end $$;
create function public.qol_scale_settings_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if TG_OP<>'UPDATE' then raise exception 'Quality-of-life reference setting is a single reviewed row' using errcode='23514'; end if;
 NEW.id:=OLD.id; NEW.version:=OLD.version+1; NEW.updated_by:=public.care_require_admin(); NEW.updated_at:=now(); return NEW;
end $$;
do $$ declare t text; begin
 foreach t in array array['patient_qol_scale_assessments','patient_qol_scale_addenda','qol_scale_reference_settings'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated,service_role',t);
  execute format('create policy "Active staff read" on public.%I for select to authenticated using(public.is_active_staff(auth.uid()))',t);
  execute format('create trigger care_chart_audit after insert or update on public.%I for each row execute function public.audit_trigger_fn()',t);
 end loop;
end $$;
create trigger qol_scale_guard before insert or update or delete on public.patient_qol_scale_assessments for each row execute function public.qol_scale_guard();
create trigger qol_scale_guard before insert or update or delete on public.patient_qol_scale_addenda for each row execute function public.qol_scale_guard();
create trigger qol_scale_settings_guard before insert or update or delete on public.qol_scale_reference_settings for each row execute function public.qol_scale_settings_guard();
create function public.save_patient_qol_scale(p_id uuid,p_pet_id uuid,p_expected_version integer,p_assessed_at timestamptz,p_assessor text,p_hurt integer,p_hunger integer,p_hydration integer,p_hygiene integer,p_happiness integer,p_mobility integer,p_more_good_days integer,p_hurt_note text,p_hunger_note text,p_hydration_note text,p_hygiene_note text,p_happiness_note text,p_mobility_note text,p_more_good_days_note text,p_notes text) returns public.patient_qol_scale_assessments language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); result public.patient_qol_scale_assessments;
begin
 if p_id is null or p_pet_id is null then raise exception 'Stable assessment and patient IDs required' using errcode='23514'; end if;
 if p_assessed_at is null or not isfinite(p_assessed_at) or p_assessed_at>now()+interval '5 minutes' then raise exception 'Invalid assessment time' using errcode='23514'; end if;
 if exists(select 1 from unnest(array[p_hurt,p_hunger,p_hydration,p_hygiene,p_happiness,p_mobility,p_more_good_days]) s where s not between 0 and 10) then raise exception 'Each category score must be a whole number from 0 to 10' using errcode='23514'; end if;
 if num_nulls(p_hurt_note,p_hunger_note,p_hydration_note,p_hygiene_note,p_happiness_note,p_mobility_note,p_more_good_days_note,p_notes)>0 then raise exception 'Notes must be text (use an empty string when blank)' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into result from public.patient_qol_scale_assessments where id=p_id for update;
 if found then
  if result.pet_id<>p_pet_id then raise exception 'Patient does not match assessment' using errcode='23514'; end if;
  if (case when p_expected_version is null then result.created_by else result.updated_by end)=actor and result.version=coalesce(p_expected_version+1,1)
   and row(result.assessed_at,result.assessor,result.hurt,result.hunger,result.hydration,result.hygiene,result.happiness,result.mobility,result.more_good_days,result.hurt_note,result.hunger_note,result.hydration_note,result.hygiene_note,result.happiness_note,result.mobility_note,result.more_good_days_note,result.notes)
   is not distinct from row(p_assessed_at,p_assessor,p_hurt::smallint,p_hunger::smallint,p_hydration::smallint,p_hygiene::smallint,p_happiness::smallint,p_mobility::smallint,p_more_good_days::smallint,p_hurt_note,p_hunger_note,p_hydration_note,p_hygiene_note,p_happiness_note,p_mobility_note,p_more_good_days_note,p_notes) then return result; end if;
  if result.version is distinct from p_expected_version then raise exception 'Assessment changed; reload before saving' using errcode='40001'; end if;
  update public.patient_qol_scale_assessments set assessed_at=p_assessed_at,assessor=p_assessor,hurt=p_hurt,hunger=p_hunger,hydration=p_hydration,hygiene=p_hygiene,happiness=p_happiness,mobility=p_mobility,more_good_days=p_more_good_days,
   hurt_note=p_hurt_note,hunger_note=p_hunger_note,hydration_note=p_hydration_note,hygiene_note=p_hygiene_note,happiness_note=p_happiness_note,mobility_note=p_mobility_note,more_good_days_note=p_more_good_days_note,notes=p_notes where id=p_id returning * into result;
 else
  if p_expected_version is not null then raise exception 'Assessment no longer exists' using errcode='40001'; end if;
  insert into public.patient_qol_scale_assessments(id,pet_id,assessed_at,assessor,hurt,hunger,hydration,hygiene,happiness,mobility,more_good_days,hurt_note,hunger_note,hydration_note,hygiene_note,happiness_note,mobility_note,more_good_days_note,notes,created_by,updated_by)
   values(p_id,p_pet_id,p_assessed_at,p_assessor,p_hurt,p_hunger,p_hydration,p_hygiene,p_happiness,p_mobility,p_more_good_days,p_hurt_note,p_hunger_note,p_hydration_note,p_hygiene_note,p_happiness_note,p_mobility_note,p_more_good_days_note,p_notes,actor,actor) returning * into result;
 end if;
 return result;
end $$;
create function public.sign_patient_qol_scale(p_id uuid,p_expected_version integer) returns public.patient_qol_scale_assessments language plpgsql security definer set search_path=public as $$
declare result public.patient_qol_scale_assessments; actor uuid:=public.clinical_require_staff();
begin
 select * into result from public.patient_qol_scale_assessments where id=p_id for update;
 if found and result.status='signed' and result.signed_by=actor and result.version=p_expected_version+1 then return result; end if;
 update public.patient_qol_scale_assessments set status='signed' where id=p_id and version=p_expected_version returning * into result;
 if not found then raise exception 'Assessment changed; reload before signing' using errcode='40001'; end if; return result;
end $$;
create function public.add_patient_qol_scale_addendum(p_id uuid,p_assessment_id uuid,p_content text) returns public.patient_qol_scale_addenda language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); result public.patient_qol_scale_addenda;
begin
 perform 1 from public.patient_qol_scale_assessments where id=p_assessment_id and status='signed' for share;
 if not found then raise exception 'Addenda require a signed assessment' using errcode='23514'; end if;
 insert into public.patient_qol_scale_addenda(id,assessment_id,content,created_by) values(p_id,p_assessment_id,p_content,actor) on conflict(id) do nothing;
 select * into result from public.patient_qol_scale_addenda where id=p_id;
 if result.created_by<>actor or (result.assessment_id,result.content) is distinct from (p_assessment_id,p_content) then raise exception 'Addendum identifier already used' using errcode='23514'; end if; return result;
end $$;
create function public.save_qol_scale_reference(p_expected_version integer,p_enabled boolean,p_reference_total integer,p_reference_label text,p_review_note text) returns public.qol_scale_reference_settings language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.care_require_admin(); result public.qol_scale_reference_settings;
begin
 select * into result from public.qol_scale_reference_settings where id='00000000-0000-4000-8000-000000000070' for update;
 if result.updated_by=actor and result.version=p_expected_version+1 and row(result.enabled,result.reference_total,result.reference_label,result.review_note) is not distinct from row(p_enabled,p_reference_total::smallint,trim(coalesce(p_reference_label,'')),trim(coalesce(p_review_note,''))) then return result; end if;
 if result.version is distinct from p_expected_version then raise exception 'Reference setting changed; reload before saving' using errcode='40001'; end if;
 if p_enabled is null then raise exception 'Choose whether the reference is shown' using errcode='23514'; end if;
 if p_reference_total is not null and p_reference_total not between 0 and 70 then raise exception 'Reference total must be between 0 and 70' using errcode='23514'; end if;
 if p_enabled and (p_reference_total is null or length(trim(coalesce(p_reference_label,'')))=0 or length(trim(coalesce(p_review_note,'')))=0) then raise exception 'An enabled reference needs a total, wording and review note' using errcode='23514'; end if;
 update public.qol_scale_reference_settings set enabled=p_enabled,reference_total=p_reference_total,reference_label=trim(coalesce(p_reference_label,'')),review_note=trim(coalesce(p_review_note,'')) where id='00000000-0000-4000-8000-000000000070' returning * into result;
 return result;
end $$;
revoke all on function public.qol_scale_guard() from public,anon,authenticated,service_role;
revoke all on function public.qol_scale_settings_guard() from public,anon,authenticated,service_role;
do $$ declare f record; begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('save_patient_qol_scale','sign_patient_qol_scale','add_patient_qol_scale_addendum','save_qol_scale_reference') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
