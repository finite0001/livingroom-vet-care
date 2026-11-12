-- Permanent stale-version conflicts must not use PostgreSQL's retryable
-- serialization_failure code. Preserve both original routines and their ACLs;
-- only the three application conflict SQLSTATE literals change to HTTP 409.
BEGIN;

create or replace function public.set_treatment_appointment(p_actor_id uuid,p_id uuid,p_pet_id uuid,p_treatment_id uuid,p_appointment_id uuid,p_appointment_version integer,p_expected_version integer,p_reason text)
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
 if current_version<>p_expected_version then raise exception 'Appointment link changed. Reload before saving.' using errcode='PT409'; end if;
 if p_appointment_id is not null then
  select * into a from public.appointments where id=p_appointment_id for share;
  if not found or a.pet_id is distinct from t.pet_id or a.client_id is distinct from (select client_id from public.pets where id=t.pet_id) or a.status::text in ('CANCELLED','NO_SHOW') then raise exception 'Select a visit for this patient that was not cancelled or missed' using errcode='22023'; end if;
  if a.version is distinct from p_appointment_version then raise exception 'Visit details changed. Reload before linking.' using errcode='PT409'; end if;
  snapshot:=jsonb_build_object('id',a.id,'version',a.version,'scheduled_at',a.scheduled_at,'appointment_type',a.appointment_type,'status',a.status,'pet_id',a.pet_id,'client_id',a.client_id);
 elsif p_appointment_version is not null or not exists(select 1 from public.treatment_appointment_events where treatment_id=t.id and version=current_version and appointment_id is not null) then
  raise exception 'No current appointment link to remove' using errcode='22023';
 end if;
 insert into public.treatment_appointment_events(id,treatment_id,appointment_id,version,appointment_snapshot,reason,created_by)
 values(p_id,t.id,p_appointment_id,current_version+1,snapshot,trim(p_reason),actor) returning * into existing;
 return to_jsonb(existing);
end $$;

create or replace function public.save_inventory_restock_setting(p_actor_id uuid,p_product_id uuid,p_threshold numeric,p_expected_version integer)
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
 if coalesce(s.version,0)<>p_expected_version then raise exception 'Restocking setting changed. Reload before saving.' using errcode='PT409'; end if;
 insert into public.inventory_restock_settings(id,threshold,version,updated_by) values(p.id,p_threshold,p_expected_version+1,actor)
 on conflict(id) do update set threshold=excluded.threshold,version=excluded.version,updated_by=excluded.updated_by,updated_at=now() returning * into s;
 return to_jsonb(s);
end $$;

COMMIT;
