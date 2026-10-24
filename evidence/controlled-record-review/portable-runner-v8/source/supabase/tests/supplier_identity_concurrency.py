"""Observe actual metadata queues and post-wait validation in an owned local database."""
import argparse,json,subprocess,time,uuid
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local',action='store_true',required=True)
parser.add_argument('--project-config',type=Path,required=True)
args=parser.parse_args();project=args.project_config.resolve().parent.parent
identity=args.project_config.read_text().splitlines()[0].split('"')[1];assert identity.startswith(('lrv-identity-','lrv-catalog-'))
container='supabase_db_'+identity
labels=json.loads(subprocess.check_output(['docker','inspect',container],text=True))[0]['Config']['Labels'];assert labels['com.supabase.cli.project']==identity and Path(labels['com.supabase.cli.workdir']).resolve()==project
command=['docker','exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
nonce=uuid.uuid4().hex[:10];actors=[str(uuid.uuid4()),str(uuid.uuid4())];sessions=[str(uuid.uuid4()),str(uuid.uuid4())];checks=observed=0;processes=[]
def sql(query):
 r=subprocess.run(command,input=query,capture_output=True,text=True,timeout=20);assert r.returncode==0,r.stderr[-1600:];return r.stdout.strip()
def quote(value):return "'"+json.dumps(value,separators=(',',':')).replace("'","''")+"'::jsonb"
def claims(index):return json.dumps({'role':'authenticated','sub':actors[index],'session_id':sessions[index]},separators=(',',':'))
def staff(index,query):return "begin;set local role authenticated;set local request.jwt.claims='"+claims(index)+"';"+query+';commit;'
def request(entry,definition,expected=None):return{'id':entry,'expected_version':expected,'definition':definition,'review_note':'Synthetic observed metadata queue','attest_review':True}
def prepare(index,action,operation,packet):return sql(staff(index,f"select prepare_inventory_identity_review('{actors[index]}','{action}','{operation}',{quote(packet)})"))
def execute(index,action):return f"select execute_inventory_identity_review('{actors[index]}','{action}')"
def apply(index,entry,operation,definition,expected=None):
 action=str(uuid.uuid4());prepare(index,action,operation,request(entry,definition,expected));return json.loads(sql(staff(index,execute(index,action))).splitlines()[-1])
def launch(name,query,keep_open=False):
 p=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);processes.append(p);p.stdin.write(f"set application_name='{name}';"+query+'\n');p.stdin.flush()
 if not keep_open:p.stdin.close();p.stdin=None
 return p

def wait(name,held=False):
 global observed
 deadline=time.monotonic()+1.5
 while time.monotonic()<deadline:
  condition="exists(select 1 from pg_locks l where l.pid=a.pid and l.granted and l.locktype='advisory')"if held else"a.wait_event_type='Lock'and cardinality(pg_blocking_pids(a.pid))>0"
  if sql(f"select count(*)from pg_stat_activity a where a.application_name='{name}'and {condition}")=='1':
   if not held:observed+=1
   return
  time.sleep(.025)
 raise AssertionError('Live queue/holder not observed: '+name)
def finish(p,code=None):
 out,err=p.communicate(timeout=10)
 if code is None:assert p.returncode==0,err[-1800:];return json.loads(out.strip().splitlines()[-1])
 assert p.returncode!=0 and code in err,err[-1800:];return None

def release(p,query='commit;'):
 p.stdin.write(query+'\n');p.stdin.close();p.stdin=None
 out,err=p.communicate(timeout=10);assert p.returncode==0,err[-1800:]

def ns(label,active=True):return{'supplier':'mwi','account_label':'Synthetic '+label+' '+nonce,'catalog_scope':'Observed queue list','active':active}
for actor,sid in zip(actors,sessions):sql(f"insert into auth.users(id,email,raw_user_meta_data)values('{actor}','identity-lock-{actor}@example.test','{{}}');update profiles set is_active=true,full_name='Synthetic metadata lock reviewer'where id='{actor}';insert into user_roles(user_id,role)values('{actor}','ADMIN');insert into auth.sessions(id,user_id,created_at,updated_at)values('{sid}','{actor}',now(),now());")
try:
 # Two executions genuinely queued behind one original actor/run identity.
 entry,action=str(uuid.uuid4()),str(uuid.uuid4());prepare(0,action,'namespace',request(entry,ns('replay')))
 holder_name='identity_hold_'+nonce;holder=launch(holder_name,f"begin;select pg_advisory_xact_lock(90271010,hashtext('{actors[0]}'));",True);wait(holder_name,True)
 names=['identity_same_a_'+nonce,'identity_same_b_'+nonce]
 queued=[]
 for name in names:p=launch(name,staff(0,execute(0,action)));queued.append(p);wait(name)
 release(holder);results=[finish(p)for p in queued];assert results[0]==results[1];checks+=1
 assert sql(f"select count(*)from inventory_identity_versions where entry_id='{entry}'")=='1';checks+=1
 product=str(uuid.uuid4());sql(staff(0,f"select create_inventory_product('{product}','Synthetic queue tablet','medication','Synthetic manufacturer','tablet',100)"))
 namespace=str(uuid.uuid4());initial=apply(0,namespace,'namespace',ns('freshness'))
 def package(label,identifiers):return{'product_id':product,'product_version':1,'stock_unit':'tablet','label':label+' '+nonce,'manufacturer':'Synthetic manufacturer','strength':'1mg/tablet','form':'tablet','purchase_unit':'bottle','conversion':{'stock_units_numerator':'10','purchase_units_denominator':'1'},'identifiers':identifiers,'active':True}
 package_id,action=str(uuid.uuid4()),str(uuid.uuid4());identifier={'kind':'supplier_sku','namespace_id':namespace,'namespace_version_id':initial['entry']['version_id'],'value':'000QUEUED','raw_source':'000QUEUED'};prepare(0,action,'package',request(package_id,package('Namespace queued',[identifier])))
 # Holder updates the namespace through the real reviewed API in its own txn.
 holder=launch(holder_name,f"begin;select pg_advisory_xact_lock(90271012,hashtext('{namespace}'));",True);wait(holder_name,True)
 name='identity_namespace_'+nonce;p=launch(name,staff(0,execute(0,action)));wait(name)
 other=str(uuid.uuid4());packet=request(namespace,ns('freshness',False),1)
 release(holder,"set local role authenticated;set local request.jwt.claims='"+claims(1)+f"';select prepare_inventory_identity_review('{actors[1]}','{other}','namespace',{quote(packet)});{execute(1,other)};commit;")
 finish(p,'PT409');checks+=1;assert sql(f"select count(*)from inventory_identity_entries where id='{package_id}'")=='0';checks+=1
 # Live session is expired only after the actual entry queue is observed.
 revoked_entry,revoked_action=str(uuid.uuid4()),str(uuid.uuid4());prepare(0,revoked_action,'namespace',request(revoked_entry,ns('session')))
 holder=launch(holder_name,f"begin;select pg_advisory_xact_lock(90271012,hashtext('{revoked_entry}'));",True);wait(holder_name,True)
 name='identity_session_'+nonce;p=launch(name,staff(0,execute(0,revoked_action)));wait(name)
 sql(f"update auth.sessions set not_after=clock_timestamp()-interval'1 second'where id='{sessions[0]}';");release(holder);finish(p,'42501');checks+=1
 assert sql(f"select count(*)from inventory_identity_entries where id='{revoked_entry}'")=='0';checks+=1;sql(f"update auth.sessions set not_after=null where id='{sessions[0]}';")
 # Different packages genuinely contend on the unique global identifier index.
 code='00036000291452';gtin={'kind':'gtin','namespace_id':None,'namespace_version_id':None,'value':code,'raw_source':'036000291452'}
 winner,loser,first,second=(str(uuid.uuid4())for _ in range(4));prepare(0,first,'package',request(winner,package('Winner',[gtin])));prepare(1,second,'package',request(loser,package('Loser',[gtin])))
 holder=launch(holder_name,"begin;set local role authenticated;set local request.jwt.claims='"+claims(0)+"';"+execute(0,first)+';',True)
 deadline=time.monotonic()+1.5
 while time.monotonic()<deadline:
  if sql(f"select count(*)from pg_stat_activity where application_name='{holder_name}'and state='idle in transaction'")=='1':break
  time.sleep(.025)
 else:raise AssertionError('Actual uncommitted identifier holder not ready')
 name='identity_collision_'+nonce;p=launch(name,staff(1,execute(1,second)));wait(name);release(holder);finish(p,'23505');checks+=1
 assert sql(f"select count(*)from inventory_identity_versions where entry_id='{winner}'")=='1';checks+=1
 assert sql(f"select count(*)from inventory_identity_entries where id='{loser}'")=='0';checks+=1
 assert sql(f"select package_id from inventory_identity_bindings where kind='gtin'and value='{code}'")==winner;checks+=1
finally:
 for p in processes:
  if p.poll()is None:
   if p.stdin:p.stdin.write('rollback;\n');p.stdin.close();p.stdin=None
   p.communicate(timeout=10)
 for index,actor in enumerate(actors):
  sql(f"update auth.sessions set not_after=null where id='{sessions[index]}';")
  pending=sql(f"select id from inventory_identity_reviews r where actor_id='{actor}'and not exists(select 1 from inventory_identity_actions a where a.id=r.id)and not exists(select 1 from inventory_identity_cancellations c where c.id=r.id)").splitlines()
  for action in pending:sql(staff(index,f"select cancel_inventory_identity_review('{actor}','{action}')"))
  sql(f"update profiles set is_active=false where id='{actor}';update auth.sessions set not_after=clock_timestamp()where user_id='{actor}';")
assert observed==5 and checks==10
proof={'checks':checks,'observed_lock_queues':observed,'same_uuid_single_version':True,'namespace_rechecked_after_wait':True,'live_session_rechecked_after_wait':True,'identifier_collision_atomic':True,'owned_staff_deactivated':True,'provider_requests':0}
(project/'identity-lock-proof.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof))
