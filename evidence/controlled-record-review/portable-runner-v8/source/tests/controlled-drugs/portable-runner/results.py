"""Prospective portable unittest terminal boundary; no process or database API."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import unittest

MAX_RESULT = 4 * 1024 * 1024
MAX_IDS = 4096
MAX_ID_BYTES = 512
MAX_EVENTS = MAX_IDS * 4
KIND = 'portable-unittest-terminal-v1'
CATEGORIES = ('failures', 'errors', 'skips', 'expected_failures',
              'unexpected_successes', 'subtest_failures', 'subtest_errors')
KEYS = frozenset(('kind', 'passed', 'ids', 'expected_count', 'expected_ids_sha256',
                  'tests_run', 'started', 'stopped', 'succeeded', 'problems',
                  'guard_clean', 'guard_errors', 'protocol_errors'))


def _id(value):
    if (type(value) is not str or not value or any(ord(c) < 32 or ord(c) == 127 for c in value)
            or len(value.encode('utf-8')) > MAX_ID_BYTES):
        raise ValueError('bounded nonempty control-free UTF8 test ID required')
    return value


def _ids(values):
    if type(values) not in (list, tuple) or not 1 <= len(values) <= MAX_IDS:
        raise ValueError('finite nonempty test ID sequence required')
    result = [_id(value) for value in values]
    if len(set(result)) != len(result):
        raise ValueError('duplicate test IDs')
    return result


def _digest(ids):
    return hashlib.sha256(json.dumps(sorted(ids), ensure_ascii=False,
                         separators=(',', ':')).encode('utf-8')).hexdigest()


def validate_collection(collected_ids, expected_ids):
    """Collection order may differ; every declared ID must occur exactly once."""
    actual, expected = _ids(collected_ids), _ids(expected_ids)
    if set(actual) != set(expected):
        raise ValueError('collected test IDs differ from exact declared coverage')
    return tuple(actual)


def _indices(value, size):
    if type(value) is not list or len(value) > MAX_EVENTS:
        raise ValueError('bounded ordered event array required')
    if any(type(index) is not int or not 0 <= index < size for index in value):
        raise ValueError('formal in-range integer event index required')


def _shape(value, expected):
    if type(value) is not dict or value.keys() != KEYS:
        raise ValueError('exact terminal keys required')
    if value['kind'] != KIND or type(value['kind']) is not str:
        raise ValueError('terminal kind differs')
    ids = _ids(value['ids'])
    for name in ('passed', 'guard_clean'):
        if type(value[name]) is not bool:
            raise ValueError('formal terminal Boolean required')
    for name in ('expected_count', 'tests_run', 'guard_errors', 'protocol_errors'):
        if type(value[name]) is not int or not 0 <= value[name] <= MAX_EVENTS:
            raise ValueError('bounded formal terminal integer required')
    if (value['expected_count'] != len(expected)
            or type(value['expected_ids_sha256']) is not str
            or value['expected_ids_sha256'] != _digest(expected)):
        raise ValueError('terminal expected coverage binding differs')
    for name in ('started', 'stopped', 'succeeded'):
        _indices(value[name], len(ids))
    problems = value['problems']
    if type(problems) is not dict or problems.keys() != set(CATEGORIES):
        raise ValueError('exact failure category keys required')
    for events in problems.values():
        _indices(events, len(ids))
    return ids


def _successful(value, expected):
    ids = _shape(value, expected)
    wanted = set(range(len(ids)))
    return (set(ids) == set(expected) and value['tests_run'] == len(expected)
            and value['guard_clean'] and value['guard_errors'] == 0 and value['protocol_errors'] == 0
            and all(not events for events in value['problems'].values())
            and all(len(value[name]) == len(expected) and set(value[name]) == wanted
                    for name in ('started', 'stopped', 'succeeded')))


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate terminal JSON key')
        result[key] = value
    return result


def _constant(value):
    raise ValueError('nonfinite terminal JSON constant')


def validate_terminal(rawbytes, expected_ids, *, process_returncode):
    """Accept only a single complete successful receipt AND actual child exit0."""
    expected = _ids(expected_ids)
    if type(process_returncode) is not int or process_returncode != 0:
        raise ValueError('actual child returncode must be formal zero')
    if type(rawbytes) is not bytes or not 0 < len(rawbytes) <= MAX_RESULT:
        raise ValueError('bounded nonempty terminal bytes required')
    value = json.loads(rawbytes.decode('utf-8', errors='strict'),
                       object_pairs_hook=_unique, parse_constant=_constant)
    if not _successful(value, expected) or value['passed'] is not True:
        raise ValueError('terminal does not prove exact all-success coverage')
    return value


def make_result_class(expected_ids, stable_id, guard):
    """Result remains unsuccessful after any coverage or guard boundary defect.

    `guard` implements begin_test(id), end_test(), assert_clean(). A boundary
    hook exception remains primary; receipt() records guard refusal without
    manufacturing a successful terminal. Native traceback text stays in the
    normal unittest stream, never in terminal JSON.
    """
    expected = tuple(_ids(expected_ids))
    if not callable(stable_id) or any(not callable(getattr(guard, name, None))
            for name in ('begin_test', 'end_test', 'assert_clean')):
        raise ValueError('stable ID function and complete guard API required')

    class ExactResult(unittest.TextTestResult):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._ids = list(expected)
            self._lookup = {name: index for index, name in enumerate(self._ids)}
            self._observations = {name: [] for name in ('started', 'stopped', 'succeeded', *CATEGORIES)}
            self._guard_errors = self._protocol_errors = 0
            self._active_id = None
            self._guard_active = False
            self._events = 0

        def _index(self, test):
            try:
                name = _id(stable_id(test))
                if name not in self._lookup:
                    if len(self._ids) >= MAX_IDS:
                        raise ValueError('terminal ID capacity exhausted')
                    self._lookup[name] = len(self._ids)
                    self._ids.append(name)
                return self._lookup[name]
            except BaseException:
                self._protocol_errors += 1
                raise

        def _event(self, name, test):
            index = self._index(test)
            self._events += 1
            if self._events > MAX_EVENTS:
                self._protocol_errors += 1
                raise ValueError('terminal observation capacity exhausted')
            self._observations[name].append(index)
            return index

        def _hook(self, name, *args):
            try:
                return getattr(guard, name)(*args)
            except BaseException:
                self._guard_errors += 1
                raise

        def startTest(self, test):
            index = self._event('started', test)
            if self._active_id is not None:
                self._protocol_errors += 1
                raise ValueError('overlapping test lifecycle')
            self._active_id = index
            super().startTest(test)
            self._hook('begin_test', self._ids[index])
            self._guard_active = True

        def stopTest(self, test):
            index = self._event('stopped', test)
            try:
                if self._active_id != index:
                    self._protocol_errors += 1
                    raise ValueError('stop does not match active test')
                if self._guard_active:
                    self._hook('end_test')
                self._hook('assert_clean')
            finally:
                self._active_id = None
                self._guard_active = False
                super().stopTest(test)

        def addSuccess(self, test):
            index = self._event('succeeded', test)
            if index != self._active_id:
                self._protocol_errors += 1
            super().addSuccess(test)

        def addError(self, test, err):
            self._event('errors', test)
            super().addError(test, err)

        def addFailure(self, test, err):
            self._event('failures', test)
            super().addFailure(test, err)

        def addSkip(self, test, reason):
            self._event('skips', test)
            super().addSkip(test, reason)

        def addExpectedFailure(self, test, err):
            self._event('expected_failures', test)
            super().addExpectedFailure(test, err)

        def addUnexpectedSuccess(self, test):
            self._event('unexpected_successes', test)
            super().addUnexpectedSuccess(test)

        def addSubTest(self, test, subtest, err):
            if err is not None:
                name = 'subtest_failures' if issubclass(err[0], test.failureException) else 'subtest_errors'
                self._event(name, test)
            super().addSubTest(test, subtest, err)

        def receipt(self):
            clean = True
            try:
                self._hook('assert_clean')
            except BaseException:
                clean = False
            if self._active_id is not None or self._guard_active:
                clean = False
            value = dict(kind=KIND, passed=False, ids=list(self._ids),
                expected_count=len(expected), expected_ids_sha256=_digest(expected),
                tests_run=self.testsRun,
                started=list(self._observations['started']), stopped=list(self._observations['stopped']),
                succeeded=list(self._observations['succeeded']),
                problems={name: list(self._observations[name]) for name in CATEGORIES},
                guard_clean=clean, guard_errors=self._guard_errors, protocol_errors=self._protocol_errors)
            value['passed'] = _successful(value, expected)
            return value

        def wasSuccessful(self):
            # Stronger than unittest, but callers MUST still validate terminal
            # coverage and the separately observed process exit status.
            return super().wasSuccessful() and self.receipt()['passed']

    return ExactResult


def write_terminal(path, payload, check):
    """Exclusive bounded physical file; retain partial/late bytes and raise.

    A file is not proof of success without normal return and child exit0.
    The parent must pass the observed process returncode to validate_terminal.
    No directory creation, overwrite, rename or deletion is attempted.
    """
    if not callable(check):
        raise ValueError('original deadline callback required')
    check()
    raw = (json.dumps(payload, ensure_ascii=False, allow_nan=False,
                      separators=(',', ':'), sort_keys=True) + '\n').encode('utf-8')
    if not 0 < len(raw) <= MAX_RESULT:
        raise ValueError('terminal encoded byte cap')
    check()
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts or not path.name:
        raise ValueError('physical absolute terminal path required')
    descriptors = []
    edges = []
    leaf = None
    try:
        current = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        descriptors.append(current)
        for component in path.parts[1:-1]:
            check()
            parent = current
            current = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            descriptors.append(current)
            edges.append((parent, component, current))
        check()
        leaf = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_NONBLOCK,
                       0o600, dir_fd=current)
        initial = os.fstat(leaf)
        if not stat.S_ISREG(initial.st_mode):
            raise ValueError('regular exclusive terminal required')
        offset = 0
        while offset < len(raw):
            check()
            count = os.write(leaf, raw[offset:offset + 65536])
            if type(count) is not int or not 0 < count <= min(65536, len(raw) - offset):
                raise OSError('invalid terminal write progress')
            offset += count
            check()
        os.fsync(leaf)
        check()
        actual = os.fstat(leaf)
        linked = os.stat(path.name, dir_fd=current, follow_symlinks=False)
        if (actual.st_dev, actual.st_ino, actual.st_size) != (initial.st_dev, initial.st_ino, len(raw)):
            raise ValueError('terminal descriptor identity or size changed')
        if (linked.st_dev, linked.st_ino, linked.st_size) != (actual.st_dev, actual.st_ino, actual.st_size):
            raise ValueError('terminal pathname identity changed')
        for parent, component, child in edges:
            linked = os.stat(component, dir_fd=parent, follow_symlinks=False)
            actual_dir = os.fstat(child)
            if not stat.S_ISDIR(linked.st_mode) or (linked.st_dev, linked.st_ino) != (actual_dir.st_dev, actual_dir.st_ino):
                raise ValueError('terminal parent identity changed')
        check()
    finally:
        primary = sys.exc_info()[1]
        close_error = None
        for descriptor in ([leaf] if leaf is not None else []) + list(reversed(descriptors)):
            try:
                os.close(descriptor)
            except BaseException as error:
                if close_error is None:
                    close_error = error
                if primary is not None:
                    primary.add_note('Terminal descriptor close also failed: ' + type(error).__name__)
        if primary is None and close_error is not None:
            raise close_error
    check()
    return {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
