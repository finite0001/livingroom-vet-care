from pathlib import Path
import socket,subprocess,unittest
from unittest.mock import patch
import sys
HERE=Path(__file__).resolve().parent
CANDIDATE=HERE.parents[1]/'tests/controlled-drugs/engine/candidate'
sys.path.insert(0,str(CANDIDATE))
import record_review_v3_calendar_source_analysis as analysis
SOURCE=(CANDIDATE/'record-review-v3-calendar.sql').read_text()

class SourceAnalysisTests(unittest.TestCase):
    def test_actual_bodies_under_forbidden_process_and_socket(self):
        with patch.object(subprocess,'Popen',side_effect=AssertionError('No process')),patch.object(socket,'socket',side_effect=AssertionError('No socket')):
            result=analysis.audit(SOURCE)
        self.assertEqual(result['functions'],2);self.assertGreater(result['parsed_expressions'],60)
    def test_comments_whitespace_and_keyword_case_do_not_fake_semantics(self):
        benign=SOURCE.replace('generate_series(-50400,50400)','GENERATE_SERIES( -50400 , /* exact inclusive range */ 50400 )').replace('not between 1 and 2','NOT BETWEEN 1 AND 2')
        self.assertEqual(analysis.audit(benign),analysis.audit(SOURCE))
    def test_endpoints_and_sampling_steps_refuse(self):
        for replacement in ('generate_series(-50399,50400)','generate_series(-50400,50399)','generate_series(-50400,50400,60)','generate_series(-50400,50400,1)'):
            with self.subTest(replacement),self.assertRaises(AssertionError):analysis.audit(SOURCE.replace('generate_series(-50400,50400)',replacement))
    def test_two_candidate_guards_removed_weakened_or_dead_refuse(self):
        alterations=[('jsonb_array_length(boundaries)not between 1 and 2','false'),('jsonb_array_length(boundaries)not between 1 and 2','jsonb_array_length(boundaries)<1'),('candidate_count not between 1 and 2 or fold>=candidate_count','fold>=candidate_count'),("raise exception 'calendar_unsupported_close' using errcode='23514'","raise notice 'calendar_unsupported_close'"),("raise exception 'calendar_unsupported_midnight' using errcode='23514'","raise exception 'calendar_unsupported_midnight' using errcode='22023'")]
        for old,new in alterations:
            with self.subTest(new),self.assertRaises(AssertionError):analysis.audit(SOURCE.replace(old,new))
        begin="if jsonb_array_length(boundaries)not between 1 and 2 then\n   raise exception 'calendar_unsupported_midnight' using errcode='23514';end if;"
        with self.assertRaises(AssertionError):analysis.audit(SOURCE.replace(begin,'if false then '+begin+'end if;'))
    def test_keep_only_candidate_zero_variants_refuse(self):
        for old,new in [("'candidates',candidates)","'candidates',candidates->0)"),("'[]'::jsonb)as candidates","'[]'::jsonb)->0 as candidates"),("return result;","return jsonb_build_array(result->0);"),("from matches m where m.label=l.label","from matches m where m.label=l.label and m.offset_seconds=0"),("from matches m where m.label=l.label","from matches m where m.label=l.label limit 1"),("'local_values',resolution","'local_values',jsonb_build_array(resolution->0)")]:
            with self.subTest(new),self.assertRaises(AssertionError):analysis.audit(SOURCE.replace(old,new))
    def test_default_zone_and_wrong_zone_roundtrip_refuse(self):
        for old,new in [("zone_name:=p_request->>'zone'","zone_name:=coalesce(p_request->>'zone','UTC')"),("zone_name text;","zone_name text:='UTC';"),("at time zone zone_name)=l.local_value","at time zone 'UTC')=l.local_value")]:
            with self.subTest(new),self.assertRaises(AssertionError):analysis.audit(SOURCE.replace(old,new))
    def test_second_resolution_or_timezone_pass_refuse(self):
        assignment="resolution:=controlled_review_v3.calendar_candidates(jsonb_build_object('zone',p_calendar->'zone','local_values',to_jsonb(local_values)));"
        self.assertEqual(SOURCE.count(assignment),1)
        with self.assertRaises(AssertionError):analysis.audit(SOURCE.replace(assignment,assignment+'\n'+assignment))
        with self.assertRaises(AssertionError):analysis.audit(SOURCE.replace('previous_end:=end_time;',"perform timezone('UTC',start_time);previous_end:=end_time;"))
    def test_comments_cannot_restore_removed_live_invariant(self):
        text=SOURCE.replace('generate_series(-50400,50400)','generate_series(-50400,50400,3600)')+'\n-- generate_series(-50400,50400)\n'
        with self.assertRaises(AssertionError):analysis.audit(text)

if __name__=='__main__':unittest.main(verbosity=2)
