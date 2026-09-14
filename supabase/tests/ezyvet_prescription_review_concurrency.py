"""Actual local PostgreSQL contention; synthetic fixtures only, never provider calls."""
import argparse
from pathlib import Path
import json
import subprocess
import time
import uuid
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project-config', type=Path, help='Derive the database container from a Supabase TOML project_id')
parser.add_argument('--source-database',help='Clone an explicitly marked owned attachment scratch database')
parser.add_argument('--sql-only',action='store_true',help='Run SQL regressions and clean up without contention cases')
parser.add_argument('--overlay-migration',type=Path,action='append',default=[])
parser.add_argument('--extra-sql-test',type=Path,action='append',default=[])
args = parser.parse_args()
CONTAINER = 'supabase_db_livingroom-vet-foundation'
if args.project_config:
    import tomllib
    with args.project_config.open('rb') as config_file:
        CONTAINER = 'supabase_db_' + tomllib.load(config_file)['project_id']
source_database = args.source_database or 'postgres'
if args.source_database:
    import re
    assert re.fullmatch(r'lrv_attachment_race_[a-f0-9]{32}', source_database), 'Only generated attachment scratch sources allowed'
FOUNDATION_COMMAND = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', source_database, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']

COMMAND = FOUNDATION_COMMAND.copy()

def sql(query, fail=True):
    result = subprocess.run(COMMAND, input=query, capture_output=True, text=True)
    if fail and result.returncode:
        raise AssertionError(result.stderr)
    return result

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

actor = 'db560000-0000-4000-8000-000000000001'
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
    tag = 'lrv_rx_review_' + uuid.uuid4().hex
    owned_sessions.extend([tag + '_holder', tag + '_waiter'])
    first = subprocess.Popen(COMMAND, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write(f"set application_name='{tag}_holder';begin;{first_query}\n")
    first.stdin.flush()
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name='{tag}_holder' and state='idle in transaction';").stdout.strip() == '1':
            break
        time.sleep(.03)
    else:
        first.stdin.close()
        first.wait(timeout=10)
        raise AssertionError('Did not observe transaction holding locks: '+first.stderr.read())
    second = subprocess.Popen(COMMAND, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    second.stdin.write(f"set application_name='{tag}_waiter';begin;{second_query}commit;")
    second.stdin.close()
    waiting = False
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name='{tag}_waiter' and wait_event_type='Lock';").stdout.strip() == '1':
            waiting = True
            break
        time.sleep(.03)
    check(waiting, 'Second operation actually waits on the first transaction lock')
    first.stdin.write('commit;\n')
    first.stdin.close()
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
database='lrv_rx_review_'+uuid.uuid4().hex
assert re.fullmatch(r'lrv_rx_review_[a-f0-9]{32}',database)
marker='owned-prescription-review-'+uuid.uuid4().hex
created=False
fixture=Path(__file__).with_name('ezyvet_prescription_review.test.sql').read_text().split('-- FIXTURE_BEGIN:')[1].split('-- FIXTURE_END')[0]
fixture='\n'.join(fixture.splitlines()[1:])
def scalar(query):return sql(query).stdout.strip().splitlines()[-1]

fixture=fixture.replace('"animal_id":77,"instructions"','"animal_id":77,"consult_id":201,"instructions"')
consult_fixture="""
insert into fx values('race-consult-run',gen_random_uuid());
insert into data select 'race-consult-run',claim_ezyvet_clinical_import((select id from fx where k='race-consult-run'),'db560000-0000-4000-8000-000000000001','prescriptionitem-test-site','consult','https://api.trial.ezyvet.com',(select id from fx where k='mapping'));
select stage_ezyvet_import_page((select id from fx where k='race-consult-run'),'db560000-0000-4000-8000-000000000001',(select (v->>'lease_id')::uuid from data where k='race-consult-run'),1,true,'[{"external_id":"201","payload":{"id":201,"animal_id":77}}]');
"""
fixture=fixture.replace("insert into fx values('prescription-run'",consult_fixture+"insert into fx values('prescription-run'",1)
try:
    if args.source_database:
        assert scalar(f"select shobj_description(oid,'pg_database') from pg_database where datname='{source_database}';").startswith('owned-attachment-race-'), 'Owned source marker required'
    dump=subprocess.run(['docker','exec',CONTAINER,'pg_dump','-U','postgres','--schema-only','--no-owner','--schema=public','--schema=auth','--schema=storage','--schema=extensions',source_database],capture_output=True,check=True).stdout
    sql(f'create database "{database}";');created=True
    sql(f'comment on database "{database}" is {quote(marker)};')
    COMMAND=FOUNDATION_COMMAND.copy();COMMAND[COMMAND.index('-d')+1]=database
    sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;')
    dump=dump.replace(b'CREATE SCHEMA extensions;',b'CREATE SCHEMA IF NOT EXISTS extensions;')
    dump=b"\n".join(line for line in dump.splitlines() if not line.startswith(b'ALTER DEFAULT PRIVILEGES'))
    restored=subprocess.run(COMMAND,input=b"BEGIN;\n"+dump+b"\nCOMMIT;",capture_output=True)
    check(restored.returncode==0,restored.stderr.decode())

    migration_dir=Path(__file__).resolve().parents[1]/'migrations'
    pending=[
      ('20260913520000',"to_regclass('public.ezyvet_vaccination_runs')"),
      ('20260913530000',"to_regclass('public.ezyvet_imported_vaccinations')"),
      ('20260913540000',"to_regprocedure('public.preview_record_release_v7(uuid,uuid,text,text,jsonb)')"),
      ('20260913550000',"to_regclass('public.ezyvet_prescription_runs')"),
      ('20260913560000',"to_regclass('public.ezyvet_prescriptionitem_runs')"),
      ('20260913570000',"to_regprocedure('public.ezyvet_reconcile_prescription_items(jsonb,jsonb,boolean)')"),
      ('20260913580000',"to_regprocedure('public.ezyvet_prescription_source_context(uuid,uuid)')"),
      ('20260913590000',"to_regclass('public.ezyvet_prescription_review_requests')"),
      ('20260913600000',"to_regprocedure('public.ezyvet_prescription_interpretation_context(jsonb,jsonb)')"),
      ('20260913610000',"to_regclass('public.ezyvet_imported_prescriptions')"),
      ('20260913620000',"to_regprocedure('public.get_ezyvet_prescription_review_candidate(uuid,uuid)')"),
      ('20260913630000',"to_regprocedure('public.preview_record_release_v8(uuid,uuid,text,text,jsonb)')"),
    ]
    for version,probe in pending:
        if scalar(f'select {probe} is null;')=='t':
            paths=list(migration_dir.glob(version+'_*'))
            assert len(paths)==1,version
            sql(paths[0].read_text())
    # Additive private-helper replacement follows the deployed schema8 baseline.
    sql((migration_dir/'20260913650000_prescription_release_reference_hardening.sql').read_text())
    for migration in args.overlay_migration:sql(migration.read_text())
    regression_count=0
    for filename in ['ezyvet_prescription_release_reference.test.sql','release_imported_prescription.test.sql','release_imported_vaccination.test.sql','ezyvet_prescription_review_discovery.test.sql','ezyvet_prescription_review.test.sql','ezyvet_prescription_interpretation.test.sql','ezyvet_prescription_review_preparation.test.sql','ezyvet_prescription_source_context.test.sql','ezyvet_prescription_reconciliation.test.sql','ezyvet_prescriptionitem_runs.test.sql','ezyvet_prescription_runs.test.sql','ezyvet_clinical_runs.test.sql','ezyvet_vaccination_runs.test.sql']:
        result=sql(Path(__file__).with_name(filename).read_text())
        plans=re.findall(r'1\.\.([0-9]+)',result.stdout)
        check('not ok' not in result.stdout and bool(plans),filename+'\n'+result.stdout)
        regression_count+=int(plans[-1])
    print(f'Prescription review and prior SQL: {regression_count} assertions passed.',flush=True)
    for test in args.extra_sql_test:
        extra=sql(test.read_text())
        check('not ok' not in extra.stdout and re.search(r'1\.\.[0-9]+',extra.stdout) is not None,extra.stdout)
    if args.sql_only:
        print('SQL-only run complete; cleaning owned scratch database.',flush=True)
        sys.exit(0)
    saved=json.loads(scalar('begin;set local search_path=public,extensions;'+fixture+"select jsonb_build_object('fx',(select jsonb_object_agg(k,id) from fx),'data',(select jsonb_object_agg(k,v) from data));commit;"))
    fx=saved['fx'];payload=saved['data']['payload'];pet=fx['pet']
    check(saved['data']['context']['consult']['status']=='resolved','Race fixture has real patient-scoped consultation evidence')
    def prepare(id,p=payload):return f"select prepare_ezyvet_prescription_review('{id}','{pet}',{quote(json.dumps(p))}::jsonb);"
    def approve(id):
        h=scalar(f"select request_hash from ezyvet_prescription_review_requests where id='{id}';")
        return f"select approve_ezyvet_prescription_review('{id}','{pet}','{h}',true);"
    def fresh(p=payload):
        id=str(uuid.uuid4());sql('begin;'+staff+prepare(id,p)+'commit;');return id
    a,b=fresh(),fresh()
    contended(staff+approve(a),staff+approve(b),lambda c,o,e:c==0)
    check(scalar('select count(*) from ezyvet_imported_prescriptions;')=='1','Concurrent equivalent reviews share one immutable chart version')
    original=json.loads(scalar(f"select to_jsonb(v) from ezyvet_imported_prescriptions v where id='{a}';"))
    correction=payload|{'interpretation':payload['interpretation']|{'outside_author':'Reviewed outside clinician','replaces_id':a,'expected_predecessor_hash':original['version_hash'],'reason':'Reviewed explicit correction'}}
    competing=correction|{'interpretation':correction['interpretation']|{'outside_author':'Different outside clinician'}}
    c,d=fresh(correction),fresh(competing)
    contended(staff+approve(c),staff+approve(d),lambda c,o,e:c!=0 and 'predecessor' in e)
    check(scalar('select count(*) from ezyvet_imported_prescriptions;')=='2','Competing corrections cannot create two successors')
    latest=json.loads(scalar(f"select to_jsonb(v) from ezyvet_imported_prescriptions v where id='{c}';"))
    current=correction|{'interpretation':correction['interpretation']|{'replaces_id':c,'expected_predecessor_hash':latest['version_hash']}}
    for resource,external in [('prescription','101'),('prescriptionitem','501'),('consult','201')]:
        change=f"update ezyvet_identity_heads set version=version+2 where resource='{resource}' and external_id='{external}';"
        restore=f"update ezyvet_identity_heads set version=version-2 where resource='{resource}' and external_id='{external}';"
        rejects=lambda c,o,e:c!=0 and ('STALE' in e or 'consultation' in e)
        pending=fresh(current)
        contended(change,staff+approve(pending),rejects)
        sql(restore)
        pending2=fresh(current)
        contended(staff+approve(pending2),change,lambda c,o,e:c==0)
        check(scalar(f"select status from ezyvet_prescription_review_requests where id='{pending2}';")=='approved','Review-first source race commits frozen evidence')
        sql(restore)
        denied=str(uuid.uuid4())
        contended(change,staff+prepare(denied,current),rejects)
        check(scalar(f"select count(*) from ezyvet_prescription_review_requests where id='{denied}';")=='0','Source-first preparation saves no misleading intent')
        sql(restore)
        contended(staff+prepare(str(uuid.uuid4()),current),change,lambda c,o,e:c==0)
        sql(restore)
        print(f'Observed {resource} head contention in both orders for preparation and approval.',flush=True)
    move=f"set local session_replication_role=replica;update pets set client_id=gen_random_uuid() where id='{pet}';set local session_replication_role=origin;"
    restore_member=f"begin;set local session_replication_role=replica;update pets set client_id='{fx['client']}' where id='{pet}';commit;"
    member_id=fresh(current)
    contended(move,staff+approve(member_id),lambda c,o,e:c!=0 and ('Patient' in e or 'mapping' in e))
    sql(restore_member)
    contended(staff+approve(member_id),move,lambda c,o,e:c==0)
    check(scalar(f"select status from ezyvet_prescription_review_requests where id='{member_id}';")=='approved','Review-first household change preserves approved membership')
    sql(restore_member)
    product_id=fresh(current)
    product_change=staff+f"select save_catalog_product('{fx['product']}',1,'Synthetic medication','medication','','tablet',1000,true);"
    contended(product_change,staff+approve(product_id),lambda c,o,e:c!=0 and 'Catalog medication changed' in e)
    sql(f"begin;set local session_replication_role=replica;update catalog_products set version=1 where id='{fx['product']}';commit;")
    contended(staff+approve(product_id),product_change,lambda c,o,e:c==0)
    check(scalar(f"select context#>>'{{selected_items,0,product,version}}' from ezyvet_imported_prescriptions where id='{c}';")=='1','Original catalog revision survives later product edit')
    sql(f"begin;set local session_replication_role=replica;update catalog_products set version=1 where id='{fx['product']}';commit;")
    def abandon(id):return f"select abandon_ezyvet_prescription_review('{id}','{pet}',true);"
    late=str(uuid.uuid4())
    contended(staff+prepare(late,current),staff+abandon(late),lambda c,o,e:c==0)
    check(scalar(f"select status from ezyvet_prescription_review_requests where id='{late}';")=='abandoned','Prepare-first abandonment retains terminal intent')
    earlier=str(uuid.uuid4())
    contended(staff+abandon(earlier),staff+prepare(earlier,current),lambda c,o,e:c!=0 and 'revive' in e)
    check(scalar(f"select status from ezyvet_prescription_review_requests where id='{earlier}';")=='abandoned','Abandon-first tombstone prevents late prepare')

    service='set local role service_role;'
    def service_call(query):return scalar('begin;'+service+query+'commit;')
    original_parent=saved['data']['context']['parent']['original']
    original_items=[{'external_id':item['external_id'],'payload':item['original']} for item in saved['data']['context']['items']]
    original_consult={'id':201,'animal_id':77}
    def intake_page(resource,items,complete=True,run_id=None):
        # Only the owned synthetic database is touched by this lease reset.
        sql('update ezyvet_import_runs set retry_after=null,lease_until=null;')
        rid=run_id or str(uuid.uuid4())
        common=f"'{rid}','{actor}','prescriptionitem-test-site','{resource}','https://api.trial.ezyvet.com','{fx['mapping']}'"
        if resource=='prescription':claim=f'select claim_ezyvet_prescription_import({common});'
        elif resource=='consult':claim=f'select claim_ezyvet_clinical_import({common});'
        else:
            parent=json.loads(scalar("select jsonb_build_object('id',s.id,'hash',s.payload_hash,'version',h.version) from ezyvet_identity_heads h join ezyvet_import_snapshots s on s.id=h.snapshot_id where h.resource='prescription' and h.external_id='101';"))
            claim=f"select claim_ezyvet_prescriptionitem_import({common},'{parent['id']}','{parent['hash']}',{parent['version']});"
        claimed=json.loads(service_call(claim))
        page=service+f"select stage_ezyvet_import_page('{rid}','{actor}','{claimed['lease_id']}',1,{str(complete).lower()},{quote(json.dumps(items))}::jsonb);"
        return rid,claimed['lease_id'],page
    def rescan(item_complete=True):
        for resource,items in [('consult',[{'external_id':'201','payload':original_consult}]),('prescription',[{'external_id':'101','payload':original_parent}]),('prescriptionitem',original_items)]:
            rid,lease,page=intake_page(resource,items,item_complete if resource=='prescriptionitem' else True)
            sql('begin;'+page+'commit;')
        if not item_complete:
            # A staged page consumes its lease. Resume the exact run before
            # preparing a review that will race its next page.
            rid,lease,_=intake_page('prescriptionitem',original_items,False,rid)
        newest=json.loads(scalar('select to_jsonb(v) from ezyvet_imported_prescriptions v order by version desc limit 1;'))
        p=current|{'item_run_id':rid,'interpretation':current['interpretation']|{'replaces_id':newest['id'],'expected_predecessor_hash':newest['version_hash']}}
        return p,lease
    # An import run can gain a final receipt while a partial review is pending.
    # Run-row locking freezes the exact receipt set across preparation/approval.
    for source_first in [True,False]:
        p,lease=rescan(False);rid=p['item_run_id'];pending=fresh(p)
        finish=service+f"select stage_ezyvet_import_page('{rid}','{actor}','{lease}',2,true,'[]');"
        if source_first:
            contended(finish,staff+approve(pending),lambda c,o,e:c!=0 and 'context changed' in e)
            check(scalar(f"select status from ezyvet_prescription_review_requests where id='{pending}';")=='prepared','Finishing scan first cannot approve a changed receipt set')
        else:
            contended(staff+approve(pending),finish,lambda c,o,e:c==0)
            check(scalar(f"select context#>>'{{reconciliation,scanComplete}}' from ezyvet_imported_prescriptions where id='{pending}';")=='false','Review-first scan completion preserves explicitly partial original account')
    print('Observed actual item-page completion versus approval in both orders.',flush=True)
    # Real scoped ingestion, not direct head edits. Rescans retain monotonic
    # revisions and actual new page observations after source A -> B -> A.
    for resource in ['prescription','prescriptionitem','consult']:
        def writer():
            if resource=='prescription':items=[{'external_id':'101','payload':original_parent|{'instructions':'Changed parent during review'}}]
            elif resource=='prescriptionitem':items=[{'external_id':'501','payload':original_items[0]['payload']|{'instructions':'Changed item during review'}}]
            else:items=[{'external_id':'201','payload':original_consult|{'description':'Changed consultation during review'}}]
            return intake_page(resource,items)[2]
        p,_=rescan();pending=fresh(p);change=writer()
        contended(change,staff+approve(pending),lambda c,o,e:c!=0 and ('STALE' in e or 'context changed' in e))
        check(scalar(f"select status from ezyvet_prescription_review_requests where id='{pending}';")=='prepared','Real source-first ingestion rejects stale approval')
        p,_=rescan();pending=fresh(p);change=writer()
        contended(staff+approve(pending),change,lambda c,o,e:c==0)
        check(scalar(f"select status from ezyvet_prescription_review_requests where id='{pending}';")=='approved','Real review-first ingestion preserves committed approval')
        check(scalar(f"select ezyvet_prescription_current('{pending}')->>'is_current';")=='false','Subsequent real source change visibly invalidates approved currentness')
        print(f'Observed actual {resource} page ingestion versus approval in both orders.',flush=True)

    # Real release confirmation races against source ingestion and corrections.
    # The frozen preview is prepared before either contender starts.
    sql("insert into record_release_policy(id,enabled,accepted_by,accepted_at,acceptance_reference,accepted_schema_version) values(true,true,'Synthetic race reviewer',now(),'TEST ONLY',8);")
    def release_for(review_id):
        selection={'imported_prescription_ids':[review_id]}
        preview=json.loads(scalar('begin;'+staff+f"select preview_record_release_v8('{pet}','{fx['client']}','EMAIL','clinical-import@example.test',{quote(json.dumps(selection))}::jsonb);commit;"))
        rid=str(uuid.uuid4())
        confirm=f"select confirm_record_release('{rid}','{pet}','{fx['client']}','EMAIL','clinical-import@example.test',{quote(json.dumps(selection))}::jsonb,{quote(json.dumps(preview['snapshot']))}::jsonb,'{preview['source_hash']}',true);"
        return rid,confirm,preview['snapshot']
    def approved_rescan():
        p,_=rescan();pending=fresh(p);sql('begin;'+staff+approve(pending)+'commit;')
        review_id=scalar(f"select approved_record_id from ezyvet_prescription_review_requests where id='{pending}';")
        return p,review_id
    for resource in ['prescription','prescriptionitem','consult']:
        for source_first in [True,False]:
            p,review_id=approved_rescan();rid,confirmation,frozen=release_for(review_id);change=writer()
            if source_first:
                contended(change,staff+confirmation,lambda c,o,e:c!=0 and 'Current latest' in e)
                check(scalar(f"select count(*) from record_releases where id='{rid}';")=='0','Source-first release creates no stale package')
            else:
                contended(staff+confirmation,change,lambda c,o,e:c==0)
                eligible=scalar('begin;'+staff+f"select read_record_release('{rid}')->>'eligible';commit;")
                check(eligible=='false','Release-first source ingestion invalidates pending package')
                check(json.loads(scalar(f"select snapshot from record_releases where id='{rid}';"))==frozen,'Source ingestion leaves frozen release unchanged')
        print(f'Observed actual {resource} ingestion versus release confirmation in both orders.',flush=True)
    for correction_first in [True,False]:
        p,review_id=approved_rescan();rid,confirmation,frozen=release_for(review_id)
        latest=json.loads(scalar(f"select to_jsonb(v) from ezyvet_imported_prescriptions v where id='{review_id}';"))
        changed=p|{'interpretation':p['interpretation']|{'outside_author':'Release race '+str(uuid.uuid4()),'replaces_id':review_id,'expected_predecessor_hash':latest['version_hash'],'reason':'Explicit release contention correction'}}
        correction_id=fresh(changed)
        if correction_first:
            contended(staff+approve(correction_id),staff+confirmation,lambda c,o,e:c!=0 and 'Current latest' in e)
            check(scalar(f"select count(*) from record_releases where id='{rid}';")=='0','Correction-first release rejects superseded selection')
        else:
            contended(staff+confirmation,staff+approve(correction_id),lambda c,o,e:c==0)
            check(scalar('begin;'+staff+f"select read_record_release('{rid}')->>'eligible';commit;")=='false','Release-first correction invalidates pending package')
            check(json.loads(scalar(f"select snapshot from record_releases where id='{rid}';"))==frozen,'Correction leaves frozen release unchanged')
    print('Observed correction versus release confirmation in both orders.',flush=True)

    sql(f"delete from user_roles where user_id='{actor}' and role='DVM';")
    denied=sql('begin;'+staff+f"select recover_ezyvet_prescription_review('{a}','{pet}');commit;",False)
    check(denied.returncode!=0 and 'veterinarian' in denied.stderr,'Current role required for approved receipt recovery')
finally:
    if created:
        COMMAND=FOUNDATION_COMMAND.copy()
        check(scalar(f"select shobj_description(oid,'pg_database') from pg_database where datname='{database}';")==marker,'Exact owned database marker checked')
        sql(f"select pg_terminate_backend(pid) from pg_stat_activity where datname='{database}' and pid<>pg_backend_pid();")
        sql(f'drop database "{database}";')
        check(scalar(f"select count(*) from pg_database where datname='{database}';")=='0','Disposable database removed')
print(f'Prescription review concurrency: {checks} checks passed; owned scratch database removed.')
