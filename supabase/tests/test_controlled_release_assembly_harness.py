"""Offline release trust and byte-artifact guards; no SQL or Docker execution."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'tests/controlled-drugs/engine/candidate'
sys.path.insert(0, str(SOURCE))
SPEC = importlib.util.spec_from_file_location('release_assembly', SOURCE / 'release_assembly.py')
ASSEMBLY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ASSEMBLY)


class ControlledReleaseAssemblyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        cls.source = cls.root / 'tests/controlled-drugs/engine/candidate'
        cls.source.mkdir(parents=True)
        for path in ASSEMBLY.assembled_sources(SOURCE) + [SOURCE / ASSEMBLY.PIN_NAME, SOURCE / 'release-expected-204-v1.json', SOURCE / 'trusted-prior-189.json', SOURCE / 'prior-snapshot.sql']:
            target = cls.root / path.relative_to(ROOT)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
        shutil.copytree(ROOT / 'supabase/migrations', cls.root / 'supabase/migrations')
        cls.files = sorted((cls.root / 'supabase/migrations').glob('*.sql'))
        cls.baseline = ASSEMBLY.build_release(cls.source, cls.files)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def mutation(self, path, data):
        original = path.read_bytes()
        self.addCleanup(path.write_bytes, original)
        path.write_bytes(data)

    def test_repeated_build_is_byte_identical_and_self_consistent(self):
        other = ASSEMBLY.build_release(self.source, self.files)
        self.assertEqual(other, self.baseline)
        self.assertEqual(hashlib.sha256(other['install'].encode()).hexdigest(), other['artifact_sha256'])
        self.assertEqual(other['pin_sha256'], ASSEMBLY.REVIEWED_PIN_SHA256)

    def test_migration_body_mutation_is_rejected_before_assembly(self):
        path = self.files[-1]
        self.mutation(path, path.read_bytes() + b'\nselect 1;\n')
        with self.assertRaisesRegex(AssertionError, 'migration source prefix changed'):
            ASSEMBLY.build_release(self.source, self.files)

    def test_missing_extra_reordered_and_duplicate_migration_prefixes_fail(self):
        for files in [self.files[:-1], self.files + [self.files[-1]], list(reversed(self.files)), self.files[:-1] + [self.files[0]]]:
            with self.subTest(count=len(files)), self.assertRaises(AssertionError):
                ASSEMBLY.build_release(self.source, files)

    def test_new_body_grant_rls_or_trigger_cannot_enter_reviewed_artifact(self):
        mutations = [('helpers.sql', 'create function public.unreviewed()returns void language sql as $$select 1$$;'),
                     ('seal.sql', 'grant select on controlled_stock_events to authenticated;'),
                     ('schema.sql', 'alter table stock_writer_admissions disable row level security;'),
                     ('guards.sql', 'alter table inventory_movements disable trigger controlled_stock_source_required;')]
        for name, sql in mutations:
            path = self.source / name
            original = path.read_bytes()
            try:
                path.write_bytes(original + ('\n' + sql + '\n').encode())
                with self.subTest(name=name), self.assertRaisesRegex(AssertionError, 'assembly source changed'):
                    ASSEMBLY.build_release(self.source, self.files)
            finally:
                path.write_bytes(original)

    def test_parent_source_adapters_are_bound_as_inputs(self):
        path = self.source.parent / 'source-reader.sql'
        self.mutation(path, path.read_bytes() + b'\n-- changed adapter\n')
        with self.assertRaisesRegex(AssertionError, 'assembly source changed'):
            ASSEMBLY.build_release(self.source, self.files)

    def test_pin_manifest_acl_rls_trigger_mutation_cannot_reseal_itself(self):
        path = self.source / ASSEMBLY.PIN_NAME
        original = path.read_bytes()
        for mutation in ['function', 'acl', 'rls', 'trigger', 'column_acl']:
            pin = json.loads(original)
            manifest = pin['expected_technical_manifest']
            if mutation == 'function': next(iter(manifest['functions'].values()))['sha256'] = '0' * 64
            elif mutation == 'acl': next(iter(manifest['relations'].values()))['acl'] = []
            elif mutation == 'rls': next(iter(manifest['relations'].values()))['rls'] = False
            elif mutation == 'column_acl':
                next(iter(manifest['relations'].values()))['columns'][0]['column_acl'] = [
                    {'grantee': 'authenticated', 'grantor': 'postgres', 'privilege': 'SELECT', 'grantable': True}]
            else: next(iter(manifest['relations'].values()))['triggers'] = []
            try:
                path.write_text(json.dumps(pin))
                with self.subTest(mutation=mutation), self.assertRaisesRegex(AssertionError, 'release pin changed'):
                    ASSEMBLY.build_release(self.source, self.files)
            finally:
                path.write_bytes(original)

    def test_original_prior_reference_and_snapshot_cannot_change(self):
        for name in ['trusted-prior-189.json', 'prior-snapshot.sql', 'release-expected-204-v1.json']:
            path = self.source / name
            original = path.read_bytes()
            try:
                path.write_bytes(original + b'\n')
                with self.subTest(name=name), self.assertRaises(AssertionError):
                    ASSEMBLY.build_release(self.source, self.files)
            finally:
                path.write_bytes(original)

    def column_manifest(self, entries):
        manifest = copy.deepcopy(self.baseline['expected_manifest'])
        next(iter(manifest['relations'].values()))['columns'][0]['column_acl'] = entries
        return manifest

    def test_direct_column_acl_normal_form_uses_role_labels_and_exact_grantability(self):
        entries = [{'grantee': role, 'grantor': 'postgres', 'privilege': 'SELECT', 'grantable': grantable}
                   for role, grantable in [('123', False), ('PUBLIC', False), ('Z_role', True), ('a_role', False), ('Å_role', True)]]
        # UTF-8 byte order is the promised SQL COLLATE C representation.
        self.assertEqual(entries, sorted(entries, key=lambda item: (item['grantee'].encode(), item['grantor'].encode(), item['privilege'].encode(), item['grantable'])))
        ASSEMBLY.validate_column_acl_manifest(self.column_manifest(entries))
        ASSEMBLY.validate_column_acl_manifest(self.column_manifest([]))

    def test_column_acl_missing_null_or_legacy_manifest_is_not_reviewable_v2(self):
        for missing in [True, False]:
            manifest = self.column_manifest([])
            column = next(iter(manifest['relations'].values()))['columns'][0]
            if missing: del column['column_acl']
            else: column['column_acl'] = None
            with self.subTest(missing=missing), self.assertRaises(AssertionError):
                ASSEMBLY.validate_column_acl_manifest(manifest)
        manifest = self.column_manifest([]); manifest['version'] = 1
        with self.assertRaises(AssertionError): ASSEMBLY.validate_column_acl_manifest(manifest)

    def test_column_acl_reordered_duplicate_or_conflicting_grant_option_is_rejected(self):
        entry = {'grantee': 'authenticated', 'grantor': 'postgres', 'privilege': 'SELECT', 'grantable': False}
        later = {**entry, 'grantee': 'service_role'}
        for entries in [[later, entry], [entry, entry], [entry, {**entry, 'grantable': True}]]:
            with self.subTest(entries=entries), self.assertRaises(AssertionError):
                ASSEMBLY.validate_column_acl_manifest(self.column_manifest(entries))

    def test_column_acl_cannot_use_oids_unknown_fields_or_nonboolean_grantability(self):
        entry = {'grantee': 'authenticated', 'grantor': 'postgres', 'privilege': 'SELECT', 'grantable': False}
        bad = [{**entry, 'grantee': 1234}, {**entry, 'grantee': ''}, {**entry, 'grantor': None},
               {**entry, 'privilege': 'DELETE'}, {**entry, 'grantable': 1},
               {**entry, 'grantable': 'false'}, {**entry, 'role_oid': 1234}]
        for value in bad:
            with self.subTest(value=value), self.assertRaises(AssertionError):
                ASSEMBLY.validate_column_acl_manifest(self.column_manifest([value]))

    def test_frozen_artifact_tamper_is_rejected_by_public_check(self):
        artifact = self.root / 'private.sql'
        artifact.write_text(self.baseline['install'])
        ASSEMBLY.check_release_artifact(self.source, self.files, artifact)
        artifact.write_text(self.baseline['install'] + '\ngrant all on controlled_stock_events to authenticated;\n')
        with self.assertRaisesRegex(AssertionError, 'artifact differs'):
            ASSEMBLY.check_release_artifact(self.source, self.files, artifact)

    def test_release_begins_with_exclusive_barrier_and_preddl_guards(self):
        sql = self.baseline['install']
        self.assertTrue(sql.startswith('begin;\nselect pg_advisory_xact_lock(90271040,0);\n'))
        schema = sql.index('create table public.controlled_stock_engine_manifests')
        for message in [ASSEMBLY.MESSAGES['ledger'], ASSEMBLY.MESSAGES['partial'], ASSEMBLY.MESSAGES['prior']]:
            self.assertLess(sql.index(message), schema)
        for object_kind in ['pg_class', 'pg_proc', 'pg_trigger']:
            self.assertIn(object_kind, sql[:schema])

    def test_expected_manifest_is_literal_and_no_adoption_call_survives(self):
        sql = self.baseline['install']
        self.assertNotIn('d:=controlled_stock_manifest_snapshot();', sql)
        self.assertIn('if controlled_stock_manifest_snapshot()is distinct from', sql)
        self.assertIn('insert into controlled_stock_engine_manifests(revision,definition,definition_hash)\n values(1,', sql)
        self.assertEqual(len(self.baseline['expected_manifest']['functions']), 171)
        self.assertEqual(len(self.baseline['expected_manifest']['relations']), 51)
        self.assertEqual(self.baseline['expected_manifest']['version'], 2)
        self.assertEqual(len(self.baseline['expected_writer_hooks']), 10)

    def test_mutation_markers_are_unique_and_in_order(self):
        sql = self.baseline['install']
        offsets = []
        for name in ['BEFORE_PREFLIGHT', 'AFTER_SCHEMA', 'AFTER_HOOKS', 'BEFORE_POSTCHECK', 'BEFORE_COMMIT']:
            marker = ASSEMBLY.MARKERS[name]
            self.assertEqual(sql.count(marker), 1)
            offsets.append(sql.index(marker))
        self.assertEqual(offsets, sorted(offsets))
        self.assertTrue(sql.endswith('commit;\n'))

    def test_all_hooks_marker_follows_the_entire_seal_and_its_native_triggers(self):
        sql = self.baseline['install']
        seal = (self.source / 'seal.sql').read_text().replace(
            'set search_path=public,pg_temp as $$', "set search_path=public,pg_temp set timezone='UTC' as $$")
        self.assertLessEqual(sql.index(seal) + len(seal), sql.index(ASSEMBLY.MARKERS['AFTER_HOOKS']))
        self.assertIn('create trigger controlled_stock_source_required', seal)

    def test_postcheck_mutation_boundary_cannot_be_healed_by_final_revocation(self):
        sql = self.baseline['install']
        marker = sql.index(ASSEMBLY.MARKERS['BEFORE_POSTCHECK'])
        self.assertLess(sql.index('end $release_revoke$;'), marker)
        self.assertGreater(sql.index('if controlled_stock_manifest_snapshot()is distinct from'), marker)
        self.assertGreater(sql.index(ASSEMBLY.MESSAGES['private']), marker)
        self.assertLess(sql.index(ASSEMBLY.MESSAGES['private']), sql.index(ASSEMBLY.MARKERS['BEFORE_COMMIT']))
        self.assertIn('has_any_column_privilege', sql[marker:])
        self.assertIn('aclexplode(col.attacl)', sql[marker:])
        self.assertIn('a.grantee<>c.relowner', sql[marker:])
        self.assertIn("array['anon','authenticated','service_role']", sql[marker:])
        self.assertIn('not c.relrowsecurity', sql[marker:])

    def test_all_sources_bound_without_self_referential_artifact_hashes(self):
        names = self.baseline['input_source_hashes']
        self.assertEqual(len(names), 204 + 14 + 2 + 2)
        self.assertFalse(any('release_assembly.py' in name or name.endswith('controlled-stock-private.sql') for name in names))
        self.assertIn(str((self.source / ASSEMBLY.PIN_NAME).relative_to(self.root)), names)


if __name__ == '__main__':
    unittest.main()
