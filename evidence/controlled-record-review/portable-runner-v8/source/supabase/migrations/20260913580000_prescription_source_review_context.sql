-- Private source collector. Approval and review-request lifecycle are separate.
create function public.ezyvet_prescription_source_context(p_pet_id uuid,p_item_run_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_import_runs;c public.ezyvet_prescriptionitem_runs;
 parent public.ezyvet_import_snapshots;item record;head public.ezyvet_identity_heads;
 items jsonb:='[]';observed_ids jsonb:='[]';consult_context jsonb;
 consult_source public.ezyvet_import_snapshots;consult_head public.ezyvet_identity_heads;
begin
 if p_pet_id is null or p_item_run_id is null then raise exception 'Patient and item run required' using errcode='23514';end if;
 -- Match intake order: item run before mapping/parent/item heads. No fresh page
 -- can change the receipt set while the eventual review request is prepared.
 select * into r from public.ezyvet_import_runs where id=p_item_run_id for share;
 select * into c from public.ezyvet_prescriptionitem_runs where run_id=p_item_run_id;
 if r.id is null or c.run_id is null or c.pet_id is distinct from p_pet_id
  or row(r.resource,r.source_origin,r.source_site_uid,r.requested_by) is distinct from
   row('prescriptionitem'::text,c.source_origin,c.source_site_uid,c.actor_id) then
  raise exception 'Patient-scoped prescription item evidence required' using errcode='42501';
 end if;
 parent:=public.ezyvet_validate_prescriptionitem_prescription(c.animal_link_id,c.source_origin,c.source_site_uid,
  c.prescription_snapshot_id,c.prescription_payload_hash,c.prescription_observed_head_version);
 -- The upstream consult is optional. An unresolved nonempty reference remains
 -- explicit evidence; the future approval validator must not silently accept it.
 if parent.payload->>'consult_id' is null or parent.payload->>'consult_id'='' then
  consult_context:=jsonb_build_object('status','not_supplied','reference',parent.payload->'consult_id');
 else
  select * into consult_head from public.ezyvet_identity_heads where source_origin=c.source_origin
   and source_site_uid=c.source_site_uid and resource='consult' and external_id=parent.payload->>'consult_id' for share;
  select * into consult_source from public.ezyvet_import_snapshots where id=consult_head.snapshot_id;
  if consult_source.id is not null and consult_source.payload->>'animal_id'=c.animal_external_id and exists(
   select 1 from public.ezyvet_clinical_page_observations o join public.ezyvet_clinical_runs cr on cr.run_id=o.run_id
   where o.snapshot_id=consult_source.id and o.head_version=consult_head.version and cr.animal_link_id=c.animal_link_id
    and row(cr.pet_id,cr.client_id,cr.source_origin,cr.source_site_uid,cr.resource)=
     row(c.pet_id,c.client_id,c.source_origin,c.source_site_uid,'consult'::text)
  ) then
   consult_context:=jsonb_build_object('status','resolved','reference',parent.payload->'consult_id',
    'snapshot_id',consult_source.id,'payload_hash',consult_source.payload_hash,'observed_head_version',consult_head.version);
  else consult_context:=jsonb_build_object('status','unresolved','reference',parent.payload->'consult_id');end if;
 end if;
 -- Retain every page observation, including duplicate source IDs. Canonical
 -- external-ID order matches intake's head locking and is independent of UI order.
 for item in
  select s.*,o.head_version observed_version,o.page from public.ezyvet_prescriptionitem_page_observations o
  join public.ezyvet_import_snapshots s on s.id=o.snapshot_id
  where o.run_id=p_item_run_id order by s.external_id,o.page,s.id
 loop
  if row(item.source_origin,item.source_site_uid,item.resource,item.payload->>'prescription_id') is distinct from
   row(c.source_origin,c.source_site_uid,'prescriptionitem'::text,c.prescription_external_id) then
   raise exception 'Prescription item source association changed' using errcode='40001';
  end if;
  select * into head from public.ezyvet_identity_heads where source_origin=item.source_origin and source_site_uid=item.source_site_uid
   and resource='prescriptionitem' and external_id=item.external_id for share;
  if head.snapshot_id is distinct from item.id or head.version is distinct from item.observed_version then
   raise exception 'SOURCE_PRESCRIPTION_ITEM_STALE' using errcode='40001';
  end if;
  observed_ids:=observed_ids||jsonb_build_array(item.external_id);
  items:=items||jsonb_build_array(jsonb_build_object('snapshot_id',item.id,'payload_hash',item.payload_hash,
   'observed_head_version',item.observed_version,'external_id',item.external_id,'page',item.page,'original',item.payload));
 end loop;
 return jsonb_build_object('patient_id',c.pet_id,'client_id',c.client_id,'animal_link_id',c.animal_link_id,
  'source',jsonb_build_object('origin',c.source_origin,'site_uid',c.source_site_uid,'animal_id',c.animal_external_id),
  'parent',jsonb_build_object('snapshot_id',parent.id,'payload_hash',parent.payload_hash,
   'observed_head_version',c.prescription_observed_head_version,'external_id',parent.external_id,'original',parent.payload),
  'consult',consult_context,'item_run',jsonb_build_object('id',r.id,'status',r.status,'next_page',r.next_page),
  'items',items,'reconciliation',public.ezyvet_reconcile_prescription_items(parent.payload->'prescription_item_list',observed_ids,r.status='review_ready'));
end;
$$;
revoke all on function public.ezyvet_prescription_source_context(uuid,uuid) from public,anon,authenticated,service_role;
