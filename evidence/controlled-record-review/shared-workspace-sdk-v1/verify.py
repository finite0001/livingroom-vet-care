"""Verify the fixed historical byte archive. Never extract or execute it."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import sys
import tarfile

HERE = Path(__file__).resolve().parent
AUTHORITY = {
    'backend-manifest.json': '1c612c7c79c39afecbf565dca0cf9b0ca64bb2eafd0c3dcd1b5756253ede45f4',
    'backend-profile.json': '0b57e4244b7f8ff0fe84c4a336b202e51a25d5ff7d692b71fbf345808be2064d',
    'frontend-binding.json': '23e4f0dacab74458237b4921a67b4f17dc36b91ab6b2a91612fbd06a7ebe2b35',
}
ARCHIVE_SHA = '5cea67b34c59c3b329b678b78012db323f95927a49b994ce6b4fbf6023030d74'
ARCHIVE_BYTES = 23154310
INDEX_SHA = '5c98aa587dfd3e8177e2522f2bdafc9ce6ba1e4767ec919dee14d415c786a919'
SAFE_RECORDS = {
    'run/result.json': '9dcd51e67c2a1c4df7a73c488063bb91b4d07f4e1bbb29d117c396d8d1c56492',
    'run/root-direct-tool-return.json': 'f481e8ee8cf1a328021f02a4bf60bd494ca142f87fa6e34dc3cbc0b3deedbefd',
    'run/browser-summary.json': 'a3061fb039fb074f6b2b83b498f8c7a4daf25450ba934d6df5e47007ad134726',
    'reviews/REVIEW.md': '39c94f99445df0fa7c841c3bb6b5bfcbb7ed9f0c872d59c522514bc14e62e5e3',
    'reviews/inspection.json': 'd450a6e015aa9e3ca68d282dc746609e66ae06ba0d7d2555816f0dfb74994086',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_fixed(path, digest, maximum):
    require(path.is_file() and not path.is_symlink(), 'Regular package file required')
    require(path.stat().st_size <= maximum, 'Package file exceeds its fixed bound')
    raw = path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == digest, 'Fixed package bytes changed')
    return raw


def merge_sources(*maps):
    result = {}
    for source in maps:
        for name, digest in source.items():
            require(name not in result or result[name] == digest, 'Conflicting source authorities')
            result[name] = digest
    return result


def expected_sources(authorities):
    profile = authorities['backend-profile.json']
    manifest = authorities['backend-manifest.json']
    binding = authorities['frontend-binding.json']
    backend = merge_sources(profile['original656'], profile['private_source_hashes'],
                            profile['external_authority_hashes'], manifest['extra_sources'])
    frontend = {name: value['sha256'] for name, value in binding['source_files'].items()}
    source_trees = [tree for tree in binding['trees'] if tree['name'] in ('frontend-src', 'frontend-public')]
    require(len(source_trees) == 2, 'Both historical frontend trees required')
    for tree in source_trees:
        require(not tree['symlinks'], 'No archived source symlinks are admitted')
        prefix = 'src' if tree['name'] == 'frontend-src' else 'public'
        frontend = merge_sources(frontend, {prefix + '/' + name: value['sha256'] for name, value in tree['files'].items()})
    require(len(backend) == 1397 and len(frontend) == 640, 'Complete original source sets required')
    return {**{'backend/' + name: digest for name, digest in backend.items()},
            **{'frontend/' + name: digest for name, digest in frontend.items()}}


def verify_archive(path, index, expected):
    require(set(index) == set(expected), 'Archive index differs from original authorities')
    require(path.stat().st_size == ARCHIVE_BYTES, 'Fixed compressed byte count differs')
    read_fixed(path, ARCHIVE_SHA, ARCHIVE_BYTES)
    seen = set()
    # No extraction path or destination is accepted. Historical absolute paths
    # and tool bindings in authority JSON are never opened by this verifier.
    with tarfile.open(path, mode='r|gz') as archive:
        for member in archive:
            name = member.name
            require(name in expected and name not in seen, 'Unexpected or duplicate archive member')
            require(str(PurePosixPath(name)) == name and not name.startswith('/') and
                    '..' not in PurePosixPath(name).parts, 'Unsafe archive name')
            entry = index[name]
            require(member.isreg() and member.size == entry['bytes'] and entry['sha256'] == expected[name],
                    'Historical member metadata differs')
            require(member.uid == member.gid == member.mtime == 0 and member.mode == 0o600,
                    'Deterministic archive metadata differs')
            require(not set(member.pax_headers) - {'path'}, 'Unexpected extended archive metadata')
            stream = archive.extractfile(member)
            require(stream is not None, 'Missing historical source bytes')
            digest = hashlib.sha256()
            count = 0
            with stream:
                while True:
                    raw = stream.read(1024 * 1024)
                    if not raw:
                        break
                    count += len(raw)
                    require(count <= member.size, 'Member byte count exceeded')
                    digest.update(raw)
            require(count == member.size and digest.hexdigest() == expected[name], 'Historical source bytes changed')
            seen.add(name)
    require(seen == set(expected), 'Historical source archive is incomplete')


def main():
    require(len(sys.argv) == 1, 'This fixed verifier accepts no arguments')
    authorities = {name: json.loads(read_fixed(HERE / 'authority' / name, digest, 8 * 1024 * 1024))
                   for name, digest in AUTHORITY.items()}
    index = json.loads(read_fixed(HERE / 'archive-index.json', INDEX_SHA, 2 * 1024 * 1024))
    require(index['runtime_admission'] is False and index['actual_execution_from_archive'] is False,
            'Historical archive cannot claim runtime admission')
    expected = expected_sources(authorities)
    verify_archive(HERE / 'source.tar.gz', index['files'], expected)
    binding = authorities['frontend-binding.json']
    harness = {name: value for name, value in binding['source_files'].items() if name.startswith('tests/')}
    require(len(harness) == 6, 'Six historical harness files required')
    for name, value in harness.items():
        read_fixed(HERE / 'harness' / (PurePosixPath(name).name + '.txt'), value['sha256'], value['size'])
    records = {name: read_fixed(HERE / name, digest, 65536) for name, digest in SAFE_RECORDS.items()}
    result = json.loads(records['run/result.json'])
    require(result['passed'] is True and result['normal_owned_cleanup'] is True and
            result['primary_failed'] is False and result['cleanup_failed'] is False,
            'Recorded successful result differs')
    require(result['manifest_sha256'] == AUTHORITY['backend-manifest.json'] and
            result['profile_sha256'] == AUTHORITY['backend-profile.json'], 'Recorded source bindings differ')
    require(all(result[key] is False for key in ('full_auth_acceptance', 'full_protocol_acceptance',
            'global_closure_security_certification', 'native_origin_security_certification',
            'natural_expiry_contention_acceptance', 'restore_acceptance', 'browser_acceptance', 'clinical_activation')),
            'Recorded finite scope differs')
    summary = json.loads(records['run/browser-summary.json'])
    fields = summary['fields']
    require(summary['projection_only'] is True and all(fields[key] is True for key in
            ('passed', 'dialog_explicit_open_no_rpc', 'recovery_dialog_explicit_open_no_rpc',
             'normal_browser_cleanup', 'normal_vite_cleanup')), 'Recorded browser projection differs')
    require(fields['beforeunload_warning_accepted'] == 1 and fields['failure_type'] is None and
            fields['blocked_external_origins'] == [], 'Recorded browser completion differs')
    print(json.dumps({'kind': 'historical-source-archive-verification-v1', 'passed': True,
                      'backend_files': 1397, 'frontend_files': 640, 'readable_harness_files': 6,
                      'extracted_files': 0, 'runtime_admission': False, 'services_started': 0,
                      'safe_recorded_files': 5, 'recorded_result_passed': True,
                      'hosted_writes': 0, 'fresh_execution_claim': False}, sort_keys=True))


if __name__ == '__main__':
    main()
