"""Read-only independent consistency checks, not target-helper acceptance."""
from collections import Counter
from datetime import datetime, timedelta
from decimal import Decimal
from hashlib import sha256
from pathlib import Path
import ast
import json

ROOT = Path(__file__).resolve().parent


def load(name):
    return json.loads((ROOT / name).read_text())


def value(text):
    return json.loads(text, parse_float=Decimal)


def utc(text):
    parsed = datetime.strptime(text, '%Y-%m-%dT%H:%M:%S.%fZ')
    assert parsed.strftime('%Y-%m-%dT%H:%M:%S.%fZ') == text
    assert datetime(2026, 1, 1) <= parsed < datetime(2101, 1, 1)
    return parsed


def main():
    anchors = load('anchors.json')
    families = load('families.json')
    cases = load('cases.json')
    inventory = load('inventory.json')
    assert inventory['database_runs'] == 0
    assert inventory['families'] == len(families) == 34
    assert inventory['cases'] == len(cases) == 1332
    assert len({row['id'] for row in cases}) == len(cases)
    assert inventory['decode_error_cases_counted_as_23514'] == 0
    for anchor in anchors:
        raw = anchor['expected_jsonb_text'].encode('utf-8')
        assert raw.hex() == anchor['expected_utf8_hex']
        assert sha256(raw).hexdigest() == anchor['expected_sha256']
    assert value(next(row for row in anchors if row['id'] == 'numeric_scale')['expected_jsonb_text'])[1].as_tuple().exponent == -1
    assert next(row for row in anchors if row['id'] == 'key_length_then_utf8')['expected_jsonb_text'] == '{"a": 4, "b": 2, "aa": 1, "é": 3}'
    by_id = {}
    maxima = Counter()
    counts = Counter()
    for family in families:
        values = {key: value(row['jsonb_text']) for key, row in family['values'].items()}
        by_id[family['id']] = values
        c, d, r, q, p, t = [values[key] for key in ['C', 'D', 'R', 'Q', 'P', 'T']]
        assert [len(v) for v in [c, d, r, q, p, t]] == [9, 10, 19, 17, 8, 11]
        assert values['pair'] == {'configuration': q, 'publication': p}
        assert values['stream'] == {'kind': c['kind'], **c['scope']}
        assert q['stream_key'] == values['stream']
        assert q['document'] == d
        assert q['record_hash'] == r['record_hash'] == t['record_hash']
        for key in ['kind', 'version', 'predecessor_id', 'predecessor_hash', 'enabled']:
            assert q[key] == d[key]
        for key in d:
            assert r[key] == d[key]
        for key in ['id', 'publication_operation_id', 'published_at', 'publisher_actor_id', 'publisher_session_id', 'publisher_name', 'authorization_id', 'publication_mode']:
            assert r[key] == q[key]
        for key, row in family['values'].items():
            raw = row['jsonb_text'].encode('utf-8')
            assert row['utf8_bytes'] == len(raw)
            assert row['sha256'] == sha256(raw).hexdigest()
            maxima[key] = max(maxima[key], len(raw))
        for label, expected_hash in [('record_hash_preimage', r['record_hash']), ('request_hash_preimage', p['request_hash'])]:
            golden = family[label]
            raw = bytes.fromhex(golden['utf8_hex'])
            assert raw.decode('utf-8') == golden['jsonb_text']
            assert sha256(raw).hexdigest() == expected_hash == golden['sha256']
        assert value(family['record_hash_preimage']['jsonb_text']) == {key: val for key, val in r.items() if key != 'record_hash'}
        assert value(family['request_hash_preimage']['jsonb_text']) == p['request']
        assert p['recorded_at'] == r['published_at'] == t['published_at']
        assert p['actor_id'] == r['publisher_actor_id'] == t['publisher_actor_id']
        assert p['mode'] == r['publication_mode'] == t['publication_mode']
        assert p['operation_id'] == r['publication_operation_id'] == t['operation_id']
        assert p['record_id'] == r['id'] == t['record_id']
        assert t['request_hash'] == p['request_hash']
        owner = c['kind'] == 'administration'
        assert set(p['request']) == ({'operation_id', 'record_id', 'document', 'reason'} if owner else {'actor_id', 'operation_id', 'record_id', 'document'})
        assert p['request']['document'] == c
        if owner:
            assert r['publication_mode'] == ('owner_bootstrap' if c['version'] == 1 else 'owner_recovery')
            assert r['publisher_name'] == 'Database owner (postgres)'
            assert all(r[key] is None for key in ['publisher_actor_id', 'publisher_session_id', 'authorization_id'])
        else:
            assert r['publication_mode'] == 'staff'
            assert all(isinstance(r[key], str) for key in ['publisher_actor_id', 'publisher_session_id', 'authorization_id'])
        expected_d = dict(c, calendar_observation=d['calendar_observation'])
        if c['kind'] == 'policy':
            effective = c['body']['effective_from']
            expected = r['published_at'] if effective['mode'] == 'now' else effective['at']
            expected_d['body'] = dict(c['body'], effective_from=expected)
            assert utc(expected) >= utc(r['published_at'])
            assert q['effective_from'] == expected
            assert len(c['body']['rules']) == 22
        else:
            assert q['effective_from'] is None
        assert d == expected_d
        if c['kind'] == 'calendar':
            observation = d['calendar_observation']
            assert observation['zone'] == c['body']['zone']
            labels = [row['local_timestamp'] for row in observation['local_values']]
            assert labels == sorted(set(labels))
            assert 1 <= len(labels) <= 63
            observed = {row['local_timestamp']: row['candidates'] for row in observation['local_values']}
            requested = set()
            previous_end = None
            for local, candidates in observed.items():
                parsed_local = datetime.strptime(local, '%Y-%m-%dT%H:%M:%S')
                assert 1 <= len(candidates) <= 2
                assert [row['utc'] for row in candidates] == sorted(set(row['utc'] for row in candidates))
                for candidate in candidates:
                    assert -50400 <= candidate['offset_seconds'] <= 50400
                    assert utc(candidate['utc']) + timedelta(seconds=candidate['offset_seconds']) == parsed_local
            for day in c['body']['days']:
                date = datetime.strptime(day['date'], '%Y-%m-%d')
                start_label = date.strftime('%Y-%m-%dT00:00:00')
                end_label = (date + timedelta(days=1)).strftime('%Y-%m-%dT00:00:00')
                requested.update([start_label, end_label])
                assert observed[start_label][0]['utc'] == day['start_utc']
                assert observed[end_label][0]['utc'] == day['end_utc']
                assert utc(day['start_utc']) < utc(day['end_utc'])
                if previous_end is not None:
                    assert previous_end == day['start_utc']
                previous_end = day['end_utc']
                if day['staffed']:
                    close_label = day['date'] + 'T' + day['close_local']
                    requested.add(close_label)
                    assert observed[close_label][day['close_fold']]['utc'] == day['close_utc']
                    assert utc(day['start_utc']) < utc(day['close_utc']) < utc(day['end_utc'])
                else:
                    assert all(day[k] is None for k in ['close_local', 'close_fold', 'close_utc'])
            assert requested == set(observed)
        else:
            assert d['calendar_observation'] is None
        counts[c['kind']] += 1
    for case in cases:
        if case['argument_kind'] == 'jsonb':
            text = case['argument_jsonb_text']
            decoded = value(text)
            assert len(text.encode()) == case['argument_utf8_bytes']
        else:
            assert case['argument_kind'] == 'sql_null'
        if case['expected']['outcome'] == 'success':
            expected = case['expected']['return_jsonb_text']
            if case['function'] == 'configuration_record':
                assert value(expected) == by_id[case['base']]['R']
            else:
                assert expected == case['argument_jsonb_text']
        else:
            assert case['expected']['sqlstate'] == '23514'
    indexed = {case['id']: case for case in cases}
    q_fraction = value(indexed['primitive/Q/version-visible-fraction']['argument_jsonb_text'])['version']
    receipt_fraction = value(indexed['primitive/pair/receipt-version-visible-fraction']['argument_jsonb_text'])['publication']['receipt']['version']
    assert q_fraction == 1 and q_fraction.as_tuple().exponent == -1
    assert receipt_fraction == 3 and receipt_fraction.as_tuple().exponent == -1
    assert inventory['success_cases'] == sum(c['expected']['outcome'] == 'success' for c in cases)
    assert inventory['refusal_cases'] == sum(c['expected']['outcome'] == 'error' for c in cases)
    source = ast.parse((ROOT / 'build_corpus.py').read_text())
    allowed = {'copy', 'datetime', 'decimal', 'hashlib', 'pathlib', 'json', 'sys'}
    for node in ast.walk(source):
        if isinstance(node, ast.Import):
            assert all(alias.name in allowed for alias in node.names)
        if isinstance(node, ast.ImportFrom):
            assert node.module in allowed
    print(json.dumps({'status': 'OFFLINE_CORPUS_CONSISTENCY_ONLY', 'families': len(families), 'cases': len(cases),
                      'families_by_kind': dict(counts), 'observed_positive_max_bytes': dict(maxima),
                      'sql_executed': False, 'postgres_renderer_confirmed': False}, sort_keys=True))


if __name__ == '__main__':
    main()
