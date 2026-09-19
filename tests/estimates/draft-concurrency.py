"""Observed native estimate draft PostgreSQL contention; owned local schema clone and synthetic evidence only."""
import argparse
from pathlib import Path
import json
import subprocess
import time
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project-config', type=Path, required=True, help='Derive the database container from a Supabase TOML project_id')
parser.add_argument('--run-synthetic-local',action='store_true',required=True,help='Authorize only owned schema-clone synthetic testing')
args = parser.parse_args()
CONTAINER = None
if args.project_config:
    import tomllib
    with args.project_config.open('rb') as config_file:
        project_id = tomllib.load(config_file)['project_id']
    CONTAINER = 'supabase_db_' + project_id
FOUNDATION_COMMAND = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']

COMMAND = FOUNDATION_COMMAND.copy()

def sql(query, fail=True):
    result = subprocess.run(COMMAND, input=query, capture_output=True, text=True, timeout=30)
    if fail and result.returncode:
        raise AssertionError(result.stderr)
    return result

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

actor = 'a5510000-0000-4000-8000-000000000001'
client = None
ids = [actor, client]
checks = 0
owned_sessions = []
processes = []

def check(condition, message):
    global checks
    assert condition, message
    checks += 1

staff = "set local role authenticated;select set_config('request.jwt.claims'," + quote(json.dumps({'sub': actor, 'role': 'authenticated'})) + ",true);"

def contended(first_query, second_query, second_expected, first_tail="", first_end="commit"):
    """Wait for an observed lock holder and then an observed lock waiter."""
    tag = 'lrv_estimates_' + uuid.uuid4().hex
    owned_sessions.extend([tag + '_holder', tag + '_waiter'])
    first = subprocess.Popen(COMMAND, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(first)
    first.stdin.write(f"\\o /dev/null\nset application_name='{tag}_holder';begin;{first_query}\n")
    first.stdin.flush()
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name='{tag}_holder' and state='idle in transaction';").stdout.strip() == '1':
            break
        if first.poll() is not None:
            raise AssertionError('Holder exited before acquiring locks: ' + first.stderr.read())
        time.sleep(.03)
    else:
        raise AssertionError('Did not observe transaction holding locks')
    second = subprocess.Popen(COMMAND, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(second)
    second.stdin.write(f"\\o /dev/null\nset application_name='{tag}_waiter';begin;{second_query}commit;")
    second.stdin.close()
    waiting = False
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity w join pg_stat_activity h on h.pid=any(pg_blocking_pids(w.pid)) where w.application_name='{tag}_waiter' and h.application_name='{tag}_holder' and w.wait_event_type='Lock';").stdout.strip() == '1':
            waiting = True
            break
        if second.poll() is not None:
            raise AssertionError('Waiter exited before observed contention: ' + second.stderr.read())
        time.sleep(.03)
    check(waiting, 'Second operation actually waits on the first transaction lock')
    if first_end not in ('commit', 'rollback'):
        raise AssertionError('Only explicit transaction completion supported')
    first.stdin.write(first_tail + first_end + ';\n')
    first.stdin.close()
    first.wait(timeout=10)
    second.wait(timeout=10)
    first_error = first.stderr.read()
    second_output = second.stdout.read()
    second_error = second.stderr.read()
    check(first.returncode == 0, first_error)
    check(second_expected(second.returncode, second_output, second_error), second_error or second_output)


import tomllib
inspection=subprocess.run(['docker','inspect',CONTAINER],capture_output=True,text=True,check=True,timeout=30)
check(json.loads(inspection.stdout)[0]['Config']['Labels']['com.supabase.cli.project']==project_id,'Verified owned local project')
database='lrv_estimate_draft_race_'+uuid.uuid4().hex
marker='owned-estimate-draft-race-'+uuid.uuid4().hex
created=False
fixture=Path(__file__).resolve().parents[2].joinpath('supabase/tests/native_prescriptions_lifecycle.test.sql').read_text().split('-- FIXTURE_BEGIN')[1].split('-- FIXTURE_END')[0]
def scalar(query):return sql(query).stdout.strip().splitlines()[-1]
def jsonsql(value):return quote(json.dumps(value))+'::jsonb'
def call(name,*args):return "select coalesce(to_jsonb("+name+'('+','.join(args)+")),'null'::jsonb);"
def transaction(query):return 'begin;'+staff+query+'commit;'
other_actor='a5510000-0000-4000-8000-000000000003'
other_staff=staff.replace(actor,other_actor)
def invoke(name,*args,other=False):return json.loads(scalar('begin;'+(other_staff if other else staff)+call(name,*args)+'commit;'))
def operation(name,request_id,request,other=False):return (other_staff if other else staff)+call(name,quote(request_id),jsonsql(request))
def receipt(request_id,other=False):return json.loads(scalar('begin;'+(other_staff if other else staff)+'select coalesce(recover_native_prescription_operation('+quote(request_id)+"),'null'::jsonb);commit;"))
try:
    dump=subprocess.run(['docker','exec',CONTAINER,'pg_dump','-U','postgres','--schema-only','--no-owner','--schema=public','--schema=auth','--schema=storage','--schema=extensions','postgres'],capture_output=True,check=True,timeout=120).stdout
    sql(f'create database "{database}";');created=True
    sql(f"comment on database \"{database}\" is {quote(marker)};")
    COMMAND=FOUNDATION_COMMAND.copy();COMMAND[COMMAND.index('-d')+1]=database
    sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;')
    dump=dump.replace(b'CREATE SCHEMA extensions;',b'CREATE SCHEMA IF NOT EXISTS extensions;')
    dump=b"\n".join(line for line in dump.splitlines() if not line.startswith(b'ALTER DEFAULT PRIVILEGES'))
    restored=subprocess.run(COMMAND,input=dump,capture_output=True,timeout=120)
    check(restored.returncode==0,restored.stderr.decode())
    saved=json.loads(scalar('begin;set local search_path=public,extensions;'+fixture+"select jsonb_build_object('fx',(select jsonb_object_agg(k,id) from fx));commit;"))
    fx=saved['fx']
    def success(code,out,err):return code==0
    def rejected(*codes):return lambda code,out,err:code!=0 and any(c in err for c in codes)
    def product(kind):
        return invoke('save_catalog_product','null','null',quote('Synthetic '+kind),quote(kind),quote(''),quote('unit'),'125','true')
    products=[product(kind) for kind in ('service','medication','vaccine')]
    def fields():
        return dict(title='Synthetic complete estimate',notes='Draft only; no clinical action',terms='Synthetic draft terms',accept_by='2099-12-31',lines=[
            dict(id=str(uuid.uuid4()),product_id=p['id'],product_version=p['version'],description='Synthetic '+p['kind'],kind=p['kind'],unit=p['unit'],quantity='1',pricing=dict(kind='unit',unit_price_cents='125'),pricing_reason=None) for p in products])
    def request(estimate=None,version=None):return dict(estimate_id=estimate or str(uuid.uuid4()),client_id=fx['client'],pet_id=fx['pet'],expected_version=version,fields=fields())
    def save(op,r):return operation('save_native_estimate_draft',op,r)
    def recover(op,other=False):return invoke('recover_native_estimate_draft',quote(op),other=other)
    def read(estimate):return invoke('read_native_estimate_draft',quote(estimate),quote(fx['client']))
    def close(op,r):return invoke('close_native_estimate_draft',quote(op),jsonsql(r))
    def closing(op,r,status):
        return staff+"do $estimate_test$ declare v jsonb; begin v:=close_native_estimate_draft("+quote(op)+','+jsonsql(r)+");if v->>'status' is distinct from "+quote(status)+" then raise exception 'Unexpected estimate closure outcome';end if;end $estimate_test$;"
    def count(estimate):return scalar('select count(*) from native_estimate_draft_revisions where estimate_id='+quote(estimate)+';')
    def effects():
        names=['patient_treatments','native_prescription_authorizations','native_dispenses','inventory_movements','inventory_lots','billing_invoices','billing_invoice_items','billing_credits','invoice_payments','invoice_refund_requests']
        return scalar('select jsonb_build_object('+','.join(quote(n)+',(select count(*) from '+n+')' for n in names)+');')
    original=effects()

    r=request();op=str(uuid.uuid4())
    contended(save(op,r),save(op,r),success)
    check(count(r['estimate_id'])=='1','Concurrent exact save retries append one revision')
    check(recover(op)['request']==r,'Saved receipt recovers exact original request')
    frozen=recover(op)
    one={**r,'expected_version':1,'fields':{**r['fields'],'title':'Winning title'}}
    two={**r,'expected_version':1,'fields':{**r['fields'],'title':'Competing title'}}
    winner,loser=str(uuid.uuid4()),str(uuid.uuid4())
    contended(save(winner,one),save(loser,two),rejected('40001'))
    check(count(r['estimate_id'])=='2' and read(r['estimate_id'])['draft']['fields']['title']=='Winning title','Version race preserves one complete winning revision')
    check(recover(loser) is None,'Stale concurrent save has no operation receipt')
    check(recover(op)==frozen,'Historical exact receipt survives later edit')

    r=request();op=str(uuid.uuid4());changed={**r,'fields':{**r['fields'],'title':'Changed ID reuse'}}
    contended(save(op,r),save(op,changed),rejected('23514'))
    check(count(r['estimate_id'])=='1','Changed same-ID save cannot overwrite original')

    r=request();op=str(uuid.uuid4());p=products[0]
    catalog=staff+call('save_catalog_product',quote(p['id']),str(p['version']),quote(p['name']),quote(p['kind']),quote(''),quote(p['unit']),'126','true')
    contended(catalog,save(op,r),rejected('40001'))
    check(recover(op) is None and read(r['estimate_id'])['draft'] is None,'Changed locked catalog prevents stale draft creation')
    products[0]=json.loads(scalar('select to_jsonb(p) from catalog_products p where id='+quote(p['id'])+';'))
    # Future requests explicitly review the changed price as an override.
    def current_request():
        r=request()
        r['fields']['lines'][0]['pricing_reason']='Synthetic reviewed catalog price override'
        return r

    r=current_request();op=str(uuid.uuid4())
    contended(closing(op,r,'closed_unrecorded'),save(op,r),rejected('23514'))
    closed=close(op,r)
    check(closed['status']=='closed_unrecorded' and closed['closure']['request']==r and closed['closure']['actor_id']==actor,'Terminal closure binds exact draft intent and staff')
    check(recover(op) is None and read(r['estimate_id'])['draft'] is None,'Close-first delayed save creates no draft')
    check(close(op,r)==closed,'Closed request recovers immutable terminal evidence')
    changed={**r,'fields':{**r['fields'],'title':'Wrong closure request'}}
    result=sql(transaction(operation('close_native_estimate_draft',op,changed)),False)
    check(result.returncode!=0 and '23514' in result.stderr,'Closure refuses changed request identity')
    result=sql('begin;'+operation('close_native_estimate_draft',op,r,other=True)+'commit;',False)
    check(result.returncode!=0 and '42501' in result.stderr,'Closure refuses another staff actor')

    r=current_request();op=str(uuid.uuid4())
    contended(save(op,r),closing(op,r,'recorded'),success)
    check(close(op,r)==dict(version=1,status='recorded',receipt=recover(op)),'Write-first close returns exact committed revision receipt')
    check(count(r['estimate_id'])=='1','Write-first closure creates no extra revision')
    r=current_request();op=str(uuid.uuid4())
    contended(save(op,r),closing(op,r,'closed_unrecorded'),success,first_end='rollback')
    check(close(op,r)['status']=='closed_unrecorded' and recover(op) is None,'Rolled-back save closes terminally after observed wait')
    check(read(r['estimate_id'])['draft'] is None,'Rolled-back creation leaves no root/revision')
    result=sql(transaction(save(op,r)),False)
    check(result.returncode!=0 and '23514' in result.stderr,'Delayed rollback retry cannot resurrect closed attempt')
    r=current_request();op=str(uuid.uuid4())
    contended(closing(op,r,'closed_unrecorded'),save(op,r),success,first_end='rollback')
    check(recover(op) is not None and count(r['estimate_id'])=='1','Rolled-back closure does not poison waiting original save')

    r=current_request();op=str(uuid.uuid4())
    gate="select pg_advisory_xact_lock(hashtextextended('native-estimate:'||"+quote(r['estimate_id'])+"::text,0));"
    contended(gate+'update profiles set is_active=false where id='+quote(actor)+';',save(op,r),rejected('42501'))
    sql('update profiles set is_active=true where id='+quote(actor)+';')
    check(recover(op) is None and read(r['estimate_id'])['draft'] is None,'Staff revoked during root wait cannot persist a draft')
    check(effects()==original,'Draft edits and closures create no clinical, stock, invoice or payment evidence')

finally:
    if created:
        COMMAND=FOUNDATION_COMMAND.copy()
        check(scalar(f"select shobj_description(oid,'pg_database') from pg_database where datname='{database}';")==marker,'Exact owned database marker checked')
        sql(f"select pg_terminate_backend(pid) from pg_stat_activity where datname='{database}' and pid<>pg_backend_pid() and usename=current_user and backend_type='client backend';")
        for proc in processes:
            if proc.stdin and not proc.stdin.closed:proc.stdin.close()
            proc.wait(timeout=10)
        sql(f'drop database "{database}";')
        check(scalar(f"select count(*) from pg_database where datname='{database}';")=='0','Disposable database removed')
print(f'Estimate draft concurrency: {checks} checks passed; no provider calls.')
