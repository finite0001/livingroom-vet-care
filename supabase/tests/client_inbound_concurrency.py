"""Prove an unknown SMS retry cannot duplicate a message after household creation."""
import argparse
import json
from pathlib import Path
import subprocess
import tomllib
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local', action='store_true')
parser.add_argument('--project-config', required=True, type=Path)
args = parser.parse_args()
if not args.run_synthetic_local:
    parser.error('Explicit --run-synthetic-local required')
config = args.project_config.resolve()
project = tomllib.loads(config.read_text())['project_id']
container = 'supabase_db_' + project
labels = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]['Config']['Labels']
assert labels['com.supabase.cli.project'] == project
assert Path(labels['com.supabase.cli.workdir']).resolve() == config.parent.parent
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-q', '-At', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']


def sql(query):
    result = subprocess.run(command, input=query, text=True, capture_output=True, timeout=25)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


phone = '+1303555' + str(1000 + int(uuid.uuid4().hex[:8], 16) % 9000)
message = 'client-integrity-race-' + uuid.uuid4().hex
client = str(uuid.uuid4())
assert sql(f"select count(*) from public.clients where public.communication_recipient('SMS',primary_phone)='{phone}';") == '0', 'Refuse a nonempty synthetic race phone'
first = None
try:
    first = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write(f'''begin;
set local statement_timeout='20s';
set local role service_role;
select set_config('request.jwt.claims','{{"role":"service_role"}}',true);
select * from public.record_inbound_sms('{phone}','+13035550199','Synthetic concurrency message','{message}',null,now());
\\echo CONTACT_RACE_READY
select pg_sleep(3);
commit;
''')
    first.stdin.close()
    while True:
        line = first.stdout.readline()
        if 'CONTACT_RACE_READY' in line:
            break
        if not line:
            raise RuntimeError('First receipt did not reach the transaction hold: ' + first.stderr.read())
    # This complete household commits while the first, unmatched receipt remains uncommitted.
    sql(f"insert into public.clients(id,first_name,last_name,full_name,primary_phone,primary_email) values('{client}','Synthetic','Race','Synthetic Race','{phone}','race@example.test');")
    replay = sql(f'''begin;
set local statement_timeout='20s';
set local role service_role;
select set_config('request.jwt.claims','{{"role":"service_role"}}',true);
select consent_action from public.record_inbound_sms('{phone}','+13035550199','Synthetic concurrency message','{message}',null,now());
commit;''')
    assert replay.splitlines()[-1] == 'DUPLICATE'
    assert first.wait(timeout=25) == 0, first.stderr.read()
    assert sql(f"select count(*) from communication_inbound where provider='twilio' and resource_id='{message}' and client_id is null;") == '1'
    assert sql(f"select count(*) from messages where provider='twilio' and provider_message_id='{message}';") == '0'
    print('Concurrent household creation / webhook retry passed: one retained review item, no duplicate message.')
finally:
    if first is not None and first.poll() is None:
        first.kill()
        first.wait(timeout=10)
    # Retain immutable provider/review evidence until the disposable runtime is removed.
    sql(f"delete from public.clients where id='{client}';")
