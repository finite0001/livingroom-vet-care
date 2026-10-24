"""Small source-bound inert process tests. No target worker/DB/network launch."""
from contextlib import ExitStack
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import resource
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

t = load('transport_under_test', HERE / 'transport.py')
r = load('transport_actual_results', HERE / 'results.py')
REAL_POPEN, REAL_MONOTONIC = subprocess.Popen, time.monotonic
IDS = ['test_inert.py::Inert.test_one']
INERT = r'''
import hashlib,json,os,signal,sys,time
from pathlib import Path
mode,path=sys.argv[1:]
assert mode in ('ok','dual','outcap','errcap','nonzero','missing','duplicate','truncated','unicode','hang')
if mode=='hang':
 signal.signal(signal.SIGTERM,signal.SIG_IGN)
 os.write(1,b'ready')
 time.sleep(30)
if mode=='dual':
 for _ in range(256):
  os.write(1,b'o'*512);os.write(2,b'e'*512)
if mode in ('outcap','errcap'):
 for _ in range(128):os.write(1 if mode=='outcap' else 2,b'x'*512)
ids=['test_inert.py::Inert.test_one']
v={'kind':'portable-unittest-terminal-v1','passed':True,'ids':ids,'expected_count':1,
'expected_ids_sha256':hashlib.sha256(json.dumps(sorted(ids),ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),
 'tests_run':1,'started':[0],'stopped':[0],'succeeded':[0],
 'problems':{n:[] for n in ('failures','errors','skips','expected_failures','unexpected_successes','subtest_failures','subtest_errors')},
 'guard_clean':True,'guard_errors':0,'protocol_errors':0}
raw=json.dumps(v).encode()
if mode=='duplicate':raw=b'{"passed":true,"passed":true}'
if mode=='truncated':raw=raw[:-1]
if mode=='unicode':raw=b'\xff'
if mode!='missing':
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 os.write(fd,raw);os.close(fd)
sys.exit(7 if mode=='nonzero' else 0)
'''
EVIDENCE = Path(tempfile.mkdtemp(prefix='portable-transport-inert-')).resolve()
os.chmod(EVIDENCE, 0o700)


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.root = EVIDENCE / self._testMethodName; self.root.mkdir(mode=0o700)
        self.children = []
        self.prepared = {'argv': [str(Path(sys.executable).resolve()), '-I', '-B',
            str(self.root/'worker.py'), '--job', str(self.root/'job.json'), '--job-sha256', '1'*64],
            'cwd': str(self.root), 'env': {'PATH': '/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1'},
            'evidence_directory': str(self.root), 'stdout_name': 'stdout.bin',
            'stderr_name': 'stderr.bin', 'terminal_name': 'terminal.json',
            'expected_ids': IDS, 'deadline': REAL_MONOTONIC()+10}
        self.admitted, self.storage = 0, 0

    def tearDown(self):
        # Every child here is directly spawned by this harness. No escaped child.
        for proc in self.children:
            if proc.poll() is None:
                proc.kill(); proc.wait(timeout=2)
                self.fail('transport did not reap its precise inert child')
        retained = sum(p.stat().st_size for p in EVIDENCE.rglob('*') if p.is_file())
        self.assertLessEqual(retained, 1024*1024)

    def admit(self, value):
        self.assertEqual(value['argv'], tuple(self.prepared['argv']))
        self.admitted += 1

    def capacity(self): self.storage += 1

    def spawn(self, mode):
        def factory(argv, **kw):
            self.assertEqual(tuple(argv), tuple(self.prepared['argv']))
            self.assertTrue(kw['start_new_session']); self.assertTrue(kw['close_fds'])
            self.assertEqual(kw['stdin'], subprocess.DEVNULL)
            self.assertEqual(kw['env'], self.prepared['env'])
            proc = REAL_POPEN([str(Path(sys.executable).resolve()), '-I', '-B', '-c', INERT,
                              mode, str(self.root/'terminal.json')], **kw)
            self.children.append(proc)
            return proc
        return factory

    def run_transport(self, mode='ok', *, validator=None, owner=None, capacity=None):
        owner = owner or t.Transport(validator or r.validate_terminal)
        with patch.object(subprocess, 'Popen', side_effect=self.spawn(mode)):
            result = owner.run(self.prepared, admit=self.admit, check_storage=capacity or self.capacity)
        self.assertEqual(self.admitted, 1)
        return result, owner

    def test_exact_normal_completion_actual_exit_and_exclusive_logs(self):
        got, owner = self.run_transport()
        self.assertTrue(got['passed']); self.assertEqual(got['returncode'], 0)
        self.assertTrue(got['worker_reaped']); self.assertFalse(got['descendant_cleanup_verified'])
        self.assertFalse(owner.poisoned)
        for name in ('stdout.bin','stderr.bin','terminal.json'):
            self.assertEqual((self.root/name).stat().st_mode & 0o777, 0o600)
        self.assertEqual(got['terminal'], r.validate_terminal((self.root/'terminal.json').read_bytes(), IDS, process_returncode=0))

    def test_dual_pipe_saturation_is_drained_without_truncation(self):
        with patch.object(t, 'STREAM_BYTES', 128*1024):
            got, _ = self.run_transport('dual')
        self.assertEqual(got['stream_bytes'], {'stdout': 128*1024, 'stderr': 128*1024})
        for name, byte in (('stdout', b'o'), ('stderr', b'e')):
            self.assertEqual((self.root/(name+'.bin')).read_bytes(), byte*(128*1024))
            self.assertEqual(got['stream_sha256'][name], hashlib.sha256(byte*(128*1024)).hexdigest())

    def test_stdout_cap_failure_retains_prefix_and_poison_prevents_next_launch(self):
        owner = t.Transport(r.validate_terminal)
        with patch.object(t, 'STREAM_BYTES', 4096), self.assertRaises(t.TransportFailure) as failure:
            self.run_transport('outcap', owner=owner)
        got = failure.exception.receipt
        self.assertEqual(got['first_failure']['code'], 'stdout_cap')
        self.assertEqual((self.root/'stdout.bin').stat().st_size, 4096)
        self.assertTrue(got['worker_reaped']); self.assertFalse(got['descendant_cleanup_verified'])
        with patch.object(subprocess, 'Popen', side_effect=AssertionError('no second launch')), self.assertRaises(t.TransportFailure):
            owner.run(self.prepared, admit=self.admit, check_storage=self.capacity)
        self.assertEqual(self.admitted, 1)

    def test_stderr_cap_is_independent(self):
        with patch.object(t, 'STREAM_BYTES', 4096), self.assertRaises(t.TransportFailure) as failure:
            self.run_transport('errcap')
        self.assertEqual(failure.exception.receipt['first_failure']['code'], 'stderr_cap')
        self.assertEqual((self.root/'stderr.bin').stat().st_size, 4096)

    def test_nonzero_exit_with_fully_written_pass_is_rejected(self):
        seen = []
        def validator(raw, ids, *, process_returncode):
            seen.append(process_returncode)
            return r.validate_terminal(raw, ids, process_returncode=process_returncode)
        with self.assertRaises(t.TransportFailure): self.run_transport('nonzero', validator=validator)
        self.assertEqual(seen, [7]); self.assertTrue(json.loads((self.root/'terminal.json').read_text())['passed'])

    def test_missing_terminal_fails(self):
        with self.assertRaises(t.TransportFailure) as failure: self.run_transport('missing')
        self.assertEqual(failure.exception.receipt['first_failure']['code'], 'terminal_validation')
        self.assertTrue(failure.exception.receipt['worker_reaped'])

    def test_duplicate_truncated_non_utf8_terminal_fails(self):
        for mode in ('duplicate','truncated','unicode'):
            sub = self.root/mode; sub.mkdir(mode=0o700)
            self.prepared['evidence_directory'] = str(sub)
            # The fixed inert route writes to self.root; retain separate run roots.
            prior = self.root; self.root = sub
            try:
                with self.assertRaises(t.TransportFailure): self.run_transport(mode)
            finally: self.root = prior

    def test_timeout_uses_single_term_kill_window_and_reaps_owned_child(self):
        self.prepared['deadline'] = REAL_MONOTONIC()+0.20
        before = REAL_MONOTONIC()
        with self.assertRaises(t.TransportFailure) as failure: self.run_transport('hang')
        got = failure.exception.receipt
        self.assertEqual(got['first_failure']['code'], 'worker_deadline')
        self.assertEqual(got['stop_deadline'], got['first_failure']['at']+5)
        self.assertEqual(got['returncode'], -signal.SIGKILL)
        self.assertTrue(got['worker_reaped']); self.assertLess(REAL_MONOTONIC()-before, 3)
        self.assertFalse(got['descendant_cleanup_verified'])

    def test_late_final_validator_cannot_return_pass(self):
        offset = [0]
        def validator(raw, ids, *, process_returncode):
            value = r.validate_terminal(raw, ids, process_returncode=process_returncode)
            offset[0] = 601
            return value
        with patch.object(time, 'monotonic', side_effect=lambda: REAL_MONOTONIC()+offset[0]), self.assertRaises(t.TransportFailure) as failure:
            self.run_transport(validator=validator)
        self.assertEqual(failure.exception.receipt['first_failure']['code'], 'worker_deadline')
        self.assertFalse(failure.exception.receipt['passed'])

    def test_storage_failure_poison_before_launch(self):
        def full(): raise OSError('synthetic capacity refusal')
        with patch.object(subprocess, 'Popen', side_effect=AssertionError('no child')), self.assertRaises(t.TransportFailure) as failure:
            t.Transport(r.validate_terminal).run(self.prepared, admit=self.admit, check_storage=full)
        self.assertEqual(failure.exception.receipt['first_failure']['error_type'], 'OSError')
        self.assertIsNone(failure.exception.receipt['worker_pid'])

    def test_original_deadline_admission_and_exact_argv(self):
        for bad in (True, float('nan'), float('inf'), REAL_MONOTONIC()-1, REAL_MONOTONIC()+601):
            value = dict(self.prepared, deadline=bad)
            with patch.object(subprocess,'Popen', side_effect=AssertionError('no child')), self.assertRaises(t.TransportFailure):
                t.Transport(r.validate_terminal).run(value, admit=self.admit, check_storage=self.capacity)
        for bad in (['python','-c','pass'], self.prepared['argv']+['extra']):
            value = dict(self.prepared, argv=bad)
            with self.assertRaises(t.TransportFailure): t.Transport(r.validate_terminal).run(value, admit=self.admit, check_storage=self.capacity)

    def test_symlink_ancestor_and_collision_fail_before_spawn(self):
        link = self.root/'link'; link.symlink_to(self.root, target_is_directory=True)
        value = dict(self.prepared, evidence_directory=str(link))
        with patch.object(subprocess,'Popen',side_effect=AssertionError('no child')), self.assertRaises(t.TransportFailure):
            t.Transport(r.validate_terminal).run(value, admit=self.admit, check_storage=self.capacity)
        (self.root/'terminal.json').write_bytes(b'existing')
        with self.assertRaises(t.TransportFailure): self.run_transport()
        self.assertEqual((self.root/'terminal.json').read_bytes(),b'existing')
        self.assertFalse((self.root/'stdout.bin').exists())

    def test_nonphysical_path_spellings_are_refused(self):
        for value in ('//tmp', '/tmp/../tmp', '/tmp/./a', '/tmp//a', 'tmp'):
            with self.subTest(value=value), self.assertRaises(t.Refusal): t._path(value)

    def test_fifo_terminal_is_nonblocking_refusal(self):
        os.mkfifo(self.root/'fifo', 0o600)
        directory = t._Directory(str(self.root), lambda: None)
        try:
            with self.assertRaises(t.Refusal): t._read_terminal(directory, 'fifo', lambda: None)
        finally: directory.close()

    def test_primary_failure_survives_cleanup_signal_error(self):
        owner = t.Transport(r.validate_terminal)
        actual_killpg = os.killpg
        calls = []
        def fail_term(pid, sig):
            calls.append((pid,sig)); actual_killpg(pid,signal.SIGKILL)
            raise OSError('inert cleanup injection after exact owned kill')
        self.prepared['deadline'] = REAL_MONOTONIC()+0.20
        with patch.object(os,'killpg',side_effect=fail_term), self.assertRaises(t.TransportFailure) as failure:
            self.run_transport('hang', owner=owner)
        for proc in self.children: proc.wait(timeout=2)
        got = failure.exception.receipt
        self.assertEqual(got['first_failure']['code'],'worker_deadline')
        self.assertEqual(got['cleanup_errors'],['OSError'])
        self.assertEqual(len(calls),1); self.assertTrue(owner.poisoned)

    def test_inherited_resource_limits_unchanged_and_constants(self):
        limits = {n:resource.getrlimit(getattr(resource,n)) for n in ('RLIMIT_FSIZE','RLIMIT_CPU','RLIMIT_AS','RLIMIT_NOFILE')}
        with patch.object(resource,'setrlimit',side_effect=AssertionError('no lowering')): self.run_transport()
        self.assertEqual(limits,{n:resource.getrlimit(getattr(resource,n)) for n in limits})
        self.assertEqual((t.CHUNK_BYTES,t.STREAM_BYTES,t.TERMINAL_BYTES,t.WORKER_SECONDS,t.STOP_SECONDS),(65536,4194304,4194304,600,5))

    def test_failure_immediately_after_tentative_pass_revokes_receipt(self):
        late = [False]
        def clock():
            frame = sys._getframe(1)
            while frame is not None:
                if frame.f_code is t.Transport.run.__code__:
                    receipt = frame.f_locals.get('receipt', {})
                    if receipt.get('passed') is True: late[0] = True
                    break
                frame = frame.f_back
            return REAL_MONOTONIC() + (601 if late[0] else 0)
        owner = t.Transport(r.validate_terminal)
        with patch.object(time, 'monotonic', side_effect=clock), self.assertRaises(t.TransportFailure) as failure:
            self.run_transport(owner=owner)
        got = failure.exception.receipt
        self.assertTrue(late[0])
        self.assertEqual(got['first_failure']['code'], 'worker_deadline')
        self.assertIs(got['passed'], False)
        self.assertTrue(got['worker_reaped'])
        self.assertEqual(got['returncode'], 0)
        self.assertIs(got['future_launches_allowed'], False)
        self.assertTrue(owner.poisoned)

    def test_final_stream_hash_receipt_cannot_hide_late_completion(self):
        offset = [0]
        real_hash = hashlib.sha256
        class Digest:
            def __init__(self, *args): self.inner = real_hash(*args)
            def update(self, value): self.inner.update(value)
            def hexdigest(self):
                value = self.inner.hexdigest()
                # Empty stream hashes are finalized in the final handle block.
                if value == real_hash(b'').hexdigest(): offset[0] = 601
                return value
        with patch.object(time,'monotonic',side_effect=lambda:REAL_MONOTONIC()+offset[0]), patch.object(hashlib,'sha256',side_effect=Digest), self.assertRaises(t.TransportFailure) as failure:
            self.run_transport()
        self.assertEqual(failure.exception.receipt['first_failure']['code'],'worker_deadline')
        self.assertFalse(failure.exception.receipt['passed'])
        self.assertTrue(failure.exception.receipt['worker_reaped'])

    def test_slow_admission_exhausts_original_clock_without_spawn(self):
        offset=[0]
        def admission(value): self.admit(value);offset[0]=601
        owner=t.Transport(r.validate_terminal)
        with patch.object(time,'monotonic',side_effect=lambda:REAL_MONOTONIC()+offset[0]), patch.object(subprocess,'Popen',side_effect=AssertionError('no launch')),self.assertRaises(t.TransportFailure) as failure:
            owner.run(self.prepared,admit=admission,check_storage=self.capacity)
        self.assertEqual(failure.exception.receipt['first_failure']['code'],'worker_deadline')
        self.assertFalse((self.root/'stdout.bin').exists())

    def test_popen_error_is_latched_and_log_creation_retained(self):
        with patch.object(subprocess,'Popen',side_effect=OSError('inert spawn failure')), self.assertRaises(t.TransportFailure) as failure:
            t.Transport(r.validate_terminal).run(self.prepared,admit=self.admit,check_storage=self.capacity)
        got=failure.exception.receipt
        self.assertEqual(got['first_failure']['code'],'spawn')
        self.assertIsNone(got['worker_pid']);self.assertFalse(got['worker_reaped'])
        self.assertEqual((self.root/'stdout.bin').read_bytes(),b'')

    def test_log_persistence_error_refuses_after_worker_exit(self):
        with patch.object(os,'fsync',side_effect=OSError('inert disk failure')),self.assertRaises(t.TransportFailure) as failure:
            self.run_transport()
        self.assertEqual(failure.exception.receipt['first_failure']['code'],'log_persistence')
        self.assertTrue(failure.exception.receipt['worker_reaped'])
        self.assertFalse(failure.exception.receipt['passed'])

    def test_terminal_replacement_and_caps_are_refused(self):
        path=self.root/'terminal.json';path.write_bytes(b'{}')
        directory=t._Directory(str(self.root),lambda:None)
        real_read=os.read; switched=[False]
        def replace(fd,count):
            data=real_read(fd,count)
            if not switched[0]:
                switched[0]=True;path.rename(self.root/'original-terminal');path.write_bytes(b'{}')
            return data
        try:
            with patch.object(os,'read',side_effect=replace),self.assertRaises(t.Refusal):t._read_terminal(directory,'terminal.json',lambda:None)
            with patch.object(t,'TERMINAL_BYTES',1),self.assertRaises(t.Refusal):t._read_terminal(directory,'terminal.json',lambda:None)
        finally:directory.close()


if __name__=='__main__':
    print('Retained inert evidence:', EVIDENCE, flush=True)
    print('Inert child literal SHA256:',hashlib.sha256(INERT.encode()).hexdigest(),flush=True)
    unittest.main(verbosity=2)
