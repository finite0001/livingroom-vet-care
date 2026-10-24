"""Independent four-slot regression evidence/accounting, not source authority."""
from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import time

_CLOCK = time.monotonic
_SHA256 = hashlib.sha256

MIB = 1024 * 1024
GIB = 1024 * MIB
SLOT_BYTES = 4 * MIB
SLOTS = ('job', 'stdout', 'stderr', 'terminal')
NAMES = dict(job='job.json', stdout='stdout.log', stderr='stderr.log', terminal='result.json')
MAX_SECONDS = 600
MAX_HISTORICAL_BYTES = 68_563_791
JOB_KEYS = frozenset(('kind', 'job_id', 'deadline', 'suite', 'implementation', 'output', 'import_roots'))
TERMINAL_KEYS = frozenset(('kind', 'job_id', 'job_sha256', 'suite_sha256', 'result', 'launch_audit', 'production_guard_installed'))
TRANSPORT_KEYS = frozenset(('kind', 'passed', 'started', 'first_failure', 'cleanup_errors',
    'descendant_cleanup_verified', 'future_launches_allowed', 'worker_pid', 'worker_reaped',
    'returncode', 'paths', 'spawn_returned_at', 'terminal_sha256', 'terminal_bytes', 'terminal',
    'elapsed', 'completion_basis', 'stream_bytes', 'stream_sha256'))


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(raw):
    return _SHA256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8', 'strict')


def strict_json(raw):
    require(type(raw) is bytes and 0 < len(raw) <= SLOT_BYTES, 'bounded JSON bytes required')
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'duplicate JSON key')
            result[key] = value
        return result
    def constant(_):
        raise ValueError('nonfinite JSON constant')
    def number(text):
        result = float(text)
        require(math.isfinite(result), 'nonfinite JSON number')
        return result
    return json.loads(raw.decode('utf-8', 'strict'), object_pairs_hook=pairs, parse_constant=constant, parse_float=number)


def physical_path(value):
    require(type(value) is str and value.startswith('/') and not value.startswith('//') and '\x00' not in value
            and value == str(Path(value)) and '..' not in Path(value).parts, 'normalized absolute physical path required')
    return value


def read_source(record, check):
    """Bind exact source bytes through physical single-link file/ancestor handles."""
    require(type(record) is dict and record.keys() == {'path', 'bytes', 'sha256'}
            and type(record['bytes']) is int and 0 < record['bytes'] <= SLOT_BYTES
            and type(record['sha256']) is str and re.fullmatch('[0-9a-f]{64}', record['sha256']), 'exact source record required')
    path = physical_path(record['path'])
    descriptors, edges, leaf = [], [], None
    primary = None
    try:
        check()
        descriptors.append(os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW))
        for part in Path(path).parts[1:-1]:
            parent = descriptors[-1]
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            descriptors.append(child)
            edges.append((parent, part, child, identity(os.fstat(child))))
            check()
        leaf = os.open(Path(path).name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptors[-1])
        before = os.fstat(leaf)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size == record['bytes'], 'finite physical source required')
        chunks, count = [], 0
        while True:
            check()
            chunk = os.read(leaf, min(65536, before.st_size + 1-count))
            check()
            if not chunk:
                break
            chunks.append(chunk); count += len(chunk)
            require(count <= before.st_size, 'source grew')
        raw = b''.join(chunks)
        require(count == before.st_size and stamp(before) == stamp(os.fstat(leaf))
                == stamp(os.stat(Path(path).name, dir_fd=descriptors[-1], follow_symlinks=False))
                and digest(raw) == record['sha256'], 'source bytes/identity differ')
        for parent, name, child, wanted in edges:
            require(identity(os.stat(name, dir_fd=parent, follow_symlinks=False)) == identity(os.fstat(child)) == wanted,
                    'source ancestry changed')
        check()
    except BaseException as error:
        primary = error
        raise
    finally:
        closing = None
        for fd in ([leaf] if leaf is not None else []) + list(reversed(descriptors)):
            try:
                os.close(fd)
            except BaseException as error:
                closing = closing or error
                if primary is not None:
                    primary.add_note('source close also failed: ' + type(error).__name__)
        if primary is None and closing is not None:
            raise closing
    check()
    return raw


def identity(st):
    return st.st_dev, st.st_ino, st.st_mode, st.st_uid


def stamp(st):
    return (*identity(st), st.st_nlink, st.st_size, st.st_mtime_ns, st.st_ctime_ns)


@dataclass(frozen=True)
class Slot:
    name: str
    size: int
    sha256: str
    identity: tuple
    raw: bytes | None


class HeldFour:
    """Admit before any slot exists; hold all physical ancestors until close."""
    def __init__(self, directory, *, deadline, check):
        self.path = physical_path(directory)
        require(type(deadline) in (int, float) and math.isfinite(deadline)
                and time.monotonic() < deadline <= time.monotonic() + MAX_SECONDS, 'original finite deadline required')
        require(callable(check), 'parent capacity/deadline check required')
        self.deadline, self.parent_check = deadline, check
        self.fds, self.edges = [], []
        self.closed = self.failed = False
        try:
            self.check()
            self.fds.append(os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW))
            for part in Path(directory).parts[1:]:
                self.check()
                parent = self.fds[-1]
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
                self.fds.append(child)
                self.edges.append((parent, part, child, identity(os.fstat(child))))
            self.root = self.fds[-1]
            self.root_identity = identity(os.fstat(self.root))
            require(self.root_identity[3] == os.getuid() and stat.S_IMODE(self.root_identity[2]) == 0o700,
                    'owned private0700 output required')
            self.verify()
            for name in NAMES.values():
                try:
                    os.stat(name, dir_fd=self.root, follow_symlinks=False)
                except FileNotFoundError:
                    pass
                else:
                    raise ValueError('all four output slots must be absent')
            self.check()
        except BaseException as error:
            self.failed = True
            try:
                self.close()
            except BaseException as closing:
                error.add_note('four-slot admission close also failed: ' + type(closing).__name__)
            raise

    def check(self):
        require(not self.failed and not self.closed, 'four-slot observer failed or closed')
        require(time.monotonic() < self.deadline, 'original regression deadline exhausted')
        self.parent_check()
        require(not self.failed and not self.closed and time.monotonic() < self.deadline,
                'four-slot check failed during callback')

    def verify(self):
        self.check()
        require(identity(os.fstat(self.root)) == self.root_identity, 'held output root changed')
        for parent, name, child, wanted in self.edges:
            self.check()
            linked, held = os.stat(name, dir_fd=parent, follow_symlinks=False), os.fstat(child)
            require(stat.S_ISDIR(linked.st_mode) and identity(linked) == identity(held) == wanted,
                    'held output ancestry changed')
        self.check()

    def read(self, slot):
        require(slot in SLOTS, 'fixed slot required')
        self.verify()
        fd = None
        primary = None
        try:
            fd = os.open(NAMES[slot], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=self.root)
            before = os.fstat(fd)
            require(stat.S_ISREG(before.st_mode) and stat.S_IMODE(before.st_mode) == 0o600
                    and before.st_uid == os.getuid() and before.st_nlink == 1
                    and 0 <= before.st_size <= SLOT_BYTES
                    and (slot in ('stdout', 'stderr') or before.st_size > 0), 'private bounded single-link regular slot required')
            count, chunks, sha = 0, [], hashlib.sha256()
            while True:
                self.check()
                raw = os.read(fd, min(65536, before.st_size + 1 - count))
                self.check()
                if not raw:
                    break
                count += len(raw)
                require(count <= before.st_size, 'slot grew during read')
                sha.update(raw)
                if slot not in ('stdout', 'stderr'):
                    chunks.append(raw)
            after = os.fstat(fd)
            linked = os.stat(NAMES[slot], dir_fd=self.root, follow_symlinks=False)
            require(count == before.st_size and stamp(before) == stamp(after) == stamp(linked), 'slot changed during read')
            result = Slot(slot, count, sha.hexdigest(), stamp(before), b''.join(chunks) if slot not in ('stdout', 'stderr') else None)
            self.verify()
        except BaseException as error:
            primary = error
            self.failed = True
            raise
        finally:
            if fd is not None:
                try:
                    os.close(fd)
                except BaseException as error:
                    if primary is None:
                        raise
                    primary.add_note('four-slot leaf close also failed: ' + type(error).__name__)
        self.check()
        return result

    def observe(self):
        try:
            self.verify()
            result = tuple(self.read(slot) for slot in SLOTS)
            for item in result:
                self.check()
                require(stamp(os.stat(NAMES[item.name], dir_fd=self.root, follow_symlinks=False)) == item.identity,
                        'earlier regression slot changed')
            self.verify()
            return result
        except BaseException:
            self.failed = True
            raise

    def close(self):
        handles, self.fds = self.fds, []
        self.closed = True
        first = None
        for fd in reversed(handles):
            try:
                os.close(fd)
            except BaseException as error:
                first = first or error
        if first is not None:
            raise first
        require(time.monotonic() < self.deadline, 'original regression deadline exhausted during close')


@dataclass(frozen=True)
class Ticket:
    job_id: str
    deadline: float
    expected_ids: tuple
    owner: object


def inventory(items, *, regression):
    require(type(items) is dict and len(items) <= (29 if regression else 67), 'bounded explicit stage inventory required')
    result, seen = [], set()
    for name, ids in items.items():
        require(type(name) is str and re.fullmatch(r'[A-Za-z0-9_-]{1,100}', name), 'fixed job ID required')
        require(type(ids) is list and 0 < len(ids) <= 4096 and all(type(i) is str and 0 < len(i.encode('utf-8')) <= 512
                and not any(ord(c) < 32 or ord(c) == 127 for c in i) for i in ids), 'explicit bounded ID sequence required')
        require(len(set(ids)) == len(ids) and not seen.intersection(ids), 'duplicate stage IDs')
        require(not regression or all(i.startswith('implementation-regressions/') for i in ids), 'distinct regression namespace required')
        seen.update(ids)
        result.append((name, tuple(ids)))
    return tuple(result), seen


class RegressionAccounting:
    """Four slots share the existing pool with permanently reserved guarded slots."""
    def __init__(self, jobs, *, guarded_jobs, source_copy_bytes, historical_peak_bytes, read_available, clock=time.monotonic):
        self.jobs, regression_ids = inventory(jobs, regression=True)
        guarded, guarded_ids = inventory(guarded_jobs, regression=False)
        require(self.jobs and guarded, 'both nonempty declared stages required')
        require(not regression_ids.intersection(guarded_ids) and len(regression_ids | guarded_ids) <= 4096
                and len(self.jobs) + len(guarded) <= 96, 'combined disjoint inventory exceeds bounds')
        self.guarded_reserved = len(guarded) * 5 * SLOT_BYTES
        self.reserved = len(self.jobs) * 4 * SLOT_BYTES
        require(self.guarded_reserved + self.reserved <= 1920*MIB, 'shared evidence pool exceeds1920MiB usable allocation')
        require(type(source_copy_bytes) is int and 0 <= source_copy_bytes <= 256*MIB
                and type(historical_peak_bytes) is int and 0 <= historical_peak_bytes <= MAX_HISTORICAL_BYTES,
                'finite admitted copy/historical bytes required')
        require(callable(read_available) and callable(clock), 'explicit capacity and clock required')
        self.floor = 4*GIB + source_copy_bytes + historical_peak_bytes
        self.capacity, self.clock = read_available, clock
        self.owner, self.active = object(), None
        self.completed, self.observed = [], 0
        self.failed = self.finished = False
        self.last_time = self.last_deadline = None

    def fail(self):
        self.failed = True

    def opened(self):
        require(not self.failed and not self.finished, 'regression accounting failed or finished')

    def now(self):
        now = self.clock()
        require(type(now) in (int, float) and math.isfinite(now) and now >= 0
                and (self.last_time is None or now >= self.last_time), 'finite monotonic time required')
        self.last_time = now
        return now

    def space(self):
        available = self.capacity()
        require(type(available) is int and available >= self.floor, 'insufficient shared physical free space')
        self.opened()

    def check(self, ticket):
        try:
            self.opened()
            require(type(ticket) is Ticket and ticket is self.active and ticket.owner is self.owner,
                    'current owned regression ticket required')
            require(self.now() < ticket.deadline, 'original regression deadline exhausted')
            self.space()
            require(self.now() < ticket.deadline, 'original regression deadline exhausted')
            self.opened()
        except BaseException:
            self.fail()
            raise

    def begin(self, name):
        try:
            self.opened()
            require(self.active is None and len(self.completed) < len(self.jobs), 'one unfinished serial regression job required')
            wanted, ids = self.jobs[len(self.completed)]
            require(name == wanted and type(name) is str, 'fixed regression job order differs')
            ticket = Ticket(name, self.now() + MAX_SECONDS, ids, self.owner)
            self.active = ticket
            self.last_deadline = ticket.deadline
            self.check(ticket)
            return ticket
        except BaseException:
            self.fail()
            raise

    def commit(self, ticket, sizes, *, finalize):
        try:
            self.check(ticket)
            require(type(sizes) is dict and sizes.keys() == set(SLOTS)
                    and all(type(n) is int and 0 <= n <= SLOT_BYTES for n in sizes.values())
                    and sizes['job'] > 0 and sizes['terminal'] > 0, 'exact observed four-slot sizes required')
            total = sum(sizes.values())
            require(callable(finalize), 'actual final evidence validation required')
            finalize()
            self.check(ticket)
            require(self.observed + total <= self.reserved, 'regression reservation exceeded')
            self.observed += total
            self.completed.append(ticket.job_id)
            self.active = None
        except BaseException:
            self.fail()
            raise

    def finish(self, *, finalize):
        try:
            self.opened()
            require(self.active is None and len(self.completed) == len(self.jobs) and callable(finalize), 'exact complete regression stage required')
            require(self.now() < self.last_deadline, 'original final regression deadline exhausted')
            finalize()
            self.opened()
            self.space()
            require(self.now() < self.last_deadline, 'original final regression deadline exhausted')
            self.opened()
            self.finished = True
            return dict(kind='portable-regression-accounting-v1', accounting_complete=True,
                jobs_completed=list(self.completed), ids_counted=sum(len(ids) for _, ids in self.jobs),
                guarded_reservation_bytes=self.guarded_reserved, regression_reservation_bytes=self.reserved,
                shared_reservation_bytes=self.guarded_reserved+self.reserved,
                regression_bytes_observed=self.observed, capacity_floor_bytes=self.floor,
                full_controller_acceptance=False, production_guard_acceptance=False, database_acceptance=False,
                descendant_cleanup_verified=False)
        except BaseException:
            self.fail()
            raise


def validate_terminal(raw, expected_ids, *, process_returncode, job_id, job_sha256, suite_sha256, permitted_routes, validate_result):
    require(type(process_returncode) is int and process_returncode == 0, 'actual formal child exit0 required')
    value = strict_json(raw)
    require(type(value) is dict and value.keys() == TERMINAL_KEYS and value['kind'] == 'portable-regression-terminal-v1'
            and value['production_guard_installed'] is False and value['job_id'] == job_id
            and value['job_sha256'] == job_sha256 and value['suite_sha256'] == suite_sha256, 'exact regression terminal binding differs')
    audit = value['launch_audit']
    require(type(audit) is dict and audit.keys() == {'kind', 'installed', 'active_test', 'denials', 'launches', 'universal_descendant_containment'}
            and audit['kind'] == 'independent-regression-launch-audit-v1' and audit['installed'] is True
            and audit['active_test'] is None and audit['denials'] == 0 and type(audit['denials']) is int
            and audit['universal_descendant_containment'] is False and type(audit['launches']) is list
            and len(audit['launches']) <= 256, 'regression launch audit did not finish cleanly')
    counts = {}
    for item in audit['launches']:
        require(type(item) is dict and item.keys() == {'test_id', 'route', 'ordinal'} and item['test_id'] in expected_ids
                and type(item['route']) is str and re.fullmatch(r'[a-z][a-z0-9_-]{0,63}', item['route'])
                and type(item['ordinal']) is int and 1 <= item['ordinal'] <= 256, 'bounded regression launch record required')
        cap = permitted_routes.get(item['test_id'], {}).get(item['route'])
        key = item['test_id'], item['route']
        counts[key] = counts.get(key, 0) + 1
        require(type(cap) is int and 1 <= cap <= 256 and item['ordinal'] == counts[key] <= cap,
                'regression launch exceeds exact declared route/call inventory')
    result = validate_result(canonical(value['result']), expected_ids, process_returncode=process_returncode)
    require(result == value['result'], 'strict original result differs')
    return value
