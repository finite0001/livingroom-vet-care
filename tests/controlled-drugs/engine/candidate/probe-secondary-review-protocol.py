"""Owned synthetic review foundation proof. Never installs a hosted database."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import traceback
import uuid

SOURCE=Path(__file__).resolve().parent
sys.path.insert(0,str(SOURCE))
spec=importlib.util.spec_from_file_location('secondary_gate_runtime',SOURCE/'probe-secondary-review.py')
base=importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
REFERENCE_SECONDS=1200
ACCEPTANCE_SECONDS=2100


def reference(runtime,binding,baseline,parent):
    from secondary_review_protocol_descriptor import build
    from secondary_review_gate_a import original_rows_preflight
    from cli_atomicity import _snapshot
    proofs={}
    source_rows=runtime.json(base.ROWS_SQL)
    (runtime.folder/'source-canonical205-rows.json').write_text(json.dumps(source_rows,sort_keys=True)+'\n')
    runtime.verify()
    scopes=('public','auth','storage','extensions','supabase_migrations')
    dump=runtime.command(['docker','exec',runtime.container,'pg_dump','-U','postgres','--no-owner',*[f'--schema={s}' for s in scopes],'postgres'],timeout=120).stdout
    (runtime.folder/'canonical205-selected-schema.sql').write_text(dump)
    restored='\n'.join(line for line in dump.splitlines() if not line.startswith('ALTER DEFAULT PRIVILEGES')).replace('CREATE SCHEMA extensions;','CREATE SCHEMA IF NOT EXISTS extensions;')
    for profile in ('private','synthetic_auth'):
        name='owned_review_restore_'+uuid.uuid4().hex[:10]
        marker=str(uuid.uuid4())
        runtime.query('create database '+name+';')
        runtime.query('comment on database '+name+' is '+base.literal(marker)+';')
        runtime.databases[name]=marker
        query=lambda sql:runtime.query(sql,name)
        query('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension \"uuid-ossp\" with schema extensions;')
        query(restored)
        package=build(profile)
        folder=runtime.folder/profile
        folder.mkdir()
        (folder/'independent-expected.json').write_text(json.dumps(package['expected'],sort_keys=True,indent=2)+'\n')
        before=_snapshot(query)
        rows=runtime.json(base.ROWS_SQL,name)
        assert rows==source_rows,'Restored profile differs from original canonical205 source rows'
        (folder/'before-catalog.json').write_text(json.dumps(before,sort_keys=True)+'\n')
        (folder/'before-rows.json').write_text(json.dumps(rows,sort_keys=True)+'\n')
        query('begin;\n'+base.independent_preflight(binding,baseline,parent)+original_rows_preflight(rows,base.ROWS_SQL)+package['ddl']+'\n'+package['descriptor_insert']+'\ncommit;')
        observed=runtime.json(package['snapshot_sql'],name)
        (folder/'observed.json').write_text(json.dumps(observed,sort_keys=True,indent=2)+'\n')
        assert observed==package['expected'],profile+' reference rendering differs from independent metadata'
        query('select controlled_review.required();')
        assert runtime.json('select public.controlled_stock_manifest_snapshot();',name)==parent['expected_technical_manifest']
        after_rows=runtime.json(base.ROWS_SQL,name)
        (folder/'after-rows.json').write_text(json.dumps(after_rows,sort_keys=True)+'\n')
        assert after_rows==rows
        after=_snapshot(query)
        (folder/'after-catalog.json').write_text(json.dumps(after,sort_keys=True)+'\n')
        for key in ('relations','writers','ledger','engine_catalog'):
            assert before[key]==after[key],profile+' original '+key+' changed'
        proofs[profile]={'definition_sha256':package['expected_sha256'],'rendering_matches':True,'original_rows_and_parent_seal_unchanged':True}
    return proofs


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-synthetic-local',action='store_true',required=True)
    parser.add_argument('--reference',action='store_true')
    parser.add_argument('--acceptance',action='store_true')
    parser.add_argument('--exercise',action='store_true')
    parser.add_argument('--restore-exercise',action='store_true',help='Restore-focused diagnostic only; never acceptance')
    args=parser.parse_args()
    assert sum((args.reference,args.acceptance,args.exercise,args.restore_exercise))==1,'Exactly one proof mode required'
    if args.acceptance or args.exercise or args.restore_exercise:
        from secondary_review_protocol_acceptance import frozen_package,run
        frozen_package(SOURCE,'synthetic_auth')
    else:
        from secondary_review_protocol_descriptor import build
        for profile in ('private','synthetic_auth'):build(profile)
    os.umask(0o077)
    folder=Path(tempfile.mkdtemp(prefix='lrv-controlled-review-protocol-evidence-'))
    hashes=base.freeze_inputs(folder)
    runtime=base.OwnedRuntime(folder,ACCEPTANCE_SECONDS if args.acceptance or args.exercise or args.restore_exercise else REFERENCE_SECONDS)
    started=time.monotonic()
    proof={'kind':'controlled-secondary-review-protocol-proof-v1','passed':False,'acceptance':args.acceptance,
           'restore_only_diagnostic':args.restore_exercise,'synthetic_only':True,'hosted_writes':0,'provider_requests':0,'clinical_or_register_activation':False}
    print('Protected evidence: '+str(folder),flush=True)
    try:
        binding,baseline,parent=base.bootstrap(runtime)
        proof['canonical205_admission']=True
        if args.reference:proof['reference']=reference(runtime,binding,baseline,parent)
        else:proof['protocol']=run(runtime,base,binding,baseline,parent,actual_expiry=args.acceptance,restore_only=args.restore_exercise)
        assert base.source_inputs()==hashes,'Executable source inventory/bytes changed during proof'
        assert all(hashlib.sha256((folder/'inputs'/name).read_bytes()).hexdigest()==value for name,value in hashes.items())
        runtime.remaining(1)
        proof['workload_seconds']=round(time.monotonic()-started,3)
        proof['passed']=True
    except BaseException as error:
        proof['failure_type']=type(error).__name__
        proof['workload_seconds']=round(time.monotonic()-started,3)
        (folder/'traceback.log').write_text(traceback.format_exc())
        (folder/'failed-attempt.json').write_text(json.dumps(proof,indent=2)+'\n')
        raise
    finally:
        try:runtime.cleanup()
        except BaseException:
            proof['passed']=False
            proof['cleanup_failed']=True
            raise
        finally:(folder/'result.json').write_text(json.dumps(proof,indent=2)+'\n')
    print(json.dumps(proof),flush=True)


if __name__=='__main__':main()
