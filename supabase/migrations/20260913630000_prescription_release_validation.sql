-- Private validation for explicitly selected immutable prescription versions.
-- Export composition calls this under the same patient lock as clinical approval.
create function public.ezyvet_validate_reviewed_prescriptions(p_pet_id uuid,p_sources jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare locked record;ref jsonb;selected public.ezyvet_imported_prescriptions;result jsonb:='[]';
begin
 if p_pet_id is null or p_sources is null or jsonb_typeof(p_sources)<>'array' then
  raise exception 'Choose distinct reviewed prescriptions' using errcode='23514';
 end if;
 if jsonb_array_length(p_sources) not between 1 and 20 then
  raise exception 'Choose between 1 and 20 reviewed prescriptions' using errcode='23514';
 end if;
 -- Validate shape before UUID casts, including explicit JSON nulls.
 if exists(select 1 from jsonb_array_elements(p_sources) r where
  jsonb_typeof(r) is distinct from 'object' or not(r ?& array['id','version_hash'])
  or (r-'id'-'version_hash')<>'{}'::jsonb
  or jsonb_typeof(r->'id') is distinct from 'string'
  or r->>'id' !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
  or jsonb_typeof(r->'version_hash') is distinct from 'string'
  or r->>'version_hash' !~ '^[a-f0-9]{64}$') then
  raise exception 'Exact prescription version references required' using errcode='23514';
 end if;
 if (select count(*)<>count(distinct(r->>'id')::uuid) from jsonb_array_elements(p_sources) r) then
  raise exception 'Choose distinct reviewed prescriptions' using errcode='23514';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 -- Immutable approvals need no intake-run lock: no mutable run is consulted.
 -- Mapping/patient locks precede canonical source-head locks, as in intake.
 for locked in select distinct v.animal_link_id from public.ezyvet_imported_prescriptions v
  where v.pet_id=p_pet_id and v.id in(select(r->>'id')::uuid from jsonb_array_elements(p_sources) r)
  order by v.animal_link_id loop
  perform 1 from public.ezyvet_record_links where id=locked.animal_link_id for share;
 end loop;
 perform 1 from public.pets where id=p_pet_id for share;
 for locked in
  select distinct h.source_origin,h.source_site_uid,h.resource,h.external_id
  from public.ezyvet_imported_prescriptions v join public.ezyvet_identity_heads h
   on h.source_origin=v.source_origin and h.source_site_uid=v.source_site_uid and (
    (h.resource='prescription' and h.external_id=v.prescription_external_id)
    or (h.resource='consult' and v.context#>>'{consult,status}'='resolved' and h.external_id=v.context#>>'{consult,reference}')
    or (h.resource='prescriptionitem' and exists(select 1 from jsonb_array_elements(v.context->'items') item where item->>'external_id'=h.external_id)))
  where v.pet_id=p_pet_id and v.id in(select(r->>'id')::uuid from jsonb_array_elements(p_sources) r)
  order by h.source_origin,h.source_site_uid,h.resource,h.external_id loop
  perform 1 from public.ezyvet_identity_heads where source_origin=locked.source_origin
   and source_site_uid=locked.source_site_uid and resource=locked.resource and external_id=locked.external_id for share;
 end loop;
 for ref in select value from jsonb_array_elements(p_sources) order by (value->>'id')::uuid loop
  select * into selected from public.ezyvet_imported_prescriptions where id=(ref->>'id')::uuid;
  if not found or selected.pet_id is distinct from p_pet_id
   or selected.version_hash is distinct from ref->>'version_hash'
   or not coalesce(public.ezyvet_prescription_current(selected.id) @> '{"is_current":true,"is_latest":true,"identity_valid":true}'::jsonb,false) then
   raise exception 'Current latest same-patient reviewed prescription required' using errcode='40001';
  end if;
  -- Frozen catalog matches and every observed item (including omissions) survive.
  result:=result||jsonb_build_array(public.ezyvet_imported_prescription_projection(selected.id));
 end loop;
 return result;
end $$;
revoke all on function public.ezyvet_validate_reviewed_prescriptions(uuid,jsonb) from public,anon,authenticated,service_role;
