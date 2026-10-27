"""Transaction framing and narrowly scoped reference-DDL refusal controls."""
import ast
from pathlib import Path
import unittest

import sql_framing as framing


class SqlFramingTests(unittest.TestCase):
    def test_transaction_and_nonpipeline_commands_refuse(self):
        for sql in ("BEGIN;", "COMMIT;", "ROLLBACK;", "SET ROLE postgres;",
                    "SET SESSION AUTHORIZATION postgres;", "ALTER SYSTEM SET x='y';",
                    "DROP TABLE public.profiles;", "COPY public.profiles TO STDOUT;",
                    "VACUUM;", "CREATE INDEX CONCURRENTLY x ON public.profiles(id);",
                    "-- pg-delta:transaction=false\nSELECT 1;"):
            with self.assertRaises(AssertionError, msg=sql):
                framing.audit_cli_statements(sql)

    def test_function_body_quotes_and_nested_comments_do_not_split(self):
        sql = "/* outer /* nested */ still */ DO $b$BEGIN PERFORM 'a;''b';END;$b$; SELECT 1;"
        self.assertEqual(framing.audit_cli_statements(sql), 2)
        self.assertEqual(framing.audit_cli_statements("SELECT ';'; -- trailing comment\n"), 1)

    def test_only_named_public_trigger_and_transient_reference_drops(self):
        allowed = (
            "DROP TRIGGER controlled_stock_consistency ON public.controlled_stock_execution_contexts;",
            "DROP SCHEMA controlled_count_fixture_reference_v1 CASCADE;",
            "DROP POLICY IF EXISTS \"Old policy\" ON count_ordinary_relation_reference_v1.profiles;",
            "SET LOCAL statement_timeout='8s';SET CONSTRAINTS ALL IMMEDIATE;",
        )
        for sql in allowed:
            self.assertGreater(framing.audit_cli_statements(sql), 0)
        for sql in ("DROP TRIGGER another ON public.controlled_stock_execution_contexts;",
                    "DROP POLICY x ON public.profiles;", "DROP SCHEMA public CASCADE;",
                    "SET LOCAL role='postgres';", "SET CONSTRAINTS ALL DEFERRED;"):
            with self.assertRaises(AssertionError, msg=sql):
                framing.audit_cli_statements(sql)

    def test_retained_lexical_splitter_is_byte_exact(self):
        root = Path(__file__).resolve().parents[2]
        old = (root / "tests/controlled-drugs/engine/candidate/cli_migration_body.py").read_text()
        new = Path(framing.__file__).read_text()
        def function(text, name):
            node = next(node for node in ast.parse(text).body if isinstance(node, ast.FunctionDef) and node.name == name)
            return ast.get_source_segment(text, node)
        for name in ("split_reviewed_statements", "audit_cli_statements"):
            self.assertEqual(function(old, name), function(new, name))


if __name__ == "__main__":
    unittest.main()
