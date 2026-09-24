"""Sanitized security mismatch evidence; never include function bodies or settings."""
import hashlib
import json


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def security_mismatch(expected, actual):
    sections = []
    for section in sorted(set(expected) | set(actual)):
        left, right = expected.get(section), actual.get(section)
        if left == right:
            continue
        # Use ordinal positions plus digests, never arbitrary object names or
        # configuration values from potentially corrupted restored metadata.
        left_rows, right_rows = left or [], right or []
        left_hashes = {fingerprint(row) for row in left_rows}
        right_hashes = {fingerprint(row) for row in right_rows}
        sections.append({
            'section': section if section in ('functions', 'triggers', 'relations', 'policies', 'default_privileges') else 'unknown',
            'source_count': len(left_rows), 'restored_count': len(right_rows),
            'source_sha256': fingerprint(left), 'restored_sha256': fingerprint(right),
            'source_only_sha256': sorted(left_hashes - right_hashes),
            'restored_only_sha256': sorted(right_hashes - left_hashes),
            'ordering_only': left_hashes == right_hashes,
        })
    return {'equal': not sections, 'sections': sections}
