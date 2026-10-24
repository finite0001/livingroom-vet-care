"""Pure source-bound private v3 Gate B A1 adapter candidate; no database or runtime credit.

build() returns a CANDIDATE for independent source review and separate reference.
It cannot capture a catalog or admit/write a frozen expected artifact. The
standalone install transaction is not a canonical CLI promotion/ledger proof.
"""
import argparse
import json
from pathlib import Path

import canonical_review_prefix as admission
import record_review_v3_gate_b_descriptor as descriptor
import secondary_review_release as old_release

SOURCE = Path(__file__).resolve().parent


def ledger_checks_sql(rows):
    # The retained206 statement array contains the old $review_ledger$ delimiter
    # and diagnostic text. Never globally substitute inside that exact payload.
    # Choose a new wrapper tag and prove it absent from every serialized value.
    tag='$record_review_v3_gate_b_ledger$'
    values=[old_release.sql_json([row['version'] for row in rows])]
    values += [old_release.sql_json(row) for row in rows]
    assert all(tag not in value for value in values), 'Ledger wrapper delimiter collision'
    bodies=["if (select jsonb_agg(version order by version)from supabase_migrations.schema_migrations)is distinct from "+values[0]+
            " then raise exception 'Record-review v3 exact206 ledger inventory mismatch' using errcode='23514';end if;"]
    bodies += ["if (select to_jsonb(m)from supabase_migrations.schema_migrations m where version="+old_release.literal(row['version'])+
               ")is distinct from "+value+" then raise exception 'Record-review v3 exact206 ledger row mismatch' using errcode='23514';end if;"
               for row,value in zip(rows,values[1:])]
    return ''.join('do '+tag+' begin '+body+'end '+tag+';\n' for body in bodies)


def preservation_sql():
    # Same-database observations prove preservation only; never expected seals.
    # Keep ALL old controlled_review rows/catalog/RI. Only the one declared new
    # child FK's two old-parent RI additions are excluded here and independently
    # enumerated by the new descriptor (both child and parent sides).
    sql=old_release.PRESERVATION_SQL
    sql=sql.replace('controlled_review_release','record_review_v3_gate_b')
    old="kn.nspname='controlled_review'"
    assert sql.count(old)==1
    sql=sql.replace(old,"kn.nspname='controlled_review_v3' and k.conname='obligations_event_fk' and k.conrelid=to_regclass('controlled_review_v3.obligations') and k.confrelid='public.controlled_stock_events'::regclass")
    scope="('public','auth','storage','extensions','supabase_migrations')"
    assert sql.count(scope)==5
    sql=sql.replace(scope,"('public','auth','storage','extensions','supabase_migrations','controlled_review')")
    names='array['+','.join(old_release.literal(name) for name in descriptor.FACADES)+']::text[]'
    return sql.replace('__FACADES__',names)


def installed_checks_sql(expected):
    literal=old_release.sql_json(expected)
    names='array['+','.join(old_release.literal(name) for name in descriptor.FACADES)+']::text[]'
    tables='array['+','.join(old_release.literal(name) for name in descriptor.TABLES if name!='descriptor')+']::text[]'
    return """do $v3_installed$ declare r record;n bigint;begin
 perform controlled_review_v3.required();
 if controlled_review_v3.snapshot()is distinct from __EXPECTED__ then
  raise exception 'Record-review v3 independent Gate B private A1 metadata mismatch' using errcode='23514';end if;
 if(select count(*)<>1 or not bool_and(id and definition=__EXPECTED__)from controlled_review_v3.descriptor)then
  raise exception 'Record-review v3 independent Gate B private A1 descriptor mismatch' using errcode='23514';end if;
 if exists(select 1 from unnest(array['anon','authenticated','service_role'])role_name where
  has_schema_privilege(role_name,'controlled_review_v3','USAGE,CREATE')
  or exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where
   (ns.nspname='controlled_review_v3'or(ns.nspname='public'and p.proname=any(__FACADES__)))and has_function_privilege(role_name,p.oid,'EXECUTE'))
  or exists(select 1 from pg_class c where c.relnamespace='controlled_review_v3'::regnamespace and c.relkind in('r','p')and(
   has_table_privilege(role_name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')or has_any_column_privilege(role_name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))))then
  raise exception 'Record-review v3 Gate B private A1 effective private privileges changed' using errcode='23514';end if;
 for r in select unnest(__TABLES__)as name loop
  execute format('select count(*)from controlled_review_v3.%I',r.name)into n;
  if n<>0 then raise exception 'Record-review v3 Gate B private A1 must not seed configuration or evidence' using errcode='23514';end if;
 end loop;
end $v3_installed$;
""".replace('__EXPECTED__',literal).replace('__FACADES__',names).replace('__TABLES__',tables)


def build(source=SOURCE):
    source=Path(source).resolve()
    root=source.parents[3]
    files=sorted((root/'supabase/migrations').glob('*.sql'))
    admitted=admission.admit_canonical206(source,files)
    # Calls bind the complete retained executed helper closure and exact206 body.
    old205=old_release.load_frozen(source)['ledger']
    binding=admitted['binding206']
    expected206=old205+[dict(version=binding['version'],name=binding['name'],statements=binding['expected_statements'])]
    assert len(expected206)==206 and len(expected206[-2]['statements'])==94 and len(expected206[-1]['statements'])==304
    bundle=descriptor.build(source)
    parent=json.loads((source/'release-expected-204.json').read_text(),object_pairs_hook=descriptor.unique)
    preflight=(ledger_checks_sql(expected206)+
               old_release.parent_checks_sql(parent)+old_release.installed_checks_sql(bundle['expected']['parents']['private206'])+bundle['absence_sql']+'\n')
    postcheck=old_release.parent_checks_sql(parent)+old_release.installed_checks_sql(bundle['expected']['parents']['private206'])+installed_checks_sql(bundle['expected'])
    preservation=preservation_sql()
    verify="""do $v3_preserved$ begin
 if(select count(*)from pg_temp.record_review_v3_gate_b_before)<>1
 or not exists(select 1 from pg_temp.record_review_v3_gate_b_before b where
  b.rows=pg_temp.record_review_v3_gate_b_rows()and b.catalog=pg_temp.record_review_v3_gate_b_catalog())then
  raise exception 'Record-review v3 Gate B private A1 original206 rows ledger or raw catalog changed' using errcode='23514';end if;
end $v3_preserved$;
"""
    marks=descriptor.MARKERS
    body='select pg_advisory_xact_lock(90271040,0);\n'+marks['admission']+'\n'+preflight+preservation+bundle['ddl']+'\n'+bundle['descriptor_insert']+'\n'+marks['after_descriptor']+'\n'+marks['before_postcheck']+'\n'+postcheck+verify+marks['before_commit']+'\n'
    install='begin;\n'+body+'commit;\n'
    assert all(install.count(value)==1 for value in marks.values())
    inputs=dict(admitted['input_source_hashes'])
    for name,digest in bundle['source_hashes'].items():
        path=source/name
        relative=str(path.relative_to(root))
        assert relative not in inputs or inputs[relative]==digest, 'Source-map collision'
        inputs[relative]=digest
    for relative,digest in bundle['adapter_source_evidence_sha256'].items():
        assert relative not in inputs or inputs[relative]==digest, 'Adapter source-map collision'
        inputs[relative]=digest
    inputs[str((source/'record_review_v3_gate_b.py').relative_to(root))]=descriptor.sha((source/'record_review_v3_gate_b.py').read_bytes())
    assert all(descriptor.sha((root/path).read_bytes())==digest for path,digest in inputs.items())
    result=dict(bundle)
    result.update(preflight_sql=preflight,postcheck_sql=postcheck,preservation_sql=preservation,
                  preservation_check_sql=verify,install=install,markers=dict(marks),expected_ledger206=expected206,
                  canonical206_binding=binding,input_source_hashes=inputs,body_sha256=descriptor.sha(body.encode()),
                  install_sha256=descriptor.sha(install.encode()),reference_status='candidate_not_admitted',acceptance=False)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true',required=True)
    parser.parse_args()
    result=build()
    print(descriptor.canonical(dict(kind=descriptor.KIND,acceptance=False,reference_status=result['reference_status'],
      expected_sha256=result['expected_sha256'],install_sha256=result['install_sha256'],input_count=len(result['input_source_hashes']),
      tables=len(descriptor.TABLES),facades=len(descriptor.FACADES),database_operations=0,hosted_writes=0)))


if __name__=='__main__':
    main()
