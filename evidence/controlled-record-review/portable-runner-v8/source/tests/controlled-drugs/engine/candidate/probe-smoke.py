from pathlib import Path
import json,os,subprocess
root=Path(__file__).resolve().parents[4];source=Path(__file__).resolve().parent;folder=Path(os.environ['CONTROLLED_ENGINE_RESULT_DIR']).resolve();r=json.loads((folder/'runtime.json').read_text());assert not r['removed']
identity=r['identity'];assert identity.startswith('lrv-controlled-engine-')
labels=json.loads(subprocess.check_output(['docker','inspect','supabase_db_'+identity]))[0]['Config']['Labels']
assert labels['com.supabase.cli.project']==identity and Path(labels['com.supabase.cli.workdir']).resolve()==Path(r['project']).resolve()
command=['docker','exec','-i','supabase_db_'+identity,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def sql(query):
 p=subprocess.run(command+['-c',query],capture_output=True,text=True,timeout=120)
 if p.returncode:
  (folder/'engine-v1-probe-error.log').write_text(p.stdout+p.stderr)
  print(p.stderr[-3000:]);raise RuntimeError('Local engine SQL probe failed; protected error log retained')
 return p.stdout
snapshot="""create temp table engine_snapshot(name text,value jsonb);
do $$declare v jsonb;r record;begin
for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in('public','auth','storage','extensions')and c.relkind in('r','p')order by 1,2 loop
execute format('select jsonb_build_object(''count'',count(*),''hash'',md5(coalesce(string_agg(to_jsonb(t)::text,''|''order by to_jsonb(t)::text),'''')))from %I.%I t',r.nspname,r.relname)into v;
insert into engine_snapshot values(r.nspname||'.'||r.relname,v);end loop;end $$;
select jsonb_object_agg(name,value)from engine_snapshot;"""
before=json.loads(sql(snapshot).splitlines()[-1]);assert before['public.controlled_stock_policy_versions']['count']==0 and before['auth.users']['count']==0
output=sql((source/'smoke.sql').read_text());(folder/'engine-v1-smoke.log').write_text(output)
after=json.loads(sql(snapshot).splitlines()[-1]);assert before==after
proof=json.loads(next(line for line in reversed(output.splitlines())if line.startswith('{')))
proof.update(all_relation_fingerprints_unchanged=len(before),real_practice_configuration=False,canonical_migration=False)
(folder/'engine-v1-smoke-proof.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof))
