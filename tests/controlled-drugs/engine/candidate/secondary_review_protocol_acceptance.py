"""Synthetic final Auth/transaction proof; all evidence stays in the owned folder."""
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import threading
import time
import urllib.error
import urllib.request
import uuid

PINS={'private':'adf45e10d25935486aadbc126c6b8282d38def119dc344bfe4935bb690d4b036','synthetic_auth':'f5a75555636034647be9cb9505cb75428d280fdbd36f1d5308fc0efd4b377e3a'}
FACADES={a:a+'_controlled_secondary_review' for a in ('prepare','read','execute','cancel')}
FACADES.update(event='read_controlled_secondary_review_event',queue='list_controlled_secondary_reviews')
EXPIRY_WAIT_LEAD_SECONDS=3
TIMEOUT_SQL="""select jsonb_build_object('server_statement_timeout',current_setting('statement_timeout'),
 'settings',(select jsonb_agg(jsonb_build_object('database',d.datname,'role',r.rolname,'setting',setting)
 order by coalesce(d.datname,''),coalesce(r.rolname,''),setting)
 from pg_db_role_setting s left join pg_database d on d.oid=s.setdatabase
 left join pg_roles r on r.oid=s.setrole cross join lateral unnest(s.setconfig)setting
 where s.setdatabase in(0,(select oid from pg_database where datname=current_database()))
 and(s.setrole=0 or r.rolname in('authenticated','authenticator','anon'))
 and split_part(setting,'=',1)in('statement_timeout','lock_timeout')));"""


def timeout_guard(ctx):
    observed=ctx.runtime.json(TIMEOUT_SQL)
    expected={'server_statement_timeout':'0','settings':[
        {'database':None,'role':'anon','setting':'statement_timeout=3s'},
        {'database':None,'role':'authenticated','setting':'statement_timeout=8s'},
        {'database':None,'role':'authenticator','setting':'lock_timeout=8s'},
        {'database':None,'role':'authenticator','setting':'statement_timeout=8s'}]}
    assert observed==expected,'Pinned local timeout configuration changed; do not widen it'
    rest=ctx.runtime.verify('supabase_rest_'+ctx.runtime.identity)
    config=[v for v in rest['Config']['Env']if v.startswith(('PGRST_DB_CONFIG=','PGRST_DB_PRE_CONFIG=','PGRST_DB_POOL_ACQUISITION_TIMEOUT='))]
    assert config==[],'Pinned REST timeout configuration changed'
    ctx.save('unchanged-timeout-guard',{'observed':observed,'rest_timeout_config':config,'expiry_lead_seconds':EXPIRY_WAIT_LEAD_SECONDS})

def q(value):return "'"+str(value).replace("'","''")+"'"
def j(value):return q(json.dumps(value,sort_keys=True))+'::jsonb'

def frozen_package(source,profile):
    from secondary_review_protocol_descriptor import build
    path=source/('secondary_review_protocol_'+profile+'_expected_v2.json')
    assert profile in PINS,'Independent reviewed final profile pin required'
    assert hashlib.sha256(path.read_bytes()).hexdigest()==PINS[profile],'Final independent expected bytes changed'
    wrapper=json.loads(path.read_text())
    assert set(wrapper)=={'kind','definition','definition_sha256','derivation_input_sha256'}
    package=build(profile)
    assert wrapper['kind']=='controlled-review-foundation-'+profile+'-independent-expected-v2'
    assert wrapper['derivation_input_sha256']==package['source_hashes']
    assert wrapper['definition']==package['expected']
    assert wrapper['definition_sha256']==package['expected_sha256']
    package['descriptor_insert']='insert into controlled_review.descriptor values(true,'+j(wrapper['definition'])+');'
    return package


class Context:
    def __init__(self,runtime,base):
        self.runtime,self.base=runtime,base
        self.actors={}
        self.fx={}
        self.events=[]
        self.http_number=0
        self.http_lock=threading.Lock()
        runtime.verify()
        status=json.loads(runtime.command(['supabase','status','--workdir',str(runtime.project),'--output','json','--agent','no']).stdout)
        self.url=status['API_URL']
        assert self.url=='http://127.0.0.1:64661'
        self.anon=status['ANON_KEY'];self.service=status['SERVICE_ROLE_KEY']
        self.baseline=None

    def save(self,label,value):
        assert re.fullmatch(r'[a-zA-Z0-9_-]+',label)
        path=self.runtime.folder/(getattr(self,'evidence_prefix','')+label+'.json')
        suffix=1
        while path.exists():
            suffix+=1;path=self.runtime.folder/(getattr(self,'evidence_prefix','')+label+'-'+str(suffix)+'.json')
        path.write_text(json.dumps(value,sort_keys=True,indent=2)+'\n')

    def http(self,path,payload=None,token=None,method='POST',expected_code=None,timeout=None):
        headers={'apikey':self.anon,'Authorization':'Bearer '+(token or self.anon),'Content-Type':'application/json'}
        req=urllib.request.Request((self.clone_urls['auth']+path.removeprefix('/auth/v1') if hasattr(self,'clone_urls')and path.startswith('/auth/v1') else self.clone_urls['rest']+path.removeprefix('/rest/v1') if hasattr(self,'clone_urls') else self.url+path),data=None if payload is None else json.dumps(payload).encode(),headers=headers,method=method)
        with self.http_lock:
            self.http_number+=1;number=self.http_number
        record={'path':path,'method':method,'payload':payload}
        try:
            with urllib.request.urlopen(req,timeout=self.runtime.remaining(60 if timeout is None else min(60,timeout))) as response:
                raw=response.read().decode();code=response.status
        except urllib.error.HTTPError as error:
            raw=error.read().decode();code=error.code
        result=json.loads(raw) if raw else None
        record.update(status=code,response=result)
        self.save(f'http-{number:04d}',record)
        if expected_code is None:
            assert 200<=code<300,(path,code,result)
        else:
            assert code>=400 and isinstance(result,dict) and result.get('code')==expected_code,(path,code,result,expected_code)
        return result

    def actor(self,label,roles):
        email='review-'+uuid.uuid4().hex+'@example.test';password=secrets.token_urlsafe(32)+'Aa1!'
        user=self.http('/auth/v1/admin/users',{'email':email,'password':password,'email_confirm':True,'app_metadata':{'roles':['DVM'],'role':'DVM'}},self.service)
        actor={'id':user['id'],'email':email,'password':password}
        self.runtime.query('update public.profiles set is_active=true,full_name='+q('Synthetic '+label)+' where id='+q(actor['id'])+';delete from public.user_roles where user_id='+q(actor['id'])+';'+''.join('insert into public.user_roles(user_id,role)values('+q(actor['id'])+','+q(role)+');'for role in roles))
        self.login(actor)
        self.actors[label]=actor
        return actor

    def login(self,actor):
        before=None
        if self.baseline is not None and not hasattr(self,'database'):
            self.checkpoint('before-auth-login-'+str(self.http_number));before=self.parent_rows()
        result=self.http('/auth/v1/token?grant_type=password',{'email':actor['email'],'password':actor['password']})
        actor['token']=result['access_token']
        payload=actor['token'].split('.')[1]
        actor['claims']=json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)))
        actor['session_id']=actor['claims']['session_id']
        assert actor['claims']['sub']==actor['id'] and actor['claims']['role']=='authenticated'
        assert self.runtime.query('select count(*)from auth.sessions where id='+q(actor['session_id'])+' and user_id='+q(actor['id'])+' and(not_after is null or not_after>clock_timestamp());',getattr(self,'database','postgres')).strip()=='1'
        if before is not None:
            after=self.parent_rows();self.auth_delta(before,after,actor['id']);self.baseline=after
        return actor

    def sql_claims(self,actor):return "do $claims$ begin perform set_config('request.jwt.claims',"+q(json.dumps(actor['claims']))+",true);end $claims$;"
    def rpc(self,action,actor,request,expected_code=None,timeout=None):
        assert action in FACADES
        return self.http('/rest/v1/rpc/'+FACADES[action],{'p_request':request},actor['token'],expected_code=expected_code,timeout=timeout)
    def parent_rows(self):return self.runtime.json(self.base.ROWS_SQL)
    def review_rows(self):
        return self.runtime.json("select jsonb_build_object("+','.join(q(n)+",(select coalesce(jsonb_agg(to_jsonb(x)order by to_jsonb(x)::text),'[]')from controlled_review."+n+' x)'for n in ('descriptor','definitions','preparations','decisions','cancellations'))+");")
    def auth_delta(self,before,after,actor_id):
        assert set(before)==set(after),'Auth fixture changed original relation inventory'
        changes={key for key in before if before[key]!=after[key]}
        allowed={'auth.users','auth.sessions','auth.refresh_tokens','auth.audit_log_entries','auth.mfa_amr_claims'}
        assert changes<=allowed,('Unexpected Auth fixture relation change',changes-allowed)
        detail={}
        for key in changes:
            old=before[key];new=after[key]
            if key=='auth.users':
                byid={r['id']:r for r in new};assert set(byid)=={r['id']for r in old}
                for row in old:
                    current=byid[row['id']]
                    if row!=current:
                        assert row['id']==actor_id
                        assert {k for k in row if row[k]!=current[k]}<={'last_sign_in_at','updated_at'},'Unexpected Auth user mutation'
            else:
                assert all(row in new for row in old),'Auth fixture rewrote prior retained rows: '+key
                added=[r for r in new if r not in old]
                assert len(added)==1,('Exact one Auth login row expected',key,len(added))
                if key=='auth.sessions':assert added[0]['user_id']==actor_id
                new_sessions=[r['id']for r in after['auth.sessions']if r not in before['auth.sessions']]
                assert len(new_sessions)==1
                if key=='auth.refresh_tokens':assert str(added[0]['user_id'])==actor_id and added[0]['session_id']==new_sessions[0]and added[0]['revoked']is False
                if key=='auth.mfa_amr_claims':assert added[0]['session_id']==new_sessions[0]and added[0]['authentication_method']=='password'
                if key=='auth.audit_log_entries':assert added[0]['payload']['actor_id']==actor_id and added[0]['payload']['action']=='login'
            detail[key]={'before':old,'after':new}
        self.save('auth-fixture-delta-'+str(self.http_number),detail)

    def refresh_baseline(self,label):
        rows=self.parent_rows()
        if self.baseline is not None:
            assert set(self.baseline)==set(rows),'Fixture changed original relation inventory'
            changes={key for key in self.baseline if self.baseline[key]!=rows[key]}
            allowed={'revocation-session':('auth.sessions','not_after'),'revocation-profile':('public.profiles','is_active'),'restored-fixture-profile':('public.profiles','is_active')}
            if label in allowed:
                table,field=allowed[label];assert changes=={table}
                old=self.baseline[table];new=rows[table];byid={r['id']:r for r in new};assert set(byid)=={r['id']for r in old}
                changed=[r for r in old if byid[r['id']]!=r];assert len(changed)==1
                row=changed[0]
                if table=='public.profiles':
                    assert byid[row['id']]==self.expected_profile_fixture,'Exact independent profile fixture row differs'
                else:assert byid[row['id']]==self.expected_session_fixture,'Exact independent session fixture row differs'
                expected=self.actors['competitor']['session_id']if table=='auth.sessions'else self.actors['competitor']['id'];assert row['id']==expected
            elif label in ('revocation-role','restored-fixture-role'):
                assert changes=={'public.user_roles'}
                old=self.baseline['public.user_roles'];new=rows['public.user_roles'];delta=[r for r in old if r not in new]+[r for r in new if r not in old]
                assert delta==[self.expected_role_fixture],'Exact retained role fixture row differs'
            else:assert not changes,'Unenumerated original row change at '+label
        self.save(label+'-original-rows',rows);self.baseline=rows
    def retire_session_fixture(self,actor):
        old=next(row for row in self.baseline['auth.sessions']if row['id']==actor['session_id'])
        stamp=self.runtime.json("select jsonb_build_object('stamp',clock_timestamp()-interval '1 second');")['stamp']
        self.expected_session_fixture={**old,'not_after':stamp}
        self.runtime.query('update auth.sessions set not_after='+q(stamp)+'::timestamptz where id='+q(actor['session_id'])+';')
        self.save('session-fixture-independent-expected',self.expected_session_fixture)

    def role_fixture(self,actor,enabled):
        if not enabled:
            rows=[row for row in self.baseline['public.user_roles']if row['user_id']==actor['id']and row['role']=='DVM']
            assert len(rows)==1;self.expected_role_fixture=rows[0]
            self.runtime.query('delete from public.user_roles where id='+q(rows[0]['id'])+';')
        else:
            self.runtime.query('insert into public.user_roles select * from jsonb_populate_record(null::public.user_roles,'+j(self.expected_role_fixture)+');')
        self.save('role-fixture-independent-expected',self.expected_role_fixture)

    def profile_fixture(self,actor,active):
        old=next(r for r in self.baseline['public.profiles']if r['id']==actor['id'])
        observed=self.runtime.json("begin;set local timezone='UTC';select jsonb_build_object('stamp',now());update public.profiles set is_active="+str(active).lower()+' where id='+q(actor['id'])+';commit;')
        self.expected_profile_fixture={**old,'is_active':active,'updated_at':observed['stamp']}
        self.save('profile-fixture-independent-expected',self.expected_profile_fixture)

    def checkpoint(self,label):
        rows=self.parent_rows();self.save(label+'-original-rows',rows)
        assert rows==self.baseline,'Review protocol changed original full rows: '+label
        self.runtime.query('select controlled_review.required();select controlled_review.validate_history();')
    def definition(self,kind,capability='review',roles=None,enabled=True,product=None,site=None):
        product=product or self.fx['product'];site=site or self.fx['site'];roles=roles or ['DVM']
        identity=str(uuid.uuid4())
        self.runtime.query('insert into controlled_review.definitions select '+q(identity)+'::uuid,'+q(product)+'::uuid,'+q(site)+'::uuid,'+q(kind)+','+q(capability)+',coalesce(max(version),0)+1,'+str(enabled).lower()+',array['+','.join(q(r)for r in roles)+']::text[] from controlled_review.definitions where product_id='+q(product)+' and site_id='+q(site)+' and event_kind='+q(kind)+' and capability='+q(capability)+';')
        return identity
    def request(self,actor,event,decision='approve',operation=None,definition=None,reason='Synthetic independent record review'):
        if definition is None:
            definition=self.runtime.json('select controlled_review.current_definition(jsonb_build_object(\'product_id\',product_id,\'site_id\',controlled_review.site(id),\'event_kind\',event_kind,\'capability\',\'review\'))from public.controlled_stock_events where id='+q(event)+';')['id']
        return {'actor_id':actor['id'],'operation_id':operation or str(uuid.uuid4()),'event_id':event,'definition_id':definition,'decision':decision,'reason':reason}


def seed(ctx):
    operator=ctx.actors['operator']
    source=(ctx.base.SOURCE/'smoke.sql').read_text()
    start=source.index('insert into auth.users')
    end=source.index('insert into catalog_products',start)
    setup='update engine_fx set id='+q(operator['id'])+' where k=\'actor\';update engine_fx set id='+q(operator['session_id'])+' where k=\'session\';'+ctx.sql_claims(operator)
    source=source[:start]+setup+source[end:source.index('select save_catalog_product')]
    source+="\nset constraints all immediate;select jsonb_build_object('fixture_ids',jsonb_object_agg(k,id))from engine_fx;commit;"
    output=ctx.runtime.query(source)
    observations=[json.loads(line)for line in output.splitlines()if line.startswith('{')]
    fixtures=[value['fixture_ids']for value in observations if set(value)=={'fixture_ids'}]
    assert len(fixtures)==1,'Exactly one labelled smoke fixture observation required'
    ctx.fx=fixtures[0]
    # Exact genuine stock actions, not fabricated event rows. Preserve every parent guard.
    def batch(count):
        actor=ctx.actors['operator'];f=ctx.fx
        sql='begin;'+ctx.sql_claims(actor)+'''do $seed$ declare op uuid;h public.controlled_stock_container_heads;args jsonb;context jsonb;begin
 for i in 1..COUNT loop
 op:=gen_random_uuid();select * into strict h from public.controlled_stock_container_heads where container_id=BOTTLE;
 args:=jsonb_build_object('lot_id',LOT::uuid,'quantity','0.001','reason','Synthetic queue boundary source adjustment');
 context:=jsonb_build_object('version',1,'product_id',PRODUCT::uuid,'policy_version_id',POLICY::uuid,'state_head_id',ACTIVE::uuid,'opening_id',OPENING::uuid,
 'basis',jsonb_build_object('kind','physical_record','observed_at',to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'note','Synthetic physical count'),
 'containers',jsonb_build_array(jsonb_build_object('id',h.container_id,'expected_version',h.version,'create',null,
 'after',jsonb_build_object('status',h.status,'location_id',h.location_id,'custodian_id',h.custodian_id),
 'lines',jsonb_build_array(jsonb_build_object('lot_id',LOT::uuid,'channel','available','dispense_id',null,'intake_id',null,'quantity_delta','0.001')))));
 perform public.prepare_controlled_stock_action(ACTOR::uuid,op,'adjust_inventory',args,context);
 perform public.execute_controlled_stock_action(ACTOR::uuid,op);
 end loop;end $seed$;commit;'''
        for key,value in {'COUNT':str(count),'BOTTLE':q(f['bottle_a']),'LOT':q(f['lot']),'PRODUCT':q(f['product']),'POLICY':q(f['policy']),'ACTIVE':q(f['active']),'OPENING':q(f['opening']),'ACTOR':q(actor['id'])}.items():sql=sql.replace(key,value)
        ctx.runtime.query(sql)
    started=time.monotonic();batch(32);elapsed=time.monotonic()-started
    ctx.save('genuine-queue-seed-measurement',{'events':32,'seconds':elapsed,'forecast_remaining_seconds':elapsed*78/32})
    assert elapsed*78/32<120,'Genuine 110 event fixture exceeds separately declared budget; revise plan before acceptance'
    for count in (32,32,14):batch(count)
    ctx.events=ctx.runtime.json('select jsonb_build_object(\'events\',jsonb_agg(id order by sequence))from public.controlled_stock_events where product_id='+q(ctx.fx['product'])+" and event_kind='adjust_inventory';")['events']
    assert len(ctx.events)==111
    from secondary_review_gate_a import native_fixture
    native_fixture(ctx.runtime,ctx.base.SOURCE)
    other=ctx.runtime.json("select jsonb_build_object('other_event',id,'other_product',product_id,'other_site',controlled_review.site(id),'other_event_kind',event_kind)from public.controlled_stock_events where event_kind='record_native_dispense_return_v2:retract_disposal' order by sequence limit 1;")
    ctx.fx.update(other)
    ctx.save('genuine-event-fixture',{'ids':ctx.fx,'adjust_events':ctx.events})
    from secondary_review_queue_acceptance import seed_not_required
    ctx.fx['not_required']=seed_not_required(ctx)
    ctx.refresh_baseline('seeded')


def protocol_boundaries(ctx):
    from secondary_review_gate_a import failed
    reviewer=ctx.actors['reviewer'];operator=ctx.actors['operator'];admin=ctx.actors['admin']
    event=ctx.events[-1];req=ctx.request(reviewer,event)
    results={}
    for label,actor,payload,code in (
        ('self',operator,ctx.request(operator,event),'42501'),
        ('forged_actor',reviewer,{**req,'actor_id':operator['id']},'42501'),
        ('admin_metadata_no_bypass',admin,ctx.request(admin,event),'42501'),
        ('missing_target',reviewer,{**req,'event_id':str(uuid.uuid4())},'42501'),
        ('empty_reason',reviewer,{**req,'reason':''},'23514'),
        ('long_reason',reviewer,{**req,'reason':'x'*4001},'23514'),
        ('request_overflow',reviewer,{**req,'reason':'x'*131073},'23514'),
        ('caller_hash',reviewer,{**req,'target_hash':'forged'},'23514')):
        ctx.rpc('prepare',actor,payload,code);results[label]=True
    # Same account through a genuinely different Auth session remains self-review.
    alternate=dict(operator);ctx.login(alternate)
    ctx.refresh_baseline('alternate-operator-session')
    ctx.rpc('prepare',alternate,ctx.request(alternate,event),'42501')
    for isolation in ('repeatable read','serializable'):
        result=ctx.runtime.sql('begin isolation level '+isolation+';'+ctx.sql_claims(reviewer)+'set local role authenticated;select public.prepare_controlled_secondary_review('+j(req)+');commit;',fail=False)
        failed(result,'23514','Controlled stock requires READ COMMITTED isolation')
    for nested in (False,True):
        local={**req,'operation_id':str(uuid.uuid4())}
        sql='begin;'+ctx.sql_claims(reviewer)+'set local role authenticated;select public.prepare_controlled_secondary_review('+j(local)+');'+('savepoint nested;'if nested else '')+'select public.execute_controlled_secondary_review('+j(local)+');commit;'
        result=ctx.runtime.sql(sql,fail=False)
        failed(result,'23514','Preparation must commit before a later signing transaction')
        assert ctx.rpc('read',reviewer,local)['state']=='missing'
    prepared=ctx.rpc('prepare',reviewer,req)
    assert prepared['state']=='prepared'and prepared['packet']['target']['event_id']==event
    assert ctx.rpc('prepare',reviewer,req)==prepared
    for changed in ({'reason':'Changed'},{'decision':'reject'},{'event_id':ctx.events[-2]},{'definition_id':str(uuid.uuid4())}):
        ctx.rpc('read',reviewer,{**req,**changed},'23505')
    foreign={**req,'actor_id':ctx.actors['competitor']['id']}
    ctx.rpc('read',ctx.actors['competitor'],foreign,'23505')
    saved=ctx.rpc('execute',reviewer,req)
    assert saved['state']=='saved'and saved['packet']is None
    assert saved['receipt']['target']==prepared['packet']['target']
    assert saved['receipt']['due_at']is None and saved['receipt']['deadline_state']=='not_configured'
    assert ctx.rpc('execute',reviewer,req)==saved
    assert ctx.rpc('cancel',reviewer,req)==saved
    # A stock UUID does not authorize review receipt recovery or conflict with its namespace.
    namespace=ctx.request(reviewer,ctx.events[-2],operation=ctx.fx['receive'])
    assert ctx.rpc('read',reviewer,namespace)['state']=='missing'
    assert ctx.rpc('prepare',reviewer,namespace)['state']=='prepared'
    assert ctx.rpc('cancel',reviewer,namespace)['state']=='cancelled'
    ctx.rpc('execute',reviewer,namespace,'PT409')
    # Lost application receipt ACK: receive HTTP status/headers then close
    # without reading the receipt body. Recover only the original operation.
    lost=ctx.request(reviewer,ctx.events[-3],decision='reject')
    ctx.rpc('prepare',reviewer,lost)
    body=json.dumps({'p_request':lost})
    connection=http.client.HTTPConnection('127.0.0.1',64661,timeout=30)
    connection.request('POST','/rest/v1/rpc/'+FACADES['execute'],body,{'apikey':ctx.anon,'Authorization':'Bearer '+reviewer['token'],'Content-Type':'application/json'})
    response=connection.getresponse();assert response.status==200
    connection.close()
    limit=time.monotonic()+30
    while time.monotonic()<limit:
        count=ctx.runtime.query('select count(*)from controlled_review.decisions where operation_id='+q(lost['operation_id'])+';').strip()
        if count=='1':break
        time.sleep(.1)
    assert count=='1','Lost-ACK request did not durably commit'
    recovered=ctx.rpc('read',reviewer,lost)
    assert recovered['state']=='saved'and recovered['receipt']['decision']=='reject'
    assert ctx.rpc('execute',reviewer,lost)==recovered
    ctx.save('lost-ack',{'request':lost,'recovered':recovered,'response_headers_received':True,'receipt_body_read':False})
    ctx.checkpoint('protocol-boundaries')
    results.update(same_and_nested_prior_commit=True,later_commit=True,self_other_session=True,namespace_isolated=True,lost_ack=True)
    return results,req,saved,lost


def wait_observed(ctx,holder,event,label,stage='event',operation=None):
    until=time.monotonic()+30
    while time.monotonic()<until:
        observation=ctx.runtime.json("select jsonb_build_object('waiters',coalesce(jsonb_agg(jsonb_build_object('pid',a.pid,'backend_start',a.backend_start,'blockers',pg_blocking_pids(a.pid),'wait_event',a.wait_event,'query',a.query,'locks',(select jsonb_agg(to_jsonb(l))from pg_locks l where l.pid=a.pid and l.locktype='advisory'))),'[]'))from pg_stat_activity a where "+str(holder.identity['held_backend'])+"=any(pg_blocking_pids(a.pid)) and a.wait_event='advisory';")
        if observation['waiters']:
            assert len(observation['waiters'])==1
            waiter=observation['waiters'][0]
            assert waiter['pid']!=holder.identity['held_backend']and waiter['backend_start']
            if stage=='barrier':
                key='90271040:0';high=90271040;low=0;subid=2
            else:
                prefix='controlled-review-event:'if stage=='event'else'controlled-review-operation:'
                key=ctx.runtime.json("select jsonb_build_object('key',hashtextextended("+q(prefix+(event if stage=='event'else operation))+",0));")['key']
                unsigned=key%(1<<64);high=unsigned>>32;low=unsigned&0xffffffff;subid=1
            assert any(not lock['granted']and int(lock['classid'])==high and int(lock['objid'])==low and lock['objsubid']==subid for lock in waiter['locks'])
            ctx.save(label+'-observed-wait',{'holder':holder.identity,'observation':observation,'event_id':event,'expected_advisory_key':str(key)})
            return waiter
        time.sleep(.05)
    raise AssertionError('Actual matching event lock waiter not observed: '+label)


def revoked_waits(ctx):
    from secondary_review_gate_a import HeldBackend
    actor=ctx.actors['competitor'];proof={}
    for i,(stage,kind) in enumerate((stage,kind)for stage in ('barrier','operation','event')for kind in ('session','profile','role','definition')):
        req=ctx.request(actor,ctx.events[-40-i])
        ctx.rpc('prepare',actor,req)
        lock="pg_advisory_xact_lock(90271040,0)"if stage=='barrier'else"pg_advisory_xact_lock(hashtextextended("+q(('controlled-review-event:'+req['event_id'])if stage=='event'else('controlled-review-operation:'+req['operation_id']))+",0))"
        holder=HeldBackend(ctx.runtime,'begin;select '+lock+';','revoke-'+stage+'-'+kind+'-holder')
        executor=ThreadPoolExecutor(max_workers=1)
        task=executor.submit(ctx.rpc,'execute',actor,req,'42501')
        try:
            wait_observed(ctx,holder,req['event_id'],'revoke-'+stage+'-'+kind,stage,req['operation_id'])
            ctx.checkpoint('before-revocation-'+kind)
            if kind=='session':ctx.retire_session_fixture(actor)
            elif kind=='profile':ctx.profile_fixture(actor,False)
            elif kind=='role':ctx.role_fixture(actor,False)
            elif stage=='barrier':
                holder.send("insert into controlled_review.definitions select gen_random_uuid(),product_id,site_id,event_kind,capability,version+1,false,roles from controlled_review.definitions where product_id="+q(ctx.fx['product'])+" and site_id="+q(ctx.fx['site'])+" and event_kind='adjust_inventory' and capability='review' order by version desc limit 1;\n")
            else:ctx.definition('adjust_inventory',enabled=False)
            ctx.refresh_baseline('revocation-'+kind)
            holder.finish()
            task.result(timeout=60)
            assert ctx.runtime.query('select count(*)from controlled_review.decisions where operation_id='+q(req['operation_id'])+';').strip()=='0'
            ctx.checkpoint('after-wait-'+kind)
            if kind=='session':ctx.login(actor)
            elif kind=='profile':ctx.profile_fixture(actor,True)
            elif kind=='role':ctx.role_fixture(actor,True)
            else:ctx.definition('adjust_inventory')
            ctx.refresh_baseline('restored-fixture-'+kind)
            proof[stage+'-'+kind]=True
        finally:
            if holder.process.poll()is None:holder.finish('rollback;')
            executor.shutdown(wait=True,cancel_futures=True)
    return proof


def races(ctx):
    from secondary_review_gate_a import HeldBackend
    event=ctx.events[-20]
    requests=[ctx.request(ctx.actors[k],event)for k in ('reviewer','competitor')]
    for actor,req in zip((ctx.actors['reviewer'],ctx.actors['competitor']),requests):ctx.rpc('prepare',actor,req)
    holder=HeldBackend(ctx.runtime,"begin;select pg_advisory_xact_lock(hashtextextended('controlled-review-event:'||"+q(event)+",0));",'cardinality-holder')
    # SQL backends expose precise identity while both true Auth claims contend.
    workers=[]
    try:
        for index,(actor,req)in enumerate(zip((ctx.actors['reviewer'],ctx.actors['competitor']),requests)):
            worker=HeldBackend(ctx.runtime,'begin;'+ctx.sql_claims(actor),'cardinality-'+str(index))
            worker.send('set local role authenticated;select public.execute_controlled_secondary_review('+j(req)+');commit;\n\\q\n')
            workers.append(worker)
        until=time.monotonic()+30
        while time.monotonic()<until:
            records=ctx.runtime.json("select jsonb_build_object('waiters',coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backend_start',backend_start,'blockers',pg_blocking_pids(pid),'wait_event',wait_event)),'[]'))from pg_stat_activity where pid in("+','.join(str(w.identity['held_backend'])for w in workers)+");")
            if all(str(holder.identity['held_backend'])in [str(x)for x in r['blockers']]for r in records['waiters'])and len(records['waiters'])==2:break
            time.sleep(.05)
        else:raise AssertionError('Both cardinality contenders must actually wait')
        assert all(next(r['backend_start']for r in records['waiters']if r['pid']==w.identity['held_backend'])==w.identity['backend_start']for w in workers)
        ctx.save('cardinality-observed-wait',records);holder.finish()
        outcomes=[worker.collect()for worker in workers]
        assert sorted(x.returncode==0 for x in outcomes)==[False,True]
        loser=next(x for x in outcomes if x.returncode)
        from secondary_review_gate_a import failed
        failed(loser,'23505','Review target already has a final decision')
        loser_index=outcomes.index(loser);loser_actor=(ctx.actors['reviewer'],ctx.actors['competitor'])[loser_index]
        loser_state=ctx.rpc('read',loser_actor,requests[loser_index]);assert loser_state['state']=='prepared'and loser_state['receipt']is None
        assert ctx.runtime.query('select count(*)from controlled_review.decisions where event_id='+q(event)+';').strip()=='1'
    finally:
        if holder.process.poll()is None:holder.finish('rollback;')
        for worker in workers:
            if worker.process.poll()is None:worker.process.terminate();worker.process.wait(timeout=10)
    for index,first in enumerate(('cancel','execute')):
        actor=ctx.actors['reviewer'];req=ctx.request(actor,ctx.events[-21-index]);ctx.rpc('prepare',actor,req)
        holder=HeldBackend(ctx.runtime,'begin;'+ctx.sql_claims(actor)+'set local role authenticated;select public.'+FACADES[first]+'('+j(req)+');reset role;','terminal-'+first)
        second='execute'if first=='cancel'else'cancel'
        pool=ThreadPoolExecutor(max_workers=1)
        try:
            task=pool.submit(ctx.rpc,second,actor,req,'PT409'if first=='cancel'else None)
            until=time.monotonic()+30
            while time.monotonic()<until:
                observed=ctx.runtime.json("select jsonb_build_object('waiters',coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backend_start',backend_start,'blockers',pg_blocking_pids(pid))),'[]'))from pg_stat_activity where "+str(holder.identity['held_backend'])+'=any(pg_blocking_pids(pid));')
                if observed['waiters']:break
                time.sleep(.05)
            assert observed['waiters'];ctx.save('terminal-'+first+'-wait',observed);holder.finish()
            result=task.result(timeout=60)
            if first=='execute':assert result['state']=='saved'
        finally:
            if holder.process.poll()is None:holder.finish('rollback;')
            pool.shutdown(wait=True,cancel_futures=True)
    ctx.checkpoint('cardinality-cancellation-races')
    return {'two_reviewers_one_decision':True,'cancel_first_refuses_execute':True,'execute_first_cancel_returns_receipt':True}


def install(runtime,base,binding,baseline,parent,package):
    from secondary_review_gate_a import original_rows_preflight,failed
    from cli_atomicity import _snapshot
    rows=runtime.json(base.ROWS_SQL);catalog=_snapshot(runtime.query)
    admission=base.independent_preflight(binding,baseline,parent)+original_rows_preflight(rows,base.ROWS_SQL)
    body=admission+package['ddl']+'\n'+package['descriptor_insert']+"\ndo $verify$ begin perform controlled_review.required();if controlled_review.snapshot()is distinct from "+j(package['expected'])+" then raise exception 'Independent final metadata literal differs';end if;end $verify$;"
    statements=package['ddl'].splitlines()
    markers=[('schema','create schema controlled_review authorization postgres;'),('tables',next(line for line in statements if line.startswith('create table controlled_review.cancellations('))),('functions','revoke all on function controlled_review.snapshot() from public,anon,authenticated,service_role;')]
    trigger_line=next(line for line in statements if line.startswith('CREATE TRIGGER review_guard'))
    markers.append(('triggers',trigger_line))
    cases=[(label,admission+package['ddl'].split(marker)[0]+marker)for label,marker in markers]
    cases += [('descriptor',admission+package['ddl']+'\n'+package['descriptor_insert']),('before_commit',body)]
    for label,prefix in cases:
        notice='Final review installer armed '+label
        error='Final review installer deliberate rollback'
        result=runtime.sql('begin;'+prefix+'\ndo $fail$ begin raise notice '+q(notice)+';raise exception '+q(error)+" using errcode='P0001';end $fail$;commit;",fail=False)
        failed(result,'P0001',error,notice)
        assert runtime.json(base.ROWS_SQL)==rows and _snapshot(runtime.query)==catalog
    runtime.query('begin;'+body+'commit;notify pgrst,\'reload schema\';')
    assert runtime.json(base.ROWS_SQL)==rows
    assert runtime.json('select public.controlled_stock_manifest_snapshot();')==parent['expected_technical_manifest']
    assert runtime.json('select controlled_review.snapshot();')==package['expected']
    return {'independent_expected_inside_transaction':True,'armed_ddl_stages':[x[0]for x in cases]}


def decision_append(ctx,before,after,request,response,actor,started,finished):
    preparation=next(row for row in before['preparations']if row['operation_id']==request['operation_id'])
    receipt=response['receipt'];assert response['state']=='saved'
    stamp=datetime.fromisoformat(receipt['recorded_at'].replace('Z','+00:00'))
    assert datetime.fromisoformat(started.replace('Z','+00:00'))<=stamp<=datetime.fromisoformat(finished.replace('Z','+00:00'))
    name=next(row['full_name']for row in ctx.baseline['public.profiles']if row['id']==actor['id'])
    expected_receipt={'version':1,'operation_id':request['operation_id'],'event_id':request['event_id'],
      'target':preparation['target'],'target_hash':preparation['target_hash'],'request_hash':preparation['request_hash'],
      'packet_hash':preparation['packet_hash'],'actor_id':actor['id'],'session_id':actor['session_id'],'actor_name':name,
      'definition_id':preparation['definition_id'],'definition_version':next(row['version']for row in before['definitions']if row['id']==preparation['definition_id']),
      'decision':preparation['decision'],'reason':preparation['reason'],'meaning':preparation['meaning_text'],
      'meaning_version':preparation['meaning_version'],'recorded_at':receipt['recorded_at'],'due_at':None,'deadline_state':'not_configured'}
    assert receipt==expected_receipt,'Restored decision receipt differs from independently bound preparation/session'
    row={key:preparation[key]for key in ('operation_id','event_id','actor_id','definition_id','target_hash','request_hash','packet_hash','decision','reason','meaning_text','meaning_version')}
    row.update(session_id=actor['session_id'],actor_name=name,recorded_at=receipt['recorded_at'],receipt=expected_receipt)
    assert set(before)==set(after)
    assert all(before[key]==after[key]for key in before if key!='decisions')
    normalize=lambda values:sorted(json.dumps(value,sort_keys=True)for value in values)
    assert normalize(after['decisions'])==normalize(before['decisions']+[row]),'Exactly one independently expected decision append required'
    return row


def restore(ctx,saved_request,saved_state,lost_request):
    from urllib.parse import urlsplit,urlunsplit
    import socket
    runtime=ctx.runtime
    actor=ctx.actors['reviewer']
    late_a=ctx.request(actor,ctx.events[-60]);late_b=ctx.request(actor,ctx.events[-61])
    ctx.rpc('prepare',actor,late_a);ctx.rpc('prepare',actor,late_b)
    ctx.checkpoint('late-preparations-before-restart')
    before=ctx.parent_rows();review=ctx.review_rows()
    queue_request={'actor_id':ctx.actors['reviewer']['id'],'product_id':ctx.fx['product'],'site_id':ctx.fx['site'],'event_kind':'adjust_inventory','page_size':100}
    queue_before=ctx.rpc('queue',ctx.actors['reviewer'],queue_request)
    old_boot=runtime.query('select pg_postmaster_start_time();').strip()
    runtime.verify();runtime.command(['docker','restart',runtime.container],timeout=60)
    until=time.monotonic()+30
    while time.monotonic()<until:
        result=runtime.sql('select pg_postmaster_start_time();',fail=False)
        if result.returncode==0:break
        time.sleep(.2)
    assert result.returncode==0 and result.stdout.strip()!=old_boot
    assert ctx.parent_rows()==before and ctx.review_rows()==review
    runtime.query('select controlled_review.validate_history();')
    started=runtime.json("select jsonb_build_object('stamp',clock_timestamp());")['stamp']
    signed_a=ctx.rpc('execute',actor,late_a)
    finished=runtime.json("select jsonb_build_object('stamp',clock_timestamp());")['stamp']
    after_a=ctx.review_rows();expected_a=decision_append(ctx,review,after_a,late_a,signed_a,actor,started,finished)
    assert ctx.parent_rows()==before
    ctx.save('post-restart-new-signature',{'request':late_a,'expected_decision':expected_a,'before':review,'after':after_a})
    review=after_a
    queue_before=ctx.rpc('queue',actor,queue_request)
    lost_receipt=ctx.rpc('read',actor,lost_request)['receipt']
    from secondary_review_restore_ownership import SCOPES,MAP_SQL,LONG_FUNCTIONS_SQL,admitted,extension_bootstrap,auth_entries,differences,verify_long_identities
    scopes=SCOPES
    source_ownership=admitted(runtime.json(MAP_SQL))
    verify_long_identities(source_ownership,runtime.json(LONG_FUNCTIONS_SQL))
    ctx.save('populated-source-owner-acl-map',source_ownership)
    source_parent=runtime.json('select public.controlled_stock_manifest_snapshot();')
    source_review=runtime.json('select controlled_review.snapshot();')
    runtime.verify()
    dump=runtime.command(['docker','exec',runtime.container,'pg_dump','-U','postgres',*[f'--schema={s}'for s in scopes],'postgres'],timeout=120).stdout
    (runtime.folder/'final-populated-selected-schema.sql').write_text(dump)
    rewritten='\n'.join(line for line in dump.splitlines()if not line.startswith('ALTER DEFAULT PRIVILEGES')).replace('CREATE SCHEMA extensions;','CREATE SCHEMA IF NOT EXISTS extensions;')
    database='owned_review_restore_'+uuid.uuid4().hex[:10];marker=str(uuid.uuid4())
    runtime.query('create database '+database+';');runtime.databases[database]=marker
    runtime.query('comment on database '+database+' is '+q(marker)+';')
    runtime.sql(extension_bootstrap(source_ownership),database,user='supabase_admin')
    runtime.sql(rewritten,database,user='supabase_admin')
    restored_ownership=admitted(runtime.json(MAP_SQL,database))
    verify_long_identities(restored_ownership,runtime.json(LONG_FUNCTIONS_SQL,database))
    ctx.save('populated-restored-owner-acl-map',restored_ownership)
    ctx.save('populated-owner-acl-bootstrap-differences',{'objects':differences(source_ownership,restored_ownership),'source_extensions':source_ownership['extensions'],'clone_extensions':restored_ownership['extensions'],'claim':'Auth inventory exact; other extension members/default ACLs excluded from ownership claim'})
    assert auth_entries(restored_ownership)==auth_entries(source_ownership),'Restored Auth owners or raw ACLs differ from original source'
    assert runtime.json('select public.controlled_stock_manifest_snapshot();',database)==source_parent
    assert runtime.json('select controlled_review.snapshot();',database)==source_review
    assert runtime.json(ctx.base.ROWS_SQL,database)==before
    review_sql="select jsonb_build_object("+','.join(q(n)+",(select coalesce(jsonb_agg(to_jsonb(x)order by to_jsonb(x)::text),'[]')from controlled_review."+n+' x)'for n in review)+");"
    assert runtime.json(review_sql,database)==review
    runtime.query('select controlled_review.required();select controlled_review.validate_history();',database)
    clone=object.__new__(Context);clone.__dict__=ctx.__dict__.copy();clone.database=database;clone.evidence_prefix='clone-';clone.http_number=0
    clone.clone_urls={'auth':'http://127.0.0.1:64665','rest':'http://127.0.0.1:64666'}
    extras=[];original_services={}
    try:
        for service,port,inside,key in (('auth',64665,9999,'GOTRUE_DB_DATABASE_URL'),('rest',64666,3000,'PGRST_DB_URI')):
            with socket.socket()as sock:sock.bind(('127.0.0.1',port))
            original=runtime.verify('supabase_'+service+'_'+runtime.identity)
            original_services[service]=original
            networks=original['NetworkSettings']['Networks'];assert len(networks)==1
            network=next(iter(networks));env=[];replaced=0;schema_replaced=0
            for item in original['Config']['Env']:
                if item.startswith(key+'='):
                    parsed=urlsplit(item.split('=',1)[1]);assert parsed.path=='/postgres' and parsed.hostname==runtime.container
                    item=key+'='+urlunsplit((parsed.scheme,parsed.netloc,'/'+database,parsed.query,parsed.fragment));replaced+=1
                if service=='rest'and item.startswith('PGRST_DB_SCHEMAS='):
                    assert item=='PGRST_DB_SCHEMAS=public,graphql_public'
                    item='PGRST_DB_SCHEMAS=public';schema_replaced+=1
                env.append(item)
            assert replaced==1 and schema_replaced==(1 if service=='rest'else 0)
            envpath=runtime.folder/('clone-'+service+'-private.env');envpath.write_text('\n'.join(env)+'\n');os.chmod(envpath,0o600)
            name='owned_review_'+service+'_'+runtime.identity
            argv=['docker','run','-d','--name',name,'--network',network,'--label','com.supabase.cli.project='+runtime.identity,'--label','com.supabase.cli.workdir='+str(runtime.project),'--label','controlled-review-clone='+marker,'--env-file',str(envpath),'-p','127.0.0.1:'+str(port)+':'+str(inside),original['Image']]
            argv+=original['Config'].get('Cmd')or[]
            identity=runtime.command(argv).stdout.strip();extras.append((identity,name,service,original['Image']))
            actual=runtime.verify(identity)
            assert actual['Id']==identity and actual['Image']==original['Image']and actual['Config']['Labels']['controlled-review-clone']==marker
            assert actual['HostConfig']['PortBindings'][str(inside)+'/tcp']==[{'HostIp':'127.0.0.1','HostPort':str(port)}]
            assert set(actual['NetworkSettings']['Networks'])=={network}
            assert sorted(actual['Config']['Env'])==sorted(env),'Clone service environment differs from declared adapter'
            if service=='rest':assert [v for v in actual['Config']['Env']if v.startswith('PGRST_DB_SCHEMAS=')]==['PGRST_DB_SCHEMAS=public']
        ctx.save('clone-api-ownership',{'database':database,'marker':marker,'rest_schema_adapter':{'source':'public,graphql_public','clone':'public','graphql_restore_proven':False},'containers':[{'id':i,'name':n,'service':s,'image':im}for i,n,s,im in extras]})
        # Retire copied sessions on the clone, preserving immutable history and original source DB.
        retirement_stamp=runtime.json("select jsonb_build_object('stamp',clock_timestamp()-interval '1 second');",database)['stamp']
        runtime.query('update auth.sessions set not_after='+q(retirement_stamp)+'::timestamptz;',database)
        retired=runtime.json(ctx.base.ROWS_SQL,database)
        assert set(retired)==set(before)
        assert all(retired[k]==before[k]for k in before if k!='auth.sessions')
        originals={r['id']:r for r in before['auth.sessions']};assert set(originals)=={r['id']for r in retired['auth.sessions']}
        assert all(r=={**originals[r['id']],'not_after':retirement_stamp}for r in retired['auth.sessions'])
        old_actor=dict(ctx.actors['reviewer'])
        until=time.monotonic()+30
        while True:
            try:
                remaining=until-time.monotonic();assert remaining>0,'Clone REST startup deadline elapsed'
                clone.rpc('read',old_actor,saved_request,'42501',timeout=remaining)
                assert time.monotonic()<until,'Clone REST became ready after the startup deadline'
                break
            except (urllib.error.URLError,ConnectionError):
                assert time.monotonic()<until;time.sleep(.2)
            except AssertionError as error:
                # The exact first-request cache startup response is not an Auth
                # refusal. Retain it and wait boundedly for the genuine refusal.
                detail=error.args[0]if len(error.args)==1 else None
                if not(isinstance(detail,tuple)and len(detail)==4 and
                       detail[0]=='/rest/v1/rpc/'+FACADES['read']and detail[1]==503 and
                       isinstance(detail[2],dict)and detail[2].get('code')=='PGRST002'and detail[3]=='42501'):
                    raise
                assert time.monotonic()<until,'Clone REST schema cache did not become ready'
                time.sleep(.2)
        fresh=dict(old_actor);clone.login(fresh)
        assert fresh['session_id']!=old_actor['session_id']
        after_login=runtime.json(ctx.base.ROWS_SQL,database)
        clone.auth_delta(retired,after_login,fresh['id'])
        recovered=clone.rpc('read',fresh,saved_request)
        assert recovered['receipt']==saved_state['receipt']and recovered['state']=='saved'
        assert clone.rpc('execute',fresh,saved_request)['receipt']==saved_state['receipt']
        assert clone.rpc('queue',fresh,queue_request)==queue_before
        assert clone.rpc('read',fresh,lost_request)['receipt']==lost_receipt
        ctx.save('restored-queue-exact',queue_before)
        assert runtime.json(review_sql,database)==review
        started=runtime.json("select jsonb_build_object('stamp',clock_timestamp());",database)['stamp']
        signed_b=clone.rpc('execute',fresh,late_b)
        finished=runtime.json("select jsonb_build_object('stamp',clock_timestamp());",database)['stamp']
        clone_after=runtime.json(review_sql,database)
        expected_b=decision_append(ctx,review,clone_after,late_b,signed_b,fresh,started,finished)
        ctx.save('post-restore-new-signature',{'request':late_b,'expected_decision':expected_b,'before':review,'after':clone_after})
        assert runtime.json(ctx.base.ROWS_SQL,database)==after_login
        assert ctx.parent_rows()==before and ctx.review_rows()==review
        ctx.save('populated-restore-recovery',{'stored_review_rows_exact':True,'old_sessions_retired':True,'fresh_real_auth_session':fresh['session_id'],'receipt':recovered['receipt'],'selected_schemas':scopes,'auth_owner_and_raw_acl_inventory_exact':True,'other_extension_members_owner_acl_restore_proven':False,'same_cluster_roles_not_recreated':True,'default_acl_restore_proven':False,'storage_bytes_proven':False})
    finally:
        for identity,name,service,image in reversed(extras):
            actual=runtime.verify(identity)
            assert actual['Name']=='/'+name and actual['Image']==image and actual['Config']['Labels']['controlled-review-clone']==marker
            runtime.command(['docker','logs','--tail','200',identity],fail=False)
            runtime.command(['docker','rm','-f',identity])
            assert not runtime.command(['docker','ps','-aq','--filter','id='+identity]).stdout.strip()
            original=original_services[service];unchanged=runtime.verify(original['Id'])
            assert unchanged['Id']==original['Id']and unchanged['Config']['Env']==original['Config']['Env']
    return {'actual_restart':True,'new_signature_after_restart':True,'fresh_new_signature_after_restore':True,'lost_application_receipt_body_recovered_in_clone':True,'exact_populated_selected_schema_restore':True,'retired_clone_tokens_denied':True,'fresh_clone_auth_recovery':True,'original_source_unchanged':True}


def expiry(ctx,request,saved_request,saved_state,actual=True):
    from secondary_review_gate_a import HeldBackend
    prepared=ctx.rpc('read',ctx.actors['reviewer'],request)
    expires=datetime.fromisoformat(prepared['expires_at'].replace('Z','+00:00')).timestamp()
    if not actual:return {'natural_expiry_skipped_exercise_only':True}
    timeout_guard(ctx)
    while expires-time.time()>EXPIRY_WAIT_LEAD_SECONDS:
        seconds=min(30,expires-time.time()-EXPIRY_WAIT_LEAD_SECONDS)
        print('Natural preparation expiry: '+str(round(expires-time.time()))+' seconds remain',flush=True)
        time.sleep(seconds)
        ctx.runtime.remaining(1)
    holder=HeldBackend(ctx.runtime,"begin;select pg_advisory_xact_lock(hashtextextended('controlled-review-event:'||"+q(request['event_id'])+",0));",'expiry-holder')
    pool=ThreadPoolExecutor(max_workers=1)
    task=pool.submit(ctx.rpc,'execute',ctx.actors['reviewer'],request,'PT409')
    try:
        waiter=wait_observed(ctx,holder,request['event_id'],'expiry')
        assert time.time()<expires,'Expiry waiter must actually start before deadline'
        waiting=[lock for lock in waiter['locks']if not lock['granted']]
        assert len(waiting)==1
        waitstart=datetime.fromisoformat(waiting[0]['waitstart'].replace('Z','+00:00')).timestamp()
        assert waitstart<expires,'Server lock wait must precede immutable expiry'
        while time.time()<=expires+.2:time.sleep(min(.2,expires+.3-time.time()))
        before_release=ctx.runtime.json("select jsonb_build_object('stamp',clock_timestamp());")['stamp']
        assert datetime.fromisoformat(before_release.replace('Z','+00:00')).timestamp()>=expires
        holder.finish()
        released=ctx.runtime.json("select jsonb_build_object('stamp',clock_timestamp());")['stamp']
        assert datetime.fromisoformat(released.replace('Z','+00:00')).timestamp()>=expires
        ctx.save('expiry-server-clock-boundary',{'expires_at':prepared['expires_at'],'waitstart':waiting[0]['waitstart'],'before_release':before_release,'after_release':released,'lead_seconds':EXPIRY_WAIT_LEAD_SECONDS})
        task.result(timeout=60)
        state=ctx.rpc('read',ctx.actors['reviewer'],request)
        assert state['state']=='expired'and state['packet']is None and state['receipt']is None
        assert ctx.rpc('execute',ctx.actors['reviewer'],saved_request)['receipt']==saved_state['receipt']
        ctx.checkpoint('actual-natural-expiry')
        return {'natural_15_minute_elapsed':True,'observed_wait_before_deadline':waiter,'fresh_execute_after_deadline_refused':True,'saved_receipt_survives_expiry':True}
    finally:
        if holder.process.poll()is None:holder.finish('rollback;')
        pool.shutdown(wait=True,cancel_futures=True)


def run(runtime,base,binding,baseline,parent,actual_expiry=True,restore_only=False):
    assert not(restore_only and actual_expiry),'Restore diagnostic cannot claim acceptance'
    package=frozen_package(base.SOURCE,'synthetic_auth')
    proof={'installation':install(runtime,base,binding,baseline,parent,package)}
    ctx=Context(runtime,base);ctx.frozen_package=package
    timeout_guard(ctx)
    for label,roles in (('operator',['DVM','ADMIN']),('reviewer',['DVM']),('competitor',['DVM']),('reader',['STAFF']),('admin',['ADMIN'])):ctx.actor(label,roles)
    seed(ctx)
    from secondary_review_queue_acceptance import run as queue_run
    proof['queue']=queue_run(ctx)
    # Current definitions now restored by queue proof. Anchor the real 15-minute timer.
    proof['boundaries'],saved_request,saved_state,lost=protocol_boundaries(ctx)
    if restore_only:
        proof['scope']='restore-only diagnostic; revocation/race/schema/expiry matrix not executed'
    else:
        proof['revocation_waits']=revoked_waits(ctx)
        expiry_request=ctx.request(ctx.actors['reviewer'],ctx.events[-30]);ctx.rpc('prepare',ctx.actors['reviewer'],expiry_request)
        proof['races']=races(ctx)
        from secondary_review_schema_acceptance import run as schema_run
        proof['schema_negatives']=schema_run(ctx)
    # Genuine separately retained correction is a new target; prior decision cannot approve it.
    correction=ctx.fx['other_event'];product=ctx.fx['other_product'];site=ctx.fx['other_site']
    definition=ctx.definition('record_native_dispense_return_v2:retract_disposal',product=product,site=site)
    correction_request=ctx.request(ctx.actors['reviewer'],correction,definition=definition)
    ctx.rpc('prepare',ctx.actors['reviewer'],correction_request)
    ctx.rpc('read',ctx.actors['reviewer'],{**saved_request,'event_id':correction},'23505')
    correction_saved=ctx.rpc('execute',ctx.actors['reviewer'],correction_request)
    assert correction_saved['receipt']['target']!=saved_state['receipt']['target']
    ctx.checkpoint('genuine-correction-new-signature')
    linked=runtime.json("select jsonb_build_object('source_link',to_jsonb(l),'correction',to_jsonb(r),'predecessor',to_jsonb(p),'target',controlled_review.target(e.id),'predecessor_target',(select to_jsonb(prior)from public.controlled_stock_source_links pl join public.controlled_stock_events prior on prior.id=pl.event_id where pl.return_event_id=p.id))from public.controlled_stock_events e join public.controlled_stock_source_links l on l.event_id=e.id join public.native_return_events r on r.id=l.return_event_id join public.native_return_events p on p.id=(r.document#>>'{correction_target,event_id}')::uuid where e.id="+q(correction)+';')
    assert linked['correction']['action']=='retract_disposal'and linked['predecessor']['action']=='dispose'
    assert linked['correction']['document']['correction_target']['record_hash']==linked['predecessor']['record_hash']
    assert correction_saved['receipt']['event_id']==correction and correction_saved['receipt']['target']==linked['target']
    assert ctx.rpc('read',ctx.actors['reviewer'],saved_request)['receipt']==saved_state['receipt']
    assert linked['predecessor_target']['event_kind']=='record_native_dispense_return:dispose'
    assert runtime.query('select count(*)from controlled_review.decisions where event_id='+q(linked['predecessor_target']['id'])+';').strip()=='0'
    proof['correction_new_signature']={'genuine_linked_correction_has_own_decision':True,'old_unrelated_saved_receipt_unchanged':True,'predecessor_kind_unsupported_and_unsigned':True,'predecessor_signature_proven':False}
    ctx.save('genuine-correction-source-binding',linked)
    proof['restore']=restore(ctx,saved_request,saved_state,lost)
    if not restore_only:proof['expiry']=expiry(ctx,expiry_request,saved_request,saved_state,actual_expiry)
    ctx.checkpoint('final')
    assert runtime.json('select public.controlled_stock_manifest_snapshot();')==parent['expected_technical_manifest']
    ctx.save('final-review-rows',ctx.review_rows())
    return proof
