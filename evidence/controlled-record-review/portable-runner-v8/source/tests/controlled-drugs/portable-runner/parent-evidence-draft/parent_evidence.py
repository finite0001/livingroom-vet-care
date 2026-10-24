"""Prospective parent verification of one guarded worker's five saved outputs.

No source authority, process launch or accounting credit is created here. The
parent supplies an admitted immutable job/context, the actual Transport receipt
and the original HeldOutput instance admitted before file creation. This helper
obtains repeated physical observations from that same held capability. It must still
close both observers, re-admit source/tools and commit under the original ticket.
"""
from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import time

MAX_BYTES = 4 * 1024 * 1024
SLOTS = ('job', 'stdout', 'stderr', 'terminal', 'guard')
JOB_KEYS = frozenset(('kind', 'job_id', 'deadline', 'suite', 'guard', 'implementation',
                      'output', 'historical638', 'partition'))
PAIR_KEYS = frozenset(('kind', 'result', 'guard', 'terminal_sha256', 'terminal_bytes',
                       'guard_sha256', 'guard_bytes'))
TRANSPORT_KEYS = frozenset(('kind', 'passed', 'started', 'first_failure', 'cleanup_errors',
    'descendant_cleanup_verified', 'future_launches_allowed', 'worker_pid',
    'worker_reaped', 'returncode', 'paths', 'spawn_returned_at', 'terminal_sha256',
    'terminal_bytes', 'terminal', 'elapsed', 'completion_basis', 'stream_bytes', 'stream_sha256'))


def require(value, message):
    if not value:
        raise ValueError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False,
                      separators=(',', ':')).encode('utf-8', 'strict')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def strict_json(raw, check):
    require(type(raw) is bytes and 0 < len(raw) <= MAX_BYTES, 'bounded nonempty JSON bytes required')
    def pairs(items):
        result = {}
        for key, value in items:
            check()
            require(key not in result, 'duplicate JSON key')
            result[key] = value
        return result
    def constant(_):
        raise ValueError('nonfinite JSON constant')
    def number(value):
        result = float(value)
        require(math.isfinite(result), 'nonfinite JSON number')
        return result
    check()
    result = json.loads(raw.decode('utf-8', 'strict'), object_pairs_hook=pairs,
                        parse_constant=constant, parse_float=number)
    check()
    return result


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


@dataclass(frozen=True)
class VerifiedEvidence:
    job_id: str
    expected_ids: tuple
    slot_bytes: tuple
    slot_sha256: tuple
    identities: tuple
    pair_sha256: str
    transport_sha256: str


class JobEvidence:
    def __init__(self, job_raw, context, directory, names, *, output_observer, deadline, check,
                 validate_pair, validate_terminal):
        now = time.monotonic()
        require(finite(deadline) and now < deadline <= now + 600, 'original finite deadline required')
        require(all(callable(fn) for fn in (check, validate_pair, validate_terminal)), 'admitted callbacks required')
        self.deadline = deadline
        self.parent_check = check
        self.validate_pair = validate_pair
        self.validate_terminal = validate_terminal
        self.failed = False
        self.baseline = None
        self.check()
        require(type(directory) is str and directory.startswith('/') and not directory.startswith('//')
            and '\x00' not in directory and directory == str(Path(directory)) and '..' not in Path(directory).parts,
            'normalized physical output path required')
        self.directory = directory
        require(type(names) is dict and set(names) == set(SLOTS), 'exact five output names required')
        require(all(type(n) is str and re.fullmatch(r'[A-Za-z0-9_-]{1,100}\.(json|log)', n)
                    for n in names.values()) and len(set(names.values())) == 5, 'distinct fixed output names required')
        self.names = tuple((slot, names[slot]) for slot in SLOTS)
        self.output = output_observer
        self.output_root = tuple(output_observer.root_identity)
        self.admit_output()
        job = strict_json(job_raw, self.check)
        require(type(job) is dict and job.keys() == JOB_KEYS and job['kind'] == 'portable-worker-job-v2', 'exact job-v2 required')
        require(finite(job['deadline']) and job['deadline'] == deadline, 'job original deadline differs')
        self.context_raw = canonical(context)
        frozen_context = strict_json(self.context_raw, self.check)
        require(type(frozen_context) is dict and frozen_context.get('job_id') == job['job_id']
            and frozen_context.get('job_sha256') == digest(job_raw), 'job identity differs from admitted context')
        ids = frozen_context.get('expected_ids')
        require(type(ids) is list and 1 <= len(ids) <= 4096
            and all(type(i) is str and 0 < len(i.encode('utf-8', 'strict')) <= 512
                    and not any(ord(c) < 32 or ord(c) == 127 for c in i) for i in ids)
            and len(set(ids)) == len(ids), 'exact bounded expected IDs required')
        require(type(job['job_id']) is str and re.fullmatch(r'[A-Za-z0-9_-]{1,100}', job['job_id']), 'formal job ID required')
        self.job_raw = job_raw
        self.job_id = job['job_id']
        self.expected_ids = tuple(ids)
        self.check()

    def check(self):
        require(not self.failed, 'parent evidence verifier is failed')
        if time.monotonic() >= self.deadline:
            raise TimeoutError('original parent evidence deadline exhausted')
        self.parent_check()
        require(not self.failed, 'parent evidence verifier failed during check')
        if time.monotonic() >= self.deadline:
            raise TimeoutError('original parent evidence deadline exhausted')

    def admit_output(self):
        self.check()
        require(self.output.closed is False and self.output.failed is False
            and finite(self.output.deadline) and self.output.deadline == self.deadline,
            'original live output observer required')
        require(self.output.names == self.names
            and tuple(edge[1] for edge in self.output.edges) == Path(self.directory).parts[1:],
            'output observer belongs to another directory or slot map')
        require(self.output.root_identity == self.output_root and len(self.output_root) == 4,
                'output observer root identity changed')
        held = os.fstat(self.output.root)
        require((held.st_dev, held.st_ino, held.st_mode, held.st_uid) == self.output_root
            and stat.S_ISDIR(held.st_mode) and stat.S_IMODE(held.st_mode) == 0o700
            and held.st_uid == os.getuid(), 'held output root capability changed')
        self.check()

    def verify(self, transport, *, reader):
        try:
            self.check()
            self.admit_output()
            require(reader.closed is True and reader.used is True and type(reader.fds) is list
                and reader.fds == [] and finite(reader.deadline) and reader.deadline == self.deadline
                and str(reader.path) == self.directory and reader.name == dict(self.names)['guard']
                and tuple(reader.expected_ids) == self.expected_ids,
                'actual matching paired reader must be closed before acceptance')
            transport_raw = canonical(transport)
            t = strict_json(transport_raw, self.check)
            require(type(t) is dict and t.keys() == TRANSPORT_KEYS, 'exact Transport receipt required')
            require(t['kind'] == 'portable-transport-v1' and t['passed'] is True
                and t['worker_reaped'] is True and t['future_launches_allowed'] is True
                and t['descendant_cleanup_verified'] is False and t['first_failure'] is None
                and type(t['cleanup_errors']) is list and t['cleanup_errors'] == []
                and type(t['returncode']) is int and t['returncode'] == 0,
                'actual successful clean Transport completion required')
            require(type(t['worker_pid']) is int and t['worker_pid'] > 0, 'formal worker PID required')
            require(t['completion_basis'] == 'exact_terminal_exit_zero_finite_trusted_tests', 'finite completion basis differs')
            require(all(finite(t[k]) for k in ('started', 'spawn_returned_at', 'elapsed'))
                and 0 <= t['elapsed'] <= 600 and 0 < t['started'] <= t['spawn_returned_at']
                <= t['started'] + t['elapsed'] < self.deadline
                and t['started'] + t['elapsed'] <= time.monotonic(), 'Transport timing differs from original deadline')
            require(t['paths'] == {slot: str(Path(self.directory) / dict(self.names)[slot])
                                   for slot in ('stdout', 'stderr', 'terminal')}, 'Transport output paths differ')
            observations = self.output.observe()
            require(type(observations) is tuple and len(observations) == 5, 'immutable five-slot observations required')
            slots = {}
            for expected, item in zip(SLOTS, observations):
                self.check()
                require(item.name == expected and type(item.size) is int and 0 <= item.size <= MAX_BYTES,
                        'ordered bounded output slot required')
                require(type(item.sha256) is str and re.fullmatch('[0-9a-f]{64}', item.sha256), 'formal output hash required')
                identity = item.identity
                require(type(identity) is tuple and len(identity) == 8
                    and all(type(n) is int for n in identity) and identity[0] >= 0 and identity[1] > 0
                    and stat.S_ISREG(identity[2]) and stat.S_IMODE(identity[2]) == 0o600
                    and identity[3] == os.getuid() and identity[4] == 1 and identity[5] == item.size,
                    'owned private single-link physical output identity required')
                if expected in ('stdout', 'stderr'):
                    require(item.raw is None, 'stream raw copies are not retained')
                else:
                    require(type(item.raw) is bytes and item.size == len(item.raw) and item.size > 0
                            and digest(item.raw) == item.sha256, 'saved output raw bytes differ')
                slots[expected] = item
            require(slots['job'].raw == self.job_raw, 'saved job differs from admitted raw job')
            require(type(t['stream_bytes']) is dict and set(t['stream_bytes']) == {'stdout', 'stderr'}
                and type(t['stream_sha256']) is dict and set(t['stream_sha256']) == {'stdout', 'stderr'}, 'exact stream receipt required')
            for name in ('stdout', 'stderr'):
                require(type(t['stream_bytes'][name]) is int and t['stream_bytes'][name] == slots[name].size
                        and t['stream_sha256'][name] == slots[name].sha256, 'saved stream differs from actual Transport receipt')
            require(type(t['terminal_bytes']) is int and t['terminal_bytes'] == slots['terminal'].size
                    and t['terminal_sha256'] == slots['terminal'].sha256, 'saved terminal differs from Transport receipt')
            self.check()
            pair = self.validate_pair(slots['terminal'].raw, slots['guard'].raw,
                strict_json(self.context_raw, self.check), process_returncode=t['returncode'],
                validate_terminal=self.validate_terminal, check=self.check)
            require(type(pair) is dict and pair.keys() == PAIR_KEYS
                    and pair['kind'] == 'portable-worker-validated-pair-v1', 'exact validated pair required')
            require(type(pair['terminal_bytes']) is int and pair['terminal_bytes'] == slots['terminal'].size
                and pair['terminal_sha256'] == slots['terminal'].sha256
                and type(pair['guard_bytes']) is int and pair['guard_bytes'] == slots['guard'].size
                and pair['guard_sha256'] == slots['guard'].sha256, 'revalidated pair output binding differs')
            pair_raw = canonical(pair)
            require(pair_raw == canonical(t['terminal']), 'saved pair differs from actual Transport validation')
            summary = VerifiedEvidence(self.job_id, self.expected_ids, tuple(s.size for s in observations),
                tuple(s.sha256 for s in observations), tuple(s.identity for s in observations),
                digest(pair_raw), digest(transport_raw))
            require(self.baseline is None or summary == self.baseline, 'previously verified evidence changed')
            self.admit_output()
            # Pair validation and its callbacks must not create an unchecked
            # interval: re-observe the same held ancestry and every leaf before
            # recording a verification baseline, including the first call.
            final_observations = self.output.observe()
            require(final_observations == observations, 'output evidence changed during validation')
            self.check()
            self.baseline = summary
            return summary
        except BaseException:
            self.failed = True
            raise
