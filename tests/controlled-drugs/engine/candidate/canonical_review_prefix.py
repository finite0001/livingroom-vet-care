"""Exact complete206 admission and explicit retained205 projection; no database.

No prefix is authorized by a slice or migration-count range. The whole directory,
all frozen sources/artifacts, and the exact206 body must first be admitted.
"""
from pathlib import Path

from secondary_review_ledger import MIGRATION_206, source205, sha
from secondary_review_cli_body import check_cli_body, BODY_SHA256, STATEMENT_ARRAY_SHA256

CANONICAL_FILENAME = MIGRATION_206
CANONICAL_VERSION = '20261022010000'
CANONICAL_NAME = 'controlled_secondary_review_private'
CANONICAL_PATH = 'supabase/migrations/' + CANONICAL_FILENAME


def admit_canonical206(source, files):
    source = Path(source).resolve()
    root = source.parents[3]
    files = [Path(path).resolve() for path in files]
    directory = (root / 'supabase/migrations').resolve()
    assert len(files) == 206 and len(set(files)) == 206, 'Exact canonical206 inventory required'
    assert all(p.parent == directory for p in files), 'Canonical206 migration directory required'
    assert files == sorted(files), 'Ordered complete canonical206 inventory required'
    assert files == [p.resolve() for p in sorted(directory.glob('*.sql'))], 'Complete canonical206 directory inventory required'
    old205 = source205(source)
    assert files == old205 + [directory / CANONICAL_FILENAME], 'Exact pinned205 plus one206 required'
    package = check_cli_body(source)
    assert package['body_sha256'] == BODY_SHA256
    assert sha(files[-1].read_bytes()) == BODY_SHA256
    assert package['statement_array_sha256'] == STATEMENT_ARRAY_SHA256
    inputs = dict(package['input_source_hashes'])
    # Both the exact206 validator and retained205 dispatcher execute during
    # projection. Their bytes are part of every caller's admission evidence.
    for name in ('canonical_review_prefix.py','canonical_prefix.py'):
        path = source / name
        inputs[str(path.relative_to(root))] = sha(path.read_bytes())
    binding = dict(filename=CANONICAL_FILENAME,version=CANONICAL_VERSION,name=CANONICAL_NAME,
                   canonical_path=CANONICAL_PATH,canonical_migration_count=206,
                   body_sha256=BODY_SHA256,statement_array_sha256=STATEMENT_ARRAY_SHA256,
                   expected_statements=package['expected_statements'])
    return dict(prefix205=old205,prefix204=old205[:-1],binding206=binding,input_source_hashes=inputs)


def canonical_review_binding(source, files):
    return admit_canonical206(source,files)['binding206']
