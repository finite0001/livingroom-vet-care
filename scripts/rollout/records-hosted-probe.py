#!/usr/bin/env python3
"""Historical PR #237 proof for the October 11, 173-migration baseline.

Preserved with its dated receipt, not a current hosted release check. It accesses
hosted databases and assumes the original empty request/disclosure inventories;
review current schema/session prerequisites and authorization before any rerun.
Every original synthetic fixture is intended to roll back.
"""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import tempfile
import uuid

root = pathlib.Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('project', choices=['kothoqicubowyhwfsrte', 'mgadheotkdnrsatfivjy'])
args = parser.parse_args()

def query(sql=None, file=None):
    command = ['supabase', 'db', 'query', '--linked', '--project-ref', args.project,
               '--output-format', 'json']
    command += ['--file', str(file)] if file else [sql]
    result = subprocess.run(command, cwd=root, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr + result.stdout)
    data = json.loads(result.stdout)
    return data if isinstance(data, list) else data['rows']

tables = ['auth.users', 'profiles', 'user_roles', 'clients', 'pets', 'patient_weights', 'clinical_encounters', 'catalog_products', 'inventory_lots', 'inventory_movements', 'billing_invoices', 'patient_service_events', 'patient_treatments', 'billing_invoice_items', 'patient_lab_orders', 'patient_documents', 'storage.objects', 'tickets', 'conversations', 'communication_outbox', 'communication_attempts', 'record_releases', 'release_email_requests', 'record_release_policy', 'record_requests', 'record_request_actions', 'record_request_revisions', 'record_request_receipts', 'record_request_manifests', 'record_request_packages', 'record_request_release_links', 'record_request_disclosure_policy', 'record_request_recipient_authorizations', 'record_request_authorization_revocations', 'audit_logs', 'payment_provider_profiles', 'reminder_automation_policies']
snapshot_sql = 'select jsonb_build_object(' + ','.join(
    "'%s',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),''))) from %s t)" % (table, table)
    for table in tables) + ", 'pgtap',(select extversion from pg_extension where extname='pgtap')) as snapshot;"
before = query(snapshot_sql)[0]['snapshot']
# Exact fixture assumes an empty request queue and an uncommissioned disclosure policy.
guard = query("select (select count(*) from record_requests) as requests, (select count(*) from record_request_disclosure_policy) as disclosure;")[0]
assert guard == {'requests': 0, 'disclosure': 0}, 'Hosted fixture isolation changed; do not overwrite practice work'
fixtures = [('record_requests.test.sql', '5b311af052654f244d7f2aac5e9750d41e3a71e50dd11151e92590e123411675', 52)]
proofs = []
for name, digest, count in fixtures:
    source = (root / 'supabase/tests' / name).read_text()
    assert hashlib.sha256(source.encode()).hexdigest() == digest, 'Reviewed fixture changed'
    # Distinct synthetic identities exist only inside the rolled-back transaction, never as real reviewers.
    for old in set(re.findall(r'8c[1-9]00000-0000-4000-8000-00000000000[1-7]', source)):
        source = source.replace(old, str(uuid.uuid4()))
    source = source.replace('select no_plan();', """select no_plan();
create function pg_temp.prove(result text) returns void language plpgsql as $$
begin
 if result not like 'ok %' then raise exception 'Hosted assertion failed: %',result;end if;
 perform set_config('lrv.records_checks',(coalesce(nullif(current_setting('lrv.records_checks',true),''),'0')::integer+1)::text,true);
end $$;""")
    source, assertions = re.subn(r'^select (is|isnt|ok|throws_ok|lives_ok)\((.*?)\);',
                                lambda m: 'select pg_temp.prove(' + m.group(1) + '(' + m.group(2) + '));',
                                source, flags=re.M | re.S)
    assert assertions == count, f'Assertion inventory changed for {name}: {assertions}'
    source, finish = re.subn(r'select \* from finish\(\);\s*rollback;', f"""
reset role;
do $$begin
 if current_setting('lrv.records_checks')::integer<>{count} then raise exception 'Incomplete hosted assertion count';end if;
end $$;
select jsonb_build_object('checks',{count},'synthetic_transaction',true,'provider_requests',0) as proof;
rollback;""", source)
    assert finish == 1
    with tempfile.NamedTemporaryFile(mode='w', suffix='.sql', prefix='lrv-records-probe-', delete=False) as file:
        file.write(source)
        path = pathlib.Path(file.name)
    try:
        proofs.append({'fixture': name, 'result': query(file=path)})
    finally:
        path.unlink(missing_ok=True)
    assert query(snapshot_sql)[0]['snapshot'] == before, f'Rollback changed baseline after {name}'
print(json.dumps({'project': args.project, 'checks': 52, 'provider_requests': 0,
                  'all_synthetic_writes_rolled_back': True, 'baseline_unchanged': True, 'proofs': proofs}))
