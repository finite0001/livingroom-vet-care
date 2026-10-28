-- Complete prospective recovery scope, including retired/empty products and
-- historical container locations. No current-state or nonzero-quantity filter.
CREATE FUNCTION narcotics_recovery_v1.scope_inventory() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE answer jsonb;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 PERFORM narcotics_recovery_v1.require_exclusive_admission();
 WITH container_locations AS MATERIALIZED(
  SELECT c.product_id,c.initial_location_id location_id FROM public.controlled_stock_containers c
  UNION SELECT c.product_id,h.location_id FROM public.controlled_stock_containers c
   JOIN public.controlled_stock_container_heads h ON h.container_id=c.id
  UNION SELECT c.product_id,t.before_location_id FROM public.controlled_stock_containers c
   JOIN public.controlled_stock_container_transitions t ON t.container_id=c.id
  UNION SELECT c.product_id,t.after_location_id FROM public.controlled_stock_containers c
   JOIN public.controlled_stock_container_transitions t ON t.container_id=c.id
 ),scope_refs AS MATERIALIZED(
  SELECT pv.product_id,ps.site_id FROM public.controlled_stock_policy_versions pv
   JOIN public.controlled_stock_policy_sites ps ON ps.policy_version_id=pv.id
  UNION SELECT product_id,controlling_site_id FROM public.controlled_stock_containers
  UNION SELECT x.product_id,l.site_id FROM container_locations x
   JOIN public.controlled_stock_locations l ON l.id=x.location_id
  UNION SELECT product_id,site_id FROM controlled_count_v1.policies
  UNION SELECT product_id,site_id FROM controlled_count_v1.cycles
  UNION SELECT product_id,site_id FROM controlled_count_v1.operations
  UNION SELECT product_id,site_id FROM controlled_count_v1.causes
  UNION SELECT product_id,site_id FROM controlled_count_v1.open_causes
  UNION SELECT product_id,site_id FROM controlled_count_v1.reconciliation_preparations
  UNION SELECT product_id,site_id FROM controlled_count_v1.operation_closures
  UNION SELECT product_id,site_id FROM controlled_stock_workflow_v1.journal
   WHERE product_id IS NOT NULL AND site_id IS NOT NULL
 ),product_refs AS MATERIALIZED(
  SELECT product_id FROM scope_refs
  UNION SELECT product_id FROM public.controlled_stock_states
  UNION SELECT product_id FROM public.controlled_stock_state_events
  UNION SELECT product_id FROM public.controlled_stock_policy_versions
  UNION SELECT product_id FROM public.controlled_stock_openings
  UNION SELECT product_id FROM public.controlled_stock_events
  UNION SELECT product_id FROM controlled_stock_workflow_v1.journal WHERE product_id IS NOT NULL
 ),bounded_products AS MATERIALIZED(
  SELECT product_id FROM product_refs ORDER BY product_id LIMIT 257
 ),bounded_scopes AS MATERIALIZED(
  SELECT product_id,site_id FROM scope_refs ORDER BY product_id,site_id LIMIT 257
 )SELECT jsonb_build_object('over_capacity',
  (SELECT count(*)>256 FROM bounded_products)OR(SELECT count(*)>256 FROM bounded_scopes),
  'products',(SELECT coalesce(jsonb_agg(product_id ORDER BY product_id),'[]'::jsonb)FROM bounded_products),
  'scopes',(SELECT coalesce(jsonb_agg(jsonb_build_object('product_id',product_id,'site_id',site_id)
   ORDER BY product_id,site_id),'[]'::jsonb)FROM bounded_scopes))INTO answer;
 IF answer->'over_capacity'IS DISTINCT FROM'false'::jsonb THEN
 RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(answer->'products')p(product_id)
  WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(answer->'scopes')s(scope)WHERE s.scope->>'product_id'=p.product_id))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(answer->'scopes')s(scope)
  WHERE NOT EXISTS(SELECT 1 FROM public.controlled_stock_sites site WHERE site.id=(s.scope->>'site_id')::uuid))THEN
 RAISE EXCEPTION 'narcotics_recovery_scope_unavailable' USING ERRCODE='PT409';END IF;
 RETURN answer-'over_capacity';
END $$;

CREATE FUNCTION narcotics_recovery_v1.capture_inventory(p_actor uuid,p_preflight boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE inventory_value jsonb;product_value jsonb;scope_value jsonb;event_value record;
 product_id_value uuid;site_id_value uuid;policy_value jsonb;boundary_value jsonb;
 manifest_value jsonb;scopes_value jsonb:='[]';answer jsonb;observers_value jsonb;
 candidate_value record;roles_value jsonb;observer_value jsonb;capability_value text;
BEGIN
 PERFORM narcotics_recovery_v1.require_exclusive_admission();
 PERFORM narcotics_recovery_v1.require_head();
 PERFORM narcotics_register_v1.identity(p_actor,true);
 IF p_preflight IS NULL THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 inventory_value:=narcotics_recovery_v1.scope_inventory();
 FOR product_value IN SELECT value FROM jsonb_array_elements(inventory_value->'products')LOOP
  product_id_value:=narcotics_register_v1.uuid_value(product_value);
  PERFORM public.controlled_stock_product_gate(p_actor,product_id_value);
  PERFORM public.controlled_stock_validate_product(product_id_value);
  -- Every retained event is validated; no recent-history cutoff is accepted.
  FOR event_value IN SELECT e.id FROM public.controlled_stock_events e
   WHERE e.product_id=product_id_value ORDER BY e.sequence LOOP
   PERFORM public.controlled_stock_validate_event(event_value.id);
  END LOOP;
 END LOOP;
 FOR scope_value IN SELECT value FROM jsonb_array_elements(inventory_value->'scopes')LOOP
  product_id_value:=(scope_value->>'product_id')::uuid;site_id_value:=(scope_value->>'site_id')::uuid;
  PERFORM narcotics_register_v1.authority(p_actor,product_id_value,site_id_value);
  boundary_value:=narcotics_recovery_v1.capture_full_boundary(product_id_value,site_id_value);
  manifest_value:=controlled_count_v1.saved_boundary_manifest(boundary_value,site_id_value);
  IF p_preflight THEN
   -- This release can reconcile one onsite available cell with the retained
   -- original correction workflow. Other physical footprints stay unarmed;
   -- they are not silently dropped or converted into a fictitious zero.
   IF jsonb_array_length(boundary_value->'cells')>1 OR jsonb_array_length(boundary_value->'containers')>1
   OR jsonb_array_length(boundary_value->'cells')<>jsonb_array_length(boundary_value->'containers')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(boundary_value->'cells')u(unit)WHERE u.unit->>'channel'IS DISTINCT FROM'available')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(boundary_value->'containers')c(container)WHERE c.container->>'kind'IS DISTINCT FROM'stock')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(boundary_value->'heads')h(head)WHERE h.head->>'status'IS DISTINCT FROM'onsite')
   OR jsonb_array_length(manifest_value->'units')>1
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(manifest_value->'units')u(unit)
    WHERE u.unit->>'channel'IS DISTINCT FROM'available')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(boundary_value->'containers')c(container)
    JOIN jsonb_array_elements(boundary_value->'heads')h(head)ON h.head->'container_id'=c.container->'id'
    JOIN jsonb_array_elements(boundary_value->'cells')cell(cell)ON cell.cell->'container_id'=c.container->'id'
    JOIN jsonb_array_elements(boundary_value->'positions')pos(position)ON pos.position->'cell_id'=cell.cell->'id'
    WHERE c.container->'controlling_site_id'=to_jsonb(site_id_value)AND h.head->>'status'<>'onsite'
     AND(pos.position->>'quantity')::numeric<>0)THEN
   RAISE EXCEPTION 'narcotics_recovery_footprint_unsupported' USING ERRCODE='PT409';END IF;
   policy_value:=controlled_count_v1.policy_history(product_id_value,site_id_value);
   IF policy_value IS NULL THEN RAISE EXCEPTION 'narcotics_recovery_count_unconfigured' USING ERRCODE='PT409';END IF;
   -- The existing two-person workflow must be usable before configuration is
   -- frozen: initiating administrator can observe/manage/prepare/execute/resolve;
   -- an independent observer can approve and confirm. No session is fabricated.
   FOREACH capability_value IN ARRAY ARRAY['observe','manage','reconciliation_prepare','reconciliation_execute','cause_resolve']LOOP
    PERFORM controlled_count_v1.current_principal(p_actor,product_id_value,site_id_value,capability_value);
   END LOOP;
   observers_value:=jsonb_build_array(controlled_count_v1.observer_candidate(p_actor,product_id_value,site_id_value));
   FOR candidate_value IN SELECT p.id FROM public.profiles p JOIN auth.users u ON u.id=p.id
    WHERE p.id<>p_actor AND p.is_active AND public.is_active_staff(p.id)AND(u.banned_until IS NULL OR u.banned_until<=clock_timestamp())
    ORDER BY p.id LOOP
    SELECT coalesce(jsonb_agg(r.role::text ORDER BY r.role::text COLLATE "C"),'[]'::jsonb)INTO roles_value
     FROM public.user_roles r WHERE r.user_id=candidate_value.id;
    IF controlled_count_v1.policy_capability_values(policy_value,roles_value,'observe')
    AND controlled_count_v1.policy_capability_values(policy_value,roles_value,'reconciliation_approve')
    AND controlled_count_v1.policy_capability_values(policy_value,roles_value,'reconciliation_confirm')THEN
     observer_value:=controlled_count_v1.observer_candidate(candidate_value.id,product_id_value,site_id_value);
     observers_value:=observers_value||jsonb_build_array(observer_value);
     EXIT WHEN jsonb_array_length(observers_value)=2;
    END IF;
   END LOOP;
   IF jsonb_array_length(observers_value)<>2 THEN
   RAISE EXCEPTION 'narcotics_recovery_two_observers_required' USING ERRCODE='PT409';END IF;
  END IF;
  scopes_value:=scopes_value||jsonb_build_array(scope_value||jsonb_build_object('boundary',boundary_value,
   'boundary_hash',narcotics_register_v1.hash('narcotics-recovery-physical-boundary-v1',boundary_value)));
  IF octet_length(scopes_value::text)>8388608 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 END LOOP;
 answer:=jsonb_build_object('inventory',inventory_value,'scopes',scopes_value);
 IF octet_length(answer::text)>8388608 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 RETURN answer;
END $$;
