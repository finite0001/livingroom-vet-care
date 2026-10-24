"""Fail-closed pure contracts for genuine historical provenance rehearsal."""
import ast
import copy
import importlib.util
from pathlib import Path
from subprocess import CompletedProcess
import unittest

PATH = Path(__file__).with_name('stock_writer_historical_upgrade.py')
spec = importlib.util.spec_from_file_location('tested_stock_history', PATH)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def prior():
    names = ['adjust_inventory', 'receive_inventory', 'record_native_dispense',
             'record_patient_treatment', 'record_native_dispense_return',
             'record_native_dispense_return_v2', 'record_native_return_discrepancy',
             'record_anesthesia_drug_administration', 'record_native_pickup',
             'append_native_dispense_correction']
    return [{'writer': n, 'signature': 'public.' + n + '(uuid,jsonb)', 'prior_hash': 'a' * 64} for n in names]


class GenuineStockHistoryTests(unittest.TestCase):
    def test_ten_distinct_prior_hashes_are_required(self):
        self.assertEqual(len(m.validate_prior(prior())), 10)
        for bad in (prior()[:-1], prior() + [prior()[0]], {}, None):
            with self.assertRaises(AssertionError): m.validate_prior(bad)

    def test_duplicate_substituted_or_malformed_prior_metadata_refused(self):
        variants = []
        for field, value in [('writer', 'record_native_pickup'), ('signature', 'public.other(uuid,jsonb)'), ('prior_hash', 'z'*64), ('prior_hash', True)]:
            value_set = prior(); value_set[0][field] = value; variants.append(value_set)
        value_set = prior(); value_set[0]['adopted'] = True; variants.append(value_set)
        for bad in variants:
            with self.assertRaises(AssertionError): m.validate_prior(bad)

    def test_exact_primary_postgres_refusal_only(self):
        message = m.MESSAGES[187]
        m.require_failure(CompletedProcess([], 3, '', 'psql:<stdin>:236: ERROR:  23514: ' + message + '\nCONTEXT: protected\n'), message)
        for code, stderr in [(0, 'ERROR:  23514: '+message), (3, 'ERROR:  P0001: '+message), (3, 'CONTEXT: ERROR:  23514: '+message), (3, 'ERROR:  23514: other\nQUERY: '+message), (3, 'ERROR:  23514: '+message+' extra'), (3, 'ERROR:  23514: '+message+'\nERROR:  23514: '+message)]:
            with self.assertRaises(AssertionError): m.require_failure(CompletedProcess([], code, '', stderr), message)

    def test_replay_requires_all_original_relations_and_exact_one_audit(self):
        before = {'public.stock_writer_admissions': {'count': 2, 'sha256': 'a'*64}, 'public.native_dispenses': {'count': 1, 'sha256': 'b'*64}}
        after = copy.deepcopy(before); after['public.stock_writer_admissions'] = {'count': 3, 'sha256': 'c'*64}
        m.assert_replay_preservation(before, after)
        variants = []
        for key, value in [('count', 2), ('count', 4), ('sha256', 'a'*64)]:
            changed = copy.deepcopy(after); changed['public.stock_writer_admissions'][key] = value; variants.append(changed)
        changed = copy.deepcopy(after); changed['public.native_dispenses']['sha256'] = 'c'*64; variants.append(changed)
        changed = copy.deepcopy(after); del changed['public.native_dispenses']; variants.append(changed)
        for changed in variants:
            with self.assertRaises(AssertionError): m.assert_replay_preservation(before, changed)

    def test_handoff_expected_rows_derive_only_from_pinned_genuine_bodies(self):
        import hashlib
        definitions = {"public." + name + "(uuid,jsonb)": "CREATE OR REPLACE FUNCTION public." + name + "(uuid,jsonb) RETURNS jsonb LANGUAGE plpgsql AS $function$\nbegin\n return null;\nend$function$;\n" for name in m.HANDOFF}
        entries = [{'writer': name, 'signature': "public." + name + "(uuid,jsonb)", 'prior_hash': hashlib.sha256(definitions["public." + name + "(uuid,jsonb)"].encode()).hexdigest()} for name in m.HANDOFF]
        rows = m.expected_handoff_rows(entries, definitions)
        self.assertEqual({row['writer'] for row in rows}, m.HANDOFF)
        for row in rows:
            expected = definitions[row['signature']].replace('begin', "begin\n perform public.stock_writer_enter('" + row['writer'] + "',p_id);", 1)
            self.assertEqual(row['definition_sha256'], hashlib.sha256(expected.encode()).hexdigest())
            self.assertEqual(row['version'], 1)
        changed = copy.deepcopy(definitions); changed[entries[0]['signature']] += '-- drift'
        with self.assertRaises(AssertionError): m.expected_handoff_rows(entries, changed)

    def test_only_exact_eight_plus_two_manifest_rows_may_change(self):
        before = {'public.stock_writer_manifests': {'count': 8, 'sha256': 'a'*64}, 'public.native_dispenses': {'count': 6, 'sha256': 'b'*64}}
        after = copy.deepcopy(before); after['public.stock_writer_manifests'] = {'count': 10, 'sha256': 'c'*64}
        old = [{'writer': str(i), 'version': 1, 'signature': 'old' + str(i), 'definition_sha256': 'd'*64, 'prior_definition_sha256': 'e'*64} for i in range(8)]
        additions = [{'writer': name, 'version': 1, 'signature': name, 'definition_sha256': 'f'*64, 'prior_definition_sha256': 'a'*64} for name in m.HANDOFF]
        new = sorted(old + additions, key=lambda row: (row['writer'], row['version']))
        m.assert_upgrade_preservation(before, after, old, new, additions)
        for field in ('writer', 'version', 'signature', 'definition_sha256', 'prior_definition_sha256'):
            changed = copy.deepcopy(new); changed[0][field] = 'mutated'
            with self.assertRaises(AssertionError): m.assert_upgrade_preservation(before, after, old, changed, additions)
        for changed in (new[:-1], new + [new[0]]):
            with self.assertRaises(AssertionError): m.assert_upgrade_preservation(before, after, old, changed, additions)
        changed = copy.deepcopy(after); changed['public.native_dispenses']['sha256'] = 'e'*64
        with self.assertRaises(AssertionError): m.assert_upgrade_preservation(before, changed, old, new, additions)
        with self.assertRaises(AssertionError): m.assert_upgrade_preservation(before, after)

    def test_actual_prefix_cli_upgrade_and_no_epoch_reconstruction(self):
        source = PATH.read_text(); ast.parse(source)
        self.assertIn('replay.start(files[:era])', source)
        self.assertIn("to_regclass('public.controlled_stock_policy_versions')is null", source)
        self.assertNotIn('public.controlled_stock_policies', source)
        self.assertIn('replay.ledger(files[:era])', source)
        self.assertIn("'supabase', 'migration', 'up', '--local'", source)
        self.assertIn('replay.ledger(files[:era + 1])', source)
        self.assertIn("canonical_prefix.canonical_prefix(source, sorted((root / 'supabase/migrations').glob('*.sql')))", source)
        self.assertNotIn('drop table', source.lower())
        self.assertNotIn('disable trigger', source.lower())
        self.assertNotIn("replace(pg_get_functiondef", source)
        self.assertNotIn("replace('stock_writer_enter", source)

    def test_rollback_covers_catalog_ledger_and_old_rows(self):
        source = PATH.read_text()
        self.assertIn('require_failure(result, MESSAGES[era])', source)
        self.assertIn('replay.snapshot(columns) == before and _ledger(replay) == ledger_before', source)
        self.assertIn('_catalog(replay, atomic) == drift_catalog', source)
        self.assertIn("hashlib.sha256(definitions[e['signature']].encode()).hexdigest() == e['prior_hash']", source)
        self.assertIn('finally:\n        replay.cleanup()', source)
        self.assertLess(source.index('replay.cleanup()'), source.index("outcome['owned_runtime_removed'] = True"))

    def test_audit_proof_binds_all_actual_canonical_fields(self):
        source = PATH.read_text()
        for field in ('pg_backend_pid()', 'pg_postmaster_start_time()', 'txid_current()', 'transaction_timestamp()', 'statement_timestamp()', '__WRITER__', '__ID__', '__ACTOR__'):
            self.assertIn(field, source)
        self.assertIn('prior||jsonb_build_array(to_jsonb(expected_audit))', source)
        self.assertIn("receipt is distinct from __EXPECTED__::jsonb", source)
        self.assertNotIn('delete from stock_writer_admissions', source)

    def test_adapter_uses_receipts_without_adopting_false_flags(self):
        adapter = PATH.with_name('stock_writer_restore.py').read_text()
        self.assertIn('run_historical_upgrades(root,', adapter)
        self.assertNotIn('Reconstruct the real pre-C1a', adapter)
        self.assertNotIn("replace(pg_get_functiondef", adapter)
        self.assertNotIn('disable trigger immutable;delete from stock_writer_manifests', adapter)
        self.assertIn("is True", adapter)
        self.assertIn("'source_upgrade187'", adapter)
        self.assertIn("'handoff_upgrade188'", adapter)


if __name__ == '__main__':
    unittest.main()
