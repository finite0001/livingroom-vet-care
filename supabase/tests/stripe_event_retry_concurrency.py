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
    profiles=json.loads(sql("select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.payment_provider_profiles p;").stdout)
    check(not profiles or (len(profiles)==1 and not profiles[0]['livemode'] and profiles[0]['return_origin']==origin),'Compatible local profile only')
    account=profiles[0]['account_id'] if profiles else 'acct_Retry'+uuid.uuid4().hex
    if not profiles:
        sql(f"select public.configure_payment_provider('{account}',false,'{origin}');")
        created_profile=True
    sql(f"insert into auth.users(id,email,raw_user_meta_data) values('{actor}','retry-{actor}@example.test','{{}}');update profiles set is_active=true where id='{actor}';insert into public.user_roles(user_id,role) values('{actor}','ADMIN');")
    client=sql(f"begin;{staff}select (public.save_client(auth.uid(),null,null,'Synthetic','Retry',null,null,'EMAIL',null,null)).id;commit;").stdout.strip().splitlines()[-1]
    product=sql(f"begin;{staff}select (public.save_catalog_product(null,null,'Synthetic visit','service','','visit',10000,true)).id;commit;").stdout.strip().splitlines()[-1]
    ids.extend([client,product])
    for scenario in ['double_review','old_worker','claim_skiplocked']:
        invoice,attempt,cycle=[str(uuid.uuid4()) for _ in range(3)]
        ids.extend([invoice,attempt,cycle])
        session='cs_test_'+uuid.uuid4().hex
        envelope={'event_id':'evt_'+uuid.uuid4().hex,'event_type':'checkout.session.completed','provider_created_at':1790000000,'account_id':account,'livemode':False,'object_id':session,'request_id':attempt,'raw_sha256':'a'*64,'disposition':'queued','reason':''}
        sql(f"""begin;{staff}
        select public.create_billing_invoice('{invoice}','{client}');
        select public.add_invoice_service(gen_random_uuid(),'{invoice}',null,'{product}',1);
        select public.issue_billing_invoice('{invoice}',(select version from public.billing_invoices where id='{invoice}'));
        select public.prepare_invoice_checkout('{attempt}','{invoice}','{client}',public.read_invoice_payment_state('{invoice}','{client}')->>'source_hash',10000,'{account}',false,'{origin}/payment/return','{origin}/payment/cancel');
        reset role;
        select public.apply_checkout_evidence('evt_{uuid.uuid4().hex}','{attempt}','{account}',false,'session_open','{session}',null,10000,'usd',(select source_hash from public.invoice_checkout_attempts where id='{attempt}'));
        commit;""")
        receipt=sql(f"select public.receive_stripe_event({quote(json.dumps(envelope))});").stdout.strip();ids.append(receipt)
        old_lease=''
        for _ in range(5):
            sql(f"update public.stripe_event_work set available_at=clock_timestamp()-interval '1 second' where receipt_id='{receipt}';")
            claimed=json.loads(sql('select public.claim_stripe_event();').stdout)
            check(claimed['receipt']['id']==receipt,'Fixture claims its own receipt')
            old_lease=claimed['lease_token']
            sql(f"select public.retry_stripe_event('{receipt}','{old_lease}','provider_unavailable');")
        preview=json.loads(sql(f"begin;{staff}select public.preview_stripe_event_retry('{receipt}');commit;").stdout.strip().splitlines()[-1]);work_hash=preview['expected_work_hash']
        def requeue(identifier):
            return staff+f"select public.requeue_stripe_event('{identifier}','{receipt}','{work_hash}','provider_recovered',true);"
        if scenario=='double_review':
            other=str(uuid.uuid4());ids.append(other)
            contended(requeue(cycle),requeue(other),lambda code,out,err:code!=0 and 'not eligible' in err)
        elif scenario=='old_worker':
            contended(requeue(cycle),f"select public.finish_stripe_event('{receipt}','{old_lease}','{{\"family\":\"quarantine\",\"reason\":\"provider_object_unavailable\"}}');",lambda code,out,err:code!=0 and 'lease is unavailable' in err)
        else:
            tag='lrv_retry_'+uuid.uuid4().hex;owned_sessions.append(tag)
            first=subprocess.Popen(COMMAND,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            first.stdin.write(f"set application_name='{tag}';begin;{requeue(cycle)}select pg_sleep(2);commit;");first.stdin.close()
            deadline=time.monotonic()+8
            while time.monotonic()<deadline:
                if sql(f"select count(*) from pg_stat_activity where application_name='{tag}' and wait_event='PgSleep';").stdout.strip()=='1':break
                time.sleep(.03)
            else:raise AssertionError('No observed retry-cycle lock holder')
            check(sql('select public.claim_stripe_event();').stdout.strip()=='','Worker skips administrator-locked receipt')
            first.wait(timeout=10);check(first.returncode==0,first.stderr.read())
        check(sql(f"select count(*) from public.stripe_event_retry_cycles where receipt_id='{receipt}';").stdout.strip()=='1','One reviewed cycle survives contention')
        claimed=json.loads(sql('select public.claim_stripe_event();').stdout)
        check(claimed['attempt_count']==6 and claimed['cycle_attempt_count']==1 and claimed['cycle_no']==1,'Next claim consumes first bounded retry-cycle attempt without resetting lifetime history')
        sql(f"select public.finish_stripe_event('{receipt}','{claimed['lease_token']}','{{\"family\":\"quarantine\",\"reason\":\"provider_object_unavailable\"}}');")

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
    check(sql(f"select count(*) from public.stripe_event_retry_cycles where actor_id='{actor}';").stdout.strip() == '0', 'Owned grant fixture cleanup verified')
print(f'Local Stripe retry concurrency: {checks} checks passed; no provider requests.')
