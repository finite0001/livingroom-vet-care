#!/usr/bin/env python3
"""Approved179 installation; exact178 preflight, protected source backup, no seeded gates."""
from pathlib import Path
import subprocess,json,hashlib,os,sys,shutil
R=Path(__file__).resolve().parents[2]
P=sys.argv[1];assert P in ['kothoqicubowyhwfsrte','mgadheotkdnrsatfivjy']
if P=='mgadheotkdnrsatfivjy':
 proof=json.loads((R/'tmp/pdf-packages-rollout/kothoqicubowyhwfsrte/auth-proof.json').read_text());assert proof['checks']>=193 and proof['provider_requests']==0 and all(v==0 for v in proof['cleanup'].values()) and all(v==0 for v in proof['policies'].values())
D=R/'tmp/pdf-packages-rollout'/P;D.mkdir(parents=True,exist_ok=True);os.chmod(D,0o700)
M='20261013003556_diagnostic_pdf_record_packages.sql'
C=D/'canonical';(C/'supabase/migrations').mkdir(parents=True,exist_ok=True)
shutil.copy2(R/'supabase/config.toml',C/'supabase/config.toml')
for f in (R/'supabase/migrations').glob('*.sql'):
 if f.name.split('_')[0]<='20261013003556': shutil.copy2(f,C/'supabase/migrations'/f.name)
def run(args):
 p=subprocess.run(['supabase',*args,'--workdir',str(C)],cwd=R,capture_output=True,text=True)
 if p.returncode: raise RuntimeError('Scoped Supabase command failed: '+p.stderr[:1000])
 return p.stdout
def q(s):
 d=json.loads(run(['db','query','--linked','--project-ref',P,'--output-format','json',s]));return d if isinstance(d,list) else d['rows']
versions=sorted(p.name.split('_')[0] for p in (C/'supabase/migrations').glob('*.sql'));assert len(versions)==179
history=q('select version from supabase_migrations.schema_migrations order by version;')
assert hashlib.sha256((R/'supabase/migrations'/M).read_bytes()).hexdigest()=='d2724dd9d8be1d6b6f96eabd88025ac0548d7a3b1f602a77a272c69076510ce7'
assert [v['version'] for v in history]==versions[:-1], 'Unexpected migration history'
state=q("select (select count(*) from diagnostic_pdf_worker_policy) as worker,(select count(*) from record_release_policy) as release,(select count(*) from record_request_disclosure_policy) as disclosure,(select count(*) from communication_outbox) as outbox,(select count(*) from payment_provider_profiles) as payment_profiles;")[0]
assert state['worker']==state['release']==state['disclosure']==0
backup=q("select p.oid::regprocedure::text as signature,pg_get_functiondef(p.oid) as definition,p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like '%diagnostic_pdf%' or p.proname like '%release%' or p.proname like '%record_request%') order by p.oid::regprocedure::text;")
f=D/'preflight-backup.json';f.write_text(json.dumps({'project':P,'history':history,'functions':backup,'state':state,'constraints':q("select conrelid::regclass::text as relation,conname,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid in ('record_release_policy'::regclass,'record_release_sources'::regclass)")}));os.chmod(f,0o600)
dry=run(['db','push','--linked','--project-ref',P,'--skip-vault','--dry-run']);parsed=json.loads(dry);assert parsed['migrations']==[M] and not parsed['seeds'] and not parsed['roles']
(D/'dry-run.json').write_text(dry)
apply=run(['db','push','--linked','--project-ref',P,'--skip-vault','--yes']);(D/'apply.json').write_text(apply)
assert q('select count(*) as count,max(version) as latest from supabase_migrations.schema_migrations;')[0]=={'count':179,'latest':'20261013003556'}
post=json.loads(run(['db','push','--linked','--project-ref',P,'--skip-vault','--dry-run']));assert post['upToDate'] and not post['migrations']
state2=q("select (select count(*) from diagnostic_pdf_worker_policy) as worker,(select count(*) from record_release_policy) as release,(select count(*) from record_request_disclosure_policy) as disclosure,(select count(*) from communication_outbox) as outbox,(select count(*) from payment_provider_profiles) as payment_profiles;")[0];assert state2==state
assert q("select (select count(*) from diagnostic_pdf_runtime_policy)+(select count(*) from diagnostic_pdf_staff_disclosure_policy) as count;")[0]['count']==0
result={'project':P,'migration':M,'migration_sha256':hashlib.sha256((R/'supabase/migrations'/M).read_bytes()).hexdigest(),'migrations':179,'pending':0,'protected_backup':True,'baseline_unchanged':True,'state':state,'runtime_policy':'empty/off','skip_vault':True,'legacy_writes':0}
(D/'installation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
