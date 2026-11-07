"""Engineering traces remain source-derived and cannot grant acceptance."""
from copy import deepcopy
import json
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
        target=SimpleNamespace(expected_module=deepcopy(original),operational_ledger=[{}]*211,
            result={'complete_source_derived211_ledger':True},evidence=Path('/unused'))
        runtime=SimpleNamespace(install=target,raw_query=Mock(),verify_module=Mock())
        with patch.object(beta.business,'save') as save:
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
        require_hash=beta.installation.decode(beta.installation.prefix.regular(beta.HERE/'beta-time-clock-source-proof.json'))['successor_require_bound_body_sha256']
        compact={key:deepcopy(wanted['properties'][key]) for key in ('functions','ordinary_relations')}
        compact['functions'][beta.clock_source.SIGNATURE]['body_sha256']=require_hash
        compact['ordinary_relations']['time_entries']['policies']=[]
        expected_sql=beta.clock_source.literal(beta.installation.canonical(compact))+'::jsonb'
        self.assertTrue('expected_properties='+expected_sql in program, 'Diagnostic admission must bind exactly the compact projected branches')
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
