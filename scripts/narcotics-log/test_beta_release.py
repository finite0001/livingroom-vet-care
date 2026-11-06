"""Current empty-count upgrade and exact REST-source admission regressions."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import beta_rehearsal as beta
import beta_cold_release as cold
import beta_release_source as source


class ColdReleaseTests(unittest.TestCase):
    def test_populated_state_refuses_before_ingress_file_or_cli_work(self):
        for counts in ({'policies':1,'snapshots':0},{'policies':0,'snapshots':1},{'policies':0},{'policies':0,'snapshots':0,'extra':True}):
            target=SimpleNamespace(operational_prefix_ledger=[],evidence=Path('/unused'),result={})
            runtime=SimpleNamespace(install=target,remaining=lambda _:30,selected_query=Mock(return_value=counts))
            with self.subTest(counts=counts),patch.object(cold,'admit',return_value={}),patch.object(cold,'expected_ledger',return_value=[]),patch.object(beta.receiver_rehearsal,'owned_ingress') as ingress:
                with self.assertRaisesRegex(ValueError,'zero policies and snapshots'):
                    cold.install(runtime)
                ingress.assert_not_called()
                self.assertFalse(hasattr(target,'source_runtime'))

    def test_original_pin_and_whole_inverse_refuse_source_tampering(self):
        self.assertTrue(source.materialize()['whole_source_inverse'])
        with patch.object(Path,'read_bytes',return_value=b'changed original'):
            with self.assertRaisesRegex(ValueError,'Exact original'):
                source.materialize()
        with TemporaryDirectory() as folder:
            changed=Path(folder)/'current.py';changed.write_bytes(source.CURRENT.read_bytes()+b'\n# changed\n')
            with patch.object(source,'CURRENT',changed):
                with self.assertRaisesRegex(ValueError,'source differs'):
                    source.materialize()

    def test_genuine_policies_require_all_original_cases_and_empty_profiles_stay_empty(self):
        expected=dict(kind='historical-policy-grammar-controls-v1',cases=23,
            original_and_context_results_exact=True,captured_capability_decisions_recomputed=True,
            domain_writes=0,Auth_acceptance=False)
        for profile in ('count_agreement','browser_lost_finalize','variance_reconciliation'):
            runtime=SimpleNamespace(folder=Path('/unused'),install=SimpleNamespace(result={}),selected_query=Mock(return_value=expected))
            with patch.object(beta.business,'save'):
                beta.BetaBusiness.after_business(SimpleNamespace(profile=profile),None,None,runtime,None)
                self.assertEqual(runtime.install.result['genuine_policy_grammar_controls'],23)
                runtime.selected_query.return_value={**expected,'cases':22}
                with self.assertRaisesRegex(ValueError,'original23'):
                    beta.current_policy_controls(runtime,profile)
        runtime.selected_query.return_value={'policies':1,'snapshots':0}
        with self.assertRaisesRegex(ValueError,'must retain empty'):
            beta.current_policy_controls(runtime,'commission_all')

    def test_rest_requires_verified_exact_ledger_and_preserves_hook_validator(self):
        prefix=[{'version':str(i)} for i in range(208)]
        manifest=json.loads((beta.HERE/'operational-release.json').read_text())
        # Use a genuine source-shaped prefix for original expected_ledger's ordering checks.
        prefix=[dict(version=f'20000101{i:06}',name='retained',statement_count=1,postgres_array_sha256='a'*64,postgres_array_bytes=1)for i in range(208)]
        ledger=beta.release.expected_ledger(prefix,manifest)
        target=SimpleNamespace(result={},operational_prefix_ledger=prefix)
        runtime=SimpleNamespace(install=target)
        validator=Mock(return_value={'verified':True})
        with patch.object(beta.business,'modules',return_value=SimpleNamespace(rest=SimpleNamespace(effective_defaults=validator))):
            beta.current_rest_defaults(runtime)
            validator.assert_called_once_with(runtime)
            target.result={'complete_source_derived209_ledger':True}
            with self.assertRaisesRegex(ValueError,'ledger missing'): beta.current_rest_defaults(runtime)
            target.operational_ledger=ledger
            beta.current_rest_defaults(runtime)
            validator.assert_called_with(runtime,recovery=True)
            for bad in (ledger[:-1],[*ledger[:-1],{**ledger[-1],'postgres_array_sha256':'b'*64}]):
                target.operational_ledger=bad
                with self.assertRaisesRegex(ValueError,'verified current source ledger'): beta.current_rest_defaults(runtime)
            target.operational_ledger=ledger;target.result={}
            with self.assertRaisesRegex(ValueError,'verified current source ledger'): beta.current_rest_defaults(runtime)
            target.result={'complete_source_derived209_ledger':True}
            validator.side_effect=ValueError('Unexpected effective schema/hook/role/database override')
            with self.assertRaisesRegex(ValueError,'Unexpected effective'): beta.current_rest_defaults(runtime)


if __name__=='__main__':unittest.main()
