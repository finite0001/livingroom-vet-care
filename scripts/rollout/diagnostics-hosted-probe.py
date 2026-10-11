#!/usr/bin/env python3
"""Verify the approved diagnostics migration with rollback-only hosted fixtures."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('project', choices=['kothoqicubowyhwfsrte', 'mgadheotkdnrsatfivjy'])
parser.add_argument('--prepare-only', action='store_true')
args = parser.parse_args()

def query(sql=None, file=None):
    command = ['supabase', 'db', 'query', '--linked', '--project-ref', args.project,
               '--output-format', 'json']
    command += ['--file', str(file)] if file else [sql]
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, check=True)
    data = json.loads(result.stdout)
    return data if isinstance(data, list) else data['rows']

migration = ROOT/'supabase/migrations/20261011181722_manual_diagnostic_panels.sql'
assert hashlib.sha256(migration.read_bytes()).hexdigest() == 'ec1682c941fc632fda33a963f92295382c7bc0447edeb1ede277cb1849a8f789'
source = (ROOT/'supabase/tests/manual_diagnostics.test.sql').read_text()
assert hashlib.sha256(source.encode()).hexdigest() == 'f75c2495053019cc5a73bcfddcd150ff2150df7804d512574981d02fe5fa6687'
mapping = {old: str(uuid.uuid4()) for old in set(re.findall(r'b3100000-0000-4000-8000-[0-9]{12}', source))}
actors = [mapping['b3100000-0000-4000-8000-000000000'+str(n)] for n in [800, 801, 802]]
source = source.replace("id::text like 'b3100000-%'", 'id in ('+','.join("'"+actor+"'" for actor in actors)+')')
for old, new in mapping.items():
    source = source.replace(old, new)
nonce = uuid.uuid4().hex
source = re.sub(r'(synthetic-[a-z-]+)@example\.test', lambda m: m.group(1)+'-'+nonce+'@example.test', source)
assert 'b3100000' not in source and 'like ' not in source
source = source.replace('select no_plan();', """select no_plan();
create function pg_temp.prove(result text) returns void language plpgsql as $$
begin
 if result not like 'ok %' then raise exception 'Hosted diagnostic assertion failed: %',result;end if;
 perform set_config('lrv.diagnostic_checks',(coalesce(nullif(current_setting('lrv.diagnostic_checks',true),''),'0')::integer+1)::text,true);
end $$;""")
source, count = re.subn(r'^select (is|isnt|ok|throws_ok|lives_ok)\((.*?)\);',
                      lambda m: 'select pg_temp.prove('+m.group(1)+'('+m.group(2)+'));',
                      source, flags=re.M | re.S)
assert count == 39, count
source, finish = re.subn(r'select \* from finish\(\);\s*rollback;', """
do $$begin
 if current_setting('lrv.diagnostic_checks')::integer<>39 then raise exception 'Incomplete hosted proof';end if;
end $$;
select jsonb_build_object('checks',39,'synthetic_transaction',true,'provider_requests',0) as proof;
rollback;""", source)
assert finish == 1 and source.startswith('begin;') and source.rstrip().endswith('rollback;')
expected = dict(re.findall(r'create function public\.(\w+)\(.*?\) returns.*?as \$\$(.*?)\$\$;', migration.read_text(), re.S))
assert len(expected) == 13, len(expected)
if args.prepare_only:
    print('Prepared39 pinned rollback assertions; exact actor predicates; 13 canonical function bodies; no hosted operations')
    raise SystemExit(0)

tables = ['auth.users', 'profiles', 'user_roles', 'clients', 'pets', 'clinical_encounters',
          'patient_documents', 'storage.objects', 'patient_lab_orders', 'diagnostic_panels',
          'diagnostic_panel_versions', 'diagnostic_panel_actions', 'diagnostic_panel_revisions',
          'record_requests', 'record_request_actions', 'record_request_revisions',
          'record_request_receipts', 'record_request_manifests', 'record_request_packages',
          'record_request_release_links', 'record_request_recipient_authorizations',
          'record_request_authorization_revocations', 'record_request_disclosure_policy',
          'record_releases', 'release_email_requests', 'record_release_policy',
          'communication_outbox', 'communication_attempts', 'audit_logs',
          'payment_provider_profiles', 'reminder_automation_policies']
snapshot_sql = 'select jsonb_build_object('+','.join(
    "'%s',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),''))) from %s t)" % (t, t)
    for t in tables)+",'pgtap',(select extversion from pg_extension where extname='pgtap')) as snapshot;"
inventory = query("select count(*) as count,max(version) as latest from supabase_migrations.schema_migrations;")[0]
assert inventory == {'count':174, 'latest':'20261011181722'}
functions = query("select p.proname,p.prosrc,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ("+','.join("'"+name+"'" for name in expected)+");")
assert len(functions)==13
for function in functions:
    assert function['prosrc'] == expected[function['proname']], function['proname']+' body differs'
    assert function['proconfig'] == ['search_path=public']
acl = query("""select c.relname,c.relrowsecurity,
 exists(select 1 from unnest(array['anon','authenticated','service_role']) r where has_table_privilege(r,c.oid,'SELECT,INSERT,UPDATE,DELETE')) as exposed
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in ('diagnostic_panels','diagnostic_panel_versions','diagnostic_panel_actions','diagnostic_panel_revisions');""")
assert len(acl)==4 and all(t['relrowsecurity'] and not t['exposed'] for t in acl)
before = query(snapshot_sql)[0]['snapshot']
assert before['record_release_policy']['count']==before['record_request_disclosure_policy']['count']==0
with tempfile.NamedTemporaryFile(mode='w',suffix='.sql',prefix='lrv-diagnostic-hosted-',delete=False) as file:
    file.write(source)
    path = Path(file.name)
try:
    result = query(file=path)
finally:
    path.unlink(missing_ok=True)
assert query(snapshot_sql)[0]['snapshot'] == before, 'Rollback changed baseline; inspect without overwriting practice data'
print(json.dumps({'project':args.project,'migrations':inventory,'checks':39,'canonical_function_bodies':13,
                  'private_rls_ledgers':4,'provider_requests':0,'all_synthetic_writes_rolled_back':True,
                  'baseline_unchanged':True,'proof':result}))
