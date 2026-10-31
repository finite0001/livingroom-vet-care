"""Deduplicate frozen source literals in the installation-only metadata guard.

The inverse restores all PR316 bytes. Values still come exclusively from the
reviewed source; the live database never supplies an expected definition.
"""
import hashlib
import json

ORIGINAL_SHA = '62663353d144d280da1cb67ccac894e135154ebd3c9d1896813094eac70fe226'
OPEN = 'DO $fixture_source_check$'
CLOSE = '$fixture_source_check$;'
ANCHOR = 'fixture_diagnostic jsonb;'
BASE = 'fixture_source_expected'
REVIEW = 'fixture_source_original269'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def once(text, before, after):
    if text.count(before) != 1:
        raise ValueError('Exactly one frozen source anchor required')
    return text.replace(before, after, 1)


def bounds(text):
    if text.count(OPEN) != 1 or text.count(CLOSE) != 1:
        raise ValueError('Exactly one installation metadata guard required')
    start = text.index(OPEN)
    end = text.index(CLOSE, start) + len(CLOSE)
    return start, end


def literals(guard):
    # JSON remains syntactically valid while its SQL single quotes are doubled.
    # Decode only the first JSON object, then undo SQL quoting before using it.
    start = guard.index("'{") + 1
    _, end = json.JSONDecoder().raw_decode(guard, start)
    if guard[end:end + 8] != "'::jsonb":
        raise ValueError('Exact frozen JSONB literal required')
    literal = guard[start - 1:end + 8]
    value = json.loads(guard[start:end].replace("''", "'"))
    review = json.dumps(value['original269'], sort_keys=True, separators=(',', ':'))
    review_literal = "'" + review.replace("'", "''") + "'::jsonb"
    return literal, review_literal


def declaration(literal):
    return (BASE + ' CONSTANT jsonb:=' + literal + ';'
            + REVIEW + " CONSTANT jsonb:=" + BASE + "->'original269';")


def canonical(raw):
    if BASE.encode() not in raw and REVIEW.encode() not in raw:
        return raw
    text = raw.decode('utf-8', errors='strict')
    start, end = bounds(text)
    guard = text[start:end]
    base, review = literals(guard)
    guard = once(guard, declaration(base), '')
    if guard.count(BASE) != 1 or guard.count(REVIEW) != 3:
        raise ValueError('Exact constant reference inventory required')
    guard = guard.replace(BASE, base).replace(REVIEW, review)
    restored = (text[:start] + guard + text[end:]).encode()
    if sha(restored) != ORIGINAL_SHA:
        raise ValueError('Complete PR316 migration inverse required')
    return restored


def derive(raw):
    original = canonical(raw)
    if sha(original) != ORIGINAL_SHA:
        raise ValueError('Exact PR316 source required for compaction')
    text = original.decode('utf-8', errors='strict')
    start, end = bounds(text)
    guard = text[start:end]
    if BASE in text or REVIEW in text:
        raise ValueError('Fresh local constant identifiers required')
    base, review = literals(guard)
    if guard.count(base) != 1 or guard.count(review) != 3:
        raise ValueError('Exact duplicated source literal inventory required')
    guard = once(guard, base, BASE).replace(review, REVIEW)
    guard = once(guard, ANCHOR, ANCHOR + declaration(base))
    result = (text[:start] + guard + text[end:]).encode()
    if canonical(result) != original:
        raise ValueError('Whole source compaction inverse failed')
    return result
