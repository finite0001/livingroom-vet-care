"""Verify product-before-lot ownership, pricing and post-wait authority in owned PostgreSQL.
Compatible SHARE can pass queued UPDATE; this does not claim a reproduced prior deadlock.
"""
import argparse
from pathlib import Path
import json
import subprocess
import time
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project-config', type=Path, required=True, help='Derive the database container from a Supabase TOML project_id')
parser.add_argument('--run-synthetic-local',action='store_true',required=True,help='Authorize only owned schema-clone synthetic testing')
parser.add_argument('--use-prior-treatment-lock-order',action='store_true',help='Reconstruct only the prior treatment ordering inside owned clone for negative control')
args = parser.parse_args()
CONTAINER = None
if args.project_config:
    import tomllib
    with args.project_config.open('rb') as config_file:
        project_id = tomllib.load(config_file)['project_id']
    CONTAINER = 'supabase_db_' + project_id
FOUNDATION_COMMAND = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']

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

def check(condition, message):
    global checks
    assert condition, message
    checks += 1

staff = "set local role authenticated;select set_config('request.jwt.claims'," + quote(json.dumps({'sub': actor, 'role': 'authenticated'})) + ",true);"

def contended(first_query, second_query, second_expected):
    """Wait for an observed lock holder and then an observed lock waiter."""
    tag = 'lrv_prescribing_' + uuid.uuid4().hex
    owned_sessions.extend([tag + '_holder', tag + '_waiter'])
    first = subprocess.Popen(COMMAND, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write(f"set application_name='{tag}_holder';begin;{first_query}\n")
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
    second.stdin.write(f"set application_name='{tag}_waiter';begin;{second_query}commit;")
    second.stdin.close()
    waiting = False
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name='{tag}_waiter' and wait_event_type='Lock';").stdout.strip() == '1':
            waiting = True
            break
        time.sleep(.03)
    check(waiting, 'Second operation actually waits on the first transaction lock')
    first.stdin.write('commit;\n')
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
database='lrv_product_lock_race_'+uuid.uuid4().hex
marker='owned-product-lock-race-'+uuid.uuid4().hex
created=False
fixture=Path(__file__).with_name('native_prescriptions_lifecycle.test.sql').read_text().split('-- FIXTURE_BEGIN')[1].split('-- FIXTURE_END')[0]
def scalar(query):return sql(query).stdout.strip().splitlines()[-1]
def jsonsql(value):return quote(json.dumps(value))+'::jsonb'
def call(name,*args):return 'select '+name+'('+','.join(args)+');'
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
    sql('create extension if not exists pgrowlocks with schema extensions;')
    if args.use_prior_treatment_lock_order:
        amendment=Path(__file__).resolve().parents[1].joinpath('migrations','20260916070108_inventory_product_before_lot_locking.sql').read_text()
        prefix=amendment.split(" select pg_get_functiondef('public.record_patient_treatment")[0]
        inverse=prefix+" select pg_get_functiondef('public.record_patient_treatment(uuid,jsonb)'::regprocedure) into definition; if position(new_block in definition)=0 then raise exception 'Expected118order absent';end if;definition:=replace(definition,new_block,old_block);execute definition;end $$;"
        sql(inverse)
        print('Negative control: prior treatment lock order reconstructed only in owned scratch database.',flush=True)

    saved=json.loads(scalar('begin;set local search_path=public,extensions;'+fixture+"select jsonb_build_object('fx',(select jsonb_object_agg(k,id) from fx),'data',(select jsonb_object_agg(k,v) from data));commit;"))
    fx=saved['fx'];base=saved['data']['save-request']
    lot=str(uuid.uuid4());invoice=str(uuid.uuid4())
    sql(transaction(call('receive_inventory',quote(str(uuid.uuid4())),quote(lot),quote(fx['product']),quote('LOCK-LOT'),quote('2099-12-31'),quote('Synthetic clinic'),'100',quote('Synthetic initial stock'))))
    sql(transaction(call('create_billing_invoice',quote(invoice),quote(fx['client']))))
    def receive(i):return staff+call('receive_inventory',quote(i),quote(lot),quote(fx['product']),quote('LOCK-LOT'),quote('2099-12-31'),quote('Synthetic clinic'),'1',quote('Synthetic concurrent receipt'))
    def treatment(i):
        alerts=invoke('read_patient_treatment_alerts',quote(fx['pet']))
        request=dict(pet_id=fx['pet'],lot_id=lot,invoice_id=invoice,quantity=1,dose='Synthetic dose',route='Synthetic route',site='',veterinarian='Synthetic clinician',veterinarian_license='TEST',administered_at=scalar('select clock_timestamp();'),next_due_on=None,alert_review=dict(source_hash=alerts['source_hash'],acknowledged=True))
        return staff+call('record_patient_treatment',quote(i),jsonsql(request))
    launched={}
    def launch(tag,query,commit=True):
        p=subprocess.Popen(COMMAND,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        p.stdin.write('set application_name='+quote(tag)+";set statement_timeout='30s';begin;"+query+('commit;\n' if commit else '\n'));p.stdin.flush()
        if commit:p.stdin.close()
        launched[tag]=p
        return p
    def observed(tag,condition):
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            if scalar('select count(*) from pg_stat_activity where application_name='+quote(tag)+' and '+condition+';')=='1':return
            time.sleep(.03)
        raise AssertionError('Expected observed session condition: '+tag+' '+condition)
    def race_diagnostic():
        return scalar("select coalesce(jsonb_agg(jsonb_build_object('name',application_name,'pid',pid,'state',state,'wait_type',wait_event_type,'wait',wait_event,'blockers',pg_blocking_pids(pid),'locks',(select coalesce(jsonb_agg(jsonb_build_object('type',l.locktype,'relation',l.relation::regclass::text,'mode',l.mode,'granted',l.granted,'page',l.page,'tuple',l.tuple,'transactionid',l.transactionid::text)),'[]') from pg_locks l where l.pid=pg_stat_activity.pid))),'[]') from pg_stat_activity where datname=current_database() and application_name like 'lrv_product_%';")
    def blocked_by(waiter,holder):
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            for name in [waiter,holder]:
                process=launched.get(name)
                if process is not None and process.poll() is not None:
                    raise AssertionError('Session exited before expected blocker: '+name+' exit='+str(process.returncode)+' error='+process.stderr.read()+' state='+race_diagnostic())
            q='select count(*) from pg_stat_activity w,pg_stat_activity h where w.application_name='+quote(waiter)+' and h.application_name='+quote(holder)+" and w.wait_event_type='Lock' and h.pid=any(pg_blocking_pids(w.pid));"
            if scalar(q)=='1':check(True,'Observed exact blocker '+holder+' -> '+waiter);return
            time.sleep(.03)
        raise AssertionError('Expected blocking relationship '+holder+' -> '+waiter+' state='+race_diagnostic())
    def completed(p,label):
        p.wait(timeout=35);err=p.stderr.read();check(p.returncode==0,label+': '+err)
    # Actual receiving holds product SHARE and waits for a deliberately held lot.
    # Actual catalog UPDATE queues next; treatment must own product SHARE before its lot wait.
    prefix='lrv_product_order_'+uuid.uuid4().hex
    blocker=launch(prefix+'_lot',"select 1 from inventory_lots where id="+quote(lot)+' for update;',False)
    observed(prefix+'_lot',"state='idle in transaction'")
    rid,tid=str(uuid.uuid4()),str(uuid.uuid4())
    rec=launch(prefix+'_receive',receive(rid));blocked_by(prefix+'_receive',prefix+'_lot')
    upd=launch(prefix+'_catalog',staff+call('save_catalog_product',quote(fx['product']),'1',quote('Synthetic medication'),quote('medication'),quote(''),quote('tablet'),'200','true'));blocked_by(prefix+'_catalog',prefix+'_receive')
    treatment_query=treatment(tid);tx=launch(prefix+'_treatment',treatment_query)
    # Compatible tuple SHARE can bypass a queued UPDATE: require actual product
    # row ownership before the observed lot wait, not an invalid queue assumption.
    observed(prefix+'_treatment',"wait_event_type='Lock'")
    check(scalar("select count(*) from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name="+quote(prefix+'_treatment')+" and l.locktype='tuple' and l.relation='public.inventory_lots'::regclass and not l.granted;")=='1','Treatment is actually waiting on inventory lot tuple')
    ownership="select count(*) from extensions.pgrowlocks('public.catalog_products') r join public.catalog_products c on c.ctid=r.locked_row cross join lateral unnest(r.pids,r.modes) m(pid,mode) join pg_stat_activity a on a.pid=m.pid where c.id="+quote(fx['product'])+" and a.application_name="+quote(prefix+'_treatment')+" and m.mode='For Share';"
    check(scalar(ownership)=='1','Treatment owns exact product row SHARE before waiting for lot (negative control must fail here)')
    blocker.stdin.write('commit;\n');blocker.stdin.close();completed(blocker,'Release deliberate lot holder')
    completed(rec,'Real receive completes');completed(upd,'Real queued catalog update completes');completed(tx,'Real treatment completes')
    check(scalar('select unit_price_cents from billing_invoice_items where id='+quote(tid)+';')=='100','Treatment retains product price protected by its SHARE while catalog UPDATE waits')
    check(scalar('select count(*) from treatment_alert_reviews where treatment_id='+quote(tid)+';')=='1','Clinical alert review preserved')
    check(scalar('select sum(quantity) from inventory_movements where lot_id='+quote(lot)+';')=='100.000','Exactly one receive and one treatment debit')
    # Reverse arrival: treatment and receiver both own compatible product SHARE before catalog queues.
    prefix='lrv_product_reverse_'+uuid.uuid4().hex
    blocker=launch(prefix+'_lot','select 1 from inventory_lots where id='+quote(lot)+' for update;',False);observed(prefix+'_lot',"state='idle in transaction'")
    rid2,tid2=str(uuid.uuid4()),str(uuid.uuid4())
    tx=launch(prefix+'_treatment',treatment(tid2));blocked_by(prefix+'_treatment',prefix+'_lot')
    rec=launch(prefix+'_receive',receive(rid2));observed(prefix+'_receive',"wait_event_type='Lock'")
    upd=launch(prefix+'_catalog',staff+call('save_catalog_product',quote(fx['product']),'2',quote('Synthetic medication'),quote('medication'),quote(''),quote('tablet'),'300','true'));blocked_by(prefix+'_catalog',prefix+'_treatment')
    blocker.stdin.write('commit;\n');blocker.stdin.close();completed(blocker,'Release reverse lot holder')
    completed(tx,'Reverse treatment completes');completed(rec,'Reverse receive completes');completed(upd,'Reverse catalog update completes')
    check(scalar('select unit_price_cents from billing_invoice_items where id='+quote(tid2)+';')=='200','Treatment holds reviewed price until its transaction commits')
    check(scalar('select sum(quantity) from inventory_movements where lot_id='+quote(lot)+';')=='100.000','Reverse schedule preserves exact stock')
    # Exact retries recheck active actor after actually waiting on request gate.
    adjustment_id=str(uuid.uuid4())
    adjustment=staff+call('adjust_inventory',quote(adjustment_id),quote(lot),'1',quote('Synthetic count adjustment'))
    sql('begin;'+adjustment+'commit;')
    for operation_id,replay in [(rid,receive(rid)),(tid,treatment_query),(adjustment_id,adjustment)]:
        revocation="select pg_advisory_xact_lock(hashtextextended("+quote(operation_id)+"::text,0));update profiles set is_active=false where id="+quote(actor)+';'
        contended(revocation,replay,lambda code,out,err:code!=0 and 'Active staff access required' in err)
        sql('update profiles set is_active=true where id='+quote(actor)+';')
finally:
    if created:
        COMMAND=FOUNDATION_COMMAND.copy()
        check(scalar(f"select shobj_description(oid,'pg_database') from pg_database where datname='{database}';")==marker,'Exact owned database marker checked')
        sql(f"select pg_terminate_backend(pid) from pg_stat_activity where datname='{database}' and pid<>pg_backend_pid();")
        sql(f'drop database "{database}";')
        check(scalar(f"select count(*) from pg_database where datname='{database}';")=='0','Disposable database removed')
print(f'Inventory product-lock concurrency: {checks} checks passed; no provider calls.')
