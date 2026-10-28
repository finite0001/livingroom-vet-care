"""Five fresh final121 source profiles. Framework owns installation/Auth/budgets."""
from copy import deepcopy
from decimal import Decimal
import full121_values as v
import full121_queries as sql
import full121_commissioning as commissioning
import full121_effects as effects
import wc_gateway as gateway
import wc_domain as domain_api
import wc_queries as q
import wc_clinical_values as clinical_values
import wc_native_values as native_values
import wc_annotation_values as annotation_values
import wc_return1_values as return1_values
import wc_return2_values as return2_values
import wc_discrepancy_values as discrepancy_values

PROFILE_WRITERS={
 'scalars':('receive_inventory','adjust_inventory'),
 'clinical':('record_patient_treatment','record_anesthesia_drug_administration'),
 'native_pickup_annotation':('record_native_dispense','record_native_pickup','append_native_dispense_correction'),
 'native_return_v1':('record_native_dispense','record_native_dispense_return'),
 'native_return_v2_discrepancy':('record_native_dispense','record_native_dispense_return_v2','record_native_return_discrepancy')}
PROFILE_AUTH_SESSIONS={name:2 for name in PROFILE_WRITERS}
PROFILE_SUFFIX_HTTP={'scalars':12,'clinical':20,'native_pickup_annotation':30,'native_return_v1':24,'native_return_v2_discrepancy':32}
COMMISSIONING_HTTP=62
PROFILE_CHANNEL_QUANTITIES={
 'scalars':{'available':['1.125','19.000']},
 'clinical':{'available':['18.250']},
 'native_pickup_annotation':{'available':['18.000'],'prepared':['0.000']},
 'native_return_v1':{'available':['18.000'],'prepared':['0.000'],'return_held':['2.000']},
 'native_return_v2_discrepancy':{'available':['18.000'],'prepared':['0.000'],'return_held':['2.000']}}
PROFILE_LINES_TRANSITIONS={'scalars':(2,2),'clinical':(2,2),'native_pickup_annotation':(3,3),'native_return_v1':(4,3),'native_return_v2_discrepancy':(4,3)}

def clock(query,label):return query(label,sql.clock())['at']
def start(ctx,m,runtime,folder,query,save):
 if ctx.get('writer_coverage')or ctx.get('writer_domain'):raise ValueError('Every profile needs a fresh fixture, never reuse an old product history')
 ctx['writer_initial_http_count']=len(ctx['http'].calls);ctx['writer_initial_users']=deepcopy(ctx['users'])
 return commissioning.run(ctx,m,runtime,folder,query,save)

def verify(ctx,query,save,folder,profile):
 actual_http=ctx['http'].calls[ctx['writer_initial_http_count']:]
 if len(ctx['admin']['steps'])!=COMMISSIONING_HTTP or len(actual_http)!=COMMISSIONING_HTTP+PROFILE_SUFFIX_HTTP[profile]or any(not c['path'].startswith('/rest/v1/rpc/')for c in actual_http)or ctx['users']!=ctx['writer_initial_users']:raise ValueError('Exact source business HTTP/Auth identity schedule differs')
 rows=query('writers-'+profile+'-stock',q.stock(ctx['ids']['product']));proofs=list(ctx['writer_coverage'].values());expected=PROFILE_WRITERS[profile]
 if tuple(x['writer']for x in proofs)!=expected:raise ValueError('Actual representative writer order/membership differs')
 want=sorted((p['pointer']['operation_id'],p['writer'],p['pointer']['event_kind'],ctx['users'][0]['id'],ctx['users'][0]['session_id'])for p in proofs)
 if sorted((r['id'],r['writer'],r['kind'],r['actor'],r['session'])for r in rows['events'])!=want:raise ValueError('Actual complete controlled event multiset differs')
 actual={}
 for c in rows['cells']:
  if c['lot_id']!=ctx['ids']['lot']:raise ValueError('Actual complete product boundary contains unintended lot')
  actual.setdefault(c['channel'],[]).append(c['quantity'])
 actual={k:sorted(v)for k,v in actual.items()}
 if actual!={k:sorted(v)for k,v in PROFILE_CHANNEL_QUANTITIES[profile].items()}:raise ValueError('Actual complete channel positions differ from source quantities')
 if(rows['lines'],rows['transitions'])!=PROFILE_LINES_TRANSITIONS[profile]:raise ValueError('Actual complete line/transition counts differ')
 a=effects.expected('commission_all');n=len(proofs);a.update(journal=21+2*n,controlled_stock_preparations=n,controlled_stock_actions=n,controlled_stock_events=n)
 counts=query('writers-'+profile+'-new-relation-counts',effects.source_counts())
 if counts!=a:raise ValueError('Actual exact new count/journal/parent relation counts differ')
 journal=query('writers-'+profile+'-journal',sql.journal([p['pointer']['operation_id']for p in proofs]))
 if sorted((j['operation_id'],j['stage'])for j in journal)!=sorted((p['pointer']['operation_id'],s)for p in proofs for s in('prepared','saved'))or any(j['protocol']!='stock_entry_v1'or j['action']!='stock_entry'or j['actor_id']!=ctx['users'][0]['id']or j['session_id']!=ctx['users'][0]['session_id']for j in journal):raise ValueError('Actual journal graph differs')
 proof=dict(profile=profile,writer_order=list(expected),writes=proofs,stock=rows,exact_new_relation_counts=counts,journal=journal,domain=ctx.get('writer_domain'),auth_sessions_expected=2,scope='one representative event per listed writer; no all22-kind or latency claim')
 save(folder,'writers-'+profile+'-final',proof);return proof

def scalars(ctx,m,runtime,folder,query,save):
 start(ctx,m,runtime,folder,query,save);ids=ctx['ids'];lot=query('writers-scalar-lot',q.lot(ids['lot']));source_date=lot['expires_on']
 # Exact JSON numeric values 1.125/-1 preserve original scalar API semantics;
 # source gateway alone produces canonical decimal strings, never the caller.
 receive=dict(p_id=v.uid(),p_lot_id=ids['lot'],p_product_id=ids['product'],p_lot_number=lot['lot_number'],p_expires_on=source_date,p_location=lot['location'],p_quantity=1.125,p_reason=v.NOTE)
 gateway.execute(ctx,m,runtime,folder,query,save,'receive','receive_inventory',receive,clock(query,'writers-receive-clock'))
 adjust=dict(p_id=v.uid(),p_lot_id=ids['lot'],p_quantity=-1,p_reason=v.NOTE)
 gateway.execute(ctx,m,runtime,folder,query,save,'adjust','adjust_inventory',adjust,clock(query,'writers-adjust-clock'))
 return verify(ctx,query,save,folder,'scalars')

def clinical(ctx,m,runtime,folder,query,save):
 start(ctx,m,runtime,folder,query,save);d=domain_api.patient(ctx,runtime,folder,save);d['anesthesia']=v.uid()
 born=domain_api.rpc(ctx,runtime,folder,save,'anesthesia-birth','save_patient_anesthesia_record',clinical_values.anesthesia_request(d['anesthesia'],d['pet'],clock(query,'writers-anesthesia-start')))
 if born['id']!=d['anesthesia']or born['pet_id']!=d['pet']or born['status']!='draft'or born['version']!=1:raise ValueError('Actual anesthesia source birth differs')
 managed=[]
 for i,writer in enumerate(PROFILE_WRITERS['clinical']):
  alert=domain_api.rpc(ctx,runtime,folder,save,'clinical-alert-'+str(i),'read_patient_treatment_alerts',dict(p_pet_id=d['pet']))
  v.keys(alert,('snapshot','source_hash'))
  if alert['snapshot']['pet_id']!=d['pet']:raise ValueError('Actual alert source patient differs')
  at=clock(query,'writers-clinical-clock-'+str(i));args=clinical_values.arguments(i,ctx['ids'],d,at,alert['source_hash']);op=v.uid()
  legacy=dict(p_id=op,p_request=args['request'])if i==0 else dict(p_id=op,p_record_id=args['record_id'],p_pet_id=args['pet_id'],p_request=args['request'])
  managed.append(gateway.execute(ctx,m,runtime,folder,query,save,'clinical-'+str(i),writer,legacy,at))
 # Genuine historical, nonstock medication entry: probe MUST classify the
 # actual source branch unmanaged before the unchanged original writer runs.
 h=v.uid();request=dict(pet_id=d['pet'],quantity='0.125',dose='Synthetic historical dose',route='Synthetic route',veterinarian='Synthetic veterinarian',administered_at=clock(query,'writers-historical-clock'),historical=True,product_name='Synthetic external historical medication',source='Synthetic engineering outside practice history',kind='medication')
 legacy=dict(p_id=h,p_request=request);runtime.remaining(1);probe=ctx['http'].rpc('probe_controlled_stock_intent_v1',dict(p_request=dict(schema_version=1,actor_id=ctx['users'][0]['id'],writer='record_patient_treatment',legacy_arguments=legacy)),ctx['users'][0]);save(folder,'writers-historical-probe',probe)
 if probe['mode']!='unmanaged'or probe['blocked_reason']is not None or probe['options']is not None or probe['intent']['product_id']is not None or probe['intent']['legacy_arguments']!=legacy:raise ValueError('Legitimate historical treatment was not proven nonstock')
 runtime.remaining(1);result=ctx['http'].rpc('record_patient_treatment',legacy,ctx['users'][0]);save(folder,'writers-historical-result',result)
 if result['id']!=h or result['historical']is not True or result['product_id']is not None or result['lot_id']is not None or result['invoice_id']is not None or result['created_by']!=ctx['users'][0]['id']or result['request']!=request:raise ValueError('Actual nonstock original result differs')
 rows=query('writers-clinical-domain',q.clinical(d));t=rows['treatments'];revisions=rows['revision_rows']
 if len(t)!=3 or sorted(x['id']for x in t)!=sorted([h]+[p['pointer']['operation_id']for p in managed])or rows['invoice']['version']!=3 or len(revisions)!=1 or revisions[0]['id']!=1 or revisions[0]['version']!=1 or revisions[0]['snapshot']!=rows['anesthesia']or revisions[0]['actor_id']!=ctx['users'][0]['id']or revisions[0]['recorded_at']!=rows['anesthesia']['created_at']:raise ValueError('Actual nested clinical/revision identity/full snapshot differs')
 ctx['writer_domain']=deepcopy(d);proof=verify(ctx,query,save,folder,'clinical');proof['historical_nonstock']=dict(request=legacy,probe=probe,result=result);proof['clinical_rows']=rows;save(folder,'writers-clinical-complete',proof);return proof

def dispense(ctx,m,runtime,folder,query,save,d):
 preview=domain_api.rpc(ctx,runtime,folder,save,'dispense-preview','preview_native_dispense',dict(p_target=native_values.dispense_target(d,ctx['ids'])))
 args=native_values.dispense_request(d,ctx['ids'],preview)
 proof=gateway.execute(ctx,m,runtime,folder,query,save,'dispense','record_native_dispense',dict(p_id=d['dispense'],p_request=args['request']),clock(query,'writers-dispense-clock'))
 if proof['new_container_id']is None:raise ValueError('Actual D did not allocate new prepared package')
 d['package']=proof['new_container_id'];domain_api.authorization_recovery(ctx,runtime,folder,save,proof,d);return proof

def native_pickup_annotation(ctx,m,runtime,folder,query,save):
 start(ctx,m,runtime,folder,query,save);d=domain_api.prescription(ctx,runtime,folder,query,save);dispense(ctx,m,runtime,folder,query,save,d)
 preview=domain_api.rpc(ctx,runtime,folder,save,'pickup-preview','preview_native_pickup',dict(p_dispense_id=d['dispense'],p_pet_id=d['pet'],p_refill_close=None))
 args=native_values.pickup_request(d,preview);p=gateway.execute(ctx,m,runtime,folder,query,save,'pickup','record_native_pickup',dict(p_id=d['pickup'],p_request=args['request']),clock(query,'writers-pickup-clock'))
 # Original uppercase native UUID tokens remain unchanged, including when
 # testing the owned authorization recovery source path.
 domain_api.authorization_recovery(ctx,runtime,folder,save,p,d)
 d['annotation']=v.uid();preview=domain_api.rpc(ctx,runtime,folder,save,'annotation-preview','preview_native_dispense_correction',annotation_values.preview_request(d));args=annotation_values.arguments(0,d,preview,ctx['users'][0])
 gateway.execute(ctx,m,runtime,folder,query,save,'annotation','append_native_dispense_correction',dict(p_id=d['annotation'],p_request=args['request']),None)
 proof=verify(ctx,query,save,folder,'native_pickup_annotation')
 package=[h for h in proof['stock']['heads']if h['container_id']==d['package']]
 if len(package)!=1 or package[0]['status']!='handed_off'or package[0]['location_id']is not None or package[0]['custodian_id']is not None:raise ValueError('Actual original pickup custody not handed off')
 return proof

def return_intake(ctx,m,runtime,folder,query,save,version):
 start(ctx,m,runtime,folder,query,save);d=domain_api.prescription(ctx,runtime,folder,query,save);dispense(ctx,m,runtime,folder,query,save,d)
 r=return1_values if version==1 else return2_values;suffix=''if version==1 else'_v2'
 state=domain_api.rpc(ctx,runtime,folder,save,'return-before','read_native_dispense_returns'+suffix,r.read_request(d));allocation=r.actual_allocation(d,state,ctx['ids']['lot']);d['allocation']=allocation
 intent=r.intent(0,d,allocation)if version==1 else r.intent(0,d,allocation,{})
 preview=domain_api.rpc(ctx,runtime,folder,save,'return-preview','preview_native_dispense_return'+suffix,dict(p_intent=intent))
 args=r.arguments(0,d,allocation,preview,ctx['users'][0])if version==1 else r.arguments(0,d,allocation,{},preview,ctx['users'][0])
 gateway.execute(ctx,m,runtime,folder,query,save,'intake','record_native_dispense_return'+suffix,dict(p_id=d['intake'],p_request=args['request']),clock(query,'writers-intake-clock'))
 actual=domain_api.rpc(ctx,runtime,folder,save,'return-after','read_native_dispense_returns'+suffix,r.read_request(d))
 if version==1:
  if actual['head']['event_id']!=d['intake']or actual['head']['version']!=1 or len(actual['allocations'])!=1:raise ValueError('Actual V1 intake head/membership differs')
  row=actual['allocations'][0]
  if row['allocation_id']!=allocation or row['lot_id']!=ctx['ids']['lot']or tuple(row[k]for k in('dispensed_quantity','returned_quantity','remaining_returnable_quantity','held_quantity','disposed_quantity','restocked_quantity'))!=('2.000','2.000','0.000','2.000','0.000','0.000'):raise ValueError('Actual V1 return physical conservation differs')
 else:r.actual_head(0,d,actual,allocation,ctx['ids']['lot'])
 ctx['writer_domain']=deepcopy(d);return d,actual

def native_return_v1(ctx,m,runtime,folder,query,save):
 return_intake(ctx,m,runtime,folder,query,save,1);return verify(ctx,query,save,folder,'native_return_v1')

def native_return_v2_discrepancy(ctx,m,runtime,folder,query,save):
 d,state=return_intake(ctx,m,runtime,folder,query,save,2);head=state['head'];r=discrepancy_values
 allocation=r.native_state(1,state,d,ctx['ids']['lot'],ctx['users'][0]['id'],d['allocation'],head)
 intent=r.discrepancy_intent(2,d,allocation,state,head);preview=domain_api.rpc(ctx,runtime,folder,save,'discrepancy-preview','preview_native_return_discrepancy',dict(p_intent=intent));args=r.arguments(2,d,allocation,state,head,preview,ctx['users'][0])
 gateway.execute(ctx,m,runtime,folder,query,save,'discrepancy','record_native_return_discrepancy',dict(p_id=d['report_a'],p_request=args['request']),None)
 after=domain_api.rpc(ctx,runtime,folder,save,'discrepancy-after','read_native_dispense_returns_v2',r.read_request(d));r.native_state(2,after,d,ctx['ids']['lot'],ctx['users'][0]['id'],allocation,head)
 proof=verify(ctx,query,save,folder,'native_return_v2_discrepancy');proof['actual_discrepancy']=after;save(folder,'writers-discrepancy-complete',proof);return proof
