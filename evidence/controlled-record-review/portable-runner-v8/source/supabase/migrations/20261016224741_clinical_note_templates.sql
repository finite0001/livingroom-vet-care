-- Independent versioned note generation; legacy audio and reviewed SOAP contracts remain unchanged.
-- Match JavaScript/Zod UTF-16 string bounds without changing existing clinical contracts.
create function public.clinical_note_text_length(p_text text)returns integer language sql immutable strict set search_path=pg_catalog,pg_temp as $$
 select length(p_text)+regexp_count(p_text,U&'[\+010000-\+10FFFF]')
$$;
-- ECMAScript String.trim whitespace; preserve the original string and reject only blank content.
create function public.clinical_note_nonblank(p_text text)returns boolean language sql immutable strict set search_path=pg_catalog,pg_temp as $$
 select btrim(p_text,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')<>''
$$;
create table public.clinical_note_templates(
 id uuid primary key,revision integer not null default 1 check(revision>0),latest_version integer not null check(latest_version>0),
 approved_version integer,retired boolean not null default false,created_at timestamptz not null default clock_timestamp()
);
create table public.clinical_note_template_versions(
 template_id uuid not null references public.clinical_note_templates(id),version integer not null check(version>0),
 definition jsonb not null,sha256 text not null check(sha256~'^[a-f0-9]{64}$'),actor_id uuid references auth.users(id),session_id uuid,
 created_at timestamptz not null default clock_timestamp(),primary key(template_id,version),check((actor_id is null)=(session_id is null))
);
create table public.clinical_note_policies(
 version integer primary key check(version>0),status text not null check(status in('draft','approved')),
 consent_text text not null check(public.clinical_note_text_length(consent_text)between 1 and 4000 and public.clinical_note_nonblank(consent_text)),soap_model text not null check(soap_model='gpt-6-luna'),
 reviewed_by uuid references auth.users(id),reviewed_at timestamptz,created_at timestamptz not null default clock_timestamp(),
 check((status='draft'and reviewed_by is null and reviewed_at is null)or(status='approved'and reviewed_by is not null and reviewed_at is not null))
);
create table public.clinical_note_configuration_actions(
 id uuid primary key,actor_id uuid not null references auth.users(id),session_id uuid not null,operation text not null,request jsonb not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create table public.clinical_note_jobs(
 id uuid primary key,actor_id uuid not null references auth.users(id),session_id uuid not null,
 pet_id uuid not null references public.pets(id),encounter_id uuid not null references public.clinical_encounters(id),expected_version integer not null check(expected_version>0),
 policy_version integer not null references public.clinical_note_policies(version),template_id uuid not null,template_version integer not null,template_hash text not null check(template_hash~'^[a-f0-9]{64}$'),
 source_kind text not null check(source_kind in('typed','audio_transcript')),source_text text not null check(public.clinical_note_text_length(source_text)between 1 and 60000 and public.clinical_note_nonblank(source_text)),source_sha256 text not null check(source_sha256~'^[a-f0-9]{64}$'),
 audio_job_id uuid references public.clinical_audio_jobs(id),source_audio_policy_version integer references public.clinical_audio_policies(version),source_note text not null check(public.clinical_note_text_length(source_note)between 1 and 1000),
 intent jsonb not null,proposal_id uuid unique references public.clinical_dictation_proposals(id),created_at timestamptz not null default clock_timestamp(),
 foreign key(template_id,template_version)references public.clinical_note_template_versions(template_id,version),
 check((source_kind='typed'and audio_job_id is null and source_audio_policy_version is null)or(source_kind='audio_transcript'and audio_job_id is not null and source_audio_policy_version is not null))
);
create table public.clinical_note_reservation_cancellations(
 id uuid primary key,actor_id uuid not null references auth.users(id),session_id uuid not null,created_at timestamptz not null default clock_timestamp()
);
create index clinical_note_jobs_encounter on public.clinical_note_jobs(encounter_id,created_at desc,id desc);
create table public.clinical_note_attempts(
 id uuid primary key,job_id uuid not null references public.clinical_note_jobs(id),actor_id uuid not null references auth.users(id),session_id uuid not null,
 model text not null,state text not null check(state in('claimed','sending','completed','failed','uncertain','superseded')),intent jsonb not null,lease_until timestamptz not null,
 result jsonb,result_hash text,error_code text,failure_details jsonb,provider_request_id text,created_at timestamptz not null default clock_timestamp(),finished_at timestamptz
);
create table public.clinical_note_attempt_cancellations(
 id uuid primary key,job_id uuid not null references public.clinical_note_jobs(id),actor_id uuid not null references auth.users(id),session_id uuid not null,
 intent jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index clinical_note_attempts_job on public.clinical_note_attempts(job_id,created_at desc,id desc);
create table public.clinical_note_events(
 id uuid primary key default gen_random_uuid(),job_id uuid not null references public.clinical_note_jobs(id),attempt_id uuid references public.clinical_note_attempts(id),
 actor_id uuid not null references auth.users(id),kind text not null,details jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create table public.clinical_note_generations(
 proposal_id uuid primary key references public.clinical_dictation_proposals(id),job_id uuid not null unique references public.clinical_note_jobs(id),attempt_id uuid not null unique references public.clinical_note_attempts(id),
 template_snapshot jsonb not null,source_sha256 text not null,payload jsonb not null,manifest jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create function public.clinical_note_row_guard()returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if TG_OP in('DELETE','TRUNCATE')then raise exception 'Clinical note history cannot be removed'using errcode='23514';end if;
 if TG_TABLE_NAME='clinical_note_jobs'then
  if(to_jsonb(new)-'proposal_id')is distinct from(to_jsonb(old)-'proposal_id')or(old.proposal_id is not null and new.proposal_id is distinct from old.proposal_id)then raise exception 'Clinical note source is immutable'using errcode='23514';end if;
 elsif TG_TABLE_NAME='clinical_note_attempts'then
  if(to_jsonb(new)-array['state','lease_until','result','result_hash','error_code','failure_details','provider_request_id','finished_at'])is distinct from(to_jsonb(old)-array['state','lease_until','result','result_hash','error_code','failure_details','provider_request_id','finished_at'])then raise exception 'Clinical note attempt identity is immutable'using errcode='23514';end if;
 else
  if new.id<>old.id or new.created_at<>old.created_at or new.revision<>old.revision+1 then raise exception 'Template revision must advance once'using errcode='23514';end if;
 end if;return new;
end $$;
do $$declare t text;begin
 foreach t in array array['clinical_note_templates','clinical_note_template_versions','clinical_note_policies','clinical_note_configuration_actions','clinical_note_jobs','clinical_note_attempts','clinical_note_events','clinical_note_generations','clinical_note_reservation_cancellations','clinical_note_attempt_cancellations']loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 if t in('clinical_note_templates','clinical_note_jobs','clinical_note_attempts')then execute format('create trigger note_row_guard before update or delete on public.%I for each row execute function public.clinical_note_row_guard()',t);
 else execute format('create trigger note_immutable before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);end if;
 execute format('create trigger note_no_truncate before truncate on public.%I for each statement execute function public.native_correction_immutable()',t);
 end loop;
end $$;
create function public.clinical_note_validate_template(d jsonb)returns void language plpgsql immutable set search_path=public,pg_temp as $$
declare f jsonb;ids text[]:='{}';n integer:=0;begin
 perform public.native_rx_keys(d,array['name','detail','fields']);
 if jsonb_typeof(d->'name')is distinct from'string'or public.clinical_note_text_length(d->>'name')not between 1 and 120 or not public.clinical_note_nonblank(d->>'name') or jsonb_typeof(d->'detail')is distinct from'string'or d->>'detail'not in('concise','standard','detailed')or jsonb_typeof(d->'fields')is distinct from'array'or jsonb_array_length(d->'fields')not between 1 and 48 then raise exception 'Bounded structured note template required'using errcode='23514';end if;
 for f in select value from jsonb_array_elements(d->'fields')loop
  perform public.native_rx_keys(f,array['id','label','destination','instructions','required']);
  if jsonb_typeof(f->'id')is distinct from'string'or f->>'id'!~'^[a-z][a-z0-9_]{0,47}$'or f->>'id'=any(ids)
   or jsonb_typeof(f->'label')is distinct from'string'or public.clinical_note_text_length(f->>'label')not between 1 and 120 or not public.clinical_note_nonblank(f->>'label')
   or jsonb_typeof(f->'destination')is distinct from'string'or f->>'destination'not in('subjective','objective','assessment','plan')
   or jsonb_typeof(f->'instructions')is distinct from'string'or public.clinical_note_text_length(f->>'instructions')>500 or jsonb_typeof(f->'required')is distinct from'boolean'
  then raise exception 'Unique bounded template fields required; no factual defaults'using errcode='23514';end if;
  ids:=array_append(ids,f->>'id');n:=n+public.clinical_note_text_length(f->>'instructions');
 end loop;
 if n>12000 then raise exception 'Template instruction budget exceeded'using errcode='23514';end if;
end $$;
insert into public.clinical_note_policies(version,status,consent_text,soap_model)values(1,'draft','Draft for Susan: authorize OpenAI processing of typed clinician observations into source-cited draft fields. Verify the saved patient, source attribution, provider retention and every proposed field. Audio transcripts additionally require the separately approved recording policy. No automatic normal findings, chart acceptance or signing.','gpt-6-luna');
do $$declare definition jsonb;field jsonb;fields jsonb:='[]';k text;begin
 foreach k in array array['subjective','objective','assessment','plan']loop fields:=fields||jsonb_build_array(jsonb_build_object('id',k,'label',initcap(k),'destination',k,'instructions','Use only explicitly supplied observations for this SOAP section. Preserve attribution, uncertainty and timing.','required',false));end loop;
 definition:=jsonb_build_object('name','Standard SOAP','detail','standard','fields',fields);
 insert into public.clinical_note_templates(id,latest_version,approved_version)values('e7000000-0000-4000-8000-000000000001',1,1);
 insert into public.clinical_note_template_versions(template_id,version,definition,sha256)values('e7000000-0000-4000-8000-000000000001',1,definition,encode(extensions.digest(convert_to(definition::text,'UTF8'),'sha256'),'hex'));
 fields:='[]';
 for field in select value from jsonb_array_elements('[{"id":"presenting","label":"Presenting for","destination":"subjective"},{"id":"edud","label":"E/D/U/D","destination":"subjective"},{"id":"csvd","label":"C/S/V/D","destination":"subjective"},{"id":"onset","label":"Onset","destination":"subjective"},{"id":"medical_history","label":"Medical history","destination":"subjective"},{"id":"diet_history","label":"Current diet","destination":"subjective"},{"id":"current_medications","label":"Current medications","destination":"subjective"},{"id":"preventatives","label":"Current preventatives","destination":"subjective"},{"id":"other_history","label":"Other history","destination":"subjective"},{"id":"appearance","label":"General appearance and behavior","destination":"objective"},{"id":"vitals","label":"Vitals","destination":"objective"},{"id":"hydration","label":"Hydration","destination":"objective"},{"id":"bcs","label":"BCS","destination":"objective"},{"id":"eyes","label":"Eyes","destination":"objective"},{"id":"ears","label":"Ears","destination":"objective"},{"id":"oral","label":"Oral cavity","destination":"objective"},{"id":"nasal","label":"Nasal cavity","destination":"objective"},{"id":"integument","label":"Integument","destination":"objective"},{"id":"lymph_nodes","label":"Lymph nodes","destination":"objective"},{"id":"cardiovascular","label":"Cardiovascular","destination":"objective"},{"id":"respiratory","label":"Respiratory","destination":"objective"},{"id":"abdomen","label":"Abdomen","destination":"objective"},{"id":"urogenital","label":"Urogenital","destination":"objective"},{"id":"musculoskeletal","label":"Musculoskeletal","destination":"objective"},{"id":"neurologic","label":"Neurologic","destination":"objective"},{"id":"rectal","label":"Rectal","destination":"objective"},{"id":"exam_notes","label":"Additional exam notes","destination":"objective"},{"id":"problems","label":"Problem list with differentials","destination":"assessment"},{"id":"discussion","label":"Owner discussion","destination":"plan"},{"id":"diagnostics","label":"Diagnostics","destination":"plan"},{"id":"treatments","label":"In-hospital treatments","destination":"plan"},{"id":"medications","label":"Medications","destination":"plan"},{"id":"vaccines","label":"Vaccines","destination":"plan"},{"id":"diet_plan","label":"Diet","destination":"plan"},{"id":"monitoring","label":"Monitoring","destination":"plan"},{"id":"follow_up","label":"Follow-up","destination":"plan"},{"id":"instructions","label":"Additional instructions","destination":"plan"},{"id":"prognosis","label":"Prognosis","destination":"plan"}]'::jsonb)loop
 fields:=fields||jsonb_build_array(field||jsonb_build_object('instructions','Use only explicit source evidence. Missing or unexamined findings remain missing; never supply default normal findings. Distinguish reported, historical, planned and performed information.','required',false));end loop;
 definition:=jsonb_build_object('name','Susan SOAP with physical exam — draft','detail','detailed','fields',fields);perform public.clinical_note_validate_template(definition);
 insert into public.clinical_note_templates(id,latest_version)values('e7000000-0000-4000-8000-000000000002',1);
 insert into public.clinical_note_template_versions(template_id,version,definition,sha256)values('e7000000-0000-4000-8000-000000000002',1,definition,encode(extensions.digest(convert_to(definition::text,'UTF8'),'sha256'),'hex'));
end $$;
create function public.clinical_note_current_policy()returns public.clinical_note_policies language sql stable security definer set search_path=public,pg_temp as $$select *from clinical_note_policies order by version desc limit 1$$;
create function public.clinical_note_template_list()returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'revision',t.revision,'latest_version',t.latest_version,'approved_version',t.approved_version,'retired',t.retired,
 'latest',(select jsonb_build_object('version',v.version,'definition',v.definition,'sha256',v.sha256)from clinical_note_template_versions v where v.template_id=t.id and v.version=t.latest_version),
 'approved',(select jsonb_build_object('version',v.version,'definition',v.definition,'sha256',v.sha256)from clinical_note_template_versions v where v.template_id=t.id and v.version=t.approved_version))order by t.created_at,t.id),'[]')from clinical_note_templates t
$$;
create function public.read_clinical_note_configuration(p_actor_id uuid)returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin perform public.clinical_dictation_actor(p_actor_id);return jsonb_build_object('actor_id',p_actor_id,'policy',to_jsonb(public.clinical_note_current_policy()),'templates',public.clinical_note_template_list());end $$;
create function public.recover_clinical_note_configuration(p_actor_id uuid,p_id uuid,p_operation text,p_request jsonb)returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare a clinical_note_configuration_actions;begin
 perform public.clinical_dictation_actor(p_actor_id);if not public.has_role(p_actor_id,'ADMIN')then raise exception 'Practice administrator required'using errcode='42501';end if;
 if p_id is null or p_operation is null or p_operation not in('create_template','save_template','approve_template','retire_template','policy')or jsonb_typeof(p_request)is distinct from'object'then raise exception 'Exact configuration action required'using errcode='23514';end if;
 select *into a from clinical_note_configuration_actions where id=p_id;if not found then return null;end if;
 if a.actor_id<>p_actor_id then raise exception 'Configuration action belongs to another operator'using errcode='42501';end if;
 if a.operation is distinct from p_operation or a.request is distinct from p_request then raise exception 'Configuration UUID belongs to different work'using errcode='23505';end if;return a.receipt;
end $$;
create function public.cancel_clinical_note_configuration(p_actor_id uuid,p_id uuid,p_operation text,p_request jsonb)returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare receipt jsonb;begin
 if current_setting('transaction_isolation')<>'read committed'then raise exception 'READ COMMITTED required'using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-note-configuration:'||p_id::text,0));receipt:=public.recover_clinical_note_configuration(p_actor_id,p_id,p_operation,p_request);if receipt is not null then return receipt;end if;
 receipt:=jsonb_build_object('cancelled',true);insert into clinical_note_configuration_actions(id,actor_id,session_id,operation,request,receipt)values(p_id,p_actor_id,public.next_visit_review_session(),p_operation,p_request,receipt);return receipt;
end $$;
create function public.save_clinical_note_configuration(p_actor_id uuid,p_id uuid,p_operation text,p_request jsonb)returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare receipt jsonb;t clinical_note_templates;v clinical_note_template_versions;p clinical_note_policies;tid uuid;ver integer;d jsonb;st text;template_found boolean;begin
 if current_setting('transaction_isolation')<>'read committed'then raise exception 'READ COMMITTED required'using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-note-configuration:'||p_id::text,0));receipt:=public.recover_clinical_note_configuration(p_actor_id,p_id,p_operation,p_request);if receipt is not null then
 if receipt->'cancelled'='true'::jsonb then raise exception 'Configuration action cancelled; start a new action'using errcode='PT409';end if;return receipt;end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-note-policy',0));
 perform public.clinical_dictation_actor(p_actor_id);if not public.has_role(p_actor_id,'ADMIN')then raise exception 'Practice administrator required after configuration lock'using errcode='42501';end if;
 if p_operation='policy'then
  perform public.native_rx_keys(p_request,array['expected_version','status','consent_text','attest_reviewed']);p:=public.clinical_note_current_policy();
  if p.version<>public.appointment_catalog_integer(p_request->'expected_version',1,2147483646)then raise exception 'Note policy changed'using errcode='PT409';end if;
  st:=p_request->>'status';if jsonb_typeof(p_request->'status')is distinct from'string'or st not in('draft','approved')or jsonb_typeof(p_request->'consent_text')is distinct from'string'or public.clinical_note_text_length(p_request->>'consent_text')not between 1 and 4000 or not public.clinical_note_nonblank(p_request->>'consent_text') or jsonb_typeof(p_request->'attest_reviewed')is distinct from'boolean'or(st='approved'and p_request->'attest_reviewed'<>'true'::jsonb)then raise exception 'Explicit bounded practice policy and review required'using errcode='23514';end if;
  insert into clinical_note_policies(version,status,consent_text,soap_model,reviewed_by,reviewed_at)values(p.version+1,st,p_request->>'consent_text','gpt-6-luna',case when st='approved'then p_actor_id end,case when st='approved'then clock_timestamp()end);
 else
  if p_operation='create_template'then perform public.native_rx_keys(p_request,array['template_id','definition']);
  elsif p_operation='save_template'then perform public.native_rx_keys(p_request,array['template_id','expected_revision','definition']);
  elsif p_operation='approve_template'then perform public.native_rx_keys(p_request,array['template_id','expected_revision','version','sha256','attest_reviewed']);
  else perform public.native_rx_keys(p_request,array['template_id','expected_revision','reason']);end if;
  if jsonb_typeof(p_request->'template_id')is distinct from'string'then raise exception 'Template UUID required'using errcode='23514';end if;tid:=(p_request->>'template_id')::uuid;
  select *into t from clinical_note_templates where id=tid for update;template_found:=found;
  perform public.clinical_dictation_actor(p_actor_id);
  -- Recheck after the template lock; FOUND must retain the lookup result.
  if not public.is_active_staff(p_actor_id)or not public.has_role(p_actor_id,'ADMIN')then raise exception 'Practice administrator required after template lock'using errcode='42501';end if;
  if p_operation='create_template'then
   if template_found then raise exception 'Template UUID already exists'using errcode='23505';end if;
   if(select count(*)from clinical_note_templates)>=100 then raise exception 'Practice template limit reached'using errcode='23514';end if;
   d:=p_request->'definition';perform public.clinical_note_validate_template(d);insert into clinical_note_templates(id,latest_version)values(tid,1);ver:=1;
  else
   if not template_found then raise exception 'Template missing'using errcode='23514';end if;
   if t.revision<>public.appointment_catalog_integer(p_request->'expected_revision',1,2147483646)then raise exception 'Template changed; reload'using errcode='PT409';end if;
   if t.retired then raise exception 'Retired templates cannot be changed or approved'using errcode='23514';end if;
   if p_operation='save_template'then d:=p_request->'definition';perform public.clinical_note_validate_template(d);ver:=t.latest_version+1;update clinical_note_templates set revision=revision+1,latest_version=ver where id=tid;
   elsif p_operation='approve_template'then
    ver:=public.appointment_catalog_integer(p_request->'version',1,2147483646);select *into v from clinical_note_template_versions where template_id=tid and version=ver;
    if not found or ver<>t.latest_version or jsonb_typeof(p_request->'sha256')is distinct from'string'or v.sha256 is distinct from p_request->>'sha256'or p_request->'attest_reviewed'is distinct from'true'::jsonb then raise exception 'Review the exact latest template definition and hash'using errcode='23514';end if;
    update clinical_note_templates set revision=revision+1,approved_version=ver where id=tid;
   else
    if jsonb_typeof(p_request->'reason')is distinct from'string'or public.clinical_note_text_length(p_request->>'reason')not between 1 and 1000 or not public.clinical_note_nonblank(p_request->>'reason') then raise exception 'Retirement reason required'using errcode='23514';end if;update clinical_note_templates set revision=revision+1,retired=true where id=tid;
   end if;
  end if;
  if p_operation in('create_template','save_template')then insert into clinical_note_template_versions(template_id,version,definition,sha256,actor_id,session_id)values(tid,ver,d,encode(extensions.digest(convert_to(d::text,'UTF8'),'sha256'),'hex'),p_actor_id,public.next_visit_review_session());end if;
 end if;
 perform public.clinical_dictation_actor(p_actor_id);if not public.has_role(p_actor_id,'ADMIN')then raise exception 'Practice administrator required to commit configuration'using errcode='42501';end if;receipt:=jsonb_build_object('cancelled',false,'configuration',public.read_clinical_note_configuration(p_actor_id));
 insert into clinical_note_configuration_actions(id,actor_id,session_id,operation,request,receipt)values(p_id,p_actor_id,public.next_visit_review_session(),p_operation,p_request,receipt);return receipt;
end $$;
create function public.clinical_note_job_view(p_id uuid)returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select(to_jsonb(j)-array['session_id','intent'])||jsonb_build_object('attempts',coalesce((select jsonb_agg(to_jsonb(a)-array['session_id','result']order by a.created_at desc,a.id desc)from(select *from clinical_note_attempts where job_id=j.id order by created_at desc,id desc limit 20)a),'[]'))from clinical_note_jobs j where j.id=p_id
$$;
create function public.read_clinical_notes(p_actor_id uuid,p_pet_id uuid,p_encounter_id uuid)returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin perform public.clinical_dictation_actor(p_actor_id);if not exists(select 1 from clinical_encounters where id=p_encounter_id and pet_id=p_pet_id)then raise exception 'Matching encounter required'using errcode='23514';end if;
 return jsonb_build_object('actor_id',p_actor_id,'pet_id',p_pet_id,'encounter_id',p_encounter_id,'policy',to_jsonb(public.clinical_note_current_policy()),'templates',public.clinical_note_template_list(),'jobs',coalesce((select jsonb_agg(public.clinical_note_job_view(j.id)order by j.created_at desc,j.id desc)from(select id,created_at from clinical_note_jobs where pet_id=p_pet_id and encounter_id=p_encounter_id order by created_at desc,id desc limit 10)j),'[]'));end $$;
create function public.read_clinical_note_job(p_actor_id uuid,p_id uuid)returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;begin perform public.clinical_dictation_actor(p_actor_id);select *into j from clinical_note_jobs where id=p_id;if not found then raise exception 'Note job missing'using errcode='23514';end if;
 return jsonb_build_object('job',public.clinical_note_job_view(j.id),'policy',to_jsonb(public.clinical_note_current_policy()),'template',(select jsonb_build_object('id',t.id,'version',v.version,'definition',v.definition,'sha256',v.sha256,'status',case when t.retired then'retired'when t.approved_version=v.version then'approved'else'draft'end)from clinical_note_templates t join clinical_note_template_versions v on v.template_id=t.id where t.id=j.template_id and v.version=j.template_version));end $$;
create function public.clinical_note_guard(j public.clinical_note_jobs)returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare p clinical_note_policies;t clinical_note_templates;a clinical_audio_jobs;begin
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
create function public.reserve_clinical_note(p_actor_id uuid,p_id uuid,p_request jsonb)returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_dictation_actor(p_actor_id);j clinical_note_jobs;a clinical_audio_jobs;begin
 if p_id is null or current_setting('transaction_isolation')<>'read committed'then raise exception 'Note UUID and READ COMMITTED required'using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-note-actor:'||actor::text,0));perform pg_advisory_xact_lock(hashtextextended('clinical-note:'||p_id::text,0));
 perform public.clinical_dictation_actor(actor);
 select *into j from clinical_note_jobs where id=p_id;if found then
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
create function public.cancel_clinical_note_reservation(p_actor_id uuid,p_id uuid)returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_dictation_actor(p_actor_id);j clinical_note_jobs;c clinical_note_reservation_cancellations;begin
 if p_id is null or current_setting('transaction_isolation')<>'read committed'then raise exception 'Note UUID and READ COMMITTED required'using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-note-actor:'||actor::text,0));perform pg_advisory_xact_lock(hashtextextended('clinical-note:'||p_id::text,0));
 perform public.clinical_dictation_actor(actor);
 select *into j from clinical_note_jobs where id=p_id;if found then if j.actor_id<>actor then raise exception 'Note reservation belongs to another operator'using errcode='42501';end if;return jsonb_build_object('cancelled',false,'job',public.clinical_note_job_view(j.id));end if;
 select *into c from clinical_note_reservation_cancellations where id=p_id;if found and c.actor_id<>actor then raise exception 'Note cancellation belongs to another operator'using errcode='42501';end if;
 insert into clinical_note_reservation_cancellations(id,actor_id,session_id)values(p_id,actor,public.next_visit_review_session())on conflict(id)do nothing;return jsonb_build_object('cancelled',true,'job',null);
end $$;
create function public.list_clinical_note_template_versions(p_actor_id uuid,p_template_id uuid,p_before_version integer default null)returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare t clinical_note_templates;begin
 perform public.clinical_dictation_actor(p_actor_id);select *into t from clinical_note_templates where id=p_template_id;if not found then raise exception 'Template missing'using errcode='23514';end if;
 if p_before_version is not null and p_before_version<1 then raise exception 'Positive template history cursor required'using errcode='23514';end if;
 return jsonb_build_object('id',t.id,'versions',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'version',v.version,'definition',v.definition,'sha256',v.sha256,'status',case when t.retired then'retired'when t.approved_version=v.version then'approved'else'draft'end)order by v.version desc)from(select *from clinical_note_template_versions where template_id=t.id and(p_before_version is null or version<p_before_version)order by version desc limit 20)v),'[]'),'has_more',(select count(*)>20 from clinical_note_template_versions where template_id=t.id and(p_before_version is null or version<p_before_version)));
end $$;
create function public.claim_clinical_note(p_actor_id uuid,p_id uuid,p_job_id uuid,p_retry_of uuid default null,p_reason text default'',p_ack_cost boolean default false)returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_dictation_actor(p_actor_id);j clinical_note_jobs;a clinical_note_attempts;old clinical_note_attempts;c clinical_note_attempt_cancellations;intent jsonb;p clinical_note_policies;begin
 if p_id is null or p_job_id is null or p_reason is null or public.clinical_note_text_length(p_reason)>1000 or p_ack_cost is null or current_setting('transaction_isolation')<>'read committed'then raise exception 'Exact note attempt required'using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-note-actor:'||actor::text,0));select *into j from clinical_note_jobs where id=p_job_id for update;if not found or j.actor_id<>actor then raise exception 'Owned note job required'using errcode='42501';end if;
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
-- Cancellation must not depend on a still-approved policy or current encounter.
-- It serializes with claim and dispatch on the same job and preserves any sending outcome.
create function public.cancel_clinical_note_attempt(p_actor_id uuid,p_id uuid,p_job_id uuid,p_retry_of uuid default null,p_reason text default'',p_ack_cost boolean default false)returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_dictation_actor(p_actor_id);j clinical_note_jobs;a clinical_note_attempts;c clinical_note_attempt_cancellations;intent jsonb;begin
 if p_id is null or p_job_id is null or p_reason is null or public.clinical_note_text_length(p_reason)>1000 or p_ack_cost is null or current_setting('transaction_isolation')<>'read committed'then raise exception 'Exact note attempt required'using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-note-actor:'||actor::text,0));
 select *into j from clinical_note_jobs where id=p_job_id for update;if not found or j.actor_id<>actor then raise exception 'Owned note job required'using errcode='42501';end if;
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
create function public.dispatch_clinical_note(p_id uuid)returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;a clinical_note_attempts;begin
 select *into j from clinical_note_jobs where id=(select job_id from clinical_note_attempts where id=p_id)for update;select *into a from clinical_note_attempts where id=p_id for update;if not found then raise exception 'Note attempt missing'using errcode='23514';end if;if a.state<>'claimed'then return false;end if;
 perform public.clinical_audio_worker_actor(a.actor_id,a.session_id);perform public.clinical_note_guard(j);perform public.clinical_audio_worker_actor(a.actor_id,a.session_id);if a.lease_until<=clock_timestamp()then raise exception 'Note attempt lease expired'using errcode='PT409';end if;
 update clinical_note_attempts set state='sending'where id=a.id;insert into clinical_note_events(job_id,attempt_id,actor_id,kind,details)values(j.id,a.id,a.actor_id,'dispatched',jsonb_build_object('model',a.model));return true;end $$;
create function public.fail_clinical_note(p_id uuid,p_uncertain boolean,p_code text,p_details jsonb default'{}')returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;a clinical_note_attempts;begin
 if jsonb_typeof(p_details)is distinct from'object'or exists(select 1 from jsonb_object_keys(p_details)k where k<>all(array['http_status','provider_code','request_id','retry_after_seconds']))then raise exception 'Sanitized provider diagnostics required'using errcode='23514';end if;
 if(p_details?'http_status'and(jsonb_typeof(p_details->'http_status')<>'number'or(p_details->>'http_status')::integer not between 100 and 599))or(p_details?'provider_code'and(jsonb_typeof(p_details->'provider_code')<>'string'or p_details->>'provider_code'!~'^[a-z0-9_]{1,80}$'))or(p_details?'request_id'and(jsonb_typeof(p_details->'request_id')<>'string'or public.clinical_note_text_length(p_details->>'request_id')>200))or(p_details?'retry_after_seconds'and(jsonb_typeof(p_details->'retry_after_seconds')<>'number'or(p_details->>'retry_after_seconds')::integer not between 0 and 86400))or p_uncertain is null or p_code is null or p_code!~'^[a-z_]{1,80}$'then raise exception 'Sanitized bounded processing outcome required'using errcode='23514';end if;
 select *into j from clinical_note_jobs where id=(select job_id from clinical_note_attempts where id=p_id)for update;select *into a from clinical_note_attempts where id=p_id for update;if not found then raise exception 'Note attempt missing'using errcode='23514';end if;if a.state not in('claimed','sending')then return;end if;
 update clinical_note_attempts set state=case when p_uncertain then'uncertain'else'failed'end,error_code=p_code,failure_details=p_details,finished_at=clock_timestamp()where id=a.id;insert into clinical_note_events(job_id,attempt_id,actor_id,kind,details)values(j.id,a.id,a.actor_id,case when p_uncertain then'uncertain'else'failed'end,jsonb_build_object('code',p_code)||p_details);end $$;
create function public.clinical_note_assemble(d jsonb,p_source text,p_payload jsonb)returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare fields jsonb;f jsonb;outfield jsonb;claim jsonb;k text;section jsonb;sections jsonb:='{"subjective":{"text":"","quote":""},"objective":{"text":"","quote":""},"assessment":{"text":"","quote":""},"plan":{"text":"","quote":""}}';i integer:=0;total integer:=0;counts jsonb:='{"subjective":0,"objective":0,"assessment":0,"plan":0}';wording text;firstquote text;st text;flag jsonb;begin
 perform public.clinical_note_validate_template(d);perform public.native_rx_keys(p_payload,array['fields','review_flags']);fields:=p_payload->'fields';
 if jsonb_typeof(fields)is distinct from'array'or jsonb_array_length(fields)<>jsonb_array_length(d->'fields')or jsonb_typeof(p_payload->'review_flags')is distinct from'array'or jsonb_array_length(p_payload->'review_flags')>10 then raise exception 'Exact ordered template fields and bounded flags required'using errcode='23514';end if;
 for f in select value from jsonb_array_elements(d->'fields')loop
  outfield:=fields->i;i:=i+1;perform public.native_rx_keys(outfield,array['field_id','status','claims','uncertainty']);st:=outfield->>'status';
  if jsonb_typeof(outfield->'field_id')is distinct from'string'or outfield->>'field_id'is distinct from f->>'id'or jsonb_typeof(outfield->'status')is distinct from'string'or st not in('supported','missing','uncertain')or jsonb_typeof(outfield->'claims')is distinct from'array'or jsonb_array_length(outfield->'claims')>24 or jsonb_typeof(outfield->'uncertainty')is distinct from'string'or public.clinical_note_text_length(outfield->>'uncertainty')>500 then raise exception 'Exact source-bound template field result required'using errcode='23514';end if;
  if(st='missing'and(jsonb_array_length(outfield->'claims')<>0 or outfield->>'uncertainty'<>''))or(st='supported'and(jsonb_array_length(outfield->'claims')=0 or outfield->>'uncertainty'<>''))or(st='uncertain'and(jsonb_array_length(outfield->'claims')=0 or not public.clinical_note_nonblank(outfield->>'uncertainty')))then raise exception 'Missing, supported and uncertain field states must agree with source claims'using errcode='23514';end if;
  wording:='';firstquote:='';k:=f->>'destination';
  for claim in select value from jsonb_array_elements(outfield->'claims')loop
   perform public.native_rx_keys(claim,array['text','quote']);if jsonb_typeof(claim->'text')is distinct from'string'or public.clinical_note_text_length(claim->>'text')not between 1 and 500 or not public.clinical_note_nonblank(claim->>'text')or jsonb_typeof(claim->'quote')is distinct from'string'or public.clinical_note_text_length(claim->>'quote')not between 1 and 1000 or not public.clinical_note_nonblank(claim->>'quote')or strpos(p_source,claim->>'quote')=0 then raise exception 'Every clinical claim requires a literal source excerpt'using errcode='23514';end if;
   if wording<>''then wording:=wording||E'\n';end if;wording:=wording||(claim->>'text');if firstquote=''then firstquote:=claim->>'quote';end if;total:=total+1;counts:=jsonb_set(counts,array[k],to_jsonb((counts->>k)::integer+1));
  end loop;
  if wording<>''then section:=sections->k;sections:=jsonb_set(sections,array[k],jsonb_build_object('text',(case when section->>'text'<>''then section->>'text'||E'\n\n'else''end)||(f->>'label')||E':\n'||wording,'quote',case when section->>'quote'=''then firstquote else section->>'quote'end));end if;
 end loop;
 if total=0 or total>96 or exists(select 1 from jsonb_each_text(counts)where value::integer>24)then raise exception 'One to 96 claims and at most 24 per SOAP destination required'using errcode='23514';end if;
 for flag in select value from jsonb_array_elements(p_payload->'review_flags')loop if jsonb_typeof(flag)is distinct from'string'or public.clinical_note_text_length(flag#>>'{}')not between 1 and 500 or not public.clinical_note_nonblank(flag#>>'{}')then raise exception 'Bounded review flags required'using errcode='23514';end if;end loop;
 perform public.clinical_dictation_validate_sections(p_source,sections);return sections;
end $$;
create function public.finish_clinical_note(p_id uuid,p_result jsonb)returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j clinical_note_jobs;a clinical_note_attempts;v clinical_note_template_versions;hash text;sections jsonb;lc jsonb;begin
 select *into j from clinical_note_jobs where id=(select job_id from clinical_note_attempts where id=p_id)for update;select *into a from clinical_note_attempts where id=p_id for update;if not found then raise exception 'Note attempt missing'using errcode='23514';end if;
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
create function public.read_clinical_note_provenance(p_actor_id uuid,p_proposal_id uuid)returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin perform public.clinical_dictation_actor(p_actor_id);return(select to_jsonb(g)||jsonb_build_object('source_kind',j.source_kind,'source_note',j.source_note,'audio_job_id',j.audio_job_id,'source_audio_policy_version',j.source_audio_policy_version,'policy_version',j.policy_version)from clinical_note_generations g join clinical_note_jobs j on j.id=g.job_id where g.proposal_id=p_proposal_id);end $$;
do $$declare f record;begin
 for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in('cancel_clinical_note_attempt','cancel_clinical_note_reservation','list_clinical_note_template_versions','clinical_note_nonblank','clinical_note_text_length','clinical_note_row_guard','clinical_note_validate_template','clinical_note_current_policy','clinical_note_template_list','read_clinical_note_configuration','recover_clinical_note_configuration','cancel_clinical_note_configuration','save_clinical_note_configuration','clinical_note_job_view','read_clinical_notes','read_clinical_note_job','clinical_note_guard','reserve_clinical_note','claim_clinical_note','dispatch_clinical_note','fail_clinical_note','clinical_note_assemble','finish_clinical_note','read_clinical_note_provenance')loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.oid::regprocedure);
 if f.proname in('cancel_clinical_note_attempt','cancel_clinical_note_reservation','list_clinical_note_template_versions','read_clinical_note_configuration','recover_clinical_note_configuration','cancel_clinical_note_configuration','save_clinical_note_configuration','read_clinical_notes','read_clinical_note_job','reserve_clinical_note','claim_clinical_note','read_clinical_note_provenance')then execute format('grant execute on function %s to authenticated',f.oid::regprocedure);end if;
 if f.proname in('dispatch_clinical_note','fail_clinical_note','finish_clinical_note')then execute format('grant execute on function %s to service_role',f.oid::regprocedure);end if;
 end loop;
end $$;
