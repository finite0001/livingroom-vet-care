"""Independent read-only boundary arithmetic/shape checks, not target SQL tests."""
from collections import Counter
from datetime import datetime, timedelta
from decimal import Decimal
from hashlib import sha256
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent


def decode(text):
    return json.loads(text, parse_float=Decimal)


def instant(text):
    parsed = datetime.strptime(text, '%Y-%m-%dT%H:%M:%S.%fZ')
    assert parsed.strftime('%Y-%m-%dT%H:%M:%S.%fZ') == text
    return parsed


def main():
    rows = json.loads((ROOT / 'families.json').read_text())
    cases = json.loads((ROOT / 'cases.json').read_text())
    families = {}
    maxima = Counter()
    for row in rows:
        f = {key: decode(item['jsonb_text']) for key, item in row['values'].items()}
        families[row['id']] = f
        c, d, r, q, p, t = [f[key] for key in ['C', 'D', 'R', 'Q', 'P', 'T']]
        assert [len(x) for x in [c, d, r, q, p, t]] == [9, 10, 19, 17, 8, 11]
        for key, item in row['values'].items():
            raw = item['jsonb_text'].encode()
            assert len(raw) == item['utf8_bytes'] and sha256(raw).hexdigest() == item['sha256']
            maxima[key] = max(maxima[key], len(raw))
        assert decode(row['record_hash_preimage']) == {k: v for k, v in r.items() if k != 'record_hash'}
        assert decode(row['request_hash_preimage']) == p['request']
        assert sha256(row['record_hash_preimage'].encode()).hexdigest() == r['record_hash'] == q['record_hash'] == t['record_hash']
        assert sha256(row['request_hash_preimage'].encode()).hexdigest() == p['request_hash'] == t['request_hash']
        assert f['pair'] == {'configuration': q, 'publication': p}
        assert p['receipt'] == t
        assert q['document'] == d
        assert p['request']['document'] == c
        assert f['stream'] == q['stream_key'] == {'kind': c['kind'], **c['scope']}
        for key in d:
            assert r[key] == d[key]
        for key in ['id', 'publication_operation_id', 'published_at', 'publisher_actor_id', 'publisher_session_id', 'publisher_name', 'authorization_id', 'publication_mode']:
            assert r[key] == q[key]
        for key in ['publisher_actor_id', 'publisher_session_id', 'publisher_name', 'authorization_id', 'publication_mode', 'published_at']:
            assert r[key] == t[key]
        assert t['operation_id'] == p['operation_id'] == q['publication_operation_id']
        assert t['record_id'] == p['record_id'] == q['id']
        assert p['recorded_at'] == r['published_at']
        assert 1 <= len(r['publisher_name']) <= 200
        assert 1 <= len(c['approval_reference']) <= 200
        assert datetime(2026, 1, 1) <= instant(r['published_at']) < datetime(2101, 1, 1)
        if c['kind'] == 'administration':
            assert 1 <= len(p['request']['reason']) <= 4000
            assert r['publisher_name'] == 'Database owner (postgres)'
        if 'members' in c['body']:
            members = c['body']['members']
            assert 1 <= len(members) <= 100
            actors = [member['actor_id'] for member in members]
            assert actors == sorted(set(actors))
        if c['kind'] == 'policy':
            form = c['body']['effective_from']
            expected = r['published_at'] if form['mode'] == 'now' else form['at']
            assert d['body']['effective_from'] == q['effective_from'] == expected
            assert instant(expected) >= instant(r['published_at'])
        if c['kind'] == 'calendar':
            observation = d['calendar_observation']
            assert observation['zone'] == c['body']['zone']
            for item in observation['local_values']:
                local = datetime.strptime(item['local_timestamp'], '%Y-%m-%dT%H:%M:%S')
                candidate = item['candidates'][0]
                assert candidate['offset_seconds'] == 20700
                assert instant(candidate['utc']) + timedelta(seconds=20700) == local
            day = c['body']['days'][0]
            assert [item['candidates'][0]['utc'] for item in observation['local_values']] == [day['start_utc'], day['close_utc'], day['end_utc']]
            assert instant(day['start_utc']) < instant(day['close_utc']) < instant(day['end_utc'])
        for key, limit in [('C',131072), ('D',131072), ('R',262144), ('Q',262144), ('P',393216), ('T',131072), ('pair',524288), ('stream',4096)]:
            assert row['values'][key]['utf8_bytes'] <= limit
    for size in [199, 200]:
        assert len(families['publisher-name-' + str(size)]['R']['publisher_name']) == size
        assert len(families['publisher-name-' + str(size)]['R']['publisher_name'].encode()) == 4 * size
        assert len(families['approval-reference-' + str(size)]['C']['approval_reference']) == size
    for size in [3999, 4000]:
        assert len(families['owner-reason-' + str(size)]['P']['request']['reason']) == size
    for kind, size in [('administration',99), ('administration',100), ('eligibility',100), ('routing',100)]:
        assert len(families[f'roster-{kind}-{size}']['C']['body']['members']) == size
    assert families['policy-now-lower-2026']['R']['published_at'] == '2026-01-01T00:00:00.000000Z'
    assert instant(families['policy-at-plus-one-microsecond']['D']['body']['effective_from']) - instant(families['policy-at-plus-one-microsecond']['R']['published_at']) == timedelta(microseconds=1)
    for case in cases:
        arg = decode(case['argument_jsonb_text'])
        assert len(case['argument_jsonb_text'].encode()) == case['argument_utf8_bytes']
        if case['expected']['outcome'] == 'success':
            expected = case['expected']['return_jsonb_text']
            if case['function'] == 'configuration_record':
                assert decode(expected) == families[case['base']]['R']
            else:
                assert expected == case['argument_jsonb_text']
        else:
            assert case['expected']['sqlstate'] == '23514'
            if 'publisher-name-' in case['id']:
                assert len(arg['publisher_name']) in [0, 201]
            elif 'approval-reference-' in case['id']:
                assert len(arg['approval_reference']) in [0, 201]
            elif 'owner-reason-' in case['id']:
                assert len(arg['publication']['request']['reason']) in [0, 4001]
            elif 'roster-' in case['id']:
                members = arg['body']['members']
                assert len(members) in [0, 101]
                actors = [member['actor_id'] for member in members]
                assert actors == sorted(set(actors))
            elif 'fractional-offset-' in case['id']:
                item = arg['calendar_observation']['local_values'][0]
                candidate = item['candidates'][0]
                delta = instant(candidate['utc']) + timedelta(seconds=candidate['offset_seconds']) - datetime.strptime(item['local_timestamp'], '%Y-%m-%dT%H:%M:%S')
                assert abs(delta) == timedelta(seconds=1)
    assert len(rows) == 17 and len(cases) == 85
    print(json.dumps({'status':'OFFLINE_BOUNDARY_CONSISTENCY_ONLY','families':len(rows),'cases':len(cases),'positive_max_bytes':dict(maxima),'sql_executed':False,'postgres_renderer_confirmed':False},sort_keys=True))


if __name__ == '__main__':
    main()
