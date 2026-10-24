-- A new administration/dispense requires exact, staff-reviewed current alert content.
create table public.treatment_alert_reviews (
 id uuid primary key default gen_random_uuid(),
 treatment_id uuid not null unique references public.patient_treatments(id) on delete restrict,
 pet_id uuid not null references public.pets(id) on delete restrict,
 snapshot jsonb not null, source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 reviewed_by uuid not null references public.profiles(id), reviewed_at timestamptz not null default now()
);
alter table public.treatment_alert_reviews enable row level security;
revoke all on public.treatment_alert_reviews from public,anon,authenticated,service_role;
grant select on public.treatment_alert_reviews to authenticated;
create policy "Active staff read treatment alert history" on public.treatment_alert_reviews for select to authenticated using(public.is_active_staff(auth.uid()));
create trigger immutable_treatment_alert_reviews before update or delete on public.treatment_alert_reviews for each row execute function public.guard_inquiry_history();
create trigger audit_treatment_alert_reviews after insert on public.treatment_alert_reviews for each row execute function public.audit_trigger_fn();

create function public.read_patient_treatment_alerts(p_pet_id uuid) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare pet public.pets;problems jsonb;snapshot jsonb;
begin
 perform public.clinical_require_staff();
 select * into pet from public.pets where id=p_pet_id for share;
 if not found then raise exception 'Patient not found; reload the patient record' using errcode='23514';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'title',title,'notes',notes,'status',status,'importance',importance,'onset_date',onset_date,'updated_at',updated_at) order by id),'[]'::jsonb)
 into problems from public.patient_problems where pet_id=p_pet_id and importance='high';
 snapshot:=jsonb_build_object('schema_version',1,'pet_id',pet.id,'patient_version',pet.version,'important_problems',problems,
  'legacy_allergies',jsonb_build_object('text',pet.allergies,'provenance','Existing patient profile allergy text; source clinician, original date and verification status are not established'));
 if octet_length(snapshot::text)>1048576 then raise exception 'Alert history is too large for this review; contact the practice administrator' using errcode='23514';end if;
 return jsonb_build_object('snapshot',snapshot,'source_hash',encode(digest(snapshot::text,'sha256'),'hex'));
end $$;
revoke all on function public.read_patient_treatment_alerts(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_patient_treatment_alerts(uuid) to authenticated;

-- The patient row serializes alert snapshots against problem insert/update/delete.
-- Allergy/profile updates already acquire the same row's exclusive lock.
create function public.lock_patient_problem_alerts() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if TG_OP='UPDATE' and NEW.pet_id is distinct from OLD.pet_id then raise exception 'Problem patient cannot change' using errcode='23514';end if;
 perform 1 from public.pets where id=case when TG_OP='DELETE' then OLD.pet_id else NEW.pet_id end for update;
 if TG_OP='DELETE' then return OLD;else return NEW;end if;
end $$;
create trigger aaa_lock_patient_problem_alerts before insert or update or delete on public.patient_problems for each row execute function public.lock_patient_problem_alerts();
revoke all on function public.lock_patient_problem_alerts() from public,anon,authenticated,service_role;

-- Patch the existing atomic procedure in place: no alternate stock/billing write entry point.
do $$declare definition text;begin
 select pg_get_functiondef('public.record_patient_treatment(uuid,jsonb)'::regprocedure) into definition;
 if position('''source'',''kind''' in definition)=0 or position('admin_at timestamptz;' in definition)=0 or position(' if historical then' in definition)=0 or position(' return result;' in definition)=0 then raise exception 'Treatment procedure definition drifted; alert review migration requires review';end if;
 definition:=replace(definition,'''source'',''kind''','''source'',''kind'',''alert_review''');
 definition:=replace(definition,'admin_at timestamptz;','admin_at timestamptz; alert_bundle jsonb;');
 definition:=replace(definition,' if historical then',
 ' if historical then
  if p_request ? ''alert_review'' then raise exception ''Historical transcription cannot claim a current-care alert review'' using errcode=''23514'';end if;
 else
  alert_bundle:=public.read_patient_treatment_alerts(pet);
  if jsonb_typeof(p_request->''alert_review'') is distinct from ''object'' or (p_request->''alert_review'')-array[''source_hash'',''acknowledged'']<>''{}'' or p_request#>''{alert_review,acknowledged}'' is distinct from ''true''::jsonb then raise exception ''Review the current patient alerts and explicitly acknowledge them before recording treatment'' using errcode=''23514'';end if;
  if p_request#>>''{alert_review,source_hash}'' is distinct from alert_bundle->>''source_hash'' then raise exception ''Patient alerts changed; reload and review the current alerts before recording treatment'' using errcode=''40001'';end if;
 end if;
 if historical then');
 -- Replace the final return only, preserving the existing committed retry return.
 if position(E'\n return result;\nend' in definition)=0 then raise exception 'Treatment return definition drifted; alert review migration requires review';end if;
 definition:=replace(definition,E'\n return result;\nend',E'\n if not historical then\n  insert into public.treatment_alert_reviews(treatment_id,pet_id,snapshot,source_hash,reviewed_by) values(result.id,pet,alert_bundle->''snapshot'',alert_bundle->>''source_hash'',actor);\n end if;\n return result;\nend');
 execute definition;
end $$;
