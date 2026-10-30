"""Genuine count pair via actual A/B HTTP, optional real B re-login.

Finite supported synthetic cases only. No diagnostic runtime imports, owner
policy seeds or physical source mutation. Source prefix may stop for browser.
"""
from copy import deepcopy
import full121_values as v
import full121_queries as sql
RPCS=('discover_controlled_counts_v1','start_controlled_count_v1','save_controlled_count_statement_v1','read_controlled_count_v1','recover_controlled_count_operation_v1','finalize_controlled_count_v1','read_controlled_count_operation_closure_v1','close_controlled_count_operation_v1','cancel_controlled_count_v1')
READ_KEYS=('count_id','snapshot_id','product','site','locations','lots','units','containers','participants','captured_policy','captured_at','history_state','current_boundary_state','own_statement','statements','expected','comparison','terminal','read_at')
CASES={'agreement':('20.000','20.000',True),'variance':('20.000','21.000',False),'post_reconciliation':('21.000','21.000',True),'cancellation':('20.000','20.000',True)}
def receipt(action,q,r):
 v.keys(r,('schema_version','action','operation_id','count_id','actor_id','request_digest','result_ref','receipt_digest'))
 for k in('schema_version','operation_id','count_id','actor_id'):
  if r[k]!=q[k]:raise ValueError('Actual count receipt scope differs')
 ref=v.keys(r['result_ref'],('kind','id','opaque_commitment'))
 kind,key={'start':('cycle','count_id'),'statement':('statement','statement_id'),'finalize':('outcome','outcome_id'),'cancel':('cancellation','cancellation_id')}[action]
 if ref['kind']!=kind or ref['id']!=q[key]or not isinstance(ref['opaque_commitment'],str)or len(ref['opaque_commitment'])!=64 or any(c not in'0123456789abcdef'for c in ref['opaque_commitment']):raise ValueError('Actual count result reference differs')
 if r['action']!=action or r['request_digest']!=v.digest('lrv-controlled-count-request-v1',dict(action=action,request=q))or r['receipt_digest']!=v.digest('lrv-controlled-count-public-receipt-v1',{k:x for k,x in r.items()if k!='receipt_digest'}):raise ValueError('Actual count independent request/receipt frame differs')
 return deepcopy(r)
def no_private(value):
 if type(value)is dict:
  if set(value)&{'private_nonce_hex','record_hash','physical_boundary','physical_boundary_hash','source_bundle','policy_hash'}:raise ValueError('Private data in public count projection')
  for x in value.values():no_private(x)
 elif type(value)is list:
  for x in value:no_private(x)
def read_value(ctx,count,actor,r,both,own,case,history,submissions=None):
 v.keys(r,('schema_version','state','data'));d=v.keys(r['data'],READ_KEYS);no_private(d)
 expected,observed,agreement=CASES[case]
 if r['schema_version']!=1 or r['state']!='available'or d['count_id']!=count or d['history_state']!=history or d['current_boundary_state']!='unchanged'or d['product']['id']!=ctx['ids']['product']or d['site']['id']!=ctx['ids']['site']:raise ValueError('Actual count READ scope/history/source differs')
 if len(d['units'])!=1 or d['units'][0]['cell_id']!=ctx['ids']['cell']or len(d['containers'])!=1 or d['containers'][0]['container_id']!=ctx['ids']['container']:raise ValueError('Actual complete one-cell opening manifest differs')
 if any('quantity'in row or'expected_quantity'in row for row in d['units']):raise ValueError('Expected physical data in blind metadata')
 if both:
  if d['expected']!=[dict(cell_id=ctx['ids']['cell'],quantity=expected,stock_unit='tablet')]or len(d['statements'])!=2 or d['comparison']['agreement']is not agreement:raise ValueError('Actual complete comparison differs from selected synthetic case')
  if {x['actor']['id']for x in d['statements']}!={u['id']for u in ctx['users']}:raise ValueError('Actual both attributed observations not original actors')
  wanted_comparison=dict(agreement=agreement,quantity_comparison=[dict(cell_id=ctx['ids']['cell'],stock_unit='tablet',expected_quantity=expected,actor_a_quantity=observed,actor_b_quantity=observed,actor_a_matches_expected=observed==expected,actor_b_matches_expected=observed==expected,statements_match=True)],container_comparison=[dict(container_id=ctx['ids']['container'],actor_a_presence='present',actor_b_presence='present')],finding_counts=dict(a=0,b=0))
  if d['comparison']!=wanted_comparison:raise ValueError('Actual complete physical comparison differs from original requests')
  if submissions is None or len(submissions)!=2:raise ValueError('Both original source requests required for revealed READ check')
  for item in d['statements']:
   saved=submissions[item['actor']['id']]
   if item['request']!=saved['request']or item['slot']!=('A'if item['actor']['id']==ctx['users'][0]['id']else 'B'):raise ValueError('Revealed statement original request or slot differs')

 else:
  if any(d[k]is not None for k in('statements','expected','comparison')):raise ValueError('Physical expected/other/comparison exposed before both statements')
 if own:
  if d['own_statement']is None or d['own_statement']['actor']['id']!=actor['id']:raise ValueError('Owned original observation missing')
  if submissions is None or actor['id']not in submissions:raise ValueError('Own original source request/receipt required')
  saved=submissions[actor['id']]
  if d['own_statement']['request']!=saved['request']or d['own_statement']['receipt']!=saved['receipt']:raise ValueError('Owned READ request/receipt differs from actual original save')

 elif d['own_statement']is not None:raise ValueError('Other participant observation disclosed')
 return deepcopy(d)
def pair(ctx,m,runtime,folder,query,save,case,new_b_session=False):
 if case not in CASES:raise ValueError('Finite source-owned synthetic case required')
 a,original_b=ctx['users'];b=ctx.get('current_actors',{}).get(original_b['id'],original_b);http=ctx['http'];ids=ctx['ids'];steps=[];saved=[];submissions={}
 def rpc(label,name,q,user):
  if name not in RPCS:raise ValueError('Fixed count pair API required')
  runtime.remaining(1);r=http.rpc(name,{'p_request':q},user);save(folder,'pair-'+case+'-'+label,r);steps.append(dict(label=label,rpc=name,actor_id=user['id'],session_id=user['session_id']));return r
 discovery=dict(schema_version=1,actor_id=a['id'],product_id=ids['product'],site_id=ids['site'],cursor=None,page_size=100)
 discovered=rpc('discovery','discover_controlled_counts_v1',discovery,a)
 if not any(x['id']==b['id']for x in discovered['observers'])or not discovered['capabilities']['observe']or not discovered['capabilities']['manage']:raise ValueError('Actual independent observer/count permissions not discoverable')
 count=v.uid();start=dict(schema_version=1,actor_id=a['id'],count_id=count,operation_id=v.uid(),product_id=ids['product'],site_id=ids['site'],actor_b_id=b['id'])
 saved.append(dict(action='start',request=start,receipt=receipt('start',start,rpc('start','start_controlled_count_v1',start,a))))
 def read(label,user,both=False,own=False):return read_value(ctx,count,user,rpc(label,'read_controlled_count_v1',dict(schema_version=1,actor_id=user['id'],count_id=count),user),both,own,case,'collecting',submissions)
 blind=read('blind-A',a);read('blind-B',b);snapshot=blind['snapshot_id']
 def statement(user,label):
  q=dict(schema_version=1,actor_id=user['id'],count_id=count,operation_id=v.uid(),snapshot_id=snapshot,statement_id=v.uid(),observed_at=query('pair-'+case+'-'+label+'-clock',sql.clock())['at'],method='manual_count',quantities=[dict(cell_id=ids['cell'],quantity=CASES[case][1])],container_checks=[dict(container_id=ids['container'],presence='present')],findings=[])
  v.instant(q['observed_at']);r=receipt('statement',q,rpc(label,'save_controlled_count_statement_v1',q,user));saved.append(dict(action='statement',request=q,receipt=r));submissions[user['id']]=dict(request=deepcopy(q),receipt=deepcopy(r));return q,r
 qa,ra=statement(a,'statement-A');read('own-A',a,own=True);read('still-blind-B',b)
 qb,rb=statement(b,'statement-B')
 if new_b_session:
  current=m['password_b'](http,original_b)
  if current['id']!=original_b['id']or current['session_id']in{u['session_id']for u in ctx['users']}:raise ValueError('Actual B password grant did not produce a distinct same-actor session')
  ctx.setdefault('current_actors',{})[current['id']]=deepcopy(current);b=current
  recovered=rpc('B-new-session-recover','recover_controlled_count_operation_v1',dict(schema_version=1,actor_id=b['id'],count_id=count,operation_id=qb['operation_id']),b)
  if recovered!=dict(state='saved',receipt=rb):raise ValueError('Real B new-session owned recovery changed historical receipt')
 read('both-A',a,True,True);read('both-B',b,True,True)
 proof=dict(case=case,count_id=count,snapshot_id=snapshot,saved=saved,steps=steps,expected_quantity=CASES[case][0],observed_quantity=CASES[case][1],current_B_session_id=b['session_id'])
 ctx.setdefault('count',{})[case]=deepcopy(proof);save(folder,'full121-pair-'+case+'-prefix',proof);return proof

def finalize(ctx,m,runtime,folder,query,save,case):
 proof=ctx['count'][case];a=ctx['users'][0];q=dict(schema_version=1,actor_id=a['id'],count_id=proof['count_id'],operation_id=v.uid(),outcome_id=v.uid())
 r=receipt('finalize',q,ctx['http'].rpc('finalize_controlled_count_v1',{'p_request':q},a));save(folder,'pair-'+case+'-finalize',r)
 history='agreement'if CASES[case][2]else 'variance'
 read=ctx['http'].rpc('read_controlled_count_v1',{'p_request':dict(schema_version=1,actor_id=a['id'],count_id=q['count_id'])},a)
 data=read_value(ctx,q['count_id'],a,read,True,True,case,history,{x['request']['actor_id']:x for x in proof['saved']if x['action']=='statement'})
 if data['terminal']['kind']!='outcome'or data['terminal']['id']!=q['outcome_id']:raise ValueError('Actual final terminal not the submitted outcome')
 proof['finalize']=dict(request=q,receipt=r);save(folder,'full121-pair-'+case+'-complete',proof);return deepcopy(proof)

def closed_pointer(ctx,action,q):return dict(schema_version=1,actor_id=q['actor_id'],operation_id=q['operation_id'],original_action=action,scope_id=q['count_id'],product_id=ctx['ids']['product'],site_id=ctx['ids']['site'])
def closure(p,r,state,saved=None):
 body={**p,'action':'operation_closure','state':state,'receipt':saved}
 if r!={**body,'receipt_digest':v.digest('lrv-controlled-count-operation-closure-receipt-v1',body)}:raise ValueError('Actual count ID-only closure differs')
 return deepcopy(r)
def cancel_and_abandon(ctx,m,runtime,folder,query,save):
 a,b=ctx['users'];http=ctx['http'];ids=ctx['ids'];count=v.uid()
 q=dict(schema_version=1,actor_id=a['id'],count_id=count,operation_id=v.uid(),product_id=ids['product'],site_id=ids['site'],actor_b_id=b['id'])
 start=receipt('start',q,http.rpc('start_controlled_count_v1',{'p_request':q},a));save(folder,'cancel-start-receipt',start)
 qc=dict(schema_version=1,actor_id=a['id'],count_id=count,operation_id=v.uid(),cancellation_id=v.uid(),reason=v.NOTE)
 cancelled=receipt('cancel',qc,http.rpc('cancel_controlled_count_v1',{'p_request':qc},a));save(folder,'cancel-terminal-receipt',cancelled)
 d=read_value(ctx,count,a,http.rpc('read_controlled_count_v1',{'p_request':dict(schema_version=1,actor_id=a['id'],count_id=count)},a),False,False,'cancellation','cancelled')
 if d['terminal']['kind']!='cancellation'or d['terminal']['id']!=qc['cancellation_id']or d['terminal']['reason']is not None:raise ValueError('No-observation cancelled read leaked a retained reason or has wrong source')
 cp=closed_pointer(ctx,'cancel',qc);closure(cp,http.rpc('read_controlled_count_operation_closure_v1',{'p_request':cp},a),'saved',cancelled)
 late=dict(schema_version=1,actor_id=a['id'],count_id=v.uid(),operation_id=v.uid(),product_id=ids['product'],site_id=ids['site'],actor_b_id=b['id']);lp=closed_pointer(ctx,'start',late)
 closure(lp,http.rpc('read_controlled_count_operation_closure_v1',{'p_request':lp},a),'pending')
 abandoned=closure(lp,http.rpc('close_controlled_count_operation_v1',{'p_request':lp},a),'abandoned')
 code,error=http.post('/rest/v1/rpc/start_controlled_count_v1',{'p_request':late},a['token']);save(folder,'count-late-start-refusal',dict(status=code,error=error))
 if code!=400 or error!=dict(code='P0001',details='',hint='',message='count_request_failed'):raise ValueError('Late abandoned count start was not refused')
 closure(lp,http.rpc('read_controlled_count_operation_closure_v1',{'p_request':lp},a),'abandoned')
 proof=dict(start_request=q,start_receipt=start,cancellation_request=qc,cancellation_receipt=cancelled,late_request=late,abandoned_pointer=lp,abandoned_receipt=abandoned)
 ctx['count']['cancel_and_abandon']=deepcopy(proof);save(folder,'full121-cancel-and-abandon',proof);return proof

def run(ctx,m,runtime,folder,query,save):
 pair(ctx,m,runtime,folder,query,save,'agreement',True)
 agreement=finalize(ctx,m,runtime,folder,query,save,'agreement')
 return dict(agreement=agreement,cancellation=cancel_and_abandon(ctx,m,runtime,folder,query,save))
