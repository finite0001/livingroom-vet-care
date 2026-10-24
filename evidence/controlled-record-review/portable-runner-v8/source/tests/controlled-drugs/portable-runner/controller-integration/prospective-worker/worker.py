"""One explicitly declared offline unittest suite in a fresh guarded interpreter.

Only --job PHYSICAL_FILE --job-sha256 SHA256. No discovery, materialization or DB.
"""
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
import unittest

MAX_BYTES = 4 * 1024 * 1024
MAX_TESTS = 4096
JOB_KEYS = {'kind', 'job_id', 'deadline', 'suite', 'guard', 'implementation', 'output', 'historical638', 'partition'}
GUARD_KEYS = {'contract_root', 'source_trees', 'tools', 'clean_env', 'worker_cwd', 'suite_id', 'suite_tree_tag', 'extra_test_inventory', 'historical_templates', 'historical_route'}
KINDS = {'original', 'a2_runtime', 'a2_session', 'stored_adapter', 'portable_fixture', 'historical_materializer', 'declared_new', 'historical_boundary'}
HISTORY = {
    'kind': 'historical638-profile267-assertion-v1', 'source_count': 638,
    'profile_inputs': 267, 'baseline_count': 634,
    'source_map_sha256': '68987ef56aff1da537c8a3d7ff16eead831e602909d67502998951396d6b30dc',
    'expected_sha256': 'fec2ff871f064a124ae3a0fb5ba60e36b8b58dda1932393cd656c43cd68abd7d',
    'install_sha256': '22021a314fc196efa822a16ca30d25c7f9f6e70811703fe60eb747d92280d542',
    'historical_gate_passed': True, 'legacy_full761_admission': False, 'database_commands': 0,
}


def require(value, message):
    if not value:
        raise ValueError(message)


def exact_keys(value, keys, message):
    require(type(value) is dict and set(value) == set(keys), message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def strict_json(raw):
    require(type(raw) is bytes and 0 < len(raw) <= MAX_BYTES, 'bounded JSON bytes required')
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'duplicate JSON key')
            result[key] = value
        return result
    def constant(_):
        raise ValueError('nonfinite JSON constant')
    return json.loads(raw.decode('utf-8', errors='strict'), object_pairs_hook=pairs, parse_constant=constant)


def absolute(value):
    require(type(value) is str and value.startswith('/') and '\x00' not in value, 'absolute physical path required')
    path = Path(value)
    require('..' not in path.parts and str(path) == value, 'normalized physical path required')
    return path


def relative(value):
    require(type(value) is str and value and not value.startswith('/') and '\\' not in value, 'relative source path required')
    require(all(part not in ('', '.', '..') for part in value.split('/')), 'relative source segments required')
    return Path(value)


def physical(path, *, metadata=None, limit=MAX_BYTES, directory=False, mode=None, check=lambda: None):
    """Descriptor-held nofollow traversal; return checked bytes or directory identity."""
    path = absolute(str(path)); descriptors = []; edges = []; leaf = None
    identity = lambda s: (s.st_dev, s.st_ino, stat.S_IFMT(s.st_mode))
    try:
        check()
        fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK)
        descriptors.append(fd)
        parts = path.parts[1:] if directory else path.parts[1:-1]
        for part in parts:
            check(); owner = fd
            fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=owner)
            descriptors.append(fd); edges.append((owner, part, fd, identity(os.fstat(fd))))
        if directory:
            seen = os.fstat(fd)
            require(mode is None or stat.S_IMODE(seen.st_mode) == mode, 'physical directory mode differs')
            result = identity(seen)
        else:
            owner = fd
            leaf = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=owner)
            seen = os.fstat(leaf)
            require(stat.S_ISREG(seen.st_mode) and 0 < seen.st_size <= limit, 'bounded regular physical file required')
            if metadata is not None:
                exact_keys(metadata, {'bytes', 'sha256'}, 'exact file metadata required')
                require(type(metadata['bytes']) is int and metadata['bytes'] == seen.st_size and re.fullmatch('[0-9a-f]{64}', metadata['sha256'] or ''), 'source size/hash metadata differs')
            chunks = []; count = 0
            while True:
                check(); part = os.read(leaf, min(65536, seen.st_size + 1 - count)); check()
                if not part: break
                chunks.append(part); count += len(part)
                require(count <= seen.st_size, 'physical file grew')
            result = b''.join(chunks)
            after = os.fstat(leaf); current = os.stat(path.name, dir_fd=owner, follow_symlinks=False)
            stamp = lambda s: (*identity(s), s.st_size, s.st_mtime_ns, s.st_ctime_ns)
            require(stamp(seen) == stamp(after) == stamp(current), 'physical file changed')
            require(count == seen.st_size, 'short physical read')
            if metadata is not None: require(digest(result) == metadata['sha256'], 'physical source hash differs')
        for owner, part, child, observed in edges:
            check()
            require(identity(os.fstat(child)) == observed == identity(os.stat(part, dir_fd=owner, follow_symlinks=False)), 'physical ancestor changed')
        check(); return result
    finally:
        if leaf is not None: os.close(leaf)
        for fd in reversed(descriptors): os.close(fd)


def admit_job(value, start):
    exact_keys(value, JOB_KEYS, 'exact worker job keys required')
    require(value['kind'] == 'portable-worker-job-v2', 'worker job kind differs')
    require(type(value['job_id']) is str and re.fullmatch('[A-Za-z0-9_-]{1,100}', value['job_id']), 'finite job id required')
    end = value['deadline']
    require(type(end) in (int, float) and math.isfinite(end) and start < end <= start + 600, 'fixed worker deadline required')
    suite = value['suite']; guard = value['guard']
    exact_keys(suite, {'kind', 'tree_tag', 'relative', 'classes', 'expected_ids', 'id_map'}, 'exact suite keys required')
    require(suite['kind'] in KINDS, 'unknown suite route')
    if suite['kind'] == 'historical_boundary':
        exact_keys(value['partition'], {'inventory_sha256','all_ids','selected_id','ordinal','partitions'}, 'exact historical partition fields required')
    else:
        require(value['partition'] is None, 'ordinary suites cannot be partitioned')
    relative(suite['relative'])
    classes = suite['classes']; ids = suite['expected_ids']; mapping = suite['id_map']
    require(type(classes) is list and 0 < len(classes) <= 64 and len(set(classes)) == len(classes) and all(type(c) is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', c) for c in classes), 'explicit unique classes required')
    require(type(ids) is list and 0 < len(ids) <= MAX_TESTS and all(type(i) is str and i.startswith(suite['relative'] + '::') and len(i.encode()) <= 512 and not any(ord(c) < 32 or ord(c) == 127 for c in i) for i in ids) and len(set(ids)) == len(ids), 'unique finite stable IDs required')
    require(type(mapping) is dict and len(mapping) == len(ids) and set(mapping.values()) == set(ids), 'bijective stable ID mapping required')
    for key, target in mapping.items():
        require(type(key) is str and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*\.test_[A-Za-z0-9_]+', key) and key.split('.')[0] in classes and target == suite['relative'] + '::' + key, 'exact class/method mapping required')
    require(set(k.split('.')[0] for k in mapping) == set(classes), 'unmapped class refused')
    fixed = {'a2_runtime': (26, ['RuntimeTests', 'TerminalPersistenceTests']), 'a2_session': (48, ['PositiveSessionTests', 'SeedSessionTests']), 'stored_adapter': (25, ['RuntimeTests']), 'portable_fixture': (30, ['PortableFixtureTests']), 'historical_materializer': (22, ['HistoricalTreeTests'])}
    if suite['kind'] in fixed:
        count, names = fixed[suite['kind']]
        require(len(ids) == count and set(classes) == set(names), 'fixed route classes/count differ')
    exact_keys(guard, GUARD_KEYS, 'exact guard config required')
    require(guard['suite_id'] == suite['relative'] and guard['suite_tree_tag'] == suite['tree_tag'], 'suite/guard identity differs')
    require(type(guard['source_trees']) is list and 0 < len(guard['source_trees']) <= 16, 'finite source trees required')
    tags = []
    for tree in guard['source_trees']:
        exact_keys(tree, {'tag', 'root', 'files', 'profile'}, 'exact source tree required')
        require(type(tree['tag']) is str and tree['tag'], 'source tag required'); tags.append(tree['tag']); absolute(tree['root'])
        require(type(tree['files']) is dict, 'explicit source map required')
    require(len(set(tags)) == len(tags) and suite['tree_tag'] in tags, 'unique admitted tree tags required')
    exact_keys(value['implementation'], {'tree_tag', 'files', 'tool_profile'}, 'exact implementation/tool binding required')
    binding = value['implementation']['tool_profile']
    exact_keys(binding, {'profile_path', 'profile_sha256', 'receipt_path', 'receipt_sha256'}, 'exact external tool profile binding required')
    for name in ('profile', 'receipt'):
        absolute(binding[name + '_path'])
        require(type(binding[name + '_sha256']) is str and re.fullmatch('[0-9a-f]{64}', binding[name + '_sha256']), 'external tool binding hash required')
    require(value['implementation']['tree_tag'] in tags and type(value['implementation']['files']) is dict and 4 <= len(value['implementation']['files']) <= 128, 'finite implementation closure required')
    for name in value['implementation']['files']: relative(name)
    exact_keys(value['output'], {'directory', 'terminal_name', 'guard_name'}, 'exact output binding required')
    absolute(value['output']['directory'])
    require(type(value['output']['terminal_name']) is str and re.fullmatch(r'[A-Za-z0-9_-]{1,100}\.json', value['output']['terminal_name']), 'terminal basename required')
    require(type(value['output']['guard_name']) is str and re.fullmatch(r'[A-Za-z0-9_-]{1,100}\.json', value['output']['guard_name']), 'guard basename required')
    require(value['output']['guard_name'] != value['output']['terminal_name'], 'guard and terminal names collide')
    history = value['historical638']
    require((history is not None) == (suite['kind'] == 'stored_adapter'), 'historical callback only for stored route')
    if history is not None:
        exact_keys(history, {'tree_root', 'repository_root', 'expected_receipt'}, 'exact historical callback config required')
        absolute(history['tree_root']); absolute(history['repository_root']); admit_history(history['expected_receipt'])
        require(guard['historical_route'] is not None, 'historical child route required')
    if suite['kind'] in ('declared_new', 'historical_boundary'):
        require(type(guard['extra_test_inventory']) is dict and set(ids) <= set(guard['extra_test_inventory']), 'new suite must be explicitly inventoried')
    return value


def admit_history(value):
    exact_keys(value, HISTORY, 'historical receipt keys differ')
    for key, expected in HISTORY.items():
        require(type(value[key]) is type(expected) and value[key] == expected, 'historical receipt value differs')
    return value


def load_module(name, path, raw):
    require(name not in sys.modules, 'implementation/module name collision')
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); sys.modules[name] = module
    try: exec(compile(raw, str(path), 'exec'), module.__dict__)
    except BaseException:
        sys.modules.pop(name, None)
        raise
    return module


def implementation(job, check):
    declaration = job['implementation']
    tree = next(t for t in job['guard']['source_trees'] if t['tag'] == declaration['tree_tag'])
    root = absolute(tree['root']); raw = {}; paths = {}
    for name, metadata in declaration['files'].items():
        check(); require(tree['files'].get(name) == metadata, 'implementation not in admitted source tree')
        path = root / relative(name); raw[name] = physical(path, metadata=metadata, check=check); paths[name] = path
    roles = {}
    required = ['worker.py', 'results.py', 'launch_guard.py', 'physical.py', 'guard_report.py', 'tool_admission.py']
    if job['suite']['kind'] == 'stored_adapter': required += ['portable_runtime_adapter.py']
    if job['suite']['kind'] == 'historical_boundary': required += ['historical_partition.py']
    for role in required:
        found = [name for name in paths if Path(name).name == role]
        require(len(found) == 1, 'unique implementation role required: ' + role)
        roles[role] = found[0]
    require(paths[roles['worker.py']] == Path(__file__).absolute(), 'executed worker origin differs')
    require(paths[roles['launch_guard.py']].parent == paths[roles['physical.py']].parent, 'guard sibling closure differs')
    if 'portable_runtime_adapter.py' in roles:
        pin = paths[roles['portable_runtime_adapter.py']].parent / 'source-pins.json'
        require(pin in paths.values(), 'adapter source-pin file absent from closure')
    def load(role, module_name):
        name = roles[role]; check(); result = load_module(module_name, paths[name], raw[name]); check(); return result
    physical_name = roles['physical.py']
    load_module('physical', paths[physical_name], raw[physical_name])
    # Guard uses its separately pinned exact-file sibling bootstrap.
    guard_module = load('launch_guard.py', 'portable_worker_guard')
    result_module = load('results.py', 'portable_worker_results')
    return guard_module, result_module, load, paths, raw


def flatten(suite):
    result = []
    for item in suite:
        if isinstance(item, unittest.TestSuite): result.extend(flatten(item))
        else: result.append(item)
    return result


def collect(job, load, guard, check, *, partition_module=None, admitted_trees=None):
    suite = job['suite']; tree = next(t for t in job['guard']['source_trees'] if t['tag'] == suite['tree_tag'])
    root = absolute(tree['root']); path = root / relative(suite['relative'])
    require(suite['relative'] in tree['files'], 'suite source absent from admission')
    check(); raw = physical(path, metadata=tree['files'][suite['relative']], check=check)
    args = None
    if suite['kind'] == 'historical_boundary':
        require(partition_module is not None and admitted_trees is not None, 'admitted historical partition helper/context required')
        binding = partition_module.source_bindings(job, check)
        spec_name = binding['spec_relative']
        spec_raw = physical(root / relative(spec_name), metadata=tree['files'][spec_name], check=check)
        args = partition_module.context_arguments(job, admitted_trees, spec_raw, check)
        # Physical ancestry, not merely lexical spelling, must keep evidence external.
        for ancestor in (args['evidence_parent'], *args['evidence_parent'].parents):
            check(); require(physical(ancestor, directory=True, check=check)[:2] != args['root_identity'], 'evidence physically inside historical tree')
    sys.path.insert(0, str(path.parent))
    aliases = {}
    if suite['kind'] == 'stored_adapter':
        adapter = load('portable_runtime_adapter.py', 'portable_worker_stored_adapter')
        def historical_callback():
            check(); h = job['historical638']; route = job['guard']['historical_route']
            wt = next(t for t in job['guard']['source_trees'] if t['tag'] == route['worker_tree_tag'])
            worker = absolute(wt['root']) / relative(route['worker_relative'])
            physical(worker, metadata=wt['files'][route['worker_relative']], check=check)
            argv = [job['guard']['tools']['python']['path'], '-I', '-B', str(worker), '--repository-root', h['repository_root'], '--tree-root', h['tree_root']]
            value = subprocess.run(argv, cwd=job['guard']['worker_cwd'], env=job['guard']['clean_env'], capture_output=True, text=False, timeout=min(90, check()), check=False)
            check(); require(value.returncode == 0 and value.stderr == b'', 'historical assertion child failed')
            return admit_history(strict_json(value.stdout))
        cls = adapter.build_case(root, historical_callback)
        classes = [cls]; aliases[cls] = 'RuntimeTests'
    else:
        module = load_module('portable_worker_target', path, raw)
        if suite['kind'] == 'historical_boundary':
            context = module.Context(**args)
            cls = module.build_case(context)
            require(isinstance(cls, type) and issubclass(cls, unittest.TestCase) and cls.__name__ == 'HistoricalBoundaryTests', 'fixed boundary factory class required')
            classes = [cls]; aliases[cls] = 'HistoricalBoundaryTests'
        elif suite['kind'] == 'portable_fixture':
            require(getattr(module, 'ROOT', 'missing') is None, 'portable fixture explicit root contract differs')
            module.ROOT = root  # New reviewed harness API only; no old target mutation.
        if suite['kind'] != 'historical_boundary':
            classes = []
            for name in suite['classes']:
                cls = getattr(module, name, None)
                require(isinstance(cls, type) and issubclass(cls, unittest.TestCase) and cls.__name__ == name, 'explicit test class required')
                classes.append(cls); aliases[cls] = name
    tests = []
    for cls in classes:
        check(); tests.extend(flatten(unittest.defaultTestLoader.loadTestsFromTestCase(cls)))
    def stable_id(test):
        cls = type(test)
        if cls not in aliases:
            # Unittest class-fixture _ErrorHolder is deliberately unexpected;
            # result records errors, zero coverage and cannot become success.
            return suite['relative'] + '::fixture_error.' + str(test.id())[:200]
        name = aliases[cls] + '.' + test._testMethodName
        require(name in suite['id_map'], 'unmapped test method')
        return suite['id_map'][name]
    actual = [stable_id(test) for test in tests]
    require(len(actual) == len(suite['id_map']) and len(set(actual)) == len(actual) and set(actual) == set(suite['expected_ids']), 'exact collected coverage differs')
    check(); return unittest.TestSuite(tests), stable_id, actual


def execute(job, *, job_sha256):
    require(type(job_sha256) is str and re.fullmatch('[0-9a-f]{64}', job_sha256), 'verified raw job SHA required')
    end = job['deadline']
    def check():
        remaining = end - time.monotonic()
        if remaining <= 0: raise TimeoutError('fixed worker deadline exhausted')
        return remaining
    check(); output = absolute(job['output']['directory']); output_identity = physical(output, directory=True, mode=0o700, check=check)
    terminal = output / job['output']['terminal_name']; guard_path = output / job['output']['guard_name']
    require(not os.path.lexists(terminal) and not os.path.lexists(guard_path), 'paired outputs must be new')
    guard_module, results, load, paths, raw = implementation(job, check)
    pairs = load('guard_report.py', 'portable_worker_guard_report'); check()
    # The parent checks the complete startup closure BEFORE this process starts.
    # Independently bind this copied interpreter and parser origin before targets.
    tool_admission = load('tool_admission.py', 'portable_worker_tool_admission')
    tool_admission.assert_worker_tools(job['implementation']['tool_profile'], deadline=end, check=check)
    check()
    stage = 'guard-admission'; installed = False; guard = None; context = None
    partition_module = None
    try:
        if job['suite']['kind'] == 'historical_boundary':
            partition_module = load('historical_partition.py', 'portable_worker_historical_partition')
            partition_module.source_bindings(job, check)
        check(); config = guard_module.admit_config(**job['guard']); check()
        declared = {identifier for identifier in config.inventory if identifier.startswith(job['suite']['relative'] + '::')}
        require(declared == set(job['suite']['expected_ids']), 'job omits or adds admitted suite IDs')
        context = pairs.expected_context(job, job_sha256, config.routes, config.historical_route, check, partition_module=partition_module)
        guard = guard_module.Guard(config); guard.install(); installed = True; check()
        original_mkdtemp = tempfile.mkdtemp
        def owned_mkdtemp(*args, **kwargs):
            check(); path = Path(original_mkdtemp(*args, **kwargs)).resolve()
            physical(path, directory=True, mode=0o700, check=check)
            guard.register_owned_directory(str(path)); check(); return str(path)
        tempfile.mkdtemp = owned_mkdtemp
        if job['historical638'] is not None:
            guard.register_owned_directory(job['historical638']['tree_root'])
        stage = 'collection'
        suite, stable_id, actual = collect(job, load, guard, check, partition_module=partition_module, admitted_trees=config.trees if partition_module is not None else None)
        results.validate_collection(actual, job['suite']['expected_ids']); check()
        execution_ids = context['expected_ids']
        if partition_module is not None:
            # Full eight-class coverage has already been checked; no arbitrary subset route.
            require(execution_ids == partition_module.execution_ids(job, check), 'fixed execution coverage differs')
            selected = [test for test in flatten(suite) if stable_id(test) == execution_ids[0]]
            require(len(selected) == 1, 'exact selected historical test required')
            suite = unittest.TestSuite(selected)
        else:
            require(execution_ids == job['suite']['expected_ids'], 'ordinary execution coverage differs')
        class TimedGuard:
            def begin_test(self, identifier): check(); guard.begin_test(identifier); check()
            def end_test(self): guard.end_test(); check()
            def assert_clean(self): guard.assert_clean(); check()
        stage = 'tests'
        resultclass = results.make_result_class(execution_ids, stable_id, TimedGuard())
        result = unittest.TextTestRunner(verbosity=2, resultclass=resultclass).run(suite)
        check(); payload = result.receipt(); check()
        stage = 'source-preservation'
        for tree in job['guard']['source_trees']:
            for name, metadata in tree['files'].items():
                check(); physical(absolute(tree['root']) / relative(name), metadata=metadata, limit=128*1024*1024, check=check)
        check()
        stage = 'guard-report'
        require(physical(output, directory=True, mode=0o700, check=check) == output_identity, 'output directory identity changed')
        success = payload['passed'] is True
        if success: guard.assert_clean(); check()
        snapshot = guard.snapshot_report(); check()
        evidence = pairs.envelope(context, snapshot, status='complete' if success else 'diagnostic')
        if success: pairs.validate_guard(evidence, context, check)
        saved = results.write_terminal(guard_path, evidence, check); check()
        require(type(saved) is dict and saved.keys() == {'bytes', 'sha256'}, 'exact guard persistence receipt required')
        require(type(saved['bytes']) is int and 0 < saved['bytes'] <= MAX_BYTES and type(saved['sha256']) is str and re.fullmatch('[0-9a-f]{64}', saved['sha256']), 'guard persistence receipt differs')
        stage = 'terminal'
        require(physical(output, directory=True, mode=0o700, check=check) == output_identity, 'output directory identity changed')
        if success: guard.assert_clean(); check()
        paired = {'kind': 'portable-worker-terminal-v2', 'job_id': job['job_id'], 'job_sha256': job_sha256,
                  'guard_report_sha256': saved['sha256'], 'guard_report_bytes': saved['bytes'], 'result': payload}
        results.write_terminal(terminal, paired, check); check()
        require(physical(output, directory=True, mode=0o700, check=check) == output_identity, 'output directory identity changed')
        if success:
            guard.assert_clean(); check()
            final_snapshot = guard.snapshot_report(); check()
            require(pairs.canonical(final_snapshot) == pairs.canonical(snapshot), 'guard snapshot changed after persistence')
        check()
        return 0 if success else 1
    except BaseException as error:
        # Pre-test/import/collection errors have no fabricated coverage receipt.
        # A late/failed success write remains non-authoritative because exit!=0.
        payload = {'kind': 'portable-worker-failure-v2', 'passed': False,
                   'job_id': job['job_id'], 'job_sha256': job_sha256, 'stage': stage, 'error_type': type(error).__name__}
        try:
            require(physical(output, directory=True, mode=0o700, check=check) == output_identity, 'terminal directory identity changed')
            if guard is not None and context is not None and not os.path.lexists(guard_path):
                diagnostic = pairs.envelope(context, guard.snapshot_report(), status='diagnostic'); check()
                results.write_terminal(guard_path, diagnostic, check); check()
            if not os.path.lexists(terminal): results.write_terminal(terminal, payload, check); check()
        except BaseException:
            pass
        sys.stderr.write('Portable worker failed at ' + stage + ': ' + type(error).__name__ + '\n')
        return 1
    # Installed audit hooks are permanent. Production caller exits immediately;
    # there is deliberately no uninstall or clearing of denials/owned evidence.


def main(argv=None):
    start = time.monotonic()
    require(__debug__ and sys.flags.optimize == 0 and sys.dont_write_bytecode, 'assertions enabled and bytecode disabled required')
    argv = sys.argv[1:] if argv is None else argv
    require(type(argv) is list and len(argv) == 4 and argv[0] == '--job' and argv[2] == '--job-sha256', 'exact worker CLI required')
    require(type(argv[3]) is str and re.fullmatch('[0-9a-f]{64}', argv[3]), 'job SHA256 required')
    raw = physical(absolute(argv[1])); require(digest(raw) == argv[3], 'job digest differs')
    job = admit_job(strict_json(raw), start)
    return execute(job, job_sha256=digest(raw))


if __name__ == '__main__':
    try: code = main()
    except BaseException as error:
        sys.stderr.write('Portable worker refused: ' + type(error).__name__ + '\n'); code = 1
    raise SystemExit(code)
