#!/usr/bin/env python3
"""Approved178 migration: exact-source, fresh-UUID rollback-only hosted proof."""

import argparse, hashlib, json, re, subprocess, tempfile, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
a = argparse.ArgumentParser(description=__doc__)
a.add_argument("project", choices=["kothoqicubowyhwfsrte", "mgadheotkdnrsatfivjy"])
a.add_argument("--prepare-only", action="store_true")
args = a.parse_args()


def query(sql=None, file=None):
    cmd = [
        "supabase",
        "db",
        "query",
        "--linked",
        "--project-ref",
        args.project,
        "--output-format",
        "json",
    ] + (["--file", str(file)] if file else [sql])
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=True)
    d = json.loads(r.stdout)
    return d if isinstance(d, list) else d["rows"]


m = ROOT / "supabase/migrations/20261012210016_diagnostic_pdf_release_scope.sql"
s = ROOT / "supabase/tests/diagnostic_pdf_release_scope.test.sql"
assert (
    hashlib.sha256(m.read_bytes()).hexdigest()
    == "bfb99625e39205307918aea1647d1d6548f5324f9bcdf10f98a9d8ab6e24a516"
)
assert (
    hashlib.sha256(s.read_bytes()).hexdigest()
    == "2082d2d559ecc3b5ebcba3db1cd77502df574d2489874727664d4f08dc9ec929"
)
source = s.read_text()
mapping = {
    old: str(uuid.uuid4())
    for old in set(re.findall(r"b3400000-0000-4000-8000-[0-9]{12}", source))
}
actors = [
    mapping["b3400000-0000-4000-8000-000000000" + str(n)] for n in [800, 801, 802]
]
source = source.replace(
    "id::text like 'b3400000-%'",
    "id in (" + ",".join("'" + v + "'" for v in actors) + ")",
)
source = source.replace(
    "from diagnostic_pdf_download_responses),1",
    "from diagnostic_pdf_download_responses where authority_id='b3400000-0000-4000-8000-000000000200'),1",
)
source = source.replace(
    "delete from diagnostic_pdf_download_responses$$",
    "delete from diagnostic_pdf_download_responses where authority_id='b3400000-0000-4000-8000-000000000200'$$",
)
source = source.replace(
    "set expires_at=now()$$",
    "set expires_at=now() where id='b3400000-0000-4000-8000-000000000200'$$",
)
for old, new in mapping.items():
    source = source.replace(old, new)
nonce = uuid.uuid4().hex
source = re.sub(
    r"(synthetic-[a-z-]+)@example\.test",
    lambda v: v.group(1) + "-" + nonce + "@example.test",
    source,
)
assert "b3400000" not in source and "id::text like 'b3400000-%'" not in source
source = source.replace(
    "select no_plan();",
    """select no_plan();
create function pg_temp.prove(result text) returns void language plpgsql as $$begin
 if result not like 'ok %' then raise exception 'Hosted PDF job assertion failed: %',result;end if;
 perform set_config('lrv.pdf_job_checks',(coalesce(nullif(current_setting('lrv.pdf_job_checks',true),''),'0')::integer+1)::text,true);
end $$;""",
)
source, count = re.subn(
    r"\bselect (is|isnt|ok|throws_ok|lives_ok)\((.*?)\);",
    lambda v: "select pg_temp.prove(" + v.group(1) + "(" + v.group(2) + "));",
    source,
    flags=re.M | re.S,
)
assert count == 26, count
source, finish = re.subn(
    r"select \* from finish\(\);\s*rollback;",
    """do $$begin if current_setting('lrv.pdf_job_checks')::integer<>26 then raise exception 'Incomplete PDF proof';end if;end $$;
select jsonb_build_object('checks',26,'synthetic_transaction',true,'provider_requests',0) as proof;rollback;""",
    source,
)
assert (
    finish == 1
    and source.split("begin;", 1)[0]
    .strip()
    .startswith("-- Release-scope authorization")
    and source.rstrip().endswith("rollback;")
)
expected = dict(
    re.findall(
        r"create function public\.(\w+)\(.*?\) returns.*?as \$\$(.*?)\$\$;",
        m.read_text(),
        re.S | re.I,
    )
)
assert len(expected) == 3
if args.prepare_only:
    print(
        "Prepared26 pinned rollback assertions; fresh exact actors;3 canonical bodies; no hosted operations"
    )
    raise SystemExit(0)
tables = [
    "auth.users",
    "profiles",
    "user_roles",
    "clients",
    "pets",
    "clinical_encounters",
    "patient_documents",
    "storage.objects",
    "patient_lab_orders",
    "diagnostic_panels",
    "diagnostic_panel_versions",
    "diagnostic_panel_actions",
    "diagnostic_panel_revisions",
    "diagnostic_pdf_staff_disclosure_policy",
    "diagnostic_pdf_download_authorities",
    "diagnostic_pdf_download_responses",
    "diagnostic_pdf_runtime_policy",
    "diagnostic_pdf_manifests",
    "diagnostic_pdf_processing",
    "diagnostic_pdf_processing_attempts",
    "diagnostic_pdf_validations",
    "diagnostic_pdf_upload_intents",
    "diagnostic_pdf_artifacts",
    "diagnostic_pdf_worker_policy",
    "diagnostic_pdf_jobs",
    "diagnostic_pdf_attempts",
    "diagnostic_pdf_captures",
    "diagnostic_pdf_actions",
    "diagnostic_pdf_revisions",
    "record_requests",
    "record_request_actions",
    "record_request_revisions",
    "record_request_receipts",
    "record_request_manifests",
    "record_request_packages",
    "record_request_release_links",
    "record_request_recipient_authorizations",
    "record_request_authorization_revocations",
    "record_request_disclosure_policy",
    "record_releases",
    "release_email_requests",
    "record_release_policy",
    "communication_outbox",
    "communication_attempts",
    "audit_logs",
    "payment_provider_profiles",
    "reminder_automation_policies",
]
snapshot_sql = (
    "select jsonb_build_object("
    + ",".join(
        "'%s',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),''))) from %s t)"
        % (t, t)
        for t in tables
    )
    + ",'pgtap',(select extversion from pg_extension where extname='pgtap')) as snapshot;"
)
inventory = query(
    "select count(*) as count,max(version) as latest from supabase_migrations.schema_migrations;"
)[0]
assert inventory == {"count": 178, "latest": "20261012210016"}
functions = query(
    "select p.proname,p.prosrc,p.proconfig,p.oid::regprocedure::text as signature,has_function_privilege('anon',p.oid,'EXECUTE') as anon,has_function_privilege('authenticated',p.oid,'EXECUTE') as staff,has_function_privilege('service_role',p.oid,'EXECUTE') as service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ("
    + ",".join("'" + n + "'" for n in expected)
    + ");"
)
assert len(functions) == 3
for f in functions:
    assert f["prosrc"] == expected[f["proname"]] and f["proconfig"] == [
        "search_path=public"
    ], f["proname"]
    assert not f["anon"]
    assert f["staff"] == (f["proname"] in ["read_diagnostic_pdf_release_scope"])
    assert f["service"] == (f["proname"] in [])
acl = query(
    "select c.relname,c.relrowsecurity,exists(select 1 from unnest(array['anon','authenticated','service_role']) r where has_table_privilege(r,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) as exposed from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'diagnostic_pdf_%';"
)
assert len(acl) == 16 and all(t["relrowsecurity"] and not t["exposed"] for t in acl)
before = query(snapshot_sql)[0]["snapshot"]
assert (
    before["diagnostic_pdf_runtime_policy"]["count"]
    == before["diagnostic_pdf_staff_disclosure_policy"]["count"]
    == 0
)
assert (
    before["diagnostic_pdf_worker_policy"]["count"]
    == before["record_release_policy"]["count"]
    == before["record_request_disclosure_policy"]["count"]
    == 0
)
source = source.replace(
    "(select count(*)::integer from communication_outbox),0",
    f"(select count(*)::integer from communication_outbox),{before['communication_outbox']['count']}",
)
source = source.replace(
    "(select count(*)::integer from record_releases),0",
    f"(select count(*)::integer from record_releases),{before['record_releases']['count']}",
)
with tempfile.NamedTemporaryFile(
    mode="w", suffix=".sql", prefix="lrv-pdf-hosted-", delete=False
) as tmp:
    tmp.write(source)
    path = Path(tmp.name)
try:
    result = query(file=path)
finally:
    path.unlink(missing_ok=True)
assert query(snapshot_sql)[0]["snapshot"] == before, (
    "Rollback changed baseline; inspect without overwriting data"
)
print(
    json.dumps(
        {
            "project": args.project,
            "migrations": inventory,
            "checks": 26,
            "canonical_function_bodies": 3,
            "private_rls_ledgers_and_policy": 16,
            "all_synthetic_writes_rolled_back": True,
            "baseline_unchanged": True,
            "worker_policy": "empty/off",
            "provider_requests": 0,
            "proof": result,
        }
    )
)
