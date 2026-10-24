"""Hold one fresh five-slot output directory across a finite worker execution.

This observes physical bytes, not test success. The parent independently checks
the returned hashes and validates the job/terminal/guard bodies. Construct before
writing the job or launching the worker; always close in the parent's finally.
"""
from dataclasses import dataclass
import hashlib
import math
import os
from pathlib import Path
import re
import stat
import time

SLOTS = ('job', 'stdout', 'stderr', 'terminal', 'guard')
MAX_BYTES = 4 * 1024 * 1024
CHUNK = 65536


def _identity(st):
    return st.st_dev, st.st_ino, st.st_mode, st.st_uid


def _stamp(st):
    return (*_identity(st), st.st_nlink, st.st_size, st.st_mtime_ns, st.st_ctime_ns)


@dataclass(frozen=True)
class Slot:
    name: str
    size: int
    sha256: str
    identity: tuple
    raw: bytes | None


class HeldOutput:
    def __init__(self, directory, names, *, deadline, check):
        self.fds = []
        self.edges = []
        self.failed = False
        self.closed = False
        now = time.monotonic()
        if type(deadline) not in (int, float) or not math.isfinite(deadline) or not now < deadline <= now + 600:
            raise ValueError('original finite deadline required')
        self.deadline = deadline
        if not callable(check):
            raise ValueError('parent capacity/deadline check required')
        self.parent_check = check
        if (type(directory) is not str or not directory.startswith('/')
                or directory.startswith('//') or '\x00' in directory
                or directory != str(Path(directory)) or '..' in Path(directory).parts):
            raise ValueError('normalized absolute physical directory required')
        if type(names) is not dict or set(names) != set(SLOTS):
            raise ValueError('exact five slot names required')
        if any(type(v) is not str or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}\.(json|log)', v) for v in names.values()):
            raise ValueError('fixed leaf basenames required')
        if len(set(names.values())) != 5:
            raise ValueError('distinct slot names required')
        self.names = tuple((slot, names[slot]) for slot in SLOTS)
        try:
            self._check()
            self.fds.append(os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW))
            for part in Path(directory).parts[1:]:
                self._check()
                parent = self.fds[-1]
                fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
                self.fds.append(fd)
                self.edges.append((parent, part, fd, _identity(os.fstat(fd))))
            self.root = self.fds[-1]
            st = os.fstat(self.root)
            if st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) != 0o700:
                raise ValueError('owned private0700 output root required')
            self.root_identity = _identity(st)
            self._verify()
            for _, name in self.names:
                try:
                    os.stat(name, dir_fd=self.root, follow_symlinks=False)
                except FileNotFoundError:
                    pass
                else:
                    raise ValueError('all five output slots must be absent before launch')
            self._check()
        except BaseException as error:
            self.failed = True
            try:
                self.close()
            except BaseException as closing:
                error.add_note('Output admission close failed: ' + type(closing).__name__)
            raise

    def _check(self):
        if self.failed or self.closed:
            raise ValueError('output observer is failed or closed')
        if time.monotonic() >= self.deadline:
            raise TimeoutError('original output deadline exhausted')
        self.parent_check()
        if self.failed or self.closed:
            raise ValueError('output observer failed during parent check')
        if time.monotonic() >= self.deadline:
            raise TimeoutError('original output deadline exhausted')

    def _verify(self):
        self._check()
        if _identity(os.fstat(self.root)) != self.root_identity:
            raise ValueError('output root changed')
        for parent, name, fd, identity in self.edges:
            self._check()
            named = os.stat(name, dir_fd=parent, follow_symlinks=False)
            if not stat.S_ISDIR(named.st_mode) or _identity(named) != identity or _identity(os.fstat(fd)) != identity:
                raise ValueError('held output ancestry changed')
        self._check()

    def _read(self, slot, name):
        self._verify()
        fd = None
        primary = None
        try:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=self.root)
            st = os.fstat(fd)
            if (not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid()
                    or stat.S_IMODE(st.st_mode) != 0o600 or st.st_nlink != 1
                    or not 0 <= st.st_size <= MAX_BYTES
                    or (slot not in ('stdout', 'stderr') and st.st_size == 0)):
                raise ValueError('bounded owned0600 single-link regular slot required')
            chunks = []
            count = 0
            digest = hashlib.sha256()
            while True:
                self._check()
                raw = os.read(fd, min(CHUNK, st.st_size + 1 - count))
                self._check()
                if not raw:
                    break
                count += len(raw)
                if count > st.st_size:
                    raise ValueError('output slot grew')
                digest.update(raw)
                if slot not in ('stdout', 'stderr'):
                    chunks.append(raw)
            after = os.fstat(fd)
            named = os.stat(name, dir_fd=self.root, follow_symlinks=False)
            if count != st.st_size or _stamp(st) != _stamp(after) or _stamp(after) != _stamp(named):
                raise ValueError('output slot changed during observation')
            result = Slot(slot, count, digest.hexdigest(), _stamp(st),
                          b''.join(chunks) if slot not in ('stdout', 'stderr') else None)
            self._verify()
        except BaseException as error:
            primary = error
            raise
        finally:
            if fd is not None:
                try:
                    os.close(fd)
                except BaseException as closing:
                    if primary is None:
                        raise
                    primary.add_note('Output leaf close failed: ' + type(closing).__name__)
        self._check()
        return result

    def observe(self):
        """Return an immutable ordered five-slot observation; failure is sticky."""
        try:
            self._verify()
            result = tuple(self._read(slot, name) for slot, name in self.names)
            # Catch replacement of an earlier file while later slots were read.
            for item, (_, name) in zip(result, self.names):
                self._check()
                if _stamp(os.stat(name, dir_fd=self.root, follow_symlinks=False)) != item.identity:
                    raise ValueError('earlier output slot changed')
            self._verify()
            self._check()
            return result
        except BaseException:
            self.failed = True
            raise

    def close(self):
        """Attempt every owned close once, even after error; no numeric FD retry."""
        handles, self.fds = self.fds, []
        self.closed = True
        first = None
        for fd in reversed(handles):
            try:
                os.close(fd)
            except BaseException as error:
                if first is None:
                    first = error
        if first is not None:
            raise first
        if time.monotonic() >= self.deadline:
            raise TimeoutError('original output deadline exhausted during close')
