"""Canonical migration replay and genuine scheduling proof in a uniquely owned local runtime."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local', action='store_true', required=True)
parser.add_argument('--include-sql-regression', action='store_true')
parser.add_argument('--staff-only', action='store_true', help='Focused local staff verification after parent checks have passed')
args = parser.parse_args()
assert not (os.environ.get("CI")=="true" and args.staff_only), "CI must include all scheduling layers"
root = Path(__file__).resolve().parents[2]
os.umask(0o077)
identity = 'lrv-catalog-' + uuid.uuid4().hex[:10]
work = Path(tempfile.mkdtemp(prefix=identity + '-'))
project = work / 'project'
(project / 'supabase/migrations').mkdir(parents=True)
log = (work / 'commands.log').open('w')
started = success = False

def command(argv, timeout=300, **kwargs):
    result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, **kwargs)
    log.write(str(argv) + '\n' + result.stdout + result.stderr + '\n'); log.flush()
    if result.returncode:
        if os.environ.get('CI') == 'true' and argv[0] == 'node':
            diagnostic = re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[REDACTED JWT]', result.stderr)
            diagnostic = re.sub(r'sb_(?:secret|publishable)_[A-Za-z0-9_-]+', '[REDACTED KEY]', diagnostic)
            print(diagnostic[-4000:], flush=True)
        raise RuntimeError('Owned scheduling proof failed; protected log: ' + str(work / 'commands.log'))
    return result.stdout

def verify():
    labels = json.loads(command(['docker','inspect','supabase_db_' + identity]))[0]['Config']['Labels']
    assert labels['com.supabase.cli.project'] == identity
    assert Path(labels['com.supabase.cli.workdir']).resolve() == project.resolve()
    assert (project/'supabase/config.toml').read_text().startswith('project_id = "' + identity + '"\n')

try:
    for port in [47220,47221,47222,47224,47281]:
        with socket.socket() as sock: sock.bind(('127.0.0.1', port))
    hashes = {}
    for migration in sorted((root/'supabase/migrations').glob('*.sql')):
        assert re.match(r'^\d{14}_', migration.name)
        hashes[migration.name] = hashlib.sha256(migration.read_bytes()).hexdigest()
        shutil.copy2(migration, project/'supabase/migrations'/migration.name)
    assert len(hashes) == 189 and '20261013181721_appointment_catalog_and_bindings.sql' in hashes and '20261013214300_catalog_patient_eligibility_lock.sql' in hashes and '20261013220500_next_visit_outcomes.sql' in hashes and '20261013233839_next_visit_staff_recovery.sql' in hashes and '20261014022511_operational_tasks.sql' in hashes and '20261014154223_operational_task_reconciliation.sql' in hashes and '20261014202235_supplier_product_identity.sql' in hashes and '20261015011200_controlled_draft_configuration.sql' in hashes and '20261015020722_stock_writer_provenance.sql' in hashes and '20261015055007_native_custody_provenance.sql' in hashes
    if args.include_sql_regression: shutil.copytree(root/'supabase/tests', project/'supabase/tests')
    harness = root/'tests/scheduling/catalog-local.ts'
    harness_hash = hashlib.sha256(harness.read_bytes()).hexdigest()
    (project/'supabase/config.toml').write_text(f'''project_id = "{identity}"
[api]
port = 47221
[db]
port = 47222
shadow_port = 47220
major_version = 17
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
port = 47224
[auth]
site_url = "http://127.0.0.1:47281"
enable_signup = false
[storage]
enabled = true
[edge_runtime]
enabled = false
''')
    started = True
    print('Starting uniquely owned scheduling runtime; private status withheld.', flush=True)
    command(['supabase','start','--workdir',str(project),'--exclude','realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'], timeout=600)
    verify()
    if args.include_sql_regression:
        result = command(['supabase','test','db','--workdir',str(project)], cwd=root)
        assert 'All tests successful.' in result and 'Files=155, Tests=6540' in result
        print('Canonical SQL regression passed: 155 files /6540 assertions.', flush=True)
    # Rehearse the exact staged/primary rollback probe while the freshly replayed
    # policy is still empty, before any Auth/browser acceptance changes it.
    probe = root/'scripts/task-reconciliation/rollback-probe.sql'
    probe_hash = hashlib.sha256(probe.read_bytes()).hexdigest()
    output = command(['docker','exec','-i','supabase_db_'+identity,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input=probe.read_text())
    rollback_receipt = json.loads(next(line for line in reversed(output.splitlines())if line.startswith('{"checks"')))
    assert rollback_receipt == {'checks':36,'provider_requests':0,'rollback_only':True}
    assert hashlib.sha256(probe.read_bytes()).hexdigest()==probe_hash
    print('Exact hosted rollback probe rehearsed:36 checks; no provider request or persisted fixture.',flush=True)
    identity_probe = root/'scripts/inventory-identity/rollback-probe.sql'
    identity_probe_hash = hashlib.sha256(identity_probe.read_bytes()).hexdigest()
    output = command(['docker','exec','-i','supabase_db_'+identity,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input=identity_probe.read_text())
    identity_rollback = json.loads(next(line for line in reversed(output.splitlines())if line.startswith('{"checks"')))
    assert identity_rollback == {'checks':31,'provider_requests':0,'rollback_only':True}
    assert hashlib.sha256(identity_probe.read_bytes()).hexdigest()==identity_probe_hash
    print('Exact supplier identity hosted rollback probe rehearsed:31 checks;no persisted fixture.',flush=True)
    controlled_probe = root/'scripts/controlled-drafts/rollback-probe.sql'
    controlled_probe_hash = hashlib.sha256(controlled_probe.read_bytes()).hexdigest()
    output = command(['docker','exec','-i','supabase_db_'+identity,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input=controlled_probe.read_text())
    controlled_rollback = json.loads(next(line for line in reversed(output.splitlines())if line.startswith('{"checks"')))
    assert controlled_rollback == {'checks':28,'provider_requests':0,'rollback_only':True}
    assert hashlib.sha256(controlled_probe.read_bytes()).hexdigest()==controlled_probe_hash
    print('Exact controlled-draft hosted rollback probe rehearsed:28 checks;no persisted fixture.',flush=True)
    env = {**os.environ, 'SCHEDULING_TEST_PROJECT': str(project), 'SCHEDULING_RUN_SYNTHETIC_LOCAL': 'true'}
    if not args.staff_only:
        result = command(['node','--experimental-strip-types',str(harness)], cwd=root, env=env, timeout=420)
        match = re.search(r'Genuine local appointment catalog passed: \d+ checks; 7 observed lock queues; 20 browser checks; 9 populated restore checks; no provider requests\.', result)
        assert match, result[-1000:]
        assert hashlib.sha256(harness.read_bytes()).hexdigest() == harness_hash
        assert all(hashlib.sha256((root/'supabase/migrations'/name).read_bytes()).hexdigest() == digest for name,digest in hashes.items())
        print(match.group(0), flush=True)
        next_harness = root/'tests/scheduling/next-visit-local.ts'
        next_hash = hashlib.sha256(next_harness.read_bytes()).hexdigest()
        result = command(['node','--experimental-strip-types',str(next_harness)], cwd=root, env=env, timeout=240)
        match = re.search(r'Genuine local next-visit foundation passed: \d+ checks; 6 observed lock queues; populated outcome restore; no provider requests\.', result)
        assert match, result[-1000:]
        assert hashlib.sha256(next_harness.read_bytes()).hexdigest() == next_hash
        assert all(hashlib.sha256((root/'supabase/migrations'/name).read_bytes()).hexdigest() == digest for name,digest in hashes.items())
        print(match.group(0), flush=True)
    staff_harness = root/'tests/scheduling/next-visit-staff-local.ts'
    staff_hash = hashlib.sha256(staff_harness.read_bytes()).hexdigest()
    result = command(['node','--experimental-strip-types',str(staff_harness)], cwd=root, env=env, timeout=420)
    match = re.search(r'Genuine local next-visit staff passed: \d+ checks; \d+ browser checks; no provider requests\.', result)
    assert match, result[-1000:]
    assert hashlib.sha256(staff_harness.read_bytes()).hexdigest() == staff_hash
    print(match.group(0), flush=True)
    task_harness = root/'tests/scheduling/operational-tasks-local.ts'
    task_hash = hashlib.sha256(task_harness.read_bytes()).hexdigest()
    task_browser = root/'tests/scheduling/operational-tasks-browser.ts'
    task_browser_hash = hashlib.sha256(task_browser.read_bytes()).hexdigest()
    result = command(['node','--experimental-strip-types',str(task_harness)], cwd=root, env=env, timeout=420)
    match = re.search(r'Genuine local operational tasks passed: \d+ checks; 2 observed lock queues; \d+ browser checks; populated task restore; no provider requests\.', result)
    assert match, result[-1000:]
    assert hashlib.sha256(task_harness.read_bytes()).hexdigest() == task_hash
    assert hashlib.sha256(task_browser.read_bytes()).hexdigest() == task_browser_hash
    assert all(hashlib.sha256((root/'supabase/migrations'/name).read_bytes()).hexdigest() == digest for name,digest in hashes.items())
    print(match.group(0), flush=True)
    reconciliation = root/'tests/scheduling/operational-reconciliation-local.ts'
    reconciliation_hash = hashlib.sha256(reconciliation.read_bytes()).hexdigest()
    result = command(['node','--experimental-strip-types',str(reconciliation)], cwd=root,
                     env={**env,'RECONCILIATION_TEST_PROJECT':str(project),'RECONCILIATION_RUN_SYNTHETIC_LOCAL':'true'}, timeout=180)
    receipt = json.loads(result.strip().splitlines()[-1])
    assert receipt['api_checks']==42 and receipt['real_auth_postgrest'] and receipt['owned_accounts_deactivated'] and receipt['private_timeout_helper_restored'] and receipt['provider_requests']==0
    assert receipt['http']['actual_edge_entrypoint'] and receipt['http']['lost_response_recovery'] and receipt['http']['unknown_response_replay']
    assert receipt['browser']['genuine_staff_api'] and receipt['browser']['committed_ack_loss_recovered'] and receipt['browser']['mobile_overflow_checked'] and receipt['browser']['dirty_navigation_guard']
    assert 4500<=receipt['timeout_elapsed_ms']<5800
    assert hashlib.sha256(reconciliation.read_bytes()).hexdigest()==reconciliation_hash
    print('Genuine reconciliation API passed:42 checks; actual5s timeout; owned account cleanup; no provider requests.',flush=True)
    lock_harness = root/'supabase/tests/operational_reconciliation_concurrency.py'
    lock_hash = hashlib.sha256(lock_harness.read_bytes()).hexdigest()
    result = command(['python3','-B',str(lock_harness),'--run-synthetic-local','--project-config',str(project/'supabase/config.toml')],cwd=root,timeout=90)
    lock_receipt = json.loads(result.strip().splitlines()[-1])
    assert lock_receipt['checks']==3 and lock_receipt['observed_lock_queues']==4 and lock_receipt['policy_pause_after_wait'] and lock_receipt['same_uuid_execute_replay'] and lock_receipt['owned_staff_deactivated'] and lock_receipt['provider_requests']==0
    assert hashlib.sha256(lock_harness.read_bytes()).hexdigest()==lock_hash
    print('Observed reconciliation concurrency passed:4 real lock queues; pause/replay receipts; no provider requests.',flush=True)
    restore_harness = root/'supabase/tests/operational_reconciliation_restore.py'
    restore_hash = hashlib.sha256(restore_harness.read_bytes()).hexdigest()
    result = command(['python3','-B',str(restore_harness),'--run-synthetic-local','--project-config',str(project/'supabase/config.toml')],cwd=root,timeout=180)
    restored = json.loads(result.strip().splitlines()[-1])
    assert restored['populated_relations']==16 and restored['snapshot_relations']==18 and restored['exact_snapshot_restored'] and restored['exact_readonly_recovery'] and restored['private_table_and_helper_grants'] and restored['owned_restore_database_removed'] and restored['provider_requests']==0
    assert hashlib.sha256(restore_harness.read_bytes()).hexdigest()==restore_hash
    print('Populated reconciliation restore passed:16 task/ledger families and18 relation snapshots, exact recovery and private grants; owned database removed.',flush=True)
    inventory = root/'tests/inventory/native-local.ts'
    inventory_hash = hashlib.sha256(inventory.read_bytes()).hexdigest()
    result = command(['node','--experimental-strip-types',str(inventory)],cwd=root,
      env={**env,'INVENTORY_TEST_PROJECT':str(project),'INVENTORY_RUN_SYNTHETIC_LOCAL':'true'},timeout=180)
    inventory_receipt=json.loads(result.strip().splitlines()[-1])
    assert inventory_receipt['api_checks']==38 and inventory_receipt['genuine_auth_postgrest'] and inventory_receipt['owned_actors_retired'] and inventory_receipt['baseline_unchanged'] and inventory_receipt['provider_requests']==0
    assert inventory_receipt['browser']['browser_checks']>=15 and inventory_receipt['browser']['committed_ack_loss_recovered'] and inventory_receipt['browser']['scan_resolves_reviewed_package'] and inventory_receipt['browser']['staff_camera_lookup'] and inventory_receipt['browser']['reload_readonly_recovery'] and inventory_receipt['browser']['mobile_overflow_checked'] and inventory_receipt['browser']['touch_targets_checked']
    assert hashlib.sha256(inventory.read_bytes()).hexdigest()==inventory_hash
    print(f"Genuine supplier identity passed:38 Auth/API checks;{inventory_receipt['browser']['browser_checks']} browser checks including simulated camera lookup;no provider requests.",flush=True)
    controlled = root/'tests/controlled-drugs/native-local.ts'
    controlled_hash = hashlib.sha256(controlled.read_bytes()).hexdigest()
    result = command(['node','--experimental-strip-types',str(controlled)],cwd=root,
      env={**env,'CONTROLLED_TEST_PROJECT':str(project),'CONTROLLED_RUN_SYNTHETIC_LOCAL':'true'},timeout=180)
    controlled_receipt=json.loads(result.strip().splitlines()[-1])
    assert controlled_receipt['api_checks']==28 and controlled_receipt['genuine_auth_postgrest'] and controlled_receipt['owned_actors_retired'] and controlled_receipt['owned_sessions_retired'] and controlled_receipt['baseline_unchanged'] and controlled_receipt['draft_only'] and controlled_receipt['provider_requests']==0
    assert controlled_receipt['browser']['browser_checks']==14 and controlled_receipt['browser']['committed_ack_loss_recovered'] and controlled_receipt['browser']['reload_readonly_recovery'] and controlled_receipt['browser']['no_default_schedule'] and controlled_receipt['browser']['mobile_overflow_checked'] and controlled_receipt['browser']['staff_read_only']
    assert hashlib.sha256(controlled.read_bytes()).hexdigest()==controlled_hash
    controlled_lock=root/'supabase/tests/controlled_draft_concurrency.py'
    controlled_lock_hash=hashlib.sha256(controlled_lock.read_bytes()).hexdigest()
    result=command(['python3','-B',str(controlled_lock),'--run-synthetic-local','--project-config',str(project/'supabase/config.toml')],cwd=root,timeout=120)
    controlled_locks=json.loads(result.strip().splitlines()[-1]);assert controlled_locks['checks']==5 and controlled_locks['observed_lock_queues']==8 and controlled_locks['post_wait_live_session'] and controlled_locks['post_wait_expiry'] and controlled_locks['owned_staff_deactivated']
    assert hashlib.sha256(controlled_lock.read_bytes()).hexdigest()==controlled_lock_hash
    controlled_restore=root/'supabase/tests/controlled_draft_restore.py'
    controlled_restore_hash=hashlib.sha256(controlled_restore.read_bytes()).hexdigest()
    result=command(['python3','-B',str(controlled_restore),'--run-synthetic-local','--project-config',str(project/'supabase/config.toml')],cwd=root,timeout=180)
    controlled_restored=json.loads(result.strip().splitlines()[-1]);assert controlled_restored['populated_relations']==6 and controlled_restored['exact_snapshot_restored'] and controlled_restored['exact_original_review_recovered'] and controlled_restored['owned_restore_database_removed']
    assert hashlib.sha256(controlled_restore.read_bytes()).hexdigest()==controlled_restore_hash
    print('Controlled draft passed:28 genuine Auth/API,14 browser,8 observed queues and6 populated restored relations;activation unavailable;provider requests0.',flush=True)
    inventory_lock=root/'supabase/tests/supplier_identity_concurrency.py'
    inventory_lock_hash=hashlib.sha256(inventory_lock.read_bytes()).hexdigest()
    result=command(['python3','-B',str(inventory_lock),'--run-synthetic-local','--project-config',str(project/'supabase/config.toml')],cwd=root,timeout=120)
    inventory_locks=json.loads(result.strip().splitlines()[-1]);assert inventory_locks['checks']==10 and inventory_locks['observed_lock_queues']==5 and inventory_locks['identifier_collision_atomic'] and inventory_locks['owned_staff_deactivated']
    assert hashlib.sha256(inventory_lock.read_bytes()).hexdigest()==inventory_lock_hash
    inventory_restore=root/'supabase/tests/supplier_identity_restore.py'
    inventory_restore_hash=hashlib.sha256(inventory_restore.read_bytes()).hexdigest()
    result=command(['python3','-B',str(inventory_restore),'--run-synthetic-local','--project-config',str(project/'supabase/config.toml')],cwd=root,timeout=180)
    inventory_restored=json.loads(result.strip().splitlines()[-1]);assert inventory_restored['populated_relations']==7 and inventory_restored['exact_snapshot_restored'] and inventory_restored['exact_original_review_recovered'] and inventory_restored['owned_restore_database_removed']
    assert hashlib.sha256(inventory_restore.read_bytes()).hexdigest()==inventory_restore_hash
    print('Supplier identity observed5 queues and restored7 populated relations with exact original recovery.',flush=True)
    verify()
    baseline = json.loads(command(['docker','exec','supabase_db_'+identity,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',
      "select jsonb_build_object('active_staff',(select count(*)from profiles where is_active),'reconciliation_enabled',coalesce((select enabled from operational_reconciliation_policy order by version desc limit 1),false),'pending_run',(select pending_run_id from operational_reconciliation_cursor),'outbox',(select count(*)from communication_outbox),'inventory_movements',(select count(*)from inventory_movements),'cron_active',(select active from cron.job where jobname='reconcile-operational-tasks'));" ]))
    assert baseline == {'active_staff':0,'reconciliation_enabled':False,'pending_run':None,'outbox':0,'inventory_movements':0,'cron_active':False}
    proof = {'canonical_migrations':len(hashes),'migration189_sha256':hashes['20261015055007_native_custody_provenance.sql'],'migration188_sha256':hashes['20261015020722_stock_writer_provenance.sql'],'migration187_sha256':hashes['20261015011200_controlled_draft_configuration.sql'],'migration186_sha256':hashes['20261014202235_supplier_product_identity.sql'],'migration185_sha256':hashes['20261014154223_operational_task_reconciliation.sql'],
             'sql_regression':{'files':155,'assertions':6540} if args.include_sql_regression else None,
             'staff_only':args.staff_only,'controlled_draft':{'api':controlled_receipt,'concurrency':controlled_locks,'restore':controlled_restored},'inventory':{'api':inventory_receipt,'concurrency':inventory_locks,'restore':inventory_restored},'api':receipt,'concurrency':lock_receipt,'restore':restored,'rollback_probe':rollback_receipt,'inventory_rollback_probe':identity_rollback,'controlled_rollback_probe':controlled_rollback,'cleanup_baseline':baseline}
    proof_path=root/'tmp/reconciliation-release-disposable-proof.json'
    proof_path.parent.mkdir(exist_ok=True)
    proof_path.write_text(json.dumps(proof,indent=2)+'\n')
    success = True
finally:
    if started:
        found = subprocess.run(['docker','inspect','supabase_db_' + identity], capture_output=True)
        if found.returncode == 0:
            verify()
            command(['supabase','stop','--workdir',str(project),'--project-id',identity,'--no-backup'], timeout=120)
            assert not command(['docker','ps','-a','--filter','label=com.supabase.cli.project=' + identity,'--format','{{.Names}}']).strip()
            assert not any(v.endswith('_' + identity) for v in command(['docker','volume','ls','--format','{{.Name}}']).splitlines())
            print('Owned scheduling containers and volumes removed; other runtimes untouched.', flush=True)
    log.close()
    if success: shutil.rmtree(work)
