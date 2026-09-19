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
database='lrv_native_reconciliation_race_'+uuid.uuid4().hex
marker='owned-native-reconciliation-race-'+uuid.uuid4().hex
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
    def rejected(*codes):return lambda code,out,err:code!=0 and any(c in err for c in codes)
    def success(code,out,err):return code==0
    def filled():
        a=signed();t=target(a,lot());d=str(uuid.uuid4())
        invoke('record_native_dispense',quote(d),jsonsql(reviewed(t)))
        return a,d,t
    def policy_request(enabled):return dict(expected_version=invoke('read_native_return_policy')['version'],enabled=enabled,review_reference='Synthetic local acceptance only',attest_review=True)
    sql("insert into native_return_policy_state values(true,0,null);")
    invoke('configure_native_return_policy',quote(str(uuid.uuid4())),jsonsql(policy_request(True)))
    def reconciliation_read(a,d):
        return invoke('read_native_dispense_returns_v2',quote(a),quote(fx['pet']),quote(d))
    def current_intent(a,d,action='intake',quantity='1',intake_id=None,source=None,case_id=None):
        current=reconciliation_read(a,d)
        return dict(target=dict(authorization_id=a,pet_id=fx['pet'],dispense_id=d),action=action,intake_id=intake_id,correction_target=None if source is None else dict(event_id=source['id'],record_hash=source['record_hash']),discrepancy_id=case_id,allocations=[dict(allocation_id=current['allocations'][0]['allocation_id'],quantity=quantity)],custody='clinic_retained' if action=='intake' else None,package_condition='sealed_intact' if action=='intake' else None,storage_history='controlled' if action=='intake' else None,reason='Synthetic reconciliation contention',note='Synthetic exact source correction')
    def current_review(i):
        p=invoke('preview_native_dispense_return_v2',jsonsql(i))
        check(p['allowed'],'Synthetic reconciliation allowed before contention')
        action=i['action']
        return dict(intent=i,expected_context_hash=p['context_hash'],expected_head=p['context']['head'],expected_discrepancy_head=p['context']['discrepancy_head'],attest_review=True,attest_restock=action=='restock',physical_attestations=dict(reviewed_physical_facts=True,intake_claim_incorrect=action=='retract_intake',remains_physically_held=action in('retract_disposal','retract_restock'),was_not_destroyed=action=='retract_disposal',removed_from_available_stock=action=='retract_restock'))
    def append_current(op,r):return operation('record_native_dispense_return_v2',op,r)
    def committed(i):return invoke('record_native_dispense_return_v2',quote(str(uuid.uuid4())),jsonsql(current_review(i)))['result']
    def stocked():
        a,d,t=filled()
        intake_event=committed(current_intent(a,d))
        stock_event=committed(current_intent(a,d,'restock',intake_id=intake_event['id']))
        return a,d,t,intake_event,stock_event
    def discrepancy_intent(a,d,source,action='report',case=None,correction_ids=None):
        return dict(target=dict(authorization_id=a,pet_id=fx['pet'],dispense_id=d),action=action,case_id=case,source=dict(event_id=source['id'],record_hash=source['record_hash']),allocations=[dict(allocation_id=source['allocations'][0]['allocation_id'],quantity='1.000')],observation='Synthetic physically reviewed discrepancy',correction_ids=correction_ids or [])
    def discrepancy_review(i):
        p=invoke('preview_native_return_discrepancy',jsonsql(i))
        check(p['allowed'],'Synthetic discrepancy allowed before contention')
        return dict(intent=i,expected_context_hash=p['context_hash'],expected_return_head=p['context']['return_head'],expected_discrepancy_head=p['context']['discrepancy_head'],attest_physical_review=True,attest_original_quantities_custody_and_stock_accurate=i['action']=='resolve_confirmed_original')
    def append_discrepancy(op,r):return operation('record_native_return_discrepancy',op,r)
    def report(a,d,source):return invoke('record_native_return_discrepancy',quote(str(uuid.uuid4())),jsonsql(discrepancy_review(discrepancy_intent(a,d,source))))['result']
    def stock_quantity(lid):return scalar('select coalesce(sum(quantity),0)::text from inventory_movements where lot_id='+quote(lid)+';')
    # Different UUID corrections reviewed against the same original cannot exceed it.
    a,d,t,i,s=stocked();request=current_review(current_intent(a,d,'retract_restock','0.750',i['id'],s));one,two=str(uuid.uuid4()),str(uuid.uuid4())
    contended(append_current(one,request),append_current(two,request),rejected('23514','40001'))
    check(reconciliation_read(a,d)['allocations'][0]['restocked_quantity']=='0.250','Competing corrections consume source capacity only once')
    check(invoke('recover_native_dispense_return_v2',quote(two)) is None,'Rejected correction has no receipt')
    check(scalar('select count(*) from native_return_compensation_links where event_id='+quote(one)+';')=='1','Winning correction has exactly one negative stock link')
    # Exact operation replay waits and returns the one immutable negative receipt.
    a,d,t,i,s=stocked();request=current_review(current_intent(a,d,'retract_restock','1',i['id'],s));op=str(uuid.uuid4());lid=t['allocations'][0]['lot_id']
    before=stock_quantity(lid)
    contended(append_current(op,request),append_current(op,request),success)
    check(reconciliation_read(a,d)['allocations'][0]['restocked_quantity']=='0.000','Exact negative operation not duplicated')
    check(scalar('select count(*) from native_return_compensation_links where event_id='+quote(op)+';')=='1','Exact replay creates one negative movement link')
    check(scalar('select count(*) from native_return_stock_links where event_id='+quote(s['id'])+';')=='1','Original positive link remains intact')
    from decimal import Decimal
    check(Decimal(stock_quantity(lid))==Decimal(before)-Decimal('1'),'Available stock removed exactly once')
    check(scalar('select count(*) from billing_invoice_items where invoice_id='+quote(t['invoice_id'])+';')=='1','Compensation does not create or change original charge count')
    # A concurrent stock adjustment invalidates a previously reviewed compensation.
    a,d,t,i,s=stocked();lid=t['allocations'][0]['lot_id'];request=current_review(current_intent(a,d,'retract_restock','1',i['id'],s));op=str(uuid.uuid4())
    adjustment=staff+call('adjust_inventory',quote(str(uuid.uuid4())),quote(lid),'1',quote('Synthetic competing count'))
    contended(adjustment,append_current(op,request),rejected('40001'))
    check(invoke('recover_native_dispense_return_v2',quote(op)) is None,'Changed stock review commits no compensation')
    # A report that obtains its lot lock first blocks a waiting generic adjustment.
    a,d,t,i,s=stocked();lid=t['allocations'][0]['lot_id'];report_id=str(uuid.uuid4());request=discrepancy_review(discrepancy_intent(a,d,s));before=stock_quantity(lid)
    adjustment=staff+call('adjust_inventory',quote(str(uuid.uuid4())),quote(lid),'1',quote('Synthetic adjustment after hold'))
    contended(append_discrepancy(report_id,request),adjustment,rejected('23514'))
    check(stock_quantity(lid)==before,'Hold prevents waiting adjustment from changing stock')
    check(reconciliation_read(a,d)['discrepancies']['open_case_count']==1,'Report remains open after blocked writer')
    # A separate prescription shares the lot gate and cannot dispense held stock.
    a,d,t,i,s=stocked();lid=t['allocations'][0]['lot_id'];other_authorization=signed();new_target=target(other_authorization,lid,quantity='1');new_fill=str(uuid.uuid4());dispense_request=reviewed(new_target)
    contended(append_discrepancy(str(uuid.uuid4()),discrepancy_review(discrepancy_intent(a,d,s))),dispense(new_fill,dispense_request),rejected('23514','40001'))
    check(fill_receipt(new_fill) is None,'Waiting cross-prescription dispense creates no receipt')
    check(scalar('select count(*) from billing_invoice_items where invoice_id='+quote(new_target['invoice_id'])+';')=='0','Held-lot rejection rolls back billing')
    # Discrepancy exact retry creates one decision, not a second hold/case.
    a,d,t,i,s=stocked();report_id=str(uuid.uuid4());request=discrepancy_review(discrepancy_intent(a,d,s))
    contended(append_discrepancy(report_id,request),append_discrepancy(report_id,request),success)
    check(reconciliation_read(a,d)['discrepancies']['head']['version']==1,'Concurrent report UUID records one decision')
    # Holding a lot for review does not prevent exact negative compensation.
    correction=committed(current_intent(a,d,'retract_restock','1',i['id'],s,report_id))
    check(reconciliation_read(a,d)['discrepancies']['open_case_count']==1,'Actual compensation leaves case explicit until resolution')
    resolution=discrepancy_review(discrepancy_intent(a,d,s,'resolve_corrected',report_id,[correction['id']]))
    lid=t['allocations'][0]['lot_id'];adjustment=staff+call('adjust_inventory',quote(str(uuid.uuid4())),quote(lid),'1',quote('Synthetic after verified resolution'))
    contended(append_discrepancy(str(uuid.uuid4()),resolution),adjustment,success)
    check(reconciliation_read(a,d)['discrepancies']['open_case_count']==0,'Verified resolution releases waiting stock writer')
    # A report waiting behind a consumed-stock adjustment still preserves the concern.
    a,d,t,i,s=stocked();lid=t['allocations'][0]['lot_id'];report_id=str(uuid.uuid4());request=discrepancy_review(discrepancy_intent(a,d,s))
    adjustment=staff+call('adjust_inventory',quote(str(uuid.uuid4())),quote(lid),str(Decimal('0.100')-Decimal(stock_quantity(lid))),quote('Synthetic consumed before physical review'))
    contended(adjustment,append_discrepancy(report_id,request),success)
    preview=invoke('preview_native_dispense_return_v2',jsonsql(current_intent(a,d,'retract_restock','1',i['id'],s,report_id)))
    check('insufficient_available_stock' in preview['blockers'],'Consumed available stock cannot be silently compensated')
    check(reconciliation_read(a,d)['discrepancies']['open_case_count']==1,'Insufficient stock concern persists')
    # Recheck DVM authority after an observed authorization-gate wait.
    a,d,t,i,s=stocked();request=current_review(current_intent(a,d,'retract_restock','1',i['id'],s));op=str(uuid.uuid4())
    gate="select pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||"+quote(a)+"::text,0));"
    contended(gate+'delete from user_roles where user_id='+quote(actor)+" and role='DVM';",append_current(op,request),rejected('42501','23514'))
    check(invoke('recover_native_dispense_return_v2',quote(op)) is None,'Revoked DVM writes no correction')
    sql('insert into user_roles(user_id,role) values('+quote(actor)+",'DVM');")
    # Staff deactivation while waiting cannot create a new discrepancy.
    a,d,t,i,s=stocked();request=discrepancy_review(discrepancy_intent(a,d,s));op=str(uuid.uuid4())
    gate="select pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||"+quote(a)+"::text,0));"
    contended(gate+'update profiles set is_active=false where id='+quote(actor)+';',append_discrepancy(op,request),rejected('42501'))
    check(scalar('select count(*) from native_return_discrepancy_events where id='+quote(op)+';')=='0','Deactivated staff writes no report')

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
print(f'Native reconciliation concurrency: {checks} checks passed; no provider calls.')
