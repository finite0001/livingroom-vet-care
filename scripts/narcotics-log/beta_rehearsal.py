"""Separately bound current beta acceptance; historical bindings remain unchanged.

The candidate manifest is source evidence, never runtime acceptance. Every run
rechecks its complete source closure after the unchanged owned cleanup guard.
Count profiles install the complete current source before application login.
Browser and recovery retain their original count-fixture preparation, then
install the current tail before their UI/restore exercise. They reuse exact
original protocol bytecode with
separately admitted current runtime and migration factories.
"""
import argparse
from functools import partial
import json
import os
from pathlib import Path
import sys
import time
from types import FunctionType, SimpleNamespace

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import business_rehearsal as business
import hosted_rehearsal as hosted
import operational_release as release
import operational_browser
import receiver_rehearsal
import receiver_auth
import beta_time_clock_source as clock_source
import beta_browser_source
import beta_release_source
import beta_cold_release
import beta_recovery_diagnostic

installation = business.installation
ROOT = installation.ROOT
MANIFEST = HERE / "picture-security-candidate-source.json"
PROFILES = ("commission_all", "count_agreement", "browser_lost_finalize", "ordinary_none", "record_review_signing",
            "independent_witness", "variance_reconciliation", "scalars", "clinical",
            "native_pickup_annotation", "native_return_v1", "native_return_v2_discrepancy")


def source_files():
    paths = set()
    for directory in ("src", "scripts/narcotics-log", "scripts/time-clock", "scripts/scheduling",
                      "tests/controlled-drugs", "supabase/migrations"):
        for path in (ROOT / directory).rglob("*"):
            if path.is_file() and "__pycache__" not in path.parts and path != MANIFEST:
                paths.add(path)
    for name in ("package.json", "package-lock.json", "scripts/owned_canonical_bootstrap.py",
                 "scripts/public-discovery.ts", "scripts/generate-sitemap.ts",
                 "tests/public-discovery/public-discovery.test.ts",
                 ".github/workflows/beta-candidate.yml", "docs/inventory/catalog-source.json",
                 "docs/inventory/living-room-vet-inventory-2026-11-10.xlsx",
                 "tests/inventory/catalog-setup-local.py", "tests/inventory/catalog-setup.test.ts",
                 "e2e/inventory.spec.ts", "tests/inventory/appointment-restock-local.py",
                 "tests/inventory/appointment-restock.test.ts", "tests/inventory/appointment_restock_http.py", "tests/restore/current-migration-guards.test.ts"):
        paths.add(ROOT / name)
    historical = installation.decode(installation.prefix.regular(ROOT / "tests/controlled-drugs/narcotics-finalize-browser-bindings.json"))
    paths.update(ROOT / name for name in historical["files"])
    return {str(path.relative_to(ROOT)): {"bytes": len(raw), "sha256": installation.sha(raw)}
            for path in sorted(paths) for raw in [installation.prefix.regular(path)]}


def capture_source():
    value = dict(kind="livingroom-beta-current-source-v1", database_operations=0,
                 runtime_acceptance=False, files=source_files())
    raw = (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()
    if MANIFEST.exists():
        if installation.prefix.regular(MANIFEST) != raw:
            raise ValueError("Differing current candidate already exists; preserve its evidence before creating a successor")
    else:
        with MANIFEST.open("xb") as stream:
            stream.write(raw)
        MANIFEST.chmod(0o600)
    return value


def admit_source():
    raw = installation.prefix.regular(MANIFEST)
    value = installation.decode(raw)
    if (set(value) != {"kind", "database_operations", "runtime_acceptance", "files"}
            or value["kind"] != "livingroom-beta-current-source-v1"
            or value["database_operations"] != 0 or value["runtime_acceptance"] is not False
            or value["files"] != source_files()):
        raise ValueError("Complete exact current beta source closure required")
    _, layout, pins = installation.source_admission()
    # The reviewed209 source admission still independently checks all of its
    # original SQL, parser and source construction contracts.
    release.pin_sources(pins)
    beta_browser_source.materialize()
    beta_release_source.materialize()
    current_sql, current_proof = clock_source.build()
    if (current_sql != installation.prefix.regular(ROOT / "supabase/migrations" / installation.prefix.BETA_MIGRATION)
            or current_proof != installation.decode(installation.prefix.regular(HERE / "beta-time-clock-source-proof.json"))):
        raise ValueError("Exact finite time-clock successor source required")
    pins.update({name: pin["sha256"] for name, pin in value["files"].items()})
    pins[str(MANIFEST.relative_to(ROOT))] = installation.sha(raw)
    return layout, pins


class BetaRuntime(business.Runtime):
    def verify_module(self, label):
        if not getattr(self.install, "beta_clock_installed", False):
            return super().verify_module(label)
        captured = self.install.query(label, (HERE / "module-capture.sql").read_text())
        original = self.install.expected_module
        family = source_family(self, label)
        expected = clock_source.expected_properties(original["properties"], family["body_sha256"])
        # Retain the historical decoded comparison as a supplemental check.
        # Lexical numeric equality comes from module-capture's initial exact G
        # invocation (full canonical comparison), bound below to independent
        # raw-source N/G and the unchanged canonical descriptor, not Python JSON.
        if (captured["reference_absent"] is not True
                or installation.canonical(captured["properties"]) != installation.canonical(expected)
                or installation.canonical(captured["descriptor"]["definition"]) != installation.canonical(original)):
            raise ValueError("Finite current successor differs or historical descriptor changed: " + label)
        # This observer never chooses an expectation. Exact body/cache text and
        # the historical descriptor must match the independent source reference.
        observed = self.selected_query(label + "-source-family", """
SELECT jsonb_build_object(
 'body',(SELECT prosrc FROM pg_proc WHERE oid='controlled_count_entry_v1.require_bound_module()'::regprocedure),
 'admission_count',(SELECT count(*) FROM beta_time_clock_v1.admission),
 'admission',(SELECT to_jsonb(a) FROM beta_time_clock_v1.admission a WHERE revision=1),
 'original_canonical_text',(SELECT definition::text FROM controlled_count_v1.descriptor WHERE revision=1));
""")
        wanted = dict(body=family["body"], admission_count=1,
            admission=dict(revision=1, original_descriptor_hash=family["original_descriptor_hash"],
                canonical_expectation=family["canonical_text"], guard_template=family["template_body"],
                require_bound_body_hash=family["body_sha256"]),
            original_canonical_text=self.install.expected_module_canonical_text)
        if observed != wanted:
            raise ValueError("Exact independently source-derived guard family required: " + label)


def source_expectation_envelope(sql):
    """Preserve original PostgreSQL numeric spelling across the JSON transport."""
    raw = installation.prefix.regular(HERE / "module-source-expected.sql")
    pins = installation.decode(installation.prefix.regular(HERE / "proof-data-pins.json"))
    pin = pins["files"]["module-source-expected.sql"]
    if len(raw) != pin["bytes"] or installation.sha(raw) != pin["sha256"] or sql != raw.decode():
        raise ValueError("Exact original source-reference program required")
    original = "SELECT pg_catalog.current_setting('lrv_narcotics_source.expected');"
    replacement = ("SELECT jsonb_build_object('canonical_text',"
                   "pg_catalog.current_setting('lrv_narcotics_source.expected'));")
    if sql.count(original) != 1 or replacement in sql:
        raise ValueError("One exact original canonical-reference result required")
    wrapped = sql.replace(original, replacement, 1)
    if wrapped.replace(replacement, original, 1) != sql:
        raise ValueError("Whole canonical-reference source inverse required")
    return wrapped


def derive_source_family(runtime, label, original_canonical_text):
    if not isinstance(original_canonical_text, str) or not original_canonical_text:
        raise ValueError("Lossless independently source-created canonical expectation required")
    projected = runtime.selected_query(label + "-source-expectation",
        clock_source.canonical_expectation_query(original_canonical_text))
    if (set(projected) != {"canonical_text", "sha256", "original_descriptor_hash"}
            or not isinstance(projected["canonical_text"], str)
            or not isinstance(projected["original_descriptor_hash"], str)):
        raise ValueError("Complete canonical source expectation required")
    family = clock_source.render_family(projected["canonical_text"])
    if (family["expected_hash"] != projected["sha256"]
            or len(projected["original_descriptor_hash"]) != 64
            or any(c not in "0123456789abcdef" for c in projected["original_descriptor_hash"])):
        raise ValueError("Independent source expectation digest differs")
    return {**family, "canonical_text": projected["canonical_text"],
            "original_descriptor_hash": projected["original_descriptor_hash"]}


def source_family(runtime, label):
    target = runtime.install
    original = getattr(target, "expected_module_canonical_text", None)
    retained = getattr(target, "beta_source_family", None)
    if retained is None or retained[0] != original:
        target.beta_source_family = (original, derive_source_family(runtime, label, original))
    return target.beta_source_family[1]


def current_modules():
    modules = business.modules()
    import beta_browser_runner
    modules.browser = beta_browser_runner
    modules.rest = SimpleNamespace(**{**vars(modules.rest), "effective_defaults": current_rest_defaults})
    return modules


def current_rest_defaults(runtime):
    target = runtime.install
    actual = getattr(target, "operational_ledger", None)
    if actual is None:
        if target.result.get("complete_source_derived209_ledger"):
            raise ValueError("Verified operational ledger missing before REST validation")
        return business.modules().rest.effective_defaults(runtime)
    expected = release.expected_ledger(target.operational_prefix_ledger,
        installation.decode(installation.prefix.regular(HERE / "operational-release.json")))
    if len(actual) not in (209, 210, 211, 212, 213, 214):
        raise ValueError("Exact verified current source ledger required before REST validation")
    for count, read_manifest in ((210, installation.prefix.beta210), (211, installation.prefix.beta211),
                                 (212, installation.prefix.catalog212), (213, installation.prefix.appointment_restock213),
                                 (214, installation.prefix.nonretryable_conflicts214)):
        if len(actual) >= count:
            manifest = read_manifest(ROOT)
            expected.append(dict(version=manifest["migration"][:14], name=manifest["migration"][15:-4],
                **{key: manifest["framing"][key] for key in ("statement_count", "postgres_array_sha256", "postgres_array_bytes")}))
    if actual != expected or any(not target.result.get("complete_source_derived" + str(count) + "_ledger")
                                 for count in range(209, len(actual) + 1)):
        raise ValueError("Exact verified current source ledger required before REST validation")
    # This retains the original strict validator and its single exact source
    # override. No arbitrary/extra hook or role configuration becomes allowed.
    return business.modules().rest.effective_defaults(runtime, recovery=True)


def current_policy_controls(runtime, profile):
    if profile in ("count_agreement", "browser_lost_finalize", "variance_reconciliation"):
        controls = runtime.selected_query("beta-genuine-policy-grammar-controls",
            installation.prefix.regular(HERE / "policy-reuse-controls.sql").decode())
        expected = dict(kind="historical-policy-grammar-controls-v1", cases=23,
            original_and_context_results_exact=True, captured_capability_decisions_recomputed=True,
            domain_writes=0, Auth_acceptance=False)
        if controls != expected:
            raise ValueError("All original23 policy grammar controls required after genuine policy publication")
    else:
        controls = runtime.selected_query("beta-no-policy-profile-control",
            "SELECT jsonb_build_object('policies',(SELECT count(*)FROM controlled_count_v1.policies),'snapshots',(SELECT count(*)FROM controlled_count_v1.snapshots));")
        if controls != dict(policies=0, snapshots=0):
            raise ValueError("Profile without policy publication must retain empty count policy/snapshot state")
    business.save(runtime.folder, "beta-genuine-policy-controls", controls)
    runtime.install.result["genuine_policy_grammar_controls"] = 23 if "cases" in controls else 0


def with_factories(function, factories):
    """Reuse exact protocol bytecode in an isolated, finite dependency namespace.

    No original module global is mutated. Defaults, lexical class/super closure,
    deadlines, cleanup and every protocol assertion remain the same objects.
    """
    allowed = {
        business.BusinessInstallation.execute: {"Runtime", "modules"},
        operational_browser.OperationalBrowser.execute: {"operational_release"},
        receiver_rehearsal.PopulatedRecovery.execute: {"operational_release", "business", "Receiver"},
    }
    if function not in allowed or set(factories) != allowed[function]:
        raise ValueError("Only explicitly reviewed current protocol factories may differ")
    namespace = {**function.__globals__, **factories}
    result = FunctionType(function.__code__, namespace, function.__name__, function.__defaults__, function.__closure__)
    result.__kwdefaults__ = function.__kwdefaults__
    return result


class CurrentBusiness(business.BusinessInstallation):
    execute = with_factories(business.BusinessInstallation.execute, {"Runtime": BetaRuntime, "modules": current_modules})

    def query(self, label, sql):
        if label != "complete-source-expected-properties":
            return super().query(label, sql)
        envelope = super().query(label + "-canonical", source_expectation_envelope(sql))
        if set(envelope) != {"canonical_text"} or not isinstance(envelope["canonical_text"], str):
            raise ValueError("One lossless canonical source-reference result required")
        self.expected_module_canonical_text = envelope["canonical_text"]
        value = installation.decode(self.expected_module_canonical_text)
        self.save(label, value)
        return value


def install210(runtime):
    target = runtime.install
    manifest = installation.prefix.beta210(ROOT)
    installation.process.run(["node", str(HERE / "frame-beta.mjs"), "--check"],
                             timeout=runtime.remaining(30), cwd=ROOT, check=True)
    expected = [*target.operational_ledger, dict(version=manifest["migration"][:14],
        name=manifest["migration"][15:-4], **{key: manifest["framing"][key]
        for key in ("statement_count", "postgres_array_sha256", "postgres_array_bytes")})]
    before = receiver_rehearsal.observe(runtime, "beta210-before-complete-data")
    destination = target.project / "supabase/migrations" / manifest["migration"]
    with destination.open("xb") as stream:
        stream.write(installation.prefix.regular(ROOT / "supabase/migrations" / manifest["migration"]))
    target.project_pins[manifest["migration"]] = manifest["framing"]["sha256"]
    target.project_sources()
    previous = target.owner_end
    target.owner_end = min(target.phase_end, time.monotonic() + installation.OWNER_SECONDS,
                           previous if previous is not None else target.phase_end)
    try:
        runtime.verify()
        target.boot.command(["supabase", "migration", "up", "--local", "--workdir", str(target.project),
                             "--experimental=false"], timeout=runtime.remaining(30))
    finally:
        target.owner_end = previous
    release.verify_ledger(runtime, expected, "beta210-complete-source-ledger")
    target.beta_clock_installed = True
    runtime.verify_module("beta210-exact-source-derived-controlled-successor")
    after = receiver_rehearsal.observe(runtime, "beta210-after-complete-data")
    installation.preserve(before["relations"], after["relations"], {"supabase_migrations.schema_migrations": 1},
                          {"beta_time_clock_v1.admission": 1})
    if before["sequences"] != after["sequences"]:
        raise ValueError("Beta210 changed an existing sequence")
    target.result.update(complete_source_derived210_ledger=True,
        beta210_only_three_reviewed_controlled_property_changes=True,
        beta210_original_controlled_descriptor_unchanged=True,
        beta210_original_rows_and_sequences_preserved=True)
    target.operational_ledger = expected
    target.project_sources()


def install211(runtime):
    target = runtime.install
    manifest = installation.prefix.beta211(ROOT)
    installation.process.run(["node", str(HERE / "frame-beta-appointment.mjs"), "--check"],
                             timeout=runtime.remaining(30), cwd=ROOT, check=True)
    if len(target.operational_ledger) != 210:
        raise ValueError("Complete independently verified210 source ledger required")
    expected = [*target.operational_ledger, dict(version=manifest["migration"][:14],
        name=manifest["migration"][15:-4], **{key: manifest["framing"][key]
        for key in ("statement_count", "postgres_array_sha256", "postgres_array_bytes")})]
    before = receiver_rehearsal.observe(runtime, "beta211-before-complete-data")
    destination = target.project / "supabase/migrations" / manifest["migration"]
    with destination.open("xb") as stream:
        stream.write(installation.prefix.regular(ROOT / "supabase/migrations" / manifest["migration"]))
    target.project_pins[manifest["migration"]] = manifest["framing"]["sha256"]
    target.project_sources()
    previous = target.owner_end
    target.owner_end = min(target.phase_end, time.monotonic() + installation.OWNER_SECONDS,
                           previous if previous is not None else target.phase_end)
    try:
        runtime.verify()
        target.boot.command(["supabase", "migration", "up", "--local", "--workdir", str(target.project),
                             "--experimental=false"], timeout=runtime.remaining(30))
    finally:
        target.owner_end = previous
    release.verify_ledger(runtime, expected, "beta211-complete-source-ledger")
    runtime.verify_module("beta211-retained-controlled-properties")
    after = receiver_rehearsal.observe(runtime, "beta211-after-complete-data")
    installation.preserve(before["relations"], after["relations"], {"supabase_migrations.schema_migrations": 1})
    if before["sequences"] != after["sequences"]:
        raise ValueError("Beta211 changed an existing sequence")
    target.operational_ledger = expected
    target.result.update(complete_source_derived211_ledger=True,
                         beta211_controlled_properties_rows_and_sequences_preserved=True)
    target.project_sources()


def install_additive_tail(runtime, count, label, manifest, frame, additions):
    """Apply a framed successor while preserving every existing row and sequence."""
    target = runtime.install
    installation.process.run(["node", str(HERE / frame), "--check"],
                             timeout=runtime.remaining(30), cwd=ROOT, check=True)
    if len(target.operational_ledger) != count - 1:
        raise ValueError(f"Complete independently verified{count - 1} source ledger required")
    expected = [*target.operational_ledger, dict(version=manifest["migration"][:14],
        name=manifest["migration"][15:-4], **{key: manifest["framing"][key]
        for key in ("statement_count", "postgres_array_sha256", "postgres_array_bytes")})]
    before = receiver_rehearsal.observe(runtime, f"{label}-before-complete-data")
    destination = target.project / "supabase/migrations" / manifest["migration"]
    with destination.open("xb") as stream:
        stream.write(installation.prefix.regular(ROOT / "supabase/migrations" / manifest["migration"]))
    target.project_pins[manifest["migration"]] = manifest["framing"]["sha256"]
    target.project_sources()
    previous = target.owner_end
    target.owner_end = min(target.phase_end, time.monotonic() + installation.OWNER_SECONDS,
                           previous if previous is not None else target.phase_end)
    try:
        runtime.verify()
        target.boot.command(["supabase", "migration", "up", "--local", "--workdir", str(target.project),
                             "--experimental=false"], timeout=runtime.remaining(30))
    finally:
        target.owner_end = previous
    release.verify_ledger(runtime, expected, f"{label}-complete-source-ledger")
    runtime.verify_module(f"{label}-retained-controlled-properties")
    after = receiver_rehearsal.observe(runtime, f"{label}-after-complete-data")
    installation.preserve(before["relations"], after["relations"],
        {"supabase_migrations.schema_migrations": 1},
        additions)
    if before["sequences"] != after["sequences"]:
        raise ValueError(f"{label} changed an existing sequence")
    target.operational_ledger = expected
    target.result.update({f"complete_source_derived{count}_ledger": True,
        f"{label}_controlled_properties_rows_and_sequences_preserved": True})
    target.project_sources()


def install212(runtime):
    install_additive_tail(runtime, 212, "catalog212", installation.prefix.catalog212(ROOT),
        "frame-beta-catalog.mjs", {"public.catalog_source_items": 217, "public.catalog_source_products": 0})


def install213(runtime):
    install_additive_tail(runtime, 213, "appointment_restock213", installation.prefix.appointment_restock213(ROOT),
        "frame-appointment-restock.mjs", {"public.treatment_appointment_events": 0, "public.inventory_restock_settings": 0})


def install214(runtime):
    install_additive_tail(runtime, 214, "nonretryable_conflicts214", installation.prefix.nonretryable_conflicts214(ROOT),
        "frame-nonretryable-conflicts.mjs", {})


class BetaBusiness(release.SourceLedger, CurrentBusiness, hosted.HostedHistoryInstallation):
    def __init__(self, *args, profile, current_tail=True):
        self.current_tail = current_tail
        super().__init__(*args, profile=profile)

    def after_installation(self, runtime):
        self.bootstrap_module = sys.modules[type(self.boot).__module__]
        status = installation.decode(runtime.command(["supabase", "status", "--workdir", str(self.project), "-o", "json"]).stdout)
        if status["API_URL"] != "http://127.0.0.1:64661":
            raise ValueError("Exact owned loopback source required")
        self.source_context = {"public_anon_key": status["ANON_KEY"]}
        beta_cold_release.install(runtime)
        if self.current_tail:
            install210(runtime)
            install211(runtime)
            install212(runtime)
            install213(runtime)
            install214(runtime)
        self.result["kind"] = "livingroom-beta" + ("214" if self.current_tail else "209") + "-genuine-business-profile-v1"

    def after_business(self, context, methods, runtime, proof):
        current_policy_controls(runtime, self.profile)

    cleanup = operational_browser.OperationalBrowser.cleanup


def current_tamper_controls(runtime):
    """Exercise live211 guard failures and prove transaction rollback, then run real Auth."""
    before = receiver_rehearsal.observe(runtime, "beta-tamper-before-data")
    auth_before = receiver_auth.capture(runtime, "beta-tamper-before-Auth")
    controls = (
        ("write-acl", "GRANT UPDATE ON public.time_entries TO authenticated;", "count_module_invalid"),
        ("private-schema", "GRANT USAGE ON SCHEMA beta_time_clock_v1 TO authenticated;", "beta_clock_admission_catalog_invalid"),
        ("private-table", "GRANT SELECT ON beta_time_clock_v1.admission TO authenticated;", "beta_clock_admission_catalog_invalid"),
        ("rls", "ALTER TABLE beta_time_clock_v1.admission DISABLE ROW LEVEL SECURITY;", "beta_clock_admission_catalog_invalid"),
        ("immutable-trigger", "ALTER TABLE beta_time_clock_v1.admission DISABLE TRIGGER immutable_admission;", "beta_clock_admission_immutability_invalid"),
        ("immutable-function", "CREATE OR REPLACE FUNCTION beta_time_clock_v1.immutable_admission()RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $replacement$BEGIN RETURN NULL;END$replacement$;", "beta_clock_admission_immutability_invalid"),
        ("admission-update", "UPDATE beta_time_clock_v1.admission SET original_descriptor_hash=repeat('b',64);", "beta_clock_admission_immutable"),
        ("admission-delete", "DELETE FROM beta_time_clock_v1.admission;", "beta_clock_admission_immutable"),
        ("admission-truncate", "TRUNCATE beta_time_clock_v1.admission;", "beta_clock_admission_immutable"),
        ("rehashed-admission", "ALTER TABLE beta_time_clock_v1.admission DISABLE TRIGGER immutable_admission;"
            "UPDATE beta_time_clock_v1.admission SET canonical_expectation="
            "(canonical_expectation::jsonb||jsonb_build_object('unreviewed_delta',true))::text;"
            "ALTER TABLE beta_time_clock_v1.admission ENABLE TRIGGER immutable_admission;", "beta_clock_admission_delta_invalid"),
    )
    for label, mutation, message in controls:
        # Every expected error aborts its inner subtransaction. A successful
        # mutation/guard call leaves observed=NULL and fails this outer block.
        program = ("DO $negative$ DECLARE observed text;BEGIN BEGIN " + mutation
            + "PERFORM controlled_count_entry_v1.require_bound_module();"
            + "EXCEPTION WHEN OTHERS THEN observed:=SQLERRM;END;"
            + "IF observed IS DISTINCT FROM " + clock_source.literal(message)
            + " THEN RAISE EXCEPTION 'beta_expected_guard_refusal_missing';END IF;"
            + "PERFORM controlled_count_entry_v1.require_bound_module();END $negative$;")
        runtime.raw_query("beta-current-tamper-" + label, program)
    runtime.verify_module("beta-tamper-restored-complete-module")
    if (receiver_rehearsal.observe(runtime, "beta-tamper-after-data") != before
            or receiver_auth.capture(runtime, "beta-tamper-after-Auth") != auth_before):
        raise ValueError("Current guard refusal changed complete rows, sequences or Auth")
    business.save(runtime.folder, "beta-current-tamper-rollback", dict(
        kind="current211-live-guard-rollback-v1", cases=len(controls),
        actual_controlled_guard=True, complete_rows_sequences_Auth_unchanged=True,
        original_descriptor_unchanged=True, engineering_control=True))
    runtime.install.result["current211_live_tamper_rollback_verified"] = True


class BetaTamperRollback(BetaBusiness):
    def __init__(self, *args):
        super().__init__(*args, profile="count_agreement")

    def after_installation(self, runtime):
        super().after_installation(runtime)
        current_tamper_controls(runtime)


def install_current_release(runtime):
    release.install(runtime)
    install210(runtime)
    install211(runtime)
    install212(runtime)
    install213(runtime)
    install214(runtime)


class BetaReceiver(receiver_rehearsal.Receiver):
    def __init__(self, source, evidence):
        super().__init__(source, evidence)
        self.beta_clock_installed = source.beta_clock_installed
        self.expected_module_canonical_text = source.expected_module_canonical_text
        self.beta_source_family = getattr(source, "beta_source_family", None)


class BetaOperationalBrowser(operational_browser.OperationalBrowser, CurrentBusiness, hosted.HostedHistoryInstallation):
    execute = with_factories(operational_browser.OperationalBrowser.execute,
        {"operational_release": SimpleNamespace(install=install_current_release)})


class BetaRecovery(receiver_rehearsal.PopulatedRecovery, CurrentBusiness, hosted.HostedHistoryInstallation):
    execute = with_factories(receiver_rehearsal.PopulatedRecovery.execute,
        {"operational_release": SimpleNamespace(install=install_current_release, verify_ledger=release.verify_ledger),
         "business": SimpleNamespace(**{**vars(business), "Runtime": BetaRuntime}), "Receiver": BetaReceiver})


def install_diagnostic_release(runtime):
    # Preserve the explicitly historical211 engineering-only diagnostic.
    release.install(runtime)
    install210(runtime)
    install211(runtime)
    beta_recovery_diagnostic.bind(runtime)
    context = runtime.install.source_context
    context["http"] = beta_recovery_diagnostic.TimedHttp(context["http"], runtime)


class BetaRecoveryDiagnostic(BetaRecovery):
    protocol = with_factories(receiver_rehearsal.PopulatedRecovery.execute,
        {"operational_release": SimpleNamespace(install=install_diagnostic_release, verify_ledger=release.verify_ledger),
         "business": SimpleNamespace(**{**vars(business), "Runtime": BetaRuntime}), "Receiver": BetaReceiver})

    def execute(self):
        try:
            self.protocol()
        except BaseException as error:
            if beta_recovery_diagnostic.preserve_failure(self):
                raise beta_recovery_diagnostic.DiagnosticComplete() from error
            raise
        finally:
            self.result.update(engineering_only=True, current211_normal_acceptance=False,
                application_Auth_verified=False, business_profile_verified=False, count_business_verified=False,
                authenticated_browser_verified=False, populated_receiver_verified=False)
        raise RuntimeError("Engineering tracing cannot grant normal current211 acceptance")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--capture-source", action="store_true")
    modes.add_argument("--check-source", action="store_true")
    modes.add_argument("--run-synthetic-local", action="store_true")
    parser.add_argument("--profile", choices=(*PROFILES, "hosted-release209", "operational-browser", "populated-recovery", "current-tamper-rollback", "recovery-diagnostic"))
    args = parser.parse_args()
    os.umask(0o077)
    if args.capture_source:
        value = capture_source()
        print(json.dumps(dict(source_files=len(value["files"]), database_operations=0, runtime_acceptance=False)))
        return
    started = time.monotonic()
    layout, pins = admit_source()
    if args.check_source:
        print(json.dumps(dict(source_files=len(pins), database_operations=0, runtime_acceptance=False)))
        return
    if args.profile is None:
        parser.error("--run-synthetic-local requires --profile")
    factory = (BetaRecoveryDiagnostic if args.profile == "recovery-diagnostic" else
               BetaTamperRollback if args.profile == "current-tamper-rollback" else
               BetaOperationalBrowser if args.profile == "operational-browser" else
               BetaRecovery if args.profile == "populated-recovery" else
               partial(BetaBusiness, profile="count_agreement", current_tail=False) if args.profile == "hosted-release209" else
               partial(BetaBusiness, profile=args.profile))
    source_hash = pins[str(MANIFEST.relative_to(ROOT))]

    def bound_factory(*arguments):
        runtime = factory(*arguments)
        runtime.result.update(beta_candidate_source_sha256=source_hash, beta_candidate_profile=args.profile)
        return runtime

    try:
        installation.execute_owned(layout, pins, started, bound_factory)
    except beta_recovery_diagnostic.DiagnosticComplete:
        if args.profile != "recovery-diagnostic":
            raise
        # A cleanup/deadline/source ExceptionGroup is deliberately not caught.
        # The persisted runner receipt remains passed=false, engineering_only.
        print(json.dumps(dict(engineering_native_error_captured=True, normal_acceptance=False)))


if __name__ == "__main__":
    main()
