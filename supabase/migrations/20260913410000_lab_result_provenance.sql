-- Native staff-entered provenance only. No provider schema, transport, interpretation or client release.
create table public.lab_source_accounts (
 id uuid primary key,actor_id uuid not null references auth.users(id),provider_label text not null,account_reference text not null,environment_label text not null,review_note text not null,
 manual_import_enabled boolean not null default true check(manual_import_enabled),transport_enabled boolean not null default false check(not transport_enabled),created_at timestamptz not null default now()
);
create table public.lab_report_receipts (
 id uuid primary key,actor_id uuid not null references auth.users(id),source_account_id uuid not null references public.lab_source_accounts(id),
 document_id uuid not null references public.patient_documents(id),document_version integer not null,pet_id uuid not null references public.pets(id),
 source_patient_reference text not null,source_order_reference text not null,source_report_reference text not null,
 received_at timestamptz not null,
 mime_type text not null,file_size bigint not null,receipt_hash text not null,entry_method text not null default 'staff_entered_v1' check(entry_method='staff_entered_v1'),created_at timestamptz not null default now()
);
create table public.lab_report_byte_captures (
 receipt_id uuid primary key references public.lab_report_receipts(id),actor_id uuid not null references auth.users(id),receipt_hash text not null,document_version integer not null,
 content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),file_size bigint not null,mime_type text not null,capture_hash text not null,captured_at timestamptz not null default now()
);
create table public.lab_order_source_reviews (
 id uuid primary key,actor_id uuid not null references auth.users(id),order_id uuid not null references public.patient_lab_orders(id),pet_id uuid not null references public.pets(id),order_version integer not null,
 source_account_id uuid not null references public.lab_source_accounts(id),source_patient_reference text not null,source_order_reference text not null,
 previous_review_id uuid references public.lab_order_source_reviews(id),revision integer not null,review_reason text not null,created_at timestamptz not null default now(),unique(order_id,revision)
);
create table public.lab_report_versions (
 id uuid primary key,actor_id uuid not null references auth.users(id),order_id uuid not null references public.patient_lab_orders(id),pet_id uuid not null references public.pets(id),order_version integer not null,
 source_review_id uuid not null references public.lab_order_source_reviews(id),receipt_id uuid not null unique references public.lab_report_receipts(id),receipt_hash text not null,capture_hash text not null,
 document_id uuid not null references public.patient_documents(id),document_version integer not null,
 previous_report_id uuid references public.lab_report_versions(id),version integer not null,kind text not null check(kind in ('original','corrected')),review_reason text not null,created_at timestamptz not null default now(),unique(order_id,version)
);
create table public.lab_report_acknowledgments (
 id uuid primary key,actor_id uuid not null references auth.users(id),report_id uuid not null references public.lab_report_versions(id),capture_hash text not null,document_version integer not null,created_at timestamptz not null default now(),unique(report_id,actor_id)
);
create function public.lab_provenance_immutable() returns trigger language plpgsql set search_path=public as $$begin raise exception 'Lab provenance history is append-only' using errcode='23514';end $$;
revoke all on function public.lab_provenance_immutable() from public,anon,authenticated,service_role;
do $$declare t text;begin foreach t in array array['lab_source_accounts','lab_report_receipts','lab_report_byte_captures','lab_order_source_reviews','lab_report_versions','lab_report_acknowledgments'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger immutable_lab_provenance before update or delete on public.%I for each row execute function public.lab_provenance_immutable()',t);
 end loop;end $$;
create function public.review_lab_source_account(p_id uuid,p_provider_label text,p_account_reference text,p_environment_label text,p_review_note text) returns public.lab_source_accounts language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.lab_source_accounts;
begin
 if not public.has_role(actor,'ADMIN') then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_provider_label is null or length(trim(p_provider_label)) not between 1 and 200 or p_account_reference is null or length(trim(p_account_reference)) not between 1 and 200 or p_environment_label is null or length(trim(p_environment_label)) not between 1 and 100 or p_review_note is null or length(trim(p_review_note)) not between 1 and 2000 then raise exception 'Reviewed nonsecret source identity required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,4100));
 select * into r from public.lab_source_accounts where id=p_id;
 if found then if row(r.actor_id,r.provider_label,r.account_reference,r.environment_label,r.review_note) is distinct from row(actor,p_provider_label,p_account_reference,p_environment_label,p_review_note) then raise exception 'Source review UUID already used' using errcode='23505';end if;return r;end if;
 insert into public.lab_source_accounts(id,actor_id,provider_label,account_reference,environment_label,review_note) values(p_id,actor,p_provider_label,p_account_reference,p_environment_label,p_review_note) returning * into r;return r;
end $$;
create function public.stage_lab_report_receipt(p_id uuid,p_source_account_id uuid,p_document_id uuid,p_document_version integer,p_source_patient_reference text,p_source_order_reference text,p_source_report_reference text,p_received_at timestamptz) returns public.lab_report_receipts language plpgsql security definer set search_path=public,extensions as $$
declare actor uuid:=public.clinical_require_staff();r public.lab_report_receipts;d public.patient_documents;fingerprint text;
begin
 if p_id is null or p_received_at is null or not isfinite(p_received_at) or p_received_at>clock_timestamp() or exists(select 1 from unnest(array[p_source_patient_reference,p_source_order_reference,p_source_report_reference]) v where v is null or length(trim(v)) not between 1 and 500) then raise exception 'Explicit staff-entered report provenance required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,4101));
 select * into r from public.lab_report_receipts where id=p_id;
 if found then if row(r.actor_id,r.source_account_id,r.document_id,r.document_version,r.source_patient_reference,r.source_order_reference,r.source_report_reference,r.received_at) is distinct from row(actor,p_source_account_id,p_document_id,p_document_version,p_source_patient_reference,p_source_order_reference,p_source_report_reference,p_received_at) then raise exception 'Receipt UUID already used' using errcode='23505';end if;return r;end if;
 perform 1 from public.lab_source_accounts where id=p_source_account_id and manual_import_enabled;
 if not found then raise exception 'Reviewed source account required' using errcode='42501';end if;
 select * into d from public.patient_documents where id=p_document_id and status='ready' and version=p_document_version for share;
 if not found then raise exception 'Ready private document and exact version required' using errcode='42501';end if;
 fingerprint:=encode(digest(jsonb_build_array(p_id,actor,p_source_account_id,d.id,d.version,d.pet_id,d.mime_type,d.file_size,p_source_patient_reference,p_source_order_reference,p_source_report_reference,p_received_at,'staff_entered_v1')::text,'sha256'),'hex');
 insert into public.lab_report_receipts(id,actor_id,source_account_id,document_id,document_version,pet_id,source_patient_reference,source_order_reference,source_report_reference,received_at,mime_type,file_size,receipt_hash) values(p_id,actor,p_source_account_id,d.id,d.version,d.pet_id,p_source_patient_reference,p_source_order_reference,p_source_report_reference,p_received_at,d.mime_type,d.file_size,fingerprint) returning * into r;return r;
end $$;
create function public.lab_report_capture_context(p_receipt_id uuid,p_actor_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.lab_report_receipts;d public.patient_documents;
begin
 select * into r from public.lab_report_receipts where id=p_receipt_id and actor_id=p_actor_id;
 if not found or not public.is_active_staff(p_actor_id) then raise exception 'Staged receipt actor unavailable' using errcode='42501';end if;
 select * into d from public.patient_documents where id=r.document_id and pet_id=r.pet_id and status='ready' and version=r.document_version for share;
 if not found then raise exception 'Original document no longer ready at staged version' using errcode='40001';end if;
 return jsonb_build_object('receipt',to_jsonb(r),'document',jsonb_build_object('id',d.id,'version',d.version,'bucket','patient-documents','file_path',d.file_path,'mime_type',d.mime_type,'file_size',d.file_size),'capture',(select to_jsonb(c) from public.lab_report_byte_captures c where receipt_id=r.id));
end $$;
create function public.capture_lab_report_bytes(p_receipt_id uuid,p_actor_id uuid,p_expected_receipt_hash text,p_document_version integer,p_content_sha256 text,p_file_size bigint,p_mime_type text) returns public.lab_report_byte_captures language plpgsql security definer set search_path=public,extensions as $$
declare r public.lab_report_receipts;c public.lab_report_byte_captures;fingerprint text;
begin
 select * into r from public.lab_report_receipts where id=p_receipt_id and actor_id=p_actor_id for update;
 if not found or not public.is_active_staff(p_actor_id) then raise exception 'Staged receipt actor unavailable' using errcode='42501';end if;
 if p_content_sha256 is null or p_content_sha256 !~ '^[a-f0-9]{64}$' or row(r.receipt_hash,r.document_version,r.file_size,r.mime_type) is distinct from row(p_expected_receipt_hash,p_document_version,p_file_size,p_mime_type) then raise exception 'Verified bytes differ from staged document provenance' using errcode='23514';end if;
 select * into c from public.lab_report_byte_captures where receipt_id=r.id;
 if found then if row(c.actor_id,c.content_sha256,c.receipt_hash,c.document_version,c.file_size,c.mime_type) is distinct from row(p_actor_id,p_content_sha256,p_expected_receipt_hash,p_document_version,p_file_size,p_mime_type) then raise exception 'Original byte capture is immutable' using errcode='23505';end if;return c;end if;
 perform public.lab_report_capture_context(r.id,p_actor_id);
 fingerprint:=encode(digest(jsonb_build_array(r.id,r.receipt_hash,p_content_sha256,p_document_version,p_file_size,p_mime_type)::text,'sha256'),'hex');
 insert into public.lab_report_byte_captures(receipt_id,actor_id,receipt_hash,document_version,content_sha256,file_size,mime_type,capture_hash) values(r.id,p_actor_id,r.receipt_hash,p_document_version,p_content_sha256,p_file_size,p_mime_type,fingerprint) returning * into c;return c;
end $$;
create function public.review_lab_order_source(p_id uuid,p_order_id uuid,p_pet_id uuid,p_expected_order_version integer,p_source_account_id uuid,p_source_patient_reference text,p_source_order_reference text,p_previous_review_id uuid,p_review_reason text,p_attest boolean) returns public.lab_order_source_reviews language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.lab_order_source_reviews;o public.patient_lab_orders;prior public.lab_order_source_reviews;
begin
 if p_id is null or p_attest is distinct from true or p_review_reason is null or length(trim(p_review_reason)) not between 1 and 2000 or exists(select 1 from unnest(array[p_source_patient_reference,p_source_order_reference]) v where v is null or length(trim(v)) not between 1 and 500) then raise exception 'Explicit source identity review required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,4102));
 select * into r from public.lab_order_source_reviews where id=p_id;
 if found then if row(r.actor_id,r.order_id,r.pet_id,r.order_version,r.source_account_id,r.source_patient_reference,r.source_order_reference,r.previous_review_id,r.review_reason) is distinct from row(actor,p_order_id,p_pet_id,p_expected_order_version,p_source_account_id,p_source_patient_reference,p_source_order_reference,p_previous_review_id,p_review_reason) then raise exception 'Source mapping UUID already used' using errcode='23505';end if;return r;end if;
 select * into o from public.patient_lab_orders where id=p_order_id and pet_id=p_pet_id for update;
 if not found then raise exception 'Lab order belongs to another patient or is unavailable' using errcode='42501';end if;
 if o.version is distinct from p_expected_order_version then raise exception 'Lab order changed' using errcode='40001';end if;
 perform 1 from public.lab_source_accounts where id=p_source_account_id and manual_import_enabled;
 if not found then raise exception 'Reviewed source account required' using errcode='42501';end if;
 select * into prior from public.lab_order_source_reviews where order_id=o.id order by revision desc limit 1;
 if prior.id is distinct from p_previous_review_id then raise exception 'Source identity mapping changed' using errcode='40001';end if;
 insert into public.lab_order_source_reviews(id,actor_id,order_id,pet_id,order_version,source_account_id,source_patient_reference,source_order_reference,previous_review_id,revision,review_reason) values(p_id,actor,o.id,o.pet_id,o.version,p_source_account_id,p_source_patient_reference,p_source_order_reference,prior.id,coalesce(prior.revision,0)+1,p_review_reason) returning * into r;return r;
end $$;
create function public.link_lab_report_version(p_id uuid,p_receipt_id uuid,p_expected_receipt_hash text,p_expected_capture_hash text,p_order_id uuid,p_pet_id uuid,p_expected_order_version integer,p_source_review_id uuid,p_previous_report_id uuid,p_kind text,p_review_reason text,p_attest boolean) returns public.lab_report_versions language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.lab_report_versions;o public.patient_lab_orders;s public.lab_order_source_reviews;receipt public.lab_report_receipts;capture public.lab_report_byte_captures;prior public.lab_report_versions;
begin
 if p_id is null or p_attest is distinct from true or p_kind is null or p_kind not in ('original','corrected') or p_review_reason is null or length(trim(p_review_reason)) not between 1 and 2000 then raise exception 'Explicit report provenance review required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,4103));
 select * into r from public.lab_report_versions where id=p_id;
 if found then if row(r.actor_id,r.receipt_id,r.receipt_hash,r.capture_hash,r.order_id,r.pet_id,r.order_version,r.source_review_id,r.previous_report_id,r.kind,r.review_reason) is distinct from row(actor,p_receipt_id,p_expected_receipt_hash,p_expected_capture_hash,p_order_id,p_pet_id,p_expected_order_version,p_source_review_id,p_previous_report_id,p_kind,p_review_reason) then raise exception 'Report review UUID already used' using errcode='23505';end if;return r;end if;
 select * into o from public.patient_lab_orders where id=p_order_id and pet_id=p_pet_id for update;
 if not found then raise exception 'Lab order belongs to another patient or is unavailable' using errcode='42501';end if;
 if o.version is distinct from p_expected_order_version then raise exception 'Lab order changed' using errcode='40001';end if;
 select * into s from public.lab_order_source_reviews where order_id=o.id order by revision desc limit 1;
 if s.id is null or s.id is distinct from p_source_review_id then raise exception 'Review current source identity mapping' using errcode='40001';end if;
 select * into receipt from public.lab_report_receipts where id=p_receipt_id;
 if receipt.id is null or receipt.receipt_hash is distinct from p_expected_receipt_hash or row(receipt.pet_id,receipt.source_account_id,receipt.source_patient_reference,receipt.source_order_reference) is distinct from row(o.pet_id,s.source_account_id,s.source_patient_reference,s.source_order_reference) then raise exception 'Report patient or source identity does not match reviewed order' using errcode='42501';end if;
 select * into capture from public.lab_report_byte_captures where receipt_id=receipt.id;
 if capture.receipt_id is null or capture.capture_hash is distinct from p_expected_capture_hash then raise exception 'Verified original byte capture and explicit review required' using errcode='42501';end if;
 perform 1 from public.patient_documents where id=receipt.document_id and pet_id=o.pet_id and status='ready' and version=receipt.document_version for share;
 if not found then raise exception 'Report document is no longer ready at reviewed version' using errcode='40001';end if;
 select * into prior from public.lab_report_versions where order_id=o.id order by version desc limit 1;
 if prior.id is distinct from p_previous_report_id then raise exception 'Report history changed; review the current version' using errcode='40001';end if;
 if (prior.id is null and p_kind<>'original') or (prior.id is not null and (p_kind<>'corrected' or prior.document_id=receipt.document_id or (select source_account_id from public.lab_report_receipts where id=prior.receipt_id)<>receipt.source_account_id)) then raise exception 'Corrected report requires a new document within the same source account' using errcode='23514';end if;
 insert into public.lab_report_versions(id,actor_id,order_id,pet_id,order_version,source_review_id,receipt_id,receipt_hash,capture_hash,document_id,document_version,previous_report_id,version,kind,review_reason) values(p_id,actor,o.id,o.pet_id,o.version,s.id,receipt.id,receipt.receipt_hash,capture.capture_hash,receipt.document_id,receipt.document_version,prior.id,coalesce(prior.version,0)+1,p_kind,p_review_reason) returning * into r;return r;
end $$;
create function public.acknowledge_lab_report(p_id uuid,p_report_id uuid,p_pet_id uuid,p_expected_capture_hash text,p_expected_document_version integer,p_attest boolean) returns public.lab_report_acknowledgments language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();a public.lab_report_acknowledgments;r public.lab_report_versions;
begin
 if not public.has_role(actor,'DVM') then raise exception 'Veterinarian acknowledgment required' using errcode='42501';end if;
 if p_id is null or p_attest is distinct from true then raise exception 'Explicit report acknowledgment required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,4104));
 select * into a from public.lab_report_acknowledgments where id=p_id;
 if found then
 if row(a.actor_id,a.report_id,a.capture_hash,a.document_version) is distinct from row(actor,p_report_id,p_expected_capture_hash,p_expected_document_version) or not exists(select 1 from public.lab_report_versions where id=a.report_id and pet_id=p_pet_id) then raise exception 'Acknowledgment UUID already used' using errcode='23505';end if;return a;end if;
 select * into r from public.lab_report_versions where id=p_report_id and pet_id=p_pet_id;
 if not found or r.capture_hash is distinct from p_expected_capture_hash or r.document_version is distinct from p_expected_document_version then raise exception 'Exact report acknowledgment required' using errcode='42501';end if;
 perform 1 from public.patient_documents where id=r.document_id and pet_id=r.pet_id and status='ready' and version=r.document_version for share;
 if not found then raise exception 'Reviewed report document unavailable' using errcode='40001';end if;
 insert into public.lab_report_acknowledgments(id,actor_id,report_id,capture_hash,document_version) values(p_id,actor,r.id,r.capture_hash,r.document_version) returning * into a;return a;
end $$;
create function public.read_lab_result_history(p_pet_id uuid,p_order_id uuid default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin perform public.clinical_require_staff();
 if not exists(select 1 from public.pets where id=p_pet_id) or (p_order_id is not null and not exists(select 1 from public.patient_lab_orders where id=p_order_id and pet_id=p_pet_id)) then raise exception 'Patient or lab order unavailable' using errcode='42501';end if;
 return jsonb_build_object('pet_id',p_pet_id,'order_id',p_order_id,
 'sources',coalesce((select jsonb_agg(to_jsonb(s) order by created_at,id) from public.lab_source_accounts s),'[]'::jsonb),
 'staged_receipts',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('capture',(select to_jsonb(c) from public.lab_report_byte_captures c where receipt_id=r.id)) order by created_at,id) from public.lab_report_receipts r where pet_id=p_pet_id and not exists(select 1 from public.lab_report_versions v where v.receipt_id=r.id)),'[]'::jsonb),
 'source_reviews',coalesce((select jsonb_agg(to_jsonb(s) order by order_id,revision) from public.lab_order_source_reviews s where pet_id=p_pet_id and (p_order_id is null or order_id=p_order_id)),'[]'::jsonb),
 'reports',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('capture',(select to_jsonb(c) from public.lab_report_byte_captures c where receipt_id=v.receipt_id),'document_status',(select status from public.patient_documents where id=v.document_id),'acknowledgments',coalesce((select jsonb_agg(to_jsonb(a) order by created_at,id) from public.lab_report_acknowledgments a where report_id=v.id),'[]'::jsonb)) order by order_id,version) from public.lab_report_versions v where pet_id=p_pet_id and (p_order_id is null or order_id=p_order_id)),'[]'::jsonb));
end $$;
do $$declare f record;begin for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('review_lab_source_account','stage_lab_report_receipt','review_lab_order_source','link_lab_report_version','acknowledge_lab_report','read_lab_result_history') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);execute format('grant execute on function %s to authenticated',f.signature);end loop;end $$;

revoke all on function public.lab_report_capture_context(uuid,uuid),public.capture_lab_report_bytes(uuid,uuid,text,integer,text,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.lab_report_capture_context(uuid,uuid),public.capture_lab_report_bytes(uuid,uuid,text,integer,text,bigint,text) to service_role;

create function public.recover_lab_report_receipt(p_receipt_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.lab_report_receipts;
begin select * into r from public.lab_report_receipts where id=p_receipt_id and actor_id=actor;
 if not found then return null;end if;
 return jsonb_build_object('receipt',to_jsonb(r),'capture',(select to_jsonb(c) from public.lab_report_byte_captures c where receipt_id=r.id),'report',(select to_jsonb(v) from public.lab_report_versions v where receipt_id=r.id));
end $$;
revoke all on function public.recover_lab_report_receipt(uuid) from public,anon,authenticated,service_role;
grant execute on function public.recover_lab_report_receipt(uuid) to authenticated;
