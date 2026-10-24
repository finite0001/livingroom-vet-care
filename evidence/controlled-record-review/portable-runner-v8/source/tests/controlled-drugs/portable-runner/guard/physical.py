"""Descriptor based physical-path admission for the private offline worker."""
from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import stat


class AdmissionError(ValueError):
    pass


def absolute(path):
    value = os.fspath(path)
    if type(value) is not str or not value.startswith('/') or '\x00' in value:
        raise AdmissionError('Absolute physical path required')
    parts = value.split('/')[1:]
    if not parts or any(x in ('', '.', '..') for x in parts):
        raise AdmissionError('Canonical physical path components required')
    if len(value.encode('utf-8', 'strict')) > 4096:
        raise AdmissionError('Physical path exceeds bound')
    return value, parts


def directory_fd(path):
    value, parts = absolute(path)
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in parts:
            nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = nxt
        return fd
    except BaseException:
        os.close(fd)
        raise


@dataclass(frozen=True)
class Directory:
    path: str
    dev: int
    ino: int
    mode: int

    def verify(self):
        current = admit_directory(self.path)
        if current != self:
            raise AdmissionError('Registered directory identity changed')


def admit_directory(path, *, mode=None):
    value, _ = absolute(path)
    fd = directory_fd(value)
    try:
        info = os.fstat(fd)
        permissions = stat.S_IMODE(info.st_mode)
        if mode is not None and permissions != mode:
            raise AdmissionError('Owned directory mode differs')
        return Directory(value, info.st_dev, info.st_ino, permissions)
    finally:
        os.close(fd)


def identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
            info.st_ctime_ns, stat.S_IMODE(info.st_mode), info.st_nlink)


@dataclass(frozen=True)
class File:
    path: str
    sha256: str
    size: int
    identity: tuple

    def verify(self):
        pin, _ = read_file(self.path, limit=self.size, expected_sha=self.sha256,
                           expected_size=self.size)
        if pin != self:
            raise AdmissionError('Admitted file identity changed')
        return pin


def read_file(path, *, limit, expected_sha=None, expected_size=None, mode=None):
    value, parts = absolute(path)
    if type(limit) is not int or limit < 0:
        raise AdmissionError('Finite file bound required')
    parent = '/' + '/'.join(parts[:-1]) if len(parts) > 1 else None
    fd = directory_fd(parent) if parent else os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    leaf = None
    try:
        leaf = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        before = os.fstat(leaf)
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise AdmissionError('Bounded regular file required')
        if expected_size is not None and (type(expected_size) is not int or before.st_size != expected_size):
            raise AdmissionError('File byte count differs')
        if mode is not None and (stat.S_IMODE(before.st_mode) != mode or before.st_nlink != 1):
            raise AdmissionError('Generated executable mode/link count differs')
        chunks, count, digest = [], 0, hashlib.sha256()
        while True:
            part = os.read(leaf, min(1024 * 1024, limit + 1 - count))
            if not part:
                break
            chunks.append(part)
            count += len(part)
            if count > limit:
                raise AdmissionError('File grew beyond bound')
            digest.update(part)
        after = os.fstat(leaf)
        named = os.stat(parts[-1], dir_fd=fd, follow_symlinks=False)
        if identity(before) != identity(after) or identity(after) != identity(named) or count != before.st_size:
            raise AdmissionError('File changed during admission')
        hashed = digest.hexdigest()
        if expected_sha is not None and hashed != expected_sha:
            raise AdmissionError('File digest differs')
        return File(value, hashed, count, identity(after)), b''.join(chunks)
    finally:
        if leaf is not None:
            os.close(leaf)
        os.close(fd)


def relative(value):
    if type(value) is not str or value.startswith('/') or '\\' in value or '\x00' in value:
        raise AdmissionError('Exact relative file path required')
    if any(x in ('', '.', '..') for x in value.split('/')):
        raise AdmissionError('Relative path traversal refused')
    return value


def beneath(root, path):
    """Lexical membership only; caller also descriptor-walks every component."""
    value, _ = absolute(path)
    return value.startswith(root.path + '/')
