"""Callback-only verification of the reviewed canonical 205 CLI application.

Original source data and all 204 ledger rows are captured before application,
never synthesized from a populated postinstall database. No SQL installer,
network, process invocation or baseline adoption is provided here.
"""
import re

import cli_atomicity as atomic
import release_rehearsal as release
from canonical_prefix import validate_binding


def capture_pre204(sql, prior_sql, trusted, *, phase):
    """Capture an actual empty-engine 204 replay; history may contain real seeds."""
    assert phase in ('ordinary', 'historical') and callable(sql)
    value = atomic._snapshot(sql, prior_sql, include_prior=True)
    assert len(value['ledger']) == 204 and value['prior'] == trusted['definition']
    assert not any(value['engine_catalog'].values())
    assert atomic.FIXTURE not in value['catalog']['schemas']
    assert not any(n.startswith('public.controlled_stock_') for n in value['relations'])
    assert {'public', 'auth', 'storage'} <= {n.split('.', 1)[0] for n in value['relations']} <= set(release.SCHEMAS)
    if phase == 'ordinary':
        assert value['relations'].get('auth.users', {}).get('count') == 0
    return value


def verify_canonical_ledger(ledger, original_rows, binding):
    """Validate actual old rows plus the one independently pinned CLI record."""
    validate_binding(binding)
    assert isinstance(original_rows, list) and len(original_rows) == 204
    versions = [r.get('version') for r in original_rows if isinstance(r, dict)]
    assert len(versions) == 204 and all(isinstance(v, str) and re.fullmatch(r'[0-9]{14}', v) for v in versions)
    assert versions == sorted(set(versions)) and versions[-1] < binding['version']
    assert isinstance(ledger, list) and len(ledger) == 205
    assert ledger[:204] == original_rows, 'Canonical install changed original 204 ledger rows'
    row = ledger[-1]
    assert isinstance(row, dict) and row.get('version') == binding['version'] and row.get('name') == binding['name']
    assert row.get('statements') == binding['expected_statements'], 'Canonical ledger statement array differs from reviewed body'
    return release._digest(row)


def verify_canonical_installed(sql, expected, pre204baseline, canonicalbinding):
    """Verify actual CLI-installed 205; never reinstall or reseal the engine."""
    assert callable(sql) and isinstance(pre204baseline, dict)
    validate_binding(canonicalbinding)
    assert set(pre204baseline) == {'catalog', 'relations', 'prior', 'writers', 'ledger', 'engine_catalog'}
    old = dict(pre204baseline)
    old.pop('catalog')
    release._validate_snapshot(old)
    assert not any(pre204baseline['engine_catalog'].values())
    assert atomic.FIXTURE not in pre204baseline['catalog']['schemas']
    assert not any(n.startswith('public.controlled_stock_') for n in pre204baseline['relations'])
    assert pre204baseline['writers'] == expected['canonical_writer_definition_hashes']
    checks = release._json(sql(atomic.installed_checks_sql(expected) + "select jsonb_build_object('passed',pg_temp.cli_atomicity_installed_checks());"))
    assert set(checks) == {'passed'} and checks['passed'] is True, 'Canonical installed literal/private/zero checks failed'
    installed = atomic._snapshot(sql)
    ledger_digest = verify_canonical_ledger(installed['ledger'], pre204baseline['ledger'], canonicalbinding)
    assert installed['writers'] == pre204baseline['writers']
    for name, value in pre204baseline['relations'].items():
        assert installed['relations'].get(name) == value, 'Canonical install changed original source rows'
    added = set(installed['relations']) - set(pre204baseline['relations'])
    assert len(added) == 21 and all(n.startswith('public.controlled_stock_') for n in added)
    assert atomic.FIXTURE not in installed['catalog']['schemas']
    for schema in (*release.SCHEMAS, 'supabase_migrations'):
        assert installed['catalog']['schemas'][schema] == pre204baseline['catalog']['schemas'][schema]
    for key in ('functions', 'relations'):
        assert {k: v for k, v in installed['catalog'][key].items() if k.startswith('supabase_migrations.')} == {k: v for k, v in pre204baseline['catalog'][key].items() if k.startswith('supabase_migrations.')}, 'Canonical install changed ledger catalog'
    assert installed['engine_catalog']['functions'] and installed['engine_catalog']['relations']
    return validate_proof({'kind': 'controlled-canonical-205-installed-v1', 'passed': True,
        'original_migration_count': 204, 'installed_migration_count': 205,
        'original_relation_count': len(pre204baseline['relations']), 'new_engine_relation_count': 21,
        'canonical_writers': 10, 'manifest_version': 2, 'manifest_functions': 171, 'manifest_relations': 51,
        'body_sha256': canonicalbinding['body_sha256'], 'statement_array_sha256': canonicalbinding['statement_array_sha256'],
        'ledger_record_sha256': ledger_digest, 'private_pre204_baseline_sha256': release._digest(pre204baseline),
        'reviewed_manifest_sha256': release._digest(expected['expected_technical_manifest']),
        'actual_pre204_baseline_required': True, 'original_source_rows_preserved': True,
        'original_204_ledger_rows_preserved': True, 'exact_canonical_205_ledger_verified': True,
        'literal_manifest_and_private_zero_activation_verified': True, 'ledger_catalog_preserved': True,
        'private_artifact_reinstalled': False, 'hosted_writes': 0, 'clinical_or_register_activation': False})


def validate_proof(proof):
    ints = {'original_migration_count': 204, 'installed_migration_count': 205, 'new_engine_relation_count': 21,
            'canonical_writers': 10, 'manifest_version': 2, 'manifest_functions': 171, 'manifest_relations': 51, 'hosted_writes': 0}
    flags = {'actual_pre204_baseline_required', 'original_source_rows_preserved', 'original_204_ledger_rows_preserved',
             'exact_canonical_205_ledger_verified', 'literal_manifest_and_private_zero_activation_verified', 'ledger_catalog_preserved'}
    hashes = {'body_sha256', 'statement_array_sha256', 'ledger_record_sha256', 'private_pre204_baseline_sha256', 'reviewed_manifest_sha256'}
    assert isinstance(proof, dict) and set(proof) == set(ints) | flags | hashes | {'kind', 'passed', 'original_relation_count', 'private_artifact_reinstalled', 'clinical_or_register_activation'}
    assert proof['kind'] == 'controlled-canonical-205-installed-v1' and proof['passed'] is True
    assert all(type(proof[k]) is int and proof[k] == n for k, n in ints.items())
    assert type(proof['original_relation_count']) is int and proof['original_relation_count'] > 0
    assert all(proof[k] is True for k in flags)
    assert all(isinstance(proof[k], str) and release.HEX.fullmatch(proof[k]) for k in hashes)
    assert proof['body_sha256'] == atomic.BODY_SHA256
    from cli_migration_body import STATEMENT_ARRAY_SHA256
    assert proof['statement_array_sha256'] == STATEMENT_ARRAY_SHA256
    assert proof['private_artifact_reinstalled'] is False and proof['clinical_or_register_activation'] is False
    return proof
