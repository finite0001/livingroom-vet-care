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

    def test_normalized_cache_changes_only_authored_acl_and_policy_paths(self):
        original=self.original();retained=deepcopy(original)
        normalized=source.expected_properties(original,source.OLD_BODY_SHA)
        self.assertEqual(normalized['functions'],original['functions'])
        self.assertEqual(normalized['other'],original['other'])
        self.assertEqual(original,retained)
        self.assertEqual(normalized['ordinary_relations']['time_entries']['columns'],original['ordinary_relations']['time_entries']['columns'])

    def test_family_is_acyclic_exact_and_distinguishes_numeric_encoding(self):
        import json
        first=json.dumps(self.original(),sort_keys=True)
        second=first.replace('"unchanged": true','"unchanged": 1.00')
        a=source.render_family(first);b=source.render_family(second)
        self.assertEqual(a['template_hash'],b['template_hash'])
        self.assertNotEqual(a['expected_hash'],b['expected_hash'])
        self.assertNotEqual(a['body_sha256'],b['body_sha256'])
        self.assertEqual(source.sha(a['template_body'].encode()),a['template_hash'])
        self.assertEqual(source.sha(a['body'].encode()),a['body_sha256'])
        for marker in (source.EXPECTED_MARKER,source.TEMPLATE_MARKER):
            self.assertEqual(a['template_body'].count(marker),1)
            self.assertNotIn(marker,a['body'])
        self.assertEqual(a['body'].count("CASE WHEN w.signature="+source.literal(source.SIGNATURE)),1)
        self.assertIn(" ELSE NULL END ELSE "+source.BODY_DIGEST,a['body'])
        self.assertTrue(a['whole_comparison_body_inverse'])

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
