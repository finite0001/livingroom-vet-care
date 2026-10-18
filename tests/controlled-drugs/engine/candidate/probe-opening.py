"""Populated opening acceptance in marked owned clones; never a commissioning path."""
from pathlib import Path
import json
import os
import subprocess
import uuid

os.umask(0o077)
root = Path(__file__).resolve().parents[4]
source = Path(__file__).resolve().parent
folder = Path(os.environ['CONTROLLED_ENGINE_RESULT_DIR']).resolve()
runtime = json.loads((folder / 'runtime.json').read_text())
identity = runtime['identity']
assert identity.startswith('lrv-controlled-engine-') and not runtime['removed']
container = 'supabase_db_' + identity
labels = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]['Config']['Labels']
assert labels['com.supabase.cli.project'] == identity
assert Path(labels['com.supabase.cli.workdir']).resolve() == Path(runtime['project']).resolve()
markers = {}
created = []
proof = None
log = (folder / 'engine-opening-v1.log').open('x')

def sql(query, target='postgres', allow_error=False):
    p = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', target,
                        '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], input=query, capture_output=True,
                       text=True, timeout=180)
    log.write('DATABASE ' + target + '\n' + p.stdout + p.stderr + '\n'); log.flush()
    if p.returncode and not allow_error:
        print(p.stderr[-2200:])
        raise RuntimeError('Owned opening acceptance failed; private log retained')
    return p

def rows(query, target='postgres'):
    return sql(query, target).stdout

def snapshot(target):
    query = """create temp table owned_opening_snapshot(name text,value jsonb);
    do $$declare r record;v jsonb;begin
    for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in('public','auth','storage','extensions')and c.relkind in('r','p')order by 1,2 loop
    execute format('select jsonb_build_object(''count'',count(*),''hash'',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,''|''order by to_jsonb(t)::text),''''),''UTF8'')),''hex''))from %I.%I t',r.nspname,r.relname)into v;
    insert into owned_opening_snapshot values(r.nspname||'.'||r.relname,v);end loop;end$$;
    select jsonb_object_agg(name,value)from owned_opening_snapshot;"""
    return json.loads(rows("begin;set local timezone='UTC';" + query + "rollback;", target).splitlines()[-1])

def dump(target, schema_only=False):
    argv = ['docker', 'exec', container, 'pg_dump', '-U', 'postgres', '--no-owner', '--schema=public',
            '--schema=auth', '--schema=storage', '--schema=extensions']
    if schema_only: argv.append('--schema-only')
    text = subprocess.check_output([*argv, target], timeout=90).decode()
    return '\n'.join(line for line in text.splitlines() if not line.startswith('ALTER DEFAULT PRIVILEGES')).replace(
        'CREATE SCHEMA extensions;', 'CREATE SCHEMA IF NOT EXISTS extensions;')

def make(target):
    rows('create database ' + target + ';'); created.append(target)
    rows("comment on database " + target + " is '" + markers[target] + "';")
    rows('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;'
         'create extension "uuid-ossp"with schema extensions;', target)

def validate_in_zone(target, zone, historical_sessions_absent=False):
    assert zone in {'UTC', 'America/Denver', 'Asia/Kathmandu'}
    retirement = ("delete from auth.sessions;"
        "do $$begin if exists(select 1 from auth.sessions)then raise exception 'Historical sessions remain in restored validation';end if;end$$;"
        "select 'OWNED_RESTORED_HISTORICAL_SESSIONS_ABSENT';") if historical_sessions_absent else ''
    output = rows("begin;set local timezone='" + zone + "';" + retirement +
        "select set_config('request.jwt.claims','{}',true);select controlled_stock_manifest_required();"
        'select controlled_stock_validate_opening(id)from controlled_stock_openings;'
        'select controlled_stock_validate_product(product_id)from controlled_stock_states;'
        'select controlled_stock_validate_event(id)from controlled_stock_events;'
        "do $$declare product uuid;did uuid;begin select id into product from catalog_products where name='Synthetic second product';"
        "select d.id into did from native_dispenses d join native_dispense_allocations a on a.dispense_id=d.id join inventory_lots l on l.id=a.lot_id where l.product_id=product;"
        "if product is null or did is null then raise exception 'Populated foreign product missing during cross-zone validation';end if;"
        "perform controlled_stock_opening_native_entry_for_product(product,'tablet',did,0,0,0,null);end$$;rollback;", target)
    if historical_sessions_absent:
        assert 'OWNED_RESTORED_HISTORICAL_SESSIONS_ABSENT' in output.splitlines()

try:
    original = snapshot('postgres')
    schema = dump('postgres', True)
    technical = subprocess.check_output(['docker', 'exec', container, 'pg_dump', '-U', 'postgres', '--data-only',
        '--no-owner', '--table=public.stock_writer_manifests', '--table=public.controlled_stock_engine_manifests', 'postgres'], timeout=30).decode()
    fixture = (root / 'supabase/tests/native_fulfillment.test.sql').read_text()
    needle = "insert into data select 'target',"
    assert fixture.count(needle) == 1
    prefix = fixture[:fixture.index(needle)] + '\ncommit;\n'
    config = (source / 'native-config.sql').read_text()
    cut = 'insert into controlled_stock_openings('
    assert config.count(cut) == 1
    config = config[:config.index(cut)]
    template = (source / 'opening-boundary-acceptance.sql').read_text()
    history = (source / 'opening-history.sql').read_text()
    seed = history.split('-- HISTORY_SEED_BEGIN\n')[1].split('\n-- HISTORY_SEED_END')[0]
    extra = history.split('-- HISTORY_ACCEPTANCE_BEGIN\n')[1].split('\n-- HISTORY_ACCEPTANCE_END')[0]
    assert template.count('-- OWNED_PRIVATE_CONFIGURATION --') == template.count('-- OWNED_HISTORY_LEGACY_SEED --') == template.count('-- OWNED_HISTORY_ACCEPTANCE --') == 1
    commit_refusal = template.split('-- COMMIT_REFUSAL_BEGIN\n')[1].split('\n-- COMMIT_REFUSAL_END')[0]
    managed_append = template.split('-- MANAGED_APPEND_BEGIN\n')[1].split('\n-- MANAGED_APPEND_END')[0]
    template = template.split('-- COMMIT_REFUSAL_BEGIN')[0]
    template = template.replace('-- OWNED_PRIVATE_CONFIGURATION --', config).replace('-- OWNED_HISTORY_LEGACY_SEED --', seed).replace('-- OWNED_HISTORY_ACCEPTANCE --', extra)
    writer_zones = ['UTC', 'America/Denver', 'Asia/Kathmandu']
    scenarios = []
    for zone in writer_zones:
        database = 'owned_controlled_opening_' + uuid.uuid4().hex[:10]
        restored = 'owned_controlled_opening_restore_' + uuid.uuid4().hex[:10]
        markers.update({database: str(uuid.uuid4()), restored: str(uuid.uuid4())})
        make(database); rows(schema + '\n' + technical, database)
        rows('select controlled_stock_manifest_required();insert into native_return_policy_state values(true,0,null);', database)
        output = rows(prefix + template.replace('__WRITER_TIMEZONE__', zone), database)
        scenario = json.loads(next(line for line in reversed(output.splitlines()) if line.startswith('{')))
        assert scenario['kind'] == 'controlled-opening-boundary-acceptance'
        assert scenario['rejected_cases'] == 27 and scenario['positive_sql_assertions'] == 14
        assert scenario['historical_rejected_cases'] > 0 and scenario['historical_positive_sql_assertions'] > 0
        scenario.update(writer_timezone=zone, independently_verified_foreign_same_unit_product=True)
        populated = snapshot(database)
        read_zones = []
        for caller_zone in writer_zones:
            validate_in_zone(database, caller_zone)
            assert snapshot(database) == populated
            read_zones.append(caller_zone)
        scenario['validation_caller_timezones'] = read_zones
        scenario['exact_all_relation_fingerprints_after_each_caller_timezone'] = True
        rejection = sql(commit_refusal, database, True)
        assert rejection.returncode != 0 and '23514' in rejection.stderr
        assert 'Opening available cells must match original opening movement net exactly' in rejection.stderr
        assert 'OWNED_INVALID_FIXTURE_READY_FOR_COMMIT' in rejection.stdout, 'Refusal must occur at COMMIT after valid inserts'
        assert snapshot(database) == populated
        scenario['unattached_invalid_opening_commit_refused'] = True
        managed_output = rows(managed_append, database)
        managed = json.loads(next(line for line in reversed(managed_output.splitlines()) if line.startswith('{')))
        assert managed['managed_canonical_actions'] == 2 and managed['managed_prefix_sql_assertions'] == 4
        scenario.update(managed)
        populated = snapshot(database)
        make(restored); rows(dump(database), restored)
        assert snapshot(restored) == populated
        for caller_zone in writer_zones:
            validate_in_zone(restored, caller_zone)
            assert snapshot(restored) == populated
        retirement_zone = writer_zones[(writer_zones.index(zone) + 1) % len(writer_zones)]
        validate_in_zone(restored, retirement_zone, historical_sessions_absent=True)
        assert snapshot(restored) == populated
        assert snapshot(database) == populated and snapshot('postgres') == original
        scenario.update(populated_restore_validated_without_caller_auth_context=True,
            actual_historical_sessions_absent_during_restored_validation=True,
            restored_session_deletion_rolled_back_exactly=True, retirement_validation_caller_timezone=retirement_zone,
            restored_validation_caller_timezones=writer_zones, restored_exact_relation_fingerprints=len(populated),
            source_runtime_all_relations_unchanged=len(original), original_native_documents_operations_and_hashes_preserved=True)
        scenarios.append(scenario)
    assert len({s['historical_rejected_cases'] for s in scenarios}) == len({s['historical_positive_sql_assertions'] for s in scenarios}) == 1
    proof = dict(kind='controlled-opening-historical-acceptance', writer_timezones=writer_zones, scenario_count=len(scenarios), scenarios=scenarios,
        baseline_unique_rejection_cases=27, baseline_unique_positive_sql_assertions=14,
        new_unique_rejection_cases=scenarios[0]['historical_rejected_cases'], new_unique_positive_sql_assertions=scenarios[0]['historical_positive_sql_assertions'],
        baseline_rejection_executions=sum(s['rejected_cases'] for s in scenarios), baseline_positive_sql_assertion_executions=sum(s['positive_sql_assertions'] for s in scenarios),
        new_rejection_executions=sum(s['historical_rejected_cases'] for s in scenarios), new_positive_sql_assertion_executions=sum(s['historical_positive_sql_assertions'] for s in scenarios),
        managed_unique_canonical_actions=2, managed_canonical_action_executions=sum(s['managed_canonical_actions'] for s in scenarios),
        marked_populated_database_count=len(scenarios), marked_restored_database_count=len(scenarios),
        raw_receipts_preserved_without_historical_rewrite=True, genuine_pre_c1a_upgrade_proven=False,
        synthetic_only=True, sql_only=True, genuine_auth_api=False, canonical_migration=False,
        actual_practice_rules=False, physical_post_backup_reconciliation_proven=False, storage_binary_restore_proven=False,
        hosted_writes=0, provider_requests=0)

finally:
    try:
        for target in reversed(created):
            assert rows("select shobj_description(oid,'pg_database')from pg_database where datname='" + target + "';").strip() == markers[target]
            rows('drop database ' + target + ' with(force);')
            assert rows("select count(*)from pg_database where datname='" + target + "';").strip() == '0'
    finally:
        log.close()
if proof is not None:
    proof['owned_populated_and_restore_databases_removed'] = True
    with (folder / 'engine-opening-v1-proof.json').open('x') as stream:
        json.dump(proof, stream, indent=2); stream.write('\n')
    print(json.dumps(proof))
