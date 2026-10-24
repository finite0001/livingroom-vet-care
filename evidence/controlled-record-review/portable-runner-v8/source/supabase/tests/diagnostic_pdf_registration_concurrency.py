"""Observed locks and populated restore against genuine synthetic captured bytes. Owned local runtime only."""

import argparse, json, subprocess, time, uuid
from pathlib import Path
import tomllib

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--project-config", type=Path, required=True)
p.add_argument("--job", required=True)
p.add_argument("--mode", choices=["locks", "restore"], required=True)
p.add_argument("--run-synthetic-local", action="store_true", required=True)
a = p.parse_args()
job = str(uuid.UUID(a.job))
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


def sql(q, command=base):
    return subprocess.run(
        command, input=q, text=True, capture_output=True, check=True, timeout=120
    ).stdout.strip()


def quote(s):
    return "'" + str(s).replace("'", "''") + "'"


def select_json(q):
    return json.loads(sql("select " + q + ";"))


context = select_json(
    f"jsonb_build_object('job',to_jsonb(j),'processing',to_jsonb(p),'capture',c.metadata,'intent',to_jsonb(i)) from diagnostic_pdf_jobs j join diagnostic_pdf_processing p on p.job_id=j.id join diagnostic_pdf_captures c on c.job_id=j.id join diagnostic_pdf_upload_intents i on i.job_id=j.id where j.id='{job}'"
)
actor = context["job"]["requested_by"]
assert select_json(f"to_jsonb(email) from auth.users where id='{actor}'").startswith(
    "synthetic-pdf-registration-"
)
claim = context["processing"]
checks = 0
service = "select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);set local role service_role;"
call = f"select reserve_diagnostic_pdf_upload('{job}','{claim['claim_id']}',{claim['fence']},'{actor}');"


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
            deadline = time.monotonic() + 5
            while (
                sql(
                    f"select clock_timestamp()>lease_until from diagnostic_pdf_processing where job_id='{job}';"
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


if a.mode == "locks":
    assert claim["state"] == "claimed"
    contended(f"update profiles set is_active=false where id='{actor}';", "42501")
    sql(f"update profiles set is_active=true where id='{actor}';")
    contended(f"delete from user_roles where user_id='{actor}';", "42501")
    sql(f"insert into user_roles(user_id,role) values('{actor}','DVM');")
    contended("update diagnostic_pdf_runtime_policy set enabled=false;", "PT409")
    sql("update diagnostic_pdf_runtime_policy set enabled=true;")
    sql(
        f"update diagnostic_pdf_processing set lease_until=clock_timestamp()+interval '2 seconds' where job_id='{job}';"
    )
    contended(
        "select 1 from diagnostic_pdf_runtime_policy for update;", "PT409", expire=True
    )
    # This test intentionally expired the lease; caller will acquire a new processing fence.
    print(
        f"PDF processing observed-lock proof passed: {checks} checks; no provider requests."
    )
else:
    assert claim["state"] == "stored"
    original = select_json(
        f"jsonb_build_object('sha',encode(sha256(bytes),'hex'),'base64',replace(encode(bytes,'base64'),E'\\n',''),'manifest',(select to_jsonb(m) from diagnostic_pdf_manifests m where job_id='{job}'),'artifact',(select to_jsonb(x) from diagnostic_pdf_artifacts x where job_id='{job}'),'attempts',(select jsonb_agg(to_jsonb(t) order by fence) from diagnostic_pdf_processing_attempts t where job_id='{job}'),'intent',(select to_jsonb(i) from diagnostic_pdf_upload_intents i where job_id='{job}'),'downloads',(select jsonb_agg(to_jsonb(d) order by id) from diagnostic_pdf_download_authorities d where job_id='{job}'),'responses',(select jsonb_agg(to_jsonb(r) order by authority_id) from diagnostic_pdf_download_responses r join diagnostic_pdf_download_authorities d on d.id=r.authority_id where d.job_id='{job}'),  'record_manifests',(select jsonb_agg(to_jsonb(m) order by m.id) from record_request_manifests m join record_requests r on r.id=m.request_id where r.pet_id=(select pet_id from diagnostic_pdf_jobs where id='{job}')),  'record_packages',(select jsonb_agg(to_jsonb(p) order by p.id) from record_request_packages p join record_request_manifests m on m.id=p.manifest_id join record_requests r on r.id=m.request_id where r.pet_id=(select pet_id from diagnostic_pdf_jobs where id='{job}')),  'recipient_authorities',(select jsonb_agg(to_jsonb(a) order by a.id) from record_request_recipient_authorizations a join record_requests r on r.id=a.request_id where r.pet_id=(select pet_id from diagnostic_pdf_jobs where id='{job}')),  'release_snapshots',(select jsonb_agg(to_jsonb(r) order by r.id) from record_releases r where r.pet_id=(select pet_id from diagnostic_pdf_jobs where id='{job}')),  'release_events',(select jsonb_agg(to_jsonb(e) order by e.id) from record_release_events e join record_releases r on r.id=e.release_id where r.pet_id=(select pet_id from diagnostic_pdf_jobs where id='{job}')),  'release_email_payloads',(select jsonb_agg(to_jsonb(p) order by p.request_id) from release_email_payloads p join release_email_requests e on e.id=p.request_id join record_releases r on r.id=e.release_id where r.pet_id=(select pet_id from diagnostic_pdf_jobs where id='{job}')),  'link_grants',(select jsonb_agg(to_jsonb(g) order by g.id) from document_link_grants g join record_releases r on r.id=g.source_id and g.family='record_release' where r.pet_id=(select pet_id from diagnostic_pdf_jobs where id='{job}')),  'link_payloads',(select jsonb_agg(to_jsonb(p) order by p.grant_id) from document_link_payloads p join document_link_grants g on g.id=p.grant_id join record_releases r on r.id=g.source_id and g.family='record_release' where r.pet_id=(select pet_id from diagnostic_pdf_jobs where id='{job}')),  'request_actions',(select jsonb_agg(to_jsonb(a) order by a.id) from record_request_actions a join record_requests r on r.id=a.request_id where r.pet_id=(select pet_id from diagnostic_pdf_jobs where id='{job}'))) from diagnostic_pdf_captures where job_id='{job}'"
    )
    dump = subprocess.run(
        [
            "docker",
            "exec",
            container,
            "pg_dump",
            "-U",
            "postgres",
            "--no-owner",
            "--schema=public",
            "--schema=auth",
            "--schema=storage",
            "--schema=extensions",
            "postgres",
        ],
        capture_output=True,
        check=True,
        timeout=120,
    ).stdout
    db = "lrv_pdfregistration_restore_" + uuid.uuid4().hex
    marker = "owned-registration-restore-" + uuid.uuid4().hex
    sql(f'create database "{db}";comment on database "{db}" is {quote(marker)};')
    command = base.copy()
    command[command.index("-d") + 1] = db
    try:
        sql(
            'drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;',
            command,
        )
        dump = dump.replace(
            b"CREATE SCHEMA extensions;", b"CREATE SCHEMA IF NOT EXISTS extensions;"
        )
        dump = b"\n".join(
            line
            for line in dump.splitlines()
            if not line.startswith(b"ALTER DEFAULT PRIVILEGES")
        )
        subprocess.run(
            command, input=dump, capture_output=True, check=True, timeout=120
        )
        recovered = json.loads(
            sql(
                f"select jsonb_build_object('sha',encode(sha256(bytes),'hex'),'base64',replace(encode(bytes,'base64'),E'\\n',''),'manifest',(select to_jsonb(m) from diagnostic_pdf_manifests m where job_id='{job}'),'artifact',(select to_jsonb(x) from diagnostic_pdf_artifacts x where job_id='{job}'),'attempts',(select jsonb_agg(to_jsonb(t) order by fence) from diagnostic_pdf_processing_attempts t where job_id='{job}'),'intent',(select to_jsonb(i) from diagnostic_pdf_upload_intents i where job_id='{job}'),'downloads',(select jsonb_agg(to_jsonb(d) order by id) from diagnostic_pdf_download_authorities d where job_id='{job}'),'responses',(select jsonb_agg(to_jsonb(r) order by authority_id) from diagnostic_pdf_download_responses r join diagnostic_pdf_download_authorities d on d.id=r.authority_id where d.job_id='{job}'),  'record_manifests',(select jsonb_agg(to_jsonb(m) order by m.id) from record_request_manifests m join record_requests r on r.id=m.request_id where r.pet_id=(select pet_id from diagnostic_pdf_jobs where id='{job}')),  'record_packages',(select jsonb_agg(to_jsonb(p) order by p.id) from record_request_packages p join record_request_manifests m on m.id=p.manifest_id join record_requests r on r.id=m.request_id where r.pet_id=(select pet_id from diagnostic_pdf_jobs where id='{job}')),  'recipient_authorities',(select jsonb_agg(to_jsonb(a) order by a.id) from record_request_recipient_authorizations a join record_requests r on r.id=a.request_id where r.pet_id=(select pet_id from diagnostic_pdf_jobs where id='{job}')),  'release_snapshots',(select jsonb_agg(to_jsonb(r) order by r.id) from record_releases r where r.pet_id=(select pet_id from diagnostic_pdf_jobs where id='{job}')),  'release_events',(select jsonb_agg(to_jsonb(e) order by e.id) from record_release_events e join record_releases r on r.id=e.release_id where r.pet_id=(select pet_id from diagnostic_pdf_jobs where id='{job}')),  'release_email_payloads',(select jsonb_agg(to_jsonb(p) order by p.request_id) from release_email_payloads p join release_email_requests e on e.id=p.request_id join record_releases r on r.id=e.release_id where r.pet_id=(select pet_id from diagnostic_pdf_jobs where id='{job}')),  'link_grants',(select jsonb_agg(to_jsonb(g) order by g.id) from document_link_grants g join record_releases r on r.id=g.source_id and g.family='record_release' where r.pet_id=(select pet_id from diagnostic_pdf_jobs where id='{job}')),  'link_payloads',(select jsonb_agg(to_jsonb(p) order by p.grant_id) from document_link_payloads p join document_link_grants g on g.id=p.grant_id join record_releases r on r.id=g.source_id and g.family='record_release' where r.pet_id=(select pet_id from diagnostic_pdf_jobs where id='{job}')),  'request_actions',(select jsonb_agg(to_jsonb(a) order by a.id) from record_request_actions a join record_requests r on r.id=a.request_id where r.pet_id=(select pet_id from diagnostic_pdf_jobs where id='{job}'))) from diagnostic_pdf_captures where job_id='{job}';",
                command,
            )
        )
        for k, v in original.items():
            assert recovered[k] == v, k
            checks += 1
        assert sql("select count(*) from communication_outbox;", command) == "0"
        checks += 1
        # Restore is ledger/metadata plus immutable PDF bytes; it does not claim provider object-body backup.
        print(
            f"PDF processing populated restore passed: {checks} checks; exact bytes and ledgers preserved; no provider requests."
        )
    finally:
        assert (
            sql(
                f"select shobj_description(oid,'pg_database') from pg_database where datname='{db}';"
            )
            == marker
        )
        sql(f'drop database "{db}";')
