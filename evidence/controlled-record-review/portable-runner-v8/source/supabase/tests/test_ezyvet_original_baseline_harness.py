"""Negative contracts for preserving original-capture clinical side effects."""
from pathlib import Path
import re
import unittest

PATH = Path(__file__).with_name('ezyvet_attachment_originals.test.sql')


def contract(sql):
    name = 'create function pg_temp.ezyvet_original_side_effect_snapshot()'
    assert sql.count(name) == 1
    start = sql.index(name)
    end = sql.index('end$original_baseline$;', start) + len('end$original_baseline$;')
    body = sql[start:end]
    assert "set timezone='UTC'" in body
    assert "array['patient_documents','external_record_receipts']loop" in body
    assert "''count'',count(*)" in body
    assert "coalesce(jsonb_agg(to_jsonb(r)order by to_jsonb(r)::text),''[]''::jsonb)::text" in body
    assert 'encode(sha256(convert_to(' in body and "''UTF8'')),''hex''" in body
    assert 'from public.%I r' in body and 'string_agg' not in body
    assert not re.search(r'\b(insert|delete|update|truncate)\b', body, re.I)
    baseline = 'create temp table ezyvet_original_side_effect_baseline as select pg_temp.ezyvet_original_side_effect_snapshot()as value;'
    assert sql.count(baseline) == 1 and end < sql.index(baseline) < sql.index('-- FIXTURE_BEGIN') < sql.index('insert into auth.users')
    assertions = ["select is(pg_temp.ezyvet_original_side_effect_snapshot()->'" + family + "',(select value->'" + family + "'from ezyvet_original_side_effect_baseline)," for family in ('patient_documents', 'external_record_receipts')]
    for assertion in assertions:
        assert sql.count(assertion) == 1
    at = sql.index(assertions[0])
    assert sql.rfind('reset role;', 0, at) > sql.rfind('set local role ', 0, at)
    assert re.fullmatch(re.escape(assertions[0]) + r"'[^']*'\);\n" + re.escape(assertions[1]) + r"'[^']*'\);\nselect \* from finish\(\);rollback;\n", sql[at:])
    assert "not exists(select 1 from patient_documents)" not in sql
    assert "not exists(select 1 from external_record_receipts)" not in sql
    return body


class EzyvetOriginalBaselineTests(unittest.TestCase):
    def test_two_complete_baselines_precede_extracted_fixture_work(self):
        source = PATH.read_text()
        body = contract(source)
        extracted = source.split('-- FIXTURE_BEGIN')[1].split('-- FIXTURE_END')[0]
        self.assertNotIn('original_side_effect_snapshot', extracted)
        self.assertNotIn('original_side_effect_baseline', extracted)
        self.assertNotRegex(body, r'\b(select is|select ok)\(')
        self.assertEqual(source.count("'API capture creates no patient document'"), 1)
        self.assertEqual(source.count("'API capture creates no manual-export receipt'"), 1)

    def test_count_or_id_only_and_delimiter_framing_are_rejected(self):
        source = PATH.read_text()
        for changed in (
            source.replace('to_jsonb(r)', "jsonb_build_object(''id'',r.id)"),
            source.replace('jsonb_agg(to_jsonb(r)order by to_jsonb(r)::text)', "string_agg(to_jsonb(r)::text,''|'')"),
            source.replace("coalesce(jsonb_agg(to_jsonb(r)order by to_jsonb(r)::text),''[]''::jsonb)::text", "count(*)::text"),
        ):
            with self.assertRaises(AssertionError):
                contract(changed)

    def test_missing_family_or_timezone_is_rejected(self):
        source = PATH.read_text()
        for changed in (source.replace(",'external_record_receipts'", ''), source.replace("set timezone='UTC'", '')):
            with self.assertRaises(AssertionError):
                contract(changed)

    def test_late_baseline_cannot_hide_capture_side_effects(self):
        source = PATH.read_text()
        baseline = 'create temp table ezyvet_original_side_effect_baseline as select pg_temp.ezyvet_original_side_effect_snapshot()as value;'
        source = source.replace(baseline, '')
        at = source.index('reset role;')
        source = source[:at] + baseline + '\n' + source[at:]
        with self.assertRaises(AssertionError):
            contract(source)

    def test_restricted_or_early_final_comparison_is_rejected(self):
        source = PATH.read_text()
        last_reset = source.rfind('reset role;')
        changed = source[:last_reset] + source[last_reset:].replace('reset role;', '', 1)
        with self.assertRaises(AssertionError):
            contract(changed)
        with self.assertRaises(AssertionError):
            contract(source.replace('select * from finish();rollback;', 'select 1;\nselect * from finish();rollback;'))

    def test_empty_global_assertions_cannot_replace_exact_baselines(self):
        source = PATH.read_text()
        old = "select is(pg_temp.ezyvet_original_side_effect_snapshot()->'patient_documents',(select value->'patient_documents'from ezyvet_original_side_effect_baseline),"
        with self.assertRaises(AssertionError):
            contract(source.replace(old, 'select ok(not exists(select 1 from patient_documents),'))


if __name__ == '__main__':
    unittest.main()
