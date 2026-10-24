"""Owned callback-only parent-history / empty-v3 structural restore proof.

No connection or process is created independently. The caller's Runtime owns
the local server, immutable container IDs, file-backed evidence and deadline.
This is neither populated v3 history recovery nor Auth signing/full-cluster backup.
"""
import json
import re
import uuid

import record_review_v3_gate_a as assembly
import record_review_v3_gate_a_snapshot as capture
import secondary_review_restore_ownership as ownership
from secondary_review_gate_a import native_fixture
from history_environment import POSTGRES_INDEX_DIGEST

SCOPES=ownership.SCOPES+('controlled_review_v3',)
OLD_SCOPE="('public','auth','storage','extensions','supabase_migrations','controlled_review')"
NEW_SCOPE="('public','auth','storage','extensions','supabase_migrations','controlled_review','controlled_review_v3')"
assert ownership.MAP_SQL.count(OLD_SCOPE)==1
MAP_SQL=ownership.MAP_SQL.replace(OLD_SCOPE,NEW_SCOPE)
LONG_SQL=ownership.LONG_FUNCTIONS_SQL.replace(OLD_SCOPE,NEW_SCOPE)
SCHEMA_OWNERS={'public':'pg_database_owner','auth':'supabase_admin','storage':'supabase_admin',
    'extensions':'postgres','supabase_migrations':'postgres','controlled_review':'postgres','controlled_review_v3':'postgres'}
# Predetermined selected-schema restore profile, checked before any dump. These
# bootstrap prerequisites are not captured live or promoted into either seal.
BOOTSTRAP_EXTENSIONS={
    'pgcrypto':dict(name='pgcrypto',owner='supabase_admin',schema='extensions',version='1.3'),
    'uuid-ossp':dict(name='uuid-ossp',owner='supabase_admin',schema='extensions',version='1.1')}
EXTENSION_PROFILE={**BOOTSTRAP_EXTENSIONS,
    'pg_net':dict(name='pg_net',owner='supabase_admin',schema='public',version='0.20.4'),
    'pg_stat_statements':dict(name='pg_stat_statements',owner='supabase_admin',schema='extensions',version='1.11')}
PROFILE_PROVENANCE=dict(kind='predetermined-restrictive-selected-schema-restore-profile-v1',
    postgres_index_digest=POSTGRES_INDEX_DIGEST,
    ownership_constants_proven_from_bootstrap_source=False,
    prior_live_owner_observation_is_authority=False,
    partial_primary_source_chain=[
        'https://github.com/postgres/postgres/blob/REL_17_6/contrib/pgcrypto/pgcrypto.control',
        'https://github.com/postgres/postgres/blob/REL_17_6/contrib/uuid-ossp/uuid-ossp.control',
        'https://github.com/supabase/postgres/blob/17.6.1.171/Dockerfile-17',
        'https://github.com/supabase/postgres/blob/17.6.1.171/migrations/db/init-scripts/00000000000000-initial-schema.sql',
        'https://github.com/supabase/cli/blob/v2.118.0/apps/cli-go/internal/db/start/start.go'],
    scope='Fixed compatibility admission constraints; prior native-owner restore observations corroborate only; no seal changes or owner repair')
KIND_COUNTS={
    'receive_inventory':1,'adjust_inventory':2,'record_patient_treatment':1,
    'record_anesthesia_drug_administration':1,'record_native_dispense':2,'record_native_pickup':1,
    **{'record_native_dispense_return:'+k:1 for k in ('intake','dispose','restock')},
    **{'record_native_dispense_return_v2:'+k:(2 if k=='retract_disposal' else 1)
       for k in ('intake','dispose','restock','retract_intake','retract_disposal','retract_restock')},
    **{'record_native_return_discrepancy:'+k:(2 if k=='report' else 1)
       for k in ('report','note','resolve_corrected','resolve_confirmed_original')},
    **{'append_native_dispense_correction:'+k:1 for k in ('clinical_annotation','operational_annotation','pickup_amendment')}}


def q(value): return "'"+str(value).replace("'","''")+"'"


SEED_CHECK_SQL=r"""begin;
do $history$ declare e record;r jsonb;expected jsonb;begin
 for e in select * from public.controlled_stock_events order by product_id,sequence loop
  perform public.controlled_stock_validate_event(e.id);
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',e.actor_id,'session_id',e.session_id)::text,true);
  select receipt into strict expected from public.controlled_stock_actions where id=e.id;
  r:=public.read_controlled_stock_action(e.actor_id,e.id);
  if r->>'state' is distinct from 'saved' or r->'receipt' is distinct from expected
   or public.execute_controlled_stock_action(e.actor_id,e.id) is distinct from expected then
   raise exception 'Exact genuine controlled saved receipt required'using errcode='23514';end if;
 end loop;
end $history$;
select jsonb_build_object('events',(select count(*)from public.controlled_stock_events),
 'actions',(select count(*)from public.controlled_stock_actions),
 'preparations',(select count(*)from public.controlled_stock_preparations),
 'kinds',(select jsonb_object_agg(event_kind,n)from(select event_kind,count(*)n from public.controlled_stock_events group by event_kind)x),
 'native_dispenses',(select count(*)from public.native_dispenses),
 'native_returns',(select count(*)from public.native_return_events),
 'native_discrepancies',(select count(*)from public.native_return_discrepancy_events),
 'native_annotations',(select count(*)from public.native_dispense_correction_events),
 'receipts_validated',true);
rollback;
"""


def validate_seed_counts(value):
    assert set(value)=={'events','actions','preparations','kinds','native_dispenses','native_returns',
                        'native_discrepancies','native_annotations','receipts_validated'}
    assert type(value['events']) is int and value['events']==26
    assert type(value['actions']) is int and value['actions']==26
    assert type(value['preparations']) is int and value['preparations']>=26
    assert value['kinds']==KIND_COUNTS and all(type(n) is int for n in value['kinds'].values())
    assert value['receipts_validated'] is True
    for key,minimum in [('native_dispenses',2),('native_returns',10),('native_discrepancies',5),('native_annotations',3)]:
        assert type(value[key]) is int and value[key]>=minimum,'Genuine source history absent: '+key
    return value


def seed(runtime, source, save):
    before=capture.snapshot(runtime.query)
    assert before['rows']['public.controlled_stock_events']==[], 'Fresh unpopulated parent fixture required'
    smoke=(source/'smoke.sql').read_text()
    assert smoke.endswith('rollback;\n')
    # Only the retained fixture's final rollback is changed to commit. Its actual
    # owned prepare/execute calls, assertions and source documents are unchanged.
    runtime.query(smoke[:-len('rollback;\n')]+'commit;\n')
    native_fixture(runtime,source)
    populated=capture.snapshot(runtime.query)
    counts=validate_seed_counts(capture.parse(runtime.query(SEED_CHECK_SQL)))
    after=capture.snapshot(runtime.query)
    assert after==populated,'Saved physical receipt validation changed source state'
    for name,rows in before['rows'].items():
        if name.startswith(('controlled_review.','controlled_review_v3.')):
            assert after['rows'][name]==rows,'Source fixture changed private review history'
    for key in ('catalog','types','ledger','parent','parent_literal','parent_literal_hash_valid','writers','private206','private206_literal'):
        assert after[key]==before[key],'Genuine source fixture changed metadata/ledger: '+key
    save('restore-genuine-parent-history-counts',counts)
    save('restore-genuine-parent-history',after)
    return dict(genuine_canonical_writer_history=True,counts=counts,
                synthetic_sql_claims_only=True,auth_signing_claim=False,adapter_coverage_claim=False)


def admitted_ownership(value):
    assert type(value) is dict and set(value)=={'entries','extensions'}
    # Reuse the old finite object-kind/role checks only for the old scope. The
    # new private namespace is separately required to be entirely postgres-owned.
    old=dict(entries=[e for e in value['entries'] if not(e['identity']=='controlled_review_v3' or e['identity'].startswith('controlled_review_v3.'))],
             extensions=value['extensions'])
    ownership.admitted(old)
    keys=[(e['kind'],e['identity'])for e in value['entries']]
    assert len(keys)==len(set(keys)),'Duplicate normalized ownership identities'
    schemas={e['identity']:e['owner'] for e in value['entries']if e['kind']=='schema'}
    assert schemas==SCHEMA_OWNERS,'Selected schema ownership profile differs'
    v3=[e for e in value['entries']if e['identity']=='controlled_review_v3' or e['identity'].startswith('controlled_review_v3.')]
    assert v3 and all(e['owner']=='postgres' and e['extension'] is None for e in v3),'Private v3 ownership differs'
    validate_extension_profile(value['extensions'])
    return value


EXTENSION_PROFILE_SQL="""select coalesce(jsonb_agg(jsonb_build_object(
 'name',e.extname,'owner',pg_get_userbyid(e.extowner),'schema',n.nspname,'version',e.extversion)
 order by e.extname),'[]')from pg_extension e join pg_namespace n on n.oid=e.extnamespace
 where n.nspname in """+NEW_SCOPE+';'


def validate_extension_profile(value):
    assert isinstance(value,list),'Exact selected extension inventory required'
    assert all(isinstance(e,dict) and set(e)=={'name','owner','schema','version'}for e in value),'Exact extension fields required'
    extensions={e['name']:e for e in value}
    assert len(extensions)==len(value),'Duplicate extension inventory'
    assert extensions==EXTENSION_PROFILE,'Fixed selected extension profile differs'
    return value


def extension_bootstrap():
    # Fixed owner BEFORE object creation/ACL restore. No ALTER OWNER repair based
    # on source observations; pg_dump restores retained native ownership itself.
    return ('begin;drop schema public;create schema public authorization pg_database_owner;'
            'create schema extensions authorization postgres;'
            'set local role supabase_admin;'
            "create extension pgcrypto with schema extensions version '1.3';"
            "create extension \"uuid-ossp\" with schema extensions version '1.1';"
            "create extension pg_net with schema public version '0.20.4';"
            "create extension pg_stat_statements with schema extensions version '1.11';"
            'reset role;commit;')


def rewrite_dump(dump):
    lines=dump.splitlines()
    replacements={}
    for name,owner in (('public','pg_database_owner'),('extensions','postgres')):
        statement='CREATE SCHEMA '+name+';'
        assert lines.count(statement)==1,'Exact standalone '+name+' schema dump required'
        assert lines.count('ALTER SCHEMA '+name+' OWNER TO '+owner+';')==1,'Exact native schema owner statement required'
        replacements[statement]='CREATE SCHEMA IF NOT EXISTS '+name+';'
    assert 'OWNER TO' in dump and 'GRANT ' in dump,'Native owner/ACL dump required'
    assert 'CREATE SCHEMA controlled_review_v3;' in dump,'Dump omitted v3 schema'
    # Same cluster supplies roles/default privileges. Excluding these commands is
    # explicit; no default-ACL or whole-cluster restore claim is made.
    return '\n'.join(replacements.get(line,line) for line in lines if not line.startswith('ALTER DEFAULT PRIVILEGES'))


def validate_installed(value, package, observed_v3):
    expected=package['expected']
    assert set(value)==capture.KEYS
    assert set(value['catalog']['schemas'])==set(SCOPES),'Selected schemas incomplete or extra'
    assert value['ledger']==package['expected_ledger206'],'Fixed full206 ledger differs'
    assert value['parent']==expected['parents']['parent205']['manifest'],'Frozen205 actual metadata differs'
    assert value['parent_literal_hash_valid'] is True
    assert len(value['parent_literal'])==1
    parent=value['parent_literal'][0]
    assert type(parent['revision']) is int and parent['revision']==1 and parent['definition']==value['parent']
    parent_raw=(assembly.SOURCE/'release-expected-204.json').read_bytes()
    assert assembly.descriptor.sha(parent_raw)==assembly.descriptor.PARENT_SHA
    assert value['writers']==json.loads(parent_raw)['canonical_writer_definition_hashes']
    assert value['private206']==expected['parents']['private206']
    assert value['private206_literal']==[{'id':True,'definition':value['private206']}]
    assert value['private206_literal'][0]['id'] is True
    assert observed_v3==expected,'Independent v3 metadata differs'
    descriptor=value['rows'].get('controlled_review_v3.descriptor')
    assert descriptor==[{'id':True,'definition':expected}] and descriptor[0]['id'] is True,'Exact v3 descriptor missing'
    for prefix,names in [('controlled_review',('definitions','preparations','decisions','cancellations')),
                         ('controlled_review_v3',tuple(n for n in assembly.descriptor.TABLES if n!='descriptor'))]:
        for name in names:assert value['rows'][prefix+'.'+name]==[],'Operational review rows must remain empty'
    return value


def compare_clone(source, clone, source_ownership, clone_ownership, package, observed_v3):
    validate_installed(clone,package,observed_v3)
    for key in capture.KEYS-{'catalog','types'}:
        assert clone[key]==source[key],'Selected restored state differs: '+key
    admitted_ownership(source_ownership);admitted_ownership(clone_ownership)
    assert ownership.auth_entries(clone_ownership)==ownership.auth_entries(source_ownership),'Auth owners/raw ACLs/column ACLs/grantors differ'
    assert clone_ownership['extensions']==source_ownership['extensions'],'Selected extension identity/ownership/version differs'
    return True


def drop_clone(runtime, database, marker):
    assert re.fullmatch(r'owned_review_restore_[0-9a-f]{10}',database)
    assert runtime.databases.get(database)==marker
    actual=runtime.query("select shobj_description(oid,'pg_database')from pg_database where datname="+q(database)+';').strip()
    assert actual==marker,'Owned clone marker changed; refuse drop'
    runtime.query('drop database '+database+' with(force);')
    assert runtime.query('select count(*)from pg_database where datname='+q(database)+';').strip()=='0'
    del runtime.databases[database]


RESTORE_REFUSAL_CASES = (
    'missing_schema','missing_descriptor','disabled_child_ri','disabled_parent_ri',
    'changed_private_owner','changed_private_acl','changed_private_column_acl',
    'auth_owner','auth_column_acl')


def validate_refusal_matrix(results):
    """Require the complete ordered matrix, with formal successful proof flags."""
    assert isinstance(results,list) and len(results)==len(RESTORE_REFUSAL_CASES),'Complete nine restore refusals required'
    for index,(name,result) in enumerate(zip(RESTORE_REFUSAL_CASES,results)):
        assert isinstance(result,dict) and result.get('case')==name,'Exact ordered restore refusal names required'
        assert result.get('rollback_exact') is True,'Exact restore rollback proof required'
        if index<7:
            assert set(result)=={'case','sqlstate','rollback_exact'},'Exact SQL refusal proof fields required'
            assert result['sqlstate']==('3F000' if index==0 else '23514'),'Exact restore refusal SQLSTATE required'
        else:
            assert set(result)=={'case','comparison_refused','rollback_exact'},'Exact Auth refusal proof fields required'
            assert result['comparison_refused'] is True,'Actual Auth comparison refusal required'
    return list(RESTORE_REFUSAL_CASES)


def restore_primary_failure(result,code,message):
    """Bind these finite restore diagnostics to the sole primary server error."""
    assert capture.primary_failure(result,code,message)==message,'Exact restore primary diagnostic required'


def clone_refusals(runtime, database, package, baseline, source_ownership, save):
    parent_ri=r"""do $disable_v3_ri$ declare r record;n integer:=0;begin
 for r in select t.tgname from pg_trigger t join pg_constraint c on c.oid=t.tgconstraint
 where c.connamespace='controlled_review_v3'::regnamespace and c.conname='obligations_event_fk'
 and c.conrelid='controlled_review_v3.obligations'::regclass
 and c.confrelid='public.controlled_stock_events'::regclass
 and t.tgrelid=c.confrelid and t.tgisinternal and t.tgenabled='O' loop
  execute format('alter table public.controlled_stock_events disable trigger %I',r.tgname);n:=n+1;
 end loop;if n<>2 then raise exception 'Exact two new parent RI triggers required'using errcode='P0003';end if;
end $disable_v3_ri$;"""
    cases=(
        ('missing_schema','drop schema controlled_review_v3 cascade;','3F000','schema "controlled_review_v3" does not exist'),
        ('missing_descriptor','alter table controlled_review_v3.descriptor disable trigger immutable;delete from controlled_review_v3.descriptor;','23514','Exactly one independent v3 Gate A descriptor required'),
        ('disabled_child_ri','alter table controlled_review_v3.obligations disable trigger all;','23514','Record-review v3 Gate A metadata differs from independent descriptor'),
        ('disabled_parent_ri',parent_ri,'23514','Record-review v3 Gate A metadata differs from independent descriptor'),
        ('changed_private_owner','alter table controlled_review_v3.operation_claims owner to supabase_admin;','23514','Record-review v3 Gate A metadata differs from independent descriptor'),
        ('changed_private_acl','grant select on controlled_review_v3.operation_claims to authenticated;','23514','Record-review v3 Gate A metadata differs from independent descriptor'),
        ('changed_private_column_acl','grant select(actor_id)on controlled_review_v3.operation_claims to authenticated;','23514','Record-review v3 Gate A metadata differs from independent descriptor'))
    results=[]
    for name,mutation,code,message in cases:
        marker='V3_RESTORE_FAULT_ARMED_'+name
        sql='begin;'+mutation+'select '+q(marker)+';select controlled_review_v3.required();rollback;'
        result=runtime.sql(sql,database,fail=False,user='supabase_admin')
        assert result.returncode!=0 and result.stdout.strip()==marker,'Restore fault did not reach intended observation: '+name
        restore_primary_failure(result,code,message)
        restored=capture.snapshot(lambda s:runtime.query(s,database))
        assert restored==baseline,'Restore negative did not roll back exactly: '+name
        results.append(dict(case=name,sqlstate=code,rollback_exact=True))
    # The actual clone's Auth ownership and column ACL are also perturbed, not
    # merely covered by Python mock expectations. No role/session is activated.
    for name,mutation in (
        ('auth_owner','alter table auth.users owner to postgres;'),
        ('auth_column_acl','grant select(id)on auth.users to anon;')):
        changed=capture.parse(runtime.sql('begin;'+mutation+MAP_SQL+'rollback;',database,user='supabase_admin').stdout)
        assert ownership.auth_entries(changed)!=ownership.auth_entries(source_ownership),'Auth fault was ineffective'
        try:
            compare_clone(baseline,baseline,source_ownership,changed,package,package['expected'])
        except AssertionError as exc:
            assert str(exc)=='Auth owners/raw ACLs/column ACLs/grantors differ'
        else:raise AssertionError('Altered Auth restore was accepted')
        assert capture.snapshot(lambda s:runtime.query(s,database))==baseline,'Auth fault did not roll back exactly'
        results.append(dict(case=name,comparison_refused=True,rollback_exact=True))
    validate_refusal_matrix(results)
    save('restore-clone-refusals',results)
    return results


def restore(runtime, package, save):
    runtime.verify()
    source=capture.snapshot(runtime.query)
    runtime.query(package['postcheck_sql'])
    validate_installed(source,package,capture.parse(runtime.query(package['snapshot_sql'])))
    source_ownership=admitted_ownership(capture.parse(runtime.query(MAP_SQL)))
    ownership.verify_long_identities(source_ownership,capture.parse(runtime.query(LONG_SQL)))
    save('restore-profile-provenance',PROFILE_PROVENANCE)
    save('restore-source-full',source);save('restore-source-owner-acl',source_ownership)
    dump=runtime.command(['docker','exec',runtime.container,'pg_dump','-U','postgres',
        *['--schema='+name for name in SCOPES],'postgres'],timeout=120).stdout
    (runtime.folder/'v3-selected-schema-native-owner-dump.sql').write_text(dump)
    rewritten=rewrite_dump(dump)
    database='owned_review_restore_'+uuid.uuid4().hex[:10];marker=str(uuid.uuid4())
    runtime.query('create database '+database+';')
    runtime.databases[database]=marker
    runtime.query('comment on database '+database+' is '+q(marker)+';')
    save('restore-clone-registration',dict(database=database,marker=marker,container_id=runtime.container))
    try:
        runtime.sql(extension_bootstrap(),database,user='supabase_admin')
        bootstrap_profile=validate_extension_profile(capture.parse(runtime.query(EXTENSION_PROFILE_SQL,database)))
        save('restore-clone-bootstrap-extension-profile',bootstrap_profile)
        runtime.sql(rewritten,database,user='supabase_admin')
        sql=lambda text:runtime.query(text,database)
        sql(package['postcheck_sql'])
        clone=capture.snapshot(sql)
        clone_ownership=admitted_ownership(capture.parse(sql(MAP_SQL)))
        ownership.verify_long_identities(clone_ownership,capture.parse(sql(LONG_SQL)))
        compare_clone(source,clone,source_ownership,clone_ownership,package,capture.parse(sql(package['snapshot_sql'])))
        save('restore-clone-full',clone);save('restore-clone-owner-acl',clone_ownership)
        save('restore-owner-acl-differences',ownership.differences(source_ownership,clone_ownership))
        counts=validate_seed_counts(capture.parse(sql(SEED_CHECK_SQL)))
        assert capture.snapshot(sql)==clone,'Restored physical receipt validation changed selected state'
        negatives=clone_refusals(runtime,database,package,clone,source_ownership,save)
        sql(package['postcheck_sql'])
        assert capture.snapshot(sql)==clone,'Restored state changed after refusal matrix'
    finally:
        # Normal cleanup consumes the same caller workload deadline. A failure
        # leaves the registered marker for Runtime's independently bounded cleanup.
        drop_clone(runtime,database,marker)
    final=capture.snapshot(runtime.query)
    assert final==source,'Restore rehearsal changed the full source database'
    save('restore-source-recheck',final)
    return dict(passed=True,source_full_snapshot_unchanged=True,clone_dropped=True,
        selected_schemas=list(SCOPES),row_families=len(clone['rows']),parent_history=counts,
        all_selected_rows_ledger_literals_writers_equal=True,independent_three_seals_equal=True,
        auth_owner_raw_acl_column_acl_grantors_equal=True,refusal_cases=negatives,
        refusal_case_names=validate_refusal_matrix(negatives),
        private206_operational_rows_empty=True,v3_operational_rows_empty=True,
        same_owned_server=True,native_owner_before_acl_restore=True,
        restore_profile_provenance=PROFILE_PROVENANCE,
        cross_database_oid_equality_claim=False,all_extension_member_acl_equality_claim=False,
        roles_or_default_acl_restore_claim=False,storage_bytes_restore_claim=False,
        whole_cluster_restore_claim=False,populated_v3_review_history_claim=False,
        auth_signing_claim=False,physical_after_backup_recovery_claim=False)
