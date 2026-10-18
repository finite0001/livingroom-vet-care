"""Fixed fictional call provider runner. Preparation is offline; --run requires exact
reviewed candidate, external billing/token bounds and explicit expense authorization.
No generation resume. --cleanup-only may remove only this run's owned resources.
"""
from __future__ import annotations
import argparse
import base64
from datetime import datetime, timezone
from fractions import Fraction
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PROJECT = "kothoqicubowyhwfsrte"
BUNDLE = "9127a1ce40add23f6e92f92cb1fef5501e380e84f012b774f70e024ac8925a42"
VERSION = "lrv-call-provider-candidate-v2"
CASES = list("ABCDEFGHIJ")
PROVIDER_TIMEOUT_MS = 60000
GUARD_TIMEOUT_MS = 10000
DECIMAL = re.compile(r"(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,12})?\Z")
HEX = re.compile(r"[a-f0-9]{64}\Z")


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def packed(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def timestamp_ms(value: str) -> int:
    if not isinstance(value, str) or not re.search(r"(?:Z|[+-][0-9]{2}:[0-9]{2})$", value):
        raise ValueError("explicit_timezone_required")
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def strict(value, fields):
    if not isinstance(value, dict) or set(value) != set(fields):
        raise ValueError("unexpected_input_fields")
    return value


def text(value, maximum=4000):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError("nonempty_review_text_required")
    return value


def sha_text(value):
    if not isinstance(value, str) or not HEX.fullmatch(value):
        raise ValueError("sha256_required")
    return value


def decimal(value):
    if not isinstance(value, str) or not DECIMAL.fullmatch(value):
        raise ValueError("exact_nonnegative_decimal_string_required")
    return Fraction(value)


def integer(value, minimum=0, maximum=10**9):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("bounded_integer_required")
    return value


def fraction_receipt(value: Fraction):
    return {"numerator": str(value.numerator), "denominator": str(value.denominator)}


def reserve_micros(value: Fraction) -> int:
    scaled = value * 1000000
    return (scaled.numerator + scaled.denominator - 1) // scaled.denominator


def save(path: Path, value, exclusive=True):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if exclusive:
        temporary = path
        stream = temporary.open("x", encoding="utf-8")
    else:
        stream = tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", prefix=path.name + ".writing-", dir=path.parent, delete=False)
        temporary = Path(stream.name)
    with stream:
        os.chmod(temporary, 0o600)
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n"); stream.flush(); os.fsync(stream.fileno())
    if not exclusive: os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_RDONLY)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)


def read_json(path: Path):
    raw = path.read_bytes()
    if len(raw) > 32000000:
        raise ValueError("private_input_too_large")
    return json.loads(raw)


def local_bundle_plan(bundle: Path):
    result = subprocess.run(["node", "--experimental-strip-types", "tests/clinical-calls/synthetic-provider-plan.ts", str(bundle.resolve())], cwd=ROOT, capture_output=True, timeout=60)
    if result.returncode:
        raise ValueError("offline_bundle_or_transport_source_validation_failed")
    return json.loads(result.stdout)


def evidence(value):
    strict(value, ("reviewer", "reviewed_at", "valid_until", "evidence_sha256", "explanation"))
    text(value["reviewer"], 200)
    if timestamp_ms(value["reviewed_at"]) > timestamp_ms(value["valid_until"]):
        raise ValueError("external_review_time_order_invalid")
    sha_text(value["evidence_sha256"])
    text(value["explanation"])
    return value


def calculate_admission(profile, frozen, expires_at_ms):
    """Trust explicitly supplied external reviews, never infer or claim verification."""
    strict(profile, ("contract", "currency", "model", "request_service_tier", "budget_usd", "per_case_margin_usd", "applicable_tiers", "input_bounds", "billable_output_tokens_upper", "input_metering_review", "tier_coverage_review", "output_metering_review", "other_cost_review", "pricing_review"))
    if profile["contract"] != "lrv-call-provider-reviewed-budget-v1" or profile["currency"] != "USD" or profile["model"] != "gpt-6-luna" or profile["request_service_tier"] != "unpinned":
        raise ValueError("fixed_model_currency_unpinned_tier_required")
    ceiling, margin = decimal(profile["budget_usd"]), decimal(profile["per_case_margin_usd"])
    if ceiling <= 0 or ceiling * 1000000 != int(ceiling * 1000000):
        raise ValueError("positive_microdollar_budget_required")
    output_bound = integer(profile["billable_output_tokens_upper"], 8000, 128000)
    for name in ("input_metering_review", "tier_coverage_review", "output_metering_review", "other_cost_review", "pricing_review"):
        reviewed = evidence(profile[name])
        if timestamp_ms(reviewed["reviewed_at"]) > expires_at_ms or timestamp_ms(reviewed["valid_until"]) < expires_at_ms:
            raise ValueError("external_review_expires_before_probe")
    tiers = profile["applicable_tiers"]
    if not isinstance(tiers, list) or not 1 <= len(tiers) <= 20:
        raise ValueError("explicit_applicable_tiers_required")
    names = set()
    for tier in tiers:
        strict(tier, ("name", "input_usd_per_million_upper", "output_usd_per_million_upper", "other_usd_per_request_upper", "evidence_sha256"))
        name = text(tier["name"], 100)
        if name in names:
            raise ValueError("duplicate_applicable_tier")
        names.add(name)
        sha_text(tier["evidence_sha256"])
        for field in ("input_usd_per_million_upper", "output_usd_per_million_upper", "other_usd_per_request_upper"):
            decimal(tier[field])
    bounds = profile["input_bounds"]
    if not isinstance(bounds, list) or len(bounds) != 10 or [b.get("case_id") for b in bounds] != CASES:
        raise ValueError("ten_exact_ordered_input_bounds_required")
    reservations = []
    for case, bound in zip(frozen["cases"], bounds, strict=True):
        strict(bound, ("case_id", "request_sha256", "billable_input_tokens_upper", "review"))
        if bound["case_id"] != case["id"] or bound["request_sha256"] != case["request_sha256"]:
            raise ValueError("input_bound_request_differs")
        token_bound = integer(bound["billable_input_tokens_upper"], 1, 1050000)
        review = evidence(bound["review"])
        if timestamp_ms(review["reviewed_at"]) > expires_at_ms or timestamp_ms(review["valid_until"]) < expires_at_ms:
            raise ValueError("input_bound_review_expired")
        if case["maximum_output_tokens"] != 8000:
            raise ValueError("frozen_output_cap_differs")
        worst = max(Fraction(token_bound, 1000000) * decimal(tier["input_usd_per_million_upper"])
                    + Fraction(output_bound, 1000000) * decimal(tier["output_usd_per_million_upper"])
                    + decimal(tier["other_usd_per_request_upper"]) for tier in tiers) + margin
        reservations.append({"id": case["id"], "request_sha256": case["request_sha256"], "upper_usd_exact": fraction_receipt(worst), "reserved_usd_micros": reserve_micros(worst)})
    reserved = sum(case["reserved_usd_micros"] for case in reservations)
    ceiling_micros = int(ceiling * 1000000)
    if reserved > ceiling_micros:
        raise ValueError("worst_case_reservations_exceed_budget")
    return {"contract": "lrv-call-provider-admission-v1", "profile_sha256": digest(packed(profile)),
            "budget_usd_micros": ceiling_micros, "reserved_usd_micros": reserved, "cases": reservations,
            "limitation": "Calculated admission bound relies on externally supplied metering, tier coverage and rates. Not a provider-enforced hard billing cap; no verification or expense authorization is inferred."}


def freeze_candidate(bundle: Path, ticket: str, expires_at: str, operator_token_sha256: str, profile=None):
    sha_text(operator_token_sha256)
    if not isinstance(ticket, str) or not re.fullmatch(r"[a-f0-9]{20}", ticket):
        raise ValueError("explicit_fixed_ticket_required")
    expires = timestamp_ms(expires_at)
    frozen = local_bundle_plan(bundle)
    if frozen["staging_project"] != PROJECT or frozen["bundle_sha256"] != BUNDLE or [c["id"] for c in frozen["cases"]] != CASES:
        raise ValueError("fixed_staging_frozen_bundle_required")
    admission = calculate_admission(profile, frozen, expires) if profile is not None else None
    base = {**frozen, "contract": VERSION, "ticket": ticket, "expires_at_ms": expires,
            "provider_timeout_ms": PROVIDER_TIMEOUT_MS, "guard_timeout_ms": GUARD_TIMEOUT_MS,
            "maximum_paid_requests": 10, "operator_token_sha256": operator_token_sha256, "guard_bucket": "call-eval-" + ticket,
            "function_names": ["call-eval-" + ticket + "-" + c.lower() for c in CASES],
            "object_paths": [c + ".lock" for c in CASES], "jwt_verification_required": True,
            "admission": admission, "admission_sha256": digest(packed(admission)) if admission is not None else None,
            "external_price_profile": profile, "expense_authorization": None,
            "paid_execution_ready": False,
            "pending": (["external_price_metering_tier_input_bounds"] if admission is None else []) + ["specific_expense_authorization", "protected_hosted_preflight"],
            "hosted_operations": 0, "provider_requests": 0}
    template = (ROOT / "tests/clinical-calls/synthetic-provider-probe.ts.in").read_text()
    sources = {}
    for case, name in zip(base["cases"], base["function_names"], strict=True):
        fixed = {**case, "ticket": ticket, "bundle_sha256": BUNDLE, "expires_at_ms": expires,
                 "provider_timeout_ms": PROVIDER_TIMEOUT_MS, "guard_timeout_ms": GUARD_TIMEOUT_MS,
                 "transport_source_sha256": frozen["transport_source_sha256"], "guard_bucket": base["guard_bucket"],
                 "guard_object": case["id"] + ".lock", "operator_token_sha256": operator_token_sha256, "admission_sha256": base["admission_sha256"]}
        sources[name] = template.replace("__FIXED__", json.dumps(fixed, ensure_ascii=True, separators=(",", ":"))).encode()
    base["probe_source_sha256"] = {name: digest(data) for name, data in sources.items()}
    base["candidate_sha256"] = digest(packed(base))
    return base, sources


def prepare(bundle: Path, output: Path, ticket: str, expires_at: str, profile=None):
    output.mkdir(mode=0o700)
    operator_token = secrets.token_urlsafe(32)
    plan, sources = freeze_candidate(bundle, ticket, expires_at, digest(operator_token.encode()), profile)
    save(output / "operator-receipt.json", {"ticket": ticket, "operator_token": operator_token, "operator_token_sha256": plan["operator_token_sha256"]})
    save(output / "plan.json", plan)
    (output / "bundle.json").write_bytes(bundle.read_bytes())
    os.chmod(output / "bundle.json", 0o600)
    shared = output / "supabase/functions/_shared"
    shared.mkdir(parents=True, mode=0o700)
    for relative in plan["source_sha256"]:
        if "/_shared/" in relative:
            target = shared / Path(relative).name
            target.write_bytes((ROOT / relative).read_bytes())
            os.chmod(target, 0o600)
    config = output / "supabase/config.toml"
    config.write_text('project_id = "' + PROJECT + '"\n' + "\n".join('[functions."' + name + '"]\nverify_jwt = true\n' for name in plan["function_names"]))
    os.chmod(config, 0o600)
    for name, data in sources.items():
        target = output / "supabase/functions" / name
        target.mkdir(mode=0o700)
        (target / "index.ts").write_bytes(data)
        os.chmod(target / "index.ts", 0o600)
        for filename in ("deno.json", "deno.lock"):
            shutil.copyfile(ROOT / "supabase/functions/clinical-call-note-process" / filename, target / filename)
            os.chmod(target / filename, 0o600)
    return plan


def validate_candidate(plan, bundle: Path):
    expected, _ = freeze_candidate(bundle, plan.get("ticket"), datetime.fromtimestamp(integer(plan.get("expires_at_ms"), 0, 10**15) / 1000, timezone.utc).isoformat(), plan.get("operator_token_sha256"), plan.get("external_price_profile"))
    if plan != expected:
        raise ValueError("candidate_source_request_price_or_generated_probe_changed")
    return expected


def authorize_candidate(plan, bundle: Path, authorization, clock=now_ms):
    validate_candidate(plan, bundle)
    if plan["admission"] is None:
        raise ValueError("priced_metered_reviewed_candidate_required")
    strict(authorization, ("contract", "candidate_sha256", "bundle_sha256", "ticket", "staging_project", "requested_model", "maximum_paid_requests", "budget_usd_micros", "approved_by", "approved_at", "scope", "billing_limitation_acceptance", "staging_resource_cost_scope"))
    expected = {"contract": "lrv-call-provider-expense-authorization-v1", "candidate_sha256": plan["candidate_sha256"], "bundle_sha256": BUNDLE,
                "ticket": plan["ticket"], "staging_project": PROJECT, "requested_model": "gpt-6-luna", "maximum_paid_requests": 10,
                "budget_usd_micros": plan["admission"]["budget_usd_micros"], "scope": "ten_fixed_requests_no_retry_temporary_staging_probes_and_guard"}
    if any(authorization.get(k) != v for k, v in expected.items()):
        raise ValueError("specific_expense_authorization_differs")
    for field in ("approved_by", "billing_limitation_acceptance", "staging_resource_cost_scope"):
        text(authorization[field])
    approved_at = timestamp_ms(authorization["approved_at"])
    current = clock()
    reviews = [plan["external_price_profile"][name] for name in ("input_metering_review", "tier_coverage_review", "output_metering_review", "other_cost_review", "pricing_review")] + [bound["review"] for bound in plan["external_price_profile"]["input_bounds"]]
    if any(timestamp_ms(review["reviewed_at"]) > current for review in reviews):
        raise ValueError("external_review_not_yet_performed")
    if approved_at > current or current >= plan["expires_at_ms"] or plan["expires_at_ms"] - current > 60 * 60000:
        raise ValueError("fixed_authorization_expiry_window_invalid")
    if plan["expires_at_ms"] - current < 10 * (PROVIDER_TIMEOUT_MS + GUARD_TIMEOUT_MS) + 60000:
        raise ValueError("fixed_expiry_insufficient_for_ten_cases")
    return {"contract": "lrv-call-provider-reviewed-admission-v1", "candidate_sha256": plan["candidate_sha256"],
            "authorization_sha256": digest(packed(authorization)), "admission": plan["admission"], "paid_execution_ready": True,
            "pending": ["protected_hosted_preflight"], "provider_requests": 0, "hosted_operations": 0}


def reserve_case(ledger, plan, case_id):
    """Caller must persist journal before invoking; unknown calls never refund."""
    strict(ledger, ("consumed", "reserved_usd_micros", "states", "stopped"))
    if type(ledger["stopped"]) is not bool or ledger["stopped"] or not isinstance(ledger["consumed"], list) or ledger["consumed"] != CASES[:len(ledger["consumed"])]:
        raise ValueError("stopped_or_invalid_fixed_order_ledger")
    used = integer(ledger["reserved_usd_micros"])
    if plan.get("admission") is None or len(ledger["consumed"]) >= 10 or case_id != CASES[len(ledger["consumed"])]:
        raise ValueError("unpriced_or_consumed_case")
    if not isinstance(ledger["states"], dict) or set(ledger["states"]) != set(ledger["consumed"]):
        raise ValueError("ledger_state_membership_differs")
    expected_used = sum(c["reserved_usd_micros"] for c in plan["admission"]["cases"] if c["id"] in ledger["consumed"])
    if used != expected_used:
        raise ValueError("ledger_reservation_tampered")
    if any(state not in ("response_complete",) for state in ledger["states"].values()):
        raise ValueError("previous_case_not_confirmed_complete_no_resume")
    reservation = next(c["reserved_usd_micros"] for c in plan["admission"]["cases"] if c["id"] == case_id)
    if used + reservation > plan["admission"]["budget_usd_micros"]:
        raise ValueError("admission_budget_exhausted")
    ledger["consumed"].append(case_id)
    ledger["reserved_usd_micros"] += reservation
    ledger["states"][case_id] = "may_have_dispatched"
    return ledger


def record_outcome(ledger, case_id, receipt):
    if not ledger["consumed"] or ledger["consumed"][-1] != case_id or ledger["states"].get(case_id) != "may_have_dispatched":
        raise ValueError("outcome_not_for_pending_fixed_case")
    state = text(receipt.get("state"), 100)
    safe_complete = state == "response_complete" and receipt.get("response_complete") is True and receipt.get("uncertain") is False
    ledger["states"][case_id] = state
    if not safe_complete:
        ledger["stopped"] = True
    # Never reduce the reservation, including known zero-call guard refusals.
    return ledger


def validate_transport_body(receipt):
    """Pure body validation, without creating references to not-yet-finalized sidecars."""
    if receipt.get("state") != "response_complete" or receipt.get("response_complete") is not True:
        return None
    raw = base64.b64decode(receipt.get("raw_body_base64", ""), validate=True)
    if base64.b64encode(raw).decode() != receipt.get("raw_body_base64"):
        raise ValueError("complete_response_base64_not_canonical")
    if len(raw) > 512000 or digest(raw) != receipt.get("raw_body_sha256") or receipt.get("retained_bytes") != len(raw):
        raise ValueError("complete_response_byte_evidence_differs")
    status = integer(receipt.get("http_status"), 100, 599)
    return {"kind": "http", "status": status, "request_id": (receipt.get("provider_request_id") or "") if not receipt.get("provider_request_id_truncated") else "", "raw_body_base64": receipt["raw_body_base64"]}


def bridge_outcomes(plan, receipts, sidecar_paths=None):
    """All ten outcomes survive; caller finalizes immutable canonical sidecars before export."""
    if len(receipts) != 10 or [c.get("id") for c in receipts] != CASES:
        raise ValueError("ten_exact_case_receipts_required")
    cases = []
    for case, receipt in zip(plan["cases"], receipts, strict=True):
        if receipt.get("request_sha256") != case["request_sha256"]:
            raise ValueError("outcome_request_differs")
        outcome = validate_transport_body(receipt)
        if outcome is None:
            sidecar = digest(packed(receipt))
            filename = sidecar_paths[case["id"]] if sidecar_paths is not None else "case-" + case["id"] + "-transport.json"
            if not re.fullmatch("case-" + case["id"] + r"-transport(?:-[a-f0-9]{64})?\.json", filename):
                raise ValueError("owned_sidecar_filename_required")
            outcome = {"kind": "transport_error", "error": "Incomplete/non-dispatched synthetic outcome: " + text(receipt.get("state"), 100) + "; retain private " + filename + " sidecar SHA256 " + sidecar + ". No retry."}
        cases.append({"case_id": case["id"], "request_sha256": case["request_sha256"], "outcome": outcome})
    return {"contract": "lrv-call-fidelity-raw-v1", "bundle_sha256": BUNDLE, "cases": cases}


def cleanup(plan, receipt, transport, clock=now_ms):
    """Injected nonclinical management/storage interface; no default hosted implementation."""
    allowed = set(plan["function_names"])
    attempted = receipt.get("deployment_attempted", [])
    if len(attempted) != len(set(attempted)) or not set(attempted) <= allowed:
        raise ValueError("cleanup_owned_names_differ")
    result = {"function_absence_confirmed": False, "guard_removed": False, "complete": False, "errors": [],
              "baseline_functions_unchanged": False, "baseline_secrets_unchanged": False, "baseline_storage_unchanged": False,
              "data_preservation_scope": "No clinical API/SQL operations in fixed source; no row-for-row data equality proof or credential-level denial."}
    for name in attempted:
        try:
            transport.delete_function(name)
        except Exception:
            result["errors"].append("function_delete_receipt_unconfirmed:" + name)
    try:
        functions = transport.list_functions()
        result["function_absence_confirmed"] = not any(row["name"] in allowed for row in functions)
        unchanged = [row for row in functions if row["name"] not in allowed]
        result["baseline_functions_unchanged"] = digest(packed(sorted(unchanged, key=lambda r: r["name"]))) == receipt["baseline"]["functions_sha256"]
    except Exception:
        result["errors"].append("function_absence_or_baseline_unconfirmed")
    safe_after = plan["expires_at_ms"] + PROVIDER_TIMEOUT_MS + GUARD_TIMEOUT_MS
    result["guard_safe_removal_after_ms"] = safe_after
    if result["function_absence_confirmed"] and clock() >= safe_after:
        try:
            for path in plan["object_paths"]:
                transport.delete_guard_object(plan["guard_bucket"], path)
            transport.delete_guard_bucket(plan["guard_bucket"])
        except Exception:
            result["errors"].append("guard_delete_receipt_unconfirmed")
    else:
        result["errors"].append("guard_retained_until_confirmed_function_absence_and_expiry")
    try:
        buckets = transport.list_buckets()
        result["guard_removed"] = not any(row["name"] == plan["guard_bucket"] for row in buckets)
        result["baseline_storage_unchanged"] = digest(packed(sorted([row for row in buckets if row["name"] != plan["guard_bucket"]], key=lambda r: r["name"]))) == receipt["baseline"]["storage_sha256"]
        # Interface is metadata-only names + digests, never plaintext secret values.
        secrets = transport.list_secret_metadata()
        if any(set(row) != {"name", "digest"} or not HEX.fullmatch(row["digest"]) for row in secrets):
            raise ValueError("secret_digest_metadata_only")
        result["baseline_secrets_unchanged"] = digest(packed(sorted(secrets, key=lambda r: r["name"]))) == receipt["baseline"]["secrets_sha256"]
    except Exception:
        result["errors"].append("storage_or_secret_preservation_unconfirmed")
    result["complete"] = clock() >= safe_after and all(result[k] for k in ("function_absence_confirmed", "guard_removed", "baseline_functions_unchanged", "baseline_secrets_unchanged", "baseline_storage_unchanged"))
    return result


def main(argv=None):
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--ticket")
    parser.add_argument("--expires-at")
    parser.add_argument("--price-profile", type=Path)
    parser.add_argument("--plan", type=Path)
    parser.add_argument("--authorization", type=Path)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--prepare", action="store_true")
    action.add_argument("--finalize-admission", action="store_true")
    action.add_argument("--run", action="store_true")
    action.add_argument("--cleanup-only", action="store_true")
    args = parser.parse_args(argv)
    if args.run or args.cleanup_only:
        if not args.plan or not args.bundle or (args.run and not args.authorization):
            raise ValueError("exact_plan_bundle_and_run_authorization_required")
        import synthetic_provider_hosted as hosted
        if args.cleanup_only:
            result = hosted.cleanup_only(sys.modules[__name__], args.plan, args.bundle)
        else:
            result = hosted.run_hosted(sys.modules[__name__], args.plan, args.bundle, read_json(args.authorization))
        print(json.dumps({"receipt": str(args.plan.parent / "run-receipt.json"), "cleanup_complete": result.get("cleanup", {}).get("complete", False), "error": result.get("error")}))
        return 0 if result.get("cleanup", {}).get("complete") and (args.cleanup_only or not result.get("error")) else 1
    if not args.bundle or not args.output:
        parser.error("--bundle and a new --output are required")
    if args.prepare:
        if not args.ticket or not args.expires_at:
            parser.error("--ticket and --expires-at are explicit fixed inputs; never generated on retry")
        plan = prepare(args.bundle, args.output, args.ticket, args.expires_at, read_json(args.price_profile) if args.price_profile else None)
        print(json.dumps({"plan": str(args.output / "plan.json"), "candidate_sha256": plan["candidate_sha256"], "paid_execution_ready": False, "pending": plan["pending"], "hosted_operations": 0, "provider_requests": 0}))
    else:
        if not args.plan or not args.authorization:
            parser.error("--plan and explicit --authorization are required")
        reviewed = authorize_candidate(read_json(args.plan), args.bundle, read_json(args.authorization))
        save(args.output, reviewed)
        print(json.dumps({"admission_receipt": str(args.output), "paid_execution_ready": reviewed["paid_execution_ready"], "pending": reviewed["pending"], "hosted_operations": 0, "provider_requests": 0}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print("Call transport stopped; inspect the private receipt when present. No automatic retry or generation resume.", file=sys.stderr)
        sys.exit(1)
