"""Fail-closed image identity counterexamples, without Docker or a database."""
import importlib.util
from pathlib import Path
import unittest

SOURCE = Path(__file__).resolve().parents[2] / 'tests/controlled-drugs/engine/candidate/history_environment.py'
SPEC = importlib.util.spec_from_file_location('native_history_environment', SOURCE)
ENVIRONMENT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ENVIRONMENT)


class NativeHistoryEnvironmentTests(unittest.TestCase):
    def image(self, reference, architecture='amd64', digest=None):
        repository = reference.rsplit(':', 1)[0]
        return {'Os': 'linux', 'Architecture': architecture,
                'RepoDigests': [repository + '@' + (digest or ENVIRONMENT.POSTGRES_INDEX_DIGEST)]}

    def test_both_exact_registries_accept_reviewed_index_and_matching_platform(self):
        for reference in ENVIRONMENT.POSTGRES_REFERENCES:
            for architecture, child in ENVIRONMENT.POSTGRES_PLATFORM_DIGESTS.items():
                for digest in (ENVIRONMENT.POSTGRES_INDEX_DIGEST, child):
                    with self.subTest(reference=reference, architecture=architecture, digest=digest):
                        result = ENVIRONMENT.assert_bootstrap_image(reference, self.image(reference, architecture, digest))
                        self.assertEqual(result['platform'], 'linux/' + architecture)

    def test_changed_version_or_unreviewed_registry_is_refused_even_with_pinned_content(self):
        for reference in ['ghcr.io/supabase/postgres:17.6.1.172',
                          'docker.io/supabase/postgres:17.6.1.171',
                          'unreviewed.example/supabase/postgres:17.6.1.171']:
            with self.subTest(reference=reference), self.assertRaises(AssertionError):
                ENVIRONMENT.assert_bootstrap_image(reference, self.image(reference))

    def test_correct_tag_with_changed_content_is_refused(self):
        reference = ENVIRONMENT.POSTGRES_REFERENCES[1]
        with self.assertRaises(AssertionError):
            ENVIRONMENT.assert_bootstrap_image(reference, self.image(reference, digest='sha256:' + '0' * 64))

    def test_other_platform_manifest_is_not_authority(self):
        reference = ENVIRONMENT.POSTGRES_REFERENCES[1]
        with self.assertRaises(AssertionError):
            ENVIRONMENT.assert_bootstrap_image(reference, self.image(reference, 'amd64', ENVIRONMENT.POSTGRES_PLATFORM_DIGESTS['arm64']))

    def test_unreviewed_platform_or_os_is_refused(self):
        reference = ENVIRONMENT.POSTGRES_REFERENCES[1]
        for os_name, architecture in [('linux', 'riscv64'), ('windows', 'amd64')]:
            image = self.image(reference, architecture)
            image['Os'] = os_name
            with self.subTest(os=os_name, architecture=architecture), self.assertRaises(AssertionError):
                ENVIRONMENT.assert_bootstrap_image(reference, image)

    def test_missing_malformed_or_other_repository_digest_is_refused(self):
        reference = ENVIRONMENT.POSTGRES_REFERENCES[1]
        for digests in [None, [], 'sha256:' + '0' * 64, [None],
                        ['unreviewed.example/supabase/postgres@' + ENVIRONMENT.POSTGRES_INDEX_DIGEST]]:
            image = self.image(reference)
            image['RepoDigests'] = digests
            with self.subTest(digests=digests), self.assertRaises(AssertionError):
                ENVIRONMENT.assert_bootstrap_image(reference, image)


if __name__ == '__main__':
    unittest.main()
