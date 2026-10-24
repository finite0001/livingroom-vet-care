"""One guarded job's parent lifecycle. No profile or source authority is minted.

The future fixed controller supplies source-admitted components and preparation /
re-admission routines. This composes their actual launch, paired evidence, held
output and accounting operations; it is not the final multi-stage controller.
"""
from dataclasses import dataclass
import hashlib
import os
from pathlib import Path

SLOTS = ('job', 'stdout', 'stderr', 'terminal', 'guard')
NAMES = {slot: slot + ('.log' if slot in ('stdout', 'stderr') else '.json') for slot in SLOTS}


def require(value, message):
    if not value:
        raise ValueError(message)


@dataclass(frozen=True)
class JobInput:
    job_raw: bytes
    context: dict
    python: str
    worker: str
    cwd: str
    env: dict
    output: str


class GuardedJobs:
    """Use one instance and accountant for the entire fixed guarded stage.

    prepare(ticket, check) does real source/tool/copy/historical preparation under
    the already-started ticket. readmit(input, check) must recheck its independently
    admitted source/tool/import-root authority. Neither callback return value is
    treated as proof. Components themselves require independent source admission.
    """
    def __init__(self, accountant, *, output_module, pair_module, transport_module,
                 evidence_module, validate_pair, validate_terminal):
        self.accountant = accountant
        self.output_module, self.pair_module = output_module, pair_module
        self.transport_module, self.evidence_module = transport_module, evidence_module
        self.validate_pair, self.validate_terminal = validate_pair, validate_terminal
        self.failed = False
        self.active = False
        self.completed = []

    def run(self, job_id, *, prepare, readmit):
        if self.failed or self.active:
            self.failed = True
            self.accountant.fail('guarded_reentry_failed')
            raise ValueError('failed or active guarded stage cannot launch')
        self.active = True
        output = reader = None
        primary = None
        try:
            require(callable(prepare) and callable(readmit), 'fixed preparation/re-admission required')
            # begin precedes ALL preparation, including clean source copy.
            ticket = self.accountant.begin(job_id)
            check = lambda: self.accountant.checkpoint(ticket)
            check()
            candidate = prepare(ticket, check)
            check()
            require(type(candidate) is JobInput, 'exact admitted job input required')
            e = self.evidence_module
            # Freeze caller-owned nested values before a later callback runs.
            job_raw = candidate.job_raw
            job = e.strict_json(job_raw, check)
            context = e.strict_json(e.canonical(candidate.context), check)
            env = e.strict_json(e.canonical(candidate.env), check)
            value = JobInput(job_raw, context, candidate.python, candidate.worker,
                             candidate.cwd, env, candidate.output)
            require(job.keys() == e.JOB_KEYS and job['kind'] == 'portable-worker-job-v2'
                    and job['job_id'] == ticket.job_id and job['deadline'] == ticket.deadline,
                    'job identity or original deadline differs')
            require(context['job_id'] == ticket.job_id and context['job_sha256'] == e.digest(job_raw)
                    and type(context['expected_ids']) is list
                    and tuple(context['expected_ids']) == ticket.expected_ids,
                    'admitted execution IDs differ from accountant')
            require(job['output'] == {'directory': value.output, 'terminal_name': NAMES['terminal'],
                                     'guard_name': NAMES['guard']}, 'fixed job output differs')
            for path in (value.python, value.worker, value.cwd, value.output):
                require(type(path) is str and path.startswith('/') and not path.startswith('//')
                        and '\x00' not in path and path == str(Path(path))
                        and '..' not in Path(path).parts, 'normalized absolute physical path required')
            require(type(env) is dict and all(type(k) is str and type(v) is str for k, v in env.items()),
                    'explicit detached string environment required')
            output = self.output_module.HeldOutput(value.output, dict(NAMES), deadline=ticket.deadline, check=check)
            # Construct both held capabilities before ANY output file exists.
            reader = self.pair_module.HeldPairReader(value.output, NAMES['guard'], context,
                deadline=ticket.deadline, validate_pair=self.validate_pair,
                validate_terminal=self.validate_terminal)
            self._write_job(output, job_raw, check)
            verifier = e.JobEvidence(job_raw, context, value.output, dict(NAMES), output_observer=output,
                deadline=ticket.deadline, check=check, validate_pair=self.validate_pair,
                validate_terminal=self.validate_terminal)
            expected = {'argv': (value.python, '-I', '-B', value.worker, '--job',
                str(Path(value.output)/NAMES['job']), '--job-sha256', e.digest(job_raw)),
                'cwd': value.cwd, 'env': env, 'evidence_directory': value.output,
                'stdout_name': NAMES['stdout'], 'stderr_name': NAMES['stderr'],
                'terminal_name': NAMES['terminal'], 'expected_ids': ticket.expected_ids,
                'deadline': ticket.deadline}
            # Canonical detached template cannot be mutated through the admission callback.
            expected_raw = e.canonical(expected)

            def readmit_now():
                check()
                # Fresh detached input keeps trusted callbacks from inadvertently changing
                # the transport template or the verifier's authoritative context.
                readmit(JobInput(job_raw, e.strict_json(e.canonical(context), check), value.python,
                    value.worker, value.cwd, dict(env), value.output), check)
                check()

            def admit(prepared):
                check()
                require(e.canonical(prepared) == expected_raw, 'transport preparation differs')
                readmit_now()
                output._verify()
                self._verify_job(output, job_raw, check)
                for slot in ('stdout', 'stderr', 'terminal', 'guard'):
                    try:
                        os.stat(NAMES[slot], dir_fd=output.root, follow_symlinks=False)
                    except FileNotFoundError:
                        pass
                    else:
                        raise ValueError('worker output already exists before launch')
                check()

            transport = self.transport_module.Transport(reader)
            receipt = transport.run(expected, admit=admit, check_storage=check)
            # Actual matching reader must close before evidence/accounting acceptance.
            reader.close()
            summary = verifier.verify(receipt, reader=reader)
            require(summary.job_id == ticket.job_id and summary.expected_ids == ticket.expected_ids,
                    'verified execution inventory differs')

            def finalize():
                readmit_now()
                require(verifier.verify(receipt, reader=reader) == summary, 'evidence changed before credit')
                output.close()
                require(output.closed is True and output.fds == [] and reader.closed is True
                        and reader.fds == [], 'owned parent handles remain open')
                check()

            self.accountant.commit(ticket, dict(zip(SLOTS, summary.slot_bytes)), finalize=finalize)
            self.completed.append(summary)
            return summary
        except BaseException as error:
            primary = error
            self.failed = True
            self.accountant.fail('guarded_job_failed')
            raise
        finally:
            # Close even when Transport failed before calling the paired validator.
            closing = None
            for label, handle in (('pair_reader', reader), ('output_observer', output)):
                if handle is not None and not handle.closed:
                    try:
                        handle.close()
                    except BaseException as error:
                        self.failed = True
                        self.accountant.fail('guarded_close_failed')
                        if primary is not None:
                            primary.add_note(label + ' close also failed: ' + type(error).__name__)
                        elif closing is None:
                            closing = error
            self.active = False
            if closing is not None:
                raise closing

    @staticmethod
    def _write_job(output, raw, check):
        require(type(raw) is bytes and 0 < len(raw) <= 4*1024*1024, 'bounded raw job required')
        check()
        output._verify()
        fd = os.open(NAMES['job'], os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_NONBLOCK,
                     0o600, dir_fd=output.root)
        primary = None
        try:
            offset = 0
            while offset < len(raw):
                check()
                count = os.write(fd, raw[offset:offset+65536])
                require(type(count) is int and 0 < count <= min(65536, len(raw)-offset), 'invalid job write progress')
                offset += count
            os.fsync(fd)
            check()
        except BaseException as error:
            primary = error
            raise
        finally:
            try:
                os.close(fd)
            except BaseException as error:
                if primary is None:
                    raise
                primary.add_note('job descriptor close also failed: ' + type(error).__name__)
        GuardedJobs._verify_job(output, raw, check)

    @staticmethod
    def _verify_job(output, raw, check):
        observed = output._read('job', NAMES['job'])
        require(observed.raw == raw and observed.sha256 == hashlib.sha256(raw).hexdigest(),
                'physical saved job differs')
        check()
