"""Strict evidence for the synthetic operational-annotation batch producer."""
import json

BATCH_KIND = 'controlled-correction-producer-batch-v1'
CONTRACT_KIND = 'controlled-correction-producer-contract-v1'
PROOF_KIND = 'controlled-correction-producer-proof-v1'
CHECKPOINT_KIND = 'controlled-opening-correction-capacity-checkpoint-v1'
BATCH_FLAGS = ('only_operational_annotations', 'only_head_advanced', 'fresh_preview_context_matches', 'passed')
CONTRACT = {'kind': CONTRACT_KIND, 'passed': True, 'successful_rolled_back_writes': 3,
            'receipt_mutation_refusals': 8, 'canonical_context_refusals': 2,
            'batch_real_previews': 2, 'original_counts_zero': True,
            'mutation_refusals_rolled_back_exactly': True}
TAGS = {'BEGIN', 'COMMIT', 'ROLLBACK', 'SET', 'RESET', 'DO', 'SET CONSTRAINTS'}


def _unique(pairs):
    value = {}
    for key, item in pairs:
        assert key not in value, 'Duplicate producer observation field'
        value[key] = item
    return value


def _records(output):
    assert isinstance(output, str)
    records = []
    for line in output.splitlines():
        if not line.strip() or line in TAGS:
            continue
        try:
            value = json.loads(line, object_pairs_hook=_unique)
        except ValueError as error:
            raise AssertionError('Unknown producer output') from error
        assert isinstance(value, dict), 'Producer output must contain only exact JSON objects'
        records.append(value)
    return records


def _validate_batch(record, previous, target):
    assert type(previous) is int and type(target) is int
    assert 0 <= previous < target <= 1001 and target - previous <= 32
    fields = {'kind', 'previous_target', 'target', 'canonical_writes', 'real_previews', 'actual_receipts_bound'} | set(BATCH_FLAGS)
    assert isinstance(record, dict) and set(record) == fields, 'Exact producer batch fields required'
    assert record['kind'] == BATCH_KIND
    for key, expected in [('previous_target', previous), ('target', target),
                          ('canonical_writes', target - previous), ('real_previews', 2),
                          ('actual_receipts_bound', target - previous)]:
        assert type(record[key]) is int and record[key] == expected, 'Producer batch count mismatch'
    assert all(record[key] is True for key in BATCH_FLAGS)
    return record


def parse_batch_output(output, previous, target, checkpoint_expected=False):
    """Consume one batch; leave only its explicitly expected checkpoint record."""
    assert type(checkpoint_expected) is bool
    records = _records(output)
    assert len(records) == (2 if checkpoint_expected else 1), 'Exact producer batch observation count required'
    record = _validate_batch(records[0], previous, target)
    residual = ''
    if checkpoint_expected:
        assert records[1].get('kind') == CHECKPOINT_KIND, 'Expected correction checkpoint after batch'
        residual = json.dumps(records[1]) + '\n'
    return record, residual


def _validate_contract(record):
    assert isinstance(record, dict) and set(record) == set(CONTRACT), 'Exact producer contract fields required'
    for key, expected in CONTRACT.items():
        assert type(record[key]) is type(expected) and record[key] == expected, 'Producer contract mismatch'
    return record


def parse_contract_output(output):
    records = _records(output)
    assert len(records) == 1, 'Exactly one producer contract observation required'
    return _validate_contract(records[0])


def validate_producer_proof(proof):
    expected = {'kind': PROOF_KIND, 'passed': True,
                'contract_all_relations_and_manifest_rolled_back_exactly': True,
                'canonical_writes': 1001, 'real_previews': 66, 'actual_receipts_bound': 1001,
                'per_annotation_external_preview': False,
                'canonical_writer_full_history_verification_unchanged': True,
                'only_operational_annotations': True}
    assert isinstance(proof, dict) and set(proof) == set(expected) | {'batches', 'contract'}
    for key, value in expected.items():
        assert type(proof[key]) is type(value) and proof[key] == value, 'Producer proof mismatch'
    _validate_contract(proof['contract'])
    batches = proof['batches']
    assert isinstance(batches, list) and len(batches) == 33
    previous = 0
    for record in batches:
        assert isinstance(record, dict)
        _validate_batch(record, previous, record.get('target'))
        previous = record['target']
    assert previous == 1001 and batches[-1]['previous_target'] == 1000
    assert sum(record['canonical_writes'] for record in batches) == 1001
    assert sum(record['real_previews'] for record in batches) == 66
    assert sum(record['actual_receipts_bound'] for record in batches) == 1001
    return proof


def build_producer_proof(batches, contract, contract_rolled_back_exactly):
    assert contract_rolled_back_exactly is True, 'Producer contract full rollback required'
    proof = {'kind': PROOF_KIND, 'passed': True, 'batches': batches, 'contract': contract,
             'contract_all_relations_and_manifest_rolled_back_exactly': True,
             'canonical_writes': 1001, 'real_previews': 66, 'actual_receipts_bound': 1001,
             'per_annotation_external_preview': False,
             'canonical_writer_full_history_verification_unchanged': True,
             'only_operational_annotations': True}
    return validate_producer_proof(proof)
