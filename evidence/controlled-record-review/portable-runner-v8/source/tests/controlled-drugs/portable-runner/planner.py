"""Pure fixed-suite planning; no filesystem, process or database operations."""
from dataclasses import dataclass
import hashlib
import json
import re

PLAN_SHA256 = 'e3c3a1b535ade3d1c7ed8ee9d7402bf3ed64346365934abe01af8336c0e5a4a6'
ROUTING_SHA256 = '7de2c469e9a897b3669a173096e6064226f0e1626199f05b06cce65d8c8532a3'
COLLECTION_SHA256 = '158fbfd799826b1ecb6f769dff44bb3adc4d56bbe77a2fac15f7abb0651285bb'
KINDS = {'original': (54, 768), 'stored_adapter': (1, 25),
         'a2_runtime': (1, 26), 'a2_session': (1, 48),
         'historical_materializer': (1, 22), 'portable_fixture': (1, 30)}
PLAN_KEYS = {'kind', 'original_routing_sha256', 'original_collection_sha256',
             'original_tests', 'public_additive_tests', 'full_routing_acceptance',
             'pending_historical_boundary_ids', 'implementation_regressions_included', 'jobs'}
JOB_KEYS = {'job_id', 'kind', 'tree_profile', 'relative', 'classes',
            'expected_ids', 'id_map', 'source_sha256'}


def require(value, message):
    if not value:
        raise ValueError(message)


def _unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate plan key')
        result[key] = value
    return result


def _path(value):
    require(type(value) is str and value and not value.startswith('/') and '\\' not in value,
            'relative source path required')
    require(all(p not in ('', '.', '..') for p in value.split('/')) and '\x00' not in value,
            'source path segments differ')


def validate_structure(value):
    """Consistency checks only; this function does NOT admit a new authority."""
    require(type(value) is dict and set(value) == PLAN_KEYS, 'exact plan schema')
    require(value['kind'] == 'portable-suite-plan-v1', 'plan kind differs')
    require(value['original_routing_sha256'] == ROUTING_SHA256 and
            value['original_collection_sha256'] == COLLECTION_SHA256, 'original authorities differ')
    require(type(value['original_tests']) is int and value['original_tests'] == 867 and
            type(value['public_additive_tests']) is int and value['public_additive_tests'] == 52,
            'fixed original and additive counts')
    require(value['full_routing_acceptance'] is False and value['implementation_regressions_included'] is False,
            'unfinished coverage cannot become complete')
    pending = value['pending_historical_boundary_ids']
    require(type(pending) is list and len(pending) == 8 and len(set(pending)) == 8 and
            all(type(x) is str and re.fullmatch(r'HistoricalBoundaryTests\.test_[a-z0-9_]+', x) for x in pending),
            'eight explicit historical boundaries remain')
    jobs = value['jobs']
    require(type(jobs) is list and len(jobs) == 59, 'fixed job count')
    ids, sources, job_ids = set(), set(), set()
    totals = {kind: [0, 0] for kind in KINDS}
    for job in jobs:
        require(type(job) is dict and set(job) == JOB_KEYS, 'exact suite job schema')
        name = job['job_id']
        require(type(name) is str and re.fullmatch(r'suite-[0-9]{3}', name) and name not in job_ids,
                'unique safe job ID')
        job_ids.add(name)
        kind, source = job['kind'], job['relative']
        require(kind in KINDS, 'fixed suite kind')
        _path(source)
        require(source not in sources, 'one job per source module')
        sources.add(source)
        profile = 'a2_669' if kind.startswith('a2_') else 'current'
        require(job['tree_profile'] == profile, 'historical routing differs')
        require(type(job['source_sha256']) is str and re.fullmatch('[0-9a-f]{64}', job['source_sha256']),
                'fixed harness source hash required')
        classes, expected, mapping = job['classes'], job['expected_ids'], job['id_map']
        require(type(classes) is list and 0 < len(classes) <= 64 and len(set(classes)) == len(classes), 'explicit unique classes')
        require(all(type(c) is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', c) for c in classes), 'class names')
        require(type(expected) is list and expected and len(set(expected)) == len(expected), 'unique expected IDs')
        require(type(mapping) is dict and len(mapping) == len(expected) and set(mapping.values()) == set(expected),
                'bijective method mapping')
        for method, identifier in mapping.items():
            require(type(method) is str and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*\.test_[A-Za-z0-9_]+', method),
                    'class-qualified method')
            require(identifier == source + '::' + method and method.split('.')[0] in classes,
                    'original stable ID mapping differs')
        require(set(m.split('.')[0] for m in mapping) == set(classes), 'unmapped class')
        require(not ids.intersection(expected), 'test ID appears in two jobs')
        ids.update(expected)
        totals[kind][0] += 1
        totals[kind][1] += len(expected)
    require(totals == {k: list(v) for k, v in KINDS.items()} and len(ids) == 919, 'exact scope differs')
    return value


@dataclass(frozen=True)
class Plan:
    raw: bytes

    def value(self):
        # Rechecking also refuses a hand-constructed Plan with arbitrary bytes.
        return _admit(self.raw)


def _admit(raw):
    require(type(raw) is bytes and 0 < len(raw) <= 1024 * 1024, 'bounded immutable plan bytes')
    require(hashlib.sha256(raw).hexdigest() == PLAN_SHA256, 'suite plan authority differs')
    return validate_structure(json.loads(raw.decode('utf-8'), object_pairs_hook=_unique))


def admit_plan(raw):
    _admit(raw)
    return Plan(raw)


def suite_jobs(plan, tree_tags):
    """Return detached worker suite descriptors; no roots/tools/jobs are admitted."""
    require(type(plan) is Plan, 'admitted fixed plan required')
    require(type(tree_tags) is dict and set(tree_tags) == {'current', 'a2_669'} and
            all(type(t) is str and re.fullmatch('[A-Za-z0-9_-]{1,64}', t) for t in tree_tags.values()) and
            len(set(tree_tags.values())) == 2, 'distinct explicit tree tags')
    return [dict(job_id=j['job_id'], tree_profile=j['tree_profile'], source_sha256=j['source_sha256'],
                 suite=dict(kind=j['kind'], tree_tag=tree_tags[j['tree_profile']], relative=j['relative'],
                            classes=j['classes'], expected_ids=j['expected_ids'], id_map=j['id_map']))
            for j in plan.value()['jobs']]


def check_suite_sources(plan, profile_sources):
    """Check harness hashes against parent-admitted maps, not the live filesystem.

    This checks only suite placement. Full source closure, bytes, tools, extra
    eligible files and physical roots remain separate parent admission gates.
    """
    require(type(plan) is Plan and type(profile_sources) is dict and
            set(profile_sources) == {'current', 'a2_669'}, 'two explicit admitted source maps')
    for job in plan.value()['jobs']:
        pins = profile_sources[job['tree_profile']]
        require(type(pins) is dict and job['relative'] in pins, 'harness absent from source map')
        entry = pins[job['relative']]
        require(type(entry) is dict and entry.get('sha256') == job['source_sha256'], 'harness digest differs')
    return True


def summarize(plan, terminals, validate_terminal):
    """Every terminal must pass the separately admitted result validator.

    terminals maps job_id to (raw_bytes, ACTUAL observed process returncode).
    Parent admission of this callback and those observations is mandatory.
    """
    require(type(plan) is Plan and callable(validate_terminal), 'plan and result validator required')
    value = plan.value()
    require(type(terminals) is dict and set(terminals) == {j['job_id'] for j in value['jobs']},
            'missing or unexpected worker terminal')
    count = 0
    for job in value['jobs']:
        observed = terminals[job['job_id']]
        require(type(observed) is tuple and len(observed) == 2, 'explicit terminal bytes and process status')
        raw, code = observed
        require(type(raw) is bytes and 0 < len(raw) <= 4 * 1024 * 1024 and type(code) is int and code == 0,
                'bounded terminal and actual exit0 required')
        terminal = validate_terminal(raw, job['expected_ids'], process_returncode=code)
        require(type(terminal) is dict and terminal.get('passed') is True, 'validated success required')
        count += len(job['expected_ids'])
    return dict(kind='portable-planned-scope-result-v1', planned_scope_passed=True,
                jobs_completed=len(value['jobs']), tests_completed=count,
                full_routing_acceptance=False, implementation_regressions_included=False,
                pending_historical_boundary_ids=value['pending_historical_boundary_ids'],
                database_acceptance=False, clinical_activation=False)
