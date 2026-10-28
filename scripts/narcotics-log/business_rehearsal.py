"""Fixed genuine-Auth business profiles on a fresh local 208-migration database."""
import argparse
from collections import Counter
from functools import partial
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import time
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
WORKFLOWS = HERE / "workflows"
sys.path.insert(0, str(HERE))
import install_rehearsal as installation


def source_admission():
    _, layout, pins = installation.source_admission()
    source = installation.decode(installation.prefix.regular(HERE / "business-source.json"))
    if source["kind"] != "narcotics-genuine-business-source-v1":
        raise ValueError("Fixed genuine business source inventory required")
    actual = {p.name for p in WORKFLOWS.iterdir() if p.is_file()}
    if actual != set(source["workflows"]) or any(not p.is_file() for p in WORKFLOWS.iterdir()):
        raise ValueError("Exact portable business source inventory required")
    for name, wanted in {**source["workflows"], "../business_rehearsal.py": source["runner"]}.items():
        path = (HERE / "business_rehearsal.py") if name == "../business_rehearsal.py" else WORKFLOWS / name
        if name != "../business_rehearsal.py" and Path(name).name != name:
            raise ValueError("Fixed portable module basename required")
        raw = installation.prefix.regular(path)
        if wanted != {"bytes": len(raw), "sha256": installation.sha(raw)}:
            raise ValueError("Portable business source changed: " + name)
        pins[str(path.relative_to(installation.ROOT))] = installation.sha(raw)
    pins[str((HERE / "business-source.json").relative_to(installation.ROOT))] = installation.sha(installation.prefix.regular(HERE / "business-source.json"))
    return layout, pins


def modules():
    # These are fixed package modules; no environment-controlled module root,
    # constructor override, old Runtime or arbitrary caller SQL is imported.
    sys.path.insert(0, str(WORKFLOWS))
    import auth_effects, identity_bootstrap, http_transport, owner_capture, sequence_effects, rest_defaults
    import full121_profiles, wc_profiles
    return SimpleNamespace(auth=auth_effects, identity=identity_bootstrap,
        transport=http_transport, capture=owner_capture, sequence=sequence_effects,
        profiles=full121_profiles, writers=wc_profiles, rest=rest_defaults)


class Runtime:
    """Verified owned receiver shared by actual Auth, HTTP and owner observers."""
    decode = staticmethod(installation.decode)

    def __init__(self, candidate):
        self.install = candidate
        self.folder = candidate.evidence
        self.project = candidate.project
        self.identity = candidate.identity
        services = candidate.boot.owned_resources()["containers"]
        self.owned_services = {row["id"]: {"name": "/" + name} for name, row in services.items()}
        self.query_index = 0

    def verify(self):
        return self.install.boot.verify()

    def remaining(self, limit):
        return min(limit, self.install.remaining())

    def command(self, argv):
        # Source-owned Auth inspection/status only; mutations use real HTTP.
        return SimpleNamespace(stdout=self.install.boot.command(argv, timeout=self.remaining(30)))

    def write(self, name, raw):
        if Path(name).name != name or type(raw) is not bytes:
            raise ValueError("Fixed private evidence basename and original bytes required")
        path = self.folder / name
        with path.open("xb") as stream:
            stream.write(raw)
        path.chmod(0o600)

    def raw_query(self, label, sql, stdout_cap=64 * 1024 * 1024):
        if not label or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for c in label):
            raise ValueError("Fixed private observer label required")
        initial = re.sub(r"\A(?:\s|--[^\n]*(?:\n|$))*", "", sql)
        if re.match(r"begin\b", initial, re.I) is None:
            sql = ("BEGIN;SET LOCAL search_path=pg_catalog,public,pg_temp;"
                   "SET LOCAL TimeZone='UTC';SET LOCAL DateStyle='ISO,YMD';"
                   "SET LOCAL IntervalStyle='postgres';SET LOCAL extra_float_digits=3;"
                   "SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s';\n"
                   + sql + "\nROLLBACK;\n")
        self.write(label + "-program.sql", sql.encode("utf-8"))
        started = time.monotonic()
        entry = self.verify()
        argv = ["docker", "--host", self.install.boot.endpoint, "exec", "-i", entry["Id"],
                "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres",
                "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"]
        self.write(label + "-command.json", json.dumps(argv).encode())
        try:
            result = installation.process.run(argv, input=sql, env=self.install.boot.env,
                cwd=self.folder, timeout=min(self.remaining(30), 30 - (time.monotonic() - started)), stdout_cap=stdout_cap)
        except BaseException as error:
            for channel in ("stdout", "stderr"):
                raw = getattr(error, channel, b"") or b""
                self.write(label + "-" + channel + ".bin", raw.encode("utf-8") if isinstance(raw, str) else bytes(raw))
            raise
        self.write(label + "-stdout.bin", result.stdout.encode("utf-8"))
        self.write(label + "-stderr.bin", result.stderr.encode("utf-8"))
        self.remaining(1)
        if time.monotonic() - started >= 30 or result.returncode != 0 or result.stderr:
            raise ValueError("Original owner30 observation failed: " + label)
        return result.stdout

    def query(self, sql):
        self.query_index += 1
        return self.raw_query("owner-" + str(self.query_index), sql)

    def selected_query(self, label, sql):
        raw = self.raw_query(label, sql)
        if not raw.endswith("\n") or "\n" in raw[:-1]:
            raise ValueError("One complete original owner JSON row required: " + label)
        return self.decode(raw[:-1])


def save(folder, name, value):
    if Path(name).name != name:
        raise ValueError("Fixed private business evidence basename required")
    path = folder / (name + ".json")
    with path.open("xb") as stream:
        stream.write((json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n").encode())
    path.chmod(0o600)


def password_b(http, original):
    status, signed = http.post("/auth/v1/token?grant_type=password",
        {"email": original["email"], "password": original["private_password"]})
    if status != 200 or signed["user"]["id"] != original["id"]:
        raise ValueError("Genuine same-B password grant failed")
    import base64
    token = signed["access_token"]
    pieces = token.split(".")
    if len(pieces) != 3:
        raise ValueError("Actual GoTrue token required")
    claims = installation.decode(base64.urlsafe_b64decode(pieces[1] + "=" * (-len(pieces[1]) % 4)))
    if claims.get("sub") != original["id"] or claims.get("role") != "authenticated":
        raise ValueError("Genuine same-B claims differ")
    return {**original, "token": token, "session_id": http_module_uuid(claims["session_id"]),
            "auth_amr": claims.get("amr"), "auth_aal": claims.get("aal"),
            "auth_last_sign_in_at": signed["user"]["last_sign_in_at"]}


def http_module_uuid(value):
    from uuid import UUID
    if type(value) is not str or str(UUID(value)) != value or UUID(value).int == 0:
        raise ValueError("Canonical genuine session identifier required")
    return value


def commissioning_parent_additions(grants):
    result = {}
    def add(count, *tables):
        for table in tables:
            if table in result:
                raise ValueError("Duplicate prospective relation effect")
            result[table] = count
    add(2, "auth.users", "auth.identities", "public.profiles")
    add(grants, "auth.sessions", "auth.refresh_tokens", "auth.mfa_amr_claims")
    add(2 + grants, "auth.audit_log_entries")
    add(3, "public.user_roles", "public.audit_logs", "public.controlled_stock_state_events")
    add(2, "public.controlled_stock_policy_versions", "public.controlled_stock_policy_sites")
    add(7, "controlled_review_v3.configuration", "controlled_review_v3.publications")
    add(1, "public.catalog_products", "public.inventory_lots", "public.inventory_movements",
        "public.stock_movement_sources", "public.stock_writer_admissions",
        "public.controlled_draft_entries", "public.controlled_draft_versions",
        "public.controlled_draft_reviews", "public.controlled_draft_actions",
        "public.controlled_stock_sites", "public.controlled_stock_locations",
        "public.controlled_stock_states", "public.controlled_stock_openings",
        "public.controlled_stock_opening_movements", "public.controlled_stock_containers",
        "public.controlled_stock_container_heads", "public.controlled_stock_cells",
        "public.controlled_stock_positions")
    return result


class BusinessInstallation(installation.Installation):
    def __init__(self, view, evidence, layout, started, *, profile):
        super().__init__(view, evidence, layout, started)
        self.profile = profile
        self.result["kind"] = "narcotics-genuine-business-profile-v1"
        self.result["profile"] = profile

    def execute(self):
        super().execute()
        m = modules()
        runtime = Runtime(self)
        save(self.evidence, "genuine-REST-source-defaults", m.rest.effective_defaults(runtime))
        save(self.evidence, "genuine-Auth-source-defaults", m.auth.effective_defaults(runtime))
        auth_before = m.auth.initial(runtime)
        sequence_before = runtime.selected_query("sequence-before", m.sequence.SQL)
        serial_source = runtime.selected_query("sequence-prerequisite", m.sequence.prerequisite_sql())
        m.sequence.initial(sequence_before, auth_before, serial_source)
        rows_before = self.rows("before-business-permanent-rows")
        status = installation.decode(runtime.command(["supabase", "status", "--workdir", str(self.project), "-o", "json"]).stdout)
        if status["API_URL"] != "http://127.0.0.1:64661":
            raise ValueError("Only the exact owned loopback API is admitted")
        http = m.transport.Http(runtime, self.evidence, status["ANON_KEY"], status["SERVICE_ROLE_KEY"])
        users = [m.transport.real_user(http, index) for index in (0, 1)]
        # The only owner-side identity write sets initial synthetic staff roles
        # for these actual GoTrue users. All stock and policies use HTTP.
        runtime.raw_query("fixed-initial-staff-bootstrap", m.identity.identity_fixture(users))
        context = {"users": users, "ids": {}, "http": http, "public_anon_key": status["ANON_KEY"]}
        methods = {"password_b": password_b, "full_capture": m.capture,
                   "full_components": None, "full_payload": None}
        proof = getattr(m.profiles, self.profile)(context, methods, runtime, self.evidence, runtime.selected_query, save)
        extras = [context["current_actors"][users[1]["id"]]] if self.profile == "count_agreement" else []
        auth = m.auth.validate(runtime, auth_before, users, extras)
        save(self.evidence, "genuine-Auth-complete-effects", auth)
        sequence_after = runtime.selected_query("sequence-after", m.sequence.SQL)
        save(self.evidence, "sequence-source-effects", m.sequence.final(sequence_before, sequence_after, 2 + len(extras)))
        rows_after = self.rows("after-business-permanent-rows")
        installation.preserve(rows_before, rows_after, commissioning_parent_additions(2 + len(extras)))
        captured = self.query("after-business-module-properties", (HERE / "module-capture.sql").read_text())
        wanted = installation.decode(installation.prefix.regular(HERE / "module-expected.json"))
        if captured["reference_absent"] is not True or installation.canonical(captured["properties"]) != installation.canonical(wanted["properties"]) or installation.canonical(captured["descriptor"]["definition"]) != installation.canonical(wanted):
            raise ValueError("Complete installed source properties changed during business work")
        save(self.evidence, "genuine-business-profile", proof)
        self.result.update(application_Auth_verified=True, original_parent_rows_verified=True,
            source_sequences_verified=True, business_profile_verified=True,
            count_business_verified=self.profile == "count_agreement")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check-source", action="store_true")
    mode.add_argument("--run-synthetic-local", action="store_true")
    parser.add_argument("--profile", choices=("commission_all", "count_agreement"), required=True)
    args = parser.parse_args()
    os.umask(0o077)
    started = time.monotonic()
    layout, pins = source_admission()
    if args.check_source:
        print(json.dumps({"source_files": len(pins), "database_operations": 0, "profile": args.profile}))
        return
    installation.execute_owned(layout, pins, started, partial(BusinessInstallation, profile=args.profile))


if __name__ == "__main__":
    main()
