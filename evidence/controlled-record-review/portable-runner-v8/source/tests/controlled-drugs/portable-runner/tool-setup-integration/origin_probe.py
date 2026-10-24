"""Fixed setup-only import-origin proof. No SQL parse or target test imports."""
import hashlib
import types
import os
import stat
import json
from pathlib import Path
import sys
import time



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

def main():
    if len(sys.argv) != 9 or sys.argv[1::2] != ['--profile', '--profile-sha256', '--root', '--deadline']:
        raise ValueError('fixed origin probe command required')
    profile_path, expected, root, text_deadline = sys.argv[2::2]
    deadline = float(text_deadline)
    if not time.monotonic() < deadline <= time.monotonic()+120:
        raise ValueError('original bounded setup deadline required')
    admission = _load_admission(deadline)
    check = lambda: None
    profile, _ = admission.load_json(profile_path, expected, deadline=deadline, check=check)
    admission.require(profile['admission_sha256'] == ADMISSION_SHA, 'probe/profile admission source binding differs')
    admission.admit_profile(profile, deadline=deadline, check=check)
    expected_files = admission.installed_expected(profile, root)
    for prefix in ('environment', 'typescript'):
        local = {key[len(prefix)+1:]: value for key, value in expected_files.items() if key.startswith(prefix+'/')}
        admission.verify_exact_tree(root+'/'+prefix, local, deadline=deadline, check=check,
            empty_directories=('include',) if prefix == 'environment' else ())
    paths = admission.assert_runtime(profile, admission.tool_paths(profile, root), deadline=deadline, check=check)
    print(json.dumps({'kind': 'local-tool-origin-probe-v1', 'passed': True,
                      'paths': paths, 'python_version': '3.14.7', 'parser_version': '7.21',
                      'isolated': sys.flags.isolated, 'no_user_site': sys.flags.no_user_site,
                      'dont_write_bytecode': sys.dont_write_bytecode,
                      'optimize': sys.flags.optimize, 'sys_path': sys.path}, sort_keys=True))


if __name__ == '__main__':
    main()
