-- Metadata reservation and immutable private objects form a two-phase upload.
create table public.patient_documents (
 id uuid primary key, pet_id uuid not null references public.pets(id) on delete restrict,
 encounter_id uuid references public.clinical_encounters(id) on delete restrict,
 file_name text not null check (length(trim(file_name)) between 1 and 255 and file_name !~ '[[:cntrl:]/\\]'),
 file_path text not null unique, mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
 file_size bigint not null check (file_size between 1 and 20971520),
 category text not null check (category in ('medical_record','lab_result','consent','anesthesia','dental','other')),
 source text not null default '' check (length(source)<=500), document_date date,
 visibility text not null default 'internal' check (visibility in ('internal','client_shareable')),
 status text not null default 'uploading' check (status in ('uploading','ready','void','abandoned')),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), finalized_at timestamptz,
 voided_by uuid references auth.users(id), voided_at timestamptz, void_reason text, version integer not null default 1,
 check ((status in ('uploading','abandoned') and finalized_at is null) or (status in ('ready','void') and finalized_at is not null)),
 check ((status='void' and voided_by is not null and voided_at is not null and length(trim(void_reason)) between 1 and 2000) or (status<>'void' and voided_by is null and voided_at is null and void_reason is null))
);
create index patient_documents_pet_idx on public.patient_documents(pet_id,created_at desc);
alter table public.patient_documents enable row level security;
revoke all on public.patient_documents from public,anon,authenticated,service_role;
grant select on public.patient_documents to authenticated,service_role;
create policy "Staff read document history or own reservation" on public.patient_documents for select to authenticated using (public.is_active_staff(auth.uid()) and (status in ('ready','void') or created_by=auth.uid()));

create function public.guard_patient_document() returns trigger language plpgsql security definer set search_path=public as $$
declare actor uuid := public.clinical_require_staff();
begin
 if TG_OP='DELETE' then raise exception 'Document history cannot be deleted' using errcode='23514'; end if;
 if TG_OP='INSERT' then
  NEW.created_by:=actor; NEW.created_at:=now(); NEW.status:='uploading'; NEW.version:=1;
  NEW.finalized_at:=null; NEW.voided_by:=null; NEW.voided_at:=null; NEW.void_reason:=null;
  NEW.file_path:=actor::text||'/'||NEW.pet_id::text||'/'||NEW.id::text||'/original';
  if NEW.encounter_id is not null and not exists(select 1 from public.clinical_encounters where id=NEW.encounter_id and pet_id=NEW.pet_id) then raise exception 'Encounter does not belong to patient' using errcode='23514'; end if;
 else
  if (to_jsonb(NEW)-array['status','version','finalized_at','voided_by','voided_at','void_reason']) is distinct from (to_jsonb(OLD)-array['status','version','finalized_at','voided_by','voided_at','void_reason']) then raise exception 'Document metadata is immutable; upload a replacement' using errcode='23514'; end if;
  if not ((OLD.status='uploading' and NEW.status in ('ready','abandoned') and OLD.created_by=actor) or (OLD.status='ready' and NEW.status='void')) then raise exception 'Invalid document transition' using errcode='23514'; end if;
  NEW.version:=OLD.version+1;
  if NEW.status='ready' then NEW.finalized_at:=now(); end if;
  if NEW.status='void' then NEW.voided_by:=actor; NEW.voided_at:=now(); NEW.finalized_at:=OLD.finalized_at; end if;
 end if;
 return NEW;
end $$;
create trigger patient_document_guard before insert or update or delete on public.patient_documents for each row execute function public.guard_patient_document();
create trigger audit_patient_documents after insert or update on public.patient_documents for each row execute function public.audit_trigger_fn();

create function public.prepare_patient_document(p_id uuid,p_pet_id uuid,p_encounter_id uuid,p_file_name text,p_mime_type text,p_file_size bigint,p_category text,p_source text,p_document_date date,p_visibility text)
returns public.patient_documents language plpgsql security definer set search_path=public as $$
declare actor uuid := public.clinical_require_staff(); result public.patient_documents;
begin
 insert into public.patient_documents(id,pet_id,encounter_id,file_name,file_path,mime_type,file_size,category,source,document_date,visibility,created_by)
 values(p_id,p_pet_id,p_encounter_id,p_file_name,'',p_mime_type,p_file_size,p_category,coalesce(p_source,''),p_document_date,p_visibility,actor) on conflict(id) do nothing;
 select * into result from public.patient_documents where id=p_id for update;
 if result.created_by is distinct from actor then raise exception 'Document belongs to another uploader' using errcode='42501'; end if;
 if row(result.pet_id,result.encounter_id,result.file_name,result.mime_type,result.file_size,result.category,result.source,result.document_date,result.visibility) is distinct from row(p_pet_id,p_encounter_id,p_file_name,p_mime_type,p_file_size,p_category,coalesce(p_source,''),p_document_date,p_visibility) then raise exception 'Upload identifier already used with different metadata' using errcode='23514'; end if;
 if result.status not in ('uploading','ready') then raise exception 'Upload is no longer available' using errcode='23514'; end if;
 return result;
end $$;
create function public.finalize_patient_document(p_id uuid) returns public.patient_documents language plpgsql security definer set search_path=public as $$
declare actor uuid := public.clinical_require_staff(); result public.patient_documents; object_metadata jsonb;
begin
 select * into result from public.patient_documents where id=p_id for update;
 if not found or result.created_by<>actor then raise exception 'Document belongs to another uploader or does not exist' using errcode='42501'; end if;
 if result.status='ready' then return result; end if;
 if result.status<>'uploading' then raise exception 'Upload is no longer available' using errcode='23514'; end if;
 select metadata into object_metadata from storage.objects where bucket_id='patient-documents' and name=result.file_path for share;
 if not found then raise exception 'Upload the file before finalizing' using errcode='23514'; end if;
 if object_metadata->>'size' is distinct from result.file_size::text or object_metadata->>'mimetype' is distinct from result.mime_type then raise exception 'Uploaded file size or MIME type does not match reservation' using errcode='23514'; end if;
 update public.patient_documents set status='ready' where id=p_id returning * into result;
 return result;
end $$;
create function public.abandon_patient_document(p_id uuid) returns public.patient_documents language plpgsql security definer set search_path=public as $$
declare actor uuid := public.clinical_require_staff(); result public.patient_documents;
begin
 select * into result from public.patient_documents where id=p_id for update;
 if not found or result.created_by<>actor then raise exception 'Document belongs to another uploader or does not exist' using errcode='42501'; end if;
 if result.status='abandoned' then return result; end if;
 if result.status<>'uploading' then raise exception 'Only pending uploads can be abandoned' using errcode='23514'; end if;
 if exists(select 1 from storage.objects where bucket_id='patient-documents' and name=result.file_path) then raise exception 'Remove the pending file before abandoning' using errcode='23514'; end if;
 update public.patient_documents set status='abandoned' where id=p_id returning * into result;
 return result;
end $$;
create function public.void_patient_document(p_id uuid,p_expected_version integer,p_reason text) returns public.patient_documents language plpgsql security definer set search_path=public as $$
declare result public.patient_documents;
begin
 perform public.clinical_require_staff();
 if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'A void reason is required (maximum 2000 characters)' using errcode='23514'; end if;
 update public.patient_documents set status='void',void_reason=trim(p_reason) where id=p_id and version=p_expected_version and status='ready' returning * into result;
 if not found then raise exception 'Record changed or no longer exists; reload before voiding' using errcode='40001'; end if;
 return result;
end $$;
-- Row locks serialize storage writes with finalization/abandonment. No overwrite policy exists.
create function public.patient_document_storage_write(p_path text) returns boolean language plpgsql security definer set search_path=public as $$
declare doc public.patient_documents;
begin
 if auth.uid() is null or not public.is_active_staff(auth.uid()) then return false; end if;
 select * into doc from public.patient_documents where file_path=p_path for update;
 return found and doc.created_by=auth.uid() and doc.status='uploading';
end $$;
create function public.patient_document_storage_read(p_path text) returns boolean language sql stable security definer set search_path=public as $$
 select public.is_active_staff(auth.uid()) and exists(select 1 from public.patient_documents where file_path=p_path and (status in ('ready','void') or (status='uploading' and created_by=auth.uid())))
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('patient-documents','patient-documents',false,20971520,array['application/pdf','image/jpeg','image/png']);
create policy "Read authorized patient document" on storage.objects for select to authenticated using(bucket_id='patient-documents' and public.patient_document_storage_read(name));
create policy "Upload reserved patient document" on storage.objects for insert to authenticated with check(bucket_id='patient-documents' and public.patient_document_storage_write(name));
create policy "Remove own pending patient document" on storage.objects for delete to authenticated using(bucket_id='patient-documents' and public.patient_document_storage_write(name));
revoke all on function public.guard_patient_document() from public,anon,authenticated,service_role;
revoke all on function public.prepare_patient_document(uuid,uuid,uuid,text,text,bigint,text,text,date,text) from public,anon,authenticated,service_role;
revoke all on function public.finalize_patient_document(uuid) from public,anon,authenticated,service_role;
revoke all on function public.abandon_patient_document(uuid) from public,anon,authenticated,service_role;
revoke all on function public.void_patient_document(uuid,integer,text) from public,anon,authenticated,service_role;
revoke all on function public.patient_document_storage_write(text) from public,anon,authenticated,service_role;
revoke all on function public.patient_document_storage_read(text) from public,anon,authenticated,service_role;
grant execute on function public.prepare_patient_document(uuid,uuid,uuid,text,text,bigint,text,text,date,text),public.finalize_patient_document(uuid),public.abandon_patient_document(uuid),public.void_patient_document(uuid,integer,text),public.patient_document_storage_write(text),public.patient_document_storage_read(text) to authenticated;
