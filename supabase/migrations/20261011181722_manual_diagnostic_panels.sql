-- Native documentary diagnostics. PDF/release integration is deliberately uncommissioned.
create table public.diagnostic_panels (
 id uuid primary key,pet_id uuid not null references public.pets(id),version integer not null default 1 check(version>0),
 draft jsonb,draft_entered_name text not null default '',current_finalized_id uuid,current_finalized_number integer not null default 0 check(current_finalized_number>=0),
 created_by uuid not null references public.profiles(id),updated_by uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(id,pet_id),check((current_finalized_id is null)=(current_finalized_number=0)),check(draft is not null or current_finalized_id is not null)
);
create index diagnostic_panels_pet_idx on public.diagnostic_panels(pet_id,updated_at desc,id desc);
create index diagnostic_panels_trends_idx on public.diagnostic_panels(pet_id,id) where current_finalized_id is not null;
create table public.diagnostic_panel_versions (
 id uuid primary key,panel_id uuid not null,pet_id uuid not null,number integer not null check(number>0),
 predecessor_id uuid,snapshot jsonb not null,source_context jsonb not null,source_hash text not null check(source_hash~'^[a-f0-9]{64}$'),
 correction_reason text not null default '' check(length(correction_reason)<=2000),review_note text not null check(length(trim(review_note)) between 1 and 2000),
 entered_by uuid not null references public.profiles(id),entered_by_name text not null,reviewed_by uuid not null references public.profiles(id),reviewer_name text not null check(length(trim(reviewer_name))>0),reviewed_at timestamptz not null default clock_timestamp(),
 unique(id,panel_id),unique(panel_id,number),foreign key(panel_id,pet_id) references public.diagnostic_panels(id,pet_id),
 foreign key(predecessor_id,panel_id) references public.diagnostic_panel_versions(id,panel_id),check((number=1 and predecessor_id is null and correction_reason='') or (number>1 and predecessor_id is not null and length(trim(correction_reason))>0))
);
alter table public.diagnostic_panels add constraint diagnostic_current_version_fk foreign key(current_finalized_id,id) references public.diagnostic_panel_versions(id,panel_id);
create table public.diagnostic_panel_actions (
 id uuid primary key,panel_id uuid not null references public.diagnostic_panels(id),pet_id uuid not null references public.pets(id),
 actor_id uuid not null references public.profiles(id),intent jsonb not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create table public.diagnostic_panel_revisions (
 panel_id uuid not null references public.diagnostic_panels(id),version integer not null,snapshot jsonb not null,
 actor_id uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp(),primary key(panel_id,version)
);
create function public.diagnostic_immutable() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Diagnostic evidence is immutable' using errcode='23514';end $$;
create function public.diagnostic_root_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();begin
 if TG_OP='DELETE' then raise exception 'Diagnostic history cannot be deleted' using errcode='23514';end if;
 if TG_OP='UPDATE' then
  if row(NEW.id,NEW.pet_id,NEW.created_by,NEW.created_at) is distinct from row(OLD.id,OLD.pet_id,OLD.created_by,OLD.created_at) then raise exception 'Diagnostic patient identity is immutable' using errcode='23514';end if;
  NEW.version:=OLD.version+1;
 else NEW.version:=1;NEW.created_by:=actor;NEW.created_at:=clock_timestamp();end if;
 if NEW.draft is not null then select coalesce(full_name,'') into NEW.draft_entered_name from public.profiles where id=actor;else NEW.draft_entered_name:=OLD.draft_entered_name;end if;
 NEW.updated_by:=actor;NEW.updated_at:=clock_timestamp();return NEW;
end $$;
create trigger diagnostic_root_guard before insert or update or delete on public.diagnostic_panels for each row execute function public.diagnostic_root_guard();
create function public.diagnostic_revision() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.diagnostic_panel_revisions(panel_id,version,snapshot,actor_id) values(NEW.id,NEW.version,to_jsonb(NEW),NEW.updated_by);return NEW;end $$;
create trigger diagnostic_revision after insert or update on public.diagnostic_panels for each row execute function public.diagnostic_revision();
do $$declare t text;begin foreach t in array array['diagnostic_panel_versions','diagnostic_panel_actions','diagnostic_panel_revisions'] loop
 execute format('create trigger diagnostic_immutable before update or delete on public.%I for each row execute function public.diagnostic_immutable()',t);
end loop;
foreach t in array array['diagnostic_panels','diagnostic_panel_versions','diagnostic_panel_actions','diagnostic_panel_revisions'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
end loop;end $$;

create function public.diagnostic_validate(p_values jsonb) returns jsonb language plpgsql immutable set search_path=public as $$
declare o jsonb;lo numeric;hi numeric;a date;b date;k text;keys text[]:=array['panel_name','category','collected_on','reported_on','specimen','method','source','interpretation','observations','lab_order_id','lab_order_version','encounter_id','encounter_version','document_id','document_version'];
begin
 if jsonb_typeof(p_values) is distinct from 'object' or p_values-keys<>'{}' or not p_values?&keys or octet_length(p_values::text)>131072 then raise exception 'Bounded complete diagnostic fields required' using errcode='23514';end if;
 foreach k in array array['panel_name','specimen','method','source'] loop
  if jsonb_typeof(p_values->k) is distinct from 'string' or length(trim(p_values->>k)) not between 1 and 160 or trim(p_values->>k)<>p_values->>k then raise exception 'Diagnostic labels must be nonempty exact text' using errcode='23514';end if;
 end loop;
 if jsonb_typeof(p_values->'category') is distinct from 'string' or p_values->>'category' not in ('laboratory','other') or jsonb_typeof(p_values->'interpretation') is distinct from 'string' or length(p_values->>'interpretation')>4000 then raise exception 'Diagnostic category or interpretation invalid' using errcode='23514';end if;
 if jsonb_typeof(p_values->'collected_on') is distinct from 'string' or jsonb_typeof(p_values->'reported_on') is distinct from 'string' or p_values->>'collected_on'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or p_values->>'reported_on'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Diagnostic calendar dates required' using errcode='23514';end if;
 begin a:=(p_values->>'collected_on')::date;b:=(p_values->>'reported_on')::date;exception when others then raise exception 'Invalid diagnostic calendar date' using errcode='23514';end;
 if not isfinite(a) or not isfinite(b) or b<a or to_char(a,'YYYY-MM-DD')<>p_values->>'collected_on' or to_char(b,'YYYY-MM-DD')<>p_values->>'reported_on' then raise exception 'Report date must follow collection date' using errcode='23514';end if;
 foreach k in array array['lab_order','encounter','document'] loop
  if (p_values->(k||'_id')='null')<>(p_values->(k||'_version')='null') then raise exception 'Source identity and reviewed version required together' using errcode='23514';end if;
  if p_values->(k||'_id')<>'null' then
   perform public.native_rx_uuid(p_values->(k||'_id'));
   if jsonb_typeof(p_values->(k||'_version')) is distinct from 'number' or (p_values->>(k||'_version'))!~'^[1-9][0-9]{0,8}$' then raise exception 'Positive source version required' using errcode='23514';end if;
  end if;
 end loop;
 if jsonb_typeof(p_values->'observations') is distinct from 'array' or jsonb_array_length(p_values->'observations') not between 1 and 100 then raise exception 'One to 100 diagnostic findings required' using errcode='23514';end if;
 for o in select value from jsonb_array_elements(p_values->'observations') loop
  keys:=array['id','analyte_key','label','kind','value_number','value_text','unit','reference_low','reference_high','reference_text','source_flag'];
  if jsonb_typeof(o) is distinct from 'object' or o-keys<>'{}' or not o?&keys then raise exception 'Exact diagnostic finding fields required' using errcode='23514';end if;
  perform public.native_rx_uuid(o->'id');
  foreach k in array array['analyte_key','label'] loop
   if jsonb_typeof(o->k) is distinct from 'string' or length(trim(o->>k)) not between 1 and 160 or trim(o->>k)<>o->>k then raise exception 'Exact finding identity and original label required' using errcode='23514';end if;
  end loop;
  if o->>'kind'='numeric' then
   if jsonb_typeof(o->'value_number') is distinct from 'number' or o->'value_text'<>'null' or jsonb_typeof(o->'unit') is distinct from 'string' or length(trim(o->>'unit')) not between 1 and 40 or trim(o->>'unit')<>o->>'unit' then raise exception 'Numeric finding requires finite number and explicit original unit' using errcode='23514';end if;
   if abs((o->>'value_number')::numeric)>1e100 or ((o->>'value_number')::numeric<>0 and abs((o->>'value_number')::numeric)<1e-100) then raise exception 'Diagnostic value exceeds numeric capacity' using errcode='23514';end if;
  elsif o->>'kind'='qualitative' then
   if o->'value_number'<>'null' or jsonb_typeof(o->'value_text') is distinct from 'string' or length(trim(o->>'value_text')) not between 1 and 1000 or o->'unit'<>'null' or o->'reference_low'<>'null' or o->'reference_high'<>'null' then raise exception 'Qualitative finding requires text without numeric fields' using errcode='23514';end if;
  else raise exception 'Explicit numeric or qualitative finding kind required' using errcode='23514';end if;
  lo:=null;hi:=null;
  foreach k in array array['reference_low','reference_high'] loop
   if o->k<>'null' then
    if jsonb_typeof(o->k) is distinct from 'number' or abs((o->>k)::numeric)>1e100 or ((o->>k)::numeric<>0 and abs((o->>k)::numeric)<1e-100) then raise exception 'Finite manually entered reference bound required' using errcode='23514';end if;
    if k='reference_low' then lo:=(o->>k)::numeric;else hi:=(o->>k)::numeric;end if;
   end if;
  end loop;
  if lo>hi then raise exception 'Reference bounds are reversed' using errcode='23514';end if;
  foreach k in array array['reference_text','source_flag'] loop
   if jsonb_typeof(o->k) is distinct from 'string' or length(o->>k)>1000 then raise exception 'Bounded documentary reference and source flag required' using errcode='23514';end if;
  end loop;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_values->'observations') finding group by finding->>'id' having count(*)>1) or exists(select 1 from jsonb_array_elements(p_values->'observations') finding group by finding->>'analyte_key' having count(*)>1) then raise exception 'Finding IDs and analyte identities must be unique within a panel' using errcode='23514';end if;
 return p_values;
end $$;
create function public.diagnostic_sources(p_pet_id uuid,p_values jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare context jsonb:='{}';o public.patient_lab_orders;e public.clinical_encounters;d public.patient_documents;
begin
 if p_values->'lab_order_id'<>'null' then
  select * into o from public.patient_lab_orders where id=(p_values->>'lab_order_id')::uuid for share;
  if not found or o.pet_id<>p_pet_id then raise exception 'Diagnostic order belongs to another patient or is unavailable' using errcode='42501';end if;
  if o.version<>(p_values->>'lab_order_version')::integer or o.status='cancelled' then raise exception 'Diagnostic order changed; review its current version' using errcode='PT409';end if;
  context:=context||jsonb_build_object('lab_order',jsonb_build_object('id',o.id,'version',o.version,'test_name',o.test_name));
 end if;
 if p_values->'encounter_id'<>'null' then
  select * into e from public.clinical_encounters where id=(p_values->>'encounter_id')::uuid for share;
  if not found or e.pet_id<>p_pet_id then raise exception 'Diagnostic encounter belongs to another patient or is unavailable' using errcode='42501';end if;
  if e.version<>(p_values->>'encounter_version')::integer then raise exception 'Diagnostic encounter changed; review its current version' using errcode='PT409';end if;
  context:=context||jsonb_build_object('encounter',jsonb_build_object('id',e.id,'version',e.version,'visit_at',e.visit_at));
 end if;
 if p_values->'document_id'<>'null' then
  select * into d from public.patient_documents where id=(p_values->>'document_id')::uuid for share;
  if not found or d.pet_id<>p_pet_id then raise exception 'Diagnostic original belongs to another patient or is unavailable' using errcode='42501';end if;
  if d.version<>(p_values->>'document_version')::integer or d.status<>'ready' or not exists(select 1 from storage.objects x where x.bucket_id='patient-documents' and x.name=d.file_path and x.metadata->>'size'=d.file_size::text and x.metadata->>'mimetype'=d.mime_type) then raise exception 'Diagnostic original changed or is not finalized' using errcode='PT409';end if;
  context:=context||jsonb_build_object('document',jsonb_build_object('id',d.id,'version',d.version,'file_name',d.file_name,'file_size',d.file_size,'mime_type',d.mime_type));
 end if;
 return context;
end $$;
create function public.diagnostic_detail(p_id uuid,p_pet_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('panel',to_jsonb(p),'current',case when v.id is null then null else to_jsonb(v)||jsonb_build_object('original_current_available',case when v.snapshot->'document_id'='null' then null else exists(select 1 from public.patient_documents d join storage.objects x on x.bucket_id='patient-documents' and x.name=d.file_path where d.id=(v.snapshot->>'document_id')::uuid and d.pet_id=p.pet_id and d.version=(v.snapshot->>'document_version')::integer and d.status='ready' and x.metadata->>'size'=d.file_size::text and x.metadata->>'mimetype'=d.mime_type) end) end,'pdf_status','not_available','export_eligible',false)
 from public.diagnostic_panels p left join public.diagnostic_panel_versions v on v.id=p.current_finalized_id where p.id=p_id and p.pet_id=p_pet_id
$$;
create function public.read_diagnostic_panel(p_id uuid,p_pet_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
begin perform public.clinical_require_staff();return public.diagnostic_detail(p_id,p_pet_id);end $$;
create function public.read_diagnostic_action(p_action_id uuid,p_id uuid,p_pet_id uuid,p_expected_version integer,p_kind text,p_values jsonb,p_review_note text,p_correction_reason text) returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.diagnostic_panel_actions;actor uuid:=public.clinical_require_staff();intent jsonb:=jsonb_build_object('kind',p_kind,'version',p_expected_version,'values',p_values,'review_note',p_review_note,'correction_reason',p_correction_reason);
begin select * into a from public.diagnostic_panel_actions where id=p_action_id;if not found then return null;end if;
 if a.actor_id<>actor or a.panel_id<>p_id or a.pet_id<>p_pet_id or a.intent is distinct from intent then raise exception 'Diagnostic action conflicts with saved work' using errcode='23505';end if;return a.receipt;
end $$;
create function public.save_diagnostic_panel(p_action_id uuid,p_id uuid,p_pet_id uuid,p_expected_version integer,p_kind text,p_values jsonb,p_review_note text default '',p_correction_reason text default '') returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();r public.diagnostic_panels;v public.diagnostic_panel_versions;old_version public.diagnostic_panel_versions;recovered jsonb;result jsonb;context jsonb;intent jsonb;pat public.pets;reviewer text;reviewed_time timestamptz;
begin
 if p_action_id is null or p_id is null or p_pet_id is null or p_kind is null or p_kind not in ('draft','finalize') or p_review_note is null or p_correction_reason is null then raise exception 'Stable diagnostic action identity required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_action_id::text,417));
 recovered:=public.read_diagnostic_action(p_action_id,p_id,p_pet_id,p_expected_version,p_kind,p_values,p_review_note,p_correction_reason);if recovered is not null then return recovered;end if;
 perform public.diagnostic_validate(p_values);
 -- Diagnostic root before read-only order/encounter/original locks; no request locks are acquired.
 select * into pat from public.pets where id=p_pet_id for share;if not found then raise exception 'Diagnostic patient unavailable' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,418));select * into r from public.diagnostic_panels where id=p_id for update;
 if found then
  if r.pet_id<>p_pet_id then raise exception 'Diagnostic panel belongs to another patient' using errcode='42501';end if;
  if p_expected_version is distinct from r.version then raise exception 'Diagnostic panel changed; reload before resolving your draft' using errcode='PT409';end if;
 else
  if p_expected_version is not null or p_kind<>'draft' then raise exception 'Save a diagnostic draft before finalization' using errcode='PT409';end if;
 end if;
 context:=public.diagnostic_sources(p_pet_id,p_values);perform public.clinical_require_staff();
 if p_kind='draft' then
  if p_review_note<>'' or p_correction_reason<>'' then raise exception 'Draft save cannot claim clinical review' using errcode='23514';end if;
  if r.id is null then insert into public.diagnostic_panels(id,pet_id,draft,created_by,updated_by) values(p_id,p_pet_id,p_values,actor,actor) returning * into r;
  else update public.diagnostic_panels set draft=p_values where id=p_id returning * into r;end if;
 else
  perform public.care_require_clinician();
  if r.draft is null or r.draft is distinct from p_values then raise exception 'Finalize only the exact saved diagnostic draft' using errcode='PT409';end if;
  if length(trim(p_review_note)) not between 1 and 2000 or trim(p_review_note)<>p_review_note or length(p_correction_reason)>2000 or trim(p_correction_reason)<>p_correction_reason or (r.current_finalized_id is null and p_correction_reason<>'') or (r.current_finalized_id is not null and length(p_correction_reason)=0) then raise exception 'Explicit exact review and correction reason required' using errcode='23514';end if;
  if (p_values->>'reported_on')::date>(clock_timestamp() at time zone 'America/Denver')::date then raise exception 'Future diagnostic result cannot be finalized' using errcode='23514';end if;
  if r.current_finalized_id is not null then select * into strict old_version from public.diagnostic_panel_versions where id=r.current_finalized_id; if old_version.snapshot=p_values then raise exception 'Correction must change reviewed findings' using errcode='23514';end if;end if;
  select full_name into reviewer from public.profiles where id=actor;reviewed_time:=clock_timestamp();
  insert into public.diagnostic_panel_versions(id,panel_id,pet_id,number,predecessor_id,snapshot,source_context,source_hash,correction_reason,review_note,entered_by,entered_by_name,reviewed_by,reviewer_name,reviewed_at)
  values(p_action_id,p_id,p_pet_id,r.current_finalized_number+1,r.current_finalized_id,p_values,context,encode(extensions.digest(convert_to(jsonb_build_object('version_id',p_action_id,'panel_id',p_id,'pet_id',p_pet_id,'number',r.current_finalized_number+1,'values',p_values,'sources',context,'predecessor',r.current_finalized_id,'entered_by',r.updated_by,'entered_by_name',r.draft_entered_name,'reviewed_by',actor,'reviewer_name',reviewer,'reviewed_at',reviewed_time,'review_note',p_review_note,'correction_reason',p_correction_reason)::text,'UTF8'),'sha256'),'hex'),p_correction_reason,p_review_note,r.updated_by,r.draft_entered_name,actor,reviewer,reviewed_time) returning * into v;
  update public.diagnostic_panels set draft=null,current_finalized_id=v.id,current_finalized_number=v.number where id=p_id returning * into r;
 end if;
 result:=public.diagnostic_detail(p_id,p_pet_id);intent:=jsonb_build_object('kind',p_kind,'version',p_expected_version,'values',p_values,'review_note',p_review_note,'correction_reason',p_correction_reason);
 insert into public.diagnostic_panel_actions(id,panel_id,pet_id,actor_id,intent,receipt) values(p_action_id,p_id,p_pet_id,actor,intent,result);return result;
end $$;
create function public.list_diagnostic_panels(p_pet_id uuid,p_before jsonb default null,p_limit integer default 20) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;begin perform public.clinical_require_staff();
 if p_pet_id is null or p_limit is null or p_limit not between 1 and 50 or (p_before is not null and (jsonb_typeof(p_before)<>'object' or p_before-array['id','updated_at']<>'{}' or not p_before?&array['id','updated_at'])) then raise exception 'Bounded diagnostic cursor required' using errcode='23514';end if;
 with rows as materialized (select * from public.diagnostic_panels where pet_id=p_pet_id and (p_before is null or row(updated_at,id)<row((p_before->>'updated_at')::timestamptz,public.native_rx_uuid(p_before->'id'))) order by updated_at desc,id desc limit p_limit+1),page as(select * from rows order by updated_at desc,id desc limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(public.diagnostic_detail(id,pet_id) order by updated_at desc,id desc) from page),'[]'),'next',case when (select count(*) from rows)>p_limit then (select jsonb_build_object('updated_at',updated_at,'id',id) from page order by updated_at,id limit 1) else null end) into result;return result;
end $$;
create function public.list_diagnostic_history(p_id uuid,p_pet_id uuid,p_before integer default null,p_limit integer default 20) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;begin perform public.clinical_require_staff();
 if p_limit is null or p_limit not between 1 and 50 or p_before<1 then raise exception 'Bounded diagnostic history required' using errcode='23514';end if;
 if not exists(select 1 from public.diagnostic_panels where id=p_id and pet_id=p_pet_id) then return jsonb_build_object('items','[]'::jsonb,'next',null);end if;
 with rows as materialized(select v.* from public.diagnostic_panel_versions v where v.panel_id=p_id and v.pet_id=p_pet_id and (p_before is null or v.number<p_before) order by v.number desc limit p_limit+1),page as(select * from rows order by number desc limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page) order by number desc) from page),'[]'),'next',case when (select count(*) from rows)>p_limit then (select min(number) from page) else null end) into result;return result;
end $$;
-- A paginated census of current finalized versions, not drafts or superseded values.
create function public.list_diagnostic_trends(p_pet_id uuid,p_after uuid default null,p_limit integer default 50,p_census_hash text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;begin
 perform public.clinical_require_staff();if p_pet_id is null or p_limit is null or p_limit not between 1 and 100 then raise exception 'Bounded diagnostic trend page required' using errcode='23514';end if;
 -- Fingerprint and rows share this single SQL statement snapshot, including concurrent corrections.
 with census as materialized(select id,current_finalized_id from public.diagnostic_panels where pet_id=p_pet_id and current_finalized_id is not null order by id limit 10001),
 meta as(select count(*) total,encode(sha256(convert_to(coalesce(string_agg(id::text||':'||current_finalized_id::text,'|' order by id),''),'UTF8')),'hex') hash from census),
 rows as materialized(select v.* from census p join public.diagnostic_panel_versions v on v.id=p.current_finalized_id where p_after is null or p.id>p_after order by p.id limit p_limit+1),
 page as(select * from rows order by panel_id limit p_limit)
 select jsonb_build_object('total',(select total from meta),'census_hash',(select hash from meta),'items',coalesce((select jsonb_agg(to_jsonb(page) order by panel_id) from page),'[]'),'next',case when (select count(*) from rows)>p_limit then (select max(panel_id::text)::uuid from page) else null end) into result;
 if (result->>'total')::integer>10000 then raise exception 'Diagnostic trend census exceeds capacity; no partial history returned' using errcode='23514';end if;
 if (p_after is not null and p_census_hash is null) or (p_census_hash is not null and p_census_hash is distinct from result->>'census_hash') then raise exception 'Diagnostic trend census changed; reload the complete series' using errcode='PT409';end if;
 perform public.clinical_require_staff();return result-'total';
end $$;
-- Complete record requests must explain every omitted native diagnostic, including drafts.
alter function public.record_request_inventory(uuid) rename to record_request_inventory_before_diagnostics;
create function public.record_request_inventory(p_pet_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;excluded jsonb;n integer;begin perform public.clinical_require_staff();result:=public.record_request_inventory_before_diagnostics(p_pet_id);
 select count(*) into n from public.diagnostic_panels where pet_id=p_pet_id;if n>10000 then raise exception 'Diagnostic census exceeds complete-capture capacity; no partial manifest was created' using errcode='23514';end if;
 select coalesce(jsonb_agg(jsonb_build_object('family','diagnostic_panel_ids','id',p.id,'label',coalesce(p.draft->>'panel_name',v.snapshot->>'panel_name'),'reason',case when p.current_finalized_id is null then 'Unfinalized diagnostic draft' else 'Structured diagnostics await verified PDF and reviewed release support' end) order by p.id),'[]') into excluded from public.diagnostic_panels p left join public.diagnostic_panel_versions v on v.id=p.current_finalized_id where p.pet_id=p_pet_id;
 return jsonb_set(result,'{exclusions}',result->'exclusions'||excluded);
end $$;
-- Explicit ACLs; private helpers are never staff endpoints.
do $$declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'diagnostic_%' or p.proname in ('read_diagnostic_panel','read_diagnostic_action','save_diagnostic_panel','list_diagnostic_panels','list_diagnostic_history','list_diagnostic_trends','record_request_inventory_before_diagnostics','record_request_inventory')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.proname in ('read_diagnostic_panel','read_diagnostic_action','save_diagnostic_panel','list_diagnostic_panels','list_diagnostic_history','list_diagnostic_trends') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
