"""Exact source REST defaults and absence of schema/role hooks."""
import json
from pathlib import Path
import urllib.parse

EXPECTED_REST_IMAGE='public.ecr.aws/supabase/postgrest:v16.3'
# The pinned CLI falls back to its official GHCR mirror when ECR throttles.
# These are exact registry-qualified aliases of the same pinned release.
REST_IMAGES=frozenset((EXPECTED_REST_IMAGE,'ghcr.io/supabase/postgrest:v16.3'))

EXPECTED_ENV={'PGRST_DB_SCHEMAS':'public,graphql_public','PGRST_DB_EXTRA_SEARCH_PATH':'public,extensions','PGRST_DB_ANON_ROLE':'anon',
 'PGRST_DB_CONFIG':None,'PGRST_DB_PRE_REQUEST':None,'PGRST_DB_PRE_CONFIG':None,'PGRST_DB_ROOT_SPEC':None}

FORBIDDEN_SETTINGS_SQL="""select coalesce(jsonb_agg(jsonb_build_object('role',r.rolname,'database',d.datname,'setting',setting)order by r.rolname,d.datname,setting),'[]')
from pg_db_role_setting s left join pg_roles r on r.oid=s.setrole left join pg_database d on d.oid=s.setdatabase
cross join lateral unnest(s.setconfig)as config(setting)
where(s.setdatabase=0 or d.datname='postgres')and(
 setting like 'pgrst.%'or((r.rolname in('authenticator','anon','authenticated','service_role')or s.setrole=0)
 and split_part(setting,'=',1)in('search_path','role','session_authorization')));"""

RECOVERY_OVERRIDE=[{'role':'authenticator','database':None,'setting':'pgrst.db_pre_request=public.narcotics_recovery_admission_v1'}]

def effective_defaults(runtime, *, recovery=False):
 if type(recovery)is not bool:raise ValueError('Fixed REST source profile required')
 runtime.verify()
 candidates=[key for key,value in runtime.owned_services.items()if value['name']=='/supabase_rest_'+runtime.identity]
 if len(candidates)!=1:raise ValueError('Exactly one captured owned REST service required')
 result=runtime.command(['docker','inspect',candidates[0]])
 rows=json.loads(result.stdout)
 if len(rows)!=1:raise ValueError('Owned REST inspection differs')
 row=rows[0]
 if row['Id']!=candidates[0]:raise ValueError('Captured owned REST container changed')
 if row['Config']['Image']not in REST_IMAGES:raise ValueError('Source-declared REST image differs: actual '+str(row['Config']['Image'])[:160])
 labels=row['Config']['Labels']
 if labels.get('com.supabase.cli.project')!=runtime.identity or Path(labels.get('com.supabase.cli.workdir','')).resolve()!=runtime.project.resolve():raise ValueError('Owned REST labels differ')
 env={}
 for item in row['Config']['Env']:
  name,separator,value=item.partition('=')
  if not separator or name in env:raise ValueError('Exact REST environment required')
  env[name]=value
 observed={key:env.get(key)for key in EXPECTED_ENV}
 if observed!=EXPECTED_ENV:raise ValueError('Source-declared REST schema/hook/config defaults differ')
 parsed=urllib.parse.urlsplit(env['PGRST_DB_URI'])
 if parsed.scheme!='postgresql'or parsed.username!='authenticator'or parsed.hostname!='supabase_db_'+runtime.identity or parsed.port!=5432 or parsed.path!='/postgres'or parsed.query or parsed.fragment or not parsed.password:raise ValueError('Source-declared internal REST DB binding differs')
 forbidden=json.loads(runtime.query(FORBIDDEN_SETTINGS_SQL))
 if forbidden!=(RECOVERY_OVERRIDE if recovery else []):raise ValueError('Unexpected effective schema/hook/role/database override')
 return {'rest_image':row['Config']['Image'],'rest_defaults':observed,'db_role':'authenticator','db_host':parsed.hostname,'db_port':parsed.port,'db_name':'postgres',
  'pgrst_db_config_builtin_default':True,'forbidden_role_database_overrides':forbidden,'full_role_configuration_certification':False,'global_closure_certification':False}
