"""Current five-RPC gateway adapter for finite all-ten source workloads.

Uses actual opts13 and explicit fixed scenario allocation choices. No owner
context construction, JWT/GUC, direct canonical business write or Runtime.
"""
from copy import deepcopy
from decimal import Decimal
import full121_values as v
from full121_boundary_evidence import exact_response,posted_receipt
from full121_gateway import reply as checked_reply
WRITERS=('receive_inventory','adjust_inventory','record_patient_treatment','record_anesthesia_drug_administration','record_native_dispense','record_native_pickup','append_native_dispense_correction','record_native_dispense_return','record_native_dispense_return_v2','record_native_return_discrepancy')
RPCS=('probe_controlled_stock_intent_v1','prepare_managed_stock_intent_v1','read_managed_stock_intent_v1','execute_managed_stock_intent_v1','close_managed_stock_intent_v1')
def line_key(x):return(x['lot_id'],x['channel'],x['dispense_id']or'',x['intake_id']or'',x['quantity_delta'])
def same_effect(cell,line):return cell['lot_id']==line['lot_id']and cell['channel']==line['channel']and cell['dispense_id']==line['dispense_id']and cell['intake_id']==line['intake_id']

def allocation_context(ctx,options,writer,operation,observed_at):
 """Explicit single-site synthetic choice, revalidated by real original C0.

 New receive creates stock; D creates prepared. Return-held stays in the
 actual prepared package; pickup hands that package off; zero effects stay[].
 """
 ids=ctx['ids'];permission=options['permission'];basis=permission['basis']
 if permission['witness']!='none':raise ValueError('This finite writer workload selects explicit none-witness policy')
 if basis=='physical_record':v.instant(observed_at)
 elif observed_at is not None:raise ValueError('No fabricated physical clock for nonphysical entry')
 if options['product_id']!=ids['product']or not options['product_name']or options['stock_unit']!='tablet':raise ValueError('Actual source product/options differ')
 locations=[x for x in options['locations']if x['id']==ids['location']and x['site_id']==ids['site']and x['kind']=='clinic']
 if len(locations)!=1:raise ValueError('Actual permitted synthetic clinic location required')
 selected={};new_id=None
 def existing(c):
  if c['id']not in selected:
   h=c['head']
   if h['status']!='onsite'or h['location_id']!=ids['location']:raise ValueError('Finite source package must currently be onsite at chosen clinic')
   if not h['version'].isdigit()or int(h['version'])>2147483647:raise ValueError('Current fresh fixture head outside original context integer domain')
   after=dict(status=h['status'],location_id=h['location_id'],custodian_id=h['custodian_id'])
   if writer=='record_native_pickup':
    if 'handoff'not in c['after_modes']:raise ValueError('Actual handoff choice unavailable')
    after=dict(status='handed_off',location_id=None,custodian_id=None)
   elif 'preserve'not in c['after_modes']:raise ValueError('Actual preserve choice unavailable')
   selected[c['id']]=dict(id=c['id'],expected_version=int(h['version']),create=None,after=after,lines=[])
  return selected[c['id']]
 for line in options['effect_lines']:
  if Decimal(line['quantity_delta'])==0:raise ValueError('No zero source effect line accepted by this fixture')
  # All physical stock lines use the actual source lot; source APIs still
  # enforce complete allocation membership and totals independently.
  if line['lot_id']!=ids['lot']:raise ValueError('Unexpected actual native/clinical source lot')
  if writer=='receive_inventory'or(writer=='record_native_dispense'and line['channel']=='prepared'):
   kind='stock'if writer=='receive_inventory'else'prepared'
   if options['new_container_kinds']!=[kind]:raise ValueError('Actual new container kind not explicitly offered')
   if kind=='prepared'and not any(x['id']==ctx['users'][0]['id']for x in options['custodians']):raise ValueError('Actual original actor not offered as package custodian')
   if new_id is None:new_id=v.uid()
   if new_id not in selected:
    custodian=None if kind=='stock'else ctx['users'][0]['id']
    selected[new_id]=dict(id=new_id,expected_version=None,create=dict(kind=kind,label='Synthetic all-ten '+kind,stock_lot_id=ids['lot']if kind=='stock'else None,site_id=ids['site'],location_id=ids['location'],custodian_id=custodian),after=dict(status='onsite',location_id=ids['location'],custodian_id=custodian),lines=[])
   target=selected[new_id]
  else:
   matches=[c for c in options['containers']if c['site_id']==ids['site']and any(same_effect(cell,line)for cell in c['cells'])]
   if not matches and line['channel']=='return_held':
    # New held cell belongs to the actual existing prepared package from D.
    matches=[c for c in options['containers']if c['site_id']==ids['site']and c['kind']=='prepared'and any(cell['lot_id']==line['lot_id']and cell['dispense_id']==line['dispense_id']and cell['channel']=='prepared'for cell in c['cells'])]
   if writer in('adjust_inventory','record_patient_treatment','record_anesthesia_drug_administration','record_native_dispense'):
    matches=[c for c in matches if c['id']==ids['container']]
   if len(matches)!=1:raise ValueError('Source-supported singular actual allocation container required')
   target=existing(matches[0])
  target['lines'].append(deepcopy(line))
 for c in selected.values():c['lines'].sort(key=line_key)
 context=dict(version=1,product_id=options['product_id'],policy_version_id=options['policy_version_id'],state_head_id=options['state_head_id'],opening_id=options['opening_id'],basis=dict(kind=basis,observed_at=observed_at,note=v.NOTE),containers=[selected[k]for k in sorted(selected)])
 return context,new_id


def execute(ctx,m,runtime,folder,query,save,label,writer,legacy_arguments,observed_at):
 if writer not in WRITERS:raise ValueError('Exactly ten fixed canonical writers')
 actor=ctx['users'][0];http=ctx['http'];op=v.uid(legacy_arguments['p_id']);steps=[]
 def rpc(suffix,name,q):
  if name not in RPCS:raise ValueError('Fixed gateway methods only')
  runtime.remaining(1);r=http.rpc(name,{'p_request':q},actor);save(folder,'writer-'+label+'-'+suffix,r);steps.append(dict(rpc=name,actor_id=actor['id'],session_id=actor['session_id']));return r
 probe_q=dict(schema_version=1,actor_id=actor['id'],writer=writer,legacy_arguments=deepcopy(legacy_arguments));probe=rpc('probe','probe_controlled_stock_intent_v1',probe_q)
 v.keys(probe,('schema_version','actor_id','intent','mode','blocked_reason','options'))
 if probe['schema_version']!=1 or probe['actor_id']!=actor['id']:raise ValueError('Actual current probe principal/version differs')
 if probe['mode']!='managed'or probe['blocked_reason']is not None or probe['intent']['legacy_arguments']!=legacy_arguments or probe['intent']['operation_id']!=op or probe['intent']['product_id']!=ctx['ids']['product']or probe['intent']['writer']!=writer:raise ValueError('Actual source managed intent not the original writer request')
 o=v.keys(probe['options'],('product_id','product_name','policy_version_id','state_head_id','opening_id','stock_unit','permission','sites','locations','custodians','containers','effect_lines','new_container_kinds'))
 context,new_container=allocation_context(ctx,o,writer,op,observed_at)
 p=dict(schema_version=1,actor_id=actor['id'],operation_id=op,writer=writer,product_id=probe['intent']['product_id'],event_kind=probe['intent']['event_kind'])
 q={**p,'legacy_arguments':deepcopy(legacy_arguments),'context':context};save(folder,'writer-'+label+'-request',q)
 prepared=checked_reply(p,rpc('prepare','prepare_managed_stock_intent_v1',q),'prepared',legacy_arguments);read=checked_reply(p,rpc('review','read_managed_stock_intent_v1',p),'prepared',legacy_arguments)
 if prepared['state']!='prepared'or read!=prepared or prepared['data']['pointer']!=p or prepared['data']['intent']!=probe['intent']or prepared['data']['preparation']['canonical_arguments']!=probe['intent']['canonical_arguments']or prepared['data']['preparation']['context']!=context:raise ValueError('Actual immutable C0 preparation/original intent changed')
 saved=checked_reply(p,rpc('execute','execute_managed_stock_intent_v1',p),'saved',legacy_arguments)
 if saved['state']!='saved'or saved['data']['pointer']!=p or saved['data']['intent']!=probe['intent']:raise ValueError('Actual owned canonical save missing')
 d=saved['data'];receipt=d['receipt'];event=receipt['event']
 if d['preparation']['state']!='saved'or d['preparation']['receipt']!=receipt or receipt['canonical_result']!=d['canonical_result']or receipt['id']!=op or receipt['writer']!=writer or receipt['actor_id']!=actor['id']or event['id']!=op or event['writer']!=writer or event['product_id']!=ctx['ids']['product']or event['actor_id']!=actor['id']or event['session_id']!=actor['session_id']or event['event_kind']!=p['event_kind']or event['basis']!=context['basis']['kind']or event['note']!=v.NOTE:raise ValueError('Actual C0 event/receipt/result/source principal differs')
 posted=posted_receipt(ctx,m,runtime,'writer-'+label+'-posted-receipt',op,exact_response(http,'execute_managed_stock_intent_v1'))
 for suffix,name in(('recover','read_managed_stock_intent_v1'),('saved-close','close_managed_stock_intent_v1')):
  recovered=checked_reply(p,rpc(suffix,name,p),'saved',legacy_arguments)
  if recovered['state']!='saved'or recovered['data']['pointer']!=p or recovered['data']['intent']!=probe['intent']or recovered['data']['receipt']!=receipt or recovered['data']['canonical_result']!=d['canonical_result']:raise ValueError('Owned original request/result recovery changed')
 proof=dict(writer=writer,pointer=p,legacy_arguments=deepcopy(legacy_arguments),canonical_arguments=probe['intent']['canonical_arguments'],request=q,prepared=prepared['data']['preparation'],receipt=receipt,canonical_result=d['canonical_result'],new_container_id=new_container,posted_membership=posted,steps=steps)
 ctx.setdefault('writer_coverage',{})[label]=deepcopy(proof);save(folder,'writer-'+label+'-proof',proof);return proof
