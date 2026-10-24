"""Offline source/ownership/error tests. No Docker, SQL server or socket."""
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import Mock,patch
import admission
import fixtures
import lifecycle
import driver
import record_review_v3_paused_bootstrap as donor

class FilesTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.home=Path(self.tmp.name)
        self.r=Mock();self.r.work=self.home/'work';self.r.project=self.r.work/'project'
        self.active=self.r.project/'supabase/migrations';self.active.mkdir(parents=True)
        names=['2026000000%04d_test.sql'%i for i in range(187)]+[admission.END188,admission.FIRST189]
        names+=['2026101600%04d_test.sql'%i for i in range(16)]+[admission.END206]
        self.names=sorted(names);self.assertEqual(len(names),206)
        self.expected={}
        for name in self.names:
            raw=('select '+repr(name)+';\n').encode();(self.active/name).write_bytes(raw);self.expected[name]=admission.sha(raw)
        self.c=lifecycle.Copies(self.r,self.expected)
    def test_empty188206_and_full_staging_survive(self):
        self.c.defer();self.assertEqual(self.c.read_tree(self.active),{})
        self.c.to188(lambda:None);self.assertEqual(len(self.c.read_tree(self.active)),188)
        self.c.to206(lambda:None);self.c.full(self.active);self.c.full(self.c.stage)
        self.c.recover();self.c.full(self.active);self.assertTrue(self.c.quarantine.is_dir())
    def test_next_name_only_and_unchanged_stage(self):
        self.c.defer()
        with self.assertRaises(AssertionError):self.c.copy_one(self.names[1],lambda:None)
        (self.c.stage/self.names[0]).write_text('changed')
        with self.assertRaises(AssertionError):self.c.copy_one(self.names[0],lambda:None)
    def test_partial_write_retained_and_full_recovery_without_overwrite(self):
        self.c.defer();self.c.pending=self.names[0]
        pending=self.active/('.'+self.names[0]+'.pending');pending.write_bytes((self.c.stage/self.names[0]).read_bytes()[:6]);self.c.pending_id=pending.stat().st_ino
        self.c.observe();self.c.recover();self.c.full(self.active)
        self.assertEqual((self.c.quarantine/pending.name).read_bytes(),b'select')
        self.assertEqual(self.c.recovery_inventory['sizes'][pending.name],6)
        self.assertEqual(self.c.recovery_inventory['observed']['active'][pending.name],admission.sha(b'select'))
    def test_unbound_or_wrong_partial_is_retained_and_refused(self):
        for mode in ('inode','bytes','extra','symlink'):
            with self.subTest(mode=mode):
                self.setUp();self.c.defer();self.c.pending=self.names[0]
                pending=self.active/('.'+self.names[0]+'.pending')
                if mode=='symlink':pending.symlink_to(self.c.stage/self.names[0])
                else:pending.write_bytes(b'BAD' if mode=='bytes' else b'select')
                self.c.pending_id=-1 if mode=='inode' else pending.stat().st_ino
                if mode=='extra':(self.active/'foreign.sql').write_text('private')
                with self.assertRaises(AssertionError):self.c.recover()
                self.assertTrue(self.c.stage.exists());self.assertTrue(self.active.exists())
    def test_atomic_promotion_before_journal_update_is_exact_and_recoverable(self):
        self.c.defer();self.c.pending=self.names[0]
        pending=self.active/('.'+self.names[0]+'.pending')
        pending.write_bytes((self.c.stage/self.names[0]).read_bytes());self.c.pending_id=pending.stat().st_ino
        pending.rename(self.active/self.names[0])
        self.c.observe();self.c.recover();self.c.full(self.active)
    def test_same_bytes_replacement_after_promotion_refuses_new_inode(self):
        self.c.defer();self.c.pending=self.names[0]
        pending=self.active/('.'+self.names[0]+'.pending')
        pending.write_bytes((self.c.stage/self.names[0]).read_bytes());self.c.pending_id=pending.stat().st_ino
        pending.rename(self.home/'preserved-owned-original')
        (self.active/self.names[0]).write_bytes((self.c.stage/self.names[0]).read_bytes())
        with self.assertRaisesRegex(AssertionError,'Promoted copy identity'):self.c.recover()
        self.assertTrue(self.c.stage.exists())
    def test_mkdir_failure_can_restore_original_without_deleting_unknown_path(self):
        self.c.full(self.active);self.active.rename(self.c.stage);self.c.deferred=True;self.c.stage_id=self.c.stage.stat().st_ino
        self.c.recover();self.c.full(self.active)
    def test_deadline_stops_copy_before_first_write(self):
        self.c.defer()
        def expired():raise TimeoutError('deadline')
        with self.assertRaises(TimeoutError):self.c.to188(expired)
        self.assertEqual(self.c.read_tree(self.active),{});self.c.recover()
    def test_suffix_failure_retains_exact_prefix_and_successful_partial_suffix(self):
        self.c.defer();self.c.to188(lambda:None);calls=0
        def cutoff():
            nonlocal calls
            calls+=1
            if calls==5:raise TimeoutError('cutoff')
        with self.assertRaises(TimeoutError):self.c.to206(cutoff)
        self.assertEqual(len(self.c.done),190);self.c.observe();self.c.recover();self.c.full(self.active)
    def test_changed_active_completed_file_refuses_recovery(self):
        self.c.defer();self.c.copy_one(self.names[0],lambda:None)
        (self.active/self.names[0]).write_text('unowned replacement')
        with self.assertRaises(AssertionError):self.c.recover()
        self.assertEqual((self.active/self.names[0]).read_text(),'unowned replacement')

class AdmissionTests(unittest.TestCase):
    def test_pure_full_root_then_frozen188_and_exact_suffix(self):
        with patch('subprocess.Popen',side_effect=AssertionError('No processes')),patch('socket.socket',side_effect=AssertionError('No sockets')):
            b=admission.build()
        self.assertEqual(len(b['expected188']),188);self.assertEqual(len(b['suffix']),18)
        self.assertEqual(b['expected188'],b['package']['expected_ledger206'][:188])
    def test_tampered_independent_artifact_refused(self):
        original=Path.read_bytes
        def wrong(path):
            raw=original(path)
            return raw+b' ' if path.name=='expected-188-ledger.json' else raw
        with patch.object(Path,'read_bytes',wrong),self.assertRaisesRegex(AssertionError,'artifact changed'):admission.build()
    def test_complete_private_inventory_and_no_frozen_source_write(self):
        values=admission.inputs();self.assertGreater(len(values),614)
        for name in admission.OWN_FILES:self.assertIn(str((admission.HERE/name).relative_to(admission.ROOT)),values)
    def test_duplicate_json_and_dynamic_ids_refused(self):
        with self.assertRaises(AssertionError):json.loads('{"a":1,"a":2}',object_pairs_hook=admission.unique)
        ids=dict(fixtures.FIXED,client='c2180000-0000-4000-8000-000000000001',pet='c2180000-0000-4000-8000-000000000002',product='c2180000-0000-4000-8000-000000000003')
        fixtures.admit_ids(ids)
        for field,value in (('product','x'),('actor',ids['client']),('pet',ids['client'])):
            wrong=dict(ids);wrong[field]=value
            with self.assertRaises((AssertionError,ValueError)):fixtures.admit_ids(wrong)

class OracleTests(unittest.TestCase):
    def setUp(self):
        self.ids=dict(fixtures.FIXED,client='c2180000-0000-4000-8000-000000000001',pet='c2180000-0000-4000-8000-000000000002',product='c2180000-0000-4000-8000-000000000003')
        self.value={'kind':'fixed188-source-oracle-v1','membership':{'admission_backend_pid':4242,'dispense_id':self.ids['dispense'],'correction_id':self.ids['correction'],
             'movement_count':4,'allocation_count':2,'charge_count':1,'pickup_sources':0,'correction_sources':0,'backfilled':False,'opening_or_controlled_event_count':0},
             'relations':{name:{'columns':[{'name':'id','type':'uuid'}],'rows':[{'id':self.ids['dispense']}]}for name in fixtures.TABLES}}
    def test_original_columns_preserve_new_columns_without_hiding_them(self):
        after=copy.deepcopy(self.value)
        for table in after['relations'].values():
            table['columns'].append({'name':'new_suffix_column','type':'text'});table['rows'][0]['new_suffix_column']='retained raw'
        result=fixtures.preserved(self.value,after,self.ids,4242)
        self.assertTrue(result['original_column_rows_preserved']);self.assertTrue(all(result['new_columns_retained'].values()))
    def test_changed_rows_extra_rows_missing_columns_or_type_refuse(self):
        for mode in ('changed','extra','missing','type','keyset','provenance'):
            with self.subTest(mode=mode):
                after=copy.deepcopy(self.value);table=after['relations']['native_dispenses']
                if mode=='changed':table['rows'][0]['id']=self.ids['client']
                if mode=='extra':table['rows'].append({'id':self.ids['client']})
                if mode=='missing':table['columns']=[]
                if mode=='type':table['columns'][0]['type']='text'
                if mode=='keyset':del after['relations']['stock_custody_sources']
                if mode=='provenance':after['membership']['correction_sources']=1
                with self.assertRaises(AssertionError):fixtures.preserved(self.value,after,self.ids,4242)
    def test_bool_not_integer_and_duplicate_receipt_refuse(self):
        wrong=copy.deepcopy(self.value);wrong['membership']['charge_count']=True
        with self.assertRaises(AssertionError):fixtures.admit_observation(wrong,self.ids,4242)
        line=json.dumps(self.value)
        with self.assertRaises(AssertionError):fixtures.parse(line+'\n'+line,'fixed188-source-oracle-v1')
    def test_different_closed_backend_cannot_substitute_for_fixture_receipt(self):
        with self.assertRaises(AssertionError):fixtures.admit_observation(self.value,self.ids,4343)
    def test_sql_parse_and_all_plpgsql_bodies_required_no_skip(self):
        from pglast import parse_sql,parse_plpgsql,ast
        from pglast.stream import RawStream
        counts={'sql':0,'plpgsql':0}
        for sql in (fixtures.seed(),fixtures.oracle(self.ids),fixtures.raw188_sql()):
            statements=parse_sql(sql);counts['sql']+=len(statements)
            for raw in statements:
                node=raw.stmt
                if isinstance(node,ast.DoStmt) or (isinstance(node,ast.CreateFunctionStmt) and any(option.defname=='language' and option.arg.sval=='plpgsql' for option in node.options)):
                    parse_plpgsql(RawStream()(node));counts['plpgsql']+=1
        self.assertGreater(counts['sql'],45);self.assertGreaterEqual(counts['plpgsql'],7)
        print('required parser counts',counts)
    def test_ast_no_permanent_native_fabrication_or_bypass(self):
        from pglast import parse_sql,ast
        allowed={'users','profiles','user_roles','fixed188_ids','fixed188_data'}
        for raw in parse_sql(fixtures.seed()):
            node=raw.stmt
            if isinstance(node,(ast.InsertStmt,ast.UpdateStmt,ast.DeleteStmt)):
                self.assertIn(node.relation.relname,allowed)
            self.assertNotIsInstance(node,ast.DeleteStmt)
        sql=fixtures.seed().lower()
        self.assertNotIn('session_replication_role=',sql);self.assertNotIn('disable trigger',sql)
        self.assertNotIn('supabase_admin',sql);self.assertNotIn('session authorization',sql)
        self.assertEqual(sql.count('set local role authenticated;'),1)
        self.assertEqual(sql.count('reset role;'),1)
        self.assertIn("session_user<>'postgres' or current_user<>'authenticated'",sql)
        self.assertEqual(sql.count('select receive_inventory('),2)
        self.assertEqual(sql.count('select record_native_dispense('),1)
        self.assertEqual(sql.count('select append_native_dispense_correction('),1)
    def test_raw188_observation_does_not_call_absent_parent206(self):
        sql=fixtures.raw188_sql()
        self.assertNotIn('controlled_review.snapshot()',sql)
        self.assertNotIn('controlled_stock_manifest_snapshot()',sql)
        self.assertIn('pg_temp.review_cli_catalog()',sql)

class DeadlineTests(unittest.TestCase):
    def runtime(self):
        r=object.__new__(driver.Runtime)
        r.outer_deadline=700;r.setup_deadline=640;r.fixed_phase_deadline=None;r.in_cleanup=False;r.final_mode=False
        r.cleanup_deadline=None;r.bootstrap_phase_deadline=None;r.candidate_phase_deadline=None;r.cleanup_started=False
        r.save_private=Mock();r.command_number=0;r.fixed_status=[];r.fixed_failure=None
        return r
    def test_setup_cutoff_and_each_phase_clamp_not_entry_only(self):
        r=self.runtime()
        with patch.object(driver.time,'monotonic',return_value=639):self.assertEqual(r.remaining(120),1)
        with patch.object(driver.time,'monotonic',return_value=640),self.assertRaises(AssertionError):r.remaining(120)
        r.fixed_phase_deadline=610
        with patch.object(driver.time,'monotonic',return_value=609):self.assertEqual(r.remaining(120),1)
        r.final_mode=True;r.fixed_phase_deadline=None
        with patch.object(driver.time,'monotonic',return_value=660):self.assertEqual(r.remaining(120),40)
    def test_copy_callback_obeys_phase_cutoff_and_cannot_resume_in_cleanup(self):
        r=self.runtime();r.fixed_phase_deadline=610
        with patch.object(driver.time,'monotonic',return_value=610),self.assertRaises(AssertionError):r.setup_remaining()
        with patch.object(driver.time,'monotonic',return_value=611):r.begin_failure_cleanup()
        with self.assertRaises(AssertionError):r.setup_remaining()
    def test_failure_cleanup_reserve_initialized_once(self):
        r=self.runtime()
        with patch.object(driver.time,'monotonic',return_value=650):r.begin_failure_cleanup()
        with patch.object(driver.time,'monotonic',return_value=710):r.begin_failure_cleanup();self.assertEqual(r.remaining(120),120)
        self.assertEqual(r.cleanup_deadline,830)
        with patch.object(driver.time,'monotonic',return_value=830),self.assertRaises(AssertionError):r.remaining(120)
    def test_phase_rejects_late_success_and_restores_field(self):
        r=self.runtime()
        with patch.object(driver.time,'monotonic',side_effect=[500,500,621,621]):
            with self.assertRaises(AssertionError):
                with r.phase('genuine188_seed'):pass
        self.assertIsNone(r.fixed_phase_deadline)
        self.assertFalse(r.save_private.call_args.args[1]['passed'])
    def test_primary_command_failure_survives_cleanup_failure(self):
        r=self.runtime()
        with patch.object(driver.time,'monotonic',return_value=500),patch.object(driver.base.Runtime,'command',return_value=subprocess.CompletedProcess(['fixed'],9,'','private')):
            with self.assertRaises(AssertionError):r.direct_command(['fixed'])
        first=copy.deepcopy(r.fixed_failure);self.assertEqual(first['exit_code'],9)
        with patch.object(driver.time,'monotonic',return_value=500),patch.object(driver.base.Runtime,'command',side_effect=TimeoutError()):
            with self.assertRaises(TimeoutError):r.direct_command(['cleanup'])
        self.assertEqual(r.fixed_failure,first);self.assertEqual(r.fixed_status[-1]['error_type'],'TimeoutError')


class FakeRuntime:
    def __init__(self,home,bundle):
        self.folder=home/'evidence';self.folder.mkdir()
        self.work=home/'work';self.project=self.work/'project'
        migrations=self.project/'supabase/migrations';migrations.mkdir(parents=True)
        import shutil
        for p in bundle['files']:shutil.copy2(p,migrations/p.name)
        self.config=self.project/'supabase/config.toml';self.config.write_text('fixed')
        self.deadline=time.monotonic()+600;self.bootstrap_phase_deadline=None;self.bootstrap_restore_failed=False
        self.container='db-name';self.entry={'Id':'3'*64,'Image':'image-id','State':{'Running':True},'Config':{'Image':'pinned'}}
        self.network=Mock();self.network.prepare.return_value='2'*64
        self.record={};self.owned_services={};self.save=Mock();self.copy_receipt=Mock();self.save_private=Mock()
        self.bundle=bundle;self.calls=[];self.up_count=0;self.fault=None;self.hook=None
        self.cleanup_entries=0
    def check_config(self):assert self.config.read_text()=='fixed'
    def setup_remaining(self):assert time.monotonic()<self.deadline;return self.deadline-time.monotonic()
    def remaining(self,n):return min(n,self.setup_remaining())
    def begin_failure_cleanup(self):self.cleanup_entries+=1
    def verify(self):self.check_config();return self.entry
    def service_inventory(self):return {self.entry['Id']:{'project':'owned'}}
    def direct_command(self,argv,text=None,timeout=120,fail=True):
        assert timeout<=120 and fail is True
        kind='start' if argv[:2]==['supabase','start'] else 'up' if argv[:3]==['supabase','migration','up'] else 'image' if argv[:3]==['docker','image','inspect'] else 'sql'
        self.calls.append((kind,list(argv),text))
        if self.hook:self.hook(kind,argv,text)
        if kind=='up':self.up_count+=1
        if self.fault is not None and (self.fault==kind or self.fault==text):raise RuntimeError('primary '+kind)
        output=json.dumps([{'Id':'image-id'}]) if kind=='image' else 't' if text==donor.DRAIN_SQL else json.dumps(self.bundle['expected188'] if self.up_count==1 else self.bundle['package']['expected_ledger206']) if text==donor.LEDGER_SQL else ''
        return subprocess.CompletedProcess(argv,0,output,'')

class LifecycleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.bundle=admission.build()
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.r=FakeRuntime(Path(self.tmp.name),self.bundle);self.h=lifecycle.Lifecycle(self.r,self.bundle)
        self.argv=['supabase','start','--workdir',str(self.r.project),'--exclude','fixed']
        self.addCleanup(patch.stopall)
        patch.dict(os.environ,{},clear=True).start()
        patch('history_environment.assert_bootstrap_image',return_value={'pin':True}).start()
    def test_pause_precedes_prefix_and_seed_precedes_suffix(self):
        def see(kind,argv,text):
            if kind=='start':self.assertEqual(self.h.copies.read_tree(self.h.copies.active),{});self.h.copies.full(self.h.copies.stage)
            if kind=='up':
                self.assertEqual(len(self.h.copies.read_tree(self.h.copies.active)),188 if self.r.up_count==0 else 206)
                self.assertIn(donor.DRAIN_SQL,[c[2]for c in self.r.calls])
        self.r.hook=see;self.h.start_prefix(self.argv)
        self.assertEqual(self.h.record['state'],'exact188_installed')
        with self.assertRaises(AssertionError):self.h.upgrade()
        self.h.transition('historical_seed_committed');self.h.upgrade()
        self.assertEqual(self.h.record['state'],'exact206_installed');self.assertEqual(self.r.up_count,2)
        self.assertEqual(self.r.container,self.r.entry['Id'])
        self.assertTrue(all('--experimental=false'in argv for kind,argv,_ in self.r.calls if kind in ('start','up')))
    def test_zero_or_start_failure_recovers_copy_and_prevents_migration(self):
        for fault in ('start',donor.ZERO_SQL,donor.SAFE_SQL):
            with self.subTest(fault=fault):
                self.setUp();self.r.fault=fault
                with self.assertRaises(RuntimeError):self.h.start_prefix(self.argv)
                self.assertEqual(self.r.up_count,0);self.h.copies.full(self.h.copies.active)
                self.assertEqual(self.h.record['primary_failure']['type'],'RuntimeError')
                self.assertFalse(self.r.bootstrap_restore_failed);self.assertEqual(self.r.cleanup_entries,1)
    def test_unexpected_active_file_preserves_first_failure_and_work(self):
        def inject(kind,argv,text):
            if kind=='start':
                (self.h.copies.active/'foreign.sql').write_text('must retain')
                raise RuntimeError('original start failure')
        self.r.hook=inject
        with self.assertRaisesRegex(RuntimeError,'original start'):self.h.start_prefix(self.argv)
        self.assertTrue(self.r.bootstrap_restore_failed);self.assertEqual(self.h.record['primary_failure']['type'],'RuntimeError')
        self.assertEqual(self.h.record['restoration_failure']['type'],'AssertionError')
        self.assertEqual((self.h.copies.active/'foreign.sql').read_text(),'must retain')
    def test_wrong_full_statement_array_refuses_count_only_ledger(self):
        original=self.r.direct_command
        def wrong(argv,**kw):
            result=original(argv,**kw)
            if kw.get('text')==donor.LEDGER_SQL:
                rows=copy.deepcopy(self.bundle['expected188']);rows[-1]['statements']=[];result.stdout=json.dumps(rows)
            return result
        self.h.parent_command=wrong
        with self.assertRaisesRegex(AssertionError,'full ledger'):self.h.start_prefix(self.argv)
        self.assertFalse(self.h.record['passed'])
    def test_dotenv_or_override_refuses_before_owned_mutation(self):
        (self.r.project/'.env').write_text('do not read private values')
        with self.assertRaisesRegex(AssertionError,'dotenv'):self.h.start_prefix(self.argv)
        self.assertFalse(self.h.copies.deferred);self.r.network.prepare.assert_not_called()
    def test_source_change_after188_blocks_upgrade(self):
        self.h.start_prefix(self.argv);self.h.transition('historical_seed_committed')
        self.r.config.write_text('other config')
        with self.assertRaises(AssertionError):self.h.upgrade()
        self.assertEqual(self.r.up_count,1);self.assertTrue(self.r.bootstrap_restore_failed)

if __name__=='__main__':unittest.main(verbosity=2)
