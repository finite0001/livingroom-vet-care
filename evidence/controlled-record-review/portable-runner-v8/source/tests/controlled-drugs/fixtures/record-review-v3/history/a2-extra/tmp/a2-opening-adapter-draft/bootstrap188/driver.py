"""PRIVATE source-only draft; explicit flag required for fixed owned local run.

No arbitrary SQL, role, prefix, project, endpoint or budget options are exposed.
"""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import shutil
import tempfile
import time
import traceback

import admission
import fixtures
from lifecycle import Lifecycle
import record_review_v3_gate_a_runtime as base
import record_review_v3_gate_b_runtime as bridge
import record_review_v3_gate_b_snapshot as snapshot
import record_review_v3_paused_bootstrap as donor

WORKLOAD_SECONDS=600
PHASE_SECONDS=120
RESERVE_SECONDS=60
CLEANUP_SECONDS=180
PHASES=('builtin_prefix188','genuine188_seed','historical_capture','suffix206','preservation206','final_proof')

class Runtime(bridge.Runtime):
    def __init__(self,folder,bundle,outer_start):
        self.outer_deadline=outer_start+WORKLOAD_SECONDS
        self.setup_deadline=self.outer_deadline-RESERVE_SECONDS
        self.fixed_phase_deadline=None;self.final_mode=False;self.in_cleanup=False;self.cleanup_started=False
        self.fixed_bundle=bundle;self.fixed_helper=None;self.fixed_status=[];self.fixed_failure=None
        # Initial context inspection in the retained constructor is bounded10s;
        # the clock starts before it and is never reset by this subclass.
        super().__init__(folder,WORKLOAD_SECONDS,bundle['package'])
        self.deadline=self.outer_deadline
        self.setup_remaining()
    def save_private(self,name,value):
        p=self.folder/(name+'.json');p.write_text(json.dumps(value,sort_keys=True,indent=2)+'\n');p.chmod(0o600)
    def setup_remaining(self):
        assert not self.in_cleanup,'Setup after failure cleanup forbidden'
        assert time.monotonic()<self.setup_deadline,'Fixed188 setup cutoff exhausted'
        return self.remaining(PHASE_SECONDS)
    def remaining(self,limit):
        deadline=self.cleanup_deadline if self.in_cleanup else (self.outer_deadline if self.final_mode else self.setup_deadline)
        assert deadline is not None
        if self.fixed_phase_deadline is not None and not self.in_cleanup:deadline=min(deadline,self.fixed_phase_deadline)
        for field in ('bootstrap_phase_deadline','candidate_phase_deadline'):
            value=getattr(self,field,None)
            if value is not None and not self.in_cleanup:deadline=min(deadline,value)
        left=deadline-time.monotonic();assert left>0,'Fixed188 absolute command/phase cutoff exhausted'
        return min(limit,PHASE_SECONDS,left)
    def direct_command(self,argv,text=None,timeout=120,fail=True):
        start=time.monotonic();sequence=self.command_number+1
        status={'sequence':sequence,'outcome':'pending'}
        try:
            result=base.Runtime.command(self,argv,text=text,timeout=self.remaining(timeout),fail=False)
            status.update(outcome='success' if result.returncode==0 else 'nonzero',exit_code=result.returncode)
            if fail and result.returncode:
                if self.fixed_failure is None:self.fixed_failure=dict(status)
                raise AssertionError('Owned command failed; private numbered logs retained')
            assert time.monotonic()< (self.cleanup_deadline if self.in_cleanup else (self.outer_deadline if self.final_mode else self.setup_deadline)), 'Command finished after deadline'
            return result
        except BaseException as error:
            status.update(error_type=type(error).__name__)
            if status['outcome']=='pending':status['outcome']='error'
            if self.fixed_failure is None:self.fixed_failure=dict(status)
            raise
        finally:
            status['elapsed_seconds']=time.monotonic()-start;self.fixed_status.append(status)
            self.save_private('command-status',{'commands':self.fixed_status,'first_failure':self.fixed_failure})
    def command(self,argv,text=None,timeout=120,fail=True):
        if argv[:2]==['supabase','start']:
            assert text is None and fail is True
            expected=['supabase','start','--workdir',str(self.project),'--exclude','realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']
            assert argv==expected and self.fixed_helper is not None
            return self.fixed_helper.start_prefix(argv)
        return self.direct_command(argv,text=text,timeout=timeout,fail=fail)
    def start(self,files):
        assert list(files)==self.fixed_bundle['files']
        self.fixed_helper=Lifecycle(self,self.fixed_bundle)
        for argv in (['docker','ps','-aq'],['docker','volume','ls','-q'],['docker','network','ls','-q']):
            assert not self.command(argv+['--filter','label=com.supabase.cli.project='+self.identity]).stdout.strip(),'Preexisting project-labelled resource'
        for argv in (['docker','ps','-a','--format','{{.Names}}'],['docker','volume','ls','--format','{{.Name}}'],['docker','network','ls','--format','{{.Name}}']):
            names=self.command(argv).stdout.splitlines()
            assert len(names)<=4096 and not any(self.identity in name for name in names),'Preexisting named project resource'
        base.Runtime.start(self,files)
        self.network.before_stop()
    def copy_receipt(self,copies):
        self.save_private('migration-copy-state',{'completed':list(copies.done),'pending':copies.pending,
           'pending_inode':copies.pending_id,'recovery_inventory':copies.recovery_inventory,'deferred':copies.deferred,'recovered':copies.recovered,
           'active':str(copies.active),'stage':str(copies.stage),'quarantine':str(copies.quarantine)})
    def begin_failure_cleanup(self):
        if not self.in_cleanup:
            self.cleanup_deadline=time.monotonic()+CLEANUP_SECONDS
            self.in_cleanup=True;self.fixed_phase_deadline=None
        assert self.cleanup_deadline is not None
    def cleanup(self,failed=False):
        assert not self.cleanup_started,'One teardown attempt only'
        self.cleanup_started=True
        if failed:self.begin_failure_cleanup()
        else:
            assert not self.in_cleanup,'Normal cleanup after failure forbidden'
            self.in_cleanup=True;self.fixed_phase_deadline=None;self.cleanup_deadline=self.outer_deadline
        return super().cleanup()
    @contextmanager
    def phase(self,name,final=False):
        assert name in PHASES and self.fixed_phase_deadline is None
        self.final_mode=final
        stop=min(self.outer_deadline if final else self.setup_deadline,time.monotonic()+PHASE_SECONDS)
        self.fixed_phase_deadline=stop;start=time.monotonic()
        record={'name':name,'deadline':stop,'passed':False}
        try:
            assert start<stop,'Phase deadline exhausted before admission'
            yield
            assert time.monotonic()<stop,'Phase completed after fixed cap'
            record['passed']=True
        finally:
            record['elapsed_seconds']=time.monotonic()-start
            self.save_private('phase-'+name,record);self.fixed_phase_deadline=None


def freeze(folder,values):
    for name,digest in values.items():
        out=folder/'executed-inputs'/name;out.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(admission.ROOT/name,out)
        assert admission.sha(out.read_bytes())==digest
    (folder/'source-hashes.json').write_text(json.dumps(values,sort_keys=True,indent=2)+'\n')

def check_frozen(folder,values):
    admission.check_inputs(values)
    actual={str(p.relative_to(folder/'executed-inputs')):admission.sha(p.read_bytes()) for p in (folder/'executed-inputs').rglob('*') if p.is_file()}
    assert actual==values,'Retained input keyset/bytes differ'

def run():
    started=time.monotonic();runtime=None;primary=None;cleaned=False
    oldmask=os.umask(0o077)
    folder=Path(tempfile.mkdtemp(prefix='lrv-fixed188-evidence-'));folder.chmod(0o700)
    result={'kind':'private-fixed188-to206-proof-v1','passed':False,'acceptance':False,'adapter_acceptance':False,
            'protocol_behavior_claim':False,'workload_seconds':600,'phase_seconds':120,'cleanup_reserve_seconds':180}
    try:
        bundle=admission.build();values=admission.inputs();freeze(folder,values);check_frozen(folder,values)
        assert time.monotonic()<started+PHASE_SECONDS,'Admission/freeze consumed first phase budget'
        assert shutil.disk_usage(folder).free>=3*1024**3,'At least3GiB free required for owned local prerequisite'
        runtime=Runtime(folder,bundle,started)
        with runtime.phase('builtin_prefix188'):
            # Admission, constructor and freeze count against first phase too.
            runtime.fixed_phase_deadline=min(runtime.fixed_phase_deadline,started+PHASE_SECONDS)
            runtime.start(bundle['files'])
        with runtime.phase('genuine188_seed'):
            seeded=fixtures.receipt(runtime.query(fixtures.seed()))
            runtime.save_private('fixture',seeded)
            runtime.fixed_helper.transition('historical_seed_committed')
        with runtime.phase('historical_capture'):
            before=fixtures.admit_observation(fixtures.parse(runtime.query(fixtures.oracle(seeded['ids'])),'fixed188-source-oracle-v1'),seeded['ids'],seeded['backend_pid'])
            runtime.save_private('before188-original-rows',before)
            runtime.save_private('before188-raw',json.loads(runtime.query(fixtures.raw188_sql())))
        with runtime.phase('suffix206'):
            check_frozen(folder,values);runtime.fixed_helper.upgrade()
        with runtime.phase('preservation206'):
            after=fixtures.admit_observation(fixtures.parse(runtime.query(fixtures.oracle(seeded['ids'])),'fixed188-source-oracle-v1'),seeded['ids'],seeded['backend_pid'])
            runtime.save_private('after206-original-rows',after)
            result['preservation']=fixtures.preserved(before,after,seeded['ids'],seeded['backend_pid'])
        with runtime.phase('final_proof',final=True):
            runtime.query(bundle['package']['preflight_sql'])
            runtime.query(donor.SAFE_SQL)
            assert runtime.query(donor.DRAIN_SQL).strip()=='t'
            runtime.save_private('after206-raw',snapshot.snapshot(runtime.query))
            runtime.fixed_helper.sources();runtime.fixed_helper.copies.full(runtime.fixed_helper.copies.active)
            runtime.fixed_helper.copies.observe();check_frozen(folder,values)
            runtime.fixed_helper.record.update(state='final_verified',passed=True)
            runtime.fixed_helper.save()
        runtime.cleanup(failed=False);cleaned=True
        check_frozen(folder,values)
        assert time.monotonic()<started+WORKLOAD_SECONDS,'Outer deadline exhausted after cleanup'
        result.update(passed=True,exact188_ledger=True,exact206_ledger=True,cleanup_complete=True,
                      source_map_sha256=admission.sha(admission.canonical(values).encode()))
    except BaseException as error:
        primary=error;result['primary_failure']={'type':type(error).__name__}
        (folder/'primary-traceback.txt').write_text(traceback.format_exc())
    finally:
        if runtime is not None and not cleaned and not runtime.cleanup_started:
            try:
                if runtime.fixed_helper is not None and runtime.fixed_helper.copies.deferred:
                    runtime.fixed_helper.recover_after_failure()
                runtime.cleanup(failed=True);cleaned=True
            except BaseException as error:
                result['cleanup_failure']={'type':type(error).__name__}
                (folder/'cleanup-traceback.txt').write_text(traceback.format_exc())
        result['cleanup_complete']=bool(cleaned and runtime is not None and runtime.record.get('removed'))
        result['elapsed_seconds']=time.monotonic()-started
        if 'values' in locals():
            try:check_frozen(folder,values)
            except BaseException as error:
                result['passed']=False;result['source_failure']={'type':type(error).__name__}
        result['passed']=result['passed'] and result['cleanup_complete']
        (folder/'result.json').write_text(json.dumps(result,sort_keys=True,indent=2)+'\n')
        os.umask(oldmask)
    print(json.dumps({'passed':result['passed'],'evidence':str(folder),'acceptance':False}))
    return 0 if result['passed'] else 1

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-synthetic-local',action='store_true')
    args=parser.parse_args()
    if args.run_synthetic_local:raise SystemExit(run())
    bundle=admission.build()
    print(json.dumps({'source_only':True,'ledger188':len(bundle['expected188']),'suffix':len(bundle['suffix']),
                      'canonical206':len(bundle['files']),'acceptance':False}))
