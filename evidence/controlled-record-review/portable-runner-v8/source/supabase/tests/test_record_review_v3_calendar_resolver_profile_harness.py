"""Offline prospective calendar profile proof. No target SQL or database execution."""
from copy import deepcopy
import hashlib,json
from pathlib import Path
import shutil,socket,subprocess,sys,tempfile,unittest
from unittest.mock import patch
from pglast import parse_sql,parse_plpgsql
H=Path(__file__).resolve().parent;ROOT=H.parents[1];SOURCE=ROOT/'tests/controlled-drugs/engine/candidate'
sys.path[:0]=[str(H),str(SOURCE)]
import record_review_v3_calendar_resolver_profile as profile
import record_review_v3_calendar_resolver_descriptor as descriptor
import record_review_v3_configuration_record_profile as parent

MANIFEST=json.loads((SOURCE/'record-review-v3-calendar-resolver-profile.json').read_text())

def stage(root):
    for name,wanted in MANIFEST['parent_input_source_hashes'].items():
        origin=ROOT/name;assert hashlib.sha256(origin.read_bytes()).hexdigest()==wanted
        target=root/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(origin,target)
    source=root/SOURCE.relative_to(ROOT)
    for name in profile.NEW_NAMES:shutil.copy2(SOURCE/name,source/name)
    return source

class ProfileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p=patch.object(subprocess,'Popen',side_effect=AssertionError('No processes'));cls.s=patch.object(socket,'socket',side_effect=AssertionError('No sockets'));cls.p.start();cls.s.start();cls.addClassCleanup(cls.p.stop);cls.addClassCleanup(cls.s.stop)
        cls.tmp=tempfile.TemporaryDirectory(prefix='lrv-calendar-profile-');cls.addClassCleanup(cls.tmp.cleanup);cls.root=Path(cls.tmp.name);cls.source=stage(cls.root)
        cls.before=parent.build(cls.source,cls.source);cls.package=profile.build(cls.source,cls.source)
    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup();cls.s.stop();cls.p.stop()
    def test_exact275_lineage_and_finite39_metadata(self):
        p=self.package;before=self.before
        self.assertEqual(len(p['input_source_hashes']),275);self.assertEqual(len(before['input_source_hashes']),267)
        self.assertEqual({k:p['input_source_hashes'][k]for k in MANIFEST['parent_input_source_hashes']},MANIFEST['parent_input_source_hashes'])
        self.assertEqual(set(p['input_source_hashes'])-set(MANIFEST['parent_input_source_hashes']),{str((SOURCE/n).relative_to(ROOT))for n in profile.NEW_NAMES})
        self.assertEqual(len(p['expected']['functions']),39);self.assertEqual(len(p['expected']['relations']),13);self.assertEqual(len(p['expected']['foreign_key_triggers']),60)
        profile.finite_delta(before['expected'],p['expected'],self.source)
        changed={k for k in before['expected']['functions']if before['expected']['functions'][k]!=p['expected']['functions'][k]}
        self.assertEqual(changed,{'controlled_review_v3.required()','controlled_review_v3.snapshot()'})
    def test_original_body_and_new_metadata_drift_refuse(self):
        for mutate in (lambda x:x['functions']['controlled_review_v3.required()'].update(source='begin return;end'),lambda x:x['functions']['controlled_review_v3.calendar_candidates(p_request jsonb)'].update(strict=True),lambda x:x['functions']['controlled_review_v3.resolve_calendar(p_calendar jsonb)'].update(security_definer=True),lambda x:x['relations']['descriptor'].update(rls=False),lambda x:x['parents']['parent205'].update(revision=2),lambda x:x.update(extra=True)):
            altered=deepcopy(self.package['expected']);mutate(altered)
            with self.assertRaises(AssertionError):profile.finite_delta(self.before['expected'],altered,self.source)
    def test_all_six_new_source_byte_drifts_refuse(self):
        for name in sorted(profile.NEW_NAMES):
            path=self.source/name;raw=path.read_bytes()
            try:
                path.write_bytes(raw+b'\n')
                with self.assertRaises(AssertionError):profile.build(self.source,self.source)
            finally:path.write_bytes(raw)
    def test_parent_source_drift_refuses(self):
        for name in ('record-review-v3-configuration-record-schema.sql','record-review-v3-configuration-record-profile.json','helpers.sql','record_review_v3_configuration_record_admission.py','record_review_v3_configuration_record_expected.json'):
            path=self.source/name;raw=path.read_bytes()
            try:
                path.write_bytes(raw+b'\n')
                with self.assertRaises(AssertionError):profile.build(self.source,self.source)
            finally:path.write_bytes(raw)
    def test_extra_or_missing_migration_refuses(self):
        extra=self.root/'supabase/migrations/20990101000000_unreviewed.sql'
        try:
            extra.write_text('select 1;')
            with self.assertRaises(AssertionError):profile.build(self.source,self.source)
        finally:extra.unlink()
        original=next((self.root/'supabase/migrations').glob('*.sql'));raw=original.read_bytes()
        try:
            original.unlink()
            with self.assertRaises((AssertionError,FileNotFoundError)):profile.build(self.source,self.source)
        finally:original.write_bytes(raw)
    def test_new_symlink_refuses(self):
        path=self.source/'record-review-v3-calendar.sql';raw=path.read_bytes();other=self.root/'copy.sql';other.write_bytes(raw)
        try:
            path.unlink();path.symlink_to(other)
            with self.assertRaises(AssertionError):profile.build(self.source,self.source)
        finally:path.unlink();path.write_bytes(raw);other.unlink()
    def test_pure_repeat_preserves_parent_and_hashes(self):
        self.assertEqual(self.before,parent.build(self.source,self.source));self.assertEqual(self.package,profile.build(self.source,self.source))
        p=self.package;self.assertEqual(p['expected_sha256'],descriptor.sha(descriptor.canonical(p['expected']).encode()));self.assertEqual(p['install_sha256'],descriptor.sha(p['install'].encode()))
        self.assertEqual(p['expected_ledger206'],self.before['expected_ledger206']);self.assertEqual(p['canonical206_binding'],self.before['canonical206_binding'])
        self.assertEqual(p['preservation_sql'],self.before['preservation_sql']);self.assertEqual(len(p['expected_ledger206']),206)
        self.assertTrue(p['install'].startswith('begin;\n'));self.assertTrue(p['install'].endswith('commit;\n'))
        for marker in p['markers'].values():self.assertEqual(p['install'].count(marker),1)
    def test_exact_unchanged_two_helpers_and_parent_shapes(self):
        self.assertEqual(hashlib.sha256((SOURCE/'record-review-v3-calendar.sql').read_bytes()).hexdigest(),
            '0cb15fdb8ce7fd88a89495e80d6c2eac3efc34b370652e6b814a99c338f4909b')
        self.assertEqual(descriptor.TABLES,descriptor.base.TABLES);self.assertIsNot(descriptor.TABLES,descriptor.base.TABLES)
        expected=self.package['expected'];old=self.before['expected']
        self.assertEqual(expected['relations'],old['relations']);self.assertEqual(expected['parents'],old['parents']);self.assertEqual(expected['foreign_key_triggers'],old['foreign_key_triggers'])
        for name,_,_,_,body in descriptor.read_new_functions(self.source,self.source):self.assertEqual(expected['functions']['controlled_review_v3.'+name+'('+('p_request'if name=='calendar_candidates'else'p_calendar')+' jsonb)']['source'],body)
    def test_no_reference_launch_or_admission_claim(self):
        p=self.package
        for name in ('acceptance','source_integration','runtime_executed','admitted_artifact','runtime_launch_ready','auth_acceptance','configuration_publication_implemented','protocol_behavior_claim'):self.assertIs(p[name],False)
        self.assertIs(p['predecessor_admission_pending'],False);self.assertEqual(p['derivation_status'],'admitted269_plus_six_calendar_sources')
        actual=profile.build()
        self.assertEqual(actual,self.package)
        self.assertEqual(len(actual['input_source_hashes']),275)
        with self.assertRaises(AssertionError):profile.build(self.source,H)
    def test_fixed_noargument_parent_admission_and_unchanged_definition(self):
        import inspect
        self.assertEqual(len(inspect.signature(profile.parent_admission.admit).parameters),0)
        admitted=profile.parent_admission.admit()
        self.assertEqual(len(admitted['input_source_hashes']),269)
        self.assertEqual(admitted['input_source_hashes'],MANIFEST['parent_input_source_hashes'])
        self.assertEqual(admitted['wrapper_sha256'],profile.WRAPPER_BASE)
        self.assertEqual(self.package['expected_sha256'],'1f1d14493810409b7b08d1ecf5c7a4c4d06a082aa7abaf5996c76b43d541d47f')
        self.assertEqual(self.package['install_sha256'],'b7c24d3e959ae47dcccbb7313eb12762534fcd3b614ed8d6fb009980acce8e26')
        with patch.object(profile.parent_admission,'admit',return_value=dict(admitted,wrapper_sha256='0'*64)):
            with self.assertRaises(AssertionError):profile.build(self.source,self.source)
    def test_mandatory_complete_sql_and_plpgsql_parse(self):
        statements=parse_sql(self.package['install']);functions=parse_plpgsql(self.package['install'])
        self.assertGreater(len(statements),400);self.assertGreater(len(functions),250)

if __name__=='__main__':unittest.main(verbosity=2)
