"""Exact selected pure constructors from complete-integration-native-worker-runtime-v3/native_fixture.py; no old context/owner SQL."""
import json,re,uuid

WRITERS=('record_native_dispense','record_native_pickup')

QUANTITY='2.000'

RPCS=('configure_native_prescriber','save_native_prescription_draft','preview_native_prescription_sign','sign_native_prescription','preview_native_dispense','preview_native_pickup')

def uid(v):
 if type(v)is not str or str(uuid.UUID(v))!=v or int(uuid.UUID(v))==0:raise ValueError('Canonical actual fixture UUID required')
 return v

def h(v):
 if type(v)is not str or not re.fullmatch('[0-9a-f]{64}',v):raise ValueError('Actual preview commitment required')
 return v

def prescriber_request(actor):
 return dict(user_id=uid(actor),expected_version=None,attest_review=True,fields=dict(active=True,license_number='SYNTHETIC',license_state='CO',license_expires_on='2099-12-31',practice_name='Synthetic practice',practice_address='Synthetic engineering address',practice_phone=None,clinical_review_note='Synthetic closed local engineering fixture only'))

def fields(product,starts_on):
 if type(starts_on)is not str or not re.fullmatch(r'20[2-9][0-9]-[0-9]{2}-[0-9]{2}',starts_on):raise ValueError('Actual server Denver date required')
 return dict(encounter_id=None,medication=dict(name='Synthetic medication',strength='Synthetic strength',form='Synthetic form',directions='Synthetic directions only',route='Synthetic route'),quantity_per_fill=QUANTITY,unit='tablet',refills_authorized=0,fulfillment_mode='practice_stock',product_id=uid(product),starts_on=starts_on,expires_on='2099-12-31')

def draft_request(domain,product,starts_on):
 return dict(draft_id=uid(domain['draft']),pet_id=uid(domain['pet']),client_id=uid(domain['client']),expected_version=None,fields=fields(product,starts_on))

def sign_request(domain,preview,actor):
 if type(preview)is not dict or preview.get('actor_id')!=uid(actor['id'])or preview.get('draft_id')!=uid(domain['draft'])or preview.get('pet_id')!=uid(domain['pet'])or preview.get('context',{}).get('prescriber',{}).get('name')!=actor['name']:raise ValueError('Actual sign preview identity differs')
 return dict(draft_id=domain['draft'],pet_id=domain['pet'],expected_version=1,expected_context_hash=h(preview['context_hash']),signature_name=actor['name'],attest_review=True)

def dispense_target(domain,ids):
 return dict(authorization_id=uid(domain['authorization']),pet_id=uid(domain['pet']),slot_index=0,expected_slot_version=None,invoice_id=uid(domain['invoice']),quantity=QUANTITY,allocations=[dict(lot_id=uid(ids['lot']),quantity=QUANTITY)],refill=None)

def dispense_request(domain,ids,preview):
 if type(preview)is not dict:raise ValueError('Actual native dispense preview required')
 return dict(request={**dispense_target(domain,ids), 'expected_context_hash':h(preview['context_hash']),'reason':'Synthetic managed package preparation','attest_alert_review':True,'attest_dispense_review':True})

def pickup_request(domain,preview):
 if type(preview)is not dict:raise ValueError('Actual native pickup preview required')
 # Preserve supported historical mixed-case request UUIDs. Canonical row/target
 # IDs remain lowercase; the original native UUID parser admits uppercase.
 return dict(request=dict(authorization_id=uid(domain['authorization']).upper(),pet_id=uid(domain['pet']).upper(),dispense_id=uid(domain['dispense']).upper(),expected_context_hash=h(preview['context_hash']),recipient_name='Synthetic recipient',recipient_relationship='Owner',reason='Synthetic complete handoff',attest_handoff=True,refill_close=None))
