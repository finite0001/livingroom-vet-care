-- Reviewed due plans and durable unsent care reminders. No clinical defaults or provider dispatch.
create table public.vaccine_due_templates (
 id uuid primary key, group_key text not null unique check(group_key=lower(trim(group_key)) and group_key~'^[a-z0-9][a-z0-9_-]{0,79}$'),
 name text not null check(length(trim(name)) between 1 and 160), product_ids uuid[] not null check(cardinality(product_ids) between 1 and 100),
 interval_days integer not null check(interval_days between 1 and 36500), active boolean not null default true,
 review_note text not null check(length(trim(review_note)) between 1 and 2000),version integer not null default 1,updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default now()
);
create table public.patient_vaccine_due_plans (
 id uuid primary key,pet_id uuid not null references public.pets(id),template_id uuid not null references public.vaccine_due_templates(id),template_version integer not null,template_snapshot jsonb not null,group_key text not null,
 product_id uuid not null references public.catalog_products(id),treatment_id uuid references public.patient_treatments(id),last_administered_on date not null check(isfinite(last_administered_on)),anchor_source text not null check(length(trim(anchor_source)) between 1 and 2000),
 interval_days integer not null check(interval_days between 1 and 36500),proposed_due_on date not null check(isfinite(proposed_due_on)),current_due_on date not null check(isfinite(current_due_on) and current_due_on>=last_administered_on),
 status text not null check(status in ('proposed','current','retired')),reminders_enabled boolean not null default false,override_reason text not null default '' check(length(override_reason)<=2000),review_note text not null check(length(trim(review_note)) between 1 and 2000),
 version integer not null default 1,created_by uuid not null references public.profiles(id),updated_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index vaccine_plan_one_group on public.patient_vaccine_due_plans(pet_id,group_key) where status<>'retired';
create index vaccine_plan_due on public.patient_vaccine_due_plans(current_due_on) where status='current';
create table public.care_message_templates (
 id uuid primary key,name text not null check(length(trim(name)) between 1 and 160),channel text not null check(channel in ('email','sms')),
 days_before integer not null check(days_before between 0 and 3650),body text not null check(length(trim(body)) between 1 and 4000),active boolean not null default true,
 review_note text not null check(length(trim(review_note)) between 1 and 2000),version integer not null default 1,updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default now()
);
create table public.care_plan_revisions (
 id bigint generated always as identity primary key,entity text not null check(entity in ('vaccine_template','vaccine_plan','message_template')),entity_id uuid not null,version integer not null,snapshot jsonb not null,actor_id uuid not null references public.profiles(id),recorded_at timestamptz not null default now(),unique(entity,entity_id,version)
);
create table public.care_reminder_jobs (
 id uuid primary key,source_kind text not null check(source_kind in ('vaccine','lab')),source_id uuid not null,source_version integer not null,
 pet_id uuid not null references public.pets(id),client_id uuid not null references public.clients(id),message_template_id uuid not null references public.care_message_templates(id),message_template_version integer not null,
 channel text not null check(channel in ('email','sms')),scheduled_on date not null check(isfinite(scheduled_on)),due_on date not null check(isfinite(due_on)),
 rendered_body text not null,source_snapshot jsonb not null,template_snapshot jsonb not null,
 status text not null default 'pending' check(status in ('pending','invalidated')),invalidation_reason text,created_at timestamptz not null default now(),invalidated_at timestamptz,
 unique(source_kind,source_id,source_version,message_template_id,message_template_version),
 check((status='pending' and invalidated_at is null and invalidation_reason is null)or(status='invalidated' and invalidated_at is not null and nullif(trim(invalidation_reason),'') is not null))
);
create index care_jobs_pending on public.care_reminder_jobs(scheduled_on,id) where status='pending';
create function public.care_record_revision() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.care_plan_revisions(entity,entity_id,version,snapshot,actor_id) values(tg_argv[0],new.id,new.version,to_jsonb(new),new.updated_by);return new;end $$;
create trigger care_vaccine_template_history after insert or update on public.vaccine_due_templates for each row execute function public.care_record_revision('vaccine_template');
create trigger care_vaccine_plan_history after insert or update on public.patient_vaccine_due_plans for each row execute function public.care_record_revision('vaccine_plan');
create trigger care_message_template_history after insert or update on public.care_message_templates for each row execute function public.care_record_revision('message_template');
create function public.care_require_admin() returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid=public.clinical_require_staff();begin if not exists(select 1 from public.user_roles where user_id=actor and role='ADMIN') then raise exception 'Active administrator required for reviewed settings' using errcode='42501';end if;return actor;end $$;
create function public.save_vaccine_due_template(p_id uuid,p_expected_version integer,p_group_key text,p_name text,p_product_ids uuid[],p_interval_days integer,p_active boolean,p_review_note text) returns public.vaccine_due_templates language plpgsql security definer set search_path=public as $$
declare actor uuid;r public.vaccine_due_templates;
begin actor=public.care_require_admin();if p_id is null then raise exception 'Stable ID required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,14));select * into r from public.vaccine_due_templates where id=p_id for update;
 if found then
  if r.updated_by=actor and r.version=coalesce(p_expected_version,0)+1 and row(r.group_key,r.name,r.product_ids,r.interval_days,r.active,r.review_note) is not distinct from row(lower(trim(p_group_key)),trim(p_name),p_product_ids,p_interval_days,p_active,trim(p_review_note)) then return r;end if;
  if r.version is distinct from p_expected_version then raise exception 'Vaccine template version conflict' using errcode='40001';end if;
  if r.group_key<>lower(trim(p_group_key)) then raise exception 'Canonical group key is immutable' using errcode='23514';end if;
 elsif p_expected_version is not null then raise exception 'Vaccine template version conflict' using errcode='40001';end if;
 if p_product_ids is null or exists(select 1 from unnest(p_product_ids) id where not exists(select 1 from public.catalog_products p where p.id=id and p.kind='vaccine')) or cardinality(p_product_ids)<>(select count(distinct id) from unnest(p_product_ids) id) then raise exception 'Choose distinct explicit vaccine products' using errcode='23514';end if;
 if r.id is null then insert into public.vaccine_due_templates(id,group_key,name,product_ids,interval_days,active,review_note,updated_by) values(p_id,lower(trim(p_group_key)),trim(p_name),p_product_ids,p_interval_days,p_active,trim(p_review_note),actor) returning * into r;
 else update public.vaccine_due_templates set name=trim(p_name),product_ids=p_product_ids,interval_days=p_interval_days,active=p_active,review_note=trim(p_review_note),version=version+1,updated_by=actor,updated_at=now() where id=p_id returning * into r;end if;return r;
end $$;
create function public.save_patient_vaccine_due_plan(p_id uuid,p_pet_id uuid,p_expected_version integer,p_template_id uuid,p_template_version integer,p_product_id uuid,p_treatment_id uuid,p_last_administered_on date,p_anchor_source text,p_interval_days integer,p_current_due_on date,p_status text,p_reminders_enabled boolean,p_override_reason text,p_review_note text) returns public.patient_vaccine_due_plans language plpgsql security definer set search_path=public as $$
declare actor uuid;r public.patient_vaccine_due_plans;t public.vaccine_due_templates;admin_date date;proposed date;reviewed_snapshot jsonb;
begin actor=public.clinical_require_staff();if p_id is null then raise exception 'Stable ID required' using errcode='23514';end if;
 -- Patient lock serializes canonical-plan creation, archival, and service enqueue.
 perform 1 from public.pets where id=p_pet_id and archived_at is null and deceased_at is null for update;if not found then raise exception 'Due plans require an active patient' using errcode='23514';end if;
 select * into r from public.patient_vaccine_due_plans where id=p_id for update;
 if r.id is not null and r.pet_id<>p_pet_id then raise exception 'Due plan belongs to another patient' using errcode='42501';end if;
 if r.id is not null and r.updated_by=actor and r.version=coalesce(p_expected_version,0)+1 and row(r.template_id,r.template_version,r.product_id,r.treatment_id,r.last_administered_on,r.anchor_source,r.interval_days,r.current_due_on,r.status,r.reminders_enabled,r.override_reason,r.review_note) is not distinct from row(p_template_id,p_template_version,p_product_id,p_treatment_id,p_last_administered_on,trim(p_anchor_source),p_interval_days,p_current_due_on,p_status,p_reminders_enabled,coalesce(trim(p_override_reason),''),trim(p_review_note)) then return r;end if;
 if r.id is not null and r.version is distinct from p_expected_version or r.id is null and p_expected_version is not null then raise exception 'Due plan version conflict' using errcode='40001';end if;
 if r.status='retired' then raise exception 'Retired plan is immutable; create a new reviewed plan' using errcode='23514';end if;
 select * into t from public.vaccine_due_templates where id=p_template_id for share;
 -- Existing reviewed snapshots survive later template changes. Reapplying settings needs the latest active version.
 if r.id is not null and row(r.template_id,r.template_version) is not distinct from row(p_template_id,p_template_version) then reviewed_snapshot=r.template_snapshot;
 else if t.id is null or not t.active or t.version is distinct from p_template_version then raise exception 'Template changed or retired; review current settings' using errcode='40001';end if;reviewed_snapshot=to_jsonb(t);end if;
 if r.id is not null and r.group_key<>t.group_key then raise exception 'Plan cannot change canonical vaccine group' using errcode='23514';end if;
 if not exists(select 1 from jsonb_array_elements_text(reviewed_snapshot->'product_ids') item where item::uuid=p_product_id) then raise exception 'Product is not explicitly mapped to this reviewed group' using errcode='23514';end if;
 if p_treatment_id is not null then
  select (administered_at at time zone 'America/Denver')::date into admin_date from public.patient_treatments where id=p_treatment_id and pet_id=p_pet_id and kind='vaccine' and product_id=p_product_id for share;
  if not found or exists(select 1 from public.patient_treatment_corrections where treatment_id=p_treatment_id) then raise exception 'Select an uncorrected vaccine administration for this patient and product' using errcode='42501';end if;
  if admin_date is distinct from p_last_administered_on then raise exception 'Last-administered date must match the selected administration in Denver' using errcode='23514';end if;
 end if;
 if p_last_administered_on is null or not isfinite(p_last_administered_on) or p_last_administered_on>(now() at time zone 'America/Denver')::date or p_current_due_on is null or not isfinite(p_current_due_on) then raise exception 'Record finite dates and a nonfuture administration date' using errcode='23514';end if;
 proposed=p_last_administered_on+(reviewed_snapshot->>'interval_days')::integer;
 if (p_interval_days is distinct from (reviewed_snapshot->>'interval_days')::integer or p_current_due_on is distinct from p_last_administered_on+p_interval_days) and nullif(trim(p_override_reason),'') is null then raise exception 'Patient due/interval override requires a reason' using errcode='23514';end if;
 if r.id is null then insert into public.patient_vaccine_due_plans(id,pet_id,template_id,template_version,template_snapshot,group_key,product_id,treatment_id,last_administered_on,anchor_source,interval_days,proposed_due_on,current_due_on,status,reminders_enabled,override_reason,review_note,created_by,updated_by) values(p_id,p_pet_id,p_template_id,p_template_version,reviewed_snapshot,t.group_key,p_product_id,p_treatment_id,p_last_administered_on,trim(p_anchor_source),p_interval_days,proposed,p_current_due_on,p_status,p_reminders_enabled,coalesce(trim(p_override_reason),''),trim(p_review_note),actor,actor) returning * into r;
 else update public.patient_vaccine_due_plans set template_id=p_template_id,template_version=p_template_version,template_snapshot=reviewed_snapshot,product_id=p_product_id,treatment_id=p_treatment_id,last_administered_on=p_last_administered_on,anchor_source=trim(p_anchor_source),interval_days=p_interval_days,proposed_due_on=proposed,current_due_on=p_current_due_on,status=p_status,reminders_enabled=p_reminders_enabled,override_reason=coalesce(trim(p_override_reason),''),review_note=trim(p_review_note),version=version+1,updated_by=actor,updated_at=now() where id=p_id returning * into r;end if;return r;
end $$;
create function public.save_care_message_template(p_id uuid,p_expected_version integer,p_name text,p_channel text,p_days_before integer,p_body text,p_active boolean,p_review_note text) returns public.care_message_templates language plpgsql security definer set search_path=public as $$
declare actor uuid;r public.care_message_templates;remainder text;
begin actor=public.care_require_admin();if p_id is null then raise exception 'Stable ID required' using errcode='23514';end if;
 remainder=replace(replace(replace(p_body,'{{patient_name}}',''),'{{care_name}}',''),'{{due_date}}','');if remainder~'[{}]' then raise exception 'Only patient_name, care_name and due_date placeholders are supported' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,15));select * into r from public.care_message_templates where id=p_id for update;
 if found then
  if r.updated_by=actor and r.version=coalesce(p_expected_version,0)+1 and row(r.name,r.channel,r.days_before,r.body,r.active,r.review_note) is not distinct from row(trim(p_name),p_channel,p_days_before,p_body,p_active,trim(p_review_note)) then return r;end if;
  if r.version is distinct from p_expected_version then raise exception 'Message template version conflict' using errcode='40001';end if;
 elsif p_expected_version is not null then raise exception 'Message template version conflict' using errcode='40001';end if;
 if r.id is null then insert into public.care_message_templates(id,name,channel,days_before,body,active,review_note,updated_by) values(p_id,trim(p_name),p_channel,p_days_before,p_body,p_active,trim(p_review_note),actor) returning * into r;
 else update public.care_message_templates set name=trim(p_name),channel=p_channel,days_before=p_days_before,body=p_body,active=p_active,review_note=trim(p_review_note),version=version+1,updated_by=actor,updated_at=now() where id=p_id returning * into r;end if;return r;
end $$;
create function public.care_invalidate_jobs() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_table_name='patient_vaccine_due_plans' then update public.care_reminder_jobs set status='invalidated',invalidated_at=now(),invalidation_reason='Vaccine plan revised or retired' where source_kind='vaccine' and source_id=new.id and status='pending';
 elsif tg_table_name='patient_lab_orders' then update public.care_reminder_jobs set status='invalidated',invalidated_at=now(),invalidation_reason='Lab order revised or cancelled' where source_kind='lab' and source_id=new.id and status='pending';
 elsif tg_table_name='care_message_templates' then update public.care_reminder_jobs set status='invalidated',invalidated_at=now(),invalidation_reason='Approved message template revised or retired' where message_template_id=new.id and status='pending';
 elsif tg_table_name='pets' and row(new.archived_at,new.deceased_at,new.client_id,new.name) is distinct from row(old.archived_at,old.deceased_at,old.client_id,old.name) then update public.care_reminder_jobs set status='invalidated',invalidated_at=now(),invalidation_reason='Patient status, household or name changed' where pet_id=new.id and status='pending';
 end if;return new;
end $$;
create trigger care_plan_jobs_invalidated after update on public.patient_vaccine_due_plans for each row execute function public.care_invalidate_jobs();
create trigger care_lab_jobs_invalidated after update on public.patient_lab_orders for each row execute function public.care_invalidate_jobs();
create trigger care_template_jobs_invalidated after update on public.care_message_templates for each row execute function public.care_invalidate_jobs();
create trigger care_patient_jobs_invalidated after update on public.pets for each row execute function public.care_invalidate_jobs();
create function public.care_corrected_anchor() returns trigger language plpgsql security definer set search_path=public as $$
begin update public.patient_vaccine_due_plans set status='proposed',reminders_enabled=false,review_note='Administration corrected; staff must review anchor and due date',version=version+1,updated_by=new.created_by,updated_at=now() where treatment_id=new.treatment_id and status<>'retired';return new;end $$;
create trigger care_treatment_anchor_corrected after insert on public.patient_treatment_corrections for each row execute function public.care_corrected_anchor();
create function public.enqueue_care_reminder(p_id uuid,p_source_kind text,p_source_id uuid,p_expected_source_version integer,p_message_template_id uuid,p_expected_template_version integer) returns public.care_reminder_jobs language plpgsql security definer set search_path=public as $$
declare r public.care_reminder_jobs;t public.care_message_templates;p public.pets;v public.patient_vaccine_due_plans;l public.patient_lab_orders;patient_id uuid;due date;care_name text;snapshot jsonb;body text;part record;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service enqueue only' using errcode='42501';end if;
 if p_id is null then raise exception 'Stable job ID required' using errcode='23514';end if;
 if p_source_kind='vaccine' then select pet_id into patient_id from public.patient_vaccine_due_plans where id=p_source_id;
 elsif p_source_kind='lab' then select pet_id into patient_id from public.patient_lab_orders where id=p_source_id;
 else raise exception 'Unsupported reminder source' using errcode='23514';end if;
 select * into p from public.pets where id=patient_id and archived_at is null and deceased_at is null for share;if not found then raise exception 'Reminder requires an active patient' using errcode='23514';end if;
 if p_source_kind='vaccine' then
  select * into v from public.patient_vaccine_due_plans where id=p_source_id for share;
  if v.version is distinct from p_expected_source_version or v.status<>'current' or not v.reminders_enabled or exists(select 1 from public.patient_treatment_corrections where treatment_id=v.treatment_id) then raise exception 'Vaccine due source is not current or enabled' using errcode='40001';end if;
  due=v.current_due_on;care_name=v.template_snapshot->>'name';snapshot=to_jsonb(v);
 else
  select * into l from public.patient_lab_orders where id=p_source_id for share;
  if l.version is distinct from p_expected_source_version or l.status not in ('planned','ordered') or l.due_date is null then raise exception 'Lab due source is not current' using errcode='40001';end if;
  due=l.due_date;care_name=l.test_name;snapshot=to_jsonb(l);
 end if;
 select * into t from public.care_message_templates where id=p_message_template_id for share;
 if t.id is null or not t.active or t.version is distinct from p_expected_template_version then raise exception 'Message template changed or retired' using errcode='40001';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,16));
 select * into r from public.care_reminder_jobs where id=p_id;
 if found then if row(r.source_kind,r.source_id,r.source_version,r.message_template_id,r.message_template_version) is distinct from row(p_source_kind,p_source_id,p_expected_source_version,p_message_template_id,p_expected_template_version) then raise exception 'Job ID reused with changed request' using errcode='42501';end if;return r;end if;
 -- A separate stable request ID for the same source/template version still returns the one canonical job.
 perform pg_advisory_xact_lock(hashtextextended(p_source_kind||p_source_id::text||p_expected_source_version::text||p_message_template_id::text||p_expected_template_version::text,17));
 select * into r from public.care_reminder_jobs where source_kind=p_source_kind and source_id=p_source_id and source_version=p_expected_source_version and message_template_id=p_message_template_id and message_template_version=p_expected_template_version;if found then return r;end if;
 body='';for part in select m[1] as token from regexp_matches(t.body,'(\{\{patient_name\}\}|\{\{care_name\}\}|\{\{due_date\}\}|[^{}]+)','g') m loop body=body||case part.token when '{{patient_name}}' then p.name when '{{care_name}}' then care_name when '{{due_date}}' then due::text else part.token end;end loop;
 insert into public.care_reminder_jobs(id,source_kind,source_id,source_version,pet_id,client_id,message_template_id,message_template_version,channel,scheduled_on,due_on,rendered_body,source_snapshot,template_snapshot) values(p_id,p_source_kind,p_source_id,p_expected_source_version,p.id,p.client_id,t.id,t.version,t.channel,due-t.days_before,due,body,snapshot,to_jsonb(t)) returning * into r;return r;
end $$;
do $$ declare t text;begin foreach t in array array['vaccine_due_templates','patient_vaccine_due_plans','care_message_templates','care_plan_revisions','care_reminder_jobs'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);execute format('grant select on table public.%I to authenticated',t);execute format('create policy "Active staff read due plans and unsent reminders" on public.%I for select to authenticated using(public.is_active_staff(auth.uid()))',t);
end loop;end $$;
revoke all on function public.care_record_revision(),public.care_require_admin(),public.care_invalidate_jobs(),public.care_corrected_anchor() from public,anon,authenticated,service_role;
revoke all on function public.save_vaccine_due_template(uuid,integer,text,text,uuid[],integer,boolean,text),public.save_patient_vaccine_due_plan(uuid,uuid,integer,uuid,integer,uuid,uuid,date,text,integer,date,text,boolean,text,text),public.save_care_message_template(uuid,integer,text,text,integer,text,boolean,text) from public,anon,service_role;
grant execute on function public.save_vaccine_due_template(uuid,integer,text,text,uuid[],integer,boolean,text),public.save_patient_vaccine_due_plan(uuid,uuid,integer,uuid,integer,uuid,uuid,date,text,integer,date,text,boolean,text,text),public.save_care_message_template(uuid,integer,text,text,integer,text,boolean,text) to authenticated;
revoke all on function public.enqueue_care_reminder(uuid,text,uuid,integer,uuid,integer) from public,anon,authenticated;
grant execute on function public.enqueue_care_reminder(uuid,text,uuid,integer,uuid,integer) to service_role;

-- Keyset candidate discovery for a future server scheduler; no messages are dispatched.
create function public.list_care_reminder_candidates(p_through date,p_after_kind text default '',p_after_id uuid default '00000000-0000-0000-0000-000000000000',p_limit integer default 100)
returns table(source_kind text,source_id uuid,source_version integer,pet_id uuid,due_on date) language plpgsql security definer set search_path=public as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service discovery only' using errcode='42501';end if;
 if p_through is null or not isfinite(p_through) or p_limit is null or p_limit not between 1 and 500 or p_after_kind is null or p_after_id is null then raise exception 'Finite discovery horizon and bounded page required' using errcode='23514';end if;
 return query select x.kind,x.id,x.version,x.patient,x.due from (
 select 'vaccine'::text kind,v.id,v.version,v.pet_id patient,v.current_due_on due from public.patient_vaccine_due_plans v where v.status='current' and v.reminders_enabled
 union all select 'lab'::text,l.id,l.version,l.pet_id,l.due_date from public.patient_lab_orders l where l.status in ('planned','ordered') and l.due_date is not null
 ) x join public.pets p on p.id=x.patient where p.archived_at is null and p.deceased_at is null and x.due<=p_through and row(x.kind,x.id)>row(p_after_kind,p_after_id) order by x.kind,x.id limit p_limit;
end $$;
revoke all on function public.list_care_reminder_candidates(date,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.list_care_reminder_candidates(date,text,uuid,integer) to service_role;
grant select on public.care_message_templates,public.care_reminder_jobs to service_role;
