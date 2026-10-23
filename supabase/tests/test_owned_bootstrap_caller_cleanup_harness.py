"""Execute real caller finalizers with inert command callbacks; never start a DB."""
import ast
import contextlib
import io
import json
from pathlib import Path
import shutil
import tempfile
from types import SimpleNamespace
import unittest


ROOT=Path(__file__).resolve().parents[2]
CALLERS=tuple('tests/'+name+'/disposable.py'for name in (
    'clinical-notes','clinical-audio','clinical-dictation','clinical-recap',
    'clinical-calls','clinical-call-generation','clinical-call-notes','imaging','invoice-reminders'))


class Output(str):
    @property
    def stdout(self):return str(self)


class OwnedBootstrapCallerCleanupTests(unittest.TestCase):
    def exercise(self,name,started,stop_fails=False,helper_error=False):
        tree=ast.parse((ROOT/name).read_text(),filename=name)
        blocks=[node for node in tree.body if isinstance(node,ast.Try) and node.finalbody]
        self.assertEqual(len(blocks),1,'Exact outer runtime finalizer required')
        finalizer=blocks[0].finalbody
        if helper_error:
            body=ast.parse("raise RuntimeError('helper bootstrap failed')").body
            finalizer=[ast.Try(body=body,handlers=[],orelse=[],finalbody=finalizer)]
        code=compile(ast.fix_missing_locations(ast.Module(body=finalizer,type_ignores=[])),name,'exec')
        with tempfile.TemporaryDirectory(prefix='owned-caller-finalizer-test-')as folder:
            root=Path(folder);work=root/'work';project=work/'project'
            (project/'supabase').mkdir(parents=True)
            config=project/'supabase/config.toml';config.write_text('project_id = "owned_fixture"\n')
            original=config.read_bytes();private=root/'private';private.mkdir()
            calls=[];removals=[];proof={'owned_runtime_removed':False};log=io.StringIO();output=io.StringIO()
            def run(argv,**kwargs):
                calls.append(argv)
                if not started:raise AssertionError('Failed bootstrap must not stop or inspect resources')
                if stop_fails and argv[:2]==['supabase','stop']:raise RuntimeError('stop failed')
                return Output('')
            def remove(path):removals.append(path);shutil.rmtree(path)
            env=dict(started=started,run=run,project=project,identity='owned_fixture',work=work,
                shutil=SimpleNamespace(rmtree=remove),proof=proof,root=root,private=private,
                args=SimpleNamespace(sql_only=True,evidence_prefix='fixture'),json=json,Path=Path,log=log)
            with contextlib.redirect_stdout(output):
                if helper_error or stop_fails:
                    with self.assertRaisesRegex(RuntimeError,'helper bootstrap failed'if helper_error else'stop failed'):
                        exec(code,env)
                else:exec(code,env)
            self.assertTrue(log.closed)
            if not started or stop_fails:
                self.assertTrue(work.exists());self.assertEqual(config.read_bytes(),original)
                self.assertEqual(removals,[]);self.assertIs(proof['owned_runtime_removed'],False)
                self.assertNotIn('removed.',output.getvalue());self.assertNotIn('"owned_runtime_removed": true',output.getvalue())
                self.assertEqual(list(root.rglob('*proof.json')),[])
                if not started:
                    self.assertEqual(calls,[])
                    self.assertIn('private work/config retained: '+str(work),output.getvalue())
            else:
                self.assertEqual(removals,[work]);self.assertFalse(work.exists())
                self.assertEqual(sum(argv[:2]==['supabase','stop']for argv in calls),1)
                self.assertIs(proof['owned_runtime_removed'],True)
                self.assertEqual(len(list(root.rglob('*proof.json'))),1)
                self.assertIn('removed.',output.getvalue())

    def test_failed_bootstrap_retains_config_and_never_claims_cleanup(self):
        for name in CALLERS:
            with self.subTest(caller=name):self.exercise(name,False)

    def test_original_helper_failure_survives_finalization(self):
        for name in CALLERS:
            with self.subTest(caller=name):self.exercise(name,False,helper_error=True)

    def test_completed_bootstrap_retains_existing_successful_cleanup(self):
        for name in CALLERS:
            with self.subTest(caller=name):self.exercise(name,True)

    def test_stop_failure_preserves_config_and_never_writes_success_receipt(self):
        for name in CALLERS:
            with self.subTest(caller=name):self.exercise(name,True,stop_fails=True)


if __name__=='__main__':unittest.main()
