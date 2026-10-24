"""Finite no-child historical638/profile267 assertion worker; no live reseal.

The parent must admit this worker's bytes and the two physical roots before
launch. This worker independently verifies the fixed historical member tree.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import time
import types

MATERIALIZER = 'tests/controlled-drugs/harness/historical_tree.py'
MATERIALIZER_SHA = 'fa85e50910c3ed24e76c4a273707ee3ec0208a433970b17dbf431f52154483eb'
MAP = 'tests/controlled-drugs/fixtures/record-review-v3/history/maps/stored638.json'
MAP_SHA = '68987ef56aff1da537c8a3d7ff16eead831e602909d67502998951396d6b30dc'
EXPECTED_SHA = 'fec2ff871f064a124ae3a0fb5ba60e36b8b58dda1932393cd656c43cd68abd7d'
INSTALL_SHA = '22021a314fc196efa822a16ca30d25c7f9f6e70811703fe60eb747d92280d542'


def read_pinned(root, name, digest, deadline):
    """Small bootstrap reader: bounded regular leaf through physical ancestors."""
    if not root.is_absolute() or '..' in root.parts:
        raise ValueError('physical absolute repository root required')
    relative = Path(name)
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError('fixed relative member required')
    descriptors = []
    try:
        fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW); descriptors.append(fd)
        for part in (*root.parts[1:], *relative.parts[:-1]):
            if time.monotonic() >= deadline: raise TimeoutError('bootstrap read deadline')
            fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            descriptors.append(fd)
        leaf = os.open(relative.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        descriptors.append(leaf)
        before = os.fstat(leaf)
        if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= 1024**2:
            raise ValueError('bounded regular bootstrap input required')
        raw = bytearray()
        while len(raw) <= 1024**2:
            if time.monotonic() >= deadline: raise TimeoutError('bootstrap read deadline')
            chunk = os.read(leaf, min(65536, 1024**2 + 1 - len(raw)))
            if not chunk: break
            raw.extend(chunk)
        after = os.fstat(leaf)
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        if (identity(before) != identity(after)
                or identity(after) != identity(os.stat(relative.name, dir_fd=fd, follow_symlinks=False))
                or len(raw) != before.st_size or hashlib.sha256(raw).hexdigest() != digest):
            raise ValueError('fixed bootstrap bytes changed')
        if time.monotonic() >= deadline: raise TimeoutError('bootstrap read deadline')
        return bytes(raw)
    finally:
        for fd in reversed(descriptors): os.close(fd)


def run(repository_root, tree_root):
    if not __debug__ or sys.flags.optimize != 0:
        raise ValueError('assertions must be enabled')
    deadline = time.monotonic() + 60
    violations = []
    def guard(event, args):
        if (event.startswith('socket.') or event.startswith('subprocess.')
                or event in {'os.system', 'os.fork', 'os.forkpty', 'os.posix_spawn', 'os.exec', 'pty.spawn'}
                or event.startswith('os.spawn')):
            violations.append(event)
            raise RuntimeError('historical assertion forbids process/socket event: ' + event)
    sys.addaudithook(guard)
    raw = read_pinned(repository_root, MATERIALIZER, MATERIALIZER_SHA, deadline)
    h = types.ModuleType('fixed_historical_materializer')
    h.__file__ = str(repository_root / MATERIALIZER)
    exec(compile(raw, h.__file__, 'exec'), h.__dict__)
    manifest = h.load_manifest(deadline)
    entries = [manifest['files'][name] for name in manifest['profiles']['stored638']['paths']]
    h.verify_tree(tree_root, entries, deadline)
    expected = json.loads(read_pinned(repository_root, MAP, MAP_SHA, deadline), object_pairs_hook=h.unique)
    if len(expected) != 638: raise ValueError('fixed complete638 map required')
    source = tree_root / 'tests/controlled-drugs/engine/candidate'
    # A fresh interpreter must not inherit project modules from another tree.
    project_modules = {Path(name).stem for name in expected
                       if name.startswith('tests/controlled-drugs/engine/candidate/') and name.endswith('.py')}
    for name in project_modules:
        if name in sys.modules: raise ValueError('project module already loaded before historical assertion')
    sys.path.insert(0, str(source))
    import record_review_v3_gate_a_runtime as owned
    import record_review_v3_configuration_record_runtime as runtime
    import record_review_v3_configuration_record_profile as profile
    runtime.canonical_location()
    package = profile.build()
    h.check(deadline)
    runtime.admit_package(package)
    current = runtime.integration_gate(owned, deadline)
    if current != expected: raise ValueError('complete independently pinned638 map differs')
    if len(package['input_source_hashes']) != 267:
        raise ValueError('exact267 profile closure required')
    if any(current.get(name) != digest for name, digest in package['input_source_hashes'].items()):
        raise ValueError('profile input differs from admitted historical tree')
    if package['expected_sha256'] != EXPECTED_SHA or package['install_sha256'] != INSTALL_SHA:
        raise ValueError('independent expected/install pin differs')
    for name in project_modules:
        module = sys.modules.get(name)
        if module is not None:
            path = getattr(module, '__file__', None)
            if path is None or Path(path) != source / (name + '.py'):
                raise ValueError('historical import origin differs')
    if (tree_root / 'tmp/secondary-review-20261021/configuration-record-fixture-draft').exists():
        raise ValueError('private fixture authority must not exist in historical assertion tree')
    h.verify_tree(tree_root, entries, deadline)
    if violations: raise ValueError('denied event was swallowed')
    h.check(deadline)
    return dict(kind='historical638-profile267-assertion-v1', source_count=638,
                profile_inputs=267, baseline_count=634, source_map_sha256=MAP_SHA,
                expected_sha256=EXPECTED_SHA, install_sha256=INSTALL_SHA,
                historical_gate_passed=True, legacy_full761_admission=False, database_commands=0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository-root', required=True, type=Path)
    parser.add_argument('--tree-root', required=True, type=Path)
    args = parser.parse_args()
    result = run(args.repository_root, args.tree_root)
    print(json.dumps(result, sort_keys=True, allow_nan=False))


if __name__ == '__main__': main()
