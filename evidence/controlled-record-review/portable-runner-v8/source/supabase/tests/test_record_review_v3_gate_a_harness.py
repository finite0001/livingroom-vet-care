"""Offline structural trust boundaries; these tests do not prove DB acceptance."""
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'tests/controlled-drugs/engine/candidate'
sys.path.insert(0, str(SOURCE))
import record_review_v3_gate_a as assembly
import record_review_v3_gate_a_descriptor as descriptor


class RecordReviewV3GateATests(unittest.TestCase):
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
        self.assertEqual(len(functions), 19)
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
        self.assertIn('b.rows=pg_temp.record_review_v3_gate_a_rows()', self.bundle['preservation_check_sql'])
        self.assertIn('b.catalog=pg_temp.record_review_v3_gate_a_catalog()', self.bundle['preservation_check_sql'])

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
            assembly.ledger_checks_sql([{'version':'1','name':'$record_review_v3_gate_a_ledger$','statements':[]}])

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
        path = self.source/'record-review-v3-gate-a.sql'
        raw = path.read_bytes()
        self.tamper(path, raw+b'\nselect 1;\n', lambda: descriptor.build(self.source))
        self.tamper(path, raw.replace(b'FUNCTION required|', b'FUNCTION unexpected|'), lambda: descriptor.build(self.source))

    def test_expected_is_source_derived_candidate_not_frozen_acceptance(self):
        self.assertIs(self.bundle['acceptance'], False)
        self.assertEqual(self.bundle['reference_status'], 'candidate_not_admitted')
        self.assertEqual(descriptor.sha(descriptor.canonical(self.bundle['expected']).encode()), self.bundle['expected_sha256'])
        self.assertFalse((self.source/'record_review_v3_gate_a_expected.json').exists())
        parent = json.loads((self.source/descriptor.PARENT_FILE).read_text())['expected_technical_manifest']
        self.assertEqual(self.bundle['expected']['parents']['parent205'], {'revision':1,'manifest':parent})
        source = (self.source/'record-review-v3-gate-a.sql').read_text()
        self.assertIn('public.controlled_stock_manifest_snapshot()', source)
        self.assertIn('controlled_review.snapshot()', source)


if __name__ == '__main__':
    unittest.main()
