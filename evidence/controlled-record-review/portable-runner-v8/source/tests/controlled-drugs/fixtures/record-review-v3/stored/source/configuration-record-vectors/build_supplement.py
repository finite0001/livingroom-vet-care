"""Additional frozen cases; preserves initial corpus artifacts byte-for-byte."""
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
import json
import sys

from build_corpus import ACTOR, SESSION, AUTHORIZATION, OWNER, NAME, NOW, FUTURE, OTHER, TARGETS, digest, pgtext, decode

ROOT = Path(__file__).resolve().parent


def build():
    rows = json.loads((ROOT / 'families.json').read_text())
    families = {row['id']: {key: decode(item['jsonb_text']) for key, item in row['values'].items()} for row in rows}
    cases = []

    def add(label, shape, argument, base, delta, support=None):
        function, code = TARGETS[shape]
        text = pgtext(argument)
        cases.append({'id': 'supplement/' + label, 'function': function, 'base': base, 'delta': delta,
                      'supporting_changes': support or [], 'argument_kind': 'jsonb', 'argument_jsonb_text': text,
                      'argument_utf8_bytes': len(text.encode()), 'expected': {'outcome': 'error', 'sqlstate': '23514', 'message': code}})

    def mutate(label, shape, path, replacement, base='policy-enabled-first', repair=False):
        argument = deepcopy(families[base][shape]); cursor = argument
        for key in path[:-1]:
            cursor = cursor[key]
        cursor[path[-1]] = deepcopy(replacement)
        support = []
        if repair:
            argument['record_hash'] = digest({k: v for k, v in argument.items() if k != 'record_hash'})
            support = ['record_hash recomputed from altered independent literal R']
        add(label, shape, argument, base, {'path': path, 'replacement_jsonb_text': pgtext(replacement)}, support)

    # Coherent provenance tuples isolate forbidden kind rather than partial-null errors.
    for base, mode in [('routing-enabled-first', 'owner_bootstrap'), ('routing-enabled-successor', 'owner_recovery')]:
        r = deepcopy(families[base]['R'])
        r.update(publication_mode=mode, publisher_actor_id=None, publisher_session_id=None, authorization_id=None, publisher_name=OWNER)
        r['record_hash'] = digest({k: v for k, v in r.items() if k != 'record_hash'})
        add('matrix/owner-nonadministration/' + mode, 'R', r, base, 'owner provenance tuple with nonadministration kind', ['coherent owner tuple', 'record_hash recomputed'])
    r = deepcopy(families['administration-enabled-first']['R'])
    r.update(publication_mode='staff', publisher_actor_id=ACTOR, publisher_session_id=SESSION, authorization_id=AUTHORIZATION, publisher_name=NAME)
    r['record_hash'] = digest({k: v for k, v in r.items() if k != 'record_hash'})
    add('matrix/staff-administration', 'R', r, 'administration-enabled-first', 'staff provenance tuple with administration kind', ['coherent staff tuple', 'record_hash recomputed'])

    # Changed original request has its correct new hash and bound receipt; stored
    # record stays unchanged. Therefore record/request transformation must reject.
    for base, path, replacement, label in [
        ('policy-at', ['document', 'body', 'effective_from', 'at'], FUTURE, 'at-different-stored'),
        ('policy-at', ['document', 'body', 'effective_from', 'at'], '2026-10-20T12:00:00.000000Z', 'at-before-published'),
        ('routing-enabled-first', ['document', 'approval_reference'], 'Changed valid approval', 'nonpolicy-approval'),
        ('calendar-enabled-first', ['document', 'body', 'zone'], 'Other/Retained', 'calendar-body-no-rewrite'),
        ('policy-enabled-first', ['document', 'body', 'routing_id'], OTHER, 'policy-reference'),
        ('policy-enabled-first', ['actor_id'], OTHER, 'actor-binding'),
        ('policy-enabled-first', ['operation_id'], OTHER, 'operation-binding'),
        ('policy-enabled-first', ['record_id'], OTHER, 'record-binding'),
    ]:
        pair = deepcopy(families[base]['pair']); cursor = pair['publication']['request']
        for key in path[:-1]:
            cursor = cursor[key]
        cursor[path[-1]] = replacement
        p = pair['publication']; p['request_hash'] = digest(p['request']); p['receipt']['request_hash'] = p['request_hash']
        add('request-coherent/' + label, 'pair', pair, base, {'path': ['publication', 'request'] + path, 'replacement_jsonb_text': pgtext(replacement)}, ['request_hash recomputed', 'receipt.request_hash rebound'])

    # Each exact top-level DTO field is rejected in a representative wrong type.
    # Present nullable fields become objects; booleans/numbers become strings;
    # strings become booleans; objects become arrays. No transport decode errors.
    for shape in ['D', 'R', 'Q', 'pair']:
        base = 'policy-enabled-first'
        for key, original in families[base][shape].items():
            wrong = {} if original is None else [] if isinstance(original, dict) else 'wrong-type' if isinstance(original, (bool, int)) else True
            mutate('top-type/' + shape + '/' + key, shape, [key], wrong, base, repair=shape == 'R' and key != 'record_hash')
        for key, original in families[base][shape].items():
            if original is not None:
                mutate('top-null/' + shape + '/' + key, shape, [key], None, base, repair=shape == 'R' and key != 'record_hash')
    for object_name in ['request', 'receipt']:
        for key, original in families['policy-enabled-first']['P'][object_name].items():
            wrong = {} if original is None else [] if isinstance(original, dict) else 'wrong-type' if isinstance(original, (bool, int)) else True
            mutate('publication-' + object_name + '-type/' + key, 'pair', ['publication', object_name, key], wrong)
            if original is not None:
                mutate('publication-' + object_name + '-null/' + key, 'pair', ['publication', object_name, key], None)
    for key, original in families['policy-enabled-first']['P'].items():
        wrong = {} if original is None else [] if isinstance(original, dict) else 'wrong-type' if isinstance(original, (bool, int)) else True
        mutate('publication-top-type/' + key, 'pair', ['publication', key], wrong)

    for base in ['administration-enabled-first', 'calendar-enabled-first', 'eligibility-enabled-first', 'routing-enabled-first']:
        mutate('caller-validator-reuse/' + base + '/schema-fraction', 'D', ['schema_version'], Decimal('1.0'), base)
        mutate('caller-validator-reuse/' + base + '/product-zero', 'D', ['scope', 'product_id'], '00000000-0000-0000-0000-000000000000', base)
        mutate('caller-validator-reuse/' + base + '/approval-empty', 'D', ['approval_reference'], '', base)
    for label, value in [('null', None), ('boolean', True), ('fractional', Decimal('2.0')), ('zero', 0), ('overflow', 2147483648), ('string', '2')]:
        mutate('row/version/' + label, 'Q', ['version'], value, 'policy-enabled-successor')
    for key in ['kind', 'product_id', 'site_id', 'event_kind', 'capability']:
        original = families['policy-enabled-first']['stream'][key]
        mutate('stream-type/' + key, 'Q', ['stream_key', key], {} if original is None else True)
    for label, value in [('empty', ''), ('leading-space', ' approval'), ('trailing-space', 'approval '), ('newline', 'a\nb'), ('tab', 'a\tb'), ('too-long', '火' * 201)]:
        mutate('approval/' + label, 'D', ['approval_reference'], value)
    mutate('policy/now-at-not-null', 'pair', ['publication', 'request', 'document', 'body', 'effective_from', 'at'], NOW)
    mutate('policy/at-null', 'pair', ['publication', 'request', 'document', 'body', 'effective_from', 'at'], None, 'policy-at')
    mutate('policy/effective-mode-unknown', 'pair', ['publication', 'request', 'document', 'body', 'effective_from', 'mode'], 'later')
    mutate('calendar/staffed-type', 'D', ['body', 'days', 0, 'staffed'], 'true', 'calendar-enabled-first')
    mutate('calendar/fold-out-of-range', 'D', ['body', 'days', 0, 'close_fold'], 2, 'calendar-fold1')
    for label, value in [('null', None), ('string', '0'), ('too-negative', -50401)]:
        mutate('calendar/offset-' + label, 'D', ['calendar_observation', 'local_values', 0, 'candidates', 0, 'offset_seconds'], value, 'calendar-enabled-first')
    for field in ['close_local', 'close_fold', 'close_utc']:
        mutate('calendar/closed-with-' + field, 'D', ['body', 'days', 0, field], {'close_local': '17:00:00', 'close_fold': 0, 'close_utc': '2026-10-20T17:00:00.000000Z'}[field], 'calendar-closed-day')
    assert len({case['id'] for case in cases}) == len(cases)
    return cases


def main():
    cases = build()
    raw = (json.dumps(cases, ensure_ascii=False, indent=2) + '\n').encode()
    output = ROOT / 'supplement-cases.json'
    if sys.argv[1:] == ['--write-new']:
        with output.open('xb') as handle:
            handle.write(raw)
    elif sys.argv[1:] == ['--check']:
        assert output.read_bytes() == raw
    else:
        raise SystemExit('Use --write-new or --check')
    print(json.dumps({'cases': len(cases), 'outcome': 'all_declared_23514_refusals', 'sql_executed': False}, sort_keys=True))


if __name__ == '__main__':
    main()
