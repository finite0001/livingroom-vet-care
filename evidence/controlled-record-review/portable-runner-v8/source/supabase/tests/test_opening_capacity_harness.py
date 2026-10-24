"""Capacity clone cleanup refuses destructive operations without ownership."""
import importlib.util
import io
import subprocess
import tempfile
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

SOURCE = Path(__file__).resolve().parents[2] / 'tests/controlled-drugs/engine/candidate/probe-capacity.py'
SPEC = importlib.util.spec_from_file_location('opening_capacity_probe', SOURCE)
CAPACITY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CAPACITY)


class OpeningCapacityOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.runtime = Mock()
        self.target = 'owned_controlled_capacity_0123456789'
        self.marker = '12345678-1234-4234-8234-123456789abc'

    def test_wrong_database_comment_refuses_drop(self):
        self.runtime.raw_sql.return_value = 'another-owner'
        with self.assertRaisesRegex(AssertionError, 'marker mismatch'):
            CAPACITY.drop_database(self.runtime, self.target, self.marker)
        self.assertFalse(any('drop database' in c.args[0] for c in self.runtime.raw_sql.call_args_list))

    def test_wrong_container_labels_refuse_every_database_query(self):
        self.runtime.verify.side_effect = AssertionError('project/workdir differs')
        with self.assertRaisesRegex(AssertionError, 'project/workdir differs'):
            CAPACITY.drop_database(self.runtime, self.target, self.marker)
        self.runtime.raw_sql.assert_not_called()

    def test_unsafe_database_names_are_rejected_before_commands(self):
        for target in ('postgres', 'owned_controlled_capacity_0123456789;drop database postgres',
                       'owned_controlled_capacity_NOTOWNED00'):
            with self.subTest(target=target), self.assertRaisesRegex(AssertionError, 'Unsafe'):
                CAPACITY.drop_database(self.runtime, target, self.marker)
        self.runtime.verify.assert_not_called()
        self.runtime.raw_sql.assert_not_called()

    def test_invalid_marker_cannot_authorize_drop(self):
        with self.assertRaisesRegex(AssertionError, 'Invalid capacity ownership marker'):
            CAPACITY.drop_database(self.runtime, self.target, 'untrusted')
        self.runtime.raw_sql.assert_not_called()

    def test_matching_marker_drops_only_exact_clone_and_verifies_absence(self):
        self.runtime.raw_sql.side_effect = [self.marker, '', '0\n']
        CAPACITY.drop_database(self.runtime, self.target, self.marker)
        self.runtime.verify.assert_called_once_with()
        self.assertEqual(self.runtime.raw_sql.call_args_list[1].args[0],
                         'drop database "' + self.target + '" with(force);')
        self.assertIn('select count(*)from pg_database', self.runtime.raw_sql.call_args_list[2].args[0])

    def test_surviving_clone_cannot_report_cleanup_success(self):
        self.runtime.raw_sql.side_effect = [self.marker, '', '1\n']
        with self.assertRaisesRegex(AssertionError, 'database remains'):
            CAPACITY.drop_database(self.runtime, self.target, self.marker)

    def test_sql_rejects_unregistered_database_before_ownership_checks(self):
        runtime = CAPACITY.Runtime.__new__(CAPACITY.Runtime)
        runtime.database = self.target
        runtime.raw_sql = Mock()
        with self.assertRaisesRegex(AssertionError, 'Unexpected capacity SQL target'):
            runtime.sql('select 1;', 'another_database')
        runtime.raw_sql.assert_not_called()


class OpeningCapacityDiagnosticTests(unittest.TestCase):
    def runtime(self, folder):
        runtime = CAPACITY.Runtime.__new__(CAPACITY.Runtime)
        runtime.folder = Path(folder)
        runtime.container = 'supabase_db_lrv-controlled-engine-0123456789'
        runtime.log = io.StringIO()
        runtime.verify = Mock()
        return runtime

    def test_wrong_container_ownership_refuses_log_collection(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(CAPACITY.subprocess, 'run') as run:
            runtime = self.runtime(folder)
            runtime.verify.side_effect = AssertionError('wrong labels')
            runtime.capture_failure('maximum_dispenses-execution')
            run.assert_not_called()
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_owned_container_logs_are_written_privately_without_stdout(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(CAPACITY.subprocess, 'run') as run:
            runtime = self.runtime(folder)
            run.return_value = Mock(returncode=0, stdout='database diagnostic output', stderr='diagnostic stderr')
            runtime.capture_failure('maximum_dispenses-execution')
            runtime.verify.assert_called_once_with()
            self.assertEqual(run.call_args.args[0], ['docker', 'logs', '--tail', '400', runtime.container])
            self.assertTrue(run.call_args.kwargs['capture_output'])
            saved = list(Path(folder).glob('engine-capacity-diagnostic-*.log'))
            self.assertEqual(len(saved), 1)
            self.assertIn('database diagnostic output', saved[0].read_text())
            self.assertIn('diagnostic stderr', saved[0].read_text())

    def test_failed_diagnostic_collection_never_replaces_original_error(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(CAPACITY.subprocess, 'run') as run:
            runtime = self.runtime(folder)
            run.side_effect = subprocess.TimeoutExpired('docker logs', 10)
            original = ValueError('original SQL error')
            try:
                try:
                    raise original
                except ValueError:
                    runtime.capture_failure('maximum_dispenses-execution')
                    raise
            except ValueError as actual:
                self.assertIs(actual, original)
            self.assertIn('TimeoutExpired', runtime.log.getvalue())

    def test_recovery_cleanup_errors_preserve_pending_execution_error(self):
        runtime = Mock(database='owned_controlled_capacity_0123456789', marker='12345678-1234-4234-8234-123456789abc')
        runtime.snapshot.side_effect = RuntimeError('database in recovery')
        with patch.object(CAPACITY, 'drop_database', side_effect=RuntimeError('marker SQL in recovery')):
            CAPACITY.cleanup_scenario(runtime, {}, True, True, 'maximum_dispenses')
        self.assertEqual([call.args[0] for call in runtime.capture_failure.call_args_list],
                         ['maximum_dispenses-cleanup', 'maximum_dispenses-source-check'])

    def test_new_cleanup_failure_is_not_reported_as_success(self):
        runtime = Mock(database='owned_controlled_capacity_0123456789', marker='12345678-1234-4234-8234-123456789abc')
        failure = RuntimeError('marker SQL in recovery')
        with patch.object(CAPACITY, 'drop_database', side_effect=failure), self.assertRaises(RuntimeError) as caught:
            CAPACITY.cleanup_scenario(runtime, {}, True, False, 'maximum_dispenses')
        self.assertIs(caught.exception, failure)


if __name__ == '__main__':
    unittest.main()
