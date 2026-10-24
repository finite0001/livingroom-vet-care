"""One admitted worker transport. No orchestration, source admission or CLI."""
import hashlib
import math
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import time

CHUNK_BYTES = 64 * 1024
STREAM_BYTES = TERMINAL_BYTES = 4 * 1024 * 1024
WORKER_SECONDS = 600
STOP_SECONDS = 5
TERM_SECONDS = 1
POLL_SECONDS = 0.025
KEYS = frozenset(('argv', 'cwd', 'env', 'evidence_directory', 'stdout_name',
                  'stderr_name', 'terminal_name', 'expected_ids', 'deadline'))


class Refusal(Exception):
    """Internal fixed-code failure; raw exceptions are not public receipts."""


class TransportFailure(Exception):
    def __init__(self, receipt):
        self.receipt = receipt
        super().__init__(receipt['first_failure']['code'])


def _stamp(st):
    return (st.st_dev, st.st_ino, st.st_mode, st.st_size, st.st_mtime_ns, st.st_ctime_ns)


def _name(value):
    if type(value) is not str or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,99}', value):
        raise Refusal('invalid_evidence_name')
    return value


def _path(value):
    if (type(value) is not str or not value.startswith('/') or '\x00' in value
            or value.startswith('//') or value != str(Path(value)) or any(p in ('.', '..') for p in value.split('/'))):
        raise Refusal('invalid_physical_path')
    return value


class _Directory:
    """Keep every physical ancestor open; never follow an ancestor replacement."""
    def __init__(self, path, check, *, private=False):
        self.path, self.fds, self.edges = _path(path), [], []
        try:
            check()
            self.fds.append(os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW))
            for name in Path(path).parts[1:]:
                check()
                parent = self.fds[-1]
                fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
                self.fds.append(fd)
                self.edges.append((parent, name, fd))
            self.fd = self.fds[-1]
            st = os.fstat(self.fd)
            if private and (stat.S_IMODE(st.st_mode) != 0o700 or st.st_uid != os.getuid()):
                raise Refusal('evidence_directory_not_owned_private')
            self.verify(check)
        except BaseException:
            self.close()
            raise

    def verify(self, check):
        for parent, name, fd in self.edges:
            check()
            named, held = os.stat(name, dir_fd=parent, follow_symlinks=False), os.fstat(fd)
            if (not stat.S_ISDIR(named.st_mode)
                    or (named.st_dev, named.st_ino) != (held.st_dev, held.st_ino)):
                raise Refusal('physical_directory_replaced')
        check()

    def close(self):
        while self.fds:
            os.close(self.fds.pop())


def _read_terminal(directory, name, check):
    directory.verify(check)
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory.fd)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                or before.st_uid != os.getuid() or not 0 < before.st_size <= TERMINAL_BYTES):
            raise Refusal('invalid_terminal_file')
        blocks, count = [], 0
        while True:
            check()
            block = os.read(fd, min(CHUNK_BYTES, TERMINAL_BYTES + 1 - count))
            check()
            if not block:
                break
            count += len(block)
            if count > TERMINAL_BYTES:
                raise Refusal('terminal_cap')
            blocks.append(block)
        after = os.fstat(fd)
        named = os.stat(name, dir_fd=directory.fd, follow_symlinks=False)
        if count != before.st_size or _stamp(before) != _stamp(after) or _stamp(after) != _stamp(named):
            raise Refusal('terminal_changed')
        directory.verify(check)
        return b''.join(blocks)
    finally:
        os.close(fd)


class Transport:
    """Serial owner. Any refusal poisons this instance; callers must stop the run.

    validate_terminal is the independently admitted results.validate_terminal.
    admit(prepared) and check_storage() are mandatory parent authority/capacity
    checks. This component never derives expected source/tool hashes itself.
    """
    def __init__(self, validate_terminal):
        if not callable(validate_terminal):
            raise ValueError('explicit admitted terminal validator required')
        self.validate_terminal = validate_terminal
        self.poisoned = False
        self.active = False

    def run(self, prepared, *, admit, check_storage):
        if self.poisoned or self.active:
            raise TransportFailure({'kind': 'portable-transport-v1', 'passed': False,
                'first_failure': {'code': 'transport_unavailable', 'error_type': 'Refusal'},
                'descendant_cleanup_verified': False, 'future_launches_allowed': False})
        self.active = True
        started = time.monotonic()
        proc = directory = selector = None
        logs, streams, counts, hashes = {}, {}, {'stdout': 0, 'stderr': 0}, {}
        receipt = {'kind': 'portable-transport-v1', 'passed': False,
                   'started': started, 'first_failure': None, 'cleanup_errors': [],
                   'descendant_cleanup_verified': False, 'future_launches_allowed': False,
                   'worker_pid': None, 'worker_reaped': False, 'returncode': None}
        deadline = None
        stage = 'prepared_admission'

        def check():
            if deadline is not None and time.monotonic() >= deadline:
                raise Refusal('worker_deadline')

        def checkpoint():
            check()
            check_storage()
            check()

        def close_logs(sync):
            for name in tuple(logs):
                fd = logs[name]
                if sync:
                    check()
                    os.fsync(fd)
                    check()
                    named = os.stat(prepared[name + '_name'], dir_fd=directory.fd, follow_symlinks=False)
                    held = os.fstat(fd)
                    if (_stamp(named) != _stamp(held) or held.st_size != counts[name]
                            or held.st_nlink != 1):
                        raise Refusal('log_changed')
                os.close(fd)
                del logs[name]
                if sync:
                    check()

        try:
            if type(prepared) is not dict or prepared.keys() != KEYS:
                raise Refusal('prepared_keys')
            deadline = prepared['deadline']
            if (type(deadline) not in (int, float) or not math.isfinite(deadline)
                    or not started < deadline <= started + WORKER_SECONDS):
                raise Refusal('prepared_deadline')
            if not callable(admit) or not callable(check_storage):
                raise Refusal('missing_parent_admission')
            # Copy every mutable launch value before invoking any external callback.
            prepared = dict(prepared)
            argv = prepared['argv']
            if (type(argv) not in (tuple, list) or len(argv) != 8
                    or argv[1:3] not in (['-I', '-B'], ('-I', '-B'))
                    or argv[4] != '--job' or argv[6] != '--job-sha256'
                    or type(argv[7]) is not str or not re.fullmatch('[0-9a-f]{64}', argv[7])):
                raise Refusal('prepared_argv')
            prepared['argv'] = tuple(argv)
            for index in (0, 3, 5):
                _path(argv[index])
            _path(prepared['cwd'])
            env = prepared['env']
            if type(env) is not dict or not env or any(type(k) is not str or type(v) is not str
                    or not k or '=' in k or '\x00' in k + v for k, v in env.items()):
                raise Refusal('prepared_environment')
            prepared['env'] = dict(env)
            ids = prepared['expected_ids']
            if (type(ids) not in (list, tuple) or not 1 <= len(ids) <= 4096
                    or any(type(i) is not str or not i or len(i.encode('utf-8')) > 512 for i in ids)
                    or len(set(ids)) != len(ids)):
                raise Refusal('prepared_ids')
            prepared['expected_ids'] = tuple(ids)
            names = [_name(prepared[key]) for key in ('stdout_name', 'stderr_name', 'terminal_name')]
            if len(set(names)) != 3:
                raise Refusal('colliding_evidence_names')
            checkpoint()
            admit(prepared)
            checkpoint()
            directory = _Directory(prepared['evidence_directory'], check, private=True)
            receipt['paths'] = {name: str(Path(directory.path) / prepared[name + '_name'])
                                for name in ('stdout', 'stderr', 'terminal')}
            # All three must be absent before creating any log or child.
            for name in names:
                try:
                    os.stat(name, dir_fd=directory.fd, follow_symlinks=False)
                except FileNotFoundError:
                    pass
                else:
                    raise Refusal('evidence_collision')
            for name in counts:
                check()
                logs[name] = os.open(prepared[name + '_name'],
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_NONBLOCK,
                    0o600, dir_fd=directory.fd)
                hashes[name] = hashlib.sha256()
            directory.verify(check)
            checkpoint()
            stage = 'spawn'
            proc = subprocess.Popen(prepared['argv'], stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=prepared['cwd'],
                env=prepared['env'], start_new_session=True, close_fds=True, bufsize=0)
            receipt['worker_pid'] = proc.pid
            receipt['spawn_returned_at'] = time.monotonic()
            check()
            if proc.poll() is None and os.getpgid(proc.pid) != proc.pid:
                raise Refusal('worker_session_identity')
            selector = selectors.DefaultSelector()
            for name, pipe in (('stdout', proc.stdout), ('stderr', proc.stderr)):
                os.set_blocking(pipe.fileno(), False)
                selector.register(pipe, selectors.EVENT_READ, name)
                streams[name] = pipe
            stage = 'drain'
            while streams or proc.poll() is None:
                checkpoint()
                for key, _ in selector.select(min(POLL_SECONDS, max(0, deadline - time.monotonic()))):
                    checkpoint()
                    name, pipe = key.data, key.fileobj
                    try:
                        block = os.read(pipe.fileno(), CHUNK_BYTES)
                    except BlockingIOError:
                        continue
                    check()
                    if not block:
                        selector.unregister(pipe)
                        pipe.close()
                        del streams[name]
                        continue
                    if counts[name] + len(block) > STREAM_BYTES:
                        # Retain exactly the permitted prefix, but never accept truncation.
                        prefix = block[:STREAM_BYTES - counts[name]]
                        overflow = True
                    else:
                        prefix, overflow = block, False
                    view = memoryview(prefix)
                    while view:
                        check()
                        written = os.write(logs[name], view)
                        if written <= 0:
                            raise Refusal('log_short_write')
                        hashes[name].update(view[:written])
                        counts[name] += written
                        view = view[written:]
                        check()
                    if overflow:
                        raise Refusal(name + '_cap')
                proc.poll()
            check()
            receipt['returncode'] = proc.returncode
            receipt['worker_reaped'] = proc.returncode is not None
            stage = 'log_persistence'
            close_logs(True)
            directory.verify(check)
            checkpoint()
            stage = 'terminal_validation'
            raw = _read_terminal(directory, prepared['terminal_name'], check)
            terminal = self.validate_terminal(raw, prepared['expected_ids'],
                                               process_returncode=proc.returncode)
            check()
            receipt['terminal_sha256'] = hashlib.sha256(raw).hexdigest()
            receipt['terminal_bytes'] = len(raw)
            receipt['terminal'] = terminal
            directory.verify(check)
            checkpoint()
            stage = 'final_close'
            selector.close()
            selector = None
            directory.close()
            directory = None
            check()
            receipt.update(passed=True, elapsed=time.monotonic() - started,
                future_launches_allowed=True,
                completion_basis='exact_terminal_exit_zero_finite_trusted_tests')
            # No universal OS descendant absence claim, even on normal completion.
            check()
        except BaseException as exc:
            receipt['passed'] = False
            self.poisoned = True
            failed_at = time.monotonic()
            receipt['first_failure'] = {'code': str(exc) if isinstance(exc, Refusal) else stage,
                                       'error_type': type(exc).__name__, 'at': failed_at}
            stop_end = failed_at + STOP_SECONDS
            receipt['stop_deadline'] = stop_end
            receipt['future_launches_allowed'] = False
            # Only the live, unreaped Popen child/session may be signalled. Never
            # signal an old numeric PID after wait/poll has reaped its owner.
            if proc is not None:
                try:
                    if proc.poll() is None:
                        if os.getpgid(proc.pid) != proc.pid:
                            raise Refusal('stop_session_identity')
                        os.killpg(proc.pid, signal.SIGTERM)
                        term_end = min(stop_end, failed_at + TERM_SECONDS)
                        while proc.poll() is None and time.monotonic() < term_end:
                            time.sleep(min(POLL_SECONDS, max(0, term_end - time.monotonic())))
                        if proc.poll() is None and time.monotonic() < stop_end:
                            if os.getpgid(proc.pid) != proc.pid:
                                raise Refusal('kill_session_identity')
                            os.killpg(proc.pid, signal.SIGKILL)
                        while proc.poll() is None and time.monotonic() < stop_end:
                            time.sleep(min(POLL_SECONDS, max(0, stop_end - time.monotonic())))
                    receipt['returncode'] = proc.poll()
                    receipt['worker_reaped'] = proc.returncode is not None
                    if not receipt['worker_reaped']:
                        receipt['cleanup_errors'].append('worker_not_reaped_within_shared_stop_window')
                except BaseException as cleanup:
                    receipt['cleanup_errors'].append(type(cleanup).__name__)
            receipt['cleanup_elapsed'] = time.monotonic() - failed_at
            receipt['elapsed'] = time.monotonic() - started
            raise TransportFailure(receipt) from exc
        finally:
            receipt['stream_bytes'] = counts.copy()
            receipt['stream_sha256'] = {name: digest.hexdigest() for name, digest in hashes.items()}
            # Close owned handles only; never remove logs, scratch or source trees.
            handles = list(streams.values())
            if proc is not None:
                handles.extend(pipe for pipe in (proc.stdout, proc.stderr)
                               if pipe is not None and not pipe.closed and pipe not in handles)
            if selector is not None:
                handles.append(selector)
            if directory is not None:
                handles.append(directory)
            for handle in handles:
                try:
                    handle.close()
                except BaseException as closing:
                    receipt['cleanup_errors'].append('close_' + type(closing).__name__)
            for fd in logs.values():
                try:
                    os.close(fd)
                except BaseException as closing:
                    receipt['cleanup_errors'].append('log_close_' + type(closing).__name__)
            self.active = False
            receipt['elapsed'] = time.monotonic() - started
            if receipt['first_failure'] is not None:
                receipt['cleanup_elapsed'] = time.monotonic() - receipt['first_failure']['at']
        # Include handle closure, final byte/hash receipts, and elapsed accounting.
        # No late success may escape merely because the child has already exited.
        finished = time.monotonic()
        if finished >= deadline or receipt['cleanup_errors']:
            self.poisoned = True
            receipt.update(passed=False, future_launches_allowed=False,
                first_failure={'code': 'worker_deadline' if finished >= deadline else 'handle_close',
                               'error_type': 'Refusal', 'at': finished},
                stop_deadline=finished + STOP_SECONDS, cleanup_elapsed=0,
                elapsed=finished - started)
            raise TransportFailure(receipt)
        return receipt
