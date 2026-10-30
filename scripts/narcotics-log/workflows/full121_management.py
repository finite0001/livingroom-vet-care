"""Actual variance→independent approval→physical adjustment→confirmation→resolution.

SOURCE/UNRUN. All cause/reconciliation IDs come from public source projections,
not owner SQL selection. Synthetic count21 versus actual engineering stock20.
"""
from copy import deepcopy
import full121_values as v
import full121_queries as sql
import full121_count_pair as count_pair
from full121_boundary_evidence import capture
MUTATIONS={'reconciliation_prepare':'prepare_controlled_count_reconciliation_v1','reconciliation_approve':'approve_controlled_count_reconciliation_v1','reconciliation_execute':'execute_controlled_count_reconciliation_v1','reconciliation_confirm':'confirm_controlled_count_reconciliation_v1','cause_resolve':'resolve_controlled_count_cause_v1'}
RPCS=tuple(MUTATIONS.values())+('discover_controlled_count_causes_v1','list_controlled_count_investigations_v1','list_controlled_count_reconciliations_v1','read_controlled_count_reconciliation_detail_v1','read_controlled_count_reconciliation_v1')
RESULTS={'reconciliation_prepare':('reconciliation_preparation','preparation_id'),'reconciliation_approve':('reconciliation_approval','approval_id'),'reconciliation_execute':('reconciliation_execution','execution_id'),'reconciliation_confirm':('reconciliation_confirmation','confirmation_id'),'cause_resolve':('cause_resolution','resolution_id')}
def receipt(action,q,r):
 v.keys(r,('schema_version','action','actor_id','operation_id','product_id','site_id','request_digest','result_ref','receipt_digest'))
 if any(r[k]!=q[k]for k in('schema_version','actor_id','operation_id','product_id','site_id'))or r['action']!=action:raise ValueError('Management receipt scope/operation differs')
 ref=v.keys(r['result_ref'],('kind','id','opaque_commitment'));kind,key=RESULTS[action]
 if ref['kind']!=kind or ref['id']!=q[key]or type(ref['opaque_commitment'])is not str or len(ref['opaque_commitment'])!=64 or any(c not in'0123456789abcdef'for c in ref['opaque_commitment']):raise ValueError('Management closed result reference differs')
 if r['request_digest']!=v.digest('lrv-controlled-count-management-request-v1',dict(action=action,request=q))or r['receipt_digest']!=v.digest('lrv-controlled-count-management-public-receipt-v1',{k:x for k,x in r.items()if k!='receipt_digest'}):raise ValueError('Management independent frame differs')
 return deepcopy(r)
def run(ctx,m,runtime,folder,query,save):
 if 'management'in ctx:raise ValueError('Management stage cannot run twice')
 a,b=ctx['users'];ids=ctx['ids'];http=ctx['http'];steps=[];saved=[]
 def scope(user):return dict(schema_version=1,actor_id=user['id'],product_id=ids['product'],site_id=ids['site'])
 def rpc(label,name,q,user):
  if name not in RPCS:raise ValueError('Fixed staff management API required')
  runtime.remaining(1);r=http.rpc(name,{'p_request':q},user);save(folder,'management-'+label,r);steps.append(dict(label=label,rpc=name,actor_id=user['id'],session_id=user['session_id']));return r
 def mutate(label,action,user,**extra):
  q={**scope(user),'operation_id':v.uid(),**extra};save(folder,'management-'+label+'-request',q)
  r=receipt(action,q,rpc(label,MUTATIONS[action],q,user));saved.append(dict(action=action,request=q,receipt=r));return q,r
 # Real observed variance is created by actual independent manual-count API
 # calls; it does not falsify a real clinical observation in this isolated test.
 count_pair.pair(ctx,m,runtime,folder,query,save,'variance')
 variance=count_pair.finalize(ctx,m,runtime,folder,query,save,'variance')
 discovered=rpc('eligible-causes','discover_controlled_count_causes_v1',scope(a),a)
 expected_cause=dict(source_count_id=variance['count_id'],source_outcome_id=variance['finalize']['request']['outcome_id'],category='terminal_variance')
 if discovered['state']!='eligible'or len(discovered['data']['causes'])!=1:raise ValueError('Real variance not publicly discoverable as complete eligible O')
 cause=discovered['data']['causes'][0];v.uid(cause['cause_id'])
 if {k:cause[k]for k in expected_cause}!=expected_cause:raise ValueError('Discovered cause does not name the actual source count/outcome')
 footprint=dict(cell_id=ids['cell'],container_id=ids['container'],lot_id=ids['lot'],site_id=ids['site'],location_id=ids['location'],stock_unit='tablet',channel='available')
 if discovered['data']['footprint']!=footprint:raise ValueError('Cause has different source-supported complete available footprint')
 investigations=rpc('investigations','list_controlled_count_investigations_v1',dict(**scope(a),cursor=None,page_size=100),a)
 if investigations['has_more']or not any(x['cause_id']==cause['cause_id']for x in investigations['items']):raise ValueError('Authorized staff investigation list omits unresolved cause')
 reconciliation=v.uid();preparation=v.uid();parent=v.uid();before=capture(ctx,m,runtime,'management-before-prepare')
 pq,pr=mutate('prepare','reconciliation_prepare',a,reconciliation_id=reconciliation,preparation_id=preparation,parent_action_id=parent,target_cause_ids=[cause['cause_id']],lot_id=ids['lot'],quantity_delta='1',reason=v.NOTE)
 after_prepare=capture(ctx,m,runtime,'management-after-prepare')
 if before['sha256']!=after_prepare['sha256']:raise ValueError('Unexecuted parent preparation changed event-owned PB50')
 listed=rpc('B-discover-prepared','list_controlled_count_reconciliations_v1',dict(**scope(b),cursor=None,page_size=100),b)
 if listed['has_more']or [x['reconciliation_id']for x in listed['items']]!=[reconciliation]:raise ValueError('Independent reviewer cannot discover actual prepared correction')
 readq={**scope(b),'reconciliation_id':reconciliation}
 detail=rpc('B-review-detail','read_controlled_count_reconciliation_detail_v1',readq,b)
 if detail['state']!='available'or detail['data']['summary']['reconciliation_id']!=reconciliation:raise ValueError('Actual READ evidence belongs to another correction')
 if detail['data']['before_quantity']!='20.000'or detail['data']['proposed_after_quantity']!='21.000'or detail['data']['target_causes']!=[dict(cause_id=cause['cause_id'],source_count_id=variance['count_id'],source_outcome_id=variance['finalize']['request']['outcome_id'])]or detail['data']['meaning']!=discovered['data']['meaning']:raise ValueError('Actual captured physical correction meaning/quantity/source refs differ')
 summary=rpc('B-read-prepared','read_controlled_count_reconciliation_v1',readq,b)
 if summary['data']['history_state']!='prepared'or summary['data']['parent_action_id']!=parent or summary['data']['target_cause_ids']!=[cause['cause_id']]:raise ValueError('Actual immutable prepared summary differs')
 approval=v.uid();aq,ar=mutate('B-approve','reconciliation_approve',b,approval_id=approval,preparation_id=preparation)
 after_approval=capture(ctx,m,runtime,'management-after-approval')
 if before['sha256']!=after_approval['sha256']:raise ValueError('Nonphysical approval changed event-owned PB50')
 before_positions=query('management-before-posting',sql.opening(ids['product'],ids['site']))
 execution=v.uid();eq,er=mutate('A-execute','reconciliation_execute',a,execution_id=execution,preparation_id=preparation,approval_id=approval)
 after_execute=capture(ctx,m,runtime,'management-after-execute')
 if before['sha256']==after_execute['sha256']:raise ValueError('Actual parent canonical correction missing from PB50')
 positions=query('management-after-posting',sql.opening(ids['product'],ids['site']))
 if before_positions['positions']!=[dict(cell_id=ids['cell'],quantity='20.000')]or positions['positions']!=[dict(cell_id=ids['cell'],quantity='21.000')]:raise ValueError('Actual correction differs from selected physical observation21/delta+1')
 confirmation=v.uid();cq,cr=mutate('B-confirm','reconciliation_confirm',b,confirmation_id=confirmation,execution_id=execution)
 postconfirm=capture(ctx,m,runtime,'management-after-confirmation')
 if after_execute['sha256']!=postconfirm['sha256']:raise ValueError('Nonphysical confirmation changed PB50')
 count_pair.pair(ctx,m,runtime,folder,query,save,'post_reconciliation')
 agreement=count_pair.finalize(ctx,m,runtime,folder,query,save,'post_reconciliation')
 resolution=v.uid();rq,rr=mutate('resolve','cause_resolve',a,resolution_id=resolution,cause_id=cause['cause_id'],evidence=dict(kind='reconciled_available',confirmation_id=confirmation,post_count_id=agreement['count_id']))
 after_resolve=capture(ctx,m,runtime,'management-after-resolution')
 if postconfirm['sha256']!=after_resolve['sha256']:raise ValueError('Fresh agreement/resolution changed posted physical PB50')
 empty=rpc('causes-empty','discover_controlled_count_causes_v1',scope(a),a)
 if empty['state']!='empty'or empty['data']['causes']!=[]:raise ValueError('Resolved cause remains open or appears false eligible subset')
 final=rpc('confirmed-read','read_controlled_count_reconciliation_v1',{**scope(a),'reconciliation_id':reconciliation},a)
 if final['data']['history_state']!='confirmed'or final['data']['approval_id']!=approval or final['data']['execution_id']!=execution or final['data']['confirmation_id']!=confirmation:raise ValueError('Final public correction history differs')
 proof=dict(variance_count=variance['count_id'],variance_outcome=variance['finalize']['request']['outcome_id'],discovered_cause=cause,footprint=footprint,reconciliation_id=reconciliation,preparation_id=preparation,parent_action_id=parent,approval_id=approval,execution_id=execution,confirmation_id=confirmation,post_count_id=agreement['count_id'],resolution_id=resolution,saved=saved,steps=steps,captures=dict(before=before,after_prepare=after_prepare,after_approval=after_approval,after_execute=after_execute,after_confirmation=postconfirm,after_resolution=after_resolve))
 ctx['management']=deepcopy(proof);save(folder,'full121-management-proof',proof);return proof
