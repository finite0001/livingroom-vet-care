"""Deterministic private secondary-review release candidate; no database access.

The v2 expectation remains unchanged. Transient before/after observations in the
installer prove preservation only; neither seal is ever derived from them.
"""
import argparse
import importlib.util
import json
from pathlib import Path

from secondary_review_ledger import SOURCE, canonical, load_frozen, sha, unique

PRIVATE_WRAPPER = 'secondary_review_protocol_private_expected_v2.json'
PRIVATE_WRAPPER_SHA256 = 'adf45e10d25935486aadbc126c6b8282d38def119dc344bfe4935bb690d4b036'
PRIVATE_DEFINITION_SHA256 = 'e468ab33f11f90e12fae72441299425a11b76d72e4e112ae71a67b0d9751e999'
ARTIFACT = 'controlled-secondary-review-private.sql'
# Candidate pins are review inputs, not claims of completed independent approval.
ARTIFACT_SHA256 = '7f242d4e0f1b7dd2fb8de85048050ce725381f6539cb94d38034392a8669bc75'
MARKERS = {name: '-- CONTROLLED_REVIEW_RELEASE_' + name.upper() + ' --' for name in
           ('preflight','after_schema','after_descriptor','before_postcheck','before_commit')}


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def sql_json(value):
    return literal(canonical(value)) + '::jsonb'


def package(source=SOURCE):
    source = Path(source).resolve()
    raw = (source / PRIVATE_WRAPPER).read_bytes()
    assert sha(raw) == PRIVATE_WRAPPER_SHA256, 'Frozen private v2 wrapper changed'
    pin = json.loads(raw, object_pairs_hook=unique)
    assert set(pin) == {'kind','definition','definition_sha256','derivation_input_sha256'}
    assert pin['kind'] == 'controlled-review-foundation-private-independent-expected-v2'
    assert pin['definition_sha256'] == PRIVATE_DEFINITION_SHA256
    # This definition uses ensure_ascii=False, matching the unchanged v2 derivation.
    assert sha(json.dumps(pin['definition'], sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()) == PRIVATE_DEFINITION_SHA256
    for name, digest in pin['derivation_input_sha256'].items():
        assert sha((source / name).read_bytes()) == digest, 'Private v2 source changed'
    spec = importlib.util.spec_from_file_location('frozen_review_descriptor', source / 'secondary_review_protocol_descriptor.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    result = module.build('private')
    assert result['profile'] == 'private' and result['expected'] == pin['definition']
    assert result['expected_sha256'] == pin['definition_sha256']
    assert result['source_hashes'] == pin['derivation_input_sha256']
    assert 'grant execute' not in result['ddl'].lower(), 'Private promotion cannot grant application access'
    return result, pin


def parent_checks_sql(parent):
    manifest = sql_json(parent['expected_technical_manifest'])
    writers = sql_json(parent['canonical_writer_definition_hashes'])
    return """do $review_parent$ begin
 perform public.controlled_stock_manifest_required();
 if public.controlled_stock_manifest_snapshot() is distinct from __MANIFEST__
 or(select count(*)<>1 or not bool_and(revision=1 and definition=__MANIFEST__ and definition_hash=public.controlled_stock_hash(__MANIFEST__))from public.controlled_stock_engine_manifests)
 or(select jsonb_object_agg(signature,encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(signature)),'UTF8')),'hex'))from public.stock_writer_manifests)is distinct from __WRITERS__ then
  raise exception 'Secondary-review frozen205 parent or writer mismatch' using errcode='23514';
 end if;
end $review_parent$;
""".replace('__MANIFEST__', manifest).replace('__WRITERS__', writers)


def ledger_checks_sql(rows):
    # Exact per-row comparisons avoid putting the entire >5MB ledger in one SQL
    # statement. The cardinality/version check also rejects extra or missing rows.
    versions = sql_json([row['version'] for row in rows])
    parts = ["do $review_ledger$ begin if (select jsonb_agg(version order by version)from supabase_migrations.schema_migrations)is distinct from " + versions + " then raise exception 'Secondary-review exact205 ledger inventory mismatch' using errcode='23514';end if;end $review_ledger$;\n"]
    for row in rows:
        parts.append("do $review_ledger$ begin if (select to_jsonb(m)from supabase_migrations.schema_migrations m where version=" + literal(row['version']) + ")is distinct from " + sql_json(row) + " then raise exception 'Secondary-review exact205 ledger row mismatch' using errcode='23514';end if;end $review_ledger$;\n")
    return ''.join(parts)


# Raw selected-schema preservation, excluding only the six declared facades and
# RI triggers whose owning constraints reside in controlled_review. Their complete
# normalized semantics are checked against the independent extension descriptor.
# OIDs are appropriate for same-database before/after preservation, not expected
# installation metadata. Planner statistics/sticky hints are intentionally absent.
PRESERVATION_SQL = r"""
create function pg_temp.controlled_review_release_rows()returns jsonb language plpgsql
set search_path=pg_catalog,public,pg_temp set timezone='UTC' as $rows$
declare r record;v jsonb;answer jsonb:='{}';begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in('public','auth','storage','extensions','supabase_migrations')and c.relkind in('r','p')order by 1,2 loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text),''[]'')from %I.%I t',r.nspname,r.relname)into v;
  answer:=answer||jsonb_build_object(r.nspname||'.'||r.relname,v);
 end loop;return answer;end $rows$;
create function pg_temp.controlled_review_release_catalog()returns jsonb language sql stable
set search_path=pg_catalog,public,pg_temp set timezone='UTC' as $catalog$
select jsonb_build_object(
 'schemas',(select coalesce(jsonb_object_agg(n.nspname,to_jsonb(n)),'{}')from pg_namespace n where n.nspname in('public','auth','storage','extensions','supabase_migrations')),
 'types',(select coalesce(jsonb_object_agg(n.nspname||'.'||t.typname,to_jsonb(t)),'{}')from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in('public','auth','storage','extensions','supabase_migrations')),
 'functions',(select coalesce(jsonb_object_agg(n.nspname||'.'||p.oid::regprocedure::text,jsonb_build_object('attributes',to_jsonb(p),'definition',pg_get_functiondef(p.oid))),'{}')from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','auth','storage','extensions','supabase_migrations')and p.prokind in('f','p','w')and not(n.nspname='public'and p.proname=any(__FACADES__))),
 'relations',(select coalesce(jsonb_object_agg(n.nspname||'.'||c.relname,jsonb_build_object(
  'attributes',jsonb_build_object('kind',c.relkind,'owner',c.relowner,'access_method',c.relam,'tablespace',c.reltablespace,'persistence',c.relpersistence,'row_security',c.relrowsecurity,'force_row_security',c.relforcerowsecurity,'replica_identity',c.relreplident,'partition',c.relispartition,'options',to_jsonb(c.reloptions),'acl',to_jsonb(c.relacl),'partition_bound',pg_get_expr(c.relpartbound,c.oid)),'view',case when c.relkind in('v','m')then pg_get_viewdef(c.oid,true)else null end,
  'columns',(select coalesce(jsonb_agg(jsonb_build_object('attributes',to_jsonb(a),'default',pg_get_expr(d.adbin,d.adrelid))order by a.attnum),'[]')from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
  'constraints',(select coalesce(jsonb_agg(jsonb_build_object('attributes',to_jsonb(k),'definition',pg_get_constraintdef(k.oid,true))order by k.conname),'[]')from pg_constraint k where k.conrelid=c.oid),
  'triggers',(select coalesce(jsonb_agg(jsonb_build_object('attributes',to_jsonb(t),'definition',pg_get_triggerdef(t.oid,true))order by t.tgname),'[]')from pg_trigger t where t.tgrelid=c.oid and not(t.tgisinternal and exists(select 1 from pg_constraint k join pg_namespace kn on kn.oid=k.connamespace where k.oid=t.tgconstraint and kn.nspname='controlled_review'))),
  'policies',(select coalesce(jsonb_agg(to_jsonb(p)order by p.polname),'[]')from pg_policy p where p.polrelid=c.oid),
  'indexes',(select coalesce(jsonb_agg(jsonb_build_object('attributes',to_jsonb(i),'definition',pg_get_indexdef(i.indexrelid))order by i.indexrelid),'[]')from pg_index i where i.indrelid=c.oid))),'{}')from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','auth','storage','extensions','supabase_migrations')));
$catalog$;
create temporary table controlled_review_release_before on commit drop as
 select pg_temp.controlled_review_release_rows()as rows,pg_temp.controlled_review_release_catalog()as catalog;
"""


def installed_checks_sql(expected):
    facades = sorted(k.removeprefix('public.').split('(')[0] for k in expected['functions'] if k.startswith('public.'))
    names = 'array[' + ','.join(literal(n) for n in facades) + ']::text[]'
    return """do $review_installed$ declare r record;n bigint;begin
 perform controlled_review.required();
 if controlled_review.snapshot()is distinct from __EXPECTED__ then
  raise exception 'Secondary-review independent private metadata mismatch' using errcode='23514';end if;
 if exists(select 1 from unnest(array['anon','authenticated','service_role'])role_name where
  has_schema_privilege(role_name,'controlled_review','USAGE,CREATE')
  or exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where
   (ns.nspname='controlled_review'or(ns.nspname='public'and p.proname=any(__FACADES__)))and has_function_privilege(role_name,p.oid,'EXECUTE'))
  or exists(select 1 from pg_class c where c.relnamespace='controlled_review'::regnamespace and c.relkind in('r','p')and(
   has_table_privilege(role_name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')or has_any_column_privilege(role_name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))))then
  raise exception 'Secondary-review private effective privileges changed' using errcode='23514';end if;
 if(select count(*)<>1 or not bool_and(id and definition=__EXPECTED__)from controlled_review.descriptor)then
  raise exception 'Secondary-review independent descriptor mismatch' using errcode='23514';end if;
 for r in select unnest(array['definitions','preparations','decisions','cancellations'])as name loop
  execute format('select count(*)from controlled_review.%I',r.name)into n;
  if n<>0 then raise exception 'Secondary-review private release must not seed eligibility or evidence' using errcode='23514';end if;
 end loop;
end $review_installed$;
""".replace('__EXPECTED__', sql_json(expected)).replace('__FACADES__', names)


def build_release(source=SOURCE):
    source = Path(source).resolve()
    bundle, pin = package(source)
    ledger = load_frozen(source)
    parent = json.loads((source / 'release-expected-204.json').read_text(), object_pairs_hook=unique)
    expected = bundle['expected']
    names = 'array[' + ','.join(literal(k.removeprefix('public.').split('(')[0]) for k in sorted(expected['functions']) if k.startswith('public.')) + ']::text[]'
    # Run package absence checks before capturing transient preservation evidence.
    admission, separator, rest = bundle['ddl'].partition('create schema controlled_review authorization postgres;')
    assert separator and admission.count('do $admission$') == 1
    ddl = admission + separator + '\n' + MARKERS['after_schema'] + '\n' + rest
    body = ('select pg_advisory_xact_lock(90271040,0);\n' + MARKERS['preflight'] + '\n' +
            ledger_checks_sql(ledger['ledger']) + parent_checks_sql(parent) + admission +
            PRESERVATION_SQL.replace('__FACADES__', names) + ddl + '\n' + bundle['descriptor_insert'] + '\n' +
            MARKERS['after_descriptor'] + '\n' + MARKERS['before_postcheck'] + '\n' +
            parent_checks_sql(parent) + installed_checks_sql(expected) + """
do $review_preserved$ begin
 if (select count(*)from pg_temp.controlled_review_release_before)<>1
 or not exists(select 1 from pg_temp.controlled_review_release_before b where
  b.rows=pg_temp.controlled_review_release_rows()and b.catalog=pg_temp.controlled_review_release_catalog())then
  raise exception 'Secondary-review original rows ledger or raw catalog changed' using errcode='23514';end if;
end $review_preserved$;
""" + MARKERS['before_commit'] + '\n')
    install = 'begin;\n' + body + 'commit;\n'
    assert all(install.count(value) == 1 for value in MARKERS.values())
    assert 'd:=controlled_stock_manifest_snapshot();' not in install
    inputs = dict(pin['derivation_input_sha256'])
    from secondary_review_ledger import LEDGER_FILE, VENDOR
    paths = [source / name for name in (*inputs, PRIVATE_WRAPPER, LEDGER_FILE,
             'secondary_review_ledger.py','secondary_review_release.py')]
    paths += sorted((source / VENDOR).iterdir())
    root = source.parents[3]
    input_map = {str(path.relative_to(root)): sha(path.read_bytes()) for path in paths}
    input_map.update({'supabase/migrations/' + name: digest for name,digest in ledger['migration_sha256'].items()})
    return dict(install=install,body=body,artifact_sha256=sha(install.encode()),body_sha256=sha(body.encode()),
                expected=expected,expected_ledger=ledger['ledger'],input_source_hashes=input_map,
                private_wrapper_sha256=PRIVATE_WRAPPER_SHA256,ledger_sha256=ledger['ledger_sha256'])


def check_release(source=SOURCE):
    result = build_release(source)
    assert result['artifact_sha256'] == ARTIFACT_SHA256, 'Pinned secondary-review release changed'
    assert (Path(source).parent / 'release' / ARTIFACT).read_bytes() == result['install'].encode(), 'Frozen secondary-review artifact differs'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--write-candidate', action='store_true')
    modes.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.write_candidate:
        result = build_release()
        target = SOURCE.parent / 'release' / ARTIFACT
        assert not target.exists() or target.read_bytes() == result['install'].encode(), 'Never overwrite differing release artifact'
        target.write_bytes(result['install'].encode())
    else:
        result = check_release()
    print(canonical({key: result[key] for key in ('artifact_sha256','body_sha256','private_wrapper_sha256','ledger_sha256')}))


if __name__ == '__main__':
    main()
