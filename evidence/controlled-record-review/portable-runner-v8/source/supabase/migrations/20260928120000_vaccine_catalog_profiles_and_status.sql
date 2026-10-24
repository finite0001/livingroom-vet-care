-- Optional vaccine metadata for catalog products and a read-only per-patient vaccine status summary.
-- No clinical values are seeded: every profile field is optional and entered by a reviewer.
-- Profile values only pre-fill forms when a clinician explicitly asks; nothing here decides a due date.
create table public.catalog_vaccine_profiles (
 id uuid not null unique default gen_random_uuid(), product_id uuid primary key references public.catalog_products(id) on delete restrict,
 group_key text check(group_key is null or (group_key=lower(trim(group_key)) and group_key~'^[a-z0-9][a-z0-9_-]{0,79}$')),
 species text[] not null default '{}' check(cardinality(species)<=10 and array_position(species,null) is null),
 vaccine_type text check(vaccine_type is null or length(trim(vaccine_type)) between 1 and 200),
 labeled_duration text check(labeled_duration is null or labeled_duration in ('1 year','3 years','other licensed duration')),
 default_booster_interval_days integer check(default_booster_interval_days is null or default_booster_interval_days between 1 and 36500),
 review_note text not null check(length(trim(review_note)) between 1 and 2000),
 version integer not null default 1 check(version>0),
 updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now()
);
alter table public.catalog_vaccine_profiles enable row level security;
revoke all on public.catalog_vaccine_profiles from public,anon,authenticated,service_role;
grant select on public.catalog_vaccine_profiles to authenticated,service_role;
create policy "Active staff read vaccine profiles" on public.catalog_vaccine_profiles for select to authenticated using(public.is_active_staff(auth.uid()));
create trigger catalog_vaccine_profile_audit after insert or update or delete on public.catalog_vaccine_profiles for each row execute function public.audit_trigger_fn();
create function public.catalog_vaccine_profile_guard() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP='DELETE' then raise exception 'Vaccine profiles are retained; clear fields with a reviewed update' using errcode='23514'; end if;
 if TG_OP='UPDATE' and (NEW.product_id<>OLD.product_id or NEW.id<>OLD.id) then raise exception 'Vaccine profile product is immutable' using errcode='23514'; end if;
 if not exists(select 1 from public.catalog_products where id=NEW.product_id and kind='vaccine') then raise exception 'Vaccine metadata applies only to vaccine products' using errcode='23514'; end if;
 return NEW;
end $$;
create trigger catalog_vaccine_profile_guard before insert or update or delete on public.catalog_vaccine_profiles for each row execute function public.catalog_vaccine_profile_guard();
-- Catalog maintainers with clinical or administrative authority record the label facts and their source.
create function public.save_catalog_vaccine_profile(p_product_id uuid,p_expected_version integer,p_group_key text,p_species text[],p_vaccine_type text,p_labeled_duration text,p_default_booster_interval_days integer,p_review_note text) returns public.catalog_vaccine_profiles language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); r public.catalog_vaccine_profiles; g text; s text[]; vt text;
begin
 if not exists(select 1 from public.user_roles where user_id=actor and role in ('ADMIN','DVM')) then raise exception 'Veterinarian or administrator required for vaccine catalog metadata' using errcode='42501'; end if;
 if p_product_id is null then raise exception 'Vaccine product required' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_product_id::text,28120));
 perform 1 from public.catalog_products where id=p_product_id and kind='vaccine' for share;
 if not found then raise exception 'Vaccine metadata applies only to vaccine products' using errcode='23514'; end if;
 g:=nullif(lower(trim(coalesce(p_group_key,''))),'');
 if g is not null and g!~'^[a-z0-9][a-z0-9_-]{0,79}$' then raise exception 'Vaccine group key uses lowercase letters, digits, hyphen or underscore' using errcode='23514'; end if;
 if p_species is null or cardinality(p_species)>10 or exists(select 1 from unnest(p_species) x where x is null or length(trim(x)) not between 1 and 80) then raise exception 'List up to 10 species labels of 1-80 characters' using errcode='23514'; end if;
 select coalesce(array_agg(distinct lower(trim(x)) order by lower(trim(x))),'{}') into s from unnest(p_species) x;
 vt:=nullif(trim(coalesce(p_vaccine_type,'')),'');
 if vt is not null and length(vt)>200 then raise exception 'Vaccine type is too long' using errcode='23514'; end if;
 if p_labeled_duration is not null and p_labeled_duration not in ('1 year','3 years','other licensed duration') then raise exception 'Labeled duration must match the product label choices' using errcode='23514'; end if;
 if p_default_booster_interval_days is not null and p_default_booster_interval_days not between 1 and 36500 then raise exception 'Booster interval must be between 1 and 36500 days' using errcode='23514'; end if;
 if length(trim(coalesce(p_review_note,''))) not between 1 and 2000 then raise exception 'Record the label source or reviewer for this metadata' using errcode='23514'; end if;
 select * into r from public.catalog_vaccine_profiles where product_id=p_product_id for update;
 if found then
  -- A lost response retried by the same reviewer returns the saved row instead of conflicting.
  if r.updated_by=actor and r.version=coalesce(p_expected_version,0)+1 and row(r.group_key,r.species,r.vaccine_type,r.labeled_duration,r.default_booster_interval_days,r.review_note) is not distinct from row(g,s,vt,p_labeled_duration,p_default_booster_interval_days,trim(p_review_note)) then return r; end if;
  if r.version is distinct from p_expected_version then raise exception 'Vaccine profile changed; reload before saving' using errcode='40001'; end if;
  update public.catalog_vaccine_profiles set group_key=g,species=s,vaccine_type=vt,labeled_duration=p_labeled_duration,default_booster_interval_days=p_default_booster_interval_days,review_note=trim(p_review_note),version=version+1,updated_by=actor,updated_at=now() where product_id=p_product_id returning * into r;
 else
  if p_expected_version is not null then raise exception 'Vaccine profile changed; reload before saving' using errcode='40001'; end if;
  insert into public.catalog_vaccine_profiles(product_id,group_key,species,vaccine_type,labeled_duration,default_booster_interval_days,review_note,updated_by) values(p_product_id,g,s,vt,p_labeled_duration,p_default_booster_interval_days,trim(p_review_note),actor) returning * into r;
 end if;
 return r;
end $$;
-- Status precedence per vaccine group (documented in docs/vaccine-status-and-catalog.md):
--  1. a CURRENT reviewed patient due plan supplies the due date;
--  2. otherwise the latest uncorrected administration's recorded next due date
--     (practice administration, historical entry, or reviewed outside ezyVet record) is shown with its source;
--  3. otherwise no due date. Proposed plans never supply a date; they are flagged as awaiting review.
-- Combination products count toward every active reviewed template group that lists them.
-- The due-soon window is display policy and is applied by the client, not here.
create function public.patient_vaccine_status_summary(p_pet_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 perform public.clinical_require_staff();
 if p_pet_id is null or not exists(select 1 from public.pets where id=p_pet_id) then raise exception 'Patient not found' using errcode='23514'; end if;
 with native as (
  select t.id record_id,case when t.historical then 'historical_record' else 'practice_administration' end source,t.product_id,t.product_name,(t.administered_at at time zone 'America/Denver')::date administered_on,t.administered_at,t.next_due_on
  from public.patient_treatments t where t.pet_id=p_pet_id and t.kind='vaccine' and not exists(select 1 from public.patient_treatment_corrections c where c.treatment_id=t.id)
 ), outside as (
  -- Only the latest reviewed version of an outside record counts, and only when reviewed as administered on a known date.
  select v.id record_id,'outside_record' source,case when jsonb_typeof(v.product)='object' then (v.product->>'id')::uuid end product_id,
   coalesce(nullif(trim(case when jsonb_typeof(v.product)='object' then v.product->>'name' end),''),'Outside vaccination #'||v.vaccination_external_id) product_name,
   (v.reviewed->>'administered_on')::date administered_on,null::timestamptz administered_at,case when v.reviewed->>'next_date_status'='date' then (v.reviewed->>'source_next_due_on')::date end next_due_on
  from public.ezyvet_imported_vaccinations v where v.pet_id=p_pet_id and v.reviewed->>'status'='administered' and v.reviewed->>'administration_date_status'='date' and not exists(select 1 from public.ezyvet_imported_vaccinations n where n.replaces_id=v.id)
 ), recs as (select * from native union all select * from outside
 ), members as (
  select t.group_key,t.name group_name,0 group_rank,r.* from recs r join public.vaccine_due_templates t on t.active and r.product_id=any(t.product_ids)
  union all
  select p.group_key,p.group_key,1,r.* from recs r join public.catalog_vaccine_profiles p on p.product_id=r.product_id and p.group_key is not null
   where not exists(select 1 from public.vaccine_due_templates t where t.active and r.product_id=any(t.product_ids) and t.group_key=p.group_key)
  union all
  select case when r.product_id is not null then 'product:'||r.product_id::text else 'record:'||lower(trim(r.product_name)) end,r.product_name,2,r.* from recs r
   where not exists(select 1 from public.vaccine_due_templates t where t.active and r.product_id=any(t.product_ids))
   and not exists(select 1 from public.catalog_vaccine_profiles p where p.product_id=r.product_id and p.group_key is not null)
 ), plans as (select * from public.patient_vaccine_due_plans v where v.pet_id=p_pet_id and v.status<>'retired'
 ), keys as (select group_key from members union select group_key from plans
 ), latest as (
  select distinct on (m.group_key) m.* from members m
  order by m.group_key,m.administered_on desc,m.administered_at desc nulls last,case m.source when 'practice_administration' then 0 when 'historical_record' then 1 else 2 end,m.record_id
 ), labels as (
  select distinct on (m.group_key) m.group_key,m.group_name,case m.group_rank when 0 then 'due_template' when 1 then 'catalog_profile' else 'product' end group_source from members m order by m.group_key,m.group_rank,m.record_id
 ), counts as (select m.group_key,count(*)::integer n from members m group by m.group_key
 ), resolved as (
  select k.group_key,coalesce(nullif(p.template_snapshot->>'name',''),lb.group_name,k.group_key) group_name,coalesce(lb.group_source,'due_template') group_source,
   case when p.id is not null and (l.administered_on is null or p.last_administered_on>l.administered_on) then p.last_administered_on else l.administered_on end last_given_on,
   case when p.id is not null and (l.administered_on is null or p.last_administered_on>l.administered_on) then 'due_plan_anchor' else l.source end last_given_source,
   l.record_id last_record_id,l.product_name last_product_name,
   case when p.status='current' then p.current_due_on else l.next_due_on end due_on,
   case when p.status='current' then 'reviewed_due_plan' when l.next_due_on is not null then l.source end due_source,
   coalesce(c.n,0) record_count,
   case when p.id is null then null else jsonb_build_object('id',p.id,'version',p.version,'status',p.status,'current_due_on',p.current_due_on,'last_administered_on',p.last_administered_on) end plan,
   array_remove(array[case when p.status='proposed' then 'plan_awaiting_review' end,case when p.status='current' and l.administered_on>p.last_administered_on then 'administration_after_plan_anchor' end],null) flags
  from keys k left join plans p on p.group_key=k.group_key left join latest l on l.group_key=k.group_key left join labels lb on lb.group_key=k.group_key left join counts c on c.group_key=k.group_key
 )
 select jsonb_build_object('pet_id',p_pet_id,'as_of',(now() at time zone 'America/Denver')::date,'groups',coalesce(jsonb_agg(jsonb_build_object(
  'group_key',r.group_key,'group_name',r.group_name,'group_source',r.group_source,'last_given_on',r.last_given_on,'last_given_source',r.last_given_source,
  'last_record_id',r.last_record_id,'last_product_name',r.last_product_name,'due_on',r.due_on,'due_source',r.due_source,'record_count',r.record_count,
  'plan',r.plan,'flags',to_jsonb(r.flags)) order by lower(r.group_name),r.group_key),'[]'::jsonb)) into result from resolved r;
 return result;
end $$;
revoke all on function public.catalog_vaccine_profile_guard() from public,anon,authenticated,service_role;
revoke all on function public.save_catalog_vaccine_profile(uuid,integer,text,text[],text,text,integer,text),public.patient_vaccine_status_summary(uuid) from public,anon,authenticated,service_role;
grant execute on function public.save_catalog_vaccine_profile(uuid,integer,text,text[],text,text,integer,text),public.patient_vaccine_status_summary(uuid) to authenticated;
-- Practice-wide display window for "due soon". Not seeded: the client shows a documented display default
-- (pending clinical review) until an administrator saves a value. Administrators write via existing RLS.
alter table public.app_settings add constraint app_settings_vaccine_due_soon_days_check check(case when key<>'vaccine_due_soon_days' then true when value!~'^[1-9][0-9]{0,2}$' then false else value::integer<=365 end);
