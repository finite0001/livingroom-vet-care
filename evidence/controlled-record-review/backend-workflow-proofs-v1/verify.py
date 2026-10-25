"""Read fixed historical proof bytes. Never extract or execute archived code."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import sys
import tarfile

HERE = Path(__file__).resolve().parent
# Filled only after all named actual runs and independent artifact reviews pass.
# An unfinished package cannot verify itself or admit a runtime.
FIXED = {'archive_bytes': 38812194,
 'archive_sha256': 'a77a148e1310e1e70acf2b575dbdfccb8be64097cf05756ef66a6af96f4f71e4',
 'fresh_execution_claim': False,
 'index_sha256': '502d4be2bfba3d0359ebffae7d2e1c4f2f1e93ba0f30ffbe7d12cfa1e0f90b74',
 'integrated_candidate': False,
 'profiles': {'native': {'false_flags': ['browser_acceptance',
                                         'full_auth_acceptance',
                                         'full_native_return_acceptance',
                                         'full_protocol_acceptance',
                                         'global_closure_security_certification',
                                         'immediate_discrepancy_report_escalation_acceptance',
                                         'native_activation',
                                         'native_origin_security_certification',
                                         'natural_expiry_contention_acceptance',
                                         'restore_acceptance',
                                         'return_v2_actual'],
                         'manifest_sha256': 'a53f9526573589e94351ba2935845af6c32390b265d0f3fde565f29ffcdd4b30',
                         'normal_return_marker': 'ROOT_NORMAL_RETURN '
                                                 '/private/tmp/lrv-closed-native-discrepancies-ls8sqbr6 '
                                                 'True',
                         'profile_sha256': 'e8a665ead9cc391348b7646df2c284207e70be13a8564e63492102bbf656eec1',
                         'required_flags': ['canonical_dispense_return_discrepancies',
                                            'native_four_discrepancy_http',
                                            'complete_original_reference_equal',
                                            'private_complete_graph_diagnostics',
                                            'exact_audit_payloads',
                                            'exact_auth_side_effects',
                                            'exact_committed_invariants',
                                            'exact_static_metadata',
                                            'owned_saved_recovery'],
                         'result_kind': 'closed-local-authenticated-four-discrepancy-v5-stock-head-prototype',
                         'source_files': 1983,
                         'started_marker': 'Protected closed prototype: '
                                           '/private/tmp/lrv-closed-native-discrepancies-ls8sqbr6'},
              'natural': {'false_flags': ['browser_acceptance',
                                          'clinical_activation',
                                          'full_auth_acceptance',
                                          'full_protocol_acceptance',
                                          'global_closure_security_certification',
                                          'native_origin_security_certification',
                                          'natural_expiry_contention_acceptance',
                                          'restore_acceptance'],
                          'manifest_sha256': '3137a45a385bd7953d6fa181ce8ba2c1d35a8a1dc207c821efc9994ccc72e4fa',
                          'normal_return_marker': 'ROOT_NORMAL_RETURN '
                                                  '/private/tmp/lrv-closed-clinical-wamd75t7 True',
                          'profile_sha256': '66fde901adbf632acde35a81322cbb5a8d8d9ba7f530fed76ac3b3d92a625b1d',
                          'required_flags': ['actual_declared_timezone_calendar',
                                             'actual_natural_wait_completed',
                                             'natural_three_atomic_channels',
                                             'postwait_genuine_fresh_reviewer_B',
                                             'complete_original_reference_equal',
                                             'exact_audit_payloads',
                                             'exact_auth_side_effects',
                                             'exact_committed_invariants',
                                             'exact_static_metadata',
                                             'owned_saved_recovery'],
                          'result_kind': 'closed-local-natural-late3-hot230-prototype-v1',
                          'source_files': 2292,
                          'started_marker': 'Protected closed prototype: '
                                            '/private/tmp/lrv-closed-clinical-wamd75t7'},
              'restore': {'false_flags': ['browser_acceptance',
                                          'clinical_activation',
                                          'full_auth_acceptance',
                                          'full_protocol_acceptance',
                                          'global_closure_security_certification',
                                          'native_origin_security_certification',
                                          'natural_expiry_contention_acceptance',
                                          'restore_acceptance'],
                          'manifest_sha256': '7bf6e28150d7413d0f4b53efb25a79a45b07f471bd2da29434c5aa5b8b804f5d',
                          'normal_return_marker': 'ROOT_NORMAL_RETURN '
                                                  '/private/tmp/lrv-closed-rejection-lac6xyg1 True',
                          'profile_sha256': '0b57e4244b7f8ff0fe84c4a336b202e51a25d5ff7d692b71fbf345808be2064d',
                          'required_flags': ['selected_populated_history_restore',
                                             'original_after_restore_unchanged',
                                             'original_c0_http_stays_private',
                                             'genuine_cross_session_execute',
                                             'exact_audit_payloads',
                                             'exact_auth_side_effects',
                                             'exact_static_metadata',
                                             'scalar_read_after_rejection',
                                             'scalar_read_before_signing'],
                          'result_kind': 'closed-populated-scalar176-fresh-restore-prototype-v10',
                          'source_files': 1904,
                          'started_marker': 'Protected closed prototype: '
                                            '/private/tmp/lrv-closed-rejection-lac6xyg1'}},
 'record_bytes': {'privacy-scan.json': 490,
                  'reviews/native-audit.md': 6652,
                  'reviews/native-source-gate.md': 3249,
                  'reviews/natural-audit.md': 6274,
                  'reviews/natural-source-gate.md': 6847,
                  'reviews/restore-audit.md': 7089,
                  'reviews/restore-source-gate.md': 4980,
                  'runs/native-invariants.json': 452,
                  'runs/native-result.json': 2188,
                  'runs/native-root-tool-return.json': 3905,
                  'runs/natural-invariants.json': 173,
                  'runs/natural-result.json': 1818,
                  'runs/natural-root-tool-return.json': 4311,
                  'runs/natural-wait-result.json': 504,
                  'runs/restore-auth-sequence-effects.json': 433,
                  'runs/restore-helper-projection.json': 1641,
                  'runs/restore-result.json': 1715,
                  'runs/restore-root-tool-return.json': 3584,
                  'third-party/kong-2.8.1-COPYRIGHT': 126712,
                  'third-party/kong-2.8.1-LICENSE': 11345,
                  'third-party/moby-v27.4.0-LICENSE': 10765,
                  'third-party/moby-v27.4.0-NOTICE': 642,
                  'third-party/pgtype-LICENSE': 1078,
                  'third-party/pgx-LICENSE': 1078,
                  'third-party/pop-LICENSE.txt': 1067,
                  'third-party/postgres-REL_17_6-COPYRIGHT': 1198,
                  'third-party/postgrest-v16.3-LICENSE': 1075,
                  'third-party/provenance.json': 3366,
                  'third-party/sqlx-LICENSE': 1077,
                  'third-party/supabase-auth-v2.197.0-LICENSE': 1093,
                  'third-party/supabase-cli-2.118.0-LICENSE': 1088,
                  'third-party/supabase-postgres-17.6.1.171-LICENSE': 932},
 'records': {'privacy-scan.json': 'e845362b030b8ec3bc8884bb76f811c4b6408a359ff2ba1d37ef73fd84efa850',
             'reviews/native-audit.md': 'e337851de405c01a49215b32ddb4f6bd9af30f0ea2472fe58548450e3c578c0b',
             'reviews/native-source-gate.md': '26c38a81d473b6b0f2794d7ac8c3bf491c55909805352314ff32c901a61cddc5',
             'reviews/natural-audit.md': '8dba30a7e68a460624f1989d4311aec5ee971058a0cd63d1594a0f17934b0c06',
             'reviews/natural-source-gate.md': '35e42d2b887adc3a38f3ec2c6a16351eb6bd33640da1a5735841aa24dee98efc',
             'reviews/restore-audit.md': '4462bdcfd3b74ae5e1397bcba0cc1ae911ca9d05669d3c9b429a3b0e34001a77',
             'reviews/restore-source-gate.md': '28e8a0bd7f9ee9e5411cb7f36dc92d92c4cd97bf53838cd219f7e78efa75ec03',
             'runs/native-invariants.json': 'b00679b8e24b57ab7473adfc08d99a23ff7ddd556906cee5483034ffc1c3937a',
             'runs/native-result.json': '5b2136486d9bc2e79792cdbb887d2c98cc3f2de49ef413a102f772d0f4c14047',
             'runs/native-root-tool-return.json': 'ed2a32c37f61a8a36545b177471968b529b637642a1dd2135ad68dc7a70e1f4b',
             'runs/natural-invariants.json': 'aae5ea6620f56695670dfacab0c8e9c7e3726bc61de5f73053b80bcfcff7c796',
             'runs/natural-result.json': '62f96a29b9cf7f1f8ba4cb8c174525bc10f902ff9180ed48dc5b98caeb0c90d4',
             'runs/natural-root-tool-return.json': '867514cd6fc1d1cd5a1dd90cadba7e327c7b8e4f9794eb8b972fb308c7b23571',
             'runs/natural-wait-result.json': '9bcae0fb716d9b3e524fd04c54a52c284cda17bfa16d5d4432f9807720a503c1',
             'runs/restore-auth-sequence-effects.json': '7b55c7132a348414f3154c5722c0549deb5325a5078247750c203d6af9c4ba26',
             'runs/restore-helper-projection.json': 'abd1f36d9520d9843cd7fa9ff0ff21560417f23a65d494eef55a5de32475a0d0',
             'runs/restore-result.json': '2b23cdc02a97975dddc1b8dd6ce5555e3eb1ba7166116ed0d3afd8196546b87d',
             'runs/restore-root-tool-return.json': '663c4167cc38c6e18e3dd1d553366e76286632e475c32b8bccf6766f11fd9d8b',
             'third-party/kong-2.8.1-COPYRIGHT': '6d81ea08e13dc56793f921c4dc99fa339874e57930bf71422a99bc98e3c6236c',
             'third-party/kong-2.8.1-LICENSE': '104aed7ff96eb6263412957ff4aef10666cfc8182ea314206ca9a4eb1f9d4792',
             'third-party/moby-v27.4.0-LICENSE': '7c87873291f289713ac5df48b1f2010eb6963752bbd6b530416ab99fc37914a8',
             'third-party/moby-v27.4.0-NOTICE': 'b40ec5b16182103ef1cd69d42a21c98369e35bd483b3973902da4807c0755446',
             'third-party/pgtype-LICENSE': '467f95e074fe23079a5623ed652619682692041b8551da27e3c2ddb9659a1507',
             'third-party/pgx-LICENSE': '467f95e074fe23079a5623ed652619682692041b8551da27e3c2ddb9659a1507',
             'third-party/pop-LICENSE.txt': '692e24554548f7b323c6ecdc05fdbd30a7de1c9865cb478626c32183794fea4b',
             'third-party/postgres-REL_17_6-COPYRIGHT': '5ed3ce5c9373dff7f98b1fae7a6c7ccd98df7d734d46d24c1bcebf1240be8307',
             'third-party/postgrest-v16.3-LICENSE': '1729d66741c5844f47962f91838bae897aa23d7e08272f5f012fca576288fafb',
             'third-party/provenance.json': 'c6173370356b26ad4fdc08c97174e945b09e841055e2075de34001c20288ee80',
             'third-party/sqlx-LICENSE': 'a0cc6c18255c47fad558e3a40ab10df927dd914156b267a819e073f8755991b3',
             'third-party/supabase-auth-v2.197.0-LICENSE': '68c80ef00664ea62a2c6f38c0ef044497caacc6648a8bd92eec7fdb81e01f904',
             'third-party/supabase-cli-2.118.0-LICENSE': '81f7d60afa4316010b1c0df8eb8f0c80b27586a86b72f1bde85e129bfd10d52a',
             'third-party/supabase-postgres-17.6.1.171-LICENSE': 'fd313c784c2e3c964fe043fdb7bcffa8f84627d53d2cf3a61c61586ff6c3f4c1'},
 'runtime_admission': False,
 'unique_source_files': 3628}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_fixed(path, expected, maximum):
    require(path.is_file() and not path.is_symlink(), 'Regular package file required')
    require(path.stat().st_size <= maximum, 'Fixed package byte bound exceeded')
    raw = path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == expected, 'Fixed package bytes changed')
    return raw


def merge_sources(*maps):
    result = {}
    for mapping in maps:
        require(type(mapping) is dict, 'Original source map required')
        for name, digest in mapping.items():
            require(type(name) is str and type(digest) is str and len(digest) == 64,
                    'Original source identity required')
            require(name not in result or result[name] == digest, 'Conflicting original source authorities')
            result[name] = digest
    return result


def read_record(path, expected, size):
    require(type(size) is int and size >= 0, 'Fixed record size required')
    raw = read_fixed(path, expected, size)
    require(len(raw) == size, 'Exact recorded byte size changed')
    return raw


def sources_from_authorities(profile, manifest):
    return merge_sources(profile['original656'], profile['private_source_hashes'],
                         profile['external_authority_hashes'], manifest['extra_sources'])


def verify_archive(path, index, expected, archive_sha, archive_bytes):
    require(type(index) is dict and set(index) == set(expected), 'Complete original source set required')
    require(path.stat().st_size == archive_bytes, 'Fixed compressed size changed')
    read_fixed(path, archive_sha, archive_bytes)
    seen = set()
    # Stream members without a destination or filesystem extraction operation.
    with tarfile.open(path, mode='r|gz') as archive:
        for member in archive:
            name = member.name
            require(name in expected and name not in seen, 'Unexpected or duplicate source member')
            require(str(PurePosixPath(name)) == name and not name.startswith('/') and
                    '..' not in PurePosixPath(name).parts, 'Noncanonical source path')
            entry = index[name]
            require(type(entry) is dict and set(entry) == {'bytes', 'sha256'} and
                    type(entry['bytes']) is int and entry['bytes'] >= 0 and
                    entry['sha256'] == expected[name], 'Source index differs from original authority')
            require(member.isreg() and member.size == entry['bytes'], 'Regular exact-sized member required')
            require(member.uid == member.gid == member.mtime == 0 and member.mode == 0o600 and
                    member.uname == member.gname == '', 'Deterministic source metadata changed')
            require(not set(member.pax_headers) - {'path'}, 'Unexpected extended source metadata')
            stream = archive.extractfile(member)
            require(stream is not None, 'Missing source bytes')
            digest, count = hashlib.sha256(), 0
            with stream:
                while True:
                    raw = stream.read(1024 * 1024)
                    if not raw:
                        break
                    count += len(raw)
                    require(count <= member.size, 'Source size exceeded')
                    digest.update(raw)
            require(count == member.size and digest.hexdigest() == expected[name], 'Original source bytes changed')
            seen.add(name)
    require(seen == set(expected), 'Historical source archive is incomplete')


def verify_recorded_result(result, descriptor):
    require(result['passed'] is True and result['normal_owned_cleanup'] is True and
            result['primary_failed'] is False and result['cleanup_failed'] is False,
            'Original successful terminal result required')
    require(result['manifest_sha256'] == descriptor['manifest_sha256'] and
            result['profile_sha256'] == descriptor['profile_sha256'] and
            result['kind'] == descriptor['result_kind'], 'Recorded result source profile changed')
    require(type(result['hosted_writes']) is int and result['hosted_writes'] == 0 and
            type(result['provider_requests']) is int and result['provider_requests'] == 0,
            'Recorded finite local scope changed')
    require(all(result[key] is False for key in descriptor['false_flags']),
            'Recorded broader acceptance boundary changed')
    require(all(result[key] is True for key in descriptor['required_flags']),
            'Recorded required finite proof changed')


def verify_root_return(receipt, descriptor, result):
    require(type(receipt) is dict and set(receipt) == {'command', 'returns'} and
            type(receipt['command']) is str and type(receipt['returns']) is list and
            len(receipt['returns']) > 0, 'Complete original tool receipt required')
    terminal = receipt['returns'][-1]
    require(type(terminal) is dict and type(terminal.get('exit_code')) is int and
            terminal['exit_code'] == 0 and 'session_id' not in terminal,
            'Successful terminal process return required')
    outputs = []
    for item in receipt['returns']:
        require(type(item) is dict and type(item.get('output')) is str,
                'Original incremental process output required')
        outputs.append(item['output'])
    lines = ''.join(outputs).splitlines()
    require(len(lines) == 3 and lines[0] == descriptor['started_marker'] and
            lines[-1] == descriptor['normal_return_marker'],
            'Exact successful normal-return marker required')
    require(json.loads(lines[1]) == result, 'Terminal result must equal the retained result')


def main():
    require(len(sys.argv) == 1, 'This fixed historical verifier accepts no arguments')
    require(type(FIXED) is dict, 'Proof bundle is not frozen')
    require(FIXED['integrated_candidate'] is False and FIXED['runtime_admission'] is False and
            FIXED['fresh_execution_claim'] is False and len(FIXED['profiles']) == 3,
            'Separate historical profiles required')
    index = json.loads(read_fixed(HERE / 'archive-index.json', FIXED['index_sha256'], 4 * 1024 * 1024))
    require(index['integrated_candidate'] is False and index['runtime_admission'] is False,
            'Historical storage cannot combine source behavior')
    combined, profile_counts = {}, {}
    for name, descriptor in FIXED['profiles'].items():
        profile = json.loads(read_fixed(HERE / 'authority' / (name + '-profile.json'),
                                        descriptor['profile_sha256'], 8 * 1024 * 1024))
        manifest = json.loads(read_fixed(HERE / 'authority' / (name + '-manifest.json'),
                                         descriptor['manifest_sha256'], 8 * 1024 * 1024))
        require(manifest['profile_sha256'] == descriptor['profile_sha256'], 'Original profile linkage changed')
        sources = sources_from_authorities(profile, manifest)
        require(len(sources) == descriptor['source_files'], 'Original profile source membership changed')
        profile_counts[name] = len(sources)
        combined = merge_sources(combined, sources)
        result_name = 'runs/' + name + '-result.json'
        result = json.loads(read_fixed(HERE / result_name, FIXED['records'][result_name], 65536))
        verify_recorded_result(result, descriptor)
        receipt_name = 'runs/' + name + '-root-tool-return.json'
        receipt = json.loads(read_fixed(HERE / receipt_name, FIXED['records'][receipt_name], 65536))
        verify_root_return(receipt, descriptor, result)
    expected = {'source/' + name: digest for name, digest in combined.items()}
    require(len(expected) == FIXED['unique_source_files'], 'Original source union changed')
    verify_archive(HERE / 'source.tar.gz', index['files'], expected,
                   FIXED['archive_sha256'], FIXED['archive_bytes'])
    for name, digest in FIXED['records'].items():
        read_record(HERE / name, digest, FIXED['record_bytes'][name])
    print(json.dumps({'kind': 'historical-backend-proof-bundle-verification-v1', 'passed': True,
                      'profiles': profile_counts, 'unique_source_files': len(expected),
                      'integrated_candidate': False, 'runtime_admission': False,
                      'fresh_execution_claim': False, 'services_started': 0,
                      'extracted_files': 0, 'hosted_writes': 0}, sort_keys=True))


if __name__ == '__main__':
    main()
