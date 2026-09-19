"""Compare private PostgreSQL and TypeScript quantity replay using synthetic, read-only inputs."""
import argparse
import json
from pathlib import Path
import subprocess
import tomllib

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local', action='store_true', required=True)
parser.add_argument('--project-config', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
config = args.project_config.resolve()
project = tomllib.loads(config.read_text())['project_id']
assert isinstance(project, str) and project and all(c.isalnum() or c in '_-' for c in project)
container = 'supabase_db_' + project
labels = json.loads(subprocess.check_output(['docker', 'inspect', container], timeout=30))[0]['Config']['Labels']
assert labels['com.supabase.cli.project'] == project
assert Path(labels['com.supabase.cli.workdir']).resolve() == config.parent.parent
vectors = json.loads(subprocess.check_output(['node', '--experimental-strip-types', 'tests/prescriptions/return-replay-vectors.ts'], cwd=root, timeout=30))
assert len(vectors) >= 70 and any(not v['expected']['accepted'] for v in vectors)
payload = json.dumps([{k: v[k] for k in ['name', 'originals', 'events']} for v in vectors])
quote = lambda text: "'" + text.replace("'", "''") + "'"
# Only a session-local function is created; no public schema or practice data is changed.
query = """begin; set local statement_timeout='60s';
create function pg_temp.try_return_replay(o jsonb,e jsonb) returns jsonb language plpgsql as $$
begin return jsonb_build_object('accepted',true,'result',public.native_return_quantity_replay(o,e));
exception when check_violation then return jsonb_build_object('accepted',false,'result',null);end $$;
select jsonb_agg(jsonb_build_object('name',v->>'name','actual',pg_temp.try_return_replay(v->'originals',v->'events')) order by n)
from jsonb_array_elements(""" + quote(payload) + """::jsonb) with ordinality as fixture(v,n);
rollback;"""
command = ['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
result = subprocess.run(command, input=query, capture_output=True, text=True, timeout=90, check=True)
actual = json.loads(result.stdout.strip())
assert len(actual) == len(vectors)
for expected, observed in zip(vectors, actual):
    assert observed['name'] == expected['name']
    assert observed['actual'] == expected['expected'], 'SQL/TypeScript quantity mismatch: ' + expected['name']
print(json.dumps({'suite': 'native-return-replay-parity', 'cases': len(vectors), 'accepted': sum(v['expected']['accepted'] for v in vectors), 'rejected': sum(not v['expected']['accepted'] for v in vectors), 'provider_requests': 0, 'synthetic_only': True, 'persistent_writes': False, 'project_id': project}))
