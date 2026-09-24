"""Actual local PostgreSQL contention; synthetic fixtures only, never provider calls."""
import argparse
from pathlib import Path
import concurrent.futures
import json
import subprocess
import time
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project-config', type=Path, help='Derive the database container from a Supabase TOML project_id')
args = parser.parse_args()
CONTAINER = 'supabase_db_livingroom-vet-foundation'
if args.project_config:
    import tomllib
    with args.project_config.open('rb') as config_file:
        CONTAINER = 'supabase_db_' + tomllib.load(config_file)['project_id']
COMMAND = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']

def sql(query, fail=True):
    result = subprocess.run(COMMAND, input=query, capture_output=True, text=True)
    if fail and result.returncode:
        raise AssertionError(result.stderr)
    return result

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

actor = str(uuid.uuid4())
client = str(uuid.uuid4())
product = str(uuid.uuid4())
ids = [actor, client, product]
origin = 'https://thelivingroom.vet'
created_profile = False
account = ''
checks = 0
owned_sessions = []

def check(condition, message):
    global checks
    assert condition, message
    checks += 1

staff = "set local role authenticated;select set_config('request.jwt.claims'," + quote(json.dumps({'sub': actor, 'role': 'authenticated'})) + ",true);"

def contended(first_query, second_query, second_expected):
    """Wait for an observed lock holder and then an observed lock waiter."""
    tag = 'lrv_collection_' + uuid.uuid4().hex
    owned_sessions.extend([tag + '_holder', tag + '_waiter'])
    first = subprocess.Popen(COMMAND, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write(f"set application_name='{tag}_holder';begin;{first_query}select pg_sleep(2);commit;")
    first.stdin.close()
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name='{tag}_holder' and wait_event='PgSleep';").stdout.strip() == '1':
            break
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
    first.wait(timeout=10)
    second.wait(timeout=10)
    first_error = first.stderr.read()
    second_output = second.stdout.read()
    second_error = second.stderr.read()
    check(first.returncode == 0, first_error)
    check(second_expected(second.returncode, second_output, second_error), second_error or second_output)

try:
    profiles = json.loads(sql("select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.payment_provider_profiles p;").stdout)
    check(not profiles or (len(profiles)==1 and not profiles[0]['livemode'] and profiles[0]['return_origin']==origin), 'Compatible local profile only')
    account = profiles[0]['account_id'] if profiles else 'acct_Reconcile'+uuid.uuid4().hex
    if not profiles:
        sql(f"select public.configure_payment_provider('{account}',false,'{origin}');")
        created_profile=True
    sql(f"insert into auth.users(id,email,raw_user_meta_data) values('{actor}','reconcile-{actor}@example.test','{{}}');update profiles set is_active=true where id='{actor}';insert into public.user_roles(user_id,role) values('{actor}','ADMIN');")
    client=sql(f"begin;{staff}select (public.save_client(auth.uid(),null,null,'Synthetic','Reconciliation',null,null,'EMAIL',null,null)).id;commit;").stdout.strip().splitlines()[-1]
    product=sql(f"begin;{staff}select (public.save_catalog_product(null,null,'Synthetic visit','service','','visit',10000,true)).id;commit;").stdout.strip().splitlines()[-1]
    ids.extend([client,product])
    for scenario in ['resolve_first','observation_first','repeat']:
        invoice,attempt,case=[str(uuid.uuid4()) for _ in range(3)]
        ids.extend([invoice,attempt,case])
        session='cs_test_'+uuid.uuid4().hex
        sql(f"""begin;{staff}
        select public.create_billing_invoice('{invoice}','{client}');
        select public.add_invoice_service(gen_random_uuid(),'{invoice}',null,'{product}',1);
        select public.issue_billing_invoice('{invoice}',(select version from public.billing_invoices where id='{invoice}'));
        select public.prepare_invoice_checkout('{attempt}','{invoice}','{client}',public.read_invoice_payment_state('{invoice}','{client}')->>'source_hash',10000,'{account}',false,'{origin}/payment/return','{origin}/payment/cancel');
        reset role;
        select public.apply_checkout_evidence('evt_{uuid.uuid4().hex}','{attempt}','{account}',false,'session_open','{session}',null,10000,'usd',(select source_hash from public.invoice_checkout_attempts where id='{attempt}'));
        select public.record_payment_reconciliation('checkout','{attempt}','provider_object_unavailable');
        select public.prepare_payment_reconciliation('{case}','{invoice}','checkout','{attempt}','{session}',t->'blocker_refs',t->>'snapshot_hash') from (select public.preview_payment_reconciliation('{invoice}','checkout','{attempt}','{session}') t) q;
        select public.capture_payment_reconciliation('{case}','{actor}',jsonb_build_object('family','checkout','request_id','{attempt}','object_id','{session}','account_id','{account}','livemode',false,'amount_cents','10000','currency','usd','provider_observed_at',clock_timestamp()::text,'status','session_expired','payment_id',null,'source_hash',(select source_hash from public.invoice_checkout_attempts where id='{attempt}')));
        commit;""")
        capture=json.loads(sql(f"select public.read_payment_reconciliation('{case}') from (select set_config('request.jwt.claims', '{json.dumps({'sub': actor, 'role': 'authenticated'})}',false)) q;").stdout.strip())
        complete=staff+f"select public.complete_payment_reconciliation('{case}','{capture['capture']['proof_hash']}','{capture['case']['snapshot_hash']}',true);"
        if scenario=='resolve_first':
            contended(complete,staff+f"select public.credit_billing_invoice(gen_random_uuid(),'{invoice}',100,'Synthetic credit');",lambda code,out,err:code==0)
            check(sql(f"select count(*) from public.billing_credits where invoice_id='{invoice}';").stdout.strip()=='1','Credit waits for verified expiry then succeeds')
        elif scenario=='observation_first':
            contended(f"select public.record_payment_reconciliation('checkout','{attempt}','provider_reconciliation_required');",complete,lambda code,out,err:code!=0 and 'Reconciliation facts changed' in err)
            check(sql(f"select count(*) from public.payment_reconciliation_resolutions where case_id='{case}';").stdout.strip()=='0','Concurrent new blocker invalidates review without partial resolution')
        else:
            contended(complete,complete,lambda code,out,err:code==0)
            check(sql(f"select count(*) from public.invoice_payment_evidence where event_id='reconcile:{case}';").stdout.strip()=='1','Concurrent completion applies evidence once')

    for provider_first in [True, False]:
        invoice,attempt,case,refund=[str(uuid.uuid4()) for _ in range(4)]
        ids.extend([invoice,attempt,case,refund])
        session,payment,provider_refund=['cs_test_'+uuid.uuid4().hex,'pi_'+uuid.uuid4().hex,'re_'+uuid.uuid4().hex]
        sql(f"""begin;{staff}
        select public.create_billing_invoice('{invoice}','{client}');
        select public.add_invoice_service(gen_random_uuid(),'{invoice}',null,'{product}',1);
        select public.issue_billing_invoice('{invoice}',(select version from public.billing_invoices where id='{invoice}'));
        select public.prepare_invoice_checkout('{attempt}','{invoice}','{client}',public.read_invoice_payment_state('{invoice}','{client}')->>'source_hash',10000,'{account}',false,'{origin}/payment/return','{origin}/payment/cancel');
        reset role;
        select public.apply_checkout_evidence('evt_{uuid.uuid4().hex}','{attempt}','{account}',false,'payment_succeeded','{session}','{payment}',10000,'usd',(select source_hash from public.invoice_checkout_attempts where id='{attempt}'));
        select public.credit_billing_invoice(gen_random_uuid(),'{invoice}',3000,'Synthetic adjustment');
        select public.prepare_invoice_refund('{refund}','{invoice}',(select id from public.invoice_payments where invoice_id='{invoice}'),2000,'Synthetic refund');
        select public.apply_refund_evidence('evt_{uuid.uuid4().hex}','{refund}','{account}',false,'{provider_refund}','{payment}',2000,'usd','pending');
        select public.record_payment_reconciliation('refund','{refund}','provider_object_unavailable');
        select public.prepare_payment_reconciliation('{case}','{invoice}','refund','{refund}','{provider_refund}',t->'blocker_refs',t->>'snapshot_hash') from (select public.preview_payment_reconciliation('{invoice}','refund','{refund}','{provider_refund}') t) q;
        select public.capture_payment_reconciliation('{case}','{actor}',jsonb_build_object('family','refund','request_id','{refund}','object_id','{provider_refund}','account_id','{account}','livemode',false,'amount_cents','2000','currency','usd','provider_observed_at',clock_timestamp()::text,'status','succeeded','provider_payment_id','{payment}'));
        commit;""")
        capture=json.loads(sql(f"select public.read_payment_reconciliation('{case}') from (select set_config('request.jwt.claims', '{json.dumps({'sub': actor, 'role': 'authenticated'})}',false)) q;").stdout.strip())
        complete=staff+f"select public.complete_payment_reconciliation('{case}','{capture['capture']['proof_hash']}','{capture['case']['snapshot_hash']}',true);"
        settle=f"select public.apply_refund_evidence('evt_{uuid.uuid4().hex}','{refund}','{account}',false,'{provider_refund}','{payment}',2000,'usd','succeeded');"
        if provider_first:
            contended(settle,complete,lambda code,out,err:code!=0 and 'Reconciliation facts changed' in err)
        else:
            contended(complete,settle,lambda code,out,err:code==0)
        check(sql(f"select count(*) from public.invoice_refunds where request_id='{refund}';").stdout.strip()=='1','Concurrent verified settlement and resolution post refund once')
        balance=json.loads(sql(f"select public.payment_balance_internal('{invoice}');").stdout.strip())
        check(balance['net_cash_cents']=='8000','Exactly one refund reduces net cash')
        check(balance['pending_refund_cents']=='0','Settled refund never retains duplicate pending capacity')
        check(balance['refundable_cents']=='1000','Remaining refundable capacity is exact')
        check(sql(f"select count(*) from public.payment_reconciliation_resolutions where case_id='{case}';").stdout.strip()==('0' if provider_first else '1'),'Only a current reviewed snapshot resolves its blockers')
        check(sql(f"select public.refund_state_internal('{refund}');").stdout.strip()==('reconciliation' if provider_first else 'succeeded'),'Stale review retains observation even though cash settled')

finally:
    if owned_sessions:
        names = ','.join(quote(name) for name in owned_sessions)
        sql(f"select pg_terminate_backend(pid) from pg_stat_activity where application_name in ({names}) and pid<>pg_backend_pid();")
    # Only rows referencing this run's random fixture identifiers are removed.
    patterns = ','.join(quote('%' + item + '%') for item in set(ids))
    sql(f"""begin;set local session_replication_role=replica;
      do $cleanup$ declare t record;begin
      for t in select schemaname,tablename from pg_tables where schemaname='public' loop
      execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[{patterns}];
      end loop;end $cleanup$;
      delete from auth.users where id='{actor}';
      {f"delete from public.payment_provider_profiles where account_id='{account}';" if created_profile else ''}
      commit;""")
    check(sql(f"select count(*) from public.payment_reconciliation_cases where actor_id='{actor}';").stdout.strip() == '0', 'Owned grant fixture cleanup verified')
print(f'Local reconciliation concurrency: {checks} checks passed; no provider requests.')
