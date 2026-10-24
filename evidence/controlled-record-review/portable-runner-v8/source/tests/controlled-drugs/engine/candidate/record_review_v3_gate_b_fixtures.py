"""Pure genuine-writer fixture assembly; no database or fabricated events.

The unchanged native recipe's diagnostic-only summary is omitted because its
two old fault-probe tables are not part of A1. All actual assertions remain.
"""
from pathlib import Path

import record_review_v3_gate_a_snapshot as capture

SOURCE = Path(__file__).resolve().parent
HEADER = "begin;create extension if not exists pgtap with schema extensions;set local search_path=public,extensions;select no_plan();\n"
PREFIX_END = "insert into data select 'target',"
SUMMARY_START = "select jsonb_build_object('synthetic_only',true,'sql_only',true,'managed_canonical_actions'"
SUMMARY_END = "'late_injected_fault_points',(select count(*)from engine_fault_proof),'independent_corruption_failures',(select count(*)from engine_integrity_proof));\ncommit;\n"
FILES = ('native-config.sql', 'native-operations.sql', 'record-review-v3-adapter-fixtures.sql',
         'record-review-v3-adapter-effects-oracle.sql', 'record-review-v3-adapter-membership-oracle.sql')


def build_stages(source=SOURCE):
    source = Path(source).resolve()
    root = source.parents[3]
    original = (root/'supabase/tests/native_fulfillment.test.sql').read_text()
    assert original.startswith(HEADER) and original.count(HEADER) == 1
    assert original.count(PREFIX_END) == 1
    # The selected prefix contains genuine setup/writer calls and no TAP tests.
    # Avoid installing an unrelated extension into an independently sealed DB.
    prefix = 'begin;set local search_path=public,extensions;\n'+original[len(HEADER):original.index(PREFIX_END)]+'\ncommit;\n'
    operations = (source/'native-operations.sql').read_text()
    assert operations.count(SUMMARY_START) == 1 and operations.endswith(SUMMARY_END)
    actions, summary = operations.split(SUMMARY_START)
    assert actions.count('set constraints all immediate;') == 1
    assert actions.count('select controlled_stock_validate_event(id)') == 1
    assert actions.count("select controlled_stock_validate_product(pg_temp.eid('product'));") == 1
    assert 'engine_fault_proof' not in actions and 'engine_integrity_proof' not in actions
    assert summary.count(';') == 2, 'Only final diagnostic SELECT and COMMIT may be omitted'
    setup = prefix+(source/'native-config.sql').read_text()+actions+'commit;\n'
    # The baseline follows every genuine fixture write. Oracles only create
    # temporary tables/functions, excluded from this complete permanent scope.
    baseline = capture.SETUP+'create temp table review_v3_readonly_baseline as select '+capture.VALUE+' as value;\n'
    verification = """select controlled_review_v3.required();
do $readonly$ begin
 if(select count(*)from review_v3_readonly_baseline)<>1
 or(select value from review_v3_readonly_baseline)is distinct from (__VALUE__)then
  raise exception 'A1 read-only oracle changed complete permanent rows/catalog/seals/ledger' using errcode='23514';end if;
end $readonly$;
select jsonb_build_object('synthetic_only',true,'genuine_cases',(select count(*)from review_v3_fixture_cases),
 'exact_kinds',(select jsonb_agg(distinct event_kind collate "C" order by event_kind collate "C")from review_v3_fixture_cases),
 'effects_cases',(select count(*)from review_v3_effect_proof),
 'membership_cases',(select count(*)from review_v3_membership_proof),
 'full_readonly_preservation',true,'auth_acceptance',false,'historical_A2',false,'corruption_and_bounds',false);
""".replace('__VALUE__', capture.VALUE)
    return [
        ('native_setup', setup),
        ('managed_fixture', (source/FILES[2]).read_text()),
        ('readonly_baseline', baseline),
        ('effects_oracle', (source/FILES[3]).read_text()),
        ('membership_oracle', (source/FILES[4]).read_text()),
        ('readonly_verification', verification),
    ]


def build(source=SOURCE):
    return ''.join(sql for _, sql in build_stages(source))
