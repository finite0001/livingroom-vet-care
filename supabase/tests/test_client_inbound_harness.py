"""Deterministic fixture-selection regression; no database or provider calls."""
import ast
from pathlib import Path
import re
from types import SimpleNamespace
import unittest
import uuid


class ClientInboundFixtureTest(unittest.TestCase):
    def select(self, occupied, first_suffix=9201, fail_query=False, occupy_after_selection=False):
        source = Path(__file__).with_name('client_inbound_concurrency.py')
        tree = ast.parse(source.read_text())
        selected = []
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name == 'unused_synthetic_phone':
                selected.append(node)
            if isinstance(node, ast.Assign) and any(
                    isinstance(target, ast.Name) and target.id == 'phone'
                    for target in node.targets):
                start = tree.body.index(node)
                end = next(index for index in range(start + 1, len(tree.body))
                           if isinstance(tree.body[index], ast.Assign)
                           and any(isinstance(target, ast.Name) and target.id == 'first'
                                   for target in tree.body[index].targets))
                selected.extend(tree.body[start:end])
                break
        self.assertTrue(selected, 'Fixture-selection block must be exercised')
        queries = []

        def sql(query):
            self.assertRegex(query, r"^select count\(\*\) from public\.clients where ")
            phone = re.search(r"='(\+1303555\d{4})';$", query).group(1)
            queries.append(phone)
            if fail_query:
                raise RuntimeError('Synthetic read failure')
            if occupy_after_selection and len(queries) > 1:
                return '1'
            return str(1 if phone in occupied else 0)

        fixed_uuid = uuid.UUID(hex=f'{first_suffix - 1000:08x}' + '0' * 24)
        namespace = {'uuid': SimpleNamespace(uuid4=lambda: fixed_uuid), 'sql': sql}
        self.queries = queries
        exec(compile(ast.Module(body=selected, type_ignores=[]), str(source), 'exec'), namespace)
        return namespace['phone']

    def test_retained_preceding_household_is_preserved_and_skipped(self):
        # Real preceding CI fixtures retain photo 9201 and Whogot 9209 clients.
        occupied = {'+13035559201', '+13035559209'}
        self.assertEqual(self.select(occupied), '+13035559202')
        self.assertEqual(occupied, {'+13035559201', '+13035559209'})
        self.assertEqual(self.queries, ['+13035559201', '+13035559202', '+13035559202'])

    def test_unused_candidate_is_still_checked_before_race(self):
        self.assertEqual(self.select(set()), '+13035559201')
        self.assertEqual(self.queries, ['+13035559201', '+13035559201'])

    def test_candidate_sequence_wraps_inside_synthetic_range(self):
        self.assertEqual(self.select({'+13035559999'}, 9999), '+13035551000')
        self.assertEqual(self.queries, ['+13035559999', '+13035551000', '+13035551000'])

    def test_phone_claimed_after_selection_still_refuses_before_race(self):
        with self.assertRaisesRegex(AssertionError, 'Refuse a nonempty synthetic race phone'):
            self.select(set(), occupy_after_selection=True)
        self.assertEqual(self.queries, ['+13035559201', '+13035559201'])

    def test_exhaustion_refuses_without_cleanup_or_write(self):
        occupied = {'+1303555' + str(suffix) for suffix in range(1000, 1032)}
        with self.assertRaisesRegex(RuntimeError, 'unused synthetic race phone'):
            self.select(occupied, 1000)
        self.assertEqual(len(self.queries), 32)

    def test_read_failure_does_not_retry_or_start_race(self):
        with self.assertRaisesRegex(RuntimeError, 'Synthetic read failure'):
            self.select(set(), fail_query=True)
        self.assertEqual(len(self.queries), 1)


if __name__ == '__main__':
    unittest.main()
