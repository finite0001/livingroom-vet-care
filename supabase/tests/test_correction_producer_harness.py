"""Fail-closed evidence for batched synthetic correction production."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('correction_producer', ROOT / 'tests/controlled-drugs/engine/candidate/correction_producer.py')
PRODUCER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PRODUCER)


def batch(previous, target):
    return {'kind': PRODUCER.BATCH_KIND, 'previous_target': previous, 'target': target,
            'canonical_writes': target - previous, 'actual_receipts_bound': target - previous,
            'real_previews': 2, **{key: True for key in PRODUCER.BATCH_FLAGS}}


class CorrectionProducerTests(unittest.TestCase):
    def setUp(self):
        targets = list(range(32, 993, 32)) + [1000, 1001]
        self.batches = [batch(previous, target) for previous, target in zip([0] + targets[:-1], targets)]
        self.contract = copy.deepcopy(PRODUCER.CONTRACT)
        self.proof = PRODUCER.build_producer_proof(self.batches, self.contract, True)

    def test_exact_batch_and_optional_checkpoint_are_separated(self):
        record = batch(32, 64)
        checkpoint = {'kind': PRODUCER.CHECKPOINT_KIND, 'corrections': 64}
        actual, residual = PRODUCER.parse_batch_output(json.dumps(record) + '\n' + json.dumps(checkpoint), 32, 64, True)
        self.assertEqual(actual, record)
        self.assertEqual(json.loads(residual), checkpoint)
        self.assertEqual(PRODUCER.parse_batch_output(json.dumps(record), 32, 64), (record, ''))

    def test_final_partial_and_single_overflow_write_are_valid(self):
        for previous, target in [(992, 1000), (1000, 1001)]:
            self.assertEqual(PRODUCER.parse_batch_output(json.dumps(batch(previous, target)), previous, target)[0]['canonical_writes'], target - previous)

    def test_missing_extra_or_reordered_observations_are_refused(self):
        b = json.dumps(batch(0, 32)); c = json.dumps({'kind': PRODUCER.CHECKPOINT_KIND})
        for output, expected in [('', False), (b + '\n' + b, False), (b + '\n' + c, False),
                                 (b, True), (c + '\n' + b, True), (b + '\n' + c + '\n{}', True)]:
            with self.subTest(output=output), self.assertRaises(AssertionError):
                PRODUCER.parse_batch_output(output, 0, 32, expected)

    def test_nonobject_json_or_unknown_text_is_refused(self):
        b = json.dumps(batch(0, 32))
        for extra in ['[]', 'null', '1', 'true', 'NaN', 'private SQL', 'NOTICE: arbitrary']:
            with self.subTest(extra=extra), self.assertRaises(AssertionError):
                PRODUCER.parse_batch_output(b + '\n' + extra, 0, 32)

    def test_only_known_psql_tags_and_blank_lines_are_ignored(self):
        output = 'BEGIN\n\nSET\n' + json.dumps(batch(0, 32)) + '\nCOMMIT\n'
        self.assertEqual(PRODUCER.parse_batch_output(output, 0, 32)[0], batch(0, 32))

    def test_batch_exact_keys_and_kind_required(self):
        for change in ['extra', 'missing', 'kind']:
            record = batch(0, 32)
            if change == 'extra': record['private_id'] = 'secret'
            elif change == 'missing': del record['only_head_advanced']
            else: record['kind'] = 'unreviewed'
            with self.subTest(change=change), self.assertRaises(AssertionError):
                PRODUCER.parse_batch_output(json.dumps(record), 0, 32)

    def test_counts_reject_boolean_float_string_nonfinite_and_wrong_values(self):
        for key in ['previous_target', 'target', 'canonical_writes', 'real_previews', 'actual_receipts_bound']:
            for invalid in [True, False, 32.0, '32', float('nan'), float('inf'), -1, 1002]:
                record = batch(0, 32); record[key] = invalid
                with self.subTest(key=key, invalid=invalid), self.assertRaises(AssertionError):
                    PRODUCER.parse_batch_output(json.dumps(record), 0, 32)

    def test_every_batch_guarantee_requires_true(self):
        for key in PRODUCER.BATCH_FLAGS:
            for invalid in [False, 1, 'true', None]:
                record = batch(0, 32); record[key] = invalid
                with self.subTest(key=key, invalid=invalid), self.assertRaises(AssertionError):
                    PRODUCER.parse_batch_output(json.dumps(record), 0, 32)

    def test_invalid_target_range_or_checkpoint_flag_is_refused(self):
        for previous, target in [(0, 33), (32, 32), (32, 31), (-1, 1), (1001, 1002), (False, 32), (0, 32.0)]:
            with self.subTest(previous=previous, target=target), self.assertRaises(AssertionError):
                PRODUCER.parse_batch_output(json.dumps(batch(0, 32)), previous, target)
        with self.assertRaises(AssertionError):
            PRODUCER.parse_batch_output(json.dumps(batch(0, 32)), 0, 32, 1)

    def test_duplicate_json_keys_are_rejected(self):
        output = json.dumps(batch(0, 32))[:-1] + ',"passed":true}'
        with self.assertRaises(AssertionError): PRODUCER.parse_batch_output(output, 0, 32)

    def test_contract_has_exact_rollback_and_negative_case_counts(self):
        self.assertEqual(PRODUCER.parse_contract_output(json.dumps(self.contract)), self.contract)
        for key in self.contract:
            record = copy.deepcopy(self.contract)
            record[key] = 1 if type(record[key]) is bool else 'wrong'
            with self.subTest(key=key), self.assertRaises(AssertionError):
                PRODUCER.parse_contract_output(json.dumps(record))

    def test_contract_missing_extra_and_multiple_records_are_rejected(self):
        records = [dict(self.contract, private_context={}), {k:v for k,v in self.contract.items() if k != 'original_counts_zero'}]
        for record in records:
            with self.assertRaises(AssertionError): PRODUCER.parse_contract_output(json.dumps(record))
        with self.assertRaises(AssertionError): PRODUCER.parse_contract_output(json.dumps(self.contract) + '\n{}')

    def test_complete_proof_has_actual1001_writes_and66_previews(self):
        proof = PRODUCER.validate_producer_proof(self.proof)
        self.assertEqual(len(proof['batches']), 33)
        self.assertEqual(proof['canonical_writes'], 1001)
        self.assertEqual(proof['real_previews'], 66)
        self.assertIs(proof['per_annotation_external_preview'], False)

    def test_missing1001_or_contract_rollback_cannot_pass(self):
        with self.assertRaises(AssertionError): PRODUCER.build_producer_proof(self.batches[:-1], self.contract, True)
        for flag in [False, 1, None]:
            with self.assertRaises(AssertionError): PRODUCER.build_producer_proof(self.batches, self.contract, flag)

    def test_batch_gap_replay_or_reordering_cannot_be_accepted(self):
        for index, replacement in [(1, batch(0, 32)), (1, batch(64, 96)), (32, batch(999, 1001))]:
            proof = copy.deepcopy(self.proof); proof['batches'][index] = replacement
            with self.subTest(index=index), self.assertRaises(AssertionError): PRODUCER.validate_producer_proof(proof)

    def test_proof_fields_and_typed_totals_are_strict(self):
        for key in self.proof:
            if key in ('batches', 'contract'): continue
            proof = copy.deepcopy(self.proof)
            proof[key] = 1 if type(proof[key]) is bool else 'unreviewed'
            with self.subTest(key=key), self.assertRaises(AssertionError): PRODUCER.validate_producer_proof(proof)
        proof = dict(self.proof, private_id='secret')
        with self.assertRaises(AssertionError): PRODUCER.validate_producer_proof(proof)

    def test_proof_revalidates_contract_and_each_batch(self):
        proof = copy.deepcopy(self.proof); proof['contract']['receipt_mutation_refusals'] = 7
        with self.assertRaises(AssertionError): PRODUCER.validate_producer_proof(proof)
        proof = copy.deepcopy(self.proof); proof['batches'][7]['actual_receipts_bound'] = 31
        with self.assertRaises(AssertionError): PRODUCER.validate_producer_proof(proof)


if __name__ == '__main__': unittest.main()
