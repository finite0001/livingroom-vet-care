"""Physical parent controls with explicit Transport test doubles; no OS child."""
from copy import deepcopy
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec)
    sys.modules[name]=module;spec.loader.exec_module(module);return module


c=load('regression_parent_core',HERE/'regression_core.py')
p=load('regression_parent_under_test',HERE/'regression_parent.py')
r=load('regression_parent_results',HERE.parent/'results.py')
ID='implementation-regressions/test_tiny.py::Tiny.test_one'


def record(path):
    raw=path.read_bytes();return dict(path=str(path),bytes=len(raw),sha256=c.digest(raw))


class RegressionParentTests(unittest.TestCase):
    def setUp(self):
        self.root=Path(tempfile.mkdtemp(prefix='lrv-regression-parent-')).resolve();self.root.chmod(0o700)
        self.output=self.root/'output';self.output.mkdir(mode=0o700)
        self.source=self.root/'test_tiny.py';self.source.write_bytes(b'import unittest\nclass Tiny(unittest.TestCase):\n def test_one(self): pass\n')
        self.accounting=c.RegressionAccounting({'regression':[ID]},guarded_jobs={'guarded':['original::test']},
            source_copy_bytes=0,historical_peak_bytes=c.MAX_HISTORICAL_BYTES,read_available=lambda:20*c.GIB)
        self.prepare_calls=self.admissions=self.launches=0
        self.receipt_change=lambda value:value
        self.owner=p.RegressionJobs(self.accounting,core_module=c,transport_module=SimpleNamespace(Transport=self.transport),results_module=r)
        self.observers=[];original=c.HeldFour
        def observer(*args,**kw):
            value=original(*args,**kw);self.observers.append(value);return value
        self.held_patch=patch.object(c,'HeldFour',side_effect=observer);self.held_patch.start()

    def tearDown(self):
        self.held_patch.stop()
        for observer in self.observers:
            self.assertTrue(observer.closed);self.assertEqual(observer.fds,[])

    def prepare(self,ticket,check):
        self.prepare_calls+=1;self.ticket=ticket;check()
        job=dict(kind='portable-regression-job-v1',job_id=ticket.job_id,deadline=ticket.deadline,
            suite=dict(source=record(self.source),logical_id_path='implementation-regressions/test_tiny.py',classes={'Tiny':['test_one']},
                expected_ids=[ID],classification='process_free',child_policy=None),
            implementation={name:record(path)for name,path in dict(core=HERE/'regression_core.py',results=HERE.parent/'results.py',worker=HERE/'regression_worker.py').items()},
            output=dict(directory=str(self.output),terminal_name='result.json'),import_roots=[])
        self.job=job
        return p.JobInput(c.canonical(job)+b'\n',str(Path(sys.executable).resolve()),str(HERE/'regression_worker.py'),str(self.root),
            {'PATH':'/usr/bin:/bin','PYTHONDONTWRITEBYTECODE':'1'},str(self.output))

    def readmit(self,value,check):
        self.admissions+=1;check()
        job=c.strict_json(value.job_raw)
        c.read_source(job['suite']['source'],check)
        for metadata in job['implementation'].values():c.read_source(metadata,check)
        check()

    def transport(self,validator):
        def run(prepared,*,admit,check_storage):
            self.launches+=1;check_storage();admit(prepared);check_storage()
            for name in ('stdout.log','stderr.log'):
                fd=os.open(self.output/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.close(fd)
            result=dict(kind='portable-unittest-terminal-v1',passed=True,ids=[ID],expected_count=1,
                expected_ids_sha256=r._digest([ID]),tests_run=1,started=[0],stopped=[0],succeeded=[0],
                problems={name:[]for name in r.CATEGORIES},guard_clean=True,guard_errors=0,protocol_errors=0)
            payload=dict(kind='portable-regression-terminal-v1',job_id='regression',job_sha256=c.digest((self.output/'job.json').read_bytes()),
                suite_sha256=self.job['suite']['source']['sha256'],result=result,production_guard_installed=False,
                launch_audit=dict(kind='independent-regression-launch-audit-v1',installed=True,active_test=None,denials=0,launches=[],universal_descendant_containment=False))
            r.write_terminal(str(self.output/'result.json'),payload,check_storage)
            raw=(self.output/'result.json').read_bytes();terminal=validator(raw,[ID],process_returncode=0)
            value=dict(kind='portable-transport-v1',passed=True,started=time.monotonic()-0.1,first_failure=None,cleanup_errors=[],
                descendant_cleanup_verified=False,future_launches_allowed=True,worker_pid=123,worker_reaped=True,returncode=0,
                paths={slot:str(self.output/c.NAMES[slot])for slot in ('stdout','stderr','terminal')},
                spawn_returned_at=time.monotonic()-0.09,terminal_sha256=c.digest(raw),terminal_bytes=len(raw),terminal=terminal,
                elapsed=0.05,completion_basis='exact_terminal_exit_zero_finite_trusted_tests',
                stream_bytes=dict(stdout=0,stderr=0),stream_sha256=dict(stdout=c.digest(b''),stderr=c.digest(b'')))
            return self.receipt_change(value)
        return SimpleNamespace(run=run)

    def run_job(self,**kwargs):return self.owner.run('regression',prepare=kwargs.get('prepare',self.prepare),readmit=kwargs.get('readmit',self.readmit))

    def poisoned(self):
        self.assertTrue(self.owner.failed);self.assertTrue(self.accounting.failed);self.assertEqual(self.owner.completed,[])
        with self.assertRaises(ValueError):self.run_job()

    def test_exact_four_slot_evidence_revalidated_closed_then_credited(self):
        summary=self.run_job();self.assertEqual(summary.expected_ids,(ID,));self.assertEqual(len(summary.slot_bytes),4)
        self.assertEqual(summary.slot_bytes[1:3],(0,0));self.assertEqual(self.admissions,2)
        self.assertFalse((self.output/'guard.json').exists());self.assertEqual(self.observers[0].deadline,self.ticket.deadline)
        receipt=self.accounting.finish(finalize=lambda:None);self.assertEqual(receipt['jobs_completed'],['regression'])

    def test_preparation_failure_poison_before_transport_or_output(self):
        def broken(ticket,check):raise OSError('source unavailable')
        with self.assertRaises(OSError):self.run_job(prepare=broken)
        self.poisoned();self.assertEqual(self.observers,[]);self.assertEqual(self.launches,0)

    def test_readmission_failure_closes_observer_and_retains_job(self):
        def broken(value,check):raise OSError('tool unavailable')
        with self.assertRaises(OSError):self.run_job(readmit=broken)
        self.poisoned();self.assertEqual(sorted(path.name for path in self.output.iterdir()),['job.json'])

    def test_semantic_job_equivalence_cannot_replace_exact_raw_encoding(self):
        def changed(ticket,check):
            value=self.prepare(ticket,check)
            return p.JobInput(value.job_raw+b' ',value.python,value.worker,value.cwd,value.env,value.output)
        with self.assertRaises(ValueError):self.run_job(prepare=changed)
        self.poisoned();self.assertEqual(self.launches,0)

    def test_wrong_ids_or_original_deadline_refuses_before_output(self):
        def changed(ticket,check):
            value=self.prepare(ticket,check);self.job['deadline']+=1
            return p.JobInput(c.canonical(self.job)+b'\n',value.python,value.worker,value.cwd,value.env,value.output)
        with self.assertRaises(ValueError):self.run_job(prepare=changed)
        self.poisoned();self.assertEqual(self.observers,[])

    def test_late_stream_change_in_final_source_check_is_reobserved(self):
        def changing(value,check):
            self.readmit(value,check)
            if self.admissions==2:(self.output/'stdout.log').write_bytes(b'late')
        with self.assertRaises(ValueError):self.run_job(readmit=changing)
        self.poisoned()

    def test_source_change_after_transport_prevents_credit(self):
        def changing(value,check):
            if self.admissions==1:self.source.write_bytes(b'foreign source\n')
            self.readmit(value,check)
        with self.assertRaises(ValueError):self.run_job(readmit=changing)
        self.poisoned()

    def test_final_close_failure_prevents_credit(self):
        original=self.held_patch.temp_original;close=original.close
        def broken(observer):close(observer);raise OSError('close failed')
        with patch.object(original,'close',broken),self.assertRaises(OSError):self.run_job()
        self.poisoned();self.assertEqual(self.accounting.completed,[])

    def test_post_close_capacity_failure_prevents_credit(self):
        self.accounting.capacity=lambda:0 if self.observers and self.observers[0].closed else 20*c.GIB
        with self.assertRaises(ValueError):self.run_job()
        self.poisoned()

    def test_swallowed_reentry_cannot_continue_original_run(self):
        def changing(ticket,check):
            with self.assertRaises(ValueError):self.run_job()
            return self.prepare(ticket,check)
        with self.assertRaises(ValueError):self.run_job(prepare=changing)
        self.poisoned();self.assertEqual(self.launches,0)

    def test_readmission_cannot_mutate_detached_transport_environment(self):
        def changing(value,check):self.readmit(value,check);value.env['INJECTED']='refused copy'
        self.run_job(readmit=changing);self.assertEqual(len(self.owner.completed),1)

    def test_false_exit_or_cleanup_receipt_never_credits(self):
        self.receipt_change=lambda value:dict(value,returncode=False)
        with self.assertRaises(ValueError):self.run_job()
        self.poisoned()


if __name__=='__main__':unittest.main(verbosity=2)
