-- Staff-supplied transcript/draft review. No recording, AI provider or worker is enabled.
create table public.clinical_dictation_proposals(
 id uuid primary key,pet_id uuid not null references public.pets(id),
 encounter_id uuid not null references public.clinical_encounters(id),expected_version integer not null check(expected_version>0),
 actor_id uuid not null references auth.users(id),actor_name text not null,transcript text not null check(length(transcript) between 1 and 60000),
 source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),source_note text not null check(length(source_note) between 1 and 1000),
 attest_authorized boolean not null check(attest_authorized),sections jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create index clinical_dictation_proposals_encounter on public.clinical_dictation_proposals(encounter_id,created_at desc,id desc);
create table public.clinical_dictation_reviews(
 id uuid primary key,proposal_id uuid not null unique references public.clinical_dictation_proposals(id),
 actor_id uuid not null references auth.users(id),actor_name text not null,decision text not null check(decision in('accepted','rejected')),
 accepted_sections jsonb not null,review_note text not null check(length(review_note)<=2000),
 attest_reviewed boolean not null check(attest_reviewed),encounter_version integer,
 created_at timestamptz not null default clock_timestamp(),
 check((decision='accepted' and encounter_version is not null and encounter_version>0) or (decision='rejected' and encounter_version is null))
);
create table public.clinical_dictation_actions(
 id uuid primary key,actor_id uuid not null references auth.users(id),kind text not null check(kind in('submit','review')),
 request jsonb not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp()
);
do $$declare t text;begin
 foreach t in array array['clinical_dictation_proposals','clinical_dictation_reviews','clinical_dictation_actions'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger dictation_history_immutable before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);
 end loop;
end $$;

create function public.clinical_dictation_actor(p_actor_id uuid) returns uuid language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_require_staff();begin
 perform public.next_visit_review_session();
 if actor is distinct from p_actor_id then raise exception 'Matched current clinical operator required' using errcode='42501';end if;
 return actor;
end $$;

create function public.clinical_dictation_validate_sections(p_transcript text,p_sections jsonb) returns void language plpgsql immutable set search_path=public,pg_temp as $$
declare k text;s jsonb;provided integer:=0;begin
 perform public.native_rx_keys(p_sections,array['subjective','objective','assessment','plan']);
 foreach k in array array['subjective','objective','assessment','plan'] loop
 s:=p_sections->k;perform public.native_rx_keys(s,array['text','quote']);
 if jsonb_typeof(s->'text') is distinct from 'string' or jsonb_typeof(s->'quote') is distinct from 'string'
 or length(s->>'text')>50000 or length(s->>'quote')>2000 then raise exception 'Bounded SOAP text and exact source excerpts required' using errcode='23514';end if;
 if coalesce(s->>'text','') !~ '[^[:space:]]' then
  if s->>'text'<>'' or s->>'quote'<>'' then raise exception 'Unproposed sections must be empty' using errcode='23514';end if;
 else
  if s->>'quote' !~ '[^[:space:]]' or strpos(p_transcript,s->>'quote')=0 then raise exception 'Each proposed section needs a literal transcript excerpt' using errcode='23514';end if;
  provided:=provided+1;
 end if;
 end loop;
 if provided=0 then raise exception 'At least one proposed section required' using errcode='23514';end if;
end $$;

create function public.recover_clinical_dictation_action(p_actor_id uuid,p_id uuid,p_kind text,p_request jsonb) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_dictation_actor(p_actor_id);a clinical_dictation_actions;begin
 if p_id is null or p_kind is null or p_kind not in('submit','review') or jsonb_typeof(p_request) is distinct from 'object' then raise exception 'Exact dictation action required' using errcode='23514';end if;
 select * into a from clinical_dictation_actions where id=p_id;
 if not found then return null;end if;
 if a.actor_id is distinct from actor then raise exception 'Dictation action belongs to another operator' using errcode='42501';end if;
 if a.kind is distinct from p_kind or a.request is distinct from p_request then raise exception 'Dictation UUID belongs to a different request' using errcode='23505';end if;
 return a.receipt;
end $$;

create function public.read_clinical_dictation(p_actor_id uuid,p_pet_id uuid,p_encounter_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_dictation_actor(p_actor_id);items jsonb;begin
 perform 1 from clinical_encounters where id=p_encounter_id and pet_id=p_pet_id;
 if not found then raise exception 'Matching patient encounter required' using errcode='23514';end if;
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('review',(select to_jsonb(r)from clinical_dictation_reviews r where r.proposal_id=p.id)) order by p.created_at desc,p.id desc),'[]'::jsonb)
 into items from(select * from clinical_dictation_proposals where encounter_id=p_encounter_id and pet_id=p_pet_id order by created_at desc,id desc limit 20)p;
 return jsonb_build_object('actor_id',actor,'pet_id',p_pet_id,'encounter_id',p_encounter_id,'items',items,
 'has_more',(select count(*)>20 from clinical_dictation_proposals where encounter_id=p_encounter_id and pet_id=p_pet_id));
end $$;

create function public.save_clinical_dictation_action(p_actor_id uuid,p_id uuid,p_kind text,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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

do $$declare f record;begin
 for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in('clinical_dictation_actor','clinical_dictation_validate_sections','recover_clinical_dictation_action','read_clinical_dictation','save_clinical_dictation_action') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.oid::regprocedure);
 if f.proname in('recover_clinical_dictation_action','read_clinical_dictation','save_clinical_dictation_action') then execute format('grant execute on function %s to authenticated',f.oid::regprocedure);end if;
 end loop;
end $$;
