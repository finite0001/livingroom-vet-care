-- Require unique-literal provider provenance for newly finished call-note attempts.
-- Canonical stored payload/excerpts, source bindings, policies, actor/session checks,
-- review gates and all existing grants remain unchanged. CREATE OR REPLACE retains
-- each function's owner/ACL; this migration grants no new authority.
-- The completed-attempt replay branch deliberately precedes the new v2 checks, so
-- immutable historical v1 results recover only with the exact original result hash.

create or replace function public.fail_clinical_call_note_v1(p_job_id uuid,p_attempt_id uuid,p_uncertain boolean,p_code text,p_details jsonb default '{}') returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;a clinical_note_attempts;begin
 if jsonb_typeof(p_details) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_details) k where k<>all(array['http_status','provider_code','request_id','retry_after_seconds','provider_response_sha256'])) then raise exception 'Sanitized diagnostics required' using errcode='PT422';end if;
 if (p_details?'http_status' and public.clinical_recap_integer(p_details->'http_status',100,599) is null)
 or(p_details?'provider_code' and(jsonb_typeof(p_details->'provider_code')<>'string' or p_details->>'provider_code'!~'^[a-z0-9_]{1,80}$'))
 or(p_details?'request_id' and(jsonb_typeof(p_details->'request_id')<>'string' or public.clinical_note_text_length(p_details->>'request_id')>200))
 or(p_details?'retry_after_seconds' and public.clinical_recap_integer(p_details->'retry_after_seconds',0,86400) is null)
 or(p_details?'provider_response_sha256' and(jsonb_typeof(p_details->'provider_response_sha256') is distinct from 'string' or p_details->>'provider_response_sha256'!~'^[a-f0-9]{64}$'))
 or p_uncertain is null or p_code is null or p_code!~'^[a-z_]{1,80}$' then raise exception 'Bounded sanitized outcome required' using errcode='PT422';end if;
 select * into j from clinical_note_jobs where id=p_job_id for update;select * into a from clinical_note_attempts where id=p_attempt_id for update;
 if a.id is null or j.id is null or a.job_id<>j.id or j.source_kind<>'call_transcript' then raise exception 'Exact call attempt required' using errcode='PT404';end if;
 -- Failure can still be recorded after operator revocation; no source or provider text is returned.
 if a.state not in('claimed','sending') then return;end if;
 update clinical_note_attempts set state=case when p_uncertain then 'uncertain' else 'failed' end,error_code=p_code,failure_details=p_details,finished_at=clock_timestamp() where id=a.id;
 insert into clinical_note_events(job_id,attempt_id,actor_id,kind,details) values(j.id,a.id,a.actor_id,case when p_uncertain then 'uncertain' else 'failed' end,jsonb_build_object('code',p_code)||p_details);
end $$;

create or replace function public.finish_clinical_call_note_v1(p_job_id uuid,p_attempt_id uuid,p_result jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;a clinical_note_attempts;b clinical_call_note_bindings;s clinical_call_sources;v clinical_note_template_versions;hash text;sections jsonb;vc jsonb;pe jsonb;field jsonb;claim jsonb;support jsonb;segment_text text;first_at integer;k text;owner_id uuid;begin
 select actor_id into owner_id from clinical_note_jobs where id=p_job_id;
 perform pg_advisory_xact_lock(hashtextextended('clinical-note-actor:'||owner_id,0));
 select * into j from clinical_note_jobs where id=p_job_id for update;select * into a from clinical_note_attempts where id=p_attempt_id for update;
 if j.id is null or a.id is null or a.job_id<>j.id or j.source_kind<>'call_transcript' then raise exception 'Exact call attempt required' using errcode='PT404';end if;
 hash:=public.clinical_recap_hash(p_result);perform public.clinical_call_worker_actor(a.actor_id,a.session_id);
 if a.state='completed' then
  if a.result_hash is distinct from hash then raise exception 'Completed attempt result conflict' using errcode='PT409';end if;
  perform public.clinical_call_note_history_v1(j);perform public.clinical_call_worker_actor(a.actor_id,a.session_id);return public.clinical_call_note_view_v1(j);
 end if;
 perform public.clinical_call_note_guard_v1(j);perform public.clinical_call_worker_actor(a.actor_id,a.session_id);
 if a.state<>'sending' or a.lease_until<=clock_timestamp() or j.proposal_id is not null or a.actor_id<>j.actor_id then raise exception 'Expired or superseded result; source retained' using errcode='PT409';end if;
 select * into b from clinical_call_note_bindings where job_id=j.id;select * into s from clinical_call_sources where id=b.call_source_id;
 perform public.clinical_recap_keys(p_result,array['request_id','contract_version','prompt_version','response_id','requested_model','provider_model','job_id','source_id','source_manifest_sha256','projection_sha256','source_capture_policy_version','call_generation_policy_version','note_policy_version','template_id','template_version','template_sha256','veterinary_context','provider_evidence','payload']);
 foreach k in array array['request_id','response_id','provider_model'] loop
  if jsonb_typeof(p_result->k) is distinct from 'string' or public.clinical_note_text_length(p_result->>k)>200 then raise exception 'Bounded provider identifiers required' using errcode='PT422';end if;
 end loop;
 if not public.clinical_note_nonblank(p_result->>'response_id') or p_result->>'contract_version' is distinct from 'clinical-call-note-result-v2' or p_result->>'prompt_version' is distinct from 'lrv-call-note-fields-v2'
 or p_result->>'requested_model' is distinct from a.model or p_result->'job_id' is distinct from to_jsonb(j.id) or p_result->'source_id' is distinct from to_jsonb(s.id)
 or p_result->>'source_manifest_sha256' is distinct from s.sha256 or p_result->>'projection_sha256' is distinct from j.source_sha256
 or p_result->'source_capture_policy_version' is distinct from to_jsonb(b.source_capture_policy_version)
 or p_result->'call_generation_policy_version' is distinct from to_jsonb(b.call_generation_policy_version) or p_result->'note_policy_version' is distinct from to_jsonb(j.policy_version)
 or p_result->'template_id' is distinct from to_jsonb(j.template_id) or p_result->'template_version' is distinct from to_jsonb(j.template_version) or p_result->>'template_sha256' is distinct from j.template_hash then raise exception 'Pinned call result manifest required' using errcode='PT422';end if;
 vc:=p_result->'veterinary_context';perform public.clinical_recap_keys(vc,array['version','bundle_sha256','request_sha256']);
 if jsonb_typeof(vc->'version') is distinct from 'string' or vc->>'version'!~'^lrv-vet-en-v[1-9][0-9]{0,3}$'
 or jsonb_typeof(vc->'bundle_sha256') is distinct from 'string' or vc->>'bundle_sha256'!~'^[a-f0-9]{64}$'
 or jsonb_typeof(vc->'request_sha256') is distinct from 'string' or vc->>'request_sha256'!~'^[a-f0-9]{64}$' then raise exception 'Veterinary context receipt required' using errcode='PT422';end if;
 -- Exact complete HTTP bytes and decoded assistant output text are hashed by the
 -- trusted worker, not reconstructed from JSON in SQL. No raw response is stored.
 pe:=p_result->'provider_evidence';
 perform public.clinical_recap_keys(pe,array['provider_contract_version','resolver_version','response_sha256','output_text_sha256']);
 if pe->>'provider_contract_version' is distinct from 'clinical-call-note-provider-payload-v2'
 or pe->>'resolver_version' is distinct from 'lrv-call-unique-literal-v1'
 or jsonb_typeof(pe->'response_sha256') is distinct from 'string' or pe->>'response_sha256'!~'^[a-f0-9]{64}$'
 or jsonb_typeof(pe->'output_text_sha256') is distinct from 'string' or pe->>'output_text_sha256'!~'^[a-f0-9]{64}$' then
  raise exception 'Versioned provider evidence receipt required' using errcode='PT422';
 end if;
 select * into v from clinical_note_template_versions where template_id=j.template_id and version=j.template_version;
 sections:=public.clinical_call_note_assemble_v1(v.definition,s.document,p_result->'payload');
 -- V2 provenance promises one exact occurrence within the stated segment. The
 -- canonical validator above still permits explicit historical repeated ranges;
 -- only new finishes impose this resolver invariant. Advancing one character
 -- beyond the first start also finds overlapping second occurrences.
 for field in select value from jsonb_array_elements(p_result#>'{payload,fields}') loop
  for claim in select value from jsonb_array_elements(field->'claims') loop
   for support in select value from jsonb_array_elements(claim->'supports') loop
    segment_text:=s.document->'segments'->((support->>'segment_ordinal')::integer-1)->>'text';
    first_at:=strpos(segment_text,support->>'quote');
    if first_at=0 or strpos(substr(segment_text,first_at+1),support->>'quote')>0 then
     raise exception 'New provider quote requires one exact segment-local occurrence' using errcode='PT422';
    end if;
   end loop;
  end loop;
 end loop;
 perform public.clinical_call_worker_actor(a.actor_id,a.session_id);
 insert into clinical_dictation_proposals(id,pet_id,encounter_id,expected_version,actor_id,actor_name,transcript,source_hash,source_note,attest_authorized,sections)
 values(a.id,j.pet_id,j.encounter_id,j.expected_version,a.actor_id,(select case when public.clinical_note_text_length(btrim(full_name)) between 1 and 200 then btrim(full_name) else 'Staff member' end from profiles where id=a.actor_id),j.source_text,j.source_sha256,'Private OpenAI call-derived proposal. Evidence and other-pet claims require separate clinical review.',true,sections);
 insert into clinical_note_generations(proposal_id,job_id,attempt_id,template_snapshot,source_sha256,payload,manifest) values(a.id,j.id,a.id,jsonb_build_object('id',j.template_id,'version',j.template_version,'definition',v.definition,'sha256',v.sha256),j.source_sha256,p_result->'payload',p_result-'payload');
 update clinical_note_jobs set proposal_id=a.id where id=j.id returning * into j;
 update clinical_note_attempts set state='completed',result=p_result,result_hash=hash,provider_request_id=p_result->>'request_id',finished_at=clock_timestamp() where id=a.id;
 insert into clinical_note_events(job_id,attempt_id,actor_id,kind,details) values(j.id,a.id,a.actor_id,'completed',jsonb_build_object('result_hash',hash));
 return public.clinical_call_note_view_v1(j);
end $$;
