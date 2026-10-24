-- Native, staff-reviewed lab tracking. No vendor transport or interpreted results.
create table public.lab_due_templates (
 id uuid primary key, name text not null check(length(trim(name)) between 1 and 160),
 interval_days integer not null check(interval_days between 1 and 36500),
 active boolean not null default true, review_note text not null check(length(trim(review_note)) between 1 and 2000),
 version integer not null default 1, updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now()
);
create table public.patient_lab_orders (
 id uuid primary key, pet_id uuid not null references public.pets(id),
 test_name text not null check(length(trim(test_name)) between 1 and 160),
 status text not null check(status in ('planned','ordered','collected','resulted','cancelled')),
 due_date date, collected_date date, result_date date,
 accession text not null default '' check(length(accession)<=200),
 notes text not null default '' check(length(notes)<=20000),
 result_document_id uuid references public.patient_documents(id),
 template_id uuid references public.lab_due_templates(id), template_version integer,
 interval_days integer check(interval_days between 1 and 36500), interval_anchor date,
 override_reason text not null default '' check(length(override_reason)<=2000),
 version integer not null default 1, created_by uuid not null references public.profiles(id),
 updated_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(due_date is null or isfinite(due_date)), check(collected_date is null or isfinite(collected_date)), check(result_date is null or isfinite(result_date)),
 check(result_date is null or collected_date is null or result_date>=collected_date)
);
create table public.lab_work_revisions (
 id bigint generated always as identity primary key, entity text not null check(entity in ('template','order')),
 entity_id uuid not null, version integer not null, snapshot jsonb not null,
 reason text not null, actor_id uuid not null references public.profiles(id), recorded_at timestamptz not null default now(), unique(entity,entity_id,version)
);
create index lab_orders_patient on public.patient_lab_orders(pet_id,due_date,id);
create function public.save_lab_due_template(p_id uuid,p_expected_version integer,p_name text,p_interval_days integer,p_active boolean,p_review_note text)
returns public.lab_due_templates language plpgsql security definer set search_path=public as $$
declare actor uuid;r public.lab_due_templates;
begin
 actor=public.clinical_require_staff();
 if not exists(select 1 from public.user_roles where user_id=actor and role='ADMIN') then raise exception 'Active administrator required to review standard settings' using errcode='42501';end if;
 if p_id is null then raise exception 'Stable request ID required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,10));
 select * into r from public.lab_due_templates where id=p_id for update;
 if found then
  if r.updated_by=actor and r.name=trim(p_name) and r.interval_days=p_interval_days and r.active=p_active and r.review_note=trim(p_review_note) and r.version=coalesce(p_expected_version,0)+1 then return r;end if;
  if r.version is distinct from p_expected_version then raise exception 'Template version conflict; reload' using errcode='40001';end if;
  update public.lab_due_templates set name=trim(p_name),interval_days=p_interval_days,active=p_active,review_note=trim(p_review_note),version=version+1,updated_by=actor,updated_at=now() where id=p_id returning * into r;
 else
  if p_expected_version is not null then raise exception 'Template version conflict' using errcode='40001';end if;
  insert into public.lab_due_templates(id,name,interval_days,active,review_note,updated_by) values(p_id,trim(p_name),p_interval_days,p_active,trim(p_review_note),actor) returning * into r;
 end if;
 insert into public.lab_work_revisions(entity,entity_id,version,snapshot,reason,actor_id) values('template',r.id,r.version,to_jsonb(r),r.review_note,actor);
 return r;
end $$;
create function public.save_patient_lab_order(p_id uuid,p_pet_id uuid,p_expected_version integer,p_values jsonb,p_correction_reason text)
returns public.patient_lab_orders language plpgsql security definer set search_path=public as $$
declare actor uuid;r public.patient_lab_orders;n public.patient_lab_orders;t public.lab_due_templates;existed boolean;
begin
 actor=public.clinical_require_staff();
 if p_id is null or p_values is null or jsonb_typeof(p_values)<>'object' or exists(select 1 from jsonb_object_keys(p_values) k where k not in ('test_name','status','due_date','collected_date','result_date','accession','notes','result_document_id','template_id','template_version','interval_days','interval_anchor','override_reason')) then raise exception 'Invalid lab order fields' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,11));
 select * into r from public.patient_lab_orders where id=p_id for update;existed=found;
 if existed and r.pet_id<>p_pet_id then raise exception 'Order belongs to another patient' using errcode='42501';end if;
 n=jsonb_populate_record(null::public.patient_lab_orders,p_values);
 n.test_name=trim(n.test_name);n.notes=coalesce(n.notes,'');n.accession=coalesce(n.accession,'');n.override_reason=coalesce(n.override_reason,'');
 -- Exact retry after an uncertain response returns its prior version without creating history twice.
 if existed and r.updated_by=actor and r.version=coalesce(p_expected_version,0)+1 and exists(select 1 from public.lab_work_revisions where entity='order' and entity_id=r.id and version=r.version and reason=coalesce(trim(p_correction_reason),'')) and
  (to_jsonb(r)-array['id','pet_id','version','created_by','updated_by','created_at','updated_at'])=(to_jsonb(n)-array['id','pet_id','version','created_by','updated_by','created_at','updated_at']) then return r;end if;
 if existed and r.version is distinct from p_expected_version or not existed and p_expected_version is not null then raise exception 'Lab order version conflict; reload before saving' using errcode='40001';end if;
 if not exists(select 1 from public.pets where id=p_pet_id) then raise exception 'Patient not found' using errcode='23514';end if;
 if not existed and not exists(select 1 from public.pets where id=p_pet_id and archived_at is null and deceased_at is null) then raise exception 'New orders require an active patient' using errcode='23514';end if;
 if existed and (r.status in ('resulted','cancelled') or r.result_date is not null or r.result_document_id is not null) and nullif(trim(p_correction_reason),'') is null then raise exception 'Historical result changes require a correction reason' using errcode='23514';end if;
 if length(coalesce(p_correction_reason,''))>2000 then raise exception 'Correction reason too long' using errcode='23514';end if;
 if n.status in ('collected','resulted') and n.collected_date is null or n.status='resulted' and n.result_date is null then raise exception 'Record collection and result dates for this status' using errcode='23514';end if;
 if n.collected_date>(now() at time zone 'America/Denver')::date or n.result_date>(now() at time zone 'America/Denver')::date then raise exception 'Collection and result dates cannot be in the future' using errcode='23514';end if;
 if n.result_document_id is not null then
  perform 1 from public.patient_documents where id=n.result_document_id and pet_id=p_pet_id and status='ready' for share;
  if not found then raise exception 'Choose a ready document belonging to this patient' using errcode='42501';end if;
 end if;
 if n.template_id is not null then
  select * into t from public.lab_due_templates where id=n.template_id for share;
  -- Existing provenance remains valid when a reusable template is later revised/retired.
  if not (existed and row(r.template_id,r.template_version,r.interval_days,r.interval_anchor,r.due_date,r.override_reason) is not distinct from row(n.template_id,n.template_version,n.interval_days,n.interval_anchor,n.due_date,n.override_reason)) then
   if t.id is null or not t.active or t.version is distinct from n.template_version then raise exception 'Template changed or retired; review current settings' using errcode='40001';end if;
   if n.interval_days is distinct from t.interval_days and nullif(trim(n.override_reason),'') is null then raise exception 'Patient interval override requires a reason' using errcode='23514';end if;
  end if;
 elsif n.template_version is not null then raise exception 'Template version requires a template' using errcode='23514';end if;
 if n.interval_days is not null then
  if n.interval_anchor is null or not isfinite(n.interval_anchor) or n.due_date is distinct from n.interval_anchor+n.interval_days then raise exception 'Review interval anchor and due date' using errcode='23514';end if;
 elsif n.interval_anchor is not null or n.template_id is not null then raise exception 'Interval required' using errcode='23514';end if;
 if existed then
  update public.patient_lab_orders set test_name=n.test_name,status=n.status,due_date=n.due_date,collected_date=n.collected_date,result_date=n.result_date,accession=n.accession,notes=n.notes,result_document_id=n.result_document_id,template_id=n.template_id,template_version=n.template_version,interval_days=n.interval_days,interval_anchor=n.interval_anchor,override_reason=n.override_reason,version=version+1,updated_by=actor,updated_at=now() where id=p_id returning * into r;
 else
  insert into public.patient_lab_orders(id,pet_id,test_name,status,due_date,collected_date,result_date,accession,notes,result_document_id,template_id,template_version,interval_days,interval_anchor,override_reason,created_by,updated_by) values(p_id,p_pet_id,n.test_name,n.status,n.due_date,n.collected_date,n.result_date,n.accession,n.notes,n.result_document_id,n.template_id,n.template_version,n.interval_days,n.interval_anchor,n.override_reason,actor,actor) returning * into r;
 end if;
 insert into public.lab_work_revisions(entity,entity_id,version,snapshot,reason,actor_id) values('order',r.id,r.version,to_jsonb(r),coalesce(trim(p_correction_reason),''),actor);return r;
end $$;
do $$ declare t text;begin foreach t in array array['lab_due_templates','patient_lab_orders','lab_work_revisions'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on table public.%I to authenticated',t);
 execute format('create policy "Active staff read lab tracking" on public.%I for select to authenticated using(public.is_active_staff(auth.uid()))',t);
end loop;end $$;
revoke all on function public.save_lab_due_template(uuid,integer,text,integer,boolean,text),public.save_patient_lab_order(uuid,uuid,integer,jsonb,text) from public,anon,service_role;
grant execute on function public.save_lab_due_template(uuid,integer,text,integer,boolean,text),public.save_patient_lab_order(uuid,uuid,integer,jsonb,text) to authenticated;
