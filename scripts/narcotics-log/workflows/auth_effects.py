"""Source-derived GoTrue2.197 fixed two-user, two-to-four password-grant accounting.

No observed row/count is authority; exact source routes allow six new-row families.
All preexisting rows remain under the unchanged full JSONB-text hash comparison.
"""
import json,uuid,re
from datetime import datetime,timezone
from pathlib import Path
TABLES=('users','identities','sessions','refresh_tokens','mfa_amr_claims','audit_log_entries')
IMAGE='public.ecr.aws/supabase/gotrue:v2.197.0'
EXPECTED_ENV={'GOTRUE_JWT_AUD':'authenticated','GOTRUE_JWT_DEFAULT_GROUP_NAME':'authenticated','GOTRUE_EXTERNAL_EMAIL_ENABLED':'true',
 'GOTRUE_AUDIT_LOG_DISABLE_POSTGRES':None,'GOTRUE_SECURITY_REFRESH_TOKEN_ALGORITHM_VERSION':None,'GOTRUE_DB_NAMESPACE':None}
INITIAL_SQL="do $auth_bound$begin "+''.join("if(select count(*)from auth."+t+")>10000 then raise exception 'Auth observation cap exceeded';end if;"for t in TABLES)+"end$auth_bound$;\nselect jsonb_build_object("+','.join("'"+t+"',(select coalesce(jsonb_agg(id::text order by id::text collate \"C\"),'[]')from auth."+t+')'for t in TABLES)+');'

def literal(value):return "'"+str(value).replace("'","''")+"'"
def jsql(value):return literal(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False))+'::jsonb'
def uuid_value(value):
 if type(value)is not str or str(uuid.UUID(value))!=value or int(uuid.UUID(value))==0:raise ValueError('Canonical Auth fixture UUID required')
 return value

def effective_defaults(runtime):
 runtime.verify();candidates=[key for key,value in runtime.owned_services.items()if value['name']=='/supabase_auth_'+runtime.identity]
 if len(candidates)!=1:raise ValueError('Exactly one owned GoTrue service required')
 rows=json.loads(runtime.command(['docker','inspect',candidates[0]]).stdout)
 if len(rows)!=1:raise ValueError('One owned GoTrue inspection required')
 row=rows[0];labels=row['Config']['Labels']
 if row['Id']!=candidates[0]or row['Config']['Image']!=IMAGE or labels.get('com.supabase.cli.project')!=runtime.identity or Path(labels.get('com.supabase.cli.workdir','')).resolve()!=runtime.project.resolve():raise ValueError('Source-declared GoTrue image/project differs')
 env={}
 for item in row['Config']['Env']:
  key,sep,value=item.partition('=')
  if not sep or key in env:raise ValueError('Exact GoTrue environment required')
  env[key]=value
 if {key:env.get(key)for key in EXPECTED_ENV}!=EXPECTED_ENV or any(key.startswith('GOTRUE_HOOK_')for key in env):raise ValueError('Source-derived Auth write-path defaults differ')
 return dict(image=IMAGE,defaults=EXPECTED_ENV,hooks_absent=True,source_commit='4eee58f296d9698a1c2c0ae14d7a0b379c7622d3',global_closure_security_certification=False)

def read_result(text):
 lines=[line for line in text.splitlines()if line.strip()]
 if len(lines)!=1:raise ValueError('Single Auth observation required')
 return json.loads(lines[0])

def admitted_initial(value):
 if type(value)is not dict or set(value)!=set(TABLES):raise ValueError('Exact six-table Auth inventory required')
 for table,items in value.items():
  if type(items)is not list or len(items)>10000 or any(type(item)is not str for item in items)or items!=sorted(set(items)):raise ValueError('Bounded sorted Auth ID inventory required')
  for item in items:
   if table=='refresh_tokens':
    if not item.isascii()or not item.isdecimal()or str(int(item))!=item or not 1<=int(item)<=9223372036854775807:raise ValueError('Canonical refresh-token identity required')
   else:uuid_value(item)
 return value

def initial(runtime):return admitted_initial(read_result(runtime.query(INITIAL_SQL)))

def user_values(users):
 if type(users)is not list or len(users)!=2:raise ValueError('Two real fixed Auth users required')
 values=[]
 for index,user in enumerate(users):
  uuid_value(user['id']);uuid_value(user['session_id'])
  name='LRV synthetic original'if index==0 else 'LRV synthetic reviewer'
  if user['name']!=name or type(user['email'])is not str or not user['email'].startswith('lrv-closed-')or not user['email'].endswith('-'+str(index)+'@example.invalid'):raise ValueError('Fixed synthetic Auth identity differs')
  claims=user['auth_amr']
  if user['auth_aal']!='aal1'or type(claims)is not list or len(claims)!=1 or type(claims[0])is not dict or set(claims[0])!={'method','timestamp'}or claims[0]['method']!='password'or type(claims[0]['timestamp'])is not int or not 1767225600<=claims[0]['timestamp']<4133980800:raise ValueError('Exact genuine password AMR projection required')
  values.append(dict(user_id=user['id'],session_id=user['session_id'],email=user['email'],name=name,amr_timestamp=claims[0]['timestamp']))
 if len({item['user_id']for item in values})!=2 or len({item['session_id']for item in values})!=2:raise ValueError('Distinct real Auth identities required')
 return values

def login_timestamp(raw):
 """Pinned pgtype/pgx encoders TRUNCATE nanos to micros, never PG round."""
 if type(raw)is not str or len(raw)>64:raise ValueError('Source-declared genuine login timestamp required')
 match=re.fullmatch(r'([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\.([0-9]{1,9}))?(Z|[+-][0-9]{2}:[0-9]{2})',raw)
 if match is None or match[3]=='-00:00':raise ValueError('Source-declared genuine login timestamp required')
 micros=((match[2]or'')+'000000')[:6]
 value=datetime.fromisoformat(match[1]+'.'+micros+('+00:00'if match[3]=='Z'else match[3])).astimezone(timezone.utc)
 if not 2026<=value.year<2101:raise ValueError('Source-declared genuine login timestamp required')
 return value.strftime('%Y-%m-%dT%H:%M:%S.%fZ')

def validation_sql(before,users,extra_sessions):
 admitted_initial(before);values=user_values(users)
 if type(extra_sessions)is not list or len(extra_sessions)>2:raise ValueError('Fixed finite additional password grants required')
 extras=[]
 for index,actor in enumerate(extra_sessions):
  # Fixed profiles may re-login B, then SDK-login A. No caller-selected schedule.
  selected=1 if index==0 else 0
  extra=user_values([users[0],actor])[1]if selected==1 else user_values([actor,users[1]])[0]
  if any(extra[field]!=values[selected][field]for field in('user_id','email','name')):raise ValueError('Additional session principal differs from fixed schedule')
  if extra['session_id']in{v['session_id']for v in values+extras}:raise ValueError('Every actual password grant needs a new distinct session')
  extras.append(extra)
 for index,user in enumerate(users):
  latest=next((actor for actor in reversed(extra_sessions)if actor['id']==user['id']),user)
  values[index]['latest_login']=login_timestamp(latest['auth_last_sign_in_at'])
 sessions=values+extras
 if any(v['user_id']in before['users']or v['session_id']in before['sessions']for v in sessions):raise ValueError('New Auth identities cannot adopt preexisting rows')
 ctes=['expected_users as(select *from jsonb_to_recordset('+jsql(values)+')as x(user_id uuid,session_id uuid,email text,name text,amr_timestamp bigint,latest_login timestamptz))',
  'expected_sessions as(select *from jsonb_to_recordset('+jsql(sessions)+')as x(user_id uuid,session_id uuid,email text,name text,amr_timestamp bigint))']
 for table in TABLES:
  array='array['+','.join(literal(value)for value in before[table])+']::text[]'
  ctes.append('new_'+table+' as(select *from auth.'+table+' where not(id::text=any('+array+')))')
 ctes.extend([
 "valid_users as(select u.id from new_users u join expected_users e on u.id=e.user_id where u.email=e.email and u.role='authenticated'and u.aud='authenticated'and u.email_confirmed_at is not null and u.last_sign_in_at is not null and u.last_sign_in_at=e.latest_login and not u.is_sso_user and not u.is_anonymous and coalesce(u.phone,'')=''and u.raw_app_meta_data=jsonb_build_object('provider','email','providers',jsonb_build_array('email'))and u.raw_user_meta_data=jsonb_build_object('full_name',e.name,'email_verified',true))",
 "valid_identities as(select i.id from new_identities i join expected_users e on i.user_id=e.user_id where (select count(*)from new_identities d where d.user_id=e.user_id)=1 and i.provider='email'and i.provider_id=e.user_id::text and i.email=e.email and i.identity_data=jsonb_build_object('sub',e.user_id,'email',e.email,'email_verified',false,'phone_verified',false))",
 "valid_sessions as(select s.id from new_sessions s join expected_sessions e on s.id=e.session_id and s.user_id=e.user_id where s.aal='aal1'and s.factor_id is null and s.oauth_client_id is null and s.not_after is null and s.scopes is null)",
 "valid_refresh_tokens as(select r.id from new_refresh_tokens r join expected_sessions e on r.session_id=e.session_id and r.user_id::uuid=e.user_id where (select count(*)from new_refresh_tokens d where d.session_id=e.session_id)=1 and not r.revoked and coalesce(r.parent,'')=''and r.token is not null and length(r.token)>0)",
 "valid_mfa_amr_claims as(select a.id from new_mfa_amr_claims a join expected_sessions e on a.session_id=e.session_id join valid_sessions s on s.id=a.session_id where a.authentication_method='password'and a.created_at=a.updated_at and isfinite(a.created_at)and floor(extract(epoch from a.updated_at))::bigint=e.amr_timestamp and a.id<>'00000000-0000-0000-0000-000000000000'::uuid and (to_jsonb(a)-array['id','session_id','created_at','updated_at','authentication_method'])='{}'::jsonb)",
 "expected_audit as(select jsonb_build_object('actor_id','00000000-0000-0000-0000-000000000000','actor_via_sso',false,'actor_username','service_role','action','user_signedup','log_type','team','traits',jsonb_build_object('user_id',e.user_id,'user_email',e.email,'user_phone','','provider','email'))as payload from expected_users e union all select jsonb_build_object('actor_id',e.user_id,'actor_via_sso',false,'actor_username',e.email,'actor_name',e.name,'action','login','log_type','account','traits',jsonb_build_object('provider','email'))from expected_sessions e)",
 "expected_audit_counts as(select payload,count(*)as expected_count from expected_audit group by payload)",
 "valid_audit_log_entries as(select a.id from new_audit_log_entries a join expected_audit_counts e on a.payload::jsonb=e.payload where (select count(*)from new_audit_log_entries d where d.payload::jsonb=e.payload)=e.expected_count and a.ip_address=''and a.created_at is not null and isfinite(a.created_at)and a.id<>'00000000-0000-0000-0000-000000000000'::uuid)"])
 projections=[]
 for table in TABLES:
  projections.extend([literal(table),"jsonb_build_object('actual',(select count(*)from new_"+table+"),'valid',(select count(*)from valid_"+table+"))"])
 return 'with '+','.join(ctes)+' select jsonb_build_object('+','.join(projections)+');'

def validate(runtime,before,users,extra_sessions):
 value=read_result(runtime.query(validation_sql(before,users,extra_sessions)))
 counts=dict(users=2,identities=2,sessions=2+len(extra_sessions),refresh_tokens=2+len(extra_sessions),mfa_amr_claims=2+len(extra_sessions),audit_log_entries=4+len(extra_sessions))
 if type(value)is not dict or set(value)!=set(TABLES):raise ValueError('Exact Auth side-effect result required')
 for table,count in counts.items():
  part=value[table]
  if type(part)is not dict or set(part)!={'actual','valid'}or any(type(part[key])is not int or part[key]!=count for key in ('actual','valid')):raise ValueError('Source-derived Auth side effects differ: '+table)
 return value
