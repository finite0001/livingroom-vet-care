"""Fixed owned loopback transport copied from source, not an old runtime/effects dictionary."""
import base64,hashlib,json,secrets,uuid,os,stat,re,time,http.client,socket
ORIGIN='http://127.0.0.1:64661'
COUNT4_RPCS={'start_controlled_count_v1', 'save_controlled_count_statement_v1', 'close_controlled_count_operation_v1', 'finalize_controlled_count_v1', 'read_controlled_count_operation_closure_v1', 'read_controlled_count_v1', 'discover_controlled_counts_v1', 'recover_controlled_count_operation_v1', 'cancel_controlled_count_v1'}
RPCS={'save_catalog_product','receive_inventory','prepare_controlled_stock_action','execute_controlled_stock_action','prepare_controlled_stock_action_v3','execute_controlled_stock_action_v3','publish_controlled_review_configuration_v3','prepare_controlled_record_review_v3','read_controlled_record_review_v3','execute_controlled_record_review_v3','get_controlled_record_review_event_v3','list_controlled_record_reviews_v3'}|COUNT4_RPCS
FULL_PROFILE_RPCS=frozenset(('approve_controlled_count_reconciliation_v1', 'attest_managed_stock_witness_v1', 'cancel_controlled_count_v1', 'close_controlled_count_operation_v1', 'close_controlled_count_operation_v2', 'close_controlled_stock_administration_operation_v1', 'close_managed_stock_intent_v1', 'close_managed_stock_witness_operation_v1', 'confirm_controlled_count_reconciliation_v1', 'discover_controlled_count_causes_v1', 'discover_controlled_counts_v1', 'execute_controlled_count_reconciliation_v1', 'execute_controlled_draft_review', 'execute_controlled_stock_administration_v1', 'execute_managed_stock_intent_v1', 'finalize_controlled_count_v1', 'list_controlled_count_investigations_v1', 'list_controlled_count_reconciliations_v1', 'list_controlled_count_scopes_v1', 'list_controlled_stock_administration_operations_v1', 'list_controlled_stock_administration_options_v1', 'list_managed_stock_witness_tasks_v1', 'prepare_controlled_count_reconciliation_v1', 'prepare_controlled_draft_review', 'prepare_controlled_stock_administration_v1', 'prepare_managed_stock_intent_v1', 'preview_controlled_stock_opening_v1', 'probe_controlled_stock_intent_v1', 'project_controlled_review_calendar_v1', 'publish_controlled_count_policy_v1', 'read_controlled_count_operation_closure_v1', 'read_controlled_count_operation_closure_v2', 'read_controlled_count_policy_v1', 'read_controlled_count_reconciliation_detail_v1', 'read_controlled_count_reconciliation_v1', 'read_controlled_count_v1', 'read_controlled_stock_administration_configuration_v1', 'read_controlled_stock_administration_operation_v1', 'read_current_stock_policy_v1', 'read_managed_stock_intent_v1', 'read_managed_stock_witness_operation_v1', 'read_managed_stock_witness_status_v1', 'read_managed_stock_witness_v1', 'receive_inventory', 'recover_controlled_count_operation_v1', 'resolve_controlled_count_cause_v1', 'save_catalog_product', 'save_controlled_count_statement_v1', 'start_controlled_count_v1'))
from wc_domain import RPCS as DOMAIN_RPCS
OPERATIONAL_RPCS=frozenset(('narcotics_recovery_probe_permissions_v1','list_narcotics_registers_v1','create_narcotics_register_v1','read_narcotics_register_v1','close_narcotics_register_operation_v1','preserve_narcotics_form_v1','read_narcotics_form_operation_v1','download_narcotics_form_v1'))
RPCS=RPCS|FULL_PROFILE_RPCS|frozenset(DOMAIN_RPCS)|{'record_patient_treatment'}|OPERATIONAL_RPCS
RAW_RESPONSE_PATHS=frozenset({'/rest/v1/rpc/prepare_managed_stock_intent_v1','/rest/v1/rpc/read_managed_stock_witness_v1','/rest/v1/rpc/execute_managed_stock_intent_v1'})
ALLOWED_PATHS={'/auth/v1/admin/users','/auth/v1/token?grant_type=password'}|{'/rest/v1/rpc/'+name for name in RPCS}
def sha(raw):return hashlib.sha256(raw).hexdigest()

def literal(value):return "'"+str(value).replace("'","''")+"'"

def sql_json(value):return literal(json.dumps(value,sort_keys=True,separators=(',',':')))+'::jsonb'

def uid():return str(uuid.uuid4())

def canonical_uuid(value):
 if type(value)is not str or str(uuid.UUID(value))!=value or int(uuid.UUID(value))==0:raise ValueError('Canonical UUID required')
 return value

def save(folder,name,value):
 raw=(json.dumps(value,sort_keys=True,indent=2)+'\n').encode();(folder/(name+'.json')).write_bytes(raw)

class Http:
 def __init__(self,runtime,folder,anon,service):
  self.runtime=runtime;self.folder=folder;self.anon=anon;self.service=service;self.calls=[]
 def post(self,path,payload,token=None,admin=False):
  if path not in ALLOWED_PATHS:raise ValueError('Unadmitted HTTP path')
  if type(admin)is not bool or admin and path!='/auth/v1/admin/users':raise ValueError('Service key restricted to declared identity creation')
  self.runtime.verify();raw=json.dumps(payload,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
  if len(raw)>262144:raise ValueError('HTTP request cap exceeded')
  headers={'Content-Type':'application/json','apikey':self.service if admin else self.anon}
  if path=='/rest/v1/rpc/save_catalog_product':headers['Accept']='application/vnd.pgrst.object+json'
  if token is not None:headers['Authorization']='Bearer '+token
  if admin:headers['Authorization']='Bearer '+self.service
  index=len(self.calls)+1
  request_file=self.folder/f'http-{index:03d}-request.json'
  with request_file.open('xb')as stream:stream.write(raw)
  request_file.chmod(0o600)
  deadline=time.monotonic()+self.runtime.remaining(15)
  connection=http.client.HTTPConnection('127.0.0.1',64661,timeout=max(0.001,deadline-time.monotonic()))
  parts=[];size=0;status=None
  try:
   connection.request('POST',path,body=raw,headers=headers)
   connection.sock.settimeout(max(0.001,deadline-time.monotonic()))
   response=connection.getresponse();status=response.status
   while True:
    if response.isclosed():
     if response.length not in(None,0):raise ValueError('Incomplete original HTTP response')
     break
    left=min(deadline-time.monotonic(),self.runtime.remaining(15))
    if left<=0:raise TimeoutError('Original whole HTTP transport deadline exhausted')
    # The retained response owns the socket after an HTTP/1.0 close. read1
    # performs at most one underlying read; reset its timeout for each chunk.
    sock=response.fp.raw._sock
    sock.settimeout(left)
    chunk=response.read1(min(65536,2097153-size))
    if not chunk:
     if response.length not in(None,0):raise ValueError('Incomplete original HTTP response')
     break
    parts.append(chunk);size+=len(chunk)
    if size>2097152:raise ValueError('HTTP response cap exceeded')
   if time.monotonic()>=deadline:raise TimeoutError('Original HTTP deadline exceeded')
  finally:
   connection.close()
   body=b''.join(parts)
   response_file=self.folder/f'http-{index:03d}-response.json'
   with response_file.open('xb')as stream:stream.write(body)
   response_file.chmod(0o600)
  self.runtime.remaining(1)
  value=json.loads(body)if body else None
  self.calls.append(dict(method='POST',origin=ORIGIN,path=path,status=status,request_sha256=sha(raw),response_sha256=sha(body),bytes=len(body),admin_identity_creation=admin))
  save(self.folder,'http-transcript',self.calls)
  return status,value
 def rpc(self,name,payload,user,expected=200):
  status,value=self.post('/rest/v1/rpc/'+name,payload,user['token'])
  if status!=expected:
   # Only a fixed RPC error projection leaves the private evidence folder.
   # Request bodies, Authorization headers and Auth responses never do.
   if type(value)is dict:
    fields={key:value.get(key)for key in('code','message','details','hint')}
    if all(item is None or type(item)is str for item in fields.values()):
     save(self.folder,'rpc-failure',dict(rpc=name,status=status,error={key:item[:4096]if type(item)is str else None for key,item in fields.items()}))
   raise ValueError('Unexpected fixed RPC status: '+name+' '+str(status))
  return value


 def raw_response_at(self,call_index):
  """Closed original-response DATA API; no caller path or reserialization."""
  if type(call_index)is not int or not 1<=call_index<=len(self.calls):raise ValueError('Exact existing HTTP call index required')
  record=self.calls[call_index-1]
  keys={'method','origin','path','status','request_sha256','response_sha256','bytes','admin_identity_creation'}
  if type(record)is not dict or set(record)!=keys or record['method']!='POST'or record['origin']!=ORIGIN or record['path']not in RAW_RESPONSE_PATHS or type(record['status'])is not int or record['status']!=200 or record['admin_identity_creation']is not False or type(record['bytes'])is not int or not 1<=record['bytes']<=2097152:raise ValueError('Only source-selected completed P8 responses can be read')
  for key in('request_sha256','response_sha256'):
   if type(record[key])is not str or re.fullmatch('[0-9a-f]{64}',record[key])is None:raise ValueError('Exact recorded wire digest required')
  from pathlib import Path
  folder=Path(self.folder)
  if not folder.is_absolute()or '..'in folder.parts:raise ValueError('Owned absolute evidence folder required')
  for parent in [*reversed(folder.parents),folder]:
   if stat.S_ISLNK(parent.lstat().st_mode):raise ValueError('Symlinked evidence path refused')
  directory=os.open(folder,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NONBLOCK)
  try:
   info=os.fstat(directory)
   if info.st_uid!=os.getuid()or stat.S_IMODE(info.st_mode)&0o077:raise ValueError('Private owned evidence directory required')
   def evidence(suffix,cap,expected_bytes=None):
    fd=os.open(f'http-{call_index:03d}-{suffix}.json',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=directory)
    with os.fdopen(fd,'rb')as stream:
     meta=os.fstat(stream.fileno())
     if not stat.S_ISREG(meta.st_mode)or meta.st_uid!=os.getuid()or stat.S_IMODE(meta.st_mode)&0o077 or meta.st_size>cap or expected_bytes is not None and meta.st_size!=expected_bytes:raise ValueError('Bounded private regular original response required')
     data=stream.read(cap+1)
    if len(data)>cap or expected_bytes is not None and len(data)!=expected_bytes:raise ValueError('Original response size changed')
    return data
   request=evidence('request',262144);response=evidence('response',2097152,record['bytes'])
  finally:os.close(directory)
  if sha(request)!=record['request_sha256']or sha(response)!=record['response_sha256']:raise ValueError('Original request/response differs from completed call record')
  return {'raw':response,'call_index':call_index,'path':record['path'],'request_sha256':record['request_sha256'],'response_sha256':record['response_sha256']}

def real_user(http,index):
 email='lrv-closed-'+secrets.token_hex(8)+'-'+str(index)+'@example.invalid';password=secrets.token_urlsafe(30)
 name='LRV synthetic original'if index==0 else 'LRV synthetic reviewer'
 status,created=http.post('/auth/v1/admin/users',dict(email=email,password=password,email_confirm=True,user_metadata=dict(full_name=name)),admin=True)
 if status not in(200,201):raise ValueError('Real GoTrue admin creation failed')
 identifier=canonical_uuid(created['id'])
 status,signed=http.post('/auth/v1/token?grant_type=password',dict(email=email,password=password))
 if status!=200 or signed['user']['id']!=identifier:raise ValueError('Real password session failed')
 token=signed['access_token'];pieces=token.split('.')
 if len(pieces)!=3:raise ValueError('Actual GoTrue token shape differs')
 claims=json.loads(base64.urlsafe_b64decode(pieces[1]+'='*(-len(pieces[1])%4)))
 if claims.get('sub')!=identifier or claims.get('role')!='authenticated':raise ValueError('Actual token identity differs')
 return dict(id=identifier,session_id=canonical_uuid(claims['session_id']),token=token,email=email,name=name,auth_amr=claims.get('amr'),auth_aal=claims.get('aal'),auth_last_sign_in_at=signed['user']['last_sign_in_at'],private_password=password)

def document(kind,product,site,body,capability=None,event_kind=None):
 return dict(schema_version=1,kind=kind,scope=dict(product_id=product,site_id=site,event_kind=event_kind,capability=capability),version=1,
  predecessor_id=None,predecessor_hash=None,enabled=True,body=body,approval_reference='Synthetic closed local prototype; no practice approval')
