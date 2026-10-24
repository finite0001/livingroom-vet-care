-- Operational requests surround the existing reviewed clinical-release pipeline.
-- No clinical acceptance, interval, provider, or recipient policy is activated here.
create table public.record_requests (
 id uuid primary key, client_id uuid not null references public.clients(id), pet_id uuid not null references public.pets(id),
 direction text not null check(direction in ('incoming','outgoing')),
 subset text not null check(subset in ('full','vaccines','labs','custom')),
 channel text check(channel in ('EMAIL','SMS')), recipient text,
 recipient_kind text not null default 'client' check(recipient_kind in ('client','third_party')),
 recipient_name text,
 requester_name text not null check(length(trim(requester_name)) between 1 and 160),
 request_note text not null default '' check(length(request_note)<=2000),
 requested_on date not null, due_on date, assigned_to uuid references public.profiles(id),
 ticket_id uuid references public.tickets(id), conversation_id uuid references public.conversations(id),
 status text not null default 'requested' check(status in ('requested','awaiting_response','preparing','received','ready','fulfilled','blocked','cancelled')),
 active_manifest_id uuid, version integer not null default 1 check(version>0),
 created_by uuid not null references public.profiles(id), updated_by uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 check(due_on is null or due_on>=requested_on),
 check((direction='incoming' and channel is null and recipient is null) or
       (direction='outgoing' and channel is not null and length(recipient)>0)),
 check(recipient_kind='client' or (direction='outgoing' and channel='EMAIL' and length(trim(recipient_name)) between 1 and 160)),
 check((direction='incoming' and status not in ('preparing','ready')) or
       (direction='outgoing' and status not in ('awaiting_response','received')))
);
create index record_requests_queue_idx on public.record_requests(updated_at desc,id desc);
create index record_requests_pet_idx on public.record_requests(pet_id,updated_at desc,id desc);
create index record_requests_client_idx on public.record_requests(client_id,updated_at desc,id desc);
create index record_requests_ticket_idx on public.record_requests(ticket_id) where ticket_id is not null;
create index record_requests_assigned_due_idx on public.record_requests(assigned_to,due_on,id) where status not in ('fulfilled','cancelled');
create table public.record_request_actions (
 id uuid primary key, request_id uuid not null references public.record_requests(id), kind text not null,
 intent jsonb not null, receipt jsonb not null, actor_id uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp()
);
create index record_request_actions_request_idx on public.record_request_actions(request_id,created_at,id);
create table public.record_request_revisions (
 request_id uuid not null references public.record_requests(id), version integer not null,
 snapshot jsonb not null, actor_id uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(), primary key(request_id,version)
);
create table public.record_request_receipts (
 id uuid primary key, request_id uuid not null references public.record_requests(id),
 document_id uuid not null references public.patient_documents(id), document_version integer not null,
 original jsonb not null, review_note text not null check(length(trim(review_note)) between 1 and 2000),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default clock_timestamp(),
 unique(request_id,document_id,document_version)
);
create table public.record_request_manifests (
 id uuid primary key, request_id uuid not null references public.record_requests(id),
 subset text not null, channel text not null, recipient text not null, captured_at timestamptz not null,
 inventory jsonb not null, exclusions jsonb not null, fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 package_count integer not null check(package_count>0), source_count integer not null check(source_count>0),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default clock_timestamp()
);
alter table public.record_requests add constraint record_request_manifest_fk foreign key(active_manifest_id) references public.record_request_manifests(id);
create index record_request_manifests_request_idx on public.record_request_manifests(request_id,created_at,id);
create table public.record_request_packages (
 id uuid primary key, manifest_id uuid not null references public.record_request_manifests(id) deferrable initially deferred, ordinal integer not null check(ordinal>0),
 release_id uuid not null unique, selection jsonb not null, preview jsonb not null, scope_expansion boolean not null default false,
 unique(manifest_id,ordinal)
);
create table public.record_request_release_links (
 package_id uuid primary key references public.record_request_packages(id), release_id uuid not null unique references public.record_releases(id),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default clock_timestamp()
);
-- This workflow/form needs its own practice review before third-party disclosure.
-- Only a trusted operator may commission it; no staff/provider API may activate it.
create table public.record_request_disclosure_policy (
 id boolean primary key default true check(id), enabled boolean not null default false,
 accepted_at timestamptz, reviewer text, review_reference text,
 check(not enabled or (accepted_at is not null and length(trim(reviewer)) between 1 and 160 and length(trim(review_reference)) between 1 and 2000))
);
create table public.record_request_recipient_authorizations (
 id uuid primary key, request_id uuid not null references public.record_requests(id), manifest_id uuid not null unique references public.record_request_manifests(id),
 manifest_hash text not null check(manifest_hash ~ '^[a-f0-9]{64}$'), recipient_name text not null, recipient text not null,
 client_authority text not null check(length(trim(client_authority)) between 1 and 2000),
 destination_verification text not null check(length(trim(destination_verification)) between 1 and 2000),
 evidence_document_id uuid references public.patient_documents(id), evidence_document_version integer,
 expires_at timestamptz not null, created_by uuid not null references public.profiles(id), created_at timestamptz not null default clock_timestamp(),
 check((evidence_document_id is null)=(evidence_document_version is null))
);
create table public.record_request_authorization_revocations (
 authorization_id uuid primary key references public.record_request_recipient_authorizations(id),
 reason text not null check(length(trim(reason)) between 1 and 2000), created_by uuid not null references public.profiles(id), created_at timestamptz not null default clock_timestamp()
);

create function public.record_request_immutable() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Records-request evidence is immutable' using errcode='23514';end $$;
create function public.record_request_revision() returns trigger language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();begin
 if TG_OP='DELETE' then raise exception 'Request history cannot be deleted' using errcode='23514';end if;
 if TG_OP='UPDATE' then
  if row(NEW.id,NEW.client_id,NEW.pet_id,NEW.direction,NEW.created_by,NEW.created_at) is distinct from
     row(OLD.id,OLD.client_id,OLD.pet_id,OLD.direction,OLD.created_by,OLD.created_at)
  then raise exception 'Request identity is immutable' using errcode='23514';end if;
  NEW.version:=OLD.version+1;NEW.updated_by:=actor;NEW.updated_at:=clock_timestamp();
 else NEW.version:=1;NEW.created_by:=actor;NEW.updated_by:=actor;end if;
 return NEW;
end $$;

-- Both discovery cores are read-only (including their dynamically built SELECTs).
-- Keep clinical_require_staff VOLATILE: authorization rechecks after waits must see offboarding.
alter function public.list_record_release_sources(uuid,integer) stable;
alter function public.list_record_release_sources_v5(uuid,integer) stable;
create function public.record_request_families() returns text[] language sql immutable set search_path=public as $$
 select array['problem_ids','patient_summary_ids','weight_ids','treatment_ids','encounter_ids','certificate_ids','lab_order_ids','lab_report_ids','native_prescription_ids','native_dispense_ids','imported_prescription_ids','imported_vaccination_ids','imported_history_ids','external_record_ids','api_attachment_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids']
$$;
create function public.record_request_inventory(p_pet_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare pages jsonb;page jsonb;candidate jsonb;k text;key text;nodes jsonb:='{}';excluded jsonb:='[]';requires jsonb;missing text[];raw jsonb;table_name text;doc public.patient_documents;raw_count integer:=0;
begin
 perform public.clinical_require_staff();
 with recursive capture(page_offset,contents) as (
  select 0,public.list_record_release_sources_v13(p_pet_id,0)
  union all
  select page_offset+100,public.list_record_release_sources_v13(p_pet_id,page_offset+100) from capture
  where page_offset<9900 and exists(select 1 from jsonb_each(contents->'has_more') h where h.value='true'::jsonb)
 ) select jsonb_agg(contents order by page_offset) into pages from capture;
 if exists(select 1 from jsonb_each(pages->(jsonb_array_length(pages)-1)->'has_more') h where h.value='true'::jsonb)
 then raise exception 'Chart exceeds complete-capture capacity; no partial manifest was created' using errcode='23514';end if;
 for page in select value from jsonb_array_elements(pages) loop
  foreach k in array public.record_request_families() loop
   for candidate in select value from jsonb_array_elements(page->k) loop
    key:=k||':'||(candidate->>'id');
    if nodes ? key then raise exception 'Duplicate source in captured discovery' using errcode='23514';end if;
    requires:='[]';
    if candidate ? 'required_document_id' then requires:=jsonb_build_array('document_ids:'||coalesce(candidate->>'required_document_id','missing'));end if;
    if k='document_ids' then
     select * into doc from public.patient_documents where id=(candidate->>'id')::uuid and pet_id=p_pet_id;
     if doc.status<>'ready' or doc.visibility<>'client_shareable' or not exists(select 1 from storage.objects o where o.bucket_id='patient-documents' and o.name=doc.file_path and o.metadata->>'size'=doc.file_size::text and o.metadata->>'mimetype'=doc.mime_type) then
      excluded:=excluded||jsonb_build_array(jsonb_build_object('family',k,'id',candidate->>'id','label',candidate->>'label','reason','Original file is unavailable or no longer matches its metadata'));continue;
     end if;
     requires:=coalesce((select jsonb_agg('lab_report_ids:'||v) from jsonb_array_elements_text(coalesce(candidate->'required_lab_report_ids','[]')) v),'[]')||coalesce((select jsonb_agg('external_record_ids:'||v) from jsonb_array_elements_text(coalesce(candidate->'required_external_record_ids','[]')) v),'[]');
     candidate:=candidate||jsonb_build_object('document_category',doc.category);
    end if;
    nodes:=nodes||jsonb_build_object(key,candidate||jsonb_build_object('family',k,'requires',requires));
   end loop;
  end loop;
 end loop;
 -- Remove incomplete dependency groups explicitly. Never attach a private/missing original.
 loop
  select array_agg(n.key order by n.key) into missing from jsonb_each(nodes) n
  where exists(select 1 from jsonb_array_elements_text(n.value->'requires') d where not nodes ? d);
  exit when missing is null;
  foreach key in array missing loop
   candidate:=nodes->key;
   excluded:=excluded||jsonb_build_array(jsonb_build_object('family',candidate->>'family','id',candidate->>'id','label',candidate->>'label','reason','Required original or reviewed provenance version is unavailable'));
   nodes:=nodes-key;
  end loop;
 end loop;
 -- Explain raw records outside discovery: unsigned, internal, invalidated and unreviewed history.
 foreach k in array public.record_request_families() loop
  table_name:=case k when 'problem_ids' then 'patient_problems' when 'patient_summary_ids' then 'pets' when 'weight_ids' then 'patient_weights' when 'treatment_ids' then 'patient_treatments' when 'encounter_ids' then 'clinical_encounters' when 'certificate_ids' then 'vaccine_certificates' when 'lab_order_ids' then 'patient_lab_orders' when 'lab_report_ids' then 'lab_report_versions' when 'native_prescription_ids' then 'native_prescription_authorizations' when 'native_dispense_ids' then 'native_dispenses' when 'imported_prescription_ids' then 'ezyvet_imported_prescriptions' when 'imported_vaccination_ids' then 'ezyvet_imported_vaccinations' when 'imported_history_ids' then 'ezyvet_imported_histories' when 'external_record_ids' then 'external_record_versions' when 'api_attachment_ids' then 'ezyvet_attachment_record_versions' when 'document_ids' then 'patient_documents' when 'dental_ids' then 'dental_charts' when 'qol_ids' then 'patient_qol_records' when 'anesthesia_ids' then 'patient_anesthesia_records' else 'patient_lesions' end;
  for raw in execute format('select to_jsonb(t) from public.%I t where %s=$1 order by id',table_name,case k when 'patient_summary_ids' then 'id' else 'pet_id' end) using p_pet_id loop
   raw_count:=raw_count+1;if raw_count>20000 then raise exception 'Chart census exceeds complete-capture capacity; no partial manifest was created' using errcode='23514';end if;
   key:=k||':'||(raw->>'id');
   if not nodes ? key and not exists(select 1 from jsonb_array_elements(excluded) e where e->>'family'=k and e->>'id'=raw->>'id') then
    excluded:=excluded||jsonb_build_array(jsonb_build_object('family',k,'id',raw->>'id','label',coalesce(raw->>'file_name',raw->>'test_name',raw->>'title',raw->>'label','Unavailable source'),
     'reason',case when k in ('encounter_ids','dental_ids','qol_ids','anesthesia_ids') then 'Unsigned clinical record' when k='certificate_ids' then 'Invalidated certificate' when k='document_ids' then 'Internal, pending, voided or abandoned original' when k='lab_order_ids' and raw->>'status'<>'resulted' then 'Laboratory work is not resulted' when k='lab_order_ids' then 'Resulted laboratory record lacks a shareable original' else 'Source identity, version, original or clinical review is not eligible' end));
   end if;
  end loop;
 end loop;
 if (select count(*) from jsonb_each(nodes))>10000 then raise exception 'Chart exceeds complete-capture capacity; no partial manifest was created' using errcode='23514';end if;
 perform public.clinical_require_staff();
 return jsonb_build_object('nodes',nodes,'exclusions',excluded,'captured_at',statement_timestamp());
end $$;

create function public.record_request_selection(p_nodes jsonb) returns jsonb language sql immutable set search_path=public as $$
 select coalesce(jsonb_object_agg(family,ids),'{}') from (
  select value->>'family' family,jsonb_agg(value->>'id' order by value->>'id') ids from jsonb_each(p_nodes) group by value->>'family'
 ) s
$$;
create function public.record_request_bounded_preview(p_request public.record_requests,p_nodes jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare selection jsonb:=public.record_request_selection(p_nodes);k text;preview jsonb;original_bytes bigint;report_budget bigint;count_sources integer;previous_context text:=current_setting('lrv.record_request_preview_id',true);
begin
 for k in select jsonb_object_keys(selection) loop
  if jsonb_array_length(selection->k)>(case when k in ('api_attachment_ids','imported_vaccination_ids','imported_prescription_ids','native_prescription_ids','native_dispense_ids') then 20 else 100 end) then return null;end if;
 end loop;
 if jsonb_array_length(coalesce(selection->'document_ids','[]'))+jsonb_array_length(coalesce(selection->'api_attachment_ids','[]'))>24 then return null;end if;
 begin
  perform set_config('lrv.record_request_preview_id',p_request.id::text,true);
  preview:=public.preview_record_release_v13(p_request.pet_id,p_request.client_id,p_request.channel,p_request.recipient,selection);
  perform set_config('lrv.record_request_preview_id',coalesce(previous_context,''),true);
 exception when check_violation then
  perform set_config('lrv.record_request_preview_id',coalesce(previous_context,''),true);
  if SQLERRM in ('Release exceeds maximum reviewed snapshot size','Release exceeds the reviewed snapshot limit; split into smaller packages') then return null;end if;
  raise;
 end;
 select count(*) into count_sources from jsonb_each(p_nodes);
 -- Conservative escaping/markup allowance; production builders still check the actual bytes.
 report_budget:=octet_length((preview->'snapshot')::text)::bigint*12+count_sources::bigint*8192+16384;
 select coalesce(sum(4*((coalesce((a->>'file_size')::bigint,0)+2)/3)+2048),0) into original_bytes from jsonb_array_elements(preview#>'{snapshot,attachments}') a;
 if original_bytes+4*((report_budget+2)/3)+16384>33554432 then return null;end if;
 return preview;
end $$;
create function public.record_request_audit_revision() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.record_request_revisions(request_id,version,snapshot,actor_id) values(NEW.id,NEW.version,to_jsonb(NEW),auth.uid());
 insert into public.audit_logs(user_id,action,table_name,record_id,new_data) values(auth.uid(),TG_OP,'record_requests',NEW.id,to_jsonb(NEW));
 return NEW;
end $$;
create trigger record_request_version before insert or update or delete on public.record_requests for each row execute function public.record_request_revision();
create trigger record_request_audit after insert or update on public.record_requests for each row execute function public.record_request_audit_revision();
do $$declare t text;begin
 foreach t in array array['record_requests','record_request_actions','record_request_revisions','record_request_receipts','record_request_manifests','record_request_packages','record_request_release_links','record_request_recipient_authorizations','record_request_authorization_revocations','record_request_disclosure_policy'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  if t not in ('record_requests','record_request_disclosure_policy') then execute format('create trigger record_request_immutable before update or delete on public.%I for each row execute function public.record_request_immutable()',t);end if;
 end loop;
end $$;

create function public.record_request_intent(p_request_id uuid,p_kind text,p_version integer,p_values jsonb) returns jsonb language sql immutable set search_path=public as $$
 select jsonb_build_object('request_id',p_request_id,'kind',p_kind,'expected_version',p_version,'values',p_values)
$$;
create function public.record_request_recover(p_action_id uuid,p_request_id uuid,p_kind text,p_version integer,p_values jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.record_request_actions;actor uuid:=public.clinical_require_staff();begin
 if p_action_id is null or p_request_id is null or p_values is null or jsonb_typeof(p_values)<>'object' then raise exception 'Bounded request action required' using errcode='23514';end if;
 select * into a from public.record_request_actions where id=p_action_id;
 if not found then return null;end if;
 if a.actor_id<>actor or a.intent is distinct from public.record_request_intent(p_request_id,p_kind,p_version,p_values) then raise exception 'Action identifier conflicts with saved work' using errcode='23505';end if;
 return a.receipt;
end $$;
create function public.record_request_commit_action(p_action_id uuid,p_request_id uuid,p_kind text,p_version integer,p_values jsonb,p_receipt jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 insert into public.record_request_actions(id,request_id,kind,intent,receipt,actor_id)
 values(p_action_id,p_request_id,p_kind,public.record_request_intent(p_request_id,p_kind,p_version,p_values),p_receipt,public.clinical_require_staff());
 return p_receipt;
end $$;
create function public.read_record_request_action(p_action_id uuid,p_request_id uuid,p_kind text,p_expected_version integer,p_values jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
begin return public.record_request_recover(p_action_id,p_request_id,p_kind,p_expected_version,p_values);end $$;

create function public.save_record_request(p_action_id uuid,p_id uuid,p_expected_version integer,p_values jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.record_requests;old_receipt jsonb;k text;pet uuid;client uuid;direction text;v_subset text;v_channel text;v_recipient text;v_recipient_kind text;v_recipient_name text;assigned uuid;ticket uuid;conversation uuid;requested date;due date;
begin
 perform pg_advisory_xact_lock(hashtextextended('record-request-action:'||p_action_id::text,0));
 old_receipt:=public.record_request_recover(p_action_id,p_id,'save',p_expected_version,p_values);if old_receipt is not null then return old_receipt;end if;
 for k in select jsonb_object_keys(p_values) loop if k<>all(array['pet_id','client_id','direction','subset','channel','recipient_kind','recipient_name','recipient_email','requester_name','request_note','requested_on','due_on','assigned_to','ticket_id','conversation_id']) then raise exception 'Unknown request field' using errcode='23514';end if;end loop;
 pet:=public.native_rx_uuid(p_values->'pet_id');client:=public.native_rx_uuid(p_values->'client_id');direction:=p_values->>'direction';v_subset:=p_values->>'subset';v_channel:=nullif(p_values->>'channel','');
 assigned:=public.native_rx_uuid(coalesce(p_values->'assigned_to','null'::jsonb),true);ticket:=public.native_rx_uuid(coalesce(p_values->'ticket_id','null'::jsonb),true);conversation:=public.native_rx_uuid(coalesce(p_values->'conversation_id','null'::jsonb),true);
 requested:=public.care_date(p_values->'requested_on');due:=case when p_values->>'due_on' is null then null else public.care_date(p_values->'due_on') end;
 if pet is null or client is null or direction not in ('incoming','outgoing') or v_subset not in ('full','vaccines','labs','custom') or direction is null or v_subset is null or requested is null
 or length(trim(coalesce(p_values->>'requester_name',''))) not between 1 and 160 or length(coalesce(p_values->>'request_note',''))>2000 or (due is not null and due<requested)
 then raise exception 'Review patient, scope, requester and calendar dates' using errcode='23514';end if;
 if not exists(select 1 from public.pets where id=pet and client_id=client) then raise exception 'Patient does not belong to household' using errcode='42501';end if;
 if assigned is not null and not public.is_active_staff(assigned) then raise exception 'Assignee must be active staff' using errcode='23514';end if;
 if conversation is not null and not exists(select 1 from public.conversations where id=conversation and client_id=client) then raise exception 'Conversation does not belong to household' using errcode='42501';end if;
 if ticket is not null and not exists(select 1 from public.tickets where id=ticket) then raise exception 'Linked ticket is missing' using errcode='23514';end if;
 if ticket is not null and exists(select 1 from public.tickets t join public.conversations c on c.id=t.conversation_id where t.id=ticket and c.client_id is distinct from client) then raise exception 'Ticket conversation belongs to another household' using errcode='42501';end if;
 if direction='outgoing' then
  if v_channel is null or v_channel not in ('EMAIL','SMS') then raise exception 'Choose client email or text' using errcode='23514';end if;
  v_recipient_kind:=coalesce(p_values->>'recipient_kind','client');
  if v_recipient_kind='third_party' then
   v_recipient_name:=trim(coalesce(p_values->>'recipient_name',''));v_recipient:=public.communication_recipient('EMAIL',p_values->>'recipient_email');
   if v_channel<>'EMAIL' or length(v_recipient_name) not between 1 and 160 or v_recipient is null or length(v_recipient)>254 or v_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Named third-party email destination required' using errcode='23514';end if;
  elsif v_recipient_kind='client' then
   select full_name,public.communication_recipient(v_channel,case v_channel when 'EMAIL' then primary_email else primary_phone end) into v_recipient_name,v_recipient from public.clients where id=client;
  else raise exception 'Unknown recipient scope' using errcode='23514';end if;
  if v_recipient is null or v_recipient='' then raise exception 'Verified client contact required' using errcode='23514';end if;
 else v_channel:=null;v_recipient:=null;v_recipient_kind:='client';v_recipient_name:=null;end if;
 select * into r from public.record_requests where id=p_id for update;
 perform public.clinical_require_staff();
 if r.id is null then
  if p_expected_version is not null then raise exception 'Request changed; reload' using errcode='PT409';end if;
  insert into public.record_requests(id,client_id,pet_id,direction,subset,channel,recipient,recipient_kind,recipient_name,requester_name,request_note,requested_on,due_on,assigned_to,ticket_id,conversation_id,created_by,updated_by)
  values(p_id,client,pet,direction,v_subset,v_channel,v_recipient,v_recipient_kind,v_recipient_name,trim(p_values->>'requester_name'),coalesce(p_values->>'request_note',''),requested,due,assigned,ticket,conversation,actor,actor) returning * into r;
 else
  if r.version is distinct from p_expected_version then raise exception 'Request changed; reload' using errcode='PT409';end if;
  if row(r.pet_id,r.client_id,r.direction) is distinct from row(pet,client,direction) then raise exception 'Request association cannot change' using errcode='42501';end if;
  if r.status in ('fulfilled','cancelled') then raise exception 'Closed request cannot be edited' using errcode='23514';end if;
  if r.active_manifest_id is not null and row(r.subset,r.channel,r.recipient,r.recipient_kind,r.recipient_name) is distinct from row(v_subset,v_channel,v_recipient,v_recipient_kind,v_recipient_name) then raise exception 'Frozen package scope or contact changed; cancel and create a new request' using errcode='PT409';end if;
  update public.record_requests set subset=v_subset,channel=v_channel,recipient=v_recipient,recipient_kind=v_recipient_kind,recipient_name=v_recipient_name,requester_name=trim(p_values->>'requester_name'),request_note=coalesce(p_values->>'request_note',''),requested_on=requested,due_on=due,assigned_to=assigned,ticket_id=ticket,conversation_id=conversation where id=r.id returning * into r;
 end if;
 return public.record_request_commit_action(p_action_id,r.id,'save',p_expected_version,p_values,jsonb_build_object('request',to_jsonb(r)));
end $$;

create function public.prepare_record_request_manifest(p_action_id uuid,p_request_id uuid,p_expected_version integer,p_values jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.record_requests;recovered jsonb;inventory jsonb;pool jsonb;selected jsonb;exclusions jsonb;seed text[]:='{}';source record;k text;v text;v_manifest_id uuid;v_component jsonb;current_nodes jsonb:='{}';candidate_nodes jsonb;current_preview jsonb;next_preview jsonb;ordinal integer:=0;summary jsonb;fingerprint text;scoped_expansion boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended('record-request-action:'||p_action_id::text,0));
 recovered:=public.record_request_recover(p_action_id,p_request_id,'manifest',p_expected_version,p_values);if recovered is not null then return recovered;end if;
 if exists(select 1 from jsonb_object_keys(p_values) fields(key) where fields.key<>all(array['manifest_id','selection','review_note'])) or length(trim(coalesce(p_values->>'review_note',''))) not between 1 and 2000 then raise exception 'Review the requested package scope' using errcode='23514';end if;
 v_manifest_id:=public.native_rx_uuid(p_values->'manifest_id');if v_manifest_id is null then raise exception 'Manifest identifier required' using errcode='23514';end if;
 select * into r from public.record_requests where id=p_request_id for update;
 perform public.clinical_require_staff();
 if r.id is null or r.version is distinct from p_expected_version then raise exception 'Request changed; reload' using errcode='PT409';end if;
 if r.direction<>'outgoing' or r.status not in ('requested','preparing','ready') then raise exception 'Outgoing request is not available for preparation' using errcode='23514';end if;
 if r.active_manifest_id is not null and exists(select 1 from public.record_request_packages p join public.record_request_release_links l on l.package_id=p.id where p.manifest_id=r.active_manifest_id) then raise exception 'Confirmed manifest cannot be replaced; create a new request for a different disclosure' using errcode='23514';end if;
 inventory:=public.record_request_inventory(r.pet_id);pool:=inventory->'nodes';exclusions:=inventory->'exclusions';
 if r.subset='custom' then
  if jsonb_typeof(p_values->'selection') is distinct from 'object' then raise exception 'Explicit custom source selection required' using errcode='23514';end if;
  for k in select jsonb_object_keys(p_values->'selection') loop
   if k<>all(public.record_request_families()) or jsonb_typeof(p_values#>array['selection',k])<>'array' or jsonb_array_length(p_values#>array['selection',k])>10000 then raise exception 'Bounded known source families required' using errcode='23514';end if;
   for v in select value from jsonb_array_elements_text(p_values#>array['selection',k]) loop
    if not pool ? (k||':'||v) or (k||':'||v)=any(seed) then raise exception 'Selected source is unavailable or duplicated' using errcode='23514';end if;
    seed:=array_append(seed,k||':'||v);
   end loop;
  end loop;
 else
  if coalesce(p_values->'selection','{}')<>'{}'::jsonb then raise exception 'Preset source selection is server-authoritative' using errcode='23514';end if;
  for source in select * from jsonb_each(pool) order by key loop
   if r.subset='full' or (r.subset='labs' and source.value->>'family' in ('lab_order_ids','lab_report_ids')) or
    (r.subset='vaccines' and (source.value->>'family' in ('certificate_ids','imported_vaccination_ids') or
      (source.value->>'family'='treatment_ids' and exists(select 1 from public.patient_treatments t where t.id=(source.value->>'id')::uuid and t.pet_id=r.pet_id and t.kind='vaccine'))))
   then seed:=array_append(seed,source.key);end if;
  end loop;
 end if;
 if cardinality(seed)=0 then raise exception 'No eligible sources in the requested subset; no partial package was created' using errcode='23514';end if;
 -- Directed closure adds exactly the originals/provenance required by the chosen sources.
 with recursive closure(key) as (
  select unnest(seed)
  union
  select d.value from closure c cross join lateral jsonb_array_elements_text(pool->c.key->'requires') d
 ) select jsonb_object_agg(c.key,pool->c.key order by c.key) into selected from closure c;
 for source in select * from jsonb_each(pool) where not selected ? key order by key loop
  exclusions:=exclusions||jsonb_build_array(jsonb_build_object('family',source.value->>'family','id',source.value->>'id','label',source.value->>'label','reason','Outside the explicitly requested subset'));
 end loop;
 -- Undirected dependency components may not be split across package boundaries.
 for v_component in
  with recursive nodes as materialized (select * from jsonb_each(selected)), edges as materialized (
   select n.key a,d.value b from nodes n cross join lateral jsonb_array_elements_text(n.value->'requires') d
   union select d.value,n.key from nodes n cross join lateral jsonb_array_elements_text(n.value->'requires') d
  ), reach(root,key) as (
   select key,key from nodes
   union select w.root,e.b from reach w join edges e on e.a=w.key
  ), membership as (select key,min(root) component from reach group by key), components as (
   select m.component,jsonb_object_agg(n.key,n.value order by n.key) contents from membership m join nodes n on n.key=m.key group by m.component
  ) select contents from components order by component
 loop
  candidate_nodes:=current_nodes||v_component;
  next_preview:=public.record_request_bounded_preview(r,candidate_nodes);
  if next_preview is null then
   if current_nodes='{}'::jsonb then raise exception 'A connected source/original group exceeds reviewed package capacity; no sources were omitted' using errcode='23514';end if;
   ordinal:=ordinal+1;
   scoped_expansion:=r.subset='labs' and exists(select 1 from jsonb_each(current_nodes) n where n.value->>'family'='external_record_ids' or (n.value->>'family'='document_ids' and n.value->>'document_category'<>'lab_result'));
   insert into public.record_request_packages(id,manifest_id,ordinal,release_id,selection,preview,scope_expansion) values(gen_random_uuid(),v_manifest_id,ordinal,gen_random_uuid(),public.record_request_selection(current_nodes),current_preview,scoped_expansion);
   current_nodes:=v_component;current_preview:=public.record_request_bounded_preview(r,v_component);
   if current_preview is null then raise exception 'A connected source/original group exceeds reviewed package capacity; no sources were omitted' using errcode='23514';end if;
  else current_nodes:=candidate_nodes;current_preview:=next_preview;end if;
 end loop;
 ordinal:=ordinal+1;
 scoped_expansion:=r.subset='labs' and exists(select 1 from jsonb_each(current_nodes) n where n.value->>'family'='external_record_ids' or (n.value->>'family'='document_ids' and n.value->>'document_category'<>'lab_result'));
 insert into public.record_request_packages(id,manifest_id,ordinal,release_id,selection,preview,scope_expansion) values(gen_random_uuid(),v_manifest_id,ordinal,gen_random_uuid(),public.record_request_selection(current_nodes),current_preview,scoped_expansion);
 -- Detect mutable discovery drift rather than labeling a changing chart complete.
 if (public.record_request_inventory(r.pet_id)-'captured_at') is distinct from (inventory-'captured_at') then raise exception 'Chart inventory changed during preparation; review and capture again' using errcode='PT409';end if;
 if exists(
  with emitted as (select k.key family,x.value id from public.record_request_packages p cross join lateral jsonb_each(p.selection) k cross join lateral jsonb_array_elements_text(k.value) x where p.manifest_id=v_manifest_id),
  intended as (select value->>'family' family,value->>'id' id from jsonb_each(selected))
  select 1 from ((select family,id from emitted except select family,id from intended) union all (select family,id from intended except select family,id from emitted) union all (select family,id from emitted group by family,id having count(*)<>1)) mismatch
 ) then raise exception 'Manifest partition does not match selected inventory' using errcode='23514';end if;
 select jsonb_agg(jsonb_build_object('id',p.id,'ordinal',p.ordinal,'release_id',p.release_id,'selection',p.selection,'source_hash',p.preview->>'source_hash','scope_expansion',p.scope_expansion) order by p.ordinal) into summary from public.record_request_packages p where p.manifest_id=v_manifest_id;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('request_id',r.id,'pet_id',r.pet_id,'client_id',r.client_id,'subset',r.subset,'channel',r.channel,'recipient',r.recipient,'recipient_kind',r.recipient_kind,'recipient_name',r.recipient_name,'inventory',selected,'exclusions',exclusions,'packages',summary,'captured_at',inventory->'captured_at')::text,'UTF8')),'hex');
 insert into public.record_request_manifests(id,request_id,subset,channel,recipient,captured_at,inventory,exclusions,fingerprint,package_count,source_count,created_by)
 values(v_manifest_id,r.id,r.subset,r.channel,r.recipient,(inventory->>'captured_at')::timestamptz,selected,exclusions,fingerprint,ordinal,(select count(*) from jsonb_each(selected)),actor);
 update public.record_requests set active_manifest_id=v_manifest_id,status='preparing' where id=r.id returning * into r;
 perform public.clinical_require_staff();
 return public.record_request_commit_action(p_action_id,r.id,'manifest',p_expected_version,p_values,jsonb_build_object('request',to_jsonb(r),'manifest_id',v_manifest_id,'fingerprint',fingerprint,'package_count',ordinal,'source_count',(select count(*) from jsonb_each(selected))));
end $$;

create function public.receive_record_request(p_action_id uuid,p_request_id uuid,p_expected_version integer,p_values jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.record_requests;recovered jsonb;reference jsonb;d public.patient_documents;seen uuid[]:='{}';ids jsonb:='[]';
begin
 perform pg_advisory_xact_lock(hashtextextended('record-request-action:'||p_action_id::text,0));
 recovered:=public.record_request_recover(p_action_id,p_request_id,'receive',p_expected_version,p_values);if recovered is not null then return recovered;end if;
 if exists(select 1 from jsonb_object_keys(p_values) fields(key) where fields.key<>all(array['documents','review_note'])) or jsonb_typeof(p_values->'documents') is distinct from 'array' or jsonb_array_length(p_values->'documents') not between 1 and 100 or length(trim(coalesce(p_values->>'review_note',''))) not between 1 and 2000 then raise exception 'Select actual originals and record the receipt review' using errcode='23514';end if;
 select * into r from public.record_requests where id=p_request_id for update;perform public.clinical_require_staff();
 if r.id is null or r.version is distinct from p_expected_version then raise exception 'Request changed; reload' using errcode='PT409';end if;
 if r.direction<>'incoming' or r.status not in ('requested','awaiting_response','received') then raise exception 'Incoming request is not available for receipt' using errcode='23514';end if;
 for reference in select value from jsonb_array_elements(p_values->'documents') order by value->>'id' loop
  if jsonb_typeof(reference)<>'object' or exists(select 1 from jsonb_object_keys(reference) fields(key) where fields.key<>all(array['id','version'])) then raise exception 'Exact original identity and version required' using errcode='23514';end if;
  select * into d from public.patient_documents where id=public.native_rx_uuid(reference->'id') and pet_id=r.pet_id for share;
  if d.id is null or d.status<>'ready' or d.version is distinct from public.native_rx_revision(reference->'version') or d.id=any(seen) or not exists(select 1 from storage.objects o where o.bucket_id='patient-documents' and o.name=d.file_path and o.metadata->>'size'=d.file_size::text and o.metadata->>'mimetype'=d.mime_type) then raise exception 'Original is missing, changed or belongs to another patient' using errcode='PT409';end if;
  seen:=array_append(seen,d.id);
  insert into public.record_request_receipts(id,request_id,document_id,document_version,original,review_note,created_by)
  values(gen_random_uuid(),r.id,d.id,d.version,to_jsonb(d)-array['file_path','created_by','voided_by'],trim(p_values->>'review_note'),actor);
  ids:=ids||jsonb_build_array(jsonb_build_object('id',d.id,'version',d.version));
 end loop;
 update public.record_requests set status='received' where id=r.id returning * into r;
 return public.record_request_commit_action(p_action_id,r.id,'receive',p_expected_version,p_values,jsonb_build_object('request',to_jsonb(r),'documents',ids));
end $$;

create function public.record_request_deliveries(p_package_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 with package as (select p.*,m.request_id,m.channel,m.recipient from public.record_request_packages p join public.record_request_manifests m on m.id=p.manifest_id join public.record_request_release_links l on l.package_id=p.id and l.release_id=p.release_id where p.id=p_package_id),
 delivery as (
  select o.id,o.state,o.created_at,o.updated_at from package p join public.record_requests r on r.id=p.request_id
  join public.release_email_requests e on e.release_id=p.release_id and e.client_id=r.client_id and e.recipient=p.recipient and e.release_hash=p.preview->>'source_hash'
  join public.release_email_outbox_links l on l.request_id=e.id join public.communication_outbox o on o.id=l.outbox_id and o.client_id=r.client_id and o.channel='EMAIL' and o.recipient=p.recipient and o.created_by=e.actor_id where p.channel='EMAIL'
  union
  select o.id,o.state,o.created_at,o.updated_at from package p join public.record_requests r on r.id=p.request_id
  join public.document_link_grants g on g.family='record_release' and g.source_id=p.release_id and g.source_hash=p.preview->>'source_hash' and g.client_id=r.client_id and g.recipient=p.recipient
  join public.document_link_outbox_links l on l.grant_id=g.id join public.communication_outbox o on o.id=l.outbox_id and o.client_id=r.client_id and o.channel='SMS' and o.recipient=p.recipient and o.created_by=g.actor_id where p.channel='SMS'
 ) select coalesce(jsonb_agg(jsonb_build_object('outbox_id',id,'state',state,'created_at',created_at,'updated_at',updated_at) order by created_at desc,id desc),'[]') from delivery
$$;

create function public.transition_record_request(p_action_id uuid,p_request_id uuid,p_expected_version integer,p_values jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.record_requests;recovered jsonb;target text:=p_values->>'status';proof jsonb:='{}';n integer;previous_context text:=current_setting('lrv.record_request_preview_id',true);
begin
 perform pg_advisory_xact_lock(hashtextextended('record-request-action:'||p_action_id::text,0));
 recovered:=public.record_request_recover(p_action_id,p_request_id,'transition',p_expected_version,p_values);if recovered is not null then return recovered;end if;
 if exists(select 1 from jsonb_object_keys(p_values) fields(key) where fields.key<>all(array['status','review_note'])) or target is null or target not in ('requested','awaiting_response','received','preparing','ready','fulfilled','blocked','cancelled') or length(trim(coalesce(p_values->>'review_note',''))) not between 1 and 2000 then raise exception 'Choose a workflow state and record the reason' using errcode='23514';end if;
 select * into r from public.record_requests where id=p_request_id for update;perform public.clinical_require_staff();
 if r.id is null or r.version is distinct from p_expected_version then raise exception 'Request changed; reload' using errcode='PT409';end if;
 if r.status in ('fulfilled','cancelled') or r.status=target then raise exception 'Closed or unchanged request cannot transition' using errcode='23514';end if;
 if r.direction='incoming' and target in ('fulfilled','received') then
  perform 1 from public.patient_documents where id in (select document_id from public.record_request_receipts where request_id=r.id) order by id for share;
 end if;
 if target='received' then
  if r.direction<>'incoming' or r.status<>'blocked' or not exists(select 1 from public.record_request_receipts where request_id=r.id) or exists(select 1 from public.record_request_receipts e left join public.patient_documents d on d.id=e.document_id and d.pet_id=r.pet_id and d.version=e.document_version and d.status='ready' where e.request_id=r.id and (d.id is null or not exists(select 1 from storage.objects o where o.bucket_id='patient-documents' and o.name=d.file_path and o.metadata->>'size'=d.file_size::text and o.metadata->>'mimetype'=d.mime_type))) then raise exception 'Resume requires verified saved incoming originals' using errcode='23514';end if;
 elsif target='fulfilled' then
  if r.direction='incoming' then
   if r.status<>'received' or not exists(select 1 from public.record_request_receipts where request_id=r.id) or exists(
    select 1 from public.record_request_receipts e left join public.patient_documents d on d.id=e.document_id and d.pet_id=r.pet_id and d.version=e.document_version and d.status='ready'
    where e.request_id=r.id and (d.id is null or not exists(select 1 from storage.objects o where o.bucket_id='patient-documents' and o.name=d.file_path and o.metadata->>'size'=d.file_size::text and o.metadata->>'mimetype'=d.mime_type))
   ) then raise exception 'Verify the actual received originals before fulfillment' using errcode='PT409';end if;
   select jsonb_build_object('documents',jsonb_agg(jsonb_build_object('id',document_id,'version',document_version) order by document_id)) into proof from public.record_request_receipts where request_id=r.id;
  else
   if r.status<>'ready' or r.active_manifest_id is null or exists(
    select 1 from public.record_request_packages p where p.manifest_id=r.active_manifest_id and not exists(select 1 from jsonb_array_elements(public.record_request_deliveries(p.id)) d where d->>'state'='delivered')
   ) then raise exception 'Every numbered package needs provider-confirmed delivery; preparation or acceptance is not delivery' using errcode='23514';end if;
   select jsonb_build_object('packages',jsonb_agg(jsonb_build_object('package_id',p.id,'release_id',p.release_id,'deliveries',public.record_request_deliveries(p.id)) order by p.ordinal),'recipient_read_confirmed',false) into proof from public.record_request_packages p where p.manifest_id=r.active_manifest_id;
  end if;
 elsif target not in ('blocked','cancelled') then
  if r.direction='incoming' then
   if target not in ('requested','awaiting_response') or (r.status='received' and target='requested') then raise exception 'Incoming workflow requires actual original receipt' using errcode='23514';end if;
  else
   if r.status<>'blocked' then raise exception 'Preparation and readiness come from reviewed package actions' using errcode='23514';end if;
   select count(*) into n from public.record_request_packages p join public.record_request_release_links l on l.package_id=p.id where p.manifest_id=r.active_manifest_id;
   if target is distinct from (case when r.active_manifest_id is null then 'requested' when n=(select package_count from public.record_request_manifests where id=r.active_manifest_id) then 'ready' else 'preparing' end) then raise exception 'Resume the actual saved package state' using errcode='23514';end if;
  end if;
 end if;
 -- Cancellation does not acquire any outbox or clinical-source lock. Final authorization
 -- takes SHARE on this row; a provider call already started is not recalled.
 update public.record_requests set status=target where id=r.id returning * into r;
 return public.record_request_commit_action(p_action_id,r.id,'transition',p_expected_version,p_values,jsonb_build_object('request',to_jsonb(r),'evidence',proof));
end $$;

create function public.confirm_record_request_package(p_action_id uuid,p_request_id uuid,p_expected_version integer,p_values jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.record_requests;m public.record_request_manifests;p public.record_request_packages;recovered jsonb;release public.record_releases;n integer;previous_context text:=current_setting('lrv.record_request_preview_id',true);
begin
 perform pg_advisory_xact_lock(hashtextextended('record-request-action:'||p_action_id::text,0));
 recovered:=public.record_request_recover(p_action_id,p_request_id,'confirm',p_expected_version,p_values);if recovered is not null then return recovered;end if;
 if exists(select 1 from jsonb_object_keys(p_values) fields(key) where fields.key<>all(array['package_id','manifest_hash','attest_review','attest_scope_expansion'])) or p_values->'attest_review' is distinct from 'true'::jsonb then raise exception 'Review exact package contents and recipient' using errcode='23514';end if;
 select * into r from public.record_requests where id=p_request_id for update;perform public.clinical_require_staff();
 if r.id is null or r.version is distinct from p_expected_version then raise exception 'Request changed; reload' using errcode='PT409';end if;
 select * into m from public.record_request_manifests where id=r.active_manifest_id and request_id=r.id;
 select * into p from public.record_request_packages where id=public.native_rx_uuid(p_values->'package_id') and manifest_id=m.id;
 if r.direction<>'outgoing' or r.status<>'preparing' or m.id is null or p.id is null or m.fingerprint is distinct from p_values->>'manifest_hash' or row(m.subset,m.channel,m.recipient) is distinct from row(r.subset,r.channel,r.recipient) then raise exception 'Request scope or numbered manifest changed' using errcode='PT409';end if;
 if p.scope_expansion and p_values->'attest_scope_expansion' is distinct from 'true'::jsonb then raise exception 'Review the additional required original/provenance disclosure' using errcode='23514';end if;
 if exists(select 1 from public.record_request_release_links where package_id=p.id) then raise exception 'Package was already confirmed; inspect saved history' using errcode='23505';end if;
 if not public.record_request_authorization_current(r.id,m.id) then raise exception 'Current recipient authority and disclosure review required' using errcode='42501';end if;
 perform set_config('lrv.record_request_preview_id',r.id::text,true);
 release:=public.confirm_record_release_without_record_request(p.release_id,r.pet_id,r.client_id,m.channel,m.recipient,p.selection,p.preview->'snapshot',p.preview->>'source_hash',true);
 perform set_config('lrv.record_request_preview_id',coalesce(previous_context,''),true);
 if not public.record_request_authorization_current(r.id,m.id) then raise exception 'Recipient authorization changed during confirmation' using errcode='42501';end if;
 if release.source_hash is distinct from p.preview->>'source_hash' or release.selection is distinct from p.selection then raise exception 'Release does not match numbered package' using errcode='23514';end if;
 insert into public.record_request_release_links(package_id,release_id,created_by) values(p.id,release.id,actor);
 select count(*) into n from public.record_request_packages pkg join public.record_request_release_links l on l.package_id=pkg.id where pkg.manifest_id=m.id;
 update public.record_requests set status=case when n=m.package_count then 'ready' else 'preparing' end where id=r.id returning * into r;
 return public.record_request_commit_action(p_action_id,r.id,'confirm',p_expected_version,p_values,jsonb_build_object('request',to_jsonb(r),'package_id',p.id,'release_id',release.id,'ordinal',p.ordinal,'package_count',m.package_count));
end $$;

create function public.authorize_record_request_recipient(p_action_id uuid,p_request_id uuid,p_expected_version integer,p_values jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.record_requests;m public.record_request_manifests;recovered jsonb;authorization_id uuid;document_id uuid;document_version integer;d public.patient_documents;expiry date;expires timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended('record-request-action:'||p_action_id::text,0));
 recovered:=public.record_request_recover(p_action_id,p_request_id,'authorize',p_expected_version,p_values);if recovered is not null then return recovered;end if;
 if exists(select 1 from jsonb_object_keys(p_values) fields(key) where fields.key<>all(array['authorization_id','manifest_hash','client_authority','destination_verification','evidence_document_id','evidence_document_version','expires_on','attest_client_authority','attest_destination','attest_source_scope'])) or p_values->'attest_client_authority' is distinct from 'true'::jsonb or p_values->'attest_destination' is distinct from 'true'::jsonb or p_values->'attest_source_scope' is distinct from 'true'::jsonb
 or length(trim(coalesce(p_values->>'client_authority',''))) not between 1 and 2000 or length(trim(coalesce(p_values->>'destination_verification',''))) not between 1 and 2000 then raise exception 'Independently verify client authority, destination and exact source scope' using errcode='23514';end if;
 authorization_id:=public.native_rx_uuid(p_values->'authorization_id');document_id:=public.native_rx_uuid(coalesce(p_values->'evidence_document_id','null'::jsonb),true);document_version:=public.native_rx_revision(coalesce(p_values->'evidence_document_version','null'::jsonb));expiry:=public.care_date(p_values->'expires_on');
 expires:=((expiry+1)::timestamp at time zone 'America/Denver');
 if authorization_id is null or expires is null or expires<=clock_timestamp() or expiry>(clock_timestamp() at time zone 'America/Denver')::date+366 or (document_id is null)<>(document_version is null) then raise exception 'Exact authority evidence and a future expiry within one year are required' using errcode='23514';end if;
 select * into r from public.record_requests where id=p_request_id for update;perform public.clinical_require_staff();
 if r.id is null or r.version is distinct from p_expected_version then raise exception 'Request changed; reload' using errcode='PT409';end if;
 select * into m from public.record_request_manifests where id=r.active_manifest_id and request_id=r.id;
 if r.direction<>'outgoing' or r.recipient_kind<>'third_party' or r.channel<>'EMAIL' or r.status<>'preparing' or m.id is null or m.fingerprint is distinct from p_values->>'manifest_hash' then raise exception 'Review the current third-party manifest' using errcode='PT409';end if;
 if document_id is not null then
  select * into d from public.patient_documents where id=document_id and pet_id=r.pet_id and status='ready' and version=document_version for share;
  if d.id is null or not exists(select 1 from storage.objects o where o.bucket_id='patient-documents' and o.name=d.file_path and o.metadata->>'size'=d.file_size::text and o.metadata->>'mimetype'=d.mime_type) then raise exception 'Authority evidence original is unavailable' using errcode='PT409';end if;
 end if;
 insert into public.record_request_recipient_authorizations(id,request_id,manifest_id,manifest_hash,recipient_name,recipient,client_authority,destination_verification,evidence_document_id,evidence_document_version,expires_at,created_by)
 values(authorization_id,r.id,m.id,m.fingerprint,r.recipient_name,r.recipient,trim(p_values->>'client_authority'),trim(p_values->>'destination_verification'),document_id,document_version,expires,actor);
 update public.record_requests set request_note=record_requests.request_note where id=r.id returning * into r;
 return public.record_request_commit_action(p_action_id,r.id,'authorize',p_expected_version,p_values,jsonb_build_object('request',to_jsonb(r),'authorization_id',authorization_id,'manifest_hash',m.fingerprint,'expires_at',expires));
end $$;
create function public.revoke_record_request_authorization(p_action_id uuid,p_request_id uuid,p_expected_version integer,p_values jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.record_requests;a public.record_request_recipient_authorizations;recovered jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('record-request-action:'||p_action_id::text,0));
 recovered:=public.record_request_recover(p_action_id,p_request_id,'revoke_authorization',p_expected_version,p_values);if recovered is not null then return recovered;end if;
 if exists(select 1 from jsonb_object_keys(p_values) fields(key) where fields.key<>all(array['authorization_id','review_note'])) or length(trim(coalesce(p_values->>'review_note',''))) not between 1 and 2000 then raise exception 'Record the revocation reason' using errcode='23514';end if;
 select * into r from public.record_requests where id=p_request_id for update;perform public.clinical_require_staff();
 if r.id is null or r.version is distinct from p_expected_version then raise exception 'Request changed; reload' using errcode='PT409';end if;
 select * into a from public.record_request_recipient_authorizations where id=public.native_rx_uuid(p_values->'authorization_id') and request_id=r.id;
 if a.id is null then raise exception 'Authorization does not belong to request' using errcode='42501';end if;
 insert into public.record_request_authorization_revocations(authorization_id,reason,created_by) values(a.id,trim(p_values->>'review_note'),actor);
 update public.record_requests set request_note=record_requests.request_note where id=r.id returning * into r;
 return public.record_request_commit_action(p_action_id,r.id,'revoke_authorization',p_expected_version,p_values,jsonb_build_object('request',to_jsonb(r),'authorization_id',a.id,'revoked',true));
end $$;

create function public.record_request_authorization_current(p_request_id uuid,p_manifest_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare r public.record_requests;a public.record_request_recipient_authorizations;d public.patient_documents;
begin
 select * into r from public.record_requests where id=p_request_id for share;
 if p_manifest_id is null or r.id is null or r.direction<>'outgoing' or r.active_manifest_id is distinct from p_manifest_id or r.status in ('blocked','cancelled') then return false;end if;
 if r.recipient_kind='client' then return true;end if;
 perform 1 from public.record_request_disclosure_policy where id and enabled and accepted_at<=clock_timestamp() for share;
 if not found then return false;end if;
 select * into a from public.record_request_recipient_authorizations where request_id=r.id and manifest_id=p_manifest_id;
 if a.id is null or a.recipient is distinct from r.recipient or a.recipient_name is distinct from r.recipient_name or a.expires_at<=clock_timestamp()
 or a.manifest_hash is distinct from (select fingerprint from public.record_request_manifests where id=p_manifest_id)
 or exists(select 1 from public.record_request_authorization_revocations where authorization_id=a.id) then return false;end if;
 if a.evidence_document_id is not null then
  select * into d from public.patient_documents where id=a.evidence_document_id and pet_id=r.pet_id and status='ready' and version=a.evidence_document_version for share;
  if d.id is null or not exists(select 1 from storage.objects o where o.bucket_id='patient-documents' and o.name=d.file_path and o.metadata->>'size'=d.file_size::text and o.metadata->>'mimetype'=d.mime_type) then return false;end if;
 end if;
 return true;
end $$;

-- A private transaction-local pointer selects draft preview context. It does NOT
-- authorize disclosure: confirmation and transport independently require stored
-- package association, current client authority, destination and manifest hash.
create function public.record_request_preview_recipient(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text) returns jsonb language plpgsql security definer set search_path=public as $$
declare context text:=current_setting('lrv.record_request_preview_id',true);r public.record_requests;c public.clients;
begin
 if context is null or context !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return null;end if;
 select * into r from public.record_requests where id=context::uuid and pet_id=p_pet_id and client_id=p_client_id and recipient_kind='third_party' and channel='EMAIL' and channel=p_channel and recipient=p_recipient and status not in ('blocked','cancelled');
 if r.id is null or (auth.uid() is not null and not public.is_active_staff(auth.uid())) then return null;end if;
 if auth.uid() is null and not public.record_request_authorization_current(r.id,r.active_manifest_id) then return null;end if;
 select * into c from public.clients where id=r.client_id;
 return jsonb_build_object('client_id',c.id,'client_version',c.version,'name',r.recipient_name,'channel','EMAIL','address',r.recipient,'recipient_kind','third_party','record_request_id',r.id,'authorizing_client_name',c.full_name);
end $$;

-- Change one audited private clinical-core recipient comparison. General message,
-- invoice and public legacy preview APIs retain their household recipient boundary.
do $$declare d text;needle text;recipient_object text;begin
 d:=pg_get_functiondef('public.preview_record_release_v1(uuid,uuid,text,text,jsonb)'::regprocedure);
 needle:='recipient is distinct from public.communication_recipient(p_channel,case when p_channel=''EMAIL'' then owner.primary_email else owner.primary_phone end)';
 recipient_object:='jsonb_build_object(''client_id'',owner.id,''client_version'',owner.version,''name'',owner.full_name,''channel'',p_channel,''address'',recipient)';
 if position(needle in d)=0 or position(recipient_object in d)=0 then raise exception 'Reviewed private recipient boundary changed';end if;
 d:=replace(d,needle,'('||needle||' and public.record_request_preview_recipient(p_pet_id,p_client_id,p_channel,recipient) is null)');
 d:=replace(d,recipient_object,'coalesce(public.record_request_preview_recipient(p_pet_id,p_client_id,p_channel,recipient),'||recipient_object||')');
 execute d;
end $$;

alter function public.confirm_record_release(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean) rename to confirm_record_release_without_record_request;
create function public.confirm_record_release(p_id uuid,p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb,p_reviewed_snapshot jsonb,p_reviewed_hash text,p_attest_review boolean) returns public.record_releases language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();p public.record_request_packages;result public.record_releases;previous_context text:=current_setting('lrv.record_request_preview_id',true);
begin
 -- Retain exact original receipt recovery even after cancellation/revocation.
 if exists(select 1 from public.record_releases where id=p_id) then return public.confirm_record_release_without_record_request(p_id,p_pet_id,p_client_id,p_channel,p_recipient,p_selection,p_reviewed_snapshot,p_reviewed_hash,p_attest_review);end if;
 select * into p from public.record_request_packages where release_id=p_id;
 if p.id is not null then
  raise exception 'Numbered releases must be confirmed through their records request' using errcode='42501';
 else
  if p_reviewed_snapshot#>>'{recipient,recipient_kind}'='third_party' then raise exception 'Third-party releases require an authorized numbered request package' using errcode='42501';end if;
  perform set_config('lrv.record_request_preview_id','',true);
 end if;
 result:=public.confirm_record_release_without_record_request(p_id,p_pet_id,p_client_id,p_channel,p_recipient,p_selection,p_reviewed_snapshot,p_reviewed_hash,p_attest_review);
 perform set_config('lrv.record_request_preview_id',coalesce(previous_context,''),true);
 return result;
end $$;

create function public.record_request_package_context(p_package_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('manifest_id',m.id,'manifest_hash',m.fingerprint,'ordinal',p.ordinal,'package_count',m.package_count,'captured_at',m.captured_at,'recipient_kind',r.recipient_kind,'recipient_name',r.recipient_name,
  'authorization',case when a.id is null then null else jsonb_build_object('id',a.id,'recorded_at',a.created_at,'expires_at',a.expires_at,'recorded_by_name',coalesce(pr.full_name,'')) end)
 from public.record_request_packages p join public.record_request_manifests m on m.id=p.manifest_id join public.record_requests r on r.id=m.request_id
 left join public.record_request_recipient_authorizations a on a.manifest_id=m.id left join public.profiles pr on pr.id=a.created_by where p.id=p_package_id
$$;
alter function public.release_read_internal(uuid) rename to release_read_internal_without_record_request;
create function public.release_read_internal(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.record_request_packages;m public.record_request_manifests;r public.record_requests;result jsonb;allowed boolean;previous_context text:=current_setting('lrv.record_request_preview_id',true);
begin
 select packages.* into p from public.record_request_release_links l join public.record_request_packages packages on packages.id=l.package_id where l.release_id=p_id;
 if p.id is not null then
  select * into m from public.record_request_manifests where id=p.manifest_id;
  select * into r from public.record_requests where id=m.request_id for share;
  allowed:=public.record_request_authorization_current(r.id,m.id);
  perform set_config('lrv.record_request_preview_id',r.id::text,true);
 else
  -- Unbound legacy artifacts cannot inherit another request's transaction context.
  perform set_config('lrv.record_request_preview_id','',true);
 end if;
 result:=public.release_read_internal_without_record_request(p_id);
 if p.id is not null then
  if not allowed or not public.record_request_authorization_current(r.id,m.id) then result:=result||jsonb_build_object('eligible',false,'ineligibility_reason','Records request or recipient authorization no longer permits disclosure');end if;
  result:=result||jsonb_build_object('package_context',public.record_request_package_context(p.id));
 end if;
 perform set_config('lrv.record_request_preview_id',coalesce(previous_context,''),true);
 return result;
end $$;

create function public.record_request_bound_release(p_release_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare p public.record_request_packages;m public.record_request_manifests;
begin
 select packages.* into p from public.record_request_release_links l join public.record_request_packages packages on packages.id=l.package_id where l.release_id=p_release_id;
 if p.id is null then return true;end if;
 select * into m from public.record_request_manifests where id=p.manifest_id;
 return public.record_request_authorization_current(m.request_id,m.id);
end $$;
alter function public.release_email_context(uuid) rename to release_email_context_without_record_request;
create function public.release_email_context(p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare release_id uuid;result jsonb;begin
 select e.release_id into release_id from public.release_email_requests e where e.id=p_request_id;
 if release_id is not null and not public.record_request_bound_release(release_id) then raise exception 'Records request no longer permits email delivery' using errcode='42501';end if;
 result:=public.release_email_context_without_record_request(p_request_id);
 if release_id is not null and not public.record_request_bound_release(release_id) then raise exception 'Records request authorization expired during delivery validation' using errcode='42501';end if;
 return result;
end $$;
alter function public.document_link_current(uuid) rename to document_link_current_without_record_request;
create function public.document_link_current(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare g public.document_link_grants;result jsonb;begin
 select * into g from public.document_link_grants where id=p_id;
 if g.family='record_release' and not public.record_request_bound_release(g.source_id) then raise exception 'Records request no longer permits document retrieval' using errcode='42501';end if;
 result:=public.document_link_current_without_record_request(p_id);
 if g.family='record_release' and not public.record_request_bound_release(g.source_id) then raise exception 'Records request authorization expired during retrieval validation' using errcode='42501';end if;
 return result;
end $$;

create function public.record_request_outbox_recipient_allowed(p_outbox_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare r public.record_requests;m public.record_request_manifests;begin
 select requests.* into r from public.communication_outbox o join public.release_email_outbox_links l on l.outbox_id=o.id
 join public.release_email_requests e on e.id=l.request_id and e.client_id=o.client_id and e.recipient=o.recipient and e.actor_id=o.created_by
 join public.record_request_release_links link on link.release_id=e.release_id join public.record_request_packages p on p.id=link.package_id and p.preview->>'source_hash'=e.release_hash
 join public.record_request_manifests manifests on manifests.id=p.manifest_id join public.record_requests requests on requests.id=manifests.request_id and requests.client_id=o.client_id and requests.recipient=o.recipient
 where o.id=p_outbox_id and o.channel='EMAIL' and requests.recipient_kind='third_party';
 if r.id is null then return false;end if;
 select manifests.* into m from public.record_request_manifests manifests where manifests.id=r.active_manifest_id;
 return public.record_request_authorization_current(r.id,m.id);
end $$;

create function public.record_request_prepared_recipient_allowed(p_actor uuid,p_id uuid,p_conversation uuid,p_recipient text,p_subject text,p_body text) returns boolean language plpgsql security definer set search_path=public as $$
declare r public.record_requests;m public.record_request_manifests;begin
 select requests.* into r from public.release_email_requests e join public.record_request_release_links l on l.release_id=e.release_id
 join public.record_request_packages p on p.id=l.package_id and p.preview->>'source_hash'=e.release_hash
 join public.record_request_manifests manifests on manifests.id=p.manifest_id
 join public.record_requests requests on requests.id=manifests.request_id and requests.client_id=e.client_id and requests.recipient=e.recipient
 where e.id=p_id and e.actor_id=p_actor and e.conversation_id=p_conversation and e.recipient=p_recipient and e.subject=p_subject and e.body=p_body
 and e.state='ready' and requests.recipient_kind='third_party';
 if r.id is null then return false;end if;
 select * into m from public.record_request_manifests where id=r.active_manifest_id;
 return public.record_request_authorization_current(r.id,m.id);
end $$;
create function public.record_request_outbox_current(p_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare release_id uuid;begin
 select e.release_id into release_id from public.release_email_outbox_links l join public.release_email_requests e on e.id=l.request_id where l.outbox_id=p_id;
 if release_id is null then select g.source_id into release_id from public.document_link_outbox_links l join public.document_link_grants g on g.id=l.grant_id where l.outbox_id=p_id and g.family='record_release';end if;
 return release_id is null or public.record_request_bound_release(release_id);
end $$;
-- Extend only the typed release-email path; ordinary inbox/invoice recipients stay unchanged.
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.enqueue_prepared_communication_internal(uuid,uuid,uuid,text,text,text,text,uuid[])'::regprocedure);
 needle:='recipient is distinct from public.communication_recipient(p_channel,case when p_channel=''EMAIL'' then client.primary_email else client.primary_phone end)';
 if strpos(d,needle)=0 then raise exception 'Prepared recipient guard changed';end if;
 d:=replace(d,needle,'('||needle||' and not (p_channel=''EMAIL'' and public.record_request_prepared_recipient_allowed(actor,p_request_id,p_conversation_id,recipient,p_subject,p_body)))');execute d;
 d:=pg_get_functiondef('public.start_communication_attempt_without_reminder_guard(uuid,uuid,jsonb)'::regprocedure);
 needle:='or not exists(select 1 from public.clients c where c.id=result.client_id and public.communication_recipient(result.channel,case when result.channel=''EMAIL'' then c.primary_email else c.primary_phone end)=result.recipient)';
 if strpos(d,needle)=0 then raise exception 'Final attempt recipient guard changed';end if;
 d:=replace(d,needle,'or not public.record_request_outbox_current(result.id) or (not exists(select 1 from public.clients c where c.id=result.client_id and public.communication_recipient(result.channel,case when result.channel=''EMAIL'' then c.primary_email else c.primary_phone end)=result.recipient) and not public.record_request_outbox_recipient_allowed(result.id))');execute d;
end $$;

create function public.list_record_requests(p_filter jsonb default '{}',p_before jsonb default null,p_limit integer default 50) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;begin
 perform public.clinical_require_staff();
 if p_limit is null or p_limit not between 1 and 50 or jsonb_typeof(p_filter) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_filter) k where k<>all(array['pet_id','client_id','ticket_id','status','direction','assigned_to','overdue']))
 or (p_before is not null and (jsonb_typeof(p_before)<>'object' or p_before-array['updated_at','id']<>'{}')) then raise exception 'Bounded queue filters required' using errcode='23514';end if;
 with rows as materialized (
 select r.*,p.name pet_name,c.full_name client_name,coalesce(a.full_name,'') assignee_name
 from public.record_requests r join public.pets p on p.id=r.pet_id join public.clients c on c.id=r.client_id left join public.profiles a on a.id=r.assigned_to
 where (not p_filter?'pet_id' or r.pet_id=public.native_rx_uuid(p_filter->'pet_id')) and (not p_filter?'client_id' or r.client_id=public.native_rx_uuid(p_filter->'client_id'))
 and (not p_filter?'ticket_id' or r.ticket_id=public.native_rx_uuid(p_filter->'ticket_id')) and (not p_filter?'status' or r.status=p_filter->>'status')
 and (not p_filter?'direction' or r.direction=p_filter->>'direction') and (not p_filter?'assigned_to' or r.assigned_to=public.native_rx_uuid(p_filter->'assigned_to'))
 and (coalesce((p_filter->>'overdue')::boolean,false)=false or (r.due_on<(clock_timestamp() at time zone 'America/Denver')::date and r.status not in ('fulfilled','cancelled')))
 and (p_before is null or row(r.updated_at,r.id)<row((p_before->>'updated_at')::timestamptz,public.native_rx_uuid(p_before->'id')))
 order by r.updated_at desc,r.id desc limit p_limit+1
 ), page as (select * from rows order by updated_at desc,id desc limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page) order by updated_at desc,id desc) from page),'[]'),
 'next',case when (select count(*) from rows)>p_limit then (select jsonb_build_object('id',id,'updated_at',updated_at) from page order by updated_at,id limit 1) else null end) into result;
 return result;
end $$;
create function public.read_record_request(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.record_requests;m public.record_request_manifests;result jsonb;begin
 perform public.clinical_require_staff();select * into r from public.record_requests where id=p_id;if r.id is null then return null;end if;
 select * into m from public.record_request_manifests where id=r.active_manifest_id;
 result:=jsonb_build_object('request',to_jsonb(r),'pet_name',(select name from public.pets where id=r.pet_id),'client_name',(select full_name from public.clients where id=r.client_id),
 'manifest',case when m.id is null then null else to_jsonb(m)-'inventory'-'exclusions' end,
 'receipt_count',(select count(*) from public.record_request_receipts where request_id=r.id),
 'disclosure_policy_accepted',exists(select 1 from public.record_request_disclosure_policy where id and enabled and accepted_at<=clock_timestamp()),
 'authorization',(select to_jsonb(a)||jsonb_build_object('revoked',exists(select 1 from public.record_request_authorization_revocations where authorization_id=a.id),'current',public.record_request_authorization_current(r.id,m.id)) from public.record_request_recipient_authorizations a where a.manifest_id=m.id));
 return result;
end $$;
create function public.list_record_request_packages(p_request_id uuid,p_manifest_id uuid,p_after integer default 0,p_limit integer default 20) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;begin
 perform public.clinical_require_staff();if p_after is null or p_limit is null or p_after<0 or p_limit not between 1 and 20 then raise exception 'Bounded package page required' using errcode='23514';end if;
 if not exists(select 1 from public.record_request_manifests where id=p_manifest_id and request_id=p_request_id) then raise exception 'Manifest belongs to another request' using errcode='42501';end if;
 with rows as materialized (select p.id,p.ordinal,p.release_id,p.selection,p.scope_expansion,p.preview->>'source_hash' source_hash,l.package_id is not null confirmed,public.record_request_deliveries(p.id) deliveries from public.record_request_packages p left join public.record_request_release_links l on l.package_id=p.id where p.manifest_id=p_manifest_id and p.ordinal>p_after order by p.ordinal limit p_limit+1),page as (select * from rows order by ordinal limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page) order by ordinal) from page),'[]'),'next',case when (select count(*) from rows)>p_limit then (select max(ordinal) from page) else null end) into result;return result;
end $$;
create function public.read_record_request_package(p_request_id uuid,p_package_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.record_request_packages;m public.record_request_manifests;begin
 perform public.clinical_require_staff();select * into p from public.record_request_packages where id=p_package_id;select * into m from public.record_request_manifests where id=p.manifest_id and request_id=p_request_id;
 if m.id is null then raise exception 'Package belongs to another request' using errcode='42501';end if;
 return to_jsonb(p)||jsonb_build_object('package_context',public.record_request_package_context(p.id),'confirmed',exists(select 1 from public.record_request_release_links where package_id=p.id),'deliveries',public.record_request_deliveries(p.id));
end $$;
create function public.list_record_request_evidence(p_id uuid,p_kind text,p_after integer default 0,p_limit integer default 50) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.record_requests;items jsonb;total integer;begin
 perform public.clinical_require_staff();select * into r from public.record_requests where id=p_id;
 if r.id is null then raise exception 'Request unavailable' using errcode='42501';end if;
 if p_after is null or p_limit is null or p_kind is null or p_after<0 or p_limit not between 1 and 50 or p_kind not in ('sources','exclusions','receipts','history') then raise exception 'Bounded evidence page required' using errcode='23514';end if;
 if p_kind='history' then
  select count(*) into total from public.record_request_revisions where request_id=r.id;
  select coalesce(jsonb_agg(to_jsonb(x) order by version desc),'[]') into items from (select v.version,v.snapshot,v.actor_id,v.created_at,(select jsonb_build_object('kind',a.kind,'review_note',coalesce(a.intent#>>'{values,review_note}',a.intent#>>'{values,client_authority}','Request details saved'),'ordinal',a.receipt->'ordinal') from public.record_request_actions a where a.request_id=v.request_id and a.receipt#>>'{request,version}'=v.version::text order by a.created_at desc,a.id desc limit 1) action from public.record_request_revisions v where v.request_id=r.id order by v.version desc offset p_after limit p_limit) x;
 elsif p_kind='receipts' then
  select count(*) into total from public.record_request_receipts where request_id=r.id;
  select coalesce(jsonb_agg(to_jsonb(x) order by created_at,id),'[]') into items from (select e.*,d.status='ready' and d.version=e.document_version and exists(select 1 from storage.objects o where o.bucket_id='patient-documents' and o.name=d.file_path and o.metadata->>'size'=d.file_size::text and o.metadata->>'mimetype'=d.mime_type) current_available from public.record_request_receipts e join public.patient_documents d on d.id=e.document_id where e.request_id=r.id order by e.created_at,e.id offset p_after limit p_limit) x;
 elsif p_kind='exclusions' then
  select jsonb_array_length(exclusions) into total from public.record_request_manifests where id=r.active_manifest_id;
  select coalesce(jsonb_agg(value order by ordinal),'[]') into items from public.record_request_manifests m cross join lateral jsonb_array_elements(m.exclusions) with ordinality x(value,ordinal) where m.id=r.active_manifest_id and ordinal>p_after and ordinal<=p_after+p_limit;
 else
  with pool as (select public.record_request_inventory(r.pet_id)->'nodes' nodes), nodes as (select key,value from pool cross join lateral jsonb_each(nodes)) select count(*) into total from nodes;
  select coalesce(jsonb_agg(x.value order by x.key),'[]') into items from (select key,value-'requires'-'file_size'-'mime_type' value from jsonb_each(public.record_request_inventory(r.pet_id)->'nodes') order by key offset p_after limit p_limit) x;
 end if;
 return jsonb_build_object('items',items,'next',case when p_after+p_limit<coalesce(total,0) then p_after+p_limit else null end);
end $$;
create function public.record_request_choices(p_search text default '',p_pet_id uuid default null,p_client_id uuid default null,p_after uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform public.clinical_require_staff();if p_search is null or length(p_search)>160 then raise exception 'Bounded patient search required' using errcode='23514';end if;
 return jsonb_build_object('patients',coalesce((select jsonb_agg(to_jsonb(x) order by id) from (select p.id,p.name,p.client_id,c.full_name client_name from public.pets p join public.clients c on c.id=p.client_id where (p_pet_id is null or p.id=p_pet_id) and (p_client_id is null or p.client_id=p_client_id) and (p_after is null or p.id>p_after) and (p_search='' or strpos(lower(p.name||' '||c.full_name),lower(p_search))>0) order by p.id limit 51) x),'[]'),
 'staff',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',full_name) order by full_name,id) from public.profiles where public.is_active_staff(id)),'[]'));
end $$;
create function public.list_record_request_documents(p_request_id uuid,p_after uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.record_requests;begin
 perform public.clinical_require_staff();select * into r from public.record_requests where id=p_request_id;if r.id is null then raise exception 'Request unavailable' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by id) from (select d.id,d.version,d.file_name,d.category,d.created_at from public.patient_documents d where d.pet_id=r.pet_id and d.status='ready' and (p_after is null or d.id>p_after) and exists(select 1 from storage.objects o where o.bucket_id='patient-documents' and o.name=d.file_path and o.metadata->>'size'=d.file_size::text and o.metadata->>'mimetype'=d.mime_type) order by d.id limit 51) x),'[]');
end $$;
-- Every new security-definer helper and renamed core is private. Only explicit staff RPCs are exposed.
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and (proname like 'record_request_%' or proname in ('save_record_request','read_record_request','read_record_request_action','prepare_record_request_manifest','receive_record_request','transition_record_request','confirm_record_request_package','authorize_record_request_recipient','revoke_record_request_authorization','list_record_requests','list_record_request_packages','read_record_request_package','list_record_request_evidence','list_record_request_documents','confirm_record_release_without_record_request','release_read_internal_without_record_request','release_email_context_without_record_request','document_link_current_without_record_request','release_read_internal','release_email_context','document_link_current')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('save_record_request','read_record_request','read_record_request_action','prepare_record_request_manifest','receive_record_request','transition_record_request','confirm_record_request_package','authorize_record_request_recipient','revoke_record_request_authorization','list_record_requests','list_record_request_packages','read_record_request_package','list_record_request_evidence','list_record_request_documents','record_request_choices') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
revoke all on function public.confirm_record_release(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.confirm_record_release(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean) to authenticated;

create function public.record_request_policy_audit() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.audit_logs(user_id,action,table_name,record_id,new_data) values(auth.uid(),TG_OP,'record_request_disclosure_policy','00000000-0000-4000-8000-000000000001',case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end);
 return coalesce(NEW,OLD);
end $$;
revoke all on function public.record_request_policy_audit() from public,anon,authenticated,service_role;
create trigger record_request_policy_audit after insert or update or delete on public.record_request_disclosure_policy for each row execute function public.record_request_policy_audit();
