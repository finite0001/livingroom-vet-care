-- Internal source projection for the complete global-outcome implementation.
-- No public RPC/grant or frontend integration until outcome accounting is complete.
create function public.ezyvet_migration_observation_window(p_migration_run_id uuid,p_binding_id uuid,p_first_page integer,p_last_page integer)
returns table(scope_id uuid,binding_id uuid,child_run_id uuid,mapping_id uuid,client_id uuid,pet_id uuid,
 resource text,parent_snapshot_id uuid,parent_head_version integer,page integer,ordinal integer,snapshot_id uuid,
 observed_head_version integer,source_origin text,source_site_uid text,external_id text,payload_hash text,
 file_id text,raw_record_sha256 text,stable_metadata_sha256 text,evidence_hash text)
language sql stable security invoker set search_path=public as $$
 with owned as materialized (
  select s.id scope_id,b.id binding_id,b.child_run_id,s.mapping_id,s.client_id,s.pet_id,s.resource,
   s.parent_snapshot_id,s.parent_head_version,s.parent_external_id,r.source_origin,r.source_site_uid
  from public.ezyvet_migration_runs r join public.ezyvet_migration_scopes s on s.migration_run_id=r.id
  join public.ezyvet_migration_bindings b on b.scope_id=s.id join public.ezyvet_import_runs c on c.id=b.child_run_id
  where r.id=p_migration_run_id and r.actor_id=auth.uid() and b.actor_id=auth.uid() and c.requested_by=auth.uid()
   and public.ezyvet_is_active_admin(auth.uid()) is true and s.disposition='required'
   and (p_binding_id is null or b.id=p_binding_id)
   and not exists(select 1 from public.ezyvet_migration_bindings successor where successor.replaces_id=b.id)
 ), observed as (
  select x.scope_id,x.binding_id,x.child_run_id,o.page,o.ordinal,o.snapshot_id,o.head_version,o.file_id,o.raw_record_sha256,o.stable_metadata_sha256 from owned x join public.ezyvet_attachment_page_observations o on o.run_id=x.child_run_id and o.page between p_first_page and p_last_page where x.resource='attachment'
  union all select x.scope_id,x.binding_id,x.child_run_id,o.page,0,o.snapshot_id,o.head_version,null,null,null from owned x join public.ezyvet_clinical_page_observations o on o.run_id=x.child_run_id and o.page between p_first_page and p_last_page where x.resource in ('consult','history')
  union all select x.scope_id,x.binding_id,x.child_run_id,o.page,0,o.snapshot_id,o.head_version,null,null,null from owned x join public.ezyvet_vaccination_page_observations o on o.run_id=x.child_run_id and o.page between p_first_page and p_last_page where x.resource='vaccination'
  union all select x.scope_id,x.binding_id,x.child_run_id,o.page,0,o.snapshot_id,o.head_version,null,null,null from owned x join public.ezyvet_prescription_page_observations o on o.run_id=x.child_run_id and o.page between p_first_page and p_last_page where x.resource='prescription'
  union all select x.scope_id,x.binding_id,x.child_run_id,o.page,0,o.snapshot_id,o.head_version,null,null,null from owned x join public.ezyvet_prescriptionitem_page_observations o on o.run_id=x.child_run_id and o.page between p_first_page and p_last_page where x.resource='prescriptionitem'
  union all select x.scope_id,x.binding_id,x.child_run_id,o.page,0,o.snapshot_id,null,null,null,null from owned x join public.ezyvet_import_page_items o on o.run_id=x.child_run_id and o.page between p_first_page and p_last_page
   join public.ezyvet_import_snapshots s on s.id=o.snapshot_id where x.resource in ('contact','animal','healthstatus') and s.resource=x.resource
    and s.source_origin=x.source_origin and s.source_site_uid=x.source_site_uid and (x.resource='healthstatus' or s.external_id=x.parent_external_id)

 )
 select x.scope_id,x.binding_id,x.child_run_id,x.mapping_id,x.client_id,x.pet_id,x.resource,x.parent_snapshot_id,x.parent_head_version,
  o.page,o.ordinal,o.snapshot_id,o.head_version,ss.source_origin,ss.source_site_uid,ss.external_id,ss.payload_hash,
  o.file_id,o.raw_record_sha256,o.stable_metadata_sha256,
  encode(sha256(convert_to(jsonb_build_object('version',1,'child_run_id',x.child_run_id,'page',o.page,'ordinal',o.ordinal,
   'source_origin',ss.source_origin,'source_site_uid',ss.source_site_uid,'resource',ss.resource,'external_id',ss.external_id,'snapshot_id',ss.id,'payload_hash',ss.payload_hash,
   'observed_head_version',o.head_version,'file_id',o.file_id,'raw_record_sha256',o.raw_record_sha256,'stable_metadata_sha256',o.stable_metadata_sha256)::text,'UTF8')),'hex')
 from observed o join owned x on x.scope_id=o.scope_id and x.binding_id=o.binding_id and x.child_run_id=o.child_run_id
 join public.ezyvet_import_snapshots ss on ss.id=o.snapshot_id and ss.resource=x.resource and ss.source_origin=x.source_origin and ss.source_site_uid=x.source_site_uid;
$$;
revoke all on function public.ezyvet_migration_observation_window(uuid,uuid,integer,integer) from public,anon,authenticated,service_role;

-- Keep the full comparison path direct: wrapping it in another set-returning function regressed full-scan latency.
create function public.ezyvet_migration_terminal_observations(p_migration_run_id uuid)
returns table(scope_id uuid,binding_id uuid,child_run_id uuid,mapping_id uuid,client_id uuid,pet_id uuid,
 resource text,parent_snapshot_id uuid,parent_head_version integer,page integer,ordinal integer,snapshot_id uuid,
 observed_head_version integer,source_origin text,source_site_uid text,external_id text,payload_hash text,
 file_id text,raw_record_sha256 text,stable_metadata_sha256 text,evidence_hash text)
language sql stable security invoker set search_path=public as $$
 with owned as materialized (
  select s.id scope_id,b.id binding_id,b.child_run_id,s.mapping_id,s.client_id,s.pet_id,s.resource,
   s.parent_snapshot_id,s.parent_head_version,s.parent_external_id,r.source_origin,r.source_site_uid
  from public.ezyvet_migration_runs r join public.ezyvet_migration_scopes s on s.migration_run_id=r.id
  join public.ezyvet_migration_bindings b on b.scope_id=s.id join public.ezyvet_import_runs c on c.id=b.child_run_id
  where r.id=p_migration_run_id and r.actor_id=auth.uid() and b.actor_id=auth.uid() and c.requested_by=auth.uid()
   and public.ezyvet_is_active_admin(auth.uid()) is true and s.disposition='required'
   and not exists(select 1 from public.ezyvet_migration_bindings successor where successor.replaces_id=b.id)
 ), observed as (
  select x.scope_id,x.binding_id,x.child_run_id,o.page,o.ordinal,o.snapshot_id,o.head_version,o.file_id,o.raw_record_sha256,o.stable_metadata_sha256 from owned x join public.ezyvet_attachment_page_observations o on o.run_id=x.child_run_id where x.resource='attachment'
  union all select x.scope_id,x.binding_id,x.child_run_id,o.page,0,o.snapshot_id,o.head_version,null,null,null from owned x join public.ezyvet_clinical_page_observations o on o.run_id=x.child_run_id where x.resource in ('consult','history')
  union all select x.scope_id,x.binding_id,x.child_run_id,o.page,0,o.snapshot_id,o.head_version,null,null,null from owned x join public.ezyvet_vaccination_page_observations o on o.run_id=x.child_run_id where x.resource='vaccination'
  union all select x.scope_id,x.binding_id,x.child_run_id,o.page,0,o.snapshot_id,o.head_version,null,null,null from owned x join public.ezyvet_prescription_page_observations o on o.run_id=x.child_run_id where x.resource='prescription'
  union all select x.scope_id,x.binding_id,x.child_run_id,o.page,0,o.snapshot_id,o.head_version,null,null,null from owned x join public.ezyvet_prescriptionitem_page_observations o on o.run_id=x.child_run_id where x.resource='prescriptionitem'
  union all select x.scope_id,x.binding_id,x.child_run_id,o.page,0,o.snapshot_id,null,null,null,null from owned x join public.ezyvet_import_page_items o on o.run_id=x.child_run_id
   join public.ezyvet_import_snapshots s on s.id=o.snapshot_id where x.resource in ('contact','animal','healthstatus') and s.resource=x.resource
    and s.source_origin=x.source_origin and s.source_site_uid=x.source_site_uid and (x.resource='healthstatus' or s.external_id=x.parent_external_id)

 )
 select x.scope_id,x.binding_id,x.child_run_id,x.mapping_id,x.client_id,x.pet_id,x.resource,x.parent_snapshot_id,x.parent_head_version,
  o.page,o.ordinal,o.snapshot_id,o.head_version,ss.source_origin,ss.source_site_uid,ss.external_id,ss.payload_hash,
  o.file_id,o.raw_record_sha256,o.stable_metadata_sha256,
  encode(sha256(convert_to(jsonb_build_object('version',1,'child_run_id',x.child_run_id,'page',o.page,'ordinal',o.ordinal,
   'source_origin',ss.source_origin,'source_site_uid',ss.source_site_uid,'resource',ss.resource,'external_id',ss.external_id,'snapshot_id',ss.id,'payload_hash',ss.payload_hash,
   'observed_head_version',o.head_version,'file_id',o.file_id,'raw_record_sha256',o.raw_record_sha256,'stable_metadata_sha256',o.stable_metadata_sha256)::text,'UTF8')),'hex')
 from observed o join owned x on x.scope_id=o.scope_id and x.binding_id=o.binding_id and x.child_run_id=o.child_run_id
 join public.ezyvet_import_snapshots ss on ss.id=o.snapshot_id and ss.resource=x.resource and ss.source_origin=x.source_origin and ss.source_site_uid=x.source_site_uid;
$$;
revoke all on function public.ezyvet_migration_terminal_observations(uuid) from public,anon,authenticated,service_role;

create function public.ezyvet_migration_observation_chunk(p_migration_run_id uuid,p_binding_id uuid,p_first_page integer,p_page_count integer)
returns table(scope_id uuid,binding_id uuid,child_run_id uuid,mapping_id uuid,client_id uuid,pet_id uuid,
 resource text,parent_snapshot_id uuid,parent_head_version integer,page integer,ordinal integer,snapshot_id uuid,
 observed_head_version integer,source_origin text,source_site_uid text,external_id text,payload_hash text,
 file_id text,raw_record_sha256 text,stable_metadata_sha256 text,evidence_hash text)
language plpgsql stable security invoker set search_path=public as $$
begin
 if p_migration_run_id is null or p_binding_id is null or p_first_page is null or p_page_count is null
  or p_first_page not between 1 and 1000 or p_page_count not between 1 and 20 or p_first_page+p_page_count-1>1000 then
  raise exception 'Invalid migration observation chunk' using errcode='23514';
 end if;
 return query select w.* from public.ezyvet_migration_observation_window(p_migration_run_id,p_binding_id,p_first_page,p_first_page+p_page_count-1) w
 order by w.page,w.ordinal,w.snapshot_id;
end;
$$;
revoke all on function public.ezyvet_migration_observation_chunk(uuid,uuid,integer,integer) from public,anon,authenticated,service_role;

-- Source counts are separate from reviewed/native outcome credit.
create function public.ezyvet_migration_source_totals(p_migration_run_id uuid)
returns jsonb language sql stable security invoker set search_path=public as $$
 with owned as materialized (
  select r.id from public.ezyvet_migration_runs r where r.id=p_migration_run_id and r.actor_id=auth.uid() and public.ezyvet_is_active_admin(auth.uid()) is true
 ), scopes as materialized (
  select s.*,b.id binding_id,b.child_run_id from owned r join public.ezyvet_migration_scopes s on s.migration_run_id=r.id
  left join public.ezyvet_migration_bindings b on b.scope_id=s.id and b.actor_id=auth.uid()
   and not exists(select 1 from public.ezyvet_migration_bindings newer where newer.replaces_id=b.id)
 ), observations as materialized (select * from public.ezyvet_migration_terminal_observations(p_migration_run_id)),
 scope_counts as (
  select resource,count(*) scopes,count(*) filter(where disposition='required') required_scopes,
   count(*) filter(where disposition='excluded') excluded_scopes,count(*) filter(where disposition='unsupported') unsupported_scopes,
   count(*) filter(where disposition='required' and binding_id is null) unbound_required_scopes,
   count(distinct child_run_id) child_runs from scopes group by resource
 ), source_counts as (
  select resource,count(*) observation_memberships,count(distinct (child_run_id,page,ordinal,snapshot_id)) observed_occurrences,
   count(distinct (source_origin,source_site_uid,resource,external_id)) source_identities,
   count(distinct snapshot_id) source_snapshots,
   count(distinct (snapshot_id,observed_head_version)) filter(where observed_head_version is not null) recorded_source_versions,
   count(distinct (child_run_id,page,ordinal,snapshot_id)) filter(where observed_head_version is null) occurrences_without_observed_head
  from observations group by resource
 ), projected as (
  select c.resource,to_jsonb(c)||jsonb_build_object(
   'observation_memberships',coalesce(o.observation_memberships,0),'observed_occurrences',coalesce(o.observed_occurrences,0),
   'source_identities',coalesce(o.source_identities,0),'source_snapshots',coalesce(o.source_snapshots,0),
   'recorded_source_versions',coalesce(o.recorded_source_versions,0),'occurrences_without_observed_head',coalesce(o.occurrences_without_observed_head,0),
   'occurrence_fidelity',case when c.resource='attachment' then 'page_ordinal' else 'deduplicated_page_snapshot' end,
   'provider_total',null) counts
  from scope_counts c left join source_counts o on o.resource=c.resource
 )
 select jsonb_build_object('version',1,'migration_run_id',r.id,'actor_id',auth.uid(),'binding_selection','terminal_per_required_scope',
  'resources',coalesce((select jsonb_agg(counts order by resource) from projected),'[]'::jsonb),
  'historical_bindings',(select count(*) from public.ezyvet_migration_bindings b join scopes s on s.id=b.scope_id where b.actor_id=auth.uid() and b.id is distinct from s.binding_id),
  'distinct_child_runs',(select count(distinct child_run_id) from scopes),
  'review_reconciled',false,'complete_coverage_verified',false,'cutover_accepted',false,'observed_at',statement_timestamp())
 from owned r;
$$;
revoke all on function public.ezyvet_migration_source_totals(uuid) from public,anon,authenticated,service_role;

-- Normalize reviewed receipts without conflating them with native outcomes.
-- Item/attachment context receipts and aggregation are added before public exposure.
create function public.ezyvet_migration_terminal_standard_receipts(p_migration_run_id uuid)
returns table(scope_id uuid,binding_id uuid,evidence_hash text,resource text,receipt_kind text,receipt_id uuid,
 receipt_version integer,relationship text,source_current boolean,superseded boolean,native_kind text,native_id uuid,
 local_changed boolean,household_current boolean)
language sql stable security invoker set search_path=public as $$
 with observed as materialized (select * from public.ezyvet_migration_terminal_observations(p_migration_run_id))
 select x.scope_id,x.binding_id,x.evidence_hash,x.resource,'identity_mapping',m.id,1,
  case when m.snapshot_id=x.snapshot_id then 'same_snapshot_unknown_observed_head' else 'different_snapshot' end,
  exists(select 1 from public.ezyvet_identity_heads h where h.source_origin=m.source_origin and h.source_site_uid=m.source_site_uid and h.resource=m.resource and h.external_id=m.external_id and h.snapshot_id=m.snapshot_id and h.version=m.head_version),false,
  case when x.resource='contact' then 'client' else 'pet' end,case when x.resource='contact' then m.client_id else m.pet_id end,
  case when x.resource='contact' then not exists(select 1 from public.clients where id=m.client_id and version=m.local_version) else not exists(select 1 from public.pets where id=m.pet_id and version=m.local_version) end,
  case when x.resource='contact' then exists(select 1 from public.clients where id=m.client_id) else exists(select 1 from public.pets where id=m.pet_id and client_id=m.client_id) end
 from observed x join public.ezyvet_record_links m on m.id=x.mapping_id and m.resource=x.resource and m.client_id=x.client_id and m.pet_id is not distinct from x.pet_id
 where x.resource in ('contact','animal')
 union all
 select x.scope_id,x.binding_id,x.evidence_hash,x.resource,'weight_approval',m.request_id,1,
  case when m.snapshot_id=x.snapshot_id then 'same_snapshot_unknown_observed_head' else 'different_snapshot' end,
  exists(select 1 from public.ezyvet_identity_heads h where h.source_origin=m.source_origin and h.source_site_uid=m.source_site_uid and h.resource='healthstatus' and h.external_id=m.external_id and h.snapshot_id=m.snapshot_id and h.version=m.head_version),false,
  'weight',m.weight_id,
  not exists(select 1 from public.patient_weights w where w.id=m.weight_id and w.pet_id=m.pet_id and jsonb_build_object('weight',w.weight,'unit',w.unit,'measured_at',w.measured_at)=m.reviewed_values),
  exists(select 1 from public.pets where id=m.pet_id and client_id=x.client_id)
 from observed x join public.ezyvet_weight_approvals m on m.source_origin=x.source_origin and m.source_site_uid=x.source_site_uid and m.external_id=x.external_id and m.animal_link_id=x.mapping_id and m.pet_id=x.pet_id where x.resource='healthstatus'
 union all
 select x.scope_id,x.binding_id,x.evidence_hash,x.resource,'weight_source_acknowledgment',v.request_id,1,
  case when v.snapshot_id=x.snapshot_id then 'same_snapshot_unknown_observed_head' else 'different_snapshot' end,
  exists(select 1 from public.ezyvet_identity_heads h where h.source_origin=m.source_origin and h.source_site_uid=m.source_site_uid and h.resource='healthstatus' and h.external_id=m.external_id and h.snapshot_id=v.snapshot_id and h.version=v.head_version),false,
  null,null,false,exists(select 1 from public.pets where id=m.pet_id and client_id=x.client_id)
 from observed x join public.ezyvet_weight_approvals m on m.source_origin=x.source_origin and m.source_site_uid=x.source_site_uid and m.external_id=x.external_id and m.animal_link_id=x.mapping_id and m.pet_id=x.pet_id
 join public.ezyvet_weight_source_reviews v on v.approval_id=m.request_id where x.resource='healthstatus'
 union all
 select x.scope_id,x.binding_id,x.evidence_hash,x.resource,'imported_history',h.id,h.version,
  case when row(h.snapshot_id,h.observed_head_version,h.payload_hash)=row(x.snapshot_id,x.observed_head_version,x.payload_hash) then 'exact_source_version' else 'different_source_version' end,
  coalesce((public.ezyvet_history_current(h.id)->>'is_current')::boolean,false),
  exists(select 1 from public.ezyvet_imported_histories newer where newer.animal_link_id=h.animal_link_id and newer.history_external_id=h.history_external_id and newer.version>h.version),
  null,null,
  exists(select 1 from public.ezyvet_problem_history_sources hs join public.ezyvet_problem_extractions e on e.id=hs.extraction_id join public.patient_problems p on p.id=e.problem_id where hs.history_id=h.id and hs.version_hash=h.version_hash and p.version<>e.problem_version),
  exists(select 1 from public.pets where id=h.pet_id and client_id=x.client_id)
 from observed x join public.ezyvet_imported_histories h on h.animal_link_id=x.mapping_id and h.pet_id=x.pet_id and h.source_origin=x.source_origin and h.source_site_uid=x.source_site_uid and h.history_external_id=x.external_id where x.resource='history'
 union all
 select x.scope_id,x.binding_id,x.evidence_hash,x.resource,'imported_vaccination',h.id,h.version,
  case when row(h.snapshot_id,h.observed_head_version,h.payload_hash,h.consult->>'snapshot_id',h.consult->>'observed_head_version')=row(x.snapshot_id,x.observed_head_version,x.payload_hash,x.parent_snapshot_id::text,x.parent_head_version::text) then 'exact_source_version' else 'different_source_version' end,
  coalesce((public.ezyvet_vaccination_current(h.id)->>'is_current')::boolean,false),exists(select 1 from public.ezyvet_imported_vaccinations newer where newer.replaces_id=h.id),
  null,null,false,exists(select 1 from public.pets where id=h.pet_id and client_id=x.client_id)
 from observed x join public.ezyvet_imported_vaccinations h on h.animal_link_id=x.mapping_id and h.pet_id=x.pet_id and h.client_id=x.client_id and h.source_origin=x.source_origin and h.source_site_uid=x.source_site_uid and h.vaccination_external_id=x.external_id where x.resource='vaccination'
 union all
 select x.scope_id,x.binding_id,x.evidence_hash,x.resource,'imported_prescription',h.id,h.version,
  case when row(h.context#>>'{parent,snapshot_id}',h.context#>>'{parent,observed_head_version}',h.context#>>'{parent,payload_hash}')=row(x.snapshot_id::text,x.observed_head_version::text,x.payload_hash) then 'exact_source_version' else 'different_source_version' end,
  coalesce((public.ezyvet_prescription_current(h.id)->>'is_current')::boolean,false),exists(select 1 from public.ezyvet_imported_prescriptions newer where newer.replaces_id=h.id),
  null,null,false,exists(select 1 from public.pets where id=h.pet_id and client_id=x.client_id)
 from observed x join public.ezyvet_imported_prescriptions h on h.animal_link_id=x.mapping_id and h.pet_id=x.pet_id and h.client_id=x.client_id and h.source_origin=x.source_origin and h.source_site_uid=x.source_site_uid and h.prescription_external_id=x.external_id where x.resource='prescription';
$$;
revoke all on function public.ezyvet_migration_terminal_standard_receipts(uuid) from public,anon,authenticated,service_role;

create function public.ezyvet_migration_terminal_context_receipts(p_migration_run_id uuid)
returns table(scope_id uuid,binding_id uuid,evidence_hash text,resource text,receipt_kind text,receipt_id uuid,receipt_version integer,facets jsonb)
language sql stable security invoker set search_path=public as $$
 with observed as materialized (select * from public.ezyvet_migration_terminal_observations(p_migration_run_id)),
 item_approvals as materialized (
  select x.*,h.id approval_id,h.version,h.context,h.replaces_id,pc.prescription_payload_hash
  from observed x join public.ezyvet_prescriptionitem_runs pc on pc.run_id=x.child_run_id
  join public.ezyvet_imported_prescriptions h on h.animal_link_id=x.mapping_id and h.pet_id=x.pet_id and h.client_id=x.client_id
   and h.source_origin=x.source_origin and h.source_site_uid=x.source_site_uid and h.prescription_external_id=pc.prescription_external_id
  where x.resource='prescriptionitem'
 ), requests as materialized (
  select x.scope_id,x.binding_id,x.evidence_hash,x.resource,x.child_run_id,x.page observed_page,x.ordinal observed_ordinal,q.*
  from observed x join public.ezyvet_migration_scopes s on s.id=x.scope_id
  join public.ezyvet_attachment_capture_requests q on q.animal_link_id=x.mapping_id and q.pet_id=x.pet_id and q.client_id=x.client_id
   and q.snapshot_id=x.snapshot_id and q.observed_head_version=x.observed_head_version
   and q.external_id=x.external_id and q.file_id=x.file_id and q.stable_metadata_sha256=x.stable_metadata_sha256
   and q.parent_context->>'source_origin'=x.source_origin and q.parent_context->>'source_site_uid'=x.source_site_uid
   and q.parent_context->>'parent_snapshot_id'=x.parent_snapshot_id::text and q.parent_context->>'parent_observed_head_version'=x.parent_head_version::text
   and q.parent_context->>'animal_external_id'=s.parent_external_id
  where x.resource='attachment'
 )
 select x.scope_id,x.binding_id,x.evidence_hash,x.resource,'imported_prescription',x.approval_id,x.version,
  jsonb_build_object('parent_matches',row(x.context#>>'{parent,snapshot_id}',x.context#>>'{parent,observed_head_version}',x.context#>>'{parent,payload_hash}')=row(x.parent_snapshot_id::text,x.parent_head_version::text,x.prescription_payload_hash),
   'exact_occurrence',x.context#>>'{item_run,id}'=x.child_run_id::text and exists(select 1 from jsonb_array_elements(x.context->'items') i where i->>'page'=x.page::text and row(i->>'snapshot_id',i->>'observed_head_version',i->>'payload_hash')=row(x.snapshot_id::text,x.observed_head_version::text,x.payload_hash)),
   'disposition',case when exists(select 1 from jsonb_array_elements(x.context->'selected_items') i where row(i#>>'{source,snapshot_id}',i#>>'{source,observed_head_version}',i#>>'{source,payload_hash}')=row(x.snapshot_id::text,x.observed_head_version::text,x.payload_hash)) then 'selected'
    when exists(select 1 from jsonb_array_elements(x.context->'omitted_items') i where row(i->>'snapshot_id',i->>'observed_head_version',i->>'payload_hash')=row(x.snapshot_id::text,x.observed_head_version::text,x.payload_hash)) then 'omitted'
    when exists(select 1 from jsonb_array_elements(x.context->'items') i where i->>'external_id'=x.external_id) then 'different_source_version' else 'not_observed' end,
   'source_current',coalesce((public.ezyvet_prescription_current(x.approval_id)->>'is_current')::boolean,false),
   'superseded',exists(select 1 from public.ezyvet_imported_prescriptions newer where newer.replaces_id=x.approval_id),
   'completeness',x.context#>>'{reviewed,completeness}','native_prescribing',false)
 from item_approvals x
 union all
 select q.scope_id,q.binding_id,q.evidence_hash,q.resource,'attachment_capture_request',q.id,1,
  jsonb_build_object('status',q.status,'relationship',case when row(q.run_id,q.page,q.ordinal)=row(q.child_run_id,q.observed_page,q.observed_ordinal) then 'exact_occurrence' else 'same_source_version' end,
   'source_current',public.ezyvet_attachment_capture_current(q.id),'approved_original',false)
 from requests q where q.requested_by=auth.uid()
 union all
 select q.scope_id,q.binding_id,q.evidence_hash,q.resource,'attachment_captured_bytes',c.id,1,
  jsonb_build_object('request_id',q.id,'capture_hash',c.capture_hash,'source_current',public.ezyvet_attachment_capture_current(q.id),'approved_original',false)
 from requests q join public.ezyvet_attachment_original_captures c on c.request_id=q.id where q.requested_by=auth.uid()
 union all
 select q.scope_id,q.binding_id,q.evidence_hash,q.resource,'attachment_original_approval',v.id,v.version,
  jsonb_build_object('approval_visibility','approved_patient_history','source_current',public.ezyvet_attachment_capture_current(q.id),
   'superseded',exists(select 1 from public.ezyvet_attachment_record_versions newer where newer.animal_link_id=v.animal_link_id and newer.attachment_external_id=v.attachment_external_id and newer.version>v.version),
   'original_bytes_reverified',false)
 from requests q join public.ezyvet_attachment_original_captures c on c.request_id=q.id
 join public.ezyvet_attachment_record_versions v on v.request_id=q.id and v.capture_hash=c.capture_hash
 union all
 select q.scope_id,q.binding_id,q.evidence_hash,q.resource,'attachment_unconfirmed_cancellation',z.id,1,
  jsonb_build_object('request_id',q.id,'capture_hash',c.capture_hash,'revokes_approval',false)
 from requests q join public.ezyvet_attachment_original_captures c on c.request_id=q.id
 join public.ezyvet_attachment_approval_cancellations z on z.request_id=q.id and z.actor_id=auth.uid() and z.capture_hash=c.capture_hash where q.requested_by=auth.uid();
$$;
revoke all on function public.ezyvet_migration_terminal_context_receipts(uuid) from public,anon,authenticated,service_role;

create function public.ezyvet_migration_terminal_native_outcomes(p_migration_run_id uuid)
returns table(scope_id uuid,binding_id uuid,evidence_hash text,resource text,provenance_kind text,provenance_id uuid,native_kind text,native_id uuid,local_changed boolean)
language sql stable security invoker set search_path=public as $$
 with receipts as materialized (select * from public.ezyvet_migration_terminal_standard_receipts(p_migration_run_id))
 select scope_id,binding_id,evidence_hash,resource,receipt_kind,receipt_id,native_kind,native_id,local_changed
 from receipts where native_id is not null
 union all
 select r.scope_id,r.binding_id,r.evidence_hash,r.resource,'problem_extraction',e.id,'problem',e.problem_id,p.version<>e.problem_version
 from receipts r join public.ezyvet_imported_histories h on h.id=r.receipt_id
 join public.ezyvet_problem_history_sources hs on hs.history_id=h.id and hs.version_hash=h.version_hash
 join public.ezyvet_problem_extractions e on e.id=hs.extraction_id and e.pet_id=h.pet_id
 join public.patient_problems p on p.id=e.problem_id and p.pet_id=e.pet_id
 where r.receipt_kind='imported_history';
$$;
revoke all on function public.ezyvet_migration_terminal_native_outcomes(uuid) from public,anon,authenticated,service_role;

-- Counts are deduplicated globally by receipt identity, never summed across scopes.
-- Facets overlap and must not be used as an additive completion numerator.
create function public.ezyvet_migration_outcome_totals(p_migration_run_id uuid)
returns jsonb language sql stable security invoker set search_path=public as $$
 with owned as materialized (
  select id from public.ezyvet_migration_runs where id=p_migration_run_id
   and actor_id=auth.uid() and public.ezyvet_is_active_admin(auth.uid()) is true
 ), standard as materialized (
  select * from public.ezyvet_migration_terminal_standard_receipts(p_migration_run_id)
 ), context as materialized (
  select * from public.ezyvet_migration_terminal_context_receipts(p_migration_run_id)
 ), receipts as (
  select r.receipt_kind,r.receipt_id,r.source_current,r.superseded,r.local_changed,
   r.relationship='exact_source_version' exact_match,
   r.relationship='same_snapshot_unknown_observed_head' unknown_head_match,
   case when w.request_id is not null then not exists(select 1 from public.pets p where p.id=w.pet_id and p.version=w.patient_version) end patient_changed,
   not r.household_current household_changed,coalesce(w.action,m.action) record_action
  from standard r
  left join public.ezyvet_weight_approvals w on r.receipt_kind='weight_approval' and w.request_id=r.receipt_id
  left join public.ezyvet_record_links m on r.receipt_kind='identity_mapping' and m.id=r.receipt_id
  union all
  select receipt_kind,receipt_id,(facets->>'source_current')::boolean,
   (facets->>'superseded')::boolean,null,
   case when resource='prescriptionitem' then
    coalesce((facets->>'parent_matches')::boolean,false) and facets->>'disposition' in ('selected','omitted')
    when receipt_kind='attachment_original_approval' then true else null end,
   false,null,null,null
  from context
 ), distinct_receipts as (
  select receipt_kind,receipt_id,bool_or(source_current) source_current,
   bool_or(superseded) superseded,bool_or(local_changed) local_changed,
   bool_or(exact_match) exact_match,bool_or(unknown_head_match) unknown_head_match,
   bool_or(patient_changed) patient_changed,bool_or(household_changed) household_changed,max(record_action) record_action
  from receipts group by receipt_kind,receipt_id
 ), receipt_counts as (
  select receipt_kind,count(*) versions,
   count(*) filter(where superseded is false) latest_versions,
   count(*) filter(where source_current is true) source_current_versions,
   count(*) filter(where source_current is false) source_stale_versions,
   count(*) filter(where local_changed is true) locally_changed_versions,
   count(*) filter(where patient_changed is not null) patient_version_assessed_versions,
   count(*) filter(where household_changed is not null) household_assessed_versions,
   count(*) filter(where patient_changed is true) changed_patient_versions,
   count(*) filter(where household_changed is true) changed_household_versions,
   count(*) filter(where record_action='create') created_record_receipts,
   count(*) filter(where record_action='link') linked_record_receipts,
   count(*) filter(where exact_match is true) exact_observation_version_matches,
   count(*) filter(where unknown_head_match is true) same_snapshot_unknown_head_matches
  from distinct_receipts group by receipt_kind
 ), capture_states as (
  select facets->>'status' status,count(distinct receipt_id) requests
  from context where receipt_kind='attachment_capture_request' group by facets->>'status'
 ), capture_totals as (
  select jsonb_build_object('request_visibility','current_owner_only',
   'requests_by_status',coalesce((select jsonb_object_agg(status,requests) from capture_states),'{}'::jsonb),
   'stale_source_requests',count(distinct receipt_id) filter(where receipt_kind='attachment_capture_request' and facets->>'source_current'='false'),
   'captured_originals',count(distinct receipt_id) filter(where receipt_kind='attachment_captured_bytes'),
   'approved_original_versions',count(distinct receipt_id) filter(where receipt_kind='attachment_original_approval'),
   'unconfirmed_cancellations',count(distinct receipt_id) filter(where receipt_kind='attachment_unconfirmed_cancellation'),
   'original_bytes_reverified',false,'retrievability','not_checked_by_summary') totals
  from context
 ), prescription_versions as materialized (
  select h.context,r.superseded from distinct_receipts r
  join public.ezyvet_imported_prescriptions h on h.id=r.receipt_id
  where r.receipt_kind='imported_prescription'
 ), prescription_gaps as (
  select count(*) reviewed_versions,count(*) filter(where not superseded) latest_versions,
   count(*) filter(where context#>>'{reviewed,completeness}'='partial') partial_versions,
   count(*) filter(where not superseded and context#>>'{reviewed,completeness}'='partial') latest_partial_versions,
   count(*) filter(where context#>>'{reconciliation,status}'='unresolved') unresolved_reference_versions,
   count(*) filter(where context#>>'{reconciliation,sourceListPresent}'='false') absent_source_list_versions,
   count(*) filter(where context#>>'{reconciliation,scanComplete}'='false') unfinished_scan_versions,
   count(*) filter(where jsonb_array_length(context#>'{reconciliation,missingIds}')>0) missing_item_versions,
   count(*) filter(where jsonb_array_length(context#>'{reconciliation,unexpectedIds}')>0) unexpected_item_versions,
   count(*) filter(where jsonb_array_length(context#>'{reconciliation,duplicateSourceIds}')>0) duplicate_source_reference_versions,
   count(*) filter(where jsonb_array_length(context#>'{reconciliation,duplicateObservedIds}')>0) duplicate_observation_versions,
   count(*) filter(where jsonb_array_length(context#>'{reconciliation,invalidSourceReferences}')>0
    or jsonb_array_length(context#>'{reconciliation,invalidObservedReferences}')>0) invalid_reference_versions,
   count(*) filter(where context#>>'{reviewed,prescription_date_status}'='unknown') unknown_date_versions,
   count(*) filter(where context#>>'{reviewed,status}'='unknown') unknown_status_versions
  from prescription_versions
 ), item_relations as (
  select distinct receipt_id,evidence_hash,facets->>'disposition' disposition
  from context where resource='prescriptionitem' and receipt_kind='imported_prescription'
 ), item_counts as (
  select disposition,count(*) approval_observation_relations from item_relations group by disposition
 ), distinct_native as (
  select native_kind,native_id,bool_or(local_changed) local_changed
  from public.ezyvet_migration_terminal_native_outcomes(p_migration_run_id)
  group by native_kind,native_id
 ), native_counts as (
  select native_kind,count(*) records,count(*) filter(where local_changed) locally_changed_records
  from distinct_native group by native_kind
 )
 select jsonb_build_object('version',1,'migration_run_id',r.id,
  'receipts',coalesce((select jsonb_object_agg(receipt_kind,to_jsonb(c)-'receipt_kind') from receipt_counts c),'{}'::jsonb),
  'native_outcomes',coalesce((select jsonb_object_agg(native_kind,to_jsonb(c)-'native_kind') from native_counts c),'{}'::jsonb),
  'attachment_capture',(select totals from capture_totals),
  'prescription_review_gaps',(select to_jsonb(prescription_gaps) from prescription_gaps),
  'prescription_item_relations',coalesce((select jsonb_object_agg(disposition,approval_observation_relations) from item_counts),'{}'::jsonb),
  'facets_overlap',true,'standalone_consult_approval','not_applicable',
  'complete_coverage_verified',false,'cutover_accepted',false)
 from owned r;
$$;
revoke all on function public.ezyvet_migration_outcome_totals(uuid) from public,anon,authenticated,service_role;

create function public.ezyvet_migration_scan_totals(p_migration_run_id uuid)
returns jsonb language sql stable security invoker set search_path=public as $$
 with owned as materialized (
  select id,source_origin,source_site_uid from public.ezyvet_migration_runs
  where id=p_migration_run_id and actor_id=auth.uid() and public.ezyvet_is_active_admin(auth.uid()) is true
 ), bound as materialized (
  select s.*,b.child_run_id,
   exists(select 1 from public.ezyvet_identity_heads h where h.source_origin=r.source_origin and h.source_site_uid=r.source_site_uid
    and h.resource=s.parent_type and h.external_id=s.parent_external_id and h.snapshot_id=s.parent_snapshot_id and h.version=s.parent_head_version) parent_current,
   case when s.pet_id is null then exists(select 1 from public.clients where id=s.client_id)
    else exists(select 1 from public.pets where id=s.pet_id and client_id=s.client_id) end household_current
  from owned r join public.ezyvet_migration_scopes s on s.migration_run_id=r.id
  join public.ezyvet_migration_bindings b on b.scope_id=s.id and b.actor_id=auth.uid()
  join public.ezyvet_import_runs c on c.id=b.child_run_id and c.requested_by=auth.uid()
  where s.disposition='required' and not exists(select 1 from public.ezyvet_migration_bindings newer where newer.replaces_id=b.id)
 ), children as materialized (
  select c.* from public.ezyvet_import_runs c where c.id in(select child_run_id from bound)
 ), scans as (
  select count(*) distinct_child_runs,count(*) filter(where status='review_ready') traversal_ended,
   count(*) filter(where status='running') unfinished,count(*) filter(where status='page_limit_reached') page_limited,
   count(*) filter(where retry_after>statement_timestamp()) cooling_down,
   count(*) filter(where lease_until>statement_timestamp()) active_leases,
   count(*) filter(where last_error_code is not null) with_latest_error
  from children
 ), events as materialized (
  select e.* from public.ezyvet_migration_attempt_events e join children c on c.id=e.child_run_id where e.actor_id=auth.uid()
 )
 select jsonb_build_object('version',1,'migration_run_id',r.id,'scans',(select to_jsonb(scans) from scans),
  'pages_observed',(select count(*) from public.ezyvet_import_pages p join children c on c.id=p.run_id),
  'bound_required_scopes',(select count(*) from bound),
  'stale_parent_scopes',(select count(*) from bound where not parent_current),
  'changed_household_scopes',(select count(*) from bound where not household_current),
  'attempt_history',jsonb_build_object(
   'claims',(select count(*) from events where kind='claimed'),
   'failed_pages',(select count(*) from events where kind='page_failed'),
   'staged_pages',(select count(*) from events where kind='page_staged'),
   'children_with_complete_history',(select count(distinct child_run_id) from events where history_origin='run_created'),
   'children_without_complete_history',(select count(*) from children c where not exists(select 1 from events e where e.child_run_id=c.id and e.history_origin='run_created'))),
  'provider_total',null,'complete_coverage_verified',false,'cutover_accepted',false)
 from owned r;
$$;
revoke all on function public.ezyvet_migration_scan_totals(uuid) from public,anon,authenticated,service_role;

-- Observation review relationships are not approval-version or native-record totals.
create function public.ezyvet_migration_review_totals(p_migration_run_id uuid)
returns jsonb language sql stable security invoker set search_path=public as $$
 with owned as materialized (
  select id from public.ezyvet_migration_runs where id=p_migration_run_id
   and actor_id=auth.uid() and public.ezyvet_is_active_admin(auth.uid()) is true
 ), observations as materialized (
  select distinct resource,evidence_hash from public.ezyvet_migration_terminal_observations(p_migration_run_id)
 ), receipts as materialized (
  select resource,evidence_hash,receipt_id,relationship='exact_source_version' exact_match,
   relationship='same_snapshot_unknown_observed_head' unknown_head_match,source_current,superseded
  from public.ezyvet_migration_terminal_standard_receipts(p_migration_run_id)
  where receipt_kind<>'weight_source_acknowledgment'
  union all
  select resource,evidence_hash,receipt_id,
   case when resource='prescriptionitem' then coalesce((facets->>'parent_matches')::boolean,false)
    and facets->>'disposition' in ('selected','omitted') else true end,
   false,(facets->>'source_current')::boolean,(facets->>'superseded')::boolean
  from public.ezyvet_migration_terminal_context_receipts(p_migration_run_id)
  where receipt_kind in ('imported_prescription','attachment_original_approval')
 ), relationships as (
  select o.resource,o.evidence_hash,count(r.receipt_id)>0 has_approval,
   coalesce(bool_or(r.exact_match),false) exact_match,
   coalesce(bool_or(r.unknown_head_match),false) unknown_head_match,
   coalesce(bool_or(r.exact_match and r.source_current and not r.superseded),false) current_latest_exact_match
  from observations o left join receipts r on r.resource=o.resource and r.evidence_hash=o.evidence_hash
  group by o.resource,o.evidence_hash
 ), resources as (
  select distinct s.resource from owned r join public.ezyvet_migration_scopes s on s.migration_run_id=r.id
 ), counts as (
  select s.resource,count(r.evidence_hash) observed_occurrences,
   case when s.resource='consult' then 'not_applicable' else 'applicable' end approval_applicability,
   case when s.resource<>'consult' then count(r.evidence_hash) filter(where not r.has_approval) end occurrences_without_approval,
   case when s.resource<>'consult' then count(r.evidence_hash) filter(where r.exact_match) end occurrences_with_exact_approval,
   case when s.resource<>'consult' then count(r.evidence_hash) filter(where r.unknown_head_match) end occurrences_with_snapshot_only_approval,
   case when s.resource<>'consult' then count(r.evidence_hash) filter(where r.current_latest_exact_match) end occurrences_with_current_latest_exact_approval
  from resources s left join relationships r on r.resource=s.resource group by s.resource
 )
 select jsonb_build_object('version',1,'migration_run_id',o.id,
  'resources',coalesce((select jsonb_agg(to_jsonb(c) order by resource) from counts c),'[]'::jsonb),
  'facets_overlap',true,'complete_coverage_verified',false,'cutover_accepted',false)
 from owned o;
$$;
revoke all on function public.ezyvet_migration_review_totals(uuid) from public,anon,authenticated,service_role;

-- Stable helpers share the calling statement's snapshot; no independently paged totals.
create function public.ezyvet_migration_global_projection(p_migration_run_id uuid)
returns jsonb language sql stable security invoker set search_path=public as $$
 select jsonb_build_object('version',1,'migration_run_id',r.id,'actor_id',r.actor_id,
  'observed_at',statement_timestamp(),'intent_hash',r.intent_hash,
  'source',public.ezyvet_migration_source_totals(r.id),
  'scan',public.ezyvet_migration_scan_totals(r.id),
  'outcomes',public.ezyvet_migration_outcome_totals(r.id),
  'review',public.ezyvet_migration_review_totals(r.id),
  'complete_coverage_verified',false,'cutover_accepted',false)
 from public.ezyvet_migration_runs r where r.id=p_migration_run_id and r.actor_id=auth.uid()
  and public.ezyvet_is_active_admin(auth.uid()) is true;
$$;
revoke all on function public.ezyvet_migration_global_projection(uuid) from public,anon,authenticated,service_role;

-- Durable immutable preparation identity. Chunk persistence/finalization follow separately.
create table public.ezyvet_migration_preparations (
 id uuid primary key,
 actor_id uuid not null references public.profiles(id),
 migration_run_id uuid not null references public.ezyvet_migration_runs(id),
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 intent_hash text not null check(intent_hash ~ '^[a-f0-9]{64}$'),
 plan_hash text not null check(plan_hash ~ '^[a-f0-9]{64}$'),
 dependency_snapshot pg_snapshot not null,
 dependency_transaction xid8 not null,
 dependency_boundary bigint not null,
 plan jsonb not null check(jsonb_typeof(plan)='array' and jsonb_array_length(plan) between 1 and 100 and octet_length(plan::text)<=262144),
 created_at timestamptz not null default clock_timestamp()
);
create index ezyvet_migration_preparations_owner on public.ezyvet_migration_preparations(actor_id,migration_run_id,created_at desc,id desc);
alter table public.ezyvet_migration_preparations enable row level security;
revoke all on public.ezyvet_migration_preparations from public,anon,authenticated,service_role;
create trigger immutable_migration_preparation before update or delete on public.ezyvet_migration_preparations
 for each row execute function public.guard_inquiry_history();

create function public.prepare_ezyvet_migration_projection(p_id uuid,p_migration_run_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare a uuid:=auth.uid();r public.ezyvet_migration_runs;prepared public.ezyvet_migration_preparations;
 digest text;blueprint jsonb;result jsonb;baseline pg_snapshot;own_transaction xid8;boundary bigint;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_migration_run_id is null then raise exception 'Preparation identity required' using errcode='23514';end if;
 digest:=encode(sha256(convert_to(jsonb_build_array(1,p_migration_run_id)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('migration-preparation:'||p_id::text,0));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into r from public.ezyvet_migration_runs where id=p_migration_run_id and actor_id=a;
 if r.id is null then raise exception 'Owned migration manifest required' using errcode='42501';end if;
 select * into prepared from public.ezyvet_migration_preparations where id=p_id;
 if prepared.id is not null then
  if prepared.actor_id<>a or prepared.request_hash<>digest then raise exception 'Preparation identity cannot change' using errcode='42501';end if;
 else
  with scoped as (
   select s.*,b.id binding_id,b.context_hash,c.id child_run_id,c.status scan_status,
    p.page_count,p.last_page,p.inventory_hash
   from public.ezyvet_migration_scopes s
   left join public.ezyvet_migration_bindings b on b.scope_id=s.id and b.actor_id=a and s.disposition='required'
    and not exists(select 1 from public.ezyvet_migration_bindings newer where newer.replaces_id=b.id)
   left join public.ezyvet_import_runs c on c.id=b.child_run_id and c.requested_by=a
   cross join lateral (
    select count(*) page_count,coalesce(max(page),0) last_page,
     encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(page,item_count) order by page),'[]'::jsonb)::text,'UTF8')),'hex') inventory_hash
    from public.ezyvet_import_pages where run_id=c.id
   ) p
   where s.migration_run_id=r.id
  )
  select jsonb_agg(jsonb_build_object('scope_id',s.id,'scope_hash',encode(sha256(convert_to(to_jsonb(original)::text,'UTF8')),'hex'),
   'resource',s.resource,'disposition',s.disposition,'binding_id',s.binding_id,'context_hash',s.context_hash,
   'child_run_id',s.child_run_id,'scan_status',s.scan_status,'page_count',s.page_count,'last_page',s.last_page,'page_inventory_hash',s.inventory_hash) order by s.id)
  ,pg_current_snapshot(),pg_current_xact_id(),(select coalesce(max(id),0) from public.ezyvet_migration_dependency_changes)
  into blueprint,baseline,own_transaction,boundary from scoped s join public.ezyvet_migration_scopes original on original.id=s.id;
  if exists(select 1 from jsonb_array_elements(blueprint) x where (x->>'page_count')::integer<>(x->>'last_page')::integer
   or (x->>'binding_id' is not null and x->>'child_run_id' is null)) then
   raise exception 'Migration page inventory is incomplete' using errcode='40001';
  end if;
  insert into public.ezyvet_migration_preparations(id,actor_id,migration_run_id,request_hash,intent_hash,plan_hash,plan,dependency_snapshot,dependency_transaction,dependency_boundary)
  values(p_id,a,r.id,digest,r.intent_hash,encode(sha256(convert_to(blueprint::text,'UTF8')),'hex'),blueprint,baseline,own_transaction,boundary) returning * into prepared;
 end if;
 result:=(to_jsonb(prepared)-'plan')||jsonb_build_object('version',1,'scope_count',jsonb_array_length(prepared.plan),
  'bound_scopes',(select count(*) from jsonb_array_elements(prepared.plan) x where x->>'binding_id' is not null),
  'planned_scope_pages',(select coalesce(sum((x->>'page_count')::integer),0) from jsonb_array_elements(prepared.plan) x),
  'report_ready',false,'complete_coverage_verified',false,'cutover_accepted',false);
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return result;
end;
$$;
revoke all on function public.prepare_ezyvet_migration_projection(uuid,uuid) from public,anon,authenticated,service_role;

create table public.ezyvet_migration_source_chunks (
 preparation_id uuid not null references public.ezyvet_migration_preparations(id),
 actor_id uuid not null references public.profiles(id),
 binding_id uuid not null references public.ezyvet_migration_bindings(id),
 first_page integer not null check(first_page between 1 and 1000 and (first_page-1)%20=0),
 page_count integer not null check(page_count between 1 and 20 and first_page+page_count-1<=1000),
 entries jsonb not null check(jsonb_typeof(entries)='array' and jsonb_array_length(entries)<=1000 and octet_length(entries::text)<=4194304),
 observation_count integer generated always as (jsonb_array_length(entries)) stored,
 evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'),
 observed_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(preparation_id,binding_id,first_page)
);
alter table public.ezyvet_migration_source_chunks enable row level security;
revoke all on public.ezyvet_migration_source_chunks from public,anon,authenticated,service_role;
create trigger immutable_migration_source_chunk before update or delete on public.ezyvet_migration_source_chunks
 for each row execute function public.guard_inquiry_history();

create function public.prepare_ezyvet_migration_source_chunk(p_preparation_id uuid,p_binding_id uuid,p_first_page integer)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare a uuid:=auth.uid();prepared public.ezyvet_migration_preparations;chunk public.ezyvet_migration_source_chunks;
 planned jsonb;entries jsonb;pages integer;inventory_hash text;inventory_count integer;binding_valid boolean;observed timestamptz;result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_preparation_id is null or p_binding_id is null or p_first_page is null or p_first_page not between 1 and 1000 or (p_first_page-1)%20<>0 then
  raise exception 'Invalid preparation chunk identity' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('migration-chunk:'||p_preparation_id::text||':'||p_binding_id::text||':'||p_first_page::text,0));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into prepared from public.ezyvet_migration_preparations where id=p_preparation_id and actor_id=a;
 if prepared.id is null then raise exception 'Owned preparation required' using errcode='42501';end if;
 select x into planned from jsonb_array_elements(prepared.plan) x where x->>'binding_id'=p_binding_id::text and x->>'disposition'='required';
 if planned is null then raise exception 'Prepared binding required' using errcode='42501';end if;
 pages:=least(20,(planned->>'page_count')::integer-p_first_page+1);
 if pages<1 then raise exception 'Chunk outside prepared inventory' using errcode='23514';end if;
 select * into chunk from public.ezyvet_migration_source_chunks
 where preparation_id=p_preparation_id and binding_id=p_binding_id and first_page=p_first_page and actor_id=a;
 if chunk.preparation_id is null then
  -- Inventory validation and bounded extraction share one statement snapshot.
  with target as materialized (
   select b.* from public.ezyvet_migration_bindings b join public.ezyvet_import_runs c on c.id=b.child_run_id
   where b.id=p_binding_id and b.actor_id=a and c.requested_by=a
    and b.scope_id::text=planned->>'scope_id' and b.child_run_id::text=planned->>'child_run_id' and b.context_hash=planned->>'context_hash'
    and not exists(select 1 from public.ezyvet_migration_bindings newer where newer.replaces_id=b.id)
  ), inventory as materialized (
   select count(*)::integer page_count,
    encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(p.page,p.item_count) order by p.page),'[]'::jsonb)::text,'UTF8')),'hex') digest
   from public.ezyvet_import_pages p join target b on b.child_run_id=p.run_id
  ), observations as materialized (
   select o.* from public.ezyvet_migration_observation_chunk(prepared.migration_run_id,p_binding_id,p_first_page,pages) o
   where exists(select 1 from target) and (select digest from inventory)=planned->>'page_inventory_hash'
  )
  select exists(select 1 from target),(select page_count from inventory),(select digest from inventory),
   coalesce((select jsonb_agg(to_jsonb(o) order by o.page,o.ordinal,o.snapshot_id) from observations o),'[]'::jsonb),statement_timestamp()
  into binding_valid,inventory_count,inventory_hash,entries,observed;
  if not binding_valid or inventory_count<>(planned->>'page_count')::integer or inventory_hash<>planned->>'page_inventory_hash' then
   raise exception 'Prepared source inventory changed' using errcode='40001';end if;
  perform public.assert_ezyvet_migration_dependencies(p_preparation_id);
  insert into public.ezyvet_migration_source_chunks(preparation_id,actor_id,binding_id,first_page,page_count,entries,evidence_hash,observed_at)
  values(p_preparation_id,a,p_binding_id,p_first_page,pages,entries,
   encode(sha256(convert_to(jsonb_build_array(1,prepared.plan_hash,p_binding_id,p_first_page,pages,entries)::text,'UTF8')),'hex'),observed)
  returning * into chunk;
 end if;
 result:=(to_jsonb(chunk)-'entries')||jsonb_build_object('version',1,'observations',jsonb_array_length(chunk.entries),
  'currentness_reverified',false,'report_ready',false,'complete_coverage_verified',false,'cutover_accepted',false);
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return result;
end;
$$;
revoke all on function public.prepare_ezyvet_migration_source_chunk(uuid,uuid,integer) from public,anon,authenticated,service_role;

create function public.read_ezyvet_migration_preparation_progress(p_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare a uuid:=auth.uid();result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 with owned as materialized (
  select * from public.ezyvet_migration_preparations where id=p_id and actor_id=a
 ), planned as materialized (
  select p.id preparation_id,x.* from owned p cross join lateral jsonb_to_recordset(p.plan)
   as x(scope_id uuid,resource text,disposition text,binding_id uuid,child_run_id uuid,context_hash text,page_count integer,page_inventory_hash text)
 ), chunks as materialized (
  select c.binding_id,c.first_page,c.page_count,c.observation_count
  from owned p join public.ezyvet_migration_source_chunks c on c.preparation_id=p.id and c.actor_id=a
 ), scopes as (
  select p.scope_id,p.resource,p.disposition,p.binding_id,p.child_run_id,p.page_count planned_pages,
   (p.page_count+19)/20 expected_chunks,
   (select count(*) from chunks c where c.binding_id=p.binding_id) stored_chunks,
   (select coalesce(sum(c.observation_count),0) from chunks c where c.binding_id=p.binding_id) stored_scope_observations,
   (select min(g.first_page) from generate_series(1,p.page_count,20) as g(first_page)
    where not exists(select 1 from chunks c where c.binding_id=p.binding_id and c.first_page=g.first_page)) next_missing_page,
   case when p.binding_id is null then null else
    b.id is not null and b.context_hash=p.context_hash and b.child_run_id=p.child_run_id and b.scope_id=p.scope_id
    and c.id is not null and not exists(select 1 from public.ezyvet_migration_bindings newer where newer.replaces_id=b.id)
    and inventory.page_count=p.page_count and inventory.digest=p.page_inventory_hash end source_inventory_matches
  from planned p left join public.ezyvet_migration_bindings b on b.id=p.binding_id and b.actor_id=a
  left join public.ezyvet_import_runs c on c.id=b.child_run_id and c.requested_by=a
  cross join lateral (
   select count(*) page_count,encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(page,item_count) order by page),'[]'::jsonb)::text,'UTF8')),'hex') digest
   from public.ezyvet_import_pages where run_id=c.id
  ) inventory
 )
 select jsonb_build_object('version',1,'id',p.id,'migration_run_id',p.migration_run_id,'actor_id',p.actor_id,'plan_hash',p.plan_hash,'created_at',p.created_at,
  'scopes',coalesce((select jsonb_agg(to_jsonb(s) order by scope_id) from scopes s),'[]'::jsonb),
  'expected_source_chunks',(select coalesce(sum(expected_chunks),0) from scopes),
  'stored_source_chunks',(select count(*) from chunks),
  'source_chunks_saved',not exists(select 1 from scopes where next_missing_page is not null),
  'unbound_required_scopes',(select count(*) from scopes where disposition='required' and binding_id is null),
  'changed_source_inventories',(select count(*) from scopes where source_inventory_matches is false),
  'review_dependencies_revalidated',false,'report_ready',false,'complete_coverage_verified',false,'cutover_accepted',false,'observed_at',statement_timestamp())
 into result from owned p;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if result is null then raise exception 'Owned preparation required' using errcode='42501';end if;
 return result;
end;
$$;
revoke all on function public.read_ezyvet_migration_preparation_progress(uuid) from public,anon,authenticated,service_role;

create function public.list_ezyvet_migration_preparations(p_migration_run_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare a uuid:=auth.uid();result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_migration_run_id is null or (p_before_at is null)<>(p_before_id is null) or (p_before_at is not null and not isfinite(p_before_at))
  or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid preparation history cursor' using errcode='23514';end if;
 with owned as materialized (
  select id from public.ezyvet_migration_runs where id=p_migration_run_id and actor_id=a
 ), bounded as materialized (
  select p.id,p.actor_id,p.migration_run_id,p.intent_hash,p.plan_hash,p.created_at
  from owned r join public.ezyvet_migration_preparations p on p.migration_run_id=r.id and p.actor_id=a
  where p_before_at is null or (p.created_at,p.id)<(p_before_at,p_before_id)
  order by p.created_at desc,p.id desc limit p_limit+1
 ), selected as materialized (
  select * from bounded order by created_at desc,id desc limit p_limit
 )
 select jsonb_build_object('version',1,'migration_run_id',r.id,'actor_id',a,
  'preparations',coalesce((select jsonb_agg(to_jsonb(s) order by created_at desc,id desc) from selected s),'[]'::jsonb),
  'has_more',(select count(*)>p_limit from bounded),
  'next_cursor',case when (select count(*)>p_limit from bounded) then
   (select jsonb_build_object('before_at',created_at,'before_id',id) from selected order by created_at,id limit 1) else null end)
 into result from owned r;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if result is null then raise exception 'Owned migration manifest required' using errcode='42501';end if;
 return result;
end;
$$;
revoke all on function public.list_ezyvet_migration_preparations(uuid,timestamptz,uuid,integer) from public,anon,authenticated,service_role;

-- Bounded canonical approval read over one persisted source observation.
-- This is not yet a persisted/consistent multi-chunk review report.
create function public.read_ezyvet_migration_prepared_history_evidence(
 p_preparation_id uuid,p_binding_id uuid,p_first_page integer,p_observation_index integer,
 p_before_version integer default null,p_limit integer default 20)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare a uuid:=auth.uid();chunk public.ezyvet_migration_source_chunks;entry jsonb;result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_observation_index is null or p_observation_index not between 1 and 1000 or p_limit is null or p_limit not between 1 and 100
  or (p_before_version is not null and p_before_version<1) then raise exception 'Invalid prepared history cursor' using errcode='23514';end if;
 select c.* into chunk from public.ezyvet_migration_source_chunks c
 join public.ezyvet_migration_preparations p on p.id=c.preparation_id and p.actor_id=a
 where c.preparation_id=p_preparation_id and c.actor_id=a and c.binding_id=p_binding_id and c.first_page=p_first_page;
 if chunk.preparation_id is null then raise exception 'Owned source chunk required' using errcode='42501';end if;
 entry:=chunk.entries->(p_observation_index-1);
 if entry is null or entry->>'resource'<>'history' then raise exception 'Saved history observation required' using errcode='23514';end if;
 result:=public.list_ezyvet_migration_history_evidence(p_binding_id,(entry->>'page')::integer,
  (entry->>'snapshot_id')::uuid,entry->>'evidence_hash',p_before_version,p_limit);
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return result||jsonb_build_object('preparation_id',p_preparation_id,'source_chunk_hash',chunk.evidence_hash,
  'observation_index',p_observation_index,'dependency_consistency_verified',false,'report_ready',false);
end;
$$;
revoke all on function public.read_ezyvet_migration_prepared_history_evidence(uuid,uuid,integer,integer,integer,integer) from public,anon,authenticated,service_role;

-- Shared bounded dispatch preserves resource-specific canonical review semantics.
create function public.read_ezyvet_migration_prepared_versioned_evidence(
 p_preparation_id uuid,p_binding_id uuid,p_first_page integer,p_observation_index integer,
 p_before_version integer default null,p_limit integer default 20)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare a uuid:=auth.uid();chunk public.ezyvet_migration_source_chunks;entry jsonb;result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_observation_index is null or p_observation_index not between 1 and 1000 or p_limit is null or p_limit not between 1 and 100
  or (p_before_version is not null and p_before_version<1) then raise exception 'Invalid prepared review cursor' using errcode='23514';end if;
 select c.* into chunk from public.ezyvet_migration_source_chunks c
 join public.ezyvet_migration_preparations p on p.id=c.preparation_id and p.actor_id=a
 where c.preparation_id=p_preparation_id and c.actor_id=a and c.binding_id=p_binding_id and c.first_page=p_first_page;
 if chunk.preparation_id is null then raise exception 'Owned source chunk required' using errcode='42501';end if;
 entry:=chunk.entries->(p_observation_index-1);
 if entry is null or entry->>'resource' not in ('history','vaccination','prescription','prescriptionitem') then raise exception 'Saved versioned observation required' using errcode='23514';end if;
 case entry->>'resource'
  when 'history' then result:=public.list_ezyvet_migration_history_evidence(p_binding_id,(entry->>'page')::integer,
   (entry->>'snapshot_id')::uuid,entry->>'evidence_hash',p_before_version,p_limit);
  when 'vaccination' then result:=public.list_ezyvet_migration_vaccination_evidence(p_binding_id,(entry->>'page')::integer,
   (entry->>'snapshot_id')::uuid,entry->>'evidence_hash',p_before_version,p_limit);
  when 'prescription' then result:=public.list_ezyvet_migration_prescription_evidence(p_binding_id,(entry->>'page')::integer,
   (entry->>'snapshot_id')::uuid,entry->>'evidence_hash',p_before_version,p_limit);
  when 'prescriptionitem' then result:=public.list_ezyvet_migration_prescription_item_evidence(p_binding_id,(entry->>'page')::integer,
   (entry->>'snapshot_id')::uuid,entry->>'evidence_hash',p_before_version,p_limit);
 end case;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return result||jsonb_build_object('preparation_id',p_preparation_id,'source_chunk_hash',chunk.evidence_hash,
  'observation_index',p_observation_index,'dependency_consistency_verified',false,'report_ready',false);
end;
$$;
revoke all on function public.read_ezyvet_migration_prepared_versioned_evidence(uuid,uuid,integer,integer,integer,integer) from public,anon,authenticated,service_role;

-- Identity links and owner-private timed receipts retain their canonical interpretation.
create function public.read_ezyvet_migration_prepared_identity_evidence(
 p_preparation_id uuid,p_binding_id uuid,p_first_page integer,p_observation_index integer)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare a uuid:=auth.uid();chunk public.ezyvet_migration_source_chunks;entry jsonb;result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_observation_index is null or p_observation_index not between 1 and 1000 then raise exception 'Invalid prepared identity observation' using errcode='23514';end if;
 select c.* into chunk from public.ezyvet_migration_source_chunks c
 join public.ezyvet_migration_preparations p on p.id=c.preparation_id and p.actor_id=a
 where c.preparation_id=p_preparation_id and c.actor_id=a and c.binding_id=p_binding_id and c.first_page=p_first_page;
 if chunk.preparation_id is null then raise exception 'Owned source chunk required' using errcode='42501';end if;
 entry:=chunk.entries->(p_observation_index-1);
 if entry is null or entry->>'resource' not in ('contact','animal') then raise exception 'Saved identity observation required' using errcode='23514';end if;
 result:=public.read_ezyvet_migration_identity_evidence(p_binding_id,(entry->>'page')::integer,
  (entry->>'snapshot_id')::uuid,entry->>'evidence_hash');
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return result||jsonb_build_object('preparation_id',p_preparation_id,'source_chunk_hash',chunk.evidence_hash,
  'observation_index',p_observation_index,'dependency_consistency_verified',false,'report_ready',false);
end;
$$;
revoke all on function public.read_ezyvet_migration_prepared_identity_evidence(uuid,uuid,integer,integer) from public,anon,authenticated,service_role;

create function public.read_ezyvet_migration_prepared_timed_evidence(
 p_preparation_id uuid,p_binding_id uuid,p_first_page integer,p_observation_index integer,
 p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare a uuid:=auth.uid();chunk public.ezyvet_migration_source_chunks;entry jsonb;result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_observation_index is null or p_observation_index not between 1 and 1000 or p_limit is null or p_limit not between 1 and 100
  or (p_before_at is null)<>(p_before_id is null) or (p_before_at is not null and not isfinite(p_before_at)) then raise exception 'Invalid prepared timed cursor' using errcode='23514';end if;
 select c.* into chunk from public.ezyvet_migration_source_chunks c
 join public.ezyvet_migration_preparations p on p.id=c.preparation_id and p.actor_id=a
 where c.preparation_id=p_preparation_id and c.actor_id=a and c.binding_id=p_binding_id and c.first_page=p_first_page;
 if chunk.preparation_id is null then raise exception 'Owned source chunk required' using errcode='42501';end if;
 entry:=chunk.entries->(p_observation_index-1);
 if entry is null or entry->>'resource' not in ('healthstatus','attachment') then raise exception 'Saved timed observation required' using errcode='23514';end if;
 case entry->>'resource'
  when 'healthstatus' then result:=public.read_ezyvet_migration_weight_evidence(p_binding_id,(entry->>'page')::integer,
   (entry->>'snapshot_id')::uuid,entry->>'evidence_hash',p_before_at,p_before_id,p_limit);
  when 'attachment' then result:=public.list_ezyvet_migration_capture_evidence(p_binding_id,(entry->>'page')::integer,
   (entry->>'ordinal')::integer,(entry->>'snapshot_id')::uuid,entry->>'evidence_hash',p_before_at,p_before_id,p_limit);
 end case;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return result||jsonb_build_object('preparation_id',p_preparation_id,'source_chunk_hash',chunk.evidence_hash,
  'observation_index',p_observation_index,'dependency_consistency_verified',false,'report_ready',false);
end;
$$;
revoke all on function public.read_ezyvet_migration_prepared_timed_evidence(uuid,uuid,integer,integer,timestamptz,uuid,integer) from public,anon,authenticated,service_role;

-- Shared approval facts are independent of private capture-request ownership.
create function public.read_ezyvet_migration_prepared_original_evidence(
 p_preparation_id uuid,p_binding_id uuid,p_first_page integer,p_observation_index integer,
 p_before_version integer default null,p_limit integer default 20)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare a uuid:=auth.uid();chunk public.ezyvet_migration_source_chunks;entry jsonb;result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_observation_index is null or p_observation_index not between 1 and 1000 or p_limit is null or p_limit not between 1 and 100
  or (p_before_version is not null and p_before_version<1) then raise exception 'Invalid prepared original cursor' using errcode='23514';end if;
 select c.* into chunk from public.ezyvet_migration_source_chunks c
 join public.ezyvet_migration_preparations p on p.id=c.preparation_id and p.actor_id=a
 where c.preparation_id=p_preparation_id and c.actor_id=a and c.binding_id=p_binding_id and c.first_page=p_first_page;
 if chunk.preparation_id is null then raise exception 'Owned source chunk required' using errcode='42501';end if;
 entry:=chunk.entries->(p_observation_index-1);
 if entry is null or entry->>'resource'<>'attachment' then raise exception 'Saved attachment observation required' using errcode='23514';end if;
 with bounded as materialized (
  select v.id,v.version,q.id capture_request_id
  from public.ezyvet_attachment_record_versions v
  join public.ezyvet_attachment_capture_requests q on q.id=v.request_id
  join public.ezyvet_attachment_original_captures c on c.request_id=q.id and c.capture_hash=v.capture_hash
  join public.ezyvet_migration_scopes s on s.id=(entry->>'scope_id')::uuid
  where v.animal_link_id=(entry->>'mapping_id')::uuid and v.pet_id=(entry->>'pet_id')::uuid
   and v.attachment_external_id=entry->>'external_id'
   and q.animal_link_id=v.animal_link_id and q.pet_id=v.pet_id and q.client_id=(entry->>'client_id')::uuid
   and q.snapshot_id=(entry->>'snapshot_id')::uuid and q.observed_head_version=(entry->>'observed_head_version')::integer
   and q.external_id=entry->>'external_id' and q.file_id=entry->>'file_id' and q.stable_metadata_sha256=entry->>'stable_metadata_sha256'
   and q.parent_context->>'source_origin'=entry->>'source_origin' and q.parent_context->>'source_site_uid'=entry->>'source_site_uid'
   and q.parent_context->>'parent_snapshot_id'=entry->>'parent_snapshot_id'
   and q.parent_context->>'parent_observed_head_version'=entry->>'parent_head_version'
   and q.parent_context->>'animal_external_id'=s.parent_external_id
   and (p_before_version is null or v.version<p_before_version)
  order by v.version desc limit p_limit+1
 ), selected as materialized (select * from bounded order by version desc limit p_limit), projected as (
  select v.version,jsonb_build_object('id',v.id,'version',v.version,
   'approval_visibility','approved_patient_history','source_current',public.ezyvet_attachment_capture_current(v.capture_request_id),
   'superseded',exists(select 1 from public.ezyvet_attachment_record_versions newer
    where newer.animal_link_id=(entry->>'mapping_id')::uuid and newer.attachment_external_id=entry->>'external_id' and newer.version>v.version),
   'original_bytes_reverified',false) receipt from selected v
 )
 select jsonb_build_object('preparation_id',p_preparation_id,'binding_id',p_binding_id,'source_chunk_hash',chunk.evidence_hash,
  'observation_index',p_observation_index,'evidence_hash',entry->>'evidence_hash',
  'approvals',coalesce((select jsonb_agg(receipt order by version desc) from projected),'[]'::jsonb),
  'has_more',(select count(*)>p_limit from bounded),'next_cursor',case when (select count(*)>p_limit from bounded)
   then (select jsonb_build_object('before_version',min(version)) from selected) else null end,
  'dependency_consistency_verified',false,'report_ready',false,'original_bytes_reverified',false) into result;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return result;
end;
$$;
revoke all on function public.read_ezyvet_migration_prepared_original_evidence(uuid,uuid,integer,integer,integer,integer) from public,anon,authenticated,service_role;

-- Page exact native provenance independently of approval revision pagination.
create index ezyvet_problem_history_source_cursor on public.ezyvet_problem_history_sources(history_id,extraction_id);
create function public.read_ezyvet_migration_prepared_native_evidence(
 p_preparation_id uuid,p_binding_id uuid,p_first_page integer,p_observation_index integer,p_approval_id uuid,
 p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare a uuid:=auth.uid();chunk public.ezyvet_migration_source_chunks;entry jsonb;approval public.ezyvet_imported_histories;result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_observation_index is null or p_observation_index not between 1 and 1000 or p_approval_id is null
  or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid prepared native cursor' using errcode='23514';end if;
 select c.* into chunk from public.ezyvet_migration_source_chunks c
 join public.ezyvet_migration_preparations p on p.id=c.preparation_id and p.actor_id=a
 where c.preparation_id=p_preparation_id and c.actor_id=a and c.binding_id=p_binding_id and c.first_page=p_first_page;
 if chunk.preparation_id is null then raise exception 'Owned source chunk required' using errcode='42501';end if;
 entry:=chunk.entries->(p_observation_index-1);
 if entry is null or entry->>'resource'<>'history' then raise exception 'Saved history observation required' using errcode='23514';end if;
 select h.* into approval from public.ezyvet_imported_histories h where h.id=p_approval_id
  and h.animal_link_id=(entry->>'mapping_id')::uuid and h.pet_id=(entry->>'pet_id')::uuid
  and h.source_origin=entry->>'source_origin' and h.source_site_uid=entry->>'source_site_uid' and h.history_external_id=entry->>'external_id';
 if approval.id is null then raise exception 'Related history approval required' using errcode='42501';end if;
 with bounded as materialized (
  select e.id provenance_id,e.problem_id native_id,e.action,e.problem_version,p.version current_version
  from public.ezyvet_problem_history_sources hs
  join public.ezyvet_problem_extractions e on e.id=hs.extraction_id and e.pet_id=approval.pet_id
  join public.patient_problems p on p.id=e.problem_id and p.pet_id=e.pet_id
  where hs.history_id=approval.id and hs.version_hash=approval.version_hash
   and (p_before_id is null or e.id<p_before_id) order by e.id desc limit p_limit+1
 ), selected as materialized (select * from bounded order by provenance_id desc limit p_limit)
 select jsonb_build_object('preparation_id',p_preparation_id,'binding_id',p_binding_id,'source_chunk_hash',chunk.evidence_hash,
  'observation_index',p_observation_index,'approval_id',approval.id,'approval_version_hash',approval.version_hash,
  'outcomes',coalesce((select jsonb_agg(jsonb_build_object('provenance_kind','problem_extraction','provenance_id',provenance_id,
   'native_kind','problem','native_id',native_id,'action',action,'recorded_version',problem_version,'current_version',current_version,
   'local_changed',problem_version<>current_version) order by provenance_id desc) from selected),'[]'::jsonb),
  'has_more',(select count(*)>p_limit from bounded),'next_cursor',case when (select count(*)>p_limit from bounded)
   then (select jsonb_build_object('before_id',provenance_id) from selected order by provenance_id limit 1) else null end,
  'dependency_consistency_verified',false,'report_ready',false) into result;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return result;
end;
$$;
revoke all on function public.read_ezyvet_migration_prepared_native_evidence(uuid,uuid,integer,integer,uuid,uuid,integer) from public,anon,authenticated,service_role;

create table public.ezyvet_migration_review_pages (
 id uuid primary key,actor_id uuid not null references public.profiles(id),
 preparation_id uuid not null,binding_id uuid not null,first_page integer not null,
 observation_index integer not null check(observation_index between 1 and 1000),
 kind text not null check(kind in ('identity','versioned','timed','original','native','cancellation')),
 approval_id uuid references public.ezyvet_imported_histories(id),
 page_limit integer not null check(page_limit between 1 and 100),
 input_cursor jsonb not null check(jsonb_typeof(input_cursor)='object'),
 continuation_cursor jsonb check(continuation_cursor is null or jsonb_typeof(continuation_cursor)='object'),
 has_more boolean not null,
 check(has_more=(continuation_cursor is not null)),
 check((kind='native')=(approval_id is not null)),
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 evidence jsonb not null check(jsonb_typeof(evidence)='object' and octet_length(evidence::text)<=1048576),
 evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(preparation_id,binding_id,first_page) references public.ezyvet_migration_source_chunks(preparation_id,binding_id,first_page)
);
alter table public.ezyvet_migration_review_pages enable row level security;
revoke all on public.ezyvet_migration_review_pages from public,anon,authenticated,service_role;
create trigger immutable_migration_review_page before update or delete on public.ezyvet_migration_review_pages
 for each row execute function public.guard_inquiry_history();
create index migration_review_page_preparation on public.ezyvet_migration_review_pages(preparation_id,binding_id,first_page,observation_index);

create function public.prepare_ezyvet_migration_review_page(
 p_id uuid,p_preparation_id uuid,p_binding_id uuid,p_first_page integer,p_observation_index integer,p_kind text,
 p_before_version integer default null,p_before_at timestamptz default null,p_before_id uuid default null,
 p_approval_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security invoker set search_path=public set timezone='UTC' as $$
declare a uuid:=auth.uid();saved public.ezyvet_migration_review_pages;args_hash text;result jsonb;cursor_in jsonb;cursor_out jsonb;more boolean;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_preparation_id is null or p_binding_id is null or p_first_page is null
  or p_observation_index is null or p_observation_index not between 1 and 1000 or p_kind is null
  or p_kind not in ('identity','versioned','timed','original','native','cancellation') or p_limit is null or p_limit not between 1 and 100
  or (p_before_version is not null and (p_kind not in ('versioned','original') or p_before_version<1))
  or (p_before_at is not null and (p_kind<>'timed' or not isfinite(p_before_at)))
  or (p_before_id is not null and p_kind not in ('timed','native','cancellation'))
  or (p_kind='timed' and (p_before_at is null)<>(p_before_id is null))
  or ((p_kind='native')<>(p_approval_id is not null)) then raise exception 'Invalid saved review request' using errcode='23514';end if;
 args_hash:=encode(sha256(convert_to(jsonb_build_array(1,a,p_preparation_id,p_binding_id,p_first_page,p_observation_index,p_kind,
  p_before_version,p_before_at,p_before_id,p_approval_id,p_limit)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('migration-review:'||p_id::text,0));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into saved from public.ezyvet_migration_review_pages where id=p_id;
 if saved.id is not null then
  if saved.actor_id<>a or saved.request_hash<>args_hash then raise exception 'Owned identical review request required' using errcode='42501';end if;
 else
  perform public.assert_ezyvet_migration_dependencies(p_preparation_id);
  case p_kind
   when 'identity' then result:=public.read_ezyvet_migration_prepared_identity_evidence(p_preparation_id,p_binding_id,p_first_page,p_observation_index);
   when 'versioned' then result:=public.read_ezyvet_migration_prepared_versioned_evidence(p_preparation_id,p_binding_id,p_first_page,p_observation_index,p_before_version,p_limit);
   when 'timed' then result:=public.read_ezyvet_migration_prepared_timed_evidence(p_preparation_id,p_binding_id,p_first_page,p_observation_index,p_before_at,p_before_id,p_limit);
   when 'original' then result:=public.read_ezyvet_migration_prepared_original_evidence(p_preparation_id,p_binding_id,p_first_page,p_observation_index,p_before_version,p_limit);
   when 'cancellation' then result:=public.read_ezyvet_migration_prepared_cancellation_evidence(p_preparation_id,p_binding_id,p_first_page,p_observation_index,p_before_id,p_limit);
   when 'native' then result:=public.read_ezyvet_migration_prepared_native_evidence(p_preparation_id,p_binding_id,p_first_page,p_observation_index,p_approval_id,p_before_id,p_limit);
  end case;
  if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
  perform public.assert_ezyvet_migration_dependencies(p_preparation_id);
  cursor_in:=jsonb_strip_nulls(jsonb_build_object('before_version',p_before_version,'before_at',p_before_at,'before_id',p_before_id));
  more:=coalesce((result->>'has_more')::boolean,false);
  cursor_out:=null;
  if more then
   case p_kind
    when 'versioned' then cursor_out:=jsonb_build_object('before_version',(result->>'next_before_version')::integer);
    when 'timed' then
     if result->>'resource'='healthstatus' then
      cursor_out:=jsonb_build_object('before_at',(result#>>'{next_cursor,created_at}')::timestamptz,'before_id',result#>>'{next_cursor,request_id}');
     else cursor_out:=result->'next_cursor';end if;
    else cursor_out:=result->'next_cursor';
   end case;
   if cursor_out is null or jsonb_typeof(cursor_out)<>'object' or cursor_out='{}'::jsonb
    or cursor_out<>jsonb_strip_nulls(cursor_out) or cursor_out=cursor_in then
    raise exception 'Invalid review continuation' using errcode='23514';end if;
  end if;
  insert into public.ezyvet_migration_review_pages(id,actor_id,preparation_id,binding_id,first_page,observation_index,kind,approval_id,page_limit,input_cursor,continuation_cursor,has_more,request_hash,evidence,evidence_hash)
   values(p_id,a,p_preparation_id,p_binding_id,p_first_page,p_observation_index,p_kind,p_approval_id,p_limit,cursor_in,cursor_out,more,args_hash,result,
    encode(sha256(convert_to(result::text,'UTF8')),'hex')) returning * into saved;
 end if;
 return to_jsonb(saved)||jsonb_build_object('currentness_reverified',false,'dependency_consistency_verified',false,'report_ready',false);
end;
$$;
revoke all on function public.prepare_ezyvet_migration_review_page(uuid,uuid,uuid,integer,integer,text,integer,timestamptz,uuid,uuid,integer) from public,anon,authenticated,service_role;

create index migration_review_page_discovery on public.ezyvet_migration_review_pages(preparation_id,created_at desc,id desc);
create function public.list_ezyvet_migration_review_pages(p_preparation_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security invoker set search_path=public set timezone='UTC' as $$
declare a uuid:=auth.uid();result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_preparation_id is null or (p_before_at is null)<>(p_before_id is null) or (p_before_at is not null and not isfinite(p_before_at))
  or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid review discovery cursor' using errcode='23514';end if;
 with owned as materialized (select id from public.ezyvet_migration_preparations where id=p_preparation_id and actor_id=a),
 bounded as materialized (
  select r.id,r.binding_id,r.first_page,r.observation_index,r.kind,r.approval_id,r.page_limit,r.input_cursor,r.continuation_cursor,r.has_more,r.request_hash,r.evidence_hash,r.created_at
  from owned p join public.ezyvet_migration_review_pages r on r.preparation_id=p.id and r.actor_id=a
  where p_before_at is null or (r.created_at,r.id)<(p_before_at,p_before_id)
  order by r.created_at desc,r.id desc limit p_limit+1
 ), selected as materialized (select * from bounded order by created_at desc,id desc limit p_limit)
 select jsonb_build_object('preparation_id',p.id,'pages',coalesce((select jsonb_agg(to_jsonb(s) order by created_at desc,id desc) from selected s),'[]'::jsonb),
  'has_more',(select count(*)>p_limit from bounded),'next_cursor',case when (select count(*)>p_limit from bounded)
   then (select jsonb_build_object('before_at',created_at,'before_id',id) from selected order by created_at,id limit 1) else null end,
  'currentness_reverified',false,'report_ready',false) into result from owned p;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if result is null then raise exception 'Owned preparation required' using errcode='42501';end if;
 return result;
end;
$$;
revoke all on function public.list_ezyvet_migration_review_pages(uuid,timestamptz,uuid,integer) from public,anon,authenticated,service_role;

create function public.read_ezyvet_migration_review_page(p_preparation_id uuid,p_id uuid)
returns jsonb language plpgsql security invoker set search_path=public set timezone='UTC' as $$
declare a uuid:=auth.uid();result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select to_jsonb(r)||jsonb_build_object('currentness_reverified',false,'dependency_consistency_verified',false,'report_ready',false) into result
 from public.ezyvet_migration_review_pages r join public.ezyvet_migration_preparations p on p.id=r.preparation_id and p.actor_id=a
 where r.preparation_id=p_preparation_id and r.id=p_id and r.actor_id=a;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if result is null then raise exception 'Owned review page required' using errcode='42501';end if;
 return result;
end;
$$;
revoke all on function public.read_ezyvet_migration_review_page(uuid,uuid) from public,anon,authenticated,service_role;

-- Transactional dependency journal for later cross-page consistency validation.
-- Report preparation/receipt writes are deliberately outside the dependency set.
create table public.ezyvet_migration_dependency_tables (
 table_name text primary key
);
create table public.ezyvet_migration_dependency_changes (
 id bigint generated always as identity primary key,
 transaction_id xid8 not null,
 table_name text not null references public.ezyvet_migration_dependency_tables(table_name),
 operation text not null check(operation in ('INSERT','UPDATE','DELETE','TRUNCATE'))
);
create index migration_dependency_transaction on public.ezyvet_migration_dependency_changes(transaction_id,id);
alter table public.ezyvet_migration_dependency_tables enable row level security;
alter table public.ezyvet_migration_dependency_changes enable row level security;
revoke all on public.ezyvet_migration_dependency_tables,public.ezyvet_migration_dependency_changes from public,anon,authenticated,service_role;
revoke all on sequence public.ezyvet_migration_dependency_changes_id_seq from public,anon,authenticated,service_role;
create trigger immutable_migration_dependency_inventory before update or delete on public.ezyvet_migration_dependency_tables
 for each row execute function public.guard_inquiry_history();
create trigger immutable_migration_dependency_change before update or delete on public.ezyvet_migration_dependency_changes
 for each row execute function public.guard_inquiry_history();
create function public.record_ezyvet_migration_dependency_change() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 insert into public.ezyvet_migration_dependency_changes(transaction_id,table_name,operation)
 values(pg_current_xact_id(),tg_table_name,tg_op);
 return null;
end;
$$;
revoke all on function public.record_ezyvet_migration_dependency_change() from public,anon,authenticated,service_role;
-- Conservative inventory includes all ezyVet operational tables, so indirect
-- currentness readers cannot silently omit a source/approval dependency.
insert into public.ezyvet_migration_dependency_tables(table_name)
 select tablename from pg_tables where schemaname='public'
 and (tablename like 'ezyvet\_%' escape '\' or tablename in ('clients','pets','patient_weights','patient_problems','profiles','user_roles'))
 and tablename not in ('ezyvet_migration_preparations','ezyvet_migration_source_chunks','ezyvet_migration_review_pages',
  'ezyvet_migration_dependency_tables','ezyvet_migration_dependency_changes','ezyvet_migration_review_chain_links','ezyvet_migration_review_requirements','ezyvet_migration_review_completions','ezyvet_migration_source_keys','ezyvet_migration_source_counts','ezyvet_migration_source_aggregations','ezyvet_migration_native_keys','ezyvet_migration_native_counts','ezyvet_migration_native_aggregations','ezyvet_migration_approval_states','ezyvet_migration_approval_counts','ezyvet_migration_approval_aggregations','ezyvet_migration_item_relation_keys','ezyvet_migration_item_relation_counts','ezyvet_migration_coverage_keys','ezyvet_migration_coverage_counts','ezyvet_migration_chunk_work_counts','ezyvet_migration_calculation_snapshots','ezyvet_migration_attempt_pages');
do $$declare t text;begin
 for t in select table_name from public.ezyvet_migration_dependency_tables loop
  execute format('create trigger migration_dependency_change after insert or update or delete or truncate on public.%I for each statement execute function public.record_ezyvet_migration_dependency_change()',t);
 end loop;
end $$;

-- Shared dependency check; new captures enforce it, finalization is pending.
create function public.read_ezyvet_migration_dependency_state(p_preparation_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare a uuid:=auth.uid();result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 with owned as materialized (select * from public.ezyvet_migration_preparations where id=p_preparation_id and actor_id=a),
 required_tables as materialized (
  select tablename table_name from pg_tables where schemaname='public'
  and (tablename like 'ezyvet\_%' escape '\' or tablename in ('clients','pets','patient_weights','patient_problems','profiles','user_roles'))
  and tablename not in ('ezyvet_migration_preparations','ezyvet_migration_source_chunks','ezyvet_migration_review_pages',
   'ezyvet_migration_dependency_tables','ezyvet_migration_dependency_changes','ezyvet_migration_review_chain_links','ezyvet_migration_review_requirements','ezyvet_migration_review_completions','ezyvet_migration_source_keys','ezyvet_migration_source_counts','ezyvet_migration_source_aggregations','ezyvet_migration_native_keys','ezyvet_migration_native_counts','ezyvet_migration_native_aggregations','ezyvet_migration_approval_states','ezyvet_migration_approval_counts','ezyvet_migration_approval_aggregations','ezyvet_migration_item_relation_keys','ezyvet_migration_item_relation_counts','ezyvet_migration_coverage_keys','ezyvet_migration_coverage_counts','ezyvet_migration_chunk_work_counts','ezyvet_migration_calculation_snapshots','ezyvet_migration_attempt_pages')
  union select table_name from public.ezyvet_migration_dependency_tables
 ), uncovered as materialized (
  select r.table_name from required_tables r
  where not exists(select 1 from public.ezyvet_migration_dependency_tables d where d.table_name=r.table_name)
   or not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=r.table_name and t.tgname='migration_dependency_change'
     and t.tgenabled in ('O','A') and t.tgtype=60
     and t.tgfoid='public.record_ezyvet_migration_dependency_change()'::regprocedure)
 ), changed as materialized (
  select distinct c.table_name from owned p join public.ezyvet_migration_dependency_changes c
   on c.transaction_id>=pg_snapshot_xmin(p.dependency_snapshot)
  where (c.transaction_id=p.dependency_transaction and c.id>p.dependency_boundary)
   or (c.transaction_id<>p.dependency_transaction and not pg_visible_in_snapshot(c.transaction_id,p.dependency_snapshot))
 )
 select jsonb_build_object('preparation_id',p.id,'dependencies_unchanged',not exists(select 1 from changed) and not exists(select 1 from uncovered),
  'journal_coverage_valid',not exists(select 1 from uncovered),
  'uncovered_tables',coalesce((select jsonb_agg(table_name order by table_name) from uncovered),'[]'::jsonb),
  'changed_tables',coalesce((select jsonb_agg(table_name order by table_name) from changed),'[]'::jsonb),
  'report_ready',false,'complete_coverage_verified',false) into result from owned p;
 if result is null then raise exception 'Owned preparation required' using errcode='42501';end if;
 return result;
end;
$$;
revoke all on function public.read_ezyvet_migration_dependency_state(uuid) from public,anon,authenticated,service_role;

create function public.assert_ezyvet_migration_dependencies(p_preparation_id uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare state jsonb;
begin
 state:=public.read_ezyvet_migration_dependency_state(p_preparation_id);
 if (state->>'journal_coverage_valid')::boolean is not true then
  raise exception 'Dependency journal coverage incomplete' using errcode='55000';
 end if;
 if (state->>'dependencies_unchanged')::boolean is not true then
  raise exception 'Prepared dependencies changed; create a new preparation' using errcode='40001';
 end if;
end;
$$;
revoke all on function public.assert_ezyvet_migration_dependencies(uuid) from public,anon,authenticated,service_role;

create table public.ezyvet_migration_review_chain_links (
 id uuid primary key,actor_id uuid not null references public.profiles(id),
 preparation_id uuid not null references public.ezyvet_migration_preparations(id),
 stream_hash text not null check(stream_hash ~ '^[a-f0-9]{64}$'),
 review_page_id uuid not null references public.ezyvet_migration_review_pages(id),
 previous_link_id uuid references public.ezyvet_migration_review_chain_links(id),
 position bigint not null check(position>0),stream_ended boolean not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(stream_hash,position),unique(stream_hash,review_page_id)
);
alter table public.ezyvet_migration_review_chain_links enable row level security;
revoke all on public.ezyvet_migration_review_chain_links from public,anon,authenticated,service_role;
create trigger immutable_migration_review_chain before update or delete on public.ezyvet_migration_review_chain_links
 for each row execute function public.guard_inquiry_history();
create function public.append_ezyvet_migration_review_chain(p_id uuid,p_review_page_id uuid,p_previous_link_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=public set timezone='UTC' as $$
declare a uuid:=auth.uid();page public.ezyvet_migration_review_pages;saved public.ezyvet_migration_review_chain_links;
 tail public.ezyvet_migration_review_chain_links;stream text;expected jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_review_page_id is null then raise exception 'Review chain identity required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('migration-review-link:'||p_id::text,0));
 select r.* into page from public.ezyvet_migration_review_pages r join public.ezyvet_migration_preparations p on p.id=r.preparation_id and p.actor_id=a
 where r.id=p_review_page_id and r.actor_id=a;
 if page.id is null then raise exception 'Owned review page required' using errcode='42501';end if;
 stream:=encode(sha256(convert_to(jsonb_build_array(1,a,page.preparation_id,page.binding_id,page.first_page,page.observation_index,page.kind,page.approval_id)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('migration-review-stream:'||stream,0));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into saved from public.ezyvet_migration_review_chain_links where id=p_id;
 if saved.id is not null then
  if saved.actor_id<>a or saved.review_page_id<>p_review_page_id or saved.previous_link_id is distinct from p_previous_link_id then
   raise exception 'Owned identical chain request required' using errcode='42501';end if;
 else
  perform public.assert_ezyvet_migration_dependencies(page.preparation_id);
  select * into tail from public.ezyvet_migration_review_chain_links where stream_hash=stream order by position desc limit 1;
  if tail.id is distinct from p_previous_link_id then raise exception 'Current review chain predecessor required' using errcode='40001';end if;
  if tail.stream_ended then raise exception 'Review stream already ended' using errcode='23514';end if;
  if tail.id is null then expected:='{}'::jsonb;
  else select continuation_cursor into expected from public.ezyvet_migration_review_pages where id=tail.review_page_id;end if;
  if page.input_cursor is distinct from expected then raise exception 'Review continuation cursor mismatch' using errcode='23514';end if;
  insert into public.ezyvet_migration_review_chain_links(id,actor_id,preparation_id,stream_hash,review_page_id,previous_link_id,position,stream_ended)
   values(p_id,a,page.preparation_id,stream,p_review_page_id,p_previous_link_id,coalesce(tail.position,0)+1,not page.has_more) returning * into saved;
 end if;
 return to_jsonb(saved)||jsonb_build_object('report_ready',false,'currentness_reverified',false);
end;
$$;
revoke all on function public.append_ezyvet_migration_review_chain(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create table public.ezyvet_migration_review_requirements (
 stream_hash text primary key check(stream_hash ~ '^[a-f0-9]{64}$'),
 actor_id uuid not null references public.profiles(id),preparation_id uuid not null,binding_id uuid not null,first_page integer not null,
 observation_index integer not null check(observation_index between 1 and 1000),
 kind text not null check(kind in ('identity','versioned','timed','original','native','cancellation')),
 approval_id uuid references public.ezyvet_imported_histories(id),
 required_by_page_id uuid references public.ezyvet_migration_review_pages(id),
 check((kind='native')=(approval_id is not null)),
 foreign key(preparation_id,binding_id,first_page) references public.ezyvet_migration_source_chunks(preparation_id,binding_id,first_page)
);
create index migration_requirement_chunk on public.ezyvet_migration_review_requirements(preparation_id,binding_id,first_page,stream_hash);
alter table public.ezyvet_migration_review_requirements enable row level security;
revoke all on public.ezyvet_migration_review_requirements from public,anon,authenticated,service_role;
create trigger immutable_migration_review_requirement before update or delete on public.ezyvet_migration_review_requirements
 for each row execute function public.guard_inquiry_history();
create function public.register_ezyvet_migration_source_reviews() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if exists(select 1 from jsonb_array_elements(new.entries) x where x->>'resource' not in ('contact','animal','healthstatus','attachment','history','consult','vaccination','prescription','prescriptionitem')) then
  raise exception 'Unsupported saved review resource' using errcode='23514';end if;
 insert into public.ezyvet_migration_review_requirements(stream_hash,actor_id,preparation_id,binding_id,first_page,observation_index,kind)
 select encode(sha256(convert_to(jsonb_build_array(1,new.actor_id,new.preparation_id,new.binding_id,new.first_page,o.ordinality,k.kind,null)::text,'UTF8')),'hex'),
  new.actor_id,new.preparation_id,new.binding_id,new.first_page,o.ordinality::integer,k.kind
 from jsonb_array_elements(new.entries) with ordinality o(entry,ordinality)
 cross join lateral unnest(case o.entry->>'resource'
  when 'contact' then array['identity'] when 'animal' then array['identity']
  when 'healthstatus' then array['timed'] when 'attachment' then array['timed','original','cancellation']
  when 'consult' then array[]::text[] else array['versioned'] end) k(kind);
 return new;
end;
$$;
revoke all on function public.register_ezyvet_migration_source_reviews() from public,anon,authenticated,service_role;
create trigger migration_source_review_requirements after insert on public.ezyvet_migration_source_chunks
 for each row execute function public.register_ezyvet_migration_source_reviews();
create function public.register_ezyvet_migration_native_reviews() returns trigger
language plpgsql security invoker set search_path=public as $$
declare page public.ezyvet_migration_review_pages;resource text;
begin
 select * into page from public.ezyvet_migration_review_pages where id=new.review_page_id;
 select c.entries->(page.observation_index-1)->>'resource' into resource from public.ezyvet_migration_source_chunks c
 where c.preparation_id=page.preparation_id and c.binding_id=page.binding_id and c.first_page=page.first_page;
 if page.kind='versioned' and resource='history' then
  insert into public.ezyvet_migration_review_requirements(stream_hash,actor_id,preparation_id,binding_id,first_page,observation_index,kind,approval_id,required_by_page_id)
  select encode(sha256(convert_to(jsonb_build_array(1,page.actor_id,page.preparation_id,page.binding_id,page.first_page,page.observation_index,'native',(a->>'id')::uuid)::text,'UTF8')),'hex'),
   page.actor_id,page.preparation_id,page.binding_id,page.first_page,page.observation_index,'native',(a->>'id')::uuid,page.id
  from jsonb_array_elements(page.evidence->'approvals') a where (a->>'extraction_receipts')::bigint>0
  on conflict(stream_hash) do nothing;
 end if;
 return new;
end;
$$;
revoke all on function public.register_ezyvet_migration_native_reviews() from public,anon,authenticated,service_role;
create trigger migration_native_review_requirements after insert on public.ezyvet_migration_review_chain_links
 for each row execute function public.register_ezyvet_migration_native_reviews();
create function public.list_ezyvet_migration_review_requirements(p_preparation_id uuid,p_binding_id uuid,p_first_page integer,p_after_hash text default null,p_limit integer default 20)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare a uuid:=auth.uid();result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 100 or (p_after_hash is not null and p_after_hash !~ '^[a-f0-9]{64}$') then raise exception 'Invalid review requirement cursor' using errcode='23514';end if;
 with owned as materialized (
  select c.* from public.ezyvet_migration_source_chunks c join public.ezyvet_migration_preparations p on p.id=c.preparation_id and p.actor_id=a
  where c.preparation_id=p_preparation_id and c.binding_id=p_binding_id and c.first_page=p_first_page and c.actor_id=a
 ), bounded as materialized (
  select r.* from owned c join public.ezyvet_migration_review_requirements r on r.preparation_id=c.preparation_id and r.binding_id=c.binding_id and r.first_page=c.first_page and r.actor_id=a
  where p_after_hash is null or r.stream_hash>p_after_hash order by r.stream_hash limit p_limit+1
 ), selected as materialized(select * from bounded order by stream_hash limit p_limit), projected as (
  select r.stream_hash,to_jsonb(r)||jsonb_build_object('last_link_id',t.id,'next_cursor',case when t.id is null then '{}'::jsonb else page.continuation_cursor end,
   'stream_ended',coalesce(t.stream_ended,false)) item from selected r
  left join lateral(select * from public.ezyvet_migration_review_chain_links l where l.stream_hash=r.stream_hash order by position desc limit 1) t on true
  left join public.ezyvet_migration_review_pages page on page.id=t.review_page_id
 )
 select jsonb_build_object('requirements',coalesce((select jsonb_agg(item order by stream_hash) from projected),'[]'::jsonb),
  'has_more',(select count(*)>p_limit from bounded),'next_after_hash',case when (select count(*)>p_limit from bounded) then (select max(stream_hash) from selected) else null end,
  'report_ready',false) into result from owned;
 if result is null then raise exception 'Owned source chunk required' using errcode='42501';end if;
 return result;
end;
$$;
revoke all on function public.list_ezyvet_migration_review_requirements(uuid,uuid,integer,text,integer) from public,anon,authenticated,service_role;

create table public.ezyvet_migration_review_completions (
 preparation_id uuid not null,binding_id uuid not null,first_page integer not null,
 actor_id uuid not null references public.profiles(id),source_chunk_hash text not null,
 required_streams bigint not null check(required_streams>=0),review_pages bigint not null check(review_pages>=0),
 chains_hash text not null check(chains_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz not null default clock_timestamp(),
 primary key(preparation_id,binding_id,first_page),
 foreign key(preparation_id,binding_id,first_page) references public.ezyvet_migration_source_chunks(preparation_id,binding_id,first_page)
);
alter table public.ezyvet_migration_review_completions enable row level security;
revoke all on public.ezyvet_migration_review_completions from public,anon,authenticated,service_role;
create trigger immutable_migration_review_completion before update or delete on public.ezyvet_migration_review_completions
 for each row execute function public.guard_inquiry_history();
create function public.complete_ezyvet_migration_chunk_reviews(p_preparation_id uuid,p_binding_id uuid,p_first_page integer)
returns jsonb language plpgsql security invoker set search_path=public set timezone='UTC' as $$
declare a uuid:=auth.uid();chunk public.ezyvet_migration_source_chunks;saved public.ezyvet_migration_review_completions;
 required bigint;ended bigint;pages bigint;digest text;missing boolean;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_preparation_id is null or p_binding_id is null or p_first_page is null then raise exception 'Chunk review identity required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('migration-chunk-completion:'||p_preparation_id::text||':'||p_binding_id::text||':'||p_first_page::text,0));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select c.* into chunk from public.ezyvet_migration_source_chunks c join public.ezyvet_migration_preparations p on p.id=c.preparation_id and p.actor_id=a
 where c.preparation_id=p_preparation_id and c.binding_id=p_binding_id and c.first_page=p_first_page and c.actor_id=a;
 if chunk.preparation_id is null then raise exception 'Owned source chunk required' using errcode='42501';end if;
 select * into saved from public.ezyvet_migration_review_completions where preparation_id=p_preparation_id and binding_id=p_binding_id and first_page=p_first_page and actor_id=a;
 if saved.preparation_id is null then
  perform public.assert_ezyvet_migration_dependencies(p_preparation_id);
  with expected as (
   select encode(sha256(convert_to(jsonb_build_array(1,a,p_preparation_id,p_binding_id,p_first_page,o.ordinality,k.kind,null)::text,'UTF8')),'hex') stream_hash
   from jsonb_array_elements(chunk.entries) with ordinality o(entry,ordinality)
   cross join lateral unnest(case o.entry->>'resource'
    when 'contact' then array['identity'] when 'animal' then array['identity'] when 'healthstatus' then array['timed']
    when 'attachment' then array['timed','original','cancellation'] when 'consult' then array[]::text[] else array['versioned'] end) k(kind)
  ), requirements as materialized (
   select * from public.ezyvet_migration_review_requirements where preparation_id=p_preparation_id and binding_id=p_binding_id and first_page=p_first_page and actor_id=a
  ), tails as materialized (
   select r.stream_hash,l.id,l.position,l.stream_ended from requirements r
   left join lateral(select * from public.ezyvet_migration_review_chain_links where stream_hash=r.stream_hash order by position desc limit 1) l on true
  )
  select exists(select 1 from expected e where not exists(select 1 from requirements r where r.stream_hash=e.stream_hash)),
   count(*),count(*) filter(where stream_ended),coalesce(sum(position),0),
   encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(stream_hash,id,position) order by stream_hash),'[]'::jsonb)::text,'UTF8')),'hex')
  into missing,required,ended,pages,digest from tails;
  if missing or required<>ended then raise exception 'Required review streams are incomplete' using errcode='23514';end if;
  perform public.assert_ezyvet_migration_dependencies(p_preparation_id);
  insert into public.ezyvet_migration_review_completions(preparation_id,binding_id,first_page,actor_id,source_chunk_hash,required_streams,review_pages,chains_hash)
   values(p_preparation_id,p_binding_id,p_first_page,a,chunk.evidence_hash,required,pages,digest) returning * into saved;
 end if;
 return to_jsonb(saved)||jsonb_build_object('chunk_reviews_complete',true,'report_ready',false,'currentness_reverified',false);
end;
$$;
revoke all on function public.complete_ezyvet_migration_chunk_reviews(uuid,uuid,integer) from public,anon,authenticated,service_role;

-- Report-wide metadata traversal: at most 100 scopes x 50 source chunks.
create function public.read_ezyvet_migration_report_progress(p_preparation_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare a uuid:=auth.uid();result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 with owned as materialized(select * from public.ezyvet_migration_preparations where id=p_preparation_id and actor_id=a),
 scopes as materialized (
  select x.* from owned p cross join lateral jsonb_to_recordset(p.plan)
   as x(scope_id uuid,resource text,disposition text,binding_id uuid,child_run_id uuid,scan_status text,page_count integer)
 ), expected as materialized (
  select s.binding_id,g.first_page,least(20,s.page_count-g.first_page+1) page_count
  from scopes s cross join lateral generate_series(1,s.page_count,20) g(first_page)
  where s.disposition='required' and s.binding_id is not null
 ), coverage as materialized (
  select e.*,c.preparation_id is not null source_saved,r.preparation_id is not null review_completed,g.preparation_id is not null source_aggregated,
   coalesce(w.selected_pages=w.native_pages and w.selected_pages=w.receipt_pages,false) pages_aggregated
  from expected e left join public.ezyvet_migration_source_chunks c
   on c.preparation_id=p_preparation_id and c.binding_id=e.binding_id and c.first_page=e.first_page and c.page_count=e.page_count and c.actor_id=a
  left join public.ezyvet_migration_review_completions r
   on r.preparation_id=c.preparation_id and r.binding_id=c.binding_id and r.first_page=c.first_page and r.actor_id=a and r.source_chunk_hash=c.evidence_hash
  left join public.ezyvet_migration_source_aggregations g
   on g.preparation_id=c.preparation_id and g.binding_id=c.binding_id and g.first_page=c.first_page and g.actor_id=a and g.source_chunk_hash=c.evidence_hash
  left join public.ezyvet_migration_chunk_work_counts w
   on w.preparation_id=c.preparation_id and w.binding_id=c.binding_id and w.first_page=c.first_page
 ), totals as (
  select count(*) expected_chunks,count(*) filter(where source_saved) saved_chunks,count(*) filter(where review_completed) reviewed_chunks,
   count(*) filter(where not source_saved) missing_source_chunks,count(*) filter(where not review_completed) missing_review_chunks,
   count(*) filter(where source_aggregated) aggregated_source_chunks,count(*) filter(where not source_aggregated) missing_source_aggregations,
   count(*) filter(where review_completed and pages_aggregated) aggregated_review_chunks,
   count(*) filter(where not (review_completed and pages_aggregated)) missing_review_aggregations from coverage
 )
 select jsonb_build_object('preparation_id',p.id,'migration_run_id',p.migration_run_id,'plan_hash',p.plan_hash,
  'scopes',(select count(*) from scopes),'unbound_required_scopes',(select count(*) from scopes where disposition='required' and binding_id is null),
  'bound_unfinished_scopes',(select count(*) from scopes where disposition='required' and binding_id is not null and scan_status is distinct from 'review_ready'),
  'expected_source_chunks',t.expected_chunks,'saved_source_chunks',t.saved_chunks,'completed_review_chunks',t.reviewed_chunks,
  'missing_source_chunks',t.missing_source_chunks,'missing_review_chunks',t.missing_review_chunks,
  'aggregated_source_chunks',t.aggregated_source_chunks,'missing_source_aggregations',t.missing_source_aggregations,
  'aggregated_review_chunks',t.aggregated_review_chunks,'missing_review_aggregations',t.missing_review_aggregations,
  'bound_aggregation_work_complete',t.missing_source_aggregations=0 and t.missing_review_aggregations=0,
  'bound_chunk_work_complete',t.missing_source_chunks=0 and t.missing_review_chunks=0,
  'dependency_state',public.read_ezyvet_migration_dependency_state(p.id),
  'report_ready',false,'complete_coverage_verified',false,'cutover_accepted',false)
 into result from owned p cross join totals t;
 if result is null then raise exception 'Owned preparation required' using errcode='42501';end if;
 return result;
end;
$$;
revoke all on function public.read_ezyvet_migration_report_progress(uuid) from public,anon,authenticated,service_role;

create table public.ezyvet_migration_coverage_keys (
 preparation_id uuid not null references public.ezyvet_migration_preparations(id),resource text not null,
 evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'),metric text not null check(metric in
 ('observed_occurrences','occurrences_with_approval','occurrences_with_exact_approval','occurrences_with_snapshot_only_approval','occurrences_with_current_latest_exact_approval')),
 primary key(preparation_id,resource,metric,evidence_hash)
);
create table public.ezyvet_migration_coverage_counts (
 preparation_id uuid not null references public.ezyvet_migration_preparations(id),resource text not null,metric text not null,
 records bigint not null check(records>=0),primary key(preparation_id,resource,metric)
);
do $$declare t text;begin foreach t in array array['ezyvet_migration_coverage_keys','ezyvet_migration_coverage_counts'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
end loop;end $$;
create trigger immutable_migration_coverage_key before update or delete on public.ezyvet_migration_coverage_keys
 for each row execute function public.guard_inquiry_history();
create table public.ezyvet_migration_source_keys (
 preparation_id uuid not null references public.ezyvet_migration_preparations(id),resource text not null,
 metric text not null check(metric in ('observed_occurrences','source_identities','source_snapshots','recorded_source_versions','occurrences_without_observed_head')),
 identity_hash text not null check(identity_hash ~ '^[a-f0-9]{64}$'),primary key(preparation_id,resource,metric,identity_hash)
);
create table public.ezyvet_migration_source_counts (
 preparation_id uuid not null references public.ezyvet_migration_preparations(id),resource text not null,metric text not null,
 records bigint not null check(records>=0),primary key(preparation_id,resource,metric)
);
create table public.ezyvet_migration_source_aggregations (
 preparation_id uuid not null,binding_id uuid not null,first_page integer not null,actor_id uuid not null references public.profiles(id),
 source_chunk_hash text not null,observations integer not null,created_at timestamptz not null default clock_timestamp(),
 primary key(preparation_id,binding_id,first_page),
 foreign key(preparation_id,binding_id,first_page) references public.ezyvet_migration_source_chunks(preparation_id,binding_id,first_page)
);
do $$declare t text;begin foreach t in array array['ezyvet_migration_source_keys','ezyvet_migration_source_counts','ezyvet_migration_source_aggregations'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
end loop;end $$;
create trigger immutable_migration_source_key before update or delete on public.ezyvet_migration_source_keys
 for each row execute function public.guard_inquiry_history();
create trigger immutable_migration_source_aggregation before update or delete on public.ezyvet_migration_source_aggregations
 for each row execute function public.guard_inquiry_history();
create function public.aggregate_ezyvet_migration_source_chunk(p_preparation_id uuid,p_binding_id uuid,p_first_page integer)
returns jsonb language plpgsql security invoker set search_path=public set timezone='UTC' as $$
declare a uuid:=auth.uid();chunk public.ezyvet_migration_source_chunks;saved public.ezyvet_migration_source_aggregations;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_preparation_id is null or p_binding_id is null or p_first_page is null then raise exception 'Source aggregation identity required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('migration-source-aggregation:'||p_preparation_id::text,0));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select c.* into chunk from public.ezyvet_migration_source_chunks c join public.ezyvet_migration_preparations p on p.id=c.preparation_id and p.actor_id=a
 where c.preparation_id=p_preparation_id and c.binding_id=p_binding_id and c.first_page=p_first_page and c.actor_id=a;
 if chunk.preparation_id is null then raise exception 'Owned source chunk required' using errcode='42501';end if;
 select * into saved from public.ezyvet_migration_source_aggregations where preparation_id=p_preparation_id and binding_id=p_binding_id and first_page=p_first_page and actor_id=a;
 if saved.preparation_id is null then
  perform public.assert_ezyvet_migration_dependencies(p_preparation_id);
  with observed as materialized(select x from jsonb_array_elements(chunk.entries) x), keys as (
   select x->>'resource' resource,k.metric,encode(sha256(convert_to(k.identity::text,'UTF8')),'hex') identity_hash
   from observed cross join lateral (values
    ('observed_occurrences',jsonb_build_array(x->'child_run_id',x->'page',x->'ordinal',x->'snapshot_id')),
    ('source_identities',jsonb_build_array(x->'source_origin',x->'source_site_uid',x->'resource',x->'external_id')),
    ('source_snapshots',jsonb_build_array(x->'snapshot_id')),
    ('recorded_source_versions',case when x->>'observed_head_version' is not null then jsonb_build_array(x->'snapshot_id',x->'observed_head_version') end),
    ('occurrences_without_observed_head',case when x->>'observed_head_version' is null then jsonb_build_array(x->'child_run_id',x->'page',x->'ordinal',x->'snapshot_id') end)
   ) k(metric,identity) where k.identity is not null
  ), inserted as (
   insert into public.ezyvet_migration_source_keys(preparation_id,resource,metric,identity_hash)
   select distinct p_preparation_id,resource,metric,identity_hash from keys order by resource,metric,identity_hash
   on conflict do nothing returning resource,metric
  ), increments as (
   select resource,metric,count(*) records from inserted group by resource,metric
   union all select x->>'resource','observation_memberships',count(*) from observed group by x->>'resource'
  )
  insert into public.ezyvet_migration_source_counts(preparation_id,resource,metric,records)
   select p_preparation_id,resource,metric,records from increments order by resource,metric
   on conflict(preparation_id,resource,metric) do update set records=ezyvet_migration_source_counts.records+excluded.records;
  with inserted as (
   insert into public.ezyvet_migration_coverage_keys(preparation_id,resource,evidence_hash,metric)
    select distinct p_preparation_id,x->>'resource',x->>'evidence_hash','observed_occurrences'
    from jsonb_array_elements(chunk.entries) x order by 2,3 on conflict do nothing returning resource,metric
  )
  insert into public.ezyvet_migration_coverage_counts(preparation_id,resource,metric,records)
   select p_preparation_id,resource,metric,count(*) from inserted group by resource,metric order by resource,metric
   on conflict(preparation_id,resource,metric) do update set records=ezyvet_migration_coverage_counts.records+excluded.records;
  perform public.assert_ezyvet_migration_dependencies(p_preparation_id);
  insert into public.ezyvet_migration_source_aggregations(preparation_id,binding_id,first_page,actor_id,source_chunk_hash,observations)
   values(p_preparation_id,p_binding_id,p_first_page,a,chunk.evidence_hash,chunk.observation_count) returning * into saved;
 end if;
 return to_jsonb(saved)||jsonb_build_object('report_ready',false,'currentness_reverified',false);
end;
$$;
revoke all on function public.aggregate_ezyvet_migration_source_chunk(uuid,uuid,integer) from public,anon,authenticated,service_role;

create table public.ezyvet_migration_native_keys (
 preparation_id uuid not null references public.ezyvet_migration_preparations(id),
 native_kind text not null check(native_kind in ('client','pet','weight','problem')),
 metric text not null check(metric in ('records','locally_changed_records')),native_id uuid not null,
 primary key(preparation_id,native_kind,metric,native_id)
);
create table public.ezyvet_migration_native_counts (
 preparation_id uuid not null references public.ezyvet_migration_preparations(id),native_kind text not null,metric text not null,
 records bigint not null check(records>=0),primary key(preparation_id,native_kind,metric)
);
create table public.ezyvet_migration_native_aggregations (
 chain_link_id uuid primary key references public.ezyvet_migration_review_chain_links(id),
 preparation_id uuid not null references public.ezyvet_migration_preparations(id),actor_id uuid not null references public.profiles(id),
 evidence_hash text not null,created_at timestamptz not null default clock_timestamp()
);
do $$declare t text;begin foreach t in array array['ezyvet_migration_native_keys','ezyvet_migration_native_counts','ezyvet_migration_native_aggregations'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
end loop;end $$;
create trigger immutable_migration_native_key before update or delete on public.ezyvet_migration_native_keys
 for each row execute function public.guard_inquiry_history();
create trigger immutable_migration_native_aggregation before update or delete on public.ezyvet_migration_native_aggregations
 for each row execute function public.guard_inquiry_history();
create function public.aggregate_ezyvet_migration_native_page(p_chain_link_id uuid)
returns jsonb language plpgsql security invoker set search_path=public set timezone='UTC' as $$
declare a uuid:=auth.uid();page public.ezyvet_migration_review_pages;entry jsonb;outcomes jsonb:='[]'::jsonb;saved public.ezyvet_migration_native_aggregations;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select r.* into page from public.ezyvet_migration_review_chain_links l join public.ezyvet_migration_review_pages r on r.id=l.review_page_id and r.actor_id=a
 join public.ezyvet_migration_preparations p on p.id=r.preparation_id and p.actor_id=a where l.id=p_chain_link_id and l.actor_id=a;
 if page.id is null then raise exception 'Owned review chain link required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('migration-native-aggregation:'||page.preparation_id::text,0));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into saved from public.ezyvet_migration_native_aggregations where chain_link_id=p_chain_link_id;
 if saved.chain_link_id is null then
  perform public.assert_ezyvet_migration_dependencies(page.preparation_id);
  select c.entries->(page.observation_index-1) into entry from public.ezyvet_migration_source_chunks c
   where c.preparation_id=page.preparation_id and c.binding_id=page.binding_id and c.first_page=page.first_page;
  if page.kind='native' then outcomes:=page.evidence->'outcomes';
  elsif page.kind='identity' and page.evidence#>>'{approval,id}' is not null then
   outcomes:=jsonb_build_array(jsonb_build_object('native_kind',case when entry->>'resource'='contact' then 'client' else 'pet' end,
    'native_id',case when entry->>'resource'='contact' then entry->'client_id' else entry->'pet_id' end,
    'local_changed',not (page.evidence#>>'{approval,local_record_unchanged}')::boolean));
  elsif page.kind='timed' and entry->>'resource'='healthstatus' and page.evidence#>>'{approval,weight_id}' is not null then
   outcomes:=jsonb_build_array(jsonb_build_object('native_kind','weight','native_id',page.evidence#>'{approval,weight_id}',
    'local_changed',not (page.evidence#>>'{approval,local_weight_matches_review}')::boolean));
  end if;
  with keys as (
   select x->>'native_kind' native_kind,(x->>'native_id')::uuid native_id,m.metric
   from jsonb_array_elements(outcomes) x cross join lateral unnest(case when (x->>'local_changed')::boolean
    then array['records','locally_changed_records'] else array['records'] end) m(metric)
  ), inserted as (
   insert into public.ezyvet_migration_native_keys(preparation_id,native_kind,metric,native_id)
    select distinct page.preparation_id,native_kind,metric,native_id from keys order by native_kind,metric,native_id
    on conflict do nothing returning native_kind,metric
  )
  insert into public.ezyvet_migration_native_counts(preparation_id,native_kind,metric,records)
   select page.preparation_id,native_kind,metric,count(*) from inserted group by native_kind,metric order by native_kind,metric
   on conflict(preparation_id,native_kind,metric) do update set records=ezyvet_migration_native_counts.records+excluded.records;
  perform public.assert_ezyvet_migration_dependencies(page.preparation_id);
  insert into public.ezyvet_migration_native_aggregations(chain_link_id,preparation_id,actor_id,evidence_hash)
   values(p_chain_link_id,page.preparation_id,a,page.evidence_hash) returning * into saved;
 end if;
 return to_jsonb(saved)||jsonb_build_object('report_ready',false,'currentness_reverified',false);
end;
$$;
revoke all on function public.aggregate_ezyvet_migration_native_page(uuid) from public,anon,authenticated,service_role;

-- Bounded approval normalization for selected review pages, not capture attempts.
create function public.ezyvet_migration_selected_approvals(p_chain_link_id uuid)
returns table(receipt_kind text,receipt_id uuid,facets jsonb)
language plpgsql security invoker set search_path=public as $$
declare a uuid:=auth.uid();page public.ezyvet_migration_review_pages;entry jsonb;resource text;kind text;approvals jsonb;household boolean;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select p.* into page from public.ezyvet_migration_review_chain_links l join public.ezyvet_migration_review_pages p on p.id=l.review_page_id and p.actor_id=a
 join public.ezyvet_migration_preparations r on r.id=p.preparation_id and r.actor_id=a where l.id=p_chain_link_id and l.actor_id=a;
 if page.id is null then raise exception 'Owned review chain link required' using errcode='42501';end if;
 perform public.assert_ezyvet_migration_dependencies(page.preparation_id);
 select c.entries->(page.observation_index-1) into entry from public.ezyvet_migration_source_chunks c
 where c.preparation_id=page.preparation_id and c.binding_id=page.binding_id and c.first_page=page.first_page;
 resource:=entry->>'resource';
 kind:=case when page.kind='identity' then 'identity_mapping'
  when page.kind='timed' and resource='healthstatus' then 'weight_approval'
  when page.kind='original' then 'attachment_original_approval'
  when page.kind='versioned' then case resource when 'history' then 'imported_history' when 'vaccination' then 'imported_vaccination'
   when 'prescription' then 'imported_prescription' when 'prescriptionitem' then 'imported_prescription' end end;
 if kind is null then return;end if;
 approvals:=case when page.kind in ('identity','timed') then
  case when page.evidence#>>'{approval,id}' is null then '[]'::jsonb else jsonb_build_array(page.evidence->'approval') end
  else page.evidence->'approvals' end;
 household:=exists(select 1 from public.pets where id=(entry->>'pet_id')::uuid and client_id=(entry->>'client_id')::uuid);
 return query select kind,(r->>'id')::uuid,jsonb_build_object(
  'source_current',(r->>'source_current')::boolean,
  'superseded',case when page.kind in ('identity','timed') then false else (r->>'superseded')::boolean end,
  'local_changed',case when page.kind='identity' then not (r->>'local_record_unchanged')::boolean
   when kind='weight_approval' then not (r->>'local_weight_matches_review')::boolean
   when kind='imported_history' then (r->>'locally_edited_receipts')::bigint>0
   when resource in ('vaccination','prescription') then false else null end,
  'exact_match',case when resource='prescriptionitem' then coalesce((r->>'parent_matches')::boolean,false) and r->>'disposition' in ('selected','omitted')
   when page.kind='original' then true else r->>'relationship'='exact_source_version' end,
  'unknown_head_match',coalesce(r->>'relationship'='same_snapshot_unknown_observed_head',false),
  'patient_changed',case when kind='weight_approval' then not (r->>'patient_version_unchanged')::boolean else null end,
  'household_changed',case when page.kind in ('identity','timed') then not (r->>'household_current')::boolean
   when resource in ('history','vaccination','prescription') then not household else null end,
  'record_action',case when page.kind in ('identity','timed') then r->>'action' else null end)
 || case when kind='imported_prescription' then jsonb_build_object(
  'gap_reviewed',true,
  'gap_partial',h.context#>>'{reviewed,completeness}'='partial',
  'gap_unresolved_reference',h.context#>>'{reconciliation,status}'='unresolved',
  'gap_absent_source_list',h.context#>>'{reconciliation,sourceListPresent}'='false',
  'gap_unfinished_scan',h.context#>>'{reconciliation,scanComplete}'='false',
  'gap_missing_item',jsonb_array_length(h.context#>'{reconciliation,missingIds}')>0,
  'gap_unexpected_item',jsonb_array_length(h.context#>'{reconciliation,unexpectedIds}')>0,
  'gap_duplicate_source_reference',jsonb_array_length(h.context#>'{reconciliation,duplicateSourceIds}')>0,
  'gap_duplicate_observation',jsonb_array_length(h.context#>'{reconciliation,duplicateObservedIds}')>0,
  'gap_invalid_reference',jsonb_array_length(h.context#>'{reconciliation,invalidSourceReferences}')>0 or jsonb_array_length(h.context#>'{reconciliation,invalidObservedReferences}')>0,
  'gap_unknown_date',h.context#>>'{reviewed,prescription_date_status}'='unknown',
  'gap_unknown_status',h.context#>>'{reviewed,status}'='unknown'
 ) else '{}'::jsonb end
 from jsonb_array_elements(approvals) r
 left join public.ezyvet_imported_prescriptions h on kind='imported_prescription' and h.id=(r->>'id')::uuid;
 perform public.assert_ezyvet_migration_dependencies(page.preparation_id);
end;
$$;
revoke all on function public.ezyvet_migration_selected_approvals(uuid) from public,anon,authenticated,service_role;

create function public.ezyvet_migration_approval_metrics(p jsonb) returns table(metric text)
language sql immutable security invoker set search_path=public as $$
 select m.name from (values
 ('gap_reviewed_versions',(p->>'gap_reviewed')::boolean is true),
 ('gap_partial_versions',(p->>'gap_partial')::boolean is true),
 ('gap_unresolved_reference_versions',(p->>'gap_unresolved_reference')::boolean is true),
 ('gap_absent_source_list_versions',(p->>'gap_absent_source_list')::boolean is true),
 ('gap_unfinished_scan_versions',(p->>'gap_unfinished_scan')::boolean is true),
 ('gap_missing_item_versions',(p->>'gap_missing_item')::boolean is true),
 ('gap_unexpected_item_versions',(p->>'gap_unexpected_item')::boolean is true),
 ('gap_duplicate_source_reference_versions',(p->>'gap_duplicate_source_reference')::boolean is true),
 ('gap_duplicate_observation_versions',(p->>'gap_duplicate_observation')::boolean is true),
 ('gap_invalid_reference_versions',(p->>'gap_invalid_reference')::boolean is true),
 ('gap_unknown_date_versions',(p->>'gap_unknown_date')::boolean is true),
 ('gap_unknown_status_versions',(p->>'gap_unknown_status')::boolean is true),
 ('gap_latest_versions',(p->>'gap_reviewed')::boolean is true and (p->>'superseded')::boolean is false),
 ('gap_latest_partial_versions',(p->>'gap_partial')::boolean is true and (p->>'superseded')::boolean is false),
 ('capture_status_prepared',p->>'capture_status'='prepared'),('capture_status_reserved',p->>'capture_status'='reserved'),
 ('capture_status_ready',p->>'capture_status'='ready'),('capture_status_blocked',p->>'capture_status'='blocked'),
 ('capture_status_discarding',p->>'capture_status'='discarding'),('capture_status_abandoned',p->>'capture_status'='abandoned'),
 ('versions',true),('latest_versions',(p->>'superseded')::boolean is false),
 ('source_current_versions',(p->>'source_current')::boolean is true),('source_stale_versions',(p->>'source_current')::boolean is false),
 ('locally_changed_versions',(p->>'local_changed')::boolean is true),
 ('patient_version_assessed_versions',p->>'patient_changed' is not null),('household_assessed_versions',p->>'household_changed' is not null),
 ('changed_patient_versions',(p->>'patient_changed')::boolean is true),('changed_household_versions',(p->>'household_changed')::boolean is true),
 ('created_record_receipts',p->>'record_action'='create'),('linked_record_receipts',p->>'record_action'='link'),
 ('exact_observation_version_matches',(p->>'exact_match')::boolean is true),('same_snapshot_unknown_head_matches',(p->>'unknown_head_match')::boolean is true)
 ) m(name,included) where p is not null and m.included;
$$;
revoke all on function public.ezyvet_migration_approval_metrics(jsonb) from public,anon,authenticated,service_role;
create table public.ezyvet_migration_approval_states (
 preparation_id uuid not null references public.ezyvet_migration_preparations(id),receipt_kind text not null,receipt_id uuid not null,
 facets jsonb not null,primary key(preparation_id,receipt_kind,receipt_id)
);
create table public.ezyvet_migration_approval_counts (
 preparation_id uuid not null references public.ezyvet_migration_preparations(id),receipt_kind text not null,metric text not null,
 records bigint not null check(records>=0),primary key(preparation_id,receipt_kind,metric)
);
create table public.ezyvet_migration_approval_aggregations (
 chain_link_id uuid primary key references public.ezyvet_migration_review_chain_links(id),
 preparation_id uuid not null references public.ezyvet_migration_preparations(id),actor_id uuid not null references public.profiles(id),
 evidence_hash text not null,created_at timestamptz not null default clock_timestamp()
);
do $$declare t text;begin foreach t in array array['ezyvet_migration_approval_states','ezyvet_migration_approval_counts','ezyvet_migration_approval_aggregations'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
end loop;end $$;
create trigger immutable_migration_approval_aggregation before update or delete on public.ezyvet_migration_approval_aggregations
 for each row execute function public.guard_inquiry_history();
create table public.ezyvet_migration_item_relation_keys (
 preparation_id uuid not null references public.ezyvet_migration_preparations(id),
 approval_id uuid not null references public.ezyvet_imported_prescriptions(id),
 evidence_hash text not null,disposition text not null,
 primary key(preparation_id,approval_id,evidence_hash,disposition)
);
create table public.ezyvet_migration_item_relation_counts (
 preparation_id uuid not null references public.ezyvet_migration_preparations(id),
 disposition text not null,records bigint not null check(records>=0),primary key(preparation_id,disposition)
);
do $$declare t text;begin foreach t in array array['ezyvet_migration_item_relation_keys','ezyvet_migration_item_relation_counts'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
end loop;end $$;
create trigger immutable_migration_item_relation_key before update or delete on public.ezyvet_migration_item_relation_keys
 for each row execute function public.guard_inquiry_history();
create function public.aggregate_ezyvet_migration_approval_page(p_chain_link_id uuid)
returns jsonb language plpgsql security invoker set search_path=public set timezone='UTC' as $$
declare a uuid:=auth.uid();page public.ezyvet_migration_review_pages;saved public.ezyvet_migration_approval_aggregations;
 receipt record;prior jsonb;merged jsonb;m text;entry jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select p.* into page from public.ezyvet_migration_review_chain_links l join public.ezyvet_migration_review_pages p on p.id=l.review_page_id and p.actor_id=a
 join public.ezyvet_migration_preparations r on r.id=p.preparation_id and r.actor_id=a where l.id=p_chain_link_id and l.actor_id=a;
 if page.id is null then raise exception 'Owned review chain link required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('migration-approval-aggregation:'||page.preparation_id::text,0));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into saved from public.ezyvet_migration_approval_aggregations where chain_link_id=p_chain_link_id;
 if saved.chain_link_id is null then
  perform public.assert_ezyvet_migration_dependencies(page.preparation_id);
  for receipt in select * from public.ezyvet_migration_selected_receipts(p_chain_link_id) order by receipt_kind,receipt_id loop
   select facets into prior from public.ezyvet_migration_approval_states where preparation_id=page.preparation_id and receipt_kind=receipt.receipt_kind and receipt_id=receipt.receipt_id;
   select jsonb_object_agg(k,(select bool_or(v) from (values((prior->>k)::boolean),((receipt.facets->>k)::boolean)) x(v))) into merged
    from unnest(array['source_current','superseded','local_changed','exact_match','unknown_head_match','patient_changed','household_changed','gap_reviewed','gap_partial','gap_unresolved_reference','gap_absent_source_list','gap_unfinished_scan','gap_missing_item','gap_unexpected_item','gap_duplicate_source_reference','gap_duplicate_observation','gap_invalid_reference','gap_unknown_date','gap_unknown_status']) k;
   merged:=merged||jsonb_build_object('record_action',greatest(prior->>'record_action',receipt.facets->>'record_action'),
    'capture_status',coalesce(receipt.facets->>'capture_status',prior->>'capture_status'));
   for m in select metric from public.ezyvet_migration_approval_metrics(prior) except select metric from public.ezyvet_migration_approval_metrics(merged) loop
    update public.ezyvet_migration_approval_counts set records=records-1 where preparation_id=page.preparation_id and receipt_kind=receipt.receipt_kind and metric=m;
   end loop;
   for m in select metric from public.ezyvet_migration_approval_metrics(merged) except select metric from public.ezyvet_migration_approval_metrics(prior) loop
    insert into public.ezyvet_migration_approval_counts(preparation_id,receipt_kind,metric,records) values(page.preparation_id,receipt.receipt_kind,m,1)
     on conflict(preparation_id,receipt_kind,metric) do update set records=ezyvet_migration_approval_counts.records+1;
   end loop;
   insert into public.ezyvet_migration_approval_states(preparation_id,receipt_kind,receipt_id,facets) values(page.preparation_id,receipt.receipt_kind,receipt.receipt_id,merged)
    on conflict(preparation_id,receipt_kind,receipt_id) do update set facets=excluded.facets;
  end loop;
  select c.entries->(page.observation_index-1) into entry from public.ezyvet_migration_source_chunks c
   where c.preparation_id=page.preparation_id and c.binding_id=page.binding_id and c.first_page=page.first_page;
  if page.kind='versioned' and entry->>'resource'='prescriptionitem' then
   with inserted as (
    insert into public.ezyvet_migration_item_relation_keys(preparation_id,approval_id,evidence_hash,disposition)
     select distinct page.preparation_id,(r->>'id')::uuid,entry->>'evidence_hash',r->>'disposition'
     from jsonb_array_elements(page.evidence->'approvals') r
     order by 1,2,3,4 on conflict do nothing returning disposition
   )
   insert into public.ezyvet_migration_item_relation_counts(preparation_id,disposition,records)
    select page.preparation_id,disposition,count(*) from inserted group by disposition
    on conflict(preparation_id,disposition) do update set records=ezyvet_migration_item_relation_counts.records+excluded.records;
  end if;
  with facts as materialized (
   select facets from public.ezyvet_migration_selected_approvals(p_chain_link_id)
  ), flags as (
   select 'occurrences_with_approval' metric,count(*)>0 included from facts
   union all select 'occurrences_with_exact_approval',bool_or((facets->>'exact_match')::boolean) from facts
   union all select 'occurrences_with_snapshot_only_approval',bool_or((facets->>'unknown_head_match')::boolean) from facts
   union all select 'occurrences_with_current_latest_exact_approval',bool_or((facets->>'exact_match')::boolean
    and (facets->>'source_current')::boolean and not (facets->>'superseded')::boolean) from facts
  ), inserted as (
   insert into public.ezyvet_migration_coverage_keys(preparation_id,resource,evidence_hash,metric)
    select page.preparation_id,entry->>'resource',entry->>'evidence_hash',metric from flags where included
    order by metric on conflict do nothing returning resource,metric
  )
  insert into public.ezyvet_migration_coverage_counts(preparation_id,resource,metric,records)
   select page.preparation_id,resource,metric,count(*) from inserted group by resource,metric order by resource,metric
   on conflict(preparation_id,resource,metric) do update set records=ezyvet_migration_coverage_counts.records+excluded.records;
  perform public.assert_ezyvet_migration_dependencies(page.preparation_id);
  insert into public.ezyvet_migration_approval_aggregations(chain_link_id,preparation_id,actor_id,evidence_hash)
   values(p_chain_link_id,page.preparation_id,a,page.evidence_hash) returning * into saved;
 end if;
 return to_jsonb(saved)||jsonb_build_object('report_ready',false,'currentness_reverified',false);
end;
$$;
revoke all on function public.aggregate_ezyvet_migration_approval_page(uuid) from public,anon,authenticated,service_role;

create function public.ezyvet_migration_selected_receipts(p_chain_link_id uuid)
returns table(receipt_kind text,receipt_id uuid,facets jsonb)
language plpgsql security invoker set search_path=public as $$
declare page public.ezyvet_migration_review_pages;resource text;
begin
 return query select * from public.ezyvet_migration_selected_approvals(p_chain_link_id);
 select p.* into page from public.ezyvet_migration_review_chain_links l join public.ezyvet_migration_review_pages p on p.id=l.review_page_id
 where l.id=p_chain_link_id and l.actor_id=auth.uid() and p.actor_id=auth.uid();
 select c.entries->(page.observation_index-1)->>'resource' into resource from public.ezyvet_migration_source_chunks c
 where c.preparation_id=page.preparation_id and c.binding_id=page.binding_id and c.first_page=page.first_page;
 if page.kind='timed' and resource='healthstatus' then
  return query select 'weight_source_acknowledgment',(r->>'id')::uuid,jsonb_build_object(
   'source_current',(r->>'source_current')::boolean,'superseded',false,'local_changed',false,
   'exact_match',false,'unknown_head_match',r->>'relationship'='same_snapshot_unknown_observed_head',
   'patient_changed',null,'household_changed',not (page.evidence#>>'{approval,household_current}')::boolean,'record_action',null)
  from jsonb_array_elements(page.evidence->'source_reviews') r;
 elsif page.kind='timed' and resource='attachment' then
  return query select 'attachment_capture_request',(r->>'request_id')::uuid,jsonb_build_object(
   'source_current',(r->>'source_current')::boolean,'superseded',null,'local_changed',null,
   'exact_match',null,'unknown_head_match',false,'patient_changed',null,'household_changed',null,'record_action',null,'capture_status',r->>'status')
  from jsonb_array_elements(page.evidence->'captures') r;
  return query select 'attachment_captured_bytes',(r#>>'{capture,id}')::uuid,jsonb_build_object(
   'source_current',(r->>'source_current')::boolean,'superseded',null,'local_changed',null,
   'exact_match',null,'unknown_head_match',false,'patient_changed',null,'household_changed',null,'record_action',null)
  from jsonb_array_elements(page.evidence->'captures') r where r#>>'{capture,id}' is not null;
 elsif page.kind='cancellation' and resource='attachment' then
  return query select 'attachment_unconfirmed_cancellation',(r->>'id')::uuid,jsonb_build_object('unknown_head_match',false)
   from jsonb_array_elements(page.evidence->'cancellations') r;
 end if;
 perform public.assert_ezyvet_migration_dependencies(page.preparation_id);
end;
$$;
revoke all on function public.ezyvet_migration_selected_receipts(uuid) from public,anon,authenticated,service_role;

-- Scan selected pages in bounded ID order; never filter completed pages before LIMIT.
-- A caller resumes from the returned cursor and skips already aggregated families.
create index migration_review_chain_preparation_cursor on public.ezyvet_migration_review_chain_links(preparation_id,id);
create function public.list_ezyvet_migration_aggregation_work(p_preparation_id uuid,p_after_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare a uuid:=auth.uid();result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid aggregation work limit' using errcode='23514';end if;
 if not exists(select 1 from public.ezyvet_migration_preparations where id=p_preparation_id and actor_id=a) then
  raise exception 'Owned preparation required' using errcode='42501';end if;
 with candidates as materialized (
  select l.id,l.review_page_id from public.ezyvet_migration_review_chain_links l
  where l.preparation_id=p_preparation_id and l.actor_id=a and (p_after_id is null or l.id>p_after_id)
  order by l.id limit p_limit+1
 ), selected as materialized(select * from candidates order by id limit p_limit), work as (
  select l.id,p.id review_page_id,p.binding_id,p.first_page,p.observation_index,p.kind,
   n.chain_link_id is not null native_aggregated,r.chain_link_id is not null receipts_aggregated
  from selected l join public.ezyvet_migration_review_pages p on p.id=l.review_page_id and p.actor_id=a and p.preparation_id=p_preparation_id
  left join public.ezyvet_migration_native_aggregations n on n.chain_link_id=l.id and n.preparation_id=p_preparation_id and n.actor_id=a and n.evidence_hash=p.evidence_hash
  left join public.ezyvet_migration_approval_aggregations r on r.chain_link_id=l.id and r.preparation_id=p_preparation_id and r.actor_id=a and r.evidence_hash=p.evidence_hash
 )
 select jsonb_build_object('preparation_id',p_preparation_id,
  'pages',coalesce((select jsonb_agg(to_jsonb(w) order by w.id) from work w),'[]'::jsonb),
  'has_more',(select count(*)>p_limit from candidates),
  'next_after_id',case when (select count(*)>p_limit from candidates) then (select id from selected order by id desc limit 1) else null end,
  'report_ready',false,'currentness_reverified',false) into result;
 return result;
end;
$$;
revoke all on function public.list_ezyvet_migration_aggregation_work(uuid,uuid,integer) from public,anon,authenticated,service_role;

-- Process a bounded selected-page window atomically. Replays reuse per-page receipts.
create function public.process_ezyvet_migration_aggregation_work(p_preparation_id uuid,p_after_id uuid default null,p_limit integer default 1)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare work jsonb;item jsonb;
begin
 if p_limit is null or p_limit not between 1 and 10 then raise exception 'Invalid aggregation batch limit' using errcode='23514';end if;
 work:=public.list_ezyvet_migration_aggregation_work(p_preparation_id,p_after_id,p_limit);
 perform public.assert_ezyvet_migration_dependencies(p_preparation_id);
 for item in select value from jsonb_array_elements(work->'pages') loop
  perform public.aggregate_ezyvet_migration_native_page((item->>'id')::uuid);
  perform public.aggregate_ezyvet_migration_approval_page((item->>'id')::uuid);
 end loop;
 perform public.assert_ezyvet_migration_dependencies(p_preparation_id);
 return public.list_ezyvet_migration_aggregation_work(p_preparation_id,p_after_id,p_limit);
end;
$$;
revoke all on function public.process_ezyvet_migration_aggregation_work(uuid,uuid,integer) from public,anon,authenticated,service_role;

create index migration_cancellation_request_cursor on public.ezyvet_attachment_approval_cancellations(request_id,actor_id,id desc);
create function public.read_ezyvet_migration_prepared_cancellation_evidence(
 p_preparation_id uuid,p_binding_id uuid,p_first_page integer,p_observation_index integer,
 p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare a uuid:=auth.uid();chunk public.ezyvet_migration_source_chunks;entry jsonb;result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_observation_index is null or p_observation_index not between 1 and 1000 or p_limit is null or p_limit not between 1 and 100 then
  raise exception 'Invalid prepared cancellation cursor' using errcode='23514';end if;
 select c.* into chunk from public.ezyvet_migration_source_chunks c
 join public.ezyvet_migration_preparations p on p.id=c.preparation_id and p.actor_id=a
 where c.preparation_id=p_preparation_id and c.actor_id=a and c.binding_id=p_binding_id and c.first_page=p_first_page;
 if chunk.preparation_id is null then raise exception 'Owned source chunk required' using errcode='42501';end if;
 entry:=chunk.entries->(p_observation_index-1);
 if entry is null or entry->>'resource'<>'attachment' then raise exception 'Saved attachment observation required' using errcode='23514';end if;
 perform public.assert_ezyvet_migration_dependencies(p_preparation_id);
 with bounded as materialized (
  select z.id,z.request_id
  from public.ezyvet_attachment_approval_cancellations z
  join public.ezyvet_attachment_capture_requests q on q.id=z.request_id and q.requested_by=a
  join public.ezyvet_attachment_original_captures c on c.request_id=q.id and c.capture_hash=z.capture_hash
  join public.ezyvet_migration_scopes s on s.id=(entry->>'scope_id')::uuid
  where z.actor_id=a and (p_before_id is null or z.id<p_before_id)
   and q.animal_link_id=(entry->>'mapping_id')::uuid and q.pet_id=(entry->>'pet_id')::uuid and q.client_id=(entry->>'client_id')::uuid
   and q.snapshot_id=(entry->>'snapshot_id')::uuid and q.observed_head_version=(entry->>'observed_head_version')::integer
   and q.external_id=entry->>'external_id' and q.file_id=entry->>'file_id' and q.stable_metadata_sha256=entry->>'stable_metadata_sha256'
   and q.parent_context->>'source_origin'=entry->>'source_origin' and q.parent_context->>'source_site_uid'=entry->>'source_site_uid'
   and q.parent_context->>'parent_snapshot_id'=entry->>'parent_snapshot_id'
   and q.parent_context->>'parent_observed_head_version'=entry->>'parent_head_version'
   and q.parent_context->>'animal_external_id'=s.parent_external_id
  order by z.id desc limit p_limit+1
 ), selected as materialized(select * from bounded order by id desc limit p_limit)
 select jsonb_build_object('preparation_id',p_preparation_id,'binding_id',p_binding_id,'source_chunk_hash',chunk.evidence_hash,
  'observation_index',p_observation_index,'evidence_hash',entry->>'evidence_hash',
  'cancellations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'request_id',request_id,'revokes_approval',false) order by id desc) from selected),'[]'::jsonb),
  'has_more',(select count(*)>p_limit from bounded),
  'next_cursor',case when (select count(*)>p_limit from bounded) then (select jsonb_build_object('before_id',id) from selected order by id limit 1) else null end,
  'report_ready',false,'currentness_reverified',false) into result;
 perform public.assert_ezyvet_migration_dependencies(p_preparation_id);
 return result;
end;
$$;
revoke all on function public.read_ezyvet_migration_prepared_cancellation_evidence(uuid,uuid,integer,integer,uuid,integer) from public,anon,authenticated,service_role;

-- Transactional work counts avoid rescanning every selected evidence page at finalization.
create table public.ezyvet_migration_chunk_work_counts (
 preparation_id uuid not null,binding_id uuid not null,first_page integer not null,
 selected_pages bigint not null default 0 check(selected_pages>=0),
 native_pages bigint not null default 0 check(native_pages between 0 and selected_pages),
 receipt_pages bigint not null default 0 check(receipt_pages between 0 and selected_pages),
 primary key(preparation_id,binding_id,first_page),
 foreign key(preparation_id,binding_id,first_page) references public.ezyvet_migration_source_chunks(preparation_id,binding_id,first_page)
);
alter table public.ezyvet_migration_chunk_work_counts enable row level security;
revoke all on public.ezyvet_migration_chunk_work_counts from public,anon,authenticated,service_role;
create function public.record_ezyvet_migration_chunk_work() returns trigger
language plpgsql security invoker set search_path=public as $$
declare page public.ezyvet_migration_review_pages;link_id uuid;selected_delta integer:=0;native_delta integer:=0;receipt_delta integer:=0;
begin
 if tg_table_name='ezyvet_migration_source_chunks' then
  insert into public.ezyvet_migration_chunk_work_counts(preparation_id,binding_id,first_page)
   values(new.preparation_id,new.binding_id,new.first_page);
  return new;
 end if;
 if tg_table_name='ezyvet_migration_review_chain_links' then
  select * into page from public.ezyvet_migration_review_pages where id=new.review_page_id;
  selected_delta:=1;
 else
  link_id:=new.chain_link_id;
  select p.* into page from public.ezyvet_migration_review_chain_links l join public.ezyvet_migration_review_pages p on p.id=l.review_page_id where l.id=link_id;
  if page.evidence_hash is distinct from new.evidence_hash then raise exception 'Aggregation evidence mismatch' using errcode='23514';end if;
  if tg_table_name='ezyvet_migration_native_aggregations' then native_delta:=1;
  elsif tg_table_name='ezyvet_migration_approval_aggregations' then receipt_delta:=1;
  else raise exception 'Unsupported work ledger' using errcode='23514';end if;
 end if;
 if page.id is null or page.actor_id is distinct from new.actor_id or page.preparation_id is distinct from new.preparation_id then
  raise exception 'Aggregation owner mismatch' using errcode='23514';end if;
 update public.ezyvet_migration_chunk_work_counts set selected_pages=selected_pages+selected_delta,
  native_pages=native_pages+native_delta,receipt_pages=receipt_pages+receipt_delta
  where preparation_id=page.preparation_id and binding_id=page.binding_id and first_page=page.first_page;
 if not found then raise exception 'Source work counter missing' using errcode='23514';end if;
 return new;
end;
$$;
revoke all on function public.record_ezyvet_migration_chunk_work() from public,anon,authenticated,service_role;
do $$declare t text;begin foreach t in array array['ezyvet_migration_source_chunks','ezyvet_migration_review_chain_links','ezyvet_migration_native_aggregations','ezyvet_migration_approval_aggregations'] loop
 execute format('create trigger migration_chunk_work after insert on public.%I for each row execute function public.record_ezyvet_migration_chunk_work()',t);
end loop;end $$;

create table public.ezyvet_migration_attempt_pages (
 id uuid primary key,preparation_id uuid not null references public.ezyvet_migration_preparations(id),
 actor_id uuid not null references public.profiles(id),binding_id uuid not null references public.ezyvet_migration_bindings(id),
 child_run_id uuid not null references public.ezyvet_import_runs(id),previous_id uuid references public.ezyvet_migration_attempt_pages(id),
 position bigint not null check(position>0),page_limit integer not null check(page_limit between 1 and 100),
 next_before_sequence integer,has_more boolean not null,request_hash text not null,evidence jsonb not null,evidence_hash text not null,
 totals jsonb not null,chain_hash text not null check(chain_hash ~ '^[a-f0-9]{64}$'),
 check(has_more=(next_before_sequence is not null)),check(next_before_sequence is null or next_before_sequence>0),
 check(jsonb_typeof(evidence)='object' and octet_length(evidence::text)<=262144),
 unique(preparation_id,child_run_id,position),created_at timestamptz not null default clock_timestamp()
);
alter table public.ezyvet_migration_attempt_pages enable row level security;
revoke all on public.ezyvet_migration_attempt_pages from public,anon,authenticated,service_role;
create trigger immutable_migration_attempt_page before update or delete on public.ezyvet_migration_attempt_pages
 for each row execute function public.guard_inquiry_history();
create table public.ezyvet_migration_calculation_snapshots (
 preparation_id uuid primary key references public.ezyvet_migration_preparations(id),
 actor_id uuid not null references public.profiles(id),payload jsonb not null,
 evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz not null default clock_timestamp()
);
alter table public.ezyvet_migration_calculation_snapshots enable row level security;
revoke all on public.ezyvet_migration_calculation_snapshots from public,anon,authenticated,service_role;
create trigger immutable_migration_calculation_snapshot before update or delete on public.ezyvet_migration_calculation_snapshots
 for each row execute function public.guard_inquiry_history();
create function public.guard_ezyvet_migration_calculation_freeze() returns trigger
language plpgsql security invoker set search_path=public as $$
declare preparation uuid;
begin
 preparation:=case when tg_op='DELETE' then old.preparation_id else new.preparation_id end;
 perform pg_advisory_xact_lock(hashtextextended('migration-calculation-freeze:'||preparation::text,0));
 if exists(select 1 from public.ezyvet_migration_calculation_snapshots where preparation_id=preparation) then
  raise exception 'Preparation calculations are frozen' using errcode='23514';end if;
 if tg_op='DELETE' then return old;else return new;end if;
end;
$$;
revoke all on function public.guard_ezyvet_migration_calculation_freeze() from public,anon,authenticated,service_role;
do $$declare t text;begin foreach t in array array[
 'ezyvet_migration_source_chunks','ezyvet_migration_review_pages','ezyvet_migration_review_chain_links',
 'ezyvet_migration_review_requirements','ezyvet_migration_review_completions','ezyvet_migration_source_keys',
 'ezyvet_migration_source_counts','ezyvet_migration_source_aggregations','ezyvet_migration_native_keys',
 'ezyvet_migration_native_counts','ezyvet_migration_native_aggregations','ezyvet_migration_approval_states',
 'ezyvet_migration_approval_counts','ezyvet_migration_approval_aggregations','ezyvet_migration_item_relation_keys',
 'ezyvet_migration_item_relation_counts','ezyvet_migration_coverage_keys','ezyvet_migration_coverage_counts',
 'ezyvet_migration_chunk_work_counts','ezyvet_migration_attempt_pages'] loop
 execute format('create trigger migration_calculation_freeze before insert or update or delete on public.%I for each row execute function public.guard_ezyvet_migration_calculation_freeze()',t);
end loop;end $$;

create function public.freeze_ezyvet_migration_calculations(p_preparation_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare a uuid:=auth.uid();prep public.ezyvet_migration_preparations;saved public.ezyvet_migration_calculation_snapshots;progress jsonb;payload jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('migration-calculation-freeze:'||p_preparation_id::text,0));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into prep from public.ezyvet_migration_preparations where id=p_preparation_id and actor_id=a;
 if prep.id is null then raise exception 'Owned preparation required' using errcode='42501';end if;
 select * into saved from public.ezyvet_migration_calculation_snapshots where preparation_id=p_preparation_id and actor_id=a;
 if saved.preparation_id is null then
  perform public.assert_ezyvet_migration_freeze_guards();
  perform public.assert_ezyvet_migration_dependencies(p_preparation_id);
  progress:=public.read_ezyvet_migration_report_progress(p_preparation_id);
  if (progress->>'bound_aggregation_work_complete')::boolean is not true then
   raise exception 'Preparation calculations are incomplete' using errcode='23514';end if;
  select jsonb_build_object('version',1,'preparation_id',prep.id,'migration_run_id',prep.migration_run_id,
   'plan_hash',prep.plan_hash,'plan',prep.plan,'progress',progress,
   'scan',public.read_ezyvet_migration_prepared_scan(prep.id),'attempt_history',public.read_ezyvet_migration_attempt_progress(prep.id),
   'source_counts',coalesce((select jsonb_agg(jsonb_build_object('resource',resource,'metric',metric,'records',records) order by resource,metric) from public.ezyvet_migration_source_counts where preparation_id=prep.id),'[]'::jsonb),
   'receipt_counts',coalesce((select jsonb_agg(jsonb_build_object('receipt_kind',receipt_kind,'metric',metric,'records',records) order by receipt_kind,metric) from public.ezyvet_migration_approval_counts where preparation_id=prep.id),'[]'::jsonb),
   'native_counts',coalesce((select jsonb_agg(jsonb_build_object('native_kind',native_kind,'metric',metric,'records',records) order by native_kind,metric) from public.ezyvet_migration_native_counts where preparation_id=prep.id),'[]'::jsonb),
   'coverage_counts',coalesce((select jsonb_agg(jsonb_build_object('resource',resource,'metric',metric,'records',records) order by resource,metric) from public.ezyvet_migration_coverage_counts where preparation_id=prep.id),'[]'::jsonb),
   'item_relations',coalesce((select jsonb_object_agg(disposition,records) from public.ezyvet_migration_item_relation_counts where preparation_id=prep.id),'{}'::jsonb),
   'chunks_hash',(select encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(c.binding_id,c.first_page,c.evidence_hash,r.chains_hash,w.selected_pages,w.native_pages,w.receipt_pages) order by c.binding_id,c.first_page),'[]'::jsonb)::text,'UTF8')),'hex')
    from public.ezyvet_migration_source_chunks c join public.ezyvet_migration_review_completions r using(preparation_id,binding_id,first_page)
    join public.ezyvet_migration_chunk_work_counts w using(preparation_id,binding_id,first_page) where c.preparation_id=prep.id),
   'report_ready',false,'complete_coverage_verified',false,'cutover_accepted',false) into payload;
  perform public.assert_ezyvet_migration_dependencies(p_preparation_id);
  insert into public.ezyvet_migration_calculation_snapshots(preparation_id,actor_id,payload,evidence_hash)
   values(prep.id,a,payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex')) returning * into saved;
 end if;
 return to_jsonb(saved)||jsonb_build_object('calculations_frozen',true,'currentness_reverified',false,'report_ready',false);
end;
$$;
revoke all on function public.freeze_ezyvet_migration_calculations(uuid) from public,anon,authenticated,service_role;

create function public.assert_ezyvet_migration_freeze_guards() returns void
language plpgsql stable security invoker set search_path=public as $$
begin
 if exists(
  with expected as (
   select unnest(array[
 'ezyvet_migration_source_chunks','ezyvet_migration_review_pages','ezyvet_migration_review_chain_links',
 'ezyvet_migration_review_requirements','ezyvet_migration_review_completions','ezyvet_migration_source_keys',
 'ezyvet_migration_source_counts','ezyvet_migration_source_aggregations','ezyvet_migration_native_keys',
 'ezyvet_migration_native_counts','ezyvet_migration_native_aggregations','ezyvet_migration_approval_states',
 'ezyvet_migration_approval_counts','ezyvet_migration_approval_aggregations','ezyvet_migration_item_relation_keys',
 'ezyvet_migration_item_relation_counts','ezyvet_migration_coverage_keys','ezyvet_migration_coverage_counts',
 'ezyvet_migration_chunk_work_counts','ezyvet_migration_attempt_pages']) table_name,'migration_calculation_freeze' trigger_name,
    'public.guard_ezyvet_migration_calculation_freeze()'::regprocedure function_id,31 trigger_type
   union all
   select unnest(array['ezyvet_migration_source_chunks','ezyvet_migration_review_chain_links','ezyvet_migration_native_aggregations','ezyvet_migration_approval_aggregations']),
    'migration_chunk_work','public.record_ezyvet_migration_chunk_work()'::regprocedure,5
  ) select 1 from expected e where not exists(
   select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname=e.table_name and t.tgname=e.trigger_name and not t.tgisinternal
    and t.tgenabled in ('O','A') and t.tgtype=e.trigger_type and t.tgfoid=e.function_id
  )
 ) then raise exception 'Calculation guard coverage incomplete' using errcode='55000';end if;
end;
$$;
revoke all on function public.assert_ezyvet_migration_freeze_guards() from public,anon,authenticated,service_role;

create function public.ezyvet_migration_frozen_review(p_payload jsonb)
returns jsonb language sql immutable security invoker set search_path=public as $$
 with resources as (
  select distinct x->>'resource' resource from jsonb_array_elements(p_payload->'plan') x
 ), counts as (
  select resource,jsonb_object_agg(metric,records) metrics
  from jsonb_to_recordset(p_payload->'coverage_counts') x(resource text,metric text,records bigint) group by resource
 ), projected as (
  select r.resource,coalesce((c.metrics->>'observed_occurrences')::bigint,0) observed_occurrences,
   case when r.resource='consult' then 'not_applicable' else 'applicable' end approval_applicability,
   case when r.resource<>'consult' then coalesce((c.metrics->>'observed_occurrences')::bigint,0)-coalesce((c.metrics->>'occurrences_with_approval')::bigint,0) end occurrences_without_approval,
   case when r.resource<>'consult' then coalesce((c.metrics->>'occurrences_with_exact_approval')::bigint,0) end occurrences_with_exact_approval,
   case when r.resource<>'consult' then coalesce((c.metrics->>'occurrences_with_snapshot_only_approval')::bigint,0) end occurrences_with_snapshot_only_approval,
   case when r.resource<>'consult' then coalesce((c.metrics->>'occurrences_with_current_latest_exact_approval')::bigint,0) end occurrences_with_current_latest_exact_approval
  from resources r left join counts c using(resource)
 )
 select jsonb_build_object('version',1,'migration_run_id',p_payload->'migration_run_id',
  'resources',coalesce((select jsonb_agg(to_jsonb(p) order by resource) from projected p),'[]'::jsonb),
  'facets_overlap',true,'complete_coverage_verified',false,'cutover_accepted',false);
$$;
revoke all on function public.ezyvet_migration_frozen_review(jsonb) from public,anon,authenticated,service_role;

create function public.read_ezyvet_migration_calculation_snapshot(p_preparation_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare a uuid:=auth.uid();saved public.ezyvet_migration_calculation_snapshots;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select s.* into saved from public.ezyvet_migration_calculation_snapshots s
 join public.ezyvet_migration_preparations p on p.id=s.preparation_id and p.actor_id=a
 where s.preparation_id=p_preparation_id and s.actor_id=a;
 if saved.preparation_id is null then raise exception 'Owned frozen calculations required' using errcode='42501';end if;
 if encode(sha256(convert_to(saved.payload::text,'UTF8')),'hex')<>saved.evidence_hash then
  raise exception 'Frozen calculation hash mismatch' using errcode='23514';end if;
 return jsonb_build_object('snapshot',to_jsonb(saved),'review',public.ezyvet_migration_frozen_review(saved.payload),
  'source_resources',public.ezyvet_migration_frozen_source_resources(saved.payload),'outcomes',public.ezyvet_migration_frozen_outcomes(saved.payload),'scan',saved.payload->'scan',
  'dependency_state',public.read_ezyvet_migration_dependency_state(p_preparation_id),
  'historical',true,'report_ready',false,'complete_coverage_verified',false,'cutover_accepted',false);
end;
$$;
revoke all on function public.read_ezyvet_migration_calculation_snapshot(uuid) from public,anon,authenticated,service_role;

create function public.ezyvet_migration_frozen_source_resources(p_payload jsonb)
returns jsonb language sql immutable security invoker set search_path=public as $$
 with scopes as (
  select resource,count(*) scopes,count(*) filter(where disposition='required') required_scopes,
   count(*) filter(where disposition='excluded') excluded_scopes,count(*) filter(where disposition='unsupported') unsupported_scopes,
   count(*) filter(where disposition='required' and binding_id is null) unbound_required_scopes,count(distinct child_run_id) child_runs
  from jsonb_to_recordset(p_payload->'plan') x(resource text,disposition text,binding_id uuid,child_run_id uuid) group by resource
 ), counts as (
  select resource,jsonb_object_agg(metric,records) metrics
  from jsonb_to_recordset(p_payload->'source_counts') x(resource text,metric text,records bigint) group by resource
 ), rows as (
  select s.resource,to_jsonb(s)||jsonb_build_object('occurrence_fidelity',case when s.resource='attachment' then 'page_ordinal' else 'deduplicated_page_snapshot' end,'provider_total',null)
   ||(select jsonb_object_agg(k,coalesce((c.metrics->>k)::bigint,0)) from unnest(array['observation_memberships','observed_occurrences','source_identities','source_snapshots','recorded_source_versions','occurrences_without_observed_head']) k) value
  from scopes s left join counts c using(resource)
 ) select coalesce(jsonb_agg(value order by resource),'[]'::jsonb) from rows;
$$;
revoke all on function public.ezyvet_migration_frozen_source_resources(jsonb) from public,anon,authenticated,service_role;

create function public.ezyvet_migration_frozen_outcomes(p_payload jsonb)
returns jsonb language sql immutable security invoker set search_path=public as $$
 with counts as materialized (
  select * from jsonb_to_recordset(p_payload->'receipt_counts') x(receipt_kind text,metric text,records bigint)
 ), kinds as (select distinct receipt_kind from counts), receipts as (
  select k.receipt_kind,jsonb_object_agg(m.metric,coalesce(c.records,0)) metrics
  from kinds k cross join unnest(array['versions','latest_versions','source_current_versions','source_stale_versions','locally_changed_versions','patient_version_assessed_versions','household_assessed_versions','changed_patient_versions','changed_household_versions','created_record_receipts','linked_record_receipts','exact_observation_version_matches','same_snapshot_unknown_head_matches']) m(metric)
  left join counts c on c.receipt_kind=k.receipt_kind and c.metric=m.metric group by k.receipt_kind
 ), native as (
  select native_kind,jsonb_object_agg(metric,records) metrics
  from jsonb_to_recordset(p_payload->'native_counts') x(native_kind text,metric text,records bigint) group by native_kind
 )
 select jsonb_build_object('version',1,'migration_run_id',p_payload->'migration_run_id',
  'receipts',coalesce((select jsonb_object_agg(receipt_kind,metrics) from receipts),'{}'::jsonb),
  'native_outcomes',coalesce((select jsonb_object_agg(native_kind,jsonb_build_object('records',coalesce((metrics->>'records')::bigint,0),'locally_changed_records',coalesce((metrics->>'locally_changed_records')::bigint,0))) from native),'{}'::jsonb),
  'prescription_review_gaps',(select jsonb_object_agg(m.metric,coalesce(c.records,0)) from unnest(array['reviewed_versions','latest_versions','partial_versions','latest_partial_versions','unresolved_reference_versions','absent_source_list_versions','unfinished_scan_versions','missing_item_versions','unexpected_item_versions','duplicate_source_reference_versions','duplicate_observation_versions','invalid_reference_versions','unknown_date_versions','unknown_status_versions']) m(metric)
   left join counts c on c.receipt_kind='imported_prescription' and c.metric='gap_'||m.metric),
  'prescription_item_relations',coalesce(p_payload->'item_relations','{}'::jsonb),
  'attachment_capture',jsonb_build_object('request_visibility','current_owner_only',
   'requests_by_status',coalesce((select jsonb_object_agg(substr(metric,16),records) from counts where receipt_kind='attachment_capture_request' and metric like 'capture_status_%' and records>0),'{}'::jsonb),
   'stale_source_requests',coalesce((select records from counts where receipt_kind='attachment_capture_request' and metric='source_stale_versions'),0),
   'captured_originals',coalesce((select records from counts where receipt_kind='attachment_captured_bytes' and metric='versions'),0),
   'approved_original_versions',coalesce((select records from counts where receipt_kind='attachment_original_approval' and metric='versions'),0),
   'unconfirmed_cancellations',coalesce((select records from counts where receipt_kind='attachment_unconfirmed_cancellation' and metric='versions'),0),
   'original_bytes_reverified',false,'retrievability','not_checked_by_summary'),
  'facets_overlap',true,'standalone_consult_approval','not_applicable','complete_coverage_verified',false,'cutover_accepted',false);
$$;
revoke all on function public.ezyvet_migration_frozen_outcomes(jsonb) from public,anon,authenticated,service_role;

create function public.prepare_ezyvet_migration_attempt_page(p_id uuid,p_preparation_id uuid,p_binding_id uuid,p_previous_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare a uuid:=auth.uid();child uuid;digest text;result jsonb;next_sequence integer;more boolean;totals jsonb;page_hash text;chain_digest text;
 saved public.ezyvet_migration_attempt_pages;tail public.ezyvet_migration_attempt_pages;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_preparation_id is null or p_binding_id is null or p_limit is null or p_limit not between 1 and 100 then
  raise exception 'Invalid saved attempt request' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('migration-calculation-freeze:'||p_preparation_id::text,0));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select (x->>'child_run_id')::uuid into child from public.ezyvet_migration_preparations p
 cross join lateral jsonb_array_elements(p.plan) x
 where p.id=p_preparation_id and p.actor_id=a and x->>'disposition'='required' and x->>'binding_id'=p_binding_id::text;
 if child is null then raise exception 'Owned prepared binding required' using errcode='42501';end if;
 digest:=encode(sha256(convert_to(jsonb_build_array(1,a,p_preparation_id,p_binding_id,p_previous_id,p_limit)::text,'UTF8')),'hex');
 select * into saved from public.ezyvet_migration_attempt_pages where id=p_id;
 if saved.id is not null then
  if saved.actor_id<>a or saved.request_hash<>digest then raise exception 'Owned identical attempt request required' using errcode='42501';end if;
 else
  perform public.assert_ezyvet_migration_dependencies(p_preparation_id);
  select * into tail from public.ezyvet_migration_attempt_pages where preparation_id=p_preparation_id and child_run_id=child order by position desc limit 1;
  if tail.id is distinct from p_previous_id then raise exception 'Attempt history predecessor changed' using errcode='40001';end if;
  if tail.id is not null and not tail.has_more then raise exception 'Attempt history already ended' using errcode='23514';end if;
  result:=public.list_ezyvet_migration_attempt_events(p_binding_id,tail.next_before_sequence,p_limit);
  more:=(result->>'has_more')::boolean;
  if more then
   select min((x->>'sequence')::integer) into next_sequence from jsonb_array_elements(result->'events') x;
   if next_sequence is null or (tail.next_before_sequence is not null and next_sequence>=tail.next_before_sequence) then
    raise exception 'Invalid attempt continuation' using errcode='23514';end if;
  end if;
  select jsonb_build_object(
   'claims',coalesce((tail.totals->>'claims')::bigint,0)+count(*) filter(where x->>'kind'='claimed'),
   'failed_pages',coalesce((tail.totals->>'failed_pages')::bigint,0)+count(*) filter(where x->>'kind'='page_failed'),
   'staged_pages',coalesce((tail.totals->>'staged_pages')::bigint,0)+count(*) filter(where x->>'kind'='page_staged'),
   'events',coalesce((tail.totals->>'events')::bigint,0)+count(*),
   'complete_history',coalesce((tail.totals->>'complete_history')::boolean,false) or coalesce(bool_or(x->>'history_origin'='run_created'),false)
  ) into totals from jsonb_array_elements(result->'events') x;
  page_hash:=encode(sha256(convert_to(result::text,'UTF8')),'hex');
  chain_digest:=encode(sha256(convert_to(jsonb_build_array(tail.chain_hash,digest,page_hash,totals)::text,'UTF8')),'hex');
  perform public.assert_ezyvet_migration_dependencies(p_preparation_id);
  insert into public.ezyvet_migration_attempt_pages(id,preparation_id,actor_id,binding_id,child_run_id,previous_id,position,page_limit,next_before_sequence,has_more,request_hash,evidence,evidence_hash,totals,chain_hash)
   values(p_id,p_preparation_id,a,p_binding_id,child,p_previous_id,coalesce(tail.position,0)+1,p_limit,next_sequence,more,digest,result,page_hash,totals,chain_digest) returning * into saved;
 end if;
 return to_jsonb(saved)||jsonb_build_object('report_ready',false,'currentness_reverified',false);
end;
$$;
revoke all on function public.prepare_ezyvet_migration_attempt_page(uuid,uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;

create function public.read_ezyvet_migration_attempt_progress(p_preparation_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare result jsonb;a uuid:=auth.uid();
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if not exists(select 1 from public.ezyvet_migration_preparations where id=p_preparation_id and actor_id=a) then raise exception 'Owned preparation required' using errcode='42501';end if;
 with children as (
  select (x->>'child_run_id')::uuid child_run_id,min(x->>'binding_id')::uuid binding_id
  from public.ezyvet_migration_preparations p cross join lateral jsonb_array_elements(p.plan) x
  where p.id=p_preparation_id and x->>'disposition'='required' and x->>'binding_id' is not null group by x->>'child_run_id'
 ), tails as (
  select c.*,t.id last_page_id,t.position saved_pages,t.next_before_sequence,coalesce(not t.has_more,false) ended,t.totals,t.chain_hash
  from children c left join lateral(select * from public.ezyvet_migration_attempt_pages t
   where t.preparation_id=p_preparation_id and t.child_run_id=c.child_run_id and t.actor_id=a order by position desc limit 1) t on true
 )
 select jsonb_build_object('preparation_id',p_preparation_id,'expected_children',count(*),'completed_children',count(*) filter(where ended),
  'missing_children',count(*) filter(where not ended),'children',coalesce(jsonb_agg(to_jsonb(t) order by child_run_id),'[]'::jsonb),
  'report_ready',false) into result from tails t;
 return result;
end;
$$;
revoke all on function public.read_ezyvet_migration_attempt_progress(uuid) from public,anon,authenticated,service_role;

create function public.read_ezyvet_migration_prepared_scan(p_preparation_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path=public as $$
declare history jsonb;result jsonb;scan_as_of timestamptz:=clock_timestamp();
begin
 history:=public.read_ezyvet_migration_attempt_progress(p_preparation_id);
 if (history->>'missing_children')::bigint<>0 then raise exception 'Prepared attempt history is incomplete' using errcode='23514';end if;
 with owned as (select p.*,m.source_origin,m.source_site_uid from public.ezyvet_migration_preparations p join public.ezyvet_migration_runs m on m.id=p.migration_run_id where p.id=p_preparation_id),
 bound as (
  select x.*,exists(select 1 from public.ezyvet_identity_heads h where h.source_origin=p.source_origin and h.source_site_uid=p.source_site_uid
    and h.resource=s.parent_type and h.external_id=s.parent_external_id and h.snapshot_id=s.parent_snapshot_id and h.version=s.parent_head_version) parent_current,
   case when s.pet_id is null then exists(select 1 from public.clients where id=s.client_id)
    else exists(select 1 from public.pets where id=s.pet_id and client_id=s.client_id) end household_current
  from owned p cross join lateral jsonb_to_recordset(p.plan) x(scope_id uuid,disposition text,child_run_id uuid,binding_id uuid,page_count integer)
  join public.ezyvet_migration_scopes s on s.id=x.scope_id where x.disposition='required' and x.binding_id is not null
 ), children as (
  select c.* from public.ezyvet_import_runs c where c.id in(select child_run_id from bound)
 ), histories as (select * from jsonb_to_recordset(history->'children') x(child_run_id uuid,totals jsonb,chain_hash text)), scans as (
  select count(*) distinct_child_runs,count(*) filter(where status='review_ready') traversal_ended,
   count(*) filter(where status='running') unfinished,count(*) filter(where status='page_limit_reached') page_limited,
   count(*) filter(where retry_after>scan_as_of) cooling_down,count(*) filter(where lease_until>scan_as_of) active_leases,
   count(*) filter(where last_error_code is not null) with_latest_error from children
 )
 select jsonb_build_object('version',1,'migration_run_id',p.migration_run_id,'scans',(select to_jsonb(scans) from scans),
  'pages_observed',(select coalesce(sum(page_count),0) from (select child_run_id,max(page_count) page_count from bound group by child_run_id) pages),
  'bound_required_scopes',(select count(*) from bound),'stale_parent_scopes',(select count(*) from bound where not parent_current),
  'changed_household_scopes',(select count(*) from bound where not household_current),
  'attempt_history',(select jsonb_build_object('claims',coalesce(sum((totals->>'claims')::bigint),0),
   'failed_pages',coalesce(sum((totals->>'failed_pages')::bigint),0),'staged_pages',coalesce(sum((totals->>'staged_pages')::bigint),0),
   'children_with_complete_history',count(*) filter(where (totals->>'complete_history')::boolean),
   'children_without_complete_history',count(*) filter(where not (totals->>'complete_history')::boolean)) from histories),
  'provider_total',null,'complete_coverage_verified',false,'cutover_accepted',false) into result from owned p;
 return result;
end;
$$;
revoke all on function public.read_ezyvet_migration_prepared_scan(uuid) from public,anon,authenticated,service_role;
