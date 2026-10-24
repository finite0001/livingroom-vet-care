"""Fresh-process historical worker tests; only verified owned copies are removed."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

HERE = Path(__file__).resolve().parents[2]
ROOT = HERE.parents[2]
WORKER = HERE / 'historical638_assertion.py'
helper = ROOT / 'tests/controlled-drugs/harness/historical_tree.py'
assert hashlib.sha256(helper.read_bytes()).hexdigest() == 'fa85e50910c3ed24e76c4a273707ee3ec0208a433970b17dbf431f52154483eb'
spec = importlib.util.spec_from_file_location('historical_assertion_materializer_test', helper)
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)


class HistoricalAssertionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.parent = Path(tempfile.mkdtemp(prefix='historical638-assertion-test-')).resolve()
        cls.home = cls.parent / 'home'; cls.home.mkdir(mode=0o700)
        cls.tmp = cls.parent / 'tmp'; cls.tmp.mkdir(mode=0o700)
        cls.copies = cls.parent / 'copies'; cls.copies.mkdir(mode=0o700)
        cls.tree, cls.receipt = h.materialize(ROOT, cls.copies, 'stored638', deadline=time.monotonic()+120)
        manifest = h.load_manifest(time.monotonic()+60)
        cls.entries = [manifest['files'][name] for name in manifest['profiles']['stored638']['paths']]
        cls.evidence = Path(os.environ['CONTROLLED_REGRESSION_EVIDENCE']) / ('historical-worker-test-' + cls.parent.name.rsplit('-', 1)[-1])
        cls.evidence.mkdir(mode=0o700)
        (cls.evidence / 'materialization.json').write_text(json.dumps(cls.receipt, sort_keys=True, indent=2)+'\n')
        cls.number = 0

    @classmethod
    def tearDownClass(cls):
        # Failure to prove the exact owned source tree retains it, with no cleanup.
        h.verify_tree(cls.tree, cls.entries, time.monotonic()+60)
        if cls.tree.stat().st_ino != cls.receipt['root_identity'][1]:
            raise ValueError('owned tree identity changed; retain test copy')
        shutil.rmtree(cls.tree)
        cls.copies.rmdir(); cls.tmp.rmdir(); cls.home.rmdir(); cls.parent.rmdir()

    def child(self, *, tree=None, arguments=()):
        type(self).number += 1
        env = dict(HOME=str(self.home), TMPDIR=str(self.tmp), PATH=str(Path(sys.executable).resolve().parent),
                   PYTHONDONTWRITEBYTECODE='1', PYTHONOPTIMIZE='0', PYTHONNOUSERSITE='1', PYTHONUTF8='1',
                   LC_ALL='C', LANG='C')
        argv = [str(Path(sys.executable).resolve()), '-I', '-B', str(WORKER),
                '--repository-root', str(ROOT), '--tree-root', str(tree or self.tree), *arguments]
        result = subprocess.run(argv, cwd=self.parent, env=env, capture_output=True, timeout=90)
        base = self.evidence / ('%02d-' % self.number + self._testMethodName)
        base.with_suffix('.stdout').write_bytes(result.stdout)
        base.with_suffix('.stderr').write_bytes(result.stderr)
        base.with_suffix('.json').write_text(json.dumps(dict(argv=argv, returncode=result.returncode,
                                                             worker_sha256=hashlib.sha256(WORKER.read_bytes()).hexdigest()), indent=2)+'\n')
        return result

    def test_complete_independent638_and267_profile_pass(self):
        result = self.child()
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(json.loads(result.stdout), dict(kind='historical638-profile267-assertion-v1',
            source_count=638, profile_inputs=267, baseline_count=634,
            source_map_sha256='68987ef56aff1da537c8a3d7ff16eead831e602909d67502998951396d6b30dc',
            expected_sha256='fec2ff871f064a124ae3a0fb5ba60e36b8b58dda1932393cd656c43cd68abd7d',
            install_sha256='22021a314fc196efa822a16ca30d25c7f9f6e70811703fe60eb747d92280d542',
            historical_gate_passed=True, legacy_full761_admission=False, database_commands=0))

    def test_changed_source_refused_before_import(self):
        target = self.tree / 'tests/controlled-drugs/engine/candidate/record_review_v3_configuration_record_runtime.py'
        raw = target.read_bytes()
        try:
            target.write_bytes(raw + b'\nraise RuntimeError("MUTANT_WAS_IMPORTED")\n')
            result = self.child()
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn(b'MUTANT_WAS_IMPORTED', result.stderr)
            self.assertEqual(result.stdout, b'')
        finally: target.write_bytes(raw)

    def test_extra_eligible_source_is_not_projected_away(self):
        target = self.tree / 'supabase/tests/test_unreviewed_extra_harness.py'
        with target.open('x') as stream: stream.write('raise RuntimeError("must not import")\n')
        try:
            result = self.child()
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b'Undeclared', result.stderr)
        finally: target.unlink()

    def test_symlink_root_refuses(self):
        alias = self.parent / 'tree-alias'; alias.symlink_to(self.tree, target_is_directory=True)
        try:
            result = self.child(tree=alias)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, b'')
        finally: alias.unlink()

    def test_unknown_cli_argument_refuses(self):
        result = self.child(arguments=('--run-synthetic-local',))
        self.assertEqual(result.returncode, 2)
        self.assertIn(b'unrecognized arguments', result.stderr)


if __name__ == '__main__': unittest.main(verbosity=2)
