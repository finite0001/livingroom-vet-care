"""Bounded synthetic canonical correction-chain feasibility in an owned clone.

Run separately until its full acceptance proof has passed. It never changes a
supported limit, installs hosted code or activates a clinical register.
"""
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import time
import uuid


SOURCE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location('controlled_capacity_runtime', SOURCE / 'probe-capacity.py')
capacity = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(capacity)
SCHEMAS = capacity.SCHEMAS
literal = capacity.literal


def verify_database(runtime, target, marker):
    assert re.fullmatch(r'owned_controlled_corrections_[0-9a-f]{10}', target), 'Unsafe correction database target'
    assert re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', marker), 'Invalid correction ownership marker'
    runtime.verify()
    actual = runtime.raw_sql("select shobj_description(oid,'pg_database')from pg_database where datname=" + literal(target) + ';').strip()
    assert actual == marker, 'Correction database ownership marker mismatch'


def drop_database(runtime, target, marker):
    verify_database(runtime, target, marker)
    runtime.raw_sql('drop database "' + target + '" with(force);')
    assert runtime.raw_sql('select count(*)from pg_database where datname=' + literal(target) + ';').strip() == '0', 'Owned correction database remains'


class Runtime(capacity.Runtime):
    def __init__(self, folder):
        record = json.loads((folder / 'runtime.json').read_text())
        self.folder = folder
        self.identity = record['identity']
        assert re.fullmatch(r'lrv-controlled-engine-[0-9a-f]{10}', self.identity) and record['removed'] is False
        self.project = Path(record['project']).resolve()
        self.container = 'supabase_db_' + self.identity
        self.log = (folder / 'engine-correction-capacity-v1.log').open('x')
        self.database = 'owned_controlled_corrections_' + uuid.uuid4().hex[:10]
        self.marker = str(uuid.uuid4())
        self.application = 'lrv-correction-capacity-' + uuid.uuid4().hex
        self.workload_deadline = None
        self.operation_deadline = None
        self.safety_cleanup_mode = False

    def command(self, argv, query=None, timeout=180):
        """Bound every inherited ownership/SQL/dump command, including waits."""
        assert type(timeout) in (int, float) and math.isfinite(timeout) and timeout > 0
        safety = getattr(self, 'safety_cleanup_mode', False)
        if not safety:
            operation = getattr(self, 'operation_deadline', None)
            global_deadline = getattr(self, 'workload_deadline', None)
            assert type(global_deadline) in (int, float) and math.isfinite(global_deadline), 'Workload command deadline required'
            if operation is not None:
                assert type(operation) in (int, float) and math.isfinite(operation)
            deadline = min(global_deadline, operation) if operation is not None else global_deadline
            remaining = deadline - time.monotonic()
            assert remaining > 0, 'Correction workload command deadline exhausted'
            timeout = min(timeout, remaining)
        output = super().command(argv, query, timeout)
        if not safety:
            assert time.monotonic() < deadline, 'Correction workload command returned after deadline'
        return output

    def sql(self, query, target='postgres', timeout=180):
        assert target in ('postgres', self.database), 'Unexpected correction SQL target'
        if target != 'postgres':
            verify_database(self, target, self.marker)
        return self.raw_sql(query, target, timeout)


def continuation_estimate(previous_target, target, stage_elapsed, remaining_seconds, goal=1000, reserve_seconds=120):
    """Retained full-goal diagnostic estimate, never admission or a benchmark.

    Repeated prior verification is quadratic in event visits; concatenating its
    growing JSON arrays can add cubic byte-copy work. Use the larger forecast
    with a factor of two, plus a separate full-validation time reserve.
    This estimate can decline work, but cannot certify successful acceptance.
    """
    assert all(type(value) is int for value in (previous_target, target, goal))
    assert 0 <= previous_target < target <= goal == 1000
    assert (previous_target, target) in ((0, 64), (64, 128), (128, 256), (256, 512), (512, 1000)), 'Reviewed correction checkpoints required'
    assert all(type(value) in (int, float) and math.isfinite(value) and value > 0
               for value in (stage_elapsed, remaining_seconds, reserve_seconds))
    work = lambda n: n * (n - 1)
    quadratic = 2 * stage_elapsed * (work(goal) - work(target)) / (work(target) - work(previous_target))
    cubic = 2 * stage_elapsed * (goal ** 3 - target ** 3) / (target ** 3 - previous_target ** 3)
    writer = max(quadratic, cubic)
    required = writer + reserve_seconds
    return {'previous_target': previous_target, 'target': target, 'goal': goal,
            'stage_elapsed_seconds': round(stage_elapsed, 3),
            'remaining_seconds': round(remaining_seconds, 3),
            'estimated_remaining_writer_seconds': round(writer, 3),
            'quadratic_remaining_writer_seconds': round(quadratic, 3),
            'cubic_remaining_writer_seconds': round(cubic, 3),
            'validation_reserve_seconds': reserve_seconds,
            'estimated_required_seconds': round(required, 3),
            'projection_gate_applied': target >= 256,
            'cost_model': 'max_quadratic_and_cubic_latest_phase_factor_2',
            'continue': (required if target >= 256 else reserve_seconds) < remaining_seconds,
            'elapsed_is_production_benchmark': False}


def admit_next_batch(current_target, next_target, remaining_seconds, latest_sample=None,
                     positive_accepted=False, reserve_seconds=120, safety_factor=2):
    """Admit only the next measured batch; completion of the goal is unknown."""
    assert type(current_target) is int and type(next_target) is int
    assert 0 <= current_target < next_target <= 1001
    assert type(positive_accepted) is bool
    assert type(reserve_seconds) is int and reserve_seconds == 120
    assert type(safety_factor) is int and safety_factor == 2
    assert type(remaining_seconds) in (int, float) and math.isfinite(remaining_seconds) and remaining_seconds > 0
    if current_target == 1000:
        assert next_target == 1001 and positive_accepted is True, 'Actual positive required before correction1001'
    else:
        assert next_target == min(current_target + 32, 1000) and positive_accepted is False, 'Exact sequential correction batch required'
    if latest_sample is None:
        assert current_target == 0 and next_target == 32, 'Only the first batch may calibrate without a sample'
        estimated = None
        required = reserve_seconds
        calibration = True
    else:
        assert isinstance(latest_sample, dict) and set(latest_sample) == {'previous_target', 'target', 'elapsed_seconds'}
        previous = latest_sample['previous_target']
        sampled_target = latest_sample['target']
        elapsed = latest_sample['elapsed_seconds']
        assert type(previous) is int and type(sampled_target) is int
        assert 0 <= previous < sampled_target == current_target and sampled_target - previous <= 32
        assert type(elapsed) in (int, float) and math.isfinite(elapsed) and elapsed > 0
        estimated = safety_factor * elapsed * (next_target ** 3 - current_target ** 3) / (current_target ** 3 - previous ** 3)
        required = estimated + reserve_seconds
        assert math.isfinite(required)
        calibration = False
    return {'current_target': current_target, 'next_target': next_target, 'latest_sample': latest_sample,
            'remaining_seconds': remaining_seconds, 'estimated_next_batch_seconds': estimated,
            'required_seconds_with_reserve': required, 'reserve_seconds': reserve_seconds,
            'safety_factor': safety_factor, 'calibration_without_sample': calibration,
            'admitted': required < remaining_seconds, 'continuation_scope': 'next_batch_only',
            'goal_completion': 'unknown', 'elapsed_is_production_benchmark': False}


def _observations(output):
    assert isinstance(output, str), 'Correction SQL output must be text'
    observations = [json.loads(line) for line in output.splitlines() if line.startswith('{')]
    assert all(isinstance(value, dict) for value in observations), 'Correction observations must be objects'
    return observations


def _exact_observation(output, kind):
    observations = _observations(output)
    assert len(observations) == 1 and observations[0].get('kind') == kind, 'Exactly one expected correction observation required'
    return observations[0]


def _fingerprint(value):
    assert isinstance(value, dict) and value, 'Exact relation fingerprints required'
    for name, item in value.items():
        assert isinstance(name, str) and '.' in name and name.split('.', 1)[0] in SCHEMAS and name.split('.', 1)[1]
        assert isinstance(item, dict) and set(item) == {'count', 'hash'}
        assert type(item['count']) is int and item['count'] >= 0
        assert isinstance(item['hash'], str) and re.fullmatch(r'[0-9a-f]{64}', item['hash'])
    return value


def parse_seed(output):
    seed = _exact_observation(output, 'controlled-opening-correction-capacity-seed-v1')
    assert set(seed) == {'kind', 'ids_json', 'source_baseline'}, 'Exact private correction seed fields required'
    assert isinstance(seed.get('ids_json'), dict) and seed['ids_json']
    assert all(isinstance(key, str) and isinstance(value, str) and str(uuid.UUID(value)) == value
               for key, value in seed['ids_json'].items()), 'Canonical fixture UUIDs required'
    assert isinstance(seed.get('source_baseline'), dict) and seed['source_baseline'], 'Original source quantities and billing required'
    return seed


def parse_checkpoint(output, target):
    assert type(target) is int and 0 < target <= 1000
    value = _exact_observation(output, 'controlled-opening-correction-capacity-checkpoint-v1')
    assert set(value) == {'kind', 'corrections', 'genuine_canonical_writers', 'billing_unchanged',
                          'native_quantities_unchanged', 'receipts_and_chain_verified', 'fingerprint'}
    assert type(value.get('corrections')) is int and value['corrections'] == target
    for key in ('genuine_canonical_writers', 'billing_unchanged', 'native_quantities_unchanged', 'receipts_and_chain_verified'):
        assert value.get(key) is True, 'Canonical correction checkpoint failed: ' + key
    _fingerprint(value.get('fingerprint'))
    return value


def sections(source):
    contents = (source / 'opening-correction-capacity.sql').read_text()
    result = {}
    for name in ('PREAMBLE', 'BOOTSTRAP', 'POSITIVE', 'OVERLIMIT'):
        start = '-- CORRECTION_CAPACITY_' + name + '_BEGIN --'
        end = '-- CORRECTION_CAPACITY_' + name + '_END --'
        assert contents.count(start) == contents.count(end) == 1, 'Exact correction fixture section required: ' + name
        begin = contents.index(start) + len(start)
        assert begin < contents.index(end)
        result[name.lower()] = contents[begin:contents.index(end)]
    assert result['preamble'].count('-- CORRECTION_CAPACITY_SEED --') == 1
    return result


def fixture_parts(root, source):
    parts = sections(source)
    canonical = (root / 'supabase/tests/native_fulfillment.test.sql').read_text()
    target = "insert into data select 'target',"
    assert canonical.count(target) == 1
    prefix = canonical[:canonical.index(target)].replace('select no_plan();', '')
    # The independently reviewed canonical setup returns operation receipts as
    # well as claims. Keep its SQL intact and suppress only this setup output.
    # Restore output before our preamble/bootstrap emits the single private seed.
    claims = "select set_config('request.jwt.claims','{\"sub\":\"a5510000-0000-4000-8000-000000000001\",\"role\":\"authenticated\"}',true);"
    assert prefix.count(claims) == 1
    for setup_call, count in (('select configure_native_prescriber(', 1), ('select save_native_prescription_draft(', 1),
                              ('select receive_inventory(', 2), ('select create_billing_invoice(', 1),
                              ('select create_native_refill(', 1), ('select transition_native_refill(', 1)):
        assert prefix.count(setup_call) == count, 'Reviewed canonical bootstrap output changed'
    assert '\\o' not in prefix
    prefix = '\n\\o /dev/null\n' + prefix + '\n\\o\n'
    config = (source / 'native-config.sql').read_text()
    opening = 'insert into controlled_stock_openings('
    assert config.count(opening) == 1
    config = config[:config.index(opening)]
    transaction = "begin;set local timezone='UTC';"
    assert config.count(transaction) == 1
    config = config.replace(transaction, '', 1)
    for setup_call in ('select set_config(', 'select prepare_controlled_draft_review(', 'select execute_controlled_draft_review('):
        assert config.count(setup_call) == 1, 'Reviewed configuration setup output changed'
    assert '\\o' not in config
    # This runner always uses psql. Redirect only the independently reviewed
    # configuration setup results, keeping ON_ERROR_STOP and stderr unchanged.
    # No output parser exception is made for incidental claims or draft JSON.
    config = '\n\\o /dev/null\n' + config + '\n\\o\n'
    marker = '-- CORRECTION_CAPACITY_PRIVATE_CONFIGURATION --'
    assert parts['positive'].count(marker) == parts['overlimit'].count(marker) == 1
    for name in ('positive', 'overlimit'):
        parts[name] = parts[name].replace(marker, config)
    parts['bootstrap'] = prefix + '\n' + parts['preamble'].replace('-- CORRECTION_CAPACITY_SEED --', '') + parts['bootstrap']
    parts['configuration'] = config
    return parts


def restore_fixture_parts(source):
    text = (source / 'correction-history-restore.sql').read_text()
    result = {}
    for name in ('build', 'validate'):
        begin = '-- CORRECTION_RESTORE_' + name.upper() + '_BEGIN --'
        end = '-- CORRECTION_RESTORE_' + name.upper() + '_END --'
        assert text.count(begin) == text.count(end) == 1, 'Exact correction restore sections required'
        assert text.index(begin) < text.index(end)
        result[name] = text.split(begin, 1)[1].split(end, 1)[0]
    assert result['validate'].count('-- CORRECTION_RESTORE_TIMEZONE --') == 1
    return result


def seeded_preamble(preamble, seed):
    # JSON encoding is SQL-quoted as a value, never interpolated as executable SQL.
    encoded = literal(json.dumps(seed, sort_keys=True))
    ids = literal(json.dumps(seed['ids_json'], sort_keys=True))
    return ("begin;set local search_path=public,extensions;set local timezone='UTC';"
            'create temp table fx(k text primary key,id uuid);grant all on fx to authenticated;'
            'insert into fx select key,value::uuid from jsonb_each_text(' + ids + '::jsonb);' +
            preamble.replace('-- CORRECTION_CAPACITY_SEED --',
                             'insert into correction_capacity_meta(seed)values(' + encoded + '::jsonb);'))


POSITIVE_LABELS = {
    'genuine1000_receipts_hashes_contiguous_chain': None,
    'annotations_preserve_exact_source_quantities_and_billing': None,
    'exact1000th_replay_same_receipt_no_extra_event': None,
    'genuine1000_exact_retained_head_fullopening': None,
    'single_prepared_allocation_no_other_lifecycle_family': None,
    'unattached_frozen_noactivation': None,
    'forged_retained_correction_head': 'Stored opening custody must equal the canonical retained native prefix',
    'missing_retained_correction_head': 'Exact controlled-operation fields required',
}
FINAL_LABELS = {
    'genuine1001st_canonical_writer_and_unchanged_quantities': None,
    'genuine1001_actual_count_retained1000': 'Native history exceeds opening candidate limit; no truncation permitted',
    'genuine1001_actual_count_retained0': 'Native history exceeds opening candidate limit; no truncation permitted',
}


def _phase(value, expected):
    outcomes = value.get('outcomes')
    assert isinstance(outcomes, list) and len(outcomes) == len(expected)
    assert type(value.get('sql_checks')) is int and value['sql_checks'] == len(expected)
    refusals = sum(error is not None for error in expected.values())
    assert type(value.get('refusals')) is int and value['refusals'] == refusals
    assert all(isinstance(item, dict) for item in outcomes)
    assert {item.get('label') for item in outcomes} == set(expected), 'Exact correction observation labels required'
    results = {}
    for item in outcomes:
        label = item['label']
        error = expected[label]
        if error is None:
            assert item == {'label': label, 'outcome': 'accepted_assertion'}, 'Exact correction positive assertion required'
        else:
            assert item.get('armed_before_observation') is True and item.get('four_schema_and_manifest_rollback') is True
            assert item == {'label': label, 'outcome': 'refused', 'error': error, 'sqlstate': '23514',
                            'armed_before_observation': True, 'four_schema_and_manifest_rollback': True}, 'Exact armed correction refusal required'
        results[label] = {key: data for key, data in item.items() if key != 'label'}
    return results


def _positive_contract(value):
    assert value.get('kind') == 'controlled-opening-correction-capacity-positive-v1'
    fields = {'kind', 'corrections', 'genuine_dispenses', 'genuine_max_allocations', 'full_opening_validated',
              'unattached_frozen_only', 'genuine_canonical_writers', 'receipts_and_chain_verified',
              'billing_unchanged', 'native_quantities_unchanged', 'exact_replay_no_extra_event',
              'separate_scenario_not_simultaneous_maxima', 'sql_checks', 'refusals', 'outcomes'}
    assert set(value) in (fields, fields | {'retained_boundary'}), 'Exact correction positive fields required'
    for key, expected in (('corrections', 1000), ('genuine_dispenses', 1), ('genuine_max_allocations', 1)):
        assert type(value.get(key)) is int and value[key] == expected
    for key in ('full_opening_validated', 'unattached_frozen_only', 'genuine_canonical_writers',
                'receipts_and_chain_verified', 'billing_unchanged', 'native_quantities_unchanged',
                'exact_replay_no_extra_event', 'separate_scenario_not_simultaneous_maxima'):
        assert value.get(key) is True, 'Genuine correction opening positive required: ' + key
    _phase(value, POSITIVE_LABELS)


def _replay_baseline_contract(value):
    assert isinstance(value, dict), 'Private canonical replay baseline required'
    assert set(value) == {'kind', 'before_replay', 'after_replay', 'expected_admission_only',
                          'prior_admission_rows_preserved', 'new_admission_rows'}
    assert value['kind'] == 'controlled-opening-correction-capacity-replay-baseline-v1'
    assert value['expected_admission_only'] is True and value['prior_admission_rows_preserved'] is True
    assert type(value['new_admission_rows']) is int and value['new_admission_rows'] == 1
    before = _fingerprint(value['before_replay'])
    after = _fingerprint(value['after_replay'])
    assert set(before) == set(after), 'Complete replay relation scopes must remain identical'
    audit = 'public.stock_writer_admissions'
    assert audit in before, 'Canonical replay admissions must remain fingerprinted'
    for name in before:
        if name == audit:
            assert after[name]['count'] == before[name]['count'] + 1, 'Exactly one replay admission required'
            assert after[name]['hash'] != before[name]['hash'], 'Actual replay admission bytes required'
        else:
            assert after[name] == before[name], 'Canonical replay changed a non-admission relation: ' + name


def verify_replay_baselines(private, checkpoint1000, after_rollback):
    """Retain every relation and verify the explicitly audited replay append."""
    _replay_baseline_contract(private)
    assert private['before_replay'] == checkpoint1000, 'Replay baseline differs from actual checkpoint1000'
    assert private['after_replay'] == after_rollback, 'Positive configuration did not roll back to exact post-replay baseline'
    return {'kind': 'controlled-canonical-replay-admission-proof-v1', 'new_admission_rows': 1,
            'prior_admission_rows_preserved': True, 'expected_admission_only': True,
            'checkpoint_before_replay_matches': True, 'after_configuration_rollback_matches': True,
            'complete_relation_fingerprints_retained': len(private['before_replay'])}


def parse_positive(output):
    observations = _observations(output)
    assert len(observations) == 2 and [item.get('kind') for item in observations] == [
        'controlled-opening-correction-capacity-replay-baseline-v1',
        'controlled-opening-correction-capacity-positive-v1'], 'Exact ordered replay baseline and positive observations required'
    replay_baseline, value = observations
    _replay_baseline_contract(replay_baseline)
    _positive_contract(value)
    boundary = value.get('retained_boundary')
    assert isinstance(boundary, list) and len(boundary) == 1 and isinstance(boundary[0], dict)
    head = boundary[0].get('correction_head')
    assert isinstance(head, dict) and set(head) == {'event_id', 'version', 'record_hash'}
    assert type(head['version']) is int and head['version'] == 1000
    assert str(uuid.UUID(head['event_id'])) == head['event_id']
    assert re.fullmatch(r'[0-9a-f]{64}', head['record_hash'])
    # The full retained boundary contains synthetic row identities. Keep it only
    # in memory for the next SQL backend, outside sanitized proof output.
    return {key: data for key, data in value.items() if key != 'retained_boundary'}, boundary, replay_baseline


def observation_result(output, positive):
    _positive_contract(positive)
    positive = {key: data for key, data in positive.items() if key != 'retained_boundary'}
    values = _observations(output)
    kinds = ('controlled-opening-correction-capacity-canonical-baseline-v1',
             'controlled-opening-correction-capacity-observation-v1')
    assert len(values) == 2 and [value.get('kind') for value in values] == list(kinds), 'Exact ordered correction final observations required'
    baseline, final = values
    assert set(baseline) == {'kind', 'fingerprint', 'corrections', 'native_dispenses', 'canonical_fixture_committed_inside_owned_clone'}
    assert set(final) == {'kind', 'corrections', 'genuine_dispenses', 'genuine_max_allocations',
                          'genuine1001st_canonical_writer_succeeded', 'retained1000_and_zero_refused_without_truncation',
                          'sql_checks', 'refusals', 'outcomes', 'synthetic_only', 'hosted_writes',
                          'clinical_or_register_activation', 'configuration_transactions_rolled_back',
                          'canonical_fixture_committed_inside_owned_clone', 'canonical_fixture_removed_by_owned_clone_cleanup'}
    assert type(baseline.get('corrections')) is int and baseline['corrections'] == 1001
    assert type(baseline.get('native_dispenses')) is int and baseline['native_dispenses'] == 1
    assert baseline.get('canonical_fixture_committed_inside_owned_clone') is True
    _fingerprint(baseline.get('fingerprint'))
    for key, expected in (('corrections', 1001), ('genuine_dispenses', 1), ('genuine_max_allocations', 1), ('hosted_writes', 0)):
        assert type(final.get(key)) is int and final[key] == expected
    for key in ('genuine1001st_canonical_writer_succeeded', 'retained1000_and_zero_refused_without_truncation',
                'synthetic_only', 'configuration_transactions_rolled_back', 'canonical_fixture_committed_inside_owned_clone',
                'canonical_fixture_removed_by_owned_clone_cleanup'):
        assert final.get(key) is True, 'Canonical correction overflow observation required: ' + key
    assert final.get('clinical_or_register_activation') is False
    results = _phase(positive, POSITIVE_LABELS)
    results.update(_phase(final, FINAL_LABELS))
    return {'kind': 'controlled-opening-correction-capacity-v1', 'genuine_capacity_positive': positive,
            'final_observation': final, 'unique_results': results, 'unique_sql_checks': len(results),
            'unique_refusals': 4, 'unique_positive_assertions': 7}, baseline


def run_stage(runtime, query, deadline, label):
    """Single monitored boundary for every fixture backend invocation.

    Private diagnostic drivers may wrap this function with an ownership-checked
    monitor. Every invocation has the same unique application name, and receives
    only the remaining shared budget, including setup and previous invocations.
    """
    assert re.fullmatch(r'[a-z0-9_-]+', label)
    assert not getattr(runtime, 'safety_cleanup_mode', False), 'Workload cannot resume during safety cleanup'
    assert type(deadline) in (int, float) and math.isfinite(deadline)
    previous = getattr(runtime, 'operation_deadline', None)
    global_deadline = getattr(runtime, 'workload_deadline', None) or deadline
    writer = label == 'bootstrap' or label.startswith('append-')
    runtime.operation_deadline = min(deadline, global_deadline - 120 if writer else global_deadline)
    try:
        remaining = runtime.operation_deadline - time.monotonic()
        assert remaining > 0, 'Global correction probe budget exhausted'
        output = runtime.sql('set application_name=' + literal(runtime.application) + ';' + query,
                             runtime.database, timeout=remaining)
        assert time.monotonic() < runtime.operation_deadline, 'Correction stage returned after deadline'
        return output
    finally:
        runtime.operation_deadline = previous


def finalize_acceptance(proof, workload_finished_before_deadline, cleanup_status):
    """No partial, late or unsuccessfully cleaned workload is acceptance."""
    assert workload_finished_before_deadline is True
    assert cleanup_status.get('marked_database_removed') is True
    assert cleanup_status.get('source_runtime_unchanged_after_cleanup') is True
    assert proof.get('kind') == 'controlled-opening-correction-capacity-v1'
    audit = proof.get('canonical_replay_audit')
    assert isinstance(audit, dict) and audit.get('kind') == 'controlled-canonical-replay-admission-proof-v1'
    assert type(audit.get('new_admission_rows')) is int and audit['new_admission_rows'] == 1
    for key in ('prior_admission_rows_preserved', 'expected_admission_only',
                'checkpoint_before_replay_matches', 'after_configuration_rollback_matches'):
        assert audit.get(key) is True
    assert type(audit.get('complete_relation_fingerprints_retained')) is int and audit['complete_relation_fingerprints_retained'] > 0
    _positive_contract(proof['genuine_capacity_positive'])
    final = proof['final_observation']
    assert final.get('kind') == 'controlled-opening-correction-capacity-observation-v1'
    assert type(final.get('corrections')) is int and final['corrections'] == 1001
    assert final.get('genuine1001st_canonical_writer_succeeded') is True
    assert final.get('retained1000_and_zero_refused_without_truncation') is True
    results = _phase(proof['genuine_capacity_positive'], POSITIVE_LABELS)
    results.update(_phase(final, FINAL_LABELS))
    assert proof.get('unique_results') == results
    assert proof.get('unique_sql_checks') == 11 and proof.get('unique_positive_assertions') == 7 and proof.get('unique_refusals') == 4
    for key in ('canonical_fixture_committed_only_inside_owned_clone',
                'clone_configuration_all_relations_rolled_back_to_canonical_baseline',
                'controlled_configuration_and_events_match_original_empty_source',
                'technical_manifest_and_ten_canonical_writers_unchanged',
                'source_runtime_all_relations_unchanged', 'genuine_1000_correction_chain_proven'):
        assert proof.get(key) is True, 'Final correction preservation required: ' + key
    assert proof.get('clinical_or_register_activation') is False and proof.get('production_capacity_approved') is False
    assert proof.get('hosted_writes') == 0 and proof.get('provider_requests') == 0
    restored = proof.get('selected_schema_populated_restore_proven', False)
    assert type(restored) is bool, 'Typed correction restore acceptance flag required'
    if restored:
        from correction_history_restore import validate_restore_proof
        validate_restore_proof(proof.get('correction_history_populated_restore'))
    else:
        assert proof.get('correction_history_populated_restore') is None, 'Restore proof requires explicit acceptance flag'
    return {**proof, 'passed': True, 'workload_finished_before_deadline': True,
            'marked_correction_database_removed': True, 'source_runtime_unchanged_after_cleanup': True}


def cleanup(runtime, original, created, prior_failure):
    """Retain the original SQL error if database recovery prevents safe cleanup."""
    runtime.safety_cleanup_mode = True
    status = {'marked_database_removed': not created, 'source_runtime_unchanged_after_cleanup': False}
    if created:
        try:
            drop_database(runtime, runtime.database, runtime.marker)
            status['marked_database_removed'] = True
        except BaseException:
            runtime.capture_failure('corrections-cleanup')
            if not prior_failure:
                raise
    if original is not None:
        try:
            assert runtime.snapshot() == original, 'Correction source runtime changed'
            status['source_runtime_unchanged_after_cleanup'] = True
        except BaseException:
            runtime.capture_failure('corrections-source-check')
            if not prior_failure:
                raise
    return status


def main():
    os.umask(0o077)
    restore_flag = os.environ.get('CONTROLLED_ENGINE_CORRECTION_RESTORE', '0')
    assert restore_flag in ('0', '1'), 'Explicit correction restore opt-in required'
    source = SOURCE
    root = source.parents[3]
    folder = Path(os.environ['CONTROLLED_ENGINE_RESULT_DIR']).resolve()
    started = time.monotonic()
    deadline = started + 900
    runtime = Runtime(folder)
    runtime.workload_deadline = deadline
    writer_deadline = deadline - 120
    original = None
    created = False
    failed = False
    checkpoints = []
    admissions = []
    samples = []
    latest_sample = None
    workload_finished_before_deadline = False
    checkpoint_fingerprints = {}
    restore_proof = None
    receipt = {'kind': 'controlled-opening-correction-capacity-feasibility-v1', 'passed': False,
               'global_probe_budget_seconds': 900, 'maximum_canonical_writes_per_backend': 32,
               'elapsed_is_production_benchmark': False, 'checkpoints': checkpoints,
               'admissions': admissions, 'samples': samples, 'full_goal_completion': 'unknown',
               'writer_reserve_seconds': 120, 'writer_deadline_is_global_minus_reserve': True}
    receipt_path = folder / 'engine-correction-capacity-v1-checkpoints.json'
    try:
        original = runtime.snapshot()
        technical = runtime.technical()
        assert len(technical['writers']) == 10 and original['auth.users']['count'] == 0
        dump = runtime.dump()
        runtime.sql('create database "' + runtime.database + '";')
        created = True
        runtime.sql('comment on database "' + runtime.database + '" is ' + literal(runtime.marker) + ';')
        verify_database(runtime, runtime.database, runtime.marker)
        runtime.sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;'
                    'create extension "uuid-ossp"with schema extensions;', runtime.database)
        runtime.sql(dump, runtime.database)
        assert runtime.snapshot(runtime.database) == original
        assert runtime.technical(runtime.database) == technical
        parts = fixture_parts(root, source)
        seed = parse_seed(run_stage(runtime, parts['bootstrap'], writer_deadline, 'bootstrap'))
        current = 0
        previous_checkpoint = 0
        for target in (64, 128, 256, 512, 1000):
            interval_start = time.monotonic()
            while current < target:
                batch_target = min(current + 32, target)
                admission = admit_next_batch(current, batch_target, deadline - time.monotonic(), latest_sample)
                admissions.append(admission)
                receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
                assert admission['admitted'], 'Next correction batch exceeds reserved workload budget'
                batch_started = time.monotonic()
                query = (seeded_preamble(parts['preamble'], seed) +
                         'select pg_temp.correction_capacity_append_to(' + str(batch_target) + ');'
                         'set constraints all immediate;commit;')
                if batch_target == target:
                    query += 'select pg_temp.correction_capacity_checkpoint(' + str(target) + ');'
                output = run_stage(runtime, query, writer_deadline, 'append-' + str(batch_target))
                if batch_target == target:
                    observed = parse_checkpoint(output, target)
                else:
                    assert not _observations(output), 'Unexpected correction batch observation'
                latest_sample = {'previous_target': current, 'target': batch_target,
                                 'elapsed_seconds': time.monotonic() - batch_started}
                samples.append(latest_sample)
                current = batch_target
            elapsed = time.monotonic() - interval_start
            estimate = continuation_estimate(previous_checkpoint, target, elapsed, deadline - time.monotonic())
            estimate.pop('continue')
            estimate.update(forecast_only=True, goal_completion='unknown')
            assert set(observed['fingerprint']) == set(original), 'Correction checkpoint relation scope changed'
            checkpoint_fingerprints[str(target)] = observed['fingerprint']
            checkpoint = {key: value for key, value in observed.items() if key != 'fingerprint'}
            checkpoint.update(target=target, previous_target=previous_checkpoint,
                              stage_elapsed_seconds=round(elapsed, 3), full_goal_forecast=estimate)
            checkpoints.append(checkpoint)
            receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
            previous_checkpoint = target
        positive_output = run_stage(runtime, seeded_preamble(parts['preamble'], seed) + parts['positive'], deadline, 'positive')
        positive, boundary, replay_baseline = parse_positive(positive_output)
        post_positive_snapshot = runtime.snapshot(runtime.database)
        replay_audit = verify_replay_baselines(replay_baseline, checkpoint_fingerprints['1000'], post_positive_snapshot)
        if restore_flag == '1':
            from correction_history_restore import probe_correction_restore, validate_restore_proof
            restore_parts = restore_fixture_parts(source)
            preamble = seeded_preamble(parts['preamble'], seed)
            restore_proof = probe_correction_restore(
                runtime, preamble + parts['configuration'] + restore_parts['build'],
                preamble + restore_parts['validate'], post_positive_snapshot, technical, run_stage)
            validate_restore_proof(restore_proof)
        seed['retained_boundary'] = boundary
        admission = admit_next_batch(1000, 1001, deadline - time.monotonic(), latest_sample, positive_accepted=True)
        admissions.append(admission)
        receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
        assert admission['admitted'], 'Correction1001 exceeds reserved workload budget'
        batch_started = time.monotonic()
        output = run_stage(runtime, seeded_preamble(parts['preamble'], seed) +
                           'select pg_temp.correction_capacity_append_to(1001);set constraints all immediate;commit;', writer_deadline, 'append-1001')
        assert not _observations(output), 'Unexpected correction overflow writer observation'
        latest_sample = {'previous_target': 1000, 'target': 1001, 'elapsed_seconds': time.monotonic() - batch_started}
        samples.append(latest_sample)
        output = run_stage(runtime, seeded_preamble(parts['preamble'], seed) + parts['overlimit'], deadline, 'overlimit')
        proof, baseline = observation_result(output, positive)
        assert set(baseline['fingerprint']) == set(original)
        assert runtime.snapshot(runtime.database) == baseline['fingerprint'], 'Overflow configuration did not roll back exactly'
        controlled = lambda values: {key: value for key, value in values.items()
                                     if key.startswith(('public.controlled_stock_', 'public.controlled_draft_'))}
        assert controlled(baseline['fingerprint']) == controlled(original), 'Controlled configuration or events persisted'
        assert runtime.technical(runtime.database) == technical
        assert runtime.snapshot() == original
        proof.update(checkpoints=checkpoints, admissions=admissions, samples=samples,
                     canonical_replay_audit=replay_audit,
                     full_goal_forecasts_are_diagnostic_only=True,
                     global_probe_budget_seconds=900, writer_reserve_seconds=120,
                     writer_deadline_is_global_minus_reserve=True,
                     fixture_and_setup_elapsed_seconds=round(time.monotonic() - started, 3),
                     maximum_canonical_writes_per_backend=32, elapsed_is_production_benchmark=False,
                     selected_schemas=list(SCHEMAS), source_clone_exact_relation_fingerprints=len(original),
                     canonical_fixture_committed_only_inside_owned_clone=True,
                     clone_configuration_all_relations_rolled_back_to_canonical_baseline=True,
                     controlled_configuration_and_events_match_original_empty_source=True,
                     technical_manifest_and_ten_canonical_writers_unchanged=True,
                     source_runtime_all_relations_unchanged=True,
                     genuine_1000_correction_chain_proven=True, genuine_1000_return_or_discrepancy_chains_proven=False,
                     simultaneous_maxima_proven=False, selected_schema_populated_restore_proven=restore_proof is not None,
                     synthetic_only=True, sql_only=True, genuine_auth_api=False, canonical_migration=False,
                     actual_practice_rules=False, clinical_or_register_activation=False,
                     production_capacity_approved=False, hosted_writes=0, provider_requests=0)
        if restore_proof is not None:
            proof['correction_history_populated_restore'] = restore_proof
        with (folder / 'engine-correction-capacity-v1-preservation.json').open('x') as stream:
            json.dump({'original_source_and_clone': original, 'checkpoint_fingerprints': checkpoint_fingerprints,
                       'canonical1001_baseline': baseline['fingerprint'], 'canonical_replay_baselines': replay_baseline,
                       'manifest_and_writers': technical}, stream, indent=2)
            stream.write('\n')
        workload_finished_before_deadline = time.monotonic() < deadline
        assert workload_finished_before_deadline, 'Correction workload completed after global deadline'
        receipt['workload_finished_before_deadline'] = True
    except BaseException:
        failed = True
        runtime.safety_cleanup_mode = True
        runtime.capture_failure('corrections-execution')
        raise
    finally:
        try:
            runtime.safety_cleanup_mode = True
            cleanup_status = cleanup(runtime, original, created, failed)
            receipt.update(cleanup_status)
        finally:
            receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
            runtime.log.close()
    proof = finalize_acceptance(proof, workload_finished_before_deadline, cleanup_status)
    receipt['passed'] = True
    receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
    with (folder / 'engine-correction-capacity-v1-proof.json').open('x') as stream:
        json.dump(proof, stream, indent=2)
        stream.write('\n')
    print(json.dumps(proof))


if __name__ == '__main__':
    main()
