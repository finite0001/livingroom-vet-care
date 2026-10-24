"""Exact reviewed bootstrap content, including the CLI's official GHCR mirror.

The index was independently hashed from GHCR's raw registry response and matches
the retained ECR image's repository digest. Its Linux child manifests were also
independently matched against Docker Hub. This is not a catalog normalization.
"""

POSTGRES_REFERENCES = (
    'public.ecr.aws/supabase/postgres:17.6.1.171',
    'ghcr.io/supabase/postgres:17.6.1.171',
)
POSTGRES_INDEX_DIGEST = 'sha256:658d1c9b09ae4f61b8e95087b6859181b4b7d6940d769cf7b605609c8aad43e9'
POSTGRES_PLATFORM_DIGESTS = {
    'amd64': 'sha256:8fd52f740917ecfce63117428e84e04cbb9c8fed6771431c55e259ebb991e51b',
    'arm64': 'sha256:2163c5dca3899d27b2020a08844e6c5386d8ea954c5a2259e78cc0c7945bc33c',
}


def assert_bootstrap_image(reference, inspected):
    """Require the exact reference, supported platform and content repository pin.

    The caller inspects the owned container's immutable Image ID, not a mutable
    tag. Docker engines may retain either an index or selected-platform digest.
    Neither a matching tag alone nor an unrelated repository digest is accepted.
    """
    assert reference in POSTGRES_REFERENCES, 'Review the bootstrap image reference before changing the trusted environment'
    architecture = inspected.get('Architecture')
    assert inspected.get('Os') == 'linux' and architecture in POSTGRES_PLATFORM_DIGESTS, 'Unreviewed bootstrap image platform'
    repository = reference.rsplit(':', 1)[0]
    allowed = {repository + '@' + digest for digest in (
        POSTGRES_INDEX_DIGEST, POSTGRES_PLATFORM_DIGESTS[architecture])}
    actual = inspected.get('RepoDigests')
    assert isinstance(actual, list) and all(isinstance(value, str) for value in actual), 'Bootstrap image repository digests required'
    matched = allowed.intersection(actual)
    assert matched, 'Bootstrap image content differs from the reviewed digest'
    return {'reference': reference, 'platform': 'linux/' + architecture,
            'repository_digest': sorted(matched)[0], 'reviewed_index_digest': POSTGRES_INDEX_DIGEST}
