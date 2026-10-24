"""Bind private206 CLI bytes and official statement framing without SQL execution."""
import argparse
import json
from pathlib import Path

from cli_migration_body import audit_cli_statements
from secondary_review_ledger import (SOURCE, MIGRATION_206, PROVENANCE_SHA256,
                                     TYPESCRIPT_SHA256, canonical, sha, split_sources, unique)
from secondary_review_release import check_release

BODY_FILE = 'controlled-secondary-review-cli-body.sql'
BODY_SHA256 = 'de8e0f4c0d2100b47a490dbd9b8e65c957fa49d003d447cb1af6f37aa8a75bfc'
STATEMENTS_FILE = 'secondary_review_206_statements.json'
STATEMENTS_FILE_SHA256 = '43736e52a08780b95edb7ef5594e8b98a7080634ce56dbd9180d2fc46d22618e'
STATEMENT_ARRAY_SHA256 = '51a4fbc5ef61aa4f6565b36fe480d003f046d7c5c048cfd06b876c01a179fa51'
PREFIX = b'begin;\n'
SUFFIX = b'commit;\n'


def derive_statements(body, typescript, source=SOURCE):
    assert sha(body.encode()) == BODY_SHA256, 'Exact candidate206 body required'
    parsed = split_sources([dict(name=MIGRATION_206, body=body)], typescript, source)[0]
    assert parsed['transaction_mode'] == 'transactional', 'CLI-owned transaction required'
    statements = parsed['statements']
    return dict(kind='controlled-review-canonical206-official-statements-v1',
                body_sha256=BODY_SHA256, parser_provenance_sha256=PROVENANCE_SHA256,
                typescript_sha256=TYPESCRIPT_SHA256,
                statement_array_sha256=sha(canonical(statements).encode()), statements=statements)


def build_cli_body(source=SOURCE):
    source = Path(source).resolve()
    release = check_release(source)
    raw = release['install'].encode()
    assert raw.startswith(PREFIX) and raw.endswith(SUFFIX)
    body = raw[len(PREFIX):-len(SUFFIX)]
    assert PREFIX + body + SUFFIX == raw and sha(body) == BODY_SHA256
    body = body.decode('utf-8')
    assert body.startswith('select pg_advisory_xact_lock(90271040,0);\n')
    # Independent fail-closed lexical safety audit, not the source of expected
    # ledger framing. It rejects top-level transaction/nonpipeline commands.
    executable_count = audit_cli_statements(body)
    encoded = (source / STATEMENTS_FILE).read_bytes()
    assert sha(encoded) == STATEMENTS_FILE_SHA256, 'Frozen official206 statement artifact changed'
    statements = json.loads(encoded, object_pairs_hook=unique)
    assert set(statements) == {'kind','body_sha256','parser_provenance_sha256','typescript_sha256','statement_array_sha256','statements'}
    assert statements['kind'] == 'controlled-review-canonical206-official-statements-v1'
    assert statements['body_sha256'] == BODY_SHA256
    assert statements['parser_provenance_sha256'] == PROVENANCE_SHA256
    assert statements['typescript_sha256'] == TYPESCRIPT_SHA256
    assert statements['statement_array_sha256'] == STATEMENT_ARRAY_SHA256
    assert sha(canonical(statements['statements']).encode()) == STATEMENT_ARRAY_SHA256
    assert statements['statements'][0] == 'select pg_advisory_xact_lock(90271040,0)'
    assert len(statements['statements']) == executable_count + 1
    assert statements['statements'][-1] == '-- CONTROLLED_REVIEW_RELEASE_BEFORE_COMMIT --'
    release.update(body=body, body_sha256=BODY_SHA256, expected_statements=statements['statements'],
                   statement_array_sha256=STATEMENT_ARRAY_SHA256, lexical_statement_count=executable_count)
    root = source.parents[3]
    # Imported lexical audit executes this existing module closure. Bind its
    # bytes even though the official export, not that audit, derives framing.
    helpers = tuple(source / name for name in ('cli_migration_body.py',
                    'release_assembly.py','local_install.py','derive_column_acl_pin.py'))
    for path in (*helpers,source / STATEMENTS_FILE, source / 'secondary_review_cli_body.py',
                 source.parent / 'release/controlled-secondary-review-private.sql'):
        release['input_source_hashes'][str(path.relative_to(root))] = sha(path.read_bytes())
    return release


def check_cli_body(source=SOURCE):
    result = build_cli_body(source)
    source = Path(source)
    expected = result['body'].encode()
    artifact = source.parent / 'release' / BODY_FILE
    migration = source.parents[3] / 'supabase/migrations' / MIGRATION_206
    assert artifact.read_bytes() == expected, 'Frozen206 CLI artifact differs'
    assert migration.read_bytes() == expected, 'Canonical206 migration differs'
    for path in (artifact,migration):
        result['input_source_hashes'][str(path.relative_to(source.parents[3]))] = sha(path.read_bytes())
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--write-candidate', action='store_true')
    modes.add_argument('--check', action='store_true')
    parser.add_argument('--typescript', type=Path)
    args = parser.parse_args()
    if args.write_candidate:
        assert args.typescript, 'Explicit pinned transpiler required'
        release = check_release()
        pin = derive_statements(release['body'], args.typescript)
        artifacts = {SOURCE / STATEMENTS_FILE: (json.dumps(pin,sort_keys=True,indent=2,ensure_ascii=True)+'\n').encode(),
                     SOURCE.parent / 'release' / BODY_FILE: release['body'].encode(),
                     SOURCE.parents[3] / 'supabase/migrations' / MIGRATION_206: release['body'].encode()}
        for path, data in artifacts.items():
            assert not path.exists() or path.read_bytes() == data, 'Never overwrite differing canonical artifact'
        for path, data in artifacts.items():
            path.write_bytes(data)
        result = dict(body_sha256=BODY_SHA256,statement_array_sha256=pin['statement_array_sha256'],
                      statements_file_sha256=sha(artifacts[SOURCE / STATEMENTS_FILE]),statement_count=len(pin['statements']))
    else:
        built = check_cli_body()
        if args.typescript:
            assert derive_statements(built['body'], args.typescript)['statements'] == built['expected_statements']
        result = dict(body_sha256=BODY_SHA256,statement_array_sha256=STATEMENT_ARRAY_SHA256,
                      statements_file_sha256=STATEMENTS_FILE_SHA256,statement_count=len(built['expected_statements']))
    print(canonical(dict(result,database_operations=0,hosted_writes=0)))


if __name__ == '__main__':
    main()
