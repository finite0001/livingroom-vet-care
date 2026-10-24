-- No credentials are seeded. A trusted operator must verify the veterinarian's
-- current license and obtain clinical acceptance before enabling issuance.
create table public.certificate_issuers (
 id uuid not null unique default gen_random_uuid(), user_id uuid primary key references auth.users(id), full_name text not null check(length(trim(full_name)) between 1 and 200),
 license_number text not null check(length(trim(license_number)) between 1 and 100), license_state text not null check(license_state='CO'),
 license_expires_on date not null check(isfinite(license_expires_on)),
 practice_name text not null check(length(trim(practice_name)) between 1 and 200),
 practice_address text not null check(length(trim(practice_address)) between 1 and 1000),
 practice_phone text not null check(length(trim(practice_phone)) between 1 and 100),
 verified_at timestamptz not null check(isfinite(verified_at)), verification_reference text not null check(length(trim(verification_reference)) between 1 and 1000),
 clinical_acceptance_at timestamptz not null check(isfinite(clinical_acceptance_at)), active boolean not null default false
);
create table public.vaccine_certificates (
 id uuid primary key, pet_id uuid not null references public.pets(id) on delete restrict,
 kind text not null check(kind in ('vaccine_history','rabies')), snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 request jsonb not null, replaces_id uuid references public.vaccine_certificates(id) on delete restrict,
 issued_by uuid not null references auth.users(id), issued_at timestamptz not null default now(),
 signature_name text not null, attestation text not null
);
create table public.vaccine_certificate_treatments (
 id uuid not null unique default gen_random_uuid(), certificate_id uuid not null references public.vaccine_certificates(id) on delete restrict,
 treatment_id uuid not null references public.patient_treatments(id) on delete restrict, primary key(certificate_id,treatment_id)
);
create table public.vaccine_certificate_events (
 id uuid primary key, certificate_id uuid not null references public.vaccine_certificates(id) on delete restrict,
 kind text not null check(kind in ('void','superseded','treatment_corrected')),
 reason text not null check(length(trim(reason)) between 1 and 2000),
 replacement_id uuid references public.vaccine_certificates(id) on delete restrict,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index vaccine_certificates_pet_idx on public.vaccine_certificates(pet_id,issued_at desc,id);
create index vaccine_certificate_treatments_treatment_idx on public.vaccine_certificate_treatments(treatment_id);
create index vaccine_certificate_events_certificate_idx on public.vaccine_certificate_events(certificate_id);
create function public.certificate_immutable() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Certificate history is immutable; void or reissue with a reason' using errcode='23514'; end $$;
do $$ declare t text; begin
 foreach t in array array['certificate_issuers','vaccine_certificates','vaccine_certificate_treatments','vaccine_certificate_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated,service_role',t);
  execute format('create policy "Active staff read certificates" on public.%I for select to authenticated using(public.is_active_staff(auth.uid()))',t);
  execute format('create trigger certificate_audit after insert or update or delete on public.%I for each row execute function public.audit_trigger_fn()',t);
  if t<>'certificate_issuers' then
   execute format('create trigger certificate_immutable before update or delete on public.%I for each row execute function public.certificate_immutable()',t);
  end if;
 end loop;
end $$;
create function public.certificate_require_issuer() returns public.certificate_issuers language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); issuer public.certificate_issuers;
begin
 if not exists(select 1 from public.user_roles where user_id=actor and role='DVM') then raise exception 'Certificate issuance requires an authorized veterinarian' using errcode='42501'; end if;
 select * into issuer from public.certificate_issuers where user_id=actor and active and license_expires_on>=(now() at time zone 'America/Denver')::date and verified_at<=now() and clinical_acceptance_at<=now() for share;
 if not found then raise exception 'Verified veterinarian credentials and clinical acceptance are required' using errcode='42501'; end if;
 return issuer;
end $$;
-- Supplemental fields are clinician-reviewed statements, never inferred from the recorder.
-- Caller must present this exact preview again at issue; changes require a fresh review.
create function public.preview_vaccine_certificate(p_pet_id uuid,p_kind text,p_rabies_treatment_id uuid,p_details jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare issuer public.certificate_issuers:=public.certificate_require_issuer(); pet public.pets; owner public.clients; t public.patient_treatments; vaccines jsonb:='[]'; k text; address text;
begin
 if p_kind is null or p_kind not in ('vaccine_history','rabies') or p_details is null or jsonb_typeof(p_details)<>'object' or octet_length(p_details::text)>12000 then raise exception 'Invalid certificate request' using errcode='23514'; end if;
 for k in select jsonb_object_keys(p_details) loop
  if k not in ('administrator','rabies_tag_number','usda_duration','vaccine_type','owner_business_phone','owner_business_phone_unavailable','size_description','initial_or_booster','supervision_attested') or jsonb_typeof(p_details->k) not in ('string','boolean') or length(p_details->>k)>1000 then raise exception 'Unsupported certificate detail' using errcode='23514'; end if;
  if (k in ('owner_business_phone_unavailable','supervision_attested') and jsonb_typeof(p_details->k)<>'boolean') or (k not in ('owner_business_phone_unavailable','supervision_attested') and jsonb_typeof(p_details->k)<>'string') then raise exception 'Invalid certificate detail type' using errcode='23514'; end if;
 end loop;
 select * into pet from public.pets where id=p_pet_id for share;
 if not found then raise exception 'Patient not found' using errcode='23514'; end if;
 select * into owner from public.clients where id=pet.client_id for share;
 address:=coalesce(nullif(trim(owner.mailing_address),''),nullif(trim(owner.housecall_address),''));
 if nullif(trim(owner.full_name),'') is null or address is null or nullif(trim(owner.primary_phone),'') is null then raise exception 'Owner name, address and phone are required' using errcode='23514'; end if;
 if p_kind='rabies' then
  if p_rabies_treatment_id is null or nullif(trim(pet.breed),'') is null or nullif(trim(pet.color),'') is null or pet.dob is null or pet.birth_date_precision='unknown' or pet.sex='unknown' or pet.neuter_status='unknown' then raise exception 'Rabies certificate requires reviewed patient identity, birth date, sex and sterilization status' using errcode='23514'; end if;
  foreach k in array array['administrator','usda_duration','vaccine_type','size_description','initial_or_booster'] loop
   if jsonb_typeof(p_details->k) is distinct from 'string' or nullif(trim(p_details->>k),'') is null then raise exception 'Required rabies detail missing: %',k using errcode='23514'; end if;
  end loop;
  if p_details->>'usda_duration' not in ('1 year','3 years','other licensed duration') or p_details->>'initial_or_booster' not in ('initial','booster') or (p_details->'supervision_attested') is distinct from 'true'::jsonb then raise exception 'Review rabies product duration, dose sequence and administering supervision' using errcode='23514'; end if;
  if lower(pet.species)='dog' and nullif(trim(p_details->>'rabies_tag_number'),'') is null then raise exception 'Dog rabies tag number is required' using errcode='23514'; end if;
  if nullif(trim(p_details->>'owner_business_phone'),'') is null and p_details->'owner_business_phone_unavailable' is distinct from 'true'::jsonb then raise exception 'Record business phone or explicitly confirm unavailable' using errcode='23514'; end if;
 elsif p_rabies_treatment_id is not null or p_details<>'{}'::jsonb then raise exception 'General history does not accept rabies-only details' using errcode='23514'; end if;
 -- Lock the same treatment rows locked by correction RPCs, in stable order.
 for t in select * from public.patient_treatments where pet_id=p_pet_id and kind='vaccine' and (p_kind='vaccine_history' or id=p_rabies_treatment_id) order by id for update loop
  if exists(select 1 from public.patient_treatment_corrections where treatment_id=t.id) then
   if p_kind='rabies' then raise exception 'Corrected vaccination cannot be certified' using errcode='23514'; end if;
   continue;
  end if;
  if p_kind='rabies' then
   if t.administered_at>now() then raise exception 'A future administration cannot be certified' using errcode='23514'; end if;
   if pet.dob>(t.administered_at at time zone 'America/Denver')::date then raise exception 'Patient birth date follows administration date' using errcode='23514'; end if;
   if t.historical then raise exception 'Imported history cannot issue a new rabies certificate; retain the original external certificate' using errcode='23514'; end if;
   if t.veterinarian<>issuer.full_name or t.veterinarian_license<>issuer.license_number then raise exception 'Rabies issuer must match the administering or supervising veterinarian on the treatment' using errcode='23514'; end if;
   if nullif(trim(t.manufacturer),'') is null or nullif(trim(t.lot_number),'') is null or nullif(trim(t.site),'') is null or t.expires_on is null or t.next_due_on is null or t.expires_on<(t.administered_at at time zone 'America/Denver')::date then raise exception 'Rabies vaccine manufacturer, lot, valid expiry, site and reviewed due date are required' using errcode='23514'; end if;
  end if;
  vaccines:=vaccines||jsonb_build_array(jsonb_build_object('treatment_id',t.id,'historical',t.historical,'product_name',t.product_name,'manufacturer',t.manufacturer,'lot_number',t.lot_number,'lot_expires_on',t.expires_on,'dose',t.dose,'route',t.route,'site',t.site,'veterinarian',t.veterinarian,'veterinarian_license',t.veterinarian_license,'administered_on',(t.administered_at at time zone 'America/Denver')::date,'next_due_on',t.next_due_on,'source',t.source,'age_at_administration',case when pet.dob is not null then age((t.administered_at at time zone 'America/Denver')::date,pet.dob)::text else null end));
 end loop;
 if jsonb_array_length(vaccines)=0 then raise exception 'No eligible vaccination records' using errcode='23514'; end if;
 return jsonb_build_object('schema_version',1,'kind',p_kind,'patient',jsonb_build_object('id',pet.id,'name',pet.name,'species',pet.species,'breed',pet.breed,'dob',pet.dob,'birth_date_precision',pet.birth_date_precision,'color',pet.color,'sex',pet.sex,'neuter_status',pet.neuter_status,'microchip_id',pet.microchip_id),'owner',jsonb_build_object('id',owner.id,'name',owner.full_name,'address',address,'phone',owner.primary_phone),'issuer',jsonb_build_object('user_id',issuer.user_id,'full_name',issuer.full_name,'license_number',issuer.license_number,'license_state',issuer.license_state,'practice_name',issuer.practice_name,'practice_address',issuer.practice_address,'practice_phone',issuer.practice_phone),'vaccinations',vaccines,'details',p_details);
end $$;
create function public.issue_vaccine_certificate(p_id uuid,p_pet_id uuid,p_kind text,p_rabies_treatment_id uuid,p_details jsonb,p_reviewed_snapshot jsonb,p_signature_name text,p_attest_review boolean,p_replaces_id uuid default null,p_reason text default null) returns public.vaccine_certificates language plpgsql security definer set search_path=public as $$
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
 insert into public.vaccine_certificates(id,pet_id,kind,snapshot,request,replaces_id,issued_by,signature_name,attestation) values(p_id,p_pet_id,p_kind,expected,request_data,p_replaces_id,auth.uid(),p_signature_name,case when p_kind='rabies' then 'I reviewed this complete certificate and its due date, confirm this was a rabies vaccine administered by me or under my supervision by the named administrator trained in vaccine storage, handling, administration and adverse-event management, and explicitly sign this certificate.' else 'I reviewed the patient identity, all included vaccine records and their recorded due dates, and explicitly sign this vaccine history certificate. This is not a rabies certificate or an automatically calculated schedule.' end) returning * into result;
 insert into public.vaccine_certificate_treatments(certificate_id,treatment_id) select p_id,(v->>'treatment_id')::uuid from jsonb_array_elements(expected->'vaccinations') v;
 if p_replaces_id is not null then insert into public.vaccine_certificate_events(id,certificate_id,kind,reason,replacement_id,created_by) values(p_id,p_replaces_id,'superseded',trim(p_reason),p_id,auth.uid()); end if;
 return result;
end $$;
create function public.void_vaccine_certificate(p_id uuid,p_certificate_id uuid,p_reason text) returns public.vaccine_certificate_events language plpgsql security definer set search_path=public as $$
declare issuer public.certificate_issuers:=public.certificate_require_issuer(); result public.vaccine_certificate_events;
begin
 if p_id is null or length(trim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception 'A reason is required' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,8));
 select * into result from public.vaccine_certificate_events where id=p_id;
 if found then
  if row(result.certificate_id,result.kind,result.reason,result.created_by) is distinct from row(p_certificate_id,'void'::text,trim(p_reason),auth.uid()) then raise exception 'Certificate event identifier already used' using errcode='23514'; end if;
  return result;
 end if;
 perform 1 from public.vaccine_certificates where id=p_certificate_id for update;
 if not found then raise exception 'Certificate not found' using errcode='23514'; end if;
 insert into public.vaccine_certificate_events(id,certificate_id,kind,reason,created_by) values(p_id,p_certificate_id,'void',trim(p_reason),auth.uid()) returning * into result;
 return result;
end $$;
create function public.invalidate_corrected_vaccine_certificates() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.vaccine_certificate_events(id,certificate_id,kind,reason,created_by)
 select gen_random_uuid(),certificate_id,'treatment_corrected','Underlying treatment corrected: '||left(NEW.reason,1900),NEW.created_by from public.vaccine_certificate_treatments where treatment_id=NEW.treatment_id;
 return NEW;
end $$;
create trigger invalidate_corrected_certificates after insert on public.patient_treatment_corrections for each row execute function public.invalidate_corrected_vaccine_certificates();
revoke all on function public.certificate_immutable(),public.certificate_require_issuer(),public.invalidate_corrected_vaccine_certificates() from public,anon,authenticated,service_role;
revoke all on function public.preview_vaccine_certificate(uuid,text,uuid,jsonb),public.issue_vaccine_certificate(uuid,uuid,text,uuid,jsonb,jsonb,text,boolean,uuid,text),public.void_vaccine_certificate(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.preview_vaccine_certificate(uuid,text,uuid,jsonb),public.issue_vaccine_certificate(uuid,uuid,text,uuid,jsonb,jsonb,text,boolean,uuid,text),public.void_vaccine_certificate(uuid,uuid,text) to authenticated;
-- One statement gives the print caller a coherent certificate + invalidation history.
create function public.read_vaccine_certificate(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 perform public.clinical_require_staff();
 select jsonb_build_object('certificate',to_jsonb(c)-'request','events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from public.vaccine_certificate_events e where e.certificate_id=c.id),'[]'::jsonb)) into result from public.vaccine_certificates c where c.id=p_id;
 if result is null then raise exception 'Certificate not found' using errcode='23514'; end if;
 return result;
end $$;
revoke all on function public.read_vaccine_certificate(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_vaccine_certificate(uuid) to authenticated;
