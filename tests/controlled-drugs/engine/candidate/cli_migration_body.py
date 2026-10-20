"""Derive one reviewed CLI-owned migration body without database operations.

Only the byte-pinned private artifact is supported. The lexical audit is a
fail-closed check for that frozen SQL, not a general PostgreSQL parser.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

from release_assembly import check_release_artifact

ARTIFACT_SHA256 = '7165851ab481f2ee2ab41c7347a7db65213b5c647c101eaf4554a973d896c4a7'
PIN_SHA256 = '4755a1f1c53008003a11e94ada3963ae416f6c81f163ec43ed2ffea21d6d2f78'
BODY_SHA256 = '9977696d3d6271cbbfe1dee3767dd71b8512d55bcec0c0d65d108745726252b3'
# Independently cross-checked against the actual v2.118.0 sql-split.ts export.
# This pin applies only to BODY_SHA256, not arbitrary PostgreSQL SQL.
# Array digest: json.dumps(sort_keys=True, separators=(',', ':')), UTF-8.
# Reviewed statements are ASCII, so ensure_ascii choices coincide.
STATEMENT_ARRAY_SHA256 = '626e9374546764d9a4070f3a0332bd0c7f606812ffe7355abdaea35088b89e7c'
PREFIX = b'begin;\n'
SUFFIX = b'commit;\n'
DOLLAR = re.compile(r'\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$')
WORD = re.compile(r'[A-Za-z_][A-Za-z_0-9$]*')
ALLOWED_HEADS = {'SELECT', 'DO', 'CREATE', 'ALTER', 'REVOKE', 'GRANT', 'INSERT'}


def _sha(value):
    return hashlib.sha256(value).hexdigest()


def _audit_words(words):
    if not words:
        return False
    first = words[0]
    assert first not in {'BEGIN', 'COMMIT', 'END', 'ABORT', 'ROLLBACK'}, 'Authored transaction control forbidden'
    assert words[:2] not in (['START', 'TRANSACTION'], ['PREPARE', 'TRANSACTION']), 'Authored transaction control forbidden'
    assert first not in {'VACUUM', 'CLUSTER'}, 'Pipeline-incompatible SQL forbidden'
    assert words[:2] != ['ALTER', 'SYSTEM'], 'Pipeline-incompatible SQL forbidden'
    if first in {'CREATE', 'DROP', 'REINDEX'}:
        assert 'CONCURRENTLY' not in words, 'Pipeline-incompatible SQL forbidden'
    assert first in ALLOWED_HEADS, 'Unreviewed top-level command forbidden'
    return True


def split_reviewed_statements(body, *, include_comment_tail=True):
    """Count top-level statements while retaining quoted function bodies intact."""
    assert isinstance(body, str) and body and '\x00' not in body and '\ufeff' not in body
    i = 0
    words = []
    statements = []
    statement_start = 0
    code_seen = False
    while i < len(body):
        char = body[i]
        if char.isspace():
            i += 1
            continue
        if body.startswith('--', i):
            end = body.find('\n', i + 2)
            end = len(body) if end < 0 else end
            comment = body[i:end]
            assert not re.search(r'pg-delta\s*:\s*transaction\s*=\s*false\b', comment, re.I), 'Nontransactional migration directive forbidden'
            i = end
            continue
        if body.startswith('/*', i):
            comment_start = i
            depth = 1
            i += 2
            while i < len(body) and depth:
                if body.startswith('/*', i):
                    depth += 1
                    i += 2
                elif body.startswith('*/', i):
                    depth -= 1
                    i += 2
                else:
                    i += 1
            assert depth == 0, 'Unterminated SQL comment'
            assert not re.search(r'pg-delta\s*:\s*transaction\s*=\s*false\b', body[comment_start:i], re.I), 'Nontransactional migration directive forbidden'
            continue
        if char in ("'", '"'):
            assert words, 'Unreviewed top-level command forbidden'
            code_seen = True
            # E-strings alone interpret a backslash before a quote. The frozen
            # artifact otherwise uses standard-conforming quoted strings.
            escape = char == "'" and i > 0 and body[i - 1] in 'eE' and (i < 2 or not (body[i - 2].isalnum() or body[i - 2] in '_$'))
            quote = char
            i += 1
            closed = False
            while i < len(body):
                if escape and body[i] == '\\':
                    i += 2
                elif body[i] == quote:
                    if i + 1 < len(body) and body[i + 1] == quote:
                        i += 2
                    else:
                        i += 1
                        closed = True
                        break
                else:
                    i += 1
            assert closed, 'Unterminated SQL quote'
            continue
        if char == '$':
            match = DOLLAR.match(body, i)
            if match and (i == 0 or not (body[i - 1].isalnum() or body[i - 1] in '_$')):
                assert words, 'Unreviewed top-level command forbidden'
                code_seen = True
                delimiter = match.group()
                end = body.find(delimiter, match.end())
                assert end >= 0, 'Unterminated SQL dollar quote'
                i = end + len(delimiter)
                continue
        if char == ';':
            if _audit_words(words):
                statements.append(body[statement_start:i + 1].rstrip(';').strip())
            statement_start = i + 1
            words = []
            code_seen = False
            i += 1
            continue
        word = WORD.match(body, i)
        if word:
            code_seen = True
            words.append(word.group().upper())
            i = word.end()
        else:
            assert words, 'Unreviewed top-level command forbidden'
            code_seen = True
            i += 1
    assert not code_seen, 'Terminated top-level SQL required'
    assert statements, 'Nonempty reviewed migration body required'
    if include_comment_tail and body[statement_start:].strip():
        statements.append(body[statement_start:].strip())
    return statements


def audit_cli_statements(body):
    return len(split_reviewed_statements(body, include_comment_tail=False))


def derive_cli_body(artifact, pin_sha256):
    """Strip exactly two trusted boundary statements, never nested SQL text."""
    assert isinstance(artifact, bytes) and _sha(artifact) == ARTIFACT_SHA256, 'Released private artifact changed'
    assert pin_sha256 == PIN_SHA256, 'Released expected pin changed'
    assert artifact.startswith(PREFIX) and artifact.endswith(SUFFIX), 'Exact authored transaction boundaries required'
    body = artifact[len(PREFIX):-len(SUFFIX)]
    assert PREFIX + body + SUFFIX == artifact
    assert _sha(body) == BODY_SHA256, 'Reviewed CLI body changed'
    text = body.decode('utf-8')
    count = audit_cli_statements(text)
    assert text.startswith('select pg_advisory_xact_lock(90271040,0);\n'), 'Exclusive barrier must remain first'
    return text, count


def build_cli_body(source, files):
    source = Path(source).resolve()
    files = [Path(path).resolve() for path in files]
    artifact_path = source.parent / 'release/controlled-stock-private.sql'
    release = check_release_artifact(source, files, artifact_path)
    assert release['artifact_sha256'] == ARTIFACT_SHA256 and release['pin_sha256'] == PIN_SHA256
    artifact = artifact_path.read_bytes()
    body, count = derive_cli_body(artifact, release['pin_sha256'])
    root = source.parents[3]
    statements = split_reviewed_statements(body)
    statement_hash = _sha(json.dumps(statements, sort_keys=True, separators=(',', ':')).encode())
    assert statement_hash == STATEMENT_ARRAY_SHA256, 'Reviewed CLI statement framing changed'
    inputs = dict(release['input_source_hashes'])
    inputs[str(artifact_path.relative_to(root))] = _sha(artifact)
    return {'body': body, 'body_sha256': BODY_SHA256, 'artifact_sha256': ARTIFACT_SHA256,
            'pin_sha256': PIN_SHA256, 'input_source_hashes': inputs, 'statement_count': len(statements),
            'lexical_statement_count': count, 'expected_statements': statements,
            'statement_array_sha256': STATEMENT_ARRAY_SHA256}


def check_cli_body(source, files, path):
    result = build_cli_body(source, files)
    assert Path(path).read_bytes() == result['body'].encode(), 'Frozen CLI body differs'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--write', action='store_true')
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    from canonical_prefix import canonical_prefix
    files = canonical_prefix(source, sorted((source.parents[3] / 'supabase/migrations').glob('*.sql')))
    path = source.parent / 'release/controlled-stock-cli-body.sql'
    if args.check:
        result = check_cli_body(source, files, path)
    else:
        result = build_cli_body(source, files)
        path.write_bytes(result['body'].encode())
    print(json.dumps({'kind': 'controlled-cli-body-artifact-v1', 'body_sha256': result['body_sha256'],
                      'artifact_sha256': result['artifact_sha256'], 'pin_sha256': result['pin_sha256'],
                      'statement_count': result['statement_count'], 'statement_array_sha256': result['statement_array_sha256'], 'database_operations': 0, 'hosted_writes': 0}))


if __name__ == '__main__':
    main()
