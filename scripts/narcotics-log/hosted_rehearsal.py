"""Disposable rehearsal of mixed historical receipts and hosted audit columns.

The original204 history is constructed once in a fresh, scheduler-paused local
database. Existing history rows are never rewritten. No hosted target is used.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
import install_rehearsal as installation
import hosted_history as history


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def audit_column_controls(root):
    """Owned source-only SQL controls; no application authorization is claimed."""
    rows, variants = history.sources(root)
    row, = [r for r in rows if r['version'] == '20260912220000']
    assert len(row['statements']) > 1
    predicate = history.predicate(row['version'], variants[row['version']])
    needle = 'from supabase_migrations.schema_migrations m'
    assert predicate.count(needle) == 1
    predicate = predicate.replace(needle, 'from pg_temp.hosted_receipt_control m')
    fields = ','.join(literal(s) for s in row['statements'])
    original = literal(json.dumps(row, ensure_ascii=False, separators=(',', ':')))
    refusal = "IF " + predicate + " THEN RAISE EXCEPTION 'tampered_source_receipt_accepted';END IF;"
    return ("BEGIN;CREATE TEMP TABLE hosted_receipt_control(version text,statements text[],name text,created_by text,idempotency_key text,rollback text[])ON COMMIT DROP;\n"
            "INSERT INTO hosted_receipt_control VALUES(" + literal(row['version']) + ",ARRAY[" + fields + "]::text[]," + literal(row['name']) + ",'creator','request',ARRAY['retained']::text[]);\n"
            "DO $audit_receipt$ BEGIN "
            "IF(SELECT to_jsonb(m)FROM pg_temp.hosted_receipt_control m)=" + original + "::jsonb THEN RAISE EXCEPTION 'extra_audit_columns_not_exercised';END IF;"
            "IF NOT " + predicate + " THEN RAISE EXCEPTION 'canonical_source_receipt_rejected';END IF;"
            "UPDATE pg_temp.hosted_receipt_control SET created_by='other',idempotency_key='other request',rollback=ARRAY['other retained audit']::text[];"
            "IF NOT " + predicate + " THEN RAISE EXCEPTION 'audit_values_changed_sql_receipt';END IF;"
            "UPDATE pg_temp.hosted_receipt_control SET name='changed';" + refusal
            + "UPDATE pg_temp.hosted_receipt_control SET name=" + literal(row['name']) + ",version='00000000000000';" + refusal
            + "UPDATE pg_temp.hosted_receipt_control SET version=" + literal(row['version']) + ",statements[1]=statements[1]||' ';" + refusal
            + "UPDATE pg_temp.hosted_receipt_control SET statements=ARRAY[" + fields + "]::text[];"
            "UPDATE pg_temp.hosted_receipt_control SET statements=ARRAY(SELECT s FROM unnest(statements)WITH ORDINALITY t(s,n)ORDER BY n DESC);" + refusal
            + "UPDATE pg_temp.hosted_receipt_control SET statements=ARRAY[" + fields + "]::text[];"
            "UPDATE pg_temp.hosted_receipt_control SET statements=statements[1:cardinality(statements)-1];" + refusal
            + "END $audit_receipt$;ROLLBACK;\n")


def initial_source(root):
    rows, variants = history.sources(root)
    sql = ["CREATE SCHEMA IF NOT EXISTS supabase_migrations;",
           "CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text NOT NULL PRIMARY KEY,statements text[],name text,created_by text,idempotency_key text UNIQUE,rollback text[]);",
           "DO $empty$BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations)THEN RAISE EXCEPTION 'fresh history required';END IF;END$empty$;"]
    expected = []
    for index, row in enumerate(rows[:204]):
        source, = (Path(root) / "supabase/migrations").glob(row["version"] + "_*.sql")
        raw = history.prefix.regular(source)
        if history.prefix.digest(raw) != variants[row["version"]]["source_sha256"]:
            raise ValueError("Independently admitted original authored SQL required")
        text = raw.decode("utf-8", errors="strict")
        # Construct both finite source encodings in the original INSERT.
        # No observed hosted receipt or post-install history rewrite is used.
        receipt = ("alter function public.payment_immutable() set search_path = pg_catalog;"
                   if row["version"] == history.PAYMENT_VERSION else text)
        statements = (row["statements"] if (index % 2 == 0 or row["version"] == "20260912220000")
                      and row["version"] != history.PAYMENT_VERSION else [receipt])
        sql += ["RESET ALL;SET statement_timeout='30s';SET lock_timeout='5s';", text,
                ";RESET ALL;SET standard_conforming_strings=on;",
                "INSERT INTO supabase_migrations.schema_migrations(version,name,statements,created_by,idempotency_key,rollback)VALUES("
                + literal(row["version"]) + "," + literal(row["name"]) + ",ARRAY[" + ",".join(literal(item) for item in statements)
                + "]::text[],'synthetic history creator'," + literal('source-' + row["version"]) + ",ARRAY['synthetic retained audit value']::text[]);"]
        expected.append({"version": row["version"], "name": row["name"], **history.array_pin(statements)})
    sql.append(audit_column_controls(root))
    return ("\n".join(sql) + "\n").encode(), rows, expected


def engine_table_effects(root):
    source = history.prefix.regular(Path(root) / "supabase/migrations/20261020151157_controlled_stock_private_engine.sql").decode()
    names = re.findall(r"^create table (public\.[a-z_]+)\(", source, re.M | re.I)
    if len(names) != 21 or len(set(names)) != 21 or "public.controlled_stock_engine_manifests" not in names:
        raise ValueError("Complete original205 source-declared new table inventory required")
    return {name: int(name == "public.controlled_stock_engine_manifests") for name in names}


class HostedHistoryInstallation(installation.Installation):
    def __init__(self, *args):
        super().__init__(*args)
        self.result["kind"] = "narcotics-authored-history-forward-installation-v1"

    def prepare_migrations(self, migrations):
        self.project_pins = {}
        self.project_sources()

    def bootstrap_prefix(self, bootstrap):
        self.boot = bootstrap.Bootstrap(self.view, self.project, 0,
            "realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
            False, self.evidence / "bootstrap", self.runner)
        self.boot.execute()
        self.boot.deadline = self.phase_end
        self.result["scheduler_paused_before_first_project_SQL"] = True
        program, rows, expected = initial_source(self.view)
        with (self.evidence / "authored204-initial-source.sql").open("xb") as stream:
            stream.write(program)
        self.boot.sql(program.decode("utf-8"))
        # Match the already-validated hosted CHECK without changing its SQL,
        # original migration receipt, client rows, or enforcement on new rows.
        self.boot.sql("ALTER TABLE public.clients VALIDATE CONSTRAINT clients_required_contacts_check;")
        self.result["hosted_client_contact_check_validated_before_installation"] = True
        self.result["source_only_audit_column_controls"] = {"cases": 7, "Auth_acceptance": False, "domain_writes": 0}
        before = self.rows("authored204-permanent-rows")
        variants = history.materialize()
        migrations = self.project / "supabase/migrations"
        # The CLI still sees the complete local version inventory; only the
        # initially constructed receipt encodings differ from its own format.
        for source in sorted((self.view / "supabase/migrations").glob("*.sql"))[:204]:
            shutil.copyfile(source, migrations / source.name)
            self.project_pins[source.name] = history.prefix.digest(history.prefix.regular(source))
        self.project_sources()
        source206 = history.prefix.ROOT / "scripts/narcotics-log/hosted-source/migrations/20261022010000_controlled_secondary_review_private.sql"
        for source in (self.view / "supabase/migrations/20261020151157_controlled_stock_private_engine.sql", source206):
            target = migrations / source.name
            shutil.copyfile(source, target)
            self.project_pins[source.name] = history.prefix.digest(history.prefix.regular(source))
            self.project_sources()
            self.owner_end = min(self.phase_end, time.monotonic() + installation.OWNER_SECONDS)
            try:
                self.boot.command(["supabase", "migration", "up", "--local", "--workdir", str(self.project), "--experimental=false"], timeout=installation.OWNER_SECONDS)
                self.remaining()
            finally:
                self.owner_end = None
            self.project_sources()
            if source.name.startswith("20261020151157_"):
                row = rows[-1]
                expected.append({"version": row["version"], "name": row["name"], **history.array_pin(row["statements"])})
            else:
                framed = json.loads(history.prefix.regular(history.prefix.ROOT / "scripts/narcotics-log/hosted-source/cli-framing.json"))["framing"]
                if framed["sha256"] != variants["variant_source_sha256"]:
                    raise ValueError("Reviewed206 source variant changed during installation")
                expected.append({"version": "20261022010000", "name": "controlled_secondary_review_private",
                                 **{key: framed[key] for key in ("statement_count", "postgres_array_sha256", "postgres_array_bytes")}})
        common = installation.decode(history.prefix.regular(installation.HERE / "common-expected.json"))
        added = {**engine_table_effects(self.view),
                 **{"controlled_review." + name: int(name == "descriptor") for name in common["parents"]["private206"]["relations"]}}
        installation.preserve(before, self.rows("authored206-permanent-rows"),
            {"supabase_migrations.schema_migrations": 2}, added)
        self.result["original204_rows_preserved_with_source_declared_appends"] = True
        self.result["historical_ledger_rows_rewritten"] = False
        self.boot.sql(bootstrap.SAFE_SQL)
        if self.boot.sql(bootstrap.DRAIN_SQL) != "t":
            raise ValueError("Owned scheduler containment changed")
        return expected

    def execute(self):
        super().execute()
        observed = self.query("validated-client-constraint-controls",
                              (installation.HERE / "validated-client-controls.sql").read_text())
        if observed != {"cases": 7, "raw_client_check_still_validated": True, "same_original_metadata": True}:
            raise ValueError("Validated-client catalog controls failed")
        self.result["validated_client_constraint_controls"] = observed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--check-source", action="store_true")
    modes.add_argument("--run-synthetic-local", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    started = time.monotonic()
    _, layout, pins = installation.source_admission()
    history.materialize()
    raw = history.prefix.regular(installation.ROOT / "supabase/migrations" / history.FORWARD_NAME)
    variant, _ = history.forward_variant(raw)
    if variant != raw:
        raise ValueError("Reviewed forward receipt gates required")
    base = installation.HERE / "hosted-source"
    for path in [installation.HERE / "hosted_rehearsal.py", installation.HERE / "hosted_history.py", *base.rglob("*")]:
        if path.is_file():
            pins[str(path.relative_to(installation.ROOT))] = installation.sha(history.prefix.regular(path))
    if args.check_source:
        program, _, expected = initial_source(installation.ROOT)
        print(json.dumps({"database_operations": 0, "original_authored_receipts": len(expected), "initial_source_bytes": len(program),
                          "original205_new_tables": len(engine_table_effects(installation.ROOT))}))
        return
    installation.execute_owned(layout, pins, started, HostedHistoryInstallation)


if __name__ == "__main__":
    main()
