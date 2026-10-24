"""Offline A1 declaration/body boundary checks; these do not execute PostgreSQL.

The genuine fixture and independent row/effect oracles remain the behavioral
acceptance gate. Optional pglast checks only PL/pgSQL syntax, not catalog binding,
membership, statement cost, permissions, or correctness of selected rows.
"""
import importlib.util
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "tests/controlled-drugs/engine/candidate"
MANIFEST = SOURCE / "record-review-v3-adapters-selectors.json"
PATTERN = re.compile(
    r"^-- BEGIN FUNCTION ([a-z_]+)\|([a-z0-9]+)\|([a-z]+)\n(.*?)^-- END FUNCTION$",
    re.M | re.S,
)


def read_bodies(manifest, texts):
    expected = {item["name"]: item for item in manifest["function_inventory"]}
    if len(expected) != len(manifest["function_inventory"]):
        raise ValueError("duplicate declared function")
    bodies = {}
    for filename, text in texts.items():
        for match in PATTERN.finditer(text):
            name, result, language, body = match.groups()
            entry = expected.get(name)
            if name in bodies or entry is None or entry["file"] != filename:
                raise ValueError("undeclared, duplicate or misplaced function")
            if (entry["result"], entry["language"]) != (result, language):
                raise ValueError("function result/language mismatch")
            bodies[name] = body
        residue = PATTERN.sub("", text)
        if any(line.strip() and not line.lstrip().startswith("--") for line in residue.splitlines()):
            raise ValueError("unframed SQL")
    if set(bodies) != set(expected):
        raise ValueError("missing declared function")
    return bodies


def dispatch(body):
    section = body.split("case e.event_kind", 1)[1].split("end case", 1)[0]
    result = {}
    for kinds, adapter in re.findall(r"when (.*?) then adapter_id:='([^']+)'", section, re.S):
        for kind in re.findall(r"'([^']+)'", kinds):
            if kind in result:
                raise ValueError("duplicate dispatch kind")
            result[kind] = adapter
    return result


def local_column_collisions(body, catalog):
    """Conservative source check, stronger than a particular query's scope.

    With variable_conflict=error, avoid local names matching any column of a
    relation read by this body. SQL aliases/composite fields remain qualified.
    The real PostgreSQL gate is still required for complete name resolution.
    """
    names = set(re.findall(
        r"(?:^|\bdeclare|;)\s*([a-z_]\w*)\s+(?:public\.[a-z_]+|text|integer|uuid|jsonb|numeric|record)",
        body.split("begin")[0],
    ))
    relations = set(re.findall(r"\b(?:from|join) public\.([a-z_]+)\b(?!\s*\()", body, re.I))
    columns = {column["name"] for name in relations if name in catalog for column in catalog[name]["columns"]}
    return names & columns


def local_alias_collisions(body, arguments=()):
    """Check SQL AST range aliases against every PL/pgSQL local/argument.

    Qualification does not resolve a table alias that also names a record.
    This conservative whole-function check includes nested expressions, not
    just top-level SELECTs. Parsing still does not establish catalog binding.
    Unsupported expression modes or assignment forms fail rather than skip.
    """
    from pglast import parse_plpgsql, parser

    def walk(node):
        if isinstance(node, dict):
            yield node
            for value in node.values():
                yield from walk(value)
        elif isinstance(node, list):
            for value in node:
                yield from walk(value)

    signature = ",".join(arg["name"] + " " + arg["type"] for arg in arguments)
    sql = "create function alias_audit(" + signature + ") returns jsonb language plpgsql as $body$" + body + ";$body$;"
    function = parse_plpgsql(sql)[0]["PLpgSQL_function"]
    names = {value["refname"] for datum in function["datums"] for kind, value in datum.items()
             if kind in ("PLpgSQL_var", "PLpgSQL_rec")}
    aliases = set()
    for node in walk(function):
        if "PLpgSQL_expr" not in node:
            continue
        expression = node["PLpgSQL_expr"]
        query, mode = expression["query"], expression["parseMode"]
        if mode == 2:  # PostgreSQL RAW_PARSE_PLPGSQL_EXPR
            query = "SELECT " + query
        elif mode in (3, 4, 5):  # RAW_PARSE_PLPGSQL_ASSIGN1/2/3
            assignment = re.fullmatch(r'\s*(?:[a-zA-Z_]\w*|"(?:[^"]|"")+")\s*(?::=|=)\s*(.*)', query, re.S)
            if assignment is None:
                raise ValueError("unsupported assignment form in alias audit")
            query = "SELECT " + assignment[1]
        elif mode != 0:
            raise ValueError("unsupported expression mode in alias audit")
        tree = json.loads(parser.parse_sql_json(query))
        for sql_node in walk(tree):
            if "aliasname" in sql_node:
                aliases.add(sql_node["aliasname"])
            if "RangeVar" in sql_node and "alias" not in sql_node["RangeVar"]:
                aliases.add(sql_node["RangeVar"]["relname"])
    return names & aliases


class AdapterDeclarationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads(MANIFEST.read_text())
        cls.texts = {name: (SOURCE / name).read_text() for name in
                     {entry["file"] for entry in cls.manifest["function_inventory"]}}
        cls.bodies = read_bodies(cls.manifest, cls.texts)

    def test_exact_twelve_private_functions_and_four_modules(self):
        self.assertEqual(len(self.bodies), 12)
        self.assertEqual(len(self.texts), 4)
        for entry in self.manifest["function_inventory"]:
            self.assertEqual(entry["schema"], "controlled_review_v3")
            self.assertFalse(entry["security_definer"])
            self.assertFalse(entry["application_execute"])
            self.assertFalse(entry["strict"])
            self.assertEqual(entry["owner"], "postgres")
            self.assertEqual(entry["volatility"], "volatile")
            self.assertEqual(entry["parallel"], "unsafe")
            self.assertEqual(entry["configuration"], ["search_path=pg_catalog, public, pg_temp", "TimeZone=UTC"])

    def test_extra_duplicate_missing_and_unframed_bodies_refuse(self):
        source = "record-review-v3-adapters.sql"
        for mutation in ("extra", "duplicate", "missing", "unframed"):
            with self.subTest(mutation=mutation):
                texts = dict(self.texts)
                match = next(PATTERN.finditer(texts[source]))
                if mutation == "extra":
                    texts[source] += "\n" + match[0].replace(match[1], "undeclared_adapter", 1)
                elif mutation == "duplicate":
                    texts[source] += "\n" + match[0]
                elif mutation == "missing":
                    texts[source] = texts[source].replace(match[0], "", 1)
                else:
                    texts[source] += "\nselect 1;\n"
                with self.assertRaises(ValueError):
                    read_bodies(self.manifest, texts)

    def test_full_literal_kind_dispatch_matches_independent_declaration(self):
        expected = {item["event_kind"]: item["adapter_id"] for item in self.manifest["kinds"]}
        self.assertEqual(len(expected), 22)
        self.assertEqual(dispatch(self.bodies["collect_event_sources"]), expected)
        body = self.bodies["collect_event_sources"]
        self.assertLess(body.index("case e.event_kind"), body.index("adapter_parent(state"))
        self.assertLess(body.index("case e.event_kind"), body.index("adapter_event_site("))

    def test_declared_parent_edges_are_the_only_parent_roles(self):
        roles = {edge["purpose"] for edge in self.manifest["reference_edges"] if edge["group"] == "parent"}
        guard = re.search(r"p_role<>all\(array\[(.*?)\]\)", self.bodies["adapter_parent"])[1]
        self.assertEqual(set(re.findall(r"'([^']+)'", guard)), roles)
        self.assertNotIn("adapter_parent(", self.bodies["adapter_context"])
        return_guard = re.search(r"managed is not null and p_role in\((.*?)\)", self.bodies["adapter_return"])[1]
        self.assertEqual(set(re.findall(r"'([^']+)'", return_guard)), {"reviewed_target", "correction_target", "ordinary_source"})
        for name, expected in (("adapter_dispense", {"reviewed_target", "original_dispense"}),
                               ("adapter_pickup", {"reviewed_target", "original_pickup"})):
            guard = re.search(r"p_role<>all\(array\[(.*?)\]\)", self.bodies[name])[1]
            self.assertEqual(set(re.findall(r"'([^']+)'", guard)), expected)

    def test_precedence_is_complete_unique_and_declared(self):
        roles = self.manifest["roles"]
        self.assertEqual([item["priority"] for item in roles], list(range(len(roles))))
        actual = re.search(r"roles text\[\]:=array\[(.*?)\]", self.bodies["adapter_add"])[1]
        self.assertEqual(re.findall(r"'([^']+)'", actual), [item["role"] for item in roles])
        self.assertEqual(len({item["role"] for item in roles}), len(roles))

    def test_packet_reads_only_finite_immutable_declared_relations(self):
        allowed = {item["relation"] for item in self.manifest["selectors"] if item["stage"] in ("A1", "A1_and_A2")}
        observed = set()
        for body in self.bodies.values():
            code = re.sub(r"--[^\n]*", "", body)
            observed.update(re.findall(r"\b(?:from|join) (public\.[a-z_]+)\b(?!\s*\()", code, re.I))
            self.assertNotRegex(code, r"(?i)\b(insert\s+into|update\s+public\.|delete\s+from|truncate|execute\s|grant\s|create\s+table)\b")
        self.assertLessEqual(observed, allowed)
        self.assertFalse(observed.intersection(self.manifest["forbidden_packet_relations"]))

    def test_declared_helper_calls_are_closed(self):
        observed = set()
        for body in self.bodies.values():
            observed.update(re.findall(r"controlled_review_v3\.([a-z_]+)\(", body))
        self.assertLessEqual(observed, set(self.bodies) | {"required"})

    def test_a2_site_fallback_is_not_enabled(self):
        collector = self.bodies["collect_event_sources"]
        self.assertNotIn("opening_package", collector)
        self.assertNotIn("opening_exception", collector)
        self.assertIn("reason:='unmanaged_original_dispense'", collector)
        self.assertIn("reason:='unmanaged_original_return'", collector)
        self.assertIn("site:=null;site_basis:='unproven'", collector)
        self.assertLess(collector.index("retained_site<>node_site"), collector.index("if reason is null then"))
        self.assertNotIn("site:=retained_site", collector)

    def test_composite_fields_match_independently_frozen_catalog(self):
        # The frozen technical manifest covers controlled/native row types.
        # Ordinary billing/alert fields are checked by actual catalog binding later.
        catalog = json.loads((SOURCE / "release-expected-204.json").read_text())["expected_technical_manifest"]["relations"]
        checked = 0
        for name, body in self.bodies.items():
            for variable, relation in re.findall(r"\b(\w+) public\.(\w+)", body.split("begin")[0]):
                if relation not in catalog:
                    continue
                fields = set(re.findall(r"\b" + variable + r"\.(\w+)", body))
                declared = {item["name"] for item in catalog[relation]["columns"]}
                self.assertLessEqual(fields, declared, (name, variable, relation))
                checked += 1
        self.assertGreater(checked, 20)

    def test_locals_do_not_collide_with_read_relation_columns(self):
        catalog = json.loads((SOURCE / "release-expected-204.json").read_text())["expected_technical_manifest"]["relations"]
        for name, body in self.bodies.items():
            self.assertEqual(local_column_collisions(body, catalog), set(), name)
        # The original direct movement helper bug parsed successfully offline,
        # but stock_movement_sources.source_id would conflict with this local.
        mutant = self.bodies["managed_source_event"].replace("selected_source_id", "source_id")
        self.assertIn("source_id", local_column_collisions(mutant, catalog))

    def test_standalone_classifier_owns_native_provenance_validation(self):
        body = self.bodies["managed_source_event"]
        # This entry point cannot defer historical/present provenance checks to
        # a collector that its direct callers never invoke.
        self.assertNotRegex(body, r"controlled_review_v3\.(?:collect_event_sources|adapter_\w+)\(")
        for relation in ("stock_custody_sources", "stock_pickup_sources", "stock_discrepancy_sources", "stock_correction_sources"):
            self.assertIn("from public." + relation + " s where s.event_id=selected_source_id", body)
        self.assertIn("native_source_provenance->>'actor_id' is distinct from source_row->>'actor_id'", body)
        self.assertIn("native_source_provenance->>'writer' is distinct from expected_writer", body)
        self.assertIn("return_sourced not in(0,return_count)", body)
        self.assertIn("return_root_count<>return_sourced", body)
        self.assertIn("dispense_root_count<>sourced", body)
        self.assertIn("a.dispense_id=did and a.movement_id=s.movement_id", body)
        self.assertIn("return_sourced<>return_count", body)
        self.assertIn("selected_source_kind not in('movement','dispense') and native_source_provenance is null", body)
        self.assertLess(body.index("return_root_count<>return_sourced"), body.index("if parent_id is not null then"))

    @unittest.skipUnless(importlib.util.find_spec("pglast"), "optional offline PostgreSQL parser unavailable")
    def test_all_twelve_bodies_have_no_local_sql_alias_collision(self):
        self.assertEqual(len(self.bodies), 12)
        for entry in self.manifest["function_inventory"]:
            with self.subTest(function=entry["name"]):
                self.assertEqual(local_alias_collisions(self.bodies[entry["name"]], entry["arguments"]), set())
        # Actual 42702 vector: qualification a.dispense_id still binds both
        # the loop record and the nested SQL alias. Syntax-only parsing passed.
        original_failure = self.bodies["adapter_dispense"].replace("allocation_row", "a")
        self.assertNotEqual(original_failure, self.bodies["adapter_dispense"])
        self.assertEqual(local_alias_collisions(original_failure), {"a"})

    @unittest.skipUnless(importlib.util.find_spec("pglast"), "optional offline PostgreSQL parser unavailable")
    def test_alias_audit_handles_nested_join_function_and_quoted_forms(self):
        queries = (
            "select a.id from public.source_rows a",
            "select 1 from public.source_rows s join public.other_rows a on a.id=s.id",
            "select 1 where not exists(select a.id from public.source_rows as a)",
            "select a.id from(select id from public.source_rows) as a",
            "select a.value from jsonb_each('{}'::jsonb) a",
            'select "a".id from public.source_rows as "a"',
            "select a.id from a",  # implicit relation name
        )
        for query in queries:
            with self.subTest(query=query):
                body = "declare a record; begin if exists(" + query + ") then return null; end if; return null; end"
                self.assertEqual(local_alias_collisions(body), {"a"})
                self.assertEqual(local_alias_collisions(body.replace("declare a record", "declare distinct_local record")), set())
        # Alias-looking text in strings/comments must not create an alias.
        safe = "declare a record; begin perform 'from public.source_rows a'; -- join public.other_rows a\n return null; end"
        self.assertEqual(local_alias_collisions(safe), set())

    @unittest.skipUnless(importlib.util.find_spec("pglast"), "optional offline PostgreSQL parser unavailable")
    def test_plpgsql_syntax_without_database(self):
        from pglast import parse_plpgsql
        for entry in self.manifest["function_inventory"]:
            with self.subTest(function=entry["name"]):
                arguments = ",".join(arg["name"] + " " + arg["type"] for arg in entry["arguments"])
                sql = ("create function controlled_review_v3." + entry["name"] + "(" + arguments + ") returns jsonb "
                       "language plpgsql as $body$" + self.bodies[entry["name"]] + ";$body$;")
                self.assertTrue(parse_plpgsql(sql))


if __name__ == "__main__":
    unittest.main()
