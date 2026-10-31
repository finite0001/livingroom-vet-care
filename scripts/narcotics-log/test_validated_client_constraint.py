"""Source inverse and scope refusals; actual catalog controls run in PostgreSQL."""
import unittest

import validated_client_constraint as source


class ValidatedClientConstraintTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.current = (source.ROOT / "supabase/migrations" / source.MIGRATION).read_bytes()

    def test_whole_migration_inverse_recovers_reviewed_source(self):
        original = source.canonical(self.current)
        self.assertEqual(source.sha(original), source.ORIGINAL_SQL_SHA)
        derived, _ = source.derive(original)
        self.assertEqual(derived, self.current)
        self.assertEqual(source.derive(derived)[0], derived)

    def test_unrelated_body_and_diagnostic_changes_refuse(self):
        text = self.current.decode()
        for before, after in (("k.convalidated AND", "true AND"),
                              ("c.relname = 'clients'", "c.relname = 'pets'"),
                              ("k.conname = 'clients_required_contacts_check'", "k.conname = 'other'"),
                              (source.DEFINITION, "CHECK (true)"),
                              (source.NEW_DIAGNOSTIC, source.OLD_DIAGNOSTIC)):
            self.assertIn(before, text)
            with self.assertRaises(ValueError):
                source.canonical(text.replace(before, after, 1).encode())

    def test_missing_and_duplicate_getters_refuse(self):
        for text in (self.current.decode().replace(source.HEADER, "CREATE FUNCTION wrong()", 1),
                     self.current.decode() + source.HEADER):
            with self.assertRaises(ValueError):
                source.canonical(text.encode())

    def test_all_materialized_metadata_and_source_pins_match(self):
        proof = source.materialize()
        self.assertEqual(proof["constraint_DDL_changes"], 0)
        self.assertTrue(proof["limits_changed"])
        self.assertFalse(proof["application_limits_changed"])
        self.assertEqual(proof["migration_receipt_limit_seconds"], 30)


if __name__ == "__main__":
    unittest.main()
