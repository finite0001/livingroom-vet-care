"""No-daemon phase-order and copy-retention tests for Gate B bootstrap."""
import copy
import hashlib
import importlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT/'tests/controlled-drugs/engine/candidate'
sys.dont_write_bytecode=True
sys.path.insert(0,str(SOURCE))
p = importlib.import_module('record_review_v3_paused_bootstrap')
b = importlib.import_module('record_review_v3_gate_b')


class FakeRuntime:
    def __init__(self,folder,package):
        self.folder=folder/'evidence';self.folder.mkdir()
        self.work=folder/'owned-work';self.work.mkdir()
        self.project=self.work/'project';(self.project/'supabase/migrations').mkdir(parents=True)
        self.config=self.project/'supabase/config.toml';self.config.write_text('owned fixture')
        self.deadline=time.monotonic()+600
        self.container='owned-db';self.bootstrap_restore_failed=False
        self.network=Mock();self.network.prepare.return_value='2'*64
        self.record={};self.owned_services={}
        self.entry=dict(Id='3'*64,Image='image-id',State={'Running':True},Config={'Image':'fixed-image'})
        self.calls=[];self.fault=None;self.hook=None;self.package=package
    def check_config(self):assert self.config.read_text()=='owned fixture'
    def verify(self):self.check_config();return self.entry
    def service_inventory(self):return {self.entry['Id']:{'project':'owned'}}
    def save(self):pass
    def command(self,argv,text=None,timeout=120,fail=True):
        assert timeout<=120 and fail is True
        self.calls.append((list(argv),text,timeout))
        kind='start' if argv[:2]==['supabase','start'] else 'up' if argv[:3]==['supabase','migration','up'] else 'image' if argv[:3]==['docker','image','inspect'] else 'sql'
        if self.hook:self.hook(kind,argv,text)
        if self.fault is not None and (self.fault==kind or self.fault==text):raise AssertionError('synthetic phase failure')
        output=json.dumps([{'Id':'image-id'}]) if kind=='image' else 't' if text==p.DRAIN_SQL else json.dumps(self.package['expected_ledger206']) if text==p.LEDGER_SQL else ''
        return subprocess.CompletedProcess(argv,0,output,'')


class PausedBootstrapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.package=b.build()
        cls.files=sorted(ROOT/'supabase/migrations'/Path(k).name for k in cls.package['input_source_hashes'] if k.startswith('supabase/migrations/') and k.endswith('.sql'))
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.runtime=FakeRuntime(Path(self.temp.name),self.package)
        for source in self.files:shutil.copy2(source,self.runtime.project/'supabase/migrations'/source.name)
        self.helper=p.PausedBootstrap(self.runtime,self.package,self.files)
        self.argv=['supabase','start','--workdir',str(self.runtime.project),'--exclude','fixed-exclusions']
        self.addCleanup(patch.stopall)
        patch.dict(os.environ,{},clear=True).start()
        self.image=patch('history_environment.assert_bootstrap_image',return_value={'pinned':True}).start()
    def run_helper(self):return self.helper.run(self.argv,self.runtime.command)
    def assert_restored(self):
        self.helper.tree(self.helper.migrations)
        self.assertFalse(self.helper.staged.exists());self.assertFalse(self.runtime.bootstrap_restore_failed)
    def test_exact_phase_order_restores_copy_before_official_migration_up(self):
        def observe(kind,argv,text):
            if kind=='start':
                self.assertFalse(list(self.helper.migrations.iterdir()));self.helper.tree(self.helper.staged)
                self.assertEqual(argv[-3:],['--network-id','2'*64,'--experimental=false'])
            if kind=='up':self.assert_restored();self.assertTrue(self.helper.record['paused_before_project_migrations'])
        self.runtime.hook=observe;self.run_helper();self.assert_restored()
        calls=self.runtime.calls;texts=[x[1] for x in calls]
        up=next(i for i,x in enumerate(calls) if x[0][:3]==['supabase','migration','up'])
        self.assertLess(texts.index(p.ZERO_SQL),up);self.assertLess(texts.index(p.DRAIN_SQL),up)
        self.assertIn('alter system set cron.launch_active_jobs=off;select pg_reload_conf();',texts[:up])
        self.assertEqual(calls[up][0],['supabase','migration','up','--local','--workdir',str(self.runtime.project),'--experimental=false'])
        self.assertEqual(texts[-1],self.package['preflight_sql']);self.assertTrue(self.helper.record['passed'])
        self.image.assert_called_once_with('fixed-image',{'Id':'image-id'})
    def test_start_zero_ledger_safe_or_pause_failure_restores_before_outer_cleanup(self):
        for phase in ('start',p.ZERO_SQL,p.SAFE_SQL,'alter system set cron.launch_active_jobs=off;select pg_reload_conf();'):
            self.setUp();self.runtime.fault=phase
            with self.subTest(phase=phase),self.assertRaises(AssertionError):self.run_helper()
            self.assert_restored();self.assertFalse(any(x[0][:3]==['supabase','migration','up'] for x in self.runtime.calls))
    def test_evidence_save_failure_immediately_after_rename_is_restoration_protected(self):
        original=self.helper.save
        failed=False
        def save():
            nonlocal failed
            if self.helper.deferred and not failed:
                failed=True
                raise OSError('synthetic evidence write failure')
            return original()
        with patch.object(self.helper,'save',side_effect=save),self.assertRaisesRegex(OSError,'evidence write'):
            self.run_helper()
        self.assert_restored();self.runtime.network.prepare.assert_not_called()
        self.assertEqual(self.helper.record['primary_failure']['type'],'OSError')

    def test_primary_failure_is_retained_when_restoration_conflicts(self):
        def change(kind,argv,text):
            if kind=='start':
                (self.helper.migrations/'evidence.sql').write_text('retain')
                raise RuntimeError('primary startup diagnostic')
        self.runtime.hook=change
        with self.assertRaisesRegex(AssertionError,'replacement migration'):
            self.run_helper()
        result=json.loads((self.runtime.folder/'paused-bootstrap.json').read_text())
        self.assertEqual(result['primary_failure'],{'type':'RuntimeError','message':'primary startup diagnostic'})
        self.assertEqual(result['restoration_failure']['type'],'AssertionError')
        self.assertTrue(self.runtime.bootstrap_restore_failed)

    def test_network_prepare_failure_restores_exact_copy(self):
        self.runtime.network.prepare.side_effect=AssertionError('collision')
        with self.assertRaises(AssertionError):self.run_helper()
        self.assert_restored();self.assertEqual(self.runtime.calls,[])
    def test_image_failure_blocks_project_migrations_and_restores(self):
        self.runtime.entry['State']['Running']=False
        with self.assertRaisesRegex(AssertionError,'not running'):self.run_helper()
        self.assert_restored();self.assertFalse(any(x[1]==p.ZERO_SQL for x in self.runtime.calls))
    def test_original_keyset_bytes_symlink_or_existing_stage_refused_without_network(self):
        for fault in ('extra','missing','bytes','symlink','stage'):
            self.setUp();path=self.helper.migrations/self.files[0].name
            if fault=='extra':(self.helper.migrations/'extra.sql').write_text('unreviewed')
            if fault=='missing':path.unlink()
            if fault=='bytes':path.write_text('changed')
            if fault=='symlink':path.unlink();path.symlink_to(self.files[0])
            if fault=='stage':self.helper.staged.mkdir()
            with self.subTest(fault=fault),self.assertRaises(AssertionError):self.run_helper()
            self.runtime.network.prepare.assert_not_called();self.assertFalse(self.helper.deferred)
    def test_restore_conflict_retains_both_entries_and_requests_no_work_deletion(self):
        for fault in ('active_extra','stage_bytes','active_symlink'):
            self.setUp()
            def change(kind,argv,text):
                if kind!='start':return
                if fault=='active_extra':(self.helper.migrations/'unexpected.sql').write_text('retain this evidence')
                if fault=='stage_bytes':(self.helper.staged/self.files[0].name).write_text('retain changed stage')
                if fault=='active_symlink':self.helper.migrations.rmdir();self.helper.migrations.symlink_to(self.helper.staged,target_is_directory=True)
                raise AssertionError('start failure with conflict')
            self.runtime.hook=change
            with self.subTest(fault=fault),self.assertRaises(AssertionError):self.run_helper()
            self.assertTrue(self.runtime.bootstrap_restore_failed);self.assertTrue(self.helper.record['work_retained_required'])
            self.assertTrue(self.helper.staged.exists());self.assertTrue(self.helper.migrations.exists());self.assertTrue(self.runtime.config.exists())
    def test_migration_failure_keeps_restored_copy_and_never_claims_pass(self):
        self.runtime.fault='up'
        with self.assertRaises(AssertionError):self.run_helper()
        self.assert_restored();self.assertFalse(self.helper.record['passed'])
    def test_exact_ledger_difference_refused_after_migration(self):
        original=self.runtime.command
        def wrong(argv,**kwargs):
            result=original(argv,**kwargs)
            if kwargs.get('text')==p.LEDGER_SQL:result.stdout='[]'
            return result
        with self.assertRaisesRegex(AssertionError,'ledger differs'):self.helper.run(self.argv,wrong)
        self.assert_restored();self.assertFalse(self.helper.record['passed'])
    def test_unsafe_environment_dotenv_or_seed_refused_without_mutation(self):
        for fault in ('PGHOST','SUPABASE_DB_MIGRATIONS_ENABLED','dotenv','seed'):
            self.setUp()
            if fault in ('dotenv','seed'):
                (self.runtime.project/'supabase'/('.env' if fault=='dotenv' else 'seed.sql')).write_text('private test')
            else:os.environ[fault]='unreviewed'
            with self.subTest(fault=fault),self.assertRaises(AssertionError):self.run_helper()
            self.runtime.network.prepare.assert_not_called();self.assertFalse(self.helper.staged.exists())
    def test_drain_expiry_cannot_return_success_from_late_true(self):
        self.helper.parent_command=self.runtime.command
        with patch.object(p.time,'monotonic',side_effect=[100,100,113,113,113,113]),patch.object(self.helper,'sql',return_value='t'):
            with self.assertRaisesRegex(AssertionError,'drain deadline'):self.helper.drain()
        self.assertIsNone(self.runtime.bootstrap_phase_deadline)
    def test_no_second_attempt_or_changed_selected_file_list(self):
        self.run_helper()
        with self.assertRaisesRegex(AssertionError,'retried'):self.run_helper()
        with self.assertRaisesRegex(AssertionError,'Exact admitted'):p.PausedBootstrap(self.runtime,self.package,self.files[:-1])
    def test_four_donor_literals_exact_known_hashes_no_cross_worktree_import(self):
        expected={'ZERO_SQL': 'c1b0352e8d91d17a92604c6cf223d5fb9d08e83238c237b4cd33f56951548b0c', 'DRAIN_SQL': 'fc3c0521f632eb96986ee7b5bbc82f5535b3b7e9b8586ddd76afcd05f23dc963', 'SAFE_SQL': '7b1913d62cfd891f486b088ef10c4bb6090935cb855a2282091fad0542245476', 'LEDGER_SQL': 'a4e981c2fa6020b2884baa85486204c71aee5dd26911e55498eaf3e978b82c20'}
        self.assertEqual(p.DONOR_COMMIT,'19a532484ebce7064abe110aea002c518350e67a')
        self.assertEqual(p.DONOR_SHA256,'80a241e3a7022e8e2a3f0f440b80178b91a49696781329c518943b00be269bd5')
        self.assertEqual(p.DONOR_LITERAL_SHA256,expected)
        for name,digest in p.DONOR_LITERAL_SHA256.items():self.assertEqual(hashlib.sha256(getattr(p,name).encode()).hexdigest(),digest)
        source=Path(p.__file__).read_text();self.assertNotIn('/Users/',source);self.assertNotIn('import owned_canonical_bootstrap',source)


if __name__=='__main__':unittest.main()
