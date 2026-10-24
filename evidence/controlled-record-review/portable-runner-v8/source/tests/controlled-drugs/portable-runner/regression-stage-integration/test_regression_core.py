"""Process-free tiny physical and accounting controls; no target/network/DB."""
from copy import deepcopy
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); sys.modules[name] = module; spec.loader.exec_module(module)
    return module


c = load('regression_core_under_test', HERE/'regression_core.py')
w = load('regression_worker_under_test', HERE/'regression_worker.py')
f = load('regression_finite_children_under_test', HERE/'finite_children.py')
r = load('regression_original_results', HERE.parent/'results.py')
ID = 'implementation-regressions/test_tiny.py::Tiny.test_one'


class RegressionCoreTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='lrv-regression-core-')).resolve(); self.root.chmod(0o700)
        self.deadline = time.monotonic()+30
        self.observers = []

    def tearDown(self):
        for observer in self.observers:
            if not observer.closed: observer.close()

    def observer(self, **kwargs):
        args = dict(deadline=self.deadline, check=lambda: None); args.update(kwargs)
        value = c.HeldFour(str(self.root), **args); self.observers.append(value); return value

    def write(self, name, raw):
        fd = os.open(self.root/name, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
        try: self.assertEqual(os.write(fd, raw), len(raw))
        finally: os.close(fd)

    def fill(self):
        for name in c.SLOTS: self.write(c.NAMES[name], b'' if name in ('stdout', 'stderr') else b'{}')

    def accounting(self, **kwargs):
        args = dict(guarded_jobs={'guarded': ['test_guarded.py::Original.test_one']}, source_copy_bytes=100,
                    historical_peak_bytes=c.MAX_HISTORICAL_BYTES, read_available=lambda: 20*c.GIB)
        args.update(kwargs)
        return c.RegressionAccounting({'regression': [ID]}, **args)

    def terminal(self):
        result = dict(kind='portable-unittest-terminal-v1', passed=True, ids=[ID], expected_count=1,
            expected_ids_sha256=r._digest([ID]), tests_run=1, started=[0], stopped=[0], succeeded=[0],
            problems={name: [] for name in r.CATEGORIES}, guard_clean=True, guard_errors=0, protocol_errors=0)
        return dict(kind='portable-regression-terminal-v1', job_id='regression', job_sha256='1'*64, suite_sha256='2'*64,
            result=result, production_guard_installed=False, launch_audit=dict(kind='independent-regression-launch-audit-v1',
                installed=True, active_test=None, denials=0, launches=[], universal_descendant_containment=False))

    def validate(self, value=None, **kwargs):
        args = dict(process_returncode=0, job_id='regression', job_sha256='1'*64, suite_sha256='2'*64,
                    permitted_routes={}, validate_result=r.validate_terminal); args.update(kwargs)
        return c.validate_terminal(c.canonical(self.terminal() if value is None else value), [ID], **args)

    def test_four_exact_slots_include_empty_streams_without_guard_file(self):
        held = self.observer(); self.fill(); observed = held.observe()
        self.assertEqual(tuple(item.name for item in observed), c.SLOTS)
        self.assertEqual(tuple(item.size for item in observed), (2, 0, 0, 2))
        self.assertEqual(tuple(item.raw for item in observed), (b'{}', None, None, b'{}'))
        self.assertFalse((self.root/'guard.json').exists())

    def test_existing_slots_and_dangling_symlinks_refuse_before_work(self):
        (self.root/'result.json').symlink_to(self.root/'missing')
        with self.assertRaises(ValueError): self.observer()

    def test_physical_ancestor_and_root_replacement_refuse(self):
        held = self.observer(); self.fill(); other = self.root.with_name(self.root.name+'-old')
        self.root.rename(other); self.root.mkdir(mode=0o700)
        with self.assertRaises(ValueError): held.observe()

    def test_symlink_hardlink_fifo_and_nonprivate_files_refuse(self):
        for kind in ('symlink', 'hardlink', 'fifo', 'public'):
            with self.subTest(kind=kind):
                child = self.root/kind; child.mkdir(mode=0o700)
                held = c.HeldFour(str(child), deadline=self.deadline, check=lambda: None); self.observers.append(held)
                for name in ('job.json', 'stdout.log', 'stderr.log'):
                    fd=os.open(child/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600); os.write(fd,b'{}'); os.close(fd)
                target = child/'result.json'
                if kind == 'symlink': target.symlink_to(child/'job.json')
                elif kind == 'hardlink': os.link(child/'job.json', target)
                elif kind == 'fifo': os.mkfifo(target, 0o600)
                else: target.write_bytes(b'{}'); target.chmod(0o644)
                with self.assertRaises((ValueError, OSError)): held.observe()

    def test_earlier_slot_mutation_during_later_read_refuses(self):
        held = self.observer(); self.fill(); original = held.read
        def changing(slot):
            result=original(slot)
            if slot=='terminal': (self.root/'stdout.log').write_bytes(b'late')
            return result
        with patch.object(held, 'read', side_effect=changing), self.assertRaises(ValueError): held.observe()

    def test_observer_capacity_failure_is_sticky(self):
        fail=[False]
        def check():
            if fail[0]: raise OSError('full')
        held=self.observer(check=check); self.fill(); fail[0]=True
        with self.assertRaises(OSError): held.observe()
        fail[0]=False
        with self.assertRaises(ValueError): held.observe()

    def test_accounting_reserves_both_stages_from_one_pool(self):
        accounting=self.accounting(); ticket=accounting.begin('regression')
        accounting.commit(ticket,dict(job=2,stdout=0,stderr=0,terminal=2),finalize=lambda:None)
        result=accounting.finish(finalize=lambda:None)
        self.assertEqual(result['shared_reservation_bytes'],36*c.MIB)
        self.assertEqual(result['regression_reservation_bytes'],16*c.MIB)
        self.assertFalse(result['full_controller_acceptance']); self.assertFalse(result['production_guard_acceptance'])

    def test_combined_cap_namespace_intersection_and_suite_caps_refuse(self):
        with self.assertRaises(ValueError): self.accounting(guarded_jobs={'guarded':[ID]})
        with self.assertRaises(ValueError): c.RegressionAccounting({'r':['foreign::id']},guarded_jobs={'g':['g::id']},source_copy_bytes=0,historical_peak_bytes=0,read_available=lambda:20*c.GIB)
        many={f'r{i}':[f'implementation-regressions/test_{i}.py::T.test']for i in range(30)}
        with self.assertRaises(ValueError): c.RegressionAccounting(many,guarded_jobs={'g':['g::id']},source_copy_bytes=0,historical_peak_bytes=0,read_available=lambda:20*c.GIB)
        guard={f'g{i}':[f'g::{i}']for i in range(68)}
        with self.assertRaises(ValueError): self.accounting(guarded_jobs=guard)
        guard={'g':[f'g::{i}'for i in range(4096)]}
        with self.assertRaises(ValueError): self.accounting(guarded_jobs=guard)

    def test_original_deadline_includes_preparation_and_final_persistence(self):
        now=[100.0]; accounting=self.accounting(clock=lambda:now[0]); ticket=accounting.begin('regression')
        self.assertEqual(ticket.deadline,700)
        accounting.commit(ticket,dict(job=2,stdout=0,stderr=0,terminal=2),finalize=lambda:None)
        def late(): now[0]=700.0
        with self.assertRaises(ValueError): accounting.finish(finalize=late)
        self.assertTrue(accounting.failed)

    def test_expired_capacity_failed_and_swallowed_failure_cannot_credit(self):
        accounting=self.accounting(); ticket=accounting.begin('regression')
        def failed(): accounting.fail()
        with self.assertRaises(ValueError): accounting.commit(ticket,dict(job=2,stdout=0,stderr=0,terminal=2),finalize=failed)
        self.assertEqual(accounting.completed,[])

    def test_sizes_are_frozen_before_finalizer_and_no_guard_slot_is_accepted(self):
        accounting=self.accounting(); ticket=accounting.begin('regression'); sizes=dict(job=2,stdout=0,stderr=0,terminal=2)
        accounting.commit(ticket,sizes,finalize=lambda:sizes.update(stdout=c.SLOT_BYTES))
        self.assertEqual(accounting.observed,4)
        accounting=self.accounting(); ticket=accounting.begin('regression')
        with self.assertRaises(ValueError): accounting.commit(ticket,dict(sizes,guard=1),finalize=lambda:None)

    def test_strict_terminal_requires_exact_result_actual_exit_and_no_production_guard_claim(self):
        self.assertEqual(self.validate()['production_guard_installed'],False)
        for change in ({'production_guard_installed':True},{'job_sha256':'0'*64},{'extra':True}):
            with self.assertRaises(ValueError): self.validate(dict(self.terminal(),**change))
        for code in (False,0.0,1,None):
            with self.assertRaises(ValueError): self.validate(process_returncode=code)
        for category in r.CATEGORIES:
            value=self.terminal();value['result']['problems'][category]=[0]
            with self.assertRaises(ValueError): self.validate(value)

    def test_child_launch_records_must_match_literal_caps_and_contiguous_ordinals(self):
        value=self.terminal();value['launch_audit']['launches']=[dict(test_id=ID,route='inert',ordinal=1)]
        with self.assertRaises(ValueError): self.validate(value)
        self.validate(value,permitted_routes={ID:{'inert':1}})
        for ordinal in (True,2):
            value['launch_audit']['launches'][0]['ordinal']=ordinal
            with self.assertRaises(ValueError): self.validate(value,permitted_routes={ID:{'inert':2}})

    def test_launch_audit_network_and_unprepared_child_denial_remains_sticky(self):
        audit=w.LaunchAudit(lambda:None)
        with self.assertRaises(PermissionError): audit.audit('socket.connect',())
        with self.assertRaises(ValueError): audit.snapshot()
        audit=w.LaunchAudit(lambda:None); audit.begin_test(ID)
        with self.assertRaises(PermissionError): audit.audit('subprocess.Popen',('/bin/sh',['sh'],None,{}))
        audit.end_test()
        with self.assertRaises(ValueError): audit.snapshot()

    def test_source_reader_refuses_hash_links_and_changed_bytes(self):
        self.write('source.py',b'pass\n'); record=dict(path=str(self.root/'source.py'),bytes=5,sha256=c.digest(b'pass\n'))
        self.assertEqual(c.read_source(record,lambda:None),b'pass\n')
        with self.assertRaises(ValueError): c.read_source(dict(record,sha256='0'*64),lambda:None)
        alias=self.root/'alias.py';alias.symlink_to(self.root/'source.py')
        with self.assertRaises(OSError): c.read_source(dict(record,path=str(alias)),lambda:None)

    def test_frozen_transport_policy_rejects_changed_literal_and_undeclared_profile(self):
        record=dict(path='unused',bytes=1,sha256=f.TRANSPORT_SHA)
        routes=f.declaration('transport','implementation-regressions/test_transport.py',record)
        self.assertEqual(sum(sum(route.values())for route in routes.values()),16)
        with self.assertRaises(ValueError): f.declaration('transport','implementation-regressions/test_transport.py',dict(record,sha256='0'*64))
        with self.assertRaises(ValueError): f.declaration('arbitrary','implementation-regressions/test_transport.py',record)

    def test_guarded_tiny_program_replica_matches_reviewed_original_fixture(self):
        fixture=load('regression_guarded_pair_fixture',HERE.parent/'test_guard_report.py')
        job_raw=b'{"synthetic":"job"}\n'
        context,guard,terminal=fixture.fixtures();context['job_sha256']=c.digest(job_raw)
        guard['job_sha256']=context['job_sha256'];terminal['job_sha256']=context['job_sha256']
        terminal_raw,guard_raw=fixture.encode(guard,terminal)
        self.assertIn(repr(terminal_raw).encode(),f.guarded_program(job_raw,'ok'))
        self.assertIn(repr(guard_raw).encode(),f.guarded_program(job_raw,'ok'))

    def policy(self, profile):
        files={'transport':HERE.parent/'test_transport.py','historical-profile':HERE.parent/'test_historical638_assertion.py',
               'guarded-job':HERE.parent/'guarded-job-integration/test_guarded_job.py',
               'tool-setup':HERE.parent/'tool-setup-integration/test_tool_setup.py'}
        source=files[profile];record=dict(path=str(source),bytes=source.stat().st_size,sha256=c.digest(source.read_bytes()))
        logical='implementation-regressions/'+(profile+'-integration/' if profile in ('guarded-job','tool-setup') else '')+source.name
        repository=next(parent for parent in HERE.parents if (parent/'tests/controlled-drugs/harness/historical-manifest.json').is_file())
        declaration=dict(profile=profile,scratch_root=str(self.root),repository_root=str(repository),routes=f.declaration(profile,logical,record))
        job=dict(suite=dict(source=record,logical_id_path=logical,child_policy=declaration))
        return f.build(job,read_source=lambda rec:c.read_source(rec,lambda:None),python=str(Path(sys.executable).resolve()),
                       environment={'TMPDIR':str(self.root)},check=lambda:None),logical

    def test_transport_policy_accepts_only_frozen_program_mode_cwd_and_environment(self):
        (routes,admit),logical=self.policy('transport')
        method='test_exact_normal_completion_actual_exit_and_exclusive_logs';cwd=self.root/method;cwd.mkdir(mode=0o700)
        tree=__import__('ast').parse((HERE.parent/'test_transport.py').read_bytes())
        inert=next(__import__('ast').literal_eval(n.value)for n in tree.body if isinstance(n,__import__('ast').Assign)
            and any(isinstance(t,__import__('ast').Name)and t.id=='INERT'for t in n.targets))
        python=str(Path(sys.executable).resolve());argv=[python,'-I','-B','-c',inert,'ok',str(cwd/'terminal.json')]
        env={'PATH':'/usr/bin:/bin','PYTHONDONTWRITEBYTECODE':'1'};identifier=logical+'::TransportTests.'+method
        self.assertEqual(admit((python,argv,str(cwd),env),identifier),'transport-inert')
        self.assertEqual(admit((python,tuple(argv),str(cwd),env),identifier),'transport-inert')
        for changed in (argv[:4]+[inert+'\n']+argv[5:],argv[:5]+['wrong']+argv[6:],argv[:-1]+[str(self.root/'outside.json')]):
            with self.assertRaises(ValueError):admit((python,changed,str(cwd),env),identifier)
        with self.assertRaises(ValueError):admit((python,argv,str(cwd),dict(env,NODE_OPTIONS='injected')),identifier)

    def test_historical_policy_accepts_exact_worker_and_keeps_negative_argument_fixture(self):
        (routes,admit),logical=self.policy('historical-profile');python=str(Path(sys.executable).resolve())
        cwd=self.root/'historical638-assertion-test-fixture';cwd.mkdir(mode=0o700)
        repository=next(parent for parent in HERE.parents if (parent/'tests/controlled-drugs/harness/historical-manifest.json').is_file())
        argv=[python,'-I','-B',str(HERE.parent/'historical638_assertion.py'),'--repository-root',str(repository),
              '--tree-root',str(cwd/'copies/tree'),'--run-synthetic-local']
        env=dict(HOME=str(cwd/'home'),TMPDIR=str(cwd/'tmp'),PATH=str(Path(python).parent),PYTHONDONTWRITEBYTECODE='1',
                 PYTHONOPTIMIZE='0',PYTHONNOUSERSITE='1',PYTHONUTF8='1',LC_ALL='C',LANG='C')
        identifier=logical+'::HistoricalAssertionTests.test_unknown_cli_argument_refuses'
        self.assertEqual(admit((python,argv,str(cwd),env),identifier),'historical-profile')
        with self.assertRaises(ValueError):admit((python,argv[:-1]+['--arbitrary'],str(cwd),env),identifier)
        with self.assertRaises(ValueError):admit((python,argv[:-2]+[str(self.root/'foreign'),'--run-synthetic-local'],str(cwd),env),identifier)

    def test_guarded_policy_matches_exact_tiny_program_and_rejects_added_code(self):
        (routes,admit),logical=self.policy('guarded-job');python=str(Path(sys.executable).resolve())
        cwd=self.root/'lrv-guarded-job-fixture';cwd.mkdir(mode=0o700);(cwd/'output').mkdir(mode=0o700)
        raw=b'{"fixture":"job"}\n';(cwd/'output/job.json').write_bytes(raw)
        worker=cwd/'inert_worker.py';worker.write_bytes(f.guarded_program(raw,'ok'))
        argv=[python,'-I','-B',str(worker),'--job',str(cwd/'output/job.json'),'--job-sha256',c.digest(raw)]
        env={'PATH':'/usr/bin:/bin','PYTHONDONTWRITEBYTECODE':'1'}
        identifier=logical+'::GuardedJobTests.test_actual_child_pair_revalidation_closes_then_credits_under_original_deadline'
        self.assertEqual(admit((python,argv,str(cwd),env),identifier),'guarded-job-inert')
        worker.write_bytes(worker.read_bytes()+b'raise SystemExit(0)\n')
        with self.assertRaises(ValueError):admit((python,argv,str(cwd),env),identifier)

    def test_collection_requires_all_local_classes_and_all_exact_methods(self):
        module=types.ModuleType('regression_collection_toy')
        exec('import unittest\nclass Tiny(unittest.TestCase):\n def test_one(self): pass\n def test_two(self): pass\n',module.__dict__)
        suite=dict(logical_id_path='implementation-regressions/test_tiny.py',classes={'Tiny':['test_one','test_two']},
                   expected_ids=[ID,'implementation-regressions/test_tiny.py::Tiny.test_two'])
        tests,stable=w.collect(module,suite,r,c.require);self.assertEqual([stable(test)for test in tests],suite['expected_ids'])
        with self.assertRaises(ValueError):w.collect(module,dict(suite,classes={'Tiny':['test_one']}),r,c.require)
        exec('class Extra(unittest.TestCase):\n def test_extra(self): pass\n',module.__dict__)
        with self.assertRaises(ValueError):w.collect(module,suite,r,c.require)

    def test_audit_installation_probe_refuses_silently_vetoed_insertion(self):
        audit=w.LaunchAudit(lambda:None)
        with patch.object(sys,'addaudithook',return_value=None),patch.object(sys,'audit',return_value=None),self.assertRaises(ValueError):audit.install()
        self.assertFalse(audit.installed)
        with self.assertRaises(ValueError):audit.snapshot()

    def test_audit_installation_requires_this_instance_probe(self):
        audit=w.LaunchAudit(lambda:None);captured=[]
        def add(hook):captured.append(hook)
        def emit(event,*args):captured[0](event,args)
        with patch.object(sys,'addaudithook',side_effect=add),patch.object(sys,'audit',side_effect=emit):audit.install()
        self.assertTrue(audit.snapshot()['installed'])
        with self.assertRaises(PermissionError):audit.audit('lrv.regression.audit_probe.v1',(object(),))

    def test_finite_child_cwd_symlink_cannot_escape_actual_scratch(self):
        (routes,admit),logical=self.policy('transport')
        method='test_exact_normal_completion_actual_exit_and_exclusive_logs'
        foreign=Path(tempfile.mkdtemp(prefix='lrv-regression-foreign-')).resolve();foreign.chmod(0o700)
        cwd=self.root/method;cwd.symlink_to(foreign,target_is_directory=True)
        import ast
        tree=ast.parse((HERE.parent/'test_transport.py').read_bytes())
        inert=next(ast.literal_eval(n.value)for n in tree.body if isinstance(n,ast.Assign)
            and any(isinstance(t,ast.Name)and t.id=='INERT'for t in n.targets))
        python=str(Path(sys.executable).resolve());argv=[python,'-I','-B','-c',inert,'ok',str(cwd/'terminal.json')]
        with self.assertRaises((ValueError,OSError)):admit((python,argv,str(cwd),{'PATH':'/usr/bin:/bin','PYTHONDONTWRITEBYTECODE':'1'}),logical+'::TransportTests.'+method)

    def test_tool_setup_policy_allows_only_declared_inert_methods_and_exact_programs(self):
        (routes,admit),logical=self.policy('tool-setup');python=str(Path(sys.executable).resolve())
        self.assertEqual(len(routes),6)
        cwd=self.root/'lrv-tool-command-fixture';cwd.mkdir(mode=0o700)
        env=dict(PATH='/usr/bin:/bin',HOME=str(cwd/'home'),TMPDIR=str(cwd/'tmp'),LANG='en_US.UTF-8',LC_ALL='en_US.UTF-8',
            PYTHONDONTWRITEBYTECODE='1',PYTHONNOUSERSITE='1',PYTHONHASHSEED='0',PIP_CONFIG_FILE='/dev/null',
            __CF_USER_TEXT_ENCODING=f'0x{os.getuid():X}:0x0:0x0')
        for method,program in f.TOOL_SETUP_PROGRAMS.items():
            identifier=logical+'::InertCommandTests.'+method
            self.assertEqual(admit((python,[python,'-I','-B','-c',program],cwd,env),identifier),'tool-setup-inert')
            with self.assertRaises(ValueError):admit((python,[python,'-I','-B','-c',program+'\n'],cwd,env),identifier)
        with self.assertRaises(ValueError):admit((python,[python,'-I','-B','-m','venv'],cwd,env),next(iter(routes)))

    def test_canonical_historical_subject_layout_keeps_exact_prospective_source_pin(self):
        repository=self.root/'repository';repository.mkdir(mode=0o700)
        runner=repository/'tests/controlled-drugs/portable-runner';runner.mkdir(mode=0o700,parents=True)
        source=runner/'controller-integration/portable-regression-tests/test_historical638_assertion.py';source.parent.mkdir(mode=0o700,parents=True)
        prospective=HERE.parent/'controller-integration/portable-regression-tests/test_historical638_assertion.py'
        source.write_bytes(prospective.read_bytes());source.chmod(0o600)
        worker=runner/'historical638_assertion.py';worker.write_bytes((HERE.parent/'historical638_assertion.py').read_bytes());worker.chmod(0o600)
        record=dict(path=str(source),bytes=source.stat().st_size,sha256=c.digest(source.read_bytes()))
        logical='implementation-regressions/test_historical638_assertion.py'
        policy=dict(profile='historical-profile',scratch_root=str(self.root),repository_root=str(repository),routes=f.declaration('historical-profile',logical,record))
        routes,admit=f.build(dict(suite=dict(source=record,logical_id_path=logical,child_policy=policy)),
            read_source=lambda rec:c.read_source(rec,lambda:None),python=str(Path(sys.executable).resolve()),environment={'TMPDIR':str(self.root)},check=lambda:None)
        cwd=self.root/'historical638-assertion-test-canonical';cwd.mkdir(mode=0o700);python=str(Path(sys.executable).resolve())
        env=dict(HOME=str(cwd/'home'),TMPDIR=str(cwd/'tmp'),PATH=str(Path(python).parent),PYTHONDONTWRITEBYTECODE='1',
            PYTHONOPTIMIZE='0',PYTHONNOUSERSITE='1',PYTHONUTF8='1',LC_ALL='C',LANG='C')
        argv=[python,'-I','-B',str(worker),'--repository-root',str(repository),'--tree-root',str(cwd/'copies/tree')]
        self.assertEqual(admit((python,argv,str(cwd),env),logical+'::HistoricalAssertionTests.test_complete_independent638_and267_profile_pass'),'historical-profile')


if __name__=='__main__': unittest.main(verbosity=2)
