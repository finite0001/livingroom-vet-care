"""Gate B preservation observations, never an expected metadata generator."""
from copy import deepcopy

import record_review_v3_gate_a_snapshot as retained
import record_review_v3_gate_b_descriptor as declaration

snapshot = retained.snapshot
baseline = retained.baseline
parse = retained.parse
under_barrier_check = retained.under_barrier_check
PARENT_RI_SQL = retained.PARENT_RI_SQL


def preserved(before, after, parent_ri, expected):
    for key in retained.KEYS - {'catalog', 'rows', 'types'}:
        assert after[key] == before[key], 'Original state changed: ' + key
    schema = declaration.SCHEMA
    assert set(after['rows']) == set(before['rows']) | {schema+'.'+n for n in declaration.TABLES}
    for name, rows in before['rows'].items():
        assert after['rows'][name] == rows, 'Original complete rows changed: ' + name
    old, new = deepcopy(before['catalog']), deepcopy(after['catalog'])
    assert set(new['schemas']) == set(old['schemas']) | {schema}
    del new['schemas'][schema]
    additions = set(new['functions']) - set(old['functions'])
    public = {'public.'+name+'(jsonb)' for name in declaration.FACADES}
    assert {name for name in additions if name.startswith('public.')} == public
    # Raw regprocedure keys can include a repeated schema qualification. Check
    # exact declared count and function names; the separate independent metadata
    # comparison checks every signature/body/ACL/attribute without normalization.
    assert len(additions) == len(expected['functions'])
    assert all(name in public or name.startswith(schema+'.') for name in additions)
    assert {new['functions'][name]['attributes']['proname'] for name in additions} == {
        signature.split('(', 1)[0].split('.')[1] for signature in expected['functions']}
    for name in additions:
        del new['functions'][name]
    relations = set(new['relations']) - set(old['relations'])
    assert relations == {schema+'.'+row['name'] for row in expected['relation_inventory']}
    for name in relations:
        del new['relations'][name]
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
            else:
                kept.append(trigger)
        relation['triggers'] = kept
    assert sorted(observed) == sorted(parent_ri)
    assert new == old, 'Original raw catalog/ACL changed outside two declared parent RI additions'
    assert all(after['types'].get(name) == value for name, value in before['types'].items())
    assert set(after['types']) - set(before['types']) == {schema+'.'+row['name'] for row in expected['types']}
