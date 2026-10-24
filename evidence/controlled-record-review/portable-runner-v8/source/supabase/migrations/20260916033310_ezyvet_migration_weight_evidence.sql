-- Receipt-only projection: a source-change acknowledgment never imports another weight.
-- Generic page observations have no head version; snapshot equality cannot recover it.
create index ezyvet_weight_source_reviews_receipt_cursor_idx
 on public.ezyvet_weight_source_reviews(approval_id,created_at desc,request_id desc);
create function public.list_ezyvet_migration_weight_evidence(p_binding_id uuid,p_page integer,p_snapshot_id uuid,p_evidence_hash text,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a uuid:=auth.uid();result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_binding_id is null or p_page is null or p_page not between 1 and 1000 or p_snapshot_id is null or p_evidence_hash is null or p_evidence_hash !~ '^[a-f0-9]{64}$'
  or (p_before_at is null)<>(p_before_id is null) or (p_before_at is not null and not isfinite(p_before_at))
  or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid weight evidence identity or cursor' using errcode='23514';end if;
 with owned as materialized (
  select b.child_run_id,b.scope_id,s.mapping_id,s.pet_id,s.client_id,r.source_origin,r.source_site_uid,ss.external_id
  from public.ezyvet_migration_bindings b join public.ezyvet_migration_scopes s on s.id=b.scope_id
  join public.ezyvet_migration_runs r on r.id=s.migration_run_id join public.ezyvet_import_runs c on c.id=b.child_run_id
  join public.ezyvet_weight_runs wr on wr.run_id=c.id and wr.animal_link_id=s.mapping_id
  join public.ezyvet_record_links m on m.id=s.mapping_id and m.resource='animal' and m.pet_id=s.pet_id and m.client_id=s.client_id
   and m.source_origin=r.source_origin and m.source_site_uid=r.source_site_uid
  join public.ezyvet_import_page_items o on o.run_id=c.id and o.page=p_page and o.snapshot_id=p_snapshot_id
  join public.ezyvet_import_snapshots ss on ss.id=o.snapshot_id and ss.resource='healthstatus' and ss.source_origin=r.source_origin and ss.source_site_uid=r.source_site_uid and ss.payload->>'animal_id'=m.external_id
  where b.id=p_binding_id and b.actor_id=a and r.actor_id=a and c.requested_by=a and s.resource='healthstatus'
   and p_evidence_hash=encode(sha256(convert_to(jsonb_build_object('version',1,'child_run_id',b.child_run_id,'page',o.page,'ordinal',0,
    'source_origin',ss.source_origin,'source_site_uid',ss.source_site_uid,'resource',ss.resource,'external_id',ss.external_id,'snapshot_id',ss.id,'payload_hash',ss.payload_hash,
    'observed_head_version',null,'file_id',null,'raw_record_sha256',null,'stable_metadata_sha256',null)::text,'UTF8')),'hex')
 ), approval as materialized (
  select h.* from owned x join public.ezyvet_weight_approvals h on h.animal_link_id=x.mapping_id and h.pet_id=x.pet_id
   and h.source_origin=x.source_origin and h.source_site_uid=x.source_site_uid and h.external_id=x.external_id
 ), bounded as materialized (
  select v.* from approval h join public.ezyvet_weight_source_reviews v on v.approval_id=h.request_id
  where p_before_at is null or (v.created_at,v.request_id)<(p_before_at,p_before_id)
  order by v.created_at desc,v.request_id desc limit p_limit+1
 ), selected as materialized (select * from bounded order by created_at desc,request_id desc limit p_limit)
 select jsonb_build_object('version',1,'binding_id',p_binding_id,'scope_id',x.scope_id,'child_run_id',x.child_run_id,'actor_id',a,
  'page',p_page,'snapshot_id',p_snapshot_id,'evidence_hash',p_evidence_hash,'visibility','approved_patient_weight',
  'observation_head_version',null,'historical_head_fidelity','unknown',
  'approval',(select jsonb_build_object('id',h.request_id,'weight_id',h.weight_id,'action',h.action,'approved_at',h.created_at,'snapshot_id',h.snapshot_id,'head_version',h.head_version,
   'relationship',case when h.snapshot_id=p_snapshot_id then 'exact_snapshot' else 'different_snapshot' end,
   'source_current',exists(select 1 from public.ezyvet_identity_heads ih where ih.source_origin=h.source_origin and ih.source_site_uid=h.source_site_uid and ih.resource='healthstatus' and ih.external_id=h.external_id and ih.snapshot_id=h.snapshot_id and ih.version=h.head_version),
   'local_weight_matches',exists(select 1 from public.patient_weights w where w.id=h.weight_id and w.pet_id=h.pet_id and jsonb_build_object('weight',w.weight,'unit',w.unit,'measured_at',w.measured_at)=h.reviewed_values),
   'household_current',exists(select 1 from public.pets p where p.id=x.pet_id and p.client_id=x.client_id)) from approval h),
  'reviews',(select coalesce(jsonb_agg(jsonb_build_object('id',v.request_id,'reviewed_at',v.created_at,'snapshot_id',v.snapshot_id,'head_version',v.head_version,
   'relationship',case when v.snapshot_id=p_snapshot_id then 'exact_snapshot' else 'different_snapshot' end,
   'source_current',exists(select 1 from public.ezyvet_identity_heads ih where ih.source_origin=x.source_origin and ih.source_site_uid=x.source_site_uid and ih.resource='healthstatus' and ih.external_id=x.external_id and ih.snapshot_id=v.snapshot_id and ih.version=v.head_version)) order by v.created_at desc,v.request_id desc),'[]') from selected v),
  'has_more',(select count(*)>p_limit from bounded),
  'next_cursor',case when (select count(*)>p_limit from bounded) then (select jsonb_build_object('before_at',created_at,'before_id',request_id) from selected order by created_at,request_id limit 1) else null end,
  'complete_coverage_verified',false,'observed_at',statement_timestamp()) into result from owned x;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if result is null then raise exception 'Exact owned weight observation required' using errcode='42501';end if;
 return result;
end $$;
revoke all on function public.list_ezyvet_migration_weight_evidence(uuid,integer,uuid,text,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_ezyvet_migration_weight_evidence(uuid,integer,uuid,text,timestamptz,uuid,integer) to authenticated;
