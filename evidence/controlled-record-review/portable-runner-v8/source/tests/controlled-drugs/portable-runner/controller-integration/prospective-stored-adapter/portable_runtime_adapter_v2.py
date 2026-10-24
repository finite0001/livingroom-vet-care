"""External finite portable V2 placement route for the unchanged 25-method harness.

No CLI, database launch, private fixture fallback or target-global success patch.
Only the legacy BASELINE path is scoped to its already-admitted public support
member for class lifetime; the old digest and all inherited assertions stay fixed.
The caller supplies a separately source-admitted historical assertion callback.
"""
from contextlib import ExitStack
from copy import deepcopy
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
PINS_SHA = 'e7538fd6fa32abcd2e9064ab37c68e2a140098b4c6c3dbdb848d2785a3352306'
HARNESS = 'supabase/tests/test_record_review_v3_configuration_record_runtime_harness.py'
CANDIDATE = 'tests/controlled-drugs/engine/candidate'
RUNTIME = CANDIDATE + '/record_review_v3_configuration_record_runtime.py'
BASELINE_SUPPORT = 'tests/controlled-drugs/fixtures/record-review-v3/history/maps/stored634.json'
BASELINE_META = {'bytes': 84980, 'sha256': '9138f6415099ebab1081ebfe8f169b0f13aca8d06cb4c375cf1fffa737044b54'}
LEGACY_BASELINE = 'tmp/secondary-review-20261021/configuration-record-profile-integration/full634-source-map.json'
TOOLS = 'tests/controlled-drugs/harness'
REPLACEMENTS = (
    'test_fixed_pinned_93_stages_1594_cases_1727_outcomes',
    'test_source_report_cannot_launch_and_does_not_spawn_or_network',
    'test_canonical_integration_preserves_frozen634_and_exact_closure',
    'test_fixed_fixture_refuses_edited_inventory_stage_source_pin',
)
HISTORICAL_EXPECTED = {
    'kind': 'historical638-profile267-assertion-v1',
    'source_count': 638, 'profile_inputs': 267, 'baseline_count': 634,
    'source_map_sha256': '68987ef56aff1da537c8a3d7ff16eead831e602909d67502998951396d6b30dc',
    'expected_sha256': 'fec2ff871f064a124ae3a0fb5ba60e36b8b58dda1932393cd656c43cd68abd7d',
    'install_sha256': '22021a314fc196efa822a16ca30d25c7f9f6e70811703fe60eb747d92280d542',
    'historical_gate_passed': True, 'legacy_full761_admission': False,
    'database_commands': 0,
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _read(path, metadata):
    """Bounded physical source read, immutable bytes used for initial imports."""
    path = Path(path).absolute()
    assert '..' not in path.parts
    handles = []
    try:
        fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        handles.append(fd)
        edges = []
        for component in path.parts[1:-1]:
            parent = fd
            fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            handles.append(fd)
            edges.append((parent, component, fd))
        parent = fd
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        handles.append(fd)
        before = os.fstat(fd)
        assert stat.S_ISREG(before.st_mode) and before.st_size == metadata['bytes']
        assert 0 < before.st_size <= 131072
        chunks = []
        remaining = before.st_size + 1
        while remaining:
            block = os.read(fd, remaining)
            if not block:
                break
            chunks.append(block)
            remaining -= len(block)
        raw = b''.join(chunks)
        after = os.fstat(fd)
        identity = lambda item: (item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns, item.st_ctime_ns)
        assert identity(before) == identity(after) == identity(os.stat(path.name, dir_fd=parent, follow_symlinks=False))
        for owner, component, directory in edges:
            seen = os.fstat(directory)
            current = os.stat(component, dir_fd=owner, follow_symlinks=False)
            assert stat.S_ISDIR(current.st_mode) and (seen.st_dev, seen.st_ino) == (current.st_dev, current.st_ino)
        assert len(raw) == metadata['bytes'] and sha(raw) == metadata['sha256'], 'Pinned adapter dependency changed'
        return raw
    finally:
        for fd in reversed(handles):
            os.close(fd)


def _load(name, path, raw):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    return module


def _pins():
    path = HERE / 'source-pins-v2.json'
    raw = _read(path, {'bytes': 1642, 'sha256': PINS_SHA})
    return json.loads(raw)


def admit_historical_receipt(value):
    assert type(value) is dict and value.keys() == HISTORICAL_EXPECTED.keys(), 'Historical callback exact receipt keys required'
    for name, expected in HISTORICAL_EXPECTED.items():
        assert type(value[name]) is type(expected) and value[name] == expected, 'Historical callback mismatch: ' + name
    return value


def missing_legacy_authority(runtime_bytes):
    """Actual first-path failure in a minimal copy; NOT a source-gate positive."""
    with tempfile.TemporaryDirectory(prefix='portable-stored-absence-') as tmp:
        root = Path(tmp).resolve()
        path = root / RUNTIME
        path.parent.mkdir(parents=True)
        path.write_bytes(runtime_bytes)
        assert path.read_bytes() == runtime_bytes
        module = _load('portable_missing_authority_runtime', path, runtime_bytes)
        absent = root / 'tmp/secondary-review-20261021/configuration-record-fixture-draft/source-ready-manifest.json'
        assert module.FIXTURE / 'source-ready-manifest.json' == absent and not absent.exists()
        evidence = []
        for name in ('load_fixture', 'source_state'):
            try:
                getattr(module, name)()
            except AssertionError as exc:
                frames = []
                tb = exc.__traceback__
                while tb is not None:
                    frames.append(tb.tb_frame)
                    tb = tb.tb_next
                assert frames[-1].f_code is module.read_pinned.__code__
                assert frames[-1].f_locals['path'] == absent
                assert not absent.exists()
                evidence.append(name)
            else:
                raise AssertionError('Legacy missing-authority call unexpectedly returned')
        return {'calls': evidence, 'first_missing_relative_path': str(absent.relative_to(root)),
                'minimal_copy_only': True, 'historical638_admission': False, 'legacy_full761_admission': False}


def build_case(explicit_repo_root, historical638_assertion_callback, *, baseline_path, deadline, check):
    """Return the sole 25-test subclass; callback must run the reviewed worker."""
    assert callable(historical638_assertion_callback), 'Historical assertion callback required'
    assert callable(check), 'Original worker deadline checker required'
    assert type(deadline) in (int, float) and math.isfinite(deadline), 'Original finite deadline required'
    def gate():
        check()
        assert time.monotonic() < deadline, 'Original stored-adapter deadline expired'
    gate()
    root = Path(explicit_repo_root).absolute()
    assert root.is_dir() and '..' not in root.parts
    support = Path(baseline_path).absolute()
    assert support == root / BASELINE_SUPPORT, 'Exact admitted public baseline placement required'
    pins = _pins()
    assert pins.get(BASELINE_SUPPORT) == BASELINE_META, 'Literal baseline support authority differs'
    gate()
    raw = {}
    for name, item in pins.items():
        gate(); raw[name] = _read(root / name, item); gate()

    original = _load('portable_stored_original_harness', root / HARNESS, raw[HARNESS])
    portable = _load('portable_stored_loader', root / TOOLS / 'portable_loader.py', raw[TOOLS + '/portable_loader.py'])
    generator = _load('portable_stored_generator', root / TOOLS / 'portable_generator.py', raw[TOOLS + '/portable_generator.py'])
    # The retained harness imports its three sibling dependencies normally.
    # Recheck their pinned bytes after that import, without patching any globals.
    for name, item in pins.items():
        assert _read(root / name, item) == raw[name]
    r = original.r
    assert r.BASELINE == root / LEGACY_BASELINE and r.BASELINE_SHA == BASELINE_META['sha256'], 'Unchanged legacy baseline declaration required'
    assert raw[BASELINE_SUPPORT] == _read(support, BASELINE_META)
    original_baseline = r.BASELINE
    gate()

    def restore_baseline():
        observed = r.BASELINE
        r.BASELINE = original_baseline
        assert observed in (support, original_baseline), 'Unexpected baseline placement mutation'
        assert r.BASELINE_SHA == BASELINE_META['sha256'], 'Legacy baseline digest changed'

    class PortableRuntimeTests(original.RuntimeTests):
        @classmethod
        def setUpClass(cls):
            # Path placement only, scoped to this class. Register before any
            # fixture work so unittest also restores after setUpClass failure.
            gate()
            assert r.BASELINE == original_baseline, 'Original baseline placement differs'
            cls.addClassCleanup(restore_baseline)
            r.BASELINE = support
            try:
                gate(); assert _read(support, BASELINE_META) == raw[BASELINE_SUPPORT]; gate()
                cls.stages, cls.portable_inventory, cls.wanted, cls.inputs = portable.load_fixture(root)
                cls.inventory = portable.legacy_inventory(root)
                r.admit_inventory(cls.inventory)
                gate()
            except BaseException:
                restore_baseline()
                raise

        def test_fixed_pinned_93_stages_1594_cases_1727_outcomes(self):
            self.assertEqual(r.PHASE_NAMES, original.session.PHASE_NAMES)
            self.assertEqual(len(self.stages), 93)
            self.assertEqual(len(self.wanted), 1727)
            self.assertEqual(len(self.inventory['case_inventory']), 1594)
            self.assertEqual(sum(len(v.encode()) for v in self.stages.values()), 33427253)
            envelope = portable.envelope()
            for name in r.PHASE_NAMES:
                entry = envelope['phases'][name]
                self.assertEqual(self.inputs[entry['path']], self.inventory['phases'][name]['sha256'])
            generated, inventory = generator.compile_stages(root)
            self.assertEqual(generated, self.stages)
            portable.exact(inventory, self.portable_inventory)
            portable.verify_parity(root, generated, inventory)
            for name in ('case_inventory', 'render_inventory', 'complete_expected_outcomes'):
                portable.exact(inventory[name], self.inventory[name])
            self.assertEqual(len(inventory['render_inventory']), 1788)

        def test_source_report_cannot_launch_and_does_not_spawn_or_network(self):
            forbidden = AssertionError('Source report attempted process or network')
            with patch.object(subprocess, 'Popen', side_effect=forbidden), patch.object(subprocess, 'run', side_effect=forbidden), patch.object(socket, 'socket', side_effect=forbidden):
                portable.verify_parity(root, self.stages, self.portable_inventory)
                report = {'source_only': True, 'runtime_executed': False,
                          'legacy_full761_admission': False, 'phases': len(self.stages), 'outcomes': len(self.wanted)}
                self.assertTrue(report['source_only'])
                self.assertFalse(report['runtime_executed'])
                self.assertFalse(report['legacy_full761_admission'])
                self.assertEqual(report['phases'], 93)
                self.assertEqual(report['outcomes'], 1727)
                missing_legacy_authority(raw[RUNTIME])
                # Original refusal-only unit mocks; no success gate is patched.
                with patch.object(r, 'HERE', root / 'tmp/noncanonical-runtime-refusal-test'), self.assertRaisesRegex(AssertionError, 'Private draft cannot launch'):
                    r.execute_integrated()
                with patch.object(sys, 'argv', ['report', '--run-synthetic-local']), self.assertRaisesRegex(AssertionError, 'Source-only CLI'):
                    r.main()
            source = raw[RUNTIME].decode('utf-8')
            self.assertLess(source.index('    canonical_location()'), source.index('    import record_review_v3_gate_b_runtime'))

        def test_canonical_integration_preserves_frozen634_and_exact_closure(self):
            receipt = historical638_assertion_callback()
            admit_historical_receipt(receipt)
            portable.verify_parity(root, self.stages, self.portable_inventory)
            self.assertEqual(len(self.inputs), 134)
            self.assertFalse(self.portable_inventory['portable_provenance']['legacy_full761_admission'])

        def test_fixed_fixture_refuses_edited_inventory_stage_source_pin(self):
            r.admit_inventory(self.inventory)
            for key, value in [('phase_seconds', 120.0), ('whole_seconds', True), ('absolute_cutoff_seconds_before_outer_deadline', 59), ('source_only', 1), ('runtime_executed', True), ('target_cases', 1593), ('total_sql_bytes', 0)]:
                bad = dict(self.inventory)
                bad[key] = value
                with self.subTest(key=key), self.assertRaises(AssertionError):
                    r.admit_inventory(bad)
            for mutation in ('missingphase', 'extraoutcome', 'wrongoutcome', 'duplicatecase', 'wrongfunction', 'wrongprimary', 'wrongzone'):
                bad = deepcopy(self.inventory)
                if mutation == 'missingphase': bad['phase_names'] = bad['phase_names'][1:]
                if mutation == 'extraoutcome': bad['complete_expected_outcomes']['extra'] = 'literal_success'
                if mutation == 'wrongoutcome': bad['complete_expected_outcomes'][next(iter(self.wanted))] = 'wrong'
                if mutation == 'duplicatecase': bad['case_inventory'][1] = bad['case_inventory'][0]
                if mutation == 'wrongfunction': bad['case_inventory'][0]['function'] = 'untrusted_function'
                if mutation == 'wrongprimary': next(c for c in bad['case_inventory'] if c['expected']['outcome'] == 'error')['expected']['message'] = 'wrong'
                if mutation == 'wrongzone': bad['zones'].reverse()
                with self.subTest(mutation=mutation), self.assertRaises(AssertionError):
                    r.admit_inventory(bad)
            missing_legacy_authority(raw[RUNTIME])
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp).resolve() / 'changed.sql'
                path.write_text('select 1;')
                with self.assertRaisesRegex(AssertionError, 'pin'):
                    r.read_pinned(path, '0' * 64)
                with self.assertRaises(AssertionError):
                    r.read_pinned(path, r.sha(path.read_bytes()), limit=1)
                meta = {'bytes': len(path.read_bytes()), 'sha256': sha(path.read_bytes())}
                portable.read_regular(path.parent, path.name, meta)
                path.write_text('select 2;')
                with self.assertRaises(ValueError):
                    portable.read_regular(path.parent, path.name, meta)
            invalid = deepcopy(portable.envelope())
            invalid['kind'] = 'forged'
            with self.assertRaises(ValueError):
                portable.validate_envelope_shape(invalid)

    original_names = set(unittest.defaultTestLoader.getTestCaseNames(original.RuntimeTests))
    actual_names = set(unittest.defaultTestLoader.getTestCaseNames(PortableRuntimeTests))
    assert len(original_names) == 25 and actual_names == original_names
    assert {name for name in PortableRuntimeTests.__dict__ if name.startswith('test_')} == set(REPLACEMENTS)
    inherited = original_names - set(REPLACEMENTS)
    assert len(inherited) == 21
    assert all(getattr(PortableRuntimeTests, name) is getattr(original.RuntimeTests, name) for name in inherited)
    assert PortableRuntimeTests.exercise_actual_terminal_entrypoint is original.RuntimeTests.exercise_actual_terminal_entrypoint
    PortableRuntimeTests._original_case = original.RuntimeTests
    PortableRuntimeTests._source_pins = dict(pins)
    return PortableRuntimeTests
