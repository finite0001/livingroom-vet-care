"""Source-only mandatory-work delta; no cached validity or target observations.

The disabled compiler remains the complete V45 predecessor. Every changed body
below has an exact inverse; final metadata is generated after this delta.
"""
import copy
import hashlib
import re

from frontier_projection import body, plan_projection
from history_document_reuse import code_mask


FACT_TABLES = ('operations', 'cycles', 'snapshots', 'statements', 'outcomes',
               'cancellations', 'causes', 'open_causes', 'resolutions',
               'reconciliation_preparations', 'reconciliation_approvals',
               'reconciliation_executions', 'reconciliation_confirmations',
               'reconciliation_execution_causes')
NEW_FUNCTIONS = {'controlled_count_v1.' + name + '()' for name in (
    'pending_scope_required', 'collect_pending_product', 'pending_product_write_guard',
    'pending_product_delete_guard', 'flush_pending_product')}
NEW_TRIGGERS = {('controlled_count_v1.' + name, 'count_pending_product') for name in FACT_TABLES} | {
    ('controlled_count_v1.pending_products', name) for name in (
        'pending_product_insert_update', 'pending_product_no_truncate',
        'pending_product_validate_delete', 'pending_product_consistency')}
ENTRY = 'controlled_count_entry_v1.'
QUEUE = 'controlled_count_v1.pending_product_consistency'
PLAN_ROW = " ('controlled_count_v1','pending_products',6,'ShareRowExclusiveLock','SHARE ROW EXCLUSIVE'),\n"
PLAN_ANCHOR = " ('controlled_count_v1','policies',6,'ShareRowExclusiveLock','SHARE ROW EXCLUSIVE'),\n"
OLD_GLOBAL = """ -- Compare complete unresolved cause rows against the actual four-column live
 -- projection after every scoped write, including a resolution's DELETE.
 -- This callback needs the held frontier and retained complete graph, not a
 -- live count context, so final ALL IMMEDIATE after context deletion is safe.
 perform controlled_count_v1.product_live_causes(product_value);
"""
NEW_GLOBAL = """ -- Every admitted fact mutation immediately collects mandatory product work.
 -- Its guarded deletion unconditionally checks the complete CURRENT product
 -- before structural forcing can finish. Row-specific checks above remain.
"""


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def replace_exact(text, old, new):
    if not old or text.count(old) != 1 or new in text:
        raise ValueError('One exact predecessor source anchor required')
    result = text.replace(old, new, 1)
    if result.replace(new, old, 1) != text:
        raise ValueError('Whole predecessor body inverse required')
    return result


def build(nodes):
    changed = {}; proofs = {}

    def change(signature, replacements):
        node = copy.deepcopy(nodes[signature]); option, before = body(node)
        after = before
        for old, new in replacements:
            after = replace_exact(after, old, new)
        restored = after
        for old, new in reversed(replacements):
            if restored.count(new) != 1:
                raise ValueError('One complete successor source anchor required')
            restored = restored.replace(new, old, 1)
        if restored != before:
            raise ValueError('Complete predecessor source inverse required')
        option.arg[0].sval = after; changed[signature] = node
        proofs[signature] = dict(original_body_sha256=sha(before), new_body_sha256=sha(after),
                                 whole_body_inverse=True, replacements=replacements)
        return node

    for plan, guard, count in (
            ('static_relation_plan_values', 'resource_origin_catalog_required', 110),
            ('shared_product_relation_plan_values', 'shared_product_resource_origin_catalog_required', 121),
            ('stock_workflow_relation_plan_values', 'stock_workflow_resource_origin_catalog_required', 121)):
        signature = ENTRY + plan + '()'
        before_projection, before = plan_projection(nodes[signature], count)
        anchor = PLAN_ANCHOR if count == 110 else "('controlled_count_v1', 'policies', 6, 'ShareRowExclusiveLock', 'SHARE ROW EXCLUSIVE'), "
        row = PLAN_ROW if count == 110 else "('controlled_count_v1', 'pending_products', 6, 'ShareRowExclusiveLock', 'SHARE ROW EXCLUSIVE'), "
        node = change(signature, [(anchor, row + anchor)])
        after_projection, after = plan_projection(node, count + 1)
        if before_projection != after_projection or before['namespaces'] != after['namespaces']:
            raise ValueError('New relation cannot expand the original namespace cut')
        change(ENTRY + guard + '()', [(before['plan_body_sha256'], after['plan_body_sha256'])])

    for name, old, new in (
            ('assert_static_relation_frontier', 'if seen<>110 then', 'if seen<>111 then'),
            ('assert_shared_product_relation_frontier', 'if seen<>121 or unique_seen<>121', 'if seen<>122 or unique_seen<>122'),
            ('assert_stock_workflow_relation_frontier', 'if seen<>121 then', 'if seen<>122 then'),
            ('acquire_shared_product_relation_frontier', 'if seen<>121 then', 'if seen<>122 then'),
            ('acquire_stock_workflow_relation_frontier', 'if seen<>121 then', 'if seen<>122 then'),
            ('assert_count_subset_of_complete_product_kernel', '())<>110', '())<>111')):
        change(ENTRY + name + '()', [(old, new)])
    change(ENTRY + 'begin_count_context(jsonb)', [(
        ' perform controlled_count_entry_v1.scope_values(p_scope);',
        ' SET CONSTRAINTS ' + QUEUE + ' DEFERRED;\n perform controlled_count_entry_v1.scope_values(p_scope);')])
    change(ENTRY + 'force_count_structural_checks()', [(
        'controlled_count_v1.count_graph_consistency immediate;',
        'controlled_count_v1.count_graph_consistency,' + QUEUE + ' immediate;')])
    change('controlled_stock_workflow_v1.witness_121_required()', [('())<>121', '())<>122')])
    # Both shared-acquisition exits invoke the sealed recovery post-check.
    # Its present-module branch checks the full count metadata before returning.
    # The already held admission lock excludes supported209 installation until
    # this transaction ends, so absence cannot become presence in this slice.
    post = body(nodes[ENTRY + 'recovery_post_frontier_required()'])[1]
    absent = " IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='narcotics_recovery_v1')THEN RETURN;END IF;"
    full = ' PERFORM controlled_count_entry_v1.require_bound_module();'
    if post.count(absent) != 1 or post.count(full) != 1 or post.index(absent) > post.index(full):
        raise ValueError('Exact absent-only return and full present recovery metadata check required')
    if len(re.findall(r'\breturn\b', code_mask(post), re.I)) != 1 or post.index(full) > post.index('head_value:='):
        raise ValueError('Present recovery cannot return or read its head before complete metadata admission')
    acquisition = body(changed[ENTRY + 'acquire_shared_product_relation_frontier()'])[1]
    if acquisition.count('PERFORM controlled_count_entry_v1.recovery_post_frontier_required();') != 2:
        raise ValueError('Both original source-acquisition exits must run the recovery post-check')
    old = """ perform controlled_count_entry_v1.acquire_static_relation_frontier();
 -- Exactly one whole metadata check, after real held frontier and before user/current-principal/saved reads.
 perform controlled_count_entry_v1.assert_read_frontier();
 perform controlled_count_entry_v1.require_bound_module();"""
    new = """ perform controlled_count_entry_v1.acquire_static_relation_frontier();
 -- The sealed recovery post-check just checked full metadata when209 exists.
 -- Its admission lock also excludes concurrent supported209 installation.
 perform controlled_count_entry_v1.assert_read_frontier();
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='narcotics_recovery_v1')THEN
 perform controlled_count_entry_v1.require_bound_module();END IF;"""
    dispatch_graph = " perform controlled_count_v1.validate_operation_graph((q->>'operation_id')::uuid);"
    dispatch_closure = """ -- Store and its unchanged BEFORE INSERT guard both fully checked v3.
 -- Check the newly stored closure now; final product forcing checks ALL graphs.
 perform controlled_count_v1.operation_closure_required((q->>'operation_id')::uuid);
 perform controlled_count_entry_v1.assert_read_frontier();"""
    change('controlled_count_v1.dispatch_count_management_mutation(text,jsonb)',
           [(old, new), (dispatch_graph, dispatch_closure)])
    parent_signature = 'controlled_count_v1.reconciliation_parent_source_required(jsonb,text)'
    parent_source = body(nodes[parent_signature])[1]
    if sha(parent_source) != '0b6cc89f3ee5129087ef9421ee98acd2d2e087fcf596689451f217fc53b993a2':
        raise ValueError('Reviewed read-only parent source closure required')
    if re.search(r'\breturn\b|\bexception\s+when\b', code_mask(parent_source), re.I):
        raise ValueError('Parent scan must dominate every successful stage completion')
    closing_signature = 'controlled_count_v1.entry_context_source_required(text,jsonb,jsonb)'
    before_parent = "\n   perform controlled_count_v1.reconciliation_parent_source_required(scope_value,'before');\n"
    after_parent = "\n   perform controlled_count_v1.reconciliation_parent_source_required(scope_value,'after');\n"
    global_tail = " perform controlled_count_v1.product_live_causes((scope_value->>'product_id')::uuid);\nend "
    queued_tail = """ -- Closing retains every operation/context/result/principal check above.
 -- Actual fact collectors require a full guarded product check before finish.
 IF p_operation IS DISTINCT FROM 'DELETE' AND new_phase IS DISTINCT FROM 'count_finishing' THEN
 perform controlled_count_v1.product_live_causes((scope_value->>'product_id')::uuid);
 END IF;
end """
    change(closing_signature, [
        (before_parent, before_parent.replace(';\n', ';return;\n', 1)),
        (after_parent, after_parent.replace(';\n', ';return;\n', 1)),
        ("  perform controlled_count_v1.validate_operation_graph((scope_value->>'outer_operation_id')::uuid);\n",
         "  -- The mandatory guarded product flush checks this complete graph.\n"),
        ("  -- The unchanged validator above has just checked this complete immutable\n  -- result, registry, children, cause and closure under the same held frontier.",
         "  -- Retain the actual result and every context/operation/scope binding.\n  -- Complete graph/closure validation is mandatory before context deletion."),
        (global_tail, queued_tail)])
    change('controlled_count_v1.operation_closure_deferred()', [(
        " if c->>'state'='saved'then perform controlled_count_v1.validate_operation_graph_v3(NEW.operation_id);\n perform controlled_count_entry_v1.assert_read_frontier();end if;",
        " -- The unconditional pending-product guard checks every saved graph.\n if c->>'state'='saved'then perform controlled_count_entry_v1.assert_read_frontier();end if;")])
    change(ENTRY + 'finish_count_context()', [(
        " -- The BEFORE UPDATE source guard validates the complete immutable operation\n -- and result/cause/membership graph BEFORE this phase can become finishing.",
        " -- The BEFORE UPDATE source guard retains current authority and exact\n -- operation/result bindings. Mandatory forcing below checks the COMPLETE\n -- graph, saved closures and live membership BEFORE context deletion.")])
    # Reuse only PURE policy grammar/hash already established by the closed
    # invocation-local constructors. Exact row/cache/input bytes still agree.
    policy_signature = 'controlled_count_v1.history_scan_policy_values(jsonb,jsonb)'
    policy_before = body(nodes[policy_signature])[1]
    arm_start = policy_before.index(' if exists(\n  select 1 from controlled_count_v1.policies policy_row')
    arm_end = policy_before.index('  union all\n', arm_start)
    old_arm = policy_before[arm_start:arm_end]
    hash_check = '   and controlled_count_v1.document_hash(p_document)=policy_row.record_hash\n'
    lookup = "where policy_row.policy_id::text=p_document->>'policy_id'"
    indexed = "where policy_row.policy_id=CASE WHEN controlled_count_v1.count_wire_uuid(p_document->'policy_id')THEN(p_document->>'policy_id')::uuid ELSE NULL::uuid END"
    if old_arm.count(hash_check) != 1 or old_arm.count(lookup) != 1:
        raise ValueError('One exact admitted policy-cache arm required')
    new_arm = old_arm.replace(hash_check, '', 1).replace(lookup, indexed, 1)
    policy_node = change(policy_signature, [(old_arm, new_arm)])
    policy_after = body(policy_node)[1]
    if policy_after.split('  union all\n', 1)[1] != policy_before.split('  union all\n', 1)[1]:
        raise ValueError('Snapshot-cache hash and complete original fallback must remain exact')
    change('controlled_count_v1.count_graph_deferred()', [(OLD_GLOBAL, NEW_GLOBAL)])
    return changed, dict(
        predecessor='V45 source composition', body_inverses=proofs,
        predecessor_history_and_frontier_proofs_are_intermediate=True,
        previous_same_callback_global_validation_proof_superseded=True,
        final_global_validation='unconditional pending BEFORE DELETE guard',
        fact_tables=list(FACT_TABLES), new_private_functions=sorted(NEW_FUNCTIONS),
        new_trigger_identities=sorted(NEW_TRIGGERS),
        no_validity_certificate=True, unchanged_final_ALL_IMMEDIATE=True,
        context_scan_schedule=dict(
            source_function=closing_signature, parent_source_function=parent_signature,
            reviewed_parent_body_sha256=sha(parent_source),
            predecessor_readonly_closure_sha256='2c765dae3922ca5032ed4e046d0aad7e1f813f6c0137f0a4d7dfe03913390ccc',
            parent_stages_keep_their_complete_scan=True,
            only_immediately_dominated_outer_parent_scans_removed=True,
            closing_product_scan_required_by_guarded_pending_delete=True,
            original_operation_context_result_principal_bindings_unchanged=True,
            closing_graph_checks_assigned_to_mandatory_product_flush=True,
            saved_closure_deferred_graph_assigned_to_mandatory_product_flush=True,
            dispatcher_post_store_checks_new_closure_and_fresh_frontier=True,
            both_original_pre_publication_v3_checks_retained=True,
            policy_publication_and_abandoned_closure_lanes_unchanged=True),
        policy_pure_hash_reuse=dict(
            source_function=policy_signature, first_arm_only=True,
            exact_current_row_cache_input_text_and_scope_bindings_retained=True,
            snapshot_arm_and_original_fallback_byte_identical=True,
            constructors='original policy_history followed by root seeding; four helpers call original policy_values before seeding',
            admitted_private_source_owned_maps_only=True,
            arbitrary_owner_supplied_private_input_equivalence_claimed=False,
            indexed_uuid_lookup_has_guarded_cast=True),
        immediate_metadata_dominance=dict(
            dispatcher='controlled_count_v1.dispatch_count_management_mutation(text,jsonb)',
            present_branch_full_check=ENTRY + 'recovery_post_frontier_required()',
            full_check_body_sha256=sha(post), both_acquisition_exits_checked=True,
            standalone208_check_retained=True, admission_lock_excludes_supported209_installation=True,
            no_intervening_domain_or_identity_reads=True, all_session_epoch_and_history_checks_retained=True),
        original_authorization_row_guards_and_full_product_validator_unchanged=True)
