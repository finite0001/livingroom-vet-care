#!/usr/bin/env python3
"""Bounded staging-only synthetic settings; never replace existing configuration."""
import os,json,subprocess,secrets,base64
from pathlib import Path
r=Path(__file__).resolve().parents[2]
assert os.environ.get('DIAGNOSTICS_RUN_SYNTHETIC_STAGING')=='true','Bounded staging acceptance requires explicit opt-in';env=os.environ.copy()
for line in (r/'tmp/pdf-packages-rollout/preview-smoke.env').read_text().splitlines():
 if line.startswith('VERCEL_OIDC_TOKEN='):env['VERCEL_OIDC_TOKEN']=json.loads(line.split('=',1)[1])
assert 'VERCEL_OIDC_TOKEN' in env
env['DIAGNOSTICS_RUN_SYNTHETIC_STAGING']='true'
owned=['RESEND_FROM','DOCUMENT_LINK_ORIGIN','DOCUMENT_LINK_KEYS','DOCUMENT_LINK_ACTIVE_KEY_VERSION','DOCUMENT_LINK_PUBLIC_ENABLED']
inv=subprocess.run(['supabase','secrets','list','--project-ref','kothoqicubowyhwfsrte','--output','json'],cwd=r,capture_output=True,text=True,check=True)
names={a['name'] for a in json.loads(inv.stdout)};assert not names.intersection(owned),'Never overwrite preexisting configuration'
version='synthetic-'+secrets.token_hex(6);key=base64.b64encode(secrets.token_bytes(32)).decode()
env['LRV_SYNTHETIC_LINK_VERSION']=version;env['LRV_SYNTHETIC_LINK_KEY']=key
config=r/'tmp/pdf-packages-rollout/synthetic-runtime.env';assert not config.exists()
config.write_text('RESEND_FROM=SYNTHETIC staging <synthetic-practice@example.test>\nDOCUMENT_LINK_ORIGIN=https://thelivingroom.vet\nDOCUMENT_LINK_KEYS='+json.dumps({version:key})+'\nDOCUMENT_LINK_ACTIVE_KEY_VERSION='+version+'\nDOCUMENT_LINK_PUBLIC_ENABLED=true\n');config.chmod(0o600)
try:
 subprocess.run(['supabase','secrets','set','--project-ref','kothoqicubowyhwfsrte','--env-file',str(config)],cwd=r,capture_output=True,text=True,check=True)
 x=subprocess.run(['node' ,'--experimental-strip-types','scripts/rollout/pdf-packages-staging-auth.ts'],cwd=r,env=env)
finally:
 subprocess.run(['supabase','secrets','unset',*owned,'--project-ref','kothoqicubowyhwfsrte','--yes'],cwd=r,capture_output=True,text=True,check=True)
 config.unlink()
raise SystemExit(x.returncode)
