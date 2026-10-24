-- Rabies certificates record the vaccine serial number separately from the stock lot number.
-- The serial is a clinician-reviewed certificate statement (like the tag number), never inferred from the lot.
-- New rabies previews always carry details.vaccine_serial_number (string or null) so renderers can tell
-- new snapshots from earlier ones; issued certificates keep their original snapshot unchanged.
alter function public.preview_vaccine_certificate(uuid,text,uuid,jsonb) rename to preview_vaccine_certificate_v2_internal;
revoke all on function public.preview_vaccine_certificate_v2_internal(uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.preview_vaccine_certificate(p_pet_id uuid,p_kind text,p_rabies_treatment_id uuid,p_details jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare serial jsonb; snapshot jsonb;
begin
 if p_kind is distinct from 'rabies' or p_details is null or jsonb_typeof(p_details)<>'object' then
  return public.preview_vaccine_certificate_v2_internal(p_pet_id,p_kind,p_rabies_treatment_id,p_details);
 end if;
 serial:=coalesce(p_details->'vaccine_serial_number','null'::jsonb);
 if jsonb_typeof(serial) not in ('string','null') then raise exception 'Invalid certificate detail type' using errcode='23514'; end if;
 if jsonb_typeof(serial)='string' then
  if length(p_details->>'vaccine_serial_number')>200 then raise exception 'Vaccine serial number is too long' using errcode='23514'; end if;
  serial:=case when trim(p_details->>'vaccine_serial_number')='' then 'null'::jsonb else to_jsonb(trim(p_details->>'vaccine_serial_number')) end;
 end if;
 snapshot:=public.preview_vaccine_certificate_v2_internal(p_pet_id,p_kind,p_rabies_treatment_id,p_details-'vaccine_serial_number');
 return jsonb_set(snapshot,'{details,vaccine_serial_number}',serial,true);
end $$;
revoke all on function public.preview_vaccine_certificate(uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.preview_vaccine_certificate(uuid,text,uuid,jsonb) to authenticated;
