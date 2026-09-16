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
database='lrv_native_return_race_'+uuid.uuid4().hex
marker='owned-native-return-race-'+uuid.uuid4().hex
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
    email="native-race@example.test"
    sql("update clients set primary_email="+quote(email)+" where id="+quote(fx['client'])+';')
    sql("insert into record_release_policy(id,enabled,accepted_schema_version,accepted_by,accepted_at,acceptance_reference) values(true,true,12,'Synthetic',now(),'Synthetic race only');")
    def selection(a,fill=None):return dict(native_prescription_ids=[a],native_dispense_ids=[] if fill is None else [fill])
    def preview(sel):return invoke('preview_record_release_v12',quote(fx['pet']),quote(fx['client']),quote('EMAIL'),quote(email),jsonsql(sel))
    def confirm(i,sel,p):return staff+call('confirm_record_release',quote(i),quote(fx['pet']),quote(fx['client']),quote('EMAIL'),quote(email),jsonsql(sel),jsonsql(p['snapshot']),quote(p['source_hash']),'true')
    def absent(i):check(scalar('select count(*) from record_releases where id='+quote(i)+';')=='0','Rejected review leaves no release')
    def filled():
        a=signed();t=target(a,lot());d=str(uuid.uuid4())
        invoke('record_native_dispense',quote(d),jsonsql(reviewed(t)))
        return a,d,t
    def intent(a,d,action='intake',quantity='1',intake=None):
        read=invoke('read_native_dispense_returns',quote(a),quote(fx['pet']),quote(d))
        return dict(target=dict(authorization_id=a,pet_id=fx['pet'],dispense_id=d),action=action,intake_id=intake,allocations=[dict(allocation_id=read['allocations'][0]['allocation_id'],quantity=quantity)],custody='clinic_retained' if action=='intake' else None,package_condition='sealed_intact' if action=='intake' else None,storage_history='controlled' if action=='intake' else None,reason='Synthetic physical return',note='Synthetic concurrent custody note')
    def review(i):
        p=invoke('preview_native_dispense_return',jsonsql(i))
        check(p['allowed'],'Synthetic target allowed before contention')
        return dict(intent=i,expected_context_hash=p['context_hash'],expected_head=p['context']['head'],attest_review=True,attest_restock=i['action']=='restock')
    def append(i,r):return operation('record_native_dispense_return',i,r)
    def intake(a,d):
        i=str(uuid.uuid4());invoke('record_native_dispense_return',quote(i),jsonsql(review(intent(a,d))));return i
    def read(a,d):return invoke('read_native_dispense_returns',quote(a),quote(fx['pet']),quote(d))
    def restock(a,d,i):return review(intent(a,d,'restock','1',i))
    def policy_request(enabled):return dict(expected_version=invoke('read_native_return_policy')['version'],enabled=enabled,review_reference='Synthetic local acceptance only',attest_review=True)
    sql("insert into native_return_policy_state values(true,0,null);")
    invoke('configure_native_return_policy',quote(str(uuid.uuid4())),jsonsql(policy_request(True)))
    # Two new intakes cannot both consume the same reviewed allocation balance.
    a,d,t=filled();r=review(intent(a,d));one,two=str(uuid.uuid4()),str(uuid.uuid4())
    contended(append(one,r),append(two,r),rejected('40001'))
    check(read(a,d)['allocations'][0]['returned_quantity']=='1.000','Only one cumulative intake')
    check(invoke('recover_native_dispense_return',quote(two)) is None,'Stale intake has no receipt')
    # Concurrent exact UUID recovers once, including the stock-producing operation.
    a,d,t=filled();i=intake(a,d);r=restock(a,d,i);op=str(uuid.uuid4())
    contended(append(op,r),append(op,r),success)
    check(read(a,d)['allocations'][0]['restocked_quantity']=='1.000','Restock UUID does not duplicate movement')
    check(scalar("select count(*) from native_return_stock_links where event_id="+quote(op)+';')=='1','Exactly one attributed positive movement')
    # Disposal and restocking compete for the same held quantity/head.
    a,d,t=filled();i=intake(a,d);dispose=review(intent(a,d,'dispose','1',i));stock=restock(a,d,i)
    contended(append(str(uuid.uuid4()),dispose),append(str(uuid.uuid4()),stock),rejected('40001','23514'))
    check(read(a,d)['allocations'][0]['held_quantity']=='0.000','Disposition consumes held once')
    # Policy changes while restocking waits invalidate the exact reviewed context.
    a,d,t=filled();i=intake(a,d);r=restock(a,d,i);change=policy_request(False)
    contended(operation('configure_native_return_policy',str(uuid.uuid4()),change),append(str(uuid.uuid4()),r),rejected('40001','42501','23514'))
    check(read(a,d)['allocations'][0]['held_quantity']=='1.000','Disabled policy leaves custody unchanged')
    invoke('configure_native_return_policy',quote(str(uuid.uuid4())),jsonsql(policy_request(True)))
    # Current inventory and product changes must force a fresh stock review.
    a,d,t=filled();i=intake(a,d);r=restock(a,d,i);lid=t['allocations'][0]['lot_id']
    adjust=staff+call('adjust_inventory',quote(str(uuid.uuid4())),quote(lid),'1',quote('Synthetic adjustment'))
    contended(adjust,append(str(uuid.uuid4()),r),rejected('40001'))
    def catalog_change(active):
        product=json.loads(scalar("select to_jsonb(p) from catalog_products p where id="+quote(fx['product'])+';'))
        return staff+call('save_catalog_product',quote(product['id']),str(product['version']),quote(product['name']),quote(product['kind']),quote(product['manufacturer']),quote(product['unit']),str(product['unit_price_cents']),'true' if active else 'false')
    a,d,t=filled();i=intake(a,d);r=restock(a,d,i)
    contended(catalog_change(False),append(str(uuid.uuid4()),r),rejected('40001','42501','23514'))
    sql(transaction(catalog_change(True)))
    # Original pickup wins first: reviewed intake must be refreshed.
    a,d,t=filled();r=review(intent(a,d));p=invoke('preview_native_pickup',quote(d),quote(fx['pet']),'null')
    pickup=dict(authorization_id=a,pet_id=fx['pet'],dispense_id=d,refill_close=None,expected_context_hash=p['context_hash'],recipient_name='Synthetic recipient',recipient_relationship='Owner',reason='Synthetic handoff',attest_handoff=True)
    contended(operation('record_native_pickup',str(uuid.uuid4()),pickup),append(str(uuid.uuid4()),r),rejected('40001'))
    # Intake wins first: a later unqualified original pickup is refused.
    a,d,t=filled();r=review(intent(a,d));p=invoke('preview_native_pickup',quote(d),quote(fx['pet']),'null');pickup.update(authorization_id=a,dispense_id=d,expected_context_hash=p['context_hash'])
    contended(append(str(uuid.uuid4()),r),operation('record_native_pickup',str(uuid.uuid4()),pickup),rejected('23514'))
    # Current print waits for and discloses the committed physical intake.
    a,d,t=filled();r=review(intent(a,d))
    contended(append(str(uuid.uuid4()),r),staff+call('read_native_prescription_print_v3',quote(a),quote(d)),lambda code,out,err:code==0 and 'Synthetic concurrent custody note' in out)
    # Client-package confirmation shares the source gate in both arrival orders.
    a,d,t=filled();sel=selection(a,d);p=preview(sel);op=str(uuid.uuid4());r=review(intent(a,d))
    contended(append(str(uuid.uuid4()),r),confirm(op,sel,p),rejected('40001'));absent(op)
    a,d,t=filled();sel=selection(a,d);p=preview(sel);op=str(uuid.uuid4());r=review(intent(a,d))
    contended(confirm(op,sel,p),append(str(uuid.uuid4()),r),success)
    check(not invoke('read_record_release',quote(op))['eligible'],'Return invalidates saved release')
    check(json.loads(scalar(transaction(confirm(op,sel,p))))['snapshot']==p['snapshot'],'Historical exact replay preserved')
    # Current DVM authority must be checked again after the authorization wait.
    a,d,t=filled();i=intake(a,d);r=restock(a,d,i)
    gate="select pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||"+quote(a)+"::text,0));"
    contended(gate+"delete from user_roles where user_id="+quote(actor)+" and role='DVM';",append(str(uuid.uuid4()),r),rejected('42501','23514'))
    sql("insert into user_roles(user_id,role) values("+quote(actor)+",'DVM');")
    a,d,t=filled();r=review(intent(a,d));gate="select pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||"+quote(a)+"::text,0));"
    contended(gate+"update profiles set is_active=false where id="+quote(actor)+';',append(str(uuid.uuid4()),r),rejected('42501'))

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
print(f'Native return concurrency: {checks} checks passed; no provider calls.')
