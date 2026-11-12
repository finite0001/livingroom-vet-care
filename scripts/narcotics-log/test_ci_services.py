import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import prepare_ci_services as cache


class CacheTests(unittest.TestCase):
    def runner(self, *, absent=False, corrupt=False):
        calls, loaded = [], not absent
        refs = list(cache.IMAGES)
        def run(args, **kwargs):
            nonlocal loaded
            calls.append(args)
            self.assertLessEqual(kwargs['timeout'], 60)
            self.assertEqual(kwargs['env']['DOCKER_HOST'], 'unix:///var/run/docker.sock')
            if args[1] == 'pull':
                loaded = True
                return SimpleNamespace(returncode=0, stdout='', stderr='')
            self.assertEqual(args[1:3], ['image', 'inspect'])
            ref = args[3]
            if not loaded:
                return SimpleNamespace(returncode=1, stdout='', stderr='No such image')
            original = next((r for i, r in enumerate(refs) if ref == 'sha256:' + str(i + 1) * 64), ref)
            identity = 'sha256:' + str(refs.index(original) + 1) * 64
            row = {'Id': identity, 'Os': 'linux', 'Architecture': 'arm64',
                   'RepoDigests': [original.rsplit(':', 1)[0] + '@' + ('sha256:'+'0'*64 if corrupt else cache.IMAGES[original])]}
            return SimpleNamespace(returncode=0, stdout=json.dumps([row]), stderr='')
        return run, calls

    def test_existing_content_starts_nothing(self):
        runner, calls = self.runner()
        result = cache.prepare({'GITHUB_ACTIONS': 'true', 'DOCKER_HOST': 'unix:///var/run/docker.sock'}, runner)
        self.assertEqual(len(result['images']), 4)
        self.assertEqual(len(calls), 8)
        self.assertFalse(result['native_runtime_deadlines_changed'])
        self.assertEqual(result['containers_started'], 0)

    def test_missing_image_is_pulled_then_verified_by_immutable_id(self):
        runner, calls = self.runner(absent=True)
        cache.prepare({'GITHUB_ACTIONS': 'true', 'DOCKER_HOST': 'unix:///var/run/docker.sock'}, runner)
        self.assertEqual([x[1] for x in calls].count('pull'), 1)

    def test_mismatched_cached_content_is_refused_without_retag_or_pull(self):
        runner, calls = self.runner(corrupt=True)
        with self.assertRaisesRegex(ValueError, 'reviewed registry content'):
            cache.prepare({'GITHUB_ACTIONS': 'true', 'DOCKER_HOST': 'unix:///var/run/docker.sock'}, runner)
        self.assertEqual(len(calls), 1)

    def test_nonlocal_or_nonci_or_override_is_refused(self):
        runner, _ = self.runner()
        for env in ({}, {'GITHUB_ACTIONS':'true','DOCKER_HOST':'tcp://remote:2375'},
                    {'GITHUB_ACTIONS':'true','SUPABASE_INTERNAL_IMAGE_REGISTRY':'other'},
                    {'GITHUB_ACTIONS':'true','DOCKER_HOST':'unix:///x','DOCKER_CONTEXT':'other'}):
            with self.assertRaises(ValueError):cache.prepare(env,runner)

    def test_setup_budget_is_bounded(self):
        runner, calls = self.runner()
        with patch.object(cache.time, 'monotonic', side_effect=[0,121]):
            with self.assertRaises(TimeoutError):
                cache.prepare({'GITHUB_ACTIONS':'true','DOCKER_HOST':'unix:///var/run/docker.sock'},runner)
        self.assertEqual(calls,[])


if __name__ == '__main__':unittest.main()
