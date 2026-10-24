"""Finite source-only placement controls. No OS children/network/DB.

ROOT is explicitly injected by the portable_fixture worker route. The admitted
canonical tree already has every input; these controls never copy its 90MiB
fixture or populate a private tmp baseline. Receipt callbacks below prove shape
only, never a historical638 acceptance.
"""
import ast
from copy import deepcopy
import hashlib
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = None
HERE = Path(__file__).resolve().parent
V1 = 'tests/controlled-drugs/portable-stored-adapter/portable_runtime_adapter.py'
V1_META = {'bytes':13948,'sha256':'5ec8d39d7bd18964134a98559e14499faf951b2941211136a0b2338aef8c089e'}


def root():
    assert isinstance(ROOT, Path) and ROOT.is_absolute(), 'Explicit admitted canonical source root required'
    return ROOT


def load(name, path, raw):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    return module


def version2():
    path = HERE / 'portable_runtime_adapter_v2.py'
    raw = path.read_bytes()
    assert len(raw) == 16232 and hashlib.sha256(raw).hexdigest() == '22c0253e01b86409f86d10b7eea1fe8d66acc18fba736b4b0374c52a77e6536c'
    return load('placement_v2', path, raw)


def make(adapter, repo=None, check=lambda: None):
    repo = root() if repo is None else repo
    return adapter.build_case(repo, lambda: deepcopy(adapter.HISTORICAL_EXPECTED),
        baseline_path=repo/adapter.BASELINE_SUPPORT, deadline=time.monotonic()+120, check=check)


class StoredAdapterV2Tests(unittest.TestCase):
    def test_four_replacement_asts_and_twentyone_inherited_method_identities_unchanged(self):
        a = version2(); raw = a._read(root()/V1, V1_META)
        old, new = ast.parse(raw), ast.parse((HERE/'portable_runtime_adapter_v2.py').read_bytes())
        def methods(tree):
            cls = next(n for n in ast.walk(tree) if isinstance(n, ast.ClassDef) and n.name=='PortableRuntimeTests')
            return {n.name:ast.dump(n,include_attributes=False) for n in cls.body if isinstance(n, ast.FunctionDef) and n.name.startswith('test_')}
        self.assertEqual(methods(old), methods(new)); self.assertEqual(set(methods(new)), set(a.REPLACEMENTS))
        case = make(a); base = case._original_case
        names = set(unittest.defaultTestLoader.getTestCaseNames(base))
        self.assertEqual(len(names),25); self.assertEqual(set(unittest.defaultTestLoader.getTestCaseNames(case)),names)
        for name in names-set(a.REPLACEMENTS): self.assertIs(getattr(case,name),getattr(base,name))
        self.assertIs(case.exercise_actual_terminal_entrypoint,base.exercise_actual_terminal_entrypoint)

    def test_actual_old_missing_path_failure_then_all25_new_assertions_pass_offline(self):
        a = version2(); self.assertFalse((root()/a.LEGACY_BASELINE).exists())
        old = load('placement_old_adapter',root()/V1,a._read(root()/V1,V1_META))
        old_case = old.build_case(root(),lambda:deepcopy(old.HISTORICAL_EXPECTED))
        method = 'test_integration_gate_brackets_frozen_source_inventory_deadline'
        # No setUpClass is needed for this inherited method. Its real baseline
        # read fails before the observed callback can advance the original clock.
        with self.assertRaisesRegex(AssertionError,'does not match'):
            getattr(old_case(method),method)()
        case = make(a); r = case._original_case.test_full_summary_keys_types_and_flags.__globals__['r']
        original = r.BASELINE
        stream = io.StringIO(); forbidden = AssertionError('No real process/network in placement controls')
        with patch.object(subprocess,'Popen',side_effect=forbidden),patch.object(subprocess,'run',side_effect=forbidden),patch.object(socket,'socket',side_effect=forbidden):
            result = unittest.TextTestRunner(stream=stream,verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(case))
        self.assertTrue(result.wasSuccessful(),stream.getvalue());self.assertEqual(result.testsRun,25);self.assertEqual(result.skipped,[])
        self.assertEqual(r.BASELINE,original);self.assertEqual(r.BASELINE_SHA,a.BASELINE_META['sha256'])

    def test_factory_changes_no_target_global_and_class_cleanup_restores_even_failed_setup(self):
        a = version2(); case = make(a)
        r = case._original_case.test_full_summary_keys_types_and_flags.__globals__['r']
        original = r.BASELINE
        self.assertEqual(original,root()/a.LEGACY_BASELINE)
        closure = {id(cell.cell_contents):cell.cell_contents for cell in case.setUpClass.__func__.__closure__}
        loader = next(value for value in closure.values() if getattr(value,'__name__',None)=='portable_stored_loader')
        with patch.object(loader,'load_fixture',side_effect=RuntimeError('Synthetic setup failure')):
            with self.assertRaisesRegex(RuntimeError,'Synthetic setup failure'):case.setUpClass()
        self.assertEqual(r.BASELINE,original)
        case.doClassCleanups();self.assertEqual(case.tearDown_exceptions,[])
        self.assertEqual(r.BASELINE,original);self.assertEqual(r.BASELINE_SHA,a.BASELINE_META['sha256'])

    def test_explicit_support_path_and_legacy_hash_are_exact_no_private_fallback(self):
        a = version2()
        for name in (a.LEGACY_BASELINE,'tests/controlled-drugs/fixtures/record-review-v3/history/maps/stored638.json'):
            with self.subTest(name=name),self.assertRaisesRegex(AssertionError,'Exact admitted public baseline placement'):
                a.build_case(root(),lambda:{},baseline_path=root()/name,deadline=time.monotonic()+120,check=lambda:None)
        original_pins = json.loads(a._read(root()/'tests/controlled-drugs/portable-stored-adapter/source-pins.json',
            {'bytes':1452,'sha256':'55af72607311c0fcdde6caa7bbd907940d999702471fcd74ca188f0649fa9325'}))
        self.assertEqual(a._pins(),dict(original_pins,**{a.BASELINE_SUPPORT:a.BASELINE_META}))
        self.assertEqual(a._pins()[a.BASELINE_SUPPORT],a.BASELINE_META)
        baseline=json.loads(a._read(root()/a.BASELINE_SUPPORT,a.BASELINE_META))
        self.assertEqual(len(baseline),634)

    def test_changed_missing_symlink_and_fifo_support_refuse_before_target_import(self):
        a=version2();pins=a._pins()
        with tempfile.TemporaryDirectory(prefix='stored-adapter-v2-negative-')as tmp:
            repo=Path(tmp).resolve()
            for name,meta in pins.items():
                path=repo/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(a._read(root()/name,meta))
            support=repo/a.BASELINE_SUPPORT;good=support.read_bytes()
            for mutation in ('changed','missing','symlink','fifo'):
                with self.subTest(mutation=mutation):
                    if support.exists()or support.is_symlink():support.unlink()
                    if mutation=='changed':support.write_bytes(b'X'+good[1:])
                    if mutation=='symlink':support.symlink_to(root()/a.BASELINE_SUPPORT)
                    if mutation=='fifo':os.mkfifo(support)
                    with patch.object(a,'_load',side_effect=AssertionError('must not import'))as imported:
                        with self.assertRaises((AssertionError,OSError)):make(a,repo)
                        imported.assert_not_called()
            if support.exists():support.unlink()
            support.write_bytes(good)

    def test_original_deadline_and_external_failure_are_not_reset_or_swallowed(self):
        a=version2()
        for deadline in (True,float('inf'),float('nan'),time.monotonic()-1):
            with self.subTest(deadline=deadline),self.assertRaises(AssertionError):
                a.build_case(root(),lambda:{},baseline_path=root()/a.BASELINE_SUPPORT,deadline=deadline,check=lambda:None)
        def fail():raise RuntimeError('Original outer deadline refusal')
        with self.assertRaisesRegex(RuntimeError,'Original outer deadline refusal'):make(a,check=fail)
        case=make(a);r=case._original_case.test_full_summary_keys_types_and_flags.__globals__['r']
        self.assertEqual((r.REFERENCE_SECONDS,r.FINAL_SECONDS,r.EMERGENCY_SECONDS,r.STREAM_LIMIT),(600,60,180,128*1024**2))

    def test_prospective_worker_has_only_explicit_source_placement_role_delta(self):
        text=(HERE/'worker.py').read_text()
        self.assertIn("required += ['portable_runtime_adapter_v2.py']",text)
        self.assertIn("parent / 'source-pins-v2.json'",text)
        self.assertIn("tree['files'].get(support_name) == support_meta",text)
        self.assertIn("baseline_path=support, deadline=job['deadline'], check=check",text)
        self.assertNotIn("load('portable_runtime_adapter.py'",text)

