-- Explicit reviewed API evidence; never a patient-document or manual-export promotion.
create table public.ezyvet_attachment_review_actions (
 id uuid primary key,action text not null check(action in('approve','acknowledge','withdraw')),
 actor_id uuid not null references auth.users(id),pet_id uuid not null references public.pets(id),
 payload jsonb not null,request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 status text not null check(status in('committed','abandoned')),created_at timestamptz not null default clock_timestamp()
);
create table public.ezyvet_attachment_review_records (
 id uuid primary key,action_id uuid not null unique references public.ezyvet_attachment_review_actions(id),
 approved_by uuid not null references auth.users(id),approved_at timestamptz not null,
 pet_id uuid not null references public.pets(id),client_id uuid not null references public.clients(id),patient_version integer not null check(patient_version>0),
 animal_link_id uuid not null references public.ezyvet_record_links(id),capture_id uuid not null unique references public.ezyvet_attachment_original_captures(id),
 capture_request_id uuid not null references public.ezyvet_attachment_capture_requests(id),capture_hash text not null,request_hash text not null,record_hash text not null check(record_hash ~ '^[a-f0-9]{64}$'),
 source_origin text not null,source_site_uid text not null,source_animal_id text not null,source_attachment_id text not null,source_file_id text not null,
 snapshot_id uuid not null references public.ezyvet_import_snapshots(id),observed_head_version integer not null,
 stable_metadata_sha256 text not null,raw_record_sha256 text not null,metadata jsonb not null,
 content_sha256 text not null,mime_type text not null,file_size integer not null,captured_at timestamptz not null,
 entry_method text not null check(entry_method='staff_reviewed_ezyvet_api_attachment_v1'),source_current_at_review boolean not null,
 previous_record_id uuid references public.ezyvet_attachment_review_records(id),version integer not null check(version>0),
 kind text not null check(kind in('original','replacement')),review_reason text not null check(length(trim(review_reason)) between 1 and 2000),
 unique(source_origin,source_site_uid,source_animal_id,source_attachment_id,version)
);
create table public.ezyvet_attachment_review_acknowledgments (
 id uuid primary key,action_id uuid not null unique references public.ezyvet_attachment_review_actions(id),
 record_id uuid not null references public.ezyvet_attachment_review_records(id),pet_id uuid not null references public.pets(id),
 actor_id uuid not null references auth.users(id),record_hash text not null,capture_hash text not null,created_at timestamptz not null default clock_timestamp(),unique(record_id,actor_id)
);
create table public.ezyvet_attachment_review_withdrawals (
 id uuid primary key,action_id uuid not null unique references public.ezyvet_attachment_review_actions(id),
 record_id uuid not null unique references public.ezyvet_attachment_review_records(id),pet_id uuid not null references public.pets(id),
 actor_id uuid not null references auth.users(id),record_hash text not null,reason text not null check(length(trim(reason)) between 1 and 2000),created_at timestamptz not null default clock_timestamp()
);
create index ezyvet_attachment_review_history on public.ezyvet_attachment_review_records(pet_id,approved_at desc,id desc);
do $$declare t text;begin foreach t in array array['ezyvet_attachment_review_actions','ezyvet_attachment_review_records','ezyvet_attachment_review_acknowledgments','ezyvet_attachment_review_withdrawals'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger immutable_attachment_review before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);
 end loop;end $$;
create function public.ezyvet_attachment_review_role(p_actor uuid,p_action text) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(public.is_active_staff(p_actor) and case when p_action='acknowledge' then public.has_role(p_actor,'DVM') when p_action in('approve','withdraw') then public.ezyvet_is_active_admin(p_actor) else false end,false)
$$;
create function public.ezyvet_attachment_review_action_projection(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select (to_jsonb(a)-'payload')||jsonb_build_object('record',(select to_jsonb(r) from public.ezyvet_attachment_review_records r where r.action_id=a.id),'acknowledgment',(select to_jsonb(r) from public.ezyvet_attachment_review_acknowledgments r where r.action_id=a.id),'withdrawal',(select to_jsonb(r) from public.ezyvet_attachment_review_withdrawals r where r.action_id=a.id)) from public.ezyvet_attachment_review_actions a where a.id=p_id
$$;
create function public.ezyvet_attachment_review_action_lock(p_id uuid,p_pet_id uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.ezyvet_attachment_review_actions;begin
 if public.ezyvet_attachment_review_role(auth.uid(),p_action) is not true then raise exception 'Attachment review role required' using errcode='42501';end if;
 if p_id is null or p_pet_id is null then raise exception 'Exact attachment review action required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,7100));
 select * into a from public.ezyvet_attachment_review_actions where id=p_id;
 if found then
  if row(a.actor_id,a.pet_id,a.action,a.payload) is distinct from row(auth.uid(),p_pet_id,p_action,p_payload) then raise exception 'Attachment review UUID already used' using errcode='42501';end if;
  return public.ezyvet_attachment_review_action_projection(p_id);
 end if;return null;
end $$;
create function public.ezyvet_attachment_review_mapping_current(p_request_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.ezyvet_attachment_capture_requests r join public.ezyvet_record_links m on m.id=r.animal_link_id and m.resource='animal' and m.pet_id=r.pet_id and m.client_id=r.client_id join public.pets p on p.id=r.pet_id and p.client_id=r.client_id where r.id=p_request_id and m.source_origin=r.parent_context->>'source_origin' and m.source_site_uid=r.parent_context->>'source_site_uid' and m.external_id=r.parent_context->>'animal_external_id')
$$;
create function public.ezyvet_attachment_review_series_lock(p_origin text,p_site text,p_animal text,p_attachment text) returns void language sql security definer set search_path=public as $$
 select pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_origin,p_site,p_animal,p_attachment)::text,7101))
$$;
create function public.ezyvet_attachment_review_latest(p_origin text,p_site text,p_animal text,p_attachment text) returns public.ezyvet_attachment_review_records language sql stable security definer set search_path=public as $$
 select r from public.ezyvet_attachment_review_records r where source_origin=p_origin and source_site_uid=p_site and source_animal_id=p_animal and source_attachment_id=p_attachment order by version desc limit 1
$$;
create function public.ezyvet_attachment_review_original(p_capture_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.ezyvet_attachment_original_captures;i public.ezyvet_attachment_original_intents;o storage.objects;begin
 select * into c from public.ezyvet_attachment_original_captures where id=p_capture_id;
 select * into i from public.ezyvet_attachment_original_intents where id=c.intent_id and request_id=c.request_id;
 select * into o from storage.objects where bucket_id=i.bucket_id and name=i.object_path for share;
 if c.id is null or i.id is null or o.id is distinct from c.storage_object_id or row(o.metadata->>'size',o.metadata->>'mimetype') is distinct from row(c.file_size::text,c.mime_type) or row(c.content_sha256,c.mime_type,c.file_size) is distinct from row(i.content_sha256,i.mime_type,i.file_size) then raise exception 'ATTACHMENT_ORIGINAL_UNAVAILABLE' using errcode='23514';end if;
 return jsonb_build_object('bucket_id',i.bucket_id,'object_path',i.object_path,'storage_object_id',o.id,'content_sha256',c.content_sha256,'mime_type',c.mime_type,'file_size',c.file_size);
end $$;
create function public.ezyvet_attachment_original_approve_core(p_id uuid,p_pet_id uuid,p_capture_id uuid,p_expected_capture_hash text,p_expected_patient_version integer,p_previous_record_id uuid,p_review_reason text,p_attest boolean,p_abandon boolean) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare actor uuid:=auth.uid();payload jsonb;old jsonb;fingerprint text;r public.ezyvet_attachment_capture_requests;c public.ezyvet_attachment_original_captures;m public.ezyvet_record_links;p public.pets;prior public.ezyvet_attachment_review_records;v public.ezyvet_attachment_review_records;begin
 if p_capture_id is null or p_expected_capture_hash is null or p_expected_capture_hash !~ '^[a-f0-9]{64}$' or p_expected_patient_version is null or p_expected_patient_version<1 or p_review_reason is null or length(trim(p_review_reason)) not between 1 and 2000 or p_attest is distinct from true then raise exception 'Explicit exact original review required' using errcode='23514';end if;
 payload:=jsonb_build_object('capture_id',p_capture_id,'capture_hash',p_expected_capture_hash,'patient_version',p_expected_patient_version,'previous_record_id',p_previous_record_id,'review_reason',p_review_reason,'attest',p_attest);
 old:=public.ezyvet_attachment_review_action_lock(p_id,p_pet_id,'approve',payload);if old is not null then return old;end if;
 select * into c from public.ezyvet_attachment_original_captures where id=p_capture_id;
 select * into r from public.ezyvet_attachment_capture_requests where id=c.request_id for share;
 if c.id is null or r.requested_by is distinct from actor or r.pet_id is distinct from p_pet_id or r.status is distinct from 'ready' or c.capture_hash is distinct from p_expected_capture_hash then raise exception 'Owned exact ready original required' using errcode='42501';end if;
 fingerprint:=encode(digest(jsonb_build_array(p_id,actor,p_pet_id,'approve',payload)::text,'sha256'),'hex');
 if p_abandon then insert into public.ezyvet_attachment_review_actions values(p_id,'approve',actor,p_pet_id,payload,fingerprint,'abandoned',clock_timestamp());return public.ezyvet_attachment_review_action_projection(p_id);end if;
 select * into m from public.ezyvet_record_links where id=r.animal_link_id for share;
 select * into p from public.pets where id=p_pet_id for share;
 if public.ezyvet_attachment_review_mapping_current(r.id) is not true or p.version is distinct from p_expected_patient_version then raise exception 'ATTACHMENT_REVIEW_PATIENT_STALE' using errcode='40001';end if;
 perform 1 from public.ezyvet_identity_heads where source_origin=m.source_origin and source_site_uid=m.source_site_uid and resource='animal' and external_id=m.external_id for share;
 perform pg_advisory_xact_lock(hashtextextended(m.source_origin||':'||m.source_site_uid||':attachment',0));
 perform 1 from public.ezyvet_identity_heads where source_origin=m.source_origin and source_site_uid=m.source_site_uid and resource='attachment' and external_id=r.external_id for share;
 perform public.ezyvet_attachment_review_series_lock(m.source_origin,m.source_site_uid,m.external_id,r.external_id);
 prior:=public.ezyvet_attachment_review_latest(m.source_origin,m.source_site_uid,m.external_id,r.external_id);
 if prior.id is distinct from p_previous_record_id or(prior.id is not null and prior.pet_id is distinct from p_pet_id) then raise exception 'ATTACHMENT_REVIEW_SERIES_STALE' using errcode='40001';end if;
 if exists(select 1 from public.ezyvet_attachment_review_records where capture_id=c.id) then raise exception 'Original capture already admitted' using errcode='23505';end if;
 perform public.ezyvet_attachment_review_original(c.id);
 insert into public.ezyvet_attachment_review_actions values(p_id,'approve',actor,p_pet_id,payload,fingerprint,'committed',clock_timestamp());
 v.id:=gen_random_uuid();v.action_id:=p_id;v.approved_by:=actor;v.approved_at:=clock_timestamp();v.pet_id:=p.id;v.client_id:=p.client_id;v.patient_version:=p.version;v.animal_link_id:=m.id;v.capture_id:=c.id;v.capture_request_id:=r.id;v.capture_hash:=c.capture_hash;v.request_hash:=fingerprint;
 v.source_origin:=m.source_origin;v.source_site_uid:=m.source_site_uid;v.source_animal_id:=m.external_id;v.source_attachment_id:=r.external_id;v.source_file_id:=r.file_id;v.snapshot_id:=r.snapshot_id;v.observed_head_version:=r.observed_head_version;v.stable_metadata_sha256:=r.stable_metadata_sha256;v.raw_record_sha256:=r.raw_record_sha256;v.metadata:=r.metadata;
 v.content_sha256:=c.content_sha256;v.mime_type:=c.mime_type;v.file_size:=c.file_size;v.captured_at:=c.captured_at;v.entry_method:='staff_reviewed_ezyvet_api_attachment_v1';v.source_current_at_review:=public.ezyvet_attachment_capture_current(r.id);v.previous_record_id:=prior.id;v.version:=coalesce(prior.version,0)+1;v.kind:=case when prior.id is null then 'original' else 'replacement' end;v.review_reason:=trim(p_review_reason);
 v.record_hash:=encode(digest((to_jsonb(v)-'record_hash')::text,'sha256'),'hex');insert into public.ezyvet_attachment_review_records select(v).*;
 return public.ezyvet_attachment_review_action_projection(p_id);
end $$;
create function public.ezyvet_attachment_original_record_action_core(p_id uuid,p_pet_id uuid,p_record_id uuid,p_expected_record_hash text,p_expected_capture_hash text,p_attest boolean,p_reason text,p_action text,p_abandon boolean) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare actor uuid:=auth.uid();payload jsonb;old jsonb;fingerprint text;v public.ezyvet_attachment_review_records;latest public.ezyvet_attachment_review_records;begin
 if p_record_id is null or p_expected_record_hash is null or p_expected_record_hash !~ '^[a-f0-9]{64}$' or(p_action='acknowledge' and(p_attest is distinct from true or p_expected_capture_hash is null or p_expected_capture_hash !~ '^[a-f0-9]{64}$')) or(p_action='withdraw' and(p_reason is null or length(trim(p_reason)) not between 1 and 2000)) then raise exception 'Explicit exact record action required' using errcode='23514';end if;
 payload:=case when p_action='acknowledge' then jsonb_build_object('record_id',p_record_id,'record_hash',p_expected_record_hash,'capture_hash',p_expected_capture_hash,'attest',p_attest) else jsonb_build_object('record_id',p_record_id,'record_hash',p_expected_record_hash,'reason',p_reason) end;
 old:=public.ezyvet_attachment_review_action_lock(p_id,p_pet_id,p_action,payload);if old is not null then return old;end if;
 select * into v from public.ezyvet_attachment_review_records where id=p_record_id and pet_id=p_pet_id;
 if v.id is null or v.record_hash is distinct from p_expected_record_hash or(p_action='acknowledge' and v.capture_hash is distinct from p_expected_capture_hash) then raise exception 'Exact admitted patient record required' using errcode='42501';end if;
 fingerprint:=encode(digest(jsonb_build_array(p_id,actor,p_pet_id,p_action,payload)::text,'sha256'),'hex');
 if p_abandon then insert into public.ezyvet_attachment_review_actions values(p_id,p_action,actor,p_pet_id,payload,fingerprint,'abandoned',clock_timestamp());return public.ezyvet_attachment_review_action_projection(p_id);end if;
 perform public.ezyvet_attachment_review_series_lock(v.source_origin,v.source_site_uid,v.source_animal_id,v.source_attachment_id);
 latest:=public.ezyvet_attachment_review_latest(v.source_origin,v.source_site_uid,v.source_animal_id,v.source_attachment_id);
 if latest.id is distinct from v.id or exists(select 1 from public.ezyvet_attachment_review_withdrawals where record_id=v.id) then raise exception 'ATTACHMENT_REVIEW_SERIES_STALE' using errcode='40001';end if;
 insert into public.ezyvet_attachment_review_actions values(p_id,p_action,actor,p_pet_id,payload,fingerprint,'committed',clock_timestamp());
 if p_action='acknowledge' then insert into public.ezyvet_attachment_review_acknowledgments values(gen_random_uuid(),p_id,v.id,p_pet_id,actor,v.record_hash,v.capture_hash,clock_timestamp());
 else insert into public.ezyvet_attachment_review_withdrawals values(gen_random_uuid(),p_id,v.id,p_pet_id,actor,v.record_hash,trim(p_reason),clock_timestamp());end if;
 return public.ezyvet_attachment_review_action_projection(p_id);
end $$;
create function public.approve_ezyvet_attachment_original(p_id uuid,p_pet_id uuid,p_capture_id uuid,p_expected_capture_hash text,p_expected_patient_version integer,p_previous_record_id uuid,p_review_reason text,p_attest boolean) returns jsonb language sql security definer set search_path=public as $$ select public.ezyvet_attachment_original_approve_core(p_id,p_pet_id,p_capture_id,p_expected_capture_hash,p_expected_patient_version,p_previous_record_id,p_review_reason,p_attest,false); $$;
create function public.abandon_ezyvet_attachment_original_approval(p_id uuid,p_pet_id uuid,p_capture_id uuid,p_expected_capture_hash text,p_expected_patient_version integer,p_previous_record_id uuid,p_review_reason text,p_attest boolean) returns jsonb language sql security definer set search_path=public as $$ select public.ezyvet_attachment_original_approve_core(p_id,p_pet_id,p_capture_id,p_expected_capture_hash,p_expected_patient_version,p_previous_record_id,p_review_reason,p_attest,true); $$;
create function public.acknowledge_ezyvet_attachment_original(p_id uuid,p_pet_id uuid,p_record_id uuid,p_expected_record_hash text,p_expected_capture_hash text,p_attest boolean) returns jsonb language sql security definer set search_path=public as $$ select public.ezyvet_attachment_original_record_action_core(p_id,p_pet_id,p_record_id,p_expected_record_hash,p_expected_capture_hash,p_attest,null,'acknowledge',false); $$;
create function public.abandon_ezyvet_attachment_original_acknowledgment(p_id uuid,p_pet_id uuid,p_record_id uuid,p_expected_record_hash text,p_expected_capture_hash text,p_attest boolean) returns jsonb language sql security definer set search_path=public as $$ select public.ezyvet_attachment_original_record_action_core(p_id,p_pet_id,p_record_id,p_expected_record_hash,p_expected_capture_hash,p_attest,null,'acknowledge',true); $$;
create function public.withdraw_ezyvet_attachment_original(p_id uuid,p_pet_id uuid,p_record_id uuid,p_expected_record_hash text,p_reason text) returns jsonb language sql security definer set search_path=public as $$ select public.ezyvet_attachment_original_record_action_core(p_id,p_pet_id,p_record_id,p_expected_record_hash,null,null,p_reason,'withdraw',false); $$;
create function public.abandon_ezyvet_attachment_original_withdrawal(p_id uuid,p_pet_id uuid,p_record_id uuid,p_expected_record_hash text,p_reason text) returns jsonb language sql security definer set search_path=public as $$ select public.ezyvet_attachment_original_record_action_core(p_id,p_pet_id,p_record_id,p_expected_record_hash,null,null,p_reason,'withdraw',true); $$;
create function public.recover_ezyvet_attachment_review_action(p_id uuid,p_pet_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a public.ezyvet_attachment_review_actions;begin
 perform public.clinical_require_staff();if p_id is null or p_pet_id is null then raise exception 'Exact review action required' using errcode='23514';end if;
 select * into a from public.ezyvet_attachment_review_actions where id=p_id and pet_id=p_pet_id and actor_id=auth.uid();if not found then return null;end if;
 if public.ezyvet_attachment_review_role(auth.uid(),a.action) is not true then raise exception 'Attachment review role required' using errcode='42501';end if;
 return public.ezyvet_attachment_review_action_projection(p_id);
end $$;
create function public.ezyvet_attachment_review_history_projection(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('record',to_jsonb(r),'latest_record_id',(public.ezyvet_attachment_review_latest(r.source_origin,r.source_site_uid,r.source_animal_id,r.source_attachment_id)).id,'is_latest',r.id=(public.ezyvet_attachment_review_latest(r.source_origin,r.source_site_uid,r.source_animal_id,r.source_attachment_id)).id,'withdrawal',(select to_jsonb(w) from public.ezyvet_attachment_review_withdrawals w where w.record_id=r.id),'acknowledgments',coalesce((select jsonb_agg(to_jsonb(a) order by created_at,id) from public.ezyvet_attachment_review_acknowledgments a where a.record_id=r.id),'[]')) from public.ezyvet_attachment_review_records r where r.id=p_id
$$;
create function public.read_ezyvet_attachment_original_history(p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare items jsonb;more boolean;lastrow jsonb;begin
 perform public.clinical_require_staff();
 if p_pet_id is null or not exists(select 1 from public.pets where id=p_pet_id) or p_limit is null or p_limit not between 1 and 50 or(p_before_at is null)<>(p_before_id is null) or(p_before_at is not null and not isfinite(p_before_at)) then raise exception 'Bounded patient history cursor required' using errcode='23514';end if;
 select coalesce(jsonb_agg(public.ezyvet_attachment_review_history_projection(id) order by approved_at desc,id desc),'[]') into items from(select id,approved_at from public.ezyvet_attachment_review_records where pet_id=p_pet_id and(p_before_at is null or(approved_at,id)<(p_before_at,p_before_id)) order by approved_at desc,id desc limit p_limit+1) x;
 more:=jsonb_array_length(items)>p_limit;if more then items:=items-p_limit;end if;lastrow:=items->(jsonb_array_length(items)-1);
 return jsonb_build_object('pet_id',p_pet_id,'records',items,'has_more',more,'next_cursor',case when more then jsonb_build_object('before_at',lastrow#>'{record,approved_at}','before_id',lastrow#>'{record,id}') else null end);
end $$;
create function public.list_ezyvet_attachment_original_candidates(p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare items jsonb;more boolean;lastrow jsonb;begin
 if public.ezyvet_is_active_admin(auth.uid()) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_pet_id is null or not exists(select 1 from public.pets where id=p_pet_id) or p_limit is null or p_limit not between 1 and 50 or(p_before_at is null)<>(p_before_id is null) or(p_before_at is not null and not isfinite(p_before_at)) then raise exception 'Bounded patient candidate cursor required' using errcode='23514';end if;
 select coalesce(jsonb_agg(value order by captured_at desc,id desc),'[]') into items from(
 select c.id,c.captured_at,jsonb_build_object('capture_id',c.id,'capture_request_id',r.id,'pet_id',r.pet_id,'client_id',r.client_id,'animal_link_id',r.animal_link_id,'capture_hash',c.capture_hash,'content_sha256',c.content_sha256,'mime_type',c.mime_type,'file_size',c.file_size,'captured_at',c.captured_at,'metadata',r.metadata,'source_origin',r.parent_context->>'source_origin','source_site_uid',r.parent_context->>'source_site_uid','source_animal_id',r.parent_context->>'animal_external_id','source_attachment_id',r.external_id,'source_file_id',r.file_id,'source_current',public.ezyvet_attachment_capture_current(r.id),'patient_version',p.version,'mapping_current',public.ezyvet_attachment_review_mapping_current(r.id),'latest_record',to_jsonb(public.ezyvet_attachment_review_latest(r.parent_context->>'source_origin',r.parent_context->>'source_site_uid',r.parent_context->>'animal_external_id',r.external_id)),'admitted_record',(select to_jsonb(v) from public.ezyvet_attachment_review_records v where v.capture_id=c.id)) value
 from public.ezyvet_attachment_original_captures c join public.ezyvet_attachment_capture_requests r on r.id=c.request_id join public.pets p on p.id=r.pet_id
 where r.pet_id=p_pet_id and r.requested_by=auth.uid() and r.status='ready' and(p_before_at is null or(c.captured_at,c.id)<(p_before_at,p_before_id)) order by c.captured_at desc,c.id desc limit p_limit+1) x;
 more:=jsonb_array_length(items)>p_limit;if more then items:=items-p_limit;end if;lastrow:=items->(jsonb_array_length(items)-1);
 return jsonb_build_object('candidates',items,'has_more',more,'next_cursor',case when more then jsonb_build_object('before_at',lastrow->'captured_at','before_id',lastrow->'capture_id') else null end);
end $$;
create function public.get_ezyvet_attachment_original_review_context(p_record_id uuid,p_pet_id uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_attachment_review_records;original jsonb;begin
 if public.ezyvet_attachment_review_role(p_actor,'acknowledge') is not true then raise exception 'Active veterinarian required' using errcode='42501';end if;
 select * into r from public.ezyvet_attachment_review_records where id=p_record_id and pet_id=p_pet_id;
 if not found then raise exception 'Exact admitted patient record required' using errcode='42501';end if;
 original:=public.ezyvet_attachment_review_original(r.capture_id);
 if row(original->>'content_sha256',original->>'mime_type',original->>'file_size') is distinct from row(r.content_sha256,r.mime_type,r.file_size::text) then raise exception 'ATTACHMENT_ORIGINAL_UNAVAILABLE' using errcode='23514';end if;
 return jsonb_build_object('record',to_jsonb(r),'original',original);
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in('ezyvet_attachment_review_role','ezyvet_attachment_review_action_projection','ezyvet_attachment_review_action_lock','ezyvet_attachment_review_mapping_current','ezyvet_attachment_review_series_lock','ezyvet_attachment_review_latest','ezyvet_attachment_review_original','ezyvet_attachment_original_approve_core','ezyvet_attachment_original_record_action_core','approve_ezyvet_attachment_original','abandon_ezyvet_attachment_original_approval','acknowledge_ezyvet_attachment_original','abandon_ezyvet_attachment_original_acknowledgment','withdraw_ezyvet_attachment_original','abandon_ezyvet_attachment_original_withdrawal','recover_ezyvet_attachment_review_action','ezyvet_attachment_review_history_projection','read_ezyvet_attachment_original_history','list_ezyvet_attachment_original_candidates','get_ezyvet_attachment_original_review_context') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.proname in('approve_ezyvet_attachment_original','abandon_ezyvet_attachment_original_approval','acknowledge_ezyvet_attachment_original','abandon_ezyvet_attachment_original_acknowledgment','withdraw_ezyvet_attachment_original','abandon_ezyvet_attachment_original_withdrawal','recover_ezyvet_attachment_review_action','read_ezyvet_attachment_original_history','list_ezyvet_attachment_original_candidates') then execute format('grant execute on function %s to authenticated',f.signature);
 elsif f.proname='get_ezyvet_attachment_original_review_context' then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;end $$;
