-- General certificates now include the exact due-plan snapshot reviewed at issuance.
-- Historical version-1 certificates and rabies certificates retain their original meaning.
alter function public.preview_vaccine_certificate(uuid,text,uuid,jsonb) rename to preview_vaccine_certificate_v1_internal;
revoke all on function public.preview_vaccine_certificate_v1_internal(uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.preview_vaccine_certificate(p_pet_id uuid,p_kind text,p_rabies_treatment_id uuid,p_details jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare snapshot jsonb;plans jsonb;
begin
 if p_kind='vaccine_history' and p_details is distinct from '{"due_plan_review_version":2}'::jsonb then
  raise exception 'Refresh the certificate workspace to review patient due plans before signing' using errcode='23514';
 end if;
 snapshot=public.preview_vaccine_certificate_v1_internal(p_pet_id,p_kind,p_rabies_treatment_id,case when p_kind='vaccine_history' then '{}'::jsonb else p_details end);
 if p_kind='rabies' then return snapshot;end if;
 -- One aggregate captures all nonretired plans, including explicit gaps awaiting review.
 -- Names and dates come from the reviewed plan, never guessed from vaccine brand names.
 select coalesce(jsonb_agg(jsonb_build_object(
  'plan_id',v.id,'plan_version',v.version,'group_key',v.group_key,
  'group_name',v.template_snapshot->>'name','template_id',v.template_id,'template_version',v.template_version,
  'product_id',v.product_id,'treatment_id',v.treatment_id,'last_administered_on',v.last_administered_on,
  'status',v.status,'reviewed_due_on',case when v.status='current' then v.current_due_on else null end
 ) order by v.group_key,v.id),'[]'::jsonb) into plans
 from public.patient_vaccine_due_plans v where v.pet_id=p_pet_id and v.status<>'retired';
 return snapshot||jsonb_build_object('schema_version',2,'due_plans',plans);
end $$;
revoke all on function public.preview_vaccine_certificate(uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.preview_vaccine_certificate(uuid,text,uuid,jsonb) to authenticated;
create or replace function public.issue_vaccine_certificate(p_id uuid,p_pet_id uuid,p_kind text,p_rabies_treatment_id uuid,p_details jsonb,p_reviewed_snapshot jsonb,p_signature_name text,p_attest_review boolean,p_replaces_id uuid default null,p_reason text default null) returns public.vaccine_certificates language plpgsql security definer set search_path=public as $$
declare issuer public.certificate_issuers:=public.certificate_require_issuer(); result public.vaccine_certificates; expected jsonb; request_data jsonb; prior public.vaccine_certificates;
begin
 if p_id is null or p_attest_review is distinct from true or p_signature_name is distinct from issuer.full_name then raise exception 'Explicit review and matching typed veterinarian signature are required' using errcode='23514'; end if;
 request_data:=jsonb_build_object('pet_id',p_pet_id,'kind',p_kind,'rabies_treatment_id',p_rabies_treatment_id,'details',p_details,'reviewed_snapshot',p_reviewed_snapshot,'signature_name',p_signature_name,'attest_review',p_attest_review,'replaces_id',p_replaces_id,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,8));
 select * into result from public.vaccine_certificates where id=p_id;
 if found then
  if result.issued_by<>auth.uid() or result.request is distinct from request_data then raise exception 'Certificate identifier already used' using errcode='23514'; end if;
  return result;
 end if;
 expected:=public.preview_vaccine_certificate(p_pet_id,p_kind,p_rabies_treatment_id,p_details);
 if expected is distinct from p_reviewed_snapshot then raise exception 'Certificate details changed; reload and review before issuing' using errcode='40001'; end if;
 if p_replaces_id is not null then
  select * into prior from public.vaccine_certificates where id=p_replaces_id for update;
  if not found or prior.pet_id<>p_pet_id or prior.kind<>p_kind or length(trim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception 'Reissue requires matching patient, certificate type and reason' using errcode='23514'; end if;
  if exists(select 1 from public.vaccine_certificate_events where certificate_id=p_replaces_id and kind='superseded') then raise exception 'Certificate already reissued; reload its successor' using errcode='40001'; end if;
 elsif p_reason is not null then raise exception 'Reason requires a certificate being replaced' using errcode='23514'; end if;
 insert into public.vaccine_certificates(id,pet_id,kind,snapshot,request,replaces_id,issued_by,signature_name,attestation) values(p_id,p_pet_id,p_kind,expected,request_data,p_replaces_id,auth.uid(),p_signature_name,case when p_kind='rabies' then 'I reviewed this complete certificate and its due date, confirm this was a rabies vaccine administered by me or under my supervision by the named administrator trained in vaccine storage, handling, administration and adverse-event management, and explicitly sign this certificate.' else 'I reviewed the patient identity, included vaccination history and the patient due-plan snapshot, including any plans awaiting review, and explicitly sign this certificate. The reviewed plan dates apply to this snapshot at issuance; no vaccine equivalence or due date was inferred. This is not a rabies certificate.' end) returning * into result;
 insert into public.vaccine_certificate_treatments(certificate_id,treatment_id) select p_id,(v->>'treatment_id')::uuid from jsonb_array_elements(expected->'vaccinations') v;
 if p_replaces_id is not null then insert into public.vaccine_certificate_events(id,certificate_id,kind,reason,replacement_id,created_by) values(p_id,p_replaces_id,'superseded',trim(p_reason),p_id,auth.uid()); end if;
 return result;
end $$;
