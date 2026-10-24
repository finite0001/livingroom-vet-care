"""Serial parent composition for a distinct, four-slot regression stage."""
from dataclasses import dataclass
import os
from pathlib import Path
import math
import time

_CLOCK = time.monotonic


@dataclass(frozen=True)
class JobInput:
    job_raw: bytes
    python: str
    worker: str
    cwd: str
    env: dict
    output: str


@dataclass(frozen=True)
class VerifiedRegression:
    job_id: str
    expected_ids: tuple
    slot_bytes: tuple
    slot_sha256: tuple
    identities: tuple
    terminal_sha256: str
    transport_sha256: str


class RegressionJobs:
    """Parent source/profile authority remains external and independently frozen.

    prepare begins after the accounting clock. readmit must perform actual full
    source/tool/import-root checks; its return value is never credited as proof.
    The admitted core/results/Transport modules are explicit constructor roles.
    """
    def __init__(self, accountant, *, core_module, transport_module, results_module):
        self.accountant, self.core = accountant, core_module
        self.transport_module, self.results_module = transport_module, results_module
        self.active = self.failed = False
        self.completed = []

    def run(self, job_id, *, prepare, readmit):
        c = self.core
        if self.failed or self.active:
            self.failed = True
            self.accountant.fail()
            raise ValueError('failed or active regression stage cannot launch')
        self.active = True
        held = None
        primary = None
        try:
            c.require(callable(prepare) and callable(readmit), 'fixed preparation/readmission required')
            ticket = self.accountant.begin(job_id)
            check = lambda: self.accountant.check(ticket)
            candidate = prepare(ticket, check)
            check()
            c.require(type(candidate) is JobInput, 'exact admitted regression job input required')
            env = c.strict_json(c.canonical(candidate.env))
            value = JobInput(candidate.job_raw, candidate.python, candidate.worker, candidate.cwd, env, candidate.output)
            job = c.strict_json(value.job_raw)
            c.require(type(job) is dict and job.keys() == c.JOB_KEYS and job['kind'] == 'portable-regression-job-v1'
                    and job['job_id'] == ticket.job_id and job['deadline'] == ticket.deadline
                    and tuple(job['suite']['expected_ids']) == ticket.expected_ids, 'job/deadline/ID declaration differs')
            c.require(job['output'] == {'directory': value.output, 'terminal_name': 'result.json'}, 'fixed output differs')
            c.require(job['implementation']['worker']['path'] == value.worker, 'actual worker role differs')
            for path in (value.python, value.worker, value.cwd, value.output):
                c.physical_path(path)
            held = c.HeldFour(value.output, deadline=ticket.deadline, check=check)
            # Exclusive writer reuses the strict reviewed physical file boundary.
            written = self.results_module.write_terminal(str(Path(value.output)/'job.json'), job, check)
            saved = held.read('job')
            # write_terminal has a deterministic encoding. Its exact saved raw
            # bytes, not a semantic JSON equivalence, are the admitted job.
            c.require(saved.raw == value.job_raw and saved.sha256 == c.digest(value.job_raw)
                    and written == {'bytes': saved.size, 'sha256': saved.sha256}, 'saved raw job encoding differs')
            expected = dict(argv=(value.python, '-I', '-B', value.worker, '--job', str(Path(value.output)/'job.json'), '--job-sha256', c.digest(value.job_raw)),
                cwd=value.cwd, env=env, evidence_directory=value.output, stdout_name='stdout.log', stderr_name='stderr.log',
                terminal_name='result.json', expected_ids=ticket.expected_ids, deadline=ticket.deadline)
            expected_raw = c.canonical(expected)
            routes = job['suite']['child_policy']['routes'] if job['suite']['child_policy'] is not None else {}
            routes = c.strict_json(c.canonical(routes)) if routes else {}

            def validate(raw, ids, *, process_returncode):
                check()
                c.require(tuple(ids) == ticket.expected_ids, 'transport IDs differ')
                result = c.validate_terminal(raw, ids, process_returncode=process_returncode, job_id=job_id,
                    job_sha256=c.digest(value.job_raw), suite_sha256=job['suite']['source']['sha256'],
                    permitted_routes=routes, validate_result=self.results_module.validate_terminal)
                check()
                return result

            def readmit_now():
                check()
                readmit(JobInput(value.job_raw, value.python, value.worker, value.cwd, dict(env), value.output), check)
                check()

            def admit(prepared):
                check()
                c.require(c.canonical(prepared) == expected_raw, 'prepared regression launch differs')
                readmit_now()
                c.require(held.read('job') == saved, 'job changed before launch')
                for slot in ('stdout', 'stderr', 'terminal'):
                    try:
                        os.stat(c.NAMES[slot], dir_fd=held.root, follow_symlinks=False)
                    except FileNotFoundError:
                        pass
                    else:
                        raise ValueError('regression output already exists before launch')
                check()

            receipt = self.transport_module.Transport(validate).run(expected, admit=admit, check_storage=check)
            receipt_raw = c.canonical(receipt)

            def verify():
                check()
                c.require(type(receipt) is dict and receipt.keys() == c.TRANSPORT_KEYS and c.canonical(receipt) == receipt_raw and receipt.get('passed') is True
                        and receipt.get('worker_reaped') is True and type(receipt.get('returncode')) is int
                        and receipt['returncode'] == 0 and receipt.get('cleanup_errors') == []
                        and receipt.get('first_failure') is None and receipt.get('future_launches_allowed') is True
                        and receipt.get('descendant_cleanup_verified') is False
                        and receipt.get('kind') == 'portable-transport-v1'
                        and receipt.get('completion_basis') == 'exact_terminal_exit_zero_finite_trusted_tests',
                        'actual clean regression transport completion required')
                c.require(type(receipt['worker_pid']) is int and receipt['worker_pid'] > 0
                        and all(type(receipt[key]) in (int, float) and math.isfinite(receipt[key]) for key in ('started', 'spawn_returned_at', 'elapsed'))
                        and 0 < receipt['started'] <= receipt['spawn_returned_at'] <= receipt['started'] + receipt['elapsed'] < ticket.deadline
                        and 0 <= receipt['elapsed'] <= 600 and receipt['started']+receipt['elapsed'] <= _CLOCK(), 'actual bounded transport timing required')
                c.require(receipt['paths'] == {slot: str(Path(value.output)/c.NAMES[slot]) for slot in ('stdout', 'stderr', 'terminal')},
                        'transport paths differ')
                observations = held.observe()
                slots = {item.name: item for item in observations}
                c.require(slots['job'] == saved, 'saved job changed')
                for name in ('stdout', 'stderr'):
                    c.require(type(receipt['stream_bytes'][name]) is int and receipt['stream_bytes'][name] == slots[name].size
                            and receipt['stream_sha256'][name] == slots[name].sha256, 'stream differs from actual transport')
                c.require(type(receipt['terminal_bytes']) is int and receipt['terminal_bytes'] == slots['terminal'].size
                        and receipt['terminal_sha256'] == slots['terminal'].sha256, 'terminal differs from transport')
                terminal = validate(slots['terminal'].raw, ticket.expected_ids, process_returncode=receipt['returncode'])
                c.require(c.canonical(terminal) == c.canonical(receipt['terminal']), 'revalidated terminal differs')
                c.require(held.observe() == observations, 'four-slot evidence changed during validation')
                check()
                return VerifiedRegression(job_id, ticket.expected_ids, tuple(item.size for item in observations),
                    tuple(item.sha256 for item in observations), tuple(item.identity for item in observations),
                    c.digest(c.canonical(terminal)), c.digest(receipt_raw))

            summary = verify()
            def finalize():
                readmit_now()
                c.require(verify() == summary, 'regression evidence changed before credit')
                held.close()
                c.require(held.closed is True and held.fds == [], 'regression handles remain open')
                check()
            self.accountant.commit(ticket, dict(zip(c.SLOTS, summary.slot_bytes)), finalize=finalize)
            self.completed.append(summary)
            return summary
        except BaseException as error:
            primary = error
            self.failed = True
            self.accountant.fail()
            raise
        finally:
            self.active = False
            if held is not None and not held.closed:
                try:
                    held.close()
                except BaseException as error:
                    self.failed = True
                    self.accountant.fail()
                    if primary is None:
                        raise
                    primary.add_note('regression output close also failed: ' + type(error).__name__)
