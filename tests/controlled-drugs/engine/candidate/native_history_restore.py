"""Persist and restore synthetic old-stock openings in marked local databases.

Only the caller's label-verified disposable runtime is used. Source history and
all selected restored relations are compared independently of fixture assertions.
"""
import json
import re
import uuid


SCHEMAS = ('public', 'auth', 'storage', 'extensions')
READY_MARKER = '-- GENERIC_VALID_OPENING_READY --'


def _identifier(value):
    return '"' + value.replace('"', '""') + '"'


def _literal(value):
    return "'" + value.replace("'", "''") + "'"


def _verify_owned_database(replay, target, markers):
    assert re.fullmatch(r'owned_old_stock_(?:opening|restore)_[0-9a-f]{10}', target), 'Unsafe restore database target'
    assert target in markers, 'Unknown restore database target'
    assert re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', markers[target]), 'Invalid ownership marker'
    replay.verify()
    actual = replay.sql("select shobj_description(oid,'pg_database')from pg_database where datname=" +
                        _literal(target) + ';').strip()
    assert actual == markers[target], 'Owned restore database marker mismatch'


def _drop_owned_database(replay, target, markers):
    _verify_owned_database(replay, target, markers)
    replay.sql('drop database ' + _identifier(target) + ' with(force);')
    assert replay.sql('select count(*)from pg_database where datname=' +
                      _literal(target) + ';').strip() == '0', 'Owned restore database remains'


def probe_generic_restore(replay, seed, fixture_text, original_snapshot, columns):
    """Commit the valid fixture only in a clone, then prove its populated restore."""
    assert fixture_text.count(READY_MARKER) == 1, 'Exact valid-opening fixture marker required'
    assert seed.get('era') in (187, 188), 'Exact genuine historical seed era required'
    assert replay.snapshot(columns) == original_snapshot, 'Source changed before restore proof'
    markers = {}
    created = []
    proof = None

    def verify(target):
        _verify_owned_database(replay, target, markers)

    def make(prefix):
        target = prefix + uuid.uuid4().hex[:10]
        markers[target] = str(uuid.uuid4())
        replay.verify()
        replay.sql('create database ' + _identifier(target) + ';')
        created.append(target)
        replay.sql('comment on database ' + _identifier(target) + ' is ' + _literal(markers[target]) + ';')
        verify(target)
        replay.sql('drop schema public;create schema extensions;'
                   'create extension pgcrypto with schema extensions;'
                   'create extension "uuid-ossp"with schema extensions;', database=target)
        return target

    def dump(target):
        if target == 'postgres':
            replay.verify()
        else:
            verify(target)
        argv = ['docker', 'exec', replay.container, 'pg_dump', '-U', 'postgres', '--no-owner']
        argv.extend('--schema=' + schema for schema in SCHEMAS)
        output = replay.command([*argv, target], timeout=90)
        # These are the same narrow bootstrap adaptations as probe-opening.py.
        # Keep function bodies, normal grants, RLS, triggers and all scoped data.
        return '\n'.join(line for line in output.splitlines()
                         if not line.startswith('ALTER DEFAULT PRIVILEGES')).replace(
                             'CREATE SCHEMA extensions;', 'CREATE SCHEMA IF NOT EXISTS extensions;')

    def snapshot(target):
        verify(target)
        return replay.snapshot(columns, database=target)

    def manifest_and_writers(target):
        if target != 'postgres':
            verify(target)
        return replay.json('select controlled_stock_manifest_required();'
                           "select jsonb_build_object('manifest',(select jsonb_agg(to_jsonb(m)order by revision)"
                           'from controlled_stock_engine_manifests m),'
                           "'writers',(select jsonb_object_agg(signature,encode(sha256(convert_to("
                           "pg_get_functiondef(to_regprocedure(signature)),'UTF8')),'hex'))from stock_writer_manifests));",
                           database=target)

    def canonical_rows(value):
        return {name: row for name, row in value.items()
                if name != 'auth.sessions' and not name.startswith(('public.controlled_stock_', 'public.controlled_draft_'))}

    def validate(target, zone, retire_sessions=False):
        assert zone in ('UTC', 'America/Denver', 'Asia/Kathmandu')
        verify(target)
        retired = ('delete from auth.sessions;'
                   "do $$begin if exists(select 1 from auth.sessions)then raise exception 'Restored historical sessions remain';end if;end$$;") if retire_sessions else ''
        replay.sql("begin;set local timezone=" + _literal(zone) + ';' + retired +
                   "select set_config('request.jwt.claims','{}',true);"
                   "do $$begin if auth.uid()is not null then raise exception 'Fresh validation retained caller identity';end if;end$$;"
                   'select controlled_stock_manifest_required();'
                   'select controlled_stock_validate_opening(id)from controlled_stock_openings;'
                   'select controlled_stock_validate_product(product_id)from controlled_stock_openings;'
                   'select controlled_stock_validate_event(id)from controlled_stock_events;'
                   'set constraints all immediate;rollback;', database=target)

    try:
        original_sessions = replay.json("select coalesce(jsonb_agg(to_jsonb(s)order by id),'[]'::jsonb)from auth.sessions s;")
        technical = manifest_and_writers('postgres')
        assert len(technical['writers']) == 10, 'All ten canonical writers required'
        source_dump = dump('postgres')
        populated = make('owned_old_stock_opening_')
        verify(populated)
        replay.sql(source_dump, database=populated)
        assert snapshot(populated) == original_snapshot, 'Initial source clone differs'
        assert manifest_and_writers(populated) == technical
        prefix = fixture_text.split(READY_MARKER)[0]
        verify(populated)
        replay.sql(prefix + '\ncommit;\n', {'ids_json': json.dumps(seed)}, database=populated)
        committed = snapshot(populated)
        assert canonical_rows(committed) == canonical_rows(original_snapshot), 'Opening fixture changed canonical source rows'
        counts = replay.json("select jsonb_build_object('openings',(select count(*)from controlled_stock_openings),"
                             "'states',(select count(*)from controlled_stock_states),"
                             "'events',(select count(*)from controlled_stock_events),"
                             "'active_states',(select count(*)from controlled_stock_state_events where state='active'));", database=populated)
        assert counts == {'openings': 1, 'states': 1, 'events': 0, 'active_states': 0}, 'Exactly one frozen unattached opening required'
        retained_sessions = replay.json("select coalesce(jsonb_agg(to_jsonb(s)order by id),'[]'::jsonb)from auth.sessions s "
                                       'where id not in(select session_id from controlled_stock_openings);', database=populated)
        assert retained_sessions == original_sessions, 'Opening fixture changed historical sessions'
        assert committed['auth.sessions']['count'] == original_snapshot['auth.sessions']['count'] + 1, 'Exactly one synthetic opening session required'
        assert manifest_and_writers(populated) == technical
        restored = make('owned_old_stock_restore_')
        restored_dump = dump(populated)
        verify(restored)
        replay.sql(restored_dump, database=restored)
        assert snapshot(restored) == committed, 'Populated opening restore differs'
        assert manifest_and_writers(restored) == technical
        zones = ['UTC', 'America/Denver', 'Asia/Kathmandu']
        for target in (populated, restored):
            for zone in zones:
                validate(target, zone)
                assert snapshot(target) == committed, 'Fresh validation changed persisted opening/history'
        validate(restored, 'Asia/Kathmandu', retire_sessions=True)
        assert snapshot(restored) == committed, 'Session-retirement validation did not roll back exactly'
        assert snapshot(populated) == committed
        assert replay.snapshot(columns) == original_snapshot, 'Restore proof changed source runtime'
        proof = {'kind': 'controlled-old-available-opening-populated-restore',
                 'selected_schemas': list(SCHEMAS), 'selected_relation_count': len(committed),
                 'persisted_valid_unattached_openings': 1, 'persisted_frozen_controlled_states': 1,
                 'persisted_active_controlled_states': 0, 'historical_sessions_unchanged': True,
                 'synthetic_opening_sessions_added_only_in_clone': 1,
                 'persisted_controlled_events': 0, 'initial_source_clone_exact': True,
                 'populated_opening_restore_exact': True, 'canonical_source_rows_unchanged': True,
                 'technical_manifest_and_ten_writer_definitions_unchanged': True,
                 'fresh_validation_caller_timezones': zones,
                 'fresh_validation_without_caller_auth_context': True,
                 'restored_historical_sessions_absent_during_validation': True,
                 'session_retirement_validation_rolled_back_exactly': True,
                 'original_runtime_all_relations_unchanged': True,
                 'synthetic_only': True, 'sql_only': True, 'genuine_auth_api': False,
                 'physical_post_backup_reconciliation_proven': False,
                 'storage_binary_restore_proven': False, 'hosted_writes': 0}
    finally:
        for target in reversed(created):
            _drop_owned_database(replay, target, markers)
    assert replay.snapshot(columns) == original_snapshot, 'Restore cleanup changed source runtime'
    proof['marked_populated_and_restored_databases_removed'] = True
    return proof
