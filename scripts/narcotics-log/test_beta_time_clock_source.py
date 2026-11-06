"""Finite successor controls: source deltas only, never observed catalog adoption."""
from copy import deepcopy
import unittest

import beta_time_clock_source as source


class FiniteSuccessorTests(unittest.TestCase):
    def original(self):
        return {"functions": {source.SIGNATURE: {"body_sha256": source.OLD_BODY_SHA, "owner": "postgres"}},
                "other": {"unchanged": True}, "ordinary_relations": {"time_entries": {
                    "columns": [{"name": "unchanged"}],
                    "acl": [{"grantee": role, "privilege": privilege} for role in ("postgres", "authenticated", "service_role")
                            for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE")],
                    "policies": [{"name": name, "expression": "unchanged"} for name in
                                 ("Admins update time entries", "Admins delete time entries", "Staff read own entries")]}}}

    def test_only_declared_properties_change_and_original_is_not_modified(self):
        original = self.original()
        retained = deepcopy(original)
        current = source.expected_properties(original, "a" * 64)
        self.assertEqual(original, retained)
        table = current["ordinary_relations"]["time_entries"]
        self.assertEqual(table["columns"], retained["ordinary_relations"]["time_entries"]["columns"])
        self.assertEqual([a for a in table["acl"] if a["grantee"] == "authenticated"],
                         [{"grantee": "authenticated", "privilege": "SELECT"}])
        self.assertEqual(len([a for a in table["acl"] if a["grantee"] == "service_role"]), 4)
        self.assertEqual(len([a for a in table["acl"] if a["grantee"] == "postgres"]), 4)
        self.assertEqual([p["name"] for p in table["policies"]], ["Staff read own entries"])
        self.assertEqual(current["functions"][source.SIGNATURE], {"owner": "postgres", "body_sha256": "a" * 64})
        self.assertEqual(current["other"], retained["other"])

    def test_other_original_function_or_policy_inventory_is_rejected(self):
        original = self.original()
        original["functions"][source.SIGNATURE]["body_sha256"] = "b" * 64
        with self.assertRaises(ValueError):
            source.expected_properties(original, "a" * 64)
        original = self.original()
        original["ordinary_relations"]["time_entries"]["policies"].pop(0)
        with self.assertRaises(ValueError):
            source.expected_properties(original, "a" * 64)


if __name__ == "__main__":
    unittest.main()
