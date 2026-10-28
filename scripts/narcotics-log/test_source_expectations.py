"""Reference output can supplement source literals, never replace them."""
from copy import deepcopy
import unittest

import source_expectations as source


class SourceExpectationsTests(unittest.TestCase):
    def fixture(self):
        static = {"properties": {}}
        props = static["properties"]
        for path in source.CONTEXT:
            parent = props
            for name in path[:-1]:
                parent = parent.setdefault(name, {})
            parent[path[-1]] = {"columns": ["original"]}
        for table, name in (("configuration", "v3_enum_publication_mode"), ("publications", "v3_enum_mode")):
            props["original269"].setdefault("relations", {})[table] = {
                "constraints": [{"name": name, "definition": "source literal", "validated": True}]}
        complete = deepcopy(static)
        for path in source.CONTEXT:
            source.set_value(complete["properties"], path, {"columns": ["original", "source addition"]})
        for name in source.DYNAMIC:
            complete["properties"][name] = [{"source": True}] if name == "count_fk_trigger_registrations" else {"source": True}
        for table in ("configuration", "publications"):
            complete["properties"]["original269"]["relations"][table]["constraints"][0]["definition"] = "source deparser"
        return static, complete

    def test_source_only_overlays_leave_literals_and_input_intact(self):
        static, complete = self.fixture()
        before = deepcopy(complete)
        self.assertEqual(source.validate(static, complete), before)
        self.assertEqual(complete, before)

    def test_unrelated_literal_metadata_and_partial_context_refuse(self):
        for change in ("literal", "context", "dynamic", "constraint"):
            static, complete = self.fixture()
            props = complete["properties"]
            if change == "literal":
                complete["extra"] = True
            elif change == "context":
                source.set_value(props, source.CONTEXT[-1], {"columns": ["wrong"]})
            elif change == "dynamic":
                props["tables"] = {}
            else:
                props["original269"]["relations"]["configuration"]["constraints"][0]["validated"] = False
            with self.assertRaises(ValueError, msg=change):
                source.validate(static, complete)


if __name__ == "__main__":
    unittest.main()
