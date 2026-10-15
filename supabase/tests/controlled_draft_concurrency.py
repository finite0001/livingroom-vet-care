"""Observe actual metadata queues and post-wait validation in an owned local database."""
import argparse,json,subprocess,time,uuid
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local',action='store_true',required=True)
parser.add_argument('--project-config',type=Path,required=True)
args=parser.parse_args();project=args.project_config.resolve().parent.parent
identity=args.project_config.read_text().splitlines()[0].split('"')[1];assert identity.startswith(('lrv-controlled-','lrv-catalog-'))
container='supabase_db_'+identity
labels=json.loads(subprocess.check_output(['docker','inspect',container],text=True))[0]['Config']['Labels'];assert labels['com.supabase.cli.project']==identity and Path(labels['com.supabase.cli.workdir']).resolve()==project
command=['docker','exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
nonce=uuid.uuid4().hex[:10];actors=[str(uuid.uuid4()),str(uuid.uuid4())];sessions=[str(uuid.uuid4()),str(uuid.uuid4())];checks=observed=0;processes=[]
def sql(query):
 r=subprocess.run(command,input=query,capture_output=True,text=True,timeout=20);assert r.returncode==0,r.stderr[-1600:];return r.stdout.strip()
def quote(value):return "'"+json.dumps(value,separators=(',',':')).replace("'","''")+"'::jsonb"
def claims(index):return json.dumps({'role':'authenticated','sub':actors[index],'session_id':sessions[index]},separators=(',',':'))
def staff(index,query):return "begin;set local role authenticated;set local request.jwt.claims='"+claims(index)+"';"+query+';commit;'
def packet(product,entry=None):return{'id':entry or str(uuid.uuid4()),'expected_version':None,'definition':{'product_id':product,'product_version':1,'stock_unit':'mL','generic_name':'Synthetic queue substance','brand_name':None,'schedule':'II','concentration':'10 mg/mL','concentration_source':'Synthetic label','classification_source':'Synthetic source','configuration_note':'Unactivated draft only'},'review_note':'Synthetic actual lock queue','attest_review':True}
def prepare(index,action,request):return sql(staff(index,f"select prepare_controlled_draft_review('{actors[index]}','{action}','draft_configuration',{quote(request)})"))
def execute(index,action):return f"select execute_controlled_draft_review('{actors[index]}','{action}')"
def launch(name,query,keep_open=False):
 p=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);processes.append(p);p.stdin.write(f"set application_name='{name}';"+query+'\n');p.stdin.flush()
 if not keep_open:p.stdin.close();p.stdin=None
 return p

def wait(name,held=False):
 global observed
 deadline=time.monotonic()+1.7
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

for actor,sid in zip(actors,sessions):sql(f"insert into auth.users(id,email,raw_user_meta_data)values('{actor}','controlled-lock-{actor}@example.test','{{}}');update profiles set is_active=true,full_name='Synthetic controlled metadata reviewer'where id='{actor}';insert into user_roles(user_id,role)values('{actor}','ADMIN');insert into auth.sessions(id,user_id,created_at,updated_at)values('{sid}','{actor}',now(),now());")
def product():
 value=str(uuid.uuid4());sql(staff(0,f"select create_inventory_product('{value}','Synthetic controlled queue {value[:8]}','medication','Synthetic manufacturer','mL',100)"));return value
holder_name='controlled_hold_'+nonce
try:
 # Two independent connections really wait on the original actor lock.
 p0=product();action=str(uuid.uuid4());request=packet(p0);prepare(0,action,request)
 holder=launch(holder_name,f"begin;select pg_advisory_xact_lock(90271030,hashtext('{actors[0]}'));",True);wait(holder_name,True)
 queued=[]
 for suffix in ['same_a','same_b']:
  name='controlled_'+suffix+'_'+nonce;p=launch(name,staff(0,execute(0,action)));queued.append(p);wait(name)
 release(holder);result=[finish(p)for p in queued];assert result[0]==result[1];assert sql(f"select count(*)from controlled_draft_versions where entry_id='{request['id']}'")=='1';checks+=1
 # Different draft IDs/actors cannot both claim the same medication.
 p1=product();requests=[packet(p1),packet(p1)];actions=[str(uuid.uuid4()),str(uuid.uuid4())]
 for index in range(2):prepare(index,actions[index],requests[index])
 holder=launch(holder_name,f"begin;select pg_advisory_xact_lock(90271032,hashtext('{p1}'));",True);wait(holder_name,True)
 queued=[]
 for index in range(2):
  name='controlled_product_'+str(index)+'_'+nonce;p=launch(name,staff(index,execute(index,actions[index])));queued.append(p);wait(name)
 release(holder);outcomes=[p.communicate(timeout=10)for p in queued];assert sum(p.returncode==0 for p in queued)==1;assert any('23505'in err for out,err in outcomes);assert sql(f"select count(*)from controlled_draft_entries where product_id='{p1}'")=='1';checks+=1
 # A genuine observed wait must not cache a now-revoked live session.
 p2=product();revoked=str(uuid.uuid4());prepare(0,revoked,packet(p2))
 holder=launch(holder_name,f"begin;select pg_advisory_xact_lock(90271032,hashtext('{p2}'));",True);wait(holder_name,True)
 name='controlled_revoked_'+nonce;p=launch(name,staff(0,execute(0,revoked)));wait(name)
 release(holder,f"update auth.sessions set not_after=clock_timestamp()where id='{sessions[0]}';commit;");finish(p,'42501');assert sql(f"select count(*)from controlled_draft_entries where product_id='{p2}'")=='0';checks+=1
 sql(f"update auth.sessions set not_after=null where id='{sessions[0]}';")
 # Expiration is checked again after the product lock, not only before waiting.
 p3=product();expired=str(uuid.uuid4());request=packet(p3)
 sql(f"insert into controlled_draft_reviews(id,actor_id,session_id,operation,request,created_at,expires_at)values('{expired}','{actors[0]}','{sessions[0]}','draft_configuration',{quote(request)},clock_timestamp()-interval '14 minutes',clock_timestamp()+interval '1.2 seconds');")
 holder=launch(holder_name,f"begin;select pg_advisory_xact_lock(90271032,hashtext('{p3}'));",True);wait(holder_name,True)
 name='controlled_expired_'+nonce;p=launch(name,staff(0,execute(0,expired)));wait(name);time.sleep(1.3);release(holder);finish(p,'PT409');assert sql(f"select count(*)from controlled_draft_entries where product_id='{p3}'")=='0';checks+=1
 # Cancel and execute serialize into one durable, recoverable outcome.
 p4=product();racing=str(uuid.uuid4());prepare(0,racing,packet(p4))
 holder=launch(holder_name,f"begin;select pg_advisory_xact_lock(90271030,hashtext('{actors[0]}'));",True);wait(holder_name,True)
 name='controlled_cancel_'+nonce;c=launch(name,staff(0,f"select cancel_controlled_draft_review('{actors[0]}','{racing}')"));wait(name)
 name='controlled_execute_'+nonce;e=launch(name,staff(0,execute(0,racing)));wait(name);release(holder)
 cancelled=finish(c);out,err=e.communicate(timeout=10)
 if cancelled['cancelled']:assert e.returncode!=0 and 'PT409'in err;assert sql(f"select count(*)from controlled_draft_entries where product_id='{p4}'")=='0'
 else:assert e.returncode==0 and json.loads(out.strip().splitlines()[-1])==cancelled['receipt']
 checks+=1
finally:
 for p in processes:
  if p.poll()is None:p.kill();p.communicate(timeout=5)
 for actor,sid in zip(actors,sessions):sql(f"update profiles set is_active=false where id='{actor}';update auth.sessions set not_after=clock_timestamp()where id='{sid}';")
assert sql("select count(*)from profiles where is_active and id in("+','.join("'"+actor+"'"for actor in actors)+")")=='0'
print(json.dumps({'checks':checks,'observed_lock_queues':observed,'same_uuid_single_receipt':True,'same_product_unique_draft':True,'post_wait_live_session':True,'post_wait_expiry':True,'cancel_execute_serialized':True,'owned_staff_deactivated':True,'provider_requests':0}))
