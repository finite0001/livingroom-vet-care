"""Finite trusted-test launch policy. This is not a hostile-Python sandbox.

The parent admits independently reviewed source/tool receipts before importing any
suite. An installed guard is permanent for that one worker process.
"""
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import threading
from types import MappingProxyType

# Bootstrap the one helper from exact bytes before importing it. No ambient
# same-name module or sys.path fallback is allowed, even in an isolated worker.
import types as _types
_physical_path = str(Path(__file__).absolute().with_name('physical.py'))
_physical_sha = '98d2803931457fe8428cea5b732d6884aef4ba602b45e07729b6f1fcce374522'
_bootstrap_fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
try:
    _parts = _physical_path.split('/')[1:]
    if any(x in ('', '.', '..') for x in _parts):
        raise ImportError('Nonphysical guard module path')
    for _part in _parts[:-1]:
        _next = os.open(_part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=_bootstrap_fd)
        os.close(_bootstrap_fd)
        _bootstrap_fd = _next
    _leaf = os.open(_parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=_bootstrap_fd)
    try:
        _info = os.fstat(_leaf)
        if not stat.S_ISREG(_info.st_mode) or _info.st_size > 16384:
            raise ImportError('Invalid physical helper type/size')
        _physical_bytes = os.read(_leaf, 16385)
    finally:
        os.close(_leaf)
finally:
    os.close(_bootstrap_fd)
if hashlib.sha256(_physical_bytes).hexdigest() != _physical_sha:
    raise ImportError('Physical helper digest differs')
if 'physical' in sys.modules:
    if getattr(sys.modules['physical'], '__file__', None) != _physical_path:
        raise ImportError('Preloaded physical helper has foreign origin')
else:
    _module = _types.ModuleType('physical')
    _module.__file__ = _physical_path
    sys.modules['physical'] = _module
    try:
        exec(compile(_physical_bytes, _physical_path, 'exec'), _module.__dict__)
    except BaseException:
        del sys.modules['physical']
        raise
from physical import AdmissionError, absolute, admit_directory, beneath, read_file, relative


CONTRACT_SHA = '27ffe06d39e6c70051ad62fa33855d2220af94a83f26032b2d5d08fd8c65c847'
POLICY_ENVELOPE_SHA = 'd7c626ca52673bafa204ffb57ca97b1cb618b08edb8659868fb9e4b0b1b27b46'
HISTORICAL_ROUTE_SHA = 'cd50e932c3435c4ef48e8b7b4ed23fdd68fda3ddfbb08763ab74313825de33d5'
TS_SHA = 'dd17428736a07e1db1a138d8a14295ddb2699ba780ee15038acdd2c6da5373a0'
VENDOR_SUFFIX = 'tests/controlled-drugs/engine/candidate/vendor/supabase-cli-2.118.0'
MAX_SOURCE_FILE = 128 * 1024 * 1024
MAX_SOURCE_FILES = 8192
ENV_KEYS = frozenset(('HOME', 'TMPDIR', 'PATH', 'LC_ALL', 'LANG', 'PYTHONDONTWRITEBYTECODE',
                      'PYTHONNOUSERSITE', 'PYTHONUTF8', 'PYTHONOPTIMIZE', 'CONTROLLED_REVIEW_TYPESCRIPT'))
_ORIGINAL_RUN = subprocess.run
_POSIX_SPAWN_CODE = subprocess.Popen._posix_spawn.__code__



def platform_environment():
    """One operational Darwin startup value; never copy it from ambient env.

    CoreFoundation adds this UID/encoding tuple to a fresh Python process on
    Darwin. The parent supplies the same fixed tuple prospectively. Linux has
    no additional environment key, even if a caller inherited one.
    """
    if sys.platform == 'darwin':
        return {'__CF_USER_TEXT_ENCODING': f'0x{os.getuid():X}:0x0:0x0'}
    return {}


def require(value, message):
    if not value:
        raise AdmissionError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def strict_json(raw):
    def pairs(items):
        out = {}
        for k, v in items:
            require(k not in out, 'Duplicate JSON key')
            out[k] = v
        return out
    def constant(value):
        raise AdmissionError('Nonfinite JSON constant')
    try:
        return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)
    except RecursionError as error:
        raise AdmissionError('JSON nesting exceeds decoder bound') from error


def freeze(value):
    if type(value) is dict:
        return MappingProxyType({k: freeze(v) for k, v in value.items()})
    if type(value) is list:
        return tuple(freeze(v) for v in value)
    return value


def pin_fields(value):
    require(type(value) is dict and set(value) == {'sha256', 'bytes'}, 'Exact file pin fields required')
    require(type(value['bytes']) is int and 0 <= value['bytes'] <= MAX_SOURCE_FILE, 'Source file bound')
    require(type(value['sha256']) is str and re.fullmatch('[0-9a-f]{64}', value['sha256']), 'SHA256 required')
    return dict(value)


def checked_pins(root, pins):
    require(type(pins) is dict and 0 < len(pins) <= MAX_SOURCE_FILES, 'Finite nonempty source inventory required')
    out = {}
    for name, receipt in pins.items():
        relative(name)
        entry = pin_fields(receipt)
        out[name], _ = read_file(root.path + '/' + name, limit=entry['bytes'],
                                 expected_size=entry['bytes'], expected_sha=entry['sha256'])
    return out


@dataclass(frozen=True)
class Tree:
    tag: str
    root: object
    files: object
    profile: str

    def file(self, name, expected=None):
        relative(name)
        require(name in self.files, 'Source file not independently admitted')
        pin = self.files[name]
        if expected is not None:
            require(pin.sha256 == expected, 'Source does not match route authority')
        self.root.verify()
        pin.verify()
        return pin


@dataclass(frozen=True)
class Config:
    contract: object
    routes: object
    literals: object
    inventory: object
    node: object
    trees: object
    tools: object
    clean_env: object
    worker_cwd: object
    suite_id: str
    suite_tree_tag: str
    historical_templates: object
    historical_route: object


def admit_config(*, contract_root, source_trees, tools, clean_env, worker_cwd,
                 suite_id, suite_tree_tag, extra_test_inventory=None,
                 historical_templates=None, historical_route=None):
    """No observed source hashes become expected hashes. Inputs are parent receipts."""
    cr = admit_directory(contract_root)
    source_pin, raw = read_file(cr.path + '/policy-envelope.json', limit=65536,
                               expected_sha=POLICY_ENVELOPE_SHA)
    receipt = strict_json(raw)
    require(receipt['contract_source_ready_v3_sha256'] == CONTRACT_SHA and set(receipt['files']) == {'child-routes.json', 'corrected-routing.json', 'node-input-declaration.json'}, 'Exact compact policy lineage required')
    bound = checked_pins(cr, receipt['files'])
    def authority(name):
        require(name in bound, 'Missing contract authority')
        return strict_json(read_file(bound[name].path, limit=bound[name].size,
                                     expected_sha=bound[name].sha256)[1])
    routes = authority('child-routes.json')
    routing = authority('corrected-routing.json')
    node = authority('node-input-declaration.json')
    require(len(routes['routes']) == 22 and len(routes['code_literals']) == 14, 'Fixed route inventory')
    inventory = {x['original_id']: x for x in routing['tests']}
    require(len(inventory) == 867 and len(routing['tests']) == 867, 'Exact original test inventory')
    for sha, item in routes['code_literals'].items():
        data = item['code'].encode('utf-8')
        require(digest(data) == sha and len(data) == item['utf8_bytes'], 'Literal code authority mismatch')
    require(type(source_trees) in (list, tuple) and 0 < len(source_trees) <= 16, 'Finite source trees required')
    trees = {}
    total_source_bytes = 0
    for value in source_trees:
        require(type(value) is dict and set(value) == {'tag', 'root', 'files', 'profile'}, 'Exact SourceTree fields')
        tag = value['tag']
        require(type(tag) is str and tag and tag not in trees, 'Unique source tree tag')
        require(type(value['profile']) is str, 'Explicit source profile')
        require(type(value['files']) is dict, 'Source file map required')
        for metadata in value['files'].values():
            total_source_bytes += pin_fields(metadata)['bytes']
        require(total_source_bytes <= 1024*1024*1024, 'Aggregate admitted source byte bound')
        root = admit_directory(value['root'])
        trees[tag] = Tree(tag, root, MappingProxyType(checked_pins(root, value['files'])), value['profile'])
    require(suite_tree_tag in trees, 'Explicit suite tree required')
    require(type(suite_id) is str, 'Suite source id required')
    relative(suite_id)
    trees[suite_tree_tag].file(suite_id)
    require(extra_test_inventory is None or (type(extra_test_inventory) is dict and len(extra_test_inventory) <= 4096), 'Finite extra test inventory required')
    for test_id, item in (extra_test_inventory or {}).items():
        require(type(test_id) is str and test_id not in inventory and test_id.startswith(suite_id + '::'), 'Exact new test id')
        require(type(item) is dict and set(item) == {'source', 'sha256'} and item['source'] == suite_id, 'New test source binding')
        trees[suite_tree_tag].file(item['source'], item['sha256'])
        inventory[test_id] = {'original_id': test_id, 'actual_method_origin': item['source']}
    require(any(x.startswith(suite_id + '::') for x in inventory), 'Suite missing from declared collection')
    # A known route's suite source itself must retain its fixed bytes. Other new
    # suites receive membership only, never implicit child permission.
    if suite_id in routes['source_pins']:
        trees[suite_tree_tag].file(suite_id, routes['source_pins'][suite_id])
    require(type(tools) is dict and set(tools) == {'python', 'node', 'typescript'}, 'Three independently provisioned tools required')
    admitted_tools = {}
    for key, value in tools.items():
        fields = {'path', 'sha256', 'bytes', 'dev', 'ino', 'version'}
        if key == 'typescript':
            fields.add('package_version')
        require(type(value) is dict and set(value) == fields, 'Exact tool receipt fields')
        require(type(value['dev']) is int and type(value['ino']) is int and type(value['version']) is str, 'Strict tool identity types')
        pin_fields({'sha256': value['sha256'], 'bytes': value['bytes']})
        pin, _ = read_file(value['path'], limit=value['bytes'], expected_sha=value['sha256'], expected_size=value['bytes'])
        require(pin.identity[:2] == (value['dev'], value['ino']), 'Physical tool identity mismatch')
        if key != 'typescript':
            require(pin.identity[5] & 0o111 and not pin.identity[5] & 0o022, 'Executable tool must not be group/world writable')
        if key == 'node':
            require(re.fullmatch(r'v?22\.\d+\.\d+', value['version']), 'Observed Node22 version required')
        if key == 'typescript':
            require(value['package_version'] == value['version'] == '5.8.3' and pin.sha256 == TS_SHA, 'Pinned TypeScript5.8.3 required')
        admitted_tools[key] = pin
    platform_env = platform_environment()
    require(type(clean_env) is dict and set(clean_env) == ENV_KEYS | set(platform_env), 'Exact sanitized environment required')
    require(all(type(k) is str and type(v) is str and '\x00' not in v for k, v in clean_env.items()), 'Exact text environment')
    require(all(clean_env[k] == value for k, value in platform_env.items()), 'Exact platform environment value required')
    require(all(clean_env[k] == '1' for k in ('PYTHONDONTWRITEBYTECODE', 'PYTHONNOUSERSITE', 'PYTHONUTF8')), 'Python isolation environment')
    require(clean_env['PYTHONOPTIMIZE'] == '0', 'Child Python assertions must remain enabled')
    require(clean_env['CONTROLLED_REVIEW_TYPESCRIPT'] == admitted_tools['typescript'].path, 'Exact TypeScript environment')
    admit_directory(clean_env['HOME'], mode=0o700)
    admit_directory(clean_env['TMPDIR'], mode=0o700)
    for component in clean_env['PATH'].split(os.pathsep):
        admit_directory(component)
    templates = {}
    for name, files in (historical_templates or {}).items():
        require(name in ('stored638', 'a2_669'), 'Unknown historical template')
        require(type(files) is dict and len(files) == {'stored638': 639, 'a2_669': 669}[name], 'Exact historical template count')
        templates[name] = {relative(k): pin_fields(v) for k, v in files.items()}
    history = None
    if historical_route is not None:
        require(type(historical_route) is dict and set(historical_route) == {'declaration_path', 'declaration_sha256', 'worker_tree_tag', 'worker_relative', 'repository_tree_tag'}, 'Exact historical route config')
        require(historical_route['declaration_sha256'] == HISTORICAL_ROUTE_SHA, 'Reviewed historical route required')
        hp, raw = read_file(historical_route['declaration_path'], limit=16384, expected_sha=HISTORICAL_ROUTE_SHA)
        hd = strict_json(raw)
        wt = trees[historical_route['worker_tree_tag']]
        wp = wt.file(historical_route['worker_relative'], hd['worker_sha256'])
        require(wp.size == hd['worker_bytes'], 'Historical worker byte count')
        require(historical_route['repository_tree_tag'] in trees and 'stored638' in templates, 'Historical repository/template required')
        history = {'declaration': hd, 'pin': hp, 'worker': wp, 'repository_tag': historical_route['repository_tree_tag']}
    return Config((source_pin, MappingProxyType(bound)), freeze(routes['routes']), freeze(routes['code_literals']),
                  freeze(inventory), freeze(node), MappingProxyType(trees), MappingProxyType(admitted_tools),
                  freeze(clean_env), admit_directory(worker_cwd), suite_id, suite_tree_tag,
                  freeze(templates), freeze(history))


class Guard:
    def __init__(self, config):
        require(type(config) is Config, 'Admitted configuration required')
        self.config = config
        self._thread = threading.get_ident()
        self._active = None
        self._seen = set()
        self._owned = {}
        self._counts = {}
        self._denials = []
        self._denial_count = 0
        self._launches = []
        self._permit = None
        self._spawn_transition = None
        self._installed = False
        self._install_probe = False
        self._run_delegate = _ORIGINAL_RUN
        self._wrapper = self.run

    def _deny(self, message):
        self._denial_count += 1
        if len(self._denials) < 64:
            self._denials.append({'test_id': self._active, 'reason': str(message)[:240]})
        raise PermissionError('Offline worker launch denied: ' + str(message)[:240])

    def _thread_check(self):
        require(threading.get_ident() == self._thread, 'Worker guard is single-threaded')

    def register_owned_directory(self, path):
        try:
            self._thread_check()
            pin = admit_directory(path, mode=0o700)
            require(pin.path not in self._owned, 'Directory registration cannot be replaced')
            require(len(self._owned) < 8192, 'Owned directory count bound')
            self._owned[pin.path] = (pin, self._active)
        except (AdmissionError, OSError, ValueError) as e:
            self._deny(e)

    def begin_test(self, test_id):
        try:
            self._thread_check()
            require(self._active is None and self._permit is None, 'Nested test/permit refused')
            require(type(test_id) is str and test_id in self.config.inventory and test_id.startswith(self.config.suite_id + '::'), 'Unknown or cross-suite stable test id')
            require(test_id not in self._seen, 'Duplicate test execution refused')
            self._seen.add(test_id)
            self._active = test_id
        except (AdmissionError, OSError, ValueError) as e:
            self._deny(e)

    def end_test(self, test_id=None):
        try:
            self._thread_check()
            require(self._active is not None and self._permit is None, 'No active test or stale Node permit')
            require(test_id is None or test_id == self._active, 'End-test identity mismatch')
            self._active = None
            self._spawn_transition = None
        except (AdmissionError, OSError, ValueError) as e:
            self._deny(e)

    def _owned_for(self, path):
        value, _ = absolute(path)
        matches = [(p, owner) for p, owner in self._owned.values()
                   if (value == p.path or beneath(p, value)) and owner in (None, self._active)]
        require(matches, 'Path has no suite/current-test owned root')
        root, _ = max(matches, key=lambda x: len(x[0].path))
        root.verify()
        return root

    def _environment(self, env):
        actual = dict(os.environ) if env is None else env
        require(type(actual) is dict and all(type(k) is str and type(v) is str for k, v in actual.items()), 'Exact child environment strings required')
        return dict(actual)

    def _cwd(self, cwd):
        # Inherited cwd must still be the independently fixed worker cwd.
        value = os.getcwd() if cwd is None else os.fspath(cwd)
        absolute(value)
        admit_directory(value)
        return value

    def _source(self, route):
        tree = self.config.trees[self.config.suite_tree_tag]
        if 'caller' in route:
            require(self._active == route['caller'], 'Wrong explicit route caller')
        else:
            require(self.config.suite_id == route['source'], 'Wrong suite for route')
        tree.file(self.config.suite_id)
        # Node's code source is separate from its caller, but remains source-bound.
        source = route['source']
        tree.file(source)
        if route['id'] == 'official-cli-statement-parser':
            for name, sha in self.config.node['independent_authority_pins'].items():
                tree.file(name, sha)
        if 'profile_source' in route:
            tree.file(route['profile_source'], route['profile_source_sha256'])
        return tree

    def _resolve_tool(self, executable, argv, env, kind):
        pin = self.config.tools[kind]
        pin.verify()
        if kind == 'python':
            require(executable == argv[0] == pin.path, 'Python must use exact physical executable')
        else:
            require(argv[0] == 'node' and executable == 'node', 'Exact Node name/argv required')
            # Resolve only the first existing PATH candidate; symlinks are refused.
            found = None
            for folder in env['PATH'].split(os.pathsep):
                candidate = folder + '/node'
                if os.path.lexists(candidate):
                    found = candidate
                    break
            require(found == pin.path, 'Node PATH must resolve directly to admitted physical tool')

    def _literal_argv(self, route):
        out = []
        tree = self.config.trees[self.config.suite_tree_tag]
        for value in route['argv']:
            if value == 'PINNED_PYTHON':
                out.append(self.config.tools['python'].path)
            elif value.startswith('CODE:'):
                out.append(self.config.literals[value[5:]]['code'])
            elif value.startswith('EXACT_TREE_SCRIPT:'):
                out.append(tree.file(value.split(':', 1)[1], route['script_sha256']).path)
            else:
                out.append(value)
        return out

    def _verify_historical_tree(self, path, profile):
        require(profile in self.config.historical_templates, 'Historical template not admitted')
        self._owned_for(path)
        root = admit_directory(path)
        expected = self.config.historical_templates[profile]
        actual = set()
        stack = [root.path]
        directories = 0
        while stack:
            directory = stack.pop()
            directories += 1
            require(directories <= MAX_SOURCE_FILES, 'Historical directory count bound')
            # scandir itself does not follow symlinks; every member is checked.
            from physical import directory_fd
            fd = directory_fd(directory)
            try:
                names = os.listdir(fd)
                require(len(names) <= MAX_SOURCE_FILES, 'Historical directory member bound')
                for name in names:
                    info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    child = directory + '/' + name
                    if stat.S_ISDIR(info.st_mode):
                        stack.append(child)
                    else:
                        require(stat.S_ISREG(info.st_mode), 'Historical symlink/nonregular member refused')
                        rel = child[len(root.path) + 1:]
                        require(rel in expected and rel not in actual, 'Unexpected historical source member')
                        e = expected[rel]
                        read_file(child, limit=e['bytes'], expected_sha=e['sha256'], expected_size=e['bytes'])
                        actual.add(rel)
            finally:
                os.close(fd)
        require(actual == set(expected), 'Historical source set mismatch')
        root.verify()

    def _match(self, route, executable, argv, cwd, env):
        tree = self._source(route)
        expected = self._literal_argv(route)
        rid = route['id']
        if rid == 'owned-inert-docker-name-script':
            require(argv == tuple(expected) and executable == 'docker', 'Exact inert Docker argv')
            root = self._owned_for(cwd)
            require(root.path == cwd, 'Inert executable cwd must be registered root')
            want = dict(self.config.clean_env, PATH=cwd, DOCKER_HOST='unix:///local/docker.sock')
            require(env == want, 'Exact inert Docker environment')
            data = route['template'].replace('${PINNED_PYTHON}', self.config.tools['python'].path).encode('utf-8')
            self.config.tools['python'].verify()
            read_file(cwd + '/docker', limit=len(data), expected_size=len(data), expected_sha=digest(data), mode=0o700)
            return
        require(env == self.config.clean_env, 'Environment differs from sanitized setup')
        if rid == 'official-cli-statement-parser':
            self._resolve_tool(executable, argv, env, 'node')
            require(argv == tuple(expected) and cwd == self.config.worker_cwd.path, 'Exact Node argv/cwd')
            p = self._permit
            require(p is not None and not p['used'] and p['thread'] == threading.get_ident() and p['test'] == self._active,
                    'Node launch lacks fresh single-use stdin permit')
            require(p['argv'] == argv and p['env'] == env and p['cwd'] == cwd, 'Node permit launch mismatch')
            p['used'] = True
            return
        self._resolve_tool(executable, argv, env, 'python')
        if rid.startswith('session:'):
            require(len(argv) == len(expected) and argv[:5] == tuple(expected[:5]), 'Exact session code/flags')
            require(argv[5] in route['allowed_modes'], 'Unlisted session mode')
            received = argv[6]
            require(received == cwd + '/child-received.log', 'Exact session journal basename/cwd')
            self._owned_for(cwd)
            # Existing journal may be appended by an inert child; never follow a
            # pre-existing symlink/FIFO. An absent leaf is allowed.
            if os.path.lexists(received):
                journal, _ = read_file(received, limit=MAX_SOURCE_FILE)
                require(journal.identity[6] == 1, 'Session journal must not be hard linked')
            if 'class_profiles' in route:
                cls = self._active.split('::', 1)[1].split('.', 1)[0]
                require(cls in route['class_profiles'], 'Unknown A2 session class')
                require(argv[7:] == route['class_profiles'][cls]['suffix'], 'A2 suffix differs from class profile')
            else:
                require(argv[7:] == (), 'Extra session arguments')
            return
        if rid == 'historical-materializer:worker':
            require(len(argv) == 7 and argv[:5] == tuple(expected[:5]) and argv[6] in route['profiles'], 'Exact materializer argv')
            require(cwd == self.config.worker_cwd.path, 'Materializer cwd mismatch')
            self._verify_historical_tree(argv[5], argv[6])
            return
        require(argv == tuple(expected), 'Exact finite argv required')
        required_cwd = tree.root.path if 'gate_a_runtime_harness' in route['source'] else self.config.worker_cwd.path
        require(cwd == required_cwd, 'Fixed child cwd mismatch')

    def _historical_match(self, executable, argv, cwd, env):
        h = self.config.historical_route
        require(h is not None and self._active in h['declaration']['allowed_original_test_ids'], 'No historical assertion route for caller')
        h['pin'].verify(); h['worker'].verify()
        self.config.trees[self.config.suite_tree_tag].file(self.config.suite_id)
        repository = self.config.trees[h['repository_tag']]
        repository.root.verify()
        self._resolve_tool(executable, argv, env, 'python')
        require(len(argv) == 8 and argv[:6] == (self.config.tools['python'].path, '-I', '-B', h['worker'].path, '--repository-root', repository.root.path)
                and argv[6] == '--tree-root', 'Exact historical assertion argv')
        require(cwd == self.config.worker_cwd.path and env == self.config.clean_env, 'Historical assertion environment/cwd')
        self._verify_historical_tree(argv[7], 'stored638')
        return h['declaration']

    def _launch(self, executable, argv, cwd, env):
        self._thread_check()
        require(self._active is not None and not self._denial_count, 'No active clean test context')
        require(type(executable) is str and type(argv) in (list, tuple) and all(type(v) is str for v in argv), 'Exact textual argv required')
        require(0 < len(argv) <= 16 and sum(len(x) for x in argv) <= 65536, 'Finite argv bound')
        argv = tuple(argv)
        actual_env = self._environment(env)
        actual_cwd = self._cwd(cwd)
        candidates = [r for r in self.config.routes
                      if (r.get('caller') == self._active or ('caller' not in r and r['source'] == self.config.suite_id))]
        matched = None
        errors = []
        for route in candidates:
            try:
                self._match(route, executable, argv, actual_cwd, actual_env)
                matched = route
                break
            except (AdmissionError, OSError, ValueError, KeyError) as e:
                errors.append(str(e))
        if matched is None and self.config.historical_route is not None:
            try:
                matched = self._historical_match(executable, argv, actual_cwd, actual_env)
            except (AdmissionError, OSError, ValueError, KeyError) as e:
                errors.append(str(e))
        require(matched is not None, 'No exact admitted child route: ' + ('; '.join(errors)[-160:] if errors else 'caller has no launch permission'))
        key = (self._active, matched['id'])
        count = self._counts.get(key, 0) + 1
        require(count <= matched['max_calls_per_test'], 'Per-test route launch count exceeded')
        self._counts[key] = count
        self._launches.append({'test_id': self._active, 'route': matched['id'], 'ordinal': count})
        self._spawn_transition = (threading.get_ident(), executable, argv, actual_env, self._active)

    def audit(self, event, args):
        """Public only to permit small inert self-tests; never disables the hook."""
        try:
            if event == 'portable_guard.install_probe':
                require(args == (id(self),), 'Wrong guard installation probe')
                self._install_probe = True
            elif event.startswith('socket.'):
                raise AdmissionError('Worker socket operation forbidden: ' + event)
            if event == 'subprocess.Popen':
                require(len(args) == 4, 'Unknown Popen audit schema')
                self._spawn_transition = None
                self._launch(*args)
            elif event == 'os.posix_spawn':
                # CPython can emit this second event for the same Popen. A direct
                # os.posix_spawn must not reuse a prior permitted launch. Require
                # its actual stdlib _posix_spawn caller frame as well as identity.
                frame = sys._getframe(1)
                require(frame.f_code is _POSIX_SPAWN_CODE, 'Direct posix_spawn forbidden')
                require(len(args) == 3 and self._spawn_transition is not None, 'No matching Popen transition')
                exe, argv, env = args
                require((threading.get_ident(), exe, tuple(argv), self._environment(env), self._active) == self._spawn_transition, 'Spawn transition mismatch')
                self._spawn_transition = None
            elif event in ('os.system', 'os.fork', 'os.forkpty', 'os.exec', 'os.spawn', 'pty.spawn'):
                raise AdmissionError('Unlisted process primitive: ' + event)
        except (AdmissionError, OSError, ValueError, KeyError, TypeError, UnicodeError) as e:
            self._deny(e)

    def _vendor(self, path):
        suffix = '/' + VENDOR_SUFFIX
        require(path.endswith(suffix), 'Exact vendor suffix required')
        base = path[:-len(suffix)]
        admitted = next((t for t in self.config.trees.values() if t.root.path == base), None)
        if admitted:
            admitted.root.verify()
        else:
            self._owned_for(base)
        admit_directory(path)
        vendor = self.config.node['vendor']
        read_file(path + '/provenance.json', limit=65536, expected_sha=vendor['provenance_sha256'])
        for name, pin in vendor['files'].items():
            read_file(path + '/' + name, limit=1024*1024, expected_sha=pin['sha256'])
        require(set(os.listdir(path)) == set(vendor['files']) | {'provenance.json'}, 'Unexpected vendor member')

    def _node_payload(self, value):
        require(type(value) is str, 'Node input must be immutable str')
        limits = self.config.node['limits']
        require(len(value) <= limits['request_utf8_bytes'], 'Node request character bound')
        raw = value.encode('utf-8', 'strict')
        require(len(raw) <= limits['request_utf8_bytes'], 'Node request byte bound')
        body = strict_json(value)
        require(type(body) is dict and set(body) == {'sources', 'typescript', 'vendor'}, 'Exact Node request keys')
        require(json.dumps(body, sort_keys=True, separators=(',', ':'), ensure_ascii=True) == value, 'Node request must retain exact canonical encoding')
        for key in ('typescript', 'vendor'):
            require(type(body[key]) is str and len(body[key].encode('utf-8', 'strict')) <= limits['path_utf8_bytes'], 'Node physical path bound/type')
            absolute(body[key])
        require(body['typescript'] == self.config.tools['typescript'].path, 'Node TypeScript path differs')
        self.config.tools['typescript'].verify()
        self._vendor(body['vendor'])
        sources = body['sources']
        require(type(sources) is list and 0 < len(sources) <= limits['sources_max'], 'Node source count/type')
        actual, total = [], 0
        for row in sources:
            require(type(row) is dict and set(row) == {'name', 'body'}, 'Exact Node source row keys')
            require(type(row['name']) is str and type(row['body']) is str, 'Node source scalars must be strings')
            require(len(row['body']) <= limits['aggregate_body_utf8_bytes'], 'Node body character bound')
            encoded = row['body'].encode('utf-8', 'strict')
            row['name'].encode('utf-8', 'strict')
            total += len(encoded)
            require(total <= limits['aggregate_body_utf8_bytes'], 'Node aggregate body byte bound')
            actual.append((row['name'], len(encoded), digest(encoded)))
        selected = [name for name, expected in self.config.node['source_arrays'].items()
                    if tuple(actual) == tuple((e['name'], e['body_utf8_bytes'], e['body_sha256']) for e in expected)]
        require(len(selected) == 1, 'Node sources differ from all three independent arrays')
        return raw, selected[0]

    def run(self, *args, **kwargs):
        # All non-Node calls keep stdlib behavior and meet the independent Popen
        # audit. The exact Node name, physical path, or -e code requests validation.
        argv = args[0] if args else kwargs.get('args')
        node_attempt = isinstance(argv, (list, tuple)) and bool(argv) and (
            argv[0] in ('node', self.config.tools['node'].path)
            or any(type(x) is str and x == self.config.literals['ed3f7c4e533dda7922f076b3f3b5ad878600f452d29b3e62b8934961f212ceb0']['code'] for x in argv))
        if not node_attempt:
            return self._run_delegate(*args, **kwargs)
        try:
            self._thread_check()
            require(not self._denial_count and self._permit is None, 'Node wrapper requires clean idle permit')
            route = next(r for r in self.config.routes if r['id'] == 'official-cli-statement-parser')
            self._source(route)
            require(len(args) == 1 and type(argv) in (list, tuple) and all(type(v) is str for v in argv), 'Exact Node positional args')
            require(tuple(argv) == tuple(self._literal_argv(route)), 'Exact Node command')
            require(set(kwargs) == {'input', 'text', 'capture_output', 'check', 'timeout'}, 'Exact Node call keywords')
            require(all(kwargs[k] is True for k in ('text', 'capture_output', 'check')) and type(kwargs['timeout']) is int and kwargs['timeout'] == 120, 'Exact Node call flags/timeout')
            raw, array = self._node_payload(kwargs['input'])
            env = self._environment(None)
            cwd = self._cwd(None)
            require(env == self.config.clean_env and cwd == self.config.worker_cwd.path, 'Node inherited context changed')
            self._resolve_tool('node', argv, env, 'node')
            private_argv = tuple(argv)
            self._permit = {'argv': private_argv, 'env': env, 'cwd': cwd, 'thread': threading.get_ident(),
                            'test': self._active, 'used': False, 'input_sha256': digest(raw), 'input_bytes': len(raw), 'array': array}
            private_kwargs = {'input': kwargs['input'], 'text': True, 'capture_output': True, 'check': True, 'timeout': 120}
            result = self._run_delegate(private_argv, **private_kwargs)
            require(self._permit['used'], 'Node run returned without consuming exact Popen permit')
            return result
        except (AdmissionError, OSError, ValueError, KeyError, TypeError, UnicodeError) as e:
            self._deny(e)
        finally:
            self._permit = None
            self._spawn_transition = None

    def install(self):
        self._thread_check()
        require(not self._installed and subprocess.run is _ORIGINAL_RUN, 'Guard must install once before target imports')
        require(dict(os.environ) == self.config.clean_env and os.getcwd() == self.config.worker_cwd.path, 'Worker must enter exact clean context before install')
        sys.addaudithook(self.audit)
        sys.audit('portable_guard.install_probe', id(self))
        require(self._install_probe, 'Guard audit hook did not install')
        subprocess.run = self._wrapper
        self._installed = True

    def snapshot_report(self):
        return {'kind': 'finite-offline-worker-guard-report-v1', 'suite_id': self.config.suite_id,
                'contract_sha256': CONTRACT_SHA, 'installed': self._installed,
                'test_ids': sorted(self._seen), 'active_test': self._active,
                'launches': [dict(x) for x in self._launches],
                'denial_count': self._denial_count, 'denials': [dict(x) for x in self._denials],
                'owned_directories': len(self._owned), 'pending_node_permit': self._permit is not None,
                'universal_descendant_containment': False}

    def assert_clean(self):
        require(not self._denial_count and self._active is None and self._permit is None, 'Sticky guard failure or incomplete test/permit')
        if self._installed:
            require(subprocess.run is self._wrapper, 'Installed Node wrapper was not restored')
        return self.snapshot_report()
