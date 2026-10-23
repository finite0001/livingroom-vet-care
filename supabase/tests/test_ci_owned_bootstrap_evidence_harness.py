"""No-DB orchestration tests, including real encrypted inert-process capture."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import re
from pathlib import Path
import stat
import subprocess
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('ci_owned_wrapper',ROOT/'scripts/ci-owned-bootstrap-evidence.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
SECRET='synthetic-secret-must-remain-private'


class Crypto:
    RECIPIENT_PEM_SHA256='a'*64
    RECIPIENT_DER_SHA256='b'*64

    def __init__(self,fail=False):self.fail=fail;self.calls=[];self.child_done=False

    @staticmethod
    def sha256_file(path):return hashlib.sha256(path.read_bytes()).hexdigest()

    def seal(self,capture,private,upload,metadata,recipient,pem,der):
        assert self.child_done or metadata['child_state']=='known_not_started','Cannot seal while child still runs'
        assert pem==self.RECIPIENT_PEM_SHA256 and der==self.RECIPIENT_DER_SHA256
        assert recipient==ROOT/m.RECIPIENT
        self.calls.append((capture,private,upload,metadata))
        if metadata['child_state']=='completed':
            assert (capture/'stdout.bin').read_bytes()==SECRET.encode()+b'\x00\xff'
            assert (capture/'stderr.bin').read_bytes()==SECRET.encode()+b' stderr'
        else:
            assert (capture/'stdout.bin').read_bytes()==b''
            assert (capture/'stderr.bin').read_bytes()==b''
        assert json.loads((capture/'metadata.json').read_text())==metadata
        if self.fail:raise RuntimeError(SECRET+' encryption failed')
        upload.mkdir(mode=0o700);path=upload/'evidence.cms'
        path.write_bytes(b'FAKE-OPAQUE-ENVELOPE-FOR-ORCHESTRATION-ONLY')
        return dict(ciphertext_sha256=self.sha256_file(path),ciphertext_bytes=path.stat().st_size,
                    recipient_fingerprint=der,raw_evidence_encrypted=True)


class OwnedBootstrapEvidenceTests(unittest.TestCase):
    def metadata(self,repo,stage,environ,crypto):
        return dict(schema=1,stage=stage,run_id='123',run_attempt='2',job='database',
                    github_sha='c'*40,checked_out_sha='d'*40,pr_head_sha='e'*40,
                    source_sha256={'synthetic.py':'f'*64},private_detail=SECRET)

    def exercise(self,stage='timer_probe',code=0,seal_fails=False,cleanup=True,runner_raises=False,source_changes=False):
        with tempfile.TemporaryDirectory()as folder:
            parent=Path(folder).resolve();crypto=Crypto(seal_fails);calls=[];public=io.StringIO()
            def runner(argv,**kwargs):
                calls.append((argv,kwargs))
                self.assertEqual(argv,m.commands(ROOT)[stage])
                self.assertEqual(set(kwargs),{'cwd','env','stdout','stderr','check'})
                self.assertIs(kwargs['check'],False)
                self.assertEqual(kwargs['cwd'],ROOT)
                child_tmp=Path(kwargs['env']['TMPDIR']);capture=child_tmp.parent
                self.assertEqual(child_tmp.name,'tmp');self.assertEqual(capture.name,'capture')
                for path in (child_tmp,capture,capture.parent,capture.parent/'private'):
                    self.assertEqual(stat.S_IMODE(path.stat().st_mode),0o700)
                for stream in (kwargs['stdout'],kwargs['stderr']):
                    self.assertEqual(stat.S_IMODE(os.fstat(stream.fileno()).st_mode),0o600)
                kwargs['stdout'].write(SECRET.encode()+b'\x00\xff')
                kwargs['stderr'].write(SECRET.encode()+b' stderr')
                nested=child_tmp/'lrv-owned-bootstrap-interleaving-evidence-test';nested.mkdir()
                (nested/'result.json').write_text(json.dumps({'kind':'owned-canonical206-scheduler-interleaving-v1',
                    'passed':code==0,'owned_cleanup_verified':cleanup,'private_error':SECRET}))
                (nested/'query.sql').write_text('select '+SECRET)
                if runner_raises:raise RuntimeError(SECRET+' wait interrupted')
                crypto.child_done=True
                return SimpleNamespace(returncode=code)
            observations=0
            def metadata(*args):
                nonlocal observations
                observations+=1
                result=self.metadata(*args)
                if source_changes and observations>1:result['source_sha256']={'synthetic.py':'0'*64}
                return result
            with contextlib.redirect_stdout(public),contextlib.redirect_stderr(public):
                actual=m.run_stage(stage,environ={'RUNNER_TEMP':str(parent)},runner=runner,crypto=crypto,
                    metadata_builder=metadata)
            upload=parent/('lrv-owned-bootstrap-upload-'+stage)
            self.assertEqual(len(calls),1)
            self.assertNotIn(SECRET,public.getvalue())
            status=json.loads((upload/'public-status.json').read_text())
            self.assertNotIn(SECRET,json.dumps(status))
            self.assertNotIn('private_detail',status);self.assertNotIn('source_sha256',status)
            self.assertEqual(status['checked_out_sha'],'d'*40);self.assertEqual(status['pr_head_sha'],'e'*40)
            for path in upload.iterdir():
                self.assertNotIn(SECRET,path.name);self.assertNotIn(SECRET.encode(),path.read_bytes())
            capture=next(parent.glob('lrv-owned-bootstrap-private-*'))/'capture'
            self.assertTrue((capture/'tmp').is_dir())
            self.assertIn(SECRET.encode(),(capture/'stderr.bin').read_bytes())
            if runner_raises:
                self.assertEqual(actual,1);self.assertEqual(crypto.calls,[])
                self.assertEqual(status['error_code'],'child_not_completed')
                self.assertEqual({p.name for p in upload.iterdir()},{'public-status.json'})
            else:
                self.assertEqual(len(crypto.calls),1)
                must_fail=seal_fails or source_changes or(stage=='timer_probe'and not cleanup)
                self.assertEqual(actual,(128-code if code<0 else code)if code else(1 if must_fail else 0))
                self.assertEqual(status['child_returncode'],code)
                self.assertEqual(status['cleanup_verified'],cleanup if stage=='timer_probe'else False)
                self.assertEqual(status['raw_evidence_encrypted'],not seal_fails)
                self.assertEqual({p.name for p in upload.iterdir()},
                    {'public-status.json'}if seal_fails else{'public-status.json','evidence.cms'})
            return status

    def test_timer_success_captures_private_bytes_before_sealing(self):self.exercise()

    def test_central_success_leaves_runtime_running_and_does_not_claim_cleanup(self):
        status=self.exercise(stage='central_bootstrap');self.assertIs(status['cleanup_verified'],False)

    def test_nonzero_signal_and_child_timeout_exit_survive_sealing(self):
        for code in (17,137,-9):
            with self.subTest(code=code):
                status=self.exercise(code=code,cleanup=False)
                self.assertEqual(status['error_code'],'child_failed')
                self.assertIs(status['primary_failure_retained'],True)

    def test_seal_failure_is_status_only_and_preserves_original_child_failure(self):
        for code in (0,23):
            with self.subTest(code=code):
                self.assertEqual(self.exercise(code=code,seal_fails=True)['error_code'],'seal_failed')

    def test_interrupted_wait_never_seals_a_possibly_running_child(self):self.exercise(runner_raises=True)

    def test_timer_zero_exit_without_cleanup_proof_still_fails(self):
        self.assertEqual(self.exercise(cleanup=False)['error_code'],'cleanup_unverified')

    def test_complete_source_map_change_fails_after_private_evidence_sealing(self):
        self.assertEqual(self.exercise(source_changes=True)['error_code'],'source_changed')

    def test_cleanup_receipt_requires_exact_kind_single_file_and_formal_flag(self):
        with tempfile.TemporaryDirectory()as folder:
            capture=Path(folder);tmp=capture/'tmp';tmp.mkdir()
            child=tmp/'lrv-owned-bootstrap-interleaving-evidence-one';child.mkdir()
            path=child/'result.json'
            valid={'kind':'owned-canonical206-scheduler-interleaving-v1','owned_cleanup_verified':True}
            for value in ({**valid,'owned_cleanup_verified':1},{**valid,'kind':'unrelated'},{'owned_cleanup_verified':True}):
                path.write_text(json.dumps(value));self.assertFalse(m.timer_cleanup_verified(capture,'timer_probe'))
            path.write_text(json.dumps(valid));self.assertTrue(m.timer_cleanup_verified(capture,'timer_probe'))
            second=tmp/'lrv-owned-bootstrap-interleaving-evidence-two';second.mkdir()
            (second/'result.json').write_text(json.dumps(valid))
            self.assertFalse(m.timer_cleanup_verified(capture,'timer_probe'))

    def test_existing_upload_directory_or_link_is_never_written(self):
        for link in (False,True):
            with tempfile.TemporaryDirectory()as folder:
                parent=Path(folder).resolve();victim=parent/'untouched';victim.mkdir()
                (victim/'sentinel').write_text(SECRET)
                upload=parent/'lrv-owned-bootstrap-upload-timer_probe'
                if link:upload.symlink_to(victim,target_is_directory=True)
                else:upload.mkdir();(upload/'sentinel').write_text(SECRET)
                def forbidden(*args,**kwargs):raise AssertionError('Contamination must prevent child launch')
                output=io.StringIO()
                with contextlib.redirect_stdout(output):
                    code=m.run_stage('timer_probe',environ={'RUNNER_TEMP':str(parent)},runner=forbidden,
                        crypto=Crypto(),metadata_builder=self.metadata)
                self.assertEqual(code,1);self.assertNotIn(SECRET,output.getvalue())
                self.assertEqual((victim/'sentinel').read_text(),SECRET)
                self.assertFalse((upload/'public-status.json').exists())


    def test_known_admission_and_actual_spawn_failures_are_encrypted(self):
        for failure in ('admission','spawn'):
            with self.subTest(failure=failure),tempfile.TemporaryDirectory()as folder:
                parent=Path(folder).resolve();crypto=Crypto();output=io.StringIO();called=[]
                def metadata(*args):
                    if failure=='admission':raise ValueError(SECRET+' invalid metadata')
                    return self.metadata(*args)
                def forbidden(*args,**kwargs):
                    called.append(True);raise AssertionError('Admission failure must prevent launch')
                # Spawn case uses the real default Popen boundary, no process starts.
                with contextlib.redirect_stdout(output),contextlib.redirect_stderr(output):
                    code=m.run_stage('central_bootstrap',environ={'RUNNER_TEMP':str(parent)},
                        runner=forbidden if failure=='admission'else None,crypto=crypto,metadata_builder=metadata,
                        command_map={'central_bootstrap':[str(parent/'missing-program')]})
                self.assertEqual(code,1);self.assertEqual(called,[]);self.assertEqual(len(crypto.calls),1)
                upload=parent/'lrv-owned-bootstrap-upload-central_bootstrap'
                status=json.loads((upload/'public-status.json').read_text())
                self.assertEqual(status['child_state'],'known_not_started')
                self.assertIsNone(status['child_returncode'])
                self.assertEqual(status['error_code'],'admission_failed'if failure=='admission'else'spawn_failed')
                self.assertIs(status['raw_evidence_encrypted'],True)
                self.assertIs(status['primary_failure_retained'],True)
                self.assertNotIn(SECRET,output.getvalue())
                self.assertEqual({p.name for p in upload.iterdir()},{'evidence.cms','public-status.json'})
                capture=crypto.calls[0][0]
                self.assertTrue((capture/'wrapper-exception.txt').is_file())
                if failure=='admission':self.assertIn(SECRET,(capture/'wrapper-exception.txt').read_text())

    def test_wait_oserror_is_not_misclassified_as_spawn_failure(self):
        from unittest.mock import patch
        process=SimpleNamespace(wait=lambda:(_ for _ in ()).throw(OSError('synthetic wait failure')))
        with patch.object(m.subprocess,'Popen',return_value=process):
            with self.assertRaises(OSError):
                m.run_child(['unused'],cwd=ROOT,env={},stdout=None,stderr=None,check=False)

    def test_real_inert_subprocess_nested_evidence_decrypts_without_public_sentinel(self):
        crypto_spec=importlib.util.spec_from_file_location('ci_bootstrap_crypto_wrapper_test',ROOT/'scripts/ci_bootstrap_crypto.py')
        real=importlib.util.module_from_spec(crypto_spec);sys.modules[crypto_spec.name]=real;crypto_spec.loader.exec_module(real)
        with tempfile.TemporaryDirectory()as folder:
            parent=Path(folder).resolve();repo=parent/'repo';recipient=repo/m.RECIPIENT
            recipient.parent.mkdir(parents=True);key=parent/'synthetic.key';runner_temp=parent/'runner';runner_temp.mkdir()
            subprocess.run(['openssl','req','-x509','-newkey','rsa:4096','-noenc','-keyout',str(key),
                '-out',str(recipient),'-days','1','-subj','/CN=synthetic-wrapper-test','-addext',
                'keyUsage=critical,keyEncipherment','-addext','basicConstraints=critical,CA:FALSE'],
                stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
            os.chmod(key,0o600)
            pem=real.sha256_file(recipient)
            der=hashlib.sha256(subprocess.check_output(['openssl','x509','-in',str(recipient),'-outform','DER'])).hexdigest()
            crypto=SimpleNamespace(seal=real.seal,sha256_file=real.sha256_file,
                RECIPIENT_PEM_SHA256=pem,RECIPIENT_DER_SHA256=der)
            body="""import os,sys
from pathlib import Path
secret=b'synthetic-secret-must-remain-private'+bytes([0,255])
sys.stdout.buffer.write(secret)
sys.stderr.buffer.write(secret+b' stderr')
nested=Path(os.environ['TMPDIR'])/'synthetic-runtime'/'supabase'
nested.mkdir(parents=True)
(nested/'config.toml').write_bytes(secret)
(nested/'query.sql').write_bytes(secret+b' SQL')
"""
            output=io.StringIO()
            with contextlib.redirect_stdout(output),contextlib.redirect_stderr(output):
                code=m.run_stage('central_bootstrap',repo=repo,environ={**os.environ,'RUNNER_TEMP':str(runner_temp)},
                    crypto=crypto,metadata_builder=self.metadata,
                    command_map={'central_bootstrap':[sys.executable,'-B','-c',body]})
            self.assertEqual(code,0,output.getvalue());self.assertNotIn(SECRET,output.getvalue())
            upload=runner_temp/'lrv-owned-bootstrap-upload-central_bootstrap'
            status=json.loads((upload/'public-status.json').read_text())
            self.assertEqual({p.name for p in upload.iterdir()},{'evidence.cms','public-status.json'})
            for path in upload.iterdir():self.assertNotIn(SECRET.encode(),path.read_bytes())
            self.assertIs(status['cleanup_verified'],False)
            archive=real.decrypt_verified(upload/'evidence.cms',status['ciphertext_sha256'],recipient,key,
                parent/'quarantine',pem_pin=pem,der_pin=der)
            secret=SECRET.encode()+b'\x00\xff'
            with tarfile.open(archive,'r:gz')as tar:
                self.assertEqual(tar.extractfile('capture/stdout.bin').read(),secret)
                self.assertEqual(tar.extractfile('capture/stderr.bin').read(),secret+b' stderr')
                self.assertEqual(tar.extractfile('capture/tmp/synthetic-runtime/supabase/config.toml').read(),secret)
                self.assertEqual(tar.extractfile('capture/tmp/synthetic-runtime/supabase/query.sql').read(),secret+b' SQL')
                metadata=json.load(tar.extractfile('capture/metadata.json'))
                self.assertEqual(metadata['checked_out_sha'],'d'*40)
                self.assertEqual(metadata['pr_head_sha'],'e'*40)
                self.assertEqual(metadata['child_state'],'completed')
                self.assertEqual(metadata['private_detail'],SECRET)


    def assert_workflow_contract(self,text):
        steps=re.split(r'^      - ',text,flags=re.MULTILINE)[1:]
        for stage in m.STAGES:
            command='run: python3 -B scripts/ci-owned-bootstrap-evidence.py --stage '+stage
            indices=[index for index,step in enumerate(steps)if command in step]
            self.assertEqual(len(indices),1)
            index=indices[0];child=steps[index];upload=steps[index+1]
            self.assertEqual([line.strip()for line in child.splitlines()if line.strip().startswith('run:')],[command])
            self.assertNotIn('continue-on-error:',child+upload)
            self.assertIn('        if: always()\n',upload)
            self.assertIn('        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2\n',upload)
            for setting in ('compression-level: 0','if-no-files-found: error','retention-days: 14'):
                self.assertIn('          '+setting+'\n',upload)
            self.assertIn('          name: owned-bootstrap-${{ github.run_id }}-${{ github.run_attempt }}-'+stage+'\n',upload)
            match=re.search(r'^          path: \|\n((?:            [^\n]+\n)+)',upload,re.MULTILINE)
            self.assertIsNotNone(match)
            self.assertEqual([line.strip()for line in match.group(1).splitlines()],
                ['${{ runner.temp }}/lrv-owned-bootstrap-upload-'+stage+'/'+name for name in ('evidence.cms','public-status.json')])

    def test_workflow_immediate_uploads_are_pinned_finite_and_always(self):
        self.assert_workflow_contract((ROOT/'.github/workflows/ci.yml').read_text())

    def test_workflow_contract_rejects_diagnostic_regressions(self):
        text=(ROOT/'.github/workflows/ci.yml').read_text()
        mutations=(
            ('        if: always()','        if: success()'),
            ('ea165f8d65b6e75b540449e92b4886f43607fa02','v4'),
            ('          compression-level: 0','          compression-level: 6'),
            ('          if-no-files-found: error','          if-no-files-found: warn'),
            ('          retention-days: 14','          retention-days: 90'),
            ('            ${{ runner.temp }}/lrv-owned-bootstrap-upload-timer_probe/evidence.cms',
             '            ${{ runner.temp }}/lrv-owned-bootstrap-upload-timer_probe/*'),
            ('      - name: Retain encrypted scheduler proof diagnostics',
             '      - run: echo inserted-step\n      - name: Retain encrypted scheduler proof diagnostics'),
            ('        run: python3 -B scripts/ci-owned-bootstrap-evidence.py --stage timer_probe',
             '        continue-on-error: true\n        run: python3 -B scripts/ci-owned-bootstrap-evidence.py --stage timer_probe'),
        )
        for old,new in mutations:
            with self.subTest(mutation=new),self.assertRaises(AssertionError):
                self.assert_workflow_contract(text.replace(old,new,1))

    def test_cli_has_no_arbitrary_command_option(self):
        result=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/ci-owned-bootstrap-evidence.py'),
            '--stage','timer_probe','--command','echo synthetic'],capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('unrecognized arguments',result.stderr)


if __name__=='__main__':unittest.main()
