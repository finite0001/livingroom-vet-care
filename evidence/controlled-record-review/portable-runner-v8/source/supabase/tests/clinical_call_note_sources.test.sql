begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- BEGIN OWNED CALL NOTE FIXTURES
-- Owner-only fictional persistence fixtures. No reservation, provider or chart-write RPC.
create function pg_temp.ccn_base(p_actor uuid,p_session uuid)returns jsonb language plpgsql as $$
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
create function pg_temp.ccn_note(f jsonb,p_kind text,p_source uuid default null,p_link text default'both',p_policy integer default 1,p_generation integer default 1)returns jsonb language plpgsql as $$
declare j uuid:=gen_random_uuid();p uuid:=gen_random_uuid();a uuid:=gen_random_uuid();r uuid:=gen_random_uuid();txt text;h text;th text;sec jsonb;intent jsonb;payload jsonb;result jsonb;template jsonb;review_request jsonb;source clinical_call_sources;
begin
 txt:=case p_kind when'typed'then'Synthetic historical typed observation.'when'audio_transcript'then'Synthetic historical audio observation.'else(select document->>'projection'from clinical_call_sources where id=p_source)end;
 h:=encode(extensions.digest(convert_to(txt,'UTF8'),'sha256'),'hex');select sha256 into th from clinical_note_template_versions where template_id='e7000000-0000-4000-8000-000000000001'and version=1;
 sec:=jsonb_build_object('subjective',jsonb_build_object('text',E'Subjective:\n'||txt,'quote',txt),'objective',jsonb_build_object('text','','quote',''),'assessment',jsonb_build_object('text','','quote',''),'plan',jsonb_build_object('text','','quote',''));
 intent:=jsonb_build_object('source_kind',p_kind,'pet_id',f->'pet','encounter_id',f->'encounter','synthetic',true);
 insert into clinical_dictation_proposals(id,pet_id,encounter_id,expected_version,actor_id,actor_name,transcript,source_hash,source_note,attest_authorized,sections)values(p,(f->>'pet')::uuid,(f->>'encounter')::uuid,1,(f->>'actor')::uuid,'Synthetic operator',txt,h,'Owner-seeded synthetic proposal; no provider',true,sec);
 insert into clinical_note_jobs(id,actor_id,session_id,pet_id,encounter_id,expected_version,policy_version,template_id,template_version,template_hash,source_kind,source_text,source_sha256,audio_job_id,source_audio_policy_version,source_note,intent,proposal_id)
 values(j,(f->>'actor')::uuid,(f->>'session')::uuid,(f->>'pet')::uuid,(f->>'encounter')::uuid,1,p_policy,'e7000000-0000-4000-8000-000000000001',1,th,p_kind,txt,h,case when p_kind='audio_transcript'then(f->>'audio')::uuid end,case when p_kind='audio_transcript'then 1 end,'Synthetic source fixture',intent,case when p_link in('job','both')then p end);
 select jsonb_build_object('id',template_id,'version',version,'definition',definition,'sha256',sha256)into template from clinical_note_template_versions where template_id='e7000000-0000-4000-8000-000000000001'and version=1;
 select jsonb_build_object('fields',jsonb_agg(jsonb_build_object('field_id',k,'status',case when k='subjective'then'supported'else'missing'end,'claims',case when k='subjective'then jsonb_build_array(jsonb_build_object('text',txt,'quote',txt))else'[]'::jsonb end,'uncertainty','')order by ord),'review_flags','[]'::jsonb)into payload from unnest(array['subjective','objective','assessment','plan'])with ordinality fields(k,ord);
 result:=jsonb_build_object('request_id','synthetic-request','response_id','synthetic-response','provider_model','gpt-6-luna','contract_version','clinical-note-v1','prompt_version','lrv-note-fields-v1','source_sha256',h,'template_sha256',th,'language_context',jsonb_build_object('version','lrv-vet-en-v1','bundle_sha256',repeat('b',64),'request_sha256',repeat('c',64)),'payload',payload);
 insert into clinical_note_attempts(id,job_id,actor_id,session_id,model,state,intent,lease_until,result,result_hash,finished_at)values(a,j,(f->>'actor')::uuid,(f->>'session')::uuid,'gpt-6-luna','completed',jsonb_build_object('job_id',j,'retry_of',null,'reason','','ack_cost',false),now()+interval'1 minute',result,public.clinical_recap_hash(result),now());
 if p_link in('generation','both')then insert into clinical_note_generations(proposal_id,job_id,attempt_id,template_snapshot,source_sha256,payload,manifest)values(p,j,a,template,h,payload,result-'payload');end if;
 review_request:=jsonb_build_object('pet_id',f->'pet','encounter_id',f->'encounter','expected_version',1,'proposal_id',p,'decision','rejected','accepted_sections','{}'::jsonb,'review_note','Synthetic prior review','attest_reviewed',true);
 if p_kind<>'call_transcript'then insert into clinical_dictation_reviews(id,proposal_id,actor_id,actor_name,decision,accepted_sections,review_note,attest_reviewed)values(r,p,(f->>'actor')::uuid,'Synthetic operator','rejected','{}','Synthetic prior review',true);end if;
 insert into clinical_dictation_actions(id,actor_id,kind,request,receipt)values(r,(f->>'actor')::uuid,'review',review_request,jsonb_build_object('id',r,'actor_id',f->'actor','kind','review','proposal_id',p,'pet_id',f->'pet','encounter_id',f->'encounter','decision','rejected','encounter',null));
 if p_kind='call_transcript'then
  select *into source from clinical_call_sources where id=p_source;
  insert into clinical_call_note_bindings(job_id,call_source_id,call_source_sha256,source_capture_policy_version,call_generation_policy_version)values(j,p_source,source.sha256,source.policy_version,p_generation);
 end if;
 return jsonb_build_object('job',j,'proposal',p,'attempt',a,'action',r,'intent',intent,'result',result,'review_request',review_request);
end $$;
create function pg_temp.ccn_source(f jsonb,p_capture_policy integer default 1)returns uuid language plpgsql as $$
declare id uuid:=gen_random_uuid();call_uuid text:='synthetic-call-note-'||id;ci communication_inbound;doc jsonb;context jsonb;projection text:=E'[#0001 caller="owner"]\nOwner reports historical vomiting; vaccine declined.\n';normalized text;pages jsonb;ended timestamptz:='2026-10-01T09:59:00Z';
begin
 insert into cloudtalk_calls(call_uuid,call_id,direction,external_number,internal_number,started_at,ended_at,duration_seconds,talking_seconds,trusted_number,transcript_ready,last_event_at)values(call_uuid,'700099','inbound',(select primary_phone from clients where clients.id=(f->>'client')::uuid),'+13035550000',ended-interval'1 minute',ended,60,60,true,true,ended);
 select *into ci from communication_inbound where provider='cloudtalk'and resource_id='call:'||call_uuid;
 context:=jsonb_build_object('client_id',f->'client','conversation_id',ci.conversation_id,'message_id',ci.message_id,'call_uuid',call_uuid,'call_id','700099','call_started_at',ended-interval'1 minute','call_ended_at',ended,'call_last_event_at',ended,'inbound_version',ci.version);
 normalized:=jsonb_build_object('data',jsonb_build_object('callId',700099,'language','en','callers','[{"type":"contact","id":null,"localIdentifier":"owner"}]'::jsonb,'segments','[{"start":0,"end":2,"caller":"owner","text":"Owner reports historical vomiting; vaccine declined."}]'::jsonb),'pagination',jsonb_build_object('limit',100,'offset',0,'total',1))::text;
 select jsonb_agg(jsonb_build_object('pass',pass,'offset',0,'limit',100,'total',1,'count',1,'normalized_json',normalized,'sha256',encode(extensions.digest(convert_to(normalized,'UTF8'),'sha256'),'hex'),'retrieved_at','2026-10-01T10:00:00Z'))into pages from generate_series(1,2)pass;
 doc:=jsonb_build_object('contract_version','clinical-call-source-v1','provider_schema_version','cloudtalk-ci-transcription-v1','completeness','observed_two_pass','call_id','700099','language','en','callers','[{"type":"contact","id":null,"localIdentifier":"owner"}]'::jsonb,'segments',jsonb_build_array(jsonb_build_object('ordinal',1,'start',0,'end',2,'caller','owner','text','Owner reports historical vomiting; vaccine declined.','text_sha256',encode(extensions.digest(convert_to('Owner reports historical vomiting; vaccine declined.','UTF8'),'sha256'),'hex'),'projection_from',0,'projection_to',length(projection))),'projection',projection,'captured_from','2026-10-01T10:00:00Z','captured_until','2026-10-01T10:00:01Z','pages',pages);
 perform public.clinical_call_validate_document(doc,'700099');
 insert into clinical_call_sources(id,capture_id,actor_id,pet_id,encounter_id,client_id,conversation_id,call_uuid,call_id,policy_version,context,document,sha256)values(id,id,(f->>'actor')::uuid,(f->>'pet')::uuid,(f->>'encounter')::uuid,(f->>'client')::uuid,ci.conversation_id,call_uuid,'700099',p_capture_policy,context,doc,public.clinical_recap_hash(jsonb_build_object('context',context,'document',doc)));
 return id;
end $$;
create function pg_temp.ccn_bad_binding(f jsonb,p_source uuid,j_override jsonb,b_override jsonb,p_omit boolean default false)returns uuid language plpgsql as $$
declare id uuid:=gen_random_uuid();j clinical_note_jobs;b clinical_call_note_bindings;
begin
 select *into j from clinical_note_jobs retained_job where retained_job.id=(f#>>'{call,job}')::uuid;j.id:=id;j.proposal_id:=null;
 j:=jsonb_populate_record(j,j_override);insert into clinical_note_jobs select j.*;
 if not p_omit then
  select *into b from clinical_call_note_bindings retained_binding where retained_binding.job_id=(f#>>'{call,job}')::uuid;b.job_id:=id;b.call_source_id:=p_source;
  b:=jsonb_populate_record(b,b_override);insert into clinical_call_note_bindings select b.*;
 end if;
 set constraints call_note_job_binding,call_note_source_binding immediate;
 set constraints call_note_job_binding,call_note_source_binding deferred;
 return id;
end $$;
-- END OWNED CALL NOTE FIXTURES

create temp table ccn_fx(k text primary key,v jsonb);grant all on ccn_fx to authenticated,service_role;
insert into auth.users(id,email,raw_user_meta_data)values('e8000000-0000-4000-8000-000000000001','synthetic-call-note-admin@example.test','{}'),('e8000000-0000-4000-8000-000000000002','synthetic-call-note-staff@example.test','{}');
update profiles set is_active=true where id in('e8000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000002');
insert into user_roles(user_id,role)values('e8000000-0000-4000-8000-000000000001','ADMIN'),('e8000000-0000-4000-8000-000000000002','STAFF')on conflict do nothing;
insert into auth.sessions(id,user_id,created_at,updated_at)values('e8000000-0000-4000-8000-000000000011','e8000000-0000-4000-8000-000000000001',now(),now()),('e8000000-0000-4000-8000-000000000012','e8000000-0000-4000-8000-000000000002',now(),now());
insert into ccn_fx values('base',pg_temp.ccn_base('e8000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000011'));
update ccn_fx set v=v||jsonb_build_object('typed',pg_temp.ccn_note(v,'typed'),'audio_note',pg_temp.ccn_note(v,'audio_transcript'))where k='base';
insert into ccn_fx select'source',to_jsonb(pg_temp.ccn_source(v))from ccn_fx where k='base';
update ccn_fx set v=v||jsonb_build_object('call',pg_temp.ccn_note(v,'call_transcript',(select(v#>>'{}')::uuid from ccn_fx where k='source')))where k='base';
update ccn_fx set v=v||jsonb_build_object('job_only',pg_temp.ccn_note(v,'call_transcript',(select(v#>>'{}')::uuid from ccn_fx where k='source'),'job'),'generation_only',pg_temp.ccn_note(v,'call_transcript',(select(v#>>'{}')::uuid from ccn_fx where k='source'),'generation'))where k='base';
do $$begin for n in 1..22 loop perform pg_temp.ccn_note((select v from ccn_fx where k='base'),'call_transcript',(select(v#>>'{}')::uuid from ccn_fx where k='source'));end loop;end $$;
set constraints all immediate;
set constraints all deferred;
create function pg_temp.ccn(k text)returns jsonb language sql as $$select v from ccn_fx where ccn_fx.k=$1$$;
select ok(relrowsecurity and not has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE')and not has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE')and not has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE'),relname||' private RLS and no direct grants')from pg_class where relnamespace='public'::regnamespace and relname in('clinical_call_note_policies','clinical_call_note_bindings');
select is((select status from clinical_call_note_policies where version=1),'draft','Separate call generation policy defaults draft');
select ok(has_function_privilege('authenticated','read_clinical_call_note_job_v1(uuid,uuid)','EXECUTE')and not has_function_privilege('anon','read_clinical_call_note_job_v1(uuid,uuid)','EXECUTE')and not has_function_privilege('service_role','read_clinical_call_note_job_v1(uuid,uuid)','EXECUTE'),'Only authenticated guarded reader is granted');
select ok(not has_function_privilege('authenticated',oid,'EXECUTE')and not has_function_privilege('anon',oid,'EXECUTE')and not has_function_privilege('service_role',oid,'EXECUTE'),proname||' stays private')from pg_proc where pronamespace='public'::regnamespace and proname like'clinical_call_note_%';
insert into ccn_fx values('otherpet',to_jsonb(gen_random_uuid())),('otherencounter',to_jsonb(gen_random_uuid())),('receipt_action',to_jsonb(gen_random_uuid()));
insert into pets(id,client_id,name,species)values((pg_temp.ccn('otherpet')#>>'{}')::uuid,(pg_temp.ccn('base')->>'client')::uuid,'Other synthetic patient','Dog');
insert into clinical_encounters(id,pet_id,visit_at,visit_type,created_by,updated_by)values((pg_temp.ccn('otherencounter')#>>'{}')::uuid,(pg_temp.ccn('otherpet')#>>'{}')::uuid,now(),'clinic','e8000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000001');
insert into clinical_call_policies(version,status,consent_text,retention_text,reviewed_by,reviewed_at)values(2,'approved','Synthetic approval only','Synthetic retention only','e8000000-0000-4000-8000-000000000001',now());
select throws_ok($$select pg_temp.ccn_bad_binding(pg_temp.ccn('base'),(pg_temp.ccn('source')#>>'{}')::uuid,'{}','{}',true)$$,'23514',null,'Call job cannot commit without its deferred binding');
select throws_ok($$select pg_temp.ccn_bad_binding(pg_temp.ccn('base'),(pg_temp.ccn('source')#>>'{}')::uuid,'{"source_kind":"typed"}','{}')$$,'23514',null,'Typed job cannot have call binding');
select throws_ok($$select pg_temp.ccn_bad_binding(pg_temp.ccn('base'),(pg_temp.ccn('source')#>>'{}')::uuid,'{"source_text":"forged transcript"}','{}')$$,'23514',null,'Browser-like replacement transcript cannot satisfy binding');
select throws_ok($$select pg_temp.ccn_bad_binding(pg_temp.ccn('base'),(pg_temp.ccn('source')#>>'{}')::uuid,'{}',jsonb_build_object('call_source_sha256',repeat('b',64)))$$,'23514',null,'Changed manifest hash refused');
select throws_ok($$select pg_temp.ccn_bad_binding(pg_temp.ccn('base'),(pg_temp.ccn('source')#>>'{}')::uuid,jsonb_build_object('source_sha256',repeat('b',64)),'{}')$$,'23514',null,'Changed projection hash refused');
select throws_ok($$select pg_temp.ccn_bad_binding(pg_temp.ccn('base'),gen_random_uuid(),'{}','{}')$$,'23503',null,'Missing retained source cannot bind');
select throws_ok($$select pg_temp.ccn_bad_binding(pg_temp.ccn('base'),(pg_temp.ccn('source')#>>'{}')::uuid,jsonb_build_object('pet_id',pg_temp.ccn('otherpet')),'{}')$$,'23514',null,'Different existing patient cannot bind');
select throws_ok($$select pg_temp.ccn_bad_binding(pg_temp.ccn('base'),(pg_temp.ccn('source')#>>'{}')::uuid,jsonb_build_object('encounter_id',pg_temp.ccn('otherencounter')),'{}')$$,'23514',null,'Different existing encounter cannot bind');
select throws_ok($$select pg_temp.ccn_bad_binding(pg_temp.ccn('base'),(pg_temp.ccn('source')#>>'{}')::uuid,'{}','{"source_capture_policy_version":2}')$$,'23514',null,'Different existing capture policy cannot bind');
select throws_ok($$update clinical_call_note_bindings set call_generation_policy_version=call_generation_policy_version where job_id=(pg_temp.ccn('base')#>>'{call,job}')::uuid$$,'23514',null,'Binding cannot be rewritten even as owner');
select throws_ok($$delete from clinical_call_note_policies where version=1$$,'23514',null,'Generation policy immutable');
insert into clinical_dictation_actions(id,actor_id,kind,request,receipt)values((pg_temp.ccn('receipt_action')#>>'{}')::uuid,'e8000000-0000-4000-8000-000000000001','submit','{"synthetic":true}',jsonb_build_object('proposal_id',pg_temp.ccn('base')#>'{call,proposal}')),((pg_temp.ccn('base')#>>'{call,proposal}')::uuid,'e8000000-0000-4000-8000-000000000001','submit','{"synthetic":true}','{}');
select set_config('request.jwt.claims','{"sub":"e8000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"e8000000-0000-4000-8000-000000000011"}',true);set local role authenticated;
insert into ccn_fx select'read',read_clinical_call_note_job_v1(auth.uid(),(pg_temp.ccn('base')#>>'{call,job}')::uuid);
select is(pg_temp.ccn('read')->>'contract_version','clinical-call-note-source-v1','Explicit versioned call read contract');
select is((select array_agg(key order by key)from jsonb_object_keys(pg_temp.ccn('read'))key),array['binding','contract_version','job','source_context'],'Reader returns only four advertised keys');
select ok(not(pg_temp.ccn('read')->'job'?'session_id')and not(pg_temp.ccn('read')->'job'?'intent')and not(pg_temp.ccn('read')->'job'?'attempts')and not(pg_temp.ccn('read')?'document'),'Reader omits session, intent, attempts and full document');
select is(pg_temp.ccn('read')#>>'{job,source_kind}','call_transcript','Call source is not disguised as typed/audio');
select throws_ok($$select read_clinical_note_job(auth.uid(),(pg_temp.ccn('base')#>>'{call,job}')::uuid)$$,'PT403',null,'ADMIN generic direct note read refuses call');
select throws_ok($$select read_clinical_note_provenance(auth.uid(),(pg_temp.ccn('base')#>>'{call,proposal}')::uuid)$$,'PT403',null,'ADMIN generic note provenance refuses call');
select throws_ok($$select read_clinical_audio_provenance(auth.uid(),(pg_temp.ccn('base')#>>'{call,proposal}')::uuid)$$,'PT403',null,'Audio provenance cannot reflect call proposal');
select throws_ok($$select read_clinical_note_provenance(auth.uid(),(pg_temp.ccn('base')#>>'{job_only,proposal}')::uuid)$$,'PT403',null,'Missing generation link does not bypass private proposal classifier');
select throws_ok($$select read_clinical_note_provenance(auth.uid(),(pg_temp.ccn('base')#>>'{generation_only,proposal}')::uuid)$$,'PT403',null,'Missing job proposal link does not bypass private generation classifier');
select throws_ok($$select reserve_clinical_note(auth.uid(),(pg_temp.ccn('base')#>>'{call,job}')::uuid,pg_temp.ccn('base')#>'{call,intent}')$$,'PT403',null,'Exact completed reservation replay cannot return call source');
select throws_ok($$select claim_clinical_note(auth.uid(),(pg_temp.ccn('base')#>>'{call,attempt}')::uuid,(pg_temp.ccn('base')#>>'{call,job}')::uuid)$$,'PT403',null,'Exact completed claim replay cannot return call source');
select throws_ok($$select cancel_clinical_note_reservation(auth.uid(),(pg_temp.ccn('base')#>>'{call,job}')::uuid)$$,'PT403',null,'Reservation cancel cannot reflect stored call job');
select throws_ok($$select cancel_clinical_note_attempt(auth.uid(),(pg_temp.ccn('base')#>>'{call,attempt}')::uuid,(pg_temp.ccn('base')#>>'{call,job}')::uuid)$$,'PT403',null,'Attempt cancel cannot reflect completed call job');
select throws_ok($$select recover_clinical_dictation_action(auth.uid(),(pg_temp.ccn('base')#>>'{call,action}')::uuid,'review',pg_temp.ccn('base')#>'{call,review_request}')$$,'PT403',null,'Exact review action recovery cannot reflect call receipt');
select throws_ok($$select save_clinical_dictation_action(auth.uid(),(pg_temp.ccn('base')#>>'{call,action}')::uuid,'review',pg_temp.ccn('base')#>'{call,review_request}')$$,'PT403',null,'Exact review save replay cannot reflect call receipt');
select throws_ok($$select recover_clinical_dictation_action(auth.uid(),(pg_temp.ccn('receipt_action')#>>'{}')::uuid,'submit','{"synthetic":true}')$$,'PT403',null,'Receipt-only proposal reference remains private');
select throws_ok($$select recover_clinical_dictation_action(auth.uid(),(pg_temp.ccn('base')#>>'{call,proposal}')::uuid,'submit','{"synthetic":true}')$$,'PT403',null,'Submit action identity cannot reflect linked private proposal');
select is(jsonb_array_length(read_clinical_notes(auth.uid(),(pg_temp.ccn('base')->>'pet')::uuid,(pg_temp.ccn('base')->>'encounter')::uuid)->'jobs'),2,'Generic notes filter call jobs');
select is(jsonb_array_length(read_clinical_dictation(auth.uid(),(pg_temp.ccn('base')->>'pet')::uuid,(pg_temp.ccn('base')->>'encounter')::uuid)->'items'),2,'Generic dictation filters call proposals');
select is(read_clinical_dictation(auth.uid(),(pg_temp.ccn('base')->>'pet')::uuid,(pg_temp.ccn('base')->>'encounter')::uuid)->>'has_more','false','Hidden call proposals cannot affect generic dictation count');
reset role;set local role service_role;
select throws_ok($$select dispatch_clinical_note((pg_temp.ccn('base')#>>'{call,attempt}')::uuid)$$,'PT403',null,'Service dispatch refuses before completed early return');
select throws_ok($$select finish_clinical_note((pg_temp.ccn('base')#>>'{call,attempt}')::uuid,pg_temp.ccn('base')#>'{call,result}')$$,'PT403',null,'Service finish refuses before exact result replay');
select throws_ok($$select fail_clinical_note((pg_temp.ccn('base')#>>'{call,attempt}')::uuid,false,'synthetic')$$,'PT403',null,'Service failure cannot mutate completed call attempt');
reset role;
select is((select subjective from clinical_encounters where id=(pg_temp.ccn('base')->>'encounter')::uuid),'Original fictional S','Private call fixtures never modify SOAP');
select is((select count(*)::integer from clinical_dictation_reviews where proposal_id=(pg_temp.ccn('base')#>>'{call,proposal}')::uuid),0,'No call review or chart acceptance created');
-- Owner-only approvals deliberately bypass no public gate. Hard refusals must not depend on draft defaults.
insert into clinical_call_note_policies(version,status,consent_text,retention_text,reviewed_by,reviewed_at)values(2,'approved','Synthetic approval only','Synthetic retention only','e8000000-0000-4000-8000-000000000001',now());
insert into clinical_note_policies(version,status,consent_text,soap_model,reviewed_by,reviewed_at)values(2,'approved','Synthetic approval only','gpt-6-luna','e8000000-0000-4000-8000-000000000001',now());
insert into ccn_fx select'approved_source',to_jsonb(pg_temp.ccn_source(pg_temp.ccn('base'),2));
insert into ccn_fx select'approved_call',pg_temp.ccn_note(pg_temp.ccn('base'),'call_transcript',(pg_temp.ccn('approved_source')#>>'{}')::uuid,'generation',2,2);
update clinical_note_attempts set state='sending'where id=(pg_temp.ccn('approved_call')->>'attempt')::uuid;
set constraints all immediate;set constraints all deferred;
set local role service_role;
select throws_ok($$select finish_clinical_note((pg_temp.ccn('approved_call')->>'attempt')::uuid,pg_temp.ccn('approved_call')->'result')$$,'PT403',null,'Approved source/note/template policies cannot enable call generation through legacy finish');
reset role;set local role authenticated;
select throws_ok($$select save_clinical_dictation_action(auth.uid(),gen_random_uuid(),'review',(pg_temp.ccn('approved_call')->'review_request')||jsonb_build_object('decision','accepted','accepted_sections',jsonb_build_object('subjective','Synthetic reviewed call wording.')))$$,'PT403',null,'Approved policies cannot enable fresh call acceptance through generic review');
reset role;
select is((select subjective from clinical_encounters where id=(pg_temp.ccn('base')->>'encounter')::uuid),'Original fictional S','Approved-policy bypass attempts leave canonical SOAP unchanged');
select set_config('request.jwt.claims','{"sub":"e8000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"e8000000-0000-4000-8000-000000000012"}',true);set local role authenticated;
select throws_ok($$select read_clinical_call_note_job_v1(auth.uid(),(pg_temp.ccn('base')#>>'{call,job}')::uuid)$$,'PT403',null,'STAFF cannot access versioned call source');
select throws_ok($$select read_clinical_note_job(auth.uid(),(pg_temp.ccn('base')#>>'{call,job}')::uuid)$$,'PT403',null,'STAFF cannot access call through legacy direct ID');
reset role;
select *from finish();rollback;
