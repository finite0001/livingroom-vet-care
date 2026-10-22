"""Full same-database private206 preservation and exact canonical ledger checks.

Observations are retained evidence, never seal expectations. No connection or
process is created here. Every original row, ACL and actual trigger participates.
"""
import copy
import json
import re

import cli_atomicity as old_atomic
from secondary_review_cli_body import check_cli_body
from secondary_review_release import parent_checks_sql, installed_checks_sql

SCHEMAS = ('public','auth','storage','extensions','supabase_migrations',
           'controlled_review','controlled_review_cli_fixture')
SCHEMA_SQL = '(' + ','.join("'" + s + "'" for s in SCHEMAS) + ')'
# Widen every existing catalog selector; do not weaken any original field or
# filter internal triggers. Same-database OIDs remain part of rollback proof.
CATALOG_SQL, _selector_count = re.subn(r"n\.nspname in\([^)]*\)",
    'n.nspname in' + SCHEMA_SQL, old_atomic.CATALOG_SQL)
assert _selector_count == 3
CATALOG_SQL = CATALOG_SQL.replace('cli_atomicity_catalog','review_cli_catalog')
ROWS_SQL = r"""
create function pg_temp.review_cli_rows()returns jsonb language plpgsql as $rows$
declare r record;v jsonb;answer jsonb:='{}';begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in __SCHEMAS__ and c.relkind in('r','p')order by 1,2 loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text),''[]'')from %I.%I t',r.nspname,r.relname)into v;
  answer:=answer||jsonb_build_object(r.nspname||'.'||r.relname,v);
 end loop;return answer;end$rows$;
""".replace('__SCHEMAS__',SCHEMA_SQL)
SNAPSHOT_SQL = "set timezone='UTC';\n" + CATALOG_SQL + ROWS_SQL + r"""
select jsonb_build_object('catalog',pg_temp.review_cli_catalog(),'rows',pg_temp.review_cli_rows(),
 'types',(select coalesce(jsonb_object_agg(n.nspname||'.'||t.typname,jsonb_build_object('attributes',to_jsonb(t),
  'enum',(select coalesce(jsonb_agg(to_jsonb(e)order by e.enumsortorder),'[]')from pg_enum e where e.enumtypid=t.oid),
  'constraints',(select coalesce(jsonb_agg(to_jsonb(c)order by c.conname),'[]')from pg_constraint c where c.contypid=t.oid))),'{}')from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in __SCHEMAS__),
 'ledger',(select jsonb_agg(to_jsonb(m)order by version)from supabase_migrations.schema_migrations m),
 'parent',public.controlled_stock_manifest_snapshot(),
 'parent_literal',(select jsonb_agg(to_jsonb(m))from public.controlled_stock_engine_manifests m),
 'parent_literal_hash_valid',(select count(*)=1 and bool_and(revision=1 and definition_hash=public.controlled_stock_hash(definition))from public.controlled_stock_engine_manifests),
 'writers',(select jsonb_object_agg(signature,encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(signature)),'UTF8')),'hex'))from public.stock_writer_manifests));
""".replace('__SCHEMAS__',SCHEMA_SQL)


def digest(value):
    import hashlib
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def snapshot(sql):
    lines = [s for s in sql(SNAPSHOT_SQL).splitlines() if s.strip()]
    assert len(lines) == 1, 'Exactly one full snapshot required'
    value = json.loads(lines[0])
    assert set(value) == {'catalog','rows','types','ledger','parent','parent_literal','parent_literal_hash_valid','writers'}
    assert set(value['catalog']) == {'schemas','functions','relations'}
    assert {'public','auth','storage','extensions','supabase_migrations'} <= set(value['catalog']['schemas'])
    assert {'auth.users','auth.sessions','supabase_migrations.schema_migrations'} <= set(value['rows'])
    return value


def verify_reference205(value, package, parent):
    assert value['ledger'] == package['expected_ledger'], 'Actual complete205 ledger differs from source-derived expectation'
    assert len(value['ledger']) == 205 and len(value['ledger'][-1]['statements']) == 94
    assert value['parent'] == parent['expected_technical_manifest']
    assert value['writers'] == parent['canonical_writer_definition_hashes']
    assert value['parent_literal_hash_valid'] is True
    assert len(value['parent_literal'])==1
    row=value['parent_literal'][0]
    assert set(row)=={'revision','definition','definition_hash','recorded_at'}
    assert row['revision']==1 and row['definition']==parent['expected_technical_manifest']
    assert re.fullmatch('[0-9a-f]{64}',row['definition_hash'])
    facade_names={name.removeprefix('public.').split('(')[0]for name in package['expected']['functions']if name.startswith('public.')}
    for category in ('functions','relations'):
        for name in value['catalog'][category]:
            assert not any(name.startswith('public.'+facade+'(')or name=='public.'+facade for facade in facade_names),'Partial review public facade collision'
    assert not any('public.'+facade in value['types']for facade in facade_names),'Partial review facade type collision'
    assert 'controlled_review' not in value['catalog']['schemas']
    assert 'controlled_review_cli_fixture' not in value['catalog']['schemas']
    return {'kind':'controlled-review-cli205-reference-v1','passed':True,
            'actual_ledger_sha256':digest(value['ledger']), 'baseline_sha256':digest(value),
            'ledger_rows':205,'retained205_statement_count':94}


def verify_ledger206(actual, original, binding):
    assert len(original) == 205 and len(original[-1]['statements']) == 94
    assert len(actual) == 206 and actual[:205] == original, 'Original205 ledger rows changed'
    expected = dict(version=binding['version'],name=binding['name'],statements=binding['expected_statements'])
    assert len(expected['statements']) == 304 and actual[-1] == expected, 'Exact pinned206 ledger required'
    return digest(expected)


def original_preserved(before, after, facades, added_ri):
    """Permit only the independently sealed package and its exact FK triggers."""
    verify_ledger206(after['ledger'],before['ledger'],facades['binding'])
    for key in ('parent','parent_literal','parent_literal_hash_valid','writers'):
        assert after[key] == before[key], 'Frozen parent changed: ' + key
    # SQL jsonb textual key ordering is not Python's ordering; compare ledger via
    # its exact version-ordered field and every other full relation verbatim.
    for name,rows in before['rows'].items():
        if name != 'supabase_migrations.schema_migrations':
            assert after['rows'].get(name) == rows, 'Original source rows changed: ' + name
    assert set(after['rows'])-set(before['rows']) == {'controlled_review.'+n for n in ('descriptor','definitions','preparations','decisions','cancellations')}
    old,new = copy.deepcopy(before['catalog']),copy.deepcopy(after['catalog'])
    assert set(new['schemas'])-set(old['schemas']) == {'controlled_review'}
    del new['schemas']['controlled_review']
    added_functions = set(new['functions'])-set(old['functions'])
    public_added = {n for n in added_functions if n.startswith('public.')}
    assert public_added == {'public.'+n for n in facades['names']}
    assert all(n.startswith('controlled_review.') or n in public_added for n in added_functions)
    for name in added_functions:del new['functions'][name]
    added_relations=set(new['relations'])-set(old['relations'])
    assert added_relations and all(n.startswith('controlled_review.')for n in added_relations)
    for name in added_relations:del new['relations'][name]
    assert len(added_ri)==14 and len(set(added_ri))==14
    observed=[]
    for name,relation in new['relations'].items():
        kept=[]
        for trigger in relation['triggers']:
            a=trigger['attributes']
            if a['oid'] in added_ri:
                assert name.startswith('public.')and a['tgisinternal'] and a['tgenabled']=='O'
                observed.append(a['oid'])
            else:kept.append(trigger)
        relation['triggers']=kept
    assert sorted(observed)==sorted(added_ri)
    assert new==old,'Original raw metadata/ACL changed outside exact sealed additions'
    old_types=before['types'];new_types=after['types']
    assert all(new_types.get(k)==v for k,v in old_types.items()),'Original types changed'
    assert all(k.startswith('controlled_review.') for k in set(new_types)-set(old_types))


FACADE_NAMES = frozenset((
    'prepare_controlled_secondary_review','read_controlled_secondary_review',
    'execute_controlled_secondary_review','cancel_controlled_secondary_review',
    'read_controlled_secondary_review_event','list_controlled_secondary_reviews'))


def facade_regprocedures(expected):
    # The independent descriptor uses pg_get_function_identity_arguments
    # (including the parameter name); raw pg_proc identity uses regprocedure
    # (types only). This finite source mapping never reads the observed catalog.
    declared={key for key in expected['functions']if key.startswith('public.')}
    assert declared=={'public.'+name+'(p_request jsonb)'for name in FACADE_NAMES}, 'Exact six named-argument facade declarations required'
    normalized={key.removeprefix('public.').removesuffix('(p_request jsonb)')+'(jsonb)'for key in declared}
    assert len(normalized)==6
    return sorted(normalized)


def verify_installed(sql, source, before, binding, parent):
    package=check_cli_body(source)
    sql(parent_checks_sql(parent)+installed_checks_sql(package['expected']))
    value=snapshot(sql)
    raw=sql("select coalesce(jsonb_agg(t.oid order by t.oid),'[]')from pg_trigger t join pg_constraint c on c.oid=t.tgconstraint join pg_class child on child.oid=c.conrelid join pg_namespace n on n.oid=child.relnamespace join pg_class owner on owner.oid=t.tgrelid join pg_namespace ons on ons.oid=owner.relnamespace where n.nspname='controlled_review'and ons.nspname='public'and t.tgisinternal;")
    ri=json.loads(raw.strip())
    names=facade_regprocedures(package['expected'])
    original_preserved(before,value,{'names':names,'binding':binding},ri)
    return value
