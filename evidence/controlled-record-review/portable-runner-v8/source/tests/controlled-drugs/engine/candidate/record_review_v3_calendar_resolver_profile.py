"""Pure admitted-parent calendar-resolver profile; no runtime, grants, or frozen pin writes."""
from copy import deepcopy
from pathlib import Path
import json
import sys

PROFILE=Path(__file__).resolve().parent
SOURCE=PROFILE if PROFILE.name=="candidate" else PROFILE.parents[2]/"tests/controlled-drugs/engine/candidate"
sys.path.insert(0,str(PROFILE));sys.path.insert(1,str(SOURCE))
import record_review_v3_calendar_resolver_descriptor as descriptor
import record_review_v3_gate_b as predecessor
import record_review_v3_configuration_record_admission as parent_admission
import secondary_review_release as old_release

EXPECTED_BASE='fec2ff871f064a124ae3a0fb5ba60e36b8b58dda1932393cd656c43cd68abd7d'
INSTALL_BASE='22021a314fc196efa822a16ca30d25c7f9f6e70811703fe60eb747d92280d542'
MAP_BASE='8bd3e00b7250899b4167441cc16ec47b529cc0896a7e4dbc5a83bcc11d73a725'
ADMISSION_BASE='1599f6e5c8094e2db72bfc3784484d810ec2cf8d0f211e9d4ea8bf24ff4cb34a'
WRAPPER_BASE='a04712e3c1819d1903c6e0a2e2ede1453b13a0456e9f7fccb43712381c12bea2'
REQUIRED_SOURCE_CHANGES={
 'Exactly one independent v3 configuration-record descriptor required':'Exactly one independent v3 calendar-resolver descriptor required',
 'Unchanged frozen205 and empty private206 required for v3 configuration-record':'Unchanged frozen205 and empty private206 required for v3 calendar-resolver',
 'Record-review v3 configuration-record metadata differs from independent descriptor':'Record-review v3 calendar-resolver metadata differs from independent descriptor'}
NEW_NAMES={'record-review-v3-calendar.sql','record-review-v3-calendar-resolver-schema.sql','record-review-v3-calendar-resolver-metadata.json','record-review-v3-calendar-resolver-profile.json','record_review_v3_calendar_resolver_descriptor.py','record_review_v3_calendar_resolver_profile.py'}
assert len(NEW_NAMES)==6

def finite_delta(before,after,source):
    remaining=deepcopy(after)
    for name,result,language,argument,body in descriptor.read_new_functions(source,source):
        signature='controlled_review_v3.'+name+'('+argument+')'
        assert signature not in before['functions']
        assert remaining['functions'].pop(signature)==descriptor.function_metadata(body,result,language,argument,False)
    assert len(before['functions'])==37 and len(after['functions'])==39
    assert remaining['kind']==descriptor.KIND;remaining['kind']=before['kind']
    required='controlled_review_v3.required()';snapshot='controlled_review_v3.snapshot()'
    wanted=before['functions'][required]['source']
    for old,new in REQUIRED_SOURCE_CHANGES.items():
        assert wanted.count(old)==1;wanted=wanted.replace(old,new)
    assert remaining['functions'][required]['source']==wanted
    wanted=before['functions'][snapshot]['source'];old="'controlled-review-v3-private-configuration-record-v1'"
    assert wanted.count(old)==1
    assert remaining['functions'][snapshot]['source']==wanted.replace(old,"'"+descriptor.KIND+"'")
    for signature in (required,snapshot):remaining['functions'][signature]['source']=before['functions'][signature]['source']
    assert remaining==before,'Only two new helpers and two declared body changes allowed'


def installed_checks_sql(expected):
    # Explicit new declaration, not a patch to an existing rendered installer.
    literal=old_release.sql_json(expected)
    facades='array['+','.join(old_release.literal(n)for n in descriptor.FACADES)+']::text[]'
    tables='array['+','.join(old_release.literal(n)for n in descriptor.TABLES if n!='descriptor')+']::text[]'
    return f"""do $calendar_resolver_installed$ declare r record;n bigint;begin
 perform controlled_review_v3.required();
 if controlled_review_v3.snapshot()is distinct from {literal} then raise exception 'Calendar-resolver independent metadata mismatch'using errcode='23514';end if;
 if(select count(*)<>1 or not bool_and(id and definition={literal})from controlled_review_v3.descriptor)then raise exception 'Calendar-resolver independent descriptor mismatch'using errcode='23514';end if;
 if exists(select 1 from unnest(array['anon','authenticated','service_role'])role_name where
 has_schema_privilege(role_name,'controlled_review_v3','USAGE,CREATE')
 or exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where(ns.nspname='controlled_review_v3'or(ns.nspname='public'and p.proname=any({facades})))and has_function_privilege(role_name,p.oid,'EXECUTE'))
 or exists(select 1 from pg_class c where c.relnamespace='controlled_review_v3'::regnamespace and c.relkind in('r','p')and(has_table_privilege(role_name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')or has_any_column_privilege(role_name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))))then raise exception 'Calendar-resolver effective private privileges changed'using errcode='23514';end if;
 for r in select unnest({tables})as name loop
 execute format('select count(*)from controlled_review_v3.%I',r.name)into n;
 if n<>0 then raise exception 'Calendar-resolver must not seed configuration or evidence'using errcode='23514';end if;
 end loop;
end $calendar_resolver_installed$;
"""


def build(source=SOURCE,profile=PROFILE):
    source=Path(source).resolve();profile=Path(profile).resolve();root=source.parents[3]
    assert source==profile and source==root/'tests/controlled-drugs/engine/candidate','Canonical-layout source required'
    manifest=descriptor.admit_manifest(profile)
    pinned=manifest['parent_input_source_hashes']
    assert len(pinned)==269 and descriptor.sha(descriptor.canonical(pinned).encode())==MAP_BASE
    parent_admission.validate_source_bytes(root,pinned)
    expected_migrations={name for name in pinned if name.startswith('supabase/migrations/')and name.endswith('.sql')}
    actual_migrations={str(path.relative_to(root))for path in(root/'supabase/migrations').glob('*.sql')}
    assert len(expected_migrations)==206 and actual_migrations==expected_migrations,'Exact staged206 migration inventory required'
    for module,name in ((parent_admission,'record_review_v3_configuration_record_admission.py'),(descriptor,'record_review_v3_calendar_resolver_descriptor.py')):
        assert descriptor.sha(Path(module.__file__).read_bytes())==descriptor.sha((source/name).read_bytes())
    assert descriptor.sha(Path(__file__).read_bytes())==descriptor.sha((source/'record_review_v3_calendar_resolver_profile.py').read_bytes())
    assert descriptor.sha(Path(parent_admission.__file__).read_bytes())==ADMISSION_BASE
    admitted=parent_admission.admit()  # Fixed canonical no-argument admission; no globals/root substitution.
    assert admitted['wrapper_sha256']==WRAPPER_BASE and admitted['input_source_hashes']==pinned
    assert admitted['definition_sha256']==EXPECTED_BASE and len(admitted['derivation_input_sha256'])==267
    before=admitted['package']
    assert before['expected_sha256']==EXPECTED_BASE and before['install_sha256']==INSTALL_BASE
    assert descriptor.sha(descriptor.canonical(before['expected']).encode())==EXPECTED_BASE
    assert descriptor.sha(before['install'].encode())==INSTALL_BASE
    bundle=descriptor.build(source,profile)
    finite_delta(before['expected'],bundle['expected'],source)
    parent=json.loads((source/'release-expected-204.json').read_text(),object_pairs_hook=descriptor.unique)
    ledger=before['expected_ledger206']
    preflight=predecessor.ledger_checks_sql(ledger)+old_release.parent_checks_sql(parent)+old_release.installed_checks_sql(bundle['expected']['parents']['private206'])+bundle['absence_sql']+'\n'
    postcheck=old_release.parent_checks_sql(parent)+old_release.installed_checks_sql(bundle['expected']['parents']['private206'])+installed_checks_sql(bundle['expected'])
    # Reused exact source-proved observer, same database only, never expected authority.
    preservation=predecessor.preservation_sql()
    verify="""do $calendar_resolver_preserved$ begin
 if(select count(*)from pg_temp.record_review_v3_gate_b_before)<>1
 or not exists(select 1 from pg_temp.record_review_v3_gate_b_before b where b.rows=pg_temp.record_review_v3_gate_b_rows()and b.catalog=pg_temp.record_review_v3_gate_b_catalog())then raise exception 'Calendar-resolver original206 rows ledger or raw catalog changed'using errcode='23514';end if;
end $calendar_resolver_preserved$;
"""
    marks=descriptor.MARKERS
    body='select pg_advisory_xact_lock(90271040,0);\n'+marks['admission']+'\n'+preflight+preservation+bundle['ddl']+'\n'+bundle['descriptor_insert']+'\n'+marks['after_descriptor']+'\n'+marks['before_postcheck']+'\n'+postcheck+verify+marks['before_commit']+'\n'
    install='begin;\n'+body+'commit;\n'
    assert all(install.count(m)==1 for m in marks.values())
    inputs=dict(pinned)
    additional=dict(bundle['source_hashes'])
    additional[str((source/'record_review_v3_calendar_resolver_profile.py').relative_to(root))]=descriptor.sha(Path(__file__).read_bytes())
    for name,digest in additional.items():
        assert name not in inputs or inputs[name]==digest,'Source-map collision'
        inputs[name]=digest
    wanted={str((source/name).relative_to(root))for name in NEW_NAMES}
    assert len(inputs)==275 and set(inputs)==set(pinned)|wanted,'Exact admitted269 plus six resolver-profile inputs required'
    assert {name:inputs[name]for name in pinned}==pinned
    assert all(descriptor.sha((root/name).read_bytes())==digest for name,digest in inputs.items())
    parent_admission.validate_source_bytes(root,inputs)
    result=dict(bundle)
    result.update(preflight_sql=preflight,postcheck_sql=postcheck,preservation_sql=preservation,preservation_check_sql=verify,
        install=install,markers=dict(marks),expected_ledger206=ledger,canonical206_binding=before['canonical206_binding'],
        input_source_hashes=inputs,predecessor_input_source_hashes=pinned,
        fixed_parent_input_source_hashes=pinned,
        body_sha256=descriptor.sha(body.encode()),install_sha256=descriptor.sha(install.encode()),
        reference_status='candidate_not_admitted',acceptance=False,configuration_input_implemented=True,configuration_record_value_implemented=True,
        configuration_publication_implemented=False,auth_acceptance=False,hosted_writes=0,
        source_integration=False,runtime_executed=False,admitted_artifact=False,protocol_behavior_claim=False,calendar_resolution_implemented=True,predecessor_admission_pending=False,runtime_launch_ready=False,derivation_status='admitted269_plus_six_calendar_sources')
    return result


if __name__=='__main__':
    assert len(sys.argv)==1,'No runtime or arbitrary source options'
    b=build()
    print(descriptor.canonical(dict(stage=b['stage'],reference_status=b['reference_status'],acceptance=False,
        inputs=len(b['input_source_hashes']),functions=len(b['expected']['functions']),expected_sha256=b['expected_sha256'],install_sha256=b['install_sha256'])))
