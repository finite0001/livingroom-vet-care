"""Source admission attacks only; these controls do not certify a database."""
from copy import deepcopy
import json
from unittest import TestCase,main
from unittest.mock import patch
import operational_release as release


class OperationalReleaseAdmissionControls(TestCase):
    def test_missing_dependency_or_unreviewed_migration_refuses_before_build(self):
        original=release.prefix.regular
        path=release.HERE/'operational-release.json'
        baseline=json.loads(original(path))
        attacks=[]
        for name in baseline['source_files']:
            altered=deepcopy(baseline);del altered['source_files'][name];attacks.append(altered)
        for key,value in [('migration','20261029170038_narcotics_register_exports_and_recovery.sql'),
                          ('migration_count',210),('parser_provenance_sha256','0'*64),
                          ('typescript_sha256','0'*64),('unexpected',True)]:
            altered=deepcopy(baseline);altered[key]=value;attacks.append(altered)
        for altered in attacks:
            with self.subTest(removed=set(baseline['source_files'])-set(altered['source_files'])),\
                    patch.object(release.prefix,'regular',side_effect=lambda p:json.dumps(altered).encode()if p==path else original(p)),\
                    patch.object(release,'program',side_effect=AssertionError('invalid inventory reached builder')):
                with self.assertRaises(ValueError):release.admit()

    def test_source_ledger_extension_never_mutates_or_adopts_prefix(self):
        prefix=[dict(version=f'{index:014d}',name='retained',statement_count=1,
                     postgres_array_sha256='a'*64,postgres_array_bytes=5)for index in range(208)]
        original=deepcopy(prefix)
        manifest=json.loads(release.prefix.regular(release.HERE/'operational-release.json'))
        expected=release.expected_ledger(prefix,manifest)
        self.assertEqual(prefix,original)
        self.assertEqual(expected[:208],original)
        self.assertEqual(expected[-1]['version'],release.MIGRATION[:14])
        expected[0]['name']='changed'
        self.assertEqual(prefix,original)
        for changed in [prefix[:-1],[prefix[0],*prefix[1:207],prefix[0]]]:
            with self.assertRaises(ValueError):release.expected_ledger(changed,manifest)

    def test_full_ledger_verification_rejects_changed_original_entry(self):
        class Runtime:
            def selected_query(self,label,sql):return [{'version':'old','name':'changed'}]
        with self.assertRaises(ValueError):
            release.verify_ledger(Runtime(),[{'version':'old','name':'original'}],'source-bound-test')


if __name__=='__main__':main()
