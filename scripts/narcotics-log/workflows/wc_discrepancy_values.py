"""Exact selected pure constructors from complete-integration-native-worker-runtime-v3/discrepancy_fixture.py; no old context/owner SQL."""
import json,re,uuid

EVENT_KEYS=('dispense','intake','report_a','note_a','retract_intake','resolve_a','report_b','confirm_b')

EVENT_KINDS=('record_native_dispense','record_native_dispense_return_v2:intake','record_native_return_discrepancy:report','record_native_return_discrepancy:note','record_native_dispense_return_v2:retract_intake','record_native_return_discrepancy:resolve_corrected','record_native_return_discrepancy:report','record_native_return_discrepancy:resolve_confirmed_original')

SUPPORTED=tuple(dict.fromkeys(EVENT_KINDS))

WRITERS=tuple(kind.split(':')[0]for kind in EVENT_KINDS)

STATE_KEYS={'version','target','authorization_hash','dispense_document_hash','dispensed_at','head','allocations','replay','discrepancies'}

def uid(v):
 if type(v)is not str or str(uuid.UUID(v))!=v or int(uuid.UUID(v))==0:raise ValueError('Canonical actual identity required')
 return v

def digest(v):
 if type(v)is not str or not re.fullmatch('[0-9a-f]{64}',v):raise ValueError('Actual complete record hash required')
 return v

def target(d):return dict(authorization_id=uid(d['authorization']),pet_id=uid(d['pet']),dispense_id=uid(d['dispense']))

def read_request(d):return dict(p_authorization_id=uid(d['authorization']),p_pet_id=uid(d['pet']),p_dispense_id=uid(d['dispense']))

def require_head(value,event,version):
 if type(value)is not dict or set(value)!={'event_id','version','record_hash'}or type(value.get('version'))is not int or value['version']!=version or value['event_id']!=event:raise ValueError('Actual exact expected head required')
 if version==0:
  if event is not None or value['record_hash']is not None:raise ValueError('Empty canonical head differs')
 else:uid(event);digest(value['record_hash'])
 return value

def native_state(index,value,d,lot,original_actor,allocation=None,intake_head=None):
 if type(index)is not int or index not in range(8)or type(value)is not dict or set(value)!=STATE_KEYS or type(value['version'])is not int or value['version']!=2 or value['target']!=target(d):raise ValueError('Actual fixed native V2 read required')
 digest(value['authorization_hash']);digest(value['dispense_document_hash'])
 R=(None,0)if index==0 else(d['intake'],1)if index<4 else(d['retract_intake'],2)
 require_head(value['head'],*R)
 disc_events={0:(None,0),1:(None,0),2:(d['report_a'],1),3:(d['note_a'],2),4:(d['note_a'],2),5:(d['resolve_a'],3),6:(d['report_b'],4),7:(d['confirm_b'],5)}
 ds=value['discrepancies']
 if type(ds)is not dict or set(ds)!={'version','head','open_case_count','held_lot_ids','cases'}or type(ds['version'])is not int or ds['version']!=1:raise ValueError('Actual complete discrepancy snapshot required')
 require_head(ds['head'],*disc_events[index])
 rows=value['allocations']
 if type(rows)is not list or len(rows)!=1 or rows[0].get('lot_id')!=uid(lot)or rows[0].get('dispensed_quantity')!='2.000':raise ValueError('Actual singular original allocation2 required')
 a=uid(rows[0]['allocation_id'])
 if allocation is not None and a!=uid(allocation):raise ValueError('Original allocation changed')
 quantities=('0.000','2.000','0.000')if index==0 else('2.000','0.000','2.000')if index<4 else('1.000','1.000','1.000')
 if tuple(rows[0].get(k)for k in('returned_quantity','remaining_returnable_quantity','held_quantity'))!=quantities or any(rows[0].get(k)!='0.000'for k in('disposed_quantity','restocked_quantity')):raise ValueError('Fixed physical stock conservation differs')
 cases=ds['cases'];wanted=[]if index<2 else['report_a']if index<6 else['report_a','report_b']
 if type(cases)is not list or len(cases)!=len(wanted):raise ValueError('Exact actual case membership required')
 opened=0
 for row,key in zip(cases,wanted):
  if type(row)is not dict or set(row)!={'id','source','allocations','status','report','decisions'}or row['id']!=uid(d[key]):raise ValueError('Exact actual report/case binding required')
  require_head(intake_head,d['intake'],1)
  source=dict(event_id=d['intake'],record_hash=intake_head['record_hash'])
  expected_alloc=[dict(allocation_id=a,lot_id=uid(lot),quantity='1.000')]
  if row['source']!=source or row['allocations']!=expected_alloc:raise ValueError('Exact ordinary source and case quantity required')
  status=('open'if index<5 else'resolved_corrected')if key=='report_a'else('open'if index==6 else'resolved_confirmed_original')
  if row['status']!=status:raise ValueError('Actual exact case lifecycle differs')
  opened+=status=='open'
  report=row['report']
  if type(report)is not dict or type(report.get('version'))is not int or report['version']!=1 or report.get('id')!=d[key]or report.get('action')!='report'or report.get('case_id')!=d[key]or report.get('target')!=target(d)or report.get('source')!=source or report.get('allocations')!=expected_alloc or report.get('actor',{}).get('id')!=uid(original_actor):raise ValueError('Actual attributed report/source tuple differs')
  digest(report['record_hash'])
  keys=([]if index==2 else['note_a']if index in(3,4)else['note_a','resolve_a'])if key=='report_a'else([]if index==6 else['confirm_b'])
  decisions=row['decisions']
  if type(decisions)is not list or len(decisions)!=len(keys):raise ValueError('Actual complete case decisions required')
  for decision,name in zip(decisions,keys):
   action={'note_a':'note','resolve_a':'resolve_corrected','confirm_b':'resolve_confirmed_original'}[name]
   if type(decision.get('version'))is not int or decision['version']!=1 or decision.get('id')!=d[name]or decision.get('case_id')!=d[key]or decision.get('action')!=action or decision.get('target')!=target(d)or decision.get('source')!=source or decision.get('allocations')!=expected_alloc or decision.get('actor',{}).get('id')!=original_actor:raise ValueError('Actual complete decision binding differs')
   digest(decision['record_hash'])
 if type(ds['open_case_count'])is not int or ds['open_case_count']!=opened or ds['held_lot_ids']!=([lot]if opened else[]):raise ValueError('Actual discrepancy hold count/lots differ')
 return a

def case_for(value,d,key,intake_head):
 cases=[row for row in value['discrepancies']['cases']if row['id']==uid(d[key])]
 if len(cases)!=1 or cases[0]['status']!='open'or cases[0]['source']!=dict(event_id=d['intake'],record_hash=require_head(intake_head,d['intake'],1)['record_hash']):raise ValueError('Actual open matching source case required')
 return cases[0]

def return_intent(index,d,allocation,value,intake_head):
 if index not in(1,4):raise ValueError('Only fixed genuine I2/retractI1 path')
 intake=index==1
 if not intake:case_for(value,d,'report_a',intake_head)
 return dict(target=target(d),action='intake'if intake else'retract_intake',intake_id=None if intake else uid(d['intake']),correction_target=None if intake else dict(event_id=d['intake'],record_hash=intake_head['record_hash']),discrepancy_id=None if intake else uid(d['report_a']),allocations=[dict(allocation_id=uid(allocation),quantity='2.000'if intake else'1.000')],custody='clinic_retained'if intake else None,package_condition='sealed_intact'if intake else None,storage_history='controlled'if intake else None,reason='Synthetic controlled discrepancy engineering only',note='Synthetic intake/correction; no real physical medicine')

def discrepancy_intent(index,d,allocation,value,intake_head):
 if index not in(2,3,5,6,7):raise ValueError('One fixed actual discrepancy step required')
 action={2:'report',3:'note',5:'resolve_corrected',6:'report',7:'resolve_confirmed_original'}[index]
 key='report_b'if index>=6 else'report_a'
 if action!='report':case_for(value,d,key,intake_head)
 correction_ids=[]
 if index==5:
  require_head(value['head'],d['retract_intake'],2);correction_ids=[d['retract_intake']]
 return dict(target=target(d),action=action,case_id=None if action=='report'else uid(d[key]),source=dict(event_id=uid(d['intake']),record_hash=require_head(intake_head,d['intake'],1)['record_hash']),allocations=[dict(allocation_id=uid(allocation),quantity='1.000')],observation='Synthetic independent '+action+' engineering observation only; no real medicine/client',correction_ids=correction_ids)

def arguments(index,d,allocation,value,intake_head,preview,actor):
 is_return=index in(1,4);intent=return_intent(index,d,allocation,value,intake_head)if is_return else discrepancy_intent(index,d,allocation,value,intake_head)
 version=2 if is_return else 1
 if type(preview)is not dict or type(preview.get('version'))is not int or preview['version']!=version or preview.get('actor_id')!=uid(actor['id'])or preview.get('allowed')is not True or preview.get('blockers')!=[]or type(preview.get('context'))is not dict:raise ValueError('Actual allowed matching preview required')
 digest(preview.get('context_hash'));c=preview['context']
 if c.get('target')!=target(d)or c.get('intent')!=intent:raise ValueError('Actual preview intent/target differs')
 if is_return:
  if c.get('head')!=value['head']or c.get('discrepancy_head')!=value['discrepancies']['head']or c.get('discrepancies')!=value['discrepancies']or c.get('original_pickup')is not None:raise ValueError('Actual V2 return/hold heads differ')
  return dict(request=dict(intent=intent,expected_context_hash=preview['context_hash'],expected_head=c['head'],expected_discrepancy_head=c['discrepancy_head'],attest_review=True,attest_restock=False,physical_attestations=dict(reviewed_physical_facts=True,intake_claim_incorrect=index==4,remains_physically_held=False,was_not_destroyed=False,removed_from_available_stock=False)))
 if c.get('return_head')!=value['head']or c.get('discrepancy_head')!=value['discrepancies']['head']or c.get('discrepancies')!=value['discrepancies']:raise ValueError('Actual discrepancy/return heads differ')
 return dict(request=dict(intent=intent,expected_context_hash=preview['context_hash'],expected_return_head=c['return_head'],expected_discrepancy_head=c['discrepancy_head'],attest_physical_review=True,attest_original_quantities_custody_and_stock_accurate=index==7))
