"""Pure private configuration-record profile; no runtime, grants, or frozen pin writes."""
from copy import deepcopy
from pathlib import Path
import json
import sys

PROFILE=Path(__file__).resolve().parent
SOURCE=PROFILE
sys.path.insert(0,str(PROFILE));sys.path.insert(1,str(SOURCE))
import record_review_v3_configuration_record_descriptor as descriptor
import record_review_v3_gate_b as predecessor
import record_review_v3_configuration_admission as frozen_configuration
import secondary_review_release as old_release

EXPECTED_BASE='2b16f6a9a85e3d23733fc0e455356e6a6c78a288b19bade8807e045e2aba0525'
INSTALL_BASE='617382409f4662586f06a788c9090bfa5a0191b7e7e64e221553adb406395316'
WRAPPER_BASE='10eba1a8691c9da14e6fe3f358a6f846c01e03c919741c7aaae6ad8ab9501116'
ADMISSION_BASE='cb16e13ea3e01068c0e9ddb97babcbedf48be993e848418771e4b25afe98bbbd'
REQUIRED_SOURCE_CHANGES={
 'Exactly one independent v3 configuration-input descriptor required':'Exactly one independent v3 configuration-record descriptor required',
 'Unchanged frozen205 and empty private206 required for v3 configuration-input':'Unchanged frozen205 and empty private206 required for v3 configuration-record',
 'Record-review v3 configuration-input metadata differs from independent descriptor':'Record-review v3 configuration-record metadata differs from independent descriptor'}
NEW_NAMES={name for _,_,name in descriptor.NEW_DECLARATIONS}|{'helpers.sql',
 'record-review-v3-configuration-record-schema.sql','record-review-v3-configuration-record-metadata.json',
 'record-review-v3-configuration-record-profile.json','record_review_v3_configuration_record_descriptor.py','record_review_v3_configuration_record_profile.py'}
assert len(NEW_NAMES)==11

def finite_delta(before,after,source):
    remaining=deepcopy(after)
    for name,result,language,argument,body in descriptor.read_new_functions(source,source):
        signature='controlled_review_v3.'+name+'('+argument+')'
        assert signature not in before['functions']
        assert remaining['functions'].pop(signature)==descriptor.function_metadata(body,result,language,argument,False)
    assert len(before['functions'])==32 and len(after['functions'])==37
    assert remaining['kind']==descriptor.KIND;remaining['kind']=before['kind']
    required='controlled_review_v3.required()';snapshot='controlled_review_v3.snapshot()'
    wanted=before['functions'][required]['source']
    for old,new in REQUIRED_SOURCE_CHANGES.items():
        assert wanted.count(old)==1;wanted=wanted.replace(old,new)
    assert remaining['functions'][required]['source']==wanted
    wanted=before['functions'][snapshot]['source'];old="'controlled-review-v3-private-configuration-input-v1'"
    assert wanted.count(old)==1
    assert remaining['functions'][snapshot]['source']==wanted.replace(old,"'"+descriptor.KIND+"'")
    for signature in (required,snapshot):remaining['functions'][signature]['source']=before['functions'][signature]['source']
    assert remaining==before,'Only five new helpers and two declared body changes allowed'


def installed_checks_sql(expected):
    # Explicit new declaration, not a patch to an existing rendered installer.
    literal=old_release.sql_json(expected)
    facades='array['+','.join(old_release.literal(n)for n in descriptor.FACADES)+']::text[]'
    tables='array['+','.join(old_release.literal(n)for n in descriptor.TABLES if n!='descriptor')+']::text[]'
    return f"""do $configuration_record_installed$ declare r record;n bigint;begin
 perform controlled_review_v3.required();
 if controlled_review_v3.snapshot()is distinct from {literal} then raise exception 'Configuration-record independent metadata mismatch'using errcode='23514';end if;
 if(select count(*)<>1 or not bool_and(id and definition={literal})from controlled_review_v3.descriptor)then raise exception 'Configuration-record independent descriptor mismatch'using errcode='23514';end if;
 if exists(select 1 from unnest(array['anon','authenticated','service_role'])role_name where
 has_schema_privilege(role_name,'controlled_review_v3','USAGE,CREATE')
 or exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where(ns.nspname='controlled_review_v3'or(ns.nspname='public'and p.proname=any({facades})))and has_function_privilege(role_name,p.oid,'EXECUTE'))
 or exists(select 1 from pg_class c where c.relnamespace='controlled_review_v3'::regnamespace and c.relkind in('r','p')and(has_table_privilege(role_name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')or has_any_column_privilege(role_name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))))then raise exception 'Configuration-record effective private privileges changed'using errcode='23514';end if;
 for r in select unnest({tables})as name loop
 execute format('select count(*)from controlled_review_v3.%I',r.name)into n;
 if n<>0 then raise exception 'Configuration-record must not seed configuration or evidence'using errcode='23514';end if;
 end loop;
end $configuration_record_installed$;
"""


def build(source=SOURCE,profile=PROFILE):
    source=Path(source).resolve();profile=Path(profile).resolve();root=source.parents[3]
    assert source==profile and source==root/'tests/controlled-drugs/engine/candidate','Canonical-layout source required'
    descriptor.admit_manifest(profile)
    assert descriptor.sha(Path(frozen_configuration.__file__).read_bytes())==ADMISSION_BASE
    admitted=frozen_configuration.admit()  # Retained API stays fixed-root and unchanged.
    assert admitted['wrapper_sha256']==WRAPPER_BASE and admitted['definition_sha256']==EXPECTED_BASE
    assert len(admitted['input_source_hashes'])==256
    before=admitted['package'];assert before['install_sha256']==INSTALL_BASE
    # A temporary source stage may only substitute byte-identical copies of all
    # fixed admitted dependencies; the retained module's globals are never patched.
    frozen_configuration.validate_source_bytes(root,admitted['input_source_hashes'])
    expected_migrations={name for name in admitted['input_source_hashes']if name.startswith('supabase/migrations/')and name.endswith('.sql')}
    actual_migrations={str(path.relative_to(root))for path in(root/'supabase/migrations').glob('*.sql')}
    assert len(expected_migrations)==206 and actual_migrations==expected_migrations,'Exact staged206 migration inventory required'
    for module,name in ((descriptor,'record_review_v3_configuration_record_descriptor.py'),):
        assert descriptor.sha(Path(module.__file__).read_bytes())==descriptor.sha((source/name).read_bytes())
    assert descriptor.sha(Path(__file__).read_bytes())==descriptor.sha((source/'record_review_v3_configuration_record_profile.py').read_bytes())
    bundle=descriptor.build(source,profile)
    finite_delta(before['expected'],bundle['expected'],source)
    parent=json.loads((source/'release-expected-204.json').read_text(),object_pairs_hook=descriptor.unique)
    ledger=before['expected_ledger206']
    preflight=predecessor.ledger_checks_sql(ledger)+old_release.parent_checks_sql(parent)+old_release.installed_checks_sql(bundle['expected']['parents']['private206'])+bundle['absence_sql']+'\n'
    postcheck=old_release.parent_checks_sql(parent)+old_release.installed_checks_sql(bundle['expected']['parents']['private206'])+installed_checks_sql(bundle['expected'])
    # Reused exact source-proved observer, same database only, never expected authority.
    preservation=predecessor.preservation_sql()
    verify="""do $configuration_record_preserved$ begin
 if(select count(*)from pg_temp.record_review_v3_gate_b_before)<>1
 or not exists(select 1 from pg_temp.record_review_v3_gate_b_before b where b.rows=pg_temp.record_review_v3_gate_b_rows()and b.catalog=pg_temp.record_review_v3_gate_b_catalog())then raise exception 'Configuration-record original206 rows ledger or raw catalog changed'using errcode='23514';end if;
end $configuration_record_preserved$;
"""
    marks=descriptor.MARKERS
    body='select pg_advisory_xact_lock(90271040,0);\n'+marks['admission']+'\n'+preflight+preservation+bundle['ddl']+'\n'+bundle['descriptor_insert']+'\n'+marks['after_descriptor']+'\n'+marks['before_postcheck']+'\n'+postcheck+verify+marks['before_commit']+'\n'
    install='begin;\n'+body+'commit;\n'
    assert all(install.count(m)==1 for m in marks.values())
    inputs=dict(admitted['input_source_hashes'])
    additional=dict(bundle['source_hashes'])
    additional[str((source/'record_review_v3_configuration_record_profile.py').relative_to(root))]=descriptor.sha(Path(__file__).read_bytes())
    for name,digest in additional.items():
        assert name not in inputs or inputs[name]==digest,'Source-map collision'
        inputs[name]=digest
    wanted={str((source/name).relative_to(root))for name in NEW_NAMES}
    assert len(inputs)==267 and set(inputs)==set(admitted['input_source_hashes'])|wanted,'Exact frozen256 plus eleven record-profile inputs required'
    assert {name:inputs[name]for name in admitted['input_source_hashes']}==admitted['input_source_hashes']
    assert all(descriptor.sha((root/name).read_bytes())==digest for name,digest in inputs.items())
    result=dict(bundle)
    result.update(preflight_sql=preflight,postcheck_sql=postcheck,preservation_sql=preservation,preservation_check_sql=verify,
        install=install,markers=dict(marks),expected_ledger206=ledger,canonical206_binding=before['canonical206_binding'],
        input_source_hashes=inputs,predecessor_input_source_hashes=before['input_source_hashes'],
        frozen_configuration_admission_input_source_hashes=admitted['input_source_hashes'],
        body_sha256=descriptor.sha(body.encode()),install_sha256=descriptor.sha(install.encode()),
        reference_status='candidate_not_admitted',acceptance=False,configuration_input_implemented=True,configuration_record_value_implemented=True,
        configuration_publication_implemented=False,auth_acceptance=False,hosted_writes=0,
        source_integration=False,runtime_executed=False,admitted_artifact=False,protocol_behavior_claim=False)
    return result


if __name__=='__main__':
    assert len(sys.argv)==1,'No runtime or arbitrary source options'
    b=build()
    print(descriptor.canonical(dict(stage=b['stage'],reference_status=b['reference_status'],acceptance=False,
        inputs=len(b['input_source_hashes']),functions=len(b['expected']['functions']),expected_sha256=b['expected_sha256'],install_sha256=b['install_sha256'])))
