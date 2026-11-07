"""Engineering traces remain source-derived and cannot grant acceptance."""
from copy import deepcopy
import json
import re
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock,patch

import beta_rehearsal as beta
import beta_recovery_diagnostic as diagnostic


class RecoveryDiagnosticTests(unittest.TestCase):
    def test_binding_changes_only_fixed_wrapper_expectation_and_keeps_production_source(self):
        original=json.loads((beta.HERE/'module-expected.json').read_text())
        # Production receives this original ordinary relation projection from
        # the installer's independent source-reference observation.
        original['properties']['ordinary_relations']={'time_entries':{'acl':[],
            'policies':[{'name':name}for name in sorted(beta.clock_source.POLICIES)]}}
        original['properties']['lexical_number']=1.0
        raw=json.dumps(original).replace('"lexical_number": 1.0','"lexical_number": 1.00')
        original_family={**beta.clock_source.render_family('{"original": 1.00}'),
                         'original_descriptor_hash':'a'*64}
        changed_family={**beta.clock_source.render_family('{"changed": 1.00}'),
                        'original_descriptor_hash':'b'*64}
        target=SimpleNamespace(expected_module=deepcopy(original),operational_ledger=[{}]*211,
            expected_module_canonical_text=raw,
            result={'complete_source_derived211_ledger':True},evidence=Path('/unused'))
        def source_delta(label,sql):
            self.assertEqual(label,'engineering-source-wrapper-expectation')
            self.assertTrue(sql.startswith("SELECT jsonb_build_object('canonical_text',jsonb_set("+beta.clock_source.literal(raw)))
            matches=re.findall(r"to_jsonb\('([a-f0-9]{64})'::text\),false\)::text\);$",sql)
            self.assertEqual(len(matches),1)
            value=deepcopy(original)
            value['properties']['functions'][diagnostic.SIGNATURE]['body_sha256']=matches[0]
            return {'canonical_text':json.dumps(value).replace('"lexical_number": 1.0','"lexical_number": 1.00')}
        runtime=SimpleNamespace(install=target,raw_query=Mock(),verify_module=Mock(),selected_query=Mock(side_effect=source_delta))
        with patch.object(beta.business,'save') as save,patch.object(beta,'source_family',return_value=original_family),\
                patch.object(beta,'derive_source_family',return_value=changed_family) as derive:
            diagnostic.bind(runtime)
        wanted=deepcopy(original)
        wanted['properties']['functions'][diagnostic.SIGNATURE]['body_sha256']=target.expected_module['properties']['functions'][diagnostic.SIGNATURE]['body_sha256']
        self.assertEqual(wanted,target.expected_module)
        self.assertNotEqual(original,target.expected_module)
        self.assertTrue(target.result['engineering_only'])
        self.assertFalse(target.result['current211_normal_acceptance'])
        self.assertTrue(save.call_args.args[2]['whole_wrapper_source_inverse'])
        program=runtime.raw_query.call_args.args[1]
        self.assertIn('GET STACKED DIAGNOSTICS',program)
        self.assertIn("SET LOCAL statement_timeout='8s'",program)
        self.assertIn('engineering_admission_binding_refused',program)
        self.assertIn(changed_family['definition'],program)
        self.assertIn('beta_new_expectation text:='+beta.clock_source.literal(changed_family['canonical_text']),program)
        self.assertIn('beta_template text:='+beta.clock_source.literal(changed_family['template_body']),program)
        self.assertIn('AND canonical_expectation=expected::text',program)
        self.assertIn('engineering_original_family_source_invalid',program)
        self.assertEqual(program.count(beta.clock_source.literal(raw)),1)
        self.assertEqual(program.count(beta.clock_source.literal(target.expected_module_canonical_text)),1)
        self.assertIn('require_bound_body_hash='+beta.clock_source.literal(changed_family['body_sha256']),program)
        self.assertNotIn('expected_properties_hash=',program)
        self.assertIn('"lexical_number": 1.00',target.expected_module_canonical_text)
        self.assertEqual(derive.call_args.args[2],target.expected_module_canonical_text)
        self.assertEqual(target.beta_source_family,(target.expected_module_canonical_text,changed_family))
        runtime.verify_module.assert_called_once()

    def test_no_trace_or_generic_error_cannot_complete_diagnosis(self):
        with TemporaryDirectory() as folder:
            directory=Path(folder).resolve()
            target=SimpleNamespace(evidence=directory,result={})
            self.assertFalse(diagnostic.preserve_failure(target))
            path=directory/'beta-recovery-native-trace.json'
            receipt=dict(rpc=diagnostic.API,status=400,error=dict(code='P0001',message='stock_entry_request_failed',details='',hint=''))
            path.write_text(json.dumps(receipt))
            self.assertFalse(diagnostic.preserve_failure(target))
            receipt['error']['details']='synthetic native SQL context';path.write_text(json.dumps(receipt))
            self.assertTrue(diagnostic.preserve_failure(target))
            self.assertFalse(target.result['populated_receiver_verified'])
            self.assertFalse(target.result['current211_normal_acceptance'])

    def test_even_successful_instrumented_protocol_must_refuse_acceptance(self):
        target=object.__new__(beta.BetaRecoveryDiagnostic)
        target.result={};target.protocol=lambda:None
        with self.assertRaisesRegex(RuntimeError,'cannot grant normal'):
            target.execute()
        self.assertFalse(target.result['application_Auth_verified'])
        self.assertFalse(target.result['populated_receiver_verified'])
        self.assertTrue(target.result['engineering_only'])


if __name__=='__main__':unittest.main()
