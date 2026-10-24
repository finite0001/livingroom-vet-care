"""Owned-local scalar contract checks through a caller-owned SQL callback.

This module opens no database connection and starts no process. The caller first
checks its untouched canonical catalog against the independent trusted reference,
captures originals here, installs the candidate, then verifies the explicit three
scalar definition changes. Keep the returned originals private and in memory.
"""
import hashlib
import json
from pathlib import Path
import re


SIGNATURES = {
    'native_fulfillment_hash(jsonb)': 'native_fulfillment_hash',
    'native_fulfillment_decimal(numeric)': 'native_fulfillment_decimal',
    'native_fulfillment_receipt(native_fulfillment_operations)': 'native_fulfillment_receipt',
}
EXPECTED_FAMILIES = {'hash': 10, 'decimal': 14, 'receipt': 12, 'contract': 6, 'memory': 1}
ALLOWED_CHANGED_ATTRIBUTES = frozenset(('prolang', 'prosrc'))

CATALOG_SQL = """begin;set local search_path=public,pg_temp;set local timezone='UTC';
select jsonb_object_agg(v.signature,jsonb_build_object('name',p.proname,
 'definition',pg_get_functiondef(p.oid),'language',l.lanname,'attributes',to_jsonb(p)))
from(values
 ('native_fulfillment_hash(jsonb)','public.native_fulfillment_hash(jsonb)'),
 ('native_fulfillment_decimal(numeric)','public.native_fulfillment_decimal(numeric)'),
 ('native_fulfillment_receipt(native_fulfillment_operations)','public.native_fulfillment_receipt(public.native_fulfillment_operations)')
)v(signature,qualified_signature)
join pg_proc p on p.oid=to_regprocedure(v.qualified_signature)
join pg_language l on l.oid=p.prolang;
rollback;
"""


def _sha(value):
    return hashlib.sha256(value.encode('UTF8')).hexdigest()


def _query_json(sql, query):
    result = sql(query)
    if isinstance(result, dict):
        return result
    assert isinstance(result, str), 'Scalar SQL callback must return text or a JSON object'
    results = []
    for line in result.splitlines():
        if line.startswith('{'):
            value = json.loads(line)
            assert isinstance(value, dict), 'Scalar observation must be a JSON object'
            results.append(value)
    assert len(results) == 1, 'Exactly one scalar JSON observation required'
    return results[0]


def _catalog(sql):
    value = _query_json(sql, CATALOG_SQL)
    assert set(value) == set(SIGNATURES), 'Exactly three original scalar signatures required'
    for signature, name in SIGNATURES.items():
        item = value[signature]
        assert isinstance(item, dict) and item.get('name') == name, 'Scalar signature/name mismatch'
        assert isinstance(item.get('definition'), str), 'Actual scalar definition text required'
        assert isinstance(item.get('attributes'), dict), 'Complete actual pg_proc attributes required'
        assert ALLOWED_CHANGED_ATTRIBUTES <= item['attributes'].keys(), 'Scalar language/body catalog fields missing'
        assert item['definition'].startswith('CREATE OR REPLACE FUNCTION public.' + name + '('), 'Unexpected scalar definition serialization'
    return value


def capture_originals(sql, trusted):
    """Capture the actual original SQL catalog after the caller's trusted check.

    Every original definition is independently SHA-checked against trusted189.
    No current catalog is adopted as a replacement expected reference.
    """
    catalog = _catalog(sql)
    functions = {}
    for signature, item in catalog.items():
        expected = trusted['definition']['functions'][signature]['sha256']
        actual = _sha(item['definition'])
        assert actual == expected, 'Original scalar definition differs from trusted189: ' + signature
        assert item['language'] == 'sql', 'Original scalar must retain its SQL language: ' + signature
        functions[signature] = {**item, 'definition_sha256': actual, 'trusted_definition_sha256': expected}
    return {'kind': 'controlled-scalar-originals-v1', 'functions': functions, 'trusted_reference_regenerated': False}


def _original_functions(before):
    assert before.get('kind') == 'controlled-scalar-originals-v1', 'Captured original scalar catalog required'
    assert before.get('trusted_reference_regenerated') is False, 'Trusted scalar reference must not be regenerated'
    functions = before.get('functions')
    assert isinstance(functions, dict) and set(functions) == set(SIGNATURES), 'Exactly three captured originals required'
    for signature, name in SIGNATURES.items():
        item = functions[signature]
        assert item['name'] == name and item['language'] == 'sql', 'Original scalar identity/language changed'
        assert _sha(item['definition']) == item['definition_sha256'] == item['trusted_definition_sha256'], 'Captured original scalar bytes changed'
        assert item['definition'].startswith('CREATE OR REPLACE FUNCTION public.' + name + '('), 'Original scalar function header changed'
    return functions


def build_oracles(before):
    """Return a transaction prefix plus name/schema-only copies of originals.

    Append the compatibility fixture with its first BEGIN removed. Its final
    ROLLBACK then removes both oracles and fixture objects on the same connection.
    Every pg_get_functiondef result receives an explicit statement terminator.
    """
    functions = _original_functions(before)
    statements = ["begin;set local search_path=public,pg_temp;set local timezone='UTC';"]
    for signature, name in SIGNATURES.items():
        prefix = 'CREATE OR REPLACE FUNCTION public.' + name + '('
        replacement = 'CREATE OR REPLACE FUNCTION pg_temp.controlled_original_' + name.removeprefix('native_fulfillment_') + '('
        original = functions[signature]['definition']
        assert original.startswith(prefix)
        renamed = original.replace(prefix, replacement, 1)
        statements.append(renamed.rstrip().rstrip(';') + ';\n')
    return '\n'.join(statements) + '\n'


def _compatibility_sql(before, path):
    contents = Path(path).read_text()
    matches = list(re.finditer(r'(?im)^[ \t]*begin;', contents))
    assert len(matches) == 1, 'One compatibility transaction BEGIN required'
    match = matches[0]
    assert all(not line.strip() or line.lstrip().startswith('--') for line in contents[:match.start()].splitlines()), 'Compatibility statements precede their transaction'
    assert contents.rstrip().lower().endswith('rollback;'), 'Compatibility transaction must roll back'
    return build_oracles(before) + contents[:match.start()] + contents[match.end():], _sha(contents)


def _differential_result(value):
    assert value.get('kind') == 'controlled-scalar-overlay-differential-v1' and value.get('passed') is True, 'Scalar differential did not pass'
    assert type(value.get('semantic_cases')) is int and value['semantic_cases'] == 36, 'Exactly36 scalar semantic cases required'
    assert type(value.get('contract_checks')) is int and value['contract_checks'] == 6, 'Exactly6 scalar contract checks required'
    families = value.get('case_counts_by_family')
    assert isinstance(families, dict) and all(type(count) is int for count in families.values()) and families == EXPECTED_FAMILIES, 'Scalar family counts changed'
    memory = value.get('memory_regression')
    assert isinstance(memory, dict), 'Scalar memory regression observation required'
    assert type(memory.get('calls')) is int and memory['calls'] == 128, 'Exactly128 parent-primed scalar calls required'
    assert type(memory.get('payload_characters')) is int and memory['payload_characters'] == 16384, 'Exactly16KiB scalar regression payload required'
    assert type(memory.get('growth_bytes')) is int and 0 <= memory['growth_bytes'] < 262144, 'Scalar hash context growth must be under256KiB'
    assert memory.get('maximum_growth_bytes_exclusive') == 262144, 'Reviewed scalar memory guard changed'
    assert memory.get('parent_actual_helper_primed') is True and memory.get('all_repeated_outputs_match_independent_original') is True, 'Parent-primed independent scalar outputs required'
    assert value.get('independent_original_204_sql_oracles') is True and value.get('transaction_rolled_back') is True, 'Independent rollback-only original scalar oracles required'
    assert type(value.get('source_data_writes')) is int and value['source_data_writes'] == 0 and value.get('clinical_or_register_activation') is False, 'Scalar probe must not write source data or activate clinical stock'
    assert value.get('sql_only') is True and value.get('genuine_auth_api') is False, 'Scalar probe requires explicitly SQL-only evidence'
    return memory


def verify_installation(sql, before, compatibility_path):
    """Verify intentional scalar changes and return only sanitized evidence.

    All original pg_proc fields, including OID, owner, ACL, GUC, argument names,
    cost and parallel classification, must remain equal except prolang/prosrc.
    """
    originals = _original_functions(before)
    actual = _catalog(sql)
    helpers = {}
    for signature in SIGNATURES:
        old = originals[signature]
        new = actual[signature]
        assert new['language'] == 'plpgsql', 'Installed scalar language must be PL/pgSQL'
        old_attributes = old['attributes']
        new_attributes = new['attributes']
        assert old_attributes.keys() == new_attributes.keys(), 'Scalar catalog attribute set changed'
        changed = {key for key in old_attributes if old_attributes[key] != new_attributes[key]}
        assert changed == ALLOWED_CHANGED_ATTRIBUTES, 'Scalar catalog changed beyond intended language/body: ' + signature
        after_sha = _sha(new['definition'])
        assert after_sha != old['definition_sha256'], 'Installed scalar definition did not change'
        preserved = {key: value for key, value in old_attributes.items() if key not in ALLOWED_CHANGED_ATTRIBUTES}
        helpers[signature] = {'before_definition_sha256': old['definition_sha256'], 'after_definition_sha256': after_sha,
                              'changed_catalog_attributes': sorted(changed), 'preserved_catalog_attributes': sorted(preserved),
                              'preserved_catalog_attributes_sha256': _sha(json.dumps(preserved, sort_keys=True, separators=(',', ':')))}
    fixture, fixture_sha = _compatibility_sql(before, compatibility_path)
    result = _query_json(sql, fixture)
    memory = _differential_result(result)
    return {'kind': 'controlled-scalar-helper-contract-v1', 'three_scalar_definitions_intentionally_changed': True,
            'original_definitions_match_trusted189': True, 'trusted_reference_regenerated': False,
            'all_other_pg_proc_attributes_including_oid_owner_acl_unchanged': True,
            'helpers': helpers, 'compatibility_sql_sha256': fixture_sha, 'semantic_cases': 36, 'contract_checks': 6,
            'memory_checks': 1, 'case_counts_by_family': EXPECTED_FAMILIES.copy(),
            'memory_regression': {key: memory[key] for key in ('calls', 'payload_characters', 'growth_bytes', 'maximum_growth_bytes_exclusive',
                                                          'parent_actual_helper_primed', 'all_repeated_outputs_match_independent_original')},
            'sql_only': True, 'genuine_auth_api': False, 'source_data_writes': 0, 'clinical_or_register_activation': False,
            'temporary_oracles_and_probe_transaction_rolled_back': True}
