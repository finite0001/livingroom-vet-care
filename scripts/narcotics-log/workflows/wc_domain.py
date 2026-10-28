"""Actual original clinical/native public API setup, no owner domain inserts."""
from copy import deepcopy
import full121_values as v
import full121_queries as sql
import wc_clinical_values as clinical
import wc_native_values as native
RPCS=('save_client','save_patient','create_billing_invoice','save_patient_anesthesia_record','read_patient_treatment_alerts','configure_native_prescriber','save_native_prescription_draft','preview_native_prescription_sign','sign_native_prescription','preview_native_dispense','preview_native_pickup','preview_native_dispense_correction','read_native_dispense_returns','preview_native_dispense_return','read_native_dispense_returns_v2','preview_native_dispense_return_v2','preview_native_return_discrepancy','read_managed_stock_intent_authorization_v1')
def rpc(ctx,runtime,folder,save,label,name,args):
 if name not in RPCS:raise ValueError('Fixed actual original domain API required')
 runtime.remaining(1);r=ctx['http'].rpc(name,args,ctx['users'][0]);save(folder,'writers-domain-'+label,r)
 ctx.setdefault('writer_domain_calls',[]).append(dict(rpc=name,actor_id=ctx['users'][0]['id'],session_id=ctx['users'][0]['session_id']));return r

def patient(ctx,runtime,folder,save):
 a=ctx['users'][0];household=clinical.client_request(a['id']);household['p_mailing_address']='Synthetic engineering household address'
 c=rpc(ctx,runtime,folder,save,'client','save_client',household);client=v.uid(c['id'])
 p=rpc(ctx,runtime,folder,save,'patient','save_patient',clinical.patient_request(client));pet=v.uid(p['id'])
 if p['client_id']!=client:raise ValueError('Actual created patient household differs')
 invoice=v.uid();i=rpc(ctx,runtime,folder,save,'invoice','create_billing_invoice',clinical.invoice_request(invoice,client))
 if i['id']!=invoice or i['client_id']!=client or i['created_by']!=a['id']or i['version']!=1:raise ValueError('Actual draft invoice differs')
 d=dict(client=client,pet=pet,invoice=invoice);ctx['writer_domain']=deepcopy(d);return d

def prescription(ctx,runtime,folder,query,save):
 d=patient(ctx,runtime,folder,save);a=ctx['users'][0]
 for key in('configure_operation','draft_operation','draft','authorization','dispense','pickup','intake','report_a'):d[key]=v.uid()
 configured=rpc(ctx,runtime,folder,save,'prescriber','configure_native_prescriber',dict(p_id=d['configure_operation'],p_request=native.prescriber_request(a['id'])))
 day=query('writers-denver-date',sql.read("select jsonb_build_object('date',(clock_timestamp()at time zone'America/Denver')::date::text);"))['date']
 drafted=rpc(ctx,runtime,folder,save,'prescription-draft','save_native_prescription_draft',dict(p_id=d['draft_operation'],p_request=native.draft_request(d,ctx['ids']['product'],day)))
 preview=rpc(ctx,runtime,folder,save,'prescription-preview','preview_native_prescription_sign',dict(p_draft_id=d['draft'],p_expected_version=1))
 # The profile name is actual source data (identity_fixture sets it), not a
 # replacement identity or a caller-created authorization row.
 signer=deepcopy(a);signer['name']=preview['context']['prescriber']['name']
 if signer['name']!='LRV synthetic original':raise ValueError('Actual original source profile name differs')
 signed=rpc(ctx,runtime,folder,save,'prescription-sign','sign_native_prescription',dict(p_id=d['authorization'],p_request=native.sign_request(d,preview,signer)))
 if signed['actor_id']!=a['id']or signed['id']!=d['authorization']or signed['operation']!='sign'or signed['result']['id']!=d['authorization']:raise ValueError('Actual original signed prescription missing')
 ctx['writer_domain']=deepcopy(d);return d

def authorization_recovery(ctx,runtime,folder,save,proof,domain):
 r=rpc(ctx,runtime,folder,save,'owned-authorization','read_managed_stock_intent_authorization_v1',dict(p_request=proof['pointer']))
 # This wrapper returns the original complete document or SQL NULL directly.
 if r is None or r['id']!=domain['authorization']or r['pet_id']!=domain['pet']:raise ValueError('Actual owned original authorization document differs')
 return r
