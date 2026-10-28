"""Source-only projections; every current permission and lock check stays fresh.

The original literal plan is sealed before its namespace projection is used.
No runtime OID, permission, lock certificate or database observation is retained.
"""
import copy
import hashlib


def body(node):
    option, = [value for value in node.options if value.defname == 'as']
    if len(option.arg) != 1:
        raise ValueError('One exact original function body required')
    return option, option.arg[0].sval


def namespaces(rows, count):
    if len(rows) != count or any(len(row) != 5 for row in rows):
        raise ValueError('Complete fixed relation-plan rows required')
    if any(type(row[0]) is not str or type(row[1]) is not str or not row[0] or not row[1]
           or type(row[2]) is not int or row[2] != 6 or row[3:] != ('ShareRowExclusiveLock','SHARE ROW EXCLUSIVE') for row in rows):
        raise ValueError('Original literal schema/relation/mode values required')
    if len({row[:2] for row in rows}) != count:
        raise ValueError('Original relation-plan uniqueness required')
    return sorted({row[0] for row in rows})


def plan_projection(node, count):
    from pglast import ast, parse_sql
    from pglast.stream import RawStream
    from pglast.enums import SetOperation
    text = body(node)[1]
    statements = parse_sql(text)
    if len(statements) != 1 or not isinstance(statements[0].stmt, ast.SelectStmt):
        raise ValueError('One original pure VALUES statement required')
    query = statements[0].stmt
    forbidden = ('targetList','fromClause','whereClause','groupClause','havingClause','windowClause',
                 'distinctClause','sortClause','limitOffset','limitCount','withClause','intoClause','lockingClause','larg','rarg')
    if any(getattr(query,name) for name in forbidden) or query.op != SetOperation.SETOP_NONE or not query.valuesLists:
        raise ValueError('Literal relation plan cannot execute another query')
    rows=[]
    for values in query.valuesLists:
        row=[]
        for value in values:
            if not isinstance(value,ast.A_Const) or value.isnull:
                raise ValueError('Only original nonnull literal plan cells are admitted')
            if isinstance(value.val,ast.String):row.append(value.val.sval)
            elif isinstance(value.val,ast.Integer):row.append(value.val.ival)
            else:raise ValueError('Only original text/integer plan cells are admitted')
        rows.append(tuple(row))
    names=namespaces(rows,count)
    # Rebuild every parsed literal to reject extra executable AST properties.
    literal=lambda value: str(value) if type(value)is int else "'"+value.replace("'","''")+"'"
    reconstructed='VALUES '+','.join('('+','.join(literal(value)for value in row)+')'for row in rows)
    if RawStream()(parse_sql(reconstructed)[0].stmt)!=RawStream()(query):
        raise ValueError('Complete original VALUES AST inverse required')
    values=','.join("('"+name.replace("'","''")+"')"for name in names)
    return '(values'+values+')p(schema_name)',dict(rows=count,namespaces=names,plan_body_sha256=hashlib.sha256(text.encode()).hexdigest(),
        complete_VALUES_AST_inverse=True,distinct_namespace_projection_exact=True)


OLD_LOCK = """ ),resolved AS MATERIALIZED (
"""
NEW_LOCK = """ ),held_relations AS MATERIALIZED (
  select distinct l.relation,l.mode from held l where l.locktype='relation'
 ),resolved AS MATERIALIZED (
"""
OLD_EXISTS = "and exists(select 1 from held l where l.locktype='relation'and l.relation=r.relation_oid and l.mode=r.held_mode)"
NEW_EXISTS = 'and l.relation is not null'
OLD_FROM = 'into seen,unique_seen,valid,advisory_valid from resolved r;'
NEW_FROM = 'into seen,unique_seen,valid,advisory_valid from resolved r left join held_relations l on l.relation=r.relation_oid and l.mode=r.held_mode;'


def build(nodes):
    added={};proof={}
    for guard,plan,count in [('resource_origin_catalog_required','static_relation_plan_values',110),
                             ('shared_product_resource_origin_catalog_required','shared_product_relation_plan_values',121)]:
        signature='controlled_count_entry_v1.'+guard+'()'
        plan_signature='controlled_count_entry_v1.'+plan+'()'
        projection,plan_proof=plan_projection(nodes[plan_signature],count)
        node=copy.deepcopy(nodes[signature]);option,before=body(node)
        original='controlled_count_entry_v1.'+plan+'()p'
        if before.count(original)!=1 or before.count(plan_proof['plan_body_sha256'])!=1 or before.index(plan_proof['plan_body_sha256'])>before.index(original):
            raise ValueError('Original plan prosrc seal must dominate the exact namespace projection')
        after=before.replace(original,projection,1)
        if after.replace(projection,original,1)!=before:
            raise ValueError('Whole original live-origin guard inverse required')
        option.arg[0].sval=after;added[signature]=node
        proof[signature]=dict(plan=plan_proof,original_body_sha256=hashlib.sha256(before.encode()).hexdigest(),new_body_sha256=hashlib.sha256(after.encode()).hexdigest(),
            whole_body_inverse=True,original_plan_seal_and_all_current_privilege_checks_retained=True)
    signature='controlled_count_entry_v1.assert_shared_product_relation_frontier()'
    node=copy.deepcopy(nodes[signature]);option,before=body(node);after=before
    for original,replacement in ((OLD_LOCK,NEW_LOCK),(OLD_EXISTS,NEW_EXISTS),(OLD_FROM,NEW_FROM)):
        if after.count(original)!=1 or replacement in after:
            raise ValueError('Exact original one-snapshot frontier query required')
        after=after.replace(original,replacement,1)
    restored=after
    for original,replacement in reversed(((OLD_LOCK,NEW_LOCK),(OLD_EXISTS,NEW_EXISTS),(OLD_FROM,NEW_FROM))):
        restored=restored.replace(replacement,original,1)
    if restored!=before:
        raise ValueError('Whole original fresh-lock frontier inverse required')
    option.arg[0].sval=after;added[signature]=node
    proof[signature]=dict(original_body_sha256=hashlib.sha256(before.encode()).hexdigest(),new_body_sha256=hashlib.sha256(after.encode()).hexdigest(),
        whole_body_inverse=True,same_single_current_lock_snapshot=True,distinct_relation_mode_projection_prevents_join_multiplicity=True,
        all_121_resolved_relation_and_mode_checks_and_exact_advisory_check_retained=True)
    return added,proof
