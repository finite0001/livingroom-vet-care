#!/usr/bin/env python3
"""Preserve old source/JWT settings; deploy the eight reviewed dependency consumers."""
from pathlib import Path
import subprocess,json,sys,os,hashlib,tomllib,re
R=Path(__file__).resolve().parents[2];P=sys.argv[1];assert P in ['kothoqicubowyhwfsrte','mgadheotkdnrsatfivjy']
D=R/'tmp/pdf-packages-rollout'/P/'edge';D.mkdir(parents=True,exist_ok=True);D.chmod(0o700)
slugs=sorted(['prepare-document-link','prepare-invoice-email','prepare-payment-delivery','capture-conversation-email','retrieve-document-link','dispatch-outbox','prepare-release-email','recover-document-link'])
def closure(entry,seen=None):
 seen=set() if seen is None else seen
 if entry in seen or not entry.is_file():return seen
 seen.add(entry)
 for name in re.findall(r'(?:from\s+|import\s*)["\']([^"\']+)["\']',entry.read_text()):
  if name.startswith('.'):closure((entry.parent/name).resolve(),seen)
 return seen
validator=(R/'supabase/functions/_shared/record-release-diagnostics.ts').resolve()
assert slugs==sorted(entry.parent.name for entry in (R/'supabase/functions').glob('*/index.ts') if validator in closure(entry.resolve()))
assert len(slugs)==8
config=tomllib.loads((R/'supabase/config.toml').read_text())
def run(args,cwd=R):
 p=subprocess.run(['supabase',*args],cwd=cwd,capture_output=True,text=True)
 if p.returncode:(D/'failed-operation.json').write_text(p.stdout+'\n'+p.stderr)
 if p.returncode:raise RuntimeError('Function operation failed '+p.stderr[:800])
 return p.stdout
def inventory():
 a=json.loads(run(['functions','list','--project-ref',P,'--output','json']));return a if isinstance(a,list) else a['rows']
before=inventory();(D/'before.json').write_text(json.dumps(before));assert all(any(f['slug']==s for f in before) for s in slugs)
for s in slugs:
 B=D/'backup'/s;(B/'supabase').mkdir(parents=True,exist_ok=True);(B/'supabase/config.toml').write_text((R/'supabase/config.toml').read_text())
 run(['functions','download',s,'--project-ref',P,'--use-api','--workdir',str(B)])
 assert list((B/'supabase/functions').rglob('*'))
 print('Protected prior function backup:',s,flush=True)
assert P!='mgadheotkdnrsatfivjy' or json.loads((R/'tmp/pdf-packages-rollout/kothoqicubowyhwfsrte/auth-proof.json').read_text())['provider_requests']==0
res=run(['functions','deploy',*slugs,'--project-ref',P,'--use-api','--jobs','2','--import-map','supabase/functions/prepare-invoice-email/deno.json']);(D/'deploy.json').write_text(res)
after=inventory();(D/'after.json').write_text(json.dumps(after));result=[]
for s in slugs:
 b=next(f for f in before if f['slug']==s);a=next(f for f in after if f['slug']==s)
 assert a['status']=='ACTIVE' and a['version']>b['version'] and a['verify_jwt']==b['verify_jwt']==config['functions'][s]['verify_jwt']
 result.append({'slug':s,'before_version':b['version'],'after_version':a['version'],'verify_jwt':a['verify_jwt']})
for b in before:
 if b['slug'] not in slugs:assert next(f for f in after if f['slug']==b['slug'])['version']==b['version']
receipt={'project':P,'functions':result,'protected_source_backups':True,'unaffected_versions_unchanged':True,'prune':False,'secrets_changed':False,'explicit_pinned_import_map':'npm:zod@3.25.76'}
(D/'receipt.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))
