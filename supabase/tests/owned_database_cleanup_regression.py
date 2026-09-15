"""Real local regression for restricted-role cleanup; no application data or providers."""
import argparse
import contextlib
import io
import json
import subprocess
import time
import uuid
from owned_database_cleanup import cleanup_owned_database

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project-config')
args = parser.parse_args()
container = 'supabase_db_livingroom-vet-foundation'
if args.project_config:
    import tomllib
    with open(args.project_config, 'rb') as config:
        container = 'supabase_db_' + tomllib.load(config)['project_id']
command = ['docker','exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-t','-A','-v','ON_ERROR_STOP=1']

def sql(query):
    result = subprocess.run(command,input=query,capture_output=True,text=True)
    if result.returncode:raise AssertionError(result.stderr)
    return result.stdout.strip()

checks = 0

def check(value, message):
    global checks
    assert value, message
    checks += 1

check(sql("select rolsuper from pg_roles where rolname='postgres';")=='f','Exercise restricted postgres role')
owned = []
connections = []
try:
    for _ in range(2):
        database='lrv_vaccination_review_'+uuid.uuid4().hex
        marker='owned-vaccination-review-'+uuid.uuid4().hex
        sql(f'create database "{database}";')
        sql(f"comment on database \"{database}\" is '{marker}';")
        owned.append((database,marker))
        connection_command=command.copy();connection_command[connection_command.index('-U')+1]='supabase_admin';connection_command[connection_command.index('-d')+1]=database
        process=subprocess.Popen(connection_command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        process.stdin.write("select 1;\n");process.stdin.flush();connections.append(process)
        deadline=time.monotonic()+8
        while time.monotonic()<deadline:
            if sql(f"select count(*) from pg_stat_activity where datname='{database}' and usename='supabase_admin' and state='idle';")=='1':break
            time.sleep(.03)
        else:raise AssertionError('Superuser test connection did not become observable')
    target, marker=owned[0];sentinel,sentinel_marker=owned[1]
    old=subprocess.run(command,input=f"select pg_terminate_backend(pid) from pg_stat_activity where datname='{target}' and pid<>pg_backend_pid();",capture_output=True,text=True)
    check(old.returncode!=0 and 'Only roles with the SUPERUSER attribute' in old.stderr,'Reproduce exact CI cleanup privilege failure')
    wrong='owned-vaccination-review-'+uuid.uuid4().hex
    try:cleanup_owned_database(command,target,wrong)
    except AssertionError as error:check('identity mismatch' in str(error),'Wrong ownership marker fails closed')
    else:raise AssertionError('Wrong marker accepted')
    check(connections[0].poll() is None,'Refused cleanup does not terminate target connection')
    primary=ValueError('synthetic original race failure')
    try:
        try:raise primary
        finally:
            with contextlib.redirect_stderr(io.StringIO()) as diagnostics:
                cleanup_owned_database(command,target,wrong)
    except ValueError as error:
        check(error is primary,'Primary test exception survives a secondary cleanup failure')
        check('Additional owned database cleanup failure' in diagnostics.getvalue(),'Cleanup failure remains visible in diagnostics')
        check(any('Additional owned database cleanup failure' in note for note in getattr(error,'__notes__',[])),'Cleanup diagnostics retained on original failure')
    cleanup_owned_database(command,target,marker,check=check)
    owned.pop(0)
    connections[0].stdin.close()
    connections[0].wait(timeout=10)
    check(sql(f"select count(*) from pg_database where datname='{target}';")=='0','Superuser target backend and owned database cleaned')
    check(connections[1].poll() is None and sql(f"select count(*) from pg_stat_activity where datname='{sentinel}' and usename='supabase_admin';")=='1','Connection in other database untouched')
    for database in ('postgres','lrv_vaccination_review_not_random'):
        try:cleanup_owned_database(command,database,marker)
        except AssertionError as error:check('Invalid disposable' in str(error),'Malformed or non-owned database rejected before access')
        else:raise AssertionError('Unsafe database accepted')
finally:
    for database,marker in owned:
        cleanup_owned_database(command,database,marker)
    for process in connections:
        if process.stdin and not process.stdin.closed:process.stdin.close()
        process.wait(timeout=10)
print(f'Owned database cleanup regression: {checks} checks passed; exact CI failure reproduced, all owned resources removed.')
