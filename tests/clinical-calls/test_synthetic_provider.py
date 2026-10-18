"""Offline admission/prepare/cleanup tests; all prices/reviews below are FICTIONAL fixtures."""
import base64
from copy import deepcopy
from datetime import datetime, timezone
from fractions import Fraction
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("call_synthetic_provider", Path(__file__).with_name("synthetic-provider.py"))
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)
BUNDLE_PATH = runner.ROOT / "tmp/call-fidelity-final-v1/bundle.json"


def review():
    return {"reviewer": "FICTIONAL OFFLINE TEST REVIEWER", "reviewed_at": "2026-10-18T00:00:00Z", "valid_until": "2034-01-01T00:00:00Z", "evidence_sha256": "f" * 64,
            "explanation": "FICTIONAL TEST ONLY: this is not official pricing, account-tier evidence, a tokenizer bound, verified metering or paid authorization."}


def profile(frozen):
    return {"contract": "lrv-call-provider-reviewed-budget-v1", "currency": "USD", "model": "gpt-6-luna", "request_service_tier": "unpinned", "budget_usd": "0.25", "per_case_margin_usd": "0.001",
            "billable_output_tokens_upper": 8000, "input_metering_review": review(), "applicable_tiers": [{"name": "FICTIONAL tier with all extras bounded", "input_usd_per_million_upper": "1", "output_usd_per_million_upper": "2", "other_usd_per_request_upper": "0", "evidence_sha256": "f" * 64}],
            "input_bounds": [{"case_id": c["id"], "request_sha256": c["request_sha256"], "billable_input_tokens_upper": 1000, "review": review()} for c in frozen["cases"]],
            "tier_coverage_review": review(), "output_metering_review": review(), "other_cost_review": review(), "pricing_review": review()}


def authority(plan, current):
    return {"contract": "lrv-call-provider-expense-authorization-v1", "candidate_sha256": plan["candidate_sha256"], "bundle_sha256": runner.BUNDLE,
            "ticket": plan["ticket"], "staging_project": runner.PROJECT, "requested_model": "gpt-6-luna", "maximum_paid_requests": 10,
            "budget_usd_micros": plan["admission"]["budget_usd_micros"], "approved_by": "FICTIONAL TEST OWNER; NO EXPENSE AUTHORIZED",
            "approved_at": datetime.fromtimestamp(current / 1000, timezone.utc).isoformat(),
            "scope": "ten_fixed_requests_no_retry_temporary_staging_probes_and_guard", "billing_limitation_acceptance": "FICTIONAL TEST acceptance of calculated-bound limitations, no provider hard-cap assertion.", "staging_resource_cost_scope": "FICTIONAL TEST cloud-cost scope; not an actual approval."}


class OfflineTransportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Build via the current offline exporter; tests do not depend on private tmp evidence.
        node = "import {buildFrozenCallBundle} from './tests/clinical-calls/evaluation-offline.ts';process.stdout.write(JSON.stringify(await buildFrozenCallBundle()));"
        cls.temporary = tempfile.TemporaryDirectory()
        cls.bundle_path = Path(cls.temporary.name) / "bundle.json"
        import subprocess
        output = subprocess.run(["node", "--experimental-strip-types", "--input-type=module", "-e", node], cwd=runner.ROOT, capture_output=True, timeout=60)
        if output.returncode:
            raise RuntimeError("Offline fictional bundle build failed")
        cls.bundle_path.write_bytes(output.stdout)
        cls.frozen = runner.local_bundle_plan(cls.bundle_path)
        cls.expiry_text = "2033-05-18T03:33:20Z"
        cls.expiry = runner.timestamp_ms(cls.expiry_text)
        cls.ticket = "a" * 20

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def candidate(self, priced=False):
        with patch.object(runner, "local_bundle_plan", return_value=deepcopy(self.frozen)):
            return runner.freeze_candidate(self.bundle_path, self.ticket, self.expiry_text, "e" * 64, profile(self.frozen) if priced else None)[0]

    def test_unpriced_candidate_exact_sources_are_nonexecutable_and_fixed(self):
        plan = self.candidate()
        self.assertEqual(plan["contract"], runner.VERSION)
        self.assertIsNone(plan["admission"])
        self.assertFalse(plan["paid_execution_ready"])
        self.assertEqual(plan["maximum_paid_requests"], 10)
        self.assertEqual(len(plan["probe_source_sha256"]), 10)
        self.assertEqual(plan["operator_token_sha256"], "e" * 64)
        with patch.object(runner, "local_bundle_plan", return_value=deepcopy(self.frozen)):
            runner.validate_candidate(plan, self.bundle_path)
            for mutate in (lambda p: p.update(staging_project="primary-forbidden"), lambda p: p["function_names"].__setitem__(0, "clinical-call-note-process"), lambda p: p.update(expires_at_ms=p["expires_at_ms"] + 1), lambda p: p["probe_source_sha256"].update({plan["function_names"][0]: "0" * 64})):
                changed = deepcopy(plan); mutate(changed)
                with self.assertRaises(ValueError): runner.validate_candidate(changed, self.bundle_path)

    def test_exact_fraction_budget_and_conservative_microdollar_reservations(self):
        admission = runner.calculate_admission(profile(self.frozen), self.frozen, self.expiry)
        self.assertEqual(admission["reserved_usd_micros"], 180000)
        self.assertEqual(admission["cases"][0]["upper_usd_exact"], {"numerator": "9", "denominator": "500"})
        self.assertEqual(runner.reserve_micros(Fraction(1, 10**15)), 1)
        tiny = profile(self.frozen)
        tiny["per_case_margin_usd"] = "0"
        tiny["applicable_tiers"][0].update(input_usd_per_million_upper="0.000000000001", output_usd_per_million_upper="0.000000000001")
        self.assertEqual(runner.calculate_admission(tiny, self.frozen, self.expiry)["reserved_usd_micros"], 10)
        low = profile(self.frozen); low["budget_usd"] = "0.179999"
        with self.assertRaisesRegex(ValueError, "exceed_budget"): runner.calculate_admission(low, self.frozen, self.expiry)

    def test_no_default_prices_verification_flags_float_tokens_or_tier_override(self):
        for mutate in (lambda p: p.pop("pricing_review"), lambda p: p.update(verified=True), lambda p: p.update(request_service_tier="standard"), lambda p: p.update(budget_usd=0.25), lambda p: p["input_bounds"][0].update(billable_input_tokens_upper=True), lambda p: p["input_bounds"][0].update(request_sha256="0" * 64), lambda p: p["input_bounds"][0].pop("review"), lambda p: p.update(applicable_tiers=[]), lambda p: p["output_metering_review"].update(valid_until="2026-10-18T00:01:00Z"), lambda p: p["pricing_review"].update(reviewed_at="2033-06-01T00:00:00Z")):
            changed = profile(self.frozen); mutate(changed)
            with self.assertRaises((ValueError, KeyError)): runner.calculate_admission(changed, self.frozen, self.expiry)
        broad = profile(self.frozen)
        broad["applicable_tiers"].append({**broad["applicable_tiers"][0], "name": "FICTIONAL more expensive tier", "output_usd_per_million_upper": "3"})
        broad["budget_usd"] = "1"
        self.assertEqual(runner.calculate_admission(broad, self.frozen, self.expiry)["reserved_usd_micros"], 260000)

    def test_explicit_authorization_binds_final_candidate_budget_ticket_and_lifetime(self):
        plan = self.candidate(priced=True)
        current = self.expiry - 30 * 60000
        authorized = authority(plan, current)
        with patch.object(runner, "local_bundle_plan", return_value=deepcopy(self.frozen)):
            receipt = runner.authorize_candidate(plan, self.bundle_path, authorized, clock=lambda: current)
            self.assertFalse(receipt["paid_execution_ready"])
            self.assertEqual(receipt["provider_requests"], 0)
            for key, wrong in (("budget_usd_micros", 1), ("ticket", "b" * 20), ("candidate_sha256", "0" * 64), ("maximum_paid_requests", 11), ("billing_limitation_acceptance", "")):
                changed = deepcopy(authorized); changed[key] = wrong
                with self.assertRaises(ValueError): runner.authorize_candidate(plan, self.bundle_path, changed, clock=lambda: current)
            with self.assertRaises(ValueError): runner.authorize_candidate(plan, self.bundle_path, authorized, clock=lambda: self.expiry)
            with self.assertRaises(ValueError): runner.authorize_candidate(self.candidate(), self.bundle_path, authorized, clock=lambda: current)

    def test_unknown_calls_consume_full_reservation_without_refunds_or_replay(self):
        plan = self.candidate(priced=True)
        ledger = {"consumed": [], "reserved_usd_micros": 0, "states": {}, "stopped": False}
        runner.reserve_case(ledger, plan, "A")
        self.assertEqual(ledger["reserved_usd_micros"], 18000)
        self.assertEqual(ledger["states"]["A"], "may_have_dispatched")
        runner.record_outcome(ledger, "A", {"state": "dispatch_uncertain", "response_complete": False, "uncertain": True})
        self.assertTrue(ledger["stopped"])
        with self.assertRaises(ValueError): runner.reserve_case(ledger, plan, "B")
        with self.assertRaises(ValueError): runner.reserve_case(ledger, plan, "A")
        self.assertEqual(ledger["reserved_usd_micros"], 18000)

    def test_confirmed_complete_can_admit_next_fixed_case_without_refunding_and_tampering_fails(self):
        plan = self.candidate(priced=True)
        ledger = {"consumed": [], "reserved_usd_micros": 0, "states": {}, "stopped": False}
        with self.assertRaises(ValueError): runner.reserve_case(ledger, plan, "B")
        runner.reserve_case(ledger, plan, "A")
        with self.assertRaises(ValueError): runner.reserve_case(ledger, plan, "B")
        runner.record_outcome(ledger, "A", {"state": "response_complete", "response_complete": True, "uncertain": False})
        runner.reserve_case(ledger, plan, "B")
        self.assertEqual(ledger["reserved_usd_micros"], 36000)
        runner.record_outcome(ledger, "B", {"state": "secret_echo_redacted", "response_complete": False, "uncertain": True})
        self.assertTrue(ledger["stopped"])
        self.assertEqual(ledger["reserved_usd_micros"], 36000)
        with self.assertRaises(ValueError): runner.reserve_case(ledger, plan, "C")

    def test_private_prepare_operator_receipt_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(runner, "local_bundle_plan", return_value=deepcopy(self.frozen)):
            destination = Path(temporary) / "candidate"
            plan = runner.prepare(self.bundle_path, destination, self.ticket, self.expiry_text)
            operator = runner.read_json(destination / "operator-receipt.json")
            self.assertEqual(runner.digest(operator["operator_token"].encode()), plan["operator_token_sha256"])
            self.assertNotIn(operator["operator_token"], json.dumps(plan))
            self.assertEqual((destination / "operator-receipt.json").stat().st_mode & 0o777, 0o600)
            for name in plan["function_names"]:
                source = (destination / "supabase/functions" / name / "index.ts").read_bytes()
                self.assertEqual(runner.digest(source), plan["probe_source_sha256"][name])
                self.assertNotIn(operator["operator_token"].encode(), source)
            self.assertEqual((destination / "supabase/config.toml").read_text().count("verify_jwt = true"), 10)
            with self.assertRaises(FileExistsError): runner.prepare(self.bundle_path, destination, self.ticket, self.expiry_text)

    def test_partial_redacted_and_uncertain_outcomes_never_masquerade_as_complete(self):
        plan = self.candidate()
        receipts = [{"id": c["id"], "request_sha256": c["request_sha256"], "state": "not_attempted", "response_complete": False} for c in plan["cases"]]
        raw = b'{"valid_looking_prefix":true}'
        receipts[0].update(state="response_partial", raw_body_base64=base64.b64encode(raw).decode(), raw_body_sha256=runner.digest(raw), http_status=200, response_complete=False, uncertain=True)
        receipts[1].update(state="secret_echo_redacted", raw_body_base64="", raw_body_sha256=None, response_complete=False, uncertain=True)
        imported = runner.bridge_outcomes(plan, receipts)
        self.assertTrue(all(c["outcome"]["kind"] == "transport_error" for c in imported["cases"]))
        receipts[0].update(state="response_complete", response_complete=True, uncertain=False, retained_bytes=len(raw), provider_request_id="req_offline")
        self.assertEqual(runner.bridge_outcomes(plan, receipts)["cases"][0]["outcome"]["raw_body_base64"], base64.b64encode(raw).decode())
        receipts[0]["raw_body_sha256"] = "0" * 64
        with self.assertRaises(ValueError): runner.bridge_outcomes(plan, receipts)
        receipts[0].update(raw_body_base64="Zh==", raw_body_sha256=runner.digest(b"f"), retained_bytes=1)
        with self.assertRaisesRegex(ValueError, "not_canonical"): runner.bridge_outcomes(plan, receipts)

    def test_offline_run_entrypoint_refuses_before_environment_subprocess_or_transport(self):
        with patch.object(runner, "local_bundle_plan", side_effect=AssertionError("no command")), patch.dict("os.environ", {}, clear=True):
            with self.assertRaisesRegex(ValueError, "not_implemented_or_authorized"): runner.main(["--run"])

    def test_cleanup_keeps_guards_on_ambiguous_function_absence_and_until_expiry(self):
        plan = self.candidate()
        original = [{"name": "unrelated-clinical-function", "version": 4, "sha256": "1" * 64}]
        secrets = [{"name": "OPENAI_API_KEY", "digest": "2" * 64}]
        baseline = {"functions_sha256": runner.digest(runner.packed(original)), "storage_sha256": runner.digest(runner.packed([])), "secrets_sha256": runner.digest(runner.packed(secrets))}
        class Transport:
            def __init__(self): self.deleted = []; self.buckets = [{"name": plan["guard_bucket"]}]; self.fail_list = False; self.extra = []
            def delete_function(self, name): self.deleted.append(name); raise OSError("unknown deletion acknowledgement")
            def list_functions(self):
                if self.fail_list: raise OSError("unknown absence")
                return original + self.extra
            def delete_guard_object(self, bucket, path): self.deleted.append((bucket, path))
            def delete_guard_bucket(self, bucket): self.buckets = []; self.deleted.append(bucket)
            def list_buckets(self): return self.buckets
            def list_secret_metadata(self): return secrets
        receipt = {"deployment_attempted": plan["function_names"][:2], "baseline": baseline}
        transport = Transport(); transport.fail_list = True
        result = runner.cleanup(plan, receipt, transport, clock=lambda: self.expiry + 100000)
        self.assertFalse(result["complete"]); self.assertTrue(transport.buckets)
        self.assertFalse(any(isinstance(item, tuple) for item in transport.deleted))
        transport = Transport()
        result = runner.cleanup(plan, receipt, transport, clock=lambda: self.expiry - 1)
        self.assertFalse(result["complete"]); self.assertTrue(transport.buckets)
        transport = Transport()
        result = runner.cleanup(plan, receipt, transport, clock=lambda: self.expiry + 100000)
        self.assertTrue(result["complete"]); self.assertFalse(transport.buckets)
        self.assertEqual([x for x in transport.deleted if isinstance(x, tuple)], [(plan["guard_bucket"], path) for path in plan["object_paths"]])
        transport = Transport(); transport.extra = [{"name": "unexpected-new-function", "version": 1}]
        self.assertFalse(runner.cleanup(plan, receipt, transport, clock=lambda: self.expiry + 100000)["complete"])
        with self.assertRaises(ValueError): runner.cleanup(plan, {**receipt, "deployment_attempted": ["unrelated-clinical-function"]}, transport)


if __name__ == "__main__":
    unittest.main()
