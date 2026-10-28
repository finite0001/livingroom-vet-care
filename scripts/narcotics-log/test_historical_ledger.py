"""Historical ledger literals must remain independent of current function edits."""
import json
import hashlib
from pathlib import Path
import re
import unittest
from sql_framing import split_reviewed_statements
from hosted_history import canonical_forward

ROOT = Path(__file__).resolve().parents[2]
CANDIDATE = ROOT / "tests/controlled-drugs/engine/candidate"
GATE = re.compile(
    r"^do \$record_review_v3_gate_b_ledger\$ begin if \(select to_jsonb\(m\)"
    r"from supabase_migrations.schema_migrations m where version='([0-9]+)'\)"
    r"is distinct from '((?:''|[^'])*)'::jsonb then raise exception "
    r"'Record-review v3 exact206 ledger row mismatch' using errcode='23514';"
    r"end if;end \$record_review_v3_gate_b_ledger\$;$", re.M,
)


class HistoricalLedgerTests(unittest.TestCase):
    def test_initial_parent_checks_use_the_original_preinstallation_source(self):
        tail = json.loads((CANDIDATE / "secondary_review_206_statements.json").read_bytes())
        source = canonical_forward((ROOT / "supabase/migrations/20261027223535_controlled_record_review_workflows.sql").read_bytes()).decode()
        statements = split_reviewed_statements(source)
        for head in ("do $review_parent$", "do $review_installed$"):
            original = next(value for value in tail["statements"] if value.startswith(head))
            selected = [value for value in statements if value.startswith(head)]
            self.assertEqual(selected, [original, original])

    def test_forward_descriptor_preserves_the_original_parent_rows(self):
        original = json.loads((CANDIDATE / "secondary_review_protocol_private_expected_v2.json").read_bytes())["definition"]
        proof = ROOT / "scripts/narcotics-log"
        common = json.loads((proof / "common-expected.json").read_bytes())
        current = json.loads((proof / "module-expected.json").read_bytes())
        self.assertEqual(common["parents"]["private206"], original)
        saved = current["properties"]["immutable_parent_rows"]
        self.assertEqual(saved["parent205_definition"], original["parent"]["manifest"])
        self.assertEqual(saved["private206_descriptor"], [{"id": True, "definition": original}])
        self.assertEqual(saved["original269_descriptor"], [{"id": True, "definition": common}])

    def test_native_forward_fixes_are_executable_definitions_matching_the_source_golden(self):
        proof = ROOT / "scripts/narcotics-log"
        current = json.loads((proof / "module-expected.json").read_bytes())
        statements = split_reviewed_statements((ROOT / "supabase/migrations/20261027223544_narcotics_count_and_stock_workflows.sql").read_text())
        for signature in ("public.preview_native_pickup(uuid,uuid,jsonb)", "public.controlled_stock_opening_pickup(uuid)",
                          "public.controlled_stock_opening_native_entry_for_product(uuid,text,uuid,integer,integer,integer,uuid)"):
            name = signature.split("(", 1)[0]
            selected = [value for value in statements if re.match(r"create(?: or replace)? function " + re.escape(name) + r"\(", value, re.I)]
            self.assertEqual(len(selected), 1, signature)
            body = re.search(r"\bas\s+(\$[a-zA-Z0-9_]*\$)(.*?)\1", selected[0], re.I | re.S)
            self.assertIsNotNone(body, signature)
            self.assertEqual(hashlib.sha256(body[2].encode()).hexdigest(), current["properties"]["functions"][signature]["body_sha256"])

    def test_public_composite_returns_resolve_under_catalog_only_ddl_path(self):
        statements = split_reviewed_statements((ROOT / "supabase/migrations/20261027223544_narcotics_count_and_stock_workflows.sql").read_text())
        names = ("controlled_count_entry_v1.local_parent_adjust_inventory_impl", "controlled_count_entry_v1.local_parent_adjust_inventory",
                 "public.receive_inventory", "public.adjust_inventory", "public.record_patient_treatment", "public.record_anesthesia_drug_administration")
        for name in names:
            selected = [value for value in statements if re.match(r"create(?: or replace)? function " + re.escape(name) + r"\(", value, re.I)]
            self.assertEqual(len(selected), 1, name)
            self.assertRegex(selected[0], r"RETURNS public\.(?:inventory_movements|patient_treatments)\b")

    def test_all_final_staff_grants_follow_the_complete_property_check(self):
        statements = split_reviewed_statements((ROOT / "supabase/migrations/20261027223544_narcotics_count_and_stock_workflows.sql").read_text())
        checked = next(i for i, value in enumerate(statements) if value.startswith("DO $fixture_source_check$"))
        descriptor = next(i for i, value in enumerate(statements) if value.startswith("DO $fixture_descriptor$"))
        self.assertLess(checked, descriptor)
        pattern = re.compile(r"GRANT EXECUTE ON FUNCTION (public\.[a-z0-9_]+\([^;]*\)) TO authenticated", re.I)
        final = [pattern.fullmatch(value)[1] for value in statements[descriptor + 1:] if pattern.fullmatch(value)]
        self.assertEqual(len(final), 48)
        self.assertEqual(len(set(final)), 48)
        for value in statements[:checked]:
            grant = pattern.fullmatch(value)
            if grant:
                self.assertNotIn(grant[1], final)

    def test_all_preflight_and_postcheck_rows_match_frozen_source(self):
        old = json.loads((CANDIDATE / "secondary_review_expected_205_ledger.json").read_bytes())
        expected = {row["version"]: row for row in old["ledger"]}
        tail = json.loads((CANDIDATE / "secondary_review_206_statements.json").read_bytes())
        expected["20261022010000"] = {
            "version": "20261022010000", "name": "controlled_secondary_review_private",
            "statements": tail["statements"],
        }
        source = canonical_forward((ROOT / "supabase/migrations/20261027223535_controlled_record_review_workflows.sql").read_bytes()).decode()
        matches = list(GATE.finditer(source))
        self.assertEqual([match[1] for match in matches], sorted(expected) * 2)
        for match in matches:
            with self.subTest(version=match[1]):
                self.assertEqual(json.loads(match[2].replace("''", "'")), expected[match[1]])


if __name__ == "__main__":
    unittest.main()
