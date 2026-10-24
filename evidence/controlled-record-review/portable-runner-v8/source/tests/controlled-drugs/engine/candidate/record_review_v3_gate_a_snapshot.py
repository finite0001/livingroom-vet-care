"""Callback-only v3 structural snapshots; observations never become seal inputs."""
import copy
import json
import re

import canonical_post206 as retained
import record_review_v3_gate_a_descriptor as declaration

SCHEMAS = retained.SCHEMAS + ('controlled_review_v3',)
SCOPE = '(' + ','.join("'" + x + "'" for x in SCHEMAS) + ')'
assert retained.SNAPSHOT_SQL.count(retained.SCHEMA_SQL) == 5
SQL = retained.SNAPSHOT_SQL.replace(retained.SCHEMA_SQL, SCOPE)
SQL = SQL.replace('review_cli_catalog', 'v3_gate_catalog').replace('review_cli_rows', 'v3_gate_rows')
# Include the independent old private descriptor, not merely its live snapshot.
END = "'writers',(select jsonb_object_agg"
assert SQL.count(END) == 1
SQL = SQL.replace(END, "'private206',controlled_review.snapshot(),'private206_literal',(select jsonb_agg(to_jsonb(d))from controlled_review.descriptor d)," + END)
SETUP, VALUE = SQL.split("select jsonb_build_object('catalog',", 1)
VALUE = "jsonb_build_object('catalog'," + VALUE.removesuffix(';\n')
KEYS = {'catalog','rows','types','ledger','parent','parent_literal','parent_literal_hash_valid','writers','private206','private206_literal'}


def literal(value):
    return "'" + json.dumps(value, sort_keys=True, separators=(',', ':')).replace("'", "''") + "'::jsonb"


def parse(output):
    lines = [line for line in output.splitlines() if line.strip()]
    assert len(lines) == 1, 'Exactly one JSON output line required'
    value = json.loads(lines[0], object_pairs_hook=declaration.unique)
    assert isinstance(value, (dict, list)), 'JSON object or array required'
    return value


def primary_failure(result, code, message):
    """Require the intended primary server error, never echoed SQL/CONTEXT."""
    assert result.returncode != 0, 'Expected SQL refusal'
    primary = re.findall(r'^ERROR:\s+([A-Z0-9]{5}): ([^\r\n]+)$', result.stderr, re.MULTILINE)
    assert len(primary) == 1 and primary[0][0] == code, 'Exactly one primary SQLSTATE required'
    assert message and message in primary[0][1], 'Intended primary diagnostic required'
    return primary[0][1]


def snapshot(sql):
    value = parse(sql(SQL))
    assert set(value) == KEYS
    assert set(value['catalog']) == {'schemas','functions','relations'}
    assert {'public','auth','storage','extensions','supabase_migrations','controlled_review'} <= set(value['catalog']['schemas'])
    assert {'auth.users','auth.sessions','controlled_review.descriptor'} <= set(value['rows'])
    return value


def under_barrier_check(before):
    """Compare the complete pre-lock snapshot AFTER acquiring the owned barrier."""
    assert set(before) == KEYS
    return SETUP + 'do $v3_prelock$ begin if (' + VALUE + ') is distinct from ' + literal(before) + " then raise exception 'V3 original pre-lock snapshot changed' using errcode='23514';end if;end $v3_prelock$;\n"


def baseline(value, package):
    assert value['ledger'] == package['expected_ledger206']
    assert len(value['ledger']) == 206
    assert len(value['ledger'][-2]['statements']) == 94 and len(value['ledger'][-1]['statements']) == 304
    assert value['parent'] == package['expected']['parents']['parent205']['manifest']
    parent_raw=(declaration.SOURCE/declaration.PARENT_FILE).read_bytes()
    assert declaration.sha(parent_raw)==declaration.PARENT_SHA
    assert value['writers']==json.loads(parent_raw)['canonical_writer_definition_hashes']
    assert value['parent_literal_hash_valid'] is True
    assert len(value['parent_literal']) == 1 and value['parent_literal'][0]['revision'] == 1
    assert value['parent_literal'][0]['definition'] == value['parent']
    assert value['private206'] == package['expected']['parents']['private206']
    assert value['private206_literal'] == [{'id': True, 'definition': value['private206']}]
    for table in ('definitions','preparations','decisions','cancellations'):
        assert value['rows']['controlled_review.' + table] == []
    assert declaration.SCHEMA not in value['catalog']['schemas']
    for category in ('functions','relations'):
        for name in value['catalog'][category]:
            assert not any(name == 'public.'+facade or name.startswith('public.'+facade+'(') for facade in declaration.FACADES)
    assert not any('public.'+name in value['types'] for name in declaration.FACADES)


PARENT_RI_SQL = """select coalesce(jsonb_agg(t.oid order by t.oid),'[]')from pg_trigger t
 join pg_constraint c on c.oid=t.tgconstraint
 where c.connamespace='controlled_review_v3'::regnamespace and c.conname='obligations_event_fk'
 and c.conrelid='controlled_review_v3.obligations'::regclass
 and c.confrelid='public.controlled_stock_events'::regclass
 and t.tgrelid=c.confrelid and t.tgisinternal and t.tgenabled='O';"""


def preserved(before, after, parent_ri):
    for key in KEYS - {'catalog','rows','types'}:
        assert after[key] == before[key], 'Original state changed: '+key
    assert set(after['rows']) == set(before['rows']) | {declaration.SCHEMA+'.'+n for n in declaration.TABLES}
    for name, rows in before['rows'].items():
        assert after['rows'][name] == rows, 'Original complete rows changed: '+name
    old, new = copy.deepcopy(before['catalog']), copy.deepcopy(after['catalog'])
    assert set(new['schemas']) == set(old['schemas']) | {declaration.SCHEMA}
    del new['schemas'][declaration.SCHEMA]
    additions = set(new['functions']) - set(old['functions'])
    public = {'public.'+name+'(jsonb)' for name in declaration.FACADES}
    assert {name for name in additions if name.startswith('public.')} == public
    assert len(additions) == 19
    assert all(name in public or name.startswith(declaration.SCHEMA+'.') for name in additions)
    for name in additions: del new['functions'][name]
    relations = set(new['relations']) - set(old['relations'])
    assert len(relations) == 48 and all(name.startswith(declaration.SCHEMA+'.') for name in relations)
    for name in relations: del new['relations'][name]
    assert len(parent_ri) == len(set(parent_ri)) == 2
    observed = []
    for name, relation in new['relations'].items():
        kept = []
        for trigger in relation['triggers']:
            attributes = trigger['attributes']
            if attributes['oid'] in parent_ri:
                assert name == 'public.controlled_stock_events'
                assert attributes['tgisinternal'] and attributes['tgenabled'] == 'O'
                observed.append(attributes['oid'])
            else: kept.append(trigger)
        relation['triggers'] = kept
    assert sorted(observed) == sorted(parent_ri)
    assert new == old, 'Original selected raw catalogs/ACL changed outside two declared parent RI additions'
    assert all(after['types'].get(name) == value for name,value in before['types'].items())
    types = set(after['types']) - set(before['types'])
    assert len(types) == 26 and all(name.startswith(declaration.SCHEMA+'.') for name in types)
