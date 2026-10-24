-- DVM discovery crosses intake-actor boundaries, never patient boundaries.
create function public.list_ezyvet_prescription_review_candidates(p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows jsonb;more boolean;lastrow jsonb;begin
 perform public.ezyvet_prescription_require_dvm();
 if p_pet_id is null or p_limit is null or p_limit not between 1 and 50 or(p_before_at is null)<>(p_before_id is null) then
  raise exception 'Invalid prescription review candidate cursor' using errcode='23514';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'created_at',s.created_at,'status',s.status,
  'animal_link_id',s.animal_link_id,'prescription_external_id',s.prescription_external_id,
  'source',jsonb_build_object('origin',s.source_origin,'site_uid',s.source_site_uid),
  'item_count',(select count(*) from public.ezyvet_prescriptionitem_page_observations o where o.run_id=s.id)) order by s.created_at desc,s.id desc),'[]') into rows
 from(select r.id,r.created_at,r.status,c.animal_link_id,c.prescription_external_id,c.source_origin,c.source_site_uid
  from public.ezyvet_prescriptionitem_runs c join public.ezyvet_import_runs r on r.id=c.run_id
  where c.pet_id=p_pet_id and row(r.resource,r.source_origin,r.source_site_uid,r.requested_by)=row('prescriptionitem'::text,c.source_origin,c.source_site_uid,c.actor_id)
   and(p_before_at is null or(r.created_at,r.id)<(p_before_at,p_before_id)) order by r.created_at desc,r.id desc limit p_limit+1) s;
 more:=jsonb_array_length(rows)>p_limit;if more then rows:=rows-p_limit;end if;lastrow:=rows->(jsonb_array_length(rows)-1);
 return jsonb_build_object('candidates',rows,'has_more',more,'next_cursor',case when more then jsonb_build_object('before_at',lastrow->'created_at','before_id',lastrow->'id') end);
end $$;
create function public.get_ezyvet_prescription_review_candidate(p_pet_id uuid,p_item_run_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_import_runs;c public.ezyvet_prescriptionitem_runs;parent public.ezyvet_import_snapshots;
 context jsonb;items jsonb;observed_ids jsonb;patient_version integer;eligible boolean:=true;unavailable text;
begin
 perform public.ezyvet_prescription_require_dvm();
 if p_pet_id is null or p_item_run_id is null then raise exception 'Patient and scoped item run required' using errcode='23514';end if;
 -- Match the collector/intake lock order. Saved observations cannot change
 -- midway through the preview, including when current eligibility has failed.
 select * into r from public.ezyvet_import_runs where id=p_item_run_id for share;
 select * into c from public.ezyvet_prescriptionitem_runs where run_id=p_item_run_id;
 if r.id is null or c.run_id is null or c.pet_id is distinct from p_pet_id
  or row(r.resource,r.source_origin,r.source_site_uid,r.requested_by) is distinct from row('prescriptionitem'::text,c.source_origin,c.source_site_uid,c.actor_id) then
  raise exception 'Patient-scoped prescription item evidence required' using errcode='42501';end if;
 begin
  context:=public.ezyvet_prescription_source_context(p_pet_id,p_item_run_id);
  if context#>>'{consult,status}'='unresolved' then eligible:=false;unavailable:='SOURCE_CONSULT_UNRESOLVED';end if;
 exception when sqlstate '40001' or sqlstate '42501' then
  -- Only expected stale/association failures become inspectable unavailability.
  -- Operational errors still propagate; no stale preview is eligible to prepare.
  eligible:=false;unavailable:='SOURCE_CONTEXT_CHANGED';
 end;
 if context is null then
  select * into parent from public.ezyvet_import_snapshots where id=c.prescription_snapshot_id;
  select coalesce(jsonb_agg(jsonb_build_object('snapshot_id',s.id,'payload_hash',s.payload_hash,'observed_head_version',o.head_version,
   'external_id',s.external_id,'page',o.page,'original',s.payload) order by s.external_id,o.page,s.id),'[]'),
   coalesce(jsonb_agg(to_jsonb(s.external_id) order by s.external_id,o.page,s.id),'[]') into items,observed_ids
   from public.ezyvet_prescriptionitem_page_observations o join public.ezyvet_import_snapshots s on s.id=o.snapshot_id where o.run_id=p_item_run_id;
  context:=jsonb_build_object('patient_id',c.pet_id,'client_id',c.client_id,'animal_link_id',c.animal_link_id,
   'source',jsonb_build_object('origin',c.source_origin,'site_uid',c.source_site_uid,'animal_id',c.animal_external_id),
   'parent',jsonb_build_object('snapshot_id',parent.id,'payload_hash',parent.payload_hash,'observed_head_version',c.prescription_observed_head_version,
    'external_id',c.prescription_external_id,'original',parent.payload),
   'consult',jsonb_build_object('status','not_checked','reference',parent.payload->'consult_id'),
   'item_run',jsonb_build_object('id',r.id,'status',r.status,'next_page',r.next_page),'items',items,
   'reconciliation',public.ezyvet_reconcile_prescription_items(parent.payload->'prescription_item_list',observed_ids,r.status='review_ready'));
 end if;
 select version into patient_version from public.pets where id=p_pet_id;
 return jsonb_build_object('run',public.ezyvet_prescriptionitem_run_projection(p_item_run_id),'patient_version',patient_version,
  'source_context',context,'eligible_for_review',eligible,'unavailable_reason',unavailable);
end $$;
revoke all on function public.list_ezyvet_prescription_review_candidates(uuid,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.get_ezyvet_prescription_review_candidate(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_ezyvet_prescription_review_candidates(uuid,timestamptz,uuid,integer) to authenticated;
grant execute on function public.get_ezyvet_prescription_review_candidate(uuid,uuid) to authenticated;
