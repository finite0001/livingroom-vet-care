"""Pure stored-configuration assembly proof; no process/socket/database access."""
from copy import deepcopy
import json
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pglast import parse_sql,parse_plpgsql
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
SOURCE=ROOT/'tests/controlled-drugs/engine/candidate'
sys.path[:0]=[str(SOURCE)]
import record_review_v3_configuration_admission as frozen
import record_review_v3_configuration_record_profile as profile
import record_review_v3_configuration_record_descriptor as descriptor

def stage(root):
    admitted=frozen.admit()
    for name in admitted['input_source_hashes']:
        out=root/name;out.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/name,out)
    source=root/SOURCE.relative_to(ROOT)
    for name in profile.NEW_NAMES:
        origin=SOURCE/name
        shutil.copy2(origin,source/name)
    return source

class ProfileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.no_process=patch.object(subprocess,'Popen',side_effect=AssertionError('Pure profile forbids processes'))
        cls.no_network=patch.object(socket,'socket',side_effect=AssertionError('Pure profile forbids sockets'))
        cls.no_process.start();cls.no_network.start()
        cls.temp=tempfile.TemporaryDirectory(prefix='lrv-private-record-profile-')
        cls.root=Path(cls.temp.name);cls.source=stage(cls.root)
        cls.base=frozen.admit();cls.package=profile.build(cls.source,cls.source)
    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup();cls.no_network.stop();cls.no_process.stop()
    def test_exact267_lineage_and_paths(self):
        old=self.base['input_source_hashes'];new=self.package['input_source_hashes']
        self.assertEqual(len(old),256);self.assertEqual(len(new),267)
        self.assertTrue(all(new[n]==h for n,h in old.items()))
        self.assertEqual(set(new)-set(old),{str((SOURCE/n).relative_to(ROOT))for n in profile.NEW_NAMES})
        self.assertTrue(all(not Path(n).is_absolute()and 'tmp/'not in n for n in new))
        self.assertTrue(all(descriptor.sha((self.root/n).read_bytes())==h for n,h in new.items()))
    def test_exact37_function_full_metadata_delta(self):
        expected=self.package['expected'];before=self.base['expected'];profile.finite_delta(before,expected,self.source)
        self.assertEqual(len(expected['functions']),37);self.assertEqual(len(expected['relations']),13)
        self.assertEqual(len(expected['foreign_key_triggers']),60)
        self.assertEqual(expected['parents'],before['parents'])
        self.assertEqual(set(expected['functions'])-set(before['functions']),{'controlled_review_v3.'+n+'('+a+' jsonb)'for n,a,_ in descriptor.NEW_DECLARATIONS})
        self.assertEqual({k for k in before['functions'] if before['functions'][k]!=expected['functions'][k]}, {'controlled_review_v3.required()','controlled_review_v3.snapshot()'})
    def test_old_body_attribute_table_parent_and_new_function_drift_refuse(self):
        changes=[lambda x:x['functions']['controlled_review_v3.required()'].update(source='begin return;end'),
            lambda x:x['functions']['controlled_review_v3.validate_configuration(p_request jsonb)'].update(strict=True),
            lambda x:x['functions']['controlled_review_v3.configuration_record(p_row jsonb)'].update(security_definer=True),
            lambda x:x['relations']['descriptor'].update(rls=False),lambda x:x['parents']['parent205'].update(revision=2),
            lambda x:x['functions'].pop('controlled_review_v3.validate_calendar_observation(p_request jsonb)'),lambda x:x.update(unreviewed=True)]
        for change in changes:
            candidate=deepcopy(self.package['expected']);change(candidate)
            with self.assertRaises((AssertionError,KeyError)):profile.finite_delta(self.base['expected'],candidate,self.source)
    def test_all_new_sources_and_old_admission_copy_drift_refuse(self):
        for name in sorted(profile.NEW_NAMES|{'record_review_v3_configuration_admission.py','record_review_v3_configuration_expected.json','record-review-v3-configuration-input.sql'}):
            path=self.source/name;raw=path.read_bytes()
            try:
                path.write_bytes(raw+b'\n')
                with self.assertRaises(AssertionError):profile.build(self.source,self.source)
            finally:path.write_bytes(raw)
    def test_unreviewed_extra_staged_migration_refuses(self):
        extra=self.root/'supabase/migrations/20261024000000_unreviewed.sql'
        try:
            extra.write_text('select 1;\n')
            with self.assertRaises(AssertionError):profile.build(self.source,self.source)
        finally:extra.unlink()

    def test_full_frozen206_ledger_and_transaction_preservation(self):
        p=self.package;old=self.base['package']
        self.assertEqual(p['expected_ledger206'],old['expected_ledger206']);self.assertEqual(len(p['expected_ledger206']),206)
        self.assertEqual(p['canonical206_binding'],old['canonical206_binding'])
        self.assertIn('wholly absent',p['preflight_sql']);self.assertTrue(p['install'].startswith('begin;\n'));self.assertTrue(p['install'].endswith('commit;\n'))
        self.assertEqual(p['preservation_sql'],old['preservation_sql'])
        for marker in p['markers'].values():self.assertEqual(p['install'].count(marker),1)
    def test_new_metadata_and_hashes_repeat_without_mutating_frozen_modules(self):
        self.assertEqual(self.base,frozen.admit());self.assertEqual(self.package,profile.build(self.source,self.source))
        self.assertEqual(self.package['expected_sha256'],descriptor.sha(descriptor.canonical(self.package['expected']).encode()))
        self.assertEqual(self.package['install_sha256'],descriptor.sha(self.package['install'].encode()))
        self.assertIsNot(descriptor.TABLES,descriptor.base.TABLES);self.assertEqual(descriptor.TABLES,descriptor.base.TABLES)
    def test_direct_canonical_reproduces_reviewed_profile_and_distinct_profile_refuses(self):
        direct=profile.build()
        self.assertEqual(direct,self.package)
        self.assertEqual(direct['expected_sha256'],'fec2ff871f064a124ae3a0fb5ba60e36b8b58dda1932393cd656c43cd68abd7d')
        self.assertEqual(direct['install_sha256'],'22021a314fc196efa822a16ca30d25c7f9f6e70811703fe60eb747d92280d542')
        with self.assertRaises(AssertionError):profile.build(self.source,HERE)
    def test_no_admission_runtime_or_authority_claim(self):
        for field in ('acceptance','configuration_publication_implemented','auth_acceptance','source_integration','runtime_executed','admitted_artifact','protocol_behavior_claim'):
            self.assertIs(self.package[field],False)
        self.assertEqual(self.package['hosted_writes'],0)
    def test_all_sql_and_plpgsql_mandatory_parse(self):
        statements=parse_sql(self.package['install']);functions=parse_plpgsql(self.package['install'])
        self.assertGreater(len(statements),400);self.assertGreater(len(functions),240)

if __name__=='__main__':unittest.main()
