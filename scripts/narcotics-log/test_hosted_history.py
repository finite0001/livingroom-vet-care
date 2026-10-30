"""Exact source inverses; no hosted database or business acceptance."""
import json
import re
import unittest
from copy import deepcopy
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
        self.assertEqual(proof["changed_gate_count"], 412)
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
        self.assertEqual(proof["changed_gate_count"], 205)
        self.assertEqual(len(proof["source_receipt_encodings"]), 205)
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

    def test_canonical_receipt_checks_all_sql_fields_without_audit_column_dependence(self):
        _, variants = history.sources()
        spec = variants["20260912220000"]
        alternative = history.predicate("20260912220000", spec)
        self.assertIn("cardinality(m.statements)=" + str(spec["canonical_cli"]["statement_count"]), alternative)
        self.assertIn("octet_length(to_jsonb(m.statements)::text)=" + str(spec["canonical_cli"]["postgres_array_bytes"]), alternative)
        self.assertIn(spec["canonical_cli"]["postgres_array_sha256"], alternative)
        self.assertIn("m.version='20260912220000'and m.name='patient_documents'", alternative)
        self.assertNotIn("to_jsonb(m)", alternative)
        for key, value in (("statement_count", 0), ("statement_count", True),
                           ("postgres_array_bytes", 1), ("postgres_array_sha256", "not a digest")):
            changed = deepcopy(spec)
            changed["canonical_cli"][key] = value
            with self.assertRaises(ValueError):
                history.predicate("20260912220000", changed)

    def test_hosted_rehearsal_constructs_canonical_and_authored_receipts_with_audit_data(self):
        from hosted_rehearsal import initial_source
        sql, rows, expected = initial_source(history.prefix.ROOT)
        text = sql.decode()
        self.assertIn("created_by text,idempotency_key text UNIQUE,rollback text[]", text)
        self.assertIn("synthetic retained audit value", text)
        _, variants = history.sources()
        receipt = next(row for row in expected if row["version"] == "20260912220000")
        self.assertEqual({key: receipt[key] for key in variants[receipt["version"]]["canonical_cli"]},
                         variants[receipt["version"]]["canonical_cli"])
        self.assertTrue(any(row["statement_count"] > 1 for row in expected))
        self.assertTrue(any(row["statement_count"] == 1 for row in expected))
        self.assertNotIn("UPDATE supabase_migrations.schema_migrations", text)

    def test_engine205_only_admits_the_exact_original_cli_vector(self):
        rows, variants = history.sources()
        engine = rows[-1]
        spec = variants[engine['version']]
        self.assertEqual(spec['encodings'], {})
        self.assertEqual(spec['canonical_cli'], history.array_pin(engine['statements']))
        alternative = history.predicate(engine['version'], spec)
        self.assertIn(spec['canonical_cli']['postgres_array_sha256'], alternative)
        self.assertNotIn('=any(ARRAY[', alternative)


if __name__ == "__main__":
    unittest.main()
