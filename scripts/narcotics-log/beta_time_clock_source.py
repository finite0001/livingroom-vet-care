"""Finite forward metadata successor for the atomic time-clock migration.

Historical SQL, receipts and descriptor rows are never rewritten. The original
descriptor remains the source of every unchanged expectation. Exactly two
policies, three direct write privileges and the authored comparison body change.
"""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import prefix_view as prefix
import hosted_history as history

SIGNATURE = "controlled_count_entry_v1.require_bound_module()"
OLD_BODY_SHA = "f6feeae8a261d68cbd2c674d0c8d6dafcb2de7dfd1b628b39dd62d1c99376380"
HEADER = "CREATE OR REPLACE FUNCTION " + SIGNATURE
OLD_COMPARE = " if actual::text is distinct from(d.definition->'properties')::text then"
DESCRIPTOR_HASH_ORIGINAL = "jsonb_build_object('domain','lrv.count.local_fixture.module.v1','definition',d.definition)::text"
DESCRIPTOR_HASH_CANONICAL = """('{"domain": "lrv.count.local_fixture.module.v1", "definition": '||coalesce(d.definition::text,'null')||'}')"""
DESCRIPTOR_SELECT = " select * into strict d from controlled_count_v1.descriptor where revision=1;"
DESCRIPTOR_MATERIALIZE = "pg_catalog.jsonb_set_lax(d.definition,'{}'::text[],NULL::jsonb,false,'return_target')"
DESCRIPTOR_FLAT_SELECT = DESCRIPTOR_SELECT + "\n d.definition := " + DESCRIPTOR_MATERIALIZE + ";"
POLICIES = {"Admins update time entries", "Admins delete time entries"}
WRITE_PRIVILEGES = {"INSERT", "UPDATE", "DELETE"}
DIRECT_ROLES = {"PUBLIC", "anon", "authenticated"}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def expected_properties(original, new_body_sha):
    result = deepcopy(original)
    table = result["ordinary_relations"]["time_entries"]
    if len([p for p in table["policies"] if p["name"] in POLICIES]) != 2:
        raise ValueError("Exactly the two original admin time-entry policies required")
    table["policies"] = [p for p in table["policies"] if p["name"] not in POLICIES]
    table["acl"] = [a for a in table["acl"]
                    if not (a["grantee"] in DIRECT_ROLES and a["privilege"] in WRITE_PRIVILEGES)]
    metadata = result["functions"][SIGNATURE]
    if metadata["body_sha256"] != OLD_BODY_SHA:
        raise ValueError("Exact original comparison function required")
    metadata["body_sha256"] = new_body_sha
    return result


def admission_properties(original, new_body_sha):
    """The finite admission stores only the three changed metadata leaves."""
    projected = expected_properties(original, new_body_sha)
    return {"functions": {SIGNATURE: {"body_sha256": projected["functions"][SIGNATURE]["body_sha256"]}},
            "ordinary_relations": {"time_entries": {name: projected["ordinary_relations"]["time_entries"][name]
                for name in ("acl", "policies")}}}


def projection_sql(new_hash, expression=False, properties_expression="p_original->'properties'"):
    # p_original is the immutable source descriptor, never the observed catalog.
    return """
 expected := """ + properties_expression + """;
 IF expected#>>'{functions,controlled_count_entry_v1.require_bound_module(),body_sha256}'<>""" + literal(OLD_BODY_SHA) + """
 OR (SELECT count(*) FROM jsonb_array_elements(expected#>'{ordinary_relations,time_entries,policies}')p
     WHERE p->>'name'IN('Admins update time entries','Admins delete time entries'))<>2 THEN
  RAISE EXCEPTION 'beta_clock_original_source_invalid' USING ERRCODE='23514';END IF;
 -- Store only the three changed leaves; all other metadata stays source-owned.
 expected := jsonb_build_object(
 'ordinary_relations',jsonb_build_object('time_entries',jsonb_build_object(
   'acl',(SELECT coalesce(jsonb_agg(a ORDER BY n),'[]'::jsonb)
    FROM jsonb_array_elements(expected#>'{ordinary_relations,time_entries,acl}')WITH ORDINALITY t(a,n)
    WHERE NOT(a->>'grantee'IN('PUBLIC','anon','authenticated')AND a->>'privilege'IN('INSERT','UPDATE','DELETE'))),
   'policies',(SELECT coalesce(jsonb_agg(p ORDER BY n),'[]'::jsonb)
    FROM jsonb_array_elements(expected#>'{ordinary_relations,time_entries,policies}')WITH ORDINALITY t(p,n)
    WHERE p->>'name'NOT IN('Admins update time entries','Admins delete time entries')))),
 'functions',jsonb_build_object('controlled_count_entry_v1.require_bound_module()',jsonb_build_object(
  'body_sha256',to_jsonb(""" + (new_hash if expression else literal(new_hash) + "::text") + """))));

"""


def ledger_preflight():
    rows, variants = history.sources(ROOT)
    expected = []
    for row in rows:
        spec = variants[row["version"]]
        expected.append((row["version"], row["name"], [spec["canonical_cli"], *spec["encodings"].values()]))
    original206 = json.loads(prefix.regular(ROOT / prefix.CANDIDATE / "secondary_review_206_statements.json"))
    if original206["body_sha256"] != prefix.TAIL["20261022010000_controlled_secondary_review_private.sql"]:
        raise ValueError("Original206 framing source differs")
    hosted = json.loads(prefix.regular(HERE / "hosted-source/cli-framing.json"))["framing"]
    fields = ("statement_count", "postgres_array_sha256", "postgres_array_bytes")
    expected.append(("20261022010000", "controlled_secondary_review_private", [
        history.array_pin(original206["statements"]), {k: hosted[k] for k in fields}]))
    forward = json.loads(prefix.regular(HERE / "cli-framing.json"))["migrations"]
    operational = json.loads(prefix.regular(HERE / "operational-release.json"))
    for name, frame in [*forward.items(), (operational["migration"], operational["framing"])]:
        raw = prefix.regular(ROOT / "supabase/migrations" / name)
        if frame["sha256"] != sha(raw):
            raise ValueError("Exact current forward framing source required")
        expected.append((name[:14], name[15:-4], [{k: frame[k] for k in fields},
                                                 history.array_pin([raw.decode()])]))
    if len(expected) != 209 or len({row[0] for row in expected}) != 209:
        raise ValueError("Complete independently source-derived209 receipts required")
    values = []
    for version, name, encodings in expected:
        for pin in encodings:
            values.append("(" + ",".join((literal(version), literal(name), str(pin["statement_count"]),
                str(pin["postgres_array_bytes"]), literal(pin["postgres_array_sha256"]))) + ")")
    return """DO $beta_clock_prior_ledger$ BEGIN
 IF(SELECT count(*)FROM supabase_migrations.schema_migrations)<>209 OR EXISTS(
 SELECT 1 FROM supabase_migrations.schema_migrations m WHERE NOT EXISTS(
 SELECT 1 FROM(VALUES
""" + ",\n".join(values) + """
 )expected(version,name,statement_count,array_bytes,array_hash)
 WHERE m.version=expected.version AND m.name=expected.name
 AND cardinality(m.statements)=expected.statement_count
 AND octet_length(to_jsonb(m.statements)::text)=expected.array_bytes
 AND encode(sha256(convert_to(to_jsonb(m.statements)::text,'UTF8')),'hex')=expected.array_hash))THEN
 RAISE EXCEPTION 'beta_clock_exact209_ledger_required' USING ERRCODE='23514';END IF;
END $beta_clock_prior_ledger$;
"""


def build():
    source = prefix.regular(ROOT / "supabase/migrations/20261027223544_narcotics_count_and_stock_workflows.sql").decode()
    if source.count(HEADER) != 1:
        raise ValueError("One original bound-module comparison required")
    start = source.index(HEADER)
    end = source.index("$$;", start) + 3
    definition = source[start:end]
    body = definition.split(" AS $$", 1)[1][:-3]
    if sha(body.encode()) != OLD_BODY_SHA or definition.count(OLD_COMPARE) != 1:
        raise ValueError("Complete original comparison body must match reviewed source")
    immutable_body = "BEGIN RAISE EXCEPTION 'beta_clock_admission_immutable' USING ERRCODE='23514';END"
    immutable_hash = sha(immutable_body.encode())
    admission = """
 IF current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM pg_namespace n
 WHERE n.nspname='beta_time_clock_v1'AND n.nspowner='postgres'::regrole)
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role'])r
 WHERE has_schema_privilege(r,'beta_time_clock_v1','USAGE')OR has_schema_privilege(r,'beta_time_clock_v1','CREATE'))
 OR NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid='beta_time_clock_v1.admission'::regclass
 AND c.relowner='postgres'::regrole AND c.relkind='r'AND c.relpersistence='p'AND c.relrowsecurity AND NOT c.relforcerowsecurity)
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role'])r
 CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])v
 WHERE has_table_privilege(r,'beta_time_clock_v1.admission',v))THEN
 RAISE EXCEPTION 'beta_clock_admission_catalog_invalid' USING ERRCODE='23514';END IF;
 IF(SELECT count(*)FROM pg_trigger WHERE tgrelid='beta_time_clock_v1.admission'::regclass AND NOT tgisinternal)<>1
 OR NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
 WHERE t.tgrelid='beta_time_clock_v1.admission'::regclass AND t.tgname='immutable_admission'
 AND t.tgtype=62 AND t.tgenabled='O'AND NOT t.tgisinternal AND t.tgconstraint=0 AND t.tgnargs=0
 AND t.tgqual IS NULL AND t.tgargs=''::bytea
 AND p.oid='beta_time_clock_v1.immutable_admission()'::regprocedure
 AND p.proowner='postgres'::regrole AND NOT p.prosecdef
 AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
 AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=""" + literal(immutable_hash) + """
 AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
 AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
 AND NOT has_function_privilege('service_role',p.oid,'EXECUTE'))THEN
 RAISE EXCEPTION 'beta_clock_admission_immutability_invalid' USING ERRCODE='23514';END IF;
 SELECT * INTO STRICT saved FROM beta_time_clock_v1.admission WHERE revision=1;
 beta_saved_text := saved.expected_properties::text;
 IF(SELECT count(*)FROM beta_time_clock_v1.admission)<>1
 OR saved.original_descriptor_hash IS DISTINCT FROM d.definition_hash
 OR saved.expected_properties_hash IS DISTINCT FROM encode(sha256(convert_to(beta_saved_text,'UTF8')),'hex')THEN
 RAISE EXCEPTION 'beta_clock_admission_source_invalid' USING ERRCODE='23514';END IF;
 p_original := d.definition->'properties';
""" + projection_sql("saved.require_bound_body_hash", expression=True, properties_expression="p_original") + """
 beta_expected_text := expected::text;
 IF beta_saved_text IS DISTINCT FROM beta_expected_text THEN
 RAISE EXCEPTION 'beta_clock_admission_delta_invalid' USING ERRCODE='23514';END IF;
 -- One complete canonical object comparison covers every key and value.
 expected := p_original || jsonb_build_object(
  'functions',jsonb_set(p_original->'functions','{controlled_count_entry_v1.require_bound_module(),body_sha256}',
   expected#>'{functions,controlled_count_entry_v1.require_bound_module(),body_sha256}'),
  'ordinary_relations',jsonb_set(p_original->'ordinary_relations','{time_entries}',
   (p_original#>'{ordinary_relations,time_entries}')||(expected#>'{ordinary_relations,time_entries}')));
 if actual::text is distinct from expected::text then"""
    # The projection is inside the already source-bound comparison function.
    # There is no separately callable accessor whose replacement could bypass
    # its own integrity checks, and no mutually embedded digest cycle.
    admission = re.sub(r"\bsaved\b", "beta_saved", admission)
    admission = re.sub(r"\bexpected\b", "beta_expected", admission)
    admission = re.sub(r"\bp_original\b", "beta_original", admission)
    old_declaration = "declare d controlled_count_v1.descriptor;actual jsonb;begin"
    new_declaration = ("declare d controlled_count_v1.descriptor;actual jsonb;"
                       "beta_saved beta_time_clock_v1.admission;beta_expected jsonb;beta_original jsonb;"
                       "beta_saved_text text;beta_expected_text text;begin")
    if definition.count(old_declaration) != 1:
        raise ValueError("Exact original comparison declaration required")
    if definition.count(DESCRIPTOR_SELECT) != 1:
        raise ValueError("Exact original source-descriptor read required")
    if definition.count(DESCRIPTOR_HASH_ORIGINAL) != 1:
        raise ValueError("Exact original source-descriptor hash expression required")
    successor = (definition.replace(old_declaration, new_declaration, 1).replace(OLD_COMPARE, admission, 1)
                 .replace(DESCRIPTOR_HASH_ORIGINAL, DESCRIPTOR_HASH_CANONICAL, 1)
                 .replace(DESCRIPTOR_SELECT, DESCRIPTOR_FLAT_SELECT, 1))
    if (successor.replace(admission, OLD_COMPARE, 1).replace(new_declaration, old_declaration, 1)
            .replace(DESCRIPTOR_HASH_CANONICAL, DESCRIPTOR_HASH_ORIGINAL, 1)
            .replace(DESCRIPTOR_FLAT_SELECT, DESCRIPTOR_SELECT, 1)) != definition:
        raise ValueError("Whole comparison source inverse required")
    new_hash = sha(successor.split(" AS $$", 1)[1][:-3].encode())
    projection = projection_sql(new_hash)
    core = prefix.regular(ROOT / "scripts/time-clock/atomic-time-clock.sql")
    if re.search(rb"create\s+(?:or\s+replace\s+)?function\s+public\.protect_profile_privileges", core, re.I) or b"CREATE TABLE" in core.upper():
        raise ValueError("Time-clock core cannot modify historical profiles guard or relation inventory")
    preflight = """-- Reviewed finite beta successor. The original209 receipts and all descriptor rows remain immutable.
SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s';
""" + ledger_preflight() + """
DO $beta_clock_original_module$ BEGIN
 IF current_user<>'postgres'OR to_regnamespace('beta_time_clock_v1')IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='controlled_count_entry_v1.require_bound_module()'::regprocedure
 AND p.proowner='postgres'::regrole AND NOT p.prosecdef
 AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=""" + literal(OLD_BODY_SHA) + """ )THEN
 RAISE EXCEPTION 'beta_clock_exact_original_module_required' USING ERRCODE='23514';END IF;
 PERFORM controlled_count_entry_v1.require_bound_module();
END $beta_clock_original_module$;
CREATE SCHEMA beta_time_clock_v1 AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA beta_time_clock_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE beta_time_clock_v1.admission(
 revision integer PRIMARY KEY CHECK(revision=1),
 original_descriptor_hash text NOT NULL CHECK(original_descriptor_hash~'^[0-9a-f]{64}$'),
 expected_properties jsonb NOT NULL,
 expected_properties_hash text NOT NULL CHECK(expected_properties_hash~'^[0-9a-f]{64}$'),
 require_bound_body_hash text NOT NULL CHECK(require_bound_body_hash~'^[0-9a-f]{64}$')
);
ALTER TABLE beta_time_clock_v1.admission ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE beta_time_clock_v1.admission FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION beta_time_clock_v1.immutable_admission() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$""" + immutable_body + """$$;
REVOKE ALL ON FUNCTION beta_time_clock_v1.immutable_admission() FROM PUBLIC,anon,authenticated,service_role;
"""
    populate = """
DO $beta_clock_source_admission$ DECLARE p_original jsonb;p_original_hash text;expected jsonb;BEGIN
 SELECT definition,definition_hash INTO STRICT p_original,p_original_hash FROM controlled_count_v1.descriptor WHERE revision=1;
""" + projection + """
 INSERT INTO beta_time_clock_v1.admission VALUES(1,p_original_hash,expected,
 encode(sha256(convert_to(expected::text,'UTF8')),'hex'),""" + literal(new_hash) + """);
END $beta_clock_source_admission$;
CREATE TRIGGER immutable_admission BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
ON beta_time_clock_v1.admission FOR EACH STATEMENT EXECUTE FUNCTION beta_time_clock_v1.immutable_admission();
"""
    sql = (preflight + core.decode() + "\n" + successor + "\n" + populate + """
DO $beta_clock_final_module$ BEGIN
 PERFORM controlled_count_entry_v1.require_bound_module();
 PERFORM narcotics_register_v1.require_module();
END $beta_clock_final_module$;
SELECT pg_notify('pgrst','reload schema');
""").encode()
    proof = dict(kind="finite-beta-time-clock-metadata-successor-source-v1", database_operations=0,
        original_require_bound_body_sha256=OLD_BODY_SHA, successor_require_bound_body_sha256=new_hash,
        expected_projection_inline=True, external_expected_accessor=False,
        admission_root_branches=["functions", "ordinary_relations"],
        admission_changed_leaf_paths=["functions."+SIGNATURE+".body_sha256",
            "ordinary_relations.time_entries.acl", "ordinary_relations.time_entries.policies"],
        complete_canonical_object_equality=True, per_member_comparison=False,
        descriptor_same_value_materialized_once=True, catalog_snapshot_calls_unchanged=True,
        descriptor_hash_canonical_bytes_preserved=True, descriptor_hash_wrapper_rebuild_removed=True,
        immutable_admission_body_sha256=immutable_hash,
        core_sha256=sha(core), migration_sha256=sha(sql), migration_bytes=len(sql),
        historical_descriptors_rewritten=False, historical_receipts_rewritten=False,
        ambient_catalog_used_as_expected=False, whole_comparison_body_inverse=True,
        changed_properties=["ordinary_relations.time_entries.acl", "ordinary_relations.time_entries.policies",
                            "functions.controlled_count_entry_v1.require_bound_module().body_sha256"])
    return sql, proof


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--write-candidate", action="store_true")
    modes.add_argument("--check-source", action="store_true")
    args = parser.parse_args()
    sql, proof = build()
    outputs = {ROOT / "supabase/migrations" / prefix.BETA_MIGRATION: sql,
               HERE / "beta-time-clock-source-proof.json": (json.dumps(proof, sort_keys=True, indent=2) + "\n").encode()}
    for path, raw in outputs.items():
        if args.write_candidate:
            path.write_bytes(raw)
        elif prefix.regular(path) != raw:
            raise ValueError("Finite beta successor differs from authored source: " + path.name)
    print(json.dumps(proof, sort_keys=True))


if __name__ == "__main__":
    main()
