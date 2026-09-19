-- Bounded source-evidence drill-down. Live currentness never rewrites an observation.
-- No payloads, original bytes, clinical promotion or coverage acceptance are returned.
create function public.list_ezyvet_migration_items(p_binding_id uuid,p_after_page integer default null,p_after_ordinal integer default null,p_after_snapshot_id uuid default null,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a uuid:=auth.uid();result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_binding_id is null or p_limit is null or p_limit not between 1 and 100
  or num_nonnulls(p_after_page,p_after_ordinal,p_after_snapshot_id) not in (0,3)
  or p_after_page not between 1 and 1000 or p_after_ordinal not between 0 and 10 then raise exception 'Invalid migration item cursor' using errcode='23514';end if;
 -- Context, bounded observations and current heads share one statement snapshot.
 with owned as materialized (
  select b.id binding_id,b.child_run_id,b.context_hash,s.*,r.source_origin,r.source_site_uid,
   exists(select 1 from public.ezyvet_migration_bindings newer where newer.replaces_id=b.id) superseded,
   exists(select 1 from public.ezyvet_record_links m where m.id=s.mapping_id and m.snapshot_id=s.mapping_snapshot_id and m.head_version=s.mapping_head_version
    and m.source_origin=r.source_origin and m.source_site_uid=r.source_site_uid and m.client_id=s.client_id and m.pet_id is not distinct from s.pet_id) mapping_matches_manifest,
   exists(select 1 from public.ezyvet_record_links m join public.ezyvet_identity_heads h using(source_origin,source_site_uid,resource,external_id)
    where m.id=s.mapping_id and h.snapshot_id=s.mapping_snapshot_id and h.version=s.mapping_head_version) mapping_source_current,
   exists(select 1 from public.ezyvet_identity_heads h where h.source_origin=r.source_origin and h.source_site_uid=r.source_site_uid and h.resource=s.parent_type and h.external_id=s.parent_external_id and h.snapshot_id=s.parent_snapshot_id and h.version=s.parent_head_version) parent_current,
   case when s.pet_id is null then exists(select 1 from public.clients where id=s.client_id) else exists(select 1 from public.pets where id=s.pet_id and client_id=s.client_id) end household_current
  from public.ezyvet_migration_bindings b join public.ezyvet_migration_scopes s on s.id=b.scope_id
  join public.ezyvet_migration_runs r on r.id=s.migration_run_id join public.ezyvet_import_runs c on c.id=b.child_run_id
  where b.id=p_binding_id and b.actor_id=a and r.actor_id=a and c.requested_by=a
 ), observed as (
  select o.page,o.ordinal,o.snapshot_id,o.head_version,o.file_id,o.raw_record_sha256,o.stable_metadata_sha256 from owned x join public.ezyvet_attachment_page_observations o on o.run_id=x.child_run_id where x.resource='attachment'
  union all select o.page,0,o.snapshot_id,o.head_version,null,null,null from owned x join public.ezyvet_clinical_page_observations o on o.run_id=x.child_run_id where x.resource in ('consult','history')
  union all select o.page,0,o.snapshot_id,o.head_version,null,null,null from owned x join public.ezyvet_vaccination_page_observations o on o.run_id=x.child_run_id where x.resource='vaccination'
  union all select o.page,0,o.snapshot_id,o.head_version,null,null,null from owned x join public.ezyvet_prescription_page_observations o on o.run_id=x.child_run_id where x.resource='prescription'
  union all select o.page,0,o.snapshot_id,o.head_version,null,null,null from owned x join public.ezyvet_prescriptionitem_page_observations o on o.run_id=x.child_run_id where x.resource='prescriptionitem'
  union all select o.page,0,o.snapshot_id,null,null,null,null from owned x join public.ezyvet_import_page_items o on o.run_id=x.child_run_id
   join public.ezyvet_import_snapshots s on s.id=o.snapshot_id where x.resource in ('contact','animal','healthstatus') and s.resource=x.resource
    and s.source_origin=x.source_origin and s.source_site_uid=x.source_site_uid and (x.resource='healthstatus' or s.external_id=x.parent_external_id)
 ), bounded as materialized (
  select * from observed o where p_after_page is null or (o.page,o.ordinal,o.snapshot_id)>(p_after_page,p_after_ordinal,p_after_snapshot_id)
  order by o.page,o.ordinal,o.snapshot_id limit p_limit+1
 ), selected as (
  select * from bounded order by page,ordinal,snapshot_id limit p_limit
 ), items as (
  select o.page,o.ordinal,o.snapshot_id,jsonb_build_object(
   'page',o.page,'ordinal',o.ordinal,'snapshot_id',o.snapshot_id,'observed_head_version',o.head_version,
   'external_id',s.external_id,'payload_hash',s.payload_hash,'file_id',o.file_id,'raw_record_sha256',o.raw_record_sha256,'stable_metadata_sha256',o.stable_metadata_sha256,
   'evidence_hash',encode(sha256(convert_to(jsonb_build_object('version',1,'child_run_id',x.child_run_id,'page',o.page,'ordinal',o.ordinal,
    'source_origin',s.source_origin,'source_site_uid',s.source_site_uid,'resource',s.resource,'external_id',s.external_id,'snapshot_id',s.id,'payload_hash',s.payload_hash,
    'observed_head_version',o.head_version,'file_id',o.file_id,'raw_record_sha256',o.raw_record_sha256,'stable_metadata_sha256',o.stable_metadata_sha256)::text,'UTF8')),'hex'),
   'current_snapshot_id',h.snapshot_id,'current_head_version',h.version,'payload_current',coalesce(h.snapshot_id=o.snapshot_id,false),
   'exact_source_current',case when o.head_version is null then null else coalesce(h.snapshot_id=o.snapshot_id and h.version=o.head_version,false) end) item
  from selected o cross join owned x join public.ezyvet_import_snapshots s on s.id=o.snapshot_id
  left join public.ezyvet_identity_heads h on h.source_origin=s.source_origin and h.source_site_uid=s.source_site_uid and h.resource=s.resource and h.external_id=s.external_id
 )
 select jsonb_build_object('version',1,'binding_id',x.binding_id,'scope_id',x.id,'migration_run_id',x.migration_run_id,'child_run_id',x.child_run_id,
  'resource',x.resource,'context_hash',x.context_hash,'superseded',x.superseded,'mapping_matches_manifest',x.mapping_matches_manifest,'mapping_source_current',x.mapping_source_current,
  'parent_current',x.parent_current,'household_current',x.household_current,
  'occurrence_fidelity',case when x.resource='attachment' then 'page_ordinal' else 'deduplicated_page_snapshot' end,
  'review_reconciled',false,'complete_coverage_verified',false,'observed_at',statement_timestamp(),
  'items',(select coalesce(jsonb_agg(item order by page,ordinal,snapshot_id),'[]') from items),
  'has_more',(select count(*)>p_limit from bounded),
  'next_cursor',case when (select count(*)>p_limit from bounded) then (select jsonb_build_object('page',page,'ordinal',ordinal,'snapshot_id',snapshot_id) from selected order by page desc,ordinal desc,snapshot_id desc limit 1) else null end)
 into result from owned x;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if result is null then raise exception 'Owned migration binding required' using errcode='42501';end if;
 return result;
end $$;
revoke all on function public.list_ezyvet_migration_items(uuid,integer,integer,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_ezyvet_migration_items(uuid,integer,integer,uuid,integer) to authenticated;
