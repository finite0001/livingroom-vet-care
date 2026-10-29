"""Source-bound parent-window projection; never a stored validity certificate."""
import copy
import hashlib
import json
from pathlib import Path

from frontier_projection import body

ROOT = Path(__file__).resolve().parents[2]
SIGNATURE = 'controlled_count_v1.reconciliation_live_causes(jsonb)'
ORIGINAL = 'controlled_count_v1.product_live_causes(uuid)'
EVIDENCE = 'docs/controlled-drugs/product-history-readcut-20261028.json'
EVIDENCE_SHA = 'dec62055c55799969eeb3b198cf8d3e284374b682aca15f3b9c4c3034772f910'


def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()


def derive(nodes):
    from pglast.stream import RawStream

    if SIGNATURE in nodes:
        raise ValueError('One new source-derived parent projection required')
    original = nodes[ORIGINAL]
    node = copy.deepcopy(original)
    option, before = body(node)
    declaration = 'declare item record;cause_doc jsonb;resolution_doc jsonb;resolution_value uuid;'
    scoped_declaration = 'declare p_product uuid;context_value jsonb;scope_value jsonb;item record;cause_doc jsonb;resolution_doc jsonb;resolution_value uuid;'
    history = ' perform controlled_count_v1.product_count_history_required(p_product);\n'
    guard = """ -- The original context birth/operating scans dominate this unchanged
 -- count-data window. This helper does not certify or cache history validity.
 select to_jsonb(c)into strict context_value from public.controlled_stock_execution_contexts c
 where c.backend_pid=pg_backend_pid();
 scope_value:=controlled_count_entry_v1.current_count_context_header_required(context_value);
 perform controlled_count_entry_v1.assert_scope_resource_frontier(scope_value);
 if scope_value::text is distinct from p_scope::text
 or scope_value->>'outer_action'is distinct from 'reconciliation_execute'
 or(context_value->>'phase'=any(array['count_operating','executing']))is not true
 or exists(select 1 from controlled_count_v1.operations o where o.operation_id=(scope_value->>'outer_operation_id')::uuid)
 or exists(select 1 from controlled_count_v1.operation_closures o where o.operation_id=(scope_value->>'outer_operation_id')::uuid)then
  raise exception 'count_context_invalid'using errcode='P0001',detail='',hint='';end if;
 p_product:=(scope_value->>'product_id')::uuid;
"""
    comment = """   -- The SAME preceding complete first inventory selected this exact registry
   -- root and finished its graph+closure. A document product claim alone is
   -- insufficient: an orphan can be absent from joined result inventories.
"""
    scoped_comment = """   -- Original context scans selected this exact registry root and finished
   -- its graph/closure. Sealed parent control flow and held relations exclude
   -- count-data writes in this window; orphan history already refused entry.
"""
    replacements = [(declaration, scoped_declaration), (history, guard), (comment, scoped_comment)]
    after = before
    for old, new in replacements:
        if after.count(old) != 1 or new in after:
            raise ValueError('One exact original parent projection anchor required')
        after = after.replace(old, new, 1)
    restored = after
    for old, new in reversed(replacements):
        if restored.count(new) != 1:
            raise ValueError('One exact successor projection anchor required')
        restored = restored.replace(new, old, 1)
    if restored != before:
        raise ValueError('Complete original live projection inverse required')
    option.arg[0].sval = after
    if len(node.parameters) != 1 or node.parameters[0].name != 'p_product':
        raise ValueError('Original single-product projection header required')
    node.funcname[-1].sval = 'reconciliation_live_causes'
    node.parameters[0].name = 'p_scope'
    parent = nodes['controlled_count_v1.reconciliation_parent_source_required(jsonb,text)']
    if parent.parameters[0].name != 'p_scope':
        raise ValueError('Original source scope argument required')
    node.parameters[0].argType = copy.deepcopy(parent.parameters[0].argType)
    extra = [copy.deepcopy(value) for value in parent.options
             if value.defname == 'set' and value.arg.name.lower() != 'search_path']
    if {value.arg.name.lower() for value in extra} != {'timezone', 'datestyle', 'intervalstyle', 'extra_float_digits'}:
        raise ValueError('Exact source context serialization settings required')
    as_index, = [index for index, value in enumerate(node.options) if value.defname == 'as']
    node.options = tuple(node.options[:as_index]) + tuple(extra) + tuple(node.options[as_index:])
    inverse = copy.deepcopy(node)
    inverse.funcname = copy.deepcopy(original.funcname)
    inverse.parameters = copy.deepcopy(original.parameters)
    inverse.options = tuple(inverse.options[:as_index]) + tuple(inverse.options[as_index + len(extra):])
    body(inverse)[0].arg[0].sval = restored
    if RawStream()(inverse) != RawStream()(original):
        raise ValueError('Complete original projection AST/header inverse required')
    return node, dict(original=ORIGINAL, derived=SIGNATURE,
                      original_body_sha256=sha(before), derived_body_sha256=sha(after),
                      whole_body_inverse=True, whole_AST_header_inverse=True,
                      actual_context_scope_phase_and_fresh_header_required=True,
                      existing_outer_operation_and_closure_refused=True,
                      only_full_history_replay_removed=True,
                      all_original_live_projection_checks_and_caps_retained=True,
                      original_full_helper_unchanged=True,
                      replacements=replacements)


def verify_cut(nodes, changed, parent_predecessor):
    """Bind audited read/control-flow facts to actual final source bodies."""
    from pglast import ast, parse_sql

    raw = (ROOT / EVIDENCE).read_bytes()
    if hashlib.sha256(raw).hexdigest() != EVIDENCE_SHA:
        raise ValueError('Exact independent history read-cut evidence required')
    evidence = json.loads(raw)
    if (evidence['node_count'] != 299 or len(evidence['application_read_relations']) != 15
            or evidence['static_plan_relation_count'] != 111
            or any(evidence[name] for name in ('noncount_application_read_relations', 'parse_failures',
                    'source_expected_body_mismatches', 'noncatalog_reads_missing_from_held_static_plan',
                    'effect_or_auth_time_matches'))):
        raise ValueError('Complete immutable-count read cut required')
    by_name = {}
    for signature, node in {**nodes, **changed}.items():
        by_name.setdefault(signature.split('(', 1)[0], []).append(node)
    # This one public pure text primitive belongs to original immutable205.
    public_name = 'public.controlled_stock_text'
    if public_name not in by_name:
        source = (ROOT / 'supabase/migrations/20261020151157_controlled_stock_private_engine.sql').read_text()
        by_name[public_name] = [row.stmt for row in parse_sql(source)
                               if isinstance(row.stmt, ast.CreateFunctionStmt)
                               and '.'.join(part.sval for part in row.stmt.funcname) == public_name]

    def require(name, expected, override=None):
        choices = by_name.get(name, [])
        if len(choices) != 1:
            raise ValueError('One source-bound read-cut function required: ' + name)
        actual = override if override is not None else body(choices[0])[1]
        if sha(actual) != expected:
            raise ValueError('Audited source read/control-flow body changed: ' + name)

    for item in evidence['nodes']:
        require(item['name'], item['body_sha256'])
    for item in evidence['parent_slice_source_pins']:
        override = parent_predecessor if item['name'] == 'controlled_count_v1.reconciliation_parent_source_required' else None
        require(item['name'], item['body_sha256'], override)
    plan = {**nodes, **changed}['controlled_count_entry_v1.static_relation_plan_values()']
    rows = parse_sql(body(plan)[1])[0].stmt.valuesLists
    held = {row[0].val.sval + '.' + row[1].val.sval for row in rows if row[2].val.ival == 6}
    if len(rows) != 111 or not set(evidence['application_read_relations']) <= held:
        raise ValueError('Every audited count read must remain in initial held frontier')
    return dict(evidence=EVIDENCE, sha256=EVIDENCE_SHA, bound_history_functions=299,
                bound_parent_context_functions=len(evidence['parent_slice_source_pins']),
                application_read_relations=evidence['application_read_relations'],
                all_history_reads_held_and_unchanged_during_parent=True,
                no_current_public_stock_journal_or_Auth_read_in_history=True,
                no_runtime_validity_flag_or_queue_absence_certificate=True)
