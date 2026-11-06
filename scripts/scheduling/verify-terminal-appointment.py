#!/usr/bin/env python3
"""Owned PostgreSQL trigger regression. Synthetic Auth settings; no hosted access.
The catalog delegate is instrumented, not a full catalog/RLS/Auth acceptance.
Full hosted source and controlled-metadata checks remain a separate release gate.
"""
import argparse
import hashlib
import json
import pathlib
import subprocess
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
ACTOR = '11111111-1111-4111-8111-111111111111'
INACTIVE = '22222222-2222-4222-8222-222222222222'
OTHER_INACTIVE = '33333333-3333-4333-8333-333333333333'
ACTIVE = '44444444-4444-4444-8444-444444444444'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--migration', default='scripts/scheduling/terminal-appointment-clinician.sql')
    args = parser.parse_args()
    migration = (ROOT / args.migration).resolve()
    if ROOT not in migration.parents or not migration.is_file():
        raise ValueError('Repository SQL required')
    name = 'lrv-appointment-test-' + uuid.uuid4().hex[:12]
    receipt = {'kind': 'terminal-appointment-trigger-postgres-v1', 'passed': False,
               'checks': [], 'syntheticAuth': True, 'fullCatalogIntegration': False,
               'hostedWrites': 0, 'ownedCleanup': False,
               'sourceSha256': hashlib.sha256(migration.read_bytes()).hexdigest()}

    def sql(query, actor=None, expected=None):
        prefix = 'set statement_timeout=10000;set lock_timeout=5000;'
        if actor:
            prefix += "set role authenticated;set request.jwt.claim.sub='" + actor + "';"
        result = subprocess.run(['docker', 'exec', '-i', name, 'psql', '-X', '-qAt',
                                 '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'],
                                input=prefix + query, capture_output=True, text=True, timeout=15)
        if expected:
            assert result.returncode and expected in result.stderr, (expected, result.stderr)
        elif result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout.strip()

    def seed(assignee=INACTIVE, status='SCHEDULED'):
        identity = str(uuid.uuid4())
        sql(f"insert into appointments(id,appointment_type,duration_minutes,status,assigned_dvm_id) values('{identity}','Synthetic visit',30,'{status}','{assignee}');")
        return identity

    def check(label):
        receipt['checks'].append(label)

    try:
        subprocess.run(['docker', 'run', '-d', '--name', name, '--label',
                        'lrv.terminal-appointment-test=true', '--network', 'none',
                        '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine'],
                       check=True, capture_output=True, text=True, timeout=60)
        for _ in range(100):
            ready = subprocess.run(['docker', 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True, timeout=5)
            if ready.returncode == 0:
                break
            time.sleep(.1)
        else:
            raise AssertionError('Owned PostgreSQL did not become ready')
        sql(f"""
create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated;
create table profiles(id uuid primary key,is_active boolean not null);
insert into profiles values('{ACTOR}',true),('{INACTIVE}',false),('{OTHER_INACTIVE}',false),('{ACTIVE}',true);
create function public.is_active_staff(who uuid) returns boolean language sql stable security definer as $$select coalesce((select is_active from profiles where id=who),false)$$;
create function public.appointment_require_staff() returns uuid language plpgsql security definer as $$begin if auth.uid() is null or not is_active_staff(auth.uid()) then raise exception 'Active staff access required' using errcode='42501';end if;return auth.uid();end$$;
create function public.clinical_require_staff() returns uuid language sql security definer as $$select public.appointment_require_staff()$$;
create function public.care_eligibility_lock() returns boolean language plpgsql security definer as $$begin perform pg_advisory_xact_lock(1869440354,1128354373);return true;end$$;
create type appointment_status as enum('SCHEDULED','CONFIRMED','CANCELLED','COMPLETED','NO_SHOW');
create table pets(id uuid primary key,client_id uuid,archived_at timestamptz,deceased_at timestamptz);
create table appointments(id uuid primary key,client_id uuid,pet_id uuid,appointment_type text,duration_minutes integer,status appointment_status not null,assigned_dvm_id uuid,scheduled_at timestamptz default now(),notes text,version integer default1,created_at timestamptz default now(),created_by uuid,updated_by uuid);
create table catalog_guard_calls(id uuid,assignment uuid,status appointment_status);
create function public.guard_appointment_catalog(n appointments,o appointments) returns void language sql as $$insert into catalog_guard_calls values(n.id,n.assigned_dvm_id,n.status)$$;
create table appointment_audit(id uuid,before_assignment uuid,after_assignment uuid,before_status appointment_status,after_status appointment_status);
create function audit_appointment_test() returns trigger language plpgsql security definer as $$begin insert into appointment_audit values(new.id,old.assigned_dvm_id,new.assigned_dvm_id,old.status,new.status);return new;end$$;
grant select,insert,update,delete on appointments to authenticated;
""".replace('default1', 'default 1'))
        sql((ROOT / 'scripts/scheduling/terminal-appointment-baseline.sql').read_text())
        sql('create trigger guard_appointment_write before insert or update or delete on appointments for each row execute function guard_appointment_write();create trigger audit_appointments after update on appointments for each row execute function audit_appointment_test();')
        identity = seed()
        sql(f"select cancel_appointment('{identity}',1);", ACTOR, 'Assigned clinician must be active staff')
        check('unchanged hosted baseline reproduces inactive-assignee cancellation failure')
        acl_before = sql("select proacl::text from pg_proc where oid='guard_appointment_write()'::regprocedure;")
        triggers_before = sql("select string_agg(pg_get_triggerdef(oid),';'order by tgname)from pg_trigger where tgrelid='appointments'::regclass and not tgisinternal;")
        sql(migration.read_text())
        assert sql("select proacl::text from pg_proc where oid='guard_appointment_write()'::regprocedure;") == acl_before
        assert sql("select string_agg(pg_get_triggerdef(oid),';'order by tgname)from pg_trigger where tgrelid='appointments'::regclass and not tgisinternal;") == triggers_before
        check('function ACL and trigger registration unchanged')
        sql(f"select cancel_appointment('{identity}',1);", ACTOR)
        assert sql(f"select status||':'||assigned_dvm_id||':'||version from appointments where id='{identity}';") == f'CANCELLED:{INACTIVE}:2'
        assert sql(f"select before_assignment=after_assignment from appointment_audit where id='{identity}';") == 't'
        check('normal cancellation preserves historical clinician, version increment and audit assignment')
        sql(f"select cancel_appointment('{identity}',1);", ACTOR, 'Appointment changed or no longer exists')
        check('stale cancellation remains conflict')
        for status in ['COMPLETED', 'NO_SHOW']:
            identity = seed()
            sql(f"update appointments set status='{status}' where id='{identity}';", ACTOR)
            assert sql(f"select assigned_dvm_id from appointments where id='{identity}';") == INACTIVE
            sql(f"update appointments set status='SCHEDULED' where id='{identity}';", ACTOR, 'Closed appointments cannot be reactivated')
            check(status + ' preserves historical clinician and cannot reopen')
        identity = seed()
        sql(f"update appointments set scheduled_at=scheduled_at+interval '1 day' where id='{identity}';", ACTOR, 'Assigned clinician must be active staff')
        sql(f"update appointments set status='CONFIRMED' where id='{identity}';", ACTOR, 'Assigned clinician must be active staff')
        sql(f"update appointments set assigned_dvm_id='{OTHER_INACTIVE}',status='CANCELLED' where id='{identity}';", ACTOR, 'Assigned clinician must be active staff')
        check('inactive open reschedule, confirmation and closed reassignment denied')
        for status in ['SCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']:
            sql(f"insert into appointments(id,appointment_type,duration_minutes,status,assigned_dvm_id)values(gen_random_uuid(),'Synthetic',30,'{status}','{INACTIVE}');", ACTOR, 'Assigned clinician must be active staff')
        check('inactive clinician rejected on every new insert including terminal status')
        sql(f"select cancel_appointment('{identity}',1);", INACTIVE, 'Active staff access required')
        sql(f"select cancel_appointment('{identity}',null);", ACTOR, 'Expected appointment version is required')
        sql(f"update appointments set status='CANCELLED',created_at=created_at+interval '1 second' where id='{identity}';", ACTOR, 'Appointment identity and creation metadata are immutable')
        sql(f"update appointments set status='CANCELLED',version=99 where id='{identity}';", ACTOR, 'Appointment version increments must be sequential')
        sql(f"delete from appointments where id='{identity}';", ACTOR, 'Appointments cannot be deleted')
        check('actor, expected version, identity, sequential version and no-delete guards preserved')
        sql(f"update appointments set assigned_dvm_id='{ACTIVE}',scheduled_at=scheduled_at+interval '1 day' where id='{identity}';", ACTOR)
        assert sql(f"select assigned_dvm_id from appointments where id='{identity}';") == ACTIVE
        check('valid active reassignment and reschedule remains available')
        assert int(sql('select count(*)from catalog_guard_calls;')) > 0
        check('catalog delegate still called after successful writes')
        receipt['passed'] = True
    finally:
        result = subprocess.run(['docker', 'rm', '-f', name], capture_output=True, text=True, timeout=30)
        receipt['ownedCleanup'] = result.returncode == 0
        (ROOT / 'docs/evidence/beta-terminal-appointment-postgres-2026-11-06.json').write_text(json.dumps(receipt, indent=2) + '\n')
        print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    main()
