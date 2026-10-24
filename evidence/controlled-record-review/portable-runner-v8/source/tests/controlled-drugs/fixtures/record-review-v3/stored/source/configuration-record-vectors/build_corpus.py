"""Independent, offline-only contract examples. Never import implementation code.

This encoder implements only the explicitly declared JSONB-text subset used here.
Frozen output must be checked by PostgreSQL ::text BEFORE any target helper call.
Passing these Python checks is not PostgreSQL/runtime acceptance.
"""
from copy import deepcopy
from datetime import datetime, timedelta
from decimal import Decimal
from hashlib import sha256
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parent
CONTRACT_SHA = '69e182574806c78a8bbc0fd4da1e4713bb0b83ceb2b9d86f2ce8bb12c6309e0f'


def string(value):
    parts = ['"']
    escapes = {'"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t'}
    for char in value:
        point = ord(char)
        if point == 0 or 0xD800 <= point <= 0xDFFF:
            raise ValueError('outside PostgreSQL UTF-8 jsonb string domain')
        parts.append(escapes.get(char, '\\u%04x' % point if point < 32 else char))
    return ''.join(parts) + '"'


def pgtext(value):
    if value is None:
        return 'null'
    if value is True:
        return 'true'
    if value is False:
        return 'false'
    if isinstance(value, str):
        return string(value)
    if type(value) is int:
        return str(value)
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError('nonfinite JSON number')
        return format(abs(value) if value == 0 else value, 'f')
    if isinstance(value, list):
        return '[' + ', '.join(pgtext(v) for v in value) + ']'
    if isinstance(value, dict):
        if not all(isinstance(k, str) for k in value):
            raise ValueError('nonstring object key')
        keys = sorted(value, key=lambda k: (len(k.encode('utf-8')), k.encode('utf-8')))
        return '{' + ', '.join(string(k) + ': ' + pgtext(value[k]) for k in keys) + '}'
    raise TypeError(type(value).__name__)


def digest(value):
    return sha256(pgtext(value).encode('utf-8')).hexdigest()


def duplicate_free(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate wire key: decoder-only refusal')
        result[key] = value
    return result


def decode(text):
    return json.loads(text, parse_float=Decimal, object_pairs_hook=duplicate_free)


# Independently written expected text anchors; not produced by pgtext.
ANCHORS = [
    ('key_length_then_utf8', '{"aa":1,"b":2,"é":3,"a":4}', '{"a": 4, "b": 2, "aa": 1, "é": 3}'),
    ('unicode_direct', '{"name":"Zoë 火 🐾"}', '{"name": "Zoë 火 🐾"}'),
    ('escaping', r'{"s":"quote\" backslash\\ slash/ line\n tab\t back\b form\f return\r control\u0001"}', r'{"s": "quote\" backslash\\ slash/ line\n tab\t back\b form\f return\r control\u0001"}'),
    ('numeric_scale', '[1,1.0,3.0,1e2,1e-2,-0.0]', '[1, 1.0, 3.0, 100, 0.01, 0.0]'),
    ('array_order_null_boolean', '[null,true,false,{"zz":0,"b":1},[]]', '[null, true, false, {"b": 1, "zz": 0}, []]'),
    ('empty_objects', '{"b":{},"a":[]}', '{"a": [], "b": {}}'),
]

PRODUCT = '10000000-0000-4000-8000-000000000001'
SITE = '10000000-0000-4000-8000-000000000002'
ACTOR = '10000000-0000-4000-8000-000000000003'
SESSION = '10000000-0000-4000-8000-000000000004'
AUTHORIZATION = '10000000-0000-4000-8000-000000000005'
RECORD = '10000000-0000-4000-8000-000000000006'
OPERATION = '10000000-0000-4000-8000-000000000007'
PREDECESSOR = '10000000-0000-4000-8000-000000000008'
CALENDAR = '10000000-0000-4000-8000-000000000009'
ROUTING = '10000000-0000-4000-8000-00000000000a'
OTHER = '10000000-0000-4000-8000-00000000000b'
NOW = '2026-10-20T12:00:00.000001Z'
FUTURE = '2026-10-21T12:00:00.000002Z'
OWNER = 'Database owner (postgres)'
NAME = 'Zoë 火 🐾'

KINDS = [
 'receive_inventory', 'adjust_inventory', 'record_patient_treatment',
 'record_anesthesia_drug_administration', 'record_native_dispense', 'record_native_pickup',
 'record_native_dispense_return:intake', 'record_native_dispense_return:dispose',
 'record_native_dispense_return:restock', 'record_native_dispense_return_v2:intake',
 'record_native_dispense_return_v2:dispose', 'record_native_dispense_return_v2:restock',
 'record_native_dispense_return_v2:retract_intake', 'record_native_dispense_return_v2:retract_disposal',
 'record_native_dispense_return_v2:retract_restock', 'record_native_return_discrepancy:report',
 'record_native_return_discrepancy:note', 'record_native_return_discrepancy:resolve_corrected',
 'record_native_return_discrepancy:resolve_confirmed_original',
 'append_native_dispense_correction:clinical_annotation',
 'append_native_dispense_correction:operational_annotation',
 'append_native_dispense_correction:pickup_amendment',
]


def stamp(value):
    return value.strftime('%Y-%m-%dT%H:%M:%S.%fZ')


def calendar_values(count=1, fold=None, upper=False):
    first = datetime(2100, 12, 31) if upper else datetime(2026, 11, 1) if fold is not None else datetime(2026, 10, 20)
    zone = 'Synthetic/Retained'
    observations = {}
    days = []
    for index in range(count):
        date = first + timedelta(days=index)
        start_offset = 3600 if upper else -14400 if fold is not None else 0
        end_offset = 3600 if upper else -18000 if fold is not None else 0
        close = date + timedelta(hours=1, minutes=30) if fold is not None else date + timedelta(hours=17)
        def observed(local, offsets):
            candidates = sorted([{'utc': stamp(local - timedelta(seconds=offset)), 'offset_seconds': offset} for offset in offsets], key=lambda row: row['utc'])
            observations[local.strftime('%Y-%m-%dT%H:%M:%S')] = candidates
            return candidates
        start = observed(date, [start_offset])[0]['utc']
        end = observed(date + timedelta(days=1), [end_offset])[0]['utc']
        closes = observed(close, [-14400, -18000] if fold is not None else [start_offset])
        days.append({'date': date.strftime('%Y-%m-%d'), 'staffed': True, 'start_utc': start, 'end_utc': end,
                     'close_local': close.strftime('%H:%M:%S'), 'close_fold': fold or 0, 'close_utc': closes[fold or 0]['utc']})
    body = {'zone': zone, 'first_date': days[0]['date'], 'last_date': days[-1]['date'], 'days': days}
    observation = {'zone': zone, 'postgres_version': 'Synthetic retained version — no environment assertion',
                   'local_values': [{'local_timestamp': key, 'candidates': observations[key]} for key in sorted(observations)]}
    return body, observation


def caller(kind, enabled=True, successor=False, effective='now', native=None):
    scope = {'product_id': PRODUCT, 'site_id': None if kind == 'administration' else SITE, 'event_kind': None, 'capability': None}
    if kind == 'eligibility':
        scope.update(event_kind='receive_inventory', capability='review')
    if kind == 'policy':
        rules = {}
        for name in KINDS:
            recorded = ':retract_' in name or name.startswith('record_native_return_discrepancy:') or name.startswith('append_native_dispense_correction:')
            active = enabled
            deadline = active and (name in ('record_patient_treatment', 'record_anesthesia_drug_administration') or name == native)
            escalation = 'overdue' if deadline else 'immediate_on_record' if active and name == 'record_native_return_discrepancy:report' else 'not_configured'
            rules[name] = {'enabled': active, 'adapter_version': 1, 'meaning': 'independent_record_review_v1', 'quorum': 1,
                           'deadline_mode': 'next_staffed_day_close' if deadline else 'not_configured',
                           'deadline_anchor': 'recorded_at' if recorded else 'observed_at', 'escalation_mode': escalation}
        body = {'effective_from': {'mode': effective, 'at': None if effective == 'now' else NOW if effective == 'at' else FUTURE},
                'calendar_id': CALENDAR, 'routing_id': ROUTING, 'native_deadline_kind': native, 'rules': rules}
        if effective == 'future':
            body['effective_from']['mode'] = 'at'
    elif kind == 'calendar':
        body, _ = calendar_values()
    else:
        member = {'actor_id': ACTOR, 'roles': ['ADMIN', 'DVM', 'STAFF', 'TECH']}
        if kind == 'administration':
            member['capabilities'] = ['audit', 'manage_eligibility', 'manage_escalation', 'publish_calendar', 'publish_policy', 'publish_routing']
        body = {'members': [member] if enabled else []}
    return {'schema_version': 1, 'kind': kind, 'scope': scope, 'version': 2 if successor else 1,
            'predecessor_id': PREDECESSOR if successor else None, 'predecessor_hash': 'a' * 64 if successor else None,
            'enabled': enabled, 'body': body, 'approval_reference': 'Synthetic approval — 火'}


def family(name, c, observation=None, published=NOW, reason='Synthetic owner rationale 火\nSecond line\tretained.'):
    """Independent expected assembly written before target implementation exists."""
    c = deepcopy(c)
    d = deepcopy(c)
    if c['kind'] == 'policy':
        effective = c['body']['effective_from']
        d['body']['effective_from'] = published if effective['mode'] == 'now' else effective['at']
    d['calendar_observation'] = observation if c['kind'] == 'calendar' else None
    owner = c['kind'] == 'administration'
    mode = ('owner_bootstrap' if c['version'] == 1 else 'owner_recovery') if owner else 'staff'
    # Explicitly authored expected metadata and stream; no target projector call.
    metadata = {'id': RECORD, 'publication_operation_id': OPERATION, 'published_at': published,
                'publisher_actor_id': None if owner else ACTOR, 'publisher_session_id': None if owner else SESSION,
                'publisher_name': OWNER if owner else NAME, 'authorization_id': None if owner else AUTHORIZATION,
                'publication_mode': mode}
    r = deepcopy(d)
    r.update(metadata)
    r['record_hash'] = digest(r)
    stream = {'kind': c['kind'], 'product_id': c['scope']['product_id'], 'site_id': c['scope']['site_id'],
              'event_kind': c['scope']['event_kind'], 'capability': c['scope']['capability']}
    q = {'id': RECORD, 'kind': c['kind'], 'stream_key': stream, 'version': c['version'],
         'predecessor_id': c['predecessor_id'], 'predecessor_hash': c['predecessor_hash'], 'enabled': c['enabled'],
         'document': deepcopy(d), 'record_hash': r['record_hash'], 'publication_operation_id': OPERATION,
         'published_at': published, 'publisher_actor_id': metadata['publisher_actor_id'],
         'publisher_session_id': metadata['publisher_session_id'], 'publisher_name': metadata['publisher_name'],
         'authorization_id': metadata['authorization_id'], 'publication_mode': mode,
         'effective_from': d['body']['effective_from'] if c['kind'] == 'policy' else None}
    request = {'operation_id': OPERATION, 'record_id': RECORD, 'document': deepcopy(c)}
    request['reason' if owner else 'actor_id'] = reason if owner else ACTOR
    request_hash = digest(request)
    t = {'version': 3, 'operation_id': OPERATION, 'request_hash': request_hash, 'record_id': RECORD,
         'record_hash': r['record_hash'], 'publisher_actor_id': metadata['publisher_actor_id'],
         'publisher_session_id': metadata['publisher_session_id'], 'publisher_name': metadata['publisher_name'],
         'authorization_id': metadata['authorization_id'], 'publication_mode': mode, 'published_at': published}
    p = {'operation_id': OPERATION, 'actor_id': metadata['publisher_actor_id'], 'request': request,
         'request_hash': request_hash, 'record_id': RECORD, 'receipt': t, 'recorded_at': published, 'mode': mode}
    return {'id': name, 'C': c, 'D': d, 'R': r, 'Q': q, 'P': p, 'T': t, 'pair': {'configuration': q, 'publication': p}, 'stream': stream}


TARGETS = {'D': ('validate_stored_configuration', 'stored_configuration_invalid'),
           'R': ('validate_configuration_record', 'configuration_record_invalid'),
           'Q': ('configuration_record', 'configuration_record_invalid'),
           'pair': ('validate_configuration_pair', 'configuration_pair_invalid')}


def build():
    families = []
    for kind in ['administration', 'policy', 'eligibility', 'calendar', 'routing']:
        for enabled, successor in [(True, False), (False, False), (True, True), (False, True)]:
            c = caller(kind, enabled, successor)
            observation = None
            if kind == 'calendar':
                c['body'], observation = calendar_values()
            families.append(family(f'{kind}-{"enabled" if enabled else "disabled"}-{"successor" if successor else "first"}', c, observation))
    for effective in ['at', 'future']:
        families.append(family('policy-' + effective, caller('policy', effective=effective)))
    for native in ['record_native_dispense', 'record_native_pickup']:
        families.append(family('policy-native-' + native, caller('policy', native=native)))
    for count, fold, upper, label in [(3, None, False, 'three-days'), (31, None, False, '31-days'), (1, 0, False, 'fold0'), (1, 1, False, 'fold1'), (1, None, True, 'local-2101-boundary')]:
        c = caller('calendar')
        c['body'], observation = calendar_values(count, fold, upper)
        families.append(family('calendar-' + label, c, observation))
    c = caller('calendar')
    c['body'], observation = calendar_values()
    day = c['body']['days'][0]
    day.update(staffed=False, close_local=None, close_fold=None, close_utc=None)
    observation['local_values'] = [v for v in observation['local_values'] if v['local_timestamp'].endswith('T00:00:00')]
    families.append(family('calendar-closed-day', c, observation))
    c = caller('administration')
    c['body']['members'][0]['capabilities'] = []
    families.append(family('owner-empty-capabilities', c))
    families.append(family('owner-coherent-different-reason', caller('administration'), reason='Different exact reason 火\nStill an internally consistent pair.'))
    for capability in ['read', 'exception_read']:
        c = caller('eligibility')
        c['scope'].update(capability=capability)
        if capability == 'exception_read':
            c['scope'].update(site_id=None, event_kind=None)
        families.append(family('eligibility-' + capability, c))
    family_by_id = {v['id']: v for v in families}
    cases = []

    def add(case_id, shape, value, valid, base=None, delta=None, caveat=None, repair=False):
        value = deepcopy(value)
        if repair:
            assert shape == 'R'
            value['record_hash'] = digest({k: v for k, v in value.items() if k != 'record_hash'})
        function, error = TARGETS[shape]
        text = pgtext(value)
        case = {'id': case_id, 'function': function, 'base': base, 'delta': delta,
                'argument_kind': 'jsonb', 'argument_jsonb_text': text, 'argument_utf8_bytes': len(text.encode()),
                'expected': {'outcome': 'success', 'return_jsonb_text': pgtext(family_by_id[base]['R']) if shape == 'Q' else text} if valid else {'outcome': 'error', 'sqlstate': '23514', 'message': error},
                'recomputed_record_hash_supporting_mutation': repair}
        if caveat:
            case['coverage_caveat'] = caveat
        cases.append(case)

    for f in families:
        for shape in TARGETS:
            add('positive/' + f['id'] + '/' + shape, shape, f[shape], True, f['id'])
    bases = {'D': family_by_id['policy-enabled-first'], 'R': family_by_id['policy-enabled-first'],
             'Q': family_by_id['policy-enabled-first'], 'pair': family_by_id['policy-enabled-first']}
    for shape, f in bases.items():
        for value, label in [(None, 'json-null'), ([], 'array'), ('object', 'string'), (True, 'boolean'), (1, 'number')]:
            add('outer/' + shape + '/' + label, shape, value, False, f['id'], 'replace complete argument')
        function, error = TARGETS[shape]
        cases.append({'id': 'outer/' + shape + '/sql-null', 'function': function, 'base': f['id'], 'delta': 'SQL NULL, not JSON null',
                      'argument_kind': 'sql_null', 'expected': {'outcome': 'error', 'sqlstate': '23514', 'message': error}})
        for key in f[shape]:
            value = deepcopy(f[shape]); del value[key]
            add(f'keys/{shape}/missing/{key}', shape, value, False, f['id'], f'delete {key}')
        value = deepcopy(f[shape]); value['unknown'] = None
        add(f'keys/{shape}/extra', shape, value, False, f['id'], 'add unknown')

    def mutate(case_id, shape, path, value=None, base=None, delete=False, repair=False, caveat=None):
        f = family_by_id[base] if base else bases[shape]
        original = deepcopy(f[shape])
        cursor = original
        for key in path[:-1]:
            cursor = cursor[key]
        if delete:
            del cursor[path[-1]]
        else:
            cursor[path[-1]] = deepcopy(value)
        add(case_id, shape, original, False, f['id'], {'path': path, 'action': 'delete' if delete else 'replace', 'replacement_jsonb_text': None if delete else pgtext(value)}, caveat, repair)

    # Every exact nested object key is independently omitted; unexpected keys too.
    def object_paths(value, path=()):
        if isinstance(value, dict):
            yield path, value
            for key, child in value.items():
                yield from object_paths(child, path + (key,))
        elif isinstance(value, list):
            for index, child in enumerate(value):
                yield from object_paths(child, path + (index,))

    for base in ['policy-enabled-first', 'administration-enabled-first', 'calendar-enabled-first', 'eligibility-enabled-first', 'routing-enabled-first']:
        f = family_by_id[base]
        for path, obj in object_paths(f['pair']):
            # The pair corpus includes all nested caller, stored, stream, receipt and observation shapes.
            if not path:
                continue
            label = '/'.join(map(str, path))
            for key in obj:
                mutate(f'nested-keys/{base}/{label}/missing/{key}', 'pair', list(path) + [key], base=base, delete=True)
            mutate(f'nested-keys/{base}/{label}/extra', 'pair', list(path) + ['unexpected'], None, base=base)

    for shape in ['D', 'R']:
        for key in ['schema_version', 'version']:
            for label, value in [('fractional', Decimal('1.0')), ('string', '1'), ('null', None), ('boolean', True), ('zero', 0), ('too-large', 2147483648), ('negative', -1)]:
                mutate(f'primitive/{shape}/{key}/{label}', shape, [key], value, repair=shape == 'R')
        for value, label in [(None, 'null'), ('true', 'string'), (1, 'number')]:
            mutate(f'primitive/{shape}/enabled/{label}', shape, ['enabled'], value, repair=shape == 'R')
    mutate('primitive/Q/version-visible-fraction', 'Q', ['version'], Decimal('1.0'))
    mutate('primitive/pair/receipt-version-visible-fraction', 'pair', ['publication', 'receipt', 'version'], Decimal('3.0'))
    for label, value in [('string', '3'), ('boolean', True), ('null', None), ('wrong', 2)]:
        mutate('primitive/pair/receipt-version-' + label, 'pair', ['publication', 'receipt', 'version'], value)
    for field in ['id', 'publication_operation_id', 'publisher_actor_id', 'publisher_session_id', 'authorization_id']:
        for label, value in [('null', None), ('zero', '00000000-0000-0000-0000-000000000000'), ('uppercase', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'), ('malformed', 'uuid'), ('number', 1)]:
            mutate(f'uuid/R/{field}/{label}', 'R', [field], value, repair=True)
    for field in ['record_hash']:
        for label, value in [('null', None), ('uppercase', 'A' * 64), ('short', 'a' * 63), ('wrong', 'f' * 64), ('number', 1)]:
            mutate(f'hash/R/{field}/{label}', 'R', [field], value)
    for key in ['predecessor_id', 'predecessor_hash']:
        mutate('predecessor/first/nonnull/' + key, 'R', [key], PREDECESSOR if key.endswith('id') else 'a' * 64, repair=True)
        mutate('predecessor/successor/null/' + key, 'R', [key], None, base='policy-enabled-successor', repair=True)
    mutate('predecessor/self', 'R', ['predecessor_id'], RECORD, base='policy-enabled-successor', repair=True)
    for label, value in [('uppercase', 'A' * 64), ('short', 'a' * 63), ('number', 1)]:
        mutate('predecessor/hash/' + label, 'R', ['predecessor_hash'], value, base='policy-enabled-successor', repair=True)

    malformed_times = {'offset': '2026-10-20T12:00:00.000001+00:00', 'short-fraction': '2026-10-20T12:00:00.001Z',
        'extra-fraction': '2026-10-20T12:00:00.0000011Z', 'infinity': 'infinity', 'null-string': 'null', 'null': None,
        'number': 1792497600, 'lowercase-z': '2026-10-20T12:00:00.000001z', 'invalid-leap': '2026-02-29T12:00:00.000001Z',
        'leap-second': '2026-10-20T12:00:60.000001Z', 'hour24': '2026-10-20T24:00:00.000001Z',
        'before-range': '2025-12-31T23:59:59.999999Z', 'upper-exclusive': '2101-01-01T00:00:00.000000Z'}
    for label, value in malformed_times.items():
        mutate('timestamp/published/' + label, 'R', ['published_at'], value, repair=True)
        mutate('timestamp/stored-policy/' + label, 'D', ['body', 'effective_from'], value)
        mutate('timestamp/recorded/' + label, 'pair', ['publication', 'recorded_at'], value)
    mutate('policy/stored-caller-object', 'D', ['body', 'effective_from'], {'mode': 'now', 'at': None})
    mutate('policy/effective-before-published', 'R', ['body', 'effective_from'], '2026-10-20T12:00:00.000000Z', repair=True)
    # Consistent record+Q changed now timestamp isolates original now binding at pair boundary.
    f = deepcopy(family_by_id['policy-enabled-first'])
    f['Q']['document']['body']['effective_from'] = FUTURE; f['Q']['effective_from'] = FUTURE
    f['R']['body']['effective_from'] = FUTURE; f['R']['record_hash'] = digest({k: v for k, v in f['R'].items() if k != 'record_hash'})
    f['Q']['record_hash'] = f['R']['record_hash']; f['P']['receipt']['record_hash'] = f['R']['record_hash']
    add('policy/now-other-instant-coherent-record', 'pair', {'configuration': f['Q'], 'publication': f['P']}, False, 'policy-enabled-first', 'resolved effective only; recompute record hash and bound receipt')
    mutate('policy/at-request-differs', 'pair', ['publication', 'request', 'document', 'body', 'effective_from', 'at'], FUTURE, base='policy-at', caveat='Also leaves request hash stale; separate coherent original-request cases below isolate semantic binding.')
    for key, value in [('kind', 'routing'), ('version', 2), ('predecessor_id', PREDECESSOR), ('predecessor_hash', 'a' * 64), ('enabled', False)]:
        mutate('row/repeated/' + key, 'Q', [key], value)
    for key, value in [('kind', 'routing'), ('product_id', OTHER), ('site_id', OTHER), ('event_kind', 'receive_inventory'), ('capability', 'read')]:
        mutate('row/stream/' + key, 'Q', ['stream_key', key], value)
    mutate('row/effective-mismatch', 'Q', ['effective_from'], FUTURE)
    mutate('row/nonpolicy-effective', 'Q', ['effective_from'], NOW, base='routing-enabled-first')

    for field in ['publisher_actor_id', 'publisher_session_id', 'authorization_id']:
        mutate('mode/staff-null/' + field, 'R', [field], None, repair=True)
        mutate('mode/owner-nonnull/' + field, 'R', [field], OTHER, base='administration-enabled-first', repair=True)
    for mode in ['owner_bootstrap', 'owner_recovery', 'unknown', None, True]:
        mutate('mode/staff-kind/' + str(mode), 'R', ['publication_mode'], mode, repair=True)
    mutate('mode/owner-kind-staff', 'R', ['publication_mode'], 'staff', base='administration-enabled-first', repair=True)
    mutate('mode/bootstrap-successor', 'R', ['publication_mode'], 'owner_bootstrap', base='administration-enabled-successor', repair=True)
    mutate('mode/recovery-first', 'R', ['publication_mode'], 'owner_recovery', base='administration-enabled-first', repair=True)
    mutate('mode/owner-name', 'R', ['publisher_name'], 'Database owner', base='administration-enabled-first', repair=True)
    for label, value in [('empty', ''), ('leading-space', ' Name'), ('trailing-space', 'Name '), ('newline', 'Name\nTwo'), ('tab', 'Name\tTwo'), ('long', '火' * 201), ('null', None), ('boolean', True)]:
        mutate('name/' + label, 'R', ['publisher_name'], value, repair=True)
    for key in ['operation_id', 'record_id', 'actor_id']:
        mutate('pair/row/' + key, 'pair', ['publication', key], OTHER)
        mutate('request/field/' + key, 'pair', ['publication', 'request', key], OTHER)
    mutate('pair/row/mode', 'pair', ['publication', 'mode'], 'owner_recovery')
    mutate('pair/row/recorded_at', 'pair', ['publication', 'recorded_at'], FUTURE)
    mutate('pair/request-hash', 'pair', ['publication', 'request_hash'], 'f' * 64)
    for key in family_by_id['policy-enabled-first']['T']:
        value = 2 if key == 'version' else FUTURE if key == 'published_at' else 'f' * 64 if key.endswith('hash') else 'different' if key in ['publisher_name', 'publication_mode'] else OTHER
        mutate('receipt/binding/' + key, 'pair', ['publication', 'receipt', key], value)
    mutate('owner/reason-only', 'pair', ['publication', 'request', 'reason'], 'Changed reason', base='administration-enabled-first')
    for label, value in [('empty', ''), ('leading-space', ' reason'), ('carriage-return', 'reason\rnext'), ('long', '火' * 4001), ('null', None), ('number', 1)]:
        mutate('owner/reason/' + label, 'pair', ['publication', 'request', 'reason'], value, base='administration-enabled-first')
    for key in ['actor_id', 'publisher_session_id', 'authorization_id']:
        mutate('owner/request-forbidden/' + key, 'pair', ['publication', 'request', key], OTHER, base='administration-enabled-first')
    mutate('request/observation-injection', 'pair', ['publication', 'request', 'document', 'calendar_observation'], None)
    mutate('observation/noncalendar-nonnull', 'D', ['calendar_observation'], {})
    for label, value in [('null', None), ('array', []), ('wrong-zone', {'zone': 'Other/Zone'})]:
        mutate('observation/calendar/' + label, 'D', ['calendar_observation'], value, base='calendar-enabled-first')
    for path, value, label in [
        (['calendar_observation', 'zone'], 'Other/Zone', 'zone'),
        (['calendar_observation', 'postgres_version'], '', 'empty-version'),
        (['calendar_observation', 'local_values'], [], 'missing-values'),
        (['calendar_observation', 'local_values', 0, 'candidates'], [], 'zero-candidates'),
        (['calendar_observation', 'local_values', 0, 'candidates', 0, 'offset_seconds'], 1, 'arithmetic'),
        (['calendar_observation', 'local_values', 0, 'candidates', 0, 'offset_seconds'], 50401, 'offset-bound'),
        (['calendar_observation', 'local_values', 0, 'candidates', 0, 'offset_seconds'], Decimal('0.0'), 'offset-fraction'),
        (['calendar_observation', 'local_values', 0, 'local_timestamp'], '2026-10-20T00:00:01', 'wrong-requested-local'),
        (['body', 'days', 0, 'close_fold'], 1, 'fold1-one-candidate'),
        (['body', 'days', 0, 'close_fold'], Decimal('0.0'), 'fold-fraction'),
        (['body', 'days', 0, 'close_utc'], '2026-10-20T00:00:00.000000Z', 'close-start-boundary'),
        (['body', 'days', 0, 'close_utc'], '2026-10-21T00:00:00.000000Z', 'close-end-boundary'),
        (['body', 'days', 0, 'end_utc'], '2026-10-20T00:00:00.000000Z', 'nonpositive-day'),
    ]:
        mutate('calendar/' + label, 'D', path, value, base='calendar-enabled-first')
    obs = family_by_id['calendar-enabled-first']['D']['calendar_observation']['local_values']
    mutate('calendar/local-values-order', 'D', ['calendar_observation', 'local_values'], list(reversed(obs)), base='calendar-enabled-first')
    mutate('calendar/local-values-duplicate', 'D', ['calendar_observation', 'local_values'], [obs[0]] + obs, base='calendar-enabled-first')
    mutate('calendar/local-values-64', 'D', ['calendar_observation', 'local_values'], [obs[0]] * 64, base='calendar-enabled-first', caveat='Count and duplicate/order invalidity overlap; not a pure cardinality boundary claim.')
    fold_obs = family_by_id['calendar-fold1']['D']['calendar_observation']['local_values'][1]['candidates']
    mutate('calendar/candidates-order', 'D', ['calendar_observation', 'local_values', 1, 'candidates'], list(reversed(fold_obs)), base='calendar-fold1')
    mutate('calendar/candidates-duplicate', 'D', ['calendar_observation', 'local_values', 1, 'candidates'], [fold_obs[0], fold_obs[0]], base='calendar-fold1')
    mutate('calendar/candidates-three', 'D', ['calendar_observation', 'local_values', 1, 'candidates'], fold_obs + [fold_obs[1]], base='calendar-fold1')
    mutate('calendar/adjacency', 'D', ['body', 'days', 1, 'start_utc'], '2026-10-21T00:00:00.000001Z', base='calendar-three-days')

    # Oversize exact outer objects are deliberately otherwise malformed.
    # Their expected target error is valid; byte-guard branch credit is NOT asserted.
    for shape, cap in [('D', 131072), ('R', 262144), ('Q', 262144), ('pair', 524288)]:
        add('bytes/outer/' + shape, shape, {'padding': 'x' * cap}, False, bases[shape]['id'], 'oversize object', 'Unknown/missing keys also invalid. Runtime must separately observe early cap order; no valid-near-cap claim.')
    for path, cap, label in [(['document'], 131072, 'Q-document'), (['stream_key'], 4096, 'Q-stream')]:
        mutate('bytes/nested/' + label, 'Q', path, {'padding': '火' * (cap // 3 + 1)}, caveat='Malformed nested shape and bytes both fail; UTF-8 octets, not characters.')
    for path, cap, label in [(['publication'], 393216, 'P'), (['publication', 'request'], 131072, 'request'), (['publication', 'receipt'], 131072, 'receipt')]:
        mutate('bytes/nested/' + label, 'pair', path, {'padding': 'x' * cap}, caveat='Malformed nested keyset and size overlap; not isolated byte-guard evidence.')
    mutate('bytes/nested/stored-document', 'pair', ['configuration', 'document'], {'padding': 'x' * 131072}, caveat='Malformed nested keyset and size overlap.')
    mutate('bytes/nested/calendar-observation', 'D', ['calendar_observation'], {'padding': 'x' * 131072}, base='calendar-enabled-first', caveat='Outer D and nested helper cap/shape overlap. No isolated nested-cap evidence.')

    assert len({c['id'] for c in cases}) == len(cases)
    for f in families:
        assert [len(f[k]) for k in ['C', 'D', 'R', 'Q', 'P', 'T']] == [9, 10, 19, 17, 8, 11]
        assert f['R']['record_hash'] == digest({k: v for k, v in f['R'].items() if k != 'record_hash'})
        assert f['P']['request_hash'] == digest(f['P']['request'])
        assert f['T']['record_hash'] == f['Q']['record_hash']
        assert f['T']['request_hash'] == f['P']['request_hash']
    return families, cases


def artifacts():
    families, cases = build()
    anchor_rows = []
    for label, wire, expected in ANCHORS:
        actual = pgtext(decode(wire))
        assert actual == expected, (label, actual, expected)
        anchor_rows.append({'id': label, 'input_wire_json': wire, 'expected_jsonb_text': expected,
                            'expected_utf8_hex': expected.encode().hex(), 'expected_sha256': sha256(expected.encode()).hexdigest()})
    snapshots = []
    for f in families:
        item = {'id': f['id'], 'values': {k: {'jsonb_text': pgtext(v), 'utf8_bytes': len(pgtext(v).encode()), 'sha256': digest(v)} for k, v in f.items() if k != 'id'}}
        record_payload = {k: v for k, v in f['R'].items() if k != 'record_hash'}
        item['record_hash_preimage'] = {'jsonb_text': pgtext(record_payload), 'utf8_hex': pgtext(record_payload).encode().hex(), 'sha256': digest(record_payload)}
        item['request_hash_preimage'] = {'jsonb_text': pgtext(f['P']['request']), 'utf8_hex': pgtext(f['P']['request']).encode().hex(), 'sha256': digest(f['P']['request'])}
        snapshots.append(item)
    summary = {'kind': 'independent-configuration-record-corpus-v1', 'contract_sha256': CONTRACT_SHA,
               'status': 'private_literal_expectations_not_sql_executed', 'database_runs': 0, 'target_helpers_implemented_by_this_author': False,
               'families': len(families), 'cases': len(cases), 'success_cases': sum(c['expected']['outcome'] == 'success' for c in cases),
               'refusal_cases': sum(c['expected']['outcome'] == 'error' for c in cases),
               'sql_null_cases': sum(c['argument_kind'] == 'sql_null' for c in cases),
               'by_function': {name: sum(c['function'] == name for c in cases) for name, _ in TARGETS.values()},
               'coverage_status': 'representative_expanded_corpus_with_explicit_remaining_gaps_in_README',
               'byte_guard_status': 'oversize cases are otherwise malformed; no isolated cap-branch or unreachable-valid-edge credit',
               'decode_error_cases_counted_as_23514': 0}
    return {'anchors.json': anchor_rows, 'families.json': snapshots, 'cases.json': cases, 'inventory.json': summary}


def render(value):
    # Artifact container only; every target/golden JSONB value is a string above.
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()


def main():
    outputs = artifacts()
    if sys.argv[1:] == ['--check']:
        for name, value in outputs.items():
            assert (ROOT / name).read_bytes() == render(value), 'frozen artifact differs: ' + name
        print(json.dumps(outputs['inventory.json'], sort_keys=True))
    elif sys.argv[1:] == ['--write-new']:
        for name, value in outputs.items():
            with (ROOT / name).open('xb') as handle:
                handle.write(render(value))
        print(json.dumps(outputs['inventory.json'], sort_keys=True))
    else:
        raise SystemExit('Use --write-new (exclusive new files) or --check (read-only).')


if __name__ == '__main__':
    main()
