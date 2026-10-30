"""Independent lexical check for the two source-bound forward migrations.

The retained lexer comes from cli_migration_body.py. Only the head policy is
extended for declared LOCAL settings and the two transient reference schemas.
Official CLI parsing separately supplies the actual ledger framing.
"""
import re
DOLLAR = re.compile(r'\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$')
WORD = re.compile(r'[A-Za-z_][A-Za-z_0-9$]*')
ALLOWED_HEADS = {'SELECT', 'DO', 'CREATE', 'ALTER', 'REVOKE', 'GRANT', 'INSERT'}
SETTINGS = {'QUOTE_ALL_IDENTIFIERS','SEARCH_PATH','TIMEZONE','DATESTYLE','INTERVALSTYLE','EXTRA_FLOAT_DIGITS','STATEMENT_TIMEOUT','LOCK_TIMEOUT'}
TRANSIENT_SCHEMAS = {'COUNT_ORDINARY_RELATION_REFERENCE_V1','CONTROLLED_COUNT_FIXTURE_REFERENCE_V1'}


def _audit_words(words):
    if not words:
        return False
    first = words[0]
    if first == 'SET':
        if words[1:] == ['CONSTRAINTS', 'ALL', 'IMMEDIATE']:
            return True
        assert len(words) >= 3 and words[1] == 'LOCAL' and words[2] in SETTINGS, 'Only declared transaction-local settings allowed'
        return True
    if first == 'DROP':
        if words == ['DROP','FUNCTION','PG_TEMP','COUNT_SOURCE_RELINK_FK','REGCLASS','TEXT','REGCLASS']:
            return True  # Exact temporary source-reference FK chronology helper.
        if len(words) == 4 and words[1] == 'SCHEMA' and words[2] in TRANSIENT_SCHEMAS and words[3] == 'CASCADE':
            return True
        if words == ['DROP','TRIGGER','CONTROLLED_STOCK_CONSISTENCY','ON','PUBLIC','CONTROLLED_STOCK_EXECUTION_CONTEXTS']:
            return True  # Exact source replacement for the new context column.
        assert len(words) >= 5 and words[1] in ('POLICY','TRIGGER') and words[-3] == 'ON' and words[-2] in TRANSIENT_SCHEMAS, 'Only declared context-trigger replacement or transient reference DDL may be dropped'
        return True
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
