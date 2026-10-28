"""Source construction refusals; these do not claim PostgreSQL/Auth acceptance."""
import unittest

from pending_validation import FACT_TABLES, NEW_FUNCTIONS, NEW_TRIGGERS, replace_exact


class PendingSourceControls(unittest.TestCase):
    def test_declared_mutation_cut_and_private_delta_are_finite(self):
        self.assertEqual(len(FACT_TABLES), 14)
        self.assertEqual(len(set(FACT_TABLES)), 14)
        self.assertTrue({'descriptor', 'policies', 'operation_closures'}.isdisjoint(FACT_TABLES))
        self.assertEqual(len(NEW_FUNCTIONS), 5)
        self.assertEqual(len(NEW_TRIGGERS), 18)

    def test_replacement_retains_entire_predecessor_including_surrounding_checks(self):
        before = 'check live permission; old(); check final closure;'
        after = replace_exact(before, 'old();', 'new();')
        self.assertEqual(after.replace('new();', 'old();'), before)

    def test_missing_duplicate_or_already_transformed_source_refuses(self):
        for text in ('none', 'old(); old();', 'old(); new();'):
            with self.assertRaises(ValueError):
                replace_exact(text, 'old();', 'new();')


if __name__ == '__main__':
    unittest.main()
