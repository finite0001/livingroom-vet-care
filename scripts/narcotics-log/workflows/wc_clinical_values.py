"""Exact selected pure constructors from complete-integration-clinical-runtime-v3/clinical_fixture.py; no old context/owner SQL."""
import json,uuid

WRITERS=('record_patient_treatment','record_anesthesia_drug_administration')

QUANTITIES=('0.250','1.500')

def uid(value):
 if type(value)is not str or str(uuid.UUID(value))!=value or int(uuid.UUID(value))==0:raise ValueError('Canonical fixture UUID required')
 return value

def client_request(actor):
 return dict(p_actor_id=uid(actor),p_client_id=None,p_expected_version=None,p_first_name='Synthetic',p_last_name='Clinical household',p_primary_phone='+18055550199',p_primary_email='lrv-closed-clinical@example.invalid',p_preferred_channel='EMAIL',p_mailing_address='',p_housecall_address='')

def patient_request(client):
 return dict(p_id=None,p_client_id=uid(client),p_expected_version=None,p_name='Synthetic clinical patient',p_species='Canine',p_breed='Synthetic',p_dob=None,p_birth_date_precision='unknown',p_color='',p_sex='unknown',p_neuter_status='unknown',p_microchip_id='',p_archived_at=None,p_deceased_at=None)

def invoice_request(identifier,client):return dict(p_id=uid(identifier),p_client_id=uid(client))

def anesthesia_request(identifier,pet,started_at):
 return dict(p_id=uid(identifier),p_pet_id=uid(pet),p_expected_version=None,p_values=dict(procedure_name='Synthetic procedure',started_at=started_at,team='Synthetic team',source='manual',assessment='Synthetic assessment',plan='Synthetic plan'))

def arguments(index,ids,domain,administered_at,alert_hash):
 if type(index)is not int or index not in(0,1):raise ValueError('Two literal clinical fixtures only')
 if type(alert_hash)is not str or len(alert_hash)!=64 or any(x not in'0123456789abcdef'for x in alert_hash):raise ValueError('Actual alert source hash required')
 request=dict(pet_id=uid(domain['pet']),lot_id=uid(ids['lot']),invoice_id=uid(domain['invoice']),quantity=QUANTITIES[index],dose='Synthetic recorded dose only',route='Synthetic route',site='',veterinarian='Synthetic veterinarian',veterinarian_license='SYNTHETIC',administered_at=administered_at,next_due_on=None,alert_review=dict(source_hash=alert_hash,acknowledged=True))
 if index==0:return dict(request=request)
 request.pop('pet_id');request.pop('next_due_on')
 return dict(record_id=uid(domain['anesthesia']),pet_id=uid(domain['pet']),request=request)
