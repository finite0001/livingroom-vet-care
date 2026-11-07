"""Owned PostgreSQL negative controls for the exact inline successor block.

This isolated component test is not full controlled-business or Auth acceptance.
It executes the candidate's actual admission DDL and inline comparison source.
"""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import time
import uuid

import beta_time_clock_source as source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-synthetic-local", action="store_true", required=True)
    parser.parse_args()
    sql, proof = source.build()
    original = {"properties": {"functions": {source.SIGNATURE: {"body_sha256": source.OLD_BODY_SHA, "retained_number": 1,
        "owner":"postgres","configuration":["search_path=pg_catalog","quote_all_identifiers=false","TimeZone=UTC","DateStyle=ISO,YMD","IntervalStyle=postgres","extra_float_digits=3"],
        "acl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":False}]}},
        "other": {"retained": True, "retained_number": 1, "ordered": [1, 2]}, "nullable": None, "é": "retained", "ordinary_relations": {"time_entries": {
            "acl": [{"grantee": role, "privilege": privilege}
                    for role in ("postgres", "authenticated", "service_role")
                    for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE")],
            "policies": [{"name": name, "retained_number": 1} for name in ("Admins update time entries", "Admins delete time entries", "Read own")],
            "columns": [{"name": "unchanged", "position": 1}]}}}}
    original_raw=json.dumps(original)
    expected=None
    text=sql.decode();core=(source.ROOT/'scripts/time-clock/atomic-time-clock.sql').read_text()
    if text.count(core)!=1:raise ValueError('Exact unchanged core required')
    private_start=text.index('CREATE SCHEMA beta_time_clock_v1 AUTHORIZATION postgres;')
    private_ddl=text[private_start:text.index(core,private_start)]
    populate=text[text.index('DO $beta_clock_source_admission$'):text.index('DO $beta_clock_final_module$')]
    fixture=("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;"
        "CREATE SCHEMA controlled_count_v1;CREATE SCHEMA controlled_count_entry_v1;"
        "CREATE TABLE controlled_count_v1.descriptor(revision integer PRIMARY KEY,definition jsonb,definition_hash text);"
        "INSERT INTO controlled_count_v1.descriptor VALUES(1,"+source.literal(original_raw)+"::jsonb,'"+"a"*64+"');"
        +private_ddl+populate+"REVOKE ALL ON FUNCTION controlled_count_entry_v1.require_bound_module() FROM PUBLIC;")
    name = "lrv-beta-metadata-" + uuid.uuid4().hex[:12]
    container = None
    receipt = dict(kind="finite-beta-metadata-postgres-component-v1", passed=False, checks=[],
                   migration_sha256=proof["migration_sha256"], hosted_writes=0,
                   application_Auth_verified=False, full_controlled_business_verified=False, owned_cleanup=False)

    def command(program, error=None):
        result = subprocess.run(["docker", "exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-v", "ON_ERROR_STOP=1"],
            input="SET statement_timeout='10s';SET lock_timeout='5s';" + program,
            text=True, capture_output=True, timeout=15)
        if error:
            if result.returncode == 0 or error not in result.stderr:
                raise AssertionError("Expected refusal " + error + ": " + result.stderr)
        elif result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout.strip()

    def check(actual=None):
        return "SELECT public.beta_metadata_control(" + source.literal(json.dumps(expected if actual is None else actual)) + "::jsonb);"

    def refused(label, mutation, expected_error, actual=None):
        command("BEGIN;" + mutation + check(actual) + "ROLLBACK;", expected_error)
        command(check())
        receipt["checks"].append(label)

    try:
        launched = subprocess.run(["docker", "run", "-d", "--rm", "--name", name, "--network", "none",
            "--label", "lrv.beta-metadata-control=true", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine"],
            text=True, capture_output=True, timeout=60, check=True)
        container = launched.stdout.strip()
        if len(container) != 64 or any(c not in "0123456789abcdef" for c in container):
            raise ValueError("Exact owned container identity required")
        ready_until = time.monotonic() + 20
        while True:
            leader = subprocess.run(["docker", "exec", container, "cat", "/proc/1/comm"], capture_output=True, text=True, timeout=5)
            # The entrypoint's temporary initialization server also answers
            # pg_isready. Wait for the final PID1 server before issuing DDL.
            if leader.returncode == 0 and leader.stdout.strip() == "postgres":
                probe = subprocess.run(["docker", "exec", container, "pg_isready", "-U", "postgres"], capture_output=True, timeout=5)
                if probe.returncode == 0:
                    break
            if time.monotonic() >= ready_until:
                raise TimeoutError("Owned component PostgreSQL did not become ready")
            time.sleep(0.1)
        command(fixture)
        independent=json.loads(command('BEGIN;'+source.canonical_expectation_query(original_raw)+'ROLLBACK;'))
        family=source.render_family(independent['canonical_text'])
        if family['expected_hash']!=independent['sha256']:raise AssertionError('Independent canonical hash differs')
        actual_body=command("SELECT prosrc FROM pg_proc WHERE oid='controlled_count_entry_v1.require_bound_module()'::regprocedure;")
        if actual_body!=family['body'].strip():raise AssertionError('Generated function differs from independent exact source family')
        expected=source.expected_properties(original['properties'],family['body_sha256'])
        body=family['body'];early=body[body.index(' -- Finite pre-read relation gate;'):body.index(' actual:=jsonb_build_object(')]
        tail=body[body.index(" IF current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM pg_namespace n"):]
        case=body.split("'body_sha256',CASE WHEN w.signature=",1)[1].split(" END,",1)[0]
        case="CASE WHEN w.signature="+case+" END"
        # Execute the actual source-authored self-normalization CASE against the
        # generated pg_proc row. Other metadata still reaches full text equality.
        capture="""
 IF jsonb_typeof(actual)IS DISTINCT FROM 'object'OR actual#>>'{functions,controlled_count_entry_v1.require_bound_module(),body_sha256}'IS DISTINCT FROM beta_hg THEN
 RAISE EXCEPTION 'count_module_invalid';END IF;
 SELECT jsonb_build_object('body_sha256',"""+case+""",'owner',pg_get_userbyid(p.proowner),
 'configuration',to_jsonb(p.proconfig),'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object(
 'grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC'ELSE pg_get_userbyid(a.grantee)END,
 'privilege',a.privilege_type,'grantable',a.is_grantable)ORDER BY a.grantee,a.privilege_type),'[]'::jsonb)
 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a))INTO observed
 FROM pg_proc p CROSS JOIN(VALUES('controlled_count_entry_v1.require_bound_module()'))w(signature)
 WHERE p.oid=to_regprocedure(w.signature);
 IF observed IS NULL THEN RAISE EXCEPTION 'count_module_invalid';END IF;
 actual:=jsonb_set(actual,'{functions,controlled_count_entry_v1.require_bound_module()}',
 (actual#>'{functions,controlled_count_entry_v1.require_bound_module()}')||observed);
"""
        component=("CREATE FUNCTION public.beta_metadata_control(input_actual jsonb)RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$"
            "DECLARE d controlled_count_v1.descriptor;actual jsonb:=input_actual;observed jsonb;beta_saved beta_time_clock_v1.admission;beta_early beta_time_clock_v1.admission;"
            "beta_template text;beta_body text;beta_hg text;beta_text text;beta_h text:="+source.literal(family['expected_hash'])+";beta_th text:="+source.literal(family['template_hash'])+";"
            "BEGIN SELECT * INTO STRICT d FROM controlled_count_v1.descriptor WHERE revision=1;"+early+capture+tail+"$$;")
        command(component)
        receipt['independent_family']={key:family[key]for key in ('expected_hash','template_hash','body_sha256')}
        receipt['checks'].append('exact generated body independently derived from source-created canonical expectation')

        # Exercise the exact authored replacement, including SQL NULL versus
        # JSON null and lexical details that must produce identical hash input.
        lexical=[None,True,False,0,1,1.0,-0.0,[],{},[1,1.0,None],
            {"é":"e\u0301", "quoted":"\"\\\n\t", "ordered":[2,1]}, original]
        values=["(NULL::jsonb)"]+["("+source.literal(json.dumps(value,ensure_ascii=False))+"::jsonb)" for value in lexical]
        old_bytes="convert_to("+source.DESCRIPTOR_HASH_ORIGINAL+",'UTF8')"
        new_bytes="convert_to("+source.DESCRIPTOR_HASH_CANONICAL+",'UTF8')"
        wrapper=command("WITH d(definition)AS(VALUES"+','.join(values)+")SELECT jsonb_build_object("
            "'cases',count(*),'bytes_equal',bool_and("+old_bytes+" IS NOT DISTINCT FROM "+new_bytes+"),"
            "'hashes_equal',bool_and(sha256("+old_bytes+") IS NOT DISTINCT FROM sha256("+new_bytes+")))FROM d;")
        if json.loads(wrapper)!={'cases':len(values),'bytes_equal':True,'hashes_equal':True}:
            raise AssertionError("Descriptor wrapper canonical bytes changed")
        receipt['descriptor_hash_equivalence']=json.loads(wrapper)
        receipt['checks'].append('exact descriptor wrapper bytes and SHA256 preserved')
        identity=command("WITH d(definition)AS(VALUES"+','.join(values)+")SELECT jsonb_build_object("
            "'cases',count(*),'bytes_equal',bool_and(convert_to(d.definition::text,'UTF8')IS NOT DISTINCT FROM "
            "convert_to("+source.DESCRIPTOR_MATERIALIZE+"::text,'UTF8')))FROM d;")
        if json.loads(identity)!={'cases':len(values),'bytes_equal':True}:
            raise AssertionError("Descriptor materialization changed the selected value")
        receipt['descriptor_materialization_equivalence']=json.loads(identity)
        receipt['checks'].append('same selected descriptor materialized without changing any JSON or SQL NULL value')
        command(check())
        receipt["checks"].append("exact current delta accepted from immutable original descriptor")
        refused("restored direct write ACL refused", "", "count_module_invalid",
                {**expected, "ordinary_relations": deepcopy(original["properties"]["ordinary_relations"])})
        changed = deepcopy(expected)
        changed["functions"][source.SIGNATURE]["body_sha256"] = "b" * 64
        refused("changed comparison function source refused", "", "count_module_invalid", changed)
        refused("admission schema exposure refused", "GRANT USAGE ON SCHEMA beta_time_clock_v1 TO authenticated;", "beta_clock_admission_catalog_invalid")
        refused("admission table exposure refused", "GRANT SELECT ON beta_time_clock_v1.admission TO authenticated;", "beta_clock_admission_catalog_invalid")
        refused("disabled admission RLS refused", "ALTER TABLE beta_time_clock_v1.admission DISABLE ROW LEVEL SECURITY;", "beta_clock_admission_catalog_invalid")
        refused("disabled immutable trigger refused", "ALTER TABLE beta_time_clock_v1.admission DISABLE TRIGGER immutable_admission;", "beta_clock_admission_immutability_invalid")
        refused("replaced immutable function refused", "CREATE OR REPLACE FUNCTION beta_time_clock_v1.immutable_admission()RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$BEGIN RETURN NULL;END$$;", "beta_clock_admission_immutability_invalid")
        for statement in ("UPDATE beta_time_clock_v1.admission SET original_descriptor_hash=repeat('b',64);",
                          "DELETE FROM beta_time_clock_v1.admission;", "TRUNCATE beta_time_clock_v1.admission;"):
            refused("admission data mutation refused", statement, "beta_clock_admission_immutable")
        refused("self-consistent unrelated expectation tamper refused", "ALTER TABLE beta_time_clock_v1.admission DISABLE TRIGGER immutable_admission;"
            "UPDATE beta_time_clock_v1.admission SET canonical_expectation=(canonical_expectation::jsonb||jsonb_build_object('other',jsonb_build_object('retained',false)))::text;"
            "ALTER TABLE beta_time_clock_v1.admission ENABLE TRIGGER immutable_admission;", "beta_clock_admission_delta_invalid")
        changed = deepcopy(expected)
        changed["unexpected"] = None
        refused("unknown null root member refused", "", "count_module_invalid", changed)
        changed = deepcopy(expected)
        del changed["nullable"]
        refused("missing null root member refused", "", "count_module_invalid", changed)
        changed = deepcopy(expected)
        changed["e\u0301"] = changed.pop("é")
        refused("Unicode-normalized distinct root key refused", "", "count_module_invalid", changed)
        changed = deepcopy(expected)
        changed["other"]["ordered"] = [2, 1]
        refused("unchanged nested array order drift refused", "", "count_module_invalid", changed)
        refused("scalar actual root refused", "", "count_module_invalid", 1)
        # jsonb equality equates 1 and 1.0; the authored canonical text must not.
        for label, path in (
            ("unchanged root numeric encoding drift refused", ("other", "retained_number")),
            ("unchanged function numeric encoding drift refused", ("functions", source.SIGNATURE, "retained_number")),
            ("unchanged relation numeric encoding drift refused", ("ordinary_relations", "time_entries", "columns", 0, "position")),
        ):
            changed = deepcopy(expected)
            branch = changed
            for key in path[:-1]:
                branch = branch[key]
            branch[path[-1]] = 1.0
            refused(label, "", "count_module_invalid", changed)
        refused("self-consistent numeric encoding expectation tamper refused",
            "ALTER TABLE beta_time_clock_v1.admission DISABLE TRIGGER immutable_admission;"
            "UPDATE beta_time_clock_v1.admission SET canonical_expectation=jsonb_set(canonical_expectation::jsonb,'{ordinary_relations,time_entries,policies,0,retained_number}','1.0')::text;"
            "ALTER TABLE beta_time_clock_v1.admission ENABLE TRIGGER immutable_admission;", "beta_clock_admission_delta_invalid")
        command("CREATE SEQUENCE public.beta_admission_read_probe;CREATE FUNCTION public.beta_read_probe(t text)RETURNS text LANGUAGE plpgsql VOLATILE AS $$BEGIN PERFORM nextval('public.beta_admission_read_probe');RETURN t;END$$;")
        refused('substituted view refused before executing its read side effect',
            "ALTER TABLE beta_time_clock_v1.admission RENAME TO admission_retained;"
            "CREATE VIEW beta_time_clock_v1.admission AS SELECT revision,original_descriptor_hash,canonical_expectation,public.beta_read_probe(guard_template)AS guard_template,require_bound_body_hash FROM beta_time_clock_v1.admission_retained;",
            'beta_clock_admission_catalog_invalid')
        if command('SELECT is_called FROM public.beta_admission_read_probe;')!='f':
            raise AssertionError('Invalid admission relation executed before its catalog gate')
        refused('forced RLS refused before early admission data read',
            'ALTER TABLE beta_time_clock_v1.admission FORCE ROW LEVEL SECURITY;', 'beta_clock_admission_catalog_invalid')
        refused('inherited admission relation refused before early read',
            'CREATE TABLE beta_time_clock_v1.admission_child()INHERITS(beta_time_clock_v1.admission);','beta_clock_admission_catalog_invalid')
        unlock="ALTER TABLE beta_time_clock_v1.admission DISABLE TRIGGER immutable_admission;"
        relock="ALTER TABLE beta_time_clock_v1.admission ENABLE TRIGGER immutable_admission;"
        refused('changed stored template with self-consistent row hash refused',unlock+
            "UPDATE beta_time_clock_v1.admission SET guard_template=guard_template||E'\\n-- drift';"
            "UPDATE beta_time_clock_v1.admission SET require_bound_body_hash=encode(sha256(convert_to(guard_template,'UTF8')),'hex');"+relock,
            'beta_clock_admission_template_invalid')
        refused('changed saved generated-body hash refused',unlock+
            "UPDATE beta_time_clock_v1.admission SET require_bound_body_hash=repeat('b',64);"+relock,
            'beta_clock_admission_template_invalid')
        refused('descriptor linkage drift refused',unlock+
            "UPDATE beta_time_clock_v1.admission SET original_descriptor_hash=repeat('b',64);"+relock,
            'beta_clock_admission_source_invalid')
        refused('changed observed generated guard body refused',
            family['header']+' AS '+source.literal(family['body']+'\n-- source drift')+';', 'count_module_invalid')
        historical=(source.ROOT/'supabase/migrations/20261027223544_narcotics_count_and_stock_workflows.sql').read_text()
        old_start=historical.index(source.HEADER);old_end=historical.index('$$;',old_start)+3
        refused('original old guard body never normalizes as valid successor',historical[old_start:old_end], 'count_module_invalid')
        refused('missing observed guard row refused','DROP FUNCTION controlled_count_entry_v1.require_bound_module();','count_module_invalid')
        refused('self owner drift retained in complete comparison','ALTER FUNCTION controlled_count_entry_v1.require_bound_module() OWNER TO anon;','count_module_invalid')
        refused('self ACL drift retained in complete comparison','GRANT EXECUTE ON FUNCTION controlled_count_entry_v1.require_bound_module() TO authenticated;','count_module_invalid')
        refused('self configuration drift retained in complete comparison','ALTER FUNCTION controlled_count_entry_v1.require_bound_module() SET jit=off;','count_module_invalid')
        for label,statement in (
            ('later body hash differs from early authenticated family',"UPDATE beta_time_clock_v1.admission SET require_bound_body_hash=repeat('b',64);"),
            ('later template differs from early authenticated template',"UPDATE beta_time_clock_v1.admission SET guard_template=guard_template||' ';"),
        ):
            changed_component=component.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1).replace(tail,unlock+statement+relock+tail,1)
            refused(label,changed_component,'beta_clock_admission_source_invalid')
        # The source-owned SQL literal, not a decoded/reserialized Python object,
        # preserves numeric scale while deriving a different legitimate family.
        overlay_raw=json.loads(command("SELECT jsonb_build_object('raw',jsonb_set("+source.literal(original_raw)+
            "::jsonb,'{properties,other,retained_number}','1.00'::jsonb)::text);"))['raw']
        overlay=json.loads(command('BEGIN;'+source.canonical_expectation_query(overlay_raw)+'ROLLBACK;'))
        overlay_family=source.render_family(overlay['canonical_text'])
        if (overlay_family['expected_hash']==family['expected_hash']or overlay_family['body_sha256']==family['body_sha256']
                or '1.00'not in overlay['canonical_text']):raise AssertionError('Lexical source overlay was lost')
        overlay_actual=json.loads(command("SELECT jsonb_build_object('raw',jsonb_set("+source.literal(overlay['canonical_text'])+
            "::jsonb,'{functions,controlled_count_entry_v1.require_bound_module(),body_sha256}',to_jsonb("+
            source.literal(overlay_family['body_sha256'])+"::text))::text);"))['raw']
        overlay_setup=unlock+"UPDATE controlled_count_v1.descriptor SET definition="+source.literal(overlay_raw)+"::jsonb,definition_hash="+source.literal(overlay['original_descriptor_hash'])+";"
        overlay_setup+="UPDATE beta_time_clock_v1.admission SET canonical_expectation="+source.literal(overlay['canonical_text'])+",original_descriptor_hash="+source.literal(overlay['original_descriptor_hash'])+",require_bound_body_hash="+source.literal(overlay_family['body_sha256'])+";"+relock+overlay_family['definition']
        overlay_setup+=component.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1).replace("beta_h text:="+source.literal(family['expected_hash']),"beta_h text:="+source.literal(overlay_family['expected_hash']),1)
        command('BEGIN;'+overlay_setup+'SELECT public.beta_metadata_control('+source.literal(overlay_actual)+'::jsonb);ROLLBACK;')
        command(check())
        receipt['checks'].append('independent legitimate source overlay preserves 1.00 and generates different exact H and G')
        command('BEGIN;'+overlay_setup+"SELECT public.beta_metadata_control(jsonb_set("+source.literal(overlay_actual)+"::jsonb,'{other,retained_number}','1.0'));ROLLBACK;",'count_module_invalid')
        command(check())
        receipt['checks'].append('1.00 source overlay rejects canonically distinct 1.0 despite JSONB numeric equality')
        for role in ("anon", "authenticated", "service_role"):
            command("SET ROLE " + role + ";SELECT * FROM beta_time_clock_v1.admission;", "permission denied")
        receipt["checks"].append("all application roles denied private admission access")
        receipt["passed"] = True
    finally:
        if container is not None:
            result = subprocess.run(["docker", "rm", "-f", "-v", container], capture_output=True, text=True, timeout=30)
            receipt["owned_cleanup"] = result.returncode == 0
        print(json.dumps(receipt, indent=2))
    if not receipt["owned_cleanup"]:
        raise RuntimeError("Owned component cleanup incomplete")


if __name__ == "__main__":
    main()
