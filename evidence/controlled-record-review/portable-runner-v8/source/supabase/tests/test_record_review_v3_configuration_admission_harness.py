"""Offline configuration artifact admission: no database/process/network activity."""
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

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'tests/controlled-drugs/engine/candidate'
sys.path.insert(0,str(SOURCE))
import record_review_v3_configuration_admission as admission


class ConfigurationAdmissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.process=patch.object(subprocess,'Popen',side_effect=AssertionError('No subprocess during admission'))
        cls.network=patch.object(socket,'socket',side_effect=AssertionError('No socket during admission'))
        cls.process.start();cls.network.start()
        cls.addClassCleanup(cls.process.stop);cls.addClassCleanup(cls.network.stop)
        cls.admitted=admission.admit();cls.package=cls.admitted['package']
        cls.raw=(SOURCE/admission.WRAPPER_FILE).read_bytes()
        cls.wrapper=admission.decode_wrapper(cls.raw)
        cls.temp=tempfile.TemporaryDirectory(prefix='lrv-configuration-admission-')
        cls.addClassCleanup(cls.temp.cleanup);cls.root=Path(cls.temp.name)
        for name in cls.wrapper['derivation_input_sha256']:
            target=cls.root/name;target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(ROOT/name,target)

    def reject(self,change,message):
        value=deepcopy(self.wrapper);change(value)
        with self.assertRaisesRegex(AssertionError,message):admission.validate_wrapper(value,self.package)

    def test_pure_regeneration_and_exact_254_plus_two_closure(self):
        self.assertEqual(admission.admit(),self.admitted)
        self.assertEqual(self.wrapper['definition'],self.package['expected'])
        self.assertEqual(len(self.wrapper['derivation_input_sha256']),254)
        self.assertEqual(len(self.wrapper['definition_source_sha256']),13)
        self.assertEqual(len(self.admitted['input_source_hashes']),256)
        self.assertEqual(set(self.admitted['input_source_hashes'])-set(self.wrapper['derivation_input_sha256']),{
            admission.PREFIX+admission.WRAPPER_FILE,admission.PREFIX+'record_review_v3_configuration_admission.py'})
        self.assertTrue(all('/' in name for name in self.wrapper['definition_source_sha256']))
        admission.validate_source_bytes(self.root,self.wrapper['derivation_input_sha256'])

    def test_only_offline_artifact_admission_is_true(self):
        self.assertIs(self.admitted['admitted_artifact'],True)
        for name in ('acceptance','adapter_acceptance','auth_acceptance','publication_acceptance',
                     'protocol_behavior_claim','clinical_acceptance','runtime_authorized'):
            self.assertIs(self.admitted[name],False)
        self.assertIs(self.wrapper['reference_provenance']['admitted_artifact_at_execution'],False)
        self.assertIs(self.wrapper['reference_provenance']['acceptance_at_execution'],False)
        self.assertEqual(self.admitted['database_operations'],0)
        self.assertNotIn('observed',self.wrapper)
        self.assertEqual(self.wrapper['reference_provenance']['kind'],'private-configuration-input-reference-v1')

    def test_kind_version_and_exact_wrapper_fields(self):
        self.reject(lambda x:x.update(kind='final-review'),'wrapper kind')
        for value in (True,1.0,'1',2,None):
            self.reject(lambda x:x.update(version=value),'wrapper version')
        self.reject(lambda x:x.update(acceptance=True),'wrapper keys')
        self.reject(lambda x:x.pop('reference_provenance'),'wrapper keys')

    def test_definition_forgery_and_forged_hash(self):
        self.reject(lambda x:x.update(definition_sha256='0'*64),'definition pin')
        self.reject(lambda x:x['definition'].update(kind='forged'),'definition bytes')
        value=deepcopy(self.wrapper);value['definition']['kind']='forged'
        value['definition_sha256']=admission.assembly.descriptor.sha(admission.assembly.descriptor.canonical(value['definition']).encode())
        with self.assertRaisesRegex(AssertionError,'definition pin'):admission.validate_wrapper(value,self.package)

    def test_poisoned_builder_definition_and_install(self):
        package=dict(self.package,expected=dict(self.package['expected'],kind='forged'))
        with self.assertRaisesRegex(AssertionError,'regeneration'):admission.validate_wrapper(self.wrapper,package)
        package=dict(self.package,install_sha256='0'*64)
        with self.assertRaisesRegex(AssertionError,'install changed'):admission.validate_wrapper(self.wrapper,package)
        self.reject(lambda x:x.update(install_sha256='0'*64),'install changed')

    def test_direct_inventory_add_delete_rename_and_drift(self):
        first=sorted(self.wrapper['definition_source_sha256'])[0]
        self.reject(lambda x:x['definition_source_sha256'].update(extra='0'*64),'source keyset')
        self.reject(lambda x:x['definition_source_sha256'].pop(first),'source keyset')
        def rename(x):x['definition_source_sha256']['different']=x['definition_source_sha256'].pop(first)
        self.reject(rename,'source keyset')
        self.reject(lambda x:x['definition_source_sha256'].update({first:'0'*64}),'source hashes')

    def test_full_inventory_add_delete_rename_and_drift(self):
        first=sorted(self.wrapper['derivation_input_sha256'])[0]
        self.reject(lambda x:x['derivation_input_sha256'].update(extra='0'*64),'full254')
        self.reject(lambda x:x['derivation_input_sha256'].pop(first),'full254')
        def rename(x):x['derivation_input_sha256']['different']=x['derivation_input_sha256'].pop(first)
        self.reject(rename,'source keyset or hashes')
        self.reject(lambda x:x['derivation_input_sha256'].update({first:'0'*64}),'source keyset or hashes')

    def test_matching_poisoned_source_map_cannot_replace_pin(self):
        value=deepcopy(self.wrapper);first=sorted(value['derivation_input_sha256'])[0]
        value['derivation_input_sha256'][first]='0'*64
        package=dict(self.package,input_source_hashes=value['derivation_input_sha256'])
        with self.assertRaisesRegex(AssertionError,'map pin'):admission.validate_wrapper(value,package)

    def test_reference_provenance_and_json_types_are_exact(self):
        for key,value in (('result_sha256','0'*64),('source_map_sha256','0'*64),
                          ('independent_review_sha256','0'*64),('source_input_count',614.0),
                          ('admitted_artifact_at_execution',True),('acceptance_at_execution',0)):
            self.reject(lambda x:x['reference_provenance'].update({key:value}),'reference provenance')
        self.reject(lambda x:x['reference_provenance'].update(extra=True),'reference provenance')

    def test_wrapper_byte_pin_and_duplicate_safe_decoder(self):
        with self.assertRaisesRegex(AssertionError,'wrapper file pin'):admission.decode_wrapper(self.raw+b'\n')
        # Isolate duplicate-key parsing from the already separately tested byte pin.
        duplicate=b'{"kind":"one","kind":"two"}'
        with patch.object(admission.assembly.descriptor,'sha',return_value=admission.WRAPPER_SHA256):
            with self.assertRaises((AssertionError,ValueError)):admission.decode_wrapper(duplicate)
        with self.assertRaisesRegex(AssertionError,'wrapper file pin'):admission.decode_wrapper(duplicate)

    def test_metadata_neutral_actual_source_drift_and_missing_file(self):
        name=admission.PREFIX+'record-review-v3-configuration-input.sql';path=self.root/name;raw=path.read_bytes()
        try:
            path.write_bytes(raw+b'\n-- unchanged metadata is not unchanged reviewed source\n')
            with self.assertRaisesRegex(AssertionError,'source bytes changed'):admission.validate_source_bytes(self.root,self.wrapper['derivation_input_sha256'])
            path.unlink()
            with self.assertRaisesRegex(AssertionError,'source file required'):admission.validate_source_bytes(self.root,self.wrapper['derivation_input_sha256'])
        finally:path.write_bytes(raw)

    def test_symlink_and_noncanonical_path_refusals(self):
        name=admission.PREFIX+'record-review-v3-configuration-input.sql';path=self.root/name;raw=path.read_bytes()
        target=self.root/'same-bytes.sql';target.write_bytes(raw)
        try:
            path.unlink();path.symlink_to(target)
            with self.assertRaisesRegex(AssertionError,'symlinks'):admission.validate_source_bytes(self.root,self.wrapper['derivation_input_sha256'])
        finally:path.unlink();path.write_bytes(raw);target.unlink()
        for name in ('../outside','/absolute','a/../b','./a',''):
            with self.assertRaisesRegex(AssertionError,'relative source path'):admission.validate_source_bytes(self.root,{name:'0'*64})

    def test_frozen_a1_and_gate_a_still_admit_without_mutation(self):
        import record_review_v3_gate_b_a1_admission as a1
        import record_review_v3_gate_a_admission as gate_a
        before=a1.admit();self.assertEqual(len(before['input_source_hashes']),248)
        self.assertEqual(len(gate_a.admit()['derivation_input_sha256']),235)
        self.assertTrue(all(self.admitted['derivation_input_sha256'][k]==v for k,v in before['input_source_hashes'].items()))
        self.assertEqual(before,a1.admit())

    def test_no_hash_cycle_or_private_path(self):
        for name in self.wrapper['derivation_input_sha256']:
            self.assertFalse(name.endswith('/'+admission.WRAPPER_FILE))
            self.assertFalse(name.endswith('/record_review_v3_configuration_admission.py'))
            self.assertFalse(Path(name).is_absolute());self.assertNotIn('tmp/',name)
        self.assertNotIn('/Users/',self.raw.decode());self.assertNotIn('/var/',self.raw.decode())


if __name__=='__main__':unittest.main()
