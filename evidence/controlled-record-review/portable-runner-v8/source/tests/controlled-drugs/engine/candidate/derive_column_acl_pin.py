"""Pure, allowlisted derivation from independently verified released286 data.

This module never connects to a database or captures an expected installation.
The caller supplies the retained old pin, old/new SQL and OLD-release supplement.
"""
import copy
import hashlib
import json

PARENT_PIN_SHA256 = '747813bb6dc4fa39213eb58eeb6515b0569ce0aac3eb171276e609e29f40c72d'
SNAPSHOT_SIGNATURE = 'controlled_stock_manifest_snapshot()'
SEAL_PATH = 'tests/controlled-drugs/engine/candidate/seal.sql'
ACL_FIELDS = {'grantee', 'grantor', 'privilege', 'grantable'}
PRIVILEGES = {'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'}
OLD_COLUMN_FRAGMENT = "    'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid))order by a.attnum)"
NEW_COLUMN_FRAGMENT = '    \'not_null\',a.attnotnull,\'identity\',a.attidentity,\'generated\',a.attgenerated,\'default\',pg_get_expr(d.adbin,d.adrelid),\n    \'column_acl\',(select coalesce(jsonb_agg(jsonb_build_object(\n     \'grantee\',case when x.grantee=0 then \'PUBLIC\'else pg_get_userbyid(x.grantee)end,\n     \'grantor\',pg_get_userbyid(x.grantor),\'privilege\',x.privilege_type,\'grantable\',x.is_grantable)\n     order by(case when x.grantee=0 then \'PUBLIC\'else pg_get_userbyid(x.grantee)end)collate "C",\n      pg_get_userbyid(x.grantor)collate "C",x.privilege_type collate "C",x.is_grantable),\'[]\'::jsonb)\n     from aclexplode(a.attacl)x))order by a.attnum)'


def _sha(value):
    return hashlib.sha256(value).hexdigest()


def validate_column_acl_manifest(expected):
    assert isinstance(expected, dict) and type(expected.get('version')) is int and expected['version'] == 2
    assert isinstance(expected.get('relations'), dict) and expected['relations']
    for relation in expected['relations'].values():
        assert isinstance(relation, dict) and isinstance(relation.get('columns'), list) and relation['columns']
        for column in relation['columns']:
            assert isinstance(column, dict) and isinstance(column.get('column_acl'), list), 'Exact column ACL array required'
            seen = set()
            keys = []
            for acl in column['column_acl']:
                assert isinstance(acl, dict) and set(acl) == ACL_FIELDS
                for role in ('grantee', 'grantor'):
                    assert isinstance(acl[role], str) and acl[role] and '\x00' not in acl[role], 'Role names, never OIDs, required'
                assert isinstance(acl['privilege'], str) and acl['privilege'] in PRIVILEGES and type(acl['grantable']) is bool
                identity = (acl['grantee'], acl['grantor'], acl['privilege'])
                assert identity not in seen, 'Duplicate column ACL privilege'
                seen.add(identity)
                keys.append(tuple(value.encode('utf-8') for value in identity) + (acl['grantable'],))
            assert keys == sorted(keys), 'Column ACLs require canonical C byte ordering'
    return expected


def snapshot_function_definition(seal_sql):
    """Known PostgreSQL17 rendering; the old checksum must prove this template."""
    start = 'create function public.controlled_stock_manifest_snapshot()returns jsonb\n'
    assert seal_sql.count(start) == 1
    rest = seal_sql.split(start, 1)[1]
    assert rest.startswith('language sql volatile set search_path=public,pg_temp as $$')
    body = rest.split('$$', 2)[1]
    return ('CREATE OR REPLACE FUNCTION public.controlled_stock_manifest_snapshot()\n'
            ' RETURNS jsonb\n LANGUAGE sql\n'
            " SET search_path TO 'public', 'pg_temp'\n SET \"TimeZone\" TO 'UTC'\n"
            'AS $function$' + body + '$function$\n')


def derive_pin(old_pin_bytes, old_seal_bytes, new_seal_bytes, supplement):
    assert isinstance(old_pin_bytes, bytes) and _sha(old_pin_bytes) == PARENT_PIN_SHA256
    old = json.loads(old_pin_bytes)
    assert old['kind'] == 'controlled-stock-release-expected-204-v1'
    assert old['assembled_sql_hashes'][SEAL_PATH] == _sha(old_seal_bytes)
    old_sql, new_sql = old_seal_bytes.decode(), new_seal_bytes.decode()
    old_column_fragment = OLD_COLUMN_FRAGMENT
    new_column_fragment = NEW_COLUMN_FRAGMENT
    assert old_sql.count(old_column_fragment) == 1
    assert old_sql.count("'version',1,'functions',(") == 1
    approved_sql = old_sql.replace("'version',1,'functions',(", "'version',2,'functions',(", 1).replace(old_column_fragment, new_column_fragment, 1)
    assert new_sql == approved_sql, 'Only reviewed version and column ACL SQL changes permitted'
    old_definition = snapshot_function_definition(old_sql)
    old_metadata = old['expected_technical_manifest']['functions'][SNAPSHOT_SIGNATURE]
    assert _sha(old_definition.encode()) == old_metadata['sha256'], 'Old function rendering must match the independent pin'
    assert isinstance(supplement, dict) and set(supplement) == {'kind', 'old_manifest_matches', 'snapshot_function_definition', 'writers', 'relations'}
    assert supplement['kind'] == 'independent-released286-column-acl-supplement-v1' and supplement['old_manifest_matches'] is True
    assert supplement['snapshot_function_definition'] == old_definition
    assert supplement['writers'] == old['canonical_writer_definition_hashes']
    relations = old['expected_technical_manifest']['relations']
    assert len(relations) == 51 and set(supplement['relations']) == set(relations)
    result = copy.deepcopy(old)
    result['kind'] = 'controlled-stock-release-expected-204-v2'
    result['assembled_sql_hashes'][SEAL_PATH] = _sha(new_seal_bytes)
    expected = result['expected_technical_manifest']
    expected['version'] = 2
    columns = 0
    for name, relation in relations.items():
        actual_columns = supplement['relations'][name]
        assert set(actual_columns) == {column['name'] for column in relation['columns']}
        for column in expected['relations'][name]['columns']:
            acl = actual_columns[column['name']]
            assert acl == [], 'Unexpected OLD-release column grant requires independent review, never adoption'
            column['column_acl'] = []
            columns += 1
    assert columns == 397
    expected['functions'][SNAPSHOT_SIGNATURE]['sha256'] = _sha(snapshot_function_definition(new_sql).encode())
    validate_column_acl_manifest(expected)
    # Reverse every approved semantic delta and require exact parent equality.
    check = copy.deepcopy(result)
    check['kind'] = old['kind']
    check['assembled_sql_hashes'][SEAL_PATH] = old['assembled_sql_hashes'][SEAL_PATH]
    check['expected_technical_manifest']['version'] = 1
    check['expected_technical_manifest']['functions'][SNAPSHOT_SIGNATURE]['sha256'] = old_metadata['sha256']
    for relation in check['expected_technical_manifest']['relations'].values():
        for column in relation['columns']:
            del column['column_acl']
    assert check == old, 'Unapproved expected-pin delta'
    # Only the reviewed snapshot function may change; all other seal bytes stay.
    start = 'create function public.controlled_stock_manifest_snapshot()returns jsonb\n'
    tail = 'create function public.controlled_stock_manifest_required()'
    assert old_sql.split(start, 1)[0] == new_sql.split(start, 1)[0]
    assert old_sql.split(tail, 1)[1] == new_sql.split(tail, 1)[1]
    return result
