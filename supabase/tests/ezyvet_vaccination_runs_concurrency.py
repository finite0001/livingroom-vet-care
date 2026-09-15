"""Actual local PostgreSQL contention; synthetic fixtures only, never provider calls."""
import argparse
from owned_database_cleanup import cleanup_owned_database
from pathlib import Path
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
FOUNDATION_COMMAND = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']

COMMAND = FOUNDATION_COMMAND.copy()

def sql(query, fail=True):
    result = subprocess.run(COMMAND, input=query, capture_output=True, text=True)
    if fail and result.returncode:
        raise AssertionError(result.stderr)
    return result

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

actor = 'db520000-0000-4000-8000-000000000001'
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
    tag = 'lrv_vaccination_import_' + uuid.uuid4().hex
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

# Isolated schema-only database, no API workers or source access.
import re
inspection=subprocess.run(['docker','inspect',CONTAINER],capture_output=True,text=True,check=True)
check(json.loads(inspection.stdout)[0]['Config']['Labels']['com.supabase.cli.project']==CONTAINER.removeprefix('supabase_db_'),'Verified local project')
database='lrv_vaccination_race_'+uuid.uuid4().hex
assert re.fullmatch(r'lrv_vaccination_race_[a-f0-9]{32}',database)
marker='owned-vaccination-race-'+uuid.uuid4().hex
created=False
fixture=(Path(__file__).with_name('ezyvet_vaccination_runs.test.sql')).read_text().split('-- FIXTURE_BEGIN:')[1].split('-- FIXTURE_END')[0]
fixture='\n'.join(fixture.splitlines()[1:])
service="set local role service_role;"
def scalar(query):return sql(query).stdout.strip().splitlines()[-1]
def run(query):return scalar('begin;'+service+query+'commit;')
def claim(run_id,mapping):return f"select claim_ezyvet_vaccination_import('{run_id}','{actor}','vaccination-test-site','vaccination','https://api.trial.ezyvet.com','{mapping}','{consult['id']}','{consult['payload_hash']}',{consult['observed_head_version']});"
def stage(run_id,lease,items,complete=False):return f"select stage_ezyvet_import_page('{run_id}','{actor}','{lease}',1,{str(complete).lower()},{quote(json.dumps(items))}::jsonb);"
try:
    dump=subprocess.run(['docker','exec',CONTAINER,'pg_dump','-U','postgres','--schema-only','--no-owner','--schema=public','--schema=auth','--schema=storage','--schema=extensions','postgres'],capture_output=True,check=True).stdout
    sql(f'create database "{database}";');created=True
    sql(f'comment on database "{database}" is {quote(marker)};')
    COMMAND=FOUNDATION_COMMAND.copy();COMMAND[COMMAND.index('-d')+1]=database
    sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;')
    dump=dump.replace(b'CREATE SCHEMA extensions;',b'CREATE SCHEMA IF NOT EXISTS extensions;')
    dump=b"\n".join(line for line in dump.splitlines() if not line.startswith(b'ALTER DEFAULT PRIVILEGES'))
    restored=subprocess.run(COMMAND,input=dump,capture_output=True)
    check(restored.returncode==0,restored.stderr.decode())
    if scalar("select to_regclass('public.ezyvet_vaccination_runs') is null;") == 't':
        sql(Path(__file__).resolve().parents[1].joinpath('migrations/20260913520000_consult_scoped_vaccination_import.sql').read_text())
    # Run pgTAP first inside this owned disposable DB; test transaction rolls back.
    taps=sql(Path(__file__).with_name('ezyvet_vaccination_runs.test.sql').read_text())
    check('not ok' not in taps.stdout and re.search(r'1\.\.[0-9]+',taps.stdout) is not None, taps.stdout)
    tap_count=re.findall(r'1\.\.([0-9]+)',taps.stdout)[-1]
    print(f'Vaccination SQL: {tap_count} assertions passed.',flush=True)
    regression_count=0
    for filename in ['ezyvet_import.test.sql','ezyvet_review_import.test.sql','reviewed_weight_import.test.sql','release_weight_provenance.test.sql','ezyvet_clinical_runs.test.sql']:
        regression=sql(Path(__file__).with_name(filename).read_text())
        plans=re.findall(r'1\.\.([0-9]+)',regression.stdout)
        check('not ok' not in regression.stdout and bool(plans),filename+'\n'+regression.stdout)
        regression_count+=int(plans[-1])
    print(f'Prior import/weight/clinical SQL: {regression_count} assertions passed.',flush=True)
    saved=json.loads(scalar('begin;set local search_path=public,extensions;'+fixture+"select jsonb_build_object('fx',(select jsonb_object_agg(k,id) from fx),'data',(select jsonb_object_agg(k,v) from data));commit;"))
    fx=saved['fx'];items=saved['data']['items'];consult=saved['data']['consult']
    contended(service+claim(fx['run'],fx['mapping']),service+claim(fx['other-run'],fx['mapping']),lambda code,out,err:code!=0 and 'busy or cooling down' in err)
    check(scalar(f"select count(*) from ezyvet_import_runs where id='{fx['other-run']}';")=='0','Rejected competing claim leaves no run')
    # Holding exact scoped run serialization gate demonstrates altered UUID cannot rebind.
    gate=f"select pg_advisory_xact_lock(hashtextextended('vaccination-run:{fx['run']}',0));"
    contended(gate,service+claim(fx['run'],fx['mapping2']),lambda code,out,err:code!=0 and 'identity cannot change' in err)
    lease=scalar(f"select lease_id from ezyvet_import_runs where id='{fx['run']}';")
    contended(service+stage(fx['run'],lease,items),service+stage(fx['run'],lease,items),lambda code,out,err:code==0)
    check(scalar(f"select count(*) from ezyvet_vaccination_pages where run_id='{fx['run']}';")=='1','Concurrent exact lost-ACK retry has one receipt')
    check(scalar("select version from ezyvet_identity_heads where resource='vaccination' and external_id='501';")=='1','Dedup concurrent replay does not advance head')
    contended(f"select 1 from ezyvet_import_runs where id='{fx['run']}' for update;",service+stage(fx['run'],lease,items,True),lambda code,out,err:code!=0 and 'request changed' in err)
    # Consult-head changes in both orders: stage retains SHARE lock until commit;
    # a preceding source revision invalidates the frozen consult rather than rebinding it.
    sql("update ezyvet_import_runs set retry_after=null,lease_until=null;")
    fresh=str(uuid.uuid4());r=json.loads(run(claim(fresh,fx['mapping'])))
    def source_consult_update():
        rid=str(uuid.uuid4())
        cr=json.loads(run(f"select claim_ezyvet_clinical_import('{rid}','{actor}','vaccination-test-site','consult','https://api.trial.ezyvet.com','{fx['mapping']}');"))
        changed=[{'external_id':'101','payload':{'id':101,'animal_id':77,'description':'Changed source consultation'}}]
        return service+f"select stage_ezyvet_import_page('{rid}','{actor}','{cr['lease_id']}',1,true,{quote(json.dumps(changed))});"
    head_update=source_consult_update()
    contended(service+stage(fresh,r['lease_id'],items,True),head_update,lambda code,out,err:code==0)
    check(scalar(f"select consult_observed_head_version from ezyvet_vaccination_runs where run_id='{fresh}';")=='1','Stage-first preserves exact pinned consult revision')
    check(scalar("select version from ezyvet_identity_heads where resource='consult' and external_id='101';")=='2','Later consult update commits after page')
    # Restore observation through real scoped consult staging, no receipt editing.
    def refresh_consult():
        global consult
        sql("update ezyvet_import_runs set retry_after=null,lease_until=null;")
        rid=str(uuid.uuid4())
        cr=json.loads(run(f"select claim_ezyvet_clinical_import('{rid}','{actor}','vaccination-test-site','consult','https://api.trial.ezyvet.com','{fx['mapping']}');"))
        source=[{'external_id':'101','payload':{'id':101,'animal_id':77,'description':'Source consultation'}}]
        run(f"select stage_ezyvet_import_page('{rid}','{actor}','{cr['lease_id']}',1,true,{quote(json.dumps(source))});")
        consult=json.loads(scalar('begin;'+staff+f"select c from jsonb_array_elements(list_ezyvet_clinical_candidates('{fx['mapping']}','consult')->'candidates') c where c->>'external_id'='101';commit;"))
        sql("update ezyvet_import_runs set retry_after=null,lease_until=null;")
    refresh_consult()
    fresh=str(uuid.uuid4());r=json.loads(run(claim(fresh,fx['mapping'])))
    head_update=source_consult_update()
    contended(head_update,service+stage(fresh,r['lease_id'],items,True),lambda code,out,err:code!=0 and 'SOURCE_CONSULT_STALE' in err)
    check(scalar(f"select count(*) from ezyvet_vaccination_pages where run_id='{fresh}';")=='0','Update-first stale consult commits no page')
    check(scalar(f"select next_page from ezyvet_import_runs where id='{fresh}';")=='1','Update-first preserves cursor')
    refresh_consult()
    sql("update ezyvet_import_runs set retry_after=null,lease_until=null;")
    # Three sessions: stage owns its UUID/run gate, a reclaim queues behind it,
    # and a real consult writer completes. Reclaim cannot retain a consult SHARE
    # lock while waiting for stage, so neither a lock inversion nor stale page wins.
    race_id=str(uuid.uuid4());race=json.loads(run(claim(race_id,fx['mapping'])))
    source_write=source_consult_update()
    tag='lrv_vaccination_three_'+uuid.uuid4().hex
    owned_sessions.extend([tag+'_stage',tag+'_claim'])
    holder=subprocess.Popen(COMMAND,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    holder.stdin.write(f"set application_name='{tag}_stage';begin;select pg_advisory_xact_lock(hashtextextended('vaccination-run:{race_id}',0));select 1 from ezyvet_import_runs where id='{race_id}' for update;select pg_sleep(3);"+service+stage(race_id,race['lease_id'],items,True)+'commit;')
    holder.stdin.close()
    deadline=time.monotonic()+8
    while time.monotonic()<deadline:
        if scalar(f"select count(*) from pg_stat_activity where application_name='{tag}_stage' and wait_event='PgSleep';")=='1':break
        time.sleep(.03)
    else:raise AssertionError('Three-way stage did not hold UUID/run locks')
    reclaim=subprocess.Popen(COMMAND,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    reclaim.stdin.write(f"set application_name='{tag}_claim';begin;"+service+claim(race_id,fx['mapping'])+'commit;')
    reclaim.stdin.close()
    while time.monotonic()<deadline:
        if scalar(f"select count(*) from pg_stat_activity where application_name='{tag}_claim' and wait_event_type='Lock';")=='1':break
        time.sleep(.03)
    else:raise AssertionError('Three-way claim did not queue behind stage')
    check(holder.poll() is None,'Stage still holds run lock while reclaim waits')
    run(source_write)
    check(holder.poll() is None,'Consult writer completes before waiting stage resumes')
    holder.wait(timeout=10);reclaim.wait(timeout=10)
    check(holder.returncode!=0 and 'SOURCE_CONSULT_STALE' in holder.stderr.read(),'Queued writer makes stage fail stale without deadlock')
    check(reclaim.returncode!=0 and 'SOURCE_CONSULT_STALE' in reclaim.stderr.read(),'Reclaim revalidates after stage releases gate')
    check(scalar(f"select count(*) from ezyvet_vaccination_pages where run_id='{race_id}';")=='0','Three-way race commits no stale observation')
    refresh_consult()
    run_a,run_b=str(uuid.uuid4()),str(uuid.uuid4());a=json.loads(run(claim(run_a,fx['mapping'])))
    sql(f"update ezyvet_import_runs set lease_until=null where id='{run_a}';")
    b=json.loads(run(claim(run_b,fx['mapping'])))
    # Owner creates two valid leases solely to adversarially exercise overlapping ordered head acquisition.
    sql(f"update ezyvet_import_runs set lease_until=now()+interval '90 seconds' where id='{run_a}';")
    overlap=[{'external_id':'201','payload':{'id':201,'consult_id':101}},{'external_id':'202','payload':{'id':202,'consult_id':101}}]
    contended(service+stage(run_a,a['lease_id'],overlap,True),service+stage(run_b,b['lease_id'],list(reversed(overlap)),True),lambda code,out,err:code==0)
    check(scalar("select count(*) from ezyvet_identity_heads where resource='vaccination' and external_id in ('201','202') and version=1;")=='2','Reversed overlapping pages retain one revision each without deadlock')
    # Owner-only simulated future membership transfer in scratch DB; current native API forbids transfers.
    # This adversarial fixture tests import revalidation even against privileged changes.
    client2=json.loads(scalar('begin;'+staff+"select to_jsonb(save_client(auth.uid(),null,null,'Other','Household','+13035550198','other-household@example.test','EMAIL',null,null));commit;"))['id']
    sql("update ezyvet_import_runs set retry_after=null,lease_until=null;")
    fresh=str(uuid.uuid4());r=json.loads(run(claim(fresh,fx['mapping'])))
    move=f"set local session_replication_role=replica;update pets set client_id='{client2}' where id='{fx['pet']}';set local session_replication_role=origin;"
    contended(move,service+stage(fresh,r['lease_id'],items,True),lambda code,out,err:code!=0 and 'mapping changed' in err)
    check(scalar(f"select next_page from ezyvet_import_runs where id='{fresh}';")=='1','Membership race commits no page/cursor')
    sql(f"begin;set local session_replication_role=replica;update pets set client_id='{fx['client']}' where id='{fx['pet']}';commit;")
    contended(service+stage(fresh,r['lease_id'],items,True),move,lambda code,out,err:code==0)
    check(scalar(f"select count(*) from ezyvet_vaccination_pages where run_id='{fresh}';")=='1','Stage-first membership race preserves original scoped receipt')
    check('review_ready' in run(stage(fresh,str(uuid.uuid4()),items,True)),'Exact committed page recovers after current membership changed')
finally:
    if created:
        cleanup_owned_database(FOUNDATION_COMMAND, database, marker, check=check)
print(f'Vaccination import concurrency: {checks} checks passed; no source requests or native chart writes.')
