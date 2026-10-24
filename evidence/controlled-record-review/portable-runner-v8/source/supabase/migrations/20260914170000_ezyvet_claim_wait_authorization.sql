-- Recheck active administrator status after claim waits and before recovery returns.
-- Preserve the existing resource contracts, locks, cursor, cooldown and lease behavior.

create or replace function public.claim_ezyvet_import_core(p_id uuid,p_actor uuid,p_site_uid text,p_resource text,p_source_origin text)
returns public.ezyvet_import_runs language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_import_runs;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501'; end if;
 if p_id is null or nullif(trim(p_site_uid),'') is null then raise exception 'Invalid import request' using errcode='23514'; end if;
 -- Serialize claims per source/resource, including different runs, to avoid concurrent provider traffic.
 perform pg_advisory_xact_lock(hashtextextended(p_source_origin||':'||p_site_uid||':'||p_resource,0));
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 insert into public.ezyvet_import_runs(id,source_origin,source_site_uid,resource,requested_by) values(p_id,p_source_origin,p_site_uid,p_resource,p_actor) on conflict(id) do nothing;
 select * into strict r from public.ezyvet_import_runs where id=p_id for update;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if r.requested_by<>p_actor or r.source_origin<>p_source_origin or r.source_site_uid<>p_site_uid or r.resource<>p_resource then raise exception 'Import identity mismatch' using errcode='42501'; end if;
 if r.status<>'running' then if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if; return r; end if;
 if exists(select 1 from public.ezyvet_import_runs where source_origin=p_source_origin and source_site_uid=p_site_uid and resource=p_resource and (lease_until>now() or retry_after>now())) then raise exception 'Import busy or cooling down' using errcode='55P03'; end if;
 update public.ezyvet_import_runs set lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds',last_error_code=null,updated_at=now() where id=p_id returning * into r;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if; return r;
end $$;

revoke all on function public.claim_ezyvet_import_core(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;

create or replace function public.claim_ezyvet_weight_import(p_id uuid,p_actor uuid,p_site_uid text,p_source_origin text,p_animal_link_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare link public.ezyvet_record_links;r public.ezyvet_import_runs;context public.ezyvet_weight_runs;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into link from public.ezyvet_record_links where id=p_animal_link_id and resource='animal' and source_origin=p_source_origin and source_site_uid=p_site_uid for share;
 if not found or link.external_id !~ '^[0-9]+$' or not exists(select 1 from public.pets where id=link.pet_id and client_id=link.client_id) then raise exception 'Reviewed patient mapping required for this source site' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('weight-run:'||p_id::text,0));
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into context from public.ezyvet_weight_runs where run_id=p_id;
 if found and context.animal_link_id<>p_animal_link_id then raise exception 'Import mapping cannot change' using errcode='42501';end if;
 r:=public.claim_ezyvet_import_core(p_id,p_actor,p_site_uid,'healthstatus',p_source_origin);
 insert into public.ezyvet_weight_runs(run_id,animal_link_id) values(p_id,p_animal_link_id) on conflict(run_id) do nothing;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return to_jsonb(r)||jsonb_build_object('animal_external_id',link.external_id,'animal_link_id',link.id);
end $$;

revoke all on function public.claim_ezyvet_weight_import(uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;

grant execute on function public.claim_ezyvet_weight_import(uuid,uuid,text,text,uuid) to service_role;

create or replace function public.claim_ezyvet_clinical_import(p_id uuid,p_actor uuid,p_site_uid text,p_resource text,p_source_origin text,p_animal_link_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.ezyvet_record_links;c public.ezyvet_clinical_runs;r public.ezyvet_import_runs;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_resource is null or p_resource not in ('consult','history') then raise exception 'Supported clinical resource required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-run:'||p_id::text,0));
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into c from public.ezyvet_clinical_runs where run_id=p_id;
 if found then
  if row(c.actor_id,c.animal_link_id,c.source_origin,c.source_site_uid,c.resource) is distinct from row(p_actor,p_animal_link_id,p_source_origin,p_site_uid,p_resource) then raise exception 'Clinical import identity cannot change' using errcode='42501';end if;
 elsif exists(select 1 from public.ezyvet_import_runs where id=p_id) then
  raise exception 'CLINICAL_RUN_REQUIRES_NEW_MAPPING' using errcode='22023';
 end if;
 select * into r from public.ezyvet_import_runs where id=p_id;
 if c.run_id is not null and r.status<>'running' then
  if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return to_jsonb(r)||jsonb_build_object('animal_link_id',c.animal_link_id,'animal_external_id',c.animal_external_id,'pet_id',c.pet_id,'client_id',c.client_id);
 end if;
 select * into m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal' and source_origin=p_source_origin and source_site_uid=p_site_uid for share;
 if not found or m.external_id !~ '^[0-9]+$' then raise exception 'Reviewed patient mapping required for this source site' using errcode='42501';end if;
 if c.run_id is not null and row(c.pet_id,c.client_id,c.animal_external_id) is distinct from row(m.pet_id,m.client_id,m.external_id) then raise exception 'Clinical patient mapping changed' using errcode='40001';end if;
 -- Terminal exact runs recover without revalidating mutable household membership.
 select * into r from public.ezyvet_import_runs where id=p_id;
 if r.id is null or r.status='running' then
  perform 1 from public.pets where id=m.pet_id and client_id=m.client_id for share;
  if not found then raise exception 'Patient mapping changed; review before importing' using errcode='40001';end if;
 end if;
 r:=public.claim_ezyvet_import_core(p_id,p_actor,p_site_uid,p_resource,p_source_origin);
 insert into public.ezyvet_clinical_runs(run_id,animal_link_id,actor_id,pet_id,client_id,source_origin,source_site_uid,resource,animal_external_id)
 values(p_id,m.id,p_actor,m.pet_id,m.client_id,p_source_origin,p_site_uid,p_resource,m.external_id) on conflict(run_id) do nothing;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return to_jsonb(r)||jsonb_build_object('animal_link_id',m.id,'animal_external_id',m.external_id,'pet_id',m.pet_id,'client_id',m.client_id);
end $$;

revoke all on function public.claim_ezyvet_clinical_import(uuid,uuid,text,text,text,uuid) from public,anon,authenticated,service_role;

grant execute on function public.claim_ezyvet_clinical_import(uuid,uuid,text,text,text,uuid) to service_role;

create or replace function public.claim_ezyvet_vaccination_import(p_id uuid,p_actor uuid,p_site_uid text,p_resource text,p_source_origin text,p_animal_link_id uuid,p_consult_snapshot_id uuid,p_consult_payload_hash text,p_consult_observed_head_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.ezyvet_record_links;c public.ezyvet_vaccination_runs;r public.ezyvet_import_runs;s public.ezyvet_import_snapshots;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_consult_snapshot_id is null or p_consult_payload_hash is null or p_consult_payload_hash !~ '^[a-f0-9]{64}$' or p_consult_observed_head_version is null or p_consult_observed_head_version<1 or p_resource is null or p_resource not in ('vaccination') then raise exception 'Supported vaccination resource required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('vaccination-run:'||p_id::text,0));
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into c from public.ezyvet_vaccination_runs where run_id=p_id;
 if found then
  if row(c.actor_id,c.animal_link_id,c.source_origin,c.source_site_uid,c.resource,c.consult_snapshot_id,c.consult_payload_hash,c.consult_observed_head_version) is distinct from row(p_actor,p_animal_link_id,p_source_origin,p_site_uid,p_resource,p_consult_snapshot_id,p_consult_payload_hash,p_consult_observed_head_version) then raise exception 'Vaccination import identity cannot change' using errcode='42501';end if;
 elsif exists(select 1 from public.ezyvet_import_runs where id=p_id) then
  raise exception 'VACCINATION_RUN_REQUIRES_NEW_CONTEXT' using errcode='22023';
 end if;
 select * into r from public.ezyvet_import_runs where id=p_id;
 if c.run_id is not null and r.status<>'running' then
  if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return to_jsonb(r)||jsonb_build_object('animal_link_id',c.animal_link_id,'animal_external_id',c.animal_external_id,'pet_id',c.pet_id,'client_id',c.client_id,'consult_snapshot_id',c.consult_snapshot_id,'consult_payload_hash',c.consult_payload_hash,'consult_observed_head_version',c.consult_observed_head_version,'consult_external_id',c.consult_external_id);
 end if;
 select * into m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal' and source_origin=p_source_origin and source_site_uid=p_site_uid for share;
 if not found or m.external_id !~ '^[0-9]+$' then raise exception 'Reviewed patient mapping required for this source site' using errcode='42501';end if;
 if c.run_id is not null and row(c.pet_id,c.client_id,c.animal_external_id) is distinct from row(m.pet_id,m.client_id,m.external_id) then raise exception 'Vaccination patient mapping changed' using errcode='40001';end if;
 -- Terminal exact runs recover without revalidating mutable household membership.
 select * into r from public.ezyvet_import_runs where id=p_id;
 if r.id is null or r.status='running' then
  perform 1 from public.pets where id=m.pet_id and client_id=m.client_id for share;
  if not found then raise exception 'Patient mapping changed; review before importing' using errcode='40001';end if;
 end if;
 s:=public.ezyvet_validate_vaccination_consult(p_animal_link_id,p_source_origin,p_site_uid,p_consult_snapshot_id,p_consult_payload_hash,p_consult_observed_head_version);
 r:=public.claim_ezyvet_import_core(p_id,p_actor,p_site_uid,p_resource,p_source_origin);
 insert into public.ezyvet_vaccination_runs(run_id,animal_link_id,actor_id,pet_id,client_id,source_origin,source_site_uid,resource,animal_external_id,consult_snapshot_id,consult_payload_hash,consult_observed_head_version,consult_external_id)
 values(p_id,m.id,p_actor,m.pet_id,m.client_id,p_source_origin,p_site_uid,p_resource,m.external_id,s.id,s.payload_hash,p_consult_observed_head_version,s.external_id) on conflict(run_id) do nothing;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return to_jsonb(r)||jsonb_build_object('animal_link_id',m.id,'animal_external_id',m.external_id,'pet_id',m.pet_id,'client_id',m.client_id,'consult_snapshot_id',s.id,'consult_payload_hash',s.payload_hash,'consult_observed_head_version',p_consult_observed_head_version,'consult_external_id',s.external_id);
end $$;

revoke all on function public.claim_ezyvet_vaccination_import(uuid,uuid,text,text,text,uuid,uuid,text,integer) from public,anon,authenticated,service_role;

grant execute on function public.claim_ezyvet_vaccination_import(uuid,uuid,text,text,text,uuid,uuid,text,integer) to service_role;

create or replace function public.claim_ezyvet_prescription_import(p_id uuid,p_actor uuid,p_site_uid text,p_resource text,p_source_origin text,p_animal_link_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.ezyvet_record_links;c public.ezyvet_prescription_runs;r public.ezyvet_import_runs;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_resource is null or p_resource not in ('prescription') then raise exception 'Supported prescription resource required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('prescription-run:'||p_id::text,0));
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into c from public.ezyvet_prescription_runs where run_id=p_id;
 if found then
  if row(c.actor_id,c.animal_link_id,c.source_origin,c.source_site_uid,c.resource) is distinct from row(p_actor,p_animal_link_id,p_source_origin,p_site_uid,p_resource) then raise exception 'Prescription import identity cannot change' using errcode='42501';end if;
 elsif exists(select 1 from public.ezyvet_import_runs where id=p_id) then
  raise exception 'PRESCRIPTION_RUN_REQUIRES_NEW_MAPPING' using errcode='22023';
 end if;
 select * into r from public.ezyvet_import_runs where id=p_id;
 if c.run_id is not null and r.status<>'running' then
  if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return to_jsonb(r)||jsonb_build_object('animal_link_id',c.animal_link_id,'animal_external_id',c.animal_external_id,'pet_id',c.pet_id,'client_id',c.client_id);
 end if;
 select * into m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal' and source_origin=p_source_origin and source_site_uid=p_site_uid for share;
 if not found or m.external_id !~ '^[0-9]+$' then raise exception 'Reviewed patient mapping required for this source site' using errcode='42501';end if;
 if c.run_id is not null and row(c.pet_id,c.client_id,c.animal_external_id) is distinct from row(m.pet_id,m.client_id,m.external_id) then raise exception 'Prescription patient mapping changed' using errcode='40001';end if;
 -- Terminal exact runs recover without revalidating mutable household membership.
 select * into r from public.ezyvet_import_runs where id=p_id;
 if r.id is null or r.status='running' then
  perform 1 from public.pets where id=m.pet_id and client_id=m.client_id for share;
  if not found then raise exception 'Patient mapping changed; review before importing' using errcode='40001';end if;
 end if;
 r:=public.claim_ezyvet_import_core(p_id,p_actor,p_site_uid,p_resource,p_source_origin);
 insert into public.ezyvet_prescription_runs(run_id,animal_link_id,actor_id,pet_id,client_id,source_origin,source_site_uid,resource,animal_external_id)
 values(p_id,m.id,p_actor,m.pet_id,m.client_id,p_source_origin,p_site_uid,p_resource,m.external_id) on conflict(run_id) do nothing;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return to_jsonb(r)||jsonb_build_object('animal_link_id',m.id,'animal_external_id',m.external_id,'pet_id',m.pet_id,'client_id',m.client_id);
end $$;

revoke all on function public.claim_ezyvet_prescription_import(uuid,uuid,text,text,text,uuid) from public,anon,authenticated,service_role;

grant execute on function public.claim_ezyvet_prescription_import(uuid,uuid,text,text,text,uuid) to service_role;

create or replace function public.claim_ezyvet_prescriptionitem_import(p_id uuid,p_actor uuid,p_site_uid text,p_resource text,p_source_origin text,p_animal_link_id uuid,p_prescription_snapshot_id uuid,p_prescription_payload_hash text,p_prescription_observed_head_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.ezyvet_record_links;c public.ezyvet_prescriptionitem_runs;r public.ezyvet_import_runs;s public.ezyvet_import_snapshots;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_prescription_snapshot_id is null or p_prescription_payload_hash is null or p_prescription_payload_hash !~ '^[a-f0-9]{64}$' or p_prescription_observed_head_version is null or p_prescription_observed_head_version<1 or p_resource is null or p_resource not in ('prescriptionitem') then raise exception 'Supported prescriptionitem resource required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('prescriptionitem-run:'||p_id::text,0));
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into c from public.ezyvet_prescriptionitem_runs where run_id=p_id;
 if found then
  if row(c.actor_id,c.animal_link_id,c.source_origin,c.source_site_uid,c.resource,c.prescription_snapshot_id,c.prescription_payload_hash,c.prescription_observed_head_version) is distinct from row(p_actor,p_animal_link_id,p_source_origin,p_site_uid,p_resource,p_prescription_snapshot_id,p_prescription_payload_hash,p_prescription_observed_head_version) then raise exception 'Prescription item import identity cannot change' using errcode='42501';end if;
 elsif exists(select 1 from public.ezyvet_import_runs where id=p_id) then
  raise exception 'PRESCRIPTIONITEM_RUN_REQUIRES_NEW_CONTEXT' using errcode='22023';
 end if;
 select * into r from public.ezyvet_import_runs where id=p_id;
 if c.run_id is not null and r.status<>'running' then
  if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return to_jsonb(r)||jsonb_build_object('animal_link_id',c.animal_link_id,'animal_external_id',c.animal_external_id,'pet_id',c.pet_id,'client_id',c.client_id,'prescription_snapshot_id',c.prescription_snapshot_id,'prescription_payload_hash',c.prescription_payload_hash,'prescription_observed_head_version',c.prescription_observed_head_version,'prescription_external_id',c.prescription_external_id);
 end if;
 select * into m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal' and source_origin=p_source_origin and source_site_uid=p_site_uid for share;
 if not found or m.external_id !~ '^[0-9]+$' then raise exception 'Reviewed patient mapping required for this source site' using errcode='42501';end if;
 if c.run_id is not null and row(c.pet_id,c.client_id,c.animal_external_id) is distinct from row(m.pet_id,m.client_id,m.external_id) then raise exception 'Prescription item patient mapping changed' using errcode='40001';end if;
 -- Terminal exact runs recover without revalidating mutable household membership.
 select * into r from public.ezyvet_import_runs where id=p_id;
 if r.id is null or r.status='running' then
  perform 1 from public.pets where id=m.pet_id and client_id=m.client_id for share;
  if not found then raise exception 'Patient mapping changed; review before importing' using errcode='40001';end if;
 end if;
 s:=public.ezyvet_validate_prescriptionitem_prescription(p_animal_link_id,p_source_origin,p_site_uid,p_prescription_snapshot_id,p_prescription_payload_hash,p_prescription_observed_head_version);
 r:=public.claim_ezyvet_import_core(p_id,p_actor,p_site_uid,p_resource,p_source_origin);
 insert into public.ezyvet_prescriptionitem_runs(run_id,animal_link_id,actor_id,pet_id,client_id,source_origin,source_site_uid,resource,animal_external_id,prescription_snapshot_id,prescription_payload_hash,prescription_observed_head_version,prescription_external_id)
 values(p_id,m.id,p_actor,m.pet_id,m.client_id,p_source_origin,p_site_uid,p_resource,m.external_id,s.id,s.payload_hash,p_prescription_observed_head_version,s.external_id) on conflict(run_id) do nothing;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return to_jsonb(r)||jsonb_build_object('animal_link_id',m.id,'animal_external_id',m.external_id,'pet_id',m.pet_id,'client_id',m.client_id,'prescription_snapshot_id',s.id,'prescription_payload_hash',s.payload_hash,'prescription_observed_head_version',p_prescription_observed_head_version,'prescription_external_id',s.external_id);
end $$;

revoke all on function public.claim_ezyvet_prescriptionitem_import(uuid,uuid,text,text,text,uuid,uuid,text,integer) from public,anon,authenticated,service_role;

grant execute on function public.claim_ezyvet_prescriptionitem_import(uuid,uuid,text,text,text,uuid,uuid,text,integer) to service_role;

create or replace function public.claim_ezyvet_attachment_import(p_id uuid,p_actor uuid,p_site_uid text,p_source_origin text,p_animal_link_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.ezyvet_attachment_runs;r public.ezyvet_import_runs;context jsonb;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_animal_link_id is null or p_source_origin is null or p_site_uid is null then raise exception 'Exact attachment operation required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('attachment-run:'||p_id::text,0));
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into c from public.ezyvet_attachment_runs where run_id=p_id;select * into r from public.ezyvet_import_runs where id=p_id;
 if c.run_id is not null then
  if row(c.actor_id,c.animal_link_id,r.requested_by,r.resource,r.source_origin,r.source_site_uid) is distinct from row(p_actor,p_animal_link_id,p_actor,'attachment'::text,p_source_origin,p_site_uid) then raise exception 'Attachment operation identity changed' using errcode='42501';end if;
  if r.status<>'running' then if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return to_jsonb(r)||jsonb_build_object('scope','animal_attachment_metadata','parent_context',c.parent_context,'animal_link_id',c.animal_link_id,'animal_external_id',c.parent_context->'animal_external_id','pet_id',c.pet_id,'client_id',c.parent_context->'client_id');end if;
 elsif r.id is not null then raise exception 'ATTACHMENT_RUN_REQUIRES_NEW_CONTEXT' using errcode='22023';end if;
 context:=public.ezyvet_attachment_parent_context(p_animal_link_id,p_source_origin,p_site_uid);
 if c.run_id is not null and c.parent_context is distinct from context then raise exception 'SOURCE_ATTACHMENT_PARENT_STALE' using errcode='40001';end if;
 perform public.ezyvet_attachment_original_source_gate(p_source_origin,p_site_uid,null);
 r:=public.claim_ezyvet_import_core(p_id,p_actor,p_site_uid,'attachment',p_source_origin);
 if r.lease_until<=clock_timestamp() then raise exception 'Attachment lease expired during claim' using errcode='40001';end if;
 insert into public.ezyvet_attachment_runs(run_id,actor_id,animal_link_id,pet_id,parent_context) values(p_id,p_actor,p_animal_link_id,(context->>'pet_id')::uuid,context) on conflict(run_id) do nothing;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return to_jsonb(r)||jsonb_build_object('scope','animal_attachment_metadata','parent_context',context,'animal_link_id',p_animal_link_id,'animal_external_id',context->'animal_external_id','pet_id',context->'pet_id','client_id',context->'client_id');
end $$;

revoke all on function public.claim_ezyvet_attachment_import(uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;

grant execute on function public.claim_ezyvet_attachment_import(uuid,uuid,text,text,uuid) to service_role;
