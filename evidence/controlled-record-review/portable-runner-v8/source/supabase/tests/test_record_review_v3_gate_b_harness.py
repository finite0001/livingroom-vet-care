"""Offline structural trust boundaries; these tests do not prove DB acceptance."""
import json
from copy import deepcopy
from unittest.mock import patch
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'tests/controlled-drugs/engine/candidate'
sys.path.insert(0, str(SOURCE))
import record_review_v3_gate_b as assembly
import record_review_v3_gate_b_descriptor as descriptor


class RecordReviewV3GateBTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bundle = assembly.build()
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        # Explicit public source closure only: never copy environment/config secrets.
        for relative in cls.bundle['input_source_hashes']:
            destination = cls.root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / relative, destination)
        cls.source = cls.root / SOURCE.relative_to(ROOT)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def tamper(self, path, replacement, check):
        original = path.read_bytes()
        try:
            path.write_bytes(replacement)
            with self.assertRaises(AssertionError):
                check()
        finally:
            path.write_bytes(original)

    def test_exact_finite_tables_and_parent_fk_boundary(self):
        self.assertEqual(set(descriptor.TABLES), {'descriptor','publications','configuration','families',
            'obligations','operation_claims','preparations','decisions','cancellations','escalations',
            'escalation_actions','materializations','scan_receipts'})
        fks = [(table, *item) for table, spec in descriptor.TABLES.items() for item in spec['fks']]
        self.assertEqual(len(fks), 15)
        self.assertEqual([item for item in fks if not item[3].startswith(descriptor.SCHEMA + '.')],
                         [('obligations','event_fk','event_id','public.controlled_stock_events','id',False)])
        self.assertEqual({(item[0],item[1]) for item in fks if item[-1]},
                         {('publications','record_fk'),('configuration','publication_fk')})
        self.assertTrue(all('ON UPDATE RESTRICT ON DELETE RESTRICT' in constraint['definition']
            for relation in self.bundle['expected']['relations'].values()
            for constraint in relation['constraints'] if constraint['definition'].startswith('FOREIGN KEY')))

    def test_both_sides_of_all_ri_enforcement_are_expected(self):
        triggers = self.bundle['expected']['foreign_key_triggers']
        self.assertEqual(len(triggers), 60)
        self.assertEqual(len([t for t in triggers if t['relation']=='public.controlled_stock_events']), 2)
        self.assertEqual(len([t for t in triggers if t['deferrable']]), 4)
        for trigger in triggers:
            self.assertTrue(trigger['internal'])
            self.assertEqual(trigger['enabled'], 'O')
            self.assertEqual(trigger['deferrable'], trigger['initially_deferred'])

    def test_all_operational_entries_are_private_and_fail_closed(self):
        functions = self.bundle['expected']['functions']
        self.assertEqual(len(functions), 31)
        for signature, meta in functions.items():
            self.assertEqual(meta['acl'], descriptor.acl(['EXECUTE']))
            self.assertEqual(meta['configuration'], descriptor.CONFIG)
            if signature.startswith('public.'):
                self.assertTrue(meta['security_definer'])
                self.assertIn("using errcode='0A000'", meta['source'])
                self.assertIn('controlled_review_v3.required()', meta['source'])
        self.assertEqual(sum(s.startswith('public.') for s in functions), 11)
        self.assertTrue(functions['controlled_review_v3.terminal_check()']['security_definer'])
        self.assertNotIn('grant execute', self.bundle['ddl'].lower())

    def test_append_only_and_operational_insert_guards(self):
        for name, relation in self.bundle['expected']['relations'].items():
            self.assertTrue(relation['rls'])
            self.assertEqual(relation['policies'], [])
            triggers = {t['name']:t['definition'] for t in relation['triggers']}
            self.assertIn('BEFORE DELETE OR UPDATE', triggers['immutable'])
            self.assertIn('BEFORE TRUNCATE', triggers['no_truncate'])
            if name != 'descriptor':
                self.assertIn('refuse_insert()', triggers['review_v3_guard'])
                self.assertIn('DEFERRABLE INITIALLY DEFERRED', triggers['structural_complete'])
        self.assertEqual(len(self.bundle['expected']['types']), 26)

    def test_complete_absence_admission_covers_all_facade_object_kinds(self):
        sql = self.bundle['absence_sql']
        for catalog in ('pg_namespace','pg_proc','pg_class','pg_type'):
            self.assertIn(catalog, sql)
        for name in descriptor.FACADES:
            self.assertIn("'"+name+"'", sql)

    def test_transaction_and_unique_failure_stage_order(self):
        sql = self.bundle['install']
        self.assertTrue(sql.startswith('begin;\nselect pg_advisory_xact_lock(90271040,0);'))
        self.assertTrue(sql.endswith('commit;\n'))
        positions = []
        for marker in descriptor.MARKERS.values():
            self.assertEqual(sql.count(marker), 1)
            positions.append(sql.index(marker))
        self.assertEqual(positions, sorted(positions))
        self.assertLess(sql.index('exact206'), sql.index(descriptor.MARKERS['after_schema']))

    def test_preservation_keeps_old_extension_and_excludes_only_declared_parent_ri(self):
        sql = self.bundle['preservation_sql']
        self.assertEqual(sql.count("'supabase_migrations','controlled_review'"), 5)
        self.assertIn("k.conname='obligations_event_fk'", sql)
        self.assertIn("k.conrelid=to_regclass('controlled_review_v3.obligations')", sql)
        self.assertIn("k.confrelid='public.controlled_stock_events'::regclass", sql)
        self.assertNotIn("kn.nspname='controlled_review'", sql)
        self.assertIn('b.rows=pg_temp.record_review_v3_gate_b_rows()', self.bundle['preservation_check_sql'])
        self.assertIn('b.catalog=pg_temp.record_review_v3_gate_b_catalog()', self.bundle['preservation_check_sql'])

    def test_source_closure_and_canonical206_ledger_are_exact(self):
        rebuilt = assembly.build(self.source)
        self.assertEqual(rebuilt, self.bundle)
        self.assertEqual(len(rebuilt['expected_ledger206']), 206)
        self.assertEqual(len(rebuilt['expected_ledger206'][-2]['statements']), 94)
        self.assertEqual(len(rebuilt['expected_ledger206'][-1]['statements']), 304)
        for relative, digest in rebuilt['input_source_hashes'].items():
            self.assertEqual(descriptor.sha((self.root / relative).read_bytes()), digest)
        for name in ('canonical_review_prefix.py','secondary_review_release.py','cli_migration_body.py','release_assembly.py'):
            self.assertTrue(any(p.endswith('/'+name) for p in rebuilt['input_source_hashes']))

    def test_nested_retained_ledger_bytes_are_not_rewritten(self):
        row = self.bundle['expected_ledger206'][-1]
        sql = assembly.ledger_checks_sql([row])
        self.assertIn(assembly.old_release.sql_json(row), sql)
        self.assertIn('Secondary-review exact205', sql)
        self.assertIn('$review_ledger$', sql)
        with self.assertRaisesRegex(AssertionError, 'delimiter collision'):
            assembly.ledger_checks_sql([{'version':'1','name':'$record_review_v3_gate_b_ledger$','statements':[]}])

    def test_old_pins_and_changed_canonical_body_refused(self):
        for name in (descriptor.PARENT_FILE, descriptor.PRIVATE_FILE):
            path = self.source / name
            self.tamper(path, path.read_bytes()+b'\n', lambda: descriptor.build(self.source))
        migration = sorted((self.root/'supabase/migrations').glob('*.sql'))[-1]
        self.tamper(migration, migration.read_bytes()+b'\n', lambda: assembly.build(self.source))

    def test_extra_or_missing_canonical_file_refused(self):
        extra = self.root/'supabase/migrations/20261023010000_extra.sql'
        try:
            extra.write_text('select 1;\n')
            with self.assertRaises(AssertionError): assembly.build(self.source)
        finally:
            extra.unlink()
        first = sorted((self.root/'supabase/migrations').glob('*.sql'))[0]
        original = first.read_bytes()
        try:
            first.unlink()
            with self.assertRaises(AssertionError): assembly.build(self.source)
        finally:
            first.write_bytes(original)

    def test_unreviewed_function_inventory_and_outer_sql_refused(self):
        path = self.source/'record-review-v3-schema.sql'
        raw = path.read_bytes()
        self.tamper(path, raw+b'\nselect 1;\n', lambda: descriptor.build(self.source))
        self.tamper(path, raw.replace(b'FUNCTION required|', b'FUNCTION unexpected|'), lambda: descriptor.build(self.source))

    def test_expected_is_source_derived_candidate_not_frozen_acceptance(self):
        self.assertIs(self.bundle['acceptance'], False)
        self.assertEqual(self.bundle['reference_status'], 'candidate_not_admitted')
        self.assertEqual(descriptor.sha(descriptor.canonical(self.bundle['expected']).encode()), self.bundle['expected_sha256'])
        self.assertFalse((self.source/'record_review_v3_gate_b_expected.json').exists())
        parent = json.loads((self.source/descriptor.PARENT_FILE).read_text())['expected_technical_manifest']
        self.assertEqual(self.bundle['expected']['parents']['parent205'], {'revision':1,'manifest':parent})
        source = (self.source/'record-review-v3-schema.sql').read_text()
        self.assertIn('public.controlled_stock_manifest_snapshot()', source)
        self.assertIn('controlled_review.snapshot()', source)


    def test_frozen_declarations_are_deep_copied_and_cannot_drift(self):
        self.assertEqual(descriptor.TABLES,descriptor.frozen.TABLES)
        self.assertIsNot(descriptor.TABLES,descriptor.frozen.TABLES)
        self.assertIsNot(descriptor.TABLES['configuration'],descriptor.frozen.TABLES['configuration'])
        original=deepcopy(descriptor.TABLES)
        try:
            descriptor.TABLES['configuration']['columns'].append(('unreviewed','text',False))
            self.assertEqual(descriptor.frozen.TABLES['configuration'],original['configuration'])
            with self.assertRaisesRegex(AssertionError,'shape required'):descriptor.build()
        finally:
            descriptor.TABLES.clear();descriptor.TABLES.update(original)
        path=self.source/descriptor.FROZEN_DECLARATION_FILE
        self.tamper(path,path.read_bytes()+b'\n',lambda:descriptor.build(self.source))

    def test_mutating_imported_declarations_is_not_an_expectation_authority(self):
        original=deepcopy(descriptor.frozen.ENUMS)
        try:
            descriptor.frozen.ENUMS['cancellations','kind']+=('unsafe',)
            with self.assertRaisesRegex(AssertionError,'shape required'):descriptor.build()
        finally:
            descriptor.frozen.ENUMS.clear();descriptor.frozen.ENUMS.update(original)

    def test_gate_a_builder_is_never_called_or_resealed(self):
        with patch.object(descriptor.frozen,'build',side_effect=AssertionError('Gate A build forbidden')):
            rebuilt=assembly.build(self.source)
        self.assertEqual(rebuilt,self.bundle)
        self.assertEqual(rebuilt['stage'],'private_adapters_a1')
        self.assertIs(rebuilt['adapter_coverage'],False)
        self.assertIs(rebuilt['configuration_implemented'],False)
        self.assertEqual(rebuilt['expected']['kind'],'controlled-review-v3-gate-b-private-adapters-a1-v1')
        self.assertIn("'controlled-review-v3-gate-b-private-adapters-a1-v1'",rebuilt['expected']['functions']['controlled_review_v3.snapshot()']['source'])
        self.assertNotIn('controlled-review-v3-structural-gate-a-v1',rebuilt['ddl'])
        self.assertTrue(any(p.endswith('/record_review_v3_gate_a_descriptor.py')for p in rebuilt['input_source_hashes']))
        self.assertFalse(any(p.endswith('/record_review_v3_gate_a.py')for p in rebuilt['input_source_hashes']))



    def test_adapter_multiarity_metadata_and_revoke_signatures_are_exact(self):
        functions=self.bundle['expected']['functions']
        for name,file,arguments in descriptor.ADAPTER_DECLARATIONS:
            declaration=', '.join(n+' '+t for n,t in arguments)
            signature='controlled_review_v3.'+name+'('+declaration+')'
            meta=functions[signature]
            self.assertEqual(meta['argument_names'],[n for n,_ in arguments])
            self.assertEqual(meta['return_type'],'jsonb')
            self.assertEqual(meta['acl'],descriptor.acl(['EXECUTE']))
            self.assertIs(meta['security_definer'],False)
            self.assertIsNone(meta['all_argument_types']);self.assertIsNone(meta['argument_modes'])
            self.assertIn('revoke all on function controlled_review_v3.'+name+'('+', '.join(t for _,t in arguments)+') from public,anon,authenticated,service_role;',self.bundle['ddl'])
        self.assertEqual(self.bundle['adapter_functions'],12)
        self.assertEqual(set(self.bundle['source_hashes']) & set(descriptor.ADAPTER_FILES),set(descriptor.ADAPTER_FILES))

    def test_changed_missing_extra_duplicate_or_privileged_manifest_function_refused(self):
        path=self.source/descriptor.ADAPTER_MANIFEST;raw=path.read_bytes()
        original=json.loads(raw)
        mutations=[lambda v:v['function_inventory'].pop(),
            lambda v:v['function_inventory'].append(v['function_inventory'][0]),
            lambda v:v['function_inventory'][0].update(name='unexpected'),
            lambda v:v['function_inventory'][0]['arguments'][0].update(name='wrong_argument'),
            lambda v:v['function_inventory'][0]['arguments'][0].update(type='text'),
            lambda v:v['function_inventory'][0].update(security_definer=True),
            lambda v:v['function_inventory'][0].update(security_definer=0),
            lambda v:v['function_attributes'].update(application_execute=True),
            lambda v:v['public_grants'].append('authenticated'),
            lambda v:v['kinds'].pop()]
        for mutate in mutations:
            value=deepcopy(original);mutate(value)
            self.tamper(path,json.dumps(value).encode(),lambda:descriptor.build(self.source))

    def test_per_file_adapter_bodies_are_closed_and_language_exact(self):
        path=self.source/'record-review-v3-adapters.sql';raw=path.read_bytes()
        for replacement in (raw+b'\nselect 1;\n',raw.replace(b'FUNCTION adapt_event|',b'FUNCTION unknown_adapter|'),
                            raw.replace(b'|jsonb|plpgsql',b'|jsonb|sql',1),raw+b'\n'+raw):
            self.tamper(path,replacement,lambda:descriptor.build(self.source))

    def test_adapter_source_evidence_is_complete_and_byte_bound(self):
        path=self.source/descriptor.ADAPTER_MANIFEST;original=json.loads(path.read_text())
        for modification in ('remove','add','drift'):
            value=deepcopy(original);evidence=value['source_evidence_sha256']
            if modification=='remove':evidence.pop(next(iter(evidence)))
            elif modification=='add':evidence['unexpected.sql']='0'*64
            else:evidence[next(iter(evidence))]='0'*64
            self.tamper(path,json.dumps(value).encode(),lambda:descriptor.build(self.source))
        for relative,digest in original['source_evidence_sha256'].items():
            self.assertEqual(self.bundle['input_source_hashes'][relative],digest)
        for name in ('record-review-v3-calendar.sql','record-review-v3-calendar-observation.sql'):
            self.assertFalse(any(p.endswith('/'+name)for p in self.bundle['input_source_hashes']))



    def test_all_relation_type_and_ri_metadata_stays_equal_to_frozen_gate_a(self):
        retained=json.loads((SOURCE/'record_review_v3_gate_a_expected.json').read_text())['definition']
        for key in ('schema','relations','relation_inventory','types','foreign_key_triggers','parents'):
            self.assertEqual(self.bundle['expected'][key],retained[key],key)


if __name__ == '__main__':
    unittest.main()
