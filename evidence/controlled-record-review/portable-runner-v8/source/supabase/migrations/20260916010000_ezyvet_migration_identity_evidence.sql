-- Legacy identity observations retain snapshots, not observed head versions.
-- Show the approved mapping without manufacturing exact observation credit.
create function public.read_ezyvet_migration_identity_evidence(p_binding_id uuid,p_page integer,p_snapshot_id uuid,p_evidence_hash text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a uuid:=auth.uid();result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 1000 or p_snapshot_id is null or p_evidence_hash is null or p_evidence_hash !~ '^[a-f0-9]{64}$' then
  raise exception 'Invalid identity evidence observation' using errcode='23514';end if;
 with owned as materialized (
  select b.child_run_id,b.scope_id,s.mapping_id,s.resource,s.client_id,s.pet_id,ss.id snapshot_id,ss.payload_hash
  from public.ezyvet_migration_bindings b join public.ezyvet_migration_scopes s on s.id=b.scope_id
  join public.ezyvet_migration_runs r on r.id=s.migration_run_id join public.ezyvet_import_runs c on c.id=b.child_run_id
  join public.ezyvet_import_page_items o on o.run_id=c.id and o.page=p_page and o.snapshot_id=p_snapshot_id
  join public.ezyvet_import_snapshots ss on ss.id=o.snapshot_id and ss.resource=s.resource and ss.source_origin=r.source_origin and ss.source_site_uid=r.source_site_uid and ss.external_id=s.parent_external_id
  where b.id=p_binding_id and b.actor_id=a and r.actor_id=a and c.requested_by=a and s.resource in ('contact','animal')
   and p_evidence_hash=encode(sha256(convert_to(jsonb_build_object('version',1,'child_run_id',b.child_run_id,'page',o.page,'ordinal',0,
    'source_origin',ss.source_origin,'source_site_uid',ss.source_site_uid,'resource',ss.resource,'external_id',ss.external_id,'snapshot_id',ss.id,'payload_hash',ss.payload_hash,
    'observed_head_version',null,'file_id',null,'raw_record_sha256',null,'stable_metadata_sha256',null)::text,'UTF8')),'hex')
 )
 select jsonb_build_object('version',1,'binding_id',p_binding_id,'scope_id',x.scope_id,'child_run_id',x.child_run_id,'actor_id',a,
  'resource',x.resource,'page',p_page,'snapshot_id',p_snapshot_id,'evidence_hash',p_evidence_hash,'visibility','approved_identity_mapping',
  'observation_head_available',false,'exact_source_version_verified',false,'complete_coverage_verified',false,
  'approval',jsonb_build_object('id',m.id,'approved_at',m.created_at,'action',m.action,
   'relationship',case when m.snapshot_id=x.snapshot_id then 'same_snapshot_unknown_observed_head' else 'different_snapshot' end,
   'source_current',exists(select 1 from public.ezyvet_identity_heads h where h.source_origin=m.source_origin and h.source_site_uid=m.source_site_uid and h.resource=m.resource and h.external_id=m.external_id and h.snapshot_id=m.snapshot_id and h.version=m.head_version),
   'local_record_unchanged',case when x.resource='contact' then exists(select 1 from public.clients where id=m.client_id and version=m.local_version) else exists(select 1 from public.pets where id=m.pet_id and version=m.local_version) end,
   'household_current',case when x.resource='contact' then exists(select 1 from public.clients where id=m.client_id) else exists(select 1 from public.pets where id=m.pet_id and client_id=m.client_id) end),
  'observed_at',statement_timestamp()) into result
 from owned x join public.ezyvet_record_links m on m.id=x.mapping_id and m.resource=x.resource and m.client_id=x.client_id and m.pet_id is not distinct from x.pet_id;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if result is null then raise exception 'Exact owned identity observation required' using errcode='42501';end if;
 return result;
end $$;
revoke all on function public.read_ezyvet_migration_identity_evidence(uuid,integer,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.read_ezyvet_migration_identity_evidence(uuid,integer,uuid,text) to authenticated;
