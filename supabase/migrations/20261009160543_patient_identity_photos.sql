-- Patient identity images reuse private, retained document originals.
create table public.patient_photo_uploads (
 document_id uuid primary key references public.patient_documents(id) on delete restrict,
 pet_id uuid not null references public.pets(id) on delete restrict,
 actor_id uuid not null references auth.users(id), expected_version integer not null check(expected_version>=0),
 expected_sha256 text not null check(expected_sha256 ~ '^[a-f0-9]{64}$'),
 verified_sha256 text check(verified_sha256 ~ '^[a-f0-9]{64}$'),
 object_id uuid, width integer, height integer, verified_at timestamptz,
 check((verified_at is null and verified_sha256 is null and object_id is null and width is null and height is null)
  or (verified_at is not null and verified_sha256 is not null and verified_sha256=expected_sha256 and object_id is not null and width is not null and height is not null and width between 1 and 1024 and height between 1 and 1024 and width::bigint*height<=1048576))
);
create table public.patient_photo_state (
 id uuid not null default gen_random_uuid() unique,
 pet_id uuid primary key references public.pets(id) on delete restrict,
 document_id uuid references public.patient_photo_uploads(document_id) on delete restrict,
 version integer not null default 0 check(version>=0),
 updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
create table public.patient_photo_actions (
 id uuid primary key, pet_id uuid not null references public.pets(id) on delete restrict,
 actor_id uuid not null references auth.users(id), document_id uuid references public.patient_photo_uploads(document_id) on delete restrict,
 expected_version integer not null, result_version integer not null, created_at timestamptz not null default now()
);
create index patient_photo_uploads_actor_pet on public.patient_photo_uploads(actor_id,pet_id);
create index patient_photo_actions_pet on public.patient_photo_actions(pet_id,created_at desc);
alter table public.patient_photo_uploads enable row level security;
alter table public.patient_photo_state enable row level security;
alter table public.patient_photo_actions enable row level security;
revoke all on public.patient_photo_uploads,public.patient_photo_state,public.patient_photo_actions from public,anon,authenticated,service_role;
grant select on public.patient_photo_uploads,public.patient_photo_state,public.patient_photo_actions to authenticated;
create policy "Staff read own photo reservations" on public.patient_photo_uploads for select to authenticated using(is_active_staff(auth.uid()) and actor_id=auth.uid());
create policy "Staff read current patient photo" on public.patient_photo_state for select to authenticated using(is_active_staff(auth.uid()));
create policy "Staff read photo action history" on public.patient_photo_actions for select to authenticated using(is_active_staff(auth.uid()));
create trigger audit_patient_photo_state after insert or update on public.patient_photo_state for each row execute function public.audit_trigger_fn();

create function public.read_patient_photo(p_pet_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare s patient_photo_state;d patient_documents;
begin
 perform clinical_require_staff();
 if not exists(select 1 from pets where id=p_pet_id) then raise exception 'Patient unavailable' using errcode='42501';end if;
 select * into s from patient_photo_state where pet_id=p_pet_id;
 select * into d from patient_documents where id=s.document_id and pet_id=p_pet_id and status='ready' and visibility='internal';
 return jsonb_build_object('pet_id',p_pet_id,'version',coalesce(s.version,0),'document_id',s.document_id,
  'document',case when d.id is null then null else jsonb_build_object('id',d.id,'pet_id',d.pet_id,'file_path',d.file_path,'mime_type',d.mime_type) end);
end $$;
create function public.prepare_patient_photo(p_id uuid,p_pet_id uuid,p_expected_version integer,p_sha256 text,p_file_size bigint,p_mime_type text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=clinical_require_staff();u patient_photo_uploads;d patient_documents;s patient_photo_state;
begin
 if p_expected_version is null or p_expected_version<0 or p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$'
  or p_file_size is null or p_file_size not between 1 and 5242880 or p_mime_type is null or p_mime_type<>'image/png' then
  raise exception 'A supported image of at most 5 MiB is required' using errcode='23514';end if;
 perform 1 from pets where id=p_pet_id for update;
 if not found then raise exception 'Patient unavailable' using errcode='42501';end if;
 select * into u from patient_photo_uploads where document_id=p_id;
 if found and (u.actor_id<>actor or row(u.pet_id,u.expected_version,u.expected_sha256) is distinct from row(p_pet_id,p_expected_version,p_sha256)) then
  raise exception 'Photo reservation belongs to a different request' using errcode='23514';end if;
 if u.document_id is null then
  select * into s from patient_photo_state where pet_id=p_pet_id;
  if coalesce(s.version,0)<>p_expected_version then raise exception 'Photo changed; reload before choosing another image' using errcode='PT409';end if;
 end if;
 d:=prepare_patient_document(p_id,p_pet_id,null,'patient-photo.png',p_mime_type,p_file_size,'other','Patient identity photo',null,'internal');
 insert into patient_photo_uploads(document_id,pet_id,actor_id,expected_version,expected_sha256)
 values(d.id,p_pet_id,actor,p_expected_version,p_sha256) on conflict(document_id) do nothing;
 return jsonb_build_object('document',to_jsonb(d),'expected_version',p_expected_version,'expected_sha256',p_sha256);
end $$;
create function public.read_patient_photo_upload(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=clinical_require_staff();u patient_photo_uploads;d patient_documents;
begin
 select * into u from patient_photo_uploads where document_id=p_id and actor_id=actor;
 if not found then raise exception 'Owned photo reservation required' using errcode='42501';end if;
 select * into d from patient_documents where id=p_id and pet_id=u.pet_id and created_by=actor and status in ('uploading','ready');
 if not found then raise exception 'Photo reservation unavailable' using errcode='PT409';end if;
 return jsonb_build_object('document',to_jsonb(d),'expected_version',u.expected_version,'expected_sha256',u.expected_sha256,
  'object_id',(select id from storage.objects where bucket_id='patient-documents' and name=d.file_path));
end $$;
-- Freeze an image after byte capture, even before the uploader finalizes its document.
create or replace function public.patient_document_storage_write(p_path text) returns boolean language plpgsql security definer set search_path=public as $$
declare doc patient_documents;
begin
 if auth.uid() is null or not is_active_staff(auth.uid()) then return false;end if;
 select * into doc from patient_documents where file_path=p_path for update;
 return found and doc.created_by=auth.uid() and doc.status='uploading'
  and not exists(select 1 from patient_photo_uploads where document_id=doc.id and verified_at is not null);
end $$;
create function public.verify_patient_photo_bytes(p_id uuid,p_actor_id uuid,p_object_id uuid,p_sha256 text,p_width integer,p_height integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare u patient_photo_uploads;d patient_documents;o storage.objects;
begin
 perform communication_require_service();
 if not is_active_staff(p_actor_id) then raise exception 'Active uploader required' using errcode='42501';end if;
 select * into d from patient_documents where id=p_id for update;
 select * into u from patient_photo_uploads where document_id=p_id for update;
 if u.document_id is null or u.actor_id<>p_actor_id or d.created_by<>p_actor_id or d.pet_id<>u.pet_id or d.status not in ('uploading','ready')
  or d.visibility<>'internal' or d.source<>'Patient identity photo' or d.file_size>5242880 or d.mime_type<>'image/png' then
  raise exception 'Owned private photo required' using errcode='42501';end if;
 if p_sha256 is null or p_sha256<>u.expected_sha256 or p_width is null or p_height is null
  or p_width not between 1 and 1024 or p_height not between 1 and 1024 or p_width::bigint*p_height>1048576 then
  raise exception 'Image bytes differ from the reserved photo' using errcode='23514';end if;
 select * into o from storage.objects where bucket_id='patient-documents' and name=d.file_path for share;
 if not found or p_object_id is null or o.id<>p_object_id or o.metadata->>'size' is distinct from d.file_size::text or o.metadata->>'mimetype' is distinct from d.mime_type then
  raise exception 'Stored image does not match reservation' using errcode='23514';end if;
 if u.verified_at is not null and row(u.verified_sha256,u.object_id,u.width,u.height) is distinct from row(p_sha256,o.id,p_width,p_height) then
  raise exception 'Verified image identity changed' using errcode='PT409';end if;
 update patient_photo_uploads set verified_sha256=p_sha256,object_id=o.id,width=p_width,height=p_height,verified_at=coalesce(verified_at,now()) where document_id=p_id;
 return jsonb_build_object('id',p_id,'actor_id',p_actor_id,'sha256',p_sha256,'width',p_width,'height',p_height);
end $$;
create function public.set_patient_photo(p_id uuid,p_pet_id uuid,p_document_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=clinical_require_staff();s patient_photo_state;a patient_photo_actions;u patient_photo_uploads;d patient_documents;
begin
 if p_expected_version is null or p_expected_version<0 then raise exception 'Photo version required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('patient-photo-action:'||p_id::text,927));
 select * into a from patient_photo_actions where id=p_id;
 if found then
  if row(a.actor_id,a.pet_id,a.document_id,a.expected_version) is distinct from row(actor,p_pet_id,p_document_id,p_expected_version) then
   raise exception 'Photo action identifier reused' using errcode='23505';end if;
  return jsonb_build_object('id',a.id,'pet_id',a.pet_id,'document_id',a.document_id,'version',a.result_version);
 end if;
 perform 1 from pets where id=p_pet_id for update;
 if not found then raise exception 'Patient unavailable' using errcode='42501';end if;
 insert into patient_photo_state(pet_id,version,updated_by) values(p_pet_id,0,actor) on conflict(pet_id) do nothing;
 select * into s from patient_photo_state where pet_id=p_pet_id for update;
 if s.version<>p_expected_version then raise exception 'Photo changed; reload before choosing another image' using errcode='PT409';end if;
 if p_document_id is not null then
  select * into d from patient_documents where id=p_document_id for share;
  select * into u from patient_photo_uploads where document_id=p_document_id;
  if u.document_id is null or u.pet_id<>p_pet_id or u.actor_id<>actor or u.expected_version<>p_expected_version
   or u.verified_at is null or d.pet_id<>p_pet_id or d.status<>'ready' or d.visibility<>'internal' then
   raise exception 'Verified, ready photo for this patient required' using errcode='23514';end if;
 end if;
 update patient_photo_state set document_id=p_document_id,version=version+1,updated_by=actor,updated_at=now() where pet_id=p_pet_id returning * into s;
 insert into patient_photo_actions(id,pet_id,actor_id,document_id,expected_version,result_version) values(p_id,p_pet_id,actor,p_document_id,p_expected_version,s.version) returning * into a;
 return jsonb_build_object('id',a.id,'pet_id',a.pet_id,'document_id',a.document_id,'version',a.result_version);
end $$;
revoke all on function public.read_patient_photo(uuid),public.prepare_patient_photo(uuid,uuid,integer,text,bigint,text),public.read_patient_photo_upload(uuid),public.set_patient_photo(uuid,uuid,uuid,integer),public.verify_patient_photo_bytes(uuid,uuid,uuid,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.read_patient_photo(uuid),public.prepare_patient_photo(uuid,uuid,integer,text,bigint,text),public.read_patient_photo_upload(uuid),public.set_patient_photo(uuid,uuid,uuid,integer) to authenticated;
grant execute on function public.verify_patient_photo_bytes(uuid,uuid,uuid,text,integer,integer) to service_role;
