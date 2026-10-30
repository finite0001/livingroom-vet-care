"""Offline image-selection controls; no Docker or database acceptance claim."""
from copy import deepcopy
import json
import subprocess
import unittest
from unittest.mock import patch

import prepare_ci_postgres as source


class ImageCacheControls(unittest.TestCase):
    def fixture(self,existing=(),failed_pull=()):
        guard=source.guard_source();calls=[];images={};identity='sha256:'+'a'*64
        def image(reference):
            repository=reference.rsplit(':',1)[0]
            return dict(Id=identity,Os='linux',Architecture='arm64',
                        RepoDigests=[repository+'@'+guard.POSTGRES_INDEX_DIGEST])
        for reference in existing:images[reference]=image(reference)
        def run(arguments,**options):
            self.assertTrue(options['env']['DOCKER_HOST'].startswith('unix:///'))
            self.assertLessEqual(options['timeout'],60);calls.append(arguments)
            args=arguments[1:]
            if args[:2]==['image','inspect']:
                reference=args[2]
                value=images.get(reference)
                if reference==identity and value is None:value=next(iter(images.values()),None)
                if value is None:return subprocess.CompletedProcess(arguments,1,'','Error: No such image')
                return subprocess.CompletedProcess(arguments,0,json.dumps([value]),'')
            if args[0]=='pull':
                reference=args[1];repository=reference.split('@')[0]
                if repository in failed_pull:return subprocess.CompletedProcess(arguments,1,'','rate limited')
                self.assertEqual(reference.split('@')[1],guard.POSTGRES_INDEX_DIGEST)
                images[reference]=image(repository+':17.6.1.171')
                return subprocess.CompletedProcess(arguments,0,'','')
            if args[0]=='tag':
                self.assertEqual(args[1],identity);self.assertIn(args[2],guard.POSTGRES_REFERENCES)
                images[args[2]]=deepcopy(images[args[2].rsplit(':',1)[0]+'@'+guard.POSTGRES_INDEX_DIGEST])
                return subprocess.CompletedProcess(arguments,0,'','')
            raise AssertionError('Unexpected Docker operation')
        return guard,calls,images,run

    def test_non_ci_registry_override_and_remote_daemon_refuse(self):
        def forbidden(*args,**kwargs):raise AssertionError('Docker must not run')
        with self.assertRaises(ValueError):source.prepare({},forbidden)
        for extra in({'SUPABASE_INTERNAL_IMAGE_REGISTRY':'ghcr.io'},
                      {'DOCKER_HOST':'tcp://remote:2375'}):
            with self.assertRaises(ValueError):source.prepare(dict(GITHUB_ACTIONS='true',**extra),forbidden)

    def test_bad_preferred_tag_refuses_even_with_valid_mirror_cached(self):
        guard,calls,images,run=self.fixture()
        for reference in guard.POSTGRES_REFERENCES:
            repository=reference.rsplit(':',1)[0]
            images[reference]=dict(Id='sha256:'+'a'*64,Os='linux',Architecture='arm64',RepoDigests=[repository+'@'+guard.POSTGRES_INDEX_DIGEST])
        images[guard.POSTGRES_REFERENCES[0]]['RepoDigests']=['unapproved@sha256:'+'b'*64]
        with self.assertRaises(AssertionError):source.prepare(dict(GITHUB_ACTIONS='true',DOCKER_HOST='unix:///test.sock'),run)
        self.assertFalse(any(c[1]in('pull','tag')for c in calls))

    def test_valid_cached_mirror_needs_no_pull_or_tag(self):
        guard=source.guard_source();_,calls,_,run=self.fixture([guard.POSTGRES_REFERENCES[1]])
        result=source.prepare(dict(GITHUB_ACTIONS='true',DOCKER_HOST='unix:///test.sock'),run)
        self.assertEqual(result['cached'],[guard.POSTGRES_REFERENCES[1]])
        self.assertFalse(any(c[1]in('pull','tag')for c in calls))

    def test_rate_limited_primary_uses_only_approved_digest_and_same_mirror_tag(self):
        _,calls,_,run=self.fixture(failed_pull=['public.ecr.aws/supabase/postgres'])
        result=source.prepare(dict(GITHUB_ACTIONS='true',DOCKER_HOST='unix:///test.sock'),run)
        self.assertEqual(result['cached'],['ghcr.io/supabase/postgres:17.6.1.171'])
        self.assertEqual(result['database_operations'],0)
        self.assertFalse(any('docker.io/'in arg for c in calls for arg in c))

    def test_transient_registry_failures_retry_within_the_original_deadline(self):
        failed={'public.ecr.aws/supabase/postgres','ghcr.io/supabase/postgres'}
        _,calls,_,run=self.fixture(failed_pull=failed)
        pulls=0
        def transient(arguments,**options):
            nonlocal pulls
            if arguments[1]=='pull':
                pulls+=1
                if pulls==3:failed.clear()
            return run(arguments,**options)
        with patch.object(source.time,'sleep')as sleep:
            result=source.prepare(dict(GITHUB_ACTIONS='true',DOCKER_HOST='unix:///test.sock'),transient)
        self.assertEqual(pulls,3);sleep.assert_called_once_with(4)
        self.assertEqual(result['cached'],['public.ecr.aws/supabase/postgres:17.6.1.171'])
        self.assertEqual(source.failure_class('toomanyrequests: Rate exceeded'),'rate_limited')


if __name__=='__main__':unittest.main()
