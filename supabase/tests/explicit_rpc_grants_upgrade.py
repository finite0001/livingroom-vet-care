"""Reproduce direct hosted ACL drift, apply exact migration in rollback, verify scope."""
import argparse
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project-config', type=Path)
args = parser.parse_args()
project_id = 'livingroom-vet-foundation'
if args.project_config:
    import tomllib
    with args.project_config.open('rb') as config:
        project_id = tomllib.load(config)['project_id']
container = 'supabase_db_' + project_id
inspection = subprocess.run(['docker', 'inspect', container], capture_output=True, text=True, check=True)
labels = json.loads(inspection.stdout)[0]['Config']['Labels']
assert labels['com.supabase.cli.project'] == project_id, 'Refuse a different local project'
command = ['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']

def sql(query):
    result = subprocess.run(command, input=query, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()

signatures = [
    'public.admin_set_staff_active(uuid,boolean)',
    'public.admin_update_staff_role(uuid,public.user_role)',
    'public.clock_in()', 'public.clock_out()', 'public.get_consent_submission(text)',
    'public.review_ezyvet_snapshot(uuid,text,uuid,uuid,text)',
]
quoted = ','.join("'" + s + "'" for s in signatures)
acl_snapshot = f"""select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'acl',p.proacl) order by p.oid::regprocedure::text)
from pg_proc p where p.oid in(select s::regprocedure from unnest(array[{quoted}]) s);"""
before_acl = json.loads(sql(acl_snapshot))
migration = Path(__file__).resolve().parents[1] / 'migrations/20260913460000_explicit_staff_rpc_grants.sql'
prelude = f"""begin;set local search_path=public,extensions;
create temp table expected_rpc(signature text,anonymous boolean);
insert into expected_rpc select s,s='public.get_consent_submission(text)' from unnest(array[{quoted}]) s;
create temp table before_metadata as select p.oid,pg_get_functiondef(p.oid) definition,p.proowner,p.prosecdef,p.proconfig
from pg_proc p join expected_rpc e on p.oid=e.signature::regprocedure;
create temp table before_defaults as select coalesce(jsonb_agg(to_jsonb(d) order by oid),'[]') data from pg_default_acl d;
grant execute on function public.admin_set_staff_active(uuid,boolean),public.admin_update_staff_role(uuid,public.user_role) to anon,service_role;
grant execute on function public.clock_in(),public.clock_out(),public.get_consent_submission(text),public.review_ezyvet_snapshot(uuid,text,uuid,uuid,text) to service_role;
do $$begin
 if not (select bool_and(has_function_privilege('service_role',signature,'execute')) from expected_rpc)
 or not has_function_privilege('anon','public.admin_set_staff_active(uuid,boolean)','execute')
 or not has_function_privilege('anon','public.admin_update_staff_role(uuid,public.user_role)','execute') then raise exception 'Observed direct grants not reproduced';end if;
end $$;
"""
verification = """
do $$declare target record;begin
 for target in select * from expected_rpc loop
  if has_function_privilege('anon',target.signature,'execute') is distinct from target.anonymous
  or not has_function_privilege('authenticated',target.signature,'execute')
  or has_function_privilege('service_role',target.signature,'execute')
  or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where p.oid=target.signature::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE')
  then raise exception 'Incorrect exact grant matrix for %',target.signature;end if;
 end loop;
 if exists(select 1 from before_metadata b full join pg_proc p on p.oid=b.oid where b.oid is not null and
  (p.oid is null or row(b.definition,b.proowner,b.prosecdef,b.proconfig) is distinct from row(pg_get_functiondef(p.oid),p.proowner,p.prosecdef,p.proconfig)))
 then raise exception 'Function definition, owner, security or configuration changed';end if;
 if (select data from before_defaults) is distinct from(select coalesce(jsonb_agg(to_jsonb(d) order by oid),'[]') from pg_default_acl d)
 then raise exception 'Global default ACL policy changed';end if;
end $$;
rollback;
"""
sql(prelude + migration.read_text() + verification)
assert json.loads(sql(acl_snapshot)) == before_acl, 'Rollback must restore original ACLs'
print('Explicit RPC grant upgrade: 28 checks passed (observed drift, 24 role grants, metadata, defaults, rollback); no provider requests.')
