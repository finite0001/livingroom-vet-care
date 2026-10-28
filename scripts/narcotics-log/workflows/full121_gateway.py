"""Finite ordinary managed-adjustment, explicit closure and real C2 scenarios."""
from copy import deepcopy
import full121_values as v
import full121_queries as sql
from full121_boundary_evidence import exact_response,posted_receipt
RPCS=('probe_controlled_stock_intent_v1','prepare_managed_stock_intent_v1','read_managed_stock_intent_v1','execute_managed_stock_intent_v1','close_managed_stock_intent_v1')

def request(ctx,actor,op):
 return dict(schema_version=1,actor_id=actor['id'],writer='adjust_inventory',legacy_arguments=dict(p_id=op,p_lot_id=ctx['ids']['lot'],p_quantity=1,p_reason=v.NOTE))
def pointer(ctx,actor,op):return dict(schema_version=1,actor_id=actor['id'],operation_id=op,writer='adjust_inventory',product_id=ctx['ids']['product'],event_kind='adjust_inventory')
def check_probe(q,r,ctx,witness):
 v.keys(r,('schema_version','actor_id','intent','mode','blocked_reason','options'))
 if r['schema_version']!=1 or r['actor_id']!=q['actor_id']or r['mode']!='managed'or r['blocked_reason']is not None:raise ValueError('Actual managed intent not available')
 intent=v.keys(r['intent'],('writer','operation_id','product_id','event_kind','legacy_arguments','canonical_arguments'))
 expected=dict(writer='adjust_inventory',operation_id=q['legacy_arguments']['p_id'],product_id=ctx['ids']['product'],event_kind='adjust_inventory',legacy_arguments=q['legacy_arguments'],canonical_arguments=dict(lot_id=ctx['ids']['lot'],quantity='1',reason=v.NOTE))
 if intent!=expected:raise ValueError('Actual canonical/legacy numeric-token conversion or operation binding differs')
 o=v.keys(r['options'],('product_id','product_name','policy_version_id','state_head_id','opening_id','stock_unit','permission','sites','locations','custodians','containers','effect_lines','new_container_kinds'))
 if o['product_id']!=ctx['ids']['product']or o['product_name']!='Synthetic full121 medication'or o['stock_unit']!='tablet'or o['permission']['witness']!=witness or o['new_container_kinds']!=[]:raise ValueError('Actual source product/options/permission differs')
 expected_lines=[dict(lot_id=ctx['ids']['lot'],channel='available',dispense_id=None,intake_id=None,quantity_delta='1')]
 if o['effect_lines']!=expected_lines:raise ValueError('Actual supported available adjustment effects differ')
 return deepcopy(o)
def context(ctx,options,at):
 v.instant(at);containers=[c for c in options['containers']if c['id']==ctx['ids']['container']]
 if len(containers)!=1:raise ValueError('Actual selected container missing or duplicated')
 c=containers[0];head=c['head']
 if c['site_id']!=ctx['ids']['site']or head['status']!='onsite'or head['location_id']!=ctx['ids']['location']or head['custodian_id']is not None or 'preserve'not in c['after_modes']:raise ValueError('Actual allowed custody differs from synthetic onsite source')
 return dict(version=1,product_id=options['product_id'],policy_version_id=options['policy_version_id'],state_head_id=options['state_head_id'],opening_id=options['opening_id'],basis=dict(kind='physical_record',observed_at=at,note=v.NOTE),containers=[dict(id=c['id'],expected_version=int(head['version']),create=None,after=dict(status=head['status'],location_id=head['location_id'],custodian_id=head['custodian_id']),lines=deepcopy(options['effect_lines']))])
def reply(p,r,state,legacy=None):
 v.keys(r,('schema_version','state','data'));d=v.keys(r['data'],('pointer','intent','preparation','canonical_result','receipt'))
 if r['schema_version']!=1 or r['state']!=state or d['pointer']!=p:raise ValueError('Actual managed operation scope/state differs')
 if d['intent']is not None:
  if any(d['intent'][k]!=p[k]for k in('writer','operation_id','product_id','event_kind'))or legacy is not None and d['intent']['legacy_arguments']!=legacy:raise ValueError('Owned managed intent differs')
 if state=='saved':
  if d['receipt']is None or d['preparation']['state']!='saved'or d['preparation']['receipt']!=d['receipt']or d['receipt']['canonical_result']!=d['canonical_result']:raise ValueError('Actual saved original canonical receipt differs')
  receipt=d['receipt'];event=receipt['event'];prep=d['preparation']
  if receipt['id']!=p['operation_id']or receipt['actor_id']!=p['actor_id']or receipt['writer']!=p['writer']or event['id']!=p['operation_id']or event['product_id']!=p['product_id']or event['actor_id']!=p['actor_id']or event['event_kind']!=p['event_kind']or event['policy_version_id']!=prep['context']['policy_version_id']or event['opening_id']!=prep['context']['opening_id']or event['note']!=v.NOTE:raise ValueError('Actual saved parent/action/event/permission binding differs')
 elif d['receipt']is not None or d['canonical_result']is not None:raise ValueError('Nonsaved operation exposed saved result')
 return deepcopy(r)
def run(ctx,m,runtime,folder,query,save):
 if 'gateway'in ctx:raise ValueError('Ordinary gateway stage cannot run twice')
 http=ctx['http'];a=ctx['users'][0];steps=[];op=v.uid();p=pointer(ctx,a,op);probe_request=request(ctx,a,op)
 def rpc(label,name,q):
  if name not in RPCS:raise ValueError('Fixed ordinary gateway endpoint required')
  runtime.remaining(1);r=http.rpc(name,{'p_request':q},a);save(folder,'gateway-'+label,r);steps.append(dict(label=label,rpc=name,actor_id=a['id'],session_id=a['session_id']));return r
 o=check_probe(probe_request,rpc('probe','probe_controlled_stock_intent_v1',probe_request),ctx,'none')
 at=query('gateway-observation-clock',sql.clock())['at'];q={**p,'legacy_arguments':probe_request['legacy_arguments'],'context':context(ctx,o,at)}
 save(folder,'gateway-prepare-request',q)
 prepared=reply(p,rpc('prepare','prepare_managed_stock_intent_v1',q),'prepared',probe_request['legacy_arguments'])
 reviewed=reply(p,rpc('read-prepared','read_managed_stock_intent_v1',p),'prepared',probe_request['legacy_arguments'])
 if reviewed!=prepared:raise ValueError('Actual immutable managed preparation changed')
 before=query('gateway-before-execute',sql.opening(ctx['ids']['product'],ctx['ids']['site']))
 saved=reply(p,rpc('execute','execute_managed_stock_intent_v1',p),'saved',probe_request['legacy_arguments'])
 posted=posted_receipt(ctx,m,runtime,'gateway-posted-receipt',op,exact_response(http,'execute_managed_stock_intent_v1'))
 for label,name in(('read-saved','read_managed_stock_intent_v1'),('close-saved','close_managed_stock_intent_v1')):
  if reply(p,rpc(label,name,p),'saved',probe_request['legacy_arguments'])['data']['receipt']!=saved['data']['receipt']:raise ValueError('Owned canonical recovery changed original result')
 after=query('gateway-after-execute',sql.opening(ctx['ids']['product'],ctx['ids']['site']))
 if before['positions']!=[dict(cell_id=ctx['ids']['cell'],quantity='20.000')]or after['positions']!=[dict(cell_id=ctx['ids']['cell'],quantity='21.000')]:raise ValueError('Actual ordinary +1 posting does not equal explicit synthetic delta')
 if before['containers']!=after['containers']or before['cells']!=after['cells']:raise ValueError('Existing-cell adjustment changed immutable membership')
 # Prepare then explicitly abandon a second operation. It must cancel the real
 # original C0 preparation and permanently fence delayed execution.
 late_op=v.uid();late_p=pointer(ctx,a,late_op);late_probe=request(ctx,a,late_op)
 late_o=check_probe(late_probe,rpc('abandon-probe','probe_controlled_stock_intent_v1',late_probe),ctx,'none')
 late_q={**late_p,'legacy_arguments':late_probe['legacy_arguments'],'context':context(ctx,late_o,query('gateway-abandon-clock',sql.clock())['at'])}
 reply(late_p,rpc('abandon-prepare','prepare_managed_stock_intent_v1',late_q),'prepared',late_probe['legacy_arguments'])
 abandoned=reply(late_p,rpc('abandon','close_managed_stock_intent_v1',late_p),'abandoned',late_probe['legacy_arguments'])
 if abandoned['data']['preparation']['state']!='cancelled':raise ValueError('Managed abandonment did not cancel actual original preparation')
 delayed=reply(late_p,rpc('late-execute','execute_managed_stock_intent_v1',late_p),'abandoned',late_probe['legacy_arguments'])
 if delayed!=abandoned or query('gateway-after-late',sql.opening(ctx['ids']['product'],ctx['ids']['site']))!=after:raise ValueError('Delayed abandoned execution changed stock')
 rows=query('gateway-journal-effects',sql.journal([op,late_op]))
 expected=sorted([(op,'prepared'),(op,'saved'),(late_op,'prepared'),(late_op,'abandoned')])
 if sorted((r['operation_id'],r['stage'])for r in rows)!=expected or any(r['protocol']!='stock_entry_v1'or r['action']!='stock_entry'or r['actor_id']!=a['id']or r['session_id']!=a['session_id']for r in rows):raise ValueError('Exact managed journal rows differ')
 proof=dict(pointer=p,request=q,receipt=saved['data']['receipt'],canonical_result=saved['data']['canonical_result'],abandoned_pointer=late_p,abandoned_request=late_q,before=before,after=after,journal=rows,steps=steps,posted_exact_receipt=posted)
 ctx['gateway']=deepcopy(proof);save(folder,'full121-gateway-proof',proof);return proof
