"""Finite independent boundary addendum. No SQL/driver/network/target imports."""
from copy import deepcopy
from datetime import datetime, timedelta
from hashlib import sha256
from pathlib import Path
import importlib.util
import json
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
ORIGINAL = ROOT.parent / 'configuration-record-vectors'
ORIGINAL_MANIFEST_SHA = '124145aed3ca5b82f35526b4486ba5d54b117e014879da897cc1d93b545fd7e1'
ENCODER_SHA = 'ff0c31eece06e4fed23a7632ea907a995e87ca9dd86ceeba11f0635696446488'
FAMILIES_SHA = '02cf2efb2413a2d528984847a293a0d9b991ae01fa81dd2edb9aefea2e7ee6ae'


def dependency():
    raw = (ORIGINAL / 'freeze-manifest.json').read_bytes()
    assert sha256(raw).hexdigest() == ORIGINAL_MANIFEST_SHA
    manifest = json.loads(raw)
    for name, expected in manifest['files'].items():
        content = (ORIGINAL / name).read_bytes()
        assert len(content) == expected['bytes'] and sha256(content).hexdigest() == expected['sha256'], name
    assert manifest['files']['build_corpus.py']['sha256'] == ENCODER_SHA
    assert manifest['files']['families.json']['sha256'] == FAMILIES_SHA
    spec = importlib.util.spec_from_file_location('frozen_independent_values', ORIGINAL / 'build_corpus.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build():
    old = dependency()
    original = {row['id']: {key: old.decode(item['jsonb_text']) for key, item in row['values'].items()}
                for row in json.loads((ORIGINAL / 'families.json').read_text())}
    families = []
    cases = []

    def make(label, c, *, reason=None, name=None, published=old.NOW, observation=None):
        kwargs = {'published': published}
        if reason is not None:
            kwargs['reason'] = reason
        f = old.family(label, c, observation, **kwargs)
        if name is not None:
            assert c['kind'] != 'administration'
            for key in ['R', 'Q', 'T']:
                f[key]['publisher_name'] = name
            h = old.digest({key: value for key, value in f['R'].items() if key != 'record_hash'})
            for key in ['R', 'Q', 'T']:
                f[key]['record_hash'] = h
        families.append(f)
        return f

    for length in [199, 200]:
        make('publisher-name-' + str(length), original['routing-enabled-first']['C'], name='🐾' * length)
        c = deepcopy(original['routing-enabled-first']['C']); c['approval_reference'] = '🐾' * length
        make('approval-reference-' + str(length), c)
    for length in [3999, 4000]:
        make('owner-reason-' + str(length), original['administration-enabled-first']['C'], reason='🐾' * length)
    c = deepcopy(original['routing-enabled-first']['C']); c['approval_reference'] = 'A'
    make('minimum-name-and-approval-1', c, name='N')
    c = deepcopy(original['administration-enabled-first']['C']); c['approval_reference'] = 'A'
    make('minimum-owner-reason-1', c, reason='R')
    for kind, count in [('administration', 99), ('administration', 100), ('eligibility', 100), ('routing', 100)]:
        c = deepcopy(original[kind + '-enabled-first']['C'])
        template = c['body']['members'][0]
        c['body']['members'] = [dict(deepcopy(template), actor_id=f'20000000-0000-4000-8000-{index:012x}') for index in range(1, count + 1)]
        make('roster-' + kind + '-' + str(count), c)
    lower = '2026-01-01T00:00:00.000000Z'
    make('policy-now-lower-2026', original['policy-enabled-first']['C'], published=lower)
    c = deepcopy(original['policy-at']['C']); c['body']['effective_from']['at'] = lower
    make('policy-at-lower-2026', c, published=lower)
    c = deepcopy(original['policy-at']['C']); c['body']['effective_from']['at'] = '2026-10-20T12:00:00.000002Z'
    make('policy-at-plus-one-microsecond', c)
    make('policy-now-next-microsecond', original['policy-enabled-first']['C'], published='2026-10-20T12:00:00.000002Z')
    c = deepcopy(original['calendar-enabled-first']['C'])
    c['body'] = {'zone': 'Synthetic/Fractional', 'first_date': '2026-10-20', 'last_date': '2026-10-20', 'days': [
        {'date': '2026-10-20', 'staffed': True, 'start_utc': '2026-10-19T18:15:00.000000Z', 'end_utc': '2026-10-20T18:15:00.000000Z',
         'close_local': '17:00:00', 'close_fold': 0, 'close_utc': '2026-10-20T11:15:00.000000Z'}]}
    observation = {'zone': 'Synthetic/Fractional', 'postgres_version': 'Synthetic retained fractional offset', 'local_values': [
        {'local_timestamp': '2026-10-20T00:00:00', 'candidates': [{'utc': '2026-10-19T18:15:00.000000Z', 'offset_seconds': 20700}]},
        {'local_timestamp': '2026-10-20T17:00:00', 'candidates': [{'utc': '2026-10-20T11:15:00.000000Z', 'offset_seconds': 20700}]},
        {'local_timestamp': '2026-10-21T00:00:00', 'candidates': [{'utc': '2026-10-20T18:15:00.000000Z', 'offset_seconds': 20700}]}]}
    make('calendar-fractional-offset-20700', c, observation=observation)
    by_id = {family['id']: family for family in families}

    def add(label, shape, argument, valid, base, delta, support=None):
        function, code = old.TARGETS[shape]
        text = old.pgtext(argument)
        cases.append({'id': 'boundary/' + label, 'function': function, 'base': base, 'delta': delta,
                      'supporting_changes': support or [], 'argument_kind': 'jsonb', 'argument_jsonb_text': text,
                      'argument_utf8_bytes': len(text.encode()),
                      'expected': {'outcome': 'success', 'return_jsonb_text': old.pgtext(by_id[base]['R']) if shape == 'Q' else text}
                      if valid else {'outcome': 'error', 'sqlstate': '23514', 'message': code}})

    for f in families:
        for shape in old.TARGETS:
            add('positive/' + f['id'] + '/' + shape, shape, f[shape], True, f['id'], 'independent legal boundary family')

    def change(label, shape, base, path, replacement, repair=False):
        value = deepcopy(by_id[base][shape]); cursor = value
        for key in path[:-1]:
            cursor = cursor[key]
        cursor[path[-1]] = replacement
        support = []
        if repair:
            assert shape == 'R'
            value['record_hash'] = old.digest({k: v for k, v in value.items() if k != 'record_hash'})
            support = ['independent record hash recomputed, so digest mismatch does not substitute for intended boundary']
        add('negative/' + label, shape, value, False, base, {'path': path, 'replacement_jsonb_text': old.pgtext(replacement)}, support)

    for length in [0, 201]:
        change('publisher-name-' + str(length), 'R', 'publisher-name-200', ['publisher_name'], '🐾' * length, repair=True)
        change('approval-reference-' + str(length), 'D', 'approval-reference-200', ['approval_reference'], '🐾' * length)
    for length in [0, 4001]:
        pair = deepcopy(by_id['owner-reason-4000']['pair'])
        p = pair['publication']; p['request']['reason'] = '🐾' * length
        p['request_hash'] = old.digest(p['request']); p['receipt']['request_hash'] = p['request_hash']
        add('negative/owner-reason-' + str(length), 'pair', pair, False, 'owner-reason-4000', {'path': ['publication', 'request', 'reason'], 'characters': length}, ['request hash recomputed', 'receipt request hash rebound'])
    for kind in ['administration', 'eligibility', 'routing']:
        base = 'roster-' + kind + '-100'
        members = deepcopy(by_id[base]['D']['body']['members'])
        members.append(dict(deepcopy(members[-1]), actor_id='20000000-0000-4000-8000-000000000065'))
        assert len(members) == 101
        change('roster-' + kind + '-101', 'D', base, ['body', 'members'], members)
        change('roster-' + kind + '-enabled-zero', 'D', base, ['body', 'members'], [])
    change('policy-lower-minus-microsecond', 'D', 'policy-now-lower-2026', ['body', 'effective_from'], '2025-12-31T23:59:59.999999Z')
    change('policy-at-minus-one-microsecond', 'R', 'policy-at-plus-one-microsecond', ['body', 'effective_from'], '2026-10-20T12:00:00.000000Z', repair=True)
    pair = deepcopy(by_id['policy-now-next-microsecond']['pair'])
    r = deepcopy(by_id['policy-now-next-microsecond']['R'])
    r['body']['effective_from'] = '2026-10-20T12:00:00.000003Z'
    r['record_hash'] = old.digest({k: v for k, v in r.items() if k != 'record_hash'})
    pair['configuration']['document']['body']['effective_from'] = r['body']['effective_from']
    pair['configuration']['effective_from'] = r['body']['effective_from']
    pair['configuration']['record_hash'] = r['record_hash']; pair['publication']['receipt']['record_hash'] = r['record_hash']
    add('negative/policy-now-resolved-plus-one-microsecond', 'pair', pair, False, 'policy-now-next-microsecond', 'original now resolves one microsecond after retained published_at', ['coherent stored/R scalar values', 'record hash recomputed', 'receipt record hash rebound'])
    for offset in [20699, 20701]:
        change('fractional-offset-' + str(offset), 'D', 'calendar-fractional-offset-20700', ['calendar_observation', 'local_values', 0, 'candidates', 0, 'offset_seconds'], offset)

    assert len({case['id'] for case in cases}) == len(cases)
    snapshots = []
    for f in families:
        snapshots.append({'id': f['id'], 'values': {k: {'jsonb_text': old.pgtext(v), 'utf8_bytes': len(old.pgtext(v).encode()), 'sha256': old.digest(v)} for k, v in f.items() if k != 'id'},
                          'record_hash_preimage': old.pgtext({k: v for k, v in f['R'].items() if k != 'record_hash'}),
                          'request_hash_preimage': old.pgtext(f['P']['request'])})
    summary = {'kind': 'independent-record-boundary-addendum-v1', 'original_manifest_sha256': ORIGINAL_MANIFEST_SHA,
               'encoder_sha256': ENCODER_SHA, 'original_family_literals_sha256': FAMILIES_SHA,
               'families': len(families), 'cases': len(cases), 'success_cases': sum(c['expected']['outcome'] == 'success' for c in cases),
               'refusal_cases': sum(c['expected']['outcome'] == 'error' for c in cases), 'database_runs': 0, 'postgres_renderer_confirmed': False}
    return {'families.json': snapshots, 'cases.json': cases, 'inventory.json': summary}


def main():
    outputs = build()
    for name, value in outputs.items():
        raw = (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
        if sys.argv[1:] == ['--write-new']:
            with (ROOT / name).open('xb') as handle:
                handle.write(raw)
        elif sys.argv[1:] == ['--check']:
            assert (ROOT / name).read_bytes() == raw, name
        else:
            raise SystemExit('Use --write-new or --check')
    print(json.dumps(outputs['inventory.json'], sort_keys=True))


if __name__ == '__main__':
    main()
