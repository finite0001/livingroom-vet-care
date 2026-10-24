"""Tiny synthetic physical observations; no child, network, DB or target imports."""
from copy import deepcopy
from dataclasses import FrozenInstanceError, replace
import importlib.util
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
PARENT = HERE.parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


p = load('parent_evidence_under_test', HERE / 'parent_evidence.py')
o = load('parent_evidence_observer', PARENT / 'output_observer.py')
f = load('parent_evidence_pair_fixtures', PARENT / 'test_guard_report.py')
pair_reader = load('parent_evidence_pair_reader', PARENT/'pair_reader.py')
CLOCK = time.monotonic
RETAINED = []


class ParentEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.no_process = patch.object(subprocess, 'Popen', side_effect=AssertionError('No child allowed'))
        cls.no_network = patch.object(socket, 'socket', side_effect=AssertionError('No network allowed'))
        cls.no_process.start()
        cls.no_network.start()

    @classmethod
    def tearDownClass(cls):
        cls.no_network.stop()
        cls.no_process.stop()

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='lrv-parent-evidence-')).resolve()
        self.root.chmod(0o700)
        RETAINED.append(str(self.root))
        self.deadline = CLOCK() + 30
        self.names = {slot: slot + ('.log' if slot in ('stdout', 'stderr') else '.json') for slot in o.SLOTS}
        self.held = o.HeldOutput(str(self.root), self.names, deadline=self.deadline, check=lambda: None)
        self.context, self.guard, self.terminal = f.fixtures()
        self.job = {'kind': 'portable-worker-job-v2', 'job_id': 'job', 'deadline': self.deadline,
            'suite': {}, 'guard': {}, 'implementation': {}, 'output': {}, 'historical638': None, 'partition': None}
        self.job_raw = p.canonical(self.job) + b'\n'
        self.context['job_sha256'] = p.digest(self.job_raw)
        self.guard['job_sha256'] = self.context['job_sha256']
        self.terminal['job_sha256'] = self.context['job_sha256']
        self.terminal_raw, self.guard_raw = f.encode(self.guard, self.terminal)
        self.reader = pair_reader.HeldPairReader(str(self.root), self.names['guard'], self.context,
            deadline=self.deadline, validate_pair=f.g.validate_pair, validate_terminal=f.r.validate_terminal)
        self.write('job', self.job_raw)
        self.write('stdout', b'')
        self.write('stderr', b'')
        self.write('terminal', self.terminal_raw)
        self.write('guard', self.guard_raw)
        self.pair = self.reader(self.terminal_raw,self.context['expected_ids'],process_returncode=0)
        self.t = {'kind': 'portable-transport-v1', 'passed': True, 'started': CLOCK()-2,
            'first_failure': None, 'cleanup_errors': [], 'descendant_cleanup_verified': False,
            'future_launches_allowed': True, 'worker_pid': 123, 'worker_reaped': True, 'returncode': 0,
            'paths': {name: str(self.root/self.names[name]) for name in ('stdout', 'stderr', 'terminal')},
            'spawn_returned_at': CLOCK()-1.9, 'terminal_sha256': p.digest(self.terminal_raw),
            'terminal_bytes': len(self.terminal_raw), 'terminal': self.pair, 'elapsed': 1,
            'completion_basis': 'exact_terminal_exit_zero_finite_trusted_tests',
            'stream_bytes': {'stdout': 0, 'stderr': 0},
            'stream_sha256': {name: p.digest(b'') for name in ('stdout', 'stderr')}}

    def tearDown(self):
        if not self.held.closed:
            self.held.close()
        # Retain tiny synthetic success/refusal files; never delete prior evidence.

    def write(self, slot, raw):
        path = self.root/self.names[slot]
        fd = os.open(path, os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW, 0o600)
        try:
            view = memoryview(raw)
            while view:
                count = os.write(fd, view)
                if count <= 0:
                    raise OSError('short fixture write')
                view = view[count:]
        finally:
            os.close(fd)

    def verifier(self, **kw):
        args = dict(output_observer=self.held, deadline=self.deadline, check=lambda: None,
            validate_pair=f.g.validate_pair, validate_terminal=f.r.validate_terminal)
        args.update(kw)
        return p.JobEvidence(self.job_raw, self.context, str(self.root), self.names, **args)

    def verify(self, verifier=None, receipt=None, observations=None, closed=True):
        reader = self.reader if closed is True else SimpleNamespace(**{
            **self.reader.__dict__, 'closed':closed})
        v = verifier or self.verifier()
        if observations is not None:
            with patch.object(self.held,'observe',return_value=observations):
                return v.verify(self.t if receipt is None else receipt,reader=reader)
        return v.verify(self.t if receipt is None else receipt,reader=reader)

    def test_exact_pair_and_physical_five_slots_produce_immutable_summary(self):
        v = self.verifier()
        result = self.verify(v)
        self.assertEqual(result.job_id, 'job')
        self.assertEqual(result.expected_ids, (f.ID,))
        self.assertEqual(result.slot_bytes[1:3], (0, 0))
        self.assertEqual(result.pair_sha256, p.digest(p.canonical(self.pair)))
        self.assertEqual(self.verify(v), result)
        with self.assertRaises(FrozenInstanceError):
            result.job_id = 'changed'

    def test_observation_from_another_directory_cannot_credit_this_job(self):
        other = self.root/'other_output';other.mkdir(mode=0o700)
        observer=o.HeldOutput(str(other),self.names,deadline=self.deadline,check=lambda:None)
        try:
            for name in self.names.values():
                path=other/name;path.write_bytes((self.root/name).read_bytes());path.chmod(0o600)
            with self.assertRaisesRegex(ValueError,'another directory'):self.verifier(output_observer=observer)
        finally:observer.close()

    def test_live_observer_root_replacement_is_refused(self):
        v=self.verifier()
        self.root.rename(self.root.with_name(self.root.name+'-retained'))
        self.root.mkdir(mode=0o700)
        with self.assertRaises((ValueError,OSError)):self.verify(v)
        self.assertTrue(v.failed);self.assertIsNone(v.baseline)

    def test_actual_output_permission_change_refuses_without_summary(self):
        v=self.verifier();(self.root/self.names['stdout']).chmod(0o644)
        with self.assertRaises(ValueError):self.verify(v)
        self.assertTrue(v.failed);self.assertIsNone(v.baseline)

    def test_observer_capability_metadata_cannot_change_between_observations(self):
        v=self.verifier();self.verify(v)
        original=self.held.root_identity
        self.held.root_identity=(original[0],original[1]+1,*original[2:])
        try:
            with self.assertRaisesRegex(ValueError,'root identity'):self.verify(v)
        finally:self.held.root_identity=original

    def test_reader_for_another_directory_or_context_cannot_be_used(self):
        for key,value in [('path',self.root/'other'),('name','other.json'),('used',False),
                          ('expected_ids',('other::test',)),('deadline',self.deadline+1)]:
            reader=SimpleNamespace(**{**self.reader.__dict__,key:value})
            with self.subTest(key=key),self.assertRaises(ValueError):
                self.verifier().verify(self.t,reader=reader)

    def test_new_valid_guard_report_cannot_replace_prior_observation(self):
        v=self.verifier();self.verify(v)
        guard=deepcopy(self.guard);guard['report']['owned_directories']=2
        terminal,raw=f.encode(guard,self.terminal)
        self.write('guard',raw);self.write('terminal',terminal)
        self.t['terminal_sha256']=p.digest(terminal);self.t['terminal_bytes']=len(terminal)
        self.t['terminal']=f.g.validate_pair(terminal,raw,self.context,process_returncode=0,
            validate_terminal=f.r.validate_terminal,check=lambda:None)
        with self.assertRaisesRegex(ValueError,'previously verified'):self.verify(v)

    def test_failure_after_real_pair_validation_prevents_first_credit(self):
        state={'fail':False}
        def check():
            if state['fail']:raise OSError('capacity changed after validation')
        def validate(*args,**kwargs):
            pair=f.g.validate_pair(*args,**kwargs);state['fail']=True;return pair
        v=self.verifier(check=check,validate_pair=validate)
        with self.assertRaisesRegex(OSError,'after validation'):self.verify(v)
        self.assertIsNone(v.baseline);self.assertTrue(v.failed)

    def test_saved_stream_change_after_pair_validation_prevents_first_credit(self):
        def mutate(*args,**kwargs):
            pair=f.g.validate_pair(*args,**kwargs)
            self.write('stdout',b'late stream bytes')
            return pair
        v=self.verifier(validate_pair=mutate)
        with self.assertRaisesRegex(ValueError,'changed during validation'):self.verify(v)
        self.assertIsNone(v.baseline);self.assertTrue(v.failed)

    def test_named_root_change_after_pair_validation_prevents_first_credit(self):
        def replace_root(*args,**kwargs):
            pair=f.g.validate_pair(*args,**kwargs)
            self.root.rename(self.root.with_name(self.root.name+'-retained'))
            self.root.mkdir(mode=0o700)
            return pair
        v=self.verifier(validate_pair=replace_root)
        with self.assertRaises((ValueError,OSError)):self.verify(v)
        self.assertIsNone(v.baseline);self.assertTrue(v.failed)

    def test_same_bytes_leaf_replacement_during_validation_is_not_a_snapshot(self):
        def replace_leaf(*args,**kwargs):
            pair=f.g.validate_pair(*args,**kwargs)
            path=self.root/self.names['job'];path.rename(self.root/'retained-late-original.json')
            self.write('job',self.job_raw)
            return pair
        v=self.verifier(validate_pair=replace_leaf)
        with self.assertRaisesRegex(ValueError,'changed during validation'):self.verify(v)
        self.assertIsNone(v.baseline);self.assertTrue(v.failed)

    def test_nonempty_streams_match_actual_hash_and_count(self):
        for name in ('stdout', 'stderr'):
            raw = (name+' retained bytes').encode()
            self.write(name, raw)
            self.t['stream_bytes'][name] = len(raw)
            self.t['stream_sha256'][name] = p.digest(raw)
        self.assertGreater(self.verify().slot_bytes[1], 0)

    def test_context_and_names_are_detached_before_caller_changes(self):
        v = self.verifier()
        self.context['job_id'] = 'changed'
        self.context['expected_ids'].append('unrelated')
        self.names['guard'] = 'different.json'
        self.assertEqual(self.verify(v).expected_ids, (f.ID,))

    def test_exact_transport_fields_and_fixed_completion_basis(self):
        for change in ('extra', 'missing', 'kind', 'completion_basis'):
            t = deepcopy(self.t)
            if change == 'extra': t['extra'] = True
            elif change == 'missing': t.pop('worker_pid')
            else: t[change] = 'different'
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.verify(receipt=t)

    def test_true_flags_must_be_formal_boolean_true(self):
        for key in ('passed', 'worker_reaped', 'future_launches_allowed'):
            for value in (False, 1, None):
                t = deepcopy(self.t); t[key] = value
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    self.verify(receipt=t)

    def test_formal_exit_zero_and_positive_process_identity(self):
        for key, values in [('returncode', [1, -9, False, 0.0, None]), ('worker_pid', [0, -1, True, 1.0])]:
            for value in values:
                t = deepcopy(self.t); t[key] = value
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    self.verify(receipt=t)

    def test_failure_cleanup_and_universal_containment_claims_refuse(self):
        for key, value in [('first_failure', {}), ('first_failure', {'code': 'late'}),
            ('cleanup_errors', ['close']), ('cleanup_errors', {}),
            ('descendant_cleanup_verified', True), ('descendant_cleanup_verified', 0)]:
            t = deepcopy(self.t); t[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.verify(receipt=t)

    def test_timing_cannot_renew_the_original_deadline(self):
        for key, value in [('started', True), ('started', -1), ('spawn_returned_at', self.deadline+1),
            ('elapsed', -1), ('elapsed', 601), ('elapsed', float('nan'))]:
            t = deepcopy(self.t); t[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.verify(receipt=t)

    def test_receipt_output_paths_cannot_select_other_files(self):
        for name in ('stdout', 'stderr', 'terminal'):
            t = deepcopy(self.t); t['paths'][name] = str(self.root/'other.json')
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'paths'):
                self.verify(receipt=t)

    def test_saved_job_must_match_exact_bytes_including_whitespace(self):
        self.write('job', self.job_raw+b' ')
        with self.assertRaisesRegex(ValueError, 'saved job'):
            self.verify()

    def test_observations_must_be_ordered_exact_immutable_five(self):
        slots = self.held.observe()
        for bad in (list(slots), slots[:-1], slots+(slots[0],), (slots[1],slots[0],*slots[2:])):
            with self.subTest(type=type(bad)), self.assertRaises(ValueError):
                self.verify(observations=bad)

    def test_raw_bytes_cannot_disagree_with_observed_size_or_hash(self):
        slots = self.held.observe()
        for bad in (replace(slots[0], sha256='0'*64), replace(slots[0], size=0),
                    replace(slots[0], raw=b'{}'), replace(slots[0], raw=None)):
            with self.subTest(slot=bad), self.assertRaises(ValueError):
                self.verify(observations=(bad,*slots[1:]))

    def test_physical_identity_mode_owner_links_and_size_are_checked(self):
        slots = self.held.observe()
        for index, value in [(0,-1),(1,0),(2,0o100644),(3,os.getuid()+1),(4,2),(5,True)]:
            identity = list(slots[0].identity); identity[index] = value
            bad = replace(slots[0], identity=tuple(identity))
            with self.subTest(index=index), self.assertRaises(ValueError):
                self.verify(observations=(bad,*slots[1:]))

    def test_stream_buffers_are_not_accepted_as_physical_observations(self):
        slots = self.held.observe(); bad = replace(slots[1], raw=b'')
        with self.assertRaises(ValueError):
            self.verify(observations=(slots[0],bad,*slots[2:]))

    def test_stream_receipt_must_match_counts_hashes_and_keysets(self):
        for field, value in [('stream_bytes', {'stdout': False, 'stderr': 0}),
            ('stream_bytes', {'stdout': 1, 'stderr': 0}), ('stream_bytes', {'stdout': 0}),
            ('stream_sha256', {'stdout': '0'*64, 'stderr': p.digest(b'')})]:
            t=deepcopy(self.t);t[field]=value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.verify(receipt=t)

    def test_terminal_receipt_must_match_saved_file(self):
        for field,value in [('terminal_bytes',False),('terminal_bytes',1),('terminal_sha256','0'*64)]:
            t=deepcopy(self.t);t[field]=value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.verify(receipt=t)

    def test_pair_is_revalidated_with_the_real_existing_validator(self):
        guard=deepcopy(self.guard);guard['report']['denial_count']=1
        terminal,raw=f.encode(guard,self.terminal)
        self.write('guard',raw);self.write('terminal',terminal)
        self.t['terminal_sha256']=p.digest(terminal);self.t['terminal_bytes']=len(terminal)
        with self.assertRaises(ValueError):
            self.verify()

    def test_old_transport_pair_cannot_hide_different_saved_success(self):
        t=deepcopy(self.t);t['terminal']['result']['tests_run']=2
        with self.assertRaisesRegex(ValueError, 'saved pair'):
            self.verify(receipt=t)

    def test_duplicate_and_nonfinite_job_json_refuse(self):
        for raw in (b'{"x":1,"x":2}', b'NaN', b'{}{}', b'{"x":1e999}'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                p.JobEvidence(raw,self.context,str(self.root),self.names,deadline=self.deadline,
                    output_observer=self.held,check=lambda:None,validate_pair=f.g.validate_pair,validate_terminal=f.r.validate_terminal)

    def test_wrong_context_hash_and_job_deadline_refuse_before_use(self):
        for field, value in [('job_id','other'),('job_sha256','0'*64),('expected_ids',[f.ID,f.ID])]:
            context=deepcopy(self.context);context[field]=value
            with self.subTest(field=field), self.assertRaises(ValueError):
                p.JobEvidence(self.job_raw,context,str(self.root),self.names,deadline=self.deadline,
                    output_observer=self.held,check=lambda:None,validate_pair=f.g.validate_pair,validate_terminal=f.r.validate_terminal)
        with self.assertRaises(ValueError): self.verifier(deadline=self.deadline+1)

    def test_unclosed_pair_reader_never_passes(self):
        for value in (False,1,None):
            with self.subTest(value=value),self.assertRaises(ValueError): self.verify(closed=value)

    def test_mutation_after_first_verification_cannot_become_new_baseline(self):
        v=self.verifier();self.verify(v)
        self.write('stdout',b'later')
        self.t['stream_bytes']['stdout']=5;self.t['stream_sha256']['stdout']=p.digest(b'later')
        with self.assertRaisesRegex(ValueError, 'previously verified'):
            self.verify(v)

    def test_same_bytes_replacement_inode_is_not_the_same_evidence(self):
        v=self.verifier();self.verify(v)
        path=self.root/self.names['job'];path.rename(self.root/'retained-original-job.json')
        self.write('job',self.job_raw)
        with self.assertRaisesRegex(ValueError, 'previously verified'):
            self.verify(v)

    def test_any_refusal_is_sticky_even_if_caller_repairs_receipt(self):
        v=self.verifier();bad=deepcopy(self.t);bad['returncode']=1
        with self.assertRaises(ValueError):self.verify(v,receipt=bad)
        with self.assertRaisesRegex(ValueError, 'verifier is failed'):self.verify(v)

    def test_capacity_refusal_and_late_deadline_do_not_credit_a_baseline(self):
        state={'failed':False}
        def check():
            if state['failed']:raise OSError('capacity no longer available')
        v=self.verifier(check=check);state['failed']=True
        with self.assertRaises(OSError):self.verify(v)
        self.assertIsNone(v.baseline);self.assertTrue(v.failed)
        v=self.verifier()
        with patch.object(p.time,'monotonic',return_value=self.deadline):
            with self.assertRaises(TimeoutError):self.verify(v,observations=tuple())
        self.assertIsNone(v.baseline);self.assertTrue(v.failed)

    def test_validator_error_and_late_final_callback_are_retained_failures(self):
        def refused(*args,**kwargs):raise RuntimeError('pair lookup failed')
        v=self.verifier(validate_pair=refused)
        with self.assertRaisesRegex(RuntimeError,'pair lookup failed'):self.verify(v)
        self.assertTrue(v.failed)
        now={'value':CLOCK()}
        def late(*args,**kwargs):
            value=f.g.validate_pair(*args,**kwargs);now['value']=self.deadline;return value
        v=self.verifier(validate_pair=late);slots=self.held.observe()
        with patch.object(p.time,'monotonic',side_effect=lambda:now['value']):
            with self.assertRaises(TimeoutError):self.verify(v,observations=slots)
        self.assertIsNone(v.baseline);self.assertTrue(v.failed)

    def test_revalidated_pair_binding_and_schema_cannot_be_faked(self):
        for field,value in [('guard_bytes',False),('guard_sha256','0'*64),('kind','other'),('extra',True)]:
            def altered(*args,field=field,value=value,**kwargs):
                pair=f.g.validate_pair(*args,**kwargs);pair[field]=value;return pair
            v=self.verifier(validate_pair=altered)
            with self.subTest(field=field),self.assertRaises(ValueError):self.verify(v)

    def test_callback_cannot_mutate_the_detached_transport_input(self):
        def changed(*args,**kwargs):
            self.t['returncode']=1
            return f.g.validate_pair(*args,**kwargs)
        v=self.verifier(validate_pair=changed)
        self.assertEqual(self.verify(v).expected_ids,(f.ID,))
        with self.assertRaises(ValueError):self.verify(v)


if __name__ == '__main__':
    unittest.main(verbosity=2)
