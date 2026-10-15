"""OWNED LOCAL ONLY: genuine Auth/HTTP, managed source atomicity and observed queues."""
import base64, concurrent.futures, datetime, json, os, subprocess, time, urllib.request, urllib.error, uuid
from pathlib import Path
os.umask(0o077)
root=Path(__file__).resolve().parents[4];source=Path(__file__).resolve().parent;folder=Path(os.environ['CONTROLLED_ENGINE_RESULT_DIR']).resolve();runtime=json.loads((folder/'runtime.json').read_text())
identity=runtime['identity'];assert identity.startswith('lrv-controlled-engine-')and not runtime['removed'];project=Path(runtime['project']);container='supabase_db_'+identity
labels=json.loads(subprocess.check_output(['docker','inspect',container]))[0]['Config']['Labels']
assert labels['com.supabase.cli.project']==identity and Path(labels['com.supabase.cli.workdir']).resolve()==project.resolve()
status=json.loads(subprocess.check_output(['supabase','status','--workdir',str(project),'--output','json','--agent','no'],stderr=subprocess.DEVNULL))
assert status['API_URL']=='http://127.0.0.1:64621'
checks=0;actors=[];locks=[];queues=0
uid=lambda:str(uuid.uuid4())
def check(actual,expected):
 global checks
 assert actual==expected,(actual,expected)
 checks+=1
def sql(query):
 p=subprocess.run(['docker','exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input=query,capture_output=True,text=True,timeout=45)
 if p.returncode:
  (folder/'engine-api-error.log').write_text(p.stdout+p.stderr)
  raise RuntimeError('Owned API SQL fixture failed; protected error log retained')
 return p.stdout.strip()
def http(path,data=None,token=None,method=None,service=False):
 headers={'apikey':status['ANON_KEY'],'Content-Type':'application/json','Authorization':'Bearer '+(status['SERVICE_ROLE_KEY']if service else token or status['ANON_KEY'])}
 request=urllib.request.Request(status['API_URL']+path,data=None if data is None else json.dumps(data).encode(),headers=headers,method=method or('POST'if data is not None else'GET'))
 try:
  with urllib.request.urlopen(request,timeout=25)as response:return response.status,json.loads(response.read()or'null')
 except urllib.error.HTTPError as error:return error.code,json.loads(error.read()or'null')
def rpc(name,args,owner=None):
 code,data=http('/rest/v1/rpc/'+name,args,owner['token']if owner else None)
 if code>=300:raise RuntimeError(name+': '+json.dumps(data))
 return data
def reject(name,args,error,owner=None,service=False):
 code,data=http('/rest/v1/rpc/'+name,args,owner['token']if owner else None,service=service)
 assert code>=400,(name,code,data)
 check(data.get('code'),error)
def login(owner):
 code,signed=http('/auth/v1/token?grant_type=password',{'email':owner['email'],'password':owner['password']})
 assert code==200,'Synthetic sign-in failed'
 token=signed['access_token'];claims=json.loads(base64.urlsafe_b64decode(token.split('.')[1]+'==='))
 assert claims['sub']==owner['id']and claims['role']=='authenticated'
 owner.update(token=token,session=str(uuid.UUID(claims['session_id'])))
 check(sql("select count(*)from auth.sessions where id='"+owner['session']+"'and user_id='"+owner['id']+"'and(not_after is null or not_after>clock_timestamp());"),'1')
def actor(role):
 email='synthetic-managed-'+uid()+'@example.test';password=uid()+uid()
 code,data=http('/auth/v1/admin/users',{'email':email,'password':password,'email_confirm':True,'app_metadata':{'role':'DVM'}},service=True)
 assert code in(200,201),'Synthetic user creation failed'
 owner={'id':str(uuid.UUID(data['id'])),'email':email,'password':password};actors.append(owner)
 sql("update profiles set is_active=true,full_name='Synthetic managed API'where id='"+owner['id']+"';insert into user_roles(user_id,role)values('"+owner['id']+"','"+role+"')on conflict do nothing;")
 login(owner);return owner
baseline=sql("select jsonb_build_object('outbox',(select count(*)from communication_outbox),'payments',(select count(*)from payment_provider_profiles),'generation',(select count(*)from operational_task_generation_policy where enabled));")
class Held:
 def __init__(self,expression):
  self.p=subprocess.Popen(['docker','exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
  self.p.stdin.write('begin;select pg_backend_pid();select '+expression+";select 'OWNED_HELD';\n");self.p.stdin.flush();self.pid=int(self.p.stdout.readline().strip())
  while True:
   line=self.p.stdout.readline().strip()
   if line=='OWNED_HELD':break
   if self.p.poll()is not None:raise RuntimeError('Owned lock failed')
  locks.append(self)
 def release(self):
  if self.p.poll()is None:
   self.p.stdin.write('rollback;\n');self.p.stdin.close();self.p.wait(timeout=10)
 def __enter__(self):return self
 def __exit__(self,*unused):self.release()
def observe(blocker):
 global queues
 deadline=time.monotonic()+8
 while time.monotonic()<deadline:
  found=sql('select count(*)from pg_stat_activity where '+str(blocker.pid)+'=any(pg_blocking_pids(pid));')
  if found!='0':queues+=1;return
  time.sleep(.03)
 raise AssertionError('Expected actual database queue was not observed')
def literal(value):return "'"+json.dumps(value).replace("'","''")+"'::jsonb"
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
try:
 check(sql("select count(*)from auth.users u left join profiles p on p.id=u.id where u.email not like 'synthetic-managed-%@example.test'or p.is_active;"),'0')
 check(sql('select count(*)from controlled_stock_policy_versions;'),'0')
 vet=actor('DVM');staff=actor('STAFF')
 # Revoked public API is proved before the owned test grants any entry point.
 for name in ['read_controlled_stock_action','execute_controlled_stock_action','cancel_controlled_stock_action']:
  for owner,service in [(None,False),(vet,False),(None,True)]:reject(name,{'p_actor_id':vet['id'],'p_action_id':uid()},'42501',owner,service)
 signatures=['read_controlled_stock_action(uuid,uuid)','prepare_controlled_stock_action(uuid,uuid,text,jsonb,jsonb)','execute_controlled_stock_action(uuid,uuid)','cancel_controlled_stock_action(uuid,uuid)']
 sql('begin;'+''.join('grant execute on function '+s+' to authenticated;'for s in signatures)+"do $$declare d jsonb:=controlled_stock_manifest_snapshot();begin alter table controlled_stock_engine_manifests disable trigger immutable;update controlled_stock_engine_manifests set definition=d,definition_hash=controlled_stock_hash(d)where revision=1;alter table controlled_stock_engine_manifests enable trigger immutable;end $$;select controlled_stock_manifest_required();notify pgrst,'reload schema';commit;")
 runtime['new_rpc_grants']=True;runtime['synthetic_fixture_committed']=True
 (folder/'runtime.json').write_text(json.dumps(runtime,indent=2))
 # Reuse the reviewed smoke setup, replacing only its explicitly synthetic identity creation.
 setup=(source/'smoke.sql').read_text().split('create temp table engine_values')[0]
 begin=setup.index('insert into auth.users');end=setup.index('insert into catalog_products')
 setup=setup[:begin]+"update engine_fx set id='"+vet['id']+"'where k='actor';update engine_fx set id='"+vet['session']+"'where k='session';select set_config('request.jwt.claims',"+literal({'role':'authenticated','sub':vet['id'],'session_id':vet['session']})+"::text,true);\n"+setup[end:]
 setup+="select jsonb_object_agg(k,id)from engine_fx;commit;"
 output=sql(setup);ids=json.loads(next(line for line in reversed(output.splitlines())if line.startswith('{')))
 runtime['controlled_policy_or_opening']=True;(folder/'runtime.json').write_text(json.dumps(runtime,indent=2))
 def context(bottle=None,quantity='-0.125',version=None):
  containers=[]
  for key in(['bottle_a','bottle_b']if bottle is None else[bottle]):
   new=bottle is None
   if not new:
    h=json.loads(sql("select to_jsonb(h)from controlled_stock_container_heads h where container_id='"+ids[key]+"';"))
   containers.append({'id':ids[key],'expected_version':None if new else(h['version']if version is None else version),
    'create':{'kind':'stock','label':'Synthetic API bottle '+key,'stock_lot_id':ids['lot'],'site_id':ids['site'],'location_id':ids['location'],'custodian_id':vet['id']}if new else None,
    'after':{'status':'onsite','location_id':ids['location'],'custodian_id':vet['id']},
    'lines':[{'lot_id':ids['lot'],'channel':'available','dispense_id':None,'intake_id':None,'quantity_delta':'1.250'if new else quantity}]})
  return {'version':1,'product_id':ids['product'],'policy_version_id':ids['policy'],'state_head_id':ids['active'],'opening_id':ids['opening'],
   'basis':{'kind':'physical_record','observed_at':now(),'note':'Synthetic API observation; no practice policy'},'containers':sorted(containers,key=lambda c:c['id'])}
 def prepare(action,writer,args,ctx=None,owner=None):return rpc('prepare_controlled_stock_action',{'p_actor_id':(owner or vet)['id'],'p_action_id':action,'p_writer':writer,'p_arguments':args,'p_context':ctx or context('bottle_b')},owner or vet)
 def bound(action,owner=None):return {'p_actor_id':(owner or vet)['id'],'p_action_id':action}
 def adjust_args(q='-0.125'):return {'lot_id':ids['lot'],'quantity':q,'reason':'Synthetic API recount'}
 tables=json.loads(sql("select jsonb_agg(relname order by relname)from pg_class where relnamespace='public'::regnamespace and relkind='r'and left(relname,17)='controlled_stock_';"))
 for table in tables:
  for owner,service in [(vet,False),(staff,False),(None,True)]:
   code,data=http('/rest/v1/'+table+'?select=*',None,owner['token']if owner else None,service=service);assert code>=400;check(data['code'],'42501')
 for name,args in [('controlled_stock_exclusive',{}),('controlled_stock_manifest_required',{}),('controlled_stock_call_canonical',{'p_id':uid(),'p_writer':'receive_inventory','p_arguments':{}})]:
  reject(name,args,'42501',vet)
 received_args={'lot_id':ids['lot'],'product_id':ids['product'],'lot_number':'SYNTHETIC-API','expires_on':'2099-12-31','location':'Synthetic clinic','quantity':'2.500','reason':'Synthetic physical receipt'}
 receive_ctx=context();receive=uid()
 check(prepare(receive,'receive_inventory',received_args,receive_ctx)['state'],'prepared')
 reject('execute_controlled_stock_action',bound(receive,staff),'42501',staff)
 reject('prepare_controlled_stock_action',{'p_actor_id':vet['id'],'p_action_id':uid(),'p_writer':'receive_inventory','p_arguments':received_args,'p_context':receive_ctx},'42501',staff)
 denied=uid();reject('prepare_controlled_stock_action',{'p_actor_id':staff['id'],'p_action_id':denied,'p_writer':'receive_inventory','p_arguments':received_args,'p_context':receive_ctx},'42501',staff)
 saved=rpc('execute_controlled_stock_action',bound(receive),vet)
 check(saved['canonical_result']['id'],receive);check(saved['canonical_result']['quantity'],2.5)
 check(rpc('execute_controlled_stock_action',bound(receive),vet),saved)
 check(rpc('read_controlled_stock_action',bound(receive),vet)['receipt'],saved)
 check(sql('select sum(quantity)::text from controlled_stock_positions;'),'2.500')
 check(sql('select count(*)from controlled_stock_execution_contexts;'),'0')
 stale,adjust=uid(),uid();ctx=context('bottle_a','-0.500');args=adjust_args('-0.500')
 prepare(stale,'adjust_inventory',args,ctx);prepare(adjust,'adjust_inventory',args,ctx)
 adjusted=rpc('execute_controlled_stock_action',bound(adjust),vet)
 reject('execute_controlled_stock_action',bound(stale),'PT409',vet)
 check(rpc('cancel_controlled_stock_action',bound(stale),vet)['state'],'cancelled')
 reject('execute_controlled_stock_action',bound(stale),'PT409',vet)
 reject('adjust_inventory',{'p_id':stale,'p_lot_id':ids['lot'],'p_quantity':-.5,'p_reason':args['reason']},'23514',vet)
 reject('prepare_controlled_stock_action',{'p_actor_id':vet['id'],'p_action_id':adjust,'p_writer':'adjust_inventory','p_arguments':adjust_args('-0.499'),'p_context':ctx},'23505',vet)
 check(rpc('execute_controlled_stock_action',bound(receive),vet),saved)
 check(sql('select sum(quantity)::text from controlled_stock_positions;'),'2.000')
 # Real HTTP waits: invalidate authority only after pg_blocking_pids proves blocking.
 with concurrent.futures.ThreadPoolExecutor(max_workers=3)as pool:
  for gate,change,restore,error in [
   ('operation',"update profiles set is_active=false where id='"+vet['id']+"';","update profiles set is_active=true where id='"+vet['id']+"';",'42501'),
   ('product',"delete from user_roles where user_id='"+vet['id']+"'and role='DVM';","insert into user_roles(user_id,role)values('"+vet['id']+"','DVM');",'42501'),
   ('container',"update auth.sessions set not_after=clock_timestamp()where id='"+vet['session']+"';",None,'42501')]:
   action=uid();prepare(action,'adjust_inventory',adjust_args())
   key=action if gate=='operation'else ids['product']if gate=='product'else ids['bottle_b']
   held=Held("pg_advisory_xact_lock(hashtextextended('controlled-stock-"+gate+":"+key+"',0))")
   future=pool.submit(http,'/rest/v1/rpc/execute_controlled_stock_action',bound(action),vet['token'])
   observe(held);sql(change);held.release();code,data=future.result(timeout=15);assert code>=400;check(data.get('code'),error)
   check(sql("select count(*)from inventory_movements where id='"+action+"';"),'0')
   check(sql("select count(*)from controlled_stock_actions where id='"+action+"';"),'0')
   check(sql('select count(*)from controlled_stock_execution_contexts;'),'0')
   if restore:sql(restore)
   else:login(vet)
   check(rpc('read_controlled_stock_action',bound(action),vet)['state'],'prepared')
   check(rpc('cancel_controlled_stock_action',bound(action),vet)['state'],'cancelled')
 # A queued same-UUID retry yields one event/source and the exact original receipt.
 same=uid();prepare(same,'adjust_inventory',adjust_args())
 with Held("pg_advisory_xact_lock(hashtextextended('controlled-stock-operation:"+same+"',0))")as held:
  with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:
   one=pool.submit(http,'/rest/v1/rpc/execute_controlled_stock_action',bound(same),vet['token']);observe(held)
   two=pool.submit(http,'/rest/v1/rpc/execute_controlled_stock_action',bound(same),vet['token'])
   deadline=time.monotonic()+5
   while time.monotonic()<deadline:
    if int(sql('select count(*)from pg_stat_activity where '+str(held.pid)+'=any(pg_blocking_pids(pid));'))>=2:break
    time.sleep(.03)
   else:raise AssertionError('Second exact replay did not queue')
   queues+=1;held.release();first=one.result(timeout=15);second=two.result(timeout=15);check(first[0],200);check(second,first)
 check(sql("select count(*)from inventory_movements where id='"+same+"';"),'1')
 check(sql('select sum(quantity)::text from controlled_stock_positions;'),'1.875')
 check(sql('select count(*)from controlled_stock_events;'),'3')
 sql("select controlled_stock_validate_event(id)from controlled_stock_events;select controlled_stock_validate_product('"+ids['product']+"');")
 check(sql('select count(*)from controlled_stock_execution_contexts;'),'0')
 proof={'synthetic_only':True,'genuine_auth_postgrest':True,'api_checks':checks,'observed_lock_queues':queues,'actual_root_product_final_container_waits':True,
  'authority_revocation_after_observed_wait':True,'final_container_failure_rolled_back_canonical_source':True,'same_uuid_exact_single_commit':True,
  'raw_tables_and_helpers_denied':True,'staff_metadata_did_not_grant_role':True,'owned_review_cancel_recovery':True,'new_rpc_grants_owned_local_only':True,
  'actual_practice_rules':False,'canonical_migration':False,'provider_requests':0}

finally:
 for held in locks:held.release()
 for owner in actors:
  sql("update profiles set is_active=false where id='"+owner['id']+"';update auth.sessions set not_after=clock_timestamp()where user_id='"+owner['id']+"';delete from auth.refresh_tokens where user_id='"+owner['id']+"';")
  if owner.get('token'):http('/auth/v1/logout',{},owner['token'])
 check(sql("select jsonb_build_object('outbox',(select count(*)from communication_outbox),'payments',(select count(*)from payment_provider_profiles),'generation',(select count(*)from operational_task_generation_policy where enabled));"),baseline)
 if actors:
  actor_ids=','.join("'"+owner['id']+"'"for owner in actors)
  check(sql('select count(*)from profiles where is_active and id in('+actor_ids+');'),'0')
  check(sql('select count(*)from auth.sessions where user_id in('+actor_ids+')and(not_after is null or not_after>clock_timestamp());'),'0')

proof.update(api_checks=checks,owned_actors_and_sessions_retired=True,non_stock_baselines_unchanged=True)
(folder/'engine-api-v1-proof.json').write_text(json.dumps(proof,indent=2))
print(json.dumps(proof))
