"""Offline frozen Gate-A admission negatives; no runtime acceptance claim."""
from copy import deepcopy
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'tests/controlled-drugs/engine/candidate'
sys.path.insert(0,str(SOURCE))
import record_review_v3_gate_a_admission as admission


class RecordReviewV3GateAAdmissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.admitted=admission.admit()
        cls.package=cls.admitted['package']
        cls.wrapper=json.loads((SOURCE/admission.WRAPPER_FILE).read_text())
        cls.temporary=tempfile.TemporaryDirectory()
        cls.root=Path(cls.temporary.name)
        for relative in cls.admitted['input_source_hashes']:
            target=cls.root/relative
            target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(ROOT/relative,target)
        cls.source=cls.root/SOURCE.relative_to(ROOT)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def reject(self, change, message):
        value=deepcopy(self.wrapper)
        change(value)
        with self.assertRaisesRegex(AssertionError,message):
            admission.validate_wrapper(value,self.package)

    def test_fixed_wrapper_and_pure_regeneration(self):
        self.assertEqual(admission.admit(self.source),self.admitted)
        self.assertEqual(set(self.wrapper),admission.KEYS)
        self.assertEqual(self.wrapper['definition'],self.package['expected'])
        self.assertEqual(len(self.admitted['derivation_input_sha256']),235)
        self.assertEqual(len(self.admitted['input_source_hashes']),237)
        self.assertIs(self.admitted['admitted_artifact'],True)
        self.assertIs(self.admitted['acceptance'],False)
        self.assertIs(self.admitted['protocol_behavior_claim'],False)

    def test_wrong_kind_and_version_including_boolean_rejected(self):
        self.reject(lambda v:v.update(kind='record-review-final'), 'wrapper kind')
        for version in (True,'1',1.0,2,None):
            with self.subTest(version=version):
                self.reject(lambda v:v.update(version=version), 'wrapper version')

    def test_extra_and_missing_wrapper_fields_rejected(self):
        self.reject(lambda v:v.update(acceptance=True), 'wrapper keys')
        self.reject(lambda v:v.pop('reference_provenance'), 'wrapper keys')

    def test_changed_definition_and_claimed_hash_rejected(self):
        self.reject(lambda v:v.update(definition_sha256='0'*64), 'definition pin')
        self.reject(lambda v:v['definition'].update(kind='changed'), 'definition bytes')
        value=deepcopy(self.wrapper)
        value['definition']['kind']='changed'
        value['definition_sha256']=admission.assembly.descriptor.sha(admission.assembly.descriptor.canonical(value['definition']).encode())
        with self.assertRaisesRegex(AssertionError,'definition pin'):
            admission.validate_wrapper(value,self.package)

    def test_pure_builder_must_match_independent_literal(self):
        package=dict(self.package)
        package['expected']=dict(self.package['expected'],kind='changed')
        with self.assertRaisesRegex(AssertionError,'regeneration'):
            admission.validate_wrapper(self.wrapper,package)

    def test_direct_derivation_add_delete_and_hash_drift_rejected(self):
        self.reject(lambda v:v['definition_source_sha256'].update(extra='0'*64), 'source keyset')
        self.reject(lambda v:v['definition_source_sha256'].pop('record-review-v3-gate-a.sql'), 'source keyset')
        self.reject(lambda v:v['definition_source_sha256'].update({'record-review-v3-gate-a.sql':'0'*64}), 'source hashes')

    def test_full_derivation_add_delete_rename_and_hash_drift_rejected(self):
        first=sorted(self.wrapper['derivation_input_sha256'])[0]
        self.reject(lambda v:v['derivation_input_sha256'].update(extra='0'*64), 'full235')
        self.reject(lambda v:v['derivation_input_sha256'].pop(first), 'full235')
        def rename(value):
            value['derivation_input_sha256']['different']=value['derivation_input_sha256'].pop(first)
        self.reject(rename, 'source keyset or hashes')
        self.reject(lambda v:v['derivation_input_sha256'].update({first:'0'*64}), 'source keyset or hashes')

    def test_matching_mutated_builder_map_cannot_replace_frozen_map(self):
        value=deepcopy(self.wrapper)
        first=sorted(value['derivation_input_sha256'])[0]
        value['derivation_input_sha256'][first]='0'*64
        package=dict(self.package,input_source_hashes=value['derivation_input_sha256'])
        with self.assertRaisesRegex(AssertionError,'map pin'):
            admission.validate_wrapper(value,package)

    def test_install_and_reference_lineage_pins_are_distinct(self):
        self.reject(lambda v:v.update(install_sha256='0'*64), 'install changed')
        self.reject(lambda v:v['reference_provenance'].update(result_sha256='0'*64), 'reference provenance')
        self.reject(lambda v:v['reference_provenance'].update(acceptance=True), 'reference provenance')
        self.reject(lambda v:v['reference_provenance'].update(source_input_count=561.0), 'inventory count')
        self.assertNotIn('observed',self.wrapper)
        self.assertNotIn('catalog',self.wrapper['reference_provenance'])

    def test_wrapper_byte_drift_refuses_before_regeneration(self):
        path=self.source/admission.WRAPPER_FILE
        original=path.read_bytes()
        try:
            path.write_bytes(original+b'\n')
            with self.assertRaisesRegex(AssertionError,'wrapper file pin'):
                admission.admit(self.source)
        finally:
            path.write_bytes(original)

    def test_source_bytes_drift_rejected_even_when_metadata_identical(self):
        path=self.source/'record-review-v3-gate-a.sql'
        original=path.read_bytes()
        try:
            path.write_bytes(original+b'\n-- metadata-neutral drift still requires new review\n')
            with self.assertRaisesRegex(AssertionError,'source hashes'):
                admission.admit(self.source)
        finally:
            path.write_bytes(original)

    def test_missing_source_and_extra_canonical_file_rejected(self):
        path=self.source/'record-review-v3-gate-a.sql'
        original=path.read_bytes()
        try:
            path.unlink()
            with self.assertRaises(FileNotFoundError): admission.admit(self.source)
        finally:
            path.write_bytes(original)
        extra=self.root/'supabase/migrations/20261023010000_unreviewed.sql'
        try:
            extra.write_text('select 1;\n')
            with self.assertRaises(AssertionError): admission.admit(self.source)
        finally:
            extra.unlink()

    def test_no_self_referential_file_hash_loop(self):
        names=set(self.wrapper['derivation_input_sha256'])
        self.assertFalse(any(p.endswith('/'+admission.WRAPPER_FILE) for p in names))
        self.assertFalse(any(p.endswith('/record_review_v3_gate_a_admission.py') for p in names))
        additions=set(self.admitted['input_source_hashes'])-names
        self.assertEqual(additions,{
            str((SOURCE/admission.WRAPPER_FILE).relative_to(ROOT)),
            str((SOURCE/'record_review_v3_gate_a_admission.py').relative_to(ROOT))})


if __name__=='__main__':
    unittest.main()
