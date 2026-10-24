"""Pure negative contract cases using tiny synthetic catalogs, without SQL/Docker."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

SOURCE = Path(__file__).resolve().parents[2] / 'tests/controlled-drugs/engine/candidate/scalar_contract.py'
SPEC = importlib.util.spec_from_file_location('scalar_contract_proposal', SOURCE)
CONTRACT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTRACT)


class ScalarContractTests(unittest.TestCase):
    def setUp(self):
        shapes = [
            ('native_fulfillment_hash(jsonb)', 'native_fulfillment_hash', 'v jsonb', 'text', "SELECT 'public.native_fulfillment_hash('::text"),
            ('native_fulfillment_decimal(numeric)', 'native_fulfillment_decimal', 'n numeric', 'text', "SELECT 'synthetic decimal'::text"),
            ('native_fulfillment_receipt(native_fulfillment_operations)', 'native_fulfillment_receipt',
             'r public.native_fulfillment_operations', 'jsonb', "SELECT '{}'::jsonb"),
        ]
        self.catalog = {}
        self.trusted = {'definition': {'functions': {}}}
        for offset, (signature, name, arguments, result, body) in enumerate(shapes):
            definition = ('CREATE OR REPLACE FUNCTION public.' + name + '(' + arguments + ')\n'
                          ' RETURNS ' + result + '\n LANGUAGE sql\n IMMUTABLE\n'
                          " SET search_path TO 'public'\nAS $function$" + body + '$function$\n')
            self.catalog[signature] = {'name': name, 'definition': definition, 'language': 'sql', 'attributes': {
                'oid': 4100 + offset, 'prolang': 14, 'prosrc': body, 'proowner': 20,
                'proacl': ['owner=X/owner'], 'proconfig': ['search_path=public'],
                'procost': 100, 'proparallel': 'u', 'proisstrict': False, 'prosecdef': False}}
            self.trusted['definition']['functions'][signature] = {'sha256': self.sha(definition)}
        self.signature = shapes[0][0]
        self.before = CONTRACT.capture_originals(lambda query: copy.deepcopy(self.catalog), self.trusted)
        self.after = copy.deepcopy(self.catalog)
        for value in self.after.values():
            value['language'] = 'plpgsql'
            value['definition'] = value['definition'].replace('LANGUAGE sql', 'LANGUAGE plpgsql')
            value['attributes']['prolang'] = 13563
            value['attributes']['prosrc'] = 'BEGIN RETURN NULL; END'
        self.fixture = tempfile.TemporaryDirectory()
        self.addCleanup(self.fixture.cleanup)
        self.compatibility = Path(self.fixture.name) / 'differential.sql'
        self.compatibility.write_text('-- Synthetic contract input, never executed.\nbegin;\nselect 1;\nrollback;\n')
        self.result = {
            'kind': 'controlled-scalar-overlay-differential-v1', 'passed': True,
            'semantic_cases': 36, 'contract_checks': 6,
            'case_counts_by_family': {'hash': 10, 'decimal': 14, 'receipt': 12, 'contract': 6, 'memory': 1},
            'memory_regression': {'calls': 128, 'payload_characters': 16384,
                'canonical_context_name': 'SQL function', 'canonical_context_ident': 'native_fulfillment_hash',
                'before_contexts': 0, 'after_contexts': 0, 'before_total_bytes': 0, 'after_total_bytes': 0,
                'growth_bytes': 0, 'maximum_growth_bytes_exclusive': 262144,
                'parent_actual_helper_primed': True, 'all_repeated_outputs_match_independent_original': True,
                'pinned_environment_regression_only': True},
            'independent_original_204_sql_oracles': True, 'sql_only': True, 'genuine_auth_api': False,
            'source_data_writes': 0, 'clinical_or_register_activation': False, 'transaction_rolled_back': True,
        }

    @staticmethod
    def sha(value):
        return hashlib.sha256(value.encode()).hexdigest()

    def verify(self, after=None, result=None, before=None):
        callback = Mock(side_effect=[copy.deepcopy(self.after if after is None else after),
                                     copy.deepcopy(self.result if result is None else result)])
        proof = CONTRACT.verify_installation(callback, self.before if before is None else before, self.compatibility)
        return proof, callback

    def test_only_language_and_body_changes_pass_with_synthetic_catalog(self):
        _, callback = self.verify()
        self.assertEqual(callback.call_count, 2)
        self.assertIn('controlled_original_hash', callback.call_args_list[1].args[0])

    def test_capture_rejects_actual_definition_drift_against_trusted_digest(self):
        catalog = copy.deepcopy(self.catalog)
        catalog[self.signature]['definition'] += '\n-- changed actual definition\n'
        with self.assertRaises(AssertionError):
            CONTRACT.capture_originals(lambda query: catalog, self.trusted)

    def test_capture_rejects_changed_trusted_digest(self):
        trusted = copy.deepcopy(self.trusted)
        trusted['definition']['functions'][self.signature]['sha256'] = '0' * 64
        with self.assertRaises(AssertionError):
            CONTRACT.capture_originals(lambda query: self.catalog, trusted)

    def test_missing_or_additional_helper_cannot_be_captured(self):
        for mode in ('missing', 'extra'):
            catalog = copy.deepcopy(self.catalog)
            if mode == 'missing':
                catalog.pop(self.signature)
            else:
                catalog['native_fulfillment_hash(text)'] = copy.deepcopy(catalog[self.signature])
            with self.subTest(mode=mode), self.assertRaises(AssertionError):
                CONTRACT.capture_originals(lambda query: catalog, self.trusted)

    def test_confusing_function_name_is_rejected(self):
        catalog = copy.deepcopy(self.catalog)
        catalog[self.signature]['name'] = 'another_hash'
        with self.assertRaises(AssertionError):
            CONTRACT.capture_originals(lambda query: catalog, self.trusted)

    def test_owner_acl_config_cost_parallel_oid_and_extra_attribute_changes_fail(self):
        changes = {'proowner': 21, 'proacl': ['anon=X/owner'], 'proconfig': ['search_path=public', 'TimeZone=UTC'],
                   'procost': 99, 'proparallel': 's', 'oid': 9999, 'unreviewed_attribute': True}
        for attribute, value in changes.items():
            after = copy.deepcopy(self.after)
            after[self.signature]['attributes'][attribute] = value
            with self.subTest(attribute=attribute), self.assertRaises(AssertionError):
                self.verify(after=after)

    def test_missing_attribute_or_missing_after_helper_fails(self):
        for mode in ('attribute', 'helper'):
            after = copy.deepcopy(self.after)
            if mode == 'attribute':
                after[self.signature]['attributes'].pop('proconfig')
            else:
                after.pop(self.signature)
            with self.subTest(mode=mode), self.assertRaises(AssertionError):
                self.verify(after=after)

    def test_changing_only_one_of_two_authorized_attributes_is_not_complete_overlay(self):
        for unchanged in ('prolang', 'prosrc'):
            after = copy.deepcopy(self.after)
            after[self.signature]['attributes'][unchanged] = self.catalog[self.signature]['attributes'][unchanged]
            with self.subTest(unchanged=unchanged), self.assertRaises(AssertionError):
                self.verify(after=after)

    def test_oracle_changes_only_header_namespace_and_name_and_adds_terminators(self):
        sql = CONTRACT.build_oracles(self.before)
        for signature, original in self.catalog.items():
            suffix = original['name'].removeprefix('native_fulfillment_')
            old_header = 'CREATE OR REPLACE FUNCTION public.' + original['name'] + '('
            new_header = 'CREATE OR REPLACE FUNCTION pg_temp.controlled_original_' + suffix + '('
            expected = original['definition'].replace(old_header, new_header, 1).rstrip() + ';'
            self.assertIn(expected, sql)
        self.assertIn("SELECT 'public.native_fulfillment_hash('::text", sql)
        self.assertEqual(sql.count('CREATE OR REPLACE FUNCTION pg_temp.'), 3)

    def test_oracle_rejects_definition_and_cached_digest_tampering(self):
        for change_cached in (False, True):
            before = copy.deepcopy(self.before)
            value = before['functions'][self.signature]
            value['definition'] += '\n-- injected source drift\n'
            if change_cached:
                value['definition_sha256'] = self.sha(value['definition'])
            with self.subTest(change_cached=change_cached), self.assertRaises(AssertionError):
                CONTRACT.build_oracles(before)

    def test_oracle_rejects_changed_header_even_with_synthetic_hashes_rebound(self):
        before = copy.deepcopy(self.before)
        record = before['functions'][self.signature]
        record['definition'] = record['definition'].replace('FUNCTION public.native_fulfillment_hash(',
                                                           'FUNCTION unowned.native_fulfillment_hash(', 1)
        digest = self.sha(record['definition'])
        for key in ('definition_sha256', 'trusted_definition_sha256'):
            if key in record:
                record[key] = digest
        with self.assertRaises(AssertionError):
            CONTRACT.build_oracles(before)

    def test_false_passed_or_malformed_case_counts_fail(self):
        mutations = [('passed', False), ('passed', 1), ('semantic_cases', 35), ('semantic_cases', True),
                     ('contract_checks', 5), ('contract_checks', '6')]
        for key, value in mutations:
            result = copy.deepcopy(self.result);result[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(AssertionError):
                self.verify(result=result)
        for family in self.result['case_counts_by_family']:
            result = copy.deepcopy(self.result);result['case_counts_by_family'][family] += 1
            with self.subTest(family=family), self.assertRaises(AssertionError):
                self.verify(result=result)

    def test_memory_threshold_boundary_negative_growth_and_false_evidence_fail(self):
        mutations = {'growth_bytes': [262144, 262145, -1, True, '0'], 'calls': [127, True],
                     'payload_characters': [16383], 'maximum_growth_bytes_exclusive': [1048576],
                     'parent_actual_helper_primed': [False], 'all_repeated_outputs_match_independent_original': [False]}
        for key, values in mutations.items():
            for value in values:
                result = copy.deepcopy(self.result);result['memory_regression'][key] = value
                with self.subTest(key=key, value=value), self.assertRaises(AssertionError):
                    self.verify(result=result)

    def test_memory_growth_one_byte_below_ceiling_and_zero_contexts_pass(self):
        result = copy.deepcopy(self.result)
        result['memory_regression'].update(growth_bytes=262143, after_total_bytes=262143, after_contexts=1)
        self.verify(result=result)

    def test_missing_or_false_independent_evidence_flags_fail(self):
        mutations = {'independent_original_204_sql_oracles': False, 'transaction_rolled_back': False,
                     'source_data_writes': 1, 'clinical_or_register_activation': True,
                     'sql_only': False, 'genuine_auth_api': True}
        for key, value in mutations.items():
            for mode in ('false', 'missing'):
                result = copy.deepcopy(self.result)
                if mode == 'missing':
                    result.pop(key)
                else:
                    result[key] = value
                with self.subTest(key=key, mode=mode), self.assertRaises(AssertionError):
                    self.verify(result=result)

    def test_compatibility_must_own_one_rollback_transaction(self):
        for contents in ('select 1;\nrollback;', 'begin;\nselect 1;\ncommit;',
                         'select 1;\nbegin;\nrollback;', 'begin;\nbegin;\nrollback;'):
            self.compatibility.write_text(contents)
            with self.subTest(contents=contents), self.assertRaises(AssertionError):
                self.verify()

    def test_text_callback_supports_one_json_and_refuses_ambiguous_observations(self):
        callback = Mock(side_effect=['SET\n' + json.dumps(self.after) + '\n',
                                     'SET\n' + json.dumps(self.result) + '\nROLLBACK\n'])
        CONTRACT.verify_installation(callback, self.before, self.compatibility)
        for value in ('no JSON output', json.dumps(self.after) + '\n' + json.dumps(self.after)):
            with self.subTest(value=value[:30]), self.assertRaises(AssertionError):
                CONTRACT.capture_originals(lambda query: value, self.trusted)

    def test_incidental_empty_json_before_final_scalar_result_is_rejected(self):
        callback = Mock(side_effect=[copy.deepcopy(self.after), '{}\n' + json.dumps(self.result) + '\n'])
        with self.assertRaisesRegex(AssertionError, 'Exactly one scalar JSON observation required'):
            CONTRACT.verify_installation(callback, self.before, self.compatibility)
        self.assertEqual(callback.call_count, 2)

    def test_sanitized_proof_excludes_definitions_and_raw_acl(self):
        proof, _ = self.verify()
        text = json.dumps(proof)
        for value in self.catalog.values():
            self.assertNotIn(value['definition'], text)
            self.assertNotIn(value['attributes']['prosrc'], text)
        self.assertNotIn('owner=X/owner', text)
        self.assertEqual(proof['semantic_cases'], 36)
        self.assertEqual(proof['memory_checks'], 1)

    def test_oracle_rejects_relabelled_or_regenerated_capture(self):
        for key, value in (('kind', 'untrusted'), ('trusted_reference_regenerated', True)):
            before = copy.deepcopy(self.before);before[key] = value
            with self.subTest(key=key), self.assertRaises(AssertionError):
                CONTRACT.build_oracles(before)


if __name__ == '__main__':
    unittest.main()
