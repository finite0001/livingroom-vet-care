"""Real local child/pipe tests; no Docker, PostgreSQL, network or credentials."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'tests/controlled-drugs/engine/candidate/record_review_v3_phased_session.py'
SPEC = importlib.util.spec_from_file_location('phased', SOURCE)
phased = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(phased)

CHILD = r'''
import json,os,re,signal,sys,time
mode=sys.argv[1]
received=open(sys.argv[2],'ab',buffering=0)
if mode=='nonreading':time.sleep(10)
if mode=='killhang':signal.signal(signal.SIGTERM,signal.SIG_IGN)
for line in sys.stdin.buffer:
 received.write(line)
 if not line.startswith(b'select jsonb_build_object('):continue
 match=re.search(rb"'nonce','([0-9a-f]+)','index',(-?\d+),'name','([a-z_]+)'",line)
 if not match:sys.exit(91)
 nonce,index,name=match.groups();index=int(index)
 marker={'nonce':nonce.decode(),'index':index,'name':name.decode(),
         'backend_pid':123,'backend_start':'2026-10-22T00:00:00.000001Z'}
 if name==b'provenance_negatives' and mode=='provenancefail':sys.stderr.write('PROVENANCE_PRIMARY_FAILURE_PRIVATE\n');sys.stderr.flush();sys.exit(7)
 if name==b'provenance_negatives' and mode=='provenancehang':time.sleep(10)
 if index==0:
  if mode=='earlyzero':sys.exit(0)
  if mode=='earlynonzero':sys.stderr.write('PRIMARY_SQL_FAILURE_PRIVATE\n');sys.stderr.flush();sys.exit(3)
  if mode=='missing':time.sleep(10)
  if mode=='killhang':time.sleep(10)
  if mode=='chatter':
   while True:sys.stdout.write('not a marker\n');sys.stdout.flush();time.sleep(.005)
  if mode=='stdoutcap':os.write(1,b'x'*16384);time.sleep(10)
  if mode=='stderrcap':os.write(2,b'x'*16384);time.sleep(10)
  if mode=='partialcap':os.write(1,b'x'*2048);time.sleep(10)
  if mode=='wrongnonce':marker['nonce']='0'*32
  if mode=='wrongindex':marker['index']=1
  if mode=='wrongname':marker['name']='managed_fixture'
  if mode=='backendpid':marker['backend_pid']=124
  if mode=='backendstart':marker['backend_start']='2026-10-22T00:00:00.000002Z'
  if mode=='booleanpid':marker['backend_pid']=True
  if mode=='extra':marker['extra']=1
  if mode=='malformed':os.write(1,b'{"lrv_gate_b_phase_marker":broken}\n');time.sleep(10)
  if mode=='invalidutf8':os.write(1,b'\xff\n')
 payload=json.dumps({'lrv_gate_b_phase_marker':marker}).encode()+b'\n'
 if mode=='duplicate' and index==0:payload+=payload
 if mode=='duplicatekey' and index==0:payload=payload.replace(b'"index": 0',b'"index": 0, "index": 0')
 if mode=='fragment':
  for start in range(0,len(payload),17):os.write(1,payload[start:start+17]);time.sleep(.001)
 else:os.write(1,payload)
 if mode=='slow' and index>=0:time.sleep(.035)
 if mode=='lateextra' and name==b'internal_boundaries':os.write(1,payload)
if mode=='finalhang':time.sleep(10)
if mode=='finalnonzero':sys.stderr.write('FINAL_PRIMARY_FAILURE_PRIVATE\n');sys.stderr.flush();sys.exit(4)
'''


class PhasedSessionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='phased-harness-')
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.phases = [(name, '-- PHASE_INPUT ' + name + '\n') for name in phased.PHASE_NAMES]
        self.runtime = SimpleNamespace(deadline=time.monotonic() + 5, cleanup_deadline=None)

    def session(self, mode='normal', *, seconds=0.4, limit=8192, reader=8192, admit_delay=0):
        argv = [sys.executable, '-B', '-u', '-c', CHILD, mode, str(self.folder / 'child-received.log')]
        def admit():
            if admit_delay:
                time.sleep(admit_delay)
            return argv, {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}, self.folder
        return phased._Session(self.runtime, self.phases, self.folder, admit,
                               phase_seconds=seconds, stream_limit=limit, reader_limit=reader)

    def receipt(self):
        return json.loads((self.folder / 'receipt.json').read_text())

    def failed(self, mode, code=None, **kwargs):
        session = self.session(mode, **kwargs)
        with self.assertRaises(Exception) as caught:
            session.execute()
        receipt = self.receipt()
        self.assertFalse(receipt['passed'])
        self.assertEqual(receipt['primary_failure']['type'], type(caught.exception).__name__)
        if code:
            self.assertEqual(receipt['primary_failure']['code'], code)
        if session.process:
            self.assertIsNotNone(session.process.poll(), 'owned child left alive')
        self.assertIsNotNone(self.runtime.cleanup_deadline)
        return session, receipt

    def test_success_same_backend_all_phases_full_raw_and_framed_evidence(self):
        output = self.session().execute()
        receipt = self.receipt()
        self.assertTrue(receipt['passed'])
        self.assertEqual(receipt['backend']['pid'], 123)
        self.assertEqual([row['name'] for row in receipt['phases']], list(phased.PHASE_NAMES))
        self.assertTrue(all(row['complete'] for row in receipt['phases']))
        self.assertEqual(output.count(phased.MARKER), 9)
        expected = phased._marker(receipt['nonce'], -1, 'identity')
        for index, (name, sql) in enumerate(self.phases):
            raw = (self.folder / f'{index:02d}-{name}.sql').read_bytes()
            self.assertEqual(raw, sql.encode())
            expected += raw + phased._marker(receipt['nonce'], index, name)
        self.assertEqual((self.folder / 'framed-stdin.sql').read_bytes(), expected)
        self.assertEqual((self.folder / 'dispatched-stdin.sql').read_bytes(), expected)
        self.assertEqual((self.folder / 'child-received.log').read_bytes(), expected)
        self.assertIsNone(self.runtime.cleanup_deadline)

    def test_fragmented_markers_are_not_lost(self):
        self.session('fragment').execute()
        self.assertTrue(self.receipt()['passed'])

    def test_bad_marker_binding_order_shape_and_backend_refuse_before_next_phase(self):
        for mode in ('wrongnonce', 'wrongindex', 'wrongname', 'duplicate', 'duplicatekey',
                     'backendpid', 'backendstart', 'booleanpid', 'extra', 'malformed'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory(dir=self.folder) as folder:
                previous = self.folder
                self.folder = Path(folder)
                try:
                    self.failed(mode)
                    sent = (self.folder / 'dispatched-stdin.sql').read_bytes()
                    self.assertNotIn(b'-- PHASE_INPUT managed_fixture', sent)
                finally:
                    self.folder = previous

    def test_chatter_does_not_reset_phase_deadline(self):
        started = time.monotonic()
        self.failed('chatter', 'phase_deadline', seconds=0.12)
        self.assertLess(time.monotonic() - started, 1)
        self.assertNotIn(b'-- PHASE_INPUT managed_fixture', (self.folder / 'dispatched-stdin.sql').read_bytes())

    def test_missing_marker_refuses(self):
        self.failed('missing', 'phase_deadline', seconds=0.12)

    def test_nonreading_child_dispatch_is_nonblocking_and_bounded(self):
        self.phases[0] = (phased.PHASE_NAMES[0], '-- ' + 'x' * 1048576 + '\n')
        self.failed('nonreading', 'phase_deadline', seconds=0.12)
        sent = (self.folder / 'dispatched-stdin.sql').stat().st_size
        self.assertLess(sent, 1048576)
        self.assertNotIn(b'-- PHASE_INPUT managed_fixture', (self.folder / 'dispatched-stdin.sql').read_bytes())

    def test_partial_writes_complete_exactly(self):
        original = os.write
        def partial(fd, data):
            return original(fd, data[:11])
        with patch.object(phased.os, 'write', partial):
            self.session(seconds=1).execute()
        self.assertEqual((self.folder / 'framed-stdin.sql').read_bytes(),
                         (self.folder / 'child-received.log').read_bytes())

    def test_early_zero_and_nonzero_exit_cannot_complete_phase(self):
        for mode in ('earlyzero', 'earlynonzero'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory(dir=self.folder) as folder:
                previous = self.folder
                self.folder = Path(folder)
                try:
                    self.failed(mode, 'child_exit_before_phase_completion')
                    self.assertNotIn(b'-- PHASE_INPUT managed_fixture', (self.folder / 'dispatched-stdin.sql').read_bytes())
                    if mode == 'earlynonzero':
                        self.assertIn(b'PRIMARY_SQL_FAILURE_PRIVATE', (self.folder / 'stderr.log').read_bytes())
                finally:
                    self.folder = previous

    def test_stream_caps_include_stdout_and_stderr(self):
        for mode in ('stdoutcap', 'stderrcap'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory(dir=self.folder) as folder:
                previous = self.folder
                self.folder = Path(folder)
                try:
                    self.failed(mode, 'output_limit', limit=1024)
                    self.assertLessEqual((self.folder / ('stdout.log' if mode == 'stdoutcap' else 'stderr.log')).stat().st_size, 1024)
                finally:
                    self.folder = previous

    def test_reader_partial_line_has_independent_cap(self):
        self.failed('partialcap', 'reader_limit', reader=1024)

    def test_outer_deadline_is_not_reset_by_new_phases(self):
        self.runtime.deadline = time.monotonic() + 0.11
        original = self.runtime.deadline
        self.failed('slow', 'phase_deadline', seconds=0.5)
        self.assertEqual(self.runtime.deadline, original)
        self.assertTrue(all(row['deadline'] <= original for row in self.receipt()['phases']))

    def test_admission_and_spawn_are_inside_first_phase(self):
        self.failed('normal', 'phase_deadline', seconds=0.03, admit_delay=0.06)
        self.assertFalse((self.folder / 'child-received.log').exists())

    def test_slow_process_spawn_is_inside_first_phase(self):
        original = subprocess.Popen
        def slow_spawn(*args, **kwargs):
            time.sleep(0.06)
            return original(*args, **kwargs)
        with patch.object(phased.subprocess, 'Popen', slow_spawn):
            self.failed('normal', 'phase_deadline', seconds=0.03)

    def test_final_eof_and_exit_use_last_phase_deadline(self):
        self.failed('finalhang', 'phase_deadline', seconds=0.12)
        last = self.receipt()['phases'][-1]
        self.assertEqual(last['name'], 'internal_boundaries')
        self.assertFalse(last['complete'])

    def test_final_nonzero_and_extra_marker_refuse(self):
        for mode, code in (('finalnonzero', 'child_nonzero_exit'), ('lateextra', 'marker_order_or_binding')):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory(dir=self.folder) as folder:
                previous = self.folder
                self.folder = Path(folder)
                try:
                    self.failed(mode, code)
                finally:
                    self.folder = previous

    def test_cleanup_failure_preserves_first_error_and_existing_reserve(self):
        session = self.session('missing', seconds=0.08)
        original = session.terminate
        self.runtime.cleanup_deadline = time.monotonic() + 10
        deadline = self.runtime.cleanup_deadline
        def cleanup():
            original()
            raise OSError('secondary private cleanup failure')
        with patch.object(session, 'terminate', cleanup), self.assertRaisesRegex(phased.SessionFailure, 'phase_deadline'):
            session.execute()
        receipt = self.receipt()
        self.assertEqual(receipt['primary_failure']['code'], 'phase_deadline')
        self.assertEqual(receipt['cleanup_failure']['type'], 'OSError')
        self.assertEqual(self.runtime.cleanup_deadline, deadline)

    def test_child_ignoring_terminate_is_killed_within_same_reserve(self):
        started = time.monotonic()
        session, receipt = self.failed('killhang', 'phase_deadline', seconds=0.08)
        self.assertEqual(session.process.returncode, -9)
        self.assertLess(time.monotonic() - started, 2)
        self.assertIsNone(receipt['cleanup_failure'])

    def test_invalid_utf8_keeps_raw_bytes_and_refuses_success(self):
        self.failed('invalidutf8')
        self.assertIn(b'\xff', (self.folder / 'stdout.log').read_bytes())

    def test_fault_phase_failure_or_deadline_never_dispatches_internal_phase(self):
        for mode, code in (('provenancefail','child_exit_before_phase_completion'), ('provenancehang','phase_deadline')):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory(dir=self.folder) as folder:
                previous=self.folder;self.folder=Path(folder)
                try:
                    self.failed(mode,code,seconds=0.12)
                    sent=(self.folder/'dispatched-stdin.sql').read_bytes()
                    self.assertIn(b'PHASE_INPUT provenance_negatives',sent)
                    self.assertNotIn(b'PHASE_INPUT internal_boundaries',sent)
                finally:self.folder=previous

    def test_phase_inventory_and_defaults_are_fixed(self):
        self.assertEqual(phased.PHASE_SECONDS, 120)
        self.assertEqual(phased.STREAM_LIMIT, 128 * 1024 * 1024)
        self.assertEqual(phased.CLEANUP_SECONDS, 180)
        self.assertEqual(phased.PHASE_NAMES, ('native_setup', 'managed_fixture', 'readonly_baseline',
            'effects_oracle', 'membership_oracle', 'readonly_verification', 'provenance_negatives', 'internal_boundaries'))
        self.phases.reverse()
        self.failed('normal', 'phase_inventory')

    def test_public_api_pins_endpoint_and_immutable_id(self):
        self.runtime.folder = self.folder
        self.runtime.command_number = 0
        self.runtime.container = 'a' * 64
        self.runtime.endpoint = 'unix:///private-owned-docker.sock'
        self.runtime.candidate_phase_deadline = None
        self.runtime.log = io.StringIO()
        self.runtime.check_config = lambda: None
        def verify():
            self.assertIsNotNone(self.runtime.candidate_phase_deadline)
            self.assertLessEqual(self.runtime.candidate_phase_deadline, self.runtime.deadline)
            return {'Id': self.runtime.container}
        self.runtime.verify = verify
        self.runtime.docker = lambda argv: ['docker', '--host', self.runtime.endpoint] + argv[1:]
        captured = {}
        def execute(session):
            argv, env, cwd = session.admit()
            captured.update(argv=argv, env=env, cwd=cwd)
            return 'test-only API contract'
        with patch.object(phased._Session, 'execute', execute):
            self.assertEqual(phased.run(self.runtime, self.phases), 'test-only API contract')
        self.assertIn('a' * 64, captured['argv'])
        self.assertIn('ON_ERROR_STOP=1', captured['argv'])
        self.assertEqual(captured['argv'][captured['argv'].index('-U')+1], 'supabase_admin')
        self.assertEqual(captured['env']['DOCKER_HOST'], self.runtime.endpoint)
        self.assertNotIn('DOCKER_CONTEXT', captured['env'])
        self.assertEqual(captured['cwd'], ROOT)
        self.assertIsNone(self.runtime.candidate_phase_deadline)

    def test_admission_deadline_field_restored_on_verification_failure(self):
        self.runtime.folder = self.folder
        self.runtime.command_number = 0
        self.runtime.candidate_phase_deadline = time.monotonic() + 2
        previous = self.runtime.candidate_phase_deadline
        self.runtime.log = io.StringIO()
        self.runtime.check_config = lambda: None
        def verify():
            self.assertLessEqual(self.runtime.candidate_phase_deadline, previous)
            raise RuntimeError('private verification failure')
        self.runtime.verify = verify
        with self.assertRaisesRegex(RuntimeError, 'private verification failure'):
            phased.run(self.runtime, self.phases)
        self.assertEqual(self.runtime.candidate_phase_deadline, previous)
        receipt = json.loads((self.folder / '0001-phased-session/receipt.json').read_text())
        self.assertFalse(receipt['passed'])
        self.assertEqual(receipt['primary_failure']['type'], 'RuntimeError')


if __name__ == '__main__':
    unittest.main()
