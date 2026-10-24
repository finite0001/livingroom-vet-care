"""Finite physical allowlisted copy; manifest authority and disk admission external."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import uuid

MAX_MEMBERS = 1024
MAX_MEMBER = 64 * 1024 * 1024
MAX_TOTAL = 256 * 1024 * 1024
CHUNK = 65536
PRIVATE_TOP = frozenset(('tmp', 'node_modules', '.git', '.claude', '.codex', '.ssh', '.aws', '.config', '.docker', '.kube', '.gnupg'))
PRIVATE_COMPONENTS = frozenset(('.git', '__pycache__', 'node_modules', '.ssh', '.aws', '.npmrc', '.netrc', '.gitconfig', '.git-credentials', '.pypirc'))


class SourceCopyError(RuntimeError):
    def __init__(self, phase, retained_root, cause):
        super().__init__('source copy refused during ' + phase + ': ' + type(cause).__name__)
        self.phase = phase
        self.retained_root = str(retained_root) if retained_root is not None else None


def _relative(name):
    if (type(name) is not str or not name or len(name.encode('utf-8')) > 4096
            or name.startswith('/') or '\\' in name or any(ord(c) < 32 or ord(c) == 127 for c in name)):
        raise ValueError('bounded relative source path required')
    parts = name.split('/')
    if any(part in ('', '.', '..') for part in parts) or len(parts) > 64:
        raise ValueError('finite literal relative path segments required')
    if (parts[0] in PRIVATE_TOP or any(part in PRIVATE_COMPONENTS or part == '.env'
            or part.startswith('.env.') for part in parts)):
        raise ValueError('private configuration/cache path refused')
    return tuple(parts)


def admit_manifest(value, check=lambda: None):
    """Validate/copy expectations; never generate expectations from live sources."""
    if type(value) is not dict or not 1 <= len(value) <= MAX_MEMBERS:
        raise ValueError('finite nonempty source manifest required')
    result = {}; total = 0
    for name, metadata in value.items():
        check(); _relative(name)
        if type(metadata) is not dict or metadata.keys() != {'bytes', 'sha256'}:
            raise ValueError('exact source metadata keys required')
        size, digest = metadata['bytes'], metadata['sha256']
        if type(size) is not int or not 0 <= size <= MAX_MEMBER:
            raise ValueError('formal bounded source byte length required')
        if type(digest) is not str or re.fullmatch('[0-9a-f]{64}', digest) is None:
            raise ValueError('fixed source SHA256 required')
        total += size
        if total > MAX_TOTAL:
            raise ValueError('aggregate source byte cap')
        result[name] = {'bytes': size, 'sha256': digest}
    # A file may not also be an ancestor directory of another declared member.
    for name in result:
        check(); parts = _relative(name)
        if any('/'.join(parts[:i]) in result for i in range(1, len(parts))):
            raise ValueError('source file/directory path collision')
    check(); return dict(sorted(result.items()))


def _absolute(value):
    path = Path(value)
    if str(value).startswith('//') or not path.is_absolute() or '..' in path.parts or str(path) != str(value):
        raise ValueError('normalized absolute physical path required')
    return path


def _directory_identity(s):
    return (s.st_dev, s.st_ino, s.st_mode)


def _file_identity(s):
    return (s.st_dev, s.st_ino, s.st_mode, s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def _close_all(descriptors):
    primary = sys.exc_info()[1]; failure = None
    for descriptor in reversed(descriptors):
        try:
            os.close(descriptor)
        except BaseException as error:
            if failure is None: failure = error
            if primary is not None: primary.add_note('Source-copy descriptor close also failed: ' + type(error).__name__)
    if primary is None and failure is not None: raise failure


class PhysicalRoot:
    def __init__(self, path, check):
        self.path = _absolute(path); self.check = check
        self.descriptors = []; self.edges = []; self.fd = None
        try:
            check(); fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            self.descriptors.append(fd)
            for component in self.path.parts[1:]:
                check(); parent = fd
                fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
                self.descriptors.append(fd)
                self.edges.append((parent, component, fd, _directory_identity(os.fstat(fd))))
            self.fd = fd; self.identity = _directory_identity(os.fstat(fd)); self.verify()
        except BaseException:
            _close_all(self.descriptors); self.descriptors = []; raise

    def verify(self):
        self.check()
        if _directory_identity(os.fstat(self.fd)) != self.identity:
            raise ValueError('physical root changed')
        for parent, name, fd, identity in self.edges:
            self.check(); current = os.stat(name, dir_fd=parent, follow_symlinks=False)
            if not stat.S_ISDIR(current.st_mode) or _directory_identity(current) != identity or _directory_identity(os.fstat(fd)) != identity:
                raise ValueError('physical ancestor link changed')
        self.check()

    def close(self):
        handles, self.descriptors = self.descriptors, []
        _close_all(handles)



def _assert_outside_source(source, parent):
    """Lexical paths are insufficient on case-folding or aliased filesystems."""
    source.verify(); parent.verify()
    source_identity = source.identity[:2]
    for descriptor in parent.descriptors:
        parent.check(); observed = os.fstat(descriptor)
        if (observed.st_dev, observed.st_ino) == source_identity:
            raise ValueError('destination parent physically inside source tree')
    source.verify(); parent.verify()


def _parent(root, parts, check, *, directory_ids=None, admit_directories=False):
    """Return held descendant parent descriptors and immutable edge identities."""
    handles = []; edges = []; parent = root.fd
    try:
        root.verify(); prefix = []
        for name in parts[:-1]:
            check(); fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            handles.append(fd); identity = _directory_identity(os.fstat(fd)); prefix.append(name)
            key = '/'.join(prefix)
            if directory_ids is not None:
                if key not in directory_ids and admit_directories:
                    directory_ids[key] = identity
                elif directory_ids.get(key) != identity:
                    raise ValueError('admitted descendant directory identity changed')
            edges.append((parent, name, fd, identity)); parent = fd
        _verify_edges(root, edges, check); return parent, handles, edges
    except BaseException:
        _close_all(handles); raise


def _verify_edges(root, edges, check):
    root.verify()
    for parent, name, fd, identity in edges:
        check(); current = os.stat(name, dir_fd=parent, follow_symlinks=False)
        if not stat.S_ISDIR(current.st_mode) or _directory_identity(current) != identity or _directory_identity(os.fstat(fd)) != identity:
            raise ValueError('source descendant directory link changed')
    check()


def _source(root, name, metadata, check, *, expected_identity=None, sink=None, directory_ids=None, admit_directories=False):
    parts = _relative(name); parent, handles, edges = _parent(root, parts, check, directory_ids=directory_ids, admit_directories=admit_directories)
    try:
        check(); fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent); handles.append(fd)
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size != metadata['bytes']:
            raise ValueError('exact regular singly linked source member required')
        identity = _file_identity(before)
        if expected_identity is not None and identity != expected_identity:
            raise ValueError('source identity changed after admission')
        digest = hashlib.sha256(); count = 0
        while True:
            check(); block = os.read(fd, min(CHUNK, metadata['bytes'] + 1 - count)); check()
            if not block: break
            count += len(block)
            if count > metadata['bytes']: raise ValueError('source grew during read')
            digest.update(block)
            if sink is not None: sink(block)
        check(); after = os.fstat(fd); linked = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
        if identity != _file_identity(after) or identity != _file_identity(linked):
            raise ValueError('source descriptor/name identity changed')
        if count != metadata['bytes'] or digest.hexdigest() != metadata['sha256']:
            raise ValueError('source bytes differ from independent manifest')
        _verify_edges(root, edges, check)
        return identity
    finally:
        _close_all(handles)


def _directories(manifest):
    return { '/'.join(parts[:i]) for name in manifest for parts in [_relative(name)] for i in range(1, len(parts)) }


def _verify_destination(root, manifest, directory_names, created, check):
    seen_files = set(); seen_dirs = set(); inode_keys = set()
    def visit(fd, prefix):
        check()
        # Iteration stays bounded even if a foreign writer adds extra entries.
        with os.scandir(fd) as entries:
            names = []
            for entry in entries:
                check(); names.append(entry.name)
                if len(names) > len(manifest) + len(directory_names):
                    raise ValueError('destination entry count exceeds finite manifest')
        for name in sorted(names):
            check(); rel = prefix + name
            st = os.stat(name, dir_fd=fd, follow_symlinks=False)
            if stat.S_ISDIR(st.st_mode):
                if rel not in directory_names or stat.S_IMODE(st.st_mode) != 0o700:
                    raise ValueError('undeclared or altered destination directory')
                child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                try:
                    if _directory_identity(os.fstat(child)) != _directory_identity(st): raise ValueError('destination directory replaced')
                    if _directory_identity(st) != created['dirs'][rel]: raise ValueError('created destination directory identity changed')
                    seen_dirs.add(rel); visit(child, rel + '/')
                    current = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    if _directory_identity(current) != _directory_identity(st): raise ValueError('destination directory link changed')
                finally: _close_all([child])
            elif stat.S_ISREG(st.st_mode):
                if rel not in manifest or stat.S_IMODE(st.st_mode) != 0o600 or st.st_nlink != 1:
                    raise ValueError('undeclared or altered destination file')
                key = (st.st_dev, st.st_ino)
                if key != created['files'][rel] or key in inode_keys: raise ValueError('destination file inode changed or aliased')
                inode_keys.add(key); seen_files.add(rel)
                _source(root, rel, manifest[rel], check, expected_identity=_file_identity(st), directory_ids=created['dirs'])
            else:
                raise ValueError('destination contains nonregular member')
    root.verify(); visit(root.fd, '')
    if seen_files != set(manifest) or seen_dirs != directory_names:
        raise ValueError('destination complete keysets differ')
    root.verify(); check()


def copy_sources(source_root, destination_parent, expected_files, check, *, basename=None):
    """Return exact copy receipt; any created failed tree remains for inspection."""
    source = parent = destination = None; retained = None; phase = 'manifest-admission'
    try:
        if not callable(check): raise ValueError('original deadline check callback required')
        check(); manifest = admit_manifest(expected_files, check); check()
        source_path = _absolute(source_root); parent_path = _absolute(destination_parent)
        name = basename if basename is not None else 'portable-source-' + uuid.uuid4().hex
        if type(name) is not str or re.fullmatch('[A-Za-z0-9][A-Za-z0-9_-]{0,99}', name) is None:
            raise ValueError('finite new destination basename required')
        # Existing destination-parent admission is read-only. No directories or
        # files are created until every expected source has passed its full hash.
        phase = 'source-admission'; source = PhysicalRoot(source_path, check); parent = PhysicalRoot(parent_path, check)
        if parent.path == source.path or source.path in parent.path.parents:
            raise ValueError('destination parent must be outside source tree')
        _assert_outside_source(source, parent)
        source_directories = {}
        identities = {key: _source(source, key, value, check, directory_ids=source_directories, admit_directories=True) for key, value in manifest.items()}
        source.verify(); parent.verify(); check()
        phase = 'destination-create'; os.mkdir(name, 0o700, dir_fd=parent.fd)
        retained = parent.path / name
        # Capture the freshly created root before invoking another callback.
        root_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent.fd)
        try:
            root_identity = _directory_identity(os.fstat(root_fd))
            if stat.S_IMODE(root_identity[2]) != 0o700: raise ValueError('new destination root mode differs')
            parent.verify(); check(); destination = PhysicalRoot(retained, check)
            if destination.identity != root_identity: raise ValueError('new destination root identity changed')
        finally: _close_all([root_fd])
        directories = _directories(manifest); created = {'dirs': {}, 'files': {}}
        phase = 'destination-directories'
        for relative in sorted(directories, key=lambda value: (value.count('/'), value)):
            check(); parts = _relative(relative); owner, handles, edges = _parent(destination, parts, check, directory_ids=created['dirs'])
            try:
                os.mkdir(parts[-1], 0o700, dir_fd=owner)
                st = os.stat(parts[-1], dir_fd=owner, follow_symlinks=False)
                if not stat.S_ISDIR(st.st_mode) or stat.S_IMODE(st.st_mode) != 0o700: raise ValueError('created directory mode differs')
                created['dirs'][relative] = _directory_identity(st)
                _verify_edges(destination, edges, check)
            finally: _close_all(handles)
        phase = 'copy-members'
        for relative, metadata in manifest.items():
            check(); parts = _relative(relative); owner, handles, edges = _parent(destination, parts, check, directory_ids=created['dirs'])
            try:
                fd = os.open(parts[-1], os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=owner)
                handles.append(fd); initial = os.fstat(fd)
                if not stat.S_ISREG(initial.st_mode) or initial.st_nlink != 1 or stat.S_IMODE(initial.st_mode) != 0o600:
                    raise ValueError('new exclusive regular file required')
                created['files'][relative] = (initial.st_dev, initial.st_ino)
                if created['files'][relative] == identities[relative][:2]: raise ValueError('source/destination inode alias')
                def sink(block):
                    offset = 0
                    while offset < len(block):
                        check(); written = os.write(fd, block[offset:offset + CHUNK]); check()
                        if type(written) is not int or not 0 < written <= min(CHUNK, len(block) - offset):
                            raise OSError('invalid destination write progress')
                        offset += written
                _source(source, relative, metadata, check, expected_identity=identities[relative], sink=sink, directory_ids=source_directories)
                check(); os.fsync(fd); check()
                st = os.fstat(fd); linked = os.stat(parts[-1], dir_fd=owner, follow_symlinks=False)
                if (st.st_dev, st.st_ino) != created['files'][relative] or _file_identity(st) != _file_identity(linked) or st.st_size != metadata['bytes']:
                    raise ValueError('destination descriptor/name/size changed')
                _verify_edges(destination, edges, check)
            finally: _close_all(handles)
        phase = 'verify-complete-destination'; _verify_destination(destination, manifest, directories, created, check)
        phase = 'verify-original-sources'
        for relative, metadata in manifest.items():
            check(); _source(source, relative, metadata, check, expected_identity=identities[relative], directory_ids=source_directories)
        phase = 'verify-final-destination'
        _verify_destination(destination, manifest, directories, created, check)
        source.verify(); parent.verify(); destination.verify(); check()
        receipt = {'kind': 'physical-allowlisted-source-copy-v1', 'root': str(retained),
                   'root_identity': list(destination.identity), 'file_count': len(manifest),
                   'directory_count': len(directories), 'bytes': sum(v['bytes'] for v in manifest.values()),
                   'manifest_sha256': hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
                   'source_unchanged': True, 'destination_verified': True, 'authority': 'caller-supplied-independent-manifest'}
        phase = 'close-descriptors'
        for opened in (destination, parent, source): opened.close()
        destination = parent = source = None
        check(); return receipt
    except BaseException as error:
        raise SourceCopyError(phase, retained, error) from error
    finally:
        primary = sys.exc_info()[1]
        for opened in (destination, parent, source):
            if opened is not None:
                try: opened.close()
                except BaseException as error:
                    if primary is not None: primary.add_note('Source-copy final close failed: ' + type(error).__name__)
                    else: raise
