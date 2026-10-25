"""Exercise malicious archive boundaries without extracting or running members."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('historical_bundle_verifier', Path(__file__).with_name('verify.py'))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


class ArchiveBoundaryTests(unittest.TestCase):
    def archive(self, members):
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode='w:gz', format=tarfile.PAX_FORMAT) as archive:
            for changes, raw in members:
                member = tarfile.TarInfo('source/example.txt')
                member.mode, member.size = 0o600, len(raw)
                for key, value in changes.items():
                    setattr(member, key, value)
                archive.addfile(member, io.BytesIO(raw) if member.isreg() else None)
        return output.getvalue()

    def check(self, members, *, index=None, expected=None, admitted_digest=None, should_pass=False):
        raw = self.archive(members)
        expected = expected if expected is not None else {'source/example.txt': sha(b'source bytes')}
        index = index if index is not None else {'source/example.txt': {'bytes': 12, 'sha256': sha(b'source bytes')}}
        with tempfile.TemporaryDirectory(prefix='lrv-proof-verifier-') as directory:
            root = Path(directory)
            path = root / 'archive.tar.gz'
            path.write_bytes(raw)
            before = set(root.iterdir())
            if should_pass:
                verifier.verify_archive(path, index, expected, admitted_digest or sha(raw), len(raw))
            else:
                with self.assertRaises(ValueError):
                    verifier.verify_archive(path, index, expected, admitted_digest or sha(raw), len(raw))
            self.assertEqual(set(root.iterdir()), before, 'Verification must not extract source members')

    def test_regular_exact_source_passes_without_extraction(self):
        self.check([({}, b'source bytes')], should_pass=True)

    def test_duplicate_missing_and_extra_members_refuse(self):
        cases = [[], [({}, b'source bytes'), ({}, b'source bytes')],
                 [({'name': 'source/extra.txt'}, b'source bytes')]]
        for members in cases:
            with self.subTest(members=members):
                self.check(members)

    def test_nonregular_members_refuse(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.DIRTYPE,
                     tarfile.FIFOTYPE, tarfile.CHRTYPE, tarfile.BLKTYPE):
            with self.subTest(kind=kind):
                self.check([({'type': kind, 'linkname': '../../outside'}, b'source bytes')])

    def test_metadata_and_unauthorized_pax_refuse(self):
        for mutation in ({'mode': 0o640}, {'uid': 1}, {'gid': 1}, {'mtime': 1},
                         {'uname': 'other'}, {'gname': 'other'}, {'pax_headers': {'comment': 'unapproved'}}):
            with self.subTest(mutation=mutation):
                self.check([(mutation, b'source bytes')])

    def test_unsafe_or_noncanonical_paths_refuse_even_if_indexed(self):
        for name in ('/absolute', '../outside', 'source/../outside', 'source//example.txt', './source/example.txt'):
            with self.subTest(name=name):
                index = {name: {'bytes': 12, 'sha256': sha(b'source bytes')}}
                self.check([({'name': name}, b'source bytes')], index=index,
                           expected={name: sha(b'source bytes')})

    def test_source_hash_and_size_corruption_refuse(self):
        self.check([({}, b'changed data')])
        self.check([({}, b'source bytes extra')])
        self.check([({}, b'source bytes')], index={'source/example.txt': {'bytes': 11, 'sha256': sha(b'source bytes')}})
        self.check([({}, b'source bytes')], index={'source/example.txt': {'bytes': 12, 'sha256': sha(b'changed data')}})

    def test_original_compressed_digest_refuses_a_replacement_before_parsing(self):
        original = self.archive([({}, b'source bytes')])
        self.check([({}, b'changed data')], admitted_digest=sha(original))

    def test_conflicting_authorities_and_outer_symlinks_refuse(self):
        with self.assertRaises(ValueError):
            verifier.merge_sources({'source': 'a' * 64}, {'source': 'b' * 64})
        with tempfile.TemporaryDirectory(prefix='lrv-proof-fixed-file-') as directory:
            root = Path(directory)
            original = root / 'original'
            original.write_bytes(b'fixed bytes')
            link = root / 'link'
            link.symlink_to(original)
            with self.assertRaises(ValueError):
                verifier.read_fixed(link, sha(b'fixed bytes'), 11)
            with self.assertRaises(ValueError):
                verifier.read_fixed(original, sha(b'changed'), 11)

    def test_unfinished_bundle_cannot_report_success(self):
        old, old_fixed = sys.argv, verifier.FIXED
        try:
            sys.argv = ['verify.py']
            verifier.FIXED = None
            with self.assertRaisesRegex(ValueError, 'not frozen'):
                verifier.main()
        finally:
            sys.argv = old
            verifier.FIXED = old_fixed

    def test_record_size_is_exact_including_large_unchanged_notices(self):
        with tempfile.TemporaryDirectory(prefix='lrv-proof-record-') as directory:
            path = Path(directory) / 'notice'
            raw = b'copyright notice\n' * 5000
            path.write_bytes(raw)
            self.assertEqual(verifier.read_record(path, sha(raw), len(raw)), raw)
            for size in (False, -1, len(raw) - 1, len(raw) + 1):
                with self.subTest(size=size), self.assertRaises(ValueError):
                    verifier.read_record(path, sha(raw), size)
            with self.assertRaises(ValueError):
                verifier.read_record(path, sha(b'replacement'), len(raw))

    def test_false_scope_success_and_boolean_counters_refuse(self):
        descriptor = {'manifest_sha256': 'a' * 64, 'profile_sha256': 'b' * 64,
                      'result_kind': 'fixed-local-result', 'false_flags': ['activation'],
                      'required_flags': ['owned_recovery']}
        result = {'passed': True, 'normal_owned_cleanup': True, 'primary_failed': False,
                  'cleanup_failed': False, 'manifest_sha256': 'a' * 64,
                  'profile_sha256': 'b' * 64, 'kind': 'fixed-local-result',
                  'hosted_writes': 0, 'provider_requests': 0, 'activation': False,
                  'owned_recovery': True}
        verifier.verify_recorded_result(result, descriptor)
        for key, value in (('passed', False), ('normal_owned_cleanup', False),
                           ('primary_failed', True), ('cleanup_failed', True),
                           ('activation', True), ('owned_recovery', False),
                           ('hosted_writes', False), ('provider_requests', 1),
                           ('manifest_sha256', 'c' * 64), ('profile_sha256', 'c' * 64),
                           ('kind', 'other-result')):
            with self.subTest(key=key):
                with self.assertRaises(ValueError):
                    verifier.verify_recorded_result({**result, key: value}, descriptor)

    def test_terminal_return_requires_exact_success_and_matching_result(self):
        result = {'passed': True}
        descriptor = {'normal_return_marker': 'ROOT_NORMAL_RETURN /original True',
                      'started_marker': 'Protected closed prototype: /original'}
        terminal = {'exit_code': 0, 'output': descriptor['started_marker'] + '\n' + json.dumps(result) + '\n' + descriptor['normal_return_marker'] + '\n'}
        receipt = {'command': 'original command', 'returns': [{'output': ''}, terminal]}
        verifier.verify_root_return(receipt, descriptor, result)
        for change in ({'exit_code': False}, {'exit_code': 1}, {'session_id': 7},
                       {'output': terminal['output'].replace(' True', ' False')},
                       {'output': terminal['output'].replace('true', 'false')},
                       {'output': terminal['output'].replace('/original', '/other', 1)},
                       {'output': terminal['output'] + 'extra\n'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                verifier.verify_root_return({'command': 'original command', 'returns': [{**terminal, **change}]},
                                            descriptor, result)


if __name__ == '__main__':
    unittest.main()
