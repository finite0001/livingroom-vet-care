-- Additive hardening after deployed schema8 migration6300. Never rewrite that receipt.
-- Preserve canonical currentness and all observed consultation/item source locks.
create or replace function public.ezyvet_validate_reviewed_prescriptions(p_pet_id uuid,p_sources jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare rowrecord record;x jsonb;selected_prescription public.ezyvet_imported_prescriptions;result jsonb:='[]';begin
 -- Validate shape before any UUID cast; JSON nulls must fail explicitly.
 if p_pet_id is null or p_sources is null or jsonb_typeof(p_sources)<>'array' then raise exception 'Choose distinct reviewed prescriptions' using errcode='23514';end if;
 if jsonb_array_length(p_sources) not between 1 and 20 then raise exception 'Choose distinct reviewed prescriptions' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_sources) ref where jsonb_typeof(ref) is distinct from 'object' or not(ref ?& array['id','version_hash']) or (ref-'id'-'version_hash')<>'{}'::jsonb or jsonb_typeof(ref->'id') is distinct from 'string' or ref->>'id' !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' or jsonb_typeof(ref->'version_hash') is distinct from 'string' or ref->>'version_hash' !~ '^[a-f0-9]{64}$') then raise exception 'Exact prescription version references required' using errcode='23514';end if;
 if(select count(*)<>count(distinct(value->>'id')::uuid) from jsonb_array_elements(p_sources)) then raise exception 'Choose distinct reviewed prescriptions' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 for rowrecord in select distinct m.id from public.ezyvet_imported_prescriptions v join public.ezyvet_record_links m on m.id=v.animal_link_id where v.pet_id=p_pet_id and v.id in(select(value->>'id')::uuid from jsonb_array_elements(p_sources)) order by m.id loop perform 1 from public.ezyvet_record_links where id=rowrecord.id for share;end loop;
 perform 1 from public.pets where id=p_pet_id for share;
 for rowrecord in select distinct h.source_origin,h.source_site_uid,h.resource,h.external_id from public.ezyvet_imported_prescriptions v join public.ezyvet_identity_heads h on h.source_origin=v.source_origin and h.source_site_uid=v.source_site_uid and((h.resource='consult' and h.external_id=v.context#>>'{consult,reference}') or(h.resource='prescription' and h.external_id=v.prescription_external_id) or(h.resource='prescriptionitem' and exists(select 1 from jsonb_array_elements(v.context->'items') i where i->>'external_id'=h.external_id))) where v.pet_id=p_pet_id and v.id in(select(value->>'id')::uuid from jsonb_array_elements(p_sources)) order by 1,2,3,4 loop
  perform 1 from public.ezyvet_identity_heads where source_origin=rowrecord.source_origin and source_site_uid=rowrecord.source_site_uid and resource=rowrecord.resource and external_id=rowrecord.external_id for share;
 end loop;
 for x in select value from jsonb_array_elements(p_sources) order by value->>'id' loop
  select * into selected_prescription from public.ezyvet_imported_prescriptions where id=(x->>'id')::uuid;
  if not found or selected_prescription.pet_id is distinct from p_pet_id or selected_prescription.version_hash is distinct from x->>'version_hash' or public.ezyvet_prescription_current(selected_prescription.id)->>'is_current' is distinct from 'true' or public.ezyvet_prescription_current(selected_prescription.id)->>'is_latest' is distinct from 'true' then raise exception 'Current latest same-patient reviewed prescription required' using errcode='40001';end if;
  result:=result||jsonb_build_array(public.ezyvet_imported_prescription_projection(selected_prescription.id));
 end loop;return result;end $$;
revoke all on function public.ezyvet_validate_reviewed_prescriptions(uuid,jsonb) from public,anon,authenticated,service_role;
