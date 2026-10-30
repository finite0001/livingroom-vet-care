"""Private binary backup transport, separate from the UTF-8 observer channel.

No database is selected here. Callers supply verified owned-process arguments
and the remainder of their existing deadline; this module never renews it.
"""
import hashlib
import math
import os
from pathlib import Path
import selectors
import signal
import stat
import subprocess
import time

import bounded_process

ARCHIVE_CAP = 64 * 1024 * 1024
DIAGNOSTIC_CAP = 2 * 1024 * 1024


def _deadline(timeout):
    if type(timeout) not in (int, float) or not math.isfinite(timeout) or not 0 < timeout <= 600:
        raise ValueError('Finite remaining original deadline required')
    return time.monotonic() + timeout


def _left(deadline):
    left = deadline - time.monotonic()
    if left <= 0:
        raise TimeoutError('Original archive deadline exhausted')
    return left


def _arguments(argv):
    if type(argv) not in (list, tuple) or not argv or any(type(v) is not str or not v or '\0' in v for v in argv):
        raise ValueError('Explicit owned-process argument array required')


def _finish_group(process):
    # Do not poll/reap the leader before signalling its exact session. A child
    # can retain the pipes after its leader exits. No name-based process search.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except PermissionError:
        # macOS can refuse signalling a fully exited group. Accept only after
        # our leader is reaped and an independent bounded observation finds
        # no live member of that exact group, matching the text transport.
        if process.poll() is None:
            raise
        groups = bounded_process.run(['/bin/ps', '-axo', 'pgid=,stat='], timeout=2,
            stdout_cap=1024 * 1024, stderr_cap=65536, check=True).stdout
        for line in groups.splitlines():
            fields = line.split()
            if len(fields) != 2 or not fields[0].isdigit():
                raise RuntimeError('Unrecognized process-group observation')
            if int(fields[0]) == process.pid and not fields[1].startswith('Z'):
                raise RuntimeError('Owned archive process group still has a live member')
    finally:
        try:
            process.wait(timeout=2)
        finally:
            for pipe in (process.stdin, process.stdout, process.stderr):
                if pipe is not None and not pipe.closed:
                    pipe.close()


def _transfer(argv, deadline, *, incoming, sink, output_cap, env, cwd):
    _arguments(argv)
    _left(deadline)
    process = subprocess.Popen(argv, stdin=subprocess.PIPE if incoming is not None else subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True, close_fds=True, env=env, cwd=cwd)
    sent = 0
    received = 0
    diagnostics = bytearray()
    try:
        with selectors.DefaultSelector() as selector:
            for name in ('stdout', 'stderr'):
                pipe = getattr(process, name)
                os.set_blocking(pipe.fileno(), False)
                selector.register(pipe, selectors.EVENT_READ, name)
            if incoming is not None:
                os.set_blocking(process.stdin.fileno(), False)
                selector.register(process.stdin, selectors.EVENT_WRITE, 'stdin')
            while selector.get_map():
                for key, _ in selector.select(min(_left(deadline), 0.05)):
                    pipe, name = key.fileobj, key.data
                    if name == 'stdin':
                        try:
                            written = os.write(pipe.fileno(), memoryview(incoming)[sent:sent + 65536])
                        except BlockingIOError:
                            continue
                        except BrokenPipeError as error:
                            raise ValueError('Archive consumer closed before complete input') from error
                        sent += written
                        if sent == len(incoming):
                            selector.unregister(pipe)
                            pipe.close()
                        continue
                    cap = output_cap - received if name == 'stdout' else DIAGNOSTIC_CAP - len(diagnostics)
                    try:
                        chunk = os.read(pipe.fileno(), min(65536, cap + 1))
                    except BlockingIOError:
                        continue
                    if not chunk:
                        selector.unregister(pipe)
                        pipe.close()
                    elif name == 'stderr':
                        diagnostics.extend(chunk)
                        if len(diagnostics) > DIAGNOSTIC_CAP:
                            raise ValueError('Archive diagnostic byte contract exceeded')
                    else:
                        received += len(chunk)
                        if received > output_cap:
                            raise ValueError('Archive output byte contract exceeded')
                        sink(chunk)
            if incoming is not None and sent != len(incoming):
                raise ValueError('Archive input incomplete')
            # Observe completion WITHOUT reaping the leader. Its reserved PID
            # keeps signalling our process group safe even if a descendant has
            # closed every inherited pipe and continues running independently.
            while True:
                _left(deadline)
                ended = os.waitid(os.P_PID, process.pid, os.WEXITED | os.WNOWAIT | os.WNOHANG)
                if ended is not None:
                    break
                time.sleep(min(_left(deadline), 0.01))
            code = ended.si_status if ended.si_code == os.CLD_EXITED else -ended.si_status
            _left(deadline)
            if code != 0:
                raise subprocess.CalledProcessError(code, argv, stderr=bytes(diagnostics))
            if diagnostics:
                raise ValueError('Archive process produced unexpected diagnostics')
            return received
    finally:
        _finish_group(process)


class Archive:
    """An exclusive private file with an original descriptor and byte binding."""
    def __init__(self, path, descriptor, length, digest):
        self.path = Path(path)
        self.descriptor = descriptor
        self.length = length
        self.sha256 = digest
        self.identity = os.fstat(descriptor)

    def close(self):
        if self.descriptor is not None:
            os.close(self.descriptor)
            self.descriptor = None

    def _stat(self):
        if self.descriptor is None:
            raise ValueError('Archive descriptor is closed')
        actual, named = os.fstat(self.descriptor), self.path.lstat()
        for item in (actual, named):
            if not stat.S_ISREG(item.st_mode) or stat.S_IMODE(item.st_mode) != 0o600 or item.st_nlink != 1:
                raise ValueError('Exclusive private regular archive required')
            if (item.st_dev, item.st_ino, item.st_size) != (self.identity.st_dev, self.identity.st_ino, self.length):
                raise ValueError('Original archive identity or size changed')
        return actual

    def _verified_bytes(self, deadline):
        before = self._stat()
        os.lseek(self.descriptor, 0, os.SEEK_SET)
        raw = bytearray()
        while True:
            _left(deadline)
            chunk = os.read(self.descriptor, min(65536, self.length - len(raw) + 1))
            if not chunk:
                break
            raw.extend(chunk)
            if len(raw) > self.length:
                raise ValueError('Archive grew during verification')
        after = self._stat()
        if len(raw) != self.length or hashlib.sha256(raw).hexdigest() != self.sha256:
            raise ValueError('Complete original archive hash differs')
        if (before.st_mtime_ns, before.st_ctime_ns) != (after.st_mtime_ns, after.st_ctime_ns):
            raise ValueError('Archive changed during verification')
        _left(deadline)
        # The consumer receives immutable verified bytes, never a path reopened
        # after verification or a descriptor subject to a later file mutation.
        return bytes(raw)

    def restore(self, argv, *, timeout, env=None, cwd=None):
        """Deliver verified bytes; independent restored-state checks remain required.

        A pipe's successful delivery cannot prove a consumer processed its input.
        The native runner must use its fixed strict pg_restore invocation and
        compare complete restored inventories before claiming restore acceptance.
        """
        deadline = _deadline(timeout)
        _arguments(argv)
        raw = self._verified_bytes(deadline)
        _transfer(argv, deadline, incoming=raw, sink=lambda _: None,
                  output_cap=0, env=env, cwd=cwd)
        return {'bytes': self.length, 'sha256': self.sha256}


def capture(argv, path, *, timeout, env=None, cwd=None):
    deadline = _deadline(timeout)
    _arguments(argv)
    target = Path(path)
    descriptor = os.open(target, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    digest = hashlib.sha256()
    length = 0
    success = False
    try:
        def sink(chunk):
            nonlocal length
            view = memoryview(chunk)
            while view:
                _left(deadline)
                amount = os.write(descriptor, view)
                if amount <= 0:
                    raise ValueError('Archive write incomplete')
                view = view[amount:]
            digest.update(chunk)
            length += len(chunk)
        _transfer(argv, deadline, incoming=None, sink=sink, output_cap=ARCHIVE_CAP, env=env, cwd=cwd)
        if not length:
            raise ValueError('Empty archive refused')
        os.fsync(descriptor)
        _left(deadline)
        result = Archive(target, descriptor, length, digest.hexdigest())
        result._stat()
        success = True
        return result
    finally:
        if not success:
            original = os.fstat(descriptor)
            os.close(descriptor)
            try:
                named = target.lstat()
                if (original.st_dev, original.st_ino) == (named.st_dev, named.st_ino):
                    target.unlink()
            except FileNotFoundError:
                pass
