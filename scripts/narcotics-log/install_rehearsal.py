"""Owned, disposable CLI 206→207→208 installation proof.

No hosted target, external provider, staff impersonation or business acceptance.
The unchanged historical bootstrap runs against the separately admitted prefix.
"""
import argparse
from collections import Counter
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import socket
import sys
import tempfile
import time
import traceback
import uuid

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TOTAL_SECONDS = 600
WORK_SECONDS = 540
CLEANUP_SECONDS = 55
OWNER_SECONDS = 30
COUNT_TABLES = ("policies", "operations", "cycles", "snapshots", "statements", "outcomes",
                "cancellations", "causes", "resolutions", "open_causes",
                "reconciliation_preparations", "reconciliation_approvals",
                "reconciliation_executions", "reconciliation_confirmations",
                "reconciliation_execution_causes", "descriptor", "operation_closures", "pending_products")
CONTROL = ("BEGIN;SET LOCAL search_path=pg_catalog;SET LOCAL quote_all_identifiers=false;"
           "SET LOCAL TimeZone='UTC';SET LOCAL DateStyle='ISO,YMD';"
           "SET LOCAL IntervalStyle='postgres';SET LOCAL extra_float_digits=3;"
           "SET LOCAL statement_timeout='8s';SET LOCAL lock_timeout='5s';\n")


def load(name, path):
    if name in sys.modules:
        raise ValueError("Fresh source module alias required")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


prefix = load("_narcotics_prefix", HERE / "prefix_view.py")
process = load("_narcotics_process", HERE / "bounded_process.py")
framing = load("_narcotics_sql_framing", HERE / "sql_framing.py")
expectations = load("_narcotics_source_expectations", HERE / "source_expectations.py")
client_constraint = load("_narcotics_validated_client_constraint", HERE / "validated_client_constraint.py")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def unique(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError("Duplicate JSON field")
        result[key] = value
    return result


def decode(raw):
    def invalid(_):
        raise ValueError("Nonfinite JSON number")
    return json.loads(raw, object_pairs_hook=unique, parse_constant=invalid)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":"), allow_nan=False)


def source_admission():
    client_constraint.materialize()
    candidate = decode(prefix.regular(HERE / "release-candidate.json"))
    layout = decode(prefix.regular(HERE / "cli-framing.json"))
    data = decode(prefix.regular(HERE / "proof-data-pins.json"))
    required_data = {"original-row-hashes.sql", "module-capture.sql", "module-expected.json", "module-source-expected.sql", "common-expected.json"}
    if data.get("kind") != "narcotics-installation-source-data-v1" or data.get("execution_admitted") is not False or set(data.get("files", {})) != required_data:
        raise ValueError("Exact source-only proof data inventory required")
    if candidate["migration_count"] != 208 or candidate["prefix_migration_count"] != 206:
        raise ValueError("Exact forward candidate required")
    if (layout.get("kind") != "narcotics-official-cli-framing-candidate-v1"
            or layout["cli_version"] != "2.118.0" or layout["database_operations"] != 0
            or layout["parser_provenance_sha256"] != "28bcd6a27b93fb7a31c3e20519b5ebb6540737b26e2f333e3f44cb3340327884"
            or layout["typescript_sha256"] != "dd17428736a07e1db1a138d8a14295ddb2699ba780ee15038acdd2c6da5373a0"):
        raise ValueError("Source-only official CLI framing required")
    if set(layout["migrations"]) != set(prefix.FORWARD) or set(candidate["migrations"]) != set(prefix.FORWARD):
        raise ValueError("Named forward inventory required")
    pins = {}
    for name in prefix.FORWARD:
        path = ROOT / "supabase/migrations" / name
        raw = prefix.regular(path)
        wanted = candidate["migrations"][name]
        framed = layout["migrations"][name]
        if wanted != {"bytes": len(raw), "sha256": sha(raw)} or any(framed[k] != wanted[k] for k in wanted):
            raise ValueError("Forward source byte binding differs")
        lexical = framing.split_reviewed_statements(raw.decode("utf-8", errors="strict"))
        if len(lexical) != framed["statement_count"] or len(framed["statement_sha256s"]) != len(lexical):
            raise ValueError("Independent lexical/official framing counts differ")
        pins[str(path.relative_to(ROOT))] = sha(raw)
    for name, wanted in data["files"].items():
        if Path(name).name != name:
            raise ValueError("Fixed proof-data basename required")
        raw = prefix.regular(HERE / name)
        if wanted != {"bytes": len(raw), "sha256": sha(raw)}:
            raise ValueError("Source proof data changed")
        pins[str((HERE / name).relative_to(ROOT))] = sha(raw)
    for name in ("install_rehearsal.py", "prefix_view.py", "bounded_process.py",
                 "sql_framing.py", "frame-cli.mjs", "release-candidate.json",
                 "cli-framing.json", "proof-data-pins.json", "source_expectations.py",
                 "pending_validation.py", "pending-validation.sql", "frontier_projection.py",
                 "history_document_reuse.py", "parent_history_projection.py",
                 "validated_client_constraint.py", "compact_source_guard.py", "validated-client-constraint-proof.json",
                 "validated-client-controls.sql"):
        pins[str((HERE / name).relative_to(ROOT))] = sha(prefix.regular(HERE / name))
    evidence = 'docs/controlled-drugs/product-history-readcut-20261028.json'
    pins[evidence] = sha(prefix.regular(ROOT / evidence))
    prefix.canonical206(ROOT)
    return candidate, layout, pins


def preserve(before, after, changes, additions=None):
    additions = additions or {}
    if not set(changes) <= set(before) or set(additions) & set(before):
        raise ValueError("Every effect must name its declared original or new relation")
    if any(type(count) is not int or count < 0 for count in (*changes.values(), *additions.values())):
        raise ValueError("Exact nonnegative prospective row counts required")
    for snapshot in (before, after):
        if type(snapshot) is not dict or any(type(rows) is not list or any(type(value) is not str or re.fullmatch("[0-9a-f]{64}", value) is None for value in rows) for rows in snapshot.values()):
            raise ValueError("Complete permanent-row hash multisets required")
    if set(after) != set(before) | set(additions):
        raise ValueError("Unexpected permanent relation inventory change")
    for name, hashes in before.items():
        if Counter(hashes) - Counter(after[name]):
            raise ValueError("A preexisting permanent row changed: " + name)
        if len(after[name]) - len(hashes) != changes.get(name, 0):
            raise ValueError("Source-declared row delta differs: " + name)
    for name, count in additions.items():
        if len(after[name]) != count:
            raise ValueError("New relation row effects differ: " + name)


class Installation:
    def __init__(self, view, evidence, layout, started):
        self.started = started
        self.deadline = self.started + TOTAL_SECONDS
        self.phase_end = self.started + WORK_SECONDS
        self.owner_end = None
        self.view, self.evidence, self.layout = view, evidence, layout
        self.project = evidence / "project"
        self.identity = "lrv_narcotics_" + uuid.uuid4().hex[:16]
        self.boot = None
        self.project_pins = None
        self.expected_module = None
        self.result = {"kind": "narcotics-forward-installation-only-v1", "passed": False,
                       "application_Auth_verified": False, "count_business_verified": False,
                       "all_ten_writers_verified": False, "authenticated_browser_verified": False,
                       "production_deployed": False, "hosted_writes": 0, "provider_requests": 0}

    def save(self, name, value):
        raw = (json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()
        target = self.evidence / (name + ".json")
        with target.open("xb") as stream:
            stream.write(raw)
        target.chmod(0o600)

    def remaining(self):
        end = min(self.phase_end, self.owner_end) if self.owner_end else self.phase_end
        left = end - time.monotonic()
        if left <= 0:
            raise TimeoutError("Original rehearsal phase deadline exhausted")
        return left

    def runner(self, argv, **kwargs):
        limit = min(kwargs.pop("timeout"), self.remaining())
        if "psql" in argv:
            limit = min(limit, OWNER_SECONDS)
        result = process.run(argv, timeout=limit, **kwargs)
        self.remaining()
        return result

    def query(self, label, sql):
        previous = self.owner_end
        self.owner_end = min(self.phase_end, time.monotonic() + OWNER_SECONDS)
        try:
            raw = self.boot.sql(sql)
            self.remaining()
            lines = [line for line in raw.splitlines() if line.strip()]
            if len(lines) != 1:
                raise ValueError("One complete JSON result required: " + label)
            value = decode(lines[0])
            self.save(label, value)
            return value
        finally:
            self.owner_end = previous

    def rows(self, label):
        return self.query(label, CONTROL + (HERE / "original-row-hashes.sql").read_text() + "ROLLBACK;\n")

    def project_sources(self):
        if self.project_pins is None:
            return
        directory = self.project / "supabase/migrations"
        actual = sorted(path.name for path in directory.glob("*.sql"))
        if actual != sorted(self.project_pins):
            raise ValueError("Complete owned project migration inventory changed")
        for name, wanted in self.project_pins.items():
            if sha(prefix.regular(directory / name)) != wanted:
                raise ValueError("Owned project migration copy changed: " + name)

    def ledger(self, expected):
        actual = self.query("forward-ledger", CONTROL + """
SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,
 'statement_count',cardinality(statements),
 'postgres_array_sha256',encode(sha256(convert_to(to_jsonb(statements)::text,'UTF8')),'hex'),
 'postgres_array_bytes',octet_length(to_jsonb(statements)::text))ORDER BY version),'[]'::jsonb)
FROM supabase_migrations.schema_migrations;ROLLBACK;
""")
        if canonical(actual) != canonical(expected):
            raise ValueError("Complete current CLI ledger differs from source framing")
        self.result["complete_source_derived208_ledger"] = True

    def prepare_migrations(self, migrations):
        for path in sorted((self.view / "supabase/migrations").glob("*.sql")):
            shutil.copyfile(path, migrations / path.name)
        self.project_pins = {Path(name).name: wanted for name, wanted in prefix.canonical206(self.view).items()}
        self.project_sources()

    def bootstrap_prefix(self, bootstrap):
        self.boot = bootstrap.Bootstrap(self.view, self.project, 206,
            "realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
            False, self.evidence / "bootstrap", self.runner)
        self.boot.execute()
        self.result["unchanged_canonical206_bootstrap"] = True
        # The unchanged 420-second bootstrap phase has finished. Subsequent
        # forward operations use this new rehearsal's original work deadline.
        self.boot.deadline = self.phase_end
        admission = bootstrap.admission(self.view)
        from secondary_review_ledger import load_frozen
        rows = load_frozen(self.view / prefix.CANDIDATE)["ledger"]
        binding = admission["binding206"]
        rows += [{"version": binding["version"], "name": binding["name"], "statements": binding["expected_statements"]}]
        expected = []
        for row in rows:
            native = json.dumps(row["statements"], ensure_ascii=False, separators=(", ", ": ")).encode("utf-8")
            expected.append({"version": row["version"], "name": row["name"],
                             "statement_count": len(row["statements"]),
                             "postgres_array_sha256": sha(native), "postgres_array_bytes": len(native)})
        return expected

    def execute(self):
        for port in (64660, 64661, 64662, 64664):
            with socket.socket() as sock:
                # A just-closed native transport control can leave TIME_WAIT.
                # Reuse permits that state, while a live listener still refuses
                # the bind. No SO_REUSEPORT or existing-service stop is used.
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind(("127.0.0.1", port))
        migrations = self.project / "supabase/migrations"
        migrations.mkdir(mode=0o700, parents=True)
        self.prepare_migrations(migrations)
        (self.project / "supabase/config.toml").write_text(f'''project_id = "{self.identity}"
[api]
port = 64661
[db]
port = 64662
shadow_port = 64660
major_version = 17
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
port = 64664
[auth]
site_url = "http://127.0.0.1:64661"
enable_signup = false
[storage]
enabled = true
[edge_runtime]
enabled = false
''')
        bootstrap = load("_narcotics_original_bootstrap", self.view / "scripts/owned_canonical_bootstrap.py")
        expected = self.bootstrap_prefix(bootstrap)
        original = self.rows("before207-permanent-rows")
        common = decode(prefix.regular(HERE / "common-expected.json"))
        for index, name in enumerate(prefix.FORWARD):
            source = ROOT / "supabase/migrations" / name
            shutil.copyfile(source, migrations / name)
            self.project_pins[name] = self.layout["migrations"][name]["sha256"]
            self.project_sources()
            self.owner_end = min(self.phase_end, time.monotonic() + OWNER_SECONDS)
            try:
                self.boot.verify()
                self.boot.command(["supabase", "migration", "up", "--local", "--workdir", str(self.project), "--experimental=false"], timeout=OWNER_SECONDS)
                self.remaining()
            finally:
                self.owner_end = None
            self.project_sources()
            current = self.rows("after" + str(207 + index) + "-permanent-rows")
            if index == 0:
                additions = {"controlled_review_v3." + key: int(key == "descriptor") for key in common["relations"]}
                preserve(original, current, {"supabase_migrations.schema_migrations": 1}, additions)
                actual = self.query("common-source-properties", CONTROL + "SELECT controlled_review_v3.snapshot();ROLLBACK;\n")
                if canonical(actual) != canonical(common):
                    raise ValueError("Common source properties differ")
                self.result["common269_source_properties"] = True
            else:
                preserve(original, current, {"supabase_migrations.schema_migrations": 1, "public.stock_writer_manifests": 10})
            original = current
            version, title = name[:-4].split("_", 1)
            framed = self.layout["migrations"][name]
            expected.append({"version": version, "name": title,
                             **{key: framed[key] for key in ("statement_count", "postgres_array_sha256", "postgres_array_bytes")}})
        self.ledger(expected)
        static = decode(prefix.regular(HERE / "module-expected.json"))
        self.expected_module = expectations.validate(static, self.query("complete-source-expected-properties", (HERE / "module-source-expected.sql").read_text()))
        self.result["complete_independent_source_reference_properties"] = True
        captured = self.query("full-module-properties", (HERE / "module-capture.sql").read_text())
        wanted = self.expected_module
        if captured["reference_absent"] is not True or canonical(captured["properties"]) != canonical(wanted["properties"]):
            raise ValueError("Complete final source properties differ")
        if canonical(captured["descriptor"]["definition"]) != canonical(wanted):
            raise ValueError("Complete source descriptor differs")
        pieces = ["'" + name + "',(SELECT count(*)FROM controlled_count_v1." + name + ")" for name in COUNT_TABLES]
        pieces += ["'journal',(SELECT count(*)FROM controlled_stock_workflow_v1.journal)",
                   "'witness_operations',(SELECT count(*)FROM controlled_stock_workflow_v1.witness_operations)"]
        initial = self.query("initial-count-state", CONTROL + "SELECT jsonb_build_object(" + ",".join(pieces) + ");ROLLBACK;\n")
        expected_initial = {name: int(name == "descriptor") for name in COUNT_TABLES}
        expected_initial.update(journal=0, witness_operations=0)
        if canonical(initial) != canonical(expected_initial):
            raise ValueError("New count and workflow tables contain unexpected seed data")
        self.result["new_count_tables_empty_except_source_descriptor"] = True
        self.result["full121_source_module_properties"] = True
        self.result["old_rows_preserved_exact_declared_additions_only"] = True
        self.boot.sql(bootstrap.SAFE_SQL)
        if self.boot.sql(bootstrap.DRAIN_SQL) != "t":
            raise ValueError("Owned scheduler containment changed")
        self.remaining()

    def cleanup(self):
        self.owner_end = None
        self.phase_end = min(self.deadline, time.monotonic() + CLEANUP_SECONDS)
        if self.boot is not None and self.boot.started:
            if not self.boot.record.get("failure_cleanup_complete"):
                self.boot.cleanup()
            if any(self.boot.inventory()):
                raise ValueError("Owned rehearsal resources remain")
        self.remaining()
        self.result["normal_owned_cleanup"] = True
        self.project_sources()
        self.result["copied_migrations_rechecked"] = True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check-source", action="store_true")
    mode.add_argument("--run-synthetic-local", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    started = time.monotonic()
    _, layout, pins = source_admission()
    if args.check_source:
        print(json.dumps({"source_files": len(pins), "database_operations": 0}))
        return
    execute_owned(layout, pins, started, Installation)


def execute_owned(layout, pins, started, installation_class):
    """One source-selected owned candidate; success includes normal cleanup."""
    if shutil.disk_usage(tempfile.gettempdir()).free < 4 * 1024 ** 3:
        raise RuntimeError("Owned rehearsal disk reserve unavailable")
    evidence = Path(tempfile.mkdtemp(prefix="lrv-narcotics-install-")).resolve()
    print("Owned installation evidence: " + str(evidence), flush=True)
    runtime = None
    errors = []
    try:
        with prefix.materialize() as (view, _):
            runtime = installation_class(view, evidence, layout, started)
            try:
                runtime.execute()
            except BaseException as error:
                errors.append(error)
                (evidence / "primary-failure.txt").write_text(traceback.format_exc())
            finally:
                try:
                    runtime.cleanup()
                except BaseException as error:
                    errors.append(error)
                    runtime.result["cleanup_failed"] = True
                    (evidence / "cleanup-failure.txt").write_text(traceback.format_exc())
        runtime.result["prefix_sources_rechecked"] = True
    except BaseException as error:
        errors.append(error)
        (evidence / "prefix-failure.txt").write_text(traceback.format_exc())
    try:
        prefix.verify_sources(ROOT, pins)
        if runtime is not None:
            runtime.result["source_rechecked"] = True
    except BaseException as error:
        errors.append(error)
        (evidence / "source-failure.txt").write_text(traceback.format_exc())
    elapsed = time.monotonic() - started
    if elapsed >= TOTAL_SECONDS:
        errors.append(TimeoutError("Original600 includes source admission, prefix, work and cleanup"))
    if runtime is not None:
        runtime.result["elapsed_seconds"] = elapsed
        runtime.result["passed"] = not errors
        runtime.result["failure_types"] = [type(error).__name__ for error in errors]
        runtime.save("result", runtime.result)
    if errors:
        if len(errors) == 1:
            raise errors[0]
        raise BaseExceptionGroup("Owned installation rehearsal failed", errors)
    if runtime is None:
        raise RuntimeError("Rehearsal was not constructed")
    print(json.dumps(runtime.result, sort_keys=True))


if __name__ == "__main__":
    main()
