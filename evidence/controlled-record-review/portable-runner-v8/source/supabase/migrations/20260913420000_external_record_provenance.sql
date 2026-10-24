-- Reviewed manual exports only: no ezyVet payload interpretation, provider signature or transport.
create table public.external_record_receipts (
 id uuid primary key,actor_id uuid not null references auth.users(id),animal_link_id uuid not null references public.ezyvet_record_links(id),
 pet_id uuid not null references public.pets(id),pet_version integer not null,source_origin text not null,source_site_uid text not null,source_animal_id text not null,
 document_id uuid not null references public.patient_documents(id),document_version integer not null,mime_type text not null,file_size bigint not null,
 export_reference text not null,received_at timestamptz not null,previous_record_id uuid,review_reason text not null,receipt_hash text not null,
 entry_method text not null default 'staff_reviewed_manual_export_v1' check(entry_method='staff_reviewed_manual_export_v1'),created_at timestamptz not null default now()
);
create table public.external_record_byte_captures (
 receipt_id uuid primary key references public.external_record_receipts(id),actor_id uuid not null references auth.users(id),receipt_hash text not null,document_version integer not null,
 content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),file_size bigint not null,mime_type text not null,capture_hash text not null,captured_at timestamptz not null default now()
);
create table public.external_record_versions (
 id uuid primary key,actor_id uuid not null references auth.users(id),receipt_id uuid not null unique references public.external_record_receipts(id),
 animal_link_id uuid not null references public.ezyvet_record_links(id),pet_id uuid not null references public.pets(id),pet_version integer not null,
 document_id uuid not null unique references public.patient_documents(id),document_version integer not null,receipt_hash text not null,capture_hash text not null,
 export_reference text not null,previous_record_id uuid references public.external_record_versions(id),version integer not null,kind text not null check(kind in ('original','replacement')),
 review_reason text not null,created_at timestamptz not null default now(),unique(animal_link_id,export_reference,version)
);
alter table public.external_record_receipts add foreign key(previous_record_id) references public.external_record_versions(id);
create table public.external_record_acknowledgments (
 id uuid primary key,actor_id uuid not null references auth.users(id),record_id uuid not null references public.external_record_versions(id),capture_hash text not null,document_version integer not null,
 created_at timestamptz not null default now(),unique(record_id,actor_id)
);
create index external_record_receipts_actor_patient_cursor on public.external_record_receipts(actor_id,pet_id,created_at desc,id desc);
create index external_record_versions_patient_cursor on public.external_record_versions(pet_id,created_at desc,id desc);
create function public.external_record_immutable() returns trigger language plpgsql set search_path=public as $$begin raise exception 'External record history is append-only' using errcode='23514';end $$;
revoke all on function public.external_record_immutable() from public,anon,authenticated,service_role;
do $$declare t text;begin foreach t in array array['external_record_receipts','external_record_byte_captures','external_record_versions','external_record_acknowledgments'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger immutable_external_record before update or delete on public.%I for each row execute function public.external_record_immutable()',t);
 end loop;end $$;
create function public.stage_external_record_receipt(p_id uuid,p_animal_link_id uuid,p_expected_pet_version integer,p_document_id uuid,p_document_version integer,p_export_reference text,p_received_at timestamptz,p_previous_record_id uuid,p_review_reason text) returns public.external_record_receipts language plpgsql security definer set search_path=public,extensions as $$
declare actor uuid:=public.clinical_require_staff();r public.external_record_receipts;m public.ezyvet_record_links;d public.patient_documents;p public.pets;prior uuid;fingerprint text;
begin
 if not public.ezyvet_is_active_admin(actor) then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_export_reference is null or length(trim(p_export_reference)) not between 1 and 500 or p_review_reason is null or length(trim(p_review_reason)) not between 1 and 2000 or p_received_at is null or not isfinite(p_received_at) or p_received_at>clock_timestamp() then raise exception 'Explicit manual export provenance required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,4200));
 select * into r from public.external_record_receipts where id=p_id;
 if found then
 if row(r.actor_id,r.animal_link_id,r.pet_version,r.document_id,r.document_version,r.export_reference,r.received_at,r.previous_record_id,r.review_reason) is distinct from row(actor,p_animal_link_id,p_expected_pet_version,p_document_id,p_document_version,p_export_reference,p_received_at,p_previous_record_id,p_review_reason) then raise exception 'Receipt UUID already used' using errcode='23505';end if;return r;end if;
 select * into m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal' for update;
 if not found then raise exception 'Approved ezyVet animal mapping required' using errcode='42501';end if;
 select * into p from public.pets where id=m.pet_id and client_id=m.client_id for share;
 if not found or p.version is distinct from p_expected_pet_version then raise exception 'Mapped patient changed; review again' using errcode='40001';end if;
 select * into d from public.patient_documents where id=p_document_id and pet_id=p.id and status='ready' and version=p_document_version and category='medical_record' for share;
 if not found then raise exception 'Same-patient ready medical record and exact version required' using errcode='42501';end if;
 select id into prior from public.external_record_versions where animal_link_id=m.id and export_reference=p_export_reference order by version desc limit 1;
 if prior is distinct from p_previous_record_id then raise exception 'External record history changed' using errcode='40001';end if;
 if exists(select 1 from public.external_record_versions where document_id=d.id) then raise exception 'Document already preserved; select original receipt' using errcode='23505';end if;
 fingerprint:=encode(digest(jsonb_build_array(p_id,actor,m.id,p.id,p.version,m.source_origin,m.source_site_uid,m.external_id,d.id,d.version,d.mime_type,d.file_size,p_export_reference,p_received_at,p_previous_record_id,p_review_reason,'staff_reviewed_manual_export_v1')::text,'sha256'),'hex');
 insert into public.external_record_receipts(id,actor_id,animal_link_id,pet_id,pet_version,source_origin,source_site_uid,source_animal_id,document_id,document_version,mime_type,file_size,export_reference,received_at,previous_record_id,review_reason,receipt_hash) values(p_id,actor,m.id,p.id,p.version,m.source_origin,m.source_site_uid,m.external_id,d.id,d.version,d.mime_type,d.file_size,p_export_reference,p_received_at,p_previous_record_id,p_review_reason,fingerprint) returning * into r;return r;
end $$;
create function public.external_record_capture_context(p_receipt_id uuid,p_actor_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.external_record_receipts;d public.patient_documents;
begin
 select * into r from public.external_record_receipts where id=p_receipt_id and actor_id=p_actor_id;
 if not found or not public.ezyvet_is_active_admin(p_actor_id) then raise exception 'Staged receipt actor unavailable' using errcode='42501';end if;
 select * into d from public.patient_documents where id=r.document_id and pet_id=r.pet_id and status='ready' and version=r.document_version for share;
 if not found then raise exception 'Original document no longer ready at staged version' using errcode='40001';end if;
 return jsonb_build_object('receipt',to_jsonb(r),'document',jsonb_build_object('id',d.id,'version',d.version,'bucket','patient-documents','file_path',d.file_path,'mime_type',d.mime_type,'file_size',d.file_size),'capture',(select to_jsonb(c) from public.external_record_byte_captures c where receipt_id=r.id));
end $$;
create function public.capture_external_record_bytes(p_receipt_id uuid,p_actor_id uuid,p_expected_receipt_hash text,p_document_version integer,p_content_sha256 text,p_file_size bigint,p_mime_type text) returns public.external_record_byte_captures language plpgsql security definer set search_path=public,extensions as $$
declare r public.external_record_receipts;c public.external_record_byte_captures;fingerprint text;
begin
 select * into r from public.external_record_receipts where id=p_receipt_id and actor_id=p_actor_id for update;
 if not found or not public.ezyvet_is_active_admin(p_actor_id) then raise exception 'Staged receipt actor unavailable' using errcode='42501';end if;
 if p_content_sha256 is null or p_content_sha256 !~ '^[a-f0-9]{64}$' or row(r.receipt_hash,r.document_version,r.file_size,r.mime_type) is distinct from row(p_expected_receipt_hash,p_document_version,p_file_size,p_mime_type) then raise exception 'Verified bytes differ from staged document provenance' using errcode='23514';end if;
 select * into c from public.external_record_byte_captures where receipt_id=r.id;
 if found then if row(c.actor_id,c.content_sha256,c.receipt_hash,c.document_version,c.file_size,c.mime_type) is distinct from row(p_actor_id,p_content_sha256,p_expected_receipt_hash,p_document_version,p_file_size,p_mime_type) then raise exception 'Original byte capture is immutable' using errcode='23505';end if;return c;end if;
 perform public.external_record_capture_context(r.id,p_actor_id);
 fingerprint:=encode(digest(jsonb_build_array(r.id,r.receipt_hash,p_content_sha256,p_document_version,p_file_size,p_mime_type)::text,'sha256'),'hex');
 insert into public.external_record_byte_captures(receipt_id,actor_id,receipt_hash,document_version,content_sha256,file_size,mime_type,capture_hash) values(r.id,p_actor_id,r.receipt_hash,p_document_version,p_content_sha256,p_file_size,p_mime_type,fingerprint) returning * into c;return c;
end $$;
create function public.approve_external_record_import(p_id uuid,p_receipt_id uuid,p_expected_receipt_hash text,p_expected_capture_hash text,p_attest boolean) returns public.external_record_versions language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.external_record_versions;receipt public.external_record_receipts;capture public.external_record_byte_captures;prior public.external_record_versions;m public.ezyvet_record_links;
begin
 if not public.ezyvet_is_active_admin(actor) then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_attest is distinct from true then raise exception 'Explicit exact export review required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,4201));
 select * into r from public.external_record_versions where id=p_id;
 if found then if row(r.actor_id,r.receipt_id,r.receipt_hash,r.capture_hash) is distinct from row(actor,p_receipt_id,p_expected_receipt_hash,p_expected_capture_hash) then raise exception 'Approval UUID already used' using errcode='23505';end if;return r;end if;
 select * into receipt from public.external_record_receipts where id=p_receipt_id and actor_id=actor;
 if not found or receipt.receipt_hash is distinct from p_expected_receipt_hash then raise exception 'Owned exact receipt required' using errcode='42501';end if;
 select * into m from public.ezyvet_record_links where id=receipt.animal_link_id and resource='animal' for update;
 if not found or row(m.pet_id,m.source_origin,m.source_site_uid,m.external_id) is distinct from row(receipt.pet_id,receipt.source_origin,receipt.source_site_uid,receipt.source_animal_id) then raise exception 'Reviewed animal identity unavailable' using errcode='42501';end if;
 perform 1 from public.pets where id=receipt.pet_id and client_id=m.client_id and version=receipt.pet_version for share;
 if not found then raise exception 'Patient changed; stage a new reviewed receipt' using errcode='40001';end if;
 select * into capture from public.external_record_byte_captures where receipt_id=receipt.id;
 if not found or capture.capture_hash is distinct from p_expected_capture_hash then raise exception 'Verified document bytes and explicit review required' using errcode='42501';end if;
 perform 1 from public.patient_documents where id=receipt.document_id and pet_id=receipt.pet_id and status='ready' and version=receipt.document_version for share;
 if not found then raise exception 'Document changed; review current document' using errcode='40001';end if;
 select * into prior from public.external_record_versions where animal_link_id=m.id and export_reference=receipt.export_reference order by version desc limit 1;
 if prior.id is distinct from receipt.previous_record_id then raise exception 'External record history changed; review current version' using errcode='40001';end if;
 insert into public.external_record_versions(id,actor_id,receipt_id,animal_link_id,pet_id,pet_version,document_id,document_version,receipt_hash,capture_hash,export_reference,previous_record_id,version,kind,review_reason) values(p_id,actor,receipt.id,m.id,receipt.pet_id,receipt.pet_version,receipt.document_id,receipt.document_version,receipt.receipt_hash,capture.capture_hash,receipt.export_reference,prior.id,coalesce(prior.version,0)+1,case when prior.id is null then 'original' else 'replacement' end,receipt.review_reason) returning * into r;return r;
end $$;
create function public.acknowledge_external_record(p_id uuid,p_record_id uuid,p_pet_id uuid,p_expected_capture_hash text,p_expected_document_version integer,p_attest boolean) returns public.external_record_acknowledgments language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();a public.external_record_acknowledgments;r public.external_record_versions;
begin
 if not public.has_role(actor,'DVM') then raise exception 'Veterinarian acknowledgment required' using errcode='42501';end if;
 if p_id is null or p_attest is distinct from true then raise exception 'Explicit report acknowledgment required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,4202));
 select * into a from public.external_record_acknowledgments where id=p_id;
 if found then
 if row(a.actor_id,a.record_id,a.capture_hash,a.document_version) is distinct from row(actor,p_record_id,p_expected_capture_hash,p_expected_document_version) or not exists(select 1 from public.external_record_versions where id=a.record_id and pet_id=p_pet_id) then raise exception 'Acknowledgment UUID already used' using errcode='23505';end if;return a;end if;
 select * into r from public.external_record_versions where id=p_record_id and pet_id=p_pet_id;
 if not found or r.capture_hash is distinct from p_expected_capture_hash or r.document_version is distinct from p_expected_document_version then raise exception 'Exact report acknowledgment required' using errcode='42501';end if;
 perform 1 from public.patient_documents where id=r.document_id and pet_id=r.pet_id and status='ready' and version=r.document_version for share;
 if not found then raise exception 'Reviewed report document unavailable' using errcode='40001';end if;
 insert into public.external_record_acknowledgments(id,actor_id,record_id,capture_hash,document_version) values(p_id,actor,r.id,r.capture_hash,r.document_version) returning * into a;return a;
end $$;
create function public.recover_external_record_receipt(p_receipt_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.external_record_receipts;
begin
 if not public.ezyvet_is_active_admin(actor) then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into r from public.external_record_receipts where id=p_receipt_id and actor_id=actor;
 if not found then return null;end if;
 return jsonb_build_object('receipt',to_jsonb(r),'capture',(select to_jsonb(c) from public.external_record_byte_captures c where receipt_id=r.id),'record',(select to_jsonb(v) from public.external_record_versions v where receipt_id=r.id));
end $$;
create function public.list_external_record_receipts(p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();items jsonb;more boolean;
begin
 if not public.ezyvet_is_active_admin(actor) then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 100 or (p_before_at is null)<>(p_before_id is null) or not exists(select 1 from public.pets where id=p_pet_id) then raise exception 'Valid patient and bounded cursor required' using errcode='23514';end if;
 with rows as (select * from public.external_record_receipts where pet_id=p_pet_id and actor_id=actor and (p_before_at is null or (created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit p_limit+1), page as (select * from rows order by created_at desc,id desc limit p_limit)
 select coalesce((select jsonb_agg(public.recover_external_record_receipt(id) order by created_at desc,id desc) from page),'[]'::jsonb),(select count(*)>p_limit from rows) into items,more;
 return jsonb_build_object('pet_id',p_pet_id,'receipts',items,'has_more',more);
end $$;
create function public.read_external_record_history(p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare items jsonb;more boolean;
begin
 perform public.clinical_require_staff();
 if p_limit is null or p_limit not between 1 and 100 or (p_before_at is null)<>(p_before_id is null) or not exists(select 1 from public.pets where id=p_pet_id) then raise exception 'Valid patient and bounded cursor required' using errcode='23514';end if;
 with rows as (select * from public.external_record_versions where pet_id=p_pet_id and (p_before_at is null or (created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit p_limit+1), page as (select * from rows order by created_at desc,id desc limit p_limit)
 select coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('provider','ezyVet','entry_method','staff_reviewed_manual_export_v1','source_animal_id',r.source_animal_id,'source_origin',r.source_origin,'source_site_uid',r.source_site_uid,'capture',(select to_jsonb(c) from public.external_record_byte_captures c where receipt_id=r.id),'received_at',r.received_at,'document_status',d.status,'acknowledgments',coalesce((select jsonb_agg(to_jsonb(a) order by created_at,id) from public.external_record_acknowledgments a where record_id=v.id),'[]'::jsonb)) order by v.created_at desc,v.id desc) from page v join public.external_record_receipts r on r.id=v.receipt_id join public.patient_documents d on d.id=v.document_id),'[]'::jsonb),(select count(*)>p_limit from rows) into items,more;
 return jsonb_build_object('pet_id',p_pet_id,'records',items,'has_more',more);
end $$;
do $$declare f record;begin for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('stage_external_record_receipt','approve_external_record_import','acknowledge_external_record','recover_external_record_receipt','list_external_record_receipts','read_external_record_history') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);execute format('grant execute on function %s to authenticated',f.signature);end loop;end $$;
revoke all on function public.external_record_capture_context(uuid,uuid),public.capture_external_record_bytes(uuid,uuid,text,integer,text,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.external_record_capture_context(uuid,uuid),public.capture_external_record_bytes(uuid,uuid,text,integer,text,bigint,text) to service_role;

create function public.recover_external_record_acknowledgment(p_id uuid) returns public.external_record_acknowledgments language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();a public.external_record_acknowledgments;
begin
 if not public.has_role(actor,'DVM') then raise exception 'Veterinarian acknowledgment access required' using errcode='42501';end if;
 select * into a from public.external_record_acknowledgments where id=p_id and actor_id=actor;
 if not found then return null;end if;
 return a;
end $$;
revoke all on function public.recover_external_record_acknowledgment(uuid) from public,anon,authenticated,service_role;
grant execute on function public.recover_external_record_acknowledgment(uuid) to authenticated;
