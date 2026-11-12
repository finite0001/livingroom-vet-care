"""Appointment and restock acceptance in a disposable database, with synthetic rows."""
import json
from pathlib import Path
import re
import subprocess
import time
import uuid

from appointment_restock_http import verify_conflict_http

ROOT = Path(__file__).resolve().parents[2]
NAME = 'lrv-appointment-restock-' + uuid.uuid4().hex[:10]

def run(*args, body=None):
    result = subprocess.run(args, input=body, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr or result.stdout)
    return result.stdout.strip()

def sql(body):
    return run('docker', 'exec', '-i', NAME, 'psql', '-U', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', body=body)

def ident(number):
    return str(uuid.UUID(int=number))

actor, outsider, pet, other, household, vaccine, service, lot, expired, treatment, historical, visit, other_visit, cancelled, later_visit = map(ident, range(1, 16))
prefix = f"set role authenticated;set request.jwt.claim.sub='{actor}';"

def rpc(query):
    return json.loads(sql(prefix + 'select ' + query + ';'))

def rejected(query, expected):
    try:
        sql(query)
    except RuntimeError as exc:
        assert expected in str(exc), str(exc)
        if expected in ('Visit details changed', 'Appointment link changed', 'Restocking setting changed'):
            assert 'PT409' in str(exc) and '40001' not in str(exc), 'Permanent conflicts must not request a transaction retry'
    else:
        raise AssertionError('Expected rejection: ' + expected)

def link(operation, appointment=visit, appointment_version=1, version=0, patient=pet, who=actor, record=treatment, reason='Visit verified'):
    visit_id = f"'{appointment}'" if appointment is not None else 'null'
    av = str(appointment_version) if appointment_version is not None else 'null'
    return f"set_treatment_appointment('{who}','{ident(operation)}','{patient}','{record}',{visit_id},{av},{version},'{reason}')"

def usage(appointment=visit):
    return rpc(f"read_appointment_treatment_usage('{pet}','{appointment}')")

def context():
    return rpc(f"read_treatment_appointment('{pet}','{treatment}','2026-11-09')")

def setting(threshold, version=0, product=vaccine):
    return f"save_inventory_restock_setting('{actor}','{product}',{threshold},{version})"

def balance():
    return rpc('read_inventory_restock_alerts()')['rows'][0]

try:
    run('docker','run','--rm','-d','--name',NAME,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine')
    for _ in range(100):
        if 'PostgreSQL init process complete' in run('docker','logs',NAME):
            try:
                sql('select 1;')
                break
            except RuntimeError:
                pass
        time.sleep(.3)
    else:
        raise RuntimeError('Disposable PostgreSQL did not finish startup')
    core = (ROOT / 'supabase/migrations/20260913000000_inventory_billing.sql').read_text()
    tables = '\n'.join(re.search(r'create table public\.' + name + r' \(.*?\n\);',core,re.S).group()
                       for name in ('catalog_products','inventory_lots','inventory_movements'))
    audit = (ROOT / 'supabase/migrations/20260309045202_7de7ae36-24fd-46b2-9fe5-ddd9e38ff237.sql').read_text()
    audit = re.search(r'CREATE OR REPLACE FUNCTION public.audit_trigger_fn\(\).*?\$function\$;', audit, re.S).group()
    sql(f"""
    create role anon;create role authenticated;create role service_role;
    create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
    create function public.is_active_staff(actor uuid) returns boolean language sql as $$select actor='{actor}'::uuid$$;
    create function public.clinical_require_staff() returns uuid language plpgsql as $$begin if not coalesce(public.is_active_staff(auth.uid()),false) then raise exception 'Staff required' using errcode='42501';end if;return auth.uid();end$$;
    grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
    create table public.audit_logs(user_id uuid,action text,table_name text,record_id uuid,old_data jsonb,new_data jsonb);
    create table public.pets(id uuid primary key,client_id uuid not null);
    create type public.appointment_status as enum ('SCHEDULED','CONFIRMED','CANCELLED','COMPLETED','NO_SHOW');
    create table public.appointments(id uuid primary key,pet_id uuid references public.pets,client_id uuid not null,scheduled_at timestamptz not null,appointment_type text not null,status public.appointment_status not null,version integer not null default 1);
    create table public.patient_treatments(id uuid primary key,pet_id uuid not null references public.pets,historical boolean not null,product_name text not null,administered_at timestamptz not null,quantity numeric(14,3) not null,dose text not null);
    create table public.patient_treatment_corrections(treatment_id uuid references public.patient_treatments);
    create table public.billing_invoice_items(id uuid primary key);
    insert into auth.users values('{actor}'),('{outsider}');
    insert into public.pets values('{pet}','{household}'),('{other}','{household}');
    insert into public.appointments values
    ('{visit}','{pet}','{household}','2026-11-10 01:30+00','Wellness','COMPLETED',1),
    ('{other_visit}','{other}','{household}','2026-11-10 01:30+00','Wellness','COMPLETED',1),
    ('{cancelled}','{pet}','{household}','2026-11-10 01:30+00','Wellness','CANCELLED',1),
    ('{later_visit}','{pet}','{household}','2026-11-11 01:30+00','Recheck','CONFIRMED',2);
    insert into public.patient_treatments values
    ('{treatment}','{pet}',false,'Synthetic vaccine','2026-11-10 01:42+00',1,'1 dose'),
    ('{historical}','{pet}',true,'Historical vaccine','2026-11-10 01:42+00',1,'1 dose');
    """ + tables + audit)
    migration = next((ROOT / 'supabase/migrations').glob('*_appointment_links_restock_alerts.sql'))
    sql(migration.read_text())
    # Prove the additive replacement changes only the error classifications,
    # preserving function bodies, signatures, owners and execute privileges.
    definitions = "select jsonb_object_agg(proname,jsonb_build_object('definition',pg_get_functiondef(oid),'owner',proowner,'acl',proacl)) from pg_proc where pronamespace='public'::regnamespace and proname in ('set_treatment_appointment','save_inventory_restock_setting');"
    original = json.loads(sql(definitions))
    sql((ROOT / 'supabase/migrations/20261112210000_nonretryable_visit_restock_conflicts.sql').read_text())
    updated = json.loads(sql(definitions))
    assert set(original) == set(updated) == {'set_treatment_appointment','save_inventory_restock_setting'}
    for name in original:
        assert updated[name] == {**original[name], 'definition': original[name]['definition'].replace("errcode='40001'", "errcode='PT409'")}

    sql(f"""insert into public.catalog_products(id,name,kind,unit,unit_price_cents,created_by) values
    ('{vaccine}','Synthetic vaccine','vaccine','dose',2500,'{actor}'),('{service}','Exam','service','visit',7000,'{actor}');
    insert into public.inventory_lots(id,product_id,lot_number,expires_on,location,created_by) values
    ('{lot}','{vaccine}','LOT-1',(now() at time zone 'America/Denver')::date,'Clinic','{actor}'),
    ('{expired}','{vaccine}','LOT-OLD',(now() at time zone 'America/Denver')::date-1,'Kit','{actor}');""")
    assert [a['id'] for a in context()['appointments']] == [visit]  # Denver day, same patient, eligible status.
    for query, message in [(link(21,other_visit),'Select a visit'),(link(21,cancelled),'Select a visit'),
        (link(21,who=outsider),'Actor mismatch'),(link(21,patient=other),'Practice treatment unavailable'),
        (link(21,record=historical),'Practice treatment unavailable'),(link(21,later_visit),'Visit details changed'),
        (link(21,None,None),'No current appointment link')]:
        rejected(prefix+'select '+query+';',message)
    before = sql("select jsonb_build_array((select count(*) from patient_treatments),(select count(*) from inventory_movements),(select count(*) from billing_invoice_items));")
    event = rpc(link(21))
    assert event == rpc(link(21)) and event['created_by'] == actor and event['version'] == 1
    assert context()['current']['appointment_id'] == visit
    assert [r['id'] for r in usage()] == [treatment]
    rejected(prefix+'select '+link(21,reason='Different reason')+';', 'Operation ID reused')
    rejected(prefix+'select '+link(22,later_visit,2)+';', 'Appointment link changed')
    sql(f"update appointments set scheduled_at=scheduled_at+interval '1 day',version=2 where id='{visit}';")
    assert context()['current']['context_changed'] is True
    assert rpc(link(22,later_visit,2,1))['version'] == 2
    assert usage() == [] and usage(later_visit)[0]['id'] == treatment
    sql(f"insert into patient_treatment_corrections values('{treatment}');")
    assert usage(later_visit)[0]['corrected'] is True
    assert rpc(link(23,None,None,2))['appointment_id'] is None
    assert len(context()['history']) == 3 and usage(later_visit) == []
    assert before == sql("select jsonb_build_array((select count(*) from patient_treatments),(select count(*) from inventory_movements),(select count(*) from billing_invoice_items));")
    assert rpc('read_inventory_restock_alerts()')['rows'] == []
    for threshold in ('-1','1.0001',"'NaN'", "'Infinity'", '100000000000'):
        rejected(prefix+'select '+setting(threshold)+';', 'nonnegative threshold')
    rejected(prefix+'select '+setting(2,product=service)+';', 'active stock product')
    first = rpc(setting(2))
    assert first == rpc(setting(2)) and first['updated_by'] == actor
    assert balance()['counted'] is False
    rejected(prefix+'select '+setting(3)+';', 'Restocking setting changed')
    sql(f"insert into inventory_movements values('{ident(31)}','{expired}',50,'receive','Opening count','{actor}',now());")
    assert balance()['counted'] is True and balance()['balance'] == 0
    sql(f"insert into inventory_movements values('{ident(32)}','{lot}',4,'receive','Opening count','{actor}',now());")
    assert balance()['balance'] == 4
    sql(f"insert into inventory_movements values('{ident(33)}','{lot}',-2,'dispense','Treatment','{actor}',now());")
    assert balance()['balance'] == balance()['threshold'] == 2
    assert rpc(setting('null',1))['threshold'] is None
    assert balance()['threshold'] is None
    assert sql('select count(*) from audit_logs;') == '5'
    rejected("set role anon;select read_inventory_restock_alerts();",'permission denied')
    rejected("set role service_role;select read_inventory_restock_alerts();",'permission denied')
    rejected(f"set role authenticated;set request.jwt.claim.sub='{outsider}';select read_inventory_restock_alerts();",'Staff required')
    rejected(prefix+f"select read_appointment_treatment_usage('{other}','{visit}');",'Appointment unavailable')
    rejected(prefix+"update public.treatment_appointment_events set reason='tampered';",'permission denied')
    rejected(prefix+'delete from public.inventory_restock_settings;', 'permission denied')
    assert sql(f"set role authenticated;set request.jwt.claim.sub='{outsider}';select count(*) from public.treatment_appointment_events;") == '0'
    verify_conflict_http(NAME, actor, [
        ('set_treatment_appointment',dict(p_actor_id=actor,p_id=ident(101),p_pet_id=pet,p_treatment_id=treatment,p_appointment_id=visit,p_appointment_version=2,p_expected_version=0,p_reason='Synthetic stale link')),
        ('set_treatment_appointment',dict(p_actor_id=actor,p_id=ident(102),p_pet_id=pet,p_treatment_id=treatment,p_appointment_id=visit,p_appointment_version=1,p_expected_version=3,p_reason='Synthetic stale appointment')),
        ('save_inventory_restock_setting',dict(p_actor_id=actor,p_product_id=vaccine,p_threshold=3,p_expected_version=0)),
    ])
    print('Appointment ownership, replay, relinking, audit, stock balances and staff boundaries passed.')
finally:
    subprocess.run(['docker','rm','-f',NAME],capture_output=True)
