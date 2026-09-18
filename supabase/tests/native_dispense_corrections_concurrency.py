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
database='lrv_native_correction_race_'+uuid.uuid4().hex
marker='owned-native-correction-race-'+uuid.uuid4().hex
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
    sql("insert into record_release_policy(id,enabled,accepted_schema_version,accepted_by,accepted_at,acceptance_reference) values(true,true,11,'Synthetic',now(),'Synthetic race only');")
    def selection(a,fill=None):return dict(native_prescription_ids=[a],native_dispense_ids=[] if fill is None else [fill])
    def preview(sel):return invoke('preview_record_release_v11',quote(fx['pet']),quote(fx['client']),quote('EMAIL'),quote(email),jsonsql(sel))
    def confirm(i,sel,p):return staff+call('confirm_record_release',quote(i),quote(fx['pet']),quote(fx['client']),quote('EMAIL'),quote(email),jsonsql(sel),jsonsql(p['snapshot']),quote(p['source_hash']),'true')
    def absent(i):check(scalar('select count(*) from record_releases where id='+quote(i)+';')=='0','Rejected review leaves no release')
    def filled():
        a=signed();t=target(a,lot());d=str(uuid.uuid4())
        invoke('record_native_dispense',quote(d),jsonsql(reviewed(t)))
        return a,d
    def correction(a,d,kind='operational_annotation'):
        p=invoke('preview_native_dispense_correction',quote(a),quote(fx['pet']),quote(d))
        return dict(authorization_id=a,pet_id=fx['pet'],dispense_id=d,kind=kind,expected_context_hash=p['context_hash'],expected_head=p['context']['head'],reason='Synthetic correction',note='Synthetic client-shareable annotation',amends_event_id=None,pickup_amendment=None,attest_review=True)
    def append(i,r):return operation('append_native_dispense_correction',i,r)
    def correction_read(a,d):return staff+call('read_native_dispense_corrections',quote(a),quote(fx['pet']),quote(d))
    def correction_recover(i):return invoke('recover_native_dispense_correction',quote(i))
    # Same reviewed predecessor allows only one new event; stale loser creates no receipt.
    a,d=filled();r=correction(a,d);one,two=str(uuid.uuid4()),str(uuid.uuid4())
    contended(append(one,r),append(two,r),rejected('40001'))
    check(correction_recover(two) is None,'Stale append has no durable operation')
    check(invoke('read_native_dispense_corrections',quote(a),quote(fx['pet']),quote(d))['context']['head']['version']==1,'Exactly one event appended')
    # Same actor/UUID/request can recover committed evidence after waiting.
    a,d=filled();r=correction(a,d);i=str(uuid.uuid4())
    contended(append(i,r),append(i,r),success)
    check(invoke('read_native_dispense_corrections',quote(a),quote(fx['pet']),quote(d))['context']['head']['version']==1,'Repeated UUID does not duplicate event')
    # Original pickup appearing while reviewed annotation waits changes its reviewed context.
    a,d=filled();r=correction(a,d);p=invoke('preview_native_pickup',quote(d),quote(fx['pet']),'null')
    pickup=dict(authorization_id=a,pet_id=fx['pet'],dispense_id=d,refill_close=None,expected_context_hash=p['context_hash'],recipient_name='Synthetic recipient',recipient_relationship='Owner',reason='Synthetic handoff',attest_handoff=True)
    contended(operation('record_native_pickup',str(uuid.uuid4()),pickup),append(str(uuid.uuid4()),r),rejected('40001'))
    # A waiting current print includes the committed amendment.
    a,d=filled();r=correction(a,d)
    def has_amendment(code,out,err):return code==0 and 'Synthetic client-shareable annotation' in out
    contended(append(str(uuid.uuid4()),r),staff+call('read_native_prescription_print_v2',quote(a),quote(d)),has_amendment)
    # Correction before release confirmation rejects obsolete reviewed content.
    a,d=filled();sel=selection(a,d);p=preview(sel);i=str(uuid.uuid4());r=correction(a,d)
    contended(append(str(uuid.uuid4()),r),confirm(i,sel,p),rejected('40001'));absent(i)
    # Confirmation before correction preserves historical content but invalidates delivery.
    a,d=filled();sel=selection(a,d);p=preview(sel);i=str(uuid.uuid4());r=correction(a,d)
    contended(confirm(i,sel,p),append(str(uuid.uuid4()),r),success)
    check(not invoke('read_record_release',quote(i))['eligible'],'Correction invalidates saved release')
    retained=json.loads(scalar(transaction(confirm(i,sel,p))))
    check(retained['snapshot']==p['snapshot'],'Historical replay remains byte-for-byte unchanged')
    # Delivery source reads share the correction gate in both arrival orders.
    conversation=str(uuid.uuid4());sql("insert into conversations(id,client_id) values("+quote(conversation)+","+quote(fx['client'])+");")
    service="set local role service_role;select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);"
    def email_context(a,d):
        sel=selection(a,d);p=preview(sel);i=str(uuid.uuid4());sql(transaction(confirm(i,sel,p)));request=str(uuid.uuid4())
        invoke('prepare_release_email',quote(request),quote(i),quote(conversation),quote('Synthetic records'),quote('Synthetic reviewed release'),quote(p['source_hash']))
        return service+call('release_email_capture_context',quote(request),quote(actor))
    a,d=filled();context=email_context(a,d);r=correction(a,d)
    contended(append(str(uuid.uuid4()),r),context,rejected('42501'))
    a,d=filled();context=email_context(a,d);r=correction(a,d)
    contended(context,append(str(uuid.uuid4()),r),success)
    check(sql('begin;'+context+'commit;',fail=False).returncode!=0,'Later email source read rejects corrected obsolete package')
    phone='+13035550123';sql("update clients set primary_phone="+quote(phone)+" where id="+quote(fx['client'])+';')
    invoke('record_sms_consent',quote(actor),quote(fx['client']),quote(phone),'true',quote('WRITTEN'),quote('Synthetic race only'),'null')
    def link_source(a,d):
        sel=selection(a,d);p=invoke('preview_record_release_v11',quote(fx['pet']),quote(fx['client']),quote('SMS'),quote(phone),jsonsql(sel));i=str(uuid.uuid4())
        invoke('confirm_record_release',quote(i),quote(fx['pet']),quote(fx['client']),quote('SMS'),quote(phone),jsonsql(sel),jsonsql(p['snapshot']),quote(p['source_hash']),'true')
        return staff+call('preview_document_link',quote('record_release'),quote(i),quote(fx['client']))
    a,d=filled();link=link_source(a,d);r=correction(a,d)
    contended(append(str(uuid.uuid4()),r),link,rejected('42501'))
    a,d=filled();link=link_source(a,d);r=correction(a,d)
    contended(link,append(str(uuid.uuid4()),r),success)
    check(sql(transaction(link),fail=False).returncode!=0,'Later link source read rejects corrected obsolete package')
    # Recheck clinical role after an observed wait on the authorization gate.
    a,d=filled();r=correction(a,d,'clinical_annotation')
    gate="select pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||"+quote(a)+"::text,0));"
    contended(gate+"delete from user_roles where user_id="+quote(actor)+" and role='DVM';",append(str(uuid.uuid4()),r),rejected('42501'))
    sql("insert into user_roles(user_id,role) values("+quote(actor)+",'DVM');")
    # Active-staff eligibility also gets rechecked after waiting, including reads.
    a,d=filled();r=correction(a,d)
    gate="select pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||"+quote(a)+"::text,0));"
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
print(f'Native correction concurrency: {checks} checks passed; no provider calls.')
