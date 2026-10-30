"""CI cache preparation; the original bootstrap still verifies the actual image."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from types import SimpleNamespace

sys.path.insert(0,str(Path(__file__).resolve().parent))
import bounded_process
import prefix_view

GUARD_SHA='ed42ffa7835b5e2fc424738de97ceb237f554651c0e0f7facf5a10c8a2e3094a'


def failure_class(message):
    value=message.lower()
    if any(token in value for token in('toomanyrequests','too many requests','rate limit','rate exceeded','quota','429')):
        return 'rate_limited'
    if any(token in value for token in('manifest unknown','manifest not found','not found')):return 'manifest_unavailable'
    if any(token in value for token in('unauthorized','denied')):return 'registry_authorization'
    return 'registry_transport'


def guard_source():
    path=prefix_view.ROOT/'tests/controlled-drugs/engine/candidate/history_environment.py'
    raw=prefix_view.regular(path)
    if sys.flags.optimize or hashlib.sha256(raw).hexdigest()!=GUARD_SHA:
        raise ValueError('Unchanged reviewed image guard with active assertions required')
    namespace={};exec(compile(raw,str(path),'exec'),namespace)
    return SimpleNamespace(**namespace)


def prepare(environment=None,runner=bounded_process.run):
    # Ten seconds of the inclusive 70-second setup budget remain for cleanup.
    end=time.monotonic()+60
    env=dict(os.environ if environment is None else environment)
    if env.get('GITHUB_ACTIONS')!='true':raise ValueError('This image-cache step is CI-only')
    if 'SUPABASE_INTERNAL_IMAGE_REGISTRY'in env:raise ValueError('Registry override is not admitted by this cache step')
    if env.get('DOCKER_HOST')and env.get('DOCKER_CONTEXT'):raise ValueError('Ambiguous Docker endpoint')
    guard=guard_source()

    def call(arguments,limit=8):
        remaining=end-time.monotonic()
        if remaining<=0:raise TimeoutError('Original image-cache setup deadline exhausted')
        return runner(['docker',*arguments],env=env,timeout=min(limit,remaining),stdout_cap=1048576,stderr_cap=524288)

    endpoint=env.get('DOCKER_HOST')
    if endpoint is None:
        result=call(['context','inspect'])
        if result.returncode:raise ValueError('Cannot select the effective local Docker context')
        contexts=json.loads(result.stdout)
        if type(contexts)is not list or len(contexts)!=1:raise ValueError('One Docker context required')
        endpoint=contexts[0]['Endpoints']['docker']['Host']
    if not isinstance(endpoint,str)or not endpoint.startswith('unix:///'):raise ValueError('Only local Unix Docker is admitted')
    env.pop('DOCKER_CONTEXT',None);env['DOCKER_HOST']=endpoint

    def inspect(reference,absent=False):
        result=call(['image','inspect',reference])
        if result.returncode:
            if absent and result.returncode==1 and 'no such image'in result.stderr.lower():return None
            raise ValueError('Cannot inspect the selected image')
        rows=json.loads(result.stdout)
        if type(rows)is not list or len(rows)!=1 or not re.fullmatch(r'sha256:[0-9a-f]{64}',rows[0].get('Id','')):
            raise ValueError('One immutable image identity required')
        return rows[0]

    def verified_tags():
        found=[]
        # Check BOTH: the CLI prefers cached ECR, even if GHCR is valid.
        for reference in guard.POSTGRES_REFERENCES:
            image=inspect(reference,True)
            if image is not None:
                immutable=inspect(image['Id'])
                if immutable['Id']!=image['Id']:raise ValueError('Image identity changed during admission')
                guard.assert_bootstrap_image(reference,immutable)
                found.append(reference)
        return found

    found=verified_tags()
    if found:return dict(kind='approved-ci-postgres-cache-v1',cached=found,database_operations=0)
    for attempt in range(1,4):
        for reference in guard.POSTGRES_REFERENCES:
            repository=reference.rsplit(':',1)[0]
            digest_reference=repository+'@'+guard.POSTGRES_INDEX_DIGEST
            try:
                result=call(['pull',digest_reference],25)
                failure=None if result.returncode==0 else failure_class(result.stderr)
            except subprocess.TimeoutExpired:failure='pull_timeout'
            if failure is not None:
                # Public classification only: never print raw daemon output.
                print(json.dumps(dict(approved_reference=reference,attempt=attempt,failure=failure)),file=sys.stderr,flush=True)
                continue
            image=inspect(digest_reference)
            immutable=inspect(image['Id'])
            if immutable['Id']!=image['Id']:raise ValueError('Pulled immutable image changed')
            guard.assert_bootstrap_image(reference,immutable)
            # Never overwrite a tag that appeared during the pull.
            found=verified_tags()
            if found:return dict(kind='approved-ci-postgres-cache-v1',cached=found,database_operations=0)
            result=call(['tag',image['Id'],reference])
            if result.returncode:raise ValueError('Cannot cache the same approved reference')
            found=verified_tags()
            if reference not in found:raise ValueError('Approved image cache verification failed')
            return dict(kind='approved-ci-postgres-cache-v1',cached=found,database_operations=0)
        if attempt<3:
            pause=4*attempt
            if end-time.monotonic()<=pause:raise TimeoutError('Image-cache retry would exceed the original work deadline')
            time.sleep(pause)
    raise RuntimeError('Approved registries unavailable; image guard remains unchanged')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    modes=parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--check-source',action='store_true')
    modes.add_argument('--prepare-ci-cache',action='store_true')
    args=parser.parse_args()
    if args.check_source:
        guard=guard_source();print(json.dumps(dict(source_guard_sha256=GUARD_SHA,approved_references=guard.POSTGRES_REFERENCES,database_operations=0)))
    else:print(json.dumps(prepare()))
