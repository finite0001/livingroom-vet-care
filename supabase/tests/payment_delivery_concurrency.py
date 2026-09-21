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

service="set local role service_role;select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);"
sender={"from":"billing@thelivingroom.vet","reply_to":"billing@thelivingroom.vet"}
proof=sender|{"payment_delivery_message_hash":"c"*64,"payment_delivery_payload_hash":"d"*64}
try:
    profiles=json.loads(sql("select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.payment_provider_profiles p;").stdout)
    check(not profiles or (len(profiles)==1 and not profiles[0]['livemode'] and profiles[0]['return_origin']==origin),'Compatible local profile only')
    account=profiles[0]['account_id'] if profiles else 'acct_Delivery'+uuid.uuid4().hex
    if not profiles:
        sql(f"select public.configure_payment_provider('{account}',false,'{origin}');")
        created_profile=True
    sql(f"insert into auth.users(id,email,raw_user_meta_data) values('{actor}','delivery-{actor}@example.test','{{}}');update profiles set is_active=true where id='{actor}';insert into user_roles(user_id,role) values('{actor}','STAFF');")
    client=sql(f"begin;{staff}select (public.save_client(auth.uid(),null,null,'Synthetic','Delivery',null,'delivery@example.test','EMAIL',null,null)).id;commit;").stdout.strip().splitlines()[-1]
    product=sql(f"begin;{staff}select (public.save_catalog_product(null,null,'Synthetic visit','service','','visit',10000,true)).id;commit;").stdout.strip().splitlines()[-1]
    conversation=str(uuid.uuid4())
    ids.extend([client,product,conversation])
    sql(f"insert into public.conversations(id,client_id) values('{conversation}','{client}');")
    for scenario in ['revoke_first','start_first','credit_first','repeat_enqueue']:
        invoice,grant,delivery,lease=[str(uuid.uuid4()) for _ in range(4)]
        ids.extend([invoice,grant,delivery,lease])
        sql(f"""begin;{staff}
        select public.create_billing_invoice('{invoice}','{client}');
        select public.add_invoice_service(gen_random_uuid(),'{invoice}',null,'{product}',1);
        select public.issue_billing_invoice('{invoice}',(select version from public.billing_invoices where id='{invoice}'));
        select public.prepare_payment_collection('{grant}','{invoice}','{client}',public.read_invoice_payment_state('{invoice}','{client}')->>'source_hash',10000,now()+interval '6 days');
        {service}
        select public.capture_payment_collection('{grant}','{actor}','{origin}','local-v1',repeat('a',64),repeat('b',64));
        {staff}
        select public.attest_payment_collection('{grant}',public.recover_payment_collection('{invoice}','{grant}')#>>'{{capture,context_hash}}',true);
        select public.prepare_payment_delivery('{delivery}','{grant}','{conversation}','EMAIL','delivery@example.test','Invoice','Pay: {{{{payment_link}}}}');
        {service}
        select public.capture_payment_delivery('{delivery}','{actor}',{quote(json.dumps(sender))},repeat('c',64),repeat('d',64));
        commit;""")
        enqueue=staff+f"select public.enqueue_payment_delivery('{delivery}',repeat('c',64),repeat('d',64),true);"
        if scenario=='repeat_enqueue':
            contended(enqueue,enqueue,lambda code,out,err:code==0)
            check(sql(f"select count(*) from public.communication_outbox where request_id='{delivery}';").stdout.strip()=='1','Concurrent reviewed queue retries create one outbox row')
            continue
        sql('begin;'+enqueue+'commit;')
        outbox=sql(f"select outbox_id from public.payment_delivery_outbox_links where request_id='{delivery}';").stdout.strip()
        ids.append(outbox)
        sql(f"update public.communication_outbox set state='claimed',lease_token='{lease}',lease_expires_at=now()+interval '5 minutes' where id='{outbox}';")
        start=service+f"select (public.start_communication_attempt('{outbox}','{lease}',{quote(json.dumps(proof))})).state;"
        revoke=staff+f"select public.revoke_payment_collection('{grant}','Synthetic revocation');"
        if scenario=='revoke_first':
            contended(revoke,start,lambda code,out,err:code==0 and out.strip().splitlines()[-1]=='failed')
        elif scenario=='start_first':
            contended(start,revoke,lambda code,out,err:code==0)
        else:
            credit=staff+f"select public.credit_billing_invoice(gen_random_uuid(),'{invoice}',100,'Synthetic adjustment');"
            contended(credit,start,lambda code,out,err:code==0 and out.strip().splitlines()[-1]=='failed')
        state=json.loads(sql(f"select jsonb_build_object('started',attempt_started_at is not null,'state',state,'config',provider_config) from public.communication_outbox where id='{outbox}';").stdout)
        check(state['started']==(scenario=='start_first'),'Only a start authorized before revocation records an attempt')
        check(state['config']==(sender if scenario=='start_first' else None),'Guard proof never persists as sender metadata')

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
    check(sql(f"select count(*) from public.payment_delivery_requests where actor_id='{actor}';").stdout.strip() == '0', 'Owned grant fixture cleanup verified')
print(f'Local payment delivery concurrency: {checks} checks passed; no provider requests.')
