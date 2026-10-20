"""Evaluate current inventory assertions without importing disposable runtimes."""
import ast
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
FILENAME = '20261020151157_controlled_stock_private_engine.sql'
VERSION = '20261020151157'
RUNTIMES = [
    'tests/invoice-reminders/disposable.py', 'tests/clinical-audio/disposable.py',
    'tests/clinical-notes/disposable.py', 'tests/clinical-calls/disposable.py',
    'tests/clinical-dictation/disposable.py', 'tests/clinical-recap/disposable.py',
    'tests/clinical-recap/evaluation-local.py', 'tests/imaging/disposable.py',
    'tests/scheduling/disposable.py', 'tests/diagnostics/local-disposable.py',
    'tests/diagnostics/pdf-jobs-disposable.py', 'tests/diagnostics/pdf-registration-disposable.py',
    'tests/prescriptions/native-disposable.py', 'tests/ezyvet/attachment-metadata-disposable.py',
    'tests/clinical-call-notes/disposable.py', 'tests/clinical-call-generation/disposable.py',
    'scripts/restore-rehearsal/run.py',
]


def guard_expressions(path):
    tree = ast.parse(path.read_text())
    guards = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assert):
            continue
        text = ast.unparse(node.test)
        if ((any('len(' + name + ')' in text for name in ['files', 'hashes', 'migrations', 'versions'])
             and ('205' in text or 'CURRENT_RESTORE_MIGRATION_COUNT' in text))
                or FILENAME in text):
            guards.append(compile(ast.Expression(node.test), str(path), 'eval'))
    assert guards, path
    return guards


def evaluate(path, files):
    versions = {p.name.split('_')[0] for p in files}
    names = {p.name: 'reviewed-by-source-binding' for p in files}
    new_name = ('20261017135245_clinical_call_note_sources.sql'
                if 'clinical-call-notes' in str(path) else '20261018150000_clinical_call_quote_anchors.sql')
    context = {'files': files, 'migrations': files, 'hashes': names, 'versions': versions,
               'migration_hashes': names, 'new_migration': ROOT / 'supabase/migrations' / new_name,
               'migration_files': files, 'CURRENT_RESTORE_MIGRATION_COUNT': 205}
    return all(eval(code, {'__builtins__': {'len': len, 'set': set}}, context) for code in guard_expressions(path))


class CurrentCanonicalInventoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.files = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
        assert len(cls.files) == 205 and cls.files[-1].name == FILENAME

    def test_all_current_python_inventory_guards_accept_exact_205(self):
        for name in RUNTIMES:
            with self.subTest(path=name):
                self.assertTrue(evaluate(ROOT / name, self.files))

    def test_204_or_206_inventory_cannot_be_mistaken_for_current(self):
        for name in RUNTIMES:
            for files in [self.files[:-1], self.files + [self.files[-1].with_name('20261021120000_extra.sql')]]:
                with self.subTest(path=name, count=len(files)):
                    self.assertFalse(evaluate(ROOT / name, files))

    def test_equal_count_wrong_latest_filename_or_version_is_rejected(self):
        for name in RUNTIMES:
            for replacement in ['20261020151157_wrong_name.sql', '20261020151158_controlled_stock_private_engine.sql']:
                files = self.files[:-1] + [self.files[-1].with_name(replacement)]
                with self.subTest(path=name, replacement=replacement):
                    self.assertFalse(evaluate(ROOT / name, files))

    def test_restore_suffix_exactly_covers_current_new_versions(self):
        tree = ast.parse((ROOT / 'scripts/restore-rehearsal/run.py').read_text())
        value = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
                     and any(isinstance(t, ast.Name) and t.id == 'new_versions' for t in n.targets))
        self.assertEqual(value[-1], VERSION)
        self.assertEqual(len(value), len(set(value)))
        self.assertEqual(value, [p.name.split('_')[0] for p in self.files if p.name.split('_')[0] >= value[0]])

    def test_call_notes_still_preserves_201_seed_and_source_migration(self):
        source = (ROOT / 'tests/clinical-call-notes/disposable.py').read_text()
        tree = ast.parse(source)
        selected = next(n for n in ast.walk(tree) if isinstance(n, ast.Assign)
                        and any(isinstance(t, ast.Name) and t.id == 'selected' for t in n.targets))
        value = eval(compile(ast.Expression(selected.value), '<selected>', 'eval'),
                     {'__builtins__': {}}, {'migrations': self.files, 'args': type('Args', (), {'sql_only': False})(),
                      'new_migration': ROOT / 'supabase/migrations/20261017135245_clinical_call_note_sources.sql'})
        self.assertEqual(len(value), 201)
        self.assertIn("'baseline_migrations': 201", source)
        self.assertIn('new_migration in migrations', source)


if __name__ == '__main__':
    unittest.main()
