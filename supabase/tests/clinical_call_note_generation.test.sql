begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- BEGIN GUARDED CALL GENERATION FIXTURES
-- Synthetic owner-only fixtures for SQL, actual Auth and restore. No provider request.
-- Owner-only fictional persistence fixtures. No reservation, provider or chart-write RPC.
create function pg_temp.cgn_base(p_actor uuid,p_session uuid)returns jsonb language plpgsql as $$
declare c uuid:=gen_random_uuid();p uuid:=gen_random_uuid();e uuid:=gen_random_uuid();a uuid:=gen_random_uuid();phone text;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role','authenticated','session_id',p_session)::text,true);
 select '+1303555'||n into phone from generate_series(1000,9999)n where not exists(select 1 from clients where communication_recipient('SMS',primary_phone)='+1303555'||n)order by n limit 1;
 if phone is null then raise exception 'No unused synthetic call-note fixture phone';end if;
 insert into clients(id,first_name,last_name,full_name,primary_phone,primary_email)values(c,'Synthetic','Call Notes','Synthetic Call Notes',phone,'synthetic-call-notes@example.test');
 insert into pets(id,client_id,name,species)values(p,c,'Synthetic Call Notes Patient','Dog');
 insert into clinical_encounters(id,pet_id,visit_at,visit_type,subjective,objective,assessment,plan,created_by,updated_by)values(e,p,now(),'clinic','Original fictional S','Original fictional O','Original fictional A','Original fictional P',p_actor,p_actor);
 insert into clinical_audio_jobs(id,actor_id,session_id,pet_id,encounter_id,expected_version,policy_version,sha256,frames,byte_size,source_note,intent,transcript)values(a,p_actor,p_session,p,e,1,1,repeat('a',64),16000,32044,'Synthetic old clinician audio','{}','Synthetic historical audio observation.');
 return jsonb_build_object('actor',p_actor,'session',p_session,'client',c,'pet',p,'encounter',e,'audio',a);
end $$;
create function pg_temp.cgn_source(f jsonb,p_capture_policy integer default 2)returns uuid language plpgsql as $$
declare id uuid:=gen_random_uuid();call_uuid text:='synthetic-call-note-'||id;ci communication_inbound;doc jsonb;context jsonb;projection text:=E'[#0001 caller="owner"]\n🐾 Owner reports historical vomiting; vaccine declined. Other dog coughed.\n';normalized text;pages jsonb;ended timestamptz:='2026-10-01T09:59:00Z';
begin
 insert into cloudtalk_calls(call_uuid,call_id,direction,external_number,internal_number,started_at,ended_at,duration_seconds,talking_seconds,trusted_number,transcript_ready,last_event_at)values(call_uuid,'700099','inbound',(select primary_phone from clients where clients.id=(f->>'client')::uuid),'+13035550000',ended-interval'1 minute',ended,60,60,true,true,ended);
 select *into ci from communication_inbound where provider='cloudtalk'and resource_id='call:'||call_uuid;
 context:=jsonb_build_object('client_id',f->'client','conversation_id',ci.conversation_id,'message_id',ci.message_id,'call_uuid',call_uuid,'call_id','700099','call_started_at',public.clinical_recap_timestamp(ended-interval'1 minute'),'call_ended_at',public.clinical_recap_timestamp(ended),'call_last_event_at',public.clinical_recap_timestamp(ended),'inbound_version',ci.version);
 normalized:=jsonb_build_object('data',jsonb_build_object('callId',700099,'language','en','callers','[{"type":"contact","id":null,"localIdentifier":"owner"}]'::jsonb,'segments','[{"start":0,"end":2,"caller":"owner","text":"🐾 Owner reports historical vomiting; vaccine declined. Other dog coughed."}]'::jsonb),'pagination',jsonb_build_object('limit',100,'offset',0,'total',1))::text;
 select jsonb_agg(jsonb_build_object('pass',pass,'offset',0,'limit',100,'total',1,'count',1,'normalized_json',normalized,'sha256',encode(extensions.digest(convert_to(normalized,'UTF8'),'sha256'),'hex'),'retrieved_at','2026-10-01T10:00:00Z'))into pages from generate_series(1,2)pass;
 doc:=jsonb_build_object('contract_version','clinical-call-source-v1','provider_schema_version','cloudtalk-ci-transcription-v1','completeness','observed_two_pass','call_id','700099','language','en','callers','[{"type":"contact","id":null,"localIdentifier":"owner"}]'::jsonb,'segments',jsonb_build_array(jsonb_build_object('ordinal',1,'start',0,'end',2,'caller','owner','text','🐾 Owner reports historical vomiting; vaccine declined. Other dog coughed.','text_sha256',encode(extensions.digest(convert_to('🐾 Owner reports historical vomiting; vaccine declined. Other dog coughed.','UTF8'),'sha256'),'hex'),'projection_from',0,'projection_to',public.clinical_note_text_length(projection))),'projection',projection,'captured_from','2026-10-01T10:00:00Z','captured_until','2026-10-01T10:00:01Z','pages',pages);
 perform public.clinical_call_validate_document(doc,'700099');
 insert into clinical_call_capture_actions(id,actor_id,session_id,request,binding,state,source_id,result_hash,finished_at)
 values(id,(f->>'actor')::uuid,(f->>'session')::uuid,jsonb_build_object('pet_id',f->'pet','expected_pet_version',(select version from pets where pets.id=(f->>'pet')::uuid),'encounter_id',f->'encounter','expected_encounter_version',(select version from clinical_encounters where clinical_encounters.id=(f->>'encounter')::uuid),'inbound_id',ci.id,'expected_inbound_version',ci.version,'policy_version',p_capture_policy,'attest_authorized',true),context,'completed',id,public.clinical_recap_hash(doc),clock_timestamp());
 insert into clinical_call_sources(id,capture_id,actor_id,pet_id,encounter_id,client_id,conversation_id,call_uuid,call_id,policy_version,context,document,sha256)values(id,id,(f->>'actor')::uuid,(f->>'pet')::uuid,(f->>'encounter')::uuid,(f->>'client')::uuid,ci.conversation_id,call_uuid,'700099',p_capture_policy,context,doc,public.clinical_recap_hash(jsonb_build_object('context',context,'document',doc)));
 return id;
end $$;

create function pg_temp.cgn_request(p_source uuid,p_expected integer default 1)returns jsonb language sql as $$
 select jsonb_build_object('source_id',p_source,'expected_version',p_expected,'template_id','e7000000-0000-4000-8000-000000000001','template_version',1,'template_hash',(select sha256 from clinical_note_template_versions where template_id='e7000000-0000-4000-8000-000000000001'and version=1),'note_policy_version',2,'call_generation_policy_version',2,'attest_authorized',true)
$$;
create function pg_temp.cgn_payload(p_source uuid)returns jsonb language plpgsql as $$
declare s clinical_call_sources;t text;q text;support jsonb;fields jsonb:='[]';k text;begin
 select *into s from clinical_call_sources where id=p_source;t:=s.document#>>'{segments,0,text}';q:=substr(t,3);
 support:=jsonb_build_object('segment_ordinal',1,'segment_sha256',s.document#>>'{segments,0,text_sha256}','from',3,'to',public.clinical_note_text_length(t),'quote',q);
 foreach k in array array['subjective','objective','assessment','plan']loop
 fields:=fields||jsonb_build_array(jsonb_build_object('field_id',k,'status',case when k in('subjective','objective')then'supported'else'missing'end,'claims',case when k in('subjective','objective')then jsonb_build_array(jsonb_build_object('text',case when k='subjective'then'Owner reports historical vomiting; vaccine declined.'else'Other dog coughed.'end,'patient_scope',case when k='subjective'then'selected_patient'else'other_patient'end,'supports',jsonb_build_array(support)))else'[]'::jsonb end,'uncertainty',''));
 end loop;
 return jsonb_build_object('contract_version','clinical-call-note-payload-v1','fields',fields,'review_flags','[]'::jsonb);
end $$;

create function pg_temp.cgn_result(p_job uuid)returns jsonb language plpgsql as $$
declare j clinical_note_jobs;b clinical_call_note_bindings;begin
 select *into j from clinical_note_jobs where id=p_job;select *into b from clinical_call_note_bindings where job_id=p_job;
 return jsonb_build_object('request_id','synthetic-call-request','contract_version','clinical-call-note-result-v1','prompt_version','lrv-call-note-fields-v1','response_id','synthetic-call-response','requested_model','gpt-6-luna','provider_model','gpt-6-luna','job_id',j.id,'source_id',b.call_source_id,'source_manifest_sha256',b.call_source_sha256,'projection_sha256',j.source_sha256,'source_capture_policy_version',b.source_capture_policy_version,'call_generation_policy_version',b.call_generation_policy_version,'note_policy_version',j.policy_version,'template_id',j.template_id,'template_version',j.template_version,'template_sha256',j.template_hash,'veterinary_context',jsonb_build_object('version','lrv-vet-en-v1','bundle_sha256',repeat('b',64),'request_sha256',repeat('c',64)),'payload',pg_temp.cgn_payload(b.call_source_id));
end $$;

-- END GUARDED CALL GENERATION FIXTURES
create temp table cgn_fx(k text primary key,v jsonb);grant all on cgn_fx to authenticated,service_role;
create function pg_temp.cgn(k text)returns jsonb language sql as $$select v from cgn_fx where cgn_fx.k=$1$$;
insert into auth.users(id,email,raw_user_meta_data)values('e9000000-0000-4000-8000-000000000001','synthetic-generation-admin@example.test','{}'),('e9000000-0000-4000-8000-000000000002','synthetic-generation-staff@example.test','{}');
update profiles set is_active=true,full_name=repeat('🐕',300) where id in('e9000000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000002');
insert into user_roles(user_id,role)values('e9000000-0000-4000-8000-000000000001','ADMIN'),('e9000000-0000-4000-8000-000000000002','STAFF')on conflict do nothing;
insert into auth.sessions(id,user_id,created_at,updated_at)values('e9000000-0000-4000-8000-000000000011','e9000000-0000-4000-8000-000000000001',now(),now()),('e9000000-0000-4000-8000-000000000012','e9000000-0000-4000-8000-000000000002',now(),now());
insert into clinical_call_policies(version,status,consent_text,retention_text,reviewed_by,reviewed_at)values(2,'approved','Synthetic approval only','Synthetic retention only','e9000000-0000-4000-8000-000000000001',now());
insert into clinical_call_note_policies(version,status,consent_text,retention_text,reviewed_by,reviewed_at)values(2,'approved','Synthetic approval only','Synthetic retention only','e9000000-0000-4000-8000-000000000001',now());
insert into clinical_note_policies(version,status,consent_text,soap_model,reviewed_by,reviewed_at)values(2,'approved','Synthetic approval only','gpt-6-luna','e9000000-0000-4000-8000-000000000001',now());
insert into cgn_fx values('base',pg_temp.cgn_base('e9000000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000011')),('job',to_jsonb(gen_random_uuid())),('attempt',to_jsonb(gen_random_uuid())),('review_id',to_jsonb(gen_random_uuid()));
insert into cgn_fx select'source',to_jsonb(pg_temp.cgn_source(v))from cgn_fx where k='base';
insert into cgn_fx select'request',pg_temp.cgn_request((v#>>'{}')::uuid)from cgn_fx where k='source';
insert into cgn_fx select'chart_before',to_jsonb(e)from clinical_encounters e where id=(pg_temp.cgn('base')->>'encounter')::uuid;
select ok(relrowsecurity and not has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE')and not has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE')and not has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE'),'Call action journal is private and RLS enabled')from pg_class where relnamespace='public'::regnamespace and relname='clinical_call_note_actions';
select set_config('request.jwt.claims','{"sub":"e9000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"e9000000-0000-4000-8000-000000000011"}',true);set local role authenticated;
insert into cgn_fx values('cancelled_reservation',to_jsonb(gen_random_uuid()));
select is(cancel_clinical_call_note_reservation_v1(auth.uid(),(pg_temp.cgn('cancelled_reservation')#>>'{}')::uuid)->>'cancelled','true','Unknown reservation is durably cancelled');
select throws_ok($$select reserve_clinical_call_note_v1(auth.uid(),(pg_temp.cgn('cancelled_reservation')#>>'{}')::uuid,pg_temp.cgn('request'))$$,'PT409',null,'Cancelled UUID cannot later admit generation');
insert into cgn_fx select'reserved',reserve_clinical_call_note_v1(auth.uid(),(pg_temp.cgn('job')#>>'{}')::uuid,pg_temp.cgn('request'));
select is(pg_temp.cgn('reserved')->>'contract_version','clinical-call-note-processing-v1','Call reservation returns versioned private processing contract');
select is(pg_temp.cgn('reserved')#>>'{job,source_kind}','call_transcript','Call source uses true call discriminator');
select is(reserve_clinical_call_note_v1(auth.uid(),(pg_temp.cgn('job')#>>'{}')::uuid,pg_temp.cgn('request')),pg_temp.cgn('reserved'),'Lost reservation ACK recovers exact job');
select throws_ok($$select reserve_clinical_call_note_v1(auth.uid(),(pg_temp.cgn('job')#>>'{}')::uuid,pg_temp.cgn('request')||'{"source_text":"forged"}')$$,null,null,'Changed reservation intent cannot replace source');
select throws_ok($$select read_clinical_note_job(auth.uid(),(pg_temp.cgn('job')#>>'{}')::uuid)$$,'PT403',null,'Generic note read refuses actual admitted call');
insert into cgn_fx select'claim',claim_clinical_call_note_v1(auth.uid(),(pg_temp.cgn('attempt')#>>'{}')::uuid,jsonb_build_object('job_id',pg_temp.cgn('job'),'retry_of',null,'reason','','ack_cost',false));
select is(pg_temp.cgn('claim')->>'state','claimed','Explicit attempt is claimed without provider dispatch');
select is(claim_clinical_call_note_v1(auth.uid(),(pg_temp.cgn('attempt')#>>'{}')::uuid,jsonb_build_object('job_id',pg_temp.cgn('job'),'retry_of',null,'reason','','ack_cost',false)),pg_temp.cgn('claim'),'Lost claim ACK recovers original attempt');
do $$begin for n in 1..105 loop perform cancel_clinical_call_note_attempt_v1(auth.uid(),gen_random_uuid(),(pg_temp.cgn('job')#>>'{}')::uuid);end loop;end $$;
insert into cgn_fx select'bounded_history',read_clinical_call_note_processing_v1(auth.uid(),(pg_temp.cgn('job')#>>'{}')::uuid);
select is(jsonb_array_length(pg_temp.cgn('bounded_history')->'events'),100,'Long cancellation history stays within strict processing read budget');
select is(pg_temp.cgn('bounded_history')->>'events_has_more','true','Bounded event history explicitly discloses omitted older rows');
reset role;
select ok((select count(*)>100 from clinical_note_events where job_id=(pg_temp.cgn('job')#>>'{}')::uuid),'Older audit events remain retained, not deleted');
select is((select to_jsonb(e)from clinical_encounters e where id=(pg_temp.cgn('base')->>'encounter')::uuid),pg_temp.cgn('chart_before'),'Reserve and claim leave chart byte-exact');
insert into cgn_fx select'result',pg_temp.cgn_result((pg_temp.cgn('job')#>>'{}')::uuid);
set local role service_role;
select ok(dispatch_clinical_call_note_v1((pg_temp.cgn('job')#>>'{}')::uuid,(pg_temp.cgn('attempt')#>>'{}')::uuid),'First dispatch transitions once');
select ok(not dispatch_clinical_call_note_v1((pg_temp.cgn('job')#>>'{}')::uuid,(pg_temp.cgn('attempt')#>>'{}')::uuid),'Repeated dispatch cannot send again');
select throws_ok($$select fail_clinical_call_note_v1((pg_temp.cgn('job')#>>'{}')::uuid,(pg_temp.cgn('attempt')#>>'{}')::uuid,false,'provider_rejected','{"http_status":400.5}')$$,null,null,'Fractional HTTP diagnostic cannot be silently coerced');
select throws_ok($$select fail_clinical_call_note_v1((pg_temp.cgn('job')#>>'{}')::uuid,(pg_temp.cgn('attempt')#>>'{}')::uuid,false,'provider_rejected','{"retry_after_seconds":0.5}')$$,null,null,'Fractional retry delay cannot be silently coerced');
select throws_ok($$select finish_clinical_call_note_v1((pg_temp.cgn('job')#>>'{}')::uuid,(pg_temp.cgn('attempt')#>>'{}')::uuid,jsonb_set(pg_temp.cgn('result'),'{payload,fields,0,claims,0,supports,0,from}','1'))$$,null,null,'SQL refuses UTF16 range splitting emoji');
select throws_ok($$select finish_clinical_call_note_v1((pg_temp.cgn('job')#>>'{}')::uuid,(pg_temp.cgn('attempt')#>>'{}')::uuid,jsonb_set(pg_temp.cgn('result'),'{source_manifest_sha256}',to_jsonb(repeat('f',64))))$$,null,null,'SQL refuses wrong frozen source manifest');
select throws_ok($$select finish_clinical_call_note_v1((pg_temp.cgn('job')#>>'{}')::uuid,(pg_temp.cgn('attempt')#>>'{}')::uuid,jsonb_set(pg_temp.cgn('result'),'{payload,fields,0,claims,0,supports,0,quote}','"forged excerpt"'))$$,null,null,'SQL refuses quote not matching its own segment');
-- Every refusal is checked before the one valid finish, so failures cannot hide behind replay checks.
select throws_ok(format('select finish_clinical_call_note_v1(%L::uuid,%L::uuid,%L::jsonb)',pg_temp.cgn('job')#>>'{}',pg_temp.cgn('attempt')#>>'{}',jsonb_set(pg_temp.cgn('result'),path,value)),null,null,label)
from(values
 ('{payload,fields,0,claims,0,supports,0,segment_ordinal}'::text[],'2'::jsonb,'Unknown segment cannot support a claim'),
 ('{payload,fields,0,claims,0,supports,0,segment_sha256}'::text[],to_jsonb(repeat('f',64)),'Wrong segment hash refused'),
 ('{payload,fields,0,claims,0,supports,0,to}'::text[],'60000'::jsonb,'Out-of-range evidence refused'),
 ('{payload,fields,0,claims,0,patient_scope}'::text[],'"invented_patient"'::jsonb,'Unknown patient scope refused'),
 ('{payload,fields,0,claims,0,text}'::text[],to_jsonb(repeat('x',501)),'Overlong clinical claim refused'),
 ('{payload,fields,0,status}'::text[],'"missing"'::jsonb,'Missing field cannot carry claims'),
 ('{payload,fields,0,uncertainty}'::text[],'"unsupported hidden uncertainty"'::jsonb,'Supported field cannot hide uncertainty'),
 ('{payload,fields,0,status}'::text[],'"uncertain"'::jsonb,'Uncertain field needs explicit uncertainty'),
 ('{payload,fields,0,field_id}'::text[],'"objective"'::jsonb,'Pinned field order/identity cannot change'),
 ('{payload,fields,0,claims,0,supports}'::text[],'[]'::jsonb,'Each claim needs its own evidence'),
 ('{template_sha256}'::text[],to_jsonb(repeat('f',64)),'Pinned template digest cannot change'),
 ('{note_policy_version}'::text[],'1'::jsonb,'General note policy cannot change in result'),
 ('{call_generation_policy_version}'::text[],'1'::jsonb,'Call-generation policy cannot change in result'),
 ('{source_capture_policy_version}'::text[],'1'::jsonb,'Capture policy cannot change in result'),
 ('{projection_sha256}'::text[],to_jsonb(repeat('f',64)),'Projection digest cannot change'),
 ('{payload,contract_version}'::text[],'"clinical-note-v1"'::jsonb,'Legacy payload cannot masquerade as call result')
)bad(path,value,label);
select throws_ok(format('select finish_clinical_call_note_v1(%L::uuid,%L::uuid,%L::jsonb)',pg_temp.cgn('job')#>>'{}',pg_temp.cgn('attempt')#>>'{}',jsonb_set(pg_temp.cgn('result'),'{payload,fields,0,claims,0,supports}',jsonb_build_array(pg_temp.cgn('result')#>'{payload,fields,0,claims,0,supports,0}',pg_temp.cgn('result')#>'{payload,fields,0,claims,0,supports,0}'))),null,null,'Duplicated claim support refused');
select throws_ok(format('select finish_clinical_call_note_v1(%L::uuid,%L::uuid,%L::jsonb)',pg_temp.cgn('job')#>>'{}',pg_temp.cgn('attempt')#>>'{}',pg_temp.cgn('result')||'{"source_url":"https://invented.example.test"}'::jsonb),null,null,'Extra provider manifest metadata refused');
insert into cgn_fx select'finished',finish_clinical_call_note_v1((pg_temp.cgn('job')#>>'{}')::uuid,(pg_temp.cgn('attempt')#>>'{}')::uuid,pg_temp.cgn('result'));
select is(finish_clinical_call_note_v1((pg_temp.cgn('job')#>>'{}')::uuid,(pg_temp.cgn('attempt')#>>'{}')::uuid,pg_temp.cgn('result')),pg_temp.cgn('finished'),'Lost finish ACK recovers exact completed output');
reset role;
select is((select to_jsonb(e)from clinical_encounters e where id=(pg_temp.cgn('base')->>'encounter')::uuid),pg_temp.cgn('chart_before'),'Finished draft has not changed any chart text');
select is(pg_temp.cgn('finished')#>>'{proposal,actor_name}','Staff member','Overlong Unicode actor name yields a parseable proposal fallback');
select is(pg_temp.cgn('finished')#>>'{proposal,sections,objective,text}','','Other-patient claims remain private and ineligible');
select ok(pg_temp.cgn('finished')#>>'{proposal,sections,subjective,text}'like'%Owner reports historical vomiting%','Selected-patient draft is assembled');
select is((select count(*)::integer from clinical_note_generations where job_id=(pg_temp.cgn('job')#>>'{}')::uuid),1,'One immutable generation retained');
insert into cgn_fx select'review_request',jsonb_build_object('expected_version',1,'proposal_id',pg_temp.cgn('attempt'),'decision','accepted','accepted_sections',jsonb_build_object('subjective','Clinician reviewed owner-reported historical vomiting.'),'review_note','Synthetic review only','attest_reviewed',true);
set local role authenticated;
select throws_ok($$select save_clinical_dictation_action(auth.uid(),gen_random_uuid(),'review',pg_temp.cgn('review_request')||jsonb_build_object('pet_id',pg_temp.cgn('base')->'pet','encounter_id',pg_temp.cgn('base')->'encounter'))$$,'PT403',null,'Generic review cannot accept actual call proposal');
insert into cgn_fx select'accepted',save_clinical_call_note_review_v1(auth.uid(),(pg_temp.cgn('review_id')#>>'{}')::uuid,(pg_temp.cgn('job')#>>'{}')::uuid,pg_temp.cgn('review_request'));
select is(recover_clinical_call_note_review_v1(auth.uid(),(pg_temp.cgn('review_id')#>>'{}')::uuid,(pg_temp.cgn('job')#>>'{}')::uuid),pg_temp.cgn('accepted'),'ID-only review recovery returns immutable receipt');
select is(save_clinical_call_note_review_v1(auth.uid(),(pg_temp.cgn('review_id')#>>'{}')::uuid,(pg_temp.cgn('job')#>>'{}')::uuid,pg_temp.cgn('review_request')),pg_temp.cgn('accepted'),'Lost acceptance ACK recovers without second write');
reset role;
select is(pg_temp.cgn('accepted')#>>'{review,actor_name}','Staff member','Overlong Unicode reviewer name yields a parseable review fallback');
select is((select version from clinical_encounters where id=(pg_temp.cgn('base')->>'encounter')::uuid),2,'Acceptance advances exactly one encounter version');
select is((select status from clinical_encounters where id=(pg_temp.cgn('base')->>'encounter')::uuid),'draft','Acceptance does not sign encounter');
select is((select subjective from clinical_encounters where id=(pg_temp.cgn('base')->>'encounter')::uuid),'Clinician reviewed owner-reported historical vomiting.','Only reviewer-selected clinical wording enters chart');
select is((select objective from clinical_encounters where id=(pg_temp.cgn('base')->>'encounter')::uuid),'Original fictional O','Unselected existing section remains unchanged');
select is((select assessment from clinical_encounters where id=(pg_temp.cgn('base')->>'encounter')::uuid),'Original fictional A','Unselected assessment remains unchanged');
select is((select plan from clinical_encounters where id=(pg_temp.cgn('base')->>'encounter')::uuid),'Original fictional P','Unselected plan remains unchanged');
select throws_ok($$update clinical_call_note_actions set cancelled=cancelled where id=(pg_temp.cgn('review_id')#>>'{}')::uuid$$,'23514',null,'Review journal cannot be rewritten');
select set_config('request.jwt.claims','{"sub":"e9000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"e9000000-0000-4000-8000-000000000012"}',true);set local role authenticated;
select throws_ok($$select read_clinical_call_note_processing_v1(auth.uid(),(pg_temp.cgn('job')#>>'{}')::uuid)$$,'PT403',null,'STAFF cannot read complete call draft even after acceptance');
select throws_ok($$select recover_clinical_call_note_review_v1(auth.uid(),(pg_temp.cgn('review_id')#>>'{}')::uuid,(pg_temp.cgn('job')#>>'{}')::uuid)$$,'PT403',null,'STAFF cannot recover private accepted receipt');
reset role;
select set_config('request.jwt.claims','{"sub":"e9000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"e9000000-0000-4000-8000-000000000011"}',true);set local role authenticated;
do $$begin for n in 1..11 loop perform reserve_clinical_call_note_v1(auth.uid(),gen_random_uuid(),(pg_temp.cgn('request')||'{"expected_version":2}'::jsonb));end loop;end $$;
select throws_ok($$select reserve_clinical_call_note_v1(auth.uid(),gen_random_uuid(),(pg_temp.cgn('request')||'{"expected_version":2}'::jsonb))$$,'PT409','Note generation reservation limit reached','Thirteenth call reservation in an hour is refused');
select is(reserve_clinical_call_note_v1(auth.uid(),(pg_temp.cgn('job')#>>'{}')::uuid,pg_temp.cgn('request'))#>>'{job,id}',pg_temp.cgn('job')#>>'{}','Existing reservation replay remains available after quota is full');
reset role;
select is((select count(*)::integer from clinical_note_jobs where actor_id='e9000000-0000-4000-8000-000000000001'),12,'Hourly quota has exactly twelve retained admitted jobs');
-- Owner-seeded historical rows isolate the independent daily budget from hourly limits.
insert into user_roles(user_id,role)values('e9000000-0000-4000-8000-000000000002','ADMIN')on conflict do nothing;
do $$declare j clinical_note_jobs;b clinical_call_note_bindings;begin
 for n in 1..100 loop
 select *into j from clinical_note_jobs where id=(pg_temp.cgn('job')#>>'{}')::uuid;
 j.id:=gen_random_uuid();j.actor_id:='e9000000-0000-4000-8000-000000000002';j.session_id:='e9000000-0000-4000-8000-000000000012';j.expected_version:=2;j.intent:=(pg_temp.cgn('request')||'{"expected_version":2}'::jsonb);j.proposal_id:=null;j.created_at:=clock_timestamp()-interval'2 hours';
 insert into clinical_note_jobs select j.*;
 select *into b from clinical_call_note_bindings where job_id=(pg_temp.cgn('job')#>>'{}')::uuid;b.job_id:=j.id;b.created_at:=j.created_at;insert into clinical_call_note_bindings select b.*;
 end loop;
end $$;
set constraints all immediate;set constraints all deferred;
select is((select count(*)::integer from clinical_note_jobs where actor_id='e9000000-0000-4000-8000-000000000002'and created_at>clock_timestamp()-interval'1 hour'),0,'Daily budget fixture has no current-hour jobs');
select set_config('request.jwt.claims','{"sub":"e9000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"e9000000-0000-4000-8000-000000000012"}',true);set local role authenticated;
select throws_ok($$select reserve_clinical_call_note_v1(auth.uid(),gen_random_uuid(),(pg_temp.cgn('request')||'{"expected_version":2}'::jsonb))$$,'PT409','Note generation reservation limit reached','Hundred-and-first daily call reservation is refused independently');
reset role;
select *from finish();
rollback;
