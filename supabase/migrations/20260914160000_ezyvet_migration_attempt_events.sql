-- Capture transitions in the existing import transaction, including before binding.
-- No provider payload, credential or raw lease token is retained here.
create table public.ezyvet_migration_attempt_events (
 id uuid primary key default gen_random_uuid(),
 child_run_id uuid not null references public.ezyvet_import_runs(id),
 actor_id uuid not null references public.profiles(id),
 sequence integer not null check(sequence>0),
 event_key text not null unique check(event_key ~ '^[a-f0-9]{64}$'),
 kind text not null check(kind in ('baseline','claimed','page_staged','page_failed')),
 attempt_hash text check(attempt_hash ~ '^[a-f0-9]{64}$'),
 page integer not null check(page between 1 and 1001),
 run_status text not null check(run_status in ('running','review_ready','page_limit_reached')),
 next_page integer not null check(next_page between 1 and 1001),
 retry_after timestamptz,
 error_code text check(error_code ~ '^[A-Z_]{1,64}$'),
 staged_item_count integer check(staged_item_count between 0 and 50),
 history_origin text check(history_origin in ('run_created','migration_baseline')),
 recorded_at timestamptz not null default clock_timestamp(),
 unique(child_run_id,sequence),
 check((kind='baseline')=(history_origin is not null)),
 check(kind='baseline' or attempt_hash is not null),
 check((kind='page_staged')=(staged_item_count is not null)),
 check(kind<>'page_failed' or error_code is not null)
);
alter table public.ezyvet_migration_attempt_events enable row level security;
revoke all on public.ezyvet_migration_attempt_events from public,anon,authenticated,service_role;
create trigger immutable_migration_attempt before update or delete on public.ezyvet_migration_attempt_events
 for each row execute function public.guard_inquiry_history();

create function public.ezyvet_record_migration_attempt() returns trigger
language plpgsql security definer set search_path=public as $$
declare event_kind text;attempt text;event_page integer;item_count integer;origin text;code text;
begin
 if TG_OP='INSERT' then
  event_kind:='baseline';origin:='run_created';event_page:=NEW.next_page;
  attempt:=case when NEW.lease_id is not null then encode(sha256(convert_to(NEW.lease_id::text,'UTF8')),'hex') end;
 elsif NEW.lease_id is not null and NEW.lease_id is distinct from OLD.lease_id then
  event_kind:='claimed';event_page:=NEW.next_page;attempt:=encode(sha256(convert_to(NEW.lease_id::text,'UTF8')),'hex');
 elsif OLD.lease_id is not null and NEW.lease_id is null and NEW.next_page=OLD.next_page+1 then
  select p.item_count into item_count from public.ezyvet_import_pages p where p.run_id=NEW.id and p.page=OLD.next_page;
  if not found then return NEW;end if;
  event_kind:='page_staged';event_page:=OLD.next_page;attempt:=encode(sha256(convert_to(OLD.lease_id::text,'UTF8')),'hex');
 elsif OLD.lease_id is not null and NEW.lease_id is null and NEW.next_page=OLD.next_page and NEW.last_error_code is not null then
  event_kind:='page_failed';event_page:=OLD.next_page;attempt:=encode(sha256(convert_to(OLD.lease_id::text,'UTF8')),'hex');
 else return NEW;
 end if;
 if event_kind in ('baseline','page_failed') then
  code:=case when NEW.last_error_code is null then null when NEW.last_error_code ~ '^[A-Z_]{1,64}$' then NEW.last_error_code else 'UNCLASSIFIED_ERROR' end;
 end if;
 -- Source INSERT/UPDATE already serializes this run. No new claim or source locks.
 insert into public.ezyvet_migration_attempt_events(child_run_id,actor_id,sequence,event_key,kind,attempt_hash,page,run_status,next_page,retry_after,error_code,staged_item_count,history_origin)
 select NEW.id,NEW.requested_by,coalesce(max(e.sequence),0)+1,
  encode(sha256(convert_to(NEW.id::text||':'||event_kind||':'||coalesce(attempt,'baseline')||':'||event_page::text,'UTF8')),'hex'),
  event_kind,attempt,event_page,NEW.status,NEW.next_page,NEW.retry_after,code,item_count,origin
 from public.ezyvet_migration_attempt_events e where e.child_run_id=NEW.id
 on conflict(event_key) do nothing;
 return NEW;
end $$;
revoke all on function public.ezyvet_record_migration_attempt() from public,anon,authenticated,service_role;
create trigger capture_migration_attempt after insert or update on public.ezyvet_import_runs
 for each row execute function public.ezyvet_record_migration_attempt();

-- CREATE TRIGGER locks the source relation until this migration commits, so there
-- is no gap between this baseline and transactional recording of later updates.
insert into public.ezyvet_migration_attempt_events(child_run_id,actor_id,sequence,event_key,kind,attempt_hash,page,run_status,next_page,retry_after,error_code,history_origin)
select r.id,r.requested_by,1,encode(sha256(convert_to(r.id::text||':migration_baseline','UTF8')),'hex'),'baseline',
 case when r.lease_id is not null then encode(sha256(convert_to(r.lease_id::text,'UTF8')),'hex') end,
 r.next_page,r.status,r.next_page,r.retry_after,
 case when r.last_error_code is null then null when r.last_error_code ~ '^[A-Z_]{1,64}$' then r.last_error_code else 'UNCLASSIFIED_ERROR' end,'migration_baseline'
from public.ezyvet_import_runs r;

create function public.list_ezyvet_migration_attempt_events(p_binding_id uuid,p_before_sequence integer default null,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a uuid:=auth.uid();child uuid;scope uuid;result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_binding_id is null or p_limit is null or p_limit not between 1 and 100 or (p_before_sequence is not null and p_before_sequence<1) then raise exception 'Invalid attempt history cursor' using errcode='23514';end if;
 select b.child_run_id,b.scope_id into child,scope from public.ezyvet_migration_bindings b
 join public.ezyvet_migration_scopes s on s.id=b.scope_id join public.ezyvet_migration_runs r on r.id=s.migration_run_id
 join public.ezyvet_import_runs c on c.id=b.child_run_id
 where b.id=p_binding_id and b.actor_id=a and r.actor_id=a and c.requested_by=a;
 if not found then raise exception 'Owned migration binding required' using errcode='42501';end if;
 with candidates as materialized (
  select id,sequence,kind,attempt_hash,page,run_status,next_page,retry_after,error_code,staged_item_count,history_origin,recorded_at
  from public.ezyvet_migration_attempt_events where child_run_id=child and actor_id=a and (p_before_sequence is null or sequence<p_before_sequence)
  order by sequence desc limit p_limit+1
 ), page as (select * from candidates order by sequence desc limit p_limit)
 select jsonb_build_object('version',1,'binding_id',p_binding_id,'scope_id',scope,'child_run_id',child,
  'events',coalesce((select jsonb_agg(to_jsonb(p) order by sequence desc) from page p),'[]'::jsonb),
  'has_more',(select count(*)>p_limit from candidates)) into result;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return result;
end $$;
revoke all on function public.list_ezyvet_migration_attempt_events(uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_ezyvet_migration_attempt_events(uuid,integer,integer) to authenticated;

create or replace function public.read_ezyvet_migration_binding_progress(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a uuid:=auth.uid();result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 -- One statement gives context, observations and current heads one MVCC snapshot.
 with owned as materialized (
  select b.id binding_id,b.child_run_id,b.context_hash,b.child_context,s.*,r.source_origin,r.source_site_uid,c.status,c.next_page,c.retry_after,c.last_error_code,
   exists(select 1 from public.ezyvet_migration_bindings newer where newer.replaces_id=b.id) superseded
  from public.ezyvet_migration_bindings b join public.ezyvet_migration_scopes s on s.id=b.scope_id
  join public.ezyvet_migration_runs r on r.id=s.migration_run_id join public.ezyvet_import_runs c on c.id=b.child_run_id
  where b.id=p_id and b.actor_id=a and r.actor_id=a and c.requested_by=a
 ), observed as materialized (
  select o.page,o.ordinal,o.snapshot_id,o.head_version from owned x join public.ezyvet_attachment_page_observations o on o.run_id=x.child_run_id where x.resource='attachment'
  union all select o.page,null,o.snapshot_id,o.head_version from owned x join public.ezyvet_clinical_page_observations o on o.run_id=x.child_run_id where x.resource in ('consult','history')
  union all select o.page,null,o.snapshot_id,o.head_version from owned x join public.ezyvet_vaccination_page_observations o on o.run_id=x.child_run_id where x.resource='vaccination'
  union all select o.page,null,o.snapshot_id,o.head_version from owned x join public.ezyvet_prescription_page_observations o on o.run_id=x.child_run_id where x.resource='prescription'
  union all select o.page,null,o.snapshot_id,o.head_version from owned x join public.ezyvet_prescriptionitem_page_observations o on o.run_id=x.child_run_id where x.resource='prescriptionitem'
  union all select o.page,null,o.snapshot_id,null from owned x join public.ezyvet_import_page_items o on o.run_id=x.child_run_id
   join public.ezyvet_import_snapshots snap on snap.id=o.snapshot_id
   where x.resource in ('contact','animal','healthstatus') and snap.resource=x.resource and snap.source_origin=x.source_origin and snap.source_site_uid=x.source_site_uid
    and (x.resource='healthstatus' or snap.external_id=x.parent_external_id)
 ), counts as (
  select count(*) occurrences,count(distinct (snap.source_origin,snap.source_site_uid,snap.resource,snap.external_id)) identities,
   count(distinct o.snapshot_id) snapshots,
   count(*) filter(where o.head_version is not null and h.snapshot_id=o.snapshot_id and h.version=o.head_version) current_occurrences
  from observed o join public.ezyvet_import_snapshots snap on snap.id=o.snapshot_id
  left join public.ezyvet_identity_heads h on h.source_origin=snap.source_origin and h.source_site_uid=snap.source_site_uid and h.resource=snap.resource and h.external_id=snap.external_id
 )
 select jsonb_build_object('version',2,'binding_id',x.binding_id,'scope_id',x.id,'migration_run_id',x.migration_run_id,'child_run_id',x.child_run_id,
  'resource',x.resource,'context_hash',x.context_hash,'superseded',x.superseded,
  'parent_evidence',x.child_context->>'parent_evidence',
  'parent_current',exists(select 1 from public.ezyvet_identity_heads h where h.source_origin=x.source_origin and h.source_site_uid=x.source_site_uid and h.resource=x.parent_type and h.external_id=x.parent_external_id and h.snapshot_id=x.parent_snapshot_id and h.version=x.parent_head_version),
  'household_current',case when x.pet_id is null then exists(select 1 from public.clients where id=x.client_id) else exists(select 1 from public.pets where id=x.pet_id and client_id=x.client_id) end,
  'scan',jsonb_build_object('status',x.status,'next_page',x.next_page,'pages_observed',(select count(*) from public.ezyvet_import_pages where run_id=x.child_run_id),
   'traversal_ended',x.status='review_ready','page_limit_reached',x.status='page_limit_reached','retry_after',x.retry_after,'latest_error_code',x.last_error_code,'provider_total',null,'complete_coverage_verified',false),
  'observations',jsonb_build_object('occurrences',n.occurrences,'distinct_source_identities',n.identities,'distinct_snapshot_versions',n.snapshots,
   'occurrence_fidelity',case when x.resource='attachment' then 'page_ordinal' else 'deduplicated_page_snapshot' end,
   'exact_current_occurrences',case when x.resource in ('contact','animal','healthstatus') then null else n.current_occurrences end,
   'currentness_available',x.resource not in ('contact','animal','healthstatus')),
  'clinical_review',jsonb_build_object('reconciled',false,'approved_local_outcomes',null),
  'attempt_history_available',exists(select 1 from public.ezyvet_migration_attempt_events e where e.child_run_id=x.child_run_id and e.actor_id=a and e.kind='baseline'),
  'attempt_history',jsonb_build_object(
   'origin',(select e.history_origin from public.ezyvet_migration_attempt_events e where e.child_run_id=x.child_run_id and e.actor_id=a and e.kind='baseline'),
   'started_at',(select e.recorded_at from public.ezyvet_migration_attempt_events e where e.child_run_id=x.child_run_id and e.actor_id=a and e.kind='baseline'),
   'complete_since_run_creation',exists(select 1 from public.ezyvet_migration_attempt_events e where e.child_run_id=x.child_run_id and e.actor_id=a and e.history_origin='run_created'),
   'claims',(select count(*) from public.ezyvet_migration_attempt_events e where e.child_run_id=x.child_run_id and e.actor_id=a and e.kind='claimed'),
   'failed_pages',(select count(*) from public.ezyvet_migration_attempt_events e where e.child_run_id=x.child_run_id and e.actor_id=a and e.kind='page_failed'),
   'staged_pages',(select count(*) from public.ezyvet_migration_attempt_events e where e.child_run_id=x.child_run_id and e.actor_id=a and e.kind='page_staged')),
  'observed_at',statement_timestamp()) into result from owned x cross join counts n;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return result;
end $$;
revoke all on function public.read_ezyvet_migration_binding_progress(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_ezyvet_migration_binding_progress(uuid) to authenticated;
