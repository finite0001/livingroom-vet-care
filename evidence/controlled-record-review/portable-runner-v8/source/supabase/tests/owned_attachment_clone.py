"""Read-only admission and exact-data checks for owned attachment test clones.

No database creation, process, installer, repair or resealing API lives here.
The caller verifies its container/workdir and clone marker before each callback.
A current independent canonical pin admits both source and restored databases;
copying an arbitrary source snapshot never constitutes admission.
"""
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tests/controlled-drugs/engine/candidate'))
import cli_atomicity as atomic
from canonical_prefix import canonical_prefix, canonical_binding, REVIEWED_PIN_SHA256

UUID = re.compile(r'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b', re.I)


def reviewed_inputs(root=ROOT):
    root = Path(root)
    source = root / 'tests/controlled-drugs/engine/candidate'
    files = sorted((root / 'supabase/migrations').glob('*.sql'))
    prefix = canonical_prefix(source, files)
    binding = canonical_binding(source, files)
    raw = (source / 'release-expected-204.json').read_bytes()
    assert hashlib.sha256(raw).hexdigest() == REVIEWED_PIN_SHA256
    expected = json.loads(raw, object_pairs_hook=atomic.release._unique)
    return prefix, binding, expected


def _admit(sql, prefix, binding, expected):
    assert callable(sql)
    check = atomic.release._json(sql(atomic.installed_checks_sql(expected) + "select jsonb_build_object('passed',pg_temp.cli_atomicity_installed_checks());"))
    assert set(check) == {'passed'} and check['passed'] is True, 'Independent canonical/private/zero-state admission failed'
    value = atomic._snapshot(sql)
    assert len(value['ledger']) == 205
    assert [r['version'] for r in value['ledger'][:204]] == [p.name.split('_', 1)[0] for p in prefix]
    assert [r['name'] for r in value['ledger'][:204]] == [p.stem.split('_', 1)[1] for p in prefix]
    row = value['ledger'][-1]
    assert row.get('version') == binding['version'] and row.get('name') == binding['name']
    assert row.get('statements') == binding['expected_statements'], 'Actual canonical ledger statements differ'
    assert value['writers'] == expected['canonical_writer_definition_hashes']
    return value


def _profile(value):
    assert type(value) is int and value in (205,206), 'Explicit canonical205 or206 profile required'
    return value


def _snapshot(sql, canonical_baseline):
    if _profile(canonical_baseline) == 205:
        return atomic._snapshot(sql)
    from canonical_post206 import snapshot
    from secondary_review_restore_ownership import MAP_SQL, auth_entries
    value = snapshot(sql)
    ownership = atomic.release._json(sql(MAP_SQL))
    assert set(ownership) == {'entries','extensions'}
    auth = auth_entries(ownership)
    assert auth and len({(row['kind'],row['identity'])for row in auth}) == len(auth), 'Complete unique Auth ownership inventory required'
    assert sum(row['kind']=='schema'and row['identity']=='auth'for row in auth)==1
    assert all(set(row)=={'kind','identity','owner','acl','detail','extension'}and row['extension']is None for row in auth)
    value['auth_owner_acl'] = auth
    return value


def _admit_profile(sql, root, canonical_baseline):
    _profile(canonical_baseline)
    prefix, binding, expected = reviewed_inputs(root)
    if _profile(canonical_baseline) == 205:
        return _admit(sql, prefix, binding, expected)
    from canonical_review_prefix import admit_canonical206
    from secondary_review_cli_body import check_cli_body
    from secondary_review_release import parent_checks_sql, installed_checks_sql
    from canonical_post206 import verify_ledger206
    source = Path(root) / 'tests/controlled-drugs/engine/candidate'
    admitted = admit_canonical206(source, sorted((Path(root) / 'supabase/migrations').glob('*.sql')))
    package = check_cli_body(source)
    # Retain the original independent zero-engine/private-parent predicate. The
    # new release's populated-safe check alone is insufficient for this fixture.
    checked = atomic.release._json(sql(atomic.installed_checks_sql(expected) +
              "select jsonb_build_object('passed',pg_temp.cli_atomicity_installed_checks());"))
    assert set(checked)=={'passed'}and checked['passed']is True, 'Independent canonical/private/zero-state admission failed'
    checked = atomic.release._json(sql(parent_checks_sql(expected)+installed_checks_sql(package['expected'])+
              "select jsonb_build_object('review_private',true);"))
    assert set(checked)=={'review_private'}and checked['review_private']is True, 'Independent private206 admission failed'
    value = _snapshot(sql,206)
    verify_ledger206(value['ledger'], package['expected_ledger'], admitted['binding206'])
    assert value['parent'] == expected['expected_technical_manifest'], 'Frozen parent snapshot differs'
    assert value['writers'] == expected['canonical_writer_definition_hashes'], 'Frozen canonical writers differ'
    assert value['parent_literal_hash_valid']is True, 'Parent literal hash check required'
    assert len(value['parent_literal'])==1 and type(value['parent_literal'][0]['revision'])is int
    assert value['parent_literal'][0]['revision']==1
    assert value['parent_literal'][0]['definition']==expected['expected_technical_manifest']
    assert 'controlled_review'in value['catalog']['schemas'], 'Private206 extension missing'
    assert 'controlled_review_cli_fixture'not in value['catalog']['schemas'], 'Atomicity fixture must be removed'
    review_rows={'controlled_review.'+name for name in ('descriptor','definitions','preparations','decisions','cancellations')}
    assert {name for name in value['rows']if name.startswith('controlled_review.')}==review_rows
    assert len(value['rows']['controlled_review.descriptor'])==1
    assert value['rows']['controlled_review.descriptor'][0]['id']is True
    assert value['rows']['controlled_review.descriptor'][0]=={'id':True,'definition':package['expected']}
    assert all(value['rows']['controlled_review.'+name]==[]for name in ('definitions','preparations','decisions','cancellations'))
    return value


def admit_source(sql, fixture_sqls, *, root=ROOT, canonical_baseline=205):
    """Admit the explicitly selected private baseline; never auto-downgrade."""
    before = _admit_profile(sql, root, canonical_baseline)
    assert isinstance(fixture_sqls, list) and fixture_sqls and all(isinstance(s, str) for s in fixture_sqls)
    ids = sorted({u.lower() for text in fixture_sqls for u in UUID.findall(text)})
    assert ids, 'Fixed fixture identities must be checked before copying'
    literal = "'" + json.dumps(ids).replace("'", "''") + "'::jsonb"
    # Targeted standalone fixtures assert exact migration run/scope/binding
    # cardinalities. A manifest can exist before any child import run, so empty
    # import roots alone do not establish this prerequisite. Refuse these
    # conflicting families explicitly; unrelated clinical data remains allowed.
    clean = atomic.release._json(sql(r"""
select jsonb_build_object('fixture_clean',
 not exists(select 1 from auth.users where id in(select value::uuid from jsonb_array_elements_text(__IDS__)))
 and not exists(select 1 from public.ezyvet_migration_runs)
 and not exists(select 1 from public.ezyvet_migration_scopes)
 and not exists(select 1 from public.ezyvet_migration_bindings)
 and not exists(select 1 from ezyvet_import_runs)
 and not exists(select 1 from ezyvet_import_snapshots)
 and not exists(select 1 from ezyvet_identity_heads)
 and not exists(select 1 from ezyvet_record_links)
 and not exists(select 1 from storage.objects where bucket_id='ezyvet-attachment-originals')
 and not exists(select 1 from public.ezyvet_attachment_page_observations)
 and not exists(select 1 from public.ezyvet_attachment_pages)
 and not exists(select 1 from public.ezyvet_attachment_runs)
 and not exists(select 1 from public.ezyvet_attachment_capture_requests)
 and not exists(select 1 from public.ezyvet_attachment_capture_attempts)
 and not exists(select 1 from public.ezyvet_attachment_capture_failures)
 and not exists(select 1 from public.ezyvet_attachment_original_intents)
 and not exists(select 1 from public.ezyvet_attachment_original_captures)
 and not exists(select 1 from public.ezyvet_attachment_record_versions)
 and not exists(select 1 from public.ezyvet_attachment_approval_cancellations));
""".replace('__IDS__', literal)))
    assert set(clean) == {'fixture_clean'} and clean['fixture_clean'] is True, 'Source has conflicting attachment fixtures; no clearing permitted'
    assert _snapshot(sql,canonical_baseline) == before, 'Source changed during clone admission'
    return before


def verify_clone(sql, before, *, root=ROOT, canonical_baseline=205):
    """Require independent canonical admission and exact real source data/ledger."""
    copied = _admit_profile(sql, root, canonical_baseline)
    keys = ('relations','ledger','writers','engine_catalog')if canonical_baseline==205 else (
        'rows','ledger','parent','parent_literal','parent_literal_hash_valid','writers','auth_owner_acl')
    for key in keys:
        assert key in before, 'Source snapshot does not match explicit canonical profile'
        assert copied[key] == before[key], 'Attachment clone differs from admitted source: ' + key
    proof = {'kind': 'owned-attachment-canonical-clone-v1', 'passed': True,
            'canonical_migrations': canonical_baseline, 'copied_data_relations': len(before['relations'if canonical_baseline==205 else'rows']),
            'actual_ledger_copied_exactly': True, 'independent_literal_manifest_verified': True,
            'private_zero_engine_activation_verified': True, 'canonical_writers': 10,
            'source_snapshot_sha256': atomic.release._digest(before),
            'schema_rebuilt_or_migrations_manually_replayed': False}
    if canonical_baseline==206:
        proof.update(independent_private_review_metadata_verified=True,zero_review_eligibility_and_evidence_verified=True,
                     auth_owner_and_raw_acl_preserved=True,oid_catalog_equality_across_databases_claimed=False)
    return proof


def verify_source_unchanged(sql, before, *, canonical_baseline=205):
    after = _snapshot(sql,canonical_baseline)
    if after != before:
        # Names/counts only: never publish raw catalogs, ACLs, patient data or SQL.
        changed = sorted(key for key in set(before) | set(after)
                         if before.get(key) != after.get(key))
        row_key='relations'if canonical_baseline==205 else'rows'
        relations = sorted(key for key in set(before.get(row_key, {})) | set(after.get(row_key, {}))
                           if before.get(row_key, {}).get(key) != after.get(row_key, {}).get(key))
        diagnostic = {'changed_components': changed, 'changed_relation_count': len(relations),
                      'changed_relations': relations[:20], 'relations_truncated': len(relations) > 20}
        raise AssertionError('Attachment rehearsal changed its source database: ' + json.dumps(diagnostic, sort_keys=True))
    return True
