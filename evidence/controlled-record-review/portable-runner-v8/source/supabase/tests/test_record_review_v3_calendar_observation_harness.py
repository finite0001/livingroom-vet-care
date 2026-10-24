"""Source-contract and independent retained-fixture checks; no SQL/DB execution.

These declare exact later runtime cases. They do not prove PostgreSQL refusal
stages, historic timezone exhaustiveness or publication/restore acceptance.
"""
from copy import deepcopy
from datetime import datetime,timedelta
from pathlib import Path
import re
import sys
import unittest

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'tests/controlled-drugs/engine/candidate'
PATH=SOURCE/'record-review-v3-calendar-observation.sql'


def fixture():
    # Fixed independently stated New York autumn fold, not resolver output.
    local_rows=(
        ('2026-10-31T00:00:00',(('2026-10-31T04:00:00.000000Z',-14400),)),
        ('2026-10-31T17:00:00',(('2026-10-31T21:00:00.000000Z',-14400),)),
        ('2026-11-01T00:00:00',(('2026-11-01T04:00:00.000000Z',-14400),)),
        ('2026-11-01T01:30:00',(('2026-11-01T05:30:00.000000Z',-14400),('2026-11-01T06:30:00.000000Z',-18000))),
        ('2026-11-02T00:00:00',(('2026-11-02T05:00:00.000000Z',-18000),)),
    )
    days=[dict(date='2026-10-31',staffed=True,start_utc=local_rows[0][1][0][0],end_utc=local_rows[2][1][0][0],
               close_local='17:00:00',close_fold=0,close_utc=local_rows[1][1][0][0]),
          dict(date='2026-11-01',staffed=True,start_utc=local_rows[2][1][0][0],end_utc=local_rows[4][1][0][0],
               close_local='01:30:00',close_fold=1,close_utc=local_rows[3][1][1][0])]
    return dict(calendar=dict(zone='America/New_York',first_date='2026-10-31',last_date='2026-11-01',days=days),
        observation=dict(zone='America/New_York',postgres_version='17.6 retained synthetic observation',
            local_values=[dict(local_timestamp=local,candidates=[dict(utc=utc,offset_seconds=offset)for utc,offset in pairs])for local,pairs in local_rows]))


def correspondence(value):
    """Small independent arithmetic fixture oracle; never reads timezone data."""
    body=value['calendar'];rows=value['observation']['local_values'];requested=set()
    assert value['observation']['zone']==body['zone']
    for day in body['days']:
        midnight=datetime.fromisoformat(day['date']);next_day=midnight+timedelta(days=1)
        requested.update((midnight.isoformat(),next_day.isoformat()))
        if day['staffed']:requested.add(day['date']+'T'+day['close_local'])
        else:assert all(day[key]is None for key in ('close_local','close_fold','close_utc'))
    labels=[row['local_timestamp']for row in rows]
    assert labels==sorted(requested)
    indexed={row['local_timestamp']:row['candidates']for row in rows}
    for row in rows:
        assert 1<=len(row['candidates'])<=2
        utc_values=[item['utc']for item in row['candidates']]
        assert utc_values==sorted(set(utc_values))
        for item in row['candidates']:
            offset=item['offset_seconds'];assert type(offset)is int and -50400<=offset<=50400
            utc=datetime.fromisoformat(item['utc'].removesuffix('Z'))
            assert datetime(2026,1,1)<=utc<datetime(2101,1,1)
            assert utc+timedelta(seconds=offset)==datetime.fromisoformat(row['local_timestamp'])
    for day in body['days']:
        start=day['date']+'T00:00:00';end=(datetime.fromisoformat(start)+timedelta(days=1)).isoformat()
        assert day['start_utc']==indexed[start][0]['utc'] and day['end_utc']==indexed[end][0]['utc']
        assert day['start_utc']<day['end_utc']
        if day['staffed']:
            fold=day['close_fold'];candidates=indexed[day['date']+'T'+day['close_local']]
            assert type(fold)is int and 0<=fold<len(candidates)
            assert day['close_utc']==candidates[fold]['utc']
            assert day['start_utc']<day['close_utc']<day['end_utc']
    return value


class RetainedCalendarTests(unittest.TestCase):
    def test_exact_unused_single_private_function_and_readonly_body(self):
        text=PATH.read_text()
        pattern=r'^-- BEGIN FUNCTION ([a-z_]+)\|([a-z0-9]+)\|([a-z]+)\n(.*?)^-- END FUNCTION$'
        matches=re.findall(pattern,text,re.M|re.S)
        self.assertEqual(len(matches),1)
        self.assertEqual(matches[0][:3],('validate_calendar_observation','jsonb','plpgsql'))
        code='\n'.join(line for line in matches[0][3].splitlines()if not line.lstrip().startswith('--'))
        self.assertNotRegex(code,r'(?i)\b(insert|update|delete|truncate|grant|execute)\b')
        self.assertIn('return p_request;',code)
        residue=re.sub(pattern,'',text,flags=re.M|re.S)
        self.assertTrue(all(not line.strip()or line.startswith('--')for line in residue.splitlines()))
        sys.path.insert(0,str(SOURCE));import record_review_v3_gate_b as assembly
        bundle=assembly.build()
        self.assertNotIn('validate_calendar_observation',bundle['ddl'])
        self.assertFalse(any(p.endswith('/record-review-v3-calendar-observation.sql')for p in bundle['input_source_hashes']))

    def test_no_current_timezone_or_version_resolution(self):
        body=PATH.read_text().split('-- BEGIN FUNCTION',1)[1]
        code='\n'.join(line for line in body.splitlines()if not line.lstrip().startswith('--'))
        for forbidden in ('pg_timezone','current_setting','resolve_calendar','calendar_candidates','AT TIME ZONE','generate_series'):
            self.assertNotIn(forbidden.lower(),code.lower())
        self.assertIn("utc_value+offset_seconds*interval '1 second'<>local_value",code)
        self.assertIn("public.controlled_stock_text(observation->'postgres_version',200,false)",code)
        self.assertIn("zone_name like 'posix/%'or zone_name like 'right/%'",code)

    def test_fixed_retained_fold_body_is_exact_and_does_not_require_present_zone(self):
        value=fixture();self.assertEqual(correspondence(value),value)
        renamed=deepcopy(value)
        renamed['calendar']['zone']=renamed['observation']['zone']='Retained/No_Longer_Installed'
        self.assertEqual(correspondence(renamed),renamed)
        renamed['observation']['postgres_version']='Old retained version'
        self.assertEqual(correspondence(renamed),renamed)
        self.assertEqual(value['calendar']['days'][1]['close_utc'],'2026-11-01T06:30:00.000000Z')

    def test_independent_mutation_fixtures_require_refusal_later_in_sql(self):
        mutations={
            'missing_local':lambda v:v['observation']['local_values'].pop(),
            'duplicate_local':lambda v:v['observation']['local_values'].append(deepcopy(v['observation']['local_values'][-1])),
            'reordered_local':lambda v:v['observation']['local_values'].reverse(),
            'empty_candidates':lambda v:v['observation']['local_values'][0]['candidates'].clear(),
            'duplicate_candidates':lambda v:v['observation']['local_values'][0]['candidates'].append(deepcopy(v['observation']['local_values'][0]['candidates'][0])),
            'reversed_fold':lambda v:v['observation']['local_values'][3]['candidates'].reverse(),
            'wrong_offset':lambda v:v['observation']['local_values'][0]['candidates'][0].update(offset_seconds=-14401),
            'fractional_offset':lambda v:v['observation']['local_values'][0]['candidates'][0].update(offset_seconds=-14400.0),
            'out_of_range_offset':lambda v:v['observation']['local_values'][0]['candidates'][0].update(offset_seconds=50401),
            'out_of_range_utc':lambda v:v['observation']['local_values'][0]['candidates'][0].update(utc='2101-01-01T00:00:00.000000Z'),
            'wrong_start':lambda v:v['calendar']['days'][0].update(start_utc='2026-10-31T05:00:00.000000Z'),
            'wrong_close_fold':lambda v:v['calendar']['days'][1].update(close_fold=0),
            'unjustified_fold':lambda v:v['calendar']['days'][0].update(close_fold=1),
            'boolean_fold':lambda v:v['calendar']['days'][1].update(close_fold=True),
            'closed_day_with_close':lambda v:v['calendar']['days'][0].update(staffed=False),
            'zone_mismatch':lambda v:v['observation'].update(zone='UTC'),
        }
        for name,mutate in mutations.items():
            with self.subTest(name=name):
                value=fixture();mutate(value)
                with self.assertRaises(AssertionError):correspondence(value)
        self.assertEqual(len(mutations),16)

    def test_source_exact_keys_bounds_and_error_normalization(self):
        text=PATH.read_text()
        for keys in ("['calendar','observation']","['days','first_date','last_date','zone']",
            "['local_values','postgres_version','zone']","['candidates','local_timestamp']","['offset_seconds','utc']"):
            self.assertIn('array'+keys,text)
        self.assertIn('observed is distinct from requested',text)
        self.assertIn("jsonb_array_length(item->'candidates')not between 1 and 2",text)
        self.assertIn("jsonb_array_length(observation->'local_values')not between 1 and 63",text)
        self.assertIn('last_day-first_day not between 0 and 30',text)
        self.assertIn("local_value>timestamp '2101-01-01 00:00:00'",text)
        errors=re.findall(r"raise exception '([^']+)'using errcode='([^']+)'",text)
        self.assertTrue(errors);self.assertEqual(set(errors),{('calendar_observation_invalid','23514')})
        self.assertIn('invalid_text_representation or invalid_datetime_format or datetime_field_overflow',text)
        self.assertIn('numeric_value_out_of_range or check_violation',text)


if __name__=='__main__':unittest.main()
