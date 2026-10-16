-- Additive vocabulary provenance; no clinical-policy or activation changes.
create or replace function public.finish_clinical_audio(p_id uuid,p_result jsonb)returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
 -- Context is optional only for pre-vocabulary workers/results during rolling deployment.
 -- New workers always attach it; historical results are never relabeled.
 perform public.native_rx_keys(p_result - 'language_context',array['request_id','response_id','provider_model','contract_version','payload']);
 if p_result ? 'language_context' then
  perform public.native_rx_keys(p_result->'language_context',array['version','bundle_sha256','request_sha256']);
  if jsonb_typeof(p_result#>'{language_context,version}') is distinct from 'string'
    or p_result#>>'{language_context,version}' !~ '^lrv-vet-en-v[1-9][0-9]{0,3}$'
    or jsonb_typeof(p_result#>'{language_context,bundle_sha256}') is distinct from 'string'
    or p_result#>>'{language_context,bundle_sha256}' !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_result#>'{language_context,request_sha256}') is distinct from 'string'
    or p_result#>>'{language_context,request_sha256}' !~ '^[a-f0-9]{64}$'
  then raise exception 'Bounded veterinary context receipt required' using errcode='23514';end if;
 end if;
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
create or replace function public.read_clinical_audio_provenance(p_actor_id uuid,p_proposal_id uuid)returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.clinical_dictation_actor(p_actor_id);
 return(select to_jsonb(g)||jsonb_build_object('audio_sha256',j.sha256,'source_note',j.source_note,
 'transcription_context',(select a.result->'language_context' from clinical_audio_attempts a where a.job_id=j.id and a.stage='transcribe' and a.state='completed'),
 'generation_context',(select a.result->'language_context' from clinical_audio_attempts a where a.id=g.attempt_id and a.state='completed'))from clinical_audio_generations g join clinical_audio_jobs j on j.id=g.job_id where g.proposal_id=p_proposal_id);
end $$;

revoke all on function public.finish_clinical_audio(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.finish_clinical_audio(uuid,jsonb) to service_role;
revoke all on function public.read_clinical_audio_provenance(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_clinical_audio_provenance(uuid,uuid) to authenticated;
