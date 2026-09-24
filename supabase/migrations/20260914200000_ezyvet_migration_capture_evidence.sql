-- Owner-scoped capture receipts for an exact, server-verified migration observation.
-- A matching source version can have multiple occurrences; ownership never transfers.
create function public.list_ezyvet_migration_capture_evidence(p_binding_id uuid,p_page integer,p_ordinal integer,p_snapshot_id uuid,p_evidence_hash text,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a uuid:=auth.uid();verified jsonb;item jsonb;result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 1000 or p_ordinal is null or p_ordinal not between 1 and 10 or p_snapshot_id is null
  or p_evidence_hash is null or p_evidence_hash !~ '^[a-f0-9]{64}$' or p_limit is null or p_limit not between 1 and 100
  or (p_before_at is null)<>(p_before_id is null) or (p_before_at is not null and not isfinite(p_before_at)) then raise exception 'Invalid capture evidence identity or cursor' using errcode='23514';end if;
 -- Skip the preceding ordinal completely, then require the exact requested item.
 verified:=public.list_ezyvet_migration_items(p_binding_id,p_page,p_ordinal-1,'ffffffff-ffff-ffff-ffff-ffffffffffff',1);
 item:=verified->'items'->0;
 if verified->>'resource' is distinct from 'attachment' or row(item->>'page',item->>'ordinal',item->>'snapshot_id',item->>'evidence_hash') is distinct from row(p_page::text,p_ordinal::text,p_snapshot_id::text,p_evidence_hash) then raise exception 'Exact attachment observation required' using errcode='42501';end if;
 with owned as materialized (
  select b.child_run_id,b.scope_id,s.*,r.source_origin,r.source_site_uid
  from public.ezyvet_migration_bindings b join public.ezyvet_migration_scopes s on s.id=b.scope_id join public.ezyvet_migration_runs r on r.id=s.migration_run_id
  where b.id=p_binding_id and b.actor_id=a and r.actor_id=a
 ), bounded as materialized (
  select q.* from owned x join public.ezyvet_attachment_capture_requests q on q.requested_by=a and q.animal_link_id=x.mapping_id and q.pet_id=x.pet_id and q.client_id=x.client_id
   and q.snapshot_id=p_snapshot_id and q.observed_head_version=(item->>'observed_head_version')::integer
   and q.external_id=item->>'external_id' and q.file_id=item->>'file_id' and q.stable_metadata_sha256=item->>'stable_metadata_sha256'
   and q.parent_context->>'source_origin'=x.source_origin and q.parent_context->>'source_site_uid'=x.source_site_uid
   and q.parent_context->>'parent_snapshot_id'=x.parent_snapshot_id::text and q.parent_context->>'parent_observed_head_version'=x.parent_head_version::text
   and q.parent_context->>'animal_external_id'=x.parent_external_id
  where p_before_at is null or (q.created_at,q.id)<(p_before_at,p_before_id)
  order by q.created_at desc,q.id desc limit p_limit+1
 ), selected as materialized (select * from bounded order by created_at desc,id desc limit p_limit), projected as (
  select q.created_at,q.id,jsonb_build_object('request_id',q.id,'created_at',q.created_at,'status',q.status,
   'relationship',case when row(q.run_id,q.page,q.ordinal)=row(x.child_run_id,p_page,p_ordinal) then 'exact_occurrence' else 'same_source_version' end,
   'source_current',public.ezyvet_attachment_capture_current(q.id),'retry_after',q.retry_after,'latest_error_code',q.last_error_code,
   'capture',case when c.id is null then null else jsonb_build_object('id',c.id,'capture_hash',c.capture_hash,'content_sha256',c.content_sha256,'mime_type',c.mime_type,'file_size',c.file_size,'captured_at',c.captured_at) end,
   'approved_versions',(select count(*) from public.ezyvet_attachment_record_versions v where v.request_id=q.id and v.capture_hash=c.capture_hash),
   'canceled_unconfirmed_decisions',(select count(*) from public.ezyvet_attachment_approval_cancellations z where z.request_id=q.id and z.actor_id=a and z.capture_hash=c.capture_hash),
   'latest_approval',(select jsonb_build_object('id',v.id,'version',v.version,'record_hash',v.record_hash,'created_at',v.created_at,
     'superseded',exists(select 1 from public.ezyvet_attachment_record_versions newer where newer.animal_link_id=v.animal_link_id and newer.attachment_external_id=v.attachment_external_id and newer.version>v.version))
    from public.ezyvet_attachment_record_versions v where v.request_id=q.id and v.capture_hash=c.capture_hash order by v.version desc limit 1)) receipt
  from selected q cross join owned x left join public.ezyvet_attachment_original_captures c on c.request_id=q.id
 )
 select jsonb_build_object('version',1,'binding_id',p_binding_id,'scope_id',x.scope_id,'child_run_id',x.child_run_id,'actor_id',a,
  'page',p_page,'ordinal',p_ordinal,'snapshot_id',p_snapshot_id,'evidence_hash',p_evidence_hash,'ownership','current_actor_only',
  'captures',(select coalesce(jsonb_agg(receipt order by created_at desc,id desc),'[]') from projected),'has_more',(select count(*)>p_limit from bounded),
  'next_cursor',case when (select count(*)>p_limit from bounded) then (select jsonb_build_object('before_at',created_at,'before_id',id) from selected order by created_at,id limit 1) else null end,
  'original_bytes_reverified',false,'complete_coverage_verified',false,'observed_at',statement_timestamp()) into result from owned x;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if result is null then raise exception 'Owned migration binding required' using errcode='42501';end if;
 return result;
end $$;
revoke all on function public.list_ezyvet_migration_capture_evidence(uuid,integer,integer,uuid,text,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_ezyvet_migration_capture_evidence(uuid,integer,integer,uuid,text,timestamptz,uuid,integer) to authenticated;
