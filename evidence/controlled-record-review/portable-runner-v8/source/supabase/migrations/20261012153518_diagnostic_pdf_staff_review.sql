-- Internal staff disclosure only. No rendering, record release or provider delivery enabled.
create table public.diagnostic_pdf_staff_disclosure_policy (
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 revision uuid not null default gen_random_uuid(),accepted_by uuid not null references public.profiles(id),
 accepted_at timestamptz not null default clock_timestamp()
);
create table public.diagnostic_pdf_download_authorities (
 id uuid primary key,job_id uuid not null references public.diagnostic_pdf_artifacts(job_id),
 pet_id uuid not null references public.pets(id),actor_id uuid not null references public.profiles(id),
 binding jsonb not null,expires_at timestamptz not null,created_at timestamptz not null default clock_timestamp()
);
create table public.diagnostic_pdf_download_responses (
 authority_id uuid primary key references public.diagnostic_pdf_download_authorities(id),
 actor_id uuid not null references public.profiles(id),receipt jsonb not null,
 prepared_at timestamptz not null default clock_timestamp()
);
do $$declare t text;begin
 foreach t in array array['diagnostic_pdf_staff_disclosure_policy','diagnostic_pdf_download_authorities','diagnostic_pdf_download_responses'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
 foreach t in array array['diagnostic_pdf_download_authorities','diagnostic_pdf_download_responses'] loop
  execute format('create trigger diagnostic_pdf_download_immutable before update or delete on public.%I for each row execute function public.diagnostic_immutable()',t);
  execute format('create trigger diagnostic_pdf_download_no_truncate before truncate on public.%I for each statement execute function public.diagnostic_immutable()',t);
 end loop;
end $$;

-- Job → actual reader profile → sorted role rows → disclosure policy → object.
-- Authority rows and artifacts are immutable. Historical capture actors are never authorization.
create function public.diagnostic_pdf_download_current(p_job uuid,p_pet uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare j public.diagnostic_pdf_jobs;a public.diagnostic_pdf_artifacts;i public.diagnostic_pdf_upload_intents;
 c public.diagnostic_pdf_captures;policy public.diagnostic_pdf_staff_disclosure_policy;o storage.objects;begin
 select * into j from public.diagnostic_pdf_jobs where id=p_job and pet_id=p_pet for share;
 if not found then raise exception 'Diagnostic PDF unavailable' using errcode='42501';end if;
 perform 1 from public.profiles where id=p_actor for share;
 perform 1 from public.user_roles where user_id=p_actor order by id for share;
 if not public.is_active_staff(p_actor) then raise exception 'Active staff reader required' using errcode='42501';end if;
 select * into policy from public.diagnostic_pdf_staff_disclosure_policy where singleton for share;
 if not found or not policy.enabled then raise exception 'Internal PDF disclosure disabled' using errcode='PT409';end if;
 select * into a from public.diagnostic_pdf_artifacts where job_id=p_job;
 select * into i from public.diagnostic_pdf_upload_intents where job_id=p_job;
 select * into c from public.diagnostic_pdf_captures where job_id=p_job;
 if a.job_id is null or i.job_id is null or c.job_id is null then raise exception 'Registered PDF required' using errcode='PT409';end if;
 select * into o from storage.objects where id=a.object_id for share;
 if not found or row(o.bucket_id,o.name,o.created_at,o.updated_at,o.version,o.metadata->>'mimetype',o.metadata->>'size')
  is distinct from row(i.bucket_id,i.object_path,a.object_created_at,a.object_updated_at,a.object_version,'application/pdf'::text,i.byte_length::text)
  or row(c.source_hash,c.snapshot_hash,c.sha256,c.byte_length) is distinct from row(j.source_hash,j.snapshot_hash,i.sha256,i.byte_length)
 then raise exception 'Registered PDF object unavailable' using errcode='PT409';end if;
 if not public.is_active_staff(p_actor) then raise exception 'Active staff reader required' using errcode='42501';end if;
 return jsonb_build_object('job_id',j.id,'pet_id',j.pet_id,'actor_id',p_actor,'source_hash',j.source_hash,
  'snapshot_hash',j.snapshot_hash,'manifest_sha256',i.manifest_sha256,'sha256',c.sha256,'byte_length',c.byte_length,
  'object_id',o.id,'object_created_at',o.created_at,'object_updated_at',o.updated_at,'object_version',o.version,
  'policy_hash',encode(sha256(convert_to(to_jsonb(policy)::text,'UTF8')),'hex'));
end $$;

create function public.authorize_diagnostic_pdf_download(p_id uuid,p_job uuid,p_pet uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();binding jsonb;a public.diagnostic_pdf_download_authorities;begin
 if p_id is null then raise exception 'Download request identity required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('diagnostic-pdf-download:'||p_id::text,0));
 binding:=public.diagnostic_pdf_download_current(p_job,p_pet,actor);
 select * into a from public.diagnostic_pdf_download_authorities where id=p_id;
 if found then
  if row(a.job_id,a.pet_id,a.actor_id,a.binding) is distinct from row(p_job,p_pet,actor,binding) then raise exception 'Download request intent changed' using errcode='23505';end if;
  if a.expires_at<=clock_timestamp() then raise exception 'Download authorization expired' using errcode='PT409';end if;
 else
  insert into public.diagnostic_pdf_download_authorities(id,job_id,pet_id,actor_id,binding,expires_at)
   values(p_id,p_job,p_pet,actor,binding,clock_timestamp()+interval '30 seconds') returning * into a;
 end if;
 return jsonb_build_object('authority_id',a.id,'job_id',a.job_id,'pet_id',a.pet_id,'actor_id',a.actor_id,
  'sha256',binding->>'sha256','byte_length',(binding->>'byte_length')::integer,'expires_at',a.expires_at);
end $$;

create function public.diagnostic_pdf_download_authority(p_id uuid,p_actor uuid) returns public.diagnostic_pdf_download_authorities
language plpgsql security definer set search_path=public as $$
declare a public.diagnostic_pdf_download_authorities;current_binding jsonb;begin
 select * into a from public.diagnostic_pdf_download_authorities where id=p_id and actor_id=p_actor;
 if not found then raise exception 'Diagnostic PDF authority unavailable' using errcode='42501';end if;
 current_binding:=public.diagnostic_pdf_download_current(a.job_id,a.pet_id,p_actor);
 if a.expires_at<=clock_timestamp() or a.binding is distinct from current_binding then raise exception 'Diagnostic PDF authority stale' using errcode='PT409';end if;
 return a;
end $$;

create function public.read_diagnostic_pdf_download_context(p_id uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a public.diagnostic_pdf_download_authorities;i public.diagnostic_pdf_upload_intents;begin
 perform public.communication_require_service();a:=public.diagnostic_pdf_download_authority(p_id,p_actor);
 select * into i from public.diagnostic_pdf_upload_intents where job_id=a.job_id;
 return jsonb_build_object('authority_id',a.id,'job_id',a.job_id,'pet_id',a.pet_id,'actor_id',a.actor_id,
  'sha256',i.sha256,'byte_length',i.byte_length,'expires_at',a.expires_at,'bucket',i.bucket_id,'object_path',i.object_path);
end $$;

create function public.complete_diagnostic_pdf_download(p_id uuid,p_actor uuid,p_base64 text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a public.diagnostic_pdf_download_authorities;c public.diagnostic_pdf_captures;b bytea;r jsonb;begin
 perform public.communication_require_service();a:=public.diagnostic_pdf_download_authority(p_id,p_actor);
 if p_base64 is null or length(p_base64)>4194304 or p_base64!~'^[A-Za-z0-9+/]*={0,2}$' then raise exception 'Bounded PDF bytes required' using errcode='23514';end if;
 b:=decode(p_base64,'base64');select * into c from public.diagnostic_pdf_captures where job_id=a.job_id;
 if replace(encode(b,'base64'),E'\n','')<>p_base64 or b is distinct from c.bytes or octet_length(b)<>c.byte_length then raise exception 'Registered PDF bytes differ' using errcode='23514';end if;
 if a.expires_at<=clock_timestamp() then raise exception 'Diagnostic PDF authority expired' using errcode='PT409';end if;
 r:=jsonb_build_object('authority_id',a.id,'job_id',a.job_id,'pet_id',a.pet_id,'actor_id',p_actor,'sha256',c.sha256,
  'byte_length',c.byte_length,'outcome','response_prepared');
 insert into public.diagnostic_pdf_download_responses(authority_id,actor_id,receipt) values(a.id,p_actor,r) on conflict do nothing;
 -- A concurrent replay can wait on the unique audit row past authority expiry.
 if a.expires_at<=clock_timestamp() then raise exception 'Diagnostic PDF authority expired after audit wait' using errcode='PT409';end if;
 return r;
end $$;

-- Safe staff projection; object presence is metadata availability, verified again during download.
create function public.read_diagnostic_pdf_review(p_job uuid,p_pet uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare j public.diagnostic_pdf_jobs;v public.diagnostic_panel_versions;p public.diagnostic_pdf_processing;
 a public.diagnostic_pdf_artifacts;c public.diagnostic_pdf_captures;present boolean;disclosure_on boolean;begin
 perform public.clinical_require_staff();select * into j from public.diagnostic_pdf_jobs where id=p_job and pet_id=p_pet;
 if not found then return null;end if;
 select * into v from public.diagnostic_panel_versions where id=j.id;
 select * into p from public.diagnostic_pdf_processing where job_id=j.id;
 select * into a from public.diagnostic_pdf_artifacts where job_id=j.id;
 select * into c from public.diagnostic_pdf_captures where job_id=j.id;
 select exists(select 1 from storage.objects o join public.diagnostic_pdf_upload_intents i on i.job_id=j.id and o.bucket_id=i.bucket_id and o.name=i.object_path
  where o.id=a.object_id and o.created_at=a.object_created_at and o.updated_at=a.object_updated_at and o.version=a.object_version
  and o.metadata->>'mimetype'='application/pdf' and o.metadata->>'size'=i.byte_length::text) into present;
 select exists(select 1 from public.diagnostic_pdf_staff_disclosure_policy where singleton and enabled) into disclosure_on;
 return jsonb_build_object('job_id',j.id,'pet_id',j.pet_id,'version',v.number,'reviewed_at',v.reviewed_at,
  'historical',exists(select 1 from public.diagnostic_panel_versions later where later.panel_id=j.panel_id and later.number>v.number),
  'state',case when a.job_id is not null and not present then 'unavailable' when a.job_id is not null then 'stored_private'
   when p.state='failed' or j.status='failed' then 'failed' when p.state='claimed' or j.status='claimed' then 'preparing'
   when not exists(select 1 from public.diagnostic_pdf_worker_policy where singleton and enabled) then 'off' else 'waiting' end,
  'last_error',coalesce(p.last_error,''),'download_available',disclosure_on and a.job_id is not null and present,
  'sha256',case when a.job_id is not null then c.sha256 else null end,'byte_length',case when a.job_id is not null then c.byte_length else null end,
  'export_eligible',false);
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure as signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in
 ('diagnostic_pdf_download_current','authorize_diagnostic_pdf_download','diagnostic_pdf_download_authority','read_diagnostic_pdf_download_context','complete_diagnostic_pdf_download','read_diagnostic_pdf_review') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in('authorize_diagnostic_pdf_download','read_diagnostic_pdf_review') then execute format('grant execute on function %s to authenticated',f.signature);end if;
  if f.proname in('read_diagnostic_pdf_download_context','complete_diagnostic_pdf_download') then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
