"""Public failure diagnostics: fixed categories and bounded progress, never logs.

An exact terminal assertion identifies the observed guard, not a root cause.
Missing or malformed private receipts produce no progress claims.
"""
import json
import math
from pathlib import Path

PROBES = {'probe-smoke.py': 'smoke', 'probe-native.py': 'managed_native',
          'probe-opening.py': 'opening_boundary', 'probe-capacity.py': 'opening_capacity',
          'probe-correction-capacity.py': 'opening_correction_capacity', 'probe-api.py': 'genuine_auth_api'}
ASSERTIONS = {
    'Next correction batch exceeds reserved workload budget': 'next_batch_admission_refused',
    'Correction1001 exceeds reserved workload budget': 'event1001_admission_refused',
    'Correction workload command deadline exhausted': 'deadline_guard',
    'Correction workload command returned after deadline': 'deadline_guard',
    'Global correction probe budget exhausted': 'deadline_guard',
    'Correction stage returned after deadline': 'deadline_guard',
    'Correction workload completed after global deadline': 'deadline_guard',
    'Shared correction restore workload deadline exhausted': 'deadline_guard',
    'Correction database ownership marker mismatch': 'ownership_guard',
    'Correction restore database ownership marker mismatch': 'ownership_guard',
    'Unsafe correction database target': 'ownership_guard',
    'Unsafe correction restore database': 'ownership_guard',
    'Unregistered correction restore database': 'ownership_guard',
}


def _number(value, maximum):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= maximum


def _count(value, maximum=1001):
    return type(value) is int and 0 <= value <= maximum


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate diagnostic field')
        result[key] = value
    return result


def _checkpoint_summary(result_dir):
    try:
        path = Path(result_dir) / 'engine-correction-capacity-v1-checkpoints.json'
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 2_000_000:
            return None
        value = json.loads(path.read_text(), object_pairs_hook=_unique_object)
        if not isinstance(value, dict) or value.get('kind') != 'controlled-opening-correction-capacity-feasibility-v1':
            return None
        if type(value.get('passed')) is not bool or value.get('global_probe_budget_seconds') != 900:
            return None
        samples = value.get('samples')
        admissions = value.get('admissions')
        if not isinstance(samples, list) or not isinstance(admissions, list) or len(samples) > 33 or len(admissions) > 33:
            return None
        current = 0
        for sample in samples:
            if not isinstance(sample, dict) or not _count(sample.get('previous_target')) or not _count(sample.get('target')):
                return None
            if sample['previous_target'] != current or not 1 <= sample['target'] - current <= 32 or not _number(sample.get('elapsed_seconds'), 900):
                return None
            current = sample['target']
        safe = {'completed_writer_target': current, 'completed_writer_batches': len(samples),
                'attempted_target': None, 'remaining_seconds': None,
                'estimated_next_batch_seconds': None, 'required_seconds_with_reserve': None,
                'last_admission_allowed': None,
                'marked_database_removed': None, 'source_runtime_unchanged_after_cleanup': None}
        if admissions:
            admission = admissions[-1]
            if not isinstance(admission, dict):
                return None
            previous, target = admission.get('current_target'), admission.get('next_target')
            if not _count(previous) or not _count(target) or not 1 <= target - previous <= 32 or target < current:
                return None
            if type(admission.get('admitted')) is not bool or not _number(admission.get('remaining_seconds'), 900):
                return None
            # The last admission either precedes an uncompleted batch, or is
            # exactly the successful admission for the last completed sample.
            if target == current:
                if not samples or previous != samples[-1]['previous_target'] or admission['admitted'] is not True:
                    return None
            elif previous != current:
                return None
            estimate = admission.get('estimated_next_batch_seconds')
            required = admission.get('required_seconds_with_reserve')
            if estimate is not None and not _number(estimate, 1_000_000):
                return None
            if not _number(required, 1_000_120):
                return None
            safe.update(attempted_target=target, remaining_seconds=admission['remaining_seconds'],
                        estimated_next_batch_seconds=estimate, required_seconds_with_reserve=required,
                        last_admission_allowed=admission['admitted'])
        for key in ('marked_database_removed', 'source_runtime_unchanged_after_cleanup'):
            if key in value:
                if type(value[key]) is not bool:
                    return None
                safe[key] = value[key]
        return safe
    except (OSError, ValueError, TypeError, OverflowError, RecursionError):
        return None


def summarize_probe_failure(probe_name, returncode, stdout, stderr, result_dir):
    """Return only sanitized categories; all unrecognized failure text stays private."""
    probe = PROBES.get(probe_name, 'unknown') if isinstance(probe_name, str) else 'unknown'
    code = 'unknown'
    if isinstance(stderr, str) and probe == 'opening_correction_capacity':
        lines = stderr.splitlines()
        terminal = next((line for line in reversed(lines) if line.strip()), '')
        for message, category in ASSERTIONS.items():
            if terminal == 'AssertionError: ' + message:
                code = category
                break
    return {'kind': 'controlled-probe-failure-summary-v1', 'probe': probe, 'passed': False,
            'failure_code': code,
            'child_returncode': returncode if type(returncode) is int and -255 <= returncode <= 255 else None,
            'checkpoint_summary': _checkpoint_summary(result_dir) if probe == 'opening_correction_capacity' else None}
