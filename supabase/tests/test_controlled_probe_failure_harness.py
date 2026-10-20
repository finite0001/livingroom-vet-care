"""Public failure diagnostics cannot disclose protected subprocess output."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('probe_failure', ROOT / 'tests/controlled-drugs/engine/candidate/probe_failure.py')
REPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REPORTER)


class ControlledProbeFailureTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name)
        self.path = self.folder / 'engine-correction-capacity-v1-checkpoints.json'
        self.receipt = {'kind': 'controlled-opening-correction-capacity-feasibility-v1',
                        'passed': False, 'global_probe_budget_seconds': 900,
                        'samples': [{'previous_target': 0, 'target': 32, 'elapsed_seconds': 1.5}],
                        'admissions': [{'current_target': 32, 'next_target': 64,
                                        'remaining_seconds': 800.5, 'estimated_next_batch_seconds': 2.5,
                                        'required_seconds_with_reserve': 122.5, 'admitted': False}],
                        'marked_database_removed': True, 'source_runtime_unchanged_after_cleanup': True}

    def summarize(self, stderr='', stdout='', probe='probe-correction-capacity.py', returncode=1):
        return REPORTER.summarize_probe_failure(probe, returncode, stdout, stderr, self.folder)

    def write(self, receipt=None):
        self.path.write_text(json.dumps(self.receipt if receipt is None else receipt))

    def test_exact_terminal_guard_has_fixed_code(self):
        for message, code in REPORTER.ASSERTIONS.items():
            with self.subTest(message=message):
                self.assertEqual(self.summarize('private traceback\nAssertionError: ' + message)['failure_code'], code)

    def test_near_match_or_prior_guard_does_not_infer_cause(self):
        message = 'AssertionError: Next correction batch exceeds reserved workload budget'
        for text in [message + ' secret', ' ' + message, message + '\nRuntimeError: private', 'SQL: ' + message]:
            with self.subTest(text=text):
                self.assertEqual(self.summarize(text)['failure_code'], 'unknown')

    def test_raw_logs_claims_paths_ids_and_json_are_never_published(self):
        secrets = ['select * from auth.sessions;', '/private/user/evidence',
                   '12345678-1234-4234-8234-123456789abc', 'Bearer private-token',
                   '{"request.jwt.claims":{"sub":"sensitive"}}', '__proto__']
        for secret in secrets:
            with self.subTest(secret=secret):
                output = json.dumps(self.summarize(secret, secret))
                self.assertNotIn(secret, output)
                self.assertEqual(self.summarize(secret, secret)['failure_code'], 'unknown')

    def test_unknown_probe_does_not_echo_name_or_read_private_receipt(self):
        self.write()
        result = self.summarize(probe='/private/probe.py')
        self.assertEqual(result['probe'], 'unknown')
        self.assertIsNone(result['checkpoint_summary'])
        self.assertNotIn('/private', json.dumps(result))

    def test_other_known_probes_do_not_inherit_correction_cause_or_receipt(self):
        self.write()
        result = self.summarize('AssertionError: Next correction batch exceeds reserved workload budget', probe='probe-api.py')
        self.assertEqual(result['failure_code'], 'unknown')
        self.assertIsNone(result['checkpoint_summary'])

    def test_output_is_fixed_schema_and_always_nonacceptance(self):
        self.assertEqual(set(self.summarize()), {'kind', 'probe', 'passed', 'failure_code', 'child_returncode', 'checkpoint_summary'})
        self.assertIs(self.summarize(returncode=0)['passed'], False)
        for invalid in [True, '1', 256, -256, None]:
            self.assertIsNone(self.summarize(returncode=invalid)['child_returncode'])

    def test_bounded_progress_and_cleanup_are_copied_without_private_fields(self):
        self.receipt['private_sql'] = 'SECRET SQL'
        self.receipt['admissions'][0]['private_id'] = 'SECRET ID'
        self.write()
        result = self.summarize()['checkpoint_summary']
        self.assertEqual(result['completed_writer_target'], 32)
        self.assertEqual(result['attempted_target'], 64)
        self.assertIs(result['last_admission_allowed'], False)
        self.assertIs(result['marked_database_removed'], True)
        self.assertNotIn('SECRET', json.dumps(result))

    def test_missing_corrupt_or_wrong_kind_receipt_is_unavailable(self):
        self.assertIsNone(self.summarize()['checkpoint_summary'])
        for text in ['not json', '[]', '{}', '{"kind":"unknown"}', 'null']:
            self.path.write_text(text)
            self.assertIsNone(self.summarize()['checkpoint_summary'])

    def test_bool_nonfinite_negative_and_overlimit_numbers_are_unavailable(self):
        paths = [('samples', 0, 'target'), ('samples', 0, 'elapsed_seconds'),
                 ('admissions', 0, 'remaining_seconds'), ('admissions', 0, 'estimated_next_batch_seconds'),
                 ('admissions', 0, 'required_seconds_with_reserve')]
        for group, index, key in paths:
            for invalid in [True, float('nan'), float('inf'), -1, 2_000_000, '12']:
                with self.subTest(group=group, key=key, invalid=invalid):
                    receipt = copy.deepcopy(self.receipt)
                    receipt[group][index][key] = invalid
                    self.write(receipt)
                    self.assertIsNone(self.summarize()['checkpoint_summary'])

    def test_boolean_flags_require_actual_boolean(self):
        for key in ['passed', 'marked_database_removed', 'source_runtime_unchanged_after_cleanup']:
            receipt = copy.deepcopy(self.receipt); receipt[key] = 1; self.write(receipt)
            self.assertIsNone(self.summarize()['checkpoint_summary'])
        self.receipt['admissions'][0]['admitted'] = 0; self.write()
        self.assertIsNone(self.summarize()['checkpoint_summary'])

    def test_noncontiguous_or_oversized_batches_are_unavailable(self):
        for sample in [{'previous_target': 1, 'target': 32, 'elapsed_seconds': 1},
                       {'previous_target': 0, 'target': 33, 'elapsed_seconds': 1}]:
            self.receipt['samples'] = [sample]; self.write()
            self.assertIsNone(self.summarize()['checkpoint_summary'])

    def test_contradictory_admission_does_not_describe_completed_work(self):
        for previous, target, admitted in [(0, 32, False), (16, 48, True), (64, 96, True)]:
            receipt = copy.deepcopy(self.receipt)
            receipt['admissions'][0].update(current_target=previous, next_target=target, admitted=admitted)
            self.write(receipt)
            self.assertIsNone(self.summarize()['checkpoint_summary'])

    def test_duplicate_json_keys_are_not_silently_overwritten(self):
        self.path.write_text(json.dumps(self.receipt)[:-1] + ',"passed":false}')
        self.assertIsNone(self.summarize()['checkpoint_summary'])

    def test_symlink_and_oversized_receipts_are_not_read(self):
        other = self.folder / 'private.json'; other.write_text(json.dumps(self.receipt))
        self.path.symlink_to(other)
        self.assertIsNone(self.summarize()['checkpoint_summary'])
        self.path.unlink(); self.path.write_text(' ' * 2_000_001)
        self.assertIsNone(self.summarize()['checkpoint_summary'])

    def test_read_failure_does_not_replace_original_failure(self):
        self.path.mkdir()
        result = self.summarize('AssertionError: Correction1001 exceeds reserved workload budget')
        self.assertEqual(result['failure_code'], 'event1001_admission_refused')
        self.assertIsNone(result['checkpoint_summary'])


if __name__ == '__main__':
    unittest.main()
