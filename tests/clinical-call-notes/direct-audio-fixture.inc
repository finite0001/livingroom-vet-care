-- Owner-only fictional historical rows for the disposable Auth proof.
-- This temporary helper does not call a provider or approve processing policy.
create function pg_temp.ccn_direct_audio(f jsonb) returns jsonb language plpgsql as $$
declare
 j clinical_audio_jobs;
 transcribe_id uuid:=gen_random_uuid();
 generate_id uuid:=gen_random_uuid();
 payload jsonb;
 sections jsonb;
 transcript_result jsonb;
 generation_result jsonb;
 transcript_hash text;
begin
 select * into strict j from clinical_audio_jobs where id=(f->>'audio')::uuid;
 if j.actor_id is distinct from(f->>'actor')::uuid
  or j.session_id is distinct from(f->>'session')::uuid
  or j.pet_id is distinct from(f->>'pet')::uuid
  or j.encounter_id is distinct from(f->>'encounter')::uuid
  or j.transcript is null or j.proposal_id is not null then
  raise exception 'Unfinished owned fictional audio fixture required';
 end if;
 transcript_hash:=encode(extensions.digest(convert_to(j.transcript,'UTF8'),'sha256'),'hex');
 payload:=jsonb_build_object('subjective',jsonb_build_array(jsonb_build_object('text',j.transcript,'quote',j.transcript)),
  'objective','[]'::jsonb,'assessment','[]'::jsonb,'plan','[]'::jsonb,'review_flags','[]'::jsonb);
 sections:=jsonb_build_object('subjective',jsonb_build_object('text',j.transcript,'quote',j.transcript),
  'objective',jsonb_build_object('text','','quote',''),'assessment',jsonb_build_object('text','','quote',''),
  'plan',jsonb_build_object('text','','quote',''));
 transcript_result:=jsonb_build_object('request_id','synthetic-direct-audio-transcription-request',
  'response_id','synthetic-direct-audio-transcription-response','provider_model','synthetic-transcription-fixture',
  'contract_version','clinical-audio-v1','payload',jsonb_build_object('text',j.transcript),
  'language_context',jsonb_build_object('version','lrv-vet-en-v1','bundle_sha256',repeat('b',64),'request_sha256',repeat('c',64)));
 generation_result:=jsonb_build_object('request_id','synthetic-direct-audio-generation-request',
  'response_id','synthetic-direct-audio-generation-response','provider_model','synthetic-generation-fixture',
  'contract_version','clinical-audio-v1','payload',payload,
  'language_context',jsonb_build_object('version','lrv-vet-en-v1','bundle_sha256',repeat('b',64),'request_sha256',repeat('d',64)));
 insert into clinical_audio_attempts(id,job_id,actor_id,session_id,stage,model,state,intent,lease_until,result,result_hash,provider_request_id,finished_at)
 values(transcribe_id,j.id,j.actor_id,j.session_id,'transcribe','gpt-transcribe','completed',
  jsonb_build_object('job_id',j.id,'stage','transcribe','retry_of',null,'reason','','ack_cost',false),
  clock_timestamp()+interval'1 minute',transcript_result,
  encode(extensions.digest(convert_to(transcript_result::text,'UTF8'),'sha256'),'hex'),
  transcript_result->>'request_id',clock_timestamp());
 insert into clinical_audio_attempts(id,job_id,actor_id,session_id,stage,model,state,intent,lease_until,result,result_hash,provider_request_id,finished_at)
 values(generate_id,j.id,j.actor_id,j.session_id,'generate','gpt-6-luna','completed',
  jsonb_build_object('job_id',j.id,'stage','generate','retry_of',null,'reason','','ack_cost',false),
  clock_timestamp()+interval'1 minute',generation_result,
  encode(extensions.digest(convert_to(generation_result::text,'UTF8'),'sha256'),'hex'),
  generation_result->>'request_id',clock_timestamp());
 perform public.clinical_dictation_validate_sections(j.transcript,sections);
 insert into clinical_dictation_proposals(id,pet_id,encounter_id,expected_version,actor_id,actor_name,transcript,source_hash,source_note,attest_authorized,sections)
 values(generate_id,j.pet_id,j.encounter_id,j.expected_version,j.actor_id,'Synthetic operator',j.transcript,
  transcript_hash,'Owner-seeded synthetic direct audio proposal; no provider',true,sections);
 insert into clinical_audio_generations(proposal_id,job_id,attempt_id,payload,transcript_hash,transcription_model,soap_model,provider_response_id,provider_model,contract_version)
 values(generate_id,j.id,generate_id,payload,transcript_hash,'gpt-transcribe','gpt-6-luna',
  generation_result->>'response_id',generation_result->>'provider_model','clinical-audio-v1');
 update clinical_audio_jobs set proposal_id=generate_id,
  transcription_request_id=transcript_result->>'request_id' where id=j.id;
 insert into clinical_audio_events(job_id,attempt_id,actor_id,kind,details)
 select j.id,a.id,j.actor_id,'completed',jsonb_build_object('stage',a.stage,'result_hash',a.result_hash)
 from clinical_audio_attempts a where a.id in(transcribe_id,generate_id);
 return jsonb_build_object('job',j.id,'proposal',generate_id,'attempt',generate_id,
  'transcription_attempt',transcribe_id,'transcript_sha256',transcript_hash,'audio_sha256',j.sha256);
end $$;
