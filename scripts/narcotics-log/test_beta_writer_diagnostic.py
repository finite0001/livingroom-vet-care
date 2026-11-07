"""Writer tracing preserves requests and never grants candidate acceptance."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

import beta_writer_diagnostic as writer


class WriterDiagnosticTests(unittest.TestCase):
    def test_protocol_keeps_original_bytecode_defaults_and_super_closure(self):
        original = writer.beta.business.BusinessInstallation.execute
        protocol = writer.WriterDiagnosis.protocol
        self.assertIs(protocol.__code__, original.__code__)
        self.assertIs(protocol.__closure__, original.__closure__)
        self.assertIs(protocol.__defaults__, original.__defaults__)

    def test_native_error_records_only_fixed_writer_ordinal_and_timing(self):
        with TemporaryDirectory() as directory:
            folder = Path(directory).resolve()
            calls = []
            def rpc(name, payload, user, expected):
                calls.append((name, payload, user, expected))
                if name == writer.diagnostic.API:
                    (folder/'rpc-failure.json').write_text(json.dumps(dict(rpc=name,status=500,
                        error=dict(code='57014',message='statement timeout',details='fixed synthetic context',hint=''))))
                    raise ValueError('fixed failed status')
                return {'unchanged': True}
            runtime = SimpleNamespace(folder=folder)
            http = writer.WriterHttp(SimpleNamespace(rpc=rpc), runtime)
            probe = {'p_request': {'writer':'record_anesthesia_drug_administration', 'secret':'must-not-copy'}}
            user = {'access_token':'must-not-copy'}
            self.assertEqual(http.rpc('probe_controlled_stock_intent_v1',probe,user),{'unchanged':True})
            payload = {'p_request': {'secret':'must-not-copy'}}
            with self.assertRaisesRegex(ValueError,'fixed failed'):
                http.rpc(writer.diagnostic.API,payload,user)
            self.assertIs(calls[-1][1],payload)
            self.assertIs(calls[-1][2],user)
            self.assertEqual(calls[-1][3],200)
            trace = json.loads((folder/'beta-writer-native-trace.json').read_text())
            self.assertEqual(trace['writer'],'record_anesthesia_drug_administration')
            self.assertEqual(trace['execute_index'],1)
            self.assertEqual(trace['error']['code'],'57014')
            self.assertFalse(trace['normal_acceptance'])
            self.assertNotIn('must-not-copy',json.dumps(trace))
            self.assertNotIn('must-not-copy',(folder/'beta-writer-call-timing-001.json').read_text())

    def test_second_execution_keeps_first_timing_and_native_failure(self):
        with TemporaryDirectory() as directory:
            folder = Path(directory).resolve()
            count = 0
            def rpc(name, payload, user, expected):
                nonlocal count
                if name != writer.diagnostic.API:
                    return {}
                count += 1
                if count == 1:
                    return {'saved': True}
                (folder/'rpc-failure.json').write_text(json.dumps(dict(rpc=name,status=500,
                    error=dict(code='57014',message='statement timeout',details='second native context',hint=''))))
                raise ValueError('second fixed failed status')
            http = writer.WriterHttp(SimpleNamespace(rpc=rpc), SimpleNamespace(folder=folder))
            http.rpc('probe_controlled_stock_intent_v1',{'p_request':{'writer':'record_patient_treatment'}},{})
            self.assertEqual(http.rpc(writer.diagnostic.API,{},{}),{'saved':True})
            http.rpc('probe_controlled_stock_intent_v1',{'p_request':{'writer':'record_anesthesia_drug_administration'}},{})
            with self.assertRaisesRegex(ValueError,'second fixed failed'):
                http.rpc(writer.diagnostic.API,{},{})
            first = json.loads((folder/'beta-writer-call-timing-001.json').read_text())
            second = json.loads((folder/'beta-writer-call-timing-002.json').read_text())
            native = json.loads((folder/'beta-writer-native-trace.json').read_text())
            self.assertTrue(first['expected_status_received'])
            self.assertFalse(second['expected_status_received'])
            self.assertEqual(native['execute_index'],2)
            self.assertEqual(native['writer'],'record_anesthesia_drug_administration')
            self.assertEqual(native['error']['details'],'second native context')

    def test_successful_protocol_still_refuses_normal_acceptance(self):
        target = object.__new__(writer.WriterDiagnosis)
        target.result = {}
        target.protocol = lambda: None
        with self.assertRaisesRegex(RuntimeError,'cannot grant normal'):
            target.execute()
        self.assertTrue(target.result['engineering_only'])
        self.assertFalse(target.result['business_profile_verified'])
        self.assertFalse(target.result['current211_normal_acceptance'])


if __name__=='__main__':unittest.main()
