"""Destructive restore cleanup refuses unowned targets without Docker."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock

SOURCE = Path(__file__).resolve().parents[2] / 'tests/controlled-drugs/engine/candidate/native_history_restore.py'
SPEC = importlib.util.spec_from_file_location('native_history_restore', SOURCE)
RESTORE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RESTORE)


class NativeHistoryRestoreTests(unittest.TestCase):
    def setUp(self):
        self.target = 'owned_old_stock_restore_0123456789'
        self.marker = '12345678-1234-4234-8234-123456789abc'
        self.markers = {self.target: self.marker}
        self.replay = Mock()

    def assert_no_drop(self):
        self.assertFalse(any('drop database' in call.args[0].lower()
                             for call in self.replay.sql.call_args_list))

    def test_wrong_comment_marker_refuses_cleanup(self):
        self.replay.sql.return_value = 'other-owner\n'
        with self.assertRaisesRegex(AssertionError, 'marker mismatch'):
            RESTORE._drop_owned_database(self.replay, self.target, self.markers)
        self.assert_no_drop()

    def test_container_ownership_failure_refuses_any_database_query(self):
        self.replay.verify.side_effect = AssertionError('Docker project/workdir labels differ')
        with self.assertRaisesRegex(AssertionError, 'labels differ'):
            RESTORE._drop_owned_database(self.replay, self.target, self.markers)
        self.replay.sql.assert_not_called()

    def test_unsafe_or_unknown_target_refuses_cleanup_before_sql(self):
        for target in ('postgres', 'owned_old_stock_restore_0123456789;drop database postgres',
                       'owned_old_stock_opening_aaaaaaaaaa'):
            with self.subTest(target=target), self.assertRaises(AssertionError):
                RESTORE._drop_owned_database(self.replay, target, self.markers)
        self.replay.sql.assert_not_called()
        self.replay.verify.assert_not_called()

    def test_invalid_local_marker_cannot_authorize_cleanup(self):
        with self.assertRaisesRegex(AssertionError, 'Invalid ownership marker'):
            RESTORE._drop_owned_database(self.replay, self.target, {self.target: 'untrusted'})
        self.replay.sql.assert_not_called()

    def test_exact_marker_drops_only_selected_owned_database_and_checks_absence(self):
        self.replay.sql.side_effect = [self.marker + '\n', '', '0\n']
        RESTORE._drop_owned_database(self.replay, self.target, self.markers)
        self.replay.verify.assert_called_once_with()
        self.assertEqual(self.replay.sql.call_args_list[1].args[0],
                         'drop database "' + self.target + '" with(force);')
        self.assertIn('select count(*)from pg_database', self.replay.sql.call_args_list[2].args[0])

    def test_surviving_database_is_cleanup_failure(self):
        self.replay.sql.side_effect = [self.marker, '', '1\n']
        with self.assertRaisesRegex(AssertionError, 'database remains'):
            RESTORE._drop_owned_database(self.replay, self.target, self.markers)


if __name__ == '__main__':
    unittest.main()
