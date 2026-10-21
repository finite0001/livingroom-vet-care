"""Negative regression guards for baseline-aware no-send SQL assertions."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parent
FILES = (
    'ezyvet_migration_attempt_events.test.sql',
    'ezyvet_migration_progress.test.sql',
    'ezyvet_migration_binding_adapters.test.sql',
    'ezyvet_migration_bindings.test.sql',
    'ezyvet_migration_manifests.test.sql',
)
TABLES = ['communication_outbox', 'messages', 'outbound_deliveries', 'outbound_message_attempts']


def contract(sql):
    """Fail closed if a fixture regresses to count-only or late capture."""
    signature = 'create function pg_temp.ezyvet_delivery_snapshot()'
    assert sql.count(signature) == 1
    start = sql.index(signature)
    end = sql.index('end$delivery$;', start) + len('end$delivery$;')
    body = sql[start:end]
    assert "set timezone='UTC'" in body
    match = re.search(r'foreach relation_name in array array\[(.*?)\]loop', body)
    assert match and re.findall(r"'([^']+)'", match[1]) == TABLES
    assert "''count'',count(*)" in body
    assert "encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(r)order by to_jsonb(r)::text),''[]''::jsonb)::text,''UTF8'')),''hex'')" in body
    assert 'string_agg' not in body
    assert 'from public.%I r' in body
    assert not re.search(r'\b(delete|truncate|update|insert)\b', body, re.I)
    baseline = 'create temp table ezyvet_delivery_baseline as select pg_temp.ezyvet_delivery_snapshot()as value;'
    assert sql.count(baseline) == 1
    assert end < sql.index(baseline) < sql.index('insert into auth.users')
    assertion = 'select is(pg_temp.ezyvet_delivery_snapshot(),(select value from ezyvet_delivery_baseline),'
    assert sql.count(assertion) == 1
    at = sql.index(assertion)
    # Require the no-send guard after all operations, with unrestricted postgres
    # visibility. Only its descriptive label and finish/rollback may follow.
    after = sql[at + len(assertion):]
    assert re.fullmatch(r"'[^']*'\);\nselect \* from finish\(\);rollback;\n", after)
    assert sql.rfind('reset role;', 0, at) > sql.rfind('set local role ', 0, at)
    assert not re.search(r'select is\(\(select count\(\*\)::integer from communication_outbox\),0,', sql)
    return body


class EzyvetDeliveryBaselineTests(unittest.TestCase):
    def test_five_standalone_fixtures_capture_all_rows_before_any_fixture_work(self):
        bodies = [contract((ROOT / name).read_text()) for name in FILES]
        self.assertTrue(all(body == bodies[0] for body in bodies))

    def test_count_only_or_ambiguous_serialization_guard_is_rejected(self):
        original = (ROOT / FILES[0]).read_text()
        for changed in (
            original.replace('jsonb_agg(to_jsonb(r)order by to_jsonb(r)::text)', "string_agg(to_jsonb(r)::text,''|'')"),
            original.replace('select is(pg_temp.ezyvet_delivery_snapshot(),(select value from ezyvet_delivery_baseline),', 'select is((select count(*)::integer from communication_outbox),0,'),
            original.replace('to_jsonb(r)', "jsonb_build_object(''id'',r.id)"),
        ):
            with self.assertRaises(AssertionError):
                contract(changed)

    def test_missing_family_or_fixed_timezone_is_rejected(self):
        original = (ROOT / FILES[0]).read_text()
        for changed in (original.replace(",'outbound_message_attempts'", ''), original.replace("set timezone='UTC'", '')):
            with self.assertRaises(AssertionError):
                contract(changed)

    def test_late_capture_cannot_hide_fixture_side_effects(self):
        original = (ROOT / FILES[0]).read_text()
        line = 'create temp table ezyvet_delivery_baseline as select pg_temp.ezyvet_delivery_snapshot()as value;'
        changed = original.replace(line, '')
        at = changed.index('reset role;')
        changed = changed[:at] + line + '\n' + changed[at:]
        with self.assertRaises(AssertionError):
            contract(changed)

    def test_later_adapter_actions_cannot_escape_the_final_guard(self):
        original = (ROOT / 'ezyvet_migration_binding_adapters.test.sql').read_text()
        contract(original)
        changed = original.replace('select * from finish();rollback;', "select 1;\nselect * from finish();rollback;")
        with self.assertRaises(AssertionError):
            contract(changed)
        # A restricted role could hide preexisting rows under RLS.
        changed = original[:original.rfind('reset role;')] + original[original.rfind('reset role;'):].replace('reset role;', '', 1)
        with self.assertRaises(AssertionError):
            contract(changed)

    def test_sql_assertion_count_is_unchanged_for_each_fixture(self):
        # The fix replaces one existing assertion, not a TAP-plan expansion.
        for name in FILES:
            sql = (ROOT / name).read_text()
            self.assertEqual(sql.count('select is(pg_temp.ezyvet_delivery_snapshot(),'), 1)
            body = contract(sql)
            self.assertNotRegex(body, r'\b(select is|select ok|select throws_ok)\(')


if __name__ == '__main__':
    unittest.main()
