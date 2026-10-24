"""Prospective fixed local tool provisioning, invoked only after source review.

No downloads, database, target tests or generic command interface. Standard pip
installs the one offline reviewed wheel; the TypeScript artifact is copied from
its exact independently reviewed finite archive inventory without running it.
"""
import hashlib
import types
import io
import json
import os
from pathlib import Path
import selectors
import signal
import stat
import struct
import subprocess
import tarfile
import time
import zipfile


ADMISSION_SHA = 'bb8305d945dd7e6f264e4946469c8caa90cb570360897b9f4a8d61917d05104b'


def _load_admission(deadline):
    """Execute only independently pinned raw helper bytes, after every close."""
    path = Path(__file__).absolute().with_name('tool_admission.py')
    if not path.is_absolute() or '..' in path.parts:
        raise ImportError('physical tool admission source path required')
    descriptors = []; edges = []; primary = None
    def check():
        if not time.monotonic() < deadline:
            raise TimeoutError('original source bootstrap deadline exhausted')
    def identity(info):
        return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_nlink,
                info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    try:
        check(); descriptors.append(os.open('/', os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW))
        for part in path.parts[1:-1]:
            check(); parent = descriptors[-1]
            fd = os.open(part, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW, dir_fd=parent)
            descriptors.append(fd); edges.append((parent, part, fd, identity(os.fstat(fd))[:4]))
        fd = os.open(path.name, os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK, dir_fd=descriptors[-1])
        descriptors.append(fd); before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid() or before.st_nlink != 1 or before.st_mode & 0o022 or not 0 < before.st_size <= 128*1024:
            raise ImportError('bounded physical tool admission source required')
        blocks = []; count = 0
        while True:
            check(); raw = os.read(fd, min(65536, before.st_size+1-count))
            if not raw: break
            count += len(raw)
            if count > before.st_size: raise ImportError('tool admission source grew')
            blocks.append(raw)
        source = b''.join(blocks)
        if count != before.st_size or identity(before) != identity(os.fstat(fd)) or identity(before) != identity(os.stat(path.name, dir_fd=descriptors[-2], follow_symlinks=False)):
            raise ImportError('tool admission source changed')
        for parent, part, child, observed in edges:
            check()
            if identity(os.fstat(child))[:4] != observed or identity(os.stat(part, dir_fd=parent, follow_symlinks=False))[:4] != observed:
                raise ImportError('tool admission source ancestor changed')
        if hashlib.sha256(source).hexdigest() != ADMISSION_SHA:
            raise ImportError('tool admission source hash differs before execution')
    except BaseException as error:
        primary = error; raise
    finally:
        closing = None
        for fd in reversed(descriptors):
            try: os.close(fd)
            except BaseException as error:
                if primary is not None: primary.add_note('tool bootstrap close also failed: '+type(error).__name__)
                elif closing is None: closing = error
        if closing is not None: raise closing
    check()
    module = types.ModuleType(__name__+'_verified_admission')
    module.__file__ = str(path)
    exec(compile(source, str(path), 'exec'), module.__dict__)
    check(); return module

HERE = Path(__file__).absolute().parent
a = _load_admission(time.monotonic()+120)
LOG_CAP = 4*1024*1024


def _create_root(parent, check):
    """Admit the caller's owned0700 physical parent before even mkdir."""
    parent = a.physical_path(parent); descriptors = []; edges = []; primary = None
    try:
        check(); descriptors.append(os.open('/', os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW))
        for part in parent.parts[1:]:
            check(); owner = descriptors[-1]
            fd = os.open(part, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW, dir_fd=owner)
            descriptors.append(fd); edges.append((owner, part, fd, a.stamp(os.fstat(fd))[:4]))
        info = os.fstat(descriptors[-1])
        a.require(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o700, 'owned private physical setup parent required')
        for owner, part, fd, identity in edges:
            a.require(a.stamp(os.fstat(fd))[:4] == a.stamp(os.stat(part, dir_fd=owner, follow_symlinks=False))[:4] == identity,
                      'setup parent ancestor changed before mkdir')
        check(); os.mkdir('local-portable-tools', 0o700, dir_fd=descriptors[-1]); check()
        for owner, part, fd, identity in edges:
            a.require(a.stamp(os.fstat(fd))[:4] == a.stamp(os.stat(part, dir_fd=owner, follow_symlinks=False))[:4] == identity,
                      'setup parent ancestor changed during mkdir')
    except BaseException as error:
        primary = error; raise
    finally:
        first = None
        for fd in reversed(descriptors):
            try: os.close(fd)
            except BaseException as error:
                if primary is not None: primary.add_note('setup parent close also failed: '+type(error).__name__)
                elif first is None: first = error
        if first is not None: raise first
    check(); return parent/'local-portable-tools'


def _exclusive(path, raw, mode=0o600, *, check):
    path = a.physical_path(str(path)); check()
    fds = []; edges = []; primary = None
    try:
        fds.append(os.open('/', os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW))
        for part in path.parts[1:-1]:
            check(); parent = fds[-1]
            descriptor = os.open(part, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW, dir_fd=parent)
            fds.append(descriptor); edges.append((parent, part, descriptor, a.stamp(os.fstat(descriptor))[:4]))
        fd = os.open(path.name, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_NONBLOCK, mode, dir_fd=fds[-1])
        fds.append(fd); initial = os.fstat(fd)
        offset = 0
        while offset < len(raw):
            check()
            count = os.write(fd, raw[offset:offset+65536])
            a.require(0 < count <= min(65536, len(raw)-offset), 'invalid setup write progress')
            offset += count
        os.fsync(fd)
        check()
        actual = os.fstat(fd); named = os.stat(path.name, dir_fd=fds[-2], follow_symlinks=False)
        a.require(stat.S_ISREG(actual.st_mode) and actual.st_nlink == 1 and actual.st_uid == os.getuid()
            and (actual.st_dev, actual.st_ino, actual.st_size) == (initial.st_dev, initial.st_ino, len(raw))
            and a.stamp(actual) == a.stamp(named), 'setup file identity changed')
        for parent, part, descriptor, identity in edges:
            check(); a.require(a.stamp(os.stat(part, dir_fd=parent, follow_symlinks=False))[:4]
                == a.stamp(os.fstat(descriptor))[:4] == identity, 'setup write ancestor changed')
    except BaseException as error:
        primary = error; raise
    finally:
        first = None
        for fd in reversed(fds):
            try: os.close(fd)
            except BaseException as error:
                if primary is not None: primary.add_note('setup file close also failed: '+type(error).__name__)
                elif first is None: first = error
        if first is not None: raise first
    check()


def _member(name):
    a.require(type(name) is str and 0 < len(name.encode('utf-8', 'strict')) <= 4096
        and not name.startswith('/') and '\\' not in name and len(name.split('/')) <= 64
        and all(part not in ('', '.', '..') for part in name.split('/'))
        and not any(ord(c) < 32 or ord(c) == 127 for c in name), 'literal archive member required')


def verify_wheel(raw, authority, *, deadline, check):
    a.require(len(raw) == authority['inventory']['archive']['bytes'] <= 8*1024*1024
        and a.digest(raw) == authority['inventory']['archive']['sha256'], 'fixed wheel archive differs')
    expected = authority['inventory']; result = {}; directories = []; folded = set(); total = 0
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        a.require(len(archive.infolist()) <= 1024, 'wheel member cap')
        for item in archive.infolist():
            a.checked(deadline, check)
            name = item.filename[:-1] if item.is_dir() else item.filename; _member(name)
            a.require(name.casefold() not in folded, 'wheel key collision'); folded.add(name.casefold())
            mode = item.external_attr >> 16
            a.require(not item.flag_bits & 1 and item.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                and stat.S_IFMT(mode) in (0, stat.S_IFDIR if item.is_dir() else stat.S_IFREG), 'unsupported wheel member')
            if item.is_dir():
                directories.append(name); continue
            a.require(item.file_size <= 64*1024*1024, 'wheel member byte cap')
            total += item.file_size; a.require(total <= 128*1024*1024, 'wheel expanded cap')
            payload = archive.read(item)
            a.require(name in expected['files'] and {'bytes': len(payload), 'sha256': a.digest(payload)} == expected['files'][name], 'wheel payload differs')
            result[name] = payload
    a.require(set(result) == set(expected['files']) and total == expected['expanded_bytes'], 'wheel complete keyset differs')
    # The pinned macOS wheel has only package/dist-info directories (implicit ZIP
    # directory entries are optional); map authority fixes their complete set.
    derived_dirs = {str(parent) for key in result for parent in Path(key).parents if str(parent) != '.'}
    a.require(derived_dirs == set(expected['directories']) and set(directories) <= derived_dirs, 'wheel directory map differs')
    native = result['pglast/parser.cpython-314-darwin.so']
    magic, cpu, _, kind, count, command_bytes, _, _ = struct.unpack_from('<8I', native)
    a.require(magic == 0xfeedfacf and cpu == 0x100000c and kind == 8 and count <= 128
        and 32+command_bytes <= len(native), 'expected arm64 Mach-O extension required')
    offset = 32; libraries = []
    for _ in range(count):
        command, length = struct.unpack_from('<II', native, offset)
        a.require(length >= 8 and offset+length <= 32+command_bytes, 'native load command bounds')
        if command in (0xc, 0x80000018, 0x8000001f, 0x20, 0x80000023):
            start = struct.unpack_from('<I', native, offset+8)[0]
            a.require(12 <= start < length, 'native library name bounds')
            libraries.append(native[offset+start:offset+length].split(b'\0', 1)[0].decode('ascii', 'strict'))
        a.require(command != 0x8000001c, 'unexpected native RPATH')
        offset += length
    a.require(offset == 32+command_bytes and libraries == ['/usr/lib/libSystem.B.dylib'], 'native loader dependencies differ')
    return result


def verify_typescript(raw, authority, *, deadline, check):
    expected = authority['inventory']
    a.require(len(raw) == expected['archive']['bytes'] <= 8*1024*1024
        and a.digest(raw) == expected['archive']['sha256'], 'fixed TypeScript archive differs')
    result = {}; total = 0; folded = set()
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        for item in archive:
            a.checked(deadline, check)
            _member(item.name)
            a.require(item.isfile() and item.name.casefold() not in folded and len(result) < 1024
                and item.size <= 64*1024*1024, 'fixed regular TypeScript members required')
            folded.add(item.name.casefold()); total += item.size
            a.require(total <= 128*1024*1024 and item.name in expected['files'], 'TypeScript expanded/key cap')
            file = archive.extractfile(item); a.require(file is not None, 'TypeScript payload required')
            payload = file.read(item.size+1)
            a.require({'bytes': len(payload), 'sha256': a.digest(payload)} == expected['files'][item.name], 'TypeScript payload differs')
            result[item.name] = payload
    a.require(set(result) == set(expected['files']) and total == expected['expanded_bytes'], 'TypeScript complete keyset differs')
    a.require(a.digest(result['package/lib/typescript.js']) == 'dd17428736a07e1db1a138d8a14295ddb2699ba780ee15038acdd2c6da5373a0'
        and json.loads(result['package/package.json'])['version'] == '5.8.3', 'TypeScript declared version/source differs')
    return result


def _environment(root):
    return {'PATH': '/usr/bin:/bin', 'HOME': str(root/'home'), 'TMPDIR': str(root/'tmp'),
            'LANG': 'en_US.UTF-8', 'LC_ALL': 'en_US.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1',
            'PYTHONNOUSERSITE': '1', 'PYTHONHASHSEED': '0', 'PIP_CONFIG_FILE': '/dev/null',
            '__CF_USER_TEXT_ENCODING': f'0x{os.getuid():X}:0x0:0x0'}


class Setup:
    def __init__(self, root, profile, *, deadline, check):
        self.root = root; self.profile = profile; self.deadline = deadline; self.parent_check = check
        self.failed = False; self.commands = []
        self.last_scan = 0
        self.root_identity = a.stamp(os.lstat(root))[:4]
        self.evidence_identity = None

    def check(self):
        a.require(not self.failed, 'failed setup cannot continue')
        a.checked(self.deadline, self.parent_check)
        a.require(a.stamp(os.lstat(self.root))[:4] == self.root_identity, 'owned setup root changed')
        if self.evidence_identity is not None:
            a.require(a.stamp(os.lstat(self.root/'evidence'))[:4] == self.evidence_identity, 'owned setup evidence directory changed')
        a.require(os.statvfs(self.root).f_bavail*os.statvfs(self.root).f_frsize >= 4*1024**3 + 128*1024**2,
                  'setup physical free-space floor')
        if time.monotonic()-self.last_scan >= 0.5:
            a.tree_keys(self.root, deadline=self.deadline, check=self.parent_check)
            self.last_scan = time.monotonic()

    def command(self, label, argv):
        try:
            a.require(not self.failed and len(self.commands) < 8, 'fixed setup command cap')
            self.check(); a.admit_profile(self.profile, deadline=self.deadline, check=self.check)
        except BaseException:
            self.failed = True
            raise
        started = time.monotonic(); cutoff = min(self.deadline, started+120)
        paths = {name: self.root/'evidence'/f'{len(self.commands)+1:02d}-{label}.{name}.log' for name in ('stdout', 'stderr')}
        fds = {}; log_inodes = {}; evidence_fd = None; proc = None; selector = selectors.DefaultSelector(); primary = None
        counts = {'stdout': 0, 'stderr': 0}; hashes = {name: hashlib.sha256() for name in counts}
        probe_source = None
        try:
            if label == 'origin':
                raw, probe_source = a.read_file(argv[3], deadline=cutoff, check=self.check, limit=128*1024)
                a.require(a.digest(raw) == self.profile['probe_sha256'], 'fixed origin source changed before launch')
            evidence_fd = os.open(self.root/'evidence', os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            evidence_info = os.fstat(evidence_fd)
            a.require(evidence_info.st_uid == os.getuid() and stat.S_IMODE(evidence_info.st_mode) == 0o700, 'owned setup log directory required')
            if self.evidence_identity is None:
                self.evidence_identity = a.stamp(evidence_info)[:4]
            a.require(a.stamp(evidence_info)[:4] == self.evidence_identity
                == a.stamp(os.lstat(self.root/'evidence'))[:4], 'setup log directory changed before creation')
            for name, path in paths.items():
                fds[name] = os.open(path.name, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600, dir_fd=evidence_fd)
                log_inodes[name] = a.stamp(os.fstat(fds[name]))[:2]
            proc = subprocess.Popen(tuple(argv), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                cwd=self.root, env=_environment(self.root), close_fds=True, start_new_session=True, bufsize=0, umask=0o022)
            for name, pipe in (('stdout', proc.stdout), ('stderr', proc.stderr)):
                os.set_blocking(pipe.fileno(), False); selector.register(pipe, selectors.EVENT_READ, name)
            while selector.get_map():
                self.check(); a.require(time.monotonic() < cutoff, 'original setup command deadline expired')
                for key, _ in selector.select(min(0.05, max(0, cutoff-time.monotonic()))):
                    raw = os.read(key.fileobj.fileno(), 65536)
                    if not raw:
                        selector.unregister(key.fileobj); key.fileobj.close(); continue
                    name = key.data
                    a.require(counts[name]+len(raw) <= LOG_CAP, 'setup stream cap exceeded')
                    counts[name] += len(raw); hashes[name].update(raw)
                    view = memoryview(raw)
                    while view:
                        written = os.write(fds[name], view); a.require(written > 0, 'setup log short write'); view = view[written:]
            proc.wait(timeout=max(0.001, cutoff-time.monotonic()))
            a.require(type(proc.returncode) is int and proc.returncode == 0, 'setup command exited nonzero')
            for fd in fds.values():
                os.fsync(fd)
            self.check(); a.require(time.monotonic() < cutoff, 'original setup command deadline expired')
            value = {'label': label, 'argv': list(argv), 'started': started, 'deadline': cutoff,
                'finished': time.monotonic(), 'returncode': proc.returncode, 'worker_reaped': True, 'stream_bytes': dict(counts),
                'stream_sha256': {name: value.hexdigest() for name, value in hashes.items()},
                'descendant_cleanup_verified': False}
        except BaseException as error:
            primary = error; self.failed = True
            if proc is not None and proc.poll() is None:
                try:
                    os.killpg(proc.pid, signal.SIGKILL); proc.wait(timeout=5)
                except BaseException as closing:
                    error.add_note('owned setup process cleanup also failed: '+type(closing).__name__)
            raise
        finally:
            selector.close(); first = None
            for pipe in (() if proc is None else (proc.stdout, proc.stderr)):
                try:
                    if pipe is not None and not pipe.closed:
                        pipe.close()
                except BaseException as error:
                    first = first or error
            for fd in fds.values():
                try:
                    os.close(fd)
                except BaseException as error:
                    first = first or error
            if evidence_fd is not None:
                try: os.close(evidence_fd)
                except BaseException as error: first = first or error
            if first is not None:
                self.failed = True
                if primary is not None:
                    primary.add_note('setup descriptor close also failed: '+type(first).__name__)
                else:
                    raise first
            if primary is None:
                try:
                    self.check(); a.require(time.monotonic() < cutoff, 'setup close exceeded original command deadline')
                except BaseException:
                    self.failed = True
                    raise
        try:
            value['log_identity'] = {}
            for name, path in paths.items():
                raw, identity = a.read_file(path, deadline=cutoff, check=self.check, limit=LOG_CAP)
                a.require(identity[:2] == log_inodes[name] and stat.S_IMODE(identity[2]) == 0o600
                    and len(raw) == counts[name] and a.digest(raw) == hashes[name].hexdigest(), 'physically saved setup log differs')
                value['log_identity'][name] = list(identity)
            self.check(); a.checked(cutoff, self.check)
            if probe_source is not None:
                raw, identity = a.read_file(argv[3], deadline=cutoff, check=self.check, limit=128*1024)
                a.require(identity == probe_source and a.digest(raw) == self.profile['probe_sha256'], 'fixed origin source changed during command')
            value['finished'] = time.monotonic()
            self.commands.append(value)
            return paths
        except BaseException:
            self.failed = True
            raise


def provision(profile_path, profile_sha256, archive_parent, output_parent, *, check):
    """Fixed four-command local setup. Call only after independent source review."""
    deadline = time.monotonic()+600
    profile, _ = a.load_json(profile_path, profile_sha256, deadline=deadline, check=check)
    a.admit_profile(profile, deadline=deadline, check=check)
    admission_raw, _ = a.read_file(HERE/'tool_admission.py', deadline=deadline, check=check, limit=128*1024)
    probe_raw, _ = a.read_file(HERE/'origin_probe.py', deadline=deadline, check=check, limit=128*1024)
    a.require(a.digest(admission_raw) == profile['admission_sha256'] == ADMISSION_SHA
        and a.digest(probe_raw) == profile['probe_sha256'], 'setup source differs')
    parent = a.physical_path(output_parent)
    root = parent/'local-portable-tools'
    expected = a.installed_expected(profile, str(root))  # Freeze derivation before any installation.
    root = _create_root(str(parent), lambda: a.checked(deadline, check))
    owner = Setup(root, profile, deadline=deadline, check=check)
    try:
        for name in ('home', 'tmp', 'evidence', 'wheelhouse', 'typescript'):
            (root/name).mkdir(mode=0o700)
        profile_raw, _ = a.read_file(profile_path, deadline=deadline, check=owner.check, limit=a.MAX_JSON)
        a.require(a.digest(profile_raw) == profile_sha256, 'profile changed before copy')
        _exclusive(root/'profile.json', profile_raw, check=owner.check)
        archive_parent = a.physical_path(archive_parent)
        wheel_name = profile['wheel']['inventory']['filename']
        wheel_raw, _ = a.read_file(archive_parent/wheel_name, deadline=deadline, check=owner.check, limit=8*1024*1024)
        verify_wheel(wheel_raw, profile['wheel'], deadline=deadline, check=owner.check)
        ts_name = profile['typescript']['inventory']['filename']
        ts_raw, _ = a.read_file(archive_parent/ts_name, deadline=deadline, check=owner.check, limit=8*1024*1024)
        ts_files = verify_typescript(ts_raw, profile['typescript'], deadline=deadline, check=owner.check)
        _exclusive(root/'wheelhouse'/wheel_name, wheel_raw, check=owner.check)
        requirements = ('pglast==7.21 --hash=sha256:'+profile['wheel']['inventory']['archive']['sha256']+'\n').encode()
        _exclusive(root/'requirements.txt', requirements, check=owner.check)
        for key, raw in ts_files.items():
            destination = root/'typescript'/key
            destination.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            _exclusive(destination, raw, mode=0o644, check=owner.check)
        environment = str(root/'environment'); python = environment+'/bin/python3'
        owner.command('venv', (profile['python']['path'], '-I', '-B', '-m', 'venv', '--copies', '--without-pip', environment))
        a.verify_exact_tree(environment, a.venv_expected(profile, environment), deadline=deadline, check=owner.check,
            empty_directories=('include', 'lib', 'lib/python3.14', 'lib/python3.14/site-packages'))
        owner.command('pip', (profile['python']['path'], '-I', '-B', '-m', 'pip', '--python', python,
            '--isolated', '--disable-pip-version-check', '--no-input', '--keyring-provider', 'disabled',
            'install', '--no-index', '--find-links', str(root/'wheelhouse'), '--require-hashes', '--only-binary=:all:',
            '--no-deps', '--no-compile', '--no-cache-dir', '-r', str(root/'requirements.txt')))
        observed = {}; directories = {}
        for prefix in ('environment', 'typescript'):
            local = {key[len(prefix)+1:]: value for key, value in expected.items() if key.startswith(prefix+'/')}
            observed.update({prefix+'/'+key: list(value) for key, value in a.verify_exact_tree(str(root/prefix), local,
                deadline=deadline, check=owner.check, empty_directories=('include',) if prefix == 'environment' else ()).items()})
            directories.update({prefix+('/'+key if key else ''): list(value) for key, value in a.tree_keys(str(root/prefix), deadline=deadline, check=owner.check).items() if len(value) == 4})
        cutoff = min(deadline, time.monotonic()+120)
        paths = owner.command('origin', (python, '-I', '-B', str(HERE/'origin_probe.py'), '--profile', str(root/'profile.json'),
            '--profile-sha256', profile_sha256, '--root', str(root), '--deadline', str(cutoff)))
        probe_raw, _ = a.read_file(paths['stdout'], deadline=deadline, check=owner.check, limit=1024*1024)
        probe = a.strict_json(probe_raw)
        a.require(probe['kind'] == 'local-tool-origin-probe-v1' and probe['passed'] is True
            and probe['paths'] == a.tool_paths(profile, str(root)), 'actual origin probe failed')
        owner.command('node', (profile['node']['path'], '--version'))
        owner.check()
        receipt = {'kind': 'local-portable-tools-receipt-v1', 'profile_sha256': profile_sha256, 'root': str(root),
            'expected_layout_sha256': a.digest(a.canonical(expected)), 'observed': observed,
            'root_identity': list(owner.root_identity), 'directories': directories,
            'commands': owner.commands, 'probe': probe, 'local_only': True, 'ci_acceptance': False, 'target_acceptance': False}
        receipt_raw = a.canonical(receipt)+b'\n'; _exclusive(root/'receipt.json', receipt_raw, check=owner.check)
        binding = {'profile_path': str(root/'profile.json'), 'profile_sha256': profile_sha256,
                   'receipt_path': str(root/'receipt.json'), 'receipt_sha256': a.digest(receipt_raw)}
        a.admit_tools(binding, deadline=deadline, check=owner.check)
        owner.check()
        return binding
    except BaseException:
        owner.failed = True
        raise
