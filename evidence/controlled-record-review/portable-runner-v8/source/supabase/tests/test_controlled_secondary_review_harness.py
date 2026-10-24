"""Negative proof-parser and independent artifact tests; no database/process I/O."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[2] / 'tests/controlled-drugs/engine/candidate'
sys.path.insert(0, str(SOURCE))
import secondary_review_gate_a as gate


class SecondaryReviewHarness(unittest.TestCase):
    def result(self, stderr, code=1):
        return subprocess.CompletedProcess([], code, '', stderr)

    def test_actual_primary_error_and_armed_notice_required(self):
        gate.failed(self.result('NOTICE:  00000: armed\nERROR:  P0001: failed\n'), 'P0001', 'failed', 'armed')
        for value in ('CONTEXT: ERROR:  P0001: failed\n', 'ERROR:  P0001: other\nCONTEXT: failed\n', 'ERROR:  23514: failed\n'):
            with self.assertRaises(AssertionError):
                gate.failed(self.result(value), 'P0001', 'failed')
        with self.assertRaises(AssertionError):
            gate.failed(self.result('ERROR:  P0001: failed\n'), 'P0001', 'failed', 'armed')
        with self.assertRaises(AssertionError):
            gate.failed(self.result('ERROR:  P0001: failed\n',0), 'P0001', 'failed')

    def test_frozen_descriptor_accepts_only_independent_exact_bytes(self):
        value=gate.frozen_package(SOURCE)
        self.assertEqual(value['expected_sha256'],'3a67403bc39a48ee09437c875b77a9eec9c2ae8cd05ac1908e44214ce06157e5')
        with tempfile.TemporaryDirectory()as folder:
            target=Path(folder)/'secondary_review_descriptor_gate_a_expected.json'
            raw=(SOURCE/target.name).read_bytes()
            target.write_bytes(raw+b'\n')
            with self.assertRaisesRegex(AssertionError,'expected bytes changed'):
                gate.frozen_package(Path(folder))
            edited=json.loads(raw)
            edited['definition']['schema']['owner']='authenticated'
            target.write_text(json.dumps(edited))
            with self.assertRaisesRegex(AssertionError,'expected bytes changed'):
                gate.frozen_package(Path(folder))

    def test_missing_or_multiple_observation_not_adopted(self):
        for text in ('', '{}\n{}\n'):
            with self.assertRaises(AssertionError):
                gate.one(text)
        self.assertEqual(gate.one('NOTICE: fixture\n{"expected":true}\n'),{'expected':True})


class SecondaryReviewProtocolHarness(unittest.TestCase):
    def test_restore_owner_map_cannot_truncate_full_function_identity(self):
        from secondary_review_restore_ownership import verify_long_identities
        identity='auth.'+'function_identity_'*5+'(uuid, text, jsonb)'
        expected={'identities':[identity]}
        verify_long_identities({'entries':[{'kind':'function:f','identity':identity}]},expected)
        with self.assertRaisesRegex(AssertionError,'lost full function'):
            verify_long_identities({'entries':[{'kind':'function:f','identity':identity[:63]}]},expected)

    def test_restore_diagnostic_cannot_select_acceptance(self):
        from secondary_review_protocol_acceptance import run
        with self.assertRaisesRegex(AssertionError,'cannot claim acceptance'):
            run(None,None,None,None,None,actual_expiry=True,restore_only=True)
        result=subprocess.run([sys.executable,'-B',str(SOURCE/'probe-secondary-review-protocol.py'),
            '--run-synthetic-local','--acceptance','--restore-exercise'],capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Exactly one proof mode required',result.stderr)
        self.assertNotIn('Protected evidence:',result.stdout)

    def test_restore_source_admission_rejects_unknown_authority_and_object_kinds(self):
        from copy import deepcopy
        from secondary_review_restore_ownership import admitted,auth_entries,differences
        source={'entries':[{'kind':'schema','identity':'auth','owner':'supabase_admin',
                 'acl':['postgres=U/supabase_admin'],'detail':None,'extension':None}], 'extensions':[]}
        self.assertEqual(admitted(source),source)
        for field,value in (('owner','authenticated'),('kind','relation:f'),('extension','unexpected_extension')):
            changed=deepcopy(source);changed['entries'][0][field]=value
            with self.assertRaises(AssertionError):admitted(changed)
        for acl in (None,['postgres=UC/supabase_admin'],['postgres=U/postgres']):
            changed=deepcopy(source);changed['entries'][0]['acl']=acl
            self.assertNotEqual(auth_entries(source),auth_entries(changed))
            self.assertEqual(len(differences(source,changed)),1)

    def test_final_profiles_independent_and_private_default(self):
        from secondary_review_protocol_acceptance import frozen_package
        private=frozen_package(SOURCE,'private')['expected']
        auth=frozen_package(SOURCE,'synthetic_auth')['expected']
        from secondary_review_protocol_descriptor import FACADES
        for name in FACADES:
            signature='public.'+name+'(p_request jsonb)'
            self.assertEqual([r['grantee']for r in private['functions'][signature]['acl']],['postgres'])
            self.assertEqual([r['grantee']for r in auth['functions'][signature]['acl']],['authenticated','postgres'])
        self.assertEqual(private['parent'],auth['parent'])
        for signature,definition in private['functions'].items():
            if signature.startswith('controlled_review.'):
                self.assertEqual(definition,auth['functions'][signature])

    def test_deferred_trigger_is_private_definer_without_helper_grants(self):
        from secondary_review_protocol_descriptor import build, FACADES
        for profile in ('private','synthetic_auth'):
            functions=build(profile)['expected']['functions']
            allowed={'public.'+name+'(p_request jsonb)'for name in FACADES}|{'controlled_review.terminal_check()'}
            self.assertEqual({signature for signature,value in functions.items()if value['security_definer']},allowed)
            self.assertEqual([row['grantee']for row in functions['controlled_review.terminal_check()']['acl']],['postgres'])

    def test_final_wrapper_bytes_cannot_be_reformatted_or_mutated(self):
        from secondary_review_protocol_acceptance import frozen_package
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'secondary_review_protocol_synthetic_auth_expected_v2.json'
            raw=(SOURCE/path.name).read_bytes()
            for changed in (raw+b'\n',raw.replace(b'postgres',b'otherrole',1)):
                path.write_bytes(changed)
                with self.assertRaisesRegex(AssertionError,'expected bytes changed'):
                    frozen_package(Path(folder),'synthetic_auth')



if __name__=='__main__':
    unittest.main()
