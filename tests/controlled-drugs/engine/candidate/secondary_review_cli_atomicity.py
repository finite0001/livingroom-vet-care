"""Callback-only real CLI206 failure/commit/no-op proof; no process creation."""
import hashlib
import json

import cli_atomicity as old_atomic
from canonical_post206 import snapshot, verify_reference205, verify_installed, digest
from secondary_review_cli_body import check_cli_body
from secondary_review_release import parent_checks_sql, installed_checks_sql, MARKERS

FIXTURE='controlled_review_cli_fixture'
TRIGGER='controlled_review_cli_206'
GATE_KEY=90271042
CASES=('late_body','ledgerfault','clean206','clean206_retry')
LATE_MESSAGE='Synthetic secondary review CLI late body failure'
LEDGER_MESSAGE='Synthetic secondary review CLI ledger insert failure'
DROP_SQL='begin;drop trigger '+TRIGGER+' on supabase_migrations.schema_migrations;drop schema '+FIXTURE+' cascade;commit;'


def scaffold(mode,binding,package,parent):
    assert mode in ('ledgerfault','clean206')
    checks=installed_checks_sql(package['expected'])
    assert checks.startswith('do $review_installed$ ') and checks.endswith('end $review_installed$;\n')
    checks=checks.replace('do $review_installed$ ', 'create function '+FIXTURE+'.installed_checks()returns void language plpgsql as $review_installed$ ',1)
    parent_check=parent_checks_sql(parent)
    assert parent_check.startswith('do $review_parent$ ') and parent_check.endswith('end $review_parent$;\n')
    parent_check=parent_check.replace('do $review_parent$ ', 'create function '+FIXTURE+'.parent_checks()returns void language plpgsql as $review_parent$ ',1)
    action='perform pg_advisory_xact_lock('+str(GATE_KEY)+',0);'
    if mode=='ledgerfault':action+="raise exception '"+LEDGER_MESSAGE+"'using errcode='P0001';"
    from secondary_review_release import literal
    return 'begin;create schema '+FIXTURE+';\n'+checks+parent_check+"""
create function controlled_review_cli_fixture.ledger_guard()returns trigger language plpgsql as $guard$
begin
 if new.version=__VERSION__ then
  if new.name is distinct from __NAME__ then raise exception 'Review CLI fixture name mismatch'using errcode='P0003';end if;
  perform controlled_review_cli_fixture.parent_checks();
  perform controlled_review_cli_fixture.installed_checks();
  if not exists(select 1 from pg_locks where pid=pg_backend_pid()and locktype='advisory'and classid=90271040::oid and objid=0::oid and objsubid=2 and mode='ExclusiveLock'and granted)then
   raise exception 'Review CLI fixture barrier missing'using errcode='P0003';end if;
  __ACTION__
 end if;
 return new;
end$guard$;
create trigger controlled_review_cli_206 before insert on supabase_migrations.schema_migrations for each row execute function controlled_review_cli_fixture.ledger_guard();
commit;
""".replace('__VERSION__',literal(binding['version'])).replace('__NAME__',literal(binding['name'])).replace('__ACTION__',action)


def failure(result,case):
    assert case in ('late_body','ledgerfault') and type(result.returncode)is int and result.returncode!=0
    envelopes=[]
    for line in (result.stdout+'\n'+result.stderr).splitlines():
        if line.lstrip().startswith('{'):
            envelopes.append(json.loads(line,object_pairs_hook=old_atomic.release._unique))
    assert len(envelopes)==1 and set(envelopes[0])=={'_tag','error'}
    envelope=envelopes[0]
    assert envelope['_tag']=='Error' and set(envelope['error'])=={'code','message'}
    assert envelope['error']['code']=='MigrationApplyError'
    message=LATE_MESSAGE if case=='late_body'else LEDGER_MESSAGE
    assert envelope['error']['message'].splitlines()[0]=='ERROR: '+message+' (SQLSTATE P0001)', 'Exact primary SQLSTATE/message required'


def run_checked(run_cli,case,body):
    result=run_cli(case,body)
    assert set(result)=={'result','barrier_observation'}
    if case in ('ledgerfault','clean206'):
        flags=result['barrier_observation']
        assert set(flags)==set(old_atomic.OBSERVER_FLAGS) and all(v is True for v in flags.values())
    else:assert result['barrier_observation'] is None
    return result['result']


def rehearse(sql,run_cli,source,binding,parent,save):
    package=check_cli_body(source)
    body=package['body']
    assert hashlib.sha256(body.encode()).hexdigest()==binding['body_sha256']
    baseline=snapshot(sql)
    reference=verify_reference205(baseline,package,parent)
    save('baseline',baseline)
    failures=[]
    for case in ('late_body','ledgerfault'):
        if case=='late_body':
            injected=parent_checks_sql(parent)+installed_checks_sql(package['expected'])+"do $late$ begin if not exists(select 1 from pg_locks where pid=pg_backend_pid()and locktype='advisory'and classid=90271040::oid and objid=0::oid and objsubid=2 and mode='ExclusiveLock'and granted)then raise exception 'Review CLI late stage barrier missing'using errcode='P0003';end if;raise exception '"+LATE_MESSAGE+"'using errcode='P0001';end$late$;\n"
            assert body.count(MARKERS['before_commit'])==1
            candidate=body.replace(MARKERS['before_commit'],injected+MARKERS['before_commit'])
        else:
            sql(scaffold(case,binding,package,parent));candidate=body
        armed=snapshot(sql);save(case+'-armed',armed)
        try:
            failure(run_checked(run_cli,case,candidate),case)
            after=snapshot(sql);save(case+'-after',after)
            assert after==armed,'Failed206 CLI migration changed armed full rows/catalog/ledger'
        finally:
            if case=='ledgerfault':sql(DROP_SQL)
        cleaned=snapshot(sql);save(case+'-cleaned',cleaned)
        assert cleaned==baseline,'Owned206 fault fixture removal changed original baseline'
        failures.append(dict(case=case,sqlstate='P0001',armed_full_rollback=True,cleaned_baseline_exact=True))
    sql(scaffold('clean206',binding,package,parent))
    try:assert run_checked(run_cli,'clean206',body).returncode==0,'Clean206 CLI failed'
    finally:sql(DROP_SQL)
    installed=verify_installed(sql,source,baseline,binding,parent);save('installed206',installed)
    assert run_checked(run_cli,'clean206_retry',body).returncode==0,'206 CLI no-op failed'
    retried=verify_installed(sql,source,baseline,binding,parent);save('retried206',retried)
    assert installed==retried,'Already-applied206 CLI changed full database state'
    return dict(kind='controlled-review-cli206-atomicity-v1',passed=True,reference205=reference,
                failures=failures,original_relation_count=len(baseline['rows']),
                baseline_sha256=digest(baseline),installed_sha256=digest(installed),
                original205_rows_preserved=True,retained205_statement_count=94,
                installed206_statement_count=304,exact_retry_noop=True,
                private_acl_and_empty_operations_verified_before_after_retry=True)
