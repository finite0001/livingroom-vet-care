"""Offline adapter tests. The callback fixture is explicitly NOT a historical run."""
from pathlib import Path
from copy import deepcopy
import importlib.util
import io
import hashlib
import time
import json
import os
import socket
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
# This fixture module loads a fresh V2 instance. Its two-argument factory
# binding below only supplies the explicit already-admitted public support path
# and its own finite fixture budget. It changes no target gate/clock/hash/result.
# The external regression worker retains the original formal 600-second deadline.
_adapter_path = HERE / 'portable_runtime_adapter_v2.py'
_adapter_raw = _adapter_path.read_bytes()
assert len(_adapter_raw) == 16232 and hashlib.sha256(_adapter_raw).hexdigest() == '22c0253e01b86409f86d10b7eea1fe8d66acc18fba736b4b0374c52a77e6536c'
spec = importlib.util.spec_from_file_location('private_portable_runtime_adapter_v2_fixture', _adapter_path)
adapter = importlib.util.module_from_spec(spec)
exec(compile(_adapter_raw, str(_adapter_path), 'exec'), adapter.__dict__)
_fixture_build_case = adapter.build_case

def _fixture_case(repo, callback):
    return _fixture_build_case(repo, callback, baseline_path=repo/adapter.BASELINE_SUPPORT,
        deadline=time.monotonic()+120, check=lambda: None)

adapter.build_case = _fixture_case


class AdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.callback_calls = []
        def inert_receipt_only():
            cls.callback_calls.append('shape-only-callback')
            return deepcopy(adapter.HISTORICAL_EXPECTED)
        cls.case = adapter.build_case(ROOT, inert_receipt_only)

    def test_exact25_names_four_replacements21_function_identities_and_helper(self):
        base = self.case._original_case
        wanted = set(unittest.defaultTestLoader.getTestCaseNames(base))
        self.assertEqual(len(wanted), 25)
        self.assertEqual(set(unittest.defaultTestLoader.getTestCaseNames(self.case)), wanted)
        replaced = {k for k in self.case.__dict__ if k.startswith('test_')}
        self.assertEqual(replaced, set(adapter.REPLACEMENTS))
        for name in wanted - replaced:
            self.assertIs(getattr(self.case, name), getattr(base, name))
        self.assertIs(self.case.exercise_actual_terminal_entrypoint, base.exercise_actual_terminal_entrypoint)
        self.assertNotIn('load_tests', self.case.__dict__)

    def test_all25_adapter_methods_offline_callback_receipt_only(self):
        # This exercises the four replacements and unchanged21; the real638
        # assertion remains a separate root-worker prerequisite, not credited here.
        stream = io.StringIO()
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(self.case)
        forbidden = AssertionError('Outer adapter harness forbids real process/network')
        with patch.object(subprocess, 'Popen', side_effect=forbidden), patch.object(subprocess, 'run', side_effect=forbidden), patch.object(socket, 'socket', side_effect=forbidden):
            result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
        self.assertTrue(result.wasSuccessful(), stream.getvalue())
        self.assertEqual(result.testsRun, 25)
        self.assertEqual(result.skipped, [])
        self.assertEqual(self.callback_calls, ['shape-only-callback'])

    def test_callback_exact_key_type_value_boundaries(self):
        adapter.admit_historical_receipt(deepcopy(adapter.HISTORICAL_EXPECTED))
        for name, value in adapter.HISTORICAL_EXPECTED.items():
            for kind in ('missing', 'type', 'value'):
                item = deepcopy(adapter.HISTORICAL_EXPECTED)
                if kind == 'missing': del item[name]
                elif kind == 'type': item[name] = 1 if type(value) is bool else (True if type(value) is int else [])
                else: item[name] = not value if type(value) is bool else (value + 1 if type(value) is int else value + '-forged')
                with self.subTest(key=name, kind=kind), self.assertRaises(AssertionError):
                    adapter.admit_historical_receipt(item)
        bad = dict(adapter.HISTORICAL_EXPECTED, extra=True)
        with self.assertRaises(AssertionError): adapter.admit_historical_receipt(bad)
        for item in (None, True, [], 'success'):
            with self.assertRaises(AssertionError): adapter.admit_historical_receipt(item)

    def test_callback_primary_failure_and_forged_receipt_not_swallowed(self):
        def fail(): raise RuntimeError('historical worker failed')
        case = adapter.build_case(ROOT, fail)
        with self.assertRaisesRegex(RuntimeError, 'historical worker failed'):
            case('test_canonical_integration_preserves_frozen634_and_exact_closure').test_canonical_integration_preserves_frozen634_and_exact_closure()
        case = adapter.build_case(ROOT, lambda: {'historical_gate_passed': True})
        with self.assertRaisesRegex(AssertionError, 'exact receipt keys'):
            case('test_canonical_integration_preserves_frozen634_and_exact_closure').test_canonical_integration_preserves_frozen634_and_exact_closure()

    def test_missing_authority_is_exact_first_path_in_new_copy(self):
        raw = adapter._read(ROOT / adapter.RUNTIME, adapter._pins()[adapter.RUNTIME])
        receipt = adapter.missing_legacy_authority(raw)
        self.assertEqual(receipt, {
            'calls': ['load_fixture', 'source_state'],
            'first_missing_relative_path': 'tmp/secondary-review-20261021/configuration-record-fixture-draft/source-ready-manifest.json',
            'minimal_copy_only': True, 'historical638_admission': False, 'legacy_full761_admission': False})

    def test_pinned_source_reader_refuses_changed_bytes_symlink_and_fifo(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            path = root / 'source.py'
            path.write_bytes(b'pass\n')
            meta = {'bytes': 5, 'sha256': adapter.sha(b'pass\n')}
            self.assertEqual(adapter._read(path, meta), b'pass\n')
            path.write_bytes(b'fail\n')
            with self.assertRaises(AssertionError): adapter._read(path, meta)
            path.unlink()
            real = root / 'real.py'; real.write_bytes(b'pass\n'); path.symlink_to(real)
            with self.assertRaises(OSError): adapter._read(path, meta)
            path.unlink(); os.mkfifo(path)
            with self.assertRaises(AssertionError): adapter._read(path, meta)
            alias = root / 'alias'; alias.symlink_to(root, target_is_directory=True)
            with self.assertRaises(OSError): adapter._read(alias / 'real.py', meta)

    def test_missing_source_root_refuses_before_any_import(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(adapter, '_load', side_effect=AssertionError('must not import')) as load:
            with self.assertRaises(FileNotFoundError): adapter.build_case(Path(tmp).resolve(), lambda: {})
            load.assert_not_called()
        with self.assertRaisesRegex(AssertionError, 'callback required'):
            adapter.build_case(ROOT, None)

    def test_original_globals_and_sourcebytes_unchanged_by_factory(self):
        original = self.case._original_case
        r = original.test_full_summary_keys_types_and_flags.__globals__['r']
        self.assertEqual(r.ROOT, ROOT)
        self.assertEqual(r.FIXTURE, ROOT / 'tmp/secondary-review-20261021/configuration-record-fixture-draft')
        self.assertEqual(r.INVENTORY_SHA, 'a8e613e74d72dca2f2638aa2e0139659d6850a7ab13ddc980f987159b3344e23')
        for name, meta in adapter._pins().items(): adapter._read(ROOT / name, meta)
        self.assertEqual(r.REFERENCE_SECONDS, 600)
        self.assertEqual(r.FINAL_SECONDS, 60)
        self.assertEqual(r.EMERGENCY_SECONDS, 180)
        self.assertEqual(r.STREAM_LIMIT, 128 * 1024 ** 2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
