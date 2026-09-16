"""Verify populated native records in an owned local schema/data restore; no Storage binaries."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import tempfile
import tomllib
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local', action='store_true', required=True)
parser.add_argument('--project-config', type=Path, required=True)
args = parser.parse_args()
config_path = args.project_config.resolve()
with config_path.open('rb') as config_file:
    project_id = tomllib.load(config_file)['project_id']
if not project_id.startswith('lrv-prescription-') or not all(c.isalnum() or c in '-_' for c in project_id):
    raise SystemExit('An explicitly owned lrv-prescription-* local project is required')
container = 'supabase_db_' + project_id
os.umask(0o077)
work = Path(tempfile.mkdtemp(prefix='lrv-native-restore-'))
log_path = work / 'commands.log'
log = log_path.open('w')
database = 'lrv_native_restore_' + uuid.uuid4().hex
marker = 'owned-native-restore-' + uuid.uuid4().hex
snapshot_tag = 'lrv_native_restore_snapshot_' + uuid.uuid4().hex
source = ['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']
restored = source.copy()
restored[restored.index('-d') + 1] = database
checks = 0
snapshot_process = None
created = False
project_verified = False
cleanup_verified = False
success = False
# Entire rows are compared, including request/context/artifact hashes and ledger references.
tables = [
    'native_fill_slots', 'native_dispenses', 'native_dispense_allocations',
    'native_slot_closures', 'native_pickups', 'native_fulfillment_events',
    'native_fulfillment_operations', 'native_prescriber_configurations',
    'native_prescription_authorizations', 'native_prescription_authorization_events',
    'native_prescription_operations', 'native_prescription_drafts',
    'native_prescription_draft_revisions', 'native_refills', 'native_refill_events',
    'native_refill_operations', 'refill_requests', 'inventory_movements',
    'inventory_lots', 'catalog_products', 'billing_invoice_items', 'billing_invoices',
    'record_releases', 'record_release_sources', 'record_release_events',
]


def check(condition, label):
    global checks
    if not condition:
        raise RuntimeError(label)
    checks += 1


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def command(argv, *, query=None, stdout=None, timeout=60):
    # Never echo pg_dump, restored rows, COPY failure content or SQL to the console.
    result = subprocess.run(argv, input=query, text=True, stdout=stdout or subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=timeout)
    if result.stderr:
        log.write(result.stderr)
        log.flush()
    if result.returncode:
        raise RuntimeError('Local restore command failed; details retained in protected log ' + str(log_path))
    return result.stdout if stdout is None else None


def sql(query, target=source):
    return command(target, query=query).strip()


def verify_project():
    details = json.loads(command(['docker', 'inspect', container]))[0]
    labels = details['Config']['Labels']
    check(labels.get('com.supabase.cli.project') == project_id, 'Exact Docker project label required')
    check(Path(labels.get('com.supabase.cli.workdir', '')).resolve() == config_path.parent.parent,
          'Exact owned project configuration directory required')


def snapshot_sql(query):
    return sql('begin isolation level repeatable read read only;set transaction snapshot ' + quote(snapshot) + ';' + query + 'commit;')


def manifest_query():
    entries = []
    for table in tables:
        entries.append("select " + quote(table) + " name,count(*) n,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]')::text,'UTF8')),'hex') fingerprint from public." + table + ' t')
    return "select jsonb_object_agg(name,jsonb_build_object('rows',n,'sha256',fingerprint)) from (" + ' union all '.join(entries) + ') m;'


def constraints_query():
    return "select coalesce(jsonb_agg(jsonb_build_object('table',r.relname,'name',c.conname,'kind',c.contype,'validated',c.convalidated,'definition',pg_get_constraintdef(c.oid,true)) order by r.relname,c.conname),'[]') from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace where n.nspname='public' and r.relname in (" + ','.join(map(quote, tables)) + ") and c.contype in ('f','p','u','c');"


def grants_query():
    return "select coalesce(jsonb_agg(jsonb_build_object('table',r.relname,'owner',pg_get_userbyid(r.relowner),'acl',(select coalesce(jsonb_agg(a::text order by a::text),'[]') from unnest(coalesce(r.relacl,acldefault('r',r.relowner))) a)) order by r.relname),'[]') from pg_class r join pg_namespace n on n.oid=r.relnamespace where n.nspname='public' and r.relname in (" + ','.join(map(quote, tables)) + ");"


try:
    verify_project()
    project_verified = True
    # One exported MVCC snapshot covers BOTH comparison reads and pg_dump. Source is read-only.
    snapshot_process = subprocess.Popen(source, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=log, text=True, bufsize=1)
    snapshot_process.stdin.write("set application_name=" + quote(snapshot_tag) + ";begin isolation level repeatable read read only;select pg_export_snapshot();\n")
    snapshot_process.stdin.flush()
    selector = selectors.DefaultSelector()
    selector.register(snapshot_process.stdout, selectors.EVENT_READ)
    try:
        if not selector.select(timeout=30):
            raise RuntimeError('Timed out obtaining owned read-only source snapshot')
        snapshot = snapshot_process.stdout.readline().strip()
    finally:
        selector.close()
    check(bool(snapshot) and all(c in '0123456789ABCDEFabcdef-' for c in snapshot), 'Valid exported source snapshot required')
    before = json.loads(snapshot_sql(manifest_query()))
    before_constraints = json.loads(snapshot_sql(constraints_query()))
    before_grants = json.loads(snapshot_sql(grants_query()))
    check(before['native_dispenses']['rows'] > 0, 'Populated saved dispenses required; empty restore is not acceptance')
    check(before['native_fulfillment_operations']['rows'] > 0, 'Populated operation receipts required')
    check(all(c['validated'] for c in before_constraints), 'Source constraints must already be validated')
    dump_path = work / 'source.sql'
    with dump_path.open('w') as dump_file:
        command(['docker', 'exec', container, 'pg_dump', '-U', 'postgres', '--no-owner',
                 '--schema=public', '--schema=auth', '--schema=storage', '--schema=extensions',
                 '--snapshot=' + snapshot, 'postgres'], stdout=dump_file, timeout=180)
    check(dump_path.stat().st_size > 0, 'Nonempty schema/data dump required')
    snapshot_process.stdin.write('rollback;\n')
    snapshot_process.stdin.close()
    snapshot_process.wait(timeout=30)
    check(snapshot_process.returncode == 0, 'Source read-only snapshot released')
    snapshot_process = None
    check(sql('select count(*) from pg_database where datname=' + quote(database) + ';') == '0', 'Scratch name must be absent')
    sql('create database "' + database + '";')
    created = True
    sql('comment on database "' + database + '" is ' + quote(marker) + ';')
    sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;', restored)
    dump = dump_path.read_text().replace('CREATE SCHEMA extensions;', 'CREATE SCHEMA IF NOT EXISTS extensions;')
    # Keep the canonical private dump byte-for-byte. Restricted local postgres cannot
    # ALTER another role's future-object defaults; omit only those statements from
    # the restore stream and independently compare all selected tables' actual ACLs.
    default_privilege_lines = [line for line in dump.splitlines() if line.startswith('ALTER DEFAULT PRIVILEGES ')]
    check(all(line.endswith(';') for line in default_privilege_lines), 'Only complete default-privilege statements may be omitted')
    dump = '\n'.join(line for line in dump.splitlines() if not line.startswith('ALTER DEFAULT PRIVILEGES '))
    command(restored, query=dump, timeout=240)
    check(json.loads(sql(grants_query(), restored)) == before_grants, 'Actual selected table owners and grants must survive restore')
    after = json.loads(sql(manifest_query(), restored))
    for table in tables:
        check(after[table] == before[table], 'Exact restored rows differ for ' + table)
    after_constraints = json.loads(sql(constraints_query(), restored))
    check(after_constraints == before_constraints, 'Restored FK/primary/unique/check constraint definitions differ')
    check(all(c['validated'] for c in after_constraints), 'Restored constraints must be validated')
    # Recompute every request receipt hash according to its actual versioned SQL contract.
    for table, basis in [
        ('native_prescription_operations', "jsonb_build_object('version',1,'actor_id',actor_id,'operation',operation,'request',request)"),
        ('native_fulfillment_operations', "jsonb_build_object('version',1,'actor_id',actor_id,'operation',operation,'request',request)"),
        ('native_refill_operations', 'request'),
    ]:
        invalid = sql("select count(*) from public." + table + " where request_hash is distinct from encode(sha256(convert_to((" + basis + ")::text,'UTF8')),'hex');", restored)
        check(invalid == '0', 'Restored operation request hash differs for ' + table)
    verified = json.loads(sql("select jsonb_build_object('count',count(*),'all_equal',coalesce(bool_and(public.native_fulfillment_verified_dispense(id)=document),false)) from public.native_dispenses;", restored))
    check(verified['count'] == before['native_dispenses']['rows'] and verified['all_equal'],
          'Restored saved dispense snapshots, allocation/movement links and invoice item links must verify')
    # Stronger evidence than row counts: exact source/restored authorization verification too.
    check(sql("select count(*) from public.native_prescription_authorizations where public.native_rx_verified_authorization(id) is distinct from document;", restored) == '0',
          'Restored immutable authorization signatures/context/artifacts must verify')
    check(sql("select count(*) from public.record_releases where source_hash is distinct from encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');", restored) == '0',
          'Restored record-release snapshots retain their exact source fingerprints')
    success = True
finally:
    cleanup_errors = []
    # Attempt each cleanup independently: a failed Docker-client shutdown must
    # never prevent the separately marked scratch database cleanup.
    try:
        if snapshot_process is not None and snapshot_process.poll() is None:
            try:
                snapshot_process.stdin.write('rollback;\n')
                snapshot_process.stdin.close()
                snapshot_process.wait(timeout=15)
            except (BrokenPipeError, ValueError, subprocess.TimeoutExpired):
                snapshot_process.kill()
                snapshot_process.wait(timeout=15)
    except Exception as error:
        cleanup_errors.append('snapshot client cleanup')
        log.write('Snapshot client cleanup failed: ' + type(error).__name__ + '\n')
    try:
        if project_verified:
            # Target only this run's client session, never background workers.
            owned_snapshot = ("application_name=" + quote(snapshot_tag)
                              + " and datname='postgres' and usename=current_user"
                              + " and backend_type='client backend' and pid<>pg_backend_pid()")
            sql('select pg_terminate_backend(pid) from pg_stat_activity where ' + owned_snapshot + ';')
            check(sql('select count(*) from pg_stat_activity where application_name=' + quote(snapshot_tag) + ';') == '0',
                  'Owned source snapshot session removed')
    except Exception as error:
        cleanup_errors.append('snapshot backend cleanup')
        log.write('Snapshot backend cleanup failed: ' + type(error).__name__ + '\n')
    try:
        if created:
            verify_project()
            check(sql("select shobj_description(oid,'pg_database') from pg_database where datname=" + quote(database) + ';') == marker,
                  'Exact scratch ownership marker required for cleanup')
            # All current-user clients in this UUID/marker-owned scratch DB are
            # ours. Autovacuum/background workers are handled by DROP DATABASE.
            sql('select pg_terminate_backend(pid) from pg_stat_activity where datname=' + quote(database)
                + " and usename=current_user and backend_type='client backend' and pid<>pg_backend_pid();")
            # PGOPTIONS applies to this dedicated connection; DROP must remain a
            # standalone statement rather than an implicit multi-command transaction.
            drop_command = source.copy()
            drop_command[drop_command.index('-i') + 1:drop_command.index('-i') + 1] = ['-e', 'PGOPTIONS=-c statement_timeout=30000']
            command(drop_command, query='drop database "' + database + '";', timeout=35)
            check(sql('select count(*) from pg_database where datname=' + quote(database) + ';') == '0', 'Owned scratch database removed')
    except Exception as error:
        cleanup_errors.append('scratch database cleanup')
        log.write('Scratch cleanup failed: ' + type(error).__name__ + '\n')
    finally:
        cleanup_verified = not cleanup_errors
        log.close()
        if success and cleanup_verified:
            shutil.rmtree(work)
    if cleanup_errors:
        raise RuntimeError('Owned local cleanup incomplete (' + ', '.join(cleanup_errors)
                           + '); protected log: ' + str(log_path))

if success:
    summary = {'suite': 'native-populated-database-restore', 'synthetic_only': True,
               'project_id': project_id, 'checks_passed': checks, 'cleanup_verified': cleanup_verified,
               'provider_requests': 0, 'source_mutated': False, 'storage_binary_coverage': False,
               'default_privilege_statements_omitted': len(default_privilege_lines),
               'future_object_default_privileges_restored': False, 'selected_table_grants_verified': True,
               'scope': 'Selected native clinical/operational and stock/billing rows with schema/data restore; not full commercial disaster recovery',
               'tables': before, 'verified_dispenses': verified['count'],
               'runner_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    print(json.dumps(summary, sort_keys=True))
