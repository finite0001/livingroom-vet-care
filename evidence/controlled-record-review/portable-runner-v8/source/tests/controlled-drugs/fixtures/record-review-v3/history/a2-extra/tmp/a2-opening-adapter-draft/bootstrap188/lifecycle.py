"""Fixed188 followed by exact206; only owned copied migration files change."""
import hashlib
import json
import os
from pathlib import Path
import stat
import time

import admission
import record_review_v3_paused_bootstrap as donor

class Copies:
    """Finite copy journal. Complete staging remains authoritative and untouched.

    active is empty or exactly first k names of ordered prefix, then complete
    prefix plus first k suffix names. Pending is absent or the one journaled
    next file; it is never promoted unless its bytes match. Recovery quarantines
    the whole inspected active tree and replaces it with the intact206 stage;
    recovery itself never overwrites/deletes a partial or unexpected file.
    Verified owned teardown may later remove proved redundant copied bytes;
    their finite recovery inventory remains in private evidence. Ambiguous
    bytes force retained work and cannot enter successful teardown.
    """
    def __init__(self,runtime,expected):
        self.runtime=runtime;self.expected=dict(expected);self.names=tuple(sorted(expected))
        assert len(self.names)==206 and self.names[187]==admission.END188 and self.names[188]==admission.FIRST189
        self.active=runtime.project/'supabase/migrations'
        self.stage=runtime.work/'fixed188-complete206'
        self.quarantine=runtime.work/'fixed188-preserved-active'
        self.done=[];self.pending=None;self.pending_id=None;self.deferred=False;self.recovered=False
        self.stage_id=None;self.active_id=None;self.recovery_inventory=None
    def read_tree(self,path):
        assert path.is_dir() and not path.is_symlink(),'Owned copy directory missing or symlink'
        result={}
        for p in path.iterdir():
            assert stat.S_ISREG(p.lstat().st_mode) and not p.is_symlink(),'Owned copy entry not regular'
            result[p.name]=admission.sha(p.read_bytes())
        return result
    def full(self,path):assert self.read_tree(path)==self.expected,'Complete owned206 copy differs'
    def observe(self):
        self.full(self.stage)
        assert self.stage.stat().st_ino==self.stage_id,'Staged directory identity changed'
        assert self.active.is_dir() and not self.active.is_symlink() and self.active.stat().st_ino==self.active_id,'Active directory identity changed'
        assert self.done==list(self.names[:len(self.done)]),'Copy journal not an ordered prefix'
        values=self.read_tree(self.active)
        expected={name:self.expected[name] for name in self.done}
        if self.pending is not None:
            name=self.pending
            assert len(self.done)<206 and name==self.names[len(self.done)],'Unexpected pending-copy identity'
            temp='.'+name+'.pending'
            # open/write may fail before creating the journaled pending entry.
            if temp in values:
                path=self.active/temp
                assert self.pending_id is not None and path.stat().st_ino==self.pending_id,'Pending copy identity changed'
                raw=path.read_bytes()
                assert (self.stage/name).read_bytes().startswith(raw),'Pending bytes not a prefix of admitted source'
                values.pop(temp)
            # An atomic promotion may succeed before its journal update.
            if name in values:
                assert values.pop(name)==self.expected[name] and not (self.active/temp).exists(),'Ambiguous promotion'
                assert self.pending_id is not None and (self.active/name).stat().st_ino==self.pending_id,'Promoted copy identity changed'
        assert values==expected,'Active copy contains missing, changed or unexpected entries'
        return {'completed':list(self.done),'pending':self.pending,'active':self.read_tree(self.active),'stage':dict(self.expected)}
    def defer(self):
        self.full(self.active)
        assert not self.deferred and not self.stage.exists() and not self.stage.is_symlink()
        assert not self.quarantine.exists() and not self.quarantine.is_symlink()
        self.active.rename(self.stage);self.deferred=True;self.stage_id=self.stage.stat().st_ino
        self.active.mkdir(mode=0o700);self.active_id=self.active.stat().st_ino
        self.observe()
    def copy_one(self,name,check):
        check();self.observe()
        assert name==self.names[len(self.done)] and self.pending is None
        self.pending=name;self.runtime.copy_receipt(self)
        destination=self.active/('.'+name+'.pending')
        with destination.open('xb') as target:
            self.pending_id=os.fstat(target.fileno()).st_ino
            raw=(self.stage/name).read_bytes();assert admission.sha(raw)==self.expected[name]
            target.write(raw);target.flush();os.fsync(target.fileno())
        assert admission.sha(destination.read_bytes())==self.expected[name]
        check();self.observe()
        assert not (self.active/name).exists() and not (self.active/name).is_symlink()
        destination.rename(self.active/name)
        self.done.append(name);self.pending=None;self.pending_id=None
        self.runtime.copy_receipt(self)
    def to188(self,check):
        assert not self.done and self.pending is None
        for name in self.names[:188]:self.copy_one(name,check)
        assert len(self.done)==188;self.observe()
    def to206(self,check):
        assert len(self.done)==188 and self.pending is None
        for name in self.names[188:]:self.copy_one(name,check)
        self.full(self.active);self.observe()
    def recover(self):
        if not self.deferred:return
        # mkdir itself may have failed after the safe original rename.
        self.full(self.stage)
        assert self.stage.stat().st_ino==self.stage_id
        if self.active_id is None:
            assert not self.active.exists() and not self.active.is_symlink(),'Unexpected active path after failed mkdir'
        else:
            observed=self.observe()
            self.recovery_inventory={'observed':observed,'active_inode':self.active_id,'stage_inode':self.stage_id,
                'sizes':{p.name:p.stat().st_size for p in self.active.iterdir()}}
            self.runtime.copy_receipt(self)
            assert not self.quarantine.exists() and not self.quarantine.is_symlink()
            self.active.rename(self.quarantine)
        self.stage.rename(self.active)
        self.full(self.active);self.deferred=False;self.recovered=True
        self.runtime.copy_receipt(self)

class Lifecycle(donor.PausedBootstrap):
    def __init__(self,runtime,bundle):
        # Reuse only reviewed SQL/image/environment/source/drain checks; never
        # donor.run()/restore() or its hard-coded all206 path selection.
        self.runtime=runtime;self.package=bundle['package'];self.root=admission.ROOT
        self.files=bundle['files'];self.expected={p.name:admission.sha(p.read_bytes()) for p in self.files}
        self.migrations=runtime.project/'supabase/migrations';self.bundle=bundle
        self.record=dict(kind='private-fixed188-lifecycle-v1',passed=False,state='admitted206')
        self.used=False;self.copies=Copies(runtime,self.expected)
        self.parent_command=runtime.direct_command
        self.save()
    def save(self):
        path=self.runtime.folder/'fixed188-lifecycle.json'
        path.write_text(json.dumps(self.record,sort_keys=True,indent=2)+'\n');path.chmod(0o600)
    def transition(self,state):
        self.runtime.setup_remaining();self.record['state']=state;self.save()
    def start_prefix(self,argv):
        assert not self.used,'No repeated fixed188 start'
        self.used=True
        self.environment();self.sources();self.runtime.setup_remaining()
        try:
            self.copies.defer();self.runtime.copy_receipt(self.copies)
            network_id=self.runtime.network.prepare()
            result=self.command(argv+['--network-id',network_id,'--experimental=false'])
            self.image();self.runtime.container=self.runtime.verify()['Id']
            self.sql(donor.ZERO_SQL);self.sql(donor.SAFE_SQL)
            self.transition('builtin_only')
            self.sql('alter system set cron.launch_active_jobs=off;select pg_reload_conf();',admin=True)
            self.drain();self.transition('paused_zero')
            self.copies.to188(self.runtime.setup_remaining)
            self.sources();self.copies.observe()
            self.command(['supabase','migration','up','--local','--workdir',str(self.runtime.project),'--experimental=false'])
            self.drain();self.sql(donor.SAFE_SQL)
            actual=json.loads(self.sql(donor.LEDGER_SQL))
            assert actual==self.bundle['expected188'],'Actual188 differs from independent full ledger'
            self.runtime.save_private('actual-ledger188',actual)
            self.transition('exact188_installed')
            return result
        except BaseException as error:
            self.record.setdefault('primary_failure',{'type':type(error).__name__})
            self.recover_after_failure();raise
    def recover_after_failure(self):
        self.runtime.begin_failure_cleanup()
        try:
            self.runtime.remaining(120)
            self.sources();self.copies.recover()
        except BaseException as error:
            self.runtime.bootstrap_restore_failed=True
            self.record['restoration_failure']={'type':type(error).__name__}
            self.record['work_retained_required']=True
        self.save()
    def upgrade(self):
        assert self.record['state']=='historical_seed_committed','Fixed seed must precede suffix'
        try:
            self.sources();self.copies.to206(self.runtime.setup_remaining);self.transition('suffix_ready')
            self.command(['supabase','migration','up','--local','--workdir',str(self.runtime.project),'--experimental=false'])
            self.drain();self.sql(donor.SAFE_SQL)
            actual=json.loads(self.sql(donor.LEDGER_SQL))
            assert actual==self.package['expected_ledger206'],'Actual206 differs from independent full ledger'
            self.runtime.save_private('actual-ledger206',actual)
            self.sql(self.package['preflight_sql'])
            self.sources();self.copies.observe();self.transition('exact206_installed')
        except BaseException as error:
            self.record.setdefault('primary_failure',{'type':type(error).__name__})
            self.recover_after_failure();raise
