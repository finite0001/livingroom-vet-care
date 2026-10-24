"""Offline adversarial checks of fixed generator, not SQL execution credit."""
import copy
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch
from pglast import parse_sql, parse_plpgsql

ROOT=Path(__file__).resolve().parents[2]
HERE=ROOT/'tests/controlled-drugs/engine/candidate'
spec=importlib.util.spec_from_file_location('configuration_test_generator',HERE/'record_review_v3_configuration_fixtures.py')
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)


def walk(v):
    if isinstance(v,dict):
        yield v
        for x in v.values():yield from walk(x)
    elif isinstance(v,list):
        for x in v:yield from walk(x)


class GeneratorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stages,cls.inventory=g.compile_stages()
        cls.cases,_=g.admitted_corpus(g.CORPUS.read_bytes())

    def test_pinned_corpus_bytes_refuse_any_edit(self):
        raw=g.CORPUS.read_bytes()
        for altered in [raw+b' ',raw.replace(b'configuration_invalid',b'other_message',1),raw[:-1]]:
            with self.subTest(size=len(altered)),self.assertRaises(AssertionError):g.admitted_corpus(altered)

    def test_lexical_extractor_preserves_tokens_and_nested_strings(self):
        sample=' {"input":{"a":1.0,"b":1e0,"c":["brace}\\\"",null,1.50]}} '
        nodes=g.lexical_nodes(sample)
        self.assertEqual(nodes[('input','a')],'1.0')
        self.assertEqual(nodes[('input','b')],'1e0')
        self.assertEqual(nodes[('input','c',2)],'1.50')
        with self.assertRaises(AssertionError):g.lexical_nodes('{"x":1,"x":2}')

    def test_exact_case_ids_input_spans_and_expected_outputs(self):
        doc=json.loads(g.CORPUS.read_text())
        self.assertEqual([x['id']for x in self.cases],[x['id']for key in ['positives','negatives']for x in doc[key]])
        self.assertEqual(len(set(x['id']for x in self.cases)),487)
        data=self.stages['decode_cases']
        expressions=re.findall(r"convert_from\(decode\('([0-9a-f]+)','hex'\),'UTF8'\)",data)
        self.assertEqual(len(expressions),974)
        for x,first,second in zip(self.cases,expressions[::2],expressions[1::2]):
            self.assertEqual(first,second)
            self.assertEqual(bytes.fromhex(first).decode(),x['lexical_input'])
            self.assertEqual(g.sha(bytes.fromhex(first)),x['input_sha256'])
        for key,token in [('schema_version_wrong_28','1.0'),('version_wrong_35','1.0'),('version_wrong_36','1.5')]:
            x=next(x for x in self.cases if x['id']==key)
            path='schema_version' if key.startswith('schema') else 'version'
            self.assertEqual(g.lexical_nodes(x['lexical_input'])[(path,)],token)

    def test_all_sql_and_plpgsql_parse(self):
        totals=[0,0]
        for name,sql in self.stages.items():
            with self.subTest(phase=name):
                totals[0]+=len(parse_sql(sql));totals[1]+=len(parse_plpgsql(sql))
        self.assertGreater(totals[0],600);self.assertGreater(totals[1],70)

    def test_exact_phases_batches_and_completion_outcomes(self):
        self.assertEqual(tuple(self.stages),g.PHASES);self.assertEqual(len(g.PHASES),25)
        expected=self.inventory['complete_expected_outcomes']
        self.assertEqual(set(expected),{x['id']for x in self.cases}|set(g.CONTROL_IDS)|set(g.BOUNDARY_IDS))
        self.assertEqual(len(expected),556)
        for kind,count in [('positive',70),('negative',417)]:
            phases=[(k,s)for k,s in self.stages.items()if k.startswith(kind+'_')]
            self.assertEqual(sum(s.count('insert into pg_temp.configuration_proof values')for k,s in phases),count)
            self.assertTrue(all(s.count('insert into pg_temp.configuration_proof values')<=25 for k,s in phases))
        final=self.stages['final_inventory']
        self.assertIn('jsonb_object_agg(id,outcome)',final)
        self.assertIn('is distinct from',final)

    def test_only_target_call_is_inside_accepted_negative_handler(self):
        caught=0
        for name,sql in self.stages.items():
            if not name.startswith('negative_'):continue
            for node in walk(parse_plpgsql(sql)):
                b=node.get('PLpgSQL_stmt_block')
                if b and b.get('exceptions'):
                    self.assertEqual(len(b['body']),1)
                    statement=b['body'][0]
                    self.assertEqual(set(statement),{'PLpgSQL_stmt_perform'})
                    self.assertIn('controlled_review_v3.validate_configuration(case_input)',str(statement))
                    self.assertNotIn('decode(',str(statement));caught+=1
            self.assertNotIn('when others',sql.lower())
            self.assertIn("actual_code <> '23514' or actual_message <> 'configuration_invalid'",sql)
        self.assertEqual(caught,417)

    def test_null_wire_and_alternate_session_controls_are_separate(self):
        sql=self.stages['null_wire_session_controls']
        self.assertIn('validate_configuration(NULL::jsonb)',sql)
        self.assertIn('untranslatable_character or invalid_text_representation',sql)
        self.assertNotIn('when others',sql.lower())
        self.assertIn("'target_called',false",sql)
        self.assertIn("set local timezone='Pacific/Honolulu'",sql)
        self.assertIn('rollback;',sql)
        self.assertIn("jsonb_typeof(input)='null'",self.stages['decode_cases'])
        self.assertTrue(all(self.inventory['complete_expected_outcomes'][x]=='decoder_observation_only'for x in ['nul_escape','unpaired_surrogate']))

    def test_stubs_guard_and_acl_requests_are_finite(self):
        sql=self.stages['stubs_guard_acl']
        self.assertEqual(len(g.STUBS),14)
        for fn in g.STUBS:self.assertIn("perform "+fn+"('{}'::jsonb);",sql)
        self.assertEqual(sql.count("actual_code <> '0A000'"),15)
        self.assertEqual(sql.count("actual_code <> '42501'"),45)
        self.assertIn('operation_claims(operation_id,actor_id,claimed_at)',sql)
        self.assertIn("'2026-01-01T00:00:00Z'::timestamptz",sql)
        self.assertEqual(sql.count('set local role '),3)
        self.assertIn("aclexplode(coalesce(item.proacl,acldefault('f',item.proowner)))",sql)
        self.assertNotRegex(sql.lower(),r'\bgrant\s+(execute|usage)\b')

    def test_full_conservation_after_every_observation_phase(self):
        for name,sql in self.stages.items():
            if name in ('decode_cases','capture_baseline'):continue
            self.assertIn('select pg_temp.configuration_conserved();',sql)
        baseline=self.stages['capture_baseline']
        for key in ('catalog','rows','types','ledger','parent','private206_literal','writers'):
            self.assertIn("'"+key+"'",baseline)
        self.assertIn("l.locktype='advisory'",baseline)
        self.assertIn("b.session_value=pg_temp.configuration_session()",baseline)
        self.assertEqual(sum(s.count('insert into pg_temp.configuration_baseline')for s in self.stages.values()),1)
        self.assertNotIn('update pg_temp.configuration_baseline',''.join(self.stages.values()))

    def test_no_install_or_runtimes_and_complete_input_hashes(self):
        sql=''.join(self.stages.values())
        self.assertNotIn('create function controlled_review_v3',sql.lower())
        for name,value in self.inventory['source_hashes'].items():
            self.assertEqual(g.sha((g.REPO/name).read_bytes()),value)
        self.assertTrue(self.inventory['source_integration']);self.assertFalse(self.inventory['runtime_executed'])
        with tempfile.TemporaryDirectory()as temporary:
            out=Path(temporary)/'fixed'
            g.write(out)
            with self.assertRaises(FileExistsError):g.write(out)
            self.assertEqual(len(list(out.glob('*.sql'))),25)


if __name__=='__main__':unittest.main(verbosity=2)
