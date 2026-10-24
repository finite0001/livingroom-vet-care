"""Actual tiny inert children and physical evidence; no target/DB/provider runs.

Synthetic pair files exercise parent composition only. They do not prove that
the inert child installed the production process guard.
"""
from copy import deepcopy
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
PARENT = HERE.parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


k = load('job_integration_under_test', HERE/'guarded_job.py')
a = load('job_integration_accounting', PARENT/'run_accounting.py')
o = load('job_integration_output', PARENT/'output_observer.py')
p = load('job_integration_pair', PARENT/'pair_reader.py')
t = load('job_integration_transport', PARENT/'transport.py')
e = load('job_integration_evidence', PARENT/'parent-evidence-draft/parent_evidence.py')
f = load('job_integration_fixtures', PARENT/'test_guard_report.py')


class GuardedJobTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='lrv-guarded-job-')).resolve()
        self.root.chmod(0o700)
        self.output = self.root/'output'; self.output.mkdir(mode=0o700)
        self.accountant = a.RunAccounting({'job': [f.ID]}, source_copy_bytes=0,
            historical_peak_bytes=a.MAX_HISTORICAL_BYTES, read_available=lambda: 20*a.GIB)
        self.owner = k.GuardedJobs(self.accountant, output_module=o, pair_module=p,
            transport_module=t, evidence_module=e, validate_pair=f.g.validate_pair,
            validate_terminal=f.r.validate_terminal)
        self.readmissions = []
        self.mode = 'ok'
        self.ticket = None
        self.observers = []
        self.readers = []
        original_output, original_pair = o.HeldOutput, p.HeldPairReader
        def output(*args, **kw):
            value = original_output(*args, **kw); self.observers.append(value); return value
        def pair(*args, **kw):
            value = original_pair(*args, **kw); self.readers.append(value); return value
        self.out_patch = patch.object(o, 'HeldOutput', side_effect=output)
        self.pair_patch = patch.object(p, 'HeldPairReader', side_effect=pair)
        self.out_patch.start(); self.pair_patch.start()

    def tearDown(self):
        self.out_patch.stop(); self.pair_patch.stop()
        for handle in self.observers + self.readers:
            self.assertTrue(handle.closed)
            self.assertEqual(handle.fds, [])
        self.assertLess(sum(path.stat().st_size for path in self.root.rglob('*') if path.is_file()), 256*1024)

    def prepare(self, ticket, check):
        self.ticket = ticket
        self.assertFalse(list(self.output.iterdir()))
        check()
        context, guard, terminal = f.fixtures()
        job = {'kind': 'portable-worker-job-v2', 'job_id': ticket.job_id, 'deadline': ticket.deadline,
            'suite': {}, 'guard': {}, 'implementation': {}, 'historical638': None, 'partition': None,
            'output': {'directory': str(self.output), 'terminal_name': 'terminal.json', 'guard_name': 'guard.json'}}
        job_raw = e.canonical(job) + b'\n'
        context['job_sha256'] = e.digest(job_raw)
        guard['job_sha256'] = context['job_sha256']
        terminal['job_sha256'] = context['job_sha256']
        terminal_raw, guard_raw = f.encode(guard, terminal)
        worker = self.root/'inert_worker.py'
        # Exact raw CLI is the same production shape, but the reviewed fixture
        # child emits only tiny synthetic pair bytes. No subprocess substitution.
        worker.write_text('import os,sys,hashlib\nfrom pathlib import Path\n'
            'assert len(sys.argv)==5 and sys.argv[1]=="--job" and sys.argv[3]=="--job-sha256"\n'
            'path=Path(sys.argv[2]); assert hashlib.sha256(path.read_bytes()).hexdigest()==sys.argv[4]\n'
            'def put(name,raw):\n fd=os.open(path.parent/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)\n'
            ' try:\n  assert os.write(fd,raw)==len(raw)\n finally: os.close(fd)\n'
            + ('sys.exit(7)\n' if self.mode == 'nonzero' else '')
            + ('put("guard.json",b"{}")\n' if self.mode == 'bad_guard' else 'put("guard.json",'+repr(guard_raw)+')\n')
            + 'put("terminal.json",'+repr(terminal_raw)+')\n'
            + 'os.write(1,b"inert stdout");os.write(2,b"inert stderr")\n')
        return k.JobInput(job_raw, context, str(Path(sys.executable).resolve()), str(worker),
            str(self.root), {'PATH': '/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1'}, str(self.output))

    def readmit(self, value, check):
        self.readmissions.append(value)
        self.assertEqual(value.context['expected_ids'], [f.ID])
        self.assertEqual(e.strict_json(value.job_raw, check)['deadline'], self.ticket.deadline)
        self.assertEqual(value.output, str(self.output))
        check()

    def run_job(self, **kw):
        return self.owner.run('job', prepare=kw.get('prepare', self.prepare), readmit=kw.get('readmit', self.readmit))

    def assert_poisoned(self):
        self.assertTrue(self.owner.failed)
        self.assertIsNotNone(self.accountant.failure)
        self.assertEqual(self.owner.completed, [])
        with self.assertRaises(ValueError): self.run_job()

    def test_actual_child_pair_revalidation_closes_then_credits_under_original_deadline(self):
        summary = self.run_job()
        self.assertEqual(summary.expected_ids, (f.ID,))
        self.assertEqual(summary.slot_bytes[1:3], (12, 12))
        self.assertEqual(len(self.readmissions), 2)
        self.assertTrue(all(handle.deadline == self.ticket.deadline for handle in self.observers+self.readers))
        self.assertEqual(self.readers[0].used, True)
        finalized = []
        receipt = self.accountant.finish(finalize=lambda: finalized.append('persisted'))
        self.assertEqual(finalized, ['persisted'])
        self.assertEqual(receipt['jobs_completed'], ['job'])
        self.assertFalse(receipt['full_routing_acceptance'])
        self.assertFalse(receipt['database_acceptance'])
        self.assertFalse(receipt['descendant_cleanup_verified'])

    def test_preparation_failure_starts_and_poisons_accounting_without_launch(self):
        def broken(ticket, check):
            self.assertGreater(ticket.deadline, time.monotonic()); raise OSError('source unavailable')
        with self.assertRaises(OSError): self.run_job(prepare=broken)
        self.assert_poisoned(); self.assertFalse(list(self.output.iterdir()))

    def test_preparation_time_is_not_renewed_at_worker_launch(self):
        def slow(ticket, check):
            self.ticket = ticket; time.sleep(0.03); return None
        with patch.object(a, 'WORKER_SECONDS', 0.01), self.assertRaises(ValueError): self.run_job(prepare=slow)
        self.assert_poisoned(); self.assertEqual(self.observers, [])

    def test_job_deadline_identity_inventory_and_output_mismatches_refuse_before_launch(self):
        for field in ('deadline', 'job_id', 'expected_ids', 'output'):
            with self.subTest(field=field):
                # Each subcase is a distinct prospective run, never a reset of a
                # failed accounting instance within one acceptance run.
                self.tearDown(); self.setUp()
                def changed(ticket, check):
                    value = self.prepare(ticket, check)
                    job = e.strict_json(value.job_raw, check); context = deepcopy(value.context)
                    if field == 'expected_ids': context['expected_ids'] = ['foreign::test']
                    elif field == 'output': job['output']['guard_name'] = 'foreign.json'
                    else: job[field] = 'wrong' if field == 'job_id' else ticket.deadline + 1
                    raw = e.canonical(job)+b'\n'; context['job_sha256'] = e.digest(raw)
                    return k.JobInput(raw, context, value.python, value.worker, value.cwd, value.env, value.output)
                with self.assertRaises(ValueError): self.run_job(prepare=changed)
                self.assert_poisoned()

    def test_admission_failure_always_closes_unused_pair_reader(self):
        def refused(value, check): raise ValueError('source changed')
        with self.assertRaises(t.TransportFailure): self.run_job(readmit=refused)
        self.assert_poisoned(); self.assertFalse(self.readers[0].used)
        self.assertEqual(sorted(path.name for path in self.output.iterdir()), ['job.json'])

    def test_real_nonzero_child_never_credits_and_closes_reader(self):
        self.mode = 'nonzero'
        with self.assertRaises(t.TransportFailure) as failed: self.run_job()
        self.assertEqual(failed.exception.receipt['returncode'], 7)
        self.assertTrue(failed.exception.receipt['worker_reaped'])
        self.assert_poisoned(); self.assertFalse(self.readers[0].used)

    def test_real_zero_exit_with_invalid_guard_never_credits(self):
        self.mode = 'bad_guard'
        with self.assertRaises(t.TransportFailure): self.run_job()
        self.assert_poisoned(); self.assertTrue(self.readers[0].used)

    def test_source_recheck_after_successful_transport_can_still_refuse_credit(self):
        def changed(value, check):
            self.readmit(value, check)
            if len(self.readmissions) == 2: raise ValueError('tool changed after child')
        with self.assertRaisesRegex(ValueError, 'tool changed'): self.run_job(readmit=changed)
        self.assert_poisoned()

    def test_late_stream_change_in_final_source_check_is_reobserved(self):
        def changed(value, check):
            self.readmit(value, check)
            if len(self.readmissions) == 2: (self.output/'stdout.log').write_bytes(b'late change')
        with self.assertRaises(ValueError): self.run_job(readmit=changed)
        self.assert_poisoned()

    def test_close_failure_after_valid_pair_prevents_accounting_credit(self):
        original = self.out_patch.temp_original
        close = original.close
        def failing(handle):
            close(handle); raise OSError('close failed')
        with patch.object(original, 'close', failing), self.assertRaisesRegex(OSError, 'close failed'):
            self.run_job()
        self.assert_poisoned()

    def test_post_finalize_capacity_failure_prevents_credit(self):
        def capacity():
            return 0 if self.observers and self.observers[0].closed else 20*a.GIB
        self.accountant._read_available = capacity
        with self.assertRaisesRegex(ValueError, 'free space'): self.run_job()
        self.assert_poisoned()

    def test_reentrant_run_cannot_launch_a_second_child(self):
        def prepare(ticket, check):
            with self.assertRaises(ValueError): self.run_job()
            return self.prepare(ticket, check)
        with self.assertRaises(ValueError): self.run_job(prepare=prepare)
        self.assert_poisoned(); self.assertEqual(self.observers, [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
