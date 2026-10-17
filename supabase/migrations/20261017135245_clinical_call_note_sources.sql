-- Private call-note source contract. No reservation, generation or acceptance is enabled.
-- Sidecar bindings preserve the exact legacy typed/audio job row and JSON shape.
create table public.clinical_call_note_policies(
 version integer primary key check(version>0),status text not null check(status in('draft','approved')),
 consent_text text not null check(public.clinical_note_text_length(consent_text)between 1 and 4000 and public.clinical_note_nonblank(consent_text)),
 retention_text text not null check(public.clinical_note_text_length(retention_text)between 1 and 2000 and public.clinical_note_nonblank(retention_text)),
 reviewed_by uuid references auth.users(id),reviewed_at timestamptz,created_at timestamptz not null default clock_timestamp(),
 check((status='draft'and reviewed_by is null and reviewed_at is null)or(status='approved'and reviewed_by is not null and reviewed_at is not null))
);
insert into public.clinical_call_note_policies(version,status,consent_text,retention_text)values(1,'draft',
 'Draft for Susan: approve OpenAI processing of explicitly selected household-call evidence for one patient and unsigned encounter. Preserve uncertain speakers, other-pet statements and original call times. Full calls and unaccepted proposals remain administrator-only; only explicitly reviewed clinical wording may enter the ordinary chart. Capture approval does not approve generation.',
 'Draft for Susan: review provider handling and retention separately from retained call evidence, generated proposals and accepted chart text. No real call generation is commissioned by this draft.');
create table public.clinical_call_note_bindings(
 job_id uuid primary key references public.clinical_note_jobs(id),
 call_source_id uuid not null references public.clinical_call_sources(id),
 call_source_sha256 text not null check(call_source_sha256~'^[a-f0-9]{64}$'),
 source_capture_policy_version integer not null references public.clinical_call_policies(version),
 call_generation_policy_version integer not null references public.clinical_call_note_policies(version),
 created_at timestamptz not null default clock_timestamp()
);
create index clinical_call_note_policies_reviewer_idx on public.clinical_call_note_policies(reviewed_by);
create index clinical_call_note_bindings_source_idx on public.clinical_call_note_bindings(call_source_id);
create index clinical_call_note_bindings_capture_policy_idx on public.clinical_call_note_bindings(source_capture_policy_version);
create index clinical_call_note_bindings_generation_policy_idx on public.clinical_call_note_bindings(call_generation_policy_version);
do $$declare t text;begin
 foreach t in array array['clinical_call_note_policies','clinical_call_note_bindings']loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger call_note_immutable before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);
  execute format('create trigger call_note_no_truncate before truncate on public.%I for each statement execute function public.native_correction_immutable()',t);
 end loop;
end $$;
alter table public.clinical_note_jobs drop constraint clinical_note_jobs_source_kind_check;
alter table public.clinical_note_jobs add constraint clinical_note_jobs_source_kind_check check(source_kind in('typed','audio_transcript','call_transcript'));
alter table public.clinical_note_jobs drop constraint clinical_note_jobs_check;
alter table public.clinical_note_jobs add constraint clinical_note_jobs_check check(
 (source_kind in('typed','call_transcript')and audio_job_id is null and source_audio_policy_version is null)
 or(source_kind='audio_transcript'and audio_job_id is not null and source_audio_policy_version is not null));

-- Classify trusted stored relationships, including a binding or generation orphan.
-- These helpers are private; no browser-supplied source kind, transcript or hash authorizes access.
create function public.clinical_call_note_private_job(p_id uuid)returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from clinical_note_jobs where id=p_id and source_kind='call_transcript')or exists(select 1 from clinical_call_note_bindings where job_id=p_id)
$$;
create function public.clinical_call_note_private_proposal(p_id uuid)returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from clinical_note_jobs j where j.proposal_id=p_id and public.clinical_call_note_private_job(j.id))
 or exists(select 1 from clinical_note_generations g where g.proposal_id=p_id and public.clinical_call_note_private_job(g.job_id))
$$;
create function public.clinical_call_note_private_proposal_text(p_id text)returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare parsed uuid;begin
 if p_id is null or length(p_id)>100 then return false;end if;
 begin parsed:=p_id::uuid;exception when invalid_text_representation then return false;end;
 return public.clinical_call_note_private_proposal(parsed);
end $$;
create function public.clinical_call_note_reject_legacy_job(p_id uuid)returns void language plpgsql stable security definer set search_path=public,pg_temp as $$begin
 if public.clinical_call_note_private_job(p_id)then raise exception 'Private call jobs require their versioned call workflow'using errcode='PT403';end if;
end $$;
create function public.clinical_call_note_reject_legacy_proposal(p_id uuid)returns void language plpgsql stable security definer set search_path=public,pg_temp as $$begin
 if public.clinical_call_note_private_proposal(p_id)then raise exception 'Private call proposals are unavailable in this workflow'using errcode='PT403';end if;
end $$;
create function public.clinical_call_note_reject_legacy_action(p_id uuid)returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
declare a clinical_dictation_actions;begin
 select *into a from clinical_dictation_actions where id=p_id;if not found then return;end if;
 if public.clinical_call_note_private_proposal(a.id)
 or public.clinical_call_note_private_proposal_text(a.request->>'proposal_id')
 or public.clinical_call_note_private_proposal_text(a.receipt->>'proposal_id')then
  raise exception 'Private call review receipts require their call workflow'using errcode='PT403';
 end if;
end $$;

-- A deferred two-way check permits atomic job+binding insertion and restored historical rows.
-- It verifies immutable source identity; it deliberately does not require an old operator's live session.
create function public.clinical_call_note_check_binding(p_id uuid)returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;b clinical_call_note_bindings;s clinical_call_sources;begin
 select *into j from clinical_note_jobs where id=p_id;select *into b from clinical_call_note_bindings where job_id=p_id;
 if j.id is null then
  if b.job_id is not null then raise exception 'Call binding has no note job'using errcode='23514';end if;return;
 end if;
 if j.source_kind<>'call_transcript'then
  if b.job_id is not null then raise exception 'Only call jobs may have call bindings'using errcode='23514';end if;return;
 end if;
 if b.job_id is null then raise exception 'Call job requires an immutable source binding'using errcode='23514';end if;
 select *into s from clinical_call_sources where id=b.call_source_id;
 if s.id is null or s.pet_id is distinct from j.pet_id or s.encounter_id is distinct from j.encounter_id
 or s.sha256 is distinct from b.call_source_sha256 or s.policy_version is distinct from b.source_capture_policy_version
 or s.sha256 is distinct from public.clinical_recap_hash(jsonb_build_object('context',s.context,'document',s.document))
 or j.source_text is distinct from(s.document->>'projection')
 or j.source_sha256 is distinct from encode(extensions.digest(convert_to(s.document->>'projection','UTF8'),'sha256'),'hex')then
  raise exception 'Exact immutable call source, patient and encounter required'using errcode='23514';
 end if;
end $$;
create function public.clinical_call_note_binding_trigger()returns trigger language plpgsql security definer set search_path=public,pg_temp as $$begin
 if TG_TABLE_NAME='clinical_note_jobs'then perform public.clinical_call_note_check_binding(new.id);
 else perform public.clinical_call_note_check_binding(new.job_id);end if;return null;
end $$;
create constraint trigger call_note_job_binding after insert or update on public.clinical_note_jobs deferrable initially deferred for each row execute function public.clinical_call_note_binding_trigger();
create constraint trigger call_note_source_binding after insert on public.clinical_call_note_bindings deferrable initially deferred for each row execute function public.clinical_call_note_binding_trigger();

-- Historical reads revalidate the current reader and canonical source association, not generation eligibility.
create function public.read_clinical_call_note_job_v1(p_actor_id uuid,p_id uuid)returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;b clinical_call_note_bindings;s clinical_call_sources;begin
 perform public.clinical_call_actor(p_actor_id);
 select *into j from clinical_note_jobs where id=p_id;
 select *into b from clinical_call_note_bindings where job_id=p_id;
 if j.id is null or j.source_kind<>'call_transcript'or b.job_id is null then raise exception 'Private call note missing'using errcode='PT404';end if;
 perform public.clinical_call_note_check_binding(j.id);
 select *into s from clinical_call_sources where id=b.call_source_id;
 perform public.clinical_call_source_access(s);
 perform public.clinical_call_actor(p_actor_id);
 return jsonb_build_object('contract_version','clinical-call-note-source-v1','job',to_jsonb(j)-array['session_id','intent'],'binding',to_jsonb(b),'source_context',s.context);
end $$;

-- Legacy endpoints retain their exact typed/audio contracts and refuse all private call paths.
create or replace function public.clinical_note_job_view(p_id uuid)returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$begin
 perform public.clinical_call_note_reject_legacy_job(p_id);
 return(select(to_jsonb(j)-array['session_id','intent'])||jsonb_build_object('attempts',coalesce((select jsonb_agg(to_jsonb(a)-array['session_id','result']order by a.created_at desc,a.id desc)from(select *from clinical_note_attempts where job_id=j.id order by created_at desc,id desc limit 20)a),'[]'))from clinical_note_jobs j where j.id=p_id);
end $$;

create or replace function public.read_clinical_notes(p_actor_id uuid,p_pet_id uuid,p_encounter_id uuid)returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin perform public.clinical_dictation_actor(p_actor_id);if not exists(select 1 from clinical_encounters where id=p_encounter_id and pet_id=p_pet_id)then raise exception 'Matching encounter required'using errcode='23514';end if;
 return jsonb_build_object('actor_id',p_actor_id,'pet_id',p_pet_id,'encounter_id',p_encounter_id,'policy',to_jsonb(public.clinical_note_current_policy()),'templates',public.clinical_note_template_list(),'jobs',coalesce((select jsonb_agg(public.clinical_note_job_view(j.id)order by j.created_at desc,j.id desc)from(select id,created_at from clinical_note_jobs where pet_id=p_pet_id and encounter_id=p_encounter_id and not public.clinical_call_note_private_job(id) order by created_at desc,id desc limit 10)j),'[]'));end $$;

create or replace function public.read_clinical_note_job(p_actor_id uuid,p_id uuid)returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;begin perform public.clinical_dictation_actor(p_actor_id);select *into j from clinical_note_jobs where id=p_id;if not found then raise exception 'Note job missing'using errcode='23514';end if;
 perform public.clinical_call_note_reject_legacy_job(j.id);
 return jsonb_build_object('job',public.clinical_note_job_view(j.id),'policy',to_jsonb(public.clinical_note_current_policy()),'template',(select jsonb_build_object('id',t.id,'version',v.version,'definition',v.definition,'sha256',v.sha256,'status',case when t.retired then'retired'when t.approved_version=v.version then'approved'else'draft'end)from clinical_note_templates t join clinical_note_template_versions v on v.template_id=t.id where t.id=j.template_id and v.version=j.template_version));end $$;

create or replace function public.clinical_note_guard(j public.clinical_note_jobs)returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare p clinical_note_policies;t clinical_note_templates;a clinical_audio_jobs;begin
 if j.source_kind='call_transcript'then raise exception 'Call generation is unavailable in the legacy note pipeline'using errcode='PT403';end if;perform public.clinical_call_note_reject_legacy_job(j.id);
 perform public.clinical_audio_worker_actor(j.actor_id,j.session_id);perform pg_advisory_xact_lock(hashtextextended('clinical-note-policy',0));p:=public.clinical_note_current_policy();
 if p.status<>'approved'or p.version<>j.policy_version then raise exception 'Note processing policy awaits approval or changed'using errcode='42501';end if;
 select *into t from clinical_note_templates where id=j.template_id for share;
 if not found or t.retired or t.approved_version is distinct from j.template_version or not exists(select 1 from clinical_note_template_versions where template_id=j.template_id and version=j.template_version and sha256=j.template_hash)then raise exception 'Exact approved template changed or retired'using errcode='PT409';end if;
 perform 1 from clinical_encounters e join pets patient on patient.id=e.pet_id where e.id=j.encounter_id and e.pet_id=j.pet_id and e.version=j.expected_version and e.status='draft'and patient.archived_at is null and patient.deceased_at is null for share of e,patient;
 if not found then raise exception 'Destination changed, inactive or signed; original source retained'using errcode='PT409';end if;
 if j.source_kind='audio_transcript'then
  select *into a from clinical_audio_jobs where id=j.audio_job_id;
  if not found or a.actor_id<>j.actor_id or a.pet_id<>j.pet_id or a.encounter_id<>j.encounter_id or a.expected_version<>j.expected_version or a.policy_version<>j.source_audio_policy_version or a.transcript is distinct from j.source_text or not exists(select 1 from clinical_audio_attempts where job_id=a.id and stage='transcribe'and state='completed')then raise exception 'Exact owned completed audio transcript required'using errcode='42501';end if;
  perform public.clinical_audio_worker_actor(a.actor_id,a.session_id);perform public.clinical_audio_policy_guard(a.policy_version);
 end if;
 -- Authorization may have changed while waiting on policy, template or destination locks.
 perform public.clinical_audio_worker_actor(j.actor_id,j.session_id);
end $$;

create or replace function public.reserve_clinical_note(p_actor_id uuid,p_id uuid,p_request jsonb)returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_dictation_actor(p_actor_id);j clinical_note_jobs;a clinical_audio_jobs;begin
 if p_id is null or current_setting('transaction_isolation')<>'read committed'then raise exception 'Note UUID and READ COMMITTED required'using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-note-actor:'||actor::text,0));perform pg_advisory_xact_lock(hashtextextended('clinical-note:'||p_id::text,0));
 perform public.clinical_dictation_actor(actor);
 select *into j from clinical_note_jobs where id=p_id;if found then perform public.clinical_call_note_reject_legacy_job(j.id);
 if j.actor_id<>actor then raise exception 'Note request belongs to another operator'using errcode='42501';end if;if j.intent is distinct from p_request then raise exception 'Note UUID belongs to different source'using errcode='23505';end if;return public.clinical_note_job_view(j.id);end if;
 if exists(select 1 from clinical_note_reservation_cancellations where id=p_id)then raise exception 'Note reservation cancelled; start a new action'using errcode='PT409';end if;
 perform public.native_rx_keys(p_request,array['pet_id','encounter_id','expected_version','policy_version','template_id','template_version','template_hash','source_kind','source_text','audio_job_id','source_note','attest_authorized']);
 if jsonb_typeof(p_request->'pet_id')is distinct from'string'or jsonb_typeof(p_request->'encounter_id')is distinct from'string'or jsonb_typeof(p_request->'template_id')is distinct from'string'or jsonb_typeof(p_request->'template_hash')is distinct from'string'or p_request->>'template_hash'!~'^[a-f0-9]{64}$'or jsonb_typeof(p_request->'source_kind')is distinct from'string'or p_request->>'source_kind'not in('typed','audio_transcript')or jsonb_typeof(p_request->'source_note')is distinct from'string'or public.clinical_note_text_length(p_request->>'source_note')not between 1 and 1000 or not public.clinical_note_nonblank(p_request->>'source_note') or p_request->'attest_authorized'is distinct from'true'::jsonb then raise exception 'Bounded authorized patient source and template required'using errcode='23514';end if;
 j.id:=p_id;j.actor_id:=actor;j.session_id:=public.next_visit_review_session();j.pet_id:=(p_request->>'pet_id')::uuid;j.encounter_id:=(p_request->>'encounter_id')::uuid;j.expected_version:=public.appointment_catalog_integer(p_request->'expected_version',1,2147483646);j.policy_version:=public.appointment_catalog_integer(p_request->'policy_version',1,2147483646);j.template_id:=(p_request->>'template_id')::uuid;j.template_version:=public.appointment_catalog_integer(p_request->'template_version',1,2147483646);j.template_hash:=p_request->>'template_hash';j.source_kind:=p_request->>'source_kind';j.source_note:=p_request->>'source_note';j.intent:=p_request;
 if j.source_kind='typed'then
  if jsonb_typeof(p_request->'source_text')is distinct from'string'or public.clinical_note_text_length(p_request->>'source_text')not between 1 and 60000 or not public.clinical_note_nonblank(p_request->>'source_text')or p_request->'audio_job_id'is distinct from'null'::jsonb then raise exception 'Typed observations require bounded source text and no audio identity'using errcode='23514';end if;j.source_text:=p_request->>'source_text';
 else
  if p_request->'source_text'is distinct from'null'::jsonb or jsonb_typeof(p_request->'audio_job_id')is distinct from'string'then raise exception 'Audio transcript must reference original source, never supplied text'using errcode='23514';end if;j.audio_job_id:=(p_request->>'audio_job_id')::uuid;select *into a from clinical_audio_jobs where id=j.audio_job_id;
  if not found or a.transcript is null then raise exception 'Completed audio transcript required'using errcode='23514';end if;j.source_text:=a.transcript;j.source_audio_policy_version:=a.policy_version;
 end if;
 j.source_sha256:=encode(extensions.digest(convert_to(j.source_text,'UTF8'),'sha256'),'hex');perform public.clinical_note_guard(j);perform public.clinical_dictation_actor(actor);
 if(select count(*)from clinical_note_jobs where actor_id=actor and created_at>clock_timestamp()-interval'1 hour')>=12 or(select count(*)from clinical_note_jobs where actor_id=actor and created_at>clock_timestamp()-interval'1 day')>=100 then raise exception 'Note generation limit reached'using errcode='23514';end if;
 insert into clinical_note_jobs(id,actor_id,session_id,pet_id,encounter_id,expected_version,policy_version,template_id,template_version,template_hash,source_kind,source_text,source_sha256,audio_job_id,source_audio_policy_version,source_note,intent)values(j.id,j.actor_id,j.session_id,j.pet_id,j.encounter_id,j.expected_version,j.policy_version,j.template_id,j.template_version,j.template_hash,j.source_kind,j.source_text,j.source_sha256,j.audio_job_id,j.source_audio_policy_version,j.source_note,j.intent);
 insert into clinical_note_events(job_id,actor_id,kind,details)values(j.id,actor,'reserved',jsonb_build_object('source_kind',j.source_kind,'source_sha256',j.source_sha256,'policy_version',j.policy_version,'template_id',j.template_id,'template_version',j.template_version,'template_hash',j.template_hash));return public.clinical_note_job_view(j.id);
end $$;

create or replace function public.cancel_clinical_note_reservation(p_actor_id uuid,p_id uuid)returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_dictation_actor(p_actor_id);j clinical_note_jobs;c clinical_note_reservation_cancellations;begin
 if p_id is null or current_setting('transaction_isolation')<>'read committed'then raise exception 'Note UUID and READ COMMITTED required'using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-note-actor:'||actor::text,0));perform pg_advisory_xact_lock(hashtextextended('clinical-note:'||p_id::text,0));
 perform public.clinical_dictation_actor(actor);
 select *into j from clinical_note_jobs where id=p_id;if found then perform public.clinical_call_note_reject_legacy_job(j.id); if j.actor_id<>actor then raise exception 'Note reservation belongs to another operator'using errcode='42501';end if;return jsonb_build_object('cancelled',false,'job',public.clinical_note_job_view(j.id));end if;
 select *into c from clinical_note_reservation_cancellations where id=p_id;if found and c.actor_id<>actor then raise exception 'Note cancellation belongs to another operator'using errcode='42501';end if;
 insert into clinical_note_reservation_cancellations(id,actor_id,session_id)values(p_id,actor,public.next_visit_review_session())on conflict(id)do nothing;return jsonb_build_object('cancelled',true,'job',null);
end $$;

create or replace function public.claim_clinical_note(p_actor_id uuid,p_id uuid,p_job_id uuid,p_retry_of uuid default null,p_reason text default'',p_ack_cost boolean default false)returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_dictation_actor(p_actor_id);j clinical_note_jobs;a clinical_note_attempts;old clinical_note_attempts;c clinical_note_attempt_cancellations;intent jsonb;p clinical_note_policies;begin
 if p_id is null or p_job_id is null or p_reason is null or public.clinical_note_text_length(p_reason)>1000 or p_ack_cost is null or current_setting('transaction_isolation')<>'read committed'then raise exception 'Exact note attempt required'using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-note-actor:'||actor::text,0));select *into j from clinical_note_jobs where id=p_job_id for update;if not found or j.actor_id<>actor then raise exception 'Owned note job required'using errcode='42501';end if;perform public.clinical_call_note_reject_legacy_job(j.id);
 perform public.clinical_dictation_actor(actor);
 intent:=jsonb_build_object('job_id',p_job_id,'retry_of',p_retry_of,'reason',p_reason,'ack_cost',p_ack_cost);
 select *into c from clinical_note_attempt_cancellations where id=p_id;
 if found then
  if c.actor_id<>actor or c.job_id<>j.id or c.intent is distinct from intent then raise exception 'Cancelled attempt UUID belongs to different work'using errcode='23505';end if;
  raise exception 'Note attempt cancelled before dispatch; start a new action'using errcode='PT409';
 end if;
 select *into a from clinical_note_attempts where id=p_id;if found then if a.actor_id<>actor or a.intent is distinct from intent then raise exception 'Note attempt UUID belongs to different work'using errcode='23505';end if;return to_jsonb(a)-array['session_id','result'];end if;
 perform public.clinical_note_guard(j);p:=public.clinical_note_current_policy();if j.proposal_id is not null then raise exception 'Generation already complete'using errcode='PT409';end if;
 select *into old from clinical_note_attempts where job_id=j.id order by created_at desc,id desc limit 1;
 if found then
  if p_retry_of is distinct from old.id or not public.clinical_note_nonblank(p_reason)or not p_ack_cost then raise exception 'Explicit retry, reason and possible-charge acknowledgement required'using errcode='23514';end if;
  if old.state='completed'or(old.state in('claimed','sending')and old.lease_until>clock_timestamp())then raise exception 'Original attempt complete or still running; recover it'using errcode='PT409';end if;
  if old.finished_at is not null and old.failure_details?'retry_after_seconds'and old.finished_at+make_interval(secs=>(old.failure_details->>'retry_after_seconds')::integer)>clock_timestamp()then raise exception 'Provider retry cooldown still active'using errcode='PT409';end if;
  update clinical_note_attempts set state='superseded',finished_at=clock_timestamp()where id=old.id;
 elsif p_retry_of is not null or p_reason<>''or p_ack_cost then raise exception 'Initial attempt has no retry reference'using errcode='23514';end if;
 if(select count(*)from clinical_note_attempts where job_id=j.id)>=6 or(select count(*)from clinical_note_attempts where actor_id=actor and state in('claimed','sending')and lease_until>clock_timestamp())>=2 then raise exception 'Note attempt limit reached'using errcode='23514';end if;
 perform public.clinical_dictation_actor(actor);insert into clinical_note_attempts(id,job_id,actor_id,session_id,model,state,intent,lease_until)values(p_id,j.id,actor,public.next_visit_review_session(),p.soap_model,'claimed',intent,clock_timestamp()+interval'90 seconds')returning *into a;
 insert into clinical_note_events(job_id,attempt_id,actor_id,kind,details)values(j.id,a.id,actor,'claimed',intent);return to_jsonb(a)-array['session_id','result'];end $$;

create or replace function public.cancel_clinical_note_attempt(p_actor_id uuid,p_id uuid,p_job_id uuid,p_retry_of uuid default null,p_reason text default'',p_ack_cost boolean default false)returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_dictation_actor(p_actor_id);j clinical_note_jobs;a clinical_note_attempts;c clinical_note_attempt_cancellations;intent jsonb;begin
 if p_id is null or p_job_id is null or p_reason is null or public.clinical_note_text_length(p_reason)>1000 or p_ack_cost is null or current_setting('transaction_isolation')<>'read committed'then raise exception 'Exact note attempt required'using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-note-actor:'||actor::text,0));
 select *into j from clinical_note_jobs where id=p_job_id for update;if not found or j.actor_id<>actor then raise exception 'Owned note job required'using errcode='42501';end if;perform public.clinical_call_note_reject_legacy_job(j.id);
 perform public.clinical_dictation_actor(actor);
 intent:=jsonb_build_object('job_id',p_job_id,'retry_of',p_retry_of,'reason',p_reason,'ack_cost',p_ack_cost);
 select *into c from clinical_note_attempt_cancellations where id=p_id;
 if found then
  if c.actor_id<>actor or c.job_id<>j.id or c.intent is distinct from intent then raise exception 'Cancelled attempt UUID belongs to different work'using errcode='23505';end if;
  return jsonb_build_object('cancelled',true,'job',public.clinical_note_job_view(j.id));
 end if;
 select *into a from clinical_note_attempts where id=p_id for update;
 if found then
  if a.actor_id<>actor or a.job_id<>j.id or a.intent is distinct from intent then raise exception 'Note attempt UUID belongs to different work'using errcode='23505';end if;
  if a.state<>'claimed'then return jsonb_build_object('cancelled',false,'job',public.clinical_note_job_view(j.id));end if;
  update clinical_note_attempts set state='failed',error_code='operator_cancelled_before_dispatch',failure_details='{}',finished_at=clock_timestamp()where id=a.id;
 end if;
 perform public.clinical_dictation_actor(actor);
 insert into clinical_note_attempt_cancellations(id,job_id,actor_id,session_id,intent)values(p_id,j.id,actor,public.next_visit_review_session(),intent);
 insert into clinical_note_events(job_id,actor_id,kind,details)values(j.id,actor,'cancelled_before_dispatch',jsonb_build_object('attempt_id',p_id));
 return jsonb_build_object('cancelled',true,'job',public.clinical_note_job_view(j.id));
end $$;

create or replace function public.dispatch_clinical_note(p_id uuid)returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;a clinical_note_attempts;begin
 select *into j from clinical_note_jobs where id=(select job_id from clinical_note_attempts where id=p_id)for update;select *into a from clinical_note_attempts where id=p_id for update;if not found then raise exception 'Note attempt missing'using errcode='23514';end if;perform public.clinical_call_note_reject_legacy_job(j.id);if a.state<>'claimed'then return false;end if;
 perform public.clinical_audio_worker_actor(a.actor_id,a.session_id);perform public.clinical_note_guard(j);perform public.clinical_audio_worker_actor(a.actor_id,a.session_id);if a.lease_until<=clock_timestamp()then raise exception 'Note attempt lease expired'using errcode='PT409';end if;
 update clinical_note_attempts set state='sending'where id=a.id;insert into clinical_note_events(job_id,attempt_id,actor_id,kind,details)values(j.id,a.id,a.actor_id,'dispatched',jsonb_build_object('model',a.model));return true;end $$;

create or replace function public.fail_clinical_note(p_id uuid,p_uncertain boolean,p_code text,p_details jsonb default'{}')returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;a clinical_note_attempts;begin
 if jsonb_typeof(p_details)is distinct from'object'or exists(select 1 from jsonb_object_keys(p_details)k where k<>all(array['http_status','provider_code','request_id','retry_after_seconds']))then raise exception 'Sanitized provider diagnostics required'using errcode='23514';end if;
 if(p_details?'http_status'and(jsonb_typeof(p_details->'http_status')<>'number'or(p_details->>'http_status')::integer not between 100 and 599))or(p_details?'provider_code'and(jsonb_typeof(p_details->'provider_code')<>'string'or p_details->>'provider_code'!~'^[a-z0-9_]{1,80}$'))or(p_details?'request_id'and(jsonb_typeof(p_details->'request_id')<>'string'or public.clinical_note_text_length(p_details->>'request_id')>200))or(p_details?'retry_after_seconds'and(jsonb_typeof(p_details->'retry_after_seconds')<>'number'or(p_details->>'retry_after_seconds')::integer not between 0 and 86400))or p_uncertain is null or p_code is null or p_code!~'^[a-z_]{1,80}$'then raise exception 'Sanitized bounded processing outcome required'using errcode='23514';end if;
 select *into j from clinical_note_jobs where id=(select job_id from clinical_note_attempts where id=p_id)for update;select *into a from clinical_note_attempts where id=p_id for update;if not found then raise exception 'Note attempt missing'using errcode='23514';end if;perform public.clinical_call_note_reject_legacy_job(j.id);if a.state not in('claimed','sending')then return;end if;
 update clinical_note_attempts set state=case when p_uncertain then'uncertain'else'failed'end,error_code=p_code,failure_details=p_details,finished_at=clock_timestamp()where id=a.id;insert into clinical_note_events(job_id,attempt_id,actor_id,kind,details)values(j.id,a.id,a.actor_id,case when p_uncertain then'uncertain'else'failed'end,jsonb_build_object('code',p_code)||p_details);end $$;

create or replace function public.finish_clinical_note(p_id uuid,p_result jsonb)returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;a clinical_note_attempts;v clinical_note_template_versions;hash text;sections jsonb;lc jsonb;begin
 select *into j from clinical_note_jobs where id=(select job_id from clinical_note_attempts where id=p_id)for update;select *into a from clinical_note_attempts where id=p_id for update;if not found then raise exception 'Note attempt missing'using errcode='23514';end if;perform public.clinical_call_note_reject_legacy_job(j.id);
 hash:=encode(extensions.digest(convert_to(p_result::text,'UTF8'),'sha256'),'hex');if a.state='completed'then if a.result_hash is distinct from hash then raise exception 'Completed attempt has a different result'using errcode='23505';end if;return public.clinical_note_job_view(j.id);end if;
 perform public.clinical_audio_worker_actor(a.actor_id,a.session_id);perform public.clinical_note_guard(j);perform public.clinical_audio_worker_actor(a.actor_id,a.session_id);if a.state<>'sending'or a.lease_until<=clock_timestamp()or j.proposal_id is not null then raise exception 'Expired, complete or superseded result; source retained'using errcode='PT409';end if;
 perform public.native_rx_keys(p_result,array['request_id','response_id','provider_model','contract_version','prompt_version','source_sha256','template_sha256','language_context','payload']);
 if jsonb_typeof(p_result->'request_id')is distinct from'string'or public.clinical_note_text_length(p_result->>'request_id')>200 or jsonb_typeof(p_result->'response_id')is distinct from'string'or public.clinical_note_text_length(p_result->>'response_id')not between 1 and 200 or jsonb_typeof(p_result->'provider_model')is distinct from'string'or public.clinical_note_text_length(p_result->>'provider_model')>200 or p_result->>'contract_version'is distinct from'clinical-note-v1'or p_result->>'prompt_version'is distinct from'lrv-note-fields-v1'or p_result->>'source_sha256'is distinct from j.source_sha256 or p_result->>'template_sha256'is distinct from j.template_hash then raise exception 'Pinned bounded note provider manifest required'using errcode='23514';end if;
 lc:=p_result->'language_context';perform public.native_rx_keys(lc,array['version','bundle_sha256','request_sha256']);if jsonb_typeof(lc->'version')is distinct from'string'or lc->>'version'!~'^lrv-vet-en-v[1-9][0-9]{0,3}$'or jsonb_typeof(lc->'bundle_sha256')is distinct from'string'or lc->>'bundle_sha256'!~'^[a-f0-9]{64}$'or jsonb_typeof(lc->'request_sha256')is distinct from'string'or lc->>'request_sha256'!~'^[a-f0-9]{64}$'then raise exception 'Bounded veterinary context receipt required'using errcode='23514';end if;
 select *into v from clinical_note_template_versions where template_id=j.template_id and version=j.template_version;sections:=public.clinical_note_assemble(v.definition,j.source_text,p_result->'payload');
 insert into clinical_dictation_proposals(id,pet_id,encounter_id,expected_version,actor_id,actor_name,transcript,source_hash,source_note,attest_authorized,sections)values(a.id,j.pet_id,j.encounter_id,j.expected_version,a.actor_id,(select coalesce(nullif(left(btrim(full_name),200),''),'Staff member')from profiles where id=a.actor_id),j.source_text,j.source_sha256,case when j.source_kind='typed'then'OpenAI-generated template draft from authorized typed clinician observations. Source SHA256: 'else'OpenAI-generated template draft from authorized clinician audio transcript. Source SHA256: 'end||j.source_sha256,true,sections);
 insert into clinical_note_generations(proposal_id,job_id,attempt_id,template_snapshot,source_sha256,payload,manifest)values(a.id,j.id,a.id,jsonb_build_object('id',j.template_id,'version',j.template_version,'definition',v.definition,'sha256',v.sha256),j.source_sha256,p_result->'payload',p_result-'payload');
 update clinical_note_jobs set proposal_id=a.id where id=j.id;update clinical_note_attempts set state='completed',result=p_result,result_hash=hash,provider_request_id=p_result->>'request_id',finished_at=clock_timestamp()where id=a.id;
 insert into clinical_note_events(job_id,attempt_id,actor_id,kind,details)values(j.id,a.id,a.actor_id,'completed',jsonb_build_object('result_hash',hash));return public.clinical_note_job_view(j.id);
end $$;

create or replace function public.read_clinical_note_provenance(p_actor_id uuid,p_proposal_id uuid)returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin perform public.clinical_dictation_actor(p_actor_id);perform public.clinical_call_note_reject_legacy_proposal(p_proposal_id);return(select to_jsonb(g)||jsonb_build_object('source_kind',j.source_kind,'source_note',j.source_note,'audio_job_id',j.audio_job_id,'source_audio_policy_version',j.source_audio_policy_version,'policy_version',j.policy_version)from clinical_note_generations g join clinical_note_jobs j on j.id=g.job_id where g.proposal_id=p_proposal_id);end $$;

create or replace function public.read_clinical_dictation(p_actor_id uuid,p_pet_id uuid,p_encounter_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_dictation_actor(p_actor_id);items jsonb;begin
 perform 1 from clinical_encounters where id=p_encounter_id and pet_id=p_pet_id;
 if not found then raise exception 'Matching patient encounter required' using errcode='23514';end if;
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('review',(select to_jsonb(r)from clinical_dictation_reviews r where r.proposal_id=p.id)) order by p.created_at desc,p.id desc),'[]'::jsonb)
 into items from(select * from clinical_dictation_proposals where encounter_id=p_encounter_id and pet_id=p_pet_id and not public.clinical_call_note_private_proposal(id) order by created_at desc,id desc limit 20)p;
 return jsonb_build_object('actor_id',actor,'pet_id',p_pet_id,'encounter_id',p_encounter_id,'items',items,
 'has_more',(select count(*)>20 from clinical_dictation_proposals where encounter_id=p_encounter_id and pet_id=p_pet_id and not public.clinical_call_note_private_proposal(id)));
end $$;

create or replace function public.recover_clinical_dictation_action(p_actor_id uuid,p_id uuid,p_kind text,p_request jsonb) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_dictation_actor(p_actor_id);a clinical_dictation_actions;begin
 if p_id is null or p_kind is null or p_kind not in('submit','review') or jsonb_typeof(p_request) is distinct from 'object' then raise exception 'Exact dictation action required' using errcode='23514';end if;
 select * into a from clinical_dictation_actions where id=p_id;
 if not found then return null;end if;
 perform public.clinical_call_note_reject_legacy_action(a.id);
 if a.actor_id is distinct from actor then raise exception 'Dictation action belongs to another operator' using errcode='42501';end if;
 if a.kind is distinct from p_kind or a.request is distinct from p_request then raise exception 'Dictation UUID belongs to a different request' using errcode='23505';end if;
 return a.receipt;
end $$;

create or replace function public.save_clinical_dictation_action(p_actor_id uuid,p_id uuid,p_kind text,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_dictation_actor(p_actor_id);receipt jsonb;pet uuid;encounter uuid;proposal uuid;
 expected integer;e clinical_encounters;p clinical_dictation_proposals;selected jsonb;k text;v jsonb;decision text;review_note text;
begin
 if p_id is null or p_kind is null or p_kind not in('submit','review') then raise exception 'Dictation action UUID and kind required' using errcode='23514';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Dictation review requires READ COMMITTED' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-dictation:'||p_id::text,0));
 receipt:=public.recover_clinical_dictation_action(actor,p_id,p_kind,p_request);if receipt is not null then return receipt;end if;
 if p_kind='submit' then
 perform public.native_rx_keys(p_request,array['pet_id','encounter_id','expected_version','transcript','source_note','attest_authorized','sections']);
 else
 perform public.native_rx_keys(p_request,array['pet_id','encounter_id','expected_version','proposal_id','decision','accepted_sections','review_note','attest_reviewed']);
 end if;
 if jsonb_typeof(p_request->'pet_id') is distinct from 'string' or jsonb_typeof(p_request->'encounter_id') is distinct from 'string' then raise exception 'Patient and encounter identifiers required' using errcode='23514';end if;
 pet:=(p_request->>'pet_id')::uuid;encounter:=(p_request->>'encounter_id')::uuid;
 expected:=public.appointment_catalog_integer(p_request->'expected_version',1,2147483646);
 if p_kind='review'and public.clinical_call_note_private_proposal_text(p_request->>'proposal_id')then raise exception 'Private call review is unavailable in this workflow'using errcode='PT403';end if;
 -- The common destination lock serializes submit, accept and reject with existing save/sign operations.
 select * into e from clinical_encounters where id=encounter and pet_id=pet for update;
 if not found then raise exception 'Matching patient encounter required' using errcode='23514';end if;
 perform public.clinical_dictation_actor(actor);
 if p_kind='submit' then
  if e.status<>'draft' or e.version<>expected then raise exception 'Encounter changed or signed; reload before importing' using errcode='PT409';end if;
  if jsonb_typeof(p_request->'transcript') is distinct from 'string' or length(p_request->>'transcript') not between 1 and 60000 or p_request->>'transcript' !~ '[^[:space:]]'
  or jsonb_typeof(p_request->'source_note') is distinct from 'string' or length(p_request->>'source_note') not between 1 and 1000 or p_request->>'source_note' !~ '[^[:space:]]'
  or p_request->'attest_authorized' is distinct from 'true'::jsonb then raise exception 'Authorized, bounded transcript and source description required' using errcode='23514';end if;
  perform public.clinical_dictation_validate_sections(p_request->>'transcript',p_request->'sections');
  insert into clinical_dictation_proposals(id,pet_id,encounter_id,expected_version,actor_id,actor_name,transcript,source_hash,source_note,attest_authorized,sections)
  values(p_id,pet,encounter,expected,actor,(select coalesce(nullif(left(btrim(full_name),200),''),'Staff member') from profiles where id=actor),p_request->>'transcript',encode(extensions.digest(convert_to(p_request->>'transcript','UTF8'),'sha256'),'hex'),p_request->>'source_note',true,p_request->'sections');
  receipt:=jsonb_build_object('id',p_id,'actor_id',actor,'kind',p_kind,'proposal_id',p_id,'pet_id',pet,'encounter_id',encounter,'decision','submitted','encounter',null);
 else
  if jsonb_typeof(p_request->'proposal_id') is distinct from 'string' then raise exception 'Proposal identifier required' using errcode='23514';end if;
  proposal:=(p_request->>'proposal_id')::uuid;select * into p from clinical_dictation_proposals where id=proposal and encounter_id=encounter and pet_id=pet;
  if not found or p.expected_version<>expected then raise exception 'Matching source-bound proposal required' using errcode='23514';end if;
  perform public.clinical_call_note_reject_legacy_proposal(p.id);
  if exists(select 1 from clinical_dictation_reviews where proposal_id=proposal) then raise exception 'Proposal already reviewed; reload its history' using errcode='PT409';end if;
  decision:=p_request->>'decision';selected:=p_request->'accepted_sections';review_note:=p_request->>'review_note';
  if jsonb_typeof(p_request->'decision') is distinct from 'string' or decision not in('accepted','rejected') or jsonb_typeof(selected) is distinct from 'object'
  or jsonb_typeof(p_request->'review_note') is distinct from 'string' or length(review_note)>2000
  or p_request->'attest_reviewed' is distinct from 'true'::jsonb then raise exception 'Explicit review decision and attestation required' using errcode='23514';end if;
  if decision='accepted' then
   if e.status<>'draft' or e.version<>expected then raise exception 'Encounter changed or signed; original proposal retained' using errcode='PT409';end if;
   if selected='{}'::jsonb then raise exception 'Select at least one nonempty section' using errcode='23514';end if;
   for k,v in select * from jsonb_each(selected) loop
    if k not in('subjective','objective','assessment','plan') or jsonb_typeof(v) is distinct from 'string' or length(v#>>'{}') not between 1 and 50000
    or (v#>>'{}') !~ '[^[:space:]]' or coalesce(p.sections->k->>'text','')='' then raise exception 'Only proposed nonempty SOAP sections may be accepted' using errcode='23514';end if;
   end loop;
   e:=public.save_clinical_encounter(e.id,e.pet_id,e.version,e.visit_at,e.visit_type,e.location,
    coalesce(selected->>'subjective',e.subjective),coalesce(selected->>'objective',e.objective),coalesce(selected->>'assessment',e.assessment),coalesce(selected->>'plan',e.plan));
  elsif selected<>'{}'::jsonb or review_note !~ '[^[:space:]]' then raise exception 'Rejection requires a reason and no selected sections' using errcode='23514';end if;
  insert into clinical_dictation_reviews(id,proposal_id,actor_id,actor_name,decision,accepted_sections,review_note,attest_reviewed,encounter_version)
  values(p_id,proposal,actor,(select coalesce(nullif(left(btrim(full_name),200),''),'Staff member') from profiles where id=actor),decision,selected,review_note,true,case when decision='accepted' then e.version end);
  receipt:=jsonb_build_object('id',p_id,'actor_id',actor,'kind',p_kind,'proposal_id',proposal,'pet_id',pet,'encounter_id',encounter,'decision',decision,'encounter',case when decision='accepted' then to_jsonb(e)else null end);
 end if;
 insert into clinical_dictation_actions(id,actor_id,kind,request,receipt)values(p_id,actor,p_kind,p_request,receipt);
 return receipt;
end $$;

create or replace function public.read_clinical_audio_provenance(p_actor_id uuid,p_proposal_id uuid)returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.clinical_dictation_actor(p_actor_id);perform public.clinical_call_note_reject_legacy_proposal(p_proposal_id);
 return(select to_jsonb(g)||jsonb_build_object('audio_sha256',j.sha256,'source_note',j.source_note,
 'transcription_context',(select a.result->'language_context' from clinical_audio_attempts a where a.job_id=j.id and a.stage='transcribe' and a.state='completed'),
 'generation_context',(select a.result->'language_context' from clinical_audio_attempts a where a.id=g.attempt_id and a.state='completed'))from clinical_audio_generations g join clinical_audio_jobs j on j.id=g.job_id where g.proposal_id=p_proposal_id);
end $$;

-- CREATE OR REPLACE retains every existing signature, owner and ACL. New helpers have no API grant.
do $$declare f record;begin
 for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and(proname like 'clinical_call_note_%'or proname='read_clinical_call_note_job_v1')loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.oid::regprocedure);
  if f.proname='read_clinical_call_note_job_v1'then execute format('grant execute on function %s to authenticated',f.oid::regprocedure);end if;
 end loop;
end $$;
