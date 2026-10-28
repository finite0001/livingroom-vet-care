"""Real independent A/W Auth C2 path with current source and terminal fences."""
from copy import deepcopy
from hashlib import sha256
import full121_values as v
import full121_queries as sql
import full121_gateway as gateway
import full121_exact_json as exact_json
from full121_boundary_evidence import capture,exact_response,posted_receipt
RPCS=gateway.RPCS+('read_current_stock_policy_v1','prepare_controlled_stock_administration_v1','execute_controlled_stock_administration_v1',
 'list_managed_stock_witness_tasks_v1','read_managed_stock_witness_v1','attest_managed_stock_witness_v1','read_managed_stock_witness_operation_v1','close_managed_stock_witness_operation_v1','read_managed_stock_witness_status_v1')

def witness_reply(p,r,state):
 v.keys(r,('schema_version','state','data'));d=v.keys(r['data'],('pointer','preparation','preparation_digest','recorder','receipt','blocked_reason'))
 if r['schema_version']!=1 or r['state']!=state or d['pointer']!=p:raise ValueError('Actual witness pointer/state differs')
 if state in('available','saved')and(d['preparation']is None or d['recorder']['id']==p['actor_id']or d['preparation']['id']!=p['parent_action_id']or d['preparation']['actor_id']!=d['recorder']['id']or d['blocked_reason']is not None):raise ValueError('Actual witness full original parent/independence differs')
 return deepcopy(r)
def witness_receipt(q,r):
 v.keys(r,tuple(k for k in q if k!='attest_witness')+('action','recorded_at','receipt_digest'))
 body={**{k:x for k,x in q.items()if k!='attest_witness'},'action':'witness_attest','recorded_at':v.instant(r['recorded_at'])}
 if r!={**body,'receipt_digest':v.digest('lrv-controlled-stock-witness-receipt-v1',body)}:raise ValueError('Actual witness receipt independent frame differs')
 return deepcopy(r)
def run(ctx,m,runtime,folder,query,save):
 if 'witness'in ctx:raise ValueError('Witness stage cannot run twice')
 a,w=ctx['users'];http=ctx['http'];ids=ctx['ids'];steps=[]
 if a['id']==w['id']or a['session_id']==w['session_id']:raise ValueError('Actual independent Auth identities/sessions required')
 def rpc(label,name,q,user):
  if name not in RPCS:raise ValueError('Fixed C2 API required')
  runtime.remaining(1);r=http.rpc(name,{'p_request':q},user);save(folder,'witness-'+label,r);steps.append(dict(label=label,rpc=name,actor_id=user['id'],session_id=user['session_id']));return r
 scope=dict(schema_version=1,actor_id=a['id'],product_id=ids['product'],site_id=ids['site'])
 current=rpc('current-policy','read_current_stock_policy_v1',scope,a)['data'];policy=deepcopy(current['policy']);policy['permissions']['adjust_inventory']['witness']='c2_required';policy['review_reference']=v.NOTE+' Explicit independent witness scenario.'
 pp=v.pointer('stock_policy',a['id'],v.uid(),ids['product'],ids['site']);pq={**pp,'definition':dict(draft_version_id=current['current_draft_version_id'],expected_policy_version_id=current['policy_version_id'],policy=policy,reason=v.NOTE)}
 prepared_policy=v.verify_admin(rpc('policy-prepare','prepare_controlled_stock_administration_v1',pq,a),pp,pq,'prepared')
 saved_policy=v.verify_admin(rpc('policy-execute','execute_controlled_stock_administration_v1',pp,a),pp,pq,'saved')
 op=v.uid();p=gateway.pointer(ctx,a,op);probe_request=gateway.request(ctx,a,op)
 o=gateway.check_probe(probe_request,rpc('probe','probe_controlled_stock_intent_v1',probe_request,a),ctx,'c2_required')
 q={**p,'legacy_arguments':probe_request['legacy_arguments'],'context':gateway.context(ctx,o,query('witness-observation-clock',sql.clock())['at'])}
 prep=gateway.reply(p,rpc('A-prepare','prepare_managed_stock_intent_v1',q,a),'prepared',probe_request['legacy_arguments'])
 # Transport owns protected exact raw bytes, captured before normal JSON parse.
 # This new fixed transport API is a mandatory framework dependency, not a stub.
 original_raw=exact_response(http,'prepare_managed_stock_intent_v1');original=exact_json.immutable_preparation(exact_json.decode(original_raw)['data']['preparation'])
 before=capture(ctx,m,runtime,'witness-before-attestation')
 status=rpc('A-required','read_managed_stock_witness_status_v1',p,a)
 if status['state']!='required'or status['data']['witness']is not None:raise ValueError('Actual parent did not require independent witness')
 before_positions=query('witness-before-refused-execute',sql.opening(ids['product'],ids['site']))
 code,error=http.post('/rest/v1/rpc/execute_managed_stock_intent_v1',{'p_request':p},a['token']);save(folder,'witness-unattested-execute-refusal',dict(status=code,error=error))
 if code!=400 or error!=dict(code='P0001',details='',hint='',message='stock_entry_request_failed'):raise ValueError('Unattested execution was not exactly refused')
 if query('witness-after-refused-execute',sql.opening(ids['product'],ids['site']))!=before_positions:raise ValueError('Unattested refusal changed physical state')
 tasks=rpc('W-task-list','list_managed_stock_witness_tasks_v1',dict(schema_version=1,actor_id=w['id'],cursor=None,page_size=100),w)
 if tasks['has_more']or tasks['next_cursor']is not None or [x['parent_action_id']for x in tasks['items']]!=[op]or tasks['items'][0]['recorder']['id']!=a['id']:raise ValueError('Actual independent task not discoverable')
 wp=dict(schema_version=1,actor_id=w['id'],operation_id=v.uid(),parent_action_id=op,writer='adjust_inventory',product_id=ids['product'],event_kind='adjust_inventory')
 available=witness_reply(wp,rpc('W-full-review','read_managed_stock_witness_v1',wp,w),'available');wraw=exact_response(http,'read_managed_stock_witness_v1');wprojection=exact_json.decode(wraw)['data']['preparation']
 if exact_json.pg_text(original)!=exact_json.pg_text(wprojection)or exact_json.preparation_digest(wprojection)!=available['data']['preparation_digest']:raise ValueError('Actual W preparation changed original numeric spelling/body or digest')
 wrong={**wp,'actor_id':a['id'],'operation_id':v.uid()}
 code,error=http.post('/rest/v1/rpc/read_managed_stock_witness_v1',{'p_request':wrong},a['token']);save(folder,'witness-self-refusal',dict(status=code,error=error))
 if code!=400 or error!=dict(code='P0001',details='',hint='',message='stock_witness_request_failed'):raise ValueError('Recorder self-witness READ did not refuse')
 # Close a distinct unsent W operation on the actual parent. Delayed
 # attestation for that exact owned pointer must fail; it does not consume a
 # different genuine W operation or manufacture a source observation.
 abandoned_wp={**wp,'operation_id':v.uid()}
 witness_reply(abandoned_wp,rpc('W-unsent-recovery','read_managed_stock_witness_operation_v1',abandoned_wp,w),'not_found')
 witness_reply(abandoned_wp,rpc('W-unsent-close','close_managed_stock_witness_operation_v1',abandoned_wp,w),'abandoned')
 delayed_attest={**abandoned_wp,'preparation_digest':available['data']['preparation_digest'],'attest_witness':True}
 code,error=http.post('/rest/v1/rpc/attest_managed_stock_witness_v1',{'p_request':delayed_attest},w['token']);save(folder,'witness-late-attest-refusal',dict(status=code,error=error))
 if code!=400 or error!=dict(code='P0001',details='',hint='',message='stock_witness_request_failed'):raise ValueError('Terminally abandoned W operation accepted delayed attestation')
 witness_reply(abandoned_wp,rpc('W-abandoned-recovery','read_managed_stock_witness_operation_v1',abandoned_wp,w),'abandoned')
 attestation={**wp,'preparation_digest':available['data']['preparation_digest'],'attest_witness':True};save(folder,'witness-attestation-request',attestation)
 wr=witness_receipt(attestation,rpc('W-attest','attest_managed_stock_witness_v1',attestation,w))
 after_attest=capture(ctx,m,runtime,'witness-after-attestation')
 if before['sha256']!=after_attest['sha256']:raise ValueError('Pending witness incorrectly changed posted-event PB50')
 recovered=witness_reply(wp,rpc('W-owned-recovery','read_managed_stock_witness_operation_v1',wp,w),'saved')
 if recovered['data']['receipt']!=wr:raise ValueError('Actual owned witness recovery differs')
 closed=witness_reply(wp,rpc('W-close-saved','close_managed_stock_witness_operation_v1',wp,w),'saved')
 if closed['data']['receipt']!=wr:raise ValueError('Closing saved witness changed attestation')
 status=rpc('A-witnessed','read_managed_stock_witness_status_v1',p,a)
 if status['state']!='witnessed'or status['data']['witness']['actor_id']!=w['id']or status['data']['witness']['operation_id']!=wp['operation_id']:raise ValueError('Actual A status does not name independent W')
 saved=gateway.reply(p,rpc('A-execute','execute_managed_stock_intent_v1',p,a),'saved',probe_request['legacy_arguments'])
 canonical_raw=exact_response(http,'execute_managed_stock_intent_v1')
 posted=posted_receipt(ctx,m,runtime,'witness-posted-receipt',op,canonical_raw)
 after_execute=capture(ctx,m,runtime,'witness-after-execute')
 if before['sha256']==after_execute['sha256']:raise ValueError('Witnessed posting absent from complete PB50')
 after_positions=query('witness-after-execute-positions',sql.opening(ids['product'],ids['site']))
 if before_positions['positions']!=[dict(cell_id=ids['cell'],quantity='20.000')]or after_positions['positions']!=[dict(cell_id=ids['cell'],quantity='21.000')]:raise ValueError('Witnessed canonical +1 physical posting differs')
 final=gateway.reply(p,rpc('A-owned-recovery','read_managed_stock_intent_v1',p,a),'saved',probe_request['legacy_arguments'])
 if final['data']['receipt']!=saved['data']['receipt']:raise ValueError('Actual A recovery changed canonical result')
 if witness_reply(wp,rpc('W-after-post-recovery','read_managed_stock_witness_operation_v1',wp,w),'saved')['data']['receipt']!=wr:raise ValueError('Posting invalidated saved historical attestation')
 proof=dict(parent_pointer=p,parent_request=q,prepared=prep['data']['preparation'],policy_request=pq,policy_receipt=saved_policy['data']['receipt'],witness_pointer=wp,abandoned_witness_pointer=abandoned_wp,late_attestation=delayed_attest,attestation=attestation,witness_receipt=wr,canonical_receipt=saved['data']['receipt'],captures=dict(before=before,after_attestation=after_attest,after_execute=after_execute),steps=steps,posted_exact_receipt=posted)
 ctx['witness']=deepcopy(proof);save(folder,'full121-witness-proof',proof);return proof
