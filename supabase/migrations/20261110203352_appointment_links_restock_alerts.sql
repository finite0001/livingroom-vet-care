-- Additive visit associations and explicit practice-wide stock thresholds.
-- Existing treatment, billing and controlled-stock writers are unchanged.
create table public.treatment_appointment_events (
 id uuid primary key, treatment_id uuid not null references public.patient_treatments(id),
 appointment_id uuid references public.appointments(id), version integer not null check(version>0),
 appointment_snapshot jsonb, reason text not null check(length(trim(reason)) between 1 and 2000),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(treatment_id,version), check((appointment_id is null)=(appointment_snapshot is null))
);
create index treatment_appointment_events_visit_idx on public.treatment_appointment_events(appointment_id);
create table public.inventory_restock_settings (
 id uuid primary key references public.catalog_products(id),
 threshold numeric(14,3) check(threshold>=0 and threshold::text not in ('NaN','Infinity','-Infinity')),
 version integer not null check(version>0),
 updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
alter table public.treatment_appointment_events enable row level security;
alter table public.inventory_restock_settings enable row level security;
revoke all on public.treatment_appointment_events, public.inventory_restock_settings from anon, authenticated, service_role;
grant select on public.treatment_appointment_events, public.inventory_restock_settings to authenticated;
create policy treatment_appointment_staff_read on public.treatment_appointment_events for select to authenticated using(public.is_active_staff(auth.uid()));
create policy inventory_restock_staff_read on public.inventory_restock_settings for select to authenticated using(public.is_active_staff(auth.uid()));
create trigger audit_treatment_appointment_events after insert on public.treatment_appointment_events for each row execute function public.audit_trigger_fn();
create trigger audit_inventory_restock_settings after insert or update on public.inventory_restock_settings for each row execute function public.audit_trigger_fn();

create function public.set_treatment_appointment(p_actor_id uuid,p_id uuid,p_pet_id uuid,p_treatment_id uuid,p_appointment_id uuid,p_appointment_version integer,p_expected_version integer,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_require_staff(); t public.patient_treatments; a public.appointments;
 existing public.treatment_appointment_events; current_version integer; snapshot jsonb;
begin
 if p_actor_id is distinct from actor then raise exception 'Actor mismatch' using errcode='42501'; end if;
 if p_id is null or p_expected_version is null or p_expected_version<0 or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Review the appointment link and reason' using errcode='22023'; end if;
 select * into t from public.patient_treatments where id=p_treatment_id for update;
 if not found or t.pet_id is distinct from p_pet_id or t.historical then raise exception 'Practice treatment unavailable for this patient' using errcode='22023'; end if;
 select * into existing from public.treatment_appointment_events where id=p_id;
 if found then
  if existing.created_by<>actor or existing.treatment_id<>p_treatment_id or existing.appointment_id is distinct from p_appointment_id or existing.version<>p_expected_version+1 or (existing.appointment_snapshot->>'version')::integer is distinct from p_appointment_version or existing.reason<>trim(p_reason) then raise exception 'Operation ID reused with different appointment details' using errcode='22023'; end if;
  return to_jsonb(existing);
 end if;
 select coalesce(max(version),0) into current_version from public.treatment_appointment_events where treatment_id=t.id;
 if current_version<>p_expected_version then raise exception 'Appointment link changed. Reload before saving.' using errcode='40001'; end if;
 if p_appointment_id is not null then
  select * into a from public.appointments where id=p_appointment_id for share;
  if not found or a.pet_id is distinct from t.pet_id or a.client_id is distinct from (select client_id from public.pets where id=t.pet_id) or a.status::text in ('CANCELLED','NO_SHOW') then raise exception 'Select a visit for this patient that was not cancelled or missed' using errcode='22023'; end if;
  if a.version is distinct from p_appointment_version then raise exception 'Visit details changed. Reload before linking.' using errcode='40001'; end if;
  snapshot:=jsonb_build_object('id',a.id,'version',a.version,'scheduled_at',a.scheduled_at,'appointment_type',a.appointment_type,'status',a.status,'pet_id',a.pet_id,'client_id',a.client_id);
 elsif p_appointment_version is not null or not exists(select 1 from public.treatment_appointment_events where treatment_id=t.id and version=current_version and appointment_id is not null) then
  raise exception 'No current appointment link to remove' using errcode='22023';
 end if;
 insert into public.treatment_appointment_events(id,treatment_id,appointment_id,version,appointment_snapshot,reason,created_by)
 values(p_id,t.id,p_appointment_id,current_version+1,snapshot,trim(p_reason),actor) returning * into existing;
 return to_jsonb(existing);
end $$;

create function public.read_treatment_appointment(p_pet_id uuid,p_treatment_id uuid,p_day date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.patient_treatments; current_link jsonb; visits jsonb; history jsonb;
begin
 perform public.clinical_require_staff();
 if p_day is null or not isfinite(p_day) then raise exception 'Visit date required' using errcode='22023'; end if;
 select * into t from public.patient_treatments where id=p_treatment_id and pet_id=p_pet_id;
 if not found or t.historical then raise exception 'Practice treatment unavailable for this patient' using errcode='22023'; end if;
 select to_jsonb(e)||jsonb_build_object('context_changed',e.appointment_id is not null and not exists(
  select 1 from public.appointments a where a.id=e.appointment_id and a.pet_id=t.pet_id
  and a.client_id=(select client_id from public.pets where id=t.pet_id)
  and a.scheduled_at=(e.appointment_snapshot->>'scheduled_at')::timestamptz
  and a.appointment_type=e.appointment_snapshot->>'appointment_type' and a.status::text not in ('CANCELLED','NO_SHOW')))
 into current_link from public.treatment_appointment_events e where treatment_id=t.id order by version desc limit 1;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'version',a.version,'scheduled_at',a.scheduled_at,'appointment_type',a.appointment_type,'status',a.status) order by a.scheduled_at,a.id),'[]') into visits
 from public.appointments a where a.pet_id=t.pet_id and a.client_id=(select client_id from public.pets where id=t.pet_id)
 and a.scheduled_at >= p_day::timestamp at time zone 'America/Denver' and a.scheduled_at < (p_day+1)::timestamp at time zone 'America/Denver'
 and a.status::text not in ('CANCELLED','NO_SHOW');
 select coalesce(jsonb_agg(to_jsonb(e) order by version desc),'[]') into history from
 (select * from public.treatment_appointment_events where treatment_id=t.id order by version desc limit 20)e;
 return jsonb_build_object('pet_id',t.pet_id,'treatment_id',t.id,'current',current_link,'appointments',visits,'history',history);
end $$;

create function public.save_inventory_restock_setting(p_actor_id uuid,p_product_id uuid,p_threshold numeric,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_require_staff(); p public.catalog_products; s public.inventory_restock_settings;
begin
 if p_actor_id is distinct from actor then raise exception 'Actor mismatch' using errcode='42501'; end if;
 if p_expected_version is null or p_expected_version<0 or (p_threshold is not null and (p_threshold<0 or p_threshold>99999999999.999 or p_threshold<>round(p_threshold,3) or p_threshold::text in ('NaN','Infinity','-Infinity'))) then raise exception 'Use a nonnegative threshold with at most three decimals' using errcode='22023'; end if;
 select * into p from public.catalog_products where id=p_product_id for update;
 if not found or p.kind='service' or not p.active then raise exception 'Select an active stock product' using errcode='22023'; end if;
 select * into s from public.inventory_restock_settings where id=p.id;
 -- Exact retries succeed after a lost response; a different concurrent edit requires reload.
 if found and s.version=p_expected_version+1 and s.updated_by=actor and s.threshold is not distinct from p_threshold then return to_jsonb(s); end if;
 if coalesce(s.version,0)<>p_expected_version then raise exception 'Restocking setting changed. Reload before saving.' using errcode='40001'; end if;
 insert into public.inventory_restock_settings(id,threshold,version,updated_by) values(p.id,p_threshold,p_expected_version+1,actor)
 on conflict(id) do update set threshold=excluded.threshold,version=excluded.version,updated_by=excluded.updated_by,updated_at=now() returning * into s;
 return to_jsonb(s);
end $$;

create function public.read_inventory_restock_alerts()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.clinical_require_staff();
 return (select jsonb_build_object('as_of',now(),'rows',coalesce(jsonb_agg(to_jsonb(r) order by r.name,r.id),'[]')) from (
  select p.id,p.name,p.unit,s.threshold,s.version,
   exists(select 1 from public.inventory_lots l join public.inventory_movements m on m.lot_id=l.id where l.product_id=p.id) as counted,
   coalesce((select sum(m.quantity) from public.inventory_lots l join public.inventory_movements m on m.lot_id=l.id
    where l.product_id=p.id and l.expires_on >= (now() at time zone 'America/Denver')::date),0) as balance
  from public.inventory_restock_settings s join public.catalog_products p on p.id=s.id where p.active and p.kind<>'service'
 )r);
end $$;

revoke all on function public.set_treatment_appointment(uuid,uuid,uuid,uuid,uuid,integer,integer,text),public.read_treatment_appointment(uuid,uuid,date),public.save_inventory_restock_setting(uuid,uuid,numeric,integer),public.read_inventory_restock_alerts() from public,anon,authenticated,service_role;
grant execute on function public.set_treatment_appointment(uuid,uuid,uuid,uuid,uuid,integer,integer,text),public.read_treatment_appointment(uuid,uuid,date),public.save_inventory_restock_setting(uuid,uuid,numeric,integer),public.read_inventory_restock_alerts() to authenticated;

create function public.read_appointment_treatment_usage(p_pet_id uuid,p_appointment_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.clinical_require_staff();
 if not exists(select 1 from public.appointments a join public.pets p on p.id=a.pet_id where a.id=p_appointment_id and a.pet_id=p_pet_id and a.client_id=p.client_id) then raise exception 'Appointment unavailable for this patient' using errcode='22023'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'pet_id',t.pet_id,'product_name',t.product_name,'administered_at',t.administered_at,'quantity',t.quantity,'dose',t.dose,'corrected',exists(select 1 from public.patient_treatment_corrections c where c.treatment_id=t.id)) order by t.administered_at,t.id),'[]')
 from public.patient_treatments t join lateral(select e.appointment_id from public.treatment_appointment_events e where e.treatment_id=t.id order by version desc limit 1)e on e.appointment_id=p_appointment_id where t.pet_id=p_pet_id and not t.historical);
end $$;
revoke all on function public.read_appointment_treatment_usage(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_appointment_treatment_usage(uuid,uuid) to authenticated;
