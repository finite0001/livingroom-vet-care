"""Exact selected pure constructors from complete-integration-native-worker-runtime-v3/return_v2_fixture.py; no old context/owner SQL."""
import json,re,uuid

ACTIONS=('intake','dispose','restock','retract_disposal','retract_restock','retract_intake')

EVENT_KINDS=tuple('record_native_dispense_return_v2:'+x for x in ACTIONS)

EXPECTED_BALANCES=(('2.000','0.000','2.000','0.000','0.000'),('2.000','0.000','1.000','1.000','0.000'),('2.000','0.000','0.000','1.000','1.000'),('2.000','0.000','1.000','0.000','1.000'),('2.000','0.000','2.000','0.000','0.000'),('0.000','2.000','0.000','0.000','0.000'))

def uid(v):
 if type(v)is not str or str(uuid.UUID(v))!=v or int(uuid.UUID(v))==0:raise ValueError('Canonical actual native identity required')
 return v

def target(domain):return dict(authorization_id=uid(domain['authorization']),pet_id=uid(domain['pet']),dispense_id=uid(domain['dispense']))

def read_request(domain):return dict(p_authorization_id=uid(domain['authorization']),p_pet_id=uid(domain['pet']),p_dispense_id=uid(domain['dispense']))

def actual_allocation(domain,value,lot):
 if type(value)is not dict or value.get('version')!=2 or value.get('target')!=target(domain)or type(value.get('allocations'))is not list or len(value['allocations'])!=1:raise ValueError('Genuine singular V2 return balance required')
 a=value['allocations'][0]
 if a.get('lot_id')!=uid(lot)or a.get('dispensed_quantity')!='2.000'or a.get('remaining_returnable_quantity')!='2.000'or any(a.get(k)!='0.000'for k in('returned_quantity','held_quantity','disposed_quantity','restocked_quantity')):raise ValueError('Actual initial original allocation2 required')
 return uid(a['allocation_id'])

def actual_head(index,domain,value,allocation,lot):
 if type(index)is not int or index not in range(6)or type(value)is not dict or value.get('version')!=2 or value.get('target')!=target(domain):raise ValueError('Actual V2 read after fixed action required')
 head=value.get('head')
 if type(head)is not dict or set(head)!={'event_id','version','record_hash'}or head.get('event_id')!=uid(domain[ACTIONS[index]])or type(head.get('version'))is not int or head['version']!=index+1 or type(head.get('record_hash'))is not str or not re.fullmatch('[0-9a-f]{64}',head['record_hash']):raise ValueError('Actual exact canonical head required')
 rows=value.get('allocations')
 if type(rows)is not list or len(rows)!=1 or rows[0].get('allocation_id')!=uid(allocation)or rows[0].get('lot_id')!=uid(lot)or rows[0].get('dispensed_quantity')!='2.000':raise ValueError('Actual original allocation membership changed')
 fields=('returned_quantity','remaining_returnable_quantity','held_quantity','disposed_quantity','restocked_quantity')
 if tuple(rows[0].get(k)for k in fields)!=EXPECTED_BALANCES[index]:raise ValueError('Canonical six-step stock/custody conservation differs')
 return dict(head)

def intent(index,domain,allocation,heads):
 if type(index)is not int or index not in range(6):raise ValueError('Fixed six-action source path required')
 action=ACTIONS[index];ordinary=index<3;intake=index==0;correction=None
 if not ordinary:
  source={'retract_disposal':'dispose','retract_restock':'restock','retract_intake':'intake'}[action]
  h=heads.get(source)
  if type(h)is not dict or h.get('event_id')!=uid(domain[source])or type(h.get('record_hash'))is not str or not re.fullmatch('[0-9a-f]{64}',h['record_hash']):raise ValueError('Previously read real canonical correction source required')
  correction=dict(event_id=h['event_id'],record_hash=h['record_hash'])
 return dict(target=target(domain),action=action,intake_id=None if intake else uid(domain['intake']),correction_target=correction,discrepancy_id=None,allocations=[dict(allocation_id=uid(allocation),quantity='2.000'if index in(0,5)else'1.000')],custody='clinic_retained'if intake else None,package_condition='sealed_intact'if intake else None,storage_history='controlled'if intake else None,reason='Synthetic V2 custody correction engineering only',note='Synthetic '+action+'; no real medicine or client')

def attestations(action):return dict(reviewed_physical_facts=True,intake_claim_incorrect=action=='retract_intake',remains_physically_held=action in('retract_disposal','retract_restock'),was_not_destroyed=action=='retract_disposal',removed_from_available_stock=action=='retract_restock')

def arguments(index,domain,allocation,heads,preview,actor):
 wanted=intent(index,domain,allocation,heads)
 if type(preview)is not dict or preview.get('version')!=2 or preview.get('actor_id')!=uid(actor['id'])or preview.get('allowed')is not True or preview.get('blockers')!=[]or type(preview.get('context'))is not dict or preview['context'].get('intent')!=wanted or preview['context'].get('target')!=target(domain)or type(preview.get('context_hash'))is not str or not re.fullmatch('[0-9a-f]{64}',preview['context_hash']):raise ValueError('Actual allowed V2 preview/identity/intent required')
 c=preview['context'];h=c.get('head');ds=c.get('discrepancy_head')
 if type(h)is not dict or set(h)!={'event_id','version','record_hash'}or type(h.get('version'))is not int or h['version']!=index or ds!=dict(event_id=None,version=0,record_hash=None)or c.get('original_pickup')is not None:raise ValueError('Actual expected V2 return/discrepancy/no-pickup state differs')
 if index==0:
  if h!=dict(event_id=None,version=0,record_hash=None):raise ValueError('Initial empty head required')
 elif h!=heads[ACTIONS[index-1]]:raise ValueError('Latest head must equal actual preceding public read')
 if index==2:
  if c.get('policy',{}).get('version')!=1 or c.get('policy',{}).get('enabled')is not True or any(c.get('intake',{}).get(k)!=v for k,v in dict(custody='clinic_retained',package_condition='sealed_intact',storage_history='controlled').items()):raise ValueError('Actual restock commissioning/immutable custody required')
 return dict(request=dict(intent=wanted,expected_context_hash=preview['context_hash'],expected_head=h,expected_discrepancy_head=ds,attest_review=True,attest_restock=index==2,physical_attestations=attestations(ACTIONS[index])))
