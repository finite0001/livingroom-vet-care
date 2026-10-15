"""Observe all stock entry barriers, drain ordering and exact source replay locally."""
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
identity = args.project_config.read_text().splitlines()[0].split('"')[1]
assert identity.startswith(('lrv-catalog-', 'lrv-prescription-'))
container = 'supabase_db_' + identity
labels = json.loads(subprocess.check_output(['docker', 'inspect', container], text=True))[0]['Config']['Labels']
assert labels['com.supabase.cli.project'] == identity
assert Path(labels['com.supabase.cli.workdir']).resolve() == project
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
actor, session, product = [str(uuid.uuid4()) for _ in range(3)]
nonce = uuid.uuid4().hex[:10]
processes = []
observed = checks = 0


def sql(query):
    result = subprocess.run(command, input=query, capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr[-1800:]
    return result.stdout.strip()


claims = json.dumps({'role': 'authenticated', 'sub': actor, 'session_id': session}, separators=(',', ':'))


def staff(query, isolation='read committed'):
    return f"begin isolation level {isolation};set local timezone='UTC';set local role authenticated;set local request.jwt.claims='{claims}';" + query + ';commit;'


def launch(name, query, hold=False):
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(process)
    process.stdin.write(f"set application_name='{name}';" + query + '\n')
    process.stdin.flush()
    if not hold:
        process.stdin.close()
        process.stdin = None
    return process


def wait(name, held=False):
    global observed
    deadline = time.monotonic() + 1.7
    while time.monotonic() < deadline:
        condition = "exists(select 1 from pg_locks l where l.pid=a.pid and l.granted and l.locktype='advisory')" if held else "a.wait_event_type='Lock' and cardinality(pg_blocking_pids(a.pid))>0"
        if sql(f"select count(*)from pg_stat_activity a where a.application_name='{name}' and {condition}") == '1':
            if not held:
                observed += 1
            return
        time.sleep(.025)
    raise AssertionError('Actual queue/holder not observed: ' + name)


def finish(process, code=None):
    output, error = process.communicate(timeout=10)
    if code is not None:
        assert process.returncode != 0 and code in error, error[-1800:]
        return None
    assert process.returncode == 0, error[-1800:]
    return json.loads(output.strip().splitlines()[-1])


def release(process, query='commit;'):
    process.stdin.write(query + '\n')
    process.stdin.close()
    process.stdin = None
    output, error = process.communicate(timeout=10)
    assert process.returncode == 0, error[-1800:]


def barrier_holder(name):
    process = launch(name, 'begin;select pg_advisory_xact_lock(90271040,0);', True)
    wait(name, True)
    return process


def receive(root, lot):
    return f"select to_jsonb(receive_inventory('{root}','{lot}','{product}','SYNTHETIC-{lot[:8]}',current_date+365,'Synthetic clinic',2,'Synthetic actual lock proof'))"


sql(f"insert into auth.users(id,email,raw_user_meta_data)values('{actor}','stock-lock-{actor}@example.test','{{}}');update profiles set is_active=true,full_name='Synthetic stock lock proof'where id='{actor}';insert into user_roles(user_id,role)values('{actor}','ADMIN'),('{actor}','DVM');insert into auth.sessions(id,user_id,created_at,updated_at)values('{session}','{actor}',now(),now());")
try:
    sql(staff(f"select create_inventory_product('{product}','Synthetic stock lock {nonce}','medication','Synthetic manufacturer','mL',100)"))
    # All eight writers really queue BEFORE their legacy operation locks and
    # even before validating the deliberately unusable downstream request.
    holder = barrier_holder('stock_all_holder_' + nonce)
    entries = [
        ('receive_inventory', "'{id}',null,null,null,null,null,null,null"),
        ('adjust_inventory', "'{id}',null,null,null"),
        ('record_patient_treatment', "'{id}',null"),
        ('record_native_dispense', "'{id}',null"),
        ('record_native_dispense_return', "'{id}',null"),
        ('record_native_dispense_return_v2', "'{id}',null"),
        ('record_anesthesia_drug_administration', "'{id}',null,null,null"),
        ('record_native_return_discrepancy', "'{id}',null"),
    ]
    queued = []
    for index, (writer, arguments) in enumerate(entries):
        name = f'stock_entry_{index}_{nonce}'
        process = launch(name, staff('select ' + writer + '(' + arguments.format(id=uuid.uuid4()) + ')'))
        queued.append(process)
        wait(name)
        assert sql(f"select count(*)from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='{name}' and l.locktype='advisory' and l.granted") == '0', 'Legacy lock acquired before entry barrier'
        assert sql(f"select count(*)from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='{name}' and l.locktype='advisory' and not l.granted and l.classid=90271040 and l.objid=0 and l.mode='ShareLock'") == '1'
    release(holder)
    for process in queued:
        finish(process, '23514')
    checks += 8

    # An admitted receive waits on its OLD UUID lock while holding the shared
    # barrier. Exclusive cutover must wait for that actual stock transaction.
    root, lot = str(uuid.uuid4()), str(uuid.uuid4())
    op_name = 'stock_op_holder_' + nonce
    operation = launch(op_name, f"begin;select pg_advisory_xact_lock(hashtextextended('{root}',0));", True)
    wait(op_name, True)
    receive_name = 'stock_draining_' + nonce
    receiving = launch(receive_name, staff(receive(root, lot)))
    wait(receive_name)
    assert sql(f"select count(*)from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='{receive_name}'and l.classid=90271040 and l.objid=0 and l.granted and l.mode='ShareLock'") == '1'
    freeze_name = 'stock_exclusive_' + nonce
    freezing = launch(freeze_name, 'begin;select pg_advisory_xact_lock(90271040,0);', True)
    wait(freeze_name)
    release(operation)
    first = finish(receiving)
    wait(freeze_name, True)
    assert first['id'] == root
    assert sql(f"select count(*)from stock_movement_sources where movement_id='{root}'") == '1'
    next_root, next_lot = str(uuid.uuid4()), str(uuid.uuid4())
    next_name = 'stock_after_exclusive_' + nonce
    later = launch(next_name, staff(receive(next_root, next_lot)))
    wait(next_name)
    assert sql(f"select count(*)from inventory_movements where id='{next_root}'") == '0'
    release(freezing)
    assert finish(later)['id'] == next_root
    checks += 1

    # Fresh authorization is checked again after an observed barrier wait.
    holder = barrier_holder('stock_revoke_holder_' + nonce)
    revoked_root = str(uuid.uuid4())
    name = 'stock_revoked_' + nonce
    revoked = launch(name, staff(f"select adjust_inventory('{revoked_root}','{lot}',-0.125,'Synthetic role loss')"))
    wait(name)
    release(holder, f"update profiles set is_active=false where id='{actor}';commit;")
    finish(revoked, '42501')
    assert sql(f"select count(*)from stock_movement_sources where movement_id='{revoked_root}'") == '0'
    sql(f"update profiles set is_active=true where id='{actor}';")
    checks += 1

    # Shared entry preserves concurrency; the OLD UUID lock still serializes an
    # exact duplicate into ONE effect/source and the exact same old receipt.
    same_root, same_lot = str(uuid.uuid4()), str(uuid.uuid4())
    name = 'stock_same_holder_' + nonce
    holder = launch(name, f"begin;select pg_advisory_xact_lock(hashtextextended('{same_root}',0));", True)
    wait(name, True)
    duplicates = []
    names = []
    for index in range(2):
        name = f'stock_same_{index}_{nonce}'
        names.append(name)
        duplicates.append(launch(name, staff(receive(same_root, same_lot))))
        wait(name)
    name_list = ','.join("'" + name + "'" for name in names)
    assert sql(f"select count(*)from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name in({name_list})and l.classid=90271040 and l.objid=0 and l.granted and l.mode='ShareLock'") == '2'
    release(holder)
    results = [finish(process) for process in duplicates]
    assert results[0] == results[1]
    assert sql(f"select count(*)from stock_movement_sources where movement_id='{same_root}'") == '1'
    assert sql(f"select sum(quantity)::text from inventory_movements where lot_id='{same_lot}'") == '2.000'
    checks += 1

    incompatible = launch('stock_isolation_' + nonce, staff(receive(str(uuid.uuid4()), str(uuid.uuid4())), 'repeatable read'))
    finish(incompatible, '23514')
    checks += 1
finally:
    for process in processes:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=5)
    sql(f"update profiles set is_active=false where id='{actor}';update auth.sessions set not_after=clock_timestamp()where id='{session}';")

assert observed == 14
proof = {'checks': checks, 'observed_lock_queues': observed, 'all_eight_outer_writers_early': True, 'exclusive_drains_prior_stock': True, 'new_writers_wait_for_exclusive': True, 'post_wait_role_rechecked': True, 'shared_concurrency_preserved': True, 'same_uuid_one_source_exact_receipt': True, 'unsupported_isolation_denied': True, 'owned_actor_retired': True, 'provider_requests': 0}
(project/'stock-writer-concurrency-proof.json').write_text(json.dumps(proof, indent=2))
print(json.dumps(proof))
