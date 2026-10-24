-- Private generated-PDF processing. No policy seed, scheduler, release or staff download.
create table public.diagnostic_pdf_runtime_policy (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 image text not null check(image ~ '^lrv-diagnostic-pdf@sha256:[a-f0-9]{64}$'),
 provenance jsonb not null check(jsonb_typeof(provenance)='object' and octet_length(provenance::text)<16384),
 accepted_by uuid not null references public.profiles(id), accepted_at timestamptz not null default clock_timestamp()
);
create table public.diagnostic_pdf_manifests (
 job_id uuid primary key references public.diagnostic_pdf_jobs(id),source jsonb not null,input jsonb not null,
 source_hash text not null,html_sha256 text not null,manifest_sha256 text not null,provenance jsonb not null,
 image text not null,actor_id uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp(),
 check(octet_length(input::text)<=1100000),check(octet_length(source::text)<=24000000)
);
create table public.diagnostic_pdf_processing (
 job_id uuid primary key references public.diagnostic_pdf_manifests(job_id),state text not null check(state in('claimed','failed','stored')),
 fence integer not null check(fence>0),claim_id uuid,actor_id uuid not null references public.profiles(id),lease_until timestamptz,
 last_error text not null default '' check(last_error in('','ADMISSION_FAILED','STORAGE_UNCERTAIN','OBJECT_CHANGED','CAPACITY_EXCEEDED')),
 updated_at timestamptz not null default clock_timestamp(),check((state='claimed')=(claim_id is not null and lease_until is not null)),check((claim_id is null)=(lease_until is null))
);
create table public.diagnostic_pdf_processing_attempts (
 id uuid primary key,job_id uuid not null references public.diagnostic_pdf_processing(job_id),fence integer not null,actor_id uuid not null references public.profiles(id),
 lease_until timestamptz not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(job_id,fence)
);
create table public.diagnostic_pdf_validations (
 claim_id uuid primary key references public.diagnostic_pdf_processing_attempts(id),job_id uuid not null references public.diagnostic_pdf_captures(job_id),
 manifest_sha256 text not null,sha256 text not null,byte_length integer not null,receipt jsonb not null,actor_id uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp()
);
create table public.diagnostic_pdf_upload_intents (
 job_id uuid primary key references public.diagnostic_pdf_captures(job_id),bucket_id text not null check(bucket_id='diagnostic-pdfs'),
 object_path text not null unique,sha256 text not null,byte_length integer not null,manifest_sha256 text not null,
 actor_id uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp()
);
create table public.diagnostic_pdf_artifacts (
 job_id uuid primary key references public.diagnostic_pdf_upload_intents(job_id),claim_id uuid not null references public.diagnostic_pdf_validations(claim_id),
 object_id uuid not null,object_created_at timestamptz not null,object_updated_at timestamptz not null,object_version text not null check(length(object_version) between 1 and 100),receipt jsonb not null,actor_id uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp()
);
create function public.diagnostic_pdf_processing_guard() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP<>'UPDATE' then raise exception 'PDF processing cannot be removed' using errcode='23514';end if;
 if NEW.job_id<>OLD.job_id or NEW.fence<OLD.fence or (OLD.state='stored' and NEW is distinct from OLD) then raise exception 'PDF processing history cannot regress' using errcode='23514';end if;
 if OLD.state='stored' then return OLD;end if;NEW.updated_at:=clock_timestamp();return NEW;
end $$;
create trigger diagnostic_pdf_processing_guard before update or delete on public.diagnostic_pdf_processing for each row execute function public.diagnostic_pdf_processing_guard();
create trigger diagnostic_pdf_processing_no_truncate before truncate on public.diagnostic_pdf_processing for each statement execute function public.diagnostic_pdf_processing_guard();
do $$declare t text;begin
 foreach t in array array['diagnostic_pdf_manifests','diagnostic_pdf_processing_attempts','diagnostic_pdf_validations','diagnostic_pdf_upload_intents','diagnostic_pdf_artifacts'] loop
 execute format('create trigger diagnostic_pdf_immutable before update or delete on public.%I for each row execute function public.diagnostic_immutable()',t);
 execute format('create trigger diagnostic_pdf_no_truncate before truncate on public.%I for each statement execute function public.diagnostic_immutable()',t);
 end loop;
 foreach t in array array['diagnostic_pdf_runtime_policy','diagnostic_pdf_manifests','diagnostic_pdf_processing','diagnostic_pdf_processing_attempts','diagnostic_pdf_validations','diagnostic_pdf_upload_intents','diagnostic_pdf_artifacts'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('diagnostic-pdfs','diagnostic-pdfs',false,3145728,array['application/pdf']);

-- All mutators: job → profile → ordered role rows → worker/runtime policies → processing → object.
-- Operator policy writers must remain policy-only, or acquire actor eligibility first.
create function public.diagnostic_pdf_processing_owner(p_id uuid,p_actor uuid) returns public.diagnostic_pdf_jobs language plpgsql security definer set search_path=public as $$
declare j public.diagnostic_pdf_jobs;rt public.diagnostic_pdf_runtime_policy;begin
 select * into j from public.diagnostic_pdf_jobs where id=p_id for update;
 if not found or j.requested_by is distinct from p_actor then raise exception 'Active PDF processing owner required' using errcode='42501';end if;
 perform 1 from public.profiles where id=p_actor for share;
 perform 1 from public.user_roles where user_id=p_actor order by id for share;
 if not public.is_active_staff(p_actor) then raise exception 'Active PDF processing owner required' using errcode='42501';end if;
 perform 1 from public.diagnostic_pdf_worker_policy where singleton and enabled and renderer_sha=j.renderer_sha and settings_sha=j.settings_sha for share;
 if not found then raise exception 'PDF processing policy unavailable' using errcode='PT409';end if;
 select * into rt from public.diagnostic_pdf_runtime_policy where singleton and enabled for share;
 if not found or substring(rt.image from 'sha256:([a-f0-9]{64})$') is distinct from j.renderer_sha or encode(sha256(convert_to((rt.provenance->'settings')::text,'UTF8')),'hex') is distinct from j.settings_sha then raise exception 'PDF runtime binding differs' using errcode='PT409';end if;
 if not public.is_active_staff(p_actor) then raise exception 'Active PDF processing owner required' using errcode='42501';end if;return j;
end $$;
create function public.read_diagnostic_pdf_runtime_config() returns jsonb language plpgsql security definer set search_path=public as $$
declare rt public.diagnostic_pdf_runtime_policy;wp public.diagnostic_pdf_worker_policy;begin
 perform public.communication_require_service();select * into rt from public.diagnostic_pdf_runtime_policy where singleton and enabled;select * into wp from public.diagnostic_pdf_worker_policy where singleton and enabled;
 if rt.singleton is null or wp.singleton is null then return null;end if;
 return jsonb_build_object('image',rt.image,'provenance',rt.provenance,'renderer_sha',wp.renderer_sha,'settings_sha',wp.settings_sha);
end $$;
create function public.diagnostic_pdf_render_source(p_job public.diagnostic_pdf_jobs) returns jsonb language sql stable security definer set search_path=public as $$
 with census as (select distinct on(panel_id) v.* from public.diagnostic_panel_versions v where v.pet_id=p_job.pet_id and (v.panel_id<>p_job.panel_id or v.id=p_job.id) and v.reviewed_at<=(p_job.snapshot#>>'{diagnostic,reviewed_at}')::timestamptz order by panel_id,reviewed_at desc,number desc,id desc),
 selected as (select * from census order by (id=p_job.id) desc,reviewed_at desc,panel_id limit 200)
 select jsonb_build_object('job',to_jsonb(p_job),'panels',(select coalesce(jsonb_agg(to_jsonb(s) order by (s.id=p_job.id) desc,s.reviewed_at desc,s.panel_id),'[]') from selected s),'total_panels',(select count(*) from census))
$$;
create function public.read_diagnostic_pdf_render_source(p_id uuid,p_claim uuid,p_fence integer,p_actor uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.diagnostic_pdf_jobs;m public.diagnostic_pdf_manifests;begin
 perform public.communication_require_service();j:=public.diagnostic_pdf_processing_owner(p_id,p_actor);j:=public.diagnostic_pdf_live_claim(p_id,p_claim,p_fence,p_actor);
 select * into m from public.diagnostic_pdf_manifests where job_id=p_id;if found then return m.source;end if;
 return public.diagnostic_pdf_render_source(j);
end $$;
create function public.prepare_diagnostic_pdf_manifest(p_id uuid,p_claim uuid,p_fence integer,p_actor uuid,p_source jsonb,p_input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.diagnostic_pdf_jobs;m public.diagnostic_pdf_manifests;rt public.diagnostic_pdf_runtime_policy;actual text;fingerprint text;begin
 perform public.communication_require_service();j:=public.diagnostic_pdf_processing_owner(p_id,p_actor);j:=public.diagnostic_pdf_live_claim(p_id,p_claim,p_fence,p_actor);
 select * into m from public.diagnostic_pdf_manifests where job_id=p_id;
 if found then if row(m.source,m.input) is distinct from row(p_source,p_input) then raise exception 'PDF rendering manifest is immutable' using errcode='23505';end if;return to_jsonb(m);end if;
 if p_source is distinct from public.diagnostic_pdf_render_source(j) then raise exception 'PDF history census changed' using errcode='PT409';end if;
 if p_input is null or not p_input ?& array['version','job_id','source_hash','snapshot_hash','html_sha256','html_bytes','html','expected_texts'] or jsonb_typeof(p_input->'html') is distinct from 'string' or jsonb_typeof(p_input->'html_bytes') is distinct from 'number' then raise exception 'Exact bounded rendering input required' using errcode='23514';end if;
 actual:=encode(sha256(convert_to(p_input->>'html','UTF8')),'hex');
 if p_input is null or jsonb_typeof(p_input)<>'object' or (p_input-array['version','job_id','source_hash','snapshot_hash','html_sha256','html_bytes','html','expected_texts'])<>'{}' or (p_input->>'version') is distinct from '1' or (p_input->>'job_id') is distinct from j.id::text or (p_input->>'source_hash') is distinct from j.source_hash or (p_input->>'snapshot_hash') is distinct from j.snapshot_hash or (p_input->>'html_sha256') is distinct from actual or octet_length(p_input->>'html') not between 1 and 524288 or (p_input->>'html_bytes')::integer<>octet_length(p_input->>'html') or jsonb_typeof(p_input->'expected_texts') is distinct from 'array' or jsonb_array_length(p_input->'expected_texts') not between 1 and 500 or octet_length(p_input::text)>1100000 then raise exception 'Exact bounded rendering input required' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_input->'expected_texts') t where jsonb_typeof(t)<>'string' or length(t#>>'{}') not between 1 and 4000) then raise exception 'Exact bounded rendering input required' using errcode='23514';end if;
 select * into strict rt from public.diagnostic_pdf_runtime_policy where singleton;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('source',p_source,'input',p_input,'image',rt.image,'provenance',rt.provenance)::text,'UTF8')),'hex');
 insert into public.diagnostic_pdf_manifests(job_id,source,input,source_hash,html_sha256,manifest_sha256,provenance,image,actor_id) values(p_id,p_source,p_input,j.source_hash,actual,fingerprint,rt.provenance,rt.image,p_actor) returning * into m;
 if j.lease_until<=clock_timestamp() then raise exception 'PDF claim expired or was superseded' using errcode='PT409';end if;return to_jsonb(m);
end $$;
create function public.capture_manifest_diagnostic_pdf(p_id uuid,p_claim uuid,p_fence integer,p_actor uuid,p_base64 text) returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.diagnostic_pdf_jobs;m public.diagnostic_pdf_manifests;begin
 perform public.communication_require_service();j:=public.diagnostic_pdf_processing_owner(p_id,p_actor);select * into m from public.diagnostic_pdf_manifests where job_id=p_id;
 if not found then raise exception 'Frozen rendering manifest required' using errcode='23514';end if;
 return public.capture_diagnostic_pdf_bytes(p_id,p_claim,p_fence,p_actor,j.source_hash,j.snapshot_hash,j.renderer_sha,j.settings_sha,p_base64);
end $$;
create function public.claim_diagnostic_pdf_processing(p_id uuid,p_claim uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.diagnostic_pdf_jobs;p public.diagnostic_pdf_processing;a public.diagnostic_pdf_processing_attempts;m public.diagnostic_pdf_manifests;c public.diagnostic_pdf_captures;r jsonb;until_at timestamptz;begin
 perform public.communication_require_service();if p_claim is null then raise exception 'Stable processing claim required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_claim::text,496));
 select * into j from public.diagnostic_pdf_jobs where id=p_id;if not found then return null;end if;j:=public.diagnostic_pdf_processing_owner(p_id,j.requested_by);
 select * into m from public.diagnostic_pdf_manifests where job_id=p_id;select * into c from public.diagnostic_pdf_captures where job_id=p_id;
 if m.job_id is null or c.job_id is null then return null;end if;
 select * into p from public.diagnostic_pdf_processing where job_id=p_id for update;
 select * into a from public.diagnostic_pdf_processing_attempts where id=p_claim;
 if found then if a.job_id<>p_id then raise exception 'Processing claim identity conflicts' using errcode='23505';end if;
 if p.state<>'claimed' or p.claim_id is distinct from p_claim or p.fence<>a.fence or p.actor_id<>j.requested_by or p.lease_until<=clock_timestamp() then raise exception 'Processing claim expired or superseded' using errcode='PT409';end if;return a.receipt;end if;
 if p.state='stored' or (p.state='claimed' and p.lease_until>clock_timestamp() and p.actor_id=j.requested_by) then return null;end if;
 until_at:=clock_timestamp()+interval '90 seconds';
 insert into public.diagnostic_pdf_processing(job_id,state,fence,claim_id,actor_id,lease_until) values(p_id,'claimed',1,p_claim,j.requested_by,until_at)
 on conflict(job_id) do update set state='claimed',fence=diagnostic_pdf_processing.fence+1,claim_id=p_claim,actor_id=j.requested_by,lease_until=until_at,last_error='' returning * into p;
 r:=jsonb_build_object('job_id',p_id,'pet_id',j.pet_id,'claim_id',p_claim,'fence',p.fence,'actor_id',j.requested_by,'lease_until',until_at,'manifest',to_jsonb(m),'capture',c.metadata);
 insert into public.diagnostic_pdf_processing_attempts(id,job_id,fence,actor_id,lease_until,receipt) values(p_claim,p_id,p.fence,j.requested_by,until_at,r);return r;
end $$;
create function public.diagnostic_pdf_live_processing(p_id uuid,p_claim uuid,p_fence integer,p_actor uuid) returns public.diagnostic_pdf_processing language plpgsql security definer set search_path=public as $$
declare p public.diagnostic_pdf_processing;begin
 perform public.diagnostic_pdf_processing_owner(p_id,p_actor);select * into p from public.diagnostic_pdf_processing where job_id=p_id for update;
 if not found or p.state<>'claimed' or p.claim_id is distinct from p_claim or p.fence is distinct from p_fence or p.actor_id is distinct from p_actor or p.lease_until<=clock_timestamp() then raise exception 'Processing claim expired or superseded' using errcode='PT409';end if;return p;
end $$;
create function public.validate_diagnostic_pdf_capture(p_id uuid,p_claim uuid,p_fence integer,p_actor uuid,p_receipt jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.diagnostic_pdf_processing;c public.diagnostic_pdf_captures;m public.diagnostic_pdf_manifests;v public.diagnostic_pdf_validations;begin
 perform public.communication_require_service();p:=public.diagnostic_pdf_live_processing(p_id,p_claim,p_fence,p_actor);
 select * into strict c from public.diagnostic_pdf_captures where job_id=p_id;select * into strict m from public.diagnostic_pdf_manifests where job_id=p_id;
 if p_receipt is null or exists(select 1 from unnest(array['byte_length','page_count','object_count','stream_count','inflated_bytes']) k where jsonb_typeof(p_receipt->k) is distinct from 'number') then raise exception 'Exact admitted capture receipt required' using errcode='23514';end if;
 if p_receipt is null or jsonb_typeof(p_receipt)<>'object' or (p_receipt-array['sha256','byte_length','page_count','object_count','stream_count','inflated_bytes','admission','qpdf_clean'])<>'{}' or p_receipt->>'sha256' is distinct from c.sha256 or (p_receipt->>'byte_length')::integer is distinct from c.byte_length or p_receipt->>'admission' is distinct from 'chromium-classic-pdf1.4-v1' or p_receipt->'qpdf_clean' is distinct from 'true'::jsonb or (p_receipt->>'page_count')::integer not between 1 and 40 or (p_receipt->>'object_count')::integer not between 1 and 5000 or (p_receipt->>'stream_count')::integer not between 0 and 5000 or (p_receipt->>'inflated_bytes')::integer not between 0 and 16777216 then raise exception 'Exact admitted capture receipt required' using errcode='23514';end if;
 -- All fields must exist; SQL NULL cannot bypass bounds.
 if not p_receipt ?& array['sha256','byte_length','page_count','object_count','stream_count','inflated_bytes','admission','qpdf_clean'] then raise exception 'Exact admitted capture receipt required' using errcode='23514';end if;
 select * into v from public.diagnostic_pdf_validations where claim_id=p_claim;
 if found then if v.receipt is distinct from p_receipt then raise exception 'Validation receipt is immutable' using errcode='23505';end if;return to_jsonb(v);end if;
 insert into public.diagnostic_pdf_validations(claim_id,job_id,manifest_sha256,sha256,byte_length,receipt,actor_id) values(p_claim,p_id,m.manifest_sha256,c.sha256,c.byte_length,p_receipt,p_actor) returning * into v;
 if p.lease_until<=clock_timestamp() then raise exception 'Processing claim expired or superseded' using errcode='PT409';end if;return to_jsonb(v);
end $$;
create function public.reserve_diagnostic_pdf_upload(p_id uuid,p_claim uuid,p_fence integer,p_actor uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.diagnostic_pdf_processing;i public.diagnostic_pdf_upload_intents;v public.diagnostic_pdf_validations;c public.diagnostic_pdf_captures;j public.diagnostic_pdf_jobs;begin
 perform public.communication_require_service();p:=public.diagnostic_pdf_live_processing(p_id,p_claim,p_fence,p_actor);
 select * into v from public.diagnostic_pdf_validations where claim_id=p_claim and job_id=p_id;if not found then raise exception 'Current admitted-byte receipt required' using errcode='23514';end if;
 select * into strict c from public.diagnostic_pdf_captures where job_id=p_id;select * into strict j from public.diagnostic_pdf_jobs where id=p_id;
 select * into i from public.diagnostic_pdf_upload_intents where job_id=p_id;if found then return to_jsonb(i);end if;
 insert into public.diagnostic_pdf_upload_intents(job_id,bucket_id,object_path,sha256,byte_length,manifest_sha256,actor_id) values(p_id,'diagnostic-pdfs',j.pet_id::text||'/'||p_id::text||'/'||c.sha256||'.pdf',c.sha256,c.byte_length,v.manifest_sha256,p_actor) returning * into i;
 if p.lease_until<=clock_timestamp() then raise exception 'Processing claim expired or superseded' using errcode='PT409';end if;return to_jsonb(i);
end $$;
create function public.read_diagnostic_pdf_upload_object(p_id uuid,p_claim uuid,p_fence integer,p_actor uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.diagnostic_pdf_processing;i public.diagnostic_pdf_upload_intents;o storage.objects;begin
 perform public.communication_require_service();p:=public.diagnostic_pdf_live_processing(p_id,p_claim,p_fence,p_actor);select * into strict i from public.diagnostic_pdf_upload_intents where job_id=p_id;
 select * into o from storage.objects where bucket_id=i.bucket_id and name=i.object_path for share;if not found then return null;end if;
 if o.version is null or length(o.version) not between 1 and 100 or o.metadata->>'mimetype' is distinct from 'application/pdf' or o.metadata->>'size' is distinct from i.byte_length::text then raise exception 'PDF Storage object differs' using errcode='23514';end if;
 if p.lease_until<=clock_timestamp() then raise exception 'Processing claim expired or superseded' using errcode='PT409';end if;return jsonb_build_object('id',o.id,'created_at',o.created_at,'updated_at',o.updated_at,'version',o.version,'bucket_id',o.bucket_id,'name',o.name,'mime_type','application/pdf','byte_length',i.byte_length);
end $$;
create function public.register_diagnostic_pdf_artifact(p_id uuid,p_claim uuid,p_fence integer,p_actor uuid,p_object uuid,p_object_created_at timestamptz,p_object_updated_at timestamptz,p_object_version text,p_readback_base64 text) returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.diagnostic_pdf_jobs;p public.diagnostic_pdf_processing;i public.diagnostic_pdf_upload_intents;a public.diagnostic_pdf_artifacts;c public.diagnostic_pdf_captures;o storage.objects;r jsonb;b bytea;begin
 perform public.communication_require_service();j:=public.diagnostic_pdf_processing_owner(p_id,p_actor);
 select * into strict i from public.diagnostic_pdf_upload_intents where job_id=p_id;select * into strict c from public.diagnostic_pdf_captures where job_id=p_id;
 if p_readback_base64 is null or length(p_readback_base64)>4194304 or p_readback_base64!~'^[A-Za-z0-9+/]*={0,2}$' then raise exception 'Exact bounded Storage readback required' using errcode='23514';end if;
 b:=decode(p_readback_base64,'base64');if replace(encode(b,'base64'),E'\n','')<>p_readback_base64 or b is distinct from c.bytes then raise exception 'Actual Storage readback bytes differ' using errcode='23514';end if;
 select * into p from public.diagnostic_pdf_processing where job_id=p_id for update;select * into a from public.diagnostic_pdf_artifacts where job_id=p_id;
 if a.job_id is not null then
 if a.claim_id is distinct from p_claim or p.fence is distinct from p_fence or a.actor_id is distinct from p_actor or row(a.object_id,a.object_created_at,a.object_updated_at,a.object_version) is distinct from row(p_object,p_object_created_at,p_object_updated_at,p_object_version) then raise exception 'Artifact registration is immutable' using errcode='23505';end if;
 else p:=public.diagnostic_pdf_live_processing(p_id,p_claim,p_fence,p_actor);
 if not exists(select 1 from public.diagnostic_pdf_validations where claim_id=p_claim and job_id=p_id and sha256=c.sha256 and byte_length=c.byte_length and manifest_sha256=i.manifest_sha256) then raise exception 'Current admitted-byte receipt required' using errcode='23514';end if;end if;
 select * into o from storage.objects where id=p_object and bucket_id=i.bucket_id and name=i.object_path for share;
 if not found or o.created_at is distinct from p_object_created_at or o.updated_at is distinct from p_object_updated_at or o.version is distinct from p_object_version or p_object_version is null or length(p_object_version) not between 1 and 100 or o.metadata->>'size' is distinct from c.byte_length::text or o.metadata->>'mimetype' is distinct from 'application/pdf' then raise exception 'PDF Storage object differs' using errcode='23514';end if;
 if a.job_id is not null then return a.receipt;end if;
 if p.lease_until<=clock_timestamp() then raise exception 'Processing claim expired or superseded' using errcode='PT409';end if;
 r:=jsonb_build_object('job_id',p_id,'pet_id',j.pet_id,'claim_id',p_claim,'fence',p_fence,'capture_actor_id',c.actor_id,'processing_actor_id',p_actor,'manifest_sha256',i.manifest_sha256,'sha256',c.sha256,'byte_length',c.byte_length,'bucket_id',i.bucket_id,'object_path',i.object_path,'object_id',o.id,'object_created_at',o.created_at,'object_updated_at',o.updated_at,'object_version',o.version,'mime_type','application/pdf','status','stored_private','export_eligible',false);
 insert into public.diagnostic_pdf_artifacts(job_id,claim_id,object_id,object_created_at,object_updated_at,object_version,receipt,actor_id) values(p_id,p_claim,o.id,o.created_at,o.updated_at,o.version,r,p_actor);
 update public.diagnostic_pdf_processing set state='stored',claim_id=null,lease_until=null where job_id=p_id;return r;
end $$;
create function public.fail_diagnostic_pdf_processing(p_id uuid,p_claim uuid,p_fence integer,p_actor uuid,p_code text) returns void language plpgsql security definer set search_path=public as $$
begin perform public.communication_require_service();perform public.diagnostic_pdf_live_processing(p_id,p_claim,p_fence,p_actor);
 if p_code is null or p_code not in('ADMISSION_FAILED','STORAGE_UNCERTAIN','OBJECT_CHANGED','CAPACITY_EXCEEDED') then raise exception 'Safe PDF failure code required' using errcode='23514';end if;
 update public.diagnostic_pdf_processing set state='failed',claim_id=null,lease_until=null,last_error=p_code where job_id=p_id;
end $$;
create function public.read_diagnostic_pdf_artifact_state(p_id uuid,p_pet uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.diagnostic_pdf_jobs;p public.diagnostic_pdf_processing;a public.diagnostic_pdf_artifacts;present boolean;begin
 perform public.clinical_require_staff();select * into j from public.diagnostic_pdf_jobs where id=p_id and pet_id=p_pet;if not found then return null;end if;
 select * into p from public.diagnostic_pdf_processing where job_id=p_id;select * into a from public.diagnostic_pdf_artifacts where job_id=p_id;
 select exists(select 1 from storage.objects o join public.diagnostic_pdf_upload_intents i on i.job_id=p_id and o.bucket_id=i.bucket_id and o.name=i.object_path where o.id=a.object_id and o.created_at=a.object_created_at and o.updated_at=a.object_updated_at and o.version=a.object_version and o.metadata->>'mimetype'='application/pdf' and o.metadata->>'size'=i.byte_length::text) into present;
 return jsonb_build_object('job_id',p_id,'pet_id',p_pet,'has_registration',a.job_id is not null,'object_present',present,'state',coalesce(p.state,'not_processed'),'last_error',coalesce(p.last_error,''),'stored_private',a.job_id is not null and present,'export_eligible',false,'download_available',false);
end $$;
create function public.read_diagnostic_pdf_processing_context(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.diagnostic_pdf_jobs;m public.diagnostic_pdf_manifests;c public.diagnostic_pdf_captures;a public.diagnostic_pdf_artifacts;present boolean;begin
 perform public.communication_require_service();select * into j from public.diagnostic_pdf_jobs where id=p_id;
 if not found then return null;end if;if not public.is_active_staff(j.requested_by) then raise exception 'Active PDF processing owner required' using errcode='42501';end if;
 select * into m from public.diagnostic_pdf_manifests where job_id=p_id;select * into c from public.diagnostic_pdf_captures where job_id=p_id;select * into a from public.diagnostic_pdf_artifacts where job_id=p_id;
 select exists(select 1 from storage.objects o join public.diagnostic_pdf_upload_intents i on i.job_id=p_id and o.bucket_id=i.bucket_id and o.name=i.object_path where o.id=a.object_id and o.created_at=a.object_created_at and o.updated_at=a.object_updated_at and o.version=a.object_version and o.metadata->>'mimetype'='application/pdf' and o.metadata->>'size'=i.byte_length::text) into present;
 return jsonb_build_object('object_present',present,'job',to_jsonb(j),'manifest',case when m.job_id is null then null else to_jsonb(m) end,'capture',c.metadata,'artifact',a.receipt);
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure as signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in('diagnostic_pdf_processing_guard','diagnostic_pdf_processing_owner','read_diagnostic_pdf_runtime_config','read_diagnostic_pdf_processing_context','diagnostic_pdf_render_source','read_diagnostic_pdf_render_source','prepare_diagnostic_pdf_manifest','capture_manifest_diagnostic_pdf','claim_diagnostic_pdf_processing','diagnostic_pdf_live_processing','validate_diagnostic_pdf_capture','reserve_diagnostic_pdf_upload','read_diagnostic_pdf_upload_object','register_diagnostic_pdf_artifact','fail_diagnostic_pdf_processing','read_diagnostic_pdf_artifact_state') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.proname in('read_diagnostic_pdf_runtime_config','read_diagnostic_pdf_processing_context','read_diagnostic_pdf_render_source','prepare_diagnostic_pdf_manifest','capture_manifest_diagnostic_pdf','claim_diagnostic_pdf_processing','validate_diagnostic_pdf_capture','reserve_diagnostic_pdf_upload','read_diagnostic_pdf_upload_object','register_diagnostic_pdf_artifact','fail_diagnostic_pdf_processing') then execute format('grant execute on function %s to service_role',f.signature);end if;
 if f.proname='read_diagnostic_pdf_artifact_state' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
