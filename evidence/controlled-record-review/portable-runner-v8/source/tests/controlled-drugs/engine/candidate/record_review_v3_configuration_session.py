"""Private Gate B-only, bounded25-phase ordinary-postgres psql session; never acceptance.

The caller owns whole-runtime cleanup and the unchanged outer workload budget.
This helper owns only its spawned docker-exec client and private I/O evidence.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import secrets
import subprocess
import time

PHASE_NAMES = ('decode_cases', 'capture_baseline', 'positive_000', 'positive_025', 'positive_050', 'negative_000', 'negative_025', 'negative_050', 'negative_075', 'negative_100', 'negative_125', 'negative_150', 'negative_175', 'negative_200', 'negative_225', 'negative_250', 'negative_275', 'negative_300', 'negative_325', 'negative_350', 'negative_375', 'negative_400', 'null_wire_session_controls', 'stubs_guard_acl', 'final_inventory')
PHASE_SECONDS = 120
STREAM_LIMIT = 128 * 1024 * 1024
CLEANUP_SECONDS = 180
TERMINATE_SECONDS = 5
MARKER = 'lrv_configuration_input_phase_marker'
ROOT = Path(__file__).resolve().parents[4]


class SessionFailure(RuntimeError):
    """Bounded machine code only; raw child output stays in private files."""


def _json_unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise SessionFailure('duplicate_marker_key')
        result[key] = value
    return result


def _save(folder, name, value):
    path = folder / name
    with path.open('w', encoding='utf-8') as handle:
        os.chmod(path, 0o600)
        json.dump(value, handle, sort_keys=True, indent=2)
        handle.write('\n')


def _marker(nonce, index, name):
    # All interpolated values are generated or members of the fixed phase list.
    return ("\nselect jsonb_build_object('" + MARKER + "',jsonb_build_object("
            "'nonce','" + nonce + "','index'," + str(index) + ",'name','" + name + "',"
            "'backend_pid',pg_backend_pid(),'backend_start',"
            "to_char(backend_start at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')))"
            " from pg_catalog.pg_stat_activity where pid=pg_backend_pid();\n").encode()


def _validate_phases(phases):
    if not isinstance(phases, (list, tuple)) or len(phases) != len(PHASE_NAMES):
        raise SessionFailure('phase_inventory')
    for expected, phase in zip(PHASE_NAMES, phases):
        if not isinstance(phase, (list, tuple)) or len(phase) != 2 or phase[0] != expected:
            raise SessionFailure('phase_inventory')
        if not isinstance(phase[1], str) or not phase[1] or '\x00' in phase[1]:
            raise SessionFailure('phase_sql')


class _Session:
    def __init__(self, runtime, phases, folder, admit, *, phase_seconds=PHASE_SECONDS,
                 stream_limit=STREAM_LIMIT, reader_limit=STREAM_LIMIT):
        self.runtime, self.phases, self.folder, self.admit = runtime, phases, folder, admit
        self.phase_seconds, self.stream_limit, self.reader_limit = phase_seconds, stream_limit, reader_limit
        self.outer_deadline = runtime.deadline
        self.started = time.monotonic()
        self.phase_deadline = min(self.started + phase_seconds, self.outer_deadline)
        self.nonce = secrets.token_hex(16)
        self.process = None
        self.pending = bytearray()
        self.expected = None
        self.seen = False
        self.backend = None
        self.dispatch_complete = False
        self.receipt = dict(kind='configuration-input-phased-session-v1', passed=False,
                            phase_seconds=phase_seconds, outer_deadline=self.outer_deadline,
                            stream_limit_bytes=stream_limit, reader_limit_bytes=reader_limit,
                            nonce=self.nonce, phases=[], primary_failure=None, cleanup_failure=None)
        self.receipt['phases'].append(dict(index=0, name=PHASE_NAMES[0], started=self.started,
            outer_remaining_at_start=self.outer_deadline - self.started,
            deadline=self.phase_deadline, complete=False))

    def check_time(self):
        if time.monotonic() >= self.phase_deadline:
            raise SessionFailure('phase_deadline')

    def save(self):
        self.receipt['elapsed_seconds'] = round(time.monotonic() - self.started, 6)
        _save(self.folder, 'receipt.json', self.receipt)

    def observe_line(self, line):
        if MARKER.encode() not in line:
            return
        try:
            value = json.loads(line, object_pairs_hook=_json_unique)
        except (ValueError, UnicodeError) as exc:
            raise SessionFailure('malformed_marker') from exc
        if not isinstance(value, dict) or set(value) != {MARKER}:
            raise SessionFailure('marker_shape')
        marker = value[MARKER]
        if not isinstance(marker, dict) or set(marker) != {'nonce', 'index', 'name', 'backend_pid', 'backend_start'}:
            raise SessionFailure('marker_shape')
        if (self.expected is None or self.seen or not self.dispatch_complete or
                type(marker['index']) is not int or
                (marker['nonce'], marker['index'], marker['name']) != self.expected):
            raise SessionFailure('marker_order_or_binding')
        if type(marker['backend_pid']) is not int or marker['backend_pid'] <= 0:
            raise SessionFailure('backend_identity')
        start = marker['backend_start']
        if not isinstance(start, str) or re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z', start) is None:
            raise SessionFailure('backend_identity')
        identity = dict(pid=marker['backend_pid'], backend_start=start)
        if self.backend is None:
            if marker['index'] != -1:
                raise SessionFailure('missing_initial_identity')
            self.backend = identity
            self.receipt['backend'] = identity
        elif identity != self.backend:
            raise SessionFailure('backend_changed')
        self.seen = True

    def consume(self):
        self.check_time()
        for handle in (self.out, self.err):
            # RLIMIT_FSIZE is also enforced in the child. Parent checks are
            # independent and include stderr even though it is never parsed.
            if os.fstat(handle.fileno()).st_size >= self.stream_limit:
                raise SessionFailure('output_limit')
        chunk = self.reader.read(65536)
        if chunk:
            if len(self.pending) + len(chunk) > self.reader_limit:
                raise SessionFailure('reader_limit')
            self.pending.extend(chunk)
            while True:
                end = self.pending.find(b'\n')
                if end < 0:
                    break
                line = bytes(self.pending[:end])
                del self.pending[:end + 1]
                self.observe_line(line)
                self.check_time()
        self.check_time()

    def send(self, payload, index, name):
        # Consume already available output before accepting the next marker.
        # Surplus/duplicate earlier markers cannot become a later success.
        while self.reader.tell() < os.fstat(self.out.fileno()).st_size:
            self.consume()
        self.expected = (self.nonce, index, name)
        self.seen = False
        self.dispatch_complete = False
        offset = 0
        while offset < len(payload) or not self.seen:
            self.consume()
            if self.process.poll() is not None:
                # Drain already-written output before reporting exit, but no
                # next phase may be dispatched from an exited process.
                while self.reader.tell() < os.fstat(self.out.fileno()).st_size:
                    self.consume()
                raise SessionFailure('child_exit_before_phase_completion')
            if offset < len(payload):
                try:
                    count = os.write(self.process.stdin.fileno(), payload[offset:offset + 65536])
                except BlockingIOError:
                    count = 0
                except BrokenPipeError as exc:
                    raise SessionFailure('child_stdin_closed') from exc
                if count:
                    self.sent.write(payload[offset:offset + count])
                    self.sent.flush()
                    offset += count
                    self.dispatch_complete = offset == len(payload)
            self.check_time()
            if offset < len(payload) or not self.seen:
                time.sleep(min(0.005, max(0, self.phase_deadline - time.monotonic())))

    def finish(self):
        self.process.stdin.close()
        while True:
            self.consume()
            status = self.process.poll()
            if status is not None:
                while self.reader.tell() < os.fstat(self.out.fileno()).st_size:
                    self.consume()
                if self.pending:
                    self.observe_line(bytes(self.pending))
                    self.pending.clear()
                if status != 0:
                    raise SessionFailure('child_nonzero_exit')
                self.check_time()
                return
            time.sleep(min(0.005, max(0, self.phase_deadline - time.monotonic())))

    def terminate(self):
        # The same reserve is later consumed by exact-owned runtime cleanup.
        if self.runtime.cleanup_deadline is None:
            self.runtime.cleanup_deadline = time.monotonic() + CLEANUP_SECONDS
        end = min(time.monotonic() + TERMINATE_SECONDS, self.runtime.cleanup_deadline)
        process = self.process
        if process is None:
            return
        if process.stdin and not process.stdin.closed:
            process.stdin.close()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=max(0, min(1, end - time.monotonic())))
            except subprocess.TimeoutExpired:
                process.kill()
        if process.poll() is None:
            process.wait(timeout=max(0, end - time.monotonic()))
        self.receipt['client_returncode'] = process.returncode

    def execute(self):
        try:
            _validate_phases(self.phases)
            identity = _marker(self.nonce, -1, 'identity')
            frames = []
            phase_evidence = []
            with (self.folder / 'framed-stdin.sql').open('xb') as framed:
                os.chmod(framed.name, 0o600)
                framed.write(identity)
                for index, (name, sql) in enumerate(self.phases):
                    raw = sql.encode('utf-8')
                    path = self.folder / f'{index:02d}-{name}.sql'
                    with path.open('xb') as handle:
                        os.chmod(path, 0o600)
                        handle.write(raw)
                    frame = raw + _marker(self.nonce, index, name)
                    frames.append(frame)
                    framed.write(frame)
                    phase_evidence.append(dict(index=index, name=name, raw_bytes=len(raw),
                                               raw_sha256=hashlib.sha256(raw).hexdigest()))
                    self.check_time()
            self.receipt['phase_sources'] = phase_evidence
            self.save()
            argv, env, cwd = self.admit()
            self.check_time()
            _save(self.folder, 'command.json', argv)
            with (self.folder / 'stdout.log').open('xb') as self.out, (self.folder / 'stderr.log').open('xb') as self.err, (self.folder / 'dispatched-stdin.sql').open('xb') as self.sent:
                for handle in (self.out, self.err, self.sent):
                    os.chmod(handle.name, 0o600)
                def child_limit():
                    resource.setrlimit(resource.RLIMIT_FSIZE, (self.stream_limit, self.stream_limit))
                self.process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=self.out,
                                                stderr=self.err, env=env, cwd=cwd,
                                                bufsize=0, preexec_fn=child_limit)
                self.receipt['client_pid'] = self.process.pid
                self.save()
                os.set_blocking(self.process.stdin.fileno(), False)
                with (self.folder / 'stdout.log').open('rb', buffering=0) as self.reader:
                    self.check_time()
                    self.send(identity, -1, 'identity')
                    for index, ((name, _), frame) in enumerate(zip(self.phases, frames)):
                        started = self.started if index == 0 else time.monotonic()
                        self.phase_deadline = min(started + self.phase_seconds, self.outer_deadline)
                        if index == 0:
                            row = self.receipt['phases'][0]
                        else:
                            row = dict(index=index, name=name, started=started,
                                       outer_remaining_at_start=self.outer_deadline - started,
                                       deadline=self.phase_deadline, complete=False)
                            self.receipt['phases'].append(row)
                        self.save()
                        self.send(frame, index, name)
                        if index == len(PHASE_NAMES) - 1:
                            self.finish()
                        self.check_time()
                        row.update(complete=True, elapsed_seconds=time.monotonic() - started,
                                   outer_remaining_at_end=self.outer_deadline - time.monotonic())
                        self.save()
                        self.check_time()
                    self.check_time()
            # File size is independently bounded before the only full read.
            size = (self.folder / 'stdout.log').stat().st_size
            if size >= self.stream_limit:
                raise SessionFailure('output_limit')
            output = (self.folder / 'stdout.log').read_bytes().decode('utf-8')
            self.check_time()
            self.receipt.update(passed=True, client_returncode=self.process.returncode,
                                stdout_bytes=size, stderr_bytes=(self.folder / 'stderr.log').stat().st_size)
            self.save()
            self.check_time()
            return output
        except BaseException as exc:
            self.receipt['passed'] = False
            self.receipt['primary_failure'] = dict(type=type(exc).__name__,
                code=str(exc) if isinstance(exc, SessionFailure) else 'client_or_evidence_error')
            self.receipt['phases'][-1]['failure_elapsed_seconds'] = time.monotonic() - self.receipt['phases'][-1]['started']
            try:
                self.terminate()
            except BaseException as cleanup:
                self.receipt['cleanup_failure'] = dict(type=type(cleanup).__name__, code='client_cleanup_failed')
            try:
                self.save()
            except OSError:
                # An evidence write failure must not replace the primary error.
                # Earlier receipts/raw files remain; no success is returned.
                pass
            raise


def run(runtime, phases):
    """Run25 fixed configuration-input phases on one verified owned backend.

    Runtime provides folder/deadline/cleanup_deadline, pinned docker(), verify(),
    check_config(), container, endpoint, command_number and private log.
    """
    runtime.command_number += 1
    folder = Path(runtime.folder) / f'{runtime.command_number:04d}-phased-session'
    folder.mkdir(mode=0o700)

    def admit():
        previous = runtime.candidate_phase_deadline
        runtime.candidate_phase_deadline = min(session.phase_deadline, previous) if previous is not None else session.phase_deadline
        try:
            runtime.check_config()
            observed = runtime.verify()
            if observed['Id'] != runtime.container or re.fullmatch('[0-9a-f]{64}', runtime.container) is None:
                raise SessionFailure('immutable_container_binding')
            argv = runtime.docker(['docker', 'exec', '-i', runtime.container, 'psql', '-X', '-qAt',
                                   '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
                                   '-v', 'VERBOSITY=verbose'])
            env = os.environ.copy()
            env.pop('DOCKER_CONTEXT', None)
            env['DOCKER_HOST'] = runtime.endpoint
            return argv, env, ROOT
        finally:
            runtime.candidate_phase_deadline = previous

    session = _Session(runtime, phases, folder, admit)
    try:
        return session.execute()
    finally:
        try:
            runtime.log.write(folder.name + ' passed=' + str(session.receipt['passed']) + '\n')
            runtime.log.flush()
        except (OSError, ValueError):
            if session.receipt['primary_failure'] is None:
                raise
