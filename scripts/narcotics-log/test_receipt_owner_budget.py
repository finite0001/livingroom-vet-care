"""Keep the owner receipt allowance after all unchanged application checks."""
import unittest

import install_rehearsal as installation
import receipt_owner_budget as receipt
import validated_client_constraint as source
from sql_framing import split_reviewed_statements


class ReceiptOwnerBudgetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.current = (source.ROOT / 'supabase/migrations' / source.MIGRATION).read_bytes()
        cls.original = receipt.canonical(cls.current)

    def test_whole_inverse_preserves_all_reviewed_pr318_bytes(self):
        self.assertEqual(receipt.sha(self.original), receipt.ORIGINAL_SHA)
        self.assertEqual(receipt.derive(self.original), self.current)
        self.assertEqual(receipt.derive(self.current), self.current)

    def test_only_last_statement_uses_existing_owner_budget(self):
        old = split_reviewed_statements(self.original.decode())
        new = split_reviewed_statements(self.current.decode())
        self.assertEqual(old, new[:-1])
        self.assertEqual(new[-1].splitlines()[-1], "SET LOCAL statement_timeout='30s'")
        self.assertEqual(receipt.SECONDS, installation.OWNER_SECONDS)
        self.assertIn("SET LOCAL statement_timeout='8s';", self.original.decode())

    def test_changed_application_limit_or_receipt_allowance_refuses(self):
        for before, after in ((b"statement_timeout='8s'", b"statement_timeout='9s'"),
                              (b"statement_timeout='30s'", b"statement_timeout='60s'")):
            self.assertIn(before, self.current)
            with self.assertRaises(ValueError):
                receipt.derive(self.current.replace(before, after, 1))

    def test_allowance_cannot_move_before_validation_or_outside_transaction(self):
        for changed in (receipt.SUFFIX + self.original,
                        self.original + receipt.SUFFIX.replace(b'SET LOCAL', b'SET'),
                        self.current + b'COMMIT;\n'):
            with self.assertRaises(ValueError):
                receipt.derive(changed)


if __name__ == '__main__':
    unittest.main()
