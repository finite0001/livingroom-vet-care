"""No-DB tests of exact process evidence, including interrupted commands."""
import copy
import gzip
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SOURCE=Path(__file__).resolve().parents[2]/'tests/controlled-drugs/engine/candidate'
sys.path.insert(0,str(SOURCE))
import record_review_v3_evidence_io as evidence


class EvidenceTests(unittest.TestCase):
    def test_binary_roundtrip_digests_complete_inventory_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);writer=evidence.Evidence(folder)
            data=b'\x00\xff\r\nSQL\n'*400
            writer.write('stdout.log',data);writer.verify()
            self.assertEqual(evidence.read_member(folder,'stdout.log'),data)
            with self.assertRaises(AssertionError):writer.write('stdout.log',data)
            with self.assertRaises(AssertionError):writer.write('../escape',data)
            (folder/'extra.gz').write_bytes(gzip.compress(b'extra'))
            with self.assertRaises(AssertionError):writer.verify()

    def test_digest_size_encoding_and_decompression_limit_corruption_reject(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);writer=evidence.Evidence(folder);writer.write('data',b'original'*100)
            original=copy.deepcopy(writer.entries['data'])
            for key,value in [('compressed_sha256','0'*64),('decoded_sha256','0'*64),('decoded_bytes',1),('compressed_bytes',1),('encoding','raw'),('path','other.gz')]:
                wrong=dict(original);wrong[key]=value
                with self.subTest(key=key),self.assertRaises(AssertionError):evidence.read_member(folder,'data',wrong)
            with self.assertRaises(AssertionError):evidence.bounded_decode(gzip.compress(b'x'*1000),20)
            stored=folder/'data.gz';stored.write_bytes(stored.read_bytes()[:-5])
            with self.assertRaises(AssertionError):writer.verify()

    def test_actual_success_nonzero_and_timeout_retain_exact_streams(self):
        for mode in ('success','failure','timeout'):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as temporary:
                folder=Path(temporary);writer=evidence.Evidence(folder)
                code="import sys,time;d=sys.stdin.buffer.read();sys.stdout.buffer.write(d);sys.stdout.flush();sys.stderr.write('specific error\\n');sys.stderr.flush();"
                code+=('time.sleep(10)' if mode=='timeout' else 'sys.exit('+('7' if mode=='failure' else '0')+')')
                if mode=='timeout':
                    with self.assertRaises(subprocess.TimeoutExpired):writer.command([sys.executable,'-c',code],'exact\r\ninput',stem='001',scratch=folder,timeout=.5)
                else:
                    result=writer.command([sys.executable,'-c',code],'exact\r\ninput',stem='001',scratch=folder,timeout=5)
                    self.assertEqual(result.returncode,7 if mode=='failure' else 0)
                self.assertEqual(evidence.read_member(folder,'001-executed.sql'),b'exact\r\ninput')
                self.assertEqual(evidence.read_member(folder,'001-stdout.log'),b'exact\r\ninput')
                self.assertEqual(evidence.read_member(folder,'001-stderr.log'),b'specific error\n')
                writer.verify();self.assertFalse(list(folder.glob('pending-*')))

    def test_retention_failure_preserves_pending_raw_and_cannot_verify(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);writer=evidence.Evidence(folder)
            original=writer.write
            def fail_stderr(name,data):
                if name.endswith('stderr.log'):raise OSError('synthetic retention failure')
                original(name,data)
            with patch.object(writer,'write',side_effect=fail_stderr),self.assertRaises(OSError):
                writer.command([sys.executable,'-c',"import sys;print('raw proof');sys.stderr.write('raw failure')"],None,stem='001',scratch=folder,timeout=5)
            pending=list(folder.glob('pending-*'));self.assertEqual(len(pending),1)
            self.assertEqual((pending[0]/'stdout').read_bytes(),b'raw proof\n')
            self.assertEqual((pending[0]/'stderr').read_bytes(),b'raw failure')
            with self.assertRaises(AssertionError):writer.verify()

    def test_actual_child_output_cap_preserves_partial_bytes_then_cleanup_runs(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);writer=evidence.Evidence(folder)
            with patch.object(evidence,'MAX_MEMBER_BYTES',4096):
                with self.assertRaisesRegex(AssertionError,'output'):
                    writer.command([sys.executable,'-c',"import os,signal;signal.signal(signal.SIGXFSZ,signal.SIG_DFL);os.write(1,b'x'*8192);os.write(1,b'y'*8192)"],None,stem='overflow',scratch=folder,timeout=5)
                self.assertEqual(evidence.read_member(folder,'overflow-stdout.log'),b'x'*4096)
                writer.verify()
                writer.begin_cleanup()
                result=writer.command([sys.executable,'-c',"print('owned cleanup remains available')"],None,stem='cleanup',scratch=folder,timeout=5)
                self.assertEqual(result.returncode,0);writer.verify()

    def test_exhausted_workload_evidence_does_not_consume_cleanup_reserve(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);writer=evidence.Evidence(folder)
            with patch.object(evidence,'MAX_COMPRESSED_BYTES',0),patch.object(evidence,'MAX_DECODED_BYTES',0):
                with self.assertRaises(AssertionError):writer.write('workload',b'x')
                writer.begin_cleanup()
                result=writer.command([sys.executable,'-c',"print('cleanup')"],None,stem='cleanup',scratch=folder,timeout=5)
                self.assertEqual(result.returncode,0);writer.verify()
                self.assertTrue(all(e['phase']=='cleanup'for e in writer.entries.values()))


if __name__=='__main__':unittest.main()
