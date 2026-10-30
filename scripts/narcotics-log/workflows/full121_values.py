"""Finite source-owned synthetic engineering protocol values; no Auth or I/O."""
from copy import deepcopy
from datetime import datetime,timedelta,timezone
from hashlib import sha256
from uuid import UUID,uuid4
import re

NOTE='Synthetic isolated engineering fixture; not clinic settings or a real physical observation.'
UTC6=re.compile(r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$')
def uid(value=None):
 value=str(uuid4())if value is None else value
 if type(value)is not str or str(UUID(value))!=value or UUID(value).int==0:raise ValueError('Canonical nonzero UUID required')
 return value

def instant(value):
 if type(value)is not str or not UTC6.fullmatch(value):raise ValueError('Exact UTC6 source clock required')
 datetime.strptime(value,'%Y-%m-%dT%H:%M:%S.%fZ');return value

def keys(value,names):
 if type(value)is not dict or set(value)!=set(names):raise ValueError('Closed source protocol fields differ')
 return value

def frame(value):
 if value is None:return b'n'
 if type(value)is bool:return b't'if value else b'f'
 if type(value)is int and 0<=value<=2147483647:return b'i'+str(value).encode()+b';'
 if type(value)is str:
  raw=value.encode('utf8',errors='strict')
  if b'\0'in raw:raise ValueError('NUL in source protocol')
  return b's'+str(len(raw)).encode()+b':'+raw
 if type(value)is list:return b'a'+str(len(value)).encode()+b':'+b''.join(frame(x)for x in value)
 if type(value)is dict:return b'o'+str(len(value)).encode()+b':'+b''.join(frame(k)+frame(value[k])for k in sorted(value))
 raise ValueError('Unsupported protocol scalar; no floating clinical values')

def digest(domain,value):return sha256(domain.encode()+b'\0'+frame(value)).hexdigest()

def pointer(action,actor,operation,product,site):
 return dict(schema_version=1,actor_id=uid(actor),operation_id=uid(operation),action=action,product_id=product,site_id=site)

def verify_admin(reply,p,request=None,state=None):
 keys(reply,('schema_version','state','data'));data=keys(reply['data'],('pointer','preparation','receipt'))
 if reply['schema_version']!=1 or data['pointer']!=p or(state is not None and reply['state']!=state):raise ValueError('Actual admin response/pointer/state mismatch')
 prep=data['preparation'];receipt=data['receipt']
 if prep is not None:
  keys(prep,('request','request_digest','created_at','expires_at','source_state','summary'))
  if {k:prep['request'][k]for k in p}!=p or(request is not None and prep['request']!=request):raise ValueError('Actual prepared original request changed')
  if prep['request_digest']!=digest('lrv-controlled-stock-administration-request-v1',prep['request']):raise ValueError('Actual prepared request digest differs')
  start=datetime.strptime(instant(prep['created_at']),'%Y-%m-%dT%H:%M:%S.%fZ');end=datetime.strptime(instant(prep['expires_at']),'%Y-%m-%dT%H:%M:%S.%fZ')
  if end-start!=timedelta(minutes=15):raise ValueError('Journal preparation expiry differs')
 if(reply['state']=='saved')!=(receipt is not None):raise ValueError('Terminal receipt state differs')
 if receipt is not None:
  keys(receipt,tuple(p)+('request_digest','preparation_id','result_ref','recorded_at','receipt_digest'))
  if {k:receipt[k]for k in p}!=p or receipt['preparation_id']!=p['operation_id']or prep is None or receipt['request_digest']!=prep['request_digest']:raise ValueError('Admin receipt original request differs')
  ref=keys(receipt['result_ref'],('kind','id','version'));kind={'site_register':'site','stock_opening':'opening','stock_policy':'stock_policy','review_administration':'configuration','review_configuration':'configuration'}[p['action']]
  if ref['kind']!=kind or ref['id']!=p['operation_id']or type(ref['version'])is not str or not re.fullmatch('[1-9][0-9]*',ref['version'])or int(ref['version'])>2147483647:raise ValueError('Admin exact result reference differs')
  instant(receipt['recorded_at'])
  if receipt['receipt_digest']!=digest('lrv-controlled-stock-administration-receipt-v1',{k:v for k,v in receipt.items()if k!='receipt_digest'}):raise ValueError('Admin receipt independent digest differs')
 return deepcopy(reply)

def stock_policy(site,kinds,witness='none'):
 if witness not in('none','c2_required'):raise ValueError('Source-fixed witness scenario required')
 rules={}
 for kind in kinds:
  basis='correction_assertion'if kind.startswith('record_native_dispense_return_v2:retract_')else 'discrepancy_assertion'if kind.startswith('record_native_return_discrepancy:')else 'annotation'if kind.startswith('append_native_dispense_correction:')else 'physical_record'
  rules[kind]=dict(enabled=True,roles=['DVM'],basis=basis,witness=witness if kind=='adjust_inventory'else 'none',secondary_review=True,location_kinds=['clinic'])
 return dict(site_ids=[uid(site)],permissions=rules,clinic_retained_return_permitted=True,review_reference=NOTE)

def count_settings():
 return dict(observation_enabled=True,management_enabled=True,read_enabled=True,reconciliation_enabled=True,methods=['manual_count'],
 observer_roles=['DVM'],manager_roles=['DVM'],reader_roles=['DVM'],reconciliation_preparer_roles=['DVM'],reconciliation_approver_roles=['DVM'],reconciliation_executor_roles=['DVM'],reconciliation_confirmer_roles=['DVM'],reconciliation_resolver_roles=['DVM'],
 max_observation_age_seconds=7200,max_reconciliation_preparation_age_seconds=900,max_reconciliation_approval_age_seconds=900,max_reconciliation_confirmation_age_seconds=900,
 meaning_text=NOTE,meaning_version='synthetic-engineering-v1',reconciliation_meaning_text=NOTE,reconciliation_meaning_version='synthetic-engineering-v1')
