-- Reviewed manual VetRocket study links. No PACS API, image fetch, or provider activation.
create table public.imaging_studies (
 id uuid primary key, pet_id uuid not null references public.pets(id) on delete restrict,
 version integer not null check(version between 1 and 999999999),
 "values" jsonb not null, status text not null check(status in('recorded','void')),
 created_by uuid not null references auth.users(id) on delete restrict,
 updated_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null, updated_at timestamptz not null,
 unique(id,pet_id)
);
create unique index imaging_external_identity on public.imaging_studies(("values"->>'account_label'),("values"->>'external_study_id'));
create index imaging_patient_page on public.imaging_studies(pet_id,id);
create table public.imaging_study_revisions (
 study_id uuid not null,pet_id uuid not null,version integer not null,
 snapshot jsonb not null,reason text not null,actor_id uuid not null references auth.users(id) on delete restrict,
 session_id uuid not null,created_at timestamptz not null default clock_timestamp(),
 primary key(study_id,version),foreign key(study_id,pet_id) references public.imaging_studies(id,pet_id) on delete restrict
);
create table public.imaging_study_actions (
 id uuid primary key,study_id uuid references public.imaging_studies(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,
 intent jsonb not null,receipt jsonb,cancelled boolean not null default false,created_at timestamptz not null default clock_timestamp(),
 check((cancelled and study_id is null and receipt is null)or(not cancelled and study_id is not null and receipt is not null))
);
create function public.imaging_root_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if TG_OP='DELETE' then raise exception 'Imaging history cannot be deleted' using errcode='23514';end if;
 if row(NEW.id,NEW.pet_id,NEW.created_by,NEW.created_at,NEW."values"->>'account_label',NEW."values"->>'external_study_id',NEW."values"->>'vendor_patient_id')
 is distinct from row(OLD.id,OLD.pet_id,OLD.created_by,OLD.created_at,OLD."values"->>'account_label',OLD."values"->>'external_study_id',OLD."values"->>'vendor_patient_id')
 or NEW.version<>OLD.version+1 or OLD.status='void' then
 raise exception 'Imaging identity and terminal history are immutable' using errcode='23514';end if;
 return NEW;
end $$;
create trigger imaging_root_guard before update or delete on public.imaging_studies for each row execute function public.imaging_root_guard();
do $$declare t text;begin
 foreach t in array array['imaging_studies','imaging_study_revisions','imaging_study_actions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
 foreach t in array array['imaging_study_revisions','imaging_study_actions'] loop
  execute format('create trigger imaging_history_immutable before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);
 end loop;
end $$;

create function public.imaging_validate(p_values jsonb) returns void language plpgsql immutable set search_path=public,pg_temp as $$
declare k text;d date;keys text[]:=array['account_label','vendor_patient_id','external_study_id','accession','study_date','modality','description','body_region','viewer_url','encounter_id','encounter_version','document_id','document_version','identity_verified','review_note'];
begin
 if jsonb_typeof(p_values) is distinct from 'object' or p_values-keys<>'{}' or not p_values?&keys or octet_length(p_values::text)>16384 then
  raise exception 'Exact bounded imaging fields required' using errcode='23514';end if;
 foreach k in array array['account_label','vendor_patient_id','external_study_id','description','review_note'] loop
  if jsonb_typeof(p_values->k) is distinct from 'string' or length(p_values->>k) not between 1 and (case when k='review_note' then 2000 else 160 end)
   or trim(p_values->>k)<>p_values->>k or p_values->>k!~'[^[:space:]]' or p_values->>k~'[[:cntrl:]]' then
   raise exception 'Exact imaging labels and identity review required' using errcode='23514';end if;
 end loop;
 foreach k in array array['accession','body_region'] loop
  if jsonb_typeof(p_values->k) is distinct from 'string' or length(p_values->>k)>160 or p_values->>k~'[[:cntrl:]]' then
   raise exception 'Bounded imaging metadata required' using errcode='23514';end if;
 end loop;
 if jsonb_typeof(p_values->'modality') is distinct from 'string' or p_values->>'modality' not in('DX','CR','US','CT','MR','IO','ES','OT')
 or p_values->'identity_verified' is distinct from 'true'::jsonb then raise exception 'Modality and explicit patient identity confirmation required' using errcode='23514';end if;
 if jsonb_typeof(p_values->'study_date') is distinct from 'string' or p_values->>'study_date'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Imaging calendar date required' using errcode='23514';end if;
 begin d:=(p_values->>'study_date')::date;exception when others then raise exception 'Invalid imaging calendar date' using errcode='23514';end;
 if not isfinite(d) or to_char(d,'YYYY-MM-DD')<>p_values->>'study_date' then raise exception 'Invalid imaging calendar date' using errcode='23514';end if;
 -- Support only the observed VetRocket web-share URL family, never arbitrary URLs or credentials.
 if jsonb_typeof(p_values->'viewer_url') is distinct from 'string' or length(p_values->>'viewer_url')>2048
 or p_values->>'viewer_url'!~'^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.vetrocket\.net/view\.html\?link=[A-Za-z0-9_-]+$'
 or length(split_part(p_values->>'viewer_url','?link=',2)) not between 8 and 1800 then
  raise exception 'Supported HTTPS VetRocket study share link required' using errcode='23514';end if;
 foreach k in array array['encounter','document'] loop
  if (p_values->(k||'_id')='null')<>(p_values->(k||'_version')='null') then raise exception 'Source identity and exact version required together' using errcode='23514';end if;
  if p_values->(k||'_id')<>'null' then
   perform public.native_rx_uuid(p_values->(k||'_id'));
   if jsonb_typeof(p_values->(k||'_version')) is distinct from 'number' or p_values->>(k||'_version')!~'^[1-9][0-9]{0,8}$' then
    raise exception 'Positive source version required' using errcode='23514';end if;
  end if;
 end loop;
end $$;

create function public.imaging_report_available(p_pet_id uuid,p_values jsonb) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when p_values->'document_id'='null' then null else exists(
 select 1 from public.patient_documents d join storage.objects o on o.bucket_id='patient-documents' and o.name=d.file_path
 where d.id=(p_values->>'document_id')::uuid and d.pet_id=p_pet_id and d.version=(p_values->>'document_version')::integer
 and d.mime_type='application/pdf' and d.status='ready' and o.metadata->>'size'=d.file_size::text and o.metadata->>'mimetype'=d.mime_type) end
$$;
create function public.imaging_detail(p_id uuid,p_pet_id uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('study',to_jsonb(s),'report_available',public.imaging_report_available(s.pet_id,s."values"))
 from public.imaging_studies s where s.id=p_id and s.pet_id=p_pet_id
$$;
create function public.read_imaging_study(p_actor_id uuid,p_pet_id uuid,p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin perform public.clinical_dictation_actor(p_actor_id);return public.imaging_detail(p_id,p_pet_id);end $$;
create function public.list_imaging_studies(p_actor_id uuid,p_pet_id uuid,p_after uuid default null) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;begin
 perform public.clinical_dictation_actor(p_actor_id);
 if p_pet_id is null then raise exception 'Patient required' using errcode='23514';end if;
 with rows as materialized(select id from public.imaging_studies where pet_id=p_pet_id and (p_after is null or id>p_after) order by id limit 21),
 page as(select id from rows order by id limit 20)
 select jsonb_build_object('items',coalesce((select jsonb_agg(public.imaging_detail(id,p_pet_id) order by id)from page),'[]'),
 'next',case when(select count(*)from rows)>20 then(select id from page order by id desc limit 1)else null end)into result;
 return result;
end $$;
create function public.list_imaging_history(p_actor_id uuid,p_pet_id uuid,p_id uuid,p_before integer default null) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;begin
 perform public.clinical_dictation_actor(p_actor_id);
 if p_before is not null and p_before<1 then raise exception 'Positive imaging history cursor required' using errcode='23514';end if;
 with rows as materialized(select * from public.imaging_study_revisions where study_id=p_id and pet_id=p_pet_id and(p_before is null or version<p_before)order by version desc limit 21),
 page as(select * from rows order by version desc limit 20)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page)order by version desc)from page),'[]'),
 'next',case when(select count(*)from rows)>20 then(select min(version)from page)else null end)into result;
 return result;
end $$;

create function public.recover_imaging_action(p_actor_id uuid,p_action_id uuid,p_id uuid,p_pet_id uuid,p_expected_version integer,p_kind text,p_values jsonb,p_reason text) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_dictation_actor(p_actor_id);a public.imaging_study_actions;intent jsonb;
begin
 intent:=jsonb_build_object('id',p_id,'pet_id',p_pet_id,'expected_version',p_expected_version,'kind',p_kind,'values',p_values,'reason',p_reason);
 select * into a from public.imaging_study_actions where id=p_action_id;
 if not found then return null;end if;
 if a.actor_id<>actor or a.intent is distinct from intent then raise exception 'Imaging action belongs to different work' using errcode='23505';end if;
 -- A receipt proves the original commit; current availability is always checked separately.
 return a.receipt;
end $$;

create function public.save_imaging_study(p_actor_id uuid,p_action_id uuid,p_id uuid,p_pet_id uuid,p_expected_version integer,p_kind text,p_values jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
 declare actor uuid:=public.clinical_dictation_actor(p_actor_id);s public.imaging_studies;p public.pets;e public.clinical_encounters;d public.patient_documents;receipt jsonb;intent jsonb;sid uuid;
begin
 if p_action_id is null or p_id is null or p_pet_id is null then raise exception 'Imaging action and patient identity required' using errcode='23514';end if;
 -- Serialize duplicate action UUIDs, then patient eligibility/root. No external calls in transaction.
 perform pg_advisory_xact_lock(hashtextextended('imaging-action:'||p_action_id::text,0));
 receipt:=public.recover_imaging_action(actor,p_action_id,p_id,p_pet_id,p_expected_version,p_kind,p_values,p_reason);
 if receipt is not null then return receipt;end if;
 if exists(select 1 from public.imaging_study_actions where id=p_action_id and cancelled)then
  raise exception 'This imaging action was cancelled; it cannot be dispatched again' using errcode='PT409';end if;
 if p_kind is null or p_kind not in('record','correct','void') or p_reason is null or length(p_reason)>1000
 or (p_kind='record' and(p_expected_version is not null or p_reason<>'' or p_values is null))
 or (p_kind<>'record' and(p_expected_version is null or p_expected_version not between 1 and 999999998 or p_reason!~'[^[:space:]]'))
 or (p_kind='void' and p_values is not null) or(p_kind='correct' and p_values is null) then
  raise exception 'Exact imaging operation, version and correction reason required' using errcode='23514';end if;
 if p_kind<>'void' then perform public.imaging_validate(p_values);end if;
 perform public.care_eligibility_lock();
 select * into p from public.pets where id=p_pet_id for share;
 if not found then raise exception 'Patient unavailable' using errcode='23514';end if;
 if p_kind='record' and(p.archived_at is not null or p.deceased_at is not null)then raise exception 'New imaging requires an active patient' using errcode='23514';end if;
 -- Root ID lock also serializes concurrent first creation; unique external key prevents cross-patient duplicates.
 perform pg_advisory_xact_lock(hashtextextended('imaging-study:'||p_id::text,0));
 select * into s from public.imaging_studies where id=p_id for update;
 if p_kind='record' then
  if found then raise exception 'Study already recorded; reload its saved identity' using errcode='PT409';end if;
 else
  if not found or s.pet_id<>p_pet_id then raise exception 'Study unavailable for this patient' using errcode='23514';end if;
  if s.version<>p_expected_version or s.status='void' then raise exception 'Imaging study changed or was voided; refresh before editing' using errcode='PT409';end if;
 end if;
 if p_kind<>'void' then
  if exists(select 1 from public.imaging_studies x where x.pet_id<>p_pet_id
   and x."values"->>'account_label'=p_values->>'account_label' and x."values"->>'vendor_patient_id'=p_values->>'vendor_patient_id')then
   raise exception 'This vendor patient identity is already linked to another patient; review the source identity' using errcode='23514';end if;
  if p_values->'encounter_id'<>'null' then
   select * into e from public.clinical_encounters where id=(p_values->>'encounter_id')::uuid for share;
   if not found or e.pet_id<>p_pet_id then raise exception 'Encounter belongs to another patient or is unavailable' using errcode='23514';end if;
   if e.version<>(p_values->>'encounter_version')::integer then raise exception 'Encounter changed; select its current version' using errcode='PT409';end if;
  end if;
  if p_values->'document_id'<>'null' then
   select * into d from public.patient_documents where id=(p_values->>'document_id')::uuid for share;
   if not found or d.pet_id<>p_pet_id then raise exception 'Report belongs to another patient or is unavailable' using errcode='23514';end if;
   if d.encounter_id is not null and d.encounter_id is distinct from(p_values->>'encounter_id')::uuid then
    raise exception 'Report encounter differs from selected study encounter' using errcode='23514';end if;
   if not public.imaging_report_available(p_pet_id,p_values) then raise exception 'Report must be the current ready PDF with its private original' using errcode='PT409';end if;
  end if;
 end if;
 sid:=public.next_visit_review_session();
 if p_kind='record' then
  insert into public.imaging_studies(id,pet_id,version,"values",status,created_by,updated_by,created_at,updated_at)
  values(p_id,p_pet_id,1,p_values,'recorded',actor,actor,clock_timestamp(),clock_timestamp()) returning * into s;
 else
  update public.imaging_studies set version=version+1,"values"=case when p_kind='void' then "values" else p_values end,
   status=case when p_kind='void' then 'void' else 'recorded' end,updated_by=actor,updated_at=clock_timestamp()where id=p_id returning * into s;
 end if;
 insert into public.imaging_study_revisions(study_id,pet_id,version,snapshot,reason,actor_id,session_id)values(s.id,s.pet_id,s.version,to_jsonb(s),p_reason,actor,sid);
 receipt:=public.imaging_detail(p_id,p_pet_id);
 intent:=jsonb_build_object('id',p_id,'pet_id',p_pet_id,'expected_version',p_expected_version,'kind',p_kind,'values',p_values,'reason',p_reason);
 insert into public.imaging_study_actions(id,study_id,actor_id,intent,receipt)values(p_action_id,p_id,actor,intent,receipt);
 perform public.clinical_dictation_actor(p_actor_id);return receipt;
end $$;

-- Durable cancellation closes the delayed-request race before an uncertain draft may be edited.
create function public.cancel_imaging_action(p_actor_id uuid,p_action_id uuid,p_id uuid,p_pet_id uuid,p_expected_version integer,p_kind text,p_values jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.clinical_dictation_actor(p_actor_id);receipt jsonb;intent jsonb;
begin
 if p_action_id is null or p_id is null or p_pet_id is null or p_kind is null or p_reason is null
 or length(p_reason)>1000 or octet_length(coalesce(p_values::text,''))>16384 then raise exception 'Bounded imaging cancellation identity required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('imaging-action:'||p_action_id::text,0));
 receipt:=public.recover_imaging_action(actor,p_action_id,p_id,p_pet_id,p_expected_version,p_kind,p_values,p_reason);
 if receipt is not null then return jsonb_build_object('cancelled',false,'receipt',receipt);end if;
 intent:=jsonb_build_object('id',p_id,'pet_id',p_pet_id,'expected_version',p_expected_version,'kind',p_kind,'values',p_values,'reason',p_reason);
 insert into public.imaging_study_actions(id,actor_id,intent,cancelled)values(p_action_id,actor,intent,true)on conflict(id)do nothing;
 perform public.clinical_dictation_actor(p_actor_id);
 return jsonb_build_object('cancelled',true,'receipt',null);
end $$;

-- A complete record request must disclose omitted imaging metadata. Vendor bearer links never leave via exports.
alter function public.record_request_inventory(uuid) rename to record_request_inventory_before_imaging;
create function public.record_request_inventory(p_pet_id uuid) returns jsonb language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare result jsonb;excluded jsonb;begin
 perform public.clinical_require_staff();result:=public.record_request_inventory_before_imaging(p_pet_id);
 if(select count(*)from public.imaging_studies where pet_id=p_pet_id)>10000 then raise exception 'Imaging census exceeds complete-capture capacity' using errcode='23514';end if;
 select coalesce(jsonb_agg(jsonb_build_object('family','imaging_study_ids','id',id,'label',"values"->>'description',
 'reason','Manual imaging metadata and private viewer link excluded; select the report PDF from patient documents when available')order by id),'[]')into excluded from public.imaging_studies where pet_id=p_pet_id;
 return jsonb_set(result,'{exclusions}',result->'exclusions'||excluded);
end $$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and(p.proname like 'imaging_%' or p.proname in('read_imaging_study','list_imaging_studies','list_imaging_history','recover_imaging_action','save_imaging_study','cancel_imaging_action','record_request_inventory','record_request_inventory_before_imaging'))loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in('read_imaging_study','list_imaging_studies','list_imaging_history','recover_imaging_action','save_imaging_study','cancel_imaging_action')then
   execute format('grant execute on function %s to authenticated',f.signature);
  end if;
 end loop;
end $$;
