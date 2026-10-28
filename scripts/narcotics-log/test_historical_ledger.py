"""Historical ledger literals must remain independent of current function edits."""
import json
from pathlib import Path
import re
import unittest

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
    def test_all_preflight_and_postcheck_rows_match_frozen_source(self):
        old = json.loads((CANDIDATE / "secondary_review_expected_205_ledger.json").read_bytes())
        expected = {row["version"]: row for row in old["ledger"]}
        tail = json.loads((CANDIDATE / "secondary_review_206_statements.json").read_bytes())
        expected["20261022010000"] = {
            "version": "20261022010000", "name": "controlled_secondary_review_private",
            "statements": tail["statements"],
        }
        source = (ROOT / "supabase/migrations/20261027223535_controlled_record_review_workflows.sql").read_text()
        matches = list(GATE.finditer(source))
        self.assertEqual([match[1] for match in matches], sorted(expected) * 2)
        for match in matches:
            with self.subTest(version=match[1]):
                self.assertEqual(json.loads(match[2].replace("''", "'")), expected[match[1]])


if __name__ == "__main__":
    unittest.main()
