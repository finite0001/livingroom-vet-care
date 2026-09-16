"""Observed native estimate publication PostgreSQL contention; owned local schema clone and synthetic evidence only."""
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

def contended(first_query, second_query, second_expected, first_tail="", first_end="commit"):
    """Wait for an observed lock holder and then an observed lock waiter."""
    tag = 'lrv_estpub_' + uuid.uuid4().hex
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
    if first_end not in ('commit', 'rollback'):
        raise AssertionError('Only explicit transaction completion supported')
    first.stdin.write(first_tail + first_end + ';\n')
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
labels=json.loads(inspection.stdout)[0]['Config']['Labels']
check(labels['com.supabase.cli.project']==project_id,'Verified local project label')
check(Path(labels['com.supabase.cli.workdir']).resolve()==args.project_config.resolve().parent.parent,'Verified exact local project workdir; only an owned schema clone is mutated')
database='lrv_estimate_publication_race_'+uuid.uuid4().hex
marker='owned-estimate-publication-race-'+uuid.uuid4().hex
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
    saved=json.loads(scalar('begin;set local search_path=public,extensions;'+fixture+"select jsonb_build_object('fx',(select jsonb_object_agg(k,id) from fx));commit;"))
    fx=saved['fx']
    def success(code,out,err):return code==0
    def rejected(*codes):return lambda code,out,err:code!=0 and any(c in err for c in codes)
    def product(kind):
        return invoke('save_catalog_product','null','null',quote('Synthetic '+kind),quote(kind),quote(''),quote('unit'),'125','true')
    products=[product(kind) for kind in ('service','medication','vaccine')]
    def fields():
        return dict(title='Synthetic complete estimate',notes='Draft only; no clinical action',terms='Synthetic draft terms',accept_by='2099-12-31',lines=[
            dict(id=str(uuid.uuid4()),product_id=p['id'],product_version=p['version'],description='Synthetic '+p['kind'],kind=p['kind'],unit=p['unit'],quantity='1',pricing=dict(kind='unit',unit_price_cents='125'),pricing_reason=None) for p in products])
    def request(estimate=None,version=None):return dict(estimate_id=estimate or str(uuid.uuid4()),client_id=fx['client'],pet_id=fx['pet'],expected_version=version,fields=fields())
    import base64
    artifact_html = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"></head><body>Synthetic publication lock fixture</body></html>'
    encoded = base64.b64encode(artifact_html.encode()).decode()
    service = "set local role service_role;select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);"
    def capture_sql(preparation):
        return service + call('capture_native_estimate_publication_artifact', quote(preparation['id']), quote(actor), quote(preparation['content_hash']), '1', quote(encoded))
    def prepared(estimate_request=None, capture=True):
        r = estimate_request or request()
        draft = invoke('save_native_estimate_draft', quote(str(uuid.uuid4())), jsonsql(r))['result']
        preview = invoke('preview_native_estimate_publication', quote(r['estimate_id']), quote(fx['client']), str(draft['version']))
        context = preview['context']
        q = dict(target=context['target'], draft_version=draft['version'], expected_source_hash=preview['source_hash'],
                 expected_publication_head=context['publication_head'], replaces_publication_id=context['current_publication_id'])
        p = invoke('prepare_native_estimate_publication', quote(str(uuid.uuid4())), jsonsql(q))
        if capture:
            sql('begin;' + capture_sql(p) + 'commit;')
            p = invoke('recover_native_estimate_preparation', quote(p['id']))
        return r, p
    def publishing(p):
        return dict(target=p['request']['target'], preparation_id=p['id'], expected_draft_version=p['request']['draft_version'],
                    expected_publication_head=p['request']['expected_publication_head'], expected_content_hash=p['content_hash'],
                    expected_artifact_hash=p['artifact']['sha256'], replaces_publication_id=p['request']['replaces_publication_id'],
                    attest_document_review=True, attest_pricing_review=True, attest_terms_review=True)
    def publish(op, q):return operation('publish_native_estimate', op, q)
    def recover(op):return invoke('recover_native_estimate_publication_operation', quote(op))
    def current(r):return invoke('read_native_estimate_publication', quote(r['estimate_id']), quote(fx['client']))
    def closing(op,q,status):
        mutation=dict(kind='publish',request=q)
        return staff+"do $estimate_test$ declare v jsonb; begin v:=close_native_estimate_publication_operation("+quote(op)+','+jsonsql(mutation)+");if v->>'status' is distinct from "+quote(status)+" then raise exception 'Unexpected publication closure outcome';end if;end $estimate_test$;"
    def gate(r):return "select pg_advisory_xact_lock(hashtextextended('native-estimate:'||"+quote(r['estimate_id'])+"::text,0));"
    def effects():
        names=['patient_treatments','native_prescription_authorizations','native_dispenses','inventory_movements','billing_invoices','billing_invoice_items','billing_credits','invoice_payments','invoice_refund_requests','communication_outbox']
        return scalar('select jsonb_build_object('+','.join(quote(n)+',(select count(*) from '+n+')' for n in names)+');')
    original=effects()

    r,p=prepared();q=publishing(p);op=str(uuid.uuid4())
    contended(publish(op,q),publish(op,q),success)
    check(current(r)['head']['version']==1 and recover(op)['result']['publication_id']==op,'Exact competing publication retries record one lifecycle event')

    r,p=prepared();q=publishing(p);op=str(uuid.uuid4())
    changed={**r,'expected_version':1,'fields':{**r['fields'],'title':'Changed while publication waits'}}
    contended(operation('save_native_estimate_draft',str(uuid.uuid4()),changed),publish(op,q),rejected('40001'))
    check(recover(op) is None and current(r)['current'] is None,'Draft edit wins; stale publication has no receipt')

    r,p=prepared();q=publishing(p);op=str(uuid.uuid4())
    contended('update clients set full_name=full_name||\' changed\',version=version+1 where id='+quote(fx['client'])+';',publish(op,q),rejected('40001'))
    check(recover(op) is None and current(r)['current'] is None,'Locked household change invalidates reviewed source after wait')

    r,p=prepared();q=publishing(p);op=str(uuid.uuid4())
    contended(closing(op,q,'closed_unrecorded'),publish(op,q),rejected('23514'))
    check(recover(op) is None and current(r)['current'] is None,'Terminal close prevents delayed publication')
    r,p=prepared();q=publishing(p);op=str(uuid.uuid4())
    contended(publish(op,q),closing(op,q,'recorded'),success)
    check(recover(op) is not None and current(r)['head']['version']==1,'Write-first close recovers publication without duplicate event')
    r,p=prepared();q=publishing(p);op=str(uuid.uuid4())
    contended(publish(op,q),closing(op,q,'closed_unrecorded'),success,first_end='rollback')
    check(recover(op) is None and current(r)['current'] is None,'Rolled-back publication permits terminal closure')
    r,p=prepared();q=publishing(p);op=str(uuid.uuid4())
    contended(closing(op,q,'closed_unrecorded'),publish(op,q),success,first_end='rollback')
    check(recover(op) is not None,'Rolled-back closure permits original publication')

    r,p=prepared();q=publishing(p);op=str(uuid.uuid4())
    contended(gate(r)+'update profiles set is_active=false where id='+quote(actor)+';',publish(op,q),rejected('42501'))
    sql('update profiles set is_active=true where id='+quote(actor)+';')
    check(recover(op) is None and current(r)['current'] is None,'Staff revoked during root wait cannot publish')

    r,p=prepared();q=publishing(p);first=str(uuid.uuid4());second=str(uuid.uuid4())
    contended(publish(first,q),publish(second,q),rejected('40001'))
    check(recover(first) is not None and recover(second) is None,'Distinct competing publication intent requires fresh lifecycle review')

    r,p=prepared();first=str(uuid.uuid4());invoke('publish_native_estimate',quote(first),jsonsql(publishing(p)))
    edited={**r,'expected_version':1,'fields':{**r['fields'],'title':'Replacement proposal'}}
    r2,p2=prepared(edited);replacement=str(uuid.uuid4());withdrawal=str(uuid.uuid4())
    w=dict(target=p2['request']['target'],publication_id=first,expected_publication_head=p2['request']['expected_publication_head'],reason='Synthetic withdrawal',attest_review=True)
    contended(publish(replacement,publishing(p2)),operation('withdraw_native_estimate',withdrawal,w),rejected('40001'))
    check(current(r)['current']['id']==replacement and recover(withdrawal) is None,'Atomic replacement prevents stale withdrawal of predecessor')

    # Capture and publish serialize at the root without taking preparation gate after root.
    r,p=prepared(capture=False)
    import hashlib
    fake={**p,'artifact':{'sha256':hashlib.sha256(artifact_html.encode()).hexdigest()}}
    q=publishing(fake);op=str(uuid.uuid4())
    contended(capture_sql(p),publish(op,q),success)
    check(recover(op) is not None,'Publication waits for capture and binds committed bytes')
    r,p=prepared(capture=False);fake={**p,'artifact':{'sha256':hashlib.sha256(artifact_html.encode()).hexdigest()}}
    q=publishing(fake);op=str(uuid.uuid4())
    contended(capture_sql(p),publish(op,q),rejected('23514'),first_end='rollback')
    check(recover(op) is None and invoke('recover_native_estimate_preparation',quote(p['id']))['artifact'] is None,'Rolled-back capture cannot authorize publication')
    not_ready=staff+gate(r)+"do $capture_race$ begin begin perform publish_native_estimate("+quote(op)+','+jsonsql(q)+");raise exception 'Unexpected publication without artifact';exception when check_violation then null;end;end $capture_race$;"
    contended(not_ready,capture_sql(p),success)
    check(recover(op) is None and invoke('recover_native_estimate_preparation',quote(p['id']))['artifact'] is not None,'Not-ready publication releases root for later capture without a publication event')
    invoke('publish_native_estimate',quote(op),jsonsql(q))
    check(recover(op) is not None,'Exact publication retry works only after committed capture')

    r,p=prepared();first=str(uuid.uuid4());invoke('publish_native_estimate',quote(first),jsonsql(publishing(p)))
    edited={**r,'expected_version':1,'fields':{**r['fields'],'title':'Withdrawal wins'}}
    _,p2=prepared(edited);replacement=str(uuid.uuid4());withdrawal=str(uuid.uuid4())
    w=dict(target=p2['request']['target'],publication_id=first,expected_publication_head=p2['request']['expected_publication_head'],reason='Synthetic withdrawal first',attest_review=True)
    contended(operation('withdraw_native_estimate',withdrawal,w),publish(replacement,publishing(p2)),rejected('40001'))
    check(current(r)['current_status']=='withdrawn' and recover(replacement) is None,'Withdrawal invalidates stale replacement review after observed root wait')

    # Real wall-clock evidence, not a simulated midnight crossing: the waiter must
    # sample time after the holder records its release instant.
    sql('create table publication_race_release_clock(stamp timestamptz not null);')
    r,p=prepared();q=publishing(p);op=str(uuid.uuid4())
    contended(gate(r),publish(op,q),success,first_tail='insert into publication_race_release_clock values(clock_timestamp());')
    check(scalar("select (document#>>'{publication,published_at}')::timestamptz >= (select stamp from publication_race_release_clock) from native_estimate_publication_events where id="+quote(op)+';')=='t','Published time is sampled after the actual lock release, not at transaction start')
    check(effects()==original,'Publication and closure create no clinical, stock, invoice, payment or outbox effects')

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
print(f'Estimate publication concurrency: {checks} checks passed; no provider calls.')
