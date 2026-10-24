"""Integrated pure A2 profile tests. No DB, subprocess, socket or source write."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pglast import parse_sql, parse_plpgsql

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
SOURCE=ROOT/'tests/controlled-drugs/engine/candidate'
sys.path.insert(0,str(SOURCE))
import record_review_v3_gate_b_a1_admission as a1
import record_review_v3_gate_a_admission as gate_a
import record_review_v3_gate_b_a2 as assembly
import record_review_v3_gate_b_a2_descriptor as descriptor


def stage(destination):
    lineage=a1.admit(SOURCE)
    for relative in lineage['input_source_hashes']:
        target=destination/relative
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(ROOT/relative,target)
    source=destination/SOURCE.relative_to(ROOT)
    for name in descriptor.REVIEWED_A2_SOURCES:
        shutil.copy2(SOURCE/name,source/name)
    for name in ['record_review_v3_gate_b_a2_descriptor.py','record_review_v3_gate_b_a2.py']:
        shutil.copy2(SOURCE/name,source/name)
    return source


class ProfileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.no_process=patch.object(subprocess,'Popen',side_effect=AssertionError('Pure source assembly forbids subprocesses'))
        cls.no_network=patch.object(socket,'socket',side_effect=AssertionError('Pure source assembly forbids sockets'))
        cls.no_process.start();cls.no_network.start()
        cls.temp=tempfile.TemporaryDirectory(prefix='lrv-private-a2-profile-')
        cls.root=Path(cls.temp.name);cls.source=stage(cls.root)
        cls.original=a1.admit(cls.source)
        cls.package=assembly.build(cls.source)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup();cls.no_network.stop();cls.no_process.stop()

    def test_integrated_profile_matches_frozen_private_definition(self):
        direct=assembly.build(SOURCE)
        self.assertEqual(direct['expected_sha256'],'997955a567db36449969e22859744ce0b28a0d8e37d0bdccecfb8b38ee441aa7')
        self.assertEqual(direct['install_sha256'],'40ccec2d13e5bfe46e0bfb1054f9c115410abe2e8b9d48b85c1dea367cce6efd')
        self.assertEqual(direct['expected'],self.package['expected'])
        self.assertEqual(direct['install'],self.package['install'])
        self.assertEqual(direct['input_source_hashes'],self.package['input_source_hashes'])

    def test_exact_additive_254_canonical_paths(self):
        old=self.original['input_source_hashes'];new=self.package['input_source_hashes']
        self.assertEqual(len(old),248);self.assertEqual(len(new),254)
        self.assertTrue(all(new[k]==v for k,v in old.items()))
        expected={str((SOURCE/name).relative_to(ROOT)) for name in (*descriptor.REVIEWED_A2_SOURCES,'record_review_v3_gate_b_a2_descriptor.py','record_review_v3_gate_b_a2.py')}
        self.assertEqual(set(new)-set(old),expected)
        self.assertTrue(all('tmp/' not in x and not Path(x).is_absolute() for x in new))
        self.assertTrue(all(descriptor.sha((self.root/x).read_bytes())==v for x,v in new.items()))

    def test_exact_independent_32_function_delta(self):
        old=self.original['expected'];new=self.package['expected']
        descriptor.assert_exact_extension(new,old)
        self.assertEqual(len(new['functions']),32);self.assertEqual(len(new['relations']),13)
        changed={k for k in old['functions'] if old['functions'][k]!=new['functions'][k]}
        self.assertEqual(changed,{'controlled_review_v3.collect_event_sources(p_event_id uuid)','controlled_review_v3.snapshot()'})
        self.assertEqual(new['parents'],old['parents'])
        for key in set(old)-{'kind','functions'}:self.assertEqual(new[key],old[key])
        self.assertIs(self.package['acceptance'],False)
        self.assertIs(self.package['admitted_artifact'],False)
        self.assertIs(self.package['adapter_acceptance'],False)
        self.assertIs(self.package['auth_acceptance'],False)
        self.assertIs(self.package['protocol_behavior_claim'],False)

    def test_body_attribute_parent_and_catalog_expansion_refuse(self):
        old=self.original['expected']
        mutations=[
            lambda x:x['functions']['controlled_review_v3.required()'].update(source='begin return;end'),
            lambda x:x['functions']['controlled_review_v3.collect_event_sources(p_event_id uuid)'].update(security_definer=True),
            lambda x:x['functions']['controlled_review_v3.snapshot()'].update(source=x['functions']['controlled_review_v3.snapshot()']['source']+'\n'),
            lambda x:x['relations']['descriptor'].update(rls=False),
            lambda x:x['parents']['parent205'].update(revision=2),
            lambda x:x.update(unreviewed=True),
        ]
        for mutation in mutations:
            value=deepcopy(self.package['expected']);mutation(value)
            with self.assertRaises(AssertionError):descriptor.assert_exact_extension(value,old)

    def test_function_inventory_missing_extra_and_shared_drift_refuse(self):
        old=self.original['expected']
        for action in ['missing','extra','shared']:
            value=deepcopy(self.package['expected'])
            if action=='missing':value['functions'].pop('controlled_review_v3.adapter_opening_site(p_state jsonb, p_dispense_id uuid, p_product_id uuid)')
            elif action=='extra':value['functions']['controlled_review_v3.unreviewed()']={}
            else:value['functions']['controlled_review_v3.adapter_pickup(p_state jsonb, p_pickup_id uuid, p_product_id uuid, p_role text, p_depth integer)']['source']+='\n'
            with self.assertRaises(AssertionError):descriptor.assert_exact_extension(value,old)

    def test_reviewed_four_source_bytes_and_executed_profile_bytes_bound(self):
        for name in (*descriptor.REVIEWED_A2_SOURCES,'record_review_v3_gate_b_a2_descriptor.py','record_review_v3_gate_b_a2.py'):
            path=self.source/name;raw=path.read_bytes()
            try:
                path.write_bytes(raw+b'\n')
                with self.assertRaises(AssertionError):assembly.build(self.source)
            finally:path.write_bytes(raw)

    def test_old_a1_wrapper_and_metadata_neutral_source_drift_refuse(self):
        for name in [a1.WRAPPER_FILE,'record-review-v3-schema.sql','record_review_v3_gate_b_a1_admission.py']:
            path=self.source/name;raw=path.read_bytes()
            try:
                path.write_bytes(raw+b'\n')
                with self.assertRaises(AssertionError):assembly.build(self.source)
            finally:path.write_bytes(raw)
        extra=self.root/'supabase/migrations/20261024000000_unreviewed.sql'
        try:
            extra.write_text('select 1;\n')
            with self.assertRaises(AssertionError):assembly.build(self.source)
        finally:extra.unlink()

    def test_no_a1_or_gate_a_global_mutation(self):
        self.assertEqual(a1.admit(self.source),self.original)
        admitted=gate_a.admit(SOURCE)
        self.assertEqual(len(admitted['derivation_input_sha256']),235)
        self.assertEqual(admitted['definition_sha256'],'9f2228423a6807352d25784f9ebd94d1920f310228d89618577c4b5d977dbc45')
        self.assertIsNot(descriptor.TABLES,descriptor.frozen.TABLES)
        self.assertIsNot(descriptor.ENUMS,descriptor.frozen.ENUMS)
        self.assertEqual(self.package,assembly.build(self.source))

    def test_exact_fresh206_ledger_and_full_original_preservation(self):
        ledger=self.package['expected_ledger206']
        self.assertEqual(len(ledger),206)
        self.assertEqual(ledger,self.original['package']['expected_ledger206'])
        self.assertEqual(self.package['canonical206_binding'],self.original['package']['canonical206_binding'])
        self.assertIn('wholly absent',self.package['preflight_sql'])
        self.assertIn('begin;\n',self.package['install'])
        self.assertTrue(self.package['install'].endswith('commit;\n'))
        self.assertIn('pg_temp.record_review_v3_gate_b_a2_before',self.package['preservation_check_sql'])
        self.assertIn('pg_temp.record_review_v3_gate_b_a2_rows()',self.package['preservation_check_sql'])
        self.assertIn('pg_temp.record_review_v3_gate_b_a2_catalog()',self.package['preservation_check_sql'])
        for marker in self.package['markers'].values():self.assertEqual(self.package['install'].count(marker),1)
        self.assertNotIn('record_review_v3_gate_b_a2_a2',self.package['install'])

    def test_full_generated_sql_and_plpgsql_parse(self):
        statements=parse_sql(self.package['install'])
        functions=parse_plpgsql(self.package['install'])
        self.assertGreater(len(statements),400)
        self.assertGreater(len(functions),240)
        self.assertEqual(self.package['expected_sha256'],descriptor.sha(descriptor.canonical(self.package['expected']).encode()))
        self.assertEqual(self.package['install_sha256'],descriptor.sha(self.package['install'].encode()))

if __name__=='__main__':unittest.main()
