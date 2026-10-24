"""Pure private configuration-input profile; no runtime, grants, or frozen pin writes."""
from copy import deepcopy
from pathlib import Path
import json
import sys

PROFILE=Path(__file__).resolve().parent
SOURCE=PROFILE
sys.path.insert(0,str(PROFILE));sys.path.insert(1,str(SOURCE))
import record_review_v3_configuration_descriptor as descriptor
import record_review_v3_gate_b as predecessor
import record_review_v3_gate_b_a1_admission as frozen_a1
import secondary_review_release as old_release

EXPECTED_A1='17df4505f964f02314eb5524c896041076d8f30f1f5b437d95bb14af23459447'
INSTALL_A1='eb591816d79cf06a980648dccecb7f556866bfc5e0490a95ba34cb461ed8214f'
MAP_A1='2380f99699bbe3b3c3a97714ca01dc4f0eea0a233e87056f43ef962b763ac43d'
REQUIRED_SOURCE_CHANGES={
 'Exactly one independent v3 Gate B private A1 descriptor required':'Exactly one independent v3 configuration-input descriptor required',
 'Unchanged frozen205 and empty private206 required for v3 Gate B private A1':'Unchanged frozen205 and empty private206 required for v3 configuration-input',
 'Record-review v3 Gate B private A1 metadata differs from independent descriptor':'Record-review v3 configuration-input metadata differs from independent descriptor',
}


def lineage(before):
    assert len(before['input_source_hashes'])==246
    assert descriptor.sha(descriptor.canonical(before['input_source_hashes']).encode())==MAP_A1
    assert before['expected_sha256']==EXPECTED_A1 and before['install_sha256']==INSTALL_A1


def finite_delta(before,after):
    """Compare declarations, never catalogs. Permit only named source-body changes."""
    remaining=deepcopy(after)
    added=remaining['functions'].pop('controlled_review_v3.validate_configuration(p_request jsonb)')
    expected_added=descriptor.function_metadata(descriptor.read_input(PROFILE)[4],'jsonb','plpgsql','p_request jsonb',False)
    assert added==expected_added
    assert len(after['functions'])==32 and len(before['functions'])==31
    assert remaining['kind']==descriptor.KIND
    remaining['kind']=before['kind']
    required='controlled_review_v3.required()';snapshot='controlled_review_v3.snapshot()'
    wanted=before['functions'][required]['source']
    for old,new in REQUIRED_SOURCE_CHANGES.items():
        assert wanted.count(old)==1;wanted=wanted.replace(old,new)
    assert remaining['functions'][required]['source']==wanted
    wanted=before['functions'][snapshot]['source']
    old="'controlled-review-v3-gate-b-private-adapters-a1-v1'"
    assert wanted.count(old)==1
    wanted=wanted.replace(old,"'"+descriptor.KIND+"'")
    assert remaining['functions'][snapshot]['source']==wanted
    # Restore ONLY two source fields for whole-document equality; attributes,
    # all other functions, tables/ACL/RI/parents remain exact without exclusions.
    for signature in (required,snapshot):
        remaining['functions'][signature]['source']=before['functions'][signature]['source']
    assert remaining==before,'Only declared metadata delta allowed'


def installed_checks_sql(expected):
    # Explicit new declaration, not a patch to an existing rendered installer.
    literal=old_release.sql_json(expected)
    facades='array['+','.join(old_release.literal(n)for n in descriptor.FACADES)+']::text[]'
    tables='array['+','.join(old_release.literal(n)for n in descriptor.TABLES if n!='descriptor')+']::text[]'
    return f"""do $configuration_input_installed$ declare r record;n bigint;begin
 perform controlled_review_v3.required();
 if controlled_review_v3.snapshot()is distinct from {literal} then raise exception 'Configuration-input independent metadata mismatch'using errcode='23514';end if;
 if(select count(*)<>1 or not bool_and(id and definition={literal})from controlled_review_v3.descriptor)then raise exception 'Configuration-input independent descriptor mismatch'using errcode='23514';end if;
 if exists(select 1 from unnest(array['anon','authenticated','service_role'])role_name where
 has_schema_privilege(role_name,'controlled_review_v3','USAGE,CREATE')
 or exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where(ns.nspname='controlled_review_v3'or(ns.nspname='public'and p.proname=any({facades})))and has_function_privilege(role_name,p.oid,'EXECUTE'))
 or exists(select 1 from pg_class c where c.relnamespace='controlled_review_v3'::regnamespace and c.relkind in('r','p')and(has_table_privilege(role_name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')or has_any_column_privilege(role_name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))))then raise exception 'Configuration-input effective private privileges changed'using errcode='23514';end if;
 for r in select unnest({tables})as name loop
 execute format('select count(*)from controlled_review_v3.%I',r.name)into n;
 if n<>0 then raise exception 'Configuration-input must not seed configuration or evidence'using errcode='23514';end if;
 end loop;
end $configuration_input_installed$;
"""


def build(source=SOURCE,profile=PROFILE):
    source=Path(source).resolve();profile=Path(profile).resolve();root=source.parents[3]
    assert source==SOURCE and profile==SOURCE,'Configuration profile uses its fixed candidate source root'
    manifest=descriptor.admit_manifest(profile)
    admission_pin=manifest['frozen_a1_admission']
    assert admission_pin==dict(wrapper_file='record_review_v3_gate_b_a1_expected.json',
        wrapper_sha256='35ebe7d2cbb374fdeb73c34106bdb11af3f22ee058e64013d47e67db81defa93',
        admission_file='record_review_v3_gate_b_a1_admission.py',
        admission_sha256='9153f8b79f735de00048afb8b30fa3558bfde7ab5fc1f8f6ac999f9896214476',admission_input_count=248)
    for path in (source/admission_pin['admission_file'],Path(frozen_a1.__file__)):
        assert descriptor.sha(path.read_bytes())==admission_pin['admission_sha256'],'Frozen A1 admission source changed'
    admitted=frozen_a1.admit(source)
    assert admitted['wrapper_sha256']==admission_pin['wrapper_sha256']
    assert len(admitted['input_source_hashes'])==248
    before=admitted['package']
    lineage(before)
    assert manifest['base_a1']==dict(input_count=246,canonical_map_sha256=MAP_A1,expected_sha256=EXPECTED_A1,install_sha256=INSTALL_A1)
    bundle=descriptor.build(source,profile)
    finite_delta(before['expected'],bundle['expected'])
    parent=json.loads((source/'release-expected-204.json').read_text(),object_pairs_hook=descriptor.unique)
    ledger=before['expected_ledger206']
    preflight=predecessor.ledger_checks_sql(ledger)+old_release.parent_checks_sql(parent)+old_release.installed_checks_sql(bundle['expected']['parents']['private206'])+bundle['absence_sql']+'\n'
    postcheck=old_release.parent_checks_sql(parent)+old_release.installed_checks_sql(bundle['expected']['parents']['private206'])+installed_checks_sql(bundle['expected'])
    # Reused exact source-proved observer, same database only, never expected authority.
    preservation=predecessor.preservation_sql()
    verify="""do $configuration_input_preserved$ begin
 if(select count(*)from pg_temp.record_review_v3_gate_b_before)<>1
 or not exists(select 1 from pg_temp.record_review_v3_gate_b_before b where b.rows=pg_temp.record_review_v3_gate_b_rows()and b.catalog=pg_temp.record_review_v3_gate_b_catalog())then raise exception 'Configuration-input original206 rows ledger or raw catalog changed'using errcode='23514';end if;
end $configuration_input_preserved$;
"""
    marks=descriptor.MARKERS
    body='select pg_advisory_xact_lock(90271040,0);\n'+marks['admission']+'\n'+preflight+preservation+bundle['ddl']+'\n'+bundle['descriptor_insert']+'\n'+marks['after_descriptor']+'\n'+marks['before_postcheck']+'\n'+postcheck+verify+marks['before_commit']+'\n'
    install='begin;\n'+body+'commit;\n'
    assert all(install.count(m)==1 for m in marks.values())
    inputs=dict(admitted['input_source_hashes'])
    additional=dict(bundle['source_hashes'])
    additional[str(Path(__file__).relative_to(root))]=descriptor.sha(Path(__file__).read_bytes())
    for name,digest in additional.items():
        assert name not in inputs or inputs[name]==digest,'Source-map collision'
        inputs[name]=digest
    new_names={'record-review-v3-configuration-profile.json','record-review-v3-configuration-schema.sql',
        'record-review-v3-configuration-input.sql','record-review-v3-configuration-metadata.json',
        'record_review_v3_configuration_descriptor.py','record_review_v3_configuration_profile.py'}
    wanted={str((source/name).relative_to(root))for name in new_names}
    assert len(inputs)==254 and set(inputs)==set(admitted['input_source_hashes'])|wanted,'Exact frozen248 plus six configuration inputs required'
    assert {name:inputs[name]for name in admitted['input_source_hashes']}==admitted['input_source_hashes']
    assert set(before['input_source_hashes'])<=set(inputs)
    assert {name:inputs[name]for name in before['input_source_hashes']}==before['input_source_hashes']
    assert all(descriptor.sha((root/name).read_bytes())==digest for name,digest in inputs.items())
    result=dict(bundle)
    result.update(preflight_sql=preflight,postcheck_sql=postcheck,preservation_sql=preservation,preservation_check_sql=verify,
        install=install,markers=dict(marks),expected_ledger206=ledger,canonical206_binding=before['canonical206_binding'],
        input_source_hashes=inputs,predecessor_input_source_hashes=before['input_source_hashes'],
        frozen_a1_admission_input_source_hashes=admitted['input_source_hashes'],
        body_sha256=descriptor.sha(body.encode()),install_sha256=descriptor.sha(install.encode()),
        reference_status='candidate_not_admitted',acceptance=False,configuration_input_implemented=True,
        configuration_publication_implemented=False,auth_acceptance=False,hosted_writes=0,
        source_integration=True,runtime_executed=False,admitted_artifact=False,protocol_behavior_claim=False)
    return result


if __name__=='__main__':
    assert len(sys.argv)==1,'No runtime or arbitrary source options'
    b=build()
    print(descriptor.canonical(dict(stage=b['stage'],reference_status=b['reference_status'],acceptance=False,
        inputs=len(b['input_source_hashes']),functions=len(b['expected']['functions']),expected_sha256=b['expected_sha256'],install_sha256=b['install_sha256'])))
