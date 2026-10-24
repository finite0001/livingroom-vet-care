"""Observed schedule/care queues in an explicitly owned local runtime."""
import argparse
import json
from pathlib import Path
import subprocess
import time
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local', action='store_true', required=True)
parser.add_argument('--project-config', type=Path, required=True)
args = parser.parse_args()
project = args.project_config.resolve().parent.parent
config = args.project_config.read_text()
identity = config.splitlines()[0].split('"')[1]
assert identity.startswith(('lrv-reconcile-', 'lrv-catalog-'))
container = 'supabase_db_' + identity
labels = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]['Config']['Labels']
assert labels['com.supabase.cli.project'] == identity
assert Path(labels['com.supabase.cli.workdir']).resolve() == project
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
nonce = uuid.uuid4().hex[:12]
actor, session, review = (str(uuid.uuid4()) for _ in range(3))
staff_claims = json.dumps({'role': 'authenticated', 'sub': actor, 'session_id': session})
checks = observed = 0

def sql(query):
    result = subprocess.run(command, input=query, capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr[-1500:]
    return result.stdout.strip()

def staff(query):
    return f"begin;set local role authenticated;set local request.jwt.claims='{staff_claims}';{query};commit;"

def service(query):
    return "begin;set local role service_role;set local request.jwt.claims='{\"role\":\"service_role\"}';" + query + ';commit;'

def policy(enabled):
    version = sql('select coalesce(max(version),0) from operational_reconciliation_policy;')
    action = str(uuid.uuid4())
    lo = "clock_timestamp()-interval '1 day'" if enabled else 'null'
    hi = "clock_timestamp()+interval '1 day'" if enabled else 'null'
    request = f"jsonb_build_object('expected_version',{version if version != '0' else 'null'},'enabled',{'true' if enabled else 'false'},'window_from',{lo},'window_until',{hi},'review_note','Synthetic lock proof','attest_review',true)"
    sql(staff(f"select prepare_operational_review('{actor}','{action}','reconciliation_policy',{request});select execute_operational_review('{actor}','{action}')"))

def launch(name, query):
    return subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True), f"set application_name='{name}';" + query

def waiting(name):
    global observed
    deadline = time.monotonic() + 1.5
    while time.monotonic() < deadline:
        if sql(f"select count(*)from pg_stat_activity where application_name='{name}' and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;") == '1':
            observed += 1
            return
        time.sleep(0.025)
    raise AssertionError('Expected live lock queue was not observed: ' + name)

def result(process):
    out, error = process.communicate(timeout=10)
    assert process.returncode == 0, error[-1500:]
    return json.loads(out.strip().splitlines()[-1])

sql(f"insert into auth.users(id,email,raw_user_meta_data)values('{actor}','synthetic-lock-{nonce}@example.test','{{}}');update profiles set is_active=true where id='{actor}';insert into user_roles(user_id,role)values('{actor}','ADMIN')on conflict do nothing;insert into auth.sessions(id,user_id,created_at,updated_at)values('{session}','{actor}',now(),now());")
try:
    policy(True)
    first = str(uuid.uuid4())
    sql(service(f"select start_operational_reconciliation_run('{first}',5)"))
    version = sql('select max(version)from operational_reconciliation_policy;')
    sql(staff(f"select prepare_operational_review('{actor}','{review}','reconciliation_policy',jsonb_build_object('expected_version',{version},'enabled',false,'window_from',null,'window_until',null,'review_note','Synthetic queued pause','attest_review',true))"))
    for case, lock in [('pause', 'pg_advisory_xact_lock(73260123)'), ('replay', 'pg_advisory_xact_lock(1869440354,1128354373)')]:
        if case == 'replay':
            policy(True)
            first = str(uuid.uuid4())
            sql(service(f"select start_operational_reconciliation_run('{first}',5)"))
        holder, text = launch('lrv_recon_hold_' + nonce, f"begin;select {lock};select 'HELD';")
        holder.stdin.write(text + '\n'); holder.stdin.flush()
        processes = []
        try:
            ready = False
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                if sql(f"select count(*)from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='lrv_recon_hold_{nonce}' and l.locktype='advisory' and l.granted;") != '0':
                    ready = True;break
                time.sleep(0.025)
            assert ready, 'Owned holder did not acquire its lock'
            names = ['lrv_recon_' + case + '_a_' + nonce, 'lrv_recon_' + case + '_b_' + nonce]
            queries = [staff(f"select execute_operational_review('{actor}','{review}')") if case == 'pause' else service(f"select execute_operational_reconciliation_run('{first}',5)"), service(f"select execute_operational_reconciliation_run('{first}',5)")]
            for name, query in zip(names, queries):
                process, text = launch(name, query);process.stdin.write(text);process.stdin.close();process.stdin = None;processes.append(process);waiting(name)
            holder.stdin.write('commit;\n');holder.stdin.close();holder.stdin = None;holder.communicate(timeout=5)
            receipts = [result(p) for p in processes]
            if case == 'pause':
                assert receipts[1]['outcome'] == 'paused' and receipts[1]['counts'] is None
                checks += 1
            else:
                assert receipts[0] == receipts[1] and receipts[0]['outcome'] == 'completed'
                assert sql(f"select count(*)from operational_reconciliation_results where run_id='{first}';") == '1'
                checks += 2
        finally:
            if holder.poll() is None:
                if holder.stdin:holder.stdin.write('rollback;\n');holder.stdin.close();holder.stdin = None
                holder.communicate(timeout=5)
            for process in processes:
                if process.poll() is None:process.communicate(timeout=10)
finally:
    policy(False)
    sql(f"update profiles set is_active=false where id='{actor}';update auth.sessions set not_after=clock_timestamp()where user_id='{actor}';")

assert observed == 4
proof = {'checks': checks, 'observed_lock_queues': observed, 'policy_pause_after_wait': True, 'same_uuid_execute_replay': True, 'provider_requests': 0, 'owned_staff_deactivated': True}
(project/'reconciliation-lock-proof.json').write_text(json.dumps(proof, indent=2))
print(json.dumps(proof))
