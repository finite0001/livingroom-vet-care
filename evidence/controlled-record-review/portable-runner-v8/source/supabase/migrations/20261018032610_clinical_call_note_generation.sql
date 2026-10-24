-- Dedicated private call workflow. Legacy typed/audio contracts and grants stay unchanged.
-- Real processing remains independently gated by the Edge configuration and draft policies.
create table public.clinical_call_note_actions (
 id uuid primary key, actor_id uuid not null references auth.users(id), session_id uuid not null,
 kind text not null check(kind in ('policy','review')), job_id uuid references public.clinical_note_jobs(id),
 cancelled boolean not null, request jsonb, receipt jsonb, created_at timestamptz not null default clock_timestamp(),
 check((kind='policy' and job_id is null) or (kind='review' and job_id is not null)),
 check((cancelled and request is null and receipt is null) or (not cancelled and request is not null and receipt is not null))
);
create index clinical_call_note_actions_actor_idx on public.clinical_call_note_actions(actor_id);
create index clinical_call_note_actions_job_idx on public.clinical_call_note_actions(job_id);
alter table public.clinical_call_note_actions enable row level security;
revoke all on public.clinical_call_note_actions from public,anon,authenticated,service_role;
create trigger immutable_call_note_action before update or delete on public.clinical_call_note_actions for each row execute function public.guard_inquiry_history();
create trigger no_truncate_call_note_action before truncate on public.clinical_call_note_actions for each statement execute function public.native_correction_immutable();

create function public.clinical_call_note_policy_v1() returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select to_jsonb(p) from clinical_call_note_policies p order by version desc limit 1
$$;
create function public.read_clinical_call_note_policy_v1(p_actor_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$begin
 perform public.clinical_call_actor(p_actor_id);return public.clinical_call_note_policy_v1();
end $$;

create function public.claim_clinical_call_note_v1(p_actor_id uuid,p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;a clinical_note_attempts;old clinical_note_attempts;c clinical_note_attempt_cancellations;p clinical_note_policies;begin
 perform public.clinical_call_actor(p_actor_id);
 if p_id is null or current_setting('transaction_isolation')<>'read committed' then raise exception 'Attempt identity and READ COMMITTED required' using errcode='PT422';end if;
 perform public.clinical_recap_keys(p_request,array['job_id','retry_of','reason','ack_cost']);perform public.clinical_recap_uuid(p_request->'job_id');
 if p_request->'retry_of'<>'null'::jsonb then perform public.clinical_recap_uuid(p_request->'retry_of');end if;
 if jsonb_typeof(p_request->'reason') is distinct from 'string' or public.clinical_note_text_length(p_request->>'reason')>1000 or jsonb_typeof(p_request->'ack_cost') is distinct from 'boolean' then raise exception 'Bounded exact attempt intent required' using errcode='PT422';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-note-actor:'||p_actor_id,0));
 select * into j from clinical_note_jobs where id=(p_request->>'job_id')::uuid for update;
 if j.id is null or j.actor_id<>p_actor_id or j.source_kind<>'call_transcript' then raise exception 'Owned call job required' using errcode='PT403';end if;
 perform public.clinical_call_actor(p_actor_id);
 select * into c from clinical_note_attempt_cancellations where id=p_id;
 if found then
  if c.actor_id<>p_actor_id or c.job_id<>j.id or c.intent is distinct from p_request then raise exception 'Cancelled attempt identity conflict' using errcode='PT409';end if;
  raise exception 'Attempt durably cancelled; create a new action' using errcode='PT409';
 end if;
 select * into a from clinical_note_attempts where id=p_id;
 if found then
  if a.actor_id<>p_actor_id or a.job_id<>j.id or a.intent is distinct from p_request then raise exception 'Attempt identity conflict' using errcode='PT409';end if;
  perform public.clinical_call_note_history_v1(j);perform public.clinical_call_actor(p_actor_id);return to_jsonb(a)-array['session_id','result'];
 end if;
 perform public.clinical_call_note_guard_v1(j);
 if j.proposal_id is not null then raise exception 'Generation complete; read retained draft' using errcode='PT409';end if;
 select * into old from clinical_note_attempts where job_id=j.id order by created_at desc,id desc limit 1;
 if found then
  if (p_request->>'retry_of')::uuid is distinct from old.id or not public.clinical_note_nonblank(p_request->>'reason') or p_request->'ack_cost'<>'true'::jsonb then raise exception 'Explicit retry reason and charge acknowledgement required' using errcode='PT422';end if;
  if old.state='completed' or (old.state in('claimed','sending') and old.lease_until>clock_timestamp()) then raise exception 'Original attempt complete or running; recover it' using errcode='PT409';end if;
  if old.finished_at is not null and old.failure_details?'retry_after_seconds' and old.finished_at+make_interval(secs=>(old.failure_details->>'retry_after_seconds')::integer)>clock_timestamp() then raise exception 'Provider cooldown remains active' using errcode='PT409';end if;
  update clinical_note_attempts set state='superseded',finished_at=clock_timestamp() where id=old.id;
 elsif p_request->'retry_of'<>'null'::jsonb or p_request->>'reason'<>'' or p_request->'ack_cost'<>'false'::jsonb then raise exception 'Initial attempt must have no retry intent' using errcode='PT422';end if;
 if (select count(*) from clinical_note_attempts where job_id=j.id)>=6 or (select count(*) from clinical_note_attempts where actor_id=p_actor_id and state in('claimed','sending') and lease_until>clock_timestamp())>=2 then raise exception 'Attempt limit reached' using errcode='PT409';end if;
 perform public.clinical_call_actor(p_actor_id);p:=public.clinical_note_current_policy();
 insert into clinical_note_attempts(id,job_id,actor_id,session_id,model,state,intent,lease_until) values(p_id,j.id,p_actor_id,public.next_visit_review_session(),p.soap_model,'claimed',p_request,clock_timestamp()+interval '90 seconds') returning * into a;
 insert into clinical_note_events(job_id,attempt_id,actor_id,kind,details) values(j.id,a.id,p_actor_id,'claimed',p_request);
 return to_jsonb(a)-array['session_id','result'];
end $$;

create function public.cancel_clinical_call_note_attempt_v1(p_actor_id uuid,p_id uuid,p_job_id uuid,p_retry_of uuid default null,p_reason text default '',p_ack_cost boolean default false) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;a clinical_note_attempts;c clinical_note_attempt_cancellations;intent jsonb;begin
 perform public.clinical_call_actor(p_actor_id);
 if p_id is null or p_job_id is null or p_reason is null or public.clinical_note_text_length(p_reason)>1000 or p_ack_cost is null then raise exception 'Exact attempt intent required' using errcode='PT422';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-note-actor:'||p_actor_id,0));
 select * into j from clinical_note_jobs where id=p_job_id for update;
 if j.id is null or j.actor_id<>p_actor_id or j.source_kind<>'call_transcript' then raise exception 'Owned call job required' using errcode='PT403';end if;
 intent:=jsonb_build_object('job_id',j.id,'retry_of',p_retry_of,'reason',p_reason,'ack_cost',p_ack_cost);
 select * into a from clinical_note_attempts where id=p_id for update;
 select * into c from clinical_note_attempt_cancellations where id=p_id;
 if (a.id is not null and(a.actor_id<>p_actor_id or a.job_id<>j.id or a.intent is distinct from intent)) or (c.id is not null and(c.actor_id<>p_actor_id or c.job_id<>j.id or c.intent is distinct from intent)) then raise exception 'Attempt identity conflict' using errcode='PT409';end if;
 perform public.clinical_call_note_history_v1(j);perform public.clinical_call_actor(p_actor_id);
 if c.id is not null then return jsonb_build_object('cancelled',true,'job',public.clinical_call_note_view_v1(j));end if;
 if a.id is not null then
  if a.state<>'claimed' then return jsonb_build_object('cancelled',false,'job',public.clinical_call_note_view_v1(j));end if;
  update clinical_note_attempts set state='failed',error_code='operator_cancelled_before_dispatch',failure_details='{}',finished_at=clock_timestamp() where id=a.id;
 end if;
 insert into clinical_note_attempt_cancellations(id,job_id,actor_id,session_id,intent) values(p_id,j.id,p_actor_id,public.next_visit_review_session(),intent);
 insert into clinical_note_events(job_id,actor_id,kind,details) values(j.id,p_actor_id,'cancelled_before_dispatch',jsonb_build_object('attempt_id',p_id));
 return jsonb_build_object('cancelled',true,'job',public.clinical_call_note_view_v1(j));
end $$;

create function public.dispatch_clinical_call_note_v1(p_job_id uuid,p_attempt_id uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;a clinical_note_attempts;owner_id uuid;begin
 select actor_id into owner_id from clinical_note_jobs where id=p_job_id;
 perform pg_advisory_xact_lock(hashtextextended('clinical-note-actor:'||owner_id,0));
 select * into j from clinical_note_jobs where id=p_job_id for update;select * into a from clinical_note_attempts where id=p_attempt_id for update;
 if a.id is null or j.id is null or a.job_id<>j.id or j.source_kind<>'call_transcript' then raise exception 'Exact call attempt required' using errcode='PT404';end if;
 perform public.clinical_call_worker_actor(a.actor_id,a.session_id);
 if a.state<>'claimed' then return false;end if;
 perform public.clinical_call_note_guard_v1(j);perform public.clinical_call_worker_actor(a.actor_id,a.session_id);
 if a.actor_id<>j.actor_id or a.model is distinct from (public.clinical_note_current_policy()).soap_model or a.lease_until<=clock_timestamp() then raise exception 'Attempt expired or operator changed' using errcode='PT409';end if;
 update clinical_note_attempts set state='sending' where id=a.id;
 insert into clinical_note_events(job_id,attempt_id,actor_id,kind,details) values(j.id,a.id,a.actor_id,'dispatched',jsonb_build_object('model',a.model));return true;
end $$;

create function public.fail_clinical_call_note_v1(p_job_id uuid,p_attempt_id uuid,p_uncertain boolean,p_code text,p_details jsonb default '{}') returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;a clinical_note_attempts;begin
 if jsonb_typeof(p_details) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_details) k where k<>all(array['http_status','provider_code','request_id','retry_after_seconds'])) then raise exception 'Sanitized diagnostics required' using errcode='PT422';end if;
 if (p_details?'http_status' and public.clinical_recap_integer(p_details->'http_status',100,599) is null)
 or(p_details?'provider_code' and(jsonb_typeof(p_details->'provider_code')<>'string' or p_details->>'provider_code'!~'^[a-z0-9_]{1,80}$'))
 or(p_details?'request_id' and(jsonb_typeof(p_details->'request_id')<>'string' or public.clinical_note_text_length(p_details->>'request_id')>200))
 or(p_details?'retry_after_seconds' and public.clinical_recap_integer(p_details->'retry_after_seconds',0,86400) is null)
 or p_uncertain is null or p_code is null or p_code!~'^[a-z_]{1,80}$' then raise exception 'Bounded sanitized outcome required' using errcode='PT422';end if;
 select * into j from clinical_note_jobs where id=p_job_id for update;select * into a from clinical_note_attempts where id=p_attempt_id for update;
 if a.id is null or j.id is null or a.job_id<>j.id or j.source_kind<>'call_transcript' then raise exception 'Exact call attempt required' using errcode='PT404';end if;
 -- Failure can still be recorded after operator revocation; no source or provider text is returned.
 if a.state not in('claimed','sending') then return;end if;
 update clinical_note_attempts set state=case when p_uncertain then 'uncertain' else 'failed' end,error_code=p_code,failure_details=p_details,finished_at=clock_timestamp() where id=a.id;
 insert into clinical_note_events(job_id,attempt_id,actor_id,kind,details) values(j.id,a.id,a.actor_id,case when p_uncertain then 'uncertain' else 'failed' end,jsonb_build_object('code',p_code)||p_details);
end $$;
create function public.save_clinical_call_note_policy_v1(p_actor_id uuid,p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a clinical_call_note_actions;p jsonb;r jsonb;begin
 perform public.clinical_call_actor(p_actor_id);
 if p_id is null or current_setting('transaction_isolation')<>'read committed' then raise exception 'Policy action requires READ COMMITTED and identity' using errcode='PT422';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-call-note-action:'||p_id,0));
 perform pg_advisory_xact_lock(hashtextextended('clinical-call-note-policy',0));
 perform public.clinical_call_actor(p_actor_id);
 select * into a from clinical_call_note_actions where id=p_id;
 if found then
  if a.actor_id<>p_actor_id or a.kind<>'policy' or a.cancelled or a.request is distinct from p_request then raise exception 'Policy action conflict' using errcode='PT409';end if;
  return a.receipt;
 end if;
 perform public.clinical_recap_keys(p_request,array['expected_version','status','consent_text','retention_text','attest_reviewed']);
 p:=public.clinical_call_note_policy_v1();
 if public.clinical_recap_integer(p_request->'expected_version',1,2147483646)<>(p->>'version')::integer
 or jsonb_typeof(p_request->'status') is distinct from 'string' or p_request->>'status' not in('draft','approved')
 or not coalesce(public.clinical_recap_text(p_request->'consent_text',4000),false)
 or not coalesce(public.clinical_recap_text(p_request->'retention_text',2000),false)
 or jsonb_typeof(p_request->'attest_reviewed') is distinct from 'boolean'
 or (p_request->>'status'='approved' and p_request->'attest_reviewed'<>'true'::jsonb) then raise exception 'Exact reviewed policy request required' using errcode='PT422';end if;
 insert into clinical_call_note_policies(version,status,consent_text,retention_text,reviewed_by,reviewed_at)
 values((p->>'version')::integer+1,p_request->>'status',p_request->>'consent_text',p_request->>'retention_text',case when p_request->>'status'='approved' then p_actor_id end,case when p_request->>'status'='approved' then clock_timestamp() end)
 returning to_jsonb(clinical_call_note_policies.*) into r;
 insert into clinical_call_note_actions(id,actor_id,session_id,kind,cancelled,request,receipt) values(p_id,p_actor_id,public.next_visit_review_session(),'policy',false,p_request,r);
 return r;
end $$;
create function public.recover_clinical_call_note_policy_v1(p_actor_id uuid,p_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a clinical_call_note_actions;begin
 perform public.clinical_call_actor(p_actor_id);
 perform pg_advisory_xact_lock(hashtextextended('clinical-call-note-action:'||p_id,0));perform public.clinical_call_actor(p_actor_id);
 select * into a from clinical_call_note_actions where id=p_id;if not found then return null;end if;
 if a.actor_id<>p_actor_id or a.kind<>'policy' then raise exception 'Private action unavailable' using errcode='PT403';end if;
 return a.receipt;
end $$;
create function public.cancel_clinical_call_note_policy_v1(p_actor_id uuid,p_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a clinical_call_note_actions;begin
 perform public.clinical_call_actor(p_actor_id);if p_id is null then raise exception 'Action identity required' using errcode='PT422';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-call-note-action:'||p_id,0));perform public.clinical_call_actor(p_actor_id);
 select * into a from clinical_call_note_actions where id=p_id;
 if found then
  if a.actor_id<>p_actor_id or a.kind<>'policy' then raise exception 'Private action unavailable' using errcode='PT403';end if;
  return jsonb_build_object('cancelled',a.cancelled,'policy',a.receipt);
 end if;
 insert into clinical_call_note_actions(id,actor_id,session_id,kind,cancelled) values(p_id,p_actor_id,public.next_visit_review_session(),'policy',true);
 return jsonb_build_object('cancelled',true,'policy',null);
end $$;

-- Historical authorization never enters a live eligibility guard after source locks.
create function public.clinical_call_note_history_v1(j public.clinical_note_jobs) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare s clinical_call_sources;begin
 if j.id is null or j.source_kind is distinct from 'call_transcript' then raise exception 'Private call note missing' using errcode='PT404';end if;
 perform public.clinical_call_note_check_binding(j.id);
 select source.* into s from clinical_call_sources source join clinical_call_note_bindings b on b.call_source_id=source.id where b.job_id=j.id;
 if s.id is null then raise exception 'Private source missing' using errcode='PT404';end if;
 perform public.clinical_call_source_access(s);
end $$;

-- Actor → job → attempt → note policy → capture policy → generation policy → template
-- → encounter → patient → inbound → provider → conversation → message.
create function public.clinical_call_note_guard_v1(j public.clinical_note_jobs,p_accept boolean default false) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare b clinical_call_note_bindings;s clinical_call_sources;a clinical_call_capture_actions;t clinical_note_templates;
 p clinical_note_policies;c jsonb;g jsonb;actual jsonb;pet_version integer;begin
 if j.id is null or j.source_kind is distinct from 'call_transcript' then raise exception 'Call job required' using errcode='PT404';end if;
 if p_accept then perform public.clinical_call_actor(auth.uid());else perform public.clinical_call_worker_actor(j.actor_id,j.session_id);end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-note-policy',0));
 perform pg_advisory_xact_lock(hashtextextended('clinical-call-policy',0));
 perform pg_advisory_xact_lock(hashtextextended('clinical-call-note-policy',0));
 if p_accept then perform public.clinical_call_actor(auth.uid());else perform public.clinical_call_worker_actor(j.actor_id,j.session_id);end if;
 perform public.clinical_call_note_check_binding(j.id);
 select * into b from clinical_call_note_bindings where job_id=j.id;
 select * into s from clinical_call_sources where id=b.call_source_id;
 p:=public.clinical_note_current_policy();c:=public.clinical_call_current_policy();g:=public.clinical_call_note_policy_v1();
 if p.status is distinct from 'approved' or p.version is distinct from j.policy_version
 or c->>'status' is distinct from 'approved' or (c->>'version')::integer is distinct from b.source_capture_policy_version
 or g->>'status' is distinct from 'approved' or (g->>'version')::integer is distinct from b.call_generation_policy_version then raise exception 'Exact approved processing policies required' using errcode='PT403';end if;
 select * into t from clinical_note_templates where id=j.template_id for share;
 if t.id is null or t.retired or t.approved_version is distinct from j.template_version or not exists(select 1 from clinical_note_template_versions where template_id=j.template_id and version=j.template_version and sha256=j.template_hash) then raise exception 'Exact approved template required' using errcode='PT409';end if;
 select * into a from clinical_call_capture_actions where id=s.capture_id;
 if a.id is null or a.state<>'completed' or a.source_id is distinct from s.id or a.binding is distinct from s.context
 or a.result_hash is distinct from public.clinical_recap_hash(s.document)
 or (a.request->>'pet_id')::uuid is distinct from j.pet_id or (a.request->>'encounter_id')::uuid is distinct from j.encounter_id then raise exception 'Canonical completed capture required' using errcode='PT409';end if;
 -- Acceptance obtains the destination's write lock before any patient/source locks.
 if p_accept then perform 1 from clinical_encounters where id=j.encounter_id for update;end if;
 select version into pet_version from pets where id=j.pet_id;
 actual:=public.clinical_call_binding(jsonb_build_object('pet_id',j.pet_id,'expected_pet_version',pet_version,'encounter_id',j.encounter_id,'expected_encounter_version',j.expected_version,'inbound_id',a.request->'inbound_id','expected_inbound_version',s.context->'inbound_version','policy_version',s.policy_version,'attest_authorized',true));
 if actual is distinct from s.context then raise exception 'Frozen call assignment or original event times changed' using errcode='PT409';end if;
 perform public.clinical_call_validate_document(s.document,s.call_id);
 if p_accept then perform public.clinical_call_actor(auth.uid());else perform public.clinical_call_worker_actor(j.actor_id,j.session_id);end if;
end $$;

-- Private view is callable only after an explicit reader/worker guard. Never grant it.
create function public.clinical_call_note_view_v1(j public.clinical_note_jobs) returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
 'contract_version','clinical-call-note-processing-v1','job',to_jsonb(j)-array['session_id','intent'],
 'attempts',coalesce((select jsonb_agg(to_jsonb(a)-array['session_id','result'] order by a.created_at desc,a.id desc) from clinical_note_attempts a where a.job_id=j.id),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from(select * from clinical_note_events where job_id=j.id order by created_at desc,id desc limit 100)e),'[]'::jsonb),
 'events_has_more',(select count(*)>100 from clinical_note_events where job_id=j.id),
 'proposal',(select to_jsonb(p) from clinical_dictation_proposals p where p.id=j.proposal_id),
 'generation',(select to_jsonb(g) from clinical_note_generations g where g.job_id=j.id),
 'review',(select to_jsonb(r) from clinical_dictation_reviews r where r.proposal_id=j.proposal_id),
 'source',(select to_jsonb(s) from clinical_call_sources s where s.id=b.call_source_id),'binding',to_jsonb(b),
 'template',(select jsonb_build_object('id',t.id,'version',v.version,'definition',v.definition,'sha256',v.sha256,'status',case when t.retired then 'retired' when t.approved_version=v.version then 'approved' else 'draft' end) from clinical_note_templates t join clinical_note_template_versions v on v.template_id=t.id where t.id=j.template_id and v.version=j.template_version),
 'patient',(select jsonb_build_object('id',p.id,'name',p.name,'species',p.species) from pets p where p.id=j.pet_id),
 'note_policy',to_jsonb(public.clinical_note_current_policy()),'call_generation_policy',public.clinical_call_note_policy_v1(),'capture_policy',public.clinical_call_current_policy())
 from clinical_call_note_bindings b where b.job_id=j.id
$$;
create function public.read_clinical_call_note_processing_v1(p_actor_id uuid,p_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;begin
 perform public.clinical_call_actor(p_actor_id);select * into j from clinical_note_jobs where id=p_id for share;
 perform public.clinical_call_note_history_v1(j);perform public.clinical_call_actor(p_actor_id);return public.clinical_call_note_view_v1(j);
end $$;
create function public.read_clinical_call_note_workspace_v1(p_actor_id uuid,p_pet_id uuid,p_encounter_id uuid,p_source_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s clinical_call_sources;items jsonb;begin
 perform public.clinical_call_actor(p_actor_id);select * into s from clinical_call_sources where id=p_source_id and pet_id=p_pet_id and encounter_id=p_encounter_id;
 if s.id is null then raise exception 'Exact source patient and encounter required' using errcode='PT404';end if;
 perform public.clinical_call_source_access(s);
 select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'actor_id',j.actor_id,'created_at',j.created_at,'proposal_id',j.proposal_id) order by j.created_at desc,j.id desc),'[]'::jsonb) into items
 from (select n.id,n.actor_id,n.created_at,n.proposal_id from clinical_note_jobs n join clinical_call_note_bindings b on b.job_id=n.id where n.source_kind='call_transcript' and n.pet_id=p_pet_id and n.encounter_id=p_encounter_id and b.call_source_id=s.id order by n.created_at desc,n.id desc limit 11)j;
 perform public.clinical_call_actor(p_actor_id);
 return jsonb_build_object('jobs',(select coalesce(jsonb_agg(value order by n),'[]'::jsonb) from jsonb_array_elements(items) with ordinality x(value,n) where n<=10),'has_more',jsonb_array_length(items)>10,'templates',public.clinical_note_template_list(),'note_policy',to_jsonb(public.clinical_note_current_policy()),'call_generation_policy',public.clinical_call_note_policy_v1(),'capture_policy',public.clinical_call_current_policy());
end $$;

create function public.reserve_clinical_call_note_v1(p_actor_id uuid,p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;s clinical_call_sources;c clinical_note_reservation_cancellations;begin
 perform public.clinical_call_actor(p_actor_id);
 if p_id is null or current_setting('transaction_isolation')<>'read committed' then raise exception 'Exact reservation and READ COMMITTED required' using errcode='PT422';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-note-actor:'||p_actor_id,0));
 perform pg_advisory_xact_lock(hashtextextended('clinical-note:'||p_id,0));perform public.clinical_call_actor(p_actor_id);
 select * into c from clinical_note_reservation_cancellations where id=p_id;if found then raise exception 'Reservation durably cancelled' using errcode='PT409';end if;
 select * into j from clinical_note_jobs where id=p_id for update;
 if found then
  if j.actor_id<>p_actor_id or j.intent is distinct from p_request then raise exception 'Reservation identity conflict' using errcode='PT409';end if;
  perform public.clinical_call_note_history_v1(j);perform public.clinical_call_actor(p_actor_id);return public.clinical_call_note_view_v1(j);
 end if;
 perform public.clinical_recap_keys(p_request,array['source_id','expected_version','template_id','template_version','template_hash','note_policy_version','call_generation_policy_version','attest_authorized']);
 perform public.clinical_recap_uuid(p_request->'source_id');perform public.clinical_recap_uuid(p_request->'template_id');
 perform public.clinical_recap_integer(p_request->'expected_version',1,2147483646);perform public.clinical_recap_integer(p_request->'template_version',1,2147483646);
 perform public.clinical_recap_integer(p_request->'note_policy_version',1,2147483646);perform public.clinical_recap_integer(p_request->'call_generation_policy_version',1,2147483646);
 if jsonb_typeof(p_request->'template_hash') is distinct from 'string' or p_request->>'template_hash'!~'^[a-f0-9]{64}$' or p_request->'attest_authorized' is distinct from 'true'::jsonb then raise exception 'Exact authorized template selection required' using errcode='PT422';end if;
 select * into s from clinical_call_sources where id=(p_request->>'source_id')::uuid;if s.id is null then raise exception 'Retained source missing' using errcode='PT404';end if;
 -- Share the existing typed/audio reservation budget under the same actor lock.
 if (select count(*) from clinical_note_jobs where actor_id=p_actor_id and created_at>clock_timestamp()-interval '1 hour')>=12
 or (select count(*) from clinical_note_jobs where actor_id=p_actor_id and created_at>clock_timestamp()-interval '1 day')>=100 then raise exception 'Note generation reservation limit reached' using errcode='PT409';end if;
 insert into clinical_note_jobs(id,actor_id,session_id,pet_id,encounter_id,expected_version,policy_version,template_id,template_version,template_hash,source_kind,source_text,source_sha256,source_note,intent)
 values(p_id,p_actor_id,public.next_visit_review_session(),s.pet_id,s.encounter_id,(p_request->>'expected_version')::integer,(p_request->>'note_policy_version')::integer,(p_request->>'template_id')::uuid,(p_request->>'template_version')::integer,p_request->>'template_hash','call_transcript',s.document->>'projection',encode(extensions.digest(convert_to(s.document->>'projection','UTF8'),'sha256'),'hex'),'Private call-derived clinical draft; explicit review required.',p_request) returning * into j;
 insert into clinical_call_note_bindings(job_id,call_source_id,call_source_sha256,source_capture_policy_version,call_generation_policy_version) values(j.id,s.id,s.sha256,s.policy_version,(p_request->>'call_generation_policy_version')::integer);
 perform public.clinical_call_note_guard_v1(j);perform public.clinical_call_actor(p_actor_id);
 insert into clinical_note_events(job_id,actor_id,kind,details) values(j.id,p_actor_id,'reserved',jsonb_build_object('source_kind','call_transcript','source_sha256',j.source_sha256,'template_hash',j.template_hash));
 return public.clinical_call_note_view_v1(j);
end $$;
create function public.cancel_clinical_call_note_reservation_v1(p_actor_id uuid,p_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;c clinical_note_reservation_cancellations;begin
 perform public.clinical_call_actor(p_actor_id);if p_id is null then raise exception 'Reservation identity required' using errcode='PT422';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-note-actor:'||p_actor_id,0));perform pg_advisory_xact_lock(hashtextextended('clinical-note:'||p_id,0));perform public.clinical_call_actor(p_actor_id);
 select * into j from clinical_note_jobs where id=p_id for update;
 if found then
  if j.actor_id<>p_actor_id then raise exception 'Owned reservation required' using errcode='PT403';end if;
  perform public.clinical_call_note_history_v1(j);perform public.clinical_call_actor(p_actor_id);return jsonb_build_object('cancelled',false,'job',public.clinical_call_note_view_v1(j));
 end if;
 select * into c from clinical_note_reservation_cancellations where id=p_id;
 if found and c.actor_id<>p_actor_id then raise exception 'Owned cancellation required' using errcode='PT403';end if;
 if c.id is null then insert into clinical_note_reservation_cancellations(id,actor_id,session_id) values(p_id,p_actor_id,public.next_visit_review_session());end if;
 return jsonb_build_object('cancelled',true,'job',null);
end $$;

-- JSON.stringify-equivalent byte accounting without JSONB's formatting spaces.
create function public.clinical_call_note_json_bytes_v1(v jsonb) returns integer language plpgsql immutable set search_path=public,pg_temp as $$
declare n integer:=2;k text;x jsonb;items integer:=0;begin
 if jsonb_typeof(v)='object' then
  for k,x in select * from jsonb_each(v) loop items:=items+1;n:=n+octet_length(convert_to(to_jsonb(k)::text,'UTF8'))+1+public.clinical_call_note_json_bytes_v1(x);end loop;
 elsif jsonb_typeof(v)='array' then
  for x in select value from jsonb_array_elements(v) loop items:=items+1;n:=n+public.clinical_call_note_json_bytes_v1(x);end loop;
 else return octet_length(convert_to(v::text,'UTF8'));
 end if;
 return n+greatest(0,items-1);
end $$;

-- Browser/provider offsets are UTF-16 units; PostgreSQL substring counts codepoints.
-- Reject either endpoint inside an astral character, rather than silently shifting evidence.
create function public.clinical_call_note_excerpt_v1(s text,p_from integer,p_to integer) returns text language plpgsql immutable set search_path=public,pg_temp as $$
declare i integer;units integer:=0;step integer;first_cp integer;last_cp integer;begin
 if s is null or p_from is null or p_to is null or p_from<0 or p_to<=p_from or p_to>60000 then raise exception 'Bounded nonempty UTF16 range required' using errcode='PT422';end if;
 for i in 1..length(s) loop
  if units=p_from then first_cp:=i;end if;
  step:=case when ascii(substr(s,i,1))>65535 then 2 else 1 end;
  if (p_from>units and p_from<units+step) or (p_to>units and p_to<units+step) then raise exception 'Excerpt splits a UTF16 surrogate pair' using errcode='PT422';end if;
  units:=units+step;
  if units=p_to then last_cp:=i;exit;end if;
 end loop;
 if first_cp is null or last_cp is null then raise exception 'Excerpt outside retained segment' using errcode='PT422';end if;
 return substr(s,first_cp,last_cp-first_cp+1);
end $$;

create function public.clinical_call_note_assemble_v1(d jsonb,doc jsonb,payload jsonb) returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare f jsonb;pin jsonb;claim jsonb;support jsonb;segment jsonb;flag jsonb;idx integer:=0;claims integer:=0;supports integer:=0;eligible integer:=0;
 counts jsonb:='{"subjective":0,"objective":0,"assessment":0,"plan":0}';dest text;status text;seen text[];key text;piece text;quote text;section jsonb;
 result jsonb:='{"subjective":{"text":"","quote":""},"objective":{"text":"","quote":""},"assessment":{"text":"","quote":""},"plan":{"text":"","quote":""}}';begin
 perform public.clinical_note_validate_template(d);
 perform public.clinical_recap_keys(payload,array['contract_version','fields','review_flags']);
 if payload->>'contract_version' is distinct from 'clinical-call-note-payload-v1'
 or jsonb_typeof(payload->'fields') is distinct from 'array' or jsonb_array_length(payload->'fields')<>jsonb_array_length(d->'fields')
 or jsonb_typeof(payload->'review_flags') is distinct from 'array' or jsonb_array_length(payload->'review_flags')>10
 or public.clinical_call_note_json_bytes_v1(payload)>256000 then raise exception 'Bounded pinned call payload required' using errcode='PT422';end if;
 for flag in select value from jsonb_array_elements(payload->'review_flags') loop
  if not coalesce(public.clinical_recap_text(flag,500),false) then raise exception 'Bounded review flag required' using errcode='PT422';end if;
 end loop;
 for f in select value from jsonb_array_elements(payload->'fields') loop
  pin:=d->'fields'->idx;idx:=idx+1;dest:=pin->>'destination';piece:='';quote:='';
  perform public.clinical_recap_keys(f,array['field_id','status','claims','uncertainty']);status:=f->>'status';
  if f->>'field_id' is distinct from pin->>'id' or jsonb_typeof(f->'status') is distinct from 'string' or status not in('supported','missing','uncertain')
  or jsonb_typeof(f->'claims') is distinct from 'array' or jsonb_array_length(f->'claims')>24
  or jsonb_typeof(f->'uncertainty') is distinct from 'string' or public.clinical_note_text_length(f->>'uncertainty')>500 then raise exception 'Exact pinned field order and status required' using errcode='PT422';end if;
  if (status='missing' and(jsonb_array_length(f->'claims')<>0 or f->>'uncertainty'<>''))
  or(status<>'missing' and(jsonb_array_length(f->'claims')=0 or(status='supported' and f->>'uncertainty'<>'')or(status='uncertain' and not public.clinical_note_nonblank(f->>'uncertainty')))) then raise exception 'Call field evidence and status differ' using errcode='PT422';end if;
  claims:=claims+jsonb_array_length(f->'claims');counts:=jsonb_set(counts,array[dest],to_jsonb((counts->>dest)::integer+jsonb_array_length(f->'claims')));
  for claim in select value from jsonb_array_elements(f->'claims') loop
   perform public.clinical_recap_keys(claim,array['text','patient_scope','supports']);
   if not coalesce(public.clinical_recap_text(claim->'text',500),false) or jsonb_typeof(claim->'patient_scope') is distinct from 'string' or claim->>'patient_scope' not in('selected_patient','other_patient','unassigned')
   or jsonb_typeof(claim->'supports') is distinct from 'array' or jsonb_array_length(claim->'supports') not between 1 and 8 then raise exception 'Scoped supported clinical claim required' using errcode='PT422';end if;
   seen:=array[]::text[];
   for support in select value from jsonb_array_elements(claim->'supports') loop
    supports:=supports+1;perform public.clinical_recap_keys(support,array['segment_ordinal','segment_sha256','from','to','quote']);
    segment:=doc->'segments'->(public.clinical_recap_integer(support->'segment_ordinal',1,1000)-1);
    if segment is null or support->>'segment_sha256' is distinct from segment->>'text_sha256' or not coalesce(public.clinical_recap_text(support->'quote',1000),false)
    or public.clinical_call_note_excerpt_v1(segment->>'text',public.clinical_recap_integer(support->'from',0,60000),public.clinical_recap_integer(support->'to',1,60000)) is distinct from support->>'quote' then raise exception 'Exact retained segment support required' using errcode='PT422';end if;
    key:=(support->>'segment_ordinal')||':'||(support->>'from')||':'||(support->>'to');
    if key=any(seen) then raise exception 'Duplicate support range' using errcode='PT422';end if;seen:=array_append(seen,key);
   end loop;
   if claim->>'patient_scope'='selected_patient' then
    eligible:=eligible+1;piece:=piece||case when piece='' then '' else chr(10) end||(claim->>'text');
    if quote='' then quote:=claim->'supports'->0->>'quote';end if;
   end if;
  end loop;
  if piece<>'' then
   section:=result->dest;
   piece:=(section->>'text')||case when section->>'text'='' then '' else chr(10)||chr(10) end||(pin->>'label')||':'||chr(10)||piece;
   if public.clinical_note_text_length(piece)>50000 then raise exception 'Proposed SOAP section budget exceeded' using errcode='PT422';end if;
   result:=jsonb_set(result,array[dest],jsonb_build_object('text',piece,'quote',case when section->>'quote'='' then quote else section->>'quote' end));
  end if;
 end loop;
 if claims>96 or supports>192 or eligible=0 or exists(select 1 from jsonb_each_text(counts) where value::integer>24) then raise exception 'Call evidence budget exceeded or no selected patient claims' using errcode='PT422';end if;
 return result;
end $$;

create function public.finish_clinical_call_note_v1(p_job_id uuid,p_attempt_id uuid,p_result jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;a clinical_note_attempts;b clinical_call_note_bindings;s clinical_call_sources;v clinical_note_template_versions;hash text;sections jsonb;vc jsonb;k text;owner_id uuid;begin
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
 perform public.clinical_recap_keys(p_result,array['request_id','contract_version','prompt_version','response_id','requested_model','provider_model','job_id','source_id','source_manifest_sha256','projection_sha256','source_capture_policy_version','call_generation_policy_version','note_policy_version','template_id','template_version','template_sha256','veterinary_context','payload']);
 foreach k in array array['request_id','response_id','provider_model'] loop
  if jsonb_typeof(p_result->k) is distinct from 'string' or public.clinical_note_text_length(p_result->>k)>200 then raise exception 'Bounded provider identifiers required' using errcode='PT422';end if;
 end loop;
 if not public.clinical_note_nonblank(p_result->>'response_id') or p_result->>'contract_version' is distinct from 'clinical-call-note-result-v1' or p_result->>'prompt_version' is distinct from 'lrv-call-note-fields-v1'
 or p_result->>'requested_model' is distinct from a.model or p_result->'job_id' is distinct from to_jsonb(j.id) or p_result->'source_id' is distinct from to_jsonb(s.id)
 or p_result->>'source_manifest_sha256' is distinct from s.sha256 or p_result->>'projection_sha256' is distinct from j.source_sha256
 or p_result->'source_capture_policy_version' is distinct from to_jsonb(b.source_capture_policy_version)
 or p_result->'call_generation_policy_version' is distinct from to_jsonb(b.call_generation_policy_version) or p_result->'note_policy_version' is distinct from to_jsonb(j.policy_version)
 or p_result->'template_id' is distinct from to_jsonb(j.template_id) or p_result->'template_version' is distinct from to_jsonb(j.template_version) or p_result->>'template_sha256' is distinct from j.template_hash then raise exception 'Pinned call result manifest required' using errcode='PT422';end if;
 vc:=p_result->'veterinary_context';perform public.clinical_recap_keys(vc,array['version','bundle_sha256','request_sha256']);
 if jsonb_typeof(vc->'version') is distinct from 'string' or vc->>'version'!~'^lrv-vet-en-v[1-9][0-9]{0,3}$'
 or jsonb_typeof(vc->'bundle_sha256') is distinct from 'string' or vc->>'bundle_sha256'!~'^[a-f0-9]{64}$'
 or jsonb_typeof(vc->'request_sha256') is distinct from 'string' or vc->>'request_sha256'!~'^[a-f0-9]{64}$' then raise exception 'Veterinary context receipt required' using errcode='PT422';end if;
 select * into v from clinical_note_template_versions where template_id=j.template_id and version=j.template_version;
 sections:=public.clinical_call_note_assemble_v1(v.definition,s.document,p_result->'payload');
 perform public.clinical_call_worker_actor(a.actor_id,a.session_id);
 insert into clinical_dictation_proposals(id,pet_id,encounter_id,expected_version,actor_id,actor_name,transcript,source_hash,source_note,attest_authorized,sections)
 values(a.id,j.pet_id,j.encounter_id,j.expected_version,a.actor_id,(select case when public.clinical_note_text_length(btrim(full_name)) between 1 and 200 then btrim(full_name) else 'Staff member' end from profiles where id=a.actor_id),j.source_text,j.source_sha256,'Private OpenAI call-derived proposal. Evidence and other-pet claims require separate clinical review.',true,sections);
 insert into clinical_note_generations(proposal_id,job_id,attempt_id,template_snapshot,source_sha256,payload,manifest) values(a.id,j.id,a.id,jsonb_build_object('id',j.template_id,'version',j.template_version,'definition',v.definition,'sha256',v.sha256),j.source_sha256,p_result->'payload',p_result-'payload');
 update clinical_note_jobs set proposal_id=a.id where id=j.id returning * into j;
 update clinical_note_attempts set state='completed',result=p_result,result_hash=hash,provider_request_id=p_result->>'request_id',finished_at=clock_timestamp() where id=a.id;
 insert into clinical_note_events(job_id,attempt_id,actor_id,kind,details) values(j.id,a.id,a.actor_id,'completed',jsonb_build_object('result_hash',hash));
 return public.clinical_call_note_view_v1(j);
end $$;

-- All review mutation/recovery/cancel paths share job-before-action ordering.
-- The stored journal binds the source; caller-supplied IDs can never redirect recovery.
create function public.clinical_call_note_review_lock_v1(p_actor uuid,p_action uuid,p_job uuid) returns public.clinical_note_jobs language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;a clinical_call_note_actions;owner_id uuid;begin
 perform public.clinical_call_actor(p_actor);
 if p_action is null or p_job is null or current_setting('transaction_isolation')<>'read committed' then raise exception 'Exact review identity and READ COMMITTED required' using errcode='PT422';end if;
 select * into a from clinical_call_note_actions where id=p_action;
 if found and(a.actor_id<>p_actor or a.kind<>'review' or a.job_id<>p_job) then raise exception 'Private review action unavailable' using errcode='PT403';end if;
 select actor_id into owner_id from clinical_note_jobs where id=coalesce(a.job_id,p_job);
 perform pg_advisory_xact_lock(hashtextextended('clinical-note-actor:'||owner_id,0));
 select * into j from clinical_note_jobs where id=coalesce(a.job_id,p_job) for update;
 perform pg_advisory_xact_lock(hashtextextended('clinical-call-note-action:'||p_action,0));
 perform public.clinical_call_actor(p_actor);
 select * into a from clinical_call_note_actions where id=p_action;
 if found and(a.actor_id<>p_actor or a.kind<>'review' or a.job_id<>j.id) then raise exception 'Private review action unavailable' using errcode='PT403';end if;
 if j.id is null or j.source_kind<>'call_transcript' then raise exception 'Private call job missing' using errcode='PT404';end if;
 return j;
end $$;
create function public.recover_clinical_call_note_review_v1(p_actor_id uuid,p_id uuid,p_job_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;a clinical_call_note_actions;begin
 j:=public.clinical_call_note_review_lock_v1(p_actor_id,p_id,p_job_id);
 perform public.clinical_call_note_history_v1(j);perform public.clinical_call_actor(p_actor_id);
 select * into a from clinical_call_note_actions where id=p_id;return a.receipt;
end $$;
create function public.cancel_clinical_call_note_review_v1(p_actor_id uuid,p_id uuid,p_job_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;a clinical_call_note_actions;begin
 j:=public.clinical_call_note_review_lock_v1(p_actor_id,p_id,p_job_id);
 perform public.clinical_call_note_history_v1(j);perform public.clinical_call_actor(p_actor_id);
 select * into a from clinical_call_note_actions where id=p_id;
 if found then return jsonb_build_object('cancelled',a.cancelled,'receipt',a.receipt);end if;
 insert into clinical_call_note_actions(id,actor_id,session_id,kind,job_id,cancelled) values(p_id,p_actor_id,public.next_visit_review_session(),'review',j.id,true);
 return jsonb_build_object('cancelled',true,'receipt',null);
end $$;
create function public.save_clinical_call_note_review_v1(p_actor_id uuid,p_id uuid,p_job_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;a clinical_call_note_actions;p clinical_dictation_proposals;r clinical_dictation_reviews;e clinical_encounters;selected jsonb;decision text;k text;v jsonb;receipt jsonb;begin
 j:=public.clinical_call_note_review_lock_v1(p_actor_id,p_id,p_job_id);
 select * into a from clinical_call_note_actions where id=p_id;
 if found then
  perform public.clinical_call_note_history_v1(j);perform public.clinical_call_actor(p_actor_id);
  if a.cancelled or a.request is distinct from p_request then raise exception 'Review action conflict' using errcode='PT409';end if;
  return a.receipt;
 end if;
 perform public.clinical_recap_keys(p_request,array['proposal_id','decision','accepted_sections','review_note','attest_reviewed','expected_version']);
 perform public.clinical_recap_uuid(p_request->'proposal_id');
 if j.proposal_id is distinct from (p_request->>'proposal_id')::uuid or public.clinical_recap_integer(p_request->'expected_version',1,2147483646)<>j.expected_version then raise exception 'Exact source-bound proposal required' using errcode='PT422';end if;
 decision:=p_request->>'decision';selected:=p_request->'accepted_sections';
 if jsonb_typeof(p_request->'decision') is distinct from 'string' or decision not in('accepted','rejected') or jsonb_typeof(selected) is distinct from 'object'
 or jsonb_typeof(p_request->'review_note') is distinct from 'string' or public.clinical_note_text_length(p_request->>'review_note')>2000
 or p_request->'attest_reviewed' is distinct from 'true'::jsonb then raise exception 'Explicit bounded review required' using errcode='PT422';end if;
 -- Do not acquire source history locks before this live guard and destination write lock.
 if decision='accepted' then perform public.clinical_call_note_guard_v1(j,true);
 else perform public.clinical_call_note_history_v1(j);end if;
 perform public.clinical_call_actor(p_actor_id);
 select * into p from clinical_dictation_proposals where id=j.proposal_id and pet_id=j.pet_id and encounter_id=j.encounter_id and expected_version=j.expected_version;
 if p.id is null or not exists(select 1 from clinical_note_generations where job_id=j.id and proposal_id=p.id) then raise exception 'Retained generated proposal required' using errcode='PT404';end if;
 if exists(select 1 from clinical_dictation_reviews where proposal_id=p.id) then raise exception 'Proposal already reviewed; read retained history' using errcode='PT409';end if;
 if decision='accepted' then
  select * into e from clinical_encounters where id=j.encounter_id for update;
  if e.id is null or e.pet_id<>j.pet_id or e.status<>'draft' or e.version<>j.expected_version or selected='{}'::jsonb then raise exception 'Exact unsigned destination and selected sections required' using errcode='PT409';end if;
  for k,v in select * from jsonb_each(selected) loop
   if k not in('subjective','objective','assessment','plan') or not coalesce(public.clinical_recap_text(v,50000),false) or coalesce(p.sections->k->>'text','')='' then raise exception 'Only proposed nonempty clinical sections may be accepted' using errcode='PT422';end if;
  end loop;
  perform public.clinical_call_actor(p_actor_id);
  e:=public.save_clinical_encounter(e.id,e.pet_id,e.version,e.visit_at,e.visit_type,e.location,coalesce(selected->>'subjective',e.subjective),coalesce(selected->>'objective',e.objective),coalesce(selected->>'assessment',e.assessment),coalesce(selected->>'plan',e.plan));
 elsif selected<>'{}'::jsonb or not public.clinical_note_nonblank(p_request->>'review_note') then raise exception 'Rejection requires a reason and no chart changes' using errcode='PT422';end if;
 perform public.clinical_call_actor(p_actor_id);
 insert into clinical_dictation_reviews(id,proposal_id,actor_id,actor_name,decision,accepted_sections,review_note,attest_reviewed,encounter_version)
 values(p_id,p.id,p_actor_id,(select case when public.clinical_note_text_length(btrim(full_name)) between 1 and 200 then btrim(full_name) else 'Staff member' end from profiles where id=p_actor_id),decision,selected,p_request->>'review_note',true,case when decision='accepted' then e.version end) returning * into r;
 receipt:=jsonb_build_object('review',to_jsonb(r),'encounter',case when decision='accepted' then to_jsonb(e) else null end,'proposal_id',p.id,'job_id',j.id);
 insert into clinical_call_note_actions(id,actor_id,session_id,kind,job_id,cancelled,request,receipt) values(p_id,p_actor_id,public.next_visit_review_session(),'review',j.id,false,p_request,receipt);
 return receipt;
end $$;

-- Explicit allowlists preserve every pre-existing owner and ACL, including PR 272's guards.
do $$declare f record;begin
 for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname=any(array[
 'clinical_call_note_policy_v1','read_clinical_call_note_policy_v1','save_clinical_call_note_policy_v1','recover_clinical_call_note_policy_v1','cancel_clinical_call_note_policy_v1',
 'clinical_call_note_history_v1','clinical_call_note_guard_v1','clinical_call_note_view_v1','read_clinical_call_note_processing_v1','read_clinical_call_note_workspace_v1',
 'reserve_clinical_call_note_v1','cancel_clinical_call_note_reservation_v1','claim_clinical_call_note_v1','cancel_clinical_call_note_attempt_v1',
 'dispatch_clinical_call_note_v1','fail_clinical_call_note_v1','finish_clinical_call_note_v1','clinical_call_note_json_bytes_v1','clinical_call_note_excerpt_v1','clinical_call_note_assemble_v1',
 'clinical_call_note_review_lock_v1','recover_clinical_call_note_review_v1','cancel_clinical_call_note_review_v1','save_clinical_call_note_review_v1']) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.oid::regprocedure);
  if f.proname=any(array['read_clinical_call_note_policy_v1','save_clinical_call_note_policy_v1','recover_clinical_call_note_policy_v1','cancel_clinical_call_note_policy_v1','read_clinical_call_note_processing_v1','read_clinical_call_note_workspace_v1','reserve_clinical_call_note_v1','cancel_clinical_call_note_reservation_v1','claim_clinical_call_note_v1','cancel_clinical_call_note_attempt_v1','recover_clinical_call_note_review_v1','cancel_clinical_call_note_review_v1','save_clinical_call_note_review_v1']) then execute format('grant execute on function %s to authenticated',f.oid::regprocedure);end if;
  if f.proname=any(array['dispatch_clinical_call_note_v1','fail_clinical_call_note_v1','finish_clinical_call_note_v1']) then execute format('grant execute on function %s to service_role',f.oid::regprocedure);end if;
 end loop;
end $$;
