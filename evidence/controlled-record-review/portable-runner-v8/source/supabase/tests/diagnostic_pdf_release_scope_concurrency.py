"""Observed diagnostic-root transition and staff-scope offboarding locks. Owned synthetic PDF runtime only."""

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
    result = subprocess.run(base, input=q, text=True, capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError(result.stderr[-2000:])
    return result.stdout.strip()


def quote(s):
    return "'" + str(s).replace("'", "''") + "'"


assert sql(f"select email from auth.users where id='{actor}'").startswith(
    "synthetic-pdf-registration-"
)
pet = sql(f"select pet_id from diagnostic_pdf_jobs where id='{job}'")
panel = sql(f"select panel_id from diagnostic_pdf_jobs where id='{job}'")
auth = (
    'select set_config(\'request.jwt.claims\',\'{"role":"authenticated","sub":"'
    + actor
    + "\"}',true);set local role authenticated;"
)
service = auth
call = f"select read_diagnostic_pdf_release_scope('{job}','{pet}','current');"
checks = 0


def contended(holder, expected):
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
            raise AssertionError(
                "Holder did not reach its marker: "
                + (h.stderr.read() if h.poll() is not None else "still running")
            )
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


# Changing the current source while the scope waits must reject stale-current selection.
# A FK-valid synthetic null-head/draft transition is committed while the reader waits, then restored.
# Actual diagnostic finalization/correction is proved separately through Auth/RPC in the native harness.
original = sql(f"select current_finalized_id from diagnostic_panels where id='{panel}'")
contended(
    auth.split("set local role")[0]
    + f"update diagnostic_panels set current_finalized_id=null,current_finalized_number=0,draft=(select snapshot from diagnostic_panel_versions where id='{job}') where id='{panel}';",
    "PT409",
)
sql(
    "begin;"
    + auth.split("set local role")[0]
    + f"update diagnostic_panels set current_finalized_id='{original}',current_finalized_number=(select number from diagnostic_panel_versions where id='{original}'),draft=null where id='{panel}';commit;"
)
contended(f"update profiles set is_active=false where id='{actor}';", "42501")
sql(f"update profiles set is_active=true where id='{actor}';")
assert sql("select count(*) from communication_outbox") == "0"
print(
    f"PDF release scope observed-lock proof passed: {checks} checks; stale-current and offboarding denial; no provider requests."
)
