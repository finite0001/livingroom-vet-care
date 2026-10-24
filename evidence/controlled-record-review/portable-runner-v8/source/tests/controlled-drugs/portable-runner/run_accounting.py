"""Serial capacity/deadline accounting, not source or test-result admission.

The parent supplies its independently admitted job inventory and one physical
free-space reader. Its finalize callback must validate paired evidence, close the
pair reader, and recheck source identities before a job receives accounting
credit. This module neither launches nor removes anything. Do not replace a
failed instance to continue the same run.
"""
from dataclasses import dataclass
import math
import re
import time

MIB = 1024 * 1024
GIB = 1024 * MIB
MAX_JOBS = 96
MAX_TESTS = 4096
SLOT_BYTES = 4 * MIB
SLOTS = ('job', 'stdout', 'stderr', 'terminal', 'guard')
POOL_BYTES = 2 * GIB
MAX_COPY_BYTES = 256 * MIB
# Largest declared expanded historical tree, not a per-file limit.
MAX_HISTORICAL_BYTES = 68_563_791
WORKER_SECONDS = 600


def require(value, message):
    if not value:
        raise ValueError(message)


@dataclass(frozen=True)
class Ticket:
    job_id: str
    deadline: float
    expected_ids: tuple
    owner: object


class RunAccounting:
    """One original serial run, with permanently reserved five-slot job budgets.

    No unused reservation is recycled. The conservative 4GiB+copy+historical
    capacity floor remains in force throughout the run. It is capacity admission,
    not a filesystem quota or an assurance about descendant write rates.
    """
    def __init__(self, jobs, *, source_copy_bytes, historical_peak_bytes,
                 read_available, clock=time.monotonic):
        require(type(jobs) is dict and 0 < len(jobs) <= MAX_JOBS,
                'finite ordered job inventory required')
        inventory = []
        all_ids = set()
        for job_id, ids in jobs.items():
            require(type(job_id) is str and re.fullmatch(r'[A-Za-z0-9_-]{1,100}', job_id),
                    'safe unique job identifier required')
            require(type(ids) is list and 0 < len(ids) <= MAX_TESTS,
                    'explicit nonempty test list required')
            require(all(type(identifier) is str and 0 < len(identifier.encode('utf-8')) <= 512
                        and not any(ord(c) < 32 or ord(c) == 127 for c in identifier)
                        for identifier in ids), 'finite formal test identifiers required')
            require(len(set(ids)) == len(ids) and not all_ids.intersection(ids),
                    'duplicate or intersecting test identifiers')
            all_ids.update(ids)
            require(len(all_ids) <= MAX_TESTS, 'aggregate test cap exceeded')
            inventory.append((job_id, tuple(ids)))
        require(type(source_copy_bytes) is int and 0 <= source_copy_bytes <= MAX_COPY_BYTES,
                'finite planned copy bytes required')
        require(type(historical_peak_bytes) is int and 0 <= historical_peak_bytes <= MAX_HISTORICAL_BYTES,
                'declared historical byte cap exceeded')
        require(callable(read_available) and callable(clock), 'explicit capacity and clock readers required')
        self._jobs = tuple(inventory)
        self._required = 4 * GIB + source_copy_bytes + historical_peak_bytes
        self._reserved = len(inventory) * len(SLOTS) * SLOT_BYTES
        require(self._reserved <= POOL_BYTES - 128 * MIB, 'evidence pool headroom exceeded')
        self._read_available, self._clock = read_available, clock
        self._owner = object()
        self._active = None
        self._completed = []
        self._observed = 0
        self._last_time = None
        self._failure = None
        self._final_deadline = None
        self._finished = False

    def _now(self):
        now = self._clock()
        require(type(now) in (int, float) and math.isfinite(now) and now >= 0,
                'finite monotonic time required')
        require(self._last_time is None or now >= self._last_time, 'monotonic clock moved backward')
        self._last_time = now
        return now

    def _open(self):
        require(self._failure is None, 'run previously failed; future jobs forbidden')
        require(not self._finished, 'run accounting already finished')

    def _capacity(self):
        available = self._read_available()
        require(type(available) is int and available >= self._required,
                'insufficient physical free space')

    def fail(self, code):
        """Latch an outer source/transport/close/persistence failure without reset."""
        require(type(code) is str and re.fullmatch(r'[a-z][a-z0-9_]{0,63}', code),
                'fixed bounded failure code required')
        if self._failure is None:
            self._failure = {'code': code, 'observed_monotonic': self._last_time,
                             'active_job': self._active.job_id if self._active else None}
        return dict(self._failure)

    def _ticket(self, ticket):
        self._open()
        require(type(ticket) is Ticket and ticket is self._active and ticket.owner is self._owner,
                'this active job ticket required')
        require(self._now() < ticket.deadline, 'original job deadline expired')
        # A clock/capacity callback may latch an outer failure without raising.
        self._open()

    def begin(self, job_id):
        """Start the 600-second clock BEFORE capacity/admission/serialization."""
        try:
            self._open()
            require(self._active is None and len(self._completed) < len(self._jobs),
                    'one unfinished serial job required')
            expected_job, expected_ids = self._jobs[len(self._completed)]
            require(type(job_id) is str and job_id == expected_job, 'fixed job order differs')
            started = self._now()
            ticket = Ticket(job_id, started + WORKER_SECONDS, expected_ids, self._owner)
            self._active = ticket
            self._final_deadline = ticket.deadline
            self._capacity()
            self._ticket(ticket)
            return ticket
        except BaseException:
            self.fail('begin_failed')
            raise

    def checkpoint(self, ticket):
        """Use during preparation and as transport's storage/deadline callback."""
        try:
            self._ticket(ticket)
            self._capacity()
            self._ticket(ticket)
        except BaseException:
            self.fail('checkpoint_failed')
            raise

    def commit(self, ticket, slot_sizes, *, finalize):
        """Credit only after the parent's actual evidence/close/source checks.

        slot_sizes are already physically observed lengths, never estimates.
        finalize performs those independent validations and must raise on any
        failure. Its return value is deliberately not interpreted as evidence.
        """
        try:
            self.checkpoint(ticket)
            require(type(slot_sizes) is dict and set(slot_sizes) == set(SLOTS),
                    'all five physical output lengths required')
            require(all(type(n) is int and 0 <= n <= SLOT_BYTES for n in slot_sizes.values()),
                    'formal bounded output lengths required')
            require(all(slot_sizes[name] > 0 for name in ('job', 'terminal', 'guard')),
                    'job and paired evidence must be nonempty')
            # Freeze the counted values before a callback can mutate caller data.
            actual_bytes = sum(slot_sizes.values())
            require(callable(finalize), 'parent final validation callback required')
            finalize()
            self.checkpoint(ticket)
            require(self._observed + actual_bytes <= self._reserved, 'reserved pool exceeded')
            self._ticket(ticket)
            self._observed += actual_bytes
            self._completed.append(ticket.job_id)
            self._active = None
        except BaseException:
            self.fail('commit_failed')
            raise

    def finish(self, *, finalize):
        """Report accounting only, after final parent persistence/close checks."""
        try:
            self._open()
            require(self._active is None and len(self._completed) == len(self._jobs),
                    'complete exact job inventory required')
            require(callable(finalize), 'parent finalization callback required')
            # Retain the last job's original deadline through final persistence.
            deadline = self._final_deadline
            require(self._now() < deadline, 'original final deadline expired')
            finalize()
            self._open()
            self._capacity()
            require(self._now() < deadline, 'original final deadline expired')
            self._open()
            self._finished = True
            return {'kind': 'portable-run-accounting-v1', 'accounting_complete': True,
                    'jobs_completed': list(self._completed),
                    'test_ids_counted': sum(len(ids) for _, ids in self._jobs),
                    'evidence_bytes_reserved': self._reserved,
                    'evidence_bytes_observed': self._observed,
                    'capacity_floor_bytes': self._required,
                    'full_routing_acceptance': False, 'database_acceptance': False,
                    'descendant_cleanup_verified': False}
        except BaseException:
            self.fail('finish_failed')
            raise

    @property
    def failure(self):
        return None if self._failure is None else dict(self._failure)
