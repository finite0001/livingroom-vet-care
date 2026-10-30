"""Synthetic observation controls only; no Auth or browser acceptance."""
from copy import deepcopy
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from operational_browser import original_auth_rows, node_exit_status, finish_owned_node


class OperationalAuthObservationControls(unittest.TestCase):
    def setUp(self):
        self.before = dict(stable_users={'A': 'stable-A', 'B': 'stable-B'}, tables={
            'users': {'A': 'before-A', 'B': 'before-B'}, 'identities': {'A': 'identity-A', 'B': 'identity-B'},
            **{name: {'original': 'old'} for name in ('sessions', 'refresh_tokens', 'mfa_amr_claims', 'audit_log_entries')}})
        self.after = deepcopy(self.before)
        self.after['tables']['users']['A'] = 'actual-new-login-timestamps'
        for name in ('sessions', 'refresh_tokens', 'mfa_amr_claims', 'audit_log_entries'):
            self.after['tables'][name]['new'] = 'new-row'

    def test_exact_one_login_observation_preserves_original_rows(self):
        original_auth_rows(self.before, self.after, 'A')

    def test_old_row_change_or_stable_user_change_refuses(self):
        for table, key in [('users', 'B'), ('identities', 'A'), ('sessions', 'original'), ('refresh_tokens', 'original')]:
            changed = deepcopy(self.after); changed['tables'][table][key] = 'changed'
            with self.assertRaises(ValueError): original_auth_rows(self.before, changed, 'A')
        changed = deepcopy(self.after); changed['stable_users']['A'] = 'changed password or profile'
        with self.assertRaises(ValueError): original_auth_rows(self.before, changed, 'A')

    def test_new_user_extra_session_or_deleted_original_refuses(self):
        for table in self.after['tables']:
            changed = deepcopy(self.after); changed['tables'][table]['unexpected'] = 'extra'
            with self.assertRaises(ValueError): original_auth_rows(self.before, changed, 'A')
        changed = deepcopy(self.after); del changed['tables']['sessions']['original']
        with self.assertRaises(ValueError): original_auth_rows(self.before, changed, 'A')


@unittest.skipUnless(hasattr(__import__('os'),'WNOWAIT'),'requires unreaped-leader observation')
class BrowserOwnerControls(unittest.TestCase):
    def test_completed_node_leader_cannot_leave_closed_pipe_descendant(self):
        with tempfile.TemporaryDirectory() as folder:
            marker=Path(folder)/'escaped'
            child='import time;from pathlib import Path;time.sleep(1);Path('+repr(str(marker))+').touch()'
            code='import subprocess,sys;subprocess.Popen([sys.executable,"-I","-B","-c",'+repr(child)+'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)'
            process=subprocess.Popen([sys.executable,'-I','-B','-c',code],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
            try:
                end=time.monotonic()+2
                while node_exit_status(process)is None and time.monotonic()<end:time.sleep(0.01)
                self.assertEqual(node_exit_status(process),0)
                self.assertIsNone(process.returncode,'completion observation must not reap the reserved leader')
            finally:finish_owned_node(process)
            time.sleep(1.1)
            self.assertFalse(marker.exists())


if __name__ == '__main__': unittest.main()
