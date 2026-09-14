"""Actual local PostgreSQL contention; synthetic fixtures only, never provider calls."""
import argparse
from pathlib import Path
import json
import subprocess
import time
import uuid
import base64
import datetime

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--full-regression',action='store_true',help='Also run all SQL files and canonical prescription/release contention')
parser.add_argument('--project-config', type=Path, help='Derive the database container from a Supabase TOML project_id')
args = parser.parse_args()
CONTAINER = 'supabase_db_livingroom-vet-foundation'
if args.project_config:
    import tomllib
    with args.project_config.open('rb') as config_file:
        CONTAINER = 'supabase_db_' + tomllib.load(config_file)['project_id']
FOUNDATION_COMMAND = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']

COMMAND = FOUNDATION_COMMAND.copy()

def sql(query, fail=True):
    result = subprocess.run(COMMAND, input=query, capture_output=True, text=True)
    if fail and result.returncode:
        raise AssertionError(result.stderr + result.stdout[-10000:])
    return result

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

actor = 'db700000-0000-4000-8000-000000000001'
client = None
ids = [actor, client]
checks = 0
owned_sessions = []

def check(condition, message):
    global checks
    assert condition, message
    checks += 1

staff = "set local role authenticated;select set_config('request.jwt.claims'," + quote(json.dumps({'sub': actor, 'role': 'authenticated'})) + ",true);"

def contended(first_query, second_query, second_expected, hold_seconds=2, during_wait=None):
    """Wait for an observed lock holder and then an observed lock waiter."""
    tag = 'lrv_attachment_' + uuid.uuid4().hex
    owned_sessions.extend([tag + '_holder', tag + '_waiter'])
    first = subprocess.Popen(COMMAND, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write(f"set application_name='{tag}_holder';begin;{first_query}\n")
    first.stdin.flush()
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name='{tag}_holder' and state='idle in transaction';").stdout.strip() == '1':
            break
        if first.poll() is not None:
            raise AssertionError('Holder exited before acquiring locks: ' + first.stderr.read())
        time.sleep(.03)
    else:
        raise AssertionError('Did not observe transaction holding locks')
    second = subprocess.Popen(COMMAND, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    second.stdin.write(f"set application_name='{tag}_waiter';begin;{second_query}commit;")
    second.stdin.close()
    waiting = False
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity w join pg_stat_activity h on h.application_name='{tag}_holder' where w.application_name='{tag}_waiter' and w.wait_event_type='Lock' and h.pid=any(pg_blocking_pids(w.pid));").stdout.strip() == '1':
            waiting = True
            break
        time.sleep(.03)
    if waiting and hold_seconds>2:time.sleep(hold_seconds)
    if waiting and during_wait: during_wait()
    first.stdin.write('commit;\n');first.stdin.close()
    check(waiting, 'Second operation actually waits on the first transaction lock')
    first.wait(timeout=10)
    second.wait(timeout=10)
    first_error = first.stderr.read()
    second_output = second.stdout.read()
    second_error = second.stderr.read()
    check(first.returncode == 0, first_error)
    check(second_expected(second.returncode, second_output, second_error), second_error or second_output)

# Copy only schemas into a positively identified disposable database.
import re
inspection=subprocess.run(['docker','inspect',CONTAINER],capture_output=True,text=True,check=True)
check(json.loads(inspection.stdout)[0]['Config']['Labels']['com.supabase.cli.project']==CONTAINER.removeprefix('supabase_db_'),'Verified local project')
database='lrv_attachment_race_'+uuid.uuid4().hex
marker='owned-attachment-race-'+uuid.uuid4().hex
created=False
fixture=Path(__file__).with_name('ezyvet_attachment_originals.test.sql').read_text().split('-- FIXTURE_BEGIN')[1].split('-- FIXTURE_END')[0]
service="set local role service_role;"
def scalar(query):return sql(query).stdout.strip().splitlines()[-1]
def run(query):return scalar('begin;'+service+query+'commit;')
def claim(run_id):return f"select claim_ezyvet_attachment_import('{run_id}','{actor}','attachment-test-site','https://api.trial.ezyvet.com','{fx['mapping']}');"
def stage(run_id,lease,page):return f"select stage_ezyvet_attachment_page('{run_id}','{actor}','{lease}',{quote(json.dumps(page))}::jsonb);"
try:
    versions=set(sql('select version from supabase_migrations.schema_migrations;').stdout.splitlines())
    dump=subprocess.run(['docker','exec',CONTAINER,'pg_dump','-U','postgres','--schema-only','--no-owner','--schema=public','--schema=auth','--schema=storage','--schema=extensions','postgres'],capture_output=True,check=True).stdout
    sql(f'create database "{database}";');created=True
    sql(f"comment on database {database} is {quote(marker)};")
    COMMAND=FOUNDATION_COMMAND.copy();COMMAND[COMMAND.index('-d')+1]=database
    sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;')
    dump=dump.replace(b'CREATE SCHEMA extensions;',b'CREATE SCHEMA IF NOT EXISTS extensions;')
    dump=b"\n".join(line for line in dump.splitlines() if not line.startswith(b'ALTER DEFAULT PRIVILEGES'))
    restored=subprocess.run(COMMAND,input=b"BEGIN;\n"+dump+b"\nCOMMIT;",capture_output=True)
    check(restored.returncode==0,restored.stderr.decode())
    # Foundation ledger can lag its schema. Rebuild public only in this owned empty copy.
    sql('drop schema public cascade;create schema public;grant usage on schema public to anon,authenticated,service_role;create publication supabase_realtime;')
    for migration in sorted(Path(__file__).resolve().parents[1].joinpath('migrations').glob('*.sql')):
        sql('begin;'+migration.read_text()+'commit;')
    regressions=0
    targeted=['ezyvet_migration_binding_adapters.test.sql','ezyvet_migration_bindings.test.sql','ezyvet_migration_manifests.test.sql','ezyvet_release_discovery_boundaries.test.sql','public_access_defaults.test.sql','ezyvet_attachment_originals.test.sql','ezyvet_attachment_metadata.test.sql','ezyvet_import.test.sql','ezyvet_review_import.test.sql','reviewed_weight_import.test.sql','ezyvet_clinical_runs.test.sql','ezyvet_prescription_runs.test.sql','ezyvet_prescriptionitem_runs.test.sql','ezyvet_prescription_release_reference.test.sql']
    test_files=sorted(Path(__file__).parent.glob('*.test.sql')) if args.full_regression else [Path(__file__).with_name(name) for name in targeted]
    for test_file in test_files:
        filename=test_file.name
        result=sql(Path(__file__).with_name(filename).read_text());plans=re.findall(r'1\.\.([0-9]+)',result.stdout)
        check('not ok' not in result.stdout and bool(plans),filename+'\n'+result.stdout)
        regressions+=int(plans[-1])
        if filename=='public_access_defaults.test.sql':
            hardening=Path(__file__).resolve().parents[1].joinpath('migrations/20260914120000_explicit_public_creation_privileges.sql').read_text()
            for style in ['local','hosted']:
                table_grants='all' if style=='hosted' else 'truncate,references,trigger,maintain'
                sequence_grants='all' if style=='hosted' else 'update'
                function_grants="alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;" if style=='hosted' else ''
                drift=f"alter default privileges for role postgres in schema public grant {table_grants} on tables to anon,authenticated,service_role;alter default privileges for role postgres in schema public grant {sequence_grants} on sequences to anon,authenticated,service_role;{function_grants}grant {sequence_grants} on all sequences in schema public to anon,authenticated,service_role;"
                upgraded=sql(test_file.read_text().replace('-- REPRODUCE_ACCESS_DRIFT',drift+hardening))
                upgrade_plans=re.findall(r'1\.\.([0-9]+)',upgraded.stdout)
                check('not ok' not in upgraded.stdout and bool(upgrade_plans),style+' access upgrade\n'+upgraded.stdout)
                regressions+=int(upgrade_plans[-1])

    print(f'Attachment and prior SQL: {regressions} assertions passed.',flush=True)
    # Broad verification is opt-in; CI already has independent canonical lanes.
    if args.full_regression:
        prior=['python3',str(Path(__file__).with_name('ezyvet_prescription_review_concurrency.py')),'--source-database',database]
        if args.project_config:prior.extend(['--project-config',str(args.project_config.resolve())])
        subprocess.run(prior,check=True)
    saved=json.loads(scalar('begin;set local search_path=public,extensions;'+fixture+"select jsonb_build_object('fx',(select jsonb_object_agg(k,id) from fx),'data',(select jsonb_object_agg(k,v) from data));commit;"))
    fx=saved['fx'];page=saved['data']['page']
    # Migration manifests share none of the child lease/cursor mutation paths.
    migration_id=str(uuid.uuid4());scope_id=str(uuid.uuid4())
    def migration_prepare(rid, reason='Observed manifest concurrency'):
        scope=f"jsonb_build_array(jsonb_build_object('id','{scope_id}','mapping_id','{fx['mapping']}','resource','attachment','parent_type','animal','parent_snapshot_id',m.snapshot_id,'parent_head_version',m.head_version,'disposition','required','reason',{quote(reason)}))"
        return f"select prepare_ezyvet_migration_run('{rid}','https://api.trial.ezyvet.com','attachment-test-site',{scope}) from ezyvet_record_links m where m.id='{fx['mapping']}';"
    contended(staff+migration_prepare(migration_id),staff+migration_prepare(migration_id),lambda code,out,err:code==0)
    check(scalar(f"select count(*) from ezyvet_migration_runs where id='{migration_id}';")=='1','Concurrent exact manifest requests create one run')
    check(scalar(f"select count(*) from ezyvet_migration_scopes where migration_run_id='{migration_id}';")=='1','Concurrent retries create one scope')
    manifest_before=scalar(f"select intent::text from ezyvet_migration_runs where id='{migration_id}';")
    contended(f"select pg_advisory_xact_lock(hashtextextended('ezyvet-migration:{migration_id}',0));",staff+migration_prepare(migration_id,'Changed retry'),lambda code,out,err:code!=0 and 'Migration request identity cannot change' in err)
    check(scalar(f"select intent::text from ezyvet_migration_runs where id='{migration_id}';")==manifest_before,'Rejected changed retry preserves original intent')
    denied_migration=str(uuid.uuid4())
    try:
        contended(f"select pg_advisory_xact_lock(hashtextextended('ezyvet-migration:{denied_migration}',0));",staff+migration_prepare(denied_migration),lambda code,out,err:code!=0 and 'Active administrator required' in err,during_wait=lambda:sql(f"update profiles set is_active=false where id='{actor}';"))
        check(scalar(f"select count(*) from ezyvet_migration_runs where id='{denied_migration}';")=='0','Role loss during manifest wait leaves no run')
    finally:
        sql(f"update profiles set is_active=true where id='{actor}';")
    binding_id=str(uuid.uuid4())
    def bind_child(bid):
        return f"select bind_ezyvet_migration_child('{bid}','{scope_id}','{fx['run']}','Observed binding concurrency');"
    children_before=scalar('select jsonb_agg(to_jsonb(r) order by id)::text from ezyvet_import_runs r;')
    contended(staff+bind_child(binding_id),staff+bind_child(binding_id),lambda code,out,err:code==0)
    check(scalar(f"select count(*) from ezyvet_migration_bindings where scope_id='{scope_id}';")=='1','Concurrent exact binding creates one historical membership')
    competing_binding=str(uuid.uuid4())
    contended(f"select pg_advisory_xact_lock(hashtextextended('ezyvet-migration-scope-binding:{scope_id}',0));",staff+bind_child(competing_binding),lambda code,out,err:code!=0 and 'Exact preceding binding required' in err)
    denied_binding=str(uuid.uuid4())
    try:
        contended(f"select pg_advisory_xact_lock(hashtextextended('ezyvet-migration-scope-binding:{scope_id}',0));",staff+bind_child(denied_binding),lambda code,out,err:code!=0 and 'Active administrator required' in err,during_wait=lambda:sql(f"update profiles set is_active=false where id='{actor}';"))
        check(scalar(f"select count(*) from ezyvet_migration_bindings where id='{denied_binding}';")=='0','Revoked administrator leaves no binding after scope wait')
    finally:
        sql(f"update profiles set is_active=true where id='{actor}';")
    check(scalar('select jsonb_agg(to_jsonb(r) order by id)::text from ezyvet_import_runs r;')==children_before,'Binding contention does not mutate child runs')
    def prepare(rid):
        return f"select prepare_ezyvet_attachment_capture('{rid}','{fx['mapping']}','{fx['run']}',1,1,'{fx['attachment-snapshot']}',1,repeat('b',64));"
    def fresh():
        sql("update ezyvet_import_runs set retry_after=null,lease_until=null;")
        sql("update ezyvet_attachment_capture_requests set retry_after=null,lease_id=null,lease_until=null where status in('prepared','reserved');")
        rid=str(uuid.uuid4());sql('begin;'+staff+prepare(rid)+'commit;');return rid
    def claim_capture(rid):return f"select claim_ezyvet_attachment_capture('{rid}','{actor}');"
    def reserved(rid):
        claimed=json.loads(run(claim_capture(rid)))
        query=f"select reserve_ezyvet_attachment_original('{rid}','{actor}','{claimed['lease_id']}',encode(sha256(convert_to('%PDF-example','UTF8')),'hex'),'application/pdf',12,repeat('a',64),repeat('c',64));"
        return json.loads(run(query))
    def upload(ctx):return "insert into storage.objects(bucket_id,name,metadata) values('ezyvet-attachment-originals',"+quote(ctx['intent']['object_path'])+",'{\"size\":12,\"mimetype\":\"application/pdf\"}');"
    def discard(rid):return f"select begin_discard_ezyvet_attachment_capture('{rid}','{actor}');"
    def finish_discard(rid):return f"select complete_discard_ezyvet_attachment_capture('{rid}','{actor}');"
    def complete(ctx):return f"select complete_ezyvet_attachment_capture('{ctx['request']['id']}','{actor}','{ctx['lease_id']}','{ctx['intent']['id']}',encode(sha256(convert_to('%PDF-example','UTF8')),'hex'),'application/pdf',12);"
    def remove(ctx):return "set local storage.allow_delete_query='true';delete from storage.objects where bucket_id='ezyvet-attachment-originals' and name="+quote(ctx['intent']['object_path'])+";"
    def metadata_claim():return f"select claim_ezyvet_attachment_import('{uuid.uuid4()}','{actor}','attachment-test-site','https://api.trial.ezyvet.com','{fx['mapping']}');"
    # Preparation and scoped abandonment serialize on the same UUID in either order.
    for abandon_first in (True,False):
        rid=str(uuid.uuid4());prep=prepare(rid);abandon=prep.replace('prepare_ezyvet_attachment_capture','abandon_ezyvet_attachment_capture_preparation')
        contended(staff+(abandon if abandon_first else prep),staff+(prep if abandon_first else abandon),lambda code,out,err:code==0)
        check(scalar(f"select status from ezyvet_attachment_capture_requests where id='{rid}';")==('abandoned' if abandon_first else 'prepared'),'Preparation winner is immutable across late replay')
    rid=fresh()
    contended(service+claim_capture(rid),service+metadata_claim(),lambda code,out,err:code!=0 and 'busy or cooling down' in err)
    rid=fresh()
    contended(service+metadata_claim(),service+claim_capture(rid),lambda code,out,err:code!=0 and 'busy or cooling down' in err)
    check(scalar(f"select count(*) from ezyvet_attachment_capture_attempts where request_id='{rid}';")=='0','Metadata-first source gate creates no capture attempt')
    # Discard wins: pending upload waits and fails RLS after committed fence.
    rid=fresh();ctx=reserved(rid)
    contended(service+discard(rid),staff+upload(ctx),lambda code,out,err:code!=0 and 'row-level security' in err)
    check(scalar("select count(*) from storage.objects where name="+quote(ctx['intent']['object_path'])+';')=='0','Fenced late upload creates no object')
    run(finish_discard(rid))
    # Upload wins: its row-policy lock serializes fencing; removal must finish first.
    rid=fresh();ctx=reserved(rid)
    contended(staff+upload(ctx),service+discard(rid),lambda code,out,err:code==0)
    check(scalar("select count(*) from storage.objects where name="+quote(ctx['intent']['object_path'])+';')=='1','Upload-first object stays tracked for fenced deletion')
    failed=sql('begin;'+service+finish_discard(rid)+'commit;',fail=False)
    check(failed.returncode!=0 and 'removal unconfirmed' in failed.stderr,'Cannot abandon an extant pending object')
    sql('begin;'+remove(ctx)+'commit;');run(finish_discard(rid))
    failed=sql('begin;'+staff+upload(ctx)+'commit;',fail=False)
    check(failed.returncode!=0 and 'row-level security' in failed.stderr,'Abandoned request cannot receive delayed object')
    # Completion wins: immutable ready original cannot become discardable.
    rid=fresh();ctx=reserved(rid);sql('begin;'+staff+upload(ctx)+'commit;')
    contended(service+complete(ctx),service+discard(rid),lambda code,out,err:code!=0 and 'cannot be discarded' in err)
    check(scalar(f"select count(*) from ezyvet_attachment_original_captures where request_id='{rid}';")=='1','Exactly one ready capture remains')
    # Discard wins: completing worker observes invalid lease/state after waiting.
    rid=fresh();ctx=reserved(rid);sql('begin;'+staff+upload(ctx)+'commit;')
    contended(service+discard(rid),service+complete(ctx),lambda code,out,err:code!=0 and 'lease changed' in err)
    check(scalar(f"select count(*) from ezyvet_attachment_original_captures where request_id='{rid}';")=='0','Discard-first never creates a ready capture')
    sql('begin;'+remove(ctx)+'commit;');run(finish_discard(rid))
    # Duplicate completion recovers original immutable receipt despite old lease.
    rid=fresh();ctx=reserved(rid);sql('begin;'+staff+upload(ctx)+'commit;')
    contended(service+complete(ctx),service+complete(ctx),lambda code,out,err:code==0)
    check(scalar(f"select count(*) from ezyvet_attachment_original_captures where request_id='{rid}';")=='1','Lost completion reply has one immutable receipt')
    # Source lock waits cannot extend the worker lease.
    for resource,external_id in [('animal','77'),('attachment','701')]:
        rid=fresh();claimed=json.loads(run(claim_capture(rid)))
        sql(f"update ezyvet_attachment_capture_requests set lease_until=clock_timestamp()+interval '3 seconds' where id='{rid}';")
        reserve_query=f"select reserve_ezyvet_attachment_original('{rid}','{actor}','{claimed['lease_id']}',encode(sha256(convert_to('%PDF-example','UTF8')),'hex'),'application/pdf',12,repeat('a',64),repeat('c',64));"
        contended(f"select 1 from ezyvet_identity_heads where resource='{resource}' and external_id='{external_id}' for update;",service+reserve_query,lambda code,out,err:code!=0 and 'lease changed or expired' in err, hold_seconds=4)
        check(scalar(f"select count(*) from ezyvet_attachment_original_intents where request_id='{rid}';")=='0','Expired waiting lease cannot reserve an object')
    rid=fresh();ctx=reserved(rid);sql('begin;'+staff+upload(ctx)+'commit;')
    sql(f"update ezyvet_attachment_capture_requests set lease_until=clock_timestamp()+interval '3 seconds' where id='{rid}';")
    contended("select 1 from storage.objects where name="+quote(ctx['intent']['object_path'])+" for update;",service+complete(ctx),lambda code,out,err:code!=0 and 'lease changed or expired' in err, hold_seconds=4)
    check(scalar(f"select count(*) from ezyvet_attachment_original_captures where request_id='{rid}';")=='0','Lease expiry after Storage wait cannot complete')
    # Parent revision and final capture serialize in both orders.
    parent_change="update ezyvet_identity_heads set version=version+1 where resource='animal' and external_id='77';"
    rid=fresh();ctx=reserved(rid);sql('begin;'+staff+upload(ctx)+'commit;')
    contended(parent_change,service+complete(ctx),lambda code,out,err:code!=0 and 'SOURCE_ATTACHMENT_PARENT_STALE' in err)
    check(scalar(f"select count(*) from ezyvet_attachment_original_captures where request_id='{rid}';")=='0','Changed parent cannot finalize new original')
    sql("update ezyvet_identity_heads set version=version-1 where resource='animal' and external_id='77';")
    rid=fresh();ctx=reserved(rid);sql('begin;'+staff+upload(ctx)+'commit;')
    contended(service+complete(ctx),parent_change,lambda code,out,err:code==0)
    recovered=json.loads(run(f"select get_ezyvet_attachment_capture_context('{rid}','{actor}');"))
    check(recovered['request']['status']=='ready' and not recovered['request']['source_current'],'Capture-first preserves historical ready receipt')
    sql("update ezyvet_identity_heads set version=version-1 where resource='animal' and external_id='77';")
    # An old failure must not release a newer lease; cooldown blocks metadata traffic.
    rid=fresh();old=json.loads(run(claim_capture(rid)));sql(f"update ezyvet_attachment_capture_requests set lease_until=clock_timestamp()-interval '3 seconds' where id='{rid}';")
    new=json.loads(run(claim_capture(rid)))
    failure=f"select fail_ezyvet_attachment_capture('{rid}','{actor}','{old['lease_id']}','UPSTREAM_UNAVAILABLE',2,false);"
    failed=sql('begin;'+service+failure+'commit;',fail=False)
    check(failed.returncode!=0 and 'superseded' in failed.stderr,'Old worker cannot clear new lease')
    run(failure.replace(old['lease_id'],new['lease_id']))
    failed=sql('begin;'+service+metadata_claim()+'commit;',fail=False)
    check(failed.returncode!=0 and 'cooling down' in failed.stderr,'Published capture cooldown gates metadata claims')


    # Canonical approval/cancellation serialize on the same decision identity.
    rid=fresh();ctx=reserved(rid);sql('begin;'+staff+upload(ctx)+'commit;');run(complete(ctx))
    capture_hash=scalar(f"select capture_hash from ezyvet_attachment_original_captures where request_id='{rid}';")
    def approval(operation,previous=None):
        predecessor=quote(previous) if previous else 'null'
        return f"select approve_ezyvet_attachment_record('{operation}','{rid}','{fx['pet']}','{capture_hash}',{predecessor},'Canonical race original','Synthetic observed original review',true);"
    def cancel(operation):return f"select cancel_ezyvet_attachment_approval('{operation}','{rid}','{fx['pet']}','{capture_hash}',true);"
    decision=str(uuid.uuid4())
    contended(staff+cancel(decision),staff+approval(decision),lambda code,out,err:code!=0 and 'Approval was canceled' in err)
    check(scalar(f"select count(*) from ezyvet_attachment_record_versions where id='{decision}';")=='0','Canceled-first decision never creates approval')
    decision=str(uuid.uuid4())
    contended(staff+approval(decision),staff+cancel(decision),lambda code,out,err:code==0 and 'approved' in out)
    check(scalar(f"select count(*) from ezyvet_attachment_approval_cancellations where id='{decision}';")=='0','Approved-first decision is never canceled')
    predecessor=decision
    for action in ['approval','cancellation']:
        decision=str(uuid.uuid4())
        hold=f"select pg_advisory_xact_lock(hashtextextended('{decision}',7300));"
        operation=approval(decision,predecessor) if action=='approval' else cancel(decision)
        def revoke_admin():sql(f"delete from user_roles where user_id='{actor}' and role='ADMIN';")
        try:
            contended(hold,staff+operation,lambda code,out,err:code!=0 and 'Active administrator required' in err,during_wait=revoke_admin)
            check(scalar(f"select (select count(*) from ezyvet_attachment_record_versions where id='{decision}')+(select count(*) from ezyvet_attachment_approval_cancellations where id='{decision}');")=='0','Role loss during decision wait creates no terminal outcome')
        finally:sql(f"insert into user_roles(user_id,role) values('{actor}','ADMIN') on conflict do nothing;")


    # Role loss after every remaining approval lock boundary must roll back writes.
    source_head="select 1 from ezyvet_identity_heads where resource='attachment' and external_id='701' for update;"
    boundary_locks={
        'request':f"select pg_advisory_xact_lock(hashtextextended('{rid}',7000));",
        'source':source_head,
        'chain':f"select pg_advisory_xact_lock(hashtextextended('{fx['mapping']}:701',7301));",
        'object':"select 1 from storage.objects where name="+quote(ctx['intent']['object_path'])+" for update;",
    }
    for boundary,hold in boundary_locks.items():
        decision=str(uuid.uuid4())
        try:
            expected_error='Owned ready original required' if boundary=='request' else 'Active administrator required'
            contended(hold,staff+approval(decision,predecessor),lambda code,out,err:code!=0 and expected_error in err,during_wait=revoke_admin)
            check(scalar(f"select count(*) from ezyvet_attachment_record_versions where id='{decision}';")=='0',boundary+' role-loss wait cannot save approval')
        finally:sql(f"insert into user_roles(user_id,role) values('{actor}','ADMIN') on conflict do nothing;")
    change="update ezyvet_identity_heads set version=version+1 where resource='attachment' and external_id='701';"
    decision=str(uuid.uuid4())
    contended(change,staff+approval(decision,predecessor),lambda code,out,err:code!=0 and 'SOURCE_ATTACHMENT_STALE' in err)
    check(scalar(f"select count(*) from ezyvet_attachment_record_versions where id='{decision}';")=='0','Source-first revision rejects fresh approval')
    sql("update ezyvet_identity_heads set version=version-1 where resource='attachment' and external_id='701';")
    decision=str(uuid.uuid4())
    contended(staff+approval(decision,predecessor),change,lambda code,out,err:code==0)
    check(scalar(f"select source_context->>'attachment_observed_head_version' from ezyvet_attachment_record_versions where id='{decision}';")=='1','Approval-first retains the exact older source version')
    replay=approval(decision,predecessor).replace('select approve_ezyvet_attachment_record(', 'select to_jsonb(approve_ezyvet_attachment_record(').replace(');', '));')
    saved_approval=scalar('begin;'+staff+replay+'commit;')
    check(json.loads(saved_approval)['id']==decision,'Exact approval replay survives the later source revision')
    sql("update ezyvet_identity_heads set version=version-1 where resource='attachment' and external_id='701';")
    predecessor=decision;winner,loser=str(uuid.uuid4()),str(uuid.uuid4())
    contended(staff+approval(winner,predecessor),staff+approval(loser,predecessor),lambda code,out,err:code!=0 and 'Review latest attachment version' in err)
    check(scalar(f"select count(*) from ezyvet_attachment_record_versions where previous_record_id='{predecessor}';")=='1','Competing corrections append exactly one successor')


    # Private release validation composes under staff identity, without browser EXECUTE.
    private_staff=staff.replace('set local role authenticated;','')
    def validate_review(review):
        return private_staff+f"select ezyvet_validate_release_attachments('{fx['pet']}',jsonb_build_array(jsonb_build_object('id','{review}','record_hash',(select record_hash from ezyvet_attachment_record_versions where id='{review}'))));"
    roles=json.loads(scalar(f"select coalesce(jsonb_agg(role::text),'[]') from user_roles where user_id='{actor}';"))
    def revoke_staff():sql(f"delete from user_roles where user_id='{actor}';")
    for boundary in ['source','chain','object']:
        try:
            contended(boundary_locks[boundary],validate_review(winner),lambda code,out,err:code!=0 and 'Active staff access required' in err,during_wait=revoke_staff)
        finally:
            for role in roles:sql(f"insert into user_roles(user_id,role) values('{actor}',{quote(role)}) on conflict do nothing;")
    revised=str(uuid.uuid4())
    contended(staff+approval(revised,winner),validate_review(winner),lambda code,out,err:code!=0 and 'Current latest same-patient API approval required' in err)
    next_review=str(uuid.uuid4())
    contended(validate_review(revised),staff+approval(next_review,revised),lambda code,out,err:code==0)
    check(scalar(f"select previous_record_id from ezyvet_attachment_record_versions where id='{next_review}';")==revised,'Validation-first holds approval chain until transaction ends')
    contended(change,validate_review(next_review),lambda code,out,err:code!=0 and 'Current latest same-patient API approval required' in err)
    sql("update ezyvet_identity_heads set version=version-1 where resource='attachment' and external_id='701';")
    contended(validate_review(next_review),change,lambda code,out,err:code==0)
    check(scalar("select version from ezyvet_identity_heads where resource='attachment' and external_id='701';")=='2','Validation-first preserves source lock until transaction ends')


    # Public confirmation/read must reauthorize after observed waits, including replay.
    sql("update ezyvet_identity_heads set version=1 where resource='attachment' and external_id='701';")
    sql("insert into record_release_policy(id,enabled,accepted_by,accepted_at,acceptance_reference,accepted_schema_version) values(true,true,'Synthetic race reviewer',now(),'TEST ONLY',9);")
    def release_for(review):
        selection={'api_attachment_ids':[review]}
        preview=json.loads(scalar('begin;'+staff+f"select preview_record_release_v9('{fx['pet']}','{fx['client']}','EMAIL','attachment@example.test',{quote(json.dumps(selection))}::jsonb);commit;"))
        release_id=str(uuid.uuid4())
        confirmation=f"select confirm_record_release('{release_id}','{fx['pet']}','{fx['client']}','EMAIL','attachment@example.test',{quote(json.dumps(selection))}::jsonb,{quote(json.dumps(preview['snapshot']))}::jsonb,'{preview['source_hash']}',true);"
        return release_id,confirmation,preview
    def restore_staff():
        for role in roles:sql(f"insert into user_roles(user_id,role) values('{actor}',{quote(role)}) on conflict do nothing;")
    for boundary in ['operation','source','object']:
        release_id,confirmation,preview=release_for(next_review)
        hold=f"select pg_advisory_xact_lock(hashtextextended('{release_id}',13));" if boundary=='operation' else boundary_locks[boundary]
        try:
            contended(hold,staff+confirmation,lambda code,out,err:code!=0 and 'Active staff access required' in err,during_wait=revoke_staff)
            check(scalar(f"select count(*) from record_releases where id='{release_id}';")=='0','Revoked staff cannot confirm after '+boundary+' wait')
        finally:restore_staff()
    release_id,confirmation,preview=release_for(next_review)
    sql('begin;'+staff+confirmation+'commit;')
    try:
        contended(f"select pg_advisory_xact_lock(hashtextextended('{release_id}',13));",staff+confirmation,lambda code,out,err:code!=0 and 'Active staff access required' in err,during_wait=revoke_staff)
    finally:restore_staff()
    try:
        contended(f"select 1 from record_releases where id='{release_id}' for update;",staff+f"select read_record_release('{release_id}');",lambda code,out,err:code!=0 and 'Active staff access required' in err,during_wait=revoke_staff)
    finally:restore_staff()
    # A real private email context represents the service worker's stored actor boundary.
    conversation_id,request_id=str(uuid.uuid4()),str(uuid.uuid4())
    sql(f"insert into conversations(id,client_id) values('{conversation_id}','{fx['client']}');insert into release_email_requests(id,release_id,actor_id,conversation_id,client_id,recipient,subject,body,release_hash) values('{request_id}','{release_id}','{actor}','{conversation_id}','{fx['client']}','attachment@example.test','Synthetic review','Synthetic original', '{preview['source_hash']}');")
    worker="select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);"
    check(json.loads(scalar('begin;'+worker+f"select release_email_context('{request_id}');commit;"))['eligible'] is True,'Actor-authorized worker recovers schema9 with no staff JWT')
    try:
        contended(boundary_locks['object'],worker+f"select release_email_context('{request_id}');",lambda code,out,err:code!=0 and 'Release email actor is unavailable' in err,during_wait=revoke_staff)
    finally:restore_staff()
    # Both source-change orderings exercise confirmation, registration and invalidation.
    pending_id,pending_confirmation,_=release_for(next_review)
    contended(change,staff+pending_confirmation,lambda code,out,err:code!=0 and 'Current latest' in err)
    check(scalar(f"select count(*) from record_releases where id='{pending_id}';")=='0','Source-first change rejects pending confirmation')
    sql("update ezyvet_identity_heads set version=1 where resource='attachment' and external_id='701';")
    pending_id,pending_confirmation,_=release_for(next_review)
    contended(staff+pending_confirmation,change,lambda code,out,err:code==0)
    check(scalar(f"select count(*)>0 from record_release_events where release_id='{pending_id}' and kind='source_changed';")=='t','Confirmation-first source revision invalidates registered API approval')
    sql("update ezyvet_identity_heads set version=1 where resource='attachment' and external_id='701';")
    pending_id,pending_confirmation,_=release_for(next_review)
    corrected_review=str(uuid.uuid4())
    contended(staff+approval(corrected_review,next_review),staff+pending_confirmation,lambda code,out,err:code!=0 and 'Current latest' in err)
    pending_id,pending_confirmation,_=release_for(corrected_review)
    final_review=str(uuid.uuid4())
    contended(staff+pending_confirmation,staff+approval(final_review,corrected_review),lambda code,out,err:code==0)
    check(scalar(f"select count(*)>0 from record_release_events where release_id='{pending_id}' and kind='source_changed';")=='t','Confirmation-first correction invalidates saved package')


    # Fully captured schema9 SQL artifacts, with known bytes; no physical Storage reads.
    sql('begin;'+staff+f"select record_sms_consent('{actor}','{fx['client']}','+13035550196',true,'WRITTEN','Synthetic race fixture',null);commit;")
    selection={'api_attachment_ids':[final_review]}
    sms_preview=json.loads(scalar('begin;'+staff+f"select preview_record_release_v9('{fx['pet']}','{fx['client']}','SMS','+13035550196',{quote(json.dumps(selection))}::jsonb);commit;"))
    sms_release=str(uuid.uuid4())
    sql('begin;'+staff+f"select confirm_record_release('{sms_release}','{fx['pet']}','{fx['client']}','SMS','+13035550196',{quote(json.dumps(selection))}::jsonb,{quote(json.dumps(sms_preview['snapshot']))}::jsonb,'{sms_preview['source_hash']}',true);commit;")
    token_hash='a'*64;message_hash='b'*64
    def worker_rpc(query):return scalar('begin;'+worker+service+query+'commit;')
    def prepared_link(seconds=60):
        grant_id=str(uuid.uuid4())
        saved=json.loads(scalar('begin;'+staff+f"select prepare_document_link('{grant_id}','record_release','{sms_release}','{fx['client']}','{conversation_id}','+13035550196','{sms_preview['source_hash']}',clock_timestamp()+interval '{seconds} seconds','Synthetic {{{{document_link}}}}','https://example.test','synthetic');commit;"))
        payload={'artifacts':[{'filename':'review.html','mime_type':'text/html','document_id':None,'content':base64.b64encode(b'<html>Synthetic authorization fixture</html>').decode()},{'filename':'original.pdf','mime_type':'application/pdf','document_id':sms_preview['snapshot']['attachments'][0]['id'],'content':base64.b64encode(b'%PDF-example').decode()}]}
        worker_rpc(f"select capture_document_link('{grant_id}','{actor}',{quote(json.dumps(payload))},'{token_hash}','{message_hash}');")
        captured=json.loads(scalar('begin;'+staff+f"select recover_document_link('record_release','{sms_release}','{grant_id}');commit;"))
        sql('begin;'+staff+f"select attest_document_link('{grant_id}','{captured['artifact_hash']}','{message_hash}',true);commit;")
        return grant_id,datetime.datetime.fromisoformat(saved['grant']['expires_at']).timestamp()
    grant_id,_=prepared_link()
    check(json.loads(worker_rpc(f"select retrieve_document_link('{grant_id}','{token_hash}',null);"))['grant_id']==grant_id,'Current reviewed schema9 link returns manifest')
    check(base64.b64decode(json.loads(worker_rpc(f"select retrieve_document_link('{grant_id}','{token_hash}',1);"))['content'])==b'%PDF-example','Current schema9 link returns exact captured original bytes')
    for boundary in ['source','budget']:
        for change_kind in ['role','expiry']:
            grant_id,expires=prepared_link(15 if change_kind=='expiry' else 60)
            hold=boundary_locks['object'] if boundary=='source' else f"select 1 from document_link_access_budget where grant_id='{grant_id}' for update;"
            def expire():time.sleep(max(0,expires-time.time()+.15))
            try:
                contended(hold,worker+service+f"select retrieve_document_link('{grant_id}','{token_hash}',1);",lambda code,out,err:code!=0 and 'Document link unavailable' in err,during_wait=revoke_staff if change_kind=='role' else expire)
                check(scalar(f"select used from document_link_access_budget where grant_id='{grant_id}';")=='0',change_kind+' rejection after '+boundary+' wait rolls back access counter')
            finally:restore_staff()

finally:
    if created:
        COMMAND=FOUNDATION_COMMAND.copy()
        check(scalar(f"select shobj_description(oid,'pg_database') from pg_database where datname='{database}';")==marker,'Exact owned database marker checked')
        sql(f"select pg_terminate_backend(pid) from pg_stat_activity where datname='{database}' and pid<>pg_backend_pid();")
        sql(f'drop database "{database}";')
        check(scalar(f"select count(*) from pg_database where datname='{database}';")=='0','Disposable database removed')
print(f'Attachment original concurrency: {checks} checks passed; no provider or physical Storage operations.')
