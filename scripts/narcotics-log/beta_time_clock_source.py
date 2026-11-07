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


EXPECTED_MARKER = '__LRV_BETA_EXPECTED_CANONICAL_SHA256__'
TEMPLATE_MARKER = '__LRV_BETA_TEMPLATE_BODY_SHA256__'
IMMUTABLE_BODY = "BEGIN RAISE EXCEPTION 'beta_clock_admission_immutable' USING ERRCODE='23514';END"
CATALOG_CHECKS = " IF current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM pg_namespace n\n WHERE n.nspname='beta_time_clock_v1'AND n.nspowner='postgres'::regrole)\n OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role'])r\n WHERE has_schema_privilege(r,'beta_time_clock_v1','USAGE')OR has_schema_privilege(r,'beta_time_clock_v1','CREATE'))\n OR NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid='beta_time_clock_v1.admission'::regclass\n AND c.relowner='postgres'::regrole AND c.relkind='r'AND c.relpersistence='p'AND c.relrowsecurity AND NOT c.relforcerowsecurity)\n OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role'])r\n CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])v\n WHERE has_table_privilege(r,'beta_time_clock_v1.admission',v))THEN\n RAISE EXCEPTION 'beta_clock_admission_catalog_invalid' USING ERRCODE='23514';END IF;\n IF(SELECT count(*)FROM pg_trigger WHERE tgrelid='beta_time_clock_v1.admission'::regclass AND NOT tgisinternal)<>1\n OR NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid\n WHERE t.tgrelid='beta_time_clock_v1.admission'::regclass AND t.tgname='immutable_admission'\n AND t.tgtype=62 AND t.tgenabled='O'AND NOT t.tgisinternal AND t.tgconstraint=0 AND t.tgnargs=0\n AND t.tgqual IS NULL AND t.tgargs=''::bytea\n AND p.oid='beta_time_clock_v1.immutable_admission()'::regprocedure\n AND p.proowner='postgres'::regrole AND NOT p.prosecdef\n AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]\n AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='__IMMUTABLE_SHA__'\n AND NOT has_function_privilege('anon',p.oid,'EXECUTE')\n AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')\n AND NOT has_function_privilege('service_role',p.oid,'EXECUTE'))THEN\n RAISE EXCEPTION 'beta_clock_admission_immutability_invalid' USING ERRCODE='23514';END IF;\n SELECT * INTO STRICT beta_saved FROM beta_time_clock_v1.admission WHERE revision=1;\n"
BODY_DIGEST = "encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')"
BODY_DIGEST_ANCHOR = "'body_sha256'," + BODY_DIGEST + ","


def marker_expression(marker):
    # The template itself contains each substitution marker exactly once.
    split = len(marker) // 2
    return literal(marker[:split]) + '||' + literal(marker[split:])


def normalization_sql(properties_expression="p_original->'properties'"):
    return """
 expected := """ + properties_expression + """;
 IF expected#>>'{functions,controlled_count_entry_v1.require_bound_module(),body_sha256}' IS DISTINCT FROM """ + literal(OLD_BODY_SHA) + """
 OR(SELECT count(*)FROM jsonb_array_elements(expected#>'{ordinary_relations,time_entries,policies}')p
 WHERE p->>'name'IN('Admins update time entries','Admins delete time entries'))<>2 THEN
 RAISE EXCEPTION 'beta_clock_original_source_invalid' USING ERRCODE='23514';END IF;
 expected:=jsonb_set(expected,'{ordinary_relations,time_entries}',
 (expected#>'{ordinary_relations,time_entries}')||jsonb_build_object(
 'acl',(SELECT coalesce(jsonb_agg(a ORDER BY n),'[]'::jsonb)
 FROM jsonb_array_elements(expected#>'{ordinary_relations,time_entries,acl}')WITH ORDINALITY t(a,n)
 WHERE NOT(a->>'grantee'IN('PUBLIC','anon','authenticated')AND a->>'privilege'IN('INSERT','UPDATE','DELETE'))),
 'policies',(SELECT coalesce(jsonb_agg(p ORDER BY n),'[]'::jsonb)
 FROM jsonb_array_elements(expected#>'{ordinary_relations,time_entries,policies}')WITH ORDINALITY t(p,n)
 WHERE p->>'name'NOT IN('Admins update time entries','Admins delete time entries'))));
"""


def canonical_expectation_query(original_raw_json_text):
    """Project independent source-created raw JSON using PostgreSQL's serializer."""
    if not isinstance(original_raw_json_text, str):
        raise TypeError('Raw independently source-created JSON text required')
    return """DO $beta_independent_source$DECLARE p_original jsonb:=""" + literal(original_raw_json_text) + """::jsonb;expected jsonb;BEGIN
""" + normalization_sql() + """
 PERFORM pg_catalog.set_config('lrv_beta_source.canonical',expected::text,true);
 PERFORM pg_catalog.set_config('lrv_beta_source.original_hash',encode(sha256(convert_to(
 jsonb_build_object('domain','lrv.count.local_fixture.module.v1','definition',p_original)::text,'UTF8')),'hex'),true);
END $beta_independent_source$;
SELECT jsonb_build_object('canonical_text',current_setting('lrv_beta_source.canonical'),
 'sha256',encode(sha256(convert_to(current_setting('lrv_beta_source.canonical'),'UTF8')),'hex'),
 'original_descriptor_hash',current_setting('lrv_beta_source.original_hash'));
"""


def family_source():
    raw = prefix.regular(ROOT / 'supabase/migrations/20261027223544_narcotics_count_and_stock_workflows.sql').decode()
    if raw.count(HEADER) != 1:
        raise ValueError('One original comparison function required')
    start=raw.index(HEADER);end=raw.index('$$;',start)+3
    definition=raw[start:end]
    header,body=definition.split(' AS $$',1);body=body[:-3]
    if sha(body.encode())!=OLD_BODY_SHA:
        raise ValueError('Whole original function body required')
    declaration='declare d controlled_count_v1.descriptor;actual jsonb;begin'
    extended=("declare d controlled_count_v1.descriptor;actual jsonb;"
        "beta_saved beta_time_clock_v1.admission;beta_early beta_time_clock_v1.admission;"
        "beta_template text;beta_body text;beta_hg text;beta_text text;"
        "beta_h text:="+literal(EXPECTED_MARKER)+";beta_th text:="+literal(TEMPLATE_MARKER)+";begin")
    early="""
 -- Finite pre-read relation gate; original later catalog checks remain intact.
 IF NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname='beta_time_clock_v1'AND n.nspowner='postgres'::regrole)
 OR NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('beta_time_clock_v1.admission')
 AND c.relowner='postgres'::regrole AND c.relkind='r'AND c.relpersistence='p'AND c.relrowsecurity AND NOT c.relforcerowsecurity)
 OR EXISTS(SELECT 1 FROM pg_rewrite WHERE ev_class=to_regclass('beta_time_clock_v1.admission'))
 OR EXISTS(SELECT 1 FROM pg_inherits WHERE inhparent=to_regclass('beta_time_clock_v1.admission'))THEN
 RAISE EXCEPTION 'beta_clock_admission_catalog_invalid' USING ERRCODE='23514';END IF;
 SELECT * INTO STRICT beta_early FROM beta_time_clock_v1.admission WHERE revision=1;
 beta_template:=beta_early.guard_template;
 IF encode(sha256(convert_to(beta_template,'UTF8')),'hex')IS DISTINCT FROM beta_th THEN
 RAISE EXCEPTION 'beta_clock_admission_template_invalid' USING ERRCODE='23514';END IF;
 beta_body:=replace(replace(beta_template,"""+marker_expression(EXPECTED_MARKER)+""",beta_h),"""+marker_expression(TEMPLATE_MARKER)+""",beta_th);
 beta_hg:=encode(sha256(convert_to(beta_body,'UTF8')),'hex');
 IF beta_early.require_bound_body_hash IS DISTINCT FROM beta_hg THEN
 RAISE EXCEPTION 'beta_clock_admission_template_invalid' USING ERRCODE='23514';END IF;
"""
    digest_case=("'body_sha256',CASE WHEN w.signature="+literal(SIGNATURE)+" THEN CASE WHEN "+BODY_DIGEST+
        "=beta_hg THEN "+literal(OLD_BODY_SHA)+" ELSE NULL END ELSE "+BODY_DIGEST+" END,")
    admission=CATALOG_CHECKS.replace('__IMMUTABLE_SHA__',sha(IMMUTABLE_BODY.encode()))+"""
 IF(SELECT count(*)FROM beta_time_clock_v1.admission)<>1
 OR beta_saved.original_descriptor_hash IS DISTINCT FROM d.definition_hash
 OR beta_saved.require_bound_body_hash IS DISTINCT FROM beta_hg
 OR convert_to(beta_saved.guard_template,'UTF8')IS DISTINCT FROM convert_to(beta_template,'UTF8')THEN
 RAISE EXCEPTION 'beta_clock_admission_source_invalid' USING ERRCODE='23514';END IF;
 beta_text:=beta_saved.canonical_expectation;
 IF encode(sha256(convert_to(beta_text,'UTF8')),'hex')IS DISTINCT FROM beta_h THEN
 RAISE EXCEPTION 'beta_clock_admission_delta_invalid' USING ERRCODE='23514';END IF;
 if actual::text is distinct from beta_text then"""
    pairs=((declaration,extended),(DESCRIPTOR_SELECT,DESCRIPTOR_FLAT_SELECT),
        (DESCRIPTOR_HASH_ORIGINAL,DESCRIPTOR_HASH_CANONICAL),
        (' actual:=jsonb_build_object(',early+' actual:=jsonb_build_object('),
        (BODY_DIGEST_ANCHOR,digest_case),(OLD_COMPARE,admission))
    template=body
    for original,replacement in pairs:
        if template.count(original)!=1:
            raise ValueError('Exact finite family source anchor required: '+original[:80])
        template=template.replace(original,replacement,1)
    inverse=template
    for original,replacement in reversed(pairs):
        if inverse.count(replacement)!=1:
            raise ValueError('Unique finite family inverse required')
        inverse=inverse.replace(replacement,original,1)
    if inverse!=body or any(template.count(marker)!=1 for marker in (EXPECTED_MARKER,TEMPLATE_MARKER)):
        raise ValueError('Whole original body and unique family markers required')
    return dict(header=header,template_body=template,template_hash=sha(template.encode()),
        original_body_sha256=OLD_BODY_SHA,whole_comparison_body_inverse=True)


def render_family(normalized_canonical_text):
    if not isinstance(normalized_canonical_text,str):
        raise TypeError('PostgreSQL canonical text required')
    family=family_source();expected_hash=sha(normalized_canonical_text.encode())
    body=family['template_body'].replace(EXPECTED_MARKER,expected_hash,1).replace(TEMPLATE_MARKER,family['template_hash'],1)
    # Replace only the declaration literals, never matching an unrelated digest.
    inverse=body.replace('beta_h text:='+literal(expected_hash),'beta_h text:='+literal(EXPECTED_MARKER),1)
    inverse=inverse.replace('beta_th text:='+literal(family['template_hash']),'beta_th text:='+literal(TEMPLATE_MARKER),1)
    if inverse!=family['template_body']:
        raise ValueError('Exact family substitution inverse required')
    return dict(**family,expected_hash=expected_hash,canonical_text=normalized_canonical_text,
        body=body,body_sha256=sha(body.encode()),definition=family['header']+' AS '+literal(body)+';')


def build():
    family=family_source();core=prefix.regular(ROOT/'scripts/time-clock/atomic-time-clock.sql')
    if re.search(rb'create\s+(?:or\s+replace\s+)?function\s+public\.protect_profile_privileges',core,re.I) or b'CREATE TABLE' in core.upper():
        raise ValueError('Time-clock core cannot modify historical profiles guard or relation inventory')
    preflight="""-- Finite source-derived body family. Original209 receipts and descriptor rows remain immutable.
SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s';
"""+ledger_preflight()+"""
DO $beta_clock_original_module$BEGIN
 IF current_user<>'postgres'OR to_regnamespace('beta_time_clock_v1')IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='controlled_count_entry_v1.require_bound_module()'::regprocedure
 AND p.proowner='postgres'::regrole AND NOT p.prosecdef
 AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')="""+literal(OLD_BODY_SHA)+""" )THEN
 RAISE EXCEPTION 'beta_clock_exact_original_module_required' USING ERRCODE='23514';END IF;
 PERFORM controlled_count_entry_v1.require_bound_module();
END $beta_clock_original_module$;
CREATE SCHEMA beta_time_clock_v1 AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA beta_time_clock_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE beta_time_clock_v1.admission(
 revision integer PRIMARY KEY CHECK(revision=1),
 original_descriptor_hash text NOT NULL CHECK(original_descriptor_hash~'^[0-9a-f]{64}$'),
 canonical_expectation text NOT NULL,
 guard_template text NOT NULL,
 require_bound_body_hash text NOT NULL CHECK(require_bound_body_hash~'^[0-9a-f]{64}$')
);
ALTER TABLE beta_time_clock_v1.admission ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE beta_time_clock_v1.admission FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION beta_time_clock_v1.immutable_admission() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$"""+IMMUTABLE_BODY+"""$$;
REVOKE ALL ON FUNCTION beta_time_clock_v1.immutable_admission() FROM PUBLIC,anon,authenticated,service_role;
"""
    populate="""
DO $beta_clock_source_admission$DECLARE p_original jsonb;p_original_hash text;expected jsonb;
 beta_text text;beta_h text;beta_th text:="""+literal(family['template_hash'])+""";
 beta_template text:="""+literal(family['template_body'])+""";beta_body text;BEGIN
 SELECT definition,definition_hash INTO STRICT p_original,p_original_hash FROM controlled_count_v1.descriptor WHERE revision=1;
"""+normalization_sql()+"""
 beta_text:=expected::text;beta_h:=encode(sha256(convert_to(beta_text,'UTF8')),'hex');
 beta_body:=replace(replace(beta_template,"""+literal(EXPECTED_MARKER)+""",beta_h),"""+literal(TEMPLATE_MARKER)+""",beta_th);
 INSERT INTO beta_time_clock_v1.admission VALUES(1,p_original_hash,beta_text,beta_template,
 encode(sha256(convert_to(beta_body,'UTF8')),'hex'));
 EXECUTE """+literal(family['header']+' AS ')+"""||quote_literal(beta_body)||';';
END $beta_clock_source_admission$;
CREATE TRIGGER immutable_admission BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
ON beta_time_clock_v1.admission FOR EACH STATEMENT EXECUTE FUNCTION beta_time_clock_v1.immutable_admission();
DO $beta_clock_final_module$BEGIN
 PERFORM controlled_count_entry_v1.require_bound_module();
 PERFORM narcotics_register_v1.require_module();
END $beta_clock_final_module$;
SELECT pg_notify('pgrst','reload schema');
"""
    sql=(preflight+core.decode()+'\n'+populate).encode()
    proof=dict(kind='finite-beta-time-clock-metadata-successor-source-v2',database_operations=0,
        original_require_bound_body_sha256=OLD_BODY_SHA,successor_kind='source-derived-finite-body-family-v1',
        template_body_sha256=family['template_hash'],template_body_bytes=len(family['template_body'].encode()),
        expected_projection_inline=False,source_projection_installation_only=True,
        external_expected_accessor=False,canonical_expectation_hash_embedded=True,
        template_hash_embedded=True,observed_self_hash_authenticated_before_normalization=True,
        full_canonical_text_comparison=True,catalog_snapshot_calls_unchanged=True,
        catalog_snapshot_order_unchanged=True,additional_admission_read_bound_to_later_read=True,
        descriptor_same_value_materialized_once=True,descriptor_hash_canonical_bytes_preserved=True,
        immutable_admission_body_sha256=sha(IMMUTABLE_BODY.encode()),core_sha256=sha(core),
        migration_sha256=sha(sql),migration_bytes=len(sql),historical_descriptors_rewritten=False,
        historical_receipts_rewritten=False,ambient_catalog_used_as_expected=False,
        whole_comparison_body_inverse=True,changed_properties=['ordinary_relations.time_entries.acl',
        'ordinary_relations.time_entries.policies','functions.'+SIGNATURE+'.body_sha256'])
    return sql,proof


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
