-- Review receipts for a verified history observation. No clinical data is mutated.
create function public.list_ezyvet_migration_history_evidence(p_binding_id uuid,p_page integer,p_snapshot_id uuid,p_evidence_hash text,p_before_version integer default null,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a uuid:=auth.uid();result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 1000 or p_snapshot_id is null or p_evidence_hash is null or p_evidence_hash !~ '^[a-f0-9]{64}$'
  or p_before_version<1 or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid history evidence identity or cursor' using errcode='23514';end if;
 with owned as materialized (
  select b.child_run_id,b.scope_id,s.mapping_id,s.pet_id,s.client_id,r.source_origin,r.source_site_uid,o.head_version,ss.external_id,ss.payload_hash
  from public.ezyvet_migration_bindings b join public.ezyvet_migration_scopes s on s.id=b.scope_id
  join public.ezyvet_migration_runs r on r.id=s.migration_run_id join public.ezyvet_import_runs c on c.id=b.child_run_id
  join public.ezyvet_clinical_page_observations o on o.run_id=c.id and o.page=p_page and o.snapshot_id=p_snapshot_id
  join public.ezyvet_import_snapshots ss on ss.id=o.snapshot_id and ss.resource='history' and ss.source_origin=r.source_origin and ss.source_site_uid=r.source_site_uid
  where b.id=p_binding_id and b.actor_id=a and r.actor_id=a and c.requested_by=a and s.resource='history'
   and p_evidence_hash=encode(sha256(convert_to(jsonb_build_object('version',1,'child_run_id',b.child_run_id,'page',o.page,'ordinal',0,
    'source_origin',ss.source_origin,'source_site_uid',ss.source_site_uid,'resource',ss.resource,'external_id',ss.external_id,'snapshot_id',ss.id,'payload_hash',ss.payload_hash,
    'observed_head_version',o.head_version,'file_id',null,'raw_record_sha256',null,'stable_metadata_sha256',null)::text,'UTF8')),'hex')
 ), bounded as materialized (
  select h.* from owned x join public.ezyvet_imported_histories h on h.animal_link_id=x.mapping_id and h.pet_id=x.pet_id
   and h.source_origin=x.source_origin and h.source_site_uid=x.source_site_uid and h.history_external_id=x.external_id
  where p_before_version is null or h.version<p_before_version order by h.version desc limit p_limit+1
 ), selected as materialized (select * from bounded order by version desc limit p_limit), projected as (
  select h.version,jsonb_build_object('id',h.id,'version',h.version,'version_hash',h.version_hash,'approved_at',h.approved_at,
   'relationship',case when row(h.snapshot_id,h.observed_head_version,h.payload_hash)=row(p_snapshot_id,x.head_version,x.payload_hash) then 'exact_source_version' else 'different_source_version' end,
   'source_current',coalesce((public.ezyvet_history_current(h.id)->>'is_current')::boolean,false),
   'superseded',exists(select 1 from public.ezyvet_imported_histories newer where newer.animal_link_id=h.animal_link_id and newer.history_external_id=h.history_external_id and newer.version>h.version),
   'consult_status',h.consult->>'status',
   'extraction_receipts',(select count(*) from public.ezyvet_problem_history_sources hs where hs.history_id=h.id and hs.version_hash=h.version_hash),
   'locally_edited_receipts',(select count(*) from public.ezyvet_problem_history_sources hs join public.ezyvet_problem_extractions e on e.id=hs.extraction_id join public.patient_problems p on p.id=e.problem_id where hs.history_id=h.id and hs.version_hash=h.version_hash and p.version<>e.problem_version)) receipt
  from selected h cross join owned x
 )
 select jsonb_build_object('version',1,'binding_id',p_binding_id,'scope_id',x.scope_id,'child_run_id',x.child_run_id,'actor_id',a,
  'page',p_page,'snapshot_id',p_snapshot_id,'evidence_hash',p_evidence_hash,'visibility','approved_patient_history',
  'approvals',(select coalesce(jsonb_agg(receipt order by version desc),'[]') from projected),
  'has_more',(select count(*)>p_limit from bounded),'next_before_version',case when (select count(*)>p_limit from bounded) then (select min(version) from selected) else null end,
  'discrepancies_assessed',false,'complete_coverage_verified',false,'observed_at',statement_timestamp()) into result from owned x;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if result is null then raise exception 'Exact owned history observation required' using errcode='42501';end if;
 return result;
end $$;
revoke all on function public.list_ezyvet_migration_history_evidence(uuid,integer,uuid,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_ezyvet_migration_history_evidence(uuid,integer,uuid,text,integer,integer) to authenticated;
