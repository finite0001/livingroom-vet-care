"""Synthetic observation controls; genuine logout/login still requires GoTrue."""
from copy import deepcopy
from unittest import TestCase,main
from receiver_reauthentication import auth_projection,original_rows,other_auth_rows


class ReplacementAuthObservationControls(TestCase):
    def test_original_rows_only_permit_selected_login_timestamps(self):
        before=dict(stable_users={'A':'stable-A','B':'stable-B'},tables={
            'users':{'A':'original-A','B':'before-B'},'sessions':{'original':'original-session'}})
        after=deepcopy(before);after['tables']['users']['B']='new-login-timestamps'
        original_rows(before,after,login_actor='B')
        for table,key in [('users','A'),('sessions','original')]:
            changed=deepcopy(after);changed['tables'][table][key]='changed'
            with self.assertRaises(ValueError):original_rows(before,changed,login_actor='B')
        changed=deepcopy(after);changed['stable_users']['B']='changed-password-or-profile'
        with self.assertRaises(ValueError):original_rows(before,changed,login_actor='B')

    def test_tables_outside_six_auth_effects_cannot_change(self):
        before={'relations':{'auth.users':['old'],'auth.one_time_tokens':['original-token'],
                             'public.pets':['original-pet']}}
        after=deepcopy(before);after['relations']['auth.users']=['login-change']
        other_auth_rows(before,after)
        for table in ('auth.one_time_tokens','public.pets'):
            changed=deepcopy(after);changed['relations'][table]=['changed']
            with self.assertRaises(ValueError):other_auth_rows(before,changed)
        changed=deepcopy(after);changed['relations']['auth.unexpected']=['extra']
        with self.assertRaises(ValueError):other_auth_rows(before,changed)

    def test_final_projection_includes_every_auth_table_and_sequence(self):
        data=dict(relations={'auth.users':['user'],'auth.one_time_tokens':['token'],'public.pets':['pet']},
                  sequences={'auth.refresh_tokens_id_seq':{'last_value':10},'public.events_seq':{'last_value':2}})
        self.assertEqual(auth_projection(data),dict(relations={'auth.users':['user'],'auth.one_time_tokens':['token']},
                         sequences={'auth.refresh_tokens_id_seq':{'last_value':10}}))


if __name__=='__main__':main()
