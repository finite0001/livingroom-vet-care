"""Reconcile all ten canonical producers in an owned, synthetic local database clone.

This is a SQL source/effect oracle, not Auth/API acceptance or a managed writer.
It never installs functions in the source database or contacts a hosted service.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local', action='store_true', required=True)
parser.add_argument('--project-config', type=Path, required=True)
args = parser.parse_args()
os.umask(0o077)
root = Path(__file__).resolve().parents[2]
project = args.project_config.resolve().parent.parent
identity = args.project_config.read_text().splitlines()[0].split('"')[1]
assert identity.startswith(('lrv-prescription-', 'lrv-controlled-engine-'))
container = 'supabase_db_' + identity
labels = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]['Config']['Labels']
assert labels['com.supabase.cli.project'] == identity
assert Path(labels['com.supabase.cli.workdir']).resolve() == project
database = 'owned_controlled_sources_' + uuid.uuid4().hex[:12]
marker = str(uuid.uuid4())
log_path = project / (database + '.log')
log = log_path.open('w')
created = False
hashes = {}


def sql(query, target='postgres', packet=False):
    argv = ['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres',
            '-d', target, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
    result = subprocess.run(argv + (['-c', query] if packet else []),
                            input=None if packet else query, capture_output=True,
                            text=True, timeout=120)
    log.write('DATABASE ' + target + '\n' + result.stdout + result.stderr + '\n')
    log.flush()
    if result.returncode or any(line.startswith('not ok ') for line in result.stdout.splitlines()):
        raise RuntimeError('Owned source reconciliation failed; protected log: ' + str(log_path))
    return result.stdout.strip()


def snapshot(target='postgres'):
    # Every ordinary table in the copied schemas, including empty tables. Keep
    # this independent of hand-maintained clinical/source relation lists.
    query = """create temp table source_snapshot(name text,value jsonb);
do $$declare r record;v jsonb;begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in('public','auth','storage','extensions')and c.relkind in('r','p')order by 1,2 loop
  execute format('select jsonb_build_object(''count'',count(*),''hash'',md5(coalesce(string_agg(to_jsonb(t)::text,''|''order by to_jsonb(t)::text),'''')))from %I.%I t',r.nspname,r.relname)into v;
  insert into source_snapshot values(r.nspname||'.'||r.relname,v);
 end loop;
end $$;
select jsonb_object_agg(name,value)from source_snapshot;"""
    return json.loads(sql(query, target).splitlines()[-1])


def read(path):
    content = path.read_bytes()
    hashes[str(path.relative_to(root))] = hashlib.sha256(content).hexdigest()
    return content.decode()


before = snapshot()
try:
    # Schema-only means no real records, sessions, provider configuration or
    # historical admissions are copied into this synthetic clone.
    dump = subprocess.check_output(['docker', 'exec', container, 'pg_dump', '-U', 'postgres',
                                   '--schema-only', '--no-owner', '--schema=public', '--schema=auth',
                                   '--schema=storage', '--schema=extensions', 'postgres'], timeout=90)
    assert len(dump) < 20 * 1024 * 1024
    schema = '\n'.join(line for line in dump.decode().splitlines()
                       if not line.startswith('ALTER DEFAULT PRIVILEGES'))
    schema = schema.replace('CREATE SCHEMA extensions;', 'CREATE SCHEMA IF NOT EXISTS extensions;')
    manifests = subprocess.check_output(['docker', 'exec', container, 'pg_dump', '-U', 'postgres',
                                        '--data-only', '--no-owner', '--table=public.stock_writer_manifests',
                                        'postgres'], timeout=30).decode()
    sql(f'create database {database};')
    created = True
    sql(f"comment on database {database} is '{marker}';")
    sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;'
        'create extension "uuid-ossp"with schema extensions;', database)
    sql(schema + '\n' + manifests, database)
    # Schema-only dumps omit the migration's disabled version-zero singleton.
    # Recreate that exact seed; never copy an existing runtime policy decision.
    policy_migration = read(root / 'supabase/migrations/20260916090000_native_dispense_returns.sql')
    seed = 'insert into public.native_return_policy_state values(true,0,null);'
    assert seed in policy_migration
    sql(seed, database)
    assert sql('select count(*)from stock_writer_manifests;', database) == '10'
    # An inactive candidate may add these private schema families. Never copy
    # or seed their actual state, policies or openings into ordinary fixtures.
    sql("""do $$declare name text;n bigint;begin
foreach name in array array['controlled_stock_states','controlled_stock_policy_versions','controlled_stock_openings']loop
 if to_regclass('public.'||name)is not null then
  execute format('select count(*)from public.%I',name)into n;
  if n<>0 then raise exception 'Ordinary source clone must not contain controlled configuration';end if;
 end if;
end loop;end $$;""", database)
    fixtures = [
        ('supabase/tests/native_fulfillment.test.sql', 'fulfillment', 'a5510000', 'b5510000'),
        ('scripts/stock-writers/rollback-probe.sql', 'stock', None, None),
        ('supabase/tests/native_return_reconciliation.test.sql', 'returns', 'a8510000', 'b8510000'),
        ('supabase/tests/native_dispense_corrections.test.sql', 'corrections', 'a7510000', 'b7510000'),
    ]
    for filename, label, actor_prefix, lot_prefix in fixtures:
        query = read(root / filename)
        assert query.rstrip().endswith('rollback;')
        if actor_prefix:
            query = query.replace('a5510000', actor_prefix).replace('b5510000', lot_prefix)
            query = query.replace('@example.test', '+source-' + label + '@example.test')
        position = query.rfind('rollback;')
        query = query[:position] + 'commit;' + query[position + len('rollback;'):]
        sql(query, database, packet=label == 'stock')
    populated = snapshot(database)
    modules = [root / 'tests/controlled-drugs/engine' / name
               for name in ['source-reader.sql', 'source-effects.sql', 'source-proof.sql']]
    output = sql('begin;set local timezone=\'UTC\';\n' + '\n'.join(read(path) for path in modules)
                 + '\nrollback;', database, packet=True)
    proof = json.loads(next(line for line in reversed(output.splitlines()) if line.startswith('{')))
    assert proof['source_producers'] == 10 and proof['canonical_operations'] == 136
    assert proof['authorizes_execution'] is False and proof['provider_requests'] == 0
    assert snapshot(database) == populated, 'Read-only oracle changed canonical rows'
    assert snapshot() == before, 'Source runtime changed during isolated proof'
    for filename, expected in hashes.items():
        assert hashlib.sha256((root / filename).read_bytes()).hexdigest() == expected
finally:
    try:
        if created:
            assert sql(f"select shobj_description(oid,'pg_database')from pg_database where datname='{database}';") == marker
            sql(f'drop database {database} with(force);')
            assert sql(f"select count(*)from pg_database where datname='{database}';") == '0'
        assert snapshot() == before, 'Source runtime changed during isolated proof'
    finally:
        log.close()
print(json.dumps({**proof, 'sql_only': True, 'project_id': identity,
                  'owned_clone_removed': True, 'source_database_unchanged': True,
                  'populated_clone_unchanged': True, 'modules_and_fixture_sha256': hashes,
                  'runner_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}))
