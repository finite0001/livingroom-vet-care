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

def activation(grant):
    return f"select public.activate_payment_collection('{grant}',repeat('a',64),'{origin}','local-v1',true);"

def credit(invoice):
    return f"select public.credit_billing_invoice(gen_random_uuid(),'{invoice}',100,'Synthetic concurrency adjustment');"

def parallel_activation(grant):
    def call(_):
        result = sql('begin;set local role service_role;' + activation(grant) + 'commit;')
        return json.loads(result.stdout.strip())['attempt']['id']
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(call, range(8)))
    check(len(set(results)) == 1, 'Concurrent clicks must reuse one immutable attempt')
    ids.extend(results)
    return results[0]

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
    check(not profiles or (len(profiles) == 1 and profiles[0]['return_origin'] == origin and not profiles[0]['livemode']), 'Only compatible local test profile may be reused')
    if profiles:
        account = profiles[0]['account_id']
    else:
        account = 'acct_Local' + uuid.uuid4().hex
        sql(f"select public.configure_payment_provider('{account}',false,'{origin}');")
        created_profile = True
    sql(f"insert into auth.users(id,email,raw_user_meta_data) values('{actor}','collection-{actor}@example.test','{{}}');")
    client = sql(f"begin;{staff}select (public.save_client(auth.uid(),null,null,'Synthetic','Concurrency',null,null,'EMAIL',null,null)).id;commit;").stdout.strip().splitlines()[-1]
    product = sql(f"begin;{staff}select (public.save_catalog_product(null,null,'Synthetic visit','service','','visit',10000,true)).id;commit;").stdout.strip().splitlines()[-1]
    ids.extend([client, product])
    scenarios = {}
    for name in ['repeat', 'credit_first', 'activate_first', 'payment_first']:
        invoice, grant = str(uuid.uuid4()), str(uuid.uuid4())
        ids.extend([invoice, grant])
        scenarios[name] = (invoice, grant)
        sql(f"""begin;{staff}
          select public.create_billing_invoice('{invoice}','{client}');
          select public.add_invoice_service(gen_random_uuid(),'{invoice}',null,'{product}',1);
          select public.issue_billing_invoice('{invoice}',(select version from public.billing_invoices where id='{invoice}'));
          select public.prepare_payment_collection('{grant}','{invoice}','{client}',public.read_invoice_payment_state('{invoice}','{client}')->>'source_hash',10000,now()+interval '6 days');
          set local role service_role;
          select public.capture_payment_collection('{grant}','{actor}','{origin}','local-v1',repeat('a',64),repeat('b',64));
          {staff}
          select public.attest_payment_collection('{grant}',public.recover_payment_collection('{invoice}','{grant}')#>>'{{capture,context_hash}}',true);
          commit;""")
    invoice, grant = scenarios['repeat']
    first_attempt = parallel_activation(grant)
    check(sql(f"select count(*) from public.payment_collection_attempts where grant_id='{grant}';").stdout.strip() == '1', 'One persisted attempt after eight clicks')
    sql(f"select public.apply_checkout_evidence('evt_{uuid.uuid4().hex}','{first_attempt}','{account}',false,'session_expired','cs_test_expiry',null,10000,'usd',(select source_hash from public.invoice_checkout_attempts where id='{first_attempt}'));")
    renewed = parallel_activation(grant)
    check(renewed != first_attempt, 'Authoritative expiry permits replacement')
    check(sql(f"select count(*) from public.payment_collection_attempts where grant_id='{grant}';").stdout.strip() == '2', 'Eight renewal clicks produce exactly one replacement')
    invoice, grant = scenarios['credit_first']
    contended(staff + credit(invoice), 'set local role service_role;' + activation(grant), lambda code, out, err: code != 0 and 'Payment collection source changed' in err)
    check(sql(f"select count(*) from public.payment_collection_attempts where grant_id='{grant}';").stdout.strip() == '0', 'Unopened grant never prevents credit; changed source cannot activate')
    invoice, grant = scenarios['activate_first']
    contended('set local role service_role;' + activation(grant), staff + credit(invoice), lambda code, out, err: code != 0 and 'Resolve existing checkout first' in err)
    check(sql(f"select count(*) from public.billing_credits where invoice_id='{invoice}';").stdout.strip() == '0', 'Activation winner leaves no competing credit')
    invoice, grant = scenarios['payment_first']
    attempt = parallel_activation(grant)
    evidence = f"select public.apply_checkout_evidence('evt_{uuid.uuid4().hex}','{attempt}','{account}',false,'payment_succeeded','cs_test_paid','pi_{uuid.uuid4().hex}',10000,'usd',(select source_hash from public.invoice_checkout_attempts where id='{attempt}'));"
    contended(evidence, 'set local role service_role;' + activation(grant), lambda code, out, err: code == 0 and json.loads(out.strip())['state'] == 'paid')
    check(sql(f"select count(*) from public.payment_collection_attempts where grant_id='{grant}';").stdout.strip() == '1', 'Concurrent payment confirmation never creates another attempt')
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
    check(sql(f"select count(*) from public.payment_collection_grants where actor_id='{actor}';").stdout.strip() == '0', 'Owned grant fixture cleanup verified')
print(f'Local payment collection concurrency: {checks} checks passed; no provider requests.')
