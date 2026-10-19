"""Fail-closed correction-capacity harness contracts, without SQL or Docker."""
import importlib.util
import copy
import json
import math
import re
from pathlib import Path
import unittest
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[2]
CANDIDATE = ROOT / 'tests/controlled-drugs/engine/candidate'
SOURCE = CANDIDATE / 'probe-correction-capacity.py'
SPEC = importlib.util.spec_from_file_location('correction_capacity_probe', SOURCE)
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)


class CorrectionOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.runtime = Mock()
        self.target = 'owned_controlled_corrections_0123456789'
        self.marker = '12345678-1234-4234-8234-123456789abc'

    def test_wrong_marker_never_authorizes_drop(self):
        self.runtime.raw_sql.return_value = 'another-owner'
        with self.assertRaisesRegex(AssertionError, 'marker mismatch'):
            PROBE.drop_database(self.runtime, self.target, self.marker)
        self.assertFalse(any('drop database' in call.args[0].lower()
                             for call in self.runtime.raw_sql.call_args_list))

    def test_wrong_runtime_labels_prevent_any_database_query(self):
        self.runtime.verify.side_effect = AssertionError('project/workdir differ')
        with self.assertRaisesRegex(AssertionError, 'project/workdir differ'):
            PROBE.drop_database(self.runtime, self.target, self.marker)
        self.runtime.raw_sql.assert_not_called()

    def test_system_or_injected_target_is_rejected_before_commands(self):
        for target in ('postgres', 'owned_controlled_corrections_0123456789;drop database postgres',
                       'owned_controlled_capacity_0123456789'):
            with self.subTest(target=target), self.assertRaises(AssertionError):
                PROBE.drop_database(self.runtime, target, self.marker)
        self.runtime.verify.assert_not_called()
        self.runtime.raw_sql.assert_not_called()

    def test_malformed_marker_cannot_authorize_commands(self):
        with self.assertRaises(AssertionError):
            PROBE.drop_database(self.runtime, self.target, 'untrusted')
        self.runtime.verify.assert_not_called()
        self.runtime.raw_sql.assert_not_called()

    def test_exact_owned_clone_is_dropped_and_absence_verified(self):
        self.runtime.raw_sql.side_effect = [self.marker + '\n', '', '0\n']
        PROBE.drop_database(self.runtime, self.target, self.marker)
        self.assertEqual(self.runtime.raw_sql.call_args_list[1].args[0],
                         'drop database "' + self.target + '" with(force);')
        self.assertIn('select count(*)from pg_database', self.runtime.raw_sql.call_args_list[2].args[0])

    def test_surviving_clone_cannot_report_success(self):
        self.runtime.raw_sql.side_effect = [self.marker, '', '1\n']
        with self.assertRaisesRegex(AssertionError, 'database remains'):
            PROBE.drop_database(self.runtime, self.target, self.marker)

    def test_unregistered_sql_destination_is_rejected_before_execution(self):
        runtime = PROBE.Runtime.__new__(PROBE.Runtime)
        runtime.database = self.target
        runtime.raw_sql = Mock()
        with self.assertRaisesRegex(AssertionError, 'Unexpected correction SQL target'):
            runtime.sql('select 1;', 'another_database')
        runtime.raw_sql.assert_not_called()


class CorrectionContinuationTests(unittest.TestCase):
    def sample(self, previous=224, target=256, elapsed=10):
        return {'previous_target': previous, 'target': target, 'elapsed_seconds': elapsed}

    def test_calibration_has_no_fabricated_measurement_or_goal_claim(self):
        result = PROBE.admit_next_batch(0, 32, 900)
        self.assertIs(result['admitted'], True)
        self.assertIsNone(result['estimated_next_batch_seconds'])
        self.assertIs(result['calibration_without_sample'], True)
        self.assertIs(result['elapsed_is_production_benchmark'], False)
        self.assertEqual(result['goal_completion'], 'unknown')

    def test_next_batch_can_be_affordable_while_full_goal_remains_unknown(self):
        result = PROBE.admit_next_batch(256, 288, 300, self.sample())
        expected = 2 * 10 * (288 ** 3 - 256 ** 3) / (256 ** 3 - 224 ** 3)
        self.assertAlmostEqual(result['estimated_next_batch_seconds'], expected, places=3)
        self.assertIs(result['admitted'], True)
        self.assertEqual(result['goal_completion'], 'unknown')

    def test_equal_cost_plus_reserve_is_refused_without_rounding_allowance(self):
        sample = self.sample()
        exact = 120 + 2 * 10 * (288 ** 3 - 256 ** 3) / (256 ** 3 - 224 ** 3)
        self.assertIs(PROBE.admit_next_batch(256, 288, exact, sample)['admitted'], False)
        self.assertIs(PROBE.admit_next_batch(256, 288, exact + 0.0001, sample)['admitted'], True)

    def test_higher_cost_or_less_budget_cannot_turn_refusal_into_admission(self):
        for elapsed, remaining in ((10, 121), (20, 121), (10, 120.5)):
            self.assertIs(PROBE.admit_next_batch(256, 288, remaining,
                          self.sample(elapsed=elapsed))['admitted'], False)
        self.assertIs(PROBE.admit_next_batch(256, 288, 900, self.sample())['admitted'], True)

    def test_reserve_equal_or_smaller_budget_denies_calibration(self):
        for remaining in (120, 119, 0, -1):
            with self.subTest(remaining=remaining):
                try:
                    result = PROBE.admit_next_batch(0, 32, remaining)
                except AssertionError:
                    continue
                self.assertIs(result['admitted'], False)

    def test_final_short_batch_and_then_real_overlimit_writer_are_distinct(self):
        result = PROBE.admit_next_batch(992, 1000, 400, self.sample(960, 992, 10))
        self.assertIs(result['admitted'], True)
        short_sample = self.sample(992, 1000, 4)
        with self.assertRaises(AssertionError):
            PROBE.admit_next_batch(1000, 1001, 400, short_sample)
        with self.assertRaises(AssertionError):
            PROBE.admit_next_batch(1000, 1001, 400, short_sample, positive_accepted=1)
        self.assertIs(PROBE.admit_next_batch(1000, 1001, 400, short_sample,
                      positive_accepted=True)['admitted'], True)

    def test_invalid_nonadvancing_or_skipped_batch_targets_fail_closed(self):
        for current, target in ((0, 0), (32, 32), (64, 32), (-1, 32), (0, 33),
                                (32, 65), (0, 64), (992, 1024), (1000, 1002),
                                (False, 32), (0, True), (0, 32.0)):
            with self.subTest(current=current, target=target), self.assertRaises(AssertionError):
                PROBE.admit_next_batch(current, target, 900)

    def test_only_first_batch_may_omit_cost_sample(self):
        with self.assertRaises(AssertionError):
            PROBE.admit_next_batch(32, 64, 900)
        with self.assertRaises(AssertionError):
            PROBE.admit_next_batch(0, 32, 900, self.sample(0, 32, 1))

    def test_mismatched_nonadvancing_or_overwide_sample_is_rejected(self):
        for sample in (self.sample(192, 224), self.sample(256, 256), self.sample(257, 256),
                       self.sample(223, 256), self.sample(False, 256),
                       {'previous_target': 224, 'target': 256},
                       {**self.sample(), 'unreviewed': 1}):
            with self.subTest(sample=sample), self.assertRaises(AssertionError):
                PROBE.admit_next_batch(256, 288, 900, sample)

    def test_nonfinite_or_boolean_measurements_and_budget_are_rejected(self):
        for value in (0, -1, True, '1', math.nan, math.inf):
            with self.subTest(value=value), self.assertRaises(AssertionError):
                PROBE.admit_next_batch(256, 288, 900, self.sample(elapsed=value))
        for value in (True, '900', math.nan, math.inf):
            with self.subTest(value=value), self.assertRaises(AssertionError):
                PROBE.admit_next_batch(256, 288, value, self.sample())

    def test_validation_reserve_and_safety_factor_cannot_be_weakened(self):
        for kwargs in ({'reserve_seconds': 119}, {'reserve_seconds': True},
                       {'reserve_seconds': math.nan}, {'safety_factor': 1},
                       {'safety_factor': True}, {'safety_factor': math.inf}):
            with self.subTest(kwargs=kwargs), self.assertRaises(AssertionError):
                PROBE.admit_next_batch(256, 288, 900, self.sample(), **kwargs)


class CorrectionObservationTests(unittest.TestCase):
    def setUp(self):
        self.seed = {
            'kind': 'controlled-opening-correction-capacity-seed-v1',
            'ids_json': {'dispense': '12345678-1234-4234-8234-123456789abc'},
            'source_baseline': {'inventory': {'count': 1}},
        }
        self.checkpoint = {
            'kind': 'controlled-opening-correction-capacity-checkpoint-v1',
            'corrections': 256,
            'genuine_canonical_writers': True,
            'billing_unchanged': True,
            'native_quantities_unchanged': True,
            'receipts_and_chain_verified': True,
            'fingerprint': {'public.native_dispense_correction_events': {'count': 256, 'hash': 'a' * 64}},
        }

    def test_one_valid_observation_can_follow_psql_command_tags(self):
        seed = PROBE.parse_seed('SET\n' + json.dumps(self.seed) + '\nCOMMIT\n')
        checkpoint = PROBE.parse_checkpoint(json.dumps(self.checkpoint), 256)
        self.assertEqual(seed['ids_json'], self.seed['ids_json'])
        self.assertEqual(checkpoint['corrections'], 256)

    def test_missing_or_extraneous_json_cannot_be_treated_as_a_checkpoint(self):
        for output in ('SET\nCOMMIT\n', '{}\n' + json.dumps(self.checkpoint),
                       json.dumps(self.checkpoint) + '\n' + json.dumps(self.checkpoint)):
            with self.subTest(output=output[:40]), self.assertRaises(AssertionError):
                PROBE.parse_checkpoint(output, 256)

    def test_seed_and_checkpoint_are_not_interchangeable(self):
        with self.assertRaises(AssertionError):
            PROBE.parse_seed(json.dumps(self.checkpoint))
        with self.assertRaises(AssertionError):
            PROBE.parse_checkpoint(json.dumps(self.seed), 256)

    def test_partial_stage_never_impersonates_a_thousand_event_checkpoint(self):
        with self.assertRaises(AssertionError):
            PROBE.parse_checkpoint(json.dumps(self.checkpoint), 1000)

    def test_inexact_or_boolean_event_counts_are_rejected(self):
        for count in (255, '256', 256.0, True):
            checkpoint = copy.deepcopy(self.checkpoint)
            checkpoint['corrections'] = count
            with self.subTest(count=count), self.assertRaises(AssertionError):
                PROBE.parse_checkpoint(json.dumps(checkpoint), 256)

    def test_false_missing_or_numeric_verified_flags_cannot_pass(self):
        for flag in ('genuine_canonical_writers', 'billing_unchanged',
                     'native_quantities_unchanged', 'receipts_and_chain_verified'):
            for mode in ('missing', 'false', 'numeric'):
                checkpoint = copy.deepcopy(self.checkpoint)
                if mode == 'missing':
                    checkpoint.pop(flag)
                else:
                    checkpoint[flag] = False if mode == 'false' else 1
                with self.subTest(flag=flag, mode=mode), self.assertRaises(AssertionError):
                    PROBE.parse_checkpoint(json.dumps(checkpoint), 256)

    def test_unscoped_or_invalid_relation_fingerprints_fail(self):
        for fingerprint in ({}, {'pg_catalog.pg_class': {'count': 1, 'hash': 'a' * 64}},
                            {'public': {'count': 1, 'hash': 'a' * 64}},
                            {'public.native_dispense_correction_events': {'count': True, 'hash': 'a' * 64}},
                            {'public.native_dispense_correction_events': {'count': -1, 'hash': 'a' * 64}},
                            {'public.native_dispense_correction_events': {'count': 256, 'hash': 'invalid'}},
                            {'public.native_dispense_correction_events': {'count': 256}}):
            checkpoint = copy.deepcopy(self.checkpoint)
            checkpoint['fingerprint'] = fingerprint
            with self.subTest(fingerprint=fingerprint), self.assertRaises(AssertionError):
                PROBE.parse_checkpoint(json.dumps(checkpoint), 256)

    def test_missing_or_noncanonical_seed_ids_fail(self):
        for ids in ({}, {'dispense': 'not-a-uuid'}, {'dispense': 123},
                    {'dispense': '12345678-1234-4234-8234-123456789ABC'}):
            seed = copy.deepcopy(self.seed)
            seed['ids_json'] = ids
            with self.subTest(ids=ids), self.assertRaises((AssertionError, ValueError)):
                PROBE.parse_seed(json.dumps(seed))

    def test_missing_original_source_baseline_is_rejected(self):
        for baseline in ({}, None, []):
            seed = copy.deepcopy(self.seed)
            seed['source_baseline'] = baseline
            with self.subTest(baseline=baseline), self.assertRaises(AssertionError):
                PROBE.parse_seed(json.dumps(seed))


class CorrectionFinalProofTests(unittest.TestCase):
    def setUp(self):
        refused = lambda label, error: {
            'label': label, 'outcome': 'refused', 'error': error, 'sqlstate': '23514',
            'armed_before_observation': True, 'four_schema_and_manifest_rollback': True,
        }
        accepted = lambda label: {'label': label, 'outcome': 'accepted_assertion'}
        self.positive = {
            'kind': 'controlled-opening-correction-capacity-positive-v1',
            'corrections': 1000, 'genuine_dispenses': 1, 'genuine_max_allocations': 1,
            'full_opening_validated': True, 'unattached_frozen_only': True,
            'genuine_canonical_writers': True, 'receipts_and_chain_verified': True,
            'billing_unchanged': True, 'native_quantities_unchanged': True,
            'exact_replay_no_extra_event': True, 'separate_scenario_not_simultaneous_maxima': True,
            'sql_checks': 8, 'refusals': 2,
            'outcomes': [accepted(label) for label in (
                'genuine1000_receipts_hashes_contiguous_chain',
                'annotations_preserve_exact_source_quantities_and_billing',
                'exact1000th_replay_same_receipt_no_extra_event',
                'genuine1000_exact_retained_head_fullopening',
                'single_prepared_allocation_no_other_lifecycle_family',
                'unattached_frozen_noactivation')]
            + [refused('forged_retained_correction_head',
                       'Stored opening custody must equal the canonical retained native prefix'),
               refused('missing_retained_correction_head', 'Exact controlled-operation fields required')],
            'retained_boundary': [{'correction_head': {
                'event_id': '12345678-1234-4234-8234-123456789abc',
                'version': 1000, 'record_hash': 'a' * 64}}],
        }
        before = {
            'public.stock_writer_admissions': {'count': 33, 'hash': 'c' * 64},
            'public.native_dispense_correction_events': {'count': 1000, 'hash': 'd' * 64},
            'public.native_dispense_correction_operations': {'count': 1000, 'hash': 'e' * 64},
            'public.billing_invoice_items': {'count': 1, 'hash': 'f' * 64},
        }
        after = copy.deepcopy(before)
        after['public.stock_writer_admissions'] = {'count': 34, 'hash': '9' * 64}
        self.replay = {
            'kind': 'controlled-opening-correction-capacity-replay-baseline-v1',
            'before_replay': before, 'after_replay': after,
            'expected_admission_only': True, 'prior_admission_rows_preserved': True,
            'new_admission_rows': 1,
        }
        self.baseline = {
            'kind': 'controlled-opening-correction-capacity-canonical-baseline-v1',
            'corrections': 1001, 'native_dispenses': 1,
            'canonical_fixture_committed_inside_owned_clone': True,
            'fingerprint': {'public.native_dispense_correction_events': {'count': 1001, 'hash': 'b' * 64}},
        }
        self.final = {
            'kind': 'controlled-opening-correction-capacity-observation-v1',
            'corrections': 1001, 'genuine_dispenses': 1, 'genuine_max_allocations': 1,
            'hosted_writes': 0, 'clinical_or_register_activation': False,
            'genuine1001st_canonical_writer_succeeded': True,
            'retained1000_and_zero_refused_without_truncation': True,
            'synthetic_only': True, 'configuration_transactions_rolled_back': True,
            'canonical_fixture_committed_inside_owned_clone': True,
            'canonical_fixture_removed_by_owned_clone_cleanup': True,
            'sql_checks': 3, 'refusals': 2,
            'outcomes': [accepted('genuine1001st_canonical_writer_and_unchanged_quantities')]
            + [refused(label, 'Native history exceeds opening candidate limit; no truncation permitted')
               for label in ('genuine1001_actual_count_retained1000', 'genuine1001_actual_count_retained0')],
        }

    def output(self, baseline=None, final=None):
        return '\n'.join(json.dumps(item) for item in (
            self.baseline if baseline is None else baseline,
            self.final if final is None else final))

    def positive_output(self, positive=None, replay=None):
        return '\n'.join(json.dumps(item) for item in (
            self.replay if replay is None else replay,
            self.positive if positive is None else positive))

    def summary(self):
        return PROBE.parse_positive(self.positive_output())[0]

    def finalizable_proof(self):
        proof, _ = PROBE.observation_result(self.output(), self.summary())
        for key in ('canonical_fixture_committed_only_inside_owned_clone',
                    'clone_configuration_all_relations_rolled_back_to_canonical_baseline',
                    'controlled_configuration_and_events_match_original_empty_source',
                    'technical_manifest_and_ten_canonical_writers_unchanged',
                    'source_runtime_all_relations_unchanged', 'genuine_1000_correction_chain_proven'):
            proof[key] = True
        proof['canonical_replay_audit'] = PROBE.verify_replay_baselines(
            self.replay, self.replay['before_replay'], self.replay['after_replay'])
        proof.update(clinical_or_register_activation=False, production_capacity_approved=False,
                     hosted_writes=0, provider_requests=0)
        return proof

    def test_only_complete_on_time_cleaned_proof_can_be_finalized(self):
        proof = self.finalizable_proof()
        cleanup = {'marked_database_removed': True, 'source_runtime_unchanged_after_cleanup': True}
        accepted = PROBE.finalize_acceptance(proof, True, cleanup)
        self.assertIs(accepted['passed'], True)
        self.assertNotIn('passed', proof)
        for on_time, status in ((False, cleanup), (1, cleanup),
                               (True, {**cleanup, 'marked_database_removed': False}),
                               (True, {**cleanup, 'source_runtime_unchanged_after_cleanup': False}),
                               (True, {**cleanup, 'marked_database_removed': 1}), (True, {})):
            with self.subTest(on_time=on_time, status=status), self.assertRaises(AssertionError):
                PROBE.finalize_acceptance(proof, on_time, status)

    def test_partial_or_contradictory_functional_proof_cannot_be_finalized(self):
        cleanup = {'marked_database_removed': True, 'source_runtime_unchanged_after_cleanup': True}
        mutations = (
            ('genuine_1000_correction_chain_proven', False),
            ('source_runtime_all_relations_unchanged', False),
            ('technical_manifest_and_ten_canonical_writers_unchanged', 1),
            ('unique_sql_checks', 10), ('clinical_or_register_activation', True),
            ('hosted_writes', 1))
        for key, value in mutations:
            proof = self.finalizable_proof()
            proof[key] = value
            with self.subTest(key=key), self.assertRaises(AssertionError):
                PROBE.finalize_acceptance(proof, True, cleanup)
        for field in ('genuine_capacity_positive', 'final_observation'):
            proof = self.finalizable_proof()
            proof[field]['corrections'] = 512
            with self.subTest(field=field), self.assertRaises(AssertionError):
                PROBE.finalize_acceptance(proof, True, cleanup)

    def test_full_evidence_keeps_private_boundary_outside_sanitized_result(self):
        positive, boundary, replay = PROBE.parse_positive(self.positive_output())
        proof, baseline = PROBE.observation_result(self.output(), positive)
        self.assertEqual((proof['unique_sql_checks'], proof['unique_positive_assertions'],
                          proof['unique_refusals']), (11, 7, 4))
        self.assertEqual(baseline['corrections'], 1001)
        self.assertEqual(boundary, self.positive['retained_boundary'])
        self.assertNotIn('12345678-1234-4234-8234-123456789abc', json.dumps(proof))
        self.assertNotIn('retained_boundary', json.dumps(proof))

    def test_direct_full_positive_input_cannot_publish_private_boundary(self):
        proof, _ = PROBE.observation_result(self.output(), self.positive)
        self.assertNotIn('retained_boundary', json.dumps(proof))
        self.assertNotIn('12345678-1234-4234-8234-123456789abc', json.dumps(proof))

    def test_private_replay_baseline_is_required_once_in_the_expected_order(self):
        valid = self.positive_output()
        for output in (json.dumps(self.positive), json.dumps(self.replay),
                       json.dumps(self.replay) + '\n' + valid,
                       json.dumps(self.positive) + '\n' + json.dumps(self.replay),
                       '{}\n' + valid):
            with self.subTest(output=output[:80]), self.assertRaises(AssertionError):
                PROBE.parse_positive(output)

    def test_replay_baseline_requires_exact_fields_and_strict_audit_flags(self):
        for key, value in (('expected_admission_only', False), ('expected_admission_only', 1),
                           ('prior_admission_rows_preserved', False),
                           ('new_admission_rows', True), ('new_admission_rows', 0),
                           ('new_admission_rows', 2), ('new_admission_rows', 1.0),
                           ('kind', 'unreviewed')):
            replay = copy.deepcopy(self.replay)
            replay[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(AssertionError):
                PROBE.parse_positive(self.positive_output(replay=replay))
        for field in ('before_replay', 'after_replay'):
            replay = copy.deepcopy(self.replay)
            del replay[field]
            with self.subTest(missing=field), self.assertRaises(AssertionError):
                PROBE.parse_positive(self.positive_output(replay=replay))
        replay = {**self.replay, 'unreviewed': True}
        with self.assertRaises(AssertionError):
            PROBE.parse_positive(self.positive_output(replay=replay))

    def test_replay_uses_complete_distinct_before_and_after_snapshots(self):
        positive, boundary, replay = PROBE.parse_positive(self.positive_output())
        audit = PROBE.verify_replay_baselines(replay, replay['before_replay'], replay['after_replay'])
        self.assertNotIn('before_replay', audit)
        self.assertNotIn('after_replay', audit)
        self.assertNotIn('c' * 64, json.dumps(audit))
        proof, _ = PROBE.observation_result(self.output(), positive)
        self.assertNotIn('replay-baseline-v1', json.dumps(proof))
        self.assertNotIn('c' * 64, json.dumps(proof))
        with self.assertRaises(AssertionError):
            PROBE.verify_replay_baselines(replay, replay['after_replay'], replay['after_replay'])
        with self.assertRaises(AssertionError):
            PROBE.verify_replay_baselines(replay, replay['before_replay'], replay['before_replay'])

    def test_missing_relation_in_both_private_maps_cannot_hide_checkpoint_scope(self):
        replay = copy.deepcopy(self.replay)
        del replay['before_replay']['public.billing_invoice_items']
        del replay['after_replay']['public.billing_invoice_items']
        with self.assertRaises(AssertionError):
            PROBE.verify_replay_baselines(replay, self.replay['before_replay'], replay['after_replay'])

    def test_finalization_cannot_omit_or_forge_replay_admission_proof(self):
        cleanup = {'marked_database_removed': True, 'source_runtime_unchanged_after_cleanup': True}
        for key, value in (('new_admission_rows', True), ('new_admission_rows', 0),
                           ('prior_admission_rows_preserved', False),
                           ('checkpoint_before_replay_matches', False),
                           ('after_configuration_rollback_matches', 1)):
            proof = self.finalizable_proof()
            proof['canonical_replay_audit'][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(AssertionError):
                PROBE.finalize_acceptance(proof, True, cleanup)
        proof = self.finalizable_proof()
        del proof['canonical_replay_audit']
        with self.assertRaises(AssertionError):
            PROBE.finalize_acceptance(proof, True, cleanup)

    def test_replay_cannot_hide_other_relation_changes_or_an_audit_overwrite(self):
        audit = 'public.stock_writer_admissions'
        for kind in ('missing_audit', 'missing_other', 'extra_relation', 'audit_overwrite',
                     'two_admissions', 'same_audit_hash', 'source_events', 'source_operations', 'billing'):
            replay = copy.deepcopy(self.replay)
            after = replay['after_replay']
            if kind == 'missing_audit':
                del after[audit]
            elif kind == 'missing_other':
                del after['public.billing_invoice_items']
            elif kind == 'extra_relation':
                after['public.unreviewed'] = {'count': 0, 'hash': 'a' * 64}
            elif kind == 'audit_overwrite':
                after[audit]['count'] = 33
            elif kind == 'two_admissions':
                after[audit]['count'] = 35
            elif kind == 'same_audit_hash':
                after[audit]['hash'] = replay['before_replay'][audit]['hash']
            else:
                table = {'source_events': 'public.native_dispense_correction_events',
                         'source_operations': 'public.native_dispense_correction_operations',
                         'billing': 'public.billing_invoice_items'}[kind]
                after[table]['hash'] = '0' * 64
            with self.subTest(kind=kind), self.assertRaises(AssertionError):
                PROBE.verify_replay_baselines(replay, replay['before_replay'], after)

    def test_positive_cannot_omit_or_forge_the_actual_thousandth_head(self):
        for head in (None, {'version': 999}, {'event_id': 'not-a-uuid', 'version': 1000, 'record_hash': 'a' * 64},
                     {'event_id': '12345678-1234-4234-8234-123456789abc', 'version': True, 'record_hash': 'a' * 64}):
            positive = copy.deepcopy(self.positive)
            positive['retained_boundary'] = [{'correction_head': head}]
            with self.subTest(head=head), self.assertRaises((AssertionError, ValueError)):
                PROBE.parse_positive(self.positive_output(positive=positive))

    def test_exact_refusal_error_and_post_mutation_validation_are_required(self):
        for key, value in (('error', 'some unrelated refusal'), ('sqlstate', '42501'),
                           ('armed_before_observation', False), ('four_schema_and_manifest_rollback', False),
                           ('armed_before_observation', 1), ('four_schema_and_manifest_rollback', 1)):
            positive = copy.deepcopy(self.positive)
            positive['outcomes'][-1][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(AssertionError):
                PROBE.parse_positive(self.positive_output(positive=positive))

    def test_missing_duplicate_or_extra_case_cannot_satisfy_counts(self):
        for mode in ('missing', 'duplicate', 'extra'):
            positive = copy.deepcopy(self.positive)
            if mode == 'missing':
                positive['outcomes'].pop()
            elif mode == 'duplicate':
                positive['outcomes'][-1] = copy.deepcopy(positive['outcomes'][-2])
            else:
                positive['outcomes'].append({'label': 'unreviewed', 'outcome': 'accepted_assertion'})
            with self.subTest(mode=mode), self.assertRaises(AssertionError):
                PROBE.parse_positive(self.positive_output(positive=positive))

    def test_final_requires_one_ordered_baseline_and_one_final_observation(self):
        for output in (json.dumps(self.final), self.output() + '\n{}',
                       json.dumps(self.final) + '\n' + json.dumps(self.baseline),
                       self.output() + '\n' + json.dumps(self.final)):
            with self.subTest(output=output[:45]), self.assertRaises(AssertionError):
                PROBE.observation_result(output, self.summary())

    def test_thousand_event_checkpoint_cannot_hide_missing_real_1001st_event(self):
        for count in (1000, '1001', True):
            baseline = copy.deepcopy(self.baseline)
            baseline['corrections'] = count
            with self.subTest(count=count), self.assertRaises(AssertionError):
                PROBE.observation_result(self.output(baseline=baseline), self.summary())

    def test_final_cannot_claim_activation_or_external_writes(self):
        for key, value in (('clinical_or_register_activation', True), ('hosted_writes', 1),
                           ('synthetic_only', False), ('configuration_transactions_rolled_back', False)):
            final = copy.deepcopy(self.final)
            final[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(AssertionError):
                PROBE.observation_result(self.output(final=final), self.summary())

    def test_later_positive_summary_tampering_is_not_accepted_as_prior_success(self):
        for key, value in (('corrections', 999), ('full_opening_validated', False),
                           ('genuine_dispenses', 2), ('kind', 'unreviewed')):
            positive = self.summary()
            positive[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(AssertionError):
                PROBE.observation_result(self.output(), positive)


class CorrectionFixtureAssemblyTests(unittest.TestCase):
    def test_invalid_overlimit_openings_exist_only_inside_refusal_subtransactions(self):
        overlimit = PROBE.sections(CANDIDATE)['overlimit']
        mutations = re.findall(r'\$q\$(.*?)\$q\$', overlimit, flags=re.DOTALL)
        self.assertEqual(len(mutations), 4)
        self.assertIn('correction_capacity_build_opening(1000,', mutations[0])
        self.assertIn('correction_capacity_build_opening(0,', mutations[2])
        for index in (1, 3):
            self.assertIn('controlled_stock_validate_opening(', mutations[index])
        outside = re.sub(r'\$q\$.*?\$q\$', '', overlimit, flags=re.DOTALL)
        self.assertNotIn('correction_capacity_build_opening(', outside)
        self.assertNotIn('disable trigger', overlimit.lower())
        self.assertNotIn('alter table', overlimit.lower())
        self.assertEqual(overlimit.count('select pg_temp.correction_capacity_refuse('), 2)
        self.assertEqual(overlimit.count('Native history exceeds opening candidate limit; no truncation permitted'), 2)

    def test_bootstrap_receipts_are_suppressed_before_seed_output_is_restored(self):
        bootstrap = PROBE.fixture_parts(ROOT, CANDIDATE)['bootstrap']
        self.assertEqual(bootstrap.count('\\o /dev/null\n'), 1)
        self.assertEqual(bootstrap.count('\n\\o\n'), 1)
        suppressed, visible = bootstrap.split('\n\\o\n')
        for call in ('select configure_native_prescriber(', 'select save_native_prescription_draft(',
                     'select create_native_refill(', 'select transition_native_refill('):
            self.assertEqual(suppressed.count(call), 1)
            self.assertNotIn(call, visible)
        self.assertNotIn('create temp table correction_capacity_meta', suppressed)
        self.assertIn('create temp table correction_capacity_meta', visible)
        self.assertNotIn('controlled-opening-correction-capacity-seed-v1', suppressed)
        self.assertIn("select jsonb_build_object('kind','controlled-opening-correction-capacity-seed-v1')", visible)
        seed = {'kind': 'controlled-opening-correction-capacity-seed-v1',
                'ids_json': {'dispense': '12345678-1234-4234-8234-123456789abc'},
                'source_baseline': {'native_dispenses': []}}
        self.assertEqual(PROBE.parse_seed(json.dumps(seed)), seed)
        with self.assertRaisesRegex(AssertionError, 'Exactly one'):
            PROBE.parse_seed(json.dumps({'operation': 'canonical-setup-receipt'}) + '\n' + json.dumps(seed))

    def test_setup_output_redirection_is_scoped_and_observation_parser_stays_strict(self):
        parts = PROBE.fixture_parts(ROOT, CANDIDATE)
        for phase in ('positive', 'overlimit'):
            sql = parts[phase]
            self.assertEqual(sql.count('\\o /dev/null\n'), 1)
            self.assertEqual(sql.count('\n\\o\n'), 1)
            self.assertNotIn('-- CORRECTION_CAPACITY_PRIVATE_CONFIGURATION --', sql)
            redirected, observed = sql.split('\n\\o\n')
            for call in ('select set_config(', 'select prepare_controlled_draft_review(',
                         'select execute_controlled_draft_review('):
                self.assertEqual(redirected.count(call), 1)
                self.assertNotIn(call, observed)
            self.assertIn("select jsonb_build_object('kind'", observed)
        self.assertNotIn('-- CORRECTION_CAPACITY_SEED --', parts['bootstrap'])
        with self.assertRaises(AssertionError):
            PROBE.parse_checkpoint('{}\n{}', 64)


class CorrectionCleanupTests(unittest.TestCase):
    def test_cleanup_failure_cannot_be_reported_as_success(self):
        runtime = Mock()
        original = {'public.native_dispenses': {'count': 0, 'hash': 'a' * 64}}
        runtime.snapshot.return_value = original
        with patch.object(PROBE, 'drop_database', side_effect=RuntimeError('database still running')):
            with self.assertRaisesRegex(RuntimeError, 'database still running'):
                PROBE.cleanup(runtime, original, True, False)

    def test_prior_sql_failure_does_not_hide_failed_cleanup_receipt(self):
        runtime = Mock()
        original = {'public.native_dispenses': {'count': 0, 'hash': 'a' * 64}}
        runtime.snapshot.return_value = original
        with patch.object(PROBE, 'drop_database', side_effect=RuntimeError('database recovering')):
            status = PROBE.cleanup(runtime, original, True, True)
        self.assertIs(status['marked_database_removed'], False)
        self.assertIs(status['source_runtime_unchanged_after_cleanup'], True)
        runtime.capture_failure.assert_called()

    def test_unknown_or_changed_source_is_not_a_preservation_success(self):
        runtime = Mock()
        status = PROBE.cleanup(runtime, None, False, True)
        self.assertIs(status['source_runtime_unchanged_after_cleanup'], False)
        runtime.snapshot.return_value = {'changed': True}
        status = PROBE.cleanup(runtime, {'original': True}, False, True)
        self.assertIs(status['source_runtime_unchanged_after_cleanup'], False)


class CorrectionStageBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.runtime = Mock()
        self.runtime.application = 'lrv-correction-capacity-synthetic'
        self.runtime.workload_deadline = None
        self.runtime.operation_deadline = None
        self.runtime.safety_cleanup_mode = False
        self.runtime.database = 'owned_controlled_corrections_0123456789'

    def test_exhausted_shared_budget_never_starts_another_backend(self):
        with patch.object(PROBE.time, 'monotonic', return_value=100):
            with self.assertRaisesRegex(AssertionError, 'budget exhausted'):
                PROBE.run_stage(self.runtime, 'select 1;', 100, 'checkpoint256')
        self.runtime.sql.assert_not_called()

    def test_new_backend_receives_only_remaining_shared_budget(self):
        self.runtime.sql.return_value = 'result'
        with patch.object(PROBE.time, 'monotonic', return_value=100):
            result = PROBE.run_stage(self.runtime, 'select 1;', 120, 'checkpoint256')
        self.assertEqual(result, 'result')
        self.assertEqual(self.runtime.sql.call_args.kwargs['timeout'], 20)
        self.assertEqual(self.runtime.sql.call_args.args[1], self.runtime.database)

    def test_global_deadline_cannot_be_extended_by_a_stage_deadline(self):
        self.runtime.workload_deadline = 110
        with patch.object(PROBE.time, 'monotonic', return_value=100):
            PROBE.run_stage(self.runtime, 'select 1;', 200, 'positive')
        self.assertEqual(self.runtime.sql.call_args.kwargs['timeout'], 10)
        self.assertIsNone(self.runtime.operation_deadline)

    def test_cleanup_mode_cannot_be_used_to_resume_unbounded_work(self):
        self.runtime.safety_cleanup_mode = True
        with self.assertRaisesRegex(AssertionError, 'cleanup'):
            PROBE.run_stage(self.runtime, 'select 1;', 900, 'positive')
        self.runtime.sql.assert_not_called()

    def test_unusable_stage_deadlines_never_start_sql(self):
        for deadline in (True, math.nan, math.inf):
            with self.subTest(deadline=deadline), self.assertRaises(AssertionError):
                PROBE.run_stage(self.runtime, 'select 1;', deadline, 'positive')
        self.runtime.sql.assert_not_called()

    def owned_runtime(self):
        runtime = PROBE.Runtime.__new__(PROBE.Runtime)
        runtime.database = self.runtime.database
        runtime.marker = '12345678-1234-4234-8234-123456789abc'
        runtime.container = 'supabase_db_lrv-controlled-engine-0123456789'
        runtime.application = self.runtime.application
        runtime.workload_deadline = 900
        runtime.operation_deadline = None
        runtime.safety_cleanup_mode = False
        return runtime

    def test_writer_timeout_is_recomputed_after_ownership_checks_consume_time(self):
        runtime = self.owned_runtime()
        clock = [0.0]
        calls = []
        def ownership_check():
            clock[0] += 10
        def command(argv, query=None, timeout=180):
            calls.append((query, timeout))
            return runtime.marker if query and 'shobj_description' in query else 'result'
        runtime.verify = ownership_check
        with patch.object(PROBE.time, 'monotonic', side_effect=lambda: clock[0]), \
             patch.object(PROBE.capacity.Runtime, 'command', side_effect=command):
            result = PROBE.run_stage(runtime, 'select 1;', 780, 'append-32')
        self.assertEqual(result, 'result')
        self.assertEqual(calls[-1][1], 750)
        self.assertEqual(runtime.operation_deadline, None)

    def test_ownership_time_can_exhaust_budget_before_fixture_sql_starts(self):
        runtime = self.owned_runtime()
        clock = [0.0]
        runtime.verify = lambda: clock.__setitem__(0, clock[0] + 400)
        with patch.object(PROBE.time, 'monotonic', side_effect=lambda: clock[0]), \
             patch.object(PROBE.capacity.Runtime, 'command') as command:
            with self.assertRaisesRegex(AssertionError, 'deadline'):
                PROBE.run_stage(runtime, 'select 1;', 780, 'append-32')
        command.assert_not_called()
        self.assertIsNone(runtime.operation_deadline)

    def test_successful_sql_returned_at_deadline_is_rejected(self):
        runtime = self.owned_runtime()
        clock = [0.0]
        runtime.verify = lambda: None
        def command(argv, query=None, timeout=180):
            if query and 'shobj_description' in query:
                return runtime.marker
            clock[0] = 780
            return 'apparently successful but late'
        with patch.object(PROBE.time, 'monotonic', side_effect=lambda: clock[0]), \
             patch.object(PROBE.capacity.Runtime, 'command', side_effect=command):
            with self.assertRaisesRegex(AssertionError, 'deadline'):
                PROBE.run_stage(runtime, 'select 1;', 780, 'append-32')
        self.assertIsNone(runtime.operation_deadline)

    def test_untrusted_stage_label_is_rejected_before_execution(self):
        with self.assertRaises(AssertionError):
            PROBE.run_stage(self.runtime, 'select 1;', 120, '../unowned')
        self.runtime.sql.assert_not_called()


if __name__ == '__main__':
    unittest.main()
