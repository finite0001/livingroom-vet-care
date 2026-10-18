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
database = 'owned_controlled_opening_' + uuid.uuid4().hex[:10]
restored = 'owned_controlled_opening_restore_' + uuid.uuid4().hex[:10]
markers = {database: str(uuid.uuid4()), restored: str(uuid.uuid4())}
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
    return json.loads(rows(query, target).splitlines()[-1])

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

try:
    original = snapshot('postgres')
    schema = dump('postgres', True)
    technical = subprocess.check_output(['docker', 'exec', container, 'pg_dump', '-U', 'postgres', '--data-only',
        '--no-owner', '--table=public.stock_writer_manifests', '--table=public.controlled_stock_engine_manifests', 'postgres'], timeout=30).decode()
    make(database); rows(schema + '\n' + technical, database)
    rows('select controlled_stock_manifest_required();insert into native_return_policy_state values(true,0,null);', database)
    fixture = (root / 'supabase/tests/native_fulfillment.test.sql').read_text()
    needle = "insert into data select 'target',"
    assert fixture.count(needle) == 1
    prefix = fixture[:fixture.index(needle)] + '\ncommit;\n'
    config = (source / 'native-config.sql').read_text()
    cut = 'insert into controlled_stock_openings('
    assert config.count(cut) == 1
    config = config[:config.index(cut)]
    acceptance = (source / 'opening-boundary-acceptance.sql').read_text()
    assert acceptance.count('-- OWNED_PRIVATE_CONFIGURATION --') == 1
    commit_refusal = acceptance.split('-- COMMIT_REFUSAL_BEGIN\n')[1].split('\n-- COMMIT_REFUSAL_END')[0]
    managed_append = acceptance.split('-- MANAGED_APPEND_BEGIN\n')[1].split('\n-- MANAGED_APPEND_END')[0]
    acceptance = acceptance.split('-- COMMIT_REFUSAL_BEGIN')[0]
    acceptance = acceptance.replace('-- OWNED_PRIVATE_CONFIGURATION --', config)
    output = rows(prefix + acceptance, database)
    proof = json.loads(next(line for line in reversed(output.splitlines()) if line.startswith('{')))
    assert proof['kind'] == 'controlled-opening-boundary-acceptance' and proof['rejected_cases'] > 0
    populated = snapshot(database)
    # The explicit COMMIT refusal runs outside a catch-all SQL subtransaction.
    rejection = sql(commit_refusal, database, True)
    assert rejection.returncode != 0 and '23514' in rejection.stderr
    assert 'Opening available cells must match original opening movement net exactly' in rejection.stderr
    assert 'OWNED_INVALID_FIXTURE_READY_FOR_COMMIT' in rejection.stdout, 'Refusal must occur at COMMIT after valid inserts'
    assert snapshot(database) == populated
    proof['unattached_invalid_opening_commit_refused'] = True
    managed_output = rows(managed_append, database)
    managed = json.loads(next(line for line in reversed(managed_output.splitlines()) if line.startswith('{')))
    assert managed['managed_canonical_actions'] == 2 and managed['managed_prefix_sql_assertions'] == 4
    proof.update(managed)
    populated = snapshot(database)
    make(restored); rows(dump(database), restored)
    assert snapshot(restored) == populated
    rows("select set_config('request.jwt.claims','{}',false);select controlled_stock_manifest_required();"
         'select controlled_stock_validate_opening(id)from controlled_stock_openings;'
         'select controlled_stock_validate_product(product_id)from controlled_stock_states;'
         'select controlled_stock_validate_event(id)from controlled_stock_events;', restored)
    assert snapshot(restored) == populated
    retirement = rows("begin;delete from auth.sessions;"
        "do $$begin if exists(select 1 from auth.sessions)then raise exception 'Historical sessions remain in restored validation';end if;end$$;"
        "select 'OWNED_RESTORED_HISTORICAL_SESSIONS_ABSENT';"
        "select set_config('request.jwt.claims','{}',true);select controlled_stock_manifest_required();"
        'select controlled_stock_validate_opening(id)from controlled_stock_openings;'
        'select controlled_stock_validate_product(product_id)from controlled_stock_states;'
        'select controlled_stock_validate_event(id)from controlled_stock_events;rollback;', restored)
    assert 'OWNED_RESTORED_HISTORICAL_SESSIONS_ABSENT' in retirement.splitlines()
    assert snapshot(restored) == populated
    assert snapshot(database) == populated and snapshot('postgres') == original
    proof.update(populated_restore_validated_without_caller_auth_context=True,
                 actual_historical_sessions_absent_during_restored_validation=True,
                 restored_session_deletion_rolled_back_exactly=True,
                 restored_exact_relation_fingerprints=len(populated), source_runtime_all_relations_unchanged=len(original),
                 synthetic_only=True, sql_only=True, genuine_auth_api=False, canonical_migration=False,
                 actual_practice_rules=False, physical_post_backup_reconciliation_proven=False,
                 storage_binary_restore_proven=False, hosted_writes=0, provider_requests=0)
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
