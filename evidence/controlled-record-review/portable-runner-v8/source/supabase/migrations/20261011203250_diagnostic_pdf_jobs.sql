-- Durable recovery foundation. Captures are NEVER validated/ready/release eligible here.
create table public.diagnostic_pdf_worker_policy (
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 renderer_sha text not null check(renderer_sha~'^[a-f0-9]{64}$'),settings_sha text not null check(settings_sha~'^[a-f0-9]{64}$'),
 accepted_by uuid not null references public.profiles(id),accepted_at timestamptz not null default clock_timestamp()
);
create table public.diagnostic_pdf_jobs (
 id uuid primary key,panel_id uuid not null,pet_id uuid not null references public.pets(id),
 source_hash text not null check(source_hash~'^[a-f0-9]{64}$'),snapshot jsonb not null,snapshot_hash text not null check(snapshot_hash~'^[a-f0-9]{64}$'),
 requested_by uuid not null references public.profiles(id),created_by uuid not null references public.profiles(id),updated_by uuid not null references public.profiles(id),
 status text not null default 'pending' check(status in ('pending','claimed','failed','captured_unverified')),
 version integer not null default 1 check(version>0),fence integer not null default 0 check(fence>=0),
 claim_id uuid,lease_until timestamptz,renderer_sha text,settings_sha text,last_error text not null default '' check(length(last_error)<=2000),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(id,panel_id) references public.diagnostic_panel_versions(id,panel_id),
 check((status='claimed')=(claim_id is not null and lease_until is not null)),
 check((claim_id is null)=(lease_until is null)),check((renderer_sha is null)=(settings_sha is null))
);
create index diagnostic_pdf_jobs_queue on public.diagnostic_pdf_jobs(status,updated_at,id);
create index diagnostic_pdf_jobs_patient on public.diagnostic_pdf_jobs(pet_id,created_at desc,id);
create table public.diagnostic_pdf_attempts (
 id uuid primary key,job_id uuid not null references public.diagnostic_pdf_jobs(id),fence integer not null check(fence>0),
 actor_id uuid not null references public.profiles(id),renderer_sha text not null,settings_sha text not null,
 lease_until timestamptz not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(job_id,fence)
);
create table public.diagnostic_pdf_captures (
 job_id uuid primary key references public.diagnostic_pdf_jobs(id),claim_id uuid not null references public.diagnostic_pdf_attempts(id),
 fence integer not null,actor_id uuid not null references public.profiles(id),source_hash text not null,snapshot_hash text not null,
 renderer_sha text not null,settings_sha text not null,bytes bytea not null check(octet_length(bytes) between 1 and 3145728),
 sha256 text not null check(sha256~'^[a-f0-9]{64}$'),byte_length integer not null,metadata jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create table public.diagnostic_pdf_actions (
 id uuid primary key,job_id uuid not null references public.diagnostic_pdf_jobs(id),actor_id uuid not null references public.profiles(id),
 intent jsonb not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create table public.diagnostic_pdf_revisions (
 job_id uuid not null references public.diagnostic_pdf_jobs(id),version integer not null,snapshot jsonb not null,
 actor_id uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp(),primary key(job_id,version)
);
create function public.diagnostic_pdf_guard() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP='DELETE' or TG_OP='TRUNCATE' then raise exception 'PDF job evidence cannot be removed' using errcode='23514';end if;
 if TG_OP='UPDATE' then
  if row(NEW.id,NEW.panel_id,NEW.pet_id,NEW.source_hash,NEW.snapshot,NEW.snapshot_hash,NEW.created_by,NEW.created_at) is distinct from row(OLD.id,OLD.panel_id,OLD.pet_id,OLD.source_hash,OLD.snapshot,OLD.snapshot_hash,OLD.created_by,OLD.created_at) then raise exception 'PDF source evidence is immutable' using errcode='23514';end if;
  if OLD.renderer_sha is not null and row(NEW.renderer_sha,NEW.settings_sha) is distinct from row(OLD.renderer_sha,OLD.settings_sha) then raise exception 'PDF renderer binding is immutable' using errcode='23514';end if;
  if OLD.status='captured_unverified' and NEW.status<>OLD.status then raise exception 'Captured PDF bytes cannot be regenerated' using errcode='23514';end if;
  if NEW.fence<OLD.fence then raise exception 'PDF fence cannot regress' using errcode='23514';end if;
  NEW.version:=OLD.version+1;
 else NEW.version:=1;end if;
 NEW.updated_at:=clock_timestamp();return NEW;
end $$;
create trigger diagnostic_pdf_guard before insert or update or delete on public.diagnostic_pdf_jobs for each row execute function public.diagnostic_pdf_guard();
create trigger diagnostic_pdf_no_truncate before truncate on public.diagnostic_pdf_jobs for each statement execute function public.diagnostic_pdf_guard();
create function public.diagnostic_pdf_revision() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.diagnostic_pdf_revisions(job_id,version,snapshot,actor_id) values(NEW.id,NEW.version,to_jsonb(NEW),NEW.updated_by);return NEW;end $$;
create trigger diagnostic_pdf_revision after insert or update on public.diagnostic_pdf_jobs for each row execute function public.diagnostic_pdf_revision();
do $$declare t text;begin
 foreach t in array array['diagnostic_pdf_attempts','diagnostic_pdf_captures','diagnostic_pdf_actions','diagnostic_pdf_revisions'] loop
 execute format('create trigger diagnostic_pdf_immutable before update or delete on public.%I for each row execute function public.diagnostic_immutable()',t);
 execute format('create trigger diagnostic_pdf_no_truncate before truncate on public.%I for each statement execute function public.diagnostic_immutable()',t);
 end loop;
 foreach t in array array['diagnostic_pdf_worker_policy','diagnostic_pdf_jobs','diagnostic_pdf_attempts','diagnostic_pdf_captures','diagnostic_pdf_actions','diagnostic_pdf_revisions'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
create function public.diagnostic_pdf_queue(p_id uuid,p_actor uuid) returns void language plpgsql security definer set search_path=public as $$
declare v public.diagnostic_panel_versions;p public.pets;s jsonb;
begin
 select * into strict v from public.diagnostic_panel_versions where id=p_id;
 select * into strict p from public.pets where id=v.pet_id for share;
 s:=jsonb_build_object('schema',1,'purpose','diagnostic_result','diagnostic',to_jsonb(v),'patient',jsonb_build_object('id',p.id,'name',p.name,'species',p.species,'breed',p.breed,'dob',p.dob,'birth_date_precision',p.birth_date_precision,'microchip_id',p.microchip_id));
 insert into public.diagnostic_pdf_jobs(id,panel_id,pet_id,source_hash,snapshot,snapshot_hash,requested_by,created_by,updated_by)
 values(v.id,v.panel_id,v.pet_id,v.source_hash,s,encode(sha256(convert_to(s::text,'UTF8')),'hex'),p_actor,p_actor,p_actor) on conflict(id) do nothing;
end $$;
create function public.diagnostic_pdf_enqueue_review() returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.diagnostic_pdf_queue(NEW.id,NEW.reviewed_by);return NEW;end $$;
create trigger diagnostic_pdf_enqueue_review after insert on public.diagnostic_panel_versions for each row execute function public.diagnostic_pdf_enqueue_review();
create function public.diagnostic_pdf_detail(p_id uuid,p_pet_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('job',to_jsonb(j),'capture',c.metadata,'worker_configured',exists(select 1 from public.diagnostic_pdf_worker_policy where enabled),'owner_active',public.is_active_staff(j.requested_by),'pdf_status','not_available','export_eligible',false)
 from public.diagnostic_pdf_jobs j left join public.diagnostic_pdf_captures c on c.job_id=j.id where j.id=p_id and j.pet_id=p_pet_id
$$;
create function public.read_diagnostic_pdf_job(p_id uuid,p_pet_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
begin perform public.clinical_require_staff();return public.diagnostic_pdf_detail(p_id,p_pet_id);end $$;
create function public.request_diagnostic_pdf_job(p_action_id uuid,p_id uuid,p_pet_id uuid,p_source_hash text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();v public.diagnostic_panel_versions;a public.diagnostic_pdf_actions;intent jsonb:=jsonb_build_object('kind','request','source_hash',p_source_hash);result jsonb;
begin
 if p_action_id is null or p_id is null or p_pet_id is null then raise exception 'Stable PDF request identity required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_action_id::text,491));
 select * into a from public.diagnostic_pdf_actions where id=p_action_id;
 if found then if a.actor_id<>actor or a.job_id<>p_id or a.intent is distinct from intent or a.receipt#>>'{job,pet_id}'<>p_pet_id::text then raise exception 'PDF action conflicts with saved work' using errcode='23505';end if;return a.receipt;end if;
 select * into v from public.diagnostic_panel_versions where id=p_id and pet_id=p_pet_id;
 if not found then raise exception 'Reviewed PDF source unavailable' using errcode='42501';end if;
 if p_source_hash is distinct from v.source_hash then raise exception 'Exact reviewed PDF source hash required' using errcode='PT409';end if;
 perform public.diagnostic_pdf_queue(p_id,actor);perform public.clinical_require_staff();result:=public.diagnostic_pdf_detail(p_id,p_pet_id);
 insert into public.diagnostic_pdf_actions(id,job_id,actor_id,intent,receipt) values(p_action_id,p_id,actor,intent,result);return result;
end $$;
create function public.retry_diagnostic_pdf_job(p_action_id uuid,p_id uuid,p_pet_id uuid,p_expected_version integer,p_reason text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();j public.diagnostic_pdf_jobs;a public.diagnostic_pdf_actions;intent jsonb:=jsonb_build_object('kind','retry','version',p_expected_version,'reason',p_reason);result jsonb;
begin
 if p_action_id is null or p_id is null or p_pet_id is null or p_reason is null or length(trim(p_reason)) not between 1 and 2000 or p_reason<>trim(p_reason) then raise exception 'Explicit bounded PDF recovery reason required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_action_id::text,491));select * into a from public.diagnostic_pdf_actions where id=p_action_id;
 if found then if a.actor_id<>actor or a.job_id<>p_id or a.intent is distinct from intent or a.receipt#>>'{job,pet_id}'<>p_pet_id::text then raise exception 'PDF action conflicts with saved work' using errcode='23505';end if;return a.receipt;end if;
 select * into j from public.diagnostic_pdf_jobs where id=p_id and pet_id=p_pet_id for update;
 if not found then raise exception 'PDF job unavailable' using errcode='42501';end if;
 if j.version is distinct from p_expected_version or (j.status='claimed' and j.lease_until>clock_timestamp()) or (j.status='captured_unverified' and public.is_active_staff(j.requested_by)) then raise exception 'PDF job changed or is not retryable' using errcode='PT409';end if;
 perform public.clinical_require_staff();update public.diagnostic_pdf_jobs set status=case when status='captured_unverified' then status else 'pending' end,requested_by=actor,updated_by=actor,claim_id=null,lease_until=null,last_error='' where id=p_id;
 result:=public.diagnostic_pdf_detail(p_id,p_pet_id);insert into public.diagnostic_pdf_actions(id,job_id,actor_id,intent,receipt) values(p_action_id,p_id,actor,intent,result);return result;
end $$;
create function public.claim_diagnostic_pdf_job(p_id uuid,p_claim_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.diagnostic_pdf_jobs;a public.diagnostic_pdf_attempts;p public.diagnostic_pdf_worker_policy;receipt jsonb;deadline timestamptz;
begin
 perform public.communication_require_service();if p_id is null or p_claim_id is null then raise exception 'Stable PDF claim identity required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_claim_id::text,492));
 select * into a from public.diagnostic_pdf_attempts where id=p_claim_id;
 select * into j from public.diagnostic_pdf_jobs where id=p_id for update;
 if j.id is null then return null;end if;
 if a.id is not null then
  if a.job_id<>p_id then raise exception 'PDF claim belongs to another job' using errcode='23505';end if;
  if j.claim_id is distinct from a.id or j.fence<>a.fence or j.lease_until<=clock_timestamp() then raise exception 'PDF claim expired or was superseded' using errcode='PT409';end if;
  if not public.is_active_staff(j.requested_by) then raise exception 'Active PDF request owner required' using errcode='42501';end if;
  return a.receipt;
 end if;
 select * into p from public.diagnostic_pdf_worker_policy where singleton and enabled for share;
 if not found then return null;end if;
 if not public.is_active_staff(j.requested_by) then raise exception 'Active PDF request owner required' using errcode='42501';end if;
 if j.status not in ('pending','claimed') or (j.status='claimed' and j.lease_until>clock_timestamp()) then return null;end if;
 if j.renderer_sha is not null and row(j.renderer_sha,j.settings_sha) is distinct from row(p.renderer_sha,p.settings_sha) then raise exception 'Bound PDF renderer policy changed' using errcode='PT409';end if;
 deadline:=clock_timestamp()+interval '90 seconds';
 update public.diagnostic_pdf_jobs set status='claimed',claim_id=p_claim_id,lease_until=deadline,fence=fence+1,renderer_sha=p.renderer_sha,settings_sha=p.settings_sha,updated_by=requested_by,last_error='' where id=p_id returning * into j;
 if not public.is_active_staff(j.requested_by) then raise exception 'Active PDF request owner required' using errcode='42501';end if;
 receipt:=jsonb_build_object('job_id',j.id,'pet_id',j.pet_id,'claim_id',p_claim_id,'fence',j.fence,'actor_id',j.requested_by,'lease_until',deadline,'source_hash',j.source_hash,'snapshot_hash',j.snapshot_hash,'renderer_sha',j.renderer_sha,'settings_sha',j.settings_sha);
 insert into public.diagnostic_pdf_attempts(id,job_id,fence,actor_id,renderer_sha,settings_sha,lease_until,receipt) values(p_claim_id,j.id,j.fence,j.requested_by,j.renderer_sha,j.settings_sha,deadline,receipt);return receipt;
end $$;
create function public.diagnostic_pdf_live_claim(p_id uuid,p_claim_id uuid,p_fence integer,p_actor_id uuid) returns public.diagnostic_pdf_jobs language plpgsql security definer set search_path=public as $$
declare j public.diagnostic_pdf_jobs;begin
 select * into j from public.diagnostic_pdf_jobs where id=p_id for update;
 if not found or j.claim_id is distinct from p_claim_id or j.fence is distinct from p_fence or j.requested_by is distinct from p_actor_id or j.status<>'claimed' or j.lease_until<=clock_timestamp() then raise exception 'PDF claim expired or was superseded' using errcode='PT409';end if;
 if not public.is_active_staff(p_actor_id) then raise exception 'Active PDF request owner required' using errcode='42501';end if;
 perform 1 from public.diagnostic_pdf_worker_policy where singleton and enabled and renderer_sha=j.renderer_sha and settings_sha=j.settings_sha for share;
 if not found then raise exception 'Bound PDF worker policy unavailable' using errcode='PT409';end if;
 -- Recheck time/actor after policy lock waits.
 if j.lease_until<=clock_timestamp() then raise exception 'PDF claim expired or was superseded' using errcode='PT409';end if;
 if not public.is_active_staff(p_actor_id) then raise exception 'Active PDF request owner required' using errcode='42501';end if;
 return j;
end $$;
create function public.read_diagnostic_pdf_claim(p_id uuid,p_claim_id uuid,p_fence integer,p_actor_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.diagnostic_pdf_jobs;begin perform public.communication_require_service();j:=public.diagnostic_pdf_live_claim(p_id,p_claim_id,p_fence,p_actor_id);return jsonb_build_object('claim',(select receipt from public.diagnostic_pdf_attempts where id=p_claim_id),'snapshot',j.snapshot);end $$;
create function public.fail_diagnostic_pdf_job(p_id uuid,p_claim_id uuid,p_fence integer,p_actor_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.diagnostic_pdf_jobs;begin
 perform public.communication_require_service();if p_reason is null or length(trim(p_reason)) not between 1 and 2000 or trim(p_reason)<>p_reason then raise exception 'Explicit bounded PDF failure required' using errcode='23514';end if;
 j:=public.diagnostic_pdf_live_claim(p_id,p_claim_id,p_fence,p_actor_id);
 update public.diagnostic_pdf_jobs set status='failed',claim_id=null,lease_until=null,last_error=p_reason,updated_by=p_actor_id where id=p_id;return public.diagnostic_pdf_detail(p_id,j.pet_id);
end $$;
create function public.capture_diagnostic_pdf_bytes(p_id uuid,p_claim_id uuid,p_fence integer,p_actor_id uuid,p_source_hash text,p_snapshot_hash text,p_renderer_sha text,p_settings_sha text,p_base64 text) returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.diagnostic_pdf_jobs;c public.diagnostic_pdf_captures;b bytea;m jsonb;begin
 perform public.communication_require_service();
 if p_id is null or p_base64 is null or length(p_base64)>4194304 or p_base64!~'^[A-Za-z0-9+/]*={0,2}$' then raise exception 'Bounded canonical PDF capture bytes required' using errcode='23514';end if;
 b:=decode(p_base64,'base64');if replace(encode(b,'base64'),E'\n','')<>p_base64 or octet_length(b) not between 1 and 3145728 then raise exception 'Bounded canonical PDF capture bytes required' using errcode='23514';end if;
 if substring(b from 1 for 5)<>convert_to('%PDF-','UTF8') then raise exception 'PDF format marker required; capture remains unverified' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,493));select * into c from public.diagnostic_pdf_captures where job_id=p_id;
 if found then
  if row(c.claim_id,c.fence,c.actor_id,c.source_hash,c.snapshot_hash,c.renderer_sha,c.settings_sha,c.bytes) is distinct from row(p_claim_id,p_fence,p_actor_id,p_source_hash,p_snapshot_hash,p_renderer_sha,p_settings_sha,b) then raise exception 'Captured PDF identity and bytes are immutable' using errcode='23505';end if;return c.metadata;
 end if;
 j:=public.diagnostic_pdf_live_claim(p_id,p_claim_id,p_fence,p_actor_id);
 if row(j.source_hash,j.snapshot_hash,j.renderer_sha,j.settings_sha) is distinct from row(p_source_hash,p_snapshot_hash,p_renderer_sha,p_settings_sha) then raise exception 'PDF capture source or renderer binding differs' using errcode='23514';end if;
 m:=jsonb_build_object('job_id',j.id,'pet_id',j.pet_id,'claim_id',p_claim_id,'fence',p_fence,'actor_id',p_actor_id,'source_hash',j.source_hash,'snapshot_hash',j.snapshot_hash,'renderer_sha',j.renderer_sha,'settings_sha',j.settings_sha,'byte_length',octet_length(b),'sha256',encode(sha256(b),'hex'),'validation_status','not_validated','storage_status','not_uploaded','export_eligible',false);
 insert into public.diagnostic_pdf_captures(job_id,claim_id,fence,actor_id,source_hash,snapshot_hash,renderer_sha,settings_sha,bytes,sha256,byte_length,metadata) values(j.id,p_claim_id,p_fence,p_actor_id,j.source_hash,j.snapshot_hash,j.renderer_sha,j.settings_sha,b,m->>'sha256',octet_length(b),m);
 update public.diagnostic_pdf_jobs set status='captured_unverified',claim_id=null,lease_until=null,updated_by=p_actor_id where id=p_id;
 if j.lease_until<=clock_timestamp() then raise exception 'PDF claim expired or was superseded' using errcode='PT409';end if;
 if not public.is_active_staff(p_actor_id) then raise exception 'Active PDF request owner required' using errcode='42501';end if;return m;
end $$;
create function public.read_diagnostic_pdf_capture(p_id uuid,p_pet_id uuid,p_actor_id uuid,p_source_hash text,p_snapshot_hash text) returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.diagnostic_pdf_jobs;c public.diagnostic_pdf_captures;begin
 perform public.communication_require_service();select * into j from public.diagnostic_pdf_jobs where id=p_id and pet_id=p_pet_id;
 if not found or j.requested_by is distinct from p_actor_id or not public.is_active_staff(p_actor_id) then raise exception 'Active PDF request owner required' using errcode='42501';end if;
 if j.source_hash is distinct from p_source_hash or j.snapshot_hash is distinct from p_snapshot_hash then raise exception 'Exact PDF capture context required' using errcode='PT409';end if;
 select * into c from public.diagnostic_pdf_captures where job_id=p_id;if not found then return null;end if;
 return jsonb_build_object('metadata',c.metadata,'base64',replace(encode(c.bytes,'base64'),E'\n',''));
end $$;
-- No policy seed, backfill, scheduler, Storage readiness, registration or release-family change.
do $$declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'diagnostic_pdf_%' or p.proname in ('read_diagnostic_pdf_job','request_diagnostic_pdf_job','retry_diagnostic_pdf_job','claim_diagnostic_pdf_job','read_diagnostic_pdf_claim','fail_diagnostic_pdf_job','capture_diagnostic_pdf_bytes','read_diagnostic_pdf_capture')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.proname in ('read_diagnostic_pdf_job','request_diagnostic_pdf_job','retry_diagnostic_pdf_job') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 if f.proname in ('claim_diagnostic_pdf_job','read_diagnostic_pdf_claim','fail_diagnostic_pdf_job','capture_diagnostic_pdf_bytes','read_diagnostic_pdf_capture') then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
