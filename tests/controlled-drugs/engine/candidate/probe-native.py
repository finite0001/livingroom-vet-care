"""Synthetic managed lifecycle in a marked owned clone; no hosted/Auth API proof."""
from pathlib import Path
import json,os,subprocess,uuid
root=Path(__file__).resolve().parents[4];source=Path(__file__).resolve().parent;folder=Path(os.environ['CONTROLLED_ENGINE_RESULT_DIR']).resolve();runtime=json.loads((folder/'runtime.json').read_text())
identity=runtime['identity'];assert identity.startswith('lrv-controlled-engine-')and not runtime['removed']
container='supabase_db_'+identity
labels=json.loads(subprocess.check_output(['docker','inspect',container]))[0]['Config']['Labels']
assert labels['com.supabase.cli.project']==identity and Path(labels['com.supabase.cli.workdir']).resolve()==Path(runtime['project']).resolve()
database='owned_controlled_lifecycle_'+uuid.uuid4().hex[:10];marker=str(uuid.uuid4());created=False
restore_database='owned_controlled_restore_'+uuid.uuid4().hex[:10];restore_marker=str(uuid.uuid4());restore_created=False
log=(folder/'engine-native-v1.log').open('w')
def sql(query,target='postgres'):
 p=subprocess.run(['docker','exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',target,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],input=query,capture_output=True,text=True,timeout=180)
 log.write('DATABASE '+target+'\n'+p.stdout+p.stderr+'\n');log.flush()
 if p.returncode:print(p.stderr[-2600:]);raise RuntimeError('Owned managed lifecycle probe failed; private log retained')
 return p.stdout
def snapshot(target):
 query="""create temp table owned_snapshot(name text,value jsonb);
 do $$declare r record;v jsonb;begin for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in('public','auth','storage','extensions')and c.relkind in('r','p')order by 1,2 loop
 execute format('select jsonb_build_object(''count'',count(*),''hash'',md5(coalesce(string_agg(to_jsonb(t)::text,''|''order by to_jsonb(t)::text),'''')))from %I.%I t',r.nspname,r.relname)into v;
 insert into owned_snapshot values(r.nspname||'.'||r.relname,v);end loop;end $$;select jsonb_object_agg(name,value)from owned_snapshot;"""
 return json.loads(sql(query,target).splitlines()[-1])
try:
 original=snapshot('postgres')
 dump=subprocess.check_output(['docker','exec',container,'pg_dump','-U','postgres','--schema-only','--no-owner','--schema=public','--schema=auth','--schema=storage','--schema=extensions','postgres'],timeout=90).decode()
 dump='\n'.join(line for line in dump.splitlines()if not line.startswith('ALTER DEFAULT PRIVILEGES')).replace('CREATE SCHEMA extensions;','CREATE SCHEMA IF NOT EXISTS extensions;')
 technical=subprocess.check_output(['docker','exec',container,'pg_dump','-U','postgres','--data-only','--no-owner','--table=public.stock_writer_manifests','--table=public.controlled_stock_engine_manifests','postgres'],timeout=30).decode()
 sql('create database '+database+';');created=True;sql("comment on database "+database+" is '"+marker+"';")
 sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp"with schema extensions;',database)
 sql(dump+'\n'+technical,database)
 saved=json.loads(sql('select definition from controlled_stock_engine_manifests order by revision desc limit 1;',database).strip())
 actual=json.loads(sql('select controlled_stock_manifest_snapshot();',database).strip())
 differences=[]
 for family in sorted(set(saved)|set(actual)):
  if isinstance(saved.get(family),dict) and isinstance(actual.get(family),dict):
   for key in sorted(set(saved[family])|set(actual[family])):
    if saved[family].get(key)!=actual[family].get(key):differences.append({'family':family,'key':key,'saved':saved[family].get(key),'actual':actual[family].get(key)})
  elif saved.get(family)!=actual.get(family):differences.append({'family':family,'saved':saved.get(family),'actual':actual.get(family)})
 (folder/'engine-native-manifest-diff.json').write_text(json.dumps(differences,indent=2))
 sql('select controlled_stock_manifest_required();',database)
 sql('insert into native_return_policy_state values(true,0,null);',database)
 fixture=(root/'supabase/tests/native_fulfillment.test.sql').read_text()
 needle="insert into data select 'target',";assert fixture.count(needle)==1
 prefix=fixture[:fixture.index(needle)]+'\ncommit;\n'
 config=(source/'native-config.sql').read_text();operations=(source/'native-operations.sql').read_text()
 assert operations.count('set constraints all immediate;')==1
 operations=operations.replace('set constraints all immediate;',(source/'fault-probes.sql').read_text()+'\n'+(source/'integrity-probes.sql').read_text()+'\nset constraints all immediate;')
 output=sql(prefix+config+operations,database)
 proof=json.loads(next(line for line in reversed(output.splitlines())if line.startswith('{')))
 assert proof['managed_canonical_actions']==24 and proof['managed_producers']==9
 assert proof['late_injected_fault_points']==4 and proof['independent_corruption_failures']==11
 managed=snapshot(database)
 restore_dump=subprocess.check_output(['docker','exec',container,'pg_dump','-U','postgres','--no-owner','--schema=public','--schema=auth','--schema=storage','--schema=extensions',database],timeout=90).decode()
 restore_dump='\n'.join(line for line in restore_dump.splitlines()if not line.startswith('ALTER DEFAULT PRIVILEGES')).replace('CREATE SCHEMA extensions;','CREATE SCHEMA IF NOT EXISTS extensions;')
 sql('create database '+restore_database+';');restore_created=True
 sql("comment on database "+restore_database+" is '"+restore_marker+"';")
 sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp"with schema extensions;',restore_database)
 sql(restore_dump,restore_database)
 assert snapshot(restore_database)==managed
 sql('select controlled_stock_manifest_required();select controlled_stock_validate_event(id)from controlled_stock_events;select controlled_stock_validate_product(product_id)from controlled_stock_states;',restore_database)
 assert snapshot(restore_database)==managed
 # The populated restored database has its own ownership marker. Check both
 # runtime labels and that marker before every fresh probe backend.
 def verify_acl_restore():
  current=json.loads(subprocess.check_output(['docker','inspect',container]))[0]['Config']['Labels']
  assert current['com.supabase.cli.project']==identity and Path(current['com.supabase.cli.workdir']).resolve()==Path(runtime['project']).resolve()
  assert sql("select shobj_description(oid,'pg_database')from pg_database where datname='"+restore_database+"';").strip()==restore_marker
 def acl_sql(query):
  verify_acl_restore()
  return sql(query,restore_database)
 def acl_raw_sql(query):
  verify_acl_restore()
  result=subprocess.run(['docker','exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',restore_database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],input=query,capture_output=True,text=True,timeout=180)
  log.write('OWNED COLUMN ACL RESTORE REHEARSAL\n'+result.stdout+result.stderr+'\n');log.flush()
  return result
 from column_acl_seal import probe_column_acl_seal
 proof['restored_column_acl_seal']=probe_column_acl_seal(acl_sql,acl_raw_sql,(source/'prior-snapshot.sql').read_text(),phase='populated_restore')
 assert proof['restored_column_acl_seal'].get('passed')is True,'Restored column ACL seal proof incomplete'
 assert snapshot(restore_database)==managed
 isolation_results=[]
 for level in ['repeatable read','serializable']:
  isolation_sql=(source/'restore-isolation.sql').read_text().replace('__ISOLATION__',level)
  result=sql(isolation_sql,restore_database)
  row=json.loads(next(line for line in reversed(result.splitlines())if line.startswith('{')))
  assert row['kind']=='controlled-restored-isolation'and row['level']==level and row['checks']==4
  isolation_results.append(row)
 result=sql((source/'restore-context.sql').read_text(),restore_database)
 context_result=json.loads(next(line for line in reversed(result.splitlines())if line.startswith('{')))
 assert context_result['kind']=='controlled-restored-context'and context_result['checks']==4
 assert snapshot(restore_database)==managed
 proof.update(restored_unsupported_isolation_checks=sum(v['checks']for v in isolation_results),restored_context=context_result)
 assert snapshot(database)==managed
 assert snapshot('postgres')==original
 proof.update(all_relations_unchanged_after_each_injected_fault=True,populated_managed_restore=True,restored_exact_relation_fingerprints=len(managed),
  restore_validates_without_recorder_session=True,source_runtime_all_relations_unchanged=len(original),
  physical_post_backup_reconciliation_proven=False,storage_binary_restore_proven=False)
 proof.update(canonical_migration=False,genuine_auth_api=False,actual_practice_rules=False)
 (folder/'engine-native-v1-proof.json').write_text(json.dumps(proof,indent=2))
 print(json.dumps(proof))
finally:
 try:
  if restore_created:
   assert sql("select shobj_description(oid,'pg_database')from pg_database where datname='"+restore_database+"';").strip()==restore_marker
   sql('drop database '+restore_database+' with(force);')
   assert sql("select count(*)from pg_database where datname='"+restore_database+"';").strip()=='0'
  if created:
   assert sql("select shobj_description(oid,'pg_database')from pg_database where datname='"+database+"';").strip()==marker
   sql('drop database '+database+' with(force);')
   assert sql("select count(*)from pg_database where datname='"+database+"';").strip()=='0'
 finally:log.close()
