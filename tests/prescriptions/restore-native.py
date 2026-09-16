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
    'native_dispense_correction_events', 'native_dispense_correction_operations',
    'native_return_policy_decisions', 'native_return_policy_state', 'native_return_events',
    'native_return_operations', 'native_return_stock_links',
    'native_return_compensation_links', 'native_return_discrepancy_events',
    'native_return_discrepancy_operations', 'native_return_discrepancy_correction_links',
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


def correction_evidence_query():
    # Stable private readers verify canonical operation/event/parent chains. No
    # public preview calls or write locks are taken in the exported read snapshot.
    return """with targets as (
      select distinct authorization_id,pet_id,dispense_id
      from public.native_dispense_correction_events
    ), chains as (
      select dispense_id,public.native_correction_verified(authorization_id,pet_id,dispense_id) evidence
      from targets
    ), authors as (
      select distinct authorization_id from targets
    ) select jsonb_build_object(
      'chains',(select count(*) from chains),
      'events',(select count(*) from public.native_dispense_correction_events),
      'verified',(select coalesce(bool_and(evidence is not null),false) from chains),
      'chain_sha256',public.native_fulfillment_hash((select coalesce(jsonb_agg(jsonb_build_object('dispense_id',dispense_id,'evidence',evidence) order by dispense_id),'[]') from chains)),
      'summary_sha256',public.native_fulfillment_hash((select coalesce(jsonb_agg(jsonb_build_object('authorization_id',authorization_id,'summary',public.native_correction_summary(authorization_id)) order by authorization_id),'[]') from authors)),
      'schema11_releases',(select count(*) from public.record_releases where snapshot->>'schema_version'='11'),
      'schema11_sha256',public.native_fulfillment_hash((select coalesce(jsonb_agg(jsonb_build_object('id',id,'snapshot',snapshot,'hash',source_hash) order by id),'[]') from public.record_releases where snapshot->>'schema_version'='11'))
    );"""


def correction_boundaries_query():
    return """select jsonb_build_object(
      'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'policies',(select coalesce(jsonb_agg(pg_get_expr(p.polqual,p.polrelid) order by p.polname),'[]') from pg_policy p where p.polrelid=c.oid),'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid,true) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('native_dispense_correction_events','native_dispense_correction_operations')),
      'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'security_definer',p.prosecdef,'volatility',p.provolatile,'acl',(select coalesce(jsonb_agg(a::text order by a::text),'[]') from unnest(coalesce(p.proacl,acldefault('f',p.proowner))) a)) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'native_correction_%' or p.proname in('preview_native_dispense_correction','append_native_dispense_correction','recover_native_dispense_correction','read_native_dispense_corrections','list_native_dispense_corrections','read_native_prescription_print_v2','release_preview_v11_internal','preview_record_release_v11')))
    );"""


def return_evidence_query():
    return """with targets as (
      select distinct authorization_id,pet_id,dispense_id from public.native_return_events
      union select distinct authorization_id,pet_id,dispense_id from public.native_return_discrepancy_events
    ), chains as (
      select dispense_id,public.native_reconciliation_verified(authorization_id,pet_id,dispense_id) evidence from targets
    ), authors as (select distinct authorization_id from targets)
    select jsonb_build_object(
      'chains',(select count(*) from chains),
      'events',(select count(*) from public.native_return_events),
      'v1_events',(select count(*) from public.native_return_events where document->>'version'='1'),
      'v2_events',(select count(*) from public.native_return_events where document->>'version'='2'),
      'discrepancy_events',(select count(*) from public.native_return_discrepancy_events),
      'held_lots',(select count(*) from public.inventory_lots where public.native_reconciliation_lot_held(id)),
      'hold_sha256',public.native_fulfillment_hash((select coalesce(jsonb_agg(id order by id),'[]') from public.inventory_lots where public.native_reconciliation_lot_held(id))),
      'negative_compensations',(select count(*) from public.inventory_movements where kind='native_return_compensation'),
      'compensation_links',(select count(*) from public.native_return_compensation_links),
      'invalid_compensation_links',(select count(*) from public.native_return_compensation_links l left join public.inventory_movements m on m.id=l.movement_id left join public.native_return_events e on e.id=l.event_id left join public.native_return_stock_links original on original.event_id=l.target_event_id and original.allocation_id=l.allocation_id left join public.inventory_movements positive on positive.id=l.original_movement_id where m.id is null or e.id is null or original.id is null or positive.id is null or m.kind is distinct from 'native_return_compensation' or m.quantity is distinct from -l.quantity or m.quantity>=0 or m.lot_id is distinct from l.lot_id or original.lot_id is distinct from l.lot_id or original.movement_id is distinct from positive.id or positive.kind is distinct from 'native_return' or e.action is distinct from 'retract_restock' or e.document#>>'{correction_target,event_id}' is distinct from l.target_event_id::text or m.created_by is distinct from e.actor_id or m.created_at is distinct from e.created_at),
      'unlinked_negative_compensations',(select count(*) from public.inventory_movements m where m.kind='native_return_compensation' and not exists(select 1 from public.native_return_compensation_links l where l.movement_id=m.id)),
      'schema13_releases',(select count(*) from public.record_releases where snapshot->>'schema_version'='13'),
      'schema13_sha256',public.native_fulfillment_hash((select coalesce(jsonb_agg(jsonb_build_object('id',id,'snapshot',snapshot,'hash',source_hash) order by id),'[]') from public.record_releases where snapshot->>'schema_version'='13')),
      'verified',(select coalesce(bool_and(evidence is not null),false) from chains),
      'chain_sha256',public.native_fulfillment_hash((select coalesce(jsonb_agg(jsonb_build_object('dispense_id',dispense_id,'evidence',evidence) order by dispense_id),'[]') from chains)),
      'summary_sha256',public.native_fulfillment_hash((select coalesce(jsonb_agg(jsonb_build_object('authorization_id',authorization_id,'summary',public.native_reconciliation_summary(authorization_id)) order by authorization_id),'[]') from authors)),
      'policies_verified',(select coalesce(bool_and(public.native_return_policy_verified(version)=document),false) from public.native_return_policy_decisions),
      'current_policy_sha256',public.native_fulfillment_hash(public.native_return_policy_verified()),
      'positive_movements',(select count(*) from public.inventory_movements where kind='native_return'),
      'stock_links',(select count(*) from public.native_return_stock_links),
      'invalid_stock_links',(select count(*) from public.native_return_stock_links l left join public.inventory_movements m on m.id=l.movement_id left join public.native_return_events e on e.id=l.event_id left join public.native_dispense_allocations a on a.id=l.allocation_id where m.id is null or e.id is null or a.id is null or m.kind is distinct from 'native_return' or m.quantity is distinct from l.quantity or m.quantity<=0 or m.lot_id is distinct from l.lot_id or a.lot_id is distinct from l.lot_id or a.dispense_id is distinct from e.dispense_id or e.action is distinct from 'restock' or m.created_by is distinct from e.actor_id or m.created_at is distinct from e.created_at),
      'unlinked_positive_movements',(select count(*) from public.inventory_movements m where m.kind='native_return' and not exists(select 1 from public.native_return_stock_links l where l.movement_id=m.id)),
      'schema12_releases',(select count(*) from public.record_releases where snapshot->>'schema_version'='12'),
      'schema12_sha256',public.native_fulfillment_hash((select coalesce(jsonb_agg(jsonb_build_object('id',id,'snapshot',snapshot,'hash',source_hash) order by id),'[]') from public.record_releases where snapshot->>'schema_version'='12'))
    );"""


def return_boundaries_query():
    return """select jsonb_build_object(
      'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'triggers',(select coalesce(jsonb_agg(pg_get_triggerdef(t.oid,true) order by t.tgname),'[]') from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and (c.relname in('native_return_policy_decisions','native_return_policy_state','native_return_events','native_return_operations','native_return_stock_links','native_return_compensation_links','native_return_discrepancy_events','native_return_discrepancy_operations','native_return_discrepancy_correction_links','inventory_movements'))),
      'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'security_definer',p.prosecdef,'volatility',p.provolatile,'acl',(select coalesce(jsonb_agg(a::text order by a::text),'[]') from unnest(coalesce(p.proacl,acldefault('f',p.proowner))) a)) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'native_return_%' or p.proname like 'native_reconciliation_%' or p.proname in('read_native_return_policy','configure_native_return_policy','recover_native_return_policy','preview_native_dispense_return','record_native_dispense_return','recover_native_dispense_return','read_native_dispense_returns','list_native_dispense_returns','read_native_return_intake','read_native_prescription_print_v3','release_preview_v12_internal','preview_record_release_v12','preview_native_dispense_return_v2','record_native_dispense_return_v2','recover_native_dispense_return_v2','read_native_dispense_returns_v2','read_native_return_intake_v2','list_native_dispense_returns_v2','preview_native_return_discrepancy','record_native_return_discrepancy','recover_native_return_discrepancy','read_native_prescription_print_v4','release_preview_v13_internal','preview_record_release_v13','list_record_release_sources_v13','select_all_record_release_sources_v13')))
    );"""


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
    before_corrections = json.loads(snapshot_sql(correction_evidence_query()))
    before_correction_boundaries = json.loads(snapshot_sql(correction_boundaries_query()))
    before_returns = json.loads(snapshot_sql(return_evidence_query()))
    before_return_boundaries = json.loads(snapshot_sql(return_boundaries_query()))
    check(before_returns['chains'] > 0 and before_returns['verified'], 'Populated verified return chains required')
    check(before_returns['schema12_releases'] > 0, 'Populated schema12 return release evidence required')
    check(before_returns['schema13_releases'] > 0, 'Populated schema13 reconciliation release evidence required')
    check(before_returns['v1_events'] > 0 and before_returns['v2_events'] > 0, 'Both historical v1 and current v2 return evidence required')
    check(before_returns['discrepancy_events'] > 0 and before['native_return_discrepancy_operations']['rows'] == before_returns['discrepancy_events'], 'Each populated discrepancy decision requires an immutable operation')
    check(before_returns['held_lots'] > 0, 'Populated unresolved physical lot hold required')
    check(before['native_return_discrepancy_correction_links']['rows'] > 0, 'Populated discrepancy resolution must link actual compensation')
    check(before_returns['negative_compensations'] > 0 and before_returns['negative_compensations'] == before_returns['compensation_links'] and before_returns['invalid_compensation_links'] == 0 and before_returns['unlinked_negative_compensations'] == 0, 'Each populated negative compensation requires exact source positive movement linkage')
    check(before_returns['policies_verified'], 'Historical return policy decisions must verify')
    check(before_returns['positive_movements'] > 0 and before_returns['positive_movements'] == before_returns['stock_links']
          and before_returns['invalid_stock_links'] == 0 and before_returns['unlinked_positive_movements'] == 0,
          'Populated restock must have exact bidirectional movement links')
    check(before['native_return_operations']['rows'] == before_returns['events'], 'Every return event requires an operation receipt')
    check(all(row['rls'] for row in before_return_boundaries['tables']), 'Return and stock ledger RLS must be enabled')
    check(before_corrections['chains'] > 0 and before_corrections['events'] > 0 and before_corrections['verified'],
          'Populated verified correction chains required')
    check(before_corrections['schema11_releases'] > 0, 'Populated schema11 corrected-release evidence required')
    check(before['native_dispense_correction_operations']['rows'] == before_corrections['events'],
          'Every populated correction has an immutable operation receipt')
    check(all(row['rls'] for row in before_correction_boundaries['tables']), 'Correction ledger RLS must be enabled')
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
        ('native_return_operations', "case result->>'version' when '1' then jsonb_build_object('version',1,'actor_id',actor_id,'operation','record_native_dispense_return','request',request) when '2' then jsonb_build_object('version',2,'actor_id',actor_id,'operation','record_native_dispense_return_v2','request',request) else null end"),
        ('native_return_discrepancy_operations', "jsonb_build_object('version',1,'actor_id',actor_id,'operation','record_native_return_discrepancy','request',request)"),
        ('native_return_policy_decisions', "jsonb_build_object('version',1,'actor_id',actor_id,'operation','configure_native_return_policy','request',request)"),
        ('native_dispense_correction_operations', "jsonb_build_object('version',1,'actor_id',actor_id,'operation','append_native_dispense_correction','request',request)"),
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
    restored_corrections = json.loads(sql(correction_evidence_query(), restored))
    check(restored_corrections == before_corrections,
          'Restored correction chains, immutable receipts, summaries and schema11 snapshots must verify exactly')
    check(json.loads(sql(correction_boundaries_query(), restored)) == before_correction_boundaries,
          'Correction RLS, immutability triggers and private/public function grants must survive restore')
    restored_returns = json.loads(sql(return_evidence_query(), restored))
    check(restored_returns == before_returns, 'Restored return chains, balances, policy, positive/negative stock links, lot holds, discrepancy decisions and schema12/13 evidence must verify exactly')
    check(json.loads(sql(return_boundaries_query(), restored)) == before_return_boundaries,
          'Return RLS, immutable/deferred stock-link triggers and private/public function grants must survive restore')
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
               'verified_correction_evidence': restored_corrections,
               'correction_boundaries_verified': True,
               'verified_return_evidence': restored_returns, 'return_boundaries_verified': True,
               'runner_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    print(json.dumps(summary, sort_keys=True))
