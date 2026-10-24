"""Finite local tool admission. Profile authority is supplied by the fixed parent.

Installed observations never become expected package/source hashes. Linux/CI is
deliberately unsupported here until its separate provisioning profile is proved.
"""
import base64
import ast
import csv
import hashlib
import importlib
import importlib.metadata
import io
import json
import math
import os
import platform
import re
from pathlib import Path
import shlex
import stat
import sys
import time
import textwrap

MAX_JSON = 2 * 1024 * 1024
MAX_FILE = 64 * 1024 * 1024
MAX_FILES = 2048
MAX_BYTES = 1024 * 1024 * 1024
BINDING_KEYS = {'profile_path', 'profile_sha256', 'receipt_path', 'receipt_sha256'}
PROFILE_KEYS = {'kind', 'platform', 'trust', 'python', 'node', 'pip', 'venv_sources',
                'wheel', 'typescript', 'startup', 'probe_sha256', 'admission_sha256'}
RECEIPT_KEYS = {'kind', 'profile_sha256', 'root', 'expected_layout_sha256', 'observed',
                'root_identity', 'directories', 'commands', 'probe', 'local_only', 'ci_acceptance', 'target_acceptance'}


def require(value, message):
    if not value:
        raise ValueError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False,
                      separators=(',', ':')).encode('utf-8', 'strict')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def checked(deadline, check):
    require(type(deadline) in (int, float) and math.isfinite(deadline), 'finite tool deadline required')
    require(time.monotonic() < deadline, 'original tool deadline expired')
    check()
    require(time.monotonic() < deadline, 'original tool deadline expired')


def physical_path(path):
    require(type(path) is str and path.startswith('/') and not path.startswith('//')
            and '\0' not in path and path == str(Path(path)) and '..' not in Path(path).parts,
            'normalized absolute physical path required')
    return Path(path)


def stamp(value):
    return (value.st_dev, value.st_ino, value.st_mode, value.st_uid, value.st_nlink,
            value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def read_file(path, *, deadline, check, limit=MAX_FILE):
    """Hold/check all physical ancestors and a single-link leaf while reading."""
    path = physical_path(str(path))
    fds = []; edges = []; primary = None
    try:
        checked(deadline, check)
        fds.append(os.open('/', os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW))
        for part in path.parts[1:-1]:
            checked(deadline, check)
            parent = fds[-1]
            fd = os.open(part, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW, dir_fd=parent)
            fds.append(fd); edges.append((parent, part, fd, stamp(os.fstat(fd))[:4]))
        fd = os.open(path.name, os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK, dir_fd=fds[-1])
        fds.append(fd); initial = os.fstat(fd)
        require(stat.S_ISREG(initial.st_mode) and initial.st_nlink == 1 and initial.st_uid == os.getuid()
                and stat.S_IMODE(initial.st_mode) & 0o022 == 0 and 0 <= initial.st_size <= limit,
                'bounded owned non-group/world-writable single-link file required')
        chunks = []; count = 0
        while True:
            checked(deadline, check)
            raw = os.read(fd, min(65536, initial.st_size + 1 - count))
            if not raw:
                break
            chunks.append(raw); count += len(raw)
            require(count <= initial.st_size, 'tool file grew')
        require(count == initial.st_size and stamp(initial) == stamp(os.fstat(fd))
                == stamp(os.stat(path.name, dir_fd=fds[-2], follow_symlinks=False)), 'tool file changed')
        for parent, part, child, identity in edges:
            checked(deadline, check)
            require(stamp(os.stat(part, dir_fd=parent, follow_symlinks=False))[:4]
                    == stamp(os.fstat(child))[:4] == identity, 'tool ancestor changed')
        checked(deadline, check)
        return b''.join(chunks), stamp(initial)
    except BaseException as error:
        primary = error
        raise
    finally:
        first = None
        for fd in reversed(fds):
            try:
                os.close(fd)
            except BaseException as error:
                if primary is not None:
                    primary.add_note('tool file close also failed: '+type(error).__name__)
                elif first is None:
                    first = error
        if first is not None:
            raise first
        if primary is None:
            checked(deadline, check)


def strict_json(raw):
    require(type(raw) is bytes and 0 < len(raw) <= MAX_JSON, 'bounded tool JSON required')
    def pairs(values):
        result = {}
        for key, value in values:
            require(key not in result, 'duplicate tool JSON key')
            result[key] = value
        return result
    def reject(_):
        raise ValueError('nonfinite tool JSON')
    def number(text):
        value = float(text); require(math.isfinite(value), 'nonfinite tool JSON number'); return value
    return json.loads(raw.decode('utf-8', 'strict'), object_pairs_hook=pairs, parse_constant=reject, parse_float=number)


def load_json(path, expected_sha256, *, deadline, check):
    raw, identity = read_file(path, deadline=deadline, check=check, limit=MAX_JSON)
    require(digest(raw) == expected_sha256, 'independently admitted tool JSON hash differs')
    return strict_json(raw), identity


def metadata(raw, mode=0o644):
    return {'bytes': len(raw), 'sha256': digest(raw), 'mode': mode}


def check_file(path, expected, *, deadline, check, limit=MAX_FILE):
    raw, identity = read_file(path, deadline=deadline, check=check, limit=limit)
    require(len(raw) == expected['bytes'] and digest(raw) == expected['sha256'], 'tool bytes differ')
    if 'mode' in expected:
        require(stat.S_IMODE(identity[2]) == expected['mode'], 'tool mode differs')
    return identity


def tree_keys(root, *, deadline, check):
    root = physical_path(str(root)); identities = {}; total = 0
    def walk(directory, relative):
        nonlocal total
        checked(deadline, check)
        initial = os.lstat(directory)
        require(stat.S_ISDIR(initial.st_mode) and initial.st_uid == os.getuid()
                and stat.S_IMODE(initial.st_mode) & 0o022 == 0, 'owned physical tool directory required')
        identities[relative] = stamp(initial)[:4]
        with os.scandir(directory) as entries:
            children = sorted(entries, key=lambda value: value.name)
        for child in children:
            checked(deadline, check)
            key = relative+'/'+child.name if relative else child.name
            require(len(identities) < MAX_FILES and len(key.encode('utf-8')) <= 4096, 'finite tool tree required')
            info = child.stat(follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                walk(Path(directory)/child.name, key)
            else:
                require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'no tool links or special files')
                total += info.st_size
                require(total <= MAX_BYTES, 'tool payload cap exceeded')
                identities[key] = stamp(info)
        require(stamp(os.lstat(directory))[:4] == stamp(initial)[:4], 'tool tree directory changed')
    walk(root, '')
    checked(deadline, check)
    return identities


def verify_exact_tree(root, expected, *, deadline, check, empty_directories=()):
    """expected is a fixed map; it is never constructed from observed install bytes."""
    require(type(expected) is dict and 0 < len(expected) <= MAX_FILES, 'fixed expected tool map required')
    expected_dirs = {''} | set(empty_directories)
    for key in expected:
        require(type(key) is str and key and not key.startswith('/') and '\\' not in key
                and all(part not in ('', '.', '..') for part in key.split('/')), 'literal tool member required')
        for parent in Path(key).parents:
            expected_dirs.add('' if str(parent) == '.' else parent.as_posix())
    before = tree_keys(root, deadline=deadline, check=check)
    require(set(before) == set(expected) | expected_dirs, 'tool tree keyset differs')
    observations = {}
    for key, value in expected.items():
        observations[key] = check_file(Path(root)/key, value, deadline=deadline, check=check)
        require(observations[key] == before[key], 'tool leaf replaced during admission')
    after = tree_keys(root, deadline=deadline, check=check)
    require(before == after, 'tool tree changed during admission')
    return observations


def verify_provisioning_pip(profile, *, deadline, check):
    """Only the fixed pre-existing Homebrew provisioner permits declared links.

    Every mapped leaf must point to the same relative name under this exact
    Cellar release. Worker/installed package admission never uses this exception.
    """
    pip = profile['pip']; root = physical_path(pip['parent'])
    physical_parent = '/opt/homebrew/Cellar/python@3.14/3.14.7/lib/python3.14/site-packages'
    observed = {}; directories = {}
    for top in ('pip', 'pip-26.2.1.dist-info'):
        for directory, children, files in os.walk(root/top, followlinks=False):
            checked(deadline, check)
            info = os.lstat(directory)
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o022,
                    'physical owned provisioning pip directory required')
            directories[directory] = stamp(info)[:4]
            for name in files:
                key = (Path(directory)/name).relative_to(root).as_posix()
                require(key in pip['files'] and len(observed) < MAX_FILES, 'unexpected provisioner member')
                path = root/key; value = pip['files'][key]; before = os.lstat(path)
                if 'link' in value:
                    require(stat.S_ISLNK(before.st_mode) and before.st_uid == os.getuid()
                        and os.readlink(path) == value['link'] and value['target'] == physical_parent+'/'+key,
                        'fixed provisioning link differs')
                    check_file(value['target'], value, deadline=deadline, check=check)
                    require(stamp(before) == stamp(os.lstat(path)) and os.readlink(path) == value['link'],
                            'provisioning link changed')
                else:
                    check_file(path, value, deadline=deadline, check=check)
                observed[key] = stamp(before)
            for name in children:
                require(not stat.S_ISLNK(os.lstat(Path(directory)/name).st_mode), 'no provisioning directory links')
    require(set(observed) == set(pip['files']), 'provisioner complete keyset differs')
    for directory, identity in directories.items():
        require(stamp(os.lstat(directory))[:4] == identity, 'provisioner directory changed')
    for key, identity in observed.items():
        require(stamp(os.lstat(root/key)) == identity, 'provisioner leaf changed during closure admission')
    checked(deadline, check)


def pip_script_template(pip_raw, distlib_raw):
    """Select the active pinned installer override, not distlib's base template."""
    pip_tree = ast.parse(pip_raw.decode('utf-8', 'strict'))
    classes = [node for node in pip_tree.body if isinstance(node, ast.ClassDef) and node.name == 'PipScriptMaker']
    require(len(classes) == 1 and len(classes[0].bases) == 1 and isinstance(classes[0].bases[0], ast.Name)
        and classes[0].bases[0].id == 'ScriptMaker', 'fixed active pip script-maker class required')
    assignments = [node for node in classes[0].body if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == 'script_template' for target in node.targets)]
    require(len(assignments) == 1, 'fixed active pip script template required')
    expression = assignments[0].value
    require(isinstance(expression, ast.Call) and isinstance(expression.func, ast.Attribute)
        and isinstance(expression.func.value, ast.Name) and expression.func.value.id == 'textwrap'
        and expression.func.attr == 'dedent' and len(expression.args) == 1 and not expression.keywords
        and isinstance(expression.args[0], ast.Constant) and type(expression.args[0].value) is str,
        'literal textwrap.dedent pip script template required')
    install = [node for node in pip_tree.body if isinstance(node, ast.FunctionDef) and node.name == '_install_wheel']
    require(len(install) == 1 and any(isinstance(node, ast.Assign) and isinstance(node.value, ast.Call)
        and isinstance(node.value.func, ast.Name) and node.value.func.id == 'PipScriptMaker'
        and any(isinstance(target, ast.Name) and target.id == 'maker' for target in node.targets)
        for node in ast.walk(install[0])), 'pinned install path must select PipScriptMaker')
    require(not any(isinstance(node, ast.Assign) and any(isinstance(target, ast.Attribute)
        and isinstance(target.value, ast.Name) and target.value.id == 'maker' and target.attr == 'script_template'
        for target in node.targets) for node in ast.walk(install[0])), 'unexpected later script-template override')
    distlib = ast.parse(distlib_raw.decode('utf-8', 'strict'))
    maker = [node for node in distlib.body if isinstance(node, ast.ClassDef) and node.name == 'ScriptMaker']
    require(len(maker) == 1, 'fixed distlib base required')
    method = [node for node in maker[0].body if isinstance(node, ast.FunctionDef) and node.name == '_get_script_text']
    expected = ast.parse("self.script_template % dict(module=entry.prefix, import_name=entry.suffix.split('.')[0], func=entry.suffix)", mode='eval').body
    require(len(method) == 1 and len(method[0].body) == 1 and isinstance(method[0].body[0], ast.Return)
        and ast.dump(method[0].body[0].value) == ast.dump(expected), 'dynamic instance-template formatting path differs')
    write = [node for node in maker[0].body if isinstance(node, ast.FunctionDef) and node.name == '_write_script']
    require(len(write) == 1 and any(isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == 'script_bytes' for target in node.targets)
        and ast.dump(node.value) == ast.dump(ast.parse('shebang + script_bytes', mode='eval').body)
        for node in ast.walk(write[0])), 'POSIX script shebang concatenation differs')
    template = textwrap.dedent(expression.args[0].value)
    require(template == "import sys\nfrom %(module)s import %(import_name)s\nif __name__ == '__main__':\n    sys.argv[0] = sys.argv[0].removesuffix('.exe')\n    sys.exit(%(func)s())\n", 'fixed pip26.2.1 active script template differs')
    return template


def admit_profile(profile, *, deadline, check):
    require(type(profile) is dict and set(profile) == PROFILE_KEYS and profile['kind'] == 'local-portable-tools-profile-v1'
            and profile['platform'] == {'system': 'Darwin', 'machine': 'arm64', 'python': '3.14.7', 'node': '22.23.3'}
            and profile['trust'] == 'explicit_existing_local_operational_inputs_only', 'exact local tool profile required')
    venv = Path(profile['python']['base_prefix'])/'lib/python3.14/venv'
    required_venv = {str(venv/name) for name in ('__init__.py', '__pycache__/__init__.cpython-314.pyc',
        'scripts/common/Activate.ps1', 'scripts/common/activate', 'scripts/common/activate.fish', 'scripts/posix/activate.csh')}
    require(set(profile['venv_sources']) == required_venv, 'fixed complete venv source/template inventory required')
    for directory, names in (('common', {'Activate.ps1', 'activate', 'activate.fish'}), ('posix', {'activate.csh'})):
        checked(deadline, check)
        require(set(os.listdir(venv/'scripts'/directory)) == names, 'base venv template keyset differs')
    for key in ('python', 'node'):
        check_file(profile[key]['path'], profile[key], deadline=deadline, check=check)
    for alias, target in profile['python']['metadata_aliases'].items():
        checked(deadline, check)
        require(str(Path(alias).resolve(strict=True)) == target, 'fixed Homebrew metadata alias changed')
    pip = profile['pip']
    require(pip['version'] == '26.2.1', 'fixed local external pip required')
    # pip bytecode is part of this trusted pre-existing provisioning closure only.
    # It is never installed in/admitted to the worker venv.
    verify_provisioning_pip(profile, deadline=deadline, check=check)
    pip_sources = []
    for name in ('pip/_internal/operations/install/wheel.py', 'pip/_vendor/distlib/scripts.py'):
        value = pip['files'][name]
        path = value.get('target', str(Path(pip['parent'])/name))
        raw, _ = read_file(path, deadline=deadline, check=check, limit=1024*1024)
        require(digest(raw) == value['sha256'], 'pinned active installer source changed')
        pip_sources.append(raw)
    require(pip['script_template'] == pip_script_template(*pip_sources), 'active pip script template commitment differs')
    for path, value in profile['venv_sources'].items():
        check_file(path, value, deadline=deadline, check=check)
    allowed_startup = profile['startup']['allowed_files']
    for path, value in allowed_startup.items():
        check_file(path, value, deadline=deadline, check=check)
    for path in profile['startup']['absent']:
        checked(deadline, check)
        try:
            os.lstat(path)
        except FileNotFoundError:
            pass
        else:
            raise ValueError('unbound startup customization exists')
    for directory in profile['startup']['site_directories']:
        checked(deadline, check)
        try:
            info = os.lstat(directory)
        except FileNotFoundError:
            continue
        physical_path(directory)
        require(stat.S_ISDIR(info.st_mode), 'physical startup directory required')
        require(not any(name.endswith('.pth') or ((name in ('sitecustomize', 'usercustomize')
                        or name.startswith(('sitecustomize.', 'usercustomize.'))) and str(Path(directory)/name) not in allowed_startup)
                        for name in os.listdir(directory)), 'unbound startup customization exists')
    checked(deadline, check)


def venv_expected(profile, environment):
    environment = str(physical_path(environment)); base = profile['python']['path']
    directory = str(Path(profile['python']['startup_executable_alias']).parent); name = Path(base).name
    result = {f'bin/{alias}': {key: profile['python'][key] for key in ('bytes', 'sha256')} | {'mode': 0o755}
              for alias in (name, 'python', 'python3', 'python3.14', '𝜋thon')}
    cfg = f'home = {directory}\ninclude-system-site-packages = false\nversion = 3.14.7\nexecutable = {base}\ncommand = {profile["python"]["startup_executable_alias"]} -m venv --copies --without-pip {environment}\n'
    result['pyvenv.cfg'] = metadata(cfg.encode())
    result['.gitignore'] = metadata(b'# Created by venv; see https://docs.python.org/3/library/venv.html\n*\n')
    for path, value in profile['venv_sources'].items():
        if '/scripts/common/' not in path and '/scripts/posix/' not in path:
            continue
        script = value['text']; basename = Path(path).name
        replacements = {'__VENV_DIR__': environment, '__VENV_NAME__': Path(environment).name,
                        '__VENV_PROMPT__': Path(environment).name, '__VENV_BIN_NAME__': 'bin',
                        '__VENV_PYTHON__': environment+'/bin/'+name}
        for key, text in replacements.items():
            quoted = "'"+text.replace("'", "''")+"'" if basename.endswith('.ps1') else shlex.quote(text)
            script = script.replace(key, quoted)
        result['bin/'+basename] = metadata(script.encode(), value['mode'])
    return result


def installed_expected(profile, root):
    root = str(physical_path(root)); environment = root+'/environment'
    result = {'environment/'+key: value for key, value in venv_expected(profile, environment).items()}
    site = 'environment/lib/python3.14/site-packages/'
    wheel = profile['wheel']; wheel_files = wheel['inventory']['files']
    for key, value in wheel_files.items():
        if key != 'pglast-7.21.dist-info/RECORD':
            result[site+key] = {**value, 'mode': 0o755 if key.endswith('.so') else 0o644}
    generated = {'pglast-7.21.dist-info/INSTALLER': b'pip\n', 'pglast-7.21.dist-info/REQUESTED': b''}
    python = environment+'/bin/python3'
    require(len(python.encode()) <= 120 and not any(char.isspace() for char in python), 'finite simple console-script shebang path required')
    require(wheel['inventory']['entrypoints'] == '[console_scripts]\npgpp = pglast.__main__:main\n', 'fixed pgpp entrypoint required')
    script = ('#!'+python+'\n'+profile['pip']['script_template'] % {'module': 'pglast.__main__', 'import_name': 'main', 'func': 'main'}).encode()
    result['environment/bin/pgpp'] = metadata(script, 0o755)
    for key, raw in generated.items():
        result[site+key] = metadata(raw)
    rows = []
    for key, value in result.items():
        if key.startswith(site):
            relative = key[len(site):]
        elif key == 'environment/bin/pgpp':
            relative = '../../../bin/pgpp'
        else:
            continue
        sha = base64.urlsafe_b64encode(bytes.fromhex(value['sha256'])).rstrip(b'=').decode('ascii')
        rows.append([relative, 'sha256='+sha, str(value['bytes'])])
    rows.append(['pglast-7.21.dist-info/RECORD', '', ''])
    stream = io.StringIO(newline=''); csv.writer(stream).writerows(sorted(rows))
    result[site+'pglast-7.21.dist-info/RECORD'] = metadata(stream.getvalue().encode())
    for key, value in profile['typescript']['inventory']['files'].items():
        result['typescript/'+key] = {**value, 'mode': 0o644}
    return result


def tool_paths(profile, root):
    return {'python': root+'/environment/bin/python3', 'node': profile['node']['path'],
            'typescript': root+'/typescript/package/lib/typescript.js',
            'site_packages': root+'/environment/lib/python3.14/site-packages',
            'base_prefix': profile['python']['base_prefix'],
            'parser_extension': root+'/environment/lib/python3.14/site-packages/pglast/parser.cpython-314-darwin.so'}


def validate_setup_receipt(receipt, profile):
    commands = receipt['commands']; root = receipt['root']; paths = tool_paths(profile, root)
    require(type(commands) is list and len(commands) == 4
            and [value['label'] for value in commands] == ['venv', 'pip', 'origin', 'node'], 'four fixed setup commands required')
    for value in commands:
        require(type(value) is dict and set(value) == {'label', 'argv', 'started', 'deadline', 'finished',
            'returncode', 'worker_reaped', 'stream_bytes', 'stream_sha256', 'log_identity', 'descendant_cleanup_verified'}, 'exact setup command receipt required')
        require(all(type(value[key]) in (int, float) and math.isfinite(value[key]) for key in ('started', 'deadline', 'finished'))
            and 0 < value['started'] <= value['finished'] < value['deadline'] <= value['started']+120,
            'original bounded command timing required')
        require(type(value['returncode']) is int and value['returncode'] == 0 and value['worker_reaped'] is True
            and value['descendant_cleanup_verified'] is False, 'actual successful setup child required')
        require(set(value['stream_bytes']) == set(value['stream_sha256']) == {'stdout', 'stderr'}
            and all(type(n) is int and 0 <= n <= 4*1024*1024 for n in value['stream_bytes'].values())
            and all(type(h) is str and re.fullmatch('[0-9a-f]{64}', h) for h in value['stream_sha256'].values()), 'bounded command stream evidence required')
        require(type(value['log_identity']) is dict and set(value['log_identity']) == {'stdout', 'stderr'}
            and all(type(identity) is list and len(identity) == 8 and all(type(number) is int for number in identity)
                    for identity in value['log_identity'].values()), 'physical saved setup log identities required')
    require(all(current['started'] >= previous['finished'] for previous, current in zip(commands, commands[1:]))
        and commands[-1]['finished'] < commands[0]['started']+600, 'one serial bounded setup run required')
    require(commands[0]['argv'] == [profile['python']['path'], '-I', '-B', '-m', 'venv', '--copies', '--without-pip', root+'/environment'], 'fixed venv argv differs')
    require(commands[1]['argv'] == [profile['python']['path'], '-I', '-B', '-m', 'pip', '--python', paths['python'],
        '--isolated', '--disable-pip-version-check', '--no-input', '--keyring-provider', 'disabled', 'install', '--no-index',
        '--find-links', root+'/wheelhouse', '--require-hashes', '--only-binary=:all:', '--no-deps', '--no-compile', '--no-cache-dir', '-r', root+'/requirements.txt'], 'fixed offline pip argv differs')
    require(commands[3]['argv'] == [paths['node'], '--version'] and commands[3]['stream_bytes'] == {'stdout': len(b'v22.23.3\n'), 'stderr': 0}
        and commands[3]['stream_sha256'] == {'stdout': digest(b'v22.23.3\n'), 'stderr': digest(b'')}, 'actual Node version observation differs')
    argv = commands[2]['argv']
    require(type(argv) is list and len(argv) == 12 and argv[:3] == [paths['python'], '-I', '-B']
        and type(argv[3]) is str and Path(argv[3]).name == 'origin_probe.py'
        and argv[4:11] == ['--profile', root+'/profile.json', '--profile-sha256', receipt['profile_sha256'], '--root', root, '--deadline']
        and type(argv[11]) is str, 'fixed origin probe argv differs')
    probe_cutoff = float(argv[11])
    require(math.isfinite(probe_cutoff) and commands[2]['finished'] < probe_cutoff <= commands[2]['deadline'], 'origin probe deadline differs')
    probe = receipt['probe']
    require(type(probe) is dict and set(probe) == {'kind', 'passed', 'paths', 'python_version', 'parser_version',
        'isolated', 'no_user_site', 'dont_write_bytecode', 'optimize', 'sys_path'}
        and probe['kind'] == 'local-tool-origin-probe-v1' and probe['passed'] is True and probe['paths'] == paths
        and probe['python_version'] == '3.14.7' and probe['parser_version'] == '7.21'
        and type(probe['isolated']) is int and probe['isolated'] == 1 and type(probe['no_user_site']) is int
        and probe['no_user_site'] == 1 and probe['dont_write_bytecode'] is True and type(probe['optimize']) is int
        and probe['optimize'] == 0 and probe['sys_path'] == profile['python']['sys_path_base']+[paths['site_packages']], 'actual origin probe receipt differs')


def admit_tools(binding, *, deadline, check):
    require(type(binding) is dict and set(binding) == BINDING_KEYS, 'exact external tool binding required')
    profile, _ = load_json(binding['profile_path'], binding['profile_sha256'], deadline=deadline, check=check)
    admit_profile(profile, deadline=deadline, check=check)
    receipt, _ = load_json(binding['receipt_path'], binding['receipt_sha256'], deadline=deadline, check=check)
    require(type(receipt) is dict and set(receipt) == RECEIPT_KEYS and receipt['kind'] == 'local-portable-tools-receipt-v1'
            and receipt['profile_sha256'] == binding['profile_sha256'] and receipt['local_only'] is True
            and receipt['ci_acceptance'] is False and receipt['target_acceptance'] is False,
            'exact local setup receipt required')
    root = str(physical_path(receipt['root']))
    require(binding['profile_path'] == root+'/profile.json' and binding['receipt_path'] == root+'/receipt.json'
        and stat.S_IMODE(os.lstat(root).st_mode) == 0o700 and os.lstat(root).st_uid == os.getuid()
        and list(stamp(os.lstat(root))[:4]) == receipt['root_identity'], 'owned fixed tool root/binding required')
    validate_setup_receipt(receipt, profile)
    evidence = root+'/evidence'; evidence_stat = os.lstat(evidence)
    require(stat.S_ISDIR(evidence_stat.st_mode) and evidence_stat.st_uid == os.getuid()
        and stat.S_IMODE(evidence_stat.st_mode) == 0o700, 'owned private setup evidence directory required')
    evidence_identity = stamp(evidence_stat)[:4]
    expected_log_names = {f'{ordinal:02d}-{command["label"]}.{name}.log'
                          for ordinal, command in enumerate(receipt['commands'], 1) for name in ('stdout', 'stderr')}
    require(set(os.listdir(evidence)) == expected_log_names, 'fixed setup evidence keyset differs')
    for ordinal, command in enumerate(receipt['commands'], 1):
        for name in ('stdout', 'stderr'):
            path = evidence+f'/{ordinal:02d}-{command["label"]}.{name}.log'
            expected_log = {'bytes': command['stream_bytes'][name], 'sha256': command['stream_sha256'][name], 'mode': 0o600}
            identity = check_file(path, expected_log, deadline=deadline, check=check, limit=4*1024*1024)
            require(list(identity) == command['log_identity'][name], 'retained setup log identity changed')
            if ordinal == 3 and name == 'stdout':
                probe_raw, probe_identity = read_file(path, deadline=deadline, check=check, limit=4*1024*1024)
                require(probe_identity == identity and strict_json(probe_raw) == receipt['probe'], 'saved origin output differs from probe commitment')
    require(stamp(os.lstat(evidence))[:4] == evidence_identity and set(os.listdir(evidence)) == expected_log_names,
            'setup evidence directory changed')
    expected = installed_expected(profile, root)
    require(receipt['expected_layout_sha256'] == digest(canonical(expected)), 'deterministic tool layout differs')
    observed = {}; directories = {}
    for prefix in ('environment', 'typescript'):
        local = {key[len(prefix)+1:]: value for key, value in expected.items() if key.startswith(prefix+'/')}
        observed.update({prefix+'/'+key: value for key, value in verify_exact_tree(root+'/'+prefix, local, deadline=deadline, check=check,
            empty_directories=('include',) if prefix == 'environment' else ()).items()})
        directories.update({prefix+('/'+key if key else ''): list(value) for key, value in tree_keys(root+'/'+prefix, deadline=deadline, check=check).items() if len(value) == 4})
    require({key: list(value) for key, value in observed.items()} == receipt['observed'], 'installed tool identity changed')
    require(directories == receipt['directories'], 'installed tool directory identity changed')
    checked(deadline, check)
    return tool_paths(profile, root)


def assert_worker_tools(binding, *, deadline, check):
    paths = admit_tools(binding, deadline=deadline, check=check)
    profile, _ = load_json(binding['profile_path'], binding['profile_sha256'], deadline=deadline, check=check)
    return assert_runtime(profile, paths, deadline=deadline, check=check)


def assert_runtime(profile, paths, *, deadline, check):
    environment = str(Path(paths['python']).parent.parent)
    require(sys.platform == 'darwin' and platform.machine() == 'arm64' and sys.version_info[:3] == (3, 14, 7)
            and sys.executable == paths['python'] and sys.prefix == environment
            and str(Path(sys.base_prefix).resolve()) == paths['base_prefix'], 'actual copied interpreter/prefix differs')
    require(sys.flags.isolated == 1 and sys.flags.no_user_site == 1 and sys.dont_write_bytecode is True
            and sys.flags.optimize == 0 and __debug__, 'worker interpreter flags differ')
    require(sys.path == profile['python']['sys_path_base']+[paths['site_packages']], 'worker startup path closure differs')
    require(not any(name == 'pglast' or name.startswith('pglast.') for name in sys.modules), 'parser must not be preloaded')
    for name in ('pglast', 'pglast.parser', 'pglast.ast'):
        importlib.import_module(name); checked(deadline, check)
    require(importlib.metadata.version('pglast') == '7.21', 'parser distribution version differs')
    dist = importlib.metadata.distribution('pglast')
    require(str(dist.locate_file('')) == paths['site_packages'], 'parser metadata origin differs')
    for name, module in tuple(sys.modules.items()):
        if name == 'pglast' or name.startswith('pglast.'):
            origin = getattr(module, '__file__', None)
            spec = getattr(module, '__spec__', None)
            require(type(origin) is str and spec is not None and spec.origin == origin
                    and origin.startswith(paths['site_packages']+'/pglast/'), 'foreign parser module origin')
            relative = origin[len(paths['site_packages'])+1:]
            require(relative in profile['wheel']['inventory']['files'], 'undeclared parser module')
            check_file(origin, profile['wheel']['inventory']['files'][relative], deadline=deadline, check=check)
    require(sys.modules['pglast.parser'].__file__ == paths['parser_extension'], 'parser extension differs')
    checked(deadline, check)
    return paths
