"""Observed current-reader/disclosure and post-insert-expiry locks. Owned synthetic PDF runtime only."""

import argparse, json, subprocess, time, uuid, tomllib
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--project-config", type=Path, required=True)
p.add_argument("--job", required=True)
p.add_argument("--actor", required=True)
p.add_argument("--run-synthetic-local", action="store_true", required=True)
a = p.parse_args()
job = str(uuid.UUID(a.job))
actor = str(uuid.UUID(a.actor))
project = tomllib.loads(a.project_config.read_text())["project_id"]
assert project.startswith("lrv-pdfregistration-")
container = "supabase_db_" + project
labels = json.loads(subprocess.check_output(["docker", "inspect", container]))[0][
    "Config"
]["Labels"]
assert labels["com.supabase.cli.project"] == project
assert (
    Path(labels["com.supabase.cli.workdir"]).resolve()
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
    return subprocess.run(
        base, input=q, text=True, capture_output=True, check=True, timeout=120
    ).stdout.strip()


def quote(s):
    return "'" + str(s).replace("'", "''") + "'"


assert sql(f"select email from auth.users where id='{actor}'").startswith(
    "synthetic-pdf-registration-"
)
roles = json.loads(
    sql(
        f"select json_agg(role::text order by role) from user_roles where user_id='{actor}'"
    )
)
assert roles and set(roles) <= set(["STAFF", "DVM", "ADMIN"])
pet = sql(f"select pet_id from diagnostic_pdf_jobs where id='{job}'")
encoded = sql(
    f"select replace(encode(bytes,'base64'),E'\\n','') from diagnostic_pdf_captures where job_id='{job}'"
)
service = "select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);set local role service_role;"
checks = 0


def prepare():
    global authority, call
    authority = str(uuid.uuid4())
    auth = (
        'select set_config(\'request.jwt.claims\',\'{"role":"authenticated","sub":"'
        + actor
        + "\"}',true);set local role authenticated;"
    )
    sql(
        f"begin;{auth}select authorize_diagnostic_pdf_download('{authority}','{job}','{pet}');commit;"
    )
    call = f"select complete_diagnostic_pdf_download('{authority}','{actor}',{quote(encoded)});"


def contended(holder, expected, expire=False):
    global checks
    tag = "lrv-registration-race-" + uuid.uuid4().hex
    h = subprocess.Popen(
        base,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    w = None
    try:
        h.stdin.write("begin;" + holder + "\nselect 'LOCKED';\n")
        h.stdin.flush()
        for _ in range(10):
            line = h.stdout.readline().strip()
            if line == "LOCKED":
                break
        else:
            raise AssertionError("Holder did not reach its marker")
        w = subprocess.Popen(
            base,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        w.stdin.write(
            "begin;set application_name="
            + quote(tag)
            + ";"
            + service
            + call
            + "commit;"
        )
        w.stdin.close()
        observed = False
        for _ in range(100):
            if (
                sql(
                    "select count(*) from pg_stat_activity where application_name="
                    + quote(tag)
                    + " and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;"
                )
                == "1"
            ):
                observed = True
                break
            if w.poll() is not None:
                break
            time.sleep(0.05)
        assert observed, "Waiter must visibly block on the held row"
        checks += 1
        if expire:
            deadline = time.monotonic() + 40
            while (
                sql(
                    f"select clock_timestamp()>expires_at from diagnostic_pdf_download_authorities where id='{authority}';"
                )
                != "t"
            ):
                assert time.monotonic() < deadline
                time.sleep(0.05)
        h.stdin.write("commit;\n")
        h.stdin.close()
        h.wait(timeout=10)
        assert h.returncode == 0, h.stderr.read()
        w.wait(timeout=15)
        err = w.stderr.read()
        assert w.returncode != 0 and expected in err, err
        checks += 1
    finally:
        for proc in [h, w]:
            if proc and proc.poll() is None:
                proc.kill()
                proc.wait(timeout=10)


prepare()
contended(f"update profiles set is_active=false where id='{actor}';", "42501")
sql(f"update profiles set is_active=true where id='{actor}';")
prepare()
contended(f"delete from user_roles where user_id='{actor}';", "42501")
sql(
    "insert into user_roles(user_id,role) values "
    + ",".join("('" + actor + "','" + r + "')" for r in roles)
    + ";"
)
prepare()
contended("update diagnostic_pdf_staff_disclosure_policy set enabled=false;", "PT409")
sql("update diagnostic_pdf_staff_disclosure_policy set enabled=true;")
# First completion holds a unique audit insert. The second must wait and then fail after real 30-second expiry.
prepare()
contended(service + call, "PT409", expire=True)
assert sql("select count(*) from communication_outbox") == "0"
print(
    f"PDF download observed-lock proof passed: {checks} checks; real expiry after unique-insert wait; no provider requests."
)
