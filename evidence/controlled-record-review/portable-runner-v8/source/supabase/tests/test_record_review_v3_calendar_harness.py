"""Offline calendar contract/oracle checks, not SQL execution or timeout proof.

The hardcoded UTC associations are independent fixture expectations for the later
owned PostgreSQL gate. Python's timezone database corroborates those cases here;
it does not replace PostgreSQL's actual publication/restore acceptance.
"""
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
import re
import sys
import unittest
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'tests/controlled-drugs/engine/candidate'
SQL=SOURCE/'record-review-v3-calendar.sql'
SIGNATURES={'calendar_candidates':'p_request jsonb','resolve_calendar':'p_calendar jsonb'}
# Each expected pair is (UTC instant, exact local-minus-UTC offset in seconds).
VECTORS=(
 ('UTC','2026-02-28T12:00:00',(('2026-02-28T12:00:00.000000Z',0),)),
 ('UTC','2028-02-29T23:59:59',(('2028-02-29T23:59:59.000000Z',0),)),
 ('UTC','2026-12-31T23:59:59',(('2026-12-31T23:59:59.000000Z',0),)),
 ('Asia/Tokyo','2101-01-01T00:00:00',(('2100-12-31T15:00:00.000000Z',32400),)),
 ('America/New_York','2026-03-08T02:30:00',()),
 ('America/New_York','2026-11-01T01:30:00',(('2026-11-01T05:30:00.000000Z',-14400),('2026-11-01T06:30:00.000000Z',-18000))),
 ('Australia/Lord_Howe','2026-10-04T02:15:00',()),
 ('Australia/Lord_Howe','2026-04-05T01:45:00',(('2026-04-04T14:45:00.000000Z',39600),('2026-04-04T15:15:00.000000Z',37800))),
 ('Asia/Kathmandu','2026-06-01T12:00:00',(('2026-06-01T06:15:00.000000Z',20700),)),
 ('Australia/Eucla','2026-06-01T12:00:00',(('2026-06-01T03:15:00.000000Z',31500),)),
 ('America/Havana','2026-03-08T00:00:00',()),
 ('America/Havana','2026-11-01T00:00:00',(('2026-11-01T04:00:00.000000Z',-14400),('2026-11-01T05:00:00.000000Z',-18000))),
)


def exhaustive_candidates(local,zone):
    value=datetime.fromisoformat(local)
    result=[]
    for offset in range(-50400,50401):
        candidate=(value-timedelta(seconds=offset)).replace(tzinfo=timezone.utc)
        if candidate.astimezone(zone).replace(tzinfo=None)==value:
            result.append((candidate.strftime('%Y-%m-%dT%H:%M:%S.%fZ'),offset))
    return tuple(sorted(result))


@lru_cache(maxsize=32)
def observed_candidates(local,zone):return exhaustive_candidates(local,ZoneInfo(zone))


def choose(candidates,fold,*,boundary=False):
    if len(candidates)not in (1,2):raise ValueError('unsupported local time')
    if boundary:return candidates[0]
    if type(fold)is not int or fold not in range(len(candidates)):raise ValueError('unjustified fold')
    return candidates[fold]


class CalendarContractTests(unittest.TestCase):
    def test_exact_unused_private_function_inventory(self):
        text=SQL.read_text()
        pattern=r'^-- BEGIN FUNCTION ([a-z_]+)\|([a-z0-9]+)\|([a-z]+)\n(.*?)^-- END FUNCTION$'
        matches=list(re.finditer(pattern,text,re.M|re.S))
        self.assertEqual({m[1]for m in matches},set(SIGNATURES));self.assertEqual(len(matches),2)
        self.assertTrue(all((m[2],m[3])==('jsonb','plpgsql')for m in matches))
        residue=re.sub(pattern,'',text,flags=re.M|re.S)
        self.assertTrue(all(not line.strip()or line.startswith('--')for line in residue.splitlines()))
        for match in matches:
            code='\n'.join(line for line in match[4].splitlines()if not line.lstrip().startswith('--'))
            self.assertNotRegex(code,r'(?i)\b(insert|update|delete|truncate|grant|execute)\b')
        sys.path.insert(0,str(SOURCE))
        import record_review_v3_gate_b as assembly
        bundle=assembly.build()
        self.assertFalse(any(path.endswith('/record-review-v3-calendar.sql')for path in bundle['input_source_hashes']))
        self.assertTrue(all(name not in bundle['ddl']for name in SIGNATURES))
        self.assertIs(bundle['configuration_implemented'],False)

    def test_actual_source_enumerates_every_integer_offset_with_exact_roundtrip(self):
        text=SQL.read_text()
        self.assertEqual(text.count('generate_series(-50400,50400)'),1)
        self.assertIn("at time zone zone_name)=l.local_value",text)
        self.assertNotRegex(text,r'generate_series\([^)]*,[^)]*,[^)]*\)')
        self.assertIn("jsonb_array_length(p_request->'local_values')not between 1 and 63",text)
        self.assertIn('last_day-first_day not between 0 and 30',text)
        self.assertEqual(63*(50400*2+1),6350463)
        self.assertNotIn('pg_timezone_abbrevs',text)
        self.assertNotRegex(text,r'select[^;]+\butc_offset\b')
        self.assertNotRegex(text,r'(?i)set\s+(?:local\s+)?statement_timeout')

    def test_independent_gap_fold_nonhour_leap_and_rollover_vectors(self):
        for zone,local,expected in VECTORS:
            with self.subTest(zone=zone,local=local):
                self.assertEqual(observed_candidates(local,zone),expected)

    def test_integral_second_and_inclusive_offset_edges(self):
        local='2026-06-01T12:00:00'
        for seconds in (-50400,-50399,50399,50400):
            with self.subTest(seconds=seconds):
                result=exhaustive_candidates(local,timezone(timedelta(seconds=seconds)))
                self.assertEqual(len(result),1);self.assertEqual(result[0][1],seconds)
        self.assertEqual(exhaustive_candidates(local,timezone(timedelta(seconds=50401))),())

    def test_earliest_midnight_and_explicit_close_fold_fixture_contract(self):
        fold=observed_candidates('2026-11-01T00:00:00','America/Havana')
        self.assertEqual(choose(fold,None,boundary=True),fold[0])
        self.assertEqual(choose(fold,1),fold[1])
        for candidates,index in (((),0),((('a',0),),1),(fold,2),(fold,True),((('a',0),('b',1),('c',2)),0)):
            with self.subTest(candidates=candidates,index=index),self.assertRaises(ValueError):choose(candidates,index)
        text=SQL.read_text()
        self.assertIn('calendar_unsupported_midnight',text)
        self.assertIn('fold>=candidate_count',text)
        self.assertIn('close_instant<=start_time or close_instant>=end_time',text)
        self.assertIn("jsonb_typeof(day_row->'close_fold')is distinct from 'number'",text)
        self.assertIn("(day_row->>'close_fold')!~'^[01]$'",text)

    def test_consecutive31_dates_produce_exact63_local_values(self):
        first=datetime(2026,12,15);values=set()
        for index in range(31):
            day=first+timedelta(days=index)
            values.update((day.strftime('%Y-%m-%dT00:00:00'),(day+timedelta(days=1)).strftime('%Y-%m-%dT00:00:00'),day.strftime('%Y-%m-%dT17:00:00')))
        self.assertEqual(len(values),63)
        self.assertEqual(max(values),'2027-01-15T00:00:00')
        text=SQL.read_text()
        self.assertIn("jsonb_array_length(p_calendar->'days')<>last_day-first_day+1",text)
        self.assertIn("day_row->'date'is distinct from to_jsonb(to_char(day_date,'YYYY-MM-DD'))",text)
        self.assertIn('select distinct unnest(local_values)',text)
        self.assertIn("t collate \"C\"<=previous collate \"C\"",text)

    def test_exact_observation_and_supplied_utc_are_preserved(self):
        text=SQL.read_text()
        self.assertIn("return jsonb_build_object('calendar',p_calendar,'observation'",text)
        self.assertIn("'postgres_version',server_version,'local_values',resolution",text)
        self.assertIn("public.controlled_stock_text(to_jsonb(current_setting('server_version')),200,false)",text)
        self.assertIn("jsonb_array_elements(r->'candidates')c",text)
        self.assertIn("calendar_observation_range",text)
        candidates=text.split('-- END FUNCTION',1)[0]
        self.assertIn("jsonb_array_elements(result)r",candidates)
        self.assertIn("local_value>timestamp '2101-01-01 00:00:00'",candidates)
        self.assertIn("'offset_seconds',m.offset_seconds)order by m.candidate",text)
        self.assertIn("start_time is distinct from(day_row->>'start_utc')::timestamptz",text)
        self.assertIn("end_time is distinct from(day_row->>'end_utc')::timestamptz",text)
        self.assertIn("close_instant is distinct from(day_row->>'close_utc')::timestamptz",text)
        self.assertIn("instant>=timestamptz '2101-01-01 00:00:00Z'",text)
        self.assertIn("zone_name like 'posix/%' or zone_name like 'right/%'",text)
        self.assertIn('calendar_closed_day_has_close',text)


if __name__=='__main__':unittest.main()
