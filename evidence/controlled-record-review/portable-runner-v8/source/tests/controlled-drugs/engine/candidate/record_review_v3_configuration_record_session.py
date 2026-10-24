"""Private Gate B-only, bounded93-phase ordinary-postgres psql session; never acceptance.

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

PHASE_NAMES = ('setup', 'render_0000', 'render_0064', 'render_0128', 'render_0192', 'render_0256', 'render_0320', 'render_0384', 'render_0448', 'render_0512', 'render_0576', 'render_0640', 'render_0704', 'render_0768', 'render_0832', 'render_0896', 'render_0960', 'render_1024', 'render_1088', 'render_1152', 'render_1216', 'render_1280', 'render_1344', 'render_1408', 'render_1472', 'render_1536', 'render_1600', 'render_1664', 'render_1728', 'decode_0000', 'decode_0100', 'decode_0200', 'decode_0300', 'decode_0400', 'decode_0500', 'decode_0600', 'decode_0700', 'decode_0800', 'decode_0900', 'decode_1000', 'decode_1100', 'decode_1200', 'decode_1300', 'decode_1400', 'decode_1500', 'renderer_and_case_gate', 'capture_baseline', 'success_0000', 'success_0025', 'success_0050', 'success_0075', 'success_0100', 'success_0125', 'success_0150', 'success_0175', 'success_0200', 'refusal_0000', 'refusal_0050', 'refusal_0100', 'refusal_0150', 'refusal_0200', 'refusal_0250', 'refusal_0300', 'refusal_0350', 'refusal_0400', 'refusal_0450', 'refusal_0500', 'refusal_0550', 'refusal_0600', 'refusal_0650', 'refusal_0700', 'refusal_0750', 'refusal_0800', 'refusal_0850', 'refusal_0900', 'refusal_0950', 'refusal_1000', 'refusal_1050', 'refusal_1100', 'refusal_1150', 'refusal_1200', 'refusal_1250', 'refusal_1300', 'refusal_1350', 'zone_00', 'zone_01', 'zone_02', 'stubs_and_guards', 'all_metadata_acl', 'role_anon', 'role_authenticated', 'role_service_role', 'final_inventory')
PHASE_SECONDS = 120
STREAM_LIMIT = 128 * 1024 * 1024
CLEANUP_SECONDS = 180
TERMINATE_SECONDS = 5
MARKER = 'lrv_configuration_record_phase_marker'
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3] if HERE.name == 'candidate' else HERE.parents[2]


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
        self.original_outer_deadline = runtime.original_outer_deadline
        self.outer_deadline = min(runtime.deadline, self.original_outer_deadline - 60)
        self.started = time.monotonic()
        self.phase_deadline = min(self.started + phase_seconds, self.outer_deadline)
        self.nonce = secrets.token_hex(16)
        self.process = None
        self.pending = bytearray()
        self.expected = None
        self.seen = False
        self.backend = None
        self.dispatch_complete = False
        self.receipt = dict(kind='configuration-record-phased-session-v1', passed=False,
                            phase_seconds=phase_seconds, outer_deadline=self.original_outer_deadline,
                            measurement_deadline=self.outer_deadline,
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
                self.check_time()
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
        self.check_time()
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
            self.check_time()
            _validate_phases(self.phases)
            identity = _marker(self.nonce, -1, 'identity')
            frames = []
            phase_evidence = []
            with (self.folder / 'framed-stdin.sql').open('xb') as framed:
                os.chmod(framed.name, 0o600)
                framed.write(identity)
                for index, (name, sql) in enumerate(self.phases):
                    self.check_time()
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
            self.check_time()
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
    """Run93 fixed stored-configuration phases on one verified owned backend.

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
            session.check_time()
            runtime.check_config()
            session.check_time()
            observed = runtime.verify()
            session.check_time()
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
