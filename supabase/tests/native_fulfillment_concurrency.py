"""Actual local PostgreSQL contention; synthetic fixtures only, never provider calls."""
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

def contended(first_query, second_query, second_expected):
    """Wait for an observed lock holder and then an observed lock waiter."""
    tag = 'lrv_prescribing_' + uuid.uuid4().hex
    owned_sessions.extend([tag + '_holder', tag + '_waiter'])
    first = subprocess.Popen(COMMAND, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(first)
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
    processes.append(second)
    second.stdin.write(f"set application_name='{tag}_waiter';begin;{second_query}commit;")
    second.stdin.close()
    waiting = False
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name='{tag}_waiter' and wait_event_type='Lock';").stdout.strip() == '1':
            waiting = True
            break
        if second.poll() is not None:
            raise AssertionError('Waiter exited before observed contention: ' + second.stderr.read())
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
database='lrv_native_fulfillment_race_'+uuid.uuid4().hex
marker='owned-native-fulfillment-race-'+uuid.uuid4().hex
created=False
fixture=Path(__file__).with_name('native_prescriptions_lifecycle.test.sql').read_text().split('-- FIXTURE_BEGIN')[1].split('-- FIXTURE_END')[0]
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
    saved=json.loads(scalar('begin;set local search_path=public,extensions;'+fixture+"select configure_native_prescriber((select id from fx where k='config'),(select v from data where k='config-request'));select jsonb_build_object('fx',(select jsonb_object_agg(k,id) from fx),'data',(select jsonb_object_agg(k,v) from data));commit;"))
    fx=saved['fx'];base=saved['data']['save-request']
    sql("update profiles set full_name='Synthetic prescriber' where id="+quote(other_actor)+";")
    invoke('configure_native_prescriber',quote(str(uuid.uuid4())),jsonsql({**saved['data']['config-request'],'user_id':other_actor}))
    def draft():
        request={**base,'draft_id':str(uuid.uuid4())}
        invoke('save_native_prescription_draft',quote(str(uuid.uuid4())),jsonsql(request))
        return request['draft_id']
    def sign_request(d,other=False):
        preview=invoke('preview_native_prescription_sign',quote(d),'1',other=other)
        return dict(draft_id=d,pet_id=fx['pet'],expected_version=1,expected_context_hash=preview['context_hash'],signature_name='Synthetic prescriber',attest_review=True)
    def signed():
        d=draft();i=str(uuid.uuid4());invoke('sign_native_prescription',quote(i),jsonsql(sign_request(d)));return i
    def cancel_request(a,other=False):
        p=invoke('preview_native_prescription_cancel',quote(a),quote(fx['pet']),other=other)
        return dict(authorization_id=a,pet_id=fx['pet'],expected_event_id=p['context']['head']['id'],expected_context_hash=p['context_hash'],reason='Synthetic concurrent cancellation',attest_review=True)
    def replacement(a,d,other=False):
        p=invoke('preview_native_prescription_replacement',quote(a),quote(fx['pet']),quote(d),'1',other=other)
        return dict(authorization_id=a,pet_id=fx['pet'],expected_event_id=None,expected_context_hash=p['context_hash'],reason='Synthetic concurrent replacement',attest_review=True,draft_id=d,expected_version=1,signature_name='Synthetic prescriber',reconciliation=dict(native_use_note='Manually reviewed; native accounting unavailable',external_use_status='unknown',external_use_note='Unknown external use explicitly recorded',remaining_allowance_note='Reviewed remaining allowance manually',attest_review=True))

    def create_refill():
        i=str(uuid.uuid4());request=dict(refill_id=i,pet_id=fx['pet'],client_id=fx['client'],medication_requested='Synthetic operational request',requester_note=None,channel='phone',reason='Synthetic intake')
        invoke('create_native_refill',quote(str(uuid.uuid4())),jsonsql(request));return i
    def transition(i,action='close',version=1):return dict(refill_id=i,pet_id=fx['pet'],expected_version=version,action=action,reason='Synthetic operational transition',assigned_to=None,authorization_id=None,expected_link_context_hash=None)
    def refill_receipt(i,other=False):return json.loads(scalar('begin;'+(other_staff if other else staff)+'select coalesce(recover_native_refill_operation('+quote(i)+"),'null'::jsonb);commit;"))
    def lot(quantity=10):
        i=str(uuid.uuid4())
        invoke('receive_inventory',quote(str(uuid.uuid4())),quote(i),quote(fx['product']),quote('SYNTHETIC-'+i),quote('2099-12-31'),quote('Synthetic shelf'),str(quantity),quote('Synthetic stock'))
        return i
    def invoice():
        i=str(uuid.uuid4());invoke('create_billing_invoice',quote(i),quote(fx['client']));return i
    def target(a,l,inv=None,quantity='2',slot=0,version=None,refill=None):
        return dict(authorization_id=a,pet_id=fx['pet'],slot_index=slot,expected_slot_version=version,invoice_id=inv or invoice(),quantity=quantity,allocations=[dict(lot_id=l,quantity=quantity)],refill=refill)
    def reviewed(t):
        p=invoke('preview_native_dispense',jsonsql(t))
        return dict(**t,expected_context_hash=p['context_hash'],reason='Synthetic actual dispensing',attest_alert_review=True,attest_dispense_review=True)
    def dispense(op,request):return operation('record_native_dispense',op,request)
    def fill_receipt(op):return invoke('recover_native_fulfillment_operation',quote(op))
    def effects(inv,l):return scalar("select jsonb_build_object('stock',(select sum(quantity) from inventory_movements where lot_id="+quote(l)+"),'charges',(select count(*) from billing_invoice_items where invoice_id="+quote(inv)+"))::text;")
    def rejected(*codes):return lambda code,out,err:code!=0 and any(c in err for c in codes)
    def success(code,out,err):return code==0
    # Different operations reviewed against the same unopened slot cannot both open it.
    a=signed();l=lot();t=target(a,l);r=reviewed(t);win,lose=str(uuid.uuid4()),str(uuid.uuid4())
    contended(dispense(win,r),dispense(lose,r),rejected('40001'))
    check(fill_receipt(lose) is None,'Losing slot race creates no receipt')
    check(json.loads(effects(t['invoice_id'],l))==dict(stock=8,charges=1),'One slot winner debits and charges exactly once')
    # Exact replay waits and recovers the first immutable transaction, without child effects.
    a=signed();l=lot();t=target(a,l);r=reviewed(t);op=str(uuid.uuid4())
    contended(dispense(op,r),dispense(op,r),success)
    check(json.loads(effects(t['invoice_id'],l))==dict(stock=8,charges=1),'Same UUID race debits and charges once')
    # Distinct authorizations/invoices compete for the same physical lot.
    l=lot(10);t1=target(signed(),l,quantity='6');t2=target(signed(),l,quantity='6');r1,r2=reviewed(t1),reviewed(t2);op1,op2=str(uuid.uuid4()),str(uuid.uuid4())
    contended(dispense(op1,r1),dispense(op2,r2),rejected('23514','40001'))
    check(fill_receipt(op2) is None and json.loads(effects(t2['invoice_id'],l))==dict(stock=4,charges=0),'Stock loser rolls back allowance and charge')
    # Invoice issuance wins its row lock; reviewed draft can no longer be charged.
    service=invoke('save_catalog_product','null','null',quote('Synthetic service'),quote('service'),quote(''),quote('service'),'100','true')['id']
    a=signed();l=lot();t=target(a,l)
    invoke('add_invoice_service',quote(str(uuid.uuid4())),quote(t['invoice_id']),quote(fx['pet']),quote(service),'1')
    r=reviewed(t);op=str(uuid.uuid4())
    contended(staff+call('issue_billing_invoice',quote(t['invoice_id']),'2'),dispense(op,r),rejected('23514','40001'))
    check(fill_receipt(op) is None and json.loads(effects(t['invoice_id'],l))==dict(stock=10,charges=1),'Invoice issuance prevents dispensing side effects')
    # A service charge invalidates reviewed invoice evidence while it holds that row.
    a=signed();l=lot();t=target(a,l);r=reviewed(t);op=str(uuid.uuid4())
    charge=staff+call('add_invoice_service',quote(str(uuid.uuid4())),quote(t['invoice_id']),quote(fx['pet']),quote(service),'1')
    contended(charge,dispense(op,r),rejected('40001'))
    check(fill_receipt(op) is None and json.loads(effects(t['invoice_id'],l))==dict(stock=10,charges=1),'Competing service charge keeps only its own invoice effect')
    # A terminal cancellation winning authorization serialization blocks dispensing.
    a=signed();l=lot();t=target(a,l);r=reviewed(t);op=str(uuid.uuid4())
    contended(operation('cancel_native_prescription',str(uuid.uuid4()),cancel_request(a)),dispense(op,r),rejected('23514','40001'))
    check(fill_receipt(op) is None,'Canceled authorization cannot produce a fill')
    # Conversely an actual fill invalidates a previously reviewed cancellation context.
    a=signed();l=lot();t=target(a,l);r=reviewed(t);cancel_id=str(uuid.uuid4());cr=cancel_request(a)
    contended(dispense(str(uuid.uuid4()),r),operation('cancel_native_prescription',cancel_id,cr),rejected('40001'))
    check(receipt(cancel_id) is None,'Cancellation cannot ignore newly recorded native usage')
    # Replacement is terminal-only and cannot leave an old-order fill behind it.
    a=signed();d=draft();rr=replacement(a,d);l=lot();t=target(a,l);r=reviewed(t);op=str(uuid.uuid4())
    contended(operation('replace_native_prescription',str(uuid.uuid4()),rr),dispense(op,r),rejected('23514','40001'))
    check(fill_receipt(op) is None,'Replacement winner leaves no prior-order fill')
    # Explicit remainder closure versus another partial; no reopen or lost forfeiture.
    a=signed();l=lot();t=target(a,l);invoke('record_native_dispense',quote(str(uuid.uuid4())),jsonsql(reviewed(t)))
    t2={**t,'expected_slot_version':1};r=reviewed(t2);p=invoke('preview_native_slot_close',quote(a),quote(fx['pet']),'0')
    close=dict(authorization_id=a,pet_id=fx['pet'],slot_index=0,expected_slot_version=1,expected_context_hash=p['context_hash'],reason='Synthetic forfeiture race',attest_forfeit=True);op=str(uuid.uuid4())
    contended(operation('close_native_fill_slot',str(uuid.uuid4()),close),dispense(op,r),rejected('40001','23514'))
    check(fill_receipt(op) is None and invoke('read_native_fulfillment',quote(a),quote(fx['pet']))['open_slot'] is None,'Forfeited slot cannot reopen through a stale partial')
    # Operational request changes serialize before authorization and reject old versions.
    a=signed();i=create_refill();p=invoke('preview_native_refill_link',quote(i),quote(fx['pet']),quote(a));tr=transition(i,'link');tr.update(authorization_id=a,expected_link_context_hash=p['context_hash']);invoke('transition_native_refill',quote(str(uuid.uuid4())),jsonsql(tr))
    l=lot();t=target(a,l,refill=dict(id=i,expected_version=2));r=reviewed(t);op=str(uuid.uuid4());assignment=transition(i,'assign',2);assignment['assigned_to']=actor
    contended(operation('transition_native_refill',str(uuid.uuid4()),assignment),dispense(op,r),rejected('40001'))
    check(fill_receipt(op) is None and invoke('read_native_refill',quote(i),quote(fx['pet']))['refill']['version']==3,'Refill race keeps only operational winner')
    # Receiving changes balance while dispensing waits on its exact stock row.
    a=signed();l=lot();t=target(a,l);r=reviewed(t);op=str(uuid.uuid4())
    receive=staff+call('receive_inventory',quote(str(uuid.uuid4())),quote(l),quote(fx['product']),quote('SYNTHETIC-'+l),quote('2099-12-31'),quote('Synthetic shelf'),'1',quote('Synthetic received during review'))
    contended(receive,dispense(op,r),rejected('40001'))
    check(fill_receipt(op) is None and json.loads(effects(t['invoice_id'],l))==dict(stock=11,charges=0),'Receipt balance drift requires fresh review, with no partial effect')
    # A current alert update holds the patient row and invalidates the old review.
    a=signed();l=lot();t=target(a,l);r=reviewed(t);op=str(uuid.uuid4())
    alert=staff+call('save_patient_problem','null',quote(fx['pet']),'null',quote('Synthetic concurrent alert'),quote('Synthetic caution'),'null',quote('active'),quote('high'))
    contended(alert,dispense(op,r),rejected('40001'))
    check(fill_receipt(op) is None,'Alert changed while waiting cannot be bypassed')
    # Real three-writer schedule: receive owns product SHARE while waiting on lot;
    # catalog UPDATE queues; native dispense joins SHARE before its lot wait.
    sql('create extension if not exists pgrowlocks with schema extensions;')
    a=signed();l=lot();t=target(a,l);r=reviewed(t);op=str(uuid.uuid4())
    tag='native_fill_product_'+uuid.uuid4().hex
    def launch(suffix,query,hold=False):
        proc=subprocess.Popen(COMMAND,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);processes.append(proc)
        proc.stdin.write('set application_name='+quote(tag+suffix)+";set statement_timeout='30s';begin;"+query+('\n' if hold else 'commit;\n'));proc.stdin.flush()
        if not hold:proc.stdin.close()
        return proc
    def observe(suffix,condition):
        deadline=time.monotonic()+15
        while time.monotonic()<deadline:
            if scalar('select count(*) from pg_stat_activity where application_name='+quote(tag+suffix)+' and '+condition+';')=='1':check(True,'Observed '+suffix+' '+condition);return
            time.sleep(.03)
        raise AssertionError('Native product schedule condition not observed: '+suffix)
    blocker=launch('_lot','select 1 from inventory_lots where id='+quote(l)+' for update;',True);observe('_lot',"state='idle in transaction'")
    receiver=launch('_receive',staff+call('receive_inventory',quote(str(uuid.uuid4())),quote(l),quote(fx['product']),quote('SYNTHETIC-'+l),quote('2099-12-31'),quote('Synthetic shelf'),'1',quote('Synthetic queued receiving')))
    observe('_receive',"wait_event_type='Lock' and (select pid from pg_stat_activity where application_name="+quote(tag+'_lot')+")=any(pg_blocking_pids(pid))")
    catalog=launch('_catalog',staff+call('save_catalog_product',quote(fx['product']),'1',quote('Synthetic medication'),quote('medication'),quote(''),quote('tablet'),'200','true'))
    observe('_catalog',"wait_event_type='Lock' and (select pid from pg_stat_activity where application_name="+quote(tag+'_receive')+")=any(pg_blocking_pids(pid))")
    filling=launch('_fill',dispense(op,r))
    observe('_fill',"wait_event_type='Lock' and exists(select 1 from pg_locks k where k.pid=pg_stat_activity.pid and k.locktype='tuple' and k.relation='public.inventory_lots'::regclass and not k.granted)")
    ownership="select count(*) from extensions.pgrowlocks('public.catalog_products') r join public.catalog_products p on p.ctid=r.locked_row cross join lateral unnest(r.pids,r.modes) x(pid,mode) where p.id="+quote(fx['product'])+" and x.mode='For Share' and x.pid=(select pid from pg_stat_activity where application_name="+quote(tag+'_fill')+");"
    check(scalar(ownership)=='1','Actual native dispense owns exact product SHARE before lot wait')
    blocker.stdin.write('commit;\n');blocker.stdin.close()
    for proc,label in [(blocker,'lot holder'),(receiver,'receiver'),(catalog,'catalog')]:
        proc.wait(timeout=30);check(proc.returncode==0,label+' failed: '+proc.stderr.read())
    filling.wait(timeout=30);check(filling.returncode!=0 and '40001' in filling.stderr.read(),'Concurrent receiving invalidates the exact reviewed balance')
    check(fill_receipt(op) is None and json.loads(effects(t['invoice_id'],l))==dict(stock=11,charges=0),'Three-way stale dispense rolls back stock and billing effects')
    # Role revocation while authorization gate is held is rechecked after waiting.
    a=signed();l=lot();t=target(a,l);r=reviewed(t);op=str(uuid.uuid4())
    revocation="select pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||"+quote(a)+"::text,0));update profiles set is_active=false where id="+quote(actor)+';'
    contended(revocation,dispense(op,r),rejected('42501'))
    sql('update profiles set is_active=true where id='+quote(actor)+';')
    check(fill_receipt(op) is None,'Actor revoked during wait has no receipt or fill')
finally:
    if created:
        COMMAND=FOUNDATION_COMMAND.copy()
        check(scalar(f"select shobj_description(oid,'pg_database') from pg_database where datname='{database}';")==marker,'Exact owned database marker checked')
        sql(f"select pg_terminate_backend(pid) from pg_stat_activity where datname='{database}' and pid<>pg_backend_pid();")
        for proc in processes:
            if proc.stdin and not proc.stdin.closed:proc.stdin.close()
            proc.wait(timeout=10)
        sql(f'drop database "{database}";')
        check(scalar(f"select count(*) from pg_database where datname='{database}';")=='0','Disposable database removed')
print(f'Native fulfillment concurrency: {checks} checks passed; no provider calls.')
