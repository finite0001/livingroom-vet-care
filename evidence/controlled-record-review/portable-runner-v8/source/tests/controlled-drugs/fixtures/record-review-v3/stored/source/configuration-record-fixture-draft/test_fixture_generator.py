"""Mandatory offline SQL/PLpgSQL and adversarial source-generator tests."""
from contextlib import ExitStack
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
import json
import os
import re
import socket
import subprocess
import unittest

from pglast import parse_sql, parse_plpgsql
import fixture_generator as g


def walk(value):
    if isinstance(value, dict):
        yield value
        for item in value.values():
            yield from walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk(item)


def forbidden_environment():
    context = ExitStack()
    for owner, names in [(subprocess, ('Popen','run','call','check_call','check_output')), (socket, ('socket','create_connection')), (os, ('system','fork','posix_spawn','posix_spawnp'))]:
        for name in names:
            if hasattr(owner, name):
                context.enter_context(patch.object(owner, name, side_effect=AssertionError('forbidden process/socket operation: ' + name)))
    return context


class FixtureGeneratorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with forbidden_environment():
            cls.stages, cls.inventory = g.compile_stages()
            cls.cases, cls.renders, cls.inputs = g.load_inputs()
        cls.by_id = {case['id']: case for case in cls.cases}

    def test_all_sql_and_plpgsql_parse_mandatory(self):
        totals = [0, 0]
        for name, sql in self.stages.items():
            with self.subTest(phase=name):
                totals[0] += len(parse_sql(sql))
                totals[1] += len(parse_plpgsql(sql))
        self.assertGreater(totals[0], 3600)
        self.assertGreater(totals[1], 80)
        print('MANDATORY_PARSE_TOTALS', totals, flush=True)

    def test_process_socket_forbidden_full_compile(self):
        with forbidden_environment():
            stages, inventory = g.compile_stages()
        self.assertEqual(stages, self.stages)
        self.assertEqual(inventory['source_hashes'], self.inventory['source_hashes'])
        self.assertFalse(inventory['runtime_executed'])

    def test_source_pins_fail_before_generation(self):
        original = Path.read_bytes
        attacked = [g.ROOT/'configuration-record-vectors/cases.json', g.ROOT/'configuration-record-boundary-vectors/cases.json',
                    g.HERE/'observer-inputs.json', g.HERE/'guard-input.json', g.CANDIDATE/'canonical_post206.py', g.PLAN]
        for target in attacked:
            def changed(path):
                raw = original(path)
                return raw+b' ' if path == target else raw
            with self.subTest(path=str(target)), patch.object(Path, 'read_bytes', changed), self.assertRaises(ValueError):
                g.compile_stages()

    def test_case_id_dispatch_outcome_and_null_adversaries(self):
        base = deepcopy(self.cases[0])
        for change in [('id','bad\nidentifier'), ('function','pg_sleep'), ('argument_kind','wire'), ('id',"x'); select 1;--")]:
            malformed = deepcopy(base); malformed[change[0]] = change[1]
            with self.subTest(change=change), self.assertRaises(ValueError):
                g.admit_cases([malformed])
        with self.assertRaises(ValueError):
            g.admit_cases([base, deepcopy(base)])
        malformed = deepcopy(base); malformed['expected'] = {'outcome':'error','sqlstate':'22007','message':'configuration_invalid'}
        with self.assertRaises(ValueError):
            g.admit_cases([malformed])
        malformed = deepcopy(base); malformed['argument_kind']='sql_null'
        with self.assertRaises(ValueError):
            g.admit_cases([malformed])
        malformed = deepcopy(base); malformed['argument_jsonb_text']='{"a":1,"a":2}'
        malformed['argument_utf8_bytes']=len(malformed['argument_jsonb_text'])
        with self.assertRaises(ValueError):
            g.admit_cases([malformed])
        malformed = deepcopy(base); malformed['argument_jsonb_text']='{'; malformed['argument_utf8_bytes']=1
        with self.assertRaises(json.JSONDecodeError):
            g.admit_cases([malformed])

    def test_lexical_numeric_tokens_and_hex_safety(self):
        first = self.by_id['primitive/Q/version-visible-fraction']
        second = self.by_id['primitive/pair/receipt-version-visible-fraction']
        self.assertEqual(g.decode(first['argument_jsonb_text'])['version'].as_tuple().exponent, -1)
        self.assertEqual(g.decode(second['argument_jsonb_text'])['publication']['receipt']['version'].as_tuple().exponent, -1)
        self.assertIsInstance(g.decode('1.0'), Decimal)
        attack = "'); select pg_sleep(1);--\n火"
        expression = g.encoded(attack)
        self.assertNotIn('pg_sleep', expression)
        self.assertEqual(bytes.fromhex(re.search("decode\\('([0-9a-f]+)'", expression).group(1)).decode(), attack)

    def test_exact_frozen_case_inventory_and_counts(self):
        self.assertEqual(len(self.cases), 1594)
        self.assertEqual(sum(case['expected']['outcome']=='success' for case in self.cases),204)
        self.assertEqual(sum(case['expected']['outcome']=='error' for case in self.cases),1390)
        self.assertEqual(sum(case['argument_kind']=='sql_null' for case in self.cases),4)
        self.assertEqual(g.sha(('\n'.join(sorted(self.by_id))+'\n').encode()),g.CASE_IDS_SHA)
        executed=[]
        for name, sql in self.stages.items():
            if name.startswith(('success_', 'refusal_')):
                executed.extend(re.findall(r"insert into pg_temp.cr_proof\(id,outcome\)values\('([^']+)'",sql))
        self.assertEqual(len(executed),1594)
        self.assertEqual(set(executed),set(self.by_id))

    def test_every_distinct_literal_and_expected_has_render_gate(self):
        canonical = {row['raw'] for row in self.renders if row['raw']==row['rendered']}
        for case in self.cases:
            if case['argument_kind']=='jsonb':
                self.assertIn(case['argument_jsonb_text'],canonical)
            if case['expected']['outcome']=='success':
                self.assertIn(case['expected']['return_jsonb_text'],canonical)
        self.assertEqual(len(self.renders),1788)
        preimages=[row for row in self.renders if row['preimage_digest'] is not None]
        self.assertTrue(preimages)
        for row in preimages:
            self.assertEqual(g.sha(row['raw'].encode()),row['preimage_digest'])
        # A deliberate bad target record hash is only renderer input, not an
        # asserted good digest of that record's payload.
        bad=self.by_id['hash/R/record_hash/wrong']['argument_jsonb_text']
        entries=[row for row in self.renders if row['raw']==bad]
        self.assertTrue(entries)
        self.assertTrue(all(row['preimage_digest'] is None for row in entries))

    def test_preflight_decode_and_expected_are_before_first_target(self):
        names=list(self.stages)
        first=next(i for i,name in enumerate(names)if name.startswith('success_'))
        self.assertLess(names.index('renderer_and_case_gate'),first)
        self.assertLess(names.index('capture_baseline'),first)
        setup=self.stages['setup']
        self.assertLess(setup.index('record_fixture_direct_postgres_origin_required'),setup.index('create temp table'))
        self.assertIn("argument_kind='jsonb'and argument_text is not null and argument_value is not null",setup)
        self.assertIn("outcome='literal_success'and expected_text is not null and expected_value is not null",setup)
        for name in names[:first]:
            sql=self.stages[name]
            for target in g.TARGETS:
                self.assertNotIn('controlled_review_v3.'+target+'(',sql)
            if name.startswith('render_'):
                self.assertNotIn('exception when',sql)
                self.assertIn("convert_to(case_input::text,'UTF8')",sql)
                self.assertIn("encode(sha256(convert_to(item.raw_text,'UTF8')),'hex')",sql)
            if name.startswith('decode_'):
                self.assertTrue(all(type(statement.stmt).__name__=='InsertStmt' for statement in parse_sql(sql)))
                self.assertEqual(parse_plpgsql(sql),[])
                self.assertIn('v.a::jsonb',sql)
                self.assertIn('v.e::jsonb',sql)

    def test_refusal_handler_contains_only_intended_target(self):
        count=0
        for name, sql in self.stages.items():
            if not name.startswith('refusal_'):
                continue
            self.assertNotIn('when others',sql.lower())
            for node in walk(parse_plpgsql(sql)):
                body=node.get('PLpgSQL_stmt_block')
                if body and body.get('exceptions'):
                    self.assertEqual(len(body['body']),1)
                    statement=body['body'][0]
                    self.assertEqual(set(statement),{'PLpgSQL_stmt_perform'})
                    self.assertRegex(str(statement),r'controlled_review_v3\.(validate_stored_configuration|validate_configuration_record|configuration_record|validate_configuration_pair)\(case_input\)')
                    self.assertNotIn('decode(',str(statement))
                    query=statement['PLpgSQL_stmt_perform']['expr']['PLpgSQL_expr']['query']
                    self.assertRegex(query,r'^SELECT controlled_review_v3\.(validate_stored_configuration|validate_configuration_record|configuration_record|validate_configuration_pair)\(case_input\)$')
                    count+=1
            self.assertIn("actual_code <> '23514'",sql)
            self.assertIn('actual_message <> ',sql)
        self.assertEqual(count,1390)

    def test_full_literal_success_not_hash_or_jsonb_equality_only(self):
        for name, sql in self.stages.items():
            if name.startswith('success_'):
                self.assertIn('returned is distinct from expected_value',sql)
                self.assertIn("convert_to(returned::text,'UTF8') is distinct from convert_to(expected_text,'UTF8')",sql)
                self.assertIn('select c.argument_value,c.expected_value,c.expected_text into strict',sql)
                self.assertNotIn('public.controlled_stock_hash',sql)

    def test_three_zone_rollback_controls_all_four_helpers(self):
        for index, zone in enumerate(g.ZONES):
            sql=self.stages['zone_%02d'%index]
            self.assertIn('set local timezone='+g.quote(zone),sql)
            self.assertEqual(sql.count('rollback;'),1)
            self.assertIn('pg_temp.cr_context',sql)
            self.assertIn('record_fixture_zone_context_leaked',sql)
            for helper in g.TARGETS:
                self.assertIn('controlled_review_v3.'+helper+'(case_input)',sql)
            self.assertEqual(sql.count('insert into pg_temp.cr_proof'),len(g.ZONE_CASES))
            self.assertIn(g.conservation(),sql)

    def test_guard_paths_and_no_permanent_bypass(self):
        setup=self.stages['setup']; sql=self.stages['stubs_and_guards']
        self.assertEqual(len(g.STUBS),14)
        for function in g.STUBS:
            self.assertIn('perform '+function+'(case_input);',sql)
        for guard in g.GUARDS:
            self.assertIn('execute function controlled_review_v3.'+guard+'()',setup)
            self.assertIn('insert into pg_temp.cr_guard_'+guard+'(id)values(1);',sql)
        self.assertIn('deferrable initially immediate',setup)
        self.assertIn('insert into controlled_review_v3.operation_claims(',sql)
        self.assertNotIn('disable trigger',''.join(self.stages.values()).lower())
        self.assertNotIn("session_replication_role='replica'",''.join(self.stages.values()).lower())
        self.assertNotIn('create function controlled_review_v3',''.join(self.stages.values()).lower())

    def test_all_acl_functions_roles_and_metadata(self):
        self.assertEqual(len(g.ACL_FUNCTIONS),20)
        sql=self.stages['all_metadata_acl']
        self.assertIn('<>37',sql);self.assertIn('<>13',sql)
        for token in ['aclexplode','has_schema_privilege','has_function_privilege','has_table_privilege','has_any_column_privilege']:
            self.assertIn(token,sql)
        for role in g.ROLES:
            sql=self.stages['role_'+role]
            self.assertIn('set local role '+role,sql)
            self.assertEqual(sql.count("actual_code <> '42501'"),20)
            self.assertEqual(sql.count('rollback;'),1)
            for function in g.ACL_FUNCTIONS:
                self.assertIn('perform '+function+'(case_input);',sql)
            self.assertIn(g.conservation(),sql)

    def test_full_state_and_exact_temp_baseline(self):
        setup=self.stages['setup']; baseline=self.stages['capture_baseline']
        for token in ['catalog','rows','types','ledger','parent','parent_literal','writers','private206','private206_literal']:
            self.assertIn("'"+token+"'",setup)
        for key in g.GUC_KEYS:
            self.assertIn(g.quote(key),setup)
        for auth in ['auth.uid()','auth.role()','auth.email()']:
            self.assertIn(auth,setup)
        self.assertIn("l.locktype='advisory'",setup)
        self.assertIn('pg_temp.cr_temp_structure()',setup)
        self.assertIn('record_fixture_temp_scaffolding_inventory',baseline)
        self.assertEqual(sum(sql.count('insert into pg_temp.cr_baseline')for sql in self.stages.values()),1)
        for name,sql in self.stages.items():
            if name.startswith(('success_','refusal_','zone_','role_'))or name in ['stubs_and_guards','all_metadata_acl','final_inventory']:
                self.assertIn(g.conservation(),sql)

    def test_fixed_phases_bounds_and_full_outcome_inventory(self):
        self.assertEqual(len(self.stages),93)
        self.assertEqual(self.inventory['phase_names'],list(self.stages))
        self.assertEqual(self.inventory['phase_seconds'],120)
        self.assertEqual(self.inventory['whole_seconds'],600)
        self.assertEqual(self.inventory['absolute_cutoff_seconds_before_outer_deadline'],60)
        self.assertEqual(self.inventory['single_emergency_cleanup_seconds'],180)
        self.assertEqual(self.inventory['stream_limit_bytes'],128*1024*1024)
        self.assertLess(self.inventory['total_sql_bytes'],128*1024*1024)
        expected=self.inventory['complete_expected_outcomes']
        self.assertEqual(len(expected),1727)
        self.assertTrue(set(self.by_id)<=set(expected))
        self.assertIn('jsonb_object_agg(id,outcome)',self.stages['final_inventory'])
        for name,sql in self.stages.items():
            self.assertEqual(self.inventory['phases'][name],{'sha256':g.sha(sql.encode()),'bytes':len(sql.encode())})

    def test_closed_observer_input_map_and_all_sources_unchanged(self):
        self.assertEqual(len(json.loads((g.HERE/'observer-inputs.json').read_text())),14)
        for name,digest in self.inventory['source_hashes'].items():
            self.assertEqual(g.sha((g.REPO/name).read_bytes()),digest,name)
        self.assertEqual(self.inventory['observer_setup_delta'],'remove exact leading SET TimeZone UTC only; preserve caller context')
        self.assertFalse(self.inventory['metadata_oracle_imported_from_target'])
        self.assertNotIn('configuration-record-implementation','\n'.join(self.inventory['source_hashes']))

    def test_no_output_overwrite_or_arbitrary_directory(self):
        with self.assertRaises(ValueError):
            g.write_new(Path('/tmp/not-authorized-fixture-output'))
        with forbidden_environment(),self.assertRaises(FileExistsError):
            g.write_new(g.HERE/'history')


if __name__ == '__main__':
    unittest.main(verbosity=2)
