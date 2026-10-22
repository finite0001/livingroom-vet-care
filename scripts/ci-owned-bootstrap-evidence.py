"""Finite CI startup wrapper: private raw capture, encrypted-only diagnostics."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import traceback

ROOT=Path(__file__).resolve().parents[1]
STAGES=('timer_probe','central_bootstrap')
RECIPIENT='scripts/ci-evidence/bootstrap-recipient.pem'
EXCLUDED='realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'


def commands(repo):
    return {
        'timer_probe':[sys.executable,'-B',str(repo/'supabase/tests/probe_owned_canonical_bootstrap.py'),'--run-synthetic-local'],
        'central_bootstrap':[sys.executable,'-B',str(repo/'scripts/owned_canonical_bootstrap.py'),
            '--run-synthetic-local','--workdir','.','--exclude',EXCLUDED],
    }


class ChildNotStarted(Exception):
    """Only process-construction failure, never a failure while waiting."""


def run_child(argv,*,cwd,env,stdout,stderr,check):
    if check is not False:raise ValueError('Invalid child runner contract')
    try:
        process=subprocess.Popen(argv,cwd=cwd,env=env,stdout=stdout,stderr=stderr)
    except OSError as error:
        raise ChildNotStarted('Process creation failed')from error
    # No wrapper deadline or kill. A wait exception leaves child state uncertain.
    return subprocess.CompletedProcess(argv,process.wait())


def private_write(path,value):
    with path.open('xb') as handle:
        os.chmod(path,0o600)
        handle.write(value if isinstance(value,bytes)else(json.dumps(value,sort_keys=True,indent=2)+'\n').encode())


def fixed_identifier(value,pattern):
    return value if isinstance(value,str) and re.fullmatch(pattern,value) else None


def metadata_for(repo,stage,environ,crypto):
    # Stage-specific reviewed source closures; never crawl HOME, /tmp or checkout.
    path=repo/('supabase/tests/probe_owned_canonical_bootstrap.py'if stage=='timer_probe'else'scripts/owned_canonical_bootstrap.py')
    spec=importlib.util.spec_from_file_location('ci_owned_stage_inputs',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    inputs=module.source_inputs()if stage=='timer_probe'else module.bootstrap_inputs(repo)
    for name in ('scripts/ci-owned-bootstrap-evidence.py','scripts/ci_bootstrap_crypto.py',RECIPIENT,'.github/workflows/ci.yml'):
        inputs[name]=crypto.sha256_file(repo/name)
    checked=subprocess.run(['git','rev-parse','HEAD'],cwd=repo,check=True,capture_output=True,text=True).stdout.strip()
    if not fixed_identifier(checked,r'[0-9a-f]{40}'):
        raise ValueError('Invalid checked-out commit')
    head=None
    if environ.get('GITHUB_EVENT_NAME')=='pull_request':
        event=Path(environ['GITHUB_EVENT_PATH'])
        if event.is_symlink() or not event.is_file() or event.stat().st_size>1024**2:
            raise ValueError('Invalid event metadata file')
        payload=json.loads(event.read_text())
        head=fixed_identifier(payload.get('pull_request',{}).get('head',{}).get('sha'),r'[0-9a-f]{40}')
        if head is None:raise ValueError('Missing PR head commit')
    return dict(schema=1,stage=stage,run_id=fixed_identifier(environ.get('GITHUB_RUN_ID'),r'[0-9]{1,30}'),
        run_attempt=fixed_identifier(environ.get('GITHUB_RUN_ATTEMPT'),r'[0-9]{1,10}'),
        job=fixed_identifier(environ.get('GITHUB_JOB'),r'[A-Za-z0-9_-]{1,100}'),
        github_sha=fixed_identifier(environ.get('GITHUB_SHA'),r'[0-9a-f]{40}'),
        checked_out_sha=checked,pr_head_sha=head,source_sha256=inputs)


def timer_cleanup_verified(capture,stage):
    # Central bootstrap deliberately leaves the DB running for subsequent tests.
    if stage!='timer_probe':return False
    matches=list((capture/'tmp').glob('lrv-owned-bootstrap-interleaving-evidence-*/result.json'))
    if len(matches)!=1:return False
    path=matches[0]
    if path.is_symlink() or path.parent.is_symlink() or not path.is_file() or path.stat().st_size>1024**2:return False
    value=json.loads(path.read_text())
    return value.get('kind')=='owned-canonical206-scheduler-interleaving-v1' and value.get('owned_cleanup_verified')is True


def exit_status(code):
    return 128-code if code<0 else code


def run_stage(stage,*,repo=ROOT,environ=None,runner=None,crypto=None,metadata_builder=None,command_map=None):
    """Injection points are Python-test-only; CLI accepts a finite stage, no argv."""
    if stage not in STAGES:
        print('owned_bootstrap_diagnostics: invalid_stage');return 1
    if crypto is None:
        import ci_bootstrap_crypto as crypto
    environ=dict(os.environ if environ is None else environ)
    runner=run_child if runner is None else runner
    metadata_builder=metadata_for if metadata_builder is None else metadata_builder
    command_map=commands(repo)if command_map is None else command_map
    mask=os.umask(0o077)
    try:
        parent=Path(environ['RUNNER_TEMP'])
        if not parent.is_absolute() or parent.is_symlink() or not parent.is_dir():
            raise ValueError('Invalid runner temp')
        parent=parent.resolve()
        upload=parent/('lrv-owned-bootstrap-upload-'+stage)
        if upload.exists() or upload.is_symlink():
            print('owned_bootstrap_diagnostics: upload_contaminated');return 1
        owned=Path(tempfile.mkdtemp(prefix='lrv-owned-bootstrap-private-'+stage+'-',dir=parent))
        os.chmod(owned,0o700)
        capture=owned/'capture';capture.mkdir(mode=0o700)
        child_tmp=capture/'tmp';child_tmp.mkdir(mode=0o700)
        private=owned/'private';private.mkdir(mode=0o700)
        child_code=None;child_complete=False;child_state='known_not_started';error='none';metadata={};began=time.monotonic()
        # stdout/stderr exist even if admission or process creation fails.
        with (capture/'stdout.bin').open('xb')as stdout,(capture/'stderr.bin').open('xb')as stderr:
            try:
                metadata=metadata_builder(repo,stage,environ,crypto)
                private_write(capture/'metadata-before.json',metadata)
                child_state='possibly_running'
                try:
                    result=runner(command_map[stage],cwd=repo,env={**environ,'TMPDIR':str(child_tmp)},stdout=stdout,stderr=stderr,check=False)
                except ChildNotStarted:
                    child_state='known_not_started';error='spawn_failed'
                    raise
                child_complete=True
                child_state='completed'
                if type(result.returncode)is not int or not -127<=result.returncode<=255:
                    raise ValueError('Invalid child status')
                child_code=result.returncode
                error='none'if child_code==0 else'child_failed'
                after=metadata_builder(repo,stage,environ,crypto)
                private_write(capture/'metadata-after.json',after)
                if after!=metadata:error='source_changed'
            except Exception:
                if error=='none':
                    error='admission_failed'if child_state=='known_not_started'else('child_wait_failed'if child_state=='possibly_running'else'wrapper_failed')
                private_write(capture/'wrapper-exception.txt',traceback.format_exc().encode())
        elapsed=round(time.monotonic()-began,3)
        cleanup=False
        try:cleanup=timer_cleanup_verified(capture,stage)
        except Exception:
            private_write(capture/'cleanup-observation-exception.txt',traceback.format_exc().encode())
        if stage=='timer_probe' and child_code==0 and not cleanup and error=='none':
            error='cleanup_unverified'
        metadata={**metadata,'child_returncode':child_code,'child_completed':child_complete,
            'child_state':child_state,'elapsed_seconds':elapsed,'error_code':error,'cleanup_verified':cleanup}
        private_write(capture/'metadata.json',metadata)
        status=dict(schema=1,stage=stage,error_code=error,child_returncode=child_code,
            elapsed_seconds=elapsed,raw_evidence_encrypted=False,primary_failure_retained=False,
            cleanup_verified=cleanup,child_state=child_state,recipient_fingerprint=crypto.RECIPIENT_DER_SHA256,
            ciphertext_sha256=None,ciphertext_bytes=0)
        for key in ('run_id','run_attempt','job','github_sha','checked_out_sha','pr_head_sha'):
            status[key]=metadata.get(key)
        sealed=False
        # Never seal while a child may still be executing/cleaning up. There is
        # no wrapper timeout or kill; the existing child owns those deadlines.
        if child_complete or child_state=='known_not_started':
            try:
                result=crypto.seal(capture,private,upload,metadata,repo/RECIPIENT,
                    crypto.RECIPIENT_PEM_SHA256,crypto.RECIPIENT_DER_SHA256)
                if set(result)!={'ciphertext_sha256','ciphertext_bytes','recipient_fingerprint','raw_evidence_encrypted'}:
                    raise ValueError('Invalid seal receipt')
                if (result['raw_evidence_encrypted']is not True or result['recipient_fingerprint']!=crypto.RECIPIENT_DER_SHA256
                    or not fixed_identifier(result['ciphertext_sha256'],r'[0-9a-f]{64}')
                    or type(result['ciphertext_bytes'])is not int or result['ciphertext_bytes']<=0):
                    raise ValueError('Invalid seal metadata')
                files=list(upload.iterdir())
                if len(files)!=1 or files[0].name!='evidence.cms' or files[0].is_symlink()or not files[0].is_file()or files[0].stat().st_nlink!=1:
                    raise ValueError('Invalid encrypted upload inventory')
                if crypto.sha256_file(files[0])!=result['ciphertext_sha256']or files[0].stat().st_size!=result['ciphertext_bytes']:
                    raise ValueError('Ciphertext receipt differs')
                status.update(result);status['primary_failure_retained']=error!='none';sealed=True
            except Exception:
                private_write(private/'wrapper-seal-exception.txt',traceback.format_exc().encode())
                status['error_code']='seal_failed'
        else:status['error_code']='child_not_completed'
        if not sealed:
            # A sealer never puts plaintext here. Unexpected existing staging is
            # not ours to replace, clean or write into.
            if upload.exists()or upload.is_symlink():
                print('owned_bootstrap_diagnostics: upload_contaminated')
                return exit_status(child_code)if child_code else 1
            upload.mkdir(mode=0o700)
        private_write(upload/'public-status.json',status)
        expected={'evidence.cms','public-status.json'}if sealed else{'public-status.json'}
        if {p.name for p in upload.iterdir()}!=expected:
            print('owned_bootstrap_diagnostics: upload_contaminated');return exit_status(child_code)if child_code else 1
        print(json.dumps(status,sort_keys=True))
        if child_code:return exit_status(child_code)
        return 0 if sealed and error=='none' else 1
    except Exception:
        # Raw exception/argv/path text must never reach public CI stdout/stderr.
        print('owned_bootstrap_diagnostics: wrapper_failed');return 1
    finally:os.umask(mask)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage',choices=STAGES,required=True)
    return run_stage(parser.parse_args().stage)


if __name__=='__main__':sys.exit(main())
