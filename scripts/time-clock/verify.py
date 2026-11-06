#!/usr/bin/env python3
"""Owned PostgreSQL regression for atomic clock corrections; no hosted access.
Auth identities are synthetic JWT settings. This verifies SQL/RLS/locking, not
Supabase Auth issuance or provider behavior. Always removes its own container.
"""
import argparse
import hashlib
import json
import os
import pathlib
import selectors
import subprocess
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
ADMIN = '11111111-1111-4111-8111-111111111111'
STAFF = '22222222-2222-4222-8222-222222222222'
INACTIVE = '33333333-3333-4333-8333-333333333333'
BASE = ROOT / 'supabase/migrations/20260614171114_5b96273b-12b6-48bc-8ff1-d89edc292f62.sql'


def wait_for_marker(process, marker, seconds=10):
    """Bound both Docker transport and SQL startup, without buffered-read races."""
    deadline = time.monotonic() + seconds
    output = {'stdout': bytearray(), 'stderr': bytearray()}
    with selectors.DefaultSelector() as selector:
        selector.register(process.stdout, selectors.EVENT_READ, 'stdout')
        selector.register(process.stderr, selectors.EVENT_READ, 'stderr')
        while marker not in bytes(output['stdout']).splitlines():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('Owned clock writer did not reach its lock marker')
            if not selector.get_map():
                raise AssertionError('Owned clock writer exited before its lock marker: '
                                     + output['stderr'].decode(errors='replace'))
            for key, _ in selector.select(min(remaining, .1)):
                chunk = os.read(key.fileobj.fileno(), 4096)
                if not chunk:
                    selector.unregister(key.fileobj)
                else:
                    output[key.data].extend(chunk)
                    if len(output[key.data]) > 65536:
                        raise AssertionError('Owned clock writer output exceeded its bound')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--migration', default='scripts/time-clock/atomic-time-clock.sql')
    args = parser.parse_args()
    migration = (ROOT / args.migration).resolve()
    if ROOT not in migration.parents or not migration.is_file():
        raise ValueError('Expected a repository migration file')
    name = 'lrv-clock-test-' + uuid.uuid4().hex[:12]
    receipt = {'kind': 'atomic-time-clock-postgres-v1', 'passed': False, 'checks': [],
               'hostedWrites': 0, 'syntheticAuth': True, 'ownedCleanup': False,
               'runnerSha256': hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
               'sqlSha256': hashlib.sha256(migration.read_bytes()).hexdigest()}
    running = []

    def command(sql, actor=None, role=None, expected=None):
        prefix = 'set statement_timeout=10000; set lock_timeout=5000;'
        if role:
            if role not in ('authenticated', 'anon'):
                raise ValueError('Unexpected role')
            prefix += f'set role {role};'
        if actor:
            prefix += f"set request.jwt.claim.sub='{actor}';"
        result = subprocess.run(['docker', 'exec', '-i', name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'],
                                input=prefix + sql, text=True, capture_output=True, timeout=15)
        if expected:
            assert result.returncode != 0 and expected in result.stderr, (expected, result.stderr)
        elif result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout.strip()

    def correct(entry, delete=False, end="'2026-01-02T11:00:00Z'", note="'corrected'", expected_note='null', staff=STAFF):
        return f"select id from public.admin_correct_time_entry('{entry}','{staff}','2026-01-02T10:00:00Z',null,{expected_note},'2026-01-02T10:00:00Z',{end},{note},{str(delete).lower()});"

    def reset():
        command('delete from public.time_entries; update public.profiles set is_on_duty=false;')

    def opened():
        reset()
        entry = command(f"insert into public.time_entries(staff_id,clock_in_at) values('{STAFF}','2026-01-02T10:00:00Z') returning id;")
        command(f"update public.profiles set is_on_duty=true where id='{STAFF}';")
        return entry

    def invariant(open_count):
        actual = command(f"select count(*) || ':' || (select is_on_duty::text from public.profiles where id='{STAFF}') from public.time_entries where staff_id='{STAFF}' and clock_out_at is null;")
        assert actual == f'{open_count}:{str(open_count > 0).lower()}', actual

    try:
        subprocess.run(['docker', 'run', '-d', '--name', name, '--label', 'lrv.atomic-clock-test=true',
                        '--network', 'none', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine'],
                       check=True, capture_output=True, text=True, timeout=60)
        ready = False
        ready_until = time.monotonic() + 20
        while time.monotonic() < ready_until:
            # The entrypoint's temporary initialization server also answers
            # pg_isready. Only the final server replaces PID1 with postgres.
            leader = subprocess.run(['docker', 'exec', name, 'cat', '/proc/1/comm'],
                                    capture_output=True, text=True, timeout=min(5, ready_until-time.monotonic()))
            if leader.returncode == 0 and leader.stdout.strip() == 'postgres':
                remaining = ready_until - time.monotonic()
                if remaining <= 0:
                    break
                result = subprocess.run(['docker', 'exec', name, 'pg_isready', '-U', 'postgres'],
                                        capture_output=True, timeout=min(5, remaining))
                if result.returncode == 0:
                    ready = True
                    break
            time.sleep(.1)
        assert ready, 'Owned database did not become ready'
        command(f"""
          create role authenticated; create role anon; create role service_role bypassrls;
          create schema auth; create table auth.users(id uuid primary key);
          create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
          grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
          create type public.user_role as enum ('ADMIN','DVM','TECH','STAFF');
          create table public.profiles(id uuid primary key references auth.users,role public.user_role not null,is_active boolean not null,full_name text not null default 'Synthetic staff');
          create table public.user_roles(user_id uuid,role public.user_role);
          create function public.has_role(u uuid,r public.user_role) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.user_roles where user_id=u and role=r)$$;
          create function public.is_active_staff(u uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from profiles p join user_roles r on r.user_id=p.id where p.id=u and p.is_active and r.role in ('ADMIN','DVM','TECH','STAFF'))$$;
          create table public.audit_entries(operation text,actor uuid);
          create function public.audit_trigger_fn() returns trigger language plpgsql security definer set search_path=public as $$begin insert into audit_entries values(TG_OP,auth.uid()); return coalesce(new,old); end$$;
          insert into auth.users values ('{ADMIN}'),('{STAFF}'),('{INACTIVE}');
          insert into profiles(id,role,is_active) values ('{ADMIN}','ADMIN',true),('{STAFF}','STAFF',true),('{INACTIVE}','ADMIN',false);
          insert into user_roles values ('{ADMIN}','ADMIN'),('{STAFF}','STAFF'),('{INACTIVE}','ADMIN');
          grant select,update on profiles to authenticated; alter table profiles enable row level security;
          create policy test_profile_read on profiles for select to authenticated using(true);
          create policy test_profile_update on profiles for update to authenticated using(id=auth.uid() or has_role(auth.uid(),'ADMIN'));
        """)
        command(BASE.read_text())
        command((ROOT / 'supabase/migrations/20260921120000_a5_on_duty_guard.sql').read_text())
        guard_before = command("select md5(pg_get_functiondef('public.protect_profile_privileges()'::regprocedure));")
        command(migration.read_text())
        assert command("select md5(pg_get_functiondef('public.protect_profile_privileges()'::regprocedure));") == guard_before
        command('create trigger protect_profile_privileges_trg before update on profiles for each row execute function protect_profile_privileges();')
        entry = opened()
        command(correct(entry), actor=STAFF, role='authenticated', expected='Only active administrators')
        command(correct(entry), actor=INACTIVE, role='authenticated', expected='Only active administrators')
        command(correct(entry), role='anon', expected='permission denied')
        command(f"update time_entries set note='bypass' where id='{entry}';", actor=ADMIN, role='authenticated', expected='permission denied')
        command(f"delete from time_entries where id='{entry}';", actor=ADMIN, role='authenticated', expected='permission denied')
        command(f"update profiles set is_on_duty=false where id='{STAFF}';", actor=ADMIN, role='authenticated')
        assert command('select count(*) from read_on_duty_staff();', actor=ADMIN, role='authenticated') == '1'
        command(f"update profiles set is_on_duty=true where id='{STAFF}';")
        invariant(1)
        receipt['checks'].append('active-admin-only RPC, anonymous and direct-write denial, stale legacy flag cannot falsify duty list')
        for sql in [correct(entry, expected_note="'stale'"), correct(entry, staff=ADMIN), correct(entry).replace('10:00:00Z', '09:00:00Z', 1)]:
            command(sql, actor=ADMIN, role='authenticated', expected='This entry changed')
        command(correct(entry, end="'infinity'"), actor=ADMIN, role='authenticated', expected='Use valid times')
        command(correct(entry, end="'2026-01-02T09:00:00Z'"), actor=ADMIN, role='authenticated', expected='Use valid times')
        invariant(1)
        receipt['checks'].append('stale note/staff/time and invalid interval reject without changing duty')
        command(correct(entry), actor=ADMIN, role='authenticated'); invariant(0)
        reopen = correct(entry, end='null', expected_note="'corrected'").replace("'2026-01-02T10:00:00Z',null", "'2026-01-02T10:00:00Z','2026-01-02T11:00:00Z'",1)
        command(reopen, actor=ADMIN, role='authenticated', expected='cannot be reopened')
        receipt['checks'].append('open correction closes atomically; closed entry cannot reopen')
        entry = opened()
        command(correct(entry, delete=True), actor=ADMIN, role='authenticated'); invariant(0)
        assert command(f"select count(*) from time_entries where id='{entry}';") == '0'
        receipt['checks'].append('open deletion clears duty atomically')
        # Force the second half of the RPC to fail. The first half must roll back.
        entry = opened()
        command("create function test_fail_duty() returns trigger language plpgsql as $$begin if not new.is_on_duty then raise exception 'synthetic failure'; end if; return new; end$$; create trigger test_fail_duty before update on profiles for each row execute function test_fail_duty();")
        command(correct(entry), actor=ADMIN, role='authenticated', expected='synthetic failure'); invariant(1)
        command('drop trigger test_fail_duty on profiles; drop function test_fail_duty();')
        receipt['checks'].append('profile failure rolls back time-entry correction')
        # Keep the admin transaction open until PostgreSQL itself confirms that
        # the concurrent staff connection waits on its lock. Docker startup time
        # is not evidence of serialization.
        entry = opened()
        sql = f"set application_name='lrv-clock-admin'; set statement_timeout=10000; begin; set role authenticated; set request.jwt.claim.sub='{ADMIN}';" + correct(entry) + "select 'LOCKED';\n"
        writer = subprocess.Popen(['docker','exec','-i',name,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        running.append(writer); writer.stdin.write(sql.encode()); writer.stdin.flush()
        wait_for_marker(writer, b'LOCKED')
        staff = subprocess.Popen(['docker','exec','-i',name,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        running.append(staff)
        staff.stdin.write((f"set application_name='lrv-clock-staff'; set statement_timeout=15000; set role authenticated; set request.jwt.claim.sub='{STAFF}'; select id from clock_in();\n").encode())
        staff.stdin.close()
        lock_started = time.monotonic()
        lock_seen = False
        while time.monotonic() - lock_started < 10:
            if staff.poll() is not None:
                raise AssertionError('Staff clock-in completed without the held admin lock: ' + staff.stderr.read().decode(errors='replace'))
            lock_seen = command("select exists(select 1 from pg_stat_activity s where s.application_name='lrv-clock-staff' and s.wait_event_type='Lock' and exists(select 1 from pg_stat_activity a where a.application_name='lrv-clock-admin' and a.state='idle in transaction' and a.pid=any(pg_blocking_pids(s.pid))));") == 't'
            if lock_seen:
                break
            time.sleep(.05)
        assert lock_seen, 'PostgreSQL never observed staff blocked by the held admin transaction'
        receipt['concurrentLockObservation'] = {
            'staffWaitEventType': 'Lock', 'adminState': 'idle in transaction',
            'adminPidInPgBlockingPids': True, 'beforeAdminCommit': True,
            'elapsedSeconds': time.monotonic() - lock_started,
        }
        writer.stdin.write(b'commit;\n'); writer.stdin.close()
        assert writer.wait(timeout=10) == 0, writer.stderr.read()
        assert staff.wait(timeout=10) == 0, staff.stderr.read()
        invariant(1)
        command(f"update profiles set is_on_duty=false where id='{STAFF}';",actor=ADMIN,role='authenticated')
        assert command('select count(*) from read_on_duty_staff();',actor=ADMIN,role='authenticated') == '1'
        command('select id from clock_out();',actor=STAFF,role='authenticated'); invariant(0)
        receipt['checks'].append('concurrent admin-close/staff-clock-in serializes; delayed legacy duty write cannot change authoritative read')
        command('select id from clock_in();',actor=INACTIVE,role='authenticated',expected='Only active staff')
        command(f"update profiles set is_active=false where id='{STAFF}';",actor=STAFF,role='authenticated',expected='Only admins')
        assert int(command(f"select count(*) from audit_entries where actor='{ADMIN}';")) > 0
        for actor, role in [(STAFF,'authenticated'),(INACTIVE,'authenticated'),(None,'anon')]:
            command('select * from read_on_duty_staff();',actor=actor,role=role,expected='permission denied' if role=='anon' else 'Only active administrators')
        assert command('select count(*) from read_on_duty_staff();',actor=ADMIN,role='authenticated') == '0'
        receipt['checks'].append('inactive self-clock rejected; profile privilege and actor audit preserved')
        command(f"update profiles set is_on_duty=true where id='{STAFF}';",actor=ADMIN,role='authenticated')
        assert command('select count(*) from read_on_duty_staff();',actor=ADMIN,role='authenticated') == '0'
        entry = opened()
        command(f"update profiles set is_active=false where id='{STAFF}';",actor=ADMIN,role='authenticated')
        assert command('select count(*) from read_on_duty_staff();',actor=ADMIN,role='authenticated') == '0'
        command(f"update profiles set is_active=true where id='{STAFF}';",actor=ADMIN,role='authenticated')
        assert command('select id from read_on_duty_staff();',actor=ADMIN,role='authenticated') == STAFF
        receipt['checks'].append('both incorrect legacy flag directions ignored; inactive staff excluded; frozen profile guard unchanged')

        receipt['passed'] = True
    finally:
        for process in running:
            if process.poll() is None: process.kill(); process.wait(timeout=5)
        cleaned = subprocess.run(['docker','rm','-f',name],capture_output=True,text=True,timeout=30)
        receipt['ownedCleanup'] = cleaned.returncode == 0
        print(json.dumps(receipt,indent=2))
    if not receipt['ownedCleanup']:
        raise RuntimeError('Owned container cleanup failed')

if __name__ == '__main__':
    main()
