"""Exact selected pure constructors from complete-integration-annotation-runtime-v2/annotation_fixture.py; no old context/owner SQL."""
import json,re,uuid

KINDS=('clinical_annotation','operational_annotation','pickup_amendment')

EVENT_KINDS=tuple('append_native_dispense_correction:'+kind for kind in KINDS)

def uid(value):
 if type(value)is not str or str(uuid.UUID(value))!=value or int(uuid.UUID(value))==0:raise ValueError('Actual canonical annotation identity required')
 return value

def preview_request(domain):return dict(p_authorization_id=uid(domain['authorization']),p_pet_id=uid(domain['pet']),p_dispense_id=uid(domain['dispense']))

def arguments(index,domain,preview,actor):
 if type(index)is not int or index not in range(3)or type(preview)is not dict or set(preview)!={'version','actor_id','context','context_hash','observed_at'}or type(preview.get('observed_at'))is not str or type(preview.get('version'))is not int or preview.get('version')!=1 or preview.get('actor_id')!=uid(actor['id'])or type(preview.get('context'))is not dict or not re.fullmatch('[0-9a-f]{64}',preview.get('context_hash','')):raise ValueError('Exact genuine correction preview required')
 target=dict(authorization_id=uid(domain['authorization']),pet_id=uid(domain['pet']),dispense_id=uid(domain['dispense']))
 if preview['context'].get('target')!=target:raise ValueError('Correction preview target differs')
 head=preview['context'].get('head')
 if type(head)is not dict or set(head)!={'event_id','version','record_hash'}or type(head['version'])is not int or head['version']!=index:raise ValueError('Actual sequential correction head required')
 if index==0:
  if head['event_id']is not None or head['record_hash']is not None:raise ValueError('Actual empty original correction head required')
 else:
  uid(head['event_id'])
  if type(head['record_hash'])is not str or not re.fullmatch('[0-9a-f]{64}',head['record_hash']):raise ValueError('Actual preceding record hash required')
 amendment=None
 if index==2:
  pickup=preview['context'].get('original_pickup')
  if type(pickup)is not dict or pickup.get('id')!=uid(domain['pickup'])or preview['context'].get('latest_pickup_amendment')is not None:raise ValueError('Actual original pickup/no previous amendment required')
  amendment=dict(original_pickup_id=domain['pickup'],disposition='recorded_in_error',handoff=None)
 return dict(request=dict(**target,kind=KINDS[index],expected_context_hash=preview['context_hash'],expected_head=head,reason='Synthetic correction engineering fixture; no real client or physical assertion',note='Synthetic '+KINDS[index]+' only; original stock and handoff quantities remain unchanged',amends_event_id=None,pickup_amendment=amendment,attest_review=True))
