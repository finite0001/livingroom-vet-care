"""The separate beta source contract must fail closed before database work."""
import json
import unittest
from unittest.mock import patch

import beta_rehearsal as beta


class CurrentCandidateSourceTests(unittest.TestCase):
    def test_modified_or_incomplete_candidate_refuses_before_database_admission(self):
        files = {"src/current.ts": {"bytes": 1, "sha256": "a" * 64}}
        base = dict(kind="livingroom-beta-current-source-v1", database_operations=0,
                    runtime_acceptance=False, files=files)
        changes = [dict(files={}), dict(runtime_acceptance=True),
                   dict(kind="historical-proof"), dict(database_operations=1), dict(extra=True)]
        for change in changes:
            with self.subTest(change=change), \
                 patch.object(beta.installation.prefix, "regular", return_value=json.dumps({**base, **change}).encode()), \
                 patch.object(beta, "source_files", return_value=files), \
                 patch.object(beta.installation, "source_admission", side_effect=AssertionError("Unexpected admission")):
                with self.assertRaises(ValueError):
                    beta.admit_source()

    def test_candidate_manifest_and_all_current_files_are_rechecked_after_run(self):
        files = {"src/current.ts": {"bytes": 1, "sha256": "a" * 64}}
        raw = json.dumps(dict(kind="livingroom-beta-current-source-v1", database_operations=0,
                             runtime_acceptance=False, files=files)).encode()
        with patch.object(beta.installation.prefix, "regular", return_value=raw), \
             patch.object(beta, "source_files", return_value=files), \
             patch.object(beta.installation, "source_admission", return_value=({}, {"layout": True}, {"prior": "b" * 64})), \
             patch.object(beta.clock_source, "build", return_value=(raw, json.loads(raw))), \
             patch.object(beta.release, "pin_sources") as independently_admit:
            layout, pins = beta.admit_source()
        independently_admit.assert_called_once()
        self.assertEqual(layout, {"layout": True})
        self.assertEqual(pins["src/current.ts"], "a" * 64)
        self.assertEqual(pins["prior"], "b" * 64)
        self.assertEqual(pins[str(beta.MANIFEST.relative_to(beta.ROOT))], beta.installation.sha(raw))

    def test_current_protocols_retain_original_bytecode_defaults_and_super_closure(self):
        pairs = [(beta.CurrentBusiness.execute, beta.business.BusinessInstallation.execute, {"Runtime", "modules"}),
                 (beta.BetaOperationalBrowser.execute, beta.operational_browser.OperationalBrowser.execute, {"operational_release"}),
                 (beta.BetaRecovery.execute, beta.receiver_rehearsal.PopulatedRecovery.execute, {"operational_release", "business", "Receiver"})]
        for current, original, expected_keys in pairs:
            with self.subTest(function=original.__qualname__):
                self.assertIs(current.__code__, original.__code__)
                self.assertIs(current.__defaults__, original.__defaults__)
                self.assertIs(current.__closure__, original.__closure__)
                self.assertIsNot(current.__globals__, original.__globals__)
                self.assertEqual({key for key in original.__globals__
                                  if current.__globals__[key] is not original.__globals__[key]}, expected_keys)
        self.assertIs(beta.business.Runtime, beta.BetaRuntime.__base__)

    def test_unreviewed_dependency_substitution_is_refused(self):
        with self.assertRaises(ValueError):
            beta.with_factories(beta.business.BusinessInstallation.execute, {"Runtime": object, "save": object})


if __name__ == "__main__":
    unittest.main()
