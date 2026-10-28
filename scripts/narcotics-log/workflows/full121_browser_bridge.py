"""Private source handoff only; owning framework launches fixed portable V2.

Initial A+B password grants, real B re-login in count prefix, then real SDK A
LoginPage session. No preloaded JWT/session/credentials in harness initScript.
"""
from copy import deepcopy
import full121_values as v
import full121_count_pair as count_pair

def run(ctx,m,runtime,folder,query,save):
 if 'browser_handoff'in ctx:raise ValueError('Browser phase cannot be handed off twice')
 prefix=count_pair.pair(ctx,m,runtime,folder,query,save,'agreement',True)
 a,b=ctx['users'];current_b=ctx['current_actors'][b['id']]
 sessions=[a['session_id'],b['session_id'],current_b['session_id']]
 if len(set(sessions))!=3 or current_b['id']!=b['id']:raise ValueError('Exact genuine three-session prefix differs')
 # The framework's fixed public anonymous key is DATA from its admitted local
 # setup. This module never reads environment, credentials file or service key.
 anon=ctx['public_anon_key']
 if type(anon)is not str or not anon:raise ValueError('Fixed local public anon key required')
 private_input=dict(origin='http://127.0.0.1:64661',anonKey=anon,actorId=a['id'],scope=dict(product_id=ctx['ids']['product'],site_id=ctx['ids']['site']),countId=prefix['count_id'],login=dict(email=a['email'],password=a['private_password']))
 handoff=dict(driver_directory='count-authenticated-finalize-browser-v2',driver_manifest_sha256='c823bd547c39236fe8540dbcb57b41b2af1782ae108b742f1a02992de6943df5',driver_ready_sha256='9247b69704d73639019a9df197afd729d5f5807f15761f91a8c81f0d7d16cc68',private_input=private_input,
  proof_directory_basename='browser-count-finalize-proof',browser_budget_seconds=120,cleanup_reserve_seconds=30,
  initial_auth_sessions=[dict(actor_id=a['id'],session_id=a['session_id'],source='initial_password_A'),dict(actor_id=b['id'],session_id=b['session_id'],source='initial_password_B'),dict(actor_id=b['id'],session_id=current_b['session_id'],source='genuine_password_B_relogin')],
  auth_phase=dict(kind='auth-phase',expected_actor_id=a['id'],must_differ_session_ids=sessions,expected_total_sessions=4),
  read_phase=dict(kind='read-phase',count_id=prefix['count_id'],snapshot_id=prefix['snapshot_id'],expected_history='collecting',expected_comparison_agreement=True),
  business_sequence=['list_controlled_count_scopes_v1','discover_controlled_counts_v1','read_controlled_count_v1','finalize_controlled_count_v1','read_controlled_count_operation_closure_v1','discover_controlled_counts_v1','read_controlled_count_v1'])
 ctx['browser_handoff']=deepcopy(handoff);save(folder,'browser-private-handoff',handoff);return handoff

def auth4_vector(ctx,sdk_actor):
 """Expected identity/session membership, not an Auth observation/certification.

 Full auth.users/auth.sessions/refresh_tokens/identity/audit snapshots and exact
 native IDs/order/types remain framework source expectations derived separately.
 """
 a,b=ctx['users'];current_b=ctx['current_actors'][b['id']]
 if sdk_actor['id']!=a['id']or sdk_actor['session_id']in{a['session_id'],b['session_id'],current_b['session_id']}:raise ValueError('Actual SDK login is not a fresh same-A fourth session')
 return [dict(actor_id=a['id'],session_id=v.uid(a['session_id']),source='initial_password_A'),dict(actor_id=b['id'],session_id=v.uid(b['session_id']),source='initial_password_B'),dict(actor_id=b['id'],session_id=v.uid(current_b['session_id']),source='genuine_password_B_relogin'),dict(actor_id=a['id'],session_id=v.uid(sdk_actor['session_id']),source='real_LoginPage_SDK_A')]
