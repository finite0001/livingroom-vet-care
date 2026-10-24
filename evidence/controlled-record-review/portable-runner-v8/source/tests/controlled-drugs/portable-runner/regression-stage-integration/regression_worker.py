"""Fixed exact-class regression worker; no production guard is installed here."""
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import sys
import time
import unittest

_CLOCK = time.monotonic
_SHA256 = hashlib.sha256


def bootstrap(job_path, wanted):
    if not re.fullmatch('[0-9a-f]{64}', wanted):
        raise ValueError('exact job digest required')
    path = Path(job_path)
    if not path.is_absolute() or '..' in path.parts or str(path) != job_path:
        raise ValueError('physical job path required')
    current, handles = '/', []
    try:
        handles.append(os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW))
        for component in path.parts[1:-1]:
            handles.append(os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=handles[-1]))
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=handles[-1]); handles.append(fd)
        before = os.fstat(fd)
        import stat
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_uid != os.getuid() or stat.S_IMODE(before.st_mode) != 0o600 or not 0 < before.st_size <= 4*1024*1024:
            raise ValueError('bounded private job required')
        parts, count = [], 0
        while True:
            part = os.read(fd, min(65536, before.st_size + 1-count))
            if not part:
                break
            parts.append(part); count += len(part)
            if count > before.st_size:
                raise ValueError('job grew')
        raw = b''.join(parts)
        if count != before.st_size or _SHA256(raw).hexdigest() != wanted:
            raise ValueError('job differs')
        def pairs(items):
            result = {}
            for key, value in items:
                if key in result:
                    raise ValueError('duplicate job key')
                result[key] = value
            return result
        job = json.loads(raw.decode('utf-8', 'strict'), object_pairs_hook=pairs)
        deadline = job['deadline']
        if type(deadline) not in (int, float) or not math.isfinite(deadline) or not _CLOCK() < deadline <= _CLOCK() + 600:
            raise ValueError('original finite regression deadline required')
        def check():
            if _CLOCK() >= deadline:
                raise TimeoutError('original regression deadline exhausted')
        # Bootstrap admits core with the same physical reader before executing it.
        core = job['implementation']['core']
        if set(core) != {'path', 'bytes', 'sha256'}:
            raise ValueError('exact core source record required')
        core_path = Path(core['path'])
        if not core_path.is_absolute() or '..' in core_path.parts or str(core_path) != core['path']:
            raise ValueError('physical core path required')
        fd_core = None
        chain = [os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)]
        try:
            for part in core_path.parts[1:-1]:
                chain.append(os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=chain[-1]))
            fd_core = os.open(core_path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=chain[-1])
            info = os.fstat(fd_core)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or type(core['bytes']) is not int or not 0 < core['bytes'] == info.st_size <= 4*1024*1024:
                raise ValueError('bounded physical core required')
            chunks, count = [], 0
            while True:
                check(); chunk = os.read(fd_core, min(65536, info.st_size + 1-count)); check()
                if not chunk:
                    break
                chunks.append(chunk); count += len(chunk)
                if count > info.st_size:
                    raise ValueError('core grew')
            core_raw = b''.join(chunks)
            if count != info.st_size or _SHA256(core_raw).hexdigest() != core['sha256']:
                raise ValueError('core source differs')
        finally:
            for opened in ([fd_core] if fd_core is not None else []) + list(reversed(chain)):
                os.close(opened)
        module = load('portable_regression_core', core_path, core_raw)
        module.read_source(core, check)
        return raw, job, module, check
    finally:
        for fd in reversed(handles):
            os.close(fd)


def load(name, path, raw):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    exec(compile(raw, str(path), 'exec', dont_inherit=True, optimize=0), module.__dict__)
    return module


def collect(module, suite, result_module, require):
    """Collect all declared local classes, never an arbitrary selected subset."""
    actual = {name for name, value in vars(module).items() if isinstance(value, type)
              and issubclass(value, unittest.TestCase) and value.__module__ == module.__name__}
    require(actual == set(suite['classes']), 'complete local TestCase class inventory differs')
    classes, tests = {}, []
    for name, methods in suite['classes'].items():
        case = getattr(module, name, None)
        require(isinstance(case, type) and issubclass(case, unittest.TestCase) and case.__module__ == module.__name__, 'declared local TestCase required')
        require(unittest.defaultTestLoader.getTestCaseNames(case) == sorted(methods), 'actual complete class collection differs')
        classes[case] = name
        tests.extend(case(method) for method in methods)
    def stable_id(test):
        require(type(test) in classes and test._testMethodName in suite['classes'][classes[type(test)]], 'foreign regression test encountered')
        return suite['logical_id_path']+'::'+classes[type(test)]+'.'+test._testMethodName
    result_module.validate_collection([stable_id(test) for test in tests], suite['expected_ids'])
    return tests, stable_id


class LaunchAudit:
    """Separate finite regression audit, deliberately not the production guard."""
    def __init__(self, check):
        self.check = check
        self.active = None
        self.denials = 0
        self.launches = []
        self.counts = {}
        self.policy = None
        self.routes = {}
        self.installed = False
        self._probe = object()

    def install(self):
        if self.installed:
            raise ValueError('regression audit already installed')
        sys.addaudithook(self.audit)
        sys.audit('lrv.regression.audit_probe.v1', self._probe)
        if not self.installed:
            raise ValueError('regression audit insertion was not observed')

    def begin_test(self, identifier):
        self.check()
        if self.active is not None:
            raise ValueError('overlapping regression test')
        self.active = identifier

    def end_test(self):
        self.check()
        if self.active is None:
            raise ValueError('missing active regression test')
        self.active = None

    def assert_clean(self):
        self.check()
        if not self.installed or self.denials or self.active is not None:
            raise ValueError('regression launch audit is not clean')

    def deny(self):
        self.denials += 1
        raise PermissionError('undeclared regression process or network operation')

    def audit(self, event, arguments):
        if event == 'lrv.regression.audit_probe.v1':
            if arguments != (self._probe,):
                self.deny()
            self.installed = True
            return
        if event.startswith('socket.') or event in ('os.system', 'os.fork', 'os.forkpty', 'os.exec', 'os.spawn', 'os.posix_spawn', 'pty.spawn'):
            self.deny()
        if event != 'subprocess.Popen':
            return
        self.check()
        if self.active is None or self.policy is None:
            self.deny()
        try:
            route = self.policy(arguments, self.active)
            cap = self.routes[self.active][route]
            if type(route) is not str or type(cap) is not int or not 1 <= cap <= 256:
                self.deny()
            key = self.active, route
            ordinal = self.counts.get(key, 0) + 1
            if ordinal > cap or len(self.launches) >= 256:
                self.deny()
            self.check()
            self.counts[key] = ordinal
            self.launches.append(dict(test_id=self.active, route=route, ordinal=ordinal))
        except BaseException:
            self.denials += 1
            raise

    def snapshot(self):
        self.assert_clean()
        return dict(kind='independent-regression-launch-audit-v1', installed=self.installed, active_test=None,
            denials=self.denials, launches=list(self.launches), universal_descendant_containment=False)


def run(job_path, wanted):
    raw, job, c, check = bootstrap(job_path, wanted)
    c.require(type(job) is dict and job.keys() == c.JOB_KEYS and job['kind'] == 'portable-regression-job-v1'
            and type(job['job_id']) is str and re.fullmatch('[A-Za-z0-9_-]{1,100}', job['job_id']), 'exact regression job required')
    implementation = job['implementation']
    c.require(type(implementation) is dict and implementation.keys() == {'core', 'results', 'worker'}, 'fixed implementation roles required')
    c.require(implementation['worker']['path'] == str(Path(__file__).absolute()), 'actual worker role differs')
    c.read_source(implementation['worker'], check)
    results_raw = c.read_source(implementation['results'], check)
    result_module = load('portable_regression_results', implementation['results']['path'], results_raw)
    suite = job['suite']
    c.require(type(suite) is dict and suite.keys() == {'source', 'logical_id_path', 'classes', 'expected_ids', 'classification', 'child_policy'}, 'exact regression suite required')
    logical = suite['logical_id_path']
    c.require(type(logical) is str and logical.startswith('implementation-regressions/') and '..' not in Path(logical).parts,
              'literal regression namespace required')
    c.require(type(suite['classes']) is dict and 0 < len(suite['classes']) <= 64, 'fixed exact classes required')
    expected = []
    for name, methods in suite['classes'].items():
        c.require(type(name) is str and re.fullmatch('[A-Za-z][A-Za-z0-9_]*', name)
                and type(methods) is list and methods and len(set(methods)) == len(methods)
                and all(type(m) is str and re.fullmatch('test[A-Za-z0-9_]*', m) for m in methods), 'literal exact class methods required')
        expected.extend(logical+'::'+name+'.'+method for method in methods)
    c.require(suite['expected_ids'] == expected, 'class and stable ID declarations differ')
    result_module.validate_collection(expected, expected)
    c.require(type(job['import_roots']) is list and len(job['import_roots']) <= 8
              and len(set(job['import_roots'])) == len(job['import_roots']), 'finite explicit import roots required')
    for path in job['import_roots']:
        c.physical_path(path)
        handles = [os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)]
        try:
            for part in Path(path).parts[1:]:
                check(); handles.append(os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=handles[-1]))
        finally:
            for fd in reversed(handles):
                os.close(fd)
    sys.path[:0] = job['import_roots']
    audit = LaunchAudit(check)
    audit.install()
    if suite['classification'] == 'process_free':
        c.require(suite['child_policy'] is None, 'process-free suite cannot declare children')
    else:
        c.require(suite['classification'] in ('finite_inert_child', 'finite_historical_profile_child'), 'known regression classification required')
        declaration = suite['child_policy']
        c.require(type(declaration) is dict and declaration.keys() == {'source', 'profile', 'scratch_root', 'repository_root', 'routes'}, 'exact finite child policy required')
        policy_raw = c.read_source(declaration['source'], check)
        policy_module = load('portable_regression_finite_children', declaration['source']['path'], policy_raw)
        audit.routes, audit.policy = policy_module.build(job, read_source=lambda record: c.read_source(record, check),
            python=str(Path(sys.executable).absolute()), environment=dict(os.environ), check=check)
        c.require(audit.routes == declaration['routes'], 'literal child route inventory differs')
    source_raw = c.read_source(suite['source'], check)
    module = load('portable_regression_target_'+job['job_id'].replace('-', '_'), suite['source']['path'], source_raw)
    tests, stable_id = collect(module, suite, result_module, c.require)
    result_class = result_module.make_result_class(expected, stable_id, audit)
    outcome = unittest.TextTestRunner(stream=sys.stderr, verbosity=2, resultclass=result_class).run(unittest.TestSuite(tests))
    check()
    payload = dict(kind='portable-regression-terminal-v1', job_id=job['job_id'], job_sha256=c.digest(raw),
        suite_sha256=suite['source']['sha256'], result=outcome.receipt(), launch_audit=audit.snapshot(), production_guard_installed=False)
    output = job['output']
    c.require(type(output) is dict and output.keys() == {'directory', 'terminal_name'} and output['terminal_name'] == 'result.json', 'fixed result output required')
    c.physical_path(output['directory'])
    result_module.write_terminal(str(Path(output['directory'])/'result.json'), payload, check)
    c.validate_terminal(c.canonical(payload), expected, process_returncode=0, job_id=job['job_id'],
        job_sha256=c.digest(raw), suite_sha256=suite['source']['sha256'], permitted_routes=audit.routes, validate_result=result_module.validate_terminal)
    check()
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 5 or sys.argv[1] != '--job' or sys.argv[3] != '--job-sha256':
        raise SystemExit('exact --job/--job-sha256 invocation required')
    raise SystemExit(run(sys.argv[2], sys.argv[4]))
