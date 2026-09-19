"""Observed native estimate decision PostgreSQL contention; owned local schema clone and synthetic evidence only."""
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
    if not project_id.startswith('lrv-prescription-'):
        raise AssertionError('Only runner-owned lrv-prescription projects are supported')
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
    tag = 'lrv_estdec_' + uuid.uuid4().hex
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
    first.wait(timeout=30)
    second.wait(timeout=30)
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
database='lrv_estimate_decision_race_'+uuid.uuid4().hex
marker='owned-estimate-decision-race-'+uuid.uuid4().hex
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

    def service_invoke(name, *arguments):
        return json.loads(scalar('begin;' + service + call(name, *arguments) + 'commit;'))

    token_hash = 'a' * 64
    origin = 'https://example.test'
    key_version = 'k1'
    proof = [quote(token_hash), quote(origin), quote(key_version)]

    def published():
        r, p = prepared()
        publication_id = str(uuid.uuid4())
        invoke('publish_native_estimate', quote(publication_id), jsonsql(publishing(p)))
        return r, publication_id

    def grant_for(r, publication_id, capture=True, activate=True):
        preview = invoke('preview_native_estimate_decision_grant', quote(publication_id), quote(fx['client']))
        q = dict(binding=preview['binding'], expected_publication_head=preview['publication_head'],
                 expires_at=preview['expires_at'], recipient_label='Synthetic owner', purpose='Synthetic decision contention',
                 attest_recipient_authority=True)
        grant_id = str(uuid.uuid4())
        issuance = invoke('record_native_estimate_decision_grant', quote(grant_id), jsonsql(dict(kind='issue', request=q)))
        context = service_invoke('native_estimate_decision_grant_capture_context', quote(grant_id), quote(actor), quote(origin), quote(key_version))
        activation = dict(kind='activate', request=dict(grant_id=grant_id, expected_grant_head=issuance['result']['head'],
            expected_publication_head=preview['publication_head'], expected_context_hash=context['context_hash'], attest_review=True))
        capture_query = service + call('capture_native_estimate_decision_grant', quote(grant_id), quote(actor), quote(origin),
            quote(key_version), quote(context['context_hash']), quote(token_hash))
        if capture:
            sql('begin;' + capture_query + 'commit;')
        active = invoke('record_native_estimate_decision_grant', quote(str(uuid.uuid4())), jsonsql(activation)) if activate else None
        decision = dict(binding=preview['binding'], grant_id=grant_id, expected_publication_head=preview['publication_head'],
            choice='accept', signer_name='Synthetic Owner', signer_relationship='owner', comment=None, acknowledgment_version=1,
            attest_document_review=True, attest_authority=True, attest_choice=True)
        return dict(root=r, publication_id=publication_id, id=grant_id, decision=decision, activation=activation,
                    head=active['result']['head'] if active else issuance['result']['head'], capture_query=capture_query)

    def ready():
        r, publication_id = published()
        return grant_for(r, publication_id)

    def client_write(g, operation_id, request=None):
        return service + call('record_native_estimate_client_decision', quote(operation_id), jsonsql(request or g['decision']), *proof)

    def witness_request(g, choice='decline'):
        decision = {**g['decision'], 'grant_id': None, 'choice': choice}
        occurred_at = scalar("select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');")
        return dict(decision=decision, witness=dict(channel='telephone', occurred_at=occurred_at,
            note='Direct synthetic owner instruction', attest_direct_client_instruction=True))

    def revoke(g):
        q = dict(kind='revoke', request=dict(grant_id=g['id'], expected_grant_head=g['head'], reason='Synthetic lost link', attest_review=True))
        return operation('record_native_estimate_decision_grant', str(uuid.uuid4()), q)

    def read(g):
        return service + call('retrieve_native_estimate_decision', quote(g['id']), *proof)

    def decision_state(g):
        return invoke('read_native_estimate_decision_state', quote(g['root']['estimate_id']), quote(fx['client']))

    def outcome(g, operation_id, close=False):
        return invoke('reconcile_native_estimate_client_decision', quote(operation_id), jsonsql(g['decision']),
            'true' if close else 'false', quote('Synthetic lost-response reconciliation'))

    def terminal_close(g, operation_id, expected):
        invocation = 'close_native_estimate_client_decision(' + ','.join([quote(operation_id), jsonsql(g['decision']), *proof]) + ')'
        return service + "do $decision_close$ declare v jsonb; begin v:=" + invocation + ";if v->>'status' is distinct from " + quote(expected) + " then raise exception 'Unexpected decision closure result';end if;end $decision_close$;"

    # Both contenders append through real distinct decision paths and one root gate.
    g = ready(); first_id = str(uuid.uuid4()); second_id = str(uuid.uuid4())
    contended(client_write(g, first_id), operation('record_native_estimate_witnessed_decision', second_id, witness_request(g)), rejected('23514'))
    check(decision_state(g)['current_decision']['id'] == first_id, 'Client acceptance wins against witnessed decline with one immutable decision')
    g = ready(); first_id = str(uuid.uuid4()); second_id = str(uuid.uuid4())
    contended(operation('record_native_estimate_witnessed_decision', first_id, witness_request(g)), client_write(g, second_id), rejected('23514'))
    check(decision_state(g)['current_decision']['choice'] == 'decline' and outcome(g, second_id)['status'] == 'unrecorded',
          'Witnessed decline wins against client acceptance without adopting another provenance')

    # Exact same-ID retry has one result; a second grant cannot create a second decision.
    g = ready(); operation_id = str(uuid.uuid4())
    contended(client_write(g, operation_id), client_write(g, operation_id), success)
    check(outcome(g, operation_id)['status'] == 'recorded', 'Concurrent identical decision retries converge on one receipt')
    g = ready(); other_grant = grant_for(g['root'], g['publication_id'])
    contended(client_write(g, str(uuid.uuid4())), client_write(other_grant, str(uuid.uuid4()), {**other_grant['decision'], 'choice': 'decline'}), rejected('23514'))
    check(decision_state(g)['decision_head']['version'] == 1, 'Distinct active grants share the same publication decision ceiling')

    # Revocation commits while the client is demonstrably waiting on the root.
    g = ready(); operation_id = str(uuid.uuid4())
    contended(revoke(g), client_write(g, operation_id), rejected('42501'))
    check(outcome(g, operation_id)['status'] == 'unrecorded', 'Revocation-first blocks a waiting decision; staff can reconcile absence')
    g = ready(); operation_id = str(uuid.uuid4())
    contended(client_write(g, operation_id), revoke(g), success)
    check(outcome(g, operation_id)['status'] == 'recorded', 'Decision-first survives later revocation as historical evidence')
    g = ready()
    contended(revoke(g), read(g), rejected('42501'))
    g = ready()
    contended(read(g), revoke(g), success)
    result = sql('begin;' + read(g) + 'commit;', fail=False)
    check(result.returncode != 0 and '42501' in result.stderr, 'Read-first finishes before revocation; subsequent read cannot reuse revoked proof')

    # Replacement preserves old decision evidence but prevents a waiting old decision.
    def replacement(g):
        edited = {**g['root'], 'expected_version': 1, 'fields': {**g['root']['fields'], 'title': 'Synthetic replacement'}}
        _, prep = prepared(edited)
        return publish(str(uuid.uuid4()), publishing(prep))

    g = ready(); operation_id = str(uuid.uuid4()); replacement_query = replacement(g)
    contended(replacement_query, client_write(g, operation_id), rejected('40001'))
    check(outcome(g, operation_id)['status'] == 'unrecorded', 'Replacement-first invalidates waiting old-publication decision')
    g = ready(); operation_id = str(uuid.uuid4()); replacement_query = replacement(g)
    contended(client_write(g, operation_id), replacement_query, success)
    check(outcome(g, operation_id)['status'] == 'recorded' and decision_state(g)['current_decision'] is None,
          'Decision-first remains historical after replacement and does not approve successor')

    def withdrawal(g):
        return operation('withdraw_native_estimate', str(uuid.uuid4()), dict(target=g['decision']['binding']['target'],
            publication_id=g['publication_id'], expected_publication_head=g['decision']['expected_publication_head'],
            reason='Synthetic withdrawal', attest_review=True))

    g = ready(); operation_id = str(uuid.uuid4())
    contended(withdrawal(g), client_write(g, operation_id), rejected('40001'))
    check(outcome(g, operation_id)['status'] == 'unrecorded', 'Withdrawal-first prevents waiting decision')
    g = ready(); operation_id = str(uuid.uuid4())
    contended(client_write(g, operation_id), withdrawal(g), success)
    check(outcome(g, operation_id)['status'] == 'recorded', 'Decision-first retained after withdrawal')

    # Active authority is read again after the observed wait; no credential changes.
    g = ready(); operation_id = str(uuid.uuid4())
    contended(gate(g['root']) + 'update profiles set is_active=false where id=' + quote(actor) + ';', client_write(g, operation_id), rejected('42501'))
    sql('update profiles set is_active=true where id=' + quote(actor) + ';')
    check(outcome(g, operation_id)['status'] == 'unrecorded', 'Grant issuer revoked during root wait cannot authorize decision')
    g = ready()
    contended(gate(g['root']) + 'update profiles set is_active=false where id=' + quote(actor) + ';', read(g), rejected('42501'))
    sql('update profiles set is_active=true where id=' + quote(actor) + ';')

    # Capture and activation share root ordering without reverse acquisition of grant-ID gate.
    r, publication_id = published(); g = grant_for(r, publication_id, capture=False, activate=False)
    activation_id = str(uuid.uuid4())
    contended(g['capture_query'], operation('record_native_estimate_decision_grant', activation_id, g['activation']), success)
    check(invoke('recover_native_estimate_decision_grant', quote(activation_id))['result']['state'] == 'active',
          'Activation waits for and binds committed capture')
    r, publication_id = published(); g = grant_for(r, publication_id, capture=False, activate=False)
    activation_id = str(uuid.uuid4())
    contended(g['capture_query'], operation('record_native_estimate_decision_grant', activation_id, g['activation']), rejected('23514'), first_end='rollback')
    check(invoke('recover_native_estimate_decision_grant', quote(activation_id)) is None, 'Rolled-back capture cannot activate a grant')
    not_ready = staff + gate(r) + "do $not_ready$ begin begin perform record_native_estimate_decision_grant(" + quote(activation_id) + ',' + jsonsql(g['activation']) + ");raise exception 'Unexpected uncaptured activation';exception when check_violation then null;end;end $not_ready$;"
    contended(not_ready, g['capture_query'], success)
    invoke('record_native_estimate_decision_grant', quote(activation_id), jsonsql(g['activation']))
    check(invoke('recover_native_estimate_decision_grant', quote(activation_id))['result']['state'] == 'active',
          'Failed activation releases root; exact retry succeeds only after later committed capture')

    # Durable closure and recording share the UUID gate, both orderings and rollback cases.
    g = ready(); operation_id = str(uuid.uuid4())
    contended(terminal_close(g, operation_id, 'closed_unrecorded'), client_write(g, operation_id), rejected('23514'))
    check(outcome(g, operation_id)['status'] == 'closed_unrecorded', 'Committed closure permanently excludes delayed original write')
    g = ready(); operation_id = str(uuid.uuid4())
    contended(client_write(g, operation_id), terminal_close(g, operation_id, 'recorded'), success)
    check(outcome(g, operation_id)['status'] == 'recorded', 'Write-first close returns the original immutable decision')
    g = ready(); operation_id = str(uuid.uuid4())
    contended(client_write(g, operation_id), terminal_close(g, operation_id, 'closed_unrecorded'), success, first_end='rollback')
    check(outcome(g, operation_id)['status'] == 'closed_unrecorded', 'Rolled-back write allows authoritative unrecorded closure')
    g = ready(); operation_id = str(uuid.uuid4())
    contended(terminal_close(g, operation_id, 'closed_unrecorded'), client_write(g, operation_id), success, first_end='rollback')
    check(outcome(g, operation_id)['status'] == 'recorded', 'Rolled-back closure leaves original request able to commit')
    g = ready(); operation_id = str(uuid.uuid4())
    contended(terminal_close(g, operation_id, 'closed_unrecorded'), terminal_close(g, operation_id, 'closed_unrecorded'), success)
    check(outcome(g, operation_id)['status'] == 'closed_unrecorded', 'Concurrent exact closure retries converge')

    # This is actual post-wait wall time, not a claimed midnight-crossing simulation.
    sql('create table decision_race_release_clock(stamp timestamptz not null);')
    g = ready(); operation_id = str(uuid.uuid4())
    contended(gate(g['root']), client_write(g, operation_id), success,
              first_tail='insert into decision_race_release_clock values(clock_timestamp());')
    check(scalar("select created_at >= (select stamp from decision_race_release_clock) from native_estimate_decisions where id=" + quote(operation_id) + ';') == 't',
          'Decision recorded_at is sampled after actual lock release, not at transaction start')
    check(effects() == original, 'Decisions, grants and closures have no clinical, stock, invoice, payment or outbox side effects')

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
print(f'Estimate decision concurrency: {checks} checks passed; no provider calls.')
