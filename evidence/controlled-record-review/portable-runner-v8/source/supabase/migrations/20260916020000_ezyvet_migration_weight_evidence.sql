-- Read-only reconciliation: source-change acknowledgments never promote a weight.
create function public.read_ezyvet_migration_weight_evidence(
 p_binding_id uuid,p_page integer,p_snapshot_id uuid,p_evidence_hash text,
 p_before_created_at timestamptz default null,p_before_request_id uuid default null,p_limit integer default 20
) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=auth.uid();result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 1000 or p_snapshot_id is null or p_evidence_hash is null or p_evidence_hash !~ '^[a-f0-9]{64}$'
  or p_limit is null or p_limit not between 1 and 100 or num_nonnulls(p_before_created_at,p_before_request_id) not in (0,2)
  or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
  raise exception 'Invalid weight evidence observation or cursor' using errcode='23514';end if;
 with owned as materialized (
  select b.child_run_id,b.scope_id,s.mapping_id,s.client_id,s.pet_id,ss.id snapshot_id,ss.source_origin,ss.source_site_uid,ss.external_id
  from public.ezyvet_migration_bindings b join public.ezyvet_migration_scopes s on s.id=b.scope_id
  join public.ezyvet_migration_runs r on r.id=s.migration_run_id join public.ezyvet_import_runs c on c.id=b.child_run_id
  join public.ezyvet_weight_runs wr on wr.run_id=c.id and wr.animal_link_id=s.mapping_id
  join public.ezyvet_import_page_items o on o.run_id=c.id and o.page=p_page and o.snapshot_id=p_snapshot_id
  join public.ezyvet_import_snapshots ss on ss.id=o.snapshot_id and ss.resource='healthstatus' and ss.source_origin=r.source_origin and ss.source_site_uid=r.source_site_uid
  where b.id=p_binding_id and b.actor_id=a and r.actor_id=a and c.requested_by=a and s.resource='healthstatus'
   and p_evidence_hash=encode(sha256(convert_to(jsonb_build_object('version',1,'child_run_id',b.child_run_id,'page',o.page,'ordinal',0,
    'source_origin',ss.source_origin,'source_site_uid',ss.source_site_uid,'resource',ss.resource,'external_id',ss.external_id,'snapshot_id',ss.id,'payload_hash',ss.payload_hash,
    'observed_head_version',null,'file_id',null,'raw_record_sha256',null,'stable_metadata_sha256',null)::text,'UTF8')),'hex')
 ), approved as materialized (
  select m.* from owned x join public.ezyvet_weight_approvals m on m.source_origin=x.source_origin and m.source_site_uid=x.source_site_uid and m.external_id=x.external_id and m.animal_link_id=x.mapping_id and m.pet_id=x.pet_id
 ), bounded as materialized (
  select v.* from approved m join public.ezyvet_weight_source_reviews v on v.approval_id=m.request_id
  where p_before_created_at is null or (v.created_at,v.request_id)<(p_before_created_at,p_before_request_id)
  order by v.created_at desc,v.request_id desc limit p_limit+1
 ), selected as (select * from bounded order by created_at desc,request_id desc limit p_limit)
 select jsonb_build_object('version',1,'binding_id',p_binding_id,'scope_id',x.scope_id,'child_run_id',x.child_run_id,'actor_id',a,
  'resource','healthstatus','page',p_page,'snapshot_id',p_snapshot_id,'evidence_hash',p_evidence_hash,
  'observation_head_available',false,'exact_source_version_verified',false,'complete_coverage_verified',false,
  'approval',(select jsonb_build_object('id',m.request_id,'approved_at',m.created_at,'action',m.action,'weight_id',m.weight_id,
   'relationship',case when m.snapshot_id=x.snapshot_id then 'same_snapshot_unknown_observed_head' else 'different_snapshot' end,
   'source_current',exists(select 1 from public.ezyvet_identity_heads h where h.source_origin=m.source_origin and h.source_site_uid=m.source_site_uid and h.resource='healthstatus' and h.external_id=m.external_id and h.snapshot_id=m.snapshot_id and h.version=m.head_version),
   'patient_version_unchanged',exists(select 1 from public.pets where id=m.pet_id and version=m.patient_version),
   'household_current',exists(select 1 from public.pets where id=m.pet_id and client_id=x.client_id),
   'local_weight_matches_review',exists(select 1 from public.patient_weights w where w.id=m.weight_id and w.pet_id=m.pet_id and jsonb_build_object('weight',w.weight,'unit',w.unit,'measured_at',w.measured_at)=m.reviewed_values)) from approved m),
  'source_reviews',coalesce((select jsonb_agg(jsonb_build_object('id',v.request_id,'created_at',v.created_at,'snapshot_id',v.snapshot_id,'head_version',v.head_version,
   'relationship',case when v.snapshot_id=x.snapshot_id then 'same_snapshot_unknown_observed_head' else 'different_snapshot' end,
   'source_current',exists(select 1 from public.ezyvet_identity_heads h where h.source_origin=x.source_origin and h.source_site_uid=x.source_site_uid and h.resource='healthstatus' and h.external_id=x.external_id and h.snapshot_id=v.snapshot_id and h.version=v.head_version),
   'promotes_local_weight',false) order by v.created_at desc,v.request_id desc) from selected v),'[]'::jsonb),
  'has_more',(select count(*)>p_limit from bounded),
  'next_cursor',case when (select count(*)>p_limit from bounded) then (select jsonb_build_object('created_at',created_at,'request_id',request_id) from selected order by created_at,request_id limit 1) else null end,
  'observed_at',statement_timestamp()) into result from owned x;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if result is null then raise exception 'Exact owned weight observation required' using errcode='42501';end if;
 return result;
end $$;
revoke all on function public.read_ezyvet_migration_weight_evidence(uuid,integer,uuid,text,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.read_ezyvet_migration_weight_evidence(uuid,integer,uuid,text,timestamptz,uuid,integer) to authenticated;
