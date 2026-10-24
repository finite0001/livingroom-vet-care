-- Documentary anesthesia records; no device feeds, dose advice, interpretation or billing.
create table public.patient_anesthesia_records (
 id uuid primary key, pet_id uuid not null references public.pets(id), procedure_name text not null check(length(trim(procedure_name)) between 1 and 200),
 started_at timestamptz not null, ended_at timestamptz, team text not null check(length(trim(team)) between 1 and 2000),
 assessment text not null default '' check(length(assessment)<=20000), plan text not null default '' check(length(plan)<=20000), recovery_notes text not null default '' check(length(recovery_notes)<=20000),
 observations jsonb not null default '[]', events jsonb not null default '[]',
 source text not null check(source in ('manual','transcribed_from_document')), source_description text not null default '' check(length(source_description)<=2000), original_document_id uuid references public.patient_documents(id),
 status text not null default 'draft' check(status in ('draft','signed')), version integer not null default 1,
 created_by uuid not null references public.profiles(id), updated_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), signed_by uuid references public.profiles(id), signed_at timestamptz,
 check(isfinite(started_at)),check(ended_at is null or (isfinite(ended_at) and ended_at>=started_at)),
 check((status='draft' and signed_by is null and signed_at is null)or(status='signed' and signed_by is not null and signed_at is not null)),
 check(source='manual' or (original_document_id is not null and length(trim(source_description))>0))
);
create table public.anesthesia_record_revisions (
 id bigint generated always as identity primary key, record_id uuid not null references public.patient_anesthesia_records(id),version integer not null,snapshot jsonb not null,actor_id uuid not null references public.profiles(id),recorded_at timestamptz not null default now(),unique(record_id,version)
);
create table public.anesthesia_record_addenda (
 id uuid primary key, record_id uuid not null references public.patient_anesthesia_records(id),content text not null check(length(trim(content)) between 1 and 10000),actor_id uuid not null references public.profiles(id),recorded_at timestamptz not null default now()
);
create index anesthesia_patient_time on public.patient_anesthesia_records(pet_id,started_at desc,id);
create function public.anesthesia_validate(p_record public.patient_anesthesia_records) returns void language plpgsql set search_path=public as $$
declare item jsonb;observed timestamptz;
begin
 if p_record.started_at is null or not isfinite(p_record.started_at) or p_record.started_at>now()+interval '5 minutes' or p_record.ended_at>now()+interval '5 minutes' then raise exception 'Record finite procedure times no later than now' using errcode='23514';end if;
 if p_record.observations is null or jsonb_typeof(p_record.observations)<>'array' or jsonb_array_length(p_record.observations)>1000 or octet_length(p_record.observations::text)>500000 or p_record.events is null or jsonb_typeof(p_record.events)<>'array' or jsonb_array_length(p_record.events)>1000 or octet_length(p_record.events::text)>500000 then raise exception 'Invalid observation or event collection' using errcode='23514';end if;
 for item in select value from jsonb_array_elements(p_record.observations) loop
  if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('at','label','value','unit','notes')) or jsonb_typeof(item->'at') is distinct from 'string' or jsonb_typeof(item->'label') is distinct from 'string' or length(trim(item->>'label')) not between 1 and 120 or jsonb_typeof(item->'value') is distinct from 'number' or abs((item->>'value')::numeric)>1e100 or jsonb_typeof(item->'unit') is distinct from 'string' or length(trim(item->>'unit')) not between 1 and 60 or jsonb_typeof(item->'notes') is distinct from 'string' or length(item->>'notes')>2000 then raise exception 'Observations require a timestamp, label, finite value and explicit unit' using errcode='23514';end if;
  observed=(item->>'at')::timestamptz;
  if not isfinite(observed) or observed<p_record.started_at or observed>coalesce(p_record.ended_at,now()+interval '5 minutes') then raise exception 'Observation time must fall within the recorded procedure' using errcode='23514';end if;
 end loop;
 for item in select value from jsonb_array_elements(p_record.events) loop
  if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('at','kind','description')) or jsonb_typeof(item->'at') is distinct from 'string' or item->>'kind' is null or item->>'kind' not in ('medication','procedure','other') or jsonb_typeof(item->'description') is distinct from 'string' or length(trim(item->>'description')) not between 1 and 4000 then raise exception 'Events require a timestamp, type and documentary description' using errcode='23514';end if;
  observed=(item->>'at')::timestamptz;
  if not isfinite(observed) or observed<p_record.started_at or observed>coalesce(p_record.ended_at,now()+interval '5 minutes') then raise exception 'Event time must fall within the recorded procedure' using errcode='23514';end if;
 end loop;
end $$;
create function public.anesthesia_record_history() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.anesthesia_record_revisions(record_id,version,snapshot,actor_id) values(new.id,new.version,to_jsonb(new),new.updated_by);return new;end $$;
create trigger anesthesia_record_history after insert or update on public.patient_anesthesia_records for each row execute function public.anesthesia_record_history();
create function public.save_patient_anesthesia_record(p_id uuid,p_pet_id uuid,p_expected_version integer,p_values jsonb) returns public.patient_anesthesia_records language plpgsql security definer set search_path=public as $$
declare actor uuid;r public.patient_anesthesia_records;n public.patient_anesthesia_records;existed boolean;
begin
 actor=public.clinical_require_staff();
 if p_id is null or p_values is null or jsonb_typeof(p_values)<>'object' or exists(select 1 from jsonb_object_keys(p_values) k where k not in ('procedure_name','started_at','ended_at','team','assessment','plan','recovery_notes','observations','events','source','source_description','original_document_id')) then raise exception 'Invalid anesthesia record fields' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,12));
 select * into r from public.patient_anesthesia_records where id=p_id for update;existed=found;
 if existed and r.pet_id<>p_pet_id then raise exception 'Anesthesia record belongs to another patient' using errcode='42501';end if;
 if existed and r.status<>'draft' then raise exception 'Signed anesthesia records are immutable; append a correction' using errcode='23514';end if;
 n=jsonb_populate_record(null::public.patient_anesthesia_records,p_values);
 n.procedure_name=trim(n.procedure_name);n.team=trim(n.team);n.assessment=coalesce(n.assessment,'');n.plan=coalesce(n.plan,'');n.recovery_notes=coalesce(n.recovery_notes,'');n.source_description=coalesce(n.source_description,'');n.observations=coalesce(n.observations,'[]');n.events=coalesce(n.events,'[]');
 if existed and r.updated_by=actor and r.version=coalesce(p_expected_version,0)+1 and (to_jsonb(r)-array['id','pet_id','status','version','created_by','updated_by','created_at','updated_at','signed_by','signed_at'])=(to_jsonb(n)-array['id','pet_id','status','version','created_by','updated_by','created_at','updated_at','signed_by','signed_at']) then return r;end if;
 if existed and r.version is distinct from p_expected_version or not existed and p_expected_version is not null then raise exception 'Anesthesia record version conflict; reload' using errcode='40001';end if;
 if not exists(select 1 from public.pets where id=p_pet_id and (existed or (archived_at is null and deceased_at is null))) then raise exception 'New records require an active patient' using errcode='23514';end if;
 perform public.anesthesia_validate(n);
 if n.original_document_id is not null then perform 1 from public.patient_documents where id=n.original_document_id and pet_id=p_pet_id and status='ready' for share;if not found then raise exception 'Original file must be a ready document for this patient' using errcode='42501';end if;end if;
 if existed then
 update public.patient_anesthesia_records set procedure_name=n.procedure_name,started_at=n.started_at,ended_at=n.ended_at,team=n.team,assessment=n.assessment,plan=n.plan,recovery_notes=n.recovery_notes,observations=n.observations,events=n.events,source=n.source,source_description=n.source_description,original_document_id=n.original_document_id,version=version+1,updated_by=actor,updated_at=now() where id=p_id returning * into r;
 else
 insert into public.patient_anesthesia_records(id,pet_id,procedure_name,started_at,ended_at,team,assessment,plan,recovery_notes,observations,events,source,source_description,original_document_id,created_by,updated_by) values(p_id,p_pet_id,n.procedure_name,n.started_at,n.ended_at,n.team,n.assessment,n.plan,n.recovery_notes,n.observations,n.events,n.source,n.source_description,n.original_document_id,actor,actor) returning * into r;
 end if;return r;
end $$;
create function public.sign_patient_anesthesia_record(p_id uuid,p_pet_id uuid,p_expected_version integer) returns public.patient_anesthesia_records language plpgsql security definer set search_path=public as $$
declare actor uuid;r public.patient_anesthesia_records;
begin actor=public.clinical_require_staff();select * into strict r from public.patient_anesthesia_records where id=p_id for update;
 if r.pet_id<>p_pet_id then raise exception 'Anesthesia record belongs to another patient' using errcode='42501';end if;
 if r.status='signed' and r.signed_by=actor and r.version=p_expected_version+1 then return r;end if;
 if r.version is distinct from p_expected_version then raise exception 'Anesthesia record version conflict; reload' using errcode='40001';end if;
 if r.status<>'draft' then raise exception 'Record already signed' using errcode='23514';end if;
 if r.ended_at is null or nullif(trim(r.assessment),'') is null or nullif(trim(r.plan),'') is null then raise exception 'Record end time, assessment and plan before signing' using errcode='23514';end if;
 update public.patient_anesthesia_records set status='signed',signed_by=actor,signed_at=now(),version=version+1,updated_by=actor,updated_at=now() where id=p_id returning * into r;return r;
end $$;
create function public.add_anesthesia_record_addendum(p_id uuid,p_record_id uuid,p_pet_id uuid,p_content text) returns public.anesthesia_record_addenda language plpgsql security definer set search_path=public as $$
declare actor uuid;r public.anesthesia_record_addenda;c public.patient_anesthesia_records;
begin actor=public.clinical_require_staff();select * into strict c from public.patient_anesthesia_records where id=p_record_id for share;
 if c.pet_id<>p_pet_id then raise exception 'Anesthesia record belongs to another patient' using errcode='42501';end if;
 if c.status<>'signed' then raise exception 'Addenda require a signed record' using errcode='23514';end if;
 if p_id is null then raise exception 'Stable addendum ID required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,13));select * into r from public.anesthesia_record_addenda where id=p_id;
 if found then if r.record_id<>p_record_id or r.actor_id<>actor or r.content is distinct from trim(p_content) then raise exception 'Addendum retry changed' using errcode='42501';end if;return r;end if;
 insert into public.anesthesia_record_addenda(id,record_id,content,actor_id) values(p_id,p_record_id,trim(p_content),actor) returning * into r;return r;
end $$;
do $$ declare t text;begin foreach t in array array['patient_anesthesia_records','anesthesia_record_revisions','anesthesia_record_addenda'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);execute format('grant select on table public.%I to authenticated',t);execute format('create policy "Active staff read anesthesia records" on public.%I for select to authenticated using(public.is_active_staff(auth.uid()))',t);
end loop;end $$;
revoke all on function public.anesthesia_validate(public.patient_anesthesia_records),public.anesthesia_record_history() from public,anon,authenticated,service_role;
revoke all on function public.save_patient_anesthesia_record(uuid,uuid,integer,jsonb),public.sign_patient_anesthesia_record(uuid,uuid,integer),public.add_anesthesia_record_addendum(uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.save_patient_anesthesia_record(uuid,uuid,integer,jsonb),public.sign_patient_anesthesia_record(uuid,uuid,integer),public.add_anesthesia_record_addendum(uuid,uuid,uuid,text) to authenticated;
