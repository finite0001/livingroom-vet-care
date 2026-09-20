"""Actual local PostgreSQL contention; synthetic fixtures only, never provider calls."""
import argparse
from pathlib import Path
import json
import subprocess
import time
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project-config', type=Path, help='Derive the database container from a Supabase TOML project_id')
parser.add_argument('--reverse',action='store_true',help=argparse.SUPPRESS)
args = parser.parse_args()
CONTAINER = 'supabase_db_livingroom-vet-foundation'
if args.project_config:
    import tomllib
    with args.project_config.open('rb') as config_file:
        CONTAINER = 'supabase_db_' + tomllib.load(config_file)['project_id']
FOUNDATION_COMMAND = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']

COMMAND = FOUNDATION_COMMAND.copy()

# Cleanup runs as the container superuser. `postgres` is not a superuser in this
# image, so terminating a connection it does not own - any supabase_admin or
# background session attached to the scratch database - fails with "Only roles
# with the SUPERUSER attribute may terminate processes of roles with the
# SUPERUSER attribute", and then the scratch database is never dropped.
# The checks themselves still run through `sql()` as `postgres`.
CLEANUP_COMMAND = FOUNDATION_COMMAND.copy()
CLEANUP_COMMAND[CLEANUP_COMMAND.index('-U') + 1] = 'supabase_admin'

def cleanup_sql(query):
    result = subprocess.run(CLEANUP_COMMAND, input=query, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result


def sql(query, fail=True):
    result = subprocess.run(COMMAND, input=query, capture_output=True, text=True)
    if fail and result.returncode:
        raise AssertionError(result.stderr)
    return result

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

actor = 'db490000-0000-4000-8000-000000000001'
client = None
ids = [actor, client]
checks = 0
owned_sessions = []

def check(condition, message):
    global checks
    assert condition, message
    checks += 1

staff = "set local role authenticated;select set_config('request.jwt.claims'," + quote(json.dumps({'sub': actor, 'role': 'authenticated'})) + ",true);"

def contended(first_query, second_query, second_expected):
    """Wait for an observed lock holder and then an observed lock waiter."""
    tag = 'lrv_history_approval_' + uuid.uuid4().hex
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

# Entire contention scenario is an owned API-free scratch database.
import re
inspection=subprocess.run(['docker','inspect',CONTAINER],capture_output=True,text=True,check=True)
check(json.loads(inspection.stdout)[0]['Config']['Labels']['com.supabase.cli.project']==CONTAINER.removeprefix('supabase_db_'),'Verified local project')
database='lrv_history_race_'+uuid.uuid4().hex
assert re.fullmatch(r'lrv_history_race_[a-f0-9]{32}',database)
marker='owned-history-race-'+uuid.uuid4().hex
created=False
fixture=Path(__file__).with_name('ezyvet_reviewed_history.test.sql').read_text().split('-- FIXTURE_BEGIN:')[1].split('-- FIXTURE_END')[0]
fixture='\n'.join(fixture.splitlines()[1:])
dvm="set local role authenticated;select set_config('request.jwt.claims','{\"sub\":\"db490000-0000-4000-8000-000000000002\",\"role\":\"authenticated\"}',true);"
service="set local role service_role;"
def scalar(query):return sql(query).stdout.strip().splitlines()[-1]
def operation(query,role=dvm):return scalar('begin;'+role+query+'commit;')
def prepare(payload):
    request_id=str(uuid.uuid4());r=json.loads(operation(f"select prepare_ezyvet_problem_extraction('{request_id}','{fx['pet']}',{quote(json.dumps(payload))}::jsonb);"));return request_id,r['request']['request_hash']
def approve(request_id,request_hash):return f"select approve_ezyvet_problem_extraction('{request_id}','{fx['pet']}','{request_hash}',true);"
def preview(selection):return json.loads(operation(f"select preview_record_release_v6('{fx['pet']}','{fx['client']}','EMAIL','clinical-import@example.test',{quote(json.dumps(selection))}::jsonb);"))
def confirm(release_id,selection,review):return f"select confirm_record_release('{release_id}','{fx['pet']}','{fx['client']}','EMAIL','clinical-import@example.test',{quote(json.dumps(selection))}::jsonb,{quote(json.dumps(review['snapshot']))}::jsonb,'{review['source_hash']}',true);"
try:
    dump=subprocess.run(['docker','exec',CONTAINER,'pg_dump','-U','postgres','--schema-only','--no-owner','--schema=public','--schema=auth','--schema=storage','--schema=extensions','postgres'],capture_output=True,check=True).stdout
    sql(f'create database "{database}";');created=True;sql(f'comment on database "{database}" is {quote(marker)};')
    COMMAND=FOUNDATION_COMMAND.copy();COMMAND[COMMAND.index('-d')+1]=database
    sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;')
    dump=dump.replace(b'CREATE SCHEMA extensions;',b'CREATE SCHEMA IF NOT EXISTS extensions;');dump=b"\n".join(line for line in dump.splitlines() if not line.startswith(b'ALTER DEFAULT PRIVILEGES'))
    restored=subprocess.run(COMMAND,input=dump,capture_output=True);check(restored.returncode==0,restored.stderr.decode())
    saved=json.loads(scalar('begin;set local search_path=public,extensions;'+fixture+"reset role;insert into record_release_policy(id,enabled,accepted_by,accepted_at,acceptance_reference,accepted_schema_version) values(true,true,'Synthetic scratch reviewer',now(),'TEST ONLY',6);select jsonb_build_object('fx',(select jsonb_object_agg(k,id) from fx),'data',(select jsonb_object_agg(k,v) from data));commit;"))
    fx=saved['fx'];data=saved['data'];payload=data['extraction-payload']
    # Exact target linking versus the ordinary edit RPC (the former tuple/patient inversion).
    link={**payload,'action':'link','problem_id':fx['problem'],'problem_version':1,'duplicate_decision':'link_existing'}
    rid,rhash=prepare(link)
    edit=f"select save_patient_problem('{fx['problem']}','{fx['pet']}',1,'Later ordinary edit','Separately authored',null,'active','high');"
    if args.reverse:contended(dvm+edit,dvm+approve(rid,rhash),lambda code,out,err:code!=0 and 'Link must preserve' in err)
    else:contended(dvm+approve(rid,rhash),dvm+edit,lambda code,out,err:code==0)
    check(scalar(f"select version from patient_problems where id='{fx['problem']}';")=='2','Ordinary edit succeeds once without lost update or deadlock')
    # Stable request approval and identity-only abandonment cannot resurrect or duplicate.
    rid,rhash=prepare(payload);abandon=f"select abandon_ezyvet_history_request('{rid}','{fx['pet']}','problem_extraction',true);"
    before=int(scalar(f"select count(*) from patient_problems where pet_id='{fx['pet']}';"))
    if args.reverse:
        contended(dvm+approve(rid,rhash),dvm+abandon,lambda code,out,err:code==0)
        expected=before+1
    else:
        contended(dvm+abandon,dvm+approve(rid,rhash),lambda code,out,err:code!=0 and 'Abandoned request' in err)
        expected=before
    check(int(scalar(f"select count(*) from patient_problems where pet_id='{fx['pet']}';"))==expected,'Approve/abandon race has exact native effect')
    # Real treatment alert snapshot SHARE lock versus new high-importance extraction.
    rid,rhash=prepare(payload);alert=f"select read_patient_treatment_alerts('{fx['pet']}');"
    if args.reverse:contended(dvm+approve(rid,rhash),dvm+alert,lambda code,out,err:code==0)
    else:contended(dvm+alert,dvm+approve(rid,rhash),lambda code,out,err:code==0)
    check(json.loads(operation(alert))['snapshot']['important_problems'][-1]['importance']=='high','Alert view includes explicit high-importance finding after race')
    # A patient edit waits on, or invalidates, an exact prepared patient version.
    rid,rhash=prepare(payload);patient_edit=f"update pets set name='Updated patient label' where id='{fx['pet']}';"
    if args.reverse:contended(patient_edit,dvm+approve(rid,rhash),lambda code,out,err:code!=0 and 'Patient changed' in err)
    else:contended(dvm+approve(rid,rhash),patient_edit,lambda code,out,err:code==0)
    # Return future preparations to the actual current patient version, never rewrite history.
    payload={**payload,'patient_version':int(scalar(f"select version from pets where id='{fx['pet']}';"))}
    # Source staging takes patient SHARE before head UPDATE; extraction takes patient UPDATE first.
    rid,rhash=prepare(payload)
    sql("update ezyvet_import_runs set retry_after=null where source_site_uid='clinical-test-site';")
    run_id=str(uuid.uuid4());run=json.loads(operation(f"select claim_ezyvet_clinical_import('{run_id}','{actor}','clinical-test-site','history','https://api.trial.ezyvet.com','{fx['mapping']}');",service))
    stage=f"select stage_ezyvet_import_page('{run_id}','{actor}','{run['lease_id']}',1,true,'[{{\"external_id\":\"101\",\"payload\":{{\"id\":101,\"animal_id\":77,\"comments\":\"Corrected outside source\"}}}}]');"
    # Also review a release before the same source transition.
    selection={'problem_ids':[fx['problem']],'imported_history_ids':[fx['source-approval']]};review=preview(selection);release_id=str(uuid.uuid4())
    if args.reverse:
        contended(service+stage,dvm+approve(rid,rhash),lambda code,out,err:code!=0 and 'Current approved' in err)
        check(sql('begin;'+dvm+confirm(release_id,selection,review)+'commit;',fail=False).returncode!=0,'Source-first revision invalidates stale release confirmation')
    else:
        operation(confirm(release_id,selection,review))
        contended(dvm+approve(rid,rhash),service+stage,lambda code,out,err:code==0)
        check(operation(f"select read_record_release('{release_id}')->>'eligible';")=='false','Later source change invalidates delivery without native edits')
    check(scalar(f"select importance from patient_problems where id='{fx['problem']}';")=='high','Source revision retains important reaction')
    # Direct source revision versus release confirmation, with actual head-lock contention.
    sql("update ezyvet_import_runs set retry_after=null where source_site_uid='clinical-test-site';")
    run_id=str(uuid.uuid4());run=json.loads(operation(f"select claim_ezyvet_clinical_import('{run_id}','{actor}','clinical-test-site','history','https://api.trial.ezyvet.com','{fx['mapping']}');",service))
    stage_c=f"select stage_ezyvet_import_page('{run_id}','{actor}','{run['lease_id']}',1,true,'[{{\"external_id\":\"101\",\"payload\":{{\"id\":101,\"animal_id\":77,\"comments\":\"Source revision C\"}}}}]');"
    review=preview(selection);release_id=str(uuid.uuid4())
    if args.reverse:contended(service+stage_c,dvm+confirm(release_id,selection,review),lambda code,out,err:code!=0 and 'preview and review again' in err)
    else:
        contended(dvm+confirm(release_id,selection,review),service+stage_c,lambda code,out,err:code==0)
        check(operation(f"select read_record_release('{release_id}')->>'eligible';")=='false','Head update after confirmation invalidates release')
    # ADMIN source approval itself must not race a newer observation into the approved version.
    candidates=json.loads(operation(f"select list_ezyvet_clinical_candidates('{fx['mapping']}','history');",staff))['candidates'];candidate=next(x for x in candidates if x['is_current'])
    approval_payload={**data['source-payload'],'snapshot_id':candidate['id'],'payload_hash':candidate['payload_hash'],'observed_head_version':candidate['head_version'],'patient_version':payload['patient_version']}
    source_request=str(uuid.uuid4());prepared=json.loads(operation(f"select prepare_ezyvet_history_approval('{source_request}','{fx['pet']}',{quote(json.dumps(approval_payload))}::jsonb);",staff))
    source_approve=f"select approve_ezyvet_history('{source_request}','{fx['pet']}','{prepared['request']['request_hash']}',true);"
    sql("update ezyvet_import_runs set retry_after=null where source_site_uid='clinical-test-site';")
    run_id=str(uuid.uuid4());run=json.loads(operation(f"select claim_ezyvet_clinical_import('{run_id}','{actor}','clinical-test-site','history','https://api.trial.ezyvet.com','{fx['mapping']}');",service))
    stage_d=f"select stage_ezyvet_import_page('{run_id}','{actor}','{run['lease_id']}',1,true,'[{{\"external_id\":\"101\",\"payload\":{{\"id\":101,\"animal_id\":77,\"comments\":\"Source revision D\"}}}}]');"
    if args.reverse:
        contended(service+stage_d,staff+source_approve,lambda code,out,err:code!=0 and 'Current scoped history' in err)
        check(scalar(f"select count(*) from ezyvet_imported_histories where id='{source_request}';")=='0','Stale source approval leaves no immutable version')
    else:
        contended(staff+source_approve,service+stage_d,lambda code,out,err:code==0)
        check(scalar(f"select observed_head_version from ezyvet_imported_histories where id='{source_request}';")==str(candidate['head_version']),'Committed source approval preserves reviewed head before later revision')

finally:
    if created:
        COMMAND=FOUNDATION_COMMAND.copy();check(scalar(f"select shobj_description(oid,'pg_database') from pg_database where datname='{database}';")==marker,'Owned scratch marker checked')
        cleanup_sql(f"select pg_terminate_backend(pid) from pg_stat_activity where datname='{database}' and pid<>pg_backend_pid();");cleanup_sql(f'drop database "{database}";')
        check(scalar(f"select count(*) from pg_database where datname='{database}';")=='0','Owned database removed')
print(f'Imported history contention: {checks} checks passed; no provider calls or foundation policy changes.')
if not args.reverse:
    import sys
    command=[sys.executable,str(Path(__file__).resolve()),'--reverse']
    if args.project_config:command+=['--project-config',str(args.project_config)]
    subprocess.run(command,check=True)
