"""Cache CLI2.118's unchanged service images before the owned runtime budget.

This starts no container and touches no database. The native rehearsal still
owns its complete original 600/540/55 deadlines, identity checks and cleanup.
Repository index digests were independently hashed from raw ECR manifests.
"""
import argparse
import json
import os
from pathlib import Path
import re
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bounded_process
from prepare_ci_postgres import failure_class

IMAGES = {
    'public.ecr.aws/supabase/mailpit:v1.30.2': 'sha256:37a38e48e9338cd7e89dfeb487f37b02ebfcd9cb23111bed2d345e79d37d6dd6',
    'public.ecr.aws/supabase/gotrue:v2.197.0': 'sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b',
    'public.ecr.aws/supabase/postgrest:v16.3': 'sha256:ec0e25a4e24b0a3bc5e4f011369bfc736bd1b19f513bd01079b86329a7636962',
    'public.ecr.aws/supabase/storage-api:v1.77.0': 'sha256:3999cfa4f3286f945fa68069fc9b8b6bf3929a6bd53916dcf2e8c209801173c0',
    'public.ecr.aws/supabase/kong:2.8.1': 'sha256:1b53405d8680a09d6f44494b7990bf7da2ea43f84a258c59717d4539abf09f6d',
}


def validate_image(reference, image):
    repository = reference.rsplit(':', 1)[0]
    wanted = repository + '@' + IMAGES[reference]
    if (image.get('Os') != 'linux' or image.get('Architecture') not in ('amd64', 'arm64')
            or not re.fullmatch(r'sha256:[0-9a-f]{64}', image.get('Id', ''))
            or wanted not in image.get('RepoDigests', [])):
        raise ValueError('Service image differs from independently reviewed registry content')
    return {'reference': reference, 'id': image['Id'], 'repository_digest': wanted}


def prepare(environment=None, runner=bounded_process.run):
    env = dict(os.environ if environment is None else environment)
    if env.get('GITHUB_ACTIONS') != 'true':
        raise ValueError('Service cache preparation is CI-only')
    if 'SUPABASE_INTERNAL_IMAGE_REGISTRY' in env:
        raise ValueError('Registry override is not admitted')
    if env.get('DOCKER_HOST') and env.get('DOCKER_CONTEXT'):
        raise ValueError('Ambiguous Docker endpoint')
    end = time.monotonic() + 120

    def call(arguments, limit=10):
        remaining = end - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Service cache setup deadline exhausted')
        return runner(['docker', *arguments], env=env, timeout=min(limit, remaining),
                      stdout_cap=1048576, stderr_cap=524288)

    endpoint = env.get('DOCKER_HOST')
    if endpoint is None:
        result = call(['context', 'inspect'])
        if result.returncode:
            raise ValueError('Cannot inspect Docker context')
        contexts = json.loads(result.stdout)
        if type(contexts) is not list or len(contexts) != 1:
            raise ValueError('One Docker context required')
        endpoint = contexts[0]['Endpoints']['docker']['Host']
    if not isinstance(endpoint, str) or not endpoint.startswith('unix:///'):
        raise ValueError('Only local Unix Docker is admitted')
    env.pop('DOCKER_CONTEXT', None)
    env['DOCKER_HOST'] = endpoint
    verified = []
    for reference in IMAGES:
        result = call(['image', 'inspect', reference])
        if result.returncode:
            if result.returncode != 1 or 'no such image' not in result.stderr.lower():
                raise ValueError('Cannot inspect service image')
            for attempt in range(3):
                pulled = call(['pull', reference], 60)
                if not pulled.returncode:
                    break
                classification = failure_class(pulled.stderr)
                print(json.dumps({'reference': reference, 'attempt': attempt + 1,
                                  'failure': classification}), flush=True)
                if classification in ('registry_authorization', 'manifest_unavailable') or attempt == 2:
                    raise ValueError('Pinned service image pull failed: ' + classification)
                pause = .5 * (attempt + 1)
                if end - time.monotonic() <= pause:
                    raise TimeoutError('Registry retry would exceed service cache setup deadline')
                time.sleep(pause)
            result = call(['image', 'inspect', reference])
        if result.returncode:
            raise ValueError('Pulled service image cannot be inspected')
        rows = json.loads(result.stdout)
        if type(rows) is not list or len(rows) != 1:
            raise ValueError('One service image required')
        proof = validate_image(reference, rows[0])
        # Bind the tag observation to immutable content; never retag a mismatch.
        immutable = call(['image', 'inspect', proof['id']])
        if immutable.returncode:
            raise ValueError('Cannot inspect immutable image')
        rows = json.loads(immutable.stdout)
        if type(rows) is not list or len(rows) != 1 or validate_image(reference, rows[0]) != proof:
            raise ValueError('Service image changed during cache admission')
        verified.append(proof)
    return {'database_operations': 0, 'containers_started': 0, 'images': verified,
            'native_runtime_deadlines_changed': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare-ci-cache', action='store_true', required=True)
    parser.parse_args()
    print(json.dumps(prepare(), sort_keys=True))
