#!/usr/bin/env python3
"""Disposable native workforce SQL regression; synthetic identities, no hosted access."""
import json
import pathlib
import subprocess
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
ROOT = pathlib.Path(__file__).resolve().parents[2]
A='11111111-1111-4111-8111-111111111111'
B='22222222-2222-4222-8222-222222222222'
C='33333333-3333-4333-8333-333333333333'
name='lrv-workforce-'+uuid.uuid4().hex[:12]
def run(sql, actor=None, role=None, error=None):
    prefix="set statement_timeout='10s';set lock_timeout='5s';"
    if actor: prefix += "set request.jwt.claim.sub='"+actor+"';"
    if role: prefix += 'set role '+role+';'
    p=subprocess.run(['docker','exec','-i',name,'psql','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1'],input=prefix+sql,text=True,capture_output=True,timeout=20)
    if error:
        assert p.returncode and error in p.stderr, p.stderr
        return ''
    assert p.returncode==0,p.stderr
    return p.stdout.strip()
def cmd(action,data,id=None,actor=A,error=None):
    identity=id or str(uuid.uuid4())
    payload=json.dumps(data).replace("'","''")
    return run(f"select public.workforce_command('{action}','{identity}','{payload}'::jsonb);",actor,'authenticated',error)
try:
    subprocess.run(['docker','run','--rm','-d','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine'],check=True,capture_output=True)
    for _ in range(80):
        p=subprocess.run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True)
        if p.returncode==0: break
        time.sleep(.1)
    run('''create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;grant select,insert,update,delete on storage.objects to authenticated,anon;create policy fixture_wide_storage on storage.objects for all to authenticated,anon using(true)with check(true);
      create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;
      create table public.profiles(id uuid primary key,full_name text,is_active boolean,is_on_duty boolean default false);
      create function public.is_active_staff(a uuid)returns boolean language sql as $$select exists(select 1 from public.profiles where id=a and is_active)$$;
      create function public.has_role(a uuid,r text)returns boolean language sql as $$select a='11111111-1111-4111-8111-111111111111'::uuid and r='ADMIN'$$;
      create table public.time_entries(id uuid primary key default gen_random_uuid(),staff_id uuid references public.profiles,clock_in_at timestamptz,clock_out_at timestamptz,note text,created_at timestamptz default now());''')
    run(f"insert into public.profiles values('{A}','Admin',true,false),('{B}','Employee',true,false),('{C}','Other',true,false);")
    run('''create table public.user_roles(user_id uuid,role text);
      create table public.pets(id uuid primary key,name text,species text);
      create table public.clinical_encounters(id uuid primary key,pet_id uuid,visit_at timestamptz,subjective text,objective text,assessment text,plan text,status text);
      create table public.clinical_addenda(id uuid primary key,encounter_id uuid,content text,created_at timestamptz);
      create table public.patient_lab_orders(id uuid primary key,pet_id uuid,test_name text,result_date date,notes text,version integer);''')
    run(f"insert into public.user_roles values('{A}','DVM');")
    paths=list((ROOT/'supabase/migrations').glob('*workforce*.sql'))+list((ROOT/'supabase/migrations').glob('*staff_clinical_tools.sql'))+list((ROOT/'supabase/migrations').glob('*staff_backup_health.sql'))
    for path in sorted(paths): run(path.read_text())
    cmd('access',{'time_manager':True,'pay_manager':True},A)
    cmd('settings',{'version':1,'workweek_start':1,'weekly_hours':40,'daily_hours':None,'auto_close_hours':None,'late_grace_minutes':5,'payroll_provider':None})
    cmd('settings',{'version':1},error='Settings changed')
    cmd('access',{'time_manager':True,'pay_manager':True},C,actor=B,error='Administrator required')
    cmd('holiday',{'day':'2026-12-25','label':'Holiday','closed':True,'paid_hours':0},actor=B,error='Assigned manager')
    for role in ['anon','authenticated']:
        run('select * from workforce.leave_ledger;',B,role,'permission denied')
    run("select public.workforce_read('2026-01-01','2026-12-31');",role='anon',error='permission denied')
    cmd('policy',{'kind':'PTO','monthly_hours':8,'cap_hours':100,'allow_negative':False,'effective_from':'2026-01-01'})
    cmd('enroll',{'staff_id':B,'kind':'PTO','hours':16,'enrolled_on':'2026-01-01'})
    adjustment=str(uuid.uuid4());adjustment_data={'staff_id':B,'kind':'PTO','hours':1,'reason':'Retry check'}
    cmd('adjust_balance',adjustment_data,adjustment);cmd('adjust_balance',adjustment_data,adjustment)
    assert run(f"select sum(hours)from workforce.leave_ledger where staff_id='{B}'and kind='PTO';")=='17'
    cmd('adjust_balance',{**adjustment_data,'hours':2},adjustment,error='already used')
    cmd('adjust_balance',{'staff_id':B,'kind':'PTO','hours':-1,'reason':'Restore synthetic opening balance'})
    rid=str(uuid.uuid4())
    cmd('request_leave',{'kind':'PTO','starts_on':'2026-12-01','ends_on':'2026-12-01','hours':8,'reason':'private note'},rid,B)
    cmd('decide_leave',{'version':1,'decision':'APPROVED'},rid,actor=C,error='Assigned manager')
    cmd('decide_leave',{'version':1,'decision':'APPROVED'},rid)
    assert run(f"select sum(hours)from workforce.leave_ledger where staff_id='{B}';")=='8'
    cmd('decide_leave',{'version':1,'decision':'APPROVED'},rid,error='Request changed')
    peer=json.loads(run("select public.workforce_read('2026-12-01','2026-12-31');",C,'authenticated'))
    assert len(peer['off'])==1 and peer['requests']==[] and peer['balances']==[]
    assert 'private note' not in json.dumps(peer)
    cmd('decide_leave',{'version':2,'decision':'CANCELLED'},rid,B)
    assert run(f"select sum(hours)from workforce.leave_ledger where staff_id='{B}';")=='16'
    # Two approvals competing for the same balance serialize and only one succeeds.
    rids=[str(uuid.uuid4()),str(uuid.uuid4())]
    for n,r in enumerate(rids):cmd('request_leave',{'kind':'PTO','starts_on':f'2026-12-0{n+3}','ends_on':f'2026-12-0{n+3}','hours':12,'reason':''},r,B)
    def approve(r):
        try:cmd('decide_leave',{'version':1,'decision':'APPROVED'},r);return True
        except AssertionError as e:assert 'Insufficient leave' in str(e);return False
    with ThreadPoolExecutor(2)as pool: assert sum(pool.map(approve,rids))==1
    run("select workforce.run_jobs('2026-03-01');")
    before=run('select count(*)from workforce.leave_ledger;')
    run("select workforce.run_jobs('2026-03-01');")
    assert run('select count(*)from workforce.leave_ledger;')==before
    # A cap receipt must not later backfill the same capped month after a debit.
    cmd('policy',{'kind':'SICK','monthly_hours':8,'cap_hours':8,'allow_negative':False,'effective_from':'2026-01-01'})
    cmd('enroll',{'staff_id':B,'kind':'SICK','hours':8,'enrolled_on':'2026-01-01'})
    run("select workforce.run_jobs('2026-02-01');")
    cmd('adjust_balance',{'staff_id':B,'kind':'SICK','hours':-4,'reason':'Used earlier leave'})
    run("select workforce.run_jobs('2026-02-01');")
    assert run("select sum(hours)from workforce.leave_ledger where kind='SICK';")=='4'
    # Closing a period prevents all existing write routes from mutating frozen entries.
    eid=str(uuid.uuid4());pid=str(uuid.uuid4())
    run(f"insert into public.time_entries(id,staff_id,clock_in_at,clock_out_at)values('{eid}','{B}','2026-04-01T15:00Z','2026-04-01T23:00Z');")
    cmd('period',{'starts_on':'2026-04-01','ends_on':'2026-04-15'},pid)
    cmd('submit_time',{},pid,B);cmd('approve_time',{'staff_id':B},pid);cmd('close_period',{},pid)
    run(f"update public.time_entries set note='legacy correction',clock_out_at=clock_out_at+interval'1 hour'where id='{eid}';")
    frozen=json.loads(run(f"select time_snapshot from workforce.periods where id='{pid}';"))
    assert frozen[0]['clock_out_at'].startswith('2026-04-01T23:00:00')
    def team(action,data,id=None,actor=A,error=None):
        identity=id or str(uuid.uuid4())
        payload=json.dumps(data).replace("'","''")
        return run(f"select public.team_command('{action}','{identity}','{payload}'::jsonb);",actor,'authenticated',error)
    event=str(uuid.uuid4())
    team('event',{'title':'Team dinner','description':'','starts_at':'2099-12-01T20:00Z','deadline':'2099-12-01T19:00Z','capacity':1},event)
    def rsvp(actor):team('rsvp',{'answer':'YES'},event,actor)
    with ThreadPoolExecutor(2)as pool:list(pool.map(rsvp,[B,C]))
    assert run(f"select count(*)from workforce.event_signups where event_id='{event}'and answer='YES';")=='1'
    assert run(f"select count(*)from workforce.event_signups where event_id='{event}'and answer='WAITLIST';")=='1'
    going=run(f"select staff_id from workforce.event_signups where event_id='{event}'and answer='YES';")
    team('rsvp',{'answer':'NO'},event,going)
    assert run(f"select count(*)from workforce.event_signups where event_id='{event}'and answer='YES';")=='1'
    task=str(uuid.uuid4())
    team('task',{'title':'Kennel','note':'','assignee':B,'due_at':'2099-12-01T20:00Z'},task)
    team('task_status',{'version':1,'done':True},task,C,error='Assigned manager')
    team('task_status',{'version':1,'done':True},task,B)
    team('task_status',{'version':1,'done':False},task,B,error='Task changed')
    team('milestones',{'birthday_month':2,'birthday_day':30,'anniversary':None,'share_birthday':True,'share_anniversary':False},actor=B,error='check constraint')
    run('select * from workforce.milestones;',B,'authenticated','permission denied')
    def people(action,data,id=None,actor=A,error=None):
        identity=id or str(uuid.uuid4());payload=json.dumps(data).replace("'","''")
        return run(f"select public.people_command('{action}','{identity}','{payload}'::jsonb);",actor,'authenticated',error)
    people('payroll',{},pid,error='Add effective pay rates')
    people('rate',{'staff_id':B,'effective_on':'2026-01-01','amount_cents':2500,'basis':'HOURLY','reason':'Opening rate'})
    bonus_id=str(uuid.uuid4());bonus_data={'staff_id':B,'period_id':pid,'amount_cents':10000,'reason':'Approved bonus'}
    people('bonus',bonus_data,bonus_id);people('bonus',bonus_data,bonus_id)
    assert run(f"select count(*)from workforce.bonuses where id='{bonus_id}';")=='1'

    export=json.loads(people('payroll',{},pid))['snapshot']
    assert export['time'][0]['hours']==8 and export['time'][0]['regular_hours']==8
    people('rate',{'staff_id':B,'effective_on':'2026-04-01','amount_cents':2800,'basis':'HOURLY','reason':'Raise'})
    assert json.loads(people('payroll',{},pid))['snapshot']==export
    people('bonus',{'staff_id':B,'period_id':pid,'amount_cents':10000,'reason':'Late bonus'},error='frozen')
    private=json.loads(run('select public.people_read();',C,'authenticated'))
    assert private['rates']==[] and private['bonuses']==[]
    benefit=str(uuid.uuid4())
    people('benefit',{'staff_id':B,'title':'SIMPLE IRA','provider':'Synthetic provider','form_version':'2026','form_url':'https://example.test/form.pdf','due_on':'2026-12-01'},benefit)
    path=B+'/'+benefit+'.pdf'
    assert run(f"select public.workforce_document_access('{path}');",C,'authenticated')=='f'
    run(f"insert into storage.objects(bucket_id,name)values('staff-benefits','{path}');",C,'authenticated','row-level security')
    run(f"insert into storage.objects(bucket_id,name)values('staff-benefits','{path}');",B,'authenticated')
    people('complete_benefit',{},benefit,B)
    assert run(f"select count(*)from storage.objects where name='{path}';",C,'authenticated')=='0'
    assert run(f"select count(*)from storage.objects where name='{path}';",role='anon')=='0'
    run(f"update storage.objects set name='modified'where name='{path}';",B,'authenticated')
    assert run(f"select count(*)from storage.objects where name='{path}';",B,'authenticated')=='1'
    assert run(f"select public.workforce_document_access('{path}',true);",B,'authenticated')=='f'
    target='44444444-4444-4444-8444-444444444444'
    run(f"insert into public.profiles values('{target}','Review subject',true,false);")
    cycle=str(uuid.uuid4())
    people('review_cycle',{'target_id':target,'title':'Team feedback','ends_at':'2099-01-01T00:00Z','min_responses':3,'reviewers':[A,B,C]},cycle)
    for actor in [A,B,C]:people('submit_review',{'score':4,'comment':'Helpful teamwork'},cycle,actor)
    people('submit_review',{'score':4,'comment':'retry'},cycle,B,error='Already submitted')
    assert json.loads(run('select public.people_read();',A,'authenticated'))['results']==[]
    run(f"update workforce.review_cycles set ends_at=now()-interval'1 day'where id='{cycle}';")
    people('close_review',{},cycle)
    result=json.loads(run('select public.people_read();',A,'authenticated'))['results'][0]
    assert result['count']==3 and result['average']==4
    assert run("select count(*)from information_schema.columns where table_schema='workforce'and table_name='review_responses'and column_name in('staff_id','author','created_at');")=='0'
    pet='55555555-5555-4555-8555-555555555555';enc='66666666-6666-4666-8666-666666666666'
    run(f"insert into public.pets values('{pet}','Synthetic Juniper','Dog');insert into public.clinical_encounters values('{enc}','{pet}','2026-01-01T12:00Z','Reported cough.','Exam complete.','Cough.','Rest tonight.','signed');")
    run("select public.review_clinical_tool('fluid','Reference cases reviewed');",B,'authenticated','veterinary staff')
    run("select public.review_clinical_tool('fluid','Reference cases reviewed');",A,'authenticated')
    worksheet={'weight':10,'unit':'kg','species':'dog','dehydration_percent':5,'replacement_hours':24,'ongoing_ml_hour':10}
    calc=json.loads(run(f"select clinical_tools.calculate('fluid','{json.dumps(worksheet)}');"))['values']
    assert abs(calc['total_ml_hour']-(25+500/24+10))<.00001
    run("select clinical_tools.calculate('shock','{\"weight\":10,\"species\":\"dog\"}');",error='Invalid weight/unit')
    calculation=str(uuid.uuid4());input_json=json.dumps(worksheet)
    run(f"select public.save_clinical_calculation('{calculation}','{pet}','fluid','{input_json}');",A,'authenticated')
    run('select * from clinical_tools.calculations;',B,'authenticated','permission denied')
    run("select public.review_clinical_tool('discharge','Source-linked draft reviewed');",A,'authenticated')
    job=str(uuid.uuid4());selection=json.dumps({'encounter_id':enc})
    run(f"select public.claim_clinical_helper('{job}','{pet}','discharge','{selection}');",B,'authenticated')
    run(f"select public.claim_clinical_helper('{job}','{pet}','discharge','{selection}');",B,'authenticated','already exists')
    draft={'claims':[{'text':'Rest tonight.','citations':[{'source_ref':enc,'quote':'Rest tonight.'}]}],'review_flags':[]}
    draft_json=json.dumps(draft)
    run(f"select public.finish_clinical_helper('{job}','{draft_json}','synthetic',null);",B,'authenticated','permission denied')
    run(f"select public.finish_clinical_helper('{job}','{draft_json}','synthetic',null);",role='service_role')
    run(f"select public.review_clinical_helper('{job}','Rest tonight.');",B,'authenticated','veterinary staff')
    run(f"select public.review_clinical_helper('{job}','Rest tonight.');",A,'authenticated')
    assert run(f"select state from clinical_tools.helper_jobs where id='{job}';")=='APPROVED'
    run("select public.review_clinical_tool('pill','Verified references only');",A,'authenticated')
    run(f"select public.claim_clinical_helper('{uuid.uuid4()}','{pet}','pill','{{\"imprint\":\"UNKNOWN\"}}');",B,'authenticated','No verified reference')
    run('select public.read_staff_backups();',B,'authenticated','Assigned manager')
    assert run('select public.read_staff_backups();',A,'authenticated')=='[]'
    print(json.dumps({'passed':True,'checks':['private access','role denials','stale settings','leave privacy','approval cancellation','concurrent balance protection','accrual retry','cap receipt','frozen approved time unaffected by legacy corrections','last-seat concurrency','waitlist promotion','task ownership','milestone privacy','idempotent adjustment and bonus retries','payroll snapshot stability','private compensation','benefit Storage RLS','anonymous review aggregation','clinical known answer','DVM approval boundary','clinical citation persistence','no-match pill abstention'],'hostedWrites':0}))
finally:
    subprocess.run(['docker','rm','-f',name],capture_output=True)
