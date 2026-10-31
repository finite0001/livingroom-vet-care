"""Compact the installation descriptor without changing its stored definition.

The original descriptor literal is an independently frozen source artifact.
Its properties are unconditionally overwritten by the following JSONB overlay.
The inverse restores the whole PR317 migration, including the discarded literal.
"""
import hashlib
import json
from pathlib import Path

import prefix_view as prefix

ORIGINAL_SHA = 'c4887e00eb73682a5d61150d35bccc1effda70ea80735efe22593a3e4bead7c4'
DESCRIPTOR_SHA = '009b7745613a282e7bf3415e42b507609c93c7b0e757fbacdde61aee4e3aa836'
OPEN = 'DO $fixture_descriptor$'
CLOSE = '$fixture_descriptor$;'
ANCHOR = 'DECLARE expected jsonb;'
BASE = 'fixture_descriptor_source_expected'
REVIEW = 'fixture_descriptor_original269'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def once(text, before, after):
    if text.count(before) != 1:
        raise ValueError('One exact descriptor source anchor required')
    return text.replace(before, after, 1)


def bounds(text):
    if text.count(OPEN) != 1 or text.count(CLOSE) != 1:
        raise ValueError('One original descriptor statement required')
    start = text.index(OPEN)
    return start, text.index(CLOSE, start) + len(CLOSE)


def literal(value, *, sort_keys=False):
    return "'" + json.dumps(value, sort_keys=sort_keys, separators=(',', ':')).replace("'", "''") + "'::jsonb"


def frozen_descriptor():
    raw = prefix.regular(Path(__file__).resolve().parent / 'module-expected.json')
    if sha(raw) != DESCRIPTOR_SHA:
        raise ValueError('Exact independently frozen source descriptor required')
    value = json.loads(raw)
    if 'properties' not in value:
        raise ValueError('Original descriptor properties required')
    header = {key: entry for key, entry in value.items() if key != 'properties'}
    return literal(value), literal(header)


def source_literals(guard, offset=0):
    start = guard.index("'{", offset) + 1
    _, end = json.JSONDecoder().raw_decode(guard, start)
    if guard[end:end + 8] != "'::jsonb":
        raise ValueError('Exact frozen property literal required')
    base = guard[start - 1:end + 8]
    value = json.loads(guard[start:end].replace("''", "'"))
    return base, literal(value['original269'], sort_keys=True)


def declaration(base):
    return (BASE + ' CONSTANT jsonb:=' + base + ';'
            + REVIEW + ' CONSTANT jsonb:=' + BASE + "->'original269';")


def canonical(raw):
    if BASE.encode() not in raw and REVIEW.encode() not in raw:
        return raw
    text = raw.decode('utf-8', errors='strict')
    start, end = bounds(text)
    guard = text[start:end]
    full, header = frozen_descriptor()
    base, review = source_literals(guard)
    guard = once(guard, declaration(base), '')
    if guard.count(BASE) != 1 or guard.count(REVIEW) != 3:
        raise ValueError('Exact descriptor constant reference inventory required')
    guard = guard.replace(BASE, base).replace(REVIEW, review)
    guard = once(guard, header + "||jsonb_build_object('properties',", full + "||jsonb_build_object('properties',")
    restored = (text[:start] + guard + text[end:]).encode()
    if sha(restored) != ORIGINAL_SHA:
        raise ValueError('Complete PR317 migration inverse required')
    return restored


def derive(raw):
    original = canonical(raw)
    if sha(original) != ORIGINAL_SHA:
        raise ValueError('Exact PR317 source required for descriptor compaction')
    text = original.decode('utf-8', errors='strict')
    if BASE in text or REVIEW in text:
        raise ValueError('Fresh local descriptor constant identifiers required')
    start, end = bounds(text)
    guard = text[start:end]
    full, header = frozen_descriptor()
    if guard.count(full + "||jsonb_build_object('properties',") != 1:
        raise ValueError('Unconditional original properties overwrite required')
    base, review = source_literals(guard, guard.index(full) + len(full))
    if guard.count(base) != 1 or guard.count(review) != 3:
        raise ValueError('Exact descriptor property literal inventory required')
    guard = once(guard, full, header)
    guard = once(guard, base, BASE).replace(review, REVIEW)
    guard = once(guard, ANCHOR, ANCHOR + declaration(base))
    result = (text[:start] + guard + text[end:]).encode()
    if canonical(result) != original:
        raise ValueError('Whole descriptor compaction inverse failed')
    return result
