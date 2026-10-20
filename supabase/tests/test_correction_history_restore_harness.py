"""Owned correction-history restore contracts, without SQL or Docker."""
import copy
import importlib.util
import json
import math
import re
import sys
import tempfile
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'tests/controlled-drugs/engine/candidate/correction_history_restore.py'
SPEC = importlib.util.spec_from_file_location('correction_history_restore', SOURCE)
RESTORE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RESTORE)
sys.modules.setdefault('correction_history_restore', RESTORE)


class CorrectionRestoreOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.adapter = Mock()
        self.adapter.database = 'owned_controlled_corrections_0123456789'
        self.adapter.marker = '12345678-1234-4234-8234-123456789abc'
        self.registry = {self.adapter.database: {'role': 'restored', 'marker': self.adapter.marker}}

    def test_wrong_container_labels_prevent_every_database_command(self):
        self.adapter.verify.side_effect = AssertionError('project/workdir labels differ')
        with self.assertRaisesRegex(AssertionError, 'labels differ'):
            RESTORE._drop_owned_database(self.adapter, self.registry)
        self.adapter.raw_sql.assert_not_called()

    def test_unsafe_or_unregistered_clone_is_denied_before_commands(self):
        for name in ('postgres', 'owned_controlled_corrections_0123456789;drop database postgres',
                     'owned_controlled_corrections_aaaaaaaaaa', 'owned_other_restore_0123456789'):
            self.adapter.database = name
            with self.subTest(name=name), self.assertRaises(AssertionError):
                RESTORE._drop_owned_database(self.adapter, self.registry)
        self.adapter.verify.assert_not_called()
        self.adapter.raw_sql.assert_not_called()

    def test_unknown_or_mismatched_marker_cannot_authorize_commands(self):
        for marker in ('untrusted', '22345678-1234-4234-8234-123456789abc'):
            self.adapter.marker = marker
            with self.subTest(marker=marker), self.assertRaises(AssertionError):
                RESTORE._drop_owned_database(self.adapter, self.registry)
        self.adapter.raw_sql.assert_not_called()

    def test_actual_database_comment_mismatch_prevents_drop(self):
        self.adapter.raw_sql.return_value = 'other-owner'
        with self.assertRaisesRegex(AssertionError, 'ownership marker mismatch'):
            RESTORE._drop_owned_database(self.adapter, self.registry)
        self.assertEqual(self.adapter.raw_sql.call_count, 1)
        self.assertNotIn('drop database', self.adapter.raw_sql.call_args.args[0])

    def test_source_database_is_never_a_cleanup_target(self):
        self.registry[self.adapter.database]['role'] = 'source'
        self.adapter.raw_sql.return_value = self.adapter.marker
        with self.assertRaisesRegex(AssertionError, 'source database'):
            RESTORE._drop_owned_database(self.adapter, self.registry)
        self.assertFalse(any('drop database' in call.args[0] for call in self.adapter.raw_sql.call_args_list))

    def test_exact_marked_clone_is_removed_and_absence_verified(self):
        self.adapter.raw_sql.side_effect = [self.adapter.marker, '', '0']
        RESTORE._drop_owned_database(self.adapter, self.registry)
        self.assertEqual(self.adapter.raw_sql.call_args_list[1].args[0],
                         'drop database "' + self.adapter.database + '" with(force);')
        self.assertIn('select count(*)', self.adapter.raw_sql.call_args_list[2].args[0])

    def test_surviving_clone_cannot_report_cleanup_success(self):
        self.adapter.raw_sql.side_effect = [self.adapter.marker, '', '1']
        with self.assertRaises(AssertionError):
            RESTORE._drop_owned_database(self.adapter, self.registry)


class CorrectionRestoreValidationTests(unittest.TestCase):
    def setUp(self):
        self.record = {
            'kind': 'controlled-correction-history-restored-validation-v1',
            'canonical_corrections': 1000, 'canonical_operations': 1000,
            'native_dispenses': 1, 'native_allocations': 1,
            'retained_correction_version': 1000, 'valid_unattached_openings': 1,
            'frozen_states': 1, 'active_states': 0, 'controlled_events': 0,
            'retained_auth_sessions': 4, 'prepared_quantity': '0.125',
            'validation_timezone': 'UTC', 'opening_actor_session_present': True,
            'caller_claims_cleared': True, 'canonical_chain_and_receipts_verified': True,
            'exact_stored_head_and_boundary': True,
            'native_quantities_and_billing_unchanged': True,
            'opening_and_product_validated': True, 'all_deferred_constraints_validated': True,
            'no_other_lifecycle_families': True, 'audit_rows_unchanged_during_validation': True,
        }

    def parse(self, record=None, zone='UTC', sessions=4, actor_present=True):
        return RESTORE.parse_validation(json.dumps(self.record if record is None else record),
                                        zone, sessions, actor_present)

    def test_single_full_validation_accepts_exact_readback(self):
        self.assertEqual(self.parse(), self.record)

    def test_retired_sessions_require_zero_rows_and_absent_actor_session(self):
        record = {**self.record, 'retained_auth_sessions': 0, 'opening_actor_session_present': False}
        self.assertEqual(self.parse(record, sessions=0, actor_present=False), record)
        with self.assertRaises(AssertionError):
            self.parse(record)

    def test_partial_chain_wrong_head_or_activated_register_is_rejected(self):
        for key, value in (('canonical_corrections', 999), ('canonical_operations', 1001),
                           ('retained_correction_version', 999), ('native_dispenses', 2),
                           ('native_allocations', 2), ('active_states', 1),
                           ('controlled_events', 1), ('frozen_states', 0),
                           ('valid_unattached_openings', 0), ('prepared_quantity', '0.124')):
            with self.subTest(key=key, value=value), self.assertRaises(AssertionError):
                self.parse({**self.record, key: value})

    def test_integer_counts_cannot_be_boolean_float_or_string(self):
        for key in ('canonical_corrections', 'canonical_operations', 'native_dispenses',
                    'retained_correction_version', 'active_states', 'retained_auth_sessions'):
            for value in (True, 1000.0, '1000'):
                with self.subTest(key=key, value=value), self.assertRaises(AssertionError):
                    self.parse({**self.record, key: value})

    def test_every_validation_guarantee_requires_actual_boolean_true(self):
        flags = ('caller_claims_cleared', 'canonical_chain_and_receipts_verified',
                 'exact_stored_head_and_boundary', 'native_quantities_and_billing_unchanged',
                 'opening_and_product_validated', 'all_deferred_constraints_validated',
                 'no_other_lifecycle_families', 'audit_rows_unchanged_during_validation')
        for key in flags:
            for value in (False, 1):
                with self.subTest(key=key, value=value), self.assertRaises(AssertionError):
                    self.parse({**self.record, key: value})

    def test_wrong_timezone_session_count_or_presence_is_rejected(self):
        for key, value in (('validation_timezone', 'America/Denver'),
                           ('retained_auth_sessions', 3), ('opening_actor_session_present', False),
                           ('opening_actor_session_present', 1)):
            with self.subTest(key=key), self.assertRaises(AssertionError):
                self.parse({**self.record, key: value})
        for zone in ('UTC', 'America/Denver', 'Asia/Kathmandu'):
            record = {**self.record, 'validation_timezone': zone}
            self.assertEqual(self.parse(record, zone=zone), record)

    def test_missing_extra_or_multiple_json_records_never_count_as_validation(self):
        missing = dict(self.record)
        del missing['audit_rows_unchanged_during_validation']
        for record in (missing, {**self.record, 'raw_session_rows': []}):
            with self.subTest(record=record), self.assertRaises(AssertionError):
                self.parse(record)
        for output in ('', '{}', '[]\n' + json.dumps(self.record), '{}\n' + json.dumps(self.record),
                       json.dumps(self.record) + '\n' + json.dumps(self.record)):
            with self.subTest(output=output[:80]), self.assertRaises(AssertionError):
                RESTORE.parse_validation(output, 'UTC', 4, True)


class CorrectionRestorePreservationTests(unittest.TestCase):
    def setUp(self):
        self.source = {'public.fixture_relation_' + str(i): {'count': 0, 'hash': 'a' * 64}
                       for i in range(450)}
        self.source.update({
            'public.native_dispense_correction_events': {'count': 1000, 'hash': 'b' * 64},
            'public.native_dispense_correction_operations': {'count': 1000, 'hash': 'c' * 64},
            'public.stock_writer_admissions': {'count': 33, 'hash': 'd' * 64},
            'public.controlled_stock_openings': {'count': 0, 'hash': 'e' * 64},
            'public.controlled_draft_operations': {'count': 0, 'hash': 'f' * 64},
            'auth.sessions': {'count': 2, 'hash': '0' * 64},
        })
        self.committed = copy.deepcopy(self.source)
        self.committed['public.controlled_stock_openings'] = {'count': 1, 'hash': '1' * 64}
        self.committed['public.controlled_draft_operations'] = {'count': 1, 'hash': '2' * 64}
        self.committed['auth.sessions'] = {'count': 3, 'hash': '3' * 64}
        self.sessions = [{'id': 'old-session-a', 'user_id': 'old-user-a'},
                         {'id': 'old-session-b', 'user_id': 'old-user-b'}]

    def verify(self, source=None, committed=None, retained=None):
        return RESTORE.verify_source_preservation(
            self.source if source is None else source,
            self.committed if committed is None else committed, self.sessions,
            self.sessions if retained is None else retained)

    def test_all_456_relations_include_audit_and_preserved_sessions(self):
        self.assertEqual(len(self.source), 456)
        self.assertIs(self.verify(), True)

    def test_source_chain_receipts_audit_or_other_relation_changes_fail(self):
        for table in ('public.native_dispense_correction_events',
                      'public.native_dispense_correction_operations',
                      'public.stock_writer_admissions', 'public.fixture_relation_449'):
            changed = copy.deepcopy(self.committed)
            changed[table]['hash'] = '9' * 64
            with self.subTest(table=table), self.assertRaises(AssertionError):
                self.verify(committed=changed)

    def test_missing_or_extra_relation_cannot_be_normalized_away(self):
        for table in ('public.stock_writer_admissions', 'public.fixture_relation_449'):
            missing = copy.deepcopy(self.committed)
            del missing[table]
            with self.subTest(table=table), self.assertRaises(AssertionError):
                self.verify(committed=missing)
        extra = {**self.committed, 'public.unreviewed': {'count': 0, 'hash': '0' * 64}}
        with self.assertRaises(AssertionError):
            self.verify(committed=extra)

    def test_session_count_requires_exactly_one_new_clone_session(self):
        for count in (2, 4, True, 3.0):
            changed = copy.deepcopy(self.committed)
            changed['auth.sessions']['count'] = count
            with self.subTest(count=count), self.assertRaises(AssertionError):
                self.verify(committed=changed)

    def test_same_old_session_count_cannot_hide_changed_or_replaced_rows(self):
        for retained in ([], self.sessions[:1],
                         [self.sessions[0], {'id': 'old-session-b', 'user_id': 'changed-user'}],
                         [self.sessions[0], {'id': 'replacement-session', 'user_id': 'old-user-b'}]):
            with self.subTest(retained=retained), self.assertRaises(AssertionError):
                self.verify(retained=retained)


class _FakeOwnedRuntime:
    """Stateful local database protocol; it executes no shell or SQL."""
    def __init__(self, folder, source, committed, sessions):
        self.database = 'owned_controlled_corrections_0123456789'
        self.marker = '12345678-1234-4234-8234-123456789abc'
        self.container = 'owned-fake-runtime'
        self.folder = folder
        self.workload_deadline = 1000
        self.operation_deadline = None
        self.safety_cleanup_mode = False
        self.state = {'snapshots': {self.database: copy.deepcopy(source), 'postgres': copy.deepcopy(source)},
                      'markers': {self.database: self.marker}, 'source': source, 'committed': committed,
                      'sessions': sessions, 'commands': [], 'created': [], 'drop_attempts': [],
                      'deadlines': [], 'clock': 100.0, 'late_label': None,
                      'raise_label': None, 'fail_drops': False, 'fail_diagnostics': False}
        self.expected_technical = {'manifest': {'revision': 1},
                                   'writers': {'writer-' + str(i): 'a' * 64 for i in range(10)}}

    def verify(self):
        return None

    def raw_sql(self, query, target='postgres', timeout=180):
        state = self.state
        state['commands'].append((self.database, query))
        if query.startswith('create database '):
            name = re.search(r'"([^"]+)"', query).group(1)
            state['created'].append(name)
            state['snapshots'][name] = {}
        elif query.startswith('comment on database '):
            name = re.search(r'"([^"]+)"', query).group(1)
            state['markers'][name] = re.search(r" is '([^']+)'", query).group(1)
        elif 'shobj_description' in query:
            name = re.search(r"datname='([^']+)'", query).group(1)
            return state['markers'].get(name, '')
        elif query.startswith('drop database '):
            name = re.search(r'"([^"]+)"', query).group(1)
            state['drop_attempts'].append(name)
            if state['fail_drops']:
                raise RuntimeError('injected clone cleanup failure')
            del state['snapshots'][name]
            del state['markers'][name]
        elif 'select count(*)from pg_database' in query:
            name = re.search(r"datname='([^']+)'", query).group(1)
            return '1' if name in state['snapshots'] else '0'
        return ''

    def snapshot(self, target='postgres'):
        return copy.deepcopy(self.state['snapshots'][target])

    def technical(self, target='postgres'):
        return copy.deepcopy(self.expected_technical)

    def command(self, argv, query=None, timeout=180):
        assert 'pg_dump' in argv
        return 'DUMP ' + argv[-1]

    def capture_failure(self, label):
        if self.state['fail_diagnostics']:
            raise RuntimeError('injected diagnostic failure')


class CorrectionRestoreIntegrationTests(unittest.TestCase):
    def setUp(self):
        fixture = CorrectionRestorePreservationTests()
        fixture.setUp()
        validation = CorrectionRestoreValidationTests()
        validation.setUp()
        self.validation = validation.record
        self.source = fixture.source
        self.committed = fixture.committed
        self.sessions = fixture.sessions
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.runtime = _FakeOwnedRuntime(Path(temporary.name), self.source, self.committed, self.sessions)

    def stage(self, adapter, sql, deadline, label):
        state = adapter.state
        state['deadlines'].append((label, deadline))
        state['clock'] += 1
        if state['raise_label'] == label:
            raise RuntimeError('primary fixture failure')
        if state['late_label'] == label:
            state['clock'] = deadline
        if label == 'restore-load-source':
            state['snapshots'][adapter.database] = copy.deepcopy(self.source)
        elif label in ('restore-persist-opening', 'restore-load-populated'):
            state['snapshots'][adapter.database] = copy.deepcopy(self.committed)
        elif label.startswith('restore-sessions-'):
            return json.dumps({'rows': self.sessions})
        elif label.startswith('restore-validate-'):
            retired = label == 'restore-validate-retired-sessions'
            zone = re.search(r"set local timezone='([^']+)'", sql).group(1)
            return json.dumps({**self.validation, 'validation_timezone': zone,
                               'retained_auth_sessions': 0 if retired else len(self.sessions) + 1,
                               'opening_actor_session_present': not retired})
        return ''

    def run_probe(self):
        with patch.object(RESTORE.time, 'monotonic', side_effect=lambda: self.runtime.state['clock']):
            return RESTORE.probe_correction_restore(
                self.runtime, 'BUILD', '-- CORRECTION_RESTORE_TIMEZONE --\nVALIDATE',
                self.source, self.runtime.expected_technical, self.stage)

    def test_full_fake_restore_keeps_one_shared_deadline_and_cleans_both_targets(self):
        proof = self.run_probe()
        self.assertIs(proof['passed'], True)
        self.assertEqual(len(proof['validations']), 7)
        self.assertEqual({deadline for _, deadline in self.runtime.state['deadlines']}, {1000})
        self.assertEqual(set(self.runtime.state['drop_attempts']), set(self.runtime.state['created']))
        self.assertEqual(len(self.runtime.state['drop_attempts']), 2)
        self.assertEqual(self.runtime.database, 'owned_controlled_corrections_0123456789')
        self.assertEqual(self.runtime.marker, '12345678-1234-4234-8234-123456789abc')
        self.assertFalse(self.runtime.safety_cleanup_mode)
        self.assertEqual(self.runtime.workload_deadline, 1000)
        self.assertNotIn(self.runtime.database, json.dumps(proof))
        self.assertNotIn(self.runtime.marker, json.dumps(proof))
        self.assertNotIn('snapshots', json.dumps(proof))

    def test_expired_or_nonfinite_deadline_starts_no_commands(self):
        for deadline in (100, math.nan, math.inf, True):
            self.runtime.workload_deadline = deadline
            with self.subTest(deadline=deadline), self.assertRaises(AssertionError):
                self.run_probe()
        self.assertEqual(self.runtime.state['commands'], [])
        self.assertEqual(self.runtime.state['deadlines'], [])

    def test_late_successful_validation_cannot_pass_and_still_cleans_all_targets(self):
        self.runtime.state['late_label'] = 'restore-validate-populated-utc'
        with self.assertRaisesRegex(AssertionError, 'deadline'):
            self.run_probe()
        self.assertEqual(set(self.runtime.state['drop_attempts']), set(self.runtime.state['created']))
        self.assertEqual(len(self.runtime.state['drop_attempts']), 2)
        self.assertFalse(self.runtime.safety_cleanup_mode)

    def test_cleanup_and_diagnostic_failures_do_not_replace_primary_error_or_skip_targets(self):
        self.runtime.state.update(raise_label='restore-validate-populated-utc',
                                  fail_drops=True, fail_diagnostics=True)
        with self.assertRaisesRegex(RuntimeError, '^primary fixture failure$'):
            self.run_probe()
        self.assertEqual(set(self.runtime.state['drop_attempts']), set(self.runtime.state['created']))
        self.assertEqual(len(self.runtime.state['drop_attempts']), 2)
        self.assertFalse(self.runtime.safety_cleanup_mode)

    def test_cleanup_failure_after_valid_workload_is_not_acceptance(self):
        self.runtime.state['fail_drops'] = True
        with self.assertRaisesRegex(AssertionError, 'cleanup'):
            self.run_probe()
        self.assertEqual(len(self.runtime.state['drop_attempts']), 2)

    def test_parent_acceptance_requires_matching_validated_restore_proof(self):
        fixture_path = ROOT / 'supabase/tests/test_correction_capacity_harness.py'
        spec = importlib.util.spec_from_file_location('correction_capacity_test_fixture', fixture_path)
        fixtures = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fixtures)
        fixture = fixtures.CorrectionFinalProofTests()
        fixture.setUp()
        base = fixture.finalizable_proof()
        restored = self.run_probe()
        cleanup = {'marked_database_removed': True, 'source_runtime_unchanged_after_cleanup': True}
        valid = {**base, 'selected_schema_populated_restore_proven': True,
                 'correction_history_populated_restore': restored}
        accepted = fixtures.PROBE.finalize_acceptance(valid, True, cleanup)
        self.assertIs(accepted['passed'], True)
        for proof in ({**base, 'selected_schema_populated_restore_proven': True},
                      {**valid, 'selected_schema_populated_restore_proven': False},
                      {**valid, 'selected_schema_populated_restore_proven': 1},
                      {**valid, 'correction_history_populated_restore': {**restored, 'passed': False}},
                      {**valid, 'correction_history_populated_restore': {**restored, 'canonical_corrections': 999}}):
            with self.subTest(proof=proof.get('selected_schema_populated_restore_proven')), self.assertRaises(AssertionError):
                fixtures.PROBE.finalize_acceptance(proof, True, cleanup)

    def test_public_proof_rejects_partial_counts_lost_zones_or_private_payloads(self):
        proof = self.run_probe()
        for key, value in (('canonical_corrections', 999), ('selected_relation_count', 455),
                           ('passed', 1), ('source_clone_all_relations_unchanged', False),
                           ('marked_populated_and_restored_databases_removed', False),
                           ('synthetic_opening_sessions_added_only_in_clone', True),
                           ('hosted_writes', True), ('clinical_or_register_activation', True),
                           ('fresh_validation_caller_timezones', ['UTC'])):
            changed = copy.deepcopy(proof)
            changed[key] = value
            with self.subTest(key=key), self.assertRaises(AssertionError):
                RESTORE.validate_restore_proof(changed)
        for changed in ({**proof, 'raw_fingerprints': self.source},
                        {**proof, 'validations': proof['validations'][:-1]},
                        {**proof, 'validations': proof['validations'] + proof['validations'][:1]}):
            with self.assertRaises(AssertionError):
                RESTORE.validate_restore_proof(changed)

    def test_public_proof_requires_session_retirement_and_exact_role_zone_order(self):
        proof = self.run_probe()
        for index, key, value in ((6, 'sessions_retired', False), (6, 'retained_auth_sessions', 3),
                                  (0, 'database_role', 'restored'), (0, 'sessions_retired', 0),
                                  (1, 'validation_timezone', 'UTC')):
            changed = copy.deepcopy(proof)
            changed['validations'][index][key] = value
            with self.subTest(index=index, key=key), self.assertRaises(AssertionError):
                RESTORE.validate_restore_proof(changed)


if __name__ == '__main__':
    unittest.main()
