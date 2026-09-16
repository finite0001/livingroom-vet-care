"""Observed native finance PostgreSQL contention; owned local schema clone and synthetic evidence only."""
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

def contended(first_query, second_query, second_expected, first_tail=""):
    """Wait for an observed lock holder and then an observed lock waiter."""
    tag = 'lrv_finance_' + uuid.uuid4().hex
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
    first.stdin.write(first_tail + 'commit;\n')
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
database='lrv_native_finance_race_'+uuid.uuid4().hex
marker='owned-native-finance-race-'+uuid.uuid4().hex
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
    def filled(inv=None):
        a=signed();t=target(a,lot(),inv=inv);d=str(uuid.uuid4())
        invoke('record_native_dispense',quote(d),jsonsql(reviewed(t)))
        return a,d,t

    def issue(inv):
        version=scalar('select version from billing_invoices where id='+quote(inv)+';')
        invoke('issue_billing_invoice',quote(inv),version)
    def ready():
        a,d,t=filled();issue(t['invoice_id']);return a,d,t
    def financial_target(a,d):
        return dict(authorization_id=a,pet_id=fx['pet'],dispense_id=d)
    def finance_intent(a,d,amount='100',action='credit',credit=None,payment=None):
        return dict(target=financial_target(a,d),action=action,amount_cents=amount,
                    reason='Synthetic reviewed financial adjustment',credit_id=credit,payment_id=payment)
    def finance_review(intent):
        p=invoke('preview_native_dispense_finance',jsonsql(intent))
        check(p['allowed'],'Synthetic finance intent allowed before contention: '+json.dumps(p['blockers']))
        return dict(intent=intent,expected_context_hash=p['context_hash'],attest_review=True)
    def finance_write(op,request):return operation('record_native_dispense_finance',op,request)
    def finance_read(a,d):return invoke('read_native_dispense_finance',quote(a),quote(fx['pet']),quote(d))
    def finance_recover(op):return invoke('recover_native_dispense_finance',quote(op))
    def credit(a,d,amount='100'):
        op=str(uuid.uuid4());r=invoke('record_native_dispense_finance',quote(op),jsonsql(finance_review(finance_intent(a,d,amount))))
        check(r['result']['credit_id']==op,'Native credit uses operation UUID as ledger UUID')
        return op
    def generic(op,inv,amount='100'):
        return staff+call('credit_billing_invoice',quote(op),quote(inv),amount,quote('Synthetic reviewed financial adjustment'))
    def original(a,d,t):
        return scalar("select jsonb_build_object('dispense',to_jsonb(d),'items',(select jsonb_agg(to_jsonb(i) order by id) from billing_invoice_items i where invoice_id="+quote(t['invoice_id'])+"),'movements',(select jsonb_agg(to_jsonb(m) order by id) from inventory_movements m where lot_id="+quote(t['allocations'][0]['lot_id'])+"),'usage',native_rx_usage_context("+quote(a)+")) from native_dispenses d where id="+quote(d)+';')
    def untouched(a,d,t,before):check(original(a,d,t)==before,'Financial adjustment leaves dispense, item, stock and allowance unchanged')
    def credit_count(inv):return scalar('select count(*) from billing_credits where invoice_id='+quote(inv)+';')
    def generic_refund(op,inv,payment,amount):
        return staff+call('prepare_invoice_refund',quote(op),quote(inv),quote(payment),amount,quote('Synthetic reviewed financial adjustment'))

    # Same review against one item, different operation IDs: the invoice/authorization
    # locks serialize, and stale review must not create a second credit.
    a,d,t=ready();before=original(a,d,t);request=finance_review(finance_intent(a,d,'150'))
    one,two=str(uuid.uuid4()),str(uuid.uuid4())
    contended(finance_write(one,request),finance_write(two,request),rejected('40001'))
    check(credit_count(t['invoice_id'])=='1','Competing native credits record one winner')
    check(finance_recover(two) is None,'Stale credit leaves no operation receipt')
    check(finance_read(a,d)['snapshot']['capacity']['credit_capacity_cents']=='50','Winning native credit consumes exact item capacity')
    untouched(a,d,t,before)

    # Exact-ID retries return a single frozen receipt after waiting.
    a,d,t=ready();request=finance_review(finance_intent(a,d));op=str(uuid.uuid4())
    contended(finance_write(op,request),finance_write(op,request),success)
    check(credit_count(t['invoice_id'])=='1','Exact native credit retry never duplicates ledger credit')
    check(finance_recover(op)['request']==request,'Recovered native receipt binds the original request')

    # Different authorization locks still converge on the same invoice row lock.
    inv=invoice();a,d,t=filled(inv);a2,d2,t2=filled(inv);issue(inv)
    first_request=finance_review(finance_intent(a,d));second_request=finance_review(finance_intent(a2,d2))
    op2=str(uuid.uuid4())
    contended(finance_write(str(uuid.uuid4()),first_request),finance_write(op2,second_request),rejected('40001'))
    check(finance_recover(op2) is None,'Other dispense on same invoice must refresh its financial review')
    check(finance_read(a2,d2)['snapshot']['capacity']['credit_capacity_cents']=='200','Other attributed dispense credit does not consume selected item capacity')
    credit(a2,d2)
    check(credit_count(inv)=='2','Refreshed second dispense credit can commit within invoice capacity')

    # Generic credit first invalidates the native review and conservatively consumes
    # its item capacity, even though no generic item attribution is guessed.
    a,d,t=ready();request=finance_review(finance_intent(a,d));op=str(uuid.uuid4())
    contended(generic(str(uuid.uuid4()),t['invoice_id'],'50'),finance_write(op,request),rejected('40001'))
    cap=finance_read(a,d)['snapshot']['capacity']
    check(cap['unallocated_credit_cents']=='50' and cap['credit_capacity_cents']=='150','Unallocated credit is conservatively counted')
    check(finance_recover(op) is None,'Generic conflict leaves no native receipt')

    # In the reverse order generic RPC still respects invoice-wide capacity.
    a,d,t=ready();request=finance_review(finance_intent(a,d,'150'))
    contended(finance_write(str(uuid.uuid4()),request),generic(str(uuid.uuid4()),t['invoice_id'],'100'),rejected('23514'))
    check(credit_count(t['invoice_id'])=='1','Generic credit cannot overrun a committed native credit')

    # A matching generic row is never retrospectively adopted as native evidence.
    a,d,t=ready();request=finance_review(finance_intent(a,d));op=str(uuid.uuid4())
    contended(generic(op,t['invoice_id']),finance_write(op,request),rejected('23514'))
    check(finance_recover(op) is None,'Same-ID generic credit cannot be adopted into a native receipt')
    check(finance_read(a,d)['snapshot']['capacity']['linked_credit_cents']=='0','Generic same-ID collision has no invented attribution')
    a,d,t=ready();request=finance_review(finance_intent(a,d));op=str(uuid.uuid4())
    contended(finance_write(op,request),generic(op,t['invoice_id']),success)
    check(credit_count(t['invoice_id'])=='1','Matching generic retry after native credit does not duplicate credit')

    # Real inversion probe: holder initially owns ONLY bare UUID lock. Finance
    # waiter must block on it before taking authorization. After wait is observed,
    # holder appends a real return using that UUID and authorization. If finance
    # acquired authorization first this creates an actual detectable deadlock.
    a,d,t=ready();request=finance_review(finance_intent(a,d));op=str(uuid.uuid4())
    current=invoke('read_native_dispense_returns_v2',quote(a),quote(fx['pet']),quote(d))
    return_intent=dict(target=financial_target(a,d),action='intake',intake_id=None,
        correction_target=None,discrepancy_id=None,
        allocations=[dict(allocation_id=current['allocations'][0]['allocation_id'],quantity='1')],
        custody='clinic_retained',package_condition='sealed_intact',storage_history='controlled',
        reason='Synthetic lock-order intake',note='Synthetic physical custody only')
    p=invoke('preview_native_dispense_return_v2',jsonsql(return_intent))
    check(p['allowed'],'Return intake allowed for real lock-order probe')
    return_request=dict(intent=return_intent,expected_context_hash=p['context_hash'],
        expected_head=p['context']['head'],expected_discrepancy_head=p['context']['discrepancy_head'],
        attest_review=True,attest_restock=False,physical_attestations=dict(
            reviewed_physical_facts=True,intake_claim_incorrect=False,remains_physically_held=False,
            was_not_destroyed=False,removed_from_available_stock=False))
    bare_gate='select pg_advisory_xact_lock(hashtextextended('+quote(op)+'::text,0));'
    contended(bare_gate,finance_write(op,request),rejected('40001'),
              operation('record_native_dispense_return_v2',op,return_request))
    check(finance_recover(op) is None,'Changed return head prevents stale finance commit without deadlock')
    check(invoke('recover_native_dispense_return_v2',quote(op)) is not None,'Actual return commits after observed bare-ID wait')

    # Only synthetic local evidence RPCs below: no Stripe transport is configured
    # or called. Provider-looking IDs are unique fixture values inside the clone.
    sql("select configure_payment_provider('acct_financefixture',false,'https://finance.example.test');")
    def paid():
        a,d,t=ready();inv=t['invoice_id'];state=invoke('read_invoice_payment_state',quote(inv),quote(fx['client']))
        attempt=str(uuid.uuid4());suffix=uuid.uuid4().hex;provider_payment='pi_'+suffix
        invoke('prepare_invoice_checkout',quote(attempt),quote(inv),quote(fx['client']),quote(state['source_hash']),
               state['balance']['outstanding_cents'],quote('acct_financefixture'),'false',
               quote('https://finance.example.test/payment/return'),quote('https://finance.example.test/payment/cancel'))
        sql(call('apply_checkout_evidence',quote('fixturepaid'+suffix),quote(attempt),quote('acct_financefixture'),'false',
                 quote('payment_succeeded'),quote('cs_'+suffix),quote(provider_payment),state['balance']['outstanding_cents'],
                 quote('usd'),quote(state['source_hash'])))
        payment=invoke('read_invoice_payment_state',quote(inv),quote(fx['client']))['payments'][0]['id']
        return a,d,t,payment,provider_payment
    def evidence(op,provider_payment,amount,status):
        return call('apply_refund_evidence',quote('fixture'+uuid.uuid4().hex),quote(op),quote('acct_financefixture'),
                    'false',quote('re_'+op.replace('-','')),quote(provider_payment),amount,quote('usd'),quote(status))
    def refund_review(a,d,credit_id,payment,amount):
        return finance_review(finance_intent(a,d,amount,'refund',credit_id,payment))
    def refund_capacity(a,d,credit_id,payment):
        return invoke('preview_native_dispense_finance',jsonsql(finance_intent(a,d,'1','refund',credit_id,payment)))['context']['eligible_amount_cents']
    a,d,t,payment,provider_payment=paid();before=original(a,d,t);c=credit(a,d,'150')
    request=refund_review(a,d,c,payment,'100');one,two=str(uuid.uuid4()),str(uuid.uuid4())
    contended(finance_write(one,request),finance_write(two,request),rejected('40001'))
    check(finance_recover(two) is None,'Concurrent reservation loser has no receipt')
    check(refund_capacity(a,d,c,payment)=='50','Pending or lost-response reservation consumes linked capacity')
    frozen=finance_recover(one)
    contended(evidence(one,provider_payment,'100','failed'),finance_write(str(uuid.uuid4()),refund_review(a,d,c,payment,'50')),rejected('40001'))
    check(refund_capacity(a,d,c,payment)=='150','Authoritative failure releases linked reservation capacity')
    check(finance_recover(one)==frozen,'Later provider failure does not rewrite original reservation receipt')
    request=refund_review(a,d,c,payment,'100');settled=str(uuid.uuid4())
    invoke('record_native_dispense_finance',quote(settled),jsonsql(request))
    settled_receipt=finance_recover(settled)
    contended(evidence(settled,provider_payment,'100','succeeded'),
              finance_write(str(uuid.uuid4()),refund_review(a,d,c,payment,'50')),rejected('40001'))
    check(refund_capacity(a,d,c,payment)=='50','Settled refund consumes capacity once, without pending double count')
    snap=finance_read(a,d)['snapshot']
    check(snap['balance']['pending_refund_cents']=='0' and snap['balance']['refunded_cents']=='100','Settlement moves reservation into confirmed cash history')
    check(finance_recover(settled)==settled_receipt,'Settlement keeps frozen reservation receipt unchanged')
    sql(evidence(settled,provider_payment,'100','failed'))
    check(refund_capacity(a,d,c,payment)=='50','Late failure cannot release an already settled refund')
    sql(call('record_payment_reconciliation',quote('refund'),quote(settled),quote('provider_object_unavailable')))
    snap=finance_read(a,d)['snapshot']
    check(snap['balance']['pending_refund_cents']=='0' and snap['balance']['refunded_cents']=='100',
          'Settled refund under reconciliation is not counted as a second reservation')
    check(refund_capacity(a,d,c,payment)=='0','Unresolved provider observation blocks new financial reservations')
    check(finance_recover(settled)==settled_receipt,'Reconciliation does not rewrite frozen reservation receipt')
    untouched(a,d,t,before)

    # Native/generic refund contention and same-ID adoption use the seed-3003
    # gate. Ledger reservation capacity remains shared across both entry points.
    a,d,t,payment,provider_payment=paid();c=credit(a,d,'150');op=str(uuid.uuid4())
    request=refund_review(a,d,c,payment,'100')
    contended(generic_refund(op,t['invoice_id'],payment,'100'),finance_write(op,request),rejected('23514'))
    check(finance_recover(op) is None,'Preexisting generic refund is not adopted into native attribution')
    check(refund_capacity(a,d,c,payment)=='50','Generic pending reservation consumes shared invoice cash')

    # Cross-kind collision: native credit must also acquire the refund UUID gate
    # BEFORE authorization/invoice, then refuse the committed generic refund ID.
    a,d,t,payment,provider_payment=paid();c=credit(a,d,'100');op=str(uuid.uuid4())
    request=finance_review(finance_intent(a,d,'50'))
    contended(generic_refund(op,t['invoice_id'],payment,'50'),finance_write(op,request),rejected('23514'))
    check(finance_recover(op) is None,'Native credit refuses same UUID already used by generic refund')
    check(credit_count(t['invoice_id'])=='1','Cross-kind ID collision does not append another credit')

    # Recheck staff after an observed authorization wait; statement-start auth
    # alone is insufficient when deactivation commits while the writer blocks.
    a,d,t=ready();request=finance_review(finance_intent(a,d));op=str(uuid.uuid4())
    gate="select pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||"+quote(a)+"::text,0));"
    contended(gate+'update profiles set is_active=false where id='+quote(actor)+';',finance_write(op,request),rejected('42501'))
    check(credit_count(t['invoice_id'])=='0','Deactivated waiting staff cannot create any ledger credit')
    sql('update profiles set is_active=true where id='+quote(actor)+';')
    check(finance_recover(op) is None,'Deactivated waiting staff leaves no native receipt')

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
print(f'Native finance concurrency: {checks} checks passed; no provider calls.')
