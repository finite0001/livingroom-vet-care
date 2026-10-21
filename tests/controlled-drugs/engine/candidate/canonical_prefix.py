"""Validate one reviewed canonical forward port while retaining the 204 baseline."""
import hashlib
import json
from pathlib import Path

CANONICAL_FILENAME = '20261020151157_controlled_stock_private_engine.sql'
CANONICAL_VERSION = '20261020151157'
CANONICAL_NAME = 'controlled_stock_private_engine'
CANONICAL_PATH = 'supabase/migrations/' + CANONICAL_FILENAME
CANONICAL_BODY_SHA256 = '9977696d3d6271cbbfe1dee3767dd71b8512d55bcec0c0d65d108745726252b3'
REVIEWED_PIN_SHA256 = '4755a1f1c53008003a11e94ada3963ae416f6c81f163ec43ed2ffea21d6d2f78'


def _unique(pairs):
    result = {}
    for key, value in pairs:
        assert key not in result, 'Duplicate independently pinned metadata key'
        result[key] = value
    return result


def canonical_prefix(source, files):
    """Accept exactly pinned 204 files plus the single byte-identical new body.

    The core assembly still receives only its original independently pinned 204
    files. A sliced arbitrary current inventory cannot authorize this transition.
    """
    source = Path(source).resolve()
    files = [Path(path).resolve() for path in files]
    assert len(files) == 205 and len({path.name for path in files}) == 205, 'Exact canonical 205 migration inventory required'
    assert [path.name for path in files] == sorted(path.name for path in files), 'Ordered canonical migration inventory required'
    root = source.parents[3]
    migration_directory = (root / 'supabase/migrations').resolve()
    assert all(path.parent == migration_directory for path in files), 'Canonical migration directory required'
    assert files == [path.resolve() for path in sorted(migration_directory.glob('*.sql'))], 'Complete canonical directory inventory required'
    raw = (source / 'release-expected-204.json').read_bytes()
    assert hashlib.sha256(raw).hexdigest() == REVIEWED_PIN_SHA256, 'Independent 204 release pin changed'
    pin = json.loads(raw, object_pairs_hook=_unique)
    assert pin['kind'] == 'controlled-stock-release-expected-204-v2'
    assert type(pin['baseline_migration_count']) is int and pin['baseline_migration_count'] == 204
    expected = pin['canonical_migration_hashes']
    assert len(expected) == 204
    prefix = files[:204]
    actual = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in prefix}
    assert actual == expected, 'Independent 204 migration prefix changed'
    canonical = files[204]
    assert canonical.name == CANONICAL_FILENAME, 'Exact reviewed canonical migration filename required'
    assert hashlib.sha256(canonical.read_bytes()).hexdigest() == CANONICAL_BODY_SHA256, 'Canonical migration body differs from reviewed CLI body'
    return prefix


def canonical_binding(source, files):
    """Bind real CLI application and its ledger row to the reviewed forward port."""
    source = Path(source).resolve()
    files = [Path(path).resolve() for path in files]
    prefix = canonical_prefix(source, files)
    # Deferred import avoids a module cycle in the CLI entrypoint adapter. The
    # builder itself remains a pure strict-204 API, with independent body framing.
    from cli_migration_body import build_cli_body
    body = build_cli_body(source, prefix)
    assert files[-1].read_bytes() == body['body'].encode(), 'Exact canonical CLI body bytes required'
    return validate_binding({'filename': CANONICAL_FILENAME, 'version': CANONICAL_VERSION, 'name': CANONICAL_NAME,
            'body_sha256': body['body_sha256'], 'expected_statements': body['expected_statements'],
            'statement_array_sha256': body['statement_array_sha256'],
            'canonical_migration_count': 205,
            'canonical_path': str(files[-1].relative_to(source.parents[3]))})


def validate_binding(binding):
    """Reject unbound versions, paths, body hashes or retained ledger statements."""
    from cli_migration_body import STATEMENT_ARRAY_SHA256
    assert type(binding) is dict and set(binding) == {'filename', 'version', 'name', 'body_sha256',
        'expected_statements', 'statement_array_sha256', 'canonical_migration_count', 'canonical_path'}
    for key, expected in [('filename', CANONICAL_FILENAME), ('version', CANONICAL_VERSION),
                          ('name', CANONICAL_NAME), ('canonical_path', CANONICAL_PATH),
                          ('body_sha256', CANONICAL_BODY_SHA256), ('statement_array_sha256', STATEMENT_ARRAY_SHA256)]:
        assert type(binding[key]) is str and binding[key] == expected, 'Canonical migration binding differs'
    assert type(binding['canonical_migration_count']) is int and binding['canonical_migration_count'] == 205
    statements = binding['expected_statements']
    assert type(statements) is list and len(statements) == 94 and all(type(value) is str and value.strip() for value in statements)
    assert hashlib.sha256(json.dumps(statements, sort_keys=True, separators=(',', ':')).encode()).hexdigest() == STATEMENT_ARRAY_SHA256, 'Canonical ledger statement binding differs'
    return binding
