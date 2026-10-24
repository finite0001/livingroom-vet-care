"""Offline ownership, drain and restoration regressions; no Docker connection."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

path = Path(__file__).resolve().parents[2] / 'tests/controlled-drugs/owned_scheduler.py'
spec = importlib.util.spec_from_file_location('owned_scheduler_test_module', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Runtime:
    def __init__(self, project, identity, mode='on'):
        self.project, self.identity, self.mode = project, identity, mode
        self.writes, self.off_reads, self.pending, self.now = [], 0, 0, 0
        self.foreign = False
        self.fail_pause = False

    def clock(self):
        self.now += 1
        return self.now

    def run(self, argv, **kwargs):
        if argv[:2] == ['docker', 'inspect']:
            labels = {'com.supabase.cli.project': 'foreign' if self.foreign else self.identity,
                      'com.supabase.cli.workdir': str(self.project)}
            return SimpleNamespace(returncode=0, stdout=json.dumps([{'Config': {'Labels': labels}}]))
        query = kwargs['input']
        if query.startswith('alter system'):
            self.writes.append(query)
            if self.fail_pause and '=off;' in query:
                return SimpleNamespace(returncode=1, stdout='')
            self.mode = 'off' if '=off;' in query else 'on'
            return SimpleNamespace(returncode=0, stdout='t')
        if query == "select current_setting('cron.launch_active_jobs');":
            return SimpleNamespace(returncode=0, stdout=self.mode)
        if 'not exists' in query:
            self.off_reads += 1
            drained = self.off_reads > self.pending
            return SimpleNamespace(returncode=0, stdout='t' if self.mode == 'off' and drained else 'f')
        expected = 'off' if "='off'" in query else 'on'
        return SimpleNamespace(returncode=0, stdout='t' if self.mode == expected else 'f')


class OwnedSchedulerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name).resolve()
        (self.project / 'supabase').mkdir()
        self.identity = 'lrv-prescription-test-owned'
        (self.project / 'supabase/config.toml').write_text('project_id = "' + self.identity + '"\n')
        self.runtime = Runtime(self.project, self.identity)

    def pause(self, identity=None):
        return module.paused_owned_scheduler(self.project, identity or self.identity,
            run=self.runtime.run, clock=self.runtime.clock, sleep=lambda _: None)

    def test_non_synthetic_identity_never_writes(self):
        with self.assertRaises(RuntimeError), self.pause('primary-practice'):
            self.fail('must not enter')
        self.assertEqual(self.runtime.writes, [])

    def test_wrong_container_never_writes(self):
        self.runtime.foreign = True
        with self.assertRaises(RuntimeError), self.pause():
            self.fail('must not enter')
        self.assertEqual(self.runtime.writes, [])

    def test_wrong_config_never_writes(self):
        (self.project / 'supabase/config.toml').write_text('project_id = "other"\n')
        with self.assertRaises(RuntimeError), self.pause():
            self.fail('must not enter')
        self.assertEqual(self.runtime.writes, [])

    def test_existing_off_state_is_preserved_without_admin_write(self):
        self.runtime.mode = 'off'
        with self.pause() as state:
            self.assertTrue(state['paused_and_drained'])
        self.assertEqual(self.runtime.mode, 'off')
        self.assertTrue(state['restored'])
        self.assertEqual(self.runtime.writes, [])

    def test_source_failure_restores_prior_enabled_state(self):
        with self.assertRaisesRegex(ValueError, 'source failure'):
            with self.pause() as state:
                self.assertEqual(self.runtime.mode, 'off')
                raise ValueError('source failure')
        self.assertEqual(self.runtime.mode, 'on')
        self.assertTrue(state['restored'])

    def test_live_job_must_drain_before_entering(self):
        self.runtime.pending = 3
        with self.pause():
            self.assertEqual(self.runtime.off_reads, 4)
        self.assertEqual(self.runtime.mode, 'on')

    def test_busy_job_timeout_restores_enabled_state(self):
        self.runtime.pending = 100
        with self.assertRaisesRegex(RuntimeError, 'required state'), self.pause():
            self.fail('must not enter')
        self.assertEqual(self.runtime.mode, 'on')

    def test_failed_pause_attempt_still_restores_prior_state(self):
        self.runtime.fail_pause = True
        with self.assertRaises(RuntimeError), self.pause():
            self.fail('must not enter')
        self.assertEqual(len(self.runtime.writes), 2)
        self.assertEqual(self.runtime.mode, 'on')

    def test_replaced_container_is_not_mutated_during_restore(self):
        with self.assertRaises(RuntimeError):
            with self.pause():
                self.runtime.foreign = True
        self.assertEqual(len(self.runtime.writes), 1)


if __name__ == '__main__':
    unittest.main()
