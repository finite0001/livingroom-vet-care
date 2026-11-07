"""Canonical source transport and exact independently derived family admission."""
from copy import deepcopy
import hashlib
import json
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import beta_rehearsal as beta


def fixture():
    return {"properties": {"functions": {beta.clock_source.SIGNATURE: {
        "body_sha256": beta.clock_source.OLD_BODY_SHA, "owner": "postgres"}},
        "ordinary_relations": {"time_entries": {"acl": [], "policies": [
            {"name": name} for name in sorted(beta.clock_source.POLICIES)]}},
        "lexical": 1.0}}


class CanonicalReferenceTests(unittest.TestCase):
    def test_reference_envelope_has_exact_source_inverse(self):
        source = beta.installation.prefix.regular(beta.HERE / "module-source-expected.sql").decode()
        wrapped = beta.source_expectation_envelope(source)
        original = "SELECT pg_catalog.current_setting('lrv_narcotics_source.expected');"
        replacement = ("SELECT jsonb_build_object('canonical_text',"
                       "pg_catalog.current_setting('lrv_narcotics_source.expected'));")
        self.assertEqual(wrapped.count(replacement), 1)
        self.assertEqual(wrapped.replace(replacement, original, 1), source)
        with self.assertRaisesRegex(ValueError, "Exact original"):
            beta.source_expectation_envelope(source + "\n")

    def test_original_decoded_return_and_numeric_spelling_both_survive(self):
        source = beta.installation.prefix.regular(beta.HERE / "module-source-expected.sql").decode()
        raw = '{"number": 1.00, "unicode": "é", "array": [1, 1.0, null]}'
        target = object.__new__(beta.CurrentBusiness)
        target.save = Mock()
        with patch.object(beta.installation.Installation, "query",
                          return_value={"canonical_text": raw}) as parent:
            actual = target.query("complete-source-expected-properties", source)
        self.assertEqual(actual, beta.installation.decode(raw))
        self.assertEqual(target.expected_module_canonical_text, raw)
        target.save.assert_called_once_with("complete-source-expected-properties", actual)
        self.assertEqual(parent.call_args.args[0], "complete-source-expected-properties-canonical")
        self.assertEqual(parent.call_args.args[1], beta.source_expectation_envelope(source))

    def test_other_queries_keep_exact_original_path(self):
        target = object.__new__(beta.CurrentBusiness)
        with patch.object(beta.installation.Installation, "query", return_value={"old": True}) as parent:
            self.assertEqual(target.query("unrelated", "SELECT original;"), {"old": True})
        parent.assert_called_once_with("unrelated", "SELECT original;")
        self.assertFalse(hasattr(target, "expected_module_canonical_text"))


class FamilyRuntimeTests(unittest.TestCase):
    def test_family_uses_raw_source_and_rejects_different_digest(self):
        raw = '{"properties": {"number": 1.00}}'
        normalized = '{"number": 1.00}'
        projection = dict(canonical_text=normalized,
            sha256=hashlib.sha256(normalized.encode()).hexdigest(), original_descriptor_hash="a" * 64)
        runtime = SimpleNamespace(selected_query=Mock(return_value=projection))
        with patch.object(beta.clock_source, "canonical_expectation_query", return_value="source-only SQL") as query:
            result = beta.derive_source_family(runtime, "test", raw)
        query.assert_called_once_with(raw)
        self.assertEqual(result["canonical_text"], normalized)
        self.assertEqual(result["body"], beta.clock_source.render_family(normalized)["body"])
        runtime.selected_query.return_value = {**projection, "sha256": "b" * 64}
        with self.assertRaisesRegex(ValueError, "digest differs"):
            beta.derive_source_family(runtime, "test-invalid", raw)
        with self.assertRaisesRegex(ValueError, "Lossless"):
            beta.derive_source_family(runtime, "test-missing", None)

    def test_every_verification_observes_exact_body_cache_and_original_text(self):
        original = fixture()
        raw = json.dumps(original).replace('"lexical": 1.0', '"lexical": 1.00')
        family = {**beta.clock_source.render_family('{"source": 1.00}'), "original_descriptor_hash": "a" * 64}
        captured = dict(reference_absent=True,
            properties=beta.clock_source.expected_properties(original["properties"], family["body_sha256"]),
            descriptor=dict(definition=original))
        wanted = dict(body=family["body"], admission_count=1,
            admission=dict(revision=1, original_descriptor_hash="a" * 64,
                canonical_expectation=family["canonical_text"], guard_template=family["template_body"],
                require_bound_body_hash=family["body_sha256"]), original_canonical_text=raw)
        runtime = object.__new__(beta.BetaRuntime)
        runtime.install = SimpleNamespace(beta_clock_installed=True, expected_module=original,
            expected_module_canonical_text=raw, query=Mock(return_value=captured))
        runtime.selected_query = Mock(return_value=wanted)
        with patch.object(beta, "source_family", return_value=family):
            runtime.verify_module("positive")
            mutations = [lambda v: v.update(body=v["body"] + "\n-- changed"),
                lambda v: v["admission"].update(canonical_expectation='{"source": 1.0}'),
                lambda v: v["admission"].update(guard_template=v["admission"]["guard_template"] + " "),
                lambda v: v["admission"].update(require_bound_body_hash="b" * 64),
                lambda v: v["admission"].update(original_descriptor_hash="b" * 64),
                lambda v: v.update(admission_count=2),
                lambda v: v.update(original_canonical_text=raw.replace("1.00", "1.0"))]
            for index, mutate in enumerate(mutations):
                changed = deepcopy(wanted)
                mutate(changed)
                runtime.selected_query.return_value = changed
                with self.subTest(index=index), self.assertRaisesRegex(ValueError, "source-derived guard family"):
                    runtime.verify_module("negative-" + str(index))
        self.assertEqual(runtime.selected_query.call_count, 1 + len(mutations))
        self.assertEqual(runtime.install.query.call_count, 1 + len(mutations))

    def test_source_cache_is_invalidated_when_independent_reference_changes(self):
        runtime = SimpleNamespace(install=SimpleNamespace(expected_module_canonical_text="source-one"))
        with patch.object(beta, "derive_source_family", side_effect=[{"one": True}, {"two": True}]) as derive:
            self.assertEqual(beta.source_family(runtime, "first"), {"one": True})
            self.assertEqual(beta.source_family(runtime, "second"), {"one": True})
            runtime.install.expected_module_canonical_text = "source-two"
            self.assertEqual(beta.source_family(runtime, "changed"), {"two": True})
        self.assertEqual(derive.call_count, 2)


if __name__ == "__main__":
    unittest.main()
