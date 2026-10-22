"""Fail-closed ordering/ownership/source tests; no processes or databases started."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('owned_bootstrap_tested', ROOT / 'scripts/owned_canonical_bootstrap.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class FakeRunner:
    def __init__(self, case):
        self.case, self.commands = case, []
        self.live, self.paused = False, False
        self.container_id = 'a' * 64
        self.ledger = []
        self.preexisting = False
        self.fail_migration = False
        self.fail_stop = False
        self.bad_owner = False
        self.change_after_start = False
        self.bad_ledger = False
        self.timeout_start = False
        self.replace_after_migration = False
        self.bad_volume = False
        self.network_preexisting = False
        self.foreign_network_attachment = False

    def __call__(self, argv, **kw):
        self.commands.append((argv, kw))
        out = ''
        code = 0
        if argv[:2] == ['supabase', '--version']:
            out = '2.118.0'
        elif argv[:2] == ['supabase', 'start']:
            self.case.assertEqual(kw['env']['SUPABASE_DB_MIGRATIONS_ENABLED'], 'false')
            self.case.assertEqual(kw['env']['SUPABASE_DB_SEED_ENABLED'], 'false')
            self.case.assertIn('--experimental=false', argv)
            self.live = True
            if self.timeout_start:
                raise subprocess.TimeoutExpired(argv, 1, output=b'partial output', stderr=b'partial error')
            if self.change_after_start:
                self.case.config.write_text(self.case.config.read_text() + '\n# raced\n')
        elif argv[:3] == ['supabase', 'migration', 'up']:
            self.case.assertTrue(self.paused, 'Application migration executed before effective scheduler pause')
            self.case.assertNotIn('SUPABASE_DB_MIGRATIONS_ENABLED', kw['env'])
            self.case.assertNotIn('SUPABASE_DB_SEED_ENABLED', kw['env'])
            self.case.assertIn('--local', argv)
            self.case.assertIn('--experimental=false', argv)
            code = 1 if self.fail_migration else 0
            if self.replace_after_migration:
                self.container_id = 'c' * 64
        elif argv[:2] == ['supabase', 'stop']:
            code = 9 if self.fail_stop else 0
            if not self.fail_stop:
                self.live = False
        elif argv[:3] == ['docker', 'context', 'inspect']:
            out = json.dumps([{'Endpoints': {'docker': {'Host': 'unix:///tmp/test-docker.sock'}}}])
        elif argv[:3] == ['docker', '--host', 'unix:///tmp/test-docker.sock']:
            op = argv[3:]
            if op[0] == 'inspect':
                out = json.dumps([{'Id': self.container_id, 'Name': '/supabase_db_owned_test',
                    'Image': 'sha256:' + 'b' * 64, 'State': {'Running': True},
                    'Config': {'Image': 'ghcr.io/supabase/postgres:17.6.1.171', 'Labels': {
                        'com.supabase.cli.project': 'foreign' if self.bad_owner else 'owned_test',
                        'com.supabase.cli.workdir': str(self.case.project.resolve())}}}])
            elif op[:2] == ['image', 'inspect']:
                out = json.dumps([{'Os': 'linux', 'Architecture': 'arm64', 'RepoDigests': [
                    'ghcr.io/supabase/postgres@sha256:658d1c9b09ae4f61b8e95087b6859181b4b7d6940d769cf7b605609c8aad43e9']}])
            elif op[0] == 'exec':
                query = kw['input']
                if query.startswith('alter system'):
                    self.paused = True
                elif query == m.DRAIN_SQL:
                    out = 't' if self.paused else 'f'
                elif query == m.LEDGER_SQL:
                    out = json.dumps([{'unexpected': True}] if self.bad_ledger else self.ledger)
            elif op[:2] == ['volume', 'inspect']:
                out = json.dumps([{'Name': 'supabase_db_owned_test', 'CreatedAt': '2026-10-22T00:00:00Z',
                    'Mountpoint': '/var/lib/docker/volumes/test', 'Driver': 'local',
                    'Labels': {'com.supabase.cli.project': 'foreign' if self.bad_volume else 'owned_test'}}])
            elif op[:2] == ['network', 'inspect']:
                out = json.dumps([{'Name': 'supabase_network_owned_test', 'Id': 'd' * 64,
                    'Labels': {'com.supabase.cli.project': 'owned_test'},
                    'Containers': {('f' * 64 if self.foreign_network_attachment else self.container_id): {}}}])
            elif op[:2] == ['network', 'ls']:
                if self.live or self.network_preexisting:
                    out = 'supabase_network_owned_test'
            elif op[0] in ('ps', 'volume'):
                if self.preexisting or self.live:
                    out = 'supabase_db_owned_test'
            else:
                raise AssertionError(argv)
        else:
            raise AssertionError(argv)
        return subprocess.CompletedProcess(argv, code, out, 'deliberate failure' if code else '')


class OwnedBootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.project = Path(self.temp.name) / 'project'
        (self.project / 'supabase/migrations').mkdir(parents=True)
        self.config = self.project / 'supabase/config.toml'
        self.config.write_text('project_id="owned_test"\n[db]\nmajor_version=17\n')
        self.runner = FakeRunner(self)
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()

    def tearDown(self):
        self.environment.stop()
        self.temp.cleanup()

    def runtime(self, count=0, versions=None):
        return m.Bootstrap(ROOT, self.project, count, 'studio', True,
                           Path(self.temp.name) / 'evidence', self.runner, versions)

    def first_migration(self):
        path = sorted((ROOT / 'supabase/migrations').glob('*.sql'))[0]
        shutil.copy2(path, self.project / 'supabase/migrations' / path.name)
        m.admission(ROOT)
        from secondary_review_ledger import load_frozen
        self.runner.ledger = load_frozen(ROOT / m.CANDIDATE)['ledger'][:1]
        return path

    def test_nonzero_first_failure_survives_failed_cleanup(self):
        self.first_migration()
        self.runner.fail_migration = self.runner.fail_stop = True
        with self.assertRaisesRegex(RuntimeError, 'command failed'):
            self.runtime(1).execute()
        folder = Path(self.temp.name) / 'evidence'
        result = json.loads((folder / 'result.json').read_text())
        first = result['first_failed_command']
        self.assertEqual(first['outcome'], 'nonzero')
        self.assertEqual(first['exit_code'], 1)
        self.assertEqual(json.loads((folder / first['command_file']).read_text())[:3], ['supabase', 'migration', 'up'])
        self.assertEqual(result['primary_failure']['command_sequence'], first['sequence'])
        self.assertIn('command failed', result['cleanup_error'])
        statuses = [json.loads(p.read_text()) for p in sorted(folder.glob('*-status.json'))]
        self.assertEqual([s['exit_code'] for s in statuses if s['outcome'] == 'nonzero'], [1, 9])
        self.assertFalse(result['passed'])
        self.assertNotIn('failure_cleanup_complete', result)

    def test_timeout_first_failure_and_partial_bytes_survive_failed_cleanup(self):
        self.runner.timeout_start = self.runner.fail_stop = True
        with self.assertRaisesRegex(RuntimeError, 'timed out'):
            self.runtime().execute()
        folder = Path(self.temp.name) / 'evidence'
        result = json.loads((folder / 'result.json').read_text())
        first = result['first_failed_command']
        self.assertEqual(first['outcome'], 'timeout')
        self.assertIsNone(first['exit_code'])
        self.assertEqual(first['error_type'], 'TimeoutExpired')
        self.assertEqual((folder / first['stdout_file']).read_bytes(), b'partial output')
        self.assertEqual((folder / first['stderr_file']).read_bytes(), b'partial error')
        self.assertIn('timed out', result['primary_failure']['message'])
        self.assertIn('command failed', result['cleanup_error'])

    def test_timeout_retains_non_utf8_partial_bytes(self):
        runtime = self.runtime()
        def timeout(*args, **kwargs):
            raise subprocess.TimeoutExpired(args[0], 1, output=b'\xffpartial', stderr=b'\xfefailure')
        runtime.runner = timeout
        with self.assertRaisesRegex(RuntimeError, 'timed out'):
            runtime.command(['synthetic-timeout'])
        self.assertEqual((runtime.evidence / '0001-stdout.log').read_bytes(), b'\xffpartial')
        self.assertEqual((runtime.evidence / '0001-stderr.log').read_bytes(), b'\xfefailure')

    def test_runner_decode_error_has_status_without_transport_changes(self):
        runtime = self.runtime()
        def decode_failure(*args, **kwargs):
            self.assertIs(kwargs['text'], True)
            raise UnicodeDecodeError('utf-8', b'\xff', 0, 1, 'invalid')
        runtime.runner = decode_failure
        with self.assertRaises(UnicodeDecodeError):
            runtime.command(['synthetic-decode-error'])
        first = runtime.record['first_failed_command']
        self.assertEqual(first['outcome'], 'runner_error')
        self.assertEqual(first['error_type'], 'UnicodeDecodeError')
        self.assertIsNone(first['exit_code'])

    def test_os_error_is_distinct_and_private(self):
        runtime = self.runtime()
        runtime.runner = lambda *args, **kwargs: (_ for _ in ()).throw(FileNotFoundError('private executable detail'))
        with self.assertRaises(FileNotFoundError):
            runtime.command(['absent-private-executable'])
        status = json.loads((runtime.evidence / '0001-status.json').read_text())
        self.assertEqual(status['outcome'], 'os_error')
        self.assertEqual(status['error_type'], 'FileNotFoundError')
        self.assertIsNone(status['exit_code'])
        self.assertNotIn('private executable detail', json.dumps(status))
        self.assertEqual(runtime.record['first_failed_command'], status)

    def test_command_status_records_actual_elapsed_and_existing_timeout_bound(self):
        runtime = self.runtime()
        runtime.deadline = 110.0
        runtime.runner = lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 0, '', '')
        with patch.object(m.time, 'monotonic', side_effect=[100.0, 101.0, 103.5]):
            runtime.command(['true'], timeout=60)
        status = json.loads((runtime.evidence / '0001-status.json').read_text())
        self.assertEqual(status['outcome'], 'success')
        self.assertEqual(status['exit_code'], 0)
        self.assertEqual(status['timeout_seconds'], 10.0)
        self.assertEqual(status['elapsed_seconds'], 2.5)
        self.assertNotIn('first_failed_command', runtime.record)

    def test_zero_bootstrap_pauses_without_application_migration(self):
        result = self.runtime().execute()
        self.assertTrue(result['passed'])
        self.assertTrue(self.runner.paused)
        self.assertTrue(self.runner.live)
        self.assertFalse(any(argv[:3] == ['supabase', 'migration', 'up'] for argv, _ in self.runner.commands))
        self.assertFalse(any(argv[:2] == ['supabase', 'stop'] for argv, _ in self.runner.commands))
        self.assertEqual((Path(self.temp.name) / 'evidence/result.json').stat().st_mode & 0o777, 0o600)

    def test_first_migration_runs_only_after_pause_and_drain(self):
        self.first_migration()
        self.assertTrue(self.runtime(1).execute()['passed'])
        commands = self.runner.commands
        migration = next(i for i, (a, _) in enumerate(commands) if a[:3] == ['supabase', 'migration', 'up'])
        drain = next(i for i, (_, k) in enumerate(commands) if k.get('input') == m.DRAIN_SQL)
        zero = next(i for i, (_, k) in enumerate(commands) if k.get('input') == m.ZERO_SQL)
        self.assertLess(zero, drain)
        self.assertLess(drain, migration)

    def test_failed_migration_retains_error_and_cleans_own_runtime(self):
        self.first_migration()
        self.runner.fail_migration = True
        with self.assertRaisesRegex(RuntimeError, 'command failed'):
            self.runtime(1).execute()
        self.assertFalse(self.runner.live)
        result = json.loads((Path(self.temp.name) / 'evidence/result.json').read_text())
        self.assertFalse(result['passed'])
        self.assertTrue(result['failure_cleanup_complete'])

    def test_timeout_retains_partial_output_and_cleans(self):
        self.runner.timeout_start = True
        with self.assertRaisesRegex(RuntimeError, 'timed out'):
            self.runtime().execute()
        self.assertFalse(self.runner.live)
        logs = list((Path(self.temp.name) / 'evidence').glob('*-stdout.log'))
        self.assertIn(b'partial output', [p.read_bytes() for p in logs])

    def test_preexisting_resources_never_started_or_stopped(self):
        self.runner.preexisting = True
        with self.assertRaisesRegex(RuntimeError, 'preexisting'):
            self.runtime().execute()
        self.assertFalse(any(a[:2] in (['supabase', 'start'], ['supabase', 'stop']) for a, _ in self.runner.commands))

    def test_remote_docker_never_started(self):
        with patch.dict(os.environ, {'DOCKER_HOST': 'tcp://example:2375'}):
            with self.assertRaisesRegex(RuntimeError, 'local Unix'):
                self.runtime().execute()
        self.assertFalse(self.runner.live)

    def test_inherited_database_override_refused(self):
        for key in ('SUPABASE_DB_HOST', 'PGHOST', 'SUPABASE_DB_MIGRATIONS_ENABLED'):
            with self.subTest(key=key), patch.dict(os.environ, {key: 'wrong'}):
                with self.assertRaisesRegex(RuntimeError, 'overrides forbidden'):
                    self.runtime()
        self.assertEqual(self.runner.commands, [])

    def test_wrong_owner_refuses_sql_and_cleanup(self):
        self.runner.bad_owner = True
        with self.assertRaisesRegex(RuntimeError, 'identity'):
            self.runtime().execute()
        self.assertFalse(any(k.get('input') for _, k in self.runner.commands))
        self.assertFalse(any(a[:2] == ['supabase', 'stop'] for a, _ in self.runner.commands))

    def test_changed_config_refuses_migration_and_cleanup(self):
        self.runner.change_after_start = True
        with self.assertRaisesRegex(RuntimeError, 'config changed'):
            self.runtime().execute()
        self.assertFalse(any(a[:2] == ['supabase', 'stop'] for a, _ in self.runner.commands))

    def test_ledger_extra_rows_rejected(self):
        self.runner.bad_ledger = True
        with self.assertRaisesRegex(RuntimeError, 'independently frozen'):
            self.runtime().execute()
        self.assertFalse(self.runner.live)

    def test_modified_selected_migration_rejected_before_start(self):
        path = self.first_migration()
        (self.project / 'supabase/migrations' / path.name).write_text('-- changed\n')
        with self.assertRaisesRegex(RuntimeError, 'bytes differ'):
            self.runtime(1).execute()
        self.assertEqual(self.runner.commands, [])

    def test_nonprefix_requires_explicit_ordered_canonical_versions(self):
        path = sorted((ROOT / 'supabase/migrations').glob('*.sql'))[3]
        shutil.copy2(path, self.project / 'supabase/migrations' / path.name)
        with self.assertRaisesRegex(RuntimeError, 'exactly'):
            m.selected_inputs(ROOT, self.project, 1)
        version = path.name.split('_', 1)[0]
        self.assertEqual(list(m.selected_inputs(ROOT, self.project, 1, [version])), [path.name])
        for versions in ([version, version], ['99999999999999'], [version, '00000000000000']):
            with self.assertRaises(RuntimeError):
                m.selected_inputs(ROOT, self.project, len(versions), versions)

    def test_complete_source_closure_includes_canonical_artifacts_and_helper(self):
        values = m.bootstrap_inputs(ROOT)
        for name in ('scripts/owned_canonical_bootstrap.py', m.CANDIDATE + '/history_environment.py',
                     m.CANDIDATE + '/secondary_review_expected_205_ledger.json',
                     m.CANDIDATE + '/secondary_review_206_statements.json'):
            self.assertIn(name, values)
        self.assertEqual(sum(name.startswith('supabase/migrations/') for name in values), 206)

    def test_replaced_container_is_never_used_or_stopped(self):
        self.first_migration()
        self.runner.replace_after_migration = True
        with self.assertRaisesRegex(RuntimeError, 'container replaced'):
            self.runtime(1).execute()
        self.assertFalse(any(a[:2] == ['supabase', 'stop'] for a, _ in self.runner.commands))
        self.assertFalse(any('c' * 64 in a and 'exec' in a for a, _ in self.runner.commands))

    def test_wrong_volume_owner_refuses_cleanup(self):
        self.runner.bad_volume = True
        with self.assertRaisesRegex(RuntimeError, 'Volume ownership'):
            self.runtime().execute()
        self.assertFalse(any(a[:2] == ['supabase', 'stop'] for a, _ in self.runner.commands))

    def test_scheduler_drain_deadline_never_starts_migrations(self):
        self.first_migration()
        runtime = self.runtime(1)
        with patch.object(runtime, 'drain', side_effect=RuntimeError('drain deadline')):
            with self.assertRaisesRegex(RuntimeError, 'drain deadline'):
                runtime.execute()
        self.assertFalse(any(a[:3] == ['supabase', 'migration', 'up'] for a, _ in self.runner.commands))
        self.assertFalse(self.runner.live)

    def test_unsafe_provider_configuration_refused_before_processes(self):
        for config in ('[db.settings]\nfoo="bar"', '[auth.external.google]\nenabled=true',
                       '[auth.hook.send_email]\nenabled=true', '[db.vault]\nkey="secret"'):
            with self.subTest(config=config):
                self.config.write_text('project_id="owned_test"\n' + config + '\n')
                with self.assertRaises(RuntimeError):
                    self.runtime()
        self.assertEqual(self.runner.commands, [])

    def test_project_dotenv_override_refused_without_reading_secret(self):
        for directory in (self.project, self.project / 'supabase'):
            for name in ('.env.development.local', '.env.local', '.env.development', '.env'):
                path = directory / name
                path.write_text('SUPABASE_PROJECT_ID=foreign\n')
                with self.assertRaisesRegex(RuntimeError, 'dotenv files forbidden'):
                    self.runtime()
                path.unlink()
        self.assertEqual(self.runner.commands, [])

    def test_new_dotenv_after_admission_refuses_commands(self):
        runtime = self.runtime()
        (self.project / '.env').write_text('SUPABASE_PROJECT_ID=foreign\n')
        with self.assertRaisesRegex(RuntimeError, 'dotenv files forbidden'):
            runtime.config_unchanged()
        self.assertEqual(self.runner.commands, [])

    def test_environment_interpolation_refused(self):
        self.config.write_text('project_id="env(PROJECT)"\n')
        with self.assertRaisesRegex(RuntimeError, 'Environment-interpolated'):
            self.runtime()
        self.assertEqual(self.runner.commands, [])

    def test_preexisting_network_refused_before_start(self):
        self.runner.network_preexisting = True
        with self.assertRaisesRegex(RuntimeError, 'preexisting'):
            self.runtime().execute()
        self.assertFalse(any(a[:2] in (['supabase', 'start'], ['supabase', 'stop']) for a, _ in self.runner.commands))

    def test_foreign_network_attachment_refuses_cleanup(self):
        self.runner.foreign_network_attachment = True
        with self.assertRaisesRegex(RuntimeError, 'Foreign network'):
            self.runtime().execute()
        self.assertFalse(any(a[:2] == ['supabase', 'stop'] for a, _ in self.runner.commands))

    def test_ambiguous_docker_context_refused_before_processes(self):
        with patch.dict(os.environ, {'DOCKER_HOST': 'unix:///tmp/a.sock', 'DOCKER_CONTEXT': 'other'}):
            with self.assertRaisesRegex(RuntimeError, 'Ambiguous Docker'):
                self.runtime()
        self.assertEqual(self.runner.commands, [])

    def test_disabling_python_assertions_is_refused(self):
        with patch.dict(os.environ, {'PYTHONOPTIMIZE': '1'}):
            with self.assertRaisesRegex(RuntimeError, 'assertions enabled'):
                m.bootstrap_inputs(ROOT)

    def test_zero_sql_handles_absent_extension_relations_dynamically(self):
        self.assertIn("to_regclass('cron.job_run_details')", m.DRAIN_SQL)
        self.assertIn("execute 'select exists(select 1 from cron.job_run_details", m.DRAIN_SQL)
        self.assertNotIn('create extension', m.ZERO_SQL + m.DRAIN_SQL + m.SAFE_SQL)


if __name__ == '__main__':
    unittest.main()
