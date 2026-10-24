"""Fixed offline historical trees. No target import, subprocess or DB launch.

The two production profiles use separately reviewed immutable manifests. Failed
copies are retained. Future source changes require explicit historical overrides.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import time
import uuid

MANIFEST_SHA = 'f6d229a044a72bcc6babed4f04d92ffb88408ce5864a31ada9ccd2a42c444dbc'
MAX_FILES, MAX_BYTES, MAX_MEMBER = 670, 66979601, 8744800
EXPECTED_PROFILES = {'stored638': (639, 62928772, 638), 'a2_669': (669, 66894621, 645)}


def check(deadline):
    if type(deadline) not in (float, int) or not 0 < deadline < float('inf') or time.monotonic() >= deadline:
        raise ValueError('Finite unexpired absolute deadline required')


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result: raise ValueError('Duplicate manifest key')
        result[key] = value
    return result


def relative(name):
    if type(name) is not str or not name or '\\' in name or '\x00' in name:
        raise ValueError('Normalized relative POSIX path required')
    path = PurePosixPath(name)
    if path.is_absolute() or any(p in ('', '.', '..') for p in name.split('/')) or str(path) != name:
        raise ValueError('Normalized relative POSIX path required')
    return path


DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def open_root(root):
    """Caller supplies physical absolute path; no symlink ancestor is followed."""
    root = Path(root)
    if not root.is_absolute() or '..' in root.parts:
        raise ValueError('Physical absolute directory required')
    fd = os.open('/', DIRECTORY_FLAGS)
    try:
        for part in root.parts[1:]:
            child = os.open(part, DIRECTORY_FLAGS, dir_fd=fd)
            os.close(fd); fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def open_member(root_fd, name, *, create=False):
    parts = relative(name).parts
    directory = os.dup(root_fd)
    try:
        for part in parts[:-1]:
            if create:
                try: os.mkdir(part, mode=0o700, dir_fd=directory)
                except FileExistsError: pass
            child = os.open(part, DIRECTORY_FLAGS, dir_fd=directory)
            os.close(directory); directory = child
        flags = os.O_NOFOLLOW | (os.O_WRONLY | os.O_CREAT | os.O_EXCL if create else os.O_RDONLY | os.O_NONBLOCK)
        fd = os.open(parts[-1], flags, 0o600, dir_fd=directory)
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            os.close(fd)
            raise ValueError('Opened member is not regular')
        return fd
    finally:
        os.close(directory)


def bounded_bytes(root, name, maximum, deadline):
    check(deadline)
    if type(maximum) is not int or not 0 <= maximum <= MAX_MEMBER:
        raise ValueError('Bounded integer read size required')
    root_fd = open_root(root)
    try: fd = open_member(root_fd, name)
    finally: os.close(root_fd)
    with os.fdopen(fd, 'rb') as handle:
        raw = handle.read(maximum+1)
    if len(raw) > maximum: raise ValueError('Read exceeds member bound')
    check(deadline)
    return raw


def digest_file(root, name, maximum, deadline):
    check(deadline)
    root_fd = open_root(root)
    try: fd = open_member(root_fd, name)
    finally: os.close(root_fd)
    return digest_fd(fd, maximum, deadline)


def digest_fd(fd, maximum, deadline):
    digest, size = hashlib.sha256(), 0
    with os.fdopen(fd, 'rb') as handle:
        if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode): raise ValueError('Opened source is not regular')
        while True:
            check(deadline)
            raw = handle.read(1024*1024)
            if not raw: break
            size += len(raw)
            if size > maximum: raise ValueError('Source grew beyond bound')
            digest.update(raw)
    check(deadline)
    return size, digest.hexdigest()


def validate_members(members):
    if type(members) is not list or not 1 <= len(members) <= MAX_FILES:
        raise ValueError('Bounded exact member list required')
    seen = set()
    total = 0
    for entry in members:
        if type(entry) is not dict or set(entry) != {'path', 'source', 'bytes', 'sha256'}:
            raise ValueError('Exact member keys required')
        relative(entry['path']); relative(entry['source'])
        if entry['path'] in seen: raise ValueError('Duplicate destination')
        seen.add(entry['path'])
        if type(entry['bytes']) is not int or not 0 <= entry['bytes'] <= MAX_MEMBER:
            raise ValueError('Bounded integer member bytes required')
        digest = entry['sha256']
        if type(digest) is not str or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
            raise ValueError('Exact lowercase SHA256 required')
        total += entry['bytes']
    if total > MAX_BYTES: raise ValueError('Aggregate materialization bound exceeded')
    for name in seen:
        if any(str(parent) in seen for parent in PurePosixPath(name).parents):
            raise ValueError('File/directory destination collision')
    return total


def load_manifest(deadline):
    check(deadline)
    folder = Path(__file__).absolute().parent
    raw = bounded_bytes(folder, 'historical-manifest.json', 1024**2, deadline)
    if hashlib.sha256(raw).hexdigest() != MANIFEST_SHA: raise ValueError('Independent fixed manifest changed')
    value = json.loads(raw, object_pairs_hook=unique)
    if set(value) != {'kind', 'limits', 'files', 'profiles', 'historical_maps'} or value['kind'] != 'fixed-historical-materialization-v1':
        raise ValueError('Exact manifest shape required')
    if value['limits'] != {'max_materialized_members': MAX_FILES, 'max_materialized_bytes': MAX_BYTES, 'max_member_bytes': MAX_MEMBER}:
        raise ValueError('Fixed materialization limits changed')
    entries = value['files']
    if type(entries) is not dict or len(entries) != MAX_FILES or set(value['profiles']) != set(EXPECTED_PROFILES):
        raise ValueError('Fixed file/profile inventory changed')
    validate_members(list(entries.values()))
    if any(name != entry['path'] for name, entry in entries.items()): raise ValueError('Member map path mismatch')
    for name, (count, size, collector) in EXPECTED_PROFILES.items():
        profile = value['profiles'][name]
        if set(profile) != {'paths', 'count', 'bytes', 'collector_count'}:
            raise ValueError('Exact profile shape required')
        if profile['paths'] != sorted(set(profile['paths'])) or len(profile['paths']) != count:
            raise ValueError('Fixed profile path inventory changed')
        if (profile['count'], profile['bytes'], profile['collector_count']) != (count, size, collector):
            raise ValueError('Fixed profile quantities changed')
        if sum(entries[n]['bytes'] for n in profile['paths']) != size:
            raise ValueError('Profile aggregate differs')
    check(deadline)
    return value


def _copy_members(checkout, parent, members, deadline):
    """Bounded primitive; production callers obtain members only from fixed map."""
    total = validate_members(members)
    checkout, parent = Path(checkout), Path(parent)
    # Resolve nothing implicitly: aliases are rejected, not silently trusted.
    for root in (checkout, parent):
        fd = open_root(root); os.close(fd)
    for entry in members:
        if digest_file(checkout, entry['source'], MAX_MEMBER, deadline) != (entry['bytes'], entry['sha256']):
            raise ValueError('Historical source differs before materialization: '+entry['source'])
    check(deadline)
    parent_fd = open_root(parent)
    name = 'lrv-fixed-historical-'+uuid.uuid4().hex
    try:
        os.mkdir(name, mode=0o700, dir_fd=parent_fd)
        tree_fd = os.open(name, DIRECTORY_FLAGS, dir_fd=parent_fd)
    finally: os.close(parent_fd)
    tree = parent/name
    identity = (os.fstat(tree_fd).st_dev, os.fstat(tree_fd).st_ino)
    try:
        for entry in members:
            check(deadline)
            source_root = open_root(checkout)
            try: source_fd = open_member(source_root, entry['source'])
            finally: os.close(source_root)
            with os.fdopen(source_fd, 'rb') as inp:
              target_fd = open_member(tree_fd, entry['path'], create=True)
              with os.fdopen(target_fd, 'wb') as out:
                count, digest = 0, hashlib.sha256()
                while True:
                    check(deadline)
                    raw = inp.read(1024*1024)
                    if not raw: break
                    count += len(raw)
                    if count > entry['bytes']: raise ValueError('Source changed during copy')
                    out.write(raw); digest.update(raw)
                if (count, digest.hexdigest()) != (entry['bytes'], entry['sha256']):
                    raise ValueError('Copied historical bytes differ')
        verify_tree(tree, members, deadline, identity=identity)
        for entry in members:
            if digest_file(checkout, entry['source'], MAX_MEMBER, deadline) != (entry['bytes'], entry['sha256']):
                raise ValueError('Original source changed during materialization')
        check(deadline)
        return tree, {'members': len(members), 'bytes': total, 'verified': True, 'root_identity': list(identity)}
    except BaseException as error:
        error.add_note('Incomplete owned historical tree retained: '+str(tree))
        raise
    finally:
        os.close(tree_fd)


def verify_tree(tree, members, deadline, *, identity=None):
    validate_members(members)
    wanted = {entry['path']: entry for entry in members}
    observed = set()
    directories = {str(p) for n in wanted for p in PurePosixPath(n).parents if str(p) != '.'}
    observed_directories = set()
    root_fd = open_root(tree)
    try:
        current_identity = (os.fstat(root_fd).st_dev, os.fstat(root_fd).st_ino)
        if identity is not None and tuple(identity) != current_identity:
            raise ValueError('Owned materialized root identity changed')
        for path, dirs, files, directory_fd in os.fwalk('.', dir_fd=root_fd, follow_symlinks=False):
            check(deadline)
            prefix = '' if path == '.' else path[2:]+'/'
            for child in dirs:
                name = prefix+child
                if not stat.S_ISDIR(os.stat(child, dir_fd=directory_fd, follow_symlinks=False).st_mode):
                    raise ValueError('Nonregular materialized directory')
                if name not in directories: raise ValueError('Undeclared materialized directory')
                observed_directories.add(name)
            for child in files:
                name = prefix+child
                if not stat.S_ISREG(os.stat(child, dir_fd=directory_fd, follow_symlinks=False).st_mode):
                    raise ValueError('Nonregular materialized member')
                if name not in wanted: raise ValueError('Undeclared materialized member')
                observed.add(name); entry = wanted[name]
                if digest_fd(open_member(root_fd, name), MAX_MEMBER, deadline) != (entry['bytes'], entry['sha256']):
                    raise ValueError('Materialized bytes differ')
        after_fd = open_root(tree)
        try:
            if (os.fstat(after_fd).st_dev, os.fstat(after_fd).st_ino) != current_identity:
                raise ValueError('Owned materialized root identity changed')
        finally: os.close(after_fd)
    finally: os.close(root_fd)
    if observed != set(wanted): raise ValueError('Materialized member missing')
    if observed_directories != directories: raise ValueError('Materialized directory missing')
    check(deadline)


def materialize(checkout, parent, profile, *, deadline):
    """Only fixed stored638(+support) and A2 645+24 trees are admitted."""
    manifest = load_manifest(deadline)
    if profile not in EXPECTED_PROFILES: raise ValueError('Unknown historical profile')
    names = manifest['profiles'][profile]['paths']
    members = [manifest['files'][name] for name in names]
    tree, receipt = _copy_members(checkout, parent, members, deadline)
    receipt.update(profile=profile, manifest_sha256=MANIFEST_SHA,
                   collector_count=manifest['profiles'][profile]['collector_count'])
    return tree, receipt
