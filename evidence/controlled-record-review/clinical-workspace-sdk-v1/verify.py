"""Verify fixed historical clinical proof bytes; never extract or execute them."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import sys
import tarfile

HERE = Path(__file__).resolve().parent
AUTHORITY = {'backend-manifest.json': 'eaa01b0a8f89587ad4e41355283a77290af4ba0b6c5f6b0f986a3660d5c96902', 'backend-profile.json': '554d25c9532ca54f054a884d4a39b1ffa08cf045bf729d1fa1dcd76ed6b833c7', 'frontend-binding.json': '6f74ebfd216a4a906fc9b15ad2f5de631d4cbe02b69f206433dc5a887a733050'}
ARCHIVE_SHA = 'e9eed2671e9b127985374c4d62372f11a51fe81e9254072fafb0a88d92d72e66'
ARCHIVE_BYTES = 31459782
INDEX_SHA = 'c17a42f13b9fd572f22b5370668936d7b6cf0aa6c251329f9d26052ace6440d4'
SAFE_RECORDS = {'run/root-direct-tool-return.json': 'ef5cdae4fe68e30af571082fe792a1b616ae07ebcf1e8b64bbe3058f5674d048', 'run/result.json': '300f57b4ea55def1ef1a3ed83e239bd01d0511e142451bd5dad5d5af4b70d514', 'run/browser-summary.json': '9541cbdc7b8bc1a14042d83e704e908952d56f8593df33f8711a797d038dcb99', 'reviews/backend-REVIEW.md': '4d3f516fc650ef6da2a08a5e9b426fa392a12b720ccb030d3994e9d542b0a351', 'reviews/actual-REVIEW.md': 'd685c41185cb473ee20d6ca5365a9ea230ec2922d696fc61c2d9ba4ba0584693', 'reviews/actual-inspection.json': '79b208c724b51aef50529e3b82c3b2dd8b58ea04ec3bc025e5ab08a12f9efe2d', 'reviews/frontend-REVIEW.md': '10aff704cd8463103e2747c2f4aa5b7b6f8b5720d86441e42e603c83b4b7d7c5', 'reviews/actual-extra-inspection.json': '08b80f1583e37744223c6d4fdef3859c4e3492a9f51eae5d4affdd9cdec39784'}


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
    require(len(backend) == 2150 and len(frontend) == 646, 'Complete original source sets required')
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
    require(len(harness) == 8, 'Eight historical harness files required')
    for name, value in harness.items():
        read_fixed(HERE / 'harness' / (PurePosixPath(name).name + '.txt'), value['sha256'], value['size'])
    records = {name: read_fixed(HERE / name, digest, 65536) for name, digest in SAFE_RECORDS.items()}
    result = json.loads(records['run/result.json'])
    require(result['passed'] is True and result['normal_owned_cleanup'] is True and
            result['primary_failed'] is False and result['cleanup_failed'] is False,
            'Recorded successful result differs')
    require(result['manifest_sha256'] == AUTHORITY['backend-manifest.json'] and
            result['profile_sha256'] == AUTHORITY['backend-profile.json'], 'Recorded source bindings differ')
    require(result['clinical_browser_signing_and_recovery'] is True and result['python_http_requests'] == 34 and
            result['hosted_writes'] == result['provider_requests'] == 0, 'Recorded finite clinical result differs')
    require(all(result[key] is False for key in ('full_auth_acceptance', 'full_protocol_acceptance',
            'global_closure_security_certification', 'native_origin_security_certification',
            'natural_expiry_contention_acceptance', 'restore_acceptance', 'browser_acceptance', 'clinical_activation')),
            'Recorded finite scope differs')
    summary = json.loads(records['run/browser-summary.json'])
    require(summary['projection_only'] is True and summary['synthetic_records_only'] is True and
            set(summary['cycles']) == {'treatment', 'anesthesia'}, 'Recorded two-cycle projection differs')
    methods = ['list_controlled_record_reviews_v3', 'get_controlled_record_review_event_v3',
               'prepare_controlled_record_review_v3', 'execute_controlled_record_review_v3',
               'read_controlled_record_review_v3']
    for kind, cycle in summary['cycles'].items():
        fields, supervisor = cycle['browser'], cycle['supervisor']
        require(all(fields[key] is True for key in ('passed', 'clinical_presentation_verified', 'queue_detail_admitted',
                'server_selection_used', 'reload_selection_absent', 'sdk_identity_verified',
                'dialog_explicit_open_no_rpc', 'recovery_dialog_explicit_open_no_rpc', 'recovery_explicitly_released',
                'normal_browser_cleanup', 'normal_vite_cleanup')), 'Recorded clinical browser projection differs')
        require(fields['event_kind'] == ('record_patient_treatment' if kind == 'treatment' else 'record_anesthesia_drug_administration') and
                fields['beforeunload_warning_accepted'] is True and fields['auth_calls'] == 1 and
                fields['failure_type'] is None and fields['blocked_external_origins'] == [],
                'Recorded clinical identity or completion differs')
        require([call['method'] for call in fields['calls']] == methods and
                fields['responses'] == [{'method': method, 'status': 200} for method in methods],
                'Recorded five business calls differ')
        require(all(supervisor[key] is True for key in ('passed', 'normal_child_exit', 'normal_browser_cleanup',
                'normal_vite_cleanup', 'owned_processes_absent', 'auth_phase_exact_counts', 'auth_phase_non_auth_preserved',
                'readonly_exact_row_preservation')), 'Recorded parent-supervised result differs')
        require(supervisor['binding_sha256'] == AUTHORITY['frontend-binding.json'] and
                supervisor['exit_code'] == 0 and supervisor['emergency_termination'] is False and
                supervisor['ownership_observation_ledger'] == [] and supervisor['pending_metadata_pids'] == [] and
                supervisor['unverified_processes'] == [] and supervisor['universal_descendant_claim'] is False,
                'Recorded process ownership or source binding differs')
    print(json.dumps({'kind': 'historical-clinical-source-archive-verification-v1', 'passed': True,
                      'backend_files': 2150, 'frontend_files': 646, 'readable_harness_files': 8,
                      'extracted_files': 0, 'runtime_admission': False, 'services_started': 0,
                      'safe_recorded_files': 8, 'recorded_result_passed': True,
                      'hosted_writes': 0, 'fresh_execution_claim': False}, sort_keys=True))


if __name__ == '__main__':
    main()
