"""Compare two read-only routine inventories; never connects to a database."""
import argparse
import json
import re
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('expected', type=Path)
parser.add_argument('observed', type=Path)
args = parser.parse_args()


def read_inventory(path):
    value = json.loads(path.read_text())
    if set(value) != {'versions', 'routines', 'triggers'}:
        raise ValueError('Unexpected inventory fields')
    for key in value:
        if not isinstance(value[key], list) or not value[key]:
            raise ValueError('Expected nonempty inventory list: '+key)
    if any(not isinstance(v, str) or not re.fullmatch(r'\d{14}', v) for v in value['versions']) or len(set(value['versions'])) != len(value['versions']):
        raise ValueError('Invalid migration versions')
    for trigger in value['triggers']:
        if set(trigger) != {'table_name', 'trigger_name', 'enabled_mode', 'definition'} or trigger['enabled_mode'] not in {'O', 'D', 'R', 'A'}:
            raise ValueError('Invalid trigger inventory')
        if any(not isinstance(v, str) or not v for v in trigger.values()):
            raise ValueError('Invalid trigger field')
    for routine in value['routines']:
        if set(routine) != {'signature', 'owner', 'definition_md5', 'security_definer', 'configuration', 'execute_grants'}:
            raise ValueError('Unexpected routine fields')
        if set(routine['execute_grants']) != {'anon', 'authenticated', 'service_role'}:
            raise ValueError('Incomplete execution grants')
        if any(type(v) is not bool for v in routine['execute_grants'].values()) or type(routine['security_definer']) is not bool:
            raise ValueError('Invalid authority flags')
        if any(not isinstance(routine[k], str) or not routine[k] for k in ['signature', 'owner', 'definition_md5']) or not re.fullmatch(r'[a-f0-9]{32}', routine['definition_md5']):
            raise ValueError('Invalid routine identity or digest')
        if routine['configuration'] is not None and (not isinstance(routine['configuration'], list) or any(not isinstance(v, str) for v in routine['configuration'])):
            raise ValueError('Invalid routine configuration')
    routines = {row['signature']: row for row in value['routines']}
    if len(routines) != len(value['routines']):
        raise ValueError('Duplicate routine signatures')
    return value, routines


expected, expected_routines = read_inventory(args.expected)
observed, observed_routines = read_inventory(args.observed)
summary = {
    'migration_versions_match': expected['versions'] == observed['versions'],
    'expected_routine_count': len(expected_routines),
    'observed_routine_count': len(observed_routines),
    'missing_routines': sorted(expected_routines.keys() - observed_routines.keys()),
    'extra_routines': sorted(observed_routines.keys() - expected_routines.keys()),
    'changed_routines': {
        name: sorted(key for key in expected_routines[name]
                     if expected_routines[name][key] != observed_routines[name][key])
        for name in sorted(expected_routines.keys() & observed_routines.keys())
        if expected_routines[name] != observed_routines[name]
    },
    'trigger_bindings_match': expected['triggers'] == observed['triggers'],
    'expected_trigger_count': len(expected['triggers']),
    'observed_trigger_count': len(observed['triggers']),
}
summary['matches'] = (summary['migration_versions_match'] and summary['trigger_bindings_match']
                      and not any(summary[key] for key in ['missing_routines', 'extra_routines', 'changed_routines']))
print(json.dumps(summary, indent=2))
raise SystemExit(0 if summary['matches'] else 1)
