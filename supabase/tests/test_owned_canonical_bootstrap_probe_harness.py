"""Pure tests of independent lockpoint and refusal/delta evidence; no database."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import shutil

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('owned_bootstrap_probe_tested', ROOT / 'supabase/tests/probe_owned_canonical_bootstrap.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def failure(message, returncode=1):
    return subprocess.CompletedProcess([], returncode, '', json.dumps({'_tag': 'Error', 'error': {
        'code': 'MigrationApplyError', 'message': message}}))


class OwnedBootstrapProbeTests(unittest.TestCase):
    def snapshots(self):
        before = {'catalog': {'unchanged': True}, 'ledger': [1], 'types': {'x': 1},
                  'rows': {'public.scheduler_job_runs': [], 'public.scheduler_job_results': [], 'public.other': []}}
        after = copy.deepcopy(before)
        after['rows']['public.scheduler_job_runs'] = [{'id': 'r', 'job': 'dispatch-outbox',
            'url_path': '/functions/v1/dispatch-outbox', 'request_id': None}]
        after['rows']['public.scheduler_job_results'] = [{'run_id': 'r', 'outcome': 'configuration_missing',
            'status_code': None, 'error_message': 'Missing Vault secret(s): project_url, scheduler_worker_key'}]
        return before, after

    def test_shared_runtime_preserves_workdir_when_helper_cleanup_unverified(self):
        for receipt in (None, {'failure_cleanup_complete': False}, {'failure_cleanup_complete': True}):
            with self.subTest(receipt=receipt), tempfile.TemporaryDirectory() as directory:
                runtime = m.base.OwnedRuntime(Path(directory))
                def command(argv, *args, **kwargs):
                    if argv == ['supabase', '--version']:
                        return subprocess.CompletedProcess(argv, 0, '2.118.0', '')
                    self.assertIn('owned_canonical_bootstrap.py', argv[2])
                    if receipt is not None:
                        result = Path(directory) / 'bootstrap/result.json'
                        result.parent.mkdir()
                        result.write_text(json.dumps(receipt))
                    raise RuntimeError('helper failed')
                runtime.command = command
                try:
                    with patch.object(m.base.socket, 'socket'):
                        with self.assertRaisesRegex(RuntimeError, 'helper failed'):
                            runtime.start([])
                    self.assertFalse(runtime.started)
                    if receipt and receipt['failure_cleanup_complete']:
                        runtime.cleanup()
                        self.assertFalse(runtime.work.exists())
                        self.assertTrue(runtime.record['removed'])
                    else:
                        with self.assertRaisesRegex(RuntimeError, 'cleanup was not verified'):
                            runtime.cleanup()
                        self.assertTrue(runtime.work.exists())
                        self.assertFalse(runtime.record['removed'])
                        self.assertFalse((Path(directory) / 'cleanup.json').exists())
                    self.assertTrue(runtime.log.closed)
                finally:
                    if runtime.work.exists():
                        shutil.rmtree(runtime.work)
                    if not runtime.log.closed:
                        runtime.log.close()

    def test_owned_sql_uses_receipt_bound_immutable_container(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = object.__new__(m.Runtime)
            runtime.folder = Path(directory)
            runtime.project = Path(directory)
            runtime.identity = 'test'
            runtime.record = {}
            runtime.container = 'supabase_db_test'
            identity = 'a' * 64
            observed = {'Id': identity, 'Config': {'Labels': {
                'com.supabase.cli.project': 'test', 'com.supabase.cli.workdir': directory}}}
            runtime.bind_container({'container_id': identity}, observed)
            commands = []
            def command(argv, *args, **kwargs):
                commands.append(argv)
                return subprocess.CompletedProcess(argv, 0, json.dumps([observed]) if argv[1] == 'inspect' else '1', '')
            runtime.command = command
            self.assertEqual(runtime.sql('select 1;').stdout, '1')
            self.assertEqual(commands[-1][:4], ['docker', 'exec', '-i', identity])
            self.assertEqual(runtime.container, identity)
            with self.assertRaisesRegex(AssertionError, 'receipt/container mismatch'):
                runtime.bind_container({'container_id': 'b' * 64}, observed)

    def test_saved_source_inventory_detects_added_and_removed_members(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / 'inputs').mkdir()
            first = folder / 'inputs/first.py'
            first.write_text('original')
            baseline = m.saved_inputs(folder)
            added = folder / 'inputs/extra.py'
            added.write_text('extra')
            self.assertNotEqual(m.saved_inputs(folder), baseline)
            added.unlink()
            first.unlink()
            self.assertNotEqual(m.saved_inputs(folder), baseline)

    def test_exact_frozen_statement_lockpoint_follows_baseline(self):
        value = m.lockpoint_source_check()
        self.assertLess(value['baseline_statement_index'], value['blocked_statement_index'])
        self.assertEqual(value['body_sha256'], 'de8e0f4c0d2100b47a490dbd9b8e65c957fa49d003d447cb1af6f37aa8a75bfc')

    def test_exact_primary_cli_error_accepted(self):
        message = 'ERROR: ' + m.MESSAGE + ' (SQLSTATE 23514)'
        self.assertEqual(m.exact_primary_failure(failure(message + '\nAt statement:302')), message)

    def test_echoed_sql_cannot_supply_primary_failure(self):
        message = 'ERROR: unrelated failure (SQLSTATE 23514)\nERROR: ' + m.MESSAGE + ' (SQLSTATE 23514)'
        with self.assertRaisesRegex(AssertionError, 'primary'):
            m.exact_primary_failure(failure(message))

    def test_wrong_state_and_success_status_are_refused(self):
        for result in (failure('ERROR: ' + m.MESSAGE + ' (SQLSTATE P0001)'),
                       failure('ERROR: ' + m.MESSAGE + ' (SQLSTATE 23514)', 0)):
            with self.assertRaises(AssertionError):
                m.exact_primary_failure(result)

    def test_multiple_or_duplicate_error_envelopes_are_refused(self):
        result = failure('ERROR: ' + m.MESSAGE + ' (SQLSTATE 23514)')
        with self.assertRaises(AssertionError):
            m.exact_primary_failure(subprocess.CompletedProcess([], 1, result.stderr, result.stderr))
        duplicate = '{"_tag":"Error","_tag":"Error","error":{}}'
        with self.assertRaises(AssertionError):
            m.exact_primary_failure(subprocess.CompletedProcess([], 1, '', duplicate))

    def test_only_genuine_missing_configuration_receipts_are_accepted(self):
        before, after = self.snapshots()
        self.assertEqual(set(m.verify_timer_delta(before, after)), m.TIMER_TABLES)
        for column, value in (('request_id', 123), ('url_path', '/unexpected')):
            changed = copy.deepcopy(after)
            changed['rows']['public.scheduler_job_runs'][0][column] = value
            with self.assertRaises(AssertionError):
                m.verify_timer_delta(before, changed)

    def test_other_original_row_or_catalog_changes_are_refused(self):
        before, after = self.snapshots()
        for kind in ('row', 'catalog', 'ledger', 'extra_relation'):
            changed = copy.deepcopy(after)
            if kind == 'row':
                changed['rows']['public.other'] = [{'unexpected': True}]
            elif kind == 'extra_relation':
                changed['rows']['controlled_review.descriptor'] = []
            else:
                changed[kind] = {'unexpected': True}
            with self.assertRaises(AssertionError):
                m.verify_timer_delta(before, changed)

    def test_complete_probe_source_closure_includes_helper_and_harness(self):
        values = m.source_inputs()
        for name in ('scripts/owned_canonical_bootstrap.py', 'supabase/tests/probe_owned_canonical_bootstrap.py',
                     'supabase/tests/test_owned_canonical_bootstrap_probe_harness.py'):
            self.assertIn(name, values)
        self.assertEqual(sum(p.startswith('supabase/migrations/') for p in values), 206)


if __name__ == '__main__':
    unittest.main()
