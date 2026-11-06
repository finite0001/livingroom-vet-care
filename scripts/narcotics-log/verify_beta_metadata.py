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
    original = {"properties": {"functions": {source.SIGNATURE: {"body_sha256": source.OLD_BODY_SHA}},
        "other": {"retained": True}, "ordinary_relations": {"time_entries": {
            "acl": [{"grantee": role, "privilege": privilege}
                    for role in ("postgres", "authenticated", "service_role")
                    for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE")],
            "policies": [{"name": name} for name in ("Admins update time entries", "Admins delete time entries", "Read own")],
            "columns": [{"name": "unchanged"}]}}}}
    expected = source.expected_properties(original["properties"], proof["successor_require_bound_body_sha256"])
    text = sql.decode()
    core = (source.ROOT / "scripts/time-clock/atomic-time-clock.sql").read_text()
    if text.count(core) != 1:
        raise ValueError("One exact unchanged time-clock core source required")
    private_start = text.index("CREATE SCHEMA beta_time_clock_v1 AUTHORIZATION postgres;")
    private_ddl = text[private_start:text.index(core, private_start)]
    populate = text[text.index("DO $beta_clock_source_admission$"):text.index("DO $beta_clock_final_module$")]
    definition = sql.decode().split(source.HEADER, 1)[1].split("$$;", 1)[0]
    inline = definition[definition.index(" IF current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM pg_namespace n"):]
    if "beta_time_clock_v1.expected_properties" in inline:
        raise ValueError("External accessor must remain absent")
    fixture = ("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;"
        "CREATE SCHEMA controlled_count_v1;CREATE TABLE controlled_count_v1.descriptor(revision integer PRIMARY KEY,definition jsonb,definition_hash text);"
        "INSERT INTO controlled_count_v1.descriptor VALUES(1," + source.literal(json.dumps(original)) + "::jsonb,'" + "a" * 64 + "');\n"
        + private_ddl + populate + "\n"
        + "CREATE FUNCTION public.beta_metadata_control(actual jsonb)RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$"
        "DECLARE d controlled_count_v1.descriptor;beta_saved beta_time_clock_v1.admission;beta_expected jsonb;beta_original jsonb;"
        "BEGIN SELECT * INTO STRICT d FROM controlled_count_v1.descriptor WHERE revision=1;\n" + inline + "$$;\n")
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
            "UPDATE beta_time_clock_v1.admission SET expected_properties=jsonb_set(expected_properties,'{other,retained}','false');"
            "UPDATE beta_time_clock_v1.admission SET expected_properties_hash=encode(sha256(convert_to(expected_properties::text,'UTF8')),'hex');"
            "ALTER TABLE beta_time_clock_v1.admission ENABLE TRIGGER immutable_admission;", "beta_clock_admission_delta_invalid")
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
