"""Observed source correction and recipient revocation. Uniquely owned synthetic runtime only."""

import argparse, json, subprocess, time, tomllib, uuid
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--project-config", type=Path, required=True)
p.add_argument("--actor", required=True)
p.add_argument("--kind", choices=["correction", "revocation"], required=True)
p.add_argument("--request", required=True)
p.add_argument("--version", type=int, required=True)
p.add_argument("--package")
p.add_argument("--manifest-hash")
p.add_argument("--authorization")
p.add_argument("--email")
p.add_argument("--job")
p.add_argument("--run-synthetic-local", action="store_true", required=True)
a = p.parse_args()
actor = str(uuid.UUID(a.actor))
request = str(uuid.UUID(a.request))
project = tomllib.loads(a.project_config.read_text())["project_id"]
assert project.startswith("lrv-pdfregistration-")
container = "supabase_db_" + project
labels = json.loads(subprocess.check_output(["docker", "inspect", container]))[0][
    "Config"
]["Labels"]
assert (
    labels["com.supabase.cli.project"] == project
    and Path(labels["com.supabase.cli.workdir"]).resolve()
    == a.project_config.resolve().parent.parent
)
base = [
    "docker",
    "exec",
    "-i",
    container,
    "psql",
    "-X",
    "-qAt",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-v",
    "VERBOSITY=verbose",
]


def sql(q):
    r = subprocess.run(base, input=q, text=True, capture_output=True, timeout=120)
    if r.returncode:
        raise RuntimeError(r.stderr[-2000:])
    return r.stdout.strip()


def quote(s):
    return "'" + str(s).replace("'", "''") + "'"


def auth(who):
    return (
        "select set_config('request.jwt.claims',"
        + quote(json.dumps({"sub": who, "role": "authenticated"}))
        + ",true);set local role authenticated;"
    )


assert sql(f"select email from auth.users where id='{actor}'").startswith(
    "synthetic-pdf-registration-"
)
owner = None
prior = None
own_policy = False
try:
    if a.kind == "revocation":
        authorization = str(uuid.UUID(a.authorization))
        email = str(uuid.UUID(a.email))
        holder = (
            auth(actor)
            + f"select revoke_record_request_authorization('{uuid.uuid4()}','{request}',{a.version},jsonb_build_object('authorization_id','{authorization}','review_note','Synthetic observed client revocation'));"
        )
        waiter = (
            "set local role service_role;select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);"
            + f"select release_email_capture_context('{email}','{actor}');"
        )
        expected = "42501"
    else:
        job = str(uuid.UUID(a.job))
        package = str(uuid.UUID(a.package))
        assert len(a.manifest_hash) == 64 and all(
            c in "0123456789abcdef" for c in a.manifest_hash
        )
        source = json.loads(
            sql(
                f"select jsonb_build_object('owner',v.reviewed_by,'panel',v.panel_id,'pet',v.pet_id,'values',p.draft,'version',p.version,'current_values',cv.snapshot) from diagnostic_panel_versions v join diagnostic_panels p on p.id=v.panel_id join diagnostic_panel_versions cv on cv.id=p.current_finalized_id where v.id='{job}'"
            )
        )
        owner = source["owner"]
        prior = sql(f"select is_active::text from profiles where id='{owner}'")
        assert prior in ("true", "false")
        sql(f"update profiles set is_active=true where id='{owner}'")
        source["current_values"]["interpretation"] += (
            "\nSynthetic observed package race correction."
        )
        values = quote(json.dumps(source["current_values"])) + "::jsonb"
        holder = (
            auth(owner)
            + f"select save_diagnostic_panel('{uuid.uuid4()}','{source['panel']}','{source['pet']}',{source['version']},'draft',{values});select save_diagnostic_panel('{uuid.uuid4()}','{source['panel']}','{source['pet']}',{source['version'] + 1},'finalize',{values},'Synthetic observed corrected review','Synthetic observed correction');"
        )
        assert sql("select count(*) from record_release_policy") == "0"
        sql(
            f"insert into record_release_policy(id,enabled,accepted_by,accepted_at,acceptance_reference,accepted_schema_version) values(true,true,'{actor}',now(),'Synthetic owned package race',14)"
        )
        own_policy = True
        waiter = (
            auth(actor)
            + f"select confirm_record_request_package('{uuid.uuid4()}','{request}',{a.version},jsonb_build_object('package_id','{package}','manifest_hash','{a.manifest_hash}','attest_review',true,'attest_scope_expansion',true));"
        )
        expected = "PT409"
    tag = "lrv-diagnostic-package-race-" + uuid.uuid4().hex
    h = w = None
    try:
        h = subprocess.Popen(
            base,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        h.stdin.write("begin;" + holder + "\nselect 'LOCKED';\n")
        h.stdin.flush()
        for _ in range(20):
            if h.stdout.readline().strip() == "LOCKED":
                break
        else:
            raise AssertionError("Holder did not complete its real RPC")
        w = subprocess.Popen(
            base,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        w.stdin.write(
            "begin;set application_name=" + quote(tag) + ";" + waiter + "commit;"
        )
        w.stdin.close()
        observed = False
        for _ in range(100):
            if (
                sql(
                    "select count(*) from pg_stat_activity where application_name="
                    + quote(tag)
                    + " and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0"
                )
                == "1"
            ):
                observed = True
                break
            if w.poll() is not None:
                break
            time.sleep(0.05)
        assert observed, "Waiter must visibly block on current source/recipient row"
        h.stdin.write("commit;\n")
        h.stdin.close()
        h.wait(timeout=15)
        assert h.returncode == 0, h.stderr.read()
        w.wait(timeout=15)
        error = w.stderr.read()
        assert w.returncode != 0 and expected in error, error
        print(
            "Diagnostic numbered-package observed "
            + a.kind
            + " proof passed: 2 checks; genuine RPC; no provider requests."
        )
    finally:
        for proc in [h, w]:
            if proc and proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=10)
finally:
    try:
        if owner:
            sql(f"update profiles set is_active={prior} where id='{owner}'")
    finally:
        if own_policy:
            sql(
                f"delete from record_release_policy where accepted_by='{actor}' and acceptance_reference='Synthetic owned package race'"
            )
