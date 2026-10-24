"""Selected-schema restore of a genuine synthetic 1,000-correction opening.

The caller owns the runtime, source history, shared deadline and SQL fixtures.
This helper creates only registered, UUID-marked databases in that same runtime.
Full fingerprints remain private; its returned evidence contains no row IDs.
"""
import copy
import json
import math
import re
import time
import uuid


SCHEMAS = ('public', 'auth', 'storage', 'extensions')
ZONES = ('UTC', 'America/Denver', 'Asia/Kathmandu')
TIMEZONE_MARKER = '-- CORRECTION_RESTORE_TIMEZONE --'
VALIDATION_KIND = 'controlled-correction-history-restored-validation-v1'
PROOF_KIND = 'controlled-correction-history-populated-restore-v1'
VALIDATION_COUNTS = {'canonical_corrections': 1000, 'canonical_operations': 1000,
                     'native_dispenses': 1, 'native_allocations': 1,
                     'retained_correction_version': 1000, 'valid_unattached_openings': 1,
                     'frozen_states': 1, 'active_states': 0, 'controlled_events': 0}
VALIDATION_FLAGS = ('caller_claims_cleared', 'canonical_chain_and_receipts_verified',
                    'exact_stored_head_and_boundary', 'native_quantities_and_billing_unchanged',
                    'opening_and_product_validated', 'all_deferred_constraints_validated',
                    'no_other_lifecycle_families', 'audit_rows_unchanged_during_validation')
PRESERVATION_FLAGS = ('initial_source_clone_exact', 'populated_opening_restore_exact',
                      'canonical_source_rows_unchanged', 'historical_sessions_unchanged',
                      'technical_manifest_and_ten_writer_definitions_unchanged',
                      'fresh_validation_without_caller_auth_context',
                      'restored_sessions_absent_during_validation',
                      'session_retirement_validation_rolled_back_exactly',
                      'source_clone_all_relations_unchanged', 'original_runtime_all_relations_unchanged',
                      'marked_populated_and_restored_databases_removed',
                      'workload_finished_before_deadline')


def _literal(value):
    return "'" + value.replace("'", "''") + "'"


def _fingerprint(value):
    assert isinstance(value, dict) and value, 'Full selected-schema fingerprints required'
    for name, record in value.items():
        assert isinstance(name, str) and '.' in name and name.split('.', 1)[0] in SCHEMAS and name.split('.', 1)[1]
        assert isinstance(record, dict) and set(record) == {'count', 'hash'}
        assert type(record['count']) is int and record['count'] >= 0
        assert isinstance(record['hash'], str) and re.fullmatch(r'[0-9a-f]{64}', record['hash'])
    return value


def _json_observations(output):
    assert isinstance(output, str)
    records = []
    for line in output.splitlines():
        try:
            records.append(json.loads(line))
        except ValueError:
            pass
    return records


def _one_json(output):
    records = _json_observations(output)
    assert len(records) == 1 and isinstance(records[0], dict), 'Exactly one restore JSON observation required'
    return records[0]


def parse_validation(output, zone, expected_sessions, opening_actor_session_present):
    assert zone in ZONES
    assert type(expected_sessions) is int and expected_sessions >= 0
    assert type(opening_actor_session_present) is bool
    value = _one_json(output)
    expected_keys = {'kind', 'prepared_quantity', 'validation_timezone', 'retained_auth_sessions',
                     'opening_actor_session_present'} | set(VALIDATION_COUNTS) | set(VALIDATION_FLAGS)
    assert set(value) == expected_keys, 'Exact restored-validation fields required'
    assert value['kind'] == VALIDATION_KIND and value['validation_timezone'] == zone
    assert value['prepared_quantity'] == '0.125'
    for key, expected in VALIDATION_COUNTS.items():
        assert type(value[key]) is int and value[key] == expected, 'Restored canonical count mismatch: ' + key
    assert type(value['retained_auth_sessions']) is int and value['retained_auth_sessions'] == expected_sessions
    assert value['opening_actor_session_present'] is opening_actor_session_present
    assert all(value[key] is True for key in VALIDATION_FLAGS)
    return value


def verify_source_preservation(source, committed, original_sessions, retained_sessions):
    """Keep all canonical fingerprints and every original session row exact."""
    _fingerprint(source)
    _fingerprint(committed)
    assert set(source) == set(committed), 'Restore fixture changed the full selected relation scope'
    assert isinstance(original_sessions, list) and isinstance(retained_sessions, list)
    assert retained_sessions == original_sessions, 'Restore fixture changed original session rows'
    assert 'auth.sessions' in source
    assert len(original_sessions) == source['auth.sessions']['count']
    assert committed['auth.sessions']['count'] == source['auth.sessions']['count'] + 1
    for name in source:
        if name == 'auth.sessions' or name.startswith(('public.controlled_stock_', 'public.controlled_draft_')):
            continue
        assert committed[name] == source[name], 'Restore fixture changed canonical source relation: ' + name
    return True


def _verify_owned_database(adapter, registry):
    target = adapter.database
    assert isinstance(target, str) and re.fullmatch(r'owned_controlled_corrections_[0-9a-f]{10}', target), 'Unsafe correction restore database'
    assert target in registry, 'Unregistered correction restore database'
    record = registry[target]
    assert set(record) == {'role', 'marker'} and record['role'] in ('source', 'populated', 'restored')
    assert isinstance(record['marker'], str) and re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', record['marker'])
    assert adapter.marker == record['marker'], 'Correction restore adapter marker mismatch'
    adapter.verify()
    actual = adapter.raw_sql("select shobj_description(oid,'pg_database')from pg_database where datname=" + _literal(target) + ';').strip()
    assert actual == record['marker'], 'Correction restore database ownership marker mismatch'


def _drop_owned_database(adapter, registry):
    _verify_owned_database(adapter, registry)
    assert registry[adapter.database]['role'] in ('populated', 'restored'), 'Cannot drop the correction source database'
    adapter.raw_sql('drop database "' + adapter.database + '" with(force);')
    assert adapter.raw_sql('select count(*)from pg_database where datname=' + _literal(adapter.database) + ';').strip() == '0'


def validate_restore_proof(proof):
    assert isinstance(proof, dict)
    fields = {'kind', 'passed', 'selected_schemas', 'selected_relation_count', 'original_auth_session_count',
              'synthetic_opening_sessions_added_only_in_clone', 'fresh_validation_caller_timezones',
              'validations', 'synthetic_only', 'sql_only', 'genuine_auth_api', 'canonical_migration',
              'physical_post_backup_reconciliation_proven', 'storage_binary_restore_proven',
              'hosted_writes', 'provider_requests', 'clinical_or_register_activation', 'production_capacity_approved'}
    assert set(proof) == fields | set(VALIDATION_COUNTS) | set(PRESERVATION_FLAGS) | {'prepared_quantity'}
    assert proof['kind'] == PROOF_KIND and proof['passed'] is True
    assert proof['selected_schemas'] == list(SCHEMAS)
    assert type(proof['selected_relation_count']) is int and proof['selected_relation_count'] == 456
    assert type(proof['original_auth_session_count']) is int and proof['original_auth_session_count'] >= 0
    assert type(proof['synthetic_opening_sessions_added_only_in_clone']) is int and proof['synthetic_opening_sessions_added_only_in_clone'] == 1
    assert proof['fresh_validation_caller_timezones'] == list(ZONES)
    for key, expected in VALIDATION_COUNTS.items():
        assert type(proof[key]) is int and proof[key] == expected
    assert proof['prepared_quantity'] == '0.125'
    assert all(proof[key] is True for key in PRESERVATION_FLAGS)
    assert proof['synthetic_only'] is True and proof['sql_only'] is True
    for key in ('genuine_auth_api', 'canonical_migration', 'physical_post_backup_reconciliation_proven',
                'storage_binary_restore_proven', 'clinical_or_register_activation', 'production_capacity_approved'):
        assert proof[key] is False
    for key in ('hosted_writes', 'provider_requests'):
        assert type(proof[key]) is int and proof[key] == 0
    expected = [(role, zone, False) for role in ('populated', 'restored') for zone in ZONES]
    expected.append(('restored', 'Asia/Kathmandu', True))
    assert isinstance(proof['validations'], list) and len(proof['validations']) == len(expected)
    for item, (role, zone, retired) in zip(proof['validations'], expected):
        assert isinstance(item, dict) and item.get('database_role') == role and item.get('sessions_retired') is retired
        observation = {key: value for key, value in item.items() if key not in ('database_role', 'sessions_retired')}
        parse_validation(json.dumps(observation), zone, 0 if retired else proof['original_auth_session_count'] + 1, not retired)
    return proof


def probe_correction_restore(runtime, opening_sql, validation_sql, source_snapshot, technical, stage_runner):
    """Persist only in a clone, restore it, and return evidence after cleanup."""
    deadline = runtime.workload_deadline
    assert type(deadline) in (int, float) and math.isfinite(deadline)
    assert not runtime.safety_cleanup_mode and time.monotonic() < deadline
    assert isinstance(opening_sql, str) and isinstance(validation_sql, str)
    assert validation_sql.count(TIMEZONE_MARKER) == 1
    assert len(_fingerprint(source_snapshot)) == 456
    assert isinstance(technical, dict) and len(technical['writers']) == 10
    registry = {runtime.database: {'role': 'source', 'marker': runtime.marker}}
    source = copy.copy(runtime)
    source.operation_deadline = None
    created = []
    postgres_snapshot = None
    committed = None
    restored_snapshot = None
    validations = []
    original_error = None
    cleanup_errors = []
    cleanup_source_unchanged = False
    cleanup_postgres_unchanged = False
    workload_finished = False

    def check():
        assert time.monotonic() < deadline, 'Shared correction restore workload deadline exhausted'

    def stage(adapter, sql, label):
        check()
        _verify_owned_database(adapter, registry)
        output = stage_runner(adapter, sql, deadline, label)
        check()
        return output

    def snapshot(adapter):
        check()
        _verify_owned_database(adapter, registry)
        value = adapter.snapshot(adapter.database)
        check()
        return _fingerprint(value)

    def manifest(adapter):
        check()
        _verify_owned_database(adapter, registry)
        value = adapter.technical(adapter.database)
        check()
        return value

    def dump(adapter):
        check()
        _verify_owned_database(adapter, registry)
        argv = ['docker', 'exec', adapter.container, 'pg_dump', '-U', 'postgres', '--no-owner']
        argv.extend('--schema=' + name for name in SCHEMAS)
        output = adapter.command([*argv, adapter.database], timeout=90)
        check()
        return '\n'.join(line for line in output.splitlines() if not line.startswith('ALTER DEFAULT PRIVILEGES')).replace(
            'CREATE SCHEMA extensions;', 'CREATE SCHEMA IF NOT EXISTS extensions;')

    def make(role):
        check()
        adapter = copy.copy(runtime)
        adapter.database = 'owned_controlled_corrections_' + uuid.uuid4().hex[:10]
        adapter.marker = str(uuid.uuid4())
        adapter.operation_deadline = None
        adapter.safety_cleanup_mode = False
        assert adapter.database not in registry, 'Restore database identity collision'
        registry[adapter.database] = {'role': role, 'marker': adapter.marker}
        # Register the attempt before CREATE, so even late/failed results receive
        # an independent marker-checked cleanup attempt rather than disappearing.
        created.append(adapter)
        runtime.raw_sql('create database "' + adapter.database + '";')
        runtime.raw_sql('comment on database "' + adapter.database + '" is ' + _literal(adapter.marker) + ';')
        _verify_owned_database(adapter, registry)
        stage(adapter, 'drop schema public;create schema extensions;create extension pgcrypto with schema extensions;'
              'create extension "uuid-ossp"with schema extensions;', 'restore-bootstrap-' + role)
        return adapter

    def sessions(adapter, retained=False):
        where = 'where id not in(select session_id from controlled_stock_openings)' if retained else ''
        value = _one_json(stage(adapter, "select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(s)order by id),'[]'::jsonb))from auth.sessions s " + where + ';',
                                'restore-sessions-' + registry[adapter.database]['role']))
        assert set(value) == {'rows'} and isinstance(value['rows'], list)
        return value['rows']

    try:
        _verify_owned_database(source, registry)
        assert snapshot(source) == source_snapshot
        assert manifest(source) == technical
        postgres_snapshot = runtime.snapshot()
        check()
        original_sessions = sessions(source)
        populated = make('populated')
        stage(populated, dump(source), 'restore-load-source')
        assert snapshot(populated) == source_snapshot
        assert manifest(populated) == technical
        output = stage(populated, opening_sql + '\ncommit;\n', 'restore-persist-opening')
        assert not _json_observations(output), 'Opening construction must emit no JSON observation'
        committed = snapshot(populated)
        verify_source_preservation(source_snapshot, committed, original_sessions, sessions(populated, retained=True))
        assert manifest(populated) == technical
        restored = make('restored')
        stage(restored, dump(populated), 'restore-load-populated')
        restored_snapshot = snapshot(restored)
        assert restored_snapshot == committed
        assert manifest(restored) == technical
        for adapter in (populated, restored):
            for zone in ZONES:
                sql = validation_sql.replace(TIMEZONE_MARKER, 'set local timezone=' + _literal(zone) + ';')
                output = stage(adapter, sql + '\nrollback;\n', 'restore-validate-' + registry[adapter.database]['role'] + '-' + zone.split('/')[-1].lower())
                value = parse_validation(output, zone, len(original_sessions) + 1, True)
                validations.append({**value, 'database_role': registry[adapter.database]['role'], 'sessions_retired': False})
                assert snapshot(adapter) == committed
        sql = validation_sql.replace(TIMEZONE_MARKER, "set local timezone='Asia/Kathmandu';delete from auth.sessions;")
        output = stage(restored, sql + '\nrollback;\n', 'restore-validate-retired-sessions')
        value = parse_validation(output, 'Asia/Kathmandu', 0, False)
        validations.append({**value, 'database_role': 'restored', 'sessions_retired': True})
        assert snapshot(restored) == committed
        assert snapshot(populated) == committed
        assert snapshot(source) == source_snapshot
        assert runtime.snapshot() == postgres_snapshot
        check()
        workload_finished = True
    except BaseException as error:
        original_error = error
        diagnostic = copy.copy(runtime)
        diagnostic.safety_cleanup_mode = True
        try:
            diagnostic.capture_failure('correction-restore-execution')
        except BaseException:
            pass
        raise
    finally:
        # Only copies enter safety cleanup. The caller can never accidentally
        # resume workload SQL with its global deadline disabled.
        for adapter in reversed(created):
            safety = copy.copy(adapter)
            safety.safety_cleanup_mode = True
            try:
                _drop_owned_database(safety, registry)
            except BaseException as error:
                cleanup_errors.append(type(error).__name__)
                try:
                    safety.capture_failure('correction-restore-cleanup')
                except BaseException:
                    pass
        safety = copy.copy(source)
        safety.safety_cleanup_mode = True
        try:
            _verify_owned_database(safety, registry)
            assert safety.snapshot(safety.database) == source_snapshot
            cleanup_source_unchanged = True
        except BaseException as error:
            cleanup_errors.append(type(error).__name__)
        if postgres_snapshot is not None:
            try:
                assert safety.snapshot() == postgres_snapshot
                cleanup_postgres_unchanged = True
            except BaseException as error:
                cleanup_errors.append(type(error).__name__)
        private = {'source_snapshot': source_snapshot, 'postgres_snapshot': postgres_snapshot,
                   'committed_populated_snapshot': committed, 'restored_snapshot': restored_snapshot,
                   'registered_database_roles': registry, 'workload_finished_before_deadline': workload_finished,
                   'cleanup_error_types': cleanup_errors, 'source_clone_unchanged_after_cleanup': cleanup_source_unchanged,
                   'postgres_unchanged_after_cleanup': cleanup_postgres_unchanged}
        try:
            with (runtime.folder / 'engine-correction-history-restore-v1-preservation.json').open('x') as stream:
                json.dump(private, stream, indent=2)
                stream.write('\n')
        except BaseException:
            if original_error is None:
                raise
        if original_error is None:
            assert not cleanup_errors and cleanup_source_unchanged and cleanup_postgres_unchanged, 'Correction restore cleanup or source preservation failed'
    proof = {'kind': PROOF_KIND, 'passed': True, 'selected_schemas': list(SCHEMAS), 'selected_relation_count': len(committed),
             'original_auth_session_count': len(original_sessions), 'synthetic_opening_sessions_added_only_in_clone': 1,
             'fresh_validation_caller_timezones': list(ZONES), 'validations': validations,
             'prepared_quantity': '0.125', 'synthetic_only': True, 'sql_only': True,
             'genuine_auth_api': False, 'canonical_migration': False,
             'physical_post_backup_reconciliation_proven': False, 'storage_binary_restore_proven': False,
             'hosted_writes': 0, 'provider_requests': 0, 'clinical_or_register_activation': False,
             'production_capacity_approved': False, **VALIDATION_COUNTS}
    proof.update({key: True for key in PRESERVATION_FLAGS})
    return validate_restore_proof(proof)
