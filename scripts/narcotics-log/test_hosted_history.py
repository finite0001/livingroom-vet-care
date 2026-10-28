"""Exact source inverses; no hosted database or business acceptance."""
import json
import re
import unittest
import hosted_history as history


class HistoricalTransportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = history.prefix.regular(history.prefix.ROOT / "supabase/migrations" / history.FORWARD_NAME)
        cls.rows, cls.alternatives = history.forward_inputs()

    def test_complete_forward_gate_inverse_preserves_every_canonical_literal(self):
        canonical = history.canonical_forward(self.source)
        self.assertEqual(history.prefix.digest(canonical), history.FORWARD_ORIGINAL_SHA)
        current, proof = history.forward_variant(canonical)
        self.assertEqual(current, self.source)
        self.assertEqual(proof["changed_gate_count"], 410)
        self.assertFalse(proof["historical_rows_rewritten"])

    def test_partial_or_modified_alternative_cannot_be_admitted(self):
        alternative = next(iter(self.alternatives.values())).encode()
        for raw in (self.source.replace(b" and not " + alternative, b"", 1),
                    self.source.replace(alternative, alternative.replace(b"exists", b"EXISTS", 1), 1),
                    self.source + b"\nSELECT true;\n"):
            with self.assertRaises(ValueError):
                history.canonical_forward(raw)

    def test_original206_variant_has_exact_inverse_and_fixed_authored_encodings(self):
        proof = history.materialize()
        self.assertEqual(proof["changed_gate_count"], 204)
        self.assertEqual(len(proof["source_receipt_encodings"]), 204)
        self.assertEqual(set(proof["source_receipt_encodings"][history.PAYMENT_VERSION]["encodings"]),
                         {"authored_complete", "authored_command"})
        self.assertFalse(proof["observed_database_values_used_as_expected"])

    def test_alternatives_follow_outer_comparisons_and_never_change_quoted_SQL(self):
        rows = {row["version"]: row for row in self.rows}
        secondary, _ = history.secondary_variant()
        for raw, grammar, versions in ((secondary, history.ROW, sorted(rows)[:-1]),
                                        (self.source, history.FORWARD_ROW, sorted(rows) * 2)):
            pattern = re.compile(grammar.pattern.replace("::jsonb then", r"::jsonb(?: and not exists\([^\n]+\))? then"), re.M)
            matches = list(pattern.finditer(raw.decode()))
            self.assertEqual([match[1] for match in matches], versions)
            for match in matches:
                self.assertEqual(json.loads(match[2].replace("''", "'")), rows[match[1]])


if __name__ == "__main__":
    unittest.main()
