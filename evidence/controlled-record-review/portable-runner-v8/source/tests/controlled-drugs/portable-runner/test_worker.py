"""Small inert worker boundary tests; no reviewed target suite or child execution."""
from copy import deepcopy
from contextlib import ExitStack
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('worker_boundary_under_test', HERE/'worker.py')
w = importlib.util.module_from_spec(spec); spec.loader.exec_module(w)
spec = importlib.util.spec_from_file_location('worker_actual_results', HERE/'results.py')
results = importlib.util.module_from_spec(spec); spec.loader.exec_module(results)
spec = importlib.util.spec_from_file_location('worker_actual_guard_report', HERE/'guard_report.py')
pairs = importlib.util.module_from_spec(spec); spec.loader.exec_module(pairs)
RETAINED = []


def metadata(data): return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='portable-worker-v2-unit-')).resolve()
        RETAINED.append(str(self.root))
        self.output = self.root/'out'; self.output.mkdir(mode=0o700)
        self.source = self.root/'test_toy.py'
        self.raw = b'import unittest\nclass ToyTests(unittest.TestCase):\n def test_one(self): pass\n'
        self.source.write_bytes(self.raw)
        self.identifier = 'test_toy.py::ToyTests.test_one'
        self.job = {
            'kind': 'portable-worker-job-v2', 'job_id': 'unit', 'deadline': time.monotonic()+100,
            'suite': {'kind': 'declared_new', 'tree_tag': 'toy', 'relative': 'test_toy.py', 'classes': ['ToyTests'], 'expected_ids': [self.identifier], 'id_map': {'ToyTests.test_one': self.identifier}},
            'guard': {'contract_root': str(self.root), 'source_trees': [{'tag': 'toy', 'root': str(self.root), 'files': {'test_toy.py': metadata(self.raw)}, 'profile': 'inert-unit-only'}], 'tools': {}, 'clean_env': {}, 'worker_cwd': str(self.root), 'suite_id': 'test_toy.py', 'suite_tree_tag': 'toy', 'extra_test_inventory': {self.identifier: {'source': 'test_toy.py', 'sha256': metadata(self.raw)['sha256']}}, 'historical_templates': None, 'historical_route': None},
            'implementation': {'tree_tag': 'toy', 'files': {name: metadata(b'pass\n') for name in ('worker.py', 'results.py', 'guard/launch_guard.py', 'guard/physical.py', 'guard_report.py')}},
            'output': {'directory': str(self.output), 'terminal_name': 'result.json', 'guard_name': 'guard.json'}, 'historical638': None, 'partition': None,
        }
        self.saved_modules = set(sys.modules)
        self.saved_path = list(sys.path)
        self.saved_mkdtemp = tempfile.mkdtemp

    def tearDown(self):
        tempfile.mkdtemp = self.saved_mkdtemp
        sys.path[:] = self.saved_path
        for name in set(sys.modules)-self.saved_modules:
            if name.startswith('portable_worker_'): sys.modules.pop(name, None)
        # All v2 source/output fixture bytes remain retained; no cleanup here.

    def rewrite(self, raw):
        self.raw = raw.encode(); self.source.write_bytes(self.raw)
        self.job['guard']['source_trees'][0]['files']['test_toy.py'] = metadata(self.raw)
        self.job['guard']['extra_test_inventory'][self.identifier]['sha256'] = metadata(self.raw)['sha256']

    def fake_guard(self, *, omitted=False):
        events = []
        inventory = {} if omitted else {identifier: {} for identifier in self.job['suite']['expected_ids']}
        class Guard:
            def __init__(self, config): self.active = None; self.denied = False; self.seen=set(); self.installed=False; self.owned=0
            def install(self): self.installed=True;events.append('installed')
            def register_owned_directory(self, path):
                assert Path(path).is_absolute() and Path(path).stat().st_mode & 0o777 == 0o700
                self.owned+=1;events.append(('owned', path, self.active))
            def begin_test(self, identifier):
                assert self.active is None; self.active = identifier; self.seen.add(identifier); events.append(('begin', identifier))
            def end_test(self): self.active = None; events.append('end')
            def assert_clean(self):
                assert self.active is None
                if self.denied: raise PermissionError('sticky toy denial')
            def snapshot_report(self):
                return {'kind':'finite-offline-worker-guard-report-v1','suite_id':'test_toy.py','contract_sha256':pairs.CONTRACT_SHA,
                    'installed':self.installed,'test_ids':sorted(self.seen),'active_test':self.active,'launches':[],
                    'denial_count':int(self.denied),'denials':[],'owned_directories':self.owned,
                    'pending_node_permit':False,'universal_descendant_containment':False}
        return SimpleNamespace(admit_config=lambda **kw: SimpleNamespace(inventory=inventory,routes=[],historical_route=None), Guard=Guard), events

    def execute(self, *, omitted=False, write=None, alter_guard=None):
        guard, events = self.fake_guard(omitted=omitted)
        if alter_guard is not None: alter_guard(guard)
        original_load = w.load_module
        def loading(*args):
            self.assertIn('installed', events)
            return original_load(*args)
        with ExitStack() as stack:
            stack.enter_context(patch.object(w, 'implementation', return_value=(guard, results, lambda role,name:pairs, {}, {})))
            stack.enter_context(patch.object(w, 'load_module', side_effect=loading))
            stack.enter_context(patch.object(subprocess, 'Popen', side_effect=AssertionError('no unit child')))
            stack.enter_context(patch.object(subprocess, 'run', side_effect=AssertionError('no unit child')))
            stack.enter_context(patch.object(socket, 'socket', side_effect=AssertionError('no unit network')))
            if write is not None: stack.enter_context(patch.object(results, 'write_terminal', side_effect=write))
            self.job_sha = w.digest(json.dumps(self.job).encode())
            code = w.execute(self.job, job_sha256=self.job_sha)
        return code, events

    def test_strict_job_json_rejects_duplicate_nonfinite_type_and_size(self):
        self.assertEqual(w.strict_json(b'{"a":1}'), {'a': 1})
        for raw in (b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":Infinity}', b'\xff', b'', b'{} {}', 'not bytes'):
            with self.subTest(raw=repr(raw)), self.assertRaises((ValueError, UnicodeDecodeError)):
                w.strict_json(raw)
        with self.assertRaises(ValueError): w.strict_json(b' '*(w.MAX_BYTES+1))

    def test_job_keys_deadline_and_identity_fail_closed(self):
        now = time.monotonic(); w.admit_job(self.job, now)
        for value in (True, float('nan'), float('inf'), now-1, now+600.1):
            bad = deepcopy(self.job); bad['deadline'] = value
            with self.subTest(value=value), self.assertRaises(ValueError): w.admit_job(bad, now)
        for key in ('job_id', 'suite', 'implementation'):
            bad = deepcopy(self.job); del bad[key]
            with self.assertRaises(ValueError): w.admit_job(bad, now)
        bad = deepcopy(self.job); bad['extra'] = 1
        with self.assertRaises(ValueError): w.admit_job(bad, now)

    def test_duplicate_ids_mapping_aliases_unknown_routes_and_omitted_class_refuse(self):
        for mutation in ('duplicate', 'alias', 'extra_class', 'route', 'cross_suite', 'new_missing_inventory'):
            bad = deepcopy(self.job)
            if mutation == 'duplicate': bad['suite']['expected_ids'] *= 2
            if mutation == 'alias': bad['suite']['id_map']['ToyTests.test_two'] = self.identifier
            if mutation == 'extra_class': bad['suite']['classes'].append('OtherTests')
            if mutation == 'route': bad['suite']['kind'] = 'discover'
            if mutation == 'cross_suite': bad['guard']['suite_id'] = 'other.py'
            if mutation == 'new_missing_inventory': bad['guard']['extra_test_inventory'] = {}
            with self.subTest(mutation=mutation), self.assertRaises(ValueError): w.admit_job(bad, time.monotonic())

    def test_a2_runtime_requires_both_classes_and_session48_inherited_slots(self):
        for kind, counts in [('a2_runtime', [('RuntimeTests',23),('TerminalPersistenceTests',3)]), ('a2_session', [('PositiveSessionTests',24),('SeedSessionTests',24)])]:
            bad = deepcopy(self.job); suite = bad['suite']; suite['kind'] = kind
            suite['classes'] = [name for name,count in counts]
            suite['id_map'] = {f'{name}.test_{i}': f'test_toy.py::{name}.test_{i}' for name,count in counts for i in range(count)}
            suite['expected_ids'] = list(suite['id_map'].values())
            w.admit_job(bad,time.monotonic())
            suite['classes'] = suite['classes'][:1]
            with self.assertRaises(ValueError): w.admit_job(bad,time.monotonic())

    def test_physical_job_reader_refuses_source_change_symlink_fifo(self):
        self.assertEqual(w.physical(self.source, metadata=metadata(self.raw)), self.raw)
        wrong = metadata(self.raw); wrong['sha256'] = '0'*64
        with self.assertRaises(ValueError): w.physical(self.source, metadata=wrong)
        alias = self.root/'alias'; alias.symlink_to(self.source)
        with self.assertRaises(OSError): w.physical(alias)
        fifo = self.root/'fifo'; os.mkfifo(fifo)
        with self.assertRaises(ValueError): w.physical(fifo)
        parent = self.root/'link'; parent.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(OSError): w.physical(parent/'test_toy.py')

    def test_exact_collection_success_guard_precedes_import_and_terminal_validates(self):
        code, events = self.execute()
        self.assertEqual(code,0)
        context=pairs.expected_context(self.job,self.job_sha,[],None,lambda:None)
        receipt = pairs.validate_pair((self.output/'result.json').read_bytes(),(self.output/'guard.json').read_bytes(),context,process_returncode=code,validate_terminal=results.validate_terminal,check=lambda:None)['result']
        self.assertEqual(receipt['tests_run'],1)
        self.assertEqual(events[0],'installed')
        self.assertIn(('begin',self.identifier),events)

    def test_extra_collected_method_refuses_before_any_test(self):
        self.rewrite('import unittest\nclass ToyTests(unittest.TestCase):\n def test_one(self): pass\n def test_two(self): raise Exception("must not run")\n')
        code, events = self.execute(); self.assertEqual(code,1)
        self.assertFalse(any(isinstance(x,tuple) and x[0]=='begin' for x in events))
        value=json.loads((self.output/'result.json').read_text());self.assertEqual(value['stage'],'collection')

    def test_job_subset_cannot_hide_guard_inventory(self):
        code, events = self.execute(omitted=True); self.assertEqual(code,1)
        self.assertEqual(events,[])
        self.assertEqual(json.loads((self.output/'result.json').read_text())['stage'],'guard-admission')

    def test_skip_and_class_setup_error_never_pass(self):
        for body in ('@unittest.skip("not allowed")\n def test_one(self): pass', '@classmethod\n def setUpClass(cls): raise ValueError("setup failure")\n def test_one(self): pass'):
            with self.subTest(body=body):
                self.rewrite('import unittest\nclass ToyTests(unittest.TestCase):\n '+body+'\n')
                sys.modules.pop('portable_worker_target',None)
                path=self.output/'result.json'
                for leaf in ('result.json','guard.json'):
                    existing=self.output/leaf
                    if existing.exists(): existing.rename(self.output/('retained-'+str(len(list(self.output.iterdir())))+'-'+leaf))
                code,_=self.execute();self.assertEqual(code,1)
                with self.assertRaises(ValueError):results.validate_terminal(path.read_bytes(),[self.identifier],process_returncode=code)

    def test_owned_mkdtemp_registers_suite_and_test_roots(self):
        self.rewrite('import unittest,tempfile\nclass ToyTests(unittest.TestCase):\n @classmethod\n def setUpClass(cls): cls.outer=tempfile.TemporaryDirectory()\n @classmethod\n def tearDownClass(cls): cls.outer.cleanup()\n def test_one(self):\n  with tempfile.TemporaryDirectory(): pass\n')
        code,events=self.execute();self.assertEqual(code,0)
        roots=[item for item in events if isinstance(item,tuple) and item[0]=='owned']
        self.assertEqual(len(roots),2);self.assertIsNone(roots[0][2]);self.assertEqual(roots[1][2],self.identifier)

    def test_terminal_write_then_raise_forces_nonzero_even_if_file_says_pass(self):
        original=results.write_terminal
        def failing(path,payload,check):
            value=original(path,payload,check)
            if path.name=='result.json': raise OSError('unit post-write failure')
            return value
        code,_=self.execute(write=failing);self.assertEqual(code,1)
        self.assertIs(json.loads((self.output/'result.json').read_text())['result']['passed'],True)
        with self.assertRaises(ValueError):results.validate_terminal((self.output/'result.json').read_bytes(),[self.identifier],process_returncode=code)

    def test_late_terminal_write_forces_nonzero_without_deadline_reset(self):
        original=results.write_terminal; end=self.job['deadline'];clock=[end-1]
        def late(path,payload,check):
            value=original(path,payload,check)
            if path.name=='result.json':clock[0]=end+1
            return value
        with patch.object(w.time,'monotonic',side_effect=lambda:clock[0]):
            code,_=self.execute(write=late)
        self.assertEqual(code,1);self.assertEqual(self.job['deadline'],end)

    def test_main_exact_job_hash_and_cli_before_dispatch(self):
        path=self.root/'job.json';raw=json.dumps(self.job).encode();path.write_bytes(raw)
        with patch.object(w,'execute',return_value=0) as execute:
            self.assertEqual(w.main(['--job',str(path),'--job-sha256',w.digest(raw)]),0)
            execute.assert_called_once_with(self.job,job_sha256=w.digest(raw))
        for args in (['--job',str(path),'--job-sha256','0'*64], ['--job',str(path)], ['--job-sha256',w.digest(raw),'--job',str(path)]):
            with patch.object(w,'execute') as execute,self.assertRaises(ValueError):w.main(args)
            execute.assert_not_called()

    def test_current_source_drift_refuses_terminal_success(self):
        self.rewrite('import unittest\nfrom pathlib import Path\nclass ToyTests(unittest.TestCase):\n def test_one(self): Path(__file__).write_text("changed")\n')
        code,_=self.execute();self.assertEqual(code,1)
        value=json.loads((self.output/'result.json').read_text())
        self.assertEqual(value['stage'],'source-preservation');self.assertIs(value['passed'],False)

    def test_implementation_wrong_origin_refuses_before_import(self):
        for name in self.job['implementation']['files']:
            path=self.root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'pass\n')
            self.job['guard']['source_trees'][0]['files'][name]=metadata(b'pass\n')
        with patch.object(w,'load_module',side_effect=AssertionError('must not import')) as load:
            with self.assertRaisesRegex(ValueError,'worker origin'):w.implementation(self.job,lambda:100)
            load.assert_not_called()

    def test_strict_v2_nine_keys_partition_null_and_output_collision(self):
        self.assertEqual(len(w.JOB_KEYS),9)
        for mutate in ('v1','partition','missing_partition','collision','guard_path'):
            job=deepcopy(self.job)
            if mutate=='v1':job['kind']='portable-worker-job-v1'
            elif mutate=='partition':job['partition']={'selected_id':self.identifier}
            elif mutate=='missing_partition':del job['partition']
            elif mutate=='collision':job['output']['guard_name']=job['output']['terminal_name']
            else:job['output']['guard_name']='../guard.json'
            with self.subTest(mutate=mutate),self.assertRaises(ValueError):w.admit_job(job,time.monotonic())

    def test_guard_full_write_then_error_never_publishes_success_terminal(self):
        original=results.write_terminal
        def failing(path,payload,check):
            value=original(path,payload,check)
            if path.name=='guard.json':raise OSError('after complete guard write')
            return value
        code,_=self.execute(write=failing);self.assertEqual(code,1)
        self.assertEqual(json.loads((self.output/'guard.json').read_text())['status'],'complete')
        terminal=json.loads((self.output/'result.json').read_text())
        self.assertEqual(terminal['kind'],'portable-worker-failure-v2');self.assertIs(terminal['passed'],False)

    def test_partial_guard_write_is_retained_and_nonzero(self):
        original=results.write_terminal
        def partial(path,payload,check):
            if path.name=='guard.json':path.write_bytes(b'{"kind":');raise OSError('partial guard')
            return original(path,payload,check)
        code,_=self.execute(write=partial);self.assertEqual(code,1)
        self.assertEqual((self.output/'guard.json').read_bytes(),b'{"kind":')
        self.assertEqual(json.loads((self.output/'result.json').read_text())['stage'],'guard-report')

    def test_partial_terminal_write_is_retained_and_nonzero(self):
        original=results.write_terminal
        def partial(path,payload,check):
            if path.name=='result.json':path.write_bytes(b'{"kind":');raise OSError('partial terminal')
            return original(path,payload,check)
        code,_=self.execute(write=partial);self.assertEqual(code,1)
        self.assertEqual((self.output/'result.json').read_bytes(),b'{"kind":')
        self.assertEqual(json.loads((self.output/'guard.json').read_text())['status'],'complete')

    def test_guard_write_before_terminal_and_snapshot_bytes_exact(self):
        original=results.write_terminal;names=[]
        def recording(path,payload,check):names.append(path.name);return original(path,payload,check)
        code,_=self.execute(write=recording);self.assertEqual(code,0)
        self.assertEqual(names,['guard.json','result.json'])
        raw=(self.output/'guard.json').read_bytes();terminal=json.loads((self.output/'result.json').read_text())
        self.assertEqual(terminal['guard_report_sha256'],w.digest(raw));self.assertEqual(terminal['guard_report_bytes'],len(raw))
        self.assertEqual(json.loads(raw)['report']['test_ids'],[self.identifier])

    def test_late_guard_write_retains_file_without_terminal_success(self):
        original=results.write_terminal;end=self.job['deadline'];clock=[end-1]
        def late(path,payload,check):
            value=original(path,payload,check)
            if path.name=='guard.json':clock[0]=end+1
            return value
        with patch.object(w.time,'monotonic',side_effect=lambda:clock[0]):code,_=self.execute(write=late)
        self.assertEqual(code,1);self.assertTrue((self.output/'guard.json').exists());self.assertFalse((self.output/'result.json').exists())

    def test_final_snapshot_change_after_terminal_forces_nonzero(self):
        def alter(module):
            original=module.Guard.snapshot_report
            def changed(obj):
                value=original(obj)
                if (self.output/'result.json').exists():value['owned_directories']=True
                return value
            module.Guard.snapshot_report=changed
        code,_=self.execute(alter_guard=alter);self.assertEqual(code,1)
        self.assertTrue(json.loads((self.output/'result.json').read_text())['result']['passed'])

    def test_swallowed_late_guard_denial_after_report_forces_nonzero(self):
        def alter(module):
            original=module.Guard.assert_clean
            def late(obj):
                if (self.output/'guard.json').exists():obj.denied=True
                return original(obj)
            module.Guard.assert_clean=late
        code,_=self.execute(alter_guard=alter);self.assertEqual(code,1)
        terminal=json.loads((self.output/'result.json').read_text());self.assertIs(terminal['passed'],False)

    def test_final_snapshot_deadline_check_follows_comparison(self):
        end=self.job['deadline'];clock=[end-1]
        def alter(module):
            original=module.Guard.snapshot_report
            def late(obj):
                value=original(obj)
                if (self.output/'result.json').exists():clock[0]=end+1
                return value
            module.Guard.snapshot_report=late
        with patch.object(w.time,'monotonic',side_effect=lambda:clock[0]):code,_=self.execute(alter_guard=alter)
        self.assertEqual(code,1);self.assertEqual(self.job['deadline'],end)

    def test_missing_guard_object_has_no_fabricated_diagnostic(self):
        code,_=self.execute(omitted=True);self.assertEqual(code,1)
        self.assertFalse((self.output/'guard.json').exists())

    def test_uninstalled_clean_guard_never_passes(self):
        def alter(module):
            original=module.Guard.install
            def uninstalled(obj):original(obj);obj.installed=False
            module.Guard.install=uninstalled
        code,_=self.execute(alter_guard=alter);self.assertEqual(code,1)
        self.assertEqual(json.loads((self.output/'result.json').read_text())['stage'],'guard-report')
        # Even though assert_clean permits this synthetic uninstalled object,
        # explicit success-report admission refuses installed:false.
        self.assertIs(json.loads((self.output/'guard.json').read_text())['report']['installed'],False)
        self.assertEqual(json.loads((self.output/'guard.json').read_text())['status'],'diagnostic')

    def test_historical_receipt_exact_type_keys_and_value(self):
        w.admit_history(deepcopy(w.HISTORY))
        for name,value in w.HISTORY.items():
            bad=deepcopy(w.HISTORY);bad[name]=1 if type(value)is bool else None
            with self.subTest(name=name),self.assertRaises(ValueError):w.admit_history(bad)
        with self.assertRaises(ValueError):w.admit_history({'historical_gate_passed':True})


class HistoricalWorkerTests(unittest.TestCase):
    """Actual worker orchestration with inert factory/guard and no historical IO."""
    def setUp(self):
        spec=importlib.util.spec_from_file_location('partition_worker_fixtures',HERE/'test_historical_partition.py')
        self.f=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.f);self.hp=self.f.hp
        self.job=self.f.fixed_job(6)
        self.root=Path(tempfile.mkdtemp(prefix='portable-worker-v3-partition-unit-')).resolve();RETAINED.append(str(self.root))
        self.job['output']['directory']=str(self.root)
        self.saved_path=list(sys.path);self.saved_mkdtemp=tempfile.mkdtemp
        self.ran=[];self.contexts=[];self.events=[];self.drop=None;self.add=False
    def tearDown(self):
        sys.path[:]=self.saved_path;tempfile.mkdtemp=self.saved_mkdtemp
    def fake_physical(self,path,*,directory=False,metadata=None,**kwargs):
        if directory:
            st=Path(path).stat();return (st.st_dev,st.st_ino,0o040000)
        if str(path).endswith('/boundary-spec.json'):return self.f.SPEC_RAW
        return b'inert source admission seam'
    def factory_module(self,*unused):
        self.events.append('factory_import')
        def build_case(context):
            self.contexts.append(context);methods={}
            for short in self.hp.SHORT_IDS:
                name=short.split('.',1)[1]
                if name==self.drop:continue
                def test(obj,selected=short):self.ran.append(selected)
                methods[name]=test
            if self.add:methods['test_undeclared']=lambda obj:None
            return type('HistoricalBoundaryTests',(unittest.TestCase,),methods)
        return SimpleNamespace(Context=lambda **args:SimpleNamespace(**args),build_case=build_case)
    def guard_module(self,omit=False):
        owner=self
        inventory={identifier:{} for identifier in self.hp.ALL_IDS}
        if omit:inventory.pop(self.hp.ALL_IDS[0])
        config=SimpleNamespace(inventory=inventory,routes=[],historical_route=None,trees=self.f.admitted(self.job))
        class Guard:
            def __init__(self,c):self.active=None;self.seen=set();self.installed=False
            def install(self):self.installed=True;owner.events.append('installed')
            def begin_test(self,i):self.active=i;self.seen.add(i);owner.events.append(('begin',i))
            def end_test(self):self.active=None
            def assert_clean(self):assert self.active is None
            def register_owned_directory(self,p):pass
            def snapshot_report(self):return {'kind':'finite-offline-worker-guard-report-v1','suite_id':owner.hp.SUITE,'contract_sha256':pairs.CONTRACT_SHA,'installed':self.installed,'test_ids':sorted(self.seen),'active_test':self.active,'launches':[],'denial_count':0,'denials':[],'owned_directories':0,'pending_node_permit':False,'universal_descendant_containment':False}
        return SimpleNamespace(admit_config=lambda **kwargs:config,Guard=Guard),config
    def execute(self,omit=False):
        guard,config=self.guard_module(omit)
        def load(role,name):
            if role=='guard_report.py':return pairs
            if role=='historical_partition.py':return self.hp
            raise AssertionError('undeclared implementation load')
        with ExitStack() as stack:
            stack.enter_context(patch.object(w,'implementation',return_value=(guard,results,load,{},{})))
            stack.enter_context(patch.object(w,'physical',side_effect=self.fake_physical))
            stack.enter_context(patch.object(w,'load_module',side_effect=self.factory_module))
            stack.enter_context(patch.object(subprocess,'Popen',side_effect=AssertionError('no child')))
            stack.enter_context(patch.object(socket,'socket',side_effect=AssertionError('no network')))
            self.job_sha=w.digest(json.dumps(self.job).encode());return w.execute(self.job,job_sha256=self.job_sha)
    def test_fixed_job_admits_exact_shape_but_non_null_ordinary_refuses(self):
        w.admit_job(self.job,time.monotonic())
        for kind in ('original','declared_new'):
            bad=deepcopy(self.job);bad['suite']['kind']=kind
            with self.assertRaises(ValueError):w.admit_job(bad,time.monotonic())
        for value in (None,{},dict(self.job['partition'],extra=1)):
            bad=deepcopy(self.job);bad['partition']=value
            with self.assertRaises(ValueError):w.admit_job(bad,time.monotonic())
    def test_helper_role_missing_or_bad_digest_refuses_before_any_import(self):
        job=deepcopy(self.job)
        paths=['worker.py','results.py','guard/launch_guard.py','guard/physical.py','guard_report.py']
        files={n:metadata((HERE/n).read_bytes())for n in paths}
        job['implementation']={'tree_tag':'implementation','files':files}
        job['guard']['source_trees'].append({'tag':'implementation','root':str(HERE),'profile':'implementation','files':files})
        with patch.object(w,'load_module',side_effect=AssertionError('must not import')):
            with self.assertRaisesRegex(ValueError,'historical_partition.py'):w.implementation(job,lambda:100)
        files['historical_partition.py']=metadata((HERE/'historical_partition.py').read_bytes());files['historical_partition.py']['sha256']='0'*64
        with patch.object(w,'load_module',side_effect=AssertionError('must not import')):
            with self.assertRaisesRegex(ValueError,'source hash'):w.implementation(job,lambda:100)
    def test_full8_collected_before_exact_single_execution_and_pair_one(self):
        self.assertEqual(self.execute(),0)
        self.assertEqual(self.ran,[self.hp.SHORT_IDS[6]])
        self.assertLess(self.events.index('installed'),self.events.index('factory_import'))
        self.assertEqual(self.contexts[0].selected_id,self.hp.SHORT_IDS[6]);self.assertEqual(len(self.contexts[0].baseline_map),669)
        context=pairs.expected_context(self.job,self.job_sha,[],None,lambda:None,partition_module=self.hp)
        pair=pairs.validate_pair((self.root/'terminal.json').read_bytes(),(self.root/'guard.json').read_bytes(),context,process_returncode=0,validate_terminal=results.validate_terminal,check=lambda:None)
        self.assertEqual(pair['result']['tests_run'],1);self.assertEqual(pair['result']['ids'],[self.hp.ALL_IDS[6]])
        self.assertEqual(len(self.job['suite']['expected_ids']),8);self.assertEqual(len(self.job['guard']['extra_test_inventory']),8)
    def test_missing_unselected_method_still_refuses_before_any_execution(self):
        self.drop=self.hp.SHORT_IDS[0].split('.',1)[1]
        self.assertEqual(self.execute(),1);self.assertEqual(self.ran,[])
        self.assertEqual(json.loads((self.root/'terminal.json').read_text())['stage'],'collection')
    def test_extra_method_refuses_full_collection(self):
        self.add=True;self.assertEqual(self.execute(),1);self.assertEqual(self.ran,[])
    def test_guard_inventory_all8_required_even_when_selected_present(self):
        self.assertEqual(self.execute(omit=True),1);self.assertEqual(self.events,[]);self.assertEqual(self.ran,[])
    def test_bad_partition_refuses_before_guard_install_or_factory(self):
        self.job['partition']['ordinal']=0
        self.assertEqual(self.execute(),1);self.assertEqual(self.events,[]);self.assertEqual(self.ran,[])
    def test_current_map_mutation_refuses_context_before_factory_import(self):
        name=next(iter(self.f.SPEC['current656']));self.job['guard']['source_trees'][0]['files'][name]['bytes']+=1
        self.assertEqual(self.execute(),1);self.assertEqual(self.contexts,[]);self.assertNotIn('factory_import',self.events);self.assertEqual(self.ran,[])
    def test_missing_admitted_helper_or_context_refuses_before_factory_import(self):
        with patch.object(w,'physical',side_effect=self.fake_physical),patch.object(w,'load_module',side_effect=self.factory_module):
            with self.assertRaisesRegex(ValueError,'helper/context'):w.collect(self.job,lambda *a:None,None,lambda:100)
        self.assertEqual(self.events,[])
    def test_evidence_physical_ancestor_collision_refuses_before_factory(self):
        guard,config=self.guard_module();historical=config.trees['historical'].root
        def collision(path,**kwargs):
            if kwargs.get('directory'):return (historical.dev,historical.ino,0o040000)
            return self.fake_physical(path,**kwargs)
        with patch.object(w,'physical',side_effect=collision),patch.object(w,'load_module',side_effect=self.factory_module):
            with self.assertRaisesRegex(ValueError,'physically inside'):w.collect(self.job,lambda *a:None,None,lambda:100,partition_module=self.hp,admitted_trees=config.trees)
        self.assertEqual(self.events,[])


if __name__=='__main__':
    try:unittest.main(verbosity=2)
    finally:print('Retained worker fixtures:',json.dumps(RETAINED),flush=True)
