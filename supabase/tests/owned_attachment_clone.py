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


def admit_source(sql, fixture_sqls, *, root=ROOT):
    """Admit genuine current 205 and refuse conflicting synthetic fixture data."""
    prefix, binding, expected = reviewed_inputs(root)
    before = _admit(sql, prefix, binding, expected)
    assert isinstance(fixture_sqls, list) and fixture_sqls and all(isinstance(s, str) for s in fixture_sqls)
    ids = sorted({u.lower() for text in fixture_sqls for u in UUID.findall(text)})
    assert ids, 'Fixed fixture identities must be checked before copying'
    literal = "'" + json.dumps(ids).replace("'", "''") + "'::jsonb"
    clean = atomic.release._json(sql(r"""
select jsonb_build_object('fixture_clean',
 not exists(select 1 from auth.users where id in(select value::uuid from jsonb_array_elements_text(__IDS__)))
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
    assert atomic._snapshot(sql) == before, 'Source changed during clone admission'
    return before


def verify_clone(sql, before, *, root=ROOT):
    """Require independent canonical admission and exact real source data/ledger."""
    prefix, binding, expected = reviewed_inputs(root)
    copied = _admit(sql, prefix, binding, expected)
    for key in ('relations', 'ledger', 'writers', 'engine_catalog'):
        assert copied[key] == before[key], 'Attachment clone differs from admitted source: ' + key
    return {'kind': 'owned-attachment-canonical-clone-v1', 'passed': True,
            'canonical_migrations': 205, 'copied_data_relations': len(before['relations']),
            'actual_ledger_copied_exactly': True, 'independent_literal_manifest_verified': True,
            'private_zero_engine_activation_verified': True, 'canonical_writers': 10,
            'source_snapshot_sha256': atomic.release._digest(before),
            'schema_rebuilt_or_migrations_manually_replayed': False}


def verify_source_unchanged(sql, before):
    assert atomic._snapshot(sql) == before, 'Attachment rehearsal changed its source database'
    return True
