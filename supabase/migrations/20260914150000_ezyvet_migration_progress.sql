-- Versioned digest over immutable resolved scope, independent of live child state.
create or replace function public.read_ezyvet_migration_run(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a uuid:=auth.uid();r public.ezyvet_migration_runs;result jsonb;scopes jsonb;basis jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into r from public.ezyvet_migration_runs where id=p_id and actor_id=a;
 if not found then return null;end if;
 -- Explicit fields freeze the v1 digest contract if table columns are added later.
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',s.id,'migration_run_id',s.migration_run_id,'mapping_id',s.mapping_id,'mapping_snapshot_id',s.mapping_snapshot_id,
  'mapping_head_version',s.mapping_head_version,'client_id',s.client_id,'pet_id',s.pet_id,'resource',s.resource,'parent_type',s.parent_type,
  'parent_snapshot_id',s.parent_snapshot_id,'parent_head_version',s.parent_head_version,'parent_external_id',s.parent_external_id,
  'parent_payload_hash',s.parent_payload_hash,'disposition',s.disposition,'reason',s.reason) order by s.id),'[]'::jsonb) into scopes
 from public.ezyvet_migration_scopes s where migration_run_id=r.id;
 basis:=jsonb_build_object('version',1,'run_id',r.id,'actor_id',r.actor_id,'source_origin',r.source_origin,'source_site_uid',r.source_site_uid,'intent_hash',r.intent_hash,'scopes',scopes);
 result:=jsonb_build_object('run',to_jsonb(r),'scopes',scopes,'scope_manifest_version',1,'scope_manifest_hash',encode(sha256(convert_to(basis::text,'UTF8')),'hex'));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return result;
end $$;

-- Live scan evidence only. This is not an accepted report or clinical review count.
create function public.read_ezyvet_migration_binding_progress(p_id uuid) returns jsonb
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
 select jsonb_build_object('version',1,'binding_id',x.binding_id,'scope_id',x.id,'migration_run_id',x.migration_run_id,'child_run_id',x.child_run_id,
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
  'attempt_history_available',false,'observed_at',statement_timestamp()) into result from owned x cross join counts n;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return result;
end $$;
revoke all on function public.read_ezyvet_migration_run(uuid),public.read_ezyvet_migration_binding_progress(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_ezyvet_migration_run(uuid),public.read_ezyvet_migration_binding_progress(uuid) to authenticated;
