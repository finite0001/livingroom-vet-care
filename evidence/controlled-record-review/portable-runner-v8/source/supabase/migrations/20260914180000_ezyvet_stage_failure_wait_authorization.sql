-- Preserve canonical staging contracts and lock order. Recheck authorization
-- before returning so revocation during any write wait rolls back the entire
-- page/failure transaction, including its durable attempt events.

-- Canonical body from 20260913010000_ezyvet_import.sql; historical wrapper name retained.
create or replace function public.stage_ezyvet_import_page_core(p_id uuid,p_actor uuid,p_lease_id uuid,p_page integer,p_complete boolean,p_items jsonb)
returns public.ezyvet_import_runs language plpgsql security definer set search_path=public,extensions as $$
declare r public.ezyvet_import_runs; item jsonb; snapshot_id uuid; item_hash text;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501'; end if;
 select * into strict r from public.ezyvet_import_runs where id=p_id for update;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if r.requested_by<>p_actor then raise exception 'Import owner mismatch' using errcode='42501'; end if;
 -- Retried committed page is a no-op, including a response lost after successful staging.
 if exists(select 1 from public.ezyvet_import_pages where run_id=p_id and page=p_page) then if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r; end if;
 if r.status<>'running' or r.lease_id is distinct from p_lease_id or r.lease_until<=now() or p_page<>r.next_page then raise exception 'Import lease or cursor changed' using errcode='40001'; end if;
 if p_complete is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>50 or octet_length(p_items::text)>2097152 then raise exception 'Invalid import page' using errcode='23514'; end if;
 if not p_complete and jsonb_array_length(p_items)=0 then raise exception 'Empty intermediate page' using errcode='23514'; end if;
 if (select count(*) from jsonb_array_elements(p_items))<>(select count(distinct value->>'external_id') from jsonb_array_elements(p_items)) then raise exception 'Duplicate external IDs' using errcode='23514'; end if;
 insert into public.ezyvet_import_pages(run_id,page,item_count) values(p_id,p_page,jsonb_array_length(p_items));
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item->'payload') is distinct from 'object' or item->>'external_id' is null or item->>'external_id' !~ '^[A-Za-z0-9_-]{1,128}$' then raise exception 'Invalid imported entity' using errcode='23514'; end if;
  item_hash=encode(digest((item->'payload')::text,'sha256'),'hex');
  insert into public.ezyvet_import_snapshots(source_origin,source_site_uid,resource,external_id,payload,payload_hash,first_seen_by)
  values(r.source_origin,r.source_site_uid,r.resource,item->>'external_id',item->'payload',item_hash,p_actor) on conflict(source_origin,source_site_uid,resource,external_id,payload_hash) do nothing;
  select id into strict snapshot_id from public.ezyvet_import_snapshots where source_origin=r.source_origin and source_site_uid=r.source_site_uid and resource=r.resource and external_id=item->>'external_id' and payload_hash=item_hash;
  insert into public.ezyvet_import_page_items(run_id,page,snapshot_id) values(p_id,p_page,snapshot_id);
 end loop;
 update public.ezyvet_import_runs set next_page=p_page+1,status=case when p_complete then 'review_ready' when p_page=1000 then 'page_limit_reached' else 'running' end,lease_id=null,lease_until=null,retry_after=now()+interval '2 seconds',last_error_code=null,updated_at=now() where id=p_id returning * into r;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;
end $$;

-- Canonical body from 20260913490000_ezyvet_clinical_runs.sql; historical wrapper name retained.
create or replace function public.stage_ezyvet_import_page_pre_vaccination(p_id uuid,p_actor uuid,p_lease_id uuid,p_page integer,p_complete boolean,p_items jsonb) returns public.ezyvet_import_runs language plpgsql security definer set search_path=public,extensions as $$
declare r public.ezyvet_import_runs;c public.ezyvet_clinical_runs;m public.ezyvet_record_links;fingerprint text;previous text;ordered_items jsonb;
begin
 select * into strict r from public.ezyvet_import_runs where id=p_id for update;
 if r.resource not in ('consult','history') then
  if public.ezyvet_is_active_admin(p_actor) is not true or r.requested_by is distinct from p_actor then raise exception 'Active import owner required' using errcode='42501';end if;
  -- Preserve existing committed recovery; never let SQL NULL comparisons authorize a fresh page.
  if not exists(select 1 from public.ezyvet_import_pages where run_id=p_id and page=p_page) and (r.status<>'running' or p_lease_id is null or r.lease_id is null or r.lease_id<>p_lease_id or r.lease_until is null or r.lease_until<=now() or p_page is distinct from r.next_page) then raise exception 'Import lease or cursor changed' using errcode='40001';end if;
  return public.stage_ezyvet_import_page_pre_clinical(p_id,p_actor,p_lease_id,p_page,p_complete,p_items);
 end if;
 if public.ezyvet_is_active_admin(p_actor) is not true or r.requested_by is distinct from p_actor then raise exception 'Active import owner required' using errcode='42501';end if;
 select * into c from public.ezyvet_clinical_runs where run_id=p_id;
 if not found then raise exception 'CLINICAL_RUN_REQUIRES_NEW_MAPPING' using errcode='22023';end if;
 if row(c.actor_id,c.resource,c.source_origin,c.source_site_uid) is distinct from row(p_actor,r.resource,r.source_origin,r.source_site_uid) then raise exception 'Clinical import context mismatch' using errcode='42501';end if;
 if p_complete is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>10 or octet_length(p_items::text)>2097152 then raise exception 'Invalid patient-scoped clinical page' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x)<>'object' or jsonb_typeof(x->'payload') is distinct from 'object' or x->>'external_id' is null or x->>'external_id' !~ '^[0-9]+$' or x#>>'{payload,id}' is distinct from x->>'external_id' or x#>>'{payload,animal_id}' is distinct from c.animal_external_id) then raise exception 'Clinical source identity mismatch' using errcode='23514';end if;
 fingerprint:=encode(digest(jsonb_build_array(p_complete,p_items)::text,'sha256'),'hex');
 select request_hash into previous from public.ezyvet_clinical_pages where run_id=p_id and page=p_page;
 if found then
  if previous<>fingerprint then raise exception 'Committed clinical page request changed' using errcode='40001';end if;
  if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;
 end if;
 if r.status<>'running' or p_lease_id is null or r.lease_id is null or r.lease_id<>p_lease_id or r.lease_until is null or r.lease_until<=now() or p_page is distinct from r.next_page then raise exception 'Import lease or cursor changed' using errcode='40001';end if;
 select * into m from public.ezyvet_record_links where id=c.animal_link_id for share;
 if row(m.resource,m.source_origin,m.source_site_uid,m.external_id,m.pet_id,m.client_id) is distinct from row('animal'::text,c.source_origin,c.source_site_uid,c.animal_external_id,c.pet_id,c.client_id) then raise exception 'Clinical patient mapping changed' using errcode='40001';end if;
 perform 1 from public.pets where id=c.pet_id and client_id=c.client_id for share;
 if not found then raise exception 'Clinical patient mapping changed' using errcode='40001';end if;
 -- Existing core preserves source/resource lease, cooldown, cursor and identity-head semantics.
 select coalesce(jsonb_agg(value order by value->>'external_id'),'[]') into ordered_items from jsonb_array_elements(p_items);
 r:=public.stage_ezyvet_import_page_core(p_id,p_actor,p_lease_id,p_page,p_complete,ordered_items);
 insert into public.ezyvet_clinical_pages(run_id,page,request_hash) values(p_id,p_page,fingerprint);
 insert into public.ezyvet_clinical_page_observations(run_id,page,snapshot_id,head_version)
 select i.run_id,i.page,i.snapshot_id,h.version from public.ezyvet_import_page_items i join public.ezyvet_import_snapshots s on s.id=i.snapshot_id join public.ezyvet_identity_heads h using(source_origin,source_site_uid,resource,external_id) where i.run_id=p_id and i.page=p_page;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;
end $$;

-- Canonical body from 20260913520000_consult_scoped_vaccination_import.sql; historical wrapper name retained.
create or replace function public.stage_ezyvet_import_page_pre_prescription(p_id uuid,p_actor uuid,p_lease_id uuid,p_page integer,p_complete boolean,p_items jsonb) returns public.ezyvet_import_runs language plpgsql security definer set search_path=public,extensions as $$
declare r public.ezyvet_import_runs;c public.ezyvet_vaccination_runs;m public.ezyvet_record_links;fingerprint text;previous text;ordered_items jsonb;
begin
 -- Serialize claim and stage before either holds the run or consult head lock.
 -- This also excludes a queued consult writer from forming a three-way lock cycle.
 if exists(select 1 from public.ezyvet_import_runs where id=p_id and resource='vaccination') then
  perform pg_advisory_xact_lock(hashtextextended('vaccination-run:'||p_id::text,0));
 end if;
 select * into strict r from public.ezyvet_import_runs where id=p_id for update;
 if r.resource not in ('vaccination') then
  return public.stage_ezyvet_import_page_pre_vaccination(p_id,p_actor,p_lease_id,p_page,p_complete,p_items);
 end if;
 if public.ezyvet_is_active_admin(p_actor) is not true or r.requested_by is distinct from p_actor then raise exception 'Active import owner required' using errcode='42501';end if;
 select * into c from public.ezyvet_vaccination_runs where run_id=p_id;
 if not found then raise exception 'VACCINATION_RUN_REQUIRES_NEW_CONTEXT' using errcode='22023';end if;
 if row(c.actor_id,c.resource,c.source_origin,c.source_site_uid) is distinct from row(p_actor,r.resource,r.source_origin,r.source_site_uid) then raise exception 'Vaccination import context mismatch' using errcode='42501';end if;
 if p_complete is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>10 or octet_length(p_items::text)>2097152 then raise exception 'Invalid patient-scoped vaccination page' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x)<>'object' or jsonb_typeof(x->'payload') is distinct from 'object' or x->>'external_id' is null or x->>'external_id' !~ '^(0|[1-9][0-9]{0,15})$' or coalesce(jsonb_typeof(x#>'{payload,id}'),'null') not in ('number','string') or x#>>'{payload,id}' is distinct from x->>'external_id' or coalesce(jsonb_typeof(x#>'{payload,consult_id}'),'null') not in ('number','string') or x#>>'{payload,consult_id}' is distinct from c.consult_external_id) then raise exception 'Vaccination source identity mismatch' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where (x->>'external_id')::numeric>9007199254740991 or (x#>'{payload,product_id}' is not null and x#>'{payload,product_id}'<>'null'::jsonb and (jsonb_typeof(x#>'{payload,product_id}') not in ('number','string') or x#>>'{payload,product_id}' !~ '^(0|[1-9][0-9]{0,15})$'))) then raise exception 'Invalid vaccination source reference' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x#>'{payload,product_id}') in ('number','string') and (x#>>'{payload,product_id}')::numeric>9007199254740991) then raise exception 'Invalid vaccination product reference' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x cross join unnest(array['qty','date_of_administration','date_of_next_administration','vet_id','created_at','modified_at']) field where x->'payload' ? field and jsonb_typeof(x->'payload'->field) not in ('null','string','number'))
 or exists(select 1 from jsonb_array_elements(p_items) x cross join unnest(array['description','notes']) field where x->'payload' ? field and jsonb_typeof(x->'payload'->field) not in ('null','string'))
 or exists(select 1 from jsonb_array_elements(p_items) x where x->'payload' ? 'active' and jsonb_typeof(x#>'{payload,active}') not in ('null','string','number','boolean')) then raise exception 'Invalid vaccination source values' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x cross join unnest(array['qty','date_of_administration','date_of_next_administration','vet_id','created_at','modified_at']) field where case when jsonb_typeof(x->'payload'->field)='number' then abs((x->'payload'->>field)::numeric)>1.7976931348623157e308::numeric else false end) then raise exception 'Nonfinite vaccination source number' using errcode='23514';end if;
 fingerprint:=encode(digest(jsonb_build_array(p_complete,p_items)::text,'sha256'),'hex');
 select request_hash into previous from public.ezyvet_vaccination_pages where run_id=p_id and page=p_page;
 if found then
  if previous<>fingerprint then raise exception 'Committed vaccination page request changed' using errcode='40001';end if;
  if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;
 end if;
 if r.status<>'running' or p_lease_id is null or r.lease_id is null or r.lease_id<>p_lease_id or r.lease_until is null or r.lease_until<=now() or p_page is distinct from r.next_page then raise exception 'Import lease or cursor changed' using errcode='40001';end if;
 select * into m from public.ezyvet_record_links where id=c.animal_link_id for share;
 if row(m.resource,m.source_origin,m.source_site_uid,m.external_id,m.pet_id,m.client_id) is distinct from row('animal'::text,c.source_origin,c.source_site_uid,c.animal_external_id,c.pet_id,c.client_id) then raise exception 'Vaccination patient mapping changed' using errcode='40001';end if;
 perform 1 from public.pets where id=c.pet_id and client_id=c.client_id for share;
 if not found then raise exception 'Vaccination patient mapping changed' using errcode='40001';end if;
 perform public.ezyvet_validate_vaccination_consult(c.animal_link_id,c.source_origin,c.source_site_uid,c.consult_snapshot_id,c.consult_payload_hash,c.consult_observed_head_version);
 -- Existing core preserves source/resource lease, cooldown, cursor and identity-head semantics.
 select coalesce(jsonb_agg(value order by value->>'external_id'),'[]') into ordered_items from jsonb_array_elements(p_items);
 r:=public.stage_ezyvet_import_page_core(p_id,p_actor,p_lease_id,p_page,p_complete,ordered_items);
 insert into public.ezyvet_vaccination_pages(run_id,page,request_hash) values(p_id,p_page,fingerprint);
 insert into public.ezyvet_vaccination_page_observations(run_id,page,snapshot_id,head_version)
 select i.run_id,i.page,i.snapshot_id,h.version from public.ezyvet_import_page_items i join public.ezyvet_import_snapshots s on s.id=i.snapshot_id join public.ezyvet_identity_heads h using(source_origin,source_site_uid,resource,external_id) where i.run_id=p_id and i.page=p_page;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;
end $$;

-- Canonical body from 20260913550000_patient_scoped_prescription_import.sql; historical wrapper name retained.
create or replace function public.stage_ezyvet_import_page_pre_prescriptionitem(p_id uuid,p_actor uuid,p_lease_id uuid,p_page integer,p_complete boolean,p_items jsonb) returns public.ezyvet_import_runs language plpgsql security definer set search_path=public,extensions as $$
declare r public.ezyvet_import_runs;c public.ezyvet_prescription_runs;m public.ezyvet_record_links;fingerprint text;previous text;ordered_items jsonb;
begin
 -- Delegate unrelated resources before taking their locks: their wrappers own
 -- canonical lock ordering. Prescription items require a separate parent context.
 select * into strict r from public.ezyvet_import_runs where id=p_id;
 if r.resource='prescriptionitem' then raise exception 'PRESCRIPTION_ITEM_CONTEXT_REQUIRED' using errcode='22023';end if;
 if r.resource<>'prescription' then
  return public.stage_ezyvet_import_page_pre_prescription(p_id,p_actor,p_lease_id,p_page,p_complete,p_items);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('prescription-run:'||p_id::text,0));
 select * into strict r from public.ezyvet_import_runs where id=p_id for update;
 if public.ezyvet_is_active_admin(p_actor) is not true or r.requested_by is distinct from p_actor then raise exception 'Active import owner required' using errcode='42501';end if;
 select * into c from public.ezyvet_prescription_runs where run_id=p_id;
 if not found then raise exception 'PRESCRIPTION_RUN_REQUIRES_NEW_MAPPING' using errcode='22023';end if;
 if row(c.actor_id,c.resource,c.source_origin,c.source_site_uid) is distinct from row(p_actor,r.resource,r.source_origin,r.source_site_uid) then raise exception 'Prescription import context mismatch' using errcode='42501';end if;
 if p_complete is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>10 or octet_length(p_items::text)>2097152 then raise exception 'Invalid patient-scoped prescription page' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x)<>'object' or jsonb_typeof(x->'payload') is distinct from 'object' or x->>'external_id' is null or x->>'external_id' !~ '^[0-9]+$' or x#>>'{payload,id}' is distinct from x->>'external_id' or x#>>'{payload,animal_id}' is distinct from c.animal_external_id) then raise exception 'Prescription source identity mismatch' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where
  jsonb_typeof(x#>'{payload,id}') not in ('string','number') or jsonb_typeof(x#>'{payload,animal_id}') not in ('string','number')
  or x->>'external_id' !~ '^(0|[1-9][0-9]{0,15})$') then raise exception 'Invalid prescription source identity' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where (x->>'external_id')::numeric>9007199254740991) then raise exception 'Invalid prescription source identity' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x cross join unnest(array['consult_id','prescribing_vet_user_id','date_of_prescription','created_at','modified_at']) field
  where x->'payload' ? field and jsonb_typeof(x->'payload'->field) not in ('null','string','number')) then raise exception 'Invalid prescription source values' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x cross join unnest(array['consult_id','prescribing_vet_user_id','date_of_prescription','created_at','modified_at']) field
  where case when jsonb_typeof(x->'payload'->field)='number' then abs((x->'payload'->>field)::numeric)>1.7976931348623157e308::numeric else false end) then raise exception 'Nonfinite prescription source number' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where x->'payload' ? 'active' and jsonb_typeof(x#>'{payload,active}') not in ('null','string','number','boolean')) then raise exception 'Invalid prescription source status' using errcode='23514';end if;
 -- Item-list anomalies remain source evidence for whole-prescription review.
 fingerprint:=encode(digest(jsonb_build_array(p_complete,p_items)::text,'sha256'),'hex');
 select request_hash into previous from public.ezyvet_prescription_pages where run_id=p_id and page=p_page;
 if found then
  if previous<>fingerprint then raise exception 'Committed prescription page request changed' using errcode='40001';end if;
  if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;
 end if;
 if r.status<>'running' or p_lease_id is null or r.lease_id is null or r.lease_id<>p_lease_id or r.lease_until is null or r.lease_until<=now() or p_page is distinct from r.next_page then raise exception 'Import lease or cursor changed' using errcode='40001';end if;
 select * into m from public.ezyvet_record_links where id=c.animal_link_id for share;
 if row(m.resource,m.source_origin,m.source_site_uid,m.external_id,m.pet_id,m.client_id) is distinct from row('animal'::text,c.source_origin,c.source_site_uid,c.animal_external_id,c.pet_id,c.client_id) then raise exception 'Prescription patient mapping changed' using errcode='40001';end if;
 perform 1 from public.pets where id=c.pet_id and client_id=c.client_id for share;
 if not found then raise exception 'Prescription patient mapping changed' using errcode='40001';end if;
 -- Existing core preserves source/resource lease, cooldown, cursor and identity-head semantics.
 select coalesce(jsonb_agg(value order by value->>'external_id'),'[]') into ordered_items from jsonb_array_elements(p_items);
 r:=public.stage_ezyvet_import_page_core(p_id,p_actor,p_lease_id,p_page,p_complete,ordered_items);
 insert into public.ezyvet_prescription_pages(run_id,page,request_hash) values(p_id,p_page,fingerprint);
 insert into public.ezyvet_prescription_page_observations(run_id,page,snapshot_id,head_version)
 select i.run_id,i.page,i.snapshot_id,h.version from public.ezyvet_import_page_items i join public.ezyvet_import_snapshots s on s.id=i.snapshot_id join public.ezyvet_identity_heads h using(source_origin,source_site_uid,resource,external_id) where i.run_id=p_id and i.page=p_page;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;
end $$;

-- Canonical body from 20260913560000_parent_scoped_prescription_items.sql; historical wrapper name retained.
create or replace function public.stage_ezyvet_import_page_pre_attachment(p_id uuid,p_actor uuid,p_lease_id uuid,p_page integer,p_complete boolean,p_items jsonb) returns public.ezyvet_import_runs language plpgsql security definer set search_path=public,extensions as $$
declare r public.ezyvet_import_runs;c public.ezyvet_prescriptionitem_runs;m public.ezyvet_record_links;fingerprint text;previous text;ordered_items jsonb;
begin
 -- Serialize claim and stage before either holds the run or prescription head lock.
 -- This also excludes a queued prescription writer from forming a three-way lock cycle.
 if exists(select 1 from public.ezyvet_import_runs where id=p_id and resource='prescriptionitem') then
  perform pg_advisory_xact_lock(hashtextextended('prescriptionitem-run:'||p_id::text,0));
 end if;
 select * into strict r from public.ezyvet_import_runs where id=p_id;
 if r.resource not in ('prescriptionitem') then
  return public.stage_ezyvet_import_page_pre_prescriptionitem(p_id,p_actor,p_lease_id,p_page,p_complete,p_items);
 end if;
 select * into strict r from public.ezyvet_import_runs where id=p_id for update;
 if public.ezyvet_is_active_admin(p_actor) is not true or r.requested_by is distinct from p_actor then raise exception 'Active import owner required' using errcode='42501';end if;
 select * into c from public.ezyvet_prescriptionitem_runs where run_id=p_id;
 if not found then raise exception 'PRESCRIPTIONITEM_RUN_REQUIRES_NEW_CONTEXT' using errcode='22023';end if;
 if row(c.actor_id,c.resource,c.source_origin,c.source_site_uid) is distinct from row(p_actor,r.resource,r.source_origin,r.source_site_uid) then raise exception 'Prescription item import context mismatch' using errcode='42501';end if;
 if p_complete is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>10 or octet_length(p_items::text)>2097152 then raise exception 'Invalid patient-scoped prescriptionitem page' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x)<>'object' or jsonb_typeof(x->'payload') is distinct from 'object' or x->>'external_id' is null or x->>'external_id' !~ '^(0|[1-9][0-9]{0,15})$' or coalesce(jsonb_typeof(x#>'{payload,id}'),'null') not in ('number','string') or x#>>'{payload,id}' is distinct from x->>'external_id' or coalesce(jsonb_typeof(x#>'{payload,prescription_id}'),'null') not in ('number','string') or x#>>'{payload,prescription_id}' is distinct from c.prescription_external_id) then raise exception 'Prescription item source identity mismatch' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where (x->>'external_id')::numeric>9007199254740991 or (x#>'{payload,product_id}' is not null and x#>'{payload,product_id}'<>'null'::jsonb and (jsonb_typeof(x#>'{payload,product_id}') not in ('number','string') or x#>>'{payload,product_id}' !~ '^(0|[1-9][0-9]{0,15})$'))) then raise exception 'Invalid prescriptionitem source reference' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x#>'{payload,product_id}') in ('number','string') and (x#>>'{payload,product_id}')::numeric>9007199254740991) then raise exception 'Invalid prescriptionitem product reference' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x cross join unnest(array['qty','remaining','date_start','serial_number','created_at','modified_at']) field where x->'payload' ? field and jsonb_typeof(x->'payload'->field) not in ('null','string','number'))
 or exists(select 1 from jsonb_array_elements(p_items) x cross join unnest(array['instructions']) field where x->'payload' ? field and jsonb_typeof(x->'payload'->field) not in ('null','string'))
 or exists(select 1 from jsonb_array_elements(p_items) x where x->'payload' ? 'active' and jsonb_typeof(x#>'{payload,active}') not in ('null','string','number','boolean')) then raise exception 'Invalid prescriptionitem source values' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x cross join unnest(array['qty','remaining','date_start','serial_number','created_at','modified_at']) field where case when jsonb_typeof(x->'payload'->field)='number' then abs((x->'payload'->>field)::numeric)>1.7976931348623157e308::numeric else false end) then raise exception 'Nonfinite prescriptionitem source number' using errcode='23514';end if;
 fingerprint:=encode(digest(jsonb_build_array(p_complete,p_items)::text,'sha256'),'hex');
 select request_hash into previous from public.ezyvet_prescriptionitem_pages where run_id=p_id and page=p_page;
 if found then
  if previous<>fingerprint then raise exception 'Committed prescriptionitem page request changed' using errcode='40001';end if;
  if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;
 end if;
 if r.status<>'running' or p_lease_id is null or r.lease_id is null or r.lease_id<>p_lease_id or r.lease_until is null or r.lease_until<=now() or p_page is distinct from r.next_page then raise exception 'Import lease or cursor changed' using errcode='40001';end if;
 select * into m from public.ezyvet_record_links where id=c.animal_link_id for share;
 if row(m.resource,m.source_origin,m.source_site_uid,m.external_id,m.pet_id,m.client_id) is distinct from row('animal'::text,c.source_origin,c.source_site_uid,c.animal_external_id,c.pet_id,c.client_id) then raise exception 'Prescription item patient mapping changed' using errcode='40001';end if;
 perform 1 from public.pets where id=c.pet_id and client_id=c.client_id for share;
 if not found then raise exception 'Prescription item patient mapping changed' using errcode='40001';end if;
 perform public.ezyvet_validate_prescriptionitem_prescription(c.animal_link_id,c.source_origin,c.source_site_uid,c.prescription_snapshot_id,c.prescription_payload_hash,c.prescription_observed_head_version);
 -- Existing core preserves source/resource lease, cooldown, cursor and identity-head semantics.
 select coalesce(jsonb_agg(value order by value->>'external_id'),'[]') into ordered_items from jsonb_array_elements(p_items);
 r:=public.stage_ezyvet_import_page_core(p_id,p_actor,p_lease_id,p_page,p_complete,ordered_items);
 insert into public.ezyvet_prescriptionitem_pages(run_id,page,request_hash) values(p_id,p_page,fingerprint);
 insert into public.ezyvet_prescriptionitem_page_observations(run_id,page,snapshot_id,head_version)
 select i.run_id,i.page,i.snapshot_id,h.version from public.ezyvet_import_page_items i join public.ezyvet_import_snapshots s on s.id=i.snapshot_id join public.ezyvet_identity_heads h using(source_origin,source_site_uid,resource,external_id) where i.run_id=p_id and i.page=p_page;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;
end $$;

-- Canonical body from 20260913690000_attachment_metadata_runs.sql; historical wrapper name retained.
create or replace function public.stage_ezyvet_attachment_page(p_run_id uuid,p_actor uuid,p_lease_id uuid,p_page jsonb) returns public.ezyvet_import_runs
language plpgsql security definer set search_path=public,extensions as $$
declare r public.ezyvet_import_runs;c public.ezyvet_attachment_runs;context jsonb;fingerprint text;previous text;items jsonb;page_no integer;rowrecord record;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('attachment-run:'||p_run_id::text,0));
 select * into r from public.ezyvet_import_runs where id=p_run_id for update;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into c from public.ezyvet_attachment_runs where run_id=p_run_id;
 if c.run_id is null or row(r.requested_by,r.resource,c.actor_id) is distinct from row(p_actor,'attachment'::text,p_actor) then raise exception 'Owned attachment run required' using errcode='42501';end if;
 perform public.ezyvet_attachment_validate_page(p_page,c.parent_context->>'animal_external_id');
 page_no:=(p_page->>'page')::integer;fingerprint:=encode(digest(p_page::text,'sha256'),'hex');
 select request_hash into previous from public.ezyvet_attachment_pages where run_id=p_run_id and page=page_no;
 if found then if previous<>fingerprint then raise exception 'Committed attachment page changed' using errcode='40001';end if;if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;end if;
 if r.status<>'running' or p_lease_id is null or r.lease_id is distinct from p_lease_id or r.lease_until is null or r.lease_until<=clock_timestamp() or page_no is distinct from r.next_page then raise exception 'Attachment lease or cursor changed' using errcode='40001';end if;
 context:=public.ezyvet_attachment_parent_context(c.animal_link_id,r.source_origin,r.source_site_uid);
 if context is distinct from c.parent_context then raise exception 'SOURCE_ATTACHMENT_PARENT_STALE' using errcode='40001';end if;
 -- Serialize fresh attachment stages with competing source claims before head locks.
 perform pg_advisory_xact_lock(hashtextextended(r.source_origin||':'||r.source_site_uid||':attachment',0));
 for rowrecord in select distinct value->>'external_id' external_id from jsonb_array_elements(p_page->'observations') order by 1 loop
  perform 1 from public.ezyvet_identity_heads where source_origin=r.source_origin and source_site_uid=r.source_site_uid and resource='attachment' and external_id=rowrecord.external_id for update;
 end loop;
 if r.lease_until<=clock_timestamp() then raise exception 'Attachment lease expired during source lock wait' using errcode='40001';end if;
 select coalesce(jsonb_agg(jsonb_build_object('external_id',external_id,'payload',metadata||jsonb_build_object('representation','sanitized_attachment_metadata_v1')) order by external_id),'[]') into items
 from(select distinct value->>'external_id' external_id,value->'metadata' metadata from jsonb_array_elements(p_page->'observations')) s;
 r:=public.stage_ezyvet_import_page_core(p_run_id,p_actor,p_lease_id,page_no,(p_page->>'complete')::boolean,items);
 insert into public.ezyvet_attachment_pages(run_id,page,request_hash,page_sha256,pagination,complete,observed_count,staged_count)
 values(p_run_id,page_no,fingerprint,p_page->>'page_sha256',p_page->'pagination',(p_page->>'complete')::boolean,jsonb_array_length(p_page->'observations'),jsonb_array_length(items));
 insert into public.ezyvet_attachment_page_observations(run_id,page,ordinal,external_id,file_id,snapshot_id,head_version,raw_record_sha256,stable_metadata_sha256)
 select p_run_id,page_no,x.ordinality::integer,x.value->>'external_id',x.value->>'file_id',s.id,h.version,x.value->>'raw_record_sha256',x.value->>'stable_metadata_sha256'
 from jsonb_array_elements(p_page->'observations') with ordinality x
 join public.ezyvet_import_page_items i on i.run_id=p_run_id and i.page=page_no
 join public.ezyvet_import_snapshots s on s.id=i.snapshot_id and s.external_id=x.value->>'external_id'
 join public.ezyvet_identity_heads h on h.source_origin=s.source_origin and h.source_site_uid=s.source_site_uid and h.resource=s.resource and h.external_id=s.external_id;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;
end $$;

-- Canonical body from 20260913010000_ezyvet_import.sql; historical wrapper name retained.
create or replace function public.fail_ezyvet_import_page(p_id uuid,p_actor uuid,p_lease_id uuid,p_code text,p_retry_seconds integer)
returns void language plpgsql security definer set search_path=public as $$
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501'; end if;
 if p_code is null or p_retry_seconds is null or p_code !~ '^[A-Z_]{1,64}$' or p_retry_seconds not between 1 and 3600 then raise exception 'Invalid import failure' using errcode='23514'; end if;
 update public.ezyvet_import_runs set lease_id=null,lease_until=null,last_error_code=p_code,retry_after=now()+make_interval(secs=>p_retry_seconds),updated_at=now() where id=p_id and requested_by=p_actor and lease_id=p_lease_id;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
end $$;
