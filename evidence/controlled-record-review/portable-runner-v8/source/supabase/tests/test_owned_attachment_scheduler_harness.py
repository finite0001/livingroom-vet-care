"""Bounded scheduler ownership/drain/restore contracts; no Docker execution."""
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import owned_attachment_scheduler as m


class Runtime:
    def __init__(self, project):
        self.project = project
        self.mode = 'on'
        self.writes = []
        self.now = 0
        self.busy = 0
        self.reads = 0
        self.identity = 'local-rehearsal'
        self.container = 'a' * 64
        self.endpoint = 'unix:///var/run/docker.sock'
        self.schedules = [{'jobid': 1, 'command': 'PRIVATE COMMAND', 'active': True}]
        self.fail_pause = False
        self.overrides = []
        self.safe = True

    def clock(self):
        self.now += 1
        return self.now

    def run(self, argv, **kwargs):
        if argv[:3] == ['docker', 'context', 'inspect']:
            return SimpleNamespace(returncode=0, stdout=json.dumps([{'Endpoints': {'docker': {'Host': self.endpoint}}}]))
        if argv[:3] == ['docker', '--host', self.endpoint]:
            argv = ['docker'] + argv[3:]
        if argv[:2] == ['docker', 'inspect']:
            return SimpleNamespace(returncode=0, stdout=json.dumps([{'Id': self.container, 'Name': '/supabase_db_local-rehearsal', 'State': {'Running': True}, 'Config': {'Labels': {'com.supabase.cli.project': self.identity, 'com.supabase.cli.workdir': str(self.project)}}}]))
        assert argv[3] == self.container, 'SQL must use immutable ID, never mutable name'
        query = kwargs['input']
        if query.startswith('alter system'):
            self.writes.append(query)
            if self.fail_pause and '=off;' in query:
                return SimpleNamespace(returncode=1, stdout='')
            self.mode = 'off' if '=off;' in query else 'on'
            self.overrides = [] if 'reset ' in query else [self.mode]
            value = 't'
        elif query == "select current_setting('cron.launch_active_jobs');":
            value = self.mode
        elif 'vault.secrets' in query:
            value = 't' if self.safe else 'f'
        elif 'pg_file_settings' in query:
            value = json.dumps(self.overrides)
        elif 'jsonb_agg' in query:
            value = json.dumps(self.schedules)
        elif 'not exists' in query:
            self.reads += 1
            value = 't' if self.mode == 'off' and self.reads > self.busy else 'f'
        else:
            value = 't' if "='" + self.mode + "'" in query else 'f'
        return SimpleNamespace(returncode=0, stdout=value)


class AttachmentSchedulerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name).resolve()
        self.config = self.project / 'supabase/config.toml'
        self.config.parent.mkdir()
        self.config.write_text('project_id = "local-rehearsal"\n')
        self.runtime = Runtime(self.project)
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def pause(self, config=True):
        return m.paused_attachment_scheduler(self.config if config else None,
            run=self.runtime.run, clock=self.runtime.clock, sleep=lambda _: None)

    def test_missing_config_remote_endpoint_and_wrong_ownership_never_write(self):
        with self.assertRaises(RuntimeError), self.pause(False):
            self.fail('must refuse')
        for endpoint in ('tcp://127.0.0.1:2375', 'ssh://other'):
            self.runtime.endpoint = endpoint
            with self.assertRaises(RuntimeError), self.pause():
                self.fail('must refuse')
        self.runtime.endpoint = 'unix:///var/run/docker.sock'
        self.runtime.identity = 'other'
        with self.assertRaises(RuntimeError), self.pause():
            self.fail('must refuse')
        self.assertEqual(self.runtime.writes, [])

    def test_busy_jobs_drain_and_normal_or_exception_exit_restores_original(self):
        self.runtime.busy = 2
        with self.assertRaisesRegex(ValueError, 'rehearsal'):
            with self.pause() as state:
                self.assertEqual(self.runtime.reads, 3)
                self.assertTrue(state['paused_and_drained'])
                raise ValueError('rehearsal')
        self.assertTrue(state['restored'] and state['schedules_unchanged'])
        self.assertEqual(self.runtime.mode, 'on')

    def test_timeout_and_failed_pause_attempt_restore_enabled_state(self):
        self.runtime.busy = 100
        with self.assertRaisesRegex(RuntimeError, 'deadline'), self.pause():
            self.fail('must not enter')
        self.assertEqual(self.runtime.mode, 'on')
        self.runtime.busy = 0
        self.runtime.fail_pause = True
        with self.assertRaisesRegex(RuntimeError, 'command failed'), self.pause():
            self.fail('must not enter')
        self.assertEqual(self.runtime.mode, 'on')

    def test_original_explicit_override_and_default_provenance_both_restored(self):
        for overrides in ([], ['on']):
            self.runtime.overrides = list(overrides)
            with self.pause() as state:
                self.assertEqual(self.runtime.mode, 'off')
            self.assertEqual(self.runtime.overrides, overrides)
            self.assertTrue(state['override_provenance_restored'])

    def test_configured_provider_or_pending_http_fails_before_pause(self):
        self.runtime.safe = False
        with self.assertRaisesRegex(RuntimeError, 'unconfigured'), self.pause():
            self.fail('must refuse')
        self.assertEqual(self.runtime.writes, [])

    def test_existing_off_state_preserved_without_settings_write(self):
        self.runtime.mode = 'off'
        with self.pause() as state:
            self.assertTrue(state['paused_and_drained'])
        self.assertTrue(state['restored'])
        self.assertEqual(self.runtime.writes, [])

    def test_replaced_container_or_config_never_receives_restore_write(self):
        for change in ('container', 'config'):
            with self.subTest(change=change):
                self.setUp()
                with self.assertRaises(RuntimeError):
                    with self.pause():
                        if change == 'container':
                            self.runtime.container = 'b' * 64
                        else:
                            self.config.write_text('project_id="other"\n')
                self.assertEqual(len(self.runtime.writes), 1)

    def test_schedule_mutation_is_refused_but_settings_restored(self):
        with self.assertRaisesRegex(RuntimeError, 'schedules changed'):
            with self.pause():
                self.runtime.schedules.append({'jobid': 2, 'command': 'PRIVATE'})
        self.assertEqual(self.runtime.mode, 'on')


if __name__ == '__main__':
    unittest.main()
