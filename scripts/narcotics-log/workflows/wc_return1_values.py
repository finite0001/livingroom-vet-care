"""Exact selected pure constructors from complete-integration-return-v1-runtime-v1/return_fixture.py; no old context/owner SQL."""
import json,re,uuid

ACTIONS=('intake','dispose','restock')

EVENT_KINDS=tuple('record_native_dispense_return:'+x for x in ACTIONS)

def uid(value):
 if type(value)is not str or str(uuid.UUID(value))!=value or int(uuid.UUID(value))==0:raise ValueError('Actual canonical return identity required')
 return value

def target(domain):return dict(authorization_id=uid(domain['authorization']),pet_id=uid(domain['pet']),dispense_id=uid(domain['dispense']))

def read_request(domain):return dict(p_authorization_id=uid(domain['authorization']),p_pet_id=uid(domain['pet']),p_dispense_id=uid(domain['dispense']))

def actual_allocation(domain,value,lot):
 if type(value)is not dict or type(value.get('version'))is not int or value.get('version')!=1 or value.get('target')!=target(domain)or type(value.get('allocations'))is not list or len(value['allocations'])!=1:raise ValueError('Actual singular V1 native return balance required')
 row=value['allocations'][0]
 if row.get('lot_id')!=uid(lot)or row.get('dispensed_quantity')!='2.000'or row.get('remaining_returnable_quantity')!='2.000'or any(row.get(k)!='0.000'for k in ('returned_quantity','held_quantity','disposed_quantity','restocked_quantity')):raise ValueError('Actual original prepared2.000 allocation required')
 return uid(row['allocation_id'])

def intent(index,domain,allocation):
 if type(index)is not int or index not in range(3):raise ValueError('Fixed three return actions required')
 intake=index==0
 return dict(target=target(domain),action=ACTIONS[index],intake_id=None if intake else uid(domain['intake']),allocations=[dict(allocation_id=uid(allocation),quantity='2.000'if intake else'1.000')],custody='clinic_retained'if intake else None,package_condition='sealed_intact'if intake else None,storage_history='controlled'if intake else None,reason='Synthetic physical return engineering fixture only',note='Synthetic '+ACTIONS[index]+'; no real medicine or client')

def arguments(index,domain,allocation,preview,actor):
 expected=intent(index,domain,allocation)
 if type(preview)is not dict or type(preview.get('version'))is not int or preview['version']!=1 or preview.get('actor_id')!=uid(actor['id'])or preview.get('allowed')is not True or preview.get('blockers')!=[]or type(preview.get('context'))is not dict or preview['context'].get('target')!=target(domain)or preview['context'].get('intent')!=expected or not re.fullmatch('[0-9a-f]{64}',preview.get('context_hash','')):raise ValueError('Genuine allowed return preview exact actor/intent/hash required')
 head=preview['context'].get('head')
 if type(head)is not dict or set(head)!={'event_id','version','record_hash'}or type(head.get('version'))is not int or head['version']!=index:raise ValueError('Exact current native return head required')
 if index==0:
  if head['event_id']is not None or head['record_hash']is not None:raise ValueError('Empty initial return head required')
 else:
  uid(head['event_id'])
  if type(head['record_hash'])is not str or not re.fullmatch('[0-9a-f]{64}',head['record_hash']):raise ValueError('Actual preceding return hash required')
 if preview['context'].get('original_pickup')is not None:raise ValueError('Closed restock fixture must have NO original pickup')
 if index==2:
  policy=preview['context'].get('policy')
  if type(policy)is not dict or policy.get('version')!=1 or policy.get('enabled')is not True or preview['context'].get('intake',{}).get('custody')!='clinic_retained'or preview['context'].get('intake',{}).get('package_condition')!='sealed_intact'or preview['context'].get('intake',{}).get('storage_history')!='controlled':raise ValueError('Actual commissioned/restock facts required')
 return dict(request=dict(intent=expected,expected_context_hash=preview['context_hash'],expected_head=head,attest_review=True,attest_restock=index==2))
