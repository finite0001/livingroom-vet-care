-- Audio is transient: no Storage bucket or server-side audio retention.
create table public.clinical_audio_policies(
 version integer primary key check(version>0),status text not null check(status in('draft','approved')),
 consent_text text not null check(length(consent_text) between 1 and 4000),
 audio_retention text not null check(audio_retention='not_stored'),
 transcript_retention text not null check(length(transcript_retention) between 1 and 2000),
 transcription_model text not null check(transcription_model='gpt-transcribe'),
 soap_model text not null check(soap_model='gpt-6-luna'),
 reviewed_by uuid references auth.users(id),reviewed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 check((status='draft' and reviewed_by is null and reviewed_at is null)or(status='approved' and reviewed_by is not null and reviewed_at is not null))
);
insert into public.clinical_audio_policies(version,status,consent_text,audio_retention,transcript_retention,transcription_model,soap_model)
values(1,'draft','Draft for Susan: confirm the selected patient and permission to record and process clinician dictation with OpenAI. Do not include another patient. OpenAI may retain transcript-processing data under its account policies; verify provider retention settings before approval. Recording and provider handling require practice approval.','not_stored','Draft for Susan: retain transcript, proposal and review history under the clinical-record policy. Local audio is lost on discard/page close unless explicitly downloaded; the app does not retain raw audio server-side.','gpt-transcribe','gpt-6-luna');
create table public.clinical_audio_jobs(
 id uuid primary key,actor_id uuid not null references auth.users(id),session_id uuid not null,
 pet_id uuid not null references public.pets(id),encounter_id uuid not null references public.clinical_encounters(id),
 expected_version integer not null check(expected_version>0),policy_version integer not null references public.clinical_audio_policies(version),
 sha256 text not null check(sha256~'^[a-f0-9]{64}$'),frames integer not null check(frames between 16000 and 9600000),
 byte_size integer not null check(byte_size between 32044 and 19200044 and byte_size=44+2*frames),
 source_note text not null check(length(source_note)between 1 and 1000),intent jsonb not null,
 transcript text check(length(transcript)between 1 and 60000),transcription_request_id text,
 proposal_id uuid unique references public.clinical_dictation_proposals(id),
 created_at timestamptz not null default clock_timestamp()
);
create index clinical_audio_jobs_encounter on public.clinical_audio_jobs(encounter_id,created_at desc,id desc);
create table public.clinical_audio_attempts(
 id uuid primary key,job_id uuid not null references public.clinical_audio_jobs(id),actor_id uuid not null references auth.users(id),session_id uuid not null,
 stage text not null check(stage in('transcribe','generate')),model text not null,
 state text not null check(state in('claimed','sending','completed','failed','uncertain','superseded')),
 intent jsonb not null,lease_until timestamptz not null,
 result jsonb,result_hash text,error_code text,failure_details jsonb,provider_request_id text,
 created_at timestamptz not null default clock_timestamp(),finished_at timestamptz
);
create index clinical_audio_attempts_job on public.clinical_audio_attempts(job_id,stage,created_at desc,id desc);
create table public.clinical_audio_events(
 id uuid primary key default gen_random_uuid(),job_id uuid not null references public.clinical_audio_jobs(id),
 attempt_id uuid references public.clinical_audio_attempts(id),actor_id uuid not null references auth.users(id),
 kind text not null,details jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create table public.clinical_audio_generations(
 proposal_id uuid primary key references public.clinical_dictation_proposals(id),
 job_id uuid not null unique references public.clinical_audio_jobs(id),attempt_id uuid not null unique references public.clinical_audio_attempts(id),
 payload jsonb not null,transcript_hash text not null,transcription_model text not null,soap_model text not null,
 provider_response_id text not null,provider_model text not null,contract_version text not null check(contract_version='clinical-audio-v1'),created_at timestamptz not null default clock_timestamp()
);
create function public.clinical_audio_row_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if TG_OP in('DELETE','TRUNCATE') then raise exception 'Clinical audio history cannot be removed' using errcode='23514';end if;
 if TG_TABLE_NAME='clinical_audio_jobs' then
  if (to_jsonb(new)-array['transcript','transcription_request_id','proposal_id']) is distinct from(to_jsonb(old)-array['transcript','transcription_request_id','proposal_id'])
   or (old.transcript is not null and new.transcript is distinct from old.transcript)or(old.proposal_id is not null and new.proposal_id is distinct from old.proposal_id)then raise exception 'Audio source identity is immutable' using errcode='23514';end if;
 else
  if (to_jsonb(new)-array['state','lease_until','result','result_hash','error_code','failure_details','provider_request_id','finished_at'])is distinct from(to_jsonb(old)-array['state','lease_until','result','result_hash','error_code','failure_details','provider_request_id','finished_at'])then raise exception 'Audio attempt identity is immutable' using errcode='23514';end if;
 end if;
 return new;
end $$;
do $$declare t text;begin
 foreach t in array array['clinical_audio_policies','clinical_audio_jobs','clinical_audio_attempts','clinical_audio_events','clinical_audio_generations']loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 if t in('clinical_audio_jobs','clinical_audio_attempts')then
 execute format('create trigger audio_row_guard before update or delete on public.%I for each row execute function public.clinical_audio_row_guard()',t);
 execute format('create trigger audio_no_truncate before truncate on public.%I for each statement execute function public.clinical_audio_row_guard()',t);
 else
 execute format('create trigger audio_immutable before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);
 execute format('create trigger audio_no_truncate before truncate on public.%I for each statement execute function public.native_correction_immutable()',t);
 end if;
 end loop;
end $$;
create function public.clinical_audio_current_policy() returns public.clinical_audio_policies language sql stable security definer set search_path=public,pg_temp as $$select *from clinical_audio_policies order by version desc limit 1$$;
create function public.clinical_audio_policy_guard(p_version integer) returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
declare p clinical_audio_policies:=public.clinical_audio_current_policy();begin
 if p.status is distinct from 'approved' or p.version is distinct from p_version then raise exception 'Recording policy awaits practice approval or has changed' using errcode='42501';end if;
end $$;
create function public.clinical_audio_worker_actor(p_actor uuid,p_session uuid)returns void language plpgsql stable security definer set search_path=public,pg_temp as $$begin
 if not public.is_active_staff(p_actor) or not exists(select 1 from auth.sessions where id=p_session and user_id=p_actor and(not_after is null or not_after>clock_timestamp()))
 or not exists(select 1 from auth.users where id=p_actor and(banned_until is null or banned_until<=clock_timestamp()))then raise exception 'Original current staff session required' using errcode='42501';end if;
end $$;
create function public.clinical_audio_job_view(p_id uuid)returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select (to_jsonb(j)-array['session_id','intent'])||jsonb_build_object('attempts',coalesce((select jsonb_agg(to_jsonb(a)-array['session_id','result']order by a.created_at desc,a.id desc)from(select *from clinical_audio_attempts where job_id=j.id order by created_at desc,id desc limit 20)a),'[]'::jsonb))from clinical_audio_jobs j where j.id=p_id
$$;
create function public.read_clinical_audio(p_actor_id uuid,p_pet_id uuid,p_encounter_id uuid)returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_dictation_actor(p_actor_id);begin
 if not exists(select 1 from clinical_encounters where id=p_encounter_id and pet_id=p_pet_id)then raise exception 'Matching encounter required' using errcode='23514';end if;
 return jsonb_build_object('actor_id',actor,'pet_id',p_pet_id,'encounter_id',p_encounter_id,'policy',to_jsonb(public.clinical_audio_current_policy()),'jobs',coalesce((select jsonb_agg(public.clinical_audio_job_view(j.id)order by j.created_at desc,j.id desc)from(select id,created_at from clinical_audio_jobs where pet_id=p_pet_id and encounter_id=p_encounter_id order by created_at desc,id desc limit 10)j),'[]'::jsonb));
end $$;
create function public.read_clinical_audio_job(p_actor_id uuid,p_id uuid)returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.clinical_dictation_actor(p_actor_id);
 if not exists(select 1 from clinical_audio_jobs where id=p_id)then raise exception 'Audio job missing'using errcode='23514';end if;
 return jsonb_build_object('job',public.clinical_audio_job_view(p_id),'policy',to_jsonb(public.clinical_audio_current_policy()));
end $$;
create function public.read_clinical_audio_provenance(p_actor_id uuid,p_proposal_id uuid)returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.clinical_dictation_actor(p_actor_id);
 return(select to_jsonb(g)||jsonb_build_object('audio_sha256',j.sha256,'source_note',j.source_note)from clinical_audio_generations g join clinical_audio_jobs j on j.id=g.job_id where g.proposal_id=p_proposal_id);
end $$;
create function public.reserve_clinical_audio(p_actor_id uuid,p_id uuid,p_request jsonb)returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_dictation_actor(p_actor_id);j clinical_audio_jobs;e clinical_encounters;p clinical_audio_policies:=public.clinical_audio_current_policy();frames integer;bytes integer;expected integer;pet uuid;encounter uuid;begin
 if p_id is null or current_setting('transaction_isolation')<>'read committed'then raise exception 'Audio UUID and READ COMMITTED required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-audio-actor:'||actor::text,0));
 perform pg_advisory_xact_lock(hashtextextended('clinical-audio:'||p_id::text,0));
 select *into j from clinical_audio_jobs where id=p_id;
 if found then
  if j.actor_id is distinct from actor then raise exception 'Audio request belongs to another operator'using errcode='42501';end if;
  if j.intent is distinct from p_request then raise exception 'Audio UUID belongs to different source'using errcode='23505';end if;
  return public.clinical_audio_job_view(j.id);
 end if;
 perform public.native_rx_keys(p_request,array['pet_id','encounter_id','expected_version','policy_version','sha256','frames','byte_size','source_note','attest_authorized']);
 if jsonb_typeof(p_request->'pet_id')is distinct from 'string'or jsonb_typeof(p_request->'encounter_id')is distinct from 'string'then raise exception 'Patient encounter identifiers required'using errcode='23514';end if;
 pet:=(p_request->>'pet_id')::uuid;encounter:=(p_request->>'encounter_id')::uuid;
 expected:=public.appointment_catalog_integer(p_request->'expected_version',1,2147483646);
 perform public.clinical_audio_policy_guard(public.appointment_catalog_integer(p_request->'policy_version',1,2147483646));p:=public.clinical_audio_current_policy();if p.version<>(p_request->>'policy_version')::integer then raise exception 'Recording policy changed'using errcode='PT409';end if;
 frames:=public.appointment_catalog_integer(p_request->'frames',16000,9600000);bytes:=public.appointment_catalog_integer(p_request->'byte_size',32044,19200044);
 if bytes<>44+2*frames or jsonb_typeof(p_request->'sha256')is distinct from 'string'or p_request->>'sha256'!~'^[a-f0-9]{64}$'
 or jsonb_typeof(p_request->'source_note')is distinct from 'string'or length(p_request->>'source_note')not between 1 and 1000 or p_request->>'source_note'!~'[^[:space:]]'
 or p_request->'attest_authorized'is distinct from 'true'::jsonb then raise exception 'Exact authorized bounded audio source required'using errcode='23514';end if;
 select *into e from clinical_encounters where id=encounter and pet_id=pet for update;
 if not found or e.status<>'draft'or e.version<>expected or not exists(select 1 from pets where id=pet and archived_at is null and deceased_at is null)then raise exception 'Current active patient and unsigned encounter required'using errcode='PT409';end if;
 perform public.clinical_dictation_actor(actor);
 if(select count(*)from clinical_audio_jobs where actor_id=actor and created_at>clock_timestamp()-interval '1 hour')>=12 or(select count(*)from clinical_audio_jobs where actor_id=actor and created_at>clock_timestamp()-interval '1 day')>=100 then raise exception 'Draft audio processing limit reached'using errcode='23514';end if;
 insert into clinical_audio_jobs(id,actor_id,session_id,pet_id,encounter_id,expected_version,policy_version,sha256,frames,byte_size,source_note,intent)
 values(p_id,actor,public.next_visit_review_session(),pet,encounter,expected,p.version,p_request->>'sha256',frames,bytes,p_request->>'source_note',p_request);
 insert into clinical_audio_events(job_id,actor_id,kind,details)values(p_id,actor,'reserved',jsonb_build_object('sha256',p_request->>'sha256','policy_version',p.version));
 return public.clinical_audio_job_view(p_id);
end $$;
create function public.claim_clinical_audio(p_actor_id uuid,p_id uuid,p_job_id uuid,p_stage text,p_retry_of uuid default null,p_reason text default '',p_ack_cost boolean default false)returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_dictation_actor(p_actor_id);j clinical_audio_jobs;a clinical_audio_attempts;old clinical_audio_attempts;intent jsonb;policy clinical_audio_policies;begin
 if p_id is null or p_job_id is null or p_stage is null or p_stage not in('transcribe','generate')or p_reason is null or length(p_reason)>1000 or p_ack_cost is null or current_setting('transaction_isolation')<>'read committed'then raise exception 'Exact audio attempt required'using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-audio-actor:'||actor::text,0));
 select *into j from clinical_audio_jobs where id=p_job_id for update;
 if not found or j.actor_id<>actor then raise exception 'Owned audio job required'using errcode='42501';end if;
 intent:=jsonb_build_object('job_id',p_job_id,'stage',p_stage,'retry_of',p_retry_of,'reason',p_reason,'ack_cost',p_ack_cost);
 select *into a from clinical_audio_attempts where id=p_id;
 if found then
  if a.actor_id<>actor or a.intent is distinct from intent then raise exception 'Attempt UUID belongs to different work'using errcode='23505';end if;
  return to_jsonb(a)-array['session_id','result'];
 end if;
 perform public.clinical_audio_policy_guard(j.policy_version);policy:=public.clinical_audio_current_policy();
 if not exists(select 1 from clinical_encounters e join pets p on p.id=e.pet_id where e.id=j.encounter_id and e.pet_id=j.pet_id and e.status='draft'and e.version=j.expected_version and p.archived_at is null and p.deceased_at is null)then raise exception 'Encounter changed or signed; source retained'using errcode='PT409';end if;
 if(p_stage='transcribe'and j.transcript is not null)or(p_stage='generate'and(j.transcript is null or j.proposal_id is not null))then raise exception 'Audio stage already complete or prerequisite missing'using errcode='PT409';end if;
 select *into old from clinical_audio_attempts where job_id=j.id and stage=p_stage order by created_at desc,id desc limit 1;
 if found then
  if p_retry_of is distinct from old.id or p_reason!~'[^[:space:]]'or not p_ack_cost then raise exception 'Explicit retry, reason and possible-charge acknowledgement required'using errcode='23514';end if;
  if old.state='completed'or(old.state in('claimed','sending')and old.lease_until>clock_timestamp())then raise exception 'Original attempt is complete or still running; recover it'using errcode='PT409';end if;
  if old.finished_at is not null and old.failure_details?'retry_after_seconds'and old.finished_at+make_interval(secs=>(old.failure_details->>'retry_after_seconds')::integer)>clock_timestamp()then raise exception 'Provider retry cooldown is still active'using errcode='PT409';end if;
  update clinical_audio_attempts set state='superseded',finished_at=clock_timestamp()where id=old.id;
 else
  if p_retry_of is not null or p_reason<>''or p_ack_cost then raise exception 'Initial attempt has no retry reference'using errcode='23514';end if;
 end if;
 if(select count(*)from clinical_audio_attempts where job_id=j.id and stage=p_stage)>=6 or(select count(*)from clinical_audio_attempts where actor_id=actor and state in('claimed','sending')and lease_until>clock_timestamp())>=2 then raise exception 'Audio attempt limit reached'using errcode='23514';end if;
 perform public.clinical_dictation_actor(actor);
 insert into clinical_audio_attempts(id,job_id,actor_id,session_id,stage,model,state,intent,lease_until)
 values(p_id,j.id,actor,public.next_visit_review_session(),p_stage,case when p_stage='transcribe'then policy.transcription_model else policy.soap_model end,'claimed',intent,clock_timestamp()+case when p_stage='transcribe'then interval '120 seconds'else interval '90 seconds'end)returning *into a;
 insert into clinical_audio_events(job_id,attempt_id,actor_id,kind,details)values(j.id,a.id,actor,'claimed',intent);
 return to_jsonb(a)-array['session_id','result'];
end $$;
create function public.dispatch_clinical_audio(p_id uuid)returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_audio_jobs;a clinical_audio_attempts;begin
 select *into j from clinical_audio_jobs where id=(select job_id from clinical_audio_attempts where id=p_id)for update;
 select *into a from clinical_audio_attempts where id=p_id for update;
 if not found then raise exception 'Audio attempt missing'using errcode='23514';end if;
 if a.state<>'claimed'then return false;end if;
 perform public.clinical_audio_worker_actor(a.actor_id,a.session_id);perform public.clinical_audio_policy_guard(j.policy_version);
 if not exists(select 1 from clinical_encounters e join pets p on p.id=e.pet_id where e.id=j.encounter_id and e.pet_id=j.pet_id and e.status='draft'and e.version=j.expected_version and p.archived_at is null and p.deceased_at is null)then raise exception 'Destination changed before provider dispatch'using errcode='PT409';end if;
 if a.lease_until<=clock_timestamp()then raise exception 'Audio attempt lease expired'using errcode='PT409';end if;
 update clinical_audio_attempts set state='sending'where id=a.id;
 insert into clinical_audio_events(job_id,attempt_id,actor_id,kind,details)values(j.id,a.id,a.actor_id,'dispatched',jsonb_build_object('model',a.model));
 return true;
end $$;
create function public.fail_clinical_audio(p_id uuid,p_uncertain boolean,p_code text,p_details jsonb default '{}')returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_audio_jobs;a clinical_audio_attempts;begin
 if jsonb_typeof(p_details)is distinct from 'object'then raise exception 'Sanitized provider diagnostic object required'using errcode='23514';end if;
 if exists(select 1 from jsonb_object_keys(p_details)k where k<>all(array['http_status','provider_code','request_id','retry_after_seconds']))then raise exception 'Unexpected provider diagnostic field'using errcode='23514';end if;
 if(p_details?'http_status'and(jsonb_typeof(p_details->'http_status')<>'number'or(p_details->>'http_status')::integer not between 100 and 599))or(p_details?'provider_code'and(jsonb_typeof(p_details->'provider_code')<>'string'or p_details->>'provider_code'!~'^[a-z0-9_]{1,80}$'))or(p_details?'request_id'and(jsonb_typeof(p_details->'request_id')<>'string'or length(p_details->>'request_id')>200))or(p_details?'retry_after_seconds'and(jsonb_typeof(p_details->'retry_after_seconds')<>'number'or(p_details->>'retry_after_seconds')::integer not between 0 and 86400))then raise exception 'Sanitized bounded provider diagnostics required'using errcode='23514';end if;
 if p_uncertain is null or p_code is null or p_code!~'^[a-z_]{1,80}$'then raise exception 'Sanitized processing outcome required'using errcode='23514';end if;
 select *into j from clinical_audio_jobs where id=(select job_id from clinical_audio_attempts where id=p_id)for update;
 select *into a from clinical_audio_attempts where id=p_id for update;
 if not found then raise exception 'Audio attempt missing'using errcode='23514';end if;
 if a.state not in('claimed','sending')then return;end if;
 update clinical_audio_attempts set state=case when p_uncertain then 'uncertain'else 'failed'end,error_code=p_code,failure_details=p_details,finished_at=clock_timestamp()where id=a.id;
 insert into clinical_audio_events(job_id,attempt_id,actor_id,kind,details)values(j.id,a.id,a.actor_id,case when p_uncertain then 'uncertain'else 'failed'end,jsonb_build_object('code',p_code)||p_details);
end $$;
create function public.finish_clinical_audio(p_id uuid,p_result jsonb)returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_audio_jobs;a clinical_audio_attempts;policy clinical_audio_policies;hash text;k text;c jsonb;claims jsonb;sections jsonb:='{}';wording text;quote text;total integer:=0;payload jsonb;begin
 select *into j from clinical_audio_jobs where id=(select job_id from clinical_audio_attempts where id=p_id)for update;
 select *into a from clinical_audio_attempts where id=p_id for update;
 if not found then raise exception 'Audio attempt missing'using errcode='23514';end if;
 hash:=encode(extensions.digest(convert_to(p_result::text,'UTF8'),'sha256'),'hex');
 if a.state='completed'then
  if a.result_hash is distinct from hash then raise exception 'Completed attempt has a different result'using errcode='23505';end if;
  return public.clinical_audio_job_view(j.id);
 end if;
 perform public.clinical_audio_worker_actor(a.actor_id,a.session_id);perform public.clinical_audio_policy_guard(j.policy_version);
 if a.state<>'sending'or a.lease_until<=clock_timestamp()then raise exception 'Expired or superseded provider result; original source retained'using errcode='PT409';end if;
 policy:=public.clinical_audio_current_policy();
 perform public.native_rx_keys(p_result,array['request_id','response_id','provider_model','contract_version','payload']);
 if jsonb_typeof(p_result->'request_id')is distinct from 'string'or length(p_result->>'request_id')>200 or jsonb_typeof(p_result->'response_id')is distinct from 'string'or length(p_result->>'response_id')>200 then raise exception 'Bounded provider attribution required'using errcode='23514';end if;
 if p_result->>'contract_version'is distinct from 'clinical-audio-v1'or jsonb_typeof(p_result->'provider_model')is distinct from 'string'or length(p_result->>'provider_model')>200 then raise exception 'Pinned audio provider contract required'using errcode='23514';end if;
 payload:=p_result->'payload';
 if a.stage='transcribe'then
  perform public.native_rx_keys(payload,array['text']);
  if j.transcript is not null or jsonb_typeof(payload->'text')is distinct from 'string'or length(payload->>'text')not between 1 and 60000 or payload->>'text'!~'[^[:space:]]'then raise exception 'Nonempty bounded transcript required'using errcode='23514';end if;
  update clinical_audio_jobs set transcript=payload->>'text',transcription_request_id=p_result->>'request_id'where id=j.id;
 else
  if j.transcript is null or j.proposal_id is not null then raise exception 'One generation per transcript required'using errcode='PT409';end if;
  perform public.native_rx_keys(payload,array['subjective','objective','assessment','plan','review_flags']);
  foreach k in array array['subjective','objective','assessment','plan']loop
   claims:=payload->k;
   if jsonb_typeof(claims)is distinct from 'array'or jsonb_array_length(claims)>24 then raise exception 'Bounded clinical claims required'using errcode='23514';end if;
   wording:='';quote:='';
   for c in select value from jsonb_array_elements(claims)loop
    perform public.native_rx_keys(c,array['text','quote']);
    if jsonb_typeof(c->'text')is distinct from 'string'or length(c->>'text')not between 1 and 500 or c->>'text'!~'[^[:space:]]'
     or jsonb_typeof(c->'quote')is distinct from 'string'or length(c->>'quote')not between 1 and 1000 or c->>'quote'!~'[^[:space:]]'or strpos(j.transcript,c->>'quote')=0 then raise exception 'Every clinical claim requires a literal transcript excerpt'using errcode='23514';end if;
    if wording<>''then wording:=wording||E'\n';end if;wording:=wording||(c->>'text');if quote=''then quote:=c->>'quote';end if;total:=total+1;
   end loop;
   sections:=sections||jsonb_build_object(k,jsonb_build_object('text',wording,'quote',quote));
  end loop;
  if total=0 or jsonb_typeof(payload->'review_flags')is distinct from 'array'or jsonb_array_length(payload->'review_flags')>10 then raise exception 'Usable claims and bounded review flags required'using errcode='23514';end if;
  for c in select value from jsonb_array_elements(payload->'review_flags')loop
   if jsonb_typeof(c)is distinct from 'string'or length(c#>>'{}')not between 1 and 500 then raise exception 'Bounded review flag required'using errcode='23514';end if;
  end loop;
  perform public.clinical_dictation_validate_sections(j.transcript,sections);
  insert into clinical_dictation_proposals(id,pet_id,encounter_id,expected_version,actor_id,actor_name,transcript,source_hash,source_note,attest_authorized,sections)
  values(a.id,j.pet_id,j.encounter_id,j.expected_version,a.actor_id,(select coalesce(nullif(left(btrim(full_name),200),''),'Staff member')from profiles where id=a.actor_id),j.transcript,encode(extensions.digest(convert_to(j.transcript,'UTF8'),'sha256'),'hex'),'OpenAI-generated SOAP from authorized clinician dictation. Audio SHA256: '||j.sha256,true,sections);
  insert into clinical_audio_generations(proposal_id,job_id,attempt_id,payload,transcript_hash,transcription_model,soap_model,provider_response_id,provider_model,contract_version)
  values(a.id,j.id,a.id,payload,encode(extensions.digest(convert_to(j.transcript,'UTF8'),'sha256'),'hex'),policy.transcription_model,a.model,p_result->>'response_id',p_result->>'provider_model','clinical-audio-v1');
  update clinical_audio_jobs set proposal_id=a.id where id=j.id;
 end if;
 update clinical_audio_attempts set state='completed',result=p_result,result_hash=hash,provider_request_id=p_result->>'request_id',finished_at=clock_timestamp()where id=a.id;
 insert into clinical_audio_events(job_id,attempt_id,actor_id,kind,details)values(j.id,a.id,a.actor_id,'completed',jsonb_build_object('stage',a.stage,'result_hash',hash));
 return public.clinical_audio_job_view(j.id);
end $$;
do $$declare f record;begin
 for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in('clinical_audio_row_guard','clinical_audio_current_policy','clinical_audio_policy_guard','clinical_audio_worker_actor','clinical_audio_job_view','read_clinical_audio','read_clinical_audio_job','read_clinical_audio_provenance','reserve_clinical_audio','claim_clinical_audio','dispatch_clinical_audio','fail_clinical_audio','finish_clinical_audio')loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.oid::regprocedure);
 if f.proname in('read_clinical_audio','read_clinical_audio_job','read_clinical_audio_provenance','reserve_clinical_audio','claim_clinical_audio')then execute format('grant execute on function %s to authenticated',f.oid::regprocedure);end if;
 if f.proname in('dispatch_clinical_audio','fail_clinical_audio','finish_clinical_audio')then execute format('grant execute on function %s to service_role',f.oid::regprocedure);end if;
 end loop;
end $$;
